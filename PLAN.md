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
| 8 | Not covered | Mixed web/mobile repos: Selenium or WebView XPaths (`//div`, `//button`, `text()`) must not be touched | Android signal required (section 2) |
| 9 | Not covered | Conversions are exact only for default driver settings (`enforceXPath1`, `allowInvisibleElements`, `ignoreUnimportantViews`, `enableMultiWindows`, `snapshotMaxDepth`, `normalizeTagNames`) | Settings recorded in `docs/environment.md`; limits section in the README |
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
  from the server's catalog, emulator image, default settings.
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

**Input** is a path. The scanner finds quoted strings that look like XPath **and** carry an Android
signal: a dotted class step (`android.widget.*`, `androidx.*`, any `a.b.C` tag), `/hierarchy`, or an
UiA2 attribute (`@resource-id`, `@content-desc`, `@class`, `@package`, `@clickable`, …). A bare `//div`,
`//*[text()=…]` with no other signal, and `ios:` values are left alone (web / WebView / iOS).

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

Order of languages follows the R corpus frequencies (stage 2); Java, Kotlin, Python, JS/TS first.

## 3. Rules (draft, confirmed by stage 3)

Facts below are from the server sources at v10.6.6; rows marked **oracle** depend on device behaviour.

| XPath (server default: XPath 2.0) | `UiSelector` | Class |
| --- | --- | --- |
| `//T` | `className("T")` | exact, unless `T` was rewritten by the dumper (`$ @ # &` → `.`, `normalizeTagNames`): skip such names |
| `@text`, `@content-desc`, `@resource-id`, `@class`, `@package` with `=`, `contains`, `starts-with` | `text`/`textContains`/`textStartsWith`, `description*`, `resourceId`, `className`, `packageName` | exact. A null attribute is not written to the XML at all, and `UiSelector` fails on null: oracle for `=""` |
| `ends-with`, `contains` where no method exists, `matches(@a, p)` | `…Matches("(?s)…")`, metacharacters escaped one by one | exact for literals; `matches()` with flags or XSD-only syntax: oracle or skip |
| `lower-case(@a)="v"`, `upper-case`, `translate` with ASCII alphabets | `…Matches("(?i)…")` | oracle (Java `(?i)` is ASCII-only by default) |
| `@a=("x","y")`, `@a="x" or @a="y"` | `…Matches("x\|y")`, escaped | exact |
| 9 booleans: `checkable`, `checked`, `clickable`, `enabled`, `focusable`, `focused`, `long-clickable`, `scrollable`, `selected` | the method | exact |
| `@index="n"` | `index(n)` | oracle |
| other ~40 attributes (`bounds`, `displayed`, `hint`, `password`, `a11y-*`, `input-type`, …) | — | skip: no `UiSelector` method |
| `and` across attributes | chained methods | exact |
| two conditions on one attribute | one `…Matches` with lookaheads, or skip | `UiSelector` keeps one value per criterion; oracle |
| `or` across attributes, unions of different paths | — | skip (`;` statements are concatenated per selector then deduped: not document order) |
| `(//X)[n]` | `instance(n-1)` | oracle; `findElements` returns only that one, as XPath does |
| `//X[n]`, `last()`, `position()`, `count()` | — | skip |
| `//A//B` | `childSelector` | oracle; skip if it differs |
| `//A/B`, `[.//B]`, sibling/parent/ancestor axes | — | skip (`fromParent` only if the oracle shows an exact case) |
| `/hierarchy/…` absolute paths | — | skip, reason "absolute path"; counted in the report |
| `text()` | — | skip: the dump has no text nodes, the XPath matches nothing (oracle) |
| `classNameMatches` in the output | — | warning: `findElements` iterates `index(0..n)` with it, not `instance` |
| Literals: a value ending in `\`, or `\` before `"` | — | skip: the server unescapes only `\"` |
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

**R (real).** About 10 open-source projects with Android Appium tests, large and weak (tutorials,
starters, Inspector-generated absolute paths). Search with `gh search code` (`AppiumBy.xpath("//android`,
`@AndroidFindBy(xpath`, `AppiumBy.XPATH`, `$('//android.widget`, `/hierarchy/android`); sparse clone of
test folders only. `audit/corpus/android-locators.json` (anonymized literals, same fields as iOS plus
project), `audit/corpus/sources.md` (repo, commit, license, count). Target 400+ unique locators, no
project above ~25 %. The untouched files also serve as scanner tests.

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
| 0 | Scaffold and carry-over | package (bin, files, engines, keywords, short npm README), CI, `docs/environment.md`, scanner / CLI / report / strategy markers with their tests, ported to Android detection | ≈45 min, ≈9 % |
| 1 | Reference and S | `reference/` excerpts at the pinned tags, S cases with expected `UiSelector`, `spec:check` | ≈75 min, ≈15 % |
| 2 | R corpus | ~10 projects, extraction, anonymization, `sources.md`, form and language frequencies | ≈60 min, ≈12 %; downloads ≈100–300 MB |
| 3 | Oracle | LocatorLab spike and screens, runner, S run on the emulator: every S expectation confirmed or corrected (no converter yet) | ≈90 min, ≈18 %; Gradle build and runs in the background |
| 4 | Converter | AST parser (whitelist), `UiSelector` emitter, strategy rewrite, unit tests; loop until S has 0 WRONG / 0 GAP; R fuzz run in the background | ≈2.5 h, ≈30 % |
| 5 | Report and release | `audit/coverage-report.md`, README with limits and settings, `docs/reference.md`, Claude skill, upstream watch; npm publish after your OK | ≈60 min, ≈12 % |

Total ≈8 h, under two windows. Stages 1 and 2 are independent and can swap. Fixes found by the R fuzz
go into stage 4, not into a separate round.

## Open questions

1. Converter core on an AST instead of copying the class-chain string logic (change 4). This departs
   from "logic almost 1:1". Recommended: yes; the scanner, CLI and report stay 1:1.
2. Rewrite the strategy call together with the string (section 2). Recommended: yes, otherwise most
   Java / Python suites get nothing.
3. Close forms (`childSelector`, `classNameMatches`): convert with a warning, as on iOS, or skip unless
   `--allow-close`. Recommended: decide after stage 3, when the oracle shows which are exact.
