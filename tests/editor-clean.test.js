'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { loadUserscript } = require('./load-userscript');

const { exports: api } = loadUserscript();
const clean = api.cleanTornHtml;
const SAMPLE = fs.readFileSync(path.join(__dirname, '..', 'docs', 'reference', 'torn-forum-post-sample.html'), 'utf8');

// Copied by hand from the owner's probes (findings doc, Q4 and the emoji
// section), not from the production constant, so a typo in either fails.
const MEASURED_COLORS = [
  ['red', '#f03e3e', '#ff8787'], ['pink', '#d6336c', '#faa2c1'], ['grape', '#ae3ec9', '#e599f7'],
  ['violet', '#7048e8', '#d0bfff'], ['indigo', '#4263eb', '#bac8ff'], ['blue', '#1c7ed6', '#a5d8ff'],
  ['cyan', '#1098ad', '#99e9f2'], ['teal', '#0ca678', '#63e6be'], ['green', '#37b24d', '#8ce99a'],
  ['lime', '#66a80f', '#a9e34b'], ['yellow', '#e67700', '#ffd43b'], ['orange', '#d9480f', '#ffa94d'],
  ['gray1', '#333333', '#ffffff'], ['gray2', '#666666', '#dddddd'], ['gray3', '#999999', '#aaaaaa'],
  ['gray4', '#cccccc', '#888888'], ['gray5', '#ffffff', '#000000'],
];
const MEASURED_EMOJI = ['angel', 'angry', 'authority', 'beard', 'beaten_up', 'blushing', 'bored_sleepy',
  'confused', 'cool', 'cry', 'disappointed', 'dizzy', 'evil', 'grin', 'hushed', 'kissing', 'laughing',
  'love_chemistry', 'money', 'moustache', 'mugger_masked', 'nerd', 'party', 'pirate', 'sick', 'smiley',
  'tired', 'tongue', 'wink', 'zip_mouth'];

test('the 17 Torn colors and the 30 Torn emoji are exactly the measured sets', () => {
  assert.deepStrictEqual(api.TORN_COLORS.map((c) => [c.name, c.light, c.dark]), MEASURED_COLORS);
  assert.deepStrictEqual(api.TORN_EMOJI.slice(), MEASURED_EMOJI);
  assert.strictEqual(api.PASTE_MARKER, '<!-- x-tinymce/html -->');
});

test('TinyMCE bogus elements: "all" goes with its content, others unwrap', () => {
  assert.strictEqual(clean('<p><strong data-mce-bogus="1">hi</strong><span data-mce-bogus="all">caret</span></p>'), '<p>hi</p>');
});

