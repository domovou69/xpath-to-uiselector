// Zero-dependency test runner: `node xpath-to-uiselector.test.js`
// Exit code is non-zero on any failure. Add a row and re-run.
//
// The scanner is tested with an injected fake converter (`FAKE`), which keeps
// the file handling — preview vs. write, quoting, platform keys, strategy
// rewrites, refusals — independent of the conversion rules. The rules are
// tested on the converter itself: every S case (audit/spec/score.js) plus the
// CONVERTER rows below.
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
// CONVERTER — every S case scores CORRECT / CORRECT-SKIP (0 WRONG, 0 GAP),
// plus rows the S cases do not cover. [xpath, expected UiSelector | null
// (skip), warning expected, opts]
// =====================================================================
console.log('— CONVERTER: S cases —');
{
  const { score } = require('./audit/spec/score');
  const { rows, totals } = score();
  for (const r of rows.filter(x => x.verdict === 'WRONG' || x.verdict === 'GAP' || x.verdict === 'DRIFT')) {
    fail(`S ${r.verdict} ${r.c.id} ${r.c.xpath}\n     expected: ${r.c.uiselector || `skip (${r.c.reason})`}\n     got:      ${r.res.status} ${r.res.locator}${r.res.warning ? ` ! ${r.res.warning}` : ''}`);
  }
  if (!totals.WRONG && !totals.GAP && !totals.DRIFT) ok();
}

console.log('— CONVERTER: more rows —');
{
  const U = 'new UiSelector()';
  const R = '\uF8FF'; // a runtime value, as the scanner passes it
  const RT = { placeholders: new Set([R]) };
  const CONVERT_CASES = [
    ['(//*[@text="A"] | //*[@text="B"])[2]', `${U}.textMatches("A|B").instance(1)`],
    ['//*[@text="A"] | //*[@text="B"] | //*[@text="C"]', `${U}.textMatches("A|B|C")`],
    ['//*[@text="A"] | //*[@text="A"]', `${U}.text("A")`],
    ['//*[contains(@text,"a") or starts-with(@text,"b")]', `${U}.textMatches("(?s).*a.*|b.*")`],
    ['//*[ends-with(@text,"a") and contains(@text,"b")]', String.raw`${U}.textMatches("(?s)(?=.*a\z)(?=.*b).*")`],
    ['//*[@text="ab" and (starts-with(@text,"a") or ends-with(@text,"b"))]', String.raw`${U}.textMatches("(?s)(?=(?:a.*|.*b)\z)ab")`],
    ['//*[@resource-id="id/x" and @text="y"]', `${U}.resourceId("id/x").text("y")`],
    ['//*[@clickable=false()]', `${U}.clickable(false)`],
    ['//*[not(@checked="false")]', `${U}.checked(true)`],
    ['//*["OK"=@text]', `${U}.text("OK")`],
    ['//android.widget.Button[@class="android.widget.Button"]', `${U}.className("android.widget.Button")`],
    ['//*[@class="android.widget.Button"][@text="OK"]', `${U}.className("android.widget.Button").text("OK")`],
    ['//*[fn:contains(@text,"a")]', `${U}.textMatches("(?s).*a.*")`],
    ['//*[matches(@resource-id,"^id/x$")]', `${U}.resourceIdMatches("(?d)(?s:.*)(?-s:^id/x$)(?s:.*)")`],
    [`//*[matches(@text,'say \\"hi\\"')]`, String.raw`${U}.textMatches("(?d)(?s:.*)(?-s:say \x22hi\x22)(?s:.*)")`],
    ['//*[@text="a"]//*[@text="b"]//*[@text="c"]', `${U}.text("a").childSelector(${U}.text("b").childSelector(${U}.text("c")))`, true],
    ['//*[@content-desc=("a","")]', `${U}.descriptionMatches("a|")`],
    ['//*[@text="Ünïcödé 😀"]', `${U}.text("Ünïcödé 😀")`],
    ['//*[@index=3][@enabled="true"]', `${U}.index(3).enabled(true)`],
    ['//*[self::android.widget.Button][@text="OK"]', `${U}.className("android.widget.Button").text("OK")`],
    [`//*[@text="Hi ${R}"]`, `${U}.text("Hi ${R}")`, true, RT],
    [`//*[contains(@text,"${R}")]`, String.raw`${U}.textMatches("(?s).*\Q${R}\E.*")`, true, RT],
    [`//*[@text="${R}"]`, `${U}.text("${R}")`, false], // without opts it is an ordinary character
    // skipped
    ['//XCUIElementTypeButton', null],
    ['//*[@text="a"]//*[@text="b"] | //*[@text="c"]', null],
    ['(//*[@text="a"]//*[@text="b"])[1]', null],
    ['((//*[@text="a"])[1])[1]', null],
    ['(//*[@text="a"])[0]', null],
    ['(//*[@text="a"])[1.5]', null],
    ['//android.widget.Button[@class="android.widget.Text"]', null],
    ['//*[@checked="true"][@checked="false"]', null],
    ['//*[@text="OK" and not(@text="OK")]', null],
    ['//*[matches(@text,"(a")]', null],
    ['//*[matches(@text,"(a)\\1")]', null],
    ['//*[matches(@text,"a","x")]', null],
    ['//*[matches(@text,"a") and contains(@text,"b")]', null],
    ['//*[lower-case(@text)="OK"]', null],
    ['//*[lower-case(@text)="ok" and @text="ok"]', null],
    ['//*[starts-with(@content-desc,"")]', null],
    ['//*[@package=""]', null],
    ['//*[@index=-1]', null],
    ['//*[@text=$x]', null],
    ['//*[@text="a"]/following::*', null],
    ['//*[@text="a" or @text="b" or @checked="true"]', null],
    ['//@text', null],
    ['/android.widget.Button', null],
    ['./android.widget.Button', null],
    ['android.widget.Button', null],
    ['//node()', null],
    ['//*[.="a"]', null],
    ['//*[@text]', null],
    ['//*[self::android.widget.Button or self::android.view.View]', null],
    ['//*[@text="a"] | //*[@text="b"][@checked="true"]', null],
    ['//*[count(*)=2]', null],
    ['//*[@text < "b"]', null],
    ['//*[1 + 1]', null],
    ['//*[substring(@text,string-length(@text)-1)="a"]', null],
    ['//*[', null],
    ['', null],
    ['//*[@text="a"]]', null],
    [`//${R}`, null, false, RT],
    [`//*[matches(@text,"${R}")]`, null, false, RT],
  ];
  for (const [xpath, want, warn, opts] of CONVERT_CASES) {
    const res = convertXpathToUiSelector(xpath, opts);
    const good = want === null
      ? res.status !== STATUS.SUCCESS && res.reason && res.locator === xpath
      : res.status === STATUS.SUCCESS && res.locator === want && Boolean(res.warning) === Boolean(warn);
    if (good) ok();
    else fail(`CONVERT ${xpath}\n     expected: ${want === null ? 'skip' : want}${warn ? ' (warning)' : ''}\n     got:      ${res.status} ${res.locator}${res.reason ? ` (${res.reason})` : ''}${res.warning ? ` ! ${res.warning}` : ''}`);
  }
  // iOS element types are their own status
  if (convertXpathToUiSelector('//XCUIElementTypeButton').status === STATUS.SKIPPED_IOS) ok();
  else fail('CONVERT XCUIElementType: expected skipped_ios');
}

