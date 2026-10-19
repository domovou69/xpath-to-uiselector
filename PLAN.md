# Plan — xpath-to-uiselector

Converts Appium XPath locators in Android tests to UiAutomator2 `UiSelector` locators
(`-android uiautomator`), and refuses to convert the ones that have no exact `UiSelector`.

Started 2026-10-20. Follow-up to:

- [xpath-to-class-chain](https://github.com/domovou69/xpath-to-class-chain): the same tool for iOS. Its
  scanner, report, CLI and audit method are the template.
- [appium-android-locator-benchmark](https://github.com/domovou69/appium-android-locator-benchmark):
  `UiSelector` was faster than XPath in 30 of 30 cases (49 % at 100 elements, 12 % at 2000), and XPath
  finds nothing deeper than 70 levels (`snapshotMaxDepth`). That is the reason to build this.

## Principles

- **Exact or skip.** A locator is converted only when the `UiSelector` selects the same element. Forms
  that are only close are converted with a warning (as `(//X)[n]` on iOS) and listed as such; everything
  else is skipped with a reason.
- **Sources, then the device.** Every rule cites the line in the pinned UiAutomator2 server / androidx
  `uiautomator` sources it relies on. Where the device disagrees with a rule, the device wins.
- **Pinned versions.** Appium, the uiautomator2 driver and server, the emulator image and the app build
  are recorded in `docs/environment.md`, like in the benchmark. Results are valid for those versions.
- **No runtime dependencies**, Node 20+, the same as xpath-to-class-chain. Audit scripts may use
  devDependencies (Appium, an XPath engine).

## 1. What carries over from xpath-to-class-chain

| Part | Decision |
| --- | --- |
| `walkDir`, symlink / UTF-8 / ignore-dir rules, `--write` / `--json` / `--quiet`, report shape, `STATUS` | 1:1 |
| Quote/bracket-aware tokenizer, union splitter, `maskQuotedValues`, grouped `(…)[n]` unwrapping, `concat()` folding, literal escaping | 1:1, then tests re-pointed at Android examples |
| Explicit XPath strategy markers per language (`lib/strategy.js`) | Reused to **find** the call; here the call is rewritten too (section 2) |
| Platform detection | Inverted: iOS locators (`XCUIElementType*`, `ios:` key) are skipped, Android ones are converted |
| Predicate → NSPredicate rewrite, validator, optimizer | Replaced: a `UiSelector` builder, a validator for existing `new UiSelector()` strings, and a small optimizer (method order, duplicate merge) |
| Element type table (`elementTypes.js`) | Replaced: no closed list on Android; class names are taken as written |
| Audit layout (`corpus/`, `harness/`, `device/`, `coverage-cases.json`, verdicts and scoring) | Same structure and the same verdict names |
| Claude skill folder, npm packaging, upstream watch | Same, at the end |

## 2. Input and output

**Input** is a path (file or folder). The scanner finds quoted strings that look like XPath and carry an
Android signal (`android.`, `@resource-id`, `@content-desc`, `@text`, `@class`, `/hierarchy`, …).

Formats, in order of work (to be re-ordered by what the R corpus actually contains, stage 2):

1. Java, Kotlin (java-client: `AppiumBy.xpath`, `By.xpath`, `MobileBy.xpath`, `@AndroidFindBy(xpath = …)`)
2. Python (`(AppiumBy.XPATH, …)`, `find_element(By.XPATH, …)`)
3. JS / TS (WebdriverIO `$('//…')`, `{ xpath: … }`, `findElement('xpath', …)`)
4. C#, Ruby, then data files (JSON, YAML, `.properties`, `.feature`)

**Output depends on the place.** On iOS a plain string could just get the `-ios class chain:` prefix. On
Android most suites name the strategy in code, so changing only the string breaks the locator. The
converter rewrites the strategy and the string together where it recognizes the call:

| Where | Before | After |
| --- | --- | --- |
| WebdriverIO string | `$('//android.widget.Button[@text="OK"]')` | `$('android=new UiSelector().className("android.widget.Button").text("OK")')` |
| java-client | `AppiumBy.xpath("…")`, `By.xpath("…")`, `MobileBy.xpath("…")` | `AppiumBy.androidUIAutomator("…")` |
| Page Factory | `@AndroidFindBy(xpath = "…")` | `@AndroidFindBy(uiAutomator = "…")` |
| Python | `(AppiumBy.XPATH, "…")`, `find_element(By.XPATH, "…")` | `(AppiumBy.ANDROID_UIAUTOMATOR, "…")` |
| Ruby, C# | `find_element(:xpath, …)`, `MobileBy.XPath(…)` | `:uiautomator`, `MobileBy.AndroidUIAutomator(…)` |
| Data files, unknown calls | any | not changed; listed in the report with the `UiSelector` it would be (`skipped_unknown_strategy`) |

The quotes inside the `UiSelector` are escaped for the host language (`\"` in Java / Kotlin / C#).
Selenium 3 helpers (`find_element_by_xpath`, `findElementByXPath`) have no `UiSelector` twin and are
report-only. Existing `new UiSelector()` strings are validated (balanced quotes and parentheses, known
methods) but not rewritten.

## 3. Conversion rules: exact / close / skip

A first draft from the benchmark and from what UiAutomator2 is known to do. Stage 1 confirms each row in
the pinned sources (and fills in the full attribute list); stage 5 confirms it on the device. Rows marked
"verify" are the ones most likely to move.

| XPath form | `UiSelector` | Class | Notes |
| --- | --- | --- | --- |
| `//T` | `className("T")` | exact | the tag is the class name in UiA2's XML; check tag sanitizing (`$`, inner classes) |
| `@text="v"`, `contains(@text,"v")`, `starts-with(@text,"v")` | `text`, `textContains`, `textStartsWith` | exact | verify `""` vs. a missing text |
| the same on `@content-desc`, `@resource-id`, `@class`, `@package` | `description*`, `resourceId`, `className`, `packageName` | exact | `resourceId` has no Contains / StartsWith: use `resourceIdMatches` with an escaped literal |
| `contains(@class,"v")` and other `*Contains` without a method | `…Matches("(?s).*<escaped v>.*")` | exact | Java `matches()` is a full match and `.` skips `\n` without `(?s)` |
| `@checked`, `@checkable`, `@clickable`, `@enabled`, `@focusable`, `@focused`, `@long-clickable`, `@scrollable`, `@selected` = `"true"`/`"false"` | the boolean method | exact | `not(@x="true")` → `x(false)` only if the attribute is always present (verify) |
| `@index="n"` | `index(n)` | verify | both should read the same child index |
| `[a and b]` on different attributes | chained methods | exact | |
| two conditions on the **same** attribute | one `…Matches` regex, or skip | verify | `UiSelector` keeps one value per attribute: a second `textContains` replaces the first |
| `@x="a" or @x="b"` (same attribute) | `xMatches("a\|b")`, escaped | exact | |
| `or` across attributes, unions of different paths | — | skip | `;`-joined selectors exist in the server parser, but the order of results differs |
| `(//X)[n]` | `instance(n-1)` | close, maybe exact | `instance` counts in traversal order; exact if that equals document order (verify) |
| `//X[n]` (position among siblings) | — | skip | no per-parent position |
| `(//X)[last()]`, `position()`, `count()` | — | skip | |
| `//A//B` | `A.childSelector(B)` | close | `childSelector` semantics with several matching `A` need the device |
| `//A/B` (direct child), `//A[.//B]` (has descendant) | — | skip | no child-only or has-descendant filter in `UiSelector` |
| sibling / parent / ancestor / following axes | — | skip | `fromParent` is a candidate for later, after device checks |
| absolute paths `/hierarchy/android.widget.FrameLayout/…` | — | skip, reason "absolute path" | expected to be common in weak projects (Inspector output); the report suggests a stable attribute when the element has one |
| `text()` | — | skip | UiA2's XML has no text nodes, so the XPath matches nothing (verify) |
| `translate(@text,"A…Z","a…z")="v"` | `textMatches("(?i)…")` | verify | Java `(?i)` is ASCII-only by default, like `translate` with ASCII alphabets |
| `normalize-space()`, `string-length()`, `not()` on text, numeric comparisons | — | skip | |
| XPath 2.0 functions (`ends-with`, `matches`, `lower-case`) | — | skip, reason "invalid XPath 1.0" | if the server's engine is XPath 1.0, the original locator throws already (verify) |

Generated regexes escape every metacharacter one by one (no `\Q…\E`: a literal `\E` would end it).
Deep trees: XPath sees nothing below depth 70, `UiSelector` does. Such cases are listed as a known,
favourable difference, not as wrong.

## 4. Locator groups R and S

**S (synthetic edge cases).** Written by hand, about 120 cases in categories like iOS: attributes,
booleans, string functions, logic, positions, paths and descendants, literals and escaping (quotes,
`\n`, `$`, `\`, backticks, non-ASCII), regexes and case, unions, absolute paths, `not()`, invalid XPath.
Each case has an expected class (exact / close / skip) and, where it converts, the expected `UiSelector`.

**R (real locators).** No own corpus, so R is mined from about 10 open-source projects on GitHub:

- **Large**: real apps or well-kept sample suites (Appium / WebdriverIO / Sauce Labs / BrowserStack demo
  test suites, open-source apps with an Appium Android suite).
- **Weak**: student and tutorial projects, framework starters, suites with Inspector-generated absolute
  paths. They are where XPath is most often used badly, and the tool should handle them.
- Selection: Android XPath present, at least ~20 locators, a license that allows quoting (MIT, Apache,
  BSD; others only if the locators are anonymized and the repo is only referenced), last commit noted.
- Search: `gh search code` for `AppiumBy.xpath("//android`, `@AndroidFindBy(xpath`, `AppiumBy.XPATH`,
  `$('//android.widget`, `/hierarchy/android.widget`, by language; then a shallow, sparse clone of the
  test folders only (no full app checkouts on the hotspot).
- Storage: `audit/corpus/android-locators.json` with the same fields as iOS (`id`, `kind`, `quote`,
  `source`, `count`) plus the project id; literals anonymized as on iOS, structure untouched;
  `audit/corpus/sources.md` lists repo, commit, license and how many locators each gave. Target: 400+
  unique locators, no project above ~25 % of the total.
- The scanner is also run on the untouched project folders (scanner tests per language, like
  `audit/corpus/contexts/` on iOS).

## 5. Test app and the two-level check

**Test app** `LocatorLab` (Android), built from the benchmark's `ScaleActivity`: screens rendered from
JSON assets, so a new edge case is a JSON entry, not new Kotlin. View-based first; one Compose screen
later (testTag → `resource-id`). Screens: duplicates at different depths (instance vs. document order),
nested matching containers (`childSelector`), empty vs. missing text and description, `\n` and non-ASCII
text, all boolean states, a list, a chain deeper than 70 levels, both platform keys in one page object.

**Level 1, host (fast, no device).** Unit tests in `npm test` (every rule row, every skip reason, the
scanner per language). Plus a harness: page sources in UiA2's XML format (generated from each locator's
own literals and classes, ~200 per locator, like iOS), the XPath evaluated by an XPath 1.0 engine of the
same family as the server's, and the `UiSelector` evaluated by a matcher transcribed from the pinned
androidx `UiSelector` / server code. It compares result sets and the first element, and fuzzes R.

**Level 2, device (ground truth).** Appium + the emulator (`AOSP_API_36`, headless, AC power, no Low
Power Mode). For every S case and a sample of R adapted to the app screens: run the XPath and the
`UiSelector`, compare the elements (attribute fingerprint, as in the benchmark). Outcomes as on iOS
(`EQUAL`, `SET_DIFFERS`, `FIRST_DIFFERS`, `XPATH_ONLY`, `UISEL_ERROR`, …). Level 1 must agree with Level 2
on every S case; a disagreement fixes the matcher before any number is published.

**Scoring** as on iOS: verdicts CORRECT, CORRECT-SKIP, DRIFT (documented: 0.5), WRONG, GAP;
R = 100 × (CORRECT + 0.5 × DRIFT) / expressible, S per category, C = converted / real. Release needs
0 WRONG.

## 6. Stages

Each stage is one branch and one PR into `main`. Estimates are for one person-session with Claude; the
share is of the 5-hour window.

| # | Stage | Result | Estimate |
| --- | --- | --- | --- |
| 0 | Scaffold | `package.json`, CLI skeleton, tests runner, CI, `docs/environment.md`, carried-over modules with tests | ≈40 min, ≈8 % |
| 1 | Semantics from sources | `docs/semantics.md`: server parser, XPath engine, XML attributes, `UiSelector` matching at the pinned versions; section 3 table confirmed or corrected | ≈60 min, ≈12 % |
| 2 | R corpus | ~10 projects chosen, locators extracted and anonymized, `sources.md`, frequency of forms and formats | ≈75 min, ≈15 %, downloads ≈100–300 MB |
| 3 | Converter core | exact rules, skips with reasons, close forms with warnings, validator, unit tests | ≈2 h, ≈25 % |
| 4 | Scanner and strategy rewrite | per-language call rewrite, report, CLI flags, scanner tests on the R project folders | ≈90 min, ≈18 % |
| 5 | Test app and device runner | LocatorLab-Android, S matrix on the emulator (Gradle build and runs in the background) | ≈2 h, ≈25 % |
| 6 | Host harness and report | Level 1 harness, R and S scores, `audit/coverage-report.md` | ≈90 min, ≈18 % |
| 7 | Fix round | fixes from stages 5–6, re-runs | 1–2 sessions, unknown until 6 |
| 8 | Release | README, `docs/reference.md`, Claude skill, npm publish (after your OK), upstream watch | ≈60 min, ≈12 % |

Total without stage 7: ≈11–12 h, about 2.5 windows. The order can change: stage 2 first is possible if
the frequencies should drive stage 1.

## Open questions

1. Rewrite the strategy call together with the string (section 2), or skip such locators as on iOS?
   Recommended: rewrite, otherwise most Java / Python suites get nothing.
2. Close forms (`instance`, `childSelector`): convert with a warning, as on iOS, or skip unless
   `--allow-close`? Recommended: as on iOS, until the device shows they are exact or wrong.
