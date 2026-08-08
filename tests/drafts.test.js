'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { loadUserscript } = require('./load-userscript');

const { exports: api } = loadUserscript();
const NOW = 1700000000000;

test('a draft saves, loads and overwrites', () => {
  let d = api.freshDrafts();
  d = api.saveDraft(d, 42, 'first thoughts', NOW, 'A thread');
  assert.strictEqual(api.draftFor(d, 42).text, 'first thoughts');
  assert.strictEqual(api.draftFor(d, 42).title, 'A thread');

  d = api.saveDraft(d, 42, 'second thoughts', NOW + 1000, '');
  assert.strictEqual(api.draftFor(d, 42).text, 'second thoughts');
  assert.strictEqual(api.draftFor(d, 42).title, 'A thread', 'the known title is not lost to a blank one');
});

test('emptying a draft deletes it rather than storing a blank', () => {
  let d = api.saveDraft(api.freshDrafts(), 42, 'something', NOW, '');
  d = api.saveDraft(d, 42, '   ', NOW, '');
  assert.strictEqual(api.draftFor(d, 42), null);
  assert.deepStrictEqual(Object.keys(d.byThread), []);
});

test('saving never mutates the drafts it was given', () => {
  const d = api.freshDrafts();
  const snapshot = JSON.stringify(d);
  api.saveDraft(d, 1, 'x', NOW, '');
  api.deleteDraft(d, 1);
  assert.strictEqual(JSON.stringify(d), snapshot);
});

test('a draft is capped rather than allowed to fill storage', () => {
  const huge = 'x'.repeat(api.DRAFT_MAX_CHARS + 5000);
  const d = api.saveDraft(api.freshDrafts(), 1, huge, NOW, '');
  assert.strictEqual(api.draftFor(d, 1).text.length, api.DRAFT_MAX_CHARS);
});

test('a draft for something that is not a thread is refused', () => {
  const d = api.freshDrafts();
  assert.strictEqual(api.saveDraft(d, 0, 'x', NOW, ''), d);
  assert.strictEqual(api.saveDraft(d, 'abc', 'x', NOW, ''), d);
});

test('draftList is newest first', () => {
  let d = api.freshDrafts();
  d = api.saveDraft(d, 1, 'old', NOW - 1000, '');
  d = api.saveDraft(d, 2, 'new', NOW, '');
  d = api.saveDraft(d, 3, 'middle', NOW - 500, '');
  assert.deepStrictEqual(api.draftList(d).map((x) => x.threadId), ['2', '3', '1']);
});

test('a stored drafts blob with junk in it loads only the real drafts', () => {
  const d = api.normaliseDrafts({
    v: 1,
    byThread: {
      1: { text: 'good', updatedAt: 5, title: 'T' },
      2: { text: '' },
      3: null,
      'bad-id': { text: 'nope' },
      4: 'not an object',
    },
  });
  assert.deepStrictEqual(Object.keys(d.byThread), ['1']);
});

test('insertDraft writes through the native setter so React notices', () => {
  // Assigning .value directly updates the DOM but not React's state, and the
  // next render throws the text away. This is the whole reason the function
  // exists rather than being one line at the call site.
  const env = loadUserscript();
  const box = env.makeElement('textarea');
  Object.setPrototypeOf(box, env.sandbox.HTMLTextAreaElement.prototype);
  env.doc.querySelector = (sel) => (sel === 'textarea[name="postText"]' ? box : null);

  const res = env.exports.insertDraft(env.doc, env.sandbox, 'my reply');
  assert.strictEqual(res.ok, true);
  assert.deepStrictEqual(env.nativeSetterCalls, ['my reply']);
});

test('insertDraft dispatches a bubbling input event', () => {
  const env = loadUserscript();
  const box = env.makeElement('textarea');
  Object.setPrototypeOf(box, env.sandbox.HTMLTextAreaElement.prototype);
  const seen = [];
  box.addEventListener('input', (ev) => seen.push({ type: ev.type, bubbles: ev.bubbles }));
  env.doc.querySelector = (sel) => (sel === 'textarea[name="postText"]' ? box : null);

  env.exports.insertDraft(env.doc, env.sandbox, 'text');
  assert.deepStrictEqual(seen, [{ type: 'input', bubbles: true }]);
});

test('with no reply box the panel is told to offer Copy instead of throwing', () => {
  // Every selector here is a guess against markup research could not confirm,
  // so failing to find one has to be a visible, harmless fallback.
  const env = loadUserscript();
  env.doc.querySelector = () => null;
  const res = env.exports.insertDraft(env.doc, env.sandbox, 'text');
  assert.strictEqual(res.ok, false);
  assert.strictEqual(res.reason, 'noreplybox');
  assert.match(res.detail, /Copy/);
});

test('findReplyBox prefers the most specific selector and skips detached nodes', () => {
  const env = loadUserscript();
  const specific = env.makeElement('textarea');
  const generic = env.makeElement('textarea');
  env.doc.querySelector = (sel) => {
    if (sel === 'textarea[name="postText"]') return specific;
    if (sel === 'textarea') return generic;
    return null;
  };
  assert.strictEqual(env.exports.findReplyBox(env.doc), specific);

  specific.isConnected = false;
  assert.strictEqual(env.exports.findReplyBox(env.doc), generic, 'a detached node is not a reply box');
});

test('a querySelector that throws does not take the script down', () => {
  const env = loadUserscript();
  env.doc.querySelector = () => { throw new Error('Torn changed something'); };
  assert.doesNotThrow(() => env.exports.findReplyBox(env.doc));
  assert.strictEqual(env.exports.findReplyBox(env.doc), null);
});
