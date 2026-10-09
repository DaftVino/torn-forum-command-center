'use strict';

// Desktop does not change (#33, spec section 7). The golden was captured from
// main before any #33 code landed; see tests/make-wide-golden.mjs.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { loadUserscript, FORUMS_LOCATION } = require('./load-userscript');
const { captureWide } = require('./wide-seed');

const golden = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'wide-golden.json'), 'utf8'));

// The panel-internal rules that left `@media (max-width: 600px)` for
// `#tfcc-panel.tfcc-narrow` (spec section 5). Only these may disappear.
const MOVED_OUT_OF_MEDIA = new Set([
  '  #tfcc-panel { padding: 8px; }',
  '  #tfcc-panel .tfcc-kv label { min-width: 0; flex-basis: 100%; }',
  '  #tfcc-panel .tfcc-grow { flex-basis: 100%; }',
  '  #tfcc-panel .tfcc-row { padding: var(--tfcc-gap-xs) var(--tfcc-gap-sm); }',
  '  #tfcc-panel .tfcc-actions { gap: 3px; }',
  '  #tfcc-panel .tfcc-actions button { padding: 1px 5px; }',
  '  #tfcc-panel .tfcc-actions input, #tfcc-panel .tfcc-actions select {',
  '    padding: 1px 4px; font-size: var(--tfcc-text-sm); max-width: 46%; }',
  '  #tfcc-panel .tfcc-meta { gap: var(--tfcc-gap-sm); }',
]);

// The owner's section 13d changes are the only wide markup changes allowed.
// Each is one literal replacement, written in the commit that makes it
// (tests/wide-13d-diffs.js); every `from` must occur exactly once in main's
// golden, so a stale or widened entry fails here rather than hiding a change.
const D13 = require('./wide-13d-diffs');
// #41: the clip setting's Settings checkbox, applied after the 13d list. The
// golden is compared with the setting OFF (tests/wide-seed.js), where every
// wide row is main's; the test "what clip on adds" below pins the rest.
const D41 = require('./wide-41-diffs');
// #43: the owner's wide changes (info hover notes, the My posts colour, the
// semi-transparent backgrounds, the bare info icon), applied last. Each
// markup entry states how many places it changes; each CSS entry replaces
// one line of main's stylesheet, required exactly once.
const D43 = require('./wide-43-diffs');

function expectedView(view, before43) {
  let html = golden.views[view];
  for (const d of D13.concat(D41).filter((x) => x.view === view)) {
    const n = html.split(d.from).length - 1;
    assert.strictEqual(n, 1, 'item ' + d.item + ': its "from" occurs ' + n + ' times in main\'s ' + view);
    html = html.replace(d.from, () => d.to);
  }
  if (before43) return html;
  for (const d of D43.markup) {
    const before = html;
    html = d.apply(html);
    const changed = d.count(before);
    if (changed === 0) assert.strictEqual(html, before, 'item ' + d.item + ' changed ' + view + ', which it does not name');
  }
  return html;
}

// Main's stylesheet with the #43 line replacements applied.
function expectedCss() {
  const out = golden.css.slice();
  for (const d of D43.css) {
    const at = [];
    out.forEach((line, i) => { if (line === d.from) at.push(i); });
    assert.strictEqual(at.length, 1, 'item ' + d.item + ': its "from" occurs ' + at.length + ' times in the main stylesheet');
    out.splice(at[0], 1, ...d.to);
  }
  return out;
}

