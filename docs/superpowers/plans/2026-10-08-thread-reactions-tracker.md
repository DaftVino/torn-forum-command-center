# Thread Reactions Tracker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show one line under the panel header, `Your threads: +12 rating, 3.4k views`, totalling Torn's `rating` and `views` across the threads the key owner started, with `-` (never 0) when unknown, at zero extra requests.

**Architecture:** Reuses #2's `user/forumthreads` answer. #2's pure `mineThreadFromApi` stops discarding `rating` and `views`; a pure `applyReactions` stores them as optional fields on `tfcc:mine` thread records; a pure `reactionTotals` sums them for started threads; the runtime renders a `.tfcc-subhead` block directly below `.tfcc-head`, after the collapsed early return, whose button opens My posts. My posts rows for started threads show their own figures.

**Tech Stack:** One ES5-style IIFE userscript (`torn-forum-command-center.user.js`), Node `node:test` suites run through the `vm` harness in `tests/load-userscript.js`. No dependencies.

**Spec:** `docs/superpowers/specs/2026-10-08-thread-reactions-tracker-design.md`. Read it first; where the two disagree, the spec wins and this plan is amended. Evidence: `docs/reference/torn-openapi-forum-excerpt-2026-10-08.json`.

**Prerequisite:** #2 (My posts, plan `docs/superpowers/plans/2026-10-08-my-posts-view.md` on `docs/2-my-posts-plan`) is merged to `main`. Tasks 1 to 8 assume its names: `freshMine`, `freshMineThread`, `normaliseMineThread`, `normaliseMine`, `mineThreadFromApi`, `mergeMineSnapshot`, `MINE_PAGE_LIMIT`, `MINE_TTL_MS`, `state.mine`, row field `mineRole`, view id `mine`, `forumThreadsPayload`. If this must merge first, use the section "If this merges first" at the end **instead of** nothing: it replaces Task 1's dependency on #2 and adds Tasks F1 to F3.

## Global Constraints

- **Never read `torn-forum-command-center.user.js` whole.** For every symbol: `grep -n "function <name>\|var <name>" torn-forum-command-center.user.js`, then `Read` with `offset`/`limit`. `docs/code-map.md` may be stale; the grep is the truth.
- **ASCII only** in the userscript (`tests/metadata.test.js`). No emoji thumbs. Write `Torn\'s`, never a curly apostrophe.
- **Engine purity** (`tests/purity.test.js`): `applyReactions`, `reactionTotals`, `formatSigned`, `reactionsTitle` live between `// ---- ENGINE START` and `// ---- ENGINE END` and take `now` as an argument.
- **Budget:** no new request. Threads refresh stays <= 13 at defaults, My posts <= 12, limiter 40 per rolling minute. The Settings note gains exactly: `The rating and views under the title come from the same answer as My posts and make no request of their own.`
- **Unknown is `-`, never `0`.** `rating`/`views` are read with `typeof === 'number'`; `toInt(null, 0)` is 0, which is the trap.
- **Labels:** `rating` and `views`. Never "thumbs up", "likes", "dislikes" or "subscribers": the API has no such thread figures (spec, "What does not exist").
- **No change to `.tfcc-head`'s contents or `.tfcc-title`.** The header row belongs to the title, #9's badges, and Refresh/Expand/Hide.
- **Hidden when collapsed**, without a key, in the loading and fatal shells, and when Torn reports no started threads.
- **Read-only**, `@match`/`@grant`/`@connect` unchanged, no DOM data path (ADR 0001), API key untouched.
- **Mutation check:** `node tests/mutation-check.mjs > mutation.log 2>&1`, then read `mutation.log`. Never pipe it into `head` or anything that closes the pipe.
- **Commits:** Conventional Commits, no attribution trailer of any kind.
- **Release convention (rule 8):** the feature PR adds only a CHANGELOG entry under `## [Unreleased]`. It never touches `@version`, `SCRIPT_VERSION` or `package.json`. A separate release commit does that later.

## Review Focus

1. **Upgrade with a `tfcc:mine` written before this feature** (records with no `reactAt`/`rating`/`views`) must load with no "damaged" notice. Pinned in Task 2 (`tests/storage.test.js`).
2. **`rating: null` or a string from Torn** must render `-`, not `0`, and a genuine total of 0 must render `0`, not `-`. Pinned in Tasks 2 and 3.
3. **Narrowest PDA width:** the tracker must never push Refresh, Expand or Hide off the header row. Pinned structurally in Task 4 (the subhead is outside `.tfcc-head`; style test forbids `.tfcc-head .tfcc-reactions`), and by QA.
4. **A record observed once with views only, then with both,** must serialise in canonical order, or the next reload reports damage. Pinned in Task 2.
5. **Negative totals** (`-3`) must not be read as unknown (`-`). Pinned in Task 3 (`formatSigned`) and Task 4 (render).

## Files in scope

| File | Change |
|---|---|
| `torn-forum-command-center.user.js` | Engine: `mineThreadFromApi` fields, `applyReactions`, `normaliseMineThread` optional fields, `mergeMineSnapshot` call, `formatSigned`, `reactionTotals`, `reactionsTitle`. Runtime: `REACTIONS_STALE_MS`, model field, `renderReactions`, `panelHtml`, styles, `mergeThreads` row fields, `renderRow` meta, Settings sentence, debug count. |
| `tests/load-userscript.js` | `EXPORT_NAMES`; `forumThreadsPayload` gains `rating`, `views` |
| `tests/reactions.test.js` | New, engine |
| `tests/storage.test.js`, `tests/panel.test.js`, `tests/style.test.js`, `tests/debug-report.test.js` | Extended |
| `tests/render-preview.mjs` | Seed figures |
| `tests/mutation-check.mjs` | Eight entries |
| `CHANGELOG.md`, `docs/qa-checklist.md`, `docs/architecture.md`, `README.md`, `docs/code-map.md` | Docs |

## Stop conditions

Stop and amend the spec if any of these becomes necessary: a new request or endpoint; reading `likes`/`dislikes`; any label containing "thumb", "like" or "subscriber"; adding an element inside `.tfcc-head`; a new storage key or a new required field on a `tfcc:mine` record; a new setting.

---

### Task 0: Live evidence (owner, signed in; not code)

Shared with #2's plan Task 0. Do it once for both.

- [ ] **Step 1:** In a signed-in browser, request `https://api.torn.com/v2/user/forumthreads?limit=100` with your Minimal key (Torn's own API docs page "Try it" is fine). Save the JSON. Remove `title`, `author.username` and `last_poster.username` values; keep every key and every number, including `rating` and `views`. Commit as `tests/fixtures/user-forumthreads.json` (if #2's Task 0 already committed it, check it still has `rating` and `views`).
- [ ] **Step 2:** Pick one of your threads with a visible reaction. On Torn's thread page note thumbs up, thumbs down and views. In the JSON note that thread's `rating` and `views`. Record in the spec's "Open questions" 1: whether `rating` = up - down, and whether `views` matches.
- [ ] **Step 3:** Optional, for open question 2: request `user/forumposts?limit=100`, find the `is_topic: true` post of the same thread, and note its `likes`/`dislikes` against Torn's thumbs. Do not commit post `content`.
- [ ] **Step 4:** If either field is absent from the live answer, stop: the tracker would show `-` forever. Amend the spec before Task 4.

Commit: `git add tests/fixtures/user-forumthreads.json docs/superpowers/specs/2026-10-08-thread-reactions-tracker-design.md && git commit -m "test: live forumthreads fixture with rating and views (#10)"`

---

### Task 1: Harness exports and payload fields

**Files:**
- Modify: `tests/load-userscript.js` (`EXPORT_NAMES`, `forumThreadsPayload`)

