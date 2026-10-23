// S-mode screens for LocatorLab (format: LocatorLab/app/src/main/kotlin/.../LabActivity.kt). Every S case
// runs on every screen, so each screen is both a place where cases match and a trap for the others:
//   attrs    one or more targets for every attribute, literal and function case, with near misses
//            (case variants, null vs. "", a Kelvin sign that lower-case() folds to "k", a range widget)
//   tree     duplicates at several depths, nested matches (a Button inside a Button, a ListView inside a
//            ListView), several matches per container, the same text inside and outside containers
//   deep     a 100-level chain with markers above and below the 70-level source limit
//   windows  a second window (PopupWindow) and a toast
//   nest     several containers of one class (one without matches, one nested in another), matches before,
//            between and after them; null vs. "" for text and content-desc, ids, a range widget
'use strict';

const P = 'com.example.app:id/';
const n = (c, t, x = {}) => ({ c, ...(t === undefined ? {} : { t }), ...x });
const TV = (t, x) => n('android.widget.TextView', t, x);
const BTN = (t, x) => n('android.widget.Button', t, x);
const box = (k, x = {}) => n('android.widget.LinearLayout', undefined, { k, ...x });
const row = (...k) => box(k, { row: true });
// lays leaves out in rows of `per`, so a screen with many leaves keeps readable sizes
const grid = (leaves, per = 4) => box(Array.from({ length: Math.ceil(leaves.length / per) }, (_, i) => row(...leaves.slice(i * per, i * per + per))));

const attrs = {
  name: 'attrs',
  root: grid([
    // A: attributes and class steps
    BTN('Sign in', { id: `${P}login`, b: { clickable: true, focusable: true } }),
    TV('Total'), TV('total'), TV('TOTAL'), TV('Subtotal'), TV(' Total '), TV('Total: 42'), TV('Grand Total USD'),
    n('android.widget.ImageButton', undefined, { d: 'Open menu', b: { clickable: true } }),
    n('android.widget.ImageView', undefined, { d: 'Main menu' }), n('android.widget.ImageView', undefined, { d: 'Menu open' }),
    n('android.widget.EditText', 'Email', { b: { focusable: true, clickable: true } }), n('android.widget.EditText', ''),
    TV('', { d: '' }), TV(undefined, { d: 'Has desc' }), TV('Has text'),
    TV('Empty id', { id: '' }), TV('Short id', { id: 'login' }), TV('Long id', { id: `${P}login_button` }),
    n('android.view.View', 'x'), n(null, 'x'), n('android.view.View', 'y'),
    n('com.example.app.Outer$Inner', 'Dollar class'),
    // B: booleans and index
    n('android.widget.CheckBox', 'Unchecked box', { b: { checkable: true } }),
    n('android.widget.CheckBox', 'Checked box', { b: { checkable: true, checked: true } }),
    TV('Disabled', { b: { enabled: false } }), TV('Focusable', { b: { focusable: true } }), TV('Focused', { b: { focusable: true, focused: true } }),
    TV('Long', { b: { 'long-clickable': true } }), TV('Scroll', { b: { scrollable: true } }), TV('Selected', { b: { selected: true } }),
    TV('Password', { b: { password: true } }),
    // C: string functions
    TV('v1.5'), TV('1x5'), n('android.widget.SeekBar', undefined, { range: 50 }), TV('50.0'),
    n('android.widget.SeekBar', undefined, { range: 1.5 }), n('android.widget.SeekBar', undefined, { range: 21.5 }), TV('21 items'),
    n('android.widget.RadioButton', 'Radio'),
    // D: logic
    BTN('OK', { b: { clickable: true } }), BTN('OK', { b: { enabled: false } }), TV('Yes'), TV(undefined, { d: 'OK' }),
    TV('A', { b: { clickable: true } }), TV('B', { d: 'c' }), TV('A', { d: 'c' }), TV('B'), TV(undefined, { d: 'B' }),
    TV('ab'), TV('ba'), TV('a only'), TV('Ad banner'), TV('O'),
    // G: literals
    TV('Say "hi"'), TV('C:\\Temp\\'), TV("it's"), TV('a]b'), TV('a/b'), TV('Price: $5'), TV('Pay $5.00 (incl.) now'),
    TV('Line 1\nLine 2'), TV('Grüße'), TV('a;b'), TV('f(x)'), TV('bell\u0007'), TV('a"b'), TV('%s'), TV('${name}'), TV('xa\\by'),
    // H: regexes and case
    TV('Ok'), TV('ok'), TV('O\u212A'), TV('xyz'), TV('aeiou'), TV('Total: 4x'),
    // V: numbers
    TV('1'), TV('1.0'), TV('01'),
    // E, X: classes and positions
    n('android.widget.ImageButton', 'Image', { b: { clickable: true } }), BTN('Add'), BTN('Add', { b: { enabled: false } }),
    TV('Hidden', { hide: true }),
  ]),
};

