# Only flag author updates - Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a global setting, default off, that flags a subscribed thread as new only when its author has posted since the user last saw it. It shows an honest "not checked" state when author activity is unknown.

**Architecture:** In author-only mode the existing per-thread activity lookup calls `forum/{id}/posts?from=<marker>` instead of `forum/{id}/thread`, so the request cost does not change. The result is stored as seven additive per-thread fields. Three pure engine functions turn that into a per-row author state: `summariseAuthorPosts`, `authorSinceFor` and `authorStateFor`. `mergeThreads`, `catchUpList`, `buildPanelModel` and the renderers read that state.

**Tech Stack:** a single-file ES5-style userscript (`torn-forum-command-center.user.js`), Node `node:test` plus the `vm` harness in `tests/load-userscript.js`, and no runtime dependencies.

**Spec:** `docs/superpowers/specs/2026-10-08-author-only-updates-design.md`. Read it first. Where this plan and the spec disagree, the spec wins and this plan is amended.

## Global Constraints

- **Never read `torn-forum-command-center.user.js` whole.** Grep `docs/code-map.md` for the symbol, confirm the line with `grep -n "function <name>"`, then `Read` with offset/limit. The line numbers in this plan are from `884f614` and will drift.
- The source must be ASCII only (`tests/metadata.test.js`). Type straight quotes only, in strings and in comments alike.
- The engine section stays pure (`tests/purity.test.js`): no DOM, no network, no `GM_*`, no `Date.now()`. Time is passed in as `now`.
- A default refresh makes at most 13 requests (2 fixed + 1 daily categories + `DEFAULT_ENRICH_BUDGET` = 10), and the limiter allows 40 per rolling minute. Author-only mode must not change either number. The Settings copy must state the cost.
- The script is read-only: GET to `api.torn.com` only. No change to `@match`, `@grant` or `@connect`.
- The key never leaves the device. Every error detail goes through `scrubDetail`.
- ADR 0001: no data path reads Torn's DOM.
- Never show `tornUnread` (Torn's any-poster `posts.new`) under an author-only label.
- An unknown author state is shown as `author: not checked` and is never left blank.
- Setting off: every existing output stays byte-identical. The existing suites prove this. Do not edit an existing assertion to make it pass.
- `@version`, `SCRIPT_VERSION`, `package.json` `version`, the newest `CHANGELOG.md` heading, and the git tag move together in one separate release commit. This PR only adds an `[Unreleased]` entry (Task 10).
- `node tests/mutation-check.mjs > <file>` only. **Never pipe it into `head`** or anything else that closes the pipe early.

## Review Focus

1. **A thread with more than 20 new posts and no author post in the first 20.** The user would expect "not checked", not "nothing new". Pinned in Task 3 (`full-page`) and Task 6 (badge text).
2. **Torn ignoring `from` and returning the thread's oldest posts.** The user would expect "not checked", not "1 new by author" for the opening post. Pinned in Task 3 (`filter-ignored`).
3. **Lookup targets chosen from `row.unread`, which is 0 for an unchecked row in author mode,** so nothing would ever get checked. Pinned in Task 7, with a mutation in Task 9.
4. **Unread only plus author mode hiding unchecked rows,** so an unknown looks like known-empty. Pinned in Task 5, with a mutation in Task 9.
5. **Mark read after an author post, then a non-author reply.** The user would expect no badge, because the marker moved past the author post. Pinned in Task 4 (`stale` after marker change, then `none` after a check).

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
- Produces these entry fields: `authorCheckedAt` (ms), `authorCheckTotal` (int), `authorCheckSince` (ms), `authorNewCount` (int), `authorLatestAt` (ms), `authorCheckComplete` (bool), `authorCheckReason` (`''|'filter-ignored'|'full-page'`)

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
    authorLatestAt: 3, authorCheckComplete: true, authorCheckReason: 'full-page',
  });
  assert.strictEqual(e.authorNewCount, 2);
  assert.strictEqual(e.authorCheckComplete, true);
  assert.strictEqual(e.authorCheckReason, 'full-page');
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

