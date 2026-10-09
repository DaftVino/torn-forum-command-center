# Changelog

All notable changes to this project are documented here. Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versioning: [SemVer](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.2.1] - 2026-10-09

### Changed

- On a phone, the reactions totals at the top of My posts are a small
  centered pill instead of a full-width button (#53): thumbs up, thumbs down
  and karma, with "-" for a figure not known yet. It is no longer tappable,
  since it already sits inside My posts. When some threads you started still
  show Torn's net rating, the status line under it says so ("Thumbs pending on
  1 of 3 threads you started."); a screen reader still hears the full figures,
  net included. Desktop is unchanged.
- The FCC logo is a muted dark blue (#2e4a66) on the light theme, at every
  width (#53). The old #5C768F was hard to see there; the dark theme keeps it.

## [0.2.0] - 2026-10-09

### Added

- A folder can claim more than one forum (#47). Settings shows each claimed
  forum as a chip with its own remove button, and a "Claim a forum..." menu
  adds another. A forum belongs to one folder at a time, so the menu lists
  only forums no folder has claimed. Removing a claim never moves a thread
  already filed; only new subscriptions are affected. Filing by hand still
  wins over a claim. Saved folders with one claim show it as one chip, and an
  export and import keeps every claim (a forum this device already gave to a
  folder keeps that folder). A forum that older saved data or an import puts
  in two folders stays with the first folder in your order, the one that
  already filed its threads, with no "damaged" notice.
- Tighter Settings on a phone (#47). On a narrow panel the gaps between
  Settings items shrink to one scale (4px from a label to its control, 8px
  between items, 12px between sections), a label shares its control's line
  where both fit, and each checkbox sits before its label with the info icon
  at the end of the line. Each folder is two lines: its name, the arrows and
  a bin-icon Delete (named "Delete <folder>"); then its forum chips and the
  claim menu. Unfiled is one line, its note under its name. Targets stay
  44px and text keeps its size. The Settings view is about 17 to 19% shorter
  at 375, 320 and 280px. Desktop is unchanged.
- Folder order (#45). Settings lists your folders and a built-in **Unfiled**
  with up and down arrows; the order sets the order of the Catch up groups and
  of every folder menu. Unfiled can be moved but not deleted or renamed. A
  saved workspace from before keeps working, with Unfiled last (Catch up used
  to sort its groups by name). Exports carry the order. The Threads view
  stays a flat list with its folder filter.
- Collapsible Catch up groups (#45). Each folder group's heading, Unfiled's
  too, is a toggle that hides or shows its rows; the choice is remembered on
  this device and is not exported. Mark all read still covers hidden rows.
- The Settings folder note now explains what folders are (they organise
  only threads you subscribe to, or file by hand, and never add other threads
  from a forum), how to use them and why they help (#45).
- Settings, author-only mode: its explanation now leads with what it does (a
  thread is flagged new only when its author posts, so other people's replies
  do not mark it new), and the checkbox has a hover summary (#45).
- A "Create a custom key on Torn" button in the Settings key section (#17). It
  opens Torn's own key page in a new tab, pre-filled with the name "Forum
  Command Center" and exactly the selections the script requests: `user`
  forumsubscribedthreads and forumfeed, `forum` categories, thread and posts.
  The user confirms the key on Torn and pastes it back. It is a plain link: the
  script makes no request for it and no key is ever placed in it. A test scans
  every API call site, so a new endpoint fails the suite until its selection is
  added. The link format was verified by the owner on 2026-10-09 (#45): the
  link Torn generated matched it exactly, and a test now pins that string.
- Settings, Appearance: **Clip titles and summaries that wrap**, on by default
  (#41). On, each thread row's title and note end in an ellipsis on one line
  instead of wrapping, at every width; on a phone the meta line does too, and
  opening a row's actions shows all three in full; on a desktop, hovering a
  clipped title or note shows the full text. Off, they wrap, on a phone too.
  Saved settings from before keep working and start with it on.
- Settings, Appearance: **Hide the panel when I open a thread**, on by
  default (#30). A plain click on a thread link in the panel (Threads, Catch up,
  Search, Drafts, and My posts) collapses the panel and leaves Expand, then the
  thread opens. Show brings it back. New-tab clicks and Torn's own links leave
  the panel alone. (#8)
- A My posts view listing the threads you started or posted in, from the
  Public `user/forumthreads` and `user/forumposts` selections. It has the same
  row actions, filters and sort as Threads, plus `is:started` and `is:posted`.
  (#2)
- Torn's own unread count (`new_posts`) for threads you started, and a local
  unread count for threads you only posted in, counted from the first time
  the script sees them, cleared by Mark read or by your own post, and
  labelled as a local count. A thread not yet looked up says so. (#2)
- A Rows shown setting in Settings: 3, 5, 10, 20, 30 or All. The default is
  5 (#30). It caps Threads, Catch up and
  My posts after every filter and the sort. A capped list says "Showing 10 of
  42" and offers Show all, which lasts until the page reloads. Search and
  Drafts always show everything, and the nav counts still count every
  thread. (#3)
- Settings, Refreshing: **Only flag new posts by the thread author**, off by
  default. In Threads and Catch up a thread then counts as new only when its
  author posted since you last looked: "2 new by author", "2+ new by author"
  for a lower bound, or "author: not checked" (with the reason) when the script
  does not know yet, never Torn's any-poster count. Catch up lists unchecked
  threads under their own heading, and Unread only, `is:unread` and Mark all
  read never treat an unchecked thread as known-empty. Each activity lookup
  reads the thread's posts since your marker, 20 a page, at most 3 pages a
  thread, from the same lookup allowance, so a refresh is still at most 13
  requests by default. My posts ignores the setting. The debug report counts
  unchecked and too-many rows. (#4)
- A line under the panel header totals the thumbs up and thumbs down on the
  threads you started, read from each thread's opening post inside the My posts
  refresh (at most 5 threads per run, each at most once every 12 hours; none
  when activity lookups are set to 0). Until a thread is checked it shows
  Torn's rating, labelled "net" (whether Torn's rating is net or likes only is
  not yet confirmed, so it is never split into up and down). It shows "-" until
  My posts has loaded and never a guessed number. Each thread you started shows
  its own figures in My posts. Torn's API has no subscriber count, so none is
  shown. (#10)
- The same line shows your forum karma after the thumbs, as an endless-knot
  icon and a number (no word), read from the author on lists My posts already
  fetches. Only when you have started no threads and written no posts does My
  posts read your profile once for it, at most every 12 hours (3 requests in
  all). It shows "-" until known. (#10)
- Badges (#9): fifteen badges for setup, focused thread visits, forums explored,
  a tidy desk, clearing a backlog, and finishing Torn days with Catch up empty
  (3, 10, 25, 100 and 500 in a row). A cup chip after the panel title shows the
  count and streak, and opens a shelf; the full list with progress is at the
  bottom of Settings, with an off switch. Earned locally; no request is made.
  Badges travel in an export and are merged by maximum on import, and Reset
  everything clears them. In author-only mode a thread not yet checked keeps
  the day from counting until a later refresh checks it.

### Changed

- The priority number on a thread row has its own blue, at every width, so it
  reads apart from the green "N new" beside it (#45). It is the logo's muted
  blue tuned per theme for text: #8db3d9 on dark (6.91:1 on the row) and
  #2e5680 on light (6.21:1 on the row).
- Expand shows every row in Threads, Catch up and My posts, with no
  "Showing N of M" line; Shrink brings the Rows shown cap back. A view you set
  to Show all stays that way. (#43)
- Every icon-only button has a hover note matching its name: the drawer's
  check mark ("Mark read"), the info buttons, the narrow header buttons, the
  row's Actions toggle and the Filters button. (#43)
- The narrow row drawer is more compact (#43). Priority is the desktop style,
  the number then small + and - buttons, right-aligned on the same row as Pin,
  Mark read, Draft and Archive. The folder menu, a Tag button and a Note
  button share the next row; Tag and Note open a small box in the panel with
  a field, Save and Cancel (Enter saves, Escape cancels, except while a
  keyboard is composing). Save adds a tag and never removes one: a tag the
  thread already has is kept, with "Already tagged". A saved note shows
  as a bar under the Note button. Desktop rows keep their inline fields.
- The My posts nav button uses the same colours as the other nav buttons, at
  every width: the normal fill, and the selected fill only while My posts is
  the current view, and the same weight (no longer bold alone on desktop).
  Its light-grey fill made it look selected. (#43)
- Every info button is drawn as a bare "i" icon, with no button fill or
  border, at every width. It keeps its tap target and focus ring; hovering it
  or opening it tints the icon instead of filling a box. (#43)
- The narrow drawer's priority starts with an info button that explains the
  number: your own ranking from -2 to +2, saved only on this device, which
  the My priority sort lists higher first, after pinned threads. (#43)
- The panel is see-through behind its content (#43): the panel's own
  background is 50% opaque and the thread rows 75%, so Torn's page shows
  through, with a light blur behind the panel. Buttons, fields, pills, the
  badge shelf and every other fill stay solid, and so does text. Expand stays
  solid. Over a page much lighter than a dark panel, or much darker than a
  light one, text that sits straight on the panel can be hard to read; the
  measured figures are in the #43 pull request. Settings, Appearance: **See-
  through background**, on by default, turns it off.
- The narrow drawer's Archive button shows an archive box (UXWing's "archive
  files" icon, inline and in the theme's text colour) instead of the
  wastebasket, so it reads as archive, not delete. (#41)
- Narrow view polish (#39). In the narrow layout only:
  - Catch up's "Mark all read", "Set catch-up point to now" and its info
    button share one line. Where the full labels would wrap they shorten to
    "All read" and "Caught up" (#41; it replaced an arrow label, "Catch-" up
    arrow "2" down arrow, that confused), measured on the panel's
    own nodes; screen readers keep the full names. At very large text the
    labels wrap inside their buttons instead of the row wrapping.
  - Each row's title, meta line and note are one line with an ellipsis until
    the row's drawer opens. The title keeps its full text for screen readers
    and its full-width tap band.
  - The open row's "..." becomes an X named "Close actions". A tap anywhere
    else, in the panel or outside it, closes the drawer and still does its
    own job. Outside clicks are seen by one capture-phase window listener
    that only checks whether the click was inside the panel and never cancels
    it.
  - The drawer is compact: Pin, Draft and Archive are monochrome pin, pencil
    and wastebasket buttons on one row with Mark read, named in words, and
    every drawer control is 32px with 8px gaps. Fields keep 16px text. The
    wastebasket means Archive, which can be undone.

- An unsubscribed thread of your own whose only local state is a visit or a
  read marker now lives in My posts rather than Threads. (#2)
- The Settings request note states the My posts budget: at most 12 requests
  by default (27 at the largest lookup setting), at most once every 15 minutes
  unless you press Refresh. (#2)
- The custom key link also asks for `user` forumthreads and forumposts, the
  two selections My posts reads. (#2)
- A My posts refresh is at most 17 requests at the default settings (was 12)
  and 32 at the largest (was 27); the Settings note says so. A Threads refresh
  is unchanged at 13. (#10)
- The custom key link also asks for `user` profile, read only by the karma
  fallback. (#10)
- The panel header shows the owner's FCC logo in place of the "Forum Command
  Center" text, inline, in its own colour `#5C768F`, one title line tall, with
  "Forum Command Center" as its accessible name. (#30)
- A thread row's priority moved out of the action row to sit right after the
  title: the adjustment as a number (0 by default), then small + and -
  buttons named "Raise priority" and "Lower priority". Pinning a thread no
  longer wraps Archive onto a second line. Storage and the Priority sort are
  unchanged, and the meta line no longer repeats the number. (#30)
- The reactions pill moved from its own row into the nav row, right before My
  posts, which it still opens. It drops the "Your threads:" label and shows
  thumbs-up and thumbs-down emoji in place of the words "up" and "down",
  drawn black on the light theme and white on the dark one. Screen readers
  still hear "up" and "down", and the hover notes, the "-" for unknown, the
  labelled net and karma are unchanged. (#30)
- "started" in My posts rows is red, in a shade per theme that meets WCAG AA
  on the row: `#ff8080` on Dark, `#a11414` on Light. (#30)
- A condensed layout for narrow panels (#33). When the panel itself is 600px
  wide or less (a phone, or a narrow column), the header is one line of icon
  buttons that scale between 44px and 24px, the six views are a 3 x 2 grid with
  their counts drawn faintly behind the labels, and Sort, Folder and Tag sit
  behind a Filters button. Rows give the title the full width; Catch up has a
  one-tap check mark to mark a thread read, and every row has an Actions button
  that opens its Pin, Draft, Archive, priority, folder, tag and note controls.
  Every control outside the header is at least 44px, text fields are 16px so
  iOS does not zoom, and focus lands on the next row after a row leaves. On
  narrow panels the reaction totals open My posts. Desktop is unchanged.
- Standing explanations in Catch up, My posts, Search and Settings are behind
  info buttons, at every size (#33). Live status, errors, the API terms table
  and the privacy lines stay visible; Settings still states the request budget
  in one visible line.

### Fixed

- The Settings key help, the error-16 message and the missing-key message now
  name **Minimal Access** as the key level to create, say Limited Access also
  works but is not needed, and keep saying Public Only does not work. They
  previously recommended a Custom key or Limited Access, and never named
  Minimal, which live probing showed is the actual minimum (#16).
- Upgrading no longer reports "Settings were damaged and have been reset" just
  because a release added a setting. Nothing was being reset. (#8)
- Upgrading no longer reports "Folders and tags were damaged" because a
  release added a per-thread field. A present field that is wrong, an unknown
  field and a dropped entry are still reported. (#4)
- A My posts fetch that fails after Reset everything or Clear key no longer
  shows its error; a late failure is dropped like a late answer. (#24)
- My posts now says "Slowing down to stay inside Torn's API limit." when its
  lookups stop at the rate limiter, as the spec asked. The rows not reached
  still say `not checked yet`, and the next run that is not throttled clears
  the notice. (#24)
- The debug report now counts the My posts rows the last run dropped because
  Torn sent them without an id, per list, as the spec asked. Counts only: no
  title, no content, no key. (#24)

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

- **The API key disclosure table was black text on the dark panel.** Its cells
  took their colour by inheritance, and inheritance is the weakest source in
  CSS: a value is inherited only when no rule matches, so any bare `td` rule on
  Torn's own stylesheet beat it. The panel now resets `color` and `background`
  on every descendant, and states both outright on the cells. `background`
  needed its own reset because it is not inherited at all.
- **Match Torn did not follow Torn's web theme.** It looked for a `dark-mode`
  class that was a guess and was never confirmed. It now measures the background
  the page actually paints and reads its luminance, falling back to the class
  names and then to `prefers-color-scheme`. A second, narrow observer watches
  for a class change, because Torn's toggle is an attribute mutation and the
  navigation observer only watches `childList`. Applying a theme changes two
  class names and no markup, so following Torn costs no redraw.

- **The panel redrew itself in a loop, roughly seven times a second.** The
  navigation observer watched `documentElement` with `subtree: true`, and
  rendering writes the panel's own `innerHTML` from inside that subtree, so
  every render scheduled another one. Text boxes could not hold a caret, so the
  API key could not be typed, and clicks landed on nodes that had already been
  replaced, so buttons intermittently did nothing. Three guards now: the
  observer ignores mutations from nodes this script owns, an identical render is
  not written at all, and a redraw the user did not ask for is deferred while an
  input inside the panel has focus and flushed when focus leaves.

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

[Unreleased]: https://github.com/DaftVino/torn-forum-command-center/compare/v0.2.1...HEAD
[0.2.1]: https://github.com/DaftVino/torn-forum-command-center/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/DaftVino/torn-forum-command-center/compare/v0.1.0-rc6...v0.2.0
[0.1.0]: https://github.com/DaftVino/torn-forum-command-center/releases/tag/v0.1.0
