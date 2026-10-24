// Generates the article SVGs (data copied from the reports the article cites).
// node docs/articles/img/charts.js docs/articles/img
// then for each SVG: docs/articles/img/render.sh <abs svg> <abs png> <width> <height>  (macOS, Google Chrome)
const fs = require('fs');
const path = require('path');
const out = process.argv[2];

const C = {
  surface: '#fcfcfb', ink: '#0b0b0b', ink2: '#52514e', muted: '#7a7872', grid: '#ebeae4', axis: '#c3c2b7',
  opus: '#2a78d6', sonnet: '#eb6834', haiku: '#1baf7a', xpath: '#eb6834', uis: '#2a78d6', accent: '#6250d6',
  good: '#008300', bad: '#c9302c',
};
const FONT = `font-family="-apple-system, 'SF Pro Text', 'Helvetica Neue', Arial, sans-serif"`;
const MONO = `'SF Mono', Menlo, Consolas, monospace`;
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const t = (x, y, s, o = {}) =>
  `<text x="${x}" y="${y}" font-size="${o.size || 15}" fill="${o.fill || C.ink}"` +
  (o.anchor ? ` text-anchor="${o.anchor}"` : '') + (o.weight ? ` font-weight="${o.weight}"` : '') +
  (o.family ? ` font-family="${o.family}"` : '') + (o.extra || '') + `>${s}</text>`;
const svg = (w, h, title, body) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img" aria-label="${esc(title)}" ${FONT}>\n` +
  `<title>${esc(title)}</title>\n<rect width="${w}" height="${h}" fill="${C.surface}"/>\n${body}\n</svg>\n`;
const write = (name, s) => fs.writeFileSync(path.join(out, name), s);

