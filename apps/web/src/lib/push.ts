import { LocalNotifications } from '@capacitor/local-notifications';
import { PushNotifications, type PushNotificationSchema } from '@capacitor/push-notifications';
import type { PluginListenerHandle } from '@capacitor/core';

import { registerPushDevice, unregisterPushDevice } from './api';
import { isNative } from './platform';

/**
 * Android system notifications for the alerts the feed already carries.
 *
 * The in-app bell polls once a minute, which only works while something is
 * running to do the polling. This is the path for everything else: the app
 * backgrounded, the phone in a pocket, the 3 PM deadline passing while nobody
 * is looking at a screen.
 *
 * Two mechanisms, because Android splits the job in half:
 *
 * - **Backgrounded or closed** — FCM delivers the message and Android posts the
 *   tray entry itself, without this app running any code. Nothing here is
 *   involved beyond having registered the token earlier.
 * - **Foregrounded** — Android deliberately does *not* post a tray entry;
 *   it hands the message to the app instead, on the assumption the app will
 *   show it in its own UI. The bell does show it, but a minute later and only
 *   if the user happens to be looking at it, so `pushNotificationReceived`
 *   re-posts the message as a local notification to close that gap.
 *
 * Everything is a no-op on web. The browser build never calls into these
 * plugins, so the Vercel deployment is untouched by this file.
 */

/** Must match FCM_ANDROID_CHANNEL_ID on the API — Android 8+ silently drops a
 *  message naming a channel that does not exist. */
const CHANNEL_ID = 'acare-alerts';

/** Local notifications need a numeric id; FCM keys are strings. */
const localIdFor = (key: string): number => {
  let hash = 0;
  for (let i = 0; i < key.length; i += 1) {
    hash = (hash << 5) - hash + key.charCodeAt(i);
    hash |= 0;
  }
  // Android treats id 0 as "no id" and will not replace it predictably.
  return Math.abs(hash) || 1;
};

let listeners: PluginListenerHandle[] = [];
let currentToken: string | null = null;
let starting = false;

/** Where a tapped notification should land, defaulting to the full feed. */
const linkFromData = (data: unknown): string => {
  const link = (data as Record<string, unknown> | undefined)?.link;
  return typeof link === 'string' && link.startsWith('/') ? link : '/staff/notifications';
};

const showForeground = async (notification: PushNotificationSchema): Promise<void> => {
  const data = notification.data ?? {};
  const key = typeof data.key === 'string' && data.key ? data.key : `push-${Date.now()}`;
  try {
    await LocalNotifications.schedule({
      notifications: [{
        id: localIdFor(key),
        channelId: CHANNEL_ID,
        title: notification.title ?? 'ACARE',
        body: notification.body ?? '',
        // Carried through so a tap on this local copy routes exactly as a tap
        // on the tray entry Android would have posted itself.
        extra: data,
      }],
    });
  } catch (err) {
    // A failure here costs the user one buzz, not the alert — the bell still
    // has it. Never let it escape into the caller.
    console.error('Could not post the foreground notification', err);
  }
};

/**
 * Ask for notification permission, register with FCM, and hand the token to the API.
 *
 * Safe to call repeatedly: Capacitor issues the same token on every launch and
 * the API treats registration as idempotent. `onOpen` is invoked with the target
 * route when the user taps a notification.
 */
export const startPush = async (onOpen: (link: string) => void): Promise<void> => {
  if (!isNative() || starting || listeners.length > 0) return;
  starting = true;

  try {
    // Create the channel before requesting permission: the permission sheet on
    // Android 13+ is per-app, but a message naming a missing channel is dropped
    // without any error, which is far harder to diagnose than a refused prompt.
    await PushNotifications.createChannel({
      id: CHANNEL_ID,
      name: 'Facility alerts',
      description: 'Missed water quality logs, quarantine windows, and AUPP expiry',
      // IMPORTANCE_HIGH — these are deadline and biosecurity alerts, which is
      // the case a heads-up notification exists for.
      importance: 5,
      visibility: 1,
      vibration: true,
    });

    let permission = await PushNotifications.checkPermissions();
    if (permission.receive === 'prompt' || permission.receive === 'prompt-with-rationale') {
      permission = await PushNotifications.requestPermissions();
    }
    if (permission.receive !== 'granted') {
      // The user said no. The in-app feed is unaffected, so there is nothing to
      // recover from and nothing worth nagging about.
      starting = false;
      return;
    }

    // The local-notifications plugin keeps its own permission state on some
    // Android versions, and the foreground path is useless without it.
    const localPermission = await LocalNotifications.checkPermissions();
    if (localPermission.display !== 'granted') {
      await LocalNotifications.requestPermissions();
    }

    listeners.push(
      await PushNotifications.addListener('registration', async (token) => {
        currentToken = token.value;
        try {
          await registerPushDevice({ token: token.value, platform: 'android' });
        } catch (err) {
          // Leaves currentToken set so a later sign-out still tries to clean up.
          console.error('Could not register this device for push', err);
        }
      }),
    );

    listeners.push(
      await PushNotifications.addListener('registrationError', (err) => {
        console.error('FCM registration failed', err);
      }),
    );

    listeners.push(
      await PushNotifications.addListener('pushNotificationReceived', (notification) => {
        void showForeground(notification);
      }),
    );

    listeners.push(
      await PushNotifications.addListener('pushNotificationActionPerformed', (action) => {
        onOpen(linkFromData(action.notification.data));
      }),
    );

    listeners.push(
      await LocalNotifications.addListener('localNotificationActionPerformed', (action) => {
        onOpen(linkFromData(action.notification.extra));
      }),
    );

    await PushNotifications.register();
  } catch (err) {
    console.error('Push setup failed', err);
  } finally {
    starting = false;
  }
};

/**
 * Detach listeners and drop this device's registration on the server.
 *
 * Called on sign-out. Without the server-side half, a shared tablet keeps
 * delivering the previous user's alerts until someone else signs in on it.
 */
export const stopPush = async (): Promise<void> => {
  if (!isNative()) return;

  const token = currentToken;
  currentToken = null;

  for (const listener of listeners) {
    try {
      await listener.remove();
    } catch {
      // Plugin already torn down; nothing to detach.
    }
  }
  listeners = [];

  if (token) {
    try {
      await unregisterPushDevice(token);
    } catch (err) {
      // Signing out must not be blocked by a network failure. The device stays
      // registered server-side until the next user signs in and claims it.
      console.error('Could not unregister this device for push', err);
    }
  }
};
