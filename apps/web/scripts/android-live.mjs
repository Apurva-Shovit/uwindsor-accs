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
const APP_ID = 'ca.uwindsor.acare';
const install = process.argv.includes('--install');
const win = process.platform === 'win32';
const androidDir = join(process.cwd(), 'android');

function die(message) {
  console.error(`\n  android-live: ${message}\n`);
  process.exit(1);
}

/**
 * The SDK is not on PATH on every machine and its location differs per OS, so
 * resolve it rather than assuming. Gradle needs it too — without ANDROID_HOME or
 * android/local.properties (gitignored, and only Android Studio writes one), AGP
 * fails with "SDK location not found" — so the root found here is handed to the
 * build below.
 */
function findSdkRoot() {
  const exe = win ? 'adb.exe' : 'adb';
  const candidates = [
    process.env.ANDROID_HOME,
    process.env.ANDROID_SDK_ROOT,
    process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, 'Android', 'Sdk'),
    process.env.HOME && join(process.env.HOME, 'Library', 'Android', 'sdk'),
    process.env.HOME && join(process.env.HOME, 'Android', 'Sdk'),
  ].filter(Boolean);

  for (const root of candidates) {
    if (existsSync(join(root, 'platform-tools', exe))) return root;
  }
  return null;
}

/**
 * The build's toolchain asks for Java 21 (see ANDROID.md). Gradle finds it via
 * JAVA_HOME, which is not set here — and the standalone JDK on PATH may be a
 * different major version, which the toolchain rejects outright rather than
 * falling back. Android Studio ships a JDK 21 of its own, so prefer that: it is
 * the JVM Studio builds this project with anyway.
 */
function findJdk21() {
  const candidates = [
    process.env.JAVA_HOME,
    'C:/Program Files/Android/Android Studio/jbr',
    'C:/Program Files/Android/Android Studio Preview/jbr',
    '/Applications/Android Studio.app/Contents/jbr/Contents/Home',
    '/opt/android-studio/jbr',
  ].filter(Boolean);

  for (const home of candidates) {
    try {
      // The `release` file is part of every JDK image, so this needs no spawn.
      if (/^JAVA_VERSION="21[."]/m.test(readFileSync(join(home, 'release'), 'utf8'))) return home;
    } catch { /* not a JDK, or not installed here */ }
  }
  return null;
}

const sdkRoot = findSdkRoot();
const javaHome = findJdk21();
// Fall back to PATH; adbRun reports the failure if it is not there either.
const adb = sdkRoot ? join(sdkRoot, 'platform-tools', win ? 'adb.exe' : 'adb') : 'adb';

