'use strict';

const test = require('node:test');
const assert = require('node:assert');
const {
  loadUserscript, FORUMS_LOCATION, subscribedThreadsPayload, forumFeedPayload,
} = require('./load-userscript');

const KEY = 'abcdefghij123456';
const NOW = 1700000000000;

// Each round drains microtasks and then advances the clock. The step has to
// clear MIN_REQUEST_GAP_MS, because the limiter deliberately spaces requests:
// a smaller step would stall the chain after the first call and the test would
// "prove" a request that was never skipped. Draining before advancing means an
// in-flight request has already settled, so the 15 second deadline never fires
// by accident.
async function settle(env, ms) {
  const step = ms === undefined ? 1000 : ms;
  for (let round = 0; round < 30; round += 1) {
    for (let i = 0; i < 15; i += 1) await Promise.resolve();
    env.advanceTimersBy(step);
  }
  for (let i = 0; i < 20; i += 1) await Promise.resolve();
}

// A transport that answers each endpoint from a table and records what was
// asked for, so a test can assert on the request budget rather than guess it.
// A table entry may be a function of the full URL, so one path can answer
// page by page; seenUrls keeps each URL with its query for the tests that
// assert on parameters.
function router(table) {
  const seen = [];
  const seenUrls = [];
  return {
    seen,
    seenUrls,
    fetch(url) {
      seen.push(url.replace('https://api.torn.com/v2/', '').split('?')[0]);
      seenUrls.push(url.replace('https://api.torn.com/v2/', ''));
      const path = url.replace('https://api.torn.com/v2/', '').split('?')[0];
      const entry = Object.prototype.hasOwnProperty.call(table, path) ? table[path] : { error: { code: 6, error: 'Unknown' } };
      const body = typeof entry === 'function' ? entry(url) : entry;
      return Promise.resolve({ status: 200, text: () => Promise.resolve(JSON.stringify(body)) });
    },
  };
}

function boot(table, options) {
  const r = router(table);
  const env = loadUserscript(Object.assign({
    location: FORUMS_LOCATION,
    now: NOW,
    gmStore: [['tfcc:key', KEY]],
    fetch: r.fetch,
  }, options || {}));
  env.router = r;
  return env;
}

test('a refresh with no enrichment needed is exactly three requests', async () => {
  const env = boot({
    'user/forumsubscribedthreads': subscribedThreadsPayload([{ id: 1 }, { id: 2 }]),
    'user/forumfeed': forumFeedPayload([{ threadId: 1, timestamp: NOW / 1000 }]),
    'forum/categories': { categories: [{ id: 61, title: 'Tutorials', acronym: 'TG' }] },
  });
  await settle(env);

  const calls = env.router.seen.filter((u) => u.indexOf('forum/') === 0 || u.indexOf('user/') === 0);
  assert.deepStrictEqual(calls, ['user/forumsubscribedthreads', 'user/forumfeed', 'forum/categories']);
  assert.strictEqual(env.exports.state.feed.subscribed.length, 2);
  assert.strictEqual(env.exports.state.lastError, null);
});

test('threads with unread posts are enriched, within the budget', async () => {
  const table = {
    'user/forumsubscribedthreads': subscribedThreadsPayload([
      { id: 1, new: 3 }, { id: 2, new: 1 }, { id: 3, new: 0 },
    ]),
    'user/forumfeed': forumFeedPayload([]),
    'forum/categories': { categories: [] },
  };
  for (const id of [1, 2, 3]) {
    table['forum/' + id + '/thread'] = { thread: { id, last_post_time: NOW / 1000 - 60, is_locked: false, is_sticky: false } };
  }

  const env = boot(table);
  await settle(env);

  const enriched = env.router.seen.filter((u) => /^forum\/\d+\/thread$/.test(u));
  assert.deepStrictEqual(enriched.sort(), ['forum/1/thread', 'forum/2/thread'],
    'only threads with unread posts and no recent time are worth a request');

  const row = env.exports.state.rows.find((r) => r.id === '1');
  assert.strictEqual(row.activitySource, 'enriched');
});

