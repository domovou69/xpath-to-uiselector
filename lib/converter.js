// XPath → UiSelector (PLAN.md section 3, reference/, audit/spec/cases.js).
//
// The XPath is parsed into an AST (lib/xpath.js) and read into a query: one
// level per descendant step, each level a class name plus criteria per
// attribute. A level becomes one `new UiSelector()`; a second level is a
// childSelector (close, PLAN.md Decision 3), except under the first position:
// `(//A//B)[1]` → `A.instance(0).childSelector(B.instance(0))` is exact
// (SEL-14, SRV-35). Everything the rules do not cover throws Skip with the
// reason, and the locator is left as it is; a skip whose reason has a manual
// rewrite carries it as `hint` (HINTS).
//
// Output order: className, then the criteria in the order the XPath first
// names them, then instance, then childSelector.
//
// Literals (SRV-23): a plain criterion holds the value as is when it has no `"`
// and no `\`; otherwise the criterion becomes …Matches with every regex
// metacharacter escaped and `"` / `\` written as \x22 / \x5c. `(?s)` leads every
// regex that adds `.*`.
//
// Runtime values: the scanner passes `opts.placeholders`, a set of characters
// that stand for runtime values (`${x}`, `%s`, `" + x + "`). They stay as they
// are in a plain criterion and are quoted with \Q…\E in a regex; either way the
// result carries a warning, since a runtime value with `"` or `\` breaks it.
// A runtime value standing alone outside a literal converts in three places:
// a class name (`//${cls}`), an index (`@index='$i'`) and a position
// (`(//X)[${i}]`). A position needs the value minus one: the scanner passes
// `opts.decrement`, placeholder → placeholder for the host expression minus one,
// for the string syntaxes that evaluate expressions (lib/literal.js).
const STATUS = require('./status');
const { parseXPath, XPathError } = require('./xpath');
const { matchesEmpty, RegexError } = require('./regex');
const { parseUiSelector } = require('./uiselector');

class Skip extends Error {
  constructor(reason, status = STATUS.SKIPPED_UNSUPPORTED_LOGIC) {
    super(reason);
    this.status = status;
  }
}
const skip = (reason, status) => { throw new Skip(reason, status); };

// XPath attribute → [plain method, regex method] (SEL-01, SEL-03)
const STRING_ATTRS = {
  text: ['text', 'textMatches'],
  'content-desc': ['description', 'descriptionMatches'],
  'resource-id': ['resourceId', 'resourceIdMatches'],
  package: ['packageName', 'packageNameMatches'],
};
// XPath attribute → boolean method (SRV-09, SEL-04)
const BOOL_ATTRS = {
  checkable: 'checkable', checked: 'checked', clickable: 'clickable', enabled: 'enabled', focusable: 'focusable',
  focused: 'focused', 'long-clickable': 'longClickable', scrollable: 'scrollable', selected: 'selected',
};
// Names of getAttribute() that are not page source attributes (SRV-11).
const ALIASES = new Set(['name', 'resourceId', 'contentDescription', 'className', 'longClickable', 'content-description', 'contentDesc']);
// Attributes of web pages and iOS sources that the Android page source never has (reason only, not a filter:
// PLAN.md Decision 4).
const WEB_IOS = /^(?:label|value|id|type|style|displayName|visible|href|title|role|placeholder|data-.+|aria-.+)$/;
// Attributes written on every element (SRV-05, SRV-09, SRV-10): an existence test on them is always true.
const ALWAYS = new Set(['text', 'index', ...Object.keys(BOOL_ATTRS)]);

const REASON = {
  classRegex: 'classNameMatches makes findElements iterate index(i) instead of instance(i), so it loses elements',
  orAcross: 'or across attributes has no UiSelector form',
  negation: 'UiSelector has no negation for text',
  contradiction: 'the conditions contradict each other, so the XPath matches nothing',
  sibling: 'a position among siblings has no UiSelector form',
  textNodes: 'the page source has no text nodes, so text() matches nothing',
  descendantFilter: 'UiSelector has no has-descendant filter',
};

const WARN = {
  view: 'elements with no class name also appear as android.view.View in the page source',
  child: 'findElements returns at most one match per container',
  lowerCase: 'Android regexes are ICU: (?i) folds Unicode letters like lower-case() does, but one-to-many folds (İ, ß) are not checked',
  runtimePlain: 'a runtime value goes into a string literal: a " or a trailing \\ in it breaks the UiSelector',
  runtimeRegex: 'a runtime value goes into a regex (quoted with \\Q…\\E): a ", a \\ or \\E in it breaks the UiSelector',
  runtimeClass: 'a runtime class name goes into className(): it must be the full class name, and the page source also writes $ as . and a missing class as android.view.View',
  runtimeIndex: 'a runtime value goes into index(): it must be a whole number',
  runtimePosition: 'a runtime position goes into instance() minus one: it must be a whole number',
  range: 'a range widget (SeekBar, ProgressBar) has a text only in the page source, so the XPath also finds it',
};

