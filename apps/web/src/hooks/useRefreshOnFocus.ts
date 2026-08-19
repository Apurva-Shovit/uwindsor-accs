import { useEffect, useRef } from 'react';

/**
 * Re-run a loader when the user comes back to the screen.
 *
 * The data-entry pages hold server state in plain useState, loaded once in a
 * mount-only effect. On a shared tablet that screen can sit open for hours
 * while someone else records deaths or moves fish, and the counts on it -- the
 * ones the live preview and the client-side validation are computed from --
 * stay at whatever they were when the page loaded.
 *
 * Since every write path became atomic, a stale screen can no longer corrupt
 * anything: the worst case is a 409 telling the user what the tank really
 * holds. This is what stops them running into that in the first place.
 *
 * Both events are listened for because neither covers the case alone: `focus`
 * misses returning to an already-focused tab, and `visibilitychange` is what
 * fires when the Capacitor WebView resumes. They often fire together, hence
 * the interval floor.
 */
export function useRefreshOnFocus(refresh: () => void, minIntervalMs = 2000): void {
  // Held in a ref so a caller passing an inline arrow does not re-subscribe on
  // every render.
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;

  const lastRun = useRef(0);

  useEffect(() => {
    const run = () => {
      if (document.visibilityState === 'hidden') return;
      const now = Date.now();
      if (now - lastRun.current < minIntervalMs) return;
      lastRun.current = now;
      refreshRef.current();
    };

    window.addEventListener('focus', run);
    document.addEventListener('visibilitychange', run);
    return () => {
      window.removeEventListener('focus', run);
      document.removeEventListener('visibilitychange', run);
    };
  }, [minIntervalMs]);
}
