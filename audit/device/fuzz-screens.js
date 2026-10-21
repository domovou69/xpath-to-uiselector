// R fuzz screens for LocatorLab (PLAN.md section 5, Fuzz mode).
//
// Every converted R literal (exact and close, audit/corpus/convert.js) gets a cell: a small subtree with
// elements that match its XPath and traps around them. The cell is built from the XPath alone (its AST from
// lib/xpath.js, read here independently of lib/converter.js), so a converter that misreads the XPath is
// caught by the device rather than copied into the screen:
//   targets   one plain, one two boxes deeper, one with another target inside it (nested matches); for
//             (…)[n] at least n+1; sometimes an invisible one
//   misses    a target with exactly one value changed: a character more or less, the case swapped, a space
//             around it, null instead of a value and "" instead of a value, a resource id without its
//             package, a boolean flipped, another class or no class at all, the index moved by one
//   //A//B    B outside A, A without B, A inside A, two Bs in one A, B with A inside it
// Values the literal does not test are random: null, "", or a value from another literal of the batch, so
// every cell is also a trap for the others. Runtime values (`%s`, `${x}`, `" + x + "`) get a random value
// with regex metacharacters, put into the XPath and into the UiSelector after the conversion, as at run time.
//
// Literals with the same XPath are one item. Items are ordered by a hash of the XPath and cut into batches
// of at most 500 (BATCH); a batch is spread over 5 screens (PER_BATCH), and the runner runs every item of a
// batch on every screen of the batch. A screen travels as base64 in one `am start` argument, which the device
// shell limits to 128 KB, so batches are made smaller until every screen fits in MAX_B64. Everything is
// seeded: the same seed and items give the same screens.
//
// Screens are generated once and kept in results/r-fuzz-screens.json; a fix to the converter changes the
// UiSelectors, never the screens. Items that convert only after a fix go into a new batch (`extend`).
//   node audit/device/fuzz-screens.js     prints the screen statistics, writes nothing
'use strict';

const crypto = require('node:crypto');
const corpus = require('../corpus/android-locators.json');
const { convertEntry, warningLabel } = require('../corpus/convert');
const { parseXPath } = require('../../lib/xpath');

const SEED = 'r-fuzz-1';
const BATCH = 500;
const PER_BATCH = 5;
const MAX_B64 = 100 * 1024;
// smallest width / height of a node in px: a node with no size is invisible, and a tiny one is fragile
const MIN_PX = 3;
const PKG = 'io.github.domovou69.locatorlab';
// LocatorLab's content area on the 1080×2400 AVD, for the size check
const AREA = { w: 1080, h: 2274 };
const BOX = 'io.github.locatorlab.Box';
const SPACE = 'io.github.locatorlab.Space';
const COMMON = ['android.widget.TextView', 'android.widget.Button', 'android.widget.ImageView', 'android.widget.EditText',
  'android.view.ViewGroup', 'android.widget.FrameLayout', 'android.widget.LinearLayout'];
// runtime values: no quote and no backslash (those are the documented limit), regex metacharacters on purpose
const RUNTIME = ['Item 7', 'v2.0', 'a+b', '(x)', 'Total $5', '50%', 'A|B', '[1]', 'Grüße', 'q?', 'x*y', 'ab.cd', 'n^2', '{id}', 'Ok'];
const KEY = { text: 't', 'content-desc': 'd', 'resource-id': 'id' };
const BOOLS = ['checkable', 'checked', 'clickable', 'enabled', 'focusable', 'focused', 'long-clickable', 'scrollable', 'selected'];

const sha = s => crypto.createHash('sha256').update(s).digest('hex');

// seeded PRNG (mulberry32) from any strings
function rng(...parts) {
  let a = parseInt(sha(parts.join('|')).slice(0, 8), 16);
  const next = () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const r = {
    next,
    int: n => Math.floor(next() * n),
    pick: a2 => a2[Math.floor(next() * a2.length)],
    chance: p => next() < p,
    shuffle: a2 => { const b = a2.slice(); for (let i = b.length - 1; i > 0; i--) { const j = r.int(i + 1); [b[i], b[j]] = [b[j], b[i]]; } return b; },
  };
  return r;
}

