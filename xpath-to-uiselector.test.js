// Zero-dependency test runner: `node xpath-to-uiselector.test.js`
// Exit code is non-zero on any failure. Add a row and re-run.
//
// Stage 0 (PLAN.md): the converter is a placeholder, so the scanner is tested
// with an injected fake converter (`FAKE`). That keeps the file handling —
// preview vs. write, quoting, platform keys, XPath strategies, refusals —
// independent of the conversion rules that come in stage 4.
const { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, symlinkSync } = require('fs');
const { tmpdir } = require('os');
const { join } = require('path');
const { execFileSync } = require('child_process');
const { isLikelyXpathLocator, parseFlags, convertXpathToUiSelector } = require('./xpath-to-uiselector');
const { makeStats, walkDir, processFile } = require('./lib/scanner');
const STATUS = require('./lib/status');

let passed = 0;
let failed = 0;
const ok = () => { passed++; };
const fail = msg => { failed++; console.log(`  ✗ ${msg}`); };

const CLI = join(__dirname, 'xpath-to-uiselector.js');
const OUT = 'new UiSelector().className("android.widget.Button").text("OK")';
// Converts everything to OUT; a grouped position gets a warning.
const FAKE = xpath => ({
  locator: OUT,
  status: STATUS.SUCCESS,
  ...(xpath.startsWith('(') ? { warning: 'close form' } : {}),
});

function makeTempRoot(prefix = 'uisel-test-') {
  return mkdtempSync(join(tmpdir(), prefix));
}

