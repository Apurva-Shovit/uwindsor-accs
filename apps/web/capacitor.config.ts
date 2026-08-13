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

const config: CapacitorConfig = {
  appId: 'ca.uwindsor.acare',
  appName: 'ACARE',
  webDir: 'dist',
  // Serving the bundled assets over https://localhost keeps the WebView origin
  // inside the API's existing CORS allow-list (see apps/api/app/main.py), so no
  // backend change is needed for the Android build.
  server: {
    androidScheme: devHttp ? 'http' : 'https',
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
