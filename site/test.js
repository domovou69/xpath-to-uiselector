// The playground must give what convertXpathToUiSelector gives: run the built bundle and
// playground.js in a vm and compare on every S case (audit/spec/cases.js).
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { build, OUT } = require('./build');
const { CASES } = require('../audit/spec/cases');
const { convertXpathToUiSelector, STATUS } = require('../xpath-to-uiselector');

build();
const ctx = vm.createContext({});
for (const f of ['converter.js', 'playground.js']) vm.runInContext(fs.readFileSync(path.join(OUT, f), 'utf8'), ctx, { filename: f });
const { convertXpathToUiSelector: browser, STATUS: bStatus } = ctx.XpathToUiSelector;
const { convertLines } = ctx.Playground;
const plain = v => JSON.parse(JSON.stringify(v));

assert.deepStrictEqual(plain(bStatus), plain(STATUS));
let skipped = 0;
for (const c of CASES) {
  const want = convertXpathToUiSelector(c.xpath);
  assert.deepStrictEqual(plain(browser(c.xpath)), plain(want), `${c.id}: bundle differs`);
  if (/[\r\n]/.test(c.xpath)) { skipped++; continue; } // the page takes one XPath per line, so it cannot hold a line break
  const [row] = plain(convertLines(c.xpath, browser, bStatus));
  const kind = want.status !== STATUS.SUCCESS ? 'skip' : want.warning ? 'close' : 'exact';
  assert.strictEqual(row.kind, kind, `${c.id}: kind`);
  assert.strictEqual(row.locator, want.status === STATUS.SUCCESS ? want.locator : null, `${c.id}: locator`);
  assert.strictEqual(row.reason, want.status === STATUS.SUCCESS ? null : want.reason, `${c.id}: reason`);
  assert.strictEqual(row.hint, want.hint || null, `${c.id}: hint`);
  assert.strictEqual(row.warning, want.warning || null, `${c.id}: warning`);
}
// several lines: one entry each, blank lines dropped
const rows = convertLines('\n//a\r\n\n  //b  \n', browser, bStatus);
assert.deepStrictEqual(plain(rows.map(r => r.xpath)), ['//a', '//b']);
// the page's examples show the kind on their label
for (const e of ctx.Playground.EXAMPLES) {
  for (const r of convertLines(e.text, browser, bStatus)) assert.strictEqual(r.kind, e.label, `example ${e.label}: ${r.xpath}`);
}
// the bundle carries the whole core and nothing of Node
const src = fs.readFileSync(path.join(OUT, 'converter.js'), 'utf8');
assert(!/require\(['"](?:fs|path|os|child_process)['"]\)/.test(src));
fs.rmSync(OUT, { recursive: true, force: true });
console.log(`playground: ${CASES.length} S cases match convertXpathToUiSelector (${skipped} with a line break checked on the bundle only)`);
