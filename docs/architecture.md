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
Custom key with exactly those two, because that is the least access that works,
and names Limited Access as the preset equivalent. It deliberately does not name
a preset as the requirement: the docs colour-code both selections as Minimal
Access, but the key page does not offer that as a choice, so naming the
selections is both accurate and stable.

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
choosing a mount container and finding the reply textarea, and both degrade
visibly rather than failing silently.

### The five endpoints

| Endpoint | Access | Used for |
|---|---|---|
| `user/forumsubscribedthreads` | own selection | The subscribed list and `posts.new`, the unread count |
| `user/forumfeed` | own selection | Recency and catch-up |
| `forum/categories` | Public | Real forum names, fetched at most once a day |
| `forum/{id}/thread` | Public | `last_post_time` enrichment, budgeted |
| `forum/{id}/posts` | Public | Deep search only, explicit and bounded |

`forumsubscribedthreads` carries the unread count but no last-post time. That
asymmetry is why enrichment exists and why last activity resolves from several
candidates rather than one.

A refresh is one user action and at most 13 requests by default: two fixed
calls, one category call at most daily, and up to ten enrichment lookups for
threads that have unread posts and no recent time. The limiter enforces a
650 ms gap and a ceiling of 40 requests per rolling minute, against the ~100
the community reports. Auto refresh is off by default.

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

### Last activity

Resolved from the newest of several candidates, not the first available one: a
fresh enrichment can still be older than an activity row that arrived since.
Each row reports which candidate won (`enriched`, `feed`, `enriched-stale`,
`visit`, `none`), so a surprising sort order is diagnosable from the row. An
unresolved time is `null` and sorts last; it is never treated as zero.

### Storage

Six independent keys, each with a schema version. A value that fails
normalisation resets that key only and is reported visibly, so a corrupt post
cache cannot cost the user their folders. An unparseable value is distinguished
from an absent one, because collapsing the two is how someone loses everything
in silence.

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

The two structural guards overlap on purpose: either alone stops the loop.
`tests/redraw.test.js` therefore tests `isOwnMutation` directly and counts route
callbacks rather than renders, or the overlap would hide whichever one broke.

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

`tests/mutation-check.mjs` is run by hand. It breaks each of 23 user-visible
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
