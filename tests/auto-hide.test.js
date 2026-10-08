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
