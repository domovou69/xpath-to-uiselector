# XPath as evaluated by the server (PsychoPath, XPath 2.0)

Files under the server's `vendor/org.eclipse.wst.xml.xpath2.processor/src/org/eclipse/wst/xml/xpath2/processor/`.
Only what real locators use; everything else is skipped by the converter's whitelist.

| Id | Fact | Source | For the converter |
| --- | --- | --- | --- |
| XP-01 | XPath 2.0 functions are available: `contains`, `starts-with`, `ends-with`, `matches`, `lower-case`, `upper-case`, `translate`, `normalize-space`, `string-length`, `concat`, `substring*`, `replace`, `tokenize`, `count`, `position`, `last`, `not`, `true`, `false`, … | `function/FnFunctionLibrary.java` | Accept these names in the parser; convert only the rows below |
| XP-02 | `contains`, `starts-with`, `ends-with` compare code points (default collation); an absent attribute is `""` | `internal/function/FnContains.java`, `FnEndsWith.java` | With a non-empty literal: exact as an escaped `…Matches` regex. With `""`: true for every element in XPath: skip |
| XP-03 | `matches(s, p, flags)` compiles `p` as a Java regex with `UNIX_LINES` (+ `s`/`m`/`i`/`x` → `DOTALL`/`MULTILINE`/`CASE_INSENSITIVE`/`COMMENTS`) and is true if `find()` succeeds anywhere; `-[` is rewritten to `&&[^`; an absent attribute is `""` | `internal/function/FnMatches.java`, `AbstractRegExFunction.java` | `…Matches("(?d)(?s:.*)(?flags:p)(?s:.*)")` is the same test for a non-null value, with `-s` added to the flags when `s` is not among them (`textMatches` / `descriptionMatches` compile with DOTALL, SEL-03); a pattern that matches `""` also matches absent attributes in XPath: skip it |
| XP-04 | `i` without `UNICODE_CASE` is ASCII-only case folding | `AbstractRegExFunction.compileAndExecute` | Keep `(?i)` as is; do not add `u` |
| XP-05 | `lower-case`, `upper-case` use Java case mapping (full Unicode); `translate` maps listed characters only | `FnLowerCase.java`, `FnUpperCase.java`, `FnTranslate.java` | `lower-case(@a)="v"` vs. `(?i)`: differs on non-ASCII (e.g. Kelvin sign): close until the oracle decides. **Oracle:** Android regexes are ICU, so `(?i)` folds Unicode letters: `lower-case` agreed with `(?i)` (Kelvin sign included); `upper-case` and `translate` did not (the Kelvin sign) |
| XP-06 | General comparison `@a=("x","y")` is true if any value matches; `@a=1` compares numerically (untyped → double) | XPath 2.0 general comparison | Sequence of strings → one regex alternation (exact); a numeric literal on a text attribute: skip (`"1.0"` = 1) |
| XP-07 | `text()` selects text nodes; the server's XML has none | XML from SRV-04 | `text()` matches nothing: skip with a reason |
| XP-08 | `(expr)[n]` is the n-th node of the whole result in document order; `expr[n]` inside a step is the position among the step's matches under each parent | XPath 2.0 | `(//X)[n]` → `instance(n-1)` (SEL-10); `//X[n]`: skip |
| XP-09 | `|` / `union` merges node sets in document order | XPath 2.0 | No UiSelector equivalent (SRV-21): skip, except same-step unions that fold into one regex |
