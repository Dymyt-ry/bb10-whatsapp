package dev.golobokov.bbwa.api;

import android.annotation.SuppressLint;
import android.content.Context;
import android.content.SharedPreferences;

import java.io.IOException;
import java.io.InputStream;
import java.net.InetAddress;
import java.net.Socket;
import java.net.UnknownHostException;
import java.security.KeyStore;
import java.security.cert.Certificate;
import java.security.cert.CertificateException;
import java.security.cert.CertificateFactory;
import java.security.cert.X509Certificate;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;

import javax.net.ssl.HostnameVerifier;
import javax.net.ssl.SSLContext;
import javax.net.ssl.SSLSession;
import javax.net.ssl.SSLSocket;
import javax.net.ssl.SSLSocketFactory;
import javax.net.ssl.TrustManager;
import javax.net.ssl.TrustManagerFactory;
import javax.net.ssl.X509TrustManager;

import dev.golobokov.bbwa.R;

import okhttp3.ConnectionSpec;
import okhttp3.HttpUrl;
import okhttp3.Interceptor;
import okhttp3.MultipartBody;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.Response;
import okhttp3.TlsVersion;

/**
 * Shared OkHttp client, configured for the two things that make BlackBerry 10
 * and other API 18 devices difficult:
 *
 * <ol>
 *   <li>TLS 1.1 and 1.2 exist on API 18 but are disabled by default, so every
 *       socket has to have them switched on explicitly.</li>
 *   <li>The system CA store predates Let's Encrypt, so certificates that every
 *       modern client accepts are rejected. ISRG Root X1 is bundled and trusted
 *       alongside the system store rather than instead of it.</li>
 * </ol>
 *
 * Certificate and hostname verification are on. They can be turned off for a
 * self-signed backend, but only by ticking a box in Settings that says so.
 */
public class ApiClient {

    public static final String PREFS_NAME = "bbwa_prefs";
    public static final String KEY_BACKEND_URL = "backend_url";
    public static final String KEY_API_TOKEN = "api_token";
    public static final String KEY_ALLOW_SELF_SIGNED = "allow_self_signed";
    public static final String KEY_ALLOW_CLEARTEXT = "allow_cleartext";

    private static final String DEFAULT_BASE_URL = "https://backend.example.com";

    private static OkHttpClient client;
    private static Context appContext;
    private static String baseUrl = DEFAULT_BASE_URL;
    private static HttpUrl backendUrl;
    private static String authToken = "";
    private static boolean allowSelfSigned = false;
    private static boolean allowCleartext = false;
    private static boolean configured = false;

    private ApiClient() {
    }

    public static void init(Context context) {
        appContext = context.getApplicationContext();
        SharedPreferences prefs = appContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        String storedUrl = prefs.getString(KEY_BACKEND_URL, DEFAULT_BASE_URL);
        boolean valid = configure(
                storedUrl,
                prefs.getString(KEY_API_TOKEN, ""),
                prefs.getBoolean(KEY_ALLOW_SELF_SIGNED, false),
                prefs.getBoolean(KEY_ALLOW_CLEARTEXT, false));
        // Upgrade valid legacy spellings once, so every future request and the
        // Settings screen use the exact URL that OkHttp parsed. Invalid legacy
        // values remain visible in Settings for correction, but are never used.
        if (valid && !baseUrl.equals(storedUrl)) {
            prefs.edit().putString(KEY_BACKEND_URL, baseUrl).apply();
        }
    }

    public static boolean configure(String url, String token, boolean selfSigned,
                                    boolean cleartext) {
        String canonicalUrl = canonicalizeBackendUrl(url, cleartext);
        boolean hasToken = token != null && token.length() > 0;
        configured = canonicalUrl != null && hasToken;
        backendUrl = configured ? HttpUrl.parse(canonicalUrl) : null;
        baseUrl = configured ? canonicalUrl : DEFAULT_BASE_URL;
        // An invalid legacy URL must not leave a credential available to an
        // interceptor, even if a background alarm starts before Settings does.
        authToken = configured ? token : "";
        allowSelfSigned = configured && selfSigned;
        allowCleartext = configured && cleartext;
        client = null;
        return configured;
    }

    public static boolean isConfigured(Context context) {
        SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        String canonicalUrl = canonicalizeBackendUrl(
                prefs.getString(KEY_BACKEND_URL, ""),
                prefs.getBoolean(KEY_ALLOW_CLEARTEXT, false));
        return canonicalUrl != null && prefs.getString(KEY_API_TOKEN, "").length() > 0;
    }

    public static String getBaseUrl() {
        return baseUrl;
    }

