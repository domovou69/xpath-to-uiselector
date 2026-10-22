#!/usr/bin/env node
// Monthly upstream watch, second step: reads out/upstream-meta.json and out/upstream-changes.md (check.js) and,
// when a watched file changed or a release cannot be compared, opens a GitHub issue (label `upstream`) unless an
// open one already names the same versions. Deterministic: any change to a watched file is reported.
// Usage: node audit/upstream/report.js [--dry-run]   (or env DRY_RUN=true: print the issue body only)
const fs = require('fs'), path = require('path'), { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '../..');
const OUT = process.env.UPSTREAM_OUT || path.join(ROOT, 'out');
const DRY = process.argv.includes('--dry-run') || process.env.DRY_RUN === 'true';
const BODY_LIMIT = 60000; // GitHub rejects an issue body over 65536 characters

const fail = msg => { console.error(`upstream report: ${msg}`); process.exit(1); };
let meta, changes;
try {
  meta = JSON.parse(fs.readFileSync(path.join(OUT, 'upstream-meta.json'), 'utf8'));
  changes = fs.readFileSync(path.join(OUT, 'upstream-changes.md'), 'utf8');
} catch (e) { fail(`run check.js first: ${e.message}`); }

const newer = meta.components.filter(c => c.newer);
const issues = meta.issues || [], moved = issues.filter(i => i.changed);
const filesChanged = meta.components.some(c => c.files.length || c.missingTag);
const versions = meta.components.map(c => `- ${c.name}: ${c.base}${c.newer ? ` → ${c.latest}` : ' (no newer release)'}`).join('\n');
const summary = [
  filesChanged ? 'A watched upstream file changed (or a release cannot be compared). The rules that cite it may no longer hold.'
    : newer.length ? 'Newer releases, but no watched file changed.' : 'No newer release.',
  moved.length ? `A tracked issue changed: ${moved.map(i => `#${i.number}`).join(', ')}.` : '',
].filter(Boolean).join(' ');
const tracked = issues.map(i => `- Tracked ${i.repo}#${i.number}: ${i.status}. What you need to do: ${i.action}`).join('\n');
const summaryMd = [`**${meta.hasChanges ? 'Action needed.' : 'Nothing to do.'}** ${summary}`, '', `Baseline \`checked\`: ${meta.checkedDate}.`, '', versions, ...(tracked ? ['', tracked] : []), ''].join('\n');

if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `## Upstream watch\n\n${summaryMd}\n${changes}\n`);
console.log(summaryMd);
if (!meta.hasChanges) process.exit(0);

const key = [...newer.map(c => `${c.id}@${c.latest}`), ...moved.map(i => `#${i.number}@${i.state}/${i.comments}`)].join(' ');
const todo = !filesChanged
  ? '**What to do:** see "What you need to do" in the tracked issues above. Close this issue after updating `seen`.'
  : '**What to do:** read the changed files against the reference rows in the "Cited by" column. If a rule may have ' +
  'changed, re-run the edge cases (`npm run oracle`) and the real-world fuzz (`npm run oracle:fuzz`) on the emulator with ' +
  'the new versions (`audit/device/README.md`). When the ' +
  'converter still behaves the same, update `checked` in `audit/upstream.json` through a PR, then `docs/environment.md`, ' +
  'docs/results.md and the devDependencies. Close this issue.';
let detail = changes;
if (detail.length > BODY_LIMIT) detail = `${detail.slice(0, BODY_LIMIT)}\n\n… cut; the full list is in the run artifact \`upstream-watch\`.`;
const body = [summaryMd, todo, '', detail, '', `<!-- upstream-key: ${key} -->`].join('\n');
const title = filesChanged
  ? `Upstream: ${newer.map(c => `${c.name} ${c.latest}`).join(', ')} changed files the converter depends on`
  : `Upstream: tracked issue ${moved.map(i => `${i.repo}#${i.number}`).join(', ')} changed`;

if (DRY) { console.log(`\n--- dry run: issue not created ---\nTitle: ${title}\n\n${body}`); process.exit(0); }

const gh = (...a) => execFileSync('gh', a, { encoding: 'utf8' });
const open = JSON.parse(gh('issue', 'list', '--label', 'upstream', '--state', 'open', '--limit', '100', '--json', 'number,body'));
const dup = open.find(i => (i.body || '').includes(`<!-- upstream-key: ${key} -->`));
if (dup) { console.log(`\nopen issue #${dup.number} already names these versions: no new issue`); process.exit(0); }
gh('label', 'create', 'upstream', '--color', 'D93F0B', '--description', 'Upstream release may affect the converter', '--force');
console.log('\n' + gh('issue', 'create', '--title', title, '--label', 'upstream', '--body', body).trim());
