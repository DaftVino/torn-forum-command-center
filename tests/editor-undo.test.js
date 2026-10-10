'use strict';

// #58 owner feedback, Batch E: Save as free draft (E1, the owner chose MOVE)
// and Undo (E2), driven through the mounted panel's delegated listeners.

const test = require('node:test');
const assert = require('node:assert');
const { loadUserscript, FORUMS_LOCATION } = require('./load-userscript');
const { panelOf, redraw, click } = require('./narrow-helpers');

const NOW = 1700000000000;
const THREAD = Object.assign({}, FORUMS_LOCATION, { hash: '#/p=threads&f=1&t=42&b=0&a=0' });

function bootEditor(opts) {
  const env = loadUserscript({ location: THREAD, now: NOW, panelWidth: opts.width || 900, panelPadding: 8, htmlQuery: true });
  const api = env.exports;
  api.state.route = api.parseForumRoute(env.win.location);
  api.state.settings.view = 'drafts';
  api.state.settings.draftLang = opts.lang || 'md';
  if (opts.text !== undefined) api.state.drafts = api.saveDraft(api.freshDrafts(), 42, opts.text, NOW - 5000, 'T', opts.lang || 'md');
  redraw(env);
  return { env, api };
}

const field = (env) => panelOf(env).querySelector('[data-act="draft-text"]');
const undoBtn = (env) => panelOf(env).querySelector('[data-act="ed-undo"]');
const isDisabled = (b) => b.hasAttribute ? b.hasAttribute('disabled') : b.getAttribute('disabled') !== null;

// The player types: the field's value changes and an input event reaches the panel.
function type(env, value) {
  const ta = field(env);
  assert.ok(ta, 'no draft textarea rendered');
  ta.value = value;
  ta.selectionStart = ta.selectionEnd = value.length;
  panelOf(env).dispatchEvent({ type: 'input', target: ta });
}

function highlight(env, start, end) {
  const ta = field(env);
  ta.selectionStart = start;
  ta.selectionEnd = end;
  panelOf(env).dispatchEvent({ type: 'mouseup', target: ta, button: 0 });
}

const threadDraft = (api) => api.draftFor(api.state.drafts, '42');
const freeIds = (api) => Object.keys(api.state.drafts.free || {});

// ---- E1: Save as free draft --------------------------------------------

test('E1: Save as free draft moves the editor text and mode to a new free draft and opens it', () => {
  const { env, api } = bootEditor({ text: 'stored', lang: 'html' });
  const before = JSON.parse(JSON.stringify(threadDraft(api)));
  type(env, 'stored and more typing');
  assert.strictEqual(api.state.editor.dirty, true);
  click(env, '[data-act="draft-to-free"][data-id="42"]');
  const ids = freeIds(api);
  assert.strictEqual(ids.length, 1);
  const made = api.state.drafts.free[ids[0]];
  assert.strictEqual(made.text, 'stored and more typing');
  assert.strictEqual(made.name, 'Untitled 1');
  assert.strictEqual(made.lang, 'html');
  assert.strictEqual(api.state.draftFocusId, ids[0]);
  const html = redraw(env);
  // The thread's stored draft is exactly as it was: the typing went with the free draft.
  assert.deepStrictEqual(threadDraft(api), before);
  assert.strictEqual(api.state.editor.key, ids[0]);
  assert.strictEqual(api.state.editor.text, 'stored and more typing');
  assert.strictEqual(api.state.editor.lang, 'html');
  assert.strictEqual(api.state.editor.dirty, false);
  assert.ok(api.state.notices.some((n) => n.kind === 'info' && /Untitled 1/.test(n.text)));
  // The free draft's pane has no Save as free draft button.
  assert.doesNotMatch(html, /data-act="draft-to-free"/);
  // It was persisted, not only held in memory.
  const stored = String(env.gmStore.get('tfcc:drafts'));
  assert.match(stored, /stored and more typing/);
});

test('E1: the editor is clean after the move, so switching back never writes the typing into the thread', () => {
  const { env, api } = bootEditor({ text: 'stored' });
  type(env, 'typed but unsaved');
  click(env, '[data-act="draft-to-free"][data-id="42"]');
  redraw(env);
  api.state.draftFocusId = null;
  redraw(env);
  assert.strictEqual(api.state.editor.key, '42');
  assert.strictEqual(api.state.editor.text, 'stored');
  assert.strictEqual(threadDraft(api).text, 'stored');
});

