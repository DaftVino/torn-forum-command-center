'use strict';

// #39: narrow view polish. One-line Catch up actions, one-line row text, the
// close toggle with click-away, and the compact emoji drawer.

const test = require('node:test');
const assert = require('node:assert');
const { NOW, bootNarrow, seedRows, panelOf, redraw, click, lastFocus } = require('./narrow-helpers');

// ---- 1. the Catch up action row --------------------------------------------

test('catchUpLabelMode keeps the full labels while they fit on one line', () => {
  const { api } = bootNarrow();
  // 103 + 181 + 44 and two 6px gaps = 340.
  assert.strictEqual(api.catchUpLabelMode(340, [103, 181, 44], [70, 92, 44]), 'full');
  assert.strictEqual(api.catchUpLabelMode(339.5, [103, 181, 44], [70, 92, 44]), 'short');
});

test('catchUpLabelMode shortens only when the full labels would wrap, then falls back to wrapping inside', () => {
  const { api } = bootNarrow();
  // Short: 70 + 92 + 44 + 12 = 218.
  assert.strictEqual(api.catchUpLabelMode(218, [103, 181, 44], [70, 92, 44]), 'short');
  assert.strictEqual(api.catchUpLabelMode(217, [103, 181, 44], [70, 92, 44]), 'wrap');
  // Unknown widths keep the full labels rather than guess.
  assert.strictEqual(api.catchUpLabelMode(0, [103, 181, 44], [70, 92, 44]), 'full');
  assert.strictEqual(api.catchUpLabelMode(300, null, undefined), 'full');
  assert.strictEqual(api.CU_GAP, 6);
});

test('narrow Catch up renders both labels; the accessible names stay full', () => {
  const { env, api } = bootNarrow();
  seedRows(api, [{ id: 1, unread: 1 }]);
  api.state.settings.view = 'catchup';
  const html = redraw(env);
  assert.match(html, /<div class="tfcc-bar tfcc-cubar">/);
  assert.match(html, /<button type="button" data-act="markall" aria-label="Mark all read"><span class="tfcc-lfull">Mark all read<\/span><span class="tfcc-lshort" aria-hidden="true">All read<\/span><\/button>/);
  assert.match(html, /<button type="button" data-act="catchup-done" aria-label="Set catch-up point to now"><span class="tfcc-lfull">Set catch-up point to now<\/span><span class="tfcc-lshort" aria-hidden="true">Catch-\u2191 2 \u2193<\/span><\/button>/);
});

// Widths at 14px text: full labels 103 and 181, short 70 and 92, the info
// button 44. scale doubles the text (200%), never the info button's box.
function cuEnv(width, scale) {
  const k = scale || 1;
  let panel = null;
  const mode = () => (panel.classList.contains('tfcc-cu-wrap') ? 'wrap'
    : panel.classList.contains('tfcc-cu-short') ? 'short' : 'full');
  const measure = (n) => {
    const act = n.getAttribute('data-act');
    const short = mode() !== 'full';
    if (act === 'markall') return 16 + k * (short ? 54 : 87);
    if (act === 'catchup-done') return 16 + k * (short ? 76 : 165);
    if (act === 'info') return 44;
    return 0;
  };
  const { env, api } = bootNarrow({ width, env: { measure } });
  panel = panelOf(env);
  seedRows(api, [{ id: 1, unread: 1 }]);
  api.state.settings.view = 'catchup';
  redraw(env);
  return { env, api, mode };
}

test('the Catch up row is measured on every draw: 375, 320 and 280px, and 200% text', () => {
  // 375: 325 of content; full needs 340, short 218.
  assert.strictEqual(cuEnv(343).mode(), 'short');
  assert.strictEqual(cuEnv(288).mode(), 'short');
  assert.strictEqual(cuEnv(248).mode(), 'short');
  // A wide-enough narrow panel keeps the full labels.
  assert.strictEqual(cuEnv(380).mode(), 'full');
  // 200% text at 320: short needs 140 + 168 + 44 + 12 = 364 > 270.
  assert.strictEqual(cuEnv(288, 2).mode(), 'wrap');
});

test('the Catch up fit leaves no class behind in another view or on a wide panel', () => {
  const { env, api } = cuEnv(288);
  const panel = panelOf(env);
  assert.strictEqual(panel.classList.contains('tfcc-cu-short'), true, 'precondition');
  api.state.settings.view = 'threads';
  redraw(env);
  assert.strictEqual(panel.classList.contains('tfcc-cu-short'), false);
  assert.strictEqual(panel.classList.contains('tfcc-cu-wrap'), false);
  const wide = cuEnv(900);
  assert.strictEqual(wide.mode(), 'full');
  assert.doesNotMatch(panelOf(wide.env).innerHTML, /tfcc-lshort/, 'the wide bar is main\'s markup');
});

test('a resize re-fits the Catch up row without a redraw', () => {
  const { env, api } = bootNarrow({ width: 380, env: { resizeObserver: true,
    measure: (n) => ({ markall: 103, 'catchup-done': 181, info: 44 }[n.getAttribute('data-act')] || 0) } });
  seedRows(api, [{ id: 1, unread: 1 }]);
  api.state.settings.view = 'catchup';
  redraw(env);
  const panel = panelOf(env);
  assert.strictEqual(panel.classList.contains('tfcc-cu-short'), false);
  env.resize(343);
  assert.strictEqual(panel.classList.contains('tfcc-cu-short'), true);
  // Short widths here are the same stubs, so 343 still cannot hold them: wrap.
  assert.strictEqual(panel.classList.contains('tfcc-cu-wrap'), true);
});

test('fitCatchUp never throws and reads nothing outside the panel', () => {
  const { env, api } = bootNarrow();
  assert.strictEqual(api.fitCatchUp(null, env.win), null);
  assert.doesNotThrow(() => api.fitCatchUp({ classList: { toggle() {} }, querySelector() { throw new Error('x'); } }, env.win));
});

// One rule body from the stylesheet, by its exact selector.
function cssRule(api, sel) {
  const css = api.panelStyleText();
  const at = css.indexOf(sel + ' {');
  assert.ok(at !== -1, 'no rule for ' + sel);
  return css.slice(at + sel.length + 2, css.indexOf('}', at));
}

test('the Catch up row never wraps, and the panel class swaps the labels (#39)', () => {
  const { api } = bootNarrow();
  assert.match(cssRule(api, '#tfcc-panel.tfcc-narrow .tfcc-cubar'), /flex-wrap: nowrap/);
  assert.match(cssRule(api, '#tfcc-panel.tfcc-narrow .tfcc-cubar > button'), /flex: none; white-space: nowrap/);
  assert.match(cssRule(api, '#tfcc-panel.tfcc-narrow .tfcc-lshort'), /display: none/);
  assert.match(cssRule(api, '#tfcc-panel.tfcc-narrow.tfcc-cu-short .tfcc-lfull'), /display: none/);
  assert.match(cssRule(api, '#tfcc-panel.tfcc-narrow.tfcc-cu-short .tfcc-lshort'), /display: inline/);
  // The fallback: the labels wrap inside buttons that share the row.
  assert.match(cssRule(api, '#tfcc-panel.tfcc-narrow.tfcc-cu-wrap .tfcc-cubar > button'),
    /flex: 1 1 0; min-width: 44px; white-space: normal/);
});
