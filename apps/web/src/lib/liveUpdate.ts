import { CapacitorUpdater } from '@capgo/capacitor-updater';
import { isNative } from './platform';

/**
 * Over-the-air web-bundle updates for the Android app.
 *
 * The APK is a WebView around this same bundle, so almost everything shipped
 * here — components, styles, API calls — can be swapped in without reinstalling
 * anything. The plugin downloads the new bundle in the background and applies
 * it the next time the app is launched cold; the server side is
 * apps/api/app/routers/app_updates.py.
 *
 * Nothing in this file runs on the web. The Vercel deployment updates by being
 * redeployed, and calling into the plugin there would only log errors.
 */

/**
 * Tell the plugin the bundle booted successfully.
 *
 * This is not optional bookkeeping. After applying a new bundle the plugin
 * starts a timer, and if `notifyAppReady()` has not been called when it fires,
 * it assumes the bundle broke on launch and rolls the device back to the
 * previous one. That safety net is the reason a bad OTA cannot brick a tablet —
 * but it also means that forgetting this call makes *every* update roll itself
 * back, which looks exactly like the update never arriving.
 *
 * It is called after React has mounted rather than at module scope, so the
 * signal means "this bundle rendered", not merely "this file was parsed".
 */
export async function notifyAppReady(): Promise<void> {
  if (!isNative()) return;
  try {
    await CapacitorUpdater.notifyAppReady();
  } catch (err) {
    // Swallow: on a build with the plugin absent or misconfigured, failing to
    // confirm readiness must not take the app down with it.
    console.warn('Live update: notifyAppReady failed', err);
  }
}

/**
 * The bundle this device is currently running, for support and for the About
 * screen. `builtin` means it is on the assets that shipped inside the APK.
 */
export async function currentBundleVersion(): Promise<string | null> {
  if (!isNative()) return null;
  try {
    const bundle = await CapacitorUpdater.current();
    return bundle?.bundle?.version ?? null;
  } catch {
    return null;
  }
}
