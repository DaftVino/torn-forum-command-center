'use strict';

// #47: a folder claims any number of forums. A forum is claimed by at most
// one folder: the Settings "Claim a forum..." menu lists only the forums no
// folder claims yet. Removing a claim moves no thread already filed; only
// future auto-filing changes. A hand filing always wins over a claim.

const test = require('node:test');
const assert = require('node:assert');
const { loadUserscript } = require('./load-userscript');
const { NOW, bootNarrow, redraw, panelOf, click, lastFocus } = require('./narrow-helpers');

const { exports: api } = loadUserscript();
const plain = (x) => JSON.parse(JSON.stringify(x));
const claims = (o, id) => plain(o.folders.find((f) => f.id === id).forumIds);

const CATS = [
  { id: 4, title: 'Suggestions', acronym: 'SU' },
  { id: 61, title: 'Tutorials and Guides', acronym: 'TG' },
  { id: 63, title: 'API Development', acronym: 'AD' },
  { id: 67, title: 'Tools and Userscripts', acronym: 'TU' },
];

// -- the engine ---------------------------------------------------------------

test('claimForum adds a claim to a folder, keeping the ones it has', () => {
  let o = api.freshOrganizer(NOW);
  o = api.claimForum(o, 'guides', 61);
  o = api.claimForum(o, 'guides', 67);
  assert.deepStrictEqual(claims(o, 'guides'), [61, 67]);
  assert.strictEqual(api.folderFor(o, 67).id, 'guides');
});

test('claimForum is pure: the organizer passed in is not changed', () => {
  const o = api.freshOrganizer(NOW);
  const before = JSON.stringify(o);
  const next = api.claimForum(o, 'guides', 61);
  assert.strictEqual(JSON.stringify(o), before);
  assert.notStrictEqual(next, o);
});

test('a forum is claimed by one folder at most: a second claim is refused, unchanged', () => {
  let o = api.claimForum(api.freshOrganizer(NOW), 'guides', 61);
  const again = api.claimForum(o, 'scripts', 61);
  assert.strictEqual(again, o, 'the same organizer back, so the caller can tell');
  assert.deepStrictEqual(claims(o, 'scripts'), []);
  assert.strictEqual(api.claimForum(o, 'guides', 61), o, 'a claim it already has');
  assert.strictEqual(api.claimForum(o, 'ghost', 63), o, 'no such folder');
  assert.strictEqual(api.claimForum(o, 'guides', 0), o, 'no such forum');
  assert.strictEqual(api.claimForum(o, 'guides', 'x'), o, 'not a forum id');
});

test('unclaimForum removes one claim and leaves the rest', () => {
  let o = api.freshOrganizer(NOW);
  o = api.claimForum(o, 'guides', 61);
  o = api.claimForum(o, 'guides', 67);
  const before = JSON.stringify(o);
  const next = api.unclaimForum(o, 'guides', 61);
  assert.strictEqual(JSON.stringify(o), before, 'pure');
  assert.deepStrictEqual(claims(next, 'guides'), [67]);
  assert.strictEqual(api.folderFor(next, 61), null);
  assert.strictEqual(api.unclaimForum(next, 'guides', 61), next, 'a claim it does not have');
});

test('removing a claim never moves a thread already filed; only future auto-filing changes', () => {
  let o = api.claimForum(api.freshOrganizer(NOW), 'guides', 61);
  o = api.applyAutoAssign(o, [{ id: '1', forumId: 61, title: 'One', postsTotal: 3 }], NOW);
  assert.strictEqual(o.threads['1'].folderId, 'guides');
  o = api.unclaimForum(o, 'guides', 61);
  assert.strictEqual(o.threads['1'].folderId, 'guides', 'the filed thread stays');
  o = api.applyAutoAssign(o, [{ id: '1', forumId: 61, title: 'One', postsTotal: 3 },
    { id: '2', forumId: 61, title: 'Two', postsTotal: 1 }], NOW);
  assert.strictEqual(o.threads['1'].folderId, 'guides');
  assert.strictEqual(o.threads['2'].folderId, null, 'a new subscription is no longer filed');
});

test('every claimed forum of a folder auto-files, and a hand filing still wins', () => {
  let o = api.freshOrganizer(NOW);
  o = api.claimForum(o, 'scripts', 61);
  o = api.claimForum(o, 'scripts', 67);
  o = api.setFolder(o, '3', 'faction');
  o = api.applyAutoAssign(o, [
    { id: '1', forumId: 61, title: 'A', postsTotal: 1 },
    { id: '2', forumId: 67, title: 'B', postsTotal: 1 },
    { id: '3', forumId: 67, title: 'C', postsTotal: 1 },
  ], NOW);
  assert.strictEqual(o.threads['1'].folderId, 'scripts');
  assert.strictEqual(o.threads['2'].folderId, 'scripts');
  assert.strictEqual(o.threads['3'].folderId, 'faction', 'filed by hand, never moved by a claim');
});

