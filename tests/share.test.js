'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { loadUserscript } = require('./load-userscript');

const env = loadUserscript();
const api = env.exports;
const btoaFn = env.sandbox.btoa;
const atobFn = env.sandbox.atob;
const NOW = 1700000000000;

function populated() {
  let o = api.freshOrganizer(NOW);
  o = api.upsertFolder(o, { id: 'mine', name: 'My folder', order: 5, forumIds: [61, 67] });
  o = api.setFolder(o, 100, 'mine');
  o = api.toggleTag(o, 100, 'money');
  o = api.toggleTag(o, 100, 'read-later');
  o = api.togglePin(o, 100);
  o = api.setPriority(o, 100, 2);
  o = api.markRead(o, 100, 40, NOW);
  o.threads['100'].note = 'the important one';
  o.threads['100'].title = 'Bank guide';

  let d = api.freshDrafts();
  d = api.saveDraft(d, 100, 'my half-written reply', NOW, 'Bank guide');
  return { organizer: o, drafts: d };
}

test('an export round-trips every piece of the user work', () => {
  const { organizer, drafts } = populated();
  const text = api.encodeState(organizer, drafts, btoaFn);
  assert.ok(text.indexOf(api.EXPORT_PREFIX) === 0);

  const out = api.importState(api.freshOrganizer(NOW), api.freshDrafts(), text, atobFn);
  assert.strictEqual(out.ok, true);

  const t = out.organizer.threads['100'];
  assert.strictEqual(t.folderId, 'mine');
  assert.deepStrictEqual(t.tags.sort(), ['money', 'read-later']);
  assert.strictEqual(t.pinned, true);
  assert.strictEqual(t.priority, 2);
  assert.strictEqual(t.note, 'the important one');
  assert.strictEqual(t.lastSeenTotal, 40);
  assert.strictEqual(out.organizer.folders.some((f) => f.id === 'mine'), true);
  assert.strictEqual(api.draftFor(out.drafts, 100).text, 'my half-written reply');
});

test('an export never carries the API key or the post cache', () => {
  const KEY = 'abcdefghij123456';
  const env2 = loadUserscript({ gmStore: [['tfcc:key', KEY]] });
  const { organizer, drafts } = populated();

  let cache = env2.exports.freshPostCache();
  cache = env2.exports.postCacheAdd(cache, 1, [{ id: 1, text: 'secret post body' }], { fetchedAt: 1 });

  const text = env2.exports.encodeState(organizer, drafts, btoaFn);
  const decoded = env2.exports.decodeState(text, atobFn);
  const blob = JSON.stringify(decoded.payload);

  assert.strictEqual(blob.indexOf(KEY), -1, 'the key must never leave the device');
  assert.strictEqual(blob.indexOf('secret post body'), -1, 'the post cache is not user work');
  assert.strictEqual(text.indexOf(KEY), -1);
});

test('titles with characters outside Latin-1 survive the round trip', () => {
  // btoa cannot hold anything above U+00FF and forum titles are full of things
  // that are, so the encoder percent-encodes before it base64s.
  let o = api.freshOrganizer(NOW);
  o = api.toggleTag(o, 7, 'x');
  o.threads['7'].note = 'Bonjour, ca va? Prix: 100 000. Symbols and quotes: "a" and it is fine';
  o.threads['7'].title = 'A thread about money and things';

  const text = api.encodeState(o, api.freshDrafts(), btoaFn);
  const out = api.importState(api.freshOrganizer(NOW), api.freshDrafts(), text, atobFn);
  assert.strictEqual(out.organizer.threads['7'].note, o.threads['7'].note);
});

test('base64 helpers round-trip multibyte text', () => {
  const samples = ['plain', 'quote " and \' apostrophe', 'slash / plus + equals =', '{"json":true}'];
  for (const s of samples) {
    assert.strictEqual(api.b64DecodeUtf8(api.b64EncodeUtf8(s, btoaFn), atobFn), s, s);
  }
  // URL-safe alphabet: an export string has to survive being pasted anywhere.
  const encoded = api.b64EncodeUtf8('????>>>>????', btoaFn);
  assert.strictEqual(/^[A-Za-z0-9_-]*$/.test(encoded), true, encoded);
});

test('a threads entry with nothing worth saying is left out of the export', () => {
  let o = api.freshOrganizer(NOW);
  o = api.applyAutoAssign(o, [{ id: 5, forumId: 61, title: 'T', authorId: 1, authorName: 'a', postsNew: 0, postsTotal: 3 }], NOW);
  const decoded = api.decodeState(api.encodeState(o, api.freshDrafts(), btoaFn), atobFn);
  assert.deepStrictEqual(Object.keys(decoded.payload.threads), [],
    'a thread the user has not touched is noise, not backup');
});

