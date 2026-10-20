#!/usr/bin/env node
// Stage 3 spike: does the UiAutomator2 server report the attributes LocatorLab sets on the accessibility
// node (class name, resource id, text, content-desc, booleans, range value) the same way in the page
// source (XPath) and to UiSelector? Needs the emulator, LocatorLab installed and `npm run appium`.
//   node audit/device/spike.js   → audit/device/results/spike.json
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { Session, UI, launch, requirePower, host, device, stack } = require('./wd');

const SCREEN = { name: 'spike', root: { c: 'android.widget.FrameLayout', id: 'com.example.app:id/root', k: [
  { c: 'android.widget.Button', id: 'com.example.app:id/login', t: 'Sign in', d: 'Login button', b: { clickable: true, focusable: true } },
  { c: 'com.example.app.FancyView', id: 'short_id', t: '', d: '' },
  { c: 'android.widget.CheckBox', t: 'All on', b: { checkable: true, checked: true, 'long-clickable': true, scrollable: true, selected: true, focused: true, focusable: true, enabled: false } },
  { c: 'android.widget.TextView' },
  { c: 'android.widget.SeekBar', range: 50 },
  { c: 'com.example.app.Outer$Inner', t: 'Dollar class' },
  { c: 'android.widget.TextView', t: 'Hidden', hide: true },
] } };

const CHECKS = [
  ['class', '//android.widget.Button', 'new UiSelector().className("android.widget.Button")'],
  ['custom class', '//com.example.app.FancyView', 'new UiSelector().className("com.example.app.FancyView")'],
  ['resource-id', '//*[@resource-id="com.example.app:id/login"]', 'new UiSelector().resourceId("com.example.app:id/login")'],
  ['short resource-id', '//*[@resource-id="short_id"]', 'new UiSelector().resourceId("short_id")'],
  ['text', '//*[@text="Sign in"]', 'new UiSelector().text("Sign in")'],
  ['content-desc', '//*[@content-desc="Login button"]', 'new UiSelector().description("Login button")'],
  ['empty text', '//*[@text=""]', 'new UiSelector().text("")'],
  ['empty content-desc', '//*[@content-desc=""]', 'new UiSelector().description("")'],
  ['checkable', '//*[@checkable="true"]', 'new UiSelector().checkable(true)'],
  ['checked', '//*[@checked="true"]', 'new UiSelector().checked(true)'],
  ['clickable', '//*[@clickable="true"]', 'new UiSelector().clickable(true)'],
  ['enabled false', '//*[@enabled="false"]', 'new UiSelector().enabled(false)'],
  ['focusable', '//*[@focusable="true"]', 'new UiSelector().focusable(true)'],
  ['focused', '//*[@focused="true"]', 'new UiSelector().focused(true)'],
  ['long-clickable', '//*[@long-clickable="true"]', 'new UiSelector().longClickable(true)'],
  ['scrollable', '//*[@scrollable="true"]', 'new UiSelector().scrollable(true)'],
  ['selected', '//*[@selected="true"]', 'new UiSelector().selected(true)'],
  ['range text', '//android.widget.SeekBar[@text="50.0"]', 'new UiSelector().className("android.widget.SeekBar").text("50.0")'],
  ['$ class', '//*[@text="Dollar class"]', 'new UiSelector().className("com.example.app.Outer$Inner")'],
  ['hidden', '//*[@text="Hidden"]', 'new UiSelector().text("Hidden")'],
];

(async () => {
  const doc = { date: new Date().toISOString().slice(0, 10), host: requirePower(), device: device() };
  const s = await Session.open();
  try {
    doc.stack = stack(s);
    await launch(SCREEN);
    const src = await s.source();
    doc.source = src.split('\n').filter(l => /com\.example|SeekBar|CheckBox|Hidden|Outer/.test(l) || /text="(Sign in|All on)"/.test(l)).map(l => l.trim());
    doc.checks = [];
    for (const [name, xpath, ui] of CHECKS) {
      const row = { name };
      for (const [k, using, value] of [['xpath', 'xpath', xpath], ['ui', UI, ui]]) {
        const r = await s.findAll(using, value);
        row[k] = r.error ? { error: r.error } : { n: r.ids.length, fp: await Promise.all(r.ids.map(id => s.fingerprint(id))) };
      }
      row.same = JSON.stringify(row.xpath) === JSON.stringify(row.ui);
      doc.checks.push(row);
      console.log(`${row.same ? 'SAME' : 'DIFF'} ${name}: xpath ${JSON.stringify(row.xpath)} | ui ${JSON.stringify(row.ui)}`);
    }
  } finally { await s.close(); }
  const out = path.join(__dirname, 'results', 'spike.json');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(doc, null, 1) + '\n');
  console.log(doc.source.join('\n'));
})().catch(e => { console.error(e); process.exit(1); });
