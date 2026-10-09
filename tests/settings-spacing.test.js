'use strict';

// #47 item 1: narrow Settings is tighter. One spacing scale: 4px from a label
// to its own control, 8px between items, 12px between sections. Targets stay
// 44px, inputs stay 16px, and nothing changes on a wide panel (that is
// tests/wide-parity.test.js, with no list entry for this item). What a
// browser paints (no overlap, a minimum gap, info icons on their line) is
// tests/contrast-audit.mjs.

const test = require('node:test');
const assert = require('node:assert');
const { loadUserscript } = require('./load-userscript');
const { bootNarrow, redraw } = require('./narrow-helpers');

const { exports: api } = loadUserscript();
const css = api.panelStyleText();
const lines = css.split('\n');

function rule(selector) {
  const line = lines.find((l) => l.startsWith('#tfcc-panel' + selector + ' {'));
  assert.ok(line, 'no rule for ' + selector);
  // A rule may run onto the next line.
  const i = lines.indexOf(line);
  return line.indexOf('}') !== -1 ? line : line + lines[i + 1];
}

test('the scale: 12px between sections, 8px between items, 4px from a label to its control', () => {
  assert.match(rule('.tfcc-narrow .tfcc-set .tfcc-section'), /margin-bottom: 12px;/);
  assert.match(rule('.tfcc-narrow .tfcc-set .tfcc-kv'), /gap: 8px; margin-bottom: 8px;/);
  assert.match(rule('.tfcc-narrow .tfcc-set .tfcc-infobar'), /margin-bottom: 8px;/);
  assert.match(rule('.tfcc-narrow .tfcc-set p.tfcc-note'), /margin: 0 0 8px 0;/);
  // 8px of row gap less the label's 4px.
  assert.match(rule('.tfcc-narrow .tfcc-set .tfcc-kv > label'), /margin-bottom: -4px;/);
  // A note or info bar explaining the row above sits 4px under it.
  assert.match(rule('.tfcc-narrow .tfcc-set .tfcc-kv + .tfcc-infobar'), /margin-top: -4px;/);
  assert.match(rule('.tfcc-narrow .tfcc-set .tfcc-kv + p.tfcc-note'), /margin-top: -4px;/);
});

test('targets stay 44px and fields stay 16px, so iOS does not zoom', () => {
  assert.match(rule('.tfcc-narrow .tfcc-set .tfcc-kvc > label'), /min-height: 44px;/);
  assert.match(rule('.tfcc-narrow button'), /min-height: 44px; min-width: 44px;/);
  assert.match(rule('.tfcc-narrow button.tfcc-unclaim'), /min-width: 44px; min-height: 44px;/);
  assert.match(rule('.tfcc-narrow select'), /font-size: max\(16px, 1em\)/);
  assert.match(rule('.tfcc-narrow input:not([type="checkbox"])'), /font-size: max\(16px, 1em\)/);
  // No Settings rule shrinks text.
  for (const l of lines.filter((x) => x.indexOf('.tfcc-set') !== -1)) assert.doesNotMatch(l, /font-size/, l);
});

test('every Settings spacing rule is narrow-only', () => {
  const set = lines.filter((l) => l.indexOf('.tfcc-set') !== -1 || l.indexOf('.tfcc-kvc') !== -1);
  assert.ok(set.length >= 10);
  for (const l of set) assert.ok(l.startsWith('#tfcc-panel.tfcc-narrow .tfcc-set '), l);
});

test('the Settings wrapper and the checkbox-row class render on a narrow panel only', () => {
  for (const [width, narrow] of [[343, true], [900, false]]) {
    const { env, api: a } = bootNarrow({ width });
    a.state.settings.view = 'settings';
    const html = redraw(env);
    assert.strictEqual(html.includes('<div class="tfcc-set">'), narrow, 'wrapper at ' + width);
    assert.strictEqual((html.match(/class="tfcc-kv tfcc-kvc"/g) || []).length, narrow ? 7 : 0, 'checkbox rows at ' + width);
    a.state.settings.view = 'threads';
    assert.ok(!redraw(env).includes('tfcc-set'), 'no other view is wrapped');
  }
});

// #47 (owner): a narrow folder row is two lines: name, arrows and Delete;
// then its chips and the claim menu. Wide keeps main's order.
test('a narrow folder row puts Delete on the first line and the chips with the menu on the second', () => {
  const { env, api: a } = bootNarrow({ width: 288 });
  a.state.feed.categories = [{ id: 61, title: 'Tutorials and Guides' }, { id: 4, title: 'Suggestions' }];
  a.state.organizer = a.claimForum(a.claimForum(a.state.organizer, 'guides', 61), 'guides', 4);
  a.state.settings.view = 'settings';
  const html = redraw(env);
  const row = /<div class="tfcc-kv tfcc-forder"><label>Guides<\/label>([\s\S]*?)<div class="tfcc-kv/.exec(html)[1];
  const acts = [...row.matchAll(/(data-act="[a-z-]+"|class="tfcc-claimline"|<\/span><\/div>)/g)].map((m) => m[1]);
  assert.deepStrictEqual(acts, ['data-act="folder-up"', 'data-act="folder-down"', 'data-act="folder-delete"',
    'class="tfcc-claimline"', 'data-act="folder-unclaim"', 'data-act="folder-unclaim"', 'data-act="folder-forum"',
    '</span></div>']);
  // Narrow Delete is a named 44px bin icon, so line 1 fits at 280px.
  assert.match(row, /<button type="button" data-act="folder-delete" data-id="guides" class="tfcc-danger tfcc-del" aria-label="Delete Guides" title="Delete Guides"><svg class="tfcc-gl"/);
  // Unfiled is one line: its note under its name, inside the label.
  const unf = /<div class="tfcc-kv tfcc-forder"><label>Unfiled<span class="tfcc-note">Threads in no folder<\/span><\/label>([\s\S]*?)<\/div>/.exec(html);
  assert.ok(unf, 'the Unfiled row');
  assert.doesNotMatch(unf[1], /tfcc-claimline|folder-delete|tfcc-note/, 'Unfiled stays one line');
  assert.match(rule('.tfcc-narrow .tfcc-set .tfcc-claimline'), /flex: 1 1 100%;/);
  // Wide: main's order, no second-line wrapper.
  const wide = bootNarrow({ width: 900 });
  wide.api.state.organizer = a.state.organizer;
  wide.api.state.feed.categories = a.state.feed.categories;
  wide.api.state.settings.view = 'settings';
  const w = redraw(wide.env);
  assert.ok(!w.includes('tfcc-claimline'));
  assert.match(w, /<\/select><button type="button" data-act="folder-delete" data-id="guides"/);
});

test('each narrow checkbox row is the label, then the checkbox, then any info button', () => {
  const { env, api: a } = bootNarrow({ width: 288 });
  a.state.settings.view = 'settings';
  const html = redraw(env);
  const rows = [...html.matchAll(/<div class="tfcc-kv tfcc-kvc">([\s\S]*?)<\/div>/g)].map((m) => m[1]);
  assert.strictEqual(rows.length, 7);
  for (const r of rows) assert.match(r, /^<label for="([^"]+)">[^<]+<\/label><input id="\1" type="checkbox"[^>]*>(<button type="button" class="tfcc-info"|$)/);
});
