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

const T0 = 1700000000000;
const MIN = 60000;

const SELF = FIXTURE_SELF_ID;   // the key owner in tests/fixtures/ (1000)

// `total` here is the stored unit, every post including the topic. The API
// row carries replies, one fewer (live finding 3), so the builder gets total - 1.
function started(id, total, lastAt, lastPosterId, extra) {
  return api.mineThreadFromApi(forumThreadsPayload([Object.assign({
    id, forumId: 61, title: 'T' + id, replies: total - 1,
    lastAt: lastAt / 1000, lastPoster: { id: lastPosterId },
  }, extra || {})]).forumThreads[0]);
}
function post(threadId, at) {
  return api.minePostFromApi(forumPostsPayload([{ id: threadId * 10, threadId, at: at / 1000 }]).forumPosts[0]);
}

test('first sight sets the baseline, so installing never floods history as new', () => {
  const s = api.mergeMineSnapshot(api.freshMine(), [started(1, 40, T0, 99)], [], T0, true);
  const t = s.threads[0];
  assert.strictEqual(t.started, true);
  assert.strictEqual(t.postsTotal, 40);
  assert.strictEqual(t.baselineTotal, 40);
  assert.strictEqual(s.selfId, SELF);
  assert.strictEqual(s.fetchedAt, T0);
});

test('a later fetch keeps the baseline, so new replies show as the difference', () => {
  const a = api.mergeMineSnapshot(api.freshMine(), [started(1, 40, T0, 99)], [], T0, true);
  const b = api.mergeMineSnapshot(a, [started(1, 43, T0 + MIN, 99)], [], T0 + MIN, true);
  assert.strictEqual(b.threads[0].postsTotal, 43);
  assert.strictEqual(b.threads[0].baselineTotal, 40);
});

test('when the last word is yours, the baseline catches up', () => {
  const a = api.mergeMineSnapshot(api.freshMine(), [started(1, 40, T0, 99)], [], T0, true);
  const b = api.mergeMineSnapshot(a, [started(1, 44, T0 + MIN, SELF)], [], T0 + MIN, true);
  assert.strictEqual(b.threads[0].baselineTotal, 44, 'your own post is not an unread reply');
});

test('a posted-in thread has no total until a lookup supplies one', () => {
  const s = api.mergeMineSnapshot(api.freshMine(), [], [post(2, T0)], T0, true);
  const t = s.threads[0];
  assert.strictEqual(t.posted, true);
  assert.strictEqual(t.started, false);
  assert.strictEqual(t.totalKnown, false);
  assert.strictEqual(t.myLastPostAt, T0);
});

test('a lookup sets the total, first sight baselines it, and a later lookup shows the gap', () => {
  let s = api.mergeMineSnapshot(api.freshMine(), [], [post(2, T0)], T0, true);
  // 19 replies on the wire is 20 posts stored (live finding 3).
  const detail = api.parseThreadDetail(forumThreadPayload({ id: 2, forumId: 5, title: 'Two', replies: 19, lastAt: T0 / 1000 + 60, lastPoster: { id: 99 } }).thread);
  s = api.applyMineDetail(s, 2, detail, T0 + MIN);
  assert.strictEqual(s.threads[0].totalKnown, true);
  assert.strictEqual(s.threads[0].baselineTotal, 20);
  assert.strictEqual(s.threads[0].forumId, 5);
  s = api.applyMineDetail(s, 2, Object.assign({}, detail, { postsTotal: 23 }), T0 + 2 * MIN);
  assert.strictEqual(s.threads[0].postsTotal, 23);
  assert.strictEqual(s.threads[0].baselineTotal, 20);
});

test('the live thread detail reads total, last poster and lock state', () => {
  // forum-thread.json: thread 16589908, posts: 1 (one reply), so 2 posts.
  const d = api.parseThreadDetail(FX_THREAD.thread);
  assert.deepStrictEqual(d, {
    title: '[title redacted]', forumId: 61, postsTotal: 2, totalKnown: true,
    lastPostAt: 1786067226000, lastPosterId: 1001, isLocked: false, isSticky: false,
  });
  assert.strictEqual(api.parseThreadDetail(null), null);
  assert.strictEqual(api.parseThreadDetail({ title: 'x' }).totalKnown, false);
  assert.strictEqual(api.parseThreadDetail(forumThreadPayload({ id: 3, noPosts: true }).thread).totalKnown, false);
});

