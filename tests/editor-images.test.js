'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { loadUserscript } = require('./load-userscript');

const { exports: api } = loadUserscript();
const fix = (u) => api.fixImageUrl(u);
const ID = '1GfhII9A5yDKVLFVv0F1SEPivpxvREb-h';
const DRIVE = 'https://drive.google.com/thumbnail?id=' + ID + '&sz=w1000';

test('deterministic hosts are rewritten exactly', () => {
  const rows = [
    ['https://drive.google.com/file/d/' + ID + '/view?usp=sharing', DRIVE],
    ['https://drive.google.com/file/u/0/d/' + ID + '/edit', DRIVE],
    ['https://drive.google.com/open?id=' + ID, DRIVE],
    ['https://www.dropbox.com/scl/fi/abc/pic.png?rlkey=KEY&dl=0', 'https://www.dropbox.com/scl/fi/abc/pic.png?rlkey=KEY&raw=1'],
    ['https://www.dropbox.com/s/abc/pic.png?dl=0', 'https://www.dropbox.com/s/abc/pic.png?raw=1'],
    ['https://github.com/o/r/blob/main/img/a.png', 'https://raw.githubusercontent.com/o/r/main/img/a.png'],
    ['https://giphy.com/gifs/cat-funny-abc123XYZ', 'https://media.giphy.com/media/abc123XYZ/giphy.gif'],
    ['https://gyazo.com/0123456789abcdef0123456789abcdef', 'https://i.gyazo.com/0123456789abcdef0123456789abcdef.png'],
    ['https://imgur.com/AbC12dE', 'https://i.imgur.com/AbC12dE.png'],
    ['https://www.reddit.com/media?url=https%3A%2F%2Fi.redd.it%2Fxyz.png', 'https://i.redd.it/xyz.png'],
    ['https://preview.redd.it/xyz.png?width=640&s=abc', 'https://i.redd.it/xyz.png'],
    // Every other input shape the host-rules file lists.
    ['https://drive.google.com/uc?id=' + ID + '&export=view', DRIVE],
    ['https://drive.google.com/uc?export=download&id=' + ID, DRIVE],
    ['https://giphy.com/embed/abc123XYZ', 'https://media.giphy.com/media/abc123XYZ/giphy.gif'],
    ['https://github.com/o/r/raw/main/a.png', 'https://raw.githubusercontent.com/o/r/main/a.png'],
    ['https://github.com/o/r/blob/main/a.png?raw=true', 'https://raw.githubusercontent.com/o/r/main/a.png'],
    ['https://www.dropbox.com/scl/fi/abc/pic.png?rlkey=KEY&st=x&dl=1', 'https://www.dropbox.com/scl/fi/abc/pic.png?rlkey=KEY&st=x&raw=1'],
  ];
  for (const [input, want] of rows) {
    const r = fix(input);
    assert.strictEqual(r.status, 'fixed', input);
    assert.strictEqual(r.url, want, input);
  }
  assert.match(fix('https://drive.google.com/file/d/' + ID + '/view').note, /Anyone with the link/);
});

test('direct links pass as they are', () => {
  for (const u of [DRIVE, 'https://editor.torn.com/0de3-1.jpg', 'https://example.com/pic.JPG?x=1',
    'https://i.imgur.com/x.gif', 'https://lh3.googleusercontent.com/pw/abc=w100',
    'https://dl.dropboxusercontent.com/s/abc/pic.png', 'https://raw.githubusercontent.com/o/r/main/a.png',
    'https://media.giphy.com/media/abc/giphy.gif', 'https://i.gyazo.com/0123456789abcdef0123456789abcdef.png',
    'https://i.redd.it/xyz.png']) {
    assert.strictEqual(fix(u).status, 'ok', u);
    assert.strictEqual(fix(u).url, u, u);
  }
});

test('hosts with no derivable link get an instruction', () => {
  for (const [u, re] of [
    ['https://photos.app.goo.gl/abc', /Copy image address/],
    ['https://1drv.ms/i/s!abc', /OneDrive/],
    ['https://ibb.co/8P0808s', /Direct link/],
    ['https://postimg.cc/abc', /Direct link/],
    ['https://imgur.com/a/AbC12', /album/],
    ['https://prnt.sc/abc', /Copy image address/],
    ['https://tenor.com/view/x-123', /Copy image address/],
    ['https://contoso.sharepoint.com/x', /OneDrive/],
  ]) {
    const r = fix(u);
    assert.strictEqual(r.status, 'howto', u);
    assert.match(r.note, re, u);
  }
});

