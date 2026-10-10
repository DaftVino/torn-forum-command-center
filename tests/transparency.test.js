'use strict';

// #43, the owner's decision: a "See-through background" setting, on by
// default. While it is on (the panel carries tfcc-seethrough), only two base
// layers are translucent: the panel's own background (50%, behind the nav
// buttons) and the thread row card (75%, behind the drawer's buttons). Every
// other fill (buttons, nav cells, fields, the search bar, pills, chips, tags,
// the badge chip, shelf and toast, the tag and note popup, info panels) is
// exactly main's. Off, everything is solid, as on main. Expand is solid
// either way. Alpha on dedicated base tokens, never opacity, so text and
// controls stay opaque.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { loadUserscript, FORUMS_LOCATION } = require('./load-userscript');
const { NOW, bootNarrow, seedRows, panelOf, redraw } = require('./narrow-helpers');

const { exports: api } = loadUserscript();
const css = api.panelStyleText();
const golden = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'wide-golden.json'), 'utf8'));

function blockFor(selector) {
  const i = css.indexOf(selector + ' {');
  assert.ok(i !== -1, 'no rule block for ' + selector);
  return css.slice(i, css.indexOf('}', i));
}

const hex = (h) => [1, 3, 5].map((k) => parseInt(h.slice(k, k + 2), 16));
const token = (block, name) => new RegExp(name.replace(/-/g, '\\-') + ':\\s*([^;]+);').exec(block)[1].trim();

// ---- the tokens and the switch ----------------------------------------------

test('the base tokens are --tm-bg at 50% and --tm-bg-2 at 75%, in both themes', () => {
  for (const sel of ['#tfcc-panel', '#tfcc-panel.tfcc-theme-light']) {
    const block = blockFor(sel);
    for (const [name, base, alpha] of [['--tfcc-base-bg', '--tm-bg', 0.5], ['--tfcc-row-bg', '--tm-bg-2', 0.75]]) {
      const m = /^rgba\((\d+), (\d+), (\d+), ([0-9.]+)\)$/.exec(token(block, name));
      assert.ok(m, sel + ' ' + name + ' is rgba');
      assert.deepStrictEqual([+m[1], +m[2], +m[3]], hex(token(block, base)), sel + ' ' + name + ' is ' + base + "'s color");
      assert.strictEqual(+m[4], alpha, sel + ' ' + name);
    }
  }
});

// Every rule that paints a base token, by selector.
function paintersOf(name) {
  return Array.from(css.matchAll(/([^\n{}]+)\{([^}]*)\}/g))
    .filter((m) => m[2].includes('var(' + name + ')') && /background/.test(m[2]))
    .map((m) => m[1].trim());
}

