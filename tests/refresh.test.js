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
function router(table) {
  const seen = [];
  return {
    seen,
    fetch(url) {
      seen.push(url.replace('https://api.torn.com/v2/', '').split('?')[0]);
      const path = url.replace('https://api.torn.com/v2/', '').split('?')[0];
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
