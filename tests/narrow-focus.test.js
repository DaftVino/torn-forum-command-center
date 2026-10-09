'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { NOW, bootNarrow, seedRows, panelOf, redraw, click, lastFocus } = require('./narrow-helpers');

function catchUp(n) {
  const { env, api } = bootNarrow();
  seedRows(api, Array.from({ length: n }, (_, i) => ({ id: i + 1, unread: 1 })));
  api.state.settings.view = 'catchup';
  redraw(env);
  const ids = api.buildPanelModel(NOW).renderedIds;
  assert.strictEqual(ids.length, n, 'precondition: every seeded row is in Catch up');
  return { env, api, ids };
}

test('Read removes the first row: focus goes to the next row\'s Read', () => {
  const { env, ids } = catchUp(3);
  click(env, '[data-act="read"][data-id="' + ids[0] + '"]');
  assert.deepStrictEqual([lastFocus(env)['data-act'], lastFocus(env)['data-id']], ['read', ids[1]]);
});

test('Read removes a middle row: focus goes to the next row\'s Read', () => {
  const { env, ids } = catchUp(3);
  click(env, '[data-act="read"][data-id="' + ids[1] + '"]');
  assert.strictEqual(lastFocus(env)['data-id'], ids[2]);
});

test('Read removes the last row: focus goes to the previous row\'s Read', () => {
  const { env, ids } = catchUp(3);
  click(env, '[data-act="read"][data-id="' + ids[2] + '"]');
  assert.deepStrictEqual([lastFocus(env)['data-act'], lastFocus(env)['data-id']], ['read', ids[1]]);
});

test('Read removes the only row: focus goes to the view heading', () => {
  const { env, ids } = catchUp(1);
  click(env, '[data-act="read"][data-id="' + ids[0] + '"]');
  assert.strictEqual(lastFocus(env).id, 'tfcc-vh');
  assert.match(panelOf(env).innerHTML, /<h3 class="tfcc-vh" id="tfcc-vh" tabindex="-1">Catch up/);
});

test('Archive from a drawer focuses the next row\'s Actions', () => {
  const { env, api } = bootNarrow();
  seedRows(api, [{ id: 1 }, { id: 2 }, { id: 3 }]);
  api.state.settings.view = 'threads';
  api.state.settings.sort = 'title';
  redraw(env);
  click(env, '[data-act="row-more"][data-id="2"]');
  click(env, '[data-act="archive"][data-id="2"]');
  assert.deepStrictEqual([lastFocus(env)['data-act'], lastFocus(env)['data-id']], ['row-more', '3']);
});

test('Actions, a view cell, an info button and Hide keep focus on the same control', () => {
  const { env, api } = bootNarrow();
  seedRows(api, [{ id: 1, unread: 1 }]);
  api.state.settings.view = 'threads';
  redraw(env);
  click(env, '[data-act="row-more"][data-id="1"]');
  assert.deepStrictEqual([lastFocus(env)['data-act'], lastFocus(env)['data-id']], ['row-more', '1']);
  click(env, '[data-act="view"][data-view="catchup"]');
  assert.deepStrictEqual([lastFocus(env)['data-view'], lastFocus(env)['aria-pressed']], ['catchup', 'true']);
  click(env, '[data-act="info"][data-info="catchup"]');
  assert.strictEqual(lastFocus(env)['data-info'], 'catchup');
  click(env, '[data-act="collapse"]');
  assert.strictEqual(lastFocus(env).class, 'tfcc-hshow', 'the same button, which now reads Show');
});

test('a background redraw never pulls focus into the panel', () => {
  const { env, api } = bootNarrow();
  seedRows(api, [{ id: 1, unread: 1 }]);
  env.doc.activeElement = null;
  const before = env.focusLog.length;
  seedRows(api, [{ id: 1, unread: 2 }]);
  env.exports.draw(env.doc, env.win, api.makeHandlers(env.doc, env.win));
  assert.strictEqual(env.focusLog.length, before);
});

