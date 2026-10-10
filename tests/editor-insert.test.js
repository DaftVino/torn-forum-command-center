'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { loadUserscript } = require('./load-userscript');

const SEL = '#editor-wrapper .editor-content.mce-content-body';

// A visible TinyMCE body: handles a marked paste by appending its HTML, the
// way the owner observed TinyMCE do it (test B).
function tinyBody(env, initial) {
  const box = env.makeElement('div');
  box.getBoundingClientRect = () => ({ width: 600, height: 160 });
  box.innerHTML = initial || '<p><br data-mce-bogus="1"></p>';
  const seen = [];
  box.addEventListener('paste', (ev) => {
    seen.push(ev);
    const html = ev.clipboardData.getData('text/html');
    if (html.indexOf('<!-- x-tinymce/html -->') !== 0) return;
    ev.preventDefault();
    box.innerHTML = box.innerHTML + html.slice('<!-- x-tinymce/html -->'.length);
  });
  env.doc.querySelectorAll = (sel) => (sel === SEL ? [box] : []);
  return { box, seen };
}

function body(env, w, inForm) {
  const b = env.makeElement('div');
  b.getBoundingClientRect = () => ({ width: w, height: w ? 100 : 0 });
  b.closest = (sel) => (sel === '.forums-new-post-wrap' && inForm ? {} : null);
  return b;
}

test('several TinyMCE bodies: the visible one, then the one in the reply form, else none', () => {
  const env = loadUserscript();
  const hidden = body(env, 0, false);
  const shown = body(env, 600, false);
  env.doc.querySelectorAll = () => [hidden, shown];
  assert.strictEqual(env.exports.findReplyBox(env.doc), shown, 'a hidden edit box before the reply box is skipped');
  const editBox = body(env, 600, false);
  const reply = body(env, 600, true);
  env.doc.querySelectorAll = () => [editBox, reply];
  assert.strictEqual(env.exports.findReplyBox(env.doc), reply, 'two visible: the one in .forums-new-post-wrap');
  env.doc.querySelectorAll = () => [body(env, 600, false), body(env, 600, false)];
  assert.strictEqual(env.exports.findReplyBox(env.doc), null, 'ambiguous: never guess');
  env.doc.querySelectorAll = () => { throw new Error('Torn changed something'); };
  assert.strictEqual(env.exports.findReplyBox(env.doc), null);
});

test('Insert pastes the marked post into Torn\'s editor and reports success', () => {
  const env = loadUserscript();
  const { box, seen } = tinyBody(env);
  const res = env.exports.insertPost(env.doc, env.sandbox.window, '<p><strong>b</strong></p>');
  assert.deepStrictEqual(res, { ok: true });
  assert.strictEqual(seen.length, 1);
  assert.strictEqual(seen[0].type, 'paste');
  assert.ok(seen[0].bubbles && seen[0].cancelable);
  assert.strictEqual(seen[0].clipboardData.getData('text/html'), '<!-- x-tinymce/html --><p><strong>b</strong></p>');
  assert.strictEqual(seen[0].clipboardData.getData('text/plain'), 'b');
  assert.match(box.innerHTML, /<strong>b<\/strong>/);
});

test('Insert puts the caret at the end first, so nothing typed is replaced (Review Focus 2)', () => {
  const env = loadUserscript();
  const { box } = tinyBody(env, '<p>already typed</p>');
  env.exports.insertPost(env.doc, env.sandbox.window, '<p>new</p>');
  assert.deepStrictEqual(env.selectionLog.map((x) => x.op), ['selectNodeContents', 'collapse', 'removeAllRanges', 'addRange']);
  assert.strictEqual(env.selectionLog[0].node, box);
  assert.strictEqual(env.selectionLog[1].toStart, false);
  assert.strictEqual(box.innerHTML, '<p>already typed</p><p>new</p>');
});

