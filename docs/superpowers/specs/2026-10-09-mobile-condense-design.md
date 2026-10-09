# Condense the narrow mobile view (#33)

**Status:** Approved by the owner on 2026-10-09, with the changes in section 13. It was revised after the Codex adversarial review (section 11).
**Issue:** #33, part of #20.
**Scope:** The panel at 320-375px, inline and in Expand (takeover). The desktop
layout does not change.
**Mockups:** `docs/designs/mockups/33-mobile/` (see its README).

## 1. Audit

Measured on `tests/render-preview.mjs` output (`threads-narrow.html`), in a real
browser via gstack browse, at 375px and 320px viewports. The preview frame
gives the panel 343px and 288px of width. Inside the panel's 8px padding that
leaves 325px and 270px for content. Five rows are shown (Rows shown = 5).

### 1.1 Above the first thread row

| Element | What it is | Use | 375px | 320px | Tap target |
|---|---|---|---|---|---|
| Logo | `LOGO_SVG`, 28px tall | identity | line 1 | line 1 | not a control |
| Badge chip | `data-act="badges-shelf"`, cup + count + streak | occasional | line 1 | line 1 | 44-72 x 28 |
| "16 new" badge | total unread | glance, every visit | line 2 | line 2 | not a control |
| "6 subscribed" | subscribed count | rare | line 2 | line 2 | not a control |
| Refresh | `data-act="refresh"` | often | line 3 | line 3 | 67 x 29 |
| Expand / Shrink | `data-act="takeover"`, aria-pressed | sometimes | line 3 | line 3 | 65 x 29 |
| Hide / Show | `data-act="collapse"` | often (and #8 sets it) | line 3 | line 3 | 47 x 29 |
| **Header total** | `.tfcc-head` | | **91px, 3 lines** | **91px, 3 lines** | |
| Threads | `data-act="view" data-view="threads"` | most | nav line 1 | nav line 1 | 69 x 29 |
| Catch up (3) | `data-view="catchup"` | daily | nav line 1 | nav line 1 | 95 x 29 |
| Search | `data-view="search"` | occasional | nav line 1 | nav line 1 | 62 x 29 |
| Drafts (1) | `data-view="drafts"` | occasional | nav line 1 | nav line 2 | 76 x 29 |
| Settings | `data-view="settings"` | rare | nav line 2 | nav line 2 | 69 x 29 |
| Reactions pill | `data-act="view" data-view="mine"`, thumbs + karma | glance | nav line 2 | nav line 2 | 222 x 29 (22 at 320) |
| My posts (1) | `data-view="mine"`, `.tfcc-nav-mine` | daily | nav line 3 | nav line 3 | 100 x 29 |
| **Nav total** | `.tfcc-nav` | | **99px, 3 lines** | **127px, 4 lines** | |
| Filter field | `data-act="filter"` | often | bar line 1 | bar line 1 | full x 29 |
| Sort | `data-act="sort"` | rare | bar line 2 | bar line 2 | 136 x 26 |
| Folder filter | `data-act="folder-filter"` | sometimes | bar line 2 | bar line 3 | 142 x 26 |
| Tag filter | `data-act="tag-filter"` | sometimes | bar line 3 | bar line 3 | 119 x 26 |
| Unread only | `data-act="unread-only"`, aria-pressed | often | bar line 3 | bar line 4 | 94 x 29 |
| **Filter bar total** | `.tfcc-bar` | | **96px, 3 lines** | **128px, 4 lines** | |
| **First row starts at** | | | **319px** | **379px** | |

A phone shows roughly 550-600px of PDA web view, and Torn's own page header
sits above the panel. On the first screen the user sees the panel's controls and
at most the top of one thread.

### 1.2 One thread row (`renderRow`)

| Element | What it is | Use | Tap target |
|---|---|---|---|
| Pin marker `*` | pinned | glance | not a control |
| Title link | `data-tfcc-thread`, opens the thread, triggers #8 auto-hide | most | the text |
| Priority number | `.tfcc-prio`, e.g. `+2` | glance | not a control |
| Priority + | `data-act="prio-up"` | rare | **22 x 16** |
| Priority - | `data-act="prio-down"` | rare | **22 x 16** |
| "3 new" | unread, or author-only and local-count variants | glance | not a control |
| Notes | not checked yet / not subscribed / locked | glance | not a control |
| Meta line | started / posted in, thumbs, time, forum, author, folder, draft, tags | glance | not a control |
| Note text | the user's note | glance | not a control |
| Pin / Unpin | `data-act="pin"` | sometimes | 43 x 22 |
| Mark read | `data-act="read"` | daily in Catch up | 66 x 22 |
| Folder | `<select data-act="folder">` | rare | 119 x 22 |
| Add tag | `<input data-act="tag-input">` | rare | 84 x 22 |
| Note | `<input data-act="note-input">` | rare | 120 x 22 |
| Draft / Edit draft | `data-act="draft"` | sometimes | 60 x 22 |
| Archive / Unarchive | `data-act="archive"` | rare | 52 x 22 |

Measured row heights for the five sample rows:

| | Row 1 | Row 2 | Row 3 | Row 4 | Row 5 | Sum | Action block |
|---|---|---|---|---|---|---|---|
| 375px | 192 | 149 | 123 | 165 | 102 | **731** | 47-72px, 2-3 lines |
| 320px | 234 | 195 | 169 | 211 | 148 | **957** | 72px, 3 lines |

The panel is 1146px tall at 375px and 1432px at 320px. There are 67 interactive
controls on screen for five threads.

### 1.3 Problems

1. **The chrome takes the first screen.** 319px (375) and 379px (320) come before
   any thread, which is more than half the visible area. The task the user came
   for (scan the threads) starts below the fold.
2. **Every row carries its whole toolbox.** Eleven controls per row, used
   rarely, cost 47-72px each. That is 35-45% of the row. They also make the rows
   look the same, so the eye cannot find the titles and unread counts.
3. **The tap targets are desktop sized.** Action buttons are 22px tall, and the
   priority +/- are 22 x 16, under even the WCAG 2.2 AA minimum of 24px. The
   header and nav buttons are 29px. On Torn PDA these are all touch targets.
4. **Inline priority squeezes the title.** At 320px the number, +, - and
   "3 new" sit on the title's line, so "A practical education guide and script
   companion" wraps to four lines in about half the row's width.
5. **The nav wraps unevenly.** Six views plus the pill wrap to three or four
   ragged lines. My posts ends up alone on the last one, and the pill's width
   decides the break points.
6. **Text inputs are under 16px.** iOS zooms the page when a field under 16px
   gets focus. The filter, tag and note fields are 12-14px, so focusing one
   zooms and shifts the page.
7. **The header spreads three small facts over two lines.** "16 new" and
   "6 subscribed" take a line of their own at both widths. The control group
   wraps whole, which keeps the 320px rule, but costs a third line even at 375.

## 2. Principles for this panel on a phone

Revised after the Codex review (section 11). The original principle 6, "markup
and CSS only", was wrong and has been replaced.

1. **Threads sooner.** Move the first row well up the screen, but never by
   hiding a frequent task. The first draft optimised a pixel number. This
   revision optimises the tasks the user actually repeats.
2. **Show what you read, hide what you change rarely.** Titles, unread counts,
   pins, tags and notes stay on the row. Rare edits go one tap away.
3. **Frequent tasks stay one tap, and stay visible.** These are: opening a
   thread, every view (including Search), Refresh, Hide/Show, Unread only, the
   filter field, and Mark read in Catch up, which is a triage view. Sort, the
   folder and tag filters and rare per-row edits are two taps away.
4. **Real boxes, no pseudo targets.** Every control in the narrow layout has a
   box at least 44px wide and 44px tall (`min-width` / `min-height`, never a
   fixed height). No pseudo-element hit areas, and no box overlaps another.
   The one owner-approved exception is the header: its buttons scale from
   44px down to a 24px floor to keep the header on one line (section 13b).
5. **No gestures, no hover, no floating layers.** Every disclosure is an inline
   region under its button. Nothing depends on swipe or long-press. Visible
   text, not `title`, carries the meaning of every control a sighted user needs.
6. **Same actions, new places, explicit state.** Every existing `data-act` keeps
   its name and handler. The new transient state (the open row, the open
   filters) is a small state machine with a defined transition for every
   redraw path, and focus has a defined destination for each one.

## 3. Three concepts (first draft)

These are the first-draft concepts the review saw, kept for the record.
Section 4 supersedes them. All three shared a one-line header: the logo at
24px, the badge chip, and then Refresh, Expand and Hide as 40 x 44 icon
buttons with aria-labels. "16 new" moved into the nav, and "6 subscribed"
moved into the Threads count's accessible label and into Settings.

### Concept A: Toolbar and drawer

Mockup: `concept-a-toolbar-drawer.html` / `.png`

```
+--------------------------------------------------+
| FCC (cup 4 flame 5)            [ref] [exp] [^]   |  44px
| [Threads ][Catch up][My posts][ More   ]         |  44px, 4 equal cells
| [ 16 new ][   3    ][   1    ][Drafts 1]         |  (label over count)
| [filter threads..........] [Unread] [Y 1]        |  44px
|--------------------------------------------------|
| * A practical education guide and   3 new [...]  |
|   12m Tutorials and Guides by DaftVino Guides    |
|   [draft] [reference]                            |
|   The one to link people to.                     |
|--------------------------------------------------|
| SideWinder - Advanced Sidebar...   12 new [ x ]  |
|   +2 1h Tools and Userscripts ...  [read-later]  |
|   [ Pin        ] [ Mark read    ]                |  drawer, open
|   [ - ]      Priority +2       [ + ]             |
|   [ Folder: Scripts and tools          v ]       |
|   [ add tag    ] [ note         ]                |
|   [ Draft      ] [ Archive      ]                |
+--------------------------------------------------+
```

- **Header:** one line, as above.
- **Nav:** a segmented row of four equal cells: Threads (16 new), Catch up (3),
  My posts (1) and More. My posts keeps its light-grey #30 styling. More
  shows "Drafts 1" while there is a draft. It opens an inline menu with Search,
  Drafts, Settings and the reactions pill. When the current view is in More,
  the More cell shows its name and is pressed.
- **Filter line:** the field (16px text), Unread only, and a filter button that
  shows the number of active filters. It opens Sort, Folder and Tag as 44px
  selects in a two-column grid.
- **Rows:** the title, then the unread count and a 40 x 44 "..." toggle on the
  same line. The priority number moves into the meta line (`+2`), shown only
  when it is not zero. One drawer is open at a time. It holds today's controls
  at 44px: Pin, Mark read, a priority stepper (- / value / +), Folder, Add tag,
  Note, Draft and Archive.

Trade-offs:
- (+) The smallest behaviour change. Every action keeps its `data-act`, and
  only its container moves. String tests keep working.
- (+) First row at 165px (375) instead of 319. Five rows take 461px instead of
  731 at 375, and 541px instead of 957 at 320.
- (-) Pin and Mark read cost two taps instead of one.
- (-) The reactions pill is no longer visible from Threads. It is one tap away
  in More, and it still shows in My posts.
- (-) New view state: `navMoreOpen`, `filtersOpen` and `openRowId`. None of it
  is persisted.

### Concept B: Thumb dock

Mockup: `concept-b-thumb-dock.html` / `.png`

```
+--------------------------------------------------+
| FCC (cup 4 flame 5)       [gear][ref][shr][^]    |  44px
| [filter threads..........] [Unread] [Y]          |  44px
|--------------------------------------------------|
| * A practical education guide and script  3 new  |
|  [12m Tutorials and Guides by DaftVino ...]      |  <- the whole meta area
|--------------------------------------------------|     is one toggle
| SideWinder - Advanced Sidebar for Torn   12 new  |
|  [+2 1h Tools and Userscripts ...]               |
|  [ Pin ][ Read ][ Prio+ ][ Prio- ]               |  icon grid, open
|  [Folder][ Tag ][ Draft ][Archive]               |
|                     ...                          |
|==================================================|
| [=16 ] [o 3   ] [ Q    ] [/ 1  ] [@ 1    ]       |  sticky dock, 52px
| Threads Catch up Search  Drafts  My posts        |
+--------------------------------------------------+
```

- The views move to a **dock at the bottom of the panel**, with five icon-and-label
  tabs and count bubbles. Settings becomes a gear in the header. The dock is
  `position: sticky; bottom: 0`, so it stays in the thumb zone while the list
  scrolls.
- **Rows expand when the user taps the meta area.** That area is one `<button>`,
  separate from the title link, so #8's auto-hide never sees it. The expanded
  row shows an icon grid with labels, 52px tall. Folder and Tag open their
  pickers in place.
- Built for Expand. In takeover the panel is its own scroll box, so sticky
  is under the script's control.

Trade-offs:
- (+) The fewest pixels: first row at 113px, and the views are always in reach
  of the thumb.
- (+) It makes Expand feel like an app, which is how a PDA user lives in it.
- (-) **Sticky inline depends on Torn's ancestors.** Any `overflow` or
  `transform` on a parent breaks it, and ADR 0001 forbids reading Torn's DOM to
  find out. Inline, the dock could end up under 600px of list. Mitigation: dock
  in takeover only, and a top nav inline. That means two navigation layouts to
  keep in step.
- (-) The meta-area toggle is a large target, but a hidden one. Nothing says
  "tap here", and it is only 24px tall on a one-line meta. It needs a chevron.
- (-) It moves the nav users already know from top to bottom.

### Concept C: Inbox and select

Mockup: `concept-c-inbox-select.html` / `.png`

```
+--------------------------------------------------+
| FCC (cup 4 flame 5)            [ref] [exp] [^]   |  44px
| [Threads (16) v] [filter.............] [Y]       |  44px; becomes the
|--------------------------------------------------|  action bar on select
| [ ] * A practical education guide and         3  |
|       12m Tutorials and Guides Guides [draft]    |
| [x]   SideWinder - Advanced Sidebar for...   12  |
|       +2 1h Tools and Userscripts ...            |
|--------------------------------------------------|
  with a selection:
| 2 selected                          [x Clear]    |
| [Pin][Read][Folder][Tag][Archive][More]          |  sticky, 48px
```

- **The views become one switcher button** ("Threads 16 v") that opens a 44px
  list of all six views with their counts, plus the reactions pill. The
  filter shares its line.
- **Rows are inbox rows** with a select box (36 x 44) on the left and no
  per-row actions. Selecting rows turns the second line into a contextual
  action bar that acts on all of them. More holds priority, Note and Draft,
  and is enabled for a single selection.
- **New capability: bulk actions.** Mark five threads read, or file three into
  a folder, in one go.

Trade-offs:
- (+) The calmest list. The rows are titles, counts and tags, and nothing
  else. The second line is either navigation or actions, never both.
- (+) Bulk Mark read is useful in Catch up.
- (-) **It is new behaviour, not condensing.** Selection state, bulk handlers and
  bulk engine helpers all need tests. It is a feature in its own right.
- (-) The select box takes 36px of every row's width, so titles wrap sooner.
- (-) One action on one thread takes two taps (select, act), plus Clear.
- (-) A switcher hides which views exist. A first-time user sees "Threads" and
  not Catch up.
- (-) The author name leaves the meta line to keep rows short.

### Rejected along the way

- **Swipe actions.** They conflict with Android's edge-back gesture and any
  horizontal gesture the host app uses, they cannot be discovered, and they
  need a visible fallback anyway, which is Concept A's drawer. They would be a
  layer on top of A, not an alternative to it.
- **Floating menus and bottom sheets.** Positioning over Torn's page fights
  unknown z-index and overflow rules. Every disclosure here is inline.
- **Horizontally scrolling nav.** It hides views off-screen, and
  `horizontal-scroll` is on the list of things to avoid.

### The first-draft recommendation (superseded)

The first draft recommended Concept A as drawn. It made every row action two
taps, put Search, Drafts, Settings and the reactions pill behind More, and used
40 x 44 icon buttons with an `::after` hit area on the chip. It condensed
on the viewport `@media (max-width: 600px)`. The Codex review
(`docs/records/review/2026-10-09-mobile-condense-codex.md`) returned
**rethink**: the 44px claim was false, the Catch up triage loop got slower,
Search and Show lost their visible labels, the breakpoint watched the wrong
width, and the redraw and focus cases were not specified. Section 4 is the
answer to that review. Section 11 records each finding and what became of it.

## 4. Recommendation: task-first A (owner-approved, as amended)

The owner approved this design on 2026-10-09, with the changes recorded in
section 13. This section is the approved design with those changes folded in.

Mockups: `revised-375.html` / `.png` and `revised-320.html` / `.png`. Each
shows, in dark and light:
- Threads at rest;
- Catch up with a one-tap Read, with its info closed, then with info open and
  one drawer open;
- filters open and the badge shelf open;
- a drawer open in Threads;
- My posts with the reaction totals, info closed and open;
- the collapsed header.

The 320px file adds a 200% text frame and four frames at 280px.

```
375px (325px of content)                 320px (270px of content)
+------------------------------------+   +-------------------------------+
| FCC (cup 4 flame 5)  [ref][exp][^] |   | FCC (cup 4 5)    [ref][exp][^]|  one line; buttons
|------------------------------------|   |-------------------------------|  44px at 375, 41 at 320
| [Threads 16][Catch up 3][ Search ] |   | [Threads 16][Catch up 3][Srch]|  2 x 44
| [Drafts 1 ][Settings  ][My posts 1]|   | [Drafts 1][Settings][My posts]|
|------------------------------------|   |-------------------------------|
| [filter threads......][Unread][Y 1]|   | [filter.......][Unread][Y 1]  |  44
|------------------------------------|   |-------------------------------|
| * A practical education guide and  |   | * A practical education       |
|   script companion                 |   |   guide and script companion  |
| 3 new 12m Tutorials and ...  [...] |   | 3 new 12m Tutorials  [...]    |  >= 44
|------------------------------------|   |-------------------------------|
  Catch up:
| Catch up  since 7 Aug 12:00        |
| [Mark all read] [Set catch-up point to now] [i] |
| SideWinder - Advanced Sidebar for  |
| 12 new +2 1h Tools ... [v Read][...]|
```

### 4.1 Header: one line, buttons that scale

- **Icon buttons that never wrap.** Refresh, Expand/Shrink and Hide are icon
  buttons: inline ASCII SVG, an `aria-label`, and the existing `data-act`
  values. They stay together in `.tfcc-head-btns`, with 4px gaps.
- **Their size is `--tfcc-hb`:** 44px at most, 24px at least. It shrinks
  continuously as the panel narrows, so the header stays on **one line**.
  Section 13b gives the mechanism and the maths, measured on the mockups:

  | Panel content width | Button size |
  |---|---|
  | 375px (325px) | 44px |
  | 320px (270px) | 41px |
  | 280px (230px) | 35px |

- **The chip is a button as tall as the header buttons.** It has no border or
  fill of its own. The pill you see is a child `<span>`, at most 28px tall, so
  nothing overlaps. Below a 36px button size the pill drops to compact padding,
  4px instead of 8px, but its 12px text never shrinks.
- **The logo scales with the buttons:** height `clamp(16px, 0.545 x size,
  24px)`.
- **Collapsed, Show is text.** The third button reads "Show" beside a chevron.
  The collapsed header shows the unread count as a bare **"16"** text badge in
  the logo-and-chip group, with the accessible name "16 new" (section 13a). That badge is what wraps beneath the logo
  when space runs out, never a button. Expanded, Hide is a chevron-up icon
  named "Hide the panel".

### 4.2 Nav: all six views, no More

- **A 3 x 2 grid of 44px-minimum cells, in `VIEWS` order:** Threads, Catch up and
  Search on top, then Drafts, Settings and My posts below. Search is visible.
  My posts stays last and right with its #30 light-grey style, which keeps
  the QA checklist's "My posts is last and reachable" true.
- **Counts are a decorative numeral behind the label: variant v1 tint, the
  owner's choice (section 13f).**
  - Each count is a large numeral, centred and nearly the cell's height, drawn
    in the label colour at 14% opacity (9% on the selected cell).
  - The label sits on top at 90% opacity (96% selected), always on one line,
    so a cell never wraps.
  - A count of 0 draws no numeral. Search and Settings have none.
  - The numeral is decorative (`aria-hidden`). The count is carried in each
    cell's accessible name ("Threads, 16 new, 6 subscribed"; "Catch up, 3";
    "Drafts, none").
  - This supersedes the number-only badges of owner decision a.