test('a background redraw that removes the focused row moves focus to its successor', () => {
  const { env, api } = bootNarrow();
  seedRows(api, [{ id: 1 }, { id: 2 }, { id: 3 }]);
  api.state.settings.view = 'threads';
  api.state.settings.sort = 'title';
  redraw(env);
  const panel = panelOf(env);
  env.doc.activeElement = panel.querySelector('[data-act="row-more"][data-id="2"]');
  panel.contains = () => true;
  seedRows(api, [{ id: 1 }, { id: 3 }]);
  env.exports.draw(env.doc, env.win, api.makeHandlers(env.doc, env.win));
  assert.deepStrictEqual([lastFocus(env)['data-act'], lastFocus(env)['data-id']], ['row-more', '3']);
});

test('Read announces once through a polite live region that survives the rewrite', () => {
  const { env, ids } = catchUp(3);
  click(env, '[data-act="read"][data-id="' + ids[0] + '"]');
  assert.match(panelOf(env).innerHTML, /<div class="tfcc-sr" role="status" aria-live="polite">Marked read\. 2 left\.<\/div>/);
  redraw(env);
  assert.doesNotMatch(panelOf(env).innerHTML, /Marked read\./, 'announced once, like the badge toast');
});

test('Archive and Mark all read announce too', () => {
  const { env, api } = bootNarrow();
  seedRows(api, [{ id: 1, unread: 1 }, { id: 2, unread: 1 }]);
  api.state.settings.view = 'catchup';
  redraw(env);
  click(env, '[data-act="markall"]');
  assert.match(panelOf(env).innerHTML, /role="status" aria-live="polite">Marked all read\.</);
  api.state.settings.view = 'threads';
  redraw(env);
  click(env, '[data-act="row-more"][data-id="1"]');
  click(env, '[data-act="archive"][data-id="1"]');
  assert.match(panelOf(env).innerHTML, /role="status" aria-live="polite">Archived\.</);
});

// ---- ADR 0001: Torn's markup is read in exactly two places ------------------

test('every document query, from bootstrap on, is a mount, reply-box or own-control selector', () => {
  // env.queryLog records from before the script runs, so an init-only query
  // is caught too. The whitelist is exact: no prefix match.
  const { env, api } = bootNarrow({ env: { resizeObserver: true } });
  seedRows(api, [{ id: 1, unread: 1 }, { id: 2, unread: 1 }]);
  api.state.settings.view = 'catchup';
  redraw(env);
  click(env, '[data-act="row-more"][data-id="1"]');
  click(env, '[data-act="read"][data-id="2"]');
  api.state.settings.view = 'threads'; // Catch up has no filter line
  redraw(env);
  click(env, '[data-act="filters"]');
  env.resize(900);
  env.resize(300);
  api.state.settings.view = 'settings';
  redraw(env);
  click(env, '[data-act="key-save"]');
  const allowed = new Set([].concat(api.MOUNT_SELECTORS, api.REPLY_SELECTORS, [
    // valueOf() in makeHandlers reads the panel's own value-carrying controls.
    '[data-act="key-input"]', '[data-act="draft-text"]', '[data-act="import-text"]', '[data-act="folder-name"]',
  ]));
  const stray = env.queryLog.filter((s) => !allowed.has(s));
  assert.deepStrictEqual(stray, [], 'a document query outside ADR 0001\'s two places and our own controls');
  assert.ok(env.queryLog.includes(api.MOUNT_SELECTORS[0]), 'the log really did record the bootstrap');
});

test('every querySelector call site in the source is one of the known ones', () => {
  // A static audit, so a branch the runtime test never reaches is covered
  // too. document reads are the three that predate #33; #33 adds panel reads
  // only, on this script's own element.
  const src = require('./load-userscript').readSource();
  const calls = Array.from(src.matchAll(/(\w+)\.querySelector(?:All)?\(([^()]*)\)/g), (m) => m[1] + '(' + m[2] + ')');
  assert.deepStrictEqual(calls.slice().sort(), [
    'doc(MOUNT_SELECTORS[i])',
    'doc(REPLY_SELECTORS[i])',
    "doc('[data-act=\"' + act + '\"]')",
    "panel('.tfcc-chip')",
    "panel('.tfcc-hbtn')",
    "panel('.tfcc-hshow')",
    'panel(plan[i])',
  ].sort());
});

