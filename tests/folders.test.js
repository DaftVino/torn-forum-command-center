'use strict';

// #45: the folder order the user controls (with a built-in Unfiled), and
// folder groups that collapse. The engine half is pure functions on the
// organizer; the runtime half drives the real handlers.

const test = require('node:test');
const assert = require('node:assert');
const { loadUserscript } = require('./load-userscript');
const { NOW, bootNarrow, seedRows, panelOf, redraw, click, lastFocus } = require('./narrow-helpers');

const { exports: api } = loadUserscript();

// Plain arrays: the runtime's own state lives in the VM's realm.
const plain = (x) => JSON.parse(JSON.stringify(x));
const ids = (o) => Array.from(o.folders, (f) => f.id);
const order = (o) => { const k = ids(o); k.splice(o.unfiledAt, 0, 'unfiled'); return k; };
// #45 (PR #46 review): a folder's key in the order and the collapsed set is
// namespaced, so no folder id, not even "unfiled", can be built-in Unfiled's.
const K = (id) => 'folder:' + id;

// -- the organizer ----------------------------------------------------------

test('a fresh organizer has Unfiled last and nothing collapsed', () => {
  const o = api.freshOrganizer(NOW);
  assert.deepStrictEqual(order(o), ['guides', 'scripts', 'faction', 'unfiled']);
  assert.deepStrictEqual(o.collapsedFolders, []);
});

test('an organizer saved before #45 loads with no damage notice, Unfiled last, nothing collapsed', () => {
  // What main wrote: no unfiledAt, no collapsedFolders.
  const old = api.normaliseOrganizer({ folders: [
    { id: 'guides', name: 'Guides', order: 0, forumIds: [61] },
    { id: 'mine', name: 'Mine', order: 1, forumIds: [] },
  ], threads: { 7: { pinned: true, folderId: 'mine' } } }, NOW);
  delete old.unfiledAt;
  delete old.collapsedFolders;
  const env = loadUserscript({ gmStore: [['tfcc:organizer', JSON.stringify(old)]] });
  env.exports.loadAll(NOW);
  const notices = env.exports.state.notices.map((n) => n.text).join(' ');
  assert.doesNotMatch(notices, /Folders and tags were damaged/);
  const o = env.exports.state.organizer;
  assert.deepStrictEqual(order(o), ['guides', 'mine', 'unfiled'], 'Unfiled defaults to last');
  assert.deepStrictEqual(plain(o.collapsedFolders), []);
  assert.strictEqual(o.threads['7'].folderId, 'mine', 'everything else kept');
  assert.strictEqual(api.isRecoveredOrganizer(JSON.parse(JSON.stringify(old)), o), false);
});

test('a present but wrong order or collapse field is still damage', () => {
  const cases = {
    'unfiledAt past the end': (o) => { o.unfiledAt = 99; },
    'unfiledAt not a number': (o) => { o.unfiledAt = 'top'; },
    'collapsedFolders naming no folder': (o) => { o.collapsedFolders = ['folder:ghost']; },
    'collapsedFolders holding a bare folder id': (o) => { o.collapsedFolders = ['guides']; },
  };
  for (const name of Object.keys(cases)) {
    const bad = api.freshOrganizer(NOW);
    cases[name](bad);
    const env = loadUserscript({ gmStore: [['tfcc:organizer', JSON.stringify(bad)]] });
    env.exports.loadAll(NOW);
    assert.match(env.exports.state.notices.map((n) => n.text).join(' '), /Folders and tags were damaged/, name);
  }
});

test('what the organizer normaliser writes with an order, it reads back unchanged', () => {
  let o = api.freshOrganizer(NOW);
  o = api.moveFolder(o, 'unfiled', -1);
  o = api.moveFolder(o, 'unfiled', -1);
  o = api.toggleFolderCollapsed(o, 'unfiled');
  o = api.toggleFolderCollapsed(o, K('faction'));
  const back = api.normaliseOrganizer(JSON.parse(JSON.stringify(o)), NOW);
  assert.deepStrictEqual(plain(back), plain(o));
  assert.deepStrictEqual(order(back), ['guides', 'unfiled', 'scripts', 'faction']);
});