test('every #43 markup entry changes exactly the places it names', () => {
  const titles = (h) => (h.match(/ title="/g) || []).length;
  for (const d of D43.markup) {
    let total = 0;
    for (const view of Object.keys(golden.views)) {
      const before = expectedView(view, true);
      total += d.count(before);
      assert.strictEqual(titles(d.apply(before)) - titles(before), d.count(before),
        d.item + ' in ' + view + ': one hover note per place it names');
    }
    assert.ok(total > 0, d.item + ' matches nothing');
  }
});

test('every complete wide view is main\'s, byte for byte, apart from the listed 13d items', () => {
  const now = captureWide(loadUserscript, FORUMS_LOCATION);
  const views = ['threads', 'threadsCapped', 'collapsed', 'catchup', 'mine', 'search', 'drafts', 'settings', 'loading', 'error'];
  assert.deepStrictEqual(Object.keys(golden.views).sort(), views.slice().sort(), 'the golden holds every view');
  for (const view of views) assert.strictEqual(now.views[view], expectedView(view), view);
});

test('the 13d list touches only the views the owner changed', () => {
  for (const d of D13) assert.ok(['catchup', 'mine', 'search', 'drafts', 'settings'].includes(d.view), d.item);
});

test('every wide nav and every wide row is byte-identical to main', () => {
  const now = captureWide(loadUserscript, FORUMS_LOCATION);
  assert.deepStrictEqual(Object.keys(now.nav).sort(), Object.keys(golden.nav).sort());
  for (const view of Object.keys(golden.nav)) {
    assert.strictEqual(now.nav[view], golden.nav[view], 'nav in ' + view);
    assert.deepStrictEqual(now.rows[view], golden.rows[view], 'rows in ' + view);
  }
});

test('no stylesheet line from main was removed or edited, apart from the rules that moved to .tfcc-narrow', () => {
  // A subsequence check: every old line still appears, in order. New lines
  // may be inserted anywhere; an edited line shows up as a missing one.
  const now = captureWide(loadUserscript, FORUMS_LOCATION).css;
  let at = 0;
  const missing = [];
  for (const line of expectedCss()) {
    if (MOVED_OUT_OF_MEDIA.has(line)) continue;
    const found = now.indexOf(line, at);
    if (found === -1) missing.push(line); else at = found + 1;
  }
  assert.deepStrictEqual(missing, [], 'wide CSS lines removed, edited or reordered');
});

// The only new rules a wide panel may see: the 13d info button, its text, the
// glyph it draws and the hidden attribute (spec 13d, every size). Everything
// else #33 adds hangs off .tfcc-narrow.
const WIDE_13D_SELECTORS = new Set([
  '#tfcc-panel [hidden]',
  '#tfcc-panel .tfcc-gl',
  '#tfcc-panel .tfcc-gl path',
  '#tfcc-panel .tfcc-infobar',
  '#tfcc-panel .tfcc-infobar h4',
  // PR #38 review: the note in an info bar wraps inside itself.
  '#tfcc-panel .tfcc-infobar > .tfcc-note',
  '#tfcc-panel button.tfcc-info',
  '#tfcc-panel button.tfcc-info[aria-expanded="true"]',
  '#tfcc-panel .tfcc-infotext',
]);

// #41: the clip setting's rules, which a wide panel sees only while it carries
// tfcc-clip (the setting on). Each hangs off .tfcc-clip.
const WIDE_41_SELECTORS = new Set([
  '#tfcc-panel.tfcc-clip .tfcc-row-main .tfcc-row-title',
  '#tfcc-panel.tfcc-clip .tfcc-row > .tfcc-note',
  '#tfcc-panel.tfcc-clip .tfcc-row.tfcc-open > .tfcc-note',
]);

test('every new stylesheet rule is scoped to .tfcc-narrow or is a listed 13d or #41 rule', () => {
  const old = new Set(expectedCss());
  const stray = captureWide(loadUserscript, FORUMS_LOCATION).css
    .filter((line) => !old.has(line) && line.indexOf('{') !== -1)
    .map((line) => line.slice(0, line.indexOf('{')).trim())
    .filter((sel) => sel.indexOf('.tfcc-narrow') === -1 && !WIDE_13D_SELECTORS.has(sel) && !WIDE_41_SELECTORS.has(sel)
      && !D43.selectors.has(sel));
  assert.deepStrictEqual(stray, [], 'a new rule a wide panel would see');
  for (const sel of WIDE_41_SELECTORS) assert.ok(sel.startsWith('#tfcc-panel.tfcc-clip '), sel);
});

// #41: with the clip setting ON, the wide output is the OFF output plus
// exactly: a title tooltip on each row's title span and note, and the
// Settings checkbox ticked. Nothing else; the stylesheet is the same text.
test('what clip on adds to the wide output, and nothing more (#41)', () => {
  const off = captureWide(loadUserscript, FORUMS_LOCATION, false);
  const on = captureWide(loadUserscript, FORUMS_LOCATION, true);
  assert.deepStrictEqual(on.css, off.css);
  const strip = (html) => html
    .replace(/<span class="tfcc-row-title" title="[^"]*">/g, '<span class="tfcc-row-title">')
    .replace(/<div class="tfcc-note" title="[^"]*">/g, '<div class="tfcc-note">');
  let tips = 0;
  for (const view of Object.keys(off.views)) {
    let want = off.views[view];
    if (view === 'settings') {
      want = want.replace('data-act="clip-lines">', 'data-act="clip-lines" checked>');
    }
    assert.strictEqual(strip(on.views[view]), want, view);
    tips += (on.views[view].match(/<span class="tfcc-row-title" title="/g) || []).length;
  }
  assert.ok(tips > 0, 'the rows carry tooltips');
  for (const view of Object.keys(off.rows)) {
    assert.deepStrictEqual(on.rows[view].map(strip), off.rows[view], 'rows in ' + view);
    for (const row of on.rows[view]) {
      const t = /<span class="tfcc-row-title" title="([^"]*)"><a [^>]*>([^<]*)<\/a>/.exec(row);
      assert.ok(t, 'each row has its tooltip in ' + view);
      assert.strictEqual(t[1], t[2], 'the tooltip is the full title, the link text unchanged');
    }
  }
  const noted = off.rows.threads.filter((r) => r.includes('<div class="tfcc-note">'));
  assert.ok(noted.length > 0, 'the seed has a note');
  assert.ok(on.rows.threads.some((r) => r.includes('<div class="tfcc-note" title="The one to link people to.">')));
  assert.deepStrictEqual(on.nav, off.nav);
});
