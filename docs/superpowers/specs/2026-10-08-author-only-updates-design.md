# Only flag author updates - design

Issue: #4. Status: proposed, 2026-10-08.
Related: #2 (My posts view), #3 (row cap). ADR 0001 (no DOM data paths) governs.
Evidence: `docs/reference/torn-api-live-findings-2026-10-08.md` and the redacted
fixtures in `tests/fixtures/` (both from #14). Revised the same day to match
that live capture.

## Problem

A followed thread shows "37 new" when 36 of those posts are other players
talking. A user who follows a guide, a trade list or a faction announcement
cares only whether the author posted. This adds a global setting, **Only flag
new posts by the thread author**, default off.

## Current behaviour (verified)

Verified against `torn-forum-command-center.user.js` at `884f614` (line numbers
are from that commit; the code map may lag).

- **Unread model.** `unreadFor` (l.710) takes `apiRow.postsNew` (Torn's
  `posts.new` from `user/forumsubscribedthreads`, normalised by
  `normaliseSubscribedRow`, l.498) as `tornUnread`. `dismissed` is
  `postsTotal > 0 && lastSeenTotal >= postsTotal`; `unread` is `0` when
  dismissed, else `tornUnread`. The count covers posts by anyone. The script
  never learns who wrote them.
- **The "N new" badge.** `renderRow` (l.2616) prints `row.unread` as
  "N new". The header badge in `panelHtml` (l.2981) prints the sum of
  `row.unread` over all rows as "N new". The issue named only the row badge.
- **Other consumers of `row.unread`** (the issue did not list these, and each one
  changes meaning under the new setting): the `Unread only` toggle and
  archived-row visibility in `buildPanelModel` (l.2532-2533), the `is:unread`
  filter term (l.965), the `unread` sort in `sortThreads` (l.887), and the
  enrichment target selection in `refreshAll` (l.1968).
- **Mark read.** `markRead` (l.1236) sets `lastSeenTotal = max(old, postsTotal)`
  **and** `lastVisitedAt = max(old, now)`. The issue left out the second write.
  It matters here because `lastVisitedAt` is a last-activity candidate, and
  this design uses it as the read marker. Once anyone posts, `postsTotal` grows,
  the row stops being dismissed, and the badge shows Torn's full `posts.new`
  again. That part of the issue is correct.
- **Catch up.** `catchUpList` (l.911) keeps a row when it is not dismissed and
  either `unread > 0` or `lastActivity > lastCatchUpAt`. "Set catch-up point to
  now" (`catchup-done` handler, l.3404) sets `organizer.lastCatchUpAt = now`.
- **Last activity.** `resolveLastActivity` (l.728) takes the newest of the
  enriched `lastPostTimeCached` (source `enriched` or `enriched-stale`), the
  newest `user/forumfeed` row for the thread (`feed`), and `lastVisitedAt`
  (`visit`). Because `captureVisit` (l.2098) and `markRead` both write
  `lastVisitedAt`, opening a thread on Torn or pressing Mark read can put it
  into Catch up on its own if the row is not dismissed. The issue says this, and
  it is correct.
- **Enrichment.** `refreshAll` (l.1904) makes `user/forumsubscribedthreads`,
  then `user/forumfeed`, then `forum/categories` (only if the cache is older than
  `CATEGORY_TTL_MS`). It then calls `enrichThreads` (l.1991) for rows that are
  `subscribed && unread > 0 && activitySource !== 'enriched'`, up to
  `settings.enrichBudget` (default `DEFAULT_ENRICH_BUDGET = 10`, max 25). Each
  lookup is one `forum/{id}/thread` call. It reads `last_post_time`,
  `is_locked`, `is_sticky` and `title`, and nothing about the poster. So
  3 + 10 = 13 at most by default.
- **`fetchThread` is not enrichment.** It is the inner page loop of
  `runDeepSearch` (`runDeepSearch` l.2025, `fetchThread` l.2042). It reads `forum/{id}/posts` with
  `offset = n * POSTS_PER_PAGE` (20) and keeps `id`, `author.id`,
  `author.username`, `created_time` and `content`. It is the only existing
  reader of post authorship, and it runs only on an explicit deep search.
- **Forum feed.** The test fixture `forumFeedPayload`
  (`tests/load-userscript.js`) gives feed rows a `user: {id, username, karma}`.
  `normaliseActivityRow` (l.520) keeps `userName` and the numeric `type`, and
  **drops `user.id`**. Nothing defines what the `type` values mean.
- **Settings copy is slightly wrong today.** `renderSettingsView` (l.2894) says
  "A refresh always makes two requests". The daily `forum/categories` call
  makes it three on some refreshes. The 13 figure in `docs/architecture.md` is
  correct. This work fixes the copy.
- **Export.** `encodeState` (l.1347) writes an allow-list of per-thread fields
  and leaves out `lastVisitedAt` and every enrichment cache field. Settings are
  not exported.

### API evidence (live, 2026-10-08)

Finding numbers refer to `docs/reference/torn-api-live-findings-2026-10-08.md`.

| Claim | Evidence | Status |
|---|---|---|
| `forum/{id}/posts` rows have `id`, `author{id,username,karma}`, `created_time`, `is_topic`, `is_edited`, `edited_by`, `content` | `forum-thread-posts-from-small.json`, `forum-posts-large-from.json` | Verified |
| Without `from`: oldest first, 20 per page, `offset` pages, topic at offset 0 | Finding 5; `forum-posts-large-offset0.json` | Verified. Deep search relies on this; this design does not |
| `sort` and `limit` are ignored | Findings 6, 7; `forum-posts-large-sort-desc-ignored.json`, `forum-posts-large-limit50-ignored.json` | Verified |
| With `from=t`: posts with `created_time >= t`, **newest first**, at most 20, `next` is `null` | Finding 8; `forum-posts-large-from.json` (20 posts, strictly descending) | Verified |
| `offset` is ignored when `from` is set | Finding 8; `forum-posts-large-from-offset20-ignored.json` is identical to `forum-posts-large-from.json` | Verified. `offset` cannot page a `from` query |
| `from` plus `to` pages backwards. `to` is inclusive, so consecutive pages share exactly one boundary post. A full page's `prev` link is `from=<from>&to=<its oldest created_time>`; `next` is `null` | Finding 15 (PR #15); `forum-posts-large-from-prev.json` (the `prev` page of `forum-posts-large-from.json`: 20 posts, newest first, 1784466765 down to 1784166231, one id shared with page 0) | Verified |
| `from` is inclusive | Finding 9; `forum-thread-posts-from-small.json` (`from` equal to the post's `created_time` returned it) | Verified |
| A thread's `posts` counts replies (total minus 1); subscribed `posts.total` counts every post | Findings 3, 4; `forum-thread.json` (`posts: 1`) against `forum-thread-posts-asc.json` (2 posts) | Verified |
| `last_poster { id, username, karma }` on thread objects | Finding 10; `forum-thread.json` | Verified |
| Posts carry `is_edited` and `edited_by`, and no edit timestamp | Finding 11; `user-forumposts.json` | Verified |
| Torn's `posts.new` can exceed `posts.total` | `user-forumsubscribedthreads.json`, thread 16583282: `new: 17, total: 10` | Observed. `posts.new` is used as a gate (`> 0`), never as a bound |
| Feed `type` meanings | None | **Unverified** |
| `user` log categories "Forum post", "Forum edit" | API docs log filter list | Need log access, more than this key has; and they cover only the key owner's own actions. Not usable. |

## Decision

### Data source: `forum/{id}/posts` pages, walked backwards from the newest

When the setting is on, the per-thread activity lookup calls
`forum/{id}/posts?from=<marker seconds + 1>` **in place of**
`forum/{id}/thread`. It counts the posts whose `author.id` equals the thread's
`authorId` and whose `created_time` is later than the thread's read marker.

Torn answers that request with the **newest** posts after the marker, newest
first, at most 20. `offset`, `sort` and `limit` are all ignored once `from` is
set (findings 6-8), so the first page is "the newest 20 since the marker", not
"the first 20". To reach older new posts, the lookup adds `to=<oldest
created_time on the page just read>` and asks again (finding 15). `to` is
inclusive, so each further page repeats the previous page's oldest post, and
the engine de-duplicates by post id. The walk ends when a page holds fewer than
20 posts or its `prev` link is `null`; then every post after the marker has
been read and the count is exact. It is cut short by the per-thread page cap
or by the shared lookup budget (both below); then the result is a lower bound,
and the truncation rule decides the badge.

The script builds each page's URL itself, through `tornApiGet` and
`buildApiUrl`, from `from` and `to`. It never fetches the `prev` URL Torn
returns: that string carries `limit`, `sort` and possibly `key=` and other
parameters, and every URL this script sends is one it built. The response's
`prev` is read only for whether it is `null`.

Rejected:

- **`last_poster` as a free first check.** Its shape is verified
  (`{ id, username, karma }`, `forum-thread.json`), but it is not free in this
  mode, and it says less than the lookup it would sit in front of. It is free
  only when `forum/{id}/thread` is fetched anyway, and author-only mode
  replaces that call with the posts page. Using it to short-circuit means two
  calls for every thread where the author did not post last, which either
  breaks the 13-request promise or halves the threads checked. Where it does
  short-circuit, it buys only "the author posted last", with no count, and it
  can never prove "the author did not post", which is the answer this feature
  exists to give in busy threads. The posts page already carries the same fact
  for nothing: it is newest first, so `posts[0].author.id` is the last poster
  and `posts[0].created_time` is the last post time. So `last_poster` is not
  used, and nothing in this mode depends on `forum/{id}/thread`.
- **Feed `user`.** Zero cost, but the `type` values are unverified (a "like" by
  the author could read as a post), and coverage of subscribed threads is the
  open risk the v0.1.0 spec already logged. A wrong positive under an
  author-only label is the one failure this feature must not have.
- **Two lookups per thread** (thread plus posts). This halves the threads
  checked per refresh for a `last_post_time` and `last_poster` the posts page
  already supplies (newest first, so `posts[0]` is the last post). It would buy
  only `is_locked` and `is_sticky`.

### Request cost

The ceiling does not change. The lookup budget (`enrichBudget`, default 10,
max 25) now counts **posts requests**, first pages and further pages alike, not
threads. So a default refresh is still at most 2 fixed + 1 daily categories +
10 lookups = **13 requests**, and with the budget at its maximum 3 + 25 = 28,
under the limiter's 40 per rolling minute as before. `forum/{id}/posts` is
public, so the key's access requirement does not change.

**Page cap: at most 3 pages per thread per refresh**, that is the first page
plus 2 further pages (`AUTHOR_MAX_PAGES = 3`). Because each further page
repeats one boundary post, 3 pages reach 20 + 19 + 19 = **58 distinct new
posts**. **Breadth before
depth:** a further page is fetched only while the budget still holds one
request for every target thread not yet started in this batch. So further
pages never cost another thread its first look; they only use budget that
would otherwise go unspent. With 10 or more targets (the busy case), a default
refresh makes exactly one request per thread, as before.

Why 3 pages. The cap's main job is to stop one huge backlog from eating the
budget: without it, a thread with 784 new posts would ask for 40 pages. In the
captured subscription list (`user-forumsubscribedthreads.json`), 16 of 52
threads have `posts.new` over 20. One page leaves all 16 out of reach. Two
pages (39 distinct posts) bring 9 of them in. Three pages (58) bring in 10, the
whole group from 22 to 40, and leave room for a thread to grow between
refreshes; only the 6 at 62 to 784 stay out of reach, and for those more pages
buy little, because that is a backlog the user is not reading post by post and
one visit resets the marker. (`posts.new` counts from Torn's read point, not
from this script's marker, so these figures are a guide, not a promise.)
Because of breadth before depth, the third page never displaces another
thread's first page, so its only cost is a request from budget that would
otherwise go unspent, plus one more sequential round trip in that refresh.

Trade-off: in author-only mode, threads checked this way do not refresh
`isLocked`/`isSticky`. They keep their last known values. Last activity is
still fed, and exactly: `from` has no upper bound and the page is newest first,
so the newest `created_time` on a non-empty first page is the thread's last
post time, however many pages follow. It is written to `lastPostTimeCached`,
and `enrichedAt` is set. An empty page writes neither.

### The read marker

`sinceAt = entry.lastVisitedAt > 0 ? entry.lastVisitedAt : entry.firstSeenAt`.

`lastVisitedAt` already records both a visit captured on Torn (`captureVisit`)
and Mark read (`markRead`). Those are the two moments the user has seen the
thread. `firstSeenAt` covers a thread the user has never opened or marked since
the script first saw it. Author posts from before the install are not flagged.
That is an accepted gap, and the Settings text says so. When both are 0, the
state is `unchecked` with reason `no-marker`.

**One rule for "new":** a post is new when `created_time * 1000 > sinceAt`. A
post at the marker was there when the user looked, so it counts as seen.
`from` is inclusive (finding 9), so the request sends
`from = floor(sinceAt / 1000) + 1`, the smallest whole second that satisfies
the rule, and Torn returns exactly the posts the rule calls new. A post at the
marker therefore never takes one of the 20 slots. The engine applies the same
test to what comes back, so such a post is never counted even if the request
were built wrong. The test uses the real `forum-thread-posts-from-small.json`:
with the marker at its post's own second the count is 0, and one second earlier
it is 1.

### Per-thread author state (pure)

`authorStateFor(apiRow, entry, unreadInfo)` returns
`{ state, count, latestAt, reason }`. The states are:

| state | when | badge (row) |
|---|---|---|
| `none` | dismissed; or Torn reports `posts.new == 0`; or a valid check found 0 author posts in a complete walk | none |
| `author` | a valid check found `count >= 1` author posts in a complete walk | `N new by author` |
| `author-atleast` | a valid check found `count >= 1` in a walk cut short (older new posts were not read); or an earlier check found `count >= 1` with the same marker and the thread has grown since | `N+ new by author` |
| `unchecked` | everything else, with a `reason`: `never` (no check yet: budget, throttle or failure), `stale` (marker moved, or thread grew after a zero-count check), `too-many` (walk cut short, no author post among the posts read), `no-author` (`authorId` unknown), `no-marker`. Lookups target only `never` and `stale`. The other reasons would give the same answer until the thread or the marker changes | `author: not checked (too many new)` for `too-many`, `author: not checked` otherwise. Each has a title tooltip giving the reason and saying that Torn reports new posts from someone |

A check is **valid** when `check.total === postsTotal` (no posts since) and
`check.since === sinceAt` (marker unchanged). An unchanged thread therefore
never needs re-checking, and no TTL is needed.

The badge never shows `tornUnread` under an author label. The `unchecked`
tooltip may say "Torn reports new posts from someone". It does not give the
number.

### Reading the pages: the walk and the truncation rule

Two pure functions do the reading. The runtime only fetches.

`authorPageStep(pagePosts, seenIds, perPage, prevLink)` decides, after each
page, whether the walk has ended and, if not, the `to` for the next page:

- **Complete** (`{ done: true, complete: true }`) when the page holds fewer
  than `perPage` (20) posts, or its `prev` link is `null`. Every post after the
  marker has then been read. (`prev` is only tested for `null`; when
  `_metadata` is missing the length alone decides.)
- **Stuck** (`{ done: true, complete: false }`) when a full page adds no post
  id the walk had not already seen. That happens only if more than 20 posts
  share one second, so `to` cannot move past them. The walk stops rather than
  loop, and the result is a lower bound.
- Otherwise **continue** (`{ done: false, to }`), with `to` the oldest
  `created_time` on this page. `to` is inclusive, so the next page starts with
  that same post again.

`summariseAuthorPosts(posts, authorId, sinceMs, complete)` reads the
concatenated pages. It reads every post and never relies on position, so order
cannot change the answer:

- **Each post id counts once.** The boundary post that `to` repeats is
  skipped the second time. Without this, an author post on a page boundary
  would be counted twice and "1 new by author" would read "2".
- Only posts with `created_time * 1000 > sinceMs` count (the marker rule). A
  post at or before the marker is skipped. It is not treated as an error: with
  `from` verified, the inclusive bound is the only way one can arrive, and if
  Torn ever stopped honouring `from`, the pages would be the thread's oldest
  posts, which the same test skips.
- `complete` comes from the walk, not from page length.

The walk is cut short when the thread reaches `AUTHOR_MAX_PAGES` (3), when
the budget must be kept for threads not yet started (breadth before depth), or
when a further page fails or is throttled. A cut-short walk is a lower bound,
because more new posts may lie between the marker and the oldest post read,
and nothing proves otherwise (`posts.new` is not a reliable count; it can
exceed `posts.total`). Then:

- one or more author posts among the posts read: `author-atleast`, badge
  **`N+ new by author`**. N is a lower bound and the `+` says so. The newest
  author post is exact, because any author post not read is older than every
  post read, so `authorLatestAt` and the Catch-up order are right;
- no author post among them: `unchecked`, reason `too-many`, badge
  **`author: not checked (too many new)`**. Never `none`: the author may have
  posted in the part not read.

A walk that ends inside the cap is exact: `N new by author`, or `none`.

A `too-many` row is not re-checked while nothing changes: the same walk would
read the same posts. It becomes `stale`, and a lookup target again, when the
thread grows (a new post may be the author's) or when the marker moves (a
visit or Mark read, which brings the unread part within reach). The tooltip
says so.

### Where the state is used, with the setting on

- `mergeThreads` adds `authorState`, `authorNew`, `authorLatestAt` and
  `authorReason` to every row. It sets `row.unread = authorNew` for the
  `author`/`author-atleast` states and `0` otherwise. `row.tornUnread` is kept
  unchanged. `sortThreads` (`unread` mode), `is:unread` and the header total
  then follow without change.
- **Lookup targets** in `refreshAll` move from `r.unread > 0` to
  `r.subscribed && !r.dismissed && r.tornUnread > 0 && r.authorState === 'unchecked'`.
  Selecting on `unread` would never select anything, because `unread` is 0 for
  an unchecked row. A test pins this.
- **Catch up**: `catchUpList(rows, lastCatchUpAt, mode)` keeps a non-dismissed
  row in author mode when the state is `author`/`author-atleast` and
  `authorLatestAt > lastCatchUpAt`. Rows with only non-author activity are left
  out. `unchecked` rows go into a separate, labelled group, "Not yet checked
  for author posts (N)", under the list. They are not counted in the nav
  `(N)` and not mixed in as updates, but they are not dropped silently either.
- **Unread only** keeps `unchecked` rows visible, with their badge, so the
  filter cannot hide an unknown as if it were known-empty. An archived
  `unchecked` row stays hidden: Archive is an explicit hide, and the row comes
  back once a check finds an author post.
- **`is:unread`** matches `unchecked` rows as well as rows with a count, for the
  same reason as Unread only: a search must not turn an unknown into a known
  empty.
- **Mark all read** skips `unchecked` rows in author mode. Marking one moves
  both the read point and `lastSeenTotal` past author posts the user was never
  told about. A single-row Mark read is the user's explicit act and stays as is.
- **Catch up empty state**: when the author list is empty but the `unchecked`
  group is not, the text reads "No author updates in the threads checked."
  rather than "You are caught up."
- **Header badge**: `N new by author`, plus `M not checked` when M > 0.

With the setting off, every path behaves exactly as today. Tests pin the
off-mode outputs to the current ones.

### Edits

Posts carry `is_edited` and `edited_by`, but no edit timestamp (finding 11,
`user-forumposts.json`). Without a time, an edit cannot be placed before or
after the read marker, so "edited since you looked" cannot be told from "edited
long ago". Edits are out of scope. The setting is labelled **Only flag new posts by the thread
author**, and the Settings text says edits are not detected.

### My posts (#2)

The setting **does not apply to My posts**. There, the author is often the user,
and the posts that matter are the replies from others. My posts keeps its own
"new" definition from #2's spec and shows a one-line note when the setting is
on: "Only flag author updates applies to Threads and Catch up, not My posts."
The engine takes the mode as an argument (`mergeThreads({..., authorOnly})`,
`catchUpList(rows, at, mode)`), so #2 passes `false`. A subscribed thread that
also appears in My posts can show different badges in the two views. That is
intended.

#3 (row cap) is unaffected. The `unchecked` group in Catch up counts as Catch-up
rows for the cap. The nav count does not include it.

### Settings

- `settings.authorOnly: boolean`, default `false`. `normaliseSettings` accepts
  only `=== true`. Unknown or corrupt values fall back to `false`. The setting
  round-trips through `tfcc:settings` and survives a reload. Export does not
  carry settings today, and this does not change that.
- Checkbox under **Refreshing**: "Only flag new posts by the thread author".
- Cost copy, replacing the current note. It states the real numbers:
  "A refresh makes two requests, plus one a day for forum names. Each activity
  lookup adds one more (at most N per refresh, so at most N+3 in total), and
  only runs for a thread that has unread posts and no recent check. The script
  keeps itself under 40 requests a minute regardless." A second note is always
  shown, so the limits are visible before the setting is turned on: "Author-only
  mode reads a thread's posts since you last looked, 20 at a time, newest
  first, instead of its last-post time. Each page is one lookup from the same
  allowance, so the total cost is the same; a thread gets at most 3 pages, and
  only once every other thread has had its first. With more new posts than
  that, a count shows as a minimum (N+), or as 'not checked (too many new)'
  when none of the posts read is by the author. Threads not checked yet show
  'not checked'. Posts from before you started using this
  script are not flagged, and edits are not detected."

### Persisted state and migration

Seven new per-thread fields in `organizer.threads[id]`, written by the lookup and
normalised in `normaliseThreadEntry`. All are additive, with zero/false
defaults, and `SCHEMA_VERSION` stays 1:

| field | type | meaning |
|---|---|---|
| `authorCheckedAt` | ms | when the last check ran, 0 = never |
| `authorCheckTotal` | int | subscribed `posts.total` (`postsTotal`) at that check; never a thread's `posts` |
| `authorCheckSince` | ms | `sinceAt` used by that check |
| `authorNewCount` | int | author posts found after `since` |
| `authorLatestAt` | ms | newest author post found |
| `authorCheckComplete` | bool | the walk ended inside the cap (a short page or a `null` `prev`) |
| `authorCheckReason` | string, allow-listed | `''` or `too-many` (anything else normalises to `''`) |

### Counting posts: the +1

Two Torn figures look alike and differ by one. Subscribed `posts.total` counts
every post, topic included. A thread object's `posts` (`forum/{id}/thread`,
`user/forumthreads`) counts replies only, so it is `posts.total - 1` (findings
3, 4; `forum-thread.json` says `posts: 1` for a thread whose
`forum-thread-posts-asc.json` holds 2 posts). This design compares subscribed
totals only with subscribed totals: `authorCheckTotal` is written from
`postsTotal` and compared with `postsTotal`, and dismissal compares
`lastSeenTotal` with `postsTotal`. It never reads a thread's `posts`
(`enrichThreads` does not either). If later code needs a total from a thread
object, it uses #2's pure helper `threadPostsTotal(raw)` (a numeric `posts`
becomes `posts + 1`, a `posts.total` passes through, unknown is -1), which is
the only place the unit is converted, and adds it exactly as #2 defines it if
#2 has not landed. A value that came through `threadPostsTotal` or #2's
`parseThreadDetail` is already in `posts.total` units: never add 1 to it again.
A test pins the +1 against the fixtures, so a recapture that changes it fails
loudly.

Upgrade without a false "damaged" notice. `loadKey` calls a stored value
damaged whenever `JSON.stringify(raw)` differs from the normalised value, so a
0.1.0 user, whose stored blobs lack every field added here, would be told "Settings
were damaged and have been reset." and "Folders and tags were damaged and have
been reset." with nothing damaged. `authorOnly` is top-level in `tfcc:settings`
and is covered by the pure helper `isRecoveredValue(raw, value)` designed in
#8's spec ("The upgrade trap"), which fills absent top-level keys of a
plain-object `raw` from `value` before comparing; if #8 has not landed, this
plan adds it exactly as #8 specifies. The seven author fields are nested inside
`organizer.threads[id]`, which that helper deliberately does not forgive. For
those, a second pure helper, `isRecoveredOrganizer(raw, value)`, fills absent
keys of each raw thread entry from its normalised entry and then defers to
`isRecoveredValue`; `loadKey` takes it as an optional fourth argument and
`loadAll` passes it for the organizer only. This is the smaller and safer
choice because it forgives exactly one thing (a key missing from a stored
thread entry) in one place, and leaves the shared helper, and the nested-strict
test #8 pins on it, alone. A present field the normaliser changes, a key it
drops, and an entry it drops are all still damage.

An existing organizer loads with every row in the `unchecked` (or `none`) state.
The first refresh with the setting on checks up to the budget. A downgrade drops
the fields harmlessly. `encodeState` stays an allow-list, so none of these are
exported. A test pins that.

### Failure paths

- Request failure or a non-object `posts`: nothing is written, so the row keeps its
  previous state, which is `unchecked` (`never` or `stale`) by construction, because
  only unchecked rows are targeted. The refresh still succeeds, as an enrichment
  failure does today. Transient reasons are not persisted. The tooltip says
  "not checked yet", which is true.
- `throttled`: stop the batch (same as `enrichThreads`). The remaining rows stay
  `unchecked` (`never`/`stale`).
- A **further** page (with `to`) fails or is throttled: the pages already read
  are kept and recorded as a walk cut short (`author-atleast` or `too-many`),
  never as complete. A throttle still stops the batch.
- `authorId === 0`: `unchecked` (`no-author`). No request is spent.
- Every error detail goes through `scrubDetail`. The key never appears in a
  detail, a log or the debug report.
- No DOM is read. ADR 0001 holds.

## Assumptions

1. **Answered.** `from` filters by post creation time in unix seconds,
   inclusively, and returns the newest 20 at or after it (findings 8, 9;
   `forum-posts-large-from.json`, `forum-thread-posts-from-small.json`).
2. `created_time` is creation time, not last-edit time. Consistent with the
   capture (`from` matched `created_time` exactly, and posts have no edit
   timestamp), but not tested against an edited post.
3. `author.id` on a post is the same id space as `author.id` on a thread or
   subscribed row. Consistent with the capture: thread 16589908's topic post in
   `forum-thread-posts-asc.json` has the same `author.id` as the thread in
   `forum-thread.json`. The redaction remaps ids through one table, so the
   fixtures keep this property.
4. A captured visit or Mark read is an adequate "seen" marker for author posts.
   It is time-based, while dismissal is count-based. In this mode the two can
   disagree: a post written before Mark read but indexed after it can be missed.
   This is accepted.
5. The panel's "Mark read" stays the only local clear. Torn's own `posts.new`
   is still used only to decide whether a check is worth spending.

## Open questions

Answered by the 2026-10-08 capture:

1. **Answered.** Does `forum/{id}/posts` honour `from`, and is it inclusive?
   Yes and yes (findings 8, 9). The request sends marker + 1.
2. **Answered.** Post order: newest first with `from`, oldest first without
   (findings 5, 8). `offset` is ignored when `from` is set
   (`forum-posts-large-from-offset20-ignored.json`). Paging is by `to`
   instead (question 7).
3. **Answered.** No edit timestamp; only `is_edited` and `edited_by`
   (finding 11).
4. **Answered.** `forum/{id}/thread` carries `last_poster { id, username,
   karma }` (finding 10). Not used; see Decision.
7. **Answered** (probe on 2026-10-08, finding 15 in PR #15). Can `to` reach the
   posts nearest the marker? Yes. Following page 0's `prev`
   (`from=1777939495&to=1784466765`) on thread 16561608 returned 20 posts,
   newest first, 1784466765 down to 1784166231, all at or after `from`, with
   exactly one id shared with page 0 (`to` is inclusive), its own `prev`
   (`to=1784166231`) and a `null` `next`
   (`forum-posts-large-from-prev.json`). This design walks back with it, up to
   3 pages per thread.

Still open:

5. What do the `user/forumfeed` `type` values mean, and does the feed cover
   posts in subscribed threads? Feed `user.id` could become a zero-cost hint once
   the meanings are known. Not probed.
6. Are deleted posts counted in `posts.total`? (This affects whether
   `check.total` stays a stable validity key.) Not probed.
8. Does a deep `to` walk ever stall on many posts in one second? The design
   stops a walk that makes no progress (`authorPageStep`, "stuck"), so this
   cannot loop; how often it happens is unknown.

## Out of scope

A per-thread override toggle. Edits. Any change to `@match`, `@grant` or
`@connect`.