**Interfaces:**
- Consumes: #2's `forumThreadsPayload(threads)`.
- Produces: `forumThreadsPayload` rows carry `rating` (default `0` only when the caller passes nothing and `t.noRating` is not set) and `views`; callers pass `rating: null` / `noRating: true` to exercise absence. Exports `applyReactions`, `reactionTotals`, `formatSigned`, `reactionsTitle`, `REACTIONS_STALE_MS`, `renderReactions` (undefined until defined; harmless).

- [ ] **Step 1: Edit the payload builder**

In `forumThreadsPayload`, after `is_sticky: false,` add the two fields the schema marks required, and a way to omit them:

```js
      // ForumThreadBase requires both (docs/reference/torn-openapi-forum-excerpt-2026-10-08.json).
      // noRating / noViews drop the key entirely, to prove absence reads as unknown.
      ...(t.noRating ? {} : { rating: t.rating === undefined ? 0 : t.rating }),
      ...(t.noViews ? {} : { views: t.views === undefined ? 0 : t.views }),
```

- [ ] **Step 2: Add the export names**

In `EXPORT_NAMES`, after #2's my-posts names, add:

```js
  // thread reactions (#10)
  'applyReactions', 'reactionTotals', 'formatSigned', 'reactionsTitle', 'REACTIONS_STALE_MS', 'renderReactions',
```

- [ ] **Step 3: Verify nothing broke**

Run: `npm test`
Expected: PASS, same count as before.

- [ ] **Step 4: Commit**

```bash
git add tests/load-userscript.js
git commit -m "test: harness exports and rating/views payload fields (#10)"
```

---

### Task 2: Read, store and merge the figures

