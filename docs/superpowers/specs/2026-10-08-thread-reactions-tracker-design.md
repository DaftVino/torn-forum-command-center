# Thread reactions tracker - design

**Status:** proposed, 2026-10-08. Awaiting `/plan-eng-review`.
**Issue:** #10. Depends on #2 (My posts, PR #5) for its data. Shares the
panel header with #9 (badges).
**Target release:** whichever minor release first carries both #2 and this.
The feature PR does not bump the version; see plan Task 8.
**Plan:** `docs/superpowers/plans/2026-10-08-thread-reactions-tracker.md`.

## Goal

A player who starts threads has no quick view of how they are received. This
adds one small line to the panel, under the header, that totals what Torn
reports about the threads the key owner started:

> Your threads: **+12** rating, **3.4k** views

Tapping it opens My posts, where each thread you started shows its own
figures. That is the whole feature.

## The data question, settled first

### Source

Torn's published OpenAPI document, `https://www.torn.com/swagger/openapi.json`,
`openapi: 3.1.0`, `info.version: 6.13.8`, fetched 2026-10-08. It answered an
automated request (the saved HTML docs in `docs/reference/` do not carry
response schemas, and neither `rating`, `likes`, `dislikes` nor any
subscriber field appears anywhere in that HTML or in `tests/`). The relevant
paths and schemas are committed unedited as
`docs/reference/torn-openapi-forum-excerpt-2026-10-08.json`, so every claim
below can be checked without the network.

### What `user/forumthreads` returns

`GET /user/forumthreads`, "Get your threads", Public key, `x-stability:
Stable`. Parameters `limit` (default 20, maximum 100), `sort`, `from`, `to`.
Response `UserForumThreadsResponse`:

```
{ forumThreads: ForumThreadUserExtended[], _metadata: RequestMetadataWithLinks }
```

`ForumThreadUserExtended` is `ForumThreadBase` plus `new_posts`.
`ForumThreadBase` has these **required** fields, exactly:

| Field | Type | Schema description |
|---|---|---|
| `id` | int32 | |
| `title` | string | |
| `forum_id` | int32 | |
| `posts` | int32 | |
| **`rating`** | int32 | *(none)* |
| **`views`** | int32 | "Total number of times players have opened this thread." |
| `author` | `{ id, username, karma }` | |
| `last_poster` | `{ id, username, karma }` or null | |
| `first_post_time` | int32 | |
| `last_post_time` | int32 or null | |
| `has_poll`, `is_locked`, `is_sticky` | boolean | |
| `new_posts` (extended) | int32 or null | "Available only when requesting data for yourself ... with at least 'Minimal' access type key." |

### What does not exist

- **No thumbs-up or thumbs-down count on a thread.** No thread schema
  (`ForumThreadBase`, `ForumThreadExtended`, `ForumThreadUserExtended`,
  `ForumSubscribedThread`) has `likes`, `dislikes`, `thumbs_up` or similar.
  There is exactly one integer, `rating`, with no description.
- **No subscriber count, anywhere.** The word "subscriber" does not occur in
  the 1.4 MB document. The only subscription data is
  `user/forumsubscribedthreads`, which lists the threads *you* follow, not
  who follows yours.
- `likes` and `dislikes` exist only on **posts** (`ForumPost`, returned by
  `forum/{id}/posts` and `user/forumposts`). `ForumFeedTypeEnum` lists
  "X liked your thread" (3) separately from "X liked your post" (5), which
  suggests a thread's thumbs and its opening post's likes are different
  counters. Nothing in the schema says so either way.

### Decision

| Asked for | Shown | Why |
|---|---|---|
| Thumbs up | **Dropped.** Shown as `rating` | Not in any thread object. `rating` is the only thread-level reaction figure Torn publishes. It is labelled with Torn's own word, `rating`, and never called "thumbs up" or "likes". Whether it equals up minus down is unverified; the QA line checks it and the label stays `rating` regardless. |
| Thumbs down | **Dropped** | Not in any thread object. Deriving it (for example up minus rating) would be a guess. |
| Subscribers | **Dropped, relabelled to `views`** | No subscriber figure exists in the API. `views` is a real, documented, per-thread figure in the same response, so the slot shows that instead, labelled `views`. |

