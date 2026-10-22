#!/usr/bin/env node
// The oracle (PLAN.md section 5), S mode: every case of audit/spec/cases.js on every screen of
// audit/device/screens.js. For each case and screen, findElements with the XPath and with the case's
// UiSelector; the two element lists are compared by attribute fingerprint (wd.js FINGERPRINT) and order.
//
// Outcome per case and screen:
//   EQUAL          same elements in the same order (also when both are empty: see `n`)
//   ORDER_DIFFERS  same elements, different order
//   SET_DIFFERS    different elements
//   XPATH_ONLY     the case is a skip (no UiSelector): only the XPath ran; a skip case may carry a
//                  `probe`, the naive UiSelector the converter must not emit, compared the same way
//   UISEL_ERROR    the UiSelector lookup failed
//   XPATH_ERROR    the XPath lookup failed
//
// Needs the emulator (AOSP_API_36, headless), LocatorLab installed and `npm run appium`. Results are
// written after every case to audit/device/results/s-run.json; --resume skips the case/screen pairs
// already there. audit/device/results/s-summary.md is rewritten at the end (or with --summary only).
// --out api37 writes s-run-api37.json and s-summary-api37.md instead (another device or Android version).
//   node audit/device/run.js [--resume] [--only A01,E01] [--screens attrs,tree] [--summary] [--out api37]
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { Session, UI, PKG, launch, requirePower, device, stack } = require('./wd');
const { SCREENS } = require('./screens');
const { CASES } = require('../spec/cases');

const args = process.argv.slice(2);
const opt = k => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
const SUFFIX = opt('--out') ? `-${opt('--out')}` : '';
const OUT = path.join(__dirname, 'results', `s-run${SUFFIX}.json`);
const SUMMARY = path.join(__dirname, 'results', `s-summary${SUFFIX}.md`);
const U = 'new UiSelector()';

// naive UiSelectors for skip cases: what a converter would emit without the rule that skips them; an exact
// case may have one too (the wrong form a rule replaced)
const PROBES = {
  A08: `${U}.text("")`,
  A09: `${U}.resourceId("")`,
  A15: `${U}.className("com.example.app.Outer$Inner")`,
  A18: `${U}.text("OK")`,
  B16: `${U}.index(2)`,
  C06: `${U}.classNameMatches("(?s).*Button.*")`,
  C08: `${U}.textMatches("(?s).*")`,
  C10: `${U}.className("android.widget.SeekBar").text("50.0")`,
  C11: `${U}.text("50.0")`,
  C12: `${U}.textMatches("(?s).*Total.*")`,
  C13: `${U}.text("Total")`,
  C14: `${U}.text("Total")`,
  E04: `${U}.className("android.widget.Button").instance(1)`,
  // without the outer instance(0), findElements runs its instance(i) loop on the container (SRV-35)
  E09: `${U}.className("android.widget.ListView").childSelector(${U}.className("android.widget.TextView").instance(0))`,
  // the form an exact-candidate rule would emit for n ≥ 2: it counts within each container (SEL-14)
  E10: `${U}.className("android.widget.ListView").instance(0).childSelector(${U}.className("android.widget.TextView").instance(4))`,
  E11: `${U}.resourceId("com.example.app:id/second").instance(0).childSelector(${U}.className("android.widget.TextView").instance(2))`,
  E15: `${U}.className("android.widget.ListView").instance(1).childSelector(${U}.className("android.widget.TextView"))`,
  E07: `${U}.text("Add").instance(0)`,
  F02: `${U}.className("android.widget.ListView").childSelector(${U}.className("android.widget.TextView"))`,
  G12: `${U}.text("bell\u0007")`,
  H03: `${U}.textMatches("(?d)(?s:.*)(?:a*)(?s:.*)")`,
  H07: `${U}.textMatches("(?i)ok")`,
  H08: `${U}.textMatches("(?i)OK")`,
  P03: `${U}.className("android.widget.Toast").text("Saved")`,
  P04: U,
  V08: `${U}.text("1")`,
  X02: String.raw`${U}.classNameMatches("android\.widget\.Button|android\.widget\.ImageButton")`,
  // exact cases: the form before the stage 4b fix, without (?-s:…)
  H11: `${U}.textMatches("(?d)(?s:.*)(?:Line 1.Line 2)(?s:.*)")`,
};

