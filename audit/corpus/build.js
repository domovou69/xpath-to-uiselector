#!/usr/bin/env node
// Builds the R corpus from a local cache of downloaded test files (see sources.md for how the cache
// is made): runs the scanner over it (dry run), anonymizes the literals and writes
// android-locators.json, frequencies.md and contexts/ next to this file.
//
//   node audit/corpus/build.js <cacheDir>
//
// <cacheDir> holds one folder per repository, named owner__repo, with the files at their repo paths,
// and pins.txt ("owner/repo sha license" per line). The anonymization salt is kept in
// <cacheDir>/.salt and never committed: with a known salt the pseudo-words could be reversed by
// hashing a dictionary.
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const scanner = require('../../lib/scanner');
const STATUS = require('../../lib/status');

const LANG = {
  '.java': 'Java', '.kt': 'Kotlin', '.kts': 'Kotlin', '.py': 'Python', '.cs': 'C#',
  '.js': 'JavaScript', '.mjs': 'JavaScript', '.cjs': 'JavaScript', '.ts': 'TypeScript', '.tsx': 'TypeScript',
  '.rb': 'Ruby', '.php': 'PHP', '.groovy': 'Groovy',
};

// ---------------------------------------------------------------------------------------------------
// Anonymization: every letter run in a quoted XPath value (and in non-Android class names) becomes a
// pseudo-word of the same length, script and case pattern. The mapping is global and (almost always)
// injective, so equal words stay equal across the corpus and different words stay different. Words of
// one or two letters are kept. Digits, spaces,
// punctuation, quotes, backslashes and interpolations (${x}, $x, {x}, %s) are kept as they are:
// the converter's rules depend on them.

// Words kept verbatim: XPath-meaningful values and the Android framework vocabulary.
const KEEP = new Set(['true', 'false', 'android', 'androidx', 'id', 'widget', 'view', 'webkit', 'com', 'org', 'io', 'net', 'app']);

const LATIN = { c: 'bcdfghjklmnprstvwz', v: 'aeiou' };
const CYRILLIC = { c: 'бвгджзклмнпрстфхцчш', v: 'аеиоуя' };

function makeAnonymizer(salt) {
  const map = new Map();
  const used = new Set();
  const pools = new Map(); // script → sorted chars seen in the corpus (for scripts other than Latin/Cyrillic)

  function hashInts(s, n) {
    const out = [];
    let i = 0;
    while (out.length < n) {
      const h = crypto.createHmac('sha256', salt).update(`${s}#${i++}`).digest();
      for (const b of h) out.push(b);
    }
    return out.slice(0, n);
  }

  function scriptOf(ch) {
    if (/[A-Za-z]/.test(ch)) return 'latin';
    if (/\p{Script=Cyrillic}/u.test(ch)) return 'cyrillic';
    return 'other';
  }

  function register(text) {
    for (const ch of text) {
      if (!/\p{L}|\p{M}/u.test(ch) || /[A-Za-z]/.test(ch) || /\p{Script=Cyrillic}/u.test(ch)) continue;
      const block = ch.codePointAt(0) >> 7;
      if (!pools.has(block)) pools.set(block, new Set());
      pools.get(block).add(ch);
    }
  }

  function pseudo(word, attempt) {
    const chars = [...word.toLowerCase()];
    const rnd = hashInts(`${word.toLowerCase()}:${attempt}`, chars.length);
    return chars.map((ch, i) => {
      const s = scriptOf(ch);
      if (s === 'latin' || s === 'cyrillic') {
        const set = s === 'latin' ? LATIN : CYRILLIC;
        const letters = i % 2 === 0 ? set.c : set.v;
        return [...letters][rnd[i] % [...letters].length];
      }
      const pool = [...(pools.get(ch.codePointAt(0) >> 7) || [ch])].sort();
      return pool[rnd[i] % pool.length];
    }).join('');
  }

  function word(w) {
    // Words of one or two letters carry no identity (OK, to, a) and have too few pseudo-words.
    if (KEEP.has(w.toLowerCase()) || [...w].length <= 2) return w;
    const key = w.toLowerCase();
    let base = map.get(key);
    if (!base) {
      for (let attempt = 0; ; attempt++) {
        base = pseudo(w, attempt);
        // A small script pool can run out of distinct words: accept a collision rather than loop.
        if ((!used.has(base) && base !== key) || attempt >= 20) break;
      }
      map.set(key, base);
      used.add(base);
    }
    // Same case pattern as the original, letter by letter.
    const orig = [...w];
    return [...base].map((ch, i) => (orig[i] && orig[i] !== orig[i].toLowerCase() ? ch.toUpperCase() : ch)).join('');
  }

  const INTERP = /(\$\{[^}]*\}|\$[A-Za-z_]\w*|\{[A-Za-z_]?\w*\}|%[sdf]|\{\d+\})/;

  function text(value) {
    return value.split(INTERP).map((part, i) => (i % 2 ? part : part.replace(/[\p{L}\p{M}]+/gu, word))).join('');
  }

  // An XPath literal as it stands in the source file: string values inside it are quoted with ', "
  // or \" (Java / C# / Kotlin strings). Names outside them are kept unless they are dotted class
  // names outside the Android framework (com.vendor.FooView), whose segments are anonymized.
  const LITERAL = /(\\"(?:(?!\\")[\s\S])*\\"|\\'(?:(?!\\')[\s\S])*\\'|"[^"]*"|'[^']*')/;
  const CLASS = /(?<![\w$.{])((?:[a-z]\w*\.)+[A-Za-z_]\w*)/g;

  function className(name) {
    if (/^androidx?\./.test(name)) return name;
    return name.split('.').map(text).join('.');
  }

  function xpath(source) {
    return source.split(LITERAL).map((part, i) => {
      if (i % 2) {
        const q = part.startsWith('\\') ? part.slice(0, 2) : part[0];
        const inner = part.slice(q.length, part.length - q.length);
        // Framework class names and framework ids (android:id/button1) are public vocabulary.
        return q + (/^androidx?\.[\w.$]+$|^android:id\/\w+$/.test(inner) ? inner : text(inner)) + q;
      }
      return part.split(INTERP).map((p, j) => (j % 2 ? p : p.replace(CLASS, className))).join('');
    }).join('');
  }

  return { register, xpath, text };
}

