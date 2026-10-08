# Thread Reactions Tracker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show one line under the panel header, `Your threads: 34 up, 5 down`, totalling the real thumbs up and thumbs down (the topic post's `likes` and `dislikes`) across the threads the key owner started, with Torn's `rating` as a labelled `net` fallback until a thread is checked, and `-` (never 0) when unknown.

**Architecture:** Two sources, both inside #2's `refreshMine`. #2's `user/forumthreads` answer supplies each started thread's `rating` at no extra cost. A new bounded loop, `enrichReactions`, reads `forum/{id}/posts?sort=ASC&offset=0` for at most `min(5, enrichBudget)` started threads per run, each at most once every 12 hours, and keeps the `is_topic` post's `likes`/`dislikes`. Both land as optional, canonically ordered fields on `tfcc:mine` records through one writer, `setReactionFields`. A pure `reactionTotals` sums them; the runtime renders a `.tfcc-subhead` block below `.tfcc-head`, after the collapsed early return.

**Tech Stack:** One ES5-style IIFE userscript (`torn-forum-command-center.user.js`), Node `node:test` suites run through the `vm` harness in `tests/load-userscript.js`. No dependencies.

**Spec:** `docs/superpowers/specs/2026-10-08-thread-reactions-tracker-design.md`. Read it first; where the two disagree, the spec wins and this plan is amended. Evidence: `docs/reference/torn-openapi-forum-excerpt-2026-10-08.json`.

**Prerequisite:** #2 (My posts, plan `docs/superpowers/plans/2026-10-08-my-posts-view.md` on `docs/2-my-posts-plan`) is merged to `main`. Tasks 1 to 10 assume its names: `freshMine`, `freshMineThread`, `normaliseMineThread`, `normaliseMine`, `mineThreadFromApi`, `mergeMineSnapshot`, `pickList`, `refreshMine`, `enrichMine` (returns `{ ok: true, stoppedEarly: true }` on a throttle), `MINE_PAGE_LIMIT`, `MINE_TTL_MS`, `state.mine`, `state.mineError`, row field `mineRole`, view id `mine`, `forumThreadsPayload`, `forumPostsPayload`. If this must merge first, follow "If this merges first" at the end.

## Global Constraints

- **Never read `torn-forum-command-center.user.js` whole.** For every symbol: `grep -n "function <name>\|var <name>" torn-forum-command-center.user.js`, then `Read` with `offset`/`limit`. `docs/code-map.md` may be stale; the grep is the truth.
- **ASCII only** in the userscript (`tests/metadata.test.js`). No emoji thumbs; the words `up`, `down`, `net`. Write `Torn\'s`, never a curly apostrophe.
- **Engine purity** (`tests/purity.test.js`): `isReactionNumber`, `setReactionFields`, `applyReactions`, `topicPostFromApi`, `applyTopicPost`, `reactionLookupTargets`, `reactionTotals`, `formatSigned`, `reactionsTitle` live between `// ---- ENGINE START` and `// ---- ENGINE END`; time is an argument.
- **Budget:** default Threads refresh <= 13, unchanged. My posts run <= 2 + `enrichBudget` + `min(5, enrichBudget)`: 17 at defaults, 2 at 0, 32 at 25. Limiter 40 per rolling minute. Topic lookups run only inside `refreshMine`, after #2's lookups, never after a throttle. The Settings note states these numbers, computed from the constants.
- **Up and down are only ever sums of real topic-post counts.** `rating` is shown only as `net`, never split, added to or subtracted from them.
- **Unknown is `-`, never `0`.** Numbers are read with `isReactionNumber` (`typeof`, `isFinite`); `toInt(null, 0)` is 0, which is the trap.
- **No subscriber figure.** Torn's API has none; every tooltip ends `Torn\'s API has no subscriber count, so none is shown.`
- **Upgrade safety:** the five record fields (`reactAt`, `rating`, `topicAt`, `up`, `down`) are optional, written only through `setReactionFields`, in that order. No top-level field, no new key, no new setting.
- **Post `content`** is never read, stored, rendered or reported.
- **No change to `.tfcc-head`'s contents or `.tfcc-title`.** Hidden when collapsed, without a key, in loading/fatal shells, and when no threads were started.
- **Read-only**, `@match`/`@grant`/`@connect` unchanged, no DOM data path (ADR 0001), errors through `scrubDetail`.
- **Mutation check:** `node tests/mutation-check.mjs > mutation.log 2>&1`, then read `mutation.log`. Never pipe it into `head` or anything that closes the pipe.
- **Commits:** Conventional Commits, no attribution trailer of any kind.
- **Release convention (rule 8):** the feature PR adds only a CHANGELOG entry under `## [Unreleased]`. It never touches `@version`, `SCRIPT_VERSION` or `package.json`.

## Review Focus

1. **Upgrade with a `tfcc:mine` written before this feature** must load with no "damaged" notice; #8's `isRecoveredValue` forgives top-level keys only and does not cover these nested fields. Pinned in Task 2 (`tests/storage.test.js`) and by a mutation.
2. **A topic post with `likes: null`, or a page with no `is_topic` post,** must fall back to `net`, never show `0 up`. Pinned in Task 3.
3. **A max-budget Threads refresh followed by My posts** must never put a 41st request in the minute, and topic lookups must not start after #2's lookups were throttled. Pinned in Task 5.
4. **Narrowest PDA width:** the tracker must not push Refresh, Expand or Hide off the header row. Pinned structurally in Task 6 and by QA.
5. **A thread with both thumbs and a rating** must count once (by thumbs). Pinned in Task 4.

## Files in scope

| File | Change |
|---|---|
| `torn-forum-command-center.user.js` | Engine: the nine functions above, `mineThreadFromApi` field, `normaliseMineThread` fields, `mergeMineSnapshot` call, `NO_SUBSCRIBERS`. Runtime: constants, `enrichReactions`, `refreshMine` hook, model field, `renderReactions`, `panelHtml`, styles, `mergeThreads` row fields, `renderRow` meta, Settings note, debug counts. |
| `tests/load-userscript.js` | `EXPORT_NAMES`; `forumThreadsPayload` gains `rating`; new `threadPostsPayload` |
| `tests/reactions.test.js`, `tests/reactions-lookups.test.js` | New |
| `tests/storage.test.js`, `tests/panel.test.js`, `tests/style.test.js`, `tests/debug-report.test.js`, `tests/read-only.test.js` | Extended |
| `tests/render-preview.mjs` | Seed figures |
| `tests/mutation-check.mjs` | Thirteen entries |
| `CHANGELOG.md`, `docs/qa-checklist.md`, `docs/architecture.md`, `README.md`, `docs/code-map.md` | Docs |

## Stop conditions

Stop and amend the spec if: Task 0 finds the topic post's likes/dislikes differ from the thumbs on Torn's thread page; a request outside `user/forumthreads`, `user/forumposts`, `forum/{id}/thread`, `forum/{id}/posts` is needed; topic lookups would run outside `refreshMine`; a My posts run would exceed 2 + `enrichBudget` + 5; anything derives up or down from `rating`; any label says "like" or "subscriber" as a figure; an element is added inside `.tfcc-head`; a new key, setting or top-level field is needed.

---

### Task 0: Live evidence (owner, signed in; not code)

Shared with #2's plan Task 0. Do it once for both.