test('the enrichment budget is respected and can be turned off', async () => {
  const many = [];
  for (let i = 1; i <= 20; i += 1) many.push({ id: i, new: 1 });
  const table = {
    'user/forumsubscribedthreads': subscribedThreadsPayload(many),
    'user/forumfeed': forumFeedPayload([]),
    'forum/categories': { categories: [] },
  };
  for (let i = 1; i <= 20; i += 1) {
    table['forum/' + i + '/thread'] = { thread: { id: i, last_post_time: NOW / 1000 } };
  }

  const env = boot(table);
  await settle(env);
  const enriched = env.router.seen.filter((u) => /thread$/.test(u));
  assert.strictEqual(enriched.length, env.exports.DEFAULT_ENRICH_BUDGET,
    'the panel tells the user this number, so it has to hold');

  // Zero means zero requests, not "a smaller number".
  const off = boot(table, { gmStore: [['tfcc:key', KEY], ['tfcc:settings', JSON.stringify({ v: 1, enrichBudget: 0 })]] });
  await settle(off);
  assert.strictEqual(off.router.seen.filter((u) => /thread$/.test(u)).length, 0);
});

test('a fresh category list is not fetched again', async () => {
  const env = boot({
    'user/forumsubscribedthreads': subscribedThreadsPayload([{ id: 1 }]),
    'user/forumfeed': forumFeedPayload([]),
    'forum/categories': { categories: [{ id: 61, title: 'Tutorials', acronym: 'TG' }] },
  });
  await settle(env);
  assert.strictEqual(env.router.seen.filter((u) => u === 'forum/categories').length, 1);

  // Started, then settled. Awaiting it first would block the only thing that
  // advances the clock, and the request chain could never progress.
  const again = env.exports.refreshAll(NOW + 1000);
  await settle(env);
  await again;
  assert.strictEqual(env.router.seen.filter((u) => u === 'forum/categories').length, 1,
    'forum names change about never; a daily fetch is plenty');
});

test('a failed subscribed-threads call stops the refresh and is reported', async () => {
  const env = boot({ 'user/forumsubscribedthreads': { error: { code: 2, error: 'Incorrect key' } } });
  await settle(env);

  assert.strictEqual(env.router.seen.filter((u) => u === 'user/forumfeed').length, 0,
    'there is no point asking for more once the key is refused');
  assert.strictEqual(env.exports.state.lastError.reason, 'torn');
  assert.match(env.exports.state.lastError.detail, /not valid/);

  // And the panel says so rather than sitting blank.
  assert.match(env.doc.getElementById('tfcc-panel').innerHTML, /not valid/);
});

test('a missing category list costs labels, never the refresh', async () => {
  const env = boot({
    'user/forumsubscribedthreads': subscribedThreadsPayload([{ id: 1, forumId: 61 }]),
    'user/forumfeed': forumFeedPayload([]),
    'forum/categories': { error: { code: 17, error: 'Backend error' } },
  });
  await settle(env);

  assert.strictEqual(env.exports.state.lastError, null, 'the data arrived; only the names did not');
  assert.strictEqual(env.exports.state.rows.length, 1);
  assert.strictEqual(env.exports.state.rows[0].forumName, 'Forum 61', 'named, never blank');
});

test('no key means no request and a visible prompt', async () => {
  const env = boot({}, { gmStore: [] });
  await settle(env);
  assert.strictEqual(env.router.seen.length, 0);
  assert.match(env.doc.getElementById('tfcc-panel').innerHTML, /No API key yet/);
});

test('a second refresh while one is running is dropped, not queued', async () => {
  const env = boot({
    'user/forumsubscribedthreads': subscribedThreadsPayload([{ id: 1 }]),
    'user/forumfeed': forumFeedPayload([]),
    'forum/categories': { categories: [] },
  });
  await settle(env);
  const before = env.router.seen.length;

  const a = env.exports.refreshAll(NOW + 1000);
  const b = await env.exports.refreshAll(NOW + 1000);
  assert.strictEqual(b.reason, 'inflight');
  await settle(env);
  await a;

  assert.ok(env.router.seen.length - before <= 3, 'a double click must not double the traffic');
});

