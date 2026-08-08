'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { loadUserscript } = require('./load-userscript');

const { exports: api } = loadUserscript();
const NOW = 1700000000000;

function sub(id, forumId) {
  return { id, forumId, title: 'T' + id, authorId: 1, authorName: 'a', postsNew: 0, postsTotal: 5 };
}

test('the organizer operations never mutate what they are given', () => {
  const before = api.freshOrganizer(NOW);
  const snapshot = JSON.stringify(before);

  api.togglePin(before, 1);
  api.toggleTag(before, 1, 'x');
  api.setPriority(before, 1, 2);
  api.setFolder(before, 1, 'guides');
  api.markRead(before, 1, 5, NOW);
  api.deleteFolder(before, 'guides');

  assert.strictEqual(JSON.stringify(before), snapshot, 'an operation mutated its input');
});

test('a folder that claims a forum files new subscriptions into it', () => {
  let o = api.freshOrganizer(NOW);
  o = api.upsertFolder(o, { id: 'guides', name: 'Guides', order: 0, forumIds: [61] });
  o = api.applyAutoAssign(o, [sub(1, 61), sub(2, 67)], NOW);

  assert.strictEqual(o.threads['1'].folderId, 'guides');
  assert.strictEqual(o.threads['2'].folderId, null, 'an unclaimed forum stays unfiled');
});

test('filing by hand always beats a rule', () => {
  let o = api.freshOrganizer(NOW);
  o = api.upsertFolder(o, { id: 'guides', name: 'Guides', order: 0, forumIds: [61] });
  o = api.upsertFolder(o, { id: 'mine', name: 'Mine', order: 1, forumIds: [] });
  o = api.setFolder(o, 1, 'mine');
  o = api.applyAutoAssign(o, [sub(1, 61)], NOW);

  // The rule is a default; the hand placement is a decision, and a later
  // refresh must not quietly undo it.
  assert.strictEqual(o.threads['1'].folderId, 'mine');
});

test('auto-assign records what Torn knows without overwriting what the user set', () => {
  let o = api.freshOrganizer(NOW);
  o = api.applyAutoAssign(o, [sub(1, 61)], NOW);
  assert.strictEqual(o.threads['1'].title, 'T1');
  assert.strictEqual(o.threads['1'].firstSeenAt, NOW);
  assert.strictEqual(o.threads['1'].postsTotal, 5);

  // A second pass at a later time must not reset the first-seen stamp, or
  // "recently added" would mean "most recently refreshed".
  o = api.applyAutoAssign(o, [sub(1, 61)], NOW + 100000);
  assert.strictEqual(o.threads['1'].firstSeenAt, NOW);
});

test('folderFor finds the claiming folder and refuses nonsense', () => {
  let o = api.freshOrganizer(NOW);
  o = api.upsertFolder(o, { id: 'g', name: 'G', order: 0, forumIds: [61, 67] });
  assert.strictEqual(api.folderFor(o, 67).id, 'g');
  assert.strictEqual(api.folderFor(o, 2), null);
  assert.strictEqual(api.folderFor(o, 0), null);
  assert.strictEqual(api.folderFor(o, 'x'), null);
});

test('tags toggle, deduplicate, normalise and cap', () => {
  let o = api.freshOrganizer(NOW);
  o = api.toggleTag(o, 1, '  Money  ');
  assert.deepStrictEqual(o.threads['1'].tags, ['money'], 'trimmed and lowercased');

  o = api.toggleTag(o, 1, 'MONEY');
  assert.deepStrictEqual(o.threads['1'].tags, [], 'the same tag toggles off');

  o = api.toggleTag(o, 1, '');
  o = api.toggleTag(o, 1, '   ');
  assert.deepStrictEqual(o.threads['1'].tags, [], 'an empty tag is not a tag');

  for (let i = 0; i < 30; i += 1) o = api.toggleTag(o, 1, 'tag' + i);
  assert.strictEqual(o.threads['1'].tags.length, 24, 'the cap holds');
});

test('priority clamps to the documented range', () => {
  let o = api.freshOrganizer(NOW);
  o = api.setPriority(o, 1, 99);
  assert.strictEqual(o.threads['1'].priority, api.PRIORITY_MAX);
  o = api.setPriority(o, 1, -99);
  assert.strictEqual(o.threads['1'].priority, api.PRIORITY_MIN);
  o = api.setPriority(o, 1, 'nonsense');
  assert.strictEqual(o.threads['1'].priority, 0);
});

test('setting a folder that does not exist unfiles rather than inventing one', () => {
  let o = api.freshOrganizer(NOW);
  o = api.setFolder(o, 1, 'no-such-folder');
  assert.strictEqual(o.threads['1'].folderId, null);
});

test('deleting a folder unfiles its threads and keeps their work', () => {
  let o = api.freshOrganizer(NOW);
  o = api.upsertFolder(o, { id: 'temp', name: 'Temp', order: 9, forumIds: [] });
  o = api.setFolder(o, 1, 'temp');
  o = api.toggleTag(o, 1, 'keepme');
  o = api.deleteFolder(o, 'temp');

  assert.strictEqual(o.folders.some((f) => f.id === 'temp'), false);
  assert.strictEqual(o.threads['1'].folderId, null);
  assert.deepStrictEqual(o.threads['1'].tags, ['keepme'], 'the label went, the work stayed');
});

test('upsertFolder adds then updates, and keeps the list ordered', () => {
  let o = api.freshOrganizer(NOW);
  const count = o.folders.length;
  o = api.upsertFolder(o, { id: 'z', name: 'Z', order: 99, forumIds: [1] });
  assert.strictEqual(o.folders.length, count + 1);
  assert.strictEqual(o.folders[o.folders.length - 1].id, 'z');

  o = api.upsertFolder(o, { id: 'z', name: 'Z2', order: 99, forumIds: [1, 2] });
  assert.strictEqual(o.folders.length, count + 1, 'the same id updates, never duplicates');
  assert.strictEqual(o.folders[o.folders.length - 1].name, 'Z2');
});

test('a folder without an id or a name is refused', () => {
  const o = api.freshOrganizer(NOW);
  assert.strictEqual(api.upsertFolder(o, { id: '', name: 'X' }).folders.length, o.folders.length);
  assert.strictEqual(api.upsertFolder(o, { id: 'x', name: '' }).folders.length, o.folders.length);
  assert.strictEqual(api.upsertFolder(o, null).folders.length, o.folders.length);
});

test('allTags counts across threads and sorts', () => {
  let o = api.freshOrganizer(NOW);
  o = api.toggleTag(o, 1, 'zeta');
  o = api.toggleTag(o, 2, 'alpha');
  o = api.toggleTag(o, 3, 'alpha');
  assert.deepStrictEqual(api.allTags(o), [{ tag: 'alpha', count: 2 }, { tag: 'zeta', count: 1 }]);
});

test('the default folders match what the spec ships and claim nothing', () => {
  // Deliberately no hardcoded forum ids: whether faction forums even appear in
  // forum_id is unconfirmed, and a guessed constant would fail silently where a
  // data-driven rule shows the user what actually exists.
  const o = api.freshOrganizer(NOW);
  assert.deepStrictEqual(o.folders.map((f) => f.id), ['guides', 'scripts', 'faction']);
  for (const f of o.folders) assert.deepStrictEqual(f.forumIds, []);
});