// 1. Speed: lookup time vs elements (benchmark REPORT.md), plus the depth limit.
{
  const pts = [[100, 44, 22, '49 %', 22], [497, 256, 204, '20 %', 52], [1000, 557, 485, '13 %', 71], [1989, 1150, 1018, '12 %', 133]];
  const X0 = 90, X1 = 520, Y0 = 400, Y1 = 130;
  const x = (n) => X0 + (n / 2000) * (X1 - X0);
  const y = (ms) => Y0 - (ms / 1200) * (Y0 - Y1);
  let b = '';
  b += t(40, 48, 'Time per element lookup vs elements in the tree', { size: 22, weight: 600 });
  b += t(40, 76, 'Emulator: Android 16 (AOSP, API 36) on an Apple M1 Pro', { fill: C.ink2, weight: 600 });
  b += t(40, 98, 'Appium 3.8.0, UiAutomator2 driver 8.7.0 (server 10.6.6), default settings · 30 cases per size, median of 3 runs', { fill: C.ink2, size: 14 });
  b += '<g transform="translate(0,24)">';
  // legend
  b += `<line x1="40" y1="104" x2="62" y2="104" stroke="${C.xpath}" stroke-width="3" stroke-linecap="round"/>` + t(70, 109, 'XPath', { fill: C.ink2 });
  b += `<line x1="130" y1="104" x2="152" y2="104" stroke="${C.uis}" stroke-width="3" stroke-linecap="round"/>` + t(160, 109, 'UiSelector', { fill: C.ink2 });
  for (const v of [0, 400, 800, 1200]) {
    b += `<line x1="${X0}" y1="${y(v)}" x2="${X1}" y2="${y(v)}" stroke="${v ? C.grid : C.axis}"/>`;
    b += t(X0 - 10, y(v) + 5, v ? `${v / 1000} s`.replace('0.', '0.') : '0', { anchor: 'end', fill: C.muted, size: 14 });
  }
  for (const [n] of pts) b += t(x(n), Y0 + 24, n === 1989 ? '2000' : n === 497 ? '500' : n, { anchor: 'middle', fill: C.ink2, size: 14 });
  b += t((X0 + X1) / 2, Y0 + 48, 'elements in the tree', { anchor: 'middle', fill: C.muted, size: 14 });
  b += t(X0 - 10, Y0 + 78, 'saved', { anchor: 'end', fill: C.muted, size: 14 });
  for (const [n, , , pct, saved] of pts) {
    b += t(x(n), Y0 + 78, pct, { anchor: 'middle', fill: C.ink, size: 14, weight: 600 });
    b += t(x(n), Y0 + 96, `${saved} ms`, { anchor: 'middle', fill: C.ink2, size: 13 });
  }
  for (const [key, col, idx] of [['xpath', C.xpath, 1], ['uis', C.uis, 2]]) {
    b += `<polyline fill="none" stroke="${col}" stroke-width="2.5" stroke-linejoin="round" points="${pts.map((p) => `${x(p[0])},${y(p[idx])}`).join(' ')}"/>`;
    for (const p of pts) b += `<circle cx="${x(p[0])}" cy="${y(p[idx])}" r="5" fill="${col}" stroke="${C.surface}" stroke-width="2"/>`;
  }
  b += t(x(1989) + 12, y(1150) + 5, '1.15 s', { size: 15 });
  b += t(x(1989) + 12, y(1018) + 10, '1.02 s', { size: 15 });

  // depth panel
  const DX = 610, DW = 230, DY0 = 400, DY1 = 180;
  const dy = (lvl) => DY0 - (lvl / 100) * (DY0 - DY1);
  b += t(DX, 130, 'Deepest element found', { size: 17, weight: 600 });
  b += t(DX, 152, 'in a chain 100 levels deep', { fill: C.ink2, size: 14 });
  for (const v of [0, 50, 100]) {
    b += `<line x1="${DX}" y1="${dy(v)}" x2="${DX + DW}" y2="${dy(v)}" stroke="${v ? C.grid : C.axis}"/>`;
    b += t(DX + DW + 8, dy(v) + 5, v, { fill: C.muted, size: 14 });
  }
  // limit line at 70
  b += `<line x1="${DX}" y1="${dy(70)}" x2="${DX + DW}" y2="${dy(70)}" stroke="${C.ink2}" stroke-dasharray="4 4"/>`;
  b += t(DX + DW + 8, dy(70) + 5, 'limit 70', { fill: C.ink2, size: 14 });
  const bar = (cx, lvl, col, label) => {
    const w = 64, top = dy(lvl);
    return `<path d="M${cx - w / 2},${DY0} V${top + 4} q0,-4 4,-4 H${cx + w / 2 - 4} q4,0 4,4 V${DY0} Z" fill="${col}"/>` +
      t(cx, top + 24, lvl, { anchor: 'middle', weight: 600, fill: C.surface }) + t(cx, DY0 + 24, label, { anchor: 'middle', fill: C.ink2, size: 14 });
  };
  b += bar(DX + 60, 66, C.xpath, 'XPath');
  b += bar(DX + 170, 100, C.uis, 'UiSelector');
  b += t(DX, DY0 + 56, 'XPath finds nothing below level 66;', { fill: C.ink2, size: 14 });
  b += t(DX, DY0 + 76, 'UiSelector found every marker.', { fill: C.ink2, size: 14 });
  b += '</g>';
  write('speed-chart.svg', svg(940, 544, 'Time per element lookup vs elements in the tree, XPath and UiSelector', b));
}

