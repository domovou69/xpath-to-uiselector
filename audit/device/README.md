# Device oracle

The UiAutomator2 server on the emulator decides whether an XPath and a `UiSelector` select the same
elements (PLAN.md section 5). Nothing here re-implements XPath or `UiSelector` matching.

| File | What |
| --- | --- |
| [LocatorLab/](LocatorLab/) | Android app. One activity renders a screen from JSON; every node is a generic view whose accessibility node carries the class name, resource id, text, content-desc, package, the booleans and a range value from JSON, so any locator's values render without a rebuild |
| [screens.js](screens.js) | S-mode screens: `attrs`, `tree`, `deep`, `windows` |
| [run.js](run.js) | The runner: every S case on every screen, `findElements` by XPath and by `UiSelector`, lists compared by fingerprint and order |
| [spike.js](spike.js) | The stage 3 spike: does the server report the accessibility-node values in the page source and to `UiSelector` |
| [wd.js](wd.js) | Plain-HTTP WebDriver client, launcher, host / device / stack versions |
| [results/](results/) | `spike.json`, `s-run.json` (every lookup, with times and versions), `s-summary.md` |

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
```

A screen is passed to the app as base64 JSON in an intent extra
(`am start -S -n io.github.domovou69.locatorlab/.LabActivity --es b64 …`); the app logs
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

## Findings outside the S cases (2026-10-20)

- An app cannot set the package of its own accessibility nodes: the framework overwrites it after the
  delegate. `@package` cases (A07, C07) run with LocatorLab's package in place of `com.example.app`.
- A second window (`PopupWindow` on the `windows` screen) is in neither result with the default
  settings. With `enableMultiWindows=true` it is in the page source and the XPath finds it, the
  `UiSelector` does not ([settings.md](../../docs/settings.md) marks the setting as *Result*).
- `(?i)` in a `UiSelector` regex folds Unicode letters (Android regexes are ICU): the Kelvin sign
  matches `k`.
- Lookup times (`findElements`, screens of 12–200 nodes): median 24 ms for XPath, 28 ms for
  `UiSelector`, 95th percentile about 80 ms for both; recorded per lookup in `s-run.json` (not a
  benchmark).
