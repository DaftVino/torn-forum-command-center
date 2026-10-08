# Only flag author updates - Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a global setting, default off, that flags a subscribed thread as new only when its author has posted since the user last saw it. It shows an honest "not checked" state when author activity is unknown.

**Architecture:** In author-only mode the existing per-thread activity lookup calls `forum/{id}/posts?from=<marker seconds + 1>` instead of `forum/{id}/thread`, so the request ceiling does not change. Torn answers with the newest 20 posts after the marker, newest first; the lookup walks further back with `to=<oldest created_time read>` (inclusive, so pages share one boundary post), up to 3 pages per thread, every page charged to the same lookup budget, breadth before depth. A walk that ends inside the cap is exact; one cut short is a lower bound. The result is stored as seven additive per-thread fields. Four pure engine functions turn that into a per-row author state: `authorPageStep`, `summariseAuthorPosts`, `authorSinceFor` and `authorStateFor`. `mergeThreads`, `catchUpList`, `buildPanelModel` and the renderers read that state.

**Tech Stack:** a single-file ES5-style userscript (`torn-forum-command-center.user.js`), Node `node:test` plus the `vm` harness in `tests/load-userscript.js`, and no runtime dependencies.

**Spec:** `docs/superpowers/specs/2026-10-08-author-only-updates-design.md`. Read it first. Where this plan and the spec disagree, the spec wins and this plan is amended.

**API evidence:** `docs/reference/torn-api-live-findings-2026-10-08.md` (live capture, 2026-10-08), including finding 15 (`to` pages backwards) from PR #15. Where it disagrees with the OpenAPI document, it wins.

## Prerequisites

- **#14 and #15 are merged.** Tasks 3, 7 and 9 load the real redacted fixtures from `tests/fixtures/*.json`. #14 adds `forum-thread-posts-from-small.json`, `forum-posts-large-from.json`, `forum-posts-large-from-offset20-ignored.json`, `forum-posts-large-offset0.json`, `forum-thread.json`, `forum-thread-posts-asc.json`; #15 adds `forum-posts-large-from-prev.json` (the page `forum-posts-large-from.json`'s `prev` link points at) and finding 15. Check with `ls tests/fixtures/forum-posts-large-from.json tests/fixtures/forum-posts-large-from-prev.json`. If either is missing, stop and rebase on `main` once both land. Do not hand-write look-alike payloads in their place: the point of these tests is that they fail if Torn's recorded behaviour and the code disagree.
- Each test file that uses them loads them with one helper, so a missing fixture fails with a clear path rather than `undefined`:

```js
const fs = require('node:fs');
const path = require('node:path');
const fixture = (name) => JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', name + '.json'), 'utf8'));
```

- Facts the tests rely on, all read from those files: thread 16561608's topic author is `1002` (`forum-posts-large-offset0.json`), and `1002` is not among the 20 posts in `forum-posts-large-from.json`; player `1020` wrote 4 of those 20, the newest at `created_time` 1787174754; thread 16589908's author is `1000` and its only reply, at 1786067226, is by `1001` (`forum-thread.json`, `forum-thread-posts-from-small.json`). `forum-posts-large-from-prev.json` holds 20 posts from 1784466765 down to 1784166231, and shares exactly one id with `forum-posts-large-from.json`, the boundary post 27638444 (finding 15; the tests assert this rather than assume it). Its own `prev` points at `to=1784166231`; no fixture holds that third page, so the tests that need a longer chain build real-shaped pages by cloning a fixture post (`olderPage` in Task 7).
- **The `prev` URL is never fetched.** Torn's link carries `limit`, `sort` and possibly `key=`; the script builds every URL itself through `tornApiGet`/`buildApiUrl` from `{ from, to }`, and reads `prev` only for whether it is `null`. Task 7 pins this.

## Global Constraints