// 2. Claude 5.5 runs: S score (edge cases) vs cost per run, no rules and with rules, and a table of S, R, wrong, tokens, time, cost.
{
  // S, R: audit/llm/table.js (points over the locators that have a UiSelector: correct +1, close +0.5, wrong -1)
  const runs = [
    { name: 'Opus 5.5', col: C.opus, plain: { s: 56.7, r: 80.1, w: 47, tok: '89k (46k)', min: 12.2, cost: 3.0 }, rules: { s: 89.4, r: 96.3, w: 1, tok: '49k (12k)', min: 5.9, cost: 1.84 } },
    { name: 'Sonnet 5.5', col: C.sonnet, plain: { s: 43.8, r: 80.5, w: 60, tok: '51k (15k)', min: 4.9, cost: 0.95 }, rules: { s: 89.4, r: 96.3, w: 1, tok: '46k (10k)', min: 4.1, cost: 0.89 } },
    { name: 'Haiku 5.5', col: C.haiku, plain: { s: 37.0, r: 78.7, w: 63, tok: '81k (42k)', min: 5.2, cost: 0.12 }, rules: { s: 87.5, r: 94.7, w: 4, tok: '103k (47k)', min: 6.3, cost: 0.33 } },
  ];
  const CONV = { s: 94.2, r: 96.5 };
  const X0 = 66, X1 = 476, Y0 = 432, Y1 = 92;
  const lmin = Math.log10(0.1), lmax = Math.log10(3.5);
  const x = (c) => X0 + ((Math.log10(c) - lmin) / (lmax - lmin)) * (X1 - X0);
  const y = (v) => Y0 - ((v - 30) / 70) * (Y0 - Y1);
  let b = '';
  b += t(40, 46, 'Claude 5.5 against the converter on 680 Android XPath locators', { size: 22, weight: 600 });
  b += t(18, (Y0 + Y1) / 2, 'S, edge cases', { anchor: 'middle', fill: C.ink2, size: 14, extra: ` transform="rotate(-90 18 ${(Y0 + Y1) / 2})"` });
  for (const v of [30, 40, 50, 60, 70, 80, 90, 100]) {
    b += `<line x1="${X0}" y1="${y(v)}" x2="${X1}" y2="${y(v)}" stroke="${v === 30 ? C.axis : C.grid}"/>`;
    b += t(X0 - 8, y(v) + 5, v, { anchor: 'end', fill: C.muted, size: 13 });
  }
  for (const c of [0.1, 0.2, 0.5, 1, 2, 3]) b += t(x(c), Y0 + 22, `$${c}`, { anchor: 'middle', fill: C.muted, size: 13 });
  b += t((X0 + X1) / 2, Y0 + 46, 'Cost per run, log scale (left is cheaper)', { anchor: 'middle', fill: C.ink2, size: 14 });
  // converter
  b += `<line x1="${X0}" y1="${y(CONV.s)}" x2="${X1}" y2="${y(CONV.s)}" stroke="${C.ink}" stroke-width="1.5" stroke-dasharray="6 5"/>`;
  b += `<text x="${X0 + 8}" y="${y(CONV.s) - 8}" font-size="13" fill="${C.ink}"><tspan font-weight="600">Converter</tspan> S ${CONV.s} · R ${CONV.r} · 0 wrong · free</text>`;
  const HALO = ` stroke="${C.surface}" stroke-width="4" paint-order="stroke" stroke-linejoin="round"`;
  // a two-line point label: name, then S and R
  const lab = (lx, ly, head, d, anchor = 'start') =>
    t(lx, ly, head, { size: 13, weight: 600, anchor, extra: HALO }) +
    t(lx, ly + 16, `S ${d.s.toFixed(1)} · R ${d.r.toFixed(1)}`, { size: 12, fill: C.ink2, anchor, extra: HALO });
  for (const m of runs) {
    const p = m.plain, r = m.rules;
    b += `<line x1="${x(p.cost)}" y1="${y(p.s)}" x2="${x(r.cost)}" y2="${y(r.s)}" stroke="${m.col}" stroke-width="2" stroke-dasharray="3 4"/>`;
    b += `<circle cx="${x(p.cost)}" cy="${y(p.s)}" r="8" fill="${m.col}" stroke="${C.surface}" stroke-width="2"/>`;
    b += `<circle cx="${x(r.cost)}" cy="${y(r.s)}" r="7" fill="${C.surface}" stroke="${m.col}" stroke-width="3.5"/>`;
  }
  const [opus, sonnet, haiku] = runs;
  // no rules: beside the filled points
  b += lab(x(haiku.plain.cost) + 14, y(haiku.plain.s) - 2, haiku.name, haiku.plain);
  b += lab(x(sonnet.plain.cost), y(sonnet.plain.s) + 26, sonnet.name, sonnet.plain, 'middle');
  b += lab(x(opus.plain.cost), y(opus.plain.s) + 26, opus.name, opus.plain, 'middle');
  // with the rules: below the rings, on the side away from each connector
  b += lab(x(haiku.rules.cost) + 10, y(haiku.rules.s) + 22, '+ rules', haiku.rules);
  b += lab(x(sonnet.rules.cost) + 10, y(sonnet.rules.s) + 24, '+ rules', sonnet.rules);
  b += lab(x(opus.rules.cost) + 14, y(opus.rules.s) - 2, '+ rules', opus.rules);

  // table on the right, as tall as the plot
  const TX = 528, TOP = Y1 - 6, cols = [['S', 730], ['R', 772], ['wrong', 824], ['output tokens', 906], ['min', 946], ['cost', 994]];
  b += `<rect x="${TX - 12}" y="${TOP}" width="${1010 - TX}" height="${Y0 - TOP}" rx="10" fill="#f1f0eb"/>`;
  b += t(TX, TOP + 34, 'Model, effort', { fill: C.ink, size: 12.5, weight: 600 });
  for (const [h, cx] of cols) {
    if (h === 'output tokens') b += t(cx, TOP + 26, 'tokens', { anchor: 'end', fill: C.ink, size: 12.5, weight: 600 }) + t(cx, TOP + 42, '(thinking)', { anchor: 'end', fill: C.ink, size: 12.5, weight: 600 });
    else b += t(cx, TOP + 34, h, { anchor: 'end', fill: C.ink, size: 12.5, weight: 600 });
  }
  let ty = TOP + 78;
  const row = (label, col, hollow, d) => {
    let s = hollow ? `<circle cx="${TX + 7}" cy="${ty - 5}" r="5.5" fill="${C.surface}" stroke="${col}" stroke-width="3"/>` : `<circle cx="${TX + 7}" cy="${ty - 5}" r="6.5" fill="${col}"/>`;
    s += t(TX + 22, ty, label, { size: 14 });
    const vals = [d.s.toFixed(1), d.r.toFixed(1), d.w, d.tok, d.min, d.cost === 0 ? 'free' : `$${d.cost.toFixed(2)}`].map(v => esc(v));
    cols.forEach(([, cx], i) => { s += t(cx, ty, vals[i], { anchor: 'end', size: 14, fill: C.ink }); });
    ty += 34;
    return s;
  };
  b += row('Converter', C.ink, false, { s: CONV.s, r: CONV.r, w: 0, tok: '–', min: '< 0.1', cost: 0 });
  ty += 6;
  for (const m of runs) {
    b += row(`${m.name}, medium`, m.col, false, m.plain);
    b += row('+ rules', m.col, true, m.rules);
    ty += 6;
  }
  b += t(40, 520, 'S = edge cases (104 of 149 have a UiSelector), R = real-world locators (387 of 531). Points over those: correct +1, close +0.5, wrong −1, skip 0;', { fill: C.muted, size: 12.5 });
  b += t(40, 538, 'so the converter, which has only a close form for some, is below 100. Wrong = other elements than the XPath, checked on an Android emulator.', { fill: C.muted, size: 12.5 });
  write('llm-chart.svg', svg(1020, 554, 'Claude 5.5 models against the converter: S score vs cost, no rules and with rules, with S, R, wrong answers, tokens, time and cost', b));
}

