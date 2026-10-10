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
  // Only the latest notice is kept, so count each crossing by reading and clearing it.
  let total = 0;
  const warned = () => {
    total += api.state.notices.filter((n) => n.kind === 'warn' && /at the 20000-character limit; anything past it was not added/.test(n.text)).length;
    api.state.notices = [];
    return total;
  };
  type('a'.repeat(19999));
  assert.strictEqual(warned(), 0);
  type('a'.repeat(20500));
  assert.strictEqual(api.state.editor.text.length, 20000);
  assert.strictEqual(warned(), 1);
  type('a'.repeat(20000));
  assert.strictEqual(warned(), 1, 'not on every keystroke at the limit');
  type('a'.repeat(19990));
  type('a'.repeat(20001));
  assert.match(api.panelHtml(api.buildPanelModel(NOW)), /at the 20000-character limit/);
  assert.strictEqual(warned(), 2, 'again after dropping below and crossing again');
});

// ---- Task 11: toolbar and pickers ----------------------------------------

function editorAt(text, lang, sel) {
  const env = loadUserscript({ location: THREAD, now: NOW });
  const api = drafts(env);
  api.state.settings.draftLang = lang;
  api.panelHtml(api.buildPanelModel(NOW));
  // No panel is mounted in the harness, so captureSelection finds no field and
  // keeps the selection the editor state already holds: the one set here.
  Object.assign(api.state.editor, { text, selStart: sel[0], selEnd: sel[1] });
  return { env, api, h: api.makeHandlers(env.doc, env.win) };
}

test('Bold wraps the selection in the draft\'s language', () => {
  const { api, h } = editorAt('hello world', 'md', [6, 11]);
  h.onAction('ed-mark', el({ 'data-act': 'ed-mark', 'data-mark': 'bold' }));
  assert.strictEqual(api.state.editor.text, 'hello **world**');
});

test('a color from the picker wraps the selection it was opened on', () => {
  const { api, h } = editorAt('hi there', 'html', [3, 8]);
  h.onAction('ed-picker', el({ 'data-act': 'ed-picker', 'data-picker': 'color' }));
  h.onAction('ed-color', el({ 'data-act': 'ed-color', 'data-value': 'red' }));
  assert.strictEqual(api.state.editor.text, 'hi <span style="color: var(--te-text-color-red);">there</span>');
  assert.strictEqual(api.state.editor.picker, null);
});

// A picker field typed into: the panel's input event, as the browser sends it.
const typeInto = (h, act, value) => h.onInput(act, Object.assign(el({ 'data-act': act }), { value }));

