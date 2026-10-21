# Device oracle

The UiAutomator2 server on the emulator decides whether an XPath and a `UiSelector` select the same
elements (PLAN.md section 5). Nothing here re-implements XPath or `UiSelector` matching.

| File | What |
| --- | --- |
| [LocatorLab/](LocatorLab/) | Android app. One activity renders a screen from JSON; every node is a generic view whose accessibility node carries the class name, resource id, text, content-desc, package, the booleans and a range value from JSON, so any locator's values render without a rebuild |
| [screens.js](screens.js) | S-mode screens: `attrs`, `tree`, `deep`, `windows` |
| [run.js](run.js) | The runner: every S case on every screen, `findElements` by XPath and by `UiSelector`, lists compared by fingerprint and order |
| [fuzz-screens.js](fuzz-screens.js) | R fuzz screens: a cell of targets and near misses per converted R literal, built from its XPath; 5 screens per batch, seeded; matrix cells that break every tested condition every way |
| [fuzz.js](fuzz.js) | The R fuzz runner: every converted R literal on every screen of its batch (`--rare`: rare forms on more seeds, `--matrix`: its matrix screen), `--mutants` (wrong UiSelectors that the screens must catch), verdicts by XPath and by form, R and C |
| [spike.js](spike.js) | The stage 3 spike: does the server report the accessibility-node values in the page source and to `UiSelector` |
| [wd.js](wd.js) | Plain-HTTP WebDriver client, launcher, host / device / stack versions |
| [results/](results/) | `spike.json`, `s-run.json` (every lookup, with times and versions), `s-summary.md`; `r-fuzz-screens.json` (the generated screens), `r-fuzz.json`, `r-fuzz-summary.md` |

## Run

Versions: [docs/environment.md](../../docs/environment.md). Only on AC power with Low Power Mode off
(the scripts refuse otherwise), one emulator, headless.

```sh
emulator -avd AOSP_API_36 -no-window -no-snapshot-load -no-boot-anim -no-audio &
export ANDROID_HOME=~/Library/Android/sdk JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home"
(cd audit/device/LocatorLab && ./gradlew --offline assembleDebug)
adb install -r audit/device/LocatorLab/app/build/outputs/apk/debug/app-debug.apk
npm run appium &          # local Appium 3.8.0 + uiautomator2 driver 8.7.0 (devDependencies)
npm run oracle            # or: node audit/device/run.js --resume | --only A01,E01 | --screens tree | --summary
npm run oracle:fuzz       # or: node audit/device/fuzz.js --resume [--rare | --matrix] [--mutants] | --batch 0,1 | --only <key> | --generate | --summary
```

A screen is passed to the app as base64 JSON in an intent extra
(`am start -S -n io.github.domovou69.locatorlab/.LabActivity --es b64 …`, written to the device shell's stdin,
since adb refuses a long command line; one argument is still limited to 128 KB); the app logs
`LocatorLab: ready <name>` once it has drawn, shown the popup and the toast.

## Outcomes

Per case and screen: `EQUAL`, `ORDER_DIFFERS`, `SET_DIFFERS`, `UISEL_ERROR`, `XPATH_ERROR`, and
`XPATH_ONLY` for skip cases (no `UiSelector`; only the XPath runs). Some skip cases carry a **probe**:
the naive `UiSelector` a converter without the skip rule would emit, compared the same way, so the
skip is shown on the device too.

Known differences are named in the summary instead of counted as a difference: **DEPTH** (the
`UiSelector` also finds elements below the 70-level page source limit, every XPath element is among
its results in the same order) and **TOAST** (the XPath also returns the toast, which only the page
source has).

Fingerprint of an element: `class|resource-id|text|content-desc|bounds`. Every node of a LocatorLab
screen has its own bounds, except a node and a child that fills it; the boxes of the deep chain get
their own resource ids for that reason.

## Findings of the R fuzz (stage 4b, 2026-10-21)

- `textMatches` and `descriptionMatches` compile their regex with `Pattern.DOTALL`; `resourceIdMatches`,
  `classNameMatches` and `packageNameMatches` with no flags (androidx `UiSelector.java` 2.3.0, lines 131, 242).
  The reference said "no flags" for all five. Consequence: a `matches()` pattern without the `s` flag must turn
  DOTALL off, `(?-s:…)`, or `.` also crosses a line break the XPath's does not (S case H11; the old form found
  `Line 1\nLine 2`, the XPath did not). Found by the `(?s) dropped` mutants, which survived on text.
- A `View.INVISIBLE` view is not in the accessibility tree at all, so it is neither counted in `@index` nor a
  hidden match for `instance`. A view with no size is in the tree but not visible to the user: both sides leave it
  out of the results and both count it in `@index` (SRV-10, SEL-09). The matrix screens use the latter.
- `adb shell` refuses a long command line; the screen goes through the device shell's stdin. One `exec`
  argument is still limited to 128 KB, which caps a screen at ≈100 KB of base64.

## Findings outside the S cases (2026-10-20)

- An app cannot set the package of its own accessibility nodes: the framework overwrites it after the
  delegate. `@package` cases (A07, C07) run with LocatorLab's package in place of `com.example.app`.
- A second window (`PopupWindow` on the `windows` screen) is in neither result with the default
  settings. With `enableMultiWindows=true` it is in the page source and the XPath finds it, the
  `UiSelector` does not ([settings.md](../../docs/settings.md) marks the setting as *Result*).
- `(?i)` in a `UiSelector` regex folds Unicode letters (Android regexes are ICU): the Kelvin sign
  matches `k`.
- Lookup times are recorded per lookup in `s-run.json` (`xpath.ms`, `ui.ms`, `probe.ui.ms`). They
  are a side product, one cold lookup each on small screens, not a benchmark (that is the
  [benchmark](https://github.com/domovou69/appium-android-locator-benchmark)'s job). Paired on the
  same case: the `UiSelector` was faster in 65 of 86 pairs on `attrs`, 55 on `tree`, 61 on `windows`,
  but only 10 of 86 on `deep`, where it walks below level 70 and XPath does not. `findElements` with
  more than 20 matches: median 60 ms for XPath, 243 ms for `UiSelector`, because the server runs
  one `instance(i)` search per element (SRV-31).
