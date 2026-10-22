#!/usr/bin/env node
// The oracle (PLAN.md section 5), Fuzz mode: every converted R literal on the generated screens of its batch
// (fuzz-screens.js). For each item and screen, findElements with the XPath and with the converter's
// UiSelector; the lists are compared by fingerprint and order, with the outcomes of run.js.
//
// Verdict of an item over the screens of its batch:
//   CORRECT   exact (or close only for a runtime value, which the fuzz fills with a safe one): EQUAL on
//             every screen, and the XPath finds at least one element on the item's own screen
//   DRIFT     close (childSelector, android.view.View, lower-case): the first element is the same on
//             every screen (both empty counts); the documented difference, scored 0.5. For android.view.View
//             the elements with no class name, which only the XPath finds, are left out first
//   WRONG     anything else
//   VACUOUS   the XPath finds nothing on the item's own screen: the cell did not work, nothing is shown
// No screen has a 70-level chain or a toast, so DEPTH and TOAST (run.js) do not apply.
//
// The screens are generated once into results/r-fuzz-screens.json (with --generate, or on the first run);
// later runs reuse them and add a batch for items that convert only now. The UiSelectors come from the
// current converter on every run, and a result counts only for the UiSelector it was run with, so after a
// fix --resume reruns just the items whose UiSelector changed. Results: results/r-fuzz.json, saved as it
// goes; the summary: results/r-fuzz-summary.md. --out api37 writes r-fuzz-api37.json and r-fuzz-summary-api37.md
// instead (another device or Android version); the screens file is shared.
//   node audit/device/fuzz.js [--generate] [--resume] [--batch 0,1] [--only key,key] [--mutants] [--summary] [--out api37]
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { Session, UI, launch, requirePower, device, stack } = require('./wd');
const { SEED, currentItems, generate, form } = require('./fuzz-screens');
const corpus = require('../corpus/android-locators.json');

const args = process.argv.slice(2);
const opt = k => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
const DIR = path.join(__dirname, 'results');
const SCREENS = path.join(DIR, 'r-fuzz-screens.json');
const SUFFIX = opt('--out') ? `-${opt('--out')}` : '';
const OUT = path.join(DIR, `r-fuzz${SUFFIX}.json`);
const SUMMARY = path.join(DIR, `r-fuzz-summary${SUFFIX}.md`);
// warnings about runtime values, which the fuzz fills with safe ones
const RUNTIME_ONLY = new Set(['runtime value in a literal', 'runtime class name', 'runtime index', 'runtime position']);
const VIEW = 'android.view.View';
// rare forms (at most RARE_MAX XPaths of the form) run again on screens of their own, one batch per seed
const RARE_MAX = 2;
const RARE_SEEDS = ['r-fuzz-rare-1', 'r-fuzz-rare-2', 'r-fuzz-rare-3'];
// matrix screens (fuzz-screens.js matrixCell): every item once, run only on its own screen
const MATRIX_SEED = 'r-fuzz-matrix-2';
const KEEP_FP = 10; // fingerprint lists up to this length are kept; longer ones only when they differ

const read = f => JSON.parse(fs.readFileSync(f, 'utf8'));
const write = (f, v, indent = 1) => { fs.mkdirSync(DIR, { recursive: true }); fs.writeFileSync(f, JSON.stringify(v, null, indent) + '\n'); };
const hash = v => crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex').slice(0, 16);

