'use strict';

// Spec section 6, "Dirty inputs". A tap on another control blurs a drawer
// field first; its change commits and redraws, and that redraw replaced the
// node under the finger, so the tap never arrived as a click.

const test = require('node:test');
const assert = require('node:assert');
const { NOW, bootNarrow, seedRows, panelOf, redraw, click } = require('./narrow-helpers');

function setup(extraEnv) {
  const { env, api } = bootNarrow({ env: extraEnv || {} });
  seedRows(api, [{ id: 1 }, { id: 2 }, { id: 3 }]);
  api.state.settings.view = 'threads';
  api.state.settings.sort = 'title';
  redraw(env);
  click(env, '[data-act="row-more"][data-id="1"]');
  const panel = panelOf(env);
  const note = panel.querySelector('[data-act="note-input"][data-id="1"]');
  note.value = 'typed note';
  return { env, api, panel, note };
}

// The same settle loop as tests/refresh.test.js: let promise chains and the
// timers they schedule run to the end.
async function settle(env) {
  for (let i = 0; i < 20; i += 1) {
    await new Promise((r) => setImmediate(r));
    env.runTimers();
  }
}

test('the no-click flush is 300ms, by contract', () => {
  // A literal, so changing the constant fails here (CLAUDE.md: a test must not
  // advance time by the constant it is testing).
  const { api } = bootNarrow();
  assert.strictEqual(api.PRESS_FLUSH_MS, 300);
});

test('a tap on another control while a drawer input is dirty commits and acts, in one redraw', () => {
  const { env, api, panel, note } = setup();
  const before = panel.renderCount;
  panel.dispatchEvent({ type: 'pointerdown', target: panel.querySelector('[data-act="row-more"][data-id="2"]') });
  panel.dispatchEvent({ type: 'change', target: note });
  assert.strictEqual(api.state.organizer.threads['1'].note, 'typed note', 'the change committed');
  env.advanceTimersBy(0);
  assert.strictEqual(panel.renderCount, before, 'its redraw is held while the press is in progress');
  panel.dispatchEvent({ type: 'pointerup', target: panel.querySelector('[data-act="row-more"][data-id="2"]') });
  click(env, '[data-act="row-more"][data-id="2"]');
  env.advanceTimersBy(0);
  assert.strictEqual(panel.renderCount, before + 1, 'one visible redraw for both');
  assert.strictEqual(api.state.openRowId, '2', 'the tapped action happened');
  assert.match(panel.innerHTML, /<div class="tfcc-note">typed note<\/div>/);
});

test('holding the pointer down past 300ms does not redraw; 300ms after it lifts with no click, it does', () => {
  const { env, panel, note } = setup();
  const before = panel.renderCount;
  panel.dispatchEvent({ type: 'pointerdown', target: panel });
  panel.dispatchEvent({ type: 'change', target: note });
  env.advanceTimersBy(1000);
  assert.strictEqual(panel.renderCount, before, 'a slow press keeps its target');
  panel.dispatchEvent({ type: 'pointerup', target: panel });
  env.advanceTimersBy(299);
  assert.strictEqual(panel.renderCount, before);
  env.advanceTimersBy(1);
  assert.strictEqual(panel.renderCount, before + 1);
  assert.strictEqual(env.exports.state.pressActive, false);
});

test('a pointerup outside the panel still ends the press', () => {
  const { env, panel, note } = setup();
  const before = panel.renderCount;
  panel.dispatchEvent({ type: 'pointerdown', target: panel });
  panel.dispatchEvent({ type: 'change', target: note });
  env.win.fire('pointerup', { type: 'pointerup' });
  env.advanceTimersBy(300);
  assert.strictEqual(panel.renderCount, before + 1, 'a press can never hold redraws forever');
});

test('a pointercancel flushes the held redraw', () => {
  const { env, panel, note } = setup();
  const before = panel.renderCount;
  panel.dispatchEvent({ type: 'pointerdown', target: panel });
  panel.dispatchEvent({ type: 'change', target: note });
  panel.dispatchEvent({ type: 'pointercancel', target: panel });
  env.advanceTimersBy(0);
  assert.strictEqual(panel.renderCount, before + 1);
  assert.strictEqual(env.exports.state.pressActive, false);
});

