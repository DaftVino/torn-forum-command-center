'use strict';

// Spec section 6's transition table, through the real model and handlers.
// Rows that need the Actions markup are in Task 12's part of this file.

const test = require('node:test');
const assert = require('node:assert');
const { NOW, bootNarrow, seedRows, redraw } = require('./narrow-helpers');

const SIX = [1, 2, 3, 4, 5, 6].map((id) => ({ id, title: 'Thread ' + id, unread: id }));

function handlersOf(env) { return env.exports.makeHandlers(env.doc, env.win); }
const el = (attrs) => ({ getAttribute: (k) => (attrs[k] === undefined ? null : attrs[k]) });

test('the model carries the rendered ids in DOM order, per view', () => {
  const { api } = bootNarrow();
  seedRows(api, SIX);
  api.state.settings.view = 'threads';
  api.state.settings.sort = 'title';
  assert.deepStrictEqual(api.buildPanelModel(NOW).renderedIds, ['1', '2', '3', '4', '5', '6']);
  api.state.settings.rowsShown = 3;
  assert.deepStrictEqual(api.buildPanelModel(NOW).renderedIds, ['1', '2', '3'], 'after the cap');
  api.state.settings.view = 'drafts';
  assert.deepStrictEqual(api.buildPanelModel(NOW).renderedIds, []);
});

test('Catch up ids follow the folder grouping the view renders', () => {
  const { api } = bootNarrow();
  seedRows(api, SIX);
  api.state.organizer = api.setFolder(api.state.organizer, '6', 'guides');
  api.recompute(NOW);
  api.state.settings.view = 'catchup';
  const model = api.buildPanelModel(NOW);
  const grouped = [].concat(...api.groupCatchUp(model.capped.catchup.rows).map((g) => g.rows.map((r) => String(r.id))));
  assert.deepStrictEqual(model.renderedIds, grouped);
  assert.strictEqual(model.renderedIds[0], '6', 'Guides sorts before Unfiled');
});

test('a stale open row is reconciled away and does not reopen when it returns', () => {
  const { api } = bootNarrow();
  seedRows(api, SIX);
  api.state.settings.view = 'threads';
  api.state.openRowId = '4';
  assert.strictEqual(api.buildPanelModel(NOW).openRowId, '4', 'still listed: unchanged');

  api.state.searchQuery = 'Thread 1';
  assert.strictEqual(api.buildPanelModel(NOW).openRowId, null, 'filtered out: closed');
  api.state.searchQuery = '';
  assert.strictEqual(api.buildPanelModel(NOW).openRowId, null, 'back in the list: still closed');
  assert.strictEqual(api.state.openRowId, null, 'written back to state');
});

test('the cap, Unread only and archive each reconcile the open row', () => {
  const { api } = bootNarrow();
  seedRows(api, SIX);
  api.state.settings.view = 'threads';
  api.state.settings.sort = 'title';

  api.state.openRowId = '6';
  api.state.settings.rowsShown = 3;
  assert.strictEqual(api.buildPanelModel(NOW).openRowId, null, 'capped away');
  api.state.settings.rowsShown = 0;

  api.state.openRowId = '2';
  // An archived thread with new posts stays listed (viewRows), so read it first.
  api.state.organizer = api.markRead(api.state.organizer, '2', 10, NOW);
  const e = api.state.organizer.threads['2'] || api.normaliseThreadEntry(null);
  api.state.organizer.threads['2'] = Object.assign({}, e, { archived: true });
  api.recompute(NOW);
  assert.strictEqual(api.buildPanelModel(NOW).openRowId, null, 'archived away');
});

test('a refresh that drops the open row reconciles it; one that keeps it does not', () => {
  const { api } = bootNarrow();
  seedRows(api, SIX);
  api.state.settings.view = 'threads';
  api.state.openRowId = '3';
  seedRows(api, SIX);
  assert.strictEqual(api.buildPanelModel(NOW).openRowId, '3');
  seedRows(api, SIX.filter((r) => r.id !== 3));
  assert.strictEqual(api.buildPanelModel(NOW).openRowId, null);
});

test('the filters stay open across refresh, filter and cap changes', () => {
  const { api } = bootNarrow();
  seedRows(api, SIX);
  api.state.filtersOpen = true;
  api.state.searchQuery = 'Thread';
  api.state.settings.rowsShown = 3;
  assert.strictEqual(api.buildPanelModel(NOW).filtersOpen, true);
});

test('changing view closes everything; tapping the current view changes nothing', () => {
  const { env, api } = bootNarrow();
  seedRows(api, SIX);
  api.state.settings.view = 'threads';
  Object.assign(api.state, { openRowId: '1', filtersOpen: true, openInfoId: null });
  handlersOf(env).onAction('view', el({ 'data-act': 'view', 'data-view': 'threads' }));
  assert.strictEqual(api.state.openRowId, '1', 'same view');
  handlersOf(env).onAction('view', el({ 'data-act': 'view', 'data-view': 'catchup' }));
  assert.strictEqual(api.state.openRowId, null);
  assert.strictEqual(api.state.filtersOpen, false);
});

