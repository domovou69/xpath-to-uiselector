// Refreshes the converter's answers in key.json after a converter change, keeping input.json and the sample as they are.
// (Re-running build-input.js would draw a new sample when audit/spec/cases.js has changed.)
//   node audit/llm/refresh-key.js
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { convertXpathToUiSelector } = require('../../lib/converter');
const STATUS = require('../../lib/status');

function convert(xpath) {
  const r = convertXpathToUiSelector(xpath);
  if (r.status !== STATUS.SUCCESS) return { outcome: 'skip', reason: r.reason };
  return { outcome: r.warning ? 'close' : 'exact', uiselector: r.locator, ...(r.warning ? { warning: r.warning } : {}) };
}

const file = path.join(__dirname, 'key.json');
const key = JSON.parse(fs.readFileSync(file, 'utf8'));
let changed = 0;
for (const [id, k] of Object.entries(key)) {
  const now = convert(k.xpath);
  if (JSON.stringify(now) === JSON.stringify(k.converter)) continue;
  console.log(`${id} ${k.group}:${k.ref} ${k.converter.outcome} → ${now.outcome}${now.uiselector !== k.converter.uiselector ? ' (UiSelector changed)' : ''}`);
  k.converter = now;
  changed++;
}
fs.writeFileSync(file, JSON.stringify(key, null, 1) + '\n');
console.log(`${changed} of ${Object.keys(key).length} converter answers changed`);
