# ACARE Android app

The Android app is not a separate frontend. It is the **same** `apps/web` React
build, bundled into an APK and rendered by an Android System WebView via
[Capacitor](https://capacitorjs.com). Same components, same Tailwind CSS, same
axios client, same API endpoints — so every role sees the same UI it sees on the
web, and there is no second codebase to keep in sync.

The native project lives in `apps/web/android/` and is committed.

---

## One-time setup

### 1. JDK 21

Capacitor 8 / Android Gradle Plugin 8.13 needs **JDK 21**. Android Studio ships
one, so you do not need a separate install — just point Gradle at it:

```powershell
$env:JAVA_HOME = "C:\Program Files\Android\Android Studio\jbr"
```

A newer JDK on your `PATH` (e.g. 22) will not work. `JAVA_HOME` is deliberately
not committed to `gradle.properties`, since the path differs per machine and OS.

### 2. Android SDK

Set `ANDROID_HOME` (or let Android Studio write `android/local.properties`):

```powershell
$env:ANDROID_HOME = "$env:LOCALAPPDATA\Android\Sdk"
```

Via Android Studio → SDK Manager, install **SDK Platform 36**, **Build-Tools
36.x**, and **Platform-Tools**.

### 3. API URL

The web deployment gets `VITE_API_URL` from the Vercel dashboard. The APK is
built locally, so it needs its own copy:

```bash
cp apps/web/.env.mobile.example apps/web/.env.mobile
# then edit .env.mobile and set the real https:// API URL
```

`.env.mobile` is gitignored. It must be an absolute `https://` URL reachable
from the device — inside the WebView, `localhost` is the app's own bundled
assets, not your machine. For an emulator pointed at a local API, use
`http://10.0.2.2:8000` (and see "Local API" below).

### 4. Firebase, for push notifications

Skip this and everything still builds and runs — the app just never raises a
system notification, and the in-app bell behaves exactly as it always did.
Registration fails at startup, the failure is logged to the WebView console, and
nothing else changes. Do it and staff get alerted with the app closed.

Two artefacts come out of one Firebase project, and they go to different places:

| Artefact | Goes to | Secret? |
|---|---|---|
| `google-services.json` | `apps/web/android/app/` | No — it ships inside every APK |
| Service-account JSON | the **API's** environment | **Yes** — it can send as your project |

1. Create a project at [console.firebase.google.com](https://console.firebase.google.com).
2. **Add an Android app** with package name **`ca.uwindsor.acare`** — it must
   match `applicationId` in `android/app/build.gradle` exactly, or FCM will
   refuse the token. Download `google-services.json` and drop it in
   `apps/web/android/app/`. The Gradle plugin is already wired to apply itself
   only when that file is present (bottom of `android/app/build.gradle`).
3. **Project settings → Service accounts → Generate new private key.** This is
   the credential the API sends with. Give it to the backend one of two ways:

   ```bash
   # Local: point at the downloaded file
   FCM_SERVICE_ACCOUNT_FILE=C:\path\to\acare-firebase-adminsdk.json

   # Render: paste the whole JSON as one env var value
   FCM_SERVICE_ACCOUNT_JSON={"type":"service_account","project_id":"…"}
   ```

   Set either one in `apps/api/.env` (gitignored) or the Render dashboard. Never
   commit it, and never ship it in the APK — it is not a client credential.
4. Rebuild the APK (`npm run android:sync`, then assemble). `google-services.json`
   is only read at build time.

Confirm the API picked it up — `GET /notifications/push-status` as a manager or
above returns `{"enabled": true, "project_id": "…"}`. A device that registered
successfully also gets `push_enabled: true` back from `POST /notifications/devices`,
which is how you tell "the server has my token" apart from "push will never
arrive because the server has no credentials".

Three places name the same Android channel and must agree, or Android 8+ drops
every message **without an error anywhere**:

| Where | Value |
|---|---|
| `apps/web/src/lib/push.ts` | `CHANNEL_ID` |
| `android/app/src/main/res/values/strings.xml` | `default_notification_channel_id` |
| `apps/api/app/config.py` | `FCM_ANDROID_CHANNEL_ID` |

### 5. Release keystore

Generate **once**, and back it up somewhere outside the repo. If it is lost, the
app can never be updated in place — every user has to uninstall and reinstall.

```bash
keytool -genkey -v -keystore acare-release.jks -alias acare \
        -keyalg RSA -keysize 2048 -validity 10000
```

Then:

```bash
cp apps/web/android/keystore.properties.example apps/web/android/keystore.properties
# fill in the path and passwords
```

Both the `.jks` and `keystore.properties` are gitignored. If
`keystore.properties` is absent the release build still compiles, just unsigned.

---

## Day-to-day

All commands run from `apps/web`.

| Command | What it does |
|---|---|
| `npm run build:mobile` | Production web build using `.env.mobile` |
| `npm run android:sync` | Build + copy assets and plugins into the native project |
| `npm run android:run` | Sync, then install and launch on a device/emulator |
| `npm run android:open` | Sync, then open the project in Android Studio |
| `npm run android:live` | Tunnel the Vite dev server to the device and serve it |
| `npm run android:live:install` | The above, plus build and install the live-reload APK |

Anything that changes `src/`, `capacitor.config.ts`, or the installed plugins
needs an `android:sync` before it shows up in the app — unless you are running
live reload, below.

### Live reload on a device

Rebuilding and reinstalling an APK for every frontend tweak is slow, and almost
all day-to-day work is in `src/`. Live reload points the WebView at the Vite dev
server instead of the assets bundled by `cap sync`, so a save shows up in the
app in about a second with no reinstall.

**Once**, with the device plugged in and USB debugging accepted:

```bash
npm run android:live:install
```

This builds a **debug** APK whose `capacitor.config.json` carries
`server.url = http://127.0.0.1:5173`, installs it, and launches it.

**Every session after that**, one command, left running:

```bash
npm run android:live
```

Then open ACARE on the device and edit `src/`. HMR pushes each save straight
into the WebView.

Why it is shaped this way:

- **`adb reverse`, not a LAN address.** `uwinsecure` isolates clients, so the
  device cannot reach this machine over Wi-Fi on campus. The script tunnels the
  port over USB instead. The tunnel does not survive an unplug, which is why
  `android:live` re-establishes it on every run. `npx cap run android
  --live-reload --external` does the LAN thing and will not work here.
- **127.0.0.1, not localhost.** Capacitor serves its own assets from `localhost`
  and would intercept the request. Chromium still treats `127.0.0.1` as a
  trustworthy origin, so nothing about the page's capabilities changes, and the
  API's CORS allow-list already covers it (see the origin regex in
  `apps/api/app/main.py`).
- **A debug APK, not a release one.** Only the debug variant permits cleartext
  to `127.0.0.1`; the release build blocks plain HTTP outright and should stay
  that way. The consequence is that installing the live-reload APK over a
  release-signed one needs `adb uninstall ca.uwindsor.acare` first, which
  clears the app's data — a one-time cost.
- **The dev server runs in `mobile` mode**, so it reads `VITE_API_URL` from
  `.env.mobile` exactly as the APK does. Point `.env.mobile` at a local backend
  on `http://127.0.0.1:8000` and `android:live` tunnels that port too.
- **It builds with gradle directly rather than `npx cap run android`.** Capacitor
  invokes a bare `gradlew`, which does not resolve on a Windows shell that sets
  `NoDefaultCurrentDirectoryInExePath` (Git Bash does), so the script calls
  `gradlew.bat` by absolute path instead.

The script also resolves the two things a command-line gradle build needs and
Android Studio would otherwise have supplied, so neither has to be set up by
hand:

- `ANDROID_HOME`, from wherever `platform-tools/adb` was found — without it AGP
  fails with "SDK location not found", since `android/local.properties` is
  gitignored and only Studio writes one.
- `JAVA_HOME`, pointed at a **JDK 21** — the toolchain pins that major version
  and rejects anything else rather than falling back. It prefers the JDK bundled
  with Android Studio (its `jbr` directory), which is the JVM Studio already
  builds this project with.

Live reload is off unless `CAP_LIVE_RELOAD=1` is set, which only these two
scripts do, so ordinary `android:sync` and release builds are unaffected. Native
changes — plugins, the manifest, Firebase config, gradle — still need a real
rebuild. **Never hand out a live-reload APK**: with `server.url` baked in it is
useless away from this machine.

### Which build is on a tablet

A tablet showing **"web page not available at 127.0.0.1:5173"** has a
*live-reload debug* APK on it, and is looking for a Vite dev server that is not
there. That build is only useful tethered to the machine running
`npm run android:live`. The `DEBUGGABLE` flag is how you tell:

```bash
adb shell dumpsys package ca.uwindsor.acare | grep -E "versionCode|versionName"
adb shell pm dump ca.uwindsor.acare | grep "flags=\["
# DEBUGGABLE present  -> live-reload/debug build, will not work standalone
# DEBUGGABLE absent   -> release build
```

Replacing it means uninstalling first — debug and release are signed with
different keys, so Android will not upgrade one to the other in place. That
clears app data, which here is only the mirrored session token:

```bash
adb uninstall ca.uwindsor.acare
adb install ACARE-<version>.apk
```

The app does **not** load its UI from Vercel, and never has. The assets are
bundled inside the APK and served from `https://localhost` in the WebView; only
the *API* goes over the network, to `VITE_API_URL`. Pointing the WebView at the
Vercel URL instead would make the app a bookmark — no offline start, no splash,
and a white screen whenever the network hiccups.

### Debugging

Connect the device, open `chrome://inspect` in desktop Chrome, and inspect the
WebView. This works because the `debugger`-loop guard in `ProtectedView.tsx` is
disabled on native — see `src/lib/platform.ts`.

### Building against a local backend

Two things get in the way of a plain-HTTP dev API, and both are already handled
for **debug builds only** — the release build stays strict.

1. **Cleartext is blocked.** `android/app/src/debug/` carries a network security
   config allowing HTTP to `10.0.2.2`, `localhost`, and the dev machine's LAN
   address. Add your own IP there if it changes (it is DHCP-assigned).
2. **Mixed content is blocked.** The default `https://localhost` WebView origin
   is a secure context, so its requests to `http://` are refused.
   `capacitor.config.ts` handles this automatically: if `VITE_API_URL` in
   `.env.mobile` is an `http://` URL, the bundled assets are served over
   `http://localhost` instead. Nothing to remember — point `.env.mobile` at the
   production `https://` URL and the secure origin comes back on its own.
   (`CAP_DEV_HTTP=1` forces it on, but should not be needed.)

Set `VITE_API_URL` in `.env.mobile` to the **LAN address** of the dev machine
(e.g. `http://10.190.22.209:8000`), not `localhost` — inside the WebView,
`localhost` is the app's own bundled assets. `http://10.0.2.2:8000` also works,
but only on the emulator.

Two things to check on the API side: uvicorn must bind `0.0.0.0` (not
`127.0.0.1`) for a device to reach it, and Windows Firewall must allow inbound
TCP on port 8000 for the private network.

The debug APK lands at
`android/app/build/outputs/apk/debug/app-debug.apk`. It is debug-signed, so a
later release-signed build cannot upgrade it in place — uninstall first.

---

## Shipping without a cable

Almost nothing needs a new APK. The app is a WebView around this same `apps/web`
build, so a change to `src/` is a **web bundle** the installed app can download
and swap in by itself — no USB, no reinstall, no "install unknown apps" prompt,
no asking staff to do anything. Merging to `main` is the whole ritual.

An APK is only required when the *native shell* changes: a new Capacitor plugin,
a permission, a manifest entry, a Capacitor or Gradle upgrade.

| You changed | What ships | Who acts |
|---|---|---|
| `src/`, styles, assets | OTA bundle, applied on next app launch | nobody |
| plugins, manifest, gradle, `capacitor.config.ts` | signed APK | install once per device |

### How it fits together

```
merge dev → main
   ├── Vercel redeploys the web app
   ├── Render redeploys the API
   └── .github/workflows/ota-bundle.yml
         ├── builds apps/web against .env.mobile
         ├── zips dist/ → GitHub Release asset  (bundle-<date>-<sha>)
         └── POSTs the pointer to /app-updates/bundles
                                    │
   tablet opens the app ────────────┘
         ├── POST /app-updates/check   {version_name, version_code, …}
         ├── downloads the zip, verifies SHA-256
         └── applies it on the next cold start
```

The zip lives on a **GitHub Release**, not on Render: Render's filesystem does
not survive the very deploy that would publish the bundle. The API stores only
the pointer — see `apps/api/app/models/app_bundle.py`. This does mean OTA depends
on the repo staying **public**, since devices fetch the asset unauthenticated. If
it ever goes private, switch the storage to a bucket or serve the bytes from the
API; nothing else changes.

The bundle is not a secret. It is byte-for-byte the frontend already served to
any browser that opens the Vercel site. What must not be forged is the pointer,
which is why registering one needs `APP_UPDATE_TOKEN` and delivery is
checksummed end to end.

### One-time setup

Repository → Settings → Secrets and variables → Actions:

| Secret | Used by | Value |
|---|---|---|
| `MOBILE_API_URL` | both workflows | `https://uwindsor-accs-7k3r.onrender.com` |
| `APP_UPDATE_TOKEN` | ota-bundle | any long random string; must match the API's env var |
| `ANDROID_KEYSTORE_BASE64` | release-apk | `base64 -w0 acare-release.jks` |
| `ANDROID_KEYSTORE_PASSWORD` | release-apk | from `keystore.properties` |
| `ANDROID_KEY_ALIAS` | release-apk | `acare` |
| `ANDROID_KEY_PASSWORD` | release-apk | from `keystore.properties` |
| `GOOGLE_SERVICES_JSON` | release-apk | contents of `android/app/google-services.json` (optional) |

Then set the same token on the Render dashboard as `APP_UPDATE_TOKEN`. Until it
is set, `/app-updates/bundles` returns 503 and CI cannot publish — a deployment
nobody has handed the secret to cannot have its update pointer rewritten.

Generate one with:

```powershell
python -c "import secrets; print(secrets.token_urlsafe(48))"
```

### Checking and controlling the channel

```
GET  /app-updates/status                      # is OTA configured? what is live?
GET  /app-updates/bundles                     # publish history, newest first
POST /app-updates/bundles/<version>/activate  # roll forward or back
POST /app-updates/bundles/deactivate          # halt the channel
```

`status` and the rest need chair or admin. **Rolling back a bad bundle is
re-activating the previous one** — every device picks it up on its next launch,
which is faster than any APK could be rebuilt and handed out. `APP_UPDATE_ENABLED=false`
on Render halts delivery fleet-wide without touching a bundle; devices keep
whatever they are running.

### The two ways this bites

- **Forgetting `notifyAppReady()`.** The plugin rolls a bundle back if it is not
  told the app booted (`appReadyTimeout`, 20s). That safety net is why a bad OTA
  cannot brick a tablet — and why dropping the call makes *every* update appear
  never to arrive. It lives in `src/lib/liveUpdate.ts`, called from
  `src/main.tsx` after the render.
- **A bundle that needs native code the installed APK lacks.** It white-screens,
  and a WebView with no working JS cannot fetch its own way out. `min_version_code`
  on each bundle is the guard: the API withholds a bundle from any APK below it,
  and an unreadable `versionCode` is treated as too old rather than assumed fine.
  After a native release, raise it — run the OTA workflow by hand with
  `min_version_code` set, or let the next push default it to the committed
  `versionCode`.

### Sanity-checking a device

`chrome://inspect`, or `adb logcat | grep CapgoUpdater`. A healthy cold start:

```
CapgoUpdater: Check for update via: https://…/app-updates/check
CapgoUpdater: Current bundle loaded successfully. ['notifyAppReady()' was called]
```

`Server error: 404` there means the API predates this feature — the app carries
on with its bundled assets, which is the intended failure mode.

---

## Cutting a release APK

Normally you do not: `.github/workflows/release-apk.yml` builds and signs this on
any push to `main` that touches `android/` or `capacitor.config.ts`, and attaches
it to a GitHub Release. It refuses to build if `versionCode` was not bumped past
the last release, so the "Android will not install over an equal version" failure
surfaces in CI rather than on a tablet. To build by hand anyway:

1. Bump `versionCode` (and usually `versionName`) in
   `android/app/build.gradle`. **`versionCode` must increase on every APK you
   hand out** — Android will not install over an equal or higher version.
2. Build:
   ```powershell
   cd apps/web
   npm run android:sync
   cd android
   $env:JAVA_HOME = "C:\Program Files\Android\Android Studio\jbr"
   ./gradlew assembleRelease
   ```
3. The APK lands at:
   ```
   apps/web/android/app/build/outputs/apk/release/app-release.apk
   ```
4. Distribute the file directly (shared drive, email, or hosted download).
   Staff installing it will need to allow "Install unknown apps" for whichever
   app delivers it.

---

## What differs from the web build

The UI is identical. Four behaviours are branched at runtime on
`isNative()` (`src/lib/platform.ts`), because they are browser-only APIs that do
nothing inside a WebView. The web path is unchanged in every case.

| Area | Web | Android |
|---|---|---|
| Export download (`src/lib/download.ts`) | `createObjectURL` + `<a download>` | Writes to the app cache via Filesystem, then opens the share sheet |
| Print report (`src/lib/printer.ts`) | `window.print()` | Android `PrintManager` over the live WebView, via the local `PrinterPlugin` |
| Anti-DevTools loop (`ProtectedView.tsx`) | 1s `debugger` interval | Disabled — pure battery drain, and it blocks `chrome://inspect` |
| Session token (`src/lib/session.ts`) | `localStorage` only | Mirrored to SharedPreferences and restored at startup |
| Notifications (`src/lib/push.ts`) | In-app bell only, polled once a minute | Bell **plus** system notifications over FCM, which arrive with the app closed |

Plus the Android hardware back button, handled by
`src/components/native/NativeBackHandler.tsx`: it walks the router history and
only exits the app from a landing screen, after a confirm tap.

### How push fits together

`src/components/native/PushRegistrar.tsx` ties the FCM registration to the
session — registering on sign-in and unregistering on sign-out — because the
token is stored against a *user* on the server. Registering at startup would have
nobody to attach it to, and leaving it attached after sign-out would deliver one
person's alerts to whoever picks the tablet up next.

The API pushes only alerts a sweep newly inserted, never ones it merely
re-worded. A quarantine countdown is rewritten every pass, and pushing those
would turn one condition into a buzz every fifteen minutes. Several new alerts
for the same user collapse into one digest entry.

Android splits the delivery job in half, and both halves are handled:

- **App backgrounded or closed** — FCM delivers, and Android posts the tray entry
  itself. No app code runs; having registered the token earlier is the whole
  contribution.
- **App foregrounded** — Android deliberately does *not* post a tray entry, and
  hands the message to the app instead. `pushNotificationReceived` re-posts it as
  a local notification, so the user is not left to notice the bell up to a
  minute later.

**Debugging a device that stays silent**, in the order worth checking:

1. `GET /notifications/push-status` — is the server configured at all?
2. Android Settings → Apps → ACARE → Notifications — was the runtime permission
   refused? The app asks once and does not nag.
3. `chrome://inspect` console — look for `FCM registration failed`, which almost
   always means `google-services.json` is missing or names the wrong package.
4. `db.device_tokens.find()` — a row with `disabled_at` set was rejected by FCM
   as permanently dead; `last_error` says why. Signing in again revives it.

### Notes for future work

- **Transport needed no backend change.** With `androidScheme: 'https'` the
  WebView origin is `https://localhost`, which already matches the CORS regex in
  `apps/api/app/main.py`. Do not enable Capacitor's `CapacitorHttp` bridge — it
  patches `fetch`/`XHR` globally and breaks the `responseType: 'blob'` the
  export endpoint depends on. (Push is the one feature that *did* need server
  work — it has to address a device that is not running anything. See the
  Firebase section above.)
- **Do not add `viewport-fit=cover`** to `index.html`. Apps targeting SDK 35+
  cannot opt out of edge-to-edge, and Capacitor's `SystemBars` plugin only pads
  the WebView for the status/gesture bars while that meta value is absent. The
  app has no `env(safe-area-inset-*)` handling, so adding it would push content
  under the status bar.
- **Over-the-air updates are implemented** — see "Shipping without a cable"
  above. The `versionCode` discipline is what that channel keys off, via each
  bundle's `min_version_code`.
