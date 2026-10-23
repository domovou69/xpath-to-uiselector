// Compares a run with the converter by text, no device: runs/<run>.json + key.json → scores/<run>.json and a table.
// Usage: node audit/llm/compare.js <run name, e.g. opus-medium-pilot> [details]
//
// Both UiSelectors are parsed (lib/uiselector.js) and compared as a set of calls, so the order of the calls does
// not matter. Categories per id:
//   agree       the same UiSelector as the converter
//   agree-skip  both skip
//   diff        both give a UiSelector, a different one       → device
//   llm-only    the model gives a UiSelector, the converter skips  → device (a WRONG candidate)
//   conv-only   the model skips, the converter converts       → device (the converter's own answer is checked)
//   unparsed    the model's string is not a UiSelector this parser reads (whitespace is forgiven first) → device
//   missing     no entry, or an entry with neither field
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { parseUiSelector } = require('../../lib/uiselector');

const [run, mode] = process.argv.slice(2);
if (!run) { console.error('usage: node audit/llm/compare.js <run> [details]'); process.exit(2); }
const key = require('./key.json');
const rec = JSON.parse(fs.readFileSync(path.join(__dirname, 'runs', `${run}.json`), 'utf8'));
if (!rec.output) { console.error(`${run}: failed run (${rec.error})`); process.exit(1); }

// whitespace outside string literals, a trailing `;` and a strategy prefix are forgiven
function normalize(s) {
  let t = String(s).trim().replace(/^(?:android=|-android uiautomator:\s*)/, '').replace(/;$/, '');
  let out = '', inStr = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (c === '"' && t[i - 1] !== '\\') inStr = !inStr;
    if (!inStr && /\s/.test(c) && !/new$/.test(out)) continue;
    out += c;
  }
  return out.replace(/new(?=UiSelector)/g, 'new ');
}
function canon(sel) {
  return sel.calls.map(c => `${c.name}(${typeof c.value === 'object' ? `{${canon(c.value)}}` : JSON.stringify(c.value)})`).sort().join('.');
}
function parse(s) {
  const r = parseUiSelector(s);
  if (r.ok) return { canon: canon(r.selector), forgiven: false };
  const n = normalize(s), r2 = parseUiSelector(n);
  return r2.ok ? { canon: canon(r2.selector), forgiven: true } : { error: r.error };
}

const out = new Map();
for (const e of rec.output) if (e && e.id && !out.has(e.id)) out.set(e.id, e);
const cases = {};
for (const [id, k] of Object.entries(key)) {
  const e = out.get(id), conv = k.converter;
  const llm = !e ? null : typeof e.uiselector === 'string' ? { uiselector: e.uiselector } : e.skip ? { skip: true, reason: e.reason || '' } : null;
  let category;
  if (!llm) category = 'missing';
  else if (llm.skip) category = conv.outcome === 'skip' ? 'agree-skip' : 'conv-only';
  else {
    const p = parse(llm.uiselector);
    if (p.forgiven) llm.forgiven = true;
    if (p.error) { category = 'unparsed'; llm.parseError = p.error; }
    else if (conv.outcome === 'skip') category = 'llm-only';
    else category = p.canon === canon(parseUiSelector(conv.uiselector).selector) ? 'agree' : 'diff';
  }
  cases[id] = { group: k.group, ref: k.ref, xpath: k.xpath, converter: conv, llm, category };
}

const CATS = ['agree', 'agree-skip', 'diff', 'llm-only', 'conv-only', 'unparsed', 'missing'];
const rows = Object.values(cases);
const count = list => Object.fromEntries(CATS.map(c => [c, list.filter(x => x.category === c).length]));
const totals = { all: count(rows), S: count(rows.filter(r => r.group === 'S')), R: count(rows.filter(r => r.group === 'R')) };
const u = rec.cli.usage || {};
const meta = { run, model: rec.modelId, effort: rec.effort, prompt: rec.prompt, cliVersion: rec.cliVersion, minutes: +(rec.wallMs / 6e4).toFixed(1),
  costUsd: rec.cli.total_cost_usd, turns: rec.cli.num_turns, outputTokens: u.output_tokens, thinkingTokens: (u.output_tokens_details || {}).thinking_tokens,
  entries: rec.output.length, extraIds: [...out.keys()].filter(id => !key[id]).length, forgiven: rows.filter(r => r.llm && r.llm.forgiven).length };
fs.mkdirSync(path.join(__dirname, 'scores'), { recursive: true });
fs.writeFileSync(path.join(__dirname, 'scores', `${run}.json`), JSON.stringify({ meta, totals, cases }, null, 1) + '\n');

const L = [`${run}: ${meta.minutes} min · $${meta.costUsd != null ? meta.costUsd.toFixed(2) : '?'} · out ${meta.outputTokens} tokens (thinking ${meta.thinkingTokens}) · ${meta.entries} entries, ${meta.forgiven} forgiven format`, '',
  `| Group | ${CATS.join(' | ')} | to the device |`, `|${' --- |'.repeat(CATS.length + 2)}`];
for (const g of ['S', 'R', 'all']) {
  const t = totals[g];
  L.push(`| ${g} | ${CATS.map(c => t[c]).join(' | ')} | ${t.diff + t['llm-only'] + t['conv-only'] + t.unparsed} |`);
}
L.push('', 'By the converter outcome (rows) × category:', `| Converter | ${CATS.join(' | ')} |`, `|${' --- |'.repeat(CATS.length + 1)}`);
for (const o of ['exact', 'close', 'skip']) L.push(`| ${o} | ${CATS.map(c => rows.filter(r => r.converter.outcome === o && r.category === c).length).join(' | ')} |`);
console.log(L.join('\n'));
if (mode === 'details') for (const [id, c] of Object.entries(cases)) if (!c.category.startsWith('agree')) {
  console.log(`\n${id} ${c.group}:${c.ref} ${c.category}\n  xpath ${c.xpath}\n  conv  ${c.converter.uiselector || 'SKIP: ' + c.converter.reason}\n  llm   ${c.llm ? c.llm.uiselector || 'SKIP: ' + c.llm.reason : '—'}`);
}
