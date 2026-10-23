// Builds the runnable prompt with rules: the task paragraph of prompt.md, the rules (rules.md), then the output
// format of prompt.md. rules.md is the only rules file and is rewritten in place; each run record keeps the full
// prompt it got (run.js promptText), so a run stays traceable after the rules change.
// Usage: node audit/llm/make-run-prompt.js   → audit/llm/prompt-rules.md (then PROMPT=audit/llm/prompt-rules.md node audit/llm/run.js …)
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const task = fs.readFileSync(path.join(__dirname, 'prompt.md'), 'utf8').split('\n\n');
const rules = fs.readFileSync(path.join(__dirname, 'rules.md'), 'utf8').trim();
const out = [task[0],
  'The rules below describe how to convert. Where they say to reply with a UiSelector or "SKIP: <reason>", use the output format given after them.',
  '--- RULES ---\n' + rules + '\n--- END OF RULES ---', ...task.slice(1)].join('\n\n');
fs.writeFileSync(path.join(__dirname, 'prompt-rules.md'), out.endsWith('\n') ? out : out + '\n');
console.log(`prompt-rules.md: ${out.length} characters (rules ${rules.length})`);