test('a long post is sent whole (Review Focus 3)', () => {
  const env = loadUserscript();
  const { seen } = tinyBody(env);
  const md = ('{red}**word**{/} ').repeat(1100); // 18700 characters
  const html = env.exports.mdToHtml(md);
  assert.ok(md.length < env.exports.DRAFT_MAX_CHARS && html.length > env.exports.DRAFT_MAX_CHARS);
  // The source survives conversion whole, independent of what Insert sends.
  assert.strictEqual((html.match(/<strong>word<\/strong>/g) || []).length, 1100);
  env.exports.insertPost(env.doc, env.sandbox.window, html);
  assert.strictEqual(seen[0].clipboardData.getData('text/html'), '<!-- x-tinymce/html -->' + html);
});

test('an editor that ignores the paste is reported, and Copy is offered', () => {
  const env = loadUserscript();
  const box = body(env, 600, true);
  env.doc.querySelectorAll = (sel) => (sel === SEL ? [box] : []);
  const res = env.exports.insertPost(env.doc, env.sandbox.window, '<p>x</p>');
  assert.strictEqual(res.ok, false);
  assert.strictEqual(res.reason, 'refused');
  assert.match(res.detail, /Copy/);
});

test('no editor on the page means Copy, never a Report box (#60)', () => {
  const env = loadUserscript();
  const reason = env.makeElement('textarea');
  reason.getBoundingClientRect = () => ({ width: 100, height: 20 });
  env.doc.querySelector = (sel) => (/textarea/.test(sel) ? reason : null);
  env.doc.querySelectorAll = (sel) => (/textarea/.test(sel) ? [reason] : []);
  assert.strictEqual(env.exports.findReplyBox(env.doc), null);
  const res = env.exports.insertPost(env.doc, env.sandbox.window, '<p>x</p>');
  assert.strictEqual(res.reason, 'noreplybox');
  assert.strictEqual(reason.value, '');
  assert.deepStrictEqual(env.exports.REPLY_SELECTORS.slice(), [SEL]);
});

test('a browser without DataTransfer is told to use Copy', () => {
  const env = loadUserscript();
  tinyBody(env);
  const win = Object.assign({}, env.sandbox.window, { DataTransfer: undefined });
  const res = env.exports.insertPost(env.doc, win, '<p>x</p>');
  assert.strictEqual(res.reason, 'unsupported');
});

const settle = () => new Promise((r) => setImmediate(r));

test('Copy writes the marked post as HTML and the source as plain text, then reports', async () => {
  const env = loadUserscript();
  const results = [];
  env.exports.copyPost(env.doc, env.sandbox.window, '<p><strong>b</strong></p><p>c</p>', (r) => results.push(r));
  assert.deepStrictEqual(results, [], 'not before the clipboard answers');
  await settle();
  assert.deepStrictEqual(JSON.parse(JSON.stringify(results)), [{ ok: true }]);
  const item = env.clipboardLog.find((x) => x.op === 'write').items[0];
  assert.deepStrictEqual(item.types.slice().sort(), ['text/html', 'text/plain']);
  assert.deepStrictEqual(Array.from(item.map['text/html'].parts), ['<!-- x-tinymce/html --><p><strong>b</strong></p><p>c</p>']);
  assert.deepStrictEqual(Array.from(item.map['text/plain'].parts), ['<p><strong>b</strong></p>\n<p>c</p>']);
});