// ---- focus after a text field commits (plan review) -------------------------

test('Tab from the tag field to the note field leaves focus in the note field', () => {
  const { env, api } = bootNarrow();
  seedRows(api, [{ id: 1 }, { id: 2 }]);
  api.state.settings.view = 'threads';
  api.state.settings.sort = 'title';
  redraw(env);
  click(env, '[data-act="row-more"][data-id="1"]');
  const panel = panelOf(env);
  panel.contains = () => true;
  const tag = panel.querySelector('[data-act="tag-input"][data-id="1"]');
  tag.value = 'newtag';
  env.doc.activeElement = tag;
  panel.dispatchEvent({ type: 'change', target: tag });
  // The browser moves focus after change; the redraw waits a tick for it.
  env.doc.activeElement = panel.querySelector('[data-act="note-input"][data-id="1"]');
  const before = env.focusLog.length;
  env.advanceTimersBy(0);
  assert.ok(api.state.organizer.threads['1'].tags.includes('newtag'));
  assert.ok(env.focusLog.length > before, 'focus was restored');
  assert.strictEqual(lastFocus(env)['data-act'], 'note-input', 'not pulled back into the tag field');
});

test('Tab out of the note field moves on to the next control, not back into the note', () => {
  const { env, api } = bootNarrow();
  seedRows(api, [{ id: 1 }, { id: 2 }]);
  api.state.settings.view = 'threads';
  api.state.settings.sort = 'title';
  redraw(env);
  click(env, '[data-act="row-more"][data-id="1"]');
  const panel = panelOf(env);
  panel.contains = () => true;
  const note = panel.querySelector('[data-act="note-input"][data-id="1"]');
  note.value = 'a note';
  env.doc.activeElement = note;
  panel.dispatchEvent({ type: 'change', target: note });
  env.doc.activeElement = panel.querySelector('[data-act="row-more"][data-id="2"]');
  env.advanceTimersBy(0);
  assert.strictEqual(api.state.organizer.threads['1'].note, 'a note');
  assert.deepStrictEqual([lastFocus(env)['data-act'], lastFocus(env)['data-id']], ['row-more', '2']);
});

test('Enter in the filter field keeps focus in the field', () => {
  const { env, api } = bootNarrow();
  seedRows(api, [{ id: 1, title: 'alpha' }, { id: 2, title: 'beta' }]);
  redraw(env);
  const panel = panelOf(env);
  panel.contains = () => true;
  const filter = panel.querySelector('[data-act="filter"]');
  filter.value = 'alpha';
  env.doc.activeElement = filter;
  panel.dispatchEvent({ type: 'change', target: filter });
  env.advanceTimersBy(0);
  assert.strictEqual(api.state.searchQuery, 'alpha');
  assert.strictEqual(lastFocus(env)['data-act'], 'filter');
});

test('a deferred redraw that removes a row leaves the focus bookkeeping on the rows still shown', () => {
  // The caret in row 1's note defers a background redraw that drops row 2.
  // The DOM still shows row 2, so a tap on its Actions must still find row 3
  // as its successor, not fall through to the heading.
  const { env, api } = bootNarrow();
  seedRows(api, [{ id: 1 }, { id: 2 }, { id: 3 }]);
  api.state.settings.view = 'threads';
  api.state.settings.sort = 'title';
  redraw(env);
  click(env, '[data-act="row-more"][data-id="1"]');
  const panel = panelOf(env);
  panel.contains = () => true;
  env.doc.activeElement = panel.querySelector('[data-act="note-input"][data-id="1"]');
  seedRows(api, [{ id: 1 }, { id: 3 }]);
  const before = panel.renderCount;
  env.exports.draw(env.doc, env.win, api.makeHandlers(env.doc, env.win));
  assert.strictEqual(panel.renderCount, before, 'deferred by the caret');
  click(env, '[data-act="row-more"][data-id="2"]');
  assert.deepStrictEqual([lastFocus(env)['data-act'], lastFocus(env)['data-id']], ['row-more', '3']);
});