test('the refresh survives a transport that fails outright', async () => {
  const env = loadUserscript({
    location: FORUMS_LOCATION,
    now: NOW,
    gmStore: [['tfcc:key', KEY]],
    fetch: () => Promise.reject(new Error('offline')),
  });
  await settle(env);
  assert.strictEqual(env.exports.state.lastError.reason, 'network');
  assert.ok(env.doc.getElementById('tfcc-panel'), 'the panel is still there to say so');
});

test('auto refresh is off by default', () => {
  const env = boot({});
  assert.strictEqual(env.exports.state.settings.autoRefreshMs, 0);
});

test('the subscribed payload is read from both spellings Torn ships', async () => {
  // The live OpenAPI spec's required array misspells the key as
  // forumSbuscribedThreads while the properties object spells it correctly.
  // Reading both costs one line and removes a whole class of empty-panel bug.
  const env = boot({
    'user/forumsubscribedthreads': { forumSbuscribedThreads: subscribedThreadsPayload([{ id: 9 }]).forumSubscribedThreads },
    'user/forumfeed': forumFeedPayload([]),
    'forum/categories': { categories: [] },
  });
  await settle(env);
  assert.strictEqual(env.exports.state.feed.subscribed.length, 1);
});

test('a refresh writes the snapshot so the next visit paints instantly', async () => {
  const env = boot({
    'user/forumsubscribedthreads': subscribedThreadsPayload([{ id: 1, new: 0 }]),
    'user/forumfeed': forumFeedPayload([]),
    'forum/categories': { categories: [] },
  });
  await settle(env);

  const stored = JSON.parse(env.gmStore.get('tfcc:feed'));
  assert.strictEqual(stored.subscribed.length, 1);
  assert.ok(stored.fetchedAt > 0);

  // A second load with that storage paints rows before any request settles.
  const second = loadUserscript({
    location: FORUMS_LOCATION, now: NOW,
    gmStore: [...env.gmStore.entries()],
  });
  assert.strictEqual(second.exports.state.rows.length, 1);
});

// -- author-only lookups (issue #4) -----------------------------------------
// The posts pages served here are the redacted live captures from #14 and
// #15 (docs/reference/torn-api-live-findings-2026-10-08.md).

const fs = require('node:fs');
const path = require('node:path');
const fixture = (name) => JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', name + '.json'), 'utf8'));

const MARKER = NOW - 3600000;
// from is inclusive (findings note, finding 9), so the request asks for the
// first whole second after the marker.
const MARKER_FROM = Math.floor(MARKER / 1000) + 1;
const PAGE0 = fixture('forum-posts-large-from');     // thread 16561608, newest 20
const PAGE1 = fixture('forum-posts-large-from-prev'); // its prev page (finding 15)
const OLDEST0 = PAGE0.posts[PAGE0.posts.length - 1].created_time;
const OLDEST1 = PAGE1.posts[PAGE1.posts.length - 1].created_time;
const toOf = (url) => { const m = /[?&]to=(\d+)/.exec(url); return m ? Number(m[1]) : 0; };

// A real-shaped page older than the fixtures reach: 20 posts cloned from a
// real one, newest first, starting with the boundary post at `to` (to is
// inclusive), by a player who is nobody's author here. `prev` is set, so the
// walk would go on for ever without the cap.
function olderPage(to, boundary) {
  const shape = PAGE1.posts[0];
  const posts = [boundary];
  for (let k = 1; k < 20; k += 1) {
    posts.push(Object.assign({}, shape, { id: 90000000 + to - k, created_time: to - k,
      author: Object.assign({}, shape.author, { id: 1099 }) }));
  }
  return { posts, _metadata: { links: { prev: 'https://api.torn.com/v2/forum/x/posts?from=1&to=' + (to - 19), next: null } } };
}

// Thread 16561608 as Torn served it: page 0, then its prev page, then (no
// fixture goes further) real-shaped older pages.
function largeChain() {
  return (url) => {
    const to = toOf(url);
    if (!to) return PAGE0;
    if (to === OLDEST0) return PAGE1;
    const all = PAGE0.posts.concat(PAGE1.posts);
    const boundary = all.find((p) => p.created_time === to)
      || Object.assign({}, PAGE1.posts[0], { id: 90000000 + to, created_time: to, author: Object.assign({}, PAGE1.posts[0].author, { id: 1099 }) });
    return olderPage(to, boundary);
  };
}

