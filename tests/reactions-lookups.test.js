'use strict';

const test = require('node:test');
const assert = require('node:assert');
const {
  loadUserscript, FORUMS_LOCATION, subscribedThreadsPayload, forumFeedPayload,
  forumThreadsPayload, forumPostsPayload, fixturePosts,
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

// n started threads (ids 100..), one posted-in thread (20), each with a real
// topic page (#14's forum-thread-posts-asc: topic post 7 up, 0 down) re-pointed
// at the thread. The body is a sentinel, to prove no post body is stored.
function table(n) {
  const threads = Array.from({ length: n }, (_, i) => ({ id: 100 + i, total: 3, rating: 1, lastAt: 1600000000 + i }));
  const t = {
    'user/forumsubscribedthreads': subscribedThreadsPayload([{ id: 1 }]),
    'user/forumfeed': forumFeedPayload([]),
    'forum/categories': { categories: [{ id: 61, title: 'Tutorials', acronym: 'TG' }] },
    'user/forumthreads': forumThreadsPayload(threads),
    'user/forumposts': forumPostsPayload([{ id: 1, threadId: 20 }]),
    'forum/20/thread': { thread: { id: 20, forum_id: 61, title: 'Twenty', posts: 30, last_post_time: 1600000300 } },
    'forum/20/posts': fixturePosts('forum-thread-posts-asc', 20, 'SECRET TOPIC BODY'),
  };
  threads.forEach((th) => {
    t['forum/' + th.id + '/posts'] = fixturePosts('forum-thread-posts-asc', th.id, 'SECRET TOPIC BODY');
  });
  return t;
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

const topicCalls = (env) => env.router.urls.filter((u) => /\/v2\/forum\/\d+\/posts\?/.test(u));

test('a My posts run reads at most 5 opening posts, newest activity first, only for threads you started', async () => {
  const env = await boot(table(8));
  env.exports.refreshMine(NOW);
  await settle(env);
  const calls = topicCalls(env);
  assert.strictEqual(calls.length, 5);
  for (const u of calls) {
    assert.doesNotMatch(u, /[?&]sort=/, 'Torn ignores sort; the request must not suggest otherwise');
    assert.match(u, /[?&]offset=0(&|$)/);
  }
  assert.ok(!calls.some((u) => /\/forum\/20\/posts/.test(u)), 'a thread you only posted in is never checked');
  // Threads 100..107 have rising last-post times, so the newest five go first.
  assert.deepStrictEqual(calls.map((u) => Number(/\/forum\/(\d+)\/posts/.exec(u)[1])), [107, 106, 105, 104, 103]);
  assert.ok(env.router.seen.length <= 2 + 10 + 5, 'at most 17 requests at defaults, got ' + env.router.seen.length);
  const read = env.exports.state.mine.threads.filter((t) => typeof t.up === 'number');
  assert.strictEqual(read.length, 5);
  assert.ok(read.every((t) => t.up === 7 && t.down === 0), 'the fixture topic post: 7 up, 0 down');
  assert.strictEqual(JSON.stringify(env.exports.state.mine).indexOf('SECRET'), -1, 'no post body stored');
});

test('topic lookups come after the activity lookups', async () => {
  const env = await boot(table(2));
  env.exports.refreshMine(NOW);
  await settle(env);
  const seen = env.router.seen;
  assert.deepStrictEqual(seen.slice(0, 3), ['user/forumthreads', 'user/forumposts', 'forum/20/thread']);
  assert.deepStrictEqual(seen.slice(3).sort(), ['forum/100/posts', 'forum/101/posts']);
});

test('later runs check only what is left, then nothing until the TTL passes', async () => {
  const env = await boot(table(8));
  env.exports.refreshMine(NOW);
  await settle(env);
  env.router.urls.length = 0;
  env.exports.refreshMine(NOW + HOUR);
  await settle(env);
  assert.strictEqual(topicCalls(env).length, 3);
  env.router.urls.length = 0;
  env.exports.refreshMine(NOW + 2 * HOUR);
  await settle(env);
  assert.strictEqual(topicCalls(env).length, 0, 'within 12 hours of a check');
  env.router.urls.length = 0;
  env.exports.refreshMine(NOW + env.exports.TOPIC_TTL_MS + 2 * HOUR);
  await settle(env);
  assert.strictEqual(topicCalls(env).length, 5);
});

test('with lookups set to 0, My posts makes exactly two requests', async () => {
  const env = await boot(table(3));
  env.exports.state.settings.enrichBudget = 0;
  env.exports.refreshMine(NOW);
  await settle(env);
  assert.strictEqual(topicCalls(env).length, 0);
  assert.strictEqual(env.router.seen.length, 2);
});

function limiterAllowing(n) {
  let calls = 0;
  return {
    get calls() { return calls; },
    reserve() { calls += 1; return calls <= n ? { ok: true, waitMs: 0 } : { ok: false, retryAfterMs: 30000 }; },
  };
}

test('topic lookups do not start after My posts was throttled', async () => {
  const env = await boot(table(3));
  const lim = limiterAllowing(2);   // the two lists; #2's lookup of thread 20 is refused
  env.exports.refreshMine(NOW, { limiter: lim });
  await settle(env);
  assert.strictEqual(topicCalls(env).length, 0);
  assert.strictEqual(lim.calls, 3, 'nothing asked for a slot after the refusal');
});

test('topic lookups stop at their own first throttle', async () => {
  const env = await boot(table(3));
  const lim = limiterAllowing(4);   // two lists, thread 20, one topic page
  env.exports.refreshMine(NOW, { limiter: lim });
  await settle(env);
  assert.strictEqual(topicCalls(env).length, 1);
  assert.strictEqual(lim.calls, 5);
});

test('a page with no topic post stamps the check and keeps the net figure', async () => {
  const tbl = table(1);
  tbl['forum/100/posts'].posts = tbl['forum/100/posts'].posts.filter((p) => p.is_topic !== true);
  const env = await boot(tbl);
  env.exports.refreshMine(NOW);
  await settle(env);
  const t = env.exports.state.mine.threads.find((x) => x.id === 100);
  assert.strictEqual(t.topicAt, NOW);
  assert.strictEqual('up' in t, false, 'not found is never 0 up');
  assert.strictEqual(t.rating, 1);
});

test('an unrecognised topic answer stamps nothing, so it is retried next run', async () => {
  const tbl = table(1);
  tbl['forum/100/posts'] = { nothing: true };
  const env = await boot(tbl);
  env.exports.refreshMine(NOW);
  await settle(env);
  const t = env.exports.state.mine.threads.find((x) => x.id === 100);
  assert.strictEqual('topicAt' in t, false);
});

test('a Threads refresh never reads an opening post', async () => {
  const env = await boot(table(3));
  env.exports.refreshMine(NOW);
  await settle(env);
  env.router.urls.length = 0;
  env.exports.refreshAll(NOW + 13 * HOUR);
  await settle(env);
  assert.strictEqual(topicCalls(env).length, 0);
});

test('a late topic answer after Reset everything is dropped', async () => {
  const tbl = table(1);
  const r = router(tbl);
  const held = [];
  const fetch = (url) => (/\/forum\/\d+\/posts\?/.test(url)
    ? new Promise((resolve) => held.push(() => resolve(r.fetch(url))))
    : r.fetch(url));
  const env = loadUserscript({ location: FORUMS_LOCATION, now: NOW, gmStore: [['tfcc:key', KEY]], fetch });
  await settle(env);
  env.exports.refreshMine(NOW);
  await settle(env);
  assert.strictEqual(held.length, 1, 'held on the topic page');
  env.exports.makeHandlers(env.doc, env.win).onAction('reset-all', { getAttribute: () => null });
  held.splice(0).forEach((f) => f());
  await settle(env);
  assert.strictEqual(env.exports.state.mine.threads.length, 0);
});