test('expiring, insecure and non-image links are refused with a reason', () => {
  assert.match(fix('https://cdn.discordapp.com/attachments/1/2/a.png?ex=1').note, /expire/);
  assert.match(fix('http://a.b/c.png').note, /https/);
  assert.match(fix('https://example.com/page').note, /web page/);
  assert.match(fix('https://drive.google.com/drive/folders/1abcdefghijklmnopqrstu').note, /folder/);
  assert.match(fix('https://github.com/o/r/blob/main/a.svg').note, /SVG/);
  // A Reddit wrapper around a page link passes the inner verdict through.
  assert.strictEqual(fix('https://www.reddit.com/media?url=https%3A%2F%2Fibb.co%2Fabc').status, 'howto');
  for (const u of ['', 'javascript:alert(1)', 'https://a.b/"onerror=x.png', 'https://' + 'a'.repeat(2100) + '.png']) {
    assert.strictEqual(fix(u).status, 'refused', u.slice(0, 40));
  }
});

test('Fix image link rewrites every fixable image in a draft', () => {
  assert.deepStrictEqual(api.fixAllImages('md', '![a](https://imgur.com/AbC12dE) ![b](https://x.y/z.png)'),
    { text: '![a](https://i.imgur.com/AbC12dE.png) ![b](https://x.y/z.png)', changed: 1, leftAsLinks: 0 });
  assert.deepStrictEqual(api.fixAllImages('html', '<img src="https://drive.google.com/file/d/' + ID + '/view">'),
    { text: '<img src="https://drive.google.com/thumbnail?id=' + ID + '&amp;sz=w1000">', changed: 1, leftAsLinks: 0 });
  assert.deepStrictEqual(api.fixAllImages('html', "<img src='https://imgur.com/AbC12dE'>"),
    { text: "<img src='https://i.imgur.com/AbC12dE.png'>", changed: 1, leftAsLinks: 0 });
  assert.deepStrictEqual(api.fixAllImages('text', '![a](https://imgur.com/AbC12dE)'),
    { text: '![a](https://imgur.com/AbC12dE)', changed: 0, leftAsLinks: 0 });
});

// H2: the owner's case, a Drive /view link pasted on its own line.
const OWNER = 'https://drive.google.com/file/d/1GfhII9A5yDKVLFVv0F1SEPivpxvREb-h/view?usp=sharing';
const OWNER_FIXED = 'https://drive.google.com/thumbnail?id=1GfhII9A5yDKVLFVv0F1SEPivpxvREb-h&sz=w1000';

test('H2: a fixable bare link alone on its line becomes an image in Markdown', () => {
  assert.deepStrictEqual(api.fixAllImages('md', OWNER),
    { text: '![](' + OWNER_FIXED + ')', changed: 1, leftAsLinks: 0 });
  assert.deepStrictEqual(api.fixAllImages('md', 'Look:\n\n  ' + OWNER + '  \nbye'),
    { text: 'Look:\n\n  ![](' + OWNER_FIXED + ')  \nbye', changed: 1, leftAsLinks: 0 });
  assert.deepStrictEqual(api.fixAllImages('md', 'https://imgur.com/AbC12dE\nhttps://imgur.com/ZzY99xW'),
    { text: '![](https://i.imgur.com/AbC12dE.png)\n![](https://i.imgur.com/ZzY99xW.png)', changed: 2, leftAsLinks: 0 });
});

test('H2: a fixable bare link alone on its line becomes an image in HTML', () => {
  assert.deepStrictEqual(api.fixAllImages('html', OWNER),
    { text: '<img src="' + OWNER_FIXED.replace('&', '&amp;') + '">', changed: 1, leftAsLinks: 0 });
  assert.deepStrictEqual(api.fixAllImages('html', '<p>one</p>\n' + OWNER + '\n<p>two</p>'),
    { text: '<p>one</p>\n<img src="' + OWNER_FIXED.replace('&', '&amp;') + '">\n<p>two</p>', changed: 1, leftAsLinks: 0 });
  // A Dropbox page link: the query is rewritten to raw=1.
  assert.deepStrictEqual(api.fixAllImages('html', 'https://dropbox.com/s/abc/pic.png?dl=0'.replace('dropbox.com', 'www.dropbox.com')),
    { text: '<img src="https://www.dropbox.com/s/abc/pic.png?raw=1">', changed: 1, leftAsLinks: 0 });
});

