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
    { text: '![a](https://i.imgur.com/AbC12dE.png) ![b](https://x.y/z.png)', changed: 1 });
  assert.deepStrictEqual(api.fixAllImages('html', '<img src="https://drive.google.com/file/d/' + ID + '/view">'),
    { text: '<img src="https://drive.google.com/thumbnail?id=' + ID + '&amp;sz=w1000">', changed: 1 });
  assert.deepStrictEqual(api.fixAllImages('html', "<img src='https://imgur.com/AbC12dE'>"),
    { text: "<img src='https://i.imgur.com/AbC12dE.png'>", changed: 1 });
  assert.deepStrictEqual(api.fixAllImages('text', '![a](https://imgur.com/AbC12dE)'),
    { text: '![a](https://imgur.com/AbC12dE)', changed: 0 });
});

test('a custom color hard to read in a theme is flagged there', () => {
  assert.deepStrictEqual(api.colorWarnings('#ffd43b'), [{ theme: 'light', ratio: 1.4 }]);
  assert.deepStrictEqual(api.colorWarnings('#000000'), [{ theme: 'dark', ratio: 1.1 }]);
  assert.deepStrictEqual(api.colorWarnings('#777777').map((w) => w.theme), ['light', 'dark']);
  assert.deepStrictEqual(api.colorWarnings('#1c7ed6'), [{ theme: 'light', ratio: 4.1 }]);
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