test('focus leaving the field during a press does not flush early', () => {
  const { env, panel, note } = setup();
  const before = panel.renderCount;
  panel.dispatchEvent({ type: 'pointerdown', target: panel });
  panel.dispatchEvent({ type: 'change', target: note });
  env.doc.activeElement = null;
  panel.dispatchEvent({ type: 'focusout', target: note });
  env.advanceTimersBy(0);
  assert.strictEqual(panel.renderCount, before, 'the focusout flush waits for the click');
  click(env, '[data-act="row-more"][data-id="3"]');
  env.advanceTimersBy(0);
  assert.strictEqual(panel.renderCount, before + 1);
});

test('a dirty field, then a plain thread-link tap: no redraw during the click, then one, with auto-hide', () => {
  // Redrawing while the click is being dispatched would remove the anchor
  // before the browser follows it. The thread-link branch never flushes
  // synchronously; the existing zero-delay redraw after dispatch does it.
  const { env, api, panel, note } = setup();
  api.state.settings.autoHideOnOpen = true;
  const before = panel.renderCount;
  const link = env.makeElement('a');
  link.setAttribute('data-tfcc-thread', '2');
  link.parentNode = panel;
  panel.dispatchEvent({ type: 'pointerdown', target: link });
  panel.dispatchEvent({ type: 'change', target: note });
  panel.dispatchEvent({ type: 'pointerup', target: link });
  panel.dispatchEvent({ type: 'click', target: link, button: 0, ctrlKey: false, metaKey: false,
    shiftKey: false, altKey: false, defaultPrevented: false });
  assert.strictEqual(panel.renderCount, before, 'nothing redraws inside the click');
  env.advanceTimersBy(0);
  assert.strictEqual(panel.renderCount, before + 1, 'one redraw after dispatch');
  assert.strictEqual(api.state.settings.collapsed, true, 'auto-hide still happened');
  assert.strictEqual(api.state.organizer.threads['1'].note, 'typed note', 'and the note was saved');
});

test('any redraw requested mid-press is held too', () => {
  const { env, api, panel } = setup();
  panel.dispatchEvent({ type: 'pointerdown', target: panel });
  const before = panel.renderCount;
  api.makeHandlers(env.doc, env.win).onAction('badges-shelf', { getAttribute: () => 'badges-shelf' });
  assert.strictEqual(panel.renderCount, before, 'held until the press ends');
  panel.dispatchEvent({ type: 'pointercancel', target: panel });
  assert.strictEqual(panel.renderCount, before + 1);
});

test('a forced redraw before the commit keeps what was typed and the caret', () => {
  const { env, api, panel, note } = setup();
  note.value = 'half';
  note.selectionStart = 2;
  note.selectionEnd = 3;
  panel.dispatchEvent({ type: 'input', target: note });
  // state lives in the vm realm; transform() brings it across for deepStrictEqual.
  assert.deepStrictEqual(env.transform(api.state.drawerEdit), { id: '1', field: 'note-input', value: 'half', selStart: 2, selEnd: 3 });
  env.doc.activeElement = note;
  panel.contains = () => true;
  redraw(env);
  assert.match(panel.innerHTML, /data-act="note-input" data-id="1" value="half"/);
  const again = panel.querySelector('[data-act="note-input"][data-id="1"]');
  assert.deepStrictEqual(again.selection, [2, 3], 'the selection is restored on the new node');
});

test('typed, rotated across the breakpoint, refreshed, then blurred: the value persists', async () => {
  const { env, api, panel } = setup({ resizeObserver: true });
  const h = api.makeHandlers(env.doc, env.win);
  // The user starts a refresh, then types while it is in flight.
  h.onAction('refresh', { getAttribute: () => 'refresh' });
  const note = panel.querySelector('[data-act="note-input"][data-id="1"]');
  note.value = 'keep me';
  panel.dispatchEvent({ type: 'input', target: note });
  env.doc.activeElement = note;
  panel.contains = () => true;
  const before = panel.renderCount;
  env.resize(900);
  assert.strictEqual(api.state.narrow, false, 'rotated to wide');
  assert.strictEqual(api.state.drawerEdit.value, 'keep me', 'the crossing kept the mirror');
  await settle(env);
  assert.strictEqual(panel.renderCount, before, 'neither the crossing nor the refresh replaced the field');
  panel.dispatchEvent({ type: 'change', target: note });
  env.doc.activeElement = null;
  panel.contains = () => false;
  env.advanceTimersBy(0);
  assert.strictEqual(api.state.organizer.threads['1'].note, 'keep me');
  assert.strictEqual(api.state.drawerEdit, null, 'the commit cleared the mirror');
  assert.match(panel.innerHTML, /data-act="note-input" data-id="1" value="keep me"/, 'the wide row shows it');
});
