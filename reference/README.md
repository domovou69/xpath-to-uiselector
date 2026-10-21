# Reference

What the converter relies on, quoted or summarized from the sources at the pinned versions
([docs/environment.md](../docs/environment.md)). Behaviour lives in code, not in the Appium docs, so the
sources are the reference. Short quotes only; the sources are Apache-2.0 (UiAutomator2 server, androidx)
and EPL-2.0 (PsychoPath).

| File | What |
| --- | --- |
| [uia2-server.md](uia2-server.md) | UiAutomator2 server 10.6.6: XML page source, XPath engine, UiSelector string parser, how `-android uiautomator` lookups run |
| [uiselector-api.md](uiselector-api.md) | `androidx.test.uiautomator.UiSelector` 2.3.0: every criterion and how it matches, traversal, `instance`, `index`, `childSelector` |
| [xpath.md](xpath.md) | PsychoPath XPath 2.0 as used by the server: functions, `matches()` regexes, comparisons |

Every row has an id (`SRV-…`, `SEL-…`, `XP-…`). Every id is cited by at least one edge case in
[`audit/spec/cases.js`](../audit/spec/cases.js); `npm run spec:check` fails otherwise. Each row ends with
what it means for the converter. Rows marked **oracle** are read from the source but depend on runtime
behaviour, so stage 3 confirms them on the emulator.

Source links:

- Server: `https://github.com/appium/appium-uiautomator2-server/blob/v10.6.6/<path>`
- androidx: `uiautomator-2.3.0-sources.jar` from Google Maven
  (`androidx/test/uiautomator/uiautomator/2.3.0/`), files under `androidx/test/uiautomator/`
- PsychoPath: the server's `vendor/org.eclipse.wst.xml.xpath2.processor/` at the same tag
