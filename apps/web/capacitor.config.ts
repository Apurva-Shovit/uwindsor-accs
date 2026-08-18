import { readFileSync } from 'fs';
import { join } from 'path';
import type { CapacitorConfig } from '@capacitor/cli';

/**
 * A https://localhost page is a secure context, so the WebView refuses its
 * requests to a plain-HTTP API as mixed content. Builds pointed at an http://
 * dev backend therefore have to serve the bundled assets over http://localhost
 * instead.
 *
 * That is derived from VITE_API_URL rather than left to a flag someone has to
 * remember: getting it wrong produces an app that launches fine and then fails
 * every request. Both origins match the API's CORS allow-list, and
 * http://localhost is still a trustworthy origin to Chromium, so nothing else
 * about the app changes. CAP_DEV_HTTP=1 forces it on if ever needed.
 */
function usesHttpBackend(): boolean {
  if (process.env.CAP_DEV_HTTP === '1') return true;
  try {
    const env = readFileSync(join(__dirname, '.env.mobile'), 'utf8');
    return /^\s*VITE_API_URL\s*=\s*http:\/\//m.test(env);
  } catch {
    return false; // No .env.mobile — assume the production https API.
  }
}

const devHttp = usesHttpBackend();

/**
 * Live reload: point the WebView at the Vite dev server instead of the assets
 * bundled by `cap sync`, so a save in src/ lands in the app immediately and no
 * reinstall is needed. Off unless CAP_LIVE_RELOAD=1, so ordinary and release
 * builds are untouched.
 *
 * 127.0.0.1 rather than the dev machine's LAN address: uwinsecure isolates
 * clients, so the device cannot reach this machine over Wi-Fi on campus.
 * `npm run android:live` tunnels the port over USB with `adb reverse` instead.
 * It has to be 127.0.0.1 and not localhost — Capacitor serves its own assets
 * from localhost and would intercept the request. Chromium still treats
 * 127.0.0.1 as a trustworthy origin, so nothing about the page's capabilities
 * changes. Only debug builds permit cleartext to it (see
 * android/app/src/debug/res/xml/network_security_config.xml), which is why the
 * live-reload APK is a debug one.
 */
const liveReload = process.env.CAP_LIVE_RELOAD === '1';
const liveReloadPort = process.env.CAP_LIVE_RELOAD_PORT ?? '5173';

const config: CapacitorConfig = {
  appId: 'ca.uwindsor.acare',
  appName: 'ACARE',
  webDir: 'dist',
  // Serving the bundled assets over https://localhost keeps the WebView origin
  // inside the API's existing CORS allow-list (see apps/api/app/main.py), so no
  // backend change is needed for the Android build.
  server: {
    androidScheme: devHttp ? 'http' : 'https',
    ...(liveReload
      ? { url: `http://127.0.0.1:${liveReloadPort}`, cleartext: true }
      : {}),
  },
  android: {
    allowMixedContent: false,
  },
  plugins: {
    // LIGHT = dark icons, to sit on the white window background set in
    // android/app/src/main/res/values/styles.xml. Leaving insetsHandling at its
    // default keeps Capacitor padding the WebView natively for the status and
    // gesture bars, so the existing layout renders unchanged — the app does not
    // use env(safe-area-inset-*), so it must not be handed raw insets.
    SystemBars: {
      style: 'LIGHT',
    },
    SplashScreen: {
      launchAutoHide: true,
      launchShowDuration: 1000,
      backgroundColor: '#FFFFFF',
      androidSplashResourceName: 'splash',
      androidScaleType: 'CENTER_INSIDE',
    },
  },
};

export default config;
