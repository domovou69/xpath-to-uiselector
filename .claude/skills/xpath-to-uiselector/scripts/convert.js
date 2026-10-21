#!/usr/bin/env node
// Skill entry point: runs the deterministic xpath-to-uiselector engine on
// locators or source files and prints one JSON report on stdout. Read-only:
// it never writes a file (saving is the main CLI's `--write`).
//
//   node convert.js '<xpath>' ['<xpath>' ...]
//   node convert.js --file locators.txt     one locator per line
//   node convert.js --stdin < locators.txt  same, from stdin
//   node convert.js --scan ./src            source files, as the main CLI sees them
//
// Exit codes: 0 report printed, 2 bad usage, 3 engine not found (the skill then
// falls back to the rules in references/uiselector-rules.md).
const { existsSync, readFileSync, statSync } = require('fs');
const { dirname, join, resolve } = require('path');

const USAGE = `Usage: convert.js [--file <list> | --stdin | --scan <file-or-dir>] [locator ...]`;
const NAME = 'xpath-to-uiselector';

// Where the engine comes from, in order: an explicit checkout, the repository
// this skill ships in, an installed npm package (local, then global).
function findEngine() {
  const candidates = [];
  if (process.env.XPATH_TO_UISELECTOR_HOME) {
    candidates.push({ root: resolve(process.env.XPATH_TO_UISELECTOR_HOME), source: 'XPATH_TO_UISELECTOR_HOME' });
  }
  candidates.push({ root: resolve(__dirname, '../../../..'), source: 'repository' });
  for (const base of [process.cwd(), __dirname]) {
    try {
      const pkg = require.resolve(`${NAME}/package.json`, { paths: [base] });
      candidates.push({ root: dirname(pkg), source: 'npm package' });
    } catch { /* not installed here */ }
  }
  const found = candidates.map(check).find(Boolean);
  if (found) return found;
  // `npm root -g` costs a process spawn, so it is the last resort.
  try {
    const globalRoot = require('child_process').execSync('npm root -g', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    return check({ root: join(globalRoot, NAME), source: 'global npm package' });
  } catch { /* npm not on PATH */ }
  return null;
}

function check(c) {
  const pkgPath = join(c.root, 'package.json');
  if (!existsSync(join(c.root, 'lib', 'converter.js')) || !existsSync(pkgPath)) return null;
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
  return pkg.name === NAME ? { ...c, version: pkg.version } : null;
}

// A pasted locator often keeps the quotes of the source line around it.
function unquote(s) {
  const t = s.trim();
  if (t.length > 1 && /^['"`]/.test(t) && t[t.length - 1] === t[0]) return t.slice(1, -1);
  return t;
}

function convertOne(input, lib, uiselector) {
  const { STATUS, convertXpathToUiSelector } = lib;
  const entry = { input };
  const bare = input.replace(/^android=/, '');
  if (bare.startsWith('new UiSelector()')) {
    const v = uiselector.parseUiSelector(bare);
    return v.ok
      ? { ...entry, status: STATUS.SKIPPED_NO_CHANGE, uiselector: bare, note: 'already a UiSelector' }
      : { ...entry, status: STATUS.SKIPPED_VALIDATION_FAILED, reason: `the UiSelector would not parse: ${v.error}` };
  }
  if (!/^\(?\/\/|^\(?\/hierarchy/.test(input)) {
    return { ...entry, status: STATUS.SKIPPED_NOT_XPATH, reason: 'not an XPath starting with //, (// or /hierarchy' };
  }
  if (input.includes('XCUIElementType')) {
    return { ...entry, status: STATUS.SKIPPED_IOS, reason: 'iOS locator' };
  }
  const r = convertXpathToUiSelector(input);
  const out = { ...entry, status: r.status };
  if (r.status === STATUS.SUCCESS) out.uiselector = r.locator;
  if (r.reason) out.reason = r.reason;
  if (r.warning) out.warning = r.warning;
  return out;
}

function scan(target, scanner) {
  const records = [];
  const stats = scanner.makeStats();
  const opts = { dryRun: true, quiet: true };
  if (statSync(target).isDirectory()) {
    scanner.walkDir(target, f => scanner.processFile(f, { ...opts, rootDir: target }, records, stats));
  } else {
    scanner.processFile(target, { ...opts, rootDir: dirname(target) }, records, stats);
  }
  return records.map(r => {
    const out = { file: r.file, input: r.old, status: r.status };
    if (r.changed) out.written = r.new;
    if (r.uiselector) out.uiselector = r.uiselector;
    if (r.strategy) out.strategy = r.strategy;
    if (r.reason) out.reason = r.reason;
    if (r.warning) out.warning = r.warning;
    return out;
  });
}

function main(argv) {
  const args = [...argv];
  const lines = [];
  let scanTarget = null;
  while (args.length) {
    const a = args.shift();
    if (a === '-h' || a === '--help') { console.log(USAGE); return 0; }
    if (a === '--file') {
      const f = args.shift();
      if (!f) { console.error(USAGE); return 2; }
      lines.push(...readFileSync(f, 'utf8').split(/\r?\n/));
    } else if (a === '--stdin') {
      lines.push(...readFileSync(0, 'utf8').split(/\r?\n/));
    } else if (a === '--scan') {
      scanTarget = args.shift();
      if (!scanTarget) { console.error(USAGE); return 2; }
    } else if (a.startsWith('--')) {
      console.error(`Unknown flag: ${a}\n${USAGE}`);
      return 2;
    } else {
      lines.push(a);
    }
  }
  const inputs = lines.map(unquote).filter(Boolean);
  if (!inputs.length && !scanTarget) { console.error(USAGE); return 2; }

  const engine = findEngine();
  if (!engine) {
    console.error(`Engine not found. Set XPATH_TO_UISELECTOR_HOME to a checkout of github.com/domovou69/${NAME}, or install it: npm i -g ${NAME}`);
    return 3;
  }
  const lib = require(join(engine.root, `${NAME}.js`));
  const uiselector = require(join(engine.root, 'lib', 'uiselector.js'));

  const results = inputs.map(i => convertOne(i, lib, uiselector));
  if (scanTarget) {
    const target = resolve(scanTarget);
    if (!existsSync(target)) { console.error(`Not found: ${target}`); return 2; }
    results.push(...scan(target, require(join(engine.root, 'lib', 'scanner.js'))));
  }

  const summary = { total: results.length, converted: 0, withWarning: 0, notWritten: 0, unchanged: 0, skipped: 0 };
  const { STATUS } = lib;
  for (const r of results) {
    if (r.status === STATUS.SUCCESS) {
      summary.converted++;
      if (r.warning) summary.withWarning++;
    } else if (r.status === STATUS.SKIPPED_UNKNOWN_STRATEGY || r.status === STATUS.SKIPPED_XPATH_STRATEGY) summary.notWritten++;
    else if (r.status === STATUS.SKIPPED_NO_CHANGE) summary.unchanged++;
    else summary.skipped++;
  }
  console.log(JSON.stringify({ engine: { source: engine.source, version: engine.version, root: engine.root }, summary, results }, null, 2));
  return 0;
}

process.exitCode = main(process.argv.slice(2));
