---
name: xpath-to-uiselector
description: Deterministic XPath to Android UiSelector converter for Appium (UiAutomator2), with review of the locators it cannot convert exactly. Use when the user asks to "convert xpath to uiselector", "migrate android locators to uiautomator", "replace xpath with -android uiautomator", "speed up android locators", or otherwise wants Appium Android XPath locators replaced by UiSelector locators.
---

# XPath → Android UiSelector

Converts Appium Android XPath locators to `UiSelector` locators (`-android uiautomator`). A deterministic engine
converts first; you review only what it cannot convert exactly.

## Scope

- Output **only** `new UiSelector()…` locators, used with the client's UiAutomator strategy
  (`AppiumBy.androidUIAutomator`, `AppiumBy.ANDROID_UIAUTOMATOR`, `android=` in WebdriverIO, …).
- Never emit `textContains`, `textStartsWith`, `descriptionContains`, `descriptionStartsWith`: they are
  case-insensitive, XPath is not. The engine uses `…Matches` instead. Only when the user asks for loose mode
  (case-insensitive, simpler locators) run the engine with `--loose`: it emits them, and `childSelector` for a
  direct child `//A/B`, each with a warning.
- iOS locators, web / WebView XPaths and non-XPath strategies (`id`, `accessibility id`) are out of scope: list
  them as untouched. The engine cannot tell a web XPath from an Android one; if a locator looks like HTML
  (`//div`, `//input[@name=…]`, `@id`, `@href`), say so and leave it.

## STEP 1: Run the deterministic engine

Always run `scripts/convert.js` (Node ≥ 20) before writing any `UiSelector` yourself. It is read-only and prints one
JSON report on stdout.

| Input | Command |
|---|---|
| One or two simple locators | `node <skill-dir>/scripts/convert.js '<xpath>'` |
| A pasted list (anything with quotes or backticks) | write the locators one per line to a temp file, then `node <skill-dir>/scripts/convert.js --file <tmp>` |
| Source files or a folder (page objects, tests) | `node <skill-dir>/scripts/convert.js --scan <file-or-dir>` |

Prefer `--file` over arguments whenever a locator holds a quote or backslash: shell quoting changes locators
silently.

The report has `engine` (where the engine was found), `summary`, and `results[]` with `input`, `status`, and
`uiselector`, `written` (the rewritten source literal, `--scan` only), `strategy`, `reason`, `hint` (a manual
rewrite for the skip, and how the nearest UiSelector form differs), `warning`, `file` when present.

Exit code 3 means the engine was not found. Go to **Fallback** below.

## STEP 2: Inspect each result

| Status | What to do |
|---|---|
| `success`, no `warning` | Use `uiselector` **exactly as returned**. Do not reformat, reorder or "simplify" it (`textMatches("(?s).*Total.*")` is deliberate, not a long `textContains`). |
| `success` with `warning` | Use it, but list it under edge cases with the warning in plain words: `childSelector` returns at most one match per container with `findElements`; `android.view.View` also matches nodes without a class name; `lower-case()` → `(?i)` differs for `İ`/`ß`; a runtime value with `"` or `\` breaks the locator. |
| `skipped_unknown_strategy`, `skipped_xpath_strategy` | Converted but not written: there is no strategy call the engine can switch (a constant, a `String.format` result, Selenium `@FindBy`, `findElementByXPath`). Give the `uiselector` and the strategy change together (see the playbook). |
| `skipped_no_change` | Already a valid `UiSelector`. |
| `skipped_ios`, `skipped_not_xpath` | Out of scope: list as untouched. |
| `skipped_unsupported_logic`, `skipped_validation_failed` | Go to STEP 3. |

In the audit the engine produced no wrong `UiSelector` on 1169 real XPaths run on an emulator, and its checks
caught 99.5 % of deliberately wrong ones. It converted 73 % of real Android XPath literals; most of the rest have no
exact `UiSelector` at all (direct child `//A/B`, sibling positions, absolute `/hierarchy/…` paths, attributes with
no criterion). A skip means no exact `UiSelector` exists or none has been proven on a device. Do not override it
with one of your own and present that as a conversion.

## STEP 3: Expert review of skipped locators

For each locator from STEP 2 that needs review:

1. **Explain why** in one or two sentences, from the engine's `reason` (and its `hint`, when present) and `references/uiselector-rules.md` ("No
   exact UiSelector"). Name the construct (`/` direct child, `following-sibling::`, `[2]` among siblings, `@bounds`,
   …) and the UiSelector / UiAutomator2 limitation behind it.
2. **Recommend a fix** from `references/refactoring-playbook.md`, in this order: a resource id or content
   description in the app, a different single `UiSelector` (only with the page source), two lookups in test code,
   or keeping the XPath. Write sample code in the user's language and framework.
3. **A candidate `UiSelector` is optional.** Write one only if the rules give a form the engine has not been
   checked on (for example `fromParent` for a sibling). Mark it **unverified** and say how to check it: run both
   locators with `findElements` on the screen and compare. Never mark a hand-written `UiSelector` as converted.

Ask for the page source (`driver.getPageSource()`) when a recommendation depends on the screen's structure. Do not
guess the hierarchy.

## Applying the changes

`convert.js` never writes files. When the user asks to apply:

- **Folder or files:** run the main CLI from the engine root printed in the report:
  `node <engine.root>/xpath-to-uiselector.js <dir>` (preview), then add `--write` after the user agrees. Recommend
  a clean git working tree so `git diff` is the undo. The CLI rewrites the strategy call together with the string;
  it leaves `skipped_unknown_strategy` / `skipped_xpath_strategy` locators alone, so edit those by hand.
- **A few locators:** edit them directly with the `uiselector` from the report, and switch the strategy in the same
  edit. Escape the quotes for the source language (`\"` in Java, Kotlin, C#; none inside single-quoted Python/JS).
- Never apply STEP 3 candidates without the user's explicit agreement.

Remind the user once: the conversions are exact for the **default** UiAutomator2 settings; `enforceXPath1`,
`allowInvisibleElements`, `ignoreUnimportantViews`, `enableMultiWindows` or `snapshotMaxDepth` change what XPath sees
(`docs/settings.md` in the engine root).

## Fallback: engine not available

If `convert.js` exits with code 3:

1. Tell the user and offer the options: clone `github.com/domovou69/xpath-to-uiselector` and set
   `XPATH_TO_UISELECTOR_HOME`, or `npm i -g xpath-to-uiselector`. Do not install anything without their agreement.
2. If they want to continue without it, convert using `references/uiselector-rules.md` only. Label every
   `UiSelector` as **rules-only, unverified**. Skip whatever the rules do not cover.

## Report format

Structure the answer exactly like this:

### Converted automatically by script

| # | Original XPath | UiSelector | Note |
|---|---|---|---|

One row per `success` result, with `file` in the note for `--scan`. A `warning` goes in the note in plain words.
Rows for `skipped_unknown_strategy` / `skipped_xpath_strategy` go here too, noted "not written: change the strategy".

### Requires refactoring / Edge-cases

For each locator:

- **Original:** the XPath (and file, if known)
- **Why:** the construct and the limitation
- **Recommendation:** the fix, with test-code sample when useful
- **Candidate UiSelector (unverified):** only if step 3.3 applies

End with the untouched out-of-scope locators (iOS, web, non-XPath) as one short list, and the totals from `summary`.

## Reference files

- `references/uiselector-rules.md`: what converts and how, close forms, what has no exact `UiSelector`, device facts.
- `references/refactoring-playbook.md`: advice per skip reason, with code samples for WebdriverIO, Java and Python.
