const { readdirSync, lstatSync, readFileSync, writeFileSync } = require('fs');
const { join, extname, basename, relative } = require('path');
const STATUS = require('./status');
const { convertXpathToUiSelector } = require('./converter');
const { findXpathStrategy } = require('./strategy');

const FILE_EXTENSIONS = [
  // JS / TS ecosystem (WebdriverIO, Appium JS/TS clients)
  '.js', '.mjs', '.cjs', '.ts', '.mts', '.cts', '.jsx', '.tsx',
  // JVM (Java / Kotlin / Groovy Appium & Selenium clients)
  '.java', '.kt', '.kts', '.groovy',
  // Python (Appium-Python-Client, pytest-bdd)
  '.py',
  // Ruby (appium_lib)
  '.rb',
  // .NET (Appium dotnet driver)
  '.cs',
  // PHP
  '.php',
  // Data / config / BDD files that often hold page-object locators
  '.json', '.yaml', '.yml', '.xml', '.feature', '.properties', '.txt',
];

// Directories we never want to descend into — scanning them is slow and, worse,
// would rewrite locator-looking strings inside third-party/build artifacts.
const IGNORE_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.next', 'coverage', '.cache', '.gradle']);

// Constructed per-run rather than module-global so a second main() call
// (in tests, watch-mode, etc.) doesn't carry counts over from the first.
function makeStats() {
  return {
    filesScanned: 0,
    locatorsFound: 0,
    locatorsUpdated: 0,
    // updated locators that carry a warning (close forms, see PLAN.md section 3)
    warnings: 0,
    skipped: {
      ios: 0,
      xpathStrategy: 0,
      validationFailed: 0,
      unsupportedLogic: 0,
      notXpath: 0,
      noChangeNeeded: 0,
    },
  };
}

// A dotted class name as an XPath step: android.widget.Button, androidx.x.Y,
// com.app.ui.CustomView$Inner. The last segment starts upper-case, which keeps
// host names and file names (//cdn.example.com/lib.js) out.
const CLASS_STEP = /(?:^|\/)(?:[A-Za-z_$][\w$]*\.)+[A-Z][\w$]*(?=$|[/[])/;

// Pre-filter for the file scanner. A string can start with `//` for reasons
// that have nothing to do with locators — protocol-relative URLs, comments
// lifted into strings — so it must also carry an XPath signal. Web XPaths are
// not told apart from Android ones: the user picks the folder and reviews the
// preview (PLAN.md, decision 4). Correctness is decided later by the converter.
function isLikelyXpathLocator(str) {
  // Strip outer grouping parens so `(//xpath)[n]` is treated the same as
  // `//xpath`. lastIndexOf(')') finds the group-close even when a quoted
  // attribute value contains a ')' character (e.g. [@text="a)b"]).
  let core = str;
  if (str.startsWith('(/')) {
    const closeIdx = str.lastIndexOf(')');
    if (closeIdx > 0) core = str.slice(1, closeIdx);
  }

  // `/hierarchy` is the root of UiAutomator2's page source: absolute paths
  // copied from Appium Inspector start there.
  const absolute = /^\/hierarchy(?=$|[/[])/.test(core);
  if (!core.startsWith('//') && !absolute) return false;

  const hasSignal =
    absolute ||
    /\[[^\]]*\]/.test(core) || // any predicate (e.g. //*[@text="OK"], //X[1])
    CLASS_STEP.test(core) || // //android.widget.Button
    /XCUIElementType[A-Za-z]+/.test(core); // iOS: counted, then skipped
  if (!hasSignal) return false;

  // Bracket balance check on the core only (outer [n] index excluded).
  const open = (core.match(/\[/g) || []).length;
  const close = (core.match(/\]/g) || []).length;
  return open === close;
}

// Walks `dir` depth-first, invoking `callback` for every regular file.
//
// Symlinks (and Windows directory junctions, which lstat also reports as links)
// are never followed. Following them lets a link inside the target tree point
// anywhere on disk, and --write would then rewrite files the user never asked
// us to touch — plus a link cycle would recurse until ELOOP. A skipped
// directory link is announced, since it may hide files the user expected to see.
//
// A directory we cannot read is reported and stepped over rather than aborting:
// one permission-denied folder should not throw away the whole scan.
function walkDir(dir, callback) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch (e) {
    console.error(`[skip] cannot read directory ${dir}: ${e.code || e.message}`);
    return;
  }

  entries.forEach(entry => {
    const entryPath = join(dir, entry);
    let stat;
    try {
      stat = lstatSync(entryPath);
    } catch (e) {
      console.error(`[skip] cannot stat ${entryPath}: ${e.code || e.message}`);
      return;
    }

    if (stat.isSymbolicLink()) {
      if (!IGNORE_DIRS.has(entry)) console.error(`[skip] symlink not followed: ${entryPath}`);
      return;
    }
    if (stat.isDirectory()) {
      if (IGNORE_DIRS.has(entry)) return;
      walkDir(entryPath, callback);
    } else if (stat.isFile()) {
      callback(entryPath);
    }
  });
}

