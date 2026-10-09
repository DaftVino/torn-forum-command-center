'use strict';

// #45: the owner-approved wide changes, applied by tests/wide-parity.test.js
// after the 13d, #41 and #43 lists. The golden is never regenerated; every
// change a wide panel sees is named here.
//
// css: each entry replaces a line of main's stylesheet (`from`, required
// exactly `times` times in the golden, once unless stated) with the lines in
// `to` (none removes it).
//
// selectors: the rules a wide panel may now see that are not lines of main's
// stylesheet (an edited rule counts as new).
//
// literals: each entry replaces `from` (required exactly once in the view
// after every earlier list) with `to`, in the named view.

// 1. The priority number's own colour (#45 item 1, owner): the logo's muted
//    blue tuned per theme (--tfcc-prio), in place of the meta grey. The two
//    token lines are insertions into the theme blocks; this is the one edit.
const PRIO = '45 priority colour';

const css = [
  { item: PRIO, from: '#tfcc-panel .tfcc-prio { flex: none; color: var(--tm-meta); font-size: var(--tfcc-text-sm);',
    to: ['#tfcc-panel .tfcc-prio { flex: none; color: var(--tfcc-prio); font-size: var(--tfcc-text-sm);'] },
];

const selectors = new Set([
  '#tfcc-panel .tfcc-prio',
]);

const literals = [];

module.exports = { css, selectors, literals };
