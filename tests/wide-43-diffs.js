'use strict';

// #43: the owner-approved wide changes, applied by tests/wide-parity.test.js
// after the 13d and #41 lists. The golden is never regenerated; every change
// a wide panel sees is named here.
//
// markup: each entry rewrites a whole view. `count(html)` says how many
// places it must change in that view, so a widened or stale entry fails
// rather than hiding a change.
//
// css: each entry replaces one line of main's stylesheet (`from`, required
// exactly once in the golden) with the lines in `to` (none removes it).
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

const css = [];

const selectors = new Set([]);

module.exports = { markup, css, selectors };
