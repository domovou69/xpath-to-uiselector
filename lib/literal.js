// Source string literals: from the text between the quotes to the runtime value
// the converter sees, and back (PLAN.md section 2).
//
// The scanner captures a literal as written in the source. Converting that
// text directly would break on escapes: `\"` in Java is one quote, and a
// UiSelector's `\x5c` must be written `\\x5c` inside a Java string. So the
// literal is decoded per language and quote kind, converted, and encoded back
// for the same quote kind.
//
// Runtime values in the literal — `${x}` (JS template, Kotlin, Groovy), `$x`
// (Kotlin, Groovy, PHP), `#{x}` (Ruby), `%s` / `%d` (String.format, Python %),
// `{0}` (C#, Python format), `{x}` (f-strings, C# $"…") — are replaced by
// placeholder characters from the Unicode private-use area. The converter keeps
// them as they are (lib/converter.js), and encoding puts the source text back.
// Where the string syntax evaluates expressions (`${…}`, Kotlin `$x`, Ruby `#{…}`,
// f-strings, C# $"…"), a runtime position can be written minus one
// (decrementHoles).

const LANGUAGE_BY_EXTENSION = {
  '.java': 'java', '.kt': 'kotlin', '.kts': 'kotlin', '.groovy': 'groovy',
  '.py': 'python', '.cs': 'csharp', '.rb': 'ruby', '.php': 'php',
  '.js': 'js', '.mjs': 'js', '.cjs': 'js', '.jsx': 'js',
  '.ts': 'js', '.mts': 'js', '.cts': 'js', '.tsx': 'js',
  '.json': 'json',
};