test('moveFolder swaps with the neighbour, across Unfiled too, and renumbers the order', () => {
  let o = api.freshOrganizer(NOW);
  const before = JSON.stringify(o);
  o = api.moveFolder(o, K('faction'), -1);
  assert.deepStrictEqual(order(o), ['guides', 'faction', 'scripts', 'unfiled']);
  assert.deepStrictEqual(o.folders.map((f) => f.order), [0, 1, 2]);
  o = api.moveFolder(o, K('scripts'), 1);
  assert.deepStrictEqual(order(o), ['guides', 'faction', 'unfiled', 'scripts'], 'a folder moves past Unfiled');
  o = api.moveFolder(o, 'unfiled', -1);
  o = api.moveFolder(o, 'unfiled', -1);
  assert.deepStrictEqual(order(o), ['unfiled', 'guides', 'faction', 'scripts'], 'Unfiled moves');
  assert.strictEqual(JSON.stringify(api.freshOrganizer(NOW)), before, 'pure');
});

test('moveFolder at either end, or for an unknown key, returns the organizer it was given', () => {
  const o = api.freshOrganizer(NOW);
  assert.strictEqual(api.moveFolder(o, K('guides'), -1), o, 'the first cannot go up');
  assert.strictEqual(api.moveFolder(o, 'unfiled', 1), o, 'the last cannot go down');
  assert.strictEqual(api.moveFolder(o, K('nope'), 1), o);
});

test('a new folder lands above Unfiled when it is last, and at the end otherwise', () => {
  let o = api.freshOrganizer(NOW);
  o = api.upsertFolder(o, { id: 'new', name: 'New', order: o.folders.length, forumIds: [] });
  assert.deepStrictEqual(order(o), ['guides', 'scripts', 'faction', 'new', 'unfiled']);
  o = api.moveFolder(o, 'unfiled', -1);
  o = api.moveFolder(o, 'unfiled', -1);
  o = api.upsertFolder(o, { id: 'later', name: 'Later', order: o.folders.length, forumIds: [] });
  assert.deepStrictEqual(order(o), ['guides', 'scripts', 'unfiled', 'faction', 'new', 'later']);
  // Claiming a forum (an upsert of an existing folder) moves nothing.
  const claimed = api.upsertFolder(o, Object.assign({}, o.folders[0], { forumIds: [61] }));
  assert.deepStrictEqual(order(claimed), order(o));
});

test('deleting a folder keeps Unfiled among the folders that remain, and forgets its collapse', () => {
  let o = api.freshOrganizer(NOW);
  o = api.moveFolder(o, 'unfiled', -1); // guides scripts unfiled faction
  o = api.toggleFolderCollapsed(o, K('guides'));
  o = api.deleteFolder(o, 'guides');
  assert.deepStrictEqual(order(o), ['scripts', 'unfiled', 'faction']);
  assert.deepStrictEqual(o.collapsedFolders, []);
  o = api.deleteFolder(o, 'faction');
  assert.deepStrictEqual(order(o), ['scripts', 'unfiled']);
});

test('toggleFolderCollapsed toggles a folder or Unfiled, and ignores anything else', () => {
  let o = api.freshOrganizer(NOW);
  o = api.toggleFolderCollapsed(o, 'unfiled');
  o = api.toggleFolderCollapsed(o, K('scripts'));
  assert.deepStrictEqual(o.collapsedFolders, ['unfiled', K('scripts')]);
  o = api.toggleFolderCollapsed(o, 'unfiled');
  assert.deepStrictEqual(o.collapsedFolders, [K('scripts')]);
  assert.strictEqual(api.toggleFolderCollapsed(o, K('ghost')), o);
});

