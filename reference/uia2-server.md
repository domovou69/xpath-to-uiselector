# UiAutomator2 server 10.6.6

Paths are under `app/src/main/java/io/appium/uiautomator2/` unless they start with `vendor/`.

## XML page source (what XPath searches)

| Id | Fact | Source | For the converter |
| --- | --- | --- | --- |
| SRV-01 | XPath is evaluated by PsychoPath (XPath 2.0) unless `enforceXPath1` is on; then `javax.xml.xpath` (XPath 1.0) | `core/AccessibilityNodeInfoDumper.java` `findNodes` | XPath 2.0 syntax is valid input (default settings) |
| SRV-02 | The document root is `<hierarchy>`; its children are the window roots (only the active window by default) | `model/UiElementSnapshot.java` `ROOT_NODE_NAME`, constructor from `AccessibilityNodeInfo[]` | `/hierarchy/…` and `//hierarchy` have no UiSelector: skip. **Oracle:** `findElements` never returns `<hierarchy>` itself, so `//*` equals `new UiSelector()`; a second window (PopupWindow) is in neither result by default, and with `enableMultiWindows` only in the XPath's |
| SRV-03 | The tag name is the class name with `$ @ # &` replaced by `.`, dots collapsed, leading/trailing dots removed, then made a valid XML name; a blank class gives `android.view.View` | `AccessibilityNodeInfoDumper.toXmlNodeName` | A `//T` step names the class only if `T` has none of those characters and is not the fallback; `$` in a step: skip |
| SRV-04 | An attribute whose value is `null` is not written at all | `AccessibilityNodeInfoDumper.serializeUiElement`, `UiElementSnapshot.putAttribute` | A missing attribute and a `null` UiSelector value both fail to match. An existence test `[@content-desc]` is a non-null test: `descriptionMatches("(?s).*")` |
| SRV-05 | `text` is the node's text with `null` replaced by `""`, so every element has a `text` attribute | `UiElementSnapshot.getNodeAttributeValue` (`TEXT` → `AxNodeInfoHelper.getText(node, true)`) | `@text=""` matches text-less elements in XPath, while `text("")` needs a non-null text: skip `@text=""` and text tests that hold for `""`. `[@text]` is always true and is dropped; `[@text!=""]` → `textMatches("(?s).+")`, close (range widgets, SRV-06) |
| SRV-06 | For a node with `RangeInfo` (SeekBar, ProgressBar, RatingBar) `text` is the current value as `Float.toString`, e.g. `50.0` | `core/AxNodeInfoHelper.java` `getText` | `@text` on range widgets differs from `getText()`: skip literals shaped like a float; document the limit |
| SRV-07 | `resource-id` is the view id name, omitted when empty | `AxNodeInfoHelper.getResourceId` | `@resource-id=""` matches nothing in XPath: skip. `[@resource-id]` and `[@resource-id!=""]` → `resourceIdMatches("(?s).+")` |
| SRV-08 | `content-desc`, `class`, `package` are the node values as strings, omitted when `null` | `UiElementSnapshot.getNodeAttributeValue` | Map to `description`, `className`, `packageName` |
| SRV-09 | `checkable`, `checked`, `clickable`, `enabled`, `focusable`, `focused`, `long-clickable`, `scrollable`, `selected` are always written as `true` / `false` | same | Map to the boolean criteria; `not(@x="true")` = `x(false)`. `[@checked]` (any of the nine) is always true and is dropped |
| SRV-10 | `index` is the child's position among **all** its parent's children, invisible and null ones included | `UiElementSnapshot.buildChildren` | Same number as UiSelector's `index` (SEL-09). `[@index]` is always true and is dropped |
| SRV-11 | About 40 more attributes (`bounds`, `displayed`, `password`, `hint`, `a11y-*`, `input-type`, `drawing-order`, …) have no UiSelector criterion | `utils/Attribute.java`, `UiElementSnapshot.SUPPORTED_ATTRIBUTES` | Skip any predicate on them |
| SRV-12 | Invisible children are left out unless `allowInvisibleElements`; children deeper than `snapshotMaxDepth` (70) are left out | `UiElementSnapshot.buildChildren` | Same visibility rule as UiSelector (SEL-07); below depth 70 XPath finds nothing and UiSelector does: documented, favourable |
| SRV-13 | Toast messages are added as `android.widget.Toast` children of `<hierarchy>` | `UiElementSnapshot.addToastMsg` | UiSelector searches the active window only (SEL-06): skip `android.widget.Toast`. **Oracle:** the toast is in the XPath's results for a few seconds, also for broad XPaths such as `//*[not(@checked="true")]` |
| SRV-14 | Characters that are not valid XML are replaced in attribute values | `AccessibilityNodeInfoDumper.serializeUiElement` (`toSafeString`) | A literal with control characters: skip |

