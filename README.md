# xpath-to-uiselector

[![CI](https://github.com/domovou69/xpath-to-uiselector/actions/workflows/test.yml/badge.svg?branch=main)](https://github.com/domovou69/xpath-to-uiselector/actions/workflows/test.yml)

Converts Appium XPath locators in your Android tests to UiAutomator2 `UiSelector` locators
(`-android uiautomator`), and refuses to convert the ones that have no exact `UiSelector`.

**Status: in development, not published.** The scanner, the CLI and the report work; the converter
itself comes after the rules are proven on a device. See [PLAN.md](PLAN.md).

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

## Limits

- Results hold for the default UiAutomator2 settings: [docs/settings.md](docs/settings.md).
- Versions checked: [docs/environment.md](docs/environment.md).

## License

MIT