    /**
     * Parse once with OkHttp and return the exact base URL requests will use.
     * Prefix checks are insufficient: malformed legacy values can start with
     * "https://" yet normalize to a different host when a Request is built.
     */
    public static String canonicalizeBackendUrl(String url, boolean cleartext) {
        if (url == null) return null;
        HttpUrl parsed = HttpUrl.parse(url.trim());
        if (parsed == null || parsed.host() == null || parsed.host().length() == 0) {
            return null;
        }
        // A backend base URL has no use for credentials, query parameters or a
        // fragment. Rejecting them also removes user-info forms whose visible
        // prefix can be mistaken for the host that will receive the token.
        if (parsed.username().length() > 0 || parsed.password().length() > 0
                || parsed.query() != null || parsed.fragment() != null) {
            return null;
        }
        boolean https = "https".equals(parsed.scheme());
        boolean permittedHttp = cleartext && "http".equals(parsed.scheme());
        if (!https && !permittedHttp) return null;

        String canonical = parsed.toString();
        while (canonical.endsWith("/")) {
            canonical = canonical.substring(0, canonical.length() - 1);
        }
        return canonical;
    }

    public static synchronized OkHttpClient getClient() {
        if (client != null) return client;

        OkHttpClient.Builder builder = new OkHttpClient.Builder()
                // A custom authentication header may survive a redirect. The
                // configured canonical origin must be the final destination.
                .followRedirects(false)
                .followSslRedirects(false)
                .addInterceptor(new Interceptor() {
                    public Response intercept(Chain chain) throws IOException {
                        Request original = chain.request();
                        // Never attach a token after invalid legacy preferences,
                        // or to a host/scheme/port other than the canonical base.
                        if (!configured || backendUrl == null
                                || !sameOrigin(original.url(), backendUrl)) {
                            throw new IOException("Backend URL is not safely configured");
                        }
                        Request.Builder request = original.newBuilder()
                                .header("x-api-token", authToken);
                        // MultipartBody carries its own boundary in the
                        // Content-Type, so it must not be overwritten.
                        if (!(original.body() instanceof MultipartBody)) {
                            request.header("Content-Type", "application/json");
                        }
                        return chain.proceed(request.build());
                    }
                });

        applyTls(builder);
        client = builder.build();
        return client;
    }

    private static boolean sameOrigin(HttpUrl requestUrl, HttpUrl configuredUrl) {
        return requestUrl.scheme().equals(configuredUrl.scheme())
                && requestUrl.host().equals(configuredUrl.host())
                && requestUrl.port() == configuredUrl.port();
    }

    private static void applyTls(OkHttpClient.Builder builder) {
        try {
            X509TrustManager trustManager = allowSelfSigned
                    ? TRUST_EVERYTHING
                    : buildTrustManager();

            SSLContext sslContext = SSLContext.getInstance("TLS");
            // null, not new SecureRandom(): Android 4.3 shipped a broken
            // PRNG, and letting the provider pick avoids it.
            sslContext.init(null, new TrustManager[]{trustManager}, null);

            // API 18 negotiates TLS 1.0 unless each socket is told otherwise,
            // and most servers no longer accept it.
            builder.sslSocketFactory(new Tls12SocketFactory(sslContext.getSocketFactory()), trustManager);

            ConnectionSpec tls = new ConnectionSpec.Builder(ConnectionSpec.MODERN_TLS)
                    .tlsVersions(TlsVersion.TLS_1_2, TlsVersion.TLS_1_1)
                    .build();
            builder.connectionSpecs(allowCleartext
                    ? Arrays.asList(tls, ConnectionSpec.CLEARTEXT)
                    : Arrays.asList(tls));

            if (allowSelfSigned) {
                builder.hostnameVerifier(INSECURE_HOSTNAME_VERIFIER);
            }
        } catch (Exception e) {
            android.util.Log.e("ApiClient", "TLS setup failed, using platform defaults", e);
        }
    }

    @SuppressLint("BadHostnameVerifier")
    private static final HostnameVerifier INSECURE_HOSTNAME_VERIFIER = new HostnameVerifier() {
        public boolean verify(String hostname, SSLSession session) {
            return true;
        }
    };