// Manual rewrites for skips that have a near UiSelector form, by reason (first match wins).
const HINTS = [
  [/^UiSelector has no direct-child criterion/, 'A.childSelector(B) is the closest form, but it also finds B deeper below A: use it only where no deeper element matches B'],
  [/^a position among siblings/, '(//X)[n] counts over the whole screen and converts to instance(n-1); //X[n] counts among siblings, so the two agree only when every match has the same parent'],
  [/^absolute path from the page source root|^the page source root is not/, 'an absolute path breaks with any layout change: locate the element by its resource-id, text or content-desc instead'],
  [/^the parent (?:step|axis)|^sibling axes/, 'X.fromParent(Y) is the closest form, but it searches the whole subtree of X\'s parent, not one axis: use it only where it finds the same element'],
  [/^the ancestor axis/, 'UiSelector cannot go up more than one level: locate the ancestor by its own attributes'],
  [/^UiSelector has no has-descendant filter/, 'locate the element by its own attributes, or find the descendant with A.childSelector(B) and work from it in code'],
  [/^or across attributes|^a union of different attributes/, 'one lookup per side; for findElements, two UiSelectors joined with ; return the results statement by statement, not in document order, and findElement uses only the first'],
  [/^the page source has no text nodes/, 'the page source has no text nodes: write @text instead of text()'],
  [/^the page source has no name attribute/, 'write @text or @content-desc: name is an attribute only on iOS and web pages'],
  [/^the page source has no resourceId attribute/, 'write @resource-id'],
  [/^the page source has no (?:contentDescription|content-description|contentDesc) attribute/, 'write @content-desc'],
  [/^the page source has no className attribute/, 'write @class'],
  [/^the page source has no longClickable attribute/, 'write @long-clickable'],
  [/^a prefixed name test/, 'a resource id is not a tag name: //*[@resource-id="…:id/…"] converts to resourceId()'],
  [/^a path that continues after a filter expression/, '(//A)[n]//B is close to A.instance(n-1).childSelector(B), which returns only the first B and goes on to the next A when the n-th has none; a direct child after it has no UiSelector form'],
  [/^a position over a nested path counts/, 'A.instance(0).childSelector(B.instance(n-1)) counts within one A at a time: it finds the same element only where a single A matches (for example by a unique resource-id)'],
  [/^a runtime position in this kind of string/, 'write the UiSelector by hand with instance(i - 1): this string syntax cannot compute the value minus one'],
  [/^normalize-space\(\)/, 'where the text has no leading, trailing or repeated whitespace, @text="v" is the same test'],
  [/^classNameMatches makes findElements/, 'one lookup per class'],
];
const hintFor = reason => (HINTS.find(([re]) => re.test(reason)) || [])[1];

// Not valid in XML 1.0: replaced in the page source (SRV-14).
const NON_XML = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
// Float.toString shapes: the page source text of a range widget (SRV-06).
const FLOAT_TEXT = /^-?(?:\d+\.\d+(?:E-?\d+)?|NaN|Infinity)$/;

// Finite Float.toString values to try a text test on: a few fixed ones and values built around each literal of the
// test, so that a literal which is part of some value ("1.5", "2031", ".5", "E-5") yields one. NaN and Infinity are
// left out: a range widget does not show them in practice, and they contain letters that most literals have.
function floatProbes(leaves) {
  const out = new Set(['0.0', '50.0', '1.5', '-1.0', '1.0E10', '1.0E-5']);
  for (const l of leaves) {
    const v = l.value;
    if (!v) continue;
    for (const f of [v, `${v}.0`, `${v}0`, `0${v}`, `0${v}0`, `1${v}`, `1${v}0`, `-${v}`, `${v}.5`, `1.0${v}`, `1.${v}`, `1.${v}1`]) {
      if (FLOAT_TEXT.test(f) && !/[NI]/.test(f)) out.add(f);
    }
  }
  return [...out];
}

function convertXpathToUiSelector(xpath, opts = {}) {
  const ctx = { placeholders: opts.placeholders || new Set(), decrement: opts.decrement || new Map(), warnings: new Set() };
  try {
    const ast = parseXPath(xpath);
    const locator = emit(query(ast, ctx), ctx);
    // a runtime index or position stands where an int goes: check the form with 0 there
    const parsed = parseUiSelector(locator.replace(/(\.(?:index|instance)\()[\uE000-\uF8FF](\))/g, '$10$2'));
    if (!parsed.ok) return { locator: xpath, status: STATUS.SKIPPED_VALIDATION_FAILED, reason: `the UiSelector would not parse: ${parsed.error}` };
    const warning = [...ctx.warnings].join('; ');
    return { locator, status: STATUS.SUCCESS, ...(warning ? { warning } : {}) };
  } catch (e) {
    if (e instanceof Skip) return withHint({ locator: xpath, status: e.status, reason: e.message });
    if (e instanceof XPathError) {
      return withHint({ locator: xpath, status: STATUS.SKIPPED_UNSUPPORTED_LOGIC, reason: e.kind === 'invalid' ? `not a valid XPath: ${e.message}` : e.message });
    }
    throw e;
  }
}

function withHint(res) {
  const hint = hintFor(res.reason);
  return hint ? { ...res, hint } : res;
}

