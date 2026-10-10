'use strict';

// #58 owner feedback, Batch B: the editor bugs, driven through the mounted
// panel's own delegated listeners (tests/narrow-helpers.js), so the event
// wiring is under test and not only the handlers.

const test = require('node:test');
const assert = require('node:assert');
const { loadUserscript, FORUMS_LOCATION } = require('./load-userscript');
const { panelOf, redraw, click } = require('./narrow-helpers');

const NOW = 1700000000000;
const THREAD = Object.assign({}, FORUMS_LOCATION, { hash: '#/p=threads&f=1&t=42&b=0&a=0' });

// A thread draft open in the Drafts view of a mounted panel. width 900 is a
// wide panel, 343 a phone.
function bootEditor(opts) {
  const env = loadUserscript({ location: THREAD, now: NOW, panelWidth: opts.width || 900, panelPadding: 8, htmlQuery: true });
  const api = env.exports;
  api.state.route = api.parseForumRoute(env.win.location);
  api.state.settings.view = 'drafts';
  api.state.settings.draftLang = opts.lang || 'md';
  if (opts.text) api.state.drafts = api.saveDraft(api.freshDrafts(), 42, opts.text, NOW, 'T', opts.lang || 'md');
  redraw(env);
  return { env, api };
}

const field = (env) => panelOf(env).querySelector('[data-act="draft-text"]');

// The player highlights a range with the mouse or keyboard: the textarea's
// selection moves and an event that is not `input` reaches the panel.
function highlight(env, start, end, type) {
  const ta = field(env);
  assert.ok(ta, 'no draft textarea rendered');
  ta.selectionStart = start;
  ta.selectionEnd = end;
  panelOf(env).dispatchEvent({ type: type || 'mouseup', target: ta, button: 0 });
  return ta;
}

// ---- B1: a tap anywhere in Preview -------------------------------------

test('B1: a tap on an element inside a Preview block returns to the source at that block', () => {
  const { env, api } = bootEditor({ text: '# Title\nsome **bold** words' });
  click(env, '[data-act="ed-mode"][data-mode="preview"]');
  redraw(env);
  assert.strictEqual(api.state.editor.mode, 'preview');
  const block = panelOf(env).querySelector('[data-offset="8"]');
  assert.ok(block, 'the second block renders');
  // The tap lands on the <strong> inside the block's <p>, not on the block.
  const p = { tagName: 'P', getAttribute: () => null, parentNode: block };
  const strong = { tagName: 'STRONG', getAttribute: () => null, parentNode: p };
  panelOf(env).dispatchEvent({ type: 'click', target: strong, button: 0 });
  assert.strictEqual(api.state.editor.mode, 'source');
  assert.deepStrictEqual([api.state.editor.selStart, api.state.editor.selEnd], [8, 8]);
  assert.match(redraw(env), /<textarea class="tfcc-draft"/);
});

test('B1: a tap on the empty Preview area returns to the end of the text; a link inside is left alone', () => {
  const text = 'one\n\ntwo [site](https://example.com)';
  const { env, api } = bootEditor({ text });
  click(env, '[data-act="ed-mode"][data-mode="preview"]');
  redraw(env);
  const block = panelOf(env).querySelector('.tfcc-pv-block');
  const link = { tagName: 'A', getAttribute: (k) => (k === 'href' ? 'https://example.com' : null), parentNode: block };
  panelOf(env).dispatchEvent({ type: 'click', target: link, button: 0 });
  assert.strictEqual(api.state.editor.mode, 'preview', 'the browser follows the link; the preview stays');
  const area = panelOf(env).querySelector('.tfcc-pv');
  assert.ok(area);
  panelOf(env).dispatchEvent({ type: 'click', target: area, button: 0 });
  assert.strictEqual(api.state.editor.mode, 'source');
  assert.deepStrictEqual([api.state.editor.selStart, api.state.editor.selEnd], [text.length, text.length]);
});

test('B1: a tap on a node with no data-act outside the Preview still does nothing', () => {
  const { env, api } = bootEditor({ text: 'abc' });
  const before = api.state.editor.mode;
  const heading = panelOf(env).querySelector('h4');
  assert.ok(heading);
  panelOf(env).dispatchEvent({ type: 'click', target: heading, button: 0 });
  assert.strictEqual(api.state.editor.mode, before);
});

// ---- B2: the highlighted selection, not the last typed caret ------------

test('B2: a mouse selection made without typing is what Bold uses', () => {
  const { env, api } = bootEditor({ text: 'one\ntwo\nthree' });
  highlight(env, 4, 7, 'mouseup');
  click(env, '[data-act="ed-mark"][data-mark="bold"]');
  assert.strictEqual(api.state.editor.text, 'one\n**two**\nthree');
});

test('B2: a keyboard or Select-all selection is mirrored too (keyup, select)', () => {
  const { env, api } = bootEditor({ text: 'one\ntwo\nthree' });
  highlight(env, 0, 3, 'keyup');
  assert.deepStrictEqual([api.state.editor.selStart, api.state.editor.selEnd], [0, 3]);
  highlight(env, 0, 13, 'select');
  assert.deepStrictEqual([api.state.editor.selStart, api.state.editor.selEnd], [0, 13]);
});

