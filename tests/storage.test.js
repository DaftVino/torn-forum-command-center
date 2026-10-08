'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { loadUserscript } = require('./load-userscript');

test('every storage key has its own name and they do not collide', () => {
  const { exports: api } = loadUserscript();
  const values = Object.keys(api.STORAGE_KEYS).map((k) => api.STORAGE_KEYS[k]);
  assert.strictEqual(new Set(values).size, values.length);
  for (const v of values) assert.ok(v.indexOf('tfcc:') === 0, v + ' should be namespaced');
});

test('each key round-trips through script storage', () => {
  const { exports: api, gmStore } = loadUserscript();

  const org = api.freshOrganizer(1000);
  api.saveKey(api.STORAGE_KEYS.organizer, org);
  assert.ok(gmStore.has(api.STORAGE_KEYS.organizer));
  assert.deepStrictEqual(api.loadKey(api.STORAGE_KEYS.organizer, api.normaliseOrganizer, 0).value, org);
});

test('what a normaliser writes, it can read back unchanged', () => {
  // A normaliser that accepts the API's nested shape but stores a flat one has
  // to accept the flat shape too, or every reload silently zeroes the fields it
  // cannot find and then reports the user's own cache as damaged.
  const { exports: api } = loadUserscript();

  const feed = api.freshFeed();
  feed.fetchedAt = 1000;
  feed.categoriesAt = 900;
  feed.subscribed = [api.normaliseSubscribedRow({
    id: 7, forum_id: 2, title: 'Thread', author: { id: 99, username: 'Bob' }, posts: { new: 3, total: 40 },
  })];
  feed.activity = [api.normaliseActivityRow({
    thread_id: 7, post_id: 12, title: 'Thread', user: { username: 'Bob' }, timestamp: 60, is_seen: false, type: 1,
  })];
  feed.categories = [api.normaliseCategoryRow({ id: 2, title: 'Cat', acronym: 'C' })];

  const org = api.normaliseOrganizer({
    v: api.SCHEMA_VERSION,
    folders: [{ id: 'f1', name: 'Work', order: 0, forumIds: [2] }],
    threads: { 7: { pinned: true, tags: ['red'], note: 'n', title: 'Thread', forumId: 2 } },
  }, 1000);
  const drafts = api.normaliseDrafts({ v: api.SCHEMA_VERSION, byThread: { 7: { text: 'hi', updatedAt: 5, title: 'T' } } });

  const cases = [
    ['feed', api.STORAGE_KEYS.feed, api.normaliseFeed, feed],
    ['organizer', api.STORAGE_KEYS.organizer, api.normaliseOrganizer, org],
    ['drafts', api.STORAGE_KEYS.drafts, api.normaliseDrafts, drafts],
    ['settings', api.STORAGE_KEYS.settings, api.normaliseSettings,
      Object.assign(api.freshSettings(), { rowsShown: 20 })],
    ['postCache', api.STORAGE_KEYS.postCache, api.normalisePostCache, api.freshPostCache()],
  ];

  for (const [name, key, normaliser, value] of cases) {
    api.saveKey(key, value);
    const back = api.loadKey(key, normaliser, 2000);
    assert.deepStrictEqual(back.value, value, name + ' lost data on its own round trip');
    assert.strictEqual(back.recovered, false, name + ' called its own output damaged');
  }
});

test('a corrupt value resets only its own key', () => {
  const { exports: api } = loadUserscript({
    gmStore: [
      ['tfcc:organizer', '{ this is not json'],
      ['tfcc:drafts', JSON.stringify({ v: 1, byThread: { 42: { text: 'kept', updatedAt: 5, title: 'T' } } })],
    ],
  });

  const org = api.loadKey(api.STORAGE_KEYS.organizer, api.normaliseOrganizer, 0);
  const drafts = api.loadKey(api.STORAGE_KEYS.drafts, api.normaliseDrafts, 0);

  assert.deepStrictEqual(org.value.threads, {}, 'the damaged key resets');
  // The whole point of separate keys: losing the folder file must not cost the
  // user a draft they spent ten minutes writing.
  assert.strictEqual(drafts.value.byThread['42'].text, 'kept');
});