- [ ] **Step 1:** Request `https://api.torn.com/v2/user/forumthreads?limit=100` with your Minimal key. Remove `title` and every `username` value; keep every key and number, including `rating`. Commit as `tests/fixtures/user-forumthreads.json` (or check #2's copy has `rating`).
- [ ] **Step 2:** Confirm `rating` is present and numeric on every row.
- [ ] **Step 3 (paging):** For one of your threads with more than 20 posts, request `forum/<id>/posts?sort=ASC&offset=0` and `forum/<id>/posts?offset=0` (no sort). Record: is the first post of the `ASC` page `is_topic: true`? What order does the unsorted page use? Does a pinned reply move? Remove `content` and usernames; commit the `ASC` page as `tests/fixtures/forum-thread-posts-asc.json`. If `ASC` does not put the topic first, change `TOPIC_POST_PARAMS` (Task 5) per spec open question 2 before Task 5.
- [ ] **Step 4 (meaning):** For the same thread, note Torn's thumbs up, thumbs down on its thread page, the topic post's `likes`/`dislikes`, and the thread's `rating`. Record in the spec's open question 1 whether likes = up, dislikes = down, and rating = up - down. **If likes/dislikes differ from Torn's thumbs, stop** (stop condition).
- [ ] **Step 5:** Check whether `forum/<id>/posts` page 1 ever has two `is_topic` posts (it should not).

**Release gate:** steps 3 and 4 gate the release, not only the code (spec, "Release gate"). Until both are recorded as passing in the spec's "What is verified" table, Tasks 1 to 10 may be built and reviewed but no tag may carry this feature.

Commit: `git add tests/fixtures docs/superpowers/specs/2026-10-08-thread-reactions-tracker-design.md && git commit -m "test: live fixtures for thread rating and topic post thumbs (#10)"`

---

### Task 1: Harness exports and payload builders

**Files:**
- Modify: `tests/load-userscript.js`

**Interfaces:**
- Consumes: #2's `forumThreadsPayload(threads)`.
- Produces: `forumThreadsPayload` rows carry `rating` (from `t.rating`, default `0`, omitted when `t.noRating`); `threadPostsPayload(posts) -> { posts: ForumPost[], _metadata }` where each input `{ id, threadId, isTopic, likes, dislikes, noLikes, isPinned, at, content }`. Export names for every function and constant in this plan (undefined until defined; harmless).

- [ ] **Step 1: Edit `forumThreadsPayload`**

After `is_sticky: false,` add:

```js
      // ForumThreadBase requires rating (docs/reference/torn-openapi-forum-excerpt-2026-10-08.json).
      ...(t.noRating ? {} : { rating: t.rating === undefined ? 0 : t.rating }),
```

- [ ] **Step 2: Add `threadPostsPayload`** after `forumPostsPayload`, and add it to `module.exports`:

```js
// forum/{threadId}/posts, ForumPostsResponse. Every ForumPost field the schema
// requires, so a normaliser that reads the wrong one fails here, not live.
function threadPostsPayload(posts) {
  return {
    posts: posts.map((p) => ({
      id: p.id,
      thread_id: p.threadId,
      author: p.author || { id: 7, username: 'me', karma: 1 },
      is_legacy: false,
      is_topic: p.isTopic === true,
      is_edited: false,
      is_pinned: p.isPinned === true,
      created_time: p.at === undefined ? 1600000000 : p.at,
      edited_by: null,
      has_quote: false,
      quoted_post_id: null,
      content: p.content === undefined ? 'SECRET TOPIC BODY ' + p.id : p.content,
      ...(p.noLikes ? {} : { likes: p.likes === undefined ? 0 : p.likes, dislikes: p.dislikes === undefined ? 0 : p.dislikes }),
    })),
    _metadata: { links: { prev: null, next: null } },
  };
}
```

- [ ] **Step 3: Export names.** In `EXPORT_NAMES`, after #2's my-posts names:

```js
  // thread reactions (#10)
  'isReactionNumber', 'setReactionFields', 'applyReactions', 'topicPostFromApi', 'applyTopicPost',
  'reactionLookupTargets', 'reactionTotals', 'formatSigned', 'reactionsTitle', 'renderReactions',
  'enrichReactions', 'REACTIONS_STALE_MS', 'TOPIC_TTL_MS', 'REACTION_LOOKUPS_PER_RUN', 'TOPIC_POST_PARAMS',
  'MAX_ENRICH_BUDGET', 'DEFAULT_ENRICH_BUDGET', 'REQUESTS_PER_WINDOW',
```

(Skip any name `EXPORT_NAMES` already lists.)

- [ ] **Step 4:** Run `npm test`. Expected: PASS, same count as before.

- [ ] **Step 5: Commit**

```bash
git add tests/load-userscript.js
git commit -m "test: harness builders for thread rating and topic posts (#10)"
```

---

### Task 2: The record fields, their single writer, and the net rating

**Files:**
- Modify: `torn-forum-command-center.user.js` - in #2's `// -- my posts` engine section: `mineThreadFromApi`, `normaliseMineThread`, `mergeMineSnapshot`; new `isReactionNumber`, `setReactionFields`, `applyReactions` directly after `mineThreadFromApi`.
- Create: `tests/reactions.test.js`
- Modify: `tests/storage.test.js`

**Interfaces:**
- Produces:
  - `isReactionNumber(v, allowNegative) -> boolean`
  - `REACTION_FIELDS = ['reactAt', 'rating', 'topicAt', 'up', 'down']` (engine `var`)
  - `setReactionFields(rec, changes) -> rec`: for each of the five keys, the value is `changes[k]` if `changes` has own key `k`, else `rec[k]`; all five are deleted, then each numeric value is re-added in `REACTION_FIELDS` order. `null` clears.
  - `applyReactions(rec, row, now) -> rec`: when `row.rating` is a number, `setReactionFields(rec, { reactAt: now, rating: row.rating })`; otherwise unchanged.
  - `mineThreadFromApi(raw)` gains `rating: number | null`.

- [ ] **Step 1: Write the failing tests**

Create `tests/reactions.test.js`:

```js
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { loadUserscript, forumThreadsPayload, threadPostsPayload } = require('./load-userscript');

const { exports: api } = loadUserscript();
const NOW = 1700000000000;
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

function apiRow(t) {
  return api.mineThreadFromApi(forumThreadsPayload([Object.assign({ id: 5 }, t)]).forumThreads[0]);
}

function started(id, fields, lastPostAt) {
  const rec = api.freshMineThread(id, NOW);
  rec.started = true;
  if (lastPostAt) rec.lastPostAt = lastPostAt;
  if (fields) api.setReactionFields(rec, fields);
  return rec;
}

function mineOf(threads, fetchedAt) {
  return Object.assign(api.freshMine(), { fetchedAt: fetchedAt === undefined ? NOW : fetchedAt, threads });
}

test('rating is read from user/forumthreads, negatives and zero included', () => {
  assert.strictEqual(apiRow({ rating: 7 }).rating, 7);
  assert.strictEqual(apiRow({ rating: -3 }).rating, -3);
  assert.strictEqual(apiRow({ rating: 0 }).rating, 0);
});

test('an absent, null or string rating is unknown, never 0', () => {
  // toInt(null, 0) is 0: the exact way a missing rating becomes a confident zero.
  assert.strictEqual(apiRow({ noRating: true }).rating, null);
  assert.strictEqual(apiRow({ rating: null }).rating, null);
  assert.strictEqual(apiRow({ rating: '7' }).rating, null);
});

test('setReactionFields keeps one canonical order whatever the write order', () => {
  const a = api.freshMineThread(5, NOW);
  api.setReactionFields(a, { topicAt: NOW, up: 1, down: 0 });
  api.setReactionFields(a, { reactAt: NOW, rating: 1 });
  assert.deepStrictEqual(Object.keys(a).slice(-5), ['reactAt', 'rating', 'topicAt', 'up', 'down']);
  const b = api.freshMineThread(5, NOW);
  api.setReactionFields(b, { reactAt: NOW, rating: 1 });
  api.setReactionFields(b, { topicAt: NOW, up: 1, down: 0 });
  assert.deepStrictEqual(Object.keys(b), Object.keys(a));
});

test('setReactionFields clears a field set to null and leaves unnamed ones', () => {
  const r = started(5, { reactAt: NOW, rating: 2, topicAt: NOW, up: 3, down: 1 });
  api.setReactionFields(r, { topicAt: NOW + 1, up: null, down: null });
  assert.strictEqual('up' in r, false);
  assert.strictEqual('down' in r, false);
  assert.strictEqual(r.rating, 2);
  assert.strictEqual(r.topicAt, NOW + 1);
});

test('applyReactions dates a new rating; a row without one leaves the old to age', () => {
  const r = api.freshMineThread(5, NOW);
  api.applyReactions(r, { rating: 4 }, NOW);
  assert.strictEqual(r.reactAt, NOW);
  api.applyReactions(r, { rating: null }, NOW + DAY);
  assert.strictEqual(r.rating, 4);
  assert.strictEqual(r.reactAt, NOW, 'old figures age; they are not re-dated');
});

test('mergeMineSnapshot stores the rating on started threads', () => {
  const snap = api.mergeMineSnapshot(api.freshMine(), [apiRow({ id: 5, rating: 3 })], [], NOW, true);
  const t = snap.threads.find((x) => x.id === 5);
  assert.strictEqual(t.started, true);
  assert.strictEqual(t.rating, 3);
  assert.strictEqual(t.reactAt, NOW);
});

test('the normaliser keeps whole pairs, drops halves, and reads its own output back', () => {
  const base = api.freshMineThread(5, NOW);
  const n = (extra) => api.normaliseMineThread(Object.assign({}, base, extra));
  assert.strictEqual('rating' in n({ rating: 3 }), false, 'rating without reactAt');
  assert.strictEqual('reactAt' in n({ reactAt: NOW }), false, 'reactAt without rating');
  assert.strictEqual('up' in n({ topicAt: NOW, up: 3 }), false, 'up without down');
  assert.strictEqual('up' in n({ up: 3, down: 1 }), false, 'thumbs without topicAt');
  assert.strictEqual(n({ topicAt: NOW }).topicAt, NOW, 'checked, not found, is kept');
  assert.strictEqual('up' in n({ topicAt: NOW, up: -1, down: 1 }), false, 'a negative count is not a count');

  const full = started(5, { reactAt: NOW, rating: -2, topicAt: NOW, up: 0, down: 2 });
  const mine = mineOf([full]);
  assert.deepStrictEqual(api.normaliseMine(JSON.parse(JSON.stringify(mine))), mine);
});
```

Append to `tests/storage.test.js`:

```js
// The reaction fields (#10) are nested inside tfcc:mine.threads[], where #8's
// isRecoveredValue (top-level keys only) does not reach. They are optional so
// that an older blob round-trips byte for byte.
function reactionRoundTrip(api, rec) {
  const mine = Object.assign(api.freshMine(), { fetchedAt: 1000, threads: [rec] });
  api.saveKey(api.STORAGE_KEYS.mine, mine);
  return { mine, back: api.loadKey(api.STORAGE_KEYS.mine, api.normaliseMine, 9000) };
}

test('a tfcc:mine written before the reactions tracker loads silently', () => {
  const { exports: api } = loadUserscript();
  const old = api.freshMineThread(9, 1000);
  old.started = true;
  const { back } = reactionRoundTrip(api, old);
  assert.strictEqual(back.recovered, false);
  assert.deepStrictEqual(Object.keys(back.value.threads[0]), Object.keys(old));
});

test('records that gained reactions in either order reload undamaged', () => {
  const { exports: api } = loadUserscript();
  const a = api.freshMineThread(9, 1000);
  api.applyReactions(a, { rating: 2 }, 1000);
  api.setReactionFields(a, { topicAt: 2000, up: 3, down: 1 });
  const b = api.freshMineThread(9, 1000);
  api.setReactionFields(b, { topicAt: 2000, up: 3, down: 1 });
  api.applyReactions(b, { rating: 2 }, 1000);
  const c = api.freshMineThread(9, 1000);
  api.setReactionFields(c, { topicAt: 2000, up: null, down: null });
  for (const [label, rec] of [['rating then thumbs', a], ['thumbs then rating', b], ['checked, not found', c]]) {
    const { mine, back } = reactionRoundTrip(api, rec);
    assert.strictEqual(back.recovered, false, label + ' called its own output damaged');
    assert.deepStrictEqual(back.value, mine, label);
  }
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `node --test tests/reactions.test.js tests/storage.test.js`
Expected: FAIL, `rating` undefined and `api.setReactionFields is not a function`.

The "older blob loads silently" test passes before Step 3, because no field exists yet. It is the regression guard for the upgrade trap. Prove it bites before committing: temporarily add `t.topicAt = 0;` before `return t;` in `normaliseMineThread`, run `node --test tests/storage.test.js`, see it FAIL with `recovered` true, and remove the line. Task 9's mutation makes this permanent. Do not weaken it if #8 lands.

- [ ] **Step 3: Implement**

In `mineThreadFromApi`'s returned object, after `isLocked: raw.is_locked === true,`:

```js
      // ForumThreadBase.rating (OpenAPI 6.13.8, undocumented). Shown only as
      // "net"; never split into thumbs.
      rating: isReactionNumber(raw.rating, true) ? Math.floor(raw.rating) : null,
```

Directly after `mineThreadFromApi`:

```js
  // -- thread reactions: record fields (#10) --------------------------------
  // Five optional fields on a tfcc:mine record, always in this order. They are
  // nested inside threads[], so a default here would make loadKey call every
  // upgrading user's cache damaged; absent means unknown instead. Every write
  // goes through setReactionFields, so any write order serialises the way
  // normaliseMineThread writes it.
  var REACTION_FIELDS = ['reactAt', 'rating', 'topicAt', 'up', 'down'];

  function isReactionNumber(v, allowNegative) {
    return typeof v === 'number' && isFinite(v) && (allowNegative === true || v >= 0);
  }

  function setReactionFields(rec, changes) {
    var vals = {};
    var i;
    for (i = 0; i < REACTION_FIELDS.length; i += 1) {
      var k = REACTION_FIELDS[i];
      vals[k] = Object.prototype.hasOwnProperty.call(changes, k) ? changes[k] : rec[k];
      delete rec[k];
    }
    for (i = 0; i < REACTION_FIELDS.length; i += 1) {
      var key = REACTION_FIELDS[i];
      if (typeof vals[key] === 'number') rec[key] = vals[key];
    }
    return rec;
  }

  // A row with no rating leaves the old one alone, so it ages into stale
  // rather than vanishing or turning into a zero.
  function applyReactions(rec, row, now) {
    if (!rec || !row || typeof row.rating !== 'number') return rec;
    return setReactionFields(rec, { reactAt: Math.max(0, toInt(now, 0)), rating: row.rating });
  }
```

In `normaliseMineThread`, directly before its `return t;`:

```js
    // Optional reaction fields (#10): canonical order, whole pairs only.
    var reactAt = Math.max(0, toInt(raw.reactAt, 0));
    var topicAt = Math.max(0, toInt(raw.topicAt, 0));
    var rx = {};
    if (reactAt > 0 && isReactionNumber(raw.rating, true)) {
      rx.reactAt = reactAt;
      rx.rating = Math.floor(raw.rating);
    }
    if (topicAt > 0) {
      rx.topicAt = topicAt;
      if (isReactionNumber(raw.up, false) && isReactionNumber(raw.down, false)) {
        rx.up = Math.floor(raw.up);
        rx.down = Math.floor(raw.down);
      }
    }
    setReactionFields(t, rx);
```

In `mergeMineSnapshot`'s started loop, directly after `if (s.totalKnown) observeMineTotal(r, s.postsTotal, t0);`:

```js
      applyReactions(r, s, t0);
```

- [ ] **Step 4:** Run `node --test tests/reactions.test.js tests/storage.test.js && npm test && npm run test:syntax`. Expected: PASS (purity and ASCII included).

- [ ] **Step 5: Commit**

```bash
git add torn-forum-command-center.user.js tests/reactions.test.js tests/storage.test.js
git commit -m "feat: optional reaction fields on My posts records, and the net rating (#10)"
```

---

### Task 3: Reading the topic post, and choosing which threads to check

**Files:**
- Modify: `torn-forum-command-center.user.js` - engine, after `applyReactions`; constants beside `DEFAULT_ENRICH_BUDGET` (`grep -n "var DEFAULT_ENRICH_BUDGET"`).
- Modify: `tests/reactions.test.js`

**Interfaces:**
- Produces:
  - `TOPIC_TTL_MS = 12 * 60 * 60 * 1000`, `REACTION_LOOKUPS_PER_RUN = 5` (runtime constants, passed into engine functions as arguments)
  - `topicPostFromApi(data, threadId) -> { up, down } | null | undefined`
  - `applyTopicPost(snap, threadId, topic, now) -> snap` (new object; input not mutated)
  - `reactionLookupTargets(snap, now, ttl, n) -> number[]`

- [ ] **Step 1: Write the failing tests** (append to `tests/reactions.test.js`)

```js
test('the topic post supplies thumbs up and down', () => {
  const page = threadPostsPayload([
    { id: 1, threadId: 5, isTopic: true, likes: 12, dislikes: 3 },
    { id: 2, threadId: 5, likes: 99, dislikes: 99 },
  ]);
  assert.deepStrictEqual(api.topicPostFromApi(page, 5), { up: 12, down: 3 });
});

test('the topic post is found wherever it sits on the page, and zero is a real count', () => {
  const page = threadPostsPayload([
    { id: 2, threadId: 5, isPinned: true, likes: 50, dislikes: 0 },
    { id: 1, threadId: 5, isTopic: true, likes: 0, dislikes: 0 },
  ]);
  assert.deepStrictEqual(api.topicPostFromApi(page, 5), { up: 0, down: 0 });
});

test('no usable topic post is null, never a zero', () => {
  assert.strictEqual(api.topicPostFromApi(threadPostsPayload([{ id: 2, threadId: 5, likes: 4 }]), 5), null);
  assert.strictEqual(api.topicPostFromApi(threadPostsPayload([{ id: 1, threadId: 6, isTopic: true, likes: 4 }]), 5), null,
    'a topic post from another thread');
  assert.strictEqual(api.topicPostFromApi(threadPostsPayload([{ id: 1, threadId: 5, isTopic: true, likes: null, dislikes: 1 }]), 5), null);
  assert.strictEqual(api.topicPostFromApi(threadPostsPayload([{ id: 1, threadId: 5, isTopic: true, noLikes: true }]), 5), null);
});

test('the live opening-post page (plan Task 0) yields real thumbs', {
  skip: !require('node:fs').existsSync(require('node:path').join(__dirname, 'fixtures', 'forum-thread-posts-asc.json'))
    && 'Task 0 fixture not captured yet',
}, () => {
  // The builders above are assumptions until this fixture exists; this ties the
  // reader to Torn's real field names, not to our own payload builder.
  const page = JSON.parse(require('node:fs').readFileSync(
    require('node:path').join(__dirname, 'fixtures', 'forum-thread-posts-asc.json'), 'utf8'));
  const topic = page.posts.find((p) => p.is_topic === true);
  assert.ok(topic, 'the ASC page must contain the topic post');
  assert.deepStrictEqual(api.topicPostFromApi(page, topic.thread_id), { up: topic.likes, down: topic.dislikes });
});

test('an unrecognised answer is undefined, so nothing is stamped', () => {
  assert.strictEqual(api.topicPostFromApi({}, 5), undefined);
  assert.strictEqual(api.topicPostFromApi({ posts: 'x' }, 5), undefined);
  assert.strictEqual(api.topicPostFromApi(null, 5), undefined);
});

test('the post body never reaches the result', () => {
  const page = threadPostsPayload([{ id: 1, threadId: 5, isTopic: true, likes: 1, dislikes: 1 }]);
  assert.strictEqual(JSON.stringify(api.topicPostFromApi(page, 5)).indexOf('SECRET'), -1);
});

test('applyTopicPost stamps the check, and a miss clears old thumbs', () => {
  const snap = mineOf([started(5)]);
  const hit = api.applyTopicPost(snap, 5, { up: 3, down: 1 }, NOW);
  assert.strictEqual(hit.threads[0].up, 3);
  assert.strictEqual(hit.threads[0].topicAt, NOW);
  assert.strictEqual('up' in snap.threads[0], false, 'input not mutated');
  const miss = api.applyTopicPost(hit, 5, null, NOW + 1);
  assert.strictEqual('up' in miss.threads[0], false);
  assert.strictEqual(miss.threads[0].topicAt, NOW + 1);
});

test('lookup targets: started only, never-checked newest first, then oldest check, TTL and cap', () => {
  const TTL = api.TOPIC_TTL_MS;
  assert.strictEqual(TTL, 12 * HOUR, 'the Settings text promises 12 hours');
  assert.strictEqual(api.REACTION_LOOKUPS_PER_RUN, 5, 'the Settings text promises 5');
  const posted = api.freshMineThread(9, NOW);
  posted.posted = true;
  const mine = mineOf([
    started(1, null, 100),
    started(2, null, 200),
    started(3, { topicAt: NOW - TTL }, 900),
    started(4, { topicAt: NOW - TTL + 1 }, 999),
    started(6, { topicAt: NOW - TTL - 5 }, 50),
    posted,
  ]);
  assert.deepStrictEqual(api.reactionLookupTargets(mine, NOW, TTL, 10), [2, 1, 6, 3]);
  assert.deepStrictEqual(api.reactionLookupTargets(mine, NOW, TTL, 2), [2, 1]);
  assert.deepStrictEqual(api.reactionLookupTargets(mine, NOW, TTL, 0), []);
});
```

- [ ] **Step 2:** Run `node --test tests/reactions.test.js`. Expected: FAIL, `api.topicPostFromApi is not a function`.

- [ ] **Step 3: Implement**

Beside `var DEFAULT_ENRICH_BUDGET = 10;`:

```js
  // Thread reactions (#10). Thumbs change slowly, so each started thread's
  // opening post is read at most once per TOPIC_TTL_MS, and at most
  // min(REACTION_LOOKUPS_PER_RUN, enrichBudget) per My posts run.
  var TOPIC_TTL_MS = 12 * 60 * 60 * 1000;
  var REACTION_LOOKUPS_PER_RUN = 5;
  // ASC + offset 0: the opening post is the oldest, so it leads page one.
  // Unverified until plan Task 0 step 3; if Torn ignores sort in offset mode,
  // this is the one line to change.
  var TOPIC_POST_PARAMS = Object.freeze({ sort: 'ASC', offset: 0 });
```

After `applyReactions`:

```js
  // forum/{id}/posts page one. Only a post Torn flags is_topic counts, and only
  // with two real counts; `content` is never read. undefined = shape not
  // recognised (stamp nothing, retry next run); null = no usable topic post
  // (stamp the check, fall back to net, retry after the TTL).
  function topicPostFromApi(data, threadId) {
    var list = pickList(data, ['posts']);
    if (!list) return undefined;
    var id = toInt(threadId, 0);
    for (var i = 0; i < list.length; i += 1) {
      var p = list[i];
      if (!isPlainObject(p) || p.is_topic !== true) continue;
      if (p.thread_id !== undefined && toInt(p.thread_id, 0) !== id) continue;
      if (!isReactionNumber(p.likes, false) || !isReactionNumber(p.dislikes, false)) return null;
      return { up: Math.floor(p.likes), down: Math.floor(p.dislikes) };
    }
    return null;
  }

  function applyTopicPost(snap, threadId, topic, now) {
    var out = normaliseMine(snap);
    var id = toInt(threadId, 0);
    for (var i = 0; i < out.threads.length; i += 1) {
      if (out.threads[i].id !== id) continue;
      setReactionFields(out.threads[i], {
        topicAt: Math.max(0, toInt(now, 0)),
        up: topic ? topic.up : null,
        down: topic ? topic.down : null,
      });
    }
    return out;
  }

  function reactionLookupTargets(snap, now, ttl, n) {
    var cap = Math.max(0, toInt(n, 0));
    if (!cap || !isPlainObject(snap) || !Array.isArray(snap.threads)) return [];
    var t0 = toInt(now, 0);
    var due = snap.threads.filter(function (r) {
      if (!r || r.started !== true) return false;
      var at = toInt(r.topicAt, 0);
      return at <= 0 || t0 - at >= ttl;
    });
    due.sort(function (a, b) {
      var ac = toInt(a.topicAt, 0) > 0 ? 1 : 0;
      var bc = toInt(b.topicAt, 0) > 0 ? 1 : 0;
      if (ac !== bc) return ac - bc;
      if (ac === 0) return (b.lastPostAt - a.lastPostAt) || (b.id - a.id);
      return (toInt(a.topicAt, 0) - toInt(b.topicAt, 0)) || (b.id - a.id);
    });
    return due.slice(0, cap).map(function (r) { return r.id; });
  }
```

- [ ] **Step 4:** Run `node --test tests/reactions.test.js && npm test && npm run test:syntax`. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add torn-forum-command-center.user.js tests/reactions.test.js
git commit -m "feat: read thumbs from a thread's topic post, bounded by a 12h TTL (#10)"
```

---

### Task 4: Totals, the signed formatter, and the tooltip

**Files:**
- Modify: `torn-forum-command-center.user.js` - engine, after `reactionLookupTargets`; `REACTIONS_STALE_MS` beside `TOPIC_TTL_MS`.
- Modify: `tests/reactions.test.js`

**Interfaces:**
- Consumes: `formatCount`, `formatRelativeTime`, `plural` (engine).
- Produces:
  - `REACTIONS_STALE_MS = 24 * 60 * 60 * 1000`
  - `formatSigned(n) -> string`
  - `reactionTotals(mine, now, staleMs) -> { state, started, up, down, thumbThreads, net, netThreads, updatedAt, stale }`
  - `NO_SUBSCRIBERS` (engine `var`), `reactionsTitle(totals, now, pageLimit, opener?) -> string`

- [ ] **Step 1: Write the failing tests** (append to `tests/reactions.test.js`)

```js
const thumbs = (up, down, at) => ({ topicAt: at === undefined ? NOW : at, up, down });
const net = (rating, at) => ({ reactAt: at === undefined ? NOW : at, rating });

test('formatSigned', () => {
  assert.strictEqual(api.formatSigned(12), '+12');
  assert.strictEqual(api.formatSigned(0), '0');
  assert.strictEqual(api.formatSigned(-3), '-3');
  assert.strictEqual(api.formatSigned(1200), '+1.2k');
  assert.strictEqual(api.formatSigned(-1200), '-1.2k');
});

test('unloaded, empty and missing are three different things', () => {
  assert.strictEqual(api.reactionTotals(api.freshMine(), NOW, DAY).state, 'unloaded');
  assert.strictEqual(api.reactionTotals(mineOf([]), NOW, DAY).state, 'empty');
  const missing = api.reactionTotals(mineOf([started(1), started(2, { topicAt: NOW })]), NOW, DAY);
  assert.strictEqual(missing.state, 'missing');
  assert.strictEqual(missing.up, null);
  assert.strictEqual(missing.net, null);
});

test('thumbs sum real topic counts; zero is a known zero', () => {
  const r = api.reactionTotals(mineOf([started(1, thumbs(10, 2)), started(2, thumbs(0, 0))]), NOW, DAY);
  assert.strictEqual(r.state, 'known');
  assert.strictEqual(r.up, 10);
  assert.strictEqual(r.down, 2);
  assert.strictEqual(r.thumbThreads, 2);
  assert.strictEqual(r.net, null);
});

test('a thread counts once: by thumbs when it has them, else by net', () => {
  const both = Object.assign(net(500), thumbs(4, 1));
  const r = api.reactionTotals(mineOf([started(1, both), started(2, net(-3)), started(3)]), NOW, DAY);
  assert.strictEqual(r.up, 4);
  assert.strictEqual(r.down, 1);
  assert.strictEqual(r.net, -3, 'thread 1 is not also counted as net');
  assert.strictEqual(r.netThreads, 1);
  assert.strictEqual(r.started, 3);
});

test('net is never split into thumbs', () => {
  const r = api.reactionTotals(mineOf([started(1, net(12))]), NOW, DAY);
  assert.strictEqual(r.state, 'known');
  assert.strictEqual(r.up, null);
  assert.strictEqual(r.down, null);
  assert.strictEqual(r.net, 12);
});

test('threads you only posted in are not counted', () => {
  const posted = api.freshMineThread(9, NOW);
  posted.posted = true;
  api.setReactionFields(posted, thumbs(500, 500));
  const r = api.reactionTotals(mineOf([started(1, thumbs(1, 2)), posted]), NOW, DAY);
  assert.strictEqual(r.up, 1);
  assert.strictEqual(r.started, 1);
});

test('stale strictly after the threshold, from the newest contributing check', () => {
  const mine = mineOf([started(1, thumbs(1, 1, NOW - 2 * DAY)), started(2, net(1, NOW))]);
  assert.strictEqual(api.reactionTotals(mine, NOW + DAY, DAY).stale, false);
  assert.strictEqual(api.reactionTotals(mine, NOW + DAY + 1, DAY).stale, true);
  assert.strictEqual(api.reactionTotals(mine, NOW, DAY).updatedAt, NOW);
  assert.strictEqual(api.REACTIONS_STALE_MS, DAY);
});

test('tooltips name the state, the coverage and the missing subscribers', () => {
  const L = 100;
  const T = (mine, now, opener) => api.reactionsTitle(api.reactionTotals(mine, now || NOW, DAY), now || NOW, L, opener);
  const SUBS = ' Torn\'s API has no subscriber count, so none is shown.';
  assert.strictEqual(T(api.freshMine()), 'Not loaded yet. Open My posts to load the threads you started.' + SUBS);
  assert.strictEqual(T(mineOf([started(1)])), 'Torn has not reported thumbs or a rating for your threads yet.' + SUBS);
  assert.strictEqual(T(mineOf([started(1, thumbs(1, 1, NOW - 5 * 60000))])),
    'Thumbs up and down from the opening post of 1 of 1 thread you started. Updated 5m ago.' + SUBS);
  assert.strictEqual(T(mineOf([started(1, thumbs(1, 1)), started(2, net(3)), started(3, net(1))])),
    'Thumbs up and down from the opening post of 1 of 3 threads you started. '
    + '2 more show Torn\'s net rating until checked. Updated just now.' + SUBS);
  assert.strictEqual(T(mineOf([started(1, net(3))])),
    'Torn\'s net rating for 1 of 1 thread you started; thumbs up and down appear once its opening post is checked. '
    + 'Updated just now.' + SUBS);
  assert.match(T(mineOf([started(1, thumbs(1, 1, NOW - 3 * DAY))])), /Updated 3d ago\. Open My posts to update\. Torn/);
  assert.match(T(api.freshMine(), NOW, 'Tap here'), /^Not loaded yet\. Tap here to load/);
  const many = mineOf(Array.from({ length: 100 }, (_, i) => started(i + 1, thumbs(1, 0))));
  assert.match(T(many), /Torn sends your newest 100 threads per request/);
});
```

Check first: `grep -n "function plural" torn-forum-command-center.user.js` (`plural(n, one, many)` returns `one` when n is 1, else `many`, defaulting to `one + 's'`) and `formatRelativeTime(NOW, NOW)` returns `'just now'`.

- [ ] **Step 2:** Run `node --test tests/reactions.test.js`. Expected: FAIL, `api.formatSigned is not a function`.

- [ ] **Step 3: Implement**

Beside `TOPIC_TTL_MS`:

```js
  // The line is read on every view but data arrives only from My posts, so a
  // shorter threshold would call it stale nearly always. A day is "old".
  var REACTIONS_STALE_MS = 24 * 60 * 60 * 1000;
```

After `reactionLookupTargets`:

```js
  // -- thread reactions: totals (#10) ---------------------------------------
  // Up and down are only ever sums of real topic-post counts. rating is shown
  // only as "net" and never split. The API has no subscriber count at all
  // (docs/reference/torn-openapi-forum-excerpt-2026-10-08.json).

  var NO_SUBSCRIBERS = ' Torn\'s API has no subscriber count, so none is shown.';

  function formatSigned(n) {
    var v = toInt(n, 0);
    if (v > 0) return '+' + formatCount(v);
    if (v < 0) return '-' + formatCount(-v);
    return '0';
  }

  function reactionTotals(mine, now, staleMs) {
    var out = {
      state: 'unloaded', started: 0, up: null, down: null, thumbThreads: 0,
      net: null, netThreads: 0, updatedAt: 0, stale: false,
    };
    var threads = isPlainObject(mine) && Array.isArray(mine.threads) ? mine.threads : [];
    for (var i = 0; i < threads.length; i += 1) {
      var t = threads[i];
      if (!t || t.started !== true) continue;
      out.started += 1;
      if (typeof t.up === 'number' && typeof t.down === 'number') {
        out.up = (out.up || 0) + t.up;
        out.down = (out.down || 0) + t.down;
        out.thumbThreads += 1;
        out.updatedAt = Math.max(out.updatedAt, toInt(t.topicAt, 0));
      } else if (typeof t.rating === 'number') {
        out.net = (out.net || 0) + t.rating;
        out.netThreads += 1;
        out.updatedAt = Math.max(out.updatedAt, toInt(t.reactAt, 0));
      }
    }
    if (out.started === 0) {
      out.state = isPlainObject(mine) && toInt(mine.fetchedAt, 0) > 0 ? 'empty' : 'unloaded';
      return out;
    }
    if (out.thumbThreads === 0 && out.netThreads === 0) { out.state = 'missing'; return out; }
    out.state = 'known';
    out.stale = toInt(now, 0) - out.updatedAt > staleMs;
    return out;
  }

  function reactionsTitle(r, now, pageLimit, opener) {
    var act = opener || 'Open My posts';
    if (!r || r.state === 'unloaded') return 'Not loaded yet. ' + act + ' to load the threads you started.' + NO_SUBSCRIBERS;
    if (r.state === 'empty') return 'Torn reports no threads you started.' + NO_SUBSCRIBERS;
    if (r.state === 'missing') return 'Torn has not reported thumbs or a rating for your threads yet.' + NO_SUBSCRIBERS;
    var of = ' of ' + r.started + ' ' + plural(r.started, 'thread') + ' you started';
    var text;
    if (r.thumbThreads > 0) {
      text = 'Thumbs up and down from the opening post of ' + r.thumbThreads + of + '.';
      if (r.netThreads > 0) {
        text += ' ' + r.netThreads + ' more ' + plural(r.netThreads, 'shows', 'show') + ' Torn\'s net rating until checked.';
      }
    } else {
      text = 'Torn\'s net rating for ' + r.netThreads + of + '; thumbs up and down appear once '
        + plural(r.netThreads, 'its', 'their') + ' opening ' + plural(r.netThreads, 'post is', 'posts are') + ' checked.';
    }
    text += ' Updated ' + formatRelativeTime(r.updatedAt, now) + '.';
    if (r.started >= pageLimit) {
      text += ' Torn sends your newest ' + pageLimit + ' threads per request; older ones keep the figures '
        + 'from when they were last seen.';
    }
    if (r.stale) text += ' ' + act + ' to update.';
    return text + NO_SUBSCRIBERS;
  }
```

(`of` is a plain identifier in ES5; if the linter in `tests/metadata.test.js` objects, rename it `ofText`.)

- [ ] **Step 4:** Run `node --test tests/reactions.test.js && npm test && npm run test:syntax`. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add torn-forum-command-center.user.js tests/reactions.test.js
git commit -m "feat: reaction totals, net fallback and tooltip text (#10)"
```

---

### Task 5: Topic lookups inside the My posts run

**Files:**
- Modify: `torn-forum-command-center.user.js` - new runtime `enrichReactions` directly after #2's `enrichMine`; one edit inside `refreshMine`.
- Create: `tests/reactions-lookups.test.js`
- Modify: `tests/read-only.test.js`

**Interfaces:**
- Consumes: `reactionLookupTargets`, `topicPostFromApi`, `applyTopicPost`, `TOPIC_POST_PARAMS`, `TOPIC_TTL_MS`, `REACTION_LOOKUPS_PER_RUN`; inside `refreshMine`: `budget`, `stale()`, `options`, `generation`, `outcome`.
- Produces: `enrichReactions(ids, now, opts, generation) -> Promise<{ ok, stoppedEarly? }>`.

- [ ] **Step 1: Write the failing tests**

Create `tests/reactions-lookups.test.js`:

```js
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const {
  loadUserscript, FORUMS_LOCATION, subscribedThreadsPayload, forumFeedPayload,
  forumThreadsPayload, forumPostsPayload, threadPostsPayload,
} = require('./load-userscript');

const KEY = 'abcdefghij123456';
const NOW = 1700000000000;
const HOUR = 60 * 60 * 1000;

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

// n started threads (ids 100..), one posted-in thread (20), each with a topic page.
function table(n) {
  const threads = Array.from({ length: n }, (_, i) => ({ id: 100 + i, total: 3, rating: 1, lastAt: 1600000000 + i }));
  const t = {
    'user/forumsubscribedthreads': subscribedThreadsPayload([{ id: 1 }]),
    'user/forumfeed': forumFeedPayload([]),
    'forum/categories': { categories: [{ id: 61, title: 'Tutorials', acronym: 'TG' }] },
    'user/forumthreads': forumThreadsPayload(threads),
    'user/forumposts': forumPostsPayload([{ id: 1, threadId: 20 }]),
    'forum/20/thread': { thread: { id: 20, forum_id: 61, title: 'Twenty', posts: 30, last_post_time: 1600000300 } },
    'forum/20/posts': threadPostsPayload([{ id: 200, threadId: 20, isTopic: true, likes: 9, dislikes: 9 }]),
  };
  threads.forEach((th) => {
    t['forum/' + th.id + '/posts'] = threadPostsPayload([{ id: th.id * 10, threadId: th.id, isTopic: true, likes: 2, dislikes: 1 }]);
  });
  return t;
}

async function boot(tbl, options) {
  const r = router(tbl);
  const env = loadUserscript(Object.assign({
    location: FORUMS_LOCATION, now: NOW, gmStore: [['tfcc:key', KEY]], fetch: r.fetch,
  }, options || {}));
  env.router = r;
  await settle(env);
  r.seen.length = 0;   // drop init's Threads refresh
  r.urls.length = 0;
  return env;
}

const topicCalls = (env) => env.router.urls.filter((u) => /\/v2\/forum\/\d+\/posts\?/.test(u));

test('a My posts run reads at most 5 opening posts, newest activity first, only for threads you started', async () => {
  const env = await boot(table(8));
  env.exports.refreshMine(NOW);
  await settle(env);
  const calls = topicCalls(env);
  assert.strictEqual(calls.length, 5);
  for (const u of calls) {
    assert.match(u, /[?&]sort=ASC(&|$)/);
    assert.match(u, /[?&]offset=0(&|$)/);
  }
  assert.ok(!calls.some((u) => /\/forum\/20\/posts/.test(u)), 'a thread you only posted in is never checked');
  // Threads 100..107 have rising last-post times, so the newest five go first.
  assert.deepStrictEqual(calls.map((u) => Number(/\/forum\/(\d+)\/posts/.exec(u)[1])), [107, 106, 105, 104, 103]);
  assert.ok(env.router.seen.length <= 2 + 10 + 5, 'at most 17 requests at defaults, got ' + env.router.seen.length);
  assert.strictEqual(env.exports.state.mine.threads.filter((t) => typeof t.up === 'number').length, 5);
  assert.strictEqual(JSON.stringify(env.exports.state.mine).indexOf('SECRET'), -1, 'no post body stored');
});

test('later runs check only what is left, then nothing until the TTL passes', async () => {
  const env = await boot(table(8));
  env.exports.refreshMine(NOW);
  await settle(env);
  env.router.urls.length = 0;
  env.exports.refreshMine(NOW + HOUR);
  await settle(env);
  assert.strictEqual(topicCalls(env).length, 3);
  env.router.urls.length = 0;
  env.exports.refreshMine(NOW + 2 * HOUR);
  await settle(env);
  assert.strictEqual(topicCalls(env).length, 0, 'within 12 hours of a check');
  env.router.urls.length = 0;
  env.exports.refreshMine(NOW + env.exports.TOPIC_TTL_MS + 2 * HOUR);
  await settle(env);
  assert.strictEqual(topicCalls(env).length, 5);
});

test('with lookups set to 0, My posts makes exactly two requests', async () => {
  const env = await boot(table(3));
  env.exports.state.settings.enrichBudget = 0;
  env.exports.refreshMine(NOW);
  await settle(env);
  assert.strictEqual(topicCalls(env).length, 0);
  assert.strictEqual(env.router.seen.length, 2);
});

function limiterAllowing(n) {
  let calls = 0;
  return {
    get calls() { return calls; },
    reserve() { calls += 1; return calls <= n ? { ok: true, waitMs: 0 } : { ok: false, retryAfterMs: 30000 }; },
  };
}

test('topic lookups do not start after My posts was throttled', async () => {
  const env = await boot(table(3));
  const lim = limiterAllowing(2);   // the two lists; #2's lookup of thread 20 is refused
  env.exports.refreshMine(NOW, { limiter: lim });
  await settle(env);
  assert.strictEqual(topicCalls(env).length, 0);
  assert.strictEqual(lim.calls, 3, 'nothing asked for a slot after the refusal');
});

test('topic lookups stop at their own first throttle', async () => {
  const env = await boot(table(3));
  const lim = limiterAllowing(4);   // two lists, thread 20, one topic page
  env.exports.refreshMine(NOW, { limiter: lim });
  await settle(env);
  assert.strictEqual(topicCalls(env).length, 1);
  assert.strictEqual(lim.calls, 5);
});

test('a Threads refresh never reads an opening post', async () => {
  const env = await boot(table(3));
  env.exports.refreshMine(NOW);
  await settle(env);
  env.router.urls.length = 0;
  env.exports.refreshAll(NOW + 13 * HOUR);
  await settle(env);
  assert.strictEqual(topicCalls(env).length, 0);
});

test('a late topic answer after Reset everything is dropped', async () => {
  const tbl = table(1);
  const r = router(tbl);
  const held = [];
  const fetch = (url) => (/\/forum\/\d+\/posts\?/.test(url)
    ? new Promise((resolve) => held.push(() => resolve(r.fetch(url))))
    : r.fetch(url));
  const env = loadUserscript({ location: FORUMS_LOCATION, now: NOW, gmStore: [['tfcc:key', KEY]], fetch });
  await settle(env);
  env.exports.refreshMine(NOW);
  await settle(env);
  assert.strictEqual(held.length, 1, 'held on the topic page');
  env.exports.makeHandlers(env.doc, env.win).onAction('reset-all', { getAttribute: () => null });
  held.splice(0).forEach((f) => f());
  await settle(env);
  assert.strictEqual(env.exports.state.mine.threads.length, 0);
});
```

In `tests/read-only.test.js`, extend `a refresh cannot exceed the request budget the panel promises` (after #2's additions):

```js
  const thumbs = (b) => Math.min(api.REACTION_LOOKUPS_PER_RUN, b);
  assert.strictEqual(2 + api.DEFAULT_ENRICH_BUDGET + thumbs(api.DEFAULT_ENRICH_BUDGET), 17, 'My posts at defaults');
  assert.strictEqual(2 + api.MAX_ENRICH_BUDGET + thumbs(api.MAX_ENRICH_BUDGET), 32, 'My posts at the largest setting');
  assert.strictEqual(2 + 0 + thumbs(0), 2, 'lookups set to 0 means two requests');
  assert.ok(13 + 17 <= api.REQUESTS_PER_WINDOW, 'a default Threads refresh and a default My posts run fit one minute');
  assert.ok(32 <= api.REQUESTS_PER_WINDOW, 'a maximal My posts run alone fits one minute');
```

- [ ] **Step 2:** Run `node --test tests/reactions-lookups.test.js tests/read-only.test.js`. Expected: FAIL, no `forum/<id>/posts` calls.

- [ ] **Step 3: Implement**

After #2's `enrichMine`:

```js
  // Topic-post lookups for thumbs (#10): started threads only, only inside
  // refreshMine, after #2's lookups. Stops at the first throttle, like
  // enrichThreads. An unrecognised answer stamps nothing.
  function enrichReactions(ids, now, opts, generation) {
    function step(i) {
      if (i >= ids.length) return Promise.resolve({ ok: true });
      var params = { sort: TOPIC_POST_PARAMS.sort, offset: TOPIC_POST_PARAMS.offset };
      return tornApiGet('forum/' + ids[i] + '/posts', params, opts).then(function (res) {
        if (generation !== state.generation) return { ok: false, reason: 'stale' };
        if (res.ok) {
          var topic = topicPostFromApi(res.data, ids[i]);
          if (topic !== undefined) state.mine = applyTopicPost(state.mine, ids[i], topic, now);
        } else if (res.reason === 'throttled') {
          return { ok: true, stoppedEarly: true };
        }
        return step(i + 1);
      });
    }
    return step(0);
  }
```

In `refreshMine`, replace #2's line

```js
          return enrichMine(ids, now, options, generation).then(function () { return outcome; });
```

with

```js
          return enrichMine(ids, now, options, generation).then(function (er) {
            if (stale() || (er && er.stoppedEarly)) return outcome;
            var rn = Math.min(REACTION_LOOKUPS_PER_RUN, budget);
            var rids = reactionLookupTargets(state.mine, now, TOPIC_TTL_MS, rn);
            return enrichReactions(rids, now, options, generation).then(function () { return outcome; });
          });
```

Check before relying on it: `grep -n "function enrichMine" -A15` - it must return `{ ok: true, stoppedEarly: true }` on a throttle. If #2 shipped it returning nothing, add that return there (one line) and say so in the PR.

- [ ] **Step 4: Run**

Run: `node --test tests/reactions-lookups.test.js tests/read-only.test.js && npm test && npm run test:syntax`
Expected: PASS. If #2's `tests/mine-refresh.test.js` fails, each failure must be **only** an extra `forum/<id>/posts` request for a started thread in its fixture (its `mineCalls` filter ignores `/posts`, so most will not fail). Add a `forum/<id>/posts` route to that test's table or assert the extra call; any other failure is a bug in this task.

- [ ] **Step 5: Commit**

```bash
git add torn-forum-command-center.user.js tests/reactions-lookups.test.js tests/read-only.test.js tests/mine-refresh.test.js
git commit -m "feat: check opening posts for thumbs inside the My posts run (#10)"
```

---

### Task 6: The line under the header

**Files:**
- Modify: `torn-forum-command-center.user.js` - `buildPanelModel`, new `renderReactions` before `panelHtml`, `panelHtml`, `panelStyleText`.
- Modify: `tests/panel.test.js`, `tests/style.test.js`, `tests/render-preview.mjs`

**Interfaces:**
- Consumes: `reactionTotals`, `reactionsTitle`, `formatSigned`, `formatCount`, `formatRelativeTime`, `escapeHtml`, `REACTIONS_STALE_MS`, `MINE_PAGE_LIMIT`.
- Produces: `model.reactions`; `renderReactions(model) -> string`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/panel.test.js`:

```js
const KEY_STORE = [['tfcc:key', 'abcdefghij123456']];

function withMine(env, threads, fetchedAt) {
  const api = env.exports;
  api.state.mine = Object.assign(api.freshMine(), { fetchedAt: fetchedAt === undefined ? NOW : fetchedAt, threads });
  api.recompute(NOW);
}

function startedRec(api, id, fields, title) {
  const rec = api.freshMineThread(id, NOW);
  rec.started = true;
  if (title) rec.title = title;
  if (fields) api.setReactionFields(rec, fields);
  return rec;
}

const TH = (up, down, at) => ({ topicAt: at === undefined ? NOW : at, up, down });
const NET = (rating) => ({ reactAt: NOW, rating });

function htmlOf(env) {
  return env.exports.panelHtml(env.exports.buildPanelModel(NOW));
}

function bootPanel() {
  const env = loadUserscript({ location: forums(), gmStore: KEY_STORE });
  seed(env, [{ id: 1 }]);
  return env;
}

test('the reactions line sits under the header row, never inside it', () => {
  const env = bootPanel();
  withMine(env, [startedRec(env.exports, 1, TH(34, 5))]);
  const html = htmlOf(env);
  const sub = html.indexOf('<div class="tfcc-subhead">');
  assert.ok(sub > html.indexOf('<div class="tfcc-head">'));
  const head = html.slice(html.indexOf('<div class="tfcc-head">'), sub);
  assert.doesNotMatch(head, /tfcc-reactions/);
  assert.match(head, /data-act="collapse"/, 'the subhead starts after the whole header row');
  assert.match(html, /Your threads: <span class="tfcc-rx">34<\/span> up, <span class="tfcc-rx">5<\/span> down<\/button>/);
});

test('unknown renders "-", never 0', () => {
  const env = bootPanel();
  withMine(env, [], 0);
  let html = htmlOf(env);
  assert.match(html, /Your threads: <span class="tfcc-rx">-<\/span> up, <span class="tfcc-rx">-<\/span> down/);
  assert.doesNotMatch(html, /<span class="tfcc-rx">0<\/span>/);
  withMine(env, [startedRec(env.exports, 1)]);
  html = htmlOf(env);
  assert.match(html, /<span class="tfcc-rx">-<\/span> up/);
  assert.match(html, /has not reported thumbs or a rating/);
});

test('net is labelled, never split, and named as Torn\'s', () => {
  const env = bootPanel();
  withMine(env, [startedRec(env.exports, 1, NET(12))]);
  let html = htmlOf(env);
  assert.match(html, /Your threads: net <span class="tfcc-rx">\+12<\/span><\/button>/);
  assert.doesNotMatch(html, / up, /);
  withMine(env, [startedRec(env.exports, 1, TH(4, 1)), startedRec(env.exports, 2, NET(-3))]);
  html = htmlOf(env);
  assert.match(html, /<span class="tfcc-rx">4<\/span> up, <span class="tfcc-rx">1<\/span> down, net <span class="tfcc-rx">-3<\/span> on 1 more/);
});

test('known zeros render 0', () => {
  const env = bootPanel();
  withMine(env, [startedRec(env.exports, 1, TH(0, 0))]);
  assert.match(htmlOf(env), /<span class="tfcc-rx">0<\/span> up, <span class="tfcc-rx">0<\/span> down/);
});

test('every tooltip says subscribers cannot be shown', () => {
  const env = bootPanel();
  for (const threads of [[], [startedRec(env.exports, 1)], [startedRec(env.exports, 1, TH(1, 1))]]) {
    withMine(env, threads, threads.length ? NOW : 0);
    assert.match(htmlOf(env), /title="[^"]*API has no subscriber count, so none is shown\."/);
  }
});

test('stale figures carry a visible age, not just a colour', () => {
  const env = bootPanel();
  withMine(env, [startedRec(env.exports, 1, TH(1, 1, NOW - 3 * 24 * 3600000))]);
  const html = htmlOf(env);
  assert.match(html, /class="tfcc-reactions tfcc-stale"/);
  assert.match(html, /down \(3d ago\)<\/button>/);
});

test('hidden when collapsed, without a key, and when you started nothing', () => {
  const env = bootPanel();
  withMine(env, [startedRec(env.exports, 1, TH(1, 1))]);
  env.exports.state.settings.collapsed = true;
  assert.doesNotMatch(htmlOf(env), /tfcc-subhead/);
  env.exports.state.settings.collapsed = false;
  withMine(env, [], NOW);
  assert.doesNotMatch(htmlOf(env), /tfcc-subhead/, 'empty is not unknown');
  const nokey = loadUserscript({ location: forums() });
  seed(nokey, [{ id: 1 }]);
  withMine(nokey, [startedRec(nokey.exports, 1, TH(1, 1))]);
  assert.doesNotMatch(htmlOf(nokey), /tfcc-subhead/);
});

test('tapping the line opens My posts through the existing view action', () => {
  const env = bootPanel();
  withMine(env, [startedRec(env.exports, 1, TH(1, 1))]);
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

(`grep -n "var PANEL_ID"`; if it is not `tfcc-panel`, adjust the selectors.)

- [ ] **Step 2:** Run `node --test tests/panel.test.js tests/style.test.js`. Expected: FAIL, no `tfcc-subhead`.

- [ ] **Step 3: Implement**

In `buildPanelModel`'s returned object, after `drafts: draftList(state.drafts),`:

```js
      reactions: reactionTotals(state.mine, now, REACTIONS_STALE_MS),
```

Directly before `function panelHtml(model)`:

```js
  // The thread reactions line (#10). Its own block under .tfcc-head, never in
  // it: the header row belongs to the title, #9's badges and Refresh, Expand
  // and Hide. Rendered after the collapsed early return, so hidden when
  // collapsed. Up and down are real topic-post sums; net is labelled.
  function renderReactions(model) {
    var r = model.reactions;
    if (!model.hasKey || !r || r.state === 'empty') return '';
    var known = r.state === 'known';
    var stale = known && r.stale;
    var rx = function (v) { return '<span class="tfcc-rx">' + escapeHtml(v) + '</span>'; };
    var parts;
    var spoken;
    if (known && r.thumbThreads > 0) {
      var more = r.netThreads > 0 ? ', net ' + formatSigned(r.net) + ' on ' + r.netThreads + ' more' : '';
      parts = rx(formatCount(r.up)) + ' up, ' + rx(formatCount(r.down)) + ' down'
        + (r.netThreads > 0 ? ', net ' + rx(formatSigned(r.net)) + ' on ' + r.netThreads + ' more' : '');
      spoken = formatCount(r.up) + ' up, ' + formatCount(r.down) + ' down' + more;
    } else if (known) {
      parts = 'net ' + rx(formatSigned(r.net));
      spoken = 'net ' + formatSigned(r.net);
    } else {
      parts = rx('-') + ' up, ' + rx('-') + ' down';
      spoken = 'thumbs unknown';
    }
    var age = stale ? ' (' + formatRelativeTime(r.updatedAt, model.now) + ')' : '';
    var title = reactionsTitle(r, model.now, MINE_PAGE_LIMIT);
    return '<div class="tfcc-subhead"><button type="button" class="tfcc-reactions' + (stale ? ' tfcc-stale' : '')
      + '" data-act="view" data-view="mine" title="' + escapeHtml(title) + '" aria-label="'
      + escapeHtml('Your threads: ' + spoken + age + '. ' + title) + '">'
      + 'Your threads: ' + parts + escapeHtml(age) + '</button></div>';
  }
```

In `panelHtml`, directly after the line `    if (model.collapsed) return out.join('');`:

```js
    out.push(renderReactions(model));
```

In `panelStyleText`, directly after the line containing `' button:hover { background: var(--tm-hover); }',`:

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

In `tests/render-preview.mjs`, directly before `api.state.refreshing = false;`:

```js
// Thread reactions (#10): two started threads with thumbs and one net only, so
// the pill (with its "net ... on 1 more" form) is in every preview.
{
  const mine = api.state.mine && Array.isArray(api.state.mine.threads) ? api.state.mine : api.freshMine();
  mine.fetchedAt = mine.fetchedAt || NOW - 5 * MIN;
  [[16589908, { topicAt: NOW - 5 * MIN, up: 30, down: 4 }],
   [16474152, { topicAt: NOW - 5 * MIN, up: 4, down: 1 }],
   [16354991, { reactAt: NOW - 5 * MIN, rating: -3 }]].forEach(([id, fields]) => {
    let t = mine.threads.find((x) => x.id === id);
    if (!t) { t = api.freshMineThread(id, NOW - 5 * MIN); mine.threads.push(t); }
    t.started = true;
    api.setReactionFields(t, fields);
  });
  api.state.mine = mine;
}
```

- [ ] **Step 4: Run**

Run: `node --test tests/panel.test.js tests/style.test.js && npm test && npm run test:syntax`
Expected: PASS; `tests/handlers.test.js` "every rendered action is handled" still passes (`view` exists).

Then `node tests/render-preview.mjs && node tests/contrast-audit.mjs > contrast.log 2>&1`, read `contrast.log`. Expected: OK for every preview. If the pill fails, change only its `color` to `var(--tm-text)`.

- [ ] **Step 5: Commit**

```bash
git add torn-forum-command-center.user.js tests/panel.test.js tests/style.test.js tests/render-preview.mjs
git commit -m "feat: thumbs up and down line under the panel header (#10)"
```

---

### Task 7: Per-thread figures in My posts

**Files:**
- Modify: `torn-forum-command-center.user.js` - `mergeThreads` row object, `renderRow` meta.
- Modify: `tests/panel.test.js`, `tests/merge.test.js` (only if a test deep-equals a whole row)

**Interfaces:**
- Produces: every row gains `up`, `down`, `rating` (numbers or null).

- [ ] **Step 1: Write the failing test** (append to `tests/panel.test.js`)

```js
test('My posts shows each started thread its thumbs, or a labelled net', () => {
  const env = loadUserscript({ location: forums(), gmStore: KEY_STORE });
  seed(env, []);
  const api = env.exports;
  withMine(env, [
    startedRec(api, 41, TH(12, 3), 'Alpha'),
    startedRec(api, 42, NET(9), 'Beta'),
    startedRec(api, 43, null, 'Gamma'),
  ]);
  api.state.settings.view = 'mine';
  const html = htmlOf(env);
  assert.match(html, /<span class="tfcc-note">12 up, 3 down<\/span>/);
  assert.match(html, /<span class="tfcc-note" title="[^"]*">net \+9<\/span>/);
  assert.strictEqual((html.match(/class="tfcc-note"[^>]*>(\d+ up|net )/g) || []).length, 2, 'Gamma gets no meta');
});
```

- [ ] **Step 2:** Run `node --test tests/panel.test.js`. Expected: FAIL.

- [ ] **Step 3: Implement**

In `mergeThreads`'s pushed row, after `mineRole: rec ? (rec.started ? 'started' : 'posted') : null,`:

```js
        up: rec && typeof rec.up === 'number' ? rec.up : null,
        down: rec && typeof rec.down === 'number' ? rec.down : null,
        rating: rec && typeof rec.rating === 'number' ? rec.rating : null,
```

In `renderRow`, directly after the line that pushes the `started` / `posted in` tag:

```js
    if (row.mineRole === 'started') {
      if (row.up !== null && row.down !== null) {
        out.push('<span class="tfcc-note">' + formatCount(row.up) + ' up, ' + formatCount(row.down) + ' down</span>');
      } else if (row.rating !== null) {
        out.push('<span class="tfcc-note" title="Torn\'s net rating. Thumbs up and down appear once the '
          + 'opening post is checked.">net ' + formatSigned(row.rating) + '</span>');
      }
    }
```

If a `tests/merge.test.js` assertion deep-equals a whole row, add `up: null, down: null, rating: null`; weaken nothing else.

- [ ] **Step 4:** Run `npm test && npm run test:syntax`. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add torn-forum-command-center.user.js tests/panel.test.js tests/merge.test.js
git commit -m "feat: per-thread thumbs or net on My posts rows (#10)"
```

---

### Task 8: Settings numbers and debug counts

**Files:**
- Modify: `torn-forum-command-center.user.js` - the budget note after the `enrich-budget` input; `gatherDebugContext`; `buildDebugReport`.
- Modify: `tests/panel.test.js` (replace #2's budget-text test), `tests/debug-report.test.js`

- [ ] **Step 1: Write the failing tests**

In `tests/panel.test.js`, replace the body of #2's `Settings states both request budgets, from the constants` with:

```js
  const env = loadUserscript({ location: forums() });
  seed(env, [{ id: 1 }]);
  env.exports.state.settings.view = 'settings';
  const html = env.exports.panelHtml(env.exports.buildPanelModel(NOW));
  const api = env.exports;
  const thumbs = (b) => Math.min(api.REACTION_LOOKUPS_PER_RUN, b);
  assert.match(html, /Opening My posts, or refreshing while it is open, makes two requests of its own/);
  assert.match(html, new RegExp('at most once every ' + (api.MINE_TTL_MS / 60000) + ' minutes'));
  assert.match(html, new RegExp('My posts also reads the opening post of up to ' + api.REACTION_LOOKUPS_PER_RUN
    + ' threads you started, for their thumbs up and down, each at most once every '
    + (api.TOPIC_TTL_MS / 3600000) + ' hours; with lookups set to 0 it reads none\\.'));
  assert.match(html, new RegExp('a Threads refresh is at most ' + (3 + api.DEFAULT_ENRICH_BUDGET)
    + '\\s+requests and My posts at most ' + (2 + api.DEFAULT_ENRICH_BUDGET + thumbs(api.DEFAULT_ENRICH_BUDGET))
    + '; at the largest setting of ' + api.MAX_ENRICH_BUDGET + ', ' + (3 + api.MAX_ENRICH_BUDGET) + ' and '
    + (2 + api.MAX_ENRICH_BUDGET + thumbs(api.MAX_ENRICH_BUDGET)) + '\\.'));
  assert.match(html, /a Threads refresh is at most 13\s+requests and My posts at most 17; at the largest setting of 25, 28 and 32\./);
  assert.match(html, /under 40 requests a minute/);
```

In `tests/debug-report.test.js`, in `loaded()` after #2's `api.state.mine = mine;`:

```js
  mine.threads[0].started = true;
  api.setReactionFields(mine.threads[0], { reactAt: NOW, rating: 987654, topicAt: NOW, up: 123456, down: 654321 });
```

In `the report carries what a maintainer needs`: `assert.match(report, /my posts thumbs checked: 1/); assert.match(report, /my posts thumbs found: 1/);`. In `the report never carries anything private`, add to `forbidden`: `['987654', 'a rating']`, `['123456', 'a thumbs count']`, `['654321', 'a thumbs count']`, `['SECRET TOPIC BODY', 'a topic post body']`.

- [ ] **Step 2:** Run `node --test tests/panel.test.js tests/debug-report.test.js`. Expected: FAIL.

- [ ] **Step 3: Implement**

Replace #2's whole budget note `out.push(...)` (the one starting `'<p class="tfcc-note">A refresh of Threads makes two requests`) with:

```js
    var thumbsAt = function (b) { return Math.min(REACTION_LOOKUPS_PER_RUN, b); };
    out.push('<p class="tfcc-note">A refresh of Threads makes two requests, plus one for the forum list at '
      + 'most once a day. Opening My posts, or refreshing while it is open, makes two requests of its own, '
      + 'at most once every ' + Math.round(MINE_TTL_MS / 60000) + ' minutes unless you press Refresh. '
      + 'Each activity lookup adds one more to either, and only runs for a thread with no recent time. '
      + 'My posts also reads the opening post of up to ' + REACTION_LOOKUPS_PER_RUN + ' threads you started, '
      + 'for their thumbs up and down, each at most once every ' + Math.round(TOPIC_TTL_MS / 3600000) + ' hours; '
      + 'with lookups set to 0 it reads none. '
      + 'With the default of ' + DEFAULT_ENRICH_BUDGET + ', a Threads refresh is at most '
      + (3 + DEFAULT_ENRICH_BUDGET) + ' requests and My posts at most '
      + (2 + DEFAULT_ENRICH_BUDGET + thumbsAt(DEFAULT_ENRICH_BUDGET))
      + '; at the largest setting of ' + MAX_ENRICH_BUDGET + ', ' + (3 + MAX_ENRICH_BUDGET) + ' and '
      + (2 + MAX_ENRICH_BUDGET + thumbsAt(MAX_ENRICH_BUDGET)) + '. '
      + 'The script keeps itself under ' + REQUESTS_PER_WINDOW + ' requests a minute regardless.</p>');
```

In `gatherDebugContext().counts`, after #2's `mineUnchecked` line:

```js
        mineThumbsChecked: state.mine.threads.filter(function (t) { return t.started && t.topicAt > 0; }).length,
        mineThumbsFound: state.mine.threads.filter(function (t) { return t.started && typeof t.up === 'number'; }).length,
```

In `buildDebugReport`'s `lines`, after #2's `my posts unchecked` line:

```js
      'my posts thumbs checked: ' + c.counts.mineThumbsChecked,
      'my posts thumbs found: ' + c.counts.mineThumbsFound,
```

- [ ] **Step 4:** Run `npm test && npm run test:syntax`. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add torn-forum-command-center.user.js tests/panel.test.js tests/debug-report.test.js
git commit -m "feat: Settings states the thumbs lookups and their cost; debug counts (#10)"
```

---

### Task 9: Mutation-check entries

**Files:**
- Modify: `tests/mutation-check.mjs` (append to `MUTATIONS`)

- [ ] **Step 1:** For each search string below, `grep -c -F "<string>" torn-forum-command-center.user.js` must print `1`. A `0` means the code drifted from this plan: fix the entry to the real line, not the code.

- [ ] **Step 2: Append**

```js
  // -- thread reactions (#10) ----------------------------------------------
  {
    name: 'a missing rating reads as 0',
    suite: 'tests/reactions.test.js',
    apply: (s) => s.replace('rating: isReactionNumber(raw.rating, true) ? Math.floor(raw.rating) : null,',
      'rating: toInt(raw.rating, 0),'),
  },
  {
    name: 'a topic post with null likes reads as 0',
    suite: 'tests/reactions.test.js',
    apply: (s) => s.replace(
      'if (!isReactionNumber(p.likes, false) || !isReactionNumber(p.dislikes, false)) return null;',
      'if (false) return null;'),
  },
  {
    name: 'any post counts as the topic post',
    suite: 'tests/reactions.test.js',
    apply: (s) => s.replace("if (!isPlainObject(p) || p.is_topic !== true) continue;", 'if (!isPlainObject(p)) continue;'),
  },
  {
    name: 'a thread counts by both thumbs and net',
    suite: 'tests/reactions.test.js',
    apply: (s) => s.replace("} else if (typeof t.rating === 'number') {", "}\n      if (typeof t.rating === 'number') {"),
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
    name: 'the topic TTL is ignored',
    suite: 'tests/reactions.test.js',
    apply: (s) => s.replace('return at <= 0 || t0 - at >= ttl;', 'return true;'),
  },
  {
    name: 'the normaliser always emits topicAt',
    suite: 'tests/storage.test.js',
    apply: (s) => s.replace('    if (topicAt > 0) {\n      rx.topicAt = topicAt;', '    if (true) {\n      rx.topicAt = topicAt;'),
  },
  {
    name: 'topic lookups ignore their cap',
    suite: 'tests/reactions-lookups.test.js',
    apply: (s) => s.replace('var rn = Math.min(REACTION_LOOKUPS_PER_RUN, budget);', 'var rn = 1000;'),
  },
  {
    name: 'topic lookups run after a throttle',
    suite: 'tests/reactions-lookups.test.js',
    apply: (s) => s.replace('if (stale() || (er && er.stoppedEarly)) return outcome;', 'if (stale()) return outcome;'),
  },
  {
    name: 'an unknown thumbs figure renders 0',
    suite: 'tests/panel.test.js',
    apply: (s) => s.replace("parts = rx('-') + ' up, ' + rx('-') + ' down';", "parts = rx('0') + ' up, ' + rx('0') + ' down';"),
  },
  {
    name: 'the reactions line renders while collapsed',
    suite: 'tests/panel.test.js',
    apply: (s) => s.replace("    if (model.collapsed) return out.join('');",
      "    out.push(renderReactions(model));\n    if (model.collapsed) return out.join('');"),
  },
  {
    name: 'the subscriber sentence is dropped',
    suite: 'tests/panel.test.js',
    apply: (s) => s.replace("var NO_SUBSCRIBERS = ' Torn\\'s API has no subscriber count, so none is shown.';",
      "var NO_SUBSCRIBERS = '';"),
  },
```

(The last search string contains a backslash before the apostrophe, exactly as in the source; in the `.mjs` double-quoted literal that is written `\\'`.)

- [ ] **Step 3: Run**

Run: `node tests/mutation-check.mjs > mutation.log 2>&1`, then read `mutation.log` with the Read tool. Never pipe it.
Expected: every entry, old and new, killed; exit 0; `git status` shows the userscript unchanged. A surviving mutant means a test proves nothing: fix the test, not the entry.

- [ ] **Step 4: Commit**

```bash
git add tests/mutation-check.mjs
git commit -m "test: mutation entries for the reactions tracker (#10)"
```

---

### Task 10: Docs, code map, and review

**Files:**
- Modify: `CHANGELOG.md`, `docs/qa-checklist.md`, `docs/architecture.md`, `README.md`, `docs/code-map.md`

- [ ] **Step 1: CHANGELOG.** Under `## [Unreleased]` (replace `Nothing yet.` if present; if #2 already added `### Added` and `### Changed` there, append to them), with a blank line after each heading:

```markdown
- A line under the panel header totals the thumbs up and thumbs down on the
  threads you started, read from each thread's opening post inside the My posts
  refresh (at most 5 threads per run, each at most once every 12 hours; none
  when activity lookups are set to 0). Until a thread is checked it shows
  Torn's net rating, labelled "net". It shows "-" until My posts has loaded and
  never a guessed number. Torn's API has no subscriber count, so none is shown
  (#10).

### Changed

- A My posts refresh is at most 17 requests at the default settings (was 12)
  and 32 at the largest (was 27). A Threads refresh is unchanged at 13.
```

Do **not** touch `@version`, `var SCRIPT_VERSION` or `package.json`.

- [ ] **Step 2: QA.** Add `### Reactions tracker` after #2's My posts section in `docs/qa-checklist.md`, with exactly the twelve items in the spec's "QA checklist additions".

- [ ] **Step 3: Architecture and README.** `docs/architecture.md`: under the endpoints list, add `forum/{id}/posts?sort=ASC&offset=0` for topic-post thumbs (started threads, inside My posts only); under "Storage", the five optional `tfcc:mine` record fields, why they are optional (nested fields, `loadKey` damage rule, #8 covers top level only) and the single writer. README feature list: one bullet, the CHANGELOG's first sentence.

- [ ] **Step 4: Verify.** `npm test && npm run test:syntax && node tests/mutation-check.mjs > mutation.log 2>&1`, then read `mutation.log`. Expected: all PASS, every mutant killed.

- [ ] **Step 5: Code map.** Run `/code-map`, then check `docs/code-map.md` lists `setReactionFields`, `topicPostFromApi`, `reactionLookupTargets`, `reactionTotals`, `reactionsTitle`, `enrichReactions`, `renderReactions`.

- [ ] **Step 6: Commit**

```bash
git add CHANGELOG.md docs/qa-checklist.md docs/architecture.md README.md docs/code-map.md
git commit -m "docs: changelog, QA and code map for the reactions tracker (#10)"
```

- [ ] **Step 7: Review and ship.** `/review`, then `/ship` (verify gate `npm test`). The PR description states: no change to `@match`, `@grant`, `@connect`; one more GET path (`forum/{id}/posts`, already used by deep search); the new My posts maximum (17 / 32) and the unchanged Threads maximum (13); the contrast audit result; Task 0 status (the release gate), including what `rating` turned out to mean and whether `ASC` puts the topic first. No attribution footer. The release commit is separate and owner-cut, after the QA gate (rule 8).

---

## If this merges first

Use only if #10 must land before #2. Do F1 to F3 first, then Tasks 0 to 4, 6, 8, 9 and 10 with the substitutions listed. **Skip Task 5** (its loop moves into F3) and **Task 7** (no My posts view).

### Task F1: Land #2's record code verbatim

- [ ] From `git show origin/docs/2-my-posts-plan:docs/superpowers/plans/2026-10-08-my-posts-view.md`, copy unchanged: Task 1's `forumThreadsPayload` (not `forumPostsPayload`), and Task 2 in full except `minePostFromApi` (`STORAGE_KEYS.mine`, `MINE_MAX_THREADS`, `pickList`, `freshMine`, `freshMineThread`, `normaliseMineThread`, `normaliseMine`, `mineThreadFromApi`, `state.mine`, `state.mineError`, and the `loadAll`, `persist`, `reset-all` lines), with its tests. Add beside `DEFAULT_ENRICH_BUDGET`: `var MINE_TTL_MS = 15 * 60 * 1000;` and `var MINE_PAGE_LIMIT = 100;`.
- [ ] `npm test && npm run test:syntax`; commit `feat: tfcc:mine record, ahead of My posts (#10)`.

### Task F2: `mergeStartedReactions` in place of `mergeMineSnapshot`

- [ ] Failing test in `tests/reactions.test.js`:

```js
test('mergeStartedReactions marks started threads and never sets a baseline', () => {
  const snap = api.mergeStartedReactions(api.freshMine(), [apiRow({ id: 5, rating: 3, total: 12 })], NOW);
  const t = snap.threads.find((x) => x.id === 5);
  assert.strictEqual(t.started, true);
  assert.strictEqual(t.rating, 3);
  assert.strictEqual(snap.fetchedAt, NOW);
  // My posts sets the baseline on first sight of a total; setting it here
  // would make its first fetch a second sighting.
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

- [ ] In Task 2, skip the `mergeMineSnapshot` edit and its test. Commit `feat: interim started-thread merge for the reactions line (#10)`.

### Task F3: `refreshReactions`, on tap only

- [ ] Failing tests in `tests/reactions-refresh.test.js`, with the `settle`/`router`/`table`/`boot`/`limiterAllowing` helpers from Task 5's test file (drop `user/forumposts` and `forum/20/*` from `table`): one tap with 8 started threads makes 1 list request plus 5 `forum/<id>/posts` requests with `sort=ASC&offset=0`; a second tap within `MINE_TTL_MS` makes no list request and only topic lookups still due; with `enrichBudget` 0 a tap makes exactly 1 request; two taps at once make one run (single flight); no key makes none; a throttled list request makes no topic request; Reset everything mid-run drops the late answer; a failure detail containing the key is scrubbed; `refreshAll` never requests `user/forumthreads` or `forum/<id>/posts`.
- [ ] Implement after `enrichThreads`, plus Task 5's `enrichReactions` verbatim:

```js
  // Interim (#10 ahead of #2): only when the user taps the reactions line.
  // One user/forumthreads request at most once per MINE_TTL_MS, then at most
  // min(REACTION_LOOKUPS_PER_RUN, enrichBudget) topic lookups, each thread at
  // most once per TOPIC_TTL_MS. Never called by refresh, auto refresh or load.
  function refreshReactions(now, opts) {
    var options = opts || {};
    if (state.refreshingReactions) return Promise.resolve({ ok: false, reason: 'inflight' });
    if (!isKeyShaped(loadApiKey())) return Promise.resolve({ ok: false, reason: 'nokey' });
    state.refreshingReactions = true;
    var generation = state.generation;
    var budget = clamp(toInt(state.settings.enrichBudget, DEFAULT_ENRICH_BUDGET), 0, MAX_ENRICH_BUDGET);
    function stale() { return generation !== state.generation; }
    function fail(reason, detail) {
      state.mineError = { reason: reason, detail: scrubDetail(detail) };
      return { ok: false, reason: reason };
    }
    var listDue = !(state.mine.fetchedAt > 0 && toInt(now, 0) - state.mine.fetchedAt < MINE_TTL_MS);
    var list = listDue
      ? tornApiGet('user/forumthreads', { limit: MINE_PAGE_LIMIT }, options).then(function (res) {
        if (stale()) return { ok: false, reason: 'stale' };
        if (!res.ok) return fail(res.reason || 'network', res.detail || 'Could not load your threads.');
        var rows = pickList(res.data, ['forumThreads', 'forum_threads', 'threads']);
        if (!rows) return fail('parse', 'Torn\'s answer for your threads was not in the shape this version expects.');
        state.mine = mergeStartedReactions(state.mine, rows.map(mineThreadFromApi).filter(Boolean), now);
        state.mineError = null;
        return { ok: true };
      })
      : Promise.resolve({ ok: true });
    return list
      .then(function (res) {
        if (stale() || !res.ok) return res;
        var rids = reactionLookupTargets(state.mine, now, TOPIC_TTL_MS, Math.min(REACTION_LOOKUPS_PER_RUN, budget));
        return enrichReactions(rids, now, options, generation).then(function () { return res; });
      })
      .then(function (res) {
        if (!stale()) persist('mine');
        return res;
      })
      .catch(function (e) { return fail('network', (e && e.message) || 'Could not load your threads.'); })
      .then(function (r) { state.refreshingReactions = false; return r; });
  }
```

Add `refreshingReactions: false,` to `state`, and beside `act === 'view'`:

```js
        if (act === 'reactions-load') {
          refreshReactions(now).then(function () { if (isForumsPage(win.location)) redraw(); });
          return;
        }
```

- [ ] **Substitutions:** Task 6's `renderReactions` uses `data-act="reactions-load"` with no `data-view`, and `reactionsTitle(r, model.now, MINE_PAGE_LIMIT, 'Tap here')`; its tap test asserts `data-act="reactions-load"`. Task 8's Settings note appends to the existing v0.1.0 note (ending `'under 40 requests a minute regardless.</p>');`) the sentence `Tapping the thumbs line under the title loads the threads you started (one request, at most once every 15 minutes) and reads the opening post of up to 5 of them, each at most once every 12 hours.` with the numbers from the constants; its test pins that sentence; debug counts are appended after `cachedPosts`. Task 9: the two Task 5 mutation entries become `'the reactions run ignores its topic cap'` (replace `Math.min(REACTION_LOOKUPS_PER_RUN, budget)` with `1000` in `refreshReactions`) and `'the reactions list ignores its TTL'` (replace `toInt(now, 0) - state.mine.fetchedAt < MINE_TTL_MS` with `false`), suite `tests/reactions-refresh.test.js`.
- [ ] **Budget:** at most 1 + `min(5, enrichBudget)` per tap: 6 at defaults, 1 at 0. Worst minute at defaults 13 + 6 = 19 of 40; at the largest setting 28 + 6 = 34. Default refresh unchanged.
- [ ] Commit `feat: load your threads' thumbs on tap, ahead of My posts (#10)`.

### When #2 then merges (done in #2's PR)

1. `tfcc:mine` code is on `main`: keep it, add only `minePostFromApi`; check it matches #2's Task 2 apart from #10's additions.
2. Do this plan's Task 2 `mergeMineSnapshot` edit and Task 5 (the `refreshMine` hook; `enrichReactions` already exists).
3. Delete `mergeStartedReactions`, `refreshReactions`, `state.refreshingReactions`, the `reactions-load` handler, `tests/reactions-refresh.test.js`, the F2 test and the two interim mutation entries; add Task 9's two Task 5 entries.
4. `renderReactions`: `data-act="view" data-view="mine"`, default opener; update its tests.
5. Settings: replace the interim sentence with Task 8's full note; update the test.
6. Do Task 7.
7. Stored `reactAt`, `rating`, `topicAt`, `up`, `down` carry over unchanged. A `fetchedAt` written by `refreshReactions` delays My posts' first automatic fetch by at most 15 minutes; Refresh in My posts overrides it.
8. `npm test`, `npm run test:syntax`, `node tests/mutation-check.mjs > mutation.log 2>&1` (read the log), `/code-map`.
