<h1 align="center">BBWA</h1>

<p align="center"><em>WhatsApp on a BlackBerry, in 2026.</em></p>

<p align="center">
  <a href="https://github.com/Dymyt-ry/bb10-whatsapp/actions/workflows/ci.yml"><img alt="CI" src="https://img.shields.io/github/actions/workflow/status/Dymyt-ry/bb10-whatsapp/ci.yml?branch=main&style=flat-square&label=CI&labelColor=1c1c1c"></a>
  <a href="./LICENSE"><img alt="MIT" src="https://img.shields.io/badge/license-MIT-4c9a2a?style=flat-square&labelColor=1c1c1c"></a>
  <img alt="Android API 18+" src="https://img.shields.io/badge/Android-API%2018%2B-3ddc84?style=flat-square&labelColor=1c1c1c">
  <img alt="Java" src="https://img.shields.io/badge/Java-7%20source-e76f00?style=flat-square&labelColor=1c1c1c">
  <img alt="Node" src="https://img.shields.io/badge/Node-18%2B-5fa04e?style=flat-square&labelColor=1c1c1c">
  <img alt="No AndroidX" src="https://img.shields.io/badge/AndroidX-none-8b5cf6?style=flat-square&labelColor=1c1c1c">
  <a href="https://github.com/Dymyt-ry/bb10-whatsapp/releases/latest"><img alt="Latest release" src="https://img.shields.io/github/v/release/Dymyt-ry/bb10-whatsapp?style=flat-square&labelColor=1c1c1c&color=0aa8d2"></a>
</p>

---

WhatsApp dropped BlackBerry 10 in 2017. The hardware still works, the keyboard
is still the best one ever put on a phone, and the Android runtime inside BB10
still runs API 18 apps.