// the screens file, created or extended for the items the converter converts now
function screensFor(items) {
  const file = fs.existsSync(SCREENS) ? read(SCREENS) : { seed: SEED, date: new Date().toISOString().slice(0, 10), items: {}, batches: [] };
  const fresh = items.filter(it => !file.items[it.key] && !(file.nogen || []).some(n => n.key === it.key));
  if (fresh.length) {
    const copies = fresh.map(it => ({ ...it }));
    const { batches, nogen } = generate(copies, file.seed, file.batches.length);
    file.batches.push(...batches);
    for (const it of copies.filter(c => c.batch !== undefined)) {
      file.items[it.key] = { batch: it.batch, home: it.home, xpath: it.xpath, ids: it.ids,
        ...(it.runtime ? { runtime: it.runtime } : {}), ...(it.package ? { package: it.package } : {}) };
    }
    file.nogen = [...(file.nogen || []), ...nogen];
    write(SCREENS, file, 0);
    console.log(`screens: ${fresh.length} new items in ${batches.length} new batches → ${path.relative(process.cwd(), SCREENS)}`);
  }
  if (!file.rare) {
    const n = {};
    for (const it of items) n[form(it.xpath)] = (n[form(it.xpath)] || 0) + 1;
    const rare = items.filter(it => n[form(it.xpath)] <= RARE_MAX);
    file.rare = RARE_SEEDS.flatMap((seed, i) => generate(rare.map(it => ({ ...it })), seed, 0, `r${i}b`).batches.map(b => ({ ...b, seed })));
    write(SCREENS, file, 0);
    console.log(`screens: ${rare.length} items of rare forms on ${file.rare.length * 5} more screens`);
  }
  if (!file.matrix) {
    const copies = items.map(it => ({ ...it }));
    const { batches } = generate(copies, MATRIX_SEED, 0, 'm', { matrix: true });
    file.matrix = { seed: MATRIX_SEED, home: Object.fromEntries(copies.filter(c => c.home).map(c => [c.key, c.home])), batches };
    write(SCREENS, file, 0);
    console.log(`screens: ${items.length} items on ${batches.length * 5} matrix screens`);
  }
  // items that convert only now get matrix screens of their own
  const noMatrix = items.filter(it => !file.matrix.home[it.key] && !(file.matrix.nogen || []).includes(it.key));
  if (noMatrix.length) {
    const copies = noMatrix.map(it => ({ ...it }));
    const from = Math.max(-1, ...file.matrix.batches.map(b => b.id)) + 1;
    const { batches, nogen } = generate(copies, file.matrix.seed, from, 'm', { matrix: true });
    file.matrix.batches.push(...batches);
    for (const c of copies) if (c.home) file.matrix.home[c.key] = c.home;
    file.matrix.nogen = [...(file.matrix.nogen || []), ...nogen.map(n => n.key)];
    write(SCREENS, file, 0);
    console.log(`screens: ${noMatrix.length - nogen.length} new items on ${batches.length * 5} new matrix screens`);
  }
  for (const it of items) if (file.items[it.key] && file.items[it.key].xpath !== it.xpath) throw new Error(`item ${it.key}: the XPath differs from the screens file`);
  return file;
}

// ---------------------------------------------------------------------------
// Lookups
// ---------------------------------------------------------------------------

async function lookup(s, cache, using, value) {
  const r = await s.findAll(using, value);
  if (r.error) return { ms: r.ms, error: r.error };
  const fp = new Array(r.ids.length);
  // a few elements at a time; an element id the screen has already shown keeps its fingerprint
  for (let i = 0; i < r.ids.length; i += 8) {
    await Promise.all(r.ids.slice(i, i + 8).map(async (id, j) => {
      if (!cache.has(id)) cache.set(id, await s.fingerprint(id));
      fp[i + j] = cache.get(id);
    }));
  }
  return { ms: r.ms, n: fp.length, fp };
}

function compare(x, u) {
  if (x.error) return 'XPATH_ERROR';
  if (u.error) return 'UISEL_ERROR';
  if (JSON.stringify(x.fp) === JSON.stringify(u.fp)) return 'EQUAL';
  if (JSON.stringify([...x.fp].sort()) === JSON.stringify([...u.fp].sort())) return 'ORDER_DIFFERS';
  return 'SET_DIFFERS';
}

// what is kept of a lookup: count, time, hash and first fingerprint; the list when short or different
const keep = (l, outcome) => (l.error ? l : { ms: l.ms, n: l.n, h: hash(l.fp), ...(l.n ? { f0: l.fp[0] } : {}),
  ...(l.n <= KEEP_FP || outcome !== 'EQUAL' ? { fp: l.fp } : {}) });

// ---------------------------------------------------------------------------
// Verdicts and summary
// ---------------------------------------------------------------------------

// a lookup that failed on the way (Appium proxy timeout, a dropped socket), not on the selector: --resume reruns it
const transient = r => [r?.x?.error, r?.u?.error].some(e => /timeout|could not proxy|ECONNRESET|socket hang up/i.test(e || ''));

const strict = it => it.outcome === 'exact' || it.warnings.every(w => RUNTIME_ONLY.has(w));

