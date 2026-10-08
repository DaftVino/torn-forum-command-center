# My posts view Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a sixth panel view, My posts, listing the threads the key owner started or posted in, with Threads' row actions, filters and sort, and an honest local unread count for threads Torn gives no count for.

**Architecture:** Two new Public API v2 selections (`user/forumthreads`, `user/forumposts`) feed a new cache key `tfcc:mine` through pure engine normalisers and a pure snapshot merge. `mergeThreads` gains a fourth row source and two derived fields (`mineRole`, `inThreads`); a new pure `viewRows` picks each view's population. A separate runtime action `refreshMine` (at most 12 requests by default) runs only for the My posts view, behind a 15 minute TTL.

**Tech Stack:** One ES5-style IIFE userscript (`torn-forum-command-center.user.js`), Node `node:test` suites run through the `vm` harness in `tests/load-userscript.js`. No dependencies.

**Spec:** `docs/superpowers/specs/2026-10-08-my-posts-view-design.md`. Read it first; where the two disagree, the spec wins and this plan is amended.

## Global Constraints

- **Never read `torn-forum-command-center.user.js` whole.** For every symbol named below: `grep -n "function <name>\|var <name>" torn-forum-command-center.user.js`, then `Read` with `offset`/`limit` around that line. `docs/code-map.md` may be a commit stale; the grep is the truth.
- **ASCII only** in the userscript (`tests/metadata.test.js`). Write `Torn\'s`, never a curly apostrophe. Never paste prose from the spec into the source without checking.
- **Engine purity** (`tests/purity.test.js`): everything between `// ---- ENGINE START` and `// ---- ENGINE END` takes `now` as an argument; no `document`, `window`, `location`, `fetch`, `GM_`, `PDA_`, `Date.now`, `new Date()`.
- **Budget:** Threads refresh stays at most 13 requests by default; My posts fetch is at most 12 (2 + `enrichBudget` default 10); limiter stays 40 per 60 s. Settings text must state both.
- **Read-only:** GET only, `api.torn.com` only, `@match`/`@grant`/`@connect` unchanged.
- **API key** never in `tfcc:mine`, `state.mineError`, a debug report or an export. Every error detail through `scrubDetail`.
- **Post `content` is never stored, rendered or reported.**
- **No new DOM data path** (ADR 0001).
- **Tests use `.test.js` under `tests/`;** `npm test` runs `node --test tests/*.test.js`.
- **Mutation check:** `node tests/mutation-check.mjs > mutation.log 2>&1`, then read `mutation.log`. Never pipe it into `head` or anything that closes the pipe.
- **Commits:** Conventional Commits, no attribution trailer of any kind.
- **Version rule 8:** `@version`, `SCRIPT_VERSION`, `package.json` `version`, and the newest `CHANGELOG.md` heading move together in one commit; the tag `v0.2.0` goes on that commit at `/ship`.

## Review Focus

1. **Upgrade from v0.1.0 with no `tfcc:mine` key** must load silently: no "damaged and reset" notice. Pinned in Task 2 (storage test).
2. **A thread that is both subscribed and in My posts** must show Torn's count and Torn's dismissal, identical to its Threads row, not a local count. Pinned in Task 4.
3. **Mark all read in Catch up** must not write read markers for My posts-only threads (it iterates `state.rows`, which now holds them). Pinned in Task 5.
4. **A late My posts answer after Reset everything or Clear key** must be dropped. Pinned in Task 6 (staleness test).
5. **A My posts row whose total was never looked up** must say `not checked yet` and be hidden by Unread only with a visible count, never render as a checked zero. Pinned in Tasks 4 and 8.

## Files in scope

| File | Change |
|---|---|
| `torn-forum-command-center.user.js` | Engine: mine normalisers, snapshot merge, unread, `viewRows`, `is:` terms, merge integration. Runtime: storage key, `refreshMine`, `enrichMine`, handlers, nav, view, styles, Settings text, debug counts. |
| `tests/load-userscript.js` | New `EXPORT_NAMES`; `forumThreadsPayload`, `forumPostsPayload` |
| `tests/fixtures/user-forumthreads.json`, `tests/fixtures/user-forumposts.json` | Created in Task 0 (redacted live responses) |
| `tests/mine.test.js` | New, engine |
| `tests/mine-refresh.test.js` | New, runtime fetch |
| `tests/merge.test.js`, `tests/search.test.js`, `tests/panel.test.js`, `tests/handlers.test.js`, `tests/style.test.js`, `tests/storage.test.js`, `tests/staleness.test.js`, `tests/read-only.test.js`, `tests/debug-report.test.js`, `tests/share.test.js`, `tests/api.test.js` | Extended |
| `tests/render-preview.mjs` | Seed My posts data |
| `tests/mutation-check.mjs` | Twelve entries |
| `docs/architecture.md`, `docs/qa-checklist.md`, `docs/rules-compliance.md`, `README.md`, `CHANGELOG.md`, `package.json`, `docs/code-map.md` | Docs and release |

No other file is in scope without amending this plan.

## Stop conditions

Stop and amend the spec before proceeding if any of these becomes necessary: a request that is not one of `user/forumthreads`, `user/forumposts`, `forum/{id}/thread`; following `_metadata.links.next`; a My posts action over 12 requests at defaults; storing post `content`; reading Torn's DOM for any My posts data; changing `@match`, `@grant` or `@connect`; changing what auto refresh or `init` requests.

---

### Task 0: Capture the real response shapes (owner, live API)

This is the spec's open questions 1 and 2. It needs a real key and a browser, so it is done by the owner, not an agent. Tasks 1-12 proceed against the assumed shapes; **release is blocked** until this task is done and the fixtures replace the assumed builders.

**Files:**
- Create: `tests/fixtures/user-forumthreads.json`
- Create: `tests/fixtures/user-forumposts.json`

- [ ] **Step 1: Fetch each selection once in a browser**

Open, signed in, with the user's own key (in the address bar only, never committed):

```
https://api.torn.com/v2/user/forumthreads?limit=100&key=<KEY>
https://api.torn.com/v2/user/forumposts?limit=100&key=<KEY>
https://api.torn.com/v2/user/forumposts?key=<KEY>
```

The third call answers open question 2 (default page size, and whether `limit` changed anything).

- [ ] **Step 2: Redact and save**

Keep two rows of each list and `_metadata`. Replace every `content` value with `"REDACTED"`, every `username` with `"user1"`/`"user2"`, every `title` with `"Thread title"`. Keep all field **names**, numbers and booleans exactly. Save as the two fixture files.

- [ ] **Step 3: Record the answers in the spec**

Edit the spec's "Assumed response shapes" heading to "Response shapes (verified 2026-MM-DD)", correct any field name, and strike resolved open questions. If a field name differs from the assumption, change `mineThreadFromApi` / `minePostFromApi` (Task 2) and `forumThreadsPayload` / `forumPostsPayload` (Task 1) to match, and run `npm test`.

- [ ] **Step 4: Commit**

```bash
git add tests/fixtures docs/superpowers/specs/2026-10-08-my-posts-view-design.md
git commit -m "test: record live forumthreads and forumposts shapes (#2)"
```

---

### Task 1: Harness exports and payload builders

**Files:**
- Modify: `tests/load-userscript.js` (`EXPORT_NAMES` array; payload builders beside `forumFeedPayload`; `module.exports`)

**Interfaces:**
- Produces: `forumThreadsPayload(threads)`, `forumPostsPayload(posts)` exported from `tests/load-userscript.js`; the export names listed in Step 1, which later tasks define in the userscript (a name that does not exist yet exports `undefined`, which is harmless).

- [ ] **Step 1: Add export names**

In `EXPORT_NAMES`, after the `// engine: drafts` group, add:

```js
  // engine: my posts
  'MINE_MAX_THREADS', 'freshMine', 'freshMineThread', 'normaliseMine', 'normaliseMineThread',
  'mineThreadFromApi', 'minePostFromApi', 'pickList', 'parseThreadDetail',
  'mergeMineSnapshot', 'applyMineDetail', 'mineUnreadFor', 'isOrganised',
  'mineLookupTargets', 'mineIsDue', 'viewRows', 'ACTIVITY_SOURCES',
  // runtime: my posts
  'MINE_TTL_MS', 'MINE_PAGE_LIMIT', 'refreshMine',
```

Grep `EXPORT_NAMES` first: if `ACTIVITY_SOURCES`, `refreshAll`, `recompute`, `state`, `MAX_ENRICH_BUDGET` or `REQUESTS_PER_WINDOW` are already present, do not add them twice.

- [ ] **Step 2: Add payload builders**

After `forumFeedPayload`:

```js
// Assumed shapes until tests/fixtures/ holds the live ones (plan Task 0).
// When the fixtures land, these builders must produce exactly their field names.
function forumThreadsPayload(threads) {
  return {
    forumThreads: threads.map((t) => ({
      id: t.id,
      forum_id: t.forumId === undefined ? 61 : t.forumId,
      title: t.title === undefined ? `Thread ${t.id}` : t.title,
      posts: t.total === undefined ? 10 : t.total,
      first_post_time: t.firstAt === undefined ? 1600000000 : t.firstAt,
      last_post_time: t.lastAt === undefined ? 1600000000 : t.lastAt,
      author: t.author || { id: 7, username: 'me', karma: 1 },
      last_poster: t.lastPoster === undefined ? { id: 7, username: 'me' } : t.lastPoster,
      is_locked: false,
      is_sticky: false,
    })),
    _metadata: { links: { prev: null, next: null } },
  };
}

function forumPostsPayload(posts) {
  return {
    forumPosts: posts.map((p) => ({
      id: p.id,
      thread_id: p.threadId,
      author: p.author || { id: 7, username: 'me', karma: 1 },
      created_time: p.at === undefined ? 1600000000 : p.at,
      is_topic: p.isTopic === true,
      is_edited: false,
      content: p.content === undefined ? 'SECRET POST BODY ' + p.id : p.content,
    })),
    _metadata: { links: { prev: null, next: null } },
  };
}
```

Add both to `module.exports`.

- [ ] **Step 3: Verify nothing broke**

Run: `npm test`
Expected: PASS, same count as before.

- [ ] **Step 4: Commit**

```bash
git add tests/load-userscript.js
git commit -m "test: harness exports and payload builders for My posts (#2)"
```

---

### Task 2: The `tfcc:mine` record, its normalisers, and its storage key

**Files:**
- Modify: `torn-forum-command-center.user.js` - `STORAGE_KEYS`; engine constants block (beside `POST_CACHE_MAX_POSTS`); new engine section `// -- my posts` placed directly after `normaliseFeed`; runtime `state`, `loadAll`, `persist`, the `reset-all` branch in `makeHandlers`.
- Create: `tests/mine.test.js`
- Modify: `tests/storage.test.js`

**Interfaces:**
- Produces:
  - `MINE_MAX_THREADS = 200`
  - `freshMine() -> { v, fetchedAt: 0, selfId: 0, threads: [] }`
  - `freshMineThread(id, now) -> MineThread`
  - `normaliseMineThread(raw) -> MineThread | null` (reads only its own stored shape)
  - `normaliseMine(raw) -> MineSnapshot`
  - `pickList(data, names) -> Array | null`
  - `mineThreadFromApi(raw) -> { id, forumId, title, authorId, postsTotal, totalKnown, lastPostAt, lastPosterId, isLocked } | null`
  - `minePostFromApi(raw) -> { postId, threadId, authorId, at } | null` (never `content`)
  - `MineThread = { id, forumId, title, started, posted, myLastPostAt, postsTotal, totalKnown, lastPostAt, lastPosterId, infoAt, baselineTotal, firstSeenAt, isLocked }`
  - `STORAGE_KEYS.mine = 'tfcc:mine'`, `state.mine`, `persist('mine')`

- [ ] **Step 1: Write the failing engine tests**

Create `tests/mine.test.js`:

```js
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { loadUserscript, forumThreadsPayload, forumPostsPayload } = require('./load-userscript');

const { exports: api } = loadUserscript();

test('an API thread row becomes a started record with a known total', () => {
  const raw = forumThreadsPayload([{ id: 5, total: 12, lastAt: 1600000100 }]).forumThreads[0];
  const t = api.mineThreadFromApi(raw);
  assert.strictEqual(t.id, 5);
  assert.strictEqual(t.forumId, 61);
  assert.strictEqual(t.postsTotal, 12);
  assert.strictEqual(t.totalKnown, true);
  assert.strictEqual(t.lastPostAt, 1600000100 * 1000);
  assert.strictEqual(t.lastPosterId, 7);
  assert.strictEqual(t.authorId, 7);
});

test('a thread total is read as a number or as posts.total, and is unknown otherwise', () => {
  assert.strictEqual(api.mineThreadFromApi({ id: 1, posts: { total: 4 } }).postsTotal, 4);
  const none = api.mineThreadFromApi({ id: 1 });
  assert.strictEqual(none.totalKnown, false, 'a missing total must be unknown, never a checked zero');
  assert.strictEqual(none.postsTotal, 0);
});

test('a post row keeps its thread and time and drops the body', () => {
  const raw = forumPostsPayload([{ id: 9, threadId: 5, at: 1600000200 }]).forumPosts[0];
  const p = api.minePostFromApi(raw);
  assert.deepStrictEqual(Object.keys(p).sort(), ['at', 'authorId', 'postId', 'threadId']);
  assert.strictEqual(p.threadId, 5);
  assert.strictEqual(p.at, 1600000200 * 1000);
  assert.ok(JSON.stringify(p).indexOf('SECRET') === -1, 'post content must never be kept');
});

test('rows with no id are dropped rather than invented', () => {
  assert.strictEqual(api.mineThreadFromApi({ title: 'x' }), null);
  assert.strictEqual(api.minePostFromApi({ id: 3 }), null);
  assert.strictEqual(api.minePostFromApi('junk'), null);
});

test('the list is found under any of the names Torn might use, and missing is null', () => {
  assert.deepStrictEqual(api.pickList({ forumThreads: [1] }, ['forumThreads', 'forum_threads', 'threads']), [1]);
  assert.deepStrictEqual(api.pickList({ threads: [2] }, ['forumThreads', 'forum_threads', 'threads']), [2]);
  assert.strictEqual(api.pickList({ other: [] }, ['forumThreads']), null);
  assert.strictEqual(api.pickList(null, ['forumThreads']), null);
});

test('a stored snapshot reads back unchanged', () => {
  // The c4d91e1 lesson: a normaliser that cannot read its own output reports
  // the user's cache as damaged on every reload.
  const snap = api.freshMine();
  snap.fetchedAt = 1000;
  snap.selfId = 7;
  const t = api.freshMineThread(5, 1000);
  Object.assign(t, { started: true, postsTotal: 12, totalKnown: true, baselineTotal: 10, title: 'T' });
  snap.threads.push(t);
  const once = api.normaliseMine(JSON.parse(JSON.stringify(snap)));
  assert.deepStrictEqual(once, snap);
  assert.deepStrictEqual(api.normaliseMine(JSON.parse(JSON.stringify(once))), once);
});

test('a hostile snapshot normalises to something valid and capped', () => {
  assert.deepStrictEqual(api.normaliseMine('junk'), api.freshMine());
  assert.deepStrictEqual(api.normaliseMine({ v: 99 }), api.freshMine());
  const many = { v: 1, threads: [] };
  for (let i = 1; i <= 500; i += 1) many.threads.push({ id: i });
  assert.strictEqual(api.normaliseMine(many).threads.length, api.MINE_MAX_THREADS);
});
```

Append to `tests/storage.test.js`:

```js
test('an upgrade with no My posts cache reports nothing as damaged', () => {
  const { exports: api } = loadUserscript();
  const res = api.loadKey(api.STORAGE_KEYS.mine, api.normaliseMine, 0);
  assert.strictEqual(res.recovered, false);
  assert.deepStrictEqual(res.value, api.freshMine());
});

test('a corrupt My posts cache resets only itself', () => {
  const { exports: api, gmStore } = loadUserscript();
  const org = api.freshOrganizer(1000);
  api.saveKey(api.STORAGE_KEYS.organizer, org);
  gmStore.set(api.STORAGE_KEYS.mine, '{not json');
  const mine = api.loadKey(api.STORAGE_KEYS.mine, api.normaliseMine, 0);
  assert.strictEqual(mine.recovered, true);
  assert.deepStrictEqual(api.loadKey(api.STORAGE_KEYS.organizer, api.normaliseOrganizer, 0).value, org);
});
```

Before writing the second test, `grep -n "gmStore" tests/storage.test.js` to see how existing tests write a raw unparseable value, and copy that idiom exactly if it differs from `gmStore.set(key, string)`.

- [ ] **Step 2: Run to verify they fail**

Run: `node --test tests/mine.test.js tests/storage.test.js`
Expected: FAIL, `api.mineThreadFromApi is not a function` and `STORAGE_KEYS.mine` undefined.

- [ ] **Step 3: Implement**

In `STORAGE_KEYS` add `mine: 'tfcc:mine',` after `postCache`.

In the engine constants (beside `POST_CACHE_MAX_POSTS`) add `var MINE_MAX_THREADS = 200;`.

Directly after `normaliseFeed`, add:

```js
  // -- my posts ---------------------------------------------------------------
  // Threads the key owner started (user/forumthreads) or posted in
  // (user/forumposts). Stored under its own key, tfcc:mine, because adding a
  // field to tfcc:feed would make loadKey report every existing user's feed
  // cache as damaged on the first load after upgrade.

  function pickList(data, names) {
    if (!isPlainObject(data)) return null;
    for (var i = 0; i < names.length; i += 1) {
      if (Array.isArray(data[names[i]])) return data[names[i]];
    }
    return null;
  }

  function freshMine() {
    return { v: SCHEMA_VERSION, fetchedAt: 0, selfId: 0, threads: [] };
  }

  function freshMineThread(id, now) {
    return {
      id: Math.max(0, toInt(id, 0)),
      forumId: 0,
      title: '',
      started: false,
      posted: false,
      myLastPostAt: 0,
      postsTotal: 0,
      totalKnown: false,
      lastPostAt: 0,
      lastPosterId: 0,
      infoAt: 0,
      baselineTotal: 0,
      firstSeenAt: Math.max(0, toInt(now, 0)),
      isLocked: false,
    };
  }

  // Reads only the shape freshMineThread produces. API rows go through
  // mineThreadFromApi first, so this never has to guess between two shapes.
  function normaliseMineThread(raw) {
    if (!isPlainObject(raw)) return null;
    var id = toInt(raw.id, 0);
    if (id <= 0) return null;
    var t = freshMineThread(id, 0);
    t.forumId = Math.max(0, toInt(raw.forumId, 0));
    t.title = safeString(raw.title, 300);
    t.started = raw.started === true;
    t.posted = raw.posted === true;
    t.myLastPostAt = Math.max(0, toInt(raw.myLastPostAt, 0));
    t.totalKnown = raw.totalKnown === true;
    t.postsTotal = t.totalKnown ? Math.max(0, toInt(raw.postsTotal, 0)) : 0;
    t.lastPostAt = Math.max(0, toInt(raw.lastPostAt, 0));
    t.lastPosterId = Math.max(0, toInt(raw.lastPosterId, 0));
    t.infoAt = Math.max(0, toInt(raw.infoAt, 0));
    t.baselineTotal = Math.max(0, toInt(raw.baselineTotal, 0));
    t.firstSeenAt = Math.max(0, toInt(raw.firstSeenAt, 0));
    t.isLocked = raw.isLocked === true;
    return t;
  }

  function normaliseMine(raw) {
    if (!isPlainObject(raw)) return freshMine();
    if (toInt(raw.v, 0) > SCHEMA_VERSION) return freshMine();
    var out = freshMine();
    out.fetchedAt = Math.max(0, toInt(raw.fetchedAt, 0));
    out.selfId = Math.max(0, toInt(raw.selfId, 0));
    if (Array.isArray(raw.threads)) {
      for (var i = 0; i < raw.threads.length && out.threads.length < MINE_MAX_THREADS; i += 1) {
        var t = normaliseMineThread(raw.threads[i]);
        if (t) out.threads.push(t);
      }
    }
    return out;
  }

  function mineThreadFromApi(raw) {
    if (!isPlainObject(raw)) return null;
    var id = toInt(raw.id, 0);
    if (id <= 0) return null;
    var author = isPlainObject(raw.author) ? raw.author : {};
    var last = isPlainObject(raw.last_poster) ? raw.last_poster : {};
    var total = -1;
    if (typeof raw.posts === 'number') total = toInt(raw.posts, -1);
    else if (isPlainObject(raw.posts) && raw.posts.total !== undefined) total = toInt(raw.posts.total, -1);
    return {
      id: id,
      forumId: Math.max(0, toInt(raw.forum_id, 0)),
      title: safeString(raw.title, 300),
      authorId: Math.max(0, toInt(author.id, 0)),
      postsTotal: Math.max(0, total),
      totalKnown: total >= 0,
      lastPostAt: secondsToMs(raw.last_post_time),
      lastPosterId: Math.max(0, toInt(last.id, 0)),
      isLocked: raw.is_locked === true,
    };
  }

  // The post body arrives in `content` and is deliberately never read.
  function minePostFromApi(raw) {
    if (!isPlainObject(raw)) return null;
    var threadId = toInt(raw.thread_id, 0);
    if (threadId <= 0) return null;
    var author = isPlainObject(raw.author) ? raw.author : {};
    return {
      postId: Math.max(0, toInt(raw.id, 0)),
      threadId: threadId,
      authorId: Math.max(0, toInt(author.id, 0)),
      at: secondsToMs(raw.created_time === undefined ? raw.timestamp : raw.created_time),
    };
  }
```

Check before relying on it: `grep -n "function secondsToMs" -A5` and `grep -n "function toInt" -A5` - confirm `secondsToMs(undefined)` returns 0 and `toInt(x, -1)` returns -1 for a non-number. If `toInt` clamps negatives, use `typeof` checks instead of the `-1` sentinel.

Runtime: add `mine: freshMine(),` to `state` after `postCache`, plus `refreshingMine: false,` and `mineError: null,`. In `loadAll` add
`var m = loadKey(STORAGE_KEYS.mine, normaliseMine, now);`, `state.mine = m.value;`, and `['My posts list', m]` to the damage-report array. In `persist`'s map add `mine: [STORAGE_KEYS.mine, state.mine],`. In the `reset-all` branch add `state.mine = freshMine(); state.mineError = null;` and `persist('mine');`.

- [ ] **Step 4: Run to verify they pass**

Run: `node --test tests/mine.test.js tests/storage.test.js && npm test && npm run test:syntax`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add torn-forum-command-center.user.js tests/mine.test.js tests/storage.test.js
git commit -m "feat: tfcc:mine record and normalisers for My posts (#2)"
```

---

### Task 3: Snapshot merge, thread detail, and the local baseline

**Files:**
- Modify: `torn-forum-command-center.user.js` - the `// -- my posts` engine section from Task 2.
- Test: `tests/mine.test.js`

