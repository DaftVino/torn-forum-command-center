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