function authorBoot(table, ids, entryExtra, settingsExtra) {
  const threads = {};
  ids.forEach((id) => { threads[id] = Object.assign({ lastVisitedAt: MARKER }, entryExtra || {}); });
  return boot(table, { gmStore: [['tfcc:key', KEY],
    ['tfcc:settings', JSON.stringify(Object.assign({ v: 1, authorOnly: true }, settingsExtra || {}))],
    ['tfcc:organizer', JSON.stringify({ v: 1, folders: [], lastCatchUpAt: 0, threads })]] });
}
const postsCalls = (env, id) => env.router.seenUrls.filter((u) => u.indexOf('forum/' + id + '/posts') === 0);

test('author mode walks back with to, built from its own parameters, up to the page cap', async () => {
  const small = fixture('forum-thread-posts-from-small');   // thread 16589908: one reply, by 1001
  const smallAuthor = fixture('forum-thread').thread.author; // 1000
  const largeAuthor = fixture('forum-posts-large-offset0').posts[0].author; // 1002
  const table = {
    'user/forumsubscribedthreads': subscribedThreadsPayload([
      // total counts every post. forum-thread.json says posts: 1 (replies only), so total is 2.
      { id: 16589908, new: 1, total: 2, author: smallAuthor },
      { id: 16561608, new: 90, total: 6207, author: largeAuthor },
      // The same real pages, read as if player 1020 were the author.
      { id: 3, new: 90, total: 6207, author: { id: 1020, username: 'player020', karma: 0 } },
      // And as if a player who wrote none of them were the author.
      { id: 4, new: 90, total: 6207, author: { id: 1098, username: 'player098', karma: 0 } }]),
    'user/forumfeed': forumFeedPayload([]),
    'forum/categories': { categories: [] },
    'forum/16589908/posts': small,
    'forum/16561608/posts': largeChain(),
    'forum/3/posts': largeChain(),
    'forum/4/posts': largeChain(),
  };
  const env = authorBoot(table, [16589908, 16561608, 3, 4]);
  await settle(env);

  assert.strictEqual(env.router.seen.filter((u) => /\/thread$/.test(u)).length, 0, 'author mode does not also read the thread');
  assert.strictEqual(postsCalls(env, 16589908).length, 1, 'a short first page ends the walk');
  const walk = postsCalls(env, 16561608);
  assert.strictEqual(walk.length, env.exports.AUTHOR_MAX_PAGES, 'the walk stops at the page cap');
  assert.deepStrictEqual(walk.map(toOf), [0, OLDEST0, OLDEST1], 'each to is the oldest created_time already read');
  for (const u of env.router.seenUrls.filter((x) => /\/posts\?/.test(x))) {
    assert.match(u, new RegExp('[?&]from=' + MARKER_FROM + '(&|$)'), 'from is the marker + 1: ' + u);
    assert.doesNotMatch(u, /[?&](offset|limit|sort|stripTags)=/,
      'built from from and to only, never from the prev URL Torn sent: ' + u);
    assert.strictEqual(u.split(/[?&]key=/).length, 2, 'exactly the one key= tornApiGet adds, none copied from a link');
  }

  const row = (id) => env.exports.state.rows.find((r) => r.id === String(id));
  const read = PAGE0.posts.concat(PAGE1.posts);
  const distinct = (authorId) => new Set(read.filter((p) => p.author.id === authorId).map((p) => p.id)).size;
  assert.deepStrictEqual([row(16589908).authorState, row(16589908).unread], ['none', 0], 'only a non-author reply: no badge');
  // The real author wrote none of page 0 but two posts on page 1, the older
  // one being the boundary page 2 repeats: found by walking back, counted once.
  assert.strictEqual(distinct(largeAuthor.id), 2, 'fixture: the author is on page 1 only');
  assert.deepStrictEqual([row(16561608).authorState, row(16561608).authorNew], ['author-atleast', 2],
    'cut off by the cap with author posts read: N+, and the boundary post once');
  assert.deepStrictEqual([row(4).authorState, row(4).authorReason, row(4).unread],
    ['unchecked', 'too-many', 0], 'cut off by the cap with no author post read: not a known zero');
  assert.deepStrictEqual([row(3).authorState, row(3).authorNew], ['author-atleast', distinct(1020)], 'cut off with author posts: N+');

  const e = env.exports.state.organizer.threads['16561608'];
  assert.strictEqual(e.authorCheckComplete, false);
  assert.strictEqual(e.authorCheckTotal, 6207, 'the check total is subscribed posts.total, never the thread\'s reply count');
  assert.strictEqual(e.lastPostTimeCached, PAGE0.posts[0].created_time * 1000, 'newest first: page 0 gives the last post time');
  assert.ok(env.router.seen.length <= 13);
});

