# Device oracle

The UiAutomator2 server on the emulator decides whether an XPath and a `UiSelector` select the same
elements (PLAN.md section 5). Nothing here re-implements XPath or `UiSelector` matching. Two kinds of runs: the edge
cases (S cases, `run.js`) and the real-world locators (R fuzz, `fuzz.js`); the short labels in their summaries are
explained in [docs/how-it-works.md](../../docs/how-it-works.md#terms).

| File | What |
| --- | --- |
| [LocatorLab/](LocatorLab/) | Android app. One activity renders a screen from JSON; every node is a generic view whose accessibility node carries the class name, resource id, text, content-desc, package, the booleans and a range value from JSON, so any locator's values render without a rebuild |
| [screens.js](screens.js) | Edge-case screens: `attrs`, `tree`, `deep`, `windows`, `nest` |
| [run.js](run.js) | The edge-case runner: every case on every screen, `findElements` by XPath and by `UiSelector`, lists compared by fingerprint and order |
| [fuzz-screens.js](fuzz-screens.js) | Real-world fuzz screens: a cell of targets and near misses per converted real-world literal, built from its XPath; 5 screens per batch, seeded; matrix cells that break every tested condition every way |
| [fuzz.js](fuzz.js) | The real-world fuzz runner: every converted literal on every screen of its batch (`--rare`: rare forms on more seeds, `--matrix`: its matrix screen), `--mutants` (wrong UiSelectors that the screens must catch), verdicts by XPath and by form, R and C |
| [spike.js](spike.js) | The stage 3 spike: does the server report the accessibility-node values in the page source and to `UiSelector` |
| [compare.js](compare.js) | Compares two runs pair by pair (outcome, counts, fingerprints with and without bounds), e.g. API 36 against API 37; no device |
| [wd.js](wd.js) | Plain-HTTP WebDriver client, launcher, host / device / stack versions |
| [results/](results/) | `spike.json`, `s-run.json` (every lookup, with times and versions), `s-summary.md`; `r-fuzz-screens.json` (the generated screens), `r-fuzz.json`, `r-fuzz-summary.md`; the same with `-api37` from Android 17, and `compare-api37.md` |

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

Another device or Android version writes its own files with `--out <name>` (`s-run-<name>.json`,
`r-fuzz-<name>.json` and their summaries; the fuzz screens are shared), and `node audit/device/compare.js --out
<name>` compares them with the API 36 runs. With another Appium already on port 4723 (e.g. an iOS run), start this
one with `npx appium --port 4724` and set `APPIUM_URL=http://127.0.0.1:4724`. The Android 17 run:

```sh
emulator -avd Medium_Phone_API_37.0 -no-window -no-snapshot-load -no-boot-anim -no-audio &
node audit/device/run.js --resume --out api37
node audit/device/fuzz.js --resume --matrix --out api37
node audit/device/compare.js --out api37
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

## Findings of the skipped-form coverage (2026-10-21)

- `instance` inside a `childSelector` counts within each container, not across them: `getChildSelector()` returns a
  copy (androidx `UiSelector.java` 2.3.0, lines 618–621), taken anew for every container that matches (SEL-14).
  `(//ListView//TextView)[5]` with the fifth TextView in the second ListView: the probe
  `ListView.instance(0).childSelector(TextView.instance(4))` found nothing (E10). Only `(//A//B)[1]` converts.
- The server looks for `instance` only on the outer selector (`ByUiAutomatorFinder.doesUiSelectorHaveAttribute`, SRV-35):
  without `instance(0)` on the outer selector, `findElements` with `A.childSelector(B.instance(0))` returned 3
  elements where the XPath has 1 (E09 probe). `instance(0)` changes nothing in matching.
- `nest` screen: every case, the 134 old ones too, ran on it; nothing changed for the old cases. The new
  real-world conversions (27 XPaths) ran on a new random batch (`b8`) and new matrix screens (`m20`): 0 wrong, 0 with
  nothing matched. One XPath (`[@content-desc and matches(…)]`) has no screens: the screen builder does not read
  `matches()`; edge case A26 covers its existence part.

## Findings on Android 17 (2026-10-21)

The edge cases and the matrix slice of the real-world fuzz ran on `Medium_Phone_API_37.0` (Android 17, Google
Play image) and were compared with Android 16 by [compare.js](compare.js): [compare-api37.md](results/compare-api37.md).

- Same verdicts everywhere: edge cases 76 confirmed, 50 xpath only, 5 differ as warned, 3 nothing matched; matrix
  1065 correct, 77 close matches, 0 wrong, 0 with nothing matched.
- Bounds move: x never, but the app window is 63 px taller and every row 3–11 px taller, so elements further down
  shift more. Element lists agree once bounds are left out.
- 7 other differences, none from the OS. P04 on four screens: the base pairs were recorded before `run.js` ran the
  probe of exact cases. P04 and H04 on `windows`: the toast was still in the page source in the base run and gone
  here; right after the screen appears Android 17 finds it too. Two matrix items: the base read one attribute of the
  last element empty once; rerun on Android 16 on the same screen ([r-fuzz-api36check.json](results/r-fuzz-api36check.json))
  it reads as on Android 17. Both lookups share one fingerprint read, so such a misread cannot make a WRONG.

## Findings of the real-world fuzz (stage 4b, 2026-10-21)

- `textMatches` and `descriptionMatches` compile their regex with `Pattern.DOTALL`; `resourceIdMatches`,
  `classNameMatches` and `packageNameMatches` with no flags (androidx `UiSelector.java` 2.3.0, lines 131, 242).
  The reference said "no flags" for all five. Consequence: a `matches()` pattern without the `s` flag must turn
  DOTALL off, `(?-s:…)`, or `.` also crosses a line break the XPath's does not (edge case H11; the old form found
  `Line 1\nLine 2`, the XPath did not). Found by the `(?s) dropped` mutants, which survived on text.
- A `View.INVISIBLE` view is not in the accessibility tree at all, so it is neither counted in `@index` nor a
  hidden match for `instance`. A view with no size is in the tree but not visible to the user: both sides leave it
  out of the results and both count it in `@index` (SRV-10, SEL-09). The matrix screens use the latter.
- `adb shell` refuses a long command line; the screen goes through the device shell's stdin. One `exec`
  argument is still limited to 128 KB, which caps a screen at ≈100 KB of base64.

## Findings outside the edge cases (2026-10-20)

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
  same case (the 84 exact and close cases of the current `s-run.json`): the `UiSelector` was faster in 63
  of 84 pairs on `attrs`, 53 on `tree`, 63 on `windows`, but only 14 of 84 on `deep`, where it walks
  below level 70 and XPath does not. `findElements` with more than 20 matches: median 60 ms for XPath,
  243 ms for `UiSelector`, because the server runs one `instance(i)` search per element (SRV-32).
