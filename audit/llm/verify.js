#!/usr/bin/env node
// Checks every difference between a run and the converter on the emulator (compare.js categories diff, llm-only,
// conv-only, unparsed). For each item and screen: findElements with the XPath, with the model's UiSelector and with
// the converter's; each list is compared with the XPath's by fingerprint and order (as audit/device/run.js does).
//
// Screens:
//   edge cases       the five edge-case screens (audit/device/screens.js) + the `llm` screen below
//   real-world       five random screens and a matrix screen of their own, generated from the XPath by
//                    audit/device/fuzz-screens.js (seed llm-verify-1), + the `llm` screen
//   `llm`            hand-made cells for forms the generator does not read and traps it does not make: range
//                    widgets whose value is 1.5 / 21.5, (//X)[n]//Y and (//A/descendant::B)[n] over several
//                    containers, normalize-space, string-length with characters outside the BMP
//
// Verdict of one UiSelector over its screens:
//   CORRECT   EQUAL on every screen (DEPTH and TOAST, as in run.js, count as equal; TOAST not when the XPath
//             targets android.widget.Toast), and the XPath finds something
//   DRIFT     a documented close form: a childSelector for //A//B whose first element agrees, or a difference
//             only in the class-less elements the page source calls android.view.View (the converter warns)
//   WRONG-LB  differs only on elements with a line break in a value (generated traps; real ids have none)
//   WRONG     a different set or order on some screen (`first` says whether the first element still agrees)
//   INVALID   the server rejects the UiSelector
//             (a UiSelector for an XPath that the server rejects is WRONG: the locator would start to find elements)
//   VACUOUS   EQUAL everywhere, but the XPath finds nothing on any screen: no evidence
//
// Results: scores/<run>-device.json, saved as it goes; --resume skips the lookups already there.
// Needs the emulator (AOSP_API_36, headless), LocatorLab installed and Appium (APPIUM_URL for port 4724).
//   node audit/llm/verify.js <run> [--resume] [--only x001,x002] [--summary]
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { Session, UI, PKG, launch, requirePower, device, stack } = require('../device/wd');
const { SCREENS } = require('../device/screens');
const { generate, shape } = require('../device/fuzz-screens');

const args = process.argv.slice(2);
const run = args[0];
const opt = k => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
if (!run || run.startsWith('--')) { console.error('usage: node audit/llm/verify.js <run> [--resume] [--only ids] [--summary]'); process.exit(2); }
const score = JSON.parse(fs.readFileSync(path.join(__dirname, 'scores', `${run}.json`), 'utf8'));
const OUT = path.join(__dirname, 'scores', `${run}-device.json`);
const DEVICE = new Set(['diff', 'llm-only', 'conv-only', 'unparsed']);
const SEED = 'llm-verify-1';

