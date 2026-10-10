'use strict';

// #58 owner feedback round 2, Batch I: Enter and blank lines keep paragraphs
// and gaps in every editor mode, without the player knowing any markup.
//   I1 HTML source is line-based at the top level, like Markdown.
//   I2 Enter in HTML splits the paragraph or list item; Shift+Enter is <br>.
//   I3 Enter in Markdown continues a list or quote, and ends it on an empty marker.
//   I4 Text keeps the browser's Enter: each line a paragraph, an empty line a gap.
//   I5 An Enter edit goes the way other edits go: Undo, dirty, the limit, the caret.
//   I6 The same visible post gives the same paragraphs and gaps in every mode.

const test = require('node:test');
const assert = require('node:assert');
const { loadUserscript, FORUMS_LOCATION } = require('./load-userscript');
const { panelOf, redraw, click } = require('./narrow-helpers');

const { exports: api } = loadUserscript();
const GAP = '<p>&nbsp;</p>';
const html = (src) => api.postHtml(src, 'html');
const preview = (lang, src) => api.previewModel(lang, src);

// ---- I1: the HTML line rule ------------------------------------------------

test('I1: the owner\'s case: a line after a paragraph is a paragraph, an empty line a gap', () => {
  assert.strictEqual(html('<p>one</p>\ntwo\n\nthree'), '<p>one</p><p>two</p>' + GAP + '<p>three</p>');
});

test('I1: plain lines typed in HTML are paragraphs, as in Markdown', () => {
  assert.strictEqual(html('one\ntwo'), '<p>one</p><p>two</p>');
  assert.strictEqual(html('one\n\ntwo'), '<p>one</p>' + GAP + '<p>two</p>');
  assert.strictEqual(html('one\n\n\ntwo'), '<p>one</p>' + GAP + GAP + '<p>two</p>');
  assert.strictEqual(html('one\r\n\r\ntwo'), '<p>one</p>' + GAP + '<p>two</p>', 'Windows line ends read the same');
});

test('I1: blank lines between two paragraph lines become spacers, one per line', () => {
  assert.strictEqual(html('<p>a</p>\n<p>b</p>'), '<p>a</p><p>b</p>', 'no blank line, no gap');
  assert.strictEqual(html('<p>a</p>\n\n<p>b</p>'), '<p>a</p>' + GAP + '<p>b</p>');
  assert.strictEqual(html('<p>a</p>\n\n\n<p>b</p>'), '<p>a</p>' + GAP + GAP + '<p>b</p>');
  assert.strictEqual(html('<p>a</p>\n   \n<p>b</p>'), '<p>a</p>' + GAP + '<p>b</p>', 'a line of spaces is empty');
});

test('I1: a line of text with inline markup is one paragraph', () => {
  assert.strictEqual(html('a <strong>bold</strong> and <em>it</em>\nnext'),
    '<p>a <strong>bold</strong> and <em>it</em></p><p>next</p>');
  assert.strictEqual(html('<span style="color: #ff0000;">red</span> line'), '<p><span style="color: #ff0000;">red</span> line</p>');
});

test('I1: a list typed over several lines stays one list', () => {
  assert.strictEqual(html('<ul>\n<li>a</li>\n<li>b</li>\n</ul>'), '<ul><li>a</li><li>b</li></ul>');
  assert.strictEqual(html('<ol>\n  <li>a\n  more a</li>\n\n  <li>b</li>\n</ol>\nafter'),
    '<ol><li>a more a</li><li>b</li></ol><p>after</p>', 'newlines and blank lines inside a list are whitespace');
});

test('I1: a table typed over several lines stays one table', () => {
  const src = '<table>\n<tbody>\n<tr>\n<td>a</td>\n\n<td>b</td>\n</tr>\n<tr><td>c</td><td>d</td></tr>\n</tbody>\n</table>';
  assert.strictEqual(html(src), api.cleanTornHtml(src.replace(/\n/g, '')));
  assert.match(html(src), /<tr><td>a<\/td><td>b<\/td><\/tr><tr><td>c<\/td><td>d<\/td><\/tr>/);
});

test('I1: inside an open paragraph, quote or div a newline is only a space', () => {
  assert.strictEqual(html('<p>one\ntwo</p>'), '<p>one two</p>');
  assert.strictEqual(html('<blockquote>\n<p>q1</p>\n<p>q2</p>\n</blockquote>'), '<blockquote><p>q1</p><p>q2</p></blockquote>');
  assert.strictEqual(html('<div>a\nb</div>'), '<p>a b</p>');
});

test('I1: an inline element open over a line break is closed there and reopened on the next line', () => {
  assert.strictEqual(html('<strong>a\nb</strong>'), '<p><strong>a</strong></p><p><strong>b</strong></p>');
  assert.strictEqual(html('<strong>a\n\nb</strong>'), '<p><strong>a</strong></p>' + GAP + '<p><strong>b</strong></p>');
  assert.strictEqual(html('<strong>\nbold\n</strong>'), '<p><strong>bold</strong></p>', 'a line of only a tag is not a gap');
});

