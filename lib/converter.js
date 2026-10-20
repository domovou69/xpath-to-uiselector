// XPath → UiSelector (PLAN.md section 3, reference/, audit/spec/cases.js).
//
// The XPath is parsed into an AST (lib/xpath.js) and read into a query: one
// level per descendant step, each level a class name plus criteria per
// attribute. A level becomes one `new UiSelector()`; a second level is a
// childSelector (close, Decision 3). Everything the rules do not cover throws
// Skip with the reason, and the locator is left as it is.
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

const REASON = {
  classRegex: 'classNameMatches makes findElements iterate index(i) instead of instance(i) (Decision 3)',
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
};

// Not valid in XML 1.0: replaced in the page source (SRV-14).
const NON_XML = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
// Float.toString shapes: the page source text of a range widget (SRV-06).
const FLOAT_TEXT = /^-?(?:\d+\.\d+(?:E-?\d+)?|NaN|Infinity)$/;

function convertXpathToUiSelector(xpath, opts = {}) {
  const ctx = { placeholders: opts.placeholders || new Set(), warnings: new Set() };
  try {
    const ast = parseXPath(xpath);
    const locator = emit(query(ast, ctx), ctx);
    const parsed = parseUiSelector(locator);
    if (!parsed.ok) return { locator: xpath, status: STATUS.SKIPPED_VALIDATION_FAILED, reason: `the UiSelector would not parse: ${parsed.error}` };
    const warning = [...ctx.warnings].join('; ');
    return { locator, status: STATUS.SUCCESS, ...(warning ? { warning } : {}) };
  } catch (e) {
    if (e instanceof Skip) return { locator: xpath, status: e.status, reason: e.message };
    if (e instanceof XPathError) {
      return { locator: xpath, status: STATUS.SKIPPED_UNSUPPORTED_LOGIC, reason: e.kind === 'invalid' ? `not a valid XPath: ${e.message}` : e.message };
    }
    throw e;
  }
}

// ---------------------------------------------------------------------------
// Query: { levels: [level], instance: n | null }
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

// (expr)[n] and (expr)[position()=n] → instance(n-1) (XP-08, SEL-10)
function positioned(ast, ctx) {
  if (ast.expr.type !== 'path' && ast.expr.type !== 'union' && ast.expr.type !== 'filter') skip('not a location path');
  const inner = query(ast.expr, ctx);
  if (ast.preds.length !== 1) skip('more than one predicate on a grouped path is not converted');
  if (inner.instance !== null) skip('a position of a position is not converted');
  if (inner.levels.length > 1) skip('a position over a nested path has no UiSelector form');
  const n = position(ast.preds[0]);
  return { ...inner, instance: n - 1 };
}

