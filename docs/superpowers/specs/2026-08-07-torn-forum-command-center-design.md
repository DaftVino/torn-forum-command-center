# Torn Forum Command Center — design

**Status:** approved for implementation, 2026-08-07.
**Target first release:** v0.1.0.

## What it is

A Tampermonkey and Torn PDA userscript that replaces Torn's small
subscribed-threads box with a full forum workspace on `forums.php`: folders,
tags, pinned threads, read/unread tracking, catch-up since last visit, locally
saved reply drafts, and search across the threads you follow — including the
author-plus-text search Torn's own UI never exposes.

Organization lives in script storage and never leaves the browser. Thread data
comes from the official Torn API v2 forum endpoints with a Minimal-access key.

## Why this shape

Three findings from research decided the architecture.

**Torn scoped this feature itself and never shipped the UI.** The Public API v2
project board thread (f=63, t=16407150) described a planned `forumUpdates`
selection — "new posts in subscribed threads, likes/dislikes, replies". The
endpoints shipped; the interface for them did not. This script is that
interface.

**The API is the sanctioned data path, and it is cheaper than scraping.**
Torn's scripting rules, corroborated across multiple staff and player threads,
allow a script to act on the official API or on a page the user has manually
loaded, with one user input producing one request, and prohibit background
scraping of pages the user is not viewing. `intent.md` anticipated this and
asked for page-and-local-capture over crawling. The API satisfies that
constraint better than DOM reading does: a full refresh is two requests instead
of a crawl, and it returns unread counts that no amount of HTML parsing would
produce.

**Nobody could confirm the current forums DOM.** The only real selectors that
research surfaced (`#forums-page-wrap`, `.threads-list`, `.post-wrap`) come from
userscripts predating Torn's React rewrite. Every data path in this design
therefore avoids Torn's markup. The capture layer reads only `location` and
`document.title`. DOM access is confined to two places — choosing a mount
container and finding the reply textarea — and both degrade visibly instead of
failing silently.

## Decisions taken

| Decision | Choice | Consequence |
|---|---|---|
| API key | **Required.** No degraded no-key mode. | One data path, one set of failure modes. The script shows a first-run key prompt and does nothing else until a valid key is stored. |
| Mount | **Collapsible full-width panel** above the forum content, with an expand-to-takeover toggle. | Never mutates Torn's own elements. A Torn redesign can move our panel but cannot break our data. |
| Torn's own subscribed box | Left alone by default; an off-by-default setting hides it. | Hiding is the only feature that depends on finding a Torn element, and it fails silently by design — the box simply stays visible. |
| Deep post search | **In v1.** Explicit, per-thread, bounded, cached. | Adds a separately droppable post cache with an LRU and a size cap. |
| Export / import | **In v1.** Versioned, validated, excludes the key and the post cache. | |
| Themes | Dark (default), Light, Match Torn. | |

## Architecture

One file, `torn-forum-command-center.user.js`, one IIFE, in two marked
sections. `tests/purity.test.js` reads the engine section and fails on a
forbidden reference, exactly as the Education Scheduler does.

- **Engine** — pure functions. Normalisers, the merge of API feed with local
  organizer state, the unread model, sorting, query parsing, search matching,
  cache eviction, export and import. No DOM, no network, no `GM_*`, no ambient
  clock: every function that needs the time takes it as an argument.
- **Runtime** — script storage, the API adapter, the rate limiter, the capture
  layer, the panel, and the bootstrap.

### Data flow

```
Torn API v2 ──► adapter ──► feed snapshot (tfcc:feed)
                                   │
local capture (location + title) ──┤
                                   ▼
organizer (tfcc:organizer) ──► merge (pure) ──► view model ──► panel
drafts (tfcc:drafts) ─────────────┘
post cache (tfcc:postcache) ──► deep search (pure) ──┘
```

The merge is the heart of the script and is pure, so every behaviour below is
testable without a browser.

### API surface used

All confirmed against `torn.com/swagger/openapi.json` plus three independently
generated clients and Torn PDA's production code.

