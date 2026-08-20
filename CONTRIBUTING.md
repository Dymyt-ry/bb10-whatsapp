# Contributing

## Layout

```
backend/   Node/Express: webhook receiver, in-memory cache, Evolution API calls
android/   Native Java app, API 18, no AndroidX
```

## Backend

```bash
cd backend
npm install
npm test          # 14 cases; no network and no Evolution instance required
npm run dev       # nodemon
```

The tests boot the real app on an ephemeral port and talk to it over HTTP.
Anything touching auth, the webhook secret, or `@lid` resolution should come
with a case there — those are the parts that fail silently in production.

## Android

```bash
cd android
echo "sdk.dir=$HOME/Library/Android/sdk" > local.properties
./gradlew assembleDebug
```

Needs JDK 11 and the API 19 platform. `local.properties` is not committed; put
`org.gradle.java.home` there too if your default JDK is not 11.

### Constraints that are not negotiable

API 18 is the whole point of the project, so:

- **No AndroidX, no AppCompat, no Material.** None of it exists here.
- **No `Fragment`s** — `Activity` and `ListView` only.
- **No WebView.**
- **OkHttp stays on 3.12.x.** It is the last line supporting Android 4.x.
- **Java 8 source level, Java 7 idioms.** No lambdas or method references in
  app code; the desugaring that would allow them is not worth the APK size.
- **Nothing on the UI thread that touches the network or a ContentProvider.**
  A 1 GB device notices.

If a change needs a modern API, it needs to degrade on API 18 rather than
raise `minSdkVersion`.

## Security-relevant areas

Take extra care in these, and say so in the PR description:

- `android/.../api/ApiClient.java` — TLS trust and hostname verification
- `backend/src/middleware/auth.js` — token comparison
- `backend/src/routes/webhook.js` — the only unauthenticated entry point
- Anything that logs. Message contents must never reach a log line.

## Pull requests

- One change per PR.
- Update `README.md` when you change an endpoint, an environment variable, or a
  requirement.
- `npm test` and `./gradlew assembleDebug` both pass.
