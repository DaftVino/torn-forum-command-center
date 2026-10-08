# Only flag author updates - design

Issue: #4. Status: proposed, 2026-10-08.
Related: #2 (My posts view), #3 (row cap). ADR 0001 (no DOM data paths) governs.

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

### API evidence in the repo

| Claim | Evidence | Status |
|---|---|---|
| `forum/{id}/posts` rows have `id`, `author{id,username}`, `created_time`, `content` | `runDeepSearch` reads them; `tests/postcache.test.js` fixture | In use, not live-verified this session |
| `forum/{id}/posts` paginates by `offset`, 20 per page | `runDeepSearch`, `tests/api.test.js` | In use |
| `forum/{id}/posts` accepts `from` and `to` query parameters | API changelog 22.08.2025 in `docs/reference/torn-api-docs-2026-08-08.html` | Documented. Semantics (created time? inclusive?) **unverified** |
| Post order within a page (oldest first?) | Deep search assumes a short page is the end | **Unverified** |
| A post edit timestamp or edited flag | None anywhere in the repo | **Not evidenced** |
| `last_poster` on `forum/{id}/thread` | Listed in the v0.1.0 spec table; no fixture; never read | **Unverified shape** |
| Feed `type` meanings | None | **Unverified** |
| `user` log categories "Forum post", "Forum edit" | API docs log filter list | Need log access, more than this key has; and they cover only the key owner's own actions. Not usable. |

## Decision

### Data source: one `forum/{id}/posts` page per checked thread

When the setting is on, the per-thread activity lookup calls
`forum/{id}/posts?from=<sinceSeconds>` **in place of** `forum/{id}/thread`. It
counts the posts whose `author.id` equals the thread's `authorId` and whose
`created_time` is later than the thread's read marker.

Rejected:

- **`last_poster`.** Zero extra cost, but it names only the last poster. If the
  author posts and then anyone replies, the author's post is missed, and that
  is the busy-thread case this feature exists for. Its shape is also unverified.
  It may come back later as a free positive hint (see open questions).
- **Feed `user`.** Zero cost, but the `type` values are unverified (a "like" by
  the author could read as a post), and coverage of subscribed threads is the
  open risk the v0.1.0 spec already logged. A wrong positive under an
  author-only label is the one failure this feature must not have.
- **Two lookups per thread** (thread plus posts). This halves the threads
  checked per refresh for a `last_post_time` the posts page mostly supplies.

### Request cost

The cost does not change. The lookup budget (`enrichBudget`, default 10) now
counts posts lookups. A default refresh is still at most **3 + 10 = 13
requests**, and the limiter still holds 40 per rolling minute. Each lookup is
one request, as before. `forum/{id}/posts` is public, so the key's access
requirement does not change.

Trade-off: in author-only mode, threads checked this way do not refresh
`isLocked`/`isSticky`. They keep their last known values. Last activity is
still fed: when the page came back complete (fewer than 20 posts), its newest
`created_time` is written to `lastPostTimeCached` and `enrichedAt`. When the
page came back full, that time is only a lower bound. It is written to
`lastPostTimeCached` but not to `enrichedAt`, so the row stays `enriched-stale`
and is not claimed as fresh.

### The read marker

`sinceAt = entry.lastVisitedAt > 0 ? entry.lastVisitedAt : entry.firstSeenAt`.

`lastVisitedAt` already records both a visit captured on Torn (`captureVisit`)
and Mark read (`markRead`). Those are the two moments the user has seen the
thread. `firstSeenAt` covers a thread the user has never opened or marked since
the script first saw it. Author posts from before the install are not flagged.
That is an accepted gap, and the Settings text says so. When both are 0, the
state is `unchecked` with reason `no-marker`.

### Per-thread author state (pure)

`authorStateFor(apiRow, entry, unreadInfo)` returns
`{ state, count, latestAt, reason }`. The states are:

| state | when | badge (row) |
|---|---|---|
| `none` | dismissed; or Torn reports `posts.new == 0`; or a valid check found 0 author posts on a complete page | none |
| `author` | a valid check found `count >= 1` author posts on a complete page | `N new by author` |
| `author-atleast` | a valid check found `count >= 1` on a full page (there may be more); or an earlier check found `count >= 1` with the same marker and the thread has grown since | `N+ new by author` |
| `unchecked` | everything else, with a `reason`: `never` (no check yet: budget, throttle or failure), `stale` (marker moved, or thread grew after a zero-count check), `full-page` (20 posts back, none by the author), `filter-ignored`, `no-author` (`authorId` unknown), `no-marker`. Lookups target only `never` and `stale`. The other reasons would give the same answer until the thread changes | `author: not checked`, with a title tooltip giving the reason and saying that Torn reports new posts from someone |

A check is **valid** when `check.total === postsTotal` (no posts since) and
`check.since === sinceAt` (marker unchanged). An unchanged thread therefore
never needs re-checking, and no TTL is needed.

The badge never shows `tornUnread` under an author label. The `unchecked`
tooltip may say "Torn reports new posts from someone". It does not give the
number.

### The engine never trusts `from`

`summariseAuthorPosts(posts, authorId, sinceMs, perPage)` works out the result
from what came back, whatever the order:

- Only posts with `created_time * 1000 > sinceMs` count.
- If any returned post is at or before `sinceMs`, the API ignored or reinterpreted
  `from`. The result is `{ filterIgnored: true }` and the state is `unchecked`
  with reason `filter-ignored`. The debug report shows this, so the first live
  refresh answers that open question.
- `complete = posts.length < perPage`.

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

API v2 shows no evidence of a post edit timestamp or an edited flag. Edits are
out of scope. The setting is labelled **Only flag new posts by the thread
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
  mode reads one page of the thread's newest posts per lookup instead of its
  last-post time, so the cost is the same. Threads not checked yet show 'not
  checked'. Posts from before you started using this script are not flagged, and
  edits are not detected."

### Persisted state and migration

Seven new per-thread fields in `organizer.threads[id]`, written by the lookup and
normalised in `normaliseThreadEntry`. All are additive, with zero/false
defaults, and `SCHEMA_VERSION` stays 1:

| field | type | meaning |
|---|---|---|
| `authorCheckedAt` | ms | when the last check ran, 0 = never |
| `authorCheckTotal` | int | `postsTotal` at that check |
| `authorCheckSince` | ms | `sinceAt` used by that check |
| `authorNewCount` | int | author posts found after `since` |
| `authorLatestAt` | ms | newest author post found |
| `authorCheckComplete` | bool | page was not full |
| `authorCheckReason` | string, allow-listed | `''`, `filter-ignored`, `full-page` (anything else normalises to `''`) |

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
- `authorId === 0`: `unchecked` (`no-author`). No request is spent.
- Every error detail goes through `scrubDetail`. The key never appears in a
  detail, a log or the debug report.
- No DOM is read. ADR 0001 holds.

## Assumptions

1. `from` filters by post creation time, in unix seconds. The engine checks
   this instead of trusting it.
2. `created_time` is creation time, not last-edit time.
3. `author.id` on a post is the same id space as `author.id` on a
   subscribed-thread row.
4. A captured visit or Mark read is an adequate "seen" marker for author posts.
   It is time-based, while dismissal is count-based. In this mode the two can
   disagree: a post written before Mark read but indexed after it can be missed.
   This is accepted.
5. The panel's "Mark read" stays the only local clear. Torn's own `posts.new`
   is still used only to decide whether a check is worth spending.

## Open questions (verify against the live API before release)

1. Does `forum/{id}/posts` honour `from`, and is it inclusive? (The
   `filter-ignored` reason answers this on the first live refresh.)
2. What order are posts in within a page, and does `from` combine with `offset`?
3. Is there any edit timestamp or edited flag on a `ForumPost`
   (`torn.com/swagger/openapi.json`)? If so, a follow-up can add edits.
4. Does `forum/{id}/thread` carry `last_poster`, and in what shape? If it is
   `{id, username}`, it could act as a free positive hint for threads past the
   budget.
5. What do the `user/forumfeed` `type` values mean, and does the feed cover
   posts in subscribed threads? Feed `user.id` could become a zero-cost hint once
   the meanings are known.
6. Are deleted posts counted in `posts.total`? (This affects whether
   `check.total` stays a stable validity key.)

## Out of scope

A per-thread override toggle. Edits. Any change to `@match`, `@grant` or
`@connect`.