// =====================================================================
// REGEX — can a Java regex match ""? (lib/regex.js, for matches(), XP-03)
// [pattern, true | false | 'throws']
// =====================================================================
console.log('— REGEX —');
{
  const { matchesEmpty } = require('./lib/regex');
  const REGEX_CASES = [
    ['a*', true], ['a+', false], ['a?b', false], ['^$', true], ['(?:a|)', true], ['a|b*', true],
    ['[a-z&&[^aeiou]]+', false], ['[]a]', false], ['[^]]*', true], [String.raw`\Qab\E`, false], [String.raw`\Q\E`, true],
    ['a{0,2}', true], ['a{2}', false], ['(?i)', true], ['(?=a)', true], ['(?<!a)b', false], [String.raw`\d+`, false],
    [String.raw`\b`, true], [String.raw`\p{Lu}+`, false], [String.raw`\x41`, false], ['(?<name>a)?', true], ['a*+', true], ['a+?', false],
    ['(a', 'throws'], ['a)', 'throws'], [String.raw`(a)\1`, 'throws'], ['*a', 'throws'], ['[a', 'throws'], ['a**', 'throws'],
  ];
  for (const [pattern, want] of REGEX_CASES) {
    let got;
    try { got = matchesEmpty(pattern); } catch { got = 'throws'; }
    if (got === want) ok();
    else fail(`REGEX ${pattern}: expected ${want}, got ${got}`);
  }
}

