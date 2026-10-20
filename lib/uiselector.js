// Parses one `-android uiautomator` statement the way UiAutomator2 server
// 10.6.6 does (reference/uia2-server.md SRV-20..SRV-24), limited to the
// UiSelector methods this tool emits or accepts.
//
// String literals follow the server's rules, not Java's: a `"` preceded by a
// backslash does not end the literal, and the only unescaping is `\"` → `"`.
// A backslash is otherwise kept as written, so `text("a\\")` holds two
// backslashes and `text("a\")` is never closed.

// argument kind per method: s = string, b = boolean, i = int, u = UiSelector
const METHODS = Object.freeze({
  text: 's', textContains: 's', textStartsWith: 's', textMatches: 's',
  description: 's', descriptionContains: 's', descriptionStartsWith: 's', descriptionMatches: 's',
  className: 's', classNameMatches: 's',
  resourceId: 's', resourceIdMatches: 's',
  packageName: 's', packageNameMatches: 's',
  checkable: 'b', checked: 'b', clickable: 'b', enabled: 'b', focusable: 'b',
  focused: 'b', longClickable: 'b', scrollable: 'b', selected: 'b',
  index: 'i', instance: 'i',
  childSelector: 'u', fromParent: 'u',
});

const CTOR = 'new UiSelector()';

class ParseError extends Error {}

// Returns { ok: true, selector } or { ok: false, error }.
// selector = { calls: [{ name, value }] }; a `u` value is a nested selector.
function parseUiSelector(str) {
  try {
    const p = { s: str, i: 0 };
    const selector = parseSelector(p);
    if (p.i !== str.length) throw new ParseError(`unexpected text at ${p.i}: ${str.slice(p.i, p.i + 20)}`);
    return { ok: true, selector };
  } catch (e) {
    if (e instanceof ParseError) return { ok: false, error: e.message };
    throw e;
  }
}

function parseSelector(p) {
  if (!p.s.startsWith(CTOR, p.i)) throw new ParseError(`expected ${CTOR} at ${p.i}`);
  p.i += CTOR.length;
  const calls = [];
  while (p.s[p.i] === '.') {
    p.i++;
    const m = /^[A-Za-z]+/.exec(p.s.slice(p.i));
    if (!m) throw new ParseError(`expected a method name at ${p.i}`);
    const name = m[0];
    const kind = METHODS[name];
    if (!kind) throw new ParseError(`unknown method ${name}`);
    p.i += name.length;
    if (p.s[p.i] !== '(') throw new ParseError(`expected ( after ${name}`);
    p.i++;
    const value = parseArgument(p, kind, name);
    if (p.s[p.i] !== ')') throw new ParseError(`expected ) to close ${name} at ${p.i}`);
    p.i++;
    calls.push({ name, value });
  }
  return { calls };
}

function parseArgument(p, kind, name) {
  if (kind === 'u') return parseSelector(p);
  if (kind === 's') {
    if (p.s[p.i] !== '"') throw new ParseError(`${name} needs a string literal`);
    let j = p.i + 1;
    while (j < p.s.length && !(p.s[j] === '"' && p.s[j - 1] !== '\\')) j++;
    if (j >= p.s.length) throw new ParseError(`string literal of ${name} is never closed`);
    const value = p.s.slice(p.i + 1, j).replace(/\\"/g, '"');
    p.i = j + 1;
    return value;
  }
  const m = (kind === 'b' ? /^(?:true|false)/ : /^-?\d+/).exec(p.s.slice(p.i));
  if (!m) throw new ParseError(`${name} needs ${kind === 'b' ? 'true or false' : 'an integer'}`);
  p.i += m[0].length;
  return kind === 'b' ? m[0] === 'true' : Number(m[0]);
}

module.exports = { METHODS, parseUiSelector };