**Files:**
- Modify: `torn-forum-command-center.user.js` - `mineThreadFromApi`, `normaliseMineThread`, `mergeMineSnapshot` (all in #2's `// -- my posts` engine section); new `applyReactions` directly after `mineThreadFromApi`.
- Create: `tests/reactions.test.js`
- Modify: `tests/storage.test.js`

**Interfaces:**
- Consumes: `forumThreadsPayload`, `freshMine`, `freshMineThread`, `normaliseMine`, `mergeMineSnapshot(prev, started, posts, now, complete)`.
- Produces: `mineThreadFromApi(raw)` adds `rating: number|null`, `views: number|null`. `applyReactions(rec, row, now) -> rec` (mutates and returns `rec`). Records may carry `reactAt`, `rating`, `views`, in that order, after #2's fields.

- [ ] **Step 1: Write the failing tests**

Create `tests/reactions.test.js`:

```js
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { loadUserscript, forumThreadsPayload } = require('./load-userscript');

const { exports: api } = loadUserscript();
const NOW = 1700000000000;

function apiRow(t) {
  return api.mineThreadFromApi(forumThreadsPayload([Object.assign({ id: 5 }, t)]).forumThreads[0]);
}

test('rating and views are read from user/forumthreads', () => {
  const r = apiRow({ rating: 7, views: 340 });
  assert.strictEqual(r.rating, 7);
  assert.strictEqual(r.views, 340);
});

test('a negative rating is kept, and a zero rating is a known zero', () => {
  assert.strictEqual(apiRow({ rating: -3 }).rating, -3);
  assert.strictEqual(apiRow({ rating: 0 }).rating, 0);
});

test('an absent, null or string figure is unknown, never 0', () => {
  // toInt(null, 0) is 0. That is the exact way a missing rating would turn
  // into a confident zero on screen.
  assert.strictEqual(apiRow({ noRating: true }).rating, null);
  assert.strictEqual(apiRow({ rating: null }).rating, null);
  assert.strictEqual(apiRow({ rating: '7' }).rating, null);
  assert.strictEqual(apiRow({ noViews: true }).views, null);
  assert.strictEqual(apiRow({ views: -1 }).views, null, 'a view count cannot be negative');
});

test('applyReactions writes reactAt, rating, views in canonical order', () => {
  const rec = api.freshMineThread(5, NOW);
  api.applyReactions(rec, { rating: 2, views: 9 }, NOW);
  const keys = Object.keys(rec);
  assert.deepStrictEqual(keys.slice(-3), ['reactAt', 'rating', 'views']);
  assert.strictEqual(rec.reactAt, NOW);
});

test('views first, then both: still canonical order', () => {
  const rec = api.freshMineThread(5, NOW);
  api.applyReactions(rec, { rating: null, views: 9 }, NOW);
  assert.deepStrictEqual(Object.keys(rec).slice(-2), ['reactAt', 'views']);
  api.applyReactions(rec, { rating: 4, views: 10 }, NOW + 1);
  assert.deepStrictEqual(Object.keys(rec).slice(-3), ['reactAt', 'rating', 'views']);
});

test('a row with neither figure leaves the old figures and their age alone', () => {
  const rec = api.freshMineThread(5, NOW);
  api.applyReactions(rec, { rating: 2, views: 9 }, NOW);
  api.applyReactions(rec, { rating: null, views: null }, NOW + 5000);
  assert.strictEqual(rec.rating, 2);
  assert.strictEqual(rec.reactAt, NOW, 'old figures age; they are not re-dated');
});

test('a row with one figure drops the other to unknown', () => {
  const rec = api.freshMineThread(5, NOW);
  api.applyReactions(rec, { rating: 2, views: 9 }, NOW);
  api.applyReactions(rec, { rating: null, views: 11 }, NOW + 5000);
  assert.strictEqual('rating' in rec, false);
  assert.strictEqual(rec.views, 11);
  assert.strictEqual(rec.reactAt, NOW + 5000);
});

test('mergeMineSnapshot stores the figures on started threads', () => {
  const started = [apiRow({ id: 5, rating: 3, views: 40 })];
  const snap = api.mergeMineSnapshot(api.freshMine(), started, [], NOW, true);
  const t = snap.threads.find((x) => x.id === 5);
  assert.strictEqual(t.started, true);
  assert.strictEqual(t.rating, 3);
  assert.strictEqual(t.views, 40);
  assert.strictEqual(t.reactAt, NOW);
});

test('the normaliser keeps the figures and reads its own output back', () => {
  const rec = api.freshMineThread(5, NOW);
  rec.started = true;
  api.applyReactions(rec, { rating: -1, views: 0 }, NOW);
  const mine = Object.assign(api.freshMine(), { fetchedAt: NOW, threads: [rec] });
  assert.deepStrictEqual(api.normaliseMine(JSON.parse(JSON.stringify(mine))), mine);
});

test('the normaliser drops figures with no date, and a date with no figures', () => {
  const base = api.freshMineThread(5, NOW);
  const a = api.normaliseMineThread(Object.assign({}, base, { rating: 3 }));
  assert.strictEqual('rating' in a, false);
  const b = api.normaliseMineThread(Object.assign({}, base, { reactAt: NOW }));
  assert.strictEqual('reactAt' in b, false);
});
```

In `tests/storage.test.js`, append:

```js
test('a tfcc:mine written before the reactions tracker loads silently', () => {
  // The fields are optional on purpose: defaulting them would make every
  // upgrading user's My posts cache report itself as damaged.
  const { exports: api } = loadUserscript();
  const mine = api.freshMine();
  mine.fetchedAt = 1000;
  const old = api.freshMineThread(9, 1000);
  old.started = true;
  mine.threads = [old];
  api.saveKey(api.STORAGE_KEYS.mine, mine);
  const back = api.loadKey(api.STORAGE_KEYS.mine, api.normaliseMine, 2000);
  assert.strictEqual(back.recovered, false);
  assert.strictEqual('rating' in back.value.threads[0], false);
});

test('a record that gained figures in two steps reloads undamaged', () => {
  const { exports: api } = loadUserscript();
  const rec = api.freshMineThread(9, 1000);
  rec.started = true;
  api.applyReactions(rec, { rating: null, views: 5 }, 1000);
  api.applyReactions(rec, { rating: 2, views: 6 }, 2000);
  const mine = Object.assign(api.freshMine(), { fetchedAt: 2000, threads: [rec] });
  api.saveKey(api.STORAGE_KEYS.mine, mine);
  const back = api.loadKey(api.STORAGE_KEYS.mine, api.normaliseMine, 3000);
  assert.strictEqual(back.recovered, false);
  assert.deepStrictEqual(back.value, mine);
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `node --test tests/reactions.test.js tests/storage.test.js`
Expected: FAIL, `r.rating` is `undefined` and `api.applyReactions is not a function` (the two-step storage test fails on the latter).

The "older blob loads silently" storage test passes before Step 3, because no field exists yet. That is correct: it is a regression guard for the upgrade trap, not a feature test. Prove it bites before Step 3 is committed: temporarily add `t.reactAt = 0;` before `return t;` in `normaliseMineThread`, run `node --test tests/storage.test.js`, see it FAIL with `recovered` true, and remove the line. Task 7's mutation entry makes this check permanent. #8's `isRecoveredValue` (top-level keys only) does not cover these nested per-record fields, so this test must not be weakened if #8 lands.

- [ ] **Step 3: Implement**

In `mineThreadFromApi`'s returned object, after `isLocked: raw.is_locked === true,` add:

```js
      // ForumThreadBase.rating / .views (OpenAPI 6.13.8). typeof, not toInt:
      // toInt(null, 0) is 0, and an unknown figure must never become a zero.
      rating: typeof raw.rating === 'number' && isFinite(raw.rating) ? Math.floor(raw.rating) : null,
      views: typeof raw.views === 'number' && isFinite(raw.views) && raw.views >= 0 ? Math.floor(raw.views) : null,
```

Directly after `mineThreadFromApi`, add:

```js
  // Thread reactions (#10). Three optional fields, always written in this
  // order so a record serialises exactly as normaliseMineThread would write
  // it; otherwise the next reload would call the user's cache damaged. A row
  // with neither figure leaves the record alone, so old figures age into
  // stale instead of vanishing. A row with one figure drops the other: one
  // reactAt cannot date two figures observed at different times.
  function applyReactions(rec, row, now) {
    if (!rec || !row) return rec;
    var hasRating = typeof row.rating === 'number';
    var hasViews = typeof row.views === 'number';
    if (!hasRating && !hasViews) return rec;
    delete rec.reactAt;
    delete rec.rating;
    delete rec.views;
    rec.reactAt = Math.max(0, toInt(now, 0));
    if (hasRating) rec.rating = row.rating;
    if (hasViews) rec.views = row.views;
    return rec;
  }
```

In `normaliseMineThread`, directly before its `return t;`, add:

```js
    // Optional: absent on records written before #10, and absent means unknown.
    var reactAt = Math.max(0, toInt(raw.reactAt, 0));
    var hasRating = typeof raw.rating === 'number' && isFinite(raw.rating);
    var hasViews = typeof raw.views === 'number' && isFinite(raw.views) && raw.views >= 0;
    if (reactAt > 0 && (hasRating || hasViews)) {
      t.reactAt = reactAt;
      if (hasRating) t.rating = Math.floor(raw.rating);
      if (hasViews) t.views = Math.floor(raw.views);
    }
```

In `mergeMineSnapshot`'s started loop, directly after `if (s.totalKnown) observeMineTotal(r, s.postsTotal, t0);`, add:

```js
      applyReactions(r, s, t0);
```

- [ ] **Step 4: Run to verify they pass**

Run: `node --test tests/reactions.test.js tests/storage.test.js && npm test && npm run test:syntax`
Expected: PASS (purity and ASCII included).

- [ ] **Step 5: Commit**

```bash
git add torn-forum-command-center.user.js tests/reactions.test.js tests/storage.test.js
git commit -m "feat: keep Torn's rating and views for threads you started (#10)"
```

---

### Task 3: Totals, the signed formatter, and the tooltip

**Files:**
- Modify: `torn-forum-command-center.user.js` - new `// -- thread reactions` block at the end of #2's `// -- my posts` engine section; constant `REACTIONS_STALE_MS` beside `DEFAULT_ENRICH_BUDGET` (line ~66, `grep -n "var DEFAULT_ENRICH_BUDGET"`).
- Modify: `tests/reactions.test.js`

**Interfaces:**
- Consumes: `formatCount`, `formatRelativeTime`, `plural`, `toInt`, `isPlainObject` (all engine).
- Produces:
  - `REACTIONS_STALE_MS = 24 * 60 * 60 * 1000`
  - `formatSigned(n) -> string` (`'+12'`, `'0'`, `'-3'`, `'+1.2k'`)
  - `reactionTotals(mine, now, staleMs) -> { state: 'unloaded'|'empty'|'missing'|'known', started, rating: number|null, ratingThreads, views: number|null, viewsThreads, updatedAt, stale }`
  - `reactionsTitle(totals, now, pageLimit, opener?) -> string`

- [ ] **Step 1: Write the failing tests**

Append to `tests/reactions.test.js`:

```js
const DAY = 24 * 60 * 60 * 1000;

function started(id, figures, at) {
  const rec = api.freshMineThread(id, NOW);
  rec.started = true;
  if (figures) api.applyReactions(rec, figures, at === undefined ? NOW : at);
  return rec;
}

function mineOf(threads, fetchedAt) {
  return Object.assign(api.freshMine(), { fetchedAt: fetchedAt === undefined ? NOW : fetchedAt, threads });
}

test('formatSigned', () => {
  assert.strictEqual(api.formatSigned(12), '+12');
  assert.strictEqual(api.formatSigned(0), '0');
  assert.strictEqual(api.formatSigned(-3), '-3');
  assert.strictEqual(api.formatSigned(1200), '+1.2k');
  assert.strictEqual(api.formatSigned(-1200), '-1.2k');
});

test('never fetched is unloaded', () => {
  const r = api.reactionTotals(api.freshMine(), NOW, api.REACTIONS_STALE_MS);
  assert.strictEqual(r.state, 'unloaded');
  assert.strictEqual(r.rating, null);
  assert.strictEqual(r.views, null);
});

test('fetched with no started threads is empty, not unknown and not zero', () => {
  assert.strictEqual(api.reactionTotals(mineOf([]), NOW, api.REACTIONS_STALE_MS).state, 'empty');
});

test('started threads with no figures are missing', () => {
  const r = api.reactionTotals(mineOf([started(1), started(2)]), NOW, api.REACTIONS_STALE_MS);
  assert.strictEqual(r.state, 'missing');
  assert.strictEqual(r.started, 2);
  assert.strictEqual(r.rating, null);
});

test('known totals sum started threads, negatives included', () => {
  const r = api.reactionTotals(mineOf([
    started(1, { rating: 10, views: 100 }),
    started(2, { rating: -3, views: 20 }),
    started(3, { rating: 0, views: 0 }),
  ]), NOW, api.REACTIONS_STALE_MS);
  assert.strictEqual(r.state, 'known');
  assert.strictEqual(r.rating, 7);
  assert.strictEqual(r.views, 120);
  assert.strictEqual(r.ratingThreads, 3);
});

test('a known total of zero is 0, not null', () => {
  const r = api.reactionTotals(mineOf([started(1, { rating: 0, views: 5 })]), NOW, api.REACTIONS_STALE_MS);
  assert.strictEqual(r.rating, 0);
});

test('threads you only posted in are not counted', () => {
  const posted = api.freshMineThread(9, NOW);
  posted.posted = true;
  api.applyReactions(posted, { rating: 500, views: 9000 }, NOW);
  const r = api.reactionTotals(mineOf([started(1, { rating: 1, views: 2 }), posted]), NOW, api.REACTIONS_STALE_MS);
  assert.strictEqual(r.rating, 1);
  assert.strictEqual(r.views, 2);
  assert.strictEqual(r.started, 1);
});

test('partial coverage counts what is known and reports how many', () => {
  const r = api.reactionTotals(mineOf([started(1, { rating: 4, views: null }), started(2)]), NOW, api.REACTIONS_STALE_MS);
  assert.strictEqual(r.state, 'known');
  assert.strictEqual(r.rating, 4);
  assert.strictEqual(r.views, null, 'no thread had views, so the total is unknown');
  assert.strictEqual(r.ratingThreads, 1);
  assert.strictEqual(r.started, 2);
});

test('stale exactly after the threshold, from the newest observation', () => {
  const mine = mineOf([started(1, { rating: 1, views: 1 }, NOW - 2 * DAY), started(2, { rating: 1, views: 1 }, NOW)]);
  assert.strictEqual(api.reactionTotals(mine, NOW + DAY, DAY).stale, false, 'at the threshold is not stale');
  assert.strictEqual(api.reactionTotals(mine, NOW + DAY + 1, DAY).stale, true);
  assert.strictEqual(api.reactionTotals(mine, NOW + DAY + 1, DAY).updatedAt, NOW);
  assert.strictEqual(api.REACTIONS_STALE_MS, DAY, 'the spec promises one day');
});

test('tooltips name each state and never claim a figure that is not there', () => {
  const L = 100;
  assert.match(api.reactionsTitle(api.reactionTotals(api.freshMine(), NOW, DAY), NOW, L), /^Not loaded yet\. Open My posts/);
  assert.match(api.reactionsTitle(api.reactionTotals(mineOf([started(1)]), NOW, DAY), NOW, L), /did not include a rating or view count/);
  const known = api.reactionTotals(mineOf([started(1, { rating: 1, views: 1 }, NOW - 5 * 60000)]), NOW, DAY);
  assert.strictEqual(api.reactionsTitle(known, NOW, L),
    'Torn\'s rating and view count, summed across 1 thread you started. Updated 5m ago.');
  const partial = api.reactionTotals(mineOf([started(1, { rating: 1, views: 1 }), started(2)]), NOW, DAY);
  assert.match(api.reactionsTitle(partial, NOW, L), /summed across 1 of 2 threads you started/);
  const old = api.reactionTotals(mineOf([started(1, { rating: 1, views: 1 }, NOW - 3 * DAY)]), NOW, DAY);
  assert.match(api.reactionsTitle(old, NOW, L), /Updated 3d ago\. Open My posts to update\.$/);
  assert.match(api.reactionsTitle(old, NOW, L, 'Tap here'), /Tap here to update\.$/);
  const many = api.reactionTotals(mineOf(Array.from({ length: 100 }, (_, i) => started(i + 1, { rating: 1, views: 1 }))), NOW, DAY);
  assert.match(api.reactionsTitle(many, NOW, L), /Torn sends your newest 100 threads per request/);
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `node --test tests/reactions.test.js`
Expected: FAIL, `api.formatSigned is not a function`.

- [ ] **Step 3: Implement**

Beside `var DEFAULT_ENRICH_BUDGET = 10;` add:

```js
  // Reaction figures arrive only when My posts fetches, so a 15 minute
  // threshold would call them stale nearly always and the cue would mean
  // nothing. A day is "noticeably old".
  var REACTIONS_STALE_MS = 24 * 60 * 60 * 1000;
```

At the end of the `// -- my posts` engine section, add:

```js
  // -- thread reactions (#10) -------------------------------------------------
  // Totals of Torn's own rating and views across the threads the key owner
  // started. The API has no thumbs-up, thumbs-down or subscriber count for a
  // thread (docs/reference/torn-openapi-forum-excerpt-2026-10-08.json), so
  // none is shown or derived.

  function formatSigned(n) {
    var v = toInt(n, 0);
    if (v > 0) return '+' + formatCount(v);
    if (v < 0) return '-' + formatCount(-v);
    return '0';
  }

  function reactionTotals(mine, now, staleMs) {
    var out = {
      state: 'unloaded', started: 0, rating: null, ratingThreads: 0,
      views: null, viewsThreads: 0, updatedAt: 0, stale: false,
    };
    var threads = isPlainObject(mine) && Array.isArray(mine.threads) ? mine.threads : [];
    for (var i = 0; i < threads.length; i += 1) {
      var t = threads[i];
      if (!t || t.started !== true) continue;
      out.started += 1;
      var at = toInt(t.reactAt, 0);
      if (at <= 0) continue;
      out.updatedAt = Math.max(out.updatedAt, at);
      if (typeof t.rating === 'number') { out.rating = (out.rating || 0) + t.rating; out.ratingThreads += 1; }
      if (typeof t.views === 'number') { out.views = (out.views || 0) + t.views; out.viewsThreads += 1; }
    }
    if (out.started === 0) {
      out.state = isPlainObject(mine) && toInt(mine.fetchedAt, 0) > 0 ? 'empty' : 'unloaded';
      return out;
    }
    if (out.ratingThreads === 0 && out.viewsThreads === 0) { out.state = 'missing'; return out; }
    out.state = 'known';
    out.stale = toInt(now, 0) - out.updatedAt > staleMs;
    return out;
  }

  function reactionsTitle(r, now, pageLimit, opener) {
    var act = opener || 'Open My posts';
    if (!r || r.state === 'unloaded') return 'Not loaded yet. ' + act + ' to load the threads you started.';
    if (r.state === 'empty') return 'Torn reports no threads you started.';
    if (r.state === 'missing') return 'Torn\'s answer did not include a rating or view count for your threads.';
    var covered = Math.max(r.ratingThreads, r.viewsThreads);
    var text = 'Torn\'s rating and view count, summed across '
      + (covered < r.started ? covered + ' of ' : '') + r.started + ' '
      + plural(r.started, 'thread') + ' you started. Updated '
      + formatRelativeTime(r.updatedAt, now) + '.';
    if (r.started >= pageLimit) {
      text += ' Torn sends your newest ' + pageLimit + ' threads per request; older ones keep the figures '
        + 'from when they were last seen.';
    }
    if (r.stale) text += ' ' + act + ' to update.';
    return text;
  }
```

Check before relying on it: `grep -n "function plural" torn-forum-command-center.user.js` - `plural(1, 'thread')` must return `'thread'` and `plural(2, 'thread')` `'threads'`.

- [ ] **Step 4: Run to verify they pass**

Run: `node --test tests/reactions.test.js && npm test && npm run test:syntax`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add torn-forum-command-center.user.js tests/reactions.test.js
git commit -m "feat: reaction totals, signed counts and tooltip text (#10)"
```

---

### Task 4: The line under the header

**Files:**
- Modify: `torn-forum-command-center.user.js` - `buildPanelModel` (return object), new `renderReactions` directly before `panelHtml`, `panelHtml`, `panelStyleText`.
- Modify: `tests/panel.test.js`, `tests/style.test.js`, `tests/render-preview.mjs`

**Interfaces:**
- Consumes: `reactionTotals`, `reactionsTitle`, `formatSigned`, `formatCount`, `formatRelativeTime`, `escapeHtml`, `REACTIONS_STALE_MS`, `MINE_PAGE_LIMIT`, `state.mine`.
- Produces: `model.reactions` (a `reactionTotals` result); `renderReactions(model) -> string` (empty string or one `.tfcc-subhead` block).

- [ ] **Step 1: Write the failing tests**

Append to `tests/panel.test.js`:

```js
const KEY_STORE = [['tfcc:key', 'abcdefghij123456']];

function withMine(env, threads, fetchedAt) {
  const api = env.exports;
  api.state.mine = Object.assign(api.freshMine(), { fetchedAt: fetchedAt === undefined ? NOW : fetchedAt, threads });
  api.recompute(NOW);
}

function startedRec(api, id, figures, at) {
  const rec = api.freshMineThread(id, NOW);
  rec.started = true;
  if (figures) api.applyReactions(rec, figures, at === undefined ? NOW : at);
  return rec;
}

function htmlOf(env) {
  return env.exports.panelHtml(env.exports.buildPanelModel(NOW));
}

test('the reactions line sits under the header row, never inside it', () => {
  const env = loadUserscript({ location: forums(), gmStore: KEY_STORE });
  seed(env, [{ id: 1 }]);
  withMine(env, [startedRec(env.exports, 1, { rating: 12, views: 3400 })]);
  const html = htmlOf(env);
  const head = html.slice(html.indexOf('<div class="tfcc-head">'), html.indexOf('<div class="tfcc-subhead">'));
  assert.ok(html.indexOf('<div class="tfcc-subhead">') > html.indexOf('<div class="tfcc-head">'));
  assert.doesNotMatch(head, /tfcc-reactions/, 'the header row keeps only the title, #9 badges and the controls');
  assert.match(head, /data-act="collapse"/, 'the subhead starts after the whole header row');
  assert.match(html, /Your threads: <span class="tfcc-rx">\+12<\/span> rating, <span class="tfcc-rx">3\.4k<\/span> views/);
});

test('unknown figures render "-", never 0', () => {
  const env = loadUserscript({ location: forums(), gmStore: KEY_STORE });
  seed(env, [{ id: 1 }]);
  withMine(env, [], 0);
  let html = htmlOf(env);
  assert.match(html, /<span class="tfcc-rx">-<\/span> rating, <span class="tfcc-rx">-<\/span> views/);
  assert.match(html, /title="Not loaded yet\. Open My posts to load the threads you started\."/);
  assert.doesNotMatch(html, /<span class="tfcc-rx">0<\/span>/);

  withMine(env, [startedRec(env.exports, 1)]);
  html = htmlOf(env);
  assert.match(html, /<span class="tfcc-rx">-<\/span> rating/);
  assert.match(html, /did not include a rating or view count/);

  withMine(env, [startedRec(env.exports, 1, { rating: 4, views: null })]);
  assert.match(htmlOf(env), /<span class="tfcc-rx">\+4<\/span> rating, <span class="tfcc-rx">-<\/span> views/);
});

test('a known zero renders 0 and a negative renders with its digits', () => {
  const env = loadUserscript({ location: forums(), gmStore: KEY_STORE });
  seed(env, [{ id: 1 }]);
  withMine(env, [startedRec(env.exports, 1, { rating: 0, views: 0 })]);
  assert.match(htmlOf(env), /<span class="tfcc-rx">0<\/span> rating, <span class="tfcc-rx">0<\/span> views/);
  withMine(env, [startedRec(env.exports, 1, { rating: -3, views: 2 })]);
  assert.match(htmlOf(env), /<span class="tfcc-rx">-3<\/span> rating/);
});

test('stale figures carry a visible age, not just a colour', () => {
  const env = loadUserscript({ location: forums(), gmStore: KEY_STORE });
  seed(env, [{ id: 1 }]);
  withMine(env, [startedRec(env.exports, 1, { rating: 1, views: 1 }, NOW - 3 * 24 * 3600000)]);
  const html = htmlOf(env);
  assert.match(html, /class="tfcc-reactions tfcc-stale"/);
  assert.match(html, /views \(3d ago\)<\/button>/);
});

test('the reactions line is hidden when collapsed, without a key, and when you started nothing', () => {
  const env = loadUserscript({ location: forums(), gmStore: KEY_STORE });
  seed(env, [{ id: 1 }]);
  withMine(env, [startedRec(env.exports, 1, { rating: 1, views: 1 })]);
  env.exports.state.settings.collapsed = true;
  assert.doesNotMatch(htmlOf(env), /tfcc-subhead/);
  env.exports.state.settings.collapsed = false;
  withMine(env, [], NOW);
  assert.doesNotMatch(htmlOf(env), /tfcc-subhead/, 'empty is not unknown');

  const nokey = loadUserscript({ location: forums() });
  seed(nokey, [{ id: 1 }]);
  withMine(nokey, [startedRec(nokey.exports, 1, { rating: 1, views: 1 })]);
  assert.doesNotMatch(htmlOf(nokey), /tfcc-subhead/);
});

test('tapping the reactions line opens My posts through the existing view action', () => {
  const env = loadUserscript({ location: forums(), gmStore: KEY_STORE });
  seed(env, [{ id: 1 }]);
  withMine(env, [startedRec(env.exports, 1, { rating: 1, views: 1 })]);
  assert.match(htmlOf(env), /<button type="button" class="tfcc-reactions" data-act="view" data-view="mine"/);
});
```

Append to `tests/style.test.js`:

```js
test('the reactions pill is its own line and wraps rather than overflowing', () => {
  assert.match(blockFor('#tfcc-panel .tfcc-subhead'), /flex-wrap: wrap/);
  const pill = blockFor('#tfcc-panel button.tfcc-reactions');
  assert.match(pill, /white-space: normal/);
  assert.match(pill, /max-width: 100%/);
  assert.ok(css.includes('#tfcc-panel button.tfcc-reactions:hover {'), 'hover must out-rank the generic button:hover');
  assert.ok(!/\.tfcc-head[^{]*\.tfcc-reactions/.test(css), 'no rule may place the tracker in the header row');
});
```

(If `blockFor` is not defined at module scope in `tests/style.test.js`, it is: line 10. If `PANEL_ID` is not `tfcc-panel`, `grep -n "var PANEL_ID"` and adjust the selectors.)

- [ ] **Step 2: Run to verify they fail**

Run: `node --test tests/panel.test.js tests/style.test.js`
Expected: FAIL, no `tfcc-subhead` in the HTML and no rule block for `#tfcc-panel .tfcc-subhead`.

- [ ] **Step 3: Implement**

In `buildPanelModel`'s returned object, after `drafts: draftList(state.drafts),` add:

```js
      reactions: reactionTotals(state.mine, now, REACTIONS_STALE_MS),
```

Directly before `function panelHtml(model)`, add:

```js
  // The thread reactions line (#10). Its own block under .tfcc-head, never in
  // it: the header row belongs to the title, #9's badges and Refresh, Expand
  // and Hide, and one more item there wraps those onto a second line at Torn
  // PDA widths. Rendered after the collapsed early return, so it is hidden
  // when collapsed. Unknown is "-", never 0.
  function renderReactions(model) {
    var r = model.reactions;
    if (!model.hasKey || !r || r.state === 'empty') return '';
    var known = r.state === 'known';
    var rating = known && r.rating !== null ? formatSigned(r.rating) : '-';
    var views = known && r.views !== null ? formatCount(r.views) : '-';
    var stale = known && r.stale;
    var title = reactionsTitle(r, model.now, MINE_PAGE_LIMIT);
    var label = 'Your threads: rating ' + (rating === '-' ? 'unknown' : rating)
      + ', views ' + (views === '-' ? 'unknown' : views) + '. ' + title;
    return '<div class="tfcc-subhead"><button type="button" class="tfcc-reactions' + (stale ? ' tfcc-stale' : '')
      + '" data-act="view" data-view="mine" title="' + escapeHtml(title) + '" aria-label="' + escapeHtml(label) + '">'
      + 'Your threads: <span class="tfcc-rx">' + escapeHtml(rating) + '</span> rating, '
      + '<span class="tfcc-rx">' + escapeHtml(views) + '</span> views'
      + (stale ? ' (' + escapeHtml(formatRelativeTime(r.updatedAt, model.now)) + ')' : '')
      + '</button></div>';
  }
```

In `panelHtml`, directly after the line `    if (model.collapsed) return out.join('');` add:

```js
    out.push(renderReactions(model));
```

In `panelStyleText`, directly after the line containing `' button:hover { background: var(--tm-hover); }',` add:

```js
      // Thread reactions (#10). (1,1,1) beats the generic button rule (1,0,1);
      // :hover at (1,2,1) beats the generic button:hover (1,1,1).
      '#' + PANEL_ID + ' .tfcc-subhead { display: flex; flex-wrap: wrap; gap: var(--tfcc-gap-sm);',
      '  margin-bottom: var(--tfcc-gap); }',
      '#' + PANEL_ID + ' button.tfcc-reactions { font-size: var(--tfcc-text-sm); padding: 0 8px;',
      '  border-radius: 10px; background: var(--tm-bg-3); color: var(--tm-meta);',
      '  border: 1px solid var(--tm-border); white-space: normal; text-align: left; max-width: 100%; }',
      '#' + PANEL_ID + ' button.tfcc-reactions:hover { background: var(--tm-hover); }',
      '#' + PANEL_ID + ' .tfcc-rx { color: var(--tm-text); font-weight: bold; font-variant-numeric: tabular-nums; }',
```

In `tests/render-preview.mjs`, directly before `api.state.refreshing = false;`, add:

```js
// Thread reactions (#10): three started threads with figures, so the
// subhead pill appears in every preview the contrast audit reads.
{
  const mine = api.state.mine && Array.isArray(api.state.mine.threads) ? api.state.mine : api.freshMine();
  mine.fetchedAt = mine.fetchedAt || NOW - 5 * MIN;
  [[16589908, 12, 3400], [16474152, 0, 120], [16354991, -3, 45]].forEach(([id, rating, views]) => {
    let t = mine.threads.find((x) => x.id === id);
    if (!t) { t = api.freshMineThread(id, NOW - 5 * MIN); mine.threads.push(t); }
    t.started = true;
    api.applyReactions(t, { rating, views }, NOW - 5 * MIN);
  });
  api.state.mine = mine;
}
```

- [ ] **Step 4: Run to verify they pass**

Run: `node --test tests/panel.test.js tests/style.test.js && npm test && npm run test:syntax`
Expected: PASS. `tests/handlers.test.js`'s "every rendered action is handled" must still pass: `view` is an existing action.

Then: `node tests/render-preview.mjs && node tests/contrast-audit.mjs > contrast.log 2>&1`, read `contrast.log`.
Expected: OK for every preview. If the pill fails, change only `color` on `button.tfcc-reactions` to `var(--tm-text)`; do not add tokens.

- [ ] **Step 5: Commit**

```bash
git add torn-forum-command-center.user.js tests/panel.test.js tests/style.test.js tests/render-preview.mjs
git commit -m "feat: rating and views line under the panel header (#10)"
```

---

### Task 5: Per-thread figures in My posts

**Files:**
- Modify: `torn-forum-command-center.user.js` - `mergeThreads` (row object), `renderRow` (`tfcc-meta`).
- Modify: `tests/panel.test.js`

**Interfaces:**
- Consumes: #2's `rec` lookup in `mergeThreads` and the `row.mineRole` meta tag in `renderRow`.
- Produces: every row gains `rating: number|null`, `views: number|null` (null unless a `tfcc:mine` record carries them).

- [ ] **Step 1: Write the failing test**

Append to `tests/panel.test.js`:

```js
test('My posts shows each started thread its own figures, and "-" for an unknown one', () => {
  const env = loadUserscript({ location: forums(), gmStore: KEY_STORE });
  seed(env, []);
  const api = env.exports;
  const a = startedRec(api, 41, { rating: 3, views: 120 });
  a.title = 'Alpha';
  const b = startedRec(api, 42, { rating: null, views: 7 });
  b.title = 'Beta';
  const c = startedRec(api, 43);
  c.title = 'Gamma';
  withMine(env, [a, b, c]);
  api.state.settings.view = 'mine';
  const html = htmlOf(env);
  assert.match(html, /rating \+3, 120 views/);
  assert.match(html, /rating -, 7 views/);
  assert.strictEqual((html.match(/ views<\/span>/g) || []).length, 2, 'a thread with no figures gets no meta');
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test tests/panel.test.js`
Expected: FAIL, no `rating +3, 120 views`.

- [ ] **Step 3: Implement**

In `mergeThreads`, in the pushed row object, directly after `mineRole: rec ? (rec.started ? 'started' : 'posted') : null,` add:

```js
        rating: rec && typeof rec.rating === 'number' ? rec.rating : null,
        views: rec && typeof rec.views === 'number' ? rec.views : null,
```

In `renderRow`, directly after the line that pushes the `started` / `posted in` tag, add:

```js
    if (row.mineRole === 'started' && (row.rating !== null || row.views !== null)) {
      out.push('<span class="tfcc-note">rating ' + (row.rating === null ? '-' : formatSigned(row.rating))
        + ', ' + (row.views === null ? '-' : formatCount(row.views)) + ' views</span>');
    }
```

If a `tests/merge.test.js` assertion deep-equals a whole row, add `rating: null, views: null` to its expected object; weaken nothing else.

- [ ] **Step 4: Run to verify it passes**

Run: `npm test && npm run test:syntax`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add torn-forum-command-center.user.js tests/panel.test.js tests/merge.test.js
git commit -m "feat: per-thread rating and views on My posts rows (#10)"
```

---

### Task 6: Settings sentence and debug count

**Files:**
- Modify: `torn-forum-command-center.user.js` - the budget note after the `enrich-budget` input in `renderSettingsView`; `gatherDebugContext`; `buildDebugReport`.
- Modify: `tests/panel.test.js`, `tests/debug-report.test.js`

**Interfaces:**
- Consumes: #2's Settings note ending `'The script keeps itself under ' + REQUESTS_PER_WINDOW + ' requests a minute regardless.</p>');`.
- Produces: debug context `counts.mineRated`; report line `my posts rated: N`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/panel.test.js`:

```js
test('Settings says the reactions line costs no request', () => {
  const env = loadUserscript({ location: forums(), gmStore: KEY_STORE });
  seed(env, [{ id: 1 }]);
  env.exports.state.settings.view = 'settings';
  assert.match(htmlOf(env),
    /The rating and views under the title come from the same answer as My posts and make no request of their own\./);
});
```

In `tests/debug-report.test.js`, in `loaded()` after #2's `api.state.mine = mine;`, add:

```js
  api.applyReactions(mine.threads[0], { rating: 987654, views: 123456 }, NOW);
  mine.threads[0].started = true;
```

In `the report carries what a maintainer needs`, add `assert.match(report, /my posts rated: 1/);`. In `the report never carries anything private`, add to `forbidden`:

```js
    ['987654', 'a rating total'],
    ['123456', 'a views total'],
```

- [ ] **Step 2: Run to verify they fail**

Run: `node --test tests/panel.test.js tests/debug-report.test.js`
Expected: FAIL on the sentence and on `my posts rated`.

- [ ] **Step 3: Implement**

Replace #2's last line of the budget note:

```js
      + 'The script keeps itself under ' + REQUESTS_PER_WINDOW + ' requests a minute regardless.</p>');
```

with:

```js
      + 'The script keeps itself under ' + REQUESTS_PER_WINDOW + ' requests a minute regardless. '
      + 'The rating and views under the title come from the same answer as My posts and make no request of their own.</p>');
```

In `gatherDebugContext().counts`, after #2's `mineUnchecked` line, add:

```js
        mineRated: state.mine.threads.filter(function (t) { return t.started && t.reactAt > 0; }).length,
```

In `buildDebugReport`'s `lines`, after #2's `my posts unchecked` line, add:

```js
      'my posts rated: ' + c.counts.mineRated,
```

- [ ] **Step 4: Run to verify they pass**

Run: `npm test && npm run test:syntax`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add torn-forum-command-center.user.js tests/panel.test.js tests/debug-report.test.js
git commit -m "feat: Settings states the reactions line is free; debug count (#10)"
```

---

### Task 7: Mutation-check entries

**Files:**
- Modify: `tests/mutation-check.mjs` (append to `MUTATIONS`)

- [ ] **Step 1: Confirm every target string is unique**

For each `from` string below, run `grep -c -F "<string>" torn-forum-command-center.user.js` and expect `1`. A `0` means the code drifted from this plan: fix the entry to the real line, not the code.

- [ ] **Step 2: Append the entries**

```js
  // -- thread reactions (#10) ----------------------------------------------
  {
    name: 'a missing rating reads as 0',
    suite: 'tests/reactions.test.js',
    apply: (s) => s.replace(
      "rating: typeof raw.rating === 'number' && isFinite(raw.rating) ? Math.floor(raw.rating) : null,",
      'rating: toInt(raw.rating, 0),'),
  },
  {
    name: 'started threads with no figures count as known',
    suite: 'tests/reactions.test.js',
    apply: (s) => s.replace(
      "if (out.ratingThreads === 0 && out.viewsThreads === 0) { out.state = 'missing'; return out; }",
      "if (false) { out.state = 'missing'; return out; }"),
  },
  {
    name: 'threads you only posted in are counted',
    suite: 'tests/reactions.test.js',
    apply: (s) => s.replace('if (!t || t.started !== true) continue;', 'if (!t) continue;'),
  },
  {
    name: 'reaction figures never go stale',
    suite: 'tests/reactions.test.js',
    apply: (s) => s.replace('out.stale = toInt(now, 0) - out.updatedAt > staleMs;', 'out.stale = false;'),
  },
  {
    name: 'the normaliser always emits the reaction fields',
    suite: 'tests/storage.test.js',
    apply: (s) => s.replace('if (reactAt > 0 && (hasRating || hasViews)) {', 'if (true) {'),
  },
  {
    name: 'an unknown rating renders 0',
    suite: 'tests/panel.test.js',
    apply: (s) => s.replace(
      "var rating = known && r.rating !== null ? formatSigned(r.rating) : '-';",
      'var rating = formatSigned(r.rating);'),
  },
  {
    name: 'the reactions line renders while collapsed',
    suite: 'tests/panel.test.js',
    apply: (s) => s.replace(
      "    if (model.collapsed) return out.join('');",
      "    out.push(renderReactions(model));\n    if (model.collapsed) return out.join('');"),
  },
  {
    name: 'Settings drops the reactions cost sentence',
    suite: 'tests/panel.test.js',
    apply: (s) => s.replace(
      "'The rating and views under the title come from the same answer as My posts and make no request of their own.</p>'",
      "'</p>'"),
  },
```

- [ ] **Step 3: Run the mutation check**

Run: `node tests/mutation-check.mjs > mutation.log 2>&1`, then read `mutation.log` with the Read tool. Never pipe it.
Expected: every entry, old and new, reports its suite failed (mutant killed); exit 0; `git status` shows the userscript unchanged afterwards.

If a new mutant survives, the test is not proving the promise: fix the test, not the entry.

- [ ] **Step 4: Commit**

```bash
git add tests/mutation-check.mjs
git commit -m "test: mutation entries for the reactions tracker (#10)"
```

---

### Task 8: Docs, code map, and review

**Files:**
- Modify: `CHANGELOG.md`, `docs/qa-checklist.md`, `docs/architecture.md`, `README.md`, `docs/code-map.md`

- [ ] **Step 1: CHANGELOG**

Under the existing `## [Unreleased]` heading (replace `Nothing yet.` if still present), in its `### Added` list:

```markdown
- A line under the panel header totals Torn's rating and view count across the
  threads you started, from the same answer as My posts, at no extra request.
  It shows "-" until My posts has loaded and never shows a guessed zero. Torn's
  API has no thumbs-up, thumbs-down or subscriber count for a thread, so none is
  shown (#10).
```

Do **not** touch `@version`, `var SCRIPT_VERSION` or `package.json`.

- [ ] **Step 2: QA checklist**

Add a section `### Reactions tracker` after #2's My posts section in `docs/qa-checklist.md`, with exactly the nine items in the spec's "QA checklist additions", walked on Torn PDA and desktop.

- [ ] **Step 3: Architecture and README**

`docs/architecture.md`, under "Storage": one paragraph saying `tfcc:mine` records may carry optional `reactAt`, `rating`, `views`, why they are optional (the `loadKey` damage rule), and that the tracker makes no request. README feature list: one bullet, same wording as the CHANGELOG's first sentence.

- [ ] **Step 4: Verify**

Run: `npm test && npm run test:syntax && node tests/mutation-check.mjs > mutation.log 2>&1`, then read `mutation.log`.
Expected: all PASS; every mutant killed.

- [ ] **Step 5: Code map**

The file grew and declarations moved. Run `/code-map`, then check `docs/code-map.md` lists `applyReactions`, `reactionTotals`, `formatSigned`, `reactionsTitle`, `renderReactions`.

- [ ] **Step 6: Commit**

```bash
git add CHANGELOG.md docs/qa-checklist.md docs/architecture.md README.md docs/code-map.md
git commit -m "docs: changelog, QA and code map for the reactions tracker (#10)"
```

- [ ] **Step 7: Review and ship**

`/review`, then `/ship` (verify gate: `npm test`). The PR description states: no change to `@match`, `@grant` or `@connect`; no new request or endpoint; the contrast audit result; Task 0 status and what `rating` turned out to mean. No attribution footer.

Release is a separate commit by the owner, after `docs/qa-checklist.md` is walked and Task 0 is done (rule 8).

---

## If this merges first

Use this only if #10 must land before #2. It replaces nothing above: do F1 to F3 **first**, then Tasks 0 to 4 and 6 to 8 with the substitutions listed, and **skip Task 5**.

### Task F1: Land #2's record code verbatim

- [ ] Copy from #2's plan (`git show origin/docs/2-my-posts-plan:docs/superpowers/plans/2026-10-08-my-posts-view.md`), unchanged and with the same names: Task 1 Step 2's `forumThreadsPayload` only (not `forumPostsPayload`), and Task 2 in full **except** `minePostFromApi`: `STORAGE_KEYS.mine`, `MINE_MAX_THREADS`, `pickList`, `freshMine`, `freshMineThread`, `normaliseMineThread`, `normaliseMine`, `mineThreadFromApi`, the `state.mine` / `state.mineError` fields, and the `loadAll`, `persist` and `reset-all` lines. Add #2's two constants beside `DEFAULT_ENRICH_BUDGET`: `var MINE_TTL_MS = 15 * 60 * 1000;` and `var MINE_PAGE_LIMIT = 100;`. Bring #2's Task 2 tests for those functions with them.
- [ ] Run `npm test && npm run test:syntax`; commit `feat: tfcc:mine record, ahead of My posts (#10)`.

### Task F2: `mergeStartedReactions` (engine) in place of `mergeMineSnapshot`

- [ ] Failing test in `tests/reactions.test.js`:

```js
test('mergeStartedReactions marks started threads and never sets a baseline', () => {
  const started = [apiRow({ id: 5, rating: 3, views: 40, total: 12 })];
  const snap = api.mergeStartedReactions(api.freshMine(), started, NOW);
  const t = snap.threads.find((x) => x.id === 5);
  assert.strictEqual(t.started, true);
  assert.strictEqual(t.rating, 3);
  assert.strictEqual(snap.fetchedAt, NOW);
  // My posts sets the baseline on first sight of a total. Setting it here
  // would make My posts treat its first fetch as a second sighting.
  assert.strictEqual(t.totalKnown, false);
  assert.strictEqual(t.baselineTotal, 0);
});
```

- [ ] Implement after `applyReactions`:

```js
  // Interim, until My posts (#2) lands and mergeMineSnapshot replaces it.
  function mergeStartedReactions(prev, started, now) {
    var t0 = toInt(now, 0);
    var out = normaliseMine(prev);
    out.fetchedAt = t0;
    var byId = {};
    for (var i = 0; i < out.threads.length; i += 1) byId[String(out.threads[i].id)] = out.threads[i];
    for (var j = 0; j < (started || []).length; j += 1) {
      var s = started[j];
      if (!s) continue;
      var k = String(s.id);
      if (!Object.prototype.hasOwnProperty.call(byId, k)) {
        byId[k] = freshMineThread(s.id, t0);
        out.threads.push(byId[k]);
      }
      var r = byId[k];
      r.started = true;
      if (s.forumId) r.forumId = s.forumId;
      if (s.title) r.title = s.title;
      if (s.lastPostAt) r.lastPostAt = Math.max(r.lastPostAt, s.lastPostAt);
      r.isLocked = s.isLocked === true;
      if (!out.selfId && s.authorId) out.selfId = s.authorId;
      applyReactions(r, s, t0);
    }
    out.threads.sort(function (a, b) { return (b.lastPostAt - a.lastPostAt) || (b.id - a.id); });
    out.threads = out.threads.slice(0, MINE_MAX_THREADS);
    return out;
  }
```

- [ ] In Task 2 Step 3, skip the `mergeMineSnapshot` edit, and replace its test with the one above. Commit `feat: interim started-thread merge for the reactions line (#10)`.

### Task F3: `refreshReactions` (runtime), one request per tap

- [ ] Failing tests in a new `tests/reactions-refresh.test.js`, using the router transport the other refresh suites use (`grep -n "router\|transport" tests/refresh.test.js` for the helper): one tap makes exactly one request, to `user/forumthreads` with `limit=100`; a second tap within `MINE_TTL_MS` makes none; a tap after it makes one; two taps at once make one (single flight); no key makes none; a Reset everything mid-request drops the answer (`state.generation`); a failure detail containing the key is scrubbed; `refreshAll` never requests `user/forumthreads`.
- [ ] Implement directly after `enrichThreads`:

```js
  // Interim (#10 ahead of #2): one user/forumthreads request, only when the
  // user taps the reactions line, at most once per MINE_TTL_MS. Never called
  // by refresh, auto refresh or page load.
  function refreshReactions(now, opts) {
    if (state.refreshingReactions) return Promise.resolve({ ok: false, reason: 'inflight' });
    if (!isKeyShaped(loadApiKey())) return Promise.resolve({ ok: false, reason: 'nokey' });
    if (state.mine.fetchedAt > 0 && toInt(now, 0) - state.mine.fetchedAt < MINE_TTL_MS) {
      return Promise.resolve({ ok: true, reason: 'fresh' });
    }
    state.refreshingReactions = true;
    var generation = state.generation;
    return tornApiGet('user/forumthreads', { limit: MINE_PAGE_LIMIT }, opts || {})
      .then(function (res) {
        if (generation !== state.generation) return { ok: false, reason: 'stale' };
        if (!res.ok) {
          state.mineError = { reason: res.reason || 'network', detail: scrubDetail(res.detail || 'Could not load your threads.') };
          return { ok: false, reason: state.mineError.reason };
        }
        var list = pickList(res.data, ['forumThreads', 'forum_threads', 'threads']);
        if (!list) {
          state.mineError = { reason: 'parse', detail: 'Torn\'s answer for your threads was not in the shape this version expects.' };
          return { ok: false, reason: 'parse' };
        }
        state.mine = mergeStartedReactions(state.mine, list.map(mineThreadFromApi).filter(Boolean), now);
        state.mineError = null;
        persist('mine');
        return { ok: true };
      })
      .catch(function (e) {
        state.mineError = { reason: 'network', detail: scrubDetail((e && e.message) || 'Could not load your threads.') };
        return { ok: false, reason: 'network' };
      })
      .then(function (r) { state.refreshingReactions = false; return r; });
  }
```

Add `refreshingReactions: false,` to `state`. Add a handler branch beside `act === 'view'`:

```js
        if (act === 'reactions-load') {
          refreshReactions(now).then(function () { if (isForumsPage(win.location)) redraw(); });
          return;
        }
```

- [ ] Substitutions in later tasks: in Task 4's `renderReactions`, use `data-act="reactions-load"` with no `data-view`, and call `reactionsTitle(r, model.now, MINE_PAGE_LIMIT, 'Tap here')`; its tap test asserts `data-act="reactions-load"`, and its unloaded tooltip test expects `Not loaded yet. Tap here to load`. In Task 6, the sentence is `Tapping the rating and views under the title loads the threads you started: one request, at most once every ' + Math.round(MINE_TTL_MS / 60000) + ' minutes.`, appended to the existing note (which ends `'under 40 requests a minute regardless.</p>');`), and the debug count drops the `mineUnchecked` anchor (append after `cachedPosts`). Add one mutation entry: `name: 'the reactions fetch ignores its TTL'`, `suite: 'tests/reactions-refresh.test.js'`, replacing `toInt(now, 0) - state.mine.fetchedAt < MINE_TTL_MS` with `false`. The Task 7 Settings mutation targets the interim sentence.
- [ ] Budget: 1 request per tap, at most once per 15 minutes. Worst minute at defaults 13 + 1 = 14 of 40; at the maximum lookup setting 28 + 1 = 29. Default refresh unchanged.
- [ ] Commit `feat: load the threads you started on tap, ahead of My posts (#10)`.

### When #2 then merges (done in #2's PR)

1. `tfcc:mine` code is already on `main`: keep it, add only `minePostFromApi`; check it matches #2's Task 2 byte for byte apart from #10's additions.
2. Add `applyReactions(r, s, t0);` to `mergeMineSnapshot`'s started loop (this plan's Task 2 Step 3).
3. Delete `mergeStartedReactions`, `refreshReactions`, `state.refreshingReactions`, the `reactions-load` handler, `tests/reactions-refresh.test.js`, the F2 test, and the TTL mutation entry.
4. `renderReactions`: `data-act="view" data-view="mine"`, default opener; update the two tests.
5. Settings: replace the interim sentence with Task 6's; update the test and the Task 7 mutation entry.
6. Do this plan's Task 5.
7. A `fetchedAt` written by `refreshReactions` delays My posts' first automatic fetch by at most 15 minutes; Refresh in My posts overrides it. No migration needed.
8. Run `npm test`, `npm run test:syntax`, `node tests/mutation-check.mjs > mutation.log 2>&1` (read the log), then `/code-map`.
