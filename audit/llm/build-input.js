// Builds the model input and its scoring key for the LLM comparison.
//   input.json: [{ id, xpath }]  shuffled, neutral ids, runtime XPath strings, no group
//   key.json:   { id: { group, ref, xpath, converter, expect?, project?, projects? } }  never shown to a model
// Edge cases (S): every distinct XPath of audit/spec/cases.js. Real-world locators (R): a sample of the distinct Android
// XPaths of the corpus, stratified by project and by what the converter does (exact / close / skip), so the
// sample keeps the corpus mix. Runtime values (`%s`, `${x}`, `" + x + "`) are filled in first, as at run time,
// so the model and the converter get the same plain string.
//   node audit/llm/build-input.js
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const corpus = require('../corpus/android-locators.json');
const { CASES } = require('../spec/cases');
const { decodeEntry } = require('../corpus/convert');
const { convertXpathToUiSelector } = require('../../lib/converter');
const STATUS = require('../../lib/status');

const TOTAL = 680; // the iOS comparison had 678
const SEED = 'llm-compare-1';
const COMMON = ['android.widget.TextView', 'android.widget.Button', 'android.widget.ImageView', 'android.widget.EditText'];
// runtime string values: no quote and no backslash, some regex metacharacters (as in the fuzz)
const RUNTIME = ['Item 7', 'v2.0', 'a+b', '(x)', 'Total $5', '50%', 'Grüße', 'q?', 'Ok', 'Settings', 'user01', 'Next'];

// S cases with an XPath an earlier case already has (T01 = A01) are given once
const S_CASES = CASES.filter((c, i) => CASES.findIndex(d => d.xpath === c.xpath) === i);

const sha = s => crypto.createHash('sha256').update(s).digest('hex');
const rnd = (...parts) => parseInt(sha(parts.join('|')).slice(0, 8), 16) / 2 ** 32;

function convert(xpath) {
  const r = convertXpathToUiSelector(xpath);
  if (r.status !== STATUS.SUCCESS) return { outcome: 'skip', reason: r.reason };
  return { outcome: r.warning ? 'close' : 'exact', uiselector: r.locator, ...(r.warning ? { warning: r.warning } : {}) };
}

// a runtime value by its place in the XPath: a class name, a position, an index, a resource id part, or a string value
function fill(value, placeholders, key) {
  let xpath = value;
  for (const ch of placeholders.keys()) {
    const r = rnd(SEED, key, ch);
    const v = new RegExp(`(?:^|/|::)${ch}(?=$|[[/])`).test(xpath) ? COMMON[Math.floor(r * COMMON.length)]
      : xpath.includes(`[${ch}]`) ? String(1 + Math.floor(r * 3))
        : new RegExp(`@index\\s*=\\s*(["'])${ch}\\1`).test(xpath) ? String(Math.floor(r * 3))
          : xpath.includes(`${ch}:id/`) ? 'com.example.app'
            : xpath.includes(`:id/${ch}`) ? 'item_7'
              : new RegExp(`@resource-id\\s*,?\\s*=?\\s*["']${ch}`).test(xpath) ? 'com.example.app:id/item_7'
                : RUNTIME[Math.floor(r * RUNTIME.length)];
    xpath = xpath.replaceAll(ch, v);
  }
  return xpath;
}

// R pool: one item per distinct decoded XPath, kept under the first project that has it
const pool = new Map();
for (const e of corpus) {
  if (e.kind !== 'xpath' && e.kind !== 'xpath-dynamic') continue;
  const d = decodeEntry(e);
  if (!d) continue; // an escape the tool does not read: no plain string to give
  const it = pool.get(d.value);
  if (it) { it.ids.push(e.id); it.projects.add(e.project); continue; }
  const xpath = fill(d.value, d.placeholders, d.value);
  pool.set(d.value, { ids: [e.id], project: e.project, projects: new Set([e.project]), source: d.value, xpath, converter: convert(xpath) });
}
// an R item whose runtime string is an edge case, or another item's, is left out (one row per XPath)
const seen = new Set(S_CASES.map(c => c.xpath));
const items = [...pool.values()].filter(it => !seen.has(it.xpath) && seen.add(it.xpath));

// stratified sample: strata = project × outcome, sizes by largest remainder, items within a stratum by seeded hash
const N_R = TOTAL - S_CASES.length;
const strata = new Map();
for (const it of items) {
  const k = `${it.project}|${it.converter.outcome}`;
  if (!strata.has(k)) strata.set(k, []);
  strata.get(k).push(it);
}
const quota = [...strata].map(([k, list]) => ({ k, list, exact: (N_R * list.length) / items.length }));
quota.forEach(q => { q.n = Math.floor(q.exact); });
let left = N_R - quota.reduce((a, q) => a + q.n, 0);
quota.slice().sort((a, b) => (b.exact - b.n) - (a.exact - a.n) || (a.k < b.k ? -1 : 1)).slice(0, left).forEach(q => { q.n++; });
const sampleR = quota.flatMap(q => q.list.slice().sort((a, b) => rnd(SEED, a.source) - rnd(SEED, b.source)).slice(0, q.n));

const rows = [
  ...S_CASES.map(c => ({ group: 'S', ref: c.id, xpath: c.xpath, expect: c.expect, converter: convert(c.xpath) })),
  ...sampleR.map(it => ({ group: 'R', ref: it.ids[0], xpath: it.xpath, ...(it.xpath !== it.source ? { source: it.source } : {}),
    project: it.project, projects: it.projects.size, converter: it.converter })),
];
if (rows.length !== TOTAL) throw new Error(`expected ${TOTAL} rows, got ${rows.length}`);
if (new Set(rows.map(r => r.xpath)).size !== rows.length) throw new Error('duplicate XPath in the input');

rows.sort((a, b) => rnd(SEED, 'order', a.xpath) - rnd(SEED, 'order', b.xpath));
const input = [], key = {};
rows.forEach((r, i) => { const id = 'x' + String(i + 1).padStart(3, '0'); input.push({ id, xpath: r.xpath }); key[id] = r; });
fs.writeFileSync(path.join(__dirname, 'input.json'), JSON.stringify(input, null, 1) + '\n');
fs.writeFileSync(path.join(__dirname, 'key.json'), JSON.stringify(key, null, 1) + '\n');

const count = (list, f) => list.reduce((m, x) => ((m[f(x)] = (m[f(x)] || 0) + 1), m), {});
console.log(`input.json: ${input.length} (S ${S_CASES.length}, R ${sampleR.length} of ${items.length} distinct Android XPaths)`);
console.log('converter on R pool:', count(items, x => x.converter.outcome), '· sample:', count(sampleR, x => x.converter.outcome));
console.log('converter on S:', count(rows.filter(r => r.group === 'S'), r => r.converter.outcome));
console.log('projects in sample:', Object.keys(count(sampleR, x => x.project)).length, '· largest:',
  Object.entries(count(sampleR, x => x.project)).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([p, n]) => `${p} ${n}`).join(', '));
