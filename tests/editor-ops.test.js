'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { loadUserscript } = require('./load-userscript');

const { exports: api } = loadUserscript();

test('a mark wraps the selection, or inserts a placeholder at the caret', () => {
  assert.deepStrictEqual(api.applyMark('md', 'hello world', 6, 11, 'bold'), { text: 'hello **world**', start: 8, end: 13 });
  assert.deepStrictEqual(api.applyMark('md', 'hi', 2, 2, 'color', 'red'), { text: 'hi{red}text{/}', start: 7, end: 11 });
  assert.deepStrictEqual(api.applyMark('html', 'x', 0, 1, 'color', '#FF0000'),
    { text: '<span style="color: #ff0000;">x</span>', start: 30, end: 31 });
  // '<a href="https://a.b">' is 22 characters long.
  assert.deepStrictEqual(api.applyMark('html', 'x', 0, 1, 'link', 'https://a.b'),
    { text: '<a href="https://a.b">x</a>', start: 22, end: 23 });
});

test('quote and alignment act on whole lines', () => {
  assert.deepStrictEqual(api.applyBlockMark('md', 'a\nb\nc', 2, 3, 'align', 'center'),
    { text: 'a\n:::center\nb\n:::\nc', start: 2, end: 17 });
  assert.strictEqual(api.applyBlockMark('md', 'a\nb\n\nc', 0, 6, 'quote').text, '> a\n> b\n>\n> c');
});

test('a block lands on lines of its own', () => {
  assert.deepStrictEqual(api.insertBlock('abc', 1, 1, '| x |'), { text: 'a\n| x |\nbc', start: 7, end: 7 });
  assert.deepStrictEqual(api.insertBlock('', 0, 0, 'T'), { text: 'T', start: 1, end: 1 });
});

test('the table skeleton is valid in both languages', () => {
  assert.strictEqual(api.tableSkeleton('md', 2, 1, true), '| Column 1 | Column 2 |\n| --- | --- |\n| Cell | Cell |');
  assert.strictEqual(api.mdToHtml(api.tableSkeleton('md', 2, 1, true)), api.cleanTornHtml(api.tableSkeleton('html', 2, 1, true)));
  assert.strictEqual(api.tableSkeleton('md', 99, 99, false).split('\n').length, 30);
});

test('emoji and image snippets', () => {
  assert.strictEqual(api.emojiSnippet('md', 'grin'), ':grin:');
  assert.strictEqual(api.emojiSnippet('html', 'grin'), '<img src="/images/emotions/svg/grin.svg">');
  assert.strictEqual(api.emojiSnippet('md', 'nope'), '');
  assert.strictEqual(api.imageSnippet('md', 'https://a.b/c.png', 'a [b]'), '![a  b](https://a.b/c.png)');
  assert.strictEqual(api.imageSnippet('html', 'https://a.b/c.png?x=1&y=2', ''), '<img src="https://a.b/c.png?x=1&amp;y=2">');
});

test('the Unicode emoji set is single emoji, built from code points', () => {
  assert.ok(api.UNICODE_EMOJI.length >= 36);
  for (const e of api.UNICODE_EMOJI) assert.ok([...e].length <= 2 && e.codePointAt(0) > 0x2000, JSON.stringify(e));
});
