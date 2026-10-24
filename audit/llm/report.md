# Claude models vs the converter

Three Claude models converted the same 680 Appium XPaths as the converter twice: once with no rules and once with
the Android rules in [`rules.md`](rules.md). Every answer that differs from the converter's was checked on the
emulator. One run per model and setting, so the numbers are indicative, not a benchmark.

## Result

| Run (effort medium) | Correct | Close | Wrong | Skip | Missed | Score (%) | S | R | Time, min | Cost, $ |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Converter | 452 | 39 | 0 | 189 | – | 100 | 94.2 | 96.5 | < 0.1 | 0 |
| Opus 5.5, no rules | 400 | 32 | **47** (14 LB) | 179 | 22 | 78.3 | 56.7 | 80.1 | 12.2 | 3.00 |
| Opus 5.5, rules | 448 | 37 | **1** (1 LB) | 189 | 5 | 98.7 | 89.4 | 96.3 | 5.9 | 1.84 |
| Sonnet 5.5, no rules | 401 | 32 | **60** (8 LB) | 176 | 11 | 75.7 | 43.8 | 80.5 | 4.9 | 0.95 |
| Sonnet 5.5, rules | 448 | 37 | **1** (1 LB) | 189 | 5 | 98.7 | 89.4 | 96.3 | 4.1 | 0.89 |
| Haiku 5.5, no rules | 390 | 32 | **63** (16 LB) | 169 | 26 | 72.7 | 37.0 | 78.7 | 5.2 | 0.12 |
| Haiku 5.5, rules | 443 | 37 | **4** (1 LB) | 189 | 7 | 97.0 | 87.5 | 94.7 | 6.3 | 0.33 |

