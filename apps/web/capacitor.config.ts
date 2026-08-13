import type { CapacitorConfig } from '@capacitor/cli';

// Builds pointed at a plain-HTTP dev backend must set CAP_DEV_HTTP=1. A
// https://localhost page is a secure context, so the WebView blocks its requests
// to http:// as mixed content; serving the bundled assets over http://localhost
// instead avoids that. Both origins match the API's CORS allow-list, and
// http://localhost is still a trustworthy origin to Chromium, so nothing else
// about the app changes. Never set it for a distributable build.
const devHttp = process.env.CAP_DEV_HTTP === '1';

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