// ---------------------------------------------------------------------------
// Query: { levels: [level], instance: n | placeholder | null }; with more than
// one level the instance goes on the last one and instance(0) on the first.
// level: { cls, order: [key], str: Map(attr → [cond]), bool: Map(attr → b), index }
// cond:  { op: 'eq' | 'contains' | 'starts' | 'ends', value, ci }
//      | { op: 'matches', pattern, flags } | { op: 'or' | 'and', items }
// ---------------------------------------------------------------------------

function query(ast, ctx) {
  switch (ast.type) {
    case 'path': return pathQuery(ast, ctx);
    case 'union': return union(ast.items.map(item => query(item, ctx)));
    case 'filter': return positioned(ast, ctx);
    default: return skip('not a location path');
  }
}

// (expr)[n] and (expr)[position()=n] → instance(n-1) (XP-08, SEL-10); over a
// nested path only [1] (SEL-14).
function positioned(ast, ctx) {
  if (ast.expr.type !== 'path' && ast.expr.type !== 'union' && ast.expr.type !== 'filter') skip('not a location path');
  const inner = query(ast.expr, ctx);
  if (ast.preds.length !== 1) skip('more than one predicate on a grouped path is not converted');
  if (inner.instance !== null) skip('a position of a position is not converted');
  const instance = position(ast.preds[0], ctx);
  if (inner.levels.length > 1) {
    // UiSelector counts within each container (SEL-14): only the first agrees with the XPath
    if (instance !== 0) skip('a position over a nested path counts within each container in UiSelector, so only [1] converts');
    ctx.warnings.delete(WARN.child);
  }
  return { ...inner, instance };
}

// A runtime value standing alone as a predicate or a name: its placeholder.
function hole(e, ctx) {
  if (e.type !== 'path' || e.root !== null || e.steps.length !== 1) return null;
  const s = e.steps[0];
  return s.axis === 'child' && s.test.kind === 'name' && !s.preds.length && ctx.placeholders.has(s.test.name) ? s.test.name : null;
}

// The 0-based instance of a position predicate.
function position(pred, ctx) {
  const h = hole(pred, ctx);
  if (h) {
    if (!ctx.decrement.has(h)) skip('a runtime position in this kind of string literal is not converted');
    ctx.warnings.add(WARN.runtimePosition);
    return ctx.decrement.get(h);
  }
  if (pred.type === 'num') return positionNumber(pred) - 1;
  if (mentions(pred, 'last')) skip('last() has no UiSelector form');
  if (pred.type === 'cmp' && (pred.op === '=' || pred.op === 'eq')) {
    const [a, b] = isCall(pred.left, 'position') ? [pred.left, pred.right] : [pred.right, pred.left];
    if (isCall(a, 'position') && b.type === 'num') return positionNumber(b) - 1;
  }
  if (mentions(pred, 'position')) skip('a position range has no UiSelector form');
  return skip('only a number is converted in (…)[n]');
}

function positionNumber(num) {
  if (!Number.isInteger(num.value) || num.value < 1) skip('the position is not a whole number from 1, so the XPath matches nothing');
  return num.value;
}

const isCall = (e, name) => e.type === 'call' && e.name === name;
function mentions(e, name) {
  if (!e || typeof e !== 'object') return false;
  if (isCall(e, name)) return true;
  return Object.values(e).some(v => (Array.isArray(v) ? v.some(x => mentions(x, name)) : typeof v === 'object' && mentions(v, name)));
}

function pathQuery(ast, ctx) {
  const steps = ast.steps.slice();
  if (ast.root === '/') {
    if (!steps.length) skip('the document node is not an element');
    const first = steps[0];
    if (first.axis === 'child' && first.test.kind === 'name' && first.test.name === 'hierarchy' && !first.preds.length) {
      steps.shift();
      if (!steps.length) skip('the page source root is not an element on screen');
      if (!isDescendant(steps[0])) skip('absolute path from the page source root');
    } else if (first.axis !== 'descendant') {
      skip('absolute path from the page source root');
    }
  } else if (ast.root === '//') {
    if (steps[0].axis !== 'child' && steps[0].axis !== 'descendant') stepAxis(steps[0]);
  } else {
    // .//X from the document: a driver-level lookup starts there (F09).
    const first = steps[0];
    if (!(first.axis === 'self' && first.test.kind === 'node' && !first.preds.length) || steps.length < 2) skip('a relative path is not converted');
    steps.shift();
    if (!isDescendant(steps[0])) skip('UiSelector has no direct-child criterion');
  }

  const levels = steps.map((step, i) => {
    if (i > 0 && !isDescendant(step)) stepAxis(step);
    return level(step, ctx);
  });
  if (levels.length > 1) ctx.warnings.add(WARN.child);
  return { levels, instance: null };
}

// `//X`, `//descendant::X` and `/descendant::X` all select descendants.
const isDescendant = step => (step.sep === '//' && (step.axis === 'child' || step.axis === 'descendant'))
  || (step.sep === '/' && step.axis === 'descendant');