test('a started thread keeps Torn\'s new_posts, and a row without it forgets the old value', () => {
  const a = api.mergeMineSnapshot(api.freshMine(), [started(1, 10, T0, 99, { newPosts: 3 })], [], T0, true);
  assert.strictEqual(a.threads[0].tornNew, 3);
  assert.strictEqual(a.threads[0].tornNewKnown, true);
  const b = api.mergeMineSnapshot(a, [started(1, 10, T0, 99, { noNewPosts: true })], [], T0 + MIN, true);
  assert.strictEqual(b.threads[0].tornNewKnown, false, 'a stale Torn count must not outlive the row that carried it');
});

test('a partial fetch does not reset the TTL clock', () => {
  const a = api.mergeMineSnapshot(api.freshMine(), [started(1, 4, T0, SELF)], [], T0, true);
  const b = api.mergeMineSnapshot(a, [started(1, 4, T0, SELF)], [], T0 + MIN, false);
  assert.strictEqual(b.fetchedAt, T0);
});

test('threads that drop out of the latest page are kept, newest first, up to the cap', () => {
  const a = api.mergeMineSnapshot(api.freshMine(), [], [post(1, T0), post(2, T0 + MIN)], T0, true);
  const b = api.mergeMineSnapshot(a, [], [post(3, T0 + 2 * MIN)], T0 + 2 * MIN, true);
  assert.deepStrictEqual(b.threads.map((t) => t.id), [3, 2, 1]);
  const many = [];
  for (let i = 1; i <= 250; i += 1) many.push(post(i, T0 + i * 1000));
  assert.strictEqual(api.mergeMineSnapshot(api.freshMine(), [], many, T0, true).threads.length, api.MINE_MAX_THREADS);
});

test('merging never mutates the snapshot it was given', () => {
  const a = api.mergeMineSnapshot(api.freshMine(), [started(1, 4, T0, 99)], [], T0, true);
  const frozen = JSON.stringify(a);
  api.mergeMineSnapshot(a, [started(1, 9, T0 + MIN, SELF)], [post(2, T0)], T0 + MIN, true);
  api.applyMineDetail(a, 1, api.parseThreadDetail({ posts: 50 }), T0 + MIN);
  assert.strictEqual(JSON.stringify(a), frozen);
});

function rec(over) {
  return Object.assign(api.freshMineThread(1, T0), { posted: true }, over || {});
}

test('a subscribed thread uses Torn count and dismissal, never a local count', () => {
  const entry = api.normaliseThreadEntry({ lastSeenTotal: 0 });
  const u = api.mineUnreadFor({ postsNew: 3, postsTotal: 12 }, entry, rec({ totalKnown: true, postsTotal: 50, baselineTotal: 10 }));
  assert.strictEqual(u.unread, 3);
  assert.strictEqual(u.unreadSource, 'torn');
});

test('an unsubscribed thread counts posts since the baseline or the last Mark read', () => {
  const r = rec({ totalKnown: true, postsTotal: 25, baselineTotal: 20 });
  assert.strictEqual(api.mineUnreadFor(null, api.normaliseThreadEntry(null), r).unread, 5);
  assert.strictEqual(api.mineUnreadFor(null, api.normaliseThreadEntry(null), r).unreadSource, 'local');
  assert.strictEqual(api.mineUnreadFor(null, api.normaliseThreadEntry({ lastSeenTotal: 24 }), r).unread, 1);
  assert.strictEqual(api.mineUnreadFor(null, api.normaliseThreadEntry({ lastSeenTotal: 25 }), r).unread, 0);
});