The existing header note "N subscribed" is the number of threads *the user*
follows. The tracker never reuses or rephrases it.

**Split thumbs, rejected for this issue.** `user/forumposts`, which #2 also
fetches, returns `likes`, `dislikes` and `is_topic` for the user's newest 100
posts. The opening post of a thread could supply up and down counts, but (a)
whether a thread's thumbs are its opening post's likes is unverified, and the
feed enum suggests they are not, and (b) only threads whose opening post is
among the user's last 100 posts would be covered, so totals would be partial
by construction. Plan Task 0 records the live evidence; a follow-up issue can
add the split if it holds. Per-post likes via `forum/{id}/posts` are ruled out
by the issue itself.

### Verification level

The field **names and types** are verified against the published schema. The
**values** are not: no live response has been captured. Plan Task 0 (owner,
signed-in, shared with #2's Task 0) captures one redacted `user/forumthreads`
response into `tests/fixtures/user-forumthreads.json` and compares one
thread's `rating` and `views` with Torn's own thread page. Until then the
normaliser treats both fields as optional (below), so schema drift degrades to
"-" and never to a number.

**Side finding for #2.** The same schema confirms several of #2's "assumed,
unverified" fields: `forumThreads` is the list key, `posts` is a plain integer
on `user/forumthreads`, `last_poster` is nullable `{ id, username, karma }`,
`last_post_time` is nullable, `new_posts` exists (Minimal key, owner only),
and `ForumPost` has `thread_id`, `created_time`, `is_topic` and `content`.
Recorded here for #2's reviewer; this spec does not edit #2's documents.

## Request budget

**Zero new requests** once #2 has landed. The tracker reads `tfcc:mine`,
which #2's `refreshMine` fills from `user/forumthreads` (one page,
`limit=100`) whenever My posts opens past its 15-minute TTL or the user
presses Refresh in My posts. `rating` and `views` are already in that answer;
this design only stops throwing them away.

| Action | Requests (defaults) | Change |
|---|---|---|
| Threads refresh | <= 13 | none |
| My posts fetch | <= 12 | none |
| Tracker | 0 | new, free |

The limiter (40 per rolling minute) is untouched. The consequence of reusing
the fetch: the tracker shows "-" until the user has opened My posts once, and
its figures are as old as the last My posts fetch. That is stated in the
tooltip and in Settings, and tapping the tracker opens My posts, which fetches.

**Settings text.** One sentence is appended to #2's budget note under
"Activity lookups per refresh", pinned by a test:

> The rating and views under the title come from the same answer as My posts
> and make no request of their own.

If this merges before #2 (see "Merge order"), the interim sentence is:

> Tapping the rating and views under the title loads the threads you started:
> one request, at most once every 15 minutes.

## Storage

