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
// inserted: the complete new lines a wide panel may now see (PR #46
// review: exact lines, not selectors), each once unless listed twice.

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
      return titled(after).filter((k) => was.indexOf(k) === -1);
    },
  },
];

// 2. My posts takes every nav button's colors (#43 item 4, owner: its
//    light-grey fill looked selected). Its rule keeps only its placement;
//    its hover and pressed rules and its five color tokens go.
const MINE = '43 My posts color';

const css = [
  { item: MINE, from: '  --tfcc-mine-bg: #d9d9d9; --tfcc-mine-hover: #c8c8c8; --tfcc-mine-pressed: #b0b0b0;', times: 2, to: [] },
  { item: MINE, from: '  --tfcc-mine-text: #141414; --tfcc-mine-border: #d9d9d9;', to: [] },
  { item: MINE, from: '  --tfcc-mine-text: #141414; --tfcc-mine-border: #5c5c5c;', to: [] },
  { item: MINE, from: '#tfcc-panel button.tfcc-nav-mine { margin-left: auto; background: var(--tfcc-mine-bg);',
    to: ['#tfcc-panel button.tfcc-nav-mine { margin-left: auto; }'] },
  // Its font-weight: bold goes with it (PR #44 review): the owner asked for
  // its colors to match, and matching means its weight is the other nav
  // buttons' too, normal on wide and the narrow grid's bold on narrow, where
  // every cell already shares one rule. tests/style.test.js and the contrast
  // audit check the weights are equal.
  { item: MINE, from: '  color: var(--tfcc-mine-text); border-color: var(--tfcc-mine-border); font-weight: bold; }', to: [] },
  { item: MINE, from: '#tfcc-panel button.tfcc-nav-mine:hover { background: var(--tfcc-mine-hover);', to: [] },
  { item: MINE, from: '  color: var(--tfcc-mine-text); }', to: [] },
  { item: MINE, from: '#tfcc-panel button.tfcc-nav-mine[aria-pressed="true"] { background: var(--tfcc-mine-pressed);', to: [] },
  { item: MINE, from: '  color: var(--tfcc-mine-text); box-shadow: inset 0 -3px 0 var(--tfcc-mine-text); }', to: [] },
  // 4. See-through backgrounds (#43 item 5, the owner's decision) replace no
  //    line of main's: main's solid fills stay, and the translucent base
  //    layers are new rules behind the setting's panel class (below), with
  //    their two tokens inserted into the theme blocks.
];

// 3. Every info button is a bare icon (#43, owner): its 13d rules (new since
//    main, so not lines of the golden, and listed with 13d in
//    tests/wide-parity.test.js) now set a transparent fill and border, and one
//    new rule tints the icon on hover instead of filling a box.
const inserted = [
  '#tfcc-panel button.tfcc-info:hover { background: transparent; color: var(--tm-accent-text); }',
  // 4. See-through backgrounds: the two base-layer tokens in each theme
  //    block, and rules that all hang off the setting's class, which the
  //    panel carries only while the setting is on, so a wide panel with it
  //    off sees none of them (the golden is compared that way).
  '  --tfcc-base-bg: rgba(31, 31, 31, 0.5); --tfcc-row-bg: rgba(38, 38, 38, 0.75);',
  '  --tfcc-base-bg: rgba(242, 242, 242, 0.5); --tfcc-row-bg: rgba(232, 232, 232, 0.75);',
  '#tfcc-panel.tfcc-seethrough { background: var(--tfcc-base-bg);',
  '  -webkit-backdrop-filter: blur(6px); backdrop-filter: blur(6px); }',
  '#tfcc-panel.tfcc-seethrough .tfcc-row { background: var(--tfcc-row-bg); }',
  '#tfcc-panel.tfcc-seethrough.tfcc-takeover { background: var(--tm-bg);',
  '  -webkit-backdrop-filter: none; backdrop-filter: none; }',
  '#tfcc-panel.tfcc-seethrough.tfcc-takeover .tfcc-row { background: var(--tm-bg-2); }',
];

// 5. The Settings checkbox for see-through (#43, owner), with the setting off
//    (the state the golden is compared in): one literal insertion after the
//    clip setting's explanation. What turning it on adds is asserted by its
//    own test in tests/wide-parity.test.js.
const CLIP_END = 'on a wider screen, hover over it. Turn this off to let them wrap.</p>';
const literals = [
  {
    item: '43 see-through setting', view: 'settings',
    from: CLIP_END,
    to: CLIP_END
      + '<div class="tfcc-kv"><label for="tfcc-seethrough">See-through background</label>'
      + '<input id="tfcc-seethrough" type="checkbox" data-act="see-through">'
      + '<button type="button" class="tfcc-info" data-act="info" data-info="settings-seethrough" aria-expanded="false"'
      + ' aria-controls="tfcc-info-settings-seethrough" aria-label="About see-through" title="About see-through">'
      + '<svg class="tfcc-gl" viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false">'
      + '<path d="M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18zM12 11v6M12 7.5v.5"/></svg></button></div>'
      + '<p class="tfcc-note tfcc-infotext" id="tfcc-info-settings-seethrough" hidden>The panel shows Torn\'s page '
      + 'through it. Text can be harder to read over a busy page, or one much lighter or darker than the panel. '
      + 'Turn this off to make the panel solid.</p>',
  },
];

module.exports = { markup, css, inserted, literals };