// ---------------------------------------------------------------------------
// The `llm` screen
// ---------------------------------------------------------------------------
const n = (c, t, x = {}) => ({ c, ...(t === undefined ? {} : { t }), ...x });
const TV = (t, x) => n('android.widget.TextView', t, x);
const box = (k, x = {}) => n('android.widget.LinearLayout', undefined, { k, ...x });
const row = (...k) => box(k, { row: true });
const VG = (d, k) => n('android.view.ViewGroup', undefined, { d, k });
const ID = 'com.example.app:id/item_7';
const LLM_SCREEN = {
  name: 'llm',
  root: box([
    // range widgets: the page source text is Float.toString of the value (SRV-06)
    row(n('android.widget.SeekBar', undefined, { range: 1.5 }), n('android.widget.SeekBar', undefined, { range: 21.5 }),
      n('android.widget.ProgressBar', undefined, { range: 50 }), TV('Total 1.5 kg')),
    // (//X)[n]//Y: several containers, one without a match, one with two
    VG('popon_wepejazuk_zeru', [TV('a', { id: ID })]),
    VG('popon_wepejazuk_zeru', [TV('b')]),
    VG('popon_wepejazuk_zeru', [TV('c', { id: ID }), TV('d', { d: 'Settings' }), TV('e', { id: ID })]),
    VG('popon_wepejazuk_zeru', [n('android.widget.ImageView', undefined, { d: 'Settings', id: ID })]),
    // (//A//B)[n] over two containers
    n('android.widget.ScrollView', undefined, { k: [row(n('android.widget.ImageView', undefined, { d: 'i1' }), n('android.widget.ImageView', undefined, { d: 'i2' }))] }),
    n('android.widget.ScrollView', undefined, { k: [row(n('android.widget.ImageView', undefined, { d: 'i3' }), n('android.widget.ImageView', undefined, { d: 'i4' }))] }),
    n('android.view.View', undefined, { id: 'cuzoces-moduvu', k: [row(TV('m1'), TV('m2'))] }),
    n('android.view.View', undefined, { id: 'cuzoces-moduvu', k: [row(TV('m3'), TV('m4'))] }),
    // (//A/descendant::B)[n] over two containers: the third overall is the first of the second container
    box([TV('s1'), TV('s2')], { id: 'com.example.app:id/second' }),
    box([TV('s3'), TV('s4'), TV('s5')], { id: 'com.example.app:id/second' }),
    // union with a web attribute
    row(TV('u1', { id: 'io.zofujize.vikuwag.vajotin:id/danob_danob_hac' }), TV('u2', { id: 'danob_danob_hac' }), TV('u3', { id: 'x:id/danob_danob_hac_2' })),
    // normalize-space, string-length, substring, translate
    row(TV('Total\n'), TV(' Total\t'), TV('To tal'), TV('Tot'), TV('Totally')),
    row(TV('\u{1F600}\u{1F600}\u{1F600}\u{1F600}\u{1F600}'), TV('abcde'), TV('abcd'), TV('OK'), TV('oK'), TV('OkK')),
  ]),
};

