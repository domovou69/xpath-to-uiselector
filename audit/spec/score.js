#!/usr/bin/env node
// npm run spec:score — the converter against every S case (PLAN.md section 5).
//
// Verdicts per case:
//   CORRECT       exact → the expected UiSelector, no warning;
//                 close → the expected UiSelector with a warning
//   CORRECT-SKIP  skip → skipped
//   DRIFT         exact → the expected UiSelector, but with a warning (safe, 0.5)
//   WRONG         converted where a skip is expected, a different UiSelector,
//                 or a close case without its warning
//   GAP           skipped where exact or close is expected
// S = 100 × (CORRECT + CORRECT-SKIP + 0.5 × DRIFT) / cases. Exit 1 on any WRONG
// or GAP: the expected UiSelectors were proven on the device (stage 3).
const { CASES } = require('./cases');
const { convertXpathToUiSelector } = require('../../lib/converter');
const STATUS = require('../../lib/status');

function verdict(c, res) {
  const converted = res.status === STATUS.SUCCESS;
  if (c.expect === 'skip') return converted ? 'WRONG' : 'CORRECT-SKIP';
  if (!converted) return 'GAP';
  if (res.locator !== c.uiselector) return 'WRONG';
  if (c.expect === 'close') return res.warning ? 'CORRECT' : 'WRONG';
  return res.warning ? 'DRIFT' : 'CORRECT';
}

function score(cases = CASES) {
  const rows = cases.map(c => {
    const res = convertXpathToUiSelector(c.xpath, c.opts);
    return { c, res, verdict: verdict(c, res) };
  });
  const count = v => rows.filter(r => r.verdict === v).length;
  const totals = Object.fromEntries(['CORRECT', 'CORRECT-SKIP', 'DRIFT', 'WRONG', 'GAP'].map(v => [v, count(v)]));
  const s = (100 * (totals.CORRECT + totals['CORRECT-SKIP'] + 0.5 * totals.DRIFT)) / rows.length;
  const byCategory = {};
  for (const r of rows) {
    const cat = r.c.id[0];
    byCategory[cat] = byCategory[cat] || { cases: 0, ok: 0 };
    byCategory[cat].cases++;
    byCategory[cat].ok += r.verdict.startsWith('CORRECT') ? 1 : r.verdict === 'DRIFT' ? 0.5 : 0;
  }
  return { rows, totals, s, byCategory };
}

if (require.main === module) {
  const verbose = process.argv.includes('--verbose');
  const { rows, totals, s, byCategory } = score();
  for (const r of rows) {
    if (!verbose && r.verdict.startsWith('CORRECT')) continue;
    console.log(`${r.verdict.padEnd(12)} ${r.c.id} ${r.c.xpath}`);
    if (r.verdict === 'CORRECT-SKIP') console.log(`             reason: ${r.res.reason}`);
    else if (r.verdict !== 'CORRECT' || verbose) {
      console.log(`             expect: ${r.c.expect} ${r.c.uiselector || r.c.reason}`);
      console.log(`             got:    ${r.res.status} ${r.res.status === STATUS.SUCCESS ? r.res.locator : r.res.reason}${r.res.warning ? ` ! ${r.res.warning}` : ''}`);
    }
  }
  const cats = Object.entries(byCategory).map(([k, v]) => `${k} ${Math.round((100 * v.ok) / v.cases)}`).join(', ');
  console.log(`\n${Object.entries(totals).map(([k, v]) => `${k} ${v}`).join(', ')}`);
  console.log(`S = ${s.toFixed(1)} (${rows.length} cases); per category: ${cats}`);
  if (totals.WRONG || totals.GAP) {
    console.error(`\n✗ ${totals.WRONG} WRONG, ${totals.GAP} GAP`);
    process.exit(1);
  }
  console.log('✅ 0 WRONG, 0 GAP');
}

module.exports = { score, verdict };
