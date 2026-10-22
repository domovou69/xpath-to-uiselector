# xpath-to-uiselector

[![CI](https://github.com/domovou69/xpath-to-uiselector/actions/workflows/test.yml/badge.svg?branch=main)](https://github.com/domovou69/xpath-to-uiselector/actions/workflows/test.yml)

Converts Appium XPath locators in your Android tests to UiAutomator2 `UiSelector` locators
(`-android uiautomator`), and refuses to convert the ones that have no exact `UiSelector`.
`UiSelector` was faster than XPath in 30 of 30 benchmark cases and has no 70-level depth limit
([benchmark](https://github.com/domovou69/appium-android-locator-benchmark)).

## Try it

Nothing to install. The bare command only previews; review the diff, then add `--write`.

```bash
npx xpath-to-uiselector ./tests            # preview
npx xpath-to-uiselector ./tests --write    # save it
npx xpath-to-uiselector ./tests --json     # report with every skip and warning
```

Point it at your Android Appium tests (Java, Kotlin, Python, JS/TS, C#, Ruby, JSON, YAML…). Node.js 20+, no
dependencies. The strategy call is rewritten together with the string:

```diff
- AppiumBy.xpath("(//android.widget.TextView[@content-desc='price'])[2]")
+ AppiumBy.androidUIAutomator("new UiSelector().className(\"android.widget.TextView\").description(\"price\").instance(1)")

- (AppiumBy.XPATH, '//*[@content-desc="Cart" and contains(@text, "USD")]')
+ (AppiumBy.ANDROID_UIAUTOMATOR, 'new UiSelector().description("Cart").textMatches("(?s).*USD.*")')

[skip] UiSelector has no direct-child criterion: //android.widget.ListView/android.widget.TextView[1]
```

## What it does

- **Converts** what has an exact `UiSelector`: attributes, booleans, `@index`, `contains()` / `starts-with()` /
  `ends-with()` / `matches()`, `or` on one attribute, `(//X)[n]`, `(//A//B)[1]`, existence tests such as `[@text]`.
- **Warns** where only a close form exists, such as `//A//B` → `childSelector`.
- **Skips** the rest with a reason, and most with a `hint` on how to rewrite it by hand: direct child `//A/B`, sibling
  positions, `/hierarchy/…` paths, parent and sibling axes, and more.

Checked on 1645 real Android XPaths from 20 open-source projects: 73 % convert, and every converted one (1169
distinct XPaths) ran on an Android emulator with **0 wrong** results.

## Limits

- Exact for the **default** UiAutomator2 driver settings only ([settings](docs/settings.md)).
- Web and WebView XPaths are not detected: point it at Android tests only.
- Runtime values (`%s`, `{0}`, `${x}`) that contain `"` or `\` break the `UiSelector` (warned); `(//X)[${i}]` becomes
  `instance(${i - 1})` only where the string syntax can compute it.

## Future of `UiSelector`

Google plans to [deprecate and remove](https://developer.android.com/training/testing/other-components/ui-automator-legacy#ui-automator)
`UiSelector` from UiAutomator, and the [UiAutomator2 driver](https://github.com/appium/appium-uiautomator2-driver)
warns that this will make every `-android uiautomator` locator invalid. No date or version is set yet (UiAutomator
2.4.0, July 2026, still ships it), and the driver's server bundles UiAutomator 2.3.0, so today's locators keep
working until Appium moves to a version without it. Appium has not announced a replacement:
[appium-uiautomator2-driver#812](https://github.com/appium/appium-uiautomator2-driver/issues/812) is open. XPath
locators are not affected. The monthly [upstream watch](audit/upstream/README.md) reports any change to that issue.

## Documentation

- [Reference](docs/reference.md): examples per language, every conversion rule, flags, JSON report, library API
- [How it works](docs/how-it-works.md): diagrams of the converter, how it was checked, and the monthly upstream watch
- [Results](docs/results.md): scores, versions checked, the [coverage report](audit/coverage-report.md)
- [Claude Code skill](.claude/skills/xpath-to-uiselector/SKILL.md): runs the converter and reviews the skips

iOS counterpart: [xpath-to-class-chain](https://github.com/domovou69/xpath-to-class-chain).

## License

MIT
