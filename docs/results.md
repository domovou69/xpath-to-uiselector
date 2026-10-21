# Results

Checked against the UiAutomator2 server's own code first, then on an Android emulator: every expected `UiSelector`
was proven on the device before the converter was written. Method, data and what the device does not check:
[audit/coverage-report.md](../audit/coverage-report.md).

| | |
| --- | --- |
| Edge cases (S) | 134 of 134 correct, 0 wrong, 0 gaps (`npm run spec:score`) |
| Real locators (R), 20 open-source projects | 1142 converted XPaths (91 forms) on random and trap screens: **0 wrong**; score 96.6 of 100, where a close form counts half |
| Real locators converted (C) | 71.1 % of 1645 Android XPath literals (exact 63.6 %); most skips have no exact `UiSelector` at all |
| Strength of the check | 99.5 % of 1718 deliberately wrong `UiSelector`s were caught by the same screens |
| Checked with | Appium 3.8.0, appium-uiautomator2-driver 8.7.0, UiAutomator2 server 10.6.6, androidx uiautomator 2.3.0; Android 16 emulator (API 36); default settings |

Older and newer versions were not checked. A monthly job ([audit/upstream/](../audit/upstream/README.md)) opens an
issue when a new driver or server release changes a file the rules cite.

## By language (R corpus, offline)

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