**Interfaces:**
- Consumes: Task 2 records.
- Produces:
  - `parseThreadDetail(raw) -> { title, forumId, postsTotal, totalKnown, lastPostAt, lastPosterId, isLocked, isSticky } | null` (raw is `res.data.thread` from `forum/{id}/thread`; #4 reuses this)
  - `mergeMineSnapshot(prev, started, posts, now, complete) -> MineSnapshot` (`started` from `mineThreadFromApi`, `posts` from `minePostFromApi`; `complete` false keeps `prev.fetchedAt`)
  - `applyMineDetail(snap, threadId, detail, now) -> MineSnapshot`

- [ ] **Step 1: Write the failing tests**

Append to `tests/mine.test.js`:

```js
const T0 = 1700000000000;
const MIN = 60000;

function started(id, total, lastAt, lastPosterId) {
  return api.mineThreadFromApi({
    id, forum_id: 61, title: 'T' + id, posts: total,
    last_post_time: lastAt / 1000, author: { id: 7 }, last_poster: { id: lastPosterId },
  });
}
function post(threadId, at) {
  return api.minePostFromApi({ id: threadId * 10, thread_id: threadId, author: { id: 7 }, created_time: at / 1000 });
}

test('first sight sets the baseline, so installing never floods history as new', () => {
  const s = api.mergeMineSnapshot(api.freshMine(), [started(1, 40, T0, 99)], [], T0, true);
  const t = s.threads[0];
  assert.strictEqual(t.started, true);
  assert.strictEqual(t.postsTotal, 40);
  assert.strictEqual(t.baselineTotal, 40);
  assert.strictEqual(s.selfId, 7);
  assert.strictEqual(s.fetchedAt, T0);
});

test('a later fetch keeps the baseline, so new replies show as the difference', () => {
  const a = api.mergeMineSnapshot(api.freshMine(), [started(1, 40, T0, 99)], [], T0, true);
  const b = api.mergeMineSnapshot(a, [started(1, 43, T0 + MIN, 99)], [], T0 + MIN, true);
  assert.strictEqual(b.threads[0].postsTotal, 43);
  assert.strictEqual(b.threads[0].baselineTotal, 40);
});

test('when the last word is yours, the baseline catches up', () => {
  const a = api.mergeMineSnapshot(api.freshMine(), [started(1, 40, T0, 99)], [], T0, true);
  const b = api.mergeMineSnapshot(a, [started(1, 44, T0 + MIN, 7)], [], T0 + MIN, true);
  assert.strictEqual(b.threads[0].baselineTotal, 44, 'your own post is not an unread reply');
});

test('a posted-in thread has no total until a lookup supplies one', () => {
  const s = api.mergeMineSnapshot(api.freshMine(), [], [post(2, T0)], T0, true);
  const t = s.threads[0];
  assert.strictEqual(t.posted, true);
  assert.strictEqual(t.started, false);
  assert.strictEqual(t.totalKnown, false);
  assert.strictEqual(t.myLastPostAt, T0);
});

test('a lookup sets the total, first sight baselines it, and a later lookup shows the gap', () => {
  let s = api.mergeMineSnapshot(api.freshMine(), [], [post(2, T0)], T0, true);
  const detail = api.parseThreadDetail({ id: 2, forum_id: 5, title: 'Two', posts: 20, last_post_time: T0 / 1000 + 60, last_poster: { id: 99 } });
  s = api.applyMineDetail(s, 2, detail, T0 + MIN);
  assert.strictEqual(s.threads[0].totalKnown, true);
  assert.strictEqual(s.threads[0].baselineTotal, 20);
  assert.strictEqual(s.threads[0].forumId, 5);
  s = api.applyMineDetail(s, 2, Object.assign({}, detail, { postsTotal: 23 }), T0 + 2 * MIN);
  assert.strictEqual(s.threads[0].postsTotal, 23);
  assert.strictEqual(s.threads[0].baselineTotal, 20);
});

test('thread detail reads total, last poster and lock state', () => {
  const d = api.parseThreadDetail({ title: 'x', forum_id: 3, posts: 9, last_post_time: 100, last_poster: { id: 4 }, is_locked: true });
  assert.deepStrictEqual(d, { title: 'x', forumId: 3, postsTotal: 9, totalKnown: true, lastPostAt: 100000, lastPosterId: 4, isLocked: true, isSticky: false });
  assert.strictEqual(api.parseThreadDetail(null), null);
  assert.strictEqual(api.parseThreadDetail({ title: 'x' }).totalKnown, false);
});

test('a partial fetch does not reset the TTL clock', () => {
  const a = api.mergeMineSnapshot(api.freshMine(), [started(1, 4, T0, 7)], [], T0, true);
  const b = api.mergeMineSnapshot(a, [started(1, 4, T0, 7)], [], T0 + MIN, false);
  assert.strictEqual(b.fetchedAt, T0);
});

test('threads that drop out of the latest page are kept, newest first, up to the cap', () => {
  const a = api.mergeMineSnapshot(api.freshMine(), [], [post(1, T0), post(2, T0 + MIN)], T0, true);
  const b = api.mergeMineSnapshot(a, [], [post(3, T0 + 2 * MIN)], T0 + 2 * MIN, true);
  assert.deepStrictEqual(b.threads.map((t) => t.id), [3, 2, 1]);
  const many = [];
  for (let i = 1; i <= 250; i += 1) many.push(post(i, T0 + i));
  assert.strictEqual(api.mergeMineSnapshot(api.freshMine(), [], many, T0, true).threads.length, api.MINE_MAX_THREADS);
});

test('merging never mutates the snapshot it was given', () => {
  const a = api.mergeMineSnapshot(api.freshMine(), [started(1, 4, T0, 99)], [], T0, true);
  const frozen = JSON.stringify(a);
  api.mergeMineSnapshot(a, [started(1, 9, T0 + MIN, 7)], [post(2, T0)], T0 + MIN, true);
  api.applyMineDetail(a, 1, api.parseThreadDetail({ posts: 50 }), T0 + MIN);
  assert.strictEqual(JSON.stringify(a), frozen);
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `node --test tests/mine.test.js`
Expected: FAIL, `api.mergeMineSnapshot is not a function`.

- [ ] **Step 3: Implement**

Append to the `// -- my posts` section:

```js
  function parseThreadDetail(raw) {
    if (!isPlainObject(raw)) return null;
    var last = isPlainObject(raw.last_poster) ? raw.last_poster : {};
    var total = -1;
    if (typeof raw.posts === 'number') total = toInt(raw.posts, -1);
    else if (isPlainObject(raw.posts) && raw.posts.total !== undefined) total = toInt(raw.posts.total, -1);
    return {
      title: safeString(raw.title, 300),
      forumId: Math.max(0, toInt(raw.forum_id, 0)),
      postsTotal: Math.max(0, total),
      totalKnown: total >= 0,
      lastPostAt: secondsToMs(raw.last_post_time),
      lastPosterId: Math.max(0, toInt(last.id, 0)),
      isLocked: raw.is_locked === true,
      isSticky: raw.is_sticky === true,
    };
  }

  // First sight of a total sets the baseline, so the feature never reports a
  // user's whole posting history as unread on the day it is installed.
  function observeMineTotal(t, total, now) {
    if (!t.totalKnown) t.baselineTotal = total;
    t.postsTotal = total;
    t.totalKnown = true;
    t.infoAt = now;
  }

  // You do not have unread replies to a thread whose last word is yours.
  function advanceMineBaseline(t, selfId) {
    if (!t.totalKnown) return;
    var lastIsMine = (selfId > 0 && t.lastPosterId === selfId)
      || (t.lastPostAt > 0 && t.myLastPostAt >= t.lastPostAt);
    if (lastIsMine) t.baselineTotal = Math.max(t.baselineTotal, t.postsTotal);
  }

  function mineRecency(t) { return Math.max(t.myLastPostAt, t.lastPostAt); }

  function finishMine(out, byId, order) {
    var list = order.map(function (k) { return byId[k]; });
    list.sort(function (a, b) {
      var d = mineRecency(b) - mineRecency(a);
      return d !== 0 ? d : b.id - a.id;
    });
    out.threads = list.slice(0, MINE_MAX_THREADS);
    return out;
  }

  function mergeMineSnapshot(prev, started, posts, now, complete) {
    var t0 = toInt(now, 0);
    var base = normaliseMine(prev);
    var out = freshMine();
    out.fetchedAt = complete ? t0 : base.fetchedAt;
    out.selfId = base.selfId;
    var byId = {};
    var order = [];
    function rec(id) {
      var k = String(id);
      if (!Object.prototype.hasOwnProperty.call(byId, k)) {
        byId[k] = freshMineThread(id, t0);
        order.push(k);
      }
      return byId[k];
    }
    var i;
    for (i = 0; i < base.threads.length; i += 1) {
      var k0 = String(base.threads[i].id);
      byId[k0] = base.threads[i];
      order.push(k0);
    }
    for (i = 0; i < (started || []).length; i += 1) {
      var s = started[i];
      if (!s) continue;
      var r = rec(s.id);
      r.started = true;
      if (s.forumId) r.forumId = s.forumId;
      if (s.title) r.title = s.title;
      if (s.lastPostAt) r.lastPostAt = Math.max(r.lastPostAt, s.lastPostAt);
      if (s.lastPosterId) r.lastPosterId = s.lastPosterId;
      r.isLocked = s.isLocked === true;
      if (s.totalKnown) observeMineTotal(r, s.postsTotal, t0);
      if (!out.selfId && s.authorId) out.selfId = s.authorId;
    }
    for (i = 0; i < (posts || []).length; i += 1) {
      var p = posts[i];
      if (!p) continue;
      var rp = rec(p.threadId);
      rp.posted = true;
      rp.myLastPostAt = Math.max(rp.myLastPostAt, p.at);
      if (!out.selfId && p.authorId) out.selfId = p.authorId;
    }
    for (i = 0; i < order.length; i += 1) advanceMineBaseline(byId[order[i]], out.selfId);
    return finishMine(out, byId, order);
  }

  function applyMineDetail(snap, threadId, detail, now) {
    var out = normaliseMine(snap);
    if (!detail) return out;
    var id = toInt(threadId, 0);
    for (var i = 0; i < out.threads.length; i += 1) {
      var t = out.threads[i];
      if (t.id !== id) continue;
      if (detail.title && !t.title) t.title = detail.title;
      if (detail.forumId) t.forumId = detail.forumId;
      if (detail.lastPostAt) t.lastPostAt = Math.max(t.lastPostAt, detail.lastPostAt);
      if (detail.lastPosterId) t.lastPosterId = detail.lastPosterId;
      t.isLocked = detail.isLocked === true;
      if (detail.totalKnown) observeMineTotal(t, detail.postsTotal, toInt(now, 0));
      advanceMineBaseline(t, out.selfId);
    }
    return out;
  }
```

`normaliseMine(prev)` doubles as the deep clone, which is what makes the "never mutates" test pass.

- [ ] **Step 4: Run to verify they pass**

Run: `node --test tests/mine.test.js && npm test && npm run test:syntax`
Expected: PASS (purity included).

- [ ] **Step 5: Commit**

```bash
git add torn-forum-command-center.user.js tests/mine.test.js
git commit -m "feat: My posts snapshot merge and local unread baseline (#2)"
```

---

### Task 4: My posts rows in `mergeThreads`

**Files:**
- Modify: `torn-forum-command-center.user.js` - `ACTIVITY_SOURCES`, `resolveLastActivity`, `mergeThreads`, runtime `recompute`; new engine functions `mineUnreadFor`, `isOrganised` placed directly after `unreadFor`.
- Test: `tests/mine.test.js`, `tests/merge.test.js`

**Interfaces:**
- Consumes: `MineSnapshot`, `unreadFor(apiRow, entry)`.
- Produces:
  - `mineUnreadFor(apiRow, entry, rec) -> { tornUnread, postsTotal, lastSeenTotal, dismissed, unread, unreadSource }`, `unreadSource` in `'torn' | 'local' | 'unchecked'`
  - `isOrganised(entry, hasDraft) -> boolean`
  - `mergeThreads({ ..., mine })` rows gain `mineRole: 'started' | 'posted' | null`, `inThreads: boolean`, `unreadSource: 'torn' | 'local' | 'unchecked' | 'none'`
  - `resolveLastActivity(entry, feedAt, now, maxAgeMs, extra)` where `extra = { mineAt, ownPostAt }` is optional
  - `ACTIVITY_SOURCES = ['enriched', 'feed', 'mine', 'enriched-stale', 'own-post', 'visit', 'none']`

- [ ] **Step 1: Write the failing tests**

Append to `tests/mine.test.js`:

```js
function rec(over) {
  return Object.assign(api.freshMineThread(1, T0), { posted: true }, over || {});
}

test('a subscribed thread uses Torn count and dismissal, never a local count', () => {
  const entry = api.normaliseThreadEntry({ lastSeenTotal: 0 });
  const u = api.mineUnreadFor({ postsNew: 3, postsTotal: 12 }, entry, rec({ totalKnown: true, postsTotal: 50, baselineTotal: 10 }));
  assert.strictEqual(u.unread, 3);
  assert.strictEqual(u.unreadSource, 'torn');
});

test('an unsubscribed thread counts posts since the baseline or the last Mark read', () => {
  const r = rec({ totalKnown: true, postsTotal: 25, baselineTotal: 20 });
  assert.strictEqual(api.mineUnreadFor(null, api.normaliseThreadEntry(null), r).unread, 5);
  assert.strictEqual(api.mineUnreadFor(null, api.normaliseThreadEntry(null), r).unreadSource, 'local');
  assert.strictEqual(api.mineUnreadFor(null, api.normaliseThreadEntry({ lastSeenTotal: 24 }), r).unread, 1);
  assert.strictEqual(api.mineUnreadFor(null, api.normaliseThreadEntry({ lastSeenTotal: 25 }), r).unread, 0);
});

test('an unknown total is unchecked, not a checked zero', () => {
  const u = api.mineUnreadFor(null, api.normaliseThreadEntry(null), rec({ totalKnown: false }));
  assert.strictEqual(u.unread, 0);
  assert.strictEqual(u.unreadSource, 'unchecked');
});

test('only organising state counts as organised; a read marker or a visit does not', () => {
  assert.strictEqual(api.isOrganised(api.normaliseThreadEntry({ lastSeenTotal: 5, lastVisitedAt: 9 }), false), false);
  for (const e of [{ pinned: true }, { tags: ['x'] }, { folderId: 'guides' }, { priority: 1 }, { note: 'n' }, { archived: true }]) {
    assert.strictEqual(api.isOrganised(api.normaliseThreadEntry(e), false), true, JSON.stringify(e));
  }
  assert.strictEqual(api.isOrganised(api.normaliseThreadEntry(null), true), true, 'a draft is organising');
});
```

Append to `tests/merge.test.js`:

```js
function mineSnap(threads) {
  const s = api.freshMine();
  s.selfId = 7;
  s.threads = threads.map((t) => Object.assign(api.freshMineThread(t.id, NOW), t));
  return s;
}

test('My posts threads become rows with a role, outside Threads unless subscribed or organised', () => {
  const rows = api.mergeThreads({
    subscribed: [sub(1)],
    organizer: org({ 3: { pinned: true }, 4: { lastSeenTotal: 2, lastVisitedAt: NOW } }),
    mine: mineSnap([
      { id: 1, started: true, totalKnown: true, postsTotal: 10, baselineTotal: 10 },
      { id: 2, posted: true },
      { id: 3, posted: true },
      { id: 4, started: true },
    ]),
    now: NOW,
  });
  const by = Object.fromEntries(rows.map((r) => [r.id, r]));
  assert.strictEqual(by['1'].mineRole, 'started');
  assert.strictEqual(by['1'].inThreads, true, 'subscribed stays in Threads');
  assert.strictEqual(by['1'].unreadSource, 'torn');
  assert.strictEqual(by['2'].mineRole, 'posted');
  assert.strictEqual(by['2'].inThreads, false, 'a bare My posts thread must not flood Threads');
  assert.strictEqual(by['2'].unreadSource, 'unchecked');
  assert.strictEqual(by['3'].inThreads, true, 'pinning a My posts thread files it in Threads too');
  assert.strictEqual(by['4'].inThreads, false, 'a read marker or visit alone does not');
});

test('rows outside My posts keep their old shape and sources', () => {
  const rows = api.mergeThreads({ subscribed: [sub(1)], organizer: org({ 9: { note: 'x' } }), now: NOW });
  const by = Object.fromEntries(rows.map((r) => [r.id, r]));
  assert.strictEqual(by['1'].mineRole, null);
  assert.strictEqual(by['1'].inThreads, true);
  assert.strictEqual(by['1'].unreadSource, 'torn');
  assert.strictEqual(by['9'].inThreads, true);
  assert.strictEqual(by['9'].unreadSource, 'none');
});

test('a My posts row takes title, forum and activity from its record', () => {
  const rows = api.mergeThreads({
    mine: mineSnap([{ id: 5, posted: true, title: 'Mine', forumId: 61, lastPostAt: NOW - MIN, myLastPostAt: NOW - 2 * MIN }]),
    now: NOW,
  });
  assert.strictEqual(rows[0].title, 'Mine');
  assert.strictEqual(rows[0].forumId, 61);
  assert.strictEqual(rows[0].lastActivity, NOW - MIN);
  assert.strictEqual(rows[0].activitySource, 'mine');
});

test('only your own post time known reports own-post', () => {
  const rows = api.mergeThreads({ mine: mineSnap([{ id: 5, posted: true, myLastPostAt: NOW - MIN }]), now: NOW });
  assert.strictEqual(rows[0].activitySource, 'own-post');
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `node --test tests/mine.test.js tests/merge.test.js`
Expected: FAIL, `api.mineUnreadFor is not a function` and `mineRole` undefined.

- [ ] **Step 3: Implement**

`ACTIVITY_SOURCES` becomes:

```js
  var ACTIVITY_SOURCES = Object.freeze(['enriched', 'feed', 'mine', 'enriched-stale', 'own-post', 'visit', 'none']);
```

After `unreadFor`:

```js
  // A subscribed thread keeps Torn's own count, exactly as in Threads. Only a
  // thread Torn gives no count for is counted here, and an unknown total is
  // reported as unchecked so it can never pass for a thread checked and quiet.
  function mineUnreadFor(apiRow, entry, rec) {
    if (apiRow) {
      var u = unreadFor(apiRow, entry);
      u.unreadSource = 'torn';
      return u;
    }
    var seen = entry ? Math.max(0, toInt(entry.lastSeenTotal, 0)) : 0;
    if (!rec || !rec.totalKnown) {
      return { tornUnread: 0, postsTotal: 0, lastSeenTotal: seen, dismissed: false, unread: 0, unreadSource: 'unchecked' };
    }
    var unread = Math.max(0, rec.postsTotal - Math.max(seen, rec.baselineTotal));
    return {
      tornUnread: 0,
      postsTotal: rec.postsTotal,
      lastSeenTotal: seen,
      dismissed: rec.postsTotal > 0 && seen >= rec.postsTotal,
      unread: unread,
      unreadSource: 'local',
    };
  }

  // What pulls a My posts thread into Threads. A read marker and a visit
  // deliberately do not, or marking your own thread read would file it.
  function isOrganised(entry, hasDraft) {
    if (hasDraft) return true;
    if (!entry) return false;
    return !!(entry.folderId || entry.tags.length || entry.pinned || entry.priority !== 0
      || entry.note || entry.archived);
  }
```

In `resolveLastActivity`, add a fifth parameter `extra` and, after the `feedAt` candidate:

```js
    var x = extra || {};
    if (x.mineAt > 0) candidates.push({ at: x.mineAt, source: 'mine' });
    if (x.ownPostAt > 0) candidates.push({ at: x.ownPostAt, source: 'own-post' });
```

In `mergeThreads`:

1. Read the input: `var mine = (input && input.mine) || freshMine();` and build `var mineById = {};` from `mine.threads` keyed by `String(t.id)`.
2. After the `draftIds` loop, `for (i = 0; i < mine.threads.length; i += 1) ensure(mine.threads[i].id);`
3. In the row loop, before `unreadFor`:
   ```js
      var rec = Object.prototype.hasOwnProperty.call(mineById, id) ? mineById[id] : null;
      var u = rec ? mineUnreadFor(api, entry, rec) : unreadFor(api, entry);
      var unreadSource = rec ? u.unreadSource : (api ? 'torn' : 'none');
      var act = resolveLastActivity(entry, feedRow ? feedRow.at : 0, now, ttl,
        rec ? { mineAt: rec.lastPostAt, ownPostAt: rec.myLastPostAt } : null);
   ```
   (replace the existing `var u = unreadFor(api, entry);` and `var act = ...` lines; keep `feedRow` above them).
4. `forumId` falls back further: `(api && api.forumId) || entry.forumId || (rec && rec.forumId) || 0`.
5. In the pushed row: `title` gains `|| (rec && rec.title)` before the `'Thread ' + id` fallback; `firstSeenAt: entry.firstSeenAt || (rec ? rec.firstSeenAt : 0)`; `isLocked: entry.isLocked || !!(rec && rec.isLocked)`; and three new fields:
   ```js
        mineRole: rec ? (rec.started ? 'started' : 'posted') : null,
        inThreads: !!api || !rec || isOrganised(entry, !!draft),
        unreadSource: unreadSource,
   ```

`needsEnrich` stays `act.source !== 'enriched'`; `refreshAll` only enriches `r.subscribed` rows, so My posts rows never reach `enrichThreads`.

In runtime `recompute`, add `mine: state.mine,` to the `mergeThreads` input.

- [ ] **Step 4: Run to verify they pass**

Run: `node --test tests/mine.test.js tests/merge.test.js && npm test && npm run test:syntax`
Expected: PASS. If an existing `merge.test.js` assertion lists `ACTIVITY_SOURCES` literally, update it to the seven-item array; do not weaken any other assertion.

- [ ] **Step 5: Commit**

```bash
git add torn-forum-command-center.user.js tests/mine.test.js tests/merge.test.js
git commit -m "feat: merge My posts threads into rows with role and population (#2)"
```

---

### Task 5: `viewRows`, the `is:` terms, and keeping Threads and Catch up unchanged

**Files:**
- Modify: `torn-forum-command-center.user.js` - new engine `viewRows` after `catchUpList`; `termMatchesThread` `is:` branch; runtime `buildPanelModel`; `markall` branch in `makeHandlers`.
- Test: `tests/mine.test.js`, `tests/search.test.js`, `tests/panel.test.js`, `tests/handlers.test.js`

**Interfaces:**
- Consumes: rows with `mineRole`, `inThreads`, `unreadSource`.
- Produces:
  - `viewRows(rows, view, filters, query) -> rows`, `view` in `'threads' | 'mine'`, `filters = { unreadOnly, folderFilter, tagFilter }`. This is the single place #3's row cap will apply after `sortThreads`.
  - `buildPanelModel` adds `model.mine = { rows, total, unread, unchecked, fetchedAt, refreshing, error }`; `model.rows`, `totals`, `catchUp` and `allRows` use `inThreads` rows only.

- [ ] **Step 1: Write the failing tests**

Append to `tests/mine.test.js`:

```js
function row(over) {
  return Object.assign({
    id: '1', numericId: 1, title: 'T', authorName: 'a', forumName: 'f', note: '', tags: [],
    folderId: null, folderName: null, pinned: false, archived: false, unread: 0,
    hasDraft: false, subscribed: false, lastVisitedAt: 0, mineRole: null, inThreads: true,
    unreadSource: 'none',
  }, over);
}

test('each view picks its own population', () => {
  const rows = [row({ id: '1' }), row({ id: '2', mineRole: 'posted', inThreads: false }), row({ id: '3', mineRole: 'started', inThreads: true })];
  const q = api.parseQuery('');
  assert.deepStrictEqual(api.viewRows(rows, 'threads', {}, q).map((r) => r.id), ['1', '3']);
  assert.deepStrictEqual(api.viewRows(rows, 'mine', {}, q).map((r) => r.id), ['2', '3']);
});

test('Unread only in My posts keeps only threads with new replies', () => {
  const rows = [
    row({ id: '1', mineRole: 'posted', inThreads: false, unread: 2, unreadSource: 'local' }),
    row({ id: '2', mineRole: 'posted', inThreads: false, unread: 0, unreadSource: 'local' }),
    row({ id: '3', mineRole: 'posted', inThreads: false, unread: 0, unreadSource: 'unchecked' }),
  ];
  assert.deepStrictEqual(api.viewRows(rows, 'mine', { unreadOnly: true }, api.parseQuery('')).map((r) => r.id), ['1']);
});

test('folder, tag, archive and the filter box apply in My posts exactly as in Threads', () => {
  const rows = [
    row({ id: '1', mineRole: 'started', folderId: 'g', tags: ['x'], authorName: 'bob' }),
    row({ id: '2', mineRole: 'started', archived: true }),
    row({ id: '3', mineRole: 'started', folderId: 'h' }),
  ];
  const all = api.parseQuery('');
  assert.deepStrictEqual(api.viewRows(rows, 'mine', { folderFilter: 'g' }, all).map((r) => r.id), ['1']);
  assert.deepStrictEqual(api.viewRows(rows, 'mine', { tagFilter: 'x' }, all).map((r) => r.id), ['1']);
  assert.deepStrictEqual(api.viewRows(rows, 'mine', {}, api.parseQuery('by:bob')).map((r) => r.id), ['1']);
  assert.ok(api.viewRows(rows, 'mine', {}, all).every((r) => r.id !== '2'), 'archived and quiet stays hidden');
});
```

Append to `tests/search.test.js` (its `row()` helper builds a row; pass the new fields through its override argument - check its signature with `grep -n "function row" -A12 tests/search.test.js` first):

```js
test('is:started and is:posted pick My posts roles and are false elsewhere', () => {
  const s = row({ mineRole: 'started' });
  const p = row({ mineRole: 'posted' });
  const n = row({ mineRole: null });
  const started = api.parseQuery('is:started');
  const posted = api.parseQuery('is:posted');
  assert.deepStrictEqual([s, p, n].map((r) => api.matchThread(r, started)), [true, false, false]);
  assert.deepStrictEqual([s, p, n].map((r) => api.matchThread(r, posted)), [false, true, false]);
  assert.strictEqual(api.matchThread(n, api.parseQuery('-is:posted')), true);
});
```

Append to `tests/panel.test.js`:

```js
function seedMine(env) {
  const api = env.exports;
  const s = api.freshMine();
  s.selfId = 7;
  s.fetchedAt = NOW;
  s.threads = [
    Object.assign(api.freshMineThread(50, NOW), { posted: true, title: 'Reply thread', totalKnown: true, postsTotal: 12, baselineTotal: 10 }),
    Object.assign(api.freshMineThread(51, NOW), { started: true, title: 'My guide', totalKnown: true, postsTotal: 5, baselineTotal: 5 }),
    Object.assign(api.freshMineThread(52, NOW), { posted: true, title: 'Unchecked thread' }),
  ];
  api.state.mine = s;
  api.recompute(NOW);
}

test('My posts-only threads stay out of Threads, Catch up and the header count', () => {
  const env = loadUserscript({ location: forums() });
  seed(env, [{ id: 1, unread: 3 }]);
  seedMine(env);
  env.exports.state.settings.view = 'threads';
  const model = env.exports.buildPanelModel(NOW);
  assert.deepStrictEqual(model.rows.map((r) => r.id), ['1']);
  assert.strictEqual(model.totals.unread, 3, 'the header badge counts Threads only');
  assert.ok(model.catchUp.every((r) => r.id !== '50'));
  assert.strictEqual(model.mine.unread, 1);
  assert.strictEqual(model.mine.unchecked, 1);
  assert.strictEqual(model.mine.total, 3);
});

test('the My posts model lists its own population, and Unread only narrows it', () => {
  const env = loadUserscript({ location: forums() });
  seed(env, [{ id: 1, unread: 3 }]);
  seedMine(env);
  env.exports.state.settings.view = 'mine';
  assert.deepStrictEqual(env.exports.buildPanelModel(NOW).rows.map((r) => r.id).sort(), ['50', '51', '52']);
  env.exports.state.settings.unreadOnly = true;
  assert.deepStrictEqual(env.exports.buildPanelModel(NOW).rows.map((r) => r.id), ['50']);
});
```

Append to `tests/handlers.test.js` (use the file's existing pattern for invoking `onAction`; `grep -n "onAction" tests/handlers.test.js` and copy how an element stub with `getAttribute` is built):

```js
test('Mark all read writes no marker for a My posts-only thread', () => {
  const env = loadUserscript({ location: forums(), now: NOW });
  const api = env.exports;
  api.state.feed.subscribed = [api.normaliseSubscribedRow({ id: 1, forum_id: 61, title: 'A', author: { id: 3, username: 's' }, posts: { new: 2, total: 10 } })];
  const s = api.freshMine();
  s.threads = [Object.assign(api.freshMineThread(50, NOW), { posted: true, totalKnown: true, postsTotal: 12, baselineTotal: 10 })];
  api.state.mine = s;
  api.recompute(NOW);
  const handlers = api.makeHandlers(env.doc, env.win);
  handlers.onAction('markall', { getAttribute: () => null });
  assert.ok(api.state.organizer.threads['1'], 'the Threads row is marked');
  assert.strictEqual(api.state.organizer.threads['50'], undefined, 'the My posts row is untouched');
});
```

If `makeHandlers` is not in `EXPORT_NAMES`, add it in this task (grep first).

- [ ] **Step 2: Run to verify they fail**

Run: `node --test tests/mine.test.js tests/search.test.js tests/panel.test.js tests/handlers.test.js`
Expected: FAIL, `api.viewRows is not a function`, `model.mine` undefined, organiser entry `50` present.

- [ ] **Step 3: Implement**

In `termMatchesThread`'s `is` branch, before `return false;`:

```js
      if (v === 'started') return row.mineRole === 'started';
      if (v === 'posted') return row.mineRole === 'posted';
```

After `catchUpList`:

```js
  // Every list view's population and filters, in one place. sortThreads runs
  // after this, and a row cap (issue #3) goes after that, so the user always
  // sees the top N of what they asked for.
  function viewRows(rows, view, filters, query) {
    var f = filters || {};
    return rows.filter(function (r) {
      if (view === 'mine' ? !r.mineRole : !r.inThreads) return false;
      if (r.archived && !r.pinned && r.unread === 0) return false;
      if (f.unreadOnly && r.unread === 0) return false;
      if (f.folderFilter && r.folderId !== f.folderFilter) return false;
      if (f.tagFilter && r.tags.indexOf(f.tagFilter) === -1) return false;
      return matchThread(r, query);
    });
  }
```

In `buildPanelModel`, replace the inline `visible` filter and the totals loop with:

```js
    var threadRows = rows.filter(function (r) { return r.inThreads; });
    var mineAll = viewRows(rows, 'mine', {}, parseQuery(''));
    var visible = viewRows(rows, s.view === 'mine' ? 'mine' : 'threads', s, query);

    var totalUnread = 0;
    for (var i = 0; i < threadRows.length; i += 1) totalUnread += threadRows[i].unread;
```

and in the returned object: `allRows: threadRows`; `totals.threads: threadRows.length`; `totals.subscribed` filters `threadRows`; `catchUp: sortThreads(catchUpList(threadRows, state.organizer.lastCatchUpAt), 'activity')`; and add:

```js
      mine: {
        total: mineAll.length,
        unread: mineAll.filter(function (r) { return r.unread > 0; }).length,
        unchecked: mineAll.filter(function (r) { return r.unreadSource === 'unchecked'; }).length,
        fetchedAt: state.mine.fetchedAt,
        refreshing: state.refreshingMine,
        error: state.mineError,
      },
```

Before changing `allRows`, `grep -n "allRows" torn-forum-command-center.user.js` and confirm every consumer means "the Threads population" (Search metadata). If one does not, stop and amend this plan.

In the `markall` branch, iterate only `inThreads` rows:

```js
          for (var i = 0; i < state.rows.length; i += 1) {
            if (!state.rows[i].inThreads) continue;
            state.organizer = markRead(state.organizer, state.rows[i].id, state.rows[i].postsTotal, now);
          }
```

- [ ] **Step 4: Run to verify they pass**

Run: `npm test && npm run test:syntax`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add torn-forum-command-center.user.js tests/mine.test.js tests/search.test.js tests/panel.test.js tests/handlers.test.js tests/load-userscript.js
git commit -m "feat: viewRows picks each view's population; is:started and is:posted (#2)"
```

---

### Task 6: `refreshMine` - the bounded fetch

**Files:**
- Modify: `torn-forum-command-center.user.js` - runtime constants beside `DEFAULT_ENRICH_BUDGET`; engine `mineLookupTargets` and `mineIsDue` at the end of the `// -- my posts` section; runtime `refreshMine` and `enrichMine` directly after `enrichThreads`.
- Create: `tests/mine-refresh.test.js`
- Modify: `tests/staleness.test.js`, `tests/read-only.test.js`, `tests/api.test.js`

**Interfaces:**
- Consumes: `tornApiGet(path, params, options)`, `mergeMineSnapshot`, `applyMineDetail`, `parseThreadDetail`, `pickList`.
- Produces:
  - `MINE_TTL_MS = 15 * 60 * 1000`, `MINE_PAGE_LIMIT = 100`
  - `mineLookupTargets(snap, subscribed, budget, now, ttl) -> number[]`
  - `mineIsDue(snap, now, ttl) -> boolean`
  - `refreshMine(now, opts) -> Promise<{ ok, reason?, detail? }>`; never rejects; sets `state.mineError`; persists `mine`; calls `recompute(now)`.

- [ ] **Step 1: Write the failing tests**

Create `tests/mine-refresh.test.js`. `settle` and `boot` follow `tests/refresh.test.js` (file-local there); `router` additionally records full URLs so the `limit` parameter can be asserted:

```js
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const {
  loadUserscript, FORUMS_LOCATION, subscribedThreadsPayload, forumFeedPayload,
  forumThreadsPayload, forumPostsPayload,
} = require('./load-userscript');

const KEY = 'abcdefghij123456';
const NOW = 1700000000000;

async function settle(env, ms) {
  const step = ms === undefined ? 1000 : ms;
  for (let round = 0; round < 40; round += 1) {
    for (let i = 0; i < 15; i += 1) await Promise.resolve();
    env.advanceTimersBy(step);
  }
  for (let i = 0; i < 20; i += 1) await Promise.resolve();
}

function router(table) {
  const seen = [];
  const urls = [];
  return {
    seen,
    urls,
    fetch(url) {
      urls.push(url);
      const path = url.replace('https://api.torn.com/v2/', '').split('?')[0];
      seen.push(path);
      const body = Object.prototype.hasOwnProperty.call(table, path) ? table[path] : { error: { code: 6, error: 'Unknown' } };
      return Promise.resolve({ status: 200, text: () => Promise.resolve(JSON.stringify(body)) });
    },
  };
}

function boot(table, options) {
  const r = router(table);
  const env = loadUserscript(Object.assign({
    location: FORUMS_LOCATION,
    now: NOW,
    gmStore: [['tfcc:key', KEY]],
    fetch: r.fetch,
  }, options || {}));
  env.router = r;
  return env;
}

const BASE = {
  'user/forumsubscribedthreads': subscribedThreadsPayload([{ id: 1 }]),
  'user/forumfeed': forumFeedPayload([]),
  'forum/categories': { categories: [{ id: 61, title: 'Tutorials', acronym: 'TG' }] },
};

function mineTable(extra) {
  const t = Object.assign({}, BASE, {
    'user/forumthreads': forumThreadsPayload([{ id: 10, total: 4 }]),
    'user/forumposts': forumPostsPayload([{ id: 1, threadId: 20 }, { id: 2, threadId: 21 }]),
    'forum/20/thread': { thread: { id: 20, forum_id: 61, title: 'Twenty', posts: 30, last_post_time: 1600000300, last_poster: { id: 99 } } },
    'forum/21/thread': { thread: { id: 21, forum_id: 61, title: 'TwentyOne', posts: 8, last_post_time: 1600000400, last_poster: { id: 7 } } },
  });
  return Object.assign(t, extra || {});
}

async function bootAndClear(table, options) {
  const env = boot(table, options);
  await settle(env);
  env.router.seen.length = 0;   // drop init's Threads refresh
  return env;
}

function mineCalls(env) {
  return env.router.seen.filter((u) => /^user\/forum(threads|posts)$|^forum\/\d+\/thread$|^forum\/categories$/.test(u));
}

test('a My posts fetch is two lists then lookups, and never the category list', async () => {
  const env = await bootAndClear(mineTable());
  env.exports.refreshMine(NOW);
  await settle(env);
  assert.deepStrictEqual(mineCalls(env), ['user/forumthreads', 'user/forumposts', 'forum/20/thread', 'forum/21/thread']);
  const mine = env.exports.state.mine;
  assert.strictEqual(mine.fetchedAt, NOW);
  assert.strictEqual(mine.threads.length, 3);
  assert.strictEqual(env.exports.state.mineError, null);
});

test('both lists ask for one page of the agreed size', async () => {
  const env = await bootAndClear(mineTable());
  env.router.urls.length = 0;
  env.exports.refreshMine(NOW);
  await settle(env);
  const lists = env.router.urls.filter((u) => /user\/forum(threads|posts)\?/.test(u));
  assert.strictEqual(lists.length, 2);
  for (const u of lists) assert.match(u, /[?&]limit=100(&|$)/);
});

test('with the default budget a fetch is at most 12 requests', async () => {
  const posts = [];
  for (let i = 0; i < 30; i += 1) posts.push({ id: i + 1, threadId: 100 + i });
  const table = mineTable({ 'user/forumposts': forumPostsPayload(posts) });
  for (let i = 0; i < 30; i += 1) table['forum/' + (100 + i) + '/thread'] = { thread: { id: 100 + i, posts: 3 } };
  const env = await bootAndClear(table);
  env.exports.refreshMine(NOW);
  await settle(env);
  assert.strictEqual(mineCalls(env).length, 12);
});

test('a budget of zero makes exactly two requests and leaves posted-in threads unchecked', async () => {
  const env = await bootAndClear(mineTable());
  env.exports.state.settings.enrichBudget = 0;
  env.exports.refreshMine(NOW);
  await settle(env);
  assert.deepStrictEqual(mineCalls(env), ['user/forumthreads', 'user/forumposts']);
  const r20 = env.exports.state.rows.find((r) => r.id === '20');
  assert.strictEqual(r20.unreadSource, 'unchecked');
});

test('a thread looked up within the TTL is not looked up again', async () => {
  const env = await bootAndClear(mineTable());
  env.exports.refreshMine(NOW);
  await settle(env);
  env.router.seen.length = 0;
  env.exports.refreshMine(NOW + 60000);
  await settle(env);
  assert.deepStrictEqual(mineCalls(env), ['user/forumthreads', 'user/forumposts']);
});

test('a second fetch while one runs is dropped', async () => {
  const env = await bootAndClear(mineTable());
  env.exports.refreshMine(NOW);
  const second = await env.exports.refreshMine(NOW);
  assert.strictEqual(second.reason, 'inflight');
  await settle(env);
  assert.strictEqual(mineCalls(env).filter((u) => u === 'user/forumthreads').length, 1);
});

test('a failed thread list is a named error and keeps the saved list', async () => {
  const good = await bootAndClear(mineTable());
  good.exports.refreshMine(NOW);
  await settle(good);
  const saved = JSON.stringify(good.exports.state.mine);
  const before = good.exports.state.mine.threads.length;

  const bad = await bootAndClear(
    mineTable({ 'user/forumthreads': { error: { code: 17, error: 'Backend error' } } }),
    { gmStore: [['tfcc:key', KEY], ['tfcc:mine', saved]] },
  );
  const p = bad.exports.refreshMine(NOW + 20 * 60000);
  await settle(bad);
  const res = await p;
  assert.strictEqual(res.ok, false);
  assert.ok(bad.exports.state.mineError && bad.exports.state.mineError.detail);
  assert.strictEqual(bad.exports.state.mine.threads.length, before, 'the saved list survives');
  assert.deepStrictEqual(mineCalls(bad), ['user/forumthreads'], 'nothing after a failed first list');
});

test('a failed post list keeps the started threads, warns, and does not reset the TTL', async () => {
  const env = await bootAndClear(mineTable({ 'user/forumposts': { error: { code: 17, error: 'Backend error' } } }));
  const p = env.exports.refreshMine(NOW);
  await settle(env);
  const res = await p;
  assert.strictEqual(res.ok, false);
  assert.ok(env.exports.state.mine.threads.some((t) => t.id === 10));
  assert.strictEqual(env.exports.state.mine.fetchedAt, 0);
  assert.match(env.exports.state.mineError.detail, /posted in/);
});

test('an unrecognised response shape is a named parse error, not an empty list', async () => {
  const env = await bootAndClear(mineTable({ 'user/forumthreads': { surprise: [] } }));
  const p = env.exports.refreshMine(NOW);
  await settle(env);
  const res = await p;
  assert.strictEqual(res.reason, 'parse');
  assert.match(env.exports.state.mineError.detail, /shape/);
});

test('no key means no My posts request', async () => {
  const env = await bootAndClear(mineTable(), { gmStore: [] });
  env.exports.refreshMine(NOW);
  await settle(env);
  assert.deepStrictEqual(mineCalls(env), []);
});

test('the TTL decides whether opening the view fetches', () => {
  const { exports: api } = loadUserscript();
  const s = api.freshMine();
  assert.strictEqual(api.mineIsDue(s, NOW, api.MINE_TTL_MS), true, 'never fetched is due');
  s.fetchedAt = NOW;
  assert.strictEqual(api.mineIsDue(s, NOW + 14 * 60000, api.MINE_TTL_MS), false);
  assert.strictEqual(api.mineIsDue(s, NOW + 15 * 60000, api.MINE_TTL_MS), true);
  assert.strictEqual(api.MINE_TTL_MS, 15 * 60 * 1000, 'the Settings text promises 15 minutes');
});
```

Check `makeSandbox` in `tests/load-userscript.js` for how a `gmStore` entry is stored (raw JSON string vs parsed value) and match it in the `tfcc:mine` seed above.

Append to `tests/staleness.test.js`. The file's `gatedTransport` holds only the first call, which is `init`'s Threads refresh; this one holds a named path instead:

```js
const { forumThreadsPayload, forumPostsPayload } = require('./load-userscript');

function gatedOn(table, heldPath) {
  let release = null;
  const gate = new Promise((r) => { release = r; });
  return {
    release: () => release(),
    fetch(url) {
      const path = url.replace('https://api.torn.com/v2/', '').split('?')[0];
      const body = Object.prototype.hasOwnProperty.call(table, path)
        ? table[path] : { error: { code: 6, error: 'Unknown' } };
      const answer = { status: 200, text: () => Promise.resolve(JSON.stringify(body)) };
      return path === heldPath ? gate.then(() => answer) : Promise.resolve(answer);
    },
  };
}

test('a reset while My posts is loading drops the late answer', async () => {
  const table = Object.assign({}, TABLE, {
    'user/forumthreads': forumThreadsPayload([{ id: 10, total: 4 }]),
    'user/forumposts': forumPostsPayload([{ id: 1, threadId: 20 }]),
  });
  const t = gatedOn(table, 'user/forumthreads');
  const env = loadUserscript({ location: forums(), now: NOW, gmStore: [['tfcc:key', KEY]], fetch: t.fetch });
  const api = env.exports;
  await settle(env);                       // init's Threads refresh completes

  api.refreshMine(NOW);
  await settle(env);                       // now held on user/forumthreads
  api.makeHandlers(env.doc, env.win).onAction('reset-all', { getAttribute: () => null });

  t.release();
  await settle(env);
  assert.strictEqual(api.state.mine.threads.length, 0, 'a late answer refilled what the user wiped');
  const stored = env.gmStore.get('tfcc:mine');
  assert.ok(!stored || JSON.parse(stored).threads.length === 0, 'and wrote it back to storage');
});
```

In `tests/read-only.test.js`, extend `a refresh cannot exceed the request budget the panel promises`:

```js
  const mineWorst = 2 + api.MAX_ENRICH_BUDGET;
  assert.ok(mineWorst <= api.REQUESTS_PER_WINDOW, 'the worst-case My posts fetch must fit inside one minute');
  assert.strictEqual(2 + 10, 12, 'the default My posts fetch the Settings text promises');
```

In `tests/api.test.js` (its `settle`, `jsonTransport` and `KEY` are file-level):

```js
test('a My posts failure never carries the key, in the result, the error or the cache', async () => {
  const transports = [
    ['http', jsonTransport({}, 503)],
    ['parse', jsonTransport('not json')],
    ['shape', jsonTransport({ surprise: [] })],
    ['torn', jsonTransport({ error: { code: 17, error: 'bad' } })],
    ['network', { fetch: () => Promise.reject(new Error('failed for https://api.torn.com/v2/user/forumthreads?key=' + KEY)) }],
  ];
  for (const [label, transport] of transports) {
    const env = loadUserscript(Object.assign({ gmStore: [['tfcc:key', KEY]] }, transport));
    const p = env.exports.refreshMine(1700000000000);
    await settle(env, 1000);
    const res = await p;
    const blob = JSON.stringify([res, env.exports.state.mineError, env.exports.state.mine]);
    assert.strictEqual(blob.indexOf(KEY), -1, label + ' leaked the key: ' + blob);
    assert.notStrictEqual(env.exports.state.mineError, null, label + ' must be reported, not swallowed');
  }
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `node --test tests/mine-refresh.test.js tests/staleness.test.js tests/read-only.test.js tests/api.test.js`
Expected: FAIL, `refreshMine is not a function`.

- [ ] **Step 3: Implement**

Runtime constants, beside `DEFAULT_ENRICH_BUDGET`:

```js
  var MINE_TTL_MS = 15 * 60 * 1000;
  var MINE_PAGE_LIMIT = 100;
```

Engine, end of `// -- my posts`:

```js
  function mineIsDue(snap, now, ttl) {
    var f = snap ? toInt(snap.fetchedAt, 0) : 0;
    return f <= 0 || (toInt(now, 0) - f) >= ttl;
  }

  // Lookups go only to threads Torn gives no count for, whose total is unknown
  // or older than the TTL, newest conversation first, inside the same budget
  // setting Threads uses.
  function mineLookupTargets(snap, subscribed, budget, now, ttl) {
    var n = clamp(toInt(budget, 0), 0, MAX_ENRICH_BUDGET);
    if (!n || !snap) return [];
    var subs = {};
    for (var i = 0; i < (subscribed || []).length; i += 1) subs[String(subscribed[i].id)] = true;
    var t = toInt(now, 0);
    var out = [];
    for (var j = 0; j < snap.threads.length && out.length < n; j += 1) {
      var r = snap.threads[j];
      if (subs[String(r.id)]) continue;
      if (r.totalKnown && (t - r.infoAt) < ttl) continue;
      out.push(r.id);
    }
    return out;
  }
```

`MAX_ENRICH_BUDGET` is declared above the engine section, as `DEFAULT_ENRICH_BUDGET` already is and is already used by `settingsDefaults`, so this stays pure.

Runtime, after `enrichThreads`:

```js
  var MINE_SHAPE_THREADS = 'Torn\'s answer for your threads was not in the shape this version expects.';
  var MINE_SHAPE_POSTS = 'Torn\'s answer for your posts was not in the shape this version expects.';

  function enrichMine(ids, now, opts, generation) {
    function step(i) {
      if (i >= ids.length) return Promise.resolve({ ok: true });
      return tornApiGet('forum/' + ids[i] + '/thread', {}, opts).then(function (res) {
        if (generation !== state.generation) return { ok: false, reason: 'stale' };
        if (res.ok && res.data && isPlainObject(res.data.thread)) {
          state.mine = applyMineDetail(state.mine, ids[i], parseThreadDetail(res.data.thread), now);
        } else if (res.reason === 'throttled') {
          return { ok: true, stoppedEarly: true };
        }
        return step(i + 1);
      });
    }
    return step(0);
  }

  // A separate, bounded action for the My posts view only: two lists and at
  // most enrichBudget lookups, never the category list. Threads' refresh and
  // auto refresh never call this.
  function refreshMine(now, opts) {
    var options = opts || {};
    if (state.refreshingMine) return Promise.resolve({ ok: false, reason: 'inflight' });
    state.refreshingMine = true;
    var generation = state.generation;
    var budget = clamp(toInt(state.settings.enrichBudget, DEFAULT_ENRICH_BUDGET), 0, MAX_ENRICH_BUDGET);
    var params = { limit: MINE_PAGE_LIMIT };
    var started = null;

    function stale() { return generation !== state.generation; }
    function fail(res, fallback) {
      state.mineError = { reason: (res && res.reason) || 'network', detail: scrubDetail((res && res.detail) || fallback) };
      return { ok: false, reason: state.mineError.reason, detail: state.mineError.detail };
    }

    var work = tornApiGet('user/forumthreads', params, options)
      .then(function (res) {
        if (stale()) return { ok: false, reason: 'stale' };
        if (!res.ok) return fail(res, 'Could not load your threads.');
        var list = pickList(res.data, ['forumThreads', 'forum_threads', 'threads']);
        if (!list) return fail({ reason: 'parse', detail: MINE_SHAPE_THREADS });
        started = list.map(mineThreadFromApi).filter(Boolean);
        return tornApiGet('user/forumposts', params, options).then(function (pres) {
          if (stale()) return { ok: false, reason: 'stale' };
          var complete = false;
          var posts = [];
          var outcome = { ok: true };
          if (!pres.ok) {
            outcome = fail(pres, 'Could not load your posts.');
            state.mineError.detail = 'Threads you posted in could not be loaded: ' + state.mineError.detail;
            outcome.detail = state.mineError.detail;
          } else {
            var plist = pickList(pres.data, ['forumPosts', 'forum_posts', 'posts']);
            if (!plist) {
              outcome = fail({ reason: 'parse', detail: MINE_SHAPE_POSTS });
            } else {
              posts = plist.map(minePostFromApi).filter(Boolean);
              complete = true;
              state.mineError = null;
            }
          }
          state.mine = mergeMineSnapshot(state.mine, started, posts, now, complete);
          var ids = mineLookupTargets(state.mine, state.feed.subscribed, budget, now, MINE_TTL_MS);
          return enrichMine(ids, now, options, generation).then(function () { return outcome; });
        });
      })
      .then(function (res) {
        if (!stale()) {
          persist('mine');
          recompute(now);
        }
        return res;
      })
      .catch(function (e) {
        return fail({ reason: 'network', detail: e && e.message }, 'My posts could not be loaded.');
      });

    return work.then(function (r) {
      state.refreshingMine = false;
      return r;
    });
  }
```

Check `refreshAll`'s handling of `persist` after a stale result and mirror it: the stale branch must write nothing.

Add `'refreshMine'` and `'makeHandlers'` to `EXPORT_NAMES` if Task 1 or 5 did not.

- [ ] **Step 4: Run to verify they pass**

Run: `npm test && npm run test:syntax`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add torn-forum-command-center.user.js tests/mine-refresh.test.js tests/staleness.test.js tests/read-only.test.js tests/api.test.js tests/load-userscript.js
git commit -m "feat: bounded My posts fetch with TTL, budget and staleness guard (#2)"
```

---

### Task 7: When My posts fetches - opening the view and Refresh

**Files:**
- Modify: `torn-forum-command-center.user.js` - `view` and `refresh` branches in `makeHandlers.onAction`.
- Test: `tests/mine-refresh.test.js`

**Interfaces:**
- Consumes: `refreshMine`, `mineIsDue`, `MINE_TTL_MS`.
- Produces: opening My posts fetches once per TTL; Refresh in My posts runs `refreshMine` only; Refresh elsewhere runs `refreshAll` only; `init` and auto refresh unchanged.

- [ ] **Step 1: Write the failing tests**

Append to `tests/mine-refresh.test.js`:

```js
function el(attrs) { return { getAttribute: (k) => (attrs[k] === undefined ? null : attrs[k]) }; }

test('opening My posts fetches once, and reopening inside the TTL does not', async () => {
  const env = await bootAndClear(mineTable());
  const h = env.exports.makeHandlers(env.doc, env.win);
  h.onAction('view', el({ 'data-view': 'mine' }));
  await settle(env);
  assert.strictEqual(mineCalls(env).filter((u) => u === 'user/forumthreads').length, 1);
  h.onAction('view', el({ 'data-view': 'threads' }));
  h.onAction('view', el({ 'data-view': 'mine' }));
  await settle(env);
  assert.strictEqual(mineCalls(env).filter((u) => u === 'user/forumthreads').length, 1);
});

test('Refresh in My posts fetches My posts only; Refresh in Threads never does', async () => {
  const env = await bootAndClear(mineTable());
  const h = env.exports.makeHandlers(env.doc, env.win);
  env.exports.state.settings.view = 'mine';
  env.exports.state.mine.fetchedAt = NOW;
  h.onAction('refresh', el({}));
  await settle(env);
  assert.ok(env.router.seen.includes('user/forumthreads'), 'Refresh bypasses the TTL');
  assert.ok(!env.router.seen.includes('user/forumsubscribedthreads'));
  env.router.seen.length = 0;
  env.exports.state.settings.view = 'threads';
  h.onAction('refresh', el({}));
  await settle(env);
  assert.ok(env.router.seen.includes('user/forumsubscribedthreads'));
  assert.ok(!env.router.seen.includes('user/forumthreads'));
});

test('loading the page with My posts open does not fetch My posts', async () => {
  const env = boot(mineTable(), { gmStore: [['tfcc:key', KEY], ['tfcc:settings', JSON.stringify({ v: 1, view: 'mine' })]] });
  await settle(env);
  assert.ok(!env.router.seen.includes('user/forumthreads'));
});
```

`api.makeHandlers(env.doc, env.win)` with a `getAttribute` element stub is the idiom `tests/handlers.test.js` already uses.

- [ ] **Step 2: Run to verify they fail**

Run: `node --test tests/mine-refresh.test.js`
Expected: FAIL on the first two tests.

- [ ] **Step 3: Implement**

`refresh` branch:

```js
        if (act === 'refresh') {
          state.notices = [];
          var run = state.settings.view === 'mine' ? refreshMine(now) : refreshAll(now);
          run.then(function () { if (isForumsPage(win.location)) redraw(); });
          redraw();
          return;
        }
```

`view` branch:

```js
        if (act === 'view') {
          var v = el.getAttribute('data-view');
          if (VIEWS.indexOf(v) !== -1) { state.settings.view = v; persist('settings'); }
          // Opening My posts is the user input that pays for it, once per TTL.
          if (v === 'mine' && isKeyShaped(loadApiKey()) && mineIsDue(state.mine, now, MINE_TTL_MS)) {
            refreshMine(now).then(function () { if (isForumsPage(win.location)) redraw(); });
          }
          redraw(); return;
        }
```

`VIEWS` gains `'mine'` in Task 8; until then the `view` test fails on `VIEWS.indexOf`. Do Step 3 of Task 8's first sub-step now: change `VIEWS` to

```js
  var VIEWS = Object.freeze(['threads', 'catchup', 'search', 'drafts', 'settings', 'mine']);
```

and in `panelHtml` add `else if (model.view === 'mine') out.push(renderThreadsView(model));` as a temporary route (Task 8 replaces it).

- [ ] **Step 4: Run to verify they pass**

Run: `npm test && npm run test:syntax`
Expected: PASS. `panel.test.js` "every view builds a complete model" now also renders `mine`.

- [ ] **Step 5: Commit**

```bash
git add torn-forum-command-center.user.js tests/mine-refresh.test.js
git commit -m "feat: open-view and Refresh routing for My posts (#2)"
```

---

### Task 8: The nav button, the view, and the row marks

**Files:**
- Modify: `torn-forum-command-center.user.js` - `renderNav`, `renderRow`, `renderThreadsView` (split out `renderListBar`), new `renderMineView` after `renderCatchUpView`, `panelHtml`.
- Test: `tests/panel.test.js`, `tests/handlers.test.js` (rendered-actions check covers the new view automatically)

**Interfaces:**
- Consumes: `model.mine`, rows with `mineRole` and `unreadSource`.
- Produces: `renderListBar(model) -> string` (the shared filter bar), `renderMineView(model) -> string`; nav button `data-view="mine"` with class `tfcc-nav-mine`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/panel.test.js`:

```js
test('My posts is the last nav button, classed, labelled and pressed like the rest', () => {
  const env = loadUserscript({ location: forums() });
  seed(env, [{ id: 1 }]);
  seedMine(env);
  assert.strictEqual(env.exports.VIEWS[env.exports.VIEWS.length - 1], 'mine');
  for (const view of ['threads', 'mine']) {
    env.exports.state.settings.view = view;
    const html = env.exports.panelHtml(env.exports.buildPanelModel(NOW));
    const nav = /<div class="tfcc-nav">([\s\S]*?)<\/div>/.exec(html)[1];
    const buttons = nav.match(/<button[^>]*>[^<]*<\/button>/g);
    const last = buttons[buttons.length - 1];
    assert.match(last, /data-view="mine"/);
    assert.match(last, /class="tfcc-nav-mine"/);
    assert.match(last, />My posts \(1\)</, 'the count is My posts rows with new replies');
    assert.match(last, new RegExp('aria-pressed="' + (view === 'mine') + '"'));
  }
});

test('the My posts view marks roles, local counts and unchecked rows honestly', () => {
  const env = loadUserscript({ location: forums() });
  seed(env, [{ id: 1 }]);
  seedMine(env);
  env.exports.state.settings.view = 'mine';
  const html = env.exports.panelHtml(env.exports.buildPanelModel(NOW));
  assert.match(html, /Threads you started or posted in/);
  assert.match(html, /1 not checked yet/);
  assert.match(html, /started/);
  assert.match(html, /posted in/);
  assert.match(html, /2 new<\/span>[\s\S]*?local count/);
  assert.match(html, /title="Counted on this device/);
  assert.match(html, /data-act="unread-only"/);
  assert.match(html, /data-act="sort"/);
  for (const act of ['pin', 'read', 'prio-up', 'prio-down', 'folder', 'tag-input', 'note-input', 'draft', 'archive']) {
    assert.match(html, new RegExp('data-act="' + act + '" data-id="50"'), act + ' missing on a My posts row');
  }
});

test('My posts empty, loading, error and filtered states each say what happened', () => {
  const env = loadUserscript({ location: forums() });
  const api = env.exports;
  seed(env, [{ id: 1 }]);
  api.state.settings.view = 'mine';
  api.state.mine = api.freshMine();
  api.recompute(NOW);
  api.state.refreshingMine = true;
  assert.match(api.panelHtml(api.buildPanelModel(NOW)), /Loading the threads you started and posted in/);
  api.state.refreshingMine = false;
  api.state.mine.fetchedAt = NOW;
  assert.match(api.panelHtml(api.buildPanelModel(NOW)), /Torn reports no threads you started or posted in/);
  api.state.mineError = { reason: 'torn', detail: 'Torn had a backend error.' };
  const err = api.panelHtml(api.buildPanelModel(NOW));
  assert.match(err, /Torn had a backend error/);
  assert.match(err, /data-act="refresh"/);
  api.state.mineError = null;
  seedMine(env);
  api.state.settings.unreadOnly = true;
  api.state.searchQuery = 'zzz-no-match';
  assert.match(api.panelHtml(api.buildPanelModel(NOW)), /Nothing matches/);
  api.state.searchQuery = '';
  api.state.mine.threads.forEach((t) => { t.baselineTotal = t.postsTotal; });
  api.recompute(NOW);
  assert.match(api.panelHtml(api.buildPanelModel(NOW)), /No new replies in your threads/);
});

test('Threads rows never carry My posts marks', () => {
  const env = loadUserscript({ location: forums() });
  seed(env, [{ id: 1, unread: 2 }]);
  env.exports.state.settings.view = 'threads';
  const html = env.exports.panelHtml(env.exports.buildPanelModel(NOW));
  assert.doesNotMatch(html, /local count|not checked yet|posted in/);
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `node --test tests/panel.test.js`
Expected: FAIL on the four new tests.

- [ ] **Step 3: Implement**

`renderNav`: add `mine: 'My posts'` to `labels`; add `if (v === 'mine' && model.mine && model.mine.unread) count = ' (' + model.mine.unread + ')';`; emit the class only for `mine`:

```js
      out.push('<button type="button" data-act="view" data-view="' + v + '"'
        + (v === 'mine' ? ' class="tfcc-nav-mine"' : '') + ' aria-pressed="'
        + (model.view === v ? 'true' : 'false') + '">' + escapeHtml(labels[v] + count) + '</button>');
```

The test regex expects `data-view="mine" class="tfcc-nav-mine" aria-pressed=`; keep that attribute order.

`renderRow`, replace the unread badge block:

```js
    if (row.unread > 0) {
      if (row.unreadSource === 'local') {
        out.push('<span class="tfcc-unread" title="Counted on this device since you last marked it read or posted. '
          + 'Torn does not report unread counts for threads you do not follow.">'
          + formatCount(row.unread) + ' new</span><span class="tfcc-note">local count</span>');
      } else {
        out.push('<span class="tfcc-unread">' + formatCount(row.unread) + ' new</span>');
      }
    }
    if (row.unreadSource === 'unchecked') out.push('<span class="tfcc-note">not checked yet</span>');
```

and in `tfcc-meta`, first:

```js
    if (row.mineRole) out.push('<span class="tfcc-tag">' + (row.mineRole === 'started' ? 'started' : 'posted in') + '</span>');
```

Split `renderThreadsView` in two with no change to its output: everything from `var out = ['<div class="tfcc-bar">'];` through the bar's closing `out.push('</div>');` moves into `renderListBar(model)`, which returns that string, and `renderThreadsView` starts with `var out = [renderListBar(model)];` followed by its existing empty/rows code. Make its empty text view-aware:

```js
      out.push('<div class="tfcc-empty">Nothing matches. '
        + (model.view === 'mine' || model.totals.subscribed ? 'Try clearing the filters.' : 'Refresh to load your subscribed threads.')
        + '</div>');
```

Run `npm test` after the split alone; `panel.test.js` and `handlers.test.js` must pass unchanged before going on.

`renderMineView`, after `renderCatchUpView`:

```js
  function renderMineView(model) {
    var m = model.mine;
    var out = [];
    var line = 'Threads you started or posted in.';
    if (m.fetchedAt) line += ' Updated ' + formatRelativeTime(m.fetchedAt, model.now) + '.';
    if (m.unchecked) line += ' ' + m.unchecked + ' not checked yet.';
    out.push('<p class="tfcc-note">' + escapeHtml(line) + '</p>');

    if (m.error) {
      out.push('<div class="tfcc-error">' + escapeHtml(m.error.detail) + '</div>');
      out.push('<div class="tfcc-actions">' + btn('refresh', 'Try again') + '</div>');
      if (m.total && m.fetchedAt) {
        out.push('<p class="tfcc-note">' + escapeHtml('Showing the saved list from '
          + formatAbsoluteTime(m.fetchedAt) + '.') + '</p>');
      }
    }

    if (!m.total) {
      if (m.refreshing) {
        out.push('<div class="tfcc-empty">Loading the threads you started and posted in...</div>');
      } else if (m.fetchedAt) {
        out.push('<div class="tfcc-empty">Torn reports no threads you started or posted in.</div>');
      } else if (!m.error) {
        out.push('<div class="tfcc-empty">Press Refresh to load the threads you started and posted in.</div>');
      }
      return out.join('');
    }

    // Unread only is the one filter that can empty a non-empty list without
    // the user typing anything, so it gets its own words, plus the count of
    // rows it hid because nobody has checked them yet.
    var onlyUnread = model.unreadOnly && !model.searchQuery && !model.folderFilter && !model.tagFilter;
    if (!model.rows.length && onlyUnread) {
      out.push(renderListBar(model));
      out.push('<div class="tfcc-empty">No new replies in your threads.'
        + (m.unchecked ? ' ' + m.unchecked + ' not checked yet.' : '') + '</div>');
      return out.join('');
    }
    out.push(renderThreadsView(model));
    return out.join('');
  }
```

`panelHtml`: replace the Task 7 temporary route with `else if (model.view === 'mine') out.push(renderMineView(model));`.

- [ ] **Step 4: Run to verify they pass**

Run: `npm test && npm run test:syntax`
Expected: PASS, including `handlers.test.js` "every rendered action is handled" (no new `data-act` was introduced).

- [ ] **Step 5: Commit**

```bash
git add torn-forum-command-center.user.js tests/panel.test.js
git commit -m "feat: My posts nav button, view and honest row marks (#2)"
```

---

### Task 9: The look - right-aligned light grey button, both themes, contrast

**Files:**
- Modify: `torn-forum-command-center.user.js` - `panelStyleText` (both token blocks; new rules after the `.tfcc-nav` rule).
- Modify: `tests/style.test.js`, `tests/render-preview.mjs`

**Interfaces:**
- Produces: tokens `--tfcc-mine-bg`, `--tfcc-mine-hover`, `--tfcc-mine-pressed`, `--tfcc-mine-text`, `--tfcc-mine-border`; rules on `#tfcc-panel button.tfcc-nav-mine`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/style.test.js` (it already has `css` and `blockFor` at the top; check `grep -n "const css\|function blockFor" tests/style.test.js`):

```js
test('My posts is right-aligned, light grey with dark text, in both themes', () => {
  const rule = (sel) => {
    const i = css.indexOf(sel + ' {');
    assert.ok(i !== -1, 'missing rule: ' + sel);
    return css.slice(i, css.indexOf('}', i));
  };
  const base = rule('#tfcc-panel button.tfcc-nav-mine');
  assert.match(base, /margin-left:\s*auto/);
  assert.match(base, /background:\s*var\(--tfcc-mine-bg\)/);
  assert.match(base, /color:\s*var\(--tfcc-mine-text\)/);
  assert.match(base, /border-color:\s*var\(--tfcc-mine-border\)/);
  assert.match(rule('#tfcc-panel button.tfcc-nav-mine:hover'), /background:\s*var\(--tfcc-mine-hover\)/);
  const pressed = rule('#tfcc-panel button.tfcc-nav-mine[aria-pressed="true"]');
  assert.match(pressed, /background:\s*var\(--tfcc-mine-pressed\)/);
  assert.match(pressed, /box-shadow:\s*inset 0 -3px 0 var\(--tfcc-mine-text\)/, 'pressed needs a non-colour cue');
});

test('the My posts rules come after, and are at least as specific as, the generic button rules', () => {
  const generic = css.indexOf('button[aria-pressed="true"] {');
  const mine = css.indexOf('button.tfcc-nav-mine[aria-pressed="true"] {');
  assert.ok(generic !== -1 && mine > generic, 'a later rule of equal or higher specificity must win');
});

test('every My posts colour token is set in both theme blocks, to the agreed values', () => {
  const dark = { bg: '#d9d9d9', hover: '#c8c8c8', pressed: '#b0b0b0', text: '#141414', border: '#d9d9d9' };
  const light = Object.assign({}, dark, { border: '#5c5c5c' });
  const darkBlock = css.slice(0, css.indexOf('.tfcc-theme-light {'));
  const lightBlock = css.slice(css.indexOf('.tfcc-theme-light {'), css.indexOf('}', css.indexOf('.tfcc-theme-light {')));
  for (const [k, v] of Object.entries(dark)) assert.ok(darkBlock.indexOf('--tfcc-mine-' + k + ': ' + v) !== -1, 'dark ' + k);
  for (const [k, v] of Object.entries(light)) assert.ok(lightBlock.indexOf('--tfcc-mine-' + k + ': ' + v) !== -1, 'light ' + k);
});
```

Before writing these, read how `css` is built in `tests/style.test.js` (it may already substitute `PANEL_ID`); if selectors appear as `#tfcc-panel` there, the tests above are correct as written.

- [ ] **Step 2: Run to verify they fail**

Run: `node --test tests/style.test.js`
Expected: FAIL, "missing rule: #tfcc-panel button.tfcc-nav-mine".

- [ ] **Step 3: Implement**

In the dark token block, after `--tfcc-focus-ring`:

```js
      '  --tfcc-mine-bg: #d9d9d9; --tfcc-mine-hover: #c8c8c8; --tfcc-mine-pressed: #b0b0b0;',
      '  --tfcc-mine-text: #141414; --tfcc-mine-border: #d9d9d9;',
```

In the light block, after `--tm-warn-text`:

```js
      '  --tfcc-mine-bg: #d9d9d9; --tfcc-mine-hover: #c8c8c8; --tfcc-mine-pressed: #b0b0b0;',
      '  --tfcc-mine-text: #141414; --tfcc-mine-border: #5c5c5c;',
```

After the `.tfcc-nav` rule:

```js
      // My posts stands apart from the other five: last, pushed right, and
      // light grey with dark text in every theme. Each rule names the button
      // element so it is (1,1,1) or more and beats the generic button,
      // :hover and aria-pressed rules above. Pressed is shown by an underline
      // bar as well as the fill, so it never depends on colour alone.
      // Measured: text on fill 13.05, on hover 11.01, on pressed 8.49; fill
      // on the dark panel 11.68; light border on the light panel 5.97.
      '#' + PANEL_ID + ' button.tfcc-nav-mine { margin-left: auto; background: var(--tfcc-mine-bg);',
      '  color: var(--tfcc-mine-text); border-color: var(--tfcc-mine-border); font-weight: bold; }',
      '#' + PANEL_ID + ' button.tfcc-nav-mine:hover { background: var(--tfcc-mine-hover);',
      '  color: var(--tfcc-mine-text); }',
      '#' + PANEL_ID + ' button.tfcc-nav-mine[aria-pressed="true"] { background: var(--tfcc-mine-pressed);',
      '  color: var(--tfcc-mine-text); box-shadow: inset 0 -3px 0 var(--tfcc-mine-text); }',
```

Check the existing tests that might object: "every rule is scoped to something this script owns" (these are), "no rule paints black text" (`#141414` is not matched), "the light theme overrides every colour the dark theme sets" (both blocks set all five).

In `tests/render-preview.mjs`, where it seeds state before looping `api.VIEWS` (read lines 100-160), add a My posts seed equivalent to `seedMine` in Task 5 (three threads: one local-count unread, one started and quiet, one unchecked) so the `mine` previews show every mark.

- [ ] **Step 4: Run tests, previews and the contrast audit**

Run: `npm test && npm run test:syntax`
Expected: PASS.

Run: `node tests/render-preview.mjs && node tests/contrast-audit.mjs > contrast.log 2>&1; cat contrast.log`
Expected: `OK` for every preview including the `mine` dark, light and hostile pages, ending "Every preview passes WCAG AA." If the gstack browse binary is missing the audit exits 2 and says so: record that the audit was **not run** in the PR description, do not record it as a pass, and add the audit to the QA gate.

Open the `mine` previews in a browser at 375 px width and confirm the button is last, right-aligned, and wraps without horizontal scroll.

- [ ] **Step 5: Commit**

```bash
git add torn-forum-command-center.user.js tests/style.test.js tests/render-preview.mjs
git commit -m "feat: style My posts as a right-aligned light grey nav button (#2)"
```

Do not commit `preview/` or `contrast.log` unless they are already tracked (`git status` first).

---

### Task 10: Settings text, debug report, export

**Files:**
- Modify: `torn-forum-command-center.user.js` - the "Refreshing" section of `renderSettingsView`; `gatherDebugContext` and `buildDebugReport`.
- Modify: `tests/panel.test.js`, `tests/debug-report.test.js`, `tests/share.test.js`

**Interfaces:**
- Consumes: `MINE_TTL_MS`, `DEFAULT_ENRICH_BUDGET`, `REQUESTS_PER_WINDOW`, `state.mine`, `state.mineError`.
- Produces: Settings note stating both budgets; debug counts `mineThreads`, `mineStarted`, `minePosted`, `mineUnchecked`, `mineFetchedAt`, `mineError` reason only, rendered as report lines `my posts threads`, `my posts started`, `my posts posted in`, `my posts unchecked`, `my posts fetched`, `my posts error`.

- [ ] **Step 1: Write the failing tests**

`tests/panel.test.js`:

```js
test('Settings states both request budgets, from the constants', () => {
  const env = loadUserscript({ location: forums() });
  seed(env, [{ id: 1 }]);
  env.exports.state.settings.view = 'settings';
  const html = env.exports.panelHtml(env.exports.buildPanelModel(NOW));
  const api = env.exports;
  assert.match(html, /Opening My posts, or refreshing while it is open, makes two requests of its own/);
  assert.match(html, new RegExp('at most once every ' + (api.MINE_TTL_MS / 60000) + ' minutes'));
  assert.match(html, /a Threads refresh is at most 13\s+requests and My posts at most 12/);
  assert.match(html, /under 40 requests a minute/);
});
```

Add `'DEFAULT_ENRICH_BUDGET'` to `EXPORT_NAMES` if absent, and assert the numbers are derived: `assert.strictEqual(3 + api.DEFAULT_ENRICH_BUDGET, 13); assert.strictEqual(2 + api.DEFAULT_ENRICH_BUDGET, 12);`.

`tests/debug-report.test.js`, in `loaded()` before `api.recompute(NOW)`:

```js
  const mine = api.freshMine();
  mine.threads = [Object.assign(api.freshMineThread(77, NOW), {
    posted: true, title: 'MY SECRET THREAD TITLE', totalKnown: true, postsTotal: 3, baselineTotal: 1,
  })];
  api.state.mine = mine;
  api.state.mineError = { reason: 'torn', detail: 'Threads you posted in could not be loaded: SECRET POST BODY' };
```

In `the report never carries anything private`, add to `forbidden`:

```js
    ['MY SECRET THREAD TITLE', 'a My posts thread title'],
    ['SECRET POST BODY', 'My posts error free text'],
```

In `the report carries what a maintainer needs`, add:

```js
  assert.match(report, /my posts threads: 1/);
  assert.match(report, /my posts unchecked: 0/);
  assert.match(report, /my posts error: torn/);
```

The whitelist-of-scalars test then covers the new context fields with no change.

`tests/share.test.js`:

```js
test('the export is built from folders and drafts only, so the My posts cache cannot reach it', () => {
  // encodeState(organizer, drafts, btoa) reads nothing else. A fourth input is
  // how a cache would leak into an export, so the signature is pinned.
  assert.strictEqual(api.encodeState.length, 3);
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `node --test tests/panel.test.js tests/debug-report.test.js tests/share.test.js`
Expected: FAIL on the Settings text and the debug count.

- [ ] **Step 3: Implement**

Replace the note after the `enrich-budget` input:

```js
    out.push('<p class="tfcc-note">A refresh of Threads makes two requests, plus one for the forum list at '
      + 'most once a day. Opening My posts, or refreshing while it is open, makes two requests of its own, '
      + 'at most once every ' + Math.round(MINE_TTL_MS / 60000) + ' minutes unless you press Refresh. '
      + 'Each activity lookup adds one more to either, and only runs for a thread with no recent time. '
      + 'With the default of ' + DEFAULT_ENRICH_BUDGET + ', a Threads refresh is at most '
      + (3 + DEFAULT_ENRICH_BUDGET) + ' requests and My posts at most ' + (2 + DEFAULT_ENRICH_BUDGET) + '. '
      + 'The script keeps itself under ' + REQUESTS_PER_WINDOW + ' requests a minute regardless.</p>');
```

`gatherDebugContext.counts` gains:

```js
        mineThreads: state.mine.threads.length,
        mineStarted: state.mine.threads.filter(function (t) { return t.started; }).length,
        minePosted: state.mine.threads.filter(function (t) { return t.posted; }).length,
        mineUnchecked: state.mine.threads.filter(function (t) { return !t.totalKnown; }).length,
```

and the context gains `mineFetchedAt: state.mine.fetchedAt` and `mineError: state.mineError ? state.mineError.reason : null` (reason only). Add matching lines to `buildDebugReport` in its existing whitelist style.

`encodeState` needs no change; the test proves it.

- [ ] **Step 4: Run to verify they pass**

Run: `npm test && npm run test:syntax`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add torn-forum-command-center.user.js tests/panel.test.js tests/debug-report.test.js tests/share.test.js tests/load-userscript.js
git commit -m "feat: Settings states the My posts budget; debug counts (#2)"
```

---

### Task 11: Mutation-check entries

**Files:**
- Modify: `tests/mutation-check.mjs` (append to `MUTATIONS`)

Each `apply` must match text that exists in the source **exactly**; a mutation that matches nothing prints `SKIP` and counts as a failure, which is the check telling you the string drifted. Copy each search string from the source with `grep -n -F`, not from this plan, if they differ.

- [ ] **Step 1: Append the entries**

```js
  {
    name: 'My posts is no longer the last nav button',
    suite: 'tests/panel.test.js',
    apply: (s) => s.replace("['threads', 'catchup', 'search', 'drafts', 'settings', 'mine']",
      "['threads', 'catchup', 'search', 'drafts', 'mine', 'settings']"),
  },
  {
    name: 'the My posts button is no longer right-aligned',
    suite: 'tests/style.test.js',
    apply: (s) => s.replace(" button.tfcc-nav-mine { margin-left: auto; ", ' button.tfcc-nav-mine { '),
  },
  {
    name: 'the My posts pressed rule loses to the generic one',
    suite: 'tests/style.test.js',
    apply: (s) => s.replace(" button.tfcc-nav-mine[aria-pressed=\"true\"] {", ' .tfcc-nav-mine-x[aria-pressed="true"] {'),
  },
  {
    name: 'Unread only is ignored in My posts',
    suite: 'tests/panel.test.js',
    apply: (s) => s.replace('      if (f.unreadOnly && r.unread === 0) return false;',
      "      if (f.unreadOnly && r.unread === 0 && view !== 'mine') return false;"),
  },
  {
    name: 'first sight no longer sets the baseline, so history floods as new',
    suite: 'tests/mine.test.js',
    apply: (s) => s.replace('    if (!t.totalKnown) t.baselineTotal = total;', ''),
  },
  {
    name: 'your own last post no longer clears the count',
    suite: 'tests/mine.test.js',
    apply: (s) => s.replace('    if (lastIsMine) t.baselineTotal = Math.max(t.baselineTotal, t.postsTotal);', ''),
  },
  {
    name: 'an unknown total passes for a checked zero',
    suite: 'tests/mine.test.js',
    apply: (s) => s.replace("dismissed: false, unread: 0, unreadSource: 'unchecked' };",
      "dismissed: false, unread: 0, unreadSource: 'local' };"),
  },
  {
    name: 'the My posts TTL is removed',
    suite: 'tests/mine-refresh.test.js',
    apply: (s) => s.replace('var MINE_TTL_MS = 15 * 60 * 1000;', 'var MINE_TTL_MS = 0;'),
  },
  {
    name: 'My posts lookups ignore the budget',
    suite: 'tests/mine-refresh.test.js',
    apply: (s) => s.replace('for (var j = 0; j < snap.threads.length && out.length < n; j += 1) {',
      'for (var j = 0; j < snap.threads.length; j += 1) {'),
  },
  {
    name: 'a post body is kept',
    suite: 'tests/mine.test.js',
    apply: (s) => s.replace("      threadId: threadId,\n      authorId:",
      "      threadId: threadId,\n      content: raw.content,\n      authorId:"),
  },
  {
    name: 'every My posts thread floods Threads',
    suite: 'tests/merge.test.js',
    apply: (s) => s.replace('        inThreads: !!api || !rec || isOrganised(entry, !!draft),', '        inThreads: true,'),
  },
  {
    name: 'the My posts staleness guard is removed',
    suite: 'tests/staleness.test.js',
    apply: (s) => s.replace("    function stale() { return generation !== state.generation; }\n    function fail(",
      "    function stale() { return false; }\n    function fail("),
  },
```

The last one must not also match `refreshAll`'s `stale()`; the `\n    function fail(` suffix makes it unique. Confirm with `grep -c "function stale()" torn-forum-command-center.user.js` (expect 2) and that the mutated text differs in exactly one place.

- [ ] **Step 2: Run the check to a file and read it**

Run: `node tests/mutation-check.mjs > mutation.log 2>&1; echo exit=$?`
Then: `cat mutation.log` (or Read it). Never pipe the check itself.
Expected: every line `OK`, none `WEAK`, `SKIP` or `HUNG`; `git status` shows `torn-forum-command-center.user.js` unmodified afterwards.

For any `WEAK`: the named test passes for the wrong reason. Fix the **test** so it fails under that mutation (assert an absolute value, not the constant under test), never weaken the mutation.

- [ ] **Step 3: Commit**

```bash
git add tests/mutation-check.mjs tests/*.test.js
git commit -m "test: mutation entries for every My posts promise (#2)"
```

---

### Task 12: Docs, code map, and release

**Files:**
- Modify: `docs/architecture.md`, `docs/qa-checklist.md`, `docs/rules-compliance.md`, `README.md`, `CHANGELOG.md`, `package.json`, `torn-forum-command-center.user.js` (metadata `@version`, `SCRIPT_VERSION`), `docs/code-map.md`

- [ ] **Step 1: Architecture**

In `docs/architecture.md`: "The five endpoints" becomes seven, adding `user/forumthreads` and `user/forumposts` rows (Public, "My posts, fetched only for that view"); state that the key-access text is unchanged because both are Public; add the My posts budget sentence beside the 13-request paragraph; "Six independent keys" becomes seven with `tfcc:mine` and why it is separate (the `loadKey` damage report); add a short "My posts and the local unread count" subsection under the unread model with the `seen = max(lastSeenTotal, baselineTotal)` rule and the `inThreads` predicate.

- [ ] **Step 2: QA checklist and rules compliance**

Copy the spec's "QA checklist additions" section into `docs/qa-checklist.md` as `### My posts` under the Torn PDA matrix and as a line in Desktop regression ("My posts: walk the Torn PDA section on desktop"). Update "Before you start" test count to the new `npm test` total. In `docs/rules-compliance.md`, add one paragraph: opening My posts is a user input producing at most 12 GETs to the official API, at most once per 15 minutes, and auto refresh never requests it.

- [ ] **Step 3: README and CHANGELOG**

README features list gains My posts. `CHANGELOG.md`: replace "Nothing yet." under `[Unreleased]` with nothing, and add above `[0.1.0]`:

```markdown
## [0.2.0] - YYYY-MM-DD

Blocked on the My posts section of `docs/qa-checklist.md` and on plan Task 0.

### Added

- A My posts view listing the threads you started or posted in, from the
  Public `user/forumthreads` and `user/forumposts` selections. It has the same
  row actions, filters and sort as Threads, plus `is:started` and `is:posted`.
- A local unread count for threads you do not follow, counted from the first
  time the script sees them, cleared by Mark read or by your own post, and
  labelled as a local count. A thread not yet looked up says so.

### Changed

- An unsubscribed thread of your own whose only local state is a visit or a
  read marker now lives in My posts rather than Threads.
- The Settings request note states the My posts budget: at most 12 requests,
  at most once every 15 minutes unless you press Refresh.
```

- [ ] **Step 4: Version bump - one commit (CLAUDE.md rule 8)**

Set `// @version      0.2.0` in the metadata block, `var SCRIPT_VERSION = '0.2.0';`, `"version": "0.2.0"` in `package.json`, and the CHANGELOG date. Run:

```
npm test
npm run test:syntax
node tests/mutation-check.mjs > mutation.log 2>&1
```

Expected: all green (`metadata.test.js` checks the three versions agree); read `mutation.log`, all `OK`.

```bash
git add torn-forum-command-center.user.js package.json CHANGELOG.md README.md docs/architecture.md docs/qa-checklist.md docs/rules-compliance.md
git commit -m "chore: release 0.2.0 with the My posts view (#2)"
```

The `v0.2.0` tag goes on this commit during `/ship`, after `docs/qa-checklist.md` and Task 0 are done. Do not tag before.

- [ ] **Step 5: Refresh the code map**

The file grew and declarations moved. Run `/code-map`, check `docs/code-map.md` lists `refreshMine`, `renderMineView`, `viewRows`, `mergeMineSnapshot`, then:

```bash
git add docs/code-map.md
git commit -m "docs: refresh the code map for My posts (#2)"
```

- [ ] **Step 6: Pipeline**

`/review`, then `/ship` (verify gate: `npm test`). PR description must state: no change to `@match`, `@grant` or `@connect`; two new Public GET selections; the contrast audit result (or that it could not be run); Task 0 status.
