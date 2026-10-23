// The result of a run after the device check: scores/<run>.json + scores/<run>-device.json → a Markdown table on stdout.
// Every id gets one final verdict for the model:
//   same      the model's answer is the converter's (the converter's own conversions were checked on the device
//             before: audit/device/results/); both skip counts here too
//   CORRECT   a different UiSelector that finds the same elements on every screen of the check
//   DRIFT     a close form the converter also uses: a childSelector whose first element agrees, or a difference only
//             in the class-less elements (scored 0.5 for the converter)
//   WRONG-LB  wrong only on generated elements with a line break in a value (no real resource id has one)
//   WRONG     a UiSelector that finds other elements, or the same in another order, on some screen
//   INVALID   the server rejects it
//   VACUOUS   the check found nothing to compare (counted apart)
//   missed    the model skips where the converter converts and the device confirms the converter
//   right skip the model skips where the converter's UiSelector is WRONG on the device
//
// Score, with the converter as the reference (100 %): every id falls in one column, Correct +1, Close +0.5,
// Wrong -1 (WRONG, WRONG-LB, INVALID), Skip 0, Missed 0; a run's % is its score over the converter's.
//   same      the converter's column for that id (exact → Correct, close → Close, skip → Skip)
//   VACUOUS   no evidence, so also the converter's column
//   a false finding (TRIAGE below) gets the verdict the triage gives it
// Every id where a model ends in a better column than the converter goes to scores/gaps.json, with its triage:
// `gap` (the converter could do this) or `false` (the check could not see why the model is wrong; scored by
// `verdict`). An id with no triage yet is `untriaged`.
//
// Usage: node audit/llm/table.js <run>   one run: the verdict table and scores/<run>-final.json
//        node audit/llm/table.js         every run in scores/: the 5-column table with Score + scores/gaps.json
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const read = f => JSON.parse(fs.readFileSync(path.join(__dirname, 'scores', f), 'utf8'));
const write = (f, v) => fs.writeFileSync(path.join(__dirname, 'scores', f), JSON.stringify(v, null, 1) + '\n');

const TRIAGE = {
  x004: { status: 'gap', note: 'normalize-space(@text)="…" → textMatches with [ \\t\\n\\r]* around the value' },
  x023: { status: 'false', verdict: 'WRONG', note: '(//A)[n]//B → A.instance(n-1).childSelector(B) goes on to the next A when the n-th has no B (found on the device), so it finds an element where the XPath finds none; the screens had no such n-th A' },
  x032: { status: 'gap', note: '@displayed="true" → new UiSelector(): the page source lists only displayed elements (default settings)' },
  x138: { status: 'gap', note: 'a union branch on @id, which Android never writes, drops out' },
  x211: { status: 'gap', note: 'contains(@text,"") is true for every element → new UiSelector()' },
  x217: { status: 'gap', note: 'if (C) then true() else false() → C' },
  x250: { status: 'false', verdict: 'WRONG', note: '(//A)[n]//B, as x023' },
  x262: { status: 'gap', note: 'some $t in @text satisfies $t="…" → @text="…"' },
  x317: { status: 'false', verdict: 'DRIFT', note: 'the converter\'s own close form ((?i) and one-to-many folds); the screens have no İ or ß' },
  x367: { status: 'false', verdict: 'WRONG', note: 'the only possible target is a range widget, which UiSelector never finds: it finds nothing on any screen' },
  x376: { status: 'false', verdict: 'WRONG', note: 'toasts are only in the page source; verify.js excused the toast although it is the target (fixed)' },
  x559: { status: 'gap', note: 'close: @text="<float>" → text("…") with the range-widget warning, as for contains(@text,"1.5")' },
  x610: { status: 'gap', note: 'string-length(@text)=n → textMatches("(?s).{n}") (code points, as XPath counts)' },
  x625: { status: 'false', verdict: 'WRONG', note: 'instance(n) in childSelector counts per container; the edge-case screens had one container (fixed: the llm screen has two)' },
  x659: { status: 'gap', note: 'translate(@text, A–Z, a–z)="ok" → textMatches("[oO][kK]")' },
};

function finals(run) {
  const score = read(`${run}.json`), dev = read(`${run}-device.json`).items;
  const final = {};
  for (const [id, c] of Object.entries(score.cases)) {
    const d = dev[id];
    if (c.category === 'agree' || c.category === 'agree-skip') final[id] = 'same';
    else if (c.category === 'conv-only') final[id] = d.convVerdict.verdict === 'WRONG' || d.convVerdict.verdict === 'INVALID' ? 'right skip' : 'missed';
    else final[id] = d.llmVerdict ? d.llmVerdict.verdict : 'missing';
  }
  return { score, dev, final };
}

