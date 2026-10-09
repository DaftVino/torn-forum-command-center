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
  // #33: the viewport query keeps only the fixed fallback mount, which really
  // is viewport-relative; the panel's own narrow rules hang off .tfcc-narrow.
  assert.match(css, /@media \(max-width: 600px\)/);
  const mq = css.slice(css.indexOf('@media (max-width: 600px)'), css.indexOf('}\n', css.indexOf('@media (max-width: 600px)') + 30) + 2);
  assert.match(mq, /#tfcc-fallback-mount/);
  assert.doesNotMatch(mq, /#tfcc-panel /, 'panel rules moved under .tfcc-narrow');
  assert.match(blockFor('#tfcc-panel.tfcc-narrow .tfcc-kv label'), /flex-basis:\s*100%/, 'label and control stack rather than clip');
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

test('narrow rows put their nine controls in a drawer, not a per-row strip (#33)', () => {
  assert.match(blockFor('#tfcc-panel.tfcc-narrow .tfcc-drawer'), /grid-template-columns: repeat\(auto-fit, minmax\(7\.5em, 1fr\)\)/,
    'auto-fit, so 200% text reflows to one column');
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
// #33 (spec 13d item 13) shortened the note. Every access level is still
// stated in the access-level row of the ToS table beside it.
const KEY_HELP_NOTE = 'Create a <strong>Minimal Access</strong> key on Torn (Settings, API Key).';
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
  assert.match(KEY_HELP_NOTE, /Minimal Access/, 'the short note still names the level to create');
  assert.doesNotMatch(KEY_HELP_NOTE, /Limited|Custom/, 'and names no other level');
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

// #43 (owner): My posts takes every nav button's colours, at every width.
// Its old light-grey fill made it look selected. Only its place differs.
test('My posts is right-aligned and coloured like every other nav button (#43)', () => {
  const i = css.indexOf('#tfcc-panel button.tfcc-nav-mine {');
  assert.ok(i !== -1, 'the placement rule');
  assert.strictEqual(css.slice(i, css.indexOf('}', i) + 1), '#tfcc-panel button.tfcc-nav-mine { margin-left: auto; }');
  assert.doesNotMatch(css, /button\.tfcc-nav-mine:hover|button\.tfcc-nav-mine\[aria-pressed/, 'no state colours of its own');
  assert.doesNotMatch(css, /--tfcc-mine-/, 'no My posts colour tokens');
  // Every rule that names it, at every width, sets only layout.
  for (const m of css.matchAll(/([^\n{}]*tfcc-nav-mine[^{]*)\{([^}]*)\}/g)) {
    assert.doesNotMatch(m[2], /background|(^|[^-])color|border-color|font-weight|box-shadow/, m[1].trim());
  }
});

// PR #44 review: the owner asked for the colour scheme only, so the weight
// must be whatever the other nav buttons have: normal on wide (no rule sets
// one), bold on narrow (the .tfcc-navgrid button rule, which My posts shares).
test('My posts has the same font weight as the other nav buttons, at every width (#43)', () => {
  const weightRules = Array.from(css.matchAll(/([^\n{}]*\.tfcc-nav[^{]*)\{([^}]*)\}/g))
    .filter((m) => /font-weight/.test(m[2])).map((m) => m[1].trim());
  assert.deepStrictEqual(weightRules, ['#tfcc-panel.tfcc-narrow .tfcc-navgrid button'],
    'one weight rule for the nav, for every narrow cell alike');
  assert.doesNotMatch(css, /tfcc-nav-mine[^{]*\{[^}]*font-weight/, 'none for My posts alone');
});

test('the narrow and wide My posts buttons carry only their placement class, so the generic states apply (#43)', () => {
  const env = loadUserscript({ location: require('./load-userscript').FORUMS_LOCATION });
  const api = env.exports;
  for (const narrow of [false, true]) {
    api.state.narrow = narrow;
    for (const view of ['threads', 'mine']) {
      api.state.settings.view = view;
      const html = api.panelHtml(api.buildPanelModel(Date.now()));
      const btn = /<button type="button" data-act="view" data-view="mine"([^>]*)>/.exec(html);
      assert.ok(btn, 'My posts renders');
      assert.match(btn[1], /^ class="tfcc-nav-mine" aria-pressed="(true|false)"/);
      assert.match(btn[1], new RegExp('aria-pressed="' + (view === 'mine') + '"'), 'selected only when it is the view');
    }
  }
});

test('the reactions pill sits in the wrapping nav row and wraps rather than overflowing', () => {
  assert.match(blockFor('#tfcc-panel .tfcc-nav'), /flex-wrap: wrap/);
  assert.ok(!css.includes('.tfcc-subhead'), 'the separate row is gone (#30)');
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

test('the logo is sized by height to the badge chip and keeps #5C768F against a host svg rule (#30)', () => {
  const block = blockFor('#tfcc-panel .tfcc-logo');
  assert.match(block, /height: 28px/, 'the badge chip height (min-height 28px, border-box)');
  assert.match(blockFor('#tfcc-panel button.tfcc-chip'), /min-height: 28px/, 'the chip it matches is still 28px');
  assert.match(block, /width: auto/, 'width follows the viewBox');
  assert.match(block, /color: #5c768f/i);
  assert.match(css, /#tfcc-panel \.tfcc-logo path \{ fill: currentColor; \}/,
    'a host "svg * { fill }" rule must not repaint it');
});

test('the pill and My posts group on the right of the nav row (#30)', () => {
  assert.match(blockFor('#tfcc-panel .tfcc-nav button.tfcc-reactions'), /margin-left: auto/);
  assert.match(blockFor('#tfcc-panel .tfcc-nav .tfcc-reactions + button.tfcc-nav-mine'), /margin-left: 0/);
});

test('the thumbs are monochrome: black on light, white on dark (#30)', () => {
  const dark = blockFor('#tfcc-panel .tfcc-thumb');
  assert.match(dark, /filter: grayscale\(1\) brightness\(0\) invert\(1\)/);
  const light = blockFor('#tfcc-panel.tfcc-theme-light .tfcc-thumb');
  assert.match(light, /filter: grayscale\(1\) brightness\(0\);/);
  assert.doesNotMatch(light, /invert/);
  assert.ok(css.indexOf('#tfcc-panel.tfcc-theme-light .tfcc-thumb {') > css.indexOf('#tfcc-panel .tfcc-thumb {'),
    'the light rule comes later and out-ranks the dark one');
});

// Measured against both the row (--tm-bg-2) and the tag fill it sits on
// (--tm-bg-3): dark #ff8080 is 6.2:1 and 7.8:1, light #a11414 is 6.5:1 and
// 8.0:1. WCAG AA for this 12px text is 4.5:1.
test('"started" is red per theme, from its own token, at AA on the row (#30)', () => {
  const lum = (hex) => {
    const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
      .map((v) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)));
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  };
  const ratio = (a, b) => { const x = lum(a); const y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  const token = (block, name) => {
    const m = new RegExp(name + ':\\s*(#[0-9a-f]{6})', 'i').exec(block);
    assert.ok(m, name + ' missing');
    return m[1];
  };
  const dark = blockFor('#tfcc-panel');
  const light = blockFor('#tfcc-panel.tfcc-theme-light');
  for (const [name, block] of [['dark', dark], ['light', light]]) {
    const red = token(block, '--tfcc-started');
    for (const bg of ['--tm-bg-2', '--tm-bg-3']) {
      const r = ratio(red, token(block, bg));
      assert.ok(r >= 4.5, name + ' started on ' + bg + ' is ' + r.toFixed(2) + ':1');
    }
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(red.slice(i, i + 2), 16));
    assert.ok(r > g * 1.5 && r > b * 1.5, name + ' ' + red + ' must read as red');
  }
  assert.match(blockFor('#tfcc-panel .tfcc-tag.tfcc-started'), /color: var\(--tfcc-started\)/);
});

// #45 (owner): the priority number takes the logo's muted blue (#5C768F),
// tuned per theme, so it reads apart from the green "N new" beside it and from
// the grey meta. The logo blue itself is 3.49:1 on dark and 4.22:1 on light,
// too low for 12px text, so each theme has its own lighter or darker blue.
test('the priority number is its own blue per theme, at AA, apart from the green and the meta (#45)', () => {
  const lum = (hex) => {
    const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
      .map((v) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)));
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  };
  const ratio = (a, b) => { const x = lum(a); const y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  // CIELAB (D65), for a perceptual distance between two colours.
  const lab = (hex) => {
    const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
      .map((v) => (v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)));
    const xyz = [
      (0.4124 * c[0] + 0.3576 * c[1] + 0.1805 * c[2]) / 0.95047,
      0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2],
      (0.0193 * c[0] + 0.1192 * c[1] + 0.9505 * c[2]) / 1.08883,
    ].map((t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116));
    return [116 * xyz[1] - 16, 500 * (xyz[0] - xyz[1]), 200 * (xyz[1] - xyz[2])];
  };
  const dE = (a, b) => { const x = lab(a); const y = lab(b); return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]); };
  const token = (block, name) => {
    const m = new RegExp(name + ':\\s*(#[0-9a-f]{6})', 'i').exec(block);
    assert.ok(m, name + ' missing');
    return m[1];
  };
  for (const [name, block] of [['dark', blockFor('#tfcc-panel')], ['light', blockFor('#tfcc-panel.tfcc-theme-light')]]) {
    const blue = token(block, '--tfcc-prio');
    // The row card, the panel behind it, and the field and drawer fill.
    for (const bg of ['--tm-bg-2', '--tm-bg', '--tm-bg-3']) {
      const r = ratio(blue, token(block, bg));
      assert.ok(r >= 4.5, name + ' priority on ' + bg + ' is ' + r.toFixed(2) + ':1');
    }
    // Clearly not the green and not the grey: a large perceptual distance,
    // and a blue hue (blue the strongest channel, red the weakest).
    for (const other of ['--tm-good-text', '--tm-meta']) {
      const d = dE(blue, token(block, other));
      assert.ok(d >= 20, name + ' priority is only ' + d.toFixed(1) + ' from ' + other);
    }
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(blue.slice(i, i + 2), 16));
    assert.ok(b > g && g > r && b - r >= 60, name + ' ' + blue + ' must read as blue');
  }
  assert.match(blockFor('#tfcc-panel .tfcc-prio'), /color: var\(--tfcc-prio\)/);
});

test('a tap on a span inside any panel button lands on the button, so the reactions pill opens My posts (#30)', () => {
  assert.match(css, /#tfcc-panel button \* \{ pointer-events: none; \}/,
    'the click listener reads data-act from ev.target only');
});

test('the header keeps Refresh, Expand and Hide together on the right', () => {
  assert.match(blockFor('#tfcc-panel .tfcc-head-ctl'), /margin-left: auto/);
  assert.match(blockFor('#tfcc-panel .tfcc-head-btns'), /flex-wrap: nowrap/);
  assert.doesNotMatch(blockFor('#tfcc-panel .tfcc-logo'), /margin-right: auto/);
  assert.match(blockFor('#tfcc-panel button.tfcc-chip'), /flex: 0 0 auto/);
});

test('the narrow header gaps add up to HB_GAPS, which the header maths assumes (#33)', () => {
  const gap = (sel) => Number((/gap: (\d+)px/.exec(blockFor(sel)) || [])[1]);
  const head = gap('#tfcc-panel.tfcc-narrow .tfcc-head');
  const id = gap('#tfcc-panel.tfcc-narrow .tfcc-head-id');
  const btns = gap('#tfcc-panel.tfcc-narrow .tfcc-head-btns');
  assert.strictEqual(id + head + 2 * btns, api.HB_GAPS);
  assert.match(blockFor('#tfcc-panel.tfcc-narrow .tfcc-head'), /flex-wrap: nowrap/);
  assert.match(blockFor('#tfcc-panel.tfcc-narrow .tfcc-head-ctl'), /flex: none/, 'the buttons never shrink or wrap');
  assert.match(blockFor('#tfcc-panel.tfcc-narrow button.tfcc-hbtn'), /width: var\(--tfcc-hb\)/);
  assert.match(blockFor('#tfcc-panel.tfcc-narrow .tfcc-logo'), /clamp\(16px, calc\(var\(--tfcc-hb\) \* 0\.545\), 24px\)/);
  assert.match(blockFor('#tfcc-panel.tfcc-narrow .tfcc-pill'), /min-height: min\(28px, var\(--tfcc-hb\)\)/);
});

test('the v1 nav tokens are the owner\'s values (#33, spec 13f)', () => {
  const block = blockFor('#tfcc-panel');
  for (const [k, v] of [['--tfcc-navnum-opacity', '0.14'], ['--tfcc-navnum-opacity-selected', '0.09'],
    ['--tfcc-navlab-opacity', '0.9'], ['--tfcc-navlab-opacity-selected', '0.96'], ['--tfcc-navnum-size', '40px']]) {
    assert.ok(block.includes(k + ': ' + v + ';'), k);
  }
});

test('every nav label stays at 4.5:1 over the numeral painted on its cell, in both themes (#33)', () => {
  // The same composite the mockup's in-page script measures: the numeral is
  // the cell's text colour at the numeral opacity over the cell; the label is
  // the text colour at the label opacity over that numeral.
  const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const toHex = (c) => '#' + c.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
  const mix = (fg, bg, a) => fg.map((v, i) => v * a + bg[i] * (1 - a));
  const op = (name) => Number(new RegExp(name + ':\\s*([0-9.]+);').exec(blockFor('#tfcc-panel'))[1]);
  const dark = blockFor('#tfcc-panel');
  const light = blockFor('#tfcc-panel.tfcc-theme-light');
  const t = (block, name) => tokenValue(block, name);
  const states = [];
  for (const [theme, block] of [['dark', dark], ['light', light]]) {
    states.push([theme + ' default', t(block, '--tm-text'), t(block, '--tm-bg-3'), false]);
    states.push([theme + ' selected', t(block, '--tm-text'), t(block, '--tm-good-bg'), true]);
  }
  for (const [label, text, cell, selected] of states) {
    const num = mix(hex(text), hex(cell), op(selected ? '--tfcc-navnum-opacity-selected' : '--tfcc-navnum-opacity'));
    const lab = mix(hex(text), num, op(selected ? '--tfcc-navlab-opacity-selected' : '--tfcc-navlab-opacity'));
    const r = ratio(toHex(lab), toHex(num));
    assert.ok(r >= 4.5, label + ': label over numeral is ' + r.toFixed(2) + ':1');
  }
});

test('the numeral takes its colour from the cell and has no outline (#33)', () => {
  const num = blockFor('#tfcc-panel.tfcc-narrow .tfcc-navnum');
  assert.doesNotMatch(num, /(^|[^-])color\s*:/, 'no colour of its own: currentColor is the cell\'s text');
  assert.doesNotMatch(css, /-webkit-text-stroke/, 'an outline is how v2 vanished');
  assert.match(num, /opacity: var\(--tfcc-navnum-opacity\)/);
  assert.match(blockFor('#tfcc-panel.tfcc-narrow .tfcc-navgrid button[aria-pressed="true"] .tfcc-navnum'),
    /opacity: var\(--tfcc-navnum-opacity-selected\)/);
  assert.match(blockFor('#tfcc-panel.tfcc-narrow .tfcc-navlab'), /white-space: nowrap/, 'a label never wraps');
});

// Every narrow rule, as [selector, body].
function narrowRules() {
  const out = [];
  const re = /(#tfcc-panel\.tfcc-narrow[^{]*)\{([^}]*)\}/g;
  let m;
  while ((m = re.exec(css))) out.push([m[1].trim(), m[2]]);
  return out;
}

test('every narrow control outside the header has a real 44px box (#33, spec principle 4)', () => {
  for (const sel of ['#tfcc-panel.tfcc-narrow button', '#tfcc-panel.tfcc-narrow select',
    '#tfcc-panel.tfcc-narrow .tfcc-linkbtn', '#tfcc-panel.tfcc-narrow input:not([type="checkbox"])']) {
    assert.match(blockFor(sel), /min-height: 44px; min-width: 44px;/, sel);
  }
  // #39: the row drawer is compact by the owner's choice (32px, 24px floor),
  // checked in tests/narrow-polish.test.js.
  const headerOrTitle = /tfcc-hbtn|tfcc-hshow|tfcc-chip|tfcc-row-title a|tfcc-drawer/;
  for (const [sel, body] of narrowRules()) {
    if (!/button|select|input|tfcc-linkbtn/.test(sel) || headerOrTitle.test(sel)) continue;
    for (const prop of ['min-height', 'min-width']) {
      const m = new RegExp(prop + ':\\s*([0-9.]+)px').exec(body);
      if (m) assert.ok(Number(m[1]) >= 44, sel + ' sets ' + prop + ' ' + m[1] + 'px');
    }
  }
});

test('the header buttons use the scaled size, and only they go below 44px', () => {
  for (const [sel, body] of narrowRules()) {
    if (/tfcc-hbtn|tfcc-hshow/.test(sel) && /min-height/.test(body)) assert.match(body, /min-height: var\(--tfcc-hb\)/, sel);
  }
});

test('narrow rules use min sizes, no fixed heights, no pseudo-element targets, no motion (#33)', () => {
  for (const [sel, body] of narrowRules()) {
    // .tfcc-sr is the visually-hidden pattern (1px by design), not a control.
    if (!/\.tfcc-sr$/.test(sel)) assert.doesNotMatch(body, /(^|[^-])height:\s*\d/, sel + ' sets a fixed height');
    assert.doesNotMatch(sel, /::?(after|before)/, sel + ' is a pseudo-element hit area');
    assert.doesNotMatch(body, /transition|animation/, sel + ' animates');
  }
});

test('narrow text fields are 16px or more, so iOS does not zoom (#33)', () => {
  for (const sel of ['#tfcc-panel.tfcc-narrow input:not([type="checkbox"])', '#tfcc-panel.tfcc-narrow select',
    '#tfcc-panel.tfcc-narrow textarea']) {
    assert.match(blockFor(sel), /font-size: max\(16px, 1em\);/, sel);
  }
});

test('an info button never wraps away from the text or control it follows (#33, PR review)', () => {
  const bar = blockFor('#tfcc-panel .tfcc-infobar');
  assert.match(bar, /flex-wrap: nowrap/, 'a long note wraps inside itself, not under the button');
  assert.match(blockFor('#tfcc-panel .tfcc-infobar > .tfcc-note'), /flex: 0 1 auto; min-width: 0;/);
  assert.match(blockFor('#tfcc-panel button.tfcc-info'), /flex: none/);
  const group = blockFor('#tfcc-panel.tfcc-narrow .tfcc-infogroup');
  assert.match(group, /display: flex/);
  assert.match(group, /flex-wrap: nowrap/);
  assert.match(blockFor('#tfcc-panel.tfcc-narrow .tfcc-infogroup > :first-child'), /white-space: normal/,
    'at 280px the button\'s label wraps inside it rather than dropping the info button');
});
