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

### 4. Release keystore

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

Anything that changes `src/`, `capacitor.config.ts`, or the installed plugins
needs an `android:sync` before it shows up in the app.

### Debugging

Connect the device, open `chrome://inspect` in desktop Chrome, and inspect the
WebView. This works because the `debugger`-loop guard in `ProtectedView.tsx` is
disabled on native — see `src/lib/platform.ts`.

### Local API

The release build blocks cleartext HTTP. To point an emulator at a local API
over plain HTTP you need a debug-only network security config; do not relax
`usesCleartextTraffic` on the release build.

---

## Cutting a release APK

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

Plus the Android hardware back button, handled by
`src/components/native/NativeBackHandler.tsx`: it walks the router history and
only exits the app from a landing screen, after a confirm tap.

### Notes for future work

- **No backend change was needed.** With `androidScheme: 'https'` the WebView
  origin is `https://localhost`, which already matches the CORS regex in
  `apps/api/app/main.py`. Do not enable Capacitor's `CapacitorHttp` bridge — it
  patches `fetch`/`XHR` globally and breaks the `responseType: 'blob'` the
  export endpoint depends on.
- **Do not add `viewport-fit=cover`** to `index.html`. Apps targeting SDK 35+
  cannot opt out of edge-to-edge, and Capacitor's `SystemBars` plugin only pads
  the WebView for the status/gesture bars while that meta value is absent. The
  app has no `env(safe-area-inset-*)` handling, so adding it would push content
  under the status bar.
- **Over-the-air updates** can be layered on later without rework: bundled
  assets are exactly the baseline that Capacitor Live Updates / capgo patch.
  It is a plugin, a config block, and an upload step — no React or native
  restructuring. The `versionCode` discipline above is what such a channel keys
  off, which is why it matters now.
