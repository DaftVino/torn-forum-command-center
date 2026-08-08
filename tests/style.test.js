'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { loadUserscript } = require('./load-userscript');

const { exports: api } = loadUserscript();
const css = api.panelStyleText();

function blockFor(selector) {
  const i = css.indexOf(selector + ' {');
  assert.ok(i !== -1, 'no rule block for ' + selector);
  return css.slice(i, css.indexOf('}', i));
}

test('every custom property the stylesheet uses is also defined', () => {
  const used = new Set();
  const defined = new Set();
  let m;

  const useRe = /var\((--[a-z0-9-]+)\)/g;
  while ((m = useRe.exec(css))) used.add(m[1]);

  const defRe = /(--[a-z0-9-]+)\s*:/g;
  while ((m = defRe.exec(css))) defined.add(m[1]);

  const missing = [...used].filter((v) => !defined.has(v));
  assert.deepStrictEqual(missing, [], 'undefined custom properties: ' + missing.join(', '));
});

test('the light theme overrides every colour the dark theme sets', () => {
  // A half-overridden theme is worse than one theme: it produces dark text on a
  // dark panel for whichever token was forgotten.
  const dark = blockFor('#tfcc-panel');
  const light = blockFor('#tfcc-panel.tfcc-theme-light');

  const colourTokens = (block) => {
    const out = new Set();
    const re = /(--tm-[a-z0-9-]+)\s*:/g;
    let m;
    while ((m = re.exec(block))) out.add(m[1]);
    return out;
  };

  const missing = [...colourTokens(dark)].filter((t) => !colourTokens(light).has(t));
  assert.deepStrictEqual(missing, [], 'the light theme does not override: ' + missing.join(', '));
});