Add this near the other frozen constants (~l.98): `var AUTHOR_CHECK_REASONS = Object.freeze(['', 'filter-ignored', 'full-page']);`. Do not bump `SCHEMA_VERSION`. The change is additive, and `normaliseOrganizer` would otherwise refuse every stored organizer.
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

### Task 3: `summariseAuthorPosts` (pure)

**Files:**
- Modify: the engine, next to `unreadFor` (~l.708, "merge, unread, sort")
- Modify: `tests/load-userscript.js` `EXPORT_NAMES`. Add `'summariseAuthorPosts', 'authorSinceFor', 'authorStateFor', 'catchUpUnchecked', 'checkAuthorPosts', 'AUTHOR_REASON_TEXT'` to the "engine: merge, unread, sort" line. The harness guards each name with `typeof`, so a name that does not exist yet is `undefined` and its test fails with "not a function". Add each name in the task that creates it.
- Create: `tests/author.test.js`

**Interfaces:**
- Produces: `summariseAuthorPosts(posts: any, authorId: number, sinceMs: number, perPage: number) -> { count, latestAt, newestAt, complete, filterIgnored }`

- [ ] **Step 1: Write the failing tests** (`tests/author.test.js`)

```js
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { loadUserscript } = require('./load-userscript');

const { exports: api } = loadUserscript();
const SINCE = 1700000000000;
const p = (id, authorId, secAfter) => ({ id, author: { id: authorId, username: 'u' + authorId }, created_time: SINCE / 1000 + secAfter, content: '' });

test('counts only the author\'s posts after the marker', () => {
  const r = api.summariseAuthorPosts([p(1, 5, 10), p(2, 9, 20), p(3, 5, 30)], 5, SINCE, 20);
  assert.strictEqual(r.count, 2);
  assert.strictEqual(r.latestAt, (SINCE / 1000 + 30) * 1000);
  assert.strictEqual(r.newestAt, (SINCE / 1000 + 30) * 1000);
  assert.strictEqual(r.complete, true);
  assert.strictEqual(r.filterIgnored, false);
});

test('only non-author posts count zero', () => {
  const r = api.summariseAuthorPosts([p(1, 9, 10), p(2, 8, 20)], 5, SINCE, 20);
  assert.strictEqual(r.count, 0);
  assert.strictEqual(r.complete, true);
});

test('a full page is reported incomplete', () => {
  const posts = [];
  for (let i = 0; i < 20; i += 1) posts.push(p(i, 9, i + 1));
  assert.strictEqual(api.summariseAuthorPosts(posts, 5, SINCE, 20).complete, false);
});

test('a post at or before the marker means the from filter was not honoured', () => {
  const r = api.summariseAuthorPosts([p(1, 5, -100), p(2, 5, 10)], 5, SINCE, 20);
  assert.strictEqual(r.filterIgnored, true, 'the opening post must not be counted as a new author post');
});

test('order does not matter and junk is tolerated', () => {
  const a = api.summariseAuthorPosts([p(3, 5, 30), null, 'x', p(1, 5, 10)], 5, SINCE, 20);
  assert.strictEqual(a.count, 2);
  assert.strictEqual(api.summariseAuthorPosts(undefined, 5, SINCE, 20).count, 0);
  assert.strictEqual(api.summariseAuthorPosts([p(1, 5, 10)], 0, SINCE, 20).count, 0, 'unknown author matches nobody');
});
```

- [ ] **Step 2: Run them and confirm they fail.** Run `node --test tests/author.test.js`. Expected: FAIL, `summariseAuthorPosts is not a function` (or a harness export error).
- [ ] **Step 3: Implement**

