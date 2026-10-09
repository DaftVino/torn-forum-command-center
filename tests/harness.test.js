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

// ---- #33 options -------------------------------------------------------------

test('panelWidth sizes only the panel, with a 1px border each side', () => {
  const env = loadUserscript({ panelWidth: 343 });
  const panel = env.makeElement('div');
  panel.setAttribute('id', 'tfcc-panel');
  assert.strictEqual(panel.getBoundingClientRect().width, 343);
  assert.strictEqual(panel.clientWidth, 341);
  const other = env.makeElement('div');
  assert.strictEqual(other.getBoundingClientRect().width, 0);
});

test('htmlQuery answers the runtime selector grammar from innerHTML, and only that', () => {
  const focusEnv = loadUserscript({ htmlQuery: true, measure: (n) => (n.classList.contains('wide') ? 72 : 10) });
  const el = focusEnv.makeElement('div');
  el.innerHTML = '<div><button type="button" data-act="read" data-id="2" class="tfcc-read wide">x</button>'
    + '<h3 id="tfcc-vh" tabindex="-1">Catch up</h3><button data-act="read" data-id="3"></button></div>';
  const read = el.querySelector('[data-act="read"][data-id="2"]');
  assert.ok(read);
  assert.strictEqual(read.getAttribute('data-id'), '2');
  assert.strictEqual(read.getBoundingClientRect().width, 72);
  assert.strictEqual(el.querySelector('.tfcc-read'), read, 'memoised per node');
  assert.strictEqual(el.querySelector('button.tfcc-read'), read);
  assert.ok(el.querySelector('#tfcc-vh'));
  assert.strictEqual(el.querySelectorAll('[data-act="read"]').length, 2);
  assert.strictEqual(el.querySelector('div > button'), null, 'outside the grammar');
  read.focus();
  assert.strictEqual(focusEnv.focusLog[0]['data-id'], '2');
  assert.strictEqual(focusEnv.doc.activeElement, read);
  el.innerHTML = '<p></p>';
  assert.strictEqual(el.querySelector('[data-act="read"][data-id="2"]'), null, 'a rewrite drops old nodes');
});

test('the fake ResizeObserver reports the border box, and env.resize fires it', () => {
  const env = loadUserscript({ resizeObserver: true });
  const seen = [];
  const ro = new env.sandbox.ResizeObserver((entries) => seen.push(entries[0].borderBoxSize[0].inlineSize));
  const target = env.makeElement('div');
  target.setAttribute('id', 'tfcc-panel');
  ro.observe(target);
  env.resize(500);
  assert.deepStrictEqual(seen, [500]);
  assert.strictEqual(target.getBoundingClientRect().width, 500);
  ro.disconnect();
  env.resize(700);
  assert.deepStrictEqual(seen, [500], 'a disconnected observer is silent');
});

test('queryLog records document queries from before the script runs', () => {
  const env = loadUserscript({ location: { pathname: '/forums.php', hostname: 'www.torn.com', href: 'https://www.torn.com/forums.php', hash: '', search: '', origin: 'https://www.torn.com' } });
  assert.ok(env.queryLog.length > 0, 'the bootstrap\'s mount search is in the log');
  assert.ok(env.queryLog.includes(env.exports.MOUNT_SELECTORS[0]));
});

test('style.setProperty and getComputedStyle padding are available', () => {
  const env = loadUserscript({ panelPadding: 8 });
  const panel = env.makeElement('div');
  panel.setAttribute('id', 'tfcc-panel');
  panel.style.setProperty('--tfcc-hb', '41.5px');
  assert.strictEqual(panel.style.getPropertyValue('--tfcc-hb'), '41.5px');
  panel.style.removeProperty('--tfcc-hb');
  assert.strictEqual(panel.style.getPropertyValue('--tfcc-hb'), '');
  assert.strictEqual(env.win.getComputedStyle(panel).paddingLeft, '8px');
});