test('a value that will not parse is reported, not mistaken for an absent key', () => {
  // Collapsing "damaged" into "never set" is how a user silently loses every
  // folder they built and is told nothing at all about it.
  const { exports: api } = loadUserscript({ gmStore: [['tfcc:organizer', '{ this is not json']] });
  const res = api.loadKey(api.STORAGE_KEYS.organizer, api.normaliseOrganizer, 0);
  assert.strictEqual(res.hadRaw, true);
  assert.strictEqual(res.recovered, true);

  const absent = api.loadKey(api.STORAGE_KEYS.drafts, api.normaliseDrafts, 0);
  assert.strictEqual(absent.hadRaw, false);
  assert.strictEqual(absent.recovered, false, 'a key that was never set is not a recovery');
});

test('a damaged key is reported rather than silently reset', () => {
  const { exports: api } = loadUserscript({
    gmStore: [['tfcc:organizer', JSON.stringify({ v: 1, folders: 'not an array', threads: { 7: { pinned: 'yes' } } })]],
  });
  const res = api.loadKey(api.STORAGE_KEYS.organizer, api.normaliseOrganizer, 0);
  assert.strictEqual(res.hadRaw, true);
  assert.strictEqual(res.recovered, true, 'the caller must be able to tell the user');
});

test('a schema version from the future is refused, not coerced', () => {
  const { exports: api } = loadUserscript();
  const future = { v: api.SCHEMA_VERSION + 1, folders: [{ id: 'x', name: 'X' }], threads: { 1: { pinned: true } } };
  const out = api.normaliseOrganizer(future, 0);
  assert.deepStrictEqual(out.threads, {}, 'a newer schema must not be read with older rules');
  assert.strictEqual(out.v, api.SCHEMA_VERSION);
});

test('a write that throws surfaces a save error instead of being swallowed', () => {
  const { exports: api } = loadUserscript({ gmWriteErrors: new Set(['tfcc:organizer']) });
  const res = api.saveKey(api.STORAGE_KEYS.organizer, api.freshOrganizer(0));
  assert.strictEqual(res.ok, false);
  assert.strictEqual(res.reason, 'storage');
  assert.ok(res.detail.length > 0, 'a storage failure needs something the user can read');
});

test('normalisers are total: anything at all produces a valid object', () => {
  const { exports: api } = loadUserscript();
  const garbage = [null, undefined, 0, '', 'x', [], [1, 2], true, { v: 'x' }, { v: 1, threads: 5 }];

  for (const g of garbage) {
    assert.doesNotThrow(() => api.normaliseSettings(g), String(g));
    assert.doesNotThrow(() => api.normaliseOrganizer(g, 0), String(g));
    assert.doesNotThrow(() => api.normaliseDrafts(g), String(g));
    assert.doesNotThrow(() => api.normaliseFeed(g), String(g));
    assert.doesNotThrow(() => api.normalisePostCache(g), String(g));

    assert.ok(Array.isArray(api.normaliseOrganizer(g, 0).folders));
    assert.ok(api.normaliseDrafts(g).byThread && typeof api.normaliseDrafts(g).byThread === 'object');
    assert.ok(Array.isArray(api.normaliseFeed(g).subscribed));
  }
});

test('settings clamp to their allowed ranges', () => {
  const { exports: api } = loadUserscript();
  const s = api.normaliseSettings({
    v: 1, theme: 'neon', sort: 'chaos', view: 'nowhere',
    enrichBudget: 9999, deepSearchPages: 0, autoRefreshMs: 17,
  });
  assert.strictEqual(s.theme, 'dark', 'an unknown theme falls back');
  assert.strictEqual(s.sort, 'activity');
  assert.strictEqual(s.view, 'threads');
  assert.strictEqual(s.enrichBudget, api.MAX_ENRICH_BUDGET);
  assert.strictEqual(s.deepSearchPages, 1);
  assert.strictEqual(s.autoRefreshMs, 0, 'an interval that is not on the menu is off');
});