test('I1: leading and trailing blank lines behave as Markdown\'s do', () => {
  for (const src of ['\n\nhello', 'hello\n', 'hello\n\n', '\nhello\n', '   ', 'a\n\n\nb\n']) {
    assert.strictEqual(html(src), api.postHtml(src, 'md'), JSON.stringify(src));
  }
  assert.strictEqual(html('\n\nhello'), GAP + GAP + '<p>hello</p>');
  assert.strictEqual(html(''), '', 'an empty draft is an empty post');
});

test('I1: one line mixing text and blocks keeps its old reading', () => {
  assert.strictEqual(html('loose text <b>bold</b><p>para</p>more'), '<p>loose text <strong>bold</strong></p><p>para</p><p>more</p>');
  assert.strictEqual(html('<p>a</p> tail'), '<p>a</p><p>tail</p>');
});

test('I1: a comment-only line, a dropped element and unclosed tags add no gap', () => {
  assert.strictEqual(html('<!-- note\nover lines -->\n<p>a</p>'), '<p>a</p>');
  assert.strictEqual(html('<script>\nx\n\ny\n</script>\n<p>a</p>'), '<p>a</p>');
  assert.strictEqual(html('<p>a\n<p>b'), '<p>a</p><p>b</p>');
  assert.strictEqual(html('<li>a\n<li>b'), '<p>a</p><p>b</p>');
});

test('I1: the line rule\'s output is clean: cleaning it again changes nothing', () => {
  for (const src of ['<p>one</p>\ntwo\n\nthree', '<strong>a\nb</strong>\n\n<ul>\n<li>x</li>\n</ul>', '\n\nx\n\n',
    '<table>\n<tr><td>a</td></tr>\n</table>\n\ntext <a href="https://a.b/c">l</a>']) {
    const out = html(src);
    assert.strictEqual(api.cleanTornHtml(out), out, JSON.stringify(src));
  }
});

test('I1: every HTML reader uses the line rule: Preview, Insert, and a switch to Markdown or Text', () => {
  const src = '<p>one</p>\ntwo\n\nthree';
  const post = '<p>one</p><p>two</p>' + GAP + '<p>three</p>';
  assert.strictEqual(preview('html', src).map((b) => b.html).join(''), post);
  assert.strictEqual(api.convertDraft(src, 'html', 'md'), 'one\ntwo\n\nthree');
  assert.strictEqual(api.htmlToMd(src), 'one\ntwo\n\nthree');
  assert.strictEqual(api.convertDraft(src, 'html', 'text'), 'one\ntwo\n\nthree');
});

test('I1: Preview taps return to the line each block came from', () => {
  const src = '<p>one</p>\ntwo\n\nthree';
  assert.deepStrictEqual(preview('html', src).map((b) => b.offset), [0, 11, 15, 16]);
  assert.strictEqual(src.slice(11, 14), 'two');
  assert.strictEqual(src.slice(16), 'three');
  const list = '<ul>\n<li>a</li>\n</ul>\n  <h2>b</h2>\nc';
  assert.deepStrictEqual(preview('html', list).map((b) => b.offset), [0, 24, 35]);
  assert.strictEqual(list.slice(24, 28), '<h2>');
  assert.strictEqual(list.slice(35), 'c');
  // A div holding two paragraphs is two Preview blocks, both tapping to the div.
  assert.deepStrictEqual(preview('html', 'x\n<div><p>a</p><p>b</p></div>').map((b) => [b.html, b.offset]),
    [['<p>x</p>', 0], ['<p>a</p>', 2], ['<p>b</p>', 2]]);
});

test('I1: Preview and Insert agree on messy typed HTML', () => {
  const messy = [
    '<p>a\n<p>b\nc', '<strong>x<p>y</p>z</strong>', '<a href="https://a.b">l\nm</a>', '<ul><li>a\n<li>b</ul>\n\nq',
    '<table><tr><td>a\n<td>b</table>x', '</p>stray\n</strong>\n', 'a<br>\n<br>\nb', '<p/>\n<p></p>', '<em>open',
  ];
  for (const src of messy) {
    assert.strictEqual(preview('html', src).map((b) => b.html).join(''), html(src), JSON.stringify(src));
  }
});

// ---- I2: Enter in the HTML editor (engine) -----------------------------------

const enter = (lang, text, at, shift, end) => api.editorEnter(lang, text, at, end === undefined ? at : end, !!shift);
const caretAt = (s, marker) => s.indexOf(marker);

test('I2: Enter inside a paragraph splits it and keeps its alignment on both halves', () => {
  const src = '<p style="text-align: center;">ab</p>';
  const r = enter('html', src, caretAt(src, 'b'));
  assert.strictEqual(r.text, '<p style="text-align: center;">a</p>\n<p style="text-align: center;">b</p>');
  assert.strictEqual(r.start, r.text.lastIndexOf('>b') + 1, 'the caret is after the new opening tag');
  assert.strictEqual(r.end, r.start);
  assert.strictEqual(html(r.text), '<p style="text-align: center;">a</p><p style="text-align: center;">b</p>');
});

test('I2: Enter at the end of a paragraph opens an empty one there; left empty, it is a gap', () => {
  const src = '<p>ab</p>';
  const r = enter('html', src, 5);
  assert.strictEqual(r.text, '<p>ab</p>\n<p></p>');
  assert.strictEqual(r.start, 13);
  assert.strictEqual(html(r.text), '<p>ab</p>' + GAP);
});

