`input.json` in the current folder has 680 XPath locators from Android UI tests (Appium, UiAutomator2 driver). Convert each one to an Android UiSelector locator (`-android uiautomator`) that finds the same elements. If a locator cannot be expressed as a UiSelector that finds the same elements, skip it and give the reason.

Write the result to `output.json` in the current folder: a JSON array with one entry per input `id`, either

```json
{ "id": "x001", "uiselector": "new UiSelector().className(\"android.widget.Button\").text(\"OK\")" }
```

or

```json
{ "id": "x002", "skip": true, "reason": "..." }
```

Write each UiSelector as the full string passed to the `-android uiautomator` strategy, starting with `new UiSelector()`. If the result is too large for one file, write it in parts as `output-1.json`, `output-2.json`, …; the parts are merged after you finish. Every id must be present in the end.