    /**
     * Trusts everything the platform trusts, plus the bundled ISRG Root X1.
     * The system store is consulted first so a device with an up-to-date store
     * behaves exactly as it would without this class.
     */
    @SuppressLint("CustomX509TrustManager")
    private static X509TrustManager buildTrustManager() throws Exception {
        final X509TrustManager system = defaultTrustManager(null);
        final X509TrustManager bundled = defaultTrustManager(bundledRootStore());

        if (bundled == null) return system;
        if (system == null) return bundled;

        final X509Certificate[] issuers = concat(
                system.getAcceptedIssuers(), bundled.getAcceptedIssuers());

        return new X509TrustManager() {
            public void checkClientTrusted(X509Certificate[] chain, String authType)
                    throws CertificateException {
                system.checkClientTrusted(chain, authType);
            }

            public void checkServerTrusted(X509Certificate[] chain, String authType)
                    throws CertificateException {
                try {
                    system.checkServerTrusted(chain, authType);
                } catch (CertificateException systemRejected) {
                    // Only reached on devices whose CA store is too old.
                    bundled.checkServerTrusted(chain, authType);
                }
            }

            public X509Certificate[] getAcceptedIssuers() {
                return issuers;
            }
        };
    }

    private static X509TrustManager defaultTrustManager(KeyStore store) throws Exception {
        TrustManagerFactory factory =
                TrustManagerFactory.getInstance(TrustManagerFactory.getDefaultAlgorithm());
        factory.init(store);
        TrustManager[] managers = factory.getTrustManagers();
        for (int i = 0; i < managers.length; i++) {
            if (managers[i] instanceof X509TrustManager) {
                return (X509TrustManager) managers[i];
            }
        }
        return null;
    }

    private static KeyStore bundledRootStore() throws Exception {
        if (appContext == null) return null;
        InputStream in = appContext.getResources().openRawResource(R.raw.isrg_root_x1);
        try {
            Certificate cert = CertificateFactory.getInstance("X.509").generateCertificate(in);
            KeyStore store = KeyStore.getInstance(KeyStore.getDefaultType());
            store.load(null, null);
            store.setCertificateEntry("isrg-root-x1", cert);
            return store;
        } finally {
            try {
                in.close();
            } catch (IOException ignored) {
            }
        }
    }

    private static X509Certificate[] concat(X509Certificate[] a, X509Certificate[] b) {
        List<X509Certificate> all = new ArrayList<X509Certificate>();
        if (a != null) all.addAll(Arrays.asList(a));
        if (b != null) all.addAll(Arrays.asList(b));
        return all.toArray(new X509Certificate[all.size()]);
    }

    /**
     * Reached only when the user ticks "Allow self-signed certificate" in
     * Settings and confirms the dialog. Lint flags this class and the
     * hostname verifier above on sight, which is correct in general — the
     * suppressions record that both are behind an explicit opt-in rather
     * than being the default the app ships with.
     */
    @SuppressLint({"TrustAllX509TrustManager", "CustomX509TrustManager"})
    private static final X509TrustManager TRUST_EVERYTHING = new X509TrustManager() {
        public X509Certificate[] getAcceptedIssuers() {
            return new X509Certificate[0];
        }

        public void checkClientTrusted(X509Certificate[] chain, String authType) {
        }

        public void checkServerTrusted(X509Certificate[] chain, String authType) {
        }
    };

    /**
     * API 18 ships TLS 1.1/1.2 but leaves them off. Every socket the factory
     * hands out gets them enabled on the way past.
     */
    private static class Tls12SocketFactory extends SSLSocketFactory {
        private final SSLSocketFactory delegate;

        Tls12SocketFactory(SSLSocketFactory delegate) {
            this.delegate = delegate;
        }

        @Override
        public String[] getDefaultCipherSuites() {
            return delegate.getDefaultCipherSuites();
        }

        @Override
        public String[] getSupportedCipherSuites() {
            return delegate.getSupportedCipherSuites();
        }

        private Socket patch(Socket socket) {
            if (socket instanceof SSLSocket) {
                ((SSLSocket) socket).setEnabledProtocols(new String[]{"TLSv1.1", "TLSv1.2"});
            }
            return socket;
        }

        @Override
        public Socket createSocket(Socket s, String host, int port, boolean autoClose) throws IOException {
            return patch(delegate.createSocket(s, host, port, autoClose));
        }

        @Override
        public Socket createSocket(String host, int port) throws IOException, UnknownHostException {
            return patch(delegate.createSocket(host, port));
        }

        @Override
        public Socket createSocket(String host, int port, InetAddress localHost, int localPort)
                throws IOException, UnknownHostException {
            return patch(delegate.createSocket(host, port, localHost, localPort));
        }

        @Override
        public Socket createSocket(InetAddress host, int port) throws IOException {
            return patch(delegate.createSocket(host, port));
        }

        @Override
        public Socket createSocket(InetAddress address, int port, InetAddress localAddress, int localPort)
                throws IOException {
            return patch(delegate.createSocket(address, port, localAddress, localPort));
        }
    }
}
