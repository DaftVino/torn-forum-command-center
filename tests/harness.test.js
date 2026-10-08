'use strict';

// The harness options added for issue #9. Opt-in; the defaults are unchanged.

const test = require('node:test');
const assert = require('node:assert');
const { loadUserscript } = require('./load-userscript');

const NOW = 1791460800000;

test('stepClock moves Date.now with each timer; the default jumps once at the end', () => {
  for (const [stepped, expected] of [[true, [1000, 2000, 3000]], [false, [0, 0, 0]]]) {
    const env = loadUserscript({ now: NOW, stepClock: stepped });
    const seen = [];
    const tick = () => {
      seen.push(env.now() - NOW);
      if (seen.length < 3) env.sandbox.setTimeout(tick, 1000);
    };
    env.sandbox.setTimeout(tick, 1000);
    env.advanceTimersBy(3000);
    assert.deepStrictEqual(seen, expected, stepped ? 'stepped' : 'default');
    assert.strictEqual(env.now(), NOW + 3000, 'either way the clock ends at the target');
  }
});

test('stepClock keeps a self-rescheduling timer chain going', () => {
  const env = loadUserscript({ now: NOW, stepClock: true });
  let fired = 0;
  const tick = () => { fired += 1; env.sandbox.setTimeout(tick, 1000); };
  env.sandbox.setTimeout(tick, 1000);
  env.advanceTimersBy(15000);
  assert.strictEqual(fired, 15);
});

test('sharedGmStore is one store between sandboxes, and gmStore still copies', () => {
  const shared = new Map();
  const a = loadUserscript({ sharedGmStore: shared });
  const b = loadUserscript({ sharedGmStore: shared });
  a.sandbox.GM_setValue('k', 'v');
  assert.strictEqual(b.sandbox.GM_getValue('k', null), 'v', 'b sees the write made in a');
  assert.strictEqual(shared.get('k'), 'v');
  const c = loadUserscript({ gmStore: [['k', 'v']] });
  c.sandbox.GM_setValue('k', 'w');
  assert.strictEqual(shared.get('k'), 'v', 'the plain option is a copy');
});