test('a thread id that is not a thread id is dropped', () => {
  const { exports: api } = loadUserscript();
  const out = api.normaliseOrganizer({
    v: 1,
    folders: [{ id: 'a', name: 'A' }],
    threads: {
      123: { pinned: true },
      'not-an-id': { pinned: true },
      '__proto__': { pinned: true },
      '-5': { pinned: true },
      '': { pinned: true },
    },
  }, 0);
  assert.deepStrictEqual(Object.keys(out.threads), ['123']);
});

test('a thread filed into a folder that no longer exists is unfiled, never orphaned', () => {
  const { exports: api } = loadUserscript();
  const out = api.normaliseOrganizer({
    v: 1,
    folders: [{ id: 'kept', name: 'Kept' }],
    threads: { 5: { folderId: 'deleted', note: 'my notes', tags: ['x'] } },
  }, 0);
  assert.strictEqual(out.threads['5'].folderId, null);
  assert.strictEqual(out.threads['5'].note, 'my notes', 'the work survives the missing folder');
  assert.deepStrictEqual(out.threads['5'].tags, ['x']);
});

test('an API key is only accepted in the shape Torn issues', () => {
  const { exports: api } = loadUserscript();
  assert.strictEqual(api.isKeyShaped('abcdefghij123456'), true);
  assert.strictEqual(api.isKeyShaped('abcdefghij12345'), false, 'fifteen characters');
  assert.strictEqual(api.isKeyShaped('abcdefghij1234567'), false, 'seventeen characters');
  assert.strictEqual(api.isKeyShaped('abcdefghij12345!'), false, 'punctuation');
  assert.strictEqual(api.isKeyShaped(''), false);
  assert.strictEqual(api.isKeyShaped(null), false);
  assert.strictEqual(api.isKeyShaped(undefined), false);
});

test('saving a malformed key is refused with a reason the user can act on', () => {
  const { exports: api, gmStore } = loadUserscript();
  const res = api.saveApiKey('too-short');
  assert.strictEqual(res.ok, false);
  assert.strictEqual(res.reason, 'shape');
  assert.strictEqual(gmStore.has('tfcc:key'), false, 'nothing is written on a rejection');
});

test('the Torn PDA key slot is only honoured once it has been replaced', () => {
  const { exports: api } = loadUserscript();
  const sentinel = ['###', 'PDA-APIKEY', '###'].join('');

  assert.strictEqual(api.pdaInjectedKey(sentinel), null, 'an unreplaced slot is not a credential');
  assert.strictEqual(api.pdaInjectedKey('abcdefghij123456'), 'abcdefghij123456');
  assert.strictEqual(api.pdaInjectedKey('replaced-but-wrong'), null);
  assert.strictEqual(api.pdaInjectedKey(''), null);
  assert.strictEqual(api.pdaInjectedKey(null), null);
});

test('a stored key wins over the PDA slot', () => {
  const { exports: api } = loadUserscript({ gmStore: [['tfcc:key', 'storedkey1234567']] });
  assert.strictEqual(api.loadApiKey(), 'storedkey1234567');
});

test('an upgrade with no My posts cache reports nothing as damaged', () => {
  const { exports: api } = loadUserscript();
  const res = api.loadKey(api.STORAGE_KEYS.mine, api.normaliseMine, 0);
  assert.strictEqual(res.recovered, false);
  assert.deepStrictEqual(res.value, api.freshMine());
});

test('a corrupt My posts cache resets only itself', () => {
  const { exports: api } = loadUserscript({ gmStore: [['tfcc:mine', '{not json']] });
  const org = api.freshOrganizer(1000);
  api.saveKey(api.STORAGE_KEYS.organizer, org);
  const mine = api.loadKey(api.STORAGE_KEYS.mine, api.normaliseMine, 0);
  assert.strictEqual(mine.recovered, true);
  assert.deepStrictEqual(api.loadKey(api.STORAGE_KEYS.organizer, api.normaliseOrganizer, 0).value, org);
});

