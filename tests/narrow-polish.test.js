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

// ---- 2. one-line row text ----------------------------------------------------

test('only the row whose drawer is open carries tfcc-open, in every list view', () => {
  for (const view of ['threads', 'catchup', 'mine']) {
    const { env, api } = bootNarrow();
    seedRows(api, [{ id: 1, unread: 1 }, { id: 2, unread: 1 }]);
    api.state.settings.view = view;
    const ids = api.buildPanelModel(NOW).renderedIds;
    if (!ids.length) continue;
    api.state.openRowId = ids[0];
    const html = redraw(env);
    assert.match(html, new RegExp('<div class="tfcc-row tfcc-open" data-id="' + ids[0] + '">'), view);
    assert.strictEqual((html.match(/tfcc-row tfcc-open/g) || []).length, 1, view + ': one open row');
  }
  const { env, api } = bootNarrow();
  seedRows(api, [{ id: 1, unread: 1 }]);
  assert.doesNotMatch(redraw(env), /tfcc-open/, 'nothing open, nothing marked');
});

test('the title link keeps its whole text in the markup, so its accessible name is the full title', () => {
  const { env, api } = bootNarrow();
  const long = 'A thread with a deliberately very long title that has to be cut on a narrow phone';
  seedRows(api, [{ id: 1, title: long, unread: 1 }]);
  assert.match(redraw(env), new RegExp('data-tfcc-thread="1">' + long + '</a>'));
});

test('closed rows hold the title, tagline and meta to one line with an ellipsis; an open row shows them whole', () => {
  const { api } = bootNarrow();
  const oneLine = /white-space: nowrap; overflow: hidden; text-overflow: ellipsis/;
  // The title band stays a block of at least 24px: the truncation never cuts the tap target.
  const title = cssRule(api, '#tfcc-panel.tfcc-narrow .tfcc-row-t .tfcc-row-title a');
  assert.match(title, /display: block; padding: 3px 0; min-height: 24px;/);
  assert.match(title, oneLine);
  assert.match(cssRule(api, '#tfcc-panel.tfcc-narrow .tfcc-row > .tfcc-note'), oneLine);
  assert.match(cssRule(api, '#tfcc-panel.tfcc-narrow .tfcc-row-l2 .tfcc-meta'), oneLine);
  for (const sel of ['.tfcc-row-t .tfcc-row-title a', '> .tfcc-note', '.tfcc-row-l2 .tfcc-meta']) {
    assert.match(cssRule(api, '#tfcc-panel.tfcc-narrow .tfcc-row.tfcc-open ' + sel), /white-space: normal; overflow: visible;/, sel);
  }
});

// ---- 3. the close toggle and click-away ---------------------------------------

function openRow(extraEnv) {
  const { env, api } = bootNarrow({ env: extraEnv || {} });
  seedRows(api, [{ id: 1, title: 'One', unread: 1 }, { id: 2, title: 'Two', unread: 1 }, { id: 3, title: 'Three' }]);
  api.state.settings.view = 'threads';
  api.state.settings.sort = 'title';
  redraw(env);
  click(env, '[data-act="row-more"][data-id="1"]');
  assert.strictEqual(api.state.openRowId, '1', 'precondition: row 1 is open');
  return { env, api, panel: panelOf(env) };
}

test('dismiss closes the drawer and nothing else', () => {
  const { api } = bootNarrow();
  const edit = { id: '1', field: 'note-input', value: 'x', selStart: 1, selEnd: 1 };
  assert.deepStrictEqual(api.nextTransient({ openRowId: '1', filtersOpen: true, openInfoId: 'catchup', drawerEdit: edit },
    { type: 'dismiss' }), { openRowId: null, filtersOpen: true, openInfoId: 'catchup', drawerEdit: edit });
});

test('the toggle shows a close X while open, named Close actions, and the more glyph while closed', () => {
  const { panel } = openRow();
  const html = panel.innerHTML;
  assert.match(html, new RegExp('<button type="button" data-act="row-more" data-id="1" aria-expanded="true" aria-controls="tfcc-act-1" aria-label="Close actions"><svg class="tfcc-gl"[^>]*><path d="M6 6l12 12M18 6L6 18"/></svg></button>'));
  assert.match(html, /data-act="row-more" data-id="2" aria-expanded="false" aria-controls="tfcc-act-2" aria-label="Actions for Two"><svg class="tfcc-gl"[^>]*><path d="M5.5 12h1M11.5 12h1M17.5 12h1"\/>/);
});

test('tapping the X closes the drawer and keeps focus on the toggle', () => {
  const { env, api } = openRow();
  click(env, '[data-act="row-more"][data-id="1"]');
  assert.strictEqual(api.state.openRowId, null);
  assert.deepStrictEqual([lastFocus(env)['data-act'], lastFocus(env)['data-id'], lastFocus(env)['aria-label']],
    ['row-more', '1', 'Actions for One']);
});

test('opening another row closes the first', () => {
  const { env, api, panel } = openRow();
  click(env, '[data-act="row-more"][data-id="2"]');
  assert.strictEqual(api.state.openRowId, '2');
  assert.strictEqual((panel.innerHTML.match(/aria-label="Close actions"/g) || []).length, 1);
});