test('a started thread with new_posts uses Torn\'s count, with the local dismissal layer', () => {
  const r = rec({ started: true, totalKnown: true, postsTotal: 25, baselineTotal: 25, tornNew: 4, tornNewKnown: true });
  const u = api.mineUnreadFor(null, api.normaliseThreadEntry(null), r);
  assert.strictEqual(u.unread, 4, 'Torn\'s count, not the local 25 - 25 = 0');
  assert.strictEqual(u.unreadSource, 'torn');
  const read = api.mineUnreadFor(null, api.normaliseThreadEntry({ lastSeenTotal: 25 }), r);
  assert.strictEqual(read.unread, 0, 'Mark read still dismisses it, as in Threads');
  const absent = api.mineUnreadFor(null, api.normaliseThreadEntry(null), Object.assign({}, r, { tornNewKnown: false, baselineTotal: 20 }));
  assert.strictEqual(absent.unread, 5, 'without new_posts the local count takes over');
  assert.strictEqual(absent.unreadSource, 'local');
});

// Live findings 3 and 4, end to end through the real fixtures. lastSeenTotal
// is written by markRead from the subscribed posts.total (every post); the
// My posts total comes from a thread object's posts (replies). Both
// directions of a unit mix are pinned: a reply hidden, and a phantom
// "1 new" in Threads after Mark read in My posts.
test('a read marker from a subscribed total and a My posts total agree', () => {
  // Thread 16505837: subscribed total 1; forum/{id}/thread said posts: 0.
  const subRaw = FX_SUBS.forumSubscribedThreads.find((r) => r.id === 16505837);
  const sub = api.normaliseSubscribedRow(subRaw);
  assert.strictEqual(sub.postsTotal, 1);
  // Read while subscribed, then unsubscribed; it is one of the user's threads.
  let org = api.markRead(api.freshOrganizer(T0), 16505837, sub.postsTotal, T0);
  const lookup = (replies, at) => api.parseThreadDetail(forumThreadPayload({
    id: 16505837, replies, lastAt: at / 1000, lastPoster: { id: 99 },
  }).thread);
  let snap = api.mergeMineSnapshot(api.freshMine(), [], [post(16505837, T0 - MIN)], T0, true);
  snap = api.applyMineDetail(snap, 16505837, lookup(0, T0), T0);
  let u = api.mineUnreadFor(null, org.threads['16505837'], snap.threads[0]);
  assert.strictEqual(u.unread, 0, 'quiet thread, already read: nothing new');
  snap = api.applyMineDetail(snap, 16505837, lookup(1, T0 + MIN), T0 + MIN);
  u = api.mineUnreadFor(null, org.threads['16505837'], snap.threads[0]);
  assert.strictEqual(u.unread, 1, 'one reply from someone else must show, not vanish into the unit gap');

  // Mark read in My posts, then subscribe on Torn: Threads must see it as read.
  org = api.markRead(org, 16505837, u.postsTotal, T0 + 2 * MIN);
  const resub = api.normaliseSubscribedRow(Object.assign({}, subRaw, { posts: { new: 1, total: 2 } }));
  assert.strictEqual(api.unreadFor(resub, org.threads['16505837']).dismissed, true,
    'Mark read in My posts must count as read in Threads, not leave "1 new"');
});

test('an unknown total is unchecked, not a checked zero', () => {
  const u = api.mineUnreadFor(null, api.normaliseThreadEntry(null), rec({ totalKnown: false }));
  assert.strictEqual(u.unread, 0);
  assert.strictEqual(u.unreadSource, 'unchecked');
});

test('only organising state counts as organised; a read marker or a visit does not', () => {
  assert.strictEqual(api.isOrganised(api.normaliseThreadEntry({ lastSeenTotal: 5, lastVisitedAt: 9 }), false), false);
  for (const e of [{ pinned: true }, { tags: ['x'] }, { folderId: 'guides' }, { priority: 1 }, { note: 'n' }, { archived: true }]) {
    assert.strictEqual(api.isOrganised(api.normaliseThreadEntry(e), false), true, JSON.stringify(e));
  }
  assert.strictEqual(api.isOrganised(api.normaliseThreadEntry(null), true), true, 'a draft is organising');
});