const PLACEHOLDER = {
  template: /\$\{(?:[^{}]|\{[^{}]*\})*\}/y, // ${x}
  dollar: /\$[A-Za-z_]\w*/y, // $x
  ruby: /#\{(?:[^{}]|\{[^{}]*\})*\}/y, // #{x}
  printf: /%(?:\d+\$)?[-#+ 0,(]*\d*(?:\.\d+)?[sdif]/y, // %s, %1$s, %d
  braces: /\{[^{}"'\n]*\}/y, // {x}, {0}, {} (Python format and f-strings, C# $"…")
  indexed: /\{\d+(?:,[^{}]*)?(?::[^{}]*)?\}/y, // {0} (String.Format)
};

// How the literal is written: escapes 'c' (backslash escapes), 'single' (only
// \\ and \<quote>), 'verbatim' (C# @"…": "" is a quote), 'none' (raw);
// `holes`: placeholder kinds; `doubleBraces`: {{ / }} stand for { / }; `evaluates`:
// a {x} hole is an expression (f-string, C# $"…"), not a format argument.
function literalKind(ext, quote, prefix = '', after = '') {
  const lang = LANGUAGE_BY_EXTENSION[ext] || 'data';
  const p = prefix.toLowerCase();
  switch (lang) {
    case 'js': return { lang, escapes: 'c', holes: quote === '`' ? ['template'] : [] };
    case 'java': return { lang, escapes: 'c', holes: ['printf'] };
    case 'kotlin':
    case 'groovy':
      return { lang, escapes: 'c', holes: quote === '"' || (lang === 'kotlin') ? ['template', 'dollar', 'printf'] : ['printf'] };
    case 'python': {
      const format = p.includes('f') || /^\s*\.format\s*\(/.test(after);
      return { lang, escapes: p.includes('r') ? 'none' : 'c', holes: format ? ['braces', 'printf'] : ['printf'], doubleBraces: format, evaluates: p.includes('f') };
    }
    case 'csharp': {
      const interpolated = prefix.includes('$');
      return { lang, escapes: prefix.includes('@') ? 'verbatim' : 'c', holes: interpolated ? ['braces'] : ['indexed'], doubleBraces: interpolated, evaluates: interpolated };
    }
    case 'ruby': return { lang, escapes: quote === '"' ? 'c' : 'single', holes: quote === '"' ? ['ruby', 'printf'] : ['printf'] };
    case 'php': return { lang, escapes: quote === '"' ? 'c' : 'single', holes: quote === '"' ? ['dollar'] : [] };
    case 'json': return { lang, escapes: 'c', holes: [] };
    default: return { lang, escapes: 'none', holes: [] };
  }
}

const INVISIBLE = /[\uE000-\uF8FF\u00AD\u200B-\u200F\u2028\u2029\u2060\uFEFF]/;

const C_ESCAPES = { n: '\n', t: '\t', r: '\r', b: '\b', f: '\f', v: '\v', 0: '\0' };

// Returns { value, placeholders: Map(char → source text) }, or null when the
// literal holds an escape this reader does not know (the locator is then left
// alone). Placeholder characters avoid every character of `reserved` (the
// whole concatenation, so a later piece's own text is never taken for one).
function decodeLiteral(raw, kind, quote, reserved = raw) {
  const free = freeChars(reserved);
  const placeholders = new Map();
  const hole = text => {
    const ch = free();
    placeholders.set(ch, text);
    return ch;
  };
  let value = '';
  for (let i = 0; i < raw.length;) {
    const c = raw[i];
    if (c === '\\' && (kind.escapes === 'c' || kind.escapes === 'single')) {
      const n = raw[i + 1];
      if (n === undefined) return null;
      if (kind.escapes === 'single') {
        if (n === quote || n === '\\') { value += n; i += 2; } else { value += c; i++; }
        continue;
      }
      if (C_ESCAPES[n] !== undefined && !(n === '0' && /\d/.test(raw[i + 2] || ''))) { value += C_ESCAPES[n]; i += 2; continue; }
      if ('\\"\'`$/#{}'.includes(n)) { value += n; i += 2; continue; }
      const u = /^u([0-9a-fA-F]{4})|^u\{([0-9a-fA-F]{1,6})\}|^x([0-9a-fA-F]{2})/.exec(raw.slice(i + 1));
      if (u) { value += String.fromCodePoint(parseInt(u[1] || u[2] || u[3], 16)); i += 1 + u[0].length; continue; }
      return null;
    }
    if (kind.escapes === 'verbatim' && c === '"' && raw[i + 1] === '"') { value += '"'; i += 2; continue; }
    if (kind.doubleBraces && (raw.startsWith('{{', i) || raw.startsWith('}}', i))) { value += c; i += 2; continue; }
    let matched = null;
    for (const h of kind.holes) {
      const re = PLACEHOLDER[h];
      re.lastIndex = i;
      const m = re.exec(raw);
      if (m) { matched = m[0]; break; }
    }
    if (matched) { value += hole(matched); i += matched.length; continue; }
    value += c;
    i++;
  }
  return { value, placeholders, free };
}

// Private-use characters that occur in `text` neither as written nor as a
// \uXXXX escape, highest first.
function freeChars(text) {
  const used = new Set(text);
  for (const m of text.matchAll(/\\u\{?([0-9a-fA-F]{4})/g)) used.add(String.fromCharCode(parseInt(m[1], 16)));
  let code = 0xF8FF;
  return () => {
    while (used.has(String.fromCharCode(code))) code--;
    if (code < 0xE000) throw new Error('no free placeholder character');
    return String.fromCharCode(code--);
  };
}

// The value written back as the text between the quotes, or null when the
// quote kind cannot hold it (a raw string with its own quote in it).
function encodeLiteral(value, kind, quote, placeholders) {
  const holes = new Set(kind.holes);
  let out = '';
  for (const ch of value) {
    if (placeholders.has(ch)) { out += placeholders.get(ch); continue; }
    if (kind.doubleBraces && (ch === '{' || ch === '}')) { out += ch + ch; continue; }
    switch (kind.escapes) {
      case 'c':
        if (ch === '\\') out += '\\\\';
        else if (ch === quote) out += `\\${quote}`;
        else if (ch === '\n') out += '\\n';
        else if (ch === '\r') out += '\\r';
        else if (ch === '\t') out += '\\t';
        else if (ch === '$' && (holes.has('template') || holes.has('dollar'))) out += '\\$';
        else if (ch === '#' && holes.has('ruby')) out += '\\#';
        // invisible characters (icon fonts, format characters) stay readable
        else if (INVISIBLE.test(ch) && kind.lang !== 'php') out += `\\u${ch.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0')}`;
        else out += ch;
        break;
      case 'single':
        out += ch === '\\' ? '\\\\' : ch === quote ? `\\${quote}` : ch;
        break;
      case 'verbatim':
        out += ch === '"' ? '""' : ch;
        break;
      default:
        if (ch === quote || ch === '\n') return null;
        out += ch;
    }
  }
  return out;
}

// The host expression of a placeholder minus one, as source text, or null when
// the string syntax cannot compute it (%d, {0}, {}, concatenation).
function decrementText(text, kind) {
  const minusOne = expr => {
    const e = expr.trim();
    const plusOne = /^([\w$.]+)\s*\+\s*1$/.exec(e);
    if (plusOne) return plusOne[1];
    return /^[\w$.]+$/.test(e) ? `${e} - 1` : `(${e}) - 1`;
  };
  const holes = new Set(kind.holes);
  let m;
  if (holes.has('template') && (m = /^\$\{([^]*)\}$/.exec(text)) && m[1].trim()) return `\${${minusOne(m[1])}}`;
  if (holes.has('dollar') && (kind.lang === 'kotlin' || kind.lang === 'groovy') && (m = /^\$([A-Za-z_]\w*)$/.exec(text))) return `\${${m[1]} - 1}`;
  if (holes.has('ruby') && (m = /^#\{([^]*)\}$/.exec(text)) && m[1].trim()) return `#{${minusOne(m[1])}}`;
  if (holes.has('braces') && kind.evaluates && (m = /^\{([^{}]*)\}$/.exec(text)) && m[1].trim() && !/^\d+$/.test(m[1].trim())
    && !/[:!]/.test(m[1].replace(/!=|==|<=|>=/g, ''))) return `{${minusOne(m[1])}}`;
  return null;
}

// For each placeholder whose expression can be written minus one: a new
// placeholder for that text, added to `placeholders`. Returns Map(old → new),
// the converter's opts.decrement.
function decrementHoles(placeholders, kind, free) {
  const out = new Map();
  for (const [ch, text] of [...placeholders]) {
    const dec = decrementText(text, kind);
    if (dec === null) continue;
    const fresh = free();
    placeholders.set(fresh, dec);
    out.set(ch, fresh);
  }
  return out;
}

module.exports = { LANGUAGE_BY_EXTENSION, literalKind, decodeLiteral, encodeLiteral, decrementHoles };