// Writes `source` to `name` in a fresh folder, runs processFile, cleans up.
function scan(name, source, opts = {}) {
  const root = makeTempRoot();
  try {
    const file = join(root, name);
    writeFileSync(file, source);
    const records = [];
    const stats = makeStats();
    processFile(file, { dryRun: false, quiet: true, convert: FAKE, ...opts }, records, stats);
    return { records, stats, after: readFileSync(file, 'utf8') };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

// =====================================================================
// DETECT — isLikelyXpathLocator: the scanner's pre-filter. [string, match]
// =====================================================================
const DETECT_CASES = [
  ['//android.widget.Button', true],
  ['//androidx.recyclerview.widget.RecyclerView/android.widget.TextView', true],
  ['//com.app.ui.CustomView$Inner', true],
  ['//*[@text="OK"]', true],
  ['//*[@resource-id="com.app:id/login"]', true],
  ['//android.widget.TextView[contains(@text,"Total")]', true],
  ['(//android.widget.Button)[2]', true],
  ['(//*[@text="a)b"])[1]', true],
  ['/hierarchy/android.widget.FrameLayout/android.widget.LinearLayout', true],
  ['/hierarchy', true],
  ['(/hierarchy/android.widget.FrameLayout)[1]', true],
  ['//XCUIElementTypeButton', true], // counted, then skipped as iOS
  ['//div[@id="main"]', true], // web XPaths are the user's call (PLAN.md decision 4)
  // not locators
  ['//cdn.example.com/lib.js', false],
  ['//example.com', false],
  ['// just a comment', false],
  ['//', false],
  ['/hierarchyX/a', false],
  ['/usr/local/bin', false],
  ['//*[@text="a"', false], // unbalanced
  ['https://example.com/a[1]', false],
];

console.log('— DETECT —');
for (const [str, want] of DETECT_CASES) {
  const got = isLikelyXpathLocator(str);
  if (got === want) ok();
  else fail(`DETECT ${str}\n     expected: ${want}\n     got:      ${got}`);
}

// =====================================================================
// FLAGS — parseFlags. { argv, expect: subset to match }
// =====================================================================
const FLAGS_CASES = [
  { argv: ['./src'], expect: { positionals: ['./src'], dryRun: true, json: false, quiet: false } },
  { argv: ['./src', '--write'], expect: { dryRun: false } },
  { argv: ['./src', '--dry-run'], expect: { positionals: ['./src'], dryRun: true } },
  { argv: ['--write'], expect: { dryRun: false } },
  { argv: ['--dry-run', '--write'], expect: { dryRun: true } }, // --dry-run wins
  { argv: ['--json'], expect: { json: true, quiet: true } }, // --json implies --quiet
  { argv: ['--quiet'], expect: { quiet: true, json: false } },
  { argv: ['--help'], expect: { help: true, version: false, unknown: [] } },
  { argv: ['-h'], expect: { help: true } },
  { argv: ['--version'], expect: { version: true, help: false } },
  { argv: ['-V'], expect: { version: true } },
  // Unknown flags are collected, never silently ignored.
  { argv: ['--wirte'], expect: { unknown: ['--wirte'] } },
  { argv: ['./src', '--optimize'], expect: { unknown: ['--optimize'], positionals: ['./src'] } },
  { argv: ['--nope', '-x'], expect: { unknown: ['--nope', '-x'] } },
  { argv: ['./src', '-h'], expect: { positionals: ['./src'] } },
  { argv: ['./src', '--write', '--json'], expect: { unknown: [] } },
];

console.log('— FLAGS —');
for (const { argv, expect } of FLAGS_CASES) {
  const got = parseFlags(argv);
  const mismatch = Object.keys(expect).find(k => JSON.stringify(got[k]) !== JSON.stringify(expect[k]));
  if (!mismatch) ok();
  else fail(`FLAGS ${JSON.stringify(argv)}\n     key '${mismatch}' expected: ${JSON.stringify(expect[mismatch])}\n     got:      ${JSON.stringify(got[mismatch])}`);
}

// =====================================================================
// CONVERTER placeholder — until stage 4 every XPath is a skip with a reason.
// =====================================================================
console.log('— CONVERTER (placeholder) —');
{
  const res = convertXpathToUiSelector('//android.widget.Button[@text="OK"]');
  if (res.status === STATUS.SKIPPED_UNSUPPORTED_LOGIC && res.locator === '//android.widget.Button[@text="OK"]' && res.reason) ok();
  else fail(`placeholder converter: ${JSON.stringify(res)}`);
}

// =====================================================================
// UISELECTOR PARSER — the server's literal rules (reference SRV-20..SRV-24).
// [string, ok, calls (name=value pairs) when ok]
// =====================================================================
const { parseUiSelector } = require('./lib/uiselector');
const PARSE_CASES = [
  ['new UiSelector()', true, []],
  ['new UiSelector().text("OK")', true, [['text', 'OK']]],
  ['new UiSelector().className("a.B").checked(false).index(2).instance(0)', true,
    [['className', 'a.B'], ['checked', false], ['index', 2], ['instance', 0]]],
  ['new UiSelector().text("a\\"b")', true, [['text', 'a"b']]], // \" → "
  ['new UiSelector().text("a\\\\b")', true, [['text', 'a\\\\b']]], // a backslash stays as written
  ['new UiSelector().textMatches("a\\x22b")', true, [['textMatches', 'a\\x22b']]],
  ['new UiSelector().text("f(x);")', true, [['text', 'f(x);']]], // ( ) ; inside a literal
  ['new UiSelector().text("a\nb")', true, [['text', 'a\nb']]],
  ['new UiSelector().className("L").childSelector(new UiSelector().text("x"))', true,
    [['className', 'L'], ['childSelector', '[text=x]']]],
  // rejected
  ['new UiSelector().text("a\\")', false], // a trailing backslash escapes the closing quote
  ['new UiSelector().text(OK)', false],
  ['new UiSelector().checked("true")', false],
  ['new UiSelector().index(x)', false],
  ['new UiSelector().foo("x")', false],
  ['new UiSelector().text("a");new UiSelector().text("b")', false], // one statement only
  ['UiSelector().text("a")', false],
  ['new UiSelector().text("a"', false],
];

console.log('— UISELECTOR PARSER —');
for (const [str, wantOk, wantCalls] of PARSE_CASES) {
  const res = parseUiSelector(str);
  const show = calls => calls.map(c => [c.name, c.value && c.value.calls ? `[${c.value.calls.map(s => `${s.name}=${s.value}`).join(',')}]` : c.value]);
  const got = res.ok ? JSON.stringify(show(res.selector.calls)) : null;
  if (res.ok === wantOk && (!wantOk || got === JSON.stringify(wantCalls))) ok();
  else fail(`PARSE ${JSON.stringify(str)}\n     expected: ${wantOk ? JSON.stringify(wantCalls) : 'rejected'}\n     got:      ${res.ok ? got : `rejected (${res.error})`}`);
}

// =====================================================================
// SPEC CHECK — audit/spec/check.js must pass on the real cases and catch
// broken ones. Mutates the shared CASES array and restores it.
// =====================================================================
console.log('— SPEC CHECK —');
{
  const spec = require('./audit/spec/cases');
  const { check } = require('./audit/spec/check');
  const real = spec.CASES.slice();
  const withCases = (cases, fn) => {
    spec.CASES.splice(0, spec.CASES.length, ...cases);
    try { return fn(check().problems); } finally { spec.CASES.splice(0, spec.CASES.length, ...real); }
  };

  withCases(real, problems => (problems.length === 0 ? ok() : fail(`spec check on the real cases: ${problems.join('; ')}`)));

  const mutations = [
    ['an uncited reference row', real.filter(c => c.id !== 'P03'), /SRV-13 .* not cited/],
    ['an unknown method', [...real, { ...real[0], id: 'Z01', uiselector: 'new UiSelector().textContainz("x")' }], /Z01 .*unknown method/],
    ['a duplicate id', [...real, { ...real[1] }], /A02 .*duplicate id/],
    ['an unknown ref', [...real, { id: 'Z02', xpath: '//x', expect: 'exact', uiselector: 'new UiSelector()', refs: ['SEL-99'] }], /Z02 .*unknown ref SEL-99/],
    ['a close case without a warning', [...real, { id: 'Z03', xpath: '//x', expect: 'close', uiselector: 'new UiSelector()', refs: ['SEL-01'] }], /Z03 .*without a warning/],
    ['a skip case without a reason', [...real, { id: 'Z04', xpath: '//x', expect: 'skip', refs: ['SEL-01'] }], /Z04 .*without a reason/],
    ['an unclosed literal', [...real, { id: 'Z05', xpath: '//x', expect: 'exact', uiselector: 'new UiSelector().text("a\\")', refs: ['SEL-01'] }], /Z05 .*never closed/],
  ];
  for (const [label, cases, want] of mutations) {
    withCases(cases, problems => (problems.some(p => want.test(p)) ? ok() : fail(`spec check missed ${label}: ${JSON.stringify(problems)}`)));
  }
}

// =====================================================================
// SCANNER — makeStats, walkDir, processFile against on-disk fixtures.
// =====================================================================
console.log('— SCANNER: makeStats —');
{
  const a = makeStats();
  const b = makeStats();
  a.filesScanned++;
  a.skipped.ios++;
  if (b.filesScanned === 0 && b.skipped.ios === 0 && b.skipped.notXpath === 0) ok();
  else fail(`makeStats: instances share state ${JSON.stringify(b)}`);
}

console.log('— SCANNER: walkDir —');
{
  const root = makeTempRoot('uisel-walk-');
  try {
    mkdirSync(join(root, 'src', 'pages'), { recursive: true });
    mkdirSync(join(root, 'node_modules', 'pkg'), { recursive: true });
    mkdirSync(join(root, '.gradle'));
    writeFileSync(join(root, 'src', 'a.js'), '// a');
    writeFileSync(join(root, 'src', 'pages', 'b.kt'), '// b');
    writeFileSync(join(root, 'node_modules', 'pkg', 'c.js'), '// ignored');
    writeFileSync(join(root, '.gradle', 'd.kts'), '// ignored');

    const visited = [];
    walkDir(root, p => visited.push(p.slice(root.length + 1).replace(/\\/g, '/')));
    const expected = ['src/a.js', 'src/pages/b.kt'];
    if (JSON.stringify(visited.sort()) === JSON.stringify(expected)) ok();
    else fail(`walkDir: expected ${JSON.stringify(expected)}, got ${JSON.stringify(visited)}`);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

console.log('— SCANNER: processFile —');
{
  // dry-run: the file stays untouched even when locators convert
  const source = `const loc = '//android.widget.Button[@text="OK"]';`;
  const { records, stats, after } = scan('a.js', source, { dryRun: true });
  if (after === source) ok();
  else fail(`dry-run: file changed on disk\n     after: ${after}`);
  if (stats.filesScanned === 1 && stats.locatorsFound === 1 && stats.locatorsUpdated === 1) ok();
  else fail(`dry-run: stats wrong ${JSON.stringify(stats)}`);
  if (records.length === 1 && records[0].changed && records[0].status === STATUS.SUCCESS) ok();
  else fail(`dry-run: records wrong ${JSON.stringify(records)}`);
}

{
  // write mode, per quote kind: the UiSelector's `"` is escaped only where the
  // string itself is double-quoted
  const cases = [
    ['a.js', `const loc = '//android.widget.Button[@text="OK"]';`, `const loc = '${OUT}';`],
    ['a.js', 'const loc = `//android.widget.Button[@text="OK"]`;', `const loc = \`${OUT}\`;`],
    ['A.java', `String loc = "//android.widget.Button[@text='OK']";`, `String loc = "${OUT.replace(/"/g, '\\"')}";`],
    ['a.json', `{ "login": "//android.widget.Button[@text='OK']" }`, `{ "login": "${OUT.replace(/"/g, '\\"')}" }`],
  ];
  for (const [name, source, expected] of cases) {
    const { after, stats } = scan(name, source);
    if (after === expected && stats.locatorsUpdated === 1) ok();
    else fail(`write (${name})\n     expected: ${expected}\n     got:      ${after}`);
  }
}

{
  // unsupported extension: no stats, no records
  const { stats, records } = scan('a.unknown', `const loc = '//android.widget.Button';`);
  if (stats.filesScanned === 0 && records.length === 0) ok();
  else fail(`unsupported extension scanned: ${JSON.stringify(stats)}`);
}

{
  // the real (placeholder) converter: found and skipped with its reason, file untouched
  const source = `const loc = '//android.widget.Button[@text="OK"]';`;
  const { after, stats, records } = scan('a.js', source, { convert: undefined });
  if (after === source && stats.locatorsFound === 1 && stats.skipped.unsupportedLogic === 1
    && records[0].reason === 'converter not implemented yet') ok();
  else fail(`placeholder converter via scanner: ${JSON.stringify({ after, stats, records })}`);
}

{
  // grouped positions and absolute paths are captured; a warning is counted
  const { after, stats, records } = scan('a.js', [
    `const a = '(//android.widget.Button)[2]';`,
    `const b = '/hierarchy/android.widget.FrameLayout/android.widget.Button';`,
  ].join('\n'));
  if (stats.locatorsFound === 2 && stats.locatorsUpdated === 2 && stats.warnings === 1
    && records[0].warning === 'close form' && !records[1].warning && after.split(OUT).length === 3) ok();
  else fail(`grouped / absolute: ${JSON.stringify({ stats, records })}`);
}

{
  // iOS: an `ios:` key or an XCUIElementType step is skipped and counted;
  // `android:` and unkeyed strings convert
  const { stats } = scan('a.js', [
    `const p = { ios: '//XCUIElementTypeButton[@name="OK"]', android: '//android.widget.Button[@text="OK"]' };`,
    `const q = '//XCUIElementTypeStaticText[@label="Hi"]';`,
    `const r = '//*[@text="Hi"]';`,
    `const u = '//cdn.example.com/lib.js';`, // not a locator: ignored entirely
  ].join('\n'));
  if (stats.locatorsFound === 4 && stats.locatorsUpdated === 2 && stats.skipped.ios === 2) ok();
  else fail(`ios skip: ${JSON.stringify(stats)}`);
}

{
  // `ios:` inside a ternary and on the previous line; `android:` on the same line is not affected
  const { stats } = scan('a.js', [
    `const loc = {`,
    `  ios: single ? someCode : '//*[@name="OK"]',`,
    `  android: '//*[@text="OK"]',`,
    `  other: {`,
    `    ios:`,
    `      '//*[@name="Hello"]',`,
    `  },`,
    `};`,
  ].join('\n'));
  if (stats.locatorsFound === 3 && stats.locatorsUpdated === 1 && stats.skipped.ios === 2) ok();
  else fail(`ios ternary / previous line: ${JSON.stringify(stats)}`);
}

{
  // 'XCUIElementType' inside a quoted value is text, not an iOS step
  const { stats } = scan('a.js', `const loc = '//*[@text="XCUIElementTypeButton docs"]';`);
  if (stats.skipped.ios === 0 && stats.locatorsUpdated === 1) ok();
  else fail(`ios text in value: ${JSON.stringify(stats)}`);
}

{
  // a multi-line template literal is matched
  const { stats } = scan('a.js', 'const loc = `//android.widget.TextView\n  [@text="hello"]`;', { dryRun: true });
  if (stats.locatorsFound === 1) ok();
  else fail(`multiline: locatorsFound=${stats.locatorsFound}`);
}

// =====================================================================
// SCANNER: explicit XPath strategies (carried over from xpath-to-class-chain,
// RC-S1, RC-S2). Skipped until the call rewrite of stage 4.
// =====================================================================
console.log('— SCANNER: xpath strategies —');
{
  const DQ = `//android.widget.Button[@text='OK']`; // for double-quoted strings
  const SQ = `//android.widget.Button[@text="OK"]`; // for single-quoted strings
  // [file, source, marker shown in the skip reason]
  const XPATH_STRATEGY_CASES = [
    // Java
    ['A.java', `e = driver.findElement(AppiumBy.xpath("${DQ}"));`, 'AppiumBy.xpath('],
    ['A.java', `e = driver.findElement(By.xpath("${DQ}"));`, 'By.xpath('],
    ['A.java', `e = driver.findElement(MobileBy.xpath("${DQ}"));`, 'MobileBy.xpath('],
    ['A.java', `@AndroidFindBy(xpath = "${DQ}")\nWebElement e;`, '@AndroidFindBy(xpath ='],
    ['A.java', `@AndroidFindBy(priority = 1, xpath = "${DQ}")\nWebElement e;`, '@AndroidFindBy(priority = 1, xpath ='],
    ['A.java', `@AndroidFindBys({@AndroidBy(xpath = "${DQ}")})\nWebElement e;`, '@AndroidBy(xpath ='],
    ['A.java', `@FindBy(xpath = "${DQ}")\nWebElement e;`, '@FindBy(xpath ='],
    ['A.java', `@FindBy(how = How.XPATH, using = "${DQ}")\nWebElement e;`, 'How.XPATH, using ='],
    ['A.java', `e = driver.findElementByXPath("${DQ}");`, 'findElementByXPath('],
    ['A.java', `e = driver.findElement(\n    AppiumBy.xpath(\n        "${DQ}"));`, 'AppiumBy.xpath('],
    ['A.java', `@AndroidFindBy(\n    xpath = "${DQ}"\n)\nWebElement e;`, '@AndroidFindBy(xpath ='],
    // Kotlin / Groovy
    ['A.kt', `val e = driver.findElement(AppiumBy.xpath("${DQ}"))`, 'AppiumBy.xpath('],
    ['A.kt', `@AndroidFindBy(xpath = "${DQ}")\nlateinit var e: WebElement`, '@AndroidFindBy(xpath ='],
    ['A.groovy', `def e = driver.findElement(By.xpath('${SQ}'))`, 'By.xpath('],
    // Python
    ['a.py', `e = driver.find_element(AppiumBy.XPATH, '${SQ}')`, 'AppiumBy.XPATH'],
    ['a.py', `B0 = (By.XPATH, "${DQ}")`, 'By.XPATH'],
    ['a.py', `e = driver.find_element(MobileBy.XPATH, '${SQ}')`, 'MobileBy.XPATH'],
    ['a.py', `e = driver.find_element("xpath", '${SQ}')`, '"xpath"'],
    ['a.py', `e = driver.find_element(by=AppiumBy.XPATH, value='${SQ}')`, 'AppiumBy.XPATH'],
    ['a.py', `e = driver.find_element(\n    AppiumBy.XPATH,\n    '${SQ}',\n)`, 'AppiumBy.XPATH'],
    ['a.py', `e = driver.find_element_by_xpath('${SQ}')`, 'find_element_by_xpath('],
    // C#
    ['A.cs', `var e = driver.FindElement(MobileBy.XPath("${DQ}"));`, 'MobileBy.XPath('],
    ['A.cs', `var e = driver.FindElement(By.XPath("${DQ}"));`, 'By.XPath('],
    ['A.cs', `var e = driver.FindElement("xpath", "${DQ}");`, '"xpath"'],
    ['A.cs', `[FindsByAndroidUIAutomator(XPath = "${DQ}")]\nprivate IWebElement e;`, 'FindsByAndroidUIAutomator(XPath ='],
    ['A.cs', `[FindsBy(How = How.XPath, Using = "${DQ}")]\nprivate IWebElement e;`, 'How.XPath, Using ='],
    ['A.cs', `var e = driver.FindElementByXPath("${DQ}");`, 'FindElementByXPath('],
    // Ruby
    ['a.rb', `e = driver.find_element(:xpath, '${SQ}')`, ':xpath'],
    ['a.rb', `e = driver.find_element :xpath => '${SQ}'`, ':xpath'],
    ['a.rb', `e = driver.find_element(xpath: '${SQ}')`, 'xpath:'],
    ['a.rb', `e = xpath('${SQ}')`, 'xpath('],
    ['a.rb', `e = xpaths '${SQ}'`, 'xpaths'],
    // JS / TS
    ['a.js', `I.click({ xpath: '${SQ}' });`, 'xpath:'],
    ['a.js', `const loc = {\n  xpath:\n    '${SQ}',\n};`, 'xpath:'],
    ['a.js', 'I.click({ xpath: `//android.widget.Button[@text="${name}"]` });', 'xpath:'],
    ['a.js', `const e = await driver.findElement('xpath', '${SQ}');`, "'xpath'"],
    ['a.js', `const e = await driver.findElement(By.xpath('${SQ}'));`, 'By.xpath('],
    ['a.ts', `const e = await driver.findElements('xpath', '${SQ}');`, "'xpath'"],
    // PHP
    ['a.php', `$e = $driver->findElement(WebDriverBy::xpath('${SQ}'));`, 'WebDriverBy::xpath('],
  ];

  // No explicit XPath strategy: these convert.
  const CONVERT_CASES = [
    ['a.js', `const a = '${SQ}';`],
    ['a.js', `I.click('${SQ}');`],
    ['a.js', `const xpath = '${SQ}';`], // a variable name is not a strategy
    ['a.ts', `export const s = () => $('${SQ}');`],
    ['a.ts', 'export const d = () => $(`//android.widget.Button[@text="${name}"]`);'],
    ['A.java', `static final String LOC = "${DQ}";`],
    ['A.java', `String xpath = "${DQ}";`],
    ['A.kt', `const val LOC = "${DQ}"`],
    ['a.py', `LOC = '${SQ}'`],
    ['a.rb', `LOC = '${SQ}'`],
  ];

  for (const [name, source, marker] of XPATH_STRATEGY_CASES) {
    const { records, stats, after } = scan(name, source);
    const reason = `xpath strategy: ${marker}`;
    if (after === source && stats.locatorsUpdated === 0 && stats.skipped.xpathStrategy === 1
      && records.length === 1 && records[0].status === STATUS.SKIPPED_XPATH_STRATEGY && records[0].reason === reason) ok();
    else fail(`xpath strategy (${name}) ${JSON.stringify(source)}\n     expected: untouched, reason ${JSON.stringify(reason)}\n     got:      ${after === source ? 'untouched' : 'REWRITTEN'}, records=${JSON.stringify(records)}`);
  }

  for (const [name, source] of CONVERT_CASES) {
    const { stats, after } = scan(name, source);
    if (after !== source && after.includes('new UiSelector()') && stats.locatorsUpdated === 1 && !stats.skipped.xpathStrategy) ok();
    else fail(`no xpath strategy (${name}) ${JSON.stringify(source)}\n     expected: converted\n     got:      ${after}  stats=${JSON.stringify(stats)}`);
  }

  // iOS detection runs first: an iOS locator under an XPath strategy stays an iOS skip.
  {
    const { stats } = scan('A.java', `@iOSXCUITFindBy(xpath = "//XCUIElementTypeButton[@name='OK']")\nWebElement e;`);
    if (stats.skipped.ios === 1 && !stats.skipped.xpathStrategy) ok();
    else fail(`xpath strategy ios: expected ios=1 xpathStrategy=0, got ${JSON.stringify(stats.skipped)}`);
  }

  // Only the call the string is passed to counts: an XPath call that closed
  // earlier on the same line does not affect the next string.
  {
    const source = `driver.findElement(By.xpath("//a")); String loc = "${DQ}";`;
    const { stats, after } = scan('A.java', source);
    if (after !== source && stats.locatorsUpdated === 1 && !stats.skipped.xpathStrategy) ok();
    else fail(`xpath strategy closed call: got ${after}  stats=${JSON.stringify(stats)}`);
  }
}

// =====================================================================
// SCANNER: refusals — inputs the scanner must decline to touch.
// =====================================================================
console.log('— SCANNER: refusals —');
{
  // A file that is not valid UTF-8 is left byte-for-byte alone: decoding
  // latin-1 as utf8 would replace every undecodable byte in the whole file.
  const root = makeTempRoot('uisel-latin1-');
  try {
    const file = join(root, 'legacy.properties');
    const before = Buffer.concat([
      Buffer.from('x=//android.widget.Button[@text="caf'),
      Buffer.from([0xe9]),
      Buffer.from('"]\n'),
    ]);
    writeFileSync(file, before);
    const records = [];
    const stats = makeStats();
    processFile(file, { dryRun: false, quiet: true, convert: FAKE }, records, stats);
    if (readFileSync(file).equals(before) && stats.filesScanned === 0 && records.length === 0) ok();
    else fail(`non-UTF-8: file modified or scanned; stats=${JSON.stringify(stats)}`);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

{
  // A UTF-8 file with a BOM is valid and still processed.
  const { stats } = scan('a.js', '﻿' + `const l = '//android.widget.Button[@text="OK"]';`);
  if (stats.locatorsUpdated === 1) ok();
  else fail(`BOM: expected the file to be processed; stats=${JSON.stringify(stats)}`);
}

{
  // walkDir never follows a symlink out of the target tree.
  const root = makeTempRoot('uisel-symlink-');
  try {
    const target = join(root, 'target');
    const outside = join(root, 'outside');
    mkdirSync(target);
    mkdirSync(outside);
    writeFileSync(join(target, 'a.js'), '// in tree');
    writeFileSync(join(outside, 'secret.js'), '// out of tree');
    let linked = true;
    try {
      symlinkSync(outside, join(target, 'escape'), 'junction');
    } catch {
      linked = false;
    }
    const visited = [];
    if (linked) walkDir(target, p => visited.push(p));
    if (!visited.some(p => p.includes('secret'))) ok();
    else fail(`walkDir: followed a symlink out of the tree, visited ${JSON.stringify(visited)}`);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

{
  // An unreadable/missing directory is reported and stepped over.
  let threw = false;
  try {
    walkDir(join(tmpdir(), 'uisel-does-not-exist-' + Date.now()), () => {});
  } catch {
    threw = true;
  }
  if (!threw) ok();
  else fail('walkDir: an unreadable directory aborted the scan');
}

{
  // Records name files relative to the scan root; the bare name without one.
  const root = makeTempRoot('uisel-relpath-');
  try {
    mkdirSync(join(root, 'pages'));
    const file = join(root, 'pages', 'index.ts');
    writeFileSync(file, `const l = '//android.widget.Button[@text="OK"]';`);
    const rel = [];
    processFile(file, { dryRun: true, quiet: true, rootDir: root, convert: FAKE }, rel, makeStats());
    const bare = [];
    processFile(file, { dryRun: true, quiet: true, convert: FAKE }, bare, makeStats());
    if (rel[0] && rel[0].file === 'pages/index.ts' && bare[0] && bare[0].file === 'index.ts') ok();
    else fail(`relative paths: got ${JSON.stringify([rel[0], bare[0]])}`);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

// =====================================================================
// CLI — runs the real binary: the guards live in the `require.main` block.
// =====================================================================
console.log('— CLI —');
{
  const SOURCE = 'const a = "//android.widget.Button[@text=\'Go\']";\n';
  const runInFixture = args => {
    const root = makeTempRoot('uisel-cli-');
    try {
      mkdirSync(join(root, 'tests'));
      const file = join(root, 'tests', 'spec.js');
      writeFileSync(file, SOURCE);
      let status = 0;
      let stdout = '';
      try {
        stdout = execFileSync(process.execPath, [CLI, ...args], { cwd: root, stdio: 'pipe', timeout: 20000 }).toString();
      } catch (e) {
        status = e.status === undefined ? -1 : e.status;
      }
      let report = null;
      try {
        report = JSON.parse(readFileSync(join(root, 'xpath-to-uiselector.report.json'), 'utf8'));
      } catch {}
      return { status, stdout, report, untouched: readFileSync(file, 'utf8') === SOURCE };
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  };

  // The bare command previews the default folder: safe to type.
  {
    const { status, untouched } = runInFixture([]);
    if (status === 0 && untouched) ok();
    else fail(`CLI bare command: exit ${status}, ${untouched ? 'untouched' : 'MODIFIED'}`);
  }
  // --write with no path is refused outright.
  {
    const { status, untouched } = runInFixture(['--write']);
    if (status === 1 && untouched) ok();
    else fail(`CLI bare --write: exit ${status}, ${untouched ? 'untouched' : 'MODIFIED'} (expected exit 1)`);
  }
  // An explicit path is accepted. With the placeholder converter nothing is
  // written yet; stage 4 turns this into "written".
  {
    const { status, untouched } = runInFixture(['./tests', '--write']);
    if (status === 0 && untouched) ok();
    else fail(`CLI explicit --write: exit ${status}`);
  }
  // A single file is a valid target; the report names it relative to its folder.
  {
    const { status, report } = runInFixture(['./tests/spec.js', '--json']);
    if (status === 0 && report && report.stats.filesScanned === 1 && report.stats.locatorsFound === 1
      && report.skipped.length === 1 && report.skipped[0].file === 'spec.js'
      && report.skipped[0].reason === 'converter not implemented yet') ok();
    else fail(`CLI single file --json: exit ${status}, report=${JSON.stringify(report)}`);
  }
  // Unknown flags and missing paths exit 1.
  {
    const a = runInFixture(['./tests', '--wirte']);
    const b = runInFixture(['./missing']);
    if (a.status === 1 && b.status === 1) ok();
    else fail(`CLI refusals: unknown flag exit ${a.status}, missing path exit ${b.status}`);
  }
  // --version prints the package version.
  {
    const { status, stdout } = runInFixture(['--version']);
    if (status === 0 && stdout.trim() === require('./package.json').version) ok();
    else fail(`CLI --version: exit ${status}, got ${JSON.stringify(stdout)}`);
  }
}

// =====================================================================
// REGEX SAFETY — a run of backslashes in an unterminated string once made
// the scanning regex backtrack exponentially. Run in a child process with a
// hard timeout so a hang fails the suite instead of stalling it.
// =====================================================================
console.log('— REGEX SAFETY —');
{
  const budgetMs = 5000;
  const script = `
    const { processFile, makeStats } = require(${JSON.stringify(join(__dirname, 'lib', 'scanner'))});
    const { mkdtempSync, writeFileSync, rmSync } = require('fs');
    const { tmpdir } = require('os');
    const { join } = require('path');
    const root = mkdtempSync(join(tmpdir(), 'uisel-redos-'));
    try {
      const f = join(root, 'a.js');
      writeFileSync(f, 'const l = "//android.widget.Button' + '\\\\'.repeat(200));
      processFile(f, { dryRun: true, quiet: true }, [], makeStats());
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  `;
  try {
    execFileSync(process.execPath, ['-e', script], { timeout: budgetMs, stdio: 'pipe' });
    ok();
  } catch (e) {
    fail(`REGEX SAFETY scanner (200 backslashes): ${e.killed || e.signal ? `did not finish within ${budgetMs}ms` : e.message}`);
  }
}

console.log(`\n${failed === 0 ? '✅' : '⚠️'} ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