test('groupCatchUp follows the folder order, with Unfiled where the user put it', () => {
  let o = api.freshOrganizer(NOW);
  o = api.upsertFolder(o, { id: 'aaa', name: 'Aardvark', order: 3, forumIds: [] });
  const rows = [
    { id: '1', folderId: null }, { id: '2', folderId: 'faction' }, { id: '3', folderId: 'aaa' },
    { id: '4', folderId: 'guides' }, { id: '5', folderId: 'gone' },
  ];
  const keys = (g) => g.map((x) => x.key + ':' + x.rows.map((r) => r.id).join(','));
  assert.deepStrictEqual(keys(api.groupCatchUp(rows, o)), ['folder:guides:4', 'folder:faction:2', 'folder:aaa:3', 'unfiled:1,5'],
    'folder order, not names; an unknown folder is Unfiled');
  o = api.moveFolder(o, 'unfiled', -1);
  o = api.moveFolder(o, 'unfiled', -1);
  o = api.moveFolder(o, 'unfiled', -1);
  o = api.moveFolder(o, 'unfiled', -1);
  const g = api.groupCatchUp(rows, api.toggleFolderCollapsed(o, K('faction')));
  assert.deepStrictEqual(keys(g), ['unfiled:1,5', 'folder:guides:4', 'folder:faction:2', 'folder:aaa:3']);
  assert.deepStrictEqual(g.map((x) => x.name), ['Unfiled', 'Guides', 'Faction', 'Aardvark']);
  assert.deepStrictEqual(g.map((x) => x.collapsed), [false, false, true, false]);
});

test('an export carries the folder order and where Unfiled sits, and not what is collapsed', () => {
  const env = loadUserscript();
  const a = env.exports;
  let o = a.freshOrganizer(NOW);
  o = a.upsertFolder(o, { id: 'new', name: 'New', order: 3, forumIds: [] });
  o = a.moveFolder(o, K('new'), -1);
  o = a.moveFolder(o, K('new'), -1); // guides new scripts faction unfiled
  o = a.moveFolder(o, 'unfiled', -1);
  o = a.moveFolder(o, 'unfiled', -1); // guides new unfiled scripts faction
  o = a.toggleFolderCollapsed(o, K('guides'));
  const text = a.encodeState(o, a.freshDrafts(), env.sandbox.btoa);
  assert.doesNotMatch(a.b64DecodeUtf8(text.slice(a.EXPORT_PREFIX.length), env.sandbox.atob), /collapsed/);
  // Into a fresh device: its three starter folders take the export's order.
  const out = a.importState(a.freshOrganizer(NOW), a.freshDrafts(), text, env.sandbox.atob);
  assert.ok(out.ok, out.detail);
  assert.deepStrictEqual(order(out.organizer), ['guides', 'new', 'unfiled', 'scripts', 'faction']);
  assert.deepStrictEqual(out.organizer.collapsedFolders, []);
  // A device with a folder of its own keeps it, at the end when Unfiled is not last.
  let local = a.upsertFolder(a.freshOrganizer(NOW), { id: 'own', name: 'Own', order: 3, forumIds: [] });
  const out2 = a.importState(local, a.freshDrafts(), text, env.sandbox.atob);
  assert.deepStrictEqual(order(out2.organizer), ['guides', 'new', 'unfiled', 'scripts', 'faction', 'own']);
});

test('an export made before #45 imports with Unfiled last, the local folders above it', () => {
  const env = loadUserscript();
  const a = env.exports;
  let src = a.freshOrganizer(NOW);
  src = a.moveFolder(src, K('faction'), -1);
  const text = a.encodeState(src, a.freshDrafts(), env.sandbox.btoa);
  const payload = JSON.parse(a.b64DecodeUtf8(text.slice(a.EXPORT_PREFIX.length), env.sandbox.atob));
  delete payload.unfiledAt;
  const old = a.EXPORT_PREFIX + a.b64EncodeUtf8(JSON.stringify(payload), env.sandbox.btoa);
  const local = a.upsertFolder(a.freshOrganizer(NOW), { id: 'own', name: 'Own', order: 3, forumIds: [] });
  const out = a.importState(local, a.freshDrafts(), old, env.sandbox.atob);
  assert.deepStrictEqual(order(out.organizer), ['guides', 'faction', 'scripts', 'own', 'unfiled']);
});

// -- Settings -----------------------------------------------------------------

function settingsHtml(env) {
  env.exports.state.settings.view = 'settings';
  const html = redraw(env);
  return html.slice(html.indexOf('<h4>Folders</h4>'), html.indexOf('<h4>Backup</h4>'));
}

