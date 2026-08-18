/**
 * Live-reload driver for the Android app.
 *
 *   node scripts/android-live.mjs             # every session: tunnel + dev server
 *   node scripts/android-live.mjs --install   # once, and after native changes
 *
 * See ANDROID.md > "Live reload on a device" for the why.
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { connect } from 'node:net';
import { join } from 'node:path';

const PORT = process.env.CAP_LIVE_RELOAD_PORT ?? '5173';
const HOST = '127.0.0.1';
const install = process.argv.includes('--install');

/**
 * adb is not on PATH on this machine, and the Android SDK location differs per
 * OS, so resolve it rather than assuming. ANDROID_HOME wins if it is set.
 */
function findAdb() {
  const exe = process.platform === 'win32' ? 'adb.exe' : 'adb';
  const roots = [
    process.env.ANDROID_HOME,
    process.env.ANDROID_SDK_ROOT,
    process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, 'Android', 'Sdk'),
    process.env.HOME && join(process.env.HOME, 'Library', 'Android', 'sdk'),
    process.env.HOME && join(process.env.HOME, 'Android', 'Sdk'),
  ].filter(Boolean);

  for (const root of roots) {
    const candidate = join(root, 'platform-tools', exe);
    if (existsSync(candidate)) return candidate;
  }
  // Fall back to PATH; the caller reports the failure if it is not there either.
  return exe;
}

const adb = findAdb();

function adbRun(args, { check = true } = {}) {
  const res = spawnSync(adb, args, { encoding: 'utf8' });
  if (res.error) {
    die(`could not run adb (${adb}): ${res.error.message}\n` +
        'Set ANDROID_HOME to your Android SDK directory.');
  }
  if (check && res.status !== 0) {
    die(`adb ${args.join(' ')} failed:\n${(res.stderr || res.stdout).trim()}`);
  }
  return res.stdout ?? '';
}

function die(message) {
  console.error(`\n  android-live: ${message}\n`);
  process.exit(1);
}

/** Names of devices in the `device` state — excludes `unauthorized`/`offline`. */
function connectedDevices() {
  return adbRun(['devices'])
    .split('\n')
    .slice(1)
    .map((line) => line.trim().split(/\s+/))
    .filter(([serial, state]) => serial && state === 'device')
    .map(([serial]) => serial);
}

/** Resolves once something is listening on the dev-server port. */
function waitForPort(timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const socket = connect({ host: HOST, port: Number(PORT) });
      socket.once('connect', () => { socket.destroy(); resolve(); });
      socket.once('error', () => {
        socket.destroy();
        if (Date.now() > deadline) reject(new Error(`nothing listening on ${HOST}:${PORT}`));
        else setTimeout(attempt, 250);
      });
    };
    attempt();
  });
}

/**
 * `.env.mobile` may point at a local backend over the same USB tunnel (see
 * ANDROID.md). If it does, that port needs an `adb reverse` as well, otherwise
 * every request from the app fails while the page itself loads fine.
 */
function loopbackApiPort() {
  try {
    const env = readFileSync('.env.mobile', 'utf8');
    const match = env.match(/^\s*VITE_API_URL\s*=\s*http:\/\/127\.0\.0\.1:(\d+)/m);
    return match?.[1] ?? null;
  } catch {
    return null;
  }
}

const devices = connectedDevices();
if (devices.length === 0) {
  die('no device connected. Plug the device in, unlock it, and accept the USB debugging prompt.');
}

// The tunnel does not survive an unplug, so it is re-established every run.
// One `adb reverse` per device: the app resolves 127.0.0.1 on the device, and
// the daemon forwards it back over USB to the dev server on this machine.
const apiPort = loopbackApiPort();
for (const serial of devices) {
  for (const port of [PORT, apiPort].filter(Boolean)) {
    adbRun(['-s', serial, 'reverse', `tcp:${port}`, `tcp:${port}`]);
    console.log(`  android-live: ${serial} -> ${HOST}:${port} tunnelled over USB`);
  }
}

const env = { ...process.env, CAP_LIVE_RELOAD: '1', CAP_LIVE_RELOAD_PORT: PORT };

// --mode mobile: without it Vite ignores .env.mobile and VITE_API_URL falls back
// to http://localhost:8000, which inside the WebView is the *device's* own
// loopback, not this machine's. The APK and the dev server must agree on the API.
// --strictPort: the URL is baked into the APK's capacitor.config.json, so a
// silent fallback to another port would leave the app pointed at nothing.
const vite = spawn(
  'npx',
  ['vite', '--mode', 'mobile', '--host', HOST, '--port', PORT, '--strictPort'],
  { env, stdio: 'inherit', shell: process.platform === 'win32' },
);
vite.on('exit', (code) => process.exit(code ?? 0));

if (install) {
  // Sync first so capacitor.config.json in the APK carries server.url, then
  // install. Debug build: only the debug variant permits cleartext to
  // 127.0.0.1, and `cap run` builds debug by default.
  waitForPort()
    .then(() => {
      console.log('\n  android-live: syncing and installing the debug APK...\n');
      const run = spawnSync(
        'npx',
        ['cap', 'run', 'android', '--target', devices[0]],
        { env, stdio: 'inherit', shell: process.platform === 'win32' },
      );
      if (run.status !== 0) {
        console.error(
          '\n  android-live: install failed. If the message mentions signatures,\n' +
          '  a release-signed build is already installed — `adb uninstall ca.uwindsor.acare`\n' +
          '  first (this clears the app\'s data), then re-run.\n',
        );
      }
    })
    .catch((err) => console.error(`\n  android-live: ${err.message}\n`));
}