test('I2: Enter inside a list item splits the item', () => {
  const src = '<ul><li>ab</li></ul>';
  const r = enter('html', src, caretAt(src, 'b'));
  assert.strictEqual(r.text, '<ul><li>a</li>\n<li>b</li></ul>');
  assert.strictEqual(r.start, r.text.indexOf('b'));
  assert.strictEqual(html(r.text), '<ul><li>a</li><li>b</li></ul>');
});

test('round 2 fix: Enter on an empty list item ends the list, as an empty Markdown marker does', () => {
  // The owner's case: Enter, Enter at the end of a list.
  const src = '<ul>\n<li>a</li>\n</ul>';
  const one = enter('html', src, caretAt(src, 'a') + 1);
  assert.strictEqual(one.text, '<ul>\n<li>a</li>\n<li></li>\n</ul>');
  const two = enter('html', one.text, one.start);
  assert.strictEqual(two.text, '<ul>\n<li>a</li>\n</ul>\n', 'the empty item and its line are gone');
  assert.strictEqual(two.start, two.text.length, 'the caret is on a new top-level line after </ul>');
  assert.strictEqual(two.end, two.start);
  assert.strictEqual(html(two.text + 'next'), '<ul><li>a</li></ul><p>next</p>', 'what is typed there is a paragraph');
  assert.strictEqual(html(two.text), api.postHtml('- a\n', 'md'), 'Insert posts no empty bullet, as Markdown\'s ended list');
  // Numbered lists, one-line markup, and text after the list.
  const ol = '<ol><li>a</li><li></li></ol>\n<p>after</p>';
  const r = enter('html', ol, ol.indexOf('</li></ol>'));
  assert.strictEqual(r.text, '<ol><li>a</li></ol>\n\n<p>after</p>');
  assert.strictEqual(r.start, '<ol><li>a</li></ol>\n'.length);
  // Whitespace and open inline tags before the caret still count as empty.
  const nested = '<ul>\n<li>a</li>\n<li> <strong><em></em></strong></li>\n</ul>';
  const n = enter('html', nested, nested.indexOf('</em>'));
  assert.strictEqual(n.text, '<ul>\n<li>a</li>\n</ul>\n');
  // A nested list's empty item leaves only the inner list.
  const inner = '<ul><li>a<ul><li>b</li><li></li></ul></li></ul>';
  const i = enter('html', inner, inner.lastIndexOf('<li></li>') + 4);
  assert.strictEqual(i.text, '<ul><li>a<ul><li>b</li></ul>\n</li></ul>');
  // A nested list after the empty item is skipped: the caret goes after the
  // item's own list.
  const before = '<ul><li></li><li>b<ul><li>c</li></ul></li></ul>x';
  const k = enter('html', before, 8);
  assert.strictEqual(k.text, '<ul><li>b<ul><li>c</li></ul></li></ul>\nx');
  assert.strictEqual(k.start, k.text.indexOf('x'));
});

test('round 2 fix: a list item with anything in it still continues the list', () => {
  for (const [src, at, want] of [
    ['<ul>\n<li>a</li>\n</ul>', 10,'<ul>\n<li>a</li>\n<li></li>\n</ul>'],
    ['<ol><li><strong>x</strong></li></ol>', 26, '<ol><li><strong>x</strong></li>\n<li></li></ol>'],
    ['<ul><li><img src="https://x.test/a.png"></li></ul>', 40, '<ul><li><img src="https://x.test/a.png"></li>\n<li></li></ul>'],
    ['<ul><li>a</li></ul>', 8, '<ul><li></li>\n<li>a</li></ul>'],
  ]) {
    assert.strictEqual(enter('html', src, at).text, want, JSON.stringify(src));
  }
});

test('I2: inline elements open at the caret close before the split and reopen after it', () => {
  const src = '<p><strong><em>ab</em></strong></p>';
  const r = enter('html', src, caretAt(src, 'b'));
  assert.strictEqual(r.text, '<p><strong><em>a</em></strong></p>\n<p><strong><em>b</em></strong></p>');
  assert.strictEqual(r.start, r.text.lastIndexOf('b'));
  const li = '<ol><li><p>x</p></li></ol>';
  assert.strictEqual(enter('html', li, caretAt(li, 'x') + 1).text, '<ol><li><p>x</p>\n<p></p></li></ol>', 'the innermost paragraph splits');
});

test('I2: elsewhere Enter is the browser\'s newline, which the line rule makes a paragraph', () => {
  assert.strictEqual(enter('html', '<p>ab</p>', 9), null, 'after the closing tag');
  assert.strictEqual(enter('html', 'plain', 2), null, 'loose text');
  assert.strictEqual(enter('html', '<p style="text-align: center;">a</p>', 10), null, 'inside the tag\'s own markup');
  assert.strictEqual(enter('html', '<p>a\nb</p>', 7), null, 'inside the closing tag\'s markup');
});

test('I2: Shift+Enter in HTML is a line break, <br>, with no newline', () => {
  const r = enter('html', '<p>ab</p>', 4, true);
  assert.strictEqual(r.text, '<p>a<br>b</p>');
  assert.strictEqual(r.start, 8);
  assert.strictEqual(enter('html', 'loose', 5, true).text, 'loose<br>');
});

