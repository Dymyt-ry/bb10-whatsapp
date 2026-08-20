# Changelog

Follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [1.0.0] — 2026-08-21

First tagged release, and a security-focused pass over the whole project.

### Security
- **The Android client verified nothing.** It installed a trust manager whose
  `checkServerTrusted` was empty and a hostname verifier that returned `true`
  unconditionally, so any machine on the path could read and rewrite the
  traffic and lift the API token. Certificates and hostnames are now checked.
  ISRG Root X1 ships with the app and is trusted *in addition to* the system
  store, because API 18 predates Let's Encrypt. Verification can be waived for
  a self-signed backend from Settings, off by default and behind a confirmation.
- `allowBackup` is off. It was on, and `adb backup` could extract the API token
  from SharedPreferences.
- `release` no longer signs with the shared Android debug keystore.
- `/webhook` accepts a shared secret in its path. It was fully open: anyone who
  could reach the backend could inject chats and messages into the client.
- Auth tokens are compared with `crypto.timingSafeEqual`.
- The backend validates its environment at startup and refuses an `AUTH_TOKEN`
  under 16 characters.
- CORS defaults to refusing browsers instead of `*`.
- Failed sends no longer log the message text and chat id.
- Upgraded out of 44 known advisories: `multer` 1.x (end-of-life, 8 advisories
  up to CVSS 8.7, and reachable from the upload endpoint) to 2.2.0, `axios`
  1.14.0 (27 advisories) to 1.19.0, plus `express`, `form-data` and `qs`.

### Fixed
- **The repository could not be built.** `.gitignore` excluded `gradlew`,
  `gradlew.bat` and `gradle/`, so the documented `./gradlew assembleDebug` had
  nothing to run. The wrapper is committed.
- `gradle.properties` hard-coded an absolute JDK path from one developer's
  machine, breaking the build everywhere else.
- Outgoing JSON was assembled by string concatenation with only `"` escaped, so
  any message containing a backslash, tab or newline produced malformed JSON
  and a 400. Both call sites use Gson.
- A reaction arriving on an `@lid` chat was filed under a different `chatId`
  than the message it belonged to and never appeared. The webhook now prefers
  `remoteJidAlt` for reactions, as it already did for messages.
- Tapping an image that was not already cached opened an empty fullscreen view:
  the dialog was stored in the same view tag `ImageLoader` uses to discard stale
  results.
- An interrupted image download left a truncated file in the cache that every
  later load found and failed to decode, permanently. Downloads land on a
  temporary name and are renamed on success.
- `Gson.fromJson` returns `null` for an empty or malformed body; both activities
  passed that straight to `addAll` and crashed.
- Walking visible list positions to update a reaction could run past the end of
  the adapter, and dereferenced a row view that may not exist.
- Contact lookup selected every row in the contacts database and compared each
  one in Java — a full scan per unknown number, on the UI thread. It uses the
  indexed `PhoneLookup` filter URI now.
- Message senders are WhatsApp `pushName` values, not phone numbers; they were
  being looked up in the contacts database as if they were numbers.
- Media was always served as `image/jpeg`, so PNG and WebP decoded as garbage.
- Group versus direct chat was inferred from the length of the identifier.
  A shared JID helper uses the `@g.us` suffix instead.
- The cache grew without limit in both message count and dedup ids. Bounded to
  500 messages per chat and 20 000 remembered ids.
- Uploads accepted any file type and forwarded it as an image.
- A malformed request body produced an HTML error page containing a stack
  trace. All errors return JSON, and `x-powered-by` is off.
- Documentation contradicted the code: Java 1.6 (it was 1.7), Evolution API
  v1.8.2 (v2 is required), Gradle 5.6.4 and JDK 8 (AGP 7.4.2 needs Gradle 7.5+
  and JDK 11), and a 4-second background poll that was actually 60 seconds.

### Changed
- Package renamed `cz.webflex.bbwa` → `dev.golobokov.bbwa`; the WebFlex
  branding is gone from the app, the About dialog and the manifests.
- The About dialog reads its version from the package rather than a hard-coded
  string that had drifted to "v2.0" against a `versionName` of "1.0".
- User-visible strings and log messages are English throughout; several were
  Czech.
- Backend tests (22 cases) and CI: backend on Node 18/20/22, an APK build, and
  a dependency audit that fails on any high-severity advisory, and an Android
  lint gate. Lint went from 26 warnings and one fatal to 12 warnings and none,
  with no remaining findings in its security category.