// ---------------------------------------------------------------------------------------------------
// Kinds and forms.

function kindOf(rec) {
  if (rec.status === STATUS.SKIPPED_IOS) return 'xpath-ios';
  const structure = rec.source.replace(/\\?(["'])(?:(?!\1)[^\\]|\\.)*?\\?\1/g, '""');
  if (/(^|\/)(input|div|span|a|button|img|li|ul|label|form|h[1-6])(\[|\/|$)|@aria-|@href|@placeholder/.test(structure)) return 'xpath-web';
  if (/\$\{|\$[A-Za-z_]|\{[A-Za-z_]?\w*\}|%[sdf]/.test(rec.source)) return 'xpath-dynamic';
  return 'xpath';
}

// Feature tests over the literal with string values blanked, so values never trigger a form.
const FORMS = [
  ['absolute /hierarchy/…', (s) => /^\(?\/hierarchy/.test(s)],
  ['starts with //', (s) => /^\(?\/\//.test(s)],
  ['(…)[n] instance', (s) => /^\(.*\)\[\d+\]$/.test(s)],
  ['//* wildcard step', (s) => /\/\/\*/.test(s)],
  ['class-name step', (s) => /\/(?:[\w]+::)?[a-z]+\.[\w.$]+/.test(s)],
  ['single step only', (s) => !/^\(?\/hierarchy/.test(s) && (s.replace(/\[[^\]]*\]/g, '').match(/\/\/?/g) || []).length === 1],
  ['two or more steps', (s) => (s.replace(/\[[^\]]*\]/g, '').match(/\/\/?/g) || []).length >= 2],
  ['//A//B descendant chain', (s) => /\/\/[^/]+\/\/[^/]/.test(s.replace(/\[[^\]]*\]/g, ''))],
  ['step [n] index', (s) => /[\w*)]\[\d+\]/.test(s.replace(/^\((.*)\)\[\d+\]$/, '$1'))],
  ['@text', (s) => /@text\b/.test(s)],
  ['@content-desc', (s) => /@content-desc\b/.test(s)],
  ['@resource-id', (s) => /@resource-id\b/.test(s)],
  ['@class', (s) => /@class\b/.test(s)],
  ['@index', (s) => /@index\b/.test(s)],
  ['@package', (s) => /@package\b/.test(s)],
  ['boolean attribute', (s) => /@(checkable|checked|clickable|enabled|focusable|focused|long-clickable|scrollable|selected|displayed|password)\b/.test(s)],
  ['iOS-style @name / @label / @value', (s) => /@(name|label|value)\b/.test(s)],
  ['other attribute', (s) => /@(?!text\b|content-desc\b|resource-id\b|class\b|index\b|package\b|checkable\b|checked\b|clickable\b|enabled\b|focusable\b|focused\b|long-clickable\b|scrollable\b|selected\b|displayed\b|password\b|name\b|label\b|value\b)[\w-]+/.test(s)],
  ['= comparison', (s) => /[^!<>]=/.test(s)],
  ['contains()', (s) => /\bcontains\(/.test(s)],
  ['starts-with()', (s) => /\bstarts-with\(/.test(s)],
  ['ends-with() / matches()', (s) => /\b(ends-with|matches)\(/.test(s)],
  ['text()', (s) => /\btext\(\)/.test(s)],
  ['normalize-space / translate / case functions', (s) => /\b(normalize-space|translate|lower-case|upper-case|substring|string-length)\(/.test(s)],
  ['and', (s) => /\sand\s/.test(s)],
  ['or', (s) => /\sor\s/.test(s)],
  ['not()', (s) => /\bnot\(/.test(s)],
  ['position() / last()', (s) => /\b(position|last)\(\)/.test(s)],
  ['parent .. / parent::', (s) => /\/\.\.|parent::/.test(s)],
  ['sibling axes', (s) => /(following|preceding)-sibling::/.test(s)],
  ['ancestor / following / preceding', (s) => /\b(ancestor|ancestor-or-self|following|preceding)::/.test(s)],
  ['self:: / child:: / descendant::', (s) => /\b(self|child|descendant|descendant-or-self)::/.test(s)],
  ['nested path predicate [.//X]', (s) => /\[\s*\.?\/\/?[\w*]/.test(s)],
  ['union \\|', (s) => /\|/.test(s)],
];

function blank(source) {
  return source.replace(/\\"(?:(?!\\")[\s\S])*\\"|\\'(?:(?!\\')[\s\S])*\\'|"[^"]*"|'[^']*'/g, '""');
}

// ---------------------------------------------------------------------------------------------------
// Context files for the scanner tests: real files (or excerpts) from the MIT / Apache-2.0 projects,
// with every XPath literal anonymized like the corpus and the extra strings listed in `strings`.
// Line ranges are 1-based and inclusive; skipped lines become one "…" comment.

const CONTEXTS = [
  {
    project: 'Thangarajtk/appium-mobileAutomationFramework', license: 'MIT', comment: '//',
    path: 'src/main/java/com/automate/pages/LoginPage.java', out: 'LoginPage.java',
    strings: /accessibility = "([^"]*)"/g,
  },
  {
    project: 'auth0-samples/mobile-quickstarts-tests', license: 'MIT', comment: '#',
    path: 'page_screen_ios.py', out: 'page_screen.py',
  },
  {
    project: 'a-ghorbani/pocketpal-ai', license: 'MIT', comment: '//',
    path: 'e2e/helpers/selectors.ts', out: 'selectors.ts', lines: [[20, 115], [515, 560]],
    strings: /(?:label|text|name|value) (?:==|CONTAINS|BEGINSWITH) "([^"$]*)"/g,
  },
  {
    project: 'ldi-github/shirates-core', license: 'Apache-2.0', comment: '//',
    path: 'src/test/kotlin/shirates/core/uitest/android/driver/misc/XPathTest.kt', out: 'XPathTest.kt',
    strings: /xpath=(\/\/\*\[@text='[^']*'\])/g,
  },
];

function buildContexts(cacheDir, pins, anon) {
  const dir = path.join(__dirname, 'contexts');
  fs.mkdirSync(dir, { recursive: true });
  for (const c of CONTEXTS) {
    const file = path.join(cacheDir, c.project.replace('/', '__'), c.path);
    const records = [];
    scanner.processFile(file, { dryRun: true, quiet: true, convert: () => ({ status: STATUS.SKIPPED_NO_CHANGE }) }, records, scanner.makeStats());
    let content = fs.readFileSync(file, 'utf8');
    for (const old of new Set(records.map((r) => r.old))) content = content.split(old).join(anon.xpath(old));
    if (c.strings) content = content.replace(c.strings, (m, v) => m.replace(v, v.startsWith('//') ? anon.xpath(v) : anon.text(v)));
    if (c.lines) {
      const all = content.split('\n');
      content = c.lines.map(([a, b]) => all.slice(a - 1, b).join('\n')).join(`\n\n${c.comment} …\n\n`) + '\n';
    }
    const sha = pins.find(([repo]) => repo === c.project)[1];
    const what = c.lines ? `Lines ${c.lines.map(([a, b]) => `${a}–${b}`).join(', ')} of` : 'Adapted from';
    const header = [
      `${what} https://github.com/${c.project}/blob/${sha}/${c.path}`,
      `${c.license} License, see LICENSES.md. Changed: string values anonymized (pseudo-words).`,
    ].map((l) => `${c.comment} ${l}`).join('\n');
    fs.writeFileSync(path.join(dir, c.out), `${header}\n\n${content}`);
  }
}

// ---------------------------------------------------------------------------------------------------

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (!e.name.startsWith('.')) out.push(p);
  }
  return out;
}

function main() {
  const cacheDir = process.argv[2];
  if (!cacheDir) {
    console.error('usage: node audit/corpus/build.js <cacheDir>');
    process.exit(2);
  }
  const pins = fs.readFileSync(path.join(cacheDir, 'pins.txt'), 'utf8').trim().split('\n').map((l) => l.split(' '));
  const saltFile = path.join(cacheDir, '.salt');
  if (!fs.existsSync(saltFile)) fs.writeFileSync(saltFile, crypto.randomBytes(32).toString('hex'));
  const anon = makeAnonymizer(fs.readFileSync(saltFile, 'utf8').trim());

  const raw = [];
  for (const [repo] of pins) {
    const root = path.join(cacheDir, repo.replace('/', '__'));
    if (!fs.existsSync(root)) continue;
    for (const file of walk(root)) {
      const records = [];
      scanner.processFile(file, {
        dryRun: true, quiet: true, rootDir: root, convert: () => ({ status: STATUS.SKIPPED_NO_CHANGE }),
      }, records, scanner.makeStats());
      if (!records.length) continue;
      const content = fs.readFileSync(file, 'utf8');
      const ext = path.extname(file).toLowerCase();
      for (const r of records) {
        anon.register(r.old);
        raw.push({
          project: repo,
          file: r.file,
          lang: LANG[ext] || ext.slice(1),
          quote: ["'", '"', '`'].find((q) => content.includes(q + r.old + q)) || '"',
          source: r.old,
          status: r.status,
          strategy: r.status === STATUS.SKIPPED_XPATH_STRATEGY ? r.reason.replace(/^xpath strategy: /, '').trim().replace(/\s*=$/, ' =') : null,
        });
      }
    }
  }

  // One entry per (project, literal), in project order then first appearance.
  const entries = new Map();
  for (const r of raw) {
    const source = anon.xpath(r.source);
    const key = `${r.project}\u0000${r.quote}\u0000${source}`;
    const e = entries.get(key);
    if (e) {
      e.count++;
      continue;
    }
    entries.set(key, {
      kind: kindOf(r),
      quote: r.quote,
      source,
      count: 1,
      project: r.project,
      lang: r.lang,
      strategy: r.strategy,
    });
  }
  const list = [...entries.values()].map((e, i) => ({ id: `A${String(i + 1).padStart(4, '0')}`, ...e }));
  fs.writeFileSync(path.join(__dirname, 'android-locators.json'), JSON.stringify(list, null, 2) + '\n');
  fs.writeFileSync(path.join(__dirname, 'frequencies.md'), frequencies(list, pins));
  buildContexts(cacheDir, pins, anon);
  console.log(`${raw.length} occurrences, ${list.length} entries`);
}

function table(head, rows) {
  return [`| ${head.join(' | ')} |`, `| ${head.map((h, i) => (i ? '---:' : '---')).join(' | ')} |`, ...rows.map((r) => `| ${r.join(' | ')} |`)].join('\n');
}

function pct(n, d) {
  return d ? `${((100 * n) / d).toFixed(1)} %` : '–';
}

function frequencies(list, pins) {
  const android = list.filter((e) => e.kind === 'xpath' || e.kind === 'xpath-dynamic');
  // Each project weighs 1: the mean over projects of the share of its unique literals that pass.
  const byProject = new Map();
  for (const e of android) {
    if (!byProject.has(e.project)) byProject.set(e.project, []);
    byProject.get(e.project).push(e);
  }
  const weighted = (test) => {
    let sum = 0;
    for (const es of byProject.values()) sum += es.filter(test).length / es.length;
    return pct(sum, byProject.size);
  };
  const occ = (es) => es.reduce((a, e) => a + e.count, 0);
  const tally = (es, keyOf) => {
    const m = new Map();
    for (const e of es) {
      const k = keyOf(e);
      const t = m.get(k) || { u: 0, o: 0 };
      t.u++;
      t.o += e.count;
      m.set(k, t);
    }
    return [...m.entries()].sort((a, b) => b[1].o - a[1].o);
  };

  const out = [];
  out.push('# R corpus: frequencies');
  out.push('');
  out.push('Generated by [`build.js`](build.js) from [`android-locators.json`](android-locators.json); do not edit.');
  out.push('"Unique" counts entries (one literal per project), "occurrences" counts every place in the source files.');
  out.push('');
  out.push('## Kinds');
  out.push('');
  out.push(table(['Kind', 'Unique', 'Occurrences'], tally(list, (e) => e.kind).map(([k, t]) => [`\`${k}\``, t.u, t.o])));
  out.push('');
  out.push('`xpath-ios` (iOS locators in cross-platform suites) and `xpath-web` (WebView / browser) are kept for');
  out.push('the scanner, but the forms below count only `xpath` and `xpath-dynamic`: the Android locators.');
  out.push('');
  out.push('## Languages');
  out.push('');
  const projectsByLang = new Map();
  for (const e of android) {
    if (!projectsByLang.has(e.lang)) projectsByLang.set(e.lang, new Set());
    projectsByLang.get(e.lang).add(e.project);
  }
  out.push('"Project-weighted" gives each project the same weight, so one large project does not set the share.');
  out.push('');
  out.push(table(['Language', 'Projects', 'Unique', 'Occurrences', 'Share', 'Project-weighted'],
    tally(android, (e) => e.lang).map(([k, t]) => [k, projectsByLang.get(k).size, t.u, t.o, pct(t.o, occ(android)), weighted((e) => e.lang === k)])));
  out.push('');
  out.push('## Strategies');
  out.push('');
  out.push('The call the literal is passed to, as the scanner sees it; "none" is a bare string (page-object field,');
  out.push('helper argument, data file).');
  out.push('');
  out.push(table(['Strategy', 'Unique', 'Occurrences'], tally(android, (e) => (e.strategy ? `\`${e.strategy.replace(/\|/g, '\\|')}\`` : 'none')).map(([k, t]) => [k, t.u, t.o])));
  out.push('');
  out.push('## Forms');
  out.push('');
  out.push(`Over ${android.length} unique Android literals (${occ(android)} occurrences). A literal has several forms, so the`);
  out.push('columns do not add up. String values are blanked before the tests, so they never trigger a form.');
  out.push('"Projects" shows how widespread a form is; "Project-weighted" is the mean of the per-project shares.');
  out.push('');
  const rows = FORMS.map(([name, test]) => {
    const hit = android.filter((e) => test(blank(e.source)));
    return [name, new Set(hit.map((e) => e.project)).size, hit.length, pct(hit.length, android.length), occ(hit), pct(occ(hit), occ(android)), weighted((e) => test(blank(e.source)))];
  });
  out.push(table(['Form', 'Projects', 'Unique', 'Share', 'Occurrences', 'Share', 'Project-weighted'], rows));
  out.push('');
  out.push('## Projects');
  out.push('');
  out.push(table(['Project', 'Android unique', 'Android occurrences', 'All occurrences'],
    pins.map(([repo]) => {
      const mine = list.filter((e) => e.project === repo);
      const a = mine.filter((e) => android.includes(e));
      return [repo, a.length, occ(a), occ(mine)];
    })));
  out.push('');
  return out.join('\n');
}

if (require.main === module) main();

module.exports = { makeAnonymizer, kindOf, FORMS, blank, CONTEXTS };
