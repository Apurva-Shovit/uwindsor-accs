import { Preferences } from '@capacitor/preferences';
import { isNative } from './platform';

const TOKEN_KEY = 'token';

/**
 * Where the JWT lives depends on whether the user ticked "Remember me":
 *
 * - Remembered  -> localStorage, mirrored to SharedPreferences on native. The
 *   session survives closing the browser or force-stopping the app, up to the
 *   30-day token the API issues for this case.
 * - Not remembered -> sessionStorage only. The browser clears it when the tab
 *   closes, and the WebView clears it when the app is destroyed, so the session
 *   ends with the app. The API separately caps these tokens at 12 hours.
 *
 * The native mirror exists because Android can clear WebView storage when it
 * reclaims space, which would otherwise log staff out at random. It is only
 * written for remembered sessions — mirroring an unremembered token would
 * defeat the point of not remembering it.
 *
 * Reads stay synchronous because the axios interceptor and AuthContext both
 * call getToken() inline; only the startup rehydrate is async.
 */
export const getToken = (): string | null =>
  localStorage.getItem(TOKEN_KEY) ?? sessionStorage.getItem(TOKEN_KEY);

export const setToken = (token: string, remember: boolean): void => {
  clearToken();
  if (remember) {
    localStorage.setItem(TOKEN_KEY, token);
    if (isNative()) void Preferences.set({ key: TOKEN_KEY, value: token });
  } else {
    sessionStorage.setItem(TOKEN_KEY, token);
  }
};

export const clearToken = (): void => {
  localStorage.removeItem(TOKEN_KEY);
  sessionStorage.removeItem(TOKEN_KEY);
  if (isNative()) void Preferences.remove({ key: TOKEN_KEY });
};

/** Rehydrates a remembered session from the native store. Await before rendering. */
export const restoreSession = async (): Promise<void> => {
  if (!isNative() || getToken()) return;
  try {
    const { value } = await Preferences.get({ key: TOKEN_KEY });
    if (value) localStorage.setItem(TOKEN_KEY, value);
  } catch (err) {
    console.error('Failed to restore session', err);
  }
};
