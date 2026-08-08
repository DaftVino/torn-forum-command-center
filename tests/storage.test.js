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
