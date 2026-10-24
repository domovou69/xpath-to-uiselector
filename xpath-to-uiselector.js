#!/usr/bin/env node
// Entry point: CLI orchestration + the public surface tests import. All real
// work lives in ./lib/ — this file only wires modules to the command line.
const { existsSync, statSync, writeFileSync } = require('fs');
const { resolve, join, dirname } = require('path');

// Where the --json report lands: the caller's working directory. Using cwd (not
// __dirname) matters once the tool is installed as a dependency — __dirname then
// points inside node_modules/, which is the wrong place to write a report (it's
// invisible to the user and may be read-only).
const REPORT_NAME = 'xpath-to-uiselector.report.json';

const STATUS = require('./lib/status');
const { convertXpathToUiSelector } = require('./lib/converter');
const { isLikelyXpathLocator, walkDir, processFile, makeStats } = require('./lib/scanner');

// Scanned when no path is given (preview only; --write needs an explicit path).
const DEFAULT_TARGET = './tests';
// Preview by default; --write opts in to modifying files. The tool rewrites
// source in place with no built-in undo, so the cost of the two defaults is not
// symmetric: defaulting to preview wastes one command, defaulting to write can
// damage a tree the user never named.
const DRY_RUN = true;

function main(target = DEFAULT_TARGET, opts) {
  const fullPath = resolve(target);

  if (!existsSync(fullPath)) {
    console.error(`Error: path not found: ${fullPath}`);
    console.error(`Pass the file or folder holding your locators, e.g.  xpath-to-uiselector ./src`);
    process.exit(1);
  }

  const isDir = statSync(fullPath).isDirectory();

  if (!opts.quiet) {
    console.log(`\n=== Android Locator Migration ===`);
    console.log(`Scanning: ${fullPath}`);
    console.log(`Mode: ${opts.dryRun ? 'DRY RUN (no files written)' : 'WRITE'}${opts.exact ? ', exact only' : ''}${opts.loose ? ', loose' : ''}\n`);
  }

  const stats = makeStats();
  const records = [];
  // Files and folders that could not be read or written. Any of them makes the
  // CLI exit 2: the scan is incomplete even though the run finished.
  const errors = [];
  const onError = (path, error) => errors.push({ path, error });
  // rootDir lets the scanner report paths relative to the scan root rather than
  // as bare filenames.
  const scanOpts = { ...opts, rootDir: isDir ? fullPath : dirname(fullPath), onError };
  const scan = filePath => {
    try {
      processFile(filePath, scanOpts, records, stats);
    } catch (e) {
      console.error(`[error] ${filePath} not processed${opts.dryRun ? '' : ' or not written'}:`, e);
      onError(filePath, `not processed${opts.dryRun ? '' : ' or not written'}: ${e.code || e.message}`);
    }
  };
  if (isDir) walkDir(fullPath, scan, onError);
  else scan(fullPath);

  // --json: emit the full machine-readable result (converted + skipped).
  // `reason` and `warning` are omitted when null so consumers don't have to
  // special-case a key that's mostly absent.
  if (opts.json) {
    const updated = records
      .filter(r => r.changed)
      .map(({ file, old, new: newLocator, warning, strategy }) => {
        const entry = { file, old, new: newLocator };
        if (strategy) entry.strategy = strategy;
        if (warning) entry.warning = warning;
        return entry;
      });
    const skipped = records
      .filter(r => !r.changed && r.status !== STATUS.SKIPPED_NO_CHANGE)
      .map(({ file, old, status, reason, hint, strategy, uiselector, warning }) => {
        const entry = { file, locator: old, status };
        if (reason) entry.reason = reason;
        if (hint) entry.hint = hint;
        if (strategy) entry.strategy = strategy;
        if (uiselector) entry.uiselector = uiselector;
        if (uiselector && warning) entry.warning = warning;
        return entry;
      });
    const payload = { mode: opts.dryRun ? 'dry-run' : 'write', exact: !!opts.exact, loose: !!opts.loose, path: fullPath, stats, updated, skipped, errors };
    const reportPath = join(process.cwd(), REPORT_NAME);
    writeFileSync(reportPath, JSON.stringify(payload, null, 2), 'utf8');
    console.log(`Report written to ${reportPath}`);
    if (errors.length) console.error(`${errors.length} file${errors.length > 1 ? 's' : ''} or folder${errors.length > 1 ? 's' : ''} not processed: see "errors" in the report`);
    return { stats, records, errors };
  }

  // Summary always prints (even under --quiet); --quiet only drops the per-match noise.
  const bar = '='.repeat(40);
  console.log(`\n${bar}`);
  console.log(`Migration complete${opts.dryRun ? ' (DRY RUN - no files written)' : ''}`);
  console.log(bar);
  console.log(`Files scanned:    ${stats.filesScanned}`);
  console.log(`Locators found:   ${stats.locatorsFound}`);
  console.log(`Locators updated: ${stats.locatorsUpdated}`);
  console.log(`  with warning:   ${stats.warnings}`);
  console.log(`Total skipped:    ${stats.locatorsFound - stats.locatorsUpdated}`);
  console.log(`  ios:            ${stats.skipped.ios}`);
  console.log(`  xpath strategy: ${stats.skipped.xpathStrategy}`);
  console.log(`  no strategy:    ${stats.skipped.unknownStrategy}`);
  console.log(`  validation:     ${stats.skipped.validationFailed}`);
  console.log(`  unsupported:    ${stats.skipped.unsupportedLogic}`);
  console.log(`  not xpath:      ${stats.skipped.notXpath}`);
  console.log(`  no change:      ${stats.skipped.noChangeNeeded}`);
  if (opts.exact) console.log(`  not exact:      ${stats.skipped.notExact}`);
  if (errors.length) console.log(`Errors:           ${errors.length} (listed above, exit code 2)`);
  console.log(bar);
  return { stats, records, errors };
}

