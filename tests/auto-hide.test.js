'use strict';

// Issue #8: hide the panel when the user opens a thread from it.
// Spec: docs/superpowers/specs/2026-10-08-auto-hide-on-open-design.md

const test = require('node:test');
const assert = require('node:assert');
const { loadUserscript, FORUMS_LOCATION } = require('./load-userscript');

const NOW = 1700000000000;
const THREAD_HASH = '#/p=threads&f=61&t=5&b=0&a=0';

function forums(extra) {
  return Object.assign({}, FORUMS_LOCATION, extra || {});
}

function panelOf(env) {
  return env.doc.getElementById('tfcc-panel');
}

function storedSettings(env) {
  const raw = env.gmStore.get('tfcc:settings');
  return raw ? JSON.parse(raw) : null;
}

// ---- storage ---------------------------------------------------------------

test('the setting defaults off and only a real true turns it on', () => {
  const { exports: api } = loadUserscript();
  assert.strictEqual(api.freshSettings().autoHideOnOpen, false);
  for (const bad of ['true', 1, 'yes', null, undefined, {}, []]) {
    assert.strictEqual(api.normaliseSettings({ v: 1, autoHideOnOpen: bad }).autoHideOnOpen, false,
      'corrupt must mean off: ' + JSON.stringify(bad));
  }
  assert.strictEqual(api.normaliseSettings({ v: 1, autoHideOnOpen: true }).autoHideOnOpen, true);
});

test('the setting round-trips through storage and survives a reload', () => {
  const first = loadUserscript({ location: forums(), now: NOW });
  first.exports.state.settings.autoHideOnOpen = true;
  first.exports.persist('settings');
  assert.strictEqual(storedSettings(first).autoHideOnOpen, true);

  const again = loadUserscript({
    location: forums(), now: NOW,
    gmStore: [['tfcc:settings', first.gmStore.get('tfcc:settings')]],
  });
  assert.strictEqual(again.exports.state.settings.autoHideOnOpen, true);
  assert.strictEqual(again.exports.buildPanelModel(NOW).settings.autoHideOnOpen, true,
    'the Settings view reads model.settings, so the model must carry it');
});

test('a settings blob saved by 0.1.0 is not reported as damaged', () => {
  // 0.1.0 wrote every field it knew, in settingsDefaults order, and nothing
  // else. A field this release adds is absent from it. That is an upgrade, and
  // telling the user their settings were reset would be false.
  const { exports: api } = loadUserscript();
  const old = api.freshSettings();
  delete old.autoHideOnOpen;

  const env = loadUserscript({ location: forums(), now: NOW, gmStore: [['tfcc:settings', JSON.stringify(old)]] });
  const notices = env.exports.state.notices.map((n) => n.text).join(' ');
  assert.doesNotMatch(notices, /Settings were damaged/);

  const res = env.exports.loadKey('tfcc:settings', env.exports.normaliseSettings, NOW);
  assert.strictEqual(res.recovered, false);
  assert.strictEqual(res.value.autoHideOnOpen, false);
});

test('a setting that is present but invalid is still reported', () => {
  const { exports: api } = loadUserscript();
  const bad = api.freshSettings();
  bad.collapsed = 'yes';
  const env = loadUserscript({ location: forums(), now: NOW, gmStore: [['tfcc:settings', JSON.stringify(bad)]] });
  const res = env.exports.loadKey('tfcc:settings', env.exports.normaliseSettings, NOW);
  assert.strictEqual(res.recovered, true, 'forgiving absent fields must not forgive wrong ones');
});

test('isRecoveredValue forgives only absent top-level fields', () => {
  const { exports: api } = loadUserscript();
  assert.strictEqual(api.isRecoveredValue(null, { a: 1 }), false, 'never stored is not a recovery');
  assert.strictEqual(api.isRecoveredValue({ a: 1 }, { a: 1, b: false }), false, 'an added field');
  assert.strictEqual(api.isRecoveredValue({ a: 'x' }, { a: 1 }), true, 'a changed value');
  assert.strictEqual(api.isRecoveredValue({ a: 1, z: 1 }, { a: 1 }), true, 'a dropped field');
  assert.strictEqual(api.isRecoveredValue('text', { a: 1 }), true, 'not an object at all');
  assert.strictEqual(api.isRecoveredValue({ n: { a: 1 } }, { n: { a: 1, b: 0 } }), true,
    'nested shapes keep the strict comparison');
});

// ---- engine ----------------------------------------------------------------

const PLAIN = Object.freeze({
  button: 0, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, defaultPrevented: false,
});

test('only a plain activation counts', () => {
  const { exports: api } = loadUserscript();
  assert.strictEqual(api.isPlainActivation(Object.assign({}, PLAIN)), true);
  assert.strictEqual(api.isPlainActivation({}), true, 'Enter on a link carries button 0, or none at all');
  for (const k of ['ctrlKey', 'metaKey', 'shiftKey', 'altKey', 'defaultPrevented']) {
    assert.strictEqual(api.isPlainActivation(Object.assign({}, PLAIN, { [k]: true })), false, k);
  }
  assert.strictEqual(api.isPlainActivation(Object.assign({}, PLAIN, { button: 1 })), false, 'middle button');
  assert.strictEqual(api.isPlainActivation(Object.assign({}, PLAIN, { button: 2 })), false, 'right button');
  for (const bad of [null, undefined, 'click', 0, []]) {
    assert.strictEqual(api.isPlainActivation(bad), false, 'not a click: ' + String(bad));
  }
});

test('auto-hide collapses and leaves takeover only when the setting is on', () => {
  // rawExports: the wrapped exports copy return values, and this test is about identity.
  const raw = loadUserscript().rawExports;

  const off = Object.assign(raw.freshSettings(), { takeover: true });
  assert.strictEqual(raw.autoHideSettings(off), off, 'off returns the same object, so nothing is written');

  const on = Object.assign(raw.freshSettings(), { autoHideOnOpen: true, takeover: true });
  const out = raw.autoHideSettings(on);
  assert.notStrictEqual(out, on);
  assert.strictEqual(out.collapsed, true);
  assert.strictEqual(out.takeover, false, 'a collapsed panel in takeover still covers the thread');
  assert.strictEqual(out.autoHideOnOpen, true, 'the setting itself stays on');
  assert.strictEqual(on.collapsed, false, 'the argument is not mutated');
  assert.strictEqual(on.takeover, true, 'the argument is not mutated');

  assert.strictEqual(raw.autoHideSettings(null), null);
  assert.strictEqual(raw.autoHideSettings(undefined), undefined);
});
