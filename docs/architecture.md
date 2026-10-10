# Architecture

A Tampermonkey and Torn PDA userscript that replaces Torn's small
subscribed-threads box with a full forum workspace on `forums.php`: folders,
tags, pinned threads, read/unread tracking, catch-up since your last visit,
locally saved reply drafts, and search across the threads you follow.

## How it works

The script runs on `forums.php` and reads the official Torn API v2 forum
endpoints. It never parses Torn's HTML for data.

It needs a key carrying two of the user's own selections, `forumsubscribedthreads`
and `forumfeed`; everything else it touches is public. The panel asks for a
**Minimal Access** key and says Limited Access also works but is not needed.
Live probing on 2026-10-08 settled this: a Public Only key fails both
selections with error 16, Minimal Access passes every endpoint the script uses,
and Limited Access adds nothing. The panel no longer suggests a Custom key with
only those two selections: Torn's docs say a custom key reaches only the
default, timestamp and lookup selections unless more are listed, so it would
probably fail the `forum/*` calls.

That choice is the centre of the design, and it came out of three findings.
Torn's own API v2 roadmap scoped a `forumUpdates` feature — new posts in
subscribed threads, likes, replies — and shipped the endpoints without ever
building an interface for them. Torn's scripting rules allow a script to act on
the official API or on a page the user has manually loaded, one input producing
one request, and prohibit background scraping. And no research could confirm a
single current forums selector: every real selector that surfaced
(`#forums-page-wrap`, `.threads-list`, `.post-wrap`) predates Torn's React
rewrite.