test('rows shown defaults to All, so an existing user sees no change', () => {
  const { exports: api } = loadUserscript();
  assert.strictEqual(api.freshSettings().rowsShown, 0);
  assert.strictEqual(api.normaliseSettings({ v: 1 }).rowsShown, 0, 'an absent field is All');
});

test('rows shown keeps every value on the menu', () => {
  const { exports: api } = loadUserscript();
  for (const n of [3, 5, 10, 20, 30, 0]) {
    assert.strictEqual(api.normaliseSettings({ v: 1, rowsShown: n }).rowsShown, n);
  }
});

test('a corrupt or off-menu rows shown falls back to All', () => {
  // "10" as a string and 10.5 are the two a lenient toInt would have let
  // through as 10: neither was written by the menu.
  const { exports: api } = loadUserscript();
  for (const bad of ['10', 10.5, 7, -3, 1000, null, true, {}, [], NaN, Infinity]) {
    assert.strictEqual(api.normaliseSettings({ v: 1, rowsShown: bad }).rowsShown, 0, String(bad));
  }
});

test('rows shown survives a reload', () => {
  const { exports: api } = loadUserscript({
    gmStore: [['tfcc:settings', JSON.stringify({ v: 1, rowsShown: 10 })]],
  });
  api.loadAll(1700000000000);
  assert.strictEqual(api.state.settings.rowsShown, 10);
});

test('a settings blob saved before rows shown existed is not reported as damaged', () => {
  // 0.1.0 wrote every field it knew and nothing else, so rowsShown is absent
  // from it. That is an upgrade, and telling the user their settings were
  // reset would be false. isRecoveredValue (from #8) is what forgives it.
  const NOW = 1700000000000;
  const { exports: api } = loadUserscript();
  const old = api.freshSettings();
  delete old.rowsShown;
  old.theme = 'light';

  const env = loadUserscript({ gmStore: [['tfcc:settings', JSON.stringify(old)]] });
  const res = env.exports.loadKey('tfcc:settings', env.exports.normaliseSettings, NOW);
  assert.strictEqual(res.recovered, false);
  assert.strictEqual(res.value.rowsShown, 0, 'the default is filled in');
  assert.strictEqual(res.value.theme, 'light', 'every stored value is kept');

  env.exports.loadAll(NOW);
  const notices = env.exports.state.notices.map((n) => n.text).join(' ');
  assert.doesNotMatch(notices, /Settings were damaged/);
  assert.strictEqual(env.exports.state.settings.theme, 'light');
});

// -- author-only mode (issue #4) -------------------------------------------

const { exports: api } = loadUserscript();

test('authorOnly defaults off, accepts only true, and round-trips', () => {
  assert.strictEqual(api.freshSettings().authorOnly, false);
  assert.strictEqual(api.normaliseSettings({ v: 1, authorOnly: true }).authorOnly, true);
  for (const bad of ['true', 1, null, {}, undefined]) {
    assert.strictEqual(api.normaliseSettings({ v: 1, authorOnly: bad }).authorOnly, false, String(bad));
  }
  const round = api.normaliseSettings(JSON.parse(JSON.stringify(api.normaliseSettings({ v: 1, authorOnly: true }))));
  assert.strictEqual(round.authorOnly, true);
});

test('a settings blob saved by 0.1.0 is not reported as damaged', () => {
  // 0.1.0 wrote every field it knew and nothing else. authorOnly is absent
  // from it. That is an upgrade, not damage.
  const NOW = 1700000000000;
  const old = api.freshSettings();
  delete old.authorOnly;

  const env = loadUserscript({ gmStore: [['tfcc:settings', JSON.stringify(old)]] });
  const res = env.exports.loadKey('tfcc:settings', env.exports.normaliseSettings, NOW);
  assert.strictEqual(res.recovered, false);
  assert.strictEqual(res.value.authorOnly, false, 'the default is filled in');

  env.exports.loadAll(NOW);
  const notices = env.exports.state.notices.map((n) => n.text).join(' ');
  assert.doesNotMatch(notices, /Settings were damaged/);
});