function resolveBool(flags, onFlag, offFlag, fallback) {
  if (flags.has(onFlag)) return true;
  if (flags.has(offFlag)) return false;
  return fallback;
}

// Every flag the CLI understands. An unrecognised flag is rejected rather than
// ignored: a typo'd `--wirte` would otherwise preview instead of writing while
// looking like it worked.
const KNOWN_FLAGS = new Set(['--dry-run', '--write', '--exact', '--loose', '--json', '--quiet', '--help', '-h', '--version', '-V']);

const USAGE = `xpath-to-uiselector — convert Android XPath locators to UiSelector

Usage:
  xpath-to-uiselector <file-or-folder> [flags]

The bare command PREVIEWS ONLY and writes nothing. Add --write once the diff
looks right; it rewrites the files in place, so run it on a clean working tree
and let \`git diff\` be your undo. Every XPath in the scanned files is a
candidate, web XPaths included: point it at your Android tests.

Flags:
  --dry-run    Preview only, write nothing. The default. Wins if combined with --write.
  --write      Save the changes in place. Requires an explicit path.
  --exact      Change only locators converted with no warning; report the rest
               (close forms and runtime values) with their UiSelector.
  --loose      Simpler, wider forms, each with a warning: textContains /
               textStartsWith (ignore case) for contains() / starts-with(),
               childSelector for a direct child //A/B, (?i) for translate().
               Off by default: the default finds the same elements as the XPath.
  --json       Write ${REPORT_NAME} in the current directory. Implies --quiet.
  --quiet      Drop per-match diffs and banner; keep the final summary.
  -h, --help   Show this help.
  -V, --version  Show the version.

Exit code: 0 done, 1 bad arguments or path, 2 some files or folders could
not be read or written (listed on stderr and in the --json report).

Examples:
  xpath-to-uiselector ./src            # preview, writes nothing
  xpath-to-uiselector ./src --write    # same result, saved in place`;

function parseFlags(argv) {
  const flags = new Set(argv.filter(a => a.startsWith('-')));
  const json = flags.has('--json');
  return {
    positionals: argv.filter(a => !a.startsWith('-')),
    unknown: [...flags].filter(f => !KNOWN_FLAGS.has(f)),
    help: flags.has('--help') || flags.has('-h'),
    version: flags.has('--version') || flags.has('-V'),
    json,
    quiet: json || flags.has('--quiet'),
    dryRun: resolveBool(flags, '--dry-run', '--write', DRY_RUN),
    exact: flags.has('--exact'),
    loose: flags.has('--loose'),
  };
}

if (require.main === module) {
  const opts = parseFlags(process.argv.slice(2));
  if (opts.help) {
    console.log(USAGE);
  } else if (opts.version) {
    console.log(require('./package.json').version);
  } else if (opts.unknown.length) {
    console.error(`Error: unknown flag${opts.unknown.length > 1 ? 's' : ''}: ${opts.unknown.join(', ')}`);
    console.error(`Run with --help to see the supported flags.`);
    process.exit(1);
  } else if (!opts.dryRun && !opts.positionals.length) {
    // Never modify a path the user did not name. DEFAULT_TARGET is a convenience
    // for previewing; quietly promoting it to a write target would rewrite
    // ./tests on a bare `--write`.
    console.error(`Error: --write needs an explicit path.`);
    console.error(`Refusing to rewrite the default (${DEFAULT_TARGET}) when you did not name it.`);
    console.error(`  xpath-to-uiselector ./src --write`);
    process.exit(1);
  } else {
    const { errors } = main(opts.positionals[0], opts);
    if (errors.length) process.exitCode = 2;
  }
}

module.exports = {
  convertXpathToUiSelector,
  isLikelyXpathLocator,
  parseFlags,
  main,
  STATUS,
};
