'use strict';

const test = require('node:test');
const assert = require('node:assert');
const {
  loadUserscript, FORUMS_LOCATION, subscribedThreadsPayload, forumFeedPayload,
  forumThreadsPayload, forumPostsPayload, forumThreadPayload, FIXTURE_SELF_ID,
} = require('./load-userscript');

const KEY = 'abcdefghij123456';
const NOW = 1700000000000;

async function settle(env, ms) {
  const step = ms === undefined ? 1000 : ms;
  for (let round = 0; round < 40; round += 1) {
    for (let i = 0; i < 15; i += 1) await Promise.resolve();
    env.advanceTimersBy(step);
  }
  for (let i = 0; i < 20; i += 1) await Promise.resolve();
}

function router(table) {
  const seen = [];
  const urls = [];
  return {
    seen,
    urls,
    fetch(url) {
      urls.push(url);
      const path = url.replace('https://api.torn.com/v2/', '').split('?')[0];
      seen.push(path);
      const body = Object.prototype.hasOwnProperty.call(table, path) ? table[path] : { error: { code: 6, error: 'Unknown' } };
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

const BASE = {
  'user/forumsubscribedthreads': subscribedThreadsPayload([{ id: 1 }]),
  'user/forumfeed': forumFeedPayload([]),
  'forum/categories': { categories: [{ id: 61, title: 'Tutorials', acronym: 'TG' }] },
};

function mineTable(extra) {
  const t = Object.assign({}, BASE, {
    'user/forumthreads': forumThreadsPayload([{ id: 10, replies: 3 }]),
    // Newest own post first, as Torn sends it; lookups follow that order.
    'user/forumposts': forumPostsPayload([{ id: 1, threadId: 20, at: 1600000200 }, { id: 2, threadId: 21, at: 1600000100 }]),
    'forum/20/thread': forumThreadPayload({ id: 20, title: 'Twenty', replies: 29, lastAt: 1600000300, lastPoster: { id: 99 } }),
    'forum/21/thread': forumThreadPayload({ id: 21, title: 'TwentyOne', replies: 7, lastAt: 1600000400, lastPoster: { id: FIXTURE_SELF_ID } }),
  });
  return Object.assign(t, extra || {});
}

async function bootAndClear(table, options) {
  const env = boot(table, options);
  await settle(env);
  env.router.seen.length = 0;   // drop init's Threads refresh
  return env;
}

function mineCalls(env) {
  return env.router.seen.filter((u) => /^user\/forum(threads|posts)$|^forum\/\d+\/thread$|^forum\/categories$/.test(u));
}

test('a My posts fetch is two lists then lookups, and never the category list', async () => {
  const env = await bootAndClear(mineTable());
  env.exports.refreshMine(NOW);
  await settle(env);
  assert.deepStrictEqual(mineCalls(env), ['user/forumthreads', 'user/forumposts', 'forum/20/thread', 'forum/21/thread']);
  const mine = env.exports.state.mine;
  assert.strictEqual(mine.fetchedAt, NOW);
  assert.strictEqual(mine.threads.length, 3);
  assert.strictEqual(env.exports.state.mineError, null);
});

// Torn may ignore `limit` here, as it does on forum/{id}/posts (live finding
// 7). This pins what the script asks for, not what Torn returns; nothing
// downstream depends on the page size.
test('both lists ask for one page of the agreed size', async () => {
  const env = await bootAndClear(mineTable());
  env.router.urls.length = 0;
  env.exports.refreshMine(NOW);
  await settle(env);
  const lists = env.router.urls.filter((u) => /user\/forum(threads|posts)\?/.test(u));
  assert.strictEqual(lists.length, 2);
  for (const u of lists) assert.match(u, /[?&]limit=100(&|$)/);
});

test('with the default budget a fetch is at most 12 requests', async () => {
  const posts = [];
  for (let i = 0; i < 30; i += 1) posts.push({ id: i + 1, threadId: 100 + i });
  const table = mineTable({ 'user/forumposts': forumPostsPayload(posts) });
  for (let i = 0; i < 30; i += 1) table['forum/' + (100 + i) + '/thread'] = forumThreadPayload({ id: 100 + i, replies: 2 });
  const env = await bootAndClear(table);
  env.exports.refreshMine(NOW);
  await settle(env);
  assert.strictEqual(mineCalls(env).length, 12);
});

test('a budget of zero makes exactly two requests and leaves posted-in threads unchecked', async () => {
  const env = await bootAndClear(mineTable());
  env.exports.state.settings.enrichBudget = 0;
  env.exports.refreshMine(NOW);
  await settle(env);
  assert.deepStrictEqual(mineCalls(env), ['user/forumthreads', 'user/forumposts']);
  const r20 = env.exports.state.rows.find((r) => r.id === '20');
  assert.strictEqual(r20.unreadSource, 'unchecked');
});

test('opened right after a maximal Threads refresh, the rolling minute never holds more than 40 requests', async () => {
  // Worst case at the largest setting: a Threads refresh is 1 + 1 + 1 + 25 = 28,
  // a My posts fetch is 2 + 25 = 27, and 28 + 27 = 55 > 40. The limiter, not the
  // arithmetic, must hold the line. Counted by the transport, not by the code
  // under test. The clock is the harness's fixed NOW, so everything is one
  // rolling minute.
  const subs = [];
  const table = mineTable();
  for (let i = 0; i < 30; i += 1) subs.push({ id: 500 + i, unread: 2 });
  table['user/forumsubscribedthreads'] = subscribedThreadsPayload(subs);
  const posts = [];
  for (let i = 0; i < 40; i += 1) {
    posts.push({ id: 900 + i, threadId: 700 + i });
    table['forum/' + (700 + i) + '/thread'] = forumThreadPayload({ id: 700 + i, replies: 4, lastAt: 1600000300, lastPoster: { id: 99 } });
  }
  for (let i = 0; i < 30; i += 1) table['forum/' + (500 + i) + '/thread'] = forumThreadPayload({ id: 500 + i, replies: 8, lastAt: 1600000300 });
  table['user/forumposts'] = forumPostsPayload(posts);
  const env = boot(table);
  env.exports.state.settings.enrichBudget = env.exports.MAX_ENRICH_BUDGET;
  await settle(env);                              // init's Threads refresh
  env.router.seen.length = 0;
  env.exports.state.feed.categoriesAt = 0;        // force the category request: the real worst case
  env.exports.refreshAll(NOW, {});
  await settle(env);
  const threadsCount = env.router.seen.length;
  env.exports.refreshMine(NOW);
  await settle(env);
  assert.ok(threadsCount <= 28, 'a Threads refresh at the maximum is 28, got ' + threadsCount);
  assert.ok(env.router.seen.length <= env.exports.REQUESTS_PER_WINDOW,
    'more than 40 requests in one minute: ' + env.router.seen.length);
  assert.strictEqual(env.router.seen.slice(threadsCount, threadsCount + 2).join(), 'user/forumthreads,user/forumposts');
  assert.ok(env.exports.state.rows.some((r) => r.unreadSource === 'unchecked'), 'cut-off rows must say not checked yet');
});

test('a thread looked up within the TTL is not looked up again', async () => {
  const env = await bootAndClear(mineTable());
  env.exports.refreshMine(NOW);
  await settle(env);
  env.router.seen.length = 0;
  env.exports.refreshMine(NOW + 60000);
  await settle(env);
  assert.deepStrictEqual(mineCalls(env), ['user/forumthreads', 'user/forumposts']);
});

test('a second fetch while one runs is dropped', async () => {
  const env = await bootAndClear(mineTable());
  env.exports.refreshMine(NOW);
  const second = await env.exports.refreshMine(NOW);
  assert.strictEqual(second.reason, 'inflight');
  await settle(env);
  assert.strictEqual(mineCalls(env).filter((u) => u === 'user/forumthreads').length, 1);
});

test('a failed thread list is a named error and keeps the saved list', async () => {
  const good = await bootAndClear(mineTable());
  good.exports.refreshMine(NOW);
  await settle(good);
  const saved = JSON.stringify(good.exports.state.mine);
  const before = good.exports.state.mine.threads.length;

  const bad = await bootAndClear(
    mineTable({ 'user/forumthreads': { error: { code: 17, error: 'Backend error' } } }),
    { gmStore: [['tfcc:key', KEY], ['tfcc:mine', saved]] },
  );
  const p = bad.exports.refreshMine(NOW + 20 * 60000);
  await settle(bad);
  const res = await p;
  assert.strictEqual(res.ok, false);
  assert.ok(bad.exports.state.mineError && bad.exports.state.mineError.detail);
  assert.strictEqual(bad.exports.state.mine.threads.length, before, 'the saved list survives');
  assert.deepStrictEqual(mineCalls(bad), ['user/forumthreads'], 'nothing after a failed first list');
});

test('a failed post list keeps the started threads, warns, and does not reset the TTL', async () => {
  const env = await bootAndClear(mineTable({ 'user/forumposts': { error: { code: 17, error: 'Backend error' } } }));
  const p = env.exports.refreshMine(NOW);
  await settle(env);
  const res = await p;
  assert.strictEqual(res.ok, false);
  assert.ok(env.exports.state.mine.threads.some((t) => t.id === 10));
  assert.strictEqual(env.exports.state.mine.fetchedAt, 0);
  assert.match(env.exports.state.mineError.detail, /posted in/);
});

test('an unrecognised response shape is a named parse error, not an empty list', async () => {
  const env = await bootAndClear(mineTable({ 'user/forumthreads': { surprise: [] } }));
  const p = env.exports.refreshMine(NOW);
  await settle(env);
  const res = await p;
  assert.strictEqual(res.reason, 'parse');
  assert.match(env.exports.state.mineError.detail, /shape/);
});

test('no key means no My posts request', async () => {
  const env = await bootAndClear(mineTable(), { gmStore: [] });
  env.exports.refreshMine(NOW);
  await settle(env);
  assert.deepStrictEqual(mineCalls(env), []);
});

test('the TTL decides whether opening the view fetches', () => {
  const { exports: api } = loadUserscript();
  const s = api.freshMine();
  assert.strictEqual(api.mineIsDue(s, NOW, api.MINE_TTL_MS), true, 'never fetched is due');
  s.fetchedAt = NOW;
  assert.strictEqual(api.mineIsDue(s, NOW + 14 * 60000, api.MINE_TTL_MS), false);
  assert.strictEqual(api.mineIsDue(s, NOW + 15 * 60000, api.MINE_TTL_MS), true);
  assert.strictEqual(api.MINE_TTL_MS, 15 * 60 * 1000, 'the Settings text promises 15 minutes');
});