```js
  // Trusts nothing about the request: Torn documents a "from" filter on
  // forum/{id}/posts but its semantics are unverified, so a post at or before
  // the marker means the page cannot be read as "posts since". The result is
  // the same whatever order the posts come back in.
  function summariseAuthorPosts(posts, authorId, sinceMs, perPage) {
    var list = Array.isArray(posts) ? posts : [];
    var aid = toInt(authorId, 0);
    var since = Math.max(0, toInt(sinceMs, 0));
    var size = Math.max(1, toInt(perPage, POSTS_PER_PAGE));
    var out = { count: 0, latestAt: 0, newestAt: 0, complete: list.length < size, filterIgnored: false };
    for (var i = 0; i < list.length; i += 1) {
      var post = list[i];
      if (!isPlainObject(post)) continue;
      var at = secondsToMs(post.created_time);
      if (at > out.newestAt) out.newestAt = at;
      if (at <= since) { out.filterIgnored = true; continue; }
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
- [ ] **Step 5: Commit** with `git add tests/author.test.js && git commit -am "feat: summarise author posts from one posts page (#4)"`

### Task 4: `authorSinceFor` and `authorStateFor` (pure)

**Files:**
- Modify: the engine, right after `summariseAuthorPosts`
- Test: `tests/author.test.js`

**Interfaces:**
- Consumes: `unreadFor(apiRow, entry)`, which returns `{ tornUnread, postsTotal, dismissed, unread }`
- Produces:
  - `authorSinceFor(entry) -> ms`
  - `authorStateFor(apiRow, entry, u) -> { state: 'none'|'author'|'author-atleast'|'unchecked', count, latestAt, reason }`
  - `AUTHOR_REASON_TEXT: { never, stale, 'full-page', 'filter-ignored', 'no-author', 'no-marker' }` (ASCII strings)

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

test('a full page with no author post is unchecked, not none', () => {
  const e = entry({ authorCheckedAt: 1, authorCheckTotal: 12, authorCheckSince: SINCE, authorNewCount: 0, authorCheckComplete: false, authorCheckReason: 'full-page' });
  assert.deepStrictEqual([state(sub(), e).state, state(sub(), e).reason], ['unchecked', 'full-page']);
});

test('a full page with author posts is a lower bound', () => {
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

test('filter-ignored stays unchecked until the thread changes', () => {
  const e = entry({ authorCheckedAt: 1, authorCheckTotal: 12, authorCheckSince: SINCE, authorCheckReason: 'filter-ignored', authorCheckComplete: true });
  assert.strictEqual(state(sub(), e).reason, 'filter-ignored');
});

test('every reason has ASCII tooltip text that never quotes a count', () => {
  for (const k of ['never', 'stale', 'full-page', 'filter-ignored', 'no-author', 'no-marker']) {
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
    'full-page': 'More new posts than one page holds, and none on the page checked were by the author. The rest were not checked.',
    'filter-ignored': 'Torn returned posts from before your read point, so the result could not be trusted.',
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
      if (e.authorCheckReason === 'filter-ignored') return unchecked('filter-ignored');
      if (e.authorNewCount > 0) {
        return { state: e.authorCheckComplete ? 'author' : 'author-atleast', count: e.authorNewCount, latestAt: e.authorLatestAt, reason: '' };
      }
      return e.authorCheckComplete ? { state: 'none', count: 0, latestAt: 0, reason: '' } : unchecked('full-page');
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
        + '">author: not checked</span>');
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
    out.push('<p class="tfcc-note">Author-only mode reads one page of the thread\'s newest posts per lookup '
      + 'instead of its last-post time, so the cost is the same. Threads not checked yet show '
      + '"not checked". Posts from before you started using this script are not flagged, and '
      + 'edits are not detected.</p>');
```

  The second note is always shown, not only when the setting is on, so the user reads the limits before turning it on. The settings test above renders with the setting off and relies on that.