test('a refused rich copy falls back to text, and a refused text copy reports failure', async () => {
  const env = loadUserscript();
  const w = env.sandbox.window;
  const results = [];
  const win = Object.assign({}, w, { navigator: { clipboard: {
    write: () => Promise.reject(new Error('denied')),
    writeText: (t) => { env.clipboardLog.push({ op: 'writeText', text: t }); return Promise.resolve(); },
  } } });
  env.exports.copyPost(env.doc, win, '<p>x</p>', (r) => results.push(r));
  await settle(); await settle();
  assert.deepStrictEqual(JSON.parse(JSON.stringify(results)), [{ ok: true }]);
  assert.deepStrictEqual(Array.from(env.clipboardLog.map((x) => x.op)), ['writeText']);
  const results2 = [];
  const win2 = Object.assign({}, w, { ClipboardItem: undefined, navigator: { clipboard: {
    writeText: () => Promise.reject(new Error('denied')),
  } } });
  env.exports.copyPost(env.doc, win2, '<p>x</p>', (r) => results2.push(r));
  await settle(); await settle();
  assert.deepStrictEqual(JSON.parse(JSON.stringify(results2)), [{ ok: false }]);
});

function autosaveEnv(drafts) {
  const env = loadUserscript({ location: Object.assign({}, require('./load-userscript').FORUMS_LOCATION, { hash: '#/p=threads&f=1&t=42&b=0&a=0' }) });
  const api = env.exports;
  const box = env.makeElement('div');
  box.getBoundingClientRect = () => ({ width: 600, height: 160 });
  env.doc.querySelectorAll = (sel) => (sel === SEL ? [box] : []);
  api.state.route = api.parseForumRoute(env.win.location);
  if (drafts) api.state.drafts = drafts;
  api.attachAutosave(env.doc, env.win);
  const input = (html) => {
    box.innerHTML = html;
    box.dispatchEvent(new env.sandbox.window.Event('input', { bubbles: true }));
  };
  const type = (html) => { input(html); env.advanceTimersBy(api.AUTOSAVE_DEBOUNCE_MS + 10); };
  return { env, api, box, input, type };
}

test('autosave saves Torn\'s editor as a cleaned HTML draft', () => {
  const { api, type } = autosaveEnv();
  type('<p><strong data-mce-style="x">hi</strong></p>');
  const d = api.draftFor(api.state.drafts, 42);
  assert.strictEqual(d.lang, 'html');
  assert.strictEqual(d.text, '<p><strong>hi</strong></p>');
});

test('typing in thread 42 then moving to thread 43 before the debounce saves nothing to 43', () => {
  const { env, api, input } = autosaveEnv();
  input('<p>for 42</p>');
  // The navigation observer re-reads location and would re-point the route (or
  // detach the listener) first, so the route changes only just before the timer
  // fires. That reaches the guard on the timer itself, which is what is tested.
  env.advanceTimersBy(api.AUTOSAVE_DEBOUNCE_MS - 20);
  api.state.route = api.parseForumRoute({ hash: '#/p=threads&f=1&t=43&b=0&a=0', pathname: '/forums.php', host: 'www.torn.com' });
  env.advanceTimersBy(40);
  assert.strictEqual(api.draftFor(api.state.drafts, 42), null, 'and nothing for 42 either: the route is no longer 42');
  assert.strictEqual(api.draftFor(api.state.drafts, 43), null);
});

test('an editor body over the draft limit is not autosaved, so nothing is stored cut short', () => {
  const { api, type } = autosaveEnv();
  type('<p>' + 'x'.repeat(api.DRAFT_MAX_CHARS + 10) + '</p>');
  assert.strictEqual(api.draftFor(api.state.drafts, 42), null);
});

test('autosave never overwrites a Markdown or Text draft', () => {
  for (const lang of ['md', undefined]) {
    const { api, type } = autosaveEnv(
      require('./load-userscript').loadUserscript().exports.saveDraft({ v: 1, byThread: {} }, 42, '**mine**', 1, 'T', lang));
    type('<p>torn side</p>');
    assert.strictEqual(api.draftFor(api.state.drafts, 42).text, '**mine**', String(lang));
  }
});

test('an empty editor never deletes or overwrites a draft', () => {
  const { api, type } = autosaveEnv();
  type('<p>keep</p>');
  type('<p><br data-mce-bogus="1"></p>');
  assert.strictEqual(api.draftFor(api.state.drafts, 42).text, '<p>keep</p>');
});