test('I2: Enter over a selection replaces it, then splits', () => {
  const r = enter('html', '<p>aXXb</p>', 4, false, 6);
  assert.strictEqual(r.text, '<p>a</p>\n<p>b</p>');
});

test('I2/I4: Text mode always keeps the browser\'s Enter', () => {
  assert.strictEqual(enter('text', '<p>ab</p>', 4), null);
  assert.strictEqual(enter('text', '- a', 3), null);
  assert.strictEqual(enter('text', 'a', 1, true), null);
});

// ---- I3: Enter in Markdown (engine) ------------------------------------------

test('I3: a bullet line continues with the same bullet', () => {
  for (const b of ['-', '*', '+']) {
    const r = enter('md', b + ' one', 5);
    assert.strictEqual(r.text, b + ' one\n' + b + ' ');
    assert.strictEqual(r.start, r.text.length);
  }
  assert.strictEqual(enter('md', '  - in', 6).text, '  - in\n  - ', 'its indent too');
  assert.strictEqual(enter('md', '- ab', 3).text, '- a\n- b', 'mid-line splits into two items');
});

test('I3: a numbered line continues with the next number', () => {
  assert.strictEqual(enter('md', '1. one', 6).text, '1. one\n2. ');
  assert.strictEqual(enter('md', 'x\n9) nine', 9).text, 'x\n9) nine\n10) ');
});

test('I3: a quote line continues the quote', () => {
  assert.strictEqual(enter('md', '> said', 6).text, '> said\n> ');
  assert.strictEqual(enter('md', '>said', 5).text, '>said\n> ');
});

test('I3: Enter on a line that is only the marker removes it, which ends the list or quote', () => {
  for (const [src, kept] of [['- a\n- ', '- a\n'], ['1. a\n2. ', '1. a\n'], ['> a\n> ', '> a\n'], ['> a\n>', '> a\n'], ['- a\n-   \nnext', '- a\n\nnext']]) {
    const at = src.indexOf('\n') + 1 + src.split('\n')[1].length;
    const r = enter('md', src, at);
    assert.strictEqual(r.text, kept, JSON.stringify(src));
    assert.strictEqual(r.start, src.indexOf('\n') + 1, 'the caret stays on the now empty line');
  }
  // The emptied line is a gap: the list ended.
  assert.strictEqual(api.postHtml('- a\n', 'md'), '<ul><li>a</li></ul>' + GAP);
});

// ---- fix round 1: Enter never stops working inside a paragraph ----------------

test('fix 1: Enter inside a paragraph opened on an earlier line still splits it', () => {
  // A raw newline before </p> (a missed Enter, a paste, an old draft).
  const src = '<p style="text-align: center;">hello\n</p>';
  const r = enter('html', src, src.indexOf('</p>'));
  assert.ok(r, 'the editor still acts');
  assert.strictEqual(r.text, '<p style="text-align: center;">hello\n</p>\n<p style="text-align: center;"></p>');
  assert.strictEqual(r.start, r.text.length - 4);
  const typed = r.text.slice(0, r.start) + 'world' + r.text.slice(r.start);
  assert.strictEqual(html(typed), '<p style="text-align: center;">hello</p><p style="text-align: center;">world</p>');
  // Over several lines, with inline elements opened on earlier lines.
  const multi = '<p><strong>one\ntwo\nthree</strong></p>';
  assert.strictEqual(enter('html', multi, multi.indexOf('three')).text,
    '<p><strong>one\ntwo\n</strong></p>\n<p><strong>three</strong></p>');
  const item = '<ul>\n<li>a\nb</li>\n</ul>';
  assert.strictEqual(enter('html', item, item.indexOf('b') + 1).text, '<ul>\n<li>a\nb</li>\n<li></li>\n</ul>');
});

test('fix 1: a blank line inside an open top-level paragraph ends it, so lines can never merge for good', () => {
  assert.strictEqual(html('<p style="text-align: center;">hello\n\nworld</p>'),
    '<p style="text-align: center;">hello</p>' + GAP + '<p>world</p>');
  assert.strictEqual(html('<p>a\n\n\nb\nc</p>'), '<p>a</p>' + GAP + GAP + '<p>b</p><p>c</p>');
  assert.strictEqual(html('<p>a\n   \nb</p>'), '<p>a</p>' + GAP + '<p>b</p>', 'a line of spaces is blank');
  assert.strictEqual(html('<h2>T\n\nbody</h2>'), api.cleanTornHtml('<h2>T</h2>') + GAP + '<p>body</p>');
  // A pasted multi-line paragraph with blank lines.
  assert.strictEqual(html('<p>first line\nstill first\n\nsecond para\n\nthird</p>'),
    '<p>first line still first</p>' + GAP + '<p>second para</p>' + GAP + '<p>third</p>');
  // Only a top-level paragraph: inside a quote or a list a blank line is whitespace.
  assert.strictEqual(html('<blockquote><p>a\n\nb</p></blockquote>'), '<blockquote><p>a b</p></blockquote>');
  assert.strictEqual(html('<ul><li>a\n\nb</li></ul>'), '<ul><li>a b</li></ul>');
  // After the blank line the paragraph is closed, so Enter is the browser's newline.
  assert.strictEqual(enter('html', '<p>a\n\nb</p>', 8), null);
  // Preview agrees, with the tap offset on the new line.
  const src = '<p>a\n\nb</p>';
  assert.deepStrictEqual(preview('html', src).map((b) => [b.html, b.offset]), [['<p>a</p>', 0], [GAP, 5], ['<p>b</p>', 6]]);
});