test('Settings lists the folders and Unfiled in order, each with up and down arrows', () => {
  const { env } = bootNarrow({ width: 900 });
  const s = settingsHtml(env);
  const names = [...s.matchAll(/<div class="tfcc-kv tfcc-forder"><label>([^<]*)<\/label>/g)].map((m) => m[1]);
  assert.deepStrictEqual(names, ['Guides', 'Scripts and tools', 'Faction', 'Unfiled']);
  for (const [key, name] of [[K('guides'), 'Guides'], [K('scripts'), 'Scripts and tools'], [K('faction'), 'Faction'], ['unfiled', 'Unfiled']]) {
    for (const dir of ['up', 'down']) {
      const re = new RegExp('<button type="button" class="tfcc-move" data-act="folder-' + dir + '" data-id="' + key
        + '" aria-label="Move ' + name + ' ' + dir + '" title="Move ' + name + ' ' + dir + '"( disabled)?>');
      assert.match(s, re, key + ' ' + dir);
    }
  }
  assert.match(s, /data-act="folder-up" data-id="folder:guides"[^>]* disabled>/, 'the first cannot go up');
  assert.match(s, /data-act="folder-down" data-id="unfiled"[^>]* disabled>/, 'the last cannot go down');
  assert.strictEqual((s.match(/ disabled>/g) || []).length, 2, 'only those two are disabled');
  // The arrows are icons, drawn as ASCII SVG.
  assert.match(s, /aria-label="Move Faction down" title="Move Faction down"><svg class="tfcc-gl"/);
});

test('Unfiled in Settings can be moved but not deleted, renamed or given a forum', () => {
  const { env } = bootNarrow({ width: 900 });
  const s = settingsHtml(env);
  const row = /<div class="tfcc-kv tfcc-forder"><label>Unfiled<\/label>[\s\S]*?<\/div>/.exec(s)[0];
  assert.doesNotMatch(row, /folder-delete|folder-forum|<select|<input/);
  assert.match(row, /data-act="folder-up" data-id="unfiled"/);
});

// #45 (owner): the note says what a folder is, how to use one and why it helps.
test('the folder note says what folders are, how to use them and why', () => {
  const { env } = bootNarrow({ width: 900 });
  const s = settingsHtml(env);
  const info = /id="tfcc-info-settings-folders" hidden>([^<]*)<\/p>/.exec(s)[1];
  assert.strictEqual(info, 'Folders organise only threads you subscribe to (and ones you file by hand); they never add '
    + 'other threads from a forum. To use them: add a folder below; optionally claim a forum, so new subscriptions '
    + 'from that forum file themselves into it; or file a thread from the folder menu on its row. Filing by hand '
    + 'always wins over a claim. The arrows set the order, Unfiled included. This helps because Catch up groups '
    + 'threads with new posts by folder, in that order, so the ones you care about most come first, and a group you '
    + 'do not need right now collapses out of the way; Threads can also be filtered to one folder. Folders stay on '
    + 'this device and travel in the export. With badges on, filing a thread in a folder of your own earns the '
    + 'First folder badge.');
});

test('the folder note says folders organise only the threads you follow', () => {
  const { env } = bootNarrow({ width: 900 });
  assert.match(settingsHtml(env), /Folders organise only threads you subscribe to \(and ones you file by hand\); they never add other threads from a forum\./);
});

test('an arrow reorders, saves, and drives the Catch up groups and every folder menu', () => {
  const { env, api: a } = bootNarrow({ width: 900 });
  seedRows(a, [{ id: 1, unread: 2 }, { id: 2, unread: 1 }, { id: 3, unread: 4 }]);
  a.state.organizer = a.setFolder(a.state.organizer, '1', 'guides');
  a.state.organizer = a.setFolder(a.state.organizer, '2', 'faction');
  a.recompute(NOW);
  a.state.settings.view = 'settings';
  redraw(env);
  click(env, '[data-act="folder-up"][data-id="folder:faction"]');
  click(env, '[data-act="folder-up"][data-id="folder:faction"]');
  click(env, '[data-act="folder-up"][data-id="unfiled"]');
  assert.deepStrictEqual(order(a.state.organizer), ['faction', 'guides', 'unfiled', 'scripts']);
  const saved = JSON.parse(env.gmStore.get('tfcc:organizer'));
  assert.deepStrictEqual(saved.folders.map((f) => f.id), ['faction', 'guides', 'scripts']);
  assert.strictEqual(saved.unfiledAt, 2);
  a.state.settings.view = 'catchup';
  const html = redraw(env);
  const heads = [...html.matchAll(/<span class="tfcc-grpname">([^<]*)<\/span>/g)].map((m) => m[1]);
  assert.deepStrictEqual(heads, ['Faction (1)', 'Guides (1)', 'Unfiled (1)']);
  // Every folder select lists the folders in that order; Unfiled, the "no
  // folder" choice, stays first in a row's menu.
  a.state.settings.view = 'threads';
  const t = redraw(env);
  const sel = /<select data-act="folder"[^>]*>([\s\S]*?)<\/select>/.exec(t)[1];
  assert.deepStrictEqual([...sel.matchAll(/<option[^>]*>([^<]*)</g)].map((m) => m[1]),
    ['Unfiled', 'Faction', 'Guides', 'Scripts and tools']);
});

