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
  // 2. The Catch up group heading toggle (#45 item 2): the heading's own
  //    margin, the rows under it, the toggle that looks like the heading.
  '#tfcc-panel .tfcc-section h4.tfcc-grphead',
  '#tfcc-panel .tfcc-grphead + .tfcc-rows',
  '#tfcc-panel button.tfcc-grp',
  '#tfcc-panel button.tfcc-grp:hover .tfcc-grpname',
  // 3. The Settings folder order arrows (#45 item 2).
  '#tfcc-panel button.tfcc-move',
  '#tfcc-panel button.tfcc-move:disabled',
]);

// The glyphs, exactly as glyph() draws them.
const glyph = (d) => '<svg class="tfcc-gl" viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false">'
  + '<path d="' + d + '"/></svg>';
const UP = 'M6 15l6-6 6 6';
const DOWN = 'M6 9l6 6 6-6';

// A Settings order arrow: named, titled, disabled at the end it cannot pass.
// Its data-id is the order key: "folder:" and the folder id, or "unfiled"
// for built-in Unfiled (PR #46 review: no folder id can collide with it).
const move = (id, name, dir, disabled) => '<button type="button" class="tfcc-move" data-act="folder-' + dir + '" data-id="'
  + id + '" aria-label="Move ' + name + ' ' + dir + '" title="Move ' + name + ' ' + dir + '"' + (disabled ? ' disabled' : '')
  + '>' + glyph(dir === 'up' ? UP : DOWN) + '</button>';

// The seed's three starter folders, in the default order, Unfiled last.
const FOLDERS = [['guides', 'Guides'], ['scripts', 'Scripts and tools'], ['faction', 'Faction']];

const FOLDER_NOTE = 'Filing a thread by hand always wins over a rule.</p>';

const literals = [
  // 2. Catch up: the group heading becomes a toggle (button, aria-expanded,
  //    aria-controls, a chevron, a title), keeping "Unfiled (3)"; its rows
  //    get the id the toggle controls. The seed's only group is Unfiled.
  {
    item: '45 collapsible group', view: 'catchup',
    from: '<div class="tfcc-section"><h4>Unfiled (3)</h4><div class="tfcc-rows">',
    to: '<div class="tfcc-section"><h4 class="tfcc-grphead"><button type="button" class="tfcc-grp" data-act="group-toggle"'
      + ' data-id="unfiled" aria-expanded="true" aria-controls="tfcc-grp-unfiled" title="Collapse Unfiled">' + glyph(DOWN)
      + '<span class="tfcc-grpname">Unfiled (3)</span></button></h4><div class="tfcc-rows" id="tfcc-grp-unfiled">',
  },
  // 3. Settings: the folder note gains the owner's sentence and the arrows'
  //    purpose.
  {
    item: '45 folder note', view: 'settings',
    from: FOLDER_NOTE,
    to: 'Filing a thread by hand always wins over a rule. Folders organise only threads you subscribe to (and ones you '
      + 'file by hand); they never add other threads from a forum. The arrows set the order of the groups in Catch up '
      + 'and of the folder menus.</p>',
  },
  // 4. Settings: each folder row gains its up and down arrows after its name
  //    (the first up is disabled; Unfiled is below the last folder, so its
  //    down is live) ...
  ...FOLDERS.map(([id, name], i) => ({
    item: '45 folder arrows', view: 'settings',
    from: '<div class="tfcc-kv"><label>' + name + '</label><select data-act="folder-forum" data-id="' + id + '">',
    to: '<div class="tfcc-kv tfcc-forder"><label>' + name + '</label>' + move('folder:' + id, name, 'up', i === 0)
      + move('folder:' + id, name, 'down', false) + '<select data-act="folder-forum" data-id="' + id + '">',
  })),
  // ... and Unfiled joins the list, last: arrows (down disabled), no claim,
  //    no rename, no delete.
  {
    item: '45 Unfiled in the order', view: 'settings',
    from: '<div class="tfcc-kv"><label for="tfcc-newfolder">',
    to: '<div class="tfcc-kv tfcc-forder"><label>Unfiled</label>' + move('unfiled', 'Unfiled', 'up', false)
      + move('unfiled', 'Unfiled', 'down', true) + '<span class="tfcc-note">Threads in no folder</span></div>'
      + '<div class="tfcc-kv"><label for="tfcc-newfolder">',
  },
];

module.exports = { css, selectors, literals };
