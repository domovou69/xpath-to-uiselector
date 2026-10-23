# LLMs vs the converter

Claude models convert the same 680 XPaths as the converter when simply asked to. Their answers are compared with the
converter's by text; every difference is then checked on the emulator. The comparison is indicative, not a benchmark:
one run per model, no averaging. The iOS version of this comparison:
[xpath-to-class-chain, audit/llm](https://github.com/domovou69/xpath-to-class-chain/tree/main/audit/llm).

| File | Role |
| --- | --- |
| `build-input.js` | Builds `input.json` (shuffled `{ id, xpath }`) and `key.json` (group, source id, the converter's answer; never shown to a model). 149 edge cases (every distinct XPath of `audit/spec/cases.js`) + 531 real-world locators: a sample of the 1603 distinct Android XPaths of the corpus, stratified by project and by the converter's outcome (exact / close / skip), seeded. Runtime values are filled in first, so the model and the converter get the same plain string |
| `prompt.md` | The prompt every run gets (no rules) |
| `rules.md` | The Android conversion rules, fitted to the mistakes of the runs without rules (Opus, Sonnet, Haiku). The only rules file: it is rewritten in place, and git history keeps the old versions |
| `make-run-prompt.js` | `node audit/llm/make-run-prompt.js` → `prompt-rules.md`: the task paragraph of `prompt.md`, the rules, then the output format. Run with `PROMPT=audit/llm/prompt-rules.md node audit/llm/run.js …`; every run record keeps the full prompt it got (`promptText`) |
| `refresh-key.js` | `node audit/llm/refresh-key.js` refreshes only the converter's answers in `key.json` after a converter change; `input.json` and the sample stay as they are (re-running `build-input.js` would draw a new sample once `audit/spec/cases.js` changes) |
| `run.js` | One run: `node audit/llm/run.js <haiku\|sonnet\|opus> <low\|medium\|high\|xhigh> <name>` → `runs/<model>-<effort>-<name>.json`. A fresh temp folder outside the repository with `input.json` only; tools Read + Write; no settings, hooks, MCP servers or saved session; the parent session's environment is not passed on. Time, tokens and cost come from the CLI's JSON result (`total_cost_usd` is the API price, not what a subscription is charged) |
| `compare.js` | `node audit/llm/compare.js <run> [details]` → `scores/<run>.json` and a table: agree, both skip, different UiSelector, UiSelector only from the model, only from the converter, unparsed, missing. Calls are compared as a set, so their order does not matter |
| `verify.js` | `node audit/llm/verify.js <run> [--resume]` checks every difference on the emulator: the XPath, the model's UiSelector and the converter's, on the edge-case screens (edge cases) or on generated random and matrix screens (real-world locators), plus a hand-made `llm` screen → `scores/<run>-device.json`. Needs what `audit/device/` needs; with Appium on 4724 set `APPIUM_URL`; `--summary` re-scores the saved lookups without a device. A difference only in range widgets (their value is a page-source text) is DRIFT, like the converter's close form; a UiSelector for an XPath the server rejects is WRONG |
| `table.js` | `node audit/llm/table.js <run>`: one final verdict per id (same, CORRECT, DRIFT, WRONG, WRONG-LB, INVALID, missed, right skip) → table and `scores/<run>-final.json` |
| `pilot-report.md` | Step 1: Opus 5.5 medium, no rules — results, the model's mistakes, converter findings |
| `runs/`, `scores/` | Raw run records, per-id categories and device results |

Requirements: the Claude Code CLI. `run.js` looks for the binary bundled with the VS Code extension; set `CLAUDE_BIN`
to use another.