test('fix 1: Enter at the end of a heading starts a plain paragraph', () => {
  const h = '<p><span style="font-size: 24px;"><strong>Title</strong></span></p>';
  const r = enter('html', h, h.indexOf('</strong>'));
  assert.strictEqual(r.text, h + '\n<p></p>');
  assert.strictEqual(r.start, r.text.length - 4);
  // In the middle of a heading the heading splits as any paragraph does.
  assert.strictEqual(enter('html', h, h.indexOf('tle')).text,
    '<p><span style="font-size: 24px;"><strong>Ti</strong></span></p>\n<p><span style="font-size: 24px;"><strong>tle</strong></span></p>');
  // Bold text that is not a heading keeps its bold on the new line.
  const b = '<p><strong>bold</strong></p>';
  assert.strictEqual(enter('html', b, b.indexOf('</strong>')).text, '<p><strong>bold</strong></p>\n<p><strong></strong></p>');
});

test('fix 1: unclosed inline tags over thousands of lines stay linear and bounded', () => {
  const M = api.DRAFT_MAX_CHARS;
  let spans = '';
  for (let i = 0; spans.length < M; i += 1) spans += '<span style="color: #' + String(100000 + i).slice(0, 6) + ';">x\n';
  for (const src of [
    '<b>x\n'.repeat(M / 5),
    '<b><i><u><s><em><strong>x\n'.repeat(Math.ceil(M / 27)).slice(0, M),
    spans.slice(0, M),
  ]) {
    const t0 = Date.now();
    const out = html(src);
    const pv = preview('html', src);
    const ms = Date.now() - t0;
    assert.ok(ms < 2000, 'took ' + ms + 'ms');
    assert.ok(out.length < 16 * src.length, 'output ' + out.length + ' for ' + src.length + ' typed');
    assert.strictEqual(pv.map((b) => b.html).join(''), out);
  }
  // What is reopened is still right for ordinary nesting.
  assert.strictEqual(html('<b><i>a\nb</i></b>'), '<p><strong><em>a</em></strong></p><p><strong><em>b</em></strong></p>');
});

test('I3: other lines, a caret before the marker, and Shift+Enter keep the browser\'s newline', () => {
  assert.strictEqual(enter('md', 'plain', 5), null);
  assert.strictEqual(enter('md', '-not a list', 4), null);
  assert.strictEqual(enter('md', '**bold**', 8), null);
  assert.strictEqual(enter('md', '- a', 0), null, 'caret at the line start');
  assert.strictEqual(enter('md', '- a', 3, true), null);
});

// ---- I4 and I6: every mode agrees ---------------------------------------------

test('I6: the same visible post typed in Markdown, HTML and Text gives the same paragraphs and gaps', () => {
  const post = 'Hello there\nsecond line\n\nafter a gap\n\n\ntwo gaps';
  const want = '<p>Hello there</p><p>second line</p>' + GAP + '<p>after a gap</p>' + GAP + GAP + '<p>two gaps</p>';
  for (const lang of ['md', 'html', 'text']) {
    assert.strictEqual(api.postHtml(post, lang), want, lang);
    // I4: Preview shows exactly what Insert sends, gaps included.
    assert.strictEqual(preview(lang, post).map((b) => b.html).join(''), want, 'Preview ' + lang);
    assert.strictEqual(preview(lang, post).filter((b) => b.html === GAP).length, 3, 'Preview shows the gaps in ' + lang);
  }
});

test('I6: switching Markdown to HTML and back never merges lines', () => {
  const md = 'one\ntwo\n\nthree\n- a\n- b\n\n> q\nlast';
  const src = api.convertDraft(md, 'md', 'html');
  assert.strictEqual(api.convertDraft(src, 'html', 'md'), md);
  // And HTML typed by the player, switched to Markdown and back, keeps its paragraphs and gaps.
  const typed = '<p>one</p>\ntwo\n\nthree';
  const back = api.convertDraft(api.convertDraft(typed, 'html', 'md'), 'md', 'html');
  assert.strictEqual(html(back), html(typed));
  assert.strictEqual(api.convertDraft(api.convertDraft(typed, 'html', 'text'), 'text', 'html'), back);
});

// ---- I2, I3, I5: the runtime -------------------------------------------------

const NOW = 1700000000000;
const THREAD = Object.assign({}, FORUMS_LOCATION, { hash: '#/p=threads&f=1&t=42&b=0&a=0' });

function bootEditor(lang, text) {
  const env = loadUserscript({ location: THREAD, now: NOW, panelWidth: 900, panelPadding: 8, htmlQuery: true });
  const a = env.exports;
  a.state.route = a.parseForumRoute(env.win.location);
  a.state.settings.view = 'drafts';
  a.state.settings.draftLang = lang;
  a.state.drafts = a.saveDraft(a.freshDrafts(), 42, text, NOW - 5000, 'T', lang);
  redraw(env);
  return { env, api: a };
}

const fieldOf = (env) => panelOf(env).querySelector('[data-act="draft-text"]');

