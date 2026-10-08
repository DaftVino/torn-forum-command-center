'use strict';

// Author-only mode (issue #4). The fixtures are the redacted live captures
// from #14 and #15; see docs/reference/torn-api-live-findings-2026-10-08.md.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { loadUserscript } = require('./load-userscript');

const { exports: api } = loadUserscript();
const fixture = (name) => JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', name + '.json'), 'utf8'));

const SMALL = fixture('forum-thread-posts-from-small').posts;   // thread 16589908, from = its one reply's created_time
const PAGE0 = fixture('forum-posts-large-from');                // thread 16561608, newest 20 since from
const PAGE1 = fixture('forum-posts-large-from-prev');            // the page PAGE0's prev link points at (finding 15)
const LARGE = PAGE0.posts;
const LARGE_AUTHOR = fixture('forum-posts-large-offset0').posts[0].author.id; // topic post: the thread author
const SINCE = 1700000000000; // a marker before every fixture post
const ids = (posts) => posts.map((p) => p.id);
const distinctBy = (posts, authorId) => new Set(posts.filter((p) => p.author.id === authorId).map((p) => p.id)).size;

test('API facts: from returns the newest 20, newest first, with no next page', () => {
  assert.strictEqual(LARGE.length, 20);
  for (let i = 1; i < LARGE.length; i += 1) {
    assert.ok(LARGE[i - 1].created_time > LARGE[i].created_time, 'newest first at ' + i);
  }
  assert.strictEqual(PAGE0._metadata.links.next, null);
  assert.deepStrictEqual(fixture('forum-posts-large-from-offset20-ignored').posts, LARGE,
    'offset is ignored when from is set, so to is the only way back');
});

test('API facts: from is inclusive', () => {
  // The capture sent from equal to this post's own created_time and got it back.
  assert.strictEqual(SMALL.length, 1);
  assert.strictEqual(SMALL[0].created_time, 1786067226);
});

test('API facts: to pages backwards and is inclusive, so pages share one post', () => {
  const oldest0 = LARGE[LARGE.length - 1].created_time;
  assert.match(PAGE0._metadata.links.prev, new RegExp('[?&]to=' + oldest0 + '(&|$)'));
  assert.strictEqual(PAGE1.posts.length, 20);
  assert.strictEqual(PAGE1.posts[0].created_time, oldest0, 'the next page starts at the boundary');
  const shared = ids(PAGE1.posts).filter((id) => ids(LARGE).includes(id));
  assert.deepStrictEqual(shared, [27638444], 'exactly one boundary post is repeated');
  assert.strictEqual(PAGE1._metadata.links.next, null);
  assert.notStrictEqual(PAGE1._metadata.links.prev, null);
});

test('API facts: a thread\'s posts counts replies, one less than every post', () => {
  const thread = fixture('forum-thread').thread;
  const all = fixture('forum-thread-posts-asc').posts;
  assert.strictEqual(thread.id, 16589908);
  assert.strictEqual(all.length, thread.posts + 1, 'subscribed posts.total is thread.posts + 1');
});

test('a post exactly at the marker was already seen and is not counted', () => {
  const at = SMALL[0].created_time * 1000;
  const author = SMALL[0].author.id;
  assert.strictEqual(api.summariseAuthorPosts(SMALL, author, at, true).count, 0,
    'from is inclusive, so the marker itself must be excluded');
  const fresh = api.summariseAuthorPosts(SMALL, author, at - 1000, true);
  assert.strictEqual(fresh.count, 1);
  assert.strictEqual(fresh.latestAt, at);
});

test('the boundary post repeated by to is counted once (real pages)', () => {
  const both = LARGE.concat(PAGE1.posts);
  const boundaryAuthor = LARGE[LARGE.length - 1].author.id; // the author of post 27638444
  const naive = both.filter((p) => p.author.id === boundaryAuthor).length;
  const r = api.summariseAuthorPosts(both, boundaryAuthor, SINCE, false);
  assert.strictEqual(r.count, distinctBy(both, boundaryAuthor));
  assert.strictEqual(r.count, naive - 1, 'the shared post must not be counted twice');
});

test('the boundary post is counted once when it is the only author post (real-shaped pair)', () => {
  // Two pages shaped exactly like Torn's: 2 posts, then 1, sharing the
  // boundary post, which is the author's. One author post, not two.
  const shape = LARGE[0];
  const post = (id, authorId, t) => Object.assign({}, shape, { id, created_time: t, author: Object.assign({}, shape.author, { id: authorId }) });
  const pageA = [post(9002, 1099, 1784000200), post(9001, 1020, 1784000100)];
  const pageB = [post(9001, 1020, 1784000100)];
  const r = api.summariseAuthorPosts(pageA.concat(pageB), 1020, SINCE, true);
  assert.deepStrictEqual([r.count, r.latestAt], [1, 1784000100000]);
});

