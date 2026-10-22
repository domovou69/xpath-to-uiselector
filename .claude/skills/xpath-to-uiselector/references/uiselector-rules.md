# UiSelector rules

Condensed from the engine's `docs/reference.md`. Pinned stack: Appium 3.8.0, appium-uiautomator2-driver 8.7.0,
UiAutomator2 server 10.6.6, androidx `UiSelector` 2.3.0, default settings. Every exact rule was proven on an
Android 16 emulator with `findElements`: same elements, same order (and again on Android 17, with the same results).

## Syntax the server accepts

- `new UiSelector()` followed by `.method(arg)` calls. Arguments: `"string"`, `true` / `false`, an integer, or a
  nested `new UiSelector()…` for `childSelector`.
- In a string the only escape is `\"` → `"`. A backslash stays as written, and a value ending in `\` cannot be
  written. So a value with `"` or `\` goes into a `…Matches` regex as `\x22` / `\x5c`.
- One value per method: a second `.text(…)` replaces the first. Two tests on one attribute → one regex with
  lookaheads.
- Order the engine emits: `className`, criteria in XPath order, `instance`, `childSelector`.

## Exact

| XPath | UiSelector |
|---|---|
| `//android.widget.Button`, `@class="…"` | `className("android.widget.Button")` |
| `//*` | `new UiSelector()` |
| `@text="v"` / `@content-desc="v"` / `@resource-id="v"` / `@package="v"` | `text` / `description` / `resourceId` / `packageName` `("v")` |
| `@checked="true"` (and `checkable`, `clickable`, `enabled`, `focusable`, `focused`, `long-clickable`, `scrollable`, `selected`), `not(@checked="true")` | `checked(true)`, `checked(false)` |
| `@index="2"` | `index(2)` |
| `contains(@text,"v")` / `starts-with` / `ends-with` | `textMatches("(?s).*v.*")` / `"(?s)v.*"` / `"(?s).*v"`, metacharacters escaped |
| `@text="A" or @text="B"`, `@text=("A","B")`, `//*[@text="A"] \| //*[@text="B"]` | `textMatches("A\|B")` |
| `contains(@text,"a") and contains(@text,"b")` | `textMatches("(?s)(?=.*a)(?=.*b).*")` |
| `matches(@text,"p")`, `matches(@text,"p","i")` | `textMatches("(?d)(?s:.*)(?-s:p)(?s:.*)")`, `(?i-s:p)` with `i` |
| `(//X)[n]`, `(//X)[position()=n]` | `….instance(n-1)` (pre-order = document order) |
| `(//A//B)[1]` | `A.instance(0).childSelector(B.instance(0))` (`[2]` and later: no, `instance` counts within each A) |
| `[@text]`, `[@checked]`, `[@index]` | dropped (written on every element) |
| `[@content-desc]`, `[@resource-id]`, `[@content-desc!=""]` | `descriptionMatches("(?s).*")`, `resourceIdMatches("(?s).+")`, `descriptionMatches("(?s).+")` |
| `.//X`, `/hierarchy//X`, `//descendant::X`, `concat("a","b")`, `@text eq "v"` | as the plain form |
| `@text='Say "hi"'`, `@text="C:\T"` | `textMatches("Say \x22hi\x22")`, `textMatches("C:\x5cT")` |

Never emit `textContains` / `textStartsWith` / `descriptionContains` / `descriptionStartsWith`: they lower-case both
sides.

## Close (converted with a warning)

| XPath | UiSelector | Difference |
|---|---|---|
| `//A//B` | `A.childSelector(B)` | Same first element; `findElements` returns at most one B per A |
| `//android.view.View…` | `className("android.view.View")` | The page source also writes nodes with no class name as `android.view.View` |
| `lower-case(@text)="ok"` | `textMatches("(?i)ok")` | ICU `(?i)`; one-to-many folds (`İ`, `ß`) not checked |
| a runtime value (`%s`, `{0}`, `${x}`, `" + x + "`) in a value | kept; `\Q…\E` inside a regex | A runtime value with `"`, `\` or `\E` breaks the locator |
| `//${cls}`, `@index='$i'`, `(//X)[${i}]` | `className("${cls}")`, `index($i)`, `instance(${i - 1})` | The value must be a class name / whole number; the position is rewritten minus one only where the string syntax computes it |
| `[@text!=""]` | `textMatches("(?s).+")` | The XPath also finds range widgets (their text exists only in the page source) |

## No exact UiSelector

| XPath | Why |
|---|---|
| `//A/B` | No direct-child criterion (`childSelector` searches all descendants) |
| `//X[2]`, `//X[@a="v"][1]`, `last()`, `position()<3` | No position among siblings; `instance` counts across the whole screen |
| `/hierarchy/android.widget.FrameLayout/…` | Absolute path from the page source root (copied from Appium Inspector) |
| `[.//B]` | No has-descendant filter |
| `..`, `parent::`, `ancestor::`, `following-sibling::`, `preceding-sibling::` | Not converted; `fromParent` searches the parent's whole subtree (the `hint` says so) |
| `(//A//B)[2]`, `(//A)[n]//B` | `instance` inside `childSelector` counts within each A; agrees only when one A matches |
| `@label`, `@value`, `@id`, `data-*` | Web or iOS attributes: not in the Android page source |
| `not(contains(@text,…))`, `@text!="v"` | No negation for strings |
| `@text="A" or @content-desc="A"`, unions of different attributes or paths | No `or` across criteria; `;`-joined statements return results in statement order, not document order |
| `contains(@class,…)`, `//Button \| //ImageButton` | `classNameMatches` makes `findElements` iterate `index(i)` and lose elements |
| `upper-case()`, `translate()` | Do not fold the Kelvin sign; `(?i)` does |
| `@text=""`, `contains(@text,"")` | Every element without text has `text=""` in the page source; `text("")` needs a non-null text |
| `@text="50.0"` | Range widgets (SeekBar, ProgressBar) expose their value as text in the page source only |
| `@text=1` | Numeric comparison: fails on non-numeric text, matches `1.0` |
| `text()`, `contains(text(),…)` | The page source has no text nodes |
| `@bounds`, `@displayed`, `@password`, `@hint`, … | No criterion |
| `@name`, `@resourceId`, `@contentDescription` | Not page source attributes (aliases for `getAttribute` only): the XPath matches nothing |
| `//android.widget.Toast` | Toasts exist only in the page source |
| `normalize-space()`, `string-length()`, `substring()` | No criterion |

## Device facts

- Default settings only. `enforceXPath1` (XPath 1.0: `ends-with`, `matches`, `lower-case` fail as XPath),
  `allowInvisibleElements`, `ignoreUnimportantViews`, `enableMultiWindows`, `snapshotMaxDepth` change what XPath sees.
- XPath finds nothing below level 70 of the page source; `UiSelector` has no depth limit, so it can find more.
- Neither finds invisible elements at the defaults. `UiSelector` searches the active window only.
- `instance(n)` makes `findElements` return that one element, as `(//X)[n+1]` does.
- Lookup speed: `UiSelector` was faster than XPath in 30 of 30 benchmark cases (49 % at 100 elements, 12 % at 2000).