- **Why there is no More.** The review asked for a labelled More. Removing it
  is stronger: every view is visible, there is no menu state, and the review's
  More-focus finding cannot happen. It costs one 44px row compared with the
  first draft, which is the price of discoverability.
- **Reaction totals** (thumbs and karma), revised by the owner (section 13c):
  - **Narrow panels:** they appear as the first line of My posts, using the
    existing pill markup.
  - **Wide panels (desktop):** the pill **stays in the nav row before My
    posts**, exactly as on main, and still opens My posts. The desktop nav is
    unchanged from main.

### 4.3 Filter line

- The filter field (16px text, so iOS does not zoom), then Unread (a 44px
  toggle with `aria-pressed`), then Filters.
- **Filters** is 44 x 44 or wider, showing a funnel and the number of active
  filters. Its accessible name is dynamic ("Filters, 1 active"), with
  `aria-expanded` and `aria-controls="tfcc-filters"`.
- Opening it shows Sort, Folder and Tag as 44px selects in an auto-fit grid.
- At 280px the Filters button wraps under the field. That is allowed: only the
  header must stay on one line.

### 4.4 Rows

```
| [*] Title, as a block link across the row width, wrapping freely        |
| [3 new] [+2] 12m  Forum  by Author  Folder  [draft] [tag] [Read] [...]  |
| note text                                                               |
| ( drawer when open )                                                    |
```

