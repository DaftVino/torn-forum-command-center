'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { NOW, bootNarrow, seedRows, panelOf, redraw } = require('./narrow-helpers');

test('an unmeasured panel stays wide, which is every existing suite', () => {
  const { env, api } = bootNarrow({ width: 0 });
  assert.strictEqual(api.state.narrow, false);
  assert.strictEqual(panelOf(env).classList.contains('tfcc-narrow'), false);
  assert.strictEqual(api.buildPanelModel(NOW).narrow, false);
});

test('without ResizeObserver the per-render measurement still picks the narrow layout', () => {
  const { env, api } = bootNarrow({ width: 343 });
  assert.strictEqual(api.state.narrow, true);
  assert.strictEqual(panelOf(env).classList.contains('tfcc-narrow'), true);
  assert.strictEqual(api.buildPanelModel(NOW).narrow, true);
});

test('a wide panel is not narrow, and the class is absent', () => {
  const { env, api } = bootNarrow({ width: 900 });
  assert.strictEqual(api.state.narrow, false);
  assert.strictEqual(panelOf(env).classList.contains('tfcc-narrow'), false);
});

test('the ResizeObserver watches only the panel, once, across many draws', () => {
  const { env } = bootNarrow({ width: 900, env: { resizeObserver: true } });
  for (let i = 0; i < 5; i += 1) redraw(env);
  const live = env.resizeObservers.filter((ro) => !ro.disconnected);
  assert.strictEqual(live.length, 1);
  assert.strictEqual(live[0].target, panelOf(env), 'it observes the script\'s own #tfcc-panel and nothing of Torn\'s');
});

test('crossing into narrow flips the class, and hysteresis holds between 600 and 616', () => {
  const { env, api } = bootNarrow({ width: 900, env: { resizeObserver: true } });
  const panel = panelOf(env);
  let before = panel.renderCount;
  env.resize(500);
  assert.strictEqual(api.state.narrow, true);
  assert.strictEqual(panel.classList.contains('tfcc-narrow'), true);

  before = panel.renderCount;
  for (const w of [610, 616, 600, 616, 500]) env.resize(w);
  assert.strictEqual(api.state.narrow, true, 'still narrow inside the band');

  env.resize(617);
  assert.strictEqual(api.state.narrow, false);
  assert.strictEqual(panel.classList.contains('tfcc-narrow'), false);
});

test('crossing the breakpoint closes the drawer, the filters and the info', () => {
  const { env, api } = bootNarrow({ width: 900, env: { resizeObserver: true } });
  seedRows(api, [{ id: 1, unread: 1 }]);
  redraw(env);
  api.state.openRowId = '1';
  api.state.filtersOpen = true;
  api.state.openInfoId = 'catchup';
  env.resize(400);
  assert.strictEqual(api.state.openRowId, null);
  assert.strictEqual(api.state.filtersOpen, false);
  assert.strictEqual(api.state.openInfoId, null);
});

test('crossing the breakpoint while typing defers the markup but closes the transients', () => {
  const { env, api } = bootNarrow({ width: 900, env: { resizeObserver: true } });
  const panel = panelOf(env);
  const input = env.makeElement('input');
  input.setAttribute('data-act', 'note-input');
  env.doc.activeElement = input;
  panel.contains = () => true;
  api.state.filtersOpen = true;
  const before = panel.renderCount;
  env.resize(400);
  assert.strictEqual(panel.classList.contains('tfcc-narrow'), true, 'the class flips at once');
  assert.strictEqual(api.state.filtersOpen, false);
});

test('an entry without borderBoxSize falls back to the panel\'s own rect', () => {
  const { env, api } = bootNarrow({ width: 900, env: { resizeObserver: 'no-box' } });
  env.resize(500);
  assert.strictEqual(api.state.narrow, true);
});

test('a ResizeObserver that throws leaves the panel working', () => {
  const { env, api } = bootNarrow({ width: 343, env: { resizeObserver: 'throws' } });
  assert.strictEqual(api.state.narrow, true, 'the per-render measurement still applies');
  assert.ok(panelOf(env).innerHTML.length > 0);
});

test('measurePanelWidth survives a panel without a rect', () => {
  const { api } = bootNarrow({ width: 0 });
  assert.strictEqual(api.measurePanelWidth(null), 0);
  assert.strictEqual(api.measurePanelWidth({ getBoundingClientRect() { throw new Error('detached'); } }), 0);
  assert.strictEqual(api.measurePanelWidth({}), 0);
});