test('no rule paints black text, which would be invisible on the dark panel', () => {
  const offenders = css.split('\n').filter((line) => /color\s*:\s*(#000|black|rgb\(0,\s*0,\s*0\))/i.test(line));
  assert.deepStrictEqual(offenders, []);
});

test('form controls inherit the panel colours rather than the browser defaults', () => {
  // Without this, Torn's dark page gets a white input with white text in it.
  const controls = css.slice(css.indexOf('#tfcc-panel button, #tfcc-panel select'));
  assert.match(controls, /color:\s*var\(--tm-text\)/);
  assert.match(controls, /background:\s*var\(--tm-bg-3\)/);
});

test('keyboard focus is visible', () => {
  assert.match(css, /:focus-visible\s*\{[^}]*outline:\s*var\(--tfcc-focus-ring\)/);
  assert.match(css, /--tfcc-focus-ring:/);
});

test('the takeover fills the viewport and scrolls inside itself', () => {
  const block = blockFor('#tfcc-panel.tfcc-takeover');
  assert.match(block, /position:\s*fixed/);
  assert.match(block, /inset:\s*0/);
  // 100dvh after 100vh, in that order: dvh is what makes it right on a mobile
  // browser whose toolbar shrinks the viewport, and vh is the fallback for
  // webviews that do not know dvh.
  assert.ok(block.indexOf('100vh') < block.indexOf('100dvh'), 'the dvh override must come second');
  assert.match(block, /overflow-y:\s*auto/);
  assert.match(block, /overflow-x:\s*hidden/, 'the page must never scroll sideways');
});

test('the owned fallback is constrained to the viewport in both directions', () => {
  const block = blockFor('#tfcc-fallback-mount');
  assert.match(block, /box-sizing:\s*border-box/);
  assert.match(block, /max-width:\s*calc\(100vw - 24px\)/);
  assert.ok(block.indexOf('100vh - 24px') < block.indexOf('100dvh - 24px'));
  assert.match(block, /overflow-y:\s*auto/);
});

test('there is a narrow-width rule, because Torn PDA is the primary target', () => {
  assert.match(css, /@media \(max-width: 600px\)/);
  const mq = css.slice(css.indexOf('@media (max-width: 600px)'));
  assert.match(mq, /#tfcc-fallback-mount/);
  assert.match(mq, /flex-basis:\s*100%/, 'label and control should stack rather than clip');
});

test('long content wraps instead of forcing the page sideways', () => {
  assert.match(css, /overflow-wrap:\s*anywhere/);
});

test('the panel sets no font, so it inherits Torn own', () => {
  // This is what makes it read as part of the page rather than bolted on.
  const block = blockFor('#tfcc-panel');
  assert.doesNotMatch(block, /font-family/);
  assert.match(css, /font:\s*inherit/, 'controls should not fall back to the browser font either');
});

test('every rule is scoped to something this script owns', () => {
  // The script must never restyle Torn. Each rule targets our panel, our
  // fallback, or a descendant of one of them.
  const selectors = css
    .split('\n')
    .filter((l) => l.indexOf('{') !== -1 && l.indexOf('@media') === -1 && !/^\s*--/.test(l))
    .map((l) => l.slice(0, l.indexOf('{')).trim())
    .filter(Boolean);

  const stray = [];
  for (const line of selectors) {
    for (const sel of line.split(',')) {
      const s = sel.trim();
      if (!s) continue;
      if (s.indexOf('#tfcc-panel') === 0 || s.indexOf('#tfcc-fallback-mount') === 0) continue;
      stray.push(s);
    }
  }
  assert.deepStrictEqual(stray, [], 'unscoped rules would restyle Torn: ' + stray.join(' | '));
});

test('the theme resolves from Torn own class, then the system, then dark', () => {
  const env = loadUserscript();
  assert.strictEqual(env.exports.resolveTheme('light', env.doc, env.win), 'light', 'an explicit choice wins');
  assert.strictEqual(env.exports.resolveTheme('dark', env.doc, env.win), 'dark');

  env.doc.body.classList.add('light-mode');
  assert.strictEqual(env.exports.resolveTheme('match', env.doc, env.win), 'light');
  env.doc.body.classList.remove('light-mode');
  env.doc.body.classList.add('dark-mode');
  assert.strictEqual(env.exports.resolveTheme('match', env.doc, env.win), 'dark');
});

test('a missing Torn theme class falls back to the system, then to dark', () => {
  // Torn's class name is a convenience and unconfirmed. It must never be a
  // requirement.
  const light = loadUserscript({ matchMedia: () => ({ matches: true }) });
  assert.strictEqual(light.exports.resolveTheme('match', light.doc, light.win), 'light');

  const none = loadUserscript();
  assert.strictEqual(none.exports.resolveTheme('match', none.doc, none.win), 'dark');

  const hostile = loadUserscript();
  hostile.win.matchMedia = () => { throw new Error('unsupported'); };
  assert.doesNotThrow(() => hostile.exports.resolveTheme('match', hostile.doc, hostile.win));
  assert.strictEqual(hostile.exports.resolveTheme('match', hostile.doc, hostile.win), 'dark');
  assert.strictEqual(hostile.exports.resolveTheme('match', null, null), 'dark');
});

test('a long title shrinks beside the pin marker instead of wrapping below it', () => {
  // The basis has to be zero, not auto. flex-wrap picks its line breaks from
  // the base size BEFORE shrinking, so an auto basis - the title's full content
  // width - pushes the title onto its own line and strands the pin marker above
  // it. This was visible at 375px before it was fixed.
  const block = blockFor('#tfcc-panel .tfcc-row-title');
  assert.match(block, /flex:\s*1\s+1\s+0(?!\w)/, 'a non-zero basis reintroduces the wrap');
  assert.match(block, /min-width:\s*0/);
  assert.match(block, /overflow-wrap:\s*anywhere/);
});

test('row controls are tightened on a phone, where the same nine appear per row', () => {
  const mq = css.slice(css.indexOf('@media (max-width: 600px)'));
  assert.match(mq, /\.tfcc-actions button \{ padding: 1px 5px; \}/);
  assert.match(mq, /max-width:\s*46%/, 'a full-width input per row makes the list endless');
});

test('every anchor is coloured, in every state', () => {
  // An unstyled link falls back to the browser default rgb(0, 0, 238), which is
  // all but black against the dark panel, and :visited falls back to purple,
  // which is worse. Only .tfcc-row-title a used to be styled, so the links in
  // the Search and Drafts views were unreadable.
  assert.match(css, /#tfcc-panel a, #tfcc-panel a:link, #tfcc-panel a:visited,/);
  assert.match(css, /#tfcc-panel a:hover, #tfcc-panel a:active \{/);
  assert.match(css, /#tfcc-panel \.tfcc-row-title a, #tfcc-panel \.tfcc-row-title a:visited \{/,
    'the row title override must cover :visited too, or visited titles turn purple');
  assert.match(css, /#tfcc-panel \.tfcc-linkbtn, #tfcc-panel \.tfcc-linkbtn:visited \{/);
});

test('dropdown options carry the panel colours', () => {
  // The popup is drawn by the OS on some platforms and defaults to black on
  // white regardless of what the select says.
  assert.match(css, /#tfcc-panel option \{ background: var\(--tm-bg-3\); color: var\(--tm-text\); \}/);
});

test('the panel never names an access level Torn does not offer', () => {
  // The API docs colour-code both selections as Minimal Access, but the key
  // page does not offer Minimal as a choice, so naming the selections is both
  // accurate and stable.
  const { exports: api } = loadUserscript();
  api.state.settings.view = 'settings';
  const html = api.panelHtml(api.buildPanelModel(1700000000000));

  assert.doesNotMatch(html, /Minimal/, 'the panel still tells people to pick Minimal');
  assert.match(html, /forumsubscribedthreads/);
  assert.match(html, /forumfeed/);
  assert.match(html, /Custom/);
  assert.match(html, /Limited Access/);
  assert.match(html, /Public Only/);

  assert.doesNotMatch(api.TORN_ERRORS[16], /Minimal/);
  assert.match(api.TORN_ERRORS[16], /forumsubscribedthreads/);
});
