# Coverage report

What the audit proves about the converter, and what it does not. Stack: Appium 3.8.0,
appium-uiautomator2-driver 8.7.0, UiAutomator2 server 10.6.6, `androidx.test.uiautomator` 2.3.0,
emulator `AOSP_API_36` (Android 16; the edge cases and the matrix slice of the fuzz also on Android 17), default driver settings ([docs/environment.md](../docs/environment.md),
[docs/settings.md](../docs/settings.md)). Recorded 2026-10-21. The generated summaries linked below use short labels
(S, R, C, DRIFT, VACUOUS, …); [docs/how-it-works.md](../docs/how-it-works.md#terms) gives their plain names, which
this report uses.

| Measure | Value | Source |
| --- | --- | --- |
| Edge cases (written from the sources) | **100.0** over 150 cases: 98 correct, 52 correctly skipped, 0 close matches, 0 wrong, 0 missed | `npm run spec:score` |
| Edge cases on the device | 150 of 150 expectations confirmed or explained (89 confirmed, 52 skip cases run as XPath only, 6 close forms that differ as warned, 3 where nothing matched) | [s-summary.md](device/results/s-summary.md) |
| Real-world locators (emulator fuzz) | **96.6** over 1169 XPaths, **96.6** over their 1198 literals: 1089 correct, 80 close matches, **0 wrong** | [r-fuzz-summary.md](device/results/r-fuzz-summary.md) |
| Real-world locators by form | 95 forms, none with a wrong XPath or one where nothing matched | same |
| Conversion rate (converted / real Android literals) | **72.9 %** (1199 of 1645); exact only 63.7 % | [convert-summary.md](corpus/convert-summary.md) |
| Another Android version (Android 17, API 37) | Before the skipped-form coverage: same verdicts for all 134 edge cases and all 1142 real-world XPaths of the time on the matrix screens (1065 correct, 77 close matches, 0 wrong); compared pair by pair with Android 16, only bounds moved, and the 7 other differences are explained: none comes from the OS | [compare-api37.md](device/results/compare-api37.md) |
| Strength of the check (mutants killed) | **99.5 %** of 1718 wrong UiSelectors on the matrix screens (62.4 % on the random screens alone); run before the skipped-form coverage, whose 27 new XPaths ran on random and matrix screens without mutants | r-fuzz-summary.md, "Mutants" |
| Skips with a rewrite hint | 347 of the 446 skipped literals (1247 of 1484 occurrences) | [convert-summary.md](corpus/convert-summary.md) |

## How it was checked

1. **Reference.** Every rule is a row in [`reference/`](../reference/README.md) (`SRV-…`, `SEL-…`, `XP-…`) with
   the source file at the pinned tag: the server's page source and UiSelector parser, androidx `UiSelector`,
   PsychoPath XPath 2.0.
2. **Edge cases.** [`audit/spec/cases.js`](spec/cases.js): an XPath per rule and edge case, its class
   (exact / close / skip) and a hand-written `UiSelector`. `npm run spec:check` fails if a reference row has no case.
3. **Device first.** Every edge case ran on the emulator before the converter existed
   ([audit/device/](device/README.md)): `findElements` by XPath and by `UiSelector` on four screens with traps (five
   since the skipped-form coverage added `nest`), element lists compared by fingerprint and order. 21 cases carry what the device showed, some of them corrections (e.g.
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
| A: attributes, class steps, existence tests | 27 | 15 / 3 / 9 | 100 | 16 confirmed, 9 xpath only, 2 differ as warned (close: `android.view.View`, `@text!=""`) |
| B: booleans and index | 18 | 16 / 0 / 2 | 100 | 16 confirmed, 2 xpath only |
| C: string functions | 17 | 8 / 0 / 9 | 100 | 8 confirmed, 9 xpath only |
| D: logic (`and`, `or`, `not`) | 12 | 7 / 0 / 5 | 100 | 7 confirmed, 5 xpath only |
| E: positions | 15 | 8 / 0 / 7 | 100 | 8 confirmed, 7 xpath only |
| F: paths | 12 | 2 / 4 / 6 | 100 | 2 confirmed, 6 xpath only, 4 differ as warned (close: `childSelector`) |
| G: literals (quotes, `\`, `$`, `%s`, non-ASCII) | 16 | 15 / 0 / 1 | 100 | 15 confirmed, 1 xpath only |
| H: regexes and case | 12 | 6 / 2 / 4 | 100 | 7 confirmed, 4 xpath only, 1 nothing matched (H11) |
| X: unions and sequences | 4 | 2 / 0 / 2 | 100 | 2 confirmed, 2 xpath only |
| P: root and absolute paths | 5 | 2 / 0 / 3 | 100 | 2 confirmed, 3 xpath only |
| T: tree and traversal | 3 | 3 / 0 / 0 | 100 | 1 confirmed, 2 nothing matched (by design) |
| V: XPath 2.0 syntax, invalid input | 8 | 4 / 0 / 4 | 100 | 4 confirmed, 4 xpath only |
| O: output form | 1 | 1 / 0 / 0 | 100 | 1 confirmed |
| **All** | **150** | **89 / 9 / 52** | **100.0** | 89 confirmed, 52 xpath only, 6 differ as warned, 3 nothing matched |

- **Differs as warned**: the close forms doing what their warning says: `//android.view.View` also matches nodes without a
  class name in the page source (A16), `//A//B` → `childSelector` returns at most one element per container (F01, F03,
  F10, F12), `@text!=""` also finds the SeekBar, whose text exists only in the page source (A24). The other close
  cases (H05, H06: `lower-case()`; A25) were EQUAL on every screen.
- **Corrected by the device** in the skipped-form coverage: `(//A//B)[n]` → `A.childSelector(B.instance(n-1))` looked
  exact in the sources, but `instance` counts within each container (E10 found nothing where the XPath's fifth lies in
  the second container); only `[1]` converts, with `instance(0)` on the outer selector (E09: without it 3 elements).
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

The 1169 XPaths have 95 forms (values, class names and numbers replaced). No form has a wrong XPath or one where
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
| `android.view.View` | the page source writes a node with no class name as `android.view.View`; `className()` does not match it (SRV-03) | 31 | 31 | 20 |
| runtime value in a literal | a runtime value with `"`, a trailing `\` (plain) or `\E` (regex) breaks the `UiSelector` (SRV-23) | 59 | 59 | 48 |
| runtime position, class name, index | the runtime value must be a whole number or a full class name | 17, 5, 1 | all | all |
| `lower-case()` → `(?i)` | ICU `(?i)` folds Unicode letters as `lower-case()` does; one-to-many folds (`İ`, `ß`) are not checked | 12 | 12 | 9 |
| `@text!=""` → `textMatches("(?s).+")` | the XPath also finds range widgets, whose text exists only in the page source (SRV-06); the fuzz screens have none | 1 | 1 | 1 |

Runtime-value items are held to EQUAL (the fuzz fills in safe values), so they count as correct; the other
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
| Skipped locators (446 unique real-world literals, 27.1 %) | No `UiSelector` to compare. Every skip reason has an edge case that ran on the device as XPath, many with a probe showing why the obvious conversion is wrong. The rewrite hints are text, not run on the device | Edge cases, [convert-summary.md](corpus/convert-summary.md) (reasons) |
| How a literal is written in the source and written back (quotes, escapes, `String.format`, f-strings, concatenation, C# verbatim strings) and the strategy rewrite | The device sees only the XPath after the scanner has read it | `npm test` (342 tests, 4 real corpus files), offline per language in convert-summary.md |
| Real runtime values in dynamic locators | The fuzz fills in safe values; a value with `"` or `\` breaks the `UiSelector` (warned) | Warning on every such conversion |
| Non-default driver settings | The converter targets the defaults; `enforceXPath1`, `allowInvisibleElements`, `ignoreUnimportantViews`, `enableMultiWindows`, `snapshotMaxDepth`, `normalizeTagNames` change what XPath sees | [docs/settings.md](../docs/settings.md) |
| `@package` with another app's package | An app cannot set another package on its nodes; A07 ran with LocatorLab's own package | Edge case A07, reference SRV-08 |
| Jetpack Compose, WebView, multi-window apps beyond the popup screen | LocatorLab renders classic views from JSON; Compose `testTag` needs `mapTestTagToResourceId`; WebView XPaths are web locators | The rules depend on the accessibility node values, which are the same for Compose nodes; WebView is out of scope |
| One-to-many case folds (`İ`, `ß`) under `lower-case()` | ICU `(?i)` and Java `toLowerCase` differ there; not rendered on the screens | `lower-case()` is a close form with a warning |
| A real phone, Android versions older than 16, other server versions | Emulators only, one pinned stack. The matching runs in the server and androidx, which ship with the driver, while the node values come from the OS. Android 17 (Google Play image) gave the same results as Android 16 pair by pair, apart from bounds (taller rows and window); older versions and OEM builds were not run. On iOS the real phone agreed with the simulator on every case | [compare-api37.md](device/results/compare-api37.md); the monthly upstream watch ([audit/upstream/](upstream/README.md)) flags changes to the server files the rules cite; Backlog: a real phone |
| Lookup speed | Measured by the [benchmark](https://github.com/domovou69/appium-android-locator-benchmark) (UiSelector faster in 30 of 30 cases); here lookup times are a side product | r-fuzz-summary.md, "Lookup times" |

## Data and scripts

| What | Where |
| --- | --- |
| Reference rows | [reference/](../reference/README.md) |
| Edge cases, check, score | [spec/cases.js](spec/cases.js), [spec/check.js](spec/check.js), [spec/score.js](spec/score.js) |
| Real-world locators, offline conversion | [corpus/](corpus/sources.md): `android-locators.json`, [frequencies.md](corpus/frequencies.md), [convert-summary.md](corpus/convert-summary.md) |
| Device oracle, edge-case and real-world runs | [device/](device/README.md): `results/s-run.json`, `s-summary.md`, `r-fuzz.json`, `r-fuzz-summary.md` |
| Upstream watch | [upstream/](upstream/README.md), [upstream.json](upstream.json) |