// The last platform key (`android:` / `ios:`) before the string, scanning back
// to the nearest property boundary (comma / semicolon / closing brace or
// bracket). Handles ternaries like `ios: cond ? a : '//x'` and keys on the
// previous line (`ios:\n  '//x'`) without leaking into a sibling property.
function platformKey(content, offset) {
  const lineStart = content.lastIndexOf('\n', offset - 1) + 1;
  let contextStart = lineStart > 0 ? lineStart - 1 : 0;
  while (contextStart > 0 && !/[,;}\]]/.test(content[contextStart])) contextStart--;
  if (contextStart > 0) contextStart++; // skip past the boundary char itself
  const prefix = content.slice(contextStart, offset);
  const re = /(?<![a-zA-Z_$0-9])['"]?(android|ios)['"]?\s*:/g;
  let last = null;
  let m;
  while ((m = re.exec(prefix)) !== null) last = m[1];
  return last;
}

// Escape the replacement for the quote kind of the string it goes back into.
// A UiSelector always holds double-quoted literals, so `"…"` sources (Java,
// Kotlin, C#, JSON) get `\"`.
function escapeForQuote(locator, quote) {
  return locator.replace(new RegExp(`(?<!\\\\)${quote}`, 'g'), `\\${quote}`);
}

// opts:
//   dryRun   do not write the file back
//   quiet    no per-match console output
//   rootDir  report paths relative to it
//   convert  (xpath) => { locator, status, reason?, warning? }; defaults to the
//            real converter. Tests pass their own to exercise the scanner alone.
function processFile(filePath, opts, records, stats) {
  const ext = extname(filePath).toLowerCase();
  if (!FILE_EXTENSIONS.includes(ext)) return;
  const convert = opts.convert || convertXpathToUiSelector;

  let buf;
  try {
    buf = readFileSync(filePath);
  } catch (e) {
    console.error(`[skip] cannot read ${filePath}: ${e.code || e.message}`);
    return;
  }

  // Read as bytes and confirm the content survives a utf8 round-trip before
  // going near it. Decoding a latin-1 / UTF-16 file as utf8 replaces every
  // undecodable byte with U+FFFD across the WHOLE file, so writing it back
  // destroys the entire file rather than editing one locator. .properties,
  // .xml, .json and .txt are all scanned and are exactly where legacy
  // encodings show up.
  const content = buf.toString('utf8');
  if (!Buffer.from(content, 'utf8').equals(buf)) {
    console.error(`[skip] not valid UTF-8, left untouched: ${filePath}`);
    return;
  }

  stats.filesScanned++;
  // Report paths relative to the scan root so files are identifiable: a repo
  // with ten index.ts files would otherwise produce ten identical rows.
  // Separators are normalised so Windows and POSIX reports match.
  const file = opts.rootDir
    ? relative(opts.rootDir, filePath).replace(/\\/g, '/')
    : basename(filePath);

  // Any quoted string whose content starts like an XPath: `//`, `(//`,
  // `/hierarchy` or `(/hierarchy`. isLikelyXpathLocator() is what keeps us from
  // rewriting URLs and comments.
  //
  // `[^\\]` in the tail is load-bearing: with a bare `.`, both `\\.` and
  // `(?!\1).` match a backslash, so a run of backslashes in an unterminated
  // string backtracks exponentially and the scan hangs (~23s at 42 chars). The
  // `s` flag means it would scan to EOF looking for a close quote. Windows
  // paths in a .json/.properties file are enough to trigger it.
  const strictRegex = /(['"`])((?:\(?\/\/|\(?\/hierarchy)(?:\\.|(?!\1)[^\\])*)\1/gs;

  let modified = false;

  const updatedContent = content.replace(strictRegex, (match, quote, locator, offset) => {
    if (!isLikelyXpathLocator(locator)) return match;

    stats.locatorsFound++;

    // iOS locators: under an `ios:` key of a dual-platform page object
    // (CodeceptJS `{ ios: '…', android: '…' }`), or naming XCUIElementType*
    // outside quoted values.
    const structure = locator.replace(/(['"`])(?:\\.|(?!\1)[^\\])*\1/g, '""');
    if (platformKey(content, offset) === 'ios' || structure.includes('XCUIElementType')) {
      stats.skipped.ios++;
      records.push({ file, changed: false, old: locator, status: STATUS.SKIPPED_IOS, reason: null });
      return match;
    }

    // Passed to an explicit XPath strategy (`AppiumBy.xpath("…")`,
    // `(By.XPATH, '…')`, `@AndroidFindBy(xpath = "…")`): rewriting only the
    // string would leave the strategy at XPath and break the locator, so it is
    // left alone and reported until the call rewrite lands (stage 4).
    const strategy = findXpathStrategy(content, offset, ext);
    if (strategy) {
      const reason = `xpath strategy: ${strategy}`;
      stats.skipped.xpathStrategy++;
      records.push({ file, changed: false, old: locator, status: STATUS.SKIPPED_XPATH_STRATEGY, reason });
      if (!opts.quiet) console.log(`[skip] ${reason}: ${locator}`);
      return match;
    }

    const result = convert(locator);
    const status = result.status;
    const reason = result.reason || null;
    const warning = result.warning || null;

    if (status !== STATUS.SUCCESS) {
      // NOT_XPATH gets its own counter: it is reported as a real skip in the
      // JSON `skipped[]` array, so folding it into "no change" made the console
      // summary and the JSON report disagree about the same run.
      if (status === STATUS.SKIPPED_UNSUPPORTED_LOGIC) stats.skipped.unsupportedLogic++;
      else if (status === STATUS.SKIPPED_VALIDATION_FAILED) stats.skipped.validationFailed++;
      else if (status === STATUS.SKIPPED_NOT_XPATH) stats.skipped.notXpath++;
      else if (status === STATUS.SKIPPED_IOS) stats.skipped.ios++;
      else stats.skipped.noChangeNeeded++;

      records.push({ file, changed: false, old: locator, status, reason });
      if (!opts.quiet && status !== STATUS.SKIPPED_NOT_XPATH && status !== STATUS.SKIPPED_NO_CHANGE) {
        console.log(`[skip] ${reason || status}: ${locator}`);
      }
      return match;
    }

    const newLocator = escapeForQuote(result.locator, quote);
    if (newLocator === locator) {
      stats.skipped.noChangeNeeded++;
      records.push({ file, changed: false, old: locator, status: STATUS.SKIPPED_NO_CHANGE, reason: null });
      return match;
    }

    records.push({ file, changed: true, old: locator, new: newLocator, status: STATUS.SUCCESS, reason: null, warning });
    if (!opts.quiet) {
      console.log(`\nMatch in ${file}:`);
      console.log(`  - ${locator}`);
      console.log(`  + ${newLocator}`);
      if (warning) console.log(`  ! ${warning}`);
    }

    stats.locatorsUpdated++;
    if (warning) stats.warnings++;
    modified = true;
    return `${quote}${newLocator}${quote}`;
  });

  if (modified && !opts.dryRun) {
    writeFileSync(filePath, updatedContent, 'utf8');
    if (!opts.quiet) console.log(`Saved: ${filePath}`);
  }
}

module.exports = {
  FILE_EXTENSIONS,
  IGNORE_DIRS,
  makeStats,
  isLikelyXpathLocator,
  walkDir,
  processFile,
};