test('the Draft action and All badges change view, so they close everything too', () => {
  const { env, api } = bootNarrow();
  seedRows(api, SIX);
  Object.assign(api.state, { openRowId: '1', filtersOpen: true });
  handlersOf(env).onAction('draft', el({ 'data-act': 'draft', 'data-id': '1' }));
  assert.strictEqual(api.state.settings.view, 'drafts');
  assert.strictEqual(api.state.openRowId, null);
  api.state.settings.view = 'threads';
  Object.assign(api.state, { openRowId: '1', filtersOpen: true });
  handlersOf(env).onAction('badges-all', el({ 'data-act': 'badges-all' }));
  assert.strictEqual(api.state.openRowId, null);
  assert.strictEqual(api.state.filtersOpen, false);
});

test('Hide closes everything, and Show leaves it closed', () => {
  const { env, api } = bootNarrow();
  seedRows(api, SIX);
  Object.assign(api.state, { openRowId: '1', filtersOpen: true, openInfoId: 'catchup' });
  handlersOf(env).onAction('collapse', el({ 'data-act': 'collapse' }));
  assert.strictEqual(api.state.settings.collapsed, true);
  assert.deepStrictEqual([api.state.openRowId, api.state.filtersOpen, api.state.openInfoId], [null, false, null]);
  handlersOf(env).onAction('collapse', el({ 'data-act': 'collapse' }));
  assert.strictEqual(api.state.settings.collapsed, false);
  assert.deepStrictEqual([api.state.openRowId, api.state.filtersOpen, api.state.openInfoId], [null, false, null]);
});

test('Reset everything replaces the settings through the transient reset', () => {
  // It replaces state.settings wholesale, which moves Settings to Threads; a
  // view change that skipped the reset would leave the filters open.
  const { env, api } = bootNarrow();
  seedRows(api, SIX);
  api.state.settings.view = 'settings';
  Object.assign(api.state, { openRowId: '1', filtersOpen: true, openInfoId: 'settings-rows',
    drawerEdit: { id: '1', field: 'note-input', value: 'x', selStart: 1, selEnd: 1 } });
  handlersOf(env).onAction('reset-all', el({ 'data-act': 'reset-all' }));
  assert.strictEqual(api.state.settings.view, 'threads');
  assert.deepStrictEqual([api.state.openRowId, api.state.filtersOpen, api.state.openInfoId, api.state.drawerEdit],
    [null, false, null, null], 'a real reset drops the edit mirror too');
});

test('a settings replacement that keeps the view keeps the transients', () => {
  const { env, api } = bootNarrow();
  seedRows(api, SIX);
  api.state.settings.view = 'settings';
  api.state.openInfoId = 'settings-rows';
  handlersOf(env).onChange('rows-shown', { getAttribute: (k) => (k === 'data-act' ? 'rows-shown' : null), value: '10' });
  assert.strictEqual(api.state.openInfoId, 'settings-rows');
  handlersOf(env).onChange('auto-refresh', { getAttribute: (k) => (k === 'data-act' ? 'auto-refresh' : null), value: '0' });
  assert.strictEqual(api.state.openInfoId, 'settings-rows');
});

test('Expand and Shrink leave the transients alone when no breakpoint is crossed', () => {
  const { env, api } = bootNarrow();
  seedRows(api, SIX);
  api.state.settings.view = 'threads';
  redraw(env);
  Object.assign(api.state, { openRowId: '1', filtersOpen: true });
  handlersOf(env).onAction('takeover', el({ 'data-act': 'takeover' }));
  assert.strictEqual(api.state.openRowId, '1');
  assert.strictEqual(api.state.filtersOpen, true);
});

test('a Torn route change inside forums.php reconciles through the redraw', () => {
  const { env, api } = bootNarrow();
  seedRows(api, SIX);
  api.state.settings.view = 'threads';
  api.state.openRowId = '99';
  api.syncToRoute(env.doc, env.win);
  assert.strictEqual(api.state.openRowId, null);
});

test('Filters toggles through the real click, and a view change closes it', () => {
  const { env, api } = bootNarrow();
  seedRows(api, SIX);
  api.state.settings.view = 'threads';
  redraw(env);
  require('./narrow-helpers').click(env, '[data-act="filters"]');
  assert.strictEqual(api.state.filtersOpen, true);
  require('./narrow-helpers').click(env, '[data-act="view"][data-view="mine"]');
  assert.strictEqual(api.state.filtersOpen, false);
});
