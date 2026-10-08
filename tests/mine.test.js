'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { loadUserscript, forumThreadsPayload, forumPostsPayload, forumThreadPayload, FIXTURE_SELF_ID } = require('./load-userscript');

// Redacted live responses from issue #14. See
// docs/reference/torn-api-live-findings-2026-10-08.md for what each shows.
const FX_THREADS = require('./fixtures/user-forumthreads.json');
const FX_POSTS = require('./fixtures/user-forumposts.json');
const FX_THREAD = require('./fixtures/forum-thread.json');
const FX_THREAD_POSTS = require('./fixtures/forum-thread-posts-asc.json');
const FX_LAST_PAGE = require('./fixtures/forum-posts-large-last-page.json');
const FX_SUBS = require('./fixtures/user-forumsubscribedthreads.json');

const { exports: api } = loadUserscript();

test('the live thread row becomes a started record', () => {
  const raw = FX_THREADS.forumThreads[0];
  const t = api.mineThreadFromApi(raw);
  assert.strictEqual(t.id, 16589908);
  assert.strictEqual(t.forumId, 61);
  assert.strictEqual(t.totalKnown, true);
  assert.strictEqual(t.lastPostAt, 1786067226 * 1000);
  assert.strictEqual(t.lastPosterId, 1001);
  assert.strictEqual(t.authorId, FIXTURE_SELF_ID);
  assert.strictEqual(t.tornNew, 0);
  assert.strictEqual(t.tornNewKnown, true, 'new_posts: 0 is a real zero, not a missing field');
});

// Live findings 3 and 4. A thread object's `posts` counts REPLIES; the
// subscribed row's posts.total, and so lastSeenTotal, counts every post. If
// the stored total kept the reply count, a thread read while subscribed would
// hide its next reply in My posts.
test('a thread total counts the topic: posts + 1, from the live fixtures', () => {
  const row = FX_THREADS.forumThreads[0];
  assert.strictEqual(row.posts, 1, 'fixture: thread 16589908 reports one reply');
  assert.strictEqual(FX_THREAD_POSTS.posts.length, 2, 'fixture: its post list holds the topic and that reply');
  assert.strictEqual(api.mineThreadFromApi(row).postsTotal, 2);
  assert.strictEqual(api.threadPostsTotal(FX_THREAD.thread), 2, 'forum/{id}/thread uses the same reply count');

  // Thread 16561608: posts: 6206 in the note (finding 3); the fixture's last
  // page sits at offset 6200 (its prev link is 6180, pages are 20) and holds 7.
  const prevOffset = Number(/offset=(\d+)/.exec(FX_LAST_PAGE._metadata.links.prev)[1]);
  const counted = prevOffset + 20 + FX_LAST_PAGE.posts.length;
  assert.strictEqual(counted, 6207);
  assert.strictEqual(api.threadPostsTotal({ posts: 6206 }), counted);

  // A subscribed-shape total already counts the topic and is not shifted.
  const sub = FX_SUBS.forumSubscribedThreads.find((r) => r.id === 16505837);
  assert.strictEqual(sub.posts.total, 1);
  assert.strictEqual(api.threadPostsTotal({ posts: sub.posts }), 1);
  assert.strictEqual(api.threadPostsTotal({ posts: 0 }), 1, 'finding 4: the same thread said posts: 0 on forum/{id}/thread');
});

test('a missing total is unknown, never a checked zero, and a missing new_posts is not a zero', () => {
  const none = api.mineThreadFromApi({ id: 1 });
  assert.strictEqual(none.totalKnown, false, 'a missing total must be unknown, never a checked zero');
  assert.strictEqual(none.postsTotal, 0);
  assert.strictEqual(api.threadPostsTotal({}), -1);
  const noNew = api.mineThreadFromApi(forumThreadsPayload([{ id: 5, noNewPosts: true }]).forumThreads[0]);
  assert.strictEqual(noNew.tornNewKnown, false);
});

test('the live post rows keep thread and time and drop the body', () => {
  const p = api.minePostFromApi(FX_POSTS.forumPosts[1]);
  assert.deepStrictEqual(Object.keys(p).sort(), ['at', 'authorId', 'postId', 'threadId']);
  assert.strictEqual(p.threadId, 16561608);
  assert.strictEqual(p.at, 1780173715 * 1000);
  assert.strictEqual(p.authorId, FIXTURE_SELF_ID);
  const built = api.minePostFromApi(forumPostsPayload([{ id: 9, threadId: 5 }]).forumPosts[0]);
  assert.ok(JSON.stringify(built).indexOf('SECRET') === -1, 'post content must never be kept');
  const all = FX_POSTS.forumPosts.map((r) => api.minePostFromApi(r));
  assert.ok(all.every((x) => x && x.threadId > 0), 'every live row parses');
});

test('rows with no id are dropped rather than invented', () => {
  assert.strictEqual(api.mineThreadFromApi({ title: 'x' }), null);
  assert.strictEqual(api.minePostFromApi({ id: 3 }), null);
  assert.strictEqual(api.minePostFromApi('junk'), null);
});

test('the list is found under any of the names Torn might use, and missing is null', () => {
  assert.deepStrictEqual(api.pickList({ forumThreads: [1] }, ['forumThreads', 'forum_threads', 'threads']), [1]);
  assert.deepStrictEqual(api.pickList({ threads: [2] }, ['forumThreads', 'forum_threads', 'threads']), [2]);
  assert.strictEqual(api.pickList({ other: [] }, ['forumThreads']), null);
  assert.strictEqual(api.pickList(null, ['forumThreads']), null);
});

test('a stored snapshot reads back unchanged', () => {
  // The c4d91e1 lesson: a normaliser that cannot read its own output reports
  // the user's cache as damaged on every reload.
  const snap = api.freshMine();
  snap.fetchedAt = 1000;
  snap.selfId = 7;
  const t = api.freshMineThread(5, 1000);
  Object.assign(t, { started: true, postsTotal: 12, totalKnown: true, baselineTotal: 10, title: 'T', tornNew: 2, tornNewKnown: true });
  snap.threads.push(t);
  const once = api.normaliseMine(JSON.parse(JSON.stringify(snap)));
  assert.deepStrictEqual(once, snap);
  assert.deepStrictEqual(api.normaliseMine(JSON.parse(JSON.stringify(once))), once);
});

test('a hostile snapshot normalises to something valid and capped', () => {
  assert.deepStrictEqual(api.normaliseMine('junk'), api.freshMine());
  assert.deepStrictEqual(api.normaliseMine({ v: 99 }), api.freshMine());
  const many = { v: 1, threads: [] };
  for (let i = 1; i <= 500; i += 1) many.threads.push({ id: i });
  assert.strictEqual(api.normaliseMine(many).threads.length, api.MINE_MAX_THREADS);
});
