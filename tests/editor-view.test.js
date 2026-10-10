'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { loadUserscript, FORUMS_LOCATION } = require('./load-userscript');

const NOW = 1700000000000;
const THREAD = Object.assign({}, FORUMS_LOCATION, { hash: '#/p=threads&f=1&t=42&b=0&a=0' });
const el = (attrs) => ({ getAttribute: (k) => (attrs[k] === undefined ? null : attrs[k]) });

function drafts(env) {
  const api = env.exports;
  api.state.route = api.parseForumRoute(env.win.location);
  api.state.settings.view = 'drafts';
  return api;
}

test('a new thread draft opens in the Default editor mode', () => {
  const env = loadUserscript({ location: THREAD, now: NOW });
  const api = drafts(env);
  api.state.settings.draftLang = 'html';
  const html = api.panelHtml(api.buildPanelModel(NOW));
  assert.match(html, /data-act="ed-mode" data-mode="html" aria-pressed="true"/);
  assert.match(html, /<textarea class="tfcc-draft" data-act="draft-text" data-id="42"/);
});

test('an old draft holding raw HTML opens as Text, and Preview shows the tags (Review Focus 5)', () => {
  const env = loadUserscript({ location: THREAD, now: NOW });
  const api = drafts(env);
  api.state.drafts = api.normaliseDrafts({ v: 1, byThread: { 42: { text: '<p><strong>bold</strong> test</p>', updatedAt: 1, title: 'T' } } });
  api.state.settings.draftLang = 'md';
  api.panelHtml(api.buildPanelModel(NOW)); // loads the draft into the editor
  const h = api.makeHandlers(env.doc, env.win);
  h.onAction('ed-mode', el({ 'data-act': 'ed-mode', 'data-mode': 'preview' }));
  const html = api.panelHtml(api.buildPanelModel(NOW));
  assert.strictEqual(api.state.editor.lang, 'text');
  assert.match(html, /data-act="ed-mode" data-mode="text" aria-pressed="false"/);
  assert.match(html, /&lt;strong&gt;bold&lt;\/strong&gt;/);
  assert.doesNotMatch(html, /<strong>bold<\/strong>/);
});

test('switching MD to HTML converts the text; switching to Text asks first', () => {
  const env = loadUserscript({ location: THREAD, now: NOW });
  const api = drafts(env);
  api.state.settings.draftLang = 'md';
  api.panelHtml(api.buildPanelModel(NOW));
  const h = api.makeHandlers(env.doc, env.win);
  h.onInput('draft-text', Object.assign(el({ 'data-act': 'draft-text', 'data-id': '42' }), { value: '**b**', selectionStart: 5, selectionEnd: 5 }));
  h.onAction('ed-mode', el({ 'data-act': 'ed-mode', 'data-mode': 'html' }));
  assert.strictEqual(api.state.editor.lang, 'html');
  assert.strictEqual(api.state.editor.text, '<p><strong>b</strong></p>');
  h.onAction('ed-mode', el({ 'data-act': 'ed-mode', 'data-mode': 'text' }));
  assert.strictEqual(api.state.editor.lang, 'html', 'not yet');
  assert.match(api.panelHtml(api.buildPanelModel(NOW)), /Plain text drops the formatting/);
  h.onAction('ed-mode-confirm', el({ 'data-act': 'ed-mode-confirm' }));
  assert.strictEqual(api.state.editor.lang, 'text');
  assert.strictEqual(api.state.editor.text, 'b');
});

test('Preview renders cleaned blocks that jump back to their source line', () => {
  const env = loadUserscript({ location: THREAD, now: NOW });
  const api = drafts(env);
  api.state.drafts = api.saveDraft(api.freshDrafts(), 42, '# T\nline <img src=x onerror=alert(1)>', NOW, 'T', 'md');
  api.panelHtml(api.buildPanelModel(NOW)); // loads the draft into the editor
  const h = api.makeHandlers(env.doc, env.win);
  h.onAction('ed-mode', el({ 'data-act': 'ed-mode', 'data-mode': 'preview' }));
  const html = api.panelHtml(api.buildPanelModel(NOW));
  assert.match(html, /class="tfcc-pv-block" data-act="ed-jump" data-offset="0"/);
  assert.match(html, /data-act="ed-jump" data-offset="4"/);
  // The All drafts list quotes the source as escaped text, so look only at
  // the Preview pane, and at live markup anywhere.
  const pane = html.slice(html.indexOf('class="tfcc-pv '), html.indexOf('data-act="draft-save"'));
  assert.doesNotMatch(pane, /onerror/);
  assert.doesNotMatch(html, /<img[^>]*onerror/);
  h.onAction('ed-jump', el({ 'data-act': 'ed-jump', 'data-offset': '4' }));
  assert.strictEqual(api.state.editor.mode, 'source');
  assert.deepStrictEqual([api.state.editor.selStart, api.state.editor.selEnd], [4, 4]);
});

