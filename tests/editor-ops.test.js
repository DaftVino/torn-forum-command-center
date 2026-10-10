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

test('insertAtCaret replaces the selection and puts the caret after', () => {
  assert.deepStrictEqual(api.insertAtCaret('ab', 1, 1, ':grin:'), { text: 'a:grin:b', start: 7, end: 7 });
});

// ---- HTML mode on htmlSource-shaped input (final review, #58) -------------
// HTML mode lays a post out one paragraph per line. Align, Quote and the
// inline marks must keep those paragraphs separate, as a player expects.

const TWO = api.htmlSource(api.cleanTornHtml('<p>first</p><p style="text-align: right;">second</p>'));

test('HTML Align sets each selected paragraph\'s alignment in place', () => {
  assert.strictEqual(TWO, '<p>first</p>\n<p style="text-align: right;">second</p>');
  const r = api.applyBlockMark('html', TWO, 0, TWO.length, 'align', 'center');
  assert.strictEqual(r.text, '<p style="text-align: center;">first</p>\n<p style="text-align: center;">second</p>');
  assert.strictEqual(api.cleanTornHtml(r.text), '<p style="text-align: center;">first</p><p style="text-align: center;">second</p>');
  // A caret on one line aligns that paragraph only.
  const one = api.applyBlockMark('html', TWO, 2, 2, 'align', 'justify');
  assert.strictEqual(api.cleanTornHtml(one.text), '<p style="text-align: justify;">first</p><p style="text-align: right;">second</p>');
  // Other style on the tag is kept; only text-align is replaced.
  assert.strictEqual(api.applyBlockMark('html', '<p class="x" style="color: red; text-align: left">a</p>', 0, 0, 'align', 'right').text,
    '<p class="x" style="text-align: right; color: red;">a</p>');
  // Loose text still gets a paragraph of its own.
  assert.strictEqual(api.applyBlockMark('html', 'plain', 0, 0, 'align', 'center').text, '<p style="text-align: center;">plain</p>');
  assert.strictEqual(api.applyBlockMark('html', 'loose\n<p>x</p>', 0, 12, 'align', 'right').text,
    '<p style="text-align: right;">loose</p>\n<p style="text-align: right;">x</p>');
});

test('HTML Quote wraps paragraphs as they are, never inside another paragraph', () => {
  const r = api.applyBlockMark('html', TWO, 0, TWO.length, 'quote');
  assert.strictEqual(api.cleanTornHtml(r.text), '<blockquote><p>first</p><p style="text-align: right;">second</p></blockquote>');
  const one = api.applyBlockMark('html', TWO, 2, 2, 'quote');
  assert.strictEqual(api.cleanTornHtml(one.text), '<blockquote><p>first</p></blockquote><p style="text-align: right;">second</p>');
  assert.strictEqual(api.applyBlockMark('html', 'plain', 0, 0, 'quote').text, '<blockquote><p>plain</p></blockquote>');
  assert.strictEqual(api.cleanTornHtml(api.applyBlockMark('html', 'loose\n<p>x</p>', 0, 12, 'quote').text),
    '<blockquote><p>loose</p><p>x</p></blockquote>');
});

test('an inline mark across two paragraphs marks inside each, and they stay two', () => {
  const i = TWO.indexOf('first') + 2;
  const j = TWO.indexOf('second') + 3;
  const b = api.applyMark('html', TWO, i, j, 'bold');
  assert.strictEqual(api.cleanTornHtml(b.text),
    '<p>fi<strong>rst</strong></p><p style="text-align: right;"><strong>sec</strong>ond</p>');
  const c = api.applyMark('html', TWO, 0, TWO.length, 'color', 'red');
  assert.strictEqual(api.cleanTornHtml(c.text), '<p><span style="color: var(--te-text-color-red);">first</span></p>'
    + '<p style="text-align: right;"><span style="color: var(--te-text-color-red);">second</span></p>');
  for (const mark of ['italic', 'underline', 'strike']) {
    const m = api.applyMark('html', TWO, 0, TWO.length, mark);
    assert.strictEqual((api.cleanTornHtml(m.text).match(/<p[ >]/g) || []).length, 2, mark);
  }
  // Within one paragraph nothing changes: the selection is what was wrapped.
  assert.deepStrictEqual(api.applyMark('html', '<p>ab</p>', 3, 5, 'bold'), { text: '<p><strong>ab</strong></p>', start: 11, end: 13 });
});

test('a heading with trailing spaces round-trips (mdBlocks trims it)', () => {
  assert.strictEqual(api.mdToHtml('# word '), api.mdToHtml('# word'));
  assert.strictEqual(api.htmlToMd(api.mdToHtml('# word ')), '# word');
  assert.strictEqual(api.mdToHtml(api.htmlToMd(api.mdToHtml('# word '))), api.mdToHtml('# word '));
});

// ---- #58 feedback: multi-line blocks and whole tables (Batch B) ----------

