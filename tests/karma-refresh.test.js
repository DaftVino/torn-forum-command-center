'use strict';

const test = require('node:test');
const assert = require('node:assert');
const {
  loadUserscript, FORUMS_LOCATION, subscribedThreadsPayload, forumFeedPayload,
  forumThreadsPayload, forumPostsPayload, profilePayload,
} = require('./load-userscript');

const KEY = 'abcdefghij123456';
const NOW = 1700000000000;
const HOUR = 60 * 60 * 1000;

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

async function boot(tbl, options) {
  const r = router(tbl);
  const env = loadUserscript(Object.assign({
    location: FORUMS_LOCATION, now: NOW, gmStore: [['tfcc:key', KEY]], fetch: r.fetch,
  }, options || {}));
  env.router = r;
  await settle(env);
  r.seen.length = 0;   // drop init's Threads refresh
  r.urls.length = 0;
  return env;
}

function limiterAllowing(n) {
  let calls = 0;
  return {
    get calls() { return calls; },
    reserve() { calls += 1; return calls <= n ? { ok: true, waitMs: 0 } : { ok: false, retryAfterMs: 30000 }; },
  };
}

const profileCalls = (env) => env.router.seen.filter((p) => p === 'user/profile');

function tbl(threads, posts, extra) {
  return Object.assign({
    'user/forumsubscribedthreads': subscribedThreadsPayload([{ id: 1 }]),
    'user/forumfeed': forumFeedPayload([]),
    'forum/categories': { categories: [{ id: 61, title: 'Tutorials', acronym: 'TG' }] },
    'user/forumthreads': forumThreadsPayload(threads),
    'user/forumposts': forumPostsPayload(posts),
    'user/profile': profilePayload(1208),
  }, extra || {});
}

test('the fallback fires once when you have no threads and no posts: 3 requests', async () => {
  const env = await boot(tbl([], []));
  env.exports.refreshMine(NOW);
  await settle(env);
  assert.deepStrictEqual(env.router.seen.slice().sort(), ['user/forumposts', 'user/forumthreads', 'user/profile']);
  assert.strictEqual(env.exports.state.mine.karma, 1208);
  assert.strictEqual(env.exports.state.mine.karmaAt, NOW);
});

test('the fallback figure is cached for 12 hours, then read again', async () => {
  const env = await boot(tbl([], []));
  env.exports.refreshMine(NOW);
  await settle(env);
  env.router.seen.length = 0;
  env.exports.refreshMine(NOW + 11 * HOUR);
  await settle(env);
  assert.strictEqual(profileCalls(env).length, 0);
  assert.strictEqual(env.exports.state.mine.karma, 1208, 'the cached figure survives the run');
  env.exports.refreshMine(NOW + 12 * HOUR);
  await settle(env);
  assert.strictEqual(profileCalls(env).length, 1);
});

test('the fallback never fires when a thread or a post exists; karma comes free from the row', async () => {
  const withThread = await boot(tbl([{ id: 100, total: 3, rating: 1, lastAt: 1600000000, karma: 77 }], []));
  withThread.exports.refreshMine(NOW);
  await settle(withThread);
  assert.strictEqual(profileCalls(withThread).length, 0);
  assert.strictEqual(withThread.exports.state.mine.karma, 77);
  const withPost = await boot(tbl([], [{ id: 1, threadId: 20, karma: 55 }]));
  withPost.exports.refreshMine(NOW);
  await settle(withPost);
  assert.strictEqual(profileCalls(withPost).length, 0);
  assert.strictEqual(withPost.exports.state.mine.karma, 55);
});

test('a row without karma leaves it unknown and still makes no profile request', async () => {
  const env = await boot(tbl([{ id: 100, total: 3, rating: 1, lastAt: 1600000000, noKarma: true }], []));
  env.exports.refreshMine(NOW);
  await settle(env);
  assert.strictEqual(profileCalls(env).length, 0);
  assert.ok(!('karma' in env.exports.state.mine), 'unknown, never 0');
});

test('the fallback never runs in the default refresh, auto refresh or page load', async () => {
  const env = await boot(tbl([], []));
  env.exports.refreshAll(NOW + 13 * HOUR);
  await settle(env);
  assert.strictEqual(profileCalls(env).length, 0);
  // Page load: boot() dropped init's requests; rebuild and look at them.
  const r = router(tbl([], []));
  const loaded = loadUserscript({ location: FORUMS_LOCATION, now: NOW, gmStore: [['tfcc:key', KEY]], fetch: r.fetch });
  await settle(loaded);
  assert.ok(!r.seen.includes('user/profile'), 'init made a profile request: ' + r.seen.join(','));
  assert.ok(r.seen.length <= 13, 'the default refresh stays at 13 or fewer');
});

test('a failed list means emptiness is unknown: no fallback', async () => {
  const t = tbl([], []);
  delete t['user/forumposts'];                    // the router answers an error
  const env = await boot(t);
  env.exports.refreshMine(NOW);
  await settle(env);
  assert.strictEqual(profileCalls(env).length, 0);
});

test('a throttled profile read leaves karma unknown and the run intact', async () => {
  const env = await boot(tbl([], []));
  const lim = limiterAllowing(2);   // the two lists only
  env.exports.refreshMine(NOW, { limiter: lim });
  await settle(env);
  assert.strictEqual(lim.calls, 3, 'the profile read asked for a slot and was refused');
  assert.strictEqual(profileCalls(env).length, 0);
  assert.ok(!('karma' in env.exports.state.mine));
  assert.strictEqual(env.exports.state.mine.fetchedAt, NOW, 'the lists still landed');
});

test('the profile answer is read for karma only', async () => {
  const env = await boot(tbl([], [], { 'user/profile': { profile: { karma: 9, name: 'SECRETNAME', level: 77 } } }));
  env.exports.refreshMine(NOW);
  await settle(env);
  assert.strictEqual(env.exports.state.mine.karma, 9);
  assert.strictEqual(JSON.stringify(env.exports.state.mine).indexOf('SECRETNAME'), -1);
});
