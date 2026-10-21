#!/usr/bin/env node
// Compares two device runs pair by pair: the edge cases (s-run.json against s-run-<out>.json) and, when both
// exist, the matrix slice of the real-world fuzz (r-fuzz.json against r-fuzz-<out>.json). For every case (or item)
// and screen: the outcome, the number of XPath and UiSelector elements (and the probe's), and the element
// fingerprints, first in full and then without bounds, which another Android version can shift (status bar
// height). Nothing runs on the device; the report is results/compare-<out>.md.
//   node audit/device/compare.js --out api37
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const args = process.argv.slice(2);
const opt = k => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
const OUT = opt('--out');
if (!OUT) { console.error('usage: node audit/device/compare.js --out api37'); process.exit(2); }
const DIR = path.join(__dirname, 'results');
const read = f => JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8'));
const has = f => fs.existsSync(path.join(DIR, f));

// why a pair differs, when it is known not to be the OS: checked by hand on the device, see the report
const WHY = {
  'P04|attrs': 'the base pair was recorded before run.js ran the probe of exact cases (stage 4b); --resume kept it',
  'P04|tree': 'same as P04 on attrs',
  'P04|deep': 'same as P04 on attrs',
  'P04|windows': 'the toast (TOAST, SRV-13) lives a few seconds; in the base it was still in the page source, here it was gone. Run right after the screen appears, API 37 also gives 13 and 5 for P04 and H04',
  'H04|windows': 'the toast, as for P04 on windows',
  // matrix fuzz: in the base, one attribute of the last element was read back empty (both lookups share one
  // fingerprint read); rerun on API 36 on the same screen (r-fuzz-api36check.json) it reads as on API 37
  'd26b9a5c54cc|m16s1': 'the base read content-desc "Item 7" of the last element as empty once; rerun on API 36 (r-fuzz-api36check.json) it reads "Item 7", as on API 37',
  'd15848531853|m16s2': 'the base read text "成专成" of the last element as empty once (the XPath matched it by that text); rerun on API 36 (r-fuzz-api36check.json) it reads "成专成", as on API 37',
};

const noBounds = fp => fp.replace(/\|[^|]*$/, '');
// the lookups of a record: run.js keeps them in xpath / ui, fuzz.js in x / u (its ui is the UiSelector string)
const X = r => r.xpath ?? r.x;
const U = r => (typeof r.ui === 'string' ? r.u : r.ui);
const cnt = l => (!l ? '' : l.error ? 'err' : l.n);
const env = d => `${d.device.avd}, Android ${d.device.android} (API ${d.device.sdk}), server ${d.stack.uiautomator2Server}, ${d.date}`;

// a lookup on both sides: 'same', 'bounds' (only bounds differ), 'first' (a long list kept only as a hash: the
// count and the first element agree apart from bounds), or what differs
function lookups(a, b, label) {
  if (!a && !b) return 'same';
  if (!a || !b) return `${label} only on one side`;
  if (a.error || b.error) return a.error && b.error ? 'same' : `${label} error ${a.error ? 'base' : 'other'} only`;
  if (a.n !== b.n) return `${label} count ${a.n} → ${b.n}`;
  const fa = a.fp, fb = b.fp;
  if (fa && fb) {
    if (JSON.stringify(fa) === JSON.stringify(fb)) return 'same';
    if (JSON.stringify(fa.map(noBounds)) === JSON.stringify(fb.map(noBounds))) return 'bounds';
    return `${label} elements differ`;
  }
  if (a.h && b.h) {
    if (a.h === b.h) return 'same';
    return a.f0 && b.f0 && noBounds(a.f0) === noBounds(b.f0) ? 'first' : `${label} first element differs`;
  }
  return 'same';
}

// one pair: 'same', 'bounds', 'first', or the list of differences
function pair(a, b) {
  const d = [];
  if (a.outcome !== b.outcome) d.push(`outcome ${a.outcome} → ${b.outcome}`);
  if (typeof a.ui === 'string' && a.ui !== b.ui) d.push('the converter emitted another UiSelector');
  const parts = [lookups(X(a), X(b), 'XPath'), lookups(U(a), U(b), 'UiSelector')];
  if (a.probe || b.probe) {
    if (a.probe?.outcome !== b.probe?.outcome) d.push(`probe ${a.probe?.outcome ?? 'not run'} → ${b.probe?.outcome ?? 'not run'}`);
    parts.push(lookups(a.probe?.ui, b.probe?.ui, 'probe'));
  }
  d.push(...parts.filter(p => !['same', 'bounds', 'first'].includes(p)));
  return d.length ? d : parts.includes('first') ? 'first' : parts.includes('bounds') ? 'bounds' : 'same';
}

