import React from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { App as CapacitorApp } from '@capacitor/app';
import { isNative } from '../../lib/platform';

/**
 * Routes the Android hardware back button through react-router.
 *
 * Capacitor's default is to close the app on any back press, which on a
 * multi-screen app means one stray tap drops staff out of a half-filled log
 * entry. Instead, back walks the router history and only exits from a landing
 * screen, behind a confirm tap.
 *
 * Renders nothing on the web.
 */
const ROOT_ROUTES = ['/login', '/signup', '/pending-approval', '/staff/tanks', '/admin/dashboard'];
const EXIT_CONFIRM_MS = 2000;

export const NativeBackHandler: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const [showExitHint, setShowExitHint] = React.useState(false);

  // Kept in a ref so the listener, registered once, always sees the live path.
  const pathnameRef = React.useRef(location.pathname);
  pathnameRef.current = location.pathname;

  React.useEffect(() => {
    if (!isNative()) return;

    let exitArmedUntil = 0;
    let hintTimer: ReturnType<typeof setTimeout> | undefined;

    const listener = CapacitorApp.addListener('backButton', ({ canGoBack }) => {
      const atRoot = ROOT_ROUTES.includes(pathnameRef.current);

      if (!atRoot && canGoBack) {
        navigate(-1);
        return;
      }

      if (Date.now() < exitArmedUntil) {
        void CapacitorApp.exitApp();
        return;
      }

      exitArmedUntil = Date.now() + EXIT_CONFIRM_MS;
      setShowExitHint(true);
      clearTimeout(hintTimer);
      hintTimer = setTimeout(() => setShowExitHint(false), EXIT_CONFIRM_MS);
    });

    return () => {
      clearTimeout(hintTimer);
      void listener.then((handle) => handle.remove());
    };
  }, [navigate]);

  if (!showExitHint) return null;

  return (
    <div className="fixed bottom-8 left-1/2 -translate-x-1/2 z-50 pointer-events-none">
      <div className="bg-textPrimary/90 text-white text-sm font-medium px-4 py-2 rounded-full shadow-lg">
        Press back again to exit
      </div>
    </div>
  );
};
