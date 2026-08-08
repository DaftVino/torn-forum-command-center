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

### Fixed before release

- Links in the Search and Drafts views had no colour rule of their own and fell
  back to the browser default `rgb(0, 0, 238)`, which reads as black against the
  dark panel. Every anchor is now coloured in every state, including `:visited`,
  which would otherwise have gone purple.
- Dropdown options carry the panel colours. On some platforms the popup is drawn
  by the OS and defaults to black on white regardless of the select.
- The panel no longer tells people to create a **Minimal** access key. The API
  docs colour-code both selections it needs as Minimal Access, but Torn's key
  page does not offer that as a choice, so it now names the selections instead:
  a Custom key with `forumsubscribedthreads` and `forumfeed`, or Limited Access.

### Compliance

- Checked clause by clause against Torn's verbatim scripting rule and the API
  acceptable usage terms; see `docs/rules-compliance.md`.
- A key Torn rejects (codes 2, 13, 16, 18) is dropped on error and never sent
  again, persisted across reloads. The API terms require this and name a
  temporary IP ban as the penalty for retrying an invalid key. Temporary errors
  (5, 9, 10, 11, 17) deliberately do not condemn the key.
- The API terms disclosure table is rendered next to the key input in Settings,
  which is where the terms require it: who can see the data, what it is for,
  storage, access level, and what requests are made.
- Auto refresh stops when the page is hidden or unfocused, not merely hidden.
- No alerts, confirms or prompts, no Notification API, no Audio, no vibrate, no
  title or favicon writes, no window opening, no `window.focus`, no
  `scrollIntoView`. The one `focus()` call puts the caret in the reply box after
  the user clicks Insert, which is element focus inside the page they are on.
- The README leads with a read-only statement rather than burying it after the
  feature list, because it is the first thing anyone installing a script that
  asks for an API key should be able to read.

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
