# Results

Checked against the UiAutomator2 server's own code first, then on an Android emulator: every expected `UiSelector`
was proven on the device before the converter was written. Method, data and what the device does not check:
[audit/coverage-report.md](../audit/coverage-report.md); the process as diagrams and the short labels of the audit
files (S, R, C, DRIFT, …): [how-it-works.md](how-it-works.md).

| | |
| --- | --- |
| Edge cases, written from the server and androidx sources | 150 of 150 correct (98 converted as expected, 52 correctly skipped), 0 wrong, 0 missed (`npm run spec:score`) |
| Real-world locators, 20 open-source projects | 1169 converted XPaths (95 forms) on random and matrix screens: **0 wrong**; score 96.6 of 100, where a close match counts half |
| Conversion rate | 72.9 % of 1645 Android XPath literals (exact 63.5 %); most skips have no exact `UiSelector` at all, and 347 of the 446 skips come with a rewrite hint |
| Strength of the check | 99.5 % of 1718 deliberately wrong `UiSelector`s (mutants) were caught by the matrix screens (before the skipped-form coverage) |
| Checked with | Appium 3.8.0, appium-uiautomator2-driver 8.7.0, UiAutomator2 server 10.6.6, androidx uiautomator 2.3.0; Android 16 emulator (API 36), and Android 17 (API 37) for the 134 edge cases and the matrix slice of the real-world fuzz before the skipped-form coverage, with the same results ([compare-api37.md](../audit/device/results/compare-api37.md)); default settings |

Android versions older than 16, real phones and other stack versions were not checked. A monthly job ([audit/upstream/](../audit/upstream/README.md)) opens an
issue when a new driver or server release changes a file the rules cite.

## By language (real-world locators, offline)

| Language | Literals | Exact | Close | Skip |
| --- | --- | --- | --- | --- |
| Java | 384 | 55.2 % | 2.9 % | 41.9 % |
| Kotlin | 135 | 73.3 % | 1.5 % | 25.2 % |
| Python | 646 | 64.7 % | 15.0 % | 20.3 % |
| C# | 194 | 96.4 % | 0.0 % | 3.6 % |
| TypeScript | 199 | 53.3 % | 18.6 % | 28.1 % |
| JavaScript | 87 | 29.9 % | 4.6 % | 65.5 % |

Top skip reasons: no direct-child criterion (6.7 % of all literals), absolute `/hierarchy/…` paths (4.7 %), web or
iOS attributes such as `@label` and `@id` (4.7 %). Full list: [convert-summary.md](../audit/corpus/convert-summary.md).

## Speed

Not measured here. The [benchmark](https://github.com/domovou69/appium-android-locator-benchmark) found
`UiSelector` faster than XPath in 30 of 30 cases (49 % at 100 elements, 12 % at 2000), and XPath finds nothing
deeper than 70 levels.
