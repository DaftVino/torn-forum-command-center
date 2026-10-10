'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { loadUserscript } = require('./load-userscript');

const { exports: api } = loadUserscript();
const md = api.mdToHtml;
const BS = String.fromCharCode(92);

test('each line is a paragraph and each empty line a visible gap', () => {
  assert.strictEqual(md('one\n\ntwo'), '<p>one</p><p>&nbsp;</p><p>two</p>');
  assert.strictEqual(md(''), '');
});

test('Windows line endings convert exactly like Unix ones (Review Focus 1)', () => {
  assert.strictEqual(md('a\r\n\r\nb'), md('a\n\nb'));
  assert.deepStrictEqual(api.mdBlocks('a\r\nb').map((b) => b.line), [0, 1]);
});

test('every dialect row of spec section 3', () => {
  const rows = [
    ['**b** *i*', '<p><strong>b</strong> <em>i</em></p>'],
    ['++u++', '<p><span style="text-decoration: underline;">u</span></p>'],
    ['~~s~~', '<p><span style="text-decoration: line-through;">s</span></p>'],
    ['{red}x{/}', '<p><span style="color: var(--te-text-color-red);">x</span></p>'],
    ['{#FF8800}x{/}', '<p><span style="color: #ff8800;">x</span></p>'],
    ['{18}x{/}', '<p><span style="font-size: 18px;">x</span></p>'],
    ['# h', '<p><span style="font-size: 24px;"><strong>h</strong></span></p>'],
    ['## h', '<p><span style="font-size: 18px;"><strong>h</strong></span></p>'],
    ['### h', '<p><span style="font-size: 16px;"><strong>h</strong></span></p>'],
    [':::center\na\n:::', '<p style="text-align: center;">a</p>'],
    ['> q\n>\n> r', '<blockquote><p>q</p><p>&nbsp;</p><p>r</p></blockquote>'],
    ['- a\n- b', '<ul><li>a</li><li>b</li></ul>'],
    ['1. a\n2. b', '<ol><li>a</li><li>b</li></ol>'],
    ['[t](https://a.b)', '<p><a href="https://a.b" target="_blank" rel="noopener">t</a></p>'],
    ['![alt](https://i.imgur.com/x.png)', '<p><img src="https://i.imgur.com/x.png" alt="alt"></p>'],
    [':grin: :nope:', '<p><img src="/images/emotions/svg/grin.svg"> :nope:</p>'],
    [BS + '*lit' + BS + '*', '<p>*lit*</p>'],
    ['| A | B |\n|:-:|--:|\n| 1 | 2 |',
      '<div><div><div class="table-wrap"><table><tbody><tr><th style="text-align: center;">A</th>'
      + '<th style="text-align: right;">B</th></tr><tr><td style="text-align: center;">1</td>'
      + '<td style="text-align: right;">2</td></tr></tbody></table></div></div></div>'],
    ['| a | b |\n| c | d |',
      '<div><div><div class="table-wrap"><table><tbody><tr><td>a</td><td>b</td></tr>'
      + '<tr><td>c</td><td>d</td></tr></tbody></table></div></div></div>'],
    ['a <strong>raw</strong> b', '<p>a <strong>raw</strong> b</p>'],
  ];
  for (const [src, want] of rows) assert.strictEqual(md(src), want, JSON.stringify(src));
});

test('marks nest, and an unclosed mark is literal text', () => {
  assert.strictEqual(md('{red}{18}**x**{/}{/}'),
    '<p><span style="color: var(--te-text-color-red);"><span style="font-size: 18px;"><strong>x</strong></span></span></p>');
  assert.strictEqual(md('{red}open **bold'), '<p>{red}open **bold</p>');
  assert.strictEqual(md('{99}too big{/}'), '<p>{99}too big{/}</p>');
});

test('a bad link or image URL stays literal', () => {
  assert.strictEqual(md('[x](javascript:alert(1))'), '<p>[x](javascript:alert(1))</p>');
  assert.strictEqual(md('![x](http://a.b/c.png)'), '<p>![x](http://a.b/c.png)</p>');
});

test('inline HTML in Markdown is cleaned', () => {
  assert.strictEqual(md('a <img src=x onerror=alert(1)> b'), '<p>a b</p>');
});

test('the size bound: no 20000-character draft reaches CLEAN_MAX_CHARS', () => {
  // The worst expansions found while planning; a new dialect rule that beats
  // them has to raise the bound deliberately.
  for (const unit of ['|\n\n', '|\n>\n', '||\n\n', '| |\n\n', '# :cry:\n', '\n']) {
    const src = unit.repeat(Math.floor(api.DRAFT_MAX_CHARS / unit.length));
    assert.ok(api.mdToHtml(src).length < api.CLEAN_MAX_CHARS, JSON.stringify(unit));
  }
});

test('hostile Markdown stays fast and shallow', () => {
  const t = Date.now();
  md('{red}'.repeat(4000));
  md('{red}'.repeat(3000) + '{/}'.repeat(3000));
  md('[x'.repeat(9000));
  md('**{red}[a](https://x.y)*'.repeat(800));
  assert.ok(Date.now() - t < 2000, 'took ' + (Date.now() - t) + 'ms');
});