test('an export and import round trip keeps every claim, into a fresh device too', () => {
  const env = loadUserscript();
  const a = env.exports;
  let o = a.freshOrganizer(NOW);
  o = a.claimForum(o, 'guides', 61);
  o = a.claimForum(o, 'guides', 4);
  o = a.claimForum(o, 'faction', 63);
  o = a.upsertFolder(o, { id: 'own', name: 'Own', order: 3, forumIds: [67] });
  const text = a.encodeState(o, a.freshDrafts(), env.sandbox.btoa);
  const out = a.importState(a.freshOrganizer(NOW), a.freshDrafts(), text, env.sandbox.atob);
  assert.ok(out.ok, out.detail);
  assert.deepStrictEqual(claims(out.organizer, 'guides'), [61, 4]);
  assert.deepStrictEqual(claims(out.organizer, 'faction'), [63]);
  assert.deepStrictEqual(claims(out.organizer, 'own'), [67]);
  assert.deepStrictEqual(claims(out.organizer, 'scripts'), []);
});

test('an import never gives a forum a second claimant: this device\'s claim stays', () => {
  const env = loadUserscript();
  const a = env.exports;
  let src = a.claimForum(a.freshOrganizer(NOW), 'guides', 61);
  src = a.upsertFolder(src, { id: 'own', name: 'Own', order: 3, forumIds: [63, 67] });
  const text = a.encodeState(src, a.freshDrafts(), env.sandbox.btoa);
  let local = a.claimForum(a.freshOrganizer(NOW), 'scripts', 61);
  local = a.claimForum(local, 'faction', 67);
  const out = a.importState(local, a.freshDrafts(), text, env.sandbox.atob);
  assert.deepStrictEqual(claims(out.organizer, 'scripts'), [61]);
  assert.deepStrictEqual(claims(out.organizer, 'guides'), []);
  assert.deepStrictEqual(claims(out.organizer, 'faction'), [67]);
  assert.deepStrictEqual(claims(out.organizer, 'own'), [63]);
});

test('an organizer saved before #47, one claim per folder, loads with no damage notice', () => {
  const old = { v: 1, folders: [
    { id: 'guides', name: 'Guides', order: 0, forumIds: [61] },
    { id: 'mine', name: 'Mine', order: 1, forumIds: [] },
  ], threads: {}, lastCatchUpAt: 0 };
  const env = loadUserscript({ gmStore: [['tfcc:organizer', JSON.stringify(old)]] });
  env.exports.loadAll(NOW);
  assert.doesNotMatch(env.exports.state.notices.map((n) => n.text).join(' '), /damaged/);
  assert.deepStrictEqual(claims(env.exports.state.organizer, 'guides'), [61]);
});

// -- Settings -----------------------------------------------------------------

function settingsEnv(width, org) {
  const { env, api: a } = bootNarrow({ width });
  a.state.feed.categories = CATS.slice();
  if (org) a.state.organizer = org(a, a.state.organizer);
  a.state.settings.view = 'settings';
  return { env, a };
}

function folderRow(html, name) {
  const at = html.indexOf('<div class="tfcc-kv tfcc-forder"><label>' + name + '</label>');
  assert.ok(at !== -1, 'the ' + name + ' row');
  return html.slice(at, html.indexOf('<div class="tfcc-kv', at + 10));
}

const options = (row) => [.../<select data-act="folder-forum"[^>]*>([\s\S]*?)<\/select>/.exec(row)[1]
  .matchAll(/<option value="([^"]*)"[^>]*>([^<]*)</g)].map((m) => [m[1], m[2]]);

for (const [label, width] of [['wide', 900], ['narrow', 343]]) {
  test('each claimed forum is a removable chip, named and titled (' + label + ')', () => {
    const { env } = settingsEnv(width, (a, o) => a.claimForum(a.claimForum(o, 'guides', 61), 'guides', 67));
    const row = folderRow(redraw(env), 'Guides');
    const chips = [...row.matchAll(/<span class="tfcc-claim">([^<]*)<button type="button" class="tfcc-unclaim" data-act="folder-unclaim" data-id="guides" data-forum="(\d+)" aria-label="([^"]*)" title="([^"]*)">/g)]
      .map((m) => [m[1], m[2], m[3], m[4]]);
    assert.deepStrictEqual(chips, [
      ['Tutorials and Guides', '61', 'Remove Tutorials and Guides', 'Remove Tutorials and Guides'],
      ['Tools and Userscripts', '67', 'Remove Tools and Userscripts', 'Remove Tools and Userscripts'],
    ]);
    assert.match(row, /<span class="tfcc-claims">/);
  });

  test('a folder with one claimed forum renders one chip (' + label + ')', () => {
    const { env } = settingsEnv(width, (a, o) => a.upsertFolder(o, Object.assign({}, o.folders[0], { forumIds: [61] })));
    const row = folderRow(redraw(env), 'Guides');
    assert.strictEqual((row.match(/class="tfcc-claim"/g) || []).length, 1);
  });

  test('the claim menu lists only forums no folder claims, and is named (' + label + ')', () => {
    const { env } = settingsEnv(width, (a, o) => a.claimForum(a.claimForum(o, 'guides', 61), 'faction', 67));
    const html = redraw(env);
    for (const name of ['Guides', 'Scripts and tools', 'Faction']) {
      const row = folderRow(html, name);
      assert.deepStrictEqual(options(row), [['', 'Claim a forum...'], ['4', 'Suggestions'], ['63', 'API Development']], name);
      assert.match(row, new RegExp('<select data-act="folder-forum" data-id="[^"]*" aria-label="Claim a forum for ' + name + '">'));
      assert.doesNotMatch(row, / selected/, 'nothing is pre-selected: the menu only adds');
    }
  });
}