test('the folder filter menu follows the order too', () => {
  const { env, api: a } = bootNarrow({ width: 900 });
  seedRows(a, [{ id: 1, unread: 2 }]);
  a.state.organizer = a.moveFolder(a.state.organizer, K('faction'), -1);
  a.state.settings.view = 'threads';
  const html = redraw(env);
  const sel = /<select data-act="folder-filter"[^>]*>([\s\S]*?)<\/select>/.exec(html)[1];
  const names = [...sel.matchAll(/<option[^>]*>([^<]*)</g)].map((m) => m[1]);
  assert.deepStrictEqual(names.slice(-3), ['Guides', 'Faction', 'Scripts and tools']);
});

test('focus stays on the arrow pressed, or moves to the other arrow at an end', () => {
  const { env, api: a } = bootNarrow({ width: 900 });
  a.state.settings.view = 'settings';
  redraw(env);
  click(env, '[data-act="folder-down"][data-id="folder:scripts"]');
  assert.deepStrictEqual([lastFocus(env)['data-act'], lastFocus(env)['data-id']], ['folder-down', 'folder:scripts']);
  click(env, '[data-act="folder-up"][data-id="folder:faction"]');
  click(env, '[data-act="folder-up"][data-id="folder:faction"]');
  assert.deepStrictEqual([lastFocus(env)['data-act'], lastFocus(env)['data-id']], ['folder-down', 'folder:faction'],
    'at the top the up arrow is disabled, so focus goes to down');
});

// -- collapsible groups -------------------------------------------------------

function catchUpEnv(width) {
  const { env, api: a } = bootNarrow({ width });
  seedRows(a, [{ id: 1, unread: 2 }, { id: 2, unread: 1 }, { id: 3, unread: 4 }]);
  a.state.organizer = a.setFolder(a.state.organizer, '1', 'guides');
  a.recompute(NOW);
  a.state.settings.view = 'catchup';
  return { env, a };
}