test('H2: a fixable link in a sentence is left as a link and counted', () => {
  const md = 'See ' + OWNER + ' for the map.';
  assert.deepStrictEqual(api.fixAllImages('md', md), { text: md, changed: 0, leftAsLinks: 1 });
  assert.deepStrictEqual(api.fixAllImages('md', 'x ' + OWNER + '.'), { text: 'x ' + OWNER + '.', changed: 0, leftAsLinks: 1 });
  assert.deepStrictEqual(api.fixAllImages('html', md), { text: md, changed: 0, leftAsLinks: 1 });
  const mixed = OWNER + '\nand ' + OWNER;
  assert.deepStrictEqual(api.fixAllImages('md', mixed),
    { text: '![](' + OWNER_FIXED + ')\nand ' + OWNER, changed: 1, leftAsLinks: 1 });
  // Alone on its line, but after a tag on that same line: still in a sentence.
  const tagged = '<strong>map</strong> ' + OWNER;
  assert.deepStrictEqual(api.fixAllImages('html', tagged), { text: tagged, changed: 0, leftAsLinks: 1 });
});

test('H2: a link inside link markup is left as it is and counted', () => {
  const md = '[the map](' + OWNER + ')';
  assert.deepStrictEqual(api.fixAllImages('md', md), { text: md, changed: 0, leftAsLinks: 1 });
  const a = '<a href="' + OWNER + '">the map</a>';
  assert.deepStrictEqual(api.fixAllImages('html', a), { text: a, changed: 0, leftAsLinks: 0 });
  const b = '<a href="' + OWNER + '">\n' + OWNER + '\n</a>';
  assert.deepStrictEqual(api.fixAllImages('html', b), { text: b, changed: 0, leftAsLinks: 1 });
  const p = '<p>\n' + OWNER + '\n</p>';
  assert.deepStrictEqual(api.fixAllImages('html', p), { text: p, changed: 0, leftAsLinks: 1 });
});

test('H2: an already-direct link alone on its line is left as typed, uncounted', () => {
  for (const lang of ['md', 'html']) {
    const t = 'https://i.imgur.com/AbC12dE.png\n' + OWNER_FIXED;
    assert.deepStrictEqual(api.fixAllImages(lang, t), { text: t, changed: 0, leftAsLinks: 0 }, lang);
  }
});

test('H2: a link that cannot be fixed alone on a line is left as typed', () => {
  const t = 'https://drive.google.com/drive/folders/abc';
  assert.deepStrictEqual(api.fixAllImages('md', t), { text: t, changed: 0, leftAsLinks: 0 });
  assert.deepStrictEqual(api.fixAllImages('text', OWNER), { text: OWNER, changed: 0, leftAsLinks: 0 });
});

test('a custom color near-invisible in a theme is flagged there; merely weak colors are not (#58)', () => {
  assert.deepStrictEqual(api.colorWarnings('#ffd43b'), [{ theme: 'light', ratio: 1.4 }]);
  assert.deepStrictEqual(api.colorWarnings('#000000'), [{ theme: 'dark', ratio: 1.1 }]);
  assert.deepStrictEqual(api.colorWarnings('#222222').map((w) => w.theme), ['dark']);
  assert.deepStrictEqual(api.colorWarnings('#ff1111'), []);
  assert.deepStrictEqual(api.colorWarnings('#777777'), []);
  assert.deepStrictEqual(api.colorWarnings('#1c7ed6'), []);
  assert.strictEqual(Math.round(api.contrastRatio('#000000', '#ffffff')), 21);
});

test('an image link can never break out of Markdown or HTML', () => {
  for (const u of ['https://a"b.com/x.png', 'https://a<b>.com/x.png', 'https://u@x.y/a.png',
    'https://a`b.com/x.png', 'https://x.y/a\\b.png']) {
    const r = fix(u);
    assert.strictEqual(r.status, 'refused', u);
    assert.match(r.note, /not a web link/, u);
  }
  assert.deepStrictEqual([fix('https://x.y/a).png').status, fix('https://x.y/a).png').url], ['ok', 'https://x.y/a%29.png']);
  assert.strictEqual(fix('https://x.y/a(1).png').url, 'https://x.y/a%281%29.png');
  assert.strictEqual(fix('https://x.y:8080/a.png').status, 'ok');
  const box = fix('https://www.dropbox.com/s/a)b/p.png?dl=0');
  assert.deepStrictEqual([box.status, box.url], ['fixed', 'https://www.dropbox.com/s/a%29b/p.png?raw=1']);
  const gh = fix('https://github.com/o/r/blob/main/a).png');
  assert.deepStrictEqual([gh.status, gh.url], ['fixed', 'https://raw.githubusercontent.com/o/r/main/a%29.png']);
  for (const r of [fix('https://x.y/a).png'), box, gh]) assert.doesNotMatch(r.url, /[()"'<>`\\\s]/);
});

test('H2: replacement patterns in a link ($& and friends) are written literally', () => {
  const u = 'https://www.dropbox.com/s/abc/p$&q$$.png?dl=0';
  const r = api.fixAllImages('md', u);
  assert.strictEqual(r.changed, 1);
  assert.strictEqual(r.text, '![](https://www.dropbox.com/s/abc/p$&q$$.png?raw=1)');
});
