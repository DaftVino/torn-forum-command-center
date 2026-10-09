'use strict';

// #43: the owner-approved wide changes, applied by tests/wide-parity.test.js
// after the 13d and #41 lists. The golden is never regenerated; every change
// a wide panel sees is named here.
//
// markup: each entry rewrites a whole view. `hits` names, per view, exactly
// which controls it changes (the parity test checks the identities and the
// number), so a widened or stale entry fails rather than hiding a change.
//
// css: each entry replaces a line of main's stylesheet (`from`, required
// exactly `times` times in the golden, once unless stated) with the lines in
// `to` (none removes it).
//
// selectors: the new rules a wide panel may now see.

// 1. Every info button carries a hover note equal to its accessible name, so
//    no icon-only button in the panel is without a title (#43 item 2). The
//    wide panel's only icon-only buttons are the info buttons. The pattern is
//    the whole opening tag of an info button (PR #44 review), so nothing else
//    that names a tfcc-info-* id can take the replacement.
const INFO_TAG = /(<button type="button" class="tfcc-info" data-act="info" data-info="([a-z0-9-]+)" aria-expanded="(?:true|false)" aria-controls="tfcc-info-\2" aria-label="([^"]*)")>/g;

const markup = [
  {
    item: '43 info button hover note',
    apply: (html) => html.replace(INFO_TAG, (m, head, key, name) => head + ' title="' + name + '">'),
    // The info keys this changes in each view, in order: main's views with
    // the 13d and #41 lists applied. Every other view changes nowhere.
    hits: {
      catchup: ['catchup'],
      mine: ['mine'],
      search: ['search'],
      settings: ['settings-budget', 'settings-author', 'settings-rows', 'settings-autohide', 'settings-clip',
        'settings-folders', 'settings-badges'],
    },
    // Which keys it really changed in a view: the info buttons whose opening
    // tag gained the title.
    changed: (before, after) => {
      const titled = (h) => Array.from(h.matchAll(/data-act="info" data-info="([a-z0-9-]+)"[^>]* title="[^"]*">/g), (m) => m[1]);
      const was = titled(before);
      return titled(after).filter((k, i) => was.indexOf(k) === -1 || i >= was.length);
    },
  },
];

// 2. My posts takes every nav button's colours (#43 item 4, owner: its
//    light-grey fill looked selected). Its rule keeps only its placement;
//    its hover and pressed rules and its five colour tokens go.
const MINE = '43 My posts colour';

const css = [
  { item: MINE, from: '  --tfcc-mine-bg: #d9d9d9; --tfcc-mine-hover: #c8c8c8; --tfcc-mine-pressed: #b0b0b0;', times: 2, to: [] },
  { item: MINE, from: '  --tfcc-mine-text: #141414; --tfcc-mine-border: #d9d9d9;', to: [] },
  { item: MINE, from: '  --tfcc-mine-text: #141414; --tfcc-mine-border: #5c5c5c;', to: [] },
  { item: MINE, from: '#tfcc-panel button.tfcc-nav-mine { margin-left: auto; background: var(--tfcc-mine-bg);',
    to: ['#tfcc-panel button.tfcc-nav-mine { margin-left: auto; }'] },
  // Its font-weight: bold goes with it (PR #44 review): the owner asked for
  // its colours to match, and matching means its weight is the other nav
  // buttons' too, normal on wide and the narrow grid's bold on narrow, where
  // every cell already shares one rule. tests/style.test.js and the contrast
  // audit check the weights are equal.
  { item: MINE, from: '  color: var(--tfcc-mine-text); border-color: var(--tfcc-mine-border); font-weight: bold; }', to: [] },
  { item: MINE, from: '#tfcc-panel button.tfcc-nav-mine:hover { background: var(--tfcc-mine-hover);', to: [] },
  { item: MINE, from: '  color: var(--tfcc-mine-text); }', to: [] },
  { item: MINE, from: '#tfcc-panel button.tfcc-nav-mine[aria-pressed="true"] { background: var(--tfcc-mine-pressed);', to: [] },
  { item: MINE, from: '  color: var(--tfcc-mine-text); box-shadow: inset 0 -3px 0 var(--tfcc-mine-text); }', to: [] },
  // 4. Semi-transparent backgrounds (#43 item 5, owner): the panel at 50%,
  //    the surfaces on --tm-bg-2 (thread rows, the badge shelf and toast) at
  //    75%, by alpha on two new tokens (inserted into the theme blocks, so not
  //    replacements); solid again in takeover. Only these three lines change.
  { item: '43 transparency', from: '  background: var(--tm-bg); color: var(--tm-text); border-radius: 6px;',
    to: ['  background: var(--tfcc-panel-bg); color: var(--tm-text); border-radius: 6px;'] },
  { item: '43 transparency', from: '  background: var(--tm-bg-2); }', to: ['  background: var(--tfcc-surface-bg); }'] },
  { item: '43 transparency', from: '  background: var(--tm-bg-2); padding: var(--tfcc-gap-sm) var(--tfcc-gap); }',
    to: ['  background: var(--tfcc-surface-bg); padding: var(--tfcc-gap-sm) var(--tfcc-gap); }'] },
];

// 3. Every info button is a bare icon (#43, owner): its 13d rules (new since
//    main, so not lines of the golden) now set a transparent fill and border,
//    and one new rule tints the icon on hover instead of filling a box.
const selectors = new Set([
  '#tfcc-panel button.tfcc-info:hover',
  // 4. Semi-transparent backgrounds (see the css entries above): the takeover
  //    rules that make them solid again, and the panel's backdrop blur.
  '#tfcc-panel.tfcc-takeover',
  '#tfcc-panel',
]);

module.exports = { markup, css, selectors };
