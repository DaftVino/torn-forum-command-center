# Thread reactions tracker - design

**Status:** proposed, 2026-10-08, revised the same day (thumbs from the topic
post; forum karma added). Awaiting `/plan-eng-review`.
**Issue:** #10. Depends on #2 (My posts, PR #5) for its data and its action.
Shares the panel header with #9 (badges).
**Target release:** whichever minor release first carries both #2 and this.
The feature PR does not bump the version; see plan Task 10.
**Plan:** `docs/superpowers/plans/2026-10-08-thread-reactions-tracker.md`.

## Goal

A player who starts threads has no quick view of how they are received. This
adds one small line to the panel, directly under the header row, totalling
the thumbs up and thumbs down on the threads the key owner started:

> Your threads: **34** up, **5** down

Tapping it opens My posts, where each thread you started shows its own
counts. Subscribers cannot be shown: Torn's API does not publish them (below),
and the tooltip says so.

The same line also shows the key owner's **forum karma** after the thumbs, as
an endless-knot icon and a number, never the word: `34 up, 5 down [knot] 1,208`
(see "Forum karma").

## The data question

### Source

Torn's published OpenAPI document, `https://www.torn.com/swagger/openapi.json`,
`openapi: 3.1.0`, `info.version: 6.13.8`, fetched 2026-10-08 with an automated
request. The saved HTML docs in `docs/reference/` carry no response schemas,
and neither `rating`, `likes`, `dislikes` nor any subscriber field occurs in
that HTML or in `tests/`. The relevant paths, schemas and parameters are
committed unedited as
`docs/reference/torn-openapi-forum-excerpt-2026-10-08.json`.

### Thread objects: `user/forumthreads`