// Mutants (--mutants): wrong UiSelectors made from an exact item's own, run on its own screen. A mutant the
// screen tells apart from the XPath is killed; the share killed shows how strong the traps are.
const STR = String.raw`"((?:[^"\\]|\\.)*)"`;
const MUTANTS = [
  // the case-insensitive methods the converter never emits (SEL-02)
  ['contains → *Contains', u => {
    const re = /\.(text|description|resourceId)Matches\("\(\?s\)\.\*([\w ]+)\.\*"\)/, m = re.exec(u);
    // only where a letter has a case: *Contains differs from the regex by its case folding (an equivalent mutant otherwise)
    return m && m[2].toLowerCase() !== m[2].toUpperCase() ? u.replace(re, '.$1Contains("$2")') : u;
  }],
  ['eq → *StartsWith', u => u.replace(new RegExp(`\\.(text|description)\\(${STR}\\)`), '.$1StartsWith("$2")')],
  ['eq → *Contains', u => u.replace(new RegExp(`\\.(text|description)\\(${STR}\\)`), '.$1Contains("$2")')],
  ['no className', u => (/\)\.\w+\(/.test(u.replace(/^new UiSelector\(\)\.className\("[^"]*"\)/, '')) ? u.replace(/^(new UiSelector\(\))\.className\("[^"]*"\)/, '$1') : u)],
  ['first criterion dropped', u => { const m = /^new UiSelector\(\)(\.\w+\((?:"(?:[^"\\]|\\.)*"|\w+)\))(\.\w+\()/.exec(u); return m ? u.replace(m[1], '') : u; }],
  ['last criterion dropped', u => { const m = /^(new UiSelector\(\)\.\w+\((?:"(?:[^"\\]|\\.)*"|\w+)\).*)(\.\w+\((?:"(?:[^"\\]|\\.)*"|\w+)\))$/.exec(u); return m && !/childSelector/.test(u) ? m[1] : u; }],
  ['instance + 1', u => u.replace(/\.instance\((\d+)\)/, (_, n) => `.instance(${+n + 1})`)],
  ['index + 1', u => u.replace(/\.index\((\d+)\)/, (_, n) => `.index(${+n + 1})`)],
  ['boolean flipped', u => u.replace(/\.(checked|checkable|clickable|enabled|focusable|focused|longClickable|scrollable|selected)\((true|false)\)/, (_, m, v) => `.${m}(${v === 'true' ? 'false' : 'true'})`)],
  ['plain → regex, no anchor', u => u.replace(new RegExp(`\\.(text|description|resourceId)\\(${STR}\\)`), (_, m, v) => `.${m}Matches("(?s).*${v.replace(/[\^$.|?*+()[\]{}]/g, '\\$&')}.*")`)],
  ['text ↔ description', u => u.replace(/\.(text|description)(Matches)?\(/, (_, a, r) => `.${a === 'text' ? 'description' : 'text'}${r || ''}(`)],
  ['resource id without package', u => u.replace(/\.resourceId\("[^"]*:id\/([^"]*)"\)/, '.resourceId("$1")')],
  ['regex unescaped', u => (/Matches\(/.test(u) ? u.replace(/\\([.^$|?*+()[\]{}])/g, '$1') : u)],
  ['plain → unescaped regex', u => u.replace(new RegExp(`\\.(text|description|resourceId)\\(${STR}\\)`), (m0, m, v) => (/[.^$|?*+()[\]{}]/.test(v) ? `.${m}Matches("${v}")` : m0))],
  // textMatches and descriptionMatches compile with DOTALL (SEL-03): there (?s) changes nothing
  ['(?s) dropped', u => (/(resourceId|className|packageName)Matches\("\(\?s\)/.test(u) ? u.replace(/((?:resourceId|className|packageName)Matches\(")\(\?s\)/, '$1') : u)],
  // only where a letter has a case: on other values (?i) changes nothing (an equivalent mutant)
  ['(?i) added', u => { const m = /Matches\("((?:[^"\\]|\\.)*)"/.exec(u); const body = m && m[1].replace(/\(\?[a-z-]*:?/g, '').replace(/\\./g, ''); return body && body.toLowerCase() !== body.toUpperCase() ? u.replace(/Matches\("/, 'Matches("(?i)') : u; }],
  ['className → classNameMatches', u => u.replace(/\.className\("(?:[^"]*\.)?([^".]+)"\)/, '.classNameMatches(".*$1")')],
  ['ends → contains', u => u.replace(/(\w+Matches)\("(\(\?s\)\.\*)((?:[^"\\]|\\.)*)"\)/, (m0, m, a, b) => (b.endsWith('.*') ? m0 : `${m}("${a}${b}.*")`))],
  ['starts → contains', u => u.replace(/(\w+Matches)\("\(\?s\)((?:[^"\\]|\\.)*)\.\*"\)/, (m0, m, b) => (b.startsWith('.*') || b.startsWith('(?=') ? m0 : `${m}("(?s).*${b}.*")`))],
];
const mutantsOf = it => MUTANTS.map(([name, f]) => [name, f(it.uiselector)]).filter(([, u]) => u !== it.uiselector);
const MUTANTS_PER_KIND = 150;
// the first MUTANTS_PER_KIND exact items (in key order) that each mutant applies to
function mutantPlan(items) {
  const plan = new Set(), n = {};
  for (const it of items.filter(i => i.outcome === 'exact')) {
    for (const [name] of mutantsOf(it)) if ((n[name] = (n[name] || 0) + 1) <= MUTANTS_PER_KIND) plan.add(`${it.key}|${name}`);
  }
  return plan;
}

// `set`: 'base' (the screens of the item's batch), 'rare' (its screens of the rare-form seeds; vacuous when no
// screen has a match) or 'matrix' (its own matrix screen)
function verdict(it, file, runs, set = 'base') {
  const meta = file.items[it.key];
  const rare = set === 'rare';
  const screens = rare ? file.rare.filter(b => b.items.includes(it.key)).flatMap(b => b.screens.map(sc => sc.name))
    : set === 'matrix' ? (file.matrix?.home[it.key] ? [file.matrix.home[it.key]] : [])
      : file.batches[meta.batch].screens.map(sc => sc.name);
  const rs = screens.map(sc => runs[`${it.key}|${sc}`]).filter(r => r && r.ui === it.uiselector);
  if (!screens.length || rs.length < screens.length) return { v: 'NOT RUN' };
  const home = rare ? rs.find(r => r.x.n) || rs[0] : set === 'matrix' ? rs[0] : rs.find(r => r.screen === meta.home);
  const bad = rs.filter(r => r.outcome !== 'EQUAL');
  if (strict(it)) {
    if (bad.length) return { v: 'WRONG', bad };
    return home.x.n ? { v: 'CORRECT' } : { v: 'VACUOUS' };
  }
  // android.view.View: the XPath also finds elements with no class name (empty class in the fingerprint)
  const view = it.warnings.includes(VIEW);
  const first = l => (view ? (l.fp ? l.fp.find(f => !f.startsWith('|')) : l.f0?.startsWith('|') ? undefined : l.f0) : l.f0) ?? null;
  const firstBad = rs.filter(r => r.x.error || r.u.error || first(r.x) !== first(r.u));
  if (firstBad.length) return { v: 'WRONG', bad: firstBad };
  if (!home.x.n) return { v: 'VACUOUS' };
  return { v: 'DRIFT', equal: !bad.length };
}

const pct = (a, b) => (b ? `${((100 * a) / b).toFixed(1)} %` : '—');
const median = a => { const b = a.slice().sort((x, y) => x - y); return b.length ? b[b.length >> 1] : null; };

function summary(doc, file, items, all = items) {
  const V = items.map(it => ({ it, ...verdict(it, file, doc.runs) }));
  const by = v => V.filter(x => x.v === v);
  const lit = list => list.reduce((n, x) => n + x.it.ids.length, 0);
  const android = corpus.filter(e => e.kind === 'xpath' || e.kind === 'xpath-dynamic').length;
  const run = V.filter(x => x.v !== 'NOT RUN');
  const scored = run.filter(x => x.v !== 'VACUOUS');
  const R = list => (list.length ? (100 * (list.filter(x => x.v === 'CORRECT').length + 0.5 * list.filter(x => x.v === 'DRIFT').length)) / list.length : 0);
  const RL = list => { const n = lit(list); return n ? (100 * (lit(list.filter(x => x.v === 'CORRECT')) + 0.5 * lit(list.filter(x => x.v === 'DRIFT')))) / n : 0; };
  const screens = file.batches.flatMap(b => b.screens);
  const nodes = n => 1 + (n.k || []).reduce((s, c) => s + nodes(c), 0);
  const sizes = screens.map(sc => nodes(sc.root));
  const L = [];
  L.push('# R fuzz run on the emulator', '');
  L.push(`Generated by \`audit/device/fuzz.js\` from \`${path.basename(OUT)}\` (${doc.date}). Stack: appium ${doc.stack.appium}, uiautomator2 driver`);
  L.push(`${doc.stack.uiautomator2Driver}, server ${doc.stack.uiautomator2Server}; ${doc.device.avd}, Android ${doc.device.android} (API ${doc.device.sdk}); default settings.`, '');
  const matrixOnly = !Object.keys(doc.runs).some(k => /\|b\d+s\d+$/.test(k)) && Object.keys(doc.runs).some(k => /\|m\d+s\d+$/.test(k));
  if (matrixOnly) L.push('**This run covers only the matrix screens (`--matrix`).** The random screens did not run here, so the verdicts,',
    'score and forms below show NOT RUN; the result is under [Matrix screens](#matrix-screens).', '');
  L.push(`Items: the ${items.length} distinct XPaths of the ${lit(V)} converted Android literals of the R corpus (exact and close,`);
  L.push(`[convert-summary.md](../../corpus/convert-summary.md)). Screens: ${screens.length} (${file.batches.length} batches of ≈${Math.round(items.length / file.batches.length)} items, 5 screens each,`);
  L.push(`${Math.min(...sizes)}–${Math.max(...sizes)} nodes, seed \`${file.seed}\`, [r-fuzz-screens.json](r-fuzz-screens.json)), built by [fuzz-screens.js](../fuzz-screens.js) from`);
  L.push('each XPath: targets (plain, deeper, nested, invisible, n+1 for a position), near misses with one value changed, and');
  L.push('for `//A//B` B outside A, A inside A, two Bs in one A. Every item runs on every screen of its batch. A batch is');
  L.push('smaller than the planned ≈500 because a screen travels in one `am start` argument (128 KB on the device).', '');
  L.push('CORRECT: EQUAL on every screen, with a match on the item\'s own screen. DRIFT: a close form (childSelector,');
  L.push('android.view.View, lower-case) whose first element agrees on every screen. Close forms that only warn about a');
  L.push('runtime value are held to EQUAL, since the fuzz fills in safe values. VACUOUS: no match on the item\'s own screen.', '');
  L.push('What the device sees is the XPath after the scanner has read the source literal. How the literal is written in the');
  L.push('source (quotes, escapes, `String.format`, f-strings, concatenation) and how the UiSelector is written back are');
  L.push('checked by the unit tests (`npm test`) and offline per language ([convert-summary.md](../../corpus/convert-summary.md)), not here.', '');
  if (file.nogen?.length) {
    L.push(`Not run: ${file.nogen.length} converted XPath${file.nogen.length > 1 ? 's' : ''} the screen builder cannot read (${[...new Set(file.nogen.map(n => n.reason))].join(', ')}),`);
    L.push('covered by the edge cases instead.', '');
  }
  L.push('## Verdicts', '');
  L.push('| Verdict | Items | Literals | Exact items | Close items |', '| --- | --- | --- | --- | --- |');
  for (const v of ['CORRECT', 'DRIFT', 'WRONG', 'VACUOUS', 'NOT RUN']) {
    const l = by(v);
    if (!l.length && v !== 'WRONG') continue;
    L.push(`| ${v} | ${l.length} | ${lit(l)} | ${l.filter(x => x.it.outcome === 'exact').length} | ${l.filter(x => x.it.outcome === 'close').length} |`);
  }
  L.push('');
  const drift = by('DRIFT');
  if (drift.length) {
    L.push('Close forms by warning (an item can have more than one):', '');
    L.push('| Warning | Items | First element agrees | Also EQUAL everywhere |', '| --- | --- | --- | --- |');
    const ws = [...new Set(items.filter(it => it.outcome === 'close').flatMap(it => it.warnings))];
    for (const w of ws) {
      const l = V.filter(x => x.it.warnings.includes(w) && x.v !== 'NOT RUN');
      L.push(`| ${w} | ${l.length} | ${l.filter(x => x.v === 'DRIFT' || x.v === 'CORRECT').length} | ${l.filter(x => x.v === 'CORRECT' || x.equal).length} |`);
    }
    L.push('');
  }
  L.push('## Score (PLAN.md section 5)', '');
  L.push(`R = 100 × (CORRECT + 0.5 × DRIFT) / converted and run (VACUOUS left out): **${R(scored).toFixed(1)}** over ${scored.length} items,`);
  L.push(`**${RL(scored).toFixed(1)}** over their ${lit(scored)} literals. Skips are not run here: every skip reason has an S case on the`);
  L.push('device ([s-summary.md](s-summary.md)).', '');
  const conv = list => list.reduce((n, it) => n + it.ids.length, 0);
  L.push(`C = converted / Android literals: **${pct(conv(all), android)}** (${conv(all)} of ${android}); exact only ${pct(conv(all.filter(it => it.outcome === 'exact')), android)}.`, '');
  // by form
  const forms = new Map();
  for (const x of V) forms.set(form(x.it.xpath), [...(forms.get(form(x.it.xpath)) || []), x]);
  const fsorted = [...forms].sort((a, b) => b[1].length - a[1].length || (a[0] < b[0] ? -1 : 1));
  L.push('## By form', '');
  L.push(`The ${items.length} XPaths have ${forms.size} forms (string values, class names and numbers replaced: \`S\`, \`C\`, \`N\`);`);
  L.push(`${fsorted.filter(f => f[1].length === 1).length} forms have one XPath. The verdicts above are counts of XPaths; per form they read:`);
  L.push(`${fsorted.filter(f => f[1].every(x => x.v === 'CORRECT' || x.v === 'DRIFT')).length} of ${forms.size} forms with no WRONG and no VACUOUS XPath. Spacing is kept (\`@text =S\` is its own form).`, '');
  const row = ([f, l]) => `| \`${f.replace(/\|/g, '\\|')}\` | ${l.length} | ${lit(l)} | ${['CORRECT', 'DRIFT', 'WRONG', 'VACUOUS'].map(v => l.filter(x => x.v === v).length || '').join(' | ')} |`;
  const head = ['| Form | XPaths | Literals | CORRECT | DRIFT | WRONG | VACUOUS |', '| --- | --- | --- | --- | --- | --- | --- |'];
  L.push(...head, ...fsorted.slice(0, 20).map(row), '');
  if (fsorted.length > 20) L.push(`<details><summary>The other ${fsorted.length - 20} forms</summary>`, '', ...head, ...fsorted.slice(20).map(row), '', '</details>', '');
  if (file.rare?.length) {
    const rare = items.filter(it => file.rare.some(b => b.items.includes(it.key)));
    const RV = rare.map(it => ({ it, ...verdict(it, file, doc.runs, 'rare') }));
    const n = v => RV.filter(x => x.v === v).length;
    L.push('### Rare forms, three more seeds', '');
    L.push(`The ${rare.length} XPaths of forms with at most ${RARE_MAX} XPaths ran again on ${file.rare.length * 5} screens of their own, one batch per seed`);
    L.push(`(${RARE_SEEDS.map(x => `\`${x}\``).join(', ')}): CORRECT ${n('CORRECT')}, DRIFT ${n('DRIFT')}, WRONG ${n('WRONG')}, VACUOUS ${n('VACUOUS')}, not run ${n('NOT RUN')}.`, '');
    for (const x of RV.filter(y => y.v === 'WRONG')) L.push(`- WRONG \`${x.it.key}\` \`${x.it.xpath}\`: ${x.bad.map(r => `${r.screen} ${r.outcome}`).join(', ')}`);
    if (n('WRONG')) L.push('');
  }
  const wrong = by('WRONG');
  L.push('## Differences', '');
  if (!wrong.length) L.push('None.', '');
  for (const x of wrong) {
    L.push(`- \`${x.it.key}\` ${x.it.outcome}${x.it.warnings.length ? ` (${x.it.warnings.join(', ')})` : ''}, ${x.it.ids.join(', ')}`);
    L.push(`  - XPath \`${x.it.xpath}\``, `  - UiSelector \`${x.it.uiselector}\``);
    for (const r of x.bad) {
      const c = l => (l.error ? `error: ${l.error.slice(0, 120)}` : l.n);
      L.push(`  - ${r.screen}: ${r.outcome}, XPath ${c(r.x)} / UiSelector ${c(r.u)}${r.x.f0 !== r.u.f0 ? `; first ${JSON.stringify(r.x.f0 ?? null)} vs ${JSON.stringify(r.u.f0 ?? null)}` : ''}`);
    }
  }
  if (wrong.length) L.push('');
  const vac = by('VACUOUS');
  if (vac.length) {
    L.push('## Vacuous', '');
    for (const x of vac) L.push(`- \`${x.it.key}\` \`${x.it.xpath}\``);
    L.push('');
  }
  if (file.matrix) {
    const MV = items.map(it => ({ it, ...verdict(it, file, doc.runs, 'matrix') }));
    const n = v => MV.filter(x => x.v === v).length;
    const ms = file.matrix.batches.flatMap(b => b.screens);
    const nodes = sc => { const c = x => 1 + (x.k || []).reduce((t, y) => t + c(y), 0); return c(sc.root); };
    L.push('## Matrix screens', '');
    L.push(`Every item once more, on ${ms.length} screens of its own kind (seed \`${file.matrix.seed}\`, ${Math.min(...ms.map(nodes))}–${Math.max(...ms.map(nodes))} nodes), run only on its own screen. A matrix`);
    L.push('cell breaks every tested condition of every level in every way that applies to it: for a string one character more');
    L.push('or less at either end, the case swapped, a space around it or a no-break space in it, null, "", the value in');
    L.push('another attribute, a resource id without its package, and the strings that the value read as an unescaped regex');
    L.push('matches (`.` → `x`, `a+b` → `aab`, `(x)` → `x`); for contains / starts-with the value broken in place or moved to');
    L.push('the other end; similar classes (`ImageButton` for `Button`, another package, `…Compat`, lower case, none); booleans');
    L.push('flipped; the index moved by one with an invisible sibling before it. Targets: every alternative, deeper, nested,');
    L.push('with line breaks around a contains / starts-with value and with the bare value; invisible ones (hidden, in a hidden');
    L.push('box, no size) and a hidden match first in the cell; union branches also in reverse document order.', '');
    L.push(`Verdicts: CORRECT ${n('CORRECT')}, DRIFT ${n('DRIFT')}, WRONG ${n('WRONG')}, VACUOUS ${n('VACUOUS')}, not run ${n('NOT RUN')}.`, '');
    for (const x of MV.filter(y => y.v === 'WRONG' || y.v === 'VACUOUS')) {
      L.push(`- ${x.v} \`${x.it.key}\` \`${x.it.xpath}\` → \`${x.it.uiselector}\`${x.bad ? `: ${x.bad.map(r => `${r.outcome} ${r.x.error ? 'err' : r.x.n}/${r.u.error ? 'err' : r.u.n}`).join(', ')}` : ''}`);
    }
    if (n('WRONG') + n('VACUOUS')) L.push('');
  }
  // only the mutants of the current plan, made from the current UiSelectors
  const plan = mutantPlan(items), cur = new Map();
  for (const it of items) for (const [name, u] of mutantsOf(it)) if (plan.has(`${it.key}|${name}`)) cur.set(`${it.key}|${name}`, u);
  const live = st => Object.entries(st || {}).filter(([k, m]) => cur.get(k) === m.ui).map(([, m]) => m);
  const mb = live(doc.mutants), mm = live(doc.mutantsMatrix);
  if (mb.length || mm.length) {
    const killed = l => l.filter(m => m.outcome !== 'EQUAL').length;
    L.push('## Mutants', '');
    L.push('Do the screens catch a wrong conversion? A mutant is a wrong UiSelector made from an exact item\'s own, the kind');
    L.push('of error a converter could make (the converter never emits these: its rules and the S cases on the device keep it');
    L.push('to exact forms). Each mutant runs on its item\'s own screen; it is killed when the result differs from the XPath\'s.');
    L.push(`Up to ${MUTANTS_PER_KIND} items per kind, the first in key order. A survivor is a mutant that no element of the screen tells apart.`, '');
    L.push('| Mutant | Random traps: run | killed | Matrix: run | killed |', '| --- | --- | --- | --- | --- |');
    for (const [name] of MUTANTS) {
      const b = mb.filter(m => m.mutant === name), x = mm.filter(m => m.mutant === name);
      if (b.length || x.length) L.push(`| ${name} | ${b.length} | ${pct(killed(b), b.length)} | ${x.length} | ${pct(killed(x), x.length)} |`);
    }
    L.push(`| all | ${mb.length} | ${pct(killed(mb), mb.length)} | ${mm.length} | ${pct(killed(mm), mm.length)} |`, '');
    const surv = mm.filter(m => m.outcome === 'EQUAL');
    if (surv.length) {
      L.push('Survivors on the matrix screens are left for one of two reasons: a `(…)[1]` whose first match on the screen lies in an');
      L.push('earlier cell of another item with the same value, so both lookups return that element; or `@package`, which');
      L.push('LocatorLab cannot set (every node has the app\'s package), so dropping `packageName` changes nothing on any screen.', '');
      L.push(`<details><summary>Survivors on the matrix screens (${surv.length})</summary>`, '');
      for (const m of surv) L.push(`- ${m.mutant}: \`${items.find(i => i.key === m.key)?.xpath}\` → \`${m.ui}\` (${m.xn}/${m.un})`);
      L.push('', '</details>', '');
    }
  }
  const rs = Object.values(doc.runs);
  L.push('## Lookup times', '');
  L.push(`Recorded per lookup in \`${path.basename(OUT)}\`; a side product, not a benchmark. Median findElements: XPath ${median(rs.filter(r => !r.x.error).map(r => r.x.ms))} ms,`);
  L.push(`UiSelector ${median(rs.filter(r => !r.u.error).map(r => r.u.ms))} ms over ${rs.length} item/screen pairs; with more than 20 matches XPath`);
  L.push(`${median(rs.filter(r => r.x.n > 20).map(r => r.x.ms))} ms, UiSelector ${median(rs.filter(r => r.u.n > 20).map(r => r.u.ms))} ms.`, '');
  return L.join('\n') + '\n';
}

