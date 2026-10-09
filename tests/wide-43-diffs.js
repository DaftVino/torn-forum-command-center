'use strict';

// #43: the owner-approved wide changes, applied by tests/wide-parity.test.js
// after the 13d and #41 lists. The golden is never regenerated; every change
// a wide panel sees is named here.
//
// markup: each entry rewrites a whole view. `count(html)` says how many
// places it must change in that view, so a widened or stale entry fails
// rather than hiding a change.
//
// css: each entry replaces a line of main's stylesheet (`from`, required
// exactly `times` times in the golden, once unless stated) with the lines in
// `to` (none removes it).
//
// selectors: the new rules a wide panel may now see.

// 1. Every info button carries a hover note equal to its accessible name, so
//    no icon-only button in the panel is without a title (#43 item 2). The
//    wide panel's only icon-only buttons are the info buttons.
const INFO_NAME = /( aria-controls="tfcc-info-[a-z0-9-]+" aria-label="([^"]*)")>/g;

const markup = [
  {
    item: '43 info button hover note',
    apply: (html) => html.replace(INFO_NAME, (m, head, name) => head + ' title="' + name + '">'),
    count: (html) => (html.match(/data-act="info"/g) || []).length,
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
  { item: MINE, from: '  color: var(--tfcc-mine-text); border-color: var(--tfcc-mine-border); font-weight: bold; }', to: [] },
  { item: MINE, from: '#tfcc-panel button.tfcc-nav-mine:hover { background: var(--tfcc-mine-hover);', to: [] },
  { item: MINE, from: '  color: var(--tfcc-mine-text); }', to: [] },
  { item: MINE, from: '#tfcc-panel button.tfcc-nav-mine[aria-pressed="true"] { background: var(--tfcc-mine-pressed);', to: [] },
  { item: MINE, from: '  color: var(--tfcc-mine-text); box-shadow: inset 0 -3px 0 var(--tfcc-mine-text); }', to: [] },
];

// 3. Every info button is a bare icon (#43, owner): its 13d rules (new since
//    main, so not lines of the golden) now set a transparent fill and border,
//    and one new rule tints the icon on hover instead of filling a box.
const selectors = new Set([
  '#tfcc-panel button.tfcc-info:hover',
]);

module.exports = { markup, css, selectors };
