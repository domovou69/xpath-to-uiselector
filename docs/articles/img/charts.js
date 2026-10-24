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

// 2. Claude 5.5 runs: score (% of the converter) vs cost per run, no rules and with rules.
{
  const X0 = 90, X1 = 880, Y0 = 470;
  const lmin = Math.log10(0.08), lmax = Math.log10(4);
  const x = (c) => X0 + ((Math.log10(c) - lmin) / (lmax - lmin)) * (X1 - X0);
  const y = (v) => Y0 - ((v - 60) / 45) * 338;
  const runs = [
    ['Haiku 5.5', C.haiku, [0.12, 72.7, 63], [0.33, 97.0, 4]],
    ['Sonnet 5.5', C.sonnet, [0.95, 75.7, 60], [0.89, 98.7, 1]],
    ['Opus 5.5', C.opus, [3.0, 78.3, 47], [1.84, 98.7, 1]],
  ];
  let b = '';
  b += t(40, 46, 'Claude 5.5 against the converter on 680 Android XPath locators', { size: 22, weight: 600 });
  b += `<circle cx="47" cy="75" r="6" fill="${C.ink2}"/>` + t(60, 80, 'no rules', { fill: C.ink2 });
  b += `<circle cx="140" cy="75" r="6" fill="${C.surface}" stroke="${C.ink2}" stroke-width="3"/>` + t(153, 80, 'with the rules prompt', { fill: C.ink2 });
  b += t(290, 80, '· effort medium · one run each', { fill: C.muted });
  for (const v of [60, 70, 80, 90, 100]) {
    b += `<line x1="${X0}" y1="${y(v)}" x2="${X1}" y2="${y(v)}" stroke="${v === 60 ? C.axis : C.grid}"/>`;
    b += t(X0 - 10, y(v) + 5, `${v} %`, { anchor: 'end', fill: C.muted, size: 14 });
  }
  for (const c of [0.1, 0.2, 0.5, 1, 2, 4]) b += t(x(c), Y0 + 24, `$${c}`, { anchor: 'middle', fill: C.muted, size: 14 });
  b += t((X0 + X1) / 2, Y0 + 50, 'Cost per run, log scale (left is cheaper)', { anchor: 'middle', fill: C.ink2, size: 15 });
  b += t(28, (y(60) + y(100)) / 2, 'Score, % of the converter', { anchor: 'middle', fill: C.ink2, size: 15, extra: ` transform="rotate(-90 28 ${(y(60) + y(100)) / 2})"` });
  // converter reference
  b += `<line x1="${X0}" y1="${y(100)}" x2="${X1}" y2="${y(100)}" stroke="${C.ink}" stroke-width="1.5" stroke-dasharray="6 5"/>`;
  b += `<text x="${X0 + 10}" y="${y(100) - 10}" font-size="15" fill="${C.ink}"><tspan font-weight="600">Converter</tspan> 100 % · 0 wrong · free · under a second</text>`;
  for (const [name, col, p, r] of runs) {
    b += `<line x1="${x(p[0])}" y1="${y(p[1])}" x2="${x(r[0])}" y2="${y(r[1])}" stroke="${col}" stroke-width="2" stroke-dasharray="3 4"/>`;
    b += `<circle cx="${x(p[0])}" cy="${y(p[1])}" r="8" fill="${col}" stroke="${C.surface}" stroke-width="2"/>`;
    b += `<circle cx="${x(r[0])}" cy="${y(r[1])}" r="7" fill="${C.surface}" stroke="${col}" stroke-width="3.5"/>`;
  }
  // plain labels
  const lab = (lx, ly, head, sub, anchor) =>
    t(lx, ly, head, { weight: 600, anchor }) + t(lx, ly + 19, sub, { fill: C.ink2, size: 14, anchor });
  b += lab(x(0.12) + 16, y(72.7) - 2, 'Haiku 5.5, no rules', '72.7 % · 63 wrong · $0.12');
  b += lab(x(0.95) + 16, y(75.7) + 10, 'Sonnet 5.5, no rules', '75.7 % · 60 wrong · $0.95');
  b += lab(x(3.0) - 16, y(78.3) - 6, 'Opus 5.5, no rules', '78.3 % · 47 wrong · $3.00', 'end');
  // rules labels
  b += lab(x(0.33) + 16, y(97.0) + 6, '+ rules: 97.0 %', '4 wrong · $0.33');
  b += lab(x(0.89) + 16, y(98.7) + 18, '+ rules: 98.7 %', '1 wrong · $0.89');
  b += lab(x(1.84) + 30, y(98.7) + 18, '+ rules: 98.7 %', '1 wrong · $1.84');
  b += t(40, 560, 'Score: correct +1, close +0.5, wrong −1, skip 0; the converter’s 471.5 points are 100 %. Wrong = a UiSelector that finds other', { fill: C.muted, size: 13 });
  b += t(40, 578, 'elements than the XPath, checked on an Android emulator. The rules were written from the no-rules mistakes on the same 680 locators.', { fill: C.muted, size: 13 });
  write('llm-chart.svg', svg(940, 600, 'Claude 5.5 models against the converter: score vs cost, no rules and with rules', b));
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
