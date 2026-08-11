import { useCallback, useSyncExternalStore } from 'react';

/** Tailwind's `lg` breakpoint — the single source of truth for the app shell. */
export const DESKTOP_QUERY = '(min-width: 1024px)';

export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      const mql = window.matchMedia(query);
      mql.addEventListener('change', onStoreChange);
      return () => mql.removeEventListener('change', onStoreChange);
    },
    [query]
  );

  // getSnapshot runs synchronously during the first render, so the very first
  // painted DOM already reflects the right breakpoint (no flash of wrong state).
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    () => true
  );
}

/** True at >= 1024px — the layout that must render exactly as it always has. */
export function useIsDesktop(): boolean {
  return useMediaQuery(DESKTOP_QUERY);
}