function adbRun(args, { check = true } = {}) {
  const res = spawnSync(adb, args, { encoding: 'utf8' });
  if (res.error) {
    die(`could not run adb (${adb}): ${res.error.message}\n` +
        '  Set ANDROID_HOME to your Android SDK directory.');
  }
  if (check && res.status !== 0) {
    die(`adb ${args.join(' ')} failed:\n${(res.stderr || res.stdout).trim()}`);
  }
  return res.stdout ?? '';
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
 * `.env.mobile` may point at a local backend reached over the same USB tunnel
 * (see ANDROID.md). If it does, that port needs an `adb reverse` as well, or
 * every request from the app fails while the page itself loads fine.
 */
function loopbackApiPort() {
  try {
    const contents = readFileSync('.env.mobile', 'utf8');
    return contents.match(/^\s*VITE_API_URL\s*=\s*http:\/\/127\.0\.0\.1:(\d+)/m)?.[1] ?? null;
  } catch {
    return null;
  }
}

const devices = connectedDevices();
if (devices.length === 0) {
  die('no device connected. Plug the device in, unlock it, and accept the USB debugging prompt.');
}

// The tunnel does not survive an unplug, so it is re-established on every run.
// One `adb reverse` per device: the app resolves 127.0.0.1 on the device and the
// daemon forwards it back over USB to the dev server on this machine.
const apiPort = loopbackApiPort();
for (const serial of devices) {
  for (const port of [PORT, apiPort].filter(Boolean)) {
    adbRun(['-s', serial, 'reverse', `tcp:${port}`, `tcp:${port}`]);
    console.log(`  android-live: ${serial} -> ${HOST}:${port} tunnelled over USB`);
  }
}

const env = {
  ...process.env,
  CAP_LIVE_RELOAD: '1',
  CAP_LIVE_RELOAD_PORT: PORT,
  ...(sdkRoot ? { ANDROID_HOME: sdkRoot } : {}),
  ...(javaHome ? { JAVA_HOME: javaHome } : {}),
};

/** Runs one build step with live output. Returns false (and reports) on failure. */
function step(cmd, args, opts = {}) {
  const res = spawnSync(cmd, args, { env, stdio: 'inherit', shell: win, ...opts });
  if (res.status !== 0) {
    console.error(`\n  android-live: "${cmd} ${args.join(' ')}" failed.\n`);
    return false;
  }
  return true;
}

// --mode mobile: without it Vite ignores .env.mobile and VITE_API_URL falls back
// to http://localhost:8000, which inside the WebView is the *device's* own
// loopback, not this machine's. The APK and the dev server must agree on the API.
// --strictPort: the URL is baked into the APK's capacitor.config.json, so a
// silent fallback to another port would leave the app pointed at nothing.
const vite = spawn(
  'npx',
  ['vite', '--mode', 'mobile', '--host', HOST, '--port', PORT, '--strictPort'],
  { env, stdio: 'inherit', shell: win },
);
vite.on('exit', (code) => process.exit(code ?? 0));

if (install) {
  // `cap run android` shells out to a bare `gradlew`, which cmd.exe does not
  // resolve on Windows ("'gradlew' is not recognized"), so drive the steps it
  // would have run directly. Deterministic, and it names the exact APK.
  //
  // assembleDebug, not release: only the debug variant permits cleartext to
  // 127.0.0.1 (android/app/src/debug/res/xml/network_security_config.xml).
  waitForPort()
    .then(() => {
      console.log('\n  android-live: syncing...\n');
      if (!step('npx', ['cap', 'sync', 'android'])) return;

      if (!javaHome) {
        console.error(
          '\n  android-live: no JDK 21 found. Install one, or set JAVA_HOME to the JDK\n' +
          '  bundled with Android Studio (its `jbr` directory). See ANDROID.md.\n',
        );
        return;
      }

      console.log('\n  android-live: building the debug APK...\n');
      // Absolute and quoted, not a bare `gradlew.bat`: this shell sets
      // NoDefaultCurrentDirectoryInExePath, so cmd.exe does not search the
      // working directory and a relative name resolves to nothing. That is the
      // same reason `cap run android` cannot build here.
      const gradlew = join(androidDir, win ? 'gradlew.bat' : 'gradlew');
      if (!step(`"${gradlew}"`, ['assembleDebug'], { cwd: androidDir })) return;

      const apk = join(androidDir, 'app', 'build', 'outputs', 'apk', 'debug', 'app-debug.apk');
      if (!existsSync(apk)) {
        console.error(`\n  android-live: ${apk} was not produced.\n`);
        return;
      }

      console.log('\n  android-live: installing...\n');
      const res = spawnSync(adb, ['-s', devices[0], 'install', '-r', apk], { encoding: 'utf8' });
      const out = `${res.stdout ?? ''}${res.stderr ?? ''}`;
      if (res.status !== 0 || /Failure/.test(out)) {
        console.error(`\n  android-live: install failed:\n${out.trim()}\n`);
        if (/SIGNATURE|signatures do not match/i.test(out)) {
          console.error(
            '  A release-signed build is already installed, and a debug APK cannot\n' +
            `  upgrade it. Run "adb uninstall ${APP_ID}" — this clears the app's\n` +
            '  data — then re-run.\n',
          );
        }
        return;
      }

      adbRun(
        ['-s', devices[0], 'shell', 'monkey', '-p', APP_ID,
         '-c', 'android.intent.category.LAUNCHER', '1'],
        { check: false },
      );
      console.log('\n  android-live: installed and launched. Edit src/ and the app follows.\n');
    })
    .catch((err) => console.error(`\n  android-live: ${err.message}\n`));
}