test('a near-invisible custom color asks once, keeps the typed hex across the redraw, then applies', () => {
  const { api, h } = editorAt('x', 'md', [0, 1]);
  h.onAction('ed-picker', el({ 'data-act': 'ed-picker', 'data-picker': 'color' }));
  typeInto(h, 'ed-hex-input', '#ffd43b');
  h.onAction('ed-color', el({ 'data-act': 'ed-color', 'data-value': 'custom' }));
  const html = api.panelHtml(api.buildPanelModel(NOW));
  assert.match(html, /This color may be hard to see on Torn(&#39;|')s light theme\./);
  assert.match(html, /data-act="ed-hex-input"[^>]*value="#ffd43b"/, 'the redraw keeps what was typed');
  assert.strictEqual(api.state.editor.text, 'x');
  h.onAction('ed-color', el({ 'data-act': 'ed-color', 'data-value': 'custom' }));
  assert.strictEqual(api.state.editor.text, '{#ffd43b}x{/}');
});

test('picker fields are read from the editor state, never from the page', () => {
  const { env, api, h } = editorAt('x', 'md', [0, 1]);
  // Torn's page (or another script) holding an element with the same data-act
  // must not be read.
  env.doc.querySelector = (s) => (s === '[data-act="ed-link-input"]' ? { value: 'https://evil.example/' } : null);
  h.onAction('ed-picker', el({ 'data-act': 'ed-picker', 'data-picker': 'link' }));
  typeInto(h, 'ed-link-input', 'https://a.b');
  h.onAction('ed-link-apply', el({ 'data-act': 'ed-link-apply' }));
  assert.strictEqual(api.state.editor.text, '[x](https://a.b)');
});

test('a toolbar edit that would pass the draft limit is refused', () => {
  const { api, h } = editorAt('y'.repeat(19995), 'md', [0, 19995]);
  h.onAction('ed-mark', el({ 'data-act': 'ed-mark', 'data-mark': 'bold' }));
  h.onAction('ed-mark', el({ 'data-act': 'ed-mark', 'data-mark': 'bold' }));
  h.onAction('ed-mark', el({ 'data-act': 'ed-mark', 'data-mark': 'bold' }));
  assert.ok(api.state.editor.text.length <= api.DRAFT_MAX_CHARS);
  assert.ok(api.state.notices.some((n) => /over the 20000 limit/.test(n.text)));
});

test('the image picker fixes a Drive link and inserts it; a page link shows how to fix it', () => {
  const { api, h } = editorAt('', 'md', [0, 0]);
  h.onAction('ed-picker', el({ 'data-act': 'ed-picker', 'data-picker': 'image' }));
  typeInto(h, 'ed-img-url', 'https://drive.google.com/file/d/1GfhII9A5yDKVLFVv0F1SEPivpxvREb-h/view?usp=sharing');
  typeInto(h, 'ed-img-alt', 'pic');
  h.onAction('ed-img-check', el({ 'data-act': 'ed-img-check' }));
  const html = api.panelHtml(api.buildPanelModel(NOW));
  assert.match(html, /thumbnail\?id=1GfhII9A5yDKVLFVv0F1SEPivpxvREb-h&amp;sz=w1000/);
  assert.match(html, /Anyone with the link/);
  h.onAction('ed-img-insert', el({ 'data-act': 'ed-img-insert' }));
  assert.strictEqual(api.state.editor.text, '![pic](https://drive.google.com/thumbnail?id=1GfhII9A5yDKVLFVv0F1SEPivpxvREb-h&sz=w1000)');
  h.onAction('ed-picker', el({ 'data-act': 'ed-picker', 'data-picker': 'image' }));
  typeInto(h, 'ed-img-url', 'https://ibb.co/8P0808s');
  h.onAction('ed-img-check', el({ 'data-act': 'ed-img-check' }));
  const html2 = api.panelHtml(api.buildPanelModel(NOW));
  assert.match(html2, /Direct link/);
  assert.doesNotMatch(html2, /data-act="ed-img-insert"/);
  assert.match(html2, /Insert Image button/);
});

test('emoji: a Torn emoji inserts its shortcode; the tip names the system picker', () => {
  const { api, h } = editorAt('a', 'md', [1, 1]);
  h.onAction('ed-picker', el({ 'data-act': 'ed-picker', 'data-picker': 'emoji' }));
  const html = api.panelHtml(api.buildPanelModel(NOW));
  assert.match(html, /src="\/images\/emotions\/svg\/grin.svg"/);
  assert.match(html, /Win \+ \./);
  h.onAction('ed-emoji', el({ 'data-act': 'ed-emoji', 'data-value': 'grin' }));
  assert.strictEqual(api.state.editor.text, 'a:grin:');
});

test('Fix image link rewrites the whole draft and says how many', () => {
  const { api, h } = editorAt('![a](https://imgur.com/AbC12dE)', 'md', [0, 0]);
  h.onAction('ed-fix-images', el({ 'data-act': 'ed-fix-images' }));
  assert.strictEqual(api.state.editor.text, '![a](https://i.imgur.com/AbC12dE.png)');
  assert.ok(api.state.notices.some((n) => /1 image link/.test(n.text)));
});

test('narrow shows five tools and More; the rest are in the drawer', () => {
  const { env, api } = editorAt('', 'md', [0, 0]);
  void env;
  api.state.narrow = true;
  let html = api.panelHtml(api.buildPanelModel(NOW));
  assert.match(html, /data-act="ed-more"/);
  assert.doesNotMatch(html, /data-mark="strike"/);
  api.state.editor.moreOpen = true;
  html = api.panelHtml(api.buildPanelModel(NOW));
  assert.match(html, /data-mark="strike"/);
});

test('a Markdown link percent-encodes the parentheses that would end its destination', () => {
  const md = editorAt('x', 'md', [0, 1]);
  md.h.onAction('ed-picker', el({ 'data-act': 'ed-picker', 'data-picker': 'link' }));
  typeInto(md.h, 'ed-link-input', 'https://a.b/Foo_(bar)');
  md.h.onAction('ed-link-apply', el({ 'data-act': 'ed-link-apply' }));
  assert.strictEqual(md.api.state.editor.text, '[x](https://a.b/Foo_%28bar%29)');
  // HTML keeps the address as typed: an attribute value has no such syntax.
  const html = editorAt('x', 'html', [0, 1]);
  html.h.onAction('ed-picker', el({ 'data-act': 'ed-picker', 'data-picker': 'link' }));
  typeInto(html.h, 'ed-link-input', 'https://a.b/Foo_(bar)');
  html.h.onAction('ed-link-apply', el({ 'data-act': 'ed-link-apply' }));
  assert.strictEqual(html.api.state.editor.text, '<a href="https://a.b/Foo_(bar)">x</a>');
});

test('a stored draft changing behind a clean editor keeps the open picker and what was typed in it', () => {
  const { api, h } = editorAt('x', 'md', [0, 1]);
  h.onAction('ed-picker', el({ 'data-act': 'ed-picker', 'data-picker': 'color' }));
  typeInto(h, 'ed-hex-input', '#ffd43b');
  h.onAction('ed-color', el({ 'data-act': 'ed-color', 'data-value': 'custom' }));
  const warn = api.state.editor.pickerWarn;
  assert.ok(warn, 'the contrast warning is showing');
  // Autosave (or another tab) stores a new text for this thread.
  api.state.drafts = api.saveDraft(api.state.drafts, '42', 'from Torn', NOW + 1, '', 'md');
  const html = api.panelHtml(api.buildPanelModel(NOW + 2));
  assert.strictEqual(api.state.editor.text, 'from Torn', 'the clean editor shows what is stored');
  assert.strictEqual(api.state.editor.picker, 'color');
  assert.strictEqual(api.state.editor.pickerWarn, warn);
  assert.match(html, /data-act="ed-hex-input"[^>]*value="#ffd43b"/);
  // The image picker's check result survives the same reload.
  h.onAction('ed-picker', el({ 'data-act': 'ed-picker', 'data-picker': 'image' }));
  typeInto(h, 'ed-img-url', 'https://i.imgur.com/AbC12dE.png');
  h.onAction('ed-img-check', el({ 'data-act': 'ed-img-check' }));
  api.state.drafts = api.saveDraft(api.state.drafts, '42', 'again', NOW + 3, '', 'md');
  api.buildPanelModel(NOW + 4);
  assert.strictEqual(api.state.editor.text, 'again');
  assert.strictEqual(api.state.editor.picker, 'image');
  assert.ok(api.state.editor.imageCheck && api.state.editor.imageCheck.url === 'https://i.imgur.com/AbC12dE.png');
  assert.strictEqual(api.state.editor.fields['ed-img-url'], 'https://i.imgur.com/AbC12dE.png');
});

test('Settings offers the Default editor, and a change applies to new drafts only', () => {
  const env = loadUserscript({ location: THREAD, now: NOW });
  const api = env.exports;
  api.state.settings.view = 'settings';
  const html = api.panelHtml(api.buildPanelModel(NOW));
  assert.match(html, /<select id="tfcc-draftlang" data-act="draft-lang">/);
  assert.match(html, /<option value="md" selected>Markdown<\/option>/);
  api.state.drafts = api.saveDraft(api.freshDrafts(), 42, '**b**', NOW, 'T', 'md');
  const h = api.makeHandlers(env.doc, env.win);
  h.onChange('draft-lang', Object.assign(el({ 'data-act': 'draft-lang' }), { value: 'html' }));
  assert.strictEqual(api.state.settings.draftLang, 'html');
  api.state.route = api.parseForumRoute(env.win.location);
  api.state.settings.view = 'drafts';
  api.panelHtml(api.buildPanelModel(NOW));
  assert.strictEqual(api.state.editor.lang, 'md', 'the saved draft keeps its own mode');
});

// ---- final review fixes (#58) ---------------------------------------------

const HTML_TWO = '<p>first</p>\n<p style="text-align: right;">second</p>';

test('ed-align in HTML aligns the selected paragraphs in place', () => {
  const { api, h } = editorAt(HTML_TWO, 'html', [0, HTML_TWO.length]);
  h.onAction('ed-align', el({ 'data-act': 'ed-align', 'data-value': 'center' }));
  assert.strictEqual(api.editorPostHtml(), '<p style="text-align: center;">first</p><p style="text-align: center;">second</p>');
});

test('ed-quote in HTML quotes the paragraphs without nesting them', () => {
  const { api, h } = editorAt(HTML_TWO, 'html', [0, HTML_TWO.length]);
  h.onAction('ed-quote', el({ 'data-act': 'ed-quote' }));
  assert.strictEqual(api.editorPostHtml(), '<blockquote><p>first</p><p style="text-align: right;">second</p></blockquote>');
});

test('Bold across two HTML paragraphs keeps them two', () => {
  const { api, h } = editorAt(HTML_TWO, 'html', [0, HTML_TWO.length]);
  h.onAction('ed-mark', el({ 'data-act': 'ed-mark', 'data-mark': 'bold' }));
  assert.strictEqual(api.editorPostHtml(), '<p><strong>first</strong></p><p style="text-align: right;"><strong>second</strong></p>');
});

test('Reset all closes the open free draft; Save after it stores nothing and says so', () => {
  const env = loadUserscript({ location: FORUMS_LOCATION, now: NOW });
  const api = drafts(env);
  const h = api.makeHandlers(env.doc, env.win);
  h.onAction('draft-new', el({ 'data-act': 'draft-new' }));
  const key = api.state.draftFocusId;
  api.panelHtml(api.buildPanelModel(NOW));
  h.onInput('draft-text', Object.assign(el({ 'data-act': 'draft-text', 'data-id': key }), { value: 'old words', selectionStart: 0, selectionEnd: 0 }));
  h.onAction('reset-all', el({ 'data-act': 'reset-all' }));
  assert.strictEqual(api.state.draftFocusId, null);
  assert.strictEqual(api.state.editor.key, null);
  assert.strictEqual(api.state.editor.text, '');
  assert.strictEqual(api.state.editor.dirty, false);
  api.state.settings.view = 'drafts';
  const html = api.panelHtml(api.buildPanelModel(NOW));
  assert.doesNotMatch(html, new RegExp('data-act="draft-text" data-id="' + key + '"'));
  assert.deepStrictEqual(Object.keys(api.state.drafts.free || {}), []);
  // A Save carrying the old draft's id (a stale button) stores nothing and
  // never claims it saved.
  h.onAction('draft-save', el({ 'data-act': 'draft-save', 'data-id': key }));
  assert.strictEqual(api.draftFor(api.state.drafts, key), null);
  assert.ok(!api.state.notices.some((n) => /Draft saved/.test(n.text)));
});

test('Save on a free draft that no longer exists warns, keeps the text dirty, and stores nothing', () => {
  const env = loadUserscript({ location: FORUMS_LOCATION, now: NOW });
  const api = drafts(env);
  const h = api.makeHandlers(env.doc, env.win);
  h.onAction('draft-new', el({ 'data-act': 'draft-new' }));
  const key = api.state.draftFocusId;
  api.panelHtml(api.buildPanelModel(NOW));
  // The draft goes behind the open editor (another tab, an import).
  api.state.drafts = api.deleteFreeDraft(api.state.drafts, key);
  h.onInput('draft-text', Object.assign(el({ 'data-act': 'draft-text', 'data-id': key }), { value: 'typed', selectionStart: 0, selectionEnd: 0 }));
  h.onAction('draft-save', el({ 'data-act': 'draft-save', 'data-id': key }));
  assert.strictEqual(api.draftFor(api.state.drafts, key), null);
  assert.strictEqual(api.state.editor.dirty, true);
  assert.ok(!api.state.notices.some((n) => /Draft saved/.test(n.text)));
  assert.ok(api.state.notices.some((n) => n.kind === 'warn' && /no longer exists/.test(n.text)));
});

test('a dirty thread draft does not come back after Reset all and a navigation', () => {
  const env = loadUserscript({ location: THREAD, now: NOW });
  const api = drafts(env);
  api.panelHtml(api.buildPanelModel(NOW));
  const h = api.makeHandlers(env.doc, env.win);
  h.onInput('draft-text', Object.assign(el({ 'data-act': 'draft-text', 'data-id': '42' }), { value: 'unsaved', selectionStart: 0, selectionEnd: 0 }));
  h.onAction('reset-all', el({ 'data-act': 'reset-all' }));
  api.state.settings.view = 'drafts';
  api.panelHtml(api.buildPanelModel(NOW));
  api.state.route = api.parseForumRoute(FORUMS_LOCATION);
  api.panelHtml(api.buildPanelModel(NOW));
  assert.strictEqual(api.draftFor(api.state.drafts, '42'), null);
});

test('a pending Text-switch question does not survive another mode choice', () => {
  const { api, h } = editorAt('**b**', 'md', [0, 0]);
  h.onAction('ed-mode', el({ 'data-act': 'ed-mode', 'data-mode': 'text' }));
  assert.strictEqual(api.state.editor.confirmText, 'md');
  h.onAction('ed-mode', el({ 'data-act': 'ed-mode', 'data-mode': 'preview' }));
  assert.strictEqual(api.state.editor.confirmText, null);
  h.onAction('ed-mode', el({ 'data-act': 'ed-mode', 'data-mode': 'text' }));
  h.onAction('ed-mode', el({ 'data-act': 'ed-mode', 'data-mode': 'md' }));
  assert.strictEqual(api.state.editor.confirmText, null);
  assert.doesNotMatch(api.panelHtml(api.buildPanelModel(NOW)), /Plain text drops the formatting/);
});

test('changing the image address drops the old check, so Insert never inserts an old URL', () => {
  const { api, h } = editorAt('', 'md', [0, 0]);
  h.onAction('ed-picker', el({ 'data-act': 'ed-picker', 'data-picker': 'image' }));
  typeInto(h, 'ed-img-url', 'https://i.imgur.com/AbC12dE.png');
  h.onAction('ed-img-check', el({ 'data-act': 'ed-img-check' }));
  assert.ok(api.state.editor.imageCheck);
  typeInto(h, 'ed-img-url', 'https://i.imgur.com/Other99.png');
  assert.strictEqual(api.state.editor.imageCheck, null);
  h.onAction('ed-img-insert', el({ 'data-act': 'ed-img-insert' }));
  assert.strictEqual(api.state.editor.text, '');
  assert.ok(api.state.notices.some((n) => /Check the image link first/.test(n.text)));
});

test('Copy reports through the guarded redraw: it never lands on a player typing', async () => {
  const env = loadUserscript({ location: THREAD, now: NOW });
  const api = drafts(env);
  const handlers = api.makeHandlers(env.doc, env.win);
  api.draw(env.doc, env.win, handlers, true);
  const panel = env.doc.getElementById('tfcc-panel');
  const count = () => panel.renderCount || 0;
  handlers.onAction('draft-copy', el({ 'data-act': 'draft-copy', 'data-id': '42' }));
  const input = env.makeElement('textarea');
  input.setAttribute('data-act', 'draft-text');
  env.doc.activeElement = input;
  panel.contains = () => true;
  const before = count();
  await new Promise((r) => setImmediate(r));
  assert.ok(api.state.notices.some((n) => /Post copied/.test(n.text)));
  assert.strictEqual(count(), before, 'the copy result forced a redraw over the typing');
});

test('a failed Save keeps its error: "Draft saved." never replaces it', () => {
  const env = loadUserscript({ location: THREAD, now: NOW, gmWriteErrors: new Set(['tfcc:drafts']) });
  const api = drafts(env);
  api.panelHtml(api.buildPanelModel(NOW));
  const h = api.makeHandlers(env.doc, env.win);
  h.onInput('draft-text', Object.assign(el({ 'data-act': 'draft-text', 'data-id': '42' }), { value: 'words', selectionStart: 0, selectionEnd: 0 }));
  h.onAction('draft-save', el({ 'data-act': 'draft-save', 'data-id': '42' }));
  assert.strictEqual(api.state.notices.length, 1);
  assert.strictEqual(api.state.notices[0].kind, 'error');
  assert.ok(!api.state.notices.some((n) => /Draft saved/.test(n.text)));
});

// #58 (owner round 2, G2): symbol buttons, full names kept for assistive tech.
test('toolbar buttons show symbols and keep their full names in aria-label and title', () => {
  const { api } = editorAt('', 'md', [0, 0]);
  api.state.editor.moreOpen = true;
  api.state.narrow = false;
  const html = api.panelHtml(api.buildPanelModel(NOW));
  const names = {
    'ed-undo': 'Undo the last change', 'ed-more': null,
  };
  void names;
  const want = [
    ['data-mark="bold"', '<b>B</b>', 'Bold'], ['data-mark="italic"', '<i>I</i>', 'Italic'],
    ['data-mark="underline"', '<u>U</u>', 'Underline'], ['data-mark="strike"', '<s>S</s>', 'Strike through'],
    ['data-picker="size"', '>aA', 'Text size'], ['data-picker="align"', '>\u2261', 'Alignment'],
    ['data-act="ed-quote"', '>\u201C', 'Quote'], ['data-picker="table"', '>\u25A6', 'Insert table'],
    ['data-picker="emoji"', '>\u263A', 'Insert emoji'], ['data-picker="link"', '\uD83D\uDD17', 'Insert link'],
    ['data-picker="image"', '\uD83D\uDDBC\uFE0F', 'Insert image'], ['data-act="ed-undo"', '>\u21B6', 'Undo the last change'],
    ['data-picker="color"', '>A</span>', 'Text color'], ['data-picker="help"', '>?', 'Markdown help'],
  ];
  for (const [marker, face, name] of want) {
    const m = html.split('<button').filter((b) => b.includes(marker)).map((b) => b.split('</button>')[0]);
    assert.strictEqual(m.length, 1, marker + ' renders once');
    assert.ok(m[0].includes(face), marker + ' shows its symbol');
    assert.ok(m[0].includes('aria-label="' + name + '"') && m[0].includes('title="' + name + '"'), marker + ' keeps its name');
  }
  api.state.narrow = true;
  const nHtml = api.panelHtml(api.buildPanelModel(NOW));
  assert.match(nHtml, /data-act="ed-more" aria-expanded="true" aria-label="More tools" title="More tools">\u22EF<\/button>/);
});

test('the narrow primary toolbar row fits one line at 343px and is right-aligned (#58)', () => {
  const { api } = editorAt('', 'md', [0, 0]);
  api.state.narrow = true;
  const html = api.panelHtml(api.buildPanelModel(NOW));
  const row = /<div class="tfcc-tools" role="toolbar"[^>]*>(.*?)<\/div>/.exec(html)[1];
  const n = (row.match(/<button/g) || []).length;
  assert.strictEqual(n, 7, 'Undo, B, I, U, Color, Link, More');
  assert.ok(n * 40 + (n - 1) * 4 <= 319, 'the row fits the 343px panel minus its padding');
  const src = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'torn-forum-command-center.user.js'), 'utf8');
  assert.match(src, /\.tfcc-narrow \.tfcc-tools \{ gap: 4px; justify-content: flex-end; \}/);
  assert.match(src, /\.tfcc-narrow \.tfcc-tools button \{ min-width: 40px; width: 40px; min-height: 44px;/);
});
