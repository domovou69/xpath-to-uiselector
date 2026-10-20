const { readdirSync, lstatSync, readFileSync, writeFileSync } = require('fs');
const { join, extname, basename, relative } = require('path');
const STATUS = require('./status');
const { convertXpathToUiSelector } = require('./converter');
const { findXpathStrategy, rewriteStrategy } = require('./strategy');
const { LANGUAGE_BY_EXTENSION, literalKind, decodeLiteral, encodeLiteral } = require('./literal');

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
      unknownStrategy: 0,
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

// A string prefix that changes how the literal reads: Python r"" / f"",
// C# @"" / $"".
function literalPrefix(content, start, ext) {
  const lang = LANGUAGE_BY_EXTENSION[ext];
  const before = content.slice(Math.max(0, start - 3), start);
  const m = lang === 'python' ? /(?<![\w])([rRfFbBuU]{1,2})$/.exec(before)
    : lang === 'csharp' ? /(\$@|@\$|\$|@)$/.exec(before) : null;
  return m ? m[1] : '';
}

// `"…" + expr + "…"` after a literal: the pieces join into one locator, the
// expressions become runtime values (PLAN.md section 2). An expression is a
// name with member access, calls and indexes, no strings inside.
const EXPR = String.raw`[A-Za-z_$][\w$]*(?:\s*(?:\.\s*[A-Za-z_$][\w$]*|\([^()'"\`\n]*\)|\[[^\[\]'"\`\n]*\]))*`;
function concatenation(content, pos, quote) {
  const parts = [];
  const re = new RegExp(String.raw`^(\s*\+\s*${EXPR}\s*\+\s*)${quote}((?:\\.|(?!${quote})[^\\])*)${quote}`, 's');
  for (;;) {
    const m = re.exec(content.slice(pos, pos + 2000));
    if (!m) break;
    parts.push({ between: m[1], raw: m[2] });
    pos += m[0].length;
  }
  return parts.length ? { parts, end: pos } : null;
}

// The literal (or chain) is itself one operand of a larger `+`: a runtime
// value before or after it is not inside any literal.
function concatenated(content, start, end) {
  return /(?<!\+)\+\s*$/.test(content.slice(Math.max(0, start - 40), start)) || /^\s*\+(?![+=])/.test(content.slice(end, end + 40));
}