- [ ] **Step 4: Run `npm test`.** Expected: PASS. `.tfcc-unchecked` reuses the `.tfcc-note` colours, so no new colour is introduced. `tests/contrast-audit.mjs` needs the gstack browse binary, which this repo does not use (CLAUDE.md "Off"). If it is not available it exits with a message: record that in the PR, and leave the contrast check to the QA checklist.
- [ ] **Step 5: Commit** with `git commit -am "feat: author-only badges, catch-up group and settings copy (#4)"`

### Task 7: The runtime lookup: `checkAuthorPosts` and target selection in `refreshAll`

**Files:**
- Modify: `refreshAll` target block (~l.1966-1970). Add `checkAuthorPosts` right after `enrichThreads` (~l.2023).
- Modify: `tests/refresh.test.js`. Extend `router` to also record full URLs (`seenUrls.push(url.replace('https://api.torn.com/v2/', ''))`).

**Interfaces:**
- Consumes: `authorSinceFor`, `summariseAuthorPosts`, `tornApiGet(path, params, opts)`, `state.rows[i].authorReason`
- Produces: `checkAuthorPosts(ids: number[], now, opts) -> Promise<{ ok, checked, stoppedEarly? }>`

- [ ] **Step 1: Write the failing tests** (`tests/refresh.test.js`, reusing `boot`, `settle`, `subscribedThreadsPayload` and `forumFeedPayload`)

```js
function authorBoot(table, extraSettings) {
  return boot(table, { gmStore: [['tfcc:key', KEY],
    ['tfcc:settings', JSON.stringify(Object.assign({ v: 1, authorOnly: true }, extraSettings || {}))],
    ['tfcc:organizer', JSON.stringify({ v: 1, folders: [], lastCatchUpAt: 0, threads: {
      1: { lastVisitedAt: NOW - 3600000 }, 2: { lastVisitedAt: NOW - 3600000 } } })]] });
}
const post = (id, authorId, at) => ({ id, author: { id: authorId, username: 'u' }, created_time: at / 1000, content: '' });

test('author mode reads posts, not thread, and stays inside the budget', async () => {
  const table = {
    'user/forumsubscribedthreads': subscribedThreadsPayload([
      { id: 1, new: 5, total: 20, author: { id: 77, username: 'auth', karma: 1 } },
      { id: 2, new: 3, total: 9, author: { id: 88, username: 'auth2', karma: 1 } }]),
    'user/forumfeed': forumFeedPayload([]),
    'forum/categories': { categories: [] },
    'forum/1/posts': { posts: [post(1, 12, NOW - 60000), post(2, 77, NOW - 30000)] },
    'forum/2/posts': { posts: [post(3, 12, NOW - 60000)] },
  };
  const env = authorBoot(table);
  await settle(env);
  assert.strictEqual(env.router.seen.filter((u) => /\/thread$/.test(u)).length, 0);
  assert.deepStrictEqual(env.router.seen.filter((u) => /\/posts$/.test(u)).sort(), ['forum/1/posts', 'forum/2/posts']);
  assert.ok(env.router.seenUrls.some((u) => /^forum\/1\/posts\?.*from=\d+/.test(u)), 'the marker is sent as from');
  const rows = env.exports.state.rows;
  const r1 = rows.find((r) => r.id === '1');
  const r2 = rows.find((r) => r.id === '2');
  assert.deepStrictEqual([r1.authorState, r1.unread], ['author', 1]);
  assert.deepStrictEqual([r2.authorState, r2.unread], ['none', 0], 'only non-author posts: no badge');
  assert.ok(env.router.seen.length <= 13);
});

test('author mode respects the lookup budget and leaves the rest visibly unchecked', async () => {
  const subs = [];
  const table = { 'user/forumfeed': forumFeedPayload([]), 'forum/categories': { categories: [] } };
  for (let i = 1; i <= 15; i += 1) {
    subs.push({ id: i, new: 2, total: 10 });
    table['forum/' + i + '/posts'] = { posts: [] };
  }
  table['user/forumsubscribedthreads'] = subscribedThreadsPayload(subs);
  const env = authorBoot(table);
  await settle(env);
  assert.strictEqual(env.router.seen.filter((u) => /\/posts$/.test(u)).length, env.exports.DEFAULT_ENRICH_BUDGET);
  assert.ok(env.router.seen.length <= 13, 'the default refresh promise is 13 requests');
  const unchecked = env.exports.state.rows.filter((r) => r.authorState === 'unchecked');
  assert.strictEqual(unchecked.length, 5);
});

test('a failed posts lookup leaves the row unchecked and the refresh ok', async () => {
  const table = {
    'user/forumsubscribedthreads': subscribedThreadsPayload([{ id: 1, new: 2, total: 10 }]),
    'user/forumfeed': forumFeedPayload([]), 'forum/categories': { categories: [] },
  }; // forum/1/posts falls through to the router's error response
  const env = authorBoot(table);
  await settle(env);
  assert.strictEqual(env.exports.state.rows.find((r) => r.id === '1').authorState, 'unchecked');
  assert.strictEqual(env.exports.state.lastError, null);
});
```

  The `firstSeenAt` of threads in the subscribed list but not in the seeded organizer is set by `applyAutoAssign` at `NOW`, so those rows still have a marker. Threads 3-15 in the budget test get `since = NOW`. That is fine.
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
        return authorMode ? checkAuthorPosts(ids, now, options) : enrichThreads(ids, now, options);
