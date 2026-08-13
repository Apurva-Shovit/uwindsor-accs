import { Directory, Filesystem } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { isNative } from './platform';

/**
 * Hands a downloaded blob to the user.
 *
 * On the web this is the usual object-URL + synthetic anchor click. Inside the
 * Android WebView that does nothing at all — `a.download` is not honoured and
 * `blob:` URLs cannot be written to storage — so the native branch writes the
 * bytes to the app's cache directory and opens the system share sheet, letting
 * the user route the file to Drive, email, or Files.
 *
 * Cache (rather than Documents) is deliberate: it needs no runtime storage
 * permission on Android 10+ and the OS reclaims the space on its own. The
 * export endpoint requires an Authorization header, so the URL cannot simply be
 * handed off to the system browser — the bytes have to be fetched in-app.
 *
 * The blob carries its own MIME type and the filename its extension, which is
 * all both branches need to hand the file off correctly.
 */
export async function saveFile(blob: Blob, filename: string): Promise<void> {
  if (!isNative()) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    return;
  }

  const base64 = await blobToBase64(blob);
  const { uri } = await Filesystem.writeFile({
    path: filename,
    data: base64,
    directory: Directory.Cache,
  });

  await Share.share({
    title: filename,
    url: uri,
    dialogTitle: 'Save or share export',
  });
}

/** Filesystem.writeFile expects bare base64, without the data-URL prefix. */
function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error('Failed to read file data'));
    reader.onload = () => {
      const result = reader.result as string;
      resolve(result.slice(result.indexOf(',') + 1));
    };
    reader.readAsDataURL(blob);
  });
}
