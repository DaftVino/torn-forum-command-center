'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { loadUserscript, FORUMS_LOCATION } = require('./load-userscript');

const NOW = 1700000000000;

function forums(extra) {
  return Object.assign({}, FORUMS_LOCATION, extra || {});
}

function ids(rows) {
  return Array.from(rows, (r) => r.id);
}

const R = (n) => Array.from({ length: n }, (_, i) => ({ id: String(i + 1) }));

test('every view is classified as capped or uncapped, exactly once', () => {
  // A new view cannot be added without deciding whether the Rows shown
  // setting governs it. This is the test that forces the call.
  const { exports: api } = loadUserscript();
  const capped = Array.from(api.CAPPED_VIEWS);
  const uncapped = Array.from(api.UNCAPPED_VIEWS);
  for (const v of api.VIEWS) {
    const n = (capped.includes(v) ? 1 : 0) + (uncapped.includes(v) ? 1 : 0);
    assert.strictEqual(n, 1, v + ' must be in exactly one of CAPPED_VIEWS or UNCAPPED_VIEWS');
  }
  for (const v of capped.concat(uncapped)) {
    assert.ok(Array.from(api.VIEWS).includes(v), v + ' is classified but is not a view');
  }
  assert.ok(uncapped.includes('search'), 'Search always shows every result');
  assert.ok(uncapped.includes('drafts'), 'Drafts always shows every draft');
  assert.ok(capped.includes('mine'), 'My posts is capped (issue #3)');
});

test('the menu is exactly 3, 5, 10, 20, 30 and All', () => {
  const { exports: api } = loadUserscript();
  assert.deepStrictEqual(Array.from(api.ROWS_SHOWN_OPTIONS), [3, 5, 10, 20, 30, 0]);
});

test('capRows keeps the first N rows and reports what it hid', () => {
  const { exports: api } = loadUserscript();
  const rows = R(5);
  const c = api.capRows(rows, 3, false);
  assert.deepStrictEqual(ids(c.rows), ['1', '2', '3']);
  assert.strictEqual(c.total, 5);
  assert.strictEqual(c.limit, 3);
  assert.strictEqual(c.hidden, 2);
  assert.strictEqual(c.expandable, true);
  assert.strictEqual(c.expanded, false);
  assert.strictEqual(rows.length, 5, 'the input is never mutated');
});

test('capRows does not bite on All, or on a list no longer than the cap', () => {
  const { exports: api } = loadUserscript();
  for (const [n, limit] of [[5, 0], [10, 10], [3, 5]]) {
    const c = api.capRows(R(n), limit, false);
    assert.strictEqual(c.rows.length, n, n + ' rows at limit ' + limit);
    assert.strictEqual(c.hidden, 0);
    assert.strictEqual(c.expandable, false, 'no "Showing 10 of 10" line');
  }
  const c11 = api.capRows(R(11), 10, false);
  assert.strictEqual(c11.hidden, 1, 'one over the cap is capped');
});

test('capRows treats an off-menu limit as All', () => {
  const { exports: api } = loadUserscript();
  for (const bad of [7, '3', 10.5, -3, NaN, null, undefined, true]) {
    const c = api.capRows(R(40), bad, false);
    assert.strictEqual(c.rows.length, 40, String(bad));
    assert.strictEqual(c.limit, 0, String(bad));
  }
});

test('capRows shows everything once expanded, and says so only if it mattered', () => {
  const { exports: api } = loadUserscript();
  const c = api.capRows(R(8), 3, true);
  assert.strictEqual(c.rows.length, 8);
  assert.strictEqual(c.hidden, 0);
  assert.strictEqual(c.expandable, true, 'the cap would bite, so the line still renders');
  assert.strictEqual(c.expanded, true);

  const short = api.capRows(R(2), 3, true);
  assert.strictEqual(short.expanded, false, 'nothing to expand');
});

test('capRows tolerates a non-array', () => {
  const { exports: api } = loadUserscript();
  const c = api.capRows(null, 3, false);
  assert.deepStrictEqual(Array.from(c.rows), []);
  assert.strictEqual(c.total, 0);
});