test('B2: after the More redraw on a phone, Quote and Align use the highlighted lines', () => {
  const { env, api } = bootEditor({ width: 343, text: 'one\ntwo\nthree' });
  // Typing leaves the caret at the end; the player then highlights line one.
  assert.deepStrictEqual([api.state.editor.selStart, api.state.editor.selEnd], [13, 13]);
  highlight(env, 0, 3, 'touchend');
  click(env, '[data-act="ed-more"]');
  redraw(env);
  // The redraw rendered a fresh textarea; its own selection means nothing.
  const fresh = field(env);
  fresh.value = api.state.editor.text; fresh.selectionStart = 13; fresh.selectionEnd = 13;
  click(env, '[data-act="ed-quote"]');
  assert.strictEqual(api.state.editor.text, '> one\ntwo\nthree');

  const b = bootEditor({ width: 343, text: 'one\ntwo\nthree' });
  highlight(b.env, 4, 7, 'mouseup');
  click(b.env, '[data-act="ed-more"]');
  redraw(b.env);
  click(b.env, '[data-act="ed-picker"][data-picker="align"]');
  redraw(b.env);
  click(b.env, '[data-act="ed-align"][data-value="center"]');
  assert.strictEqual(b.api.state.editor.text, 'one\n:::center\ntwo\n:::\nthree');
});

test('B2: a focused textarea\'s live selection still wins at click time', () => {
  const { env, api } = bootEditor({ text: 'one\ntwo\nthree' });
  highlight(env, 0, 3, 'mouseup');
  const ta = field(env);
  ta.value = api.state.editor.text;
  ta.focus();
  ta.selectionStart = 8; ta.selectionEnd = 13;
  click(env, '[data-act="ed-mark"][data-mark="italic"]');
  assert.strictEqual(api.state.editor.text, 'one\ntwo\n*three*');
});

// ---- B3/B4 through the toolbar ------------------------------------------

test('B4: Align on a body row of a headerless Markdown table warns and changes nothing', () => {
  const text = '| 1 | 2 |\n| 3 | 4 |';
  const { env, api } = bootEditor({ text });
  highlight(env, 12, 12, 'mouseup');
  click(env, '[data-act="ed-picker"][data-picker="align"]');
  redraw(env);
  click(env, '[data-act="ed-align"][data-value="right"]');
  assert.strictEqual(api.state.editor.text, text);
  assert.ok(api.state.notices.some((n) => n.kind === 'warn' && n.text === 'Add a header row to align a Markdown table.'));
  assert.strictEqual(api.state.editor.picker, null);
});

test('B4: Align on a body row of an HTML table aligns every cell of it', () => {
  const text = '<table><tbody><tr><th>A</th></tr><tr><td>1</td></tr></tbody></table>';
  const { env, api } = bootEditor({ text, lang: 'html' });
  highlight(env, text.indexOf('<td>') + 4, text.indexOf('<td>') + 4, 'mouseup');
  click(env, '[data-act="ed-picker"][data-picker="align"]');
  redraw(env);
  click(env, '[data-act="ed-align"][data-value="center"]');
  assert.strictEqual(api.state.editor.text,
    '<table><tbody><tr><th style="text-align: center;">A</th></tr><tr><td style="text-align: center;">1</td></tr></tbody></table>');
});

// ---- B5: the dragged height survives redraws ----------------------------

function dragTo(env, from, to, endOnWindow) {
  const ta = field(env);
  let h = from;
  ta.getBoundingClientRect = () => ({ width: 300, height: h });
  panelOf(env).dispatchEvent({ type: 'pointerdown', target: ta, button: 0 });
  h = to;
  if (endOnWindow) env.win.fire('pointerup', { type: 'pointerup', target: env.doc.body });
  else panelOf(env).dispatchEvent({ type: 'pointerup', target: ta, button: 0 });
}

test('B5: a dragged editor height is kept across toolbar, picker and mode redraws', () => {
  const { env, api } = bootEditor({ text: 'hello' });
  assert.match(redraw(env), /data-act="draft-text"[^>]*style="height: 260px;"/, "the Settings default (desktop Large) until the player drags");
  dragTo(env, 120, 333);
  assert.strictEqual(api.state.editor.height, 333);
  click(env, '[data-act="ed-mark"][data-mark="bold"]');
  assert.match(redraw(env), /aria-label="Draft text" style="height: 333px;">/);
  click(env, '[data-act="ed-picker"][data-picker="emoji"]');
  assert.match(redraw(env), /style="height: 333px;"/);
  click(env, '[data-act="ed-mode"][data-mode="preview"]');
  redraw(env);
  click(env, '[data-act="ed-mode"][data-mode="md"]');
  assert.match(redraw(env), /aria-label="Draft text" style="height: 333px;">/);
});

test('B5: a plain tap in the textarea records nothing; a drag that ends off the panel still counts', () => {
  const { env, api } = bootEditor({ text: 'hello' });
  dragTo(env, 120, 120);
  assert.strictEqual(api.state.editor.height, null);
  dragTo(env, 120, 300, true);
  assert.strictEqual(api.state.editor.height, 300);
});

test('B5: a failed measurement keeps the current height', () => {
  const { env, api } = bootEditor({ text: 'hello' });
  dragTo(env, 120, 333);
  const ta = field(env);
  ta.getBoundingClientRect = () => { throw new Error('detached'); };
  panelOf(env).dispatchEvent({ type: 'pointerdown', target: ta, button: 0 });
  panelOf(env).dispatchEvent({ type: 'pointerup', target: ta, button: 0 });
  assert.strictEqual(api.state.editor.height, 333);
});

test('B5: opening another draft starts at the default height again', () => {
  const { env, api } = bootEditor({ text: 'hello' });
  dragTo(env, 120, 333);
  click(env, '[data-act="draft-new"]');
  const html = redraw(env);
  assert.notStrictEqual(api.state.editor.key, '42');
  assert.strictEqual(api.state.editor.height, null);
  assert.match(html, /data-act="draft-text"[^>]*style="height: 260px;"/);
});
