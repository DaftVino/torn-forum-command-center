# Rows shown cap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Rows shown setting (3, 5, 10, 20, 30, All; default All) that caps Threads and Catch up after every filter and the sort. A capped list says "Showing N of M" and offers a Show all that lasts until the page reloads. Search, Drafts and the Catch up nav count stay uncapped.

**Architecture:** A pure engine helper `capRows(rows, limit, expanded)` plus three frozen constants (`ROWS_SHOWN_OPTIONS`, `CAPPED_VIEWS`, `UNCAPPED_VIEWS`). `buildPanelModel` keeps `model.rows` and `model.catchUp` whole and adds `model.capped`, which only the Threads and Catch up renderers read. The setting is one normalised field, `settings.rowsShown` (0 = All). The Show all override lives in memory only, in `state.showAll`.

**Tech Stack:** One ES5 userscript IIFE (`torn-forum-command-center.user.js`), Node `node:test` suites run through the `vm` harness in `tests/load-userscript.js`. No dependencies.

**Spec:** `docs/superpowers/specs/2026-10-08-rows-shown-cap-design.md`. Read it first. Where the two disagree, the spec wins and this plan is amended.

## Global Constraints

- **Never read `torn-forum-command-center.user.js` whole.** For every symbol below, run `grep -n "function <name>(" torn-forum-command-center.user.js` (the code map may be a commit stale), then `Read` with `offset`/`limit` around that line only.
- The source is **ASCII only** (`tests/metadata.test.js`). Type every string by hand with straight quotes. Never paste prose from this plan's Markdown if your editor has turned quotes curly.
- The engine section (between `// ---- ENGINE START` and `// ---- ENGINE END`) is pure (`tests/purity.test.js`): no DOM, no `state`, no `GM_*`, no `Date`. `capRows` and the constants go inside it. `renderCapLine` and every `state` access go in the runtime.
- Normalisers are total. A corrupt or off-menu `rowsShown` becomes `0` (All). It never throws.
- Default is All (`rowsShown: 0`). With the default, every existing view's HTML must be byte-identical to before.
- `SCHEMA_VERSION` stays `1`.
- Settings are **not** part of export. `encodeState` is not touched.
- No request, endpoint or budget change. The Settings "Refreshing" text does not change (constraint 7).
- `@match`, `@grant` and `@connect` do not change.
- Constraint 8: `@version`, `SCRIPT_VERSION`, `package.json` `version`, the newest `CHANGELOG.md` heading and the tag move together in one release commit. That commit is cut separately at release; this PR only adds an `[Unreleased]` entry (Task 7).
- Commit messages are Conventional Commits with **no** attribution or `Co-Authored-By` footer.
- `node tests/mutation-check.mjs` edits the production file in place. **Never pipe it into `head`** or anything that closes the pipe early. Redirect to a file and read the file.

## Review Focus

These inputs are not in the issue's acceptance list. They are the most likely to bite a real user. Each one has a test in the task that owns the code.

1. **A list exactly as long as the cap** (10 rows, cap 10) must show no "Showing 10 of 10" line and no Show all button. Task 1 (`capRows` boundary) and Task 3 (rendered).
2. **A stored value from a hand-edited or future build**: `"10"`, `10.5`, `7`, `-3`, `null`, `true`. Each must become All, not 10 and not a crash. Task 2.
3. **More pinned threads than the cap.** With 5 pins and a cap of 3, the list shows three pinned rows and "Showing 3 of N", not eight rows. Task 3.
4. **Show all, then a change to the setting.** The expansion must clear, so the new cap takes effect at once. Task 5.
5. **A Show all click for a view that is not capped** (a forged `data-view="search"` or a missing one) must change nothing and must not throw. Task 5.

---

## Files in scope

| File | Change |
|---|---|
| `torn-forum-command-center.user.js` | Constants, `capRows`, `settingsDefaults`, `normaliseSettings`, `state`, `buildPanelModel`, `renderCapLine` (new), `renderNav`, `renderThreadsView`, `renderCatchUpView`, `renderSettingsView`, `makeHandlers` |
| `tests/load-userscript.js` | `EXPORT_NAMES` gains the new symbols |
| `tests/rows-cap.test.js` | **New.** Engine and view-model behaviour of the cap |
| `tests/storage.test.js` | `rowsShown` normalising and the reload round trip |
| `tests/handlers.test.js` | Fixture makes the cap bite. New handler tests |
| `tests/share.test.js` | The export carries no `rowsShown` |
| `tests/mutation-check.mjs` | Five new mutations |
| `tests/render-preview.mjs` | One capped narrow preview |
| `docs/architecture.md`, `docs/qa-checklist.md`, `README.md`, `CHANGELOG.md`, `docs/code-map.md`, `package.json` | Docs, release |

No other file is in scope without amending this plan.

---

### Task 1: The engine helper and the view classification

**Files:**
- Modify: `torn-forum-command-center.user.js`, the constants block next to `var VIEWS` (about line 111), and the engine after `function catchUpList(` (about line 911)
- Modify: `tests/load-userscript.js`, `EXPORT_NAMES` (the `// engine: merge, unread, sort` line, about line 63)
- Create: `tests/rows-cap.test.js`