// ---- fitHeader (spec 13b) -----------------------------------------------------

// The chip measures 72px normal and 58px compact (spec 13b). The Show button's
// width follows the size, because its padding is clamp(4px, 0.2 x hb, 10px) on
// each side: 13b's own figure of 65px at a 24px size gives 55.4 + 0.4 x hb.
function fitEnv(width, collapsed) {
  let panel = null;
  const hbNow = () => parseFloat(panel.style.getPropertyValue('--tfcc-hb')) || 44;
  const measure = (n) => {
    if (n.classList.contains('tfcc-chip')) return n.classList.contains('tfcc-compact') ? 58 : 72;
    if (n.classList.contains('tfcc-hshow')) return 55.4 + 0.4 * hbNow();
    return 0;
  };
  const { env, api } = bootNarrow({ width, env: { measure, gmStore: collapsed
    ? [['tfcc:settings', JSON.stringify({ v: 1, collapsed: true })]] : [] } });
  panel = panelOf(env);
  redraw(env);
  return { env, api, hb: () => panel.style.getPropertyValue('--tfcc-hb') };
}

test('fitHeader sizes the header buttons from the panel\'s own width', () => {
  assert.strictEqual(fitEnv(343).hb(), '44px', '375px phone');
  assert.strictEqual(fitEnv(288).hb(), '41.5px', '320px phone');
});

test('below 36px the chip goes compact and the solve runs again', () => {
  const { env, hb } = fitEnv(248);
  assert.strictEqual(hb(), '35px');
  assert.strictEqual(panelOf(env).querySelector('.tfcc-chip').classList.contains('tfcc-compact'), true);
  const roomy = fitEnv(343);
  assert.strictEqual(panelOf(roomy.env).querySelector('.tfcc-chip').classList.contains('tfcc-compact'), false);
});

test('collapsed, the Show label is part of the solve, measured again at the size it gets', () => {
  // 320 collapsed: Show at 44px is 73px, the first solve goes compact at 36,
  // Show re-measured at 36 is 69.8px, and the second solve gives 37. 280
  // collapsed lands half a step above the floor. Spec 13b is amended to match.
  assert.strictEqual(fitEnv(288, true).hb(), '37px');
  assert.strictEqual(fitEnv(248, true).hb(), '24.5px');
});

test('the loading header has no buttons to fit, so it keeps the full size', () => {
  const { env, api } = bootNarrow({ width: 288 });
  const panel = panelOf(env);
  panel.innerHTML = api.panelHtml(api.loadingModel(NOW));
  assert.strictEqual(api.fitHeader(panel, env.win), 44);
});

test('a wide panel carries no header size at all', () => {
  const { hb } = fitEnv(900, [72, 58], 0);
  assert.strictEqual(hb(), '');
});

test('fitHeader reads nothing outside the panel and never throws', () => {
  const { env, api } = bootNarrow({ width: 343 });
  assert.strictEqual(api.fitHeader(null, env.win), null);
  assert.doesNotThrow(() => api.fitHeader({ querySelector() { throw new Error('x'); } }, env.win));
});

test('a crossing redraws once; inside the band nothing redraws; while typing it defers', () => {
  // Moved here from Task 6: only now does the narrow markup differ from wide.
  const { env, api } = bootNarrow({ width: 900, env: { resizeObserver: true } });
  const panel = panelOf(env);
  let before = panel.renderCount;
  env.resize(500);
  assert.strictEqual(panel.renderCount, before + 1, 'one redraw for the crossing');
  before = panel.renderCount;
  for (const w of [610, 616, 600, 616, 500]) env.resize(w);
  assert.strictEqual(panel.renderCount, before, 'no redraw while the layout does not change');
  env.resize(617);
  assert.strictEqual(panel.renderCount, before + 1);
  const input = env.makeElement('input');
  input.setAttribute('data-act', 'note-input');
  env.doc.activeElement = input;
  panel.contains = () => true;
  before = panel.renderCount;
  env.resize(400);
  assert.strictEqual(panel.classList.contains('tfcc-narrow'), true, 'the class flips at once');
  assert.strictEqual(panel.renderCount, before, 'the markup waits for focus to leave');
  assert.strictEqual(api.state.pendingRedraw, true);
});