// A real keydown on the panel's textarea, as the browser delivers it.
function press(env, at, extra, end) {
  const ta = fieldOf(env);
  assert.ok(ta, 'no draft textarea rendered');
  if (ta.value === undefined) ta.value = env.exports.state.editor.text;
  ta.selectionStart = at;
  ta.selectionEnd = end === undefined ? at : end;
  let prevented = 0;
  panelOf(env).dispatchEvent(Object.assign({ type: 'keydown', key: 'Enter', target: ta, preventDefault() { prevented += 1; } }, extra || {}));
  return { ta, prevented };
}

test('I2/I5: Enter in an HTML paragraph edits the field in place: text, caret, Undo, dirty', () => {
  const src = '<p style="text-align: center;">ab</p>';
  const { env, api: a } = bootEditor('html', src);
  const undoBefore = a.state.editor.undo.length;
  const { ta, prevented } = press(env, src.indexOf('b'));
  const want = '<p style="text-align: center;">a</p>\n<p style="text-align: center;">b</p>';
  assert.strictEqual(prevented, 1, 'the browser\'s own newline is cancelled');
  assert.strictEqual(ta.value, want, 'the field on screen holds the split');
  assert.deepStrictEqual(ta.selection, [want.lastIndexOf('>b') + 1, want.lastIndexOf('>b') + 1], 'the caret is after the new opening tag');
  assert.strictEqual(fieldOf(env), ta, 'no redraw replaced the field (the keyboard stays up)');
  assert.strictEqual(a.state.editor.text, want);
  assert.strictEqual(a.state.editor.selStart, want.lastIndexOf('>b') + 1);
  assert.strictEqual(a.state.editor.dirty, true);
  assert.strictEqual(a.state.editor.undo.length, undoBefore + 1, 'one Undo step');
  assert.strictEqual(a.editorPostHtml(), '<p style="text-align: center;">a</p><p style="text-align: center;">b</p>');
});

test('I5: Undo reverses an Enter edit', () => {
  const src = '<ul><li>ab</li></ul>';
  const { env, api: a } = bootEditor('html', src);
  press(env, src.indexOf('b'));
  assert.strictEqual(a.state.editor.text, '<ul><li>a</li>\n<li>b</li></ul>');
  redraw(env);
  click(env, '[data-act="ed-undo"]');
  assert.strictEqual(a.state.editor.text, src);
  assert.strictEqual(a.state.editor.selStart, src.indexOf('b'), 'the caret goes back where it was');
});

test('round 2 fix: Enter twice at the end of an HTML list ends it in the panel', () => {
  const src = '<ul>\n<li>a</li>\n</ul>';
  const { env, api: a } = bootEditor('html', src);
  press(env, 10);
  assert.strictEqual(a.state.editor.text, '<ul>\n<li>a</li>\n<li></li>\n</ul>');
  const { ta, prevented } = press(env, 20);
  assert.strictEqual(prevented, 1);
  assert.strictEqual(ta.value, '<ul>\n<li>a</li>\n</ul>\n');
  assert.deepStrictEqual(ta.selection, [22, 22], "the caret is on the new line after </ul>");
  assert.doesNotMatch(a.editorPostHtml(), /<li><\/li>/, 'no empty bullet reaches Insert');
});

test('I2: Shift+Enter in HTML inserts <br>', () => {
  const { env, api: a } = bootEditor('html', '<p>ab</p>');
  const { ta, prevented } = press(env, 4, { shiftKey: true });
  assert.strictEqual(prevented, 1);
  assert.strictEqual(ta.value, '<p>a<br>b</p>');
  assert.strictEqual(a.state.editor.text, '<p>a<br>b</p>');
});

test('I2: where the editor has nothing to do, the browser\'s Enter goes through untouched', () => {
  const { env, api: a } = bootEditor('html', '<p>ab</p>');
  const { ta, prevented } = press(env, 9);
  assert.strictEqual(prevented, 0);
  assert.strictEqual(ta.value, '<p>ab</p>');
  assert.strictEqual(a.state.editor.undo.length, 0);
});

test('I3: Enter in Markdown continues a list and ends it on an empty item', () => {
  const { env, api: a } = bootEditor('md', '- one');
  const first = press(env, 5);
  assert.strictEqual(first.prevented, 1);
  assert.strictEqual(a.state.editor.text, '- one\n- ');
  assert.deepStrictEqual(first.ta.selection, [8, 8]);
  const second = press(env, 8);
  assert.strictEqual(second.prevented, 1);
  assert.strictEqual(a.state.editor.text, '- one\n');
  assert.deepStrictEqual(second.ta.selection, [6, 6]);
  assert.strictEqual(a.state.editor.undo.length, 2, 'each Enter is its own Undo step');
});

test('I4: Text mode keeps the browser\'s Enter, and Preview matches Insert', () => {
  const { env, api: a } = bootEditor('text', '- one');
  const { prevented } = press(env, 5);
  assert.strictEqual(prevented, 0);
  assert.strictEqual(a.state.editor.text, '- one');
  const post = 'one\n\ntwo';
  assert.strictEqual(a.previewModel('text', post).map((b) => b.html).join(''), a.postHtml(post, 'text'));
  assert.strictEqual(a.postHtml(post, 'text'), '<p>one</p>' + GAP + '<p>two</p>');
});