test('every rejection is named and applies nothing', () => {
  const { organizer, drafts } = populated();
  const good = api.encodeState(organizer, drafts, btoaFn);
  const orgBefore = JSON.stringify(organizer);
  const draftsBefore = JSON.stringify(drafts);

  const cases = [
    ['', 'empty'],
    ['   ', 'empty'],
    ['NOTAPREFIX:abcd', 'prefix'],
    ['TFCC1:' + '!!!not base64!!!', 'decode'],
    ['TFCC1:' + btoaFn('not json at all'), 'parse'],
    ['TFCC1:' + btoaFn(JSON.stringify([1, 2, 3])), 'shape'],
    ['TFCC1:' + btoaFn(JSON.stringify('a string')), 'shape'],
    ['TFCC1:' + btoaFn(JSON.stringify({ v: 99, folders: [] })), 'version'],
    ['TFCC1:' + btoaFn(JSON.stringify({ folders: [] })), 'version'],
    ['TFCC1:' + 'A'.repeat(400001), 'oversize'],
  ];

  for (const [text, reason] of cases) {
    const out = api.importState(organizer, drafts, text, atobFn);
    assert.strictEqual(out.ok, false, JSON.stringify(text.slice(0, 40)));
    assert.strictEqual(out.reason, reason, JSON.stringify(text.slice(0, 40)));
    assert.ok(out.detail && out.detail.length > 0, 'a rejection needs words the user can act on');
    assert.strictEqual(out.organizer, undefined, 'nothing may be applied on a rejection');
  }

  assert.strictEqual(JSON.stringify(organizer), orgBefore, 'the import mutated the organizer');
  assert.strictEqual(JSON.stringify(drafts), draftsBefore, 'the import mutated the drafts');

  // The good string still works after all that, so nothing was left in a bad state.
  assert.strictEqual(api.importState(organizer, drafts, good, atobFn).ok, true);
});

test('hostile content inside a valid envelope is normalised, not trusted', () => {
  const payload = {
    v: 1,
    folders: [{ id: 'ok', name: 'OK' }, { id: '', name: 'no id' }, null, 'string'],
    threads: {
      1: { priority: 9999, tags: ['a'.repeat(500), 'b', 'b'], note: 'x'.repeat(9000), folderId: 'ghost' },
      '__proto__': { pinned: true },
      'not-a-thread': { pinned: true },
    },
    // Comfortably over DRAFT_MAX_CHARS so the field cap is what trims it, but
    // under the envelope cap so the envelope check is not what this test proves.
    drafts: { 2: { text: 'y'.repeat(60000), updatedAt: -5 }, 'bad': { text: 'z' } },
  };
  const text = api.EXPORT_PREFIX + api.b64EncodeUtf8(JSON.stringify(payload), btoaFn);
  const out = api.importState(api.freshOrganizer(NOW), api.freshDrafts(), text, atobFn);

  assert.strictEqual(out.ok, true);
  assert.strictEqual(out.organizer.threads['1'].priority, api.PRIORITY_MAX, 'clamped');
  assert.strictEqual(out.organizer.threads['1'].note.length <= 2000, true, 'capped');
  assert.strictEqual(out.organizer.threads['1'].folderId, null, 'a folder that is not there is not invented');
  assert.strictEqual(out.organizer.threads['1'].tags.length, 2, 'deduplicated');
  assert.strictEqual(Object.prototype.hasOwnProperty.call(out.organizer.threads, 'not-a-thread'), false);
  assert.strictEqual(api.draftFor(out.drafts, 2).text.length, api.DRAFT_MAX_CHARS);
  assert.strictEqual(api.draftFor(out.drafts, 'bad'), null);

  // Prototype pollution: the payload's own __proto__ key must not reach one.
  assert.strictEqual(({}).pinned, undefined);
});

test('import is additive and reports what it changed', () => {
  const { organizer, drafts } = populated();
  const text = api.encodeState(organizer, drafts, btoaFn);

  let existing = api.freshOrganizer(NOW);
  existing = api.toggleTag(existing, 100, 'already-here');
  existing = api.toggleTag(existing, 999, 'untouched');

  const out = api.importState(existing, api.freshDrafts(), text, atobFn);
  assert.deepStrictEqual(out.organizer.threads['100'].tags.sort(), ['already-here', 'money', 'read-later'],
    'tags merge rather than replace');
  assert.deepStrictEqual(out.organizer.threads['999'].tags, ['untouched'], 'untouched threads survive');
  assert.strictEqual(out.summary.addedFolders, 1);
  assert.strictEqual(out.summary.changedThreads, 1);
  assert.strictEqual(out.summary.addedDrafts, 1);
});

test('a newer local draft is not overwritten by an older imported one', () => {
  const { organizer } = populated();
  let older = api.freshDrafts();
  older = api.saveDraft(older, 100, 'the old version', NOW - 100000, '');
  const text = api.encodeState(organizer, older, btoaFn);

  let newer = api.freshDrafts();
  newer = api.saveDraft(newer, 100, 'the version I am writing now', NOW, '');

  const out = api.importState(api.freshOrganizer(NOW), newer, text, atobFn);
  assert.strictEqual(api.draftFor(out.drafts, 100).text, 'the version I am writing now');
  assert.strictEqual(out.summary.addedDrafts, 0);
});

test('the export is built from folders and drafts only, so the My posts cache cannot reach it', () => {
  // encodeState(organizer, drafts, btoa) reads nothing else. A fourth input is
  // how a cache would leak into an export, so the signature is pinned. The raw
  // export, because the harness wrapper takes (...args) and reports length 0.
  assert.strictEqual(env.rawExports.encodeState.length, 3);
});
