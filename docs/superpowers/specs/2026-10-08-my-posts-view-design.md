# My posts view - design

**Status:** proposed, 2026-10-08; aligned with the live API findings of
2026-10-08 (`docs/reference/torn-api-live-findings-2026-10-08.md`, #14).
**Issue:** #2. Interacts with #3 (row cap) and #4 (author-only "new").
**Target release:** the next minor after the `@version` on `origin/main` at
release time (0.2.0 if `main` is still 0.1.0). The feature PR does not bump it;
see plan Task 12.
**Plan:** `docs/superpowers/plans/2026-10-08-my-posts-view.md`.

## Goal

Today the panel only knows the threads the user subscribes to. A player's own
conversations - threads they started, threads they replied in - are invisible
unless they also subscribed, and so is the question that matters most: "has
anyone answered me?"

This adds a sixth view, **My posts**, listing the threads the key owner started
plus the threads they have posted in, with the same row actions, filters and
sort as Threads, and an honest unread count for threads Torn gives no unread
count for.

## Non-goals

- **Auto-subscribing** to the user's threads. That writes Torn-side state, and
  the script is read-only by design (`tests/read-only.test.js`).
- **Catch up does not change.** My posts rows that are not otherwise in
  Threads do not appear in Catch up, the header "N new" badge, or the Catch up
  nav count. My posts has its own count. (Open question 6.)
- **Search does not change.** Metadata and deep search still cover the Threads
  population. Extending search to My posts is a follow-up.
- **Auto refresh does not fetch My posts.** It keeps doing exactly what it does
  today.
- **No pagination.** One page of each list per fetch (see Data source).
- **No new DOM access.** No reading of Torn's "your posts" pages, ever (ADR 0001).

## User-visible behaviour

### The nav button

- `VIEWS` becomes `['threads', 'catchup', 'search', 'drafts', 'settings', 'mine']`.
  `mine` is appended **last**, so `renderNav`'s loop emits it last with no
  special-casing, and an old stored `view` value still normalises.
- Label: **My posts**, with ` (N)` appended when N > 0, where N is the number
  of My posts rows with `unread > 0` after the archive rule (same shape as the
  Catch up and Drafts counts).
- It carries `data-act="view" data-view="mine"` and `aria-pressed` exactly like
  the other five, and an extra class `tfcc-nav-mine`.
- **Right-aligned** with `margin-left: auto` on `.tfcc-nav-mine` inside the
  existing flex row. When the row wraps at narrow width, the button is still
  last and sits at the right of its own line. No change to `.tfcc-nav`.

### The look, and the contrast audit

Light grey fill, dark text, in **every** theme. Match Torn needs nothing extra:
it only toggles `tfcc-theme-light` on the panel, and the fill and text tokens
are the same in both palettes. Only the border differs, because a light grey
fill on the light panel is not itself a visible boundary.

New tokens, defined in the dark block and overridden where noted in the light
block (so `tests/style.test.js` "light overrides every color the dark theme
sets" keeps passing - every `--tfcc-mine-*` color must appear in both blocks):

| Token | Dark | Light | Purpose |
|---|---|---|---|
| `--tfcc-mine-bg` | `#d9d9d9` | `#d9d9d9` | resting fill |
| `--tfcc-mine-hover` | `#c8c8c8` | `#c8c8c8` | hover fill |
| `--tfcc-mine-pressed` | `#b0b0b0` | `#b0b0b0` | `aria-pressed="true"` fill |
| `--tfcc-mine-text` | `#141414` | `#141414` | label |
| `--tfcc-mine-border` | `#d9d9d9` | `#5c5c5c` | boundary |

Measured WCAG ratios (sRGB relative luminance, the formula
`tests/contrast-audit.mjs` uses):

| Pair | Ratio | Need |
|---|---|---|
| text `#141414` on rest `#d9d9d9` | 13.05 | 4.5 |
| text on hover `#c8c8c8` | 11.01 | 4.5 |
| text on pressed `#b0b0b0` | 8.49 | 4.5 |
| fill `#d9d9d9` vs dark panel `#1f1f1f` | 11.68 | 3 (non-text) |
| border `#5c5c5c` vs light panel `#f2f2f2` | 5.97 | 3 (non-text) |

Pressed must not be signalled by color alone, because the generic
`button[aria-pressed="true"] { background: var(--tm-good-bg) }` is overridden
here. Pressed adds `box-shadow: inset 0 -3px 0 var(--tfcc-mine-text)`, an
underline bar at 8.49:1 against the pressed fill.

**Specificity, which is the trap.** The generic rules are
`#tfcc-panel button[aria-pressed="true"]` and `#tfcc-panel button:hover`, both
(1,1,1). A bare `.tfcc-nav-mine` rule is (1,1,0) and would lose to both. The
rules must be:

```
#tfcc-panel button.tfcc-nav-mine                       (1,1,1, declared later)
#tfcc-panel button.tfcc-nav-mine:hover                 (1,2,1)
#tfcc-panel button.tfcc-nav-mine[aria-pressed="true"]  (1,2,1)
```

All three set `color` and `background` outright (the host-stylesheet floor at
(1,0,0) is beaten either way). No new `#000`/`black` anywhere.

The contrast audit (`node tests/render-preview.mjs && node tests/contrast-audit.mjs`)
must print OK for every preview, and `render-preview.mjs` already loops
`api.VIEWS`, so the `mine` view gets dark, light and hostile previews for free
once the preview seeds My posts data.

### The view

My posts reuses the Threads layout: the same filter bar (filter box, sort
select, folder filter, tag filter, Unread only) and the same `renderRow` rows.
Above the bar, one line of context:

> Threads you started or posted in. Updated 4 minutes ago. 3 not checked yet.

- **Unread only.** It is the same `settings.unreadOnly` toggle, shared with
  Threads (one setting, as today). In My posts it shows only rows with
  `unread > 0` that the user has not marked read. Rows whose count is
  **unchecked** (see "new" below) are hidden by Unread only, and the context
  line says how many, so a hidden-because-unknown row is never mistaken for a
  checked-and-quiet one.
- **Row actions.** Mark read, Pin, Priority +/-, Folder, Tags, Note, Draft and
  Archive are the same buttons, same `data-act`s, same handlers, keyed by
  thread id against `state.rows`. No new handler is added for them.
- **Row marks.** A My posts row adds one chip: `started` or `posted in` (a
  thread the user both started and posted in shows `started`). A subscribed
  row keeps no "not subscribed" note; an unsubscribed one keeps it, as Threads
  does today. A locally counted badge reads `N new` and carries
  `title="Counted on this device since you last marked it read or posted. Torn does not report unread counts for threads you do not follow."`
  plus a `local count` note, so the number is never passed off as Torn's.
- **Sort.** All seven `SORT_MODES`, pinned first, unknown activity last - by
  calling the same `sortThreads`. `added` uses `firstSeenAt`, which for a
  My posts-only row falls back to when the script first saw it in My posts.
- **Filter grammar.** `by:`, `tag:`, `folder:`, `is:unread`, `is:pinned` and the
  rest work unchanged through `matchThread`. Two terms are added to
  `termMatchesThread`'s `is:` branch: `is:started` and `is:posted`. Both are
  false on rows outside My posts, which is the existing behaviour of an unknown
  `is:` value, so Threads is unaffected.
- **Archive rule.** Identical: archived rows are hidden unless pinned or
  `unread > 0`.

### Which rows appear in Threads

`mergeThreads` today builds rows from subscribed + organizer entries + drafts.
My posts adds a fourth source. Without a rule, every thread the user ever
posted in would flood Threads as "not subscribed". The rule, as a pure
predicate computed at merge into `row.inThreads`:

```
inThreads = subscribed || !mineRole || organized
organized = folderId || tags.length || pinned || priority != 0
            || note || archived || hasDraft
```

`lastSeenTotal` and `lastVisitedAt` deliberately do **not** count as organized,
so Mark read on a My posts row, or visiting one of your own threads, does not
pull it into Threads.

**Behaviour change, stated:** an unsubscribed thread that is also one of the
user's own, whose only local state is a visit or a read marker, moves from
Threads to My posts. Nothing is deleted; anything organized stays in both.

Threads, Catch up, the header badge, `totals.unread`, Catch up's Mark all read
and Search all use `inThreads` rows only. `markall` in particular must iterate
`inThreads` rows, or it would write a read marker for every My posts thread.

## Data source

### Endpoints

| Endpoint | Access | Used for |
|---|---|---|
| `user/forumthreads` | Public, API v2 only | Threads the key owner started |
| `user/forumposts` | Public, API v2 only | Posts the key owner made, for their `thread_id` |
| `forum/{id}/thread` | Public (existing) | Total posts, last post time, last poster, title, forum for posted-in threads |
| `forum/categories` | Public (existing) | Not called by My posts. Rows use the cached forum names; a forum not yet cached shows as "Forum N" until the next Threads refresh |

**What the saved reference confirms.** `docs/reference/torn-api-docs-2026-08-08.html`
lists `**forumposts` and `**forumthreads` under `user` in the **Public**
column, where `**` is the page's own legend for "only available in API v2",
and its changelog records both as added on 15.08.2024. With no `id`, a `user`
selection answers for the key owner, so no new key selection is needed and the
Settings key-access text does not change.

**What it does not confirm.** The saved page is the docs shell and the key
builder. It contains no response schema, no field names and no pagination
parameters for either selection. The live capture of 2026-10-08 settles that
instead: `docs/reference/torn-api-live-findings-2026-10-08.md` (issue #14,
PR #15), with redacted responses in `tests/fixtures/`. Where the note and the
OpenAPI document disagree, the note wins.

### Response shapes (verified 2026-10-08)

`user/forumthreads` (finding 1, `tests/fixtures/user-forumthreads.json`):

```
{ forumThreads: [ {
    id, title, forum_id,
    posts,                    // integer, counts REPLIES, not posts (finding 3)
    rating, views,
    author: { id, username, karma },
    last_poster: { id, username, karma },   // finding 10
    first_post_time, last_post_time,        // unix seconds
    has_poll, is_locked, is_sticky,
    new_posts                 // integer, Torn's own unread count (finding 1)
  } ],
  _metadata: { links: { prev, next } } }
```

`user/forumposts` (finding 2, `tests/fixtures/user-forumposts.json`):

```
{ forumPosts: [ {
    id, thread_id,
    author: { id, username, karma },
    is_legacy, is_topic, is_edited, is_pinned,
    created_time,             // unix seconds
    edited_by, has_quote, quoted_post_id,
    content,                  // NEVER stored, never logged
    likes, dislikes
  } ],
  _metadata: { links: { prev, next } } }
```

`forum/{id}/thread` (`tests/fixtures/forum-thread.json`) answers
`{ thread: { ...the forumThreads row without new_posts, plus content,
content_raw, poll } }`. Its `posts` is the same reply count (finding 3).

**The off-by-one (findings 3 and 4).** A thread object's `posts` counts
replies: thread 16589908 reports `posts: 1` in both `user-forumthreads.json`
and `forum-thread.json`, and `forum-thread-posts-asc.json` holds two posts for
it, the topic and one reply. Thread 16561608 reports `posts: 6206` and its
last page (`forum-posts-large-last-page.json`, offset 6200) holds 7 posts:
6,207 in all. The subscribed row's `posts.total` counts every post including
the topic (thread 16505837: `total: 1` in `user-forumsubscribedthreads.json`,
`posts: 0` from `forum/{id}/thread`, compared live). `lastSeenTotal` is written
by `markRead` from that subscribed unit. So **every `postsTotal` this design
stores is in the subscribed unit**: the two API readers, `mineThreadFromApi`
and `parseThreadDetail`, convert a numeric `posts` to `posts + 1` through one
helper, `threadPostsTotal`, and nothing else in the design ever sees the raw
reply count. A `posts.total` (the subscribed shape) is taken as it is.

**Page size and order (open question 2, partly settled).** Both captured lists
fit on one page: `user-forumthreads.json` has 1 row and `user-forumposts.json`
15, each with `next: null`. So the fixtures are consistent with any page of at
least 15 and prove neither 100 nor 20. `user/forumposts` is newest first by
default (`created_time` descends through the fixture). On `forum/{id}/posts`,
`limit` and `sort` are ignored and the page is 20 (findings 6 and 7), so this
design assumes the same may hold here: it still sends `limit=100`, which is
harmless if ignored, and **never depends on the page size**. If Torn caps the
page at 20, the window is the user's last 20 posts.

**Fallbacks, so a wrong assumption fails loudly rather than silently.** The
shapes are now verified, but Torn can change them; the tolerance stays:

- The list key is read as `forumThreads`, then `forum_threads`, then `threads`
  (and `forumPosts`, `forum_posts`, `posts`), the same tolerance
  `refreshAll` already shows `forumSbuscribedThreads`.
- Each field reads both the snake_case API name and the camelCase name the
  normaliser itself stores (the c4d91e1 lesson: a normaliser must read back its
  own output).
- `posts` is read as a number (replies, stored as `posts + 1`), else
  `posts.total` (every post, stored as it is); if neither, the row's total is
  **unknown** and it becomes a lookup target, never a zero.
- A response with no recognisable list is a named `parse` failure: "Torn's
  answer for your threads was not in the shape this version expects." The
  debug report records the response's **top-level key names only**.
- A row missing `id` / `thread_id` is dropped and counted; the count is shown
  in the debug report.
- There is **no automatic retry without `limit`**: a retry would be a fourteenth
  request. If Torn rejects the parameter, the fetch fails with the named Torn
  error and `MINE_PAGE_LIMIT` is fixed in a patch release. Open question 2.

### What is fetched and stored

One page of each list, `limit=100` (`MINE_PAGE_LIMIT`, which Torn may ignore;
see "Page size and order"), newest first. The user's latest page of posts
covers their active conversations; older threads stay in the list until the
cap evicts them (below), so a 20-row page loses nothing already seen. `_metadata.links.next` is **not**
followed. This is a deliberate bound, not an oversight.

Stored under a **new seventh storage key, `tfcc:mine`**, not inside `tfcc:feed`.
Reason: `loadKey` reports "damaged" whenever `JSON.stringify(raw) !==
JSON.stringify(normalised)`. Adding a `mine` field to `freshFeed` would make
every existing user's first load after upgrade report their cached thread list
as damaged. A separate key that is absent loads as `raw === null`, which is not
recovery. It is also independently resettable, like every other key.

```
tfcc:mine = {
  v: 1,
  fetchedAt: ms,            // last successful My posts fetch, 0 = never
  selfId: int,              // key owner's player id, learnt from the responses
  threads: [ {
    id, forumId, title,
    started: bool, posted: bool,
    myLastPostAt: ms,       // newest own post seen in this thread
    postsTotal: int,        // every post incl. the topic: the subscribed unit
    totalKnown: bool,
    lastPostAt: ms, lastPosterId: int,
    infoAt: ms,             // when postsTotal/lastPostAt were last observed
    baselineTotal: int,     // see "new" below; same unit as postsTotal
    firstSeenAt: ms,
    isLocked: bool,
    tornNew: int,           // new_posts from user/forumthreads
    tornNewKnown: bool      // false when the last forumthreads row lacked it
  } ]
}
```

- **Never stored:** post `content`, any other player's name beyond the thread
  author already shown in Threads, the API key.
- **Cap:** `MINE_MAX_THREADS = 200`, ordered by `max(myLastPostAt, lastPostAt)`
  descending. Threads that fall out of the latest page are **kept** until the
  cap evicts them, so the list does not churn.
- **Not exported.** It is a cache, like `tfcc:feed`. Organizer state for these
  threads (pins, tags, read markers) lives in `tfcc:organizer` as for any
  thread, and is exported as today.
- **Reset everything** clears it. **Reset folders and tags** does not.

### "New" on a thread the user does not subscribe to

Torn gives its own unread count in two places: `posts.new` on
`user/forumsubscribedthreads` rows, and `new_posts` on `user/forumthreads`
rows for threads the key owner started (finding 1). The definition, first
match wins:

1. **Subscribed** (the thread is in `state.feed.subscribed`): exactly
   Threads' rule, `unreadFor(apiRow, entry)` - Torn's count with the local
   dismissal layer. `unreadSource = 'torn'`.
2. **Started, not subscribed, `new_posts` present** (`tornNewKnown` and
   `totalKnown`): the same rule with `new_posts` in place of `posts.new`,
   `unreadFor({ postsNew: tornNew, postsTotal }, entry)`.
   `unreadSource = 'torn'`. No `local count` note.
3. **Not subscribed, total known, no Torn count:** a local count.
   ```
   seen     = max(entry.lastSeenTotal, mine.baselineTotal)
   unread   = max(0, postsTotal - seen)
   unreadSource = 'local'
   ```
   - `baselineTotal` is set to `postsTotal` the **first** time the script
     observes a total for that thread, so installing the feature does not
     flag the user's whole history as new. First sight is always 0 new.
   - When the newest post in the thread is the user's own
     (`lastPosterId === selfId`, or `myLastPostAt >= lastPostAt`),
     `baselineTotal` advances to `postsTotal`: you do not have unread replies
     to a thread whose last word is yours.
   - Mark read sets `entry.lastSeenTotal = postsTotal` through the existing
     `markRead`, exactly as in Threads.
   - **One unit throughout.** `postsTotal`, `baselineTotal` and
     `lastSeenTotal` all count every post including the topic, because
     `postsTotal` is stored as `posts + 1` (findings 3 and 4, above). Mixing
     units fails both ways: a thread read while subscribed (`lastSeenTotal`
     = N + 1) and later counted from a raw `posts` of N would hide its next
     reply, and a My posts Mark read that wrote N would leave the same thread
     one short of dismissed in Threads, showing Torn's "1 new" after the user
     marked it read. `tests/mine.test.js` pins both from the fixtures.
4. **Not subscribed, total unknown** (not yet looked up, or the lookup was cut
   by the budget or throttling): `unread = 0`, `unreadSource = 'unchecked'`.
   The row shows `not checked yet` instead of a badge. This is #4's rule 3 too:
   the row must never look checked when it was not.

If `tfcc:mine` is lost, baselines reset to "first sight" and the user sees 0
new until something moves. That under-reports rather than floods, which is
the safe direction.

**Why `new_posts` replaces the local count rather than cross-checking it.**
`new_posts` is Torn's own unread count, the same kind of number as `posts.new`
on subscribed rows, which Threads already trusts. It knows what the local
count cannot: that the user read the thread on Torn itself, on another device,
or before the script was installed, so it needs no first-sight baseline and
cannot drift by a unit. A cross-check has no honest output: when the two
disagree there is no rule for which to show, and showing both puts two numbers
on one badge. So rule 2 uses it whenever the row carries it, keeps the local
dismissal layer (Mark read still zeroes it, as in Threads), and falls back to
the local count only when the field is absent - which matters because it was
seen with a Limited key (finding 1) and this script asks for a Minimal one, so
its presence with a Minimal key is an owner check, not a fact. It covers only
threads the user started; posted-in threads keep the local count. The single
sample (`new_posts: 0` on thread 16589908, whose last poster is not the owner)
is consistent with "read on Torn" but cannot show when Torn increments or
clears it; the QA checklist walks that.

### Last activity on My posts rows

`resolveLastActivity` gains two optional candidates, both carried on the mine
record: `mine` (its `lastPostAt`, observed from `forumthreads` or a lookup) and
`own-post` (`myLastPostAt`). `ACTIVITY_SOURCES` becomes
`['enriched', 'feed', 'mine', 'enriched-stale', 'own-post', 'visit', 'none']`.
The newest candidate still wins, and the row still reports which.

## Request budget

CLAUDE.md constraint 7: a default refresh is at most 13 requests, and the
limiter holds 40 per rolling minute.

**Decision: My posts is fetched only for the My posts view, cached with a
TTL, and is its own bounded action - never added to the Threads refresh.**

| Action | Requests (default settings) |
|---|---|
| Threads refresh (unchanged) | 1 subscribed + 1 feed + <=1 categories + <=10 lookups = **<=13** |
| My posts fetch | 1 forumthreads + 1 forumposts + <=10 lookups = **<=12** |

- **When My posts fetches.** (a) The user opens the view and `tfcc:mine` is
  older than `MINE_TTL_MS = 15 min` or has never been fetched. (b) The user
  presses Refresh while My posts is the open view. Refresh in any other view
  runs `refreshAll` exactly as today. Opening the view is a user input, so
  "one input" still produces one bounded batch.
- **Lookups** reuse the existing "Activity lookups per refresh" setting
  (`enrichBudget`, default 10, max 25). Targets: My posts rows that are **not
  subscribed** and whose `infoAt` is older than `MINE_TTL_MS` or whose total is
  unknown, newest `myLastPostAt` first. Started threads whose `forumthreads`
  row carried a total and last post time need no lookup. Subscribed threads
  never need one; they have Torn's count.
- **Categories are never fetched by My posts.** That keeps the action at 12
  and avoids refactoring `refreshAll`'s category step. Names come from the
  shared `tfcc:feed` cache.
- **Page load does not fetch My posts.** `init` keeps calling `refreshAll`
  only. If the stored view is `mine`, the panel paints from `tfcc:mine` with
  its "Updated" time, and the user presses Refresh. A page load therefore still
  costs at most 13.
- **Worst minute.** Threads then My posts back to back, defaults: 13 + 12 = 25
  of 40, so neither is ever throttled. At the maximum budget (25) a Threads
  refresh is 1 + 1 + 1 + 25 = 28 and a My posts fetch is 2 + 25 = 27. Opened
  right after a maximal Threads refresh, My posts' two list requests are
  requests 29 and 30 and pass; its lookups get the remaining 10 of the 40, and
  the 11th is refused with `throttled`. The loop stops there exactly as
  `enrichThreads` does, so the rolling minute never holds more than 40
  requests, and the other 15 rows show `not checked yet`. Only if something
  else (a deep search) has already used 39 or more can a list request itself
  be throttled, which is the "Throttled" row of the failure table. The limiter,
  not the arithmetic, is the guarantee, and `tests/mine-refresh.test.js`
  proves it with a counting transport.
- **Single flight.** `state.refreshingMine` drops a second My posts fetch while
  one runs. Threads and My posts may run concurrently; the shared limiter
  spaces them.
- **Staleness.** The My posts fetch captures `state.generation` and checks it
  before every write, as `refreshAll` does, so Reset everything or clearing
  the key mid-fetch cannot be undone by a late answer.

**Settings text changes with it.** The note under "Activity lookups per
refresh" becomes (wording pinned by a test that reads the numbers from the
constants):

> A refresh of Threads makes two requests, plus one for the forum list at most
> once a day. Opening My posts, or refreshing while it is open, makes two
> requests of its own, at most once every 15 minutes unless you press Refresh.
> Each activity lookup adds one more to either, and only runs for a thread with
> no recent time. With the default of 10, a Threads refresh is at most 13
> requests and My posts at most 12; at the largest setting of 25, 28 and 27.
> The script keeps itself under 40 requests a minute regardless.

## Interaction with #3 (Rows shown)

#3 (`docs/superpowers/specs/2026-10-08-rows-shown-cap-design.md` on its branch)
defines the cap: a pure engine `capRows(rows, limit, expanded)`, the setting
`settings.rowsShown` (0 = All), frozen `CAPPED_VIEWS` / `UNCAPPED_VIEWS`
constants with a test that every entry of `VIEWS` is in exactly one, capped
lists in `model.capped`, a module-level `VIEW_LABELS`, and an in-memory
`state.showAll` keyed by view. This design uses #3's names and adds nothing
parallel to them. The view id is `mine` in both.

- `viewRows(rows, view, filters, query)` is **only** the filter pipeline:
  population (`inThreads` or `mineRole`), archive rule, Unread only, folder,
  tag and the filter box. It does not cap. The pipeline per view is
  `viewRows` -> `sortThreads` -> `capRows`.
- `model.mine` keeps the **whole** sorted list. #3's capped copy for this view
  is `model.capped.mine`, so the nav count and `model.mine.total` stay full.
- The My posts nav count `(N)` counts **all** unread My posts rows, never only
  the capped ones, mirroring #3's rule for Catch up.
- "Showing 10 of 42" in My posts counts the post-filter population, the same
  as Threads.

**If #3 has merged first**, #2 adds `'mine'` to `VIEWS`, which makes #3's
classification test fail until:

1. `'mine'` is added to `CAPPED_VIEWS`, and `mine: 'My posts'` to
   `VIEW_LABELS` (the label map `renderNav` reads; do not re-add a local one);
2. `buildPanelModel` sets
   `model.capped.mine = capRows(sortedMine, s.rowsShown, state.showAll.mine === true)`,
   where `sortedMine = sortThreads(viewRows(rows, 'mine', s, query), s.sort)`;
3. `renderMineView` renders `model.capped.mine.rows` and ends with
   `renderCapLine(model.capped.mine, 'mine')`;
4. `tests/rows-cap.test.js` gains the My posts cap test #3's reconciliation
   requires: six rows in reverse title order, a cap of 3, the top three
   asserted, "Showing 3 of 6", and a `rows-toggle` button with
   `data-view="mine"`.

**If #2 merges first**, `VIEWS` has `mine` and `renderNav`'s local label map
has a `mine` entry. #3 hoists that map into `VIEW_LABELS` and does steps 1 to 4
itself. Until then My posts is uncapped, because nothing caps it yet.

Either way the second PR does the reconciliation, and #3's classification test
fails until it has.

## Interaction with #4 (Only flag author updates)

- #4 changes "new" for **Threads and Catch up** only. My posts ignores the
  setting: on a thread the user started, "only when the author posts" would
  mean "only when you post", which is meaningless; and a My posts row is there
  precisely to surface other people's replies. The Settings label for #4 must
  say "in Threads and Catch up".
- On a row that is in both Threads and My posts, the two views may show
  different badges while #4 is on. That is correct and the badge text differs
  ("2 new by author" vs "2 new"), so neither passes as the other.
- **Shared plumbing, not a dependency.** This design adds `lastPosterId` to
  the record parsed from `forum/{id}/thread`, in a pure `parseThreadDetail(raw)`
  helper. #4 chose one page of `forum/{id}/posts` (with `from`) as its data
  source, so #4 does **not** depend on this helper. `last_poster` is now
  confirmed live as `{ id, username, karma }` (finding 10), so the helper is
  available to #4 if it wants it. Note for #4: `parseThreadDetail` returns
  `postsTotal` already converted to the subscribed unit (`posts + 1`,
  findings 3 and 4), so it compares directly with `posts.total` and
  `lastSeenTotal`; a caller must not add 1 again. My posts uses `last_poster`
  only for the "your own last post clears the count" shortcut; if the field is
  ever absent, `myLastPostAt >= lastPostAt` still covers it. The `unreadSource` field and
  the `unchecked` state are the shape #4's "data not available yet" rule needs
  too.

## Failure and empty states

All rendered inside the My posts view; `state.mineError` is separate from
`state.lastError`, so a My posts failure never paints over Threads' error, or
vice versa. Every detail passes through `scrubDetail`.

| Condition | What the user sees |
|---|---|
| No key | The existing "No API key yet" banner. No request. |
| Key rejected (2, 13, 16, 18) | The existing rejection message; `tornApiGet` already gates every caller. |
| Never fetched, fetch running | "Loading the threads you started and posted in..." |
| `forumthreads` fails | Named error with a Retry (`data-act="refresh"`). Any cached rows stay visible under "Showing the saved list from <time>." |
| `forumthreads` ok, `forumposts` fails | Started threads shown, plus a warning: "Threads you posted in could not be loaded: <detail>." The fetch still counts as done for the TTL only if both succeeded. |
| Shape not recognised | Named `parse` error (above). Cached rows stay. |
| Throttled | "Slowing down to stay inside Torn's API limit." Unlooked-up rows show `not checked yet`. |
| Lookups cut short | Context line: "N not checked yet." |
| Both lists empty | "Torn reports no threads you started or posted in." |
| Filters hide everything | "Nothing matches. Try clearing the filters." (Threads' wording.) |
| Unread only hides everything | "No new replies in your threads." plus the unchecked count if non-zero. |

## Security and constraints

- **Engine purity.** Every new decision function lives in the engine section
  and takes `now` as an argument: `normaliseMineThreadRow`,
  `normaliseMinePostRow`, `freshMine`, `normaliseMine`, `mergeMineSnapshot`,
  `threadPostsTotal`, `parseThreadDetail`, `applyMineDetail`, `mineUnreadFor`, `isOrganized`,
  `mineLookupTargets`, `viewRows`. `tests/purity.test.js` covers them with no
  change. All network, storage and rendering stays in the runtime section.
- **Read-only.** Two more GETs to `api.torn.com`. No write verbs, no new
  navigation, no synthetic events. `tests/read-only.test.js` keeps passing.
- **`@match`, `@grant`, `@connect` unchanged.** `@connect` stays exactly
  `api.torn.com`.
- **ADR 0001.** No new DOM access: the data comes from the API. The DOM is
  still touched only for the mount container and the reply textarea.
- **API key.** Never in `tfcc:mine`, never in `state.mineError`, never in the
  debug report. All My posts errors go through `scrubDetail`.
- **Post bodies.** `forumposts` returns `content`. `normaliseMinePostRow`
  drops it, and a test asserts no stored or reported string contains it.
- **ASCII only.** All new strings - labels, notes, the Settings text, the
  badge title - are plain ASCII. "Torn's" uses `\'` in single-quoted source.
- **Debug report.** Adds counts only: My posts threads, started, posted,
  unchecked, `fetchedAt`, and the last My posts error reason. No titles, no
  ids beyond what the report already carries, no content.

## Testing strategy

New suites:

- `tests/mine.test.js` - engine: both normalisers (API shape read from the
  real fixtures, stored shape, read-back round trip, content dropped,
  alternate list keys), the off-by-one (`posts + 1`, pinned from
  `user-forumthreads.json`, `forum-thread.json`,
  `forum-thread-posts-asc.json`, `forum-posts-large-last-page.json` and
  `user-forumsubscribedthreads.json`, written failing first), `mergeMineSnapshot`
  (first-sight baseline, own-post baseline advance, retain and cap at 200,
  order, `new_posts` kept), `parseThreadDetail`, `mineUnreadFor` (subscribed,
  `new_posts`, local, unchecked), `isOrganized`,
  `mineLookupTargets` (budget, TTL, subscribed and started-with-total excluded,
  order), `viewRows` per view.
- `tests/mine-refresh.test.js` - runtime: exact request sequence and params
  through the router transport, at most 12 with defaults, no `forum/categories`, budget 0 means
  exactly 2, TTL suppresses a second open, Refresh in My posts bypasses the TTL,
  Refresh in Threads never calls My posts endpoints, single flight, throttled
  stops lookups early, every failure row of the table above, shape mismatch,
  no key means no request.

Extended suites:

- `tests/merge.test.js` - My posts rows in `mergeThreads`, `inThreads`,
  subscribed My posts row uses Torn's count, new activity sources.
- `tests/search.test.js` - `is:started`, `is:posted`, and `by:`/`tag:`/
  `folder:`/`is:unread` over My posts rows.
- `tests/panel.test.js` - nav button last, class, `aria-pressed`, count; the
  view renders every state; Unread only in My posts; `local count` and
  `not checked yet` marks; header badge and Catch up exclude My posts-only rows;
  Settings text.
- `tests/handlers.test.js` - every rendered action still handled; Mark read on
  a My posts row zeroes its local count; `markall` writes no marker for a
  My posts-only row; opening My posts triggers the fetch once per TTL.
- `tests/style.test.js` - the three `.tfcc-nav-mine` rules exist with the
  specificities above, `margin-left: auto`, every `--tfcc-mine-*` token defined
  in both theme blocks, pressed carries a non-color cue.
- `tests/storage.test.js` - `tfcc:mine` round-trips; an upgrade with no
  `tfcc:mine` reports nothing damaged; a corrupt `tfcc:mine` resets only itself.
- `tests/staleness.test.js` - Reset everything mid-fetch drops the late answer.
- `tests/read-only.test.js` - the budget test covers the My posts action.
- `tests/debug-report.test.js` - denylist extended with a post body and a
  My posts thread title.
- `tests/share.test.js` - the export carries nothing from `tfcc:mine`.
- `tests/api.test.js` - no key in a My posts failure detail.
- `tests/load-userscript.js` - new exports and three payload builders,
  `forumThreadsPayload`, `forumPostsPayload` and `forumThreadPayload`, each
  cloned from a row of the live fixtures in `tests/fixtures/` (issue #14), so
  every field name is the one Torn sends.
- `tests/render-preview.mjs` - seeds My posts data so the `mine` previews are
  meaningful for the contrast audit.

Mutation-check entries (`tests/mutation-check.mjs`), each tied to one promise:

| Mutation | Suite that must fail |
|---|---|
| `mine` is not last in `VIEWS` | `tests/panel.test.js` |
| `.tfcc-nav-mine` loses `margin-left: auto` | `tests/style.test.js` |
| the pressed rule loses its `.tfcc-nav-mine` qualifier | `tests/style.test.js` |
| `viewRows` ignores Unread only for `mine` | `tests/panel.test.js` |
| first sight no longer sets the baseline (history floods as new) | `tests/mine.test.js` |
| own last post no longer advances the baseline | `tests/mine.test.js` |
| an unknown total counts as 0 checked instead of unchecked | `tests/mine.test.js` |
| a thread's `posts` is stored as the total, without the `+ 1` | `tests/mine.test.js` |
| `new_posts` is ignored (started threads fall back to the local count) | `tests/mine.test.js` |
| `MINE_TTL_MS` set to 0 | `tests/mine-refresh.test.js` |
| lookups ignore the budget | `tests/mine-refresh.test.js` |
| post `content` is kept by the normaliser | `tests/mine.test.js` |
| `inThreads` always true (My posts floods Threads) | `tests/merge.test.js` |
| the My posts staleness check is removed | `tests/staleness.test.js` |

Run as `node tests/mutation-check.mjs > mutation.log 2>&1`, then read the log.
Never pipe it.

## QA checklist additions (`docs/qa-checklist.md`)

New section "My posts", walked on both Torn PDA and desktop:

- [ ] My posts is the last nav button and sits at the right edge, in Dark,
      Light and Match Torn (toggle Torn's own theme while it is open).
- [ ] It is light grey with dark text in all three, and visibly pressed (bar
      under the label) when open.
- [ ] At the narrowest PDA width the nav wraps and My posts is still last and
      reachable.
- [ ] Opening it the first time loads your threads; the number of requests in
      the API key log (Torn Settings, API, key log) is at most 12.
- [ ] Closing and reopening within 15 minutes makes no request (key log).
- [ ] A thread you started and do not follow appears with `started`.
- [ ] A thread you replied in and do not follow appears with `posted in`.
- [ ] Have a second account reply in a thread you **posted in** and do not
      follow; Refresh in My posts; it shows `1 new` with `local count`.
- [ ] Have a second account reply in a thread you **started** and do not
      follow; Refresh in My posts; it shows `1 new` with **no** `local count`
      note (Torn's `new_posts`). Open the thread on Torn, come back after 15
      minutes or press Refresh; it shows no count.
- [ ] Mark read on a thread you posted in, then subscribe to it on Torn and
      Refresh Threads; it shows no new until someone replies (the units agree).
- [ ] Mark read zeroes it, survives a reload, and the thread does **not**
      appear in Threads.
- [ ] Pin it; it now appears in Threads as not subscribed, and in My posts.
- [ ] Unread only in My posts shows only threads with new replies.
- [ ] `is:started`, `is:posted`, `by:`, `tag:` work in the filter box.
- [ ] A thread link with no known forum opens the right thread (open question 4).
- [ ] Refresh in Threads makes no My posts request (key log).

## Assumptions

Settled by the live capture of 2026-10-08 (`docs/reference/torn-api-live-findings-2026-10-08.md`):

1. **Settled, with one owner check left.** `user/forumthreads` and
   `user/forumposts` with no `id` answer for the key owner: every row in
   `user-forumthreads.json` and the topic post in `user-forumposts.json` has
   the owner as `author` (player 1000, whose karma matches
   `user-profile-karma.json`, finding 12). The capture used a Limited key; that
   a Minimal key gets the same answer is the owner check in plan
   "Prerequisite".
2. **Settled.** The response shapes are as listed under "Response shapes
   (verified 2026-10-08)", including `thread_id` and `created_time` on posts,
   a numeric `posts` on threads, and `new_posts` (findings 1 and 2). The
   normalisers keep tolerating the listed alternates in case Torn changes them.
3. **Partly settled.** Nothing captured shows whether `limit=100` is honoured
   on these two selections: both lists fit on one page (1 and 15 rows,
   `next: null`). `forum/{id}/posts` ignores `limit` (finding 7). The design
   keeps sending `limit=100`, which is harmless if ignored, and does not depend
   on it.
4. **Open.** A Torn thread link with `f=0` still opens the thread when the
   forum id is unknown; once a lookup supplies `forum_id`, the link is exact.
   Not probed.
5. The user's latest page of posts (100 if `limit` is honoured, possibly 20)
   is a sufficient window for "my conversations", because the cap keeps every
   thread already seen.
6. **Settled.** `forum/{id}/thread` returns `posts` and `last_poster`
   (`forum-thread.json`; finding 10, `last_poster` is `{ id, username, karma }`).
   The fallbacks stay: no `posts` means the total stays unknown and the row is
   `not checked yet`, never a zero; no `last_poster` means the "own last post"
   shortcut falls back to `myLastPostAt >= lastPostAt`.
7. **Refuted, and the design changed.** Thread totals do **not** count the
   opening post: `posts` on `user/forumthreads` and `forum/{id}/thread` counts
   replies, while `posts.total` on subscribed rows counts every post
   (findings 3 and 4; `user-forumthreads.json` and `forum-thread.json` say
   `posts: 1` for thread 16589908, whose post list in
   `forum-thread-posts-asc.json` holds 2). The readers store `posts + 1`, so
   baselines and read markers compare like with like.

## Open questions (need the live API or real hardware)

1. ~~**Shapes.**~~ **Closed** by findings 1, 2, 3 and 10 and the fixtures
   `user-forumthreads.json`, `user-forumposts.json` and `forum-thread.json`.
2. **Pagination parameters. Partly closed.** Order is newest first by default
   (`created_time` descends through `user-forumposts.json`). Page size and
   whether `limit`, `from`, `to` or `sort` are honoured on these two
   selections are still unknown: the owner's lists fit on one page each. On
   `forum/{id}/posts`, `limit` and `sort` are ignored (findings 6 and 7), so
   the design does not rely on either. Settling it needs an account with more
   than 20 posts; the design is correct either way.
3. ~~**`new_posts` on `forumthreads`.**~~ **Closed.** It exists, with a
   Limited key (finding 1, `user-forumthreads.json`: `new_posts: 0`). It
   replaces the local count for started threads that carry it; see "Why
   `new_posts` replaces the local count". When Torn increments and clears it
   is a QA item, and its presence with a Minimal key is an owner check.
4. **Links without a forum id.** Does `forums.php#/p=threads&f=0&t=<id>` open
   the thread? Not probed.
5. **Deleted posts and threads.** Does a deleted thread drop out of
   `forumposts`, and does a lookup on it return an error code that should
   remove it from `tfcc:mine`? Not probed.
6. **Catch up.** Do users want replies to their own unsubscribed threads in
   Catch up? Deferred to after real use.
7. **Faction and private forums.** Do posts in forums the key cannot see
   publicly come back from a Public selection, and if so do their lookups fail?
   Not probed.