// 3. Mistakes of the three no-rules runs, by kind (donut).
{
  const parts = [
    ['textContains / textStartsWith: ignore case (debatable)', 65, C.accent, C.surface],
    ['Missing (?s): . stops at a line break', 38, '#8f85e3', C.ink],
    ['Values only the page source has', 18, '#a8a69e', C.ink],
    ['Java-style \\\\ escaping', 18, '#c3c2b7', C.ink],
    ['Positions: instance() in childSelector, //X[1]', 11, '#d6d5cc', C.ink],
    ['Other: classNameMatches, (?i), dropped tests', 20, '#e4e3dc', C.ink],
  ];
  const total = parts.reduce((s, p) => s + p[1], 0);
  const cx = 220, cy = 270, R = 150, r = 88;
  let b = '';
  b += t(40, 46, 'Why Claude’s UiSelectors were wrong', { size: 22, weight: 600 });
  b += t(40, 74, `${total} wrong answers of Opus, Sonnet and Haiku 5.5 without rules (680 locators each)`, { fill: C.ink2 });
  let a = -Math.PI / 2;
  const pt = (ang, rad) => [cx + rad * Math.cos(ang), cy + rad * Math.sin(ang)];
  for (const [, n, col, labCol] of parts) {
    const a2 = a + (n / total) * 2 * Math.PI;
    const [x1, y1] = pt(a, R), [x2, y2] = pt(a2, R), [x3, y3] = pt(a2, r), [x4, y4] = pt(a, r);
    const large = a2 - a > Math.PI ? 1 : 0;
    b += `<path d="M${x1.toFixed(1)},${y1.toFixed(1)} A${R},${R} 0 ${large} 1 ${x2.toFixed(1)},${y2.toFixed(1)} L${x3.toFixed(1)},${y3.toFixed(1)} A${r},${r} 0 ${large} 0 ${x4.toFixed(1)},${y4.toFixed(1)} Z" fill="${col}" stroke="${C.surface}" stroke-width="3"/>`;
    const [lx, ly] = pt((a + a2) / 2, (R + r) / 2);
    b += t(lx.toFixed(1), (ly + 5).toFixed(1), `${Math.round((n / total) * 100)} %`, { anchor: 'middle', size: 14, weight: 600, fill: labCol });
    a = a2;
  }
  b += t(cx, cy - 2, total, { anchor: 'middle', size: 34, weight: 600 });
  b += t(cx, cy + 22, 'wrong', { anchor: 'middle', fill: C.ink2, size: 14 });
  let ly = 150;
  for (const [label, n, col] of parts) {
    b += `<rect x="440" y="${ly - 12}" width="14" height="14" rx="3" fill="${col}"/>`;
    b += t(464, ly, esc(label), { size: 15 });
    b += t(905, ly, n, { anchor: 'end', size: 15, weight: 600 });
    ly += 46;
  }
  b += t(440, ly + 4, 'Ignoring case finds more than the XPath: wrong by a strict definition.', { fill: C.muted, size: 13 });
  b += t(440, ly + 22, 'Line-break failures need a line break in a value, which real ids lack.', { fill: C.muted, size: 13 });
  write('llm-mistakes.svg', svg(940, 500, 'Wrong UiSelectors of three Claude 5.5 runs without rules, by kind of mistake', b));
}