test('B3: Align and Quote over a multi-line selection take every selected line, in both languages', () => {
  // Markdown: one fence around the whole selected line range, from mid-line
  // to mid-line, and only those lines.
  const md = 'top\nfirst line\nsecond line\nbottom';
  assert.deepStrictEqual(api.applyBlockMark('md', md, 7, 20, 'align', 'right'),
    { text: 'top\n:::right\nfirst line\nsecond line\n:::\nbottom', start: 4, end: 39 });
  assert.strictEqual(api.applyBlockMark('md', md, 7, 20, 'quote').text, 'top\n> first line\n> second line\nbottom');
  // HTML: each selected paragraph line, the unselected ones untouched.
  const html = '<p>top</p>\n<p>one</p>\n<p>two</p>\n<p>end</p>';
  assert.strictEqual(api.applyBlockMark('html', html, 14, 25, 'align', 'center').text,
    '<p>top</p>\n<p style="text-align: center;">one</p>\n<p style="text-align: center;">two</p>\n<p>end</p>');
  assert.strictEqual(api.applyBlockMark('html', html, 14, 25, 'quote').text,
    '<p>top</p>\n<blockquote><p>one</p><p>two</p></blockquote>\n<p>end</p>');
});

const MD_TABLE = 'intro\n| A | B |\n| --- | --- |\n| 1 | 2 |\n| 3 | 4 |\nafter';

test('B4: aligning a Markdown table from a body row rewrites its delimiter row, never splits it', () => {
  const caret = MD_TABLE.indexOf('| 3');
  const r = api.applyBlockMark('md', MD_TABLE, caret, caret, 'align', 'center');
  assert.strictEqual(r.text, 'intro\n| A | B |\n| :---: | :---: |\n| 1 | 2 |\n| 3 | 4 |\nafter');
  assert.strictEqual(r.refused, undefined);
  assert.doesNotMatch(r.text, /:::/);
  assert.strictEqual(api.applyBlockMark('md', MD_TABLE, caret, caret, 'align', 'right').text.split('\n')[2], '| ---: | ---: |');
  assert.strictEqual(api.applyBlockMark('md', MD_TABLE, caret, caret, 'align', 'left').text.split('\n')[2], '| :--- | :--- |');
  // Justify has no Markdown table form: left, and no refusal.
  const j = api.applyBlockMark('md', MD_TABLE, caret, caret, 'align', 'justify');
  assert.strictEqual(j.text.split('\n')[2], '| :--- | :--- |');
  assert.strictEqual(j.refused, undefined);
  // Previewed, every cell carries the alignment.
  const html = api.mdToHtml(r.text);
  assert.strictEqual((html.match(/<t[hd] style="text-align: center;">/g) || []).length, 6);
});

test('B4: a selection from text into a table fences the text and aligns the table whole', () => {
  const r = api.applyBlockMark('md', MD_TABLE, 0, MD_TABLE.indexOf('| 1'), 'align', 'right');
  assert.strictEqual(r.text, ':::right\nintro\n:::\n| A | B |\n| ---: | ---: |\n| 1 | 2 |\n| 3 | 4 |\nafter');
});

test('B4: a Markdown table with no header row cannot hold alignment: refused, text unchanged', () => {
  const t = 'x\n| 1 | 2 |\n| 3 | 4 |';
  const r = api.applyBlockMark('md', t, t.length, t.length, 'align', 'center');
  assert.strictEqual(r.refused, 'table-header');
  assert.strictEqual(r.text, t);
  assert.deepStrictEqual([r.start, r.end], [t.length, t.length]);
});

test('B4: aligning an HTML table from a body cell sets text-align on every th and td', () => {
  const t = '<p>a</p>\n<table><tbody><tr><th>H</th><th style="color: red; text-align: left;">I</th></tr>'
    + '<tr><td>1</td><td>2</td></tr></tbody></table>\n<p>z</p>';
  const caret = t.indexOf('<td>2');
  const r = api.applyBlockMark('html', t, caret, caret, 'align', 'right');
  assert.strictEqual(r.text, '<p>a</p>\n<table><tbody><tr><th style="text-align: right;">H</th>'
    + '<th style="text-align: right; color: red;">I</th></tr>'
    + '<tr><td style="text-align: right;">1</td><td style="text-align: right;">2</td></tr></tbody></table>\n<p>z</p>');
  assert.doesNotMatch(r.text, /<p style/, 'neither the table nor the paragraphs around it are wrapped');
});

test('B4: a multi-line HTML table aligns whole from any of its lines', () => {
  const t = '<table>\n<tr><td>1</td></tr>\n<tr><td>2</td></tr>\n</table>';
  const caret = t.indexOf('<td>2');
  assert.strictEqual(api.applyBlockMark('html', t, caret, caret, 'align', 'center').text,
    '<table>\n<tr><td style="text-align: center;">1</td></tr>\n<tr><td style="text-align: center;">2</td></tr>\n</table>');
});
