// Builds the playground into _site/: the converter core (lib/, no fs) wrapped for the
// browser, plus the page. No dependencies; the core is read, never copied into the repo.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, '_site');
const MODULES = ['status', 'xpath', 'regex', 'uiselector', 'converter'];

function bundle() {
  const defs = MODULES.map(name => {
    const src = fs.readFileSync(path.join(ROOT, 'lib', `${name}.js`), 'utf8');
    return `  ${JSON.stringify('./' + name)}: function (module, exports, require) {\n${src}\n  },`;
  }).join('\n');
  return `(function (root) {
'use strict';
var defs = {
${defs}
};
var cache = {};
function load(id) {
  if (!cache[id]) {
    var m = { exports: {} };
    cache[id] = m;
    defs[id](m, m.exports, load);
  }
  return cache[id].exports;
}
root.XpathToUiSelector = { convertXpathToUiSelector: load('./converter').convertXpathToUiSelector, STATUS: load('./status') };
})(typeof globalThis !== 'undefined' ? globalThis : window);
`;
}

function build() {
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, 'converter.js'), bundle());
  for (const f of ['index.html', 'playground.js']) fs.copyFileSync(path.join(__dirname, f), path.join(OUT, f));
  fs.writeFileSync(path.join(OUT, '.nojekyll'), '');
}

if (require.main === module) { build(); console.log(`built ${OUT}`); }
module.exports = { build, bundle, OUT };