function stepAxis(step) {
  switch (step.axis) {
    case 'child': return skip('UiSelector has no direct-child criterion');
    case 'parent': return skip(step.test.kind === 'node' ? 'the parent step is not converted' : 'the parent axis is not converted');
    case 'ancestor': case 'ancestor-or-self': return skip('the ancestor axis is not converted');
    case 'following-sibling': case 'preceding-sibling': return skip('sibling axes are not converted');
    case 'attribute': return skip('the path selects attributes, not elements');
    default: return skip(`the ${step.axis} axis is not converted`);
  }
}

function level(step, ctx) {
  const lv = { cls: null, order: [], str: new Map(), bool: new Map(), index: null };
  const { test } = step;
  if (test.kind === 'text') skip(REASON.textNodes);
  if (test.kind === 'node') skip('node() steps are not converted');
  if (test.kind === 'name') {
    const name = test.name;
    if (/^XCUIElementType/.test(name)) skip('iOS element type', STATUS.SKIPPED_IOS);
    if (name === 'hierarchy') skip('the page source root is not an element on screen');
    if (name === 'android.widget.Toast') skip('toasts exist only in the page source');
    if (name.includes(':')) skip('a prefixed name test is not converted');
    if (ctx.placeholders.has(name)) ctx.warnings.add(WARN.runtimeClass);
    lv.cls = name;
  }
  for (const pred of step.preds) {
    if (pred.type === 'num' || hole(pred, ctx) || mentions(pred, 'position') || mentions(pred, 'last')) skip(REASON.sibling);
    for (const clause of predicate(pred, ctx)) addClause(lv, clause);
  }
  if (lv.cls === 'android.view.View') ctx.warnings.add(WARN.view);
  if (lv.index !== null && ctx.placeholders.has(lv.index)) ctx.warnings.add(WARN.runtimeIndex);
  return lv;
}

function addClause(lv, c) {
  if (c.kind === 'class') {
    if (lv.cls !== null && lv.cls !== c.value) skip(REASON.contradiction);
    lv.cls = c.value;
    return;
  }
  const key = c.kind === 'index' ? 'index' : `${c.kind}:${c.attr}`;
  if (!lv.order.includes(key)) lv.order.push(key);
  if (c.kind === 'bool') {
    if (lv.bool.has(c.attr) && lv.bool.get(c.attr) !== c.value) skip(REASON.contradiction);
    lv.bool.set(c.attr, c.value);
  } else if (c.kind === 'index') {
    if (lv.index !== null && lv.index !== c.value) skip(REASON.contradiction);
    lv.index = c.value;
  } else {
    if (!lv.str.has(c.attr)) lv.str.set(c.attr, []);
    lv.str.get(c.attr).push(c.cond);
  }
}

// ---------------------------------------------------------------------------
// Predicates → clauses: { kind: 'str', attr, cond } | { kind: 'bool', attr, value }
//                     | { kind: 'index', value } | { kind: 'class', value }
// ---------------------------------------------------------------------------

function predicate(e, ctx) {
  switch (e.type) {
    case 'and': return e.items.flatMap(i => predicate(i, ctx));
    case 'or': return [disjunction(e.items.map(i => predicate(i, ctx)))];
    case 'cmp': return [comparison(e, ctx)];
    case 'call': return [call(e, ctx)];
    case 'path': return existence(e, ctx);
    case 'str': return skip('a string as a predicate is always true or always false');
    default: return skip('this predicate has no UiSelector form');
  }
}

// `or` folds into one regex when every side tests the same string attribute.
function disjunction(sides) {
  if (sides.some(side => !side.length)) skip('an always-true test inside or is not converted');
  const flat = sides.flat();
  if (flat.every(c => c.kind === 'class')) skip(REASON.classRegex);
  const attr = flat[0].kind === 'str' ? flat[0].attr : null;
  if (!attr || !flat.every(c => c.kind === 'str' && c.attr === attr)) skip(REASON.orAcross);
  const items = sides.map(side => (side.length === 1 ? side[0].cond : { op: 'and', items: side.map(c => c.cond) }));
  return { kind: 'str', attr, cond: { op: 'or', items } };
}

function comparison(e, ctx) {
  let { op, left, right } = e;
  if (!attribute(left) && attribute(right)) {
    [left, right] = [right, left];
    op = { '<': '>', '>': '<', '<=': '>=', '>=': '<=', lt: 'gt', gt: 'lt', le: 'ge', ge: 'le' }[op] || op;
  }
  const ref = attribute(left);
  if (!ref) skip('a comparison without an attribute is not converted');
  if (op === '!=' || op === 'ne') {
    // @a!="" : the attribute is there and not empty (SRV-04, SRV-05, SRV-07)
    if (literal(right) === '' && STRING_ATTRS[ref.attr] && !ref.ci) return atom(ref, 'nonempty', {}, ctx);
    skip(REASON.negation);
  }
  if (op !== '=' && op !== 'eq') skip('an ordering comparison has no UiSelector form');
  return atom(ref, 'eq', value(right), ctx);
}