// LocatorLab cannot set a node's package (the framework overwrites it), so @package cases run with
// the app's own package in place of com.example.app, in the XPath and the UiSelector alike
const SUBST = {
  A07: t => t.replaceAll('com.example.app', PKG),
  C07: t => t.replace('com.example', 'io.github').replace(String.raw`com\.example`, String.raw`io\.github`),
};
const prepare = c => SUBST[c.id] ? { ...c, xpath: SUBST[c.id](c.xpath), uiselector: SUBST[c.id](c.uiselector), substituted: true } : c;

async function lookup(s, using, value) {
  const r = await s.findAll(using, value);
  if (r.error) return { ms: r.ms, error: r.error };
  const fp = [];
  for (const id of r.ids) fp.push(await s.fingerprint(id));
  return { ms: r.ms, n: fp.length, fp };
}

function compare(x, u) {
  if (x.error) return 'XPATH_ERROR';
  if (u.error) return 'UISEL_ERROR';
  if (JSON.stringify(x.fp) === JSON.stringify(u.fp)) return 'EQUAL';
  if (JSON.stringify([...x.fp].sort()) === JSON.stringify([...u.fp].sort())) return 'ORDER_DIFFERS';
  return 'SET_DIFFERS';
}

async function runCase(s, c) {
  c = prepare(c);
  const xpath = await lookup(s, 'xpath', c.xpath);
  if (!c.uiselector) {
    const row = { outcome: xpath.error ? 'XPATH_ERROR' : 'XPATH_ONLY', xpath };
    if (PROBES[c.id]) { const ui = await lookup(s, UI, PROBES[c.id]); row.probe = { uiselector: PROBES[c.id], ui, outcome: compare(xpath, ui) }; }
    return row;
  }
  const ui = await lookup(s, UI, c.uiselector);
  const row = { outcome: compare(xpath, ui), xpath, ui, ...(c.substituted ? { substituted: { xpath: c.xpath, uiselector: c.uiselector } } : {}) };
  if (PROBES[c.id]) { const p = await lookup(s, UI, PROBES[c.id]); row.probe = { uiselector: PROBES[c.id], ui: p, outcome: compare(xpath, p) }; }
  return row;
}

// a known, documented difference behind SET_DIFFERS, or null:
//   DEPTH  every XPath element is also found by the UiSelector, in the same order; the extra ones lie
//          below the 70-level limit of the page source (SRV-12), which UiSelector does not have
//   TOAST  the only XPath-only element is the toast (no attributes), which only the page source has (SRV-13)
function known(r) {
  if (r.outcome !== 'SET_DIFFERS' || !r.ui) return null;
  const x = r.xpath.fp, u = r.ui.fp;
  const xOnly = x.filter(f => !u.includes(f)), uOnly = u.filter(f => !x.includes(f));
  if (!xOnly.length && JSON.stringify(u.filter(f => x.includes(f))) === JSON.stringify(x) && r.screen === 'deep') return 'DEPTH';
  if (!uOnly.length && xOnly.length && xOnly.every(f => f === '||||')) return 'TOAST';
  return null;
}

// verdict of a case over all screens
function verdict(c, runs) {
  const rs = SCREENS.map(sc => runs[`${c.id}|${sc.name}`]).filter(Boolean);
  if (!rs.length) return 'not run';
  if (c.expect === 'skip') {
    const outs = rs.map(r => r.outcome === 'XPATH_ERROR' ? 'error' : `${r.xpath.n}`);
    const probe = rs.filter(r => r.probe).map(r => r.probe.outcome);
    return `xpath ${outs.join('/')}${probe.length ? `; probe ${[...new Set(probe)].join(', ')}` : ''}`;
  }
  const bad = rs.map(r => r.outcome !== 'EQUAL' && !known(r) ? `${r.screen}: ${r.outcome}` : null).filter(Boolean);
  const kn = [...new Set(rs.map(known).filter(Boolean))];
  if (bad.length) return `DIFFERS (${bad.join('; ')})`;
  const v = rs.some(r => r.xpath.n > 0) ? 'CONFIRMED' : 'VACUOUS (no match on any screen)';
  return kn.length ? `${v}, except ${kn.join(', ')}` : v;
}

