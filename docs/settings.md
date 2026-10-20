# UiAutomator2 settings

The converter's results hold for the **default** settings of appium-uiautomator2-driver 8.7.0 /
UiAutomator2 server 10.6.6. This page lists every server setting with its default, taken from the
server's `app/src/main/java/io/appium/uiautomator2/model/settings/` at tag `v10.6.6` and from the
"Settings API" section of the driver's README.

**Effect** says what a change to the setting can do here:

- **Result**: changes which elements an XPath or a UiSelector finds, so a conversion that is exact
  with the default may not be exact any more.
- **Speed**: changes how long lookups take, so the benchmark's timings do not carry over.
- **—**: neither (actions, screenshots, ports, responses).

The effects come from the documentation and the source; the ones the converter depends on are checked
on the device in stage 3.

## Settings that affect lookups

| Setting | Default | Effect | What it does |
| --- | --- | --- | --- |
| `enforceXPath1` | `false` | Result | `true` switches XPath from PsychoPath (XPath 2.0) to `javax.xml.xpath` (XPath 1.0). XPath 2.0 functions (`ends-with`, `matches`, `lower-case`, sequences) then fail |
| `allowInvisibleElements` | `false` | Result | `true` adds elements that are not displayed to the XML source tree that XPath searches |
| `alwaysTraversableViewClasses` | `""` | Result | Class names whose invisible nodes are still traversed (Jetpack Compose view interop) |
| `ignoreUnimportantViews` | `false` | Result, Speed | `true` compresses the layout hierarchy: layout-only nodes drop out, so paths and positions change; the tree gets smaller |
| `enableMultiWindows` | `false` | Result | `true` puts all interactive windows (e.g. the keyboard) into the source, not only the active app window |
| `enableTopmostWindowFromActivePackage` | `false` | Result | `true` limits interactions and the source to the topmost window of the active package |
| `currentDisplayId` | default display | Result | The display used for lookups |
| `enableNotificationListener` | `true` | Result | Toast text is added to the XML source for up to 3.5 s after the toast expires |
| `limitXPathContextScope` | `true` | Result | Element-context XPath (`el.findElement(xpath, …)`) sees only the element's subtree |
| `mapTestTagToResourceId` | `false` | Result | `true` maps Compose `testTag` onto `resource-id`, like `testTagsAsResourceId` |
| `normalizeTagNames` | `false` | Result | `true` turns non-ASCII class names into ASCII tag names, so `//Tag` steps change |
| `snapshotMaxDepth` | `70` | Result, Speed | Depth limit of the source tree: XPath finds nothing deeper (the benchmark showed UiSelector still does) |
| `includeA11yActionsInPageSource` | `false` | Result, Speed | Adds the `actions` attribute to the source |
| `includeExtrasInPageSource` | `false` | Result, Speed | Adds the `extras` attribute to the source |
| `includeExtraRenderingInfo` | `false` | Result, Speed | Adds rendering attributes to the source (server source; not in the driver README) |
| `simpleBoundsCalculation` | `false` | Speed | `true` skips the overlap check when computing bounds: faster source generation, less precise bounds |
| `waitForIdleTimeout` | `10000` ms | Speed | Wait for an idle UI before each lookup |
| `waitForSelectorTimeout` | `10000` ms | Speed | How long a UiSelector lookup waits for a match to appear |
| `deferAccessibilityCacheReset` | `false` | Speed | When the accessibility cache is reset around lookups |
| `disableIdLocatorAutocompletion` | `false` | — here | Affects the `id` strategy only (package prefix), not XPath or UiSelector |

## Other settings

| Setting | Default | Effect |
| --- | --- | --- |
| `actionAcknowledgmentTimeout` | `3000` ms | — |
| `scrollAcknowledgmentTimeout` | `200` ms | — |
| `keyInjectionDelay` | `0` ms | — |
| `trackScrollEvents` | `true` | — (scroll actions, `contentSize`) |
| `elementResponseAttributes` | `"name,text"` (used only when `shouldUseCompactResponses` is `false`) | — |
| `shouldUseCompactResponses` | `true` | — |
| `useResourcesForOrientationDetection` | `false` | — |
| `shutdownOnPowerDisconnect` | `true` | — |
| `wakeLockTimeout` | 24 h | — |
| `serverPort` | `6790` | — |
| `mjpegServerPort` | `7810` | — |
| `mjpegServerFramerate` | `10` | — |
| `mjpegScalingFactor` | `50` | — |
| `mjpegServerScreenshotQuality` | `50` | — |
| `mjpegBilinearFiltering` | `false` | — |