test('author-check fields default to zero and survive normalisation', () => {
  const blank = api.normaliseThreadEntry(null);
  assert.deepStrictEqual(
    [blank.authorCheckedAt, blank.authorCheckTotal, blank.authorCheckSince, blank.authorNewCount,
      blank.authorLatestAt, blank.authorCheckComplete, blank.authorCheckReason],
    [0, 0, 0, 0, 0, false, '']);
  const e = api.normaliseThreadEntry({
    authorCheckedAt: 5, authorCheckTotal: 12, authorCheckSince: 4, authorNewCount: 2,
    authorLatestAt: 3, authorCheckComplete: true, authorCheckReason: 'too-many',
  });
  assert.strictEqual(e.authorNewCount, 2);
  assert.strictEqual(e.authorCheckComplete, true);
  assert.strictEqual(e.authorCheckReason, 'too-many');
  assert.strictEqual(api.normaliseThreadEntry({ authorCheckReason: 'evil<b>' }).authorCheckReason, '');
  assert.strictEqual(api.normaliseThreadEntry({ authorNewCount: -4 }).authorNewCount, 0);
});

test('a v0.1.0 organizer entry with no author fields loads unchanged otherwise', () => {
  const old = { pinned: true, lastSeenTotal: 9, lastVisitedAt: 100, note: 'n' };
  const e = api.normaliseThreadEntry(old);
  assert.strictEqual(e.pinned, true);
  assert.strictEqual(e.lastSeenTotal, 9);
  assert.strictEqual(e.authorCheckedAt, 0);
});

test('an export never carries author-check cache fields', () => {
  const env = loadUserscript();
  const api = env.exports;
  const o = api.freshOrganizer(0);
  o.threads['7'] = api.normaliseThreadEntry({ pinned: true, authorNewCount: 3, authorCheckedAt: 9 });
  const text = api.encodeState(o, api.freshDrafts(), env.sandbox.btoa);
  const json = api.b64DecodeUtf8(text.slice(api.EXPORT_PREFIX.length), env.sandbox.atob);
  assert.ok(json.indexOf('"pinned":true') !== -1, 'the thread must be in the export, or this proves nothing');
  assert.ok(!/author(Check|NewCount|LatestAt)/.test(json), json);
});

const AUTHOR_FIELDS = ['authorCheckedAt', 'authorCheckTotal', 'authorCheckSince', 'authorNewCount',
  'authorLatestAt', 'authorCheckComplete', 'authorCheckReason'];

function organizer010(raw) {
  // What 0.1.0 (and main before #4) wrote: every thread entry without the
  // seven author fields.
  const o = api.normaliseOrganizer(raw, 1700000000000);
  Object.keys(o.threads).forEach((id) => AUTHOR_FIELDS.forEach((k) => { delete o.threads[id][k]; }));
  return o;
}

test('an organizer saved by 0.1.0 is not reported as damaged', () => {
  const NOW = 1700000000000;
  const old = organizer010({ threads: {
    7: { pinned: true, lastSeenTotal: 9, lastVisitedAt: 100, note: 'n' },
    8: { lastSeenTotal: 2 },
  } });
  assert.ok(!('authorNewCount' in old.threads['7']), 'the fixture must really lack the new fields');

  const env = loadUserscript({ gmStore: [['tfcc:organizer', JSON.stringify(old)]] });
  env.exports.loadAll(NOW);
  const notices = env.exports.state.notices.map((n) => n.text).join(' ');
  assert.doesNotMatch(notices, /Folders and tags were damaged/);
  assert.strictEqual(env.exports.state.organizer.threads['7'].pinned, true, 'the stored values were kept');
  assert.strictEqual(env.exports.state.organizer.threads['7'].authorNewCount, 0, 'the default is filled in');
});

