# My posts view - design

**Status:** proposed, 2026-10-08. Awaiting `/plan-eng-review`.
**Issue:** #2 (FORGE-448). Interacts with #3 (row cap) and #4 (author-only "new").
**Target release:** v0.2.0.
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
block (so `tests/style.test.js` "light overrides every colour the dark theme
sets" keeps passing - every `--tfcc-mine-*` colour must appear in both blocks):

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

Pressed must not be signalled by colour alone, because the generic
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

`mergeThreads` today builds rows from subscribed + organiser entries + drafts.
My posts adds a fourth source. Without a rule, every thread the user ever
posted in would flood Threads as "not subscribed". The rule, as a pure
predicate computed at merge into `row.inThreads`:

```
inThreads = subscribed || !mineRole || organised
organised = folderId || tags.length || pinned || priority != 0
            || note || archived || hasDraft
```

`lastSeenTotal` and `lastVisitedAt` deliberately do **not** count as organised,
so Mark read on a My posts row, or visiting one of your own threads, does not
pull it into Threads.

**Behaviour change, stated:** an unsubscribed thread that is also one of the
user's own, whose only local state is a visit or a read marker, moves from
Threads to My posts. Nothing is deleted; anything organised stays in both.

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
builder. It contains **no response schema, no field names and no pagination
parameters** for either selection. Everything below about shapes is an
**unverified assumption** from memory of Torn's public swagger, to be checked
against the live API before the normaliser tests are frozen (plan Task 0).

### Assumed response shapes (unverified)

`user/forumthreads`:

```
{ forumThreads: [ {
    id, forum_id, title,
    posts,                    // integer total  (fallback: posts.total)
    first_post_time, last_post_time,     // unix seconds
    author: { id, username, karma },
    last_poster: { id, username } | null,   // may be absent
    is_locked, is_sticky,
    new_posts                  // may exist; IGNORED until verified
  } ],
  _metadata: { links: { prev, next } } }
```

`user/forumposts`:

```
{ forumPosts: [ {
    id, thread_id,
    author: { id, username, karma },
    created_time,              // unix seconds  (fallback: timestamp)
    is_topic, is_edited,
    content                    // NEVER stored, never logged
  } ],
  _metadata: { links: { prev, next } } }
```

Pagination is assumed to be `limit` (default 20, max 100), `from`/`to`
timestamps and `sort`, with `_metadata.links.next` for the next page.

**Fallbacks, so a wrong assumption fails loudly rather than silently:**

- The list key is read as `forumThreads`, then `forum_threads`, then `threads`
  (and `forumPosts`, `forum_posts`, `posts`), the same tolerance
  `refreshAll` already shows `forumSbuscribedThreads`.
- Each field reads both the snake_case API name and the camelCase name the
  normaliser itself stores (the c4d91e1 lesson: a normaliser must read back its
  own output).
- `posts` is read as a number, else `posts.total`; if neither, the row's total
  is **unknown** and it becomes a lookup target, never a zero.
- A response with no recognisable list is a named `parse` failure: "Torn's
  answer for your threads was not in the shape this version expects." The
  debug report records the response's **top-level key names only**.
- A row missing `id` / `thread_id` is dropped and counted; the count is shown
  in the debug report.
- There is **no automatic retry without `limit`**: a retry would be a fourteenth
  request. If Torn rejects the parameter, the fetch fails with the named Torn
  error and `MINE_PAGE_LIMIT` is fixed in a patch release. Open question 2.

### What is fetched and stored

One page of each list, `limit=100` (`MINE_PAGE_LIMIT`), newest first. The
user's last 100 posts cover their active conversations; older threads stay in
the list until the cap evicts them (below). `_metadata.links.next` is **not**
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
    postsTotal: int, totalKnown: bool,
    lastPostAt: ms, lastPosterId: int,
    infoAt: ms,             // when postsTotal/lastPostAt were last observed
    baselineTotal: int,     // see "new" below
    firstSeenAt: ms,
    isLocked: bool
  } ]
}
```

- **Never stored:** post `content`, any other player's name beyond the thread
  author already shown in Threads, the API key.
- **Cap:** `MINE_MAX_THREADS = 200`, ordered by `max(myLastPostAt, lastPostAt)`
  descending. Threads that fall out of the latest page are **kept** until the
  cap evicts them, so the list does not churn.
- **Not exported.** It is a cache, like `tfcc:feed`. Organiser state for these
  threads (pins, tags, read markers) lives in `tfcc:organizer` as for any
  thread, and is exported as today.
- **Reset everything** clears it. **Reset folders and tags** does not.

### "New" on a thread the user does not subscribe to

`posts.new` exists only on `user/forumsubscribedthreads` rows. The definition:

1. **Subscribed** (the thread is in `state.feed.subscribed`): exactly
   Threads' rule, `unreadFor(apiRow, entry)` - Torn's count with the local
   dismissal layer. `unreadSource = 'torn'`.
2. **Not subscribed, total known:** a local count.
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
3. **Not subscribed, total unknown** (not yet looked up, or the lookup was cut
   by the budget or throttling): `unread = 0`, `unreadSource = 'unchecked'`.
   The row shows `not checked yet` instead of a badge. This is #4's rule 3 too:
   the row must never look checked when it was not.

If `tfcc:mine` is lost, baselines reset to "first sight" and the user sees 0
new until something moves. That under-reports rather than floods, which is
the safe direction.

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
  of 40. At the maximum budget the actions are 28 and 27, and the two exceed
  40: the limiter returns `throttled`, and the My posts lookup loop stops
  early exactly as `enrichThreads` does. Rows not looked up show
  `not checked yet`. The limiter, not the arithmetic, is the guarantee.
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
> requests and My posts at most 12.
> The script keeps itself under 40 requests a minute regardless.

## Interaction with #3 (Rows shown)

The row cap has not landed. This design makes it one change, not three:

- The per-view filter in `buildPanelModel` is factored into one pure engine
  function, `viewRows(rows, view, filters, query)`, which applies population
  (`inThreads` or `mineRole`), the archive rule, Unread only, folder, tag and
  the filter box. `sortThreads` is applied after it. #3 then caps the result of
  `sortThreads(viewRows(...))` in one place, for `threads`, `catchup` and `mine`.
- The My posts nav count `(N)` counts **all** unread My posts rows, never only
  the capped ones, mirroring #3's rule for Catch up.
- "Showing 10 of 42" in My posts counts the post-filter population, the same
  as Threads.

Whichever of #2 and #3 lands second rebases onto `viewRows`.

## Interaction with #4 (Only flag author updates)

- #4 changes "new" for **Threads and Catch up** only. My posts ignores the
  setting: on a thread the user started, "only when the author posts" would
  mean "only when you post", which is meaningless; and a My posts row is there
  precisely to surface other people's replies. The Settings label for #4 must
  say "in Threads and Catch up".
- On a row that is in both Threads and My posts, the two views may show
  different badges while #4 is on. That is correct and the badge text differs
  ("2 new by author" vs "2 new"), so neither passes as the other.
- **Shared plumbing.** This design adds `lastPosterId` to the record parsed
  from `forum/{id}/thread`, in a pure `parseThreadDetail(raw)` helper. #4's
  candidate data source 1 (`last_poster`) needs exactly that field; #4 should
  reuse the helper rather than parse the response a second time. The
  `unreadSource` field and the `unchecked` state are the shape #4's "data not
  available yet" rule needs too.

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
  `parseThreadDetail`, `applyMineDetail`, `mineUnreadFor`, `isOrganised`,
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

- `tests/mine.test.js` - engine: both normalisers (API shape, stored shape,
  read-back round trip, content dropped, alternate list keys), `mergeMineSnapshot`
  (first-sight baseline, own-post baseline advance, retain and cap at 200,
  order), `parseThreadDetail`, `mineUnreadFor` (all three sources), `isOrganised`,
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
  in both theme blocks, pressed carries a non-colour cue.
- `tests/storage.test.js` - `tfcc:mine` round-trips; an upgrade with no
  `tfcc:mine` reports nothing damaged; a corrupt `tfcc:mine` resets only itself.
- `tests/staleness.test.js` - Reset everything mid-fetch drops the late answer.
- `tests/read-only.test.js` - the budget test covers the My posts action.
- `tests/debug-report.test.js` - denylist extended with a post body and a
  My posts thread title.
- `tests/share.test.js` - the export carries nothing from `tfcc:mine`.
- `tests/api.test.js` - no key in a My posts failure detail.
- `tests/load-userscript.js` - new exports and two payload builders,
  `forumThreadsPayload` and `forumPostsPayload`, built from the Task 0 fixture.
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
- [ ] Have a second account reply in such a thread; Refresh in My posts; it
      shows `1 new` with `local count`.
- [ ] Mark read zeroes it, survives a reload, and the thread does **not**
      appear in Threads.
- [ ] Pin it; it now appears in Threads as not subscribed, and in My posts.
- [ ] Unread only in My posts shows only threads with new replies.
- [ ] `is:started`, `is:posted`, `by:`, `tag:` work in the filter box.
- [ ] A thread link with no known forum opens the right thread (open question 4).
- [ ] Refresh in Threads makes no My posts request (key log).

## Assumptions

1. `user/forumthreads` and `user/forumposts` with no `id` answer for the key
   owner, with any key that can already read `forumsubscribedthreads`.
2. The response shapes above, including `thread_id` and `created_time` on posts
   and a numeric `posts` total on threads. Normalisers tolerate the listed
   alternates.
3. `limit=100` is accepted. If Task 0 finds it is not, `MINE_PAGE_LIMIT` is
   dropped from the params before release and the default page (20) is used.
4. A Torn thread link with `f=0` still opens the thread when the forum id is
   unknown; once a lookup supplies `forum_id`, the link is exact.
5. The user's latest 100 posts are a sufficient window for "my conversations".
6. `forum/{id}/thread` returns `posts` (total) and `last_poster.id`, as the
   v0.1.0 spec lists them as confirmed against swagger; v0.1.0 only reads
   `last_post_time`, `is_locked` and `is_sticky`.
7. Thread totals count every post including the opening one, the same unit
   `posts.total` uses, so baselines compare like with like.

## Open questions (need the live API or real hardware)

1. **Shapes.** Do the two responses match the assumed fields? Capture one real
   response of each, strip `content` and names, and commit it as a fixture
   (plan Task 0).
2. **Pagination parameters.** Are `limit`, `from`, `to`, `sort` accepted, and
   what is the maximum page? Is order newest first by default?
3. **`new_posts` on `forumthreads`.** If a real unread count exists for
   threads you started, should it replace the local count for those rows?
   (Designed for, not built: it would set `unreadSource = 'torn'`.)
4. **Links without a forum id.** Does `forums.php#/p=threads&f=0&t=<id>` open
   the thread?
5. **Deleted posts and threads.** Does a deleted thread drop out of
   `forumposts`, and does a lookup on it return an error code that should
   remove it from `tfcc:mine`?
6. **Catch up.** Do users want replies to their own unsubscribed threads in
   Catch up? Deferred to after real use.
7. **Faction and private forums.** Do posts in forums the key cannot see
   publicly come back from a Public selection, and if so do their lookups fail?