for (const [label, width] of [['wide', 900], ['narrow', 343]]) {
  test('a Catch up group heading is a toggle with its count, named and wired (' + label + ')', () => {
    const { env } = catchUpEnv(width);
    const html = redraw(env);
    const m = /<h4 class="tfcc-grphead"><button type="button" class="tfcc-grp" data-act="group-toggle" data-id="folder:guides" aria-expanded="true" aria-controls="(tfcc-grp-folder_003aguides)" title="Collapse Guides"><svg class="tfcc-gl"[^>]*><path d="([^"]*)"\/><\/svg><span class="tfcc-grpname">Guides \(1\)<\/span><\/button><\/h4>/.exec(html);
    assert.ok(m, 'the Guides heading');
    assert.ok(html.includes('<div class="tfcc-rows" id="' + m[1] + '">'), 'aria-controls names the rows');
    assert.match(html, /data-act="group-toggle" data-id="unfiled" aria-expanded="true"[^>]*title="Collapse Unfiled">[\s\S]*?Unfiled \(2\)/);
  });

  test('a collapsed group renders its heading only, and stays collapsed on this device (' + label + ')', () => {
    const { env, a } = catchUpEnv(width);
    redraw(env);
    click(env, '[data-act="group-toggle"][data-id="unfiled"]');
    const html = panelOf(env).innerHTML;
    assert.match(html, /data-id="unfiled" aria-expanded="false" aria-controls="tfcc-grp-unfiled" title="Expand Unfiled"><svg class="tfcc-gl"[^>]*><path d="M9 6l6 6-6 6"\/>/);
    assert.match(html, /Unfiled \(2\)<\/span><\/button><\/h4><div class="tfcc-rows" id="tfcc-grp-unfiled" hidden><\/div>/);
    assert.ok(!/data-id="2"|data-id="3"/.test(html.replace(/data-act="group-toggle"[^>]*>/g, '')), 'its rows are not rendered');
    assert.ok(/<div class="tfcc-row[^"]*" data-id="1"/.test(html), 'the other group still shows');
    assert.deepStrictEqual(JSON.parse(env.gmStore.get('tfcc:organizer')).collapsedFolders, ['unfiled']);
    // A reload remembers it.
    const again = loadUserscript({ gmStore: [['tfcc:organizer', env.gmStore.get('tfcc:organizer')]] });
    again.exports.loadAll(NOW);
    assert.deepStrictEqual(plain(again.exports.state.organizer.collapsedFolders), ['unfiled']);
    assert.strictEqual(a.state.organizer.collapsedFolders.length, 1);
    click(env, '[data-act="group-toggle"][data-id="unfiled"]');
    assert.match(panelOf(env).innerHTML, /<div class="tfcc-row[^"]*" data-id="2"/, 'expanding shows the rows again');
  });

  test('focus stays on the group toggle after it collapses or expands (' + label + ')', () => {
    const { env } = catchUpEnv(width);
    redraw(env);
    click(env, '[data-act="group-toggle"][data-id="folder:guides"]');
    assert.deepStrictEqual([lastFocus(env)['data-act'], lastFocus(env)['data-id']], ['group-toggle', 'folder:guides']);
    click(env, '[data-act="group-toggle"][data-id="folder:guides"]');
    assert.deepStrictEqual([lastFocus(env)['data-act'], lastFocus(env)['data-id']], ['group-toggle', 'folder:guides']);
  });
}

test('Mark all read still covers the rows of a collapsed group', () => {
  const { env, a } = catchUpEnv(900);
  redraw(env);
  click(env, '[data-act="group-toggle"][data-id="unfiled"]');
  click(env, '[data-act="markall"]');
  for (const id of ['1', '2', '3']) assert.strictEqual(a.state.organizer.threads[id].lastSeenTotal, 10, id);
});

test('collapsing hides rows but does not change the rows cap or its count', () => {
  const { env, a } = catchUpEnv(900);
  a.state.settings.rowsShown = 3;
  const before = a.buildPanelModel(NOW).capped.catchup;
  a.state.organizer = a.toggleFolderCollapsed(a.state.organizer, 'unfiled');
  const after = a.buildPanelModel(NOW).capped.catchup;
  assert.deepStrictEqual(after.rows.map((r) => r.id), before.rows.map((r) => r.id));
  assert.strictEqual(after.total, before.total);
  assert.deepStrictEqual(a.buildPanelModel(NOW).renderedIds, ['1'], 'only the open group renders rows');
  assert.ok(redraw(env).includes('Unfiled (2)'), 'the heading still counts the rows it hides');
});

test('collapsing the group of an open row closes its drawer', () => {
  const { env, a } = catchUpEnv(343);
  a.state.openRowId = '2';
  assert.strictEqual(a.buildPanelModel(NOW).openRowId, '2');
  redraw(env);
  click(env, '[data-act="group-toggle"][data-id="unfiled"]');
  assert.strictEqual(a.state.openRowId, null);
  a.state.organizer = a.toggleFolderCollapsed(a.state.organizer, 'unfiled');
  assert.strictEqual(a.buildPanelModel(NOW).openRowId, null, 'and it does not reopen by itself');
});