const item = (t, x) => row(TV(t, x), BTN('Add'));
const tree = {
  name: 'tree',
  root: box([
    row(BTN('Add'), TV('Name'), TV('Item')),
    n('android.widget.ListView', undefined, { id: `${P}list`, k: [item('Item'), item('Item'), box([item('Item'), TV('Deeper item')])] }),
    n('android.widget.ListView', undefined, { id: `${P}other_list`, k: [
      item('Item'),
      n('android.widget.ListView', undefined, { id: `${P}inner_list`, k: [item('Item'), item('Inner')] }),
    ] }),
    row(BTN('Outer', { k: [BTN('Inner button')] }), box([box([BTN('Deep button')])]), n('android.widget.ImageButton', 'Image')),
    row(TV('Name', { id: `${P}name_label` }), TV('Value'), TV('Total'), BTN('OK')),
    row(n('android.widget.CheckBox', 'Unchecked box', { b: { checkable: true } }), BTN('Add', { b: { enabled: false } }), TV('A'), TV('B')),
  ]),
};

// a chain of `depth` boxes; markers every 10 levels (the source stops at 70)
const chain = (depth) => {
  let node = TV('Deep marker');
  // each box has its own resource id, so equal bounds do not make fingerprints collide
  for (let d = depth; d > 0; d--) node = box(d % 10 === 0 ? [TV(`Depth ${d}`), node] : [node], { id: `${P}d${d}` });
  return node;
};
const deep = { name: 'deep', root: box([row(BTN('Add'), TV('Total')), box([chain(100)], { w: 4 })]) };

const windows = {
  name: 'windows',
  toast: 'Saved',
  root: box([row(BTN('Add'), TV('Item'), TV('Total')), box([BTN('OK'), TV('Name')], { w: 3 })]),
  popup: box([row(BTN('Popup button'), TV('Item', { id: `${P}popup_item` }), BTN('Add'))]),
};

const L = (id, k) => n('android.widget.ListView', undefined, { id: `${P}${id}`, k });
const nest = {
  name: 'nest',
  root: box([
    row(TV('Before'), BTN('Add'), TV(undefined, { d: 'menu before' })),
    L('empty', [row(BTN('No text'))]),
    L('first', [item('First 1'), item('First 2')]),
    row(TV('Between'), BTN('Add', { b: { clickable: true } })),
    L('second', [item('Second 1'), L('nested', [item('Nested 1'), item('Nested 2')]), item('Second 2')]),
    L('third', [item('Third 1'), item('')]),
    row(TV('After'), n('android.widget.EditText', 'Typed'), n('android.widget.EditText', ''), n('android.widget.EditText')),
    row(TV('', { d: '' }), TV(undefined, { d: 'main menu' }), TV('No desc'), TV(''), n('android.widget.SeekBar', undefined, { range: 30 })),
    row(TV('Tagged', { id: `${P}tagged`, b: { clickable: true } }), TV('Untagged', { b: { clickable: true } }), TV('Short', { id: 'short' })),
  ]),
};

const SCREENS = [attrs, tree, deep, windows, nest];

module.exports = { SCREENS };
