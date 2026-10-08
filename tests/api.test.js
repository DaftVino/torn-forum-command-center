'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { loadUserscript } = require('./load-userscript');

const KEY = 'abcdefghij123456';

// The sandbox's timers are manual, and tornApiGet deliberately puts a
// setTimeout between the rate-limiter reservation and the request: the request
// deadline is therefore only armed one microtask turn AFTER the gap timer
// fires. One advance would run past it and the deadline would never fire, so
// this alternates draining microtasks with advancing the clock. Passing 1 keeps
// fast paths fast without tripping the 15 second deadline by accident.
async function settle(env, ms) {
  const total = ms === undefined ? 1 : ms;
  for (let round = 0; round < 5; round += 1) {
    for (let i = 0; i < 20; i += 1) await Promise.resolve();
    env.advanceTimersBy(total);
  }
  for (let i = 0; i < 20; i += 1) await Promise.resolve();
}

function jsonTransport(body, status) {
  return {
    fetch: () => Promise.resolve({
      status: status === undefined ? 200 : status,
      text: () => Promise.resolve(typeof body === 'string' ? body : JSON.stringify(body)),
    }),
  };
}

test('the transport tiers are tried in the order Torn PDA needs', async () => {
  const seen = [];

  // All three present: Torn PDA's own bridge wins, because it is the only one
  // guaranteed to work inside the app webview.
  const all = loadUserscript({
    PDA_httpGet: () => { seen.push('pda'); return Promise.resolve({ status: 200, responseText: '{}' }); },
    GM_xmlhttpRequest: (cfg) => { seen.push('gm'); cfg.onload({ status: 200, responseText: '{}' }); },
    fetch: () => { seen.push('fetch'); return Promise.resolve({ status: 200, text: () => Promise.resolve('{}') }); },
  });
  let p = all.exports.httpGet('https://api.torn.com/v2/x');
  await settle(all);
  await p;
  assert.deepStrictEqual(seen, ['pda']);

  // Tampermonkey: no PDA bridge, so GM_xmlhttpRequest.
  seen.length = 0;
  const gm = loadUserscript({
    GM_xmlhttpRequest: (cfg) => { seen.push('gm'); cfg.onload({ status: 200, responseText: '{}' }); },
    fetch: () => { seen.push('fetch'); return Promise.resolve({ status: 200, text: () => Promise.resolve('{}') }); },
  });
  p = gm.exports.httpGet('https://api.torn.com/v2/x');
  await settle(gm);
  await p;
  assert.deepStrictEqual(seen, ['gm']);

  // Neither: plain fetch, last, because a cross-origin call depends on CORS
  // headers this script does not control.
  seen.length = 0;
  const f = loadUserscript({
    fetch: () => { seen.push('fetch'); return Promise.resolve({ status: 200, text: () => Promise.resolve('{}') }); },
  });
  p = f.exports.httpGet('https://api.torn.com/v2/x');
  await settle(f);
  await p;
  assert.deepStrictEqual(seen, ['fetch']);
});

test('with no transport at all the adapter reports it instead of throwing', async () => {
  const env = loadUserscript();
  const res = await env.exports.httpGet('https://api.torn.com/v2/x');
  assert.strictEqual(res.ok, false);
  assert.strictEqual(res.reason, 'network');
});

test('the adapter never rejects, whatever the transport does', async () => {
  const cases = [
    ['a transport that throws synchronously', { fetch: () => { throw new Error('boom'); } }, 'network'],
    ['a transport that rejects', { fetch: () => Promise.reject(new Error('offline')) }, 'network'],
    ['a body that cannot be read', { fetch: () => Promise.resolve({ status: 200, text: () => Promise.reject(new Error('x')) }) }, 'parse'],
    ['a non-2xx status', jsonTransport({}, 500), 'http'],
    ['a GM error callback', { GM_xmlhttpRequest: (cfg) => cfg.onerror({}) }, 'network'],
    ['a GM timeout callback', { GM_xmlhttpRequest: (cfg) => cfg.ontimeout({}) }, 'timeout'],
    ['a GM abort callback', { GM_xmlhttpRequest: (cfg) => cfg.onabort({}) }, 'network'],
    ['a PDA rejection', { PDA_httpGet: () => Promise.reject(new Error('bridge down')) }, 'network'],
  ];

  for (const [label, transport, expected] of cases) {
    const env = loadUserscript(transport);
    const p = env.exports.httpGet('https://api.torn.com/v2/x');
    await settle(env);
    const res = await p;
    assert.strictEqual(res.ok, false, label);
    assert.strictEqual(res.reason, expected, label);
  }
});

