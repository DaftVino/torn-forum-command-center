'use strict';

// #43 (owner): semi-transparent backgrounds at every width and in every view,
// except while expanded. The panel's own background is 50% opaque and the
// surfaces on it (everything on --tm-bg-2: thread rows, the badge shelf and
// toast) 75%, by alpha on the background tokens, never by opacity, so text
// and controls stay fully opaque. Takeover is solid, as before.

const test = require('node:test');
const assert = require('node:assert');
const { loadUserscript } = require('./load-userscript');

const { exports: api } = loadUserscript();
const css = api.panelStyleText();

function blockFor(selector) {
  const i = css.indexOf(selector + ' {');
  assert.ok(i !== -1, 'no rule block for ' + selector);
  return css.slice(i, css.indexOf('}', i));
}

// Every block for a selector, in source order.
function blocksFor(selector) {
  const out = [];
  let i = css.indexOf(selector + ' {');
  while (i !== -1) {
    out.push(css.slice(i, css.indexOf('}', i)));
    i = css.indexOf(selector + ' {', i + 1);
  }
  return out;
}

const hex = (h) => [1, 3, 5].map((k) => parseInt(h.slice(k, k + 2), 16));
const token = (block, name) => new RegExp(name.replace(/-/g, '\\-') + ':\\s*([^;]+);').exec(block)[1].trim();

test('the panel token is --tm-bg at 50% and the surface token --tm-bg-2 at 75%, in both themes', () => {
  for (const sel of ['#tfcc-panel', '#tfcc-panel.tfcc-theme-light']) {
    const block = blockFor(sel);
    for (const [name, base, alpha] of [['--tfcc-panel-bg', '--tm-bg', 0.5], ['--tfcc-surface-bg', '--tm-bg-2', 0.75]]) {
      const m = /^rgba\((\d+), (\d+), (\d+), ([0-9.]+)\)$/.exec(token(block, name));
      assert.ok(m, sel + ' ' + name + ' is rgba');
      assert.deepStrictEqual([+m[1], +m[2], +m[3]], hex(token(block, base)), sel + ' ' + name + ' is ' + base + "'s colour");
      assert.strictEqual(+m[4], alpha, sel + ' ' + name);
    }
  }
});

test('the panel, the rows and the shelf paint those tokens; nothing uses opacity to do it', () => {
  const panelRule = css.slice(css.indexOf('#tfcc-panel { box-sizing'), css.indexOf('}', css.indexOf('#tfcc-panel { box-sizing')));
  assert.match(panelRule, /background: var\(--tfcc-panel-bg\);/);
  assert.match(blockFor('#tfcc-panel .tfcc-row'), /background: var\(--tfcc-surface-bg\);/);
  assert.match(blockFor('#tfcc-panel .tfcc-shelf, #tfcc-panel .tfcc-toast'), /background: var\(--tfcc-surface-bg\);/);
  for (const body of [panelRule, blockFor('#tfcc-panel .tfcc-row'), blockFor('#tfcc-panel .tfcc-shelf, #tfcc-panel .tfcc-toast')]) {
    assert.doesNotMatch(body, /(^|[^-])opacity\s*:/, 'opacity would fade the text too');
  }
  // The controls keep their solid fill.
  assert.match(css, /#tfcc-panel button, #tfcc-panel select, #tfcc-panel input,\n#tfcc-panel textarea \{\n  font: inherit; color: var\(--tm-text\); background: var\(--tm-bg-3\);/);
  assert.match(token(blockFor('#tfcc-panel'), '--tm-bg-3'), /^#[0-9a-f]{6}$/, 'the control fill is solid');
});

test('takeover is solid again, in either theme, and has no blur', () => {
  const blocks = blocksFor('#tfcc-panel.tfcc-takeover');
  const restore = blocks.find((b) => b.includes('--tfcc-panel-bg'));
  assert.ok(restore, 'a takeover rule restores the tokens');
  assert.match(restore, /--tfcc-panel-bg: var\(--tm-bg\); --tfcc-surface-bg: var\(--tm-bg-2\);/);
  assert.match(restore, /-webkit-backdrop-filter: none; backdrop-filter: none;/);
  // After both theme blocks, so it wins over the light theme's tokens too.
  assert.ok(css.indexOf(restore) > css.indexOf('#tfcc-panel.tfcc-theme-light {'));
});

test('a backdrop blur sits behind the translucent panel, prefixed for WebKit', () => {
  const blur = blocksFor('#tfcc-panel').find((b) => b.includes('backdrop-filter'));
  assert.ok(blur);
  assert.match(blur, /-webkit-backdrop-filter: blur\(6px\); backdrop-filter: blur\(6px\);/);
});

test('the runtime marks takeover on the panel, so the solid tokens apply there', () => {
  const env = loadUserscript({ location: require('./load-userscript').FORUMS_LOCATION });
  const a = env.exports;
  a.state.settings.takeover = true;
  env.exports.draw(env.doc, env.win, a.makeHandlers(env.doc, env.win), true);
  const panel = env.doc.getElementById('tfcc-panel');
  assert.ok(panel.classList.contains('tfcc-takeover'));
  a.state.settings.takeover = false;
  env.exports.draw(env.doc, env.win, a.makeHandlers(env.doc, env.win), true);
  assert.ok(!panel.classList.contains('tfcc-takeover'));
});