test('cleaning the published sample keeps everything it shows', () => {
  // Independent of the round trip: counted in the source, then in the output.
  const c = clean(SAMPLE);
  const count = (s, re) => (s.match(re) || []).length;
  const body = SAMPLE.replace(/<!--[\s\S]*?-->/g, '');
  assert.strictEqual(count(c, /var\(--te-text-color-/g), count(body, /var\(--te-text-color-/g));
  assert.strictEqual(count(c, /<a href="https:\/\/greasyfork\.org/g), count(body, /<a href=/g));
  assert.strictEqual(count(c, /class="table-wrap"/g), count(body, /class="table-wrap"/g));
  assert.strictEqual(count(c, /<li>/g), count(body, /<li>/g));
  assert.strictEqual(count(c, /text-align: center/g), count(body, /text-align: center/g));
  for (const words of ['Education is one of', 'Tier 1 is the category', 'BIO2127', 'keep that education slot moving']) {
    assert.ok(c.indexOf(words) !== -1, words);
  }
});

test('allowed markup survives in canonical form', () => {
  assert.strictEqual(clean('<P STYLE="text-align:center">x</P>'), '<p style="text-align: center;">x</p>');
  assert.strictEqual(clean('<p><b>b</b> <i>i</i> <u>u</u> <s>s</s></p>'),
    '<p><strong>b</strong> <em>i</em> <span style="text-decoration: underline;">u</span> '
    + '<span style="text-decoration: line-through;">s</span></p>');
  assert.strictEqual(clean('<p><span style="font-size: 18px; color: var(--te-text-color-green);">h</span></p>'),
    '<p><span style="color: var(--te-text-color-green);"><span style="font-size: 18px;">h</span></span></p>');
  assert.strictEqual(clean('<p><a href="https://a.b/c">t</a></p>'),
    '<p><a href="https://a.b/c" target="_blank" rel="noopener">t</a></p>');
  assert.strictEqual(clean('<p><img src="/images/emotions/svg/angel.svg"></p>'),
    '<p><img src="/images/emotions/svg/angel.svg"></p>');
  assert.strictEqual(clean('<h2>Head</h2>'), '<p><span style="font-size: 18px;"><strong>Head</strong></span></p>');
});

test('every table gets the table-wrap trio and a tbody', () => {
  assert.strictEqual(clean('<table><tr><th>a</th></tr><tr><td style="text-align:right">1</td></tr></table>'),
    '<div><div><div class="table-wrap"><table><tbody><tr><th>a</th></tr>'
    + '<tr><td style="text-align: right;">1</td></tr></tbody></table></div></div></div>');
});

test('blank paragraphs, including TinyMCE bogus ones, become one canonical spacer', () => {
  assert.strictEqual(clean('<p><br data-mce-bogus="1"></p><p>&nbsp;</p><p> </p>'),
    '<p>&nbsp;</p><p>&nbsp;</p><p>&nbsp;</p>');
});

test('hostile markup is neutralised', () => {
  const cases = {
    '<script>alert(1)</script><p>ok</p>': '<p>ok</p>',
    '<img src=x onerror=alert(1)>': '',
    '<p onclick="x">t</p>': '<p>t</p>',
    '<a href="javascript:alert(1)">j</a>': '<p>j</p>',
    '<a href="&#106;avascript:alert(1)">j</a>': '<p>j</p>',
    '<img src="data:image/png;base64,AAA">': '',
    '<style>p{}</style><p>s</p>': '<p>s</p>',
    '<iframe src="https://e.com"></iframe>': '',
    '<svg><script>x</script></svg>t': '<p>t</p>',
    '<p style="background:url(javascript:x);color:red">c</p>': '<p>c</p>',
    '<img src="/images/other/x.svg">': '',
    '<img src="/images/emotions/svg/notreal.svg">': '',
  };
  for (const [input, want] of Object.entries(cases)) assert.strictEqual(clean(input), want, input);
});

test('an unwrapped container still closes what it opened', () => {
  assert.strictEqual(clean('<div><p>a</div>b'), '<p>a</p><p>b</p>');
});

test('cleaning is idempotent, and htmlSource round-trips', () => {
  for (const h of [SAMPLE, '<p>x <strong>y</strong></p><ul><li>a</li></ul>', '<blockquote><p>q</p></blockquote>']) {
    const c = clean(h);
    assert.strictEqual(clean(c), c);
    assert.strictEqual(clean(api.htmlSource(c)), c);
    assert.ok(api.htmlSource(c).indexOf('\n') !== -1 || !/<\/(p|ul|ol|div|blockquote)><(p|ul|ol|div|blockquote|table)/.test(c));
  }
});

test('the cleaner reads a bounded input in one pass', () => {
  const t = Date.now();
  clean('<a '.repeat(30000));
  clean('<p>'.repeat(30000));
  clean('x'.repeat(200000));
  assert.ok(Date.now() - t < 2000, 'hostile input took ' + (Date.now() - t) + 'ms');
});

test('the cleaner bound is pinned, and the worst expansion found stays inside it', () => {
  assert.strictEqual(api.CLEAN_MAX_CHARS, 1000000);
  const worst = '|\n\n'.repeat(Math.floor(20000 / 3));
  assert.ok(clean(worst).length < api.CLEAN_MAX_CHARS, 'expansion exceeded the bound');
});

test('deep nesting within the draft cap is bounded, not a stack overflow', () => {
  assert.ok(clean('<b>'.repeat(6666) + 'x').indexOf('x') !== -1);
  assert.ok(clean('<blockquote>'.repeat(5000) + 'x').indexOf('x') !== -1);
  assert.ok(clean('<table><tr><td>'.repeat(2000) + 'x').indexOf('x') !== -1);
  assert.ok(clean('<table><tr><td>'.repeat(60000)).length >= 0);
});

test('a dropped element between two text runs leaves one run, and cleaning is idempotent', () => {
  const x = '<p>a <img src=x onerror=alert(1)> b</p>';
  assert.strictEqual(clean(x), '<p>a b</p>');
  assert.strictEqual(clean(clean(x)), clean(x));
});

test('input past CLEAN_MAX_CHARS is not read at all', () => {
  const head = '<p>kept</p>' + 'x'.repeat(api.CLEAN_MAX_CHARS - 11);
  const out = clean(head + '<p>beyond</p>');
  assert.ok(out.indexOf('kept') !== -1);
  assert.strictEqual(out.indexOf('beyond'), -1, 'the cleaner read past its bound');
});
