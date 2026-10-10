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
// #45: the priority colour, the reorderable folder list and the collapsible
// Catch up groups, applied after #43 (tests/wide-45-diffs.js).
const D45 = require('./wide-45-diffs');
// #47: several forums per folder (the claim menu's name, the folder note,
// the chip rules), applied after #45 (tests/wide-47-diffs.js). The tighter
// narrow Settings adds nothing here: it is narrow-only.
const D47 = require('./wide-47-diffs');
// #53: the logo's per-theme colour token (tests/wide-53-diffs.js). The
// narrow reactions pill adds nothing here: it is narrow-only.
const D53 = require('./wide-53-diffs');
// #58: the Drafts rich editor (tests/wide-58-diffs.js): the editor pane, + New
// draft, Edit, and the Default editor setting, applied after the release list.
const D58 = require('./wide-58-diffs');
// Releases: the Settings footer's version, which follows @version
// (tests/wide-release-diffs.js), applied last.
const DREL = require('./wide-release-diffs');

function expectedView(view, before43) {
  let html = golden.views[view];
  for (const d of D13.concat(D41, D43.literals).filter((x) => x.view === view)) {
    const n = html.split(d.from).length - 1;
    assert.strictEqual(n, 1, 'item ' + d.item + ': its "from" occurs ' + n + ' times in main\'s ' + view);
    html = html.replace(d.from, () => d.to);
  }
  if (before43) return html;
  for (const d of D43.markup) {
    const before = html;
    html = d.apply(html);
    assert.deepStrictEqual(d.changed(before, html), d.hits[view] || [], 'item ' + d.item + ' in ' + view);
  }
  for (const d of D45.literals.concat(D47.literals, DREL.literals, D58.literals).filter((x) => x.view === view)) {
    const n = html.split(d.from).length - 1;
    assert.strictEqual(n, 1, 'item ' + d.item + ': its "from" occurs ' + n + ' times in ' + view);
    html = html.replace(d.from, () => d.to);
  }
  return html;
}

// Main's stylesheet with the #43 line replacements applied.
function expectedCss() {
  let out = golden.css.slice();
  for (const d of D43.css.concat(D45.css, D53.css)) {
    const n = out.filter((line) => line === d.from).length;
    assert.strictEqual(n, d.times || 1, 'item ' + d.item + ': its "from" occurs ' + n + ' times in the main stylesheet');
    out = out.flatMap((line) => (line === d.from ? d.to : [line]));
  }
  return out;
}

