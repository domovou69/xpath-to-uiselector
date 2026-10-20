# Environment

The versions every result in this repository is valid for. Recorded 2026-10-20 (stage 0). Device runs
(stage 3 onward) also record their versions in each result file. When a version here changes, the
affected results are re-run.

## Appium stack (pinned)

| Item | Version | Source |
| --- | --- | --- |
| `appium` | 3.8.0 | npm, local devDependency (not global) |
| `appium-uiautomator2-driver` | 8.7.0 | npm, local devDependency |
| UiAutomator2 server (`io.appium.uiautomator2.server`) | 10.6.6 | pinned by the driver; tag `v10.6.6` of `appium/appium-uiautomator2-server` |
| `androidx.test.uiautomator` | 2.3.0 | the server's `gradle/libs.versions.toml` at `v10.6.6` |
| XPath engine | PsychoPath XPath 2.0 (Eclipse WTP), vendored in the server, upstream commit `544c11abef504b53b698636a366e249057eed7cd` | the server's `vendor/SOURCE_COMMIT` at `v10.6.6` |

The server evaluates XPath with PsychoPath (XPath 2.0) unless the `enforceXPath1` setting is on, in
which case it uses `javax.xml.xpath` (XPath 1.0): `AccessibilityNodeInfoDumper.findNodes`. This project
assumes the default (see [settings.md](settings.md)).

## Device

Same emulator as the [benchmark](https://github.com/domovou69/appium-android-locator-benchmark/blob/main/docs/environment.md):

| Item | Value |
| --- | --- |
| AVD | `AOSP_API_36`: `system-images;android-36;default;arm64-v8a` rev. 2 (AOSP Android 16, no Google services) |
| Screen / CPU / RAM | 1080×2400, 420 dpi / 4 cores / 4 GB |
| Start | `emulator -avd AOSP_API_36 -no-window -no-snapshot-load -no-boot-anim -no-audio` |
| Power | AC only, macOS Low Power Mode off |

## Host

| Item | Value |
| --- | --- |
| Machine | Apple M1 Pro, 16 GB |
| macOS | 26.6.2 |
| Node / npm | 24.21.0 / 12.2.0 (the package itself supports Node 20+; CI runs 20, 22 and 24) |
| JDK, Android SDK | as in the benchmark: JDK bundled with Android Studio, `~/Library/Android/sdk` |
