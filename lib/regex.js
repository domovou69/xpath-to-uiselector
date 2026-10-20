// Structural reading of a Java regex, for one question: can the pattern match
// the empty string? (reference XP-03: XPath's matches() sees an absent
// attribute as "", while a UiSelector …Matches() never matches a null value,
// so a pattern that matches "" is not converted.)
//
// Zero-width parts (anchors, \b, lookarounds) are counted as matching "", which
// can only make the answer "yes" too often: the converter then skips a locator
// it could have converted, never the reverse. Anything the reader does not
// understand (backreferences, unbalanced groups) throws, and the converter
// skips the locator.

class RegexError extends Error {}

function matchesEmpty(pattern) {
  const p = { s: pattern, i: 0 };
  const result = alternation(p);
  if (p.i !== pattern.length) throw new RegexError(`unbalanced ) at ${p.i}`);
  return result;
}

// alternation := sequence ('|' sequence)*
function alternation(p) {
  let any = sequence(p);
  while (p.s[p.i] === '|') {
    p.i++;
    if (sequence(p)) any = true;
  }
  return any;
}

// sequence := (atom quantifier?)*  — nullable when every atom is
function sequence(p) {
  let all = true;
  while (p.i < p.s.length && p.s[p.i] !== '|' && p.s[p.i] !== ')') {
    let nullable = atom(p);
    const q = quantifier(p);
    if (q !== null && q.min === 0) nullable = true;
    if (!nullable) all = false;
  }
  return all;
}

function quantifier(p) {
  const s = p.s;
  let q = null;
  if (s[p.i] === '*' || s[p.i] === '?') { q = { min: 0 }; p.i++; }
  else if (s[p.i] === '+') { q = { min: 1 }; p.i++; }
  else if (s[p.i] === '{') {
    const m = /^\{(\d+)(?:,(\d*))?\}/.exec(s.slice(p.i));
    if (!m) throw new RegexError(`bad quantifier at ${p.i}`);
    q = { min: Number(m[1]) };
    p.i += m[0].length;
  }
  if (q && (s[p.i] === '?' || s[p.i] === '+')) p.i++; // lazy / possessive
  if (q && '*+?{'.includes(s[p.i] || '\0')) throw new RegexError(`repeated quantifier at ${p.i}`);
  return q;
}

// Returns whether the atom can match "".
function atom(p) {
  const s = p.s;
  const c = s[p.i];
  if (c === '*' || c === '+' || c === '?' || c === '{') throw new RegexError(`dangling quantifier at ${p.i}`);
  if (c === '^' || c === '$') { p.i++; return true; }
  if (c === '.') { p.i++; return false; }
  if (c === '[') { charClass(p); return false; }
  if (c === '\\') return escape(p);
  if (c === '(') {
    p.i++;
    let zeroWidth = false;
    if (s[p.i] === '?') {
      const m = /^\?(?:[:>]|[=!]|<[=!]|<[A-Za-z][A-Za-z0-9]*>|[idmsuxU-]*[:)])/.exec(s.slice(p.i));
      if (!m) throw new RegexError(`unknown group at ${p.i}`);
      p.i += m[0].length;
      if (m[0].endsWith(')')) return true; // inline flags (?i): zero width
      zeroWidth = /^\?(?:[=!]|<[=!])/.test(m[0]);
    }
    const inner = alternation(p);
    if (s[p.i] !== ')') throw new RegexError('unclosed group');
    p.i++;
    return zeroWidth || inner;
  }
  p.i++;
  return false;
}

function escape(p) {
  const s = p.s;
  const c = s[p.i + 1];
  if (c === undefined) throw new RegexError('trailing backslash');
  if (c === 'Q') {
    const end = s.indexOf('\\E', p.i + 2);
    const body = end < 0 ? s.slice(p.i + 2) : s.slice(p.i + 2, end);
    p.i = end < 0 ? s.length : end + 2;
    return body.length === 0;
  }
  if ('bBAGZz'.includes(c)) { p.i += 2; return true; }
  if (/[1-9k]/.test(c)) throw new RegexError('backreferences are not read');
  if (c === 'p' || c === 'P') {
    const m = /^\\[pP](?:\{[^}]*\}|[A-Za-z])/.exec(s.slice(p.i));
    if (!m) throw new RegexError('bad \\p');
    p.i += m[0].length;
    return false;
  }
  const m = /^\\(?:x\{[0-9a-fA-F]+\}|x[0-9a-fA-F]{2}|u[0-9a-fA-F]{4}|0[0-7]{1,3}|c.|N\{[^}]*\}|.)/s.exec(s.slice(p.i));
  p.i += m[0].length;
  return false;
}

// [ … ] with nesting ([a-z&&[^aeiou]]) and escapes; a leading ] is literal.
function charClass(p) {
  const s = p.s;
  p.i++;
  if (s[p.i] === '^') p.i++;
  if (s[p.i] === ']') p.i++;
  while (p.i < s.length && s[p.i] !== ']') {
    if (s[p.i] === '\\') {
      if (s[p.i + 1] === 'Q') {
        const end = s.indexOf('\\E', p.i + 2);
        p.i = end < 0 ? s.length : end + 2;
      } else p.i += 2;
    } else if (s[p.i] === '[') charClass(p);
    else p.i++;
  }
  if (s[p.i] !== ']') throw new RegexError('unclosed character class');
  p.i++;
}

module.exports = { matchesEmpty, RegexError };
