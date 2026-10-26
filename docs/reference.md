# Reference

Everything about using xpath-to-uiselector beyond the [README](../README.md): commands, flags, what the scanner
rewrites, the conversion rules, the report format and library use. Every rule cites the rows of
[`reference/`](../reference/README.md) it comes from (`SRV-…` UiAutomator2 server, `SEL-…` androidx `UiSelector`,
`XP-…` PsychoPath XPath 2.0) and has an edge case in [`audit/spec/cases.js`](../audit/spec/cases.js) that ran on the
emulator ([how it was checked](how-it-works.md#2-how-it-was-built-and-checked)).

## Install and run

```bash
npx xpath-to-uiselector ./tests            # preview, writes nothing
npx xpath-to-uiselector ./tests --write    # save it in place
npx xpath-to-uiselector ./tests --json     # xpath-to-uiselector.report.json in the current folder

npm install -g xpath-to-uiselector         # then: xpath-to-uiselector ./tests
```

Node.js 20 or newer, no dependencies. The path is a folder or one file; with no path the preview scans `./tests`.

| Flag | Effect |
| --- | --- |
| `--dry-run` | Preview only, the default. Wins over `--write` |
| `--write` | Rewrite the files in place. Needs an explicit path. There is no undo: run it on a clean working tree and let `git diff` be the undo. Each file is written to a temporary file and renamed over the original, so an interrupted write leaves it whole |
| `--exact` | Change only locators converted with no warning. Close forms and runtime values are left as they are and reported with their `UiSelector` (`skipped_not_exact`) |
| `--loose` | Simpler, wider forms, each with a warning: see [Loose mode](#loose-mode). Off by default. `--exact` still leaves them alone |
| `--json` | Write `xpath-to-uiselector.report.json` in the current directory. Implies `--quiet` |
| `--quiet` | No per-match diff and banner; the summary still prints |
| `-h`, `--help` / `-V`, `--version` | Help / version |

An unknown flag is an error, so a typo such as `--wirte` does not silently preview.

Exit code: `0` done, `1` bad arguments or a missing path, `2` some files or folders could not be read or written.
They are printed on stderr as `[error]` and listed under `errors` in the JSON report; the rest of the tree is still
scanned. A file that is not valid UTF-8 and a symlink are skipped on purpose and do not count as errors.

## What it scans

- **Files:** `.js .mjs .cjs .ts .mts .cts .jsx .tsx .java .kt .kts .groovy .py .rb .cs .php .json .yaml .yml .xml
  .feature .properties .txt`. Never: `node_modules .git dist build .next coverage .cache .gradle`. Symlinks are not
  followed; a file that is not valid UTF-8 is left alone.
- **Strings:** quoted literals that start with `//`, `(//` or `/hierarchy` and carry an XPath signal (a predicate, a
  dotted class name step such as `android.widget.Button`), so URLs and comments stay untouched.
- **iOS:** a literal naming `XCUIElementType…` or under an `ios:` key of a dual-platform page object is skipped
  (`skipped_ios`).
- **Web XPaths are not detected.** A Selenium or WebView XPath such as `//div[@id="x"]` is converted like any other.
  Point the tool at your Android tests and review the preview; revert what is not Android.

### Strategy rewrite

A converted XPath is written only together with its strategy, because a `UiSelector` passed to an XPath strategy
fails at runtime.

| Client | Before | After |
| --- | --- | --- |
| Java / Kotlin, java-client | `AppiumBy.xpath("…")`, `MobileBy.xpath("…")` | `AppiumBy.androidUIAutomator("…")`, `MobileBy.AndroidUIAutomator("…")` |
| Java / Kotlin, Selenium `By` | `By.xpath("…")` | `AppiumBy.androidUIAutomator("…")` (or `MobileBy`, or `io.appium.java_client.AppiumBy` when the file names neither) |
| Page Factory | `@AndroidFindBy(xpath = "…")`, `@AndroidBy(xpath = "…")` | `uiAutomator = "…"` |
| Python | `(AppiumBy.XPATH, '…')`, `find_element(By.XPATH, '…')`, `find_element("xpath", '…')` | `AppiumBy.ANDROID_UIAUTOMATOR`, `'-android uiautomator'` |
| C# | `MobileBy.XPath("…")`, `By.XPath("…")`, `FindElement("xpath", "…")`, `[FindsByAndroidUIAutomator(XPath = "…")]` | `MobileBy.AndroidUIAutomator("…")`, `"-android uiautomator"`, `AndroidUIAutomator = "…"` |
| Ruby | `find_element(:xpath, '…')`, `find_element(xpath: '…')` | `:uiautomator`, `uiautomator:` |
| WebdriverIO | `$('//…')`, any JS/TS string with no call around it | `$('android=new UiSelector()…')` |
| WebdriverIO protocol | `findElement('xpath', '…')` | `findElement('-android uiautomator', '…')` |

Examples, as `--write` saves them:

```diff
// Java, java-client
- @AndroidFindBy(xpath = "//android.widget.Button[@text='Sign in']")
+ @AndroidFindBy(uiAutomator = "new UiSelector().className(\"android.widget.Button\").text(\"Sign in\")")
- AppiumBy.xpath("//*[@resource-id='com.shop:id/total' and contains(@text, 'USD')]")
+ AppiumBy.androidUIAutomator("new UiSelector().resourceId(\"com.shop:id/total\").textMatches(\"(?s).*USD.*\")")

# Python
- driver.find_element(AppiumBy.XPATH, f'//*[starts-with(@text, "{name}")]')
+ driver.find_element(AppiumBy.ANDROID_UIAUTOMATOR, f'new UiSelector().textMatches("(?s)\\Q{name}\\E.*")')
!   a runtime value goes into a regex (quoted with \Q…\E): a ", a \ or \E in it breaks the UiSelector
- (AppiumBy.XPATH, '//*[@resource-id="com.shop:id/list"]//android.widget.CheckBox')
+ (AppiumBy.ANDROID_UIAUTOMATOR, 'new UiSelector().resourceId("com.shop:id/list").childSelector(new UiSelector().className("android.widget.CheckBox"))')
!   findElements returns at most one match per container

// TypeScript, WebdriverIO
- $('//android.widget.Button[ends-with(@resource-id, ":id/checkout")]')
+ $('android=new UiSelector().className("android.widget.Button").resourceIdMatches("(?s).*:id/checkout")')

// C#
- MobileBy.XPath("//*[@text=\"Pay\" or @text=\"Pay now\"]")
+ MobileBy.AndroidUIAutomator("new UiSelector().textMatches(\"Pay|Pay now\")")

# Ruby
- find_element(:xpath, '//android.widget.Switch[@checked="false"]')
+ find_element(:uiautomator, 'new UiSelector().className("android.widget.Switch").checked(false)')
```

```text
[skip] UiSelector has no direct-child criterion: //android.widget.ListView/android.widget.TextView[1]
[skip] sibling axes are not converted: //*[@text="Saved"]/following-sibling::*
[skip] no strategy call around the string: use the UiSelector with the UiAutomator strategy where the string is used: //*[@text='%s']
       UiSelector: new UiSelector().text("%s")
```

Left as they are, with the `UiSelector` in the report: strings with no strategy call outside JS/TS
(`skipped_unknown_strategy`, e.g. a constant or a `String.format` result), data files, and calls whose client has no
UiAutomator strategy (`skipped_xpath_strategy`): Selenium `@FindBy(xpath = …)`, `How.XPATH`,
`findElementByXPath(…)`, `find_element_by_xpath(…)`, CodeceptJS `{ xpath: … }`, selenium-webdriver `By.xpath`,
appium_lib `xpath(…)`, PHP `WebDriverBy::xpath`. A JS/TS string whose name the same file joins with other text
(`LIST + '…'`, `` `${LIST}…` ``) is a base path, not a whole selector, and is left alone too
(`skipped_unsupported_logic`); a join in another file is not seen.

### Literals and runtime values

The scanner reads the literal as the language does (backslash escapes, Python raw strings, C# verbatim `@"…"`,
JSON) and writes the `UiSelector` back with the same quotes and escapes. If the result cannot be written in that
kind of literal, the locator is skipped (`skipped_validation_failed`).

Runtime parts are kept: `String.format` `%s` / `%d` / `%1$s`, `{0}` / `{name}` (C#, Python `format`, f-strings),
`${x}` / `$x` (JS, Kotlin, Groovy), `#{x}` (Ruby), and concatenation `"…" + x + "…"` when the pieces join inside
one predicate value. A runtime part in a value gets a warning: in a plain criterion a value with `"` or a trailing
`\` breaks the `UiSelector`; in a regex criterion it is quoted with `\Q…\E`, and a value with `"`, `\` or `\E`
breaks it. A runtime part outside a string literal (`[@index=" + i + "]` with a bare number, a class name, an
attribute name) is a skip.

## Conversion rules

**Exact** means the `UiSelector` finds the same elements in the same order as the XPath with `findElements`, at the
default settings. **Close** converts with a `warning` (printed with `!`, in the report, counted as "with warning").
**Skip** leaves the XPath as it is, with a `reason`.

### Steps and attributes

| XPath | UiSelector | Class | Rows |
| --- | --- | --- | --- |
| `//android.widget.Button`, `//*[@class="…"]` | `className("android.widget.Button")` | exact | SEL-01, SRV-03 |
| `//*` | `new UiSelector()` | exact: the page source root is never returned | SRV-02 |
| `//android.view.View` | `className("android.view.View")` | close: nodes without a class name are also `android.view.View` in the page source | SRV-03 |
| `@text="v"` | `text("v")` | exact | SEL-01 |
| `@content-desc="v"` | `description("v")` | exact; `@content-desc=""` → `description("")` | SEL-01, SRV-08 |
| `@resource-id="v"` | `resourceId("v")` | exact; a short id matches only a short id on both sides | SEL-01, SRV-07 |
| `@package="v"` | `packageName("v")` | exact | SEL-01, SRV-08 |
| `@checked`, `@checkable`, `@clickable`, `@enabled`, `@focusable`, `@focused`, `@long-clickable`, `@scrollable`, `@selected` `="true"/"false"`, `=true()` | `checked(true)` … | exact | SEL-04, SRV-09 |
| `not(@checked="true")` | `checked(false)` | exact | SRV-09 |
| `@index="2"`, `@index=2` | `index(2)` | exact: both count every child, invisible ones included | SEL-09, SRV-10 |
| `.//X`, `/hierarchy//X`, `//descendant::X` | as `//X` | exact | SRV-02, XP-01 |
| `[a][b]`, `[a and b]` | criteria in the order the XPath names them | exact | SEL-01 |
| `[@text]`, `[@checked]` (any of the nine booleans), `[@index]` | dropped | exact: written on every element, so always true | SRV-05, SRV-09, SRV-10 |
| `contains(@a,"")`, `starts-with(@a,"")`, `ends-with(@a,"")` | dropped | exact: true for every element | XP-02 |
| `@displayed="true"` | dropped | close: with the default settings the page source lists only displayed elements; with `allowInvisibleElements` on, the XPath leaves hidden elements out and the `UiSelector` does not. `@displayed="false"` matches nothing: skipped | SRV-11, SRV-12 |
| a union branch or an `or` side on a web or iOS attribute (`//*[@resource-id="a"] \| //*[@id="a"]`) | dropped | exact: the Android page source never has the attribute, so that branch matches nothing | XP-09 |
| `[@content-desc]`, `[@package]` | `descriptionMatches("(?s).*")`, `packageNameMatches("(?s).*")` | exact: written when non-null, `""` included | SRV-04, SRV-08 |
| `[@resource-id]`, `[@resource-id!=""]`, `[@content-desc!=""]` | `resourceIdMatches("(?s).+")`, `descriptionMatches("(?s).+")` | exact; an existence test next to another test on the same attribute is dropped | SRV-04, SRV-07 |
| `[@text!=""]` | `textMatches("(?s).+")` | close: a range widget (SeekBar, ProgressBar) has a text only in the page source, so the XPath also finds it | SRV-05, SRV-06 |
| `contains` / `starts-with` / `ends-with` on `@text` with a literal that can be part of a number (`"1.5"`, `"21"`, `".0"`) | `textMatches(…)` | close: same reason, a range widget at 1.5 or 21.5 has that text in the page source | SRV-06 |

Output order: `className`, then the criteria in XPath order, then `instance`, then `childSelector`.

### String functions and regexes

`textContains`, `textStartsWith`, `descriptionContains`, `descriptionStartsWith` are **case-insensitive** (SEL-02),
XPath's `contains()` and `starts-with()` are not, so the default mode never emits them ([Loose mode](#loose-mode)
does). String functions become a `…Matches`
regex (`textMatches`, `descriptionMatches`, `resourceIdMatches`, `packageNameMatches`), which must match the
whole value (SEL-03). Every regex metacharacter of the value is escaped; `(?s)` leads a regex that adds `.*`, so it
also crosses line breaks.

| XPath | UiSelector | Class | Rows |
| --- | --- | --- | --- |
| `contains(@text,"Total")` | `textMatches("(?s).*Total.*")` | exact | XP-02, SEL-03 |
| `starts-with(@text,"Total")` | `textMatches("(?s)Total.*")` | exact | XP-02 |
| `ends-with(@text,"USD")` (XPath 2.0) | `textMatches("(?s).*USD")` | exact | XP-02 |
| `@text="A" or @text="B"`, `@text=("A","B")`, `//*[@text="A"] \| //*[@text="B"]` | `textMatches("A\|B")` | exact | SEL-03, XP-06, XP-09 |
| two tests on one attribute: `contains(@text,"a") and contains(@text,"b")` | `textMatches("(?s)(?=.*a)(?=.*b).*")` | exact: one criterion per attribute, so lookaheads | SEL-05 |
| `matches(@text,"Total: \d+")` | `textMatches("(?d)(?s:.*)(?-s:Total: \d+)(?s:.*)")` | exact: PsychoPath's `find()` with `UNIX_LINES`, as a whole-string match; `.` stays off line breaks unless the `s` flag is given | XP-03, SEL-03 |
| `matches(@text,"^Total: \d+$")` | `textMatches("(?d)Total: \d+\n?")` | exact: anchored at both ends, `find()` is a whole-string match of the inside, and `$` also matches before a final `\n`; the `(?-s:…)` group stays only when the inside has a `.`; not with a `\|` outside a group or the `m` flag | XP-03, SEL-03 |
| `matches(@text,"total","i")` | `(?i-s:total)` inside the same wrapper | exact: ASCII case folding, as PsychoPath | XP-04 |
| `lower-case(@text)="ok"`, `contains(lower-case(@text),"ok")` | `textMatches("(?i)ok")`, `textMatches("(?s)(?i).*ok.*")` | close: ICU `(?i)` folds Unicode letters as `lower-case()` does; one-to-many folds (`İ`, `ß`) are not checked | XP-05 |
| `concat("Tot","al")` as a value | `text("Total")` | exact: folded | XP-01 |
| `normalize-space(@text)="To tal"` | `textMatches("[ \t\n\r]*To[ \t\n\r]+tal[ \t\n\r]*")` | exact: XML whitespace around the value and for each space in it; a value with leading, trailing or repeated whitespace matches nothing and is skipped | XP-10 |
| `string-length(@text)=5` | `textMatches("[\s\S]{5}")` | close on `@text` from 3 characters on (a range widget's value text such as `"10.25"`), exact below that and on the other attributes; one code point each, as XPath counts | XP-10, SRV-06 |
| `translate(@text,"ABC…Z","abc…z")="ok"` | `textMatches("[oO][kK]")` | exact: each character of the value as the class of the characters `translate()` maps to it, deleted characters as `[…]*` between them; the Kelvin sign is none of them | XP-05 |
| `if (C) then true() else false()`, `some $v in @a satisfies $v="OK"` | as `C`, as `@a="OK"` | exact; `then false() else true()` → `not(C)`; `every` is skipped (true without the attribute) | XP-11 |
| `@text eq "OK"` (XPath 2.0) | `text("OK")` | exact | XP-01 |

### Quotes and backslashes in values

The server's string literal unescapes only `\"`; a backslash stays as written, and a value ending in `\` cannot be
written (SRV-23). A value with `"` or `\` is therefore written as a regex with `\x22` / `\x5c`:

| XPath | UiSelector |
| --- | --- |
| `//*[@text='Say "hi"']` | `textMatches("Say \x22hi\x22")` |
| `//*[@text="C:\Temp\"]` | `textMatches("C:\x5cTemp\x5c")` |
| `//*[@text="a""b"]` (XPath 2.0 doubled quote) | `textMatches("a\x22b")` |
| `//*[@text="Price: $5"]`, `"%s"`, `"${name}"`, non-ASCII, a real line break | plain `text(…)`, value as is |

### Positions and paths

| XPath | UiSelector | Class | Rows |
| --- | --- | --- | --- |
| `(//X)[n]`, `(//X)[position()=n]` | `….instance(n-1)` | exact: `UiSelector` counts in pre-order, as XPath's document order, with the same visibility rule; `findElements` returns that one element | SEL-06, SEL-07, SEL-10, SRV-31 |
| `//A//B`, `//A/descendant::B` | `A.childSelector(B)` | close: the first element is the XPath's, but `findElements` returns at most one B per matched A | SEL-11 |
| `(//A//B)[1]`, `(//A/descendant::B)[1]` | `A.instance(0).childSelector(B.instance(0))` | exact: the first A that has a B, and its first B, is the first B in document order; `instance(0)` on A changes nothing in matching but makes `findElements` return one element (the server looks for `instance` only on the outer selector) | SEL-14, SRV-35 |

### Runtime values outside a literal

A runtime value standing alone where a name or a number goes. All three are close, with a warning that the value
must have the right shape.

| XPath | UiSelector | Note | Rows |
| --- | --- | --- | --- |
| `//${cls}[@text="OK"]`, `"//" + cls + "[…]"` | `className("${cls}").text("OK")` | the value must be the full class name | SRV-03 |
| `//X[@index='$i']` | `index($i)` | the value must be a whole number | SEL-09 |
| `(//X)[${i}]` | `instance(${i - 1})` | the host expression is rewritten minus one (`${this.index + 1}` → `${this.index}`) where the string syntax computes it: JS/TS `${}`, Kotlin `$i` / `${}`, Ruby `#{}`, Python f-strings, C# `$"{}"`. With `%d`, `.format()` or concatenation it is skipped with a hint | SEL-10 |

### Skipped, with the reason

| XPath | Why | Rows |
| --- | --- | --- |
| `//A/B` (direct child), `//X[n]` (position among siblings), `last()`, `position()<3` | `UiSelector` has no direct-child criterion and no sibling position | SEL-13, XP-08 |
| `(//A//B)[n]` with n ≥ 2, `(//A)[n]//B` | `UiSelector` counts `instance` within each container, so it agrees only when one A matches; `A.instance(n-1).childSelector(B)` returns one B and goes on to the next A | SEL-14 |
| `/hierarchy/…/X` (absolute path from Appium Inspector), `//hierarchy` | Absolute from the page source root; the root is not an element on screen | SRV-02 |
| `[.//B]`, `..`, `parent::`, `ancestor::`, `following-sibling::`, `preceding-sibling::` | No has-descendant filter; parent and sibling axes are not converted (`fromParent` searches the parent's whole subtree) | SEL-12, SEL-13 |
| `not(contains(@text,…))`, `@text!="x"` | No negation for strings | SEL-13 |
| `@text="A" or @content-desc="A"`, `@checked="true" or @selected="true"`, unions of different attributes or paths | No `or` across criteria (statements joined with `;` are deduplicated in statement order, not document order) | SEL-13, SRV-21 |
| `contains(@class,"Button")`, `//Button \| //ImageButton` | `classNameMatches` makes `findElements` iterate `index(i)` instead of `instance(i)` and loses elements | SRV-33 |
| `upper-case()` | It does not fold the Kelvin sign; `(?i)` does | XP-05 |
| `@text=""`, `string-length(@text)=0`, a test that holds for `""` | Every element without text has `text=""` in the page source; `text("")` needs a non-null text | SRV-05 |
| `@resource-id=""`, `@checked="TRUE"`, `@index="02"`, `@text="A" and @text="B"` | The XPath matches nothing (or always the same), so there is nothing to convert | SRV-07, SRV-09, SRV-10 |
| `@text="50.0"` (float-shaped) | A range widget's text in the page source is its value, not `getText()` | SRV-06 |
| `@text=1` (number) | A numeric comparison casts every text to a number: it fails on non-numeric text and also matches `1.0` | XP-06 |
| `text()`, `contains(text(),…)` | The page source has no text nodes | XP-07 |
| `@bounds`, `@password`, `@hint`, `@a11y-…` and ~40 more | No `UiSelector` criterion | SRV-11 |
| `@name`, `@resourceId`, `@contentDescription` | Aliases of `getAttribute`, not page source attributes: the XPath matches nothing | SRV-11 |
| `@label`, `@value`, `@id`, `@type`, `data-*`, `aria-*` … | Web or iOS attributes: the Android page source has none (a reason, not a filter; in a union or an `or` with Android tests the branch drops out) | SRV-11 |
| `//android.widget.Toast` | Toasts exist only in the page source | SRV-13 |
| `//com.app.Outer$Inner` | The XPath parser rejects `$` in a name test | SRV-03 |
| control characters in a value | Replaced in the page source | SRV-14 |
| `normalize-space()` without an argument, `substring()`, `every`, `if` with other branches than `true()` / `false()`, variables outside `some`, `matches()` with the `x` flag or an invalid flag | No `UiSelector` form, or the XPath itself fails | XP-01, XP-03, XP-11 |
| `matches()` with a pattern that matches `""` | XPath also matches elements without the attribute | XP-03 |
| syntax errors, anything outside the parser's whitelist | `not a valid XPath` / no `UiSelector` form | SRV-01 |

Most skips carry a `hint` (in the console and in the JSON report): how to rewrite the locator by hand, and how the
nearest `UiSelector` form differs. For example, `//A/B` → `A.childSelector(B)` finds deeper B too; `//X[n]` → `(//X)[n]`
counts over the whole screen; `X/..//Y` → `X.fromParent(Y)` searches the parent's whole subtree; `/hierarchy/…` →
locate the element by its resource id, text or content description; `text()` → `@text`; `@resourceId` →
`@resource-id`; an `or` across attributes → one lookup per side.

The full list of skip reasons with their frequencies on real projects: [convert-summary.md](../audit/corpus/convert-summary.md).

## Loose mode

The default mode converts only what finds the same elements as the XPath. `--loose` (library: `{ loose: true }`)
trades that for simpler, more tolerant locators. Every loose form is a close form with a warning, so `--exact` leaves
it alone and the JSON report lists it under `warnings`.

| XPath | Default | `--loose` | How it is wider |
| --- | --- | --- | --- |
| `contains(@text,"Total")` | `textMatches("(?s).*Total.*")` | `textContains("Total")` | ignores case: also finds "TOTAL" |
| `starts-with(@text,"Tot")` | `textMatches("(?s)Tot.*")` | `textStartsWith("Tot")` | ignores case |
| the same on `@content-desc` | `descriptionMatches(…)` | `descriptionContains(…)`, `descriptionStartsWith(…)` | ignores case |
| `//A/B` | skipped | `A.childSelector(B)` | any descendant B, not only a direct child; one match per container with `findElements` |
| `translate(@text,"A…Z","a…z")="ok"` | `textMatches("[oO][kK]")` | `textMatches("(?i)ok")` | also folds non-ASCII letters and the Kelvin sign |

`ends-with()` has no case-insensitive criterion and stays `textMatches`; so do a value with `"` or `\`, two tests
on one attribute, and `contains()` on `@resource-id` and `@package`. A direct child with a sibling position
(`//A/B[2]`) and absolute `/hierarchy/…` paths stay skipped. On the real-world locators `--loose` converts 76.7 %
instead of 73.2 % ([convert-summary.md](../audit/corpus/convert-summary.md#with---loose)).

## What the device showed

Two XPath gaps, both documented, not failures: XPath finds nothing below level 70 of the page source
(`snapshotMaxDepth`) while `UiSelector` does (SRV-12, SEL-08), so a converted locator can find **more** on very
deep screens; and the XPath also finds a toast while it is in the page source (SRV-13). Neither finds invisible
elements at the default settings (SRV-12, SEL-07). Details: [coverage-report.md](../audit/coverage-report.md).

## Limits

- **Default driver settings only.** `enforceXPath1`, `allowInvisibleElements`, `ignoreUnimportantViews`,
  `enableMultiWindows`, `snapshotMaxDepth`, `normalizeTagNames` and others change what XPath sees, so a conversion
  that is exact with the defaults may not be. Every setting with its default: [settings.md](settings.md).
- **XPath 2.0 is assumed.** The server evaluates XPath with PsychoPath (XPath 2.0) unless `enforceXPath1` is on. In
  XPath 1.0 mode `ends-with()`, `matches()`, `lower-case()` and sequences fail as XPath, but their conversions still
  work as `UiSelector`.
- **Web and WebView XPaths** are the user's responsibility: they are converted like Android ones.
- **Runtime values** with `"` or `\` break the `UiSelector` (warned); a runtime class name, index or position must
  have the right shape (warned).
- **Versions:** checked with Appium 3.8.0, appium-uiautomator2-driver 8.7.0, UiAutomator2 server 10.6.6, on
  Android 16 and 17 emulators ([environment.md](environment.md)).

## JSON report

`--json` writes `xpath-to-uiselector.report.json` in the current directory:

```json
{
  "mode": "dry-run",
  "exact": false,
  "path": "/abs/path/tests",
  "stats": { "filesScanned": 5, "locatorsFound": 13, "locatorsUpdated": 10, "warnings": 3,
             "skipped": { "ios": 0, "xpathStrategy": 0, "unknownStrategy": 1, "validationFailed": 0,
                          "unsupportedLogic": 2, "notXpath": 0, "noChangeNeeded": 0,
                          "notExact": 0 } },
  "updated": [
    { "file": "test_cart.py", "old": "//*[@resource-id=\"com.shop:id/list\"]//android.widget.CheckBox",
      "new": "new UiSelector().resourceId(\"com.shop:id/list\").childSelector(new UiSelector().className(\"android.widget.CheckBox\"))",
      "strategy": "AppiumBy.XPATH", "warning": "findElements returns at most one match per container" }
  ],
  "skipped": [
    { "file": "LoginPage.java", "locator": "//android.widget.ListView/android.widget.TextView[1]",
      "status": "skipped_unsupported_logic", "reason": "UiSelector has no direct-child criterion",
      "hint": "A.childSelector(B) is the closest form, but it also finds B deeper below A: …", "strategy": "AppiumBy.xpath(" },
    { "file": "LoginPage.java", "locator": "//*[@text='%s']", "status": "skipped_unknown_strategy",
      "reason": "no strategy call around the string: …", "uiselector": "new UiSelector().text(\"%s\")",
      "warning": "a runtime value goes into a string literal: a \" or a trailing \\ in it breaks the UiSelector" }
  ],
  "errors": [
    { "path": "/abs/path/tests/private", "error": "cannot read directory: EACCES" }
  ]
}
```

| Status | Meaning |
| --- | --- |
| `success` | Converted (in `updated`); `warning` when close |
| `skipped_unsupported_logic` | No exact `UiSelector`; `reason` says why, `hint` (when there is one) how to rewrite it by hand |
| `skipped_unknown_strategy` | Converted, but not written: no strategy call around the string; `uiselector` holds the result |
| `skipped_xpath_strategy` | Converted, but not written: the call's client has no UiAutomator strategy; `uiselector` holds the result |
| `skipped_not_exact` | Converted with a `warning`, not written because of `--exact`; `uiselector` holds the result |
| `skipped_validation_failed` | The `UiSelector` would not parse, or cannot be written in that kind of literal |
| `skipped_ios` | iOS locator |
| `skipped_not_xpath` | Not an XPath (listed in the report, not printed) |
| `skipped_no_change` | Nothing to change (counted only) |

## Library

```js
const { convertXpathToUiSelector, STATUS } = require('xpath-to-uiselector');

const r = convertXpathToUiSelector('(//android.widget.Button[@enabled="true"])[3]');
// r.status === STATUS.SUCCESS
// r.locator === 'new UiSelector().className("android.widget.Button").enabled(true).instance(2)'

convertXpathToUiSelector('//android.widget.ListView/android.widget.TextView');
// { status: 'skipped_unsupported_logic', reason: 'UiSelector has no direct-child criterion', locator: <the input>,
//   hint: 'A.childSelector(B) is the closest form, but it also finds B deeper below A: …' }

convertXpathToUiSelector('//*[contains(@text,"Total")]', { loose: true });
// { status: 'success', locator: 'new UiSelector().textContains("Total")', warning: 'loose: textContains … ignore case, …' }
```

`locator` is the bare `UiSelector` (no `android=` prefix and no source-language escaping). TypeScript declarations:
[xpath-to-uiselector.d.ts](../xpath-to-uiselector.d.ts). Also exported: `isLikelyXpathLocator`, `parseFlags`, `main`.

## Tests

```bash
npm test               # unit tests: converter, scanner, strategy rewrite, literals per language, CLI
npm run spec:check     # every reference row has an edge case
npm run spec:score     # the converter against every edge case; exit 1 on a wrong or missed answer
npm run corpus:convert # the real-world locators, offline (audit/corpus/convert-summary.md)
```

The device runs need an emulator and the local Appium (devDependencies): [audit/device/README.md](../audit/device/README.md).

## Claude Code skill

[`.claude/skills/xpath-to-uiselector/`](../.claude/skills/xpath-to-uiselector/SKILL.md) wraps the converter for
Claude Code. It runs the converter first (`scripts/convert.js`, read-only JSON), uses its `UiSelector`s as they are,
then explains each skipped locator and suggests a fix: a resource id or content description in the app, a different
single `UiSelector`, two lookups in test code, or keeping the XPath. To use it in another project, copy the folder to
`~/.claude/skills/` and install the package (`npm i -g xpath-to-uiselector`), or set `XPATH_TO_UISELECTOR_HOME` to a
clone of this repository.
