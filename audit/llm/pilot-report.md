# Pilot: Opus 5.5 (medium effort) vs the converter, no rules

Step 1 of the LLM comparison. One run, so the numbers are indicative. The point of the pilot is to find
converter bugs before the Android rules are written.

## Setup

- **Input:** 680 XPaths, as many as in the iOS comparison (678). 149 are edge cases (every distinct XPath of
  `audit/spec/cases.js`). 531 are real-world locators, sampled from the 1603 distinct Android XPaths of the corpus
  and stratified by project (19) and by the converter's outcome: 359 exact, 27 close, 145 skip. Runtime values are
  filled in. Built by [`build-input.js`](build-input.js).
- **Prompt:** [`prompt.md`](prompt.md). It only says "convert to UiSelector or skip with a reason" and gives no rules.
- **Run:** `claude-opus-5-5`, effort medium, Claude Code CLI 2.1.308. The run gets an empty temp folder, tools
  Read + Write only, and no settings, hooks or MCP servers ([`run.js`](run.js)).
- **Time and cost:** 12.2 min. The CLI reports $3.00 (API price) and 89 k output tokens, of which 46 k are
  thinking. All 680 entries came back and every one is valid JSON.
- **Check:**
  1. [`compare.js`](compare.js) compares each answer with the converter's as a set of calls, so call order does
     not matter.
  2. [`verify.js`](verify.js) runs the 100 differences on the emulator: AOSP API 36, UiAutomator2 driver 8.7.0,
     LocatorLab. Each difference runs `findElements` with the XPath, the model's UiSelector and the converter's
     UiSelector.
  3. Edge cases run on the five edge-case screens. Real-world locators run on five random screens and a matrix
     screen, generated from the XPath by `audit/device/fuzz-screens.js`.
  4. Every item also runs on a hand-made `llm` screen: range widgets at 1.5 and 21.5, `(//X)[n]//Y` over several
     containers, whitespace and length traps.
  5. The device check took 3.5 min.

## Text comparison

| Group | Same UiSelector | Both skip | Different UiSelector | Only the model converts | Only the converter converts | Unparsed |
| --- | --- | --- | --- | --- | --- | --- |
| Edge cases (149) | 66 | 42 | 17 | 10 | 13 | 1 |
| Real-world (531) | 332 | 140 | 48 | 5 | 6 | 0 |
| All (680) | 398 | 182 | 65 | 15 | 19 | 1 |

## After the device check

Every id gets one verdict for the model:

- **same:** the model's answer is the converter's. The converter's own answers were checked on the device in
  stages 3–4.
- **CORRECT:** a different UiSelector that finds the same elements.
- **DRIFT:** a close form that the converter also accepts. For `//A//B`, a `childSelector` whose first element
  agrees. Or a difference only in class-less elements.
- **WRONG-LB:** wrong only on generated elements whose value has a line break.
- **missed:** the model skips, and the device confirms the converter's UiSelector.
- **right skip:** the model skips, and the converter's UiSelector is wrong.

| Group | same | CORRECT | DRIFT | WRONG | WRONG-LB | INVALID | VACUOUS | missed | right skip |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Edge cases (149) | 108 | 11 | 4 | 11 | 0 | 1 | 1 | 12 | 1 |
| Real-world (531) | 472 | 19 | 3 | 18 | 13 | 0 | 0 | 6 | 0 |
| All (680) | 580 | 30 | 7 | **29** | 13 | **1** | 1 | 18 | 1 |

**Headline:** the model gave 479 UiSelectors. 30 of them are wrong or rejected (29 WRONG + 1 INVALID), which is
6.3 % of its UiSelectors and 4.4 % of all locators. 18 of the 30 come from real-world locators. Another 13 fail only
on line-break traps. Among the 100 differences the converter had 1 wrong UiSelector (C09, below).

`same` was not re-checked here. Where the model gave the converter's answer, it inherits the converter's verdict from
the earlier device runs.

### The model's mistakes