test('a walk that ends inside the cap is exact, and the boundary post counts once', async () => {
  // Page 2 is the boundary post alone with no earlier page: the walk reached
  // the marker on its third request.
  const last = PAGE1.posts[PAGE1.posts.length - 1];
  const chain = (url) => {
    const to = toOf(url);
    if (!to) return PAGE0;
    if (to === OLDEST0) return PAGE1;
    return { posts: [last], _metadata: { links: { prev: null, next: null } } };
  };
  const boundaryAuthor = PAGE0.posts[PAGE0.posts.length - 1].author; // wrote the post both real pages hold
  const table = {
    'user/forumsubscribedthreads': subscribedThreadsPayload([{ id: 16561608, new: 39, total: 6207, author: boundaryAuthor }]),
    'user/forumfeed': forumFeedPayload([]), 'forum/categories': { categories: [] },
    'forum/16561608/posts': chain,
  };
  const env = authorBoot(table, [16561608]);
  await settle(env);
  const all = PAGE0.posts.concat(PAGE1.posts);
  const distinct = new Set(all.filter((p) => p.author.id === boundaryAuthor.id).map((p) => p.id)).size;
  const r = env.exports.state.rows[0];
  assert.deepStrictEqual([r.authorState, r.authorNew], ['author', distinct], 'exact, and the shared post is not counted twice');
  assert.strictEqual(postsCalls(env, 16561608).length, 3);
});

test('breadth before depth: with as many targets as budget, no thread gets a second page', async () => {
  const subs = [];
  const table = { 'user/forumfeed': forumFeedPayload([]), 'forum/categories': { categories: [] } };
  for (let i = 1; i <= 12; i += 1) {
    subs.push({ id: i, new: 90, total: 6207, author: { id: 1002, username: 'player002', karma: 0 } });
    table['forum/' + i + '/posts'] = largeChain();
  }
  table['user/forumsubscribedthreads'] = subscribedThreadsPayload(subs);
  const env = authorBoot(table, subs.map((s) => s.id));
  await settle(env);
  const posts = env.router.seenUrls.filter((u) => /\/posts\?/.test(u));
  assert.strictEqual(posts.length, env.exports.DEFAULT_ENRICH_BUDGET);
  assert.strictEqual(posts.filter((u) => toOf(u)).length, 0, 'every request is a first page');
  assert.strictEqual(new Set(posts.map((u) => u.split('?')[0])).size, env.exports.DEFAULT_ENRICH_BUDGET, 'ten threads, one each');
  assert.ok(env.router.seen.length <= 13, 'the default refresh promise is 13 requests');
});

test('further pages come out of the same budget and never exceed it', async () => {
  // Budget 4, two targets: the first may take 3 pages only because one
  // request stays reserved for the second.
  const table = {
    'user/forumsubscribedthreads': subscribedThreadsPayload([
      { id: 1, new: 90, total: 6207, author: { id: 1002, username: 'player002', karma: 0 } },
      { id: 2, new: 90, total: 6207, author: { id: 1002, username: 'player002', karma: 0 } }]),
    'user/forumfeed': forumFeedPayload([]), 'forum/categories': { categories: [] },
    'forum/1/posts': largeChain(), 'forum/2/posts': largeChain(),
  };
  const env = authorBoot(table, [1, 2], {}, { enrichBudget: 4 });
  await settle(env);
  const counts = [postsCalls(env, 1).length, postsCalls(env, 2).length].sort();
  assert.deepStrictEqual(counts, [1, 3]);
  assert.ok(env.router.seen.length <= 3 + 4);
});

