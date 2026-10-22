#!/usr/bin/env node
// Monthly upstream watch: compares the versions in audit/upstream.json `checked` with the latest releases and
// collects the changes to the watched upstream files, with the reference rows that cite each file. No
// dependencies, Node 20+, no LLM.
// Usage: node audit/upstream/check.js [--driver-base 8.6.0] [--server-base 10.6.0]
// (the same overrides as env DRIVER_BASE, SERVER_BASE; empty means `checked`).
// The server's latest version is the one the latest driver pins (`latestFrom`), not the newest server on npm:
// users get the server through the driver.
// Writes out/upstream-meta.json and out/upstream-changes.md. Sets the GitHub Actions output
// `has_changes=true|false`. Exit 1 on any registry or API failure.
const fs = require('fs'), path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const OUT = process.env.UPSTREAM_OUT || path.join(ROOT, 'out');
const baseline = JSON.parse(fs.readFileSync(path.join(ROOT, 'audit/upstream.json'), 'utf8'));
const TOKEN = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || '';
const PATCH_LIMIT = 20000; // characters per file in the issue body's details

const args = process.argv.slice(2);
const override = id => {
  const i = args.indexOf(`--${id}-base`);
  return ((i >= 0 ? args[i + 1] : process.env[`${id.toUpperCase()}_BASE`]) || '').trim().replace(/^v/, '');
};

async function get(url, { allow404 = false } = {}) {
  const headers = { 'User-Agent': 'xpath-to-uiselector-upstream-watch', Accept: 'application/json' };
  if (url.startsWith('https://api.github.com/')) {
    headers.Accept = 'application/vnd.github+json';
    if (TOKEN) headers.Authorization = `Bearer ${TOKEN}`;
  }
  const res = await fetch(url, { headers });
  if (allow404 && res.status === 404) return null;
  if (!res.ok) throw new Error(`GET ${url}: ${res.status} ${res.statusText} ${(await res.text()).slice(0, 300)}`);
  return res.json();
}

