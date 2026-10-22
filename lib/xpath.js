// XPath parser: the part of XPath 2.0 that real Android locators use
// (PLAN.md section 3), turned into an AST the converter walks.
//
// The grammar is a whitelist. Syntax that is valid XPath 2.0 but outside it
// (variables, `some`/`every`/`if`/`for`, arithmetic, `instance of`, …) throws
// XPathError with kind 'unsupported'; text that is not XPath at all throws with
// kind 'invalid'. Either way the converter skips the locator with the message.
//
// AST nodes:
//   { type: 'path', root: null | '/' | '//', steps: [step] }
//     step = { sep: null | '/' | '//', axis, test, preds: [expr] }
//     test = { kind: 'name', name } | { kind: 'any' } | { kind: 'node' } | { kind: 'text' }
//   { type: 'filter', expr, preds }       (expr)[n]
//   { type: 'union', items }
//   { type: 'or' | 'and', items }
//   { type: 'cmp', op, left, right }      op: = != < <= > >= eq ne lt le gt ge
//   { type: 'str', value }  { type: 'num', value, raw }  { type: 'seq', items }
//   { type: 'call', name, args }

class XPathError extends Error {
  constructor(kind, message) {
    super(message);
    this.kind = kind; // 'invalid' | 'unsupported'
  }
}

const invalid = msg => new XPathError('invalid', msg);
const unsupported = msg => new XPathError('unsupported', msg);

const AXES = new Set([
  'child', 'descendant', 'descendant-or-self', 'self', 'parent', 'ancestor', 'ancestor-or-self',
  'following', 'following-sibling', 'preceding', 'preceding-sibling', 'attribute', 'namespace',
]);
const KIND_TESTS = new Set(['node', 'text', 'comment', 'processing-instruction', 'element', 'attribute', 'document-node', 'schema-element', 'schema-attribute']);
const COMP_WORDS = new Set(['eq', 'ne', 'lt', 'le', 'gt', 'ge']);
// Operators and keywords of XPath 2.0 that the whitelist leaves out.
const UNSUPPORTED_WORDS = new Set(['div', 'mod', 'idiv', 'to', 'intersect', 'except', 'instance', 'treat', 'castable', 'cast', 'is', 'some', 'every', 'if', 'for', 'return', 'satisfies', 'in', 'then', 'else']);

// Name characters: XML NCName plus `.` and `-`. Private-use characters are left
// out on purpose: the scanner uses them as placeholders for runtime values; one
// standing alone becomes a name token of its own (see tokenize).
const NAME_START = /[A-Za-z_À-ÖØ-öø-˿Ͱ-ͽͿ-῿‌‍⁰-↏Ⰰ-⿯、-퟿豈-﷏ﷰ-�]/;
const NAME_CHAR = /[-.\w·À-ÖØ-öø-ͽͿ-῿‌‍‿⁀⁰-↏Ⰰ-⿯、-퟿豈-﷏ﷰ-�]/;