No new key. `tfcc:mine` thread records (shape owned by #2) gain three
**optional** fields:

```
reactAt: ms     // when rating/views were last observed; present only if one of them is
rating:  int    // Torn's rating, may be negative; present only if Torn sent a number
views:   int    // >= 0; present only if Torn sent a number
```

**Optional, not defaulted, on purpose.** `loadKey` reports a key as damaged
whenever `JSON.stringify(raw) !== JSON.stringify(normalised)`. If
`normaliseMineThread` added `rating: 0` to records written before this
feature, every user upgrading from a release that carried #2 alone would be
told "My posts list were damaged and have been reset". Absent fields stay
absent, and absent means unknown, which is also the honest reading. The field
order is canonical (`reactAt`, `rating`, `views`, after #2's fields), and
`applyReactions` deletes and re-adds all three so a record observed twice
serialises the same way the normaliser would.

- **Why #8's helper does not cover this.** #8's plan adds
  `isRecoveredValue(raw, value)`, which forgives absent **top-level** keys
  before the comparison (spec "The upgrade trap",
  `2026-10-08-auto-hide-on-open-design.md`). These fields are nested: each
  sits on a thread record inside `tfcc:mine.threads[]`, where #8 keeps the
  strict comparison. So this design does not rely on #8 at all, in either
  merge order: the normaliser never adds a field the stored record did not
  have, and an older blob round-trips byte for byte. A storage test pins it
  (an older blob loads with `recovered === false`), and a mutation that makes
  the normaliser always emit the fields must fail that test.
- **No top-level field is added** to `tfcc:mine`, `tfcc:settings` or
  `tfcc:feed`. There is no new setting (no toggle) for the same reason.
- **Coordination with #2.** If #2 has not merged when this is built, the
  three optional fields can equally be folded into #2's `normaliseMineThread`
  before #2 first ships; the rule (optional, canonical order, absent means
  unknown) is the same either way, and the storage test travels with them.
- `rating` and `views` are read with `typeof === 'number'`. A missing, null or
  string value is **unknown**, never 0. (`toInt(null, 0)` is 0, which is
  exactly the trap.)
- When a later answer omits **both** figures for a thread, the record keeps
  its previous values and its older `reactAt`, so they age into "stale"
  rather than vanishing or zeroing. When it omits **one**, that one becomes
  unknown (`-`) and the other is refreshed: one `reactAt` cannot honestly
  date two figures observed at different times.
- Not exported (`tfcc:mine` never is). Reset everything clears it with the
  rest of `tfcc:mine`.

Only `started` records count. A thread the user merely posted in may carry
`rating` from a lookup in a later change; the tracker ignores it.

## Engine (pure)

All in the engine section, all take `now` as an argument where time matters.

- `mineThreadFromApi(raw)` (from #2) additionally returns
  `rating: number | null` and `views: number | null`.
- `applyReactions(rec, apiRow, now)` writes `reactAt`, `rating`, `views` in
  canonical order when the API row carries at least one; otherwise leaves the
  record alone.
- `normaliseMineThread(raw)` (from #2) copies the three optional fields only
  when `reactAt > 0` and at least one figure is a finite number.
- `reactionTotals(mine, now, staleMs)` returns
  ```
  { state: 'unloaded' | 'empty' | 'missing' | 'known',
    started, rating, ratingThreads, views, viewsThreads, updatedAt, stale }
  ```
  - `unloaded`: no started records and `mine.fetchedAt === 0`.
  - `empty`: no started records and `fetchedAt > 0` (Torn says you started
    none).
  - `missing`: started records exist and none carries a figure.
  - `known`: otherwise. `rating` and `views` are sums over the started records
    that carry each (null when none does); `updatedAt` is the newest
    `reactAt`; `stale` is `now - updatedAt > staleMs`.
- `formatSigned(n)`: `+12`, `0`, `-3`, `+1.2k`, `-1.2k`.
- `reactionsTitle(totals, now, pageLimit, opener)`: the tooltip string
  (below). `opener` is the call to action, `Open My posts` by default.

`REACTIONS_STALE_MS = 24 h`. Not the 15-minute TTL: the tracker is read on
every view, but data arrives only when My posts is opened, so a 15-minute
threshold would mark it stale almost always and the cue would mean nothing.

## User-visible behaviour

### Placement, and #9

The header row today is: title (`margin-right: auto`), then "N new",
"N subscribed", Refresh, Expand or Shrink, Hide or Show, in one wrapping flex
row. #9 wants its earned badges in that row, directly after the title.

Options considered:

1. **In the header row, after the title.** Takes #9's spot. Rejected.
2. **In the header row, before "N new".** At Torn PDA widths the row already
   wraps; one more item pushes Refresh, Expand and Hide onto another line,
   which is displacing them. Rejected.
3. **Its own line directly under the header row** (`.tfcc-subhead`). Never
   competes with the buttons at any width, leaves the after-title spot wholly
   to #9, and reads as a subtitle to the panel. **Chosen.**

```
<div class="tfcc-head"> title [#9 badges] ... N new  N subscribed  Refresh Expand Hide </div>
<div class="tfcc-subhead"><button class="tfcc-reactions" ...>Your threads: +12 rating, 3.4k views</button></div>
```

**Contract with #9.** #9 owns everything inside `.tfcc-head` between the title
and the auto margin; this feature adds nothing to `.tfcc-head`. `.tfcc-subhead`
is a wrapping flex row that this feature owns; if #9 ever needs an overflow
line it may append to `.tfcc-subhead` after the tracker. Neither feature
changes `.tfcc-title`'s `margin-right: auto`; if #9 moves it onto its badge
container, the subhead is unaffected because it is a separate block.

### Collapsed, loading, no key

- **Collapsed: hidden.** Collapsed is the "out of my way" one-line state, the
  tracker is not urgent, and its tap target (My posts) is not reachable while
  collapsed. #9's badges stay visible when collapsed; that is #9's call and
  does not involve the subhead. `panelHtml` emits the subhead *after* the
  `if (model.collapsed) return` line.
- **Loading shell and fatal shell:** not shown (they return before it).
- **No key:** not shown; nothing could ever fill it.
- **`empty` (you started no threads):** not shown. A tracker of nothing is
  noise, and it is not an unknown.

### The four states

| State | Visible text | Tooltip (`title`) |
|---|---|---|
| `unloaded` | `Your threads: - rating, - views` | `Not loaded yet. Open My posts to load the threads you started.` |
| `missing` | `Your threads: - rating, - views` | `Torn's answer did not include a rating or view count for your threads.` |
| `known` | `Your threads: +12 rating, 3.4k views` | `Torn's rating and view count, summed across 7 threads you started. Updated 5m ago.` |
| `known`, stale | `Your threads: +12 rating, 3.4k views (3d ago)` | same, plus ` Open My posts to update.` |

- A figure that is unknown while the other is known shows `-` alone, for
  example `+12 rating, - views`.
- Partial coverage adds `M of N` to the tooltip: "summed across 5 of 7
  threads you started".
- When `started >= MINE_PAGE_LIMIT` (100) the tooltip adds: "Torn sends your
  newest 100 threads per request; older ones keep the figures from when they
  were last seen."
- **Never 0 for unknown.** A known total of zero renders `0`; an unknown one
  renders `-`. A known negative renders `-3`, which a lone `-` cannot be
  confused with because a figure always has digits.
- **Stale is not colour alone.** The visible `(3d ago)` suffix is the cue; the
  muted style is decoration.
- **Touch.** Torn PDA does not show `title` tooltips. On touch the
  explanation is one tap away: the tracker opens My posts, whose context line
  already says when it was updated. The `aria-label` carries the same words as
  the tooltip so a screen reader is not left with a bare "-".

### Tap

`<button type="button" class="tfcc-reactions" data-act="view" data-view="mine">`.
It reuses the existing `view` handler, so no new handler is added. Opening My
posts runs #2's TTL check, which is the only fetch.

### Per-thread breakdown

Totals only in the tracker, no hover list (a tooltip cannot hold 100 rows,
and PDA has no hover). The breakdown is My posts itself: a row whose
`mineRole === 'started'` and whose record carries a figure gets one meta
span, `rating +3, 120 views` (unknown parts shown as `-`). `mergeThreads`
copies `rating` and `views` (null when absent) onto the row. Sorting by rating
is out of scope.

### Look

```
#tfcc-panel .tfcc-subhead          flex, wrap, gap sm, margin-bottom gap
#tfcc-panel button.tfcc-reactions  pill: text-sm, padding 0 8px, radius 10px,
                                   background --tm-bg-3, color --tm-meta,
                                   border 1px --tm-border, white-space normal,
                                   text-align left, max-width 100%
#tfcc-panel button.tfcc-reactions:hover   background --tm-hover
#tfcc-panel .tfcc-rx               color --tm-text, bold, tabular-nums
```

`button.tfcc-reactions` is (1,1,1) and declared after the generic
`#tfcc-panel button` (1,0,1), so it wins; `:hover` is (1,2,1) and beats the
generic `button:hover` (1,1,1). Only existing tokens are used, so the theme
blocks and `tests/style.test.js`'s "every custom property is defined" need no
new token. `white-space: normal` lets the line wrap inside the pill at 320 px
rather than overflow. The contrast audit (`node tests/render-preview.mjs &&
node tests/contrast-audit.mjs`) must print OK; the preview seeds three started
threads with figures.

## Failure and edge cases

| Condition | Result |
|---|---|
| My posts never opened | `unloaded`, `-`, tooltip says open My posts |
| My posts fetch failed | Tracker keeps the last figures with their age; #2's error shows in My posts only |
| Torn drops `rating` from the schema | New records have no `rating`; old ones keep theirs and age to stale; once none remain, `-` |
| `rating` arrives as null or a string | Unknown for that thread, never 0 |
| Old `tfcc:mine` with no reaction fields | Loads silently, `missing` until the next My posts fetch |
| User started 0 threads | Tracker hidden |
| More than 100 started threads | Totals over the records held (up to #2's 200 cap); tooltip says so |
| Reset everything | `tfcc:mine` cleared, `unloaded` |
| Clear key | Tracker hidden (no key) |

## Security and constraints

- **Engine purity:** `applyReactions`, `reactionTotals`, `formatSigned`,
  `reactionsTitle` are pure; `now` is an argument. `tests/purity.test.js`
  covers them unchanged.
- **Read-only, no new request, no new endpoint.** `@match`, `@grant`,
  `@connect` unchanged.
- **ADR 0001:** no DOM data path; the subhead is rendered inside the existing
  mount, not read from Torn.
- **API key:** not touched. Nothing new is logged.
- **ASCII only:** no emoji thumbs; text labels. All strings above are ASCII;
  `Torn\'s` is escaped in single-quoted source.
- **Debug report:** one count, `my posts rated: N` (started records with a
  figure). No totals, no titles.

## Merge order

### #2 first (preferred)

The plan's Tasks 1 to 8 apply as written on top of #2: they extend
`mineThreadFromApi`, `normaliseMineThread` and `mergeMineSnapshot`, read
`state.mine`, and append to #2's Settings note.

### This first

The tracker needs `tfcc:mine` and a fetch, and neither exists. This PR then
carries, verbatim and with #2's names, the parts of #2's plan it needs, plus
one interim fetch (plan section "If this merges first"):

1. #2's Task 1 `forumThreadsPayload` (plus `rating`, `views`) and #2's Task 2
   record in full (`STORAGE_KEYS.mine`, `MINE_MAX_THREADS`, `pickList`,
   `freshMine`, `freshMineThread`, `normaliseMineThread`, `normaliseMine`,
   `mineThreadFromApi`; not `minePostFromApi`), and #2's constants
   `MINE_TTL_MS` and `MINE_PAGE_LIMIT`.
2. A pure `mergeStartedReactions(prev, started, now)` in place of
   `mergeMineSnapshot`. It marks records `started`, sets title, forum,
   `lastPostAt`, `isLocked`, `selfId` and the reaction fields, and sets
   `fetchedAt`. It **never** sets `postsTotal`, `totalKnown` or
   `baselineTotal`, so #2's first-sight baseline still happens when #2 lands.
3. A runtime `refreshReactions(now)`: one `user/forumthreads` request with
   `limit=MINE_PAGE_LIMIT`, single-flight, generation-checked, skipped while
   `fetchedAt` is younger than `MINE_TTL_MS`, errors through `scrubDetail`
   into `state.mineError`. Triggered only by tapping the tracker
   (`data-act="reactions-load"`), never by refresh, auto refresh or page
   load. Budget: 1 request per tap, at most once per 15 minutes; worst minute
   13 + 1 = 14 of 40.
4. The interim Settings sentence, and `opener` `Tap here` in the tooltip.
5. The per-thread breakdown (plan Task 5) is skipped; there is no My posts
   view.

When #2 then merges, #2's PR does the reconciliation: keep the record code
already on `main` (add only `minePostFromApi`), call `applyReactions` from
`mergeMineSnapshot`'s started loop, delete `mergeStartedReactions`,
`refreshReactions`, `state.refreshingReactions`, the `reactions-load`
handler and `tests/reactions-refresh.test.js` and its mutation entry, switch
the tracker to `data-act="view" data-view="mine"`, switch the Settings
sentence, and do plan Task 5. A `fetchedAt` written by `refreshReactions`
only delays #2's first automatic fetch by at most 15 minutes, which Refresh
overrides.

## Testing strategy

- `tests/reactions.test.js` (new, engine): `mineThreadFromApi` reads
  `rating`/`views` and returns null for absent, null and string values;
  `applyReactions` order and keep-on-omission; normaliser round trip with and
  without the fields; `reactionTotals` for all four states, partial coverage,
  negative and zero totals, started-only, staleness boundary;
  `formatSigned`; `reactionsTitle` for each state.
- `tests/storage.test.js`: a `tfcc:mine` record without reaction fields, and
  one with views only then rating observed, both load with `recovered:
  false`.
- `tests/panel.test.js`: subhead after `.tfcc-head`, not inside it; hidden
  when collapsed, without a key, and when `empty`; `-` and never `0` for
  unknown; stale suffix; tap target is `data-act="view" data-view="mine"`;
  Settings sentence; My posts row meta.
- `tests/style.test.js`: the three rules exist, `white-space: normal`, no
  rule targets `.tfcc-head .tfcc-reactions`.
- `tests/handlers.test.js`: the tracker's action is handled (the existing
  "every rendered action is handled" test covers it once the tracker renders
  in its fixture).
- `tests/debug-report.test.js`: `my posts rated` count; no rating totals.

Mutation-check entries (`tests/mutation-check.mjs`):

| Mutation | Suite that must fail |
|---|---|
| a missing `rating` reads as 0 | `tests/reactions.test.js` |
| `reactionTotals` calls a figureless list `known` | `tests/reactions.test.js` |
| posted-in threads are counted | `tests/reactions.test.js` |
| staleness never fires | `tests/reactions.test.js` |
| the normaliser always emits the reaction fields | `tests/storage.test.js` |
| an unknown figure renders 0 | `tests/panel.test.js` |
| the tracker renders while collapsed | `tests/panel.test.js` |
| the Settings sentence is dropped | `tests/panel.test.js` |

## QA checklist additions

New section "Reactions tracker", Torn PDA and desktop:

- [ ] Before opening My posts on a fresh install, the line under the header
      reads `Your threads: - rating, - views`, never 0.
- [ ] Open My posts; the line fills in. API key log: no request beyond My
      posts' own.
- [ ] Pick one thread you started; open it on Torn. Write down Torn's thumbs
      up, thumbs down and views, and the panel's `rating` and `views` for it
      in My posts. Record whether rating = up - down. The label stays
      `rating` either way.
- [ ] Sum check: the tracker's totals equal the sum of the My posts row
      figures for started threads.
- [ ] Refresh, Expand and Hide stay on the header row at the narrowest PDA
      width, portrait and landscape; the tracker wraps inside its own line.
- [ ] Collapse: the tracker is gone; Show brings it back.
- [ ] Tapping the tracker opens My posts.
- [ ] Dark, Light and Match Torn: the pill is readable in all three.
- [ ] After a day without opening My posts, the line shows `(1d ago)`.

## Assumptions

1. #2 lands with the record and function names in its plan
   (`mineThreadFromApi`, `normaliseMineThread`, `mergeMineSnapshot`,
   `freshMine`, `freshMineThread`, `MINE_PAGE_LIMIT`, `MINE_TTL_MS`,
   `state.mine`, `renderRow` meta for `mineRole`). If #2 renames any, this
   plan follows the rename.
2. `rating` and `views` are present in the live `user/forumthreads` answer as
   the schema says. If not, the tracker shows `-` and nothing breaks.
3. A thread's `rating` can be negative. The int32 type allows it and the
   formatter handles it.
4. The user's newest 100 started threads (plus up to 200 retained records)
   are enough for a "how are my threads received" total.
5. 24 hours is a sensible "this is old" threshold for figures that update
   only when My posts opens.

## Open questions

1. **What `rating` means.** Up minus down, up only, or something else? Task 0
   and the QA line answer it; the label does not depend on it.
2. **Split thumbs.** Does an opening post's `likes`/`dislikes` equal the
   thread's thumbs on Torn's page? If yes, a follow-up issue can show up and
   down for covered threads from `user/forumposts` at no request cost.
3. **Does `views` count the owner's own opens?** Informational only.
4. **Sort by rating in My posts?** Deferred; not asked for.