| Endpoint | Access | Used for |
|---|---|---|
| `GET /user/forumsubscribedthreads` | Minimal | The subscribed list: `id`, `forum_id`, `title`, `author{id,username,karma}`, `posts{new,total}` |
| `GET /user/forumfeed` | Minimal | Recency and catch-up: `thread_id`, `post_id`, `title`, `timestamp`, `is_seen`, `type` |
| `GET /forum/categories` | Public | Real forum names for folder rules and row labels. Fetched once a day. |
| `GET /forum/{threadId}/thread` | Public | Enrichment: `last_post_time`, `last_poster`, `is_locked`, `is_sticky`, total `posts` |
| `GET /forum/{threadId}/posts` | Public | Deep search only. Paginated 20 per page. |

`forumsubscribedthreads` carries the unread count but no last-post time, and
that asymmetry drives the enrichment policy below.

### Request policy

A refresh is one user action. It issues:

- 1× `forumsubscribedthreads`
- 1× `forumfeed`
- 1× `forum/categories`, only when the cached copy is over 24 hours old
- up to **N× `forum/{id}/thread`**, default N = 10, for threads that have
  unread posts and no enrichment newer than 15 minutes

So a default refresh is at most 13 requests. The limiter enforces a minimum
650 ms gap between requests and a ceiling of 40 requests per rolling 60
seconds, comfortably under the ~100/minute the community reports. Every
endpoint is single-flight: a second refresh while one is in flight is ignored,
not queued.

Auto-refresh is **off** by default. When enabled it offers 2, 5 and 15 minute
intervals, runs only while the document is visible and the panel is open, and
pauses on `visibilitychange`.

Deep search is separately bounded: at most 5 pages (100 posts) per thread, at
most 10 threads per search, cancellable, with progress shown.

### Last-activity precedence

`forumsubscribedthreads` gives no timestamp, so last activity resolves in order:

1. `last_post_time` from the enrichment cache, if newer than 15 minutes.
2. The newest `forumfeed` timestamp for that `thread_id`.
3. The locally captured `lastVisitedAt` from a real visit.
4. Unknown — sorted last and labelled "unknown", never guessed.

Rows show which source they used on hover, so a wrong sort is diagnosable.

### The unread model

Torn owns the truth; the script adds a dismissal layer over it.

```
tornUnread      = posts.new
dismissed       = lastSeenTotal >= posts.total
effectiveUnread = dismissed ? 0 : tornUnread
```

"Mark read" sets `lastSeenTotal = posts.total`. It suppresses the thread locally
until Torn reports more posts; it does not and cannot clear Torn's own counter,
which only clears when the thread is actually opened. The panel says this
plainly rather than implying a sync that does not exist.

Catch-up lists threads where `!dismissed` and either `effectiveUnread > 0` or
the resolved last activity is newer than `lastCatchUpAt`.

### Storage

Six independent keys. Each carries a schema version; a value that fails
normalisation resets **that key only** and reports it visibly in the panel,
so a corrupt post cache can never cost the user their folders.

| Key | Holds |
|---|---|
| `tfcc:key` | The API key. Never exported, never logged, never in a debug report. |
| `tfcc:settings` | Theme, sort, refresh policy, enrichment budget, panel state. |
| `tfcc:organizer` | Folders, per-thread tags, pins, priority, notes, read markers, captured metadata. |
| `tfcc:drafts` | Reply drafts by thread id. |
| `tfcc:feed` | The last API snapshot, so the panel paints instantly on open. |
| `tfcc:postcache` | Deep-search post cache. LRU by thread, capped at 2000 posts and ~1.5 MB serialised. |

Per-thread organizer state survives unsubscribing: the captured title, forum
and author stay, and the row moves to an "Unsubscribed" state rather than
vanishing with the user's notes.

### The API adapter

Three tiers, tried in order, because Torn PDA is not Tampermonkey:

1. `PDA_httpGet` — Torn PDA's own bridge, which routes through the Flutter HTTP
   client and bypasses page CSP.