function tokenize(src) {
  const tokens = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) { i++; continue; }
    const at = i;
    if (c === '"' || c === "'") {
      // XPath 2.0: a quote is escaped by doubling it.
      let value = '';
      let j = i + 1;
      for (;;) {
        if (j >= src.length) throw invalid(`string literal at ${at} is never closed`);
        if (src[j] === c) {
          if (src[j + 1] === c) { value += c; j += 2; continue; }
          break;
        }
        value += src[j++];
      }
      tokens.push({ t: 'str', v: value, at });
      i = j + 1;
      continue;
    }
    const num = /^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/.exec(src.slice(i));
    if (num) {
      tokens.push({ t: 'num', v: Number(num[0]), raw: num[0], at });
      i += num[0].length;
      continue;
    }
    const two = src.slice(i, i + 2);
    if (['//', '::', '..', '!=', '<=', '>=', '(:'].includes(two)) {
      if (two === '(:') throw unsupported('XPath comments are not converted');
      tokens.push({ t: two, at });
      i += 2;
      continue;
    }
    if (c === '$' && i > 0 && NAME_CHAR.test(src[i - 1])) throw invalid('the XPath parser rejects $ in a name test');
    if ('/()[]@,|=<>*.+-$?'.includes(c)) {
      tokens.push({ t: c, at });
      i++;
      continue;
    }
    if (NAME_START.test(c)) {
      let j = i + 1;
      while (j < src.length && NAME_CHAR.test(src[j])) j++;
      // QName prefix (fn:contains), but not an axis separator (child::x).
      if (src[j] === ':' && src[j + 1] !== ':' && NAME_START.test(src[j + 1] || '')) {
        j++;
        while (j < src.length && NAME_CHAR.test(src[j])) j++;
      }
      tokens.push({ t: 'name', v: src.slice(i, j), at });
      i = j;
      continue;
    }
    if (c >= '\uE000' && c <= '\uF8FF') {
      // One runtime value standing alone as a name (`//${cls}`, `[${i}]`, `@${attr}`): a name token the
      // converter recognizes by its placeholder. Glued to other name characters it stays unsupported.
      if (i > 0 && NAME_CHAR.test(src[i - 1])) throw unsupported('a runtime value outside a string literal');
      if (i + 1 < src.length && (NAME_CHAR.test(src[i + 1]) || (src[i + 1] >= '\uE000' && src[i + 1] <= '\uF8FF'))) throw unsupported('a runtime value outside a string literal');
      tokens.push({ t: 'name', v: c, at, hole: true });
      i++;
      continue;
    }
    throw invalid(`unexpected character ${JSON.stringify(c)} at ${i}`);
  }
  tokens.push({ t: 'end', at: src.length });
  return tokens;
}