**Interfaces:**
- Produces: `ROWS_SHOWN_OPTIONS` (frozen `[3, 5, 10, 20, 30, 0]`), `CAPPED_VIEWS` (frozen `['threads', 'catchup']`), `UNCAPPED_VIEWS` (frozen `['search', 'drafts', 'settings']`), and `capRows(rows, limit, expanded)`. The helper returns `{ rows: Array, total: number, limit: number, hidden: number, expandable: boolean, expanded: boolean }`.

- [ ] **Step 1: Export the new names from the harness**

In `tests/load-userscript.js`, change the line

```js
  'SORT_MODES', 'SORT_LABELS', 'sortThreads', 'catchUpList',
```

to

```js
  'SORT_MODES', 'SORT_LABELS', 'sortThreads', 'catchUpList',
  'ROWS_SHOWN_OPTIONS', 'CAPPED_VIEWS', 'UNCAPPED_VIEWS', 'VIEW_LABELS', 'capRows', 'renderCapLine',
```

(The harness exports `undefined` for a name that does not exist yet, so this does not break anything.)

- [ ] **Step 2: Write the failing tests**

Create `tests/rows-cap.test.js`:

```js
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
  // A new view (My posts, issue #2) cannot be added without deciding whether
  // the Rows shown setting governs it. This is the test that forces the call.
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
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `node --test tests/rows-cap.test.js`
Expected: FAIL. `api.CAPPED_VIEWS` is undefined, so `Array.from(undefined)` throws, and `api.capRows is not a function`.

- [ ] **Step 4: Add the constants**

Find `var VIEWS = Object.freeze(` with `grep -n`. Immediately after that line, add:

```js
  // Rows shown: 0 is All. A menu rather than a free number, so the settings
  // normaliser can refuse anything the menu never wrote and fall back to All.
  var ROWS_SHOWN_OPTIONS = Object.freeze([3, 5, 10, 20, 30, 0]);
  // Every view is in exactly one of these, and a test holds it there, so a new
  // view cannot ship without someone deciding whether the cap governs it.
  // Search and Drafts are uncapped on purpose: a search that hides matches
  // answers a different question from the one asked.
  var CAPPED_VIEWS = Object.freeze(['threads', 'catchup']);
  var UNCAPPED_VIEWS = Object.freeze(['search', 'drafts', 'settings']);
```

- [ ] **Step 5: Add `capRows`**

Find `function catchUpList(` with `grep -n`. After its closing `}`, add:

```js
  // The last step before rendering a capped list. It runs after every filter
  // and the sort, so the user sees the top N of what they asked for. It copies
  // rather than slices in place, because the full list is still the one that
  // Search, deep search and the nav count read.
  function capRows(rows, limit, expanded) {
    var list = Array.isArray(rows) ? rows : [];
    var lim = typeof limit === 'number' && ROWS_SHOWN_OPTIONS.indexOf(limit) !== -1 ? limit : 0;
    var total = list.length;
    var bites = lim > 0 && total > lim;
    var open = bites && expanded === true;
    return {
      rows: bites && !open ? list.slice(0, lim) : list.slice(),
      total: total,
      limit: lim,
      hidden: bites && !open ? total - lim : 0,
      expandable: bites,
      expanded: open,
    };
  }
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `node --test tests/rows-cap.test.js tests/purity.test.js`
Expected: PASS, both suites. Purity proves `capRows` landed inside the engine and reaches for nothing ambient.

- [ ] **Step 7: Run the full suite**

Run: `npm test && npm run test:syntax`
Expected: PASS. Nothing calls `capRows` yet.

- [ ] **Step 8: Commit**

```bash
git add torn-forum-command-center.user.js tests/load-userscript.js tests/rows-cap.test.js
git commit -m "feat: pure capRows helper and the capped-view classification (#3)"
```

---

### Task 2: The `rowsShown` setting

**Files:**
- Modify: `torn-forum-command-center.user.js`, `function settingsDefaults(` (about line 304) and `function normaliseSettings(` (about line 330)
- Test: `tests/storage.test.js`

**Interfaces:**
- Consumes: `ROWS_SHOWN_OPTIONS` (Task 1).
- Produces: `settings.rowsShown`, a number on the menu, default `0`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/storage.test.js`:

```js
test('rows shown defaults to All, so an existing user sees no change', () => {
  const { exports: api } = loadUserscript();
  assert.strictEqual(api.freshSettings().rowsShown, 0);
  assert.strictEqual(api.normaliseSettings({ v: 1 }).rowsShown, 0, 'an absent field is All');
});

test('rows shown keeps every value on the menu', () => {
  const { exports: api } = loadUserscript();
  for (const n of [3, 5, 10, 20, 30, 0]) {
    assert.strictEqual(api.normaliseSettings({ v: 1, rowsShown: n }).rowsShown, n);
  }
});

test('a corrupt or off-menu rows shown falls back to All', () => {
  // "10" as a string and 10.5 are the two a lenient toInt would have let
  // through as 10: neither was written by the menu.
  const { exports: api } = loadUserscript();
  for (const bad of ['10', 10.5, 7, -3, 1000, null, true, {}, [], NaN, Infinity]) {
    assert.strictEqual(api.normaliseSettings({ v: 1, rowsShown: bad }).rowsShown, 0, String(bad));
  }
});

test('rows shown survives a reload', () => {
  const { exports: api } = loadUserscript({
    gmStore: [['tfcc:settings', JSON.stringify({ v: 1, rowsShown: 10 })]],
  });
  api.loadAll(1700000000000);
  assert.strictEqual(api.state.settings.rowsShown, 10);
});
```

Also, in the existing test `'what a normaliser writes, it can read back unchanged'`, change the settings case from

```js
    ['settings', api.STORAGE_KEYS.settings, api.normaliseSettings, api.freshSettings()],
```

to

```js
    ['settings', api.STORAGE_KEYS.settings, api.normaliseSettings,
      Object.assign(api.freshSettings(), { rowsShown: 20 })],
```

so the round trip covers a non-default value.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/storage.test.js`
Expected: FAIL. `freshSettings().rowsShown` is `undefined`, not `0`, and the round trip loses `rowsShown: 20`.

- [ ] **Step 3: Implement**

In `settingsDefaults()`, after `deepSearchPages: DEEP_SEARCH_MAX_PAGES,`, add:

```js
      // 0 is All. See ROWS_SHOWN_OPTIONS.
      rowsShown: 0,
```

In `normaliseSettings(raw)`, after the `out.deepSearchPages = ...` line, add:

```js
    // Strict on type: toInt would floor 10.5 to 10 and accept "10", and the
    // menu wrote neither. Anything off the menu is All, never an error.
    out.rowsShown = typeof raw.rowsShown === 'number' && ROWS_SHOWN_OPTIONS.indexOf(raw.rowsShown) !== -1
      ? raw.rowsShown : 0;
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/storage.test.js tests/purity.test.js`
Expected: PASS.

- [ ] **Step 5: Run the full suite**

Run: `npm test && npm run test:syntax`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add torn-forum-command-center.user.js tests/storage.test.js
git commit -m "feat: rowsShown setting, normalised to All when corrupt (#3)"
```

---

### Task 3: Cap the Threads view

**Files:**
- Modify: `torn-forum-command-center.user.js`, `var state = {` (about line 1791), `function buildPanelModel(` (about line 2526), `function renderThreadsView(` (about line 2671), plus a new `renderCapLine` placed just before `renderThreadsView`
- Test: `tests/rows-cap.test.js`

**Interfaces:**
- Consumes: `capRows`, `settings.rowsShown`.
- Produces: `state.showAll` (an object keyed by view, in memory only); `model.capped.threads` (a `capRows` result); `model.settings.rowsShown`; `renderCapLine(cap, view) -> string`. `model.rows` stays the **full** sorted list.

- [ ] **Step 1: Write the failing tests**

Append to `tests/rows-cap.test.js`:

```js
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/rows-cap.test.js`
Expected: FAIL. `model.capped` is undefined, and `api.state.showAll` is undefined (`Cannot set properties of undefined`). The Search and Drafts tests pass already. They are regression guards for Task 3, and the mutation check in Task 6 proves they bite.

- [ ] **Step 3: Add the session state**

In `var state = {`, after `replyBoxFound: false,`, add:

```js
    // Show all, per capped view, until the page reloads. Never persisted and
    // never exported: the issue asks for "this session only", and a page load
    // is the only session boundary a userscript can see.
    showAll: {},
```

- [ ] **Step 4: Cap in `buildPanelModel`**

In `buildPanelModel(now)`, after the `totalUnread` loop and before `return {`, add:

```js
    var sorted = sortThreads(visible, s.sort);
    var catchUp = sortThreads(catchUpList(rows, state.organizer.lastCatchUpAt), 'activity');
    var showAll = state.showAll || {};
```

In the returned object, replace

```js
      rows: sortThreads(visible, s.sort),
```

with

```js
      // Whole on purpose: Search lists these and deep search fetches them.
      rows: sorted,
```

and replace

```js
      catchUp: sortThreads(catchUpList(rows, state.organizer.lastCatchUpAt), 'activity'),
```

with

```js
      // Whole on purpose: the Catch up nav count reads its length.
      catchUp: catchUp,
      // What the capped views render. The cap is the last step, after every
      // filter and the sort, so the user sees the top N of what they asked for.
      capped: {
        threads: capRows(sorted, s.rowsShown, showAll.threads === true),
        catchup: capRows(catchUp, s.rowsShown, showAll.catchup === true),
      },
```

In the nested `settings: {` object, after `deepSearchPages: s.deepSearchPages,`, add:

```js
        rowsShown: s.rowsShown,
```

- [ ] **Step 5: Add `renderCapLine`**

Immediately before `function renderThreadsView(`, add:

```js
  // The line under a capped list. Nothing at all unless the cap is biting, so a
  // user on All, or with a list no longer than the cap, never sees it.
  function renderCapLine(cap, view) {
    if (!cap || !cap.expandable) return '';
    var text = cap.expanded ? 'Showing all ' + cap.total : 'Showing ' + cap.rows.length + ' of ' + cap.total;
    var label = cap.expanded ? 'Show ' + cap.limit + ' only' : 'Show all';
    return '<div class="tfcc-bar tfcc-cap"><span class="tfcc-note">' + escapeHtml(text) + '</span>'
      + btn('rows-toggle', label, ' data-view="' + escapeHtml(view) + '" title="Until the page reloads"')
      + '</div>';
  }
```

Check the order of attributes `btn()` emits: `data-act` first, then `extra`. The Step 1 regex `data-act="rows-toggle" data-view="threads"[^>]*>Show all<` depends on it.

- [ ] **Step 6: Render the capped rows in `renderThreadsView`**

Replace the block

```js
    } else {
      out.push('<div class="tfcc-rows">');
      for (var r = 0; r < model.rows.length; r += 1) out.push(renderRow(model.rows[r], model));
      out.push('</div>');
    }
```

with

```js
    } else {
      var shown = model.capped.threads.rows;
      out.push('<div class="tfcc-rows">');
      for (var r = 0; r < shown.length; r += 1) out.push(renderRow(shown[r], model));
      out.push('</div>');
      out.push(renderCapLine(model.capped.threads, 'threads'));
    }
```

Leave the `if (!model.rows.length)` empty-state check alone. The full list being empty is the right test.

- [ ] **Step 7: Run the tests to verify they pass**

Run: `node --test tests/rows-cap.test.js tests/panel.test.js tests/purity.test.js`
Expected: PASS.

- [ ] **Step 8: Run the full suite**

Run: `npm test && npm run test:syntax`
Expected: PASS. With the default `rowsShown: 0`, the Threads HTML is unchanged, because `renderCapLine` returns `''`.

- [ ] **Step 9: Commit**

```bash
git add torn-forum-command-center.user.js tests/rows-cap.test.js
git commit -m "feat: cap the Threads list after filter and sort, with Show all (#3)"
```

---

### Task 4: Cap Catch up, keep its nav count whole

**Files:**
- Modify: `torn-forum-command-center.user.js`, `function renderCatchUpView(` (about line 2714)
- Test: `tests/rows-cap.test.js`

**Interfaces:**
- Consumes: `model.capped.catchup`, `renderCapLine` (Task 3).
- Produces: nothing new. `renderNav` keeps reading `model.catchUp.length`, which is whole.

- [ ] **Step 1: Write the failing tests**

Append to `tests/rows-cap.test.js`:

```js
test('Catch up caps its list but the nav count keeps counting everything', () => {
  const { api } = boot();
  seed(api, [
    { id: 1, title: 'A', unread: 1 }, { id: 2, title: 'B', unread: 1 }, { id: 3, title: 'C', unread: 1 },
    { id: 4, title: 'D', unread: 1 }, { id: 5, title: 'E', unread: 1 },
  ]);
  api.state.settings.view = 'catchup';
  api.state.settings.rowsShown = 3;
  const model = api.buildPanelModel(NOW);
  assert.strictEqual(model.catchUp.length, 5, 'the model keeps the whole list');
  const html = api.panelHtml(model);
  assert.match(html, /Catch up \(5\)/, 'the nav count is uncapped');
  assert.strictEqual(rowCount(html), 3);
  assert.match(html, /Showing 3 of 5/);
  assert.match(html, /data-act="rows-toggle" data-view="catchup"/);
});

test('Catch up caps the flat list, then groups, and headings count what they show', () => {
  const { api } = boot();
  seed(api, [
    { id: 1, title: 'A', unread: 1 }, { id: 2, title: 'B', unread: 1 }, { id: 3, title: 'C', unread: 1 },
    { id: 4, title: 'D', unread: 1 }, { id: 5, title: 'E', unread: 1 },
  ]);
  for (const id of ['1', '4']) api.state.organizer = api.setFolder(api.state.organizer, id, 'guides');
  api.recompute(NOW);
  api.state.settings.view = 'catchup';

  api.state.settings.rowsShown = 3;
  let html = api.panelHtml(api.buildPanelModel(NOW));
  assert.match(html, /Guides \(1\)/, 'only A of the two guides is in the top 3');
  assert.match(html, /Unfiled \(2\)/);

  api.state.showAll.catchup = true;
  html = api.panelHtml(api.buildPanelModel(NOW));
  assert.match(html, /Guides \(2\)/);
  assert.match(html, /Unfiled \(3\)/);
  assert.match(html, /Showing all 5/);
});

test('Show all is per view', () => {
  const { api } = boot();
  seed(api, SIX.map((r) => Object.assign({ unread: 1 }, r)));
  api.state.settings.rowsShown = 3;
  api.state.showAll.threads = true;
  const m = api.buildPanelModel(NOW);
  assert.strictEqual(m.capped.threads.rows.length, 6);
  assert.strictEqual(m.capped.catchup.rows.length, 3, 'expanding Threads leaves Catch up capped');
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/rows-cap.test.js`
Expected: FAIL. Catch up still renders 5 rows with no "Showing 3 of 5", and the headings read `Guides (2)` / `Unfiled (3)` at a cap of 3. The "per view" test passes already, because it reads the model only. It is guarded here so that Task 5's handler cannot couple the two views.

- [ ] **Step 3: Implement**

In `renderCatchUpView(model)`, leave the `if (!model.catchUp.length)` empty-state check as it is. Replace the grouping loop

```js
    var byFolder = {};
    for (var i = 0; i < model.catchUp.length; i += 1) {
      var k = model.catchUp[i].folderName || 'Unfiled';
      (byFolder[k] = byFolder[k] || []).push(model.catchUp[i]);
    }
```

with

```js
    // Cap the flat, activity-sorted list first, then group what is shown.
    // Capping per folder would show up to N rows times the folder count.
    var shown = model.capped.catchup.rows;
    var byFolder = {};
    for (var i = 0; i < shown.length; i += 1) {
      var k = shown[i].folderName || 'Unfiled';
      (byFolder[k] = byFolder[k] || []).push(shown[i]);
    }
```

Before the final `return out.join('');` (the one after the folder loop, not the early return in the empty state), add:

```js
    out.push(renderCapLine(model.capped.catchup, 'catchup'));
```

Do **not** touch `renderNav`. It must keep reading `model.catchUp.length`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/rows-cap.test.js tests/panel.test.js`
Expected: PASS. The existing `catch up groups by folder` test still sees `Guides (1)` at the default All.

- [ ] **Step 5: Run the full suite**

Run: `npm test && npm run test:syntax`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add torn-forum-command-center.user.js tests/rows-cap.test.js
git commit -m "feat: cap Catch up before grouping, nav count stays whole (#3)"
```

---

### Task 5: The Settings control and the handlers

**Files:**
- Modify: `torn-forum-command-center.user.js`: the constants block (add `VIEW_LABELS`), `function renderNav(`, `function renderSettingsView(` (the Appearance section), and `function makeHandlers(` (`onAction` and `onChange`, plus the `reset-all` case)
- Test: `tests/handlers.test.js`, `tests/share.test.js`, `tests/rows-cap.test.js`

**Interfaces:**
- Consumes: `ROWS_SHOWN_OPTIONS`, `CAPPED_VIEWS`, `state.showAll`, `normaliseSettings`.
- Produces: `VIEW_LABELS` (a frozen engine constant; `renderNav` reads it); action `rows-toggle` (onAction, reads `data-view`); action `rows-shown` (onChange, on `select#tfcc-rows`).

- [ ] **Step 1: Write the failing tests**

In `tests/handlers.test.js`, inside `renderedActions()`, the fixture has only two rows, which cannot make a cap of 3 bite. So the `rows-toggle` button would never render, and the handler would be reported as an orphan. Replace

```js
  api.state.feed.subscribed = [1, 2].map((id) => api.normaliseSubscribedRow({
```

with

```js
  api.state.feed.subscribed = [1, 2, 3, 4].map((id) => api.normaliseSubscribedRow({
```

and, immediately before `const actions = new Set();`, add:

```js
  // Four rows under a cap of 3, so the Show all control renders too.
  api.state.settings.rowsShown = 3;
```

Then append these tests to `tests/handlers.test.js`:

```js
test('the rows shown select changes, persists and clears any Show all', () => {
  const env = loadUserscript({ location: forums(), now: NOW });
  const api = env.exports;
  const handlers = api.makeHandlers(env.doc, env.win);
  const el = (act, value) => ({ getAttribute: (k) => (k === 'data-act' ? act : null), value });

  handlers.onChange('rows-shown', el('rows-shown', '10'));
  assert.strictEqual(api.state.settings.rowsShown, 10);
  assert.strictEqual(JSON.parse(env.gmStore.get('tfcc:settings')).rowsShown, 10, 'survives a reload');

  api.state.showAll.threads = true;
  handlers.onChange('rows-shown', el('rows-shown', '5'));
  assert.strictEqual(api.state.settings.rowsShown, 5);
  assert.strictEqual(api.state.showAll.threads, undefined, 'a new cap takes effect at once');

  handlers.onChange('rows-shown', el('rows-shown', 'banana'));
  assert.strictEqual(api.state.settings.rowsShown, 0, 'off the menu is All');
});

test('Show all toggles one capped view and is never persisted', () => {
  const env = loadUserscript({ location: forums(), now: NOW });
  const api = env.exports;
  const handlers = api.makeHandlers(env.doc, env.win);
  const el = (attrs) => ({ getAttribute: (k) => (attrs[k] === undefined ? null : attrs[k]) });

  handlers.onAction('rows-toggle', el({ 'data-act': 'rows-toggle', 'data-view': 'threads' }));
  assert.strictEqual(api.state.showAll.threads, true);
  assert.strictEqual(api.state.showAll.catchup, undefined);

  handlers.onAction('rows-toggle', el({ 'data-act': 'rows-toggle', 'data-view': 'threads' }));
  assert.strictEqual(api.state.showAll.threads, false, 'Show N only puts the cap back');

  assert.doesNotThrow(() => {
    handlers.onAction('rows-toggle', el({ 'data-act': 'rows-toggle', 'data-view': 'search' }));
    handlers.onAction('rows-toggle', el({ 'data-act': 'rows-toggle' }));
  });
  assert.strictEqual(api.state.showAll.search, undefined, 'Search is never capped, so never expanded');

  handlers.onChange('rows-shown', { getAttribute: () => 'rows-shown', value: '3' });
  handlers.onAction('rows-toggle', el({ 'data-act': 'rows-toggle', 'data-view': 'catchup' }));
  const stored = env.gmStore.get('tfcc:settings') || '{}';
  assert.strictEqual(stored.indexOf('showAll'), -1, 'Show all lasts until the page reloads, no longer');
});

test('Reset everything also clears Show all', () => {
  const env = loadUserscript({ location: forums(), now: NOW });
  const api = env.exports;
  const handlers = api.makeHandlers(env.doc, env.win);
  api.state.showAll.threads = true;
  handlers.onAction('reset-all', { getAttribute: (k) => (k === 'data-act' ? 'reset-all' : null) });
  assert.deepStrictEqual(Object.keys(api.state.showAll), []);
});
```

Append to `tests/rows-cap.test.js`:

```js
test('the Settings view offers the menu and names the capped views', () => {
  const { api } = boot();
  api.state.settings.view = 'settings';
  api.state.settings.rowsShown = 10;
  const html = api.panelHtml(api.buildPanelModel(NOW));
  assert.match(html, /<select id="tfcc-rows" data-act="rows-shown">/);
  for (const [v, label] of [[3, '3'], [5, '5'], [10, '10'], [20, '20'], [30, '30'], [0, 'All']]) {
    assert.match(html, new RegExp('<option value="' + v + '"[^>]*>' + label + '</option>'));
  }
  assert.match(html, /<option value="10" selected>10<\/option>/);
  const names = Array.from(api.CAPPED_VIEWS, (v) => api.VIEW_LABELS[v]);
  for (const n of names) assert.ok(html.includes(n), 'the note names ' + n);
  assert.match(html, /Search and Drafts always show everything/);
});

test('the nav still reads its labels after VIEW_LABELS moved out of renderNav', () => {
  const { api } = boot();
  const html = api.panelHtml(api.buildPanelModel(NOW));
  for (const v of api.VIEWS) {
    assert.match(html, new RegExp('data-view="' + v + '"[^>]*>' + api.VIEW_LABELS[v]));
  }
});
```

Append to `tests/share.test.js`:

```js
test('an export carries no settings, so no rows shown either', () => {
  // Settings are not part of the export today. If that changes, this fails
  // and rowsShown has to be included deliberately, not by accident.
  const { organizer, drafts } = populated();
  const decoded = api.decodeState(api.encodeState(organizer, drafts, btoaFn), atobFn);
  assert.deepStrictEqual(Object.keys(decoded.payload).sort(), ['drafts', 'folders', 'threads', 'v']);
  assert.strictEqual(JSON.stringify(decoded.payload).indexOf('rowsShown'), -1);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/handlers.test.js tests/rows-cap.test.js tests/share.test.js`
Expected: FAIL. `rows-toggle` renders with no handler ("controls that render but do nothing: rows-toggle"), `rows-shown` is neither rendered nor handled, `VIEW_LABELS` is undefined, and Reset everything leaves `showAll.threads`. The share test passes already. It pins the decision.

- [ ] **Step 3: Hoist `VIEW_LABELS`**

Next to `CAPPED_VIEWS` (Task 1), add:

```js
  var VIEW_LABELS = Object.freeze({
    threads: 'Threads', catchup: 'Catch up', search: 'Search', drafts: 'Drafts', settings: 'Settings',
  });
```

In `renderNav(model)`, delete the line

```js
    var labels = { threads: 'Threads', catchup: 'Catch up', search: 'Search', drafts: 'Drafts', settings: 'Settings' };
```

and change `escapeHtml(labels[v] + count)` to `escapeHtml(VIEW_LABELS[v] + count)`.

If #2 has already merged, `renderNav`'s map has a `mine` entry. Move it into `VIEW_LABELS`, and follow "How #2 reconciles" in the spec before you continue.

- [ ] **Step 4: Add the Settings control**

In `renderSettingsView(model)`, in the Appearance section, after the Theme `select` block (the `out.push` that ends `+ '</select></div>');` after `THEMES.map`), add:

```js
    out.push('<div class="tfcc-kv"><label for="tfcc-rows">Rows shown</label>'
      + '<select id="tfcc-rows" data-act="rows-shown">'
      + ROWS_SHOWN_OPTIONS.map(function (n) {
        return '<option value="' + n + '"' + (model.settings.rowsShown === n ? ' selected' : '') + '>'
          + (n === 0 ? 'All' : String(n)) + '</option>';
      }).join('')
      + '</select></div>');
    var cappedNames = CAPPED_VIEWS.map(function (v) { return VIEW_LABELS[v]; });
    out.push('<p class="tfcc-note">Applies to '
      + escapeHtml(cappedNames.length > 1
        ? cappedNames.slice(0, -1).join(', ') + ' and ' + cappedNames[cappedNames.length - 1]
        : cappedNames.join(''))
      + '. Search and Drafts always show everything. A capped list says how many it is hiding, '
      + 'and Show all lifts the cap for that list until the page reloads.</p>');
```

- [ ] **Step 5: Add the handlers**

In `makeHandlers`, inside `onAction`, directly after the `if (act === 'unread-only') { ... }` line, add:

```js
        if (act === 'rows-toggle') {
          // Only a capped view can be expanded; anything else is ignored, so a
          // stale or forged data-view cannot plant state nothing reads.
          var cv = el && el.getAttribute ? el.getAttribute('data-view') : null;
          if (CAPPED_VIEWS.indexOf(cv) !== -1) state.showAll[cv] = state.showAll[cv] !== true;
          redraw(); return;
        }
```

In the `reset-all` case, change

```js
          state.settings = freshSettings(); state.organizer = freshOrganizer(now);
```

to

```js
          state.settings = freshSettings(); state.organizer = freshOrganizer(now); state.showAll = {};
```

Inside `onChange`, directly after the `auto-refresh` case, add:

```js
        if (act === 'rows-shown') {
          // Through the normaliser, like auto-refresh, so the select cannot
          // store anything the menu does not offer.
          state.settings = normaliseSettings(Object.assign({}, state.settings, { rowsShown: Number(value) }));
          // A new cap is a fresh statement of what the user wants; a Show all
          // from before it would silently override it.
          state.showAll = {};
          persist('settings'); redraw(); return;
        }
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `node --test tests/handlers.test.js tests/rows-cap.test.js tests/share.test.js tests/panel.test.js`
Expected: PASS.

- [ ] **Step 7: Run the full suite**

Run: `npm test && npm run test:syntax`
Expected: PASS. `tests/metadata.test.js` proves the new strings are ASCII.

- [ ] **Step 8: Commit**

```bash
git add torn-forum-command-center.user.js tests/handlers.test.js tests/rows-cap.test.js tests/share.test.js
git commit -m "feat: Rows shown setting in Settings, Show all handler (#3)"
```

---

### Task 6: Mutation check and preview

**Files:**
- Modify: `tests/mutation-check.mjs` (`MUTATIONS` array, append before its closing `];`)
- Modify: `tests/render-preview.mjs` (after the `threads-narrow.html` block)

- [ ] **Step 1: Add the mutations**

Every `apply` string must match the source exactly as Tasks 1 to 5 wrote it. If one does not, the check prints `SKIP ... stale` and counts it as a failure. Append to `MUTATIONS`:

```js
  {
    name: 'the rows shown cap is ignored',
    suite: 'tests/rows-cap.test.js',
    apply: (s) => s.replace(
      '    var bites = lim > 0 && total > lim;',
      '    var bites = false;',
    ),
  },
  {
    name: 'the cap runs before the sort',
    suite: 'tests/rows-cap.test.js',
    apply: (s) => s.replace(
      '        threads: capRows(sorted, s.rowsShown,',
      '        threads: capRows(visible, s.rowsShown,',
    ),
  },
  {
    name: 'the Catch up nav count counts only the capped rows',
    suite: 'tests/rows-cap.test.js',
    apply: (s) => s.replace(
      "      if (v === 'catchup' && model.catchUp.length) count = ' (' + model.catchUp.length + ')';",
      "      if (v === 'catchup' && model.catchUp.length) count = ' (' + model.capped.catchup.rows.length + ')';",
    ),
  },
  {
    name: 'Search renders the capped list',
    suite: 'tests/rows-cap.test.js',
    apply: (s) => s.replace(
      '    var matched = model.rows;',
      '    var matched = model.capped.threads.rows;',
    ),
  },
  {
    name: 'an off-menu rows shown is stored instead of falling back to All',
    suite: 'tests/storage.test.js',
    apply: (s) => s.replace(
      "    out.rowsShown = typeof raw.rowsShown === 'number' && ROWS_SHOWN_OPTIONS.indexOf(raw.rowsShown) !== -1",
      "    out.rowsShown = typeof raw.rowsShown === 'number' && raw.rowsShown >= 0",
    ),
  },
```

- [ ] **Step 2: Run the mutation check, redirected to a file**

Run: `node tests/mutation-check.mjs > "$TMPDIR/mutation.txt" 2>&1; echo exit=$?` and then read `$TMPDIR/mutation.txt` with `Read`. If `$TMPDIR` is unset, use the session scratchpad. **Never** pipe this into `head`.
Expected: every line is `OK`, including the five new ones, with `exit=0`. Then `git status --short` must show `torn-forum-command-center.user.js` unchanged by the run, and no `.mutation-backup` left behind.

If a new one prints `WEAK`, the test it names passes for the wrong reason. Fix the test, not the mutation. Then add a sentence to the corresponding test's comment saying what it now guards.

- [ ] **Step 3: Add a capped narrow preview**

In `tests/render-preview.mjs`, after `written.push('threads-narrow.html');`, add:

```js
// The cap line at PDA width, where it has to wrap without stranding the button.
api.state.settings.rowsShown = 3;
const cappedNarrow = api.panelHtml(api.buildPanelModel(NOW));
fs.writeFileSync(path.join(outDir, 'threads-capped-narrow.html'),
  page('threads / rows shown 3 / narrow 375px', 'dark', cappedNarrow, 375));
written.push('threads-capped-narrow.html');
api.state.settings.rowsShown = 0;
```

Run `node tests/render-preview.mjs` and open `threads-capped-narrow.html`. Check that "Showing 3 of N" and Show all sit on one bar or wrap cleanly, and that the button is readable. Then run `node tests/contrast-audit.mjs > "$TMPDIR/contrast.txt" 2>&1` and read it. Expected: no new failures, because the line uses `tfcc-note` and the stock button.

- [ ] **Step 4: Run the full suite**

Run: `npm test && npm run test:syntax`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add tests/mutation-check.mjs tests/render-preview.mjs
git commit -m "test: mutation entries and a narrow preview for the rows shown cap (#3)"
```

---

### Task 7: Docs, code map and the changelog entry

**Files:**
- Modify: `docs/architecture.md`, `docs/qa-checklist.md`, `README.md`, `CHANGELOG.md`, `docs/code-map.md`

- [ ] **Step 1: Architecture**

In `docs/architecture.md`, after the "### Last activity" section, add:

```markdown
### Rows shown

A Settings choice of 3, 5, 10, 20, 30 or All (the default) caps the Threads and
Catch up lists. `capRows` is a pure engine function and is the last step, after
every filter and the sort, so pinned threads take cap slots like any row.
`buildPanelModel` keeps `model.rows` and `model.catchUp` whole, because Search,
deep search and the Catch up nav count read them, and puts the capped lists in
`model.capped`. Every view is in exactly one of `CAPPED_VIEWS` and
`UNCAPPED_VIEWS`, and a test holds it there. Show all lives in `state.showAll`
until the page reloads and is never stored.
```

In "## Verification", change "It breaks each of 23 user-visible promises" to the count `MUTATIONS.length` now has. The 23 is already stale (51 entries before this plan, 56 after). Get the number with `grep -c "^    suite:" tests/mutation-check.mjs`.

- [ ] **Step 2: QA checklist**

In `docs/qa-checklist.md`, at the end of the "### The workspace" section and in its existing checkbox style, add:

```markdown
- [ ] Settings, Rows shown, 3. Threads shows three rows and "Showing 3 of N" with Show all. Show all lists every row. Show 3 only caps the list again.
- [ ] With Rows shown at 3, pin four threads. Threads shows three pinned rows.
- [ ] With Rows shown at 3, Unread only and a folder filter still narrow the list before the cap. The count in "Showing 3 of N" is the filtered total.
- [ ] Catch up shows three rows. The nav button still reads the full count.
- [ ] Search and Drafts show every row with Rows shown at 3.
- [ ] Click Show all, navigate to another forum page within forums.php, and come back. Still expanded. Reload the page. Capped again.
- [ ] Reload the page. Rows shown is still 3. Set it to All. No "Showing" line anywhere.
```

- [ ] **Step 3: README**

In `README.md`, in the features list, add one line: `- A Rows shown setting (3 to 30, or All) that caps Threads and Catch up, with Show all for the rest. Search and Drafts are never capped.` Find the list with `grep -n "^- " README.md`.

- [ ] **Step 4: Refresh the code map**

Run `/code-map`, because declarations moved: `capRows` and `renderCapLine` are new, and `VIEW_LABELS` is new. Then spot-check: `grep -n "capRows\|renderCapLine" docs/code-map.md` must show lines that match `grep -n "function capRows(\|function renderCapLine(" torn-forum-command-center.user.js`.

- [ ] **Step 5: Commit the docs**

```bash
git add docs/architecture.md docs/qa-checklist.md README.md docs/code-map.md
git commit -m "docs: rows shown cap in architecture, QA checklist, README and code map (#3)"
```

- [ ] **Step 6: CHANGELOG entry under `[Unreleased]` (no version bump in this PR)**

All three feature PRs (#2, #3, #4) share one release convention so they can merge in any order without fighting over version numbers: a feature PR adds its CHANGELOG entry under the existing `## [Unreleased]` heading and does **not** touch `// @version`, `SCRIPT_VERSION` or `package.json`. Replace `Nothing yet.` under `## [Unreleased]` (or append to the `### Added` list already there if another feature PR merged first) with:

```markdown
### Added

- A Rows shown setting in Settings: 3, 5, 10, 20, 30 or All. The default is
  All, so nothing changes until you pick one. It caps Threads and Catch up
  after every filter and the sort. A capped list says "Showing 10 of 42" and
  offers Show all, which lasts until the page reloads. Search and Drafts always
  show everything, and the Catch up count in the nav still counts every thread.
```

- [ ] **Step 7: Verify and commit**

Run: `npm test && npm run test:syntax && git diff --check`
Expected: PASS.

```bash
git add CHANGELOG.md
git commit -m "docs: changelog entry for the rows shown cap (#3)"
```

**Release (not part of this PR).** Constraint 8 is satisfied by one separate release commit on `main`, cut by the owner after `docs/qa-checklist.md` is walked on a real account: it sets `// @version`, `var SCRIPT_VERSION` and `package.json` `version` to the next minor after `main`'s (`0.2.0` if `main` is `0.1.0`), renames `## [Unreleased]` to `## [X.Y.0] - YYYY-MM-DD` above a fresh empty `[Unreleased]`, and is tagged `vX.Y.0`. `tests/metadata.test.js` asserts the three version strings agree.

---

## Stop conditions

Stop and amend this plan (and the spec) if any of these becomes necessary:

- reading the userscript whole, or editing a symbol not named in a task;
- `capRows` needing anything that is not an argument;
- any request, endpoint or budget change;
- changing `SCHEMA_VERSION`, or putting settings into the export;
- a mutation that cannot be made to bite without weakening another test.

## Completion gate

Done when `npm test`, `npm run test:syntax` and `git diff --check` pass, and every mutation in `node tests/mutation-check.mjs` (output redirected to a file) reports `OK`. The capped narrow preview must look right, and the CHANGELOG `[Unreleased]` entry must be present. Issue #3's "wired" rung is proved by these tests: the setting round-trips (Task 2, Task 5), survives a reload (Task 2), caps Threads and Catch up after filtering (Tasks 3 and 4), and leaves Search and Drafts uncapped (Task 3). My posts is covered by the classification test (Task 1) until #2 lands, and after that by the My posts cap test the spec's reconciliation section requires. The QA checklist block is walked by the owner before release.