// 4. Cover 1000x420.
{
  let b = '';
  const W = 1000;
  b = `<rect width="${W}" height="420" fill="#14141a"/>`;
  b += t(56, 92, 'XPath → Android UiSelector', { size: 44, weight: 700, fill: '#f4f3ef' });
  b += t(56, 140, 'Can Claude 5.5 replace a converter?', { size: 30, fill: '#c9c6ff' });
  const card = (y0, who, code, verdict, ok) =>
    `<rect x="56" y="${y0}" width="888" height="62" rx="10" fill="#1f1f28" stroke="${ok ? '#2e7d4f' : '#8a2d2b'}" stroke-width="1.5"/>` +
    t(80, y0 + 38, who, { size: 17, fill: '#a7a59d', weight: 600 }) +
    t(230, y0 + 39, esc(code), { size: 20, fill: '#f4f3ef', family: MONO }) +
    t(920, y0 + 38, verdict, { size: 17, anchor: 'end', fill: ok ? '#5fd38d' : '#ff7a72', weight: 600 });
  b += t(80, 196, esc('//*[contains(@text,"Total")]'), { size: 20, fill: '#d8d6cf', family: MONO });
  b += t(470, 196, 'also matches “TOTAL”?', { size: 17, fill: '#a7a59d' });
  b += card(214, 'Claude', 'textContains("Total")', '✗ yes: wider', false);
  b += card(290, 'Converter', 'textMatches("(?s).*Total.*")', '✓ no: exact', true);
  b += t(56, 398, '680 locators · emulator-checked · converter: 0 wrong · Claude without rules: 47–63 wrong', { size: 16, fill: '#a7a59d' });
  write('cover.svg', svg(W, 420, 'XPath to Android UiSelector: can Claude 5.5 replace a converter?', b).replace(`<rect width="${W}" height="420" fill="${C.surface}"/>\n`, ''));
}
console.log('ok');