- **The title has the whole row width.** Unread, priority and the buttons
  move to line 2, so the first sample title takes 2 lines at 320 instead of 4.
- **The open-thread target is the whole title band.** The anchor becomes
  `display: block` with 3px vertical padding. The tap target is the full
  title width, and at least 24px tall (WCAG 2.2 AA). A two-line title is 44px.
  It is still the one `data-tfcc-thread` anchor, so #8's plain-click rule is
  unchanged.
- **Line 2** is the meta (unread first, in green bold) wrapping on the left,
  and the buttons on the right, each 44 x 44 or wider:
  - **Catch up only:** a visible **Mark read** button (section 13e).
    - It shows the check mark alone, with no "Read" text.
    - It is 44 x 44, with `data-act="read"`, `aria-label="Mark read"` and
      `aria-describedby` pointing at the row's title link
      (`id="tfcc-title-<id>"`), so a screen reader hears which thread.
    - Triage stays one tap.
  - **Every view:** an **Actions** button ("...", `data-act="row-more"`,
    `aria-expanded`, `aria-controls="tfcc-act-<id>"`, aria-label "Actions for
    <title>").
- **The drawer** (one open at a time) holds Pin/Unpin, Mark read, Draft/Edit
  draft and Archive. Mark read is the same check-mark-only button and is left
  out in Catch up, where it is already visible. Below those
  are a priority stepper (- / value / +, each 44 x 44), Folder, Add tag and
  Note. Every control is at least 44px. It is an auto-fit grid, so it reflows
  to one column at large text. Pin stays two taps (owner answer 1).
- **Priority** shows in the meta as `+2` only when it is not zero. The
  inline #30 +/- stay on desktop.

### 4.5 Measured heights

Measured on the mockups in gstack browse (`revised-*.html`). The current
figures are from `threads-narrow.html`, and the first draft from
`recommended-320.html` / `concept-a-toolbar-drawer.html`.

- "First row" is the first thread row's offset from the panel's top.
- "Total" is the panel's height with Rows shown = 5. Catch up has 3 sample
  rows.
- Every control outside the header measured at least 44 x 44. The header
  buttons follow section 13b, and the title links are at least 25px tall.

| State | 375 first row | 375 total | 320 first row | 320 total |
|---|---|---|---|---|
| Today, Threads at rest | 319 | 1146 | 379 | 1432 |
| First draft A, at rest | 165 | 728 | 165 | 808 |
| Review revision (two-line header at 320) | 209 | 802 | 259 | 940 |
| **Approved, Threads at rest** | **209** | **802** | **206** | **887** |
| Approved, filters open | 309 | 902 | 306 | 987 |
| Approved, badge shelf open | 323 | 916 | 341 | 1022 |
| Approved, one drawer open (row 1) | 209 | 1061 | 206 | 1146 |
| Approved, Catch up, info closed (3 rows) | 320 | 775 | 317 | 846 |
| Approved, Catch up, info open and one drawer open | 384 | 1098 | 381 | 1169 |
| Approved, My posts, info closed / open | 309 / 373 | - | 306 / 370 | - |
| Approved, collapsed | - | 92 | - | 110 |
| Approved, 320 at 200% text | - | - | 378 | 2309 |
| Approved, 280px: Threads at rest / collapsed | - | - | 250 / - | 998 / 72 |
| More open | n/a: there is no More | | | |

What the numbers say:
- At rest, the first row comes up by 110px at 375 and 173px at 320. The
  one-line header saves 53px at 320 compared with the review revision.
- An open drawer adds 259px, nearly all of it 44px controls. It is paid only
  for the one row being edited, and closing it is one tap on the same button.
- Catch up's first row moved up 10px at 375 and 113px at 320 once the
  explanatory paragraph went behind the info button. The explanation costs
  64px only while it is open.

### 4.6 Tap counts

| Task | Today | First draft | Approved |
|---|---|---|---|
| Open a thread | 1 (title text) | 1 | 1 (whole title band) |
| Mark read in Catch up | 1 | 2 | **1** |
| Mark read elsewhere | 1 | 2 | 2 |
| Pin a thread | 1 | 2 | 2 (owner: accepted) |
| Change priority by 1 | 1 (22 x 16 target) | 2 | 2 (44 x 44 target) |
| Open Search | 1 | 2 | **1** |
| Open Drafts or Settings | 1 | 2 | **1** |
| See reaction totals | 0 (in nav) | 1 (More) | 1 (My posts) |
| Read an explanation (Catch up, Settings ...) | 0 (always shown) | 0 | 1 (info button) |
| Show after auto-hide | 1 ("Show") | 1 (icon) | 1 ("Show", text) |
| Filter by folder | 1 | 2 | 2 |

### 4.7 At 200% text

An Android WebView can apply the system font scale through `textZoom`, which
scales px text as well. Measured by doubling `--tfcc-text` and
`--tfcc-text-sm` at 320px (the 200% frame of `revised-320.png`):

- No horizontal overflow. Every control outside the header is still at least
  44 x 44.
- The header stays on one line. The wider chip (86px) brings the buttons down
  to 38px.
- Nav labels wrap inside their cells ("Catch up" over "3"), which grow
  because they use `min-height`.
- Titles wrap to 4-7 lines, and the meta wraps under the buttons.
- The first row is at 378px, and the panel is 2309px. That is long but
  usable. Nothing clips and nothing is unreachable.

Supported: 280-375px wide at 100% text, and 320px at 200%. Rotation to
landscape crosses into the wide layout once the panel is over 616px wide
(section 5).

## 5. Breakpoint: the panel's own width

The review is right that the viewport is the wrong measure. The inline panel
sits in Torn's content column, and Expand changes its width without changing
the viewport.

**Decision: a `ResizeObserver` on the panel element.** It toggles a
`tfcc-narrow` class on the panel and sets the header button size
`--tfcc-hb` (section 13b). Both live on the panel element, so they survive
each `innerHTML` render.

- **What is observed:** `#tfcc-panel`, the `<div>` this script creates and
  inserts. `draw()` already writes `classList` on it (`tfcc-takeover`, the
  theme class). It is not Torn's mount container and not any Torn node.
- **The rule:** enter narrow at a border-box width of 600px or less. Leave
  when it exceeds 616px. The 16px of hysteresis stops a scrollbar's
  appearance from flapping the layout.
- **The width read:** `entry.borderBoxSize[0].inlineSize`, falling back to
  `panel.getBoundingClientRect().width`.
- **Guarded like everything else:** `typeof ResizeObserver === 'function'`,
  try/catch, and set up once beside the delegated listener. Without
  `ResizeObserver`, `draw()` measures the panel's own width on each render
  instead.
- **Why a class and not a CSS container query.** A container query condenses
  with no script, but the script never learns that the layout changed, and the
  state machine (section 6) needs that event: crossing the breakpoint must
  close the drawer and the filters. Container size queries need Chrome/Android
  WebView 105+ and iOS 16+ WKWebView. Torn PDA's minimum iOS version is
  unknown. Look it up only if a pure-CSS container query is ever needed.
  `ResizeObserver` needs Chrome 64+ and iOS 13.4+.
- **ADR 0001: the owner's ruling (2026-10-09).** A `ResizeObserver` on the
  script's own `#tfcc-panel` stays within ADR 0001. It is not a third DOM
  access.
  - The ADR confines access to Torn's markup to two places (choosing a mount
    container, finding the reply textarea). This observer reads no Torn node
    and no Torn data.
  - The same holds for measuring the chip and the Show button inside the
    panel, which `fitHeader` does (section 13b).
  - No ADR change is needed. repo-standards section 6.3 says an accepted ADR is
    never edited and only a reversal gets a new ADR. This ruling interprets
    ADR 0001 and does not reverse it.
  - The implementation PR should promote the ruling to `docs/architecture.md`
    ("Mount and navigation"), where lasting knowledge lives.
- **The existing `@media (max-width: 600px)` block stays** for the fixed
  fallback mount's viewport offsets (`#tfcc-fallback`), which really are
  viewport-relative. The panel-internal narrow rules move under
  `#tfcc-panel.tfcc-narrow`.
- **Desktop and wide panels** (no class) render exactly as today, including the
  #30 inline priority and the full action row.

## 6. State machine

Transient state lives in `state`, is never persisted (like `showAll`), and is
reset on reload:

- `openRowId`: the thread id whose drawer is open, or null.
- `filtersOpen`: boolean.
- `drawerEdit`: `{ id, field, value, selStart, selEnd }` or null. It mirrors a
  drawer text input on every `input` event, without a redraw.
- `openInfoId`: which explanation is open, for example `catchup`,
  `settings-budget` or `mine`, or null (section 13d). One is open at
  a time.
- `navMoreOpen`: removed. There is no More menu.

`openInfoId` follows the drawer's rules, except that it is not tied to a row:
- **Toggles:** a tap on an info button toggles it, and focus stays on that
  button.
- **Unchanged by:** refresh, filter, cap and row actions.
- **Closes (null) on:** a view change, Hide, auto-hide, crossing the
  breakpoint, and page reload. After Show it stays null.
- **If its button is not rendered** in the current view, it is reconciled to
  null.

**Reconciliation.** After every model build, if `openRowId` is not among the
rows rendered in the current view (after filters, sort and the cap), set it
to null. This one step covers refresh, filter, cap and archive removing the
open row, and it means a row that later returns cannot reopen by itself.

| Event | `openRowId` | `filtersOpen` | Focus afterwards (user-caused redraws only) |
|---|---|---|---|
| Tap Actions on row A | A (or null if A was open) | unchanged | the same Actions button |
| Tap Actions on row B while A is open | B (A closes, after its inputs commit) | unchanged | B's Actions |
| Refresh, open row still listed | unchanged | unchanged | unchanged (background: no focus move) |
| Refresh removes the open row | null (reconciled) | unchanged | if focus was in that row: next row, previous row, then view heading |
| Mark read in Catch up (row leaves) | null if it was the open row | unchanged | next row's Read, previous row's Read, then the "Catch up" heading |
| Mark read in Threads (row stays) | unchanged | unchanged | the same control |
| Archive (row leaves the list) | null if it was the open row | unchanged | next row's Actions, previous row's Actions, then the view heading |
| Pin or priority (row may move) | unchanged (keyed by id) | unchanged | the same control, wherever the row moved |
| Change view (nav cell) | null | false | the pressed nav cell |
| Filter text, Unread, sort, folder or tag filter | reconciled | unchanged | the same field or control (typing keeps the existing `pendingRedraw` guard) |
| Show all / Show N only | reconciled | unchanged | the cap button |
| Hide (collapse) | null | false | the same button, which now reads "Show" |
| Auto-hide (#8, plain thread-link click) | null | false | none: the page navigates |
| Show | stays null | stays false | the same button, which now reads Hide |
| Expand / Shrink | unchanged, unless the breakpoint is crossed | unchanged, unless crossed | the same button |
| Crossing the breakpoint (rotation, resize, Expand) | null | false | the same control if it still exists, otherwise the view heading |
| Dirty drawer input, then a tap elsewhere | per the tapped control | per the tapped control | per the tapped control; see below |
| Background redraw while typing in a drawer | unchanged | unchanged | held by the existing `pendingRedraw` guard |
| Torn route change inside forums.php | reconciled | unchanged | unchanged |
| Page reload | null | false | n/a |

**Dirty inputs.** Today, `tag-input` and `note-input` commit on `change`, which
fires on blur. A tap on another control blurs the field first, so the value
is not lost. The real hazard is that the commit's redraw replaces the node
the finger is on, so the tap the user made never arrives as a click. The
contract:

1. A tap on any panel control while a drawer input has focus both commits the
   input (as today) and performs the tapped action, in that order, with one
   visible redraw.
2. The mechanism the plan should test first: while a pointer press that began
   inside the panel is in progress, a redraw caused by `change` is held in
   `pendingRedraw` and flushed after the `click` (or after `pointercancel`, or
   300ms with no click).
3. `drawerEdit` mirrors the field on `input`. A forced redraw before the commit
   renders the typed value and restores the selection, rather than reverting.
4. Closing a drawer with an uncommitted tag field discards that text. A tag is
   only added by Enter or blur, as today.

**Focus rules.**
1. Before a user action runs, the handler captures `{act, id, view}` of the
   target and the ids of the next and previous rendered rows.
2. After the redraw, focus the element with the same `data-act` and `data-id`
   (or `data-view`).
3. If it is gone, focus the next row's equivalent control (Read in Catch up,
   Actions elsewhere). If there is no next row, use the previous row's. If
   there is neither, focus the view heading: a `<h3 tabindex="-1">` at the top
   of each view, visible in Catch up and visually hidden in Threads.
4. Background redraws never move focus.
5. Read, Archive and Mark all read announce through one polite live region
   ("Marked read. 2 left."). The plan must check that the region survives
   `innerHTML` replacement, as the badge toast's `role="status"` does today.

## 7. What stays exactly as it is

- Every `data-act` name, value and handler, plus storage, the model and the
  request budget (13 per refresh, 40 per minute). Nothing here makes a
  request.
- Wide panels (no `tfcc-narrow`) keep today's layout, including #30's inline
  priority. The nav is unchanged from main, with the reactions pill before My
  posts, still opening My posts. The one change the owner chose for every size
  is that standing explanations go behind info buttons (section 13d).
- The thread anchor (`data-tfcc-thread`) and #8's plain-click rule. Only the
  anchor's display changes, to a block.
- The badge chip's content and aria-label, the shelf, the toast and the
  catalogue. The chip gets a 44px box around the same pill.
- The reactions pill's markup and behaviour.
- The cap line and Show all. The button becomes 44px.
- The Search, Drafts and Settings views' content. Narrow screens give their
  controls a 44px minimum and 16px input text.
- The colour tokens, both themes and the focus ring. The nav count badges reuse
  the `.tfcc-badge` pair (`--tm-good-bg` on `--tm-text`), and the Read button
  uses the existing button colours.

## 8. Accessibility

- **Targets:**
  - Every control outside the header is at least 44 x 44, measured in both
    themes and at 200% text, with 6px gaps.
  - The header buttons are 44px down to a 24px floor (section 13b).
    That meets WCAG 2.2 SC 2.5.8 (AA, 24px) but not 2.5.5 (AAA, 44px) on
    panels under about 330px wide. The owner chose this.
  - The title band is the full row width and at least 24px tall.