2. `GM_xmlhttpRequest` — Tampermonkey and Violentmonkey.
3. `fetch` — last resort.

The adapter never rejects. Every outcome is a value:
`{ok:true, data}` or `{ok:false, reason, detail}` where `reason` is one of
`timeout`, `network`, `http`, `parse`, `torn`, `throttled`, `nokey`. A 15
second timeout uses a timer race rather than `AbortController`, whose
availability varies across embedded webviews. Torn's own error envelope
(`{error:{code,error}}`) is mapped to named, actionable messages — code 2 is a
wrong key, code 5 is rate limiting, code 13 is a temporarily disabled key.

**Key redaction is a tested invariant.** The key never appears in a detail
string, a debug report, an export, or a console message. Any URL that reaches an
error path is stripped of its query string first.

### Torn PDA compatibility

Every lesson from the Education Scheduler's PDA work applies and is carried
forward as a test, not a comment:

- **ASCII-only source.** Torn PDA's `UserScriptsProvider.adaptSource` rewrites
  typographic quotes across the whole file before injection, which turned four
  curly apostrophes into syntax errors last time and stopped the script dead
  before bootstrap. A test rejects any non-ASCII character in the source.
- **`@run-at document-end`**, plus an explicit wait for a usable DOM, plus a
  short bounded poll for webviews that inject after `DOMContentLoaded` and
  `load` have already fired.
- **PDA ignores `@match`** and injects on every Torn page, so page scoping is
  enforced at runtime by a guard at least as strict as the metadata: hostname
  `www.torn.com` or `torn.com`, and pathname exactly `/forums.php`.
- **The PDA key slot.** Torn PDA substitutes the literal `###PDA-APIKEY###` in
  source at injection. The script reads that slot and, if it has been replaced
  with something key-shaped, offers it as the default key. The sentinel it
  compares against is assembled at runtime from three fragments so that PDA's
  own string replacement cannot rewrite the comparison too.
- The panel mounts a visible shell **before** any request, so a hung network is
  never indistinguishable from a script that failed to run.

### Mount and navigation

`forums.php` is hash-routed, so the panel mounts once and survives hash
changes. Bootstrap is idempotent and converges from `DOMContentLoaded`, `load`,
a bounded poll, `hashchange`, `popstate`, patched history methods, and a
debounced `MutationObserver`. None of these may create a second panel.

Mount selection tries a short ordered list of containers, each with its purpose
recorded beside it, accepts one only while it is still connected, and otherwise
uses an owned `#tfcc-fallback-mount` on `document.body`. The takeover mode is
`position:fixed; inset:0` with `100dvh` and internal scrolling, so it works on a
narrow PDA viewport without horizontal page overflow.

### Views

Five tabs.

**Threads** — the workspace. A filter bar (folder, tag, unread only, quick
text), a sort selector, and thread rows. Sorts: last activity, unread count,
title, author, forum, custom priority, date subscribed. Pinned threads always
head the list.

**Catch up** — everything new since the last visit, grouped by folder, with
per-thread jump links, "mark read", and "mark all read". Answers the
`forumUpdates` request directly.

**Search** — three things in one place:
- Metadata search across every thread the script knows, including your own notes
  and drafts.
- **Deep search** inside post bodies, explicit and bounded, over selected
  threads or a whole folder.
- A **native search launcher** that builds Torn's own `by:username keyword`
  query URL. Research found this syntax works but is reachable only by
  hand-editing the URL — this exposes it as a form. It is one click producing
  one navigation, which is exactly the "one input, one request" shape the rules
  describe.

Query syntax, shared by both search modes: bare words, `"quoted phrases"`,
`by:username`, `tag:name`, `folder:name`, `is:unread`, `is:pinned`, and a
leading `-` to negate any term.

**Drafts** — every saved draft with its thread. On a thread page the script
offers "save draft" and "insert draft"; insert writes through the native
textarea value setter and dispatches a bubbling `input` event so React notices.
Where no textarea is found, the buttons become "copy" and the panel says why.
Autosave of the reply box is on by default and is purely local.