```

  Then add:

```js
  // One forum/{id}/posts page per thread, in place of the forum/{id}/thread
  // lookup, so author-only mode costs exactly what enrichment costs. The entry
  // is re-read after the response, because a handler may have replaced the
  // organizer while the request was in flight.
  function checkAuthorPosts(ids, now, opts) {
    var list = (ids || []).slice(0, MAX_ENRICH_BUDGET);
    if (!list.length) return Promise.resolve({ ok: true, checked: 0 });
    var done = 0;
    var generation = state.generation;

    function step(i) {
      if (i >= list.length) return Promise.resolve({ ok: true, checked: done });
      var id = String(list[i]);
      var before = entryOf(state.organizer, id);
      var since = authorSinceFor(before);
      var row = state.rows.filter(function (r) { return r.id === id; })[0] || null;
      var authorId = (row && row.authorId) || before.authorId;
      var total = row ? row.postsTotal : before.postsTotal;
      return tornApiGet('forum/' + id + '/posts', { from: Math.floor(since / 1000) + 1 }, opts).then(function (res) {
        if (generation !== state.generation) return { ok: true, checked: done, stale: true };
        if (res.ok && isPlainObject(res.data) && Array.isArray(res.data.posts)) {
          var sum = summariseAuthorPosts(res.data.posts, authorId, since, POSTS_PER_PAGE);
          var e = entryOf(state.organizer, id);
          e.authorCheckedAt = now;
          e.authorCheckTotal = total;
          e.authorCheckSince = since;
          e.authorNewCount = sum.filterIgnored ? 0 : sum.count;
          e.authorLatestAt = sum.filterIgnored ? 0 : sum.latestAt;
          e.authorCheckComplete = sum.complete;
          e.authorCheckReason = sum.filterIgnored ? 'filter-ignored' : (!sum.complete && sum.count === 0 ? 'full-page' : '');
          if (!sum.filterIgnored && sum.newestAt > 0) {
            e.lastPostTimeCached = Math.max(e.lastPostTimeCached, sum.newestAt);
            if (sum.complete) e.enrichedAt = now;
          }
          done += 1;
        } else if (res.reason === 'throttled') {
          return { ok: true, checked: done, stoppedEarly: true };
        }
        return step(i + 1);
      });
    }

    return step(0);
  }