- **Never read `torn-forum-command-center.user.js` whole.** Grep `docs/code-map.md` for the symbol, confirm the line with `grep -n "function <name>"`, then `Read` with offset/limit. The line numbers in this plan are from `884f614` and will drift.
- The source must be ASCII only (`tests/metadata.test.js`). Type straight quotes only, in strings and in comments alike.
- The engine section stays pure (`tests/purity.test.js`): no DOM, no network, no `GM_*`, no `Date.now()`. Time is passed in as `now`.
- A default refresh makes at most 13 requests (2 fixed + 1 daily categories + `DEFAULT_ENRICH_BUDGET` = 10), and the limiter allows 40 per rolling minute. Author-only mode must not change either number. The budget counts **requests**, so every posts page, first or further, takes one unit: at most 3 + 10 = 13 by default and 3 + 25 = 28 at `MAX_ENRICH_BUDGET`, both under 40. The Settings copy must state the cost.
- The script is read-only: GET to `api.torn.com` only. No change to `@match`, `@grant` or `@connect`.
- The key never leaves the device. Every error detail goes through `scrubDetail`.
- ADR 0001: no data path reads Torn's DOM.
- Never show `tornUnread` (Torn's any-poster `posts.new`) under an author-only label.
- An unknown author state is shown as `author: not checked` and is never left blank.
- Setting off: every existing output stays byte-identical. The existing suites prove this. Do not edit an existing assertion to make it pass.
- `@version`, `SCRIPT_VERSION`, `package.json` `version`, the newest `CHANGELOG.md` heading, and the git tag move together in one separate release commit. This PR only adds an `[Unreleased]` entry (Task 10).
- `node tests/mutation-check.mjs > <file>` only. **Never pipe it into `head`** or anything else that closes the pipe early.

## Review Focus

1. **A thread with more than 20 new posts.** With `from`, Torn returns the *newest* 20 after the marker; `offset` is ignored, so the lookup walks back with `to`, up to 3 pages. A walk that ends inside the cap (short page or `null` `prev`) is exact. A walk cut short by the cap, the budget or a failed further page is a lower bound: `N+ new by author` if any author post was read, `author: not checked (too many new)` if none, never "nothing new". Pinned in Task 3 against `forum-posts-large-from.json` plus `forum-posts-large-from-prev.json`, in Task 7 (cap and budget) and in Task 6 (badge text).
2. **The boundary post counted twice.** `to` is inclusive, so consecutive pages share one post. An author post on the boundary must count once. Pinned in Task 3 with the two real pages, which share exactly one id, and with a smaller real-shaped pair whose shared post is by the author.
3. **Further pages starving other threads, or breaking the 13.** Further pages are charged to the same budget and fetched only while one request stays reserved for each thread not yet started. Pinned in Task 7 (10 targets: exactly 10 requests, one per thread; 3 targets: at most 3 pages each, total within the budget).
4. **A post exactly at the read marker.** `from` is inclusive, so a post the user has already seen could come back and be counted. The request sends marker + 1 and the engine counts only `created_time * 1000 > since`. Pinned in Task 3 against `forum-thread-posts-from-small.json` and in Task 7 (the exact `from` value sent).
5. **Lookup targets chosen from `row.unread`, which is 0 for an unchecked row in author mode,** so nothing would ever get checked. Pinned in Task 7, with a mutation in Task 9.
6. **Unread only plus author mode hiding unchecked rows,** so an unknown looks like known-empty. Pinned in Task 5, with a mutation in Task 9.
7. **Mark read after an author post, then a non-author reply.** The user would expect no badge, because the marker moved past the author post. Pinned in Task 4 (`stale` after marker change, then `none` after a check).
8. **Mixing a thread's `posts` with subscribed `posts.total`.** The first counts replies, the second every post, so they differ by 1. The check total must come from subscribed `posts.total` only. Pinned in Task 3 (the +1, against the fixtures) and Task 7 (`authorCheckTotal` equals the subscribed total). This plan needs no thread-side total. If an implementer finds one is needed, use #2's `threadPostsTotal(raw)` (numeric `posts` -> `posts + 1`, `posts.total` unchanged, unknown -> -1; add it exactly as `docs/superpowers/plans/2026-10-08-my-posts-view.md` defines it if #2 is not on main, and whichever PR merges second reconciles). **Do not apply a second +1** to a value that came through `threadPostsTotal` or `parseThreadDetail`: it is already in `posts.total` units.

---

### Task 1: The `authorOnly` setting

**Files:**
- Modify: `torn-forum-command-center.user.js` - `settingsDefaults` (~l.304), `normaliseSettings` (~l.330)
- Test: `tests/storage.test.js`

**Interfaces:**
- Produces: `settings.authorOnly: boolean` (default `false`)

- [ ] **Step 1: Write the failing test** (append to `tests/storage.test.js`, using that file's existing `api` handle)

```js
test('authorOnly defaults off, accepts only true, and round-trips', () => {
  assert.strictEqual(api.freshSettings().authorOnly, false);
  assert.strictEqual(api.normaliseSettings({ v: 1, authorOnly: true }).authorOnly, true);
  for (const bad of ['true', 1, null, {}, undefined]) {
    assert.strictEqual(api.normaliseSettings({ v: 1, authorOnly: bad }).authorOnly, false, String(bad));
  }
  const round = api.normaliseSettings(JSON.parse(JSON.stringify(api.normaliseSettings({ v: 1, authorOnly: true }))));
  assert.strictEqual(round.authorOnly, true);
});
```

- [ ] **Step 2: Run it and confirm it fails.** Run `node --test tests/storage.test.js`. Expected: FAIL, `undefined !== false`.
- [ ] **Step 3: Implement.** In `settingsDefaults` add `authorOnly: false,` after `hideTornBox: false,`. In `normaliseSettings` add `out.authorOnly = raw.authorOnly === true;` after the `hideTornBox` line.
- [ ] **Step 4: Run `npm test`.** Expected: all PASS.
- [ ] **Step 5: Write the failing upgrade test.** Adding `authorOnly` re-opens the upgrade trap: `loadKey` calls a stored value damaged whenever `JSON.stringify(raw)` differs from the normalised value, and a v0.1.0 settings blob has no `authorOnly`. Every upgrading user would be told "Settings were damaged and have been reset." with nothing damaged. Append to `tests/storage.test.js`:

```js
test('a settings blob saved by 0.1.0 is not reported as damaged', () => {
  // 0.1.0 wrote every field it knew and nothing else. authorOnly is absent
  // from it. That is an upgrade, not damage.
  const NOW = 1700000000000;
  const old = api.freshSettings();
  delete old.authorOnly;

  const env = loadUserscript({ gmStore: [['tfcc:settings', JSON.stringify(old)]] });
  const res = env.exports.loadKey('tfcc:settings', env.exports.normaliseSettings, NOW);
  assert.strictEqual(res.recovered, false);
  assert.strictEqual(res.value.authorOnly, false, 'the default is filled in');

  env.exports.loadAll(NOW);
  const notices = env.exports.state.notices.map((n) => n.text).join(' ');
  assert.doesNotMatch(notices, /Settings were damaged/);
});
```

Run `node --test tests/storage.test.js`. Expected: FAIL on this test only (`recovered` is `true`).
- [ ] **Step 6: Make sure `isRecoveredValue` is on main.** If `isRecoveredValue` is not yet on main (it is introduced by #8), add it and wire it into `loadKey` exactly as the #8 plan specifies, including its test; if it is on main, skip. Check first with `grep -n "function isRecoveredValue" torn-forum-command-center.user.js`. The #8 plan is `docs/superpowers/plans/2026-10-08-auto-hide-on-open.md`, Task 1 Steps 1, 2 and 6. In short: the pure engine helper `isRecoveredValue(raw, value)` fills absent top-level keys of a plain-object `raw` from `value` before the `JSON.stringify` comparison, `loadKey` uses it, `'isRecoveredValue'` joins `EXPORT_NAMES` in `tests/load-userscript.js`, and the test `isRecoveredValue forgives only absent top-level fields` comes with it. Whichever PR lands second drops its copy.
- [ ] **Step 7: Run `npm test`.** Expected: all PASS, including the upgrade test.
- [ ] **Step 8: Commit** with `git commit -am "feat: authorOnly setting, default off (#4)"`

### Task 2: Per-thread author-check fields (persisted, additive)

**Files:**
- Modify: `normaliseThreadEntry` (~l.365)
- Test: `tests/storage.test.js`

**Interfaces:**
- Produces these entry fields: `authorCheckedAt` (ms), `authorCheckTotal` (int), `authorCheckSince` (ms), `authorNewCount` (int), `authorLatestAt` (ms), `authorCheckComplete` (bool), `authorCheckReason` (`''|'too-many'`)

- [ ] **Step 1: Write the failing tests**

```js
test('author-check fields default to zero and survive normalisation', () => {
  const blank = api.normaliseThreadEntry(null);
  assert.deepStrictEqual(
    [blank.authorCheckedAt, blank.authorCheckTotal, blank.authorCheckSince, blank.authorNewCount,
      blank.authorLatestAt, blank.authorCheckComplete, blank.authorCheckReason],
    [0, 0, 0, 0, 0, false, '']);
  const e = api.normaliseThreadEntry({
    authorCheckedAt: 5, authorCheckTotal: 12, authorCheckSince: 4, authorNewCount: 2,
    authorLatestAt: 3, authorCheckComplete: true, authorCheckReason: 'too-many',
  });
  assert.strictEqual(e.authorNewCount, 2);
  assert.strictEqual(e.authorCheckComplete, true);
  assert.strictEqual(e.authorCheckReason, 'too-many');
  assert.strictEqual(api.normaliseThreadEntry({ authorCheckReason: 'evil<b>' }).authorCheckReason, '');
  assert.strictEqual(api.normaliseThreadEntry({ authorNewCount: -4 }).authorNewCount, 0);
});

test('a v0.1.0 organizer entry with no author fields loads unchanged otherwise', () => {
  const old = { pinned: true, lastSeenTotal: 9, lastVisitedAt: 100, note: 'n' };
  const e = api.normaliseThreadEntry(old);
  assert.strictEqual(e.pinned, true);
  assert.strictEqual(e.lastSeenTotal, 9);
  assert.strictEqual(e.authorCheckedAt, 0);
});

test('an export never carries author-check cache fields', () => {
  const env = loadUserscript();
  const api = env.exports;
  const o = api.freshOrganizer(0);
  o.threads['7'] = api.normaliseThreadEntry({ pinned: true, authorNewCount: 3, authorCheckedAt: 9 });
  const text = api.encodeState(o, api.freshDrafts(), env.sandbox.btoa);
  const json = api.b64DecodeUtf8(text.slice(api.EXPORT_PREFIX.length), env.sandbox.atob);
  assert.ok(json.indexOf('"pinned":true') !== -1, 'the thread must be in the export, or this proves nothing');
  assert.ok(!/author(Check|NewCount|LatestAt)/.test(json), json);
});
```

(The third test builds its own `env` because it needs `env.sandbox.btoa`. Its first assertion makes sure the thread was exported at all, so the absence check cannot pass on an empty export.)

- [ ] **Step 2: Run them and confirm the first fails** (`node --test tests/storage.test.js`). The export test may already pass. That is fine: it guards the allow-list in `encodeState` against future drift.
- [ ] **Step 3: Implement.** Add the seven defaults to the `e` literal in `normaliseThreadEntry`, then:

```js
    e.authorCheckedAt = Math.max(0, toInt(raw.authorCheckedAt, 0));
    e.authorCheckTotal = Math.max(0, toInt(raw.authorCheckTotal, 0));
    e.authorCheckSince = Math.max(0, toInt(raw.authorCheckSince, 0));
    e.authorNewCount = Math.max(0, toInt(raw.authorNewCount, 0));
    e.authorLatestAt = Math.max(0, toInt(raw.authorLatestAt, 0));
    e.authorCheckComplete = raw.authorCheckComplete === true;
    e.authorCheckReason = AUTHOR_CHECK_REASONS.indexOf(raw.authorCheckReason) !== -1 ? raw.authorCheckReason : '';
```

Add this near the other frozen constants (~l.98): `var AUTHOR_CHECK_REASONS = Object.freeze(['', 'too-many']);`. Do not bump `SCHEMA_VERSION`. The change is additive, and `normaliseOrganizer` would otherwise refuse every stored organizer.
- [ ] **Step 4: Run `npm test`.** Expected: PASS.
- [ ] **Step 5: Write the failing nested upgrade tests.** The seven fields above live inside `organizer.threads[id]`, one level below the top, so `isRecoveredValue` (top-level only, nested shapes deliberately not forgiven) does not cover them. A v0.1.0 organizer would report "Folders and tags were damaged and have been reset." on every upgrade. Append to `tests/storage.test.js`:

```js
const AUTHOR_FIELDS = ['authorCheckedAt', 'authorCheckTotal', 'authorCheckSince', 'authorNewCount',
  'authorLatestAt', 'authorCheckComplete', 'authorCheckReason'];

function organizer010(raw) {
  // What 0.1.0 wrote: every thread entry without the seven author fields.
  const o = api.normaliseOrganizer(raw, 1700000000000);
  Object.keys(o.threads).forEach((id) => AUTHOR_FIELDS.forEach((k) => { delete o.threads[id][k]; }));
  return o;
}

test('an organizer saved by 0.1.0 is not reported as damaged', () => {
  const NOW = 1700000000000;
  const old = organizer010({ threads: {
    7: { pinned: true, lastSeenTotal: 9, lastVisitedAt: 100, note: 'n' },
    8: { lastSeenTotal: 2 },
  } });
  assert.ok(!('authorNewCount' in old.threads['7']), 'the fixture must really lack the new fields');

  const env = loadUserscript({ gmStore: [['tfcc:organizer', JSON.stringify(old)]] });
  env.exports.loadAll(NOW);
  const notices = env.exports.state.notices.map((n) => n.text).join(' ');
  assert.doesNotMatch(notices, /Folders and tags were damaged/);
  assert.strictEqual(env.exports.state.organizer.threads['7'].pinned, true, 'the stored values were kept');
  assert.strictEqual(env.exports.state.organizer.threads['7'].authorNewCount, 0, 'the default is filled in');
});

test('a genuinely corrupt thread entry is still reported as damage', () => {
  const NOW = 1700000000000;
  const cases = {
    'a present field the normaliser changed': (o) => { o.threads['7'].authorNewCount = -4; },
    'an off-list reason': (o) => { o.threads['7'].authorCheckReason = 'evil<b>'; },
    'a wrong-typed old field': (o) => { o.threads['7'].pinned = 'yes'; },
    'an unknown key the normaliser drops': (o) => { o.threads['7'].stray = 1; },
    'an entry the normaliser drops': (o) => { o.threads.abc = { pinned: true }; },
    'a top-level field that is wrong': (o) => { o.lastCatchUpAt = 'soon'; },
  };
  for (const name of Object.keys(cases)) {
    const bad = organizer010({ threads: { 7: { pinned: true, lastSeenTotal: 9 } } });
    cases[name](bad);
    const env = loadUserscript({ gmStore: [['tfcc:organizer', JSON.stringify(bad)]] });
    env.exports.loadAll(NOW);
    const notices = env.exports.state.notices.map((n) => n.text).join(' ');
    assert.match(notices, /Folders and tags were damaged/, name);
  }
});
```

Run `node --test tests/storage.test.js`. Expected: `an organizer saved by 0.1.0 ...` FAILS (a false damage notice); the corrupt-entry test passes already, as a regression guard for the fix.
- [ ] **Step 6: Implement the per-entry recovery check.** Chosen approach: the recovery comparison runs per thread entry, in a new organizer-specific pure helper. Reason: it forgives exactly one kind of difference (a key absent from a stored thread entry) at exactly one known place, and leaves `isRecoveredValue` and its pinned "nested shapes keep the strict comparison" test untouched, whereas a one-level-deeper rule inside the shared helper would change a function #8 and #3 depend on.

In the engine, directly after `normaliseOrganizer`:

```js
  // An upgrade adds per-thread fields (issue #4). They are nested inside the
  // threads map, which isRecoveredValue deliberately does not forgive, so fill
  // each raw thread entry's absent keys from its normalised entry first. A key
  // that is present and changed, a key the normaliser drops, and an entry it
  // drops all still differ, so they are still damage.
  function isRecoveredOrganizer(raw, value) {
    if (isPlainObject(raw) && isPlainObject(raw.threads) && isPlainObject(value) && isPlainObject(value.threads)) {
      var threads = {};
      Object.keys(raw.threads).forEach(function (id) {
        var r = raw.threads[id];
        var v = value.threads[id];
        threads[id] = isPlainObject(r) && isPlainObject(v) ? Object.assign({}, v, r) : r;
      });
      raw = Object.assign({}, raw, { threads: threads });
    }
    return isRecoveredValue(raw, value);
  }
```

Give `loadKey` an optional fourth argument and use it for the organizer:

```js
  function loadKey(name, normaliser, now, recoveredCheck) {
    ...
    var recovered = (recoveredCheck || isRecoveredValue)(raw, value);
```

```js
    var o = loadKey(STORAGE_KEYS.organizer, normaliseOrganizer, now, isRecoveredOrganizer);
```

Add `'isRecoveredOrganizer'` to `EXPORT_NAMES` in `tests/load-userscript.js`. `tests/purity.test.js` covers it by position (it takes only arguments).
- [ ] **Step 7: Run to verify.** `node --test tests/storage.test.js` then `npm test && npm run test:syntax`. Expected: PASS, including `tests/storage.test.js` "a damaged key is reported".
- [ ] **Step 8: Commit** with `git commit -am "feat: persist per-thread author-check result (#4)"`

### Task 3: `authorPageStep` and `summariseAuthorPosts` (pure)

**Files:**
- Modify: the engine, next to `unreadFor` (~l.708, "merge, unread, sort"). Add `var AUTHOR_MAX_PAGES = 3;` near the other frozen constants (~l.98).
- Modify: `tests/load-userscript.js` `EXPORT_NAMES`. Add `'authorPageStep', 'summariseAuthorPosts', 'authorSinceFor', 'authorStateFor', 'catchUpUnchecked', 'checkAuthorPosts', 'AUTHOR_REASON_TEXT', 'AUTHOR_MAX_PAGES'` to the "engine: merge, unread, sort" line. The harness guards each name with `typeof`, so a name that does not exist yet is `undefined` and its test fails with "not a function". Add each name in the task that creates it.
- Create: `tests/author.test.js`
- Read: the fixtures listed under Prerequisites (from #14 and #15)

**Interfaces:**
- Produces:
  - `authorPageStep(pagePosts: any, seenIds: number[], perPage: number, prevLink: any) -> { done, complete, to }`. `done && complete`: the walk reached the marker (a page shorter than `perPage`, or `prevLink === null`). `done && !complete`: stuck (a full page added no new id). `!done`: fetch the next page with `to` = the oldest `created_time` on this page.
  - `summariseAuthorPosts(posts: any, authorId: number, sinceMs: number, complete: boolean) -> { count, latestAt, newestAt, complete }`. `posts` is every page of the walk concatenated; each post id counts once.

The walk reads `forum/{id}/posts?from=<marker + 1>`, then `&to=<oldest created_time read>` for each further page. Torn returns newest first, at most 20, `to` inclusive (findings 8, 9, 15). So consecutive pages share one boundary post, and completeness comes from the walk, not from one page's length.

- [ ] **Step 1: Write the failing tests** (`tests/author.test.js`)

The first block pins the API facts the design rests on, read straight from the fixtures. They pass before any code is written. That is intended: they are not tests of the script, they are the tripwire that fails if a recapture shows Torn has changed, and they keep the later assertions honest about which fixture shows what.

```js
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { loadUserscript } = require('./load-userscript');

const { exports: api } = loadUserscript();
const fixture = (name) => JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', name + '.json'), 'utf8'));

const SMALL = fixture('forum-thread-posts-from-small').posts;   // thread 16589908, from = its one reply's created_time
const PAGE0 = fixture('forum-posts-large-from');                // thread 16561608, newest 20 since from
const PAGE1 = fixture('forum-posts-large-from-prev');            // the page PAGE0's prev link points at (finding 15)
const LARGE = PAGE0.posts;
const LARGE_AUTHOR = fixture('forum-posts-large-offset0').posts[0].author.id; // topic post: the thread author
const SINCE = 1700000000000; // a marker before every fixture post
const ids = (posts) => posts.map((p) => p.id);
const distinctBy = (posts, authorId) => new Set(posts.filter((p) => p.author.id === authorId).map((p) => p.id)).size;

test('API facts: from returns the newest 20, newest first, with no next page', () => {
  assert.strictEqual(LARGE.length, 20);
  for (let i = 1; i < LARGE.length; i += 1) {
    assert.ok(LARGE[i - 1].created_time > LARGE[i].created_time, 'newest first at ' + i);
  }
  assert.strictEqual(PAGE0._metadata.links.next, null);
  assert.deepStrictEqual(fixture('forum-posts-large-from-offset20-ignored').posts, LARGE,
    'offset is ignored when from is set, so to is the only way back');
});

test('API facts: from is inclusive', () => {
  // The capture sent from equal to this post's own created_time and got it back.
  assert.strictEqual(SMALL.length, 1);
  assert.strictEqual(SMALL[0].created_time, 1786067226);
});

test('API facts: to pages backwards and is inclusive, so pages share one post', () => {
  const oldest0 = LARGE[LARGE.length - 1].created_time;
  assert.match(PAGE0._metadata.links.prev, new RegExp('[?&]to=' + oldest0 + '(&|$)'));
  assert.strictEqual(PAGE1.posts.length, 20);
  assert.strictEqual(PAGE1.posts[0].created_time, oldest0, 'the next page starts at the boundary');
  const shared = ids(PAGE1.posts).filter((id) => ids(LARGE).includes(id));
  assert.deepStrictEqual(shared, [27638444], 'exactly one boundary post is repeated');
  assert.strictEqual(PAGE1._metadata.links.next, null);
  assert.notStrictEqual(PAGE1._metadata.links.prev, null);
});

test('API facts: a thread\'s posts counts replies, one less than every post', () => {
  const thread = fixture('forum-thread').thread;
  const all = fixture('forum-thread-posts-asc').posts;
  assert.strictEqual(thread.id, 16589908);
  assert.strictEqual(all.length, thread.posts + 1, 'subscribed posts.total is thread.posts + 1');
});

test('a post exactly at the marker was already seen and is not counted', () => {
  const at = SMALL[0].created_time * 1000;
  const author = SMALL[0].author.id;
  assert.strictEqual(api.summariseAuthorPosts(SMALL, author, at, true).count, 0,
    'from is inclusive, so the marker itself must be excluded');
  const fresh = api.summariseAuthorPosts(SMALL, author, at - 1000, true);
  assert.strictEqual(fresh.count, 1);
  assert.strictEqual(fresh.latestAt, at);
});

test('the boundary post repeated by to is counted once (real pages)', () => {
  const both = LARGE.concat(PAGE1.posts);
  const boundaryAuthor = LARGE[LARGE.length - 1].author.id; // the author of post 27638444
  const naive = both.filter((p) => p.author.id === boundaryAuthor).length;
  const r = api.summariseAuthorPosts(both, boundaryAuthor, SINCE, false);
  assert.strictEqual(r.count, distinctBy(both, boundaryAuthor));
  assert.strictEqual(r.count, naive - 1, 'the shared post must not be counted twice');
});

test('the boundary post is counted once when it is the only author post (real-shaped pair)', () => {
  // Two pages shaped exactly like Torn's: 2 posts, then 1, sharing the
  // boundary post, which is the author's. One author post, not two.
  const shape = LARGE[0];
  const post = (id, authorId, t) => Object.assign({}, shape, { id, created_time: t, author: Object.assign({}, shape.author, { id: authorId }) });
  const pageA = [post(9002, 1099, 1784000200), post(9001, 1020, 1784000100)];
  const pageB = [post(9001, 1020, 1784000100)];
  const r = api.summariseAuthorPosts(pageA.concat(pageB), 1020, SINCE, true);
  assert.deepStrictEqual([r.count, r.latestAt], [1, 1784000100000]);
});

test('page step: a short page or a null prev ends the walk complete', () => {
  assert.deepStrictEqual(api.authorPageStep(SMALL, [], 20, null), { done: true, complete: true, to: 0 });
  assert.deepStrictEqual(api.authorPageStep(SMALL, [], 20, undefined), { done: true, complete: true, to: 0 },
    'a short page is complete even without _metadata');
  assert.deepStrictEqual(api.authorPageStep(LARGE, [], 20, null), { done: true, complete: true, to: 0 },
    'Torn saying there is no earlier page is believed');
});

test('page step: a full page with a prev link continues from its oldest post', () => {
  const step0 = api.authorPageStep(LARGE, [], 20, PAGE0._metadata.links.prev);
  assert.deepStrictEqual(step0, { done: false, complete: false, to: LARGE[LARGE.length - 1].created_time });
  const step1 = api.authorPageStep(PAGE1.posts, ids(LARGE), 20, PAGE1._metadata.links.prev);
  assert.deepStrictEqual(step1, { done: false, complete: false, to: PAGE1.posts[PAGE1.posts.length - 1].created_time });
});

test('page step: a full page that adds nothing new stops the walk incomplete', () => {
  // More than 20 posts in one second: to cannot move, and the same page returns.
  assert.deepStrictEqual(api.authorPageStep(LARGE, ids(LARGE), 20, 'x'), { done: true, complete: false, to: 0 });
});

test('only non-author posts in a complete walk count zero', () => {
  const threadAuthor = fixture('forum-thread').thread.author.id; // 1000; the reply is by 1001
  const r = api.summariseAuthorPosts(SMALL, threadAuthor, SINCE, true);
  assert.deepStrictEqual([r.count, r.complete], [0, true]);
  assert.strictEqual(r.newestAt, SMALL[0].created_time * 1000, 'last activity is still learned');
});

test('a walk cut short with no author post is not a known zero', () => {
  const both = LARGE.concat(PAGE1.posts);
  assert.strictEqual(distinctBy(both, LARGE_AUTHOR), 0, 'fixture: the thread author wrote none of the 39');
  const r = api.summariseAuthorPosts(both, LARGE_AUTHOR, SINCE, false);
  assert.deepStrictEqual([r.count, r.complete], [0, false]);
});

test('a walk cut short with author posts is a lower bound with an exact latest time', () => {
  // Treat player 1020, who wrote 4 of the first 20, as the author.
  const both = LARGE.concat(PAGE1.posts);
  const r = api.summariseAuthorPosts(both, 1020, SINCE, false);
  assert.strictEqual(r.count, distinctBy(both, 1020));
  assert.ok(r.count >= 4);
  assert.strictEqual(r.complete, false);
  assert.strictEqual(r.latestAt, 1787174754000, 'the newest author post is on the first page, so this is exact');
  assert.strictEqual(r.newestAt, LARGE[0].created_time * 1000, 'newest first: posts[0] is the last post');
});

test('order does not matter and junk is tolerated', () => {
  const both = LARGE.concat(PAGE1.posts);
  assert.deepStrictEqual(api.summariseAuthorPosts(both.slice().reverse(), 1020, SINCE, false),
    api.summariseAuthorPosts(both, 1020, SINCE, false));
  assert.strictEqual(api.summariseAuthorPosts([null, 'x'].concat(SMALL), 1001, SINCE, true).count, 1);
  assert.strictEqual(api.summariseAuthorPosts(undefined, 5, SINCE, true).count, 0);
  assert.strictEqual(api.summariseAuthorPosts(SMALL, 0, SINCE, true).count, 0, 'unknown author matches nobody');
  assert.strictEqual(api.summariseAuthorPosts(SMALL, 1001, SINCE, 'yes').complete, false, 'only true is complete');
});

test('posts before the marker are skipped, so an ignored from can never claim the topic as new', () => {
  // If Torn stopped honouring from, it would return the oldest page: the topic
  // post by the author, long before the marker.
  const oldest = fixture('forum-posts-large-offset0').posts;
  const marker = (oldest[oldest.length - 1].created_time + 1) * 1000;
  assert.strictEqual(api.summariseAuthorPosts(oldest, LARGE_AUTHOR, marker, false).count, 0);
});
```

- [ ] **Step 2: Run them and confirm the script tests fail.** Run `node --test tests/author.test.js`. Expected: the four `API facts` tests PASS (they read only fixtures); every other test FAILS with `authorPageStep is not a function` or `summariseAuthorPosts is not a function`. In particular the two boundary tests must fail before the code exists, and must still fail against a `summariseAuthorPosts` written without the id check (Task 9 mutates exactly that). If an `API facts` test fails, the fixtures are not the ones this plan was written against: stop and re-read the findings note.
- [ ] **Step 3: Implement**

```js
  // One step of the backwards walk over forum/{id}/posts?from=..&to=... Torn
  // returns newest first, at most perPage, and both from and to are
  // inclusive, so the next page starts with this page's oldest post again.
  // prevLink is the response's _metadata.links.prev, read only for null; the
  // URL itself is never fetched (the script builds its own).
  function authorPageStep(pagePosts, seenIds, perPage, prevLink) {
    var list = Array.isArray(pagePosts) ? pagePosts : [];
    var size = Math.max(1, toInt(perPage, POSTS_PER_PAGE));
    if (list.length < size || prevLink === null) return { done: true, complete: true, to: 0 };
    var seen = {};
    (Array.isArray(seenIds) ? seenIds : []).forEach(function (id) { seen[String(id)] = true; });
    var added = 0;
    var oldest = 0;
    for (var i = 0; i < list.length; i += 1) {
      var post = list[i];
      if (!isPlainObject(post)) continue;
      var t = toInt(post.created_time, 0);
      if (t > 0 && (oldest === 0 || t < oldest)) oldest = t;
      if (!seen[String(post.id)]) added += 1;
    }
    // A full page that brought nothing new: more than a page of posts share
    // one second, so to cannot move. Stop rather than loop; it is a lower bound.
    if (added === 0 || oldest === 0) return { done: true, complete: false, to: 0 };
    return { done: false, complete: false, to: oldest };
  }

  // Reads every page of one walk, concatenated. Each post id counts once, so
  // the boundary post that the inclusive to repeats is not counted twice. A
  // post counts as new only when it is strictly after the marker, which also
  // keeps a post at the marker out even if the request were built wrong.
  // complete comes from the walk (authorPageStep), not from a page length.
  function summariseAuthorPosts(posts, authorId, sinceMs, complete) {
    var list = Array.isArray(posts) ? posts : [];
    var aid = toInt(authorId, 0);
    var since = Math.max(0, toInt(sinceMs, 0));
    var seen = {};
    var out = { count: 0, latestAt: 0, newestAt: 0, complete: complete === true };
    for (var i = 0; i < list.length; i += 1) {
      var post = list[i];
      if (!isPlainObject(post)) continue;
      var key = post.id === undefined || post.id === null ? '' : String(post.id);
      if (key && seen[key]) continue;
      if (key) seen[key] = true;
      var at = secondsToMs(post.created_time);
      if (at <= since) continue;
      if (at > out.newestAt) out.newestAt = at;
      var pid = isPlainObject(post.author) ? toInt(post.author.id, 0) : 0;
      if (aid > 0 && pid === aid) {
        out.count += 1;
        if (at > out.latestAt) out.latestAt = at;
      }
    }
    return out;
  }
```

- [ ] **Step 4: Run `npm test`.** This includes `tests/purity.test.js`. Expected: PASS.
- [ ] **Step 5: Commit** with `git add tests/author.test.js && git commit -am "feat: walk author posts pages backwards and summarise them (#4)"`

### Task 4: `authorSinceFor` and `authorStateFor` (pure)

**Files:**
- Modify: the engine, right after `summariseAuthorPosts`
- Test: `tests/author.test.js`

**Interfaces:**
- Consumes: `unreadFor(apiRow, entry)`, which returns `{ tornUnread, postsTotal, dismissed, unread }`
- Produces:
  - `authorSinceFor(entry) -> ms`
  - `authorStateFor(apiRow, entry, u) -> { state: 'none'|'author'|'author-atleast'|'unchecked', count, latestAt, reason }`
  - `AUTHOR_REASON_TEXT: { never, stale, 'too-many', 'no-author', 'no-marker' }` (ASCII strings)

- [ ] **Step 1: Write the failing tests**

```js
const sub = (extra) => Object.assign({ id: 1, forumId: 61, title: 'T', authorId: 5, authorName: 'a', postsNew: 3, postsTotal: 12 }, extra);
const entry = (extra) => api.normaliseThreadEntry(Object.assign({ lastVisitedAt: SINCE }, extra));
const state = (s, e) => api.authorStateFor(s, e, api.unreadFor(s, e));

test('the marker is the last visit or mark read, else first seen', () => {
  assert.strictEqual(api.authorSinceFor(entry({})), SINCE);
  assert.strictEqual(api.authorSinceFor(api.normaliseThreadEntry({ firstSeenAt: 7 })), 7);
  assert.strictEqual(api.authorSinceFor(api.normaliseThreadEntry(null)), 0);
});

test('nothing unread or dismissed is a known none, with no lookup needed', () => {
  assert.strictEqual(state(sub({ postsNew: 0 }), entry({})).state, 'none');
  assert.strictEqual(state(sub(), entry({ lastSeenTotal: 12 })).state, 'none');
});

test('never checked is unchecked, never silently none', () => {
  const r = state(sub(), entry({}));
  assert.deepStrictEqual([r.state, r.reason, r.count], ['unchecked', 'never', 0]);
});

test('a valid check with author posts is an exact count', () => {
  const e = entry({ authorCheckedAt: 1, authorCheckTotal: 12, authorCheckSince: SINCE, authorNewCount: 2, authorLatestAt: SINCE + 5, authorCheckComplete: true });
  const r = state(sub(), e);
  assert.deepStrictEqual([r.state, r.count, r.latestAt], ['author', 2, SINCE + 5]);
});

test('a valid check with only non-author posts is none', () => {
  const e = entry({ authorCheckedAt: 1, authorCheckTotal: 12, authorCheckSince: SINCE, authorNewCount: 0, authorCheckComplete: true });
  assert.strictEqual(state(sub(), e).state, 'none');
});

test('a walk cut short with no author post is unchecked too-many, not none', () => {
  const e = entry({ authorCheckedAt: 1, authorCheckTotal: 12, authorCheckSince: SINCE, authorNewCount: 0, authorCheckComplete: false, authorCheckReason: 'too-many' });
  assert.deepStrictEqual([state(sub(), e).state, state(sub(), e).reason], ['unchecked', 'too-many']);
});

test('too-many is re-checked only when the thread grows or the marker moves', () => {
  // While nothing changes the same request returns the same 20, so a lookup
  // would be wasted.
  const base = { authorCheckedAt: 1, authorCheckTotal: 12, authorCheckSince: SINCE, authorNewCount: 0, authorCheckComplete: false, authorCheckReason: 'too-many' };
  assert.strictEqual(state(sub(), entry(base)).reason, 'too-many');
  assert.strictEqual(state(sub({ postsTotal: 13 }), entry(base)).reason, 'stale', 'a new post may be the author\'s');
  const moved = entry(Object.assign({}, base, { lastVisitedAt: SINCE + 60000 }));
  assert.strictEqual(state(sub(), moved).reason, 'stale', 'a visit or mark read brings the older posts back in range');
});

test('a walk cut short with author posts is a lower bound', () => {
  const e = entry({ authorCheckedAt: 1, authorCheckTotal: 12, authorCheckSince: SINCE, authorNewCount: 1, authorLatestAt: SINCE + 5, authorCheckComplete: false });
  assert.strictEqual(state(sub(), e).state, 'author-atleast');
});

test('growth after a positive check keeps a lower bound; after a zero check it goes stale', () => {
  const pos = entry({ authorCheckedAt: 1, authorCheckTotal: 10, authorCheckSince: SINCE, authorNewCount: 1, authorLatestAt: SINCE + 5, authorCheckComplete: true });
  assert.strictEqual(state(sub(), pos).state, 'author-atleast');
  const zero = entry({ authorCheckedAt: 1, authorCheckTotal: 10, authorCheckSince: SINCE, authorNewCount: 0, authorCheckComplete: true });
  assert.deepStrictEqual([state(sub(), zero).state, state(sub(), zero).reason], ['unchecked', 'stale']);
});

test('moving the marker (mark read, visit) invalidates an old positive check', () => {
  const e = entry({ lastVisitedAt: SINCE + 60000, authorCheckedAt: 1, authorCheckTotal: 12, authorCheckSince: SINCE, authorNewCount: 2, authorCheckComplete: true });
  assert.deepStrictEqual([state(sub(), e).state, state(sub(), e).reason], ['unchecked', 'stale']);
});

test('an unknown author or no marker is unchecked with its own reason', () => {
  assert.strictEqual(state(sub({ authorId: 0 }), entry({})).reason, 'no-author');
  assert.strictEqual(state(sub(), api.normaliseThreadEntry(null)).reason, 'no-marker');
});

test('every reason has ASCII tooltip text that never quotes a count', () => {
  for (const k of ['never', 'stale', 'too-many', 'no-author', 'no-marker']) {
    assert.match(api.AUTHOR_REASON_TEXT[k], /^[\x20-\x7e]+$/);
    assert.doesNotMatch(api.AUTHOR_REASON_TEXT[k], /\d+ new/);
  }
});
```

- [ ] **Step 2: Run them and confirm they fail** (`node --test tests/author.test.js`).
- [ ] **Step 3: Implement**

```js
  var AUTHOR_REASON_TEXT = Object.freeze({
    never: 'Not checked for author posts yet. Torn reports new posts from someone. Refresh, or raise Activity lookups in Settings.',
    stale: 'New posts since the last check. Not rechecked yet. Refresh to check again.',
    'too-many': 'More posts are new than one refresh reads for a thread, so they could not all be read. None of those read is by the author; the older ones were not checked. Open the thread or mark it read to start counting again.',
    'no-author': 'The thread author is not known, so their posts cannot be picked out.',
    'no-marker': 'Open this thread or mark it read once, so there is a point to count from.',
  });

  // The point after which an author post counts as new: the last time the
  // user saw the thread (a captured visit or Mark read), else when the script
  // first saw it. Posts from before the install are deliberately not flagged.
  function authorSinceFor(entry) {
    if (!entry) return 0;
    return entry.lastVisitedAt > 0 ? entry.lastVisitedAt : Math.max(0, toInt(entry.firstSeenAt, 0));
  }

  function authorStateFor(apiRow, entry, u) {
    var e = entry || normaliseThreadEntry(null);
    function unchecked(reason) { return { state: 'unchecked', count: 0, latestAt: 0, reason: reason }; }
    if (!u || u.dismissed || u.tornUnread === 0) return { state: 'none', count: 0, latestAt: 0, reason: '' };
    var authorId = (apiRow && apiRow.authorId) || e.authorId || 0;
    if (!authorId) return unchecked('no-author');
    var since = authorSinceFor(e);
    if (!since) return unchecked('no-marker');
    if (!e.authorCheckedAt) return unchecked('never');
    if (e.authorCheckSince !== since) return unchecked('stale');
    if (e.authorCheckTotal === u.postsTotal) {
      if (e.authorNewCount > 0) {
        return { state: e.authorCheckComplete ? 'author' : 'author-atleast', count: e.authorNewCount, latestAt: e.authorLatestAt, reason: '' };
      }
      // A walk cut short with no author post is never a known zero: the author
      // may have posted among the new posts the walk did not reach.
      return e.authorCheckComplete ? { state: 'none', count: 0, latestAt: 0, reason: '' } : unchecked('too-many');
    }
    if (e.authorNewCount > 0) {
      return { state: 'author-atleast', count: e.authorNewCount, latestAt: e.authorLatestAt, reason: 'grown' };
    }
    return unchecked('stale');
  }
```

- [ ] **Step 4: Run `npm test`.** Expected: PASS.
- [ ] **Step 5: Commit** with `git commit -am "feat: per-row author state with an explicit unchecked state (#4)"`

### Task 5: Wire the state through `mergeThreads`, `catchUpList`, `recompute` and `buildPanelModel`

**Files:**
- Modify: `mergeThreads` (~l.769), `catchUpList` (~l.911), `recompute` (~l.1891), `buildPanelModel` (~l.2526)
- Test: `tests/author.test.js`, `tests/panel.test.js`

**Interfaces:**
- Consumes: `authorStateFor`
- Produces:
  - Row fields `authorState` (`'off'` when the setting is off), `authorNew`, `authorLatestAt`, `authorReason`. In author mode `row.unread` is the author count. `row.tornUnread` is unchanged.
  - `catchUpList(rows, lastCatchUpAt, mode)`, where `mode` is `'any'` (default) or `'author'`.
  - `catchUpUnchecked(rows) -> rows`
  - Model fields `catchUpUnchecked`, `totals.unchecked`, `authorOnly`, `settings.authorOnly`.

- [ ] **Step 1: Write the failing engine tests** (`tests/author.test.js`)

```js
function merged(authorOnly, entryExtra, subExtra) {
  const o = api.freshOrganizer(0);
  o.threads['1'] = api.normaliseThreadEntry(Object.assign({ lastVisitedAt: SINCE }, entryExtra));
  return api.mergeThreads({ subscribed: [sub(subExtra)], activity: [], categories: [], organizer: o, drafts: api.freshDrafts(), now: SINCE + 1, authorOnly })[0];
}

test('setting off: unread is still Torn\'s count and authorState is off', () => {
  const r = merged(false, {});
  assert.strictEqual(r.unread, 3);
  assert.strictEqual(r.authorState, 'off');
});

test('setting on: only non-author posts means no badge count and not in catch up', () => {
  const r = merged(true, { authorCheckedAt: 1, authorCheckTotal: 12, authorCheckSince: SINCE, authorNewCount: 0, authorCheckComplete: true });
  assert.strictEqual(r.unread, 0, 'must not fall back to Torn\'s any-poster count');
  assert.strictEqual(r.tornUnread, 3);
  assert.deepStrictEqual(api.catchUpList([r], 0, 'author'), []);
});

test('setting on: an author post flags the row and puts it in catch up', () => {
  const r = merged(true, { authorCheckedAt: 1, authorCheckTotal: 12, authorCheckSince: SINCE, authorNewCount: 2, authorLatestAt: SINCE + 9, authorCheckComplete: true });
  assert.strictEqual(r.unread, 2);
  assert.strictEqual(api.catchUpList([r], SINCE, 'author').length, 1);
  assert.strictEqual(api.catchUpList([r], SINCE + 9, 'author').length, 0, 'before the catch-up point means already caught up');
});

test('setting on: an unchecked row is not an update, but is listed as unchecked', () => {
  const r = merged(true, {});
  assert.strictEqual(r.authorState, 'unchecked');
  assert.strictEqual(r.unread, 0);
  assert.deepStrictEqual(api.catchUpList([r], 0, 'author'), []);
  assert.strictEqual(api.catchUpUnchecked([r]).length, 1);
});

test('setting on: is:unread keeps an unchecked row, setting off it does not', () => {
  const q = api.parseQuery('is:unread');
  assert.strictEqual(api.matchThread(merged(true, {}), q), true, 'an unknown must not be filtered out as known-empty');
  assert.strictEqual(api.matchThread(merged(true, { authorCheckedAt: 1, authorCheckTotal: 12, authorCheckSince: SINCE, authorNewCount: 0, authorCheckComplete: true }), q), false);
  assert.strictEqual(api.matchThread(merged(false, {}), q), true);
});

test('catchUpList with no mode behaves exactly as before', () => {
  const r = merged(false, {});
  assert.deepStrictEqual(api.catchUpList([r], 0).map((x) => x.id), api.catchUpList([r], 0, 'any').map((x) => x.id));
});
```

- [ ] **Step 2: Write the failing panel tests** (`tests/panel.test.js`, using its `seed` helper; the author defaults to `id: 3`)

```js
test('author mode: Unread only keeps unchecked rows visible', () => {
  const env = loadUserscript({ location: forums() });
  env.exports.state.settings.authorOnly = true;
  env.exports.state.settings.unreadOnly = true;
  env.exports.state.organizer.threads['1'] = env.exports.normaliseThreadEntry({ lastVisitedAt: NOW - 1000 });
  seed(env, [{ id: 1, unread: 4 }]);
  const model = env.exports.buildPanelModel(NOW);
  assert.strictEqual(model.rows.length, 1, 'an unknown must not be hidden as if it were known-empty');
  assert.strictEqual(model.totals.unchecked, 1);
  assert.strictEqual(model.catchUp.length, 0);
  assert.strictEqual(model.catchUpUnchecked.length, 1);
});
```

  In `tests/handlers.test.js`, add (model it on the `hide-torn-box` test: `makeHandlers(env.doc, env.win)`, `{ getAttribute: () => null }` element stubs):

```js
test('Mark all read in author mode leaves unchecked threads unmarked', () => {
  const env = loadUserscript({ location: forums(), now: NOW });
  const api = env.exports;
  api.state.settings.authorOnly = true;
  api.state.organizer.threads['1'] = api.normaliseThreadEntry({ lastVisitedAt: NOW - 1000 });
  api.state.feed.subscribed = [1, 2].map((id) => api.normaliseSubscribedRow({
    id, forum_id: 61, title: 'T' + id, author: { id: 3, username: 'a', karma: 1 }, posts: { new: 2, total: 9 },
  }));
  api.state.organizer.threads['2'] = api.normaliseThreadEntry({
    lastVisitedAt: NOW - 1000, authorCheckedAt: 1, authorCheckTotal: 9, authorCheckSince: NOW - 1000,
    authorNewCount: 0, authorCheckComplete: true });
  api.recompute(NOW);
  api.makeHandlers(env.doc, env.win).onAction('markall', { getAttribute: () => null });
  assert.strictEqual(api.state.organizer.threads['1'].lastSeenTotal, 0, 'an unchecked thread must keep its unseen author posts');
  assert.strictEqual(api.state.organizer.threads['2'].lastSeenTotal, 9);
});
```

  (`onAction(act, el)` is the click handler, defined just above `onChange` (~l.3360). The assertion pair is what matters: thread 1 is unchecked and stays unmarked, thread 2 is known-empty and is marked.)

- [ ] **Step 3: Run them and confirm they fail** (`node --test tests/author.test.js tests/panel.test.js tests/handlers.test.js`).
- [ ] **Step 4: Implement.**
  - In `mergeThreads`, after `var ttl = ...` add `var authorOnly = !!(input && input.authorOnly);`. After `var u = unreadFor(api, entry);` add `var au = authorOnly ? authorStateFor(api, entry, u) : null;`. In the `rows.push` literal, replace `unread: u.unread,` with these lines:

```js
        unread: au ? ((au.state === 'author' || au.state === 'author-atleast') ? au.count : 0) : u.unread,
        authorState: au ? au.state : 'off',
        authorNew: au ? au.count : 0,
        authorLatestAt: au ? au.latestAt : 0,
        authorReason: au ? au.reason : '',
```

  - Replace `catchUpList` and add `catchUpUnchecked`:

```js
  function catchUpList(rows, lastCatchUpAt, mode) {
    var since = Math.max(0, toInt(lastCatchUpAt, 0));
    return rows.filter(function (r) {
      if (r.dismissed) return false;
      if (mode === 'author') {
        return (r.authorState === 'author' || r.authorState === 'author-atleast') && r.authorLatestAt > since;
      }
      if (r.unread > 0) return true;
      return r.lastActivity !== null && r.lastActivity > since;
    });
  }

  // Rows whose author activity is unknown. Kept out of the catch-up list, which
  // claims "the author posted", but listed beside it so nothing goes quiet.
  function catchUpUnchecked(rows) {
    return rows.filter(function (r) { return r.authorState === 'unchecked' && !r.archived; });
  }
```

  - In `recompute`, add `authorOnly: state.settings.authorOnly === true,` to the `mergeThreads` input.
  - In `buildPanelModel`:
    - Change the Unread-only line to `if (s.unreadOnly && r.unread === 0 && r.authorState !== 'unchecked') return false;`
    - Count `totalUnchecked` in the same loop as `totalUnread` (`if (rows[i].authorState === 'unchecked') totalUnchecked += 1;`) and add `unchecked: totalUnchecked` to `totals`.
    - Change the catch-up line to `catchUp: sortThreads(catchUpList(rows, state.organizer.lastCatchUpAt, s.authorOnly ? 'author' : 'any'), 'activity'),`
    - Add `catchUpUnchecked: s.authorOnly ? sortThreads(catchUpUnchecked(rows), 'activity') : [],`, `authorOnly: s.authorOnly === true,`, and `authorOnly: s.authorOnly,` inside `settings`.
  - In `matchThread` (~l.965), change the `is:unread` line to `if (v === 'unread') return row.unread > 0 || row.authorState === 'unchecked';`. For rows with the setting off, `authorState` is `'off'`, so nothing changes.
  - In the `markall` handler (~l.3397), skip unknown rows in author mode. Add as the first line inside the `for` loop: `if (state.settings.authorOnly === true && state.rows[i].authorState === 'unchecked') continue;`.
  - Add the toggle handler near `hide-torn-box` (~l.3530):

```js
        if (act === 'author-only') {
          state.settings.authorOnly = !!el.checked;
          persist('settings'); recompute(now); redraw(); return;
        }
```

    (`now` is in scope: `onChange` declares `var now = Date.now();` on its first line.)
- [ ] **Step 5: Run `npm test`.** Expected: PASS, and every pre-existing panel and merge test unchanged.
- [ ] **Step 6: Commit** with `git commit -am "feat: author state drives unread, catch up and Unread only (#4)"`

### Task 6: Render it: row badge, header, Catch up group, and Settings

**Files:**
- Modify: `renderRow` (~l.2616), `panelHtml` header (~l.2981), `renderCatchUpView` (~l.2714), `renderSettingsView` (~l.2891-2896)
- Test: `tests/panel.test.js`, `tests/handlers.test.js`

- [ ] **Step 1: Write the failing tests** (`tests/panel.test.js`)

```js
function authorEnv(entry, unread) {
  const env = loadUserscript({ location: forums() });
  env.exports.state.settings.authorOnly = true;
  env.exports.state.organizer.threads['1'] = env.exports.normaliseThreadEntry(Object.assign({ lastVisitedAt: NOW - 1000 }, entry));
  seed(env, [{ id: 1, unread: unread === undefined ? 37 : unread, total: 50 }]);
  return env;
}

test('author mode never prints Torn\'s any-poster count', () => {
  const env = authorEnv({});
  const html = env.exports.panelHtml(env.exports.buildPanelModel(NOW));
  assert.doesNotMatch(html, /37 new|>37</, 'the any-poster count must not appear as a badge');
  assert.match(html, /author: not checked/);
  assert.match(html, /1 not checked/);
});

test('author mode shows N new by author, and N+ for a lower bound', () => {
  const base = { authorCheckedAt: 1, authorCheckTotal: 50, authorCheckSince: NOW - 1000, authorNewCount: 2, authorLatestAt: NOW - 500 };
  let html = env2html(authorEnv(Object.assign({ authorCheckComplete: true }, base)));
  assert.match(html, /2 new by author/);
  html = env2html(authorEnv(Object.assign({ authorCheckComplete: false }, base)));
  assert.match(html, /2\+ new by author/);
  function env2html(env) { return env.exports.panelHtml(env.exports.buildPanelModel(NOW)); }
});

test('author mode says too many new when no post read is by the author', () => {
  const env = authorEnv({ authorCheckedAt: 1, authorCheckTotal: 50, authorCheckSince: NOW - 1000,
    authorNewCount: 0, authorCheckComplete: false, authorCheckReason: 'too-many' });
  const html = env.exports.panelHtml(env.exports.buildPanelModel(NOW));
  assert.match(html, /author: not checked \(too many new\)/);
  assert.match(html, /could not all be read/, 'the tooltip says why');
  assert.doesNotMatch(html, /37 new/);
});

test('catch up lists unchecked threads under their own heading', () => {
  const env = authorEnv({});
  env.exports.state.settings.view = 'catchup';
  const html = env.exports.renderCatchUpView(env.exports.buildPanelModel(NOW));
  assert.match(html, /Not yet checked for author posts \(1\)/);
  assert.doesNotMatch(html, /You are caught up/, 'an unchecked thread means we cannot claim that');
  assert.match(html, /No author updates in the threads checked/);
});

test('settings states the author-only option and the real request cost', () => {
  const env = loadUserscript({ location: forums() });
  const html = env.exports.renderSettingsView(env.exports.buildPanelModel(NOW));
  assert.match(html, /Only flag new posts by the thread author/);
  assert.match(html, /data-act="author-only"/);
  assert.match(html, /at most 13 requests/);
  assert.match(html, /edits are not detected/i, 'the limit is shown before the setting is turned on');
  // The figure must be computed from the user's budget, not hard-coded. 13
  // alone would also pass with a constant string, so use a different budget.
  env.exports.state.settings.enrichBudget = 4;
  assert.match(env.exports.renderSettingsView(env.exports.buildPanelModel(NOW)), /at most 7 requests a refresh/);
});
```

  In `tests/handlers.test.js`, model the test on the existing `hide-torn-box` reload test (~l.219-238):

```js
test('the author-only toggle saves, survives a reload, and turning it off restores the count', () => {
  const env = loadUserscript({ location: forums(), now: NOW });
  const api = env.exports;
  api.state.feed.subscribed = [api.normaliseSubscribedRow({
    id: 5, forum_id: 61, title: 'T', author: { id: 1, username: 'a', karma: 0 }, posts: { new: 2, total: 7 },
  })];
  api.recompute(NOW);
  const handlers = api.makeHandlers(env.doc, env.win);
  const box = (checked) => ({ getAttribute: () => null, checked, value: checked ? 'on' : '' });

  handlers.onChange('author-only', box(true));
  assert.strictEqual(JSON.parse(env.gmStore.get('tfcc:settings')).authorOnly, true);
  assert.strictEqual(api.state.rows[0].authorState, 'unchecked', 'the rows are recomputed, not only redrawn');
  assert.strictEqual(api.state.rows[0].unread, 0);

  const again = loadUserscript({ location: forums(), now: NOW,
    gmStore: [['tfcc:settings', env.gmStore.get('tfcc:settings')]] });
  assert.strictEqual(again.exports.state.settings.authorOnly, true);

  handlers.onChange('author-only', box(false));
  assert.strictEqual(api.state.rows[0].unread, 2, 'off means Torn\'s count again');
});
```

  (`forums()` and `NOW` are defined at the top of `tests/handlers.test.js`.)
- [ ] **Step 2: Run them and confirm they fail.**
- [ ] **Step 3: Implement.**
  - `renderRow`: replace the `if (row.unread > 0) {...}` block with:

```js
    var amode = row.authorState || 'off';
    if (amode === 'author' || amode === 'author-atleast') {
      out.push('<span class="tfcc-unread">' + formatCount(row.authorNew) + (amode === 'author-atleast' ? '+' : '')
        + ' new by author</span>');
    } else if (amode === 'unchecked') {
      out.push('<span class="tfcc-note tfcc-unchecked" title="'
        + escapeHtml(AUTHOR_REASON_TEXT[row.authorReason] || AUTHOR_REASON_TEXT.never)
        + '">author: not checked' + (row.authorReason === 'too-many' ? ' (too many new)' : '') + '</span>');
    } else if (amode === 'off' && row.unread > 0) {
      out.push('<span class="tfcc-unread">' + formatCount(row.unread) + ' new</span>');
    }
```

  - `panelHtml` header: make the badge text `formatCount(model.totals.unread) + (model.authorOnly ? ' new by author' : ' new')`, then add `if (model.authorOnly && model.totals.unchecked > 0) out.push('<span class="tfcc-note">' + model.totals.unchecked + ' not checked</span>');`
  - `renderCatchUpView`: build `var unchecked = '';` from `model.catchUpUnchecked` before the empty-state check, as a section with heading `'Not yet checked for author posts (' + n + ')'` whose rows are `renderRow(...)`. Append it before **both** `return out.join('')` statements, so it shows even when the author list is empty. When `model.authorOnly` is on and `model.catchUp` is empty, the empty-state text is `'No author updates in the threads checked.'` if the unchecked list is not empty, and `'Nothing new. You are caught up.'` otherwise. The old text claims more than we know while any thread is unchecked.
  - `renderSettingsView`, in the Refreshing section: replace the cost note (l.2894-2896) with the copy below, and add the checkbox.

```js
    out.push('<div class="tfcc-kv"><label for="tfcc-author">Only flag new posts by the thread author</label>'
      + '<input id="tfcc-author" type="checkbox" data-act="author-only"'
      + (model.settings.authorOnly ? ' checked' : '') + '></div>');
    out.push('<p class="tfcc-note">A refresh makes two requests, plus one a day for forum names. Each activity '
      + 'lookup adds one more, and only runs for a thread that has unread posts and no recent check: '
      + 'at most ' + (3 + model.settings.enrichBudget) + ' requests a refresh with your setting, at most 13 '
      + 'requests by default. The script keeps itself under 40 requests a minute regardless.</p>');
    out.push('<p class="tfcc-note">Author-only mode reads a thread\'s posts since you last looked, 20 at '
      + 'a time, newest first, instead of its last-post time. Each page is one lookup from the same '
      + 'allowance, so the total cost is the same; a thread gets at most ' + AUTHOR_MAX_PAGES + ' pages, '
      + 'and only once every other thread has had its first. With more new posts than that, a count '
      + 'shows as a minimum (N+), or as "not checked (too many new)" when none of the posts read is by '
      + 'the author. Threads not checked yet show "not checked". Posts from before you started using this script are not flagged, and '
      + 'edits are not detected.</p>');
```

  The second note is always shown, not only when the setting is on, so the user reads the limits before turning it on. The settings test above renders with the setting off and relies on that.
- [ ] **Step 4: Run `npm test`.** Expected: PASS. `.tfcc-unchecked` reuses the `.tfcc-note` colours, so no new colour is introduced. `tests/contrast-audit.mjs` needs the gstack browse binary, which this repo does not use (CLAUDE.md "Off"). If it is not available it exits with a message: record that in the PR, and leave the contrast check to the QA checklist.
- [ ] **Step 5: Commit** with `git commit -am "feat: author-only badges, catch-up group and settings copy (#4)"`

### Task 7: The runtime lookup: `checkAuthorPosts` and target selection in `refreshAll`

**Files:**
- Modify: `refreshAll` target block (~l.1966-1970). Add `checkAuthorPosts` right after `enrichThreads` (~l.2023).
- Modify: `tests/refresh.test.js`. Extend `router` in two ways: record full URLs (`seenUrls.push(url.replace('https://api.torn.com/v2/', ''))`), and let a table entry be a function of the URL, so one path can answer page by page (`const entry = table[path]; const body = typeof entry === 'function' ? entry(url) : entry;`). Existing tests pass plain objects and are unaffected.

**Interfaces:**
- Consumes: `authorSinceFor`, `authorPageStep`, `summariseAuthorPosts`, `AUTHOR_MAX_PAGES`, `tornApiGet(path, params, opts)`, `state.rows[i].authorReason`
- Produces: `checkAuthorPosts(ids: number[], now, opts, budget: number) -> Promise<{ ok, checked, requests, stoppedEarly? }>`. `requests` never exceeds `budget`.

**The budget arithmetic this task must hold.** `budget` is the lookup budget (`enrichBudget`, default 10, max 25), and it now counts posts *requests*. Targets are `.slice(0, budget)`, so every target can always get its first page. A further page for target *i* is fetched only if `requests + (targets not yet started) < budget`, and only while that thread has had fewer than `AUTHOR_MAX_PAGES` (3) pages. So: posts requests <= budget; a default refresh <= 2 + 1 + 10 = 13; at the maximum budget <= 3 + 25 = 28 < 40 per minute; with 10 or more targets, exactly one request per thread (no further pages at all); with fewer, the spare budget deepens the walks in target order.

- [ ] **Step 1: Write the failing tests** (`tests/refresh.test.js`, reusing `boot`, `settle`, `subscribedThreadsPayload` and `forumFeedPayload`, and serving the real fixtures from #14 and #15 as the `forum/{id}/posts` responses)

```js
const fs = require('node:fs');
const path = require('node:path');
const fixture = (name) => JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', name + '.json'), 'utf8'));

const MARKER = NOW - 3600000;
// from is inclusive (findings note, finding 9), so the request asks for the
// first whole second after the marker.
const MARKER_FROM = Math.floor(MARKER / 1000) + 1;
const PAGE0 = fixture('forum-posts-large-from');     // thread 16561608, newest 20
const PAGE1 = fixture('forum-posts-large-from-prev'); // its prev page (finding 15)
const OLDEST0 = PAGE0.posts[PAGE0.posts.length - 1].created_time;
const OLDEST1 = PAGE1.posts[PAGE1.posts.length - 1].created_time;
const toOf = (url) => { const m = /[?&]to=(\d+)/.exec(url); return m ? Number(m[1]) : 0; };

// A real-shaped page older than the fixtures reach: 20 posts cloned from a
// real one, newest first, starting with the boundary post at `to` (to is
// inclusive), by a player who is nobody's author here. `prev` is set, so the
// walk would go on for ever without the cap.
function olderPage(to, boundary) {
  const shape = PAGE1.posts[0];
  const posts = [boundary];
  for (let k = 1; k < 20; k += 1) {
    posts.push(Object.assign({}, shape, { id: 90000000 + to - k, created_time: to - k,
      author: Object.assign({}, shape.author, { id: 1099 }) }));
  }
  return { posts, _metadata: { links: { prev: 'https://api.torn.com/v2/forum/x/posts?from=1&to=' + (to - 19), next: null } } };
}

// Thread 16561608 as Torn served it: page 0, then its prev page, then (no
// fixture goes further) real-shaped older pages.
function largeChain() {
  return (url) => {
    const to = toOf(url);
    if (!to) return PAGE0;
    if (to === OLDEST0) return PAGE1;
    const all = PAGE0.posts.concat(PAGE1.posts);
    const boundary = all.find((p) => p.created_time === to)
      || Object.assign({}, PAGE1.posts[0], { id: 90000000 + to, created_time: to, author: Object.assign({}, PAGE1.posts[0].author, { id: 1099 }) });
    return olderPage(to, boundary);
  };
}

function authorBoot(table, ids, entryExtra, settingsExtra) {
  const threads = {};
  ids.forEach((id) => { threads[id] = Object.assign({ lastVisitedAt: MARKER }, entryExtra || {}); });
  return boot(table, { gmStore: [['tfcc:key', KEY],
    ['tfcc:settings', JSON.stringify(Object.assign({ v: 1, authorOnly: true }, settingsExtra || {}))],
    ['tfcc:organizer', JSON.stringify({ v: 1, folders: [], lastCatchUpAt: 0, threads })]] });
}
const postsCalls = (env, id) => env.router.seenUrls.filter((u) => u.indexOf('forum/' + id + '/posts') === 0);

test('author mode walks back with to, built from its own parameters, up to the page cap', async () => {
  const small = fixture('forum-thread-posts-from-small');   // thread 16589908: one reply, by 1001
  const smallAuthor = fixture('forum-thread').thread.author; // 1000
  const largeAuthor = fixture('forum-posts-large-offset0').posts[0].author; // 1002
  const table = {
    'user/forumsubscribedthreads': subscribedThreadsPayload([
      // total counts every post. forum-thread.json says posts: 1 (replies only), so total is 2.
      { id: 16589908, new: 1, total: 2, author: smallAuthor },
      { id: 16561608, new: 90, total: 6207, author: largeAuthor },
      // The same real pages, read as if player 1020 were the author.
      { id: 3, new: 90, total: 6207, author: { id: 1020, username: 'player020', karma: 0 } }]),
    'user/forumfeed': forumFeedPayload([]),
    'forum/categories': { categories: [] },
    'forum/16589908/posts': small,
    'forum/16561608/posts': largeChain(),
    'forum/3/posts': largeChain(),
  };
  const env = authorBoot(table, [16589908, 16561608, 3]);
  await settle(env);

  assert.strictEqual(env.router.seen.filter((u) => /\/thread$/.test(u)).length, 0, 'author mode does not also read the thread');
  assert.strictEqual(postsCalls(env, 16589908).length, 1, 'a short first page ends the walk');
  const walk = postsCalls(env, 16561608);
  assert.strictEqual(walk.length, env.exports.AUTHOR_MAX_PAGES, 'the walk stops at the page cap');
  assert.deepStrictEqual(walk.map(toOf), [0, OLDEST0, OLDEST1], 'each to is the oldest created_time already read');
  for (const u of env.router.seenUrls.filter((x) => /\/posts\?/.test(x))) {
    assert.match(u, new RegExp('[?&]from=' + MARKER_FROM + '(&|$)'), 'from is the marker + 1: ' + u);
    assert.doesNotMatch(u, /[?&](offset|limit|sort|stripTags)=/,
      'built from from and to only, never from the prev URL Torn sent: ' + u);
    assert.strictEqual(u.split(/[?&]key=/).length, 2, 'exactly the one key= tornApiGet adds, none copied from a link');
  }

  const row = (id) => env.exports.state.rows.find((r) => r.id === String(id));
  assert.deepStrictEqual([row(16589908).authorState, row(16589908).unread], ['none', 0], 'only a non-author reply: no badge');
  assert.deepStrictEqual([row(16561608).authorState, row(16561608).authorReason, row(16561608).unread],
    ['unchecked', 'too-many', 0], 'cut off by the cap with no author post read: not a known zero');
  const read = PAGE0.posts.concat(PAGE1.posts);
  const by1020 = new Set(read.filter((p) => p.author.id === 1020).map((p) => p.id)).size;
  assert.deepStrictEqual([row(3).authorState, row(3).authorNew], ['author-atleast', by1020], 'cut off with author posts: N+');

  const e = env.exports.state.organizer.threads['16561608'];
  assert.strictEqual(e.authorCheckComplete, false);
  assert.strictEqual(e.authorCheckTotal, 6207, 'the check total is subscribed posts.total, never the thread\'s reply count');
  assert.strictEqual(e.lastPostTimeCached, PAGE0.posts[0].created_time * 1000, 'newest first: page 0 gives the last post time');
  assert.ok(env.router.seen.length <= 13);
});

test('a walk that ends inside the cap is exact, and the boundary post counts once', async () => {
  // Page 2 is the boundary post alone with no earlier page: the walk reached
  // the marker on its third request.
  const last = PAGE1.posts[PAGE1.posts.length - 1];
  const chain = (url) => {
    const to = toOf(url);
    if (!to) return PAGE0;
    if (to === OLDEST0) return PAGE1;
    return { posts: [last], _metadata: { links: { prev: null, next: null } } };
  };
  const boundaryAuthor = PAGE0.posts[PAGE0.posts.length - 1].author; // wrote the post both real pages hold
  const table = {
    'user/forumsubscribedthreads': subscribedThreadsPayload([{ id: 16561608, new: 39, total: 6207, author: boundaryAuthor }]),
    'user/forumfeed': forumFeedPayload([]), 'forum/categories': { categories: [] },
    'forum/16561608/posts': chain,
  };
  const env = authorBoot(table, [16561608]);
  await settle(env);
  const all = PAGE0.posts.concat(PAGE1.posts);
  const distinct = new Set(all.filter((p) => p.author.id === boundaryAuthor.id).map((p) => p.id)).size;
  const r = env.exports.state.rows[0];
  assert.deepStrictEqual([r.authorState, r.authorNew], ['author', distinct], 'exact, and the shared post is not counted twice');
  assert.strictEqual(postsCalls(env, 16561608).length, 3);
});

test('breadth before depth: with as many targets as budget, no thread gets a second page', async () => {
  const subs = [];
  const table = { 'user/forumfeed': forumFeedPayload([]), 'forum/categories': { categories: [] } };
  for (let i = 1; i <= 12; i += 1) {
    subs.push({ id: i, new: 90, total: 6207, author: { id: 1002, username: 'player002', karma: 0 } });
    table['forum/' + i + '/posts'] = largeChain();
  }
  table['user/forumsubscribedthreads'] = subscribedThreadsPayload(subs);
  const env = authorBoot(table, subs.map((s) => s.id));
  await settle(env);
  const posts = env.router.seenUrls.filter((u) => /\/posts\?/.test(u));
  assert.strictEqual(posts.length, env.exports.DEFAULT_ENRICH_BUDGET);
  assert.strictEqual(posts.filter((u) => toOf(u)).length, 0, 'every request is a first page');
  assert.strictEqual(new Set(posts.map((u) => u.split('?')[0])).size, env.exports.DEFAULT_ENRICH_BUDGET, 'ten threads, one each');
  assert.ok(env.router.seen.length <= 13, 'the default refresh promise is 13 requests');
});

test('further pages come out of the same budget and never exceed it', async () => {
  // Budget 4, two targets: the first may take 3 pages only because one
  // request stays reserved for the second.
  const table = {
    'user/forumsubscribedthreads': subscribedThreadsPayload([
      { id: 1, new: 90, total: 6207, author: { id: 1002, username: 'player002', karma: 0 } },
      { id: 2, new: 90, total: 6207, author: { id: 1002, username: 'player002', karma: 0 } }]),
    'user/forumfeed': forumFeedPayload([]), 'forum/categories': { categories: [] },
    'forum/1/posts': largeChain(), 'forum/2/posts': largeChain(),
  };
  const env = authorBoot(table, [1, 2], {}, { enrichBudget: 4 });
  await settle(env);
  const counts = [postsCalls(env, 1).length, postsCalls(env, 2).length].sort();
  assert.deepStrictEqual(counts, [1, 3]);
  assert.ok(env.router.seen.length <= 3 + 4);
});

test('the lookup budget still bounds threads, and the rest stay visibly unchecked', async () => {
  const small = fixture('forum-thread-posts-from-small');
  const subs = [];
  const table = { 'user/forumfeed': forumFeedPayload([]), 'forum/categories': { categories: [] } };
  for (let i = 1; i <= 15; i += 1) {
    subs.push({ id: i, new: 2, total: 10 });
    table['forum/' + i + '/posts'] = small; // a short, complete page by someone else
  }
  table['user/forumsubscribedthreads'] = subscribedThreadsPayload(subs);
  const env = authorBoot(table, [1, 2]);
  await settle(env);
  assert.strictEqual(env.router.seen.filter((u) => /\/posts$/.test(u)).length, env.exports.DEFAULT_ENRICH_BUDGET);
  assert.ok(env.router.seen.length <= 13, 'the default refresh promise is 13 requests');
  const unchecked = env.exports.state.rows.filter((r) => r.authorState === 'unchecked');
  assert.strictEqual(unchecked.length, 5);
});

test('a failed further page keeps what was read, as a lower bound', async () => {
  const chain = (url) => (toOf(url) ? { error: { code: 6, error: 'Unknown' } } : PAGE0);
  const table = {
    'user/forumsubscribedthreads': subscribedThreadsPayload([
      { id: 16561608, new: 90, total: 6207, author: { id: 1020, username: 'player020', karma: 0 } }]),
    'user/forumfeed': forumFeedPayload([]), 'forum/categories': { categories: [] },
    'forum/16561608/posts': chain,
  };
  const env = authorBoot(table, [16561608]);
  await settle(env);
  const r = env.exports.state.rows[0];
  assert.deepStrictEqual([r.authorState, r.authorNew], ['author-atleast', 4], 'page 0 holds 4 posts by 1020; never exact');
  assert.strictEqual(env.exports.state.lastError, null);
});

test('a too-many thread is not looked up again while nothing has changed', async () => {
  const table = {
    'user/forumsubscribedthreads': subscribedThreadsPayload([
      { id: 16561608, new: 90, total: 6207, author: fixture('forum-posts-large-offset0').posts[0].author }]),
    'user/forumfeed': forumFeedPayload([]), 'forum/categories': { categories: [] },
    'forum/16561608/posts': largeChain(),
  };
  const env = authorBoot(table, [16561608], {
    authorCheckedAt: NOW - 60000, authorCheckTotal: 6207, authorCheckSince: MARKER,
    authorNewCount: 0, authorCheckComplete: false, authorCheckReason: 'too-many' });
  await settle(env);
  assert.strictEqual(env.router.seen.filter((u) => /\/posts$/.test(u)).length, 0, 'the same walk would read the same posts');
  assert.strictEqual(env.exports.state.rows[0].authorReason, 'too-many');
});

test('a failed first page leaves the row unchecked and the refresh ok', async () => {
  const table = {
    'user/forumsubscribedthreads': subscribedThreadsPayload([{ id: 1, new: 2, total: 10 }]),
    'user/forumfeed': forumFeedPayload([]), 'forum/categories': { categories: [] },
  }; // forum/1/posts falls through to the router's error response
  const env = authorBoot(table, [1]);
  await settle(env);
  assert.strictEqual(env.exports.state.rows.find((r) => r.id === '1').authorState, 'unchecked');
  assert.strictEqual(env.exports.state.lastError, null);
});
```

  The `firstSeenAt` of threads in the subscribed list but not in the seeded organizer is set by `applyAutoAssign` at `NOW`, so those rows still have a marker. `NOW` is before every fixture post, so every page read counts in full. Threads `1`-`12` and `3` serve thread 16561608's pages: the engine never reads `thread_id`, so this only reuses real posts under a different author. `olderPage` exists because no fixture goes past the second page; it clones a real post, so its shape is Torn's.
- [ ] **Step 2: Run them and confirm they fail** (`node --test tests/refresh.test.js`).
- [ ] **Step 3: Implement.** Replace the target block in `refreshAll`. Keep the literal `.slice(0, budget);`, because an existing mutation looks for it:

```js
        var authorMode = state.settings.authorOnly === true;
        var targets = state.rows
          .filter(function (r) {
            if (!r.subscribed) return false;
            // Author mode selects on the author state, never on unread: an
            // unchecked row has unread 0 by design, so selecting on it would
            // check nothing, ever.
            if (authorMode) return r.authorState === 'unchecked' && (r.authorReason === 'never' || r.authorReason === 'stale');
            return r.unread > 0 && r.activitySource !== 'enriched';
          })
          .slice(0, budget);
        var ids = targets.map(function (r) { return r.numericId; });
        return authorMode ? checkAuthorPosts(ids, now, options, budget) : enrichThreads(ids, now, options);
```

  Then add:

```js
  // Author-only lookups: forum/{id}/posts in place of forum/{id}/thread. With
  // from set, Torn returns the newest 20 posts at or after it, newest first,
  // and ignores offset; to (also inclusive) pages further back, so each
  // further page repeats the previous page's oldest post, which
  // summariseAuthorPosts counts once. from is marker + 1: a post at the marker
  // was already seen. Every page is one unit of the same lookup budget, a
  // thread gets at most AUTHOR_MAX_PAGES, and a further page is fetched only
  // while one request stays reserved for each thread not yet started, so the
  // refresh total never moves. URLs are built here, through tornApiGet, from
  // from and to; the prev URL Torn returns is read only for null, never
  // fetched, because it carries Torn's own parameters. The check total is the
  // subscribed posts.total; a thread's own "posts" counts replies and is one
  // less, so it must never be stored here (if one is ever needed,
  // threadPostsTotal from #2 converts it; never add 1 again after that). The
  // entry is re-read after the walk, because a handler may have replaced the
  // organizer while the requests were in flight.
  function checkAuthorPosts(ids, now, opts, budget) {
    var list = (ids || []).slice(0, MAX_ENRICH_BUDGET);
    if (!list.length) return Promise.resolve({ ok: true, checked: 0, requests: 0 });
    var cap = Math.min(MAX_ENRICH_BUDGET, Math.max(list.length, toInt(budget, list.length)));
    var spent = 0;
    var done = 0;
    var generation = state.generation;

    function step(i) {
      if (i >= list.length) return Promise.resolve({ ok: true, checked: done, requests: spent });
      var id = String(list[i]);
      var before = entryOf(state.organizer, id);
      var since = authorSinceFor(before);
      var row = state.rows.filter(function (r) { return r.id === id; })[0] || null;
      var authorId = (row && row.authorId) || before.authorId;
      var total = row ? row.postsTotal : before.postsTotal;
      var from = Math.floor(since / 1000) + 1;
      var posts = [];
      var pages = 0;

      function page(to) {
        var params = { from: from };
        if (to > 0) params.to = to;
        spent += 1;
        pages += 1;
        return tornApiGet('forum/' + id + '/posts', params, opts).then(function (res) {
          if (generation !== state.generation) return { stale: true };
          if (!(res.ok && isPlainObject(res.data) && Array.isArray(res.data.posts))) {
            return { failed: true, throttled: res.reason === 'throttled' };
          }
          var meta = isPlainObject(res.data._metadata) && isPlainObject(res.data._metadata.links) ? res.data._metadata.links : {};
          var seenIds = posts.map(function (p) { return isPlainObject(p) ? p.id : null; });
          var walk = authorPageStep(res.data.posts, seenIds, POSTS_PER_PAGE, meta.prev);
          posts = posts.concat(res.data.posts);
          if (walk.done) return { complete: walk.complete };
          // Breadth before depth: one request stays reserved for every
          // thread in this batch that has not had its first page yet.
          var reserved = list.length - (i + 1);
          if (pages >= AUTHOR_MAX_PAGES || spent + reserved >= cap) return { complete: false };
          return page(walk.to);
        });
      }

      return page(0).then(function (out) {
        if (out.stale) return { ok: true, checked: done, requests: spent, stale: true };
        if (out.failed && pages === 1) {
          // Nothing read: write nothing, so the row stays never/stale.
          if (out.throttled) return { ok: true, checked: done, requests: spent, stoppedEarly: true };
          return step(i + 1);
        }
        // A failed further page keeps what was read, as a walk cut short.
        var sum = summariseAuthorPosts(posts, authorId, since, out.complete === true);
        var e = entryOf(state.organizer, id);
        e.authorCheckedAt = now;
        e.authorCheckTotal = total;
        e.authorCheckSince = since;
        e.authorNewCount = sum.count;
        e.authorLatestAt = sum.latestAt;
        e.authorCheckComplete = sum.complete;
        e.authorCheckReason = !sum.complete && sum.count === 0 ? 'too-many' : '';
        if (sum.newestAt > 0) {
          // Newest first with no upper bound: the newest post read is the
          // thread's last post, however the walk ended.
          e.lastPostTimeCached = Math.max(e.lastPostTimeCached, sum.newestAt);
          e.enrichedAt = now;
        }
        done += 1;
        if (out.throttled) return { ok: true, checked: done, requests: spent, stoppedEarly: true };
        return step(i + 1);
      });
    }

    return step(0);
  }
```

  `checkAuthorPosts` lives in the runtime section, not the engine, so purity does not apply to it. Confirm that `entryOf` is defined before the runtime section (~l.1161). It is. `tornApiGet` builds the URL through `buildApiUrl`, which drops empty params, so the first page carries no `to`.
- [ ] **Step 4: Run `npm test` and `npm run test:syntax`.** Expected: PASS, including `tests/read-only.test.js` (GET only, one host).
- [ ] **Step 5: Commit** with `git commit -am "feat: author-only lookups walk posts pages backwards within the same budget (#4)"`

### Task 8: Debug report

**Files:**
- Modify: `gatherDebugContext` (~l.3153 `counts`), `buildDebugReport` (~l.3172)
- Test: `tests/debug-report.test.js`

- [ ] **Step 1: Write the failing test** (append to `tests/debug-report.test.js`, reusing its `loaded()` helper, which seeds thread 1 with author `SecretPlanner`, `posts.new` 2 and `posts.total` 9):

```js
test('the report shows author-check health without leaking who the author is', () => {
  const env = loaded();
  const api = env.exports;
  api.state.settings.authorOnly = true;
  Object.assign(api.state.organizer.threads['1'], {
    lastVisitedAt: NOW - 1000, authorCheckedAt: 1, authorCheckTotal: 9, authorCheckSince: NOW - 1000,
    authorNewCount: 0, authorCheckComplete: false, authorCheckReason: 'too-many',
  });
  api.recompute(NOW);
  const report = api.buildDebugReport();
  assert.match(report, /author only: on/);
  assert.match(report, /author unchecked: 1 \(too many new: 1\)/);
  assert.strictEqual(report.indexOf('SecretPlanner'), -1);
  assert.strictEqual(report.indexOf('abcdefghij123456'), -1, 'the key must never appear');
});
```

- [ ] **Step 2: Run it and confirm it fails.**
- [ ] **Step 3: Implement.** In `counts`, add `authorUnchecked` and `authorTooMany`, counted from `state.rows` (`authorState === 'unchecked'`, `authorReason === 'too-many'`), and add `authorOnly: state.settings.authorOnly === true` to the context. In the lines, add `'author only: ' + (c.authorOnly ? 'on' : 'off')` and `'author unchecked: ' + c.counts.authorUnchecked + ' ((too many new): ' + c.counts.authorTooMany + ')'`. The earlier `filter-ignored` probe line is gone: the live capture answered whether Torn honours `from` (it does, inclusively), so there is nothing left for it to detect. What remains answers the support question a pasted report most often raises, "why does it say not checked?", by splitting the unchecked rows Torn cannot answer (too many new) from the ones simply not reached yet.
- [ ] **Step 4: Run `npm test`.** Expected: PASS.
- [ ] **Step 5: Commit** with `git commit -am "feat: debug report shows author-check health (#4)"`

### Task 9: Mutation-check entries

**Files:**
- Modify: `tests/mutation-check.mjs` `MUTATIONS`

- [ ] **Step 1: Add the entries.** The eleven after the first guard the live-API facts and the walk:
  - the marker exclusion (inclusive `from`): caught by `a post exactly at the marker was already seen and is not counted` (real `forum-thread-posts-from-small.json`), and on the request side by the `from=` assertion in Task 7;
  - the boundary post (inclusive `to`): caught by `the boundary post repeated by to is counted once (real pages)` and the real-shaped pair;
  - walk completeness (every page complete; a stuck walk complete; a failed further page complete): caught by the `page step` tests, `a walk cut short with no author post is not a known zero`, and `a failed further page keeps what was read, as a lower bound`;
  - the state-level truncation rule: caught by `a walk cut short with no author post is unchecked too-many, not none`;
  - the page cap, the breadth-before-depth reservation and the `to` parameter: caught by Task 7's cap, `further pages come out of the same budget` and walk-order tests;
  - the subscribed-total source of the check total.

  The old one-page entries are gone: `complete: list.length < size` no longer exists (completeness comes from `authorPageStep`), and the `from` anchor moved to `var from = ...`. If one of these reports "replacement did not apply", the anchor drifted from the code in Tasks 3 and 7: fix the string, not the test. The last three guard the upgrade fix: the first reverts `loadKey` to the raw JSON comparison and expects `a settings blob saved by 0.1.0 is not reported as damaged` to fail; the second stops the organizer using the per-entry check and expects `an organizer saved by 0.1.0 is not reported as damaged` to fail; the third makes the per-entry check forgive anything and expects `a genuinely corrupt thread entry is still reported as damage` to fail.

```js
  {
    name: 'author mode falls back to Torn\'s any-poster count',
    suite: 'tests/author.test.js',
    apply: (s) => s.replace(
      "unread: au ? ((au.state === 'author' || au.state === 'author-atleast') ? au.count : 0) : u.unread,",
      'unread: u.unread,',
    ),
  },
  {
    name: 'a post exactly at the read marker is counted as new',
    suite: 'tests/author.test.js',
    apply: (s) => s.replace('      if (at <= since) continue;', '      if (at < since) continue;'),
  },
  {
    name: 'the boundary post that inclusive to repeats is counted twice',
    suite: 'tests/author.test.js',
    apply: (s) => s.replace('if (key && seen[key]) continue;', ''),
  },
  {
    name: 'every page ends the walk as complete, so a cut-short walk becomes a false none',
    suite: 'tests/author.test.js',
    apply: (s) => s.replace(
      'if (list.length < size || prevLink === null) return { done: true, complete: true, to: 0 };',
      'return { done: true, complete: true, to: 0 };',
    ),
  },
  {
    name: 'a walk that makes no progress is called complete',
    suite: 'tests/author.test.js',
    apply: (s) => s.replace(
      'if (added === 0 || oldest === 0) return { done: true, complete: false, to: 0 };',
      'if (added === 0 || oldest === 0) return { done: true, complete: true, to: 0 };',
    ),
  },
  {
    name: 'the page cap is ignored, so one thread walks until the budget runs out',
    suite: 'tests/refresh.test.js',
    apply: (s) => s.replace('if (pages >= AUTHOR_MAX_PAGES || spent + reserved >= cap)', 'if (spent + reserved >= cap)'),
  },
  {
    name: 'further pages take budget reserved for threads not yet started',
    suite: 'tests/refresh.test.js',
    apply: (s) => s.replace('if (pages >= AUTHOR_MAX_PAGES || spent + reserved >= cap)', 'if (pages >= AUTHOR_MAX_PAGES || spent >= cap)'),
  },
  {
    name: 'a further page is requested without to, so the walk re-reads page 0',
    suite: 'tests/refresh.test.js',
    apply: (s) => s.replace('if (to > 0) params.to = to;', ''),
  },
  {
    name: 'a failed further page is recorded as a complete walk',
    suite: 'tests/refresh.test.js',
    apply: (s) => s.replace(
      'var sum = summariseAuthorPosts(posts, authorId, since, out.complete === true);',
      'var sum = summariseAuthorPosts(posts, authorId, since, out.complete !== false);',
    ),
  },
  {
    name: 'a walk cut short with no author post is read as a known zero',
    suite: 'tests/author.test.js',
    apply: (s) => s.replace(
      "return e.authorCheckComplete ? { state: 'none', count: 0, latestAt: 0, reason: '' } : unchecked('too-many');",
      "return { state: 'none', count: 0, latestAt: 0, reason: '' };",
    ),
  },
  {
    name: 'the request sends the marker itself, which inclusive from returns as new',
    suite: 'tests/refresh.test.js',
    apply: (s) => s.replace('var from = Math.floor(since / 1000) + 1;', 'var from = Math.floor(since / 1000);'),
  },
  {
    name: 'the check total is stored as a thread reply count (posts.total - 1)',
    suite: 'tests/refresh.test.js',
    apply: (s) => s.replace('e.authorCheckTotal = total;', 'e.authorCheckTotal = total - 1;'),
  },
  {
    name: 'an author check is never invalidated by new posts',
    suite: 'tests/author.test.js',
    apply: (s) => s.replace('if (e.authorCheckTotal === u.postsTotal) {', 'if (true) {'),
  },
  {
    name: 'author-mode lookups select on the any-poster unread count',
    suite: 'tests/refresh.test.js',
    apply: (s) => s.replace(
      "if (authorMode) return r.authorState === 'unchecked' && (r.authorReason === 'never' || r.authorReason === 'stale');",
      'if (authorMode) return r.unread > 0;',
    ),
  },
  {
    name: 'Unread only hides unchecked rows',
    suite: 'tests/panel.test.js',
    apply: (s) => s.replace(" && r.authorState !== 'unchecked') return false;", ') return false;'),
  },
  {
    name: 'an upgrade from 0.1.0 is reported as damaged (settings)',
    suite: 'tests/storage.test.js',
    apply: (s) => s.replace(
      'var recovered = (recoveredCheck || isRecoveredValue)(raw, value);',
      'var recovered = raw !== null && JSON.stringify(raw) !== JSON.stringify(value);',
    ),
  },
  {
    name: 'the organizer goes back to the strict comparison, so new per-thread fields read as damage',
    suite: 'tests/storage.test.js',
    apply: (s) => s.replace(
      'loadKey(STORAGE_KEYS.organizer, normaliseOrganizer, now, isRecoveredOrganizer)',
      'loadKey(STORAGE_KEYS.organizer, normaliseOrganizer, now)',
    ),
  },
  {
    name: 'the per-entry check forgives a corrupt thread entry',
    suite: 'tests/storage.test.js',
    apply: (s) => s.replace(
      'threads[id] = isPlainObject(r) && isPlainObject(v) ? Object.assign({}, v, r) : r;',
      'threads[id] = isPlainObject(v) ? v : r;',
    ),
  },
```

- [ ] **Step 2: Run it** with `node tests/mutation-check.mjs > "${TMPDIR:-/tmp}/tfcc-mutation.txt" 2>&1; echo exit=$?`, then read the file with the Read tool. **Do not pipe into `head`.** Expected: every mutation, old and new, reported as caught, and exit 0. If one of them reports "replacement did not apply", the anchor string drifted. Fix the string, not the test.
- [ ] **Step 3: Confirm the source is pristine** with `git diff --stat torn-forum-command-center.user.js`. Expected: only your intended changes. If anything else changed, the check died mid-run. Restore from `.mutation-backup` per the script header.
- [ ] **Step 4: Commit** with `git commit -am "test: mutation-check guards for author-only mode (#4)"`

### Task 10: Docs, version, code map

**Files:**
- Modify: `docs/architecture.md` (the endpoint table row for `forum/{id}/posts`: "Deep search, and author-only lookups (budgeted, replacing `thread`)". Add a short "Author-only mode" paragraph under "The unread model".)
- Modify: `docs/qa-checklist.md`. Add an "Author-only" section:
  - turn it on and confirm the counts read "by author";
  - follow a busy thread where only others post, and confirm no badge and nothing in Catch up;
  - have the author post (or find a thread where they did), and confirm "N new by author";
  - with the lookups set to 1, confirm the other threads show "author: not checked";
  - on a thread with 21 to about 55 posts since the last visit and Activity lookups above the number of unread threads, confirm an exact "N new by author" or no badge (the walk reached the marker);
  - on a thread with far more than 58 new posts, confirm the badge is "N+ new by author" or "author: not checked (too many new)", never a bare count or nothing; then open the thread on Torn and confirm the badge clears;
  - paste the debug report and note the request count of one refresh: it must not exceed 3 + Activity lookups;
  - open a thread, refresh at once, and confirm the last post you saw is not flagged as new (the inclusive `from` boundary).
- Modify: `CHANGELOG.md`. Under `## [Unreleased]`, add an `### Added` entry for the setting and a `### Fixed` entry: "Settings now states the real per-refresh request count (the daily forum-names call was missing)."
- Release (not part of this PR): #2, #3 and #4 share one convention, so they can merge in any order. Each feature PR only adds its `[Unreleased]` entry. One separate release commit on `main`, cut by the owner after `docs/qa-checklist.md`, sets `@version`, `SCRIPT_VERSION` and `package.json` `version` to the next minor after `main`'s (`0.2.0` if `main` is `0.1.0`), renames `[Unreleased]` to `[X.Y.0] - <date>` above a fresh empty `[Unreleased]`, and is tagged `vX.Y.0`. `tests/metadata.test.js` enforces the three-way match. If another feature PR already added an `### Added` list under `[Unreleased]`, append to it rather than adding a second heading.
- Regenerate: run `/code-map` (`daftplate:code-map`). The file grew, and new symbols must have anchors (`summariseAuthorPosts`, `authorSinceFor`, `authorStateFor`, `AUTHOR_REASON_TEXT`, `AUTHOR_CHECK_REASONS`, `catchUpUnchecked`, `checkAuthorPosts`).

- [ ] **Step 1: Make the doc edits above.**
- [ ] **Step 2: Run the full verification**

```
npm test
npm run test:syntax
node tests/mutation-check.mjs > "${TMPDIR:-/tmp}/tfcc-mutation.txt" 2>&1
```

  Read the mutation file with the Read tool. Expected: all pass, all mutations caught.
- [ ] **Step 3: Regenerate the code map and commit** with `git commit -am "docs: architecture, QA and changelog for author-only mode; refresh code map (#4)"`
- [ ] **Step 4: Release gate.** Do not tag until the `docs/qa-checklist.md` author-only section has been walked on a real signed-in account. Spec open questions 1 to 4 and 7 were answered by the 2026-10-08 captures (#14, #15). Question 6 (deleted posts in `posts.total`) is still open. At worst a deleted author post stays counted until the marker moves, so it does not block the release; record any such case seen during QA.

## Self-review notes

- Spec coverage. Each spec requirement maps to a task:
  - setting: Task 1
  - persisted fields and migration: Task 2
  - the marker rule (inclusive `from`, marker + 1), the backwards walk with `to` (boundary counted once, 3-page cap, breadth before depth, same budget), the truncation rule, and the +1 between `posts` and `posts.total`, all against the real fixtures: Task 3 (engine), Task 4 (state), Task 7 (request and stored total)
  - states, marker and reasons: Task 4
  - unread, Catch up, Unread only and header model: Task 5
  - badges, unchecked group, Settings cost copy and toggle round-trip: Task 6
  - data source, budget and failure paths: Task 7
  - debug visibility of unchecked and too-many rows: Task 8
  - `last_poster` is deliberately not used (spec, Decision): no task
  - upgrade false-damage: Task 1 (settings, via #8's `isRecoveredValue`), Task 2 (nested per-thread fields, via `isRecoveredOrganizer`)
  - mutation guards: Task 9
  - docs, version and code map: Task 10

  My posts (#2) is out of scope here. The engine takes `authorOnly` and `mode` as arguments so #2 can pass `false`/`'any'`.
- Issue "What closes this" maps to tests as follows:
  - non-author-only thread has no badge and is not in Catch up: Task 5 and Task 7;
  - author post flagged: Task 5 and Task 7;
  - setting round-trips and survives a reload: Task 1 and Task 6;
  - Settings text states the cost: Task 6.