So no data path touches Torn's markup. DOM access exists in exactly two places,
choosing a mount container and finding the reply box (Torn's editor body, `#editor-wrapper
.editor-content.mce-content-body`, as amended by ADR 0002), and both degrade
visibly rather than failing silently.

The panel's own markup is not one of those places and is not a data path. Its
single delegated click listener on `#tfcc-panel` also recognises the thread
links the panel rendered, by a `data-tfcc-thread` attribute only the panel
writes, so the "Hide the panel when I open a thread" setting can persist a
collapse before the browser follows the link. The lookup (`threadLinkOf`)
stops at the panel and never reads Torn's nodes. The script still initiates no
navigation: the user's click does.

### The eight endpoints

| Endpoint | Access | Used for |
|---|---|---|
| `user/forumsubscribedthreads` | own selection | The subscribed list and `posts.new`, the unread count |
| `user/forumfeed` | own selection | Recency and catch-up |
| `forum/categories` | Public | Real forum names, fetched at most once a day |
| `forum/{id}/thread` | Public | `last_post_time` enrichment, budgeted |
| `forum/{id}/posts` | Public | Deep search; author-only lookups (budgeted, replacing `thread`); and `?offset=0` for the opening post's thumbs of threads the key owner started, inside My posts only (#10) |
| `user/forumthreads` | Public | My posts: threads the key owner started, fetched only for that view; also each thread's `rating` and the owner's `author.karma` |
| `user/forumposts` | Public | My posts: threads the key owner posted in, fetched only for that view |
| `user/profile` | Public | Karma fallback only: when both My posts lists are empty, at most once per 12 hours; reads `profile.karma` and nothing else (#10) |

`forumsubscribedthreads` carries the unread count but no last-post time. That
asymmetry is why enrichment exists and why last activity resolves from several
candidates rather than one.

A refresh is one user action and at most 13 requests by default: two fixed
calls, one category call at most daily, and up to ten enrichment lookups for
threads that have unread posts and no recent time. The limiter enforces a
650 ms gap and a ceiling of 40 requests per rolling minute, against the ~100
the community reports. Auto refresh is off by default.

Both My posts selections answer on any key level (live finding 16), so the
required key level stays Minimal Access; the custom-key link lists them so a
least-privilege key covers the whole script. My posts is its own bounded
action, never part of the Threads refresh: opening the view (at most once per
15 minutes) or pressing Refresh while it is open makes two list requests plus
up to the same lookup budget, then reads the opening post of at most
`min(5, lookup budget)` threads the key owner started (each at most once per
12 hours, never after a throttle), so at most 17 requests by default and 32 at
the largest setting (2 with lookups set to 0). When both lists come back empty
the run instead reads `user/profile` once for the owner's karma: 3 requests at
any setting, at most once per 12 hours. A default Threads refresh plus a
default My posts run is 30 of the 40 a minute allows. It never fetches the
category list, page load never fetches it, and auto refresh never does.

The thumbs (#10) are the topic post's `likes` and `dislikes` (owner check 1
matched them with Torn's thread page). Torn's thread `rating` is shown only as
"net" until a thread is checked, and never split into or added to the thumbs:
whether it is net or likes only is not settled (live finding 13). Torn
publishes no subscriber count, so none is shown.

## Structure

`torn-forum-command-center.user.js` is one IIFE in two marked sections.

- **Engine** — pure functions: normalisers, the merge of API data with local
  state, the unread model, sorting, query parsing, search, cache eviction,
  export and import. No DOM, no network, no `GM_*`, no ambient clock. Every
  function that needs the time takes it as an argument.
  `tests/purity.test.js` reads the section with comments and strings stripped
  and fails on a forbidden reference.
- **Runtime** — script storage, the API adapter, the rate limiter, the capture
  layer, the panel, and the bootstrap.

The merge is where the product lives, and it is pure, so every behaviour in the
workspace is testable without a browser.

### The unread model

Torn owns the truth and the script adds a dismissal layer over it:

```
tornUnread      = posts.new
dismissed       = lastSeenTotal >= posts.total
effectiveUnread = dismissed ? 0 : tornUnread
```

"Mark read" suppresses a thread locally until Torn reports more posts. It
cannot clear Torn's own counter, which only clears when the thread is opened,
and the panel says so rather than implying a sync that does not exist.

**Author-only mode (#4).** With the setting on, Threads and Catch up count a
thread as new only when its author posted after the marker (the last visit or
Mark read, else first seen). Each activity lookup then reads
`forum/{id}/posts?from=<marker seconds + 1>` instead of `forum/{id}/thread`:
`from` is inclusive and returns the newest 20, newest first; further pages go
back with `to=<oldest created_time read>`, also inclusive, so the shared
boundary post is de-duplicated by id. A thread gets at most 3 pages, every page
is one unit of the same lookup budget, and further pages are fetched only while
one request stays reserved for each thread not yet started, so a default
refresh stays at 13 requests. The result is cached per thread
(`authorCheck*` fields, never exported) and keyed to the marker and the
subscribed `posts.total`. A row's author state is `none`, `author` (exact),
`author-atleast` (a walk cut short) or `unchecked` with a reason; an unknown is
never shown as none, and Torn's any-poster count is never shown under an
author label. My posts ignores the setting.

### My posts and the local unread count

A thread in `tfcc:mine` that is not subscribed has no `posts.new`. The first
matching rule decides its count:

1. Subscribed: exactly the Threads rule above.
2. Started, with `new_posts` on its `user/forumthreads` row: the same rule with
   `new_posts` in place of `posts.new`. It is Torn's own count.
3. Total known, no Torn count: a local count,
   `unread = max(0, postsTotal - max(lastSeenTotal, baselineTotal))`.
   `baselineTotal` is set the first time the script sees a total (so installing
   never floods history as new) and advances when the last post is your own.
4. Total unknown: `unchecked`. The row says "not checked yet" and never passes
   for a checked zero.

**Units.** A thread object's `posts` (`user/forumthreads`, `forum/{id}/thread`)
counts replies, while the subscribed `posts.total`, and so `lastSeenTotal`,
counts every post (live findings 3 and 4). Every stored total is therefore
`posts + 1`, converted in `threadPostsTotal` and nowhere else.

**Population.** A My posts thread appears in Threads only when
`subscribed || organized`, where organized is a folder, a tag, a pin, a
priority, a note, archived or a draft. A read marker or a visit does not count,
so marking your own thread read does not file it in Threads. Threads, Catch up,
the header badge and Catch up's Mark all read use the Threads population only.

### Last activity

Resolved from the newest of several candidates, not the first available one: a
fresh enrichment can still be older than an activity row that arrived since.
Each row reports which candidate won (`enriched`, `feed`, `mine`,
`enriched-stale`, `own-post`, `visit`, `none`), so a surprising sort order is diagnosable from the row. An
unresolved time is `null` and sorts last; it is never treated as zero.

### Rows shown

A Settings choice of 3, 5, 10, 20, 30 or All (the default) caps the Threads,
Catch up and My posts lists. `capRows` is a pure engine function and is the
last step, after every filter and the sort, so pinned threads take cap slots
like any row. `buildPanelModel` keeps `model.rows`, `model.catchUp` and
`model.mine` whole, because Search, deep search and the nav counts read them,
and puts the capped lists in `model.capped`. Every view is in exactly one of
`CAPPED_VIEWS` and `UNCAPPED_VIEWS`, and a test holds it there. Show all lives
in `state.showAll` until the page reloads and is never stored.

### Storage

Eight independent keys (`tfcc:badges` is the eighth), each with a schema version. `tfcc:mine`, the My posts
cache, is its own key rather than a field of `tfcc:feed`, because a new field
there would make every existing user's first load report the feed cache as
damaged; it is not exported and Reset everything clears it. A value that fails
normalisation resets that key only and is reported visibly, so a corrupt post
cache cannot cost the user their folders. An unparseable value is distinguished
from an absent one, because collapsing the two is how someone loses everything
in silence.

`tfcc:mine` records carry five optional reaction fields (#10), always in the
order `reactAt`, `rating`, `topicAt`, `up`, `down`, written only through
`setReactionFields`. They are optional because they are nested inside
`threads[]`: `loadKey` calls a key damaged when its normalised form differs
from the stored one, and #8's `isRecoveredValue` forgives only missing
top-level keys. So the normaliser never adds a field the stored record lacked,
keeps whole pairs only, and a cache written before #10 round-trips byte for
byte. `tfcc:mine` also gains an optional top-level `karma`/`karmaAt` pair,
absent until known, written only through `setKarma`, and carried over by
`mergeMineSnapshot` so a cached profile reading survives a run. The karma icon
is the owner's `docs/reference/karma-endless-knot.svg`, inlined as the ASCII
constant `KARMA_ICON_SVG` with `fill="currentColor"`. No post `content` is ever
read or stored.

`tfcc:key` holds the API key. It is never exported, never logged, never in a
debug report. Every detail string passes through `scrubDetail`, which redacts
URLs and `key=` pairs — `redactUrl` alone was not enough, because a browser's
own network error text quotes the request URL the script never built.

## Torn PDA lifecycle

Every lesson from the sibling Education Scheduler is carried here as a test
rather than a comment.

The script runs at `document-end` and still tolerates arriving before the page
DOM or after normal readiness events, using `DOMContentLoaded`, `load`, and a
bounded poll that converge on one idempotent bootstrap.

Torn PDA ignores `@match` entirely and injects on every Torn page, so
`isForumsPage()` is the real scoping: host `www.torn.com` or `torn.com`, path
exactly `/forums.php`.

**The source is ASCII only, and a test enforces it.** Torn PDA's
`UserScriptsProvider.adaptSource` rewrites typographic quotes across the whole
file before injection. In the Education Scheduler that turned four curly
apostrophes inside single-quoted strings into syntax errors, and nothing ran at
all — no panel, no error, before bootstrap.

Torn PDA substitutes the literal `###PDA-APIKEY###` in source at injection. The
script reads that slot and offers it as a default key if it has been replaced
with something key-shaped. The sentinel it compares against is assembled from
three fragments at runtime, so PDA's own replacement cannot rewrite the
comparison and make a replaced slot look unreplaced.

The API adapter tries three transports in order: `PDA_httpGet` (PDA's Flutter
bridge, the only one guaranteed to work inside the app webview), then
`GM_xmlhttpRequest`, then `fetch`. It never rejects; every outcome is a value.
The 15 second deadline is a timer race rather than `AbortController`, whose
behaviour varies across embedded webviews.

The panel shell is drawn before any request, so a hung network looks like a slow
panel rather than a script that failed to run.

## Mount and navigation

`forums.php` is hash-routed, so the panel mounts once and survives hash changes,
and unmounts only when the user leaves `forums.php`. Bootstrap converges from
`DOMContentLoaded`, `load`, a poll, `hashchange`, `popstate`, patched history
methods and a debounced `MutationObserver`, and none of them may create a second
panel. History patching is defensive hardening and is swallowed if it fails; it
must never be the reason the panel does not appear.

Mount selection tries an ordered list of containers, accepts one only while it
is connected, and otherwise creates an owned `#tfcc-fallback-mount`. A wrong
guess costs placement, never the script.

### The narrow layout and ADR 0001

A panel 600px wide or less condenses (#33). The width is the panel's own, not
the viewport's: the inline panel sits in Torn's content column, and Expand
changes its width without changing the viewport. A `ResizeObserver` on
`#tfcc-panel`, plus a measurement of the same element on every render, sets
`state.narrow` with 16px of hysteresis (enter at 600, leave above 616), and
`renderPanel` writes the `tfcc-narrow` class. Without `ResizeObserver` the
per-render measurement is the whole mechanism. `fitHeader` then sizes the
header buttons (`--tfcc-hb`, 24 to 44px) from the panel's content width, the
chip and the Show button, so the header stays on one line.

`renderPanel` also writes `tfcc-clip` while `settings.clipLines` is on (#41,
the default). Every rule that cuts a row's title, note or narrow meta line to
one line hangs off that class, so the setting is one switch at every width.

**The owner's ruling (2026-10-09):** a `ResizeObserver` on the script's own
`#tfcc-panel`, and measuring nodes inside it, stays within ADR 0001. It is not
a third DOM access: ADR 0001 confines access to Torn's markup to the mount
container and the reply box, and neither the observer nor `fitHeader`
reads a Torn node or Torn data. This interprets ADR 0001 and does not reverse
it, so the ADR is unchanged (repo-standards section 6.3).
`tests/narrow-focus.test.js` records every `document.querySelector` call to
keep it that way.

The narrow polish (#39) adds two more readings of the script's own nodes and
one window listener, all inside the same ruling. `fitCatchUp` measures the
Catch up action row's three controls (with each label set) to keep them on one
line, from the same draw and resize path as `fitHeader`. A tap in the panel
outside the open row's drawer closes the drawer; telling inside from outside
reads only `#tfcc-act-<id>` in the panel. A click outside the panel closes it
through one capture-phase `click` listener on the window, bound once like the
press-hold `pointerup` listener. That listener asks a single question,
whether `#tfcc-panel` contains the event's target. It reads no Torn markup,
never calls `preventDefault` or stops propagation, and redraws only the panel,
after the click has been dispatched, so Torn's own links behave exactly as
before. It is an event subscription, not a third DOM access.

The narrow markup is a branch of each renderer on `model.narrow`; the wide
markup is main's, byte for byte, and `tests/wide-parity.test.js` compares it
with a golden captured before #33. The transient view state (the open drawer,
the open filters, the open explanation, a drawer field's typed value) is a
pure state machine (`nextTransient`, `reconcileTransient`), reconciled after
every model build, and focus after a redraw follows `focusPlan`: the same
control, the next row, the previous row, then the view heading. While a press
that began in the panel is in progress, a redraw is held until its click, so a
commit-on-blur can no longer replace the node under the finger.

### Rendering, and why it is guarded three ways

The panel renders by replacing its own `innerHTML`. That is simple and keeps the
view a pure function of the model, but it destroys every node underneath it,
including the caret, the selection and any half-typed value. Three guards make
that safe.

**The navigation observer ignores our own writes.** It watches
`documentElement` with `subtree: true`, and the panel is inside that subtree, so
without a filter every render scheduled another one, forever, at the debounce
interval. The visible result was that no text box could hold a caret and clicks
landed on nodes that had already been replaced. `isOwnMutation` drops a batch
only when every record came from a node this script owns; a mixed batch contains
a real change and still gets through.

**An identical render is not written at all.** The last emitted HTML is kept on
the panel node and compared before assignment, because a browser normalises what
`innerHTML` reads back. Torn's own React churn therefore costs nothing.

**A background redraw never lands under a caret.** When an input, textarea or
select inside the panel has focus, a redraw that the user did not ask for is
held in `state.pendingRedraw` and flushed on `focusout`, once focus has settled
outside the panel. A redraw caused by the user pressing something is forced
through, because they need to see the result.

### Surviving the host stylesheet

The panel lives inside Torn's page, so Torn's CSS is competing with ours on
every element we emit. Two rules make that survivable.

`#tfcc-panel * { color: inherit; background: transparent; }` is the floor.
Inheritance is the weakest source in CSS - a value is inherited only when no
rule matches - so a bare `td { color: #000 }` on the host beats an inherited
color and paints black text on the dark panel, which is exactly what happened
to the API key disclosure table. `background` needs its own reset because it is
not inherited at all, which is how a host `code { background: #eee }` survived
the color fix and left grey text on a grey block. Both declarations are
(1,0,0) specificity, so every class rule and every explicit element rule below
still wins.

Elements a host page is most likely to have opinions about - table cells, `code`
- state their color and background outright rather than relying on that floor.

`tests/render-preview.mjs` renders every view twice, once plain and once under a
stylesheet that sets bare element rules the way a real host does. The plain
previews were too clean to catch either bug; the hostile ones catch both.

### Following Torn's theme

Match Torn measures the background the page actually paints and reads its
luminance, rather than looking for a class name. The class names it used before
were a guess that was never confirmed, and Match Torn did not in fact follow
Torn's web theme. Measurement cannot go stale that way; the class names and
`prefers-color-scheme` remain as fallbacks, and an unreadable style resolves to
"unknown" rather than to white.

A second, narrow observer watches `class` on `body` and `documentElement`,
because Torn's theme toggle is an attribute mutation and the navigation observer
only watches `childList`. Applying a theme changes two class names and no
markup, so following Torn costs no redraw and takes nobody's caret.

The two structural guards overlap on purpose: either alone stops the loop.
`tests/redraw.test.js` therefore tests `isOwnMutation` directly and counts route
callbacks rather than renders, or the overlap would hide whichever one broke.

## Badges

Fifteen local badges (issue #9). Every rule is a pure engine function of the
`tfcc:badges` record, organizer facts and `now`; a day is a Torn (UTC) day and
streaks are strict. One runtime choke point, `recordBadgeEvent`, re-reads the
key, applies one event and writes, so tabs usually see each other's work; this
is best effort, not atomic. A focused thread visit is 15 s on one thread
route while the page is visible and focused, sampled once a second and on
focus, blur and visibilitychange, which are page lifecycle signals and not
Torn's markup (ADR 0001). Rendering never writes, nothing is backfilled, and
no badge ever makes a request.

## Capture

The capture layer reads `location` and `document.title` and nothing else. It
records a visit, the thread title and the forum id, which is what makes search
over previously visited threads work before any refresh has happened. The
generic "Forums" title is not stored as a thread name, because Torn's SPA
updates the title after the route.

## Verification

Node only, no browser. `tests/load-userscript.js` reads the production file,
injects an export statement in memory only, and runs it in a `vm` context with
mocked globals. The file on disk is never modified by a test.

`tests/mutation-check.mjs` is run by hand. It breaks each of 227 user-visible
promises in turn and asserts the matching suite notices. It found six tests
that passed for the wrong reason and is the reason several of them now assert
absolute values rather than the constant they were testing.

`tests/render-preview.mjs` writes every view to standalone HTML using the real
stylesheet and the real markup. String assertions cannot see an unclosed tag,
a control with no contrast, or a layout that collapses at 375px; this is for
looking at those. It caught a long thread title wrapping onto its own line and
stranding the pin marker above it, which was a flex-basis of `auto` where
`flex-wrap` needs `0`.

Automated tests establish non-regression of these contracts. They cannot prove
Torn PDA's real injection or Torn's live API, so release stays blocked on
`docs/qa-checklist.md`.

This is a living document: update it in the same PR as any change it describes.

## Key decisions

See `docs/adr/`.
