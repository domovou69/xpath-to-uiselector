# Claude models vs the converter

Three Claude models converted the same 680 Appium XPaths as the converter twice: once with no rules and once with
the Android rules in [`rules.md`](rules.md). Every answer that differs from the converter's was checked on the
emulator. One run per model and setting, so the numbers are indicative, not a benchmark.

## Result

| Run (effort medium) | Correct | Close | Wrong | Skip | Missed | Time, min | Cost, $ |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Converter | 446 | 37 | 0 | 197 | – | < 0.1 | 0 |
| Opus 5.5, no rules | 402 | 34 | **43** (13 LB) | 182 | 19 | 12.2 | 3.00 |
| Opus 5.5, rules | 450 | 37 | **0** | 192 | 1 | 5.9 | 1.84 |
| Sonnet 5.5, no rules | 406 | 33 | **56** (7 LB) | 175 | 10 | 4.9 | 0.95 |
| Sonnet 5.5, rules | 450 | 37 | **0** | 192 | 1 | 4.1 | 0.89 |
| Haiku 5.5, no rules | 398 | 33 | **58** (15 LB) | 167 | 24 | 5.2 | 0.12 |
| Haiku 5.5, rules | 445 | 37 | **3** | 190 | 5 | 6.3 | 0.33 |

Each row sums to 680. One verdict per locator:

- **Correct:** the UiSelector finds the same elements as the XPath, in the same order. An answer equal to the
  converter's exact answer counts here. The converter's own answers were checked on the device before (stages 3–4
  of [PLAN.md](../../PLAN.md)). Also counted here: 1–5 answers per run that agree on every screen but whose XPath
  found nothing there (VACUOUS, mostly `lower-case()` over a `childSelector`), so they are not proven.
- **Close:** a documented close form: a `childSelector` for `//A//B` whose first element agrees, or a difference
  only in range widgets or class-less elements. An answer equal to the converter's close answer counts here. The
  model gets the same credit as the converter, although it gives no warning.
- **Wrong:** the UiSelector finds other elements, or the same in another order, on some screen, or the server
  rejects it. **LB** is the part that fails only on generated elements with a line break in a value
  (`resourceIdMatches` without `(?s)`). Real resource ids have no line breaks, so those are harmless in practice.
- **Skip:** both the model and the converter skip.
- **Missed:** the model skips, and the device confirms the converter's UiSelector.

