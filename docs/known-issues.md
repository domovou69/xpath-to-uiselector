# Known issues and ideas

Problems that were found and deliberately not fixed, sorted by priority. A finding is fixed at once only when it gives
a silently wrong result (a broken or changed locator reported as success, a file written wrongly) or a crash on input
a real user could have. Everything else lands here and is fixed together with a change that already edits that code.
A row leaves this file when it is fixed or when it turns out to matter (a user report, a corpus hit).

- **P1**: silently wrong result on realistic input. Never stays here: fix it.
- **P2**: wrong or confusing but visible to the user (a compile error, a runtime exception, a missing warning), or
  a silent case that needs more than one file to see.
- **P3**: needs input that real code does not contain, or is cosmetic.

"Corpus" is the 1884 real-world literals in [audit/corpus/](../audit/corpus/). It holds string literals, not whole
files, so it cannot show how a string is joined or imported.

Last reviewed: 2026-10-26 (code review of `lib/`; findings 1–3 fixed in PRs #35 and #36).

| Priority | Title | Item | Seen in the corpus | Fix when |
|---|---|---|---|---|
| P2 | Base-path constant joined in another file | A JS/TS string with no strategy call is written as `android=…` unless the same file joins its name with other text. An exported `LIST = '//…ListView'` joined in another file (`LIST + '//…'`) is still rewritten, and the joined locator breaks at runtime with no warning. | n/a (literals only) | On a user report; the fix is a first pass over all scanned JS/TS files that collects joined names |
| P2 | `matches()` on `@text` has no range-widget warning | `//*[matches(@text,'[0-9]+')]` converts with no warning, while `contains(@text,'5')` gets one. The range-widget probe evaluates the condition, and `evaluate()` returns null for `matches()`. The XPath also finds a SeekBar whose text is `50.0`; the UiSelector does not. | no (`matches(@text` 0 times) | When the range-widget probe in `lib/converter.js` is touched |
| P2 | C# `String.Format`: added braces not doubled | In a non-interpolated C# string read as a format string (`{0}`), braces the conversion adds (`[\s\S]{3}` from `string-length(@text)=3`, an escaped `\{`) are written back single. `String.Format` throws `FormatException` at runtime; the scan reported success. | no (C# 194 literals, none with `{0}`) | When the C# path of `lib/literal.js` is touched |
| P2 | `AppiumBy` / `MobileBy` used without an import | `strategy.js` `names()` checks for the bare word anywhere in the file, comments and fully qualified names included, then writes the short name. The file no longer compiles (Java) or fails with `NameError` (Python). | not checked (literals only) | When `lib/strategy.js` is touched |
| P3 | Union of two `translate()` tests with the same result | The union signature uses `JSON.stringify`, which drops the mapping closures, so `//a[translate(@text,'ABC','abc')='abc'] \| //a[translate(@text,'XYZ','abc')='abc']` keeps one branch only. | no (`translate(` 0 times) | When the union code in `lib/converter.js` is touched |
| P3 | Inline `(?x)` in `matches()` | `lib/regex.js` treats `(?x)` as zero width but ignores its effect, so `(?x) a?` (matches `""`) is judged non-empty and converted. Fix: throw `RegexError` on an inline `x` flag, as the converter does for the `x` flag argument. | no | When `lib/regex.js` is touched |
| P3 | Nested `some` / `every` that rebinds the same variable | `quantified()` replaces `$v` in the whole body, also inside an inner quantifier that binds `$v` again. | no | When `quantified()` is touched |
| P3 | Python keeps the backslash of `\$ \{ \} \/ \# \`` | `decodeLiteral` drops the backslash of these escapes for every C-escape language; Python keeps it, so `"//*[@text='\$5']"` is converted as text `$5`. From reading the code, not run. | no | When the Python path of `lib/literal.js` is touched |