test('every #43 markup entry changes exactly the controls it names, and nothing else', () => {
  const titles = (h) => (h.match(/ title="/g) || []).length;
  for (const d of D43.markup) {
    for (const view of Object.keys(golden.views)) {
      const before = expectedView(view, true);
      const after = d.apply(before);
      const want = d.hits[view] || [];
      assert.deepStrictEqual(d.changed(before, after), want, d.item + ' in ' + view + ': which controls');
      assert.strictEqual(titles(after) - titles(before), want.length, d.item + ' in ' + view + ': how many');
      // Outside the named buttons' opening tags the view is untouched.
      const strip = (h) => h.replace(/<button type="button" class="tfcc-info"[^>]*>/g, '<INFO>');
      assert.strictEqual(strip(after), strip(before), d.item + ' in ' + view + ': nothing else');
    }
    assert.strictEqual(Object.values(d.hits).flat().length, 10, d.item + ': ten info buttons in all');
  }
  // An unrelated element naming an info id is left alone.
  const stray = '<p aria-controls="tfcc-info-catchup" aria-label="About Catch up">x</p>';
  assert.strictEqual(D43.markup[0].apply(stray), stray);
});

test('every complete wide view is main\'s, byte for byte, apart from the listed 13d items', () => {
  const now = captureWide(loadUserscript, FORUMS_LOCATION);
  const views = ['threads', 'threadsCapped', 'collapsed', 'catchup', 'mine', 'search', 'drafts', 'settings', 'loading', 'error'];
  assert.deepStrictEqual(Object.keys(golden.views).sort(), views.slice().sort(), 'the golden holds every view');
  for (const view of views) assert.strictEqual(now.views[view], expectedView(view), view);
});

// #45: Threads stays flat (owner decision), so its wide markup is untouched;
// only Catch up's group heading and Settings' folder list change.
test('the #45 list touches only Catch up and Settings', () => {
  assert.ok(D45.literals.length > 0);
  for (const d of D45.literals) assert.ok(['catchup', 'settings'].includes(d.view), d.item);
});

test('the #47 list touches only Settings', () => {
  assert.ok(D47.literals.length > 0);
  for (const d of D47.literals) assert.strictEqual(d.view, 'settings', d.item);
});

test('the #58 list touches only Drafts and Settings', () => {
  assert.ok(D58.literals.length > 0);
  for (const d of D58.literals) assert.ok(['drafts', 'settings'].includes(d.view), d.item);
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

// Every stylesheet line a wide panel may see that is not main's (PR #46
// review: listing selectors let any body through under an approved selector,
// and token lines through unchecked). Each list names complete lines; the
// test compares the multiset exactly, so an extra line, an edited body or a
// second copy fails even under an approved selector. A line is wide-visible
// unless every selector of the rule it sits in hangs off .tfcc-narrow.
//
// 13d (every size): the hidden attribute, the glyph, the info bar, the info
// button (its body as #43 made it a bare icon) and its explanation.
const WIDE_13D_LINES = [
  '#tfcc-panel [hidden] { display: none !important; }',
  '#tfcc-panel .tfcc-gl { display: block; flex: none; }',
  '#tfcc-panel .tfcc-gl path { fill: none; stroke: currentColor; stroke-width: 2;',
  '  stroke-linecap: round; stroke-linejoin: round; }',
  '#tfcc-panel .tfcc-infobar { display: flex; align-items: center; gap: var(--tfcc-gap-sm);',
  '  flex-wrap: nowrap; margin-bottom: var(--tfcc-gap-sm); }',
  // PR #38 review: the note in an info bar wraps inside itself.
  '#tfcc-panel .tfcc-infobar > .tfcc-note { flex: 0 1 auto; min-width: 0; }',
  '#tfcc-panel .tfcc-infobar h4 { margin: 0; }',
  '#tfcc-panel button.tfcc-info { display: inline-flex; align-items: center; justify-content: center;',
  '  flex: none; min-width: 44px; min-height: 44px; padding: 0; border-color: transparent; background: transparent; }',
  '#tfcc-panel button.tfcc-info[aria-expanded="true"] { background: transparent; color: var(--tm-accent-text); }',
  '#tfcc-panel .tfcc-infotext { border-left: 3px solid var(--tm-accent-text);',
  '  padding: 2px 0 2px 8px; margin: 0 0 var(--tfcc-gap-sm) 0; }',
];

// #33: the narrow header size and the nav numeral tokens, declared in the
// base block (a token alone changes nothing a wide panel paints).
const WIDE_33_TOKENS = [
  '  --tfcc-hb: 44px;',
  '  --tfcc-navnum-opacity: 0.14; --tfcc-navnum-opacity-selected: 0.09;',
  '  --tfcc-navlab-opacity: 0.9; --tfcc-navlab-opacity-selected: 0.96; --tfcc-navnum-size: 40px;',
];

// #41: the clip setting's rules, which a wide panel sees only while it
// carries tfcc-clip (the setting on).
const WIDE_41_LINES = [
  '#tfcc-panel.tfcc-clip .tfcc-row-main .tfcc-row-title { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }',
  '#tfcc-panel.tfcc-clip .tfcc-row > .tfcc-note { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }',
  '#tfcc-panel.tfcc-clip .tfcc-row.tfcc-open > .tfcc-note { white-space: normal; overflow: visible; }',
];

// Each stylesheet line with the selector of the innermost rule it sits in.
function withContext(lines) {
  const stack = [];
  return lines.map((line) => {
    let ctx = stack.length ? stack[stack.length - 1] : null;
    const open = line.indexOf('{');
    if (open !== -1) { ctx = line.slice(0, open).trim(); stack.push(ctx); }
    const closes = (line.match(/\}/g) || []).length;
    for (let i = 0; i < closes; i += 1) stack.pop();
    return { line, ctx };
  });
}

const narrowOnly = (ctx) => !!ctx && !ctx.startsWith('@')
  && ctx.split(',').every((part) => part.indexOf('.tfcc-narrow') !== -1);

// The lines of the stylesheet that are not main's (after the listed CSS
// replacements) and that a wide panel can see, in order.
function wideInsertedLines(css) {
  const expected = expectedCss();
  const mains = new Array(css.length).fill(false);
  let at = 0;
  for (const line of expected) {
    const found = css.indexOf(line, at);
    if (found !== -1) { mains[found] = true; at = found + 1; }
  }
  return withContext(css).filter((x, i) => !mains[i] && !narrowOnly(x.ctx)).map((x) => x.line);
}

test('every stylesheet line a wide panel sees beyond main\'s is listed, exactly and with its count', () => {
  const approved = WIDE_13D_LINES.concat(WIDE_33_TOKENS, WIDE_41_LINES, D43.inserted, D45.inserted, D47.inserted, D53.inserted, D58.inserted);
  const now = wideInsertedLines(captureWide(loadUserscript, FORUMS_LOCATION).css);
  assert.deepStrictEqual(now.slice().sort(), approved.slice().sort(), 'wide CSS beyond the listed lines');
  for (const line of WIDE_41_LINES) assert.ok(line.startsWith('#tfcc-panel.tfcc-clip '), line);
  // #43: every see-through rule hangs off its setting's class.
  for (const line of D43.inserted) {
    if (line.indexOf('tfcc-seethrough') !== -1 && line.indexOf('{') !== -1) {
      assert.ok(/^#tfcc-panel\.tfcc-seethrough(\.| |\{)/.test(line), line);
    }
  }
});

test('the wide CSS check rejects an extra body line or a second rule under an approved selector', () => {
  // The two holes the PR #46 review named, planted on a copy of the stylesheet.
  const css = captureWide(loadUserscript, FORUMS_LOCATION).css;
  const approved = WIDE_13D_LINES.concat(WIDE_33_TOKENS, WIDE_41_LINES, D43.inserted, D45.inserted, D47.inserted, D53.inserted, D58.inserted).sort();
  const grp = css.indexOf('  font: inherit; font-weight: bold; text-align: left; cursor: pointer; }');
  assert.ok(grp !== -1);
  const italic = css.slice();
  italic.splice(grp, 0, '  font-style: italic;');
  assert.notDeepStrictEqual(wideInsertedLines(italic).sort(), approved, 'an extra body line');
  const twice = css.concat(['#tfcc-panel .tfcc-prio { color: red; }']);
  assert.notDeepStrictEqual(wideInsertedLines(twice).sort(), approved, 'a second rule for an approved selector');
  const token = css.concat(['#tfcc-panel {', '  --tfcc-prio: #ff0000;', '}']);
  assert.notDeepStrictEqual(wideInsertedLines(token).sort(), approved, 'a third token declaration');
  const narrow = css.concat(['#tfcc-panel.tfcc-narrow .x, #tfcc-panel .x { color: red; }']);
  assert.notDeepStrictEqual(wideInsertedLines(narrow).sort(), approved, 'a selector list only half narrow');
  assert.deepStrictEqual(wideInsertedLines(css.concat(['#tfcc-panel.tfcc-narrow .x { color: red; }'])).sort(), approved,
    'a narrow-only rule is not a wide change');
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

// #43 (owner): with "See-through background" ON, the wide markup is the OFF
// markup plus exactly the Settings checkbox ticked. The see-through itself is
// the tfcc-seethrough class the runtime puts on the panel (not markup), and
// every rule it switches on is listed in wide-43-diffs.js; the stylesheet is
// the same text either way.
test('what see-through on adds to the wide output, and nothing more (#43)', () => {
  const off = captureWide(loadUserscript, FORUMS_LOCATION, false, false);
  const on = captureWide(loadUserscript, FORUMS_LOCATION, false, true);
  assert.deepStrictEqual(on.css, off.css);
  for (const view of Object.keys(off.views)) {
    let want = off.views[view];
    if (view === 'settings') {
      assert.ok(want.includes('data-act="see-through">'), 'the checkbox is there, unticked, with it off');
      want = want.replace('data-act="see-through">', 'data-act="see-through" checked>');
    }
    assert.strictEqual(on.views[view], want, view);
  }
  assert.deepStrictEqual(on.nav, off.nav);
  assert.deepStrictEqual(on.rows, off.rows);
});