test('only the panel base and the row card use the base tokens, and only behind the switch', () => {
  assert.deepStrictEqual(paintersOf('--tfcc-base-bg'), ['#tfcc-panel.tfcc-seethrough']);
  assert.deepStrictEqual(paintersOf('--tfcc-row-bg'), ['#tfcc-panel.tfcc-seethrough .tfcc-row']);
  assert.match(blockFor('#tfcc-panel.tfcc-seethrough'), /background: var\(--tfcc-base-bg\);/);
  assert.match(blockFor('#tfcc-panel.tfcc-seethrough .tfcc-row'), /background: var\(--tfcc-row-bg\);/);
  // Every see-through rule hangs off the one switch.
  for (const m of css.matchAll(/([^\n{}]*tfcc-(?:base|row)-bg[^\n{}]*)\{/g)) assert.match(m[1], /^#tfcc-panel\.tfcc-seethrough/);
  for (const m of css.matchAll(/([^\n{}]*backdrop-filter[^\n{}]*)\{/g)) assert.match(m[1], /^#tfcc-panel\.tfcc-seethrough/);
  // No opacity anywhere in them: that would fade the text too.
  for (const m of css.matchAll(/(#tfcc-panel\.tfcc-seethrough[^{]*)\{([^}]*)\}/g)) {
    assert.doesNotMatch(m[2], /(^|[^-])opacity\s*:/, m[1].trim());
  }
});

test('with the switch off, the panel, rows, shelf and toast paint main\'s solid fills (main\'s own lines)', () => {
  for (const line of ['  background: var(--tm-bg); color: var(--tm-text); border-radius: 6px;',
    '  background: var(--tm-bg-2); }',
    '  background: var(--tm-bg-2); padding: var(--tfcc-gap-sm) var(--tfcc-gap); }']) {
    assert.ok(golden.css.includes(line), 'main has: ' + line);
    assert.ok(css.split('\n').includes(line), 'still here: ' + line);
  }
  assert.match(blockFor('#tfcc-panel .tfcc-shelf, #tfcc-panel .tfcc-toast'), /background: var\(--tm-bg-2\);/);
  assert.match(blockFor('#tfcc-panel .tfcc-row'), /background: var\(--tm-bg-2\);/);
});

test('every control, pill and other fill is unchanged from main', () => {
  // Main's background declarations, line for line, other than the two base
  // layers the switch overrides: every one is still in the stylesheet.
  const fills = golden.css.filter((l) => /background/.test(l));
  assert.ok(fills.length > 15, 'main has its fills');
  const now = css.split('\n');
  for (const line of fills) {
    if (/tfcc-mine/.test(line)) continue; // the My posts color (#43 item 4), listed in wide-43-diffs
    assert.ok(now.includes(line), 'unchanged: ' + line.trim());
  }
  // The controls' and pills' own rules name only solid tokens.
  for (const sel of ['#tfcc-panel option', '#tfcc-panel button.tfcc-reactions', '#tfcc-panel .tfcc-tag',
    '#tfcc-panel .tfcc-linkbtn', '#tfcc-panel .tfcc-badge', '#tfcc-panel .tfcc-bar-track']) {
    assert.doesNotMatch(blockFor(sel), /--tfcc-(base|row)-bg/, sel);
  }
  for (const sel of ['#tfcc-panel.tfcc-narrow .tfcc-editor', '#tfcc-panel.tfcc-narrow .tfcc-pill']) {
    assert.doesNotMatch(blockFor(sel), /background:[^;]*(--tfcc-(base|row)-bg|rgba)/, sel + ' paints a solid fill');
  }
});

test('takeover is solid with the switch on, and has no blur', () => {
  const t = blockFor('#tfcc-panel.tfcc-seethrough.tfcc-takeover');
  assert.match(t, /background: var\(--tm-bg\);/);
  assert.match(t, /-webkit-backdrop-filter: none; backdrop-filter: none;/);
  assert.match(blockFor('#tfcc-panel.tfcc-seethrough.tfcc-takeover .tfcc-row'), /background: var\(--tm-bg-2\);/);
  // After the rules they override, at a higher specificity.
  assert.ok(css.indexOf('#tfcc-panel.tfcc-seethrough.tfcc-takeover {') > css.indexOf('#tfcc-panel.tfcc-seethrough {'));
  assert.ok(css.indexOf('#tfcc-panel.tfcc-seethrough.tfcc-takeover .tfcc-row {') > css.indexOf('#tfcc-panel.tfcc-seethrough .tfcc-row {'));
});

test('the backdrop blur rides the same switch, prefixed for WebKit', () => {
  assert.match(blockFor('#tfcc-panel.tfcc-seethrough'), /-webkit-backdrop-filter: blur\(6px\); backdrop-filter: blur\(6px\);/);
});

// ---- the setting ----------------------------------------------------------

const MAIN_BLOB = '{"v":1,"theme":"dark","sort":"activity","view":"threads","collapsed":false,"takeover":false,'
  + '"unreadOnly":false,"folderFilter":null,"tagFilter":null,"autoRefreshMs":0,"enrichBudget":10,'
  + '"autosaveDrafts":true,"hideTornBox":false,"authorOnly":false,"autoHideOnOpen":true,"keyRejected":0,'
  + '"deepSearchPages":5,"rowsShown":5,"badges":true}';

test('seeThrough defaults on; absent is on, an explicit false or true is kept, anything else is the default', () => {
  assert.strictEqual(api.freshSettings().seeThrough, true);
  assert.strictEqual(api.normaliseSettings({ v: 1 }).seeThrough, true);
  assert.strictEqual(api.normaliseSettings({ v: 1, seeThrough: false }).seeThrough, false);
  assert.strictEqual(api.normaliseSettings({ v: 1, seeThrough: true }).seeThrough, true);
  for (const bad of ['false', 0, 1, null, {}, [], 'no']) {
    assert.strictEqual(api.normaliseSettings({ v: 1, seeThrough: bad }).seeThrough, true, JSON.stringify(bad));
  }
});

test('a blob from main, an explicit off, and a junk value all load with no "Settings were damaged"', () => {
  for (const [extra, want] of [[{}, true], [{ seeThrough: false }, false], [{ seeThrough: 'yes' }, true], [{ seeThrough: 0 }, true]]) {
    const blob = JSON.stringify(Object.assign(JSON.parse(MAIN_BLOB), extra));
    const env = loadUserscript({ location: FORUMS_LOCATION, now: NOW, gmStore: [['tfcc:settings', blob]] });
    assert.strictEqual(env.exports.state.settings.seeThrough, want, blob);
    assert.doesNotMatch(env.exports.state.notices.map((n) => n.text).join(' '), /Settings were damaged/, blob);
  }
  // A real damage elsewhere in the same blob is still reported.
  const broken = JSON.stringify(Object.assign(JSON.parse(MAIN_BLOB), { seeThrough: 'yes', theme: 'neon' }));
  const env = loadUserscript({ location: FORUMS_LOCATION, now: NOW, gmStore: [['tfcc:settings', broken]] });
  assert.match(env.exports.state.notices.map((n) => n.text).join(' '), /Settings were damaged/);
});

test('Settings, Appearance: "See-through background" after the clip setting, with its info note', () => {
  const env = loadUserscript({ location: FORUMS_LOCATION, now: NOW });
  const a = env.exports;
  a.state.settings.view = 'settings';
  let html = a.panelHtml(a.buildPanelModel(NOW));
  const box = '<div class="tfcc-kv"><label for="tfcc-seethrough">See-through background</label>'
    + '<input id="tfcc-seethrough" type="checkbox" data-act="see-through" checked>'
    + '<button type="button" class="tfcc-info" data-act="info" data-info="settings-seethrough" aria-expanded="false"'
    + ' aria-controls="tfcc-info-settings-seethrough" aria-label="About see-through" title="About see-through">';
  assert.ok(html.includes(box), 'ticked by default, with its info button');
  assert.ok(html.indexOf('id="tfcc-info-settings-clip"') < html.indexOf(box), 'after the clip setting');
  assert.ok(html.indexOf(box) < html.indexOf('<h4>Folders</h4>'), 'still in Appearance');
  assert.match(html, /<p class="tfcc-note tfcc-infotext" id="tfcc-info-settings-seethrough" hidden>The panel shows Torn's page through it\. Text can be harder to read over a busy page, or one much lighter or darker than the panel\. Turn this off to make the panel solid\.<\/p>/);

  const h = a.makeHandlers(env.doc, env.win);
  h.onChange('see-through', { getAttribute: () => null, checked: false, value: '' });
  assert.strictEqual(a.state.settings.seeThrough, false);
  assert.strictEqual(JSON.parse(env.gmStore.get('tfcc:settings')).seeThrough, false, 'saved');
  html = a.panelHtml(a.buildPanelModel(NOW));
  assert.match(html, /<input id="tfcc-seethrough" type="checkbox" data-act="see-through">/);
});

test('the panel carries tfcc-seethrough exactly while the setting is on, at every width', () => {
  for (const width of [343, 900]) {
    const { env, api: a } = bootNarrow({ width });
    seedRows(a, [{ id: 1 }]);
    redraw(env);
    assert.strictEqual(panelOf(env).classList.contains('tfcc-seethrough'), true, 'on by default at ' + width);
    a.state.settings.seeThrough = false;
    redraw(env);
    assert.strictEqual(panelOf(env).classList.contains('tfcc-seethrough'), false, 'off at ' + width);
    a.state.settings.takeover = true;
    a.state.settings.seeThrough = true;
    redraw(env);
    assert.ok(panelOf(env).classList.contains('tfcc-seethrough') && panelOf(env).classList.contains('tfcc-takeover'),
      'both classes in takeover; the takeover rules make it solid');
  }
});