// ---------------------------------------------------------------------------
// Items and screens
// ---------------------------------------------------------------------------
const swapPkg = (s, pkg) => s && pkg ? s.replaceAll(pkg, PKG).replaceAll(pkg.replace(/\./g, '\\.'), PKG.replace(/\./g, '\\.')) : s;
const items = Object.entries(score.cases).filter(([, c]) => DEVICE.has(c.category)).map(([id, c]) => {
  const pkg = (/@package\s*=\s*(["'])([^"']*)\1/.exec(c.xpath) || [])[2];
  return { id, key: id, group: c.group, ref: c.ref, category: c.category, xpath: swapPkg(c.xpath, pkg),
    llm: c.llm && c.llm.uiselector ? swapPkg(c.llm.uiselector, pkg) : null, conv: c.converter.uiselector ? swapPkg(c.converter.uiselector, pkg) : null,
    convWarning: c.converter.warning || null };
});

// real-world items get generated screens: random (all five of the batch) and matrix (their own screen only)
// (an XPath the generator cannot read runs on the `llm` screen only)
const readable = it => { try { shape(it.xpath); return true; } catch { return false; } };
const R = items.filter(it => it.group === 'R' && readable(it));
const unread = items.filter(it => it.group === 'R' && !readable(it)).map(it => it.id);
const genCopies = R.map(it => ({ key: it.key, xpath: it.xpath })), matCopies = R.map(it => ({ key: it.key, xpath: it.xpath }));
const gen = generate(genCopies, SEED, 0, 'L');
const mat = generate(matCopies, SEED, 0, 'LM', { matrix: true });
const screensOf = new Map(items.map(it => [it.id, it.group === 'S' ? [...SCREENS, LLM_SCREEN] : [LLM_SCREEN]]));
for (const b of gen.batches) for (const k of b.items) screensOf.get(k).push(...b.screens);
// a matrix item runs only on the screen that holds its cell (`home`, as in fuzz.js)
const matScreens = new Map(mat.batches.flatMap(b => b.screens).map(sc => [sc.name, sc]));
for (const c of matCopies) if (c.home) screensOf.get(c.key).push(matScreens.get(c.home));

// ---------------------------------------------------------------------------
// Lookups
// ---------------------------------------------------------------------------
async function lookup(s, cache, using, value) {
  const r = await s.findAll(using, value);
  if (r.error) return { error: r.error };
  const fp = [];
  for (const id of r.ids) { if (!cache.has(id)) cache.set(id, await s.fingerprint(id)); fp.push(cache.get(id)); }
  return { n: fp.length, fp };
}
function compare(x, u) {
  if (x.error) return 'XPATH_ERROR';
  if (u.error) return 'UISEL_ERROR';
  if (JSON.stringify(x.fp) === JSON.stringify(u.fp)) return 'EQUAL';
  if (JSON.stringify([...x.fp].sort()) === JSON.stringify([...u.fp].sort())) return 'ORDER_DIFFERS';
  return 'SET_DIFFERS';
}
const short = (l, o) => (l.error ? { error: l.error } : { n: l.n, ...(o !== 'EQUAL' || l.n <= 5 ? { fp: l.fp } : { f0: l.fp[0] }) });

function verdict(rows, warning, child, toast) {
  if (!rows.length) return null;
  if (rows.some(r => r.outcome === 'UISEL_ERROR')) return { verdict: 'INVALID', error: rows.find(r => r.u && r.u.error).u.error };
  // the XPath itself fails (e.g. an invalid matches() flag): a UiSelector that runs behaves differently
  if (rows.some(r => r.outcome === 'XPATH_ERROR')) return { verdict: 'WRONG', xpathError: true };
  const bad = rows.filter(r => r.outcome !== 'EQUAL').map(r => ({ r, why: known(r, toast) }));
  const first = bad.every(({ r }) => (r.x.fp[0] || null) === (r.u.fp[0] || null));
  const screens = bad.map(({ r, why }) => `${r.screen} ${r.x.n}/${r.u.n} ${why || r.outcome}`);
  const left = bad.filter(b => !['DEPTH', 'TOAST'].includes(b.why));
  if (!left.length) return { verdict: rows.some(r => r.x.n > 0) ? 'CORRECT' : 'VACUOUS', ...(bad.length ? { screens } : {}) };
  // a documented close form: the first element agrees (childSelector), or the difference is the class-less elements
  // that the page source calls android.view.View, or range widgets whose value text only the page source has
  // (the converter warns about all three)
  const drift = (warning && (first || /android\.view\.View/.test(warning))) || left.every(b => b.why === 'VIEW' || b.why === 'RANGE') || (child && first);
  if (drift) return { verdict: 'DRIFT', first, screens };
  if (left.every(b => b.why === 'LINEBREAK' || b.why === 'VIEW')) return { verdict: 'WRONG-LB', first, screens };
  return { verdict: 'WRONG', first, screens };
}

// Known differences (as audit/device/run.js): DEPTH, the UiSelector also finds elements below the 70-level page
// source limit; TOAST, the XPath also finds the toast. Three more: VIEW, the only XPath-only elements have no class
// name (the page source calls them android.view.View, SRV-03); RANGE, the only XPath-only elements are range widgets
// (their value is a text only in the page source, SRV-06); LINEBREAK, every element only one side finds has a
// line break in a value, which only the generated traps and a CR LF text of the attrs screen have (range widgets
// next to them are allowed: alone they are RANGE).
// A toast left over from the `windows` screen (it stays in the source for a few seconds) can join another kind, so
// toasts are set aside before the other checks. When the XPath targets android.widget.Toast the toast is what it
// looks for (`toast`), so it is neither excused nor set aside (nor taken for a class-less VIEW element).
function known(r, toast) {
  const u = r.u.fp;
  let x = r.x.fp;
  let xOnly = x.filter(f => !u.includes(f));
  const uOnly = u.filter(f => !x.includes(f));
  if (!xOnly.length && JSON.stringify(u.filter(f => x.includes(f))) === JSON.stringify(x) && r.screen === 'deep') return 'DEPTH';
  if (!toast && !uOnly.length && xOnly.length && xOnly.every(f => f === '||||')) return 'TOAST';
  if (!toast && !uOnly.length) { x = x.filter(f => f !== '||||'); xOnly = xOnly.filter(f => f !== '||||'); }
  if (!uOnly.length && xOnly.length && xOnly.every(f => f.startsWith('|') && f !== '||||') && JSON.stringify(x.filter(f => !f.startsWith('|'))) === JSON.stringify(u)) return 'VIEW';
  if (!uOnly.length && xOnly.length && xOnly.every(f => /^android\.widget\.(?:SeekBar|ProgressBar|RatingBar)\|/.test(f)) && JSON.stringify(x.filter(f => u.includes(f))) === JSON.stringify(u)) return 'RANGE';
  // line breaks, possibly next to range widgets only the XPath finds (a close form on its own): LINEBREAK
  const range = f => /^android\.widget\.(?:SeekBar|ProgressBar|RatingBar)\|/.test(f) && xOnly.includes(f);
  if ([...xOnly, ...uOnly].some(f => f.includes('\n')) && [...xOnly, ...uOnly].every(f => f.includes('\n') || range(f))) return 'LINEBREAK';
  return null;
}

const toast = xpath => /android\.widget\.Toast/.test(xpath);

function summarize(doc) {
  const res = {};
  for (const it of items) {
    const rows = side => Object.values(doc.runs).filter(r => r.id === it.id && r.side === side);
    res[it.id] = { group: it.group, ref: it.ref, category: it.category, xpath: it.xpath, llm: it.llm, conv: it.conv, convWarning: it.convWarning,
      llmVerdict: it.llm ? verdict(rows('llm'), null, /childSelector/.test(it.llm) && /\/\/[^/]|descendant::/.test(it.xpath.slice(2)), toast(it.xpath)) : null,
      convVerdict: it.conv ? verdict(rows('conv'), it.convWarning, false, toast(it.xpath)) : null,
      xpathFound: Math.max(0, ...Object.values(doc.runs).filter(r => r.id === it.id).map(r => r.x.n || 0)) };
  }
  doc.items = res;
  const t = {};
  for (const r of Object.values(res)) for (const side of ['llm', 'conv']) {
    const v = r[side + 'Verdict']; if (!v) continue;
    const k = `${side} ${r.category}`; t[k] = t[k] || {}; t[k][v.verdict] = (t[k][v.verdict] || 0) + 1;
  }
  return t;
}

(async () => {
  const doc = fs.existsSync(OUT) && (args.includes('--resume') || args.includes('--summary'))
    ? JSON.parse(fs.readFileSync(OUT, 'utf8')) : { run, seed: SEED, runs: {} };
  const save = () => fs.writeFileSync(OUT, JSON.stringify(doc, null, 1) + '\n');
  if (args.includes('--summary')) { console.log(summarize(doc)); save(); return; }
  const host = requirePower();
  const only = opt('--only')?.split(',');
  const s = await Session.open();
  Object.assign(doc, { date: new Date().toISOString().slice(0, 10), host, device: device(), stack: stack(s), nogen: [...unread, ...gen.nogen.map(x => x.key), ...mat.nogen.map(x => x.key)] });
  // screen → items, so each screen launches once
  const byScreen = new Map();
  for (const it of items) {
    if (only && !only.includes(it.id)) continue;
    for (const sc of screensOf.get(it.id)) {
      if (!byScreen.has(sc.name)) byScreen.set(sc.name, { sc, list: [] });
      byScreen.get(sc.name).list.push(it);
    }
  }
  const t0 = Date.now();
  let done = 0;
  try {
    for (const { sc, list } of byScreen.values()) {
      const todo = list.filter(it => !doc.runs[`${it.id}|llm|${sc.name}`] && !doc.runs[`${it.id}|conv|${sc.name}`]);
      if (!todo.length) continue;
      await launch(sc);
      const cache = new Map();
      for (const it of todo) {
        const x = await lookup(s, cache, 'xpath', it.xpath);
        for (const [side, ui] of [['llm', it.llm], ['conv', it.conv]]) {
          if (!ui) continue;
          const u = await lookup(s, cache, UI, ui);
          const outcome = compare(x, u);
          doc.runs[`${it.id}|${side}|${sc.name}`] = { id: it.id, side, screen: sc.name, outcome, x: short(x, outcome), u: short(u, outcome) };
        }
      }
      done += todo.length;
      save();
      console.log(`screen ${sc.name}: ${todo.length} items · ${done} lookups rows · ${((Date.now() - t0) / 6e4).toFixed(1)} min`);
    }
  } finally { save(); await s.close(); }
  console.log(summarize(doc));
  save();
})().catch(e => { console.error(e); process.exit(1); });
