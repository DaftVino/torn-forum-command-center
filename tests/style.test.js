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
      // A keyframes rule restyles nothing by itself; only its name is global,
      // so it must carry the script's prefix (issue #9's toast fade).
      if (/^@keyframes tfcc-[a-z-]+$/.test(s)) continue;
      stray.push(s);
    }
  }
  assert.deepStrictEqual(stray, [], 'unscoped rules would restyle Torn: ' + stray.join(' | '));
});

test('the theme resolves from Torn own class, then the system, then dark', () => {
  // No measurable background, so the class names are what is left to go on.
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
  // requirement. Nothing measurable here either, so the media query decides.
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

// Live probing on 2026-10-08 (finding 16) settled the level: Public Only fails
// user/forumsubscribedthreads and user/forumfeed with error 16, Minimal Access
// passes everything the script uses, and Limited Access adds nothing. A Custom
// key with only those two selections is no longer suggested: Torn's docs say a
// custom key reaches only the default, timestamp and lookup selections unless
// more are listed, so it would probably fail the forum/* calls.
const KEY_HELP_NOTE = 'This script needs a key that can read your subscribed threads. On Torn, '
  + 'go to Settings, API Key, and create a <strong>Minimal Access</strong> key. A '
  + '<strong>Limited Access</strong> key also works but is not needed. A '
  + '<strong>Public Only</strong> key does not.';
const KEY_HELP_ROW = '<tr><th>Access level required</th><td>Minimal Access. Limited Access '
  + 'also works but is not needed. Public Only does not.</td></tr>';

// Minimal must be the level a text asks for: named, and named before Limited.
function requiresMinimal(text, label) {
  const plain = text.replace(/<[^>]+>/g, '');
  assert.match(plain, /Minimal Access/, label + ' does not name Minimal Access');
  assert.match(plain, /Public Only/, label + ' no longer says Public Only fails');
  assert.doesNotMatch(plain, /Custom/, label + ' still recommends a Custom key');
  assert.doesNotMatch(plain, /Use a Limited|least access that works is a Limited/i,
    label + ' recommends Limited as the requirement');
  const limited = plain.indexOf('Limited');
  assert.ok(limited === -1 || plain.indexOf('Minimal Access') < limited,
    label + ' names Limited before Minimal, so Limited reads as the requirement');
}

test('the key help names Minimal Access as the required level', () => {
  const { exports: api } = loadUserscript();
  api.state.settings.view = 'settings';
  const html = api.panelHtml(api.buildPanelModel(1700000000000));

  assert.ok(html.includes(KEY_HELP_NOTE), 'the Settings key note wording changed');
  assert.ok(html.includes(KEY_HELP_ROW), 'the access-level row wording changed');
  requiresMinimal(KEY_HELP_NOTE, 'the Settings key note');
  requiresMinimal(KEY_HELP_ROW, 'the access-level row');
  const section = html.slice(html.indexOf('Torn API key'), html.indexOf('API key</label>'));
  requiresMinimal(section, 'the Settings key section');
});

test('the error-16 and missing-key texts name Minimal Access as the required level', async () => {
  const { exports: api } = loadUserscript();
  assert.strictEqual(api.TORN_ERRORS[16], 'That key cannot read your subscribed threads. '
    + 'Use a Minimal Access key; Limited Access also works. A Public Only key does not.');
  requiresMinimal(api.TORN_ERRORS[16], 'the error-16 text');
  requiresMinimal(api.mapTornError(16, 'Access level').message, 'the mapped error-16 message');

  const res = await api.tornApiGet('user/forumfeed', {}, { key: '' });
  assert.strictEqual(res.detail, 'Add a Torn API key in Settings. '
    + 'Use a Minimal Access key; Limited Access also works. A Public Only key does not.');
  requiresMinimal(res.detail, 'the missing-key detail');
});

test('nothing in the panel takes its colour or background from the host page', () => {
  // Inheritance is the weakest source in CSS: a value is inherited only when NO
  // rule matches. Torn styles bare elements, so `td { color: #000 }` on the host
  // beat our panel's inherited colour and painted the API-key table black.
  // background needs its own reset because it is not inherited at all, which is
  // how a host `code { background: #eee }` survived the colour fix.
  assert.match(css, /#tfcc-panel \* \{ color: inherit; background: transparent; \}/);

  // The reset must come before the rules it is meant to lose to, so a same
  // specificity rule later in the sheet still wins on source order.
  const reset = css.indexOf('#tfcc-panel * { color: inherit');
  const controls = css.indexOf('#tfcc-panel button, #tfcc-panel select');
  assert.ok(reset < controls, 'the reset must not override the control colours');
});

test('table cells and code state their own colours outright', () => {
  // The two element types a host page is most likely to have opinions about.
  const cells = blockFor('#tfcc-panel .tfcc-tos th, #tfcc-panel .tfcc-tos td');
  assert.match(cells, /color:\s*var\(--tm-text\)/);
  assert.match(cells, /background:\s*transparent/);

  const code = blockFor('#tfcc-panel code, #tfcc-panel pre');
  assert.match(code, /color:\s*var\(--tm-accent-text\)/);
  assert.match(code, /background:\s*var\(--tm-bg-3\)/);
});

test('Match Torn reads the page it is on rather than a class name', () => {
  // The class names were never confirmed and Match Torn did not follow Torn's
  // web theme. Measuring what the page paints cannot go stale that way.
  const dark = loadUserscript({ computedStyles: { body: { backgroundColor: 'rgb(20, 20, 20)' } } });
  assert.strictEqual(dark.exports.measurePageTheme(dark.doc, dark.win), 'dark');
  assert.strictEqual(dark.exports.resolveTheme('match', dark.doc, dark.win), 'dark');

  const light = loadUserscript({ computedStyles: { body: { backgroundColor: 'rgb(242, 242, 242)' } } });
  assert.strictEqual(light.exports.measurePageTheme(light.doc, light.win), 'light');
  assert.strictEqual(light.exports.resolveTheme('match', light.doc, light.win), 'light');
});

test('a transparent body is not read as black', () => {
  // body is very often transparent with the real colour on html. Reading
  // rgba(0,0,0,0) as black would make every light page resolve to dark.
  const env = loadUserscript({
    computedStyles: {
      body: { backgroundColor: 'rgba(0, 0, 0, 0)' },
      documentElement: { backgroundColor: 'rgb(255, 255, 255)' },
    },
  });
  assert.strictEqual(env.exports.measurePageTheme(env.doc, env.win), 'light');
});

test('both transparent means the browser canvas, which is white', () => {
  const env = loadUserscript({
    computedStyles: {
      body: { backgroundColor: 'rgba(0, 0, 0, 0)' },
      documentElement: { backgroundColor: 'transparent' },
    },
  });
  assert.strictEqual(env.exports.measurePageTheme(env.doc, env.win), 'light');
});

test('an explicit theme choice still beats the measurement', () => {
  const env = loadUserscript({ computedStyles: { body: { backgroundColor: 'rgb(255, 255, 255)' } } });
  assert.strictEqual(env.exports.resolveTheme('dark', env.doc, env.win), 'dark');
  assert.strictEqual(env.exports.resolveTheme('light', env.doc, env.win), 'light');
});

test('measuring never throws, whatever the page hands back', () => {
  const env = loadUserscript();
  env.win.getComputedStyle = () => { throw new Error('detached'); };
  assert.doesNotThrow(() => env.exports.measurePageTheme(env.doc, env.win));
  assert.strictEqual(env.exports.measurePageTheme(env.doc, env.win), null);
  assert.strictEqual(env.exports.resolveTheme('match', env.doc, env.win), 'dark', 'and still resolves');

  assert.strictEqual(env.exports.measurePageTheme(null, null), null);
});

test('the theme is re-applied when Torn switches its own', () => {
  // Torn's toggle changes a class, which is an attribute mutation. The
  // navigation observer only watches childList, so without a second observer
  // the panel kept whichever theme it resolved on the page it loaded into.
  const env = loadUserscript({
    location: { hostname: 'www.torn.com', pathname: '/forums.php', hash: '', search: '' },
    computedStyles: { body: { backgroundColor: 'rgb(20, 20, 20)' } },
    gmStore: [['tfcc:settings', JSON.stringify({ v: 1, theme: 'match' })]],
  });
  const panel = env.doc.getElementById('tfcc-panel');
  assert.strictEqual(panel.classList.contains('tfcc-theme-dark'), true);

  // Torn switches to its light theme, and the observer notices.
  env.win.getComputedStyle = () => ({ getPropertyValue: () => '', backgroundColor: 'rgb(245, 245, 245)' });
  const themeObserver = env.observers.find((o) => o.options && o.options.attributes);
  assert.ok(themeObserver, 'no observer is watching for a theme change');
  themeObserver.cb([{ type: 'attributes', attributeName: 'class' }], themeObserver);

  assert.strictEqual(panel.classList.contains('tfcc-theme-light'), true, 'the panel did not follow');
  assert.strictEqual(panel.classList.contains('tfcc-theme-dark'), false);
});

test('following the theme costs no redraw', () => {
  // It changes two class names and no markup, so it can run as often as needed
  // without taking anyone's caret with it.
  const env = loadUserscript({
    location: { hostname: 'www.torn.com', pathname: '/forums.php', hash: '', search: '' },
    computedStyles: { body: { backgroundColor: 'rgb(20, 20, 20)' } },
    gmStore: [['tfcc:settings', JSON.stringify({ v: 1, theme: 'match' })]],
  });
  const panel = env.doc.getElementById('tfcc-panel');
  const before = panel.renderCount || 0;

  env.win.getComputedStyle = () => ({ getPropertyValue: () => '', backgroundColor: 'rgb(245, 245, 245)' });
  env.exports.applyThemeClass(env.doc, env.win);

  assert.strictEqual(panel.renderCount || 0, before, 'applying a theme rewrote the panel');
  assert.strictEqual(panel.classList.contains('tfcc-theme-light'), true);
});

test('My posts is right-aligned, light grey with dark text, in both themes', () => {
  const rule = (sel) => {
    const i = css.indexOf(sel + ' {');
    assert.ok(i !== -1, 'missing rule: ' + sel);
    return css.slice(i, css.indexOf('}', i));
  };
  const base = rule('#tfcc-panel button.tfcc-nav-mine');
  assert.match(base, /margin-left:\s*auto/);
  assert.match(base, /background:\s*var\(--tfcc-mine-bg\)/);
  assert.match(base, /color:\s*var\(--tfcc-mine-text\)/);
  assert.match(base, /border-color:\s*var\(--tfcc-mine-border\)/);
  assert.match(rule('#tfcc-panel button.tfcc-nav-mine:hover'), /background:\s*var\(--tfcc-mine-hover\)/);
  const pressed = rule('#tfcc-panel button.tfcc-nav-mine[aria-pressed="true"]');
  assert.match(pressed, /background:\s*var\(--tfcc-mine-pressed\)/);
  assert.match(pressed, /box-shadow:\s*inset 0 -3px 0 var\(--tfcc-mine-text\)/, 'pressed needs a non-colour cue');
});

test('the My posts rules come after, and are at least as specific as, the generic button rules', () => {
  const generic = css.indexOf('button[aria-pressed="true"] {');
  const mine = css.indexOf('button.tfcc-nav-mine[aria-pressed="true"] {');
  assert.ok(generic !== -1 && mine > generic, 'a later rule of equal or higher specificity must win');
});

test('every My posts colour token is set in both theme blocks, to the agreed values', () => {
  const dark = { bg: '#d9d9d9', hover: '#c8c8c8', pressed: '#b0b0b0', text: '#141414', border: '#d9d9d9' };
  const light = Object.assign({}, dark, { border: '#5c5c5c' });
  const darkBlock = css.slice(0, css.indexOf('.tfcc-theme-light {'));
  const lightBlock = css.slice(css.indexOf('.tfcc-theme-light {'), css.indexOf('}', css.indexOf('.tfcc-theme-light {')));
  for (const [k, v] of Object.entries(dark)) assert.ok(darkBlock.indexOf('--tfcc-mine-' + k + ': ' + v) !== -1, 'dark ' + k);
  for (const [k, v] of Object.entries(light)) assert.ok(lightBlock.indexOf('--tfcc-mine-' + k + ': ' + v) !== -1, 'light ' + k);
});

test('the reactions pill is its own line and wraps rather than overflowing', () => {
  assert.match(blockFor('#tfcc-panel .tfcc-subhead'), /flex-wrap: wrap/);
  const pill = blockFor('#tfcc-panel button.tfcc-reactions');
  assert.match(pill, /white-space: normal/);
  assert.match(pill, /max-width: 100%/);
  assert.ok(css.includes('#tfcc-panel button.tfcc-reactions:hover {'), 'hover must out-rank the generic button:hover');
  assert.ok(!/\.tfcc-head[^{]*\.tfcc-reactions/.test(css), 'no rule may place the tracker in the header row');
});

test('the karma icon is sized to the text and takes the theme colour', () => {
  const karma = blockFor('#tfcc-panel .tfcc-karma');
  assert.match(karma, /display: inline-flex/);
  assert.match(karma, /white-space: nowrap/);
  assert.match(karma, /color: var\(--tm-text\)/, 'currentColor resolves to a themed colour, not black');
  assert.match(blockFor('#tfcc-panel .tfcc-karma svg'), /flex: none/);
  assert.ok(api.KARMA_ICON_SVG.includes('style="height:1em;width:auto"'));
});

const TIER_TOKENS = ['--tfcc-tier-bronze', '--tfcc-tier-silver', '--tfcc-tier-gold', '--tfcc-tier-legend', '--tfcc-locked'];

function tokenValue(block, name) {
  const m = new RegExp(name + ':\\s*(#[0-9a-f]{6})', 'i').exec(block);
  assert.ok(m, name + ' is defined in this block');
  return m[1];
}
function ratio(a, b) {
  const lum = (h) => {
    const c = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255)
      .map((v) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)));
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  };
  const x = lum(a); const y = lum(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

test('badge tier colours exist in both themes and clear 3:1 on every panel surface', () => {
  // --tm-bg is the panel, --tm-bg-2 the shelf and toast, --tm-bg-3 the chip and
  // controls. Icons need 3:1 (WCAG 1.4.11). The spec's table lists the 4.5:1 text
  // values against --tm-bg and --tm-bg-3; the weakest pair on --tm-bg-2 is
  // --tfcc-locked in light, about 4.2:1.
  for (const sel of ['#tfcc-panel', '#tfcc-panel.tfcc-theme-light']) {
    const block = blockFor(sel);
    for (const surface of ['--tm-bg', '--tm-bg-2', '--tm-bg-3']) {
      const bg = tokenValue(block, surface);
      for (const t of TIER_TOKENS) {
        assert.ok(ratio(tokenValue(block, t), bg) >= 3, sel + ' ' + t + ' on ' + surface);
      }
    }
  }
});

test('the light theme overrides every badge colour token the dark theme sets', () => {
  // The existing "overrides every colour" check matches --tm- only, so a
  // forgotten --tfcc-tier-* in the light block would ship dark-theme colours
  // on a light panel without any test noticing.
  const names = (block) => new Set(block.match(/--tfcc-(?:tier-[a-z]+|locked)(?=\s*:)/g) || []);
  const dark = names(blockFor('#tfcc-panel'));
  const light = names(blockFor('#tfcc-panel.tfcc-theme-light'));
  assert.strictEqual(dark.size, 5, 'four tiers and locked are defined in the dark block');
  assert.deepStrictEqual([...dark].filter((n) => !light.has(n)), []);
});

test('icon fill is set in CSS, so a host svg rule cannot repaint it', () => {
  assert.match(css, /#tfcc-panel \.tfcc-ico path \{ fill: currentColor; fill-rule: evenodd; stroke: none; \}/);
});

test('a tap anywhere on the chip reaches the button', () => {
  assert.match(css, /#tfcc-panel \.tfcc-chip \* \{ pointer-events: none; \}/);
});

test('the toast moves only when the user allows motion', () => {
  const i = css.indexOf('tfcc-fade-in 160ms');
  assert.ok(i !== -1);
  assert.ok(css.lastIndexOf('@media (prefers-reduced-motion: no-preference)', i) !== -1);
  assert.strictEqual(css.split('tfcc-fade-in 160ms').length, 2, 'the animation is applied in one place only');
});

test('the header keeps Refresh, Expand and Hide together on the right', () => {
  assert.match(blockFor('#tfcc-panel .tfcc-head-ctl'), /margin-left: auto/);
  assert.match(blockFor('#tfcc-panel .tfcc-head-btns'), /flex-wrap: nowrap/);
  assert.doesNotMatch(blockFor('#tfcc-panel .tfcc-title'), /margin-right: auto/);
  assert.match(blockFor('#tfcc-panel button.tfcc-chip'), /flex: 0 0 auto/);
});