test('the lookup budget still bounds threads, and the rest stay visibly unchecked', async () => {
  const small = fixture('forum-thread-posts-from-small');
  const subs = [];
  const table = { 'user/forumfeed': forumFeedPayload([]), 'forum/categories': { categories: [] } };
  for (let i = 1; i <= 15; i += 1) {
    subs.push({ id: i, new: 2, total: 10 });
    table['forum/' + i + '/posts'] = small; // a short, complete page by someone else
  }
  table['user/forumsubscribedthreads'] = subscribedThreadsPayload(subs);
  const env = authorBoot(table, [1, 2]);
  await settle(env);
  assert.strictEqual(env.router.seen.filter((u) => /\/posts$/.test(u)).length, env.exports.DEFAULT_ENRICH_BUDGET);
  assert.ok(env.router.seen.length <= 13, 'the default refresh promise is 13 requests');
  const unchecked = env.exports.state.rows.filter((r) => r.authorState === 'unchecked');
  assert.strictEqual(unchecked.length, 5);
});

test('a failed further page keeps what was read, as a lower bound', async () => {
  const chain = (url) => (toOf(url) ? { error: { code: 6, error: 'Unknown' } } : PAGE0);
  const table = {
    'user/forumsubscribedthreads': subscribedThreadsPayload([
      { id: 16561608, new: 90, total: 6207, author: { id: 1020, username: 'player020', karma: 0 } }]),
    'user/forumfeed': forumFeedPayload([]), 'forum/categories': { categories: [] },
    'forum/16561608/posts': chain,
  };
  const env = authorBoot(table, [16561608]);
  await settle(env);
  const r = env.exports.state.rows[0];
  assert.deepStrictEqual([r.authorState, r.authorNew], ['author-atleast', 4], 'page 0 holds 4 posts by 1020; never exact');
  assert.strictEqual(env.exports.state.lastError, null);
});

test('a too-many thread is not looked up again while nothing has changed', async () => {
  const table = {
    'user/forumsubscribedthreads': subscribedThreadsPayload([
      { id: 16561608, new: 90, total: 6207, author: fixture('forum-posts-large-offset0').posts[0].author }]),
    'user/forumfeed': forumFeedPayload([]), 'forum/categories': { categories: [] },
    'forum/16561608/posts': largeChain(),
  };
  const env = authorBoot(table, [16561608], {
    authorCheckedAt: NOW - 60000, authorCheckTotal: 6207, authorCheckSince: MARKER,
    authorNewCount: 0, authorCheckComplete: false, authorCheckReason: 'too-many' });
  await settle(env);
  assert.strictEqual(env.router.seen.filter((u) => /\/posts$/.test(u)).length, 0, 'the same walk would read the same posts');
  assert.strictEqual(env.exports.state.rows[0].authorReason, 'too-many');
});

test('a failed first page leaves the row unchecked and the refresh ok', async () => {
  const table = {
    'user/forumsubscribedthreads': subscribedThreadsPayload([{ id: 1, new: 2, total: 10 }]),
    'user/forumfeed': forumFeedPayload([]), 'forum/categories': { categories: [] },
  }; // forum/1/posts falls through to the router's error response
  const env = authorBoot(table, [1]);
  await settle(env);
  assert.strictEqual(env.exports.state.rows.find((r) => r.id === '1').authorState, 'unchecked');
  assert.strictEqual(env.exports.state.lastError, null);
});

test('with the setting off a refresh reads the thread, never the posts walk', async () => {
  const table = {
    'user/forumsubscribedthreads': subscribedThreadsPayload([{ id: 1, new: 2, total: 10 }]),
    'user/forumfeed': forumFeedPayload([]), 'forum/categories': { categories: [] },
    'forum/1/thread': { thread: { id: 1, last_post_time: NOW / 1000 - 60, is_locked: false, is_sticky: false } },
    'forum/1/posts': PAGE0,
  };
  const env = boot(table);
  await settle(env);
  assert.deepStrictEqual(env.router.seen.filter((u) => /^forum\/1\//.test(u)), ['forum/1/thread']);
  assert.strictEqual(env.exports.state.rows[0].authorState, 'off');
});
