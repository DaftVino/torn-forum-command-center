'use strict';

// #53: the owner-approved wide changes, applied by tests/wide-parity.test.js
// after the #47 list. The golden is never regenerated; every change a wide
// panel sees is named here.
//
// The narrow reactions pill hangs entirely off .tfcc-narrow, so it adds
// nothing to these lists. The logo's light-theme color does: the logo rule
// takes its color from a per-theme token instead of a fixed hex. The markup
// (the SVG's own fill="#5C768F") is unchanged.
//
// css: each entry replaces a line of main's stylesheet (`from`, required
// exactly once) with the lines in `to`.
//
// inserted: the complete new stylesheet lines a wide panel may now see,
// exactly (the PR #46 review's multiset pattern).

const css = [
  { item: '53 logo token', from: '  color: #5c768f; }', to: ['  color: var(--tfcc-logo); }'] },
];

const inserted = [
  // The token, once in the dark base block and once in the light block.
  '  --tfcc-logo: #5c768f;',
  '  --tfcc-logo: #2e4a66;',
];

module.exports = { css, inserted };