// ---------------------------------------------------------------------------

(async () => {
  const all = currentItems();
  const file = screensFor(all);
  // an XPath the screen builder cannot read (file.nogen) has no screens: listed in the summary, not run
  const items = all.filter(it => file.items[it.key]);
  if (args.includes('--generate')) return;
  const doc = fs.existsSync(OUT) && (args.includes('--resume') || args.includes('--summary')) ? read(OUT) : { runs: {} };
  if (args.includes('--summary')) { fs.writeFileSync(SUMMARY, summary(doc, file, items, all)); console.log(SUMMARY); return; }
  const host = requirePower();
  const only = opt('--only')?.split(',');
  const batches = opt('--batch')?.split(',').map(Number);
  const s = await Session.open();
  Object.assign(doc, { date: new Date().toISOString().slice(0, 10), host, device: device(), stack: stack(s), settings: await s.settings(), seed: file.seed });
  const byKey = new Map(items.map(it => [it.key, it]));
  const matrix = args.includes('--matrix');
  const homeOf = k => (matrix ? file.matrix.home[k] : file.items[k].home);
  if (args.includes('--mutants')) {
    const store = matrix ? (doc.mutantsMatrix ||= {}) : (doc.mutants ||= {});
    const plan = mutantPlan(items);
    try {
      for (const b of matrix ? file.matrix.batches : file.batches) {
        if (batches && !batches.includes(b.id)) continue;
        for (const sc of b.screens) {
          const todo = b.items.map(k => byKey.get(k)).filter(it => it && it.outcome === 'exact' && homeOf(it.key) === sc.name)
            .flatMap(it => mutantsOf(it).map(([name, u]) => ({ it, name, u }))).filter(m => plan.has(`${m.it.key}|${m.name}`) && store[`${m.it.key}|${m.name}`]?.ui !== m.u);
          if (!todo.length) continue;
          await launch(sc);
          const cache = new Map();
          console.log(`screen ${sc.name}: ${todo.length} mutants`);
          for (const m of todo) {
            const x = await lookup(s, cache, 'xpath', m.it.xpath);
            const u = await lookup(s, cache, UI, m.u);
            store[`${m.it.key}|${m.name}`] = { key: m.it.key, mutant: m.name, ui: m.u, outcome: compare(x, u), xn: x.n, un: u.error ? 'err' : u.n };
          }
          write(OUT, doc, 0);
        }
      }
    } finally { write(OUT, doc, 0); await s.close(); }
    fs.writeFileSync(SUMMARY, summary(doc, file, items, all));
    return;
  }
  const pool = args.includes('--rare') ? file.rare : matrix ? file.matrix.batches : file.batches;
  const todoOf = (b, sc) => b.items.map(k => byKey.get(k)).filter(it => it && (!only || only.includes(it.key)))
    .filter(it => !matrix || homeOf(it.key) === sc.name)
    .filter(it => doc.runs[`${it.key}|${sc.name}`]?.ui !== it.uiselector || transient(doc.runs[`${it.key}|${sc.name}`]));
  const total = pool.filter(b => !batches || batches.includes(b.id)).reduce((n, b) => n + b.screens.reduce((m, sc) => m + todoOf(b, sc).length, 0), 0);
  let done = 0, diffs = 0;
  const t0 = Date.now();
  try {
    for (const b of pool) {
      if (batches && !batches.includes(b.id)) continue;
      for (const sc of b.screens) {
        const todo = todoOf(b, sc);
        if (!todo.length) continue;
        await launch(sc);
        const cache = new Map();
        console.log(`screen ${sc.name}: ${todo.length} items`);
        for (const it of todo) {
          const x = await lookup(s, cache, 'xpath', it.xpath);
          const u = await lookup(s, cache, UI, it.uiselector);
          const outcome = compare(x, u);
          const full = it.warnings.includes(VIEW) ? 'DIFFERS' : outcome;
          doc.runs[`${it.key}|${sc.name}`] = { key: it.key, screen: sc.name, ui: it.uiselector, outcome, x: keep(x, full), u: keep(u, full) };
          done++;
          if (outcome !== 'EQUAL' && strict(it)) { diffs++; console.log(`  ${it.key} ${outcome} ${x.error ? 'err' : x.n}/${u.error ? 'err' : u.n} ${it.xpath}`); }
          if (done % 25 === 0) write(OUT, doc, 0);
          if (done % 100 === 0) console.log(`  ${done}/${total}, ${Math.round((Date.now() - t0) / 60000)} min, ${diffs} exact differences`);
        }
        write(OUT, doc, 0);
      }
    }
  } finally { write(OUT, doc, 0); await s.close(); }
  fs.writeFileSync(SUMMARY, summary(doc, file, items, all));
  console.log(`done ${done}/${total} in ${Math.round((Date.now() - t0) / 60000)} min, ${diffs} exact differences → ${path.relative(process.cwd(), SUMMARY)}`);
})().catch(e => { console.error(e); process.exit(1); });
