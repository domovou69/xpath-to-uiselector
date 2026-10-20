#!/usr/bin/env node
// npm run spec:check — keeps reference/ and the S cases in step.
//
// Fails when:
//   - a reference row (SRV-/SEL-/XP- id) is not cited by any S case;
//   - a case cites an id that does not exist;
//   - case ids repeat or do not look like A01;
//   - an exact/close case has no UiSelector, or one the server's parser would
//     reject (lib/uiselector.js); a close case has no warning; a skip no reason.
const { readdirSync, readFileSync } = require('fs');
const { join } = require('path');
const { CASES } = require('./cases');
const { parseUiSelector } = require('../../lib/uiselector');

const REF_DIR = join(__dirname, '..', '..', 'reference');

function referenceIds() {
  const ids = new Map(); // id → file
  for (const file of readdirSync(REF_DIR).filter(f => f.endsWith('.md'))) {
    const text = readFileSync(join(REF_DIR, file), 'utf8');
    for (const m of text.matchAll(/^\| ((?:SRV|SEL|XP)-\d{2}) \|/gm)) {
      if (ids.has(m[1])) throw new Error(`reference id ${m[1]} is defined twice (${ids.get(m[1])}, ${file})`);
      ids.set(m[1], file);
    }
  }
  return ids;
}

function check() {
  const problems = [];
  const ids = referenceIds();
  const cited = new Set();
  const seen = new Set();

  for (const c of CASES) {
    const where = `${c.id} ${c.xpath}`;
    if (!/^[A-Z]\d{2}$/.test(c.id)) problems.push(`${where}: id must look like A01`);
    if (seen.has(c.id)) problems.push(`${where}: duplicate id`);
    seen.add(c.id);
    if (typeof c.xpath !== 'string' || !c.xpath) problems.push(`${where}: no xpath`);
    if (!Array.isArray(c.refs) || !c.refs.length) problems.push(`${where}: no refs`);
    for (const ref of c.refs || []) {
      if (!ids.has(ref)) problems.push(`${where}: unknown ref ${ref}`);
      cited.add(ref);
    }
    if (c.expect === 'exact' || c.expect === 'close') {
      const parsed = typeof c.uiselector === 'string' ? parseUiSelector(c.uiselector) : { ok: false, error: 'missing' };
      if (!parsed.ok) problems.push(`${where}: uiselector ${parsed.error}`);
      if (c.expect === 'close' && !c.warning) problems.push(`${where}: close case without a warning`);
    } else if (c.expect === 'skip') {
      if (!c.reason) problems.push(`${where}: skip case without a reason`);
      if (c.uiselector) problems.push(`${where}: skip case with a uiselector`);
    } else {
      problems.push(`${where}: expect must be exact, close or skip`);
    }
  }

  for (const [id, file] of ids) {
    if (!cited.has(id)) problems.push(`reference ${id} (${file}) is not cited by any S case`);
  }

  const count = kind => CASES.filter(c => c.expect === kind).length;
  return {
    problems,
    summary: `${CASES.length} S cases (${count('exact')} exact, ${count('close')} close, ${count('skip')} skip), ${ids.size} reference rows, all cited`,
  };
}

if (require.main === module) {
  const { problems, summary } = check();
  if (problems.length) {
    console.error(problems.map(p => `✗ ${p}`).join('\n'));
    console.error(`\n${problems.length} problem${problems.length > 1 ? 's' : ''}`);
    process.exit(1);
  }
  console.log(`✅ ${summary}`);
}

module.exports = { check, referenceIds };