| Pattern | WRONG | Example |
| --- | --- | --- |
| `textContains` / `descriptionContains` / `textStartsWith` / `descriptionStartsWith` for `contains()` / `starts-with()` / `substring()`. In UiSelector these ignore case; in XPath they do not. Wrong only when the literal has letters: on CJK, digits or punctuation the same form was CORRECT (14 times; a 15th, G07 `$5.00 (incl.)`, passed only because no screen had `INCL`) | 20 | `contains(@text,"Total")` → `textContains("Total")` also finds `TOTAL`, `total` |
| A position over a nested path. `instance(n)` inside `childSelector` counts within each container, and `(//A//B)[1]` needs `instance(0)` on the outer selector | 5 | `(//ScrollView//ImageView)[3]` → `…childSelector(…instance(2))` |
| `classNameMatches`: on `findElements` the server iterates `index(i)` and loses elements | 2 | `//A \| //B` → `classNameMatches("…(Image)?Button")` |
| `@enabled=true()` dropped. The model assumed XPath 1.0, where this tests only that the attribute exists | 1 | → `new UiSelector()` |
| `[@resource-id]` → `resourceIdMatches("(?s).*")`. This matches every element; `.+` matches only elements with an id | 1 | |
| `resourceIdMatches` without `(?s)` (WRONG-LB). Real resource ids have no line breaks, so this is harmless in practice. Unlike `textMatches`, the server does not compile this regex with DOTALL | 13 | `contains(@resource-id,"x")` → `resourceIdMatches(".*x.*")` |
| A Java-style `\\` in a literal (INVALID). The server's string literal unescapes only `\"`, so `text("C:\\Temp\\")` never closes | 1 | |

**Missed: 18.** The model skipped 16 locators because it believes UiAutomator2 evaluates XPath 1.0. In fact the
server uses PsychoPath (XPath 2.0) unless `enforceXPath1` is set. Those 16 use `matches`, `lower-case`, `ends-with`,
`eq`, `("A","B")` and `"a""b"`. The other 2:

- A web `@class` value that matches nothing either way.
- A0414, whose text is a private-use glyph (U+E163). The model read it as `""`.

**DRIFT: 7.** All seven are a `childSelector` whose first element agrees:

- Three are `(//A//B)[1]` without the outer `instance(0)`.
- Two are `(//X)[n]//Y` written as `X.instance(n-1).childSelector(Y)`.
- Two are `//A//B` childSelectors (A0128, A1085). The converter emits the same form there; the two differ only in
  how the regex is written.

**CORRECT: 30.** Mostly `textContains` on literals without letters, and regexes written differently: `[.]` for `\.`,
or `(定位|位置)` folded together. Five conversions of forms the converter skips were also right:

- `normalize-space(@text)="Total"` → `textMatches("[ \t\n\r]*Total[ \t\n\r]*")` (C14).
- `translate(@text, A–Z, a–z)="ok"` → `textMatches("[oO][kK]")` (H07). This is exact even for the Kelvin sign,
  which `(?i)` would fold.
- `string-length(@text)=5` → `textMatches("(?s).{5}")` (C15).
- A union with a branch on `@id`, an attribute Android never writes → only the `@resource-id` branches (A1540).
- `contains(@text,"")`, which is true for every element → `new UiSelector()` (C08).

E11 (`instance(2)` inside a `childSelector`) also passed, but only because every screen had a single container. It
is not counted as a gap.

## Converter findings

1. **C09 is wrong.** `contains(@text,"1.5")` is marked exact, but a range widget's page-source text is its value as
   `Float.toString` (SRV-06). A SeekBar at 1.5 or 21.5 matches the XPath but not `textMatches`. The edge-case screens
   had only a widget at 50.0, so stage 3 missed it. The converter already skips `@text="<float>"` (C10, C11). The same
   risk applies to `contains` / `starts-with` / `ends-with` when the literal can be part of a float string (digits,
   `.`, `-`, `E`, `Infinity`, `NaN`). Fix proposal (after OK): add the range-widget warning (close) to those, or
   skip them.
2. **Possible new conversions** (the model was right where the converter skips): `normalize-space()=literal`,
   `translate()` that maps A–Z to a–z, `string-length()=n`, a union branch on an attribute Android never writes, and
   `contains(@text,"")` → `new UiSelector()`.
   All are rare in the corpus: one real-world locator in this sample (A1540).
3. No other converter UiSelector failed.
   - DEPTH and TOAST differences (as in `audit/device/run.js`) count as equal.
   - 5 results are DRIFT, the documented close forms: a `childSelector` for `//A//B`, and `android.view.View` for
     class-less elements.
   - 2 are VACUOUS. C07 tests `@package`, which LocatorLab cannot set. H11 found nothing on these screens. Stage 3
     checked both.

## Limits

- One run of one model: indicative, not a benchmark.
- The device check covers the 100 differences only.
- DRIFT gives the model the same credit as the converter's documented close forms, although the model gave no
  warning.
- Generated screens include line-break traps that real apps do not have, so those failures are counted apart
  (WRONG-LB).
