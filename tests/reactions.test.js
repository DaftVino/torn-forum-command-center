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

// Topic-post pages come from #14's real fixtures. Only the malformed cases
// below edit a copy, because Torn has not sent us a malformed one.
test('the real opening-post page yields the topic post thumbs', () => {
  const page = loadFixture('forum-thread-posts-asc');
  assert.strictEqual(page.posts[0].is_topic, true, 'the topic post leads page one');
  assert.deepStrictEqual(api.topicPostFromApi(page, 16589908), { up: 7, down: 0 },
    'the reply on the page (3 likes) is not added');
});

test('a large thread: page one still leads with the topic post, and dislikes are read', () => {
  const page = loadFixture('forum-posts-large-offset0');
  assert.strictEqual(page.posts.length, 20);
  assert.strictEqual(page.posts[0].is_topic, true);
  assert.deepStrictEqual(api.topicPostFromApi(page, 16561608), { up: 916, down: 11 });
});

test('Torn ignores sort, so the request sends offset only', () => {
  assert.deepStrictEqual(loadFixture('forum-posts-large-sort-desc-ignored'), loadFixture('forum-posts-large-offset0'),
    'sort=DESC returned the same oldest-first page');
  assert.deepStrictEqual(Object.keys(api.TOPIC_POST_PARAMS), ['offset']);
  assert.strictEqual(api.TOPIC_POST_PARAMS.offset, 0);
});

test('the topic post is found wherever it sits on the page', () => {
  const page = loadFixture('forum-thread-posts-asc');
  page.posts.reverse();
  assert.strictEqual(page.posts[0].is_topic, false);
  assert.deepStrictEqual(api.topicPostFromApi(page, 16589908), { up: 7, down: 0 });
});

test('no usable topic post is null, never a zero', () => {
  const noTopic = loadFixture('forum-thread-posts-asc');
  noTopic.posts = noTopic.posts.filter((p) => p.is_topic !== true);
  assert.strictEqual(api.topicPostFromApi(noTopic, 16589908), null);
  assert.strictEqual(api.topicPostFromApi(loadFixture('forum-thread-posts-asc'), 5), null,
    'a topic post from another thread');
  const nullLikes = loadFixture('forum-thread-posts-asc');
  nullLikes.posts[0].likes = null;
  assert.strictEqual(api.topicPostFromApi(nullLikes, 16589908), null);
  const noLikes = loadFixture('forum-thread-posts-asc');
  delete noLikes.posts[0].likes;
  delete noLikes.posts[0].dislikes;
  assert.strictEqual(api.topicPostFromApi(noLikes, 16589908), null);
});

test('the thread row rating is consistent with the topic post (one sample: net or likes-only is still open)', () => {
  const row = loadFixture('user-forumthreads').forumThreads[0];
  assert.strictEqual(api.mineThreadFromApi(row).rating, 7);
  const topic = api.topicPostFromApi(loadFixture('forum-thread-posts-asc'), row.id);
  assert.strictEqual(topic.up - topic.down, 7, 'true for net and for likes-only alike, so the label stays net');
});

test('an unrecognised answer is undefined, so nothing is stamped', () => {
  assert.strictEqual(api.topicPostFromApi({}, 5), undefined);
  assert.strictEqual(api.topicPostFromApi({ posts: 'x' }, 5), undefined);
  assert.strictEqual(api.topicPostFromApi(null, 5), undefined);
});

test('the post body never reaches the result', () => {
  const page = loadFixture('forum-thread-posts-asc');
  page.posts[0].content = 'SECRET TOPIC BODY';
  assert.strictEqual(JSON.stringify(api.topicPostFromApi(page, 16589908)).indexOf('SECRET'), -1);
});

test('applyTopicPost stamps the check, and a miss clears old thumbs', () => {
  const snap = mineOf([started(5)]);
  const hit = api.applyTopicPost(snap, 5, { up: 3, down: 1 }, NOW);
  assert.strictEqual(hit.threads[0].up, 3);
  assert.strictEqual(hit.threads[0].topicAt, NOW);
  assert.strictEqual('up' in snap.threads[0], false, 'input not mutated');
  const miss = api.applyTopicPost(hit, 5, null, NOW + 1);
  assert.strictEqual('up' in miss.threads[0], false);
  assert.strictEqual(miss.threads[0].topicAt, NOW + 1);
});

test('lookup targets: started only, never-checked newest first, then oldest check, TTL and cap', () => {
  const TTL = api.TOPIC_TTL_MS;
  assert.strictEqual(TTL, 12 * HOUR, 'the Settings text promises 12 hours');
  assert.strictEqual(api.REACTION_LOOKUPS_PER_RUN, 5, 'the Settings text promises 5');
  const posted = api.freshMineThread(9, NOW);
  posted.posted = true;
  const mine = mineOf([
    started(1, null, 100),
    started(2, null, 200),
    started(3, { topicAt: NOW - TTL }, 900),
    started(4, { topicAt: NOW - TTL + 1 }, 999),
    started(6, { topicAt: NOW - TTL - 5 }, 50),
    posted,
  ]);
  assert.deepStrictEqual(api.reactionLookupTargets(mine, NOW, TTL, 10), [2, 1, 6, 3]);
  assert.deepStrictEqual(api.reactionLookupTargets(mine, NOW, TTL, 2), [2, 1]);
  assert.deepStrictEqual(api.reactionLookupTargets(mine, NOW, TTL, 0), []);
});