```

  `checkAuthorPosts` lives in the runtime section, not the engine, so purity does not apply to it. Confirm that `entryOf` is defined before the runtime section (~l.1161). It is.
- [ ] **Step 4: Run `npm test` and `npm run test:syntax`.** Expected: PASS, including `tests/read-only.test.js` (GET only, one host).
- [ ] **Step 5: Commit** with `git commit -am "feat: author-only lookups read one posts page within the same budget (#4)"`

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
    authorCheckComplete: true, authorCheckReason: 'filter-ignored',
  });
  api.recompute(NOW);
  const report = api.buildDebugReport();
  assert.match(report, /author only: on/);
  assert.match(report, /author unchecked: 1 \(filter-ignored 1\)/);
  assert.strictEqual(report.indexOf('SecretPlanner'), -1);
  assert.strictEqual(report.indexOf('abcdefghij123456'), -1, 'the key must never appear');
});
```

- [ ] **Step 2: Run it and confirm it fails.**
- [ ] **Step 3: Implement.** In `counts`, add `authorUnchecked` and `authorFilterIgnored`, counted from `state.rows` (`authorState === 'unchecked'`, `authorReason === 'filter-ignored'`), and add `authorOnly: state.settings.authorOnly === true` to the context. In the lines, add `'author only: ' + (c.authorOnly ? 'on' : 'off')` and `'author unchecked: ' + c.counts.authorUnchecked + ' (filter-ignored ' + c.counts.authorFilterIgnored + ')'`. This makes open question 1 (does Torn honour `from`) answerable from one pasted report.
- [ ] **Step 4: Run `npm test`.** Expected: PASS.
- [ ] **Step 5: Commit** with `git commit -am "feat: debug report shows author-check health (#4)"`

### Task 9: Mutation-check entries

**Files:**
- Modify: `tests/mutation-check.mjs` `MUTATIONS`

- [ ] **Step 1: Add the entries.** The last three guard the upgrade fix: the first reverts `loadKey` to the raw JSON comparison and expects `a settings blob saved by 0.1.0 is not reported as damaged` to fail; the second stops the organizer using the per-entry check and expects `an organizer saved by 0.1.0 is not reported as damaged` to fail; the third makes the per-entry check forgive anything and expects `a genuinely corrupt thread entry is still reported as damage` to fail.

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
    name: 'the from filter is trusted blindly',
    suite: 'tests/author.test.js',
    apply: (s) => s.replace('if (at <= since) { out.filterIgnored = true; continue; }', 'if (at <= since) { continue; }'),
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
  - paste the debug report and record `filter-ignored`. A non-zero count closes open question 1 against the design and blocks release.
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
- [ ] **Step 4: Release gate.** Do not tag until the `docs/qa-checklist.md` author-only section has been walked on a real signed-in account and spec open questions 1, 2 and 6 have answers.

## Self-review notes

- Spec coverage. Each spec requirement maps to a task:
  - setting: Task 1
  - persisted fields and migration: Task 2
  - not trusting `from`: Task 3
  - states, marker and reasons: Task 4
  - unread, Catch up, Unread only and header model: Task 5
  - badges, unchecked group, Settings cost copy and toggle round-trip: Task 6
  - data source, budget and failure paths: Task 7
  - debug visibility for open questions: Task 8
  - upgrade false-damage: Task 1 (settings, via #8's `isRecoveredValue`), Task 2 (nested per-thread fields, via `isRecoveredOrganizer`)
  - mutation guards: Task 9
  - docs, version and code map: Task 10

  My posts (#2) is out of scope here. The engine takes `authorOnly` and `mode` as arguments so #2 can pass `false`/`'any'`.
- Issue "What closes this" maps to tests as follows:
  - non-author-only thread has no badge and is not in Catch up: Task 5 and Task 7;
  - author post flagged: Task 5 and Task 7;
  - setting round-trips and survives a reload: Task 1 and Task 6;
  - Settings text states the cost: Task 6.
