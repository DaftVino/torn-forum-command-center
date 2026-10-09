'use strict';

// #47: the owner-approved wide changes, applied by tests/wide-parity.test.js
// after the 13d, #41, #43 and #45 lists. The golden is never regenerated;
// every change a wide panel sees is named here.
//
// Only item 2 (several forums per folder) changes wide output. Item 1, the
// tighter narrow Settings, hangs entirely off .tfcc-narrow and the narrow-only
// .tfcc-set wrapper and .tfcc-kvc class, so it adds nothing to these lists.
//
// inserted: the complete new stylesheet lines a wide panel may now see,
// exactly (the PR #46 review's multiset pattern).
//
// literals: each entry replaces `from` (required exactly once in the view
// after every earlier list) with `to`, in the named view.

const inserted = [
  // The claimed-forum chips and their remove buttons. The wide seed claims
  // nothing, so none renders there; the rules are still in the stylesheet.
  '#tfcc-panel .tfcc-claims { display: inline-flex; flex-wrap: wrap; gap: var(--tfcc-gap-xs); }',
  '#tfcc-panel .tfcc-claim { display: inline-flex; align-items: center; gap: 2px; padding-left: 8px;',
  '  border: 1px solid var(--tm-border); border-radius: 12px; color: var(--tm-text); }',
  '#tfcc-panel button.tfcc-unclaim { display: inline-flex; align-items: center; justify-content: center;',
  '  min-width: 24px; min-height: 24px; padding: 0; border: 0; border-radius: 12px; background: transparent;',
  '  color: inherit; }',
];

// The seed's three starter folders.
const FOLDERS = [['guides', 'Guides'], ['scripts', 'Scripts and tools'], ['faction', 'Faction']];

const literals = [
  // 1. The folder note (#45's owner rewrite): "claim a forum" becomes one or
  //    more, with the one-claimant rule and what removing a claim does. The
  //    rest of the text is #45's, unchanged.
  {
    item: '47 folder note', view: 'settings',
    from: 'add a folder below; optionally claim a forum, so new subscriptions from that forum file themselves into '
      + 'it; or file a thread from the folder menu on its row.',
    to: 'add a folder below; optionally claim one or more forums, so new subscriptions from them file themselves '
      + 'into it; a forum belongs to one folder at a time, and removing a claim leaves the threads already filed '
      + 'where they are; or file a thread from the folder menu on its row.',
  },
  // 2. Each folder's claim menu gains a name. It only adds a claim now, so
  //    nothing in it is ever selected; the seed claims nothing, so its options
  //    are main's.
  ...FOLDERS.map(([id, name]) => ({
    item: '47 claim menu name', view: 'settings',
    from: '<select data-act="folder-forum" data-id="' + id + '">',
    to: '<select data-act="folder-forum" data-id="' + id + '" aria-label="Claim a forum for ' + name + '">',
  })),
];

module.exports = { inserted, literals };