- **Names:** the icon buttons have `aria-label`s ("Refresh", "Expand", "Hide
  the panel"). The SVGs are `aria-hidden`. Show is visible text. Mark read is a
  check mark named "Mark read", described by its row's title. Filters is
  "Filters, N active".
- **State:** the nav cells and Unread keep `aria-pressed`. Actions and Filters
  use `aria-expanded` plus `aria-controls`, on ids prefixed `tfcc-` with the
  thread id. Nothing claims `role="tab"` or `role="menu"`, because the panel
  has no arrow-key handling.
- **Focus:** section 6. No user action leaves focus at the top of the page.
- **Order:** the DOM order is the visual order: title, meta, Read, Actions,
  drawer.
- **No hover, no `title` dependence:** every `title` duplicates visible text or
  an aria-label. A touch WebView never shows `title`.
- **Contrast:** only existing colour pairs are used. `render-preview` gains
  narrow 320/375 Threads and Catch up previews (dark and light, with a drawer
  open) so `contrast-audit.mjs` measures them.
- **Nav labels over the v1 numeral:** every cell state stays at 4.5:1 or
  better. The worst case is the selected dark Threads cell, at 4.98:1.
  `contrast-audit.mjs` checks the label against the numeral painted on the
  cell for every state (section 13f).
  - The numeral itself is decorative: it is `aria-hidden` and below 3:1 by
    design, which the owner accepted.
  - The count reaches screen readers through each cell's accessible name.
  - Sighted users read the numeral as a cue, not as the only carrier of the
    number. The owner accepted this trade-off.
- **Text size and zoom:** `min-height`/`min-width` only, auto-fit grids, and no
  fixed heights. Section 4.7 shows the 200% behaviour.
- **Reduced motion:** the drawer and filters open without animation.

## 9. Behaviour that must survive

| Behaviour | How it survives |
|---|---|
| #8 auto-hide: only plain clicks on a thread link collapse | Read, Actions and the drawer controls are siblings of the title span, never inside the anchor. `threadLinkOf` returns null for them. Tests: `row-more` and `read` do not collapse. |
| Expand / takeover | The same `data-act="takeover"` with `aria-pressed`. If Expand crosses the breakpoint, section 6 applies. |
| Badge chip and shelf | The same chip content, in a box as tall as the header buttons. The pill is compact below a 36px button size. The shelf opens under the header (measured above). |
| Reactions pill opens My posts | Wide panels: unchanged from main. The pill sits in the nav before My posts and opens My posts. Narrow panels: the totals are the first line of My posts. Tapping them there is harmless, and the implementation may render them as plain text with the same label. Section 13c. |
| Rows cap and Show all | The cap applies before rendering. `openRowId` is reconciled against the capped rows. |
| Drafts and search | Drafts and Search are direct nav cells. Draft/Edit draft is in the drawer with the same `data-act`. |
| 320px header wrap rule | Superseded by owner decision b. Refresh, Expand and Hide stay one nowrap unit, in order. Instead of wrapping, they shrink, so the header is one line at 280-375px (measured). |
| Collapsed panel | Header only, with "16 new" and a text "Show". The badge may wrap under the logo; the buttons never wrap. |
| Redraws under the caret | The existing `pendingRedraw` guard, plus section 6's press-aware flush and the `drawerEdit` mirror. |

## 10. Constraints, scope and tests

- **ASCII-only source.** The new icons are inline ASCII SVG paths, using
  `currentColor` and `aria-hidden`. The thumbs stay as the existing
  `THUMB_UP` / `THUMB_DOWN` escapes.
- **ADR 0001.** No new Torn DOM access. See section 5 for the `ResizeObserver`
  on the script's own element.
- **No new requests, and no hover-only affordance.**
- **Delegated clicks read `data-act` from `ev.target`.** Every new control is a
  `<button>` with its own `data-act`. Its children (icons, the chip's pill
  span, count badges) sit under `button * { pointer-events: none }`.
- **Scope, stated honestly.** This is a state-machine and focus change, not
  just markup and CSS. The plan needs interaction tests for:
  - the narrow class with hysteresis (a fake `ResizeObserver` in the
    harness), and the no-`ResizeObserver` fallback;
  - every row of the section 6 table, including reconciliation after refresh,
    archive, filter and cap changes;
  - focus restoration and the next / previous / heading fallback after Read
    removes the first, a middle and the last row;
  - a tap on another control while a drawer input is dirty (commit plus
    action, one redraw);
  - Read rendered only in Catch up, and only when narrow;
  - auto-hide not firing for `row-more` and `read`;
  - a style test that every narrow control rule outside the header sets
    `min-height` and `min-width` of at least 44px;
  - `fitHeader`: the size it computes at the section 13b widths (44 / 41 / 35),
    the 24px floor, the 44px ceiling, the compact chip below 36px, and one
    line at each width in `render-preview`;
  - info buttons: `aria-expanded` and `aria-controls` match a real element,
    the explanation carries `hidden` when closed, and `openInfoId` follows the
    section 6 rules;
  - the tests that pin explanatory text keep passing, because the text stays
    in the markup. These are `auto-hide.test.js` ("Only thread links in this
    panel..."), `rows-cap.test.js` ("Applies to Threads, Catch up and My
    posts.") and `panel.test.js` ("Threads you started or posted in").

  The mutation check gains entries that remove the Catch up Read button,
  break reconciliation, and break the focus fallback.

## 11. Review resolutions

The review is at `docs/records/review/2026-10-09-mobile-condense-codex.md`.
There were 23 findings: **19 accepted, 4 modified, 0 rejected outright.** Two
of the four modified findings partly decline the reviewer's fix, with reasons
given.

| # | Finding | Resolution | Reason / where |
|---|---|---|---|
| A1 | 44px claim false (40 x 44, chip pseudo-target) | Accepted, then amended by the owner | The review revision used real 44 x 44 boxes and an honest two-line header at 320. The owner then chose one line with header buttons scaling from 44px down to a 24px floor (section 13b). The claim is now stated exactly: 44px outside the header, and 24-44px in it. There is still no pseudo-element target. |
| A2 | Catch up Mark read regresses to two taps | Accepted | A visible 44px Read on Catch up rows. Section 4.4. |
| A3 | Focus lost when an action removes its row | Accepted | Same control, then next row, previous row, view heading. The successor is captured before mutation. Section 6. |
| A4 | Stale `openRowId` | Accepted | Reconciled after every model build. Section 6. |
| A5 | Dirty editor destroyed by redraw | Modified | Corrected diagnosis: `change` already commits on blur, so the value survives. What gets lost is the tap that caused the blur. Fixed by a press-aware deferred flush, plus a `drawerEdit` mirror against forced redraws. Section 6. |
| A6 | Search and reactions hidden in More | Modified | Stronger than asked: More is removed and all six views are visible. Reaction totals are visible at the top of My posts, not on every view, which saves 50px. The owner confirmed this for narrow panels. On desktop the pill stays in the nav as on main (section 13c). Section 4.2. |
| A7 | Focus hole after choosing a More view | Accepted | Removed at the source (no More). A view change focuses the pressed nav cell. Section 6. |
| A8 | Breakpoint watches the viewport | Accepted | `ResizeObserver` on the panel's own element, with hysteresis. A container query was considered. Section 5. |
| A9 | 320px only at default text size | Accepted | `min-height`/`min-width`, auto-fit grids, and 200% measured. Section 4.7. |
| A10 | Show is an unlabelled chevron | Accepted | "Show" is visible text when collapsed. Section 4.1. |
| A11 | Savings are best-case figures | Accepted | Heights for rest, filters, shelf, drawer, Catch up and 200%, plus tap counts. Sections 4.5, 4.6. |
| A12 | One-drawer rule underspecified | Accepted | A full transition table. Section 6. |
| A13 | Ellipsis and unread steal title width | Modified | Accepted: unread and Actions move to line 2, and the title band becomes the full-width block target. Declined: making the non-action row area open the thread. It invites accidental opens, each of which auto-hides the panel (#8), and it would widen what `threadLinkOf` treats as a thread click. Section 4.4. |
| A14 | Filter button has no name | Accepted | "Filters, N active" with `aria-expanded`. Section 4.3. |
| A15 | Chip pseudo-target fragile | Accepted | No pseudo-elements, and no overlapping boxes. Section 4.1. |
| A16 | Scope understated | Accepted | Restated as a state-machine change, with a test list. Section 10. |
| B1 | Sticky dock unsafe inline | Accepted | B is not recommended. If revisited: takeover only, with `env(safe-area-inset-bottom)`. |
| B2 | Hidden, undersized row toggle | Accepted | The recommendation uses a visible 44px Actions button. |
| B3 | Two nav systems drift | Accepted | Noted for any future B: one view model and a parity test. |
| C1 | Single-row actions get worse | Accepted | C is not recommended. Per-row Actions stay. |
| C2 | Selection lifetime undefined | Accepted | Noted for any future selection mode. |
| C3 | Bulk partial-failure semantics | Modified | Corrected premise: Mark read, Pin, Folder, Tag and Archive are local organizer writes (`markRead`, `togglePin` and so on), not API requests. There is no request budget or network failure to model, and Catch up already has "Mark all read". Bulk remains out of scope. |
| C4 | 36px select box | Accepted | Moot for the recommendation. Any future selection control is 44 x 44. |

## 12. Questions for the owner: answered

All six are closed by the owner's decisions of 2026-10-09 (section 13):

1. **Pin outside Catch up:** stays at two taps.
2. **Reaction totals:** on narrow panels, at the top of My posts. On desktop,
   the pill stays in the nav before My posts, as on main (revised; see 13c).
3. **Container queries:** Torn PDA's minimum iOS version is unknown. Look it up
   only if a pure-CSS container query is ever needed.
4. **ADR 0001:** a `ResizeObserver` on the script's own `#tfcc-panel` stays
   within ADR 0001 (the owner's ruling, recorded in section 5).
5. **Catch up's paragraph:** removed at every size and put behind an info
   button. The same rule is applied across every view (section 13d).
6. **Concept B's dock (takeover only) and a Catch up selection mode:** filed
   for later. The owner files those issues.

Nothing is left open. One fact for the implementer: the collapsed header at a
280px viewport comes within half a step of the 24px floor (24.5px, section 13b).

## 13. Owner decisions, 2026-10-09

The owner approved the revised design with these changes. The body of this
spec has been amended to match. Where an earlier passage and this section
disagree, this section wins.

### 13a. Nav counts are numbers only

- Narrow nav cells show the number alone: "Threads 16", "Catch up 3",
  "Drafts 1", "My posts 1". A cell wraps only when the number is large.
  **Superseded for the nav cells by 13f:** the number is now a decorative v1
  numeral behind the label.
- The accessible name still says what the number counts ("Threads, 16 new,
  6 subscribed").
- On wide panels the nav keeps today's "Catch up (3)" text form. That is
  outside this issue.
- **The collapsed header shows just "16"** (owner, revised 2026-10-09).
  - The badge's accessible name stays "16 new", written as a visually hidden
    span beside an `aria-hidden` "16", because `aria-label` on a plain span is
    not reliably read.
  - It is a text badge, and it is the part of the header that wraps under the
    logo when space runs out.
  - This replaces an earlier choice in this spec to keep the word "new".

### 13b. Header buttons are icons that scale to the width

**The owner chose sub-44px targets on very narrow panels.** The two-line 320px
header is gone. Refresh, Expand/Shrink and Hide are icon buttons (inline
ASCII SVG, an `aria-label`, and the existing `data-act` values). They never
wrap, and they shrink so the header stays on one line.

**Mechanism.**
- **One custom property.** `fitHeader(panel)` sets `--tfcc-hb`, the header
  button size, on the panel element. The CSS reads it:
  - buttons: `width: var(--tfcc-hb); min-height: var(--tfcc-hb)`;
  - icons: `clamp(14px, 0.45 x hb, 20px)`;
  - logo height: `clamp(16px, 0.545 x hb, 24px)`;
  - chip box: `min-height: var(--tfcc-hb)`, with a pill of
    `min(28px, var(--tfcc-hb))`.
- **When it runs:** from the section 5 `ResizeObserver` callback, and after each
  `draw()`. A draw is needed because the chip's width changes with its counts
  and the Show label replaces the Hide icon.
- **What it reads:** only the panel's own nodes: the panel's content width
  (`clientWidth` minus padding), the chip's width, and the Show button's width.
  That is within the owner's ADR 0001 ruling.
- **How it solves:** it takes the largest `s` in [24, 44] that fits, stepping
  down by 0.5px:

  ```
  logoW(s) + chipW + n*s + showW + 20 <= C
  logoW(s) = 2.356 * clamp(16, 0.545*s, 24)   (logo viewBox is 106 x 45)
  n = 3 icon buttons (expanded), or 2 plus the Show button (collapsed)
  20 = gaps: logo-chip 6 + group 6 + 2 x 4 between buttons
  ```

- **Compact chip:** if `s` comes out under 36px, the chip switches to compact
  padding (4px and 1px gaps instead of 8px and 3px), and the solve runs again
  with the narrower chip. The chip's 12px text never shrinks.
- **Why script and not pure CSS.** `clamp()` over `100cqi` could size the
  buttons, but the chip's width depends on its counts, which CSS cannot
  subtract. The observer already exists for the breakpoint.
- **Last resort.** If even 24px does not fit, the header still does not wrap
  its buttons. The logo-and-chip group (`flex: 0 1 auto; flex-wrap: wrap`)
  wraps inside its own box instead. Nothing ever goes below 24px.

**The maths.** C is the panel's content width: the panel minus 2 x 8px padding
and 2 x 1px border. The mockups put the panel inside a 16px page gutter, as
`render-preview` does. The expanded chip ("cup 4, flame 5") measures 72px
normal and 58px compact.

| Viewport | C | Solve | Check (expanded) | Measured on mockup |
|---|---|---|---|---|
| 375 | 325 | s = 44 (ceiling) | 56.5 + 72 + 132 + 20 = 280.5 <= 325 | 44px buttons, header 44px tall |
| 320 | 270 | (270 - 72 - 20) / (3 + 1.284) = 41.5, and the 0.5 step gives about 41 | 2.356 x 22.3 + 72 + 123 + 20 = 267.6 <= 270 | 41px buttons, header 41px, one line |
| about 280 | 230 | normal chip: (230 - 92) / 4.284 = 32.2, under 36, so compact; then (230 - 58 - 20) / 4.284 = 35.5, so 35 | 2.356 x 19.1 + 58 + 105 + 20 = 228 <= 230 | 35px buttons, header 35px, one line |
| floor | 188 | s = 24 | 2.356 x 16 + 58 + 72 + 20 = 187.7 | fits down to C = 188 (a 206px panel) |

- **Collapsed** (two icons plus "Show"): one line at 320 with s = 37. At
  280, s = 24.5, half a step above the 24px floor: 37.7 + 58 + 49 + 65.2 + 20
  = 229.9 <= 230. (Corrected in the #33 plan review: the algorithm above,
  with Show re-measured at each size as 55.4 + 0.4 x s from its padding
  clamp, gives 37 and 24.5; the mockup's 36.5 came from its own text metrics.)
- **200% text at 320:** the chip widens to 86px, so s = 38, still one line.
- **Collapsed with an unread count** (PR #38 review): the bare count and its 6px gap are part of the solve, so the header stays on one line whenever it fits at 24px or more ("16" at 375: 38px; at 320: 26px); only when even 24px cannot hold it (280, or a 3-digit count at 320) does the count wrap under the logo, and the buttons are then sized without it.
- 1.284 is 2.356 x 0.545, the logo's width per pixel of button size while the
  logo is between its clamps (button sizes of 29.4-44px).

Below 44px the header buttons are under the platform guidance. At 24px they
still meet WCAG 2.2 SC 2.5.8 (AA). That is the floor the owner set.

### 13c. Answers to the open questions

These are recorded in section 12, and the body is amended: section 4.2 for
the reaction totals, section 5 for the ADR ruling and the iOS note, and
section 4.4 for Pin.

**Reaction totals, revised by the owner (2026-10-09).** The first answer was
"My posts only, at every size". The owner then decided:
- **Desktop / wide panels:** the reactions pill **stays in the nav, before My
  posts**, exactly as on main, and still opens My posts. The desktop nav is
  unchanged from main.
- **Narrow panels:** the totals sit at the top of My posts, as in the revised
  design. The narrow nav grid has no pill.

### 13d. Standing explanations go behind info buttons, at every size

**The pattern.**
- **The button:** an info button (an "i" in a circle, inline ASCII SVG)
  with `data-act="info"`, `data-info="<key>"`, `aria-expanded`,
  `aria-controls="tfcc-info-<key>"` and an `aria-label` ("About Catch up"). It
  is 44 x 44. It follows the 13b scaling only if it ever sits in the header
  row, and none does today.
- **The text:** the explanation is always in the markup, as
  `<p class="tfcc-infotext" id="tfcc-info-<key>" hidden>`. `hidden` is removed
  while it is open. This keeps `aria-controls` pointing at a real element and
  keeps the tests that pin this text passing. A
  `#tfcc-panel [hidden] { display: none !important }` rule stops a host
  stylesheet from revealing it.
- **The state:** `state.openInfoId`, never persisted, one at a time, closed by
  the section 6 transitions (view change, Hide, auto-hide, crossing the
  breakpoint).

**Catch up.** The "Marking read here hides a thread..." paragraph is removed
at every size. An info button follows "Set catch-up point to now" and
discloses the full text inline beneath the button row (mockups: Catch up,
info closed and open).

**Audit of every view and Settings.** Read from `renderCatchUpView`,
`renderMineView`, `renderSearchView`, `renderDraftsView`, `renderSettingsView`,
`renderBadgeCatalogue`, `renderRow` and `panelHtml`.
- "Keep" means a live status, an error, data, or a disclosure that the rules
  require at the point of action.
- "Info" means the text moves behind an info button placed after the named
  control.
- "Shorten" means it stays visible in fewer words.

| # | Where | Text (abridged) | Decision | Why |
|---|---|---|---|---|
| 1 | Catch up | "Since <date>" | Keep | Live data, now in the view heading |
| 2 | Catch up | "Marking read here hides a thread... Torn's own new-post counter..." | **Info**, after "Set catch-up point to now" | Owner decision |
| 3 | Catch up | "Not yet checked for author posts (N)" section | Keep | Live status |
| 4 | My posts | "Threads you started or posted in. Updated X. N not checked yet." | **Shorten + info**: "Updated X. N not checked yet." stays; the first sentence and the 15-minute refresh rule go behind info | Live status stays; the standing description moves |
| 5 | My posts | "Slowing down to stay inside Torn's API limit." | Keep | Live status |
| 6 | My posts | Error, plus "Showing the saved list from <time>" | Keep | Error and status |
| 7 | My posts | Reactions pill | Keep | Data (owner answer 2) |
| 8 | Search | "Filtering searches titles, authors... Search on Torn hands the same query..." | **Info**, after "Search on Torn" | Standing explanation |
| 9 | Search | "Fetching N of M threads." | Keep | Live progress |
| 10 | Search | "Cached posts: N across M threads, about X." | Keep | Live data, one line |
| 11 | Drafts | "No reply box was found on this page, so Insert is unavailable. Copy puts the draft on your clipboard instead." | **Shorten**: "No reply box here, so Copy replaces Insert." | A live condition that explains a missing button |
| 12 | Drafts | "Open a thread to write a draft for it." | Keep | Empty-state guidance |
| 13 | Settings, key | "This script needs a key... Minimal Access... Limited... Public Only does not." | **Shorten**: "Create a Minimal Access key on Torn (Settings, API Key)." | The ToS table beside it already states the access levels |
| 14 | Settings, key | ToS table (who sees data, use, storage, access level, requests) | **Keep, never behind info** | Torn's API terms require it "clearly and visibly" where the key is entered (`docs/rules-compliance.md`, `read-only.test.js`) |
| 15 | Settings, key | "A key is saved." / "No key saved yet." | Keep | Live status |
| 16 | Settings, key | "This opens Torn's key page in a new tab with only the selections this script uses..." | **Shorten**: "Opens Torn in a new tab with only this script's selections." | Disclosure at the point of action (rules-compliance, custom key link) |
| 17 | Settings, refreshing | The request-budget paragraph | **Shorten + info**: a visible line computed from the constants ("A refresh is at most 13 requests; never more than 40 a minute."), with the full breakdown behind info | CLAUDE.md constraint 7: the budget is a promise the panel makes, so its headline stays visible and is still computed |
| 18 | Settings, refreshing | The author-only paragraph (lookups, N+ counts, "not checked") | **Shorten + info**: "Costs no extra requests. Some threads may show 'not checked'." visible, the rest behind info | The code comment wanted the limits read before enabling; the visible line keeps the key limit |
| 19 | Settings, appearance | "Applies to Threads, Catch up and My posts. Search and Drafts always show everything..." | **Shorten + info**: the first sentence stays (pinned by `rows-cap.test.js`), the rest behind info | The first sentence is the fact a user needs |
| 20 | Settings, appearance | Auto-hide: "Only thread links in this panel do this, and only a plain click..." | **Info**, after the checkbox | Standing explanation; the text stays in the markup for `auto-hide.test.js` |
| 21 | Settings, folders | "A folder can claim a forum..." | **Info**, after the Folders heading | Standing explanation |
| 22 | Settings, folders | "Forum names load on the first successful refresh." | Keep | Conditional status |
| 23 | Settings, backup | "An export carries folders, tags... It never carries your API key or the post cache." | **Shorten**: "Never includes your API key or the post cache." | Privacy disclosure at the point of action (CLAUDE.md constraint 6) |
| 24 | Settings, storage | "Post cache: N posts, X." | Keep | Live data |
| 25 | Settings, storage | "A debug report carries... never carries your key, drafts, notes or post text." | **Shorten**: "Never includes your key, drafts, notes or post text." | Privacy disclosure at the point of action |
| 26 | Settings, badges | "Earned from what you do here... Nothing is sent anywhere... a streak does not survive days with it off." | **Shorten + info**: "Recorded on this device only. No request is made." visible, the rest behind info | The privacy part stays visible; the rules move |
| 27 | Badge catalogue | "Focused thread visits: N. Forums explored..." | Keep | Live data, shown only when the list is open |
| 28 | Badge catalogue | Each badge's rule line | Keep | The content the user opened the list for |
| 29 | Settings, footer | "Torn Forum Command Center vX. Reads only..." | Keep | Version and read-only disclosure, one line |
| 30 | Rows | "local count", "not checked yet", "not subscribed", "locked", "author: not checked" | Keep | Live per-row status |
| 31 | Panel | "No API key yet. Add one in Settings..." | Keep | Warning |
| 32 | Panel | "Updated 4m ago." footer, cap line "Showing 5 of 6" | Keep | Live status |
| 33 | Header | "N not checked" (author-only) | Keep | Live status |

Totals:

| Decision | Count | Items |
|---|---|---|
| Info only | 4 | 2, 8, 20, 21 |
| Shorten plus info | 5 | 4, 17, 18, 19, 26 |
| Shorten only | 5 | 11, 13, 16, 23, 25 |
| Keep | 19 | everything else |

No error, live status or required disclosure is hidden. Every hidden
explanation is one tap away, where the thing it explains happens. That keeps
the rules-compliance principle "stated where it happens".

### 13e. Mark read is a check mark only (owner feedback)

- **The button:** on thread rows, the Read / Mark read button shows only the
  check-mark icon, with no text. This applies everywhere a row shows it: the
  Catch up one-tap button and the drawer's Mark read in other views.
- **Markup:** it stays a 44 x 44 `<button>` with `data-act="read"` and
  `aria-label="Mark read"`. `aria-describedby="tfcc-title-<id>"` names the
  thread to a screen reader without changing the accessible name, and the
  title anchor gains that id.
- **Glyph contrast, measured in the mockups:** the stroke is `currentColor`
  on the button's `--tm-bg-3`. That is **18.9:1 in dark** and **18.4:1 in
  light**, well over the 3:1 that WCAG 1.4.11 requires for graphical objects.
- **Size, measured:** 44 x 44 in Catch up rows. In the drawer it fills its
  grid cell.

### 13f. Nav counts as a numeral behind the label: decided, v1 tint

**Decision (owner, 2026-10-09): v1 tint.** The numeral is drawn in the
label's colour at 14% (9% on the selected cell), behind a label at 90%
opacity (96% selected).

**The owner accepts the trade-off.** The numeral is decorative: it measures
1.18:1 against the cell, below the 3:1 a large-text count would need. The
count is carried in each cell's accessible name instead ("Threads, 16 new",
"Catch up, 3", "Drafts, none"). The numeral is `aria-hidden`.

**The hard requirement.** v1's label contrast stays at or above 4.5:1 in every
cell state. Measured in `nav-count-variants.html` (label over cell / label over
numeral):

| Cell state | Dark | Light |
|---|---|---|
| Default (Catch up, Threads, Drafts) | 15.3 / 10.7 | 14.1 / 10.9 |
| No numeral (Search, Settings) | 15.3 | 14.1 |
| Selected (Threads, tuned) | 6.1 / **4.98** (worst) | 13.1 / 11.0 |
| My posts | 10.5 / 8.2 | 10.5 / 8.2 |
| My posts, selected | 8.0 / 6.8 | 8.0 / **6.8** (worst) |

The selected dark Threads cell is the tightest. That is why the selected
state uses 9% and 96%, not 14% and 90%. At 14% and 90% it measured 4.14:1
and failed.

**Tokens for the implementer to copy exactly.** Add these on `#tfcc-panel`.
They are the same in both themes, because the colour follows the cell's own
text colour:

```
--tfcc-navnum-opacity: 0.14;            /* numeral, default cell        */
--tfcc-navnum-opacity-selected: 0.09;   /* numeral, aria-pressed="true" */
--tfcc-navlab-opacity: 0.9;             /* label, default cell          */
--tfcc-navlab-opacity-selected: 0.96;   /* label, aria-pressed="true"   */
--tfcc-navnum-size: 40px;               /* numeral font size            */
```

**The numeral's colour** is `currentColor`, the cell's text colour: `--tm-text`
for most cells, and `--tfcc-mine-text` for My posts. The `#tfcc-panel *
{ color: inherit }` reset must not turn it transparent. Give the numeral no
colour of its own, and do not use `-webkit-text-stroke`; that is how v2's
outline vanished in the first build.

**Composited numeral colours**, for reference and for the audit's
expectations:

| Cell | Dark | Light |
|---|---|---|
| Default cell | about #323232 on #111111 | about #dedede on #ffffff |
| Selected cell | about #3d784c on #2a6b3a | about #bed5c3 on #cfe8d4 |
| My posts cell | about #bdbdbd on #d9d9d9 | about #bdbdbd on #d9d9d9 |
| My posts, selected | about #a2a2a2 on #b0b0b0 | about #a2a2a2 on #b0b0b0 |

**`tests/contrast-audit.mjs`** gains a check for every nav cell state in both
themes. It composites the label (colour times opacity) over the numeral
painted on the cell, and asserts at least 4.5:1, the same calculation as the
mockup's in-page script. A change to any of the tokens above that drops a
state below 4.5:1 fails the audit.

The variant study follows, kept for the record.

#### The variant study (before the decision)

**The feedback.** The owner does not want the label and the number to wrap
inside a cell. The alternative puts the count behind the label as a large
numeral, centred and nearly the cell's height, so the label stays on one line.

Mockup: `docs/designs/mockups/33-mobile/nav-count-variants.html` / `.png`.
It shows the nav block only, for each variant in dark and light at 375, 320
and 280px. Each block shows:
- Threads selected, with Drafts at 0, Search and Settings (no count), and
  My posts at 128;
- My posts selected, with Catch up at 104.

The ratios under each block are computed in the page from the browser's own
computed colours and opacities.

**States, the same in all variants.**
- **No count** (Search, Settings): the label alone, centred.
- **Zero:** no numeral at all, so the cell looks like Search. A large ghost
  "0" would draw the eye to nothing. "No numeral means nothing new" reads at a
  glance, and the accessible name still says "Drafts, none".
- **Selected:** the existing pressed fill plus a 3px inset bar under the
  label, so selection never depends on colour alone. My posts keeps its #30
  light-grey pressed style and bar.
- **Large counts:** 3-digit counts (128, 104) fit inside a 72px cell at 280px.
  Long labels ("My posts", "Catch up") fit on one line at 280px. None of
  them truncated in the mockup.
- **At 200% text** a label could exceed its cell. It then ends in an ellipsis,
  and the accessible name keeps the full label. That is the cost of "never
  wraps".

**Two contrast tests, because the numeral is the count.**
- The label must reach 4.5:1 against whatever is directly behind it,
  including the numeral.
- The numeral carries the information too, so as large text it needs 3:1
  against the cell. A numeral faint enough to stay out of the label's way can
  fail as a count.

**Measured worst cases.** These are the same at 375, 320 and 280, since width
does not change the colours. "Raw" means the label against the numeral
painted on the cell, with no halo credit.

| Variant | Treatment | Dark: label | Dark: numeral | Light: label | Light: numeral | Verdict |
|---|---|---|---|---|---|---|
| v1 tint | Numeral in the label colour at 14% (9% on the selected cell). Label at 90% (96% selected) | 4.98:1 (selected Threads) | **1.18:1** | 6.84:1 | **1.18:1** | The label passes, but the count is barely visible: it fails as information |
| v2 ghost | Numeral as a 1.5px outline at 45%. Solid label | **2.46:1** | **2.50:1** | **3.40:1** | **2.50:1** | Fails both: the outline crosses the label's strokes |
| v3 halo | Numeral in the unread green at 35% (label colour at 10% on the selected cell). Label at 92% with a soft, blurred halo | 4.62:1 | **1.07:1** | 6.32:1 | **1.20:1** | The label passes, but the count is not legible |
| **v4 legible** | Numeral solid at 3:1 or better against the cell, a colour per cell state. Solid label with a crisp 1.5px halo in the cell colour (eight zero-blur text-shadows) | **6.44:1** against its halo (2.47:1 raw) | **3.26:1** | **8.49:1** against its halo (2.47:1 raw) | **3.36:1** | **Passes both** |

**Why v4 can pass.** A dark label over a mid-grey numeral can never reach 4.5:1
when that numeral also reaches 3:1 against a light cell: the measured raw
ratio is 2.47:1. v4 does not mix the two. The halo puts the cell's own
colour around every label stroke, so the label's adjacent pixels are the cell
(6.44:1 and 8.49:1), and the numeral shows only between letters and around
the label. The halo has zero blur so that the claim holds. v3's blurred halo
is partly transparent, so it gets no credit.

**v4's numeral colours, per cell state:**

| Cell | Dark theme | Light theme |
|---|---|---|
| Default | #6b6b6b | #8c8c8c |
| Selected | #000000 | #787878 |
| My posts (both themes) | #737373 | #737373 |
| My posts, selected (both themes) | #555555 | #555555 |

The implementation should make these tokens and add them to
`tests/contrast-audit.mjs`.

**One deviation from the brief.** The brief asked for a semi-opaque label.
v4's label is solid: once the halo separates it from the numeral, opacity only
costs contrast. v1 and v3 keep the semi-opaque label for comparison.

**The study's recommendation was v4. The owner chose v1** (see the decision
at the top of 13f). The original reasoning: v4, if the owner wants the layered look. It is the only
variant where the label reads at AA and the count is still legible. If the
owner prefers a quieter numeral (v1 or v3), the count fails 3:1. In that case
it should be treated as decoration, and the number shown again in plain text
somewhere, which defeats the point. The number-only badges in section 4.2
remain the fallback.

## 14. Narrow polish (#39)

The owner's feedback on the narrow layout after #33 / PR #38. Every change is
in the narrow layout only; the wide markup is unchanged
(`tests/wide-parity.test.js`). Reviewed against the `ui-ux-pro-max` guidance
(touch targets and spacing, truncation, icon and state rules). Its points, and
how they were applied:

| Guidance | Applied as |
|---|---|
| Touch targets 44px, 8px between targets (`touch-target-size`, `touch-spacing`) | Navigation, the row's Read and Actions, and the Catch up actions keep 44px. Only the drawer drops, by the owner's choice, to 32px: above WCAG 2.5.8's 24px floor, with 8px between every drawer target |
| Truncate with an ellipsis and offer the full text (`truncation-strategy`) | One line with an ellipsis; the row's toggle is the expand. The text is never removed, so screen readers read it whole |
| Prefer wrapping as text grows (`dynamic-type`) | At 200% text the Catch up labels wrap inside their buttons rather than the row wrapping; truncated rows still expand on open |
| Icon-only buttons need labels (`aria-labels`) | Every emoji and the X are `aria-hidden`; the buttons are named in words ("Pin" / "Unpin", "Draft" / "Edit draft", "Archive" / "Unarchive", "Close actions"), with a matching `title` on the emoji buttons |
| No emoji as icons (`no-emoji-icons`) | Overridden by the owner's choice of emoji. The risks it names (font-dependent colour, no theming) are handled by drawing them monochrome with the thumbs' filter (white on dark, black on light), measured at 3:1 or better in `tests/contrast-audit.mjs` |
| State not by colour or label alone (`state-clarity`, `color-not-only`) | A set state (pinned, a draft saved, archived) also draws a 3px inset bar under its button, like a selected nav cell |
| A visible close (`modal-escape`) | The open row's "..." becomes an X; a tap anywhere else closes it too |
| 16px fields so iOS does not zoom (`readable-font-size`) | Drawer fields are shorter by padding (4px 8px) only; their text stays at the narrow 16px |

### 14a. The Catch up action row

- Mark all read, Set catch-up point to now and its info button sit on one row
  (`.tfcc-cubar`, `flex-wrap: nowrap`). They never wrap.
- **Labels by measurement.** `fitCatchUp` runs where `fitHeader` runs (after
  every draw, and from the `ResizeObserver`) and reads only the panel's own
  nodes: the bar's width and its three controls, measured with each label set.
  The pure `catchUpLabelMode(content, full, short)` returns `full` while the
  full labels fit, `short` only when they would wrap, else `wrap`. The choice
  is a class on the panel (`tfcc-cu-short`, plus `tfcc-cu-wrap`), so it
  survives each `innerHTML` rewrite.
- **Short labels:** "All read" and the owner's "Catch-", up arrow, "2", down
  arrow (U+2191 and U+2193, written as JS escapes so the source stays ASCII).
  Since #41 the second is "Caught up"; see below.
  The accessible names stay "Mark all read" and "Set catch-up point to now"
  (`aria-label`; the short label span is `aria-hidden`).
- **Measured in the previews:** at 14px text the full labels need about 340px
  against 325px of content at 375, so all three phone widths (375, 320, 280)
  use the short labels, which need about 218px.
- **The fallback.** If even the short labels cannot fit (200% text at 320 and
  375 in the previews), the row still holds one line of controls: the info
  group is flattened (`display: contents`), so the two label buttons share the
  width equally (`flex: 1 1 0`, at least 44px; 107px each at 320 and 135px at
  375 under 200% text) and their labels wrap inside them; the info button
  keeps 44px. The audit fails an unequal split or a label wider than its
  button (PR #40 review: before the fix the split was 141 / 73 at 320 and the
  catch-up label overflowed). Nothing here goes below
  44px, so this row never needs the header's 24px floor.
- **Known trade-off:** the short catch-up label is not contained in its
  accessible name "Set catch-up point to now" (WCAG 2.5.3, label in name, level
  A). The owner asked for the full names; a voice-control user saying the
  visible label may not reach it. "All read" is contained in "Mark all read".
- **Trade-off accepted (#41, owner decision).** The owner accepts the WCAG
  2.5.3 label-in-name trade-off for the short catch-up label, because voice
  control is not used in Torn PDA, where the narrow layout runs. The
  accessible name stays "Set catch-up point to now".
- **"Caught up" replaces the arrow label (#41, owner decision).** The owner
  replaced "Catch-", up arrow, "2", down arrow, because it was confusing. The
  short pair now reads "All read" (marks threads read) and "Caught up" (moves
  the catch-up point to now). Only the short label changed: the full label,
  the accessible name, the info button and desktop are as before. Re-measured
  in the previews at 14px text: "All read" 65px, "Caught up" 83px, the info
  button 44px, so the short row needs about 204px (218px with the arrows) and
  all three phone widths still use it. At 200% text, 375px now fits the short
  labels (113 / 147 / 44) where the arrow label needed the wrap fallback;
  320px still takes the fallback with an equal split (107 / 107 / 44). 280px
  at 200% is unsupported, as before (spec 4.7).

### 14b. One-line row text

- In every list that renders rows (Threads, Catch up, My posts, Search's
  matching threads) the title link, the note (tagline) and the meta line are
  one line with `text-overflow: ellipsis`.
- **The meta line collapses too (decision).** Closed, a row is a summary; the
  meta wrapped to two or three lines at 320px, which undid most of the saving.
  Live status (unread, "not checked yet", "not subscribed", "locked") renders
  first in the meta, so it is the last thing the ellipsis reaches, and the
  open drawer shows the whole line. Search hits (post text) and the Drafts
  list have no drawer and are unchanged.
- The open row (`openRowId`) carries `tfcc-open` and shows all three whole.
- The title anchor stays one `display: block` band of full width and at least
  24px, so the cut never shrinks the tap target; its text is whole in the
  markup, so its accessible name is the full title.

### 14c. The close toggle and click-away

- While open, the Actions toggle draws an inline ASCII SVG X (`GLYPHS.close`),
  keeps `data-act="row-more"` and `aria-expanded="true"`, and is named "Close
  actions". Closed it is the "..." named "Actions for <title>". Tapping it
  again closes the drawer; opening another row closes the first (unchanged).
- **Inside the panel:** a click whose target is neither the open row's toggle
  nor inside its drawer (`#tfcc-act-<id>`) applies the pure `dismiss`
  transition (`openRowId` to null, nothing else) at once, then does its own
  job; an action that redraws renders the drawer closed in that one redraw.
  The closing redraw itself runs after dispatch (zero delay) for every
  target, so the tapped node is still there for its native default action: a
  link followed, a field focused, a select's picker, a label's control (PR #40
  review). The press-hold flush is deferred the same way. With a dirty drawer
  field the press-hold still gives one redraw: commit, close and the tapped
  action.
  Focus follows the tapped control's own plan, as before.
- **Outside the panel:** one capture-phase `click` listener on the window,
  bound once like `pressWinBound`. It checks only whether `#tfcc-panel`
  contains the target; it reads no Torn markup, never calls `preventDefault`
  or stops propagation, and redraws only the panel after dispatch. `click`,
  not `pointerdown`, so scrolling the page does not close the drawer. ADR
  0001: an event subscription that inspects the script's own node, within the
  owner's ruling in section 5; recorded in `docs/architecture.md`.

### 14d. The compact drawer

- Pin, Draft and Archive are the owner's emoji (pin U+1F4CC, pencil U+270F
  U+FE0F, wastebasket U+1F5D1 U+FE0F, written as escapes; the wastebasket was
  replaced in #41, below) in `aria-hidden`
  spans, drawn monochrome with the thumbs' filters: `grayscale(1)
  brightness(0) invert(1)` on dark, `grayscale(1) brightness(0)` on light.
  They sit on one row (`.tfcc-drawer-btns`, nowrap) with the check-mark Mark
  read outside Catch up. The buttons keep their `data-act` values and are
  named and hinted in words.
- **Sizes:** drawer buttons (the four above and the priority stepper's - and
  +) are 32 x 32 minimum; the folder select and the tag and note fields are
  32px tall minimum with 4px 8px padding and 16px text; 8px between all drawer
  targets (grid gap, button row gap, stepper gap). Navigation, Read, Actions
  and the Catch up actions keep 44px.
- **Archive and the wastebasket.** The owner chose the wastebasket. Archive is
  reversible, not a delete, so the name and the hint say "Archive" (or
  "Unarchive"), never "Delete"; the mutation check fails if the name changes.
  Whether the hint should add "(can be undone)" is left to the owner.
- **#41: the archive icon replaces the wastebasket.** The owner asked for a
  glyph that reads as archive, not delete: UXWing's "archive files" icon (a
  box with a down arrow), inlined as one ASCII SVG path (`ARCHIVE_SVG`,
  class `tfcc-archico`, 18 x 18 by its attributes, `aria-hidden`, no id, no
  xmlns). It is filled with `currentColor`, the button's text colour, so it
  is monochrome in both themes without the emoji filter, and the contrast
  audit measures its fill against the button at 3:1 or better. UXWing's
  licence allows commercial use without attribution; it is quoted beside the
  icon and credited in the README. Pin and Draft keep their emoji.

### 14e. Clip titles and summaries that wrap (#41)

The owner made 14b's one-line cut a setting, and carried it to desktop.

- **The setting:** `settings.clipLines`, on by default. A stored blob with no
  field (every install before #41) normalises to on; an explicit `false` is
  kept; a present value that is not a boolean takes the default. A blob saved
  before #41 is not reported as damaged: `isRecoveredValue` fills the missing
  top-level field from the normalised value before comparing
  (`tests/clip-lines.test.js` loads main's own blob).
- **Settings:** Appearance, right after "Hide the panel when I open a thread":
  a checkbox "Clip titles and summaries that wrap" (`data-act="clip-lines"`)
  and an info button, `settings-clip`, "About clipping" (the 13d pattern),
  whose text says how to read a clipped row at each width.
- **One switch:** the runtime puts `tfcc-clip` on the panel while the setting
  is on, beside `tfcc-narrow`, on every render. Every clipping rule hangs off
  it: off, nothing clips at any width.
- **On, every width:** a thread row's title and note (its summary) are one
  line with an ellipsis. Narrow, this is 14b unchanged, and the open row
  (`tfcc-open`) shows them whole. Wide, `.tfcc-row-main .tfcc-row-title`
  clips (its flex item already has `min-width: 0`), and `.tfcc-row >
  .tfcc-note` clips, one rule for both widths.
- **The meta line (decision):** it follows the setting on narrow only, as 14b
  collapsed it: on, one line, with the drawer showing it whole; off, the
  pre-#39 flex row that wraps. Wide never clips the meta. A wide row has no
  drawer, its meta spans carry tooltips of their own (the time's source, the
  author-only reason), and one tooltip cannot stand in for a line of separate
  facts; at desktop widths the meta rarely wraps anyway.
- **Wide tooltips:** with the setting on, the wide row's title span and note
  carry `title` with the full text, so hovering shows it. The tooltip is on
  the span, not the link: the link's accessible name stays its own text, the
  full title, with no duplicate description. Narrow rows carry no tooltip;
  the drawer is their expand.
- **Desktop parity:** the golden (`tests/fixtures/wide-golden.json`) is
  compared with the setting off, where every wide row and nav is main's byte
  for byte. The one other wide markup change, the new Settings checkbox, is a
  listed literal replacement (`tests/wide-41-diffs.js`), like 13d's. A
  separate test pins what "on" adds: exactly the title attributes on each
  row's title span and note, and the checkbox ticked; the stylesheet text is
  the same either way, and its three new wide selectors are listed and all
  start `#tfcc-panel.tfcc-clip`. The golden was not regenerated.
- **Measured in the previews** (`clip-on-*`, `clip-off-*`,
  `narrow-threads-clipoff-*`, `narrow-threads-drawer-long-*`): on, the long
  title and summary are cut to one line at 720px wide and at 375, 320 and
  280px; off, they wrap; an open long row is whole. The contrast audit fails
  a page whose setting does not do this.
- **Found, not changed:** in the open narrow row at 280px the meta line's
  last tag can sit past the meta's box under the row's buttons (visible
  overflow, no overlap with a control). This predates #41 (#39's open meta).