const cmp = (a, b) => {
  const x = a.split(/[.-]/).map(Number), y = b.split(/[.-]/).map(Number);
  for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) - (y[i] || 0);
  return 0;
};
const globRe = g => new RegExp('^' + g.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*') + '$');
const exact = v => String(v).replace(/^[\^~=v]+/, '');

// Reference rows (`| SRV-12 | … |`) that name a file by its base name (`UiElementSnapshot`).
function referenceRows() {
  const dir = path.join(ROOT, 'reference');
  const rows = [];
  for (const f of fs.readdirSync(dir).filter(f => f.endsWith('.md'))) {
    for (const line of fs.readFileSync(path.join(dir, f), 'utf8').split('\n')) {
      const m = /^\| ((?:SRV|SEL|XP)-\d+) \|/.exec(line);
      if (m) rows.push({ id: m[1], file: f, line });
    }
  }
  return rows;
}
const ROWS = referenceRows();
function citedBy(id, p) {
  if (id !== 'server') return [];
  if (p.includes('/model/settings/')) return ['docs/settings.md'];
  if (p === 'gradle/libs.versions.toml') return ['docs/environment.md (androidx uiautomator version)'];
  if (p === 'vendor/SOURCE_COMMIT') return ['docs/environment.md (PsychoPath commit)'];
  const base = path.basename(p).replace(/\.\w+$/, '');
  const re = new RegExp(`(?<![A-Za-z])${base}(?![A-Za-z])`);
  return ROWS.filter(r => re.test(r.line)).map(r => r.id);
}

async function tagRef(repo, tag) {
  const ref = await get(`https://api.github.com/repos/${repo}/git/ref/tags/${encodeURIComponent(tag)}`, { allow404: true });
  return ref ? tag : null;
}

async function component(id, spec, done) {
  const base = override(id) || baseline.checked[id];
  let latest;
  if (spec.latestFrom) {
    const from = done[spec.latestFrom.component];
    const pkg = await get(`https://registry.npmjs.org/${baseline.watch[spec.latestFrom.component].npm}/${from.latest}`);
    latest = exact((pkg.dependencies || {})[spec.latestFrom.dependency] || base);
  } else {
    latest = (await get(`https://registry.npmjs.org/${spec.npm}/latest`)).version;
  }
  const npmLatest = spec.latestFrom ? (await get(`https://registry.npmjs.org/${spec.npm}/latest`)).version : latest;
  const tag = v => spec.tag.replace('{version}', v);
  const r = { id, name: spec.name, repo: spec.repo, base, latest, npmLatest, newer: cmp(latest, base) > 0, files: [], commits: [] };
  if (!r.newer) return r;

  // A release on npm without its tag in the repository cannot be compared: report it rather than pass.
  const [B, L] = [await tagRef(spec.repo, tag(base)), await tagRef(spec.repo, tag(latest))];
  if (!B || !L) {
    r.missingTag = [!B && tag(base), !L && tag(latest)].filter(Boolean);
    return r;
  }
  r.compareUrl = `https://github.com/${spec.repo}/compare/${tag(base)}...${tag(latest)}`;
  const api = `https://api.github.com/repos/${spec.repo}`, eB = encodeURIComponent(B), eL = encodeURIComponent(L);

  // 1. which watched files changed: blob SHAs of both trees (the compare API lists at most 300 files)
  const tree = async t => {
    const x = await get(`${api}/git/trees/${t}?recursive=1`);
    if (x.truncated) throw new Error(`${spec.repo} tree ${decodeURIComponent(t)} is truncated: watched files cannot be checked`);
    return new Map(x.tree.filter(e => e.type === 'blob').map(e => [e.path, e.sha]));
  };
  const [oldTree, newTree] = [await tree(eB), await tree(eL)];
  const watch = spec.files.map(f => (typeof f === 'string' ? { path: f } : f));
  const watchOf = p => watch.find(w => globRe(w.path).test(p));
  const changed = [...new Set([...oldTree.keys(), ...newTree.keys()])].filter(p => watchOf(p) && oldTree.get(p) !== newTree.get(p)).sort();

  // 2. commits in the range (pages of 100) and the compare patches (first page only, 300 files max)
  let compareFiles = [];
  const commitList = [];
  for (let page = 1; ; page++) {
    const c = await get(`${api}/compare/${eB}...${eL}?per_page=100&page=${page}`);
    if (page === 1) { r.totalCommits = c.total_commits; compareFiles = c.files || []; }
    commitList.push(...c.commits.map(k => ({ sha: k.sha, title: k.commit.message.split('\n')[0], url: k.html_url })));
    if (c.commits.length < 100) break;
  }
  const inRange = new Map(commitList.map(k => [k.sha, k]));

  // 3. per file: the commits that touched it, its patch (from compare, else from each commit), the rows citing it
  const seen = new Set();
  for (const p of changed) {
    const status = !oldTree.has(p) ? 'added' : !newTree.has(p) ? 'removed' : 'modified';
    const list = [];
    for (let page = 1; page <= 5; page++) {
      const chunk = await get(`${api}/commits?sha=${eL}&path=${encodeURIComponent(p)}&per_page=100&page=${page}`);
      list.push(...chunk);
      if (chunk.length < 100 || !chunk.some(k => inRange.has(k.sha))) break;
    }
    const commits = list.filter(k => inRange.has(k.sha)).map(k => inRange.get(k.sha)).reverse();
    const cf = compareFiles.find(f => f.filename === p);
    let patch = cf && cf.patch, additions = cf ? cf.additions : 0, deletions = cf ? cf.deletions : 0;
    if (!cf && status !== 'removed') {
      const parts = [];
      for (const k of commits) {
        const f = ((await get(`${api}/commits/${k.sha}`)).files || []).find(f => f.filename === p);
        if (!f) continue;
        additions += f.additions; deletions += f.deletions;
        parts.push(`# commit ${k.sha.slice(0, 8)}: ${k.title}\n${f.patch || '# (no patch: too large)'}`);
      }
      patch = parts.length ? parts.join('\n') : undefined;
    }
    const w = watchOf(p);
    if (w.match && patch && !new RegExp(w.match).test(patch)) continue;
    r.files.push({ filename: p, status, additions, deletions, commits, patch, cites: citedBy(id, p),
      url: `https://github.com/${spec.repo}/blob/${tag(status === 'removed' ? base : latest)}/${p}` });
    for (const k of commits) if (!seen.has(k.sha)) { seen.add(k.sha); r.commits.push(k); }
  }
  return r;
}

// Tracked issues (`issues` in audit/upstream.json): compared with the state and comment count in `seen`.
async function trackedIssue(t) {
  const x = await get(`https://api.github.com/repos/${t.repo}/issues/${t.number}`);
  const r = { repo: t.repo, number: t.number, title: x.title, url: x.html_url, why: t.why, seen: t.seen,
    state: x.state, comments: x.comments, updated: x.updated_at.slice(0, 10) };
  const fresh = x.comments - t.seen.comments;
  r.changed = x.state !== t.seen.state || fresh > 0;
  r.status = x.state !== t.seen.state ? `${t.seen.state} → ${x.state}` : fresh > 0 ? `${fresh} new comment(s)` : `still ${x.state}, no new comments`;
  r.action = !r.changed ? `none (checked against ${t.seen.date})`
    : x.state === 'closed' ? 'read how it was resolved; if Appium added a new locator strategy, plan the converter target for it and update the README note; then set `seen` in audit/upstream.json'
    : 'read the new comments (a removal date, a BySelector parser, a new strategy?); then set `seen` in audit/upstream.json';
  return r;
}

function issuesMd(issues) {
  if (!issues.length) return '';
  const L = ['### Tracked issues', '', '| Issue | Status | Last activity | What you need to do |', '| --- | --- | --- | --- |'];
  for (const i of issues) L.push(`| [${i.repo}#${i.number}](${i.url}) ${i.title} | ${i.status} | ${i.updated} | ${i.action} |`);
  L.push('', ...issues.map(i => `- #${i.number}: ${i.why}.`), '');
  return L.join('\n');
}

function changesMd(results) {
  const L = [];
  for (const r of results) {
    L.push(`### ${r.name}: ${r.base}${r.newer ? ` → ${r.latest}` : ' (no newer release)'}`, '');
    if (r.npmLatest !== r.latest) L.push(`Newest on npm: ${r.npmLatest}; the latest driver pins ${r.latest}.`, '');
    if (!r.newer) continue;
    if (r.missingTag) { L.push(`**Cannot compare:** no tag ${r.missingTag.map(t => `\`${t}\``).join(', ')} in ${r.repo}. Compare the sources by hand.`, ''); continue; }
    L.push(`Compare: ${r.compareUrl} (${r.totalCommits} commits in total).`, '');
    if (!r.files.length) { L.push('No watched file changed.', ''); continue; }
    L.push('| File | Change | Cited by | Commits |', '| --- | --- | --- | --- |');
    for (const f of r.files) {
      L.push(`| [${path.basename(f.filename)}](${f.url}) | ${f.status}, +${f.additions} −${f.deletions} | ${f.cites.join(', ') || '—'} | ${f.commits.map(k => `[${k.sha.slice(0, 7)}](${k.url})`).join(' ') || '—'} |`);
    }
    L.push('');
    for (const f of r.files.filter(f => f.patch)) {
      const p = f.patch.length > PATCH_LIMIT ? `${f.patch.slice(0, PATCH_LIMIT)}\n… (cut at ${PATCH_LIMIT} of ${f.patch.length} characters)` : f.patch;
      L.push(`<details><summary>${f.filename}</summary>`, '', '```diff', p, '```', '', '</details>', '');
    }
  }
  return L.join('\n');
}

(async () => {
  const done = {};
  for (const [id, spec] of Object.entries(baseline.watch)) done[id] = await component(id, spec, done);
  const results = Object.values(done);
  const issues = [];
  for (const t of baseline.issues || []) issues.push(await trackedIssue(t));
  const hasChanges = results.some(r => r.files.length || r.missingTag) || issues.some(i => i.changed);
  fs.mkdirSync(OUT, { recursive: true });
  const meta = { checkedDate: baseline.checked.date, hasChanges, components: results.map(({ commits, ...r }) =>
    ({ ...r, files: r.files.map(f => ({ filename: f.filename, status: f.status, cites: f.cites })), commits: commits.map(k => k.url) })), issues };
  fs.writeFileSync(path.join(OUT, 'upstream-meta.json'), JSON.stringify(meta, null, 2) + '\n');
  fs.writeFileSync(path.join(OUT, 'upstream-changes.md'), [changesMd(results), issuesMd(issues)].filter(Boolean).join('\n'));
  for (const r of results) {
    const what = !r.newer ? 'no newer release' : r.missingTag ? `cannot compare (no tag ${r.missingTag.join(', ')})`
      : r.files.length ? `${r.files.length} watched file(s) changed: ${r.files.map(f => path.basename(f.filename)).join(', ')}` : 'no watched file changed';
    console.log(`${r.name}: ${r.base} → ${r.latest}${r.npmLatest !== r.latest ? ` (npm ${r.npmLatest})` : ''}: ${what}`);
  }
  if (issues.length) console.log('\nTracked issues:');
  for (const i of issues) console.log(`- ${i.repo}#${i.number} (${i.title}): ${i.status}, last activity ${i.updated}\n  What you need to do: ${i.action}`);
  if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `has_changes=${hasChanges}\n`);
})().catch(e => { console.error(e.message); process.exit(1); });