class NoGen extends Error {}
const nogen = m => { throw new NoGen(m); };

// ---------------------------------------------------------------------------
// Items: the converted R literals, one per distinct XPath
// ---------------------------------------------------------------------------

function currentItems(seed = SEED) {
  const by = new Map();
  for (const e of corpus) {
    if (e.kind !== 'xpath' && e.kind !== 'xpath-dynamic') continue;
    const r = convertEntry(e);
    if (r.outcome !== 'exact' && r.outcome !== 'close') continue;
    const it = by.get(r.xpath);
    if (it) { it.ids.push(e.id); it.projects.add(e.project); it.count += e.count; continue; }
    by.set(r.xpath, { key: sha(r.xpath).slice(0, 12), ids: [e.id], projects: new Set([e.project]), count: e.count,
      outcome: r.outcome, warnings: r.warnings.map(warningLabel), raw: r.xpath, rawUi: r.uiselector, placeholders: r.placeholders });
  }
  return [...by.values()].map(it => finish(it, seed)).sort((a, b) => (a.key < b.key ? -1 : 1));
}

// runtime values in, the package swapped for LocatorLab's (an app cannot set its nodes' package)
function finish(it, seed) {
  const rnd = rng(seed, it.key, 'runtime');
  let xpath = it.raw, ui = it.rawUi;
  const values = {};
  for (const [ch, src] of it.placeholders) {
    const v = rnd.pick(RUNTIME);
    values[src] = v;
    xpath = xpath.replaceAll(ch, v);
    ui = ui.replaceAll(ch, v);
  }
  let pkg = null;
  const m = /@package\s*=\s*(["'])([^"']*)\1/.exec(xpath);
  if (m) {
    pkg = m[2];
    xpath = xpath.replaceAll(pkg, PKG);
    ui = ui.replaceAll(pkg, PKG).replaceAll(pkg.replace(/\./g, '\\.'), PKG.replace(/\./g, '\\.'));
  }
  return { key: it.key, ids: it.ids, projects: [...it.projects], count: it.count, outcome: it.outcome, warnings: it.warnings,
    xpath, uiselector: ui, ...(Object.keys(values).length ? { runtime: values } : {}), ...(pkg ? { package: pkg } : {}) };
}

// ---------------------------------------------------------------------------
// Shape: what an element must have to match, read from the XPath AST
//   { instance: n | null, alts: [[level]] }   level = { cls, terms: [[atom]] } (terms: alternatives)
//   atom = { k: 'str', attr, op: eq|contains|starts|ends, v, ci } | { k: 'bool', attr, v } | { k: 'index', v } | { k: 'cls', v }
// ---------------------------------------------------------------------------

function shape(xpath) {
  let ast = parseXPath(xpath);
  let instance = null;
  if (ast.type === 'filter') {
    if (ast.preds.length !== 1) nogen('filter');
    instance = positionOf(ast.preds[0]) - 1;
    ast = ast.expr;
  }
  const paths = ast.type === 'union' ? ast.items : [ast];
  return { instance, alts: paths.map(levelsOf) };
}

function positionOf(p) {
  if (p.type === 'num') return p.value;
  if (p.type === 'cmp' && p.right.type === 'num') return p.right.value;
  if (p.type === 'cmp' && p.left.type === 'num') return p.left.value;
  return nogen('position');
}

function levelsOf(path) {
  if (path.type !== 'path') nogen(`not a path: ${path.type}`);
  const steps = path.steps.filter((s, i) => !(s.axis === 'self' && s.test.kind === 'node')
    && !(i === 0 && s.test.kind === 'name' && s.test.name === 'hierarchy'));
  return steps.map(s => {
    if (s.axis !== 'child' && s.axis !== 'descendant') nogen(`axis ${s.axis}`);
    if (s.test.kind !== 'name' && s.test.kind !== 'any') nogen(`test ${s.test.kind}`);
    const terms = s.preds.length ? solve({ type: 'and', items: s.preds }) : [[]];
    return { cls: s.test.kind === 'name' ? s.test.name : null, terms };
  });
}

const product = (a, b) => a.flatMap(x => b.map(y => [...x, ...y])).slice(0, 16);

function solve(e) {
  switch (e.type) {
    case 'and': return e.items.map(solve).reduce(product, [[]]);
    case 'or': return e.items.flatMap(solve);
    case 'cmp': return comparison(e);
    case 'call': return call(e);
    case 'path': {
      const s = e.steps[0];
      if (e.steps.length === 1 && s.axis === 'self' && s.test.kind === 'name') return [[{ k: 'cls', v: s.test.name }]];
      return nogen('path predicate');
    }
    default: return nogen(`predicate ${e.type}`);
  }
}

function ref(e) {
  if (e.type === 'path' && e.root === null && e.steps.length === 1 && e.steps[0].axis === 'attribute') return { attr: e.steps[0].test.name, ci: false };
  if (e.type === 'call' && e.name === 'lower-case') { const r = ref(e.args[0]); return r && { ...r, ci: true }; }
  return null;
}

function lit(e) {
  if (e.type === 'str') return e.value;
  if (e.type === 'num') return e.value;
  if (e.type === 'call' && e.name === 'concat') return e.args.map(lit).join('');
  if (e.type === 'call' && (e.name === 'true' || e.name === 'false')) return e.name === 'true';
  if (e.type === 'seq') return e.items.map(lit);
  return nogen(`value ${e.type}`);
}

function comparison(e) {
  if (e.op !== '=' && e.op !== 'eq') nogen(`op ${e.op}`);
  let r = ref(e.left), v;
  if (r) v = lit(e.right); else { r = ref(e.right); v = lit(e.left); }
  if (!r) nogen('comparison without an attribute');
  return (Array.isArray(v) ? v : [v]).map(x => [atom(r, 'eq', x)]);
}

function atom(r, op, v) {
  if (BOOLS.includes(r.attr)) return { k: 'bool', attr: r.attr, v: v === true || v === 'true' };
  if (r.attr === 'index') return { k: 'index', v: Number(v) };
  if (r.attr === 'class') return { k: 'cls', v: String(v) };
  if (KEY[r.attr] || r.attr === 'package') return { k: 'str', attr: r.attr, op, v: String(v), ci: r.ci };
  return nogen(`attribute ${r.attr}`);
}

function call(e) {
  const op = { contains: 'contains', 'starts-with': 'starts', 'ends-with': 'ends' }[e.name];
  if (op) { const r = ref(e.args[0]); if (!r) nogen(`${e.name} without an attribute`); return [[atom(r, op, lit(e.args[1]))]]; }
  if (e.name === 'not') {
    const inner = solve(e.args[0]);
    if (inner.length === 1 && inner[0].length === 1 && inner[0][0].k === 'bool') return [[{ ...inner[0][0], v: !inner[0][0].v }]];
  }
  return nogen(`call ${e.name}`);
}

// ---------------------------------------------------------------------------
// Nodes (LocatorLab JSON: c, id, t, d, b, k, row, w, hide). `_index`: the node must be child n of its parent.
// ---------------------------------------------------------------------------

const box = k => ({ c: BOX, k });
// spacers take half a share, so the elements around them keep more room
const space = () => ({ c: SPACE, w: 0.5 });
const hasCase = s => s.toLowerCase() !== s.toUpperCase();
const swapCase = s => [...s].map(ch => (ch === ch.toLowerCase() ? ch.toUpperCase() : ch.toLowerCase())).join('');
function randomCase(s, rnd) {
  const letters = [...s].map((ch, i) => (ch.toLowerCase() !== ch.toUpperCase() ? i : -1)).filter(i => i >= 0);
  if (!letters.length) return s;
  const up = new Set(letters.filter(() => rnd.chance(0.5)));
  if (!up.size) up.add(rnd.pick(letters));
  return [...s].map((ch, i) => (up.has(i) ? ch.toUpperCase() : ch)).join('');
}

function strValue(atoms, rnd) {
  const eq = atoms.find(a => a.op === 'eq');
  const pad = () => rnd.pick(['', '', ' ', 'x', 'Pre ', ' end']);
  let v = eq ? eq.v : atoms.filter(a => a.op === 'starts').map(a => a.v).join('') + pad()
    + atoms.filter(a => a.op === 'contains').map(a => a.v).join(pad()) + pad() + atoms.filter(a => a.op === 'ends').map(a => a.v).join('');
  if (atoms.some(a => a.ci)) v = randomCase(v, rnd);
  return v;
}

// an element of `lv`; attributes the level does not test are random
function element(lv, rnd, pools) {
  const term = rnd.pick(lv.terms);
  const n = { c: lv.cls }, strs = {}, b = {};
  n._tested = new Set();
  for (const a of term) {
    if (a.k === 'cls') n.c = a.v;
    else if (a.k === 'bool') b[a.attr] = a.v;
    else if (a.k === 'index') n._index = a.v;
    else (strs[a.attr] ||= []).push(a);
  }
  if (n.c === null) n.c = rnd.pick(pools.classes);
  else n._tested.add('c');
  for (const [attr, atoms] of Object.entries(strs)) {
    if (attr === 'package') continue;
    n[KEY[attr]] = strValue(atoms, rnd);
    n._tested.add(KEY[attr]);
    if (atoms.some(a => a.ci)) n._ci = true;
  }
  for (const k of ['t', 'd', 'id']) {
    if (n._tested.has(k)) continue;
    const r = rnd.next();
    if (r < 0.15) n[k] = '';
    else if (r < 0.5) n[k] = rnd.pick(k === 'id' ? pools.ids : pools.strings);
  }
  for (const k of BOOLS) if (!(k in b) && rnd.chance(0.15)) b[k] = k === 'enabled' ? false : true;
  for (const k of Object.keys(b)) n._tested.add(`b:${k}`);
  if (Object.keys(b).length) n.b = b;
  return n;
}

// one tested value of `n` changed; returns false when n tests nothing
function mutate(n, rnd, pools) {
  const keys = [...n._tested];
  if (n._index !== undefined) keys.push('index');
  if (!keys.length) return false;
  const k = rnd.pick(keys);
  if (k === 'index') { n._index += n._index > 0 && rnd.chance(0.5) ? -1 : 1; return true; }
  if (k.startsWith('b:')) { const b = k.slice(2); n.b = { ...n.b, [b]: !(n.b?.[b] ?? b === 'enabled') }; return true; }
  if (k === 'c') { n.c = rnd.chance(0.25) ? null : rnd.pick(pools.classes.filter(c => c !== n.c)); return true; }
  const s = n[k];
  // half the time a change that breaks contains() too: a middle character gone, the case swapped, no value
  const strong = ['absent', ''];
  if (s.length > 2) strong.push(s.slice(0, s.length >> 1) + s.slice((s.length >> 1) + 1));
  if (hasCase(s) && !n._ci) strong.push(swapCase(s), randomCase(s.toLowerCase(), rnd));
  if (k === 'id' && s.includes(':id/')) strong.push(s.split(':id/')[1]);
  const weak = [s + 'x', 'x' + s, ' ' + s, s + ' '];
  if (s.length > 1) weak.push(s.slice(0, -1), s.slice(1));
  const v = rnd.pick((rnd.chance(0.5) ? strong : weak).filter(o => o !== s));
  if (v === 'absent') delete n[k]; else n[k] = v;
  return true;
}

// a chain of levels: each level an element with the next level somewhere inside
function chain(levels, rnd, pools, mutateAt = -1) {
  let inner = null;
  for (let i = levels.length - 1; i >= 0; i--) {
    const n = element(levels[i], rnd, pools);
    if (i === mutateAt) mutate(n, rnd, pools);
    if (inner) n.k = rnd.shuffle([wrap(inner, rnd, rnd.int(2)), space()]);
    inner = n;
  }
  return inner;
}

function wrap(n, rnd, depth) {
  for (let i = 0; i < depth; i++) n = box(rnd.chance(0.5) ? [n, space()] : [space(), n]);
  return n;
}

// deepest node of the first path through `n`'s children that is not a spacer
const tip = n => { while (n.k && n.k.some(c => c.c !== SPACE)) n = n.k.find(c => c.c !== SPACE); return n; };

function cell(item, rnd, pools) {
  const sh = item.shape;
  const alt = () => rnd.pick(sh.alts);
  const target = () => chain(alt(), rnd, pools);
  const kids = [target(), wrap(target(), rnd, 2)];
  const outer = target();
  tip(outer).k = rnd.shuffle([target(), space()]);
  kids.push(outer);
  for (let i = 4; i < (sh.instance ?? 0) + 2; i++) kids.push(wrap(target(), rnd, rnd.int(3)));
  if (rnd.chance(0.3)) { const h = target(); h.hide = true; kids.push(h); }
  // near misses: one level of a target with one value changed
  for (let i = 0; i < 4; i++) { const a = alt(); kids.push(wrap(chain(a, rnd, pools, rnd.int(a.length)), rnd, rnd.chance(0.3) ? 1 : 0)); }
  const multi = sh.alts.filter(a => a.length > 1);
  if (multi.length) {
    const a = rnd.pick(multi), last = a[a.length - 1], first = a[0];
    kids.push(element(last, rnd, pools)); // B outside A
    kids.push(element(first, rnd, pools)); // A without B
    const aa = element(first, rnd, pools); aa.k = [chain(a, rnd, pools), space()]; kids.push(aa); // A inside A
    const two = chain(a, rnd, pools); tip(two).k = [element(last, rnd, pools), element(last, rnd, pools)]; // two Bs, nested under the first B's parent
    kids.push(two);
    const rev = element(last, rnd, pools); rev.k = [element(first, rnd, pools), space()]; kids.push(rev); // B with A inside
  }
  // two per row, so a cell with many elements keeps them tall enough
  const k = rnd.shuffle(kids), pairs = [];
  for (let i = 0; i < k.length; i += 2) pairs.push(k.length - i > 1 ? box(k.slice(i, i + 2)) : k[i]);
  return box(pairs);
}

// places _index nodes, gives every parent two children at least (equal bounds would make a parent and its only
// child look alike), alternates rows and columns, strips the generator's fields
function finalize(n, rowParent = false) {
  if (n.k) {
    let k = [];
    for (const c of n.k) {
      if (c._index !== undefined) {
        const at = c._index;
        delete c._index;
        k.push(box([...Array.from({ length: at }, space), c, space()]));
      } else k.push(c);
    }
    if (k.length === 1) k.push(space());
    n.k = k;
    n.row = !rowParent;
    for (const c of n.k) finalize(c, n.row);
  }
  delete n._tested; delete n._ci;
  if (n._index !== undefined) delete n._index;
  if (!n.row) delete n.row;
  return n;
}

// the smallest node size, by LocatorLab's layout (an even split along the box's axis)
function minSize(n, w, h) {
  let min = { w, h };
  if (!n.k) return min;
  const len = n.row ? w : h;
  const sum = n.k.reduce((s, c) => s + (c.w ?? 1), 0);
  for (const c of n.k) {
    const each = Math.floor((len * (c.w ?? 1)) / sum);
    const m = minSize(c, n.row ? each : w, n.row ? h : each);
    min = { w: Math.min(min.w, m.w), h: Math.min(min.h, m.h) };
  }
  return min;
}
const count = n => 1 + (n.k || []).reduce((s, c) => s + count(c), 0);
const depth = n => 1 + Math.max(0, ...(n.k || []).map(depth));

// ---------------------------------------------------------------------------
// Batches and screens
// ---------------------------------------------------------------------------

// The form of an XPath: string values, class names and numbers replaced, the rest (functions, operators,
// brackets, positions, spacing) kept. Used to report the fuzz by form, not only by count.
const form = x => x.replace(/"[^"]*"|'[^']*'/g, 'S').replace(/\b(?:android|androidx|com|io|org)(?:\.[\w$]+)+/g, 'C')
  .replace(/\b\d+\b/g, 'N').replace(/\s+/g, ' ');

// items → { batches: [{ id, items: [key], screens: [screen] }] }, starting at batch number `from`; screens are
// named <prefix><batch>s<screen>
function generate(items, seed = SEED, from = 0, prefix = 'b') {
  const ok = [], nogenItems = [];
  for (const it of items) {
    try { it.shape = shape(it.xpath); ok.push(it); } catch (e) { if (e instanceof NoGen) nogenItems.push({ key: it.key, reason: e.message }); else throw e; }
  }
  for (let nb = Math.max(1, Math.ceil(ok.length / BATCH)); ; nb++) {
    const batches = cut(ok, nb, seed, from, prefix);
    if (batches.every(b => b.screens.every(sc => b64(sc) <= MAX_B64 && fits(sc)))) {
      for (const it of ok) delete it.shape;
      return { batches, nogen: nogenItems };
    }
  }
}

const fits = sc => { const m = minSize(sc.root, AREA.w, AREA.h); return m.w >= MIN_PX && m.h >= MIN_PX; };
const b64 = sc => Buffer.from(JSON.stringify(sc), 'utf8').toString('base64').length;

function cut(ok, nb, seed, from, prefix) {
  const size = Math.ceil(ok.length / nb);
  const batches = [];
  for (let b = 0; b < nb; b++) {
    const mine = ok.slice(b * size, (b + 1) * size);
    if (!mine.length) continue;
    const id = from + b;
    const pools = poolsOf(mine);
    const screens = Array.from({ length: PER_BATCH }, (_, s) => ({ name: `${prefix}${id}s${s}`, cells: [] }));
    mine.forEach((it, i) => { it.batch = id; it.home = screens[i % PER_BATCH].name; screens[i % PER_BATCH].cells.push(it); });
    batches.push({ id, items: mine.map(it => it.key), screens: screens.map(sc => screen(sc, seed, pools)) });
  }
  return batches;
}

function poolsOf(items) {
  const classes = new Set(COMMON), strings = new Set(), ids = new Set();
  for (const it of items) {
    for (const a of it.shape.alts) for (const lv of a) {
      if (lv.cls) classes.add(lv.cls);
      for (const t of lv.terms) for (const x of t) {
        if (x.k === 'cls') classes.add(x.v);
        if (x.k === 'str' && x.attr === 'resource-id') ids.add(x.v);
        else if (x.k === 'str') strings.add(x.v);
      }
    }
  }
  return { classes: [...classes].sort(), strings: [...strings].sort(), ids: ids.size ? [...ids].sort() : ['a:id/b'] };
}

// cells in a grid of 4 columns
function screen(sc, seed, pools) {
  const cells = sc.cells.map(it => cell(it, rng(seed, it.key, sc.name), pools));
  const rows = [];
  for (let i = 0; i < cells.length; i += 4) rows.push(box(cells.slice(i, i + 4)));
  return { name: sc.name, root: finalize(box(rows), true) };
}

function stats(sc) {
  const json = JSON.stringify(sc);
  return { name: sc.name, nodes: count(sc.root), depth: depth(sc.root), kb: Math.round(json.length / 102.4) / 10,
    b64kb: Math.round(b64(sc) / 102.4) / 10, min: minSize(sc.root, AREA.w, AREA.h) };
}

module.exports = { SEED, currentItems, generate, stats, shape, form };

if (require.main === module) {
  const items = currentItems();
  const { batches, nogen: ng } = generate(items);
  console.log(`${items.length} items (${items.filter(i => i.outcome === 'exact').length} exact), ${batches.length} batches, not generated: ${ng.length}`);
  for (const x of ng) console.log('  nogen', x.key, x.reason);
  for (const b of batches) for (const sc of b.screens) console.log(JSON.stringify(stats(sc)));
}
