'use strict';

// #58 owner feedback, Batch C: the help key (Markdown and HTML), the X / ?
// button and the Drafts info button.

const test = require('node:test');
const assert = require('node:assert');
const { loadUserscript, FORUMS_LOCATION } = require('./load-userscript');
const { panelOf, redraw, click } = require('./narrow-helpers');

const NOW = 1700000000000;
const THREAD = Object.assign({}, FORUMS_LOCATION, { hash: '#/p=threads&f=1&t=42&b=0&a=0' });

function boot(lang, width) {
  const env = loadUserscript({ location: THREAD, now: NOW, panelWidth: width || 900, panelPadding: 8, htmlQuery: true });
  const api = env.exports;
  api.state.route = api.parseForumRoute(env.win.location);
  api.state.settings.view = 'drafts';
  api.state.settings.draftLang = lang;
  api.state.drafts = api.saveDraft(api.freshDrafts(), 42, 'hello', NOW, 'T', lang);
  redraw(env);
  return { env, api };
}

const helpBtn = (html) => (html.match(/<button[^>]*data-picker="help"[^>]*>[^<]*<\/button>/) || [''])[0];

test('C1: the ? button reads X and says Close help while the key is open', () => {
  for (const lang of ['md', 'html']) {
    const { env } = boot(lang);
    let html = redraw(env);
    const closed = helpBtn(html);
    assert.match(closed, />\?</, lang);
    assert.match(closed, lang === 'md' ? /aria-label="Markdown help" title="Markdown help"/ : /aria-label="HTML help" title="HTML help"/);
    click(env, '[data-act="ed-picker"][data-picker="help"]');
    html = redraw(env);
    const open = helpBtn(html);
    assert.match(open, />X</, lang);
    assert.match(open, /aria-label="Close help" title="Close help"/);
    click(env, '[data-act="ed-picker"][data-picker="help"]');
    assert.match(helpBtn(redraw(env)), />\?</, 'a second press closes it');
  }
});

test('C1: the help picker closes with "Close"; other pickers keep "Cancel"', () => {
  const { env } = boot('md');
  click(env, '[data-act="ed-picker"][data-picker="help"]');
  let html = redraw(env);
  assert.match(html, /data-act="ed-picker-close">Close<\/button>/);
  click(env, '[data-act="ed-picker-close"]');
  click(env, '[data-act="ed-picker"][data-picker="color"]');
  html = redraw(env);
  assert.match(html, /data-act="ed-picker-close">Cancel<\/button>/);
});

test('C1/C3: the ? button is also in the narrow More drawer, and in HTML mode', () => {
  for (const lang of ['md', 'html']) {
    const { env } = boot(lang, 343);
    click(env, '[data-act="ed-more"]');
    assert.match(helpBtn(redraw(env)), /data-picker="help"/, lang);
  }
});

test('C2: the Markdown key lists the marks, the space after #, and Not supported', () => {
  const { env } = boot('md');
  click(env, '[data-act="ed-picker"][data-picker="help"]');
  const html = redraw(env);
  assert.match(html, /<table class="tfcc-key">/);
  for (const s of ['**bold**', '++underline++', '~~strike~~', '{red}text{/}', '{#ff8800}text{/}', '{18}text{/}',
    ':::center / left / right', '&gt; text', '| a | b |', '[text](link)', '![alt](image link)', ':grin:', '17 Torn colors, e.g. {red}']) {
    assert.ok(html.includes(s), s);
  }
  assert.match(html, /the space after # is required/);
  assert.ok(html.includes('<code>\\*</code>'), 'the escape row shows a backslash');
  assert.ok(html.includes('backslash: show a mark as text (e.g. \\*)'));
  assert.match(html, /Not supported<\/code><\/td><td>code blocks, nested lists, #### and smaller, _underscores_, horizontal rules/);
  assert.ok(!html.includes('<blockquote>'), 'not the HTML key');
});

test('C3: HTML mode shows the HTML key, with the strip note', () => {
  const { env } = boot('html');
  click(env, '[data-act="ed-picker"][data-picker="help"]');
  const html = redraw(env);
  for (const s of ['&lt;strong&gt; / &lt;em&gt;', 'text-decoration: underline', 'var(--te-text-color-red)', 'font-size: 18px',
    'text-align: center', '&lt;blockquote&gt;&lt;p&gt;', '&lt;table&gt;', '&lt;a href=', '&lt;img src=', '/images/emotions/svg/grin.svg',
    'is stripped when posting']) {
    assert.ok(html.includes(s), s);
  }
  assert.ok(!html.includes('{red}text{/}'), 'not the Markdown key');
});

test('C4: a thread draft and a free draft both carry the drafts info button and its hidden text', () => {
  const { env, api } = boot('md');
  let html = redraw(env);
  // The info button sits in an infobar beside the heading, not inside it.
  assert.match(html, /<div class="tfcc-infobar"><h4>Draft for this thread<\/h4><button[^>]*data-info="drafts-editor"[^>]*aria-label="About drafts"/);
  assert.match(html, /<p class="tfcc-note tfcc-infotext" id="tfcc-info-drafts-editor" hidden>[^<]*Save keeps it on this device only\./);
  click(env, '[data-act="info"][data-info="drafts-editor"]');
  html = redraw(env);
  assert.match(html, /id="tfcc-info-drafts-editor">/, 'opens on a tap');
  click(env, '[data-act="draft-new"]');
  html = redraw(env);
  assert.match(html, /<div class="tfcc-infobar"><label class="tfcc-note" for="tfcc-ed-name">Draft name<\/label><button[^>]*data-info="drafts-editor"[^>]*><svg[\s\S]*?<\/button><\/div><input id="tfcc-ed-name"/);
  assert.match(html, /id="tfcc-info-drafts-editor"/);
  assert.ok(api.state.editor && /^n[0-9]+$/.test(api.state.editor.key));
});