test('a control inside the open drawer keeps it open', () => {
  const { env, api, panel } = openRow();
  panel.contains = () => true;
  click(env, '[data-act="pin"][data-id="1"]');
  assert.strictEqual(api.state.openRowId, '1', 'Pin acts and the drawer stays');
  // The drawer's own blank space, and its stepper label, are inside it too.
  click(env, '[id="tfcc-act-1"]');
  click(env, '.tfcc-step');
  assert.strictEqual(api.state.openRowId, '1');
});

test('a tap elsewhere in the panel closes the drawer and still does its own job', () => {
  const { env, api } = openRow();
  click(env, '[data-act="unread-only"]');
  assert.strictEqual(api.state.openRowId, null, 'the drawer closed');
  assert.strictEqual(api.state.settings.unreadOnly, true, 'and Unread toggled');
  const again = openRow();
  click(again.env, '[data-act="view"][data-view="search"]');
  assert.strictEqual(again.api.state.openRowId, null);
  assert.strictEqual(again.api.state.settings.view, 'search', 'the view switched');
});

test('a tap on the open row outside its drawer, or on blank panel space, closes it', () => {
  const { env, api, panel } = openRow();
  const before = panel.renderCount;
  click(env, '.tfcc-row-l2');
  assert.strictEqual(api.state.openRowId, null);
  assert.strictEqual(panel.renderCount, before + 1, 'redrawn closed');
  assert.doesNotMatch(panel.innerHTML, /aria-label="Close actions"/);
  const again = openRow();
  click(again.env, '.tfcc-rows');
  assert.strictEqual(again.api.state.openRowId, null);
});

test('a thread link elsewhere closes the drawer after the click, never during it', () => {
  const { env, api, panel } = openRow();
  const before = panel.renderCount;
  const link = panel.querySelector('[data-tfcc-thread="2"]');
  panel.dispatchEvent({ type: 'click', target: link, button: 0 });
  assert.strictEqual(panel.renderCount, before, 'the anchor is still there while the browser follows it');
  assert.strictEqual(api.state.openRowId, null);
  env.advanceTimersBy(0);
  assert.strictEqual(panel.renderCount, before + 1);
  assert.doesNotMatch(panel.innerHTML, /aria-label="Close actions"/);
});

test('a dirty drawer field, then a tap elsewhere: commit, close and act in one redraw', () => {
  const { env, api, panel } = openRow();
  const note = panel.querySelector('[data-act="note-input"][data-id="1"]');
  note.value = 'typed note';
  const before = panel.renderCount;
  const cell = panel.querySelector('[data-act="view"][data-view="drafts"]');
  panel.dispatchEvent({ type: 'pointerdown', target: cell });
  panel.dispatchEvent({ type: 'change', target: note });
  env.advanceTimersBy(0);
  assert.strictEqual(panel.renderCount, before, 'held while the press is in progress');
  panel.dispatchEvent({ type: 'pointerup', target: cell });
  click(env, '[data-act="view"][data-view="drafts"]');
  env.advanceTimersBy(0);
  assert.strictEqual(panel.renderCount, before + 1, 'one visible redraw');
  assert.strictEqual(api.state.openRowId, null);
  assert.strictEqual(api.state.settings.view, 'drafts');
  assert.strictEqual(api.state.organizer.threads['1'].note, 'typed note');
});

test('a click outside the panel closes the drawer, without touching the event', () => {
  const { env, api, panel } = openRow();
  const outside = env.makeElement('a');
  panel.contains = (n) => n !== outside;
  const before = panel.renderCount;
  let prevented = 0;
  env.win.fire('click', { type: 'click', target: outside, preventDefault() { prevented += 1; },
    stopPropagation() { prevented += 1; }, stopImmediatePropagation() { prevented += 1; } });
  assert.strictEqual(prevented, 0, 'Torn\'s own link keeps its click');
  assert.strictEqual(api.state.openRowId, null);
  env.advanceTimersBy(0);
  assert.strictEqual(panel.renderCount, before + 1);
  assert.doesNotMatch(panel.innerHTML, /aria-label="Close actions"/);
});

test('the window listener ignores clicks inside the panel and does nothing when no drawer is open', () => {
  const { env, api, panel } = openRow();
  panel.contains = () => true;
  env.win.fire('click', { type: 'click', target: panel });
  assert.strictEqual(api.state.openRowId, '1', 'the panel\'s own listener decides');
  click(env, '[data-act="row-more"][data-id="1"]');
  panel.contains = () => false;
  const before = panel.renderCount;
  env.win.fire('click', { type: 'click', target: env.makeElement('a') });
  env.advanceTimersBy(0);
  assert.strictEqual(panel.renderCount, before, 'no drawer, no redraw');
});

test('the click-away listener is bound once, in the capture phase, and checks only the panel', () => {
  const { env } = openRow();
  for (let i = 0; i < 3; i += 1) redraw(env);
  assert.strictEqual((env.win.listeners.click || []).length, 1);
  const src = require('./load-userscript').readSource();
  assert.match(src, /win\.addEventListener\('click', function \(ev\) \{ closeDrawerFromOutside\(ev\); \}, true\);/);
  const body = /function closeDrawerFromOutside\(ev\) \{[\s\S]*?\n {2}\}/.exec(src)[0];
  assert.doesNotMatch(body, /preventDefault|stopPropagation|querySelector/);
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