test('a folder with no claim shows no chip list', () => {
  const { env } = settingsEnv(900);
  assert.doesNotMatch(folderRow(redraw(env), 'Guides'), /tfcc-claims/);
});

test('a claimed forum whose name is not loaded shows its number', () => {
  const { env, a } = settingsEnv(900, (x, o) => x.claimForum(o, 'guides', 99));
  a.state.feed.categories = CATS.slice();
  assert.match(folderRow(redraw(env), 'Guides'), /<span class="tfcc-claim">Forum 99<button[^>]*aria-label="Remove Forum 99"/);
});

function choose(env, sel, value) {
  const panel = panelOf(env);
  const t = panel.querySelector(sel);
  assert.ok(t, 'nothing rendered for ' + sel);
  t.value = value;
  panel.dispatchEvent({ type: 'change', target: t });
}

test('choosing a forum claims it, saves, announces, and keeps focus on the menu', () => {
  const { env, a } = settingsEnv(343, (x, o) => x.claimForum(o, 'guides', 61));
  redraw(env);
  choose(env, 'select[data-act="folder-forum"][data-id="guides"]', '63');
  assert.deepStrictEqual(claims(a.state.organizer, 'guides'), [61, 63], 'a second claim, the first kept');
  assert.deepStrictEqual(JSON.parse(env.gmStore.get('tfcc:organizer')).folders[0].forumIds, [61, 63]);
  assert.strictEqual(a.state.liveMessage.text, 'Guides now claims API Development.');
  assert.deepStrictEqual([lastFocus(env)['data-act'], lastFocus(env)['data-id']], ['folder-forum', 'guides']);
  // The placeholder never claims or removes anything.
  choose(env, 'select[data-act="folder-forum"][data-id="guides"]', '');
  assert.deepStrictEqual(claims(a.state.organizer, 'guides'), [61, 63]);
});

test('a forum another folder claims is refused, never moved', () => {
  const { env, a } = settingsEnv(343, (x, o) => x.claimForum(o, 'guides', 61));
  redraw(env);
  choose(env, 'select[data-act="folder-forum"][data-id="scripts"]', '61');
  assert.deepStrictEqual(claims(a.state.organizer, 'guides'), [61]);
  assert.deepStrictEqual(claims(a.state.organizer, 'scripts'), []);
});

test('a chip\'s remove button drops that claim only, announces, and focus goes to the menu', () => {
  const { env, a } = settingsEnv(343, (x, o) => x.claimForum(x.claimForum(o, 'guides', 61), 'guides', 67));
  a.state.organizer = a.applyAutoAssign(a.state.organizer, [{ id: '5', forumId: 61, title: 'T', postsTotal: 1 }], NOW);
  redraw(env);
  click(env, 'button[data-act="folder-unclaim"][data-id="guides"][data-forum="61"]');
  assert.deepStrictEqual(claims(a.state.organizer, 'guides'), [67]);
  assert.strictEqual(a.state.organizer.threads['5'].folderId, 'guides', 'the filed thread stays');
  assert.deepStrictEqual(JSON.parse(env.gmStore.get('tfcc:organizer')).folders[0].forumIds, [67]);
  assert.strictEqual(a.state.liveMessage.text, 'Guides no longer claims Tutorials and Guides.');
  assert.deepStrictEqual([lastFocus(env)['data-act'], lastFocus(env)['data-id']], ['folder-forum', 'guides']);
  const row = folderRow(panelOf(env).innerHTML, 'Guides');
  assert.ok(options(row).some(([v]) => v === '61'), 'the forum is free to claim again');
});

test('the folder note describes several claims and what removing one does', () => {
  const { env } = settingsEnv(900);
  const html = redraw(env);
  const info = /id="tfcc-info-settings-folders" hidden>([^<]*)<\/p>/.exec(html)[1];
  assert.match(info, /optionally claim one or more forums, so new subscriptions from them file themselves into it; a forum belongs to one folder at a time, and removing a claim leaves the threads already filed where they are;/);
  assert.doesNotMatch(info, /claim a forum,/);
});