// The attribute side of a test: @a or lower-case(@a). Returns null when the
// node is not one; throws for forms that are attribute tests but not converted.
function attribute(e) {
  if (e.type === 'path' && e.root === null && e.steps.length === 1 && !e.steps[0].preds.length) {
    const s = e.steps[0];
    if (s.axis === 'attribute' && s.test.kind === 'name') return { attr: s.test.name, ci: false };
    if (s.test.kind === 'text') skip(REASON.textNodes);
    if (s.axis === 'self') skip('the context item is not converted');
    return null;
  }
  if (e.type === 'call') {
    if (e.name === 'lower-case' && e.args.length === 1) {
      const inner = attribute(e.args[0]);
      if (inner && !inner.ci) return { attr: inner.attr, ci: true };
    }
    if (e.name === 'upper-case') skip('upper-case() leaves the Kelvin sign as is (it is upper case already); (?i) folds it to k');
    if (e.name === 'translate') skip('translate() folds only the characters it lists; (?i) also folds Unicode ones such as the Kelvin sign');
    if (['normalize-space', 'string-length', 'substring', 'substring-before', 'substring-after', 'string', 'name', 'local-name', 'replace', 'tokenize', 'count', 'number', 'data'].includes(e.name)) {
      skip(`${e.name}() has no UiSelector form`);
    }
  }
  return null;
}

function value(e) {
  if (e.type === 'str') return { str: e.value };
  if (e.type === 'num') return { num: e.value };
  if (e.type === 'seq') {
    if (e.items.length && e.items.every(i => literal(i) !== null)) return { strs: e.items.map(literal) };
    return skip('only a sequence of string literals is converted');
  }
  if (isCall(e, 'true') && !e.args.length) return { bool: true };
  if (isCall(e, 'false') && !e.args.length) return { bool: false };
  const lit = literal(e);
  if (lit !== null) return { str: lit };
  return skip('the compared value is not a literal');
}

// A string literal, or concat() of literals (folded).
function literal(e) {
  if (e.type === 'str') return e.value;
  if (isCall(e, 'concat') && e.args.length >= 2) {
    const parts = e.args.map(literal);
    return parts.includes(null) ? null : parts.join('');
  }
  return null;
}

function atom(ref, op, val, ctx) {
  const { attr, ci } = ref;
  if (ctx.placeholders.has(attr)) skip('a runtime attribute name is not converted');
  if (BOOL_ATTRS[attr]) {
    if (ci || op !== 'eq') skip(`a string test on ${attr} is not converted`);
    if (val.bool !== undefined) return { kind: 'bool', attr, value: val.bool };
    if (val.str === 'true' || val.str === 'false') return { kind: 'bool', attr, value: val.str === 'true' };
    if (val.str !== undefined) skip('booleans are written as lower-case true/false, so the XPath matches nothing');
    return skip(`only "true" or "false" is converted for ${attr}`);
  }
  if (attr === 'index') {
    if (ci || op !== 'eq') skip('a string test on index is not converted');
    if (val.num !== undefined && Number.isInteger(val.num) && val.num >= 0) return { kind: 'index', value: val.num };
    if (val.str !== undefined && /^(?:0|[1-9]\d*)$/.test(val.str)) return { kind: 'index', value: Number(val.str) };
    if (val.str !== undefined && val.str.length === 1 && ctx.placeholders.has(val.str)) return { kind: 'index', value: val.str };
    return skip(`a string comparison with ${JSON.stringify(val.str ?? val.num)} never matches the written index`);
  }
  if (attr === 'class') {
    if (ci || op !== 'eq' || val.strs) skip(REASON.classRegex);
    if (val.str === undefined) skip('only a string is converted for class');
    if (val.str === '') skip('an empty class is never written');
    return { kind: 'class', value: val.str };
  }
  if (STRING_ATTRS[attr]) {
    if (op === 'exists' || op === 'nonempty') return { kind: 'str', attr, cond: { op } };
    if (val.num !== undefined) skip('a numeric comparison casts every text to a number: it fails on a non-numeric text and also matches "1.0" and "01"');
    if (val.bool !== undefined) skip(`a boolean comparison on ${attr} is not converted`);
    if (val.strs) return { kind: 'str', attr, cond: { op: 'or', items: val.strs.map(v => ({ op, value: v, ci })) } };
    return { kind: 'str', attr, cond: { op, value: val.str, ci } };
  }
  if (ALIASES.has(attr)) skip(`the page source has no ${attr} attribute (an alias for getAttribute only)`);
  if (WEB_IOS.test(attr)) skip(`${attr} is a web or iOS attribute: the Android page source has no ${attr}`);
  return skip(`${attr} has no UiSelector criterion`);
}