function position(pred) {
  if (pred.type === 'num') return positionNumber(pred);
  if (mentions(pred, 'last')) skip('last() has no UiSelector form');
  if (pred.type === 'cmp' && (pred.op === '=' || pred.op === 'eq')) {
    const [a, b] = isCall(pred.left, 'position') ? [pred.left, pred.right] : [pred.right, pred.left];
    if (isCall(a, 'position') && b.type === 'num') return positionNumber(b);
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
    lv.cls = name;
  }
  for (const pred of step.preds) {
    if (pred.type === 'num' || mentions(pred, 'position') || mentions(pred, 'last')) skip(REASON.sibling);
    for (const clause of predicate(pred)) addClause(lv, clause);
  }
  if (lv.cls === 'android.view.View') ctx.warnings.add(WARN.view);
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

function predicate(e) {
  switch (e.type) {
    case 'and': return e.items.flatMap(predicate);
    case 'or': return [disjunction(e.items.map(predicate))];
    case 'cmp': return [comparison(e)];
    case 'call': return [call(e)];
    case 'path': return existence(e);
    case 'str': return skip('a string as a predicate is always true or always false');
    default: return skip('this predicate has no UiSelector form');
  }
}

// `or` folds into one regex when every side tests the same string attribute.
function disjunction(sides) {
  const flat = sides.flat();
  if (flat.every(c => c.kind === 'class')) skip(REASON.classRegex);
  const attr = flat[0].kind === 'str' ? flat[0].attr : null;
  if (!attr || !flat.every(c => c.kind === 'str' && c.attr === attr)) skip(REASON.orAcross);
  const items = sides.map(side => (side.length === 1 ? side[0].cond : { op: 'and', items: side.map(c => c.cond) }));
  return { kind: 'str', attr, cond: { op: 'or', items } };
}

function comparison(e) {
  let { op, left, right } = e;
  if (!attribute(left) && attribute(right)) {
    [left, right] = [right, left];
    op = { '<': '>', '>': '<', '<=': '>=', '>=': '<=', lt: 'gt', gt: 'lt', le: 'ge', ge: 'le' }[op] || op;
  }
  const ref = attribute(left);
  if (!ref) skip('a comparison without an attribute is not converted');
  if (op === '!=' || op === 'ne') skip(REASON.negation);
  if (op !== '=' && op !== 'eq') skip('an ordering comparison has no UiSelector form');
  return atom(ref, 'eq', value(right));
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
    if (e.name === 'upper-case') skip('upper-case() leaves the Kelvin sign as is (it is upper case already); (?i) folds it to k (Decision 3)');
    if (e.name === 'translate') skip('translate() folds only the characters it lists; (?i) also folds Unicode ones such as the Kelvin sign (Decision 3)');
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

function atom(ref, op, val) {
  const { attr, ci } = ref;
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
    return skip(`a string comparison with ${JSON.stringify(val.str ?? val.num)} never matches the written index`);
  }
  if (attr === 'class') {
    if (ci || op !== 'eq' || val.strs) skip(REASON.classRegex);
    if (val.str === undefined) skip('only a string is converted for class');
    if (val.str === '') skip('an empty class is never written');
    return { kind: 'class', value: val.str };
  }
  if (STRING_ATTRS[attr]) {
    if (val.num !== undefined) skip('a numeric comparison casts every text to a number: it fails on a non-numeric text and also matches "1.0" and "01"');
    if (val.bool !== undefined) skip(`a boolean comparison on ${attr} is not converted`);
    if (val.strs) return { kind: 'str', attr, cond: { op: 'or', items: val.strs.map(v => ({ op, value: v, ci })) } };
    return { kind: 'str', attr, cond: { op, value: val.str, ci } };
  }
  if (ALIASES.has(attr)) skip(`the page source has no ${attr} attribute (an alias for getAttribute only)`);
  return skip(`${attr} has no UiSelector criterion`);
}

function call(e) {
  const { name, args } = e;
  if (name === 'contains' || name === 'starts-with' || name === 'ends-with') {
    if (args.length !== 2) skip(`${name}() needs two arguments`);
    const ref = attribute(args[0]);
    if (!ref) skip(`${name}() on something other than an attribute is not converted`);
    const lit = literal(args[1]);
    if (lit === null) skip(`${name}() with a value that is not a literal is not converted`);
    return atom(ref, { contains: 'contains', 'starts-with': 'starts', 'ends-with': 'ends' }[name], { str: lit });
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
    if (!STRING_ATTRS[ref.attr]) return atom(ref, 'matches', { str: pattern });
    return { kind: 'str', attr: ref.attr, cond: { op: 'matches', pattern, flags } };
  }
  if (name === 'not') {
    if (args.length !== 1) skip('not() needs one argument');
    const inner = predicate(args[0]);
    if (inner.length === 1 && inner[0].kind === 'bool') return { ...inner[0], value: !inner[0].value };
    return skip(REASON.negation);
  }
  if (name === 'true' || name === 'false') skip('a constant predicate is not converted');
  return skip(`${name}() has no UiSelector form`);
}

function existence(e) {
  const s = e.steps.length === 1 && e.root === null ? e.steps[0] : null;
  // [self::X] tests the element's own class
  if (s && s.axis === 'self' && s.test.kind === 'name' && !s.preds.length) return [{ kind: 'class', value: s.test.name }];
  if (s && s.axis === 'attribute' && s.test.kind === 'name') {
    if (BOOL_ATTRS[s.test.name]) skip(`${s.test.name} is written on every element, so the test is always true`);
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
    if (i === 0 && q.instance !== null) s += `.instance(${q.instance})`;
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
  const tree = conds.length === 1 ? conds[0] : { op: 'and', items: conds };
  const leaves = leavesOf(tree);

  for (const l of leaves) {
    const v = l.op === 'matches' ? l.pattern : l.value;
    if (NON_XML.test(v)) skip('characters that are not valid XML are replaced in the page source');
  }
  const ci = leaves.filter(l => l.ci).length;
  if (ci && ci !== leaves.length) skip('lower-case() mixed with case-sensitive tests on one attribute is not converted');
  if (ci) {
    if (leaves.some(l => l.value !== l.value.toLowerCase())) skip('lower-case() never equals a value with upper-case letters, so the XPath matches nothing');
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

  if (tree.op === 'eq' && !tree.ci && !/["\\]/.test(tree.value)) {
    if (hasPlaceholder(tree.value, ctx)) ctx.warnings.add(WARN.runtimePlain);
    return `.${plain}("${tree.value}")`;
  }
  return `.${regex}("${buildRegex(tree, ci > 0, ctx)}")`;
}

function leavesOf(t) {
  return t.op === 'or' || t.op === 'and' ? t.items.flatMap(leavesOf) : [t];
}

const hasPlaceholder = (v, ctx) => [...v].some(ch => ctx.placeholders.has(ch));

// true / false, or null when unknown. `absent`: the attribute is missing, so
// equality is false and the string functions see "" (XP-02, XP-06).
function evaluate(t, s, absent, ctx) {
  const fold = v => (t.ci ? v.toLowerCase() : v);
  switch (t.op) {
    case 'eq': return absent ? false : fold(s) === t.value;
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

function buildRegex(tree, ci, ctx) {
  if (tree.op === 'matches') {
    // find() anywhere, with PsychoPath's UNIX_LINES and flags (XP-03, XP-04).
    return `(?d)(?s:.*)(?${tree.flags}:${javaPattern(tree.pattern)})(?s:.*)`;
  }
  const st = { dotAll: false, runtime: false, ctx };
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