test('an IME composing Enter is left to the IME', () => {
  for (const ime of [{ isComposing: true }, { keyCode: 229 }]) {
    const { env, api: a } = bootEditor('html', '<p>ab</p>');
    const { ta, prevented } = press(env, 4, ime);
    assert.strictEqual(prevented, 0, JSON.stringify(ime));
    assert.strictEqual(ta.value, '<p>ab</p>');
    assert.strictEqual(a.state.editor.text, '<p>ab</p>');
  }
});

test('Ctrl, Cmd and Alt+Enter and other keys are not the editor\'s', () => {
  for (const extra of [{ ctrlKey: true }, { metaKey: true }, { altKey: true }, { key: 'a' }, { key: 'Tab' }]) {
    const { env, api: a } = bootEditor('md', '- one');
    const { prevented } = press(env, 5, extra);
    assert.strictEqual(prevented, 0, JSON.stringify(extra));
    assert.strictEqual(a.state.editor.text, '- one');
  }
});

test('I5: an Enter edit past the draft limit is refused with the limit message', () => {
  const big = '<p>' + 'x'.repeat(api.DRAFT_MAX_CHARS - 9) + '</p>';
  assert.strictEqual(big.length, api.DRAFT_MAX_CHARS - 2);
  const { env, api: a } = bootEditor('html', big);
  const { prevented } = press(env, 5);
  assert.strictEqual(prevented, 1, 'the newline would not fit either way');
  assert.strictEqual(a.state.editor.text, big, 'nothing was cut or changed');
  assert.ok(a.state.notices.some((n) => /limit/.test(n.text)), 'the player is told');
});

test('I5: a browser with setRangeText gets only the changed range, so its scroll stays', () => {
  const src = '<p>ab</p>\n<p>tail</p>';
  const { env, api: a } = bootEditor('html', src);
  const ta = fieldOf(env);
  ta.value = src;
  const calls = [];
  ta.setRangeText = function (ins, s, e, mode) { calls.push([ins, s, e, mode]); this.value = this.value.slice(0, s) + ins + this.value.slice(e); };
  press(env, 4);
  assert.deepStrictEqual(calls, [['</p>\n<p>', 4, 4, 'end']]);
  assert.strictEqual(ta.value, '<p>a</p>\n<p>b</p>\n<p>tail</p>');
  assert.strictEqual(a.state.editor.text, ta.value);
});

test('I5: a field typed ahead of the mirror is read from the field, not the stale mirror', () => {
  const { env, api: a } = bootEditor('md', '- one');
  const ta = fieldOf(env);
  ta.value = '- one two';
  press(env, 9);
  assert.strictEqual(a.state.editor.text, '- one two\n- ');
  // Undo goes back to the typed text, not to what the mirror had.
  redraw(env);
  click(env, '[data-act="ed-undo"]');
  assert.strictEqual(a.state.editor.text, '- one two');
});

test('Insert after typing in HTML with Enter and blank lines keeps the gaps', () => {
  const { env, api: a } = bootEditor('html', '<p>one</p>');
  const ta = fieldOf(env);
  // The browser's own newlines (no paragraph open at the caret) and typing.
  ta.value = '<p>one</p>\ntwo\n\nthree';
  ta.selectionStart = ta.selectionEnd = ta.value.length;
  panelOf(env).dispatchEvent({ type: 'input', target: ta });
  assert.strictEqual(a.editorPostHtml(), '<p>one</p><p>two</p>' + GAP + '<p>three</p>');
});

// ---- fix round 1: runtime ----------------------------------------------------

// The field's beforeinput, as a phone keyboard delivers a line break.
function beforeInput(env, at, inputType, end) {
  const ta = fieldOf(env);
  if (ta.value === undefined) ta.value = env.exports.state.editor.text;
  ta.selectionStart = at;
  ta.selectionEnd = end === undefined ? at : end;
  let prevented = 0;
  panelOf(env).dispatchEvent({ type: 'beforeinput', inputType, target: ta, preventDefault() { prevented += 1; } });
  return { ta, prevented };
}
const keyup = (env) => panelOf(env).dispatchEvent({ type: 'keyup', key: 'Enter', target: fieldOf(env) });

test('fix 1: Enter after a raw newline inside a paragraph still splits it in the panel', () => {
  const src = '<p style="text-align: center;">hello\n</p>';
  const { env, api: a } = bootEditor('html', src);
  const { ta, prevented } = press(env, src.indexOf('</p>'));
  assert.strictEqual(prevented, 1);
  assert.strictEqual(ta.value, '<p style="text-align: center;">hello\n</p>\n<p style="text-align: center;"></p>');
  assert.strictEqual(a.editorPostHtml(), '<p style="text-align: center;">hello</p><p style="text-align: center;">&nbsp;</p>');
});

test('fix 1: a pasted multi-line paragraph with blank lines inserts as paragraphs and gaps', () => {
  const { env, api: a } = bootEditor('html', '');
  const ta = fieldOf(env);
  ta.value = '<p>first line\nstill first\n\nsecond para</p>';
  ta.selectionStart = ta.selectionEnd = ta.value.length;
  panelOf(env).dispatchEvent({ type: 'input', target: ta });
  assert.strictEqual(a.editorPostHtml(), '<p>first line still first</p>' + GAP + '<p>second para</p>');
});