function call(e, ctx) {
  const { name, args } = e;
  if (name === 'contains' || name === 'starts-with' || name === 'ends-with') {
    if (args.length !== 2) skip(`${name}() needs two arguments`);
    const ref = attribute(args[0]);
    if (!ref) skip(`${name}() on something other than an attribute is not converted`);
    const lit = literal(args[1]);
    if (lit === null) skip(`${name}() with a value that is not a literal is not converted`);
    return atom(ref, { contains: 'contains', 'starts-with': 'starts', 'ends-with': 'ends' }[name], { str: lit }, ctx);
  }
  if (name === 'matches') {
    if (args.length < 2 || args.length > 3) skip('matches() needs two or three arguments');
    const ref = attribute(args[0]);
    if (!ref || ref.ci) skip('matches() on something other than an attribute is not converted');
    const pattern = literal(args[1]);
    const flags = args[2] ? literal(args[2]) : '';
    if (pattern === null || flags === null) skip('matches() with a pattern that is not a literal is not converted');
    if (!/^[smix]*$/.test(flags)) skip(`${JSON.stringify(flags)} has a flag that is not valid, so the XPath fails`);
    if (flags.includes('x')) skip('matches() with the x flag is not converted');
    if (!STRING_ATTRS[ref.attr]) return atom(ref, 'matches', { str: pattern }, ctx);
    return { kind: 'str', attr: ref.attr, cond: { op: 'matches', pattern, flags } };
  }
  if (name === 'not') {
    if (args.length !== 1) skip('not() needs one argument');
    const inner = predicate(args[0], ctx);
    if (inner.length === 1 && inner[0].kind === 'bool') return { ...inner[0], value: !inner[0].value };
    return skip(REASON.negation);
  }
  if (name === 'true' || name === 'false') skip('a constant predicate is not converted');
  return skip(`${name}() has no UiSelector form`);
}

function existence(e, ctx) {
  const s = e.steps.length === 1 && e.root === null ? e.steps[0] : null;
  // [self::X] tests the element's own class
  if (s && s.axis === 'self' && s.test.kind === 'name' && !s.preds.length) return [{ kind: 'class', value: s.test.name }];
  if (s && s.axis === 'attribute' && s.test.kind === 'name' && !s.preds.length) {
    const attr = s.test.name;
    // written on every element: always true, dropped (SRV-05, SRV-09, SRV-10)
    if (ALWAYS.has(attr)) return [];
    // written when non-null: a non-null test (SRV-04, SRV-07, SRV-08)
    if (STRING_ATTRS[attr]) return [atom({ attr, ci: false }, 'exists', {}, ctx)];
    if (ctx.placeholders.has(attr)) skip('a runtime attribute name is not converted');
    skip('an attribute existence test is not converted');
  }
  if (s && s.test.kind === 'text') skip(REASON.textNodes);
  return skip(REASON.descendantFilter);
}

// ---------------------------------------------------------------------------
// Unions: same-step unions that differ in one string attribute fold into one
// regex (X01); anything else has no UiSelector form (XP-09, SRV-21).
// ---------------------------------------------------------------------------

function union(queries) {
  if (queries.some(q => q.instance !== null)) skip('a union of positions has no UiSelector form');
  if (queries.some(q => q.levels.length > 1)) skip('a union of nested paths has no UiSelector form');
  const levels = queries.map(q => q.levels[0]);
  const sig = (lv, without) => JSON.stringify({
    cls: lv.cls, index: lv.index, bool: [...lv.bool].sort(),
    str: [...lv.str].filter(([a]) => a !== without).sort(),
  });
  if (new Set(levels.map(lv => sig(lv))).size === 1) return { levels: [levels[0]], instance: null };
  if (new Set(levels.map(lv => lv.cls)).size > 1) {
    const rest = levels.map(lv => sig({ ...lv, cls: null }));
    if (new Set(rest).size === 1) skip(REASON.classRegex);
  }
  const attrs = new Set(levels.flatMap(lv => [...lv.str.keys()]));
  for (const attr of attrs) {
    if (levels.every(lv => lv.str.has(attr)) && new Set(levels.map(lv => sig(lv, attr))).size === 1) {
      const items = levels.map(lv => {
        const conds = lv.str.get(attr);
        return conds.length === 1 ? conds[0] : { op: 'and', items: conds };
      });
      const merged = { ...levels[0], str: new Map(levels[0].str) };
      merged.str.set(attr, [{ op: 'or', items }]);
      return { levels: [merged], instance: null };
    }
  }
  return skip('a union of different attributes has no UiSelector form');
}

// ---------------------------------------------------------------------------
// Emitting
// ---------------------------------------------------------------------------

function emit(q, ctx) {
  let out = null;
  for (let i = q.levels.length - 1; i >= 0; i--) {
    let s = `new UiSelector()${calls(q.levels[i], ctx)}`;
    // over a nested path: instance(0) on the outer selector keeps findElements at one element (SRV-35)
    if (q.instance !== null && i === q.levels.length - 1) s += `.instance(${q.instance})`;
    else if (q.instance !== null && i === 0) s += '.instance(0)';
    if (out) s += `.childSelector(${out})`;
    out = s;
  }
  return out;
}

function calls(lv, ctx) {
  let s = lv.cls !== null ? `.className(${plainLiteral(lv.cls, 'class')})` : '';
  for (const key of lv.order) {
    const [kind, attr] = key.split(':');
    if (key === 'index') s += `.index(${lv.index})`;
    else if (kind === 'bool') s += `.${BOOL_ATTRS[attr]}(${lv.bool.get(attr)})`;
    else s += stringCriterion(attr, lv.str.get(attr), ctx);
  }
  return s;
}

