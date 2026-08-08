# Changelog

All notable changes to this project are documented here. Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versioning: [SemVer](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

Nothing yet.

## [0.1.0] - 2026-08-07

First release. Blocked on the signed-in QA gate in `docs/qa-checklist.md`.

### Added

- A full forum workspace on `forums.php`, replacing Torn's small
  subscribed-threads box. Collapsible inline panel with an expand-to-takeover
  toggle; it never mutates Torn's own elements.
- Folders, tags, pinned threads, a -2 to +2 priority, and private notes. A
  folder can claim a forum so new subscriptions file themselves, and filing by
  hand always wins over a rule. Deleting a folder unfiles its threads rather
  than deleting the work hanging off them.
- Read and unread tracking from Torn's own `posts.new`, with a local dismissal
  layer. The panel states plainly that this cannot clear Torn's counter.
- A catch-up view of everything new since the last visit, grouped by folder.
- Seven sort modes, with pinned threads first in all of them and an unresolved
  activity time sorted last rather than treated as zero. Each row reports which
  source its time came from.
- Reply drafts saved on the device, with optional autosave, insertion into
  Torn's reply box through the native value setter so React keeps the text, and
  a Copy fallback with an explanation where no reply box is found.
- Search over titles, authors, forums, notes and tags, and deep search inside
  post bodies for chosen threads with an LRU cache. One query syntax for both:
  bare words, quoted phrases, `by:`, `tag:`, `folder:`, `is:`, and `-` to
  exclude.
- A launcher for Torn's own forum search, which understands `by:player words`
  but has never exposed a box for it.
- Versioned export and import of folders, tags, pins, priorities, notes, read
  markers and drafts. Additive, reports its effect before applying, and refuses
  a damaged string by name without changing anything.
- Dark and light themes plus Match Torn, and a redacted debug report.
- Torn PDA support: `document-end` injection, a bounded DOM-readiness wait, a
  runtime page guard because PDA ignores `@match`, the `###PDA-APIKEY###` slot
  with a sentinel assembled at runtime, and an ASCII-only source enforced by a
  test.
- A three-tier request adapter: Torn PDA's own bridge, then
  `GM_xmlhttpRequest`, then `fetch`. It never rejects.
- A client-side rate limiter: a 650 ms minimum gap and 40 requests per rolling
  minute. A default refresh is at most 13 requests.
- Autosave of the reply box into a draft, debounced, and never deleting a
  saved draft when the box is empty.
- 249 tests, `tests/mutation-check.mjs`, which breaks each of 23 user-visible
  promises and asserts a test notices, and `tests/render-preview.mjs`, which
  writes every view to standalone HTML for a look at the real markup.

### Security

- The API key is never exported, logged, or included in a debug report. Every
  detail string is scrubbed of URLs and `key=` pairs, because a browser's own
  network error text quotes the request URL that this script never built.
- `@connect` names exactly one host, `api.torn.com`. Only GET requests are ever
  made, and nothing is ever written to a Torn account.
- Every value that reaches the panel is HTML-escaped, and forum HTML is reduced
  to text without ever constructing a DOM node.

[Unreleased]: https://github.com/DaftVino/torn-forum-command-center/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/DaftVino/torn-forum-command-center/releases/tag/v0.1.0