// opts:
//   dryRun   do not write the file back
//   quiet    no per-match console output
//   rootDir  report paths relative to it
//   convert  (xpath, { placeholders }) => { locator, status, reason?, warning? };
//            defaults to the real converter. Tests pass their own to exercise
//            the scanner alone.
//
// A converted locator is written back only where the strategy goes with it:
//   - the string is passed to an XPath strategy call the client can switch to
//     UiAutomator: the call and the string are rewritten together;
//   - a JS/TS string with no strategy call: a WebdriverIO selector, written as
//     `android=new UiSelector()…`;
// otherwise the file is left alone and the record carries the UiSelector
// (skipped_xpath_strategy, skipped_unknown_strategy).
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
  const lang = LANGUAGE_BY_EXTENSION[ext];

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

  const edits = [];
  const skipRecord = (old, status, reason, extra = {}) => {
    records.push({ file, changed: false, old, status, reason, ...extra });
    if (!opts.quiet && status !== STATUS.SKIPPED_NOT_XPATH && status !== STATUS.SKIPPED_NO_CHANGE) {
      console.log(`[skip] ${reason || status}: ${old}`);
      if (extra.uiselector) console.log(`       UiSelector: ${extra.uiselector}`);
    }
  };

  let m;
  while ((m = strictRegex.exec(content)) !== null) {
    const quote = m[1];
    const start = m.index;
    let end = start + m[0].length;
    const chain = concatenation(content, end, quote);
    const pieces = [m[2], ...(chain ? chain.parts.map(p => p.raw) : [])];
    // The pre-filter sees the joined text with a stand-in for each runtime value.
    if (!isLikelyXpathLocator(pieces.join('x'))) continue;
    if (chain) {
      end = chain.end;
      strictRegex.lastIndex = end;
    }
    const old = content.slice(start + 1, end - 1);

    stats.locatorsFound++;

    // iOS locators: under an `ios:` key of a dual-platform page object
    // (CodeceptJS `{ ios: '…', android: '…' }`), or naming XCUIElementType*
    // outside quoted values.
    const structure = pieces.join('x').replace(/(['"`])(?:\\.|(?!\1)[^\\])*\1/g, '""');
    if (platformKey(content, start) === 'ios' || structure.includes('XCUIElementType')) {
      stats.skipped.ios++;
      records.push({ file, changed: false, old, status: STATUS.SKIPPED_IOS, reason: null });
      continue;
    }

    if (concatenated(content, start, end)) {
      stats.skipped.unsupportedLogic++;
      skipRecord(old, STATUS.SKIPPED_UNSUPPORTED_LOGIC, 'built by concatenation with a value outside the string literals');
      continue;
    }

    // Decode the literal (and the pieces of a concatenation) to the runtime
    // value; runtime parts become placeholder characters.
    const kind = literalKind(ext, quote, literalPrefix(content, start, ext), content.slice(end, end + 40));
    const decoded = decodeLiteral(m[2], kind, quote);
    let value = decoded && decoded.value;
    const placeholders = decoded ? decoded.placeholders : new Map();
    for (const part of (decoded && chain ? chain.parts : [])) {
      const piece = decodeLiteral(part.raw, kind, quote);
      if (!piece) { value = null; break; }
      const hole = decoded.free();
      placeholders.set(hole, `${quote}${part.between}${quote}`);
      for (const [ch, text] of piece.placeholders) {
        const fresh = decoded.free();
        placeholders.set(fresh, text);
        piece.value = piece.value.split(ch).join(fresh);
      }
      value += hole + piece.value;
    }
    if (value === null) {
      stats.skipped.unsupportedLogic++;
      skipRecord(old, STATUS.SKIPPED_UNSUPPORTED_LOGIC, 'the string literal has an escape this tool does not read');
      continue;
    }

    const strategy = findXpathStrategy(content, start, ext);
    const marker = strategy ? strategy.marker : null;
    const result = convert(value, { placeholders: new Set(placeholders.keys()) });
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
      skipRecord(old, status, reason, { strategy: marker });
      continue;
    }

    // The UiSelector as the user will read it: runtime parts back in place.
    const shown = [...result.locator].map(ch => placeholders.get(ch) ?? ch).join('');
    let locator = result.locator;
    let markerText = null;
    if (strategy) {
      markerText = rewriteStrategy(content.slice(strategy.start, strategy.end), ext, content);
      if (!markerText) {
        stats.skipped.xpathStrategy++;
        skipRecord(old, STATUS.SKIPPED_XPATH_STRATEGY, `xpath strategy: ${marker} has no UiAutomator form`, { strategy: marker, uiselector: shown, warning });
        continue;
      }
    } else if (lang === 'js') {
      locator = `android=${locator}`;
    } else {
      stats.skipped.unknownStrategy++;
      skipRecord(old, STATUS.SKIPPED_UNKNOWN_STRATEGY, 'no strategy call around the string: use the UiSelector with the UiAutomator strategy where the string is used', { strategy: null, uiselector: shown, warning });
      continue;
    }

    const encoded = encodeLiteral(locator, kind, quote, placeholders);
    if (encoded === null) {
      stats.skipped.validationFailed++;
      skipRecord(old, STATUS.SKIPPED_VALIDATION_FAILED, 'the UiSelector cannot be written in this kind of string literal', { strategy: marker, uiselector: shown });
      continue;
    }

    edits.push({ start: start + 1, end: end - 1, text: encoded });
    if (markerText) edits.push({ start: strategy.start, end: strategy.end, text: markerText });
    records.push({ file, changed: true, old, new: encoded, status: STATUS.SUCCESS, reason: null, warning, strategy: marker });
    if (!opts.quiet) {
      console.log(`\nMatch in ${file}:`);
      if (markerText) console.log(`  - ${marker}  →  + ${markerText}`);
      console.log(`  - ${old}`);
      console.log(`  + ${encoded}`);
      if (warning) console.log(`  ! ${warning}`);
    }
    stats.locatorsUpdated++;
    if (warning) stats.warnings++;
  }

  if (edits.length && !opts.dryRun) {
    let updated = content;
    for (const e of edits.sort((a, b) => b.start - a.start)) updated = updated.slice(0, e.start) + e.text + updated.slice(e.end);
    writeFileSync(filePath, updated, 'utf8');
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
