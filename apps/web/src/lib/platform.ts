import { Capacitor } from '@capacitor/core';

/**
 * True when running inside the Android APK's WebView, false in a browser.
 *
 * Detection is deliberately at runtime rather than a build-time flag, so a
 * single bundle behaves correctly in both places and the Vercel deployment is
 * unaffected by anything in this file.
 */
export const isNative = () => Capacitor.isNativePlatform();
