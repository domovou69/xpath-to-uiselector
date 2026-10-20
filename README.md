# xpath-to-uiselector

[![CI](https://github.com/domovou69/xpath-to-uiselector/actions/workflows/test.yml/badge.svg?branch=main)](https://github.com/domovou69/xpath-to-uiselector/actions/workflows/test.yml)

Converts Appium XPath locators in your Android tests to UiAutomator2 `UiSelector` locators
(`-android uiautomator`), and refuses to convert the ones that have no exact `UiSelector`.

**Status: in development, not published.** The converter passes every synthetic case proven on the
emulator (`npm run spec:score`); the fuzz run over real locators is next. See [PLAN.md](PLAN.md).

Why: on the same screens `UiSelector` was faster than XPath in 30 of 30 cases (49 % at 100 elements,
12 % at 2000), and XPath finds nothing deeper than 70 levels
([benchmark](https://github.com/domovou69/appium-android-locator-benchmark)). The iOS counterpart is
[xpath-to-class-chain](https://github.com/domovou69/xpath-to-class-chain).

## Usage (from a clone)

```bash
node xpath-to-uiselector.js ./tests            # preview, writes nothing
node xpath-to-uiselector.js ./tests --write    # save it
node xpath-to-uiselector.js ./tests --json     # report with every skip
```

The path can be a folder or a single file. Every XPath in the scanned files is a candidate, web XPaths
included, so point it at your Android tests and review the preview. Requires Node.js 20 or newer; no
dependencies.

A converted locator is written only together with its strategy: `AppiumBy.xpath(…)` becomes
`AppiumBy.androidUIAutomator(…)`, `@AndroidFindBy(xpath = …)` becomes `uiAutomator = …`, Python
`AppiumBy.XPATH` becomes `ANDROID_UIAUTOMATOR`, and so on. A JS/TS string with no call around it becomes a
WebdriverIO selector (`android=new UiSelector()…`). Strings in other languages with no strategy call, data
files, and calls with no UiAutomator form (Selenium `@FindBy`, `findElementByXPath`) are left as they are;
the report shows their `UiSelector`. Runtime parts (`${x}`, `%s`, `{0}`, `" + x + "`) are kept, with a
warning.

## Limits

- Results hold for the default UiAutomator2 settings: [docs/settings.md](docs/settings.md).
- Versions checked: [docs/environment.md](docs/environment.md).

## License

MIT
