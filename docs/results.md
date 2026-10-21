# Results

Checked against the UiAutomator2 server's own code first, then on an Android emulator: every expected `UiSelector`
was proven on the device before the converter was written. Method, data and what the device does not check:
[audit/coverage-report.md](../audit/coverage-report.md); the process as diagrams and the short labels of the audit
files (S, R, C, DRIFT, …): [how-it-works.md](how-it-works.md).

| | |
| --- | --- |
| Edge cases, written from the server and androidx sources | 134 of 134 correct (84 converted as expected, 50 correctly skipped), 0 wrong, 0 missed (`npm run spec:score`) |
| Real-world locators, 20 open-source projects | 1142 converted XPaths (91 forms) on random and matrix screens: **0 wrong**; score 96.6 of 100, where a close match counts half |
| Conversion rate | 71.1 % of 1645 Android XPath literals (exact 63.6 %); most skips have no exact `UiSelector` at all |
| Strength of the check | 99.5 % of 1718 deliberately wrong `UiSelector`s (mutants) were caught by the matrix screens |
| Checked with | Appium 3.8.0, appium-uiautomator2-driver 8.7.0, UiAutomator2 server 10.6.6, androidx uiautomator 2.3.0; Android 16 emulator (API 36), and Android 17 (API 37) for the edge cases and the matrix slice of the real-world fuzz with the same results ([compare-api37.md](../audit/device/results/compare-api37.md)); default settings |

Android versions older than 16, real phones and other stack versions were not checked. A monthly job ([audit/upstream/](../audit/upstream/README.md)) opens an
issue when a new driver or server release changes a file the rules cite.

## By language (real-world locators, offline)

| Language | Literals | Exact | Close | Skip |
| --- | --- | --- | --- | --- |
| Java | 384 | 55.2 % | 2.9 % | 41.9 % |
| Kotlin | 135 | 73.3 % | 0.7 % | 25.9 % |
| Python | 646 | 64.4 % | 13.8 % | 21.8 % |
| C# | 194 | 96.4 % | 0.0 % | 3.6 % |
| TypeScript | 199 | 53.3 % | 10.6 % | 36.2 % |
| JavaScript | 87 | 29.9 % | 2.3 % | 67.8 % |

Top skip reasons: no direct-child criterion (6.3 % of all literals), an attribute without a criterion (4.8 %),
absolute `/hierarchy/…` paths (4.7 %). Full list: [convert-summary.md](../audit/corpus/convert-summary.md).

## Speed

Not measured here. The [benchmark](https://github.com/domovou69/appium-android-locator-benchmark) found
`UiSelector` faster than XPath in 30 of 30 cases (49 % at 100 elements, 12 % at 2000), and XPath finds nothing
deeper than 70 levels.