function plainLiteral(v, what) {
  if (NON_XML.test(v)) skip('characters that are not valid XML are replaced in the page source');
  if (/["\\]/.test(v)) skip(`a ${what} with " or \\ is not converted`);
  return `"${v}"`;
}

function stringCriterion(attr, conds, ctx) {
  const [plain, regex] = STRING_ATTRS[attr];
  // An existence test next to another test is implied by it: a UiSelector criterion needs a non-null value.
  let list = conds.some(c => c.op !== 'exists') ? conds.filter(c => c.op !== 'exists') : conds.slice(0, 1);
  if (list.length > 1 && list.some(c => c.op === 'nonempty') && list.some(c => c.op !== 'nonempty')) {
    const rest = list.filter(c => c.op !== 'nonempty');
    // @a!="" next to tests that never hold for "" is implied by them
    if (rest.every(c => evaluateSafe(c, '') === false)) list = rest;
  }
  const tree = list.length === 1 ? list[0] : { op: 'and', items: list };
  const leaves = leavesOf(tree);
  if (tree.op !== 'exists' && leaves.some(l => l.op === 'exists')) skip('an existence test inside or is not converted');

  for (const l of leaves) {
    const v = l.op === 'matches' ? l.pattern : l.value;
    if (v !== undefined && NON_XML.test(v)) skip('characters that are not valid XML are replaced in the page source');
  }
  const ci = leaves.filter(l => l.ci).length;
  if (ci && ci !== leaves.length) skip('lower-case() mixed with case-sensitive tests on one attribute is not converted');
  if (ci) {
    if (leaves.some(l => l.value === undefined || l.value !== l.value.toLowerCase())) skip('lower-case() never equals a value with upper-case letters, so the XPath matches nothing');
    ctx.warnings.add(WARN.lowerCase);
  }
  if (attr === 'text' && leaves.some(l => l.op === 'eq' && FLOAT_TEXT.test(l.value))) {
    skip('a float-shaped text may be a range widget\'s value, which only the page source has');
  }
  if (leaves.some(l => l.op === 'matches') && leaves.length > 1) skip('matches() combined with other tests on one attribute is not converted');

  // Conditions that contradict an equality in the same conjunction.
  const top = tree.op === 'and' ? tree.items : [tree];
  const eqs = [...new Set(top.filter(c => c.op === 'eq').map(c => c.value))];
  if (eqs.length > 1) skip(REASON.contradiction);
  if (eqs.length === 1 && top.some(c => evaluate(c, eqs[0], false, ctx) === false)) skip(REASON.contradiction);

  // XPath reads null text as "" (SRV-05) and a missing attribute as "" in its
  // string functions (XP-02); a UiSelector never matches a null value.
  if (attr === 'text') {
    if (evaluate(tree, '', false, ctx)) {
      if (tree.op === 'eq' && tree.value === '') skip('every element without text has text="" in the page source; text("") needs a non-null text');
      if (tree.op === 'contains' && tree.value === '') skip('contains() with "" is true for every element');
      if (tree.op === 'matches') skip('the pattern matches "", which XPath also matches on elements without the attribute');
      skip('the test holds for "", which every element without text has in the page source');
    }
  } else {
    if (tree.op === 'eq' && tree.value === '' && attr !== 'content-desc') {
      skip(attr === 'resource-id' ? 'an empty resource-id is never written, so the XPath matches nothing' : `an empty ${attr} is never written`);
    }
    if (evaluate(tree, '', true, ctx)) {
      if (tree.op === 'matches') skip('the pattern matches "", which XPath also matches on elements without the attribute');
      skip(`the test holds for "", which XPath also gives elements without ${attr}`);
    }
  }

  // a test that some range widget value passes (contains "1.5", starts-with "20", [@text!=""]): the XPath also
  // finds that widget, the UiSelector does not (SRV-06)
  if (attr === 'text' && floatProbes(leaves).some(f => evaluate(tree, f, false, ctx) === true)) {
    ctx.warnings.add(WARN.range);
  }

  if (tree.op === 'eq' && !tree.ci && !/["\\]/.test(tree.value)) {
    if (hasPlaceholder(tree.value, ctx)) ctx.warnings.add(WARN.runtimePlain);
    return `.${plain}("${tree.value}")`;
  }
  return `.${regex}("${buildRegex(tree, ci > 0, ctx, attr)}")`;
}

function leavesOf(t) {
  return t.op === 'or' || t.op === 'and' ? t.items.flatMap(leavesOf) : [t];
}

const hasPlaceholder = (v, ctx) => [...v].some(ch => ctx.placeholders.has(ch));

// evaluate() for a simple test, null when it cannot tell (a matches() pattern).
const evaluateSafe = (t, s) => (t.op === 'matches' || t.op === 'or' || t.op === 'and' ? null : evaluate(t, s, false, { placeholders: new Set() }));

// true / false, or null when unknown. `absent`: the attribute is missing, so
// equality is false and the string functions see "" (XP-02, XP-06).
function evaluate(t, s, absent, ctx) {
  const fold = v => (t.ci ? v.toLowerCase() : v);
  switch (t.op) {
    case 'eq': return absent ? false : fold(s) === t.value;
    case 'exists': return !absent;
    case 'nonempty': return !absent && s !== '';
    case 'contains': return fold(s).includes(t.value);
    case 'starts': return fold(s).startsWith(t.value);
    case 'ends': return fold(s).endsWith(t.value);
    case 'matches': {
      if (s !== '') return null;
      if (hasPlaceholder(t.pattern, ctx)) skip('a runtime value inside a matches() pattern is not converted');
      try {
        return matchesEmpty(javaPattern(t.pattern));
      } catch (e) {
        if (e instanceof RegexError) skip(`the matches() pattern is not understood: ${e.message}`);
        throw e;
      }
    }
    case 'or': {
      const r = t.items.map(i => evaluate(i, s, absent, ctx));
      return r.includes(true) ? true : r.includes(null) ? null : false;
    }
    case 'and': {
      const r = t.items.map(i => evaluate(i, s, absent, ctx));
      return r.includes(false) ? false : r.includes(null) ? null : true;
    }
    default: throw new Error(`unknown condition ${t.op}`);
  }
}

// PsychoPath rewrites -[ to &&[^ (XP-03); `"` becomes \x22 (SRV-23).
function javaPattern(p) {
  if (p.includes('\\Q')) skip('a matches() pattern with \\Q is not converted');
  const src = p.replace(/-\[/g, '&&[^');
  let out = '';
  for (let i = 0; i < src.length; i++) {
    if (src[i] === '\\' && i + 1 < src.length) {
      out += src[i + 1] === '"' ? '\\x22' : src[i] + src[i + 1];
      i++;
    } else out += src[i] === '"' ? '\\x22' : src[i];
  }
  return out;
}

function buildRegex(tree, ci, ctx, attr) {
  if (tree.op === 'matches') {
    // find() anywhere, with PsychoPath's UNIX_LINES and flags (XP-03, XP-04). textMatches and
    // descriptionMatches compile with DOTALL (SEL-03): without the s flag the pattern turns it off.
    const flags = tree.flags.includes('s') ? tree.flags : `${tree.flags}-s`;
    return `(?d)(?s:.*)(?${flags}:${javaPattern(tree.pattern)})(?s:.*)`;
  }
  const st = { dotAll: false, runtime: false, ctx, attr };
  const body = alternatives(tree, st);
  if (st.runtime) ctx.warnings.add(WARN.runtimeRegex);
  return `${st.dotAll ? '(?s)' : ''}${ci ? '(?i)' : ''}${body}`;
}

function alternatives(t, st) {
  return t.op === 'or' ? t.items.map(i => conjunction(i, st)).join('|') : conjunction(t, st);
}

// One whole-string alternative. In a conjunction the equality is the body and
// every other test a lookahead (D05, D06); without an equality the body is .*.
function conjunction(t, st) {
  if (t.op !== 'and') return simple(t, st);
  const items = flatAnd(t);
  const main = items.find(i => i.op === 'eq');
  const looks = items.filter(i => i !== main && !(i.op === 'eq' && i.value === main.value)).map(i => lookahead(i, st)).join('');
  return looks + (main ? escape(main.value, st) : any(st));
}

const flatAnd = t => (t.op === 'and' ? t.items.flatMap(flatAnd) : [t]);
const any = st => { st.dotAll = true; return '.*'; };

function simple(t, st) {
  switch (t.op) {
    case 'eq': return escape(t.value, st);
    case 'contains': return `${any(st)}${escape(t.value, st)}.*`;
    case 'starts': return `${escape(t.value, st)}${any(st)}`;
    case 'ends': return `${any(st)}${escape(t.value, st)}`;
    // a resource-id is never written empty (SRV-07); a content-desc or package can be ""
    case 'exists': return st.attr === 'resource-id' ? (any(st), '.+') : any(st);
    case 'nonempty': return (any(st), '.+');
    case 'or': return `(?:${alternatives(t, st)})`;
    default: throw new Error(`unexpected condition ${t.op}`);
  }
}

function lookahead(t, st) {
  switch (t.op) {
    case 'contains': return `(?=${any(st)}${escape(t.value, st)})`;
    case 'starts': return `(?=${escape(t.value, st)})`;
    case 'ends': return `(?=${any(st)}${escape(t.value, st)}\\z)`;
    case 'eq': return `(?=${escape(t.value, st)}\\z)`;
    case 'nonempty': return (any(st), '(?=.)');
    case 'or': return `(?=(?:${alternatives(t, st)})\\z)`;
    case 'and': return flatAnd(t).map(i => lookahead(i, st)).join('');
    default: throw new Error(`unexpected condition ${t.op}`);
  }
}

// Every regex metacharacter escaped; `"` and `\` as \x22 / \x5c (SRV-23);
// a runtime value quoted with \Q…\E.
function escape(v, st) {
  let out = '';
  for (const ch of v) {
    if (st.ctx.placeholders.has(ch)) { out += `\\Q${ch}\\E`; st.runtime = true; }
    else if (ch === '"') out += '\\x22';
    else if (ch === '\\') out += '\\x5c';
    else if ('^$.|?*+()[]{}'.includes(ch)) out += `\\${ch}`;
    else out += ch;
  }
  return out;
}

module.exports = { convertXpathToUiSelector };
