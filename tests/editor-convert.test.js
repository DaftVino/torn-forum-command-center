'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { loadUserscript } = require('./load-userscript');

const { exports: api } = loadUserscript();
const SAMPLE = fs.readFileSync(path.join(__dirname, '..', 'docs', 'reference', 'torn-forum-post-sample.html'), 'utf8');
// The owner's toolbar test, from docs/reference/torn-forum-editor-findings-2026-10-09.md.
const TOOLBAR = '<blockquote><p><span style="text-decoration: underline;" data-mce-style="x">this </span>'
  + '<strong>is </strong>a <span style="color: var(--te-text-color-red);">red </span>'
  + '<span style="font-size: 10px;">test </span>a <em>table </em>below '
  + '<img src="/images/emotions/svg/angel.svg" data-mce-src="/images/emotions/svg/angel.svg">and&nbsp;</p></blockquote>'
  + '<table class="mce-item-table" style="width: 39.0052%; height: 154px;"><tbody><tr style="height: 28px;">'
  + '<th style="width: 34.6966%; height: 28px;">Route</th></tr><tr><td>Foundation</td></tr></tbody></table>'
  + '<p><br data-mce-bogus="1"></p><p><img src="https://editor.torn.com/abc-1.jpg"></p>';
const EDGES = [
  '<p>plain</p>',
  '<p style="text-align: center;">c</p><p style="text-align: center;">&nbsp;</p><p>x</p>',
  '<ul><li>a</li><li>b <strong>c</strong></li></ul><ul><li>second list</li></ul>',
  '<blockquote><p>q1</p><p>&nbsp;</p><p>q2</p></blockquote>',
  '<p><strong><em>both</em></strong> and <em><strong>both2</strong></em></p>',
  '<p>2*3*4 = a++b ~~ {red} [x] :grin: \\ & &lt;</p>',
  '<p>- not a list</p><p># not a heading</p><p>1. not ordered</p><p>&gt; not quote</p><p>| not table</p><p>:::center</p>',
  '<h2>Heading</h2><h1 style="text-align:right">Big</h1>',
  '<p><a href="https://a.b/c">link <strong>bold</strong></a> <a href="https://x.y/(paren)">p</a></p>',
  '<table><tr><td>a|b</td><td style="text-align:center">c</td></tr><tr><td>d</td><td style="text-align:center">e</td></tr></table>',
  '<table><tr><th>H</th><th style="text-align:right">R</th></tr><tr><td>1</td><td style="text-align:right">2</td></tr></table>',
  '<p>line<br>break</p>',
  '<p><span style="color:#FF8800; font-size: 14px; text-decoration: line-through">multi</span></p>',
  '<ol><li>one</li><li>two</li></ol>',
  'loose text <b>bold</b><p>para</p>more',
  '<p><img src="https://i.imgur.com/a.png" alt="the alt"></p>',
  '<p>&nbsp;&nbsp;indented</p>',
  '<p>a <span style="font-size: 18px;"><strong>not heading</strong></span> b</p>',
  '<p><span style="font-size: 24px;"><strong>real heading</strong></span></p>',
];

test('Markdown round-trips every cleaned fixture: nothing is lost', () => {
  for (const h of [SAMPLE, TOOLBAR].concat(EDGES)) {
    const c = api.cleanTornHtml(h);
    assert.strictEqual(api.mdToHtml(api.htmlToMd(c)), c, h.slice(0, 60));
  }
});

test('what Markdown can say is said in Markdown, not raw HTML', () => {
  assert.strictEqual(api.htmlToMd('<p><strong>b</strong> <span style="color: var(--te-text-color-red);">r</span></p>'),
    '**b** {red}r{/}');
  assert.strictEqual(api.htmlToMd('<p><span style="font-size: 24px;"><strong>T</strong></span></p><p>&nbsp;</p><ul><li>a</li></ul>'),
    '# T\n\n- a');
  assert.strictEqual(api.htmlToMd('<p><img src="/images/emotions/svg/grin.svg"></p>'), ':grin:');
});

test('a construct Markdown cannot say stays as cleaned inline HTML', () => {
  const md = api.htmlToMd('<table style="width: 40%;"><tr><td>x</td></tr></table>');
  assert.match(md, /^<div><div><div class="table-wrap"><table style="width: 40%;">/);
});

test('switching modes repeatedly settles after the first switch (Review Focus 4)', () => {
  let t = '# T\n{red}r{/} **b**\n| a | b |\n| --- | --- |\n| 1 | 2 |';
  const html1 = api.convertDraft(t, 'md', 'html');
  const md1 = api.convertDraft(html1, 'html', 'md');
  const html2 = api.convertDraft(md1, 'md', 'html');
  const md2 = api.convertDraft(html2, 'html', 'md');
  assert.strictEqual(html2, html1);
  assert.strictEqual(md2, md1);
  t = md2;
});

test('text conversions escape, and Text is the formatting-free view', () => {
  assert.strictEqual(api.textToMd('Hello *world*\n\n- not list'), 'Hello \\*world\\*\n\n\\- not list');
  assert.strictEqual(api.mdToHtml(api.textToMd('a <b> & c')), api.textToHtml('a <b> & c'));
  assert.strictEqual(api.textToHtml('<b>x</b>'), '<p>&lt;b&gt;x&lt;/b&gt;</p>');
  assert.strictEqual(api.htmlToText(api.mdToHtml('# T\n- a\n| x | y |\n> q\n:grin:')), 'T\n- a\nx | y\n> q\n:grin:');
});

test('postHtml is the cleaned post in each language', () => {
  assert.strictEqual(api.postHtml('**b**', 'md'), '<p><strong>b</strong></p>');
  assert.strictEqual(api.postHtml('<b>b</b>', 'html'), '<p><strong>b</strong></p>');
  assert.strictEqual(api.postHtml('**b**', 'text'), '<p>**b**</p>');
});

test('the preview model maps each block to its source offset', () => {
  assert.deepStrictEqual(api.previewModel('md', '# T\n\ntext\n- a\n- b').map((b) => b.offset), [0, 4, 5, 10]);
  assert.deepStrictEqual(api.previewModel('html', '<p>a</p>\n  <h2>b</h2>').map((b) => b.offset), [0, 11]);
  assert.deepStrictEqual(api.previewModel('text', 'one\n\ntwo').map((b) => b.html), ['<p>one</p>', '<p>&nbsp;</p>', '<p>two</p>']);
});

test('previewImages holds external images back and never touches Torn emoji', () => {
  const h = '<p><img src="https://i.imgur.com/x.png" alt="a"> <img src="/images/emotions/svg/grin.svg"></p>';
  assert.strictEqual(api.previewImages(h, false),
    '<p><span class="tfcc-img-ph">[image from i.imgur.com]</span> <img src="/images/emotions/svg/grin.svg"></p>');
  assert.strictEqual(api.previewImages(h, true),
    '<p><img referrerpolicy="no-referrer" src="https://i.imgur.com/x.png" alt="a"> <img src="/images/emotions/svg/grin.svg"></p>');
});