const COLS = ['Correct', 'Close', 'Wrong', 'Skip', 'Missed'];
const POINTS = { Correct: 1, Close: 0.5, Wrong: -1, Skip: 0, Missed: 0 };
const convCol = c => ({ exact: 'Correct', close: 'Close', skip: 'Skip' })[c.converter.outcome];
const RANK = { Wrong: 0, Skip: 1, Missed: 1, Close: 2, Correct: 3 };
function column(v, c) {
  if (v === 'same' || v === 'VACUOUS') return convCol(c);
  if (v === 'CORRECT') return 'Correct';
  if (v === 'DRIFT') return 'Close';
  if (['WRONG', 'WRONG-LB', 'INVALID'].includes(v)) return 'Wrong';
  if (v === 'right skip') return 'Skip';
  return c.converter.outcome === 'skip' ? 'Skip' : 'Missed';  // missed, missing
}
const total = cols => COLS.reduce((a, k) => a + POINTS[k] * cols[k], 0);

const run = process.argv[2];
if (run) {
  const { score, dev, final } = finals(run);
  const V = ['same', 'CORRECT', 'DRIFT', 'WRONG', 'WRONG-LB', 'INVALID', 'VACUOUS', 'missed', 'right skip'];
  const L = [`| Group | ${V.join(' | ')} |`, `|${' --- |'.repeat(V.length + 1)}`];
  for (const g of ['S', 'R', 'all']) {
    const ids = Object.keys(final).filter(id => g === 'all' || score.cases[id].group === g);
    L.push(`| ${g} (${ids.length}) | ${V.map(v => ids.filter(id => final[id] === v).length).join(' | ')} |`);
  }
  const conv = Object.entries(dev).filter(([, d]) => d.convVerdict && ['WRONG', 'INVALID'].includes(d.convVerdict.verdict));
  L.push('', `Converter UiSelectors that the device rejects among the differences: ${conv.length}${conv.length ? ' — ' + conv.map(([id, d]) => `${id} (${d.group}:${d.ref})`).join(', ') : ''}`);
  console.log(L.join('\n'));
  write(`${run}-final.json`, final);
  process.exit(0);
}

// every run: columns, score, gaps
const ORDER = ['opus', 'sonnet', 'haiku'];
const runs = fs.readdirSync(path.join(__dirname, 'scores')).filter(f => /-device\.json$/.test(f)).map(f => f.replace(/-device\.json$/, ''))
  .sort((a, b) => ORDER.indexOf(a.split('-')[0]) - ORDER.indexOf(b.split('-')[0]) || a.localeCompare(b));
const rows = [], gaps = {};
let convCols = null;
for (const r of runs) {
  const { score, dev, final } = finals(r);
  write(`${r}-final.json`, final);
  const cols = Object.fromEntries(COLS.map(k => [k, 0]));
  let lb = 0;
  if (!convCols) {
    convCols = Object.fromEntries(COLS.map(k => [k, 0]));
    for (const c of Object.values(score.cases)) convCols[convCol(c)]++;
  }
  for (const [id, c] of Object.entries(score.cases)) {
    const t = TRIAGE[id];
    const better = RANK[column(final[id], c)] > RANK[convCol(c)];
    const v = better && t && t.status === 'false' ? t.verdict : final[id];
    const col = column(v, c);
    cols[col]++;
    if (v === 'WRONG-LB') lb++;
    if (better) {
      const g = gaps[id] || (gaps[id] = { id, group: c.group, ref: c.ref, xpath: c.xpath, converter: c.converter,
        status: t ? t.status : 'untriaged', ...(t && t.verdict ? { verdict: t.verdict } : {}), ...(t ? { note: t.note } : {}), runs: [] });
      g.runs.push({ run: r, verdict: final[id], uiselector: dev[id].llm });
    }
  }
  rows.push({ run: r, cols, lb, score: total(cols) });
}
const conv = total(convCols);
const pct = s => (100 * s / conv).toFixed(1);
const L = [`| Run | ${COLS.join(' | ')} | Score | Score (%) |`, `|${' --- |'.repeat(COLS.length + 3)}`,
  `| Converter | ${COLS.map(k => k === 'Missed' ? '–' : convCols[k]).join(' | ')} | ${conv} | 100.0 |`];
for (const { run: r, cols, lb, score } of rows)
  L.push(`| ${r} | ${COLS.map(k => k === 'Wrong' && lb ? `${cols[k]} (${lb} LB)` : cols[k]).join(' | ')} | ${score} | ${pct(score)} |`);
const list = Object.values(gaps).sort((a, b) => a.id.localeCompare(b.id));
L.push('', `Model better than the converter: ${list.length} ids — ` + ['gap', 'false', 'untriaged'].map(s => `${s} ${list.filter(g => g.status === s).length}`).join(', '));
for (const g of list) L.push(`- ${g.id} ${g.status}: ${g.runs.map(x => `${x.run} ${x.verdict}`).join(', ')}`);
console.log(L.join('\n'));
write('gaps.json', list);