test('+ New draft makes a free draft and opens it; Insert uses the editor\'s text', () => {
  const env = loadUserscript({ location: FORUMS_LOCATION, now: NOW });
  const api = drafts(env);
  const h = api.makeHandlers(env.doc, env.win);
  h.onAction('draft-new', el({ 'data-act': 'draft-new' }));
  const key = api.state.draftFocusId;
  assert.match(key, /^n[0-9]+$/);
  api.panelHtml(api.buildPanelModel(NOW));
  assert.strictEqual(api.state.editor.key, key);
  h.onInput('draft-text', Object.assign(el({ 'data-act': 'draft-text', 'data-id': key }), { value: '{red}hi{/}', selectionStart: 0, selectionEnd: 0 }));
  assert.strictEqual(api.editorPostHtml(), '<p><span style="color: var(--te-text-color-red);">hi</span></p>');
  h.onAction('draft-save', el({ 'data-act': 'draft-save', 'data-id': key }));
  assert.strictEqual(api.draftFor(api.state.drafts, key).text, '{red}hi{/}');
  assert.strictEqual(api.draftFor(api.state.drafts, key).lang, 'md');
  const list = api.panelHtml(api.buildPanelModel(NOW));
  assert.match(list, /tfcc-free/);
  assert.match(list, /data-act="draft-edit" data-id="n/);
  // Insert sends the editor's converted post to Torn's editor.
  const pasted = [];
  const box = env.makeElement('div');
  box.getBoundingClientRect = () => ({ width: 600, height: 160 });
  box.addEventListener('paste', (ev) => { pasted.push(ev.clipboardData.getData('text/html')); ev.preventDefault(); box.innerHTML += 'x'; });
  env.doc.querySelectorAll = (sel) => (sel === '#editor-wrapper .editor-content.mce-content-body' ? [box] : []);
  h.onAction('draft-insert', el({ 'data-act': 'draft-insert', 'data-id': key }));
  assert.deepStrictEqual(pasted, ['<!-- x-tinymce/html --><p><span style="color: var(--te-text-color-red);">hi</span></p>']);
});

test('opening another draft after typing, without Save, keeps what was typed', () => {
  const env = loadUserscript({ location: FORUMS_LOCATION, now: NOW });
  const api = drafts(env);
  const h = api.makeHandlers(env.doc, env.win);
  h.onAction('draft-new', el({ 'data-act': 'draft-new' }));
  const first = api.state.draftFocusId;
  api.panelHtml(api.buildPanelModel(NOW));
  h.onInput('draft-text', Object.assign(el({ 'data-act': 'draft-text', 'data-id': first }), { value: 'unsaved words', selectionStart: 0, selectionEnd: 0 }));
  h.onAction('draft-new', el({ 'data-act': 'draft-new' }));
  api.panelHtml(api.buildPanelModel(NOW));
  assert.notStrictEqual(api.state.editor.key, first);
  assert.strictEqual(api.draftFor(api.state.drafts, first).text, 'unsaved words');
});

test('a switch that would pass the draft limit is refused, and the draft is unchanged', () => {
  const env = loadUserscript({ location: THREAD, now: NOW });
  const api = drafts(env);
  api.panelHtml(api.buildPanelModel(NOW));
  const h = api.makeHandlers(env.doc, env.win);
  const big = ':grin:\n'.repeat(2500); // 17500 characters, about 100000 as HTML
  h.onInput('draft-text', Object.assign(el({ 'data-act': 'draft-text', 'data-id': '42' }), { value: big, selectionStart: 0, selectionEnd: 0 }));
  h.onAction('ed-mode', el({ 'data-act': 'ed-mode', 'data-mode': 'html' }));
  assert.strictEqual(api.state.editor.lang, 'md');
  assert.strictEqual(api.state.editor.text, big);
  assert.ok(api.state.notices.some((n) => /over the 20000 limit/.test(n.text)));
});

test('Preview shows a placeholder for an external image until Show images', () => {
  const env = loadUserscript({ location: THREAD, now: NOW });
  const api = drafts(env);
  api.state.drafts = api.saveDraft(api.freshDrafts(), 42, '![a](https://i.imgur.com/x.png) :grin:', NOW, 'T', 'md');
  api.panelHtml(api.buildPanelModel(NOW));
  const h = api.makeHandlers(env.doc, env.win);
  h.onAction('ed-mode', el({ 'data-act': 'ed-mode', 'data-mode': 'preview' }));
  let html = api.panelHtml(api.buildPanelModel(NOW));
  assert.doesNotMatch(html, /src="https:\/\/i\.imgur\.com/);
  assert.match(html, /\[image from i\.imgur\.com\]/);
  assert.match(html, /src="\/images\/emotions\/svg\/grin\.svg"/, 'Torn emoji always show');
  h.onAction('ed-pv-images', el({ 'data-act': 'ed-pv-images' }));
  html = api.panelHtml(api.buildPanelModel(NOW));
  assert.match(html, /<img referrerpolicy="no-referrer" src="https:\/\/i\.imgur\.com\/x\.png"/);
});

test('a dirty editor keeps its text when the stored draft changes behind it', () => {
  const env = loadUserscript({ location: THREAD, now: NOW });
  const api = drafts(env);
  api.panelHtml(api.buildPanelModel(NOW));
  const h = api.makeHandlers(env.doc, env.win);
  h.onInput('draft-text', Object.assign(el({ 'data-act': 'draft-text', 'data-id': '42' }), { value: 'typed', selectionStart: 5, selectionEnd: 5 }));
  // Autosave from Torn's editor, or an import, replaces the stored draft.
  api.state.drafts = api.saveDraft(api.freshDrafts(), 42, '<p>autosaved</p>', NOW + 1, 'T', 'html');
  api.buildPanelModel(NOW);
  assert.strictEqual(api.state.editor.text, 'typed');
  assert.strictEqual(api.state.editor.dirty, true);
});

test('deleting a free draft removes it from the free drafts', () => {
  const env = loadUserscript({ location: FORUMS_LOCATION, now: NOW });
  const api = drafts(env);
  const h = api.makeHandlers(env.doc, env.win);
  h.onAction('draft-new', el({ 'data-act': 'draft-new' }));
  const key = api.state.draftFocusId;
  api.panelHtml(api.buildPanelModel(NOW));
  h.onInput('draft-text', Object.assign(el({ 'data-act': 'draft-text', 'data-id': key }), { value: 'unsaved', selectionStart: 0, selectionEnd: 0 }));
  h.onAction('draft-delete', el({ 'data-act': 'draft-delete', 'data-id': key }));
  assert.strictEqual(api.draftFor(api.state.drafts, key), null);
  assert.ok(!Object.prototype.hasOwnProperty.call(api.state.drafts.free || {}, key));
  assert.strictEqual(api.state.draftFocusId, null);
  const html = api.panelHtml(api.buildPanelModel(NOW));
  assert.strictEqual(api.state.editor.key, null);
  assert.strictEqual(api.draftFor(api.state.drafts, key), null, 'the dirty text is not saved back');
  assert.doesNotMatch(html, /data-act="draft-text"/);
});

test('deleting the open thread draft closes it without saving the typed text back', () => {
  const env = loadUserscript({ location: THREAD, now: NOW });
  const api = drafts(env);
  api.state.drafts = api.saveDraft(api.freshDrafts(), 42, 'saved', NOW, 'T', 'md');
  api.state.draftFocusId = '42';
  api.panelHtml(api.buildPanelModel(NOW));
  const h = api.makeHandlers(env.doc, env.win);
  h.onInput('draft-text', Object.assign(el({ 'data-act': 'draft-text', 'data-id': '42' }), { value: 'typed more', selectionStart: 0, selectionEnd: 0 }));
  h.onAction('draft-delete', el({ 'data-act': 'draft-delete', 'data-id': '42' }));
  assert.strictEqual(api.state.draftFocusId, null);
  api.buildPanelModel(NOW);
  assert.strictEqual(api.draftFor(api.state.drafts, 42), null, 'the dirty text is not saved back');
  assert.strictEqual(api.state.editor.text, '');
  assert.strictEqual(api.state.editor.dirty, false);
});

test('+ New draft at the free-draft limit warns and changes nothing', () => {
  const env = loadUserscript({ location: FORUMS_LOCATION, now: NOW });
  const api = drafts(env);
  let d = api.freshDrafts();
  let first = null;
  for (let i = 0; i < api.FREE_DRAFTS_MAX; i += 1) {
    const made = api.newFreeDraft(d, NOW + i, 'md');
    d = made.drafts;
    if (!first) first = made.id;
  }
  api.state.drafts = d;
  api.state.draftFocusId = first;
  const h = api.makeHandlers(env.doc, env.win);
  h.onAction('draft-new', el({ 'data-act': 'draft-new' }));
  assert.strictEqual(Object.keys(api.state.drafts.free).length, api.FREE_DRAFTS_MAX);
  assert.strictEqual(api.state.draftFocusId, first);
  assert.ok(api.state.notices.some((n) => n.kind === 'warn' && /You have 100 free drafts/.test(n.text)));
});

test('typing past the draft limit keeps the limit and says so once per crossing', () => {
  const env = loadUserscript({ location: THREAD, now: NOW });
  const api = drafts(env);
  api.panelHtml(api.buildPanelModel(NOW));
  const h = api.makeHandlers(env.doc, env.win);
  const type = (v) => h.onInput('draft-text', Object.assign(el({ 'data-act': 'draft-text', 'data-id': '42' }), { value: v, selectionStart: 0, selectionEnd: 0 }));
  const warned = () => api.state.notices.filter((n) => n.kind === 'warn' && /at the 20000-character limit; anything past it was not added/.test(n.text)).length;
  type('a'.repeat(19999));
  assert.strictEqual(warned(), 0);
  type('a'.repeat(20500));
  assert.strictEqual(api.state.editor.text.length, 20000);
  assert.strictEqual(warned(), 1);
  type('a'.repeat(20000));
  assert.strictEqual(warned(), 1, 'not on every keystroke at the limit');
  type('a'.repeat(19990));
  type('a'.repeat(20001));
  assert.strictEqual(warned(), 2, 'again after dropping below and crossing again');
  assert.match(api.panelHtml(api.buildPanelModel(NOW)), /at the 20000-character limit/);
});
