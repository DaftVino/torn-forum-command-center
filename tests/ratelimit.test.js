'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { loadUserscript } = require('./load-userscript');

const { exports: api } = loadUserscript();

test('the minimum gap is enforced by making the caller wait, not by dropping', () => {
  // Enrichment fires several requests from one user action. Dropping them would
  // silently lose work; spacing them is what the limit actually asks for.
  const l = api.makeRateLimiter({ minGapMs: 650, perWindow: 40, windowMs: 60000 });

  assert.deepStrictEqual(l.reserve(0), { ok: true, waitMs: 0, at: 0 });
  assert.deepStrictEqual(l.reserve(0), { ok: true, waitMs: 650, at: 650 });
  assert.deepStrictEqual(l.reserve(0), { ok: true, waitMs: 1300, at: 1300 });
});

test('a caller that arrives after the gap has passed does not wait', () => {
  const l = api.makeRateLimiter({ minGapMs: 650, perWindow: 40, windowMs: 60000 });
  l.reserve(0);
  assert.strictEqual(l.reserve(5000).waitMs, 0);
});

test('two concurrent callers serialise instead of both deciding they may go', () => {
  // reserve() books the slot as it hands it out. If it only reported, both
  // callers would read the same "free now" and fire together.
  const l = api.makeRateLimiter({ minGapMs: 1000, perWindow: 40, windowMs: 60000 });
  const a = l.reserve(100);
  const b = l.reserve(100);
  assert.notStrictEqual(a.at, b.at);
  assert.strictEqual(b.at - a.at, 1000);
});

test('the window ceiling refuses rather than queueing without bound', () => {
  const l = api.makeRateLimiter({ minGapMs: 0, perWindow: 3, windowMs: 60000 });
  assert.strictEqual(l.reserve(0).ok, true);
  assert.strictEqual(l.reserve(0).ok, true);
  assert.strictEqual(l.reserve(0).ok, true);

  const denied = l.reserve(0);
  assert.strictEqual(denied.ok, false);
  assert.strictEqual(denied.reason, 'throttled');
  // Waiting a full minute silently would look like a hang, so the caller is
  // told how long instead of being made to wait.
  assert.strictEqual(denied.retryAfterMs, 60000);
});

test('the window rolls: slots come back as they age out', () => {
  const l = api.makeRateLimiter({ minGapMs: 0, perWindow: 2, windowMs: 1000 });
  l.reserve(0);
  l.reserve(0);
  assert.strictEqual(l.reserve(500).ok, false);
  assert.strictEqual(l.reserve(1001).ok, true, 'the first two have aged out');
});

test('used() reports the live count inside the window', () => {
  const l = api.makeRateLimiter({ minGapMs: 0, perWindow: 10, windowMs: 1000 });
  l.reserve(0);
  l.reserve(0);
  assert.strictEqual(l.used(0), 2);
  assert.strictEqual(l.used(2000), 0, 'everything has aged out');
});

test('reset clears both the window and the gap', () => {
  const l = api.makeRateLimiter({ minGapMs: 5000, perWindow: 1, windowMs: 60000 });
  l.reserve(0);
  assert.strictEqual(l.reserve(0).ok, false);
  l.reset();
  assert.deepStrictEqual(l.reserve(0), { ok: true, waitMs: 0, at: 0 });
});

test('the limiter reads no clock of its own', () => {
  // Every entry point takes `now`, which is what lets these tests pin a
  // schedule instead of racing one.
  const l = api.makeRateLimiter({ minGapMs: 100, perWindow: 5, windowMs: 1000 });
  const first = l.reserve(1000);
  l.reset();
  const second = l.reserve(1000);
  assert.deepStrictEqual(first, second, 'identical inputs must give identical answers');
});

test('a nonsense now is treated as zero rather than poisoning the window', () => {
  const l = api.makeRateLimiter({ minGapMs: 0, perWindow: 2, windowMs: 1000 });
  assert.doesNotThrow(() => l.reserve('nonsense'));
  assert.doesNotThrow(() => l.reserve(undefined));
  assert.doesNotThrow(() => l.reserve(NaN));
});

test('the shipped defaults are the exact numbers the panel promises', () => {
  // Absolute values on purpose. Every other test here passes its own config, so
  // without this the constants could be changed to anything at all and the
  // whole suite would still pass while the script hammered Torn.
  assert.strictEqual(api.MIN_REQUEST_GAP_MS, 650);
  assert.strictEqual(api.REQUESTS_PER_WINDOW, 40);
  assert.strictEqual(api.RATE_WINDOW_MS, 60000);
  // Well under the ~100 a minute the community reports, because that number is
  // not documented and this script is not the only thing using the key.
  assert.ok(api.REQUESTS_PER_WINDOW < 100);
});

test('a limiter built with no config applies those defaults', () => {
  const l = api.makeRateLimiter({});
  assert.strictEqual(l.reserve(0).waitMs, 0);
  assert.strictEqual(l.reserve(0).waitMs, 650, 'the default gap must actually be applied');

  const fresh = api.makeRateLimiter({});
  for (let i = 0; i < 40; i += 1) assert.strictEqual(fresh.reserve(0).ok, true, 'request ' + i);
  assert.strictEqual(fresh.reserve(0).ok, false, 'the default ceiling must actually be applied');
});

test('a default refresh fits inside the ceiling with room to spare', () => {
  // Two fixed calls, one category call at most once a day, plus the enrichment
  // budget. The panel tells the user this number, so it has to stay true.
  const worstCase = 2 + 1 + api.MAX_ENRICH_BUDGET;
  assert.ok(worstCase < api.REQUESTS_PER_WINDOW,
    'worst-case refresh is ' + worstCase + ' against a ceiling of ' + api.REQUESTS_PER_WINDOW);

  const defaultCase = 2 + 1 + api.DEFAULT_ENRICH_BUDGET;
  assert.strictEqual(defaultCase, 13, 'the spec says a default refresh is at most 13 requests');
});
