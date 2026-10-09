'use strict';

// #41: the "Clip titles and summaries that wrap" setting. On by default. On,
// a row's title and note (the summary) are one line with an ellipsis at every
// width, and the narrow meta line too; wide rows carry the full text as a
// title tooltip. Off, nothing clips at any width.

const test = require('node:test');
const assert = require('node:assert');
const { loadUserscript, FORUMS_LOCATION } = require('./load-userscript');
const { NOW, bootNarrow, seedRows, panelOf, redraw } = require('./narrow-helpers');

// The settings blob current main (before #41) writes, verbatim. It has no
// clipLines field.
const MAIN_BLOB = '{"v":1,"theme":"dark","sort":"activity","view":"threads","collapsed":false,"takeover":false,'
  + '"unreadOnly":false,"folderFilter":null,"tagFilter":null,"autoRefreshMs":0,"enrichBudget":10,'
  + '"autosaveDrafts":true,"hideTornBox":false,"authorOnly":false,"autoHideOnOpen":true,"keyRejected":0,'
  + '"deepSearchPages":5,"rowsShown":5,"badges":true}';

function storedSettings(env) {
  const raw = env.gmStore.get('tfcc:settings');
  return raw ? JSON.parse(raw) : null;
}

// ---- storage ------------------------------------------------------------------

test('clipLines defaults on; absent is on, an explicit false or true is kept, anything else is the default', () => {
  const { exports: api } = loadUserscript();
  assert.strictEqual(api.freshSettings().clipLines, true);
  assert.strictEqual(api.normaliseSettings({ v: 1 }).clipLines, true, 'absent takes the default');
  assert.strictEqual(api.normaliseSettings({ v: 1, clipLines: false }).clipLines, false, 'an explicit off is kept');
  assert.strictEqual(api.normaliseSettings({ v: 1, clipLines: true }).clipLines, true);
  for (const bad of ['false', 'true', 0, 1, null, {}, [], 'no']) {
    assert.strictEqual(api.normaliseSettings({ v: 1, clipLines: bad }).clipLines, true,
      'a present non-boolean falls back to the default: ' + JSON.stringify(bad));
  }
  assert.strictEqual(api.normaliseSettings(null).clipLines, true);
});

test('a settings blob saved by main loads clean: no "Settings were damaged", and clipping is on', () => {
  const env = loadUserscript({ location: FORUMS_LOCATION, now: NOW, gmStore: [['tfcc:settings', MAIN_BLOB]] });
  const notices = env.exports.state.notices.map((n) => n.text).join(' ');
  assert.doesNotMatch(notices, /Settings were damaged/);
  const res = env.exports.loadKey('tfcc:settings', env.exports.normaliseSettings, NOW);
  assert.strictEqual(res.recovered, false);
  assert.strictEqual(res.value.clipLines, true);
  assert.strictEqual(env.exports.state.settings.clipLines, true);
  assert.strictEqual(env.exports.isRecoveredValue(JSON.parse(MAIN_BLOB), res.value), false);
});

test('an explicit off survives a reload, with no damaged notice', () => {
  const blob = Object.assign(JSON.parse(MAIN_BLOB), { clipLines: false });
  const env = loadUserscript({ location: FORUMS_LOCATION, now: NOW, gmStore: [['tfcc:settings', JSON.stringify(blob)]] });
  assert.strictEqual(env.exports.state.settings.clipLines, false);
  assert.doesNotMatch(env.exports.state.notices.map((n) => n.text).join(' '), /Settings were damaged/);
});

// ---- the Settings checkbox ---------------------------------------------------------