function parseXPath(src) {
  const tokens = tokenize(src);
  let p = 0;
  const peek = (k = 0) => tokens[p + k];
  const next = () => tokens[p++];
  const is = (t, v) => peek().t === t && (v === undefined || peek().v === v);
  const expect = (t, what) => {
    if (!is(t)) {
      const e = errorAt(peek());
      throw e.kind === 'unsupported' ? e : invalid(`expected ${what || t} at ${peek().at}`);
    }
    return next();
  };
  const word = () => (is('name') ? peek().v : null);

  function parseExpr() {
    const items = [parseAnd()];
    while (word() === 'or') { next(); items.push(parseAnd()); }
    return items.length === 1 ? items[0] : { type: 'or', items };
  }

  function parseAnd() {
    const items = [parseComparison()];
    while (word() === 'and') { next(); items.push(parseComparison()); }
    return items.length === 1 ? items[0] : { type: 'and', items };
  }

  function parseComparison() {
    const left = parseUnion();
    let op = null;
    if (['=', '!=', '<', '<=', '>', '>='].includes(peek().t)) op = next().t;
    else if (COMP_WORDS.has(word())) op = next().v;
    if (!op) return left;
    const right = parseUnion();
    if (['=', '!=', '<', '<=', '>', '>='].includes(peek().t) || COMP_WORDS.has(word())) {
      throw invalid('comparisons cannot be chained');
    }
    return { type: 'cmp', op, left, right };
  }

  function parseUnion() {
    const items = [parsePath()];
    while (is('|') || word() === 'union') { next(); items.push(parsePath()); }
    return items.length === 1 ? items[0] : { type: 'union', items };
  }

  function parsePath() {
    if (is('/') || is('//')) {
      const root = next().t;
      // A lone `/` is the document node.
      if (root === '/' && !startsStep()) return { type: 'path', root, steps: [] };
      return { type: 'path', root, steps: parseRelative(null) };
    }
    if (startsPrimary()) {
      const primary = parseFilter();
      if (is('/') || is('//')) throw unsupported('a path that continues after a filter expression');
      return primary;
    }
    if (startsStep()) return { type: 'path', root: null, steps: parseRelative(null) };
    throw errorAt(peek());
  }

  function errorAt(tok) {
    if (tok.t === 'end') return invalid('unexpected end of the XPath');
    if (tok.t === '$') return unsupported('variables are not converted');
    if (['+', '-', '?'].includes(tok.t) || (tok.t === 'name' && UNSUPPORTED_WORDS.has(tok.v))) {
      return unsupported(`unsupported syntax: ${tok.t === 'name' ? tok.v : tok.t}`);
    }
    return invalid(`unexpected ${tok.t === 'name' ? tok.v : tok.t} at ${tok.at}`);
  }

  function startsStep() {
    const t = peek();
    return t.t === 'name' || t.t === '*' || t.t === '@' || t.t === '.' || t.t === '..';
  }

  function startsPrimary() {
    const t = peek();
    if (t.t === 'str' || t.t === 'num' || t.t === '(' || t.t === '$') return true;
    if (t.t !== 'name') return false;
    if (['some', 'every'].includes(t.v) && peek(1).t === '$') throw unsupported('quantified expressions are not converted');
    if (t.v === 'for' && peek(1).t === '$') throw unsupported('for expressions are not converted');
    if (t.v === 'if' && peek(1).t === '(') throw unsupported('conditional expressions are not converted');
    // A function call: a name followed by `(` that is not a kind test.
    return peek(1).t === '(' && !KIND_TESTS.has(t.v);
  }

  function parseFilter() {
    let expr = parsePrimary();
    const preds = parsePredicates();
    if (preds.length) expr = { type: 'filter', expr, preds };
    return expr;
  }

  function parsePrimary() {
    const t = next();
    if (t.t === 'str') return { type: 'str', value: t.v };
    if (t.t === 'num') return { type: 'num', value: t.v, raw: t.raw };
    if (t.t === '$') throw unsupported('variables are not converted');
    if (t.t === '(') {
      if (is(')')) { next(); return { type: 'seq', items: [] }; }
      const items = [parseExpr()];
      while (is(',')) { next(); items.push(parseExpr()); }
      expect(')', 'a closing )');
      return items.length === 1 ? { ...items[0], paren: true } : { type: 'seq', items };
    }
    // function call
    const name = t.v.replace(/^fn:/, '');
    expect('(');
    const args = [];
    if (!is(')')) {
      args.push(parseExpr());
      while (is(',')) { next(); args.push(parseExpr()); }
    }
    expect(')', `a closing ) for ${name}()`);
    return { type: 'call', name, args };
  }

  function parsePredicates() {
    const preds = [];
    while (is('[')) {
      next();
      if (is(']')) throw invalid('empty predicate');
      preds.push(parseExpr());
      expect(']', 'a closing ]');
    }
    return preds;
  }

  function parseRelative(firstSep) {
    const steps = [parseStep(firstSep)];
    while (is('/') || is('//')) {
      const sep = next().t;
      steps.push(parseStep(sep));
    }
    return steps;
  }

  function parseStep(sep) {
    if (is('..')) { next(); return { sep, axis: 'parent', test: { kind: 'node' }, preds: parsePredicates() }; }
    if (is('.')) { next(); return { sep, axis: 'self', test: { kind: 'node' }, preds: parsePredicates() }; }
    let axis = 'child';
    if (is('@')) {
      next();
      axis = 'attribute';
    } else if (is('name') && peek(1).t === '::') {
      axis = next().v;
      if (!AXES.has(axis)) throw invalid(`unknown axis ${axis}`);
      next();
    }
    const test = parseNodeTest();
    return { sep, axis, test, preds: parsePredicates() };
  }

  function parseNodeTest() {
    if (is('*')) { next(); return { kind: 'any' }; }
    const t = expect('name', 'a name test');
    if (peek().t === '(' && KIND_TESTS.has(t.v)) {
      next();
      expect(')', `a closing ) for ${t.v}()`);
      if (t.v === 'node') return { kind: 'node' };
      if (t.v === 'text') return { kind: 'text' };
      throw unsupported(`${t.v}() tests are not converted`);
    }
    return { kind: 'name', name: t.v };
  }

  const ast = parseExpr();
  if (!is('end')) throw errorAt(peek());
  return ast;
}

module.exports = { parseXPath, XPathError };
