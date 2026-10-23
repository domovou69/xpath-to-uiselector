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
// Usage: node audit/llm/table.js <run>
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const run = process.argv[2];
const read = f => JSON.parse(fs.readFileSync(path.join(__dirname, 'scores', f), 'utf8'));
const score = read(`${run}.json`), dev = read(`${run}-device.json`).items;

const final = {};
for (const [id, c] of Object.entries(score.cases)) {
  const d = dev[id];
  if (c.category === 'agree' || c.category === 'agree-skip') final[id] = 'same';
  else if (c.category === 'conv-only') final[id] = d.convVerdict.verdict === 'WRONG' || d.convVerdict.verdict === 'INVALID' ? 'right skip' : 'missed';
  else final[id] = d.llmVerdict ? d.llmVerdict.verdict : 'missing';
}
const V = ['same', 'CORRECT', 'DRIFT', 'WRONG', 'WRONG-LB', 'INVALID', 'VACUOUS', 'missed', 'right skip'];
const L = [`| Group | ${V.join(' | ')} |`, `|${' --- |'.repeat(V.length + 1)}`];
for (const g of ['S', 'R', 'all']) {
  const ids = Object.keys(final).filter(id => g === 'all' || score.cases[id].group === g);
  L.push(`| ${g} (${ids.length}) | ${V.map(v => ids.filter(id => final[id] === v).length).join(' | ')} |`);
}
const conv = Object.entries(dev).filter(([, d]) => d.convVerdict && ['WRONG', 'INVALID'].includes(d.convVerdict.verdict));
L.push('', `Converter UiSelectors that the device rejects among the differences: ${conv.length}${conv.length ? ' — ' + conv.map(([id, d]) => `${id} (${d.group}:${d.ref})`).join(', ') : ''}`);
console.log(L.join('\n'));
fs.writeFileSync(path.join(__dirname, 'scores', `${run}-final.json`), JSON.stringify(final, null, 1) + '\n');