function summary(doc) {
  const by = {};
  const lines = ['# S run on the emulator', '', `Generated by \`audit/device/run.js\` from \`${path.basename(OUT)}\` (${doc.date}). Stack: appium ${doc.stack.appium},`,
    `uiautomator2 driver ${doc.stack.uiautomator2Driver}, server ${doc.stack.uiautomator2Server}; ${doc.device.avd}, Android ${doc.device.android} (API ${doc.device.sdk}).`,
    '', `Columns per screen (${SCREENS.map(s => s.name).join(', ')}): XPath count / UiSelector count (for a skip case the`,
    'probe\'s count), then the outcome when it is not EQUAL. DEPTH: the UiSelector also finds elements below the',
    '70-level page source limit (SRV-12). TOAST: the XPath also finds the toast (SRV-13). A07 and C07 run with',
    'LocatorLab\'s package in place of com.example.app.', '',
    `| Case | Expect | ${SCREENS.map(s => s.name).join(' | ')} | Verdict |`, `| --- | --- | ${SCREENS.map(() => '---').join(' | ')} | --- |`];
  for (const c of CASES) {
    const cells = SCREENS.map(sc => {
      const r = doc.runs[`${c.id}|${sc.name}`];
      if (!r) return '';
      const cnt = l => l.error ? 'err' : l.n;
      const ui = r.ui || r.probe?.ui;
      return `${cnt(r.xpath)}${ui ? `/${cnt(ui)}` : ''}${r.outcome === 'EQUAL' || r.outcome === 'XPATH_ONLY' ? '' : ' ' + (known(r) || r.outcome)}${r.probe && r.probe.outcome !== 'EQUAL' ? ' probe ' + r.probe.outcome : ''}`;
    });
    const v = verdict(c, doc.runs);
    { const k = v.split(/[ ,]/)[0]; by[k] = (by[k] || 0) + 1; }
    lines.push(`| ${c.id} | ${c.expect} | ${cells.join(' | ')} | ${v} |`);
  }
  lines.splice(10, 0, `Verdicts: ${Object.entries(by).map(([k, v]) => `${k} ${v}`).join(', ')}.`, '');
  return lines.join('\n') + '\n';
}

(async () => {
  const doc = fs.existsSync(OUT) && (args.includes('--resume') || args.includes('--summary')) ? JSON.parse(fs.readFileSync(OUT, 'utf8')) : null;
  if (args.includes('--summary')) { fs.writeFileSync(SUMMARY, summary(doc)); console.log(SUMMARY); return; }
  const host = requirePower();
  const only = opt('--only')?.split(',');
  const screens = SCREENS.filter(sc => !opt('--screens') || opt('--screens').split(',').includes(sc.name));
  const cases = CASES.filter(c => !only || only.includes(c.id));
  const s = await Session.open();
  const out = doc || { date: null, runs: {} };
  Object.assign(out, { date: new Date().toISOString().slice(0, 10), host, device: device(), stack: stack(s), settings: await s.settings() });
  const save = () => { fs.mkdirSync(path.dirname(OUT), { recursive: true }); fs.writeFileSync(OUT, JSON.stringify(out, null, 1) + '\n'); };
  const total = screens.length * cases.length;
  let done = screens.reduce((k, sc) => k + cases.filter(c => out.runs[`${c.id}|${sc.name}`]).length, 0);
  try {
    for (const sc of screens) {
      // toast cases first: the toast is in the source for a few seconds only
      const todo = cases.filter(c => !out.runs[`${c.id}|${sc.name}`]).sort((a, b) => /Toast/.test(b.xpath) - /Toast/.test(a.xpath));
      if (!todo.length) continue;
      await launch(sc);
      console.log(`screen ${sc.name}: ${todo.length} cases`);
      for (const c of todo) {
        const r = await runCase(s, c);
        out.runs[`${c.id}|${sc.name}`] = { case: c.id, screen: sc.name, expect: c.expect, ...r };
        save();
        done++;
        if (r.outcome !== 'EQUAL' && r.outcome !== 'XPATH_ONLY' && c.expect !== 'skip') console.log(`  ${c.id} ${r.outcome}`);
        if (done % 20 === 0) console.log(`  ${done}/${total}`);
      }
    }
  } finally { await s.close(); }
  fs.writeFileSync(SUMMARY, summary(out));
  console.log(`done ${done}/${total} → ${path.relative(process.cwd(), SUMMARY)}`);
})().catch(e => { console.error(e); process.exit(1); });