test('a request that never settles resolves as a timeout and clears its timer', async () => {
  const env = loadUserscript({ fetch: () => new Promise(() => {}) });
  const p = env.exports.httpGet('https://api.torn.com/v2/x');
  await settle(env, 0);
  const before = env.pendingTimerCount();
  assert.ok(before > 0, 'a deadline should be armed');

  // A fixed bound, not REQUEST_TIMEOUT_MS + 1. Deriving the advance from the
  // constant under test means widening the constant widens the test with it,
  // and the deadline could be removed entirely without this failing.
  // Asserted before the advance, not after: if the deadline were widened past
  // what this test advances, `await p` would hang forever and the whole suite
  // would stall instead of reporting a clear failure.
  assert.ok(env.exports.REQUEST_TIMEOUT_MS <= 30000,
    'REQUEST_TIMEOUT_MS is ' + env.exports.REQUEST_TIMEOUT_MS + ', past the bound this test advances to');
  await settle(env, 30001);
  const res = await p;
  assert.strictEqual(res.ok, false);
  assert.strictEqual(res.reason, 'timeout');
  assert.strictEqual(env.pendingTimerCount(), 0, 'the deadline must not be left running');
});

test('a late settle after a timeout is harmless', async () => {
  let resolveLate = null;
  const env = loadUserscript({
    fetch: () => new Promise((r) => { resolveLate = () => r({ status: 200, text: () => Promise.resolve('{"a":1}') }); }),
  });
  const p = env.exports.httpGet('https://api.torn.com/v2/x');
  // Asserted before the advance, not after: if the deadline were widened past
  // what this test advances, `await p` would hang forever and the whole suite
  // would stall instead of reporting a clear failure.
  assert.ok(env.exports.REQUEST_TIMEOUT_MS <= 30000,
    'REQUEST_TIMEOUT_MS is ' + env.exports.REQUEST_TIMEOUT_MS + ', past the bound this test advances to');
  await settle(env, 30001);
  const res = await p;
  assert.strictEqual(res.reason, 'timeout');

  resolveLate();
  await settle(env);
  // The already-settled promise keeps its answer; nothing throws and no second
  // result appears to redraw a panel the user has since navigated away from.
  assert.strictEqual((await p).reason, 'timeout');
});

test('Torn error codes become named, actionable messages', async () => {
  const { exports: api } = loadUserscript();
  assert.match(api.mapTornError(2, 'Incorrect key').message, /not valid/i);
  assert.match(api.mapTornError(5, 'Too many requests').message, /rate limiting/i);
  assert.match(api.mapTornError(13, 'Key temporarily disabled').message, /inactive/i);
  // The exact wording is pinned in tests/style.test.js, with the key help.
  assert.match(api.mapTornError(16, 'Access level').message, /Minimal Access/);

  // An unmapped code falls back to Torn's own words rather than inventing any.
  assert.strictEqual(api.mapTornError(999, 'Some new thing').message, 'Some new thing');
  assert.strictEqual(api.mapTornError(999, '').message, 'Torn rejected the request.');
});

test('a Torn error envelope becomes a torn failure, not a success', async () => {
  const env = loadUserscript(jsonTransport({ error: { code: 2, error: 'Incorrect key' } }));
  const p = env.exports.tornApiGet('user/forumsubscribedthreads', {}, { key: KEY });
  await settle(env);
  const res = await p;
  assert.strictEqual(res.ok, false);
  assert.strictEqual(res.reason, 'torn');
  assert.strictEqual(res.code, 2);
});

test('a body that is not JSON is a parse failure', async () => {
  const env = loadUserscript(jsonTransport('<html>maintenance</html>'));
  const p = env.exports.tornApiGet('forum/categories', {}, { key: KEY });
  await settle(env);
  const res = await p;
  assert.strictEqual(res.ok, false);
  assert.strictEqual(res.reason, 'parse');
});

test('a valid response comes back as data', async () => {
  const env = loadUserscript(jsonTransport({ categories: [{ id: 61, title: 'Tutorials', acronym: 'TG' }] }));
  const p = env.exports.tornApiGet('forum/categories', {}, { key: KEY });
  await settle(env);
  const res = await p;
  assert.strictEqual(res.ok, true);
  assert.strictEqual(res.data.categories[0].id, 61);
});

test('no key means no request is made at all', async () => {
  const env = loadUserscript(jsonTransport({}));
  const res = await env.exports.tornApiGet('user/forumfeed', {}, { key: '' });
  assert.strictEqual(res.ok, false);
  assert.strictEqual(res.reason, 'nokey');
  assert.strictEqual(env.calls.fetch.length, 0, 'nothing may be sent without a key');
});