test('page step: a short page or a null prev ends the walk complete', () => {
  assert.deepStrictEqual(api.authorPageStep(SMALL, [], 20, null), { done: true, complete: true, to: 0 });
  assert.deepStrictEqual(api.authorPageStep(SMALL, [], 20, undefined), { done: true, complete: true, to: 0 },
    'a short page is complete even without _metadata');
  assert.deepStrictEqual(api.authorPageStep(LARGE, [], 20, null), { done: true, complete: true, to: 0 },
    'Torn saying there is no earlier page is believed');
});

test('page step: a full page with a prev link continues from its oldest post', () => {
  const step0 = api.authorPageStep(LARGE, [], 20, PAGE0._metadata.links.prev);
  assert.deepStrictEqual(step0, { done: false, complete: false, to: LARGE[LARGE.length - 1].created_time });
  const step1 = api.authorPageStep(PAGE1.posts, ids(LARGE), 20, PAGE1._metadata.links.prev);
  assert.deepStrictEqual(step1, { done: false, complete: false, to: PAGE1.posts[PAGE1.posts.length - 1].created_time });
});

test('page step: a full page that adds nothing new stops the walk incomplete', () => {
  // More than 20 posts in one second: to cannot move, and the same page returns.
  assert.deepStrictEqual(api.authorPageStep(LARGE, ids(LARGE), 20, 'x'), { done: true, complete: false, to: 0 });
});

test('only non-author posts in a complete walk count zero', () => {
  const threadAuthor = fixture('forum-thread').thread.author.id; // 1000; the reply is by 1001
  const r = api.summariseAuthorPosts(SMALL, threadAuthor, SINCE, true);
  assert.deepStrictEqual([r.count, r.complete], [0, true]);
  assert.strictEqual(r.newestAt, SMALL[0].created_time * 1000, 'last activity is still learned');
});

test('a walk cut short with no author post is not a known zero', () => {
  // A walk cut short after its first page (budget or cap). The thread author
  // wrote none of page 0's 20 posts, though they do appear on the prev page,
  // which is exactly why a cut-short zero must not be read as "none".
  assert.strictEqual(distinctBy(LARGE, LARGE_AUTHOR), 0, 'fixture: the thread author wrote none of page 0');
  assert.ok(distinctBy(PAGE1.posts, LARGE_AUTHOR) > 0, 'fixture: but they did post further back');
  const r = api.summariseAuthorPosts(LARGE, LARGE_AUTHOR, SINCE, false);
  assert.deepStrictEqual([r.count, r.complete], [0, false]);
});

test('a walk cut short with author posts is a lower bound with an exact latest time', () => {
  // Treat player 1020, who wrote 4 of the first 20, as the author.
  const both = LARGE.concat(PAGE1.posts);
  const r = api.summariseAuthorPosts(both, 1020, SINCE, false);
  assert.strictEqual(r.count, distinctBy(both, 1020));
  assert.ok(r.count >= 4);
  assert.strictEqual(r.complete, false);
  assert.strictEqual(r.latestAt, 1787174754000, 'the newest author post is on the first page, so this is exact');
  assert.strictEqual(r.newestAt, LARGE[0].created_time * 1000, 'newest first: posts[0] is the last post');
});

test('order does not matter and junk is tolerated', () => {
  const both = LARGE.concat(PAGE1.posts);
  assert.deepStrictEqual(api.summariseAuthorPosts(both.slice().reverse(), 1020, SINCE, false),
    api.summariseAuthorPosts(both, 1020, SINCE, false));
  assert.strictEqual(api.summariseAuthorPosts([null, 'x'].concat(SMALL), 1001, SINCE, true).count, 1);
  assert.strictEqual(api.summariseAuthorPosts(undefined, 5, SINCE, true).count, 0);
  assert.strictEqual(api.summariseAuthorPosts(SMALL, 0, SINCE, true).count, 0, 'unknown author matches nobody');
  assert.strictEqual(api.summariseAuthorPosts(SMALL, 1001, SINCE, 'yes').complete, false, 'only true is complete');
});

test('posts before the marker are skipped, so an ignored from can never claim the topic as new', () => {
  // If Torn stopped honouring from, it would return the oldest page: the topic
  // post by the author, long before the marker.
  const oldest = fixture('forum-posts-large-offset0').posts;
  const marker = (oldest[oldest.length - 1].created_time + 1) * 1000;
  assert.strictEqual(api.summariseAuthorPosts(oldest, LARGE_AUTHOR, marker, false).count, 0);
});