// =====================================================================
// LITERAL — source literal ↔ runtime value, per language and quote kind
// (lib/literal.js). [ext, quote, prefix, raw, value with ‹…› for runtime
// parts | null (not read)]; every row that reads must also write back to raw.
// =====================================================================
console.log('— LITERAL —');
{
  const { literalKind, decodeLiteral, encodeLiteral } = require('./lib/literal');
  const LITERAL_CASES = [
    ['.java', '"', '', String.raw`//*[@text=\"OK\"]`, '//*[@text="OK"]'],
    ['.java', '"', '', String.raw`//*[@text='C:\\Temp']`, String.raw`//*[@text='C:\Temp']`],
    ['.java', '"', '', String.raw`//*[@text='%s']`, "//*[@text='‹%s›']"],
    ['.java', '"', '', String.raw`//*[@text='\u00e9']`, "//*[@text='é']", false],
    ['.java', '"', '', String.raw`//*[@text='\d']`, null],
    ['.java', '"', '', String.raw`//*[@text='\uf8ff%s']`, "//*[@text='\uf8ff‹%s›']", false], // a placeholder never reuses an escaped character
    ['.java', '"', '', String.raw`//*[@text='\uE163']`, "//*[@text='\uE163']"], // written back as an escape
    ['.kt', '"', '', "//*[@text='$name']", "//*[@text='‹$name›']"],
    ['.kt', '"', '', "//*[@text='${user.name}']", "//*[@text='‹${user.name}›']"],
    ['.kt', '"', '', String.raw`//*[@text='\$5']`, "//*[@text='$5']"],
    ['.js', '`', '', '//*[@text="${x}"]', '//*[@text="‹${x}›"]'],
    ['.js', "'", '', '//*[@text="${x}"]', '//*[@text="${x}"]'],
    ['.js', '`', '', String.raw`//*[@text="\${x}"]`, '//*[@text="${x}"]', false],
    ['.py', "'", '', '//*[@text="%s"]', '//*[@text="‹%s›"]'],
    ['.py', "'", 'f', '//*[@text="{name}"] or {{x}}', '//*[@text="‹{name}›"] or {x}'],
    ['.py', "'", 'r', String.raw`//*[@text="a\b"]`, String.raw`//*[@text="a\b"]`],
    ['.cs', '"', '', "//*[@text='{0}']", "//*[@text='‹{0}›']"],
    ['.cs', '"', '$', "//*[@text='{name}']", "//*[@text='‹{name}›']"],
    ['.cs', '"', '@', '//*[@text=""OK""]', '//*[@text="OK"]'],
    ['.rb', '"', '', "//*[@text='#{name}']", "//*[@text='‹#{name}›']"],
    ['.rb', "'", '', String.raw`//*[@text=\'a\']`, "//*[@text='a']"],
    ['.json', '"', '', String.raw`//*[@text=\"a\/b\"]`, '//*[@text="a/b"]', false],
    ['.yaml', '"', '', String.raw`//*[@text=\"a\"]`, String.raw`//*[@text=\"a\"]`, false], // data files are never written
  ];
  for (const [ext, quote, prefix, raw, want, roundTrip = true] of LITERAL_CASES) {
    const kind = literalKind(ext, quote, prefix);
    const res = decodeLiteral(raw, kind, quote);
    const shown = res && [...res.value].map(ch => (res.placeholders.has(ch) ? `‹${res.placeholders.get(ch)}›` : ch)).join('');
    const back = res && encodeLiteral(res.value, kind, quote, res.placeholders);
    if (want === null ? res === null : shown === want && (!roundTrip || back === raw)) ok();
    else fail(`LITERAL ${ext} ${prefix}${quote}${raw}${quote}\n     expected: ${want}\n     got:      ${shown}  (written back: ${back})`);
  }
  // A UiSelector with \x5c and quotes written into each kind.
  const OUT_RX = String.raw`new UiSelector().textMatches("C:\x5cTemp")`;
  const ENCODE_CASES = [
    ['.java', '"', '', String.raw`new UiSelector().textMatches(\"C:\\x5cTemp\")`],
    ['.js', "'", '', String.raw`new UiSelector().textMatches("C:\\x5cTemp")`],
    ['.py', "'", 'r', String.raw`new UiSelector().textMatches("C:\x5cTemp")`],
    ['.py', '"', 'r', null], // a raw string cannot hold its own quote
    ['.cs', '"', '@', String.raw`new UiSelector().textMatches(""C:\x5cTemp"")`],
    ['.kt', '"', '', String.raw`new UiSelector().textMatches(\"C:\\x5cTemp\")`],
  ];
  for (const [ext, quote, prefix, want] of ENCODE_CASES) {
    const got = encodeLiteral(OUT_RX, literalKind(ext, quote, prefix), quote, new Map());
    if (got === want) ok();
    else fail(`ENCODE ${ext} ${prefix}${quote}: expected ${want}, got ${got}`);
  }
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
  // string itself is double-quoted. A JS/TS string with no strategy call is a
  // WebdriverIO selector (android=…).
  const cases = [
    ['a.js', `const loc = '//android.widget.Button[@text="OK"]';`, `const loc = 'android=${OUT}';`],
    ['a.js', 'const loc = `//android.widget.Button[@text="OK"]`;', `const loc = \`android=${OUT}\`;`],
    ['a.js', `const loc = "//android.widget.Button[@text='OK']";`, `const loc = "android=${OUT.replace(/"/g, '\\"')}";`],
    ['A.java', `e = driver.findElement(AppiumBy.xpath("//android.widget.Button[@text='OK']"));`, `e = driver.findElement(AppiumBy.androidUIAutomator("${OUT.replace(/"/g, '\\"')}"));`],
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
  // the real converter: a skip keeps the file and records the reason
  const source = `const loc = '//android.widget.Button[2]';`;
  const { after, stats, records } = scan('a.js', source, { convert: undefined });
  if (after === source && stats.locatorsFound === 1 && stats.skipped.unsupportedLogic === 1
    && records[0].reason === 'a position among siblings has no UiSelector form') ok();
  else fail(`real converter skip via scanner: ${JSON.stringify({ after, stats, records })}`);
}

{
  // no strategy call outside JS/TS, and data files: untouched, reported with the UiSelector
  for (const [name, source] of [
    ['A.java', `String loc = "//android.widget.Button[@text='OK']";`],
    ['a.json', `{ "login": "//android.widget.Button[@text='OK']" }`],
    ['a.yaml', `login: "//android.widget.Button[@text='OK']"`],
  ]) {
    const { after, stats, records } = scan(name, source);
    if (after === source && stats.skipped.unknownStrategy === 1 && records[0].status === STATUS.SKIPPED_UNKNOWN_STRATEGY
      && records[0].uiselector === OUT) ok();
    else fail(`unknown strategy (${name}): ${JSON.stringify({ after, stats, records })}`);
  }
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
  const OUT_DQ = OUT.replace(/"/g, '\\"');
  // The string rewritten, and the strategy text `from` → `to` (null: the
  // client has no UiAutomator strategy, so the file stays as it is).
  // [file, source, marker shown in the report, from, to]
  const XPATH_STRATEGY_CASES = [
    // Java
    ['A.java', `e = driver.findElement(AppiumBy.xpath("${DQ}"));`, 'AppiumBy.xpath(', 'AppiumBy.xpath(', 'AppiumBy.androidUIAutomator('],
    ['A.java', `e = driver.findElement(By.xpath("${DQ}"));`, 'By.xpath(', 'By.xpath(', 'io.appium.java_client.AppiumBy.androidUIAutomator('],
    ['A.java', `import io.appium.java_client.AppiumBy;\ne = driver.findElement(By.xpath("${DQ}"));`, 'By.xpath(', 'By.xpath(', 'AppiumBy.androidUIAutomator('],
    ['A.java', `import io.appium.java_client.MobileBy;\ne = driver.findElement(By.xpath("${DQ}"));`, 'By.xpath(', 'By.xpath(', 'MobileBy.AndroidUIAutomator('],
    ['A.java', `e = driver.findElement(MobileBy.xpath("${DQ}"));`, 'MobileBy.xpath(', 'MobileBy.xpath(', 'MobileBy.AndroidUIAutomator('],
    ['A.java', `@AndroidFindBy(xpath = "${DQ}")\nWebElement e;`, '@AndroidFindBy(xpath =', 'xpath =', 'uiAutomator ='],
    ['A.java', `@AndroidFindBy(priority = 1, xpath = "${DQ}")\nWebElement e;`, '@AndroidFindBy(priority = 1, xpath =', 'xpath =', 'uiAutomator ='],
    ['A.java', `@AndroidFindBys({@AndroidBy(xpath = "${DQ}")})\nWebElement e;`, '@AndroidBy(xpath =', 'xpath =', 'uiAutomator ='],
    ['A.java', `@FindBy(xpath = "${DQ}")\nWebElement e;`, '@FindBy(xpath =', null],
    ['A.java', `@FindBy(how = How.XPATH, using = "${DQ}")\nWebElement e;`, 'How.XPATH, using =', null],
    ['A.java', `e = driver.findElementByXPath("${DQ}");`, 'findElementByXPath(', null],
    ['A.java', `e = driver.findElement(\n    AppiumBy.xpath(\n        "${DQ}"));`, 'AppiumBy.xpath(', 'AppiumBy.xpath(', 'AppiumBy.androidUIAutomator('],
    ['A.java', `@AndroidFindBy(\n    xpath = "${DQ}"\n)\nWebElement e;`, '@AndroidFindBy(xpath =', 'xpath =', 'uiAutomator ='],
    // Kotlin / Groovy
    ['A.kt', `val e = driver.findElement(AppiumBy.xpath("${DQ}"))`, 'AppiumBy.xpath(', 'AppiumBy.xpath(', 'AppiumBy.androidUIAutomator('],
    ['A.kt', `@AndroidFindBy(xpath = "${DQ}")\nlateinit var e: WebElement`, '@AndroidFindBy(xpath =', 'xpath =', 'uiAutomator ='],
    ['A.groovy', `def e = driver.findElement(By.xpath('${SQ}'))`, 'By.xpath(', 'By.xpath(', 'io.appium.java_client.AppiumBy.androidUIAutomator('],
    // Python
    ['a.py', `e = driver.find_element(AppiumBy.XPATH, '${SQ}')`, 'AppiumBy.XPATH', 'AppiumBy.XPATH', 'AppiumBy.ANDROID_UIAUTOMATOR'],
    ['a.py', `B0 = (By.XPATH, "${DQ}")`, 'By.XPATH', 'By.XPATH', "'-android uiautomator'"],
    ['a.py', `from appium.webdriver.common.appiumby import AppiumBy\nB0 = (By.XPATH, "${DQ}")`, 'By.XPATH', 'By.XPATH', 'AppiumBy.ANDROID_UIAUTOMATOR'],
    ['a.py', `e = driver.find_element(MobileBy.XPATH, '${SQ}')`, 'MobileBy.XPATH', 'MobileBy.XPATH', 'MobileBy.ANDROID_UIAUTOMATOR'],
    ['a.py', `e = driver.find_element("xpath", '${SQ}')`, '"xpath"', '"xpath"', '"-android uiautomator"'],
    ['a.py', `e = driver.find_element(by=AppiumBy.XPATH, value='${SQ}')`, 'AppiumBy.XPATH', 'AppiumBy.XPATH', 'AppiumBy.ANDROID_UIAUTOMATOR'],
    ['a.py', `e = driver.find_element(\n    AppiumBy.XPATH,\n    '${SQ}',\n)`, 'AppiumBy.XPATH', 'AppiumBy.XPATH', 'AppiumBy.ANDROID_UIAUTOMATOR'],
    ['a.py', `e = driver.find_element_by_xpath('${SQ}')`, 'find_element_by_xpath(', null],
    // C#
    ['A.cs', `var e = driver.FindElement(MobileBy.XPath("${DQ}"));`, 'MobileBy.XPath(', 'MobileBy.XPath(', 'MobileBy.AndroidUIAutomator('],
    ['A.cs', `var e = driver.FindElement(By.XPath("${DQ}"));`, 'By.XPath(', 'By.XPath(', 'OpenQA.Selenium.Appium.MobileBy.AndroidUIAutomator('],
    ['A.cs', `var e = driver.FindElement("xpath", "${DQ}");`, '"xpath"', '"xpath"', '"-android uiautomator"'],
    ['A.cs', `[FindsByAndroidUIAutomator(XPath = "${DQ}")]\nprivate IWebElement e;`, 'FindsByAndroidUIAutomator(XPath =', 'XPath =', 'AndroidUIAutomator ='],
    ['A.cs', `[FindsBy(How = How.XPath, Using = "${DQ}")]\nprivate IWebElement e;`, 'How.XPath, Using =', null],
    ['A.cs', `var e = driver.FindElementByXPath("${DQ}");`, 'FindElementByXPath(', null],
    // Ruby
    ['a.rb', `e = driver.find_element(:xpath, '${SQ}')`, ':xpath', ':xpath', ':uiautomator'],
    ['a.rb', `e = driver.find_element :xpath => '${SQ}'`, ':xpath', ':xpath', ':uiautomator'],
    ['a.rb', `e = driver.find_element(xpath: '${SQ}')`, 'xpath:', 'xpath:', 'uiautomator:'],
    ['a.rb', `e = xpath('${SQ}')`, 'xpath(', null],
    ['a.rb', `e = xpaths '${SQ}'`, 'xpaths', null],
    // JS / TS
    ['a.js', `I.click({ xpath: '${SQ}' });`, 'xpath:', null],
    ['a.js', `const loc = {\n  xpath:\n    '${SQ}',\n};`, 'xpath:', null],
    ['a.js', 'I.click({ xpath: `//android.widget.Button[@text="${name}"]` });', 'xpath:', null],
    ['a.js', `const e = await driver.findElement('xpath', '${SQ}');`, "'xpath'", "'xpath'", "'-android uiautomator'"],
    ['a.js', `const e = await driver.findElement(By.xpath('${SQ}'));`, 'By.xpath(', null],
    ['a.ts', `const e = await driver.findElements('xpath', '${SQ}');`, "'xpath'", "'xpath'", "'-android uiautomator'"],
    // PHP
    ['a.php', `$e = $driver->findElement(WebDriverBy::xpath('${SQ}'));`, 'WebDriverBy::xpath(', null],
  ];

  for (const [name, source, marker, from, to] of XPATH_STRATEGY_CASES) {
    const { records, stats, after } = scan(name, source);
    const r = records[0] || {};
    if (to) {
      const i = source.lastIndexOf(from, source.indexOf('//android'));
      const expected = (source.slice(0, i) + to + source.slice(i + from.length))
        .replace(`"${DQ}"`, `"${OUT_DQ}"`).replace(`'${SQ}'`, `'${OUT}'`);
      if (after === expected && stats.locatorsUpdated === 1 && records.length === 1 && r.strategy === marker) ok();
      else fail(`strategy rewrite (${name}) ${JSON.stringify(source)}\n     expected: ${expected}\n     got:      ${after}  records=${JSON.stringify(records)}`);
    } else {
      const reason = `xpath strategy: ${marker} has no UiAutomator form`;
      if (after === source && stats.locatorsUpdated === 0 && stats.skipped.xpathStrategy === 1
        && records.length === 1 && r.status === STATUS.SKIPPED_XPATH_STRATEGY && r.reason === reason && r.uiselector === OUT) ok();
      else fail(`xpath strategy kept (${name}) ${JSON.stringify(source)}\n     expected: untouched, reason ${JSON.stringify(reason)}\n     got:      ${after === source ? 'untouched' : 'REWRITTEN'}, records=${JSON.stringify(records)}`);
    }
  }

  // No strategy call: JS/TS strings become WebdriverIO selectors; other
  // languages are reported with the UiSelector and left alone.
  const NO_STRATEGY_CASES = [
    ['a.js', `const a = '${SQ}';`, true],
    ['a.js', `I.click('${SQ}');`, true],
    ['a.js', `const xpath = '${SQ}';`, true], // a variable name is not a strategy
    ['a.ts', `export const s = () => $('${SQ}');`, true],
    ['a.ts', 'export const d = () => $(`//android.widget.Button[@text="${name}"]`);', true],
    ['A.java', `static final String LOC = "${DQ}";`, false],
    ['A.java', `String xpath = "${DQ}";`, false],
    ['A.kt', `const val LOC = "${DQ}"`, false],
    ['a.py', `LOC = '${SQ}'`, false],
    ['a.rb', `LOC = '${SQ}'`, false],
  ];
  for (const [name, source, converts] of NO_STRATEGY_CASES) {
    const { stats, after } = scan(name, source);
    const good = converts
      ? after !== source && after.includes('android=new UiSelector()') && stats.locatorsUpdated === 1
      : after === source && stats.skipped.unknownStrategy === 1;
    if (good && !stats.skipped.xpathStrategy) ok();
    else fail(`no xpath strategy (${name}) ${JSON.stringify(source)}\n     expected: ${converts ? 'android=…' : 'unknown strategy'}\n     got:      ${after}  stats=${JSON.stringify(stats)}`);
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
    const { stats, records } = scan('A.java', source);
    if (stats.skipped.unknownStrategy === 1 && records[0].strategy === null) ok();
    else fail(`xpath strategy closed call: records=${JSON.stringify(records)}`);
  }
}

// =====================================================================
// SCANNER: runtime values — placeholders and concatenation, with the real
// converter. [file, source, expected file after | null (untouched), warning]
// =====================================================================
console.log('— SCANNER: runtime values —');
{
  const U = 'new UiSelector()';
  const real = { convert: undefined };
  const RUNTIME_CASES = [
    ['a.ts', 'const d = (name) => $(`//*[@text="${name}"]`);', `const d = (name) => $(\`android=${U}.text("\${name}")\`);`, true],
    ['a.ts', 'const d = (name) => $(`//*[contains(@text,"${name}")]`);', `const d = (name) => $(\`android=${U}.textMatches("(?s).*\\\\Q\${name}\\\\E.*")\`);`, true],
    ['A.java', 'e = driver.findElement(AppiumBy.xpath(String.format("//*[@text=\'%s\']", name)));',
      `e = driver.findElement(AppiumBy.androidUIAutomator(String.format("${U}.text(\\"%s\\")", name)));`, true],
    ['A.java', 'e = driver.findElement(AppiumBy.xpath("//*[@text=\'" + name + "\']"));',
      `e = driver.findElement(AppiumBy.androidUIAutomator("${U}.text(\\"" + name + "\\")"));`, true],
    ['A.java', 'e = driver.findElement(AppiumBy.xpath("//*[@resource-id=\'" + pkg + ":id/" + ids.get(0) + "\']"));',
      `e = driver.findElement(AppiumBy.androidUIAutomator("${U}.resourceId(\\"" + pkg + ":id/" + ids.get(0) + "\\")"));`, true],
    ['A.kt', 'val e = driver.findElement(AppiumBy.xpath("//*[@text=\'$name\']"))', `val e = driver.findElement(AppiumBy.androidUIAutomator("${U}.text(\\"$name\\")"))`, true],
    ['a.py', 'e = driver.find_element(AppiumBy.XPATH, f\'//*[@text="{name}"]\')', `e = driver.find_element(AppiumBy.ANDROID_UIAUTOMATOR, f'${U}.text("{name}")')`, true],
    ['a.py', 'e = driver.find_element(AppiumBy.XPATH, \'//*[@text="{}"]\'.format(name))', `e = driver.find_element(AppiumBy.ANDROID_UIAUTOMATOR, '${U}.text("{}")'.format(name))`, true],
    ['A.cs', 'var e = driver.FindElement(MobileBy.XPath($"//*[@text=\'{name}\']"));', `var e = driver.FindElement(MobileBy.AndroidUIAutomator($"${U}.text(\\"{name}\\")"));`, true],
    ['a.rb', 'e = driver.find_element(:xpath, "//*[@text=\'#{name}\']")', `e = driver.find_element(:uiautomator, "${U}.text(\\"#{name}\\")")`, true],
    // the runtime value is a number or a step name: skipped
    ['A.java', 'e = driver.findElement(AppiumBy.xpath("(//android.widget.Button)[" + i + "]"));', null],
    ['A.java', 'e = driver.findElement(AppiumBy.xpath("//" + cls + "[@text=\'OK\']"));', null],
    // a value outside every literal: the string alone is not the locator
    ['A.java', 'e = driver.findElement(AppiumBy.xpath(BASE + "//*[@text=\'OK\']"));', null],
    ['A.java', 'e = driver.findElement(AppiumBy.xpath("//*[@text=\'OK\']" + suffix));', null],
    // a backslash in the source literal is written back escaped
    ['A.java', 'e = driver.findElement(AppiumBy.xpath("//*[@text=\'C:\\\\Temp\']"));', `e = driver.findElement(AppiumBy.androidUIAutomator("${U}.textMatches(\\"C:\\\\x5cTemp\\")"));`, false],
  ];
  for (const [name, source, want, warn] of RUNTIME_CASES) {
    const { after, records } = scan(name, source, real);
    const r = records[0] || {};
    const good = want === null ? after === source && records.length === 1 && !r.changed
      : after === want && Boolean(r.warning) === Boolean(warn);
    if (good) ok();
    else fail(`runtime (${name}) ${source}\n     expected: ${want === null ? 'untouched' : want}${warn ? ' (warning)' : ''}\n     got:      ${after}  records=${JSON.stringify(records)}`);
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
  // An explicit path is accepted and written.
  {
    const { status, untouched } = runInFixture(['./tests', '--write']);
    if (status === 0 && !untouched) ok();
    else fail(`CLI explicit --write: exit ${status}, ${untouched ? 'untouched' : 'written'}`);
  }
  // A single file is a valid target; the report names it relative to its folder.
  {
    const { status, report } = runInFixture(['./tests/spec.js', '--json']);
    if (status === 0 && report && report.stats.filesScanned === 1 && report.stats.locatorsFound === 1
      && report.updated.length === 1 && report.updated[0].file === 'spec.js'
      && report.updated[0].new === 'android=new UiSelector().className(\\"android.widget.Button\\").text(\\"Go\\")') ok();
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

// =====================================================================
// CORPUS — the R corpus is well-formed and the context files scan as
// audit/corpus/contexts/expected.json says (stage 2).
// =====================================================================
console.log('— CORPUS —');
{
  const corpus = require('./audit/corpus/android-locators.json');
  const KINDS = new Set(['xpath', 'xpath-dynamic', 'xpath-ios', 'xpath-web']);
  const FIELDS = ['id', 'kind', 'quote', 'source', 'count', 'project', 'lang', 'strategy'];
  const bad = corpus.filter((e, i) => e.id !== `A${String(i + 1).padStart(4, '0')}`
    || JSON.stringify(Object.keys(e)) !== JSON.stringify(FIELDS)
    || !KINDS.has(e.kind) || !["'", '"', '`'].includes(e.quote)
    || !(e.count >= 1) || !isLikelyXpathLocator(e.source));
  if (corpus.length > 1000 && bad.length === 0) ok();
  else fail(`corpus: ${corpus.length} entries, malformed: ${JSON.stringify(bad.slice(0, 3))}`);

  // The converter never throws on a real literal: every one converts or skips
  // with a reason (audit/corpus/convert.js reads them as the scanner does).
  {
    const { convertEntry } = require('./audit/corpus/convert');
    const crashed = [];
    for (const e of corpus) {
      try {
        const r = convertEntry(e);
        if (r.outcome === 'skip' && !r.reason) crashed.push(`${e.id}: skip without a reason`);
      } catch (err) {
        crashed.push(`${e.id}: ${err.message}`);
      }
    }
    if (crashed.length === 0) ok();
    else fail(`corpus through the converter: ${crashed.slice(0, 5).join('; ')}`);
  }

  const sources = readFileSync(join(__dirname, 'audit/corpus/sources.md'), 'utf8');
  const missing = [...new Set(corpus.map((e) => e.project))].filter((p) => !sources.includes(`[${p}](`));
  if (missing.length === 0) ok();
  else fail(`corpus: projects not in sources.md: ${missing.join(', ')}`);

  const dir = join(__dirname, 'audit/corpus/contexts');
  const expected = require('./audit/corpus/contexts/expected.json');
  for (const [file, want] of Object.entries(expected)) {
    const records = [];
    processFile(join(dir, file), { dryRun: true, quiet: true, convert: FAKE }, records, makeStats());
    const strategies = {};
    for (const r of records) {
      if (r.strategy) strategies[r.strategy] = (strategies[r.strategy] || 0) + 1;
    }
    if (records.length === want.found && JSON.stringify(strategies) === JSON.stringify(want.strategies)) ok();
    else fail(`context ${file}: found ${records.length}, strategies ${JSON.stringify(strategies)}; want ${want.found}, ${JSON.stringify(want.strategies)}`);
  }
}

// =====================================================================
// SKILL — the Claude Code skill's read-only entry point finds this checkout.
// =====================================================================
console.log('— SKILL —');
{
  const SKILL = join(__dirname, '.claude/skills/xpath-to-uiselector/scripts/convert.js');
  const run = (...args) => JSON.parse(execFileSync(process.execPath, [SKILL, ...args], { stdio: 'pipe', timeout: 20000 }).toString());
  const r = run('//*[@text="OK"]', '//a/b', '"new UiSelector().text(\\"x\\")"', 'android=new UiSelector().text("x")', '//XCUIElementTypeButton', 'id=login');
  const got = r.results.map(x => x.status).join(',');
  if (got === 'success,skipped_unsupported_logic,skipped_validation_failed,skipped_no_change,skipped_ios,skipped_not_xpath') ok();
  else fail(`skill: statuses ${got}`);
  if (r.engine.source === 'repository' && r.results[0].uiselector === 'new UiSelector().text("OK")') ok();
  else fail(`skill: engine ${r.engine.source}, uiselector ${r.results[0].uiselector}`);
  if (r.summary.total === 6 && r.summary.converted === 1 && r.summary.unchanged === 1) ok();
  else fail(`skill: summary ${JSON.stringify(r.summary)}`);
}

console.log(`\n${failed === 0 ? '✅' : '⚠️'} ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
