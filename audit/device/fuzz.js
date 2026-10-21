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
// goes; the summary: results/r-fuzz-summary.md.
//   node audit/device/fuzz.js [--generate] [--resume] [--batch 0,1] [--only key,key] [--mutants] [--summary]
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
const OUT = path.join(DIR, 'r-fuzz.json');
const SUMMARY = path.join(DIR, 'r-fuzz-summary.md');
const RUNTIME_ONLY = 'runtime value in a literal';
const VIEW = 'android.view.View';
// rare forms (at most RARE_MAX XPaths of the form) run again on screens of their own, one batch per seed
const RARE_MAX = 2;
const RARE_SEEDS = ['r-fuzz-rare-1', 'r-fuzz-rare-2', 'r-fuzz-rare-3'];
const KEEP_FP = 10; // fingerprint lists up to this length are kept; longer ones only when they differ

const read = f => JSON.parse(fs.readFileSync(f, 'utf8'));
const write = (f, v, indent = 1) => { fs.mkdirSync(DIR, { recursive: true }); fs.writeFileSync(f, JSON.stringify(v, null, indent) + '\n'); };
const hash = v => crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex').slice(0, 16);

// the screens file, created or extended for the items the converter converts now
function screensFor(items) {
  const file = fs.existsSync(SCREENS) ? read(SCREENS) : { seed: SEED, date: new Date().toISOString().slice(0, 10), items: {}, batches: [] };
  const fresh = items.filter(it => !file.items[it.key]);
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
  for (const it of items) if (file.items[it.key].xpath !== it.xpath) throw new Error(`item ${it.key}: the XPath differs from the screens file`);
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

const strict = it => it.outcome === 'exact' || it.warnings.every(w => w === RUNTIME_ONLY);

// Mutants (--mutants): wrong UiSelectors made from an exact item's own, run on its own screen. A mutant the
// screen tells apart from the XPath is killed; the share killed shows how strong the traps are.
const STR = String.raw`"((?:[^"\\]|\\.)*)"`;
const MUTANTS = [
  // the case-insensitive methods the converter never emits (SEL-02)
  ['contains → *Contains', u => u.replace(new RegExp(`\\.(text|description|resourceId)Matches\\("\\(\\?s\\)\\.\\*([\\w ]+)\\.\\*"\\)`), '.$1Contains("$2")')],
  ['eq → *StartsWith', u => u.replace(new RegExp(`\\.(text|description)\\(${STR}\\)`), '.$1StartsWith("$2")')],
  ['eq → *Contains', u => u.replace(new RegExp(`\\.(text|description)\\(${STR}\\)`), '.$1Contains("$2")')],
  ['no className', u => (/\)\.\w+\(/.test(u.replace(/^new UiSelector\(\)\.className\("[^"]*"\)/, '')) ? u.replace(/^(new UiSelector\(\))\.className\("[^"]*"\)/, '$1') : u)],
  ['first criterion dropped', u => { const m = /^new UiSelector\(\)(\.\w+\((?:"(?:[^"\\]|\\.)*"|\w+)\))(\.\w+\()/.exec(u); return m ? u.replace(m[1], '') : u; }],
  ['last criterion dropped', u => { const m = /^(new UiSelector\(\)\.\w+\((?:"(?:[^"\\]|\\.)*"|\w+)\).*)(\.\w+\((?:"(?:[^"\\]|\\.)*"|\w+)\))$/.exec(u); return m && !/childSelector/.test(u) ? m[1] : u; }],
  ['instance + 1', u => u.replace(/\.instance\((\d+)\)/, (_, n) => `.instance(${+n + 1})`)],
  ['index + 1', u => u.replace(/\.index\((\d+)\)/, (_, n) => `.index(${+n + 1})`)],
  ['boolean flipped', u => u.replace(/\.(checked|checkable|clickable|enabled|focusable|focused|longClickable|scrollable|selected)\((true|false)\)/, (_, m, v) => `.${m}(${v === 'true' ? 'false' : 'true'})`)],
  ['plain → regex, no anchor', u => u.replace(new RegExp(`\\.(text|description|resourceId)\\(${STR}\\)`), (_, m, v) => `.${m}Matches("(?s).*${v.replace(/[\^$.|?*+()[\]{}]/g, '\\$&')}.*")`)],
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

// `rare`: over the item's screens of the rare-form seeds; vacuous there when no screen has a match
function verdict(it, file, runs, rare = false) {
  const meta = file.items[it.key];
  const screens = rare ? file.rare.filter(b => b.items.includes(it.key)).flatMap(b => b.screens.map(sc => sc.name))
    : file.batches[meta.batch].screens.map(sc => sc.name);
  const rs = screens.map(sc => runs[`${it.key}|${sc}`]).filter(r => r && r.ui === it.uiselector);
  if (!screens.length || rs.length < screens.length) return { v: 'NOT RUN' };
  const home = rare ? rs.find(r => r.x.n) || rs[0] : rs.find(r => r.screen === meta.home);
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

function summary(doc, file, items) {
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
  L.push(`Generated by \`audit/device/fuzz.js\` from \`r-fuzz.json\` (${doc.date}). Stack: appium ${doc.stack.appium}, uiautomator2 driver`);
  L.push(`${doc.stack.uiautomator2Driver}, server ${doc.stack.uiautomator2Server}; ${doc.device.avd}, Android ${doc.device.android} (API ${doc.device.sdk}); default settings.`, '');
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
  L.push(`C = converted / Android literals: **${pct(lit(V), android)}** (${lit(V)} of ${android}); exact only ${pct(lit(V.filter(x => x.it.outcome === 'exact')), android)}.`, '');
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
    const RV = rare.map(it => ({ it, ...verdict(it, file, doc.runs, true) }));
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
  const ms = Object.values(doc.mutants || {});
  if (ms.length) {
    L.push('## Mutants', '');
    L.push('How strong the screens are: wrong UiSelectors made from the exact items\' own (`--mutants`), each run on its');
    L.push('item\'s own screen. Killed: the result differs from the XPath\'s. A mutant that is right by chance (a dropped');
    L.push('criterion that no element on the screen needs) survives, so 100 % is not expected.', '');
    L.push('| Mutant | Run | Killed | Share |', '| --- | --- | --- | --- |');
    for (const [name] of MUTANTS) {
      const l = ms.filter(m => m.mutant === name);
      if (l.length) L.push(`| ${name} | ${l.length} | ${l.filter(m => m.outcome !== 'EQUAL').length} | ${pct(l.filter(m => m.outcome !== 'EQUAL').length, l.length)} |`);
    }
    L.push(`| all | ${ms.length} | ${ms.filter(m => m.outcome !== 'EQUAL').length} | ${pct(ms.filter(m => m.outcome !== 'EQUAL').length, ms.length)} |`, '');
  }
  const rs = Object.values(doc.runs);
  L.push('## Lookup times', '');
  L.push(`Recorded per lookup in \`r-fuzz.json\`; a side product, not a benchmark. Median findElements: XPath ${median(rs.filter(r => !r.x.error).map(r => r.x.ms))} ms,`);
  L.push(`UiSelector ${median(rs.filter(r => !r.u.error).map(r => r.u.ms))} ms over ${rs.length} item/screen pairs; with more than 20 matches XPath`);
  L.push(`${median(rs.filter(r => r.x.n > 20).map(r => r.x.ms))} ms, UiSelector ${median(rs.filter(r => r.u.n > 20).map(r => r.u.ms))} ms.`, '');
  return L.join('\n') + '\n';
}

// ---------------------------------------------------------------------------

(async () => {
  const items = currentItems();
  const file = screensFor(items);
  if (args.includes('--generate')) return;
  const doc = fs.existsSync(OUT) && (args.includes('--resume') || args.includes('--summary')) ? read(OUT) : { runs: {} };
  if (args.includes('--summary')) { fs.writeFileSync(SUMMARY, summary(doc, file, items)); console.log(SUMMARY); return; }
  const host = requirePower();
  const only = opt('--only')?.split(',');
  const batches = opt('--batch')?.split(',').map(Number);
  const s = await Session.open();
  Object.assign(doc, { date: new Date().toISOString().slice(0, 10), host, device: device(), stack: stack(s), settings: await s.settings(), seed: file.seed });
  const byKey = new Map(items.map(it => [it.key, it]));
  if (args.includes('--mutants')) {
    doc.mutants ||= {};
    const plan = mutantPlan(items);
    try {
      for (const b of file.batches) {
        if (batches && !batches.includes(b.id)) continue;
        for (const sc of b.screens) {
          const todo = b.items.map(k => byKey.get(k)).filter(it => it && it.outcome === 'exact' && file.items[it.key].home === sc.name)
            .flatMap(it => mutantsOf(it).map(([name, u]) => ({ it, name, u }))).filter(m => plan.has(`${m.it.key}|${m.name}`) && doc.mutants[`${m.it.key}|${m.name}`]?.ui !== m.u);
          if (!todo.length) continue;
          await launch(sc);
          const cache = new Map();
          console.log(`screen ${sc.name}: ${todo.length} mutants`);
          for (const m of todo) {
            const x = await lookup(s, cache, 'xpath', m.it.xpath);
            const u = await lookup(s, cache, UI, m.u);
            doc.mutants[`${m.it.key}|${m.name}`] = { key: m.it.key, mutant: m.name, ui: m.u, outcome: compare(x, u), xn: x.n, un: u.error ? 'err' : u.n };
          }
          write(OUT, doc);
        }
      }
    } finally { write(OUT, doc); await s.close(); }
    fs.writeFileSync(SUMMARY, summary(doc, file, items));
    return;
  }
  const pool = args.includes('--rare') ? file.rare : file.batches;
  const todoOf = (b, sc) => b.items.map(k => byKey.get(k)).filter(it => it && (!only || only.includes(it.key)))
    .filter(it => doc.runs[`${it.key}|${sc.name}`]?.ui !== it.uiselector);
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
          if (done % 25 === 0) write(OUT, doc);
          if (done % 100 === 0) console.log(`  ${done}/${total}, ${Math.round((Date.now() - t0) / 60000)} min, ${diffs} exact differences`);
        }
        write(OUT, doc);
      }
    }
  } finally { write(OUT, doc); await s.close(); }
  fs.writeFileSync(SUMMARY, summary(doc, file, items));
  console.log(`done ${done}/${total} in ${Math.round((Date.now() - t0) / 60000)} min, ${diffs} exact differences → ${path.relative(process.cwd(), SUMMARY)}`);
})().catch(e => { console.error(e); process.exit(1); });
