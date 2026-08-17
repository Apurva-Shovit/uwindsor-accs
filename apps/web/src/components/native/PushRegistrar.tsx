import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';

import { useAuth } from '../../context/AuthContext';
import { isNative } from '../../lib/platform';
import { primeNotifications, startPush, stopPush } from '../../lib/push';

/**
 * Binds this device's FCM registration to the signed-in user, for as long as
 * they are signed in.
 *
 * Registration is deliberately tied to the session rather than done once at
 * startup: the token is stored against a user on the server, so registering
 * before anyone has signed in would have nothing to attach it to, and leaving it
 * attached after sign-out would deliver one user's alerts to the next person
 * holding a shared tablet.
 *
 * Renders nothing, and does nothing at all on the web.
 */
export const PushRegistrar: React.FC = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const userId = user?.id ?? null;

  // Held in refs, and deliberately kept out of the effect's dependencies.
  // `useNavigate` does not return a referentially stable function, so depending
  // on it tore the whole registration down and rebuilt it on essentially every
  // render — the device re-registered in a tight loop and the token POST never
  // settled. The listener is registered once per session and reads the current
  // values through these instead. NativeBackHandler does the same for the same
  // reason.
  const navigateRef = React.useRef(navigate);
  navigateRef.current = navigate;
  const queryClientRef = React.useRef(queryClient);
  queryClientRef.current = queryClient;

  // Ask on first launch, before anyone signs in, so granting notifications is
  // part of setting the app up rather than a sheet that ambushes the user
  // mid-login. Android only ever shows it once, so this is a no-op afterwards.
  React.useEffect(() => {
    void primeNotifications();
  }, []);

  React.useEffect(() => {
    if (!isNative() || !userId) return;

    void startPush((link) => {
      // The tapped alert is by definition news the cached feed predates, and the
      // user is about to look at the screen that renders it.
      void queryClientRef.current.invalidateQueries({ queryKey: ['notifications'] });
      navigateRef.current(link);
    });

    // Runs on sign-out and on a user switch, which is exactly when the server
    // needs to stop addressing this device as the previous user.
    return () => {
      void stopPush();
    };
  }, [userId]);

  return null;
};