test('a genuinely corrupt thread entry is still reported as damage', () => {
  const NOW = 1700000000000;
  const cases = {
    'a present field the normaliser changed': (o) => { o.threads['7'].authorNewCount = -4; },
    'an off-list reason': (o) => { o.threads['7'].authorCheckReason = 'evil<b>'; },
    'a wrong-typed old field': (o) => { o.threads['7'].pinned = 'yes'; },
    'an unknown key the normaliser drops': (o) => { o.threads['7'].stray = 1; },
    'an entry the normaliser drops': (o) => { o.threads.abc = { pinned: true }; },
    'a top-level field that is wrong': (o) => { o.lastCatchUpAt = 'soon'; },
  };
  for (const name of Object.keys(cases)) {
    const bad = organizer010({ threads: { 7: { pinned: true, lastSeenTotal: 9 } } });
    cases[name](bad);
    const env = loadUserscript({ gmStore: [['tfcc:organizer', JSON.stringify(bad)]] });
    env.exports.loadAll(NOW);
    const notices = env.exports.state.notices.map((n) => n.text).join(' ');
    assert.match(notices, /Folders and tags were damaged/, name);
// The reaction fields (#10) are nested inside tfcc:mine.threads[], where #8's
// isRecoveredValue (top-level keys only) does not reach. They are optional so
// that an older blob round-trips byte for byte.
function reactionRoundTrip(api, rec) {
  const mine = Object.assign(api.freshMine(), { fetchedAt: 1000, threads: [rec] });
  api.saveKey(api.STORAGE_KEYS.mine, mine);
  return { mine, back: api.loadKey(api.STORAGE_KEYS.mine, api.normaliseMine, 9000) };
}

test('a tfcc:mine written before the reactions tracker loads silently', () => {
  const { exports: api } = loadUserscript();
  const old = api.freshMineThread(9, 1000);
  old.started = true;
  const { back } = reactionRoundTrip(api, old);
  assert.strictEqual(back.recovered, false);
  assert.deepStrictEqual(Object.keys(back.value.threads[0]), Object.keys(old));
});

test('records that gained reactions in either order reload undamaged', () => {
  const { exports: api } = loadUserscript();
  const a = api.freshMineThread(9, 1000);
  api.applyReactions(a, { rating: 2 }, 1000);
  api.setReactionFields(a, { topicAt: 2000, up: 3, down: 1 });
  const b = api.freshMineThread(9, 1000);
  api.setReactionFields(b, { topicAt: 2000, up: 3, down: 1 });
  api.applyReactions(b, { rating: 2 }, 1000);
  const c = api.freshMineThread(9, 1000);
  api.setReactionFields(c, { topicAt: 2000, up: null, down: null });
  for (const [label, rec] of [['rating then thumbs', a], ['thumbs then rating', b], ['checked, not found', c]]) {
    const { mine, back } = reactionRoundTrip(api, rec);
    assert.strictEqual(back.recovered, false, label + ' called its own output damaged');
    assert.deepStrictEqual(back.value, mine, label);
  }
});

// Forum karma (#10) is an optional top-level pair on tfcc:mine. Absent stays
// absent, so a blob written before the feature round-trips byte for byte.
test('a tfcc:mine blob with no karma loads silently and stays without karma', () => {
  const { exports: api } = loadUserscript();
  const mine = Object.assign(api.freshMine(), { fetchedAt: 1000 });
  api.saveKey(api.STORAGE_KEYS.mine, mine);
  const back = api.loadKey(api.STORAGE_KEYS.mine, api.normaliseMine, 9000);
  assert.strictEqual(back.recovered, false);
  assert.ok(!('karma' in back.value) && !('karmaAt' in back.value), 'never back-filled');
});

test('a stored karma pair reloads unchanged; a half pair is dropped', () => {
  const { exports: api } = loadUserscript();
  const withPair = api.setKarma(api.freshMine(), 34, 1700000000000);
  api.saveKey(api.STORAGE_KEYS.mine, withPair);
  const back = api.loadKey(api.STORAGE_KEYS.mine, api.normaliseMine, 9000);
  assert.strictEqual(back.recovered, false);
  assert.deepStrictEqual(back.value, withPair);
  const half = Object.assign(api.freshMine(), { karma: 5 });
  assert.ok(!('karma' in api.normaliseMine(JSON.parse(JSON.stringify(half)))), 'karma without karmaAt');
});
