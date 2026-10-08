'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { loadUserscript, forumThreadsPayload, loadFixture } = require('./load-userscript');

const { exports: api } = loadUserscript();
const NOW = 1700000000000;
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

function apiRow(t) {
  return api.mineThreadFromApi(forumThreadsPayload([Object.assign({ id: 5 }, t)]).forumThreads[0]);
}

function started(id, fields, lastPostAt) {
  const rec = api.freshMineThread(id, NOW);
  rec.started = true;
  if (lastPostAt) rec.lastPostAt = lastPostAt;
  if (fields) api.setReactionFields(rec, fields);
  return rec;
}

function mineOf(threads, fetchedAt) {
  return Object.assign(api.freshMine(), { fetchedAt: fetchedAt === undefined ? NOW : fetchedAt, threads });
}

test('rating is read from user/forumthreads, negatives and zero included', () => {
  assert.strictEqual(apiRow({ rating: 7 }).rating, 7);
  assert.strictEqual(apiRow({ rating: -3 }).rating, -3);
  assert.strictEqual(apiRow({ rating: 0 }).rating, 0);
});

test('an absent, null or string rating is unknown, never 0', () => {
  // toInt(null, 0) is 0: the exact way a missing rating becomes a confident zero.
  assert.strictEqual(apiRow({ noRating: true }).rating, null);
  assert.strictEqual(apiRow({ rating: null }).rating, null);
  assert.strictEqual(apiRow({ rating: '7' }).rating, null);
});

test('setReactionFields keeps one canonical order whatever the write order', () => {
  const a = api.freshMineThread(5, NOW);
  api.setReactionFields(a, { topicAt: NOW, up: 1, down: 0 });
  api.setReactionFields(a, { reactAt: NOW, rating: 1 });
  assert.deepStrictEqual(Object.keys(a).slice(-5), ['reactAt', 'rating', 'topicAt', 'up', 'down']);
  const b = api.freshMineThread(5, NOW);
  api.setReactionFields(b, { reactAt: NOW, rating: 1 });
  api.setReactionFields(b, { topicAt: NOW, up: 1, down: 0 });
  assert.deepStrictEqual(Object.keys(b), Object.keys(a));
});

test('setReactionFields clears a field set to null and leaves unnamed ones', () => {
  const r = started(5, { reactAt: NOW, rating: 2, topicAt: NOW, up: 3, down: 1 });
  api.setReactionFields(r, { topicAt: NOW + 1, up: null, down: null });
  assert.strictEqual('up' in r, false);
  assert.strictEqual('down' in r, false);
  assert.strictEqual(r.rating, 2);
  assert.strictEqual(r.topicAt, NOW + 1);
});

test('applyReactions dates a new rating; a row without one leaves the old to age', () => {
  const r = api.freshMineThread(5, NOW);
  api.applyReactions(r, { rating: 4 }, NOW);
  assert.strictEqual(r.reactAt, NOW);
  api.applyReactions(r, { rating: null }, NOW + DAY);
  assert.strictEqual(r.rating, 4);
  assert.strictEqual(r.reactAt, NOW, 'old figures age; they are not re-dated');
});

test('mergeMineSnapshot stores the rating on started threads', () => {
  const snap = api.mergeMineSnapshot(api.freshMine(), [apiRow({ id: 5, rating: 3 })], [], NOW, true);
  const t = snap.threads.find((x) => x.id === 5);
  assert.strictEqual(t.started, true);
  assert.strictEqual(t.rating, 3);
  assert.strictEqual(t.reactAt, NOW);
});

test('the normaliser keeps whole pairs, drops halves, and reads its own output back', () => {
  const base = api.freshMineThread(5, NOW);
  const n = (extra) => api.normaliseMineThread(Object.assign({}, base, extra));
  assert.strictEqual('rating' in n({ rating: 3 }), false, 'rating without reactAt');
  assert.strictEqual('reactAt' in n({ reactAt: NOW }), false, 'reactAt without rating');
  assert.strictEqual('up' in n({ topicAt: NOW, up: 3 }), false, 'up without down');
  assert.strictEqual('up' in n({ up: 3, down: 1 }), false, 'thumbs without topicAt');
  assert.strictEqual(n({ topicAt: NOW }).topicAt, NOW, 'checked, not found, is kept');
  assert.strictEqual('up' in n({ topicAt: NOW, up: -1, down: 1 }), false, 'a negative count is not a count');

  const full = started(5, { reactAt: NOW, rating: -2, topicAt: NOW, up: 0, down: 2 });
  const mine = mineOf([full]);
  assert.deepStrictEqual(api.normaliseMine(JSON.parse(JSON.stringify(mine))), mine);
});
