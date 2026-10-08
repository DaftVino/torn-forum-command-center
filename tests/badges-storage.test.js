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

// ---- the record ------------------------------------------------------------

function populated() {
  return {
    v: 1, visits: 41, checkinDays: 12, bigBacklog: 22, firstCheckinAt: NOW - 86400000,
    streak: { current: 4, best: 9, lastDay: 20734 },
    forums: [2, 61, 67],
    today: { day: 20734, firstLook: 3, backlogIds: ['11', '12', '13'], visitIds: ['11'] },
    earned: { reader: NOW - 1000, 'future-badge': NOW - 500 },
  };
}

test('the badges key has its own name', () => {
  const { exports: api } = loadUserscript();
  assert.strictEqual(api.STORAGE_KEYS.badges, 'tfcc:badges');
});

test('a fresh record has the documented shape', () => {
  const { exports: api } = loadUserscript();
  assert.deepStrictEqual(api.freshBadges(), {
    v: 1, visits: 0, checkinDays: 0, bigBacklog: 0, firstCheckinAt: 0,
    streak: { current: 0, best: 0, lastDay: -1 },
    forums: [],
    today: { day: -1, firstLook: -1, backlogIds: [], visitIds: [] },
    earned: {},
  });
});

test('what the badges normaliser writes, it reads back byte for byte', () => {
  const { exports: api } = loadUserscript();
  for (const rec of [api.freshBadges(), populated()]) {
    const once = api.normaliseBadges(rec);
    assert.strictEqual(JSON.stringify(api.normaliseBadges(once)), JSON.stringify(once));
    assert.strictEqual(JSON.stringify(once), JSON.stringify(rec), 'a well-formed record is unchanged');
  }
});

test('the badges normaliser is total and bounded', () => {
  const { exports: api } = loadUserscript();
  for (const junk of [null, 7, 'x', [], { v: 'z' }, { streak: 'no', today: 5, earned: [] }]) {
    const out = api.normaliseBadges(junk);
    assert.strictEqual(typeof out.visits, 'number');
    assert.ok(Array.isArray(out.today.visitIds));
  }
  const big = populated();
  big.today.visitIds = Array.from({ length: 250 }, (_, i) => String(1000 + i));
  big.today.backlogIds = Array.from({ length: 150 }, (_, i) => String(5000 + i));
  big.forums = Array.from({ length: 80 }, (_, i) => i + 1);
  big.earned = {};
  for (let i = 0; i < 70; i += 1) big.earned['b' + i] = NOW;
  const out = api.normaliseBadges(big);
  assert.strictEqual(out.today.visitIds.length, 200);
  assert.strictEqual(out.today.backlogIds.length, 100);
  assert.strictEqual(out.forums.length, 64);
  assert.strictEqual(Object.keys(out.earned).length, 64);
});

test('earned keeps ids this build does not know, and drops malformed ones', () => {
  const { exports: api } = loadUserscript();
  const out = api.normaliseBadges({ v: 1, earned: { 'future-badge': NOW, 'Bad Id!': NOW, reader: 'soon' } });
  assert.deepStrictEqual(out.earned, { 'future-badge': NOW });
});

test('a record from a future schema is refused, not coerced', () => {
  const { exports: api } = loadUserscript();
  assert.deepStrictEqual(api.normaliseBadges(Object.assign(populated(), { v: 2 })), api.freshBadges());
});

test('no badges key at all loads silently', () => {
  const env = loadUserscript({ location: forums(), now: NOW });
  assert.doesNotMatch(noticeText(env), /damaged/);
  // state is a VM-realm object; compare as JSON, never with deepStrictEqual.
  assert.strictEqual(JSON.stringify(env.exports.state.badges), JSON.stringify(env.exports.freshBadges()));
});

test('a v1 record without a later top-level counter loads silently', () => {
  const rec = populated();
  delete rec.bigBacklog; // stands in for a record written before that counter existed
  const env = loadUserscript({ location: forums(), now: NOW, gmStore: [['tfcc:badges', JSON.stringify(rec)]] });
  assert.doesNotMatch(noticeText(env), /Badges were damaged/);
  assert.strictEqual(env.exports.state.badges.visits, 41, 'every other value is kept');
});

test('a damaged badges record is reported and resets only itself', () => {
  const org = { v: 1, folders: [{ id: 'mine', name: 'Mine', order: 0, forumIds: [] }], threads: {}, lastCatchUpAt: 0 };
  const env = loadUserscript({
    location: forums(), now: NOW,
    gmStore: [['tfcc:badges', JSON.stringify({ v: 1, visits: 'lots' })], ['tfcc:organizer', JSON.stringify(org)]],
  });
  assert.match(noticeText(env), /Badges were damaged and have been reset/);
  assert.strictEqual(env.exports.state.organizer.folders[0].id, 'mine');
});