The converter here is the version after the [converter backlog](#converter-backlog) was closed (PR #22); the
models' answers are the same.

Each row sums to 680. One verdict per locator:

- **Correct:** the UiSelector finds the same elements as the XPath, in the same order. An answer equal to the
  converter's exact answer counts here. The converter's own answers were checked on the device before (stages 3–4
  of [PLAN.md](../../PLAN.md)).
- **Close:** a documented close form: a `childSelector` for `//A//B` whose first element agrees, or a difference
  only in range widgets or class-less elements. An answer equal to the converter's close answer counts here. The
  model gets the same credit as the converter, although it gives no warning.
- **Wrong:** the UiSelector finds other elements, or the same in another order, on some screen, or the server
  rejects it. **LB** is the part that fails only on generated elements with a line break in a value
  (`resourceIdMatches` without `(?s)`, or `(?s).{n}`, which counts CR LF as one character). Real resource ids have
  no line breaks, so most of those are harmless in practice.
- **Skip:** both the model and the converter skip.
- **Missed:** the model skips, and the device confirms the converter's UiSelector.
- 1–5 answers per run agree on every screen, but their XPath found nothing there (VACUOUS), so they prove nothing:
  they go in the converter's column for that locator.

**S and R** (the article's scores) are the same points over the locators that have a UiSelector, as in the iOS
comparison: S on the edge cases (104 of 149), R on the real-world locators (387 of 531), each out of 100. The converter
scores 94.2 / 96.5, below 100 because some locators only have a close form (half a point). `audit/llm/table.js` prints
them next to the columns.

**Score:** Correct +1, Close +0.5, Wrong −1 (LB included), Skip 0, Missed 0. The converter is the reference: its
471.5 points are 100 %, and a run's % is its points over the converter's. A model above 100 % would beat the
converter on some locators: each such locator is either a converter gap or a false finding of the check, see
[Converter backlog](#converter-backlog). After the gaps were closed, no run is above 100 %. False findings are scored with the verdict the triage gives them.

The converter is wrong nowhere in the differences of all six runs. Before PR #22 the models found 8 locators the
converter skipped although a correct UiSelector exists, and Opus and Sonnet with the rules scored 100.6 %; the
converter now converts all 8 (see [Converter backlog](#converter-backlog)).

**Headline:** without rules every model gives 47–63 wrong UiSelectors out of 680 (7–9 %) and scores 73–78 % of the
converter. They look plausible and
often pass a quick check: `textContains("Total")` finds "Total" and also "TOTAL". With the rules, Opus and Sonnet give 1
(line breaks only) and Haiku 4, and all three score 97–99 %. The rules were fitted to the mistakes of the runs without rules on the same 680
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
| A position: `instance(n)` inside `childSelector` counts per container; `A.instance(n).childSelector(B)` goes on to the next `A` when the n-th has no `B`; `//X[1]` is a position among siblings | 8 | 0 | 3 | `(//ScrollView//ImageView)[3]` |
| An existence test dropped or widened | 2 | 0 | 2 | `[@resource-id]` → `new UiSelector()`; `@enabled=true()` dropped |
| A criterion UiSelector does not have, or `text()` | 0 | 0 | 3 | `@password="true"` → `password(true)` |
| `(?i)` for `translate()` / `upper-case()`: it also folds the Kelvin sign | 0 | 2 | 2 | |
| An element UiSelector never finds: a toast, a range widget by its value text | 0 | 3 | 3 | `//android.widget.Toast[@text="Saved"]` |
| Other: an invalid `matches()` flag, the numeric `@text=1`, a dropped `className` | 0 | 0 | 3 | |
| **Wrong, not counting LB** | **33** | **52** | **47** | |
| `resourceIdMatches` without `(?s)`; `(?s).{n}` for `string-length()` (LB) | 14 | 8 | 16 | `resourceIdMatches(".*x.*")` |

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

- **All three:** 1 Wrong (LB), the same one: `string-length(@text)=5` → `textMatches("(?s).{5}")`. With DOTALL,
  ICU's `.` takes CR LF as one character, so `"ab\r\nc"` (5 characters for XPath) is missed; the converter writes
  `[\s\S]{5}`. Found by a trap added for the converter fixes (PR #22).
- **All three:** 4 missed that the converter now converts: `@displayed="true"`, `contains(@text,"")`,
  `if … then true() else false()`, `some $t in @text satisfies …` (Haiku converts the last two).
- **Opus, Sonnet:** 1 more missed, the same one. A0414's text is a private-use icon glyph (U+E163); every model reads it
  as `""` and skips, even with a rule saying a literal that looks empty may not be.
- **Haiku:** 3 more Wrong, all `//android.widget.TextView[@text="…"]` → `text("…")` with the `className` dropped,
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
3. **Two more false passes, fixed in `verify.js`.** `//android.widget.Toast[@text="Saved"]` → a UiSelector that
   finds nothing passed, because the toast difference was excused even when the toast is the target (Sonnet and
   Haiku without rules). `(//*[@resource-id=".../second"]/descendant::TextView)[3]` →
   `….childSelector(….instance(2))` passed, because the edge-case screens had one such container; the `llm` screen
   now has two (Opus without rules). The `llm` screen was checked again for every item of all six runs; only these
   two verdicts changed.
4. **8 converter gaps, closed in PR #22.** See the next section.

## Converter backlog

Every locator where a model ends in a better column than the converter goes to
[`scores/gaps.json`](scores/gaps.json): the XPath, the converter's answer, each run's answer and verdict, and a
triage, `gap` (the converter could do it) or `false` (the check could not see why the model is wrong). Before PR #22
there were 13: 8 gaps and 5 false findings. Now there are only the 5 false findings.

### Gaps, closed in PR #22

| Id | XPath | The converter now | Runs that found it |
| --- | --- | --- | --- |
| x004 (S C14) | `//*[normalize-space(@text)="Total"]` | `textMatches("[ \t\n\r]*Total[ \t\n\r]*")`, exact | Opus ×2, Sonnet rules, Haiku rules |
| x610 (S C15) | `//*[string-length(@text)=5]` | `textMatches("[\s\S]{5}")`, close: a range widget at 10.25 has a 5-character text in the page source | all 6 |
| x659 (S H07) | `//*[translate(@text,"A…Z","a…z")="ok"]` | `textMatches("[oO][kK]")`, exact even for the Kelvin sign | Opus ×2, Sonnet rules, Haiku rules |
| x138 (R A1540) | a union of two `@resource-id` branches and one `@id` branch | `resourceIdMatches` of the two `@resource-id` values, exact: Android never writes `@id` | Opus ×2, Sonnet rules, Haiku rules |
| x211 (S C08) | `//*[contains(@text,"")]` | `new UiSelector()`, exact: true for every element | Opus no rules, Haiku no rules |
| x217 (S V04) | `//*[if (@checked="true") then true() else false()]` | `checked(true)`, exact | Sonnet no rules, Haiku rules |
| x262 (S V03) | `//*[some $t in @text satisfies $t="OK"]` | `text("OK")`, exact | Sonnet no rules, Haiku ×2 |
| x032 (S A12) | `//android.widget.Button[@displayed="true"]` | `className("android.widget.Button")`, close: with the default settings the page source lists only displayed elements | Haiku no rules |

In the real-world corpus this converts 5 more distinct literals (27 occurrences): three such `@id` unions, one
`normalize-space(@content-desc)` and one union of a web `@label` with an `@class` test.

### False findings: the check could not see why the model is wrong

| Id | XPath | Model's UiSelector | Scored as | Why |
| --- | --- | --- | --- | --- |
| x023 (R A1798), x250 (S E15) | `(//A)[n]//B` | `A.instance(n-1).childSelector(B)` | Wrong | On the device the UiSelector goes on to the next `A` when the n-th has no `B`, so it finds an element where the XPath finds none; no screen of the check had such an n-th `A` |
| x367 (S C10) | `//android.widget.SeekBar[@text="50.0"]` | `className("…SeekBar").text("50.0")` | Wrong | The only possible target is a range widget, whose value text only the page source has: the UiSelector finds nothing on any screen |
| x559 (S C11) | `//*[@text="50.0"]` | `text("50.0")` | Wrong | An equality with a float-shaped text most likely means the range widget itself, which the UiSelector misses; the converter skips it on purpose |
| x317 (S H06) | `//*[contains(lower-case(@text),"total")]` | `textMatches("(?is).*total.*")` | Close | The converter's own close form; it differs from `lower-case()` only for one-to-many folds (İ, ß), which no screen has |

## Limits

- One run per model and setting: indicative, not a benchmark. Two runs with the same rules gave Haiku different
  mistakes.
- The rules were fitted on the same 680 locators they are scored on.
- Only the differences were checked on the device; answers equal to the converter's inherit its device results.
- Close gives a model the converter's credit without the converter's warning.
- Generated screens have line-break traps that real apps do not have, so those failures are marked LB.
