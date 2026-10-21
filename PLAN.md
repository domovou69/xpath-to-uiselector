# Plan — xpath-to-uiselector

Converts Appium XPath locators in Android tests to UiAutomator2 `UiSelector` locators
(`-android uiautomator`), and refuses to convert the ones that have no exact `UiSelector`.

Started 2026-10-20. Follow-up to:

- [xpath-to-class-chain](https://github.com/domovou69/xpath-to-class-chain): the same tool for iOS. Its
  final state (v1.0.2) is the target shape: CLI, report, strategy markers, audit, skill, npm, upstream watch
  (here without the LLM step: every change to a watched file opens an issue).
- [appium-android-locator-benchmark](https://github.com/domovou69/appium-android-locator-benchmark):
  `UiSelector` was faster than XPath in 30 of 30 cases (49 % at 100 elements, 12 % at 2000), and XPath
  finds nothing deeper than 70 levels. Speed is already measured; this project does not measure it again.

How the converter works and how it was checked, as diagrams: [docs/how-it-works.md](docs/how-it-works.md).
Terms used below: **edge cases** (S) are XPaths written from the reference with their expected answer;
**real-world locators** (R) are XPath literals from open-source projects; **conversion rate** (C) is the share of
them that converts. The audit's verdict labels (CORRECT, DRIFT = close match, VACUOUS = nothing matched, …) are
listed in [how-it-works.md, Terms](docs/how-it-works.md#terms).

## Review of the first draft (2026-10-20)

The first draft copied xpath-to-class-chain's order: write the converter, then build an oracle, then fix.
That order cost the iOS project most of its 89 commits: the first audit scored 72 on real locators and 7.7 on edge cases, then came
root-cause rounds RC1–RC15, RC-D1–D4, Phase 5 A–D, an LLM comparison that found 24 gaps the spec matrix
had missed, and ~10 release-polish PRs (bin bit, short npm README, metadata). A check of the pinned
UiAutomator2 server sources (v10.6.6) also refuted parts of the draft's rule table. Changes:

| # | Draft | Problem | Now |
| --- | --- | --- | --- |
| 1 | XPath 2.0 functions skipped as "invalid XPath 1.0" | The server evaluates XPath with Eclipse PsychoPath (**XPath 2.0**) unless the `enforceXPath1` setting is on (`AccessibilityNodeInfoDumper.findNodes`). `ends-with`, `matches`, `lower-case`, `@a=("x","y")` are valid on Android | Converted where exact; the engine is a pinned assumption, with XPath 1.0 mode listed as a limit |
| 2 | Rules from memory, "verify" later | The device check came after the converter, as on iOS | Stage 1 writes reference excerpts from the pinned sources; every row gets an edge case with a hand-written expected `UiSelector`, run on the device **before** the converter exists |
| 3 | Host harness with a `UiSelector` matcher transcribed from androidx | A second implementation to keep right (mini-WDA needed a Phase 2 correction); the emulator answers in ~50–100 ms per lookup | One oracle: the real server on the emulator, with random trees rendered from JSON (section 5). No transcribed matcher |
| 4 | Converter logic copied 1:1 (string/regex based) | Most iOS fix rounds were string-handling bugs: `and`/`or` precedence (RC7), literals (B1), `not (` (B2), XPath 2.0 syntax passed through as `success` (P1). On Android XPath 2.0 is the default, so the input grammar is larger | Scanner, CLI, report, strategy markers 1:1; the converter core parses XPath into an AST and converts a whitelisted subset; anything else is a skip with a reason |
| 5 | Not covered | `classNameMatches` makes `findElements` iterate `index(0..n)` instead of `instance` (`ByUiAutomatorFinder.matchDescendantElements`); `instance(n)` makes `findElements` return one element | Rules in section 3; `classNameMatches` is never emitted (Decision 3: skip) |
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
  the pinned tag), an edge case, and an oracle result on the emulator before the converter implements it.
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

Order of languages follows the real-world corpus (stage 2, [`frequencies.md`](audit/corpus/frequencies.md)), project-weighted:
Java 30 % (6 projects), Python 25 % (5), TypeScript 20 % (4), JavaScript and Kotlin 10 % (2 each), C# 5 % (1).
Strategy calls to rewrite, by frequency: `@AndroidFindBy(xpath =`, `MobileBy.XPATH` / `AppiumBy.XPATH` (Python),
`By.xpath(` / `AppiumBy.xpath(` (Java), `By.XPath(` (C#), `findElementByXPath(`, `"xpath"` (WebdriverIO-style
`findElement`); about a third are bare strings.

## 3. Rules

Confirmed against the sources in stage 1: every rule cites rows of [`reference/`](reference/README.md),
and the full list with expected output is the edge cases in [`audit/spec/cases.js`](audit/spec/cases.js).
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
- `matches()` converts exactly with a wrapper that turns PsychoPath's `find()` into a whole-string match
  (XP-03); patterns that match `""` are skipped.

Stage 3 ran all 132 edge cases of the time on four LocatorLab screens ([summary](audit/device/results/s-summary.md);
134 since stage 4b added H11 and H12):
every exact case gave the same elements in the same order, except the two documented gaps of XPath
(nodes below level 70, the toast). Corrections: `//*` is exact (`new UiSelector()`; the root is never
returned), `@text=1` and `contains(text(),…)` fail on the device, `$` in a name test is a parse error.
`(?i)` is ICU and folds Unicode letters: `lower-case` agreed, `upper-case` and `translate` did not.

| XPath | `UiSelector` | Class |
| --- | --- | --- |
| `//T`, `@class="T"` | `className("T")` | exact; `$` in `T`: skip; `android.view.View`: close |
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

## 4. Reference, edge cases and real-world locators

**Reference** (`reference/`, short quotes with links, Apache-2.0 / EPL sources): each row has an id.

- `uia2-server.md`: engine choice, XML dump (attributes, null omission, tag rewriting, non-XML chars,
  toast and multi-window roots), `UiAutomatorParser` (statements, literals), `ByUiAutomatorFinder`
  (`instance`, `CLASS_REGEX`, dedupe), lookup settings.
- `uiselector-api.md`: every `UiSelector` method of the bundled androidx version, with its matching rule.
- `xpath.md`: the PsychoPath functions and operators that real locators use; XPath 1.0 differences.

**Edge cases (S, synthetic).** Generated from the reference: at least one case per row, plus literal edge cases
(quotes, `\n`, `\`, `$`, `%s`, non-ASCII, empty). Each case has the expected class and a hand-written
`UiSelector`. `npm run spec:check` fails if a reference row has no case. Expected size ≈150; 134 in the end.

**Real-world locators (R).** Done in stage 2: 20 open-source projects with Android Appium tests, large and weak, in
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

- **Edge-case mode:** fixed screens with traps (duplicates at several depths, nested matches, null vs. empty,
  all booleans, deep chain, two windows / toast).
- **Fuzz mode:** for the real-world locators, random screens built from the literals of each batch of locators (≈5 screens per
  batch, ≈500 locators): ≈1–2 h in the background, replaces the iOS mini-WDA fuzz. Done in 4b
  ([summary](audit/device/results/r-fuzz-summary.md)): batches of ≈143 (a screen must fit one 128 KB
  `am start` argument), 40 screens, 33 min; reported by XPath form as well as by count; forms with at most 2
  XPaths ran on 3 more seeds. Mutants (18 kinds of wrong UiSelector) showed the random traps caught only 62 %, so
  every item also ran on a matrix screen that breaks every tested condition every way: 99.5 % of the mutants
  killed (the 9 survivors are equivalent on those screens), still 0 WRONG. The mutants also found that
  `textMatches` / `descriptionMatches` compile with DOTALL: `matches()` without `s` now emits `(?-s:…)` (H11).
- Lookup time is recorded on every run (free data, not a benchmark).

**Scoring** as on iOS: correct (CORRECT), correctly skipped (CORRECT-SKIP), close match (DRIFT, documented,
0.5), wrong (WRONG), missed (GAP). Real-world score = 100 × (correct + 0.5 × close match) / converted; edge cases
per category; conversion rate = converted / real Android literals. Release needs 0 wrong and 0 missed on the edge
cases (the expected `UiSelector`s were proven on the device first).

## 6. Stages

One branch and one PR per stage, into `main`. Share is of the 5-hour window.

| # | Stage | Result | Estimate |
| --- | --- | --- | --- |
| 0 | Scaffold and carry-over | package (bin, files, engines, keywords, short npm README), CI, `docs/environment.md`, `docs/settings.md` (all settings with defaults, from the driver docs and the server's `model/settings/`), scanner / CLI / report / strategy markers with their tests, ported to Android detection | ≈45 min, ≈9 % |
| 1 | Reference and edge cases | `reference/` excerpts at the pinned tags, edge cases with expected `UiSelector`, `spec:check` | ≈75 min, ≈15 % |
| 2 | Real-world corpus | ~10 projects, extraction, anonymization, `sources.md`, form and language frequencies | ≈60 min, ≈12 %; done: 20 projects, ≈4 MB downloaded, no clone |
| 3 | Oracle | LocatorLab spike and screens, runner, edge cases on the emulator: every expectation confirmed or corrected (no converter yet) | ≈90 min, ≈18 %; done: [`audit/device/`](audit/device/README.md), ≈0 MB downloaded |
| 4 | Converter | AST parser (whitelist), `UiSelector` emitter, strategy rewrite, unit tests; loop until the edge cases have 0 wrong / 0 missed; real-world fuzz run in the background | ≈2.5 h, ≈30 %; 4a done (no device): `lib/xpath.js`, `lib/converter.js`, `lib/literal.js`, edge cases 132/132 (`npm run spec:score`), real-world locators offline in [`convert-summary.md`](audit/corpus/convert-summary.md); 4b done: real-world fuzz on the emulator, 1142 XPaths (91 forms) on 40 random and 100 matrix screens, 0 wrong, 0 with nothing matched, mutants 99.5 % killed, score 96.6, conversion rate 71.1 %, one converter fix (`matches()` and DOTALL; edge cases H11, H12 added, 134/134) |
| 5 | Report and release | `audit/coverage-report.md`, README with limits and settings, `docs/reference.md`, Claude skill, upstream watch; npm publish after your OK | ≈60 min, ≈12 %; done except publish: [coverage report](audit/coverage-report.md), short README (the npm page) with details in [docs/reference.md](docs/reference.md) and [docs/results.md](docs/results.md), skill in `.claude/skills/xpath-to-uiselector/` (not published separately), deterministic upstream watch (no LLM, [audit/upstream/](audit/upstream/README.md)), version 1.0.0, `private` removed, `npm pack --dry-run` 13 files / 31.7 kB. Release review (no device): every number, name and link checked against its source, plain terms in the docs, [docs/how-it-works.md](docs/how-it-works.md) with diagrams, GitHub repository description and 12 topics |
| 6 | Second Android version (Backlog) | the edge cases and the matrix slice of the real-world fuzz on another Android version, compared pair by pair with API 36 | ≈1 h, ≈15 %; done 2026-10-21 on the Google Play AVD already on the host (`Medium_Phone_API_37.0`, Android 17), no download, chosen instead of an older API: same verdicts (edge cases 76 confirmed / 50 xpath only / 5 differ as warned / 3 nothing matched; matrix 1065 correct, 77 close, 0 wrong), only bounds moved; 7 other differences explained, none from the OS ([compare-api37.md](audit/device/results/compare-api37.md)); `--out` in `run.js` and `fuzz.js`, `audit/device/compare.js`; no converter change. Older APIs (33, 30) not run |

Total ≈8 h, under two windows. Stages 1 and 2 are independent and can swap. Fixes found by the real-world fuzz
go into stage 4, not into a separate round.

## Backlog

In order:

1. npm publish of 1.0.0 (prepared in stage 5, waits for the user's OK); then the npm badge in the README.
2. Coverage of skipped forms: the real-world skips ([convert-summary.md](audit/corpus/convert-summary.md), 475
   unique, 28.9 %) are the list for later converter work. Most reasons have no exact `UiSelector` at all (direct
   child, `/hierarchy/` paths, attributes without a criterion), but some could get a close form or a rewrite hint.
   New edge cases generated from `reference/` for them, run on the emulator first, as in stages 1–3.
3. Optional: a real phone, the edge cases and a slice of the real-world fuzz on a physical Android device (AC power,
   Low Power Mode off), as the iPhone check on iOS; another OEM build. An older Android version (API 33 or 30,
   ≈550–670 MB image) only if a reason comes up: Android 17 already matched Android 16.

## Decisions (2026-10-20)

1. Converter core on an AST (change 4): accepted as recommended. The scanner, CLI and report stay 1:1.
2. The strategy call is rewritten together with the string (section 2): yes.
3. Close forms (`childSelector`, `classNameMatches`): decided after stage 3, when the oracle shows
   which are exact. Stage 3: neither is exact for `findElements`; both return the XPath's first
   element. Decided 2026-10-20: `//A//B` → `childSelector` close (5.5 % of the real-world locators); `classNameMatches`
   skip (≈0 % of them, `findElements` lost most elements); `lower-case` → `(?i)` close (agreed on the
   device; one-to-many case folds unchecked); `upper-case`, `translate` skip; `//android.view.View`
   stays close.
4. Web / WebView XPaths in scanned files: the user's responsibility (change 8).
5. Default driver settings only, documented in `docs/settings.md` (change 9).