function seed(api, rows) {
  api.state.feed.subscribed = rows.map((r) => api.normaliseSubscribedRow({
    id: r.id, forum_id: 61, title: r.title || ('Thread ' + r.id),
    author: { id: 3, username: 'someone', karma: 1 },
    posts: { new: r.unread || 0, total: 10 },
  }));
  api.state.feed.categories = [{ id: 61, title: 'Tutorials and Guides', acronym: 'TG' }];
  api.recompute(NOW);
}

function boot() {
  const env = loadUserscript({ location: forums() });
  return { env, api: env.exports };
}

function rowCount(html) {
  return (html.match(/class="tfcc-row"/g) || []).length;
}

// Input order is the reverse of title order, so capping before the sort
// would keep ids 1-3 and capping after it keeps 6-4.
const SIX = [
  { id: 1, title: 'F' }, { id: 2, title: 'E' }, { id: 3, title: 'D' },
  { id: 4, title: 'C' }, { id: 5, title: 'B' }, { id: 6, title: 'A' },
];

test('Threads caps after the sort, and model.rows stays whole', () => {
  const { api } = boot();
  seed(api, SIX);
  api.state.settings.sort = 'title';
  api.state.settings.rowsShown = 3;
  const model = api.buildPanelModel(NOW);
  assert.deepStrictEqual(ids(model.capped.threads.rows), ['6', '5', '4']);
  assert.strictEqual(model.rows.length, 6, 'Search and deep search read model.rows');
});

test('pinned threads come first and take cap slots like any row', () => {
  const { api } = boot();
  seed(api, SIX);
  api.state.settings.sort = 'title';
  api.state.settings.rowsShown = 3;
  for (const id of [1, 2, 3, 4, 5]) api.state.organizer = api.togglePin(api.state.organizer, String(id));
  api.recompute(NOW);
  const model = api.buildPanelModel(NOW);
  assert.strictEqual(model.capped.threads.rows.length, 3, 'five pins do not make a cap of 3 show five');
  assert.ok(model.capped.threads.rows.every((r) => r.pinned), 'only pinned rows fit');
  assert.ok(!ids(model.capped.threads.rows).includes('6'), 'the unpinned A is below the cap');
});

test('the cap applies after Unread only, the folder filter and the filter box', () => {
  const { api } = boot();
  // The filter word must not appear in the forum name ("Tutorials and Guides"),
  // because the filter box searches forum names too and would match every row.
  seed(api, [
    { id: 1, title: 'A alpha', unread: 1 }, { id: 2, title: 'B alpha', unread: 0 },
    { id: 3, title: 'C alpha', unread: 2 }, { id: 4, title: 'D alpha', unread: 3 },
    { id: 5, title: 'E alpha', unread: 4 }, { id: 6, title: 'F other', unread: 5 },
  ]);
  api.state.settings.sort = 'title';
  api.state.settings.rowsShown = 3;

  api.state.settings.unreadOnly = true;
  let m = api.buildPanelModel(NOW);
  assert.deepStrictEqual(ids(m.capped.threads.rows), ['1', '3', '4']);
  assert.strictEqual(m.capped.threads.total, 5);

  api.state.searchQuery = 'alpha';
  m = api.buildPanelModel(NOW);
  assert.deepStrictEqual(ids(m.capped.threads.rows), ['1', '3', '4']);
  assert.strictEqual(m.capped.threads.total, 4, 'the filter box narrowed before the cap');

  for (const id of ['4', '5']) api.state.organizer = api.setFolder(api.state.organizer, id, 'guides');
  api.recompute(NOW);
  api.state.settings.folderFilter = 'guides';
  m = api.buildPanelModel(NOW);
  assert.deepStrictEqual(ids(m.capped.threads.rows), ['4', '5']);
  assert.strictEqual(m.capped.threads.expandable, false, 'two rows under a cap of 3');
});

