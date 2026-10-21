# Refactoring playbook for skipped locators

Use this when `scripts/convert.js` reports a status other than `success`. Every suggestion stays within `UiSelector`
or keeps the XPath. Code samples are illustrative: write them in the language and framework of the user's test code.

## Order of preference

1. **A resource id or content description in the app.** If the app team can add `android:id` (views),
   `Modifier.testTag(…)` with `testTagsAsResourceId = true` (Compose), or `contentDescription`, the locator becomes
   `new UiSelector().resourceId("com.app:id/pay")` or the `id` / `accessibility id` strategy. This is the most stable
   fix and removes the structural XPath. Say who has to make the change (the app code, not the test code).
2. **A different single UiSelector** that selects the same element by its own attributes (text, description,
   class plus `instance`). Valid only when the user confirms it on the page source, because it is a different
   locator, not a conversion.
3. **Two lookups in the test code:** find an anchor with one `UiSelector`, then look up the target from it. Appium
   runs a lookup from an element inside that element; this audit did not check element-scoped lookups, so ask the
   user to verify on the screen.
4. **Keep the XPath** and say so, when none of the above is exact. A correct XPath is better than a fast
   `UiSelector` that finds the wrong element.

## By construct

| Skip reason (engine) | Advice |
|---|---|
| `UiSelector has no direct-child criterion` (`//A/B`) | If B is unique inside A, `//A//B` → `childSelector` is close (same first element). Otherwise select B by its own attributes, or give it an id. |
| `a position among siblings has no UiSelector form` (`//X[2]`) | If the user means "the 2nd X on the screen", that is `(//X)[2]` → `instance(1)`: a different locator, confirm it. Or find all matches in test code and pick by index. |
| `absolute path from the page source root` (`/hierarchy/…`) | Inspector paths break on any layout change. Rebuild from the target's own attributes (resource id, text, description) seen in the page source. |
| sibling axes, `..`, `parent::`, `ancestor::` (label next to a field) | Find the common container, then the target inside it (two lookups), or give the target an id. A `fromParent` candidate is possible but unverified. |
| `UiSelector has no has-descendant filter` (`//Row[.//*[@text="x"]]`) | Find the inner element, then act on it, or two lookups from the container list. Keep the XPath if the container itself must be returned. |
| `UiSelector has no negation for text`, `or across attributes` | Look up the alternatives in test code and take the first found, or keep the XPath. |
| `classNameMatches …` (`contains(@class,…)`, class unions) | Name the real class (`className("android.widget.Button")`) and look up each class separately. |
| `upper-case()`, `translate()` | If the text is ASCII, `matches(@text,"ok","i")` converts exactly; suggest it as a rewrite of the XPath first. |
| `every element without text has text=""` | Say what the user wants: an empty field is usually better found by its resource id. |
| an attribute without a UiSelector criterion (`bounds`, `displayed`, `hint`, …) | Drop the attribute if the rest of the locator is unique (confirm on the page source); read the attribute in test code after the lookup; or keep the XPath. |
| alias attribute (`@name`, `@resourceId`) | The XPath matches nothing as written: `@name` → `@text` or `@content-desc`, `@resourceId` → `@resource-id`. Fix the XPath, then run the engine again. |
| `text()` | Replace `text()` with `@text` and run the engine again. |
| `a runtime value outside a string literal` | Move the runtime part into a string value, or build the `UiSelector` in code (`"new UiSelector().index(" + i + ")"`). |
| `not a valid XPath` | Show the error and the likely fix; the XPath already fails at runtime. |
| `skipped_unknown_strategy` (constant, `String.format`) | Use the `uiselector` where the string is passed and switch that call to the UiAutomator strategy. |
| `skipped_xpath_strategy` (Selenium `@FindBy`, `findElementByXPath`) | Switch to `@AndroidFindBy(uiAutomator = "…")` or `AppiumBy.androidUIAutomator("…")`; quote the `UiSelector` for the language. |

## Strategy per client

| Client | UiAutomator strategy |
|---|---|
| Java / Kotlin | `AppiumBy.androidUIAutomator("…")`, `@AndroidFindBy(uiAutomator = "…")` |
| Python | `(AppiumBy.ANDROID_UIAUTOMATOR, '…')` |
| WebdriverIO | `$('android=new UiSelector()…')` |
| C# | `MobileBy.AndroidUIAutomator("…")` |
| Ruby | `find_element(:uiautomator, '…')` |

## Two lookups in test code

WebdriverIO:

```js
const row = await $('android=new UiSelector().resourceId("com.shop:id/order_42")');
const pay = await row.$('android=new UiSelector().text("Pay")');
```

Java (java-client):

```java
WebElement row = driver.findElement(AppiumBy.androidUIAutomator("new UiSelector().resourceId(\"com.shop:id/order_42\")"));
WebElement pay = row.findElement(AppiumBy.androidUIAutomator("new UiSelector().text(\"Pay\")"));
```

Python (Appium-Python-Client):

```python
row = driver.find_element(AppiumBy.ANDROID_UIAUTOMATOR, 'new UiSelector().resourceId("com.shop:id/order_42")')
pay = row.find_element(AppiumBy.ANDROID_UIAUTOMATOR, 'new UiSelector().text("Pay")')
```

This replaces sibling and parent navigation when the target and its anchor share a container. It costs one more
round trip.
