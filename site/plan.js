// Plan page: PLAN.md → one static HTML page. Reads only two structured parts of the plan, the
// stage table under "## 6. Stages" and the numbered list under "## Backlog"; the prose stays
// in PLAN.md. A malformed table or an unknown status throws, so a stale page cannot ship.
const STATUSES = ['done', 'doing', 'todo', 'optional'];
const REPO = 'https://github.com/domovou69/xpath-to-uiselector';

function section(md, heading) {
  const lines = md.split('\n');
  const from = lines.findIndex(l => l.startsWith('## ') && l.slice(3).startsWith(heading));
  if (from < 0) throw new Error(`PLAN.md: no "## ${heading}" section`);
  let to = lines.findIndex((l, i) => i > from && l.startsWith('## '));
  if (to < 0) to = lines.length;
  return lines.slice(from + 1, to);
}

// split a table row on `|` outside backticks
function cells(row) {
  const out = [];
  let cur = '', tick = false;
  for (const ch of row.trim().replace(/^\||\|$/g, '')) {
    if (ch === '`') tick = !tick;
    if (ch === '|' && !tick) { out.push(cur.trim()); cur = ''; } else cur += ch;
  }
  out.push(cur.trim());
  return out;
}

function parsePlan(md) {
  const rows = section(md, '6. Stages').filter(l => l.startsWith('|'));
  if (rows.length < 3) throw new Error('PLAN.md: the stage table is missing');
  const head = cells(rows[0]).map(c => c.toLowerCase());
  const col = name => { const i = head.indexOf(name); if (i < 0) throw new Error(`PLAN.md: stage table has no "${name}" column`); return i; };
  const [iN, iName, iStatus, iResult, iEst] = ['#', 'stage', 'status', 'result', 'estimate'].map(col);
  const stages = rows.slice(2).map(r => {
    const c = cells(r);
    if (c.length !== head.length) throw new Error(`PLAN.md: stage row has ${c.length} cells, expected ${head.length}: ${r.slice(0, 60)}`);
    return { n: c[iN], title: c[iName], status: c[iStatus], result: c[iResult], estimate: c[iEst] };
  });

  const items = [];
  for (const l of section(md, 'Backlog')) {
    const m = /^(\d+)\. (.*)$/.exec(l);
    if (m) items.push({ n: m[1], text: m[2] });
    else if (items.length && /^\s+\S/.test(l)) items[items.length - 1].text += ' ' + l.trim();
  }
  const backlog = items.map(({ n, text }) => {
    const m = /^\[(\w+)\] ([^:]+): ?(.*)$/.exec(text);
    if (!m) throw new Error(`PLAN.md: backlog item ${n} must read "[status] Title: text"`);
    return { n, status: m[1], title: m[2], text: m[3] };
  });

  for (const s of [...stages, ...backlog]) {
    if (!STATUSES.includes(s.status)) throw new Error(`PLAN.md: unknown status "${s.status}" on "${s.title}"`);
  }
  const ids = stages.map(s => s.n);
  if (new Set(ids).size !== ids.length) throw new Error('PLAN.md: duplicate stage numbers');
  if (!stages.length) throw new Error('PLAN.md: no stages');
  return { stages, backlog };
}

const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// inline markdown: `code` and [text](url); relative links point into the repository
function inline(s) {
  return esc(s)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, t, u) => {
      const href = /^https?:/.test(u) ? u : `${REPO}/${u.endsWith('/') ? 'tree' : 'blob'}/main/${u.replace(/^\.\//, '')}`;
      return `<a href="${href}">${t}</a>`;
    });
}

const LABEL = { done: 'done', doing: 'in progress', todo: 'to do', optional: 'optional' };

function row(status, title, num, meta, body) {
  return `<details class="item ${status}"><summary><span class="badge ${status}">${LABEL[status]}</span>`
    + `<span class="num">${esc(num)}</span><span class="title">${inline(title)}</span>${meta ? `<span class="meta">${inline(meta)}</span>` : ''}</summary>`
    + `<div class="body">${inline(body)}</div></details>`;
}

function renderPlan(plan, template) {
  const all = plan.stages;
  const done = all.filter(s => s.status === 'done').length;
  const stages = all.map(s => row(s.status, s.title, s.n, s.estimate.split(';')[0], s.result)).join('\n');
  const backlog = plan.backlog.map(b => row(b.status, b.title, b.n, '', b.text)).join('\n');
  return template
    .replace('<!--PROGRESS-->', `${done} of ${all.length} stages done`)
    .replace('<!--PCT-->', String(Math.round(100 * done / all.length)))
    .replace('<!--STAGES-->', stages)
    .replace('<!--BACKLOG-->', backlog);
}

module.exports = { parsePlan, renderPlan, STATUSES };