test('Settings, Appearance: the checkbox follows auto-hide, with an info button (13d pattern)', () => {
  const env = loadUserscript({ location: FORUMS_LOCATION, now: NOW });
  const api = env.exports;
  api.state.settings.view = 'settings';
  let html = api.panelHtml(api.buildPanelModel(NOW));
  const box = '<div class="tfcc-kv"><label for="tfcc-clip">Clip titles and summaries that wrap</label>'
    + '<input id="tfcc-clip" type="checkbox" data-act="clip-lines" checked>'
    + '<button type="button" class="tfcc-info" data-act="info" data-info="settings-clip" aria-expanded="false"'
    + ' aria-controls="tfcc-info-settings-clip" aria-label="About clipping">';
  assert.ok(html.includes(box), 'the checkbox, ticked by default, and its info button');
  assert.match(html, /<p class="tfcc-note tfcc-infotext" id="tfcc-info-settings-clip" hidden>Each row's title and summary stay on one line/);
  const autoHideText = html.indexOf('id="tfcc-info-settings-autohide"');
  assert.ok(autoHideText !== -1 && autoHideText < html.indexOf(box), 'right after Hide the panel when I open a thread');
  assert.ok(html.indexOf(box) < html.indexOf('<h4>Folders</h4>'), 'still in Appearance');

  const handlers = api.makeHandlers(env.doc, env.win);
  handlers.onChange('clip-lines', { getAttribute: () => null, checked: false, value: '' });
  assert.strictEqual(api.state.settings.clipLines, false);
  assert.strictEqual(storedSettings(env).clipLines, false, 'unticking is saved');
  html = api.panelHtml(api.buildPanelModel(NOW));
  assert.match(html, /<input id="tfcc-clip" type="checkbox" data-act="clip-lines">/);
  handlers.onChange('clip-lines', { getAttribute: () => null, checked: true, value: 'on' });
  assert.strictEqual(storedSettings(env).clipLines, true);
});

test('the info key is registered for Settings, so it opens and closes like the others', () => {
  const { exports: api } = loadUserscript();
  assert.strictEqual(api.INFO_KEYS['settings-clip'], 'About clipping');
  assert.ok(api.INFO_KEYS_BY_VIEW.settings.includes('settings-clip'));
});

// ---- the panel class ---------------------------------------------------------------

test('the panel carries tfcc-clip exactly while the setting is on, at every width', () => {
  for (const width of [343, 900]) {
    const { env, api } = bootNarrow({ width });
    seedRows(api, [{ id: 1 }]);
    redraw(env);
    assert.strictEqual(panelOf(env).classList.contains('tfcc-clip'), true, 'on by default at ' + width);
    api.state.settings.clipLines = false;
    redraw(env);
    assert.strictEqual(panelOf(env).classList.contains('tfcc-clip'), false, 'off at ' + width);
    api.state.settings.clipLines = true;
    redraw(env);
    assert.strictEqual(panelOf(env).classList.contains('tfcc-clip'), true, 'back on at ' + width);
  }
});

// ---- wide markup -------------------------------------------------------------------

function wideRow(clip, note) {
  const env = loadUserscript({ location: FORUMS_LOCATION, now: NOW });
  const api = env.exports;
  seedRows(api, [{ id: 9, title: 'A "quoted" <title> & more' }]);
  if (note) {
    const org = api.toggleTag(api.state.organizer, 9, 'x');
    org.threads['9'].note = note;
    api.state.organizer = org;
    api.recompute(NOW);
  }
  api.state.settings.clipLines = clip;
  const model = api.buildPanelModel(NOW);
  return api.renderRow(model.rows[0], model);
}

test('wide, on: the title and the note carry their full text as a title tooltip', () => {
  const html = wideRow(true, 'A note & "summary"');
  assert.match(html, /<span class="tfcc-row-title" title="A &quot;quoted&quot; &lt;title&gt; &amp; more"><a /);
  assert.match(html, /<div class="tfcc-note" title="A note &amp; &quot;summary&quot;">A note &amp; &quot;summary&quot;<\/div>/);
  // The link's accessible name is its text, the full title, untouched.
  assert.match(html, /data-tfcc-thread="9">A &quot;quoted&quot; &lt;title&gt; &amp; more<\/a><\/span>/);
});

test('wide, off: the row is exactly what it was, and on adds only the two title attributes', () => {
  const off = wideRow(false, 'A note');
  const on = wideRow(true, 'A note');
  assert.doesNotMatch(off, /class="tfcc-row-title" title=|class="tfcc-note" title=/);
  const title = ' title="A &quot;quoted&quot; &lt;title&gt; &amp; more"';
  assert.strictEqual(on.split(title).length - 1, 1, 'one title tooltip');
  const stripped = on.replace('<span class="tfcc-row-title"' + title + '>', '<span class="tfcc-row-title">')
    .replace('<div class="tfcc-note" title="A note">', '<div class="tfcc-note">');
  assert.strictEqual(stripped, off, 'nothing else differs');
});

test('narrow rows never carry the tooltip: the open drawer shows the full text instead', () => {
  const { env, api } = bootNarrow();
  seedRows(api, [{ id: 3, title: 'A long one' }]);
  const html = redraw(env);
  assert.doesNotMatch(html, /class="tfcc-row-title" title=/);
});

// ---- the stylesheet ------------------------------------------------------------------

function cssRule(api, sel) {
  const css = api.panelStyleText();
  const at = css.indexOf(sel + ' {');
  assert.ok(at !== -1, 'no rule for ' + sel);
  return css.slice(at + sel.length + 2, css.indexOf('}', at));
}

const CUT = /white-space: nowrap; overflow: hidden; text-overflow: ellipsis;/;

test('every clipping rule hangs off .tfcc-clip, so the setting is a single switch', () => {
  const { api } = bootNarrow();
  const css = api.panelStyleText();
  const rules = Array.from(css.matchAll(/([^{}\n]*)\{([^}]*)\}/g), (m) => [m[1].trim(), m[2]]);
  const rowText = /tfcc-row-title|tfcc-row > \.tfcc-note|tfcc-row-l2 \.tfcc-meta/;
  for (const [sel, body] of rules) {
    if (rowText.test(sel) && /text-overflow: ellipsis/.test(body)) {
      assert.match(sel, /^#tfcc-panel(\.tfcc-narrow)?\.tfcc-clip /, sel + ' clips without the setting');
    }
  }
});

test('on: the title and the note clip at every width; the narrow meta clips too', () => {
  const { api } = bootNarrow();
  assert.match(cssRule(api, '#tfcc-panel.tfcc-clip .tfcc-row-main .tfcc-row-title'), CUT, 'wide title');
  assert.match(cssRule(api, '#tfcc-panel.tfcc-clip .tfcc-row > .tfcc-note'), CUT, 'the note, both widths');
  assert.match(cssRule(api, '#tfcc-panel.tfcc-narrow.tfcc-clip .tfcc-row-t .tfcc-row-title a'), CUT, 'narrow title');
  assert.match(cssRule(api, '#tfcc-panel.tfcc-narrow.tfcc-clip .tfcc-row-l2 .tfcc-meta'),
    /display: block; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;/, 'narrow meta');
});

test('narrow, on: the open row shows its title, meta and note whole', () => {
  const { api } = bootNarrow();
  const whole = /white-space: normal; overflow: visible;/;
  assert.match(cssRule(api, '#tfcc-panel.tfcc-narrow.tfcc-clip .tfcc-row.tfcc-open .tfcc-row-t .tfcc-row-title a'), whole);
  assert.match(cssRule(api, '#tfcc-panel.tfcc-clip .tfcc-row.tfcc-open > .tfcc-note'), whole);
  assert.match(cssRule(api, '#tfcc-panel.tfcc-narrow.tfcc-clip .tfcc-row.tfcc-open .tfcc-row-l2 .tfcc-meta'), whole);
});

// PR #42 review: the meta's parts are concatenated with no space between
// them, so in the one-line block they form unbreakable runs ("draftreference")
// that pushed the last part out of the meta column, under the row's buttons,
// at 280px. Open, each part is an atomic inline-block, so the line may break
// between parts, and a part wider than the column wraps inside itself.
test('narrow, on: an open row\'s meta parts wrap between and within themselves (PR #42 review)', () => {
  const { api } = bootNarrow();
  assert.match(cssRule(api, '#tfcc-panel.tfcc-narrow.tfcc-clip .tfcc-row.tfcc-open .tfcc-row-l2 .tfcc-meta > *'),
    /display: inline-block;\s+max-width: 100%; overflow-wrap: anywhere;/);
  // Closed, the parts stay inline, so the ellipsis can cut inside one.
  assert.doesNotMatch(cssRule(api, '#tfcc-panel.tfcc-narrow.tfcc-clip .tfcc-row-l2 .tfcc-meta > *'), /inline-block/);
});

test('off: the narrow title and meta wrap as before #39 (block band, flex meta)', () => {
  const { api } = bootNarrow();
  const title = cssRule(api, '#tfcc-panel.tfcc-narrow .tfcc-row-t .tfcc-row-title a');
  assert.match(title, /display: block; padding: 3px 0; min-height: 24px;/, 'the 24px band stays at every setting');
  assert.doesNotMatch(title, /nowrap|ellipsis/);
  const meta = cssRule(api, '#tfcc-panel.tfcc-narrow .tfcc-row-l2 .tfcc-meta');
  assert.doesNotMatch(meta, /nowrap|ellipsis|display: block/);
  assert.doesNotMatch(api.panelStyleText(), /#tfcc-panel\.tfcc-narrow \.tfcc-row > \.tfcc-note \{/, 'no unswitched note cut');
});
