// Playground logic: lines in, one entry per XPath out. Pure (no DOM) so the test can run it
// against the real converter; the DOM part below runs only in a browser.
(function (root) {
  'use strict';

  // kind: exact (no warning), close (converted with a warning), skip (no UiSelector)
  function convertLines(text, convert, STATUS) {
    return String(text).split(/\r?\n/).map(l => l.trim()).filter(Boolean).map(xpath => {
      const r = convert(xpath);
      const ok = r.status === STATUS.SUCCESS;
      return {
        xpath,
        kind: !ok ? 'skip' : r.warning ? 'close' : 'exact',
        locator: ok ? r.locator : null,
        warning: r.warning || null,
        reason: ok ? null : r.reason || r.status,
        hint: r.hint || null,
      };
    });
  }

  const EXAMPLES = [
    { label: 'exact', text: '(//android.widget.TextView[@content-desc="price"])[2]\n//*[@content-desc="Cart" and contains(@text, "USD")]' },
    { label: 'close', text: '//android.widget.ListView//android.widget.TextView[@text="Total"]\n//android.view.View[@text="x"]' },
    { label: 'skip', text: '//android.widget.ListView/android.widget.TextView[1]\n//android.widget.Button/following-sibling::android.widget.Button' },
  ];

  const api = { convertLines, EXAMPLES };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.Playground = api;
  if (typeof document === 'undefined') return;

  const $ = id => document.getElementById(id);
  const el = (tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  };
  const LABEL = { exact: 'exact', close: 'close', skip: 'skipped' };

  function copy(text, btn) {
    const done = () => { btn.textContent = 'Copied'; setTimeout(() => { btn.textContent = 'Copy'; }, 1200); };
    const fallback = () => {
      const t = el('textarea'); t.value = text; document.body.appendChild(t); t.select();
      try { document.execCommand('copy'); done(); } catch (e) { /* no clipboard */ }
      t.remove();
    };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, fallback);
    else fallback();
  }

  function card(r) {
    const c = el('article', 'card ' + r.kind);
    const head = el('div', 'head');
    head.append(el('span', 'badge ' + r.kind, LABEL[r.kind]), el('code', 'xp', r.xpath));
    c.append(head);
    if (r.locator) {
      const row = el('div', 'out');
      const btn = el('button', 'copy', 'Copy');
      btn.type = 'button';
      btn.addEventListener('click', () => copy(r.locator, btn));
      row.append(el('code', 'ui', r.locator), btn);
      c.append(row);
    }
    if (r.warning) c.append(el('p', 'note', 'Warning: ' + r.warning));
    if (r.reason) c.append(el('p', 'note', 'Skipped: ' + r.reason));
    if (r.hint) c.append(el('p', 'note hint', 'Hint: ' + r.hint));
    return c;
  }

  function render() {
    const { convertXpathToUiSelector, STATUS } = root.XpathToUiSelector;
    const results = convertLines($('input').value, convertXpathToUiSelector, STATUS);
    const out = $('results');
    out.replaceChildren(...results.map(card));
    $('summary').textContent = results.length
      ? ['exact', 'close', 'skip'].map(k => results.filter(r => r.kind === k).length + ' ' + LABEL[k]).join(' · ')
      : 'Enter one XPath per line.';
  }

  $('input').addEventListener('input', render);
  const ex = $('examples');
  EXAMPLES.forEach(e => {
    const b = el('button', 'chip', e.label);
    b.type = 'button';
    b.addEventListener('click', () => { $('input').value = e.text; render(); });
    ex.append(b);
  });
  $('input').value = EXAMPLES[0].text;
  render();
})(typeof globalThis !== 'undefined' ? globalThis : window);