test('a narrow group toggle is a 44px target; a wide one is at least 24px', () => {
  const css = api.panelStyleText();
  assert.match(css, /#tfcc-panel\.tfcc-narrow button\.tfcc-grp \{[^}]*min-height: 44px;/);
  assert.match(css, /#tfcc-panel button\.tfcc-grp \{[^}]*min-height: 24px;/);
});

// -- PR #46 review: a real folder whose id is "unfiled" ------------------------
// Before #45, adding a folder named "Unfiled" made the id "unfiled". It must
// stay a folder of its own, apart from built-in Unfiled, everywhere.

function withRealUnfiled() {
  // What main wrote: a real "unfiled" folder holding thread 7, thread 8 in no
  // folder, and no #45 fields at all.
  const o = api.normaliseOrganizer({ folders: [
    { id: 'guides', name: 'Guides', order: 0, forumIds: [] },
    { id: 'unfiled', name: 'Unfiled', order: 1, forumIds: [] },
  ], threads: { 7: { folderId: 'unfiled', pinned: true }, 8: { pinned: true } } }, NOW);
  delete o.unfiledAt;
  delete o.collapsedFolders;
  return o;
}

test('an old organizer with a real folder "unfiled" loads undamaged, as two separate entries', () => {
  const env = loadUserscript({ gmStore: [['tfcc:organizer', JSON.stringify(withRealUnfiled())]] });
  env.exports.loadAll(NOW);
  assert.doesNotMatch(env.exports.state.notices.map((n) => n.text).join(' '), /Folders and tags were damaged/);
  const o = env.exports.state.organizer;
  assert.deepStrictEqual(plain(api.folderOrderKeys(o)), ['folder:guides', 'folder:unfiled', 'unfiled']);
  assert.strictEqual(o.threads['7'].folderId, 'unfiled', 'no migration: the thread keeps its folder');
});

test('a real folder "unfiled" and built-in Unfiled group, reorder and collapse apart', () => {
  let o = api.normaliseOrganizer(withRealUnfiled(), NOW);
  const rows = [{ id: '7', folderId: 'unfiled' }, { id: '8', folderId: null }];
  const keys = (g) => g.map((x) => x.key + ':' + x.name + ':' + x.rows.map((r) => r.id).join(','));
  assert.deepStrictEqual(keys(api.groupCatchUp(rows, o)), ['folder:unfiled:Unfiled:7', 'unfiled:Unfiled:8']);
  o = api.moveFolder(o, 'unfiled', -1);
  assert.deepStrictEqual(plain(api.folderOrderKeys(o)), ['folder:guides', 'unfiled', 'folder:unfiled']);
  assert.deepStrictEqual(plain(ids(o)), ['guides', 'unfiled'], 'moving built-in Unfiled drops no folder');
  o = api.moveFolder(o, K('unfiled'), -1);
  o = api.moveFolder(o, K('unfiled'), -1);
  assert.deepStrictEqual(plain(api.folderOrderKeys(o)), ['folder:unfiled', 'folder:guides', 'unfiled']);
  o = api.toggleFolderCollapsed(o, K('unfiled'));
  const g = api.groupCatchUp(rows, o);
  assert.deepStrictEqual(g.map((x) => x.collapsed), [true, false], 'only the real folder is collapsed');
  o = api.toggleFolderCollapsed(o, 'unfiled');
  assert.deepStrictEqual(plain(o.collapsedFolders), ['folder:unfiled', 'unfiled']);
  o = api.toggleFolderCollapsed(o, K('unfiled'));
  assert.deepStrictEqual(plain(o.collapsedFolders), ['unfiled']);
  // Deleting the real folder leaves built-in Unfiled alone.
  const d = api.deleteFolder(api.toggleFolderCollapsed(o, K('unfiled')), 'unfiled');
  assert.deepStrictEqual(plain(api.folderOrderKeys(d)), ['folder:guides', 'unfiled']);
  assert.deepStrictEqual(plain(d.collapsedFolders), ['unfiled']);
});

test('a real folder "unfiled" renders apart from built-in Unfiled in Settings and Catch up', () => {
  const { env, api: a } = bootNarrow({ width: 900 });
  seedRows(a, [{ id: 7, unread: 2 }, { id: 8, unread: 1 }]);
  a.state.organizer = a.upsertFolder(a.state.organizer, { id: 'unfiled', name: 'Unfiled', order: 3, forumIds: [] });
  a.state.organizer = a.setFolder(a.state.organizer, '7', 'unfiled');
  a.recompute(NOW);
  const s = settingsHtml(env);
  assert.match(s, /data-act="folder-delete" data-id="unfiled"/, 'the real folder can be deleted');
  assert.strictEqual((s.match(/data-act="folder-up" data-id="unfiled"/g) || []).length, 1, 'one built-in Unfiled');
  assert.strictEqual((s.match(/data-act="folder-up" data-id="folder:unfiled"/g) || []).length, 1, 'one real folder');
  a.state.settings.view = 'catchup';
  redraw(env);
  click(env, '[data-act="group-toggle"][data-id="folder:unfiled"]');
  const html = panelOf(env).innerHTML;
  assert.match(html, /data-id="folder:unfiled" aria-expanded="false"/);
  assert.match(html, /data-id="unfiled" aria-expanded="true"/);
  assert.match(html, /<div class="tfcc-row[^"]*" data-id="8"/, 'built-in Unfiled still shows its row');
  assert.ok(!/<div class="tfcc-row[^"]*" data-id="7"/.test(html), 'the collapsed real folder hides its row');
  const domIds = [...html.matchAll(/ id="(tfcc-grp-[^"]*)"/g)].map((m) => m[1]);
  assert.strictEqual(new Set(domIds).size, domIds.length, 'distinct group ids');
});

test('an old export with a real folder "unfiled" round-trips with its threads and its place', () => {
  const env = loadUserscript();
  const a = env.exports;
  const old = a.normaliseOrganizer(withRealUnfiled(), NOW);
  const text = a.encodeState(old, a.freshDrafts(), env.sandbox.btoa);
  const payload = JSON.parse(a.b64DecodeUtf8(text.slice(a.EXPORT_PREFIX.length), env.sandbox.atob));
  delete payload.unfiledAt; // as main exported it
  const oldText = a.EXPORT_PREFIX + a.b64EncodeUtf8(JSON.stringify(payload), env.sandbox.btoa);
  const out = a.importState(a.freshOrganizer(NOW), a.freshDrafts(), oldText, env.sandbox.atob);
  assert.ok(out.ok, out.detail);
  assert.deepStrictEqual(plain(a.folderOrderKeys(out.organizer)),
    ['folder:guides', 'folder:unfiled', 'folder:scripts', 'folder:faction', 'unfiled']);
  assert.strictEqual(out.organizer.threads['7'].folderId, 'unfiled');
  // And a #45 export of a reordered workspace comes back the same.
  let moved = a.moveFolder(out.organizer, 'unfiled', -1);
  moved = a.moveFolder(moved, 'unfiled', -1);
  const back = a.importState(a.freshOrganizer(NOW), a.freshDrafts(), a.encodeState(moved, a.freshDrafts(), env.sandbox.btoa),
    env.sandbox.atob);
  assert.deepStrictEqual(plain(a.folderOrderKeys(back.organizer)), plain(a.folderOrderKeys(moved)));
});

// PR #46 review: a group's DOM id is a collision-free encoding of its key.
test('two folder ids that differ only in punctuation get different group ids', () => {
  const { env, api: a } = bootNarrow({ width: 900 });
  seedRows(a, [{ id: 1, unread: 2 }, { id: 2, unread: 1 }]);
  a.state.organizer = a.upsertFolder(a.state.organizer, { id: 'ops/a', name: 'Ops slash', order: 3, forumIds: [] });
  a.state.organizer = a.upsertFolder(a.state.organizer, { id: 'ops?a', name: 'Ops query', order: 4, forumIds: [] });
  a.state.organizer = a.setFolder(a.state.organizer, '1', 'ops/a');
  a.state.organizer = a.setFolder(a.state.organizer, '2', 'ops?a');
  a.recompute(NOW);
  a.state.settings.view = 'catchup';
  const html = redraw(env);
  const ctl = [...html.matchAll(/data-act="group-toggle" data-id="([^"]*)"[^>]*aria-controls="([^"]*)"/g)];
  const targets = ctl.map((m) => m[2]);
  assert.strictEqual(targets.length, 2);
  assert.notStrictEqual(targets[0], targets[1]);
  for (const t of targets) {
    assert.match(t, /^tfcc-grp-[A-Za-z0-9_-]+$/, 'id-safe');
    assert.strictEqual((html.match(new RegExp(' id="' + t + '"', 'g')) || []).length, 1, 'controls exactly one element');
  }
});
