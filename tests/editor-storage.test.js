'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { loadUserscript } = require('./load-userscript');

const env0 = loadUserscript();
const api = env0.exports;
const btoaFn = env0.sandbox.btoa;
const atobFn = env0.sandbox.atob;
const NOW = 1700000000000;

test('a v0.2.2 drafts blob loads unchanged and silently', () => {
  const old = { v: 1, byThread: { 42: { text: '<p>typed html</p>', updatedAt: 5, title: 'T' } } };
  const value = api.normaliseDrafts(old);
  assert.strictEqual(JSON.stringify(value), JSON.stringify(old));
  assert.strictEqual(api.isRecoveredValue(old, value), false, 'no damage notice');
  assert.strictEqual(api.draftLangOf(value.byThread[42]), 'text', 'an old draft is Text (Review Focus 5)');
});

test('a v0.2.2 settings blob loads silently through the real load path, with the Markdown default', () => {
  // The real path: loadKey with isRecoveredSettings, which loadAll uses.
  const old = JSON.parse(JSON.stringify(api.freshSettings()));
  delete old.draftLang;
  const env = loadUserscript({ gmStore: [['tfcc:settings', JSON.stringify(old)]] });
  const res = env.exports.loadKey(env.exports.STORAGE_KEYS.settings, env.exports.normaliseSettings, NOW,
    env.exports.isRecoveredSettings);
  assert.strictEqual(res.value.draftLang, 'md');
  assert.strictEqual(res.recovered, false, 'no damage notice');
});

test('a v0.2.2 drafts blob loads silently through the real load path', () => {
  const old = { v: 1, byThread: { 42: { text: 'x', updatedAt: 5, title: 'T' } } };
  const env = loadUserscript({ gmStore: [['tfcc:drafts', JSON.stringify(old)]] });
  const res = env.exports.loadKey(env.exports.STORAGE_KEYS.drafts, env.exports.normaliseDrafts, NOW);
  assert.strictEqual(res.recovered, false);
});

test('the v0.2.2 normaliser keeps byThread text from a blob this build writes (downgrade)', () => {
  const legacy = require('./fixtures/legacy-normalise-drafts-v0.2.2.js');
  let d = api.saveDraft(api.freshDrafts(), 3, '**b**', NOW, 'T', 'md');
  const made = api.newFreeDraft(d, NOW, 'md');
  d = api.saveFreeDraft(made.drafts, made.id, 'f', NOW, 'F', 'md');
  const back = legacy(JSON.parse(JSON.stringify(d)));
  assert.strictEqual(back.byThread[3].text, '**b**');
  assert.strictEqual(back.free, undefined, 'the documented downgrade loss');
});

test('draftLang is strict on the menu', () => {
  for (const [raw, want] of [['html', 'html'], ['text', 'text'], ['md', 'md'], ['HTML', 'md'], [3, 'md'], [null, 'md']]) {
    assert.strictEqual(api.normaliseSettings({ v: 1, draftLang: raw }).draftLang, want, String(raw));
  }
});

test('a draft language is stored only when it is not Text', () => {
  let d = api.saveDraft(api.freshDrafts(), 7, 'x', NOW, 'T', 'md');
  assert.deepStrictEqual(Object.keys(d.byThread[7]), ['text', 'updatedAt', 'title', 'lang']);
  d = api.saveDraft(d, 7, 'x', NOW, 'T', 'text');
  assert.deepStrictEqual(Object.keys(d.byThread[7]), ['text', 'updatedAt', 'title']);
  for (const junk of ['text', 'TEXT', 5, null]) {
    const n = api.normaliseDrafts({ v: 1, byThread: { 1: { text: 'a', updatedAt: 1, title: '', lang: junk } } });
    assert.strictEqual(n.byThread[1].lang, undefined, String(junk));
  }
});

test('free drafts: create, save, list, cap, delete', () => {
  let r = api.newFreeDraft(api.freshDrafts(), NOW, 'md');
  assert.match(r.id, /^n[0-9]{1,12}$/);
  assert.strictEqual(r.drafts.free[r.id].name, 'Untitled 1');
  let d = api.saveFreeDraft(r.drafts, r.id, '# Guide', NOW + 1, 'Education guide v2', 'md');
  assert.deepStrictEqual(Object.keys(d.free[r.id]), ['name', 'text', 'updatedAt', 'lang']);
  d = api.saveDraft(d, 9, 'reply', NOW + 2, 'Thread 9');
  const list = api.draftList(d);
  assert.deepStrictEqual(list.map((x) => [x.kind, x.key]), [['thread', '9'], ['free', r.id]]);
  assert.strictEqual(list[1].title, 'Education guide v2');
  assert.strictEqual(api.draftFor(d, r.id).text, '# Guide');
  assert.ok(api.saveDraft(d, 10, 'x', NOW, '').free[r.id], 'saving a reply keeps free drafts');
  assert.ok(api.deleteDraft(d, 9).free[r.id], 'deleting a reply keeps free drafts');
  d = api.deleteFreeDraft(d, r.id);
  assert.strictEqual(api.draftFor(d, r.id), null);
  let full = api.freshDrafts();
  for (let i = 0; i < api.FREE_DRAFTS_MAX; i += 1) full = api.newFreeDraft(full, NOW + i, 'md').drafts;
  assert.strictEqual(api.newFreeDraft(full, NOW, 'md').id, null);
  // The largest id wraps instead of growing a 13th digit.
  const edge = api.newFreeDraft(api.newFreeDraft(api.freshDrafts(), 999999999999, 'md').drafts, 999999999999, 'md');
  assert.strictEqual(edge.id, 'n1');
});

test('a stored free-drafts blob normalises, and keeps an empty named draft', () => {
  const raw = { v: 1, byThread: {}, free: { n1: { name: 'A', text: '', updatedAt: 3 }, bad: { name: 'x', text: 'y', updatedAt: 1 }, n2: 'junk' } };
  const n = api.normaliseDrafts(raw);
  assert.deepStrictEqual(Object.keys(n.free), ['n1']);
  assert.strictEqual(n.free.n1.text, '');
});

test('export and import carry free drafts and the language', () => {
  let d = api.saveDraft(api.freshDrafts(), 3, '**b**', NOW, 'T', 'md');
  const r = api.newFreeDraft(d, NOW, 'html');
  d = api.saveFreeDraft(r.drafts, r.id, '<p>x</p>', NOW, 'Free', 'html');
  const blob = api.encodeState(api.freshOrganizer(NOW), d, btoaFn);
  const back = api.importState(api.freshOrganizer(NOW), api.freshDrafts(), blob, atobFn);
  assert.strictEqual(back.drafts.byThread[3].lang, 'md');
  assert.strictEqual(back.drafts.free[r.id].text, '<p>x</p>');
  assert.strictEqual(back.drafts.free[r.id].lang, 'html');
});