test('E1: the button shows on a thread draft only, after Delete, with its own class', () => {
  const { env } = bootEditor({ text: 'x' });
  const html = redraw(env);
  assert.match(html, /data-act="draft-delete" data-id="42">Delete<\/button><button type="button" data-act="draft-to-free" class="tfcc-tofree" data-id="42">Save as free draft<\/button><\/div>/);
  const narrow = bootEditor({ text: 'x', width: 343 });
  assert.match(redraw(narrow.env), /class="tfcc-tofree"/);
});

test('E1: at the free-draft limit it warns and changes nothing', () => {
  const { env, api } = bootEditor({ text: 'stored' });
  let full = api.state.drafts;
  for (let i = 0; i < api.FREE_DRAFTS_MAX; i += 1) full = api.newFreeDraft(full, NOW + i, 'md').drafts;
  api.state.drafts = full;
  redraw(env);
  type(env, 'typing');
  const before = JSON.stringify(api.state.drafts);
  click(env, '[data-act="draft-to-free"][data-id="42"]');
  assert.strictEqual(JSON.stringify(api.state.drafts), before);
  assert.strictEqual(api.state.draftFocusId, null);
  assert.strictEqual(api.state.editor.key, '42');
  assert.strictEqual(api.state.editor.text, 'typing');
  assert.strictEqual(api.state.editor.dirty, true);
  assert.ok(api.state.notices.some((n) => n.kind === 'warn' && /free drafts/.test(n.text)));
});

test('E1: an empty thread draft still makes a named, empty free draft', () => {
  const { env, api } = bootEditor({});
  click(env, '[data-act="draft-to-free"][data-id="42"]');
  const ids = freeIds(api);
  assert.strictEqual(ids.length, 1);
  assert.strictEqual(api.state.drafts.free[ids[0]].text, '');
  assert.strictEqual(api.state.drafts.free[ids[0]].name, 'Untitled 1');
  assert.strictEqual(threadDraft(api), null);
});

test('E1: the new free draft starts with nothing to undo', () => {
  const { env, api } = bootEditor({ text: 'hello' });
  highlight(env, 0, 5);
  click(env, '[data-act="ed-mark"][data-mark="bold"]');
  click(env, '[data-act="draft-to-free"][data-id="42"]');
  redraw(env);
  assert.strictEqual(api.state.editor.undo.length, 0);
  assert.ok(isDisabled(undoBtn(env)));
});

// ---- E2: Undo ------------------------------------------------------------

test('E2: Undo leads the toolbar and is disabled until there is something to undo', () => {
  const { env, api } = bootEditor({ text: 'hello' });
  const html = redraw(env);
  assert.match(html, /<div class="tfcc-tools" role="toolbar" aria-label="Formatting"><button type="button" data-act="ed-undo"[^>]*disabled>Undo<\/button>/);
  highlight(env, 0, 5);
  click(env, '[data-act="ed-mark"][data-mark="bold"]');
  redraw(env);
  assert.ok(!isDisabled(undoBtn(env)), 'enabled after an edit');
  click(env, '[data-act="ed-mode"][data-mode="preview"]');
  redraw(env);
  assert.ok(isDisabled(undoBtn(env)), 'disabled in Preview, like the rest of the toolbar');
  void api;
});

test('E2: Undo restores the text and selection before a toolbar edit, and saves', () => {
  const { env, api } = bootEditor({ text: 'hello' });
  highlight(env, 0, 5);
  click(env, '[data-act="ed-mark"][data-mark="bold"]');
  assert.strictEqual(api.state.editor.text, '**hello**');
  assert.strictEqual(threadDraft(api).text, '**hello**');
  redraw(env);
  click(env, '[data-act="ed-undo"]');
  assert.strictEqual(api.state.editor.text, 'hello');
  assert.deepStrictEqual([api.state.editor.selStart, api.state.editor.selEnd], [0, 5]);
  assert.strictEqual(threadDraft(api).text, 'hello', 'the undone text is saved like any edit');
  redraw(env);
  assert.ok(isDisabled(undoBtn(env)));
});

test('E2: Undo reverses a mode switch: the language and the text come back', () => {
  const { env, api } = bootEditor({ text: '**hi**' });
  click(env, '[data-act="ed-mode"][data-mode="html"]');
  assert.strictEqual(api.state.editor.lang, 'html');
  assert.notStrictEqual(api.state.editor.text, '**hi**');
  redraw(env);
  click(env, '[data-act="ed-undo"]');
  assert.strictEqual(api.state.editor.lang, 'md');
  assert.strictEqual(api.state.editor.text, '**hi**');
  assert.strictEqual(threadDraft(api).lang || 'md', 'md');
});