## The UiSelector string (`-android uiautomator`)

| Id | Fact | Source | For the converter |
| --- | --- | --- | --- |
| SRV-20 | The string is split into statements at `;` outside string literals; each statement is a `UiSelector` or `UiScrollable` | `utils/UiAutomatorParser.java` | Output is one statement |
| SRV-21 | `findElement` uses only the **first** statement; `findElements` runs every statement and concatenates the results, deduplicated, in statement order | `utils/ElementLocationHelpers.java` `toSelector` (`get(0)`), `utils/ByUiAutomatorFinder.java` `findMany` | `;` cannot express `or` or unions: skip |
| SRV-22 | `new UiSelector()` may be omitted; methods are called by reflection on `UiSelector` with `String`, `boolean`, `int` (and `UiSelector`) arguments | `utils/UiSelectorParser.java`, `utils/UiExpressionParser.java` | Emit the full `new UiSelector()…` form |
| SRV-23 | A string argument is `"…"`; the only unescaping is `\"` → `"`; a backslash stays as written; a `"` preceded by `\` does not end the literal | `UiExpressionParser.coerceArgToType`, `consumeMethodParameters` | A plain criterion cannot hold `\` before `"` or at the end; use a `…Matches` form with `\x22` / `\x5c` escapes instead (stays exact) |
| SRV-24 | `boolean` arguments must be exactly `true` / `false`; `int` arguments go through `Integer.parseInt` | `UiExpressionParser.coerceArgToType` | Emit `checked(true)`, `index(2)`, `instance(0)` |

## How a `-android uiautomator` lookup runs

| Id | Fact | Source | For the converter |
| --- | --- | --- | --- |
| SRV-30 | `findElement` → `UiDevice.findObject(selector)`: the first match of androidx's search | `ByUiAutomatorFinder.findOne`, `model/internal/CustomUiDevice.java` `findObject` | First element = first match in traversal order (SEL-06) |
| SRV-31 | `findElements` with `instance` in the selector returns that single element | `ByUiAutomatorFinder.matchDescendantElements` | `(//X)[n]` → `instance(n-1)` returns one element, as the XPath does |
| SRV-32 | `findElements` without `instance` loops `instance(0)`, `instance(1)`, … until one is not found | same | All matches in traversal order |
| SRV-33 | If the selector has `classNameMatches`, that loop uses `index(i)` instead of `instance(i)`, overwriting any `index` | same (`CLASS_REGEX` → `sel.index(descendantIndex)`) | `classNameMatches` breaks `findElements`: skip (`contains(@class,…)`, class unions; Decision 3 in PLAN.md). **Oracle:** 1–3 of 8 and 4 of 13 elements; the first element equals the XPath's |
| SRV-34 | XPath lookups build the source with only the attributes the query names | `ElementLocationHelpers.getXPathNodeMatch` (`extractQueriedAttributes`) | No effect on results; XPath cost depends on the query |
| SRV-35 | `findElements` looks for `INSTANCE` only among the outer selector's own criteria (`doesUiSelectorHaveAttribute(sel, "INSTANCE")` reads `sel`'s `mSelectorAttributes`, line 93). An `instance` inside a `childSelector` does not stop the loop of SRV-32, which then sets `instance(i)` on the outer selector (line 111) and finds more elements | `ByUiAutomatorFinder.matchDescendantElements` | `(//A//B)[1]` puts `instance(0)` on the outer selector too: it changes nothing in matching (SEL-14) and makes `findElements` return the one element. **Oracle:** without it, 3 elements where the XPath has 1 |