`GET /user/forumthreads`, Public key, `x-stability: Stable`, parameters
`limit` (default 20, maximum 100), `sort`, `from`, `to`. Response
`{ forumThreads: ForumThreadUserExtended[], _metadata }`.
`ForumThreadBase` requires exactly: `id`, `title`, `forum_id`, `posts`,
**`rating`** (int32, **no description**), `views` (int32, "Total number of
times players have opened this thread."), `author`, `last_poster`,
`first_post_time`, `last_post_time`, `has_poll`, `is_locked`, `is_sticky`;
the extended form adds `new_posts`.

No thread schema (`ForumThreadBase`, `ForumThreadExtended`,
`ForumThreadUserExtended`, `ForumSubscribedThread`) has `likes`, `dislikes`
or any thumbs field.

### Post objects: `forum/{threadId}/posts`

`GET /forum/{threadId}/posts`, "Get specific forum thread posts", Public key,
`x-stability: Stable`. Description (HTML line breaks omitted): "Returns 20 posts per page for a
specific thread. By default, it uses 'offset', but it's possible to filter
posts with 'from' & 'to' parameters." Parameters:

| Parameter | Schema | Note |
|---|---|---|
| `offset` | `ApiOffsetNoDefault`: int32, minimum 0, **no default** | |
| `sort` | `ApiSort`: enum `DESC`, `ASC`, **no default**, described "Sorted by the greatest timestamps" | |
| `from`, `to` | int32 timestamps | switches from offset paging to a time filter |
| `striptags` | `ApiStripTagsTrue` | affects `content` only |

There is **no `limit`**: a page is 20 posts. Response
`ForumPostsResponse = { posts: ForumPost[], _metadata: { links: { next, prev } } }`.

`ForumPost` requires `id`, `thread_id`, `author`, `is_legacy`,
**`is_topic`** (boolean), `is_edited`, `is_pinned`, `created_time`,
`edited_by`, `has_quote`, `quoted_post_id`, `content`, **`likes`** (int32),
**`dislikes`** (int32).

### What is verified, and what is not

| Claim | Status |
|---|---|
| `forum/{id}/posts` exists, Public, 20 per page, `offset` and `sort` accepted | **Verified** (schema) |
| Posts carry `is_topic`, `likes`, `dislikes` | **Verified** (schema) |
| `sort=ASC&offset=0` puts the thread's oldest post first, so the topic post is on page one | **Unverified.** The schema gives `sort` no default and describes it only as "sorted by the greatest timestamps"; it does not say whether `sort` applies in offset mode. The topic post is by definition the oldest, so if `ASC` applies, it is first. Owner Task 0, step 3. |
| A pinned reply (`is_pinned`) does not displace the topic post from page one under `ASC` | **Unverified.** Task 0, step 3. Even if it did, a page holds 20 posts and only one is pinned, so the topic would still be on page one. |
| The topic post's `likes` / `dislikes` are the thumbs Torn shows for the thread | **Unverified.** `ForumFeedTypeEnum` lists "X liked your thread" (3) and "X liked your post" (5) separately, which could mean two counters. Task 0, step 4 compares them with Torn's thread page. **Stop condition:** if they differ, the thumbs path is wrong and the spec is amended before Task 5. |
| `rating` = likes - dislikes of the topic post | **Unverified**, plausible. Task 0, step 4. The label is "net" either way, and the code never derives up or down from it. |
| `rating` and `views` present in the live `user/forumthreads` answer | **Verified in schema, values unverified.** Task 0, steps 1 to 2. |
| `ForumThreadAuthor.karma` (required int32) on every thread and post row; `user/profile` returns `profile.karma` (int32, Public key) | **Verified** (schema v6.13.8, both in the excerpt). Values unverified: Task 0, steps 1 and 6. |
| `karma` means net likes on the owner's forum posts | **Unverified.** The schema has no description. The tooltip states it as Torn's report; Task 0, step 6 compares it with the owner's profile. |

Every unverified field is read defensively: a value that is not a finite
number is unknown, a page without an `is_topic` post is "not found", and both
render as `-` or fall back to net, never as 0.

### Subscribers: cannot be met

The word "subscriber" occurs once in the 1.4 MB document, as a value of
`UserDonatorStatusEnum` (a Torn donator tier, unrelated to forums); no forum
schema has a subscriber field. The only subscription data is `user/forumsubscribedthreads`, the threads *you* follow.
No endpoint says who follows yours. **This part of the issue cannot be met
from the API**, and the script will not scrape it (ADR 0001). The tracker
shows no subscriber figure, and its tooltip ends with: "Torn's API has no
subscriber count, so none is shown." The existing header note "N subscribed"
is the number of threads the user follows; the tracker never reuses or
rephrases it.

### Views: dropped

`views` is free (same answer as `rating`) and documented, but it was not asked
for, it does not answer "how are my threads received", and a third figure
crowds a line that must fit a 320 px PDA screen. Dropped; a later issue can
add it in one line. It is not stored.

## Forum karma

### Source of the figure

`ForumThreadAuthor` (in the excerpt) requires `id`, `username` and **`karma`**
(int32, **no description**). It is the `author` on `user/forumthreads`,
`user/forumposts`, `forum/{id}/posts`, `forum/{id}/thread`,
`user/forumsubscribedthreads` and `user/forumfeed`. `user/profile` (Public key)
returns `profile.karma` (int32). Both are in the excerpt.

On `user/forumthreads` and `user/forumposts` the `author` is the key owner by
construction, so the figure is free:

1. **At zero extra requests.** From the `user/forumthreads` rows My posts
   already fetches (#2), take `author.karma` from the **newest** row (greatest
   `first_post_time`). If that list is empty, take it from the newest
   `user/forumposts` row (greatest `created_time`) when #2 fetches that list. A
   row counts only if `author.karma` is a finite number and, when the snapshot
   knows `selfId`, `author.id === selfId`. Store it as `karma` and `karmaAt` on
   `tfcc:mine` (see "Storage").
2. **Fallback, one request.** Only when the My posts run got **both** lists
   successfully and **both are empty** (no threads started, no posts), and
   `karmaAt` is absent or older than `KARMA_TTL_MS` (12 h), read `user/profile`
   once and take `profile.karma`. It runs inside `refreshMine` only, never in
   `refreshAll`, auto refresh or page load. If either list failed, nothing is
   known and no fallback is attempted. A user who has posts whose rows lack a
   numeric `karma` shows `-`; the fallback is not widened to cover schema drift.
3. **Cache.** `karma` is kept until replaced. A free sighting replaces it on
   every My posts run; a fallback reading is reused for 12 hours, so the
   profile is read at most twice a day.

### What it means: unverified

The API documents nothing about `karma`: the schema gives a type and no
description. The tooltip says "Net likes on your forum posts, as reported by
Torn." That is the owner's reading of Torn's forum karma, **not** something the
document states. Owner Task 0 step 6 compares the tracker's figure with the
karma on the owner's own Torn profile. If they differ, the tooltip sentence is
reworded to "Your forum karma, as reported by Torn." and nothing else changes,
because the code only displays the integer and derives nothing from it.

### Unknown is `-`, never 0

No row, no fallback yet, a non-numeric value, or a throttled or failed
`user/profile` read all leave `karma` absent, and it renders `-`. A real zero
renders `0`. Negative karma renders with a leading `-` and digits (`-12`),
which cannot be confused with a lone `-`.

### The icon

The owner supplied `D:\Downloads\karma-endless-knot.svg`; a copy is committed
unchanged as `docs/reference/karma-endless-knot.svg` (provenance in
`docs/reference/README.md`). It is one ASCII `<path>`, no script, no external
reference, `viewBox="149 50 702 900"`. The userscript carries it as an ASCII
string constant, `KARMA_ICON_SVG`, changed in these ways only:

- `fill="#000000"` becomes `fill="currentColor"`, so it follows the theme text
  colour in Dark, Light and Match Torn;
- the XML prolog, `<title>`, `<desc>`, `role`, `aria-labelledby` and `xmlns`
  are dropped (it is inline in HTML);
- `aria-hidden="true"` and `focusable="false"` are added;
- it is sized to the text, `style="height:1em;width:auto"` (the knot is taller
  than wide, so the width follows from the `viewBox`).

The containing element carries the meaning: `aria-label="Karma"` and
`title="Karma: <n>. Net likes on your forum posts, as reported by Torn."`. The
word "karma" is never visible text. The constant is the only unescaped markup
this figure injects; the number is escaped.

## Data plan

Two sources, both inside #2's My posts action:

1. **Net score, cheap.** `user/forumthreads` (one request #2 already makes)
   carries `rating` for every started thread. Stored per thread as
   `reactAt` + `rating`. Used only as a **labelled fallback**, "net +12",
   until that thread's topic post has been read.
2. **Thumbs, one lookup per thread.** For a started thread whose topic data is
   missing or older than `TOPIC_TTL_MS`, request
   `forum/{id}/posts?sort=ASC&offset=0` and take the post with
   `is_topic === true` (and, if present, `thread_id` equal to the thread).
   Its `likes` and `dislikes` are stored as `up` and `down` with `topicAt`. A
   page with no such post, or with non-numeric counts, stamps `topicAt` with
   no `up`/`down` ("checked, not found"): the thread keeps showing net and is
   retried after the TTL. A response whose shape is unrecognised stamps
   nothing and is retried next run. Post `content` is never read.

The request parameters live in one constant,
`TOPIC_POST_PARAMS = { sort: 'ASC', offset: 0 }`, so if Task 0 shows `ASC` is
ignored in offset mode, the fix is one line (the alternative, `to` set to the
thread's `first_post_time`, filters to the opening post by time; it needs the
list's `first_post_time`, which #2 does not yet store, so it is the fallback,
not the default).

**No double fetch.** #2's lookups (`forum/{id}/thread`) target threads that
are **not** started (a started thread's list row already carries its total and
last post time, so `mineLookupTargets` skips it). These lookups target
**only** started threads, on a different endpoint. Deep search's
`forum/{id}/posts` pages and #4's `from`-filtered page are separate,
user-initiated or differently parameterised actions over subscribed threads;
nothing is shared or repeated within one action.

## Request budget

### When lookups run

Only inside #2's `refreshMine`: when My posts opens past its 15-minute TTL,
or the user presses Refresh while My posts is open. Never in `refreshAll`,
auto refresh or page load, so **the default refresh stays at most 13**.

### The bound: a fixed slice of the user's lookup setting

Per run, at most `min(REACTION_LOOKUPS_PER_RUN, enrichBudget)` topic lookups,
with `REACTION_LOOKUPS_PER_RUN = 5`. They run **after** #2's lookups.

Why not simply share `enrichBudget` with #2's lookups: #2 re-checks every
unsubscribed posted-in thread whose info is older than 15 minutes, so for any
active poster its lookups use the whole budget on every run and the thumbs
would never start. Why not a fixed cap independent of the setting: a user who
set "Activity lookups per refresh" to 0 has said "no lookups", and that must
still mean exactly two requests for My posts (#2's own test pins it). So the
setting stays the user's single lookup dial, and the thumbs get a small,
separate slice of it.

Why 5: at defaults it keeps a Threads refresh plus a My posts run at 30 of 40,
leaving 10 for an auto refresh or a search in the same minute; and with a
12-hour TTL, a player with 20 threads is fully covered after four My posts
runs, during which every uncovered thread already shows its net score.

### The TTL: 12 hours

`TOPIC_TTL_MS = 12 h`. Thumbs on a thread change slowly and nobody needs them
to the minute. At 12 hours, a player who opens My posts morning and evening
sees same-day figures, and a steady-state run costs `ceil(started / 5)` runs
per half day, not per open. The order is: never-checked threads first, newest
activity first; then the oldest `topicAt`.

### The numbers

| Action | Defaults (`enrichBudget` 10) | `enrichBudget` 0 | Max (`enrichBudget` 25) |
|---|---|---|---|
| Threads refresh (unchanged) | <= 13 | 3 | <= 28 |
| My posts run (#2: 2 lists + lookups) | 12 | 2 | 27 |
| + topic lookups | + 5 | + 0 | + 5 |
| **My posts run, total** | **<= 17** | **2** | **<= 32** |

**Worst minute, limiter 40 per rolling 60 s:**

- **Defaults:** a Threads refresh then a My posts run, back to back:
  13 + 17 = **30 of 40**. Neither is throttled.
- **Defaults plus an auto refresh** landing in the same minute: 30 + 13 = 43.
  The limiter refuses the 41st to 43rd; whichever action is last stops early,
  exactly as `enrichThreads` does today. The minute never holds more than 40.
- **Max setting:** Threads 28, then My posts: lists are requests 29 and 30,
  #2's lookups 31 to 40, #2's 11th lookup is refused (`throttled`) and
  `refreshMine` stops. **Topic lookups do not start after a throttle**, so
  they make 0 requests that minute. Total **40 of 40**, never 41.
- **My posts alone at max:** 32 of 40.
- **Refresh pressed repeatedly in My posts:** single flight prevents overlap;
  sequential presses each cost at most 17 at defaults, and the 12-hour TTL
  means a press only fetches threads not yet covered.

The limiter, not the arithmetic, is the guarantee; the refresh test proves it
with a counting transport.

### The karma fallback

The free path (the `author` on rows already fetched) adds no request. The
fallback adds **one** `user/profile` request, and only in a My posts run where
both lists came back empty. Such a run has no posted-in threads to look up and
no started threads to read, so it is exactly `user/forumthreads` +
`user/forumposts` + `user/profile` = **3 requests**, at every `enrichBudget`
setting, at most once per `KARMA_TTL_MS`. It replaces the run above, never adds
to it: a run with any thread or post makes no profile request.

| Action | Defaults | `enrichBudget` 0 | Max (25) |
|---|---|---|---|
| Threads refresh (unchanged) | <= 13 | 3 | <= 28 |
| My posts run, with threads or posts | <= 17 | 2 | <= 32 |
| My posts run, no threads and no posts (fallback) | 3 | 3 | 3 |

**Worst minute is unchanged: 30 of 40 at defaults (13 + 17) and 40 of 40 at the
largest setting**, because the fallback run (3) is smaller than the runs it
stands in for. A Threads refresh then a fallback run is 16 at defaults and 31 at
the maximum. The default refresh stays at 13 or fewer because `user/profile` is
never called from `refreshAll`. The profile request passes through the same
limiter as every other request, so no sequence can put a 41st in a minute. In
the interim "This first" path the tap reads `user/forumthreads` only and has no
posts list, so the fallback fires when no thread was started: at most 2 per tap
with no threads, and still at most 6 with threads at defaults.

### Settings text

#2's note gains the thumbs numbers and one sentence, pinned by a test that
reads every number from the constants:

> A refresh of Threads makes two requests, plus one for the forum list at most
> once a day. Opening My posts, or refreshing while it is open, makes two
> requests of its own, at most once every 15 minutes unless you press Refresh.
> Each activity lookup adds one more to either, and only runs for a thread with
> no recent time. My posts also reads the opening post of up to 5 threads you
> started, for their thumbs up and down, each at most once every 12 hours; with
> lookups set to 0 it reads none. If you have started no threads and written no
> posts, My posts instead reads your profile once for your forum karma, at most
> once every 12 hours, which is 3 requests in all. With the default of 10, a
> Threads refresh is at most 13 requests and My posts at most 17; at the largest
> setting of 25, 28 and 32. The script keeps itself under 40 requests a minute
> regardless.

## Storage

No new key. `tfcc:mine` thread records (shape owned by #2) gain five
**optional** fields, always in this order, after #2's fields:

```
reactAt: ms    // when rating was last observed; present only with rating
rating:  int   // Torn's net rating from user/forumthreads; may be negative
topicAt: ms    // when the topic post was last checked; present after any check
up:      int   // topic post likes, >= 0; present only with down, only if found
down:    int   // topic post dislikes, >= 0
```

`topicAt` without `up`/`down` means "checked, no usable topic post"; the
thread falls back to `rating`.

`tfcc:mine` itself gains two **optional top-level** fields, after its existing
top-level keys, in this order:

```
karma:   int   // the key owner's forum karma; may be negative or 0
karmaAt: ms    // when it was last seen; present only with karma
```

They follow the same rule as the record fields: the normaliser keeps `karma`
only with `karmaAt > 0`, drops a half pair, and **never adds either when the
stored blob lacked them**, so a blob written before this feature round-trips
byte for byte. One writer, `setKarma(snap, karma, now)`, sets both together.
Karma is never back-filled and never guessed.

### Upgrade safety

`loadKey` reports a key as damaged whenever
`JSON.stringify(raw) !== JSON.stringify(normalised)`, and `loadAll` then
tells the user it was reset. #8's plan adds `isRecoveredValue(raw, value)`,
which forgives absent **top-level** keys only
(`2026-10-08-auto-hide-on-open-design.md`, "The upgrade trap"). These five
fields are **nested**, on records inside `tfcc:mine.threads[]`, where #8 keeps
the strict comparison. So this design does not rely on #8 in either merge
order:

- **Absent stays absent.** `normaliseMineThread` never adds a field the stored
  record lacked, so a record written before this feature round-trips byte for
  byte, and absent means unknown, which is also the honest reading.
- **Canonical order.** Every write goes through one helper,
  `setReactionFields(rec, changes)`, which removes all five and re-adds the
  present ones in the fixed order. So a record that got its rating first and
  its thumbs later (or the reverse) serialises exactly as the normaliser
  writes it.
- **Pairs.** The normaliser keeps `rating` only with `reactAt > 0`, and `up`
  and `down` only together and only with `topicAt > 0`; a half pair is
  dropped. The writers never produce a half pair, so no writer output is ever
  "damaged".
- **Top-level `karma`/`karmaAt`** are the only top-level additions, to
  `tfcc:mine` alone. They are absent-stays-absent, so the strict whole-blob
  comparison in `loadKey` is satisfied without #8's `isRecoveredValue` in
  either merge order. `tfcc:settings` and `tfcc:feed` gain nothing. There is no
  new setting.
- **Tests:** an older blob loads with `recovered === false`; a record that
  gained rating then thumbs, one that gained thumbs then rating, and one
  checked-not-found all reload with `recovered === false`. A mutation that
  makes the normaliser always emit `topicAt` must fail the first test. A blob
  with no `karma` loads with `recovered === false` and still has no `karma`
  after a round trip; a blob with the pair reloads unchanged; a half pair
  (`karma` without `karmaAt`) is dropped.
- **Coordination with #2.** If #2 has not merged when this is built, the five
  fields can equally be folded into #2's `normaliseMineThread` before #2 first
  ships; the rules are the same and the tests travel with them.

Other storage rules: values are read with `typeof === 'number'` and
`isFinite` (`toInt(null, 0)` is 0, which is the trap); `tfcc:mine` is not
exported; Reset everything clears it.

## Engine (pure)

All in the engine section; time is an argument.

- `isReactionNumber(v, allowNegative) -> boolean`.
- `mineThreadFromApi(raw)` (#2) additionally returns `rating: number | null`.
- `setReactionFields(rec, changes) -> rec`, the only writer of the five
  fields.
- `applyReactions(rec, row, now)`: sets `reactAt` and `rating` when the row
  has a numeric `rating`; otherwise leaves the record alone, so an old rating
  ages into stale.
- `topicPostFromApi(data, threadId) -> { up, down } | null | undefined`:
  `undefined` for an unrecognised shape (no `posts` array), `null` for no
  usable topic post, otherwise the counts. Never reads `content`.
- `applyTopicPost(snap, threadId, topic, now) -> snap`: clone via
  `normaliseMine`, then `setReactionFields` with `topicAt` and `up`/`down`
  (cleared when `topic` is null).
- `reactionLookupTargets(snap, now, ttl, n) -> id[]`: started records with no
  `topicAt` or `now - topicAt >= ttl`; never-checked threads first (larger
  `lastPostAt` first), then checked threads oldest `topicAt` first; ties by
  larger id; at most `n`.
- `reactionTotals(mine, now, staleMs)`:
  ```
  { state: 'unloaded' | 'empty' | 'missing' | 'known',
    started, up, down, thumbThreads, net, netThreads, updatedAt, stale }
  ```
  Each started thread counts **once**: by thumbs if it has `up`/`down`,
  otherwise by `rating` as net, otherwise not at all. `up`, `down`, `net` are
  null when nothing contributed. `unloaded`: no started records and
  `fetchedAt === 0`. `empty`: no started records and `fetchedAt > 0`.
  `missing`: started records, none contributing. `known`: otherwise.
  `updatedAt` is the newest contributing `topicAt` or `reactAt`; `stale` is
  `now - updatedAt > staleMs`. The result also carries `karma` (number or
  `null`) whatever `state` is; karma has no staleness of its own.
- `formatSigned(n)`: `+12`, `0`, `-3`, `+1.2k`.
- `karmaFromAuthors(rows, timeField, selfId) -> number | null`: the
  `author.karma` of the row with the greatest `timeField`
  (`first_post_time` for threads, `created_time` for posts) whose karma passes
  `isReactionNumber(v, true)` and, when `selfId` is truthy, whose `author.id`
  equals it; `null` otherwise. Never reads another field of the row.
- `karmaFromProfile(data) -> number | null`: `data.profile.karma` through
  `isReactionNumber(v, true)`; `null` for any other shape.
- `setKarma(snap, karma, now) -> snap`: clone via `normaliseMine`, then set
  `karma` and `karmaAt` together, or neither when `karma` is not a number.
- `karmaFallbackDue(snap, now, ttl, threadRowCount, postRowCount) -> boolean`:
  true only when both counts are `0` (numbers, not `null`), and `karmaAt` is
  absent or `now - karmaAt >= ttl`.
- `formatKarma(n) -> string`: `-` for unknown, otherwise the integer with
  comma thousands separators (`1,208`, `-12`, `0`), pure (no `toLocaleString`,
  which reads the ambient locale).
- `reactionsTitle(totals, now, pageLimit, opener)`: the tooltip.

`REACTIONS_STALE_MS = 24 h` (the line is read on every view but data arrives
only from My posts, so a shorter threshold would mark it stale nearly always).

## User-visible behaviour

### Placement, and #9

The header row today: title (`margin-right: auto`), "N new", "N subscribed",
Refresh, Expand or Shrink, Hide or Show, in one wrapping flex row. #9 wants
its badges directly after the title.

1. In the header row after the title: takes #9's spot. Rejected.
2. In the header row before "N new": at PDA widths it pushes Refresh, Expand
   and Hide onto another line. Rejected.
3. **Its own line directly under the header row** (`.tfcc-subhead`). Never
   competes with the buttons, leaves the after-title spot to #9. **Chosen.**

**Contract with #9.** #9's spec (`2026-10-08-badges-design.md`, sections 8.2
and 9.5) splits `.tfcc-head` into `.tfcc-head-id` (title plus `.tfcc-chips`) and
`.tfcc-head-ctl`, and reserves the slot after its trophy chip for a #10 chip
with its own `data-shelf="reactions"`. **This design deliberately does not use
that slot**, for the reason in option 2 above: a figure line such as
`Your threads: 34 up, 5 down, net +3 on 4 more` does not fit a nowrap chip
(`max-width: 12em`) at 320 px, and a shelf for it would only repeat the
tooltip. So:

- #10 adds nothing to `.tfcc-head`, `.tfcc-head-id`, `.tfcc-chips` or
  `.tfcc-head-ctl`, never touches `.tfcc-title`, and adds no `state.shelf`
  value. #9 therefore never has a #10 chip to lay out: with badges off,
  `.tfcc-chips` is omitted, not "only #10's chip" (#9 section 9.5, third
  bullet, no longer applies; whichever PR merges second amends that sentence).
- `.tfcc-subhead` is emitted **immediately after the `.tfcc-head` block**
  (after #9's head, before any #9 shelf or toast), so the tracker keeps one
  position whether or not a shelf is open. `renderReactions` is the only
  producer of `.tfcc-subhead`. If #9 ever needs an overflow line it may append
  to `.tfcc-subhead` after the tracker.
- The collapsed rule differs on purpose: #9's chip stays visible when
  collapsed (it is local and free); the tracker does not (it needs a fetch
  and a tap target the collapsed bar does not have).
- The tests that pin placement slice the HTML from the `tfcc-head` opening tag
  to the `tfcc-subhead` tag, so they hold under either head structure.

### Visibility

Hidden when collapsed (the subhead is emitted after
`if (model.collapsed) return`; collapsed is the "out of my way" state and the
tap target is unreachable there; #9's badges are #9's call), in the loading
and fatal shells, without a key, and when Torn reports no started threads
(`empty`: a tracker of nothing is noise, and it is not unknown) **and karma is
unknown**. When there are no started threads but karma is known, the line shows
the karma figure alone (no "Your threads:" text), because a user with no
threads and no posts is exactly who the fallback serves and would otherwise
never see the figure it paid a request for.

### What it says

| Situation | Visible text |
|---|---|
| `unloaded` or `missing` | `Your threads: - up, - down` |
| every contributing thread has thumbs | `Your threads: 34 up, 5 down` |
| some thumbs, some net only | `Your threads: 34 up, 5 down, net +3 on 4 more` |
| net only so far | `Your threads: net +12` |
| any `known` and stale | the above plus ` (3d ago)` |

- **Karma follows the thumbs**, after the `down` figure (and after any `net`
  or age text) and a space, as the icon then the number:
  `Your threads: 34 up, 5 down [knot] 1,208`, `Your threads: - up, - down
  [knot] -`, or, with no started threads, `[knot] 1,208`. The word "karma" is
  not visible; it is the `aria-label="Karma"` on the containing
  `<span class="tfcc-karma">`. The span's `title` is
  `Karma: 1,208. Net likes on your forum posts, as reported by Torn.` (for
  unknown, `Karma: unknown. Net likes on ...`). The button's own `aria-label`
  also gains `Karma: 1,208.` or `Karma: unknown.` before the tooltip text.
- The **up and down figures are only ever sums of real topic-post counts.**
  Net is always labelled `net` and never split, added to, or subtracted from
  up or down.
- A known zero renders `0`; unknown renders `-`; a negative net renders
  `net -3`, never confusable with a lone `-`.
- Stale is not colour alone: the visible `(3d ago)` is the cue.

Tooltip (`title`, repeated in `aria-label` after the visible figures):

| State | Tooltip |
|---|---|
| `unloaded` | `Not loaded yet. Open My posts to load the threads you started. Torn's API has no subscriber count, so none is shown.` |
| `missing` | `Torn has not reported thumbs or a rating for your threads yet. Torn's API has no subscriber count, so none is shown.` |
| `known` | `Thumbs up and down from the opening post of 6 of 10 threads you started. 4 more show Torn's net rating until checked. Updated 5m ago. Torn's API has no subscriber count, so none is shown.` |
| `known`, net only | `Torn's net rating for 10 of 10 threads you started; thumbs up and down appear once their opening posts are checked. Updated 5m ago. Torn's API has no subscriber count, so none is shown.` |

The "N more" sentence appears only when `netThreads > 0`; " Open My posts to
update." is added when stale; when `started >= MINE_PAGE_LIMIT` (100) it adds
"Torn sends your newest 100 threads per request; older ones keep the figures
from when they were last seen." Torn PDA does not show `title` tooltips; on
touch the explanation is one tap away in My posts, and the `aria-label`
carries it for screen readers.

### Tap

`<button type="button" class="tfcc-reactions" data-act="view" data-view="mine">`,
the existing `view` handler. Opening My posts runs #2's TTL check, which is
the only fetch.

### Per-thread breakdown

My posts rows with `mineRole === 'started'` get one meta span:
`12 up, 3 down` when the topic was read, else `net +9` when only the rating
is known, else nothing. `mergeThreads` copies `up`, `down`, `rating` (null
when absent) onto rows. No hover list (a tooltip cannot hold 100 rows; PDA
has no hover). Sorting by thumbs is out of scope.

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

(1,1,1) beats the generic `#tfcc-panel button` (1,0,1); `:hover` at (1,2,1)
beats the generic `button:hover` (1,1,1). Existing tokens only. ASCII text
labels, no emoji. The knot icon is the one non-text mark: it is `currentColor`
so it takes the pill's `--tm-meta` colour, and
`#tfcc-panel .tfcc-karma` is `display: inline-flex; align-items: center;
gap: 0.25em; white-space: nowrap`. The contrast audit must print OK, and it
must check the icon colour (`--tm-meta` on `--tm-bg-3`) in Dark, Light and
Match Torn as it does for the text; the preview seeds
three started threads (two with thumbs, one net only).

## Failure and edge cases

| Condition | Result |
|---|---|
| My posts never opened | `unloaded`, `- up, - down` |
| Topic lookup throttled | Loop stops; remaining threads keep net or `-`; retried next run |
| Topic lookup fails (network, Torn error) | That thread unchanged; error not surfaced beyond #2's `mineError` reason; retried next run |
| Page has no `is_topic` post | `topicAt` stamped, no thumbs; net shown; retried after 12 h |
| `likes` null or a string | Treated as not found; never 0 |
| Response has no `posts` array | Nothing stamped; retried next run |
| Torn drops `rating` | Old ratings age to stale; once none remain and no thumbs, `missing` |
| Old `tfcc:mine` with none of the fields | Loads silently; `missing` until My posts runs |
| User started 0 threads, karma unknown | Hidden |
| User started 0 threads, karma known | The karma figure alone |
| No threads and no posts | My posts reads `user/profile` once (3 requests in all), at most every 12 h |
| `user/profile` throttled or failed | `karma` stays absent, shows `-`; retried next run |
| `karma` null, a string or missing on rows | Unknown, `-`, never 0; no fallback (posts exist) |
| A list failed | No fallback: emptiness is unknown |
| More than 100 started threads | Totals over the records held (#2's cap 200); tooltip says so |
| Reset everything mid-lookup | Generation check drops the late answer |
| Clear key | Hidden |

## Security and constraints

- Engine purity: every function above is pure; `tests/purity.test.js` covers
  them unchanged.
- Read-only: one more GET path on `api.torn.com`, already used by deep search
  (`forum/{id}/posts`). `@match`, `@grant`, `@connect` unchanged.
- ADR 0001: no DOM data path.
- API key: errors through `scrubDetail`; nothing new logged.
- Karma: `user/profile` is one more GET path on `api.torn.com`, same host, Public
  key, read-only; `@connect` unchanged. The profile answer is read for
  `profile.karma` only; no other profile field is read, stored or reported.
  `KARMA_ICON_SVG` is an ASCII constant with no script, no external reference
  and no event attribute, injected only as the markup of `.tfcc-karma`; a test
  pins it. The number goes through `escapeHtml`.
- Post `content`: never read, stored, rendered or reported; a test asserts no
  stored or reported string contains a fixture post body.
- ASCII only; `Torn\'s` escaped in single-quoted source.
- Debug report: counts only, `my posts thumbs checked: N` (started records
  with `topicAt`) and `my posts thumbs found: N` (with `up`). No totals, no
  titles, and no karma figure.

## Merge order

### #2 first (preferred)

The plan's Tasks 1 to 10 apply on top of #2: they extend `mineThreadFromApi`,
`normaliseMineThread`, `mergeMineSnapshot` and `refreshMine`, update #2's
Settings note and its request-count tests, and read `state.mine`.

### This first

The tracker needs `tfcc:mine` and a fetch. This PR then carries, verbatim and
with #2's names, the parts of #2 it needs, plus one interim action (plan,
"If this merges first"):

1. #2's `forumThreadsPayload`, and #2's Task 2 record in full except
   `minePostFromApi`, plus #2's constants `MINE_TTL_MS` and `MINE_PAGE_LIMIT`.
2. A pure `mergeStartedReactions(prev, started, now)` in place of
   `mergeMineSnapshot`: marks records `started`, sets title, forum,
   `lastPostAt`, `isLocked`, `selfId`, `rating`, and `fetchedAt`; never sets
   `postsTotal`, `totalKnown` or `baselineTotal`, so #2's first-sight baseline
   still happens when #2 lands.
3. A runtime `refreshReactions(now)`: one `user/forumthreads` request
   (`limit=MINE_PAGE_LIMIT`), then at most `min(5, enrichBudget)` topic
   lookups, single flight, generation checked, the list skipped while
   `fetchedAt` is younger than 15 minutes (topic lookups still follow the
   12-hour TTL). Triggered only by tapping the tracker
   (`data-act="reactions-load"`). Budget: at most 6 per tap at defaults;
   worst minute 13 + 6 = 19 of 40.
3a. The same runtime also reads `author.karma` from the `user/forumthreads` rows
   it fetches, and, when that list is empty (the only list it has), makes the
   one `user/profile` request (the karma fallback), at most once per 12 hours.
4. Interim Settings sentence: "Tapping the thumbs line under the title loads
   the threads you started (one request, at most once every 15 minutes) and
   reads the opening post of up to 5 of them, each at most once every 12
   hours." The tooltip opener becomes `Tap here`.
5. The per-thread breakdown (plan Task 7) is skipped; there is no My posts
   view.

When #2 then merges, #2's PR reconciles: keep the record code (add only
`minePostFromApi`), call `applyReactions` from `mergeMineSnapshot`'s started
loop, move the topic lookups into `refreshMine` (plan Task 5), delete
`mergeStartedReactions`, `refreshReactions`, `state.refreshingReactions`, the
`reactions-load` handler, `tests/reactions-refresh.test.js` and its mutation
entry, switch the tracker to `data-act="view" data-view="mine"` and the
default opener, switch the Settings note to the full text above, and do plan
Task 7. Stored `topicAt`/`up`/`down` carry over unchanged.

## Testing strategy

- `tests/reactions.test.js` (new, engine): `mineThreadFromApi` rating
  (absent, null, string, negative, zero); `setReactionFields` order in every
  write sequence; `applyReactions` keep-on-omission; `topicPostFromApi`
  (found, zero counts, not first in the list, no topic, wrong `thread_id`,
  null likes, no `posts` array, content never copied); `applyTopicPost`;
  `reactionLookupTargets` (TTL boundary, order, cap, started only, `n = 0`);
  `reactionTotals` (four states, thumbs-only, net-only, mixed, each thread
  counted once, posted-in ignored, staleness boundary); `formatSigned`;
  `reactionsTitle`.
- `tests/reactions-lookups.test.js` (new, runtime through `refreshMine` with
  the router transport): at most `min(5, enrichBudget)` `forum/{id}/posts`
  requests, each with `sort=ASC&offset=0`, only for started threads, after
  #2's lookups; none when the budget is 0; none within 12 h of a check; none
  after a throttle; `refreshAll` never requests `forum/{id}/posts` for a
  started thread; total requests at defaults <= 17; a late answer after Reset
  everything is dropped.
- `tests/karma.test.js` (new, engine and icon), each written failing first:
  karma is read from an owned `forumthreads` row (newest row, `selfId` guard,
  falls back to `forumposts` rows); karma is unknown and `formatKarma` and the
  panel show `-`, not `0`, while a real `0` shows `0`; `karmaFromProfile`
  shapes; `karmaFallbackDue` (true only for `0` and `0`, false for `null`
  counts, false within 12 h, true at the boundary); `setKarma` pair and order;
  `KARMA_ICON_SVG` is ASCII, contains `currentColor`, does not contain
  `#000000`, `<title>`, `<desc>`, `<script>`, `http` or `on...=`, and carries
  `aria-hidden="true"` and `focusable="false"`.
- `tests/karma-refresh.test.js` (new, runtime through `refreshMine` with the
  router transport): the fallback fires only when both lists are empty and
  `karmaAt` is stale, exactly one `user/profile` request, total 3; it does not
  fire when either list has a row, when a list failed, or within 12 h; it never
  fires in `refreshAll`, auto refresh or page load (counting transport, zero
  `user/profile` calls); a throttled profile read leaves `karma` absent.
- `tests/storage.test.js`: the four upgrade-safety round trips, plus the three
  karma round trips (absent stays absent, pair reloads, half pair dropped).
- `tests/panel.test.js`: placement, every visible form, `-` never `0`, stale
  suffix, visibility rules, tap target, subscriber sentence, Settings text,
  My posts row meta; the karma span has `aria-label="Karma"` and the `title`,
  and the word "karma" does not appear in the visible text (markup stripped,
  attributes removed); the karma-only line when no threads were started.
- `tests/style.test.js`: the rules, `white-space: normal`, nothing targets
  `.tfcc-head .tfcc-reactions`.
- `tests/debug-report.test.js`: the two counts; no totals; no post body.
- #2's suites that pin exact request sequences or totals
  (`tests/mine-refresh.test.js`, the Settings text test) are updated for the
  trailing topic lookups and the new numbers.

Mutation-check entries:

| Mutation | Suite that must fail |
|---|---|
| a missing rating reads as 0 | `tests/reactions.test.js` |
| a topic post's null likes read as 0 | `tests/reactions.test.js` |
| any post counts as the topic post | `tests/reactions.test.js` |
| a thread counts by both thumbs and net | `tests/reactions.test.js` |
| posted-in threads are counted | `tests/reactions.test.js` |
| staleness never fires | `tests/reactions.test.js` |
| the topic TTL is ignored | `tests/reactions.test.js` |
| the normaliser always emits `topicAt` | `tests/storage.test.js` |
| topic lookups ignore their cap | `tests/reactions-lookups.test.js` |
| topic lookups run after a throttle | `tests/reactions-lookups.test.js` |
| an unknown figure renders 0 | `tests/panel.test.js` |
| unknown karma renders 0 | `tests/karma.test.js` |
| the karma fallback runs in the default refresh | `tests/karma-refresh.test.js` |
| the karma fallback runs although a thread or post exists | `tests/karma-refresh.test.js` |
| the icon keeps `#000000` instead of `currentColor` | `tests/karma.test.js` |
| the tracker renders while collapsed | `tests/panel.test.js` |
| the subscriber sentence is dropped | `tests/panel.test.js` |

## QA checklist additions

New section "Reactions tracker", Torn PDA and desktop:

- [ ] Fresh install, before opening My posts: the line reads
      `Your threads: - up, - down`, never 0.
- [ ] Open My posts. API key log: at most 17 requests for that open, and the
      `forum/<id>/posts` ones are only for threads you started.
- [ ] Pick a thread you started with visible thumbs. On Torn's thread page
      note thumbs up, thumbs down. In My posts its row shows the same
      `N up, M down`. If they differ, stop: file it against the spec (Task 0
      stop condition).
- [ ] A thread not yet checked shows `net +N` in its row, and the tracker
      says `net ... on K more`.
- [ ] Sum check: tracker up and down equal the sums of the row figures.
- [ ] Reopen My posts within 12 hours: no `forum/<id>/posts` request for a
      thread already checked (key log).
- [ ] Hover (desktop): the tooltip ends with the subscriber sentence.
- [ ] Refresh, Expand and Hide stay on the header row at the narrowest PDA
      width, portrait and landscape; the tracker wraps in its own line.
- [ ] Collapse: the tracker is gone; Show brings it back.
- [ ] Tapping the tracker opens My posts.
- [ ] Dark, Light and Match Torn: readable in all three.
- [ ] After a day without opening My posts, the line shows `(1d ago)`.
- [ ] Karma: the endless-knot icon and a number follow the thumbs, with no word
      "karma" on screen. Before My posts has ever loaded it shows `-`, not 0.
- [ ] The icon takes the text colour in Dark, Light and Match Torn (visible,
      not black on dark).
- [ ] The karma figure equals the karma on your Torn profile (Task 0, step 6).
- [ ] A test account with no threads and no posts: opening My posts shows the
      karma alone, and the key log shows exactly 3 requests for that open
      (`user/profile` once); reopening within 12 hours shows no `user/profile`.
- [ ] A normal refresh of Threads makes no `user/profile` request.

## Release gate

Task 0 steps 3 and 4 are an owner gate on the release, not only on the code:
no release tag may carry this feature until the spec's "What is verified"
table records (a) that `sort=ASC&offset=0` puts the `is_topic` post first and
(b) that its `likes`/`dislikes` equal the thumbs on Torn's own thread page. The
QA checklist item "Pick a thread you started" repeats (b) on the released
build. Karma has no gate beyond its tooltip: Task 0 step 6 compares it with
the owner's profile, and a mismatch is a one-line wording change, not a block. If either fails, the thumbs half is amended or dropped, and the net
fallback is the only figure shown.

## Assumptions

1. #2 lands with the names in its plan (`mineThreadFromApi`,
   `normaliseMineThread`, `mergeMineSnapshot`, `refreshMine`, `enrichMine`
   returning `{ stoppedEarly: true }` on throttle, `pickList`, `freshMine`,
   `freshMineThread`, `MINE_PAGE_LIMIT`, `MINE_TTL_MS`, `state.mine`,
   `renderRow` meta for `mineRole`). If #2 renames any, this follows.
2. `sort=ASC&offset=0` returns the oldest posts first (Task 0).
3. The topic post's `likes`/`dislikes` are the thread's thumbs (Task 0; stop
   condition if not).
4. Net `rating` may be negative.
5. Five lookups per run and a 12-hour TTL are enough: uncovered threads show
   net meanwhile.
6. 24 hours is a sensible "old" threshold for the line.
7. `author.karma` on `user/forumthreads` and `user/forumposts` rows is the key
   owner's current karma, the same figure as `profile.karma` (Task 0, step 6).
8. The newest row's `author.karma` is as current as any other row's (Torn is
   assumed to report the owner's present karma on each, not a value frozen at
   post time). If Task 0 shows otherwise, take `user/profile` only.

## Open questions

1. What `rating` measures exactly (Task 0, step 4). Label is `net` regardless.
2. Does `sort` apply in offset mode? If not, switch `TOPIC_POST_PARAMS` to a
   `to` filter on `first_post_time` (needs #2 to store it).
3. Do legacy threads (`is_legacy` posts) carry `is_topic`? If not, they stay
   on net.
4. Should a thread whose last activity is newer than its `topicAt` be
   re-checked before the TTL? Deferred; it would raise the request rate.
5. Is `author.karma` the live figure or the value at post time? Assumption 8;
   Task 0 step 6 compares a thread row, a post row and the profile.