test('the key reaches api.torn.com and nowhere else', async () => {
  const env = loadUserscript(jsonTransport({}));
  const p = env.exports.tornApiGet('user/forumfeed', {}, { key: KEY });
  await settle(env);
  await p;
  assert.strictEqual(env.calls.fetch.length, 1);
  const url = env.calls.fetch[0].url;
  assert.ok(url.indexOf('https://api.torn.com/v2/') === 0, url);
  assert.ok(url.indexOf('key=' + KEY) !== -1, 'the key is sent as Torn expects');
});

test('the key never appears in any failure detail', async () => {
  // The key rides in the query string, so a URL echoed into an error message is
  // the leak. Every failure path is checked, not a representative one.
  const transports = [
    ['http', jsonTransport({}, 503)],
    ['parse', jsonTransport('not json')],
    ['torn', jsonTransport({ error: { code: 2, error: 'bad' } })],
    ['network', { fetch: () => Promise.reject(new Error('failed for https://api.torn.com/v2/x?key=' + KEY)) }],
  ];

  for (const [label, transport] of transports) {
    const env = loadUserscript(transport);
    const p = env.exports.tornApiGet('user/forumfeed', {}, { key: KEY });
    await settle(env);
    const res = await p;
    const blob = JSON.stringify(res);
    assert.strictEqual(blob.indexOf(KEY), -1, label + ' leaked the key: ' + blob);
  }
});

test('redactUrl removes the whole query string, not just the key parameter', () => {
  const { exports: api } = loadUserscript();
  assert.strictEqual(
    api.redactUrl('https://api.torn.com/v2/user/forumfeed?key=' + KEY + '&comment=x'),
    'https://api.torn.com/v2/user/forumfeed?[redacted]',
  );
  // A future parameter nobody remembered to add to a denylist is covered too.
  assert.strictEqual(api.redactUrl('https://api.torn.com/v2/x?token=secret'), 'https://api.torn.com/v2/x?[redacted]');
  assert.strictEqual(api.redactUrl('https://api.torn.com/v2/x'), 'https://api.torn.com/v2/x');
  assert.strictEqual(api.redactUrl(null), '');
});

test('buildApiUrl drops empty parameters and encodes the rest', () => {
  const { exports: api } = loadUserscript();
  const url = api.buildApiUrl('https://api.torn.com/v2', 'forum/1/posts', {
    offset: 20, empty: '', missing: null, undef: undefined, comment: 'a b',
  });
  assert.strictEqual(url, 'https://api.torn.com/v2/forum/1/posts?offset=20&comment=a%20b');
});

test('a duplicate request in flight is dropped rather than doubled', async () => {
  const env = loadUserscript({ fetch: () => new Promise(() => {}) });
  const first = env.exports.tornApiGet('user/forumfeed', {}, { key: KEY });
  const second = await env.exports.tornApiGet('user/forumfeed', {}, { key: KEY });
  assert.strictEqual(second.ok, false);
  assert.strictEqual(second.reason, 'inflight');
  // Asserted before the advance, not after: if the deadline were widened past
  // what this test advances, `await p` would hang forever and the whole suite
  // would stall instead of reporting a clear failure.
  assert.ok(env.exports.REQUEST_TIMEOUT_MS <= 30000,
    'REQUEST_TIMEOUT_MS is ' + env.exports.REQUEST_TIMEOUT_MS + ', past the bound this test advances to');
  await settle(env, 30001);
  await first;
});

test('the request deadline is a real bound, not an arbitrarily large number', () => {
  const { exports: api } = loadUserscript();
  assert.ok(api.REQUEST_TIMEOUT_MS > 1000, 'too tight to survive a slow mobile connection');
  assert.ok(api.REQUEST_TIMEOUT_MS <= 30000,
    'a deadline the user outlives is not a deadline: ' + api.REQUEST_TIMEOUT_MS);
});

test('a My posts failure never carries the key, in the result, the error or the cache', async () => {
  const transports = [
    ['http', jsonTransport({}, 503)],
    ['parse', jsonTransport('not json')],
    ['shape', jsonTransport({ surprise: [] })],
    ['torn', jsonTransport({ error: { code: 17, error: 'bad' } })],
    ['network', { fetch: () => Promise.reject(new Error('failed for https://api.torn.com/v2/user/forumthreads?key=' + KEY)) }],
  ];
  for (const [label, transport] of transports) {
    const env = loadUserscript(Object.assign({ gmStore: [['tfcc:key', KEY]] }, transport));
    const p = env.exports.refreshMine(1700000000000);
    await settle(env, 1000);
    const res = await p;
    const blob = JSON.stringify([res, env.exports.state.mineError, env.exports.state.mine]);
    assert.strictEqual(blob.indexOf(KEY), -1, label + ' leaked the key: ' + blob);
    assert.notStrictEqual(env.exports.state.mineError, null, label + ' must be reported, not swallowed');
  }
});
