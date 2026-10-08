'use strict';

// Issue #9: badges. Storage and upgrade safety.
// Spec: docs/superpowers/specs/2026-10-08-badges-design.md, section 6.

const test = require('node:test');
const assert = require('node:assert');
const { loadUserscript, FORUMS_LOCATION } = require('./load-userscript');

const NOW = 1791460800000; // 2026-10-08 12:00 TCT

function forums(extra) { return Object.assign({}, FORUMS_LOCATION, extra || {}); }
function noticeText(env) { return env.exports.state.notices.map((n) => n.text).join(' '); }

test('the badges setting defaults on, and only an explicit false turns it off', () => {
  const { exports: api } = loadUserscript();
  assert.strictEqual(api.freshSettings().badges, true);
  assert.strictEqual(api.normaliseSettings({ v: 1, badges: false }).badges, false);
  for (const v of [true, 'false', 0, null, undefined, {}]) {
    assert.strictEqual(api.normaliseSettings({ v: 1, badges: v }).badges, true, JSON.stringify(v));
  }
});

test('a settings blob saved by the current main, with no badges field, loads with no damage notice', () => {
  const { exports: api } = loadUserscript();
  const old = api.freshSettings();
  delete old.badges;
  old.theme = 'light';
  old.autoHideOnOpen = true;
  const env = loadUserscript({ location: forums(), now: NOW, gmStore: [['tfcc:settings', JSON.stringify(old)]] });
  assert.doesNotMatch(noticeText(env), /Settings were damaged/);
  assert.strictEqual(env.exports.state.settings.theme, 'light', 'the values it held are kept');
  assert.strictEqual(env.exports.state.settings.autoHideOnOpen, true);
  assert.strictEqual(env.exports.state.settings.badges, true);
});

test('a 0.1.0 settings blob with neither badges nor autoHideOnOpen loads with no damage notice', () => {
  const { exports: api } = loadUserscript();
  const old = api.freshSettings();
  delete old.badges;
  delete old.autoHideOnOpen;
  const env = loadUserscript({ location: forums(), now: NOW, gmStore: [['tfcc:settings', JSON.stringify(old)]] });
  assert.doesNotMatch(noticeText(env), /Settings were damaged/);
});

test('a present but invalid setting is still reported', () => {
  const { exports: api } = loadUserscript();
  const bad = api.freshSettings();
  bad.collapsed = 'yes';
  const env = loadUserscript({ location: forums(), now: NOW, gmStore: [['tfcc:settings', JSON.stringify(bad)]] });
  assert.match(noticeText(env), /Settings were damaged/);
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
