# Plan — xpath-to-uiselector

Converts Appium XPath locators in Android tests to UiAutomator2 `UiSelector` locators
(`-android uiautomator`), and refuses to convert the ones that have no exact `UiSelector`.

Started 2026-10-20. Follow-up to:

- [xpath-to-class-chain](https://github.com/domovou69/xpath-to-class-chain): the same tool for iOS. Its
  final state (v1.0.2) is the target shape: CLI, report, strategy markers, audit, skill, npm, upstream watch.
- [appium-android-locator-benchmark](https://github.com/domovou69/appium-android-locator-benchmark):
  `UiSelector` was faster than XPath in 30 of 30 cases (49 % at 100 elements, 12 % at 2000), and XPath
  finds nothing deeper than 70 levels. Speed is already measured; this project does not measure it again.

## Review of the first draft (2026-10-20)

The first draft copied xpath-to-class-chain's order: write the converter, then build an oracle, then fix.
That order cost the iOS project most of its 89 commits: the first audit scored R 72 / S 7.7, then came
root-cause rounds RC1–RC15, RC-D1–D4, Phase 5 A–D, an LLM comparison that found 24 GAPs the spec matrix
had missed, and ~10 release-polish PRs (bin bit, short npm README, metadata). A check of the pinned
UiAutomator2 server sources (v10.6.6) also refuted parts of the draft's rule table. Changes:

| # | Draft | Problem | Now |
| --- | --- | --- | --- |
| 1 | XPath 2.0 functions skipped as "invalid XPath 1.0" | The server evaluates XPath with Eclipse PsychoPath (**XPath 2.0**) unless the `enforceXPath1` setting is on (`AccessibilityNodeInfoDumper.findNodes`). `ends-with`, `matches`, `lower-case`, `@a=("x","y")` are valid on Android | Converted where exact; the engine is a pinned assumption, with XPath 1.0 mode listed as a limit |
| 2 | Rules from memory, "verify" later | The device check came after the converter, as on iOS | Stage 1 writes reference excerpts from the pinned sources; every row gets an S case with a hand-written expected `UiSelector`, run on the device **before** the converter exists |
| 3 | Host harness with a `UiSelector` matcher transcribed from androidx | A second implementation to keep right (mini-WDA needed a Phase 2 correction); the emulator answers in ~50–100 ms per lookup | One oracle: the real server on the emulator, with random trees rendered from JSON (section 5). No transcribed matcher |
| 4 | Converter logic copied 1:1 (string/regex based) | Most iOS fix rounds were string-handling bugs: `and`/`or` precedence (RC7), literals (B1), `not (` (B2), XPath 2.0 syntax passed through as `success` (P1). On Android XPath 2.0 is the default, so the input grammar is larger | Scanner, CLI, report, strategy markers 1:1; the converter core parses XPath into an AST and converts a whitelisted subset; anything else is a skip with a reason |
| 5 | Not covered | `classNameMatches` makes `findElements` iterate `index(0..n)` instead of `instance` (`ByUiAutomatorFinder.matchDescendantElements`); `instance(n)` makes `findElements` return one element | Rules in section 3; `classNameMatches` only with a warning |
| 6 | Not covered | The server's string literal unescapes only `\"`; a backslash stays as is, and a value ending in `\` cannot be written (`UiExpressionParser.coerceArgToType`) | Literal rules in section 3 |
| 7 | Not covered | Dynamic XPaths: `String.format("…%s…")`, `"…" + name + "…"`, f-strings, Kotlin `$x`, C# `{0}`, JS `${}`. Common in Java/Python suites | Scanner rules in section 2 |
| 8 | Not covered | Mixed web/mobile repos: Selenium or WebView XPaths in the scanned files | User's decision: the user chooses what to scan and reverts what is not Android; the preview diff is the default. No Android-signal filter; the README says so |
| 9 | Not covered | Conversions are exact only for default driver settings (`enforceXPath1`, `allowInvisibleElements`, `ignoreUnimportantViews`, `enableMultiWindows`, `snapshotMaxDepth`, `normalizeTagNames`) | Default settings only (user's decision). `docs/settings.md` lists every UiAutomator2 setting with its default at the pinned versions and marks the ones that change lookup results or speed; the README links it |
| 10 | Real device, timing, LLM comparison implied by "like iOS" | On iOS the iPhone gave 246/246 the same outcomes as the simulator; timing is done by the benchmark; LLM comparison is not needed for the tool | Dropped. Optional later: an article |
| 11 | Release polish at the end | ~10 iOS PRs were packaging fixes | Done in stage 0: `bin` mode 100755, `files`, short npm README, keywords, CI, `engines` |
| 12 | 9 stages, ≈11–12 h plus an open-ended fix round | | 6 stages, ≈8 h (section 6) |

## Principles

- **Exact or skip.** A locator is converted only when the `UiSelector` selects the same elements in the
  same order. Close forms convert with a warning and are listed; everything else is skipped with a reason.
- **Spec first, oracle first, converter last.** Every rule has a reference row (source file and line at
  the pinned tag), an S case, and an oracle result on the emulator before the converter implements it.
- **One oracle: the device.** UiAutomator2 server on the emulator decides. No re-implementation of
  XPath or `UiSelector` matching.
- **Pinned versions and settings** in `docs/environment.md`: Appium 3.8.0, appium-uiautomator2-driver
  8.7.0, server 10.6.6 (PsychoPath vendored at commit `544c11a`), `androidx.test.uiautomator` version
  from the server's catalog, emulator image. Driver settings: defaults only, listed in full in
  `docs/settings.md` (stage 0), with the ones that affect lookup results or speed marked.
- **No runtime dependencies**, Node 20+. Audit scripts may use devDependencies.

## 1. What carries over from xpath-to-class-chain (v1.0.2)

| Part | Decision |
| --- | --- |
| `walkDir` (symlinks, UTF-8 round-trip, ignore dirs), CLI flags (`--write` needs a folder, `--json`, `--quiet`, unknown flags rejected), report shape, `STATUS`, quote escaping on write | 1:1 |
| Explicit strategy markers per language (`lib/strategy.js`) | 1:1 for finding the call; extended to rewrite it (section 2) |
| Platform detection | Inverted: iOS locators and `ios:` keys are skipped |
| `${…}` handling, `concat()` folding, `.//X`, `descendant::`/`child::`/`self::` normalization, unions, grouped `(…)[n]`, `\"…\"` (JSON / Java) literals | Same behaviour, re-implemented on the AST |
| NSPredicate rewrite, class chain validator and optimizer, `elementTypes.js` | Replaced: `UiSelector` emitter, validator for existing `new UiSelector()` strings, method-order normalizer |
| `npm test` style (one dependency-free test file), `audit/` layout, verdicts and scoring, `coverage-cases.json` | Same |
| Claude skill, npm metadata, upstream watch (GitHub Action, monthly) | Same; watched files are the server files cited in `reference/` |

## 2. Input and output

**Input** is a path. The scanner finds quoted strings that look like XPath, with the same pre-filter as
on iOS (`//` or `(//` plus a predicate or a step, so URLs are not touched). iOS locators
(`XCUIElementType*`, values under an `ios:` key) are skipped. Web and WebView XPaths are not detected:
the user points the tool at Android tests and reverts what does not belong (user's decision); the
default run only previews the diff, and the README states this.

**Dynamic locators** keep their placeholders: `%s`/`%d` (`String.format`), `{0}`/`{name}` (C#,
Python `format`, f-strings), `$x`/`${x}` (Kotlin, JS, Groovy), and concatenation (`"…" + x + "…"`,
converted only when the pieces join into one predicate literal). A placeholder inside a literal gets a
warning: a runtime value with `"` or a trailing `\` breaks the `UiSelector` (section 3).

**Output** rewrites the strategy and the string together where the call is recognized:

| Where | Before | After |
| --- | --- | --- |
| WebdriverIO | `$('//android.widget.Button[@text="OK"]')` | `$('android=new UiSelector().className("android.widget.Button").text("OK")')` |
| java-client | `AppiumBy.xpath(…)`, `By.xpath(…)`, `MobileBy.xpath(…)` | `AppiumBy.androidUIAutomator(…)` |
| Page Factory | `@AndroidFindBy(xpath = …)` | `@AndroidFindBy(uiAutomator = …)` |
| Python | `(AppiumBy.XPATH, …)`, `find_element(By.XPATH, …)` | `(AppiumBy.ANDROID_UIAUTOMATOR, …)` |
| Ruby, C# | `find_element(:xpath, …)`, `MobileBy.XPath(…)` | `:uiautomator`, `MobileBy.AndroidUIAutomator(…)` |
| Data files, unknown calls, Selenium 3 `*_by_xpath` | any | unchanged; reported with the `UiSelector` (`skipped_unknown_strategy`) |

Order of languages follows the R corpus (stage 2, [`frequencies.md`](audit/corpus/frequencies.md)), project-weighted:
Java 30 % (6 projects), Python 25 % (5), TypeScript 20 % (4), JavaScript and Kotlin 10 % (2 each), C# 5 % (1).
Strategy calls to rewrite, by frequency: `@AndroidFindBy(xpath =`, `MobileBy.XPATH` / `AppiumBy.XPATH` (Python),
`By.xpath(` / `AppiumBy.xpath(` (Java), `By.XPath(` (C#), `findElementByXPath(`, `"xpath"` (WebdriverIO-style
`findElement`); about a third are bare strings.

## 3. Rules

Confirmed against the sources in stage 1: every rule cites rows of [`reference/`](reference/README.md),
and the full list with expected output is the S cases in [`audit/spec/cases.js`](audit/spec/cases.js).
Stage 3 confirms them on the emulator. Changes from the draft, found in the sources:

- `textContains`, `textStartsWith`, `descriptionContains`, `descriptionStartsWith` are
  **case-insensitive** (SEL-02). XPath's `contains()` / `starts-with()` are not, so they become an
  escaped `…Matches("(?s).*v.*")` regex; the four methods are never emitted.
- Values with `"` or `\` are not skipped: a `…Matches` form writes them as `\x22` / `\x5c` (SRV-23).
- `(//X)[n]` → `instance(n-1)` should be exact: UiSelector counts in pre-order, the same as XPath
  document order, with the same visibility rule (SEL-06, SEL-07, SEL-10).
- `//A//B` → `childSelector`: the first element equals the XPath's, `findElements` returns at most one per
  container (SEL-11): close.
- New skips: `@text=""` and text tests that hold for `""` (SRV-05), float-shaped `@text` (range widgets,
  SRV-06), `android.widget.Toast` (SRV-13), `@name` / camelCase aliases (SRV-11).

Stage 3 ran all 132 S cases on four LocatorLab screens ([summary](audit/device/results/s-summary.md)):
every exact case gave the same elements in the same order, except the two documented gaps of XPath
(nodes below level 70, the toast). Corrections: `//*` is exact (`new UiSelector()`; the root is never
returned), `@text=1` and `contains(text(),…)` fail on the device, `$` in a name test is a parse error.
`(?i)` is ICU and folds Unicode letters: `lower-case` agreed, `upper-case` and `translate` did not.
- `matches()` converts exactly with a wrapper that turns PsychoPath's `find()` into a whole-string match
  (XP-03); patterns that match `""` are skipped.

| XPath | `UiSelector` | Class |
| --- | --- | --- |
| `//T`, `@class="T"` | `className("T")` | exact; `$` in `T`, `android.view.View`: skip |
| `//*` | `new UiSelector()` | exact (oracle) |
| `@text`, `@content-desc`, `@resource-id`, `@package` `= "v"` | `text`, `description`, `resourceId`, `packageName` | exact; `…Matches` when `v` has `"` or `\` |
| `contains`, `starts-with`, `ends-with`, `matches()`, `or` / sequence on one attribute | `…Matches(regex)` | exact |
| two conditions on one attribute | one regex with lookaheads | exact |
| `contains(@class, …)`, unions of class steps | — | skip: `classNameMatches` breaks `findElements` (SRV-33, Decision 3) |
| `lower-case` | `…Matches("(?i)…")` | close (Decision 3) |
| `upper-case`, `translate` | — | skip: `(?i)` folds the Kelvin sign, they do not (Decision 3) |
| 9 booleans, `not(@b="true")` | `b(true/false)` | exact |
| `@index` | `index(n)` | exact |
| `(//X)[n]`, `[position()=n]` | `instance(n-1)` | exact (oracle) |
| `//A//B` | `childSelector` | close (Decision 3) |
| `//A/B`, `[.//B]`, `//X[n]`, `last()`, axes other than descendant, `not()` on text, `or` across attributes, unions of different paths, `/hierarchy/…`, `text()`, ~40 attributes without a criterion | — | skip with a reason |
| XPath syntax outside the AST whitelist | — | skip "unsupported syntax" |

## 4. Reference, S and R

**Reference** (`reference/`, short quotes with links, Apache-2.0 / EPL sources): each row has an id.

- `uia2-server.md`: engine choice, XML dump (attributes, null omission, tag rewriting, non-XML chars,
  toast and multi-window roots), `UiAutomatorParser` (statements, literals), `ByUiAutomatorFinder`
  (`instance`, `CLASS_REGEX`, dedupe), lookup settings.
- `uiselector-api.md`: every `UiSelector` method of the bundled androidx version, with its matching rule.
- `xpath.md`: the PsychoPath functions and operators that real locators use; XPath 1.0 differences.

**S (synthetic).** Generated from the reference: at least one case per row, plus literal edge cases
(quotes, `\n`, `\`, `$`, `%s`, non-ASCII, empty). Each case has the expected class and a hand-written
`UiSelector`. `npm run spec:check` fails if a reference row has no case. Expected size ≈150.

**R (real).** Done in stage 2: 20 open-source projects with Android Appium tests, large and weak, in
[`audit/corpus/`](audit/corpus/sources.md). No clone: `gh search code` for candidates, the git tree at a
pinned commit, only the test files from `raw.githubusercontent.com` (≈4 MB of traffic in all).
`android-locators.json` holds 1884 anonymized literals (1645 Android, the rest iOS and WebView), same
fields as iOS plus `project`, `lang`, `strategy`; `sources.md` the repos, commits, licenses and counts;
`frequencies.md` the forms, languages and strategies, also project-weighted; `contexts/` four MIT /
Apache-2.0 files for the scanner tests. Largest project: 19 % of the unique Android literals.

What the corpus says for the rules (share of unique Android literals): `@text` 48 %, `@resource-id`
36 %, `//*` 36 %, `and` 18 %, `@content-desc` 16 %, `contains()` 9 %, step `[n]` 9 %, absolute
`/hierarchy/` 5 %; 78 % are a single step. Rare: `or` 2 %, axes and `..` under 2 % each, `text()` 1 %, `matches()`
under 0.5 %.

## 5. The oracle

**App** `LocatorLab` (Android), from the benchmark's `ScaleActivity`: screens are JSON. One generic view
sets every attribute from JSON through its accessibility node (`getAccessibilityClassName`,
`setViewIdResourceName`, text, description, the 9 booleans), so any class name or resource id from a
corpus literal renders without rebuilding. A 30-minute spike in stage 3 confirms that UiA2 reports these
values; fallback: generated `ids.xml` and one rebuild per corpus change.

**Runner** (`audit/device/run.js`, local Appium as devDependency, `--resume`, headless `AOSP_API_36`, AC
power, Low Power Mode off). For each case: `findElements` with the XPath and with the `UiSelector`,
compare element lists by attribute fingerprint and order. Outcomes `EQUAL`, `SET_DIFFERS`,
`ORDER_DIFFERS`, `XPATH_ONLY`, `UISEL_ERROR`, `XPATH_ERROR`.

- **S mode:** fixed screens with traps (duplicates at several depths, nested matches, null vs. empty,
  all booleans, deep chain, two windows / toast).
- **Fuzz mode:** for R, random screens built from the literals of each batch of locators (≈5 screens per
  batch, ≈500 locators): ≈1–2 h in the background, replaces the iOS mini-WDA fuzz.
- Lookup time is recorded on every run (free data, not a benchmark).

**Scoring** as on iOS: CORRECT, CORRECT-SKIP, DRIFT (documented, 0.5), WRONG, GAP;
R = 100 × (CORRECT + 0.5 × DRIFT) / expressible, S per category, C = converted / real. Release needs
0 WRONG and 0 GAP on S (the expected `UiSelector`s were proven on the device first).

## 6. Stages

One branch and one PR per stage, into `main`. Share is of the 5-hour window.

| # | Stage | Result | Estimate |
| --- | --- | --- | --- |
| 0 | Scaffold and carry-over | package (bin, files, engines, keywords, short npm README), CI, `docs/environment.md`, `docs/settings.md` (all settings with defaults, from the driver docs and the server's `model/settings/`), scanner / CLI / report / strategy markers with their tests, ported to Android detection | ≈45 min, ≈9 % |
| 1 | Reference and S | `reference/` excerpts at the pinned tags, S cases with expected `UiSelector`, `spec:check` | ≈75 min, ≈15 % |
| 2 | R corpus | ~10 projects, extraction, anonymization, `sources.md`, form and language frequencies | ≈60 min, ≈12 %; done: 20 projects, ≈4 MB downloaded, no clone |
| 3 | Oracle | LocatorLab spike and screens, runner, S run on the emulator: every S expectation confirmed or corrected (no converter yet) | ≈90 min, ≈18 %; done: [`audit/device/`](audit/device/README.md), ≈0 MB downloaded |
| 4 | Converter | AST parser (whitelist), `UiSelector` emitter, strategy rewrite, unit tests; loop until S has 0 WRONG / 0 GAP; R fuzz run in the background | ≈2.5 h, ≈30 % |
| 5 | Report and release | `audit/coverage-report.md`, README with limits and settings, `docs/reference.md`, Claude skill, upstream watch; npm publish after your OK | ≈60 min, ≈12 % |

Total ≈8 h, under two windows. Stages 1 and 2 are independent and can swap. Fixes found by the R fuzz
go into stage 4, not into a separate round.

## Decisions (2026-10-20)

1. Converter core on an AST (change 4): accepted as recommended. The scanner, CLI and report stay 1:1.
2. The strategy call is rewritten together with the string (section 2): yes.
3. Close forms (`childSelector`, `classNameMatches`): decided after stage 3, when the oracle shows
   which are exact. Stage 3: neither is exact for `findElements`; both return the XPath's first
   element. Decided 2026-10-20: `//A//B` → `childSelector` close (5.5 % of R); `classNameMatches`
   skip (≈0 % of R, `findElements` lost most elements); `lower-case` → `(?i)` close (agreed on the
   device; one-to-many case folds unchecked); `upper-case`, `translate` skip; `//android.view.View`
   skip.
4. Web / WebView XPaths in scanned files: the user's responsibility (change 8).
5. Default driver settings only, documented in `docs/settings.md` (change 9).