function section(L, base, other, keys, label) {
  const zero = () => ({ same: 0, bounds: 0, first: 0, differs: 0, missing: 0 });
  const tally = zero();
  const byScreen = {};
  const diffs = [];
  for (const k of keys) {
    const a = base.runs[k], b = other.runs[k];
    const sc = a.screen;
    byScreen[sc] ||= zero();
    let r;
    if (!b) r = 'missing';
    else { const p = pair(a, b); r = Array.isArray(p) ? 'differs' : p; if (r === 'differs') diffs.push([k, a, b, p]); }
    tally[r]++; byScreen[sc][r]++;
  }
  L.push(`${keys.length} ${label} pairs: ${tally.same} the same, ${tally.bounds} the same apart from bounds,` +
    `${tally.first ? ` ${tally.first} with the same count and first element apart from bounds (list kept only as a hash),` : ''}` +
    ` ${tally.differs} different, ${tally.missing} not run on the other side.`, '');
  const screens = Object.entries(byScreen);
  if (screens.length > 10) L.push(`<details><summary>By screen (${screens.length})</summary>`, '');
  L.push(`| Screen | Same | Same apart from bounds |${tally.first ? ' Count and first element |' : ''} Different | Not run |`,
    `| --- | --- | --- |${tally.first ? ' --- |' : ''} --- | --- |`);
  for (const [sc, t] of screens) L.push(`| ${sc} | ${t.same} | ${t.bounds} |${tally.first ? ` ${t.first} |` : ''} ${t.differs} | ${t.missing} |`);
  L.push('');
  if (screens.length > 10) L.push('</details>', '');
  if (diffs.length) {
    const open = diffs.filter(([k]) => !WHY[k]).length;
    L.push(open ? `**${open} of ${diffs.length} differences are not explained.**` : `${diffs.length === 2 ? "Both" : `All ${diffs.length}`} differences are explained; none comes from the OS.`, '');
    L.push('| Pair | Base counts | Other counts | Differences | Why |', '| --- | --- | --- | --- | --- |');
    for (const [k, a, b, p] of diffs) {
      const c = r => `${cnt(X(r))}/${cnt(U(r) ?? r.probe?.ui)} ${r.outcome}`;
      L.push(`| ${k.replace('|', ' on ')} | ${c(a)} | ${c(b)} | ${p.join('; ')} | ${WHY[k] || '**not explained**'} |`);
    }
    L.push('');
  }
  return { tally, diffs };
}

const L = [`# Device runs compared: base against ${OUT}`, '',
  `Generated by \`audit/device/compare.js --out ${OUT}\`. A pair is one case (or real-world item) on one screen;`,
  'it is the same when the outcome, the element counts and the fingerprint lists (class, resource-id, text,',
  'content-desc, bounds; in order) agree. "Apart from bounds" means only the bounds of some elements moved.', ''];

const s = read('s-run.json'), s2 = read(`s-run-${OUT}.json`);
L.push('## Edge cases', '', `- base: \`s-run.json\`: ${env(s)}`, `- other: \`s-run-${OUT}.json\`: ${env(s2)}`, '');
const sum = f => (fs.readFileSync(path.join(DIR, f), 'utf8').match(/^Verdicts: .*$/m) || ['?'])[0];
L.push(`Verdicts, base: ${sum('s-summary.md').slice(10)}`, `Verdicts, other: ${sum(`s-summary-${OUT}.md`).slice(10)}`, '');
const edge = section(L, s, s2, Object.keys(s.runs), 'edge-case');

let fuzz = null;
if (has(`r-fuzz-${OUT}.json`)) {
  const r = read('r-fuzz.json'), r2 = read(`r-fuzz-${OUT}.json`);
  // the matrix slice only: the other run covers the matrix screens (fuzz.js --matrix)
  const keys = Object.keys(r.runs).filter(k => /\|m\d+s\d+$/.test(k));
  L.push('## Real-world fuzz, matrix screens', '', `- base: \`r-fuzz.json\`: ${env(r)}`, `- other: \`r-fuzz-${OUT}.json\`: ${env(r2)}`, '',
    'fuzz.js keeps fingerprint lists longer than 10 elements only as a hash and the first element when the outcome',
    'is EQUAL. For those the hash differs as soon as one bounds moved, so they are compared by count and first element.', '');
  fuzz = section(L, r, r2, keys, 'matrix');
}

fs.writeFileSync(path.join(DIR, `compare-${OUT}.md`), L.join('\n') + '\n');
console.log(`edge cases: ${JSON.stringify(edge.tally)}${fuzz ? `; matrix: ${JSON.stringify(fuzz.tally)}` : ''} → results/compare-${OUT}.md`);
