// Minimal WebDriver client for the local Appium server (plain HTTP, no client library), LocatorLab
// launcher, and host / device / stack versions. Ported from appium-android-locator-benchmark/bench/lib/wd.js.
'use strict';

const { execFileSync, spawn } = require('node:child_process');
const { existsSync, readFileSync } = require('node:fs');
const { homedir } = require('node:os');
const path = require('node:path');

const APPIUM = process.env.APPIUM_URL || 'http://127.0.0.1:4723';
const SDK = process.env.ANDROID_HOME || [`${homedir()}/Library/Android/sdk`].find(existsSync);
const ADB = SDK ? `${SDK}/platform-tools/adb` : 'adb';
const PKG = 'io.github.domovou69.locatorlab';
const ELEMENT = 'element-6066-11e4-a52e-4f735466cecf';
const UI = '-android uiautomator';
// attributes that identify an element in a result list; bounds tell apart nodes with equal attributes
const FINGERPRINT = ['class', 'resource-id', 'text', 'content-desc', 'bounds'];

const ms = t0 => Math.round((performance.now() - t0) * 10) / 10;
const sleep = t => new Promise(r => setTimeout(r, t));

async function wd(method, p, body) {
  const r = await fetch(APPIUM + p, { method, headers: { 'content-type': 'application/json' }, body: body && JSON.stringify(body) });
  const j = await r.json();
  if (j.value && j.value.error) throw new Error(`${j.value.error}: ${j.value.message}`);
  return j.value;
}

class Session {
  static async open(caps = {}) {
    const v = await wd('POST', '/session', { capabilities: { alwaysMatch: {
      platformName: 'Android', 'appium:automationName': 'UiAutomator2', 'appium:autoLaunch': false,
      'appium:noReset': true, 'appium:newCommandTimeout': 1800, ...caps } } });
    const s = new Session(); s.id = v.sessionId; s.caps = v.capabilities; return s;
  }
  url(p) { return `/session/${this.id}${p}`; }
  // findElements, timed; never throws
  async findAll(using, value) {
    const t0 = performance.now();
    try { const a = await wd('POST', this.url('/elements'), { using, value }); return { ms: ms(t0), ids: a.map(e => e[ELEMENT]) }; }
    catch (e) { return { ms: ms(t0), error: e.message.split('\n')[0].slice(0, 300) }; }
  }
  async source() { return wd('GET', this.url('/source')); }
  attr(id, name) { return wd('GET', this.url(`/element/${id}/attribute/${name}`)); }
  // an absent attribute comes back as null or "null" depending on the strategy; both become ""
  async fingerprint(id) {
    const v = await Promise.all(FINGERPRINT.map(a => this.attr(id, a).catch(() => null)));
    return v.map(x => x == null || x === 'null' ? '' : String(x)).join('|');
  }
  settings() { return wd('GET', this.url('/appium/settings')); }
  close() { return wd('DELETE', this.url('')).catch(() => {}); }
}

const adb = (...a) => execFileSync(ADB, a, { encoding: 'utf8', maxBuffer: 1 << 26 }).trim();

// Force-stop and start LocatorLab with a screen; ready when the app logs it, plus a quiet moment.
async function launch(screen, settleMs = 500) {
  adb('logcat', '-c');
  const b64 = Buffer.from(JSON.stringify(screen), 'utf8').toString('base64');
  // through the device shell's stdin: adb refuses a long command line; exec still limits one argument to 128 KB
  execFileSync(ADB, ['shell'], { input: `am start -S -n ${PKG}/.LabActivity --es b64 ${b64}\nexit\n`, encoding: 'utf8' });
  const t0 = Date.now();
  for (;;) {
    if (adb('logcat', '-d', '-s', 'LocatorLab:I').includes(`ready ${screen.name}`)) {
      await sleep(settleMs);
      const focus = adb('shell', 'dumpsys', 'window').match(/mCurrentFocus=.*/)?.[0] || '';
      if (!focus.includes(`${PKG}/`)) throw new Error(`app not in focus after launch: ${focus}`);
      return;
    }
    if (Date.now() - t0 > 60000) throw new Error(`screen did not draw: ${screen.name}`);
    await sleep(200);
  }
}

function host() {
  const sh = (c, a) => { try { return execFileSync(c, a, { encoding: 'utf8' }).trim(); } catch { return null; } };
  const batt = sh('pmset', ['-g', 'batt']) || '', lpm = (sh('pmset', ['-g']) || '').match(/lowpowermode\s+(\d)/);
  return { cpu: sh('sysctl', ['-n', 'machdep.cpu.brand_string']), macOS: sh('sw_vers', ['-productVersion']), node: process.version,
    power: /AC Power/.test(batt) ? 'AC' : /Battery Power/.test(batt) ? 'battery' : null, lowPowerMode: lpm ? lpm[1] === '1' : null };
}

// refuses to run on battery or in Low Power Mode (project rule), and keeps the display and the system awake while
// the run lives: with the display asleep macOS slows the emulator down several times
function requirePower() {
  const h = host();
  if (h.power !== 'AC' || h.lowPowerMode !== false) {
    console.error(`power: ${h.power}, Low Power Mode: ${h.lowPowerMode}. Plug in and turn Low Power Mode off, then rerun.`);
    process.exit(2);
  }
  try { spawn('caffeinate', ['-dimsu', '-w', String(process.pid)], { detached: true, stdio: 'ignore' }).unref(); h.caffeinate = true; } catch { h.caffeinate = false; }
  return h;
}

function device() {
  const p = k => adb('shell', 'getprop', k);
  return { model: p('ro.product.model'), android: p('ro.build.version.release'), sdk: p('ro.build.version.sdk'),
    fingerprint: p('ro.build.fingerprint'), avd: p('ro.boot.qemu.avd_name') || null };
}

// versions of the stack, from node_modules and the session
function stack(session) {
  const root = path.join(__dirname, '..', '..', 'node_modules');
  const v = p => { try { return JSON.parse(readFileSync(path.join(root, p, 'package.json'), 'utf8')).version; } catch { return null; } };
  return { appium: v('appium'), uiautomator2Driver: v('appium-uiautomator2-driver'),
    uiautomator2Server: session?.caps?.uiautomator2ServerVersion ?? v('appium-uiautomator2-driver/node_modules/appium-uiautomator2-server') ?? v('appium-uiautomator2-server') };
}

module.exports = { APPIUM, ADB, PKG, UI, FINGERPRINT, wd, Session, adb, launch, host, requirePower, device, stack, sleep };