**Settings** — key management, refresh and enrichment policy, theme, the folder
editor with per-forum auto-assign rules, hide-Torn's-box, scoped two-step reset
controls, cache size and clear, export and import, and a redacted debug report.

### Folders and watchlists

`intent.md` asks for separate watchlists for guides, faction discussions and
script releases. Folders are that mechanism, and auto-assign rules bind a
`forum_id` to a folder so new subscriptions file themselves.

Default folder names ship, but **no forum id is hardcoded**. `/forum/categories`
supplies real ids and names at runtime, and the Unfiled bucket offers a one-click
"always file this forum here" for each forum it actually sees. This matters
because whether faction forums appear in `forum_id` at all is unconfirmed, and a
guessed constant would fail silently where a data-driven rule simply shows the
user what exists.

### Themes

Two palettes on `#tfcc-panel`, using the `--tm-*` token names from Torn Bookie
Live Scores so the two scripts stay visually related. Dark is the default. Match
Torn reads Torn's own dark-mode body class, falls back to
`prefers-color-scheme`, then to dark. No font is set: the panel inherits Torn's,
which is what makes it read as part of the page.

### Export and import

A versioned `TFCC1:` string carrying folders, per-thread organizer state and
drafts. It excludes the API key and the post cache. Import validates the schema
version, shape and sizes, then reports what it will add and change and applies
only on confirm. Hostile input is rejected with a named reason, never partially
applied.

## Non-goals

- Posting, replying, editing, subscribing or unsubscribing. The script never
  writes to a Torn account.
- Background requests with no user present, page crawling, or any request to a
  page the user is not viewing.
- Notifications while the browser is closed, or a real RSS feed. Both were found
  as genuine player requests and neither is possible in a userscript; the
  in-panel activity view is the honest substitute.
- Syncing read state back into Torn, or across devices. Local state is local.
- Any third-party service. `@connect` names `api.torn.com` and nothing else.

## Security surface

- `@match https://www.torn.com/forums.php*`, narrowed further at runtime.
- `@grant GM_getValue`, `GM_setValue`, `GM_xmlhttpRequest`.
- `@connect api.torn.com` only.

`GM_xmlhttpRequest` is an escalation over the Education Scheduler's grant list
and is justified by exactly one thing: `api.torn.com` is cross-origin from
`www.torn.com`, and the API is the only sanctioned data path. `@connect` pins it
to one host. Widening any of these needs a stated reason in the PR description.

No secret is ever committed. The key is entered by the user, held in script
storage, masked in the UI, and redacted everywhere else.

## Risks

| Risk | Mitigation |
|---|---|
| The forums DOM is unconfirmed and may not match research | No data path touches it. Mount and textarea lookups are guarded, ordered, and degrade to a visible fallback. |
| `forumfeed` may not cover subscribed-thread replies | It is one input to the last-activity precedence chain, not the only one. If it proves empty, enrichment and capture still resolve activity, and the row labels the source. |
| Faction forums may not appear in `forum_id` | Folder rules are data-driven from `/forum/categories`; nothing is hardcoded. |
| Rate limits are community-reported, not documented | The limiter targets 40/minute against a reported 100, and error code 5 is handled as a named, backing-off state. |
| Post cache growth | Hard caps on count and serialised size, LRU eviction, its own storage key, and a one-click clear. |
| A Torn API schema change | Every response passes a normaliser that rejects rather than coerces, and the panel shows a named payload error with a debug report. |

## Verification

Node only, no browser, using the `vm` harness pattern from the Education
Scheduler: read the production file, inject an export statement in memory only,
run it in a context with mocked globals. The file on disk is never modified by a
test.

Automated tests can establish non-regression of these contracts. They cannot
prove Torn PDA's real injection behaviour or Torn's live API, so release stays
blocked on a signed-in manual QA pass on both desktop Tampermonkey and Torn PDA.
