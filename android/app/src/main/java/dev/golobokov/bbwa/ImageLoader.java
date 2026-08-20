package dev.golobokov.bbwa;

import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.os.AsyncTask;
import android.util.LruCache;
import android.widget.ImageView;
import dev.golobokov.bbwa.api.ApiClient;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.util.Arrays;
import java.util.Comparator;
import okhttp3.Request;
import okhttp3.Response;

public class ImageLoader {

    private static final int  TARGET_SIZE    = 400;
    private static final long MAX_DISK_BYTES = 15L * 1024 * 1024;

    private static LruCache<String, Bitmap> memCache;

    public static void init() {
        if (memCache != null) return;
        int maxBytes = (int) (Runtime.getRuntime().maxMemory() / 8);
        memCache = new LruCache<String, Bitmap>(maxBytes) {
            protected int sizeOf(String key, Bitmap value) {
                return value.getByteCount();
            }
        };
    }

    public static void clearMemCache() {
        if (memCache != null) memCache.evictAll();
    }

    public static void load(Context context, String messageId,
                            String url, ImageView imageView) {
        init();
        imageView.setTag(messageId);

        Bitmap mem = memCache.get(messageId);
        if (mem != null) { imageView.setImageBitmap(mem); return; }

        File f = diskFile(context, messageId);
        if (f.exists()) {
            Bitmap disk = decodeSampled(f.getAbsolutePath());
            if (disk != null) {
                memCache.put(messageId, disk);
                if (messageId.equals(imageView.getTag())) imageView.setImageBitmap(disk);
                return;
            }
        }
        new FetchTask(context, messageId, url, imageView).execute();
    }

    public static void cleanup(Context context) {
        File[] all = context.getCacheDir().listFiles();
        if (all == null) return;
        int n = 0;
        for (File f : all)
            if (f.getName().startsWith("img_") && f.getName().endsWith(".jpg"))
                all[n++] = f;
        File[] imgs = Arrays.copyOf(all, n);
        Arrays.sort(imgs, new Comparator<File>() {
            public int compare(File a, File b) {
                long d = a.lastModified() - b.lastModified();
                return d < 0 ? -1 : d > 0 ? 1 : 0;
            }
        });
        long total = 0;
        for (File f : imgs) total += f.length();
        int i = 0;
        while (total > MAX_DISK_BYTES && i < imgs.length) {
            total -= imgs[i].length();
            imgs[i++].delete();
        }
    }

    private static File diskFile(Context ctx, String id) {
        return new File(ctx.getCacheDir(), "img_" + id + ".jpg");
    }

    private static int sampleSize(BitmapFactory.Options o) {
        int s = 1;
        if (o.outHeight > TARGET_SIZE || o.outWidth > TARGET_SIZE) {
            int hh = o.outHeight / 2, hw = o.outWidth / 2;
            while ((hh / s) >= TARGET_SIZE && (hw / s) >= TARGET_SIZE) s *= 2;
        }
        return s;
    }

    private static Bitmap decodeSampled(String path) {
        BitmapFactory.Options b = new BitmapFactory.Options();
        b.inJustDecodeBounds = true;
        BitmapFactory.decodeFile(path, b);
        BitmapFactory.Options o = new BitmapFactory.Options();
        o.inSampleSize        = sampleSize(b);
        o.inPreferredConfig   = Bitmap.Config.RGB_565;
        o.inPurgeable         = true;
        o.inInputShareable    = true;
        return BitmapFactory.decodeFile(path, o);
    }

    private static class FetchTask extends AsyncTask<Void, Void, Bitmap> {
        private final Context ctx;
        private final String  id, url;
        private final ImageView iv;

        FetchTask(Context ctx, String id, String url, ImageView iv) {
            this.ctx = ctx.getApplicationContext();
            this.id = id; this.url = url; this.iv = iv;
        }

        protected Bitmap doInBackground(Void... p) {
            Request req = new Request.Builder().url(url).build();
            Response resp = null;
            InputStream in = null;
            FileOutputStream out = null;
            try {
                resp = ApiClient.getClient().newCall(req).execute();
                if (!resp.isSuccessful()) return null;
                in  = resp.body().byteStream();
                File f = diskFile(ctx, id);
                // Download to a temporary name and rename on success, so an
                // interrupted transfer cannot leave a truncated file behind
                // that every later load would find and fail to decode.
                File tmp = new File(f.getAbsolutePath() + ".part");
                out = new FileOutputStream(tmp);
                byte[] buf = new byte[4096]; int r;
                while ((r = in.read(buf)) != -1) out.write(buf, 0, r);
                out.flush();
                out.close(); out = null;
                if (!tmp.renameTo(f)) {
                    tmp.delete();
                    return null;
                }
                return decodeSampled(f.getAbsolutePath());
            } catch (IOException e) {
                return null;
            } finally {
                if (in  != null) try { in.close();   } catch (IOException ignored) {}
                if (out != null) try { out.close();  } catch (IOException ignored) {}
                if (resp != null) resp.close();
            }
        }

        protected void onPostExecute(Bitmap bmp) {
            if (bmp == null || !id.equals(iv.getTag())) return;
            memCache.put(id, bmp);
            iv.setImageBitmap(bmp);
        }
    }
}
