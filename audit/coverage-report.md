# Coverage report

What the audit proves about the converter, and what it does not. Stack: Appium 3.8.0,
appium-uiautomator2-driver 8.7.0, UiAutomator2 server 10.6.6, `androidx.test.uiautomator` 2.3.0,
emulator `AOSP_API_36` (Android 16), default driver settings ([docs/environment.md](../docs/environment.md),
[docs/settings.md](../docs/settings.md)). Recorded 2026-10-21. The generated summaries linked below use short labels
(S, R, C, DRIFT, VACUOUS, …); [docs/how-it-works.md](../docs/how-it-works.md#terms) gives their plain names, which
this report uses.

| Measure | Value | Source |
| --- | --- | --- |
| Edge cases (written from the sources) | **100.0** over 134 cases: 84 correct, 50 correctly skipped, 0 close matches, 0 wrong, 0 missed | `npm run spec:score` |
| Edge cases on the device | 134 of 134 expectations confirmed or explained (76 confirmed, 50 skip cases run as XPath only, 5 close forms that differ as warned, 3 where nothing matched) | [s-summary.md](device/results/s-summary.md) |
| Real-world locators (emulator fuzz) | **96.6** over 1142 XPaths, **96.7** over their 1170 literals: 1065 correct, 77 close matches, **0 wrong** | [r-fuzz-summary.md](device/results/r-fuzz-summary.md) |
| Real-world locators by form | 91 forms, none with a wrong XPath or one where nothing matched | same |
| Conversion rate (converted / real Android literals) | **71.1 %** (1170 of 1645); exact only 63.6 % | [convert-summary.md](corpus/convert-summary.md) |
| Strength of the check (mutants killed) | **99.5 %** of 1718 wrong UiSelectors on the matrix screens (62.4 % on the random screens alone) | r-fuzz-summary.md, "Mutants" |

## How it was checked

1. **Reference.** Every rule is a row in [`reference/`](../reference/README.md) (`SRV-…`, `SEL-…`, `XP-…`) with
   the source file at the pinned tag: the server's page source and UiSelector parser, androidx `UiSelector`,
   PsychoPath XPath 2.0.
2. **Edge cases.** [`audit/spec/cases.js`](spec/cases.js): an XPath per rule and edge case, its class
   (exact / close / skip) and a hand-written `UiSelector`. `npm run spec:check` fails if a reference row has no case.
3. **Device first.** Every edge case ran on the emulator before the converter existed
   ([audit/device/](device/README.md)): `findElements` by XPath and by `UiSelector` on four screens with traps, element
   lists compared by fingerprint and order. 19 cases carry what the device showed, some of them corrections (e.g.
   `//*` is exact, `@text=1`, `upper-case()` and `translate()` are skips).
4. **Converter.** Written last, against the edge cases (`npm run spec:score`, exit 1 on any wrong or missed answer).
5. **Real-world locators.** 1645 Android XPath literals from 20 open-source projects ([sources.md](corpus/sources.md)), converted offline,
   then every converted XPath ran on random screens built from its own values, again on matrix screens, and against
   mutants. The same steps as a diagram: [how-it-works.md](../docs/how-it-works.md#2-how-it-was-built-and-checked).

## Edge cases by category

Score = 100 × (correct + correctly skipped + 0.5 × close match) / cases. On the device, "xpath only" is a skip case: there is no
`UiSelector` to compare, so the XPath runs to show what it matches; some skips also carry a probe `UiSelector` that
shows why the obvious conversion is wrong.

| Category | Cases | exact / close / skip | Score | Device |
| --- | --- | --- | --- | --- |
| A: attributes and class steps | 19 | 9 / 1 / 9 | 100 | 9 confirmed, 9 xpath only, 1 differs as warned (close: `android.view.View`) |
| B: booleans and index | 17 | 14 / 0 / 3 | 100 | 14 confirmed, 3 xpath only |
| C: string functions | 17 | 8 / 0 / 9 | 100 | 8 confirmed, 9 xpath only |
| D: logic (`and`, `or`, `not`) | 12 | 7 / 0 / 5 | 100 | 7 confirmed, 5 xpath only |
| E: positions | 8 | 4 / 0 / 4 | 100 | 4 confirmed, 4 xpath only |
| F: paths | 12 | 2 / 4 / 6 | 100 | 2 confirmed, 6 xpath only, 4 differ as warned (close: `childSelector`) |
| G: literals (quotes, `\`, `$`, `%s`, non-ASCII) | 16 | 15 / 0 / 1 | 100 | 15 confirmed, 1 xpath only |
| H: regexes and case | 12 | 6 / 2 / 4 | 100 | 7 confirmed, 4 xpath only, 1 nothing matched (H11) |
| X: unions and sequences | 4 | 2 / 0 / 2 | 100 | 2 confirmed, 2 xpath only |
| P: root and absolute paths | 5 | 2 / 0 / 3 | 100 | 2 confirmed, 3 xpath only |
| T: tree and traversal | 3 | 3 / 0 / 0 | 100 | 1 confirmed, 2 nothing matched (by design) |
| V: XPath 2.0 syntax, invalid input | 8 | 4 / 0 / 4 | 100 | 4 confirmed, 4 xpath only |
| O: output form | 1 | 1 / 0 / 0 | 100 | 1 confirmed |
| **All** | **134** | **77 / 7 / 50** | **100.0** | 76 confirmed, 50 xpath only, 5 differ as warned, 3 nothing matched |

- **Differs as warned**: the close forms doing what their warning says: `//android.view.View` also matches nodes without a
  class name in the page source (A16), `//A//B` → `childSelector` returns at most one element per container (F01, F03,
  F10, F12). The other close cases (H05, H06: `lower-case()`) were EQUAL on every screen.
- **Nothing matched** on any edge-case screen. T02 (a node below level 70: XPath finds nothing,
  `UiSelector` finds it) and T03 (an invisible node: neither finds it) are meant to match nothing on the XPath side.
  H11 (`matches()` without the `s` flag) was added after the edge-case run, from the real-world mutants; its trap, a text with a line
  break, is on every matrix screen of the real-world fuzz, where all 26 `matches()` items were EQUAL and the "(?s) dropped" mutant was
  killed 26 of 26 times.
- Two documented XPath gaps show up as notes, not failures: **DEPTH** (the `UiSelector` also finds nodes below the
  70-level page source limit, `snapshotMaxDepth`) and **TOAST** (the XPath also finds the toast, which exists only
  in the page source).

## Real-world locators

### Verdicts

Each converted XPath runs on 5 random screens of its batch (targets, deeper and nested copies, invisible ones, near
misses with one value changed) and once on a matrix screen (below). Correct: the same elements in the same order on
every screen, and a match on its own screen. Close match: a close form whose first element agrees on every screen,
scored 0.5. Wrong: anything else.

| Verdict | XPaths | Literals | Exact | Close |
| --- | --- | --- | --- | --- |
| Correct | 1065 | 1092 | 1025 | 40 |
| Close match | 77 | 78 | 0 | 77 |
| Wrong | 0 | 0 | 0 | 0 |
| Nothing matched | 0 | 0 | 0 | 0 |

Score = 100 × (correct + 0.5 × close match) / converted = **96.6**. 100 is out of reach by design: a close form scores
0.5 even when its first element always agrees. Every exact XPath was correct.

### By form

The 1142 XPaths have 91 forms (values, class names and numbers replaced). No form has a wrong XPath or one where
nothing matched.
The largest forms (`C` a class name, `S` a string, `N` a number): `//C[@text=S]` 207, `//C[@resource-id=S and @text=S]` 194, `//*[@text=S]` 138,
`//C[@content-desc=S]` 101, `//*[@resource-id=S]` 79, `//C[@resource-id=S]` 72; 38 forms have one XPath. The 70
XPaths of forms with at most two XPaths ran again on three more seeds (15 screens): 48 correct, 22 close matches,
0 wrong.
Full table: [r-fuzz-summary.md](device/results/r-fuzz-summary.md#by-form).

### Close forms

Close forms convert with a warning; the report lists them. An item can carry more than one warning.

| Warning | Why it is not exact | Items | First element agrees | EQUAL everywhere |
| --- | --- | --- | --- | --- |
| `childSelector` (`//A//B`) | `findElements` returns at most one B per matched A (SEL-11) | 40 | 40 | 0 |
| `android.view.View` | the page source writes a node with no class name as `android.view.View`; `className()` does not match it (SRV-03) | 29 | 29 | 18 |
| runtime value in a literal | a runtime value with `"`, a trailing `\` (plain) or `\E` (regex) breaks the `UiSelector` (SRV-23) | 55 | 55 | 44 |
| `lower-case()` → `(?i)` | ICU `(?i)` folds Unicode letters as `lower-case()` does; one-to-many folds (`İ`, `ß`) are not checked | 12 | 12 | 9 |

Runtime-value items are held to EQUAL (the fuzz fills in safe values), so they count as correct; the other three
warnings are close matches unless the XPath and the `UiSelector` were EQUAL on every screen.

### Matrix screens and mutants: how strong the check is

A check that passes everything proves nothing, so the screens were tested too. A **mutant** is a wrong `UiSelector`
made from an exact item's own, the kind of mistake a converter makes: `text("x")` → `textStartsWith("x")`, a
criterion dropped, `instance` off by one, an unescaped regex, `(?s)` dropped, `(?i)` added, `className` →
`classNameMatches`, and 11 more (18 kinds, up to 150 items each). A mutant is killed when its result differs from
the XPath's.

On the random screens only 62.4 % were killed, so every item also got a **matrix screen**: a cell that breaks every
tested condition in every way that applies (one character more or less at either end, swapped case, a space or a
no-break space, null, `""`, the value in another attribute, a resource id without its package, strings that an
unescaped regex would match, similar class names, flipped booleans, an index moved by one with an invisible sibling,
line breaks around the value, invisible and nested targets, union branches in reverse order).

| | Random screens | Matrix screens |
| --- | --- | --- |
| Mutants killed | 62.4 % of 1718 | **99.5 %** of 1718 |
| Converter result | 0 wrong | 0 wrong |

The 9 survivors are equivalent on those screens: a `(…)[1]` whose first match lies in another item's cell with the
same value, and `@package`, which LocatorLab cannot vary. The mutants also found one real bug before release:
`textMatches` / `descriptionMatches` compile with DOTALL, so `matches()` without the `s` flag now emits `(?-s:…)`
(edge case H11).

## What the device does not check, and why

| Not checked on the device | Why | Covered by |
| --- | --- | --- |
| Skipped locators (475 unique real-world literals, 28.9 %) | No `UiSelector` to compare. Every skip reason has an edge case that ran on the device as XPath, many with a probe showing why the obvious conversion is wrong | Edge cases, [convert-summary.md](corpus/convert-summary.md) (reasons) |
| How a literal is written in the source and written back (quotes, escapes, `String.format`, f-strings, concatenation, C# verbatim strings) and the strategy rewrite | The device sees only the XPath after the scanner has read it | `npm test` (294 tests, 4 real corpus files), offline per language in convert-summary.md |
| Real runtime values in dynamic locators | The fuzz fills in safe values; a value with `"` or `\` breaks the `UiSelector` (warned) | Warning on every such conversion |
| Non-default driver settings | The converter targets the defaults; `enforceXPath1`, `allowInvisibleElements`, `ignoreUnimportantViews`, `enableMultiWindows`, `snapshotMaxDepth`, `normalizeTagNames` change what XPath sees | [docs/settings.md](../docs/settings.md) |
| `@package` with another app's package | An app cannot set another package on its nodes; A07 ran with LocatorLab's own package | Edge case A07, reference SRV-08 |
| Jetpack Compose, WebView, multi-window apps beyond the popup screen | LocatorLab renders classic views from JSON; Compose `testTag` needs `mapTestTagToResourceId`; WebView XPaths are web locators | The rules depend on the accessibility node values, which are the same for Compose nodes; WebView is out of scope |
| One-to-many case folds (`İ`, `ß`) under `lower-case()` | ICU `(?i)` and Java `toLowerCase` differ there; not rendered on the screens | `lower-case()` is a close form with a warning |
| A real phone, other Android versions, other server versions | One emulator (Android 16, API 36) and one pinned stack. On iOS the real phone agreed with the simulator on every case; here the matching runs in the server and androidx, which ship with the driver, while the node values come from the OS | The monthly upstream watch ([audit/upstream/](upstream/README.md)) flags changes to the server files the rules cite; Backlog: a real phone |
| Lookup speed | Measured by the [benchmark](https://github.com/domovou69/appium-android-locator-benchmark) (UiSelector faster in 30 of 30 cases); here lookup times are a side product | r-fuzz-summary.md, "Lookup times" |

## Data and scripts

| What | Where |
| --- | --- |
| Reference rows | [reference/](../reference/README.md) |
| Edge cases, check, score | [spec/cases.js](spec/cases.js), [spec/check.js](spec/check.js), [spec/score.js](spec/score.js) |
| Real-world locators, offline conversion | [corpus/](corpus/sources.md): `android-locators.json`, [frequencies.md](corpus/frequencies.md), [convert-summary.md](corpus/convert-summary.md) |
| Device oracle, edge-case and real-world runs | [device/](device/README.md): `results/s-run.json`, `s-summary.md`, `r-fuzz.json`, `r-fuzz-summary.md` |
| Upstream watch | [upstream/](upstream/README.md), [upstream.json](upstream.json) |
