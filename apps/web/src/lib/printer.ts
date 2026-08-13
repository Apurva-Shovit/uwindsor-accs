import { registerPlugin } from '@capacitor/core';
import { App as CapacitorApp } from '@capacitor/app';

interface PrinterPlugin {
  print(options?: { name?: string }): Promise<void>;
}

/** Local Android plugin — see android/app/src/main/java/ca/uwindsor/acare/PrinterPlugin.java */
const Printer = registerPlugin<PrinterPlugin>('Printer');

/**
 * Starts an Android print job and runs `onFinished` once the user is back in
 * the app.
 *
 * Android renders the print document lazily — the WebView is only rasterised
 * after the user confirms in the system print dialog, which is a separate
 * activity. Any print-only DOM (the `authorized-print` body class, the cloned
 * report portal) therefore has to survive past this call and can only be torn
 * down when the app returns to the foreground. Tearing it down on a fixed timer
 * the way the web path does would print the ordinary screen instead.
 */
export async function nativePrint(jobName: string, onFinished: () => void): Promise<void> {
  let done = false;
  const finishOnce = () => {
    if (done) return;
    done = true;
    void handle.remove();
    onFinished();
  };

  const handle = await CapacitorApp.addListener('appStateChange', ({ isActive }) => {
    if (isActive) finishOnce();
  });

  try {
    await Printer.print({ name: jobName });
  } catch (err) {
    finishOnce();
    throw err;
  }
}
