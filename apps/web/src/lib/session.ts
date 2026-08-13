import { Preferences } from '@capacitor/preferences';
import { isNative } from './platform';

const TOKEN_KEY = 'token';

/**
 * The JWT lives in localStorage, which both the axios interceptor and
 * AuthContext read synchronously. WebView storage can be cleared by Android
 * when it reclaims space, which would silently log staff out, so on native the
 * token is mirrored into SharedPreferences (via Capacitor Preferences) and
 * restored at startup by `restoreSession`.
 *
 * Mirroring rather than migrating keeps every read synchronous and leaves the
 * web behaviour exactly as it was.
 */
export const getToken = (): string | null => localStorage.getItem(TOKEN_KEY);

export const setToken = (token: string): void => {
  localStorage.setItem(TOKEN_KEY, token);
  if (isNative()) void Preferences.set({ key: TOKEN_KEY, value: token });
};

export const clearToken = (): void => {
  localStorage.removeItem(TOKEN_KEY);
  if (isNative()) void Preferences.remove({ key: TOKEN_KEY });
};

/** Rehydrates localStorage from the native store. Await before rendering. */
export const restoreSession = async (): Promise<void> => {
  if (!isNative() || localStorage.getItem(TOKEN_KEY)) return;
  try {
    const { value } = await Preferences.get({ key: TOKEN_KEY });
    if (value) localStorage.setItem(TOKEN_KEY, value);
  } catch (err) {
    console.error('Failed to restore session', err);
  }
};