test('phone keyboards: an Enter reported as keyCode 229 is handled by the field\'s beforeinput', () => {
  const src = '<p>ab</p>';
  const { env, api: a } = bootEditor('html', src);
  const down = press(env, 4, { keyCode: 229 });
  assert.strictEqual(down.prevented, 0, 'the keydown is left alone');
  const bi = beforeInput(env, 4, 'insertLineBreak');
  assert.strictEqual(bi.prevented, 1);
  assert.strictEqual(bi.ta.value, '<p>a</p>\n<p>b</p>');
  assert.strictEqual(a.state.editor.text, '<p>a</p>\n<p>b</p>');
  assert.strictEqual(a.state.editor.undo.length, 1, 'one Undo step');
  keyup(env);
  // insertParagraph is handled the same way; other input types are not.
  const { env: env2, api: a2 } = bootEditor('md', '- one');
  assert.strictEqual(beforeInput(env2, 5, 'insertText').prevented, 0);
  assert.strictEqual(a2.state.editor.text, '- one');
  assert.strictEqual(beforeInput(env2, 5, 'insertParagraph').prevented, 1);
  assert.strictEqual(a2.state.editor.text, '- one\n- ');
});

test('one Enter is never handled twice: a keydown that decided it leaves its beforeinput alone', () => {
  // Shift+Enter in Markdown is the browser's newline: its beforeinput must not continue the list.
  const { env, api: a } = bootEditor('md', '- one');
  assert.strictEqual(press(env, 5, { shiftKey: true }).prevented, 0);
  assert.strictEqual(beforeInput(env, 5, 'insertLineBreak').prevented, 0);
  assert.strictEqual(a.state.editor.text, '- one');
  keyup(env);
  // After the press ends, a keyboard that sends only beforeinput is handled again.
  assert.strictEqual(beforeInput(env, 5, 'insertLineBreak').prevented, 1);
  assert.strictEqual(a.state.editor.text, '- one\n- ');
  // Ctrl+Enter inserts nothing, so no beforeinput consumes its mark: the
  // keyup ends the press, and a later lone line break is handled.
  const { env: env3, api: a3 } = bootEditor('md', '- one');
  assert.strictEqual(press(env3, 5, { ctrlKey: true }).prevented, 0);
  keyup(env3);
  assert.strictEqual(beforeInput(env3, 5, 'insertLineBreak').prevented, 1);
  assert.strictEqual(a3.state.editor.text, '- one\n- ');
  // A keydown the editor handled (no beforeinput follows) leaves no stale mark
  // for the next press from a phone keyboard.
  const { env: env2, api: a2 } = bootEditor('html', '<p>ab</p>');
  assert.strictEqual(press(env2, 4).prevented, 1);
  press(env2, 12, { keyCode: 229 });
  assert.strictEqual(beforeInput(env2, 12, 'insertLineBreak').prevented, 1);
  assert.strictEqual(a2.state.editor.text, '<p>a</p>\n<p></p>\n<p>b</p>');
});

test('an Enter edit that reaches the limit marks the draft at the limit, as typing does', () => {
  const big = '<p>' + 'x'.repeat(api.DRAFT_MAX_CHARS - 15) + '</p>';
  const { env, api: a } = bootEditor('html', big);
  assert.strictEqual(a.state.editor.atLimit, false);
  press(env, 5);
  assert.strictEqual(a.state.editor.text.length, api.DRAFT_MAX_CHARS);
  assert.strictEqual(a.state.editor.atLimit, true);
});

test('round 2 fix: Enter in the fixer\'s Image link field runs Check and never reaches the draft', () => {
  const src = '<p>ab</p>';
  const { env, api: a } = bootEditor('html', src);
  const ta = fieldOf(env);
  ta.value = src;
  ta.selectionStart = 4;
  ta.selectionEnd = 4;
  click(env, '[data-act="ed-fix-open"]');
  const input = panelOf(env).querySelector('[data-act="ed-fix-url"]');
  assert.ok(input, 'the fixer section is open');
  input.value = 'https://drive.google.com/file/d/1GfhII9A5yDKVLFVv0F1SEPivpxvREb-h/view?usp=sharing';
  let prevented = 0;
  const key = (extra) => panelOf(env).dispatchEvent(Object.assign({ type: 'keydown', key: 'Enter', target: input, preventDefault() { prevented += 1; } }, extra || {}));
  key({ key: 'a' });
  assert.strictEqual(prevented, 0, 'other keys are typing');
  assert.strictEqual(a.state.editor.fixCheck, null);
  key();
  assert.strictEqual(prevented, 1, 'the form-less field has no newline to keep');
  assert.ok(a.state.editor.fixCheck, 'Check ran on the typed link');
  assert.match(a.state.editor.fixCheck.url || JSON.stringify(a.state.editor.fixCheck), /drive\.google\.com\/thumbnail\?id=1GfhII9A5yDKVLFVv0F1SEPivpxvREb-h/);
  assert.strictEqual(a.state.editor.text, src, 'the draft was not split');
  assert.strictEqual(a.state.editor.undo.length, 0);
  key({ isComposing: true });
  assert.strictEqual(prevented, 1, 'an IME Enter is the IME\'s');
});