The converter is wrong nowhere in the differences of all six runs. Some locators the converter skips have a correct
UiSelector, and the models found 4–6 of them per rules run (see [Gaps](#converter-gaps)); they count as Correct,
which is why the rules runs have more Correct than the converter.

**Headline:** without rules every model gives 43–58 wrong UiSelectors out of 680 (6–9 %). They look plausible and
often pass a quick check: `textContains("Total")` finds "Total" and also "TOTAL". With the rules, Opus and Sonnet
give none and Haiku gives 3. The rules were fitted to the mistakes of the runs without rules on the same 680
locators, with no held-out set, so the rules rows are an upper bound for what a written prompt can do.

## Setup

- **Input:** 680 XPaths, as many as in the iOS comparison
  ([xpath-to-class-chain](https://github.com/domovou69/xpath-to-class-chain/tree/main/audit/llm)). 149 are edge
  cases: every distinct XPath of `audit/spec/cases.js`. 531 are real-world locators, sampled from the 1603 distinct
  Android XPaths of the corpus and stratified by project (19) and by the converter's outcome (359 exact, 27 close,
  145 skip). Runtime values are filled in, so the model and the converter get the same plain string. Built by
  [`build-input.js`](build-input.js).
- **Prompts:** [`prompt.md`](prompt.md) only says "convert to UiSelector or skip with a reason". The rules runs get
  [`prompt-rules.md`](prompt-rules.md): the same task, the rules (8 k characters), then the output format.
- **Runs:** Claude Code CLI 2.1.308, effort medium for all three models. Each run gets an empty temp folder with
  `input.json` only, tools Read + Write, and no settings, hooks or MCP servers ([`run.js`](run.js)). The three
  runs of a wave ran in parallel.
- **Check:** [`compare.js`](compare.js) compares each answer with the converter's as a set of calls.
  [`verify.js`](verify.js) runs every difference on the emulator (AOSP API 36, UiAutomator2 driver 8.7.0,
  LocatorLab): `findElements` with the XPath, the model's UiSelector and the converter's. Edge cases run on the
  five edge-case screens; real-world locators on five random screens and a matrix screen generated from the XPath;
  every item also on a hand-made `llm` screen (range widgets at 1.5 and 21.5, `(//X)[n]//Y` over several
  containers, whitespace and length traps). [`table.js`](table.js) gives the verdicts.
- **Time and cost:** wall time of the CLI call; cost is the CLI's `total_cost_usd`, the API list price, not what a
  subscription is charged.

## Time and cost

| Run | Output tokens (thinking) | Time, min | Cost, $ |
| --- | --- | --- | --- |
| Opus, no rules | 89 k (46 k) | 12.2 | 3.00 |
| Opus, rules | 49 k (12 k) | 5.9 | 1.84 |
| Sonnet, no rules | 51 k (15 k) | 4.9 | 0.95 |
| Sonnet, rules | 46 k (10 k) | 4.1 | 0.89 |
| Haiku, no rules | 81 k (42 k) | 5.2 | 0.12 |
| Haiku, rules | 103 k (47 k) | 6.3 | 0.33 |

- With the rules, Opus thinks a quarter as much and finishes twice as fast at 60 % of the cost.
- **Haiku's cost looks low, and it is the list price.** Haiku 5.5 costs $0.10 / $0.50 per million input / output
  tokens, 20 times less than Sonnet 5.5 ($2 / $10). A whole run is only 3–8 times cheaper than Sonnet's: Haiku
  writes more tokens, and its price is 5 times higher ($0.50 / $2.50) for requests over 100 k tokens, which a run
  reaches as its context grows. The Sonnet run checks against the list price within 2 % (tokens × price);
  Haiku's is in the range that the two price tiers give.
- The converter converts all 680 in well under a second, for free, the same way every time.

## The models' mistakes without rules

| Pattern | Opus | Sonnet | Haiku | Example |
| --- | --- | --- | --- | --- |
| `textContains` / `descriptionContains` / `textStartsWith` / `descriptionStartsWith` for `contains()`, `starts-with()`, `substring()`, `matches()`. In UiSelector they ignore case; in XPath they do not | 20 | 23 | 22 | `contains(@text,"Total")` → `textContains("Total")` also finds `TOTAL` |
| A Java-style `\\` in a regex or value: the server's string literal unescapes only `\"`, so `\\.` is a literal backslash, and a value ending in `\\` is rejected | 1 | 15 | 2 | `resourceIdMatches(".*joc\\.mehaka.*")` matches nothing |
| Values the page source has but UiSelector does not see: `@text=""`, `@resource-id=""`, `contains(@text,"")`, negation as a lookahead, an icon glyph read as `""` | 0 | 6 | 6 | `@text!="OK"` → `textMatches("(?!OK$).*")` also needs a non-null text |
| `classNameMatches`: `findElements` then iterates `index(i)` and loses elements | 2 | 3 | 1 | `//*` → `classNameMatches(".*")` |
| A position: `instance(n)` inside `childSelector` counts per container; `//X[1]` is a position among siblings | 5 | 0 | 2 | `(//ScrollView//ImageView)[3]` |
| An existence test dropped or widened | 2 | 0 | 2 | `[@resource-id]` → `new UiSelector()`; `@enabled=true()` dropped |
| A criterion UiSelector does not have, or `text()` | 0 | 0 | 3 | `@password="true"` → `password(true)` |
| `(?i)` for `translate()` / `upper-case()`: it also folds the Kelvin sign | 0 | 2 | 2 | |
| Other: an invalid `matches()` flag, the numeric `@text=1`, a dropped `className` | 0 | 0 | 3 | |
| **Wrong, not counting LB** | **30** | **49** | **43** | |
| `resourceIdMatches` without `(?s)` (LB) | 13 | 7 | 15 | `resourceIdMatches(".*x.*")` |

Each wrong answer is counted once, under the first pattern it shows.

Missed: Opus skipped 16 of its 19 because it assumed UiAutomator2 evaluates XPath 1.0 (`matches`, `lower-case`,
`ends-with`, `eq`, sequences, `"a""b"`); the server uses XPath 2.0 unless `enforceXPath1` is set. Haiku also skips
`or`, unions and sequences over one attribute, which are a plain alternation.

## The rules

[`rules.md`](rules.md) is written from the mistakes above and is the only rules file (git keeps old versions). The
first wave with rules found four errors in the rules themselves, all of the kind "the model skips what the
converter converts correctly":

1. "SKIP `@text=<a number>`" was too wide. A range widget's text is a Java float (`1.5`, `50.0`, `NaN`), so whole
   numbers such as `"1"` or `"12"` convert as usual.
2. "SKIP any negation" contradicted three other rules (`not(@checked="true")`, `[@resource-id!=""]`,
   `[@text!=""]`).
3. `@content-desc=""` → `description("")` was missing; models carried the `@text=""` rule over to it.
4. Control characters (`bell\u0007`) are replaced in the page source and must be skipped; this caused the one
   Wrong of Opus and of Sonnet.

The rules were rewritten in place and the whole wave was run again; the table above is that second wave.

What is left with the rules:

- **Opus, Sonnet:** 1 missed, the same one. A0414's text is a private-use icon glyph (U+E163); every model reads it
  as `""` and skips, even with a rule saying a literal that looks empty may not be.
- **Haiku:** 3 Wrong, all `//android.widget.TextView[@text="…"]` → `text("…")` with the `className` dropped,
  against the rule "keep the className of every step". 4 of its 5 missed are `@text="A" or @text="B"` and
  `@text=("A","B")`, which it skipped by misreading "`@text="A" and @text="B"` match nothing". Opus and Sonnet
  read that rule right, and so did Haiku in the first wave, so the rules were not changed again.

## Converter findings

1. **One converter bug, fixed.** The pilot found C09: `contains(@text,"1.5")` was marked exact, but a range
   widget at 1.5 or 21.5 has that text in the page source only. Fixed in PR #18: `contains` / `starts-with` /
   `ends-with` on `@text` with a literal that can be part of a float string are now close, with the range-widget
   warning. After that, no converter UiSelector is wrong in any run.
2. **A flaky check, fixed in `verify.js`.** The toast from the `windows` screen stays in the page source for a few
   seconds, so on the next screen (`nest`) the XPath sometimes also found it. Together with an expected range
   widget the difference was not recognised, and `//*[@text!=""]` scored Wrong in 2 of 3 runs. Toasts are now set
   aside before the other known differences; the saved runs without rules did not change.

### Converter gaps

The models were right where the converter skips, in all runs that tried:

- `normalize-space(@text)="Total"` → `textMatches("[ \t\n\r]*Total[ \t\n\r]*")`.
- `translate(@text, A–Z, a–z)="ok"` → `textMatches("[oO][kK]")` (exact even for the Kelvin sign).
- `string-length(@text)=5` → `textMatches("(?s).{5}")`.
- A union with a branch on `@id`, an attribute Android never writes → only the `@resource-id` branches.
- `if (@checked="true") then true() else false()` → `checked(true)`, and
  `some $t in @text satisfies $t="OK"` → `text("OK")` (Haiku).

All are rare in real tests: one real-world locator in the sample (the `@id` union). They are candidates for the
converter, not bugs.

## Limits

- One run per model and setting: indicative, not a benchmark. Two runs with the same rules gave Haiku different
  mistakes.
- The rules were fitted on the same 680 locators they are scored on.
- Only the differences were checked on the device; answers equal to the converter's inherit its device results.
- Close gives a model the converter's credit without the converter's warning.
- Generated screens have line-break traps that real apps do not have, so those failures are marked LB.
