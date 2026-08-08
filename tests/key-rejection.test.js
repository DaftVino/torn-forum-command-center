'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { loadUserscript, FORUMS_LOCATION, subscribedThreadsPayload } = require('./load-userscript');

const KEY = 'abcdefghij123456';
const NOW = 1700000000000;

async function settle(env, ms) {
  const step = ms === undefined ? 1000 : ms;
  for (let round = 0; round < 30; round += 1) {
    for (let i = 0; i < 15; i += 1) await Promise.resolve();
    env.advanceTimersBy(step);
  }
  for (let i = 0; i < 20; i += 1) await Promise.resolve();
}

function forums(extra) {
  return Object.assign({}, FORUMS_LOCATION, extra || {});
}

// Start it, then settle, then await. Awaiting refreshAll first would block the
// only thing that advances the sandbox clock, and the request chain could never
// finish.
async function refresh(env, at) {
  const p = env.exports.refreshAll(at);
  await settle(env);
  return p;
}

function erroring(code, message) {
  let calls = 0;
  return {
    calls: () => calls,
    fetch() {
      calls += 1;
      return Promise.resolve({
        status: 200,
        text: () => Promise.resolve(JSON.stringify({ error: { code: code, error: message || 'nope' } })),
      });
    },
  };
}

// Torn's acceptable usage terms: "Multiple requests using invalid keys may
// result in a temporary IP ban - you must account for this by removing disabled
// or invalid keys upon error." A script that keeps a rejected key and retries it
// on every page load and every auto refresh is exactly what that forbids.
const REJECTING_CODES = [
  [2, 'Incorrect key'],
  [13, 'Key temporarily disabled'],
  [16, 'Access level of this key is not high enough'],
  [18, 'Key is paused'],
];

for (const [code, message] of REJECTING_CODES) {
  test(`Torn error ${code} stops the key being used again`, async () => {
    const t = erroring(code, message);
    const env = loadUserscript({
      location: forums(), now: NOW, gmStore: [['tfcc:key', KEY]], fetch: t.fetch,
    });
    await settle(env);

    const afterFirst = t.calls();
    assert.ok(afterFirst >= 1, 'the first request has to happen to learn the key is bad');

    // Everything that would otherwise fire another request must now decline.
    await refresh(env, NOW + 60000);
    await refresh(env, NOW + 120000);

    assert.strictEqual(t.calls(), afterFirst,
      'the script kept using a key Torn had already rejected');
  });
}

test('a rejected key survives a reload, so a fresh page does not retry it', async () => {
  const t = erroring(2, 'Incorrect key');
  const env = loadUserscript({
    location: forums(), now: NOW, gmStore: [['tfcc:key', KEY]], fetch: t.fetch,
  });
  await settle(env);
  const afterFirst = t.calls();

  // A userscript reloads on every navigation. If the rejection lived only in
  // memory, every page view would spend another request on a dead key - which
  // is the pattern the IP ban exists for.
  const second = loadUserscript({
    location: forums(), now: NOW + 1000,
    gmStore: [...env.gmStore.entries()],
    fetch: t.fetch,
  });
  await settle(second);
  assert.strictEqual(t.calls(), afterFirst, 'a reload retried the rejected key');
});

test('the panel says what is wrong and what to do about it', async () => {
  const t = erroring(2, 'Incorrect key');
  const env = loadUserscript({
    location: forums(), now: NOW, gmStore: [['tfcc:key', KEY]], fetch: t.fetch,
  });
  await settle(env);

  const html = env.doc.getElementById('tfcc-panel').innerHTML;
  assert.match(html, /not valid/i, 'the reason has to be visible');
  assert.match(html, /Settings/, 'and the way to fix it');
});

test('saving a new key clears the rejection and lets requests resume', async () => {
  const t = erroring(2, 'Incorrect key');
  const env = loadUserscript({
    location: forums(), now: NOW, gmStore: [['tfcc:key', KEY]], fetch: t.fetch,
  });
  await settle(env);
  const afterFirst = t.calls();

  env.doc.querySelector = (sel) => (sel === '[data-act="key-input"]'
    ? { value: 'zzzzzzzzzz999999' } : null);
  const handlers = env.exports.makeHandlers(env.doc, env.win);
  handlers.onAction('key-save', { getAttribute: () => null });
  await settle(env);

  assert.ok(t.calls() > afterFirst, 'a new key must be given a chance');
});

test('a temporary Torn error does not discard the key', async () => {
  // Code 10 is the owner being in federal jail and code 11 is a key changed too
  // recently. Both pass. Treating them as a dead key would make the user
  // re-enter a key that was never wrong.
  for (const code of [10, 11, 5, 9, 17]) {
    const t = erroring(code, 'temporary');
    const env = loadUserscript({
      location: forums(), now: NOW, gmStore: [['tfcc:key', KEY]], fetch: t.fetch,
    });
    await settle(env);
    const afterFirst = t.calls();

    await refresh(env, NOW + 60000);
    assert.ok(t.calls() > afterFirst, 'code ' + code + ' should still be retried');
  }
});

test('a working key is never marked rejected', async () => {
  const env = loadUserscript({
    location: forums(), now: NOW, gmStore: [['tfcc:key', KEY]],
    fetch: () => Promise.resolve({
      status: 200,
      text: () => Promise.resolve(JSON.stringify(subscribedThreadsPayload([{ id: 1 }]))),
    }),
  });
  await settle(env);
  assert.strictEqual(env.exports.state.settings.keyRejected, 0);
});

test('a network failure is not mistaken for a bad key', async () => {
  // Being offline is not Torn rejecting anything. Discarding the key here would
  // make a train tunnel look like a revoked key.
  let calls = 0;
  const env = loadUserscript({
    location: forums(), now: NOW, gmStore: [['tfcc:key', KEY]],
    fetch: () => { calls += 1; return Promise.reject(new Error('offline')); },
  });
  await settle(env);
  const afterFirst = calls;

  await refresh(env, NOW + 60000);
  assert.ok(calls > afterFirst, 'the script must retry after a network failure');
  assert.strictEqual(env.exports.state.settings.keyRejected, 0);
});

test('the rejection blocks every request path, not just refresh', async () => {
  const t = erroring(2, 'Incorrect key');
  const env = loadUserscript({
    location: forums(), now: NOW, gmStore: [['tfcc:key', KEY]], fetch: t.fetch,
  });
  await settle(env);
  const afterFirst = t.calls();

  const deepP = env.exports.runDeepSearch([1], 'anything', NOW);
  const enrichP = env.exports.enrichThreads([1], NOW);
  await settle(env);
  const deep = await deepP;
  const enrich = await enrichP;

  assert.strictEqual(t.calls(), afterFirst, 'deep search or enrichment used the dead key');
  void deep; void enrich;
});