**BBWA** is a native WhatsApp client for it: a small Java app with no AndroidX,
no AppCompat, no WebView and no Material Design — none of which exist on API 18
— talking to a Node backend that holds a WhatsApp session through
[Evolution API](https://github.com/EvolutionAPI/evolution-api).

It also runs on any other Android 4.3+ device that modern apps have abandoned.

```
WhatsApp ──► Evolution API v2 ──► POST /webhook/<secret>
                                          │
                                   Node backend (in-memory cache)
                                          │
                             GET /chats · /chat/:id · /api/media/:id
                                          │
                                Android app (API 18, polls every 4 s)
```

The backend is not a proxy. Evolution API pushes each message in as it
arrives, the backend keeps it in memory, and the phone reads from that. A
1 GB BlackBerry does no JSON-heavy work and never decodes a Base64 image.

## Features

| | |
|---|---|
| 🖼️ **Images** | Send and receive. Tap for fullscreen, long-press to save to the Gallery. Decoding and encoding happen on the backend so the phone never holds a Base64 blob in RAM. |
| ❤️ **Reactions** | Double-tap for a heart, long-press for the emoji menu. Two-way. |
| 👤 **Contact names** | Device contacts via an indexed `PhoneLookup`, custom aliases stored locally, WhatsApp `pushName` as the fallback. |
| 🔢 **Unread badges** | Green counter on the chat list, cleared when the chat is opened. |
| 🔔 **Notifications** | Background `AlarmManager` polling with vibration, filtered so only real incoming messages ping. |
| 👥 **Groups** | Group names resolved from Evolution API. |
| 🆔 **`@lid` handling** | Modern WhatsApp hands out `@lid` pseudonyms instead of phone numbers; the `*Alt` fields resolve them back. |
| 🖤 **AMOLED black** | Holo dark, pure `ListView`, no WebView anywhere. |

## Requirements

- **Evolution API v2** — v1 does not resolve `@lid`, and replying to those
  chats fails with `406 Not Acceptable`. v2 is not optional.
- **Node.js 18+** for the backend.
- **JDK 11** and the **Android API 19 platform** to build the APK.
- A phone: BlackBerry 10 with the Android runtime, or anything on Android 4.3+.

## Backend

```bash
cd backend
cp .env.example .env      # then fill it in
npm install
npm start
```

| Variable | Required | Description |
|---|---|---|
| `EVO_API_URL` | yes | Evolution API base URL |
| `EVO_INSTANCE_NAME` | yes | Evolution instance name |
| `EVO_API_KEY` | yes | Evolution API key |
| `AUTH_TOKEN` | yes | Token the app sends as `x-api-token`. 16 characters minimum |
| `WEBHOOK_SECRET` | yes | Route-safe secret: 16+ ASCII letters, digits, `_` or `-` only |
| `CORS_ORIGIN` | no | Only needed if a browser calls the API. The app does not |
| `PORT` | no | Default `3000` |

The process refuses to start if a required variable is missing, rather than
serving confusing 401s later.

> **Avoid `#` and `$` in `AUTH_TOKEN`.** Docker and Coolify truncate values at
> those characters, and the symptom is an app that says Unauthorized forever.

### Deploying

Deploy `backend/` as a Node app, then register the webhook with Evolution:

```bash
curl -X POST "$EVO_HOST/webhook/set/$INSTANCE" \
  -H "apikey: $EVO_API_KEY" -H "Content-Type: application/json" \
  -d '{"webhook":{"url":"https://your-backend/webhook/YOUR_WEBHOOK_SECRET","enabled":true,"events":["MESSAGES_UPSERT"],"webhookByEvents":false,"webhookBase64":false}}'
```

v2 wraps the payload in a `webhook` object; v1 did not. Keep `webhookBase64`
off — the backend fetches media on demand instead of taking it inline.

## Android

A prebuilt debug APK is attached to [the latest release](https://github.com/Dymyt-ry/bb10-whatsapp/releases/latest),
with a SHA-256 checksum next to it. Debug signing is suitable for local
sideloading only; build and sign `release` with your own private key for
distribution.

To build it yourself:

```bash
cd android
echo "sdk.dir=$HOME/Library/Android/sdk" > local.properties
./gradlew assembleDebug
```

The APK lands in `android/app/build/outputs/apk/debug/`. Sideload it, open
Settings on first launch, and enter the backend URL and token.

The app requires an `https://` backend by default. Plain `http://` can be
enabled separately in Settings for a trusted local network, behind a warning:
it exposes both the API token and message traffic to network observers.

`release` intentionally has no signing config or key in the repository. Supply
your own private signing configuration, or use the debug APK for local
sideloading.

## Setting up Evolution API v2

Use `evoapicloud/evolution-api:v2.3.7`. **Note the registry**: the project
moved, and the older `atendai/evolution-api` images stop at v2.2.3
(February 2025).

```
SERVER_URL=http://your-server:8081
AUTHENTICATION_API_KEY=your-api-key
DATABASE_ENABLED=true
DATABASE_PROVIDER=postgresql
DATABASE_CONNECTION_URI=postgresql://user:pass@host:5432/evolution
CACHE_REDIS_ENABLED=false
CACHE_LOCAL_ENABLED=true
```

> **`CACHE_REDIS_ENABLED=false` matters.** With Redis expected but absent, the
> Baileys engine restarts every five seconds and never produces a pairing code.

Create an instance, wait 10–15 seconds for Baileys to come up, then ask for a
pairing code:

```bash
curl -X POST "$EVO_HOST/instance/create" -H "apikey: $EVO_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"instanceName":"bbwa","qrcode":true,"integration":"WHATSAPP-BAILEYS"}'

curl "$EVO_HOST/instance/connect/bbwa?number=447911123456" -H "apikey: $EVO_API_KEY"
```

The number needs a country code and no `+`. On the phone:
**WhatsApp → Linked Devices → Link with phone number**, then type the 8 digits.

## API

Everything except `/status` and `/webhook` requires `x-api-token`.

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/status` | Health check |
| `GET` | `/chats` | Conversations, newest first |
| `GET` | `/chat/:id` | Messages in a chat; does not change unread state |
| `POST` | `/chat/:id/read` | Clear a chat's unread count when it is opened |
| `POST` | `/chat/:id/rename` | Set a local display name |
| `GET` | `/api/media/:messageId` | Image bytes, fetched from Evolution on demand |
| `POST` | `/send` | `{ chatId, text }` |
| `POST` | `/api/messages/sendMedia` | `multipart/form-data`: `image`, `number` |
| `POST` | `/api/messages/reaction` | `{ chatId, messageId, emoji, originalFromMe }` |
| `POST` | `/webhook/:secret` | Evolution API webhook receiver |

## Security

Worth being explicit about, because this carries private messages:

- **Certificates are verified.** API 18 predates Let's Encrypt, so **ISRG Root
  X1** is bundled and trusted alongside the system store rather than instead of
  it. Verification can be turned off for a self-signed backend, but only by
  ticking a box in Settings that says what it does.
- **TLS 1.1 and 1.2 are forced on.** API 18 has both but negotiates TLS 1.0
  unless every socket is told otherwise.
- **`allowBackup` is off**, so `adb backup` cannot lift the API token out of
  SharedPreferences.
- **Tokens are compared in constant time**, and the backend refuses to start
  with a token shorter than 16 characters.
- **The webhook takes a required shared secret.** The backend refuses to start
  unless it is at least 16 characters and consists entirely of ASCII letters,
  digits, underscores or hyphens. The bare `/webhook` route is not accepted.
- **Message contents are never logged.** An earlier version printed the full
  text of any message that failed to send.

The threat model stops there. The backend holds a live WhatsApp session — run
it somewhere you would be comfortable running a mail server.

## Development

```bash
cd backend && npm test        # no external network or Evolution instance needed
cd android  && ./gradlew assembleDebug
```

The backend tests run the real Express app on an ephemeral port and drive it
over HTTP, so the auth middleware, the webhook secret and the `@lid` resolution
are all exercised as they actually ship. A second suite points the app at a stub
Evolution API and asserts what it sends: the path, the instance name, the
`apikey` header, and that a message containing a backslash or a newline arrives
byte for byte.

CI builds the APK on every push, rejects fatal/error lint findings, and fails
on any high-severity advisory in a backend dependency.

### What is and isn't verified

The backend is covered end to end. The Android app is compiled and linted in
CI, and the APK is built from every commit — but it has not been run against a
live Evolution instance in this repository's automation, and there is no
emulator coverage: Google never published an `arm64-v8a` system image for API
19, so an API 18/19 emulator cannot run on an Apple Silicon machine at all.
Device testing is manual.

## Known limitations

- **The cache is memory-only.** A backend restart loses history until new
  messages arrive. It uses LRU eviction and is bounded at 500 chats, 500
  messages per chat and 5,000 messages overall.
- **Polling, not push.** Four seconds in the foreground, a minute in the
  background. API 18 has no FCM worth using.
- **Text and images only.** No voice notes, video, documents or stickers.
- **One WhatsApp account per backend instance.**

## License

[MIT](./LICENSE) © Timofej Golobokov ([@Dymyt-ry](https://github.com/Dymyt-ry))

Not affiliated with WhatsApp, Meta, or BlackBerry.
