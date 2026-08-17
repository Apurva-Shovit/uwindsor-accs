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

/**
 * Bumped by every teardown. `startPush` awaits several native round-trips, and a
 * sign-out landing partway through would otherwise let the rest of the setup
 * finish afterwards — attaching listeners and registering a device that nothing
 * will ever unregister. Each setup captures the value on entry and abandons its
 * work the moment it no longer matches.
 */
let generation = 0;

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
 * Create the notification channel and get the OS permission settled.
 *
 * Split out from `startPush` and called at app startup, before anyone has
 * signed in, so the permission sheet is part of first launch rather than
 * something that appears later attached to signing in. Registration still waits
 * for a session — the token has to be stored against a user — but the prompt no
 * longer does.
 *
 * Returns whether notifications may actually be shown. Safe to call repeatedly:
 * once the choice is made, `checkPermissions` answers from it and no sheet is
 * raised again.
 */
export const primeNotifications = async (): Promise<boolean> => {
  if (!isNative()) return false;

  try {
    // The channel comes first: the permission sheet on Android 13+ is per-app,
    // but a message naming a channel that does not exist is dropped without any
    // error at all, which is far harder to diagnose than a refused prompt.
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
      return false;
    }

    // The local-notifications plugin keeps its own permission state on some
    // Android versions, and the foreground path is useless without it.
    const localPermission = await LocalNotifications.checkPermissions();
    if (localPermission.display !== 'granted') {
      await LocalNotifications.requestPermissions();
    }
    return true;
  } catch (err) {
    console.error('Could not set up notifications', err);
    return false;
  }
};

/**
 * Register with FCM and hand the token to the API.
 *
 * Safe to call repeatedly: Capacitor issues the same token on every launch and
 * the API treats registration as idempotent. `onOpen` is invoked with the target
 * route when the user taps a notification.
 */
export const startPush = async (onOpen: (link: string) => void): Promise<void> => {
  if (!isNative() || starting || listeners.length > 0) return;
  starting = true;

  const mine = generation;
  const superseded = () => generation !== mine;

  try {
    // Idempotent — startup already ran this, so it only re-checks the answer
    // rather than prompting again. Repeated here because a session can begin
    // without startup having completed, and registering into a revoked
    // permission would leave a device the server pushes to for nothing.
    const allowed = await primeNotifications();
    if (superseded() || !allowed) return;

    listeners.push(
      await PushNotifications.addListener('registration', async (token) => {
        if (superseded()) return;
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

    if (superseded()) return;
    await PushNotifications.register();
  } catch (err) {
    console.error('Push setup failed', err);
  } finally {
    starting = false;
    // A teardown that raced this setup found nothing to detach, so whatever was
    // attached in the meantime has to be cleared up here instead.
    if (superseded() && listeners.length > 0) void stopPush();
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

  // Invalidates any setup still in flight before anything else is touched.
  generation += 1;

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