test('a capped Threads list says how many it hid and offers Show all', () => {
  const { api } = boot();
  seed(api, SIX);
  api.state.settings.view = 'threads';
  api.state.settings.rowsShown = 3;
  let html = api.panelHtml(api.buildPanelModel(NOW));
  assert.strictEqual(rowCount(html), 3);
  assert.match(html, /Showing 3 of 6/);
  assert.match(html, /data-act="rows-toggle" data-view="threads"[^>]*>Show all</);

  api.state.showAll.threads = true;
  html = api.panelHtml(api.buildPanelModel(NOW));
  assert.strictEqual(rowCount(html), 6);
  assert.match(html, /Showing all 6/);
  assert.match(html, />Show 3 only</);
});

test('no cap line when the cap does not bite', () => {
  const { api } = boot();
  seed(api, SIX);
  api.state.settings.view = 'threads';
  for (const n of [0, 10]) {
    api.state.settings.rowsShown = n;
    const html = api.panelHtml(api.buildPanelModel(NOW));
    assert.strictEqual(rowCount(html), 6, 'cap ' + n);
    assert.doesNotMatch(html, /tfcc-cap/, 'cap ' + n);
  }
  seed(api, SIX.slice(0, 5));
  api.state.settings.rowsShown = 5;
  assert.doesNotMatch(api.panelHtml(api.buildPanelModel(NOW)), /Showing 5 of 5/);
});

test('Search lists every match with the cap at 3', () => {
  const { api } = boot();
  seed(api, SIX);
  api.state.settings.rowsShown = 3;
  api.state.settings.view = 'search';
  const html = api.panelHtml(api.buildPanelModel(NOW));
  assert.strictEqual(rowCount(html), 6);
  assert.match(html, /Threads \(6\)/);
  assert.doesNotMatch(html, /tfcc-cap/);
});

test('Drafts lists every draft with the cap at 3', () => {
  const { api } = boot();
  seed(api, SIX);
  let d = api.freshDrafts();
  for (const id of [1, 2, 3, 4, 5]) d = api.saveDraft(d, id, 'draft ' + id, NOW, 'Thread ' + id);
  api.state.drafts = d;
  api.recompute(NOW);
  api.state.settings.rowsShown = 3;
  api.state.settings.view = 'drafts';
  const html = api.panelHtml(api.buildPanelModel(NOW));
  assert.match(html, /All drafts \(5\)/);
  assert.strictEqual((html.match(/class="tfcc-hit"/g) || []).length, 5);
  assert.doesNotMatch(html, /tfcc-cap/);
});

function seedMine(api, rows) {
  const s = api.freshMine();
  s.selfId = 7;
  s.fetchedAt = NOW;
  s.threads = rows.map((r) => Object.assign(api.freshMineThread(100 + r.id, NOW), {
    started: true, title: r.title, totalKnown: true, postsTotal: 5, baselineTotal: 5,
  }));
  api.state.mine = s;
  api.recompute(NOW);
}

test('My posts caps after the sort, says how many it hid and offers Show all', () => {
  // Input order is the reverse of title order, as in the Threads test, so a
  // cap before the sort would keep 101-103 instead of 106-104.
  const { api } = boot();
  seed(api, [{ id: 1, title: 'Z' }]);
  seedMine(api, SIX);
  api.state.settings.view = 'mine';
  api.state.settings.sort = 'title';
  api.state.settings.rowsShown = 3;
  const model = api.buildPanelModel(NOW);
  assert.deepStrictEqual(ids(model.capped.mine.rows), ['106', '105', '104']);
  assert.strictEqual(model.mine.total, 6, 'the My posts count stays whole');
  assert.strictEqual(model.capped.threads.total, 1, 'Threads keeps its own population');

  let html = api.panelHtml(model);
  assert.strictEqual(rowCount(html), 3);
  assert.match(html, /Showing 3 of 6/);
  assert.match(html, /data-act="rows-toggle" data-view="mine"[^>]*>Show all</);

  api.state.showAll.mine = true;
  html = api.panelHtml(api.buildPanelModel(NOW));
  assert.strictEqual(rowCount(html), 6);
  assert.match(html, /Showing all 6/);
});
