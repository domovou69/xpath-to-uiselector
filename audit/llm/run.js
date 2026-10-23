// One run: a model converts input.json in an empty folder outside the repository.
// Usage: node audit/llm/run.js <haiku|sonnet|opus> <low|medium|high|xhigh> <name>   (PROMPT=<file> picks another prompt)
// Writes runs/<model>-<effort>-<name>.json: run metadata, the CLI's JSON result (time, tokens, cost) and the merged output.
// Same conditions for every model: a fresh temp folder with input.json only, tools Read + Write, no settings, hooks,
// MCP servers or saved session, and none of the parent session's environment.
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const MODELS = { haiku: 'claude-haiku-5-5', sonnet: 'claude-sonnet-5-5', opus: 'claude-opus-5-5' };
const EFFORTS = ['low', 'medium', 'high', 'xhigh']; // never max (project rule)
const [model, effort, name] = process.argv.slice(2);
if (!MODELS[model] || !EFFORTS.includes(effort) || !name) {
  console.error('usage: node audit/llm/run.js <haiku|sonnet|opus> <low|medium|high|xhigh> <name>');
  process.exit(2);
}
const CLI = process.env.CLAUDE_BIN || (() => {
  const ext = path.join(os.homedir(), '.vscode/extensions');
  const dir = fs.readdirSync(ext).filter(d => d.startsWith('anthropic.claude-code-')).sort().pop();
  return path.join(ext, dir, 'resources/native-binary/claude');
})();
const TIMEOUT_MIN = +(process.env.TIMEOUT_MIN || 60);
const OUT = path.join(__dirname, 'runs');
fs.mkdirSync(OUT, { recursive: true });
const file = `${model}-${effort}-${name}.json`;
if (fs.existsSync(path.join(OUT, file))) { console.error(`runs/${file} exists`); process.exit(2); }

// 1. a new empty folder outside the repository (system temp dir, neutral name) with input.json only
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'locators-'));
fs.copyFileSync(path.join(__dirname, 'input.json'), path.join(work, 'input.json'));
const prompt = fs.readFileSync(process.env.PROMPT || path.join(__dirname, 'prompt.md'), 'utf8');

// 2. isolated run
const env = Object.fromEntries(['HOME', 'USER', 'LOGNAME', 'PATH', 'SHELL', 'TMPDIR', 'LANG'].filter(k => process.env[k]).map(k => [k, process.env[k]]));
const args = ['-p', prompt, '--model', MODELS[model], '--effort', effort, '--tools', 'Read,Write',
  '--setting-sources', '', '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}',
  '--permission-mode', 'acceptEdits', '--no-session-persistence', '--output-format', 'json'];
const t0 = Date.now(), started = new Date().toISOString();
const p = spawnSync(CLI, args, { cwd: work, env, encoding: 'utf8', maxBuffer: 1e9, timeout: TIMEOUT_MIN * 60e3 });
const wallMs = Date.now() - t0;

// 3. output.json or output-N.json parts; a missing or broken file is a failed run
let cli = null; try { cli = JSON.parse(p.stdout); } catch { /* kept raw below */ }
const files = fs.readdirSync(work).filter(f => f !== 'input.json');
const parts = files.filter(f => /^output(-\d+)?\.json$/.test(f)).sort((a, b) => (+(a.match(/\d+/) || [0])[0]) - (+(b.match(/\d+/) || [0])[0]));
let output = null, error = null;
if (!parts.length) error = 'no output file';
else {
  output = [];
  for (const f of parts) {
    try { const j = JSON.parse(fs.readFileSync(path.join(work, f), 'utf8')); if (!Array.isArray(j)) throw new Error('not an array'); output.push(...j); }
    catch (e) { error = `${f}: ${e.message}`; output = null; break; }
  }
}
const rec = {
  model, modelId: MODELS[model], effort, name, prompt: path.basename(process.env.PROMPT || 'prompt.md'), started, wallMs,
  cliVersion: spawnSync(CLI, ['--version'], { encoding: 'utf8' }).stdout.trim(),
  exitCode: p.status, signal: p.signal, timedOut: !!(p.error && p.error.code === 'ETIMEDOUT'), stderr: (p.stderr || '').slice(-4000),
  error, files, parts, cli: cli || { rawStdout: (p.stdout || '').slice(-4000) }, output,
};
fs.writeFileSync(path.join(OUT, file), JSON.stringify(rec, null, 1) + '\n');
fs.rmSync(work, { recursive: true, force: true });
const cost = cli && cli.total_cost_usd != null ? `$${cli.total_cost_usd.toFixed(2)}` : '$?';
console.log(`${file}: ${error || `${output.length} entries`} · ${(wallMs / 60e3).toFixed(1)} min · ${cost} · exit ${p.status}${rec.timedOut ? ' TIMEOUT' : ''}`);