test('E2: in Text mode the toolbar is just Undo, and it reverses the confirmed switch to Text', () => {
  const { env, api } = bootEditor({ text: '**hi**' });
  click(env, '[data-act="ed-mode"][data-mode="text"]');
  redraw(env);
  click(env, '[data-act="ed-mode-confirm"]');
  assert.strictEqual(api.state.editor.lang, 'text');
  assert.strictEqual(api.state.editor.text, 'hi');
  const html = redraw(env);
  assert.match(html, /<div class="tfcc-tools" role="toolbar" aria-label="Formatting"><button type="button" data-act="ed-undo" aria-label="Undo the last change" title="Undo the last change">Undo<\/button><\/div>/);
  assert.doesNotMatch(html, /data-act="ed-mark"/);
  click(env, '[data-act="ed-undo"]');
  assert.strictEqual(api.state.editor.lang, 'md');
  assert.strictEqual(api.state.editor.text, '**hi**');
});

test('E2: a typing burst is one Undo step; a pause or another action starts the next', () => {
  const { env, api } = bootEditor({ text: '' });
  type(env, 'a'); type(env, 'ab'); type(env, 'abc');
  assert.strictEqual(api.state.editor.undo.length, 1, 'one snapshot for the burst');
  env.setNow(NOW + 400);
  type(env, 'abcd');
  assert.strictEqual(api.state.editor.undo.length, 1, 'a short pause is still the same burst');
  env.setNow(NOW + 2000);
  type(env, 'abcde');
  assert.strictEqual(api.state.editor.undo.length, 2, 'a pause over a second starts a new burst');
  click(env, '[data-act="ed-mode"][data-mode="md"]');
  type(env, 'abcdef');
  assert.strictEqual(api.state.editor.undo.length, 3, 'any other action ends the burst');
  redraw(env);
  click(env, '[data-act="ed-undo"]');
  assert.strictEqual(api.state.editor.text, 'abcde');
  redraw(env);
  click(env, '[data-act="ed-undo"]');
  assert.strictEqual(api.state.editor.text, 'abcd');
  redraw(env);
  click(env, '[data-act="ed-undo"]');
  assert.strictEqual(api.state.editor.text, '');
  assert.strictEqual(api.state.editor.dirty, true, 'an undo to empty is still the player\'s change');
});

test('E2: the Undo stack holds the last 50 steps', () => {
  const { env, api } = bootEditor({ text: '' });
  for (let i = 1; i <= 60; i += 1) {
    env.setNow(NOW + i * 5000);
    type(env, 'step ' + i);
  }
  assert.strictEqual(api.state.editor.undo.length, 50);
  for (let k = 0; k < 50; k += 1) {
    redraw(env);
    click(env, '[data-act="ed-undo"]');
  }
  // 60 bursts, each snapshotting the text before it: the oldest kept is the
  // text before burst 11, which is burst 10's.
  assert.strictEqual(api.state.editor.text, 'step 10');
  redraw(env);
  assert.ok(isDisabled(undoBtn(env)));
});

test('E2: opening a different draft clears the Undo stack', () => {
  const { env, api } = bootEditor({ text: 'hello' });
  highlight(env, 0, 5);
  click(env, '[data-act="ed-mark"][data-mark="bold"]');
  assert.strictEqual(api.state.editor.undo.length, 1);
  click(env, '[data-act="draft-new"]');
  redraw(env);
  assert.notStrictEqual(api.state.editor.key, '42');
  assert.strictEqual(api.state.editor.undo.length, 0);
  api.state.draftFocusId = null;
  redraw(env);
  assert.strictEqual(api.state.editor.key, '42');
  assert.strictEqual(api.state.editor.undo.length, 0, 'coming back is opening it again');
});

test('E2: Fix image links is one Undo step; a fix that changes nothing adds none', () => {
  const text = '![a](https://imgur.com/AbC12dE)';
  const { env, api } = bootEditor({ text });
  click(env, '[data-act="ed-fix-images"]');
  assert.notStrictEqual(api.state.editor.text, text);
  assert.strictEqual(api.state.editor.undo.length, 1);
  redraw(env);
  click(env, '[data-act="ed-fix-images"]');
  assert.strictEqual(api.state.editor.undo.length, 1, 'nothing left to fix, nothing to undo');
  redraw(env);
  click(env, '[data-act="ed-undo"]');
  assert.strictEqual(api.state.editor.text, text);
});
