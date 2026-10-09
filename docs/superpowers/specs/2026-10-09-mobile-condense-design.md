# Condense the narrow mobile view (#33)

**Status:** Proposal, revised after the Codex adversarial review (section 11). The owner picks a direction before anything is built.
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
4. **Real 44 x 44 boxes.** Every control in the narrow layout has a box at least
   44px wide and 44px tall (`min-width` / `min-height`, never a fixed height).
   No pseudo-element hit areas, and no box overlaps another.
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

## 4. Recommendation: task-first A

Mockups: `revised-375.html` / `.png` and `revised-320.html` / `.png`. Each
shows dark and light, Threads, Catch up with a one-tap Read and one open
drawer, filters open, the badge shelf open, My posts with the reaction
totals, and the collapsed header. The 320px file adds a 200% text frame.

```
375px (325px of content)                 320px (270px of content)
+------------------------------------+   +-------------------------------+
| FCC (cup 4 flame 5)  [ref][exp][^] |   | FCC (cup 4 flame 5)           |  44
|------------------------------------|   |              [ref][exp][^]    |  44
| [Threads 16 new][Catch up 3][Search]|  |-------------------------------|
| [Drafts 1 ][Settings  ][My posts 1]|   | [Threads][Catch up][Search ]  |  2 x 44
|------------------------------------|   | [Drafts ][Settings][My posts] |
| [filter threads......][Unread][Y 1]|   | [filter.......][Unread][Y 1]  |  44
|------------------------------------|   |-------------------------------|
| * A practical education guide and  |   | * A practical education       |
|   script companion                 |   |   guide and script companion  |
| 3 new 12m Tutorials and ...  [...] |   | 3 new 12m Tutorials  [...]    |  >= 44
|------------------------------------|   |-------------------------------|
  Catch up rows:
| SideWinder - Advanced Sidebar for  |
| 12 new +2 1h Tools ... [v Read][...]|
```

### 4.1 Header

- **Real 44 x 44 boxes.** Refresh, Expand/Shrink and Hide are 44 x 44 buttons
  with 6px gaps, kept together in `.tfcc-head-btns` (the existing nowrap unit).
- **The chip is a 44px button.** It has no border or fill of its own. The
  28px pill you see is a child `<span>`, so the chip looks the same, but its
  box is 44px tall and overlaps nothing.
- **One line at 375, two at 320, and that is honest.** At 375 the logo (57),
  chip (80) and trio (144) plus gaps are 293px of 325, so they fit on one
  line. At 320 they would need 293px of 270, so the trio wraps whole onto a
  second line, right-aligned, by the existing wrap rule. The header is 44px at
  375 and 94px at 320.
- **Collapsed, Show is text.** When the panel is collapsed, the third button
  reads "Show" next to a chevron, about 75px wide. The "16 new" badge sits
  beside the trio, so the collapsed header still says why it is worth
  opening. Expanded, Hide is a chevron-up icon with the accessible name "Hide
  the panel".

### 4.2 Nav: all six views, no More

- **A 3 x 2 grid of 44px-minimum cells, in `VIEWS` order:** Threads, Catch up and
  Search on top, then Drafts, Settings and My posts below. Search is visible.
  My posts stays last and right with its #30 light-grey style, which keeps
  the QA checklist's "My posts is last and reachable" true.
- **Counts are badges inside the cells:** Threads "16 new", Catch up "3",
  Drafts "1", My posts "1". Each cell's accessible name includes its count
  ("Threads, 16 new, 6 subscribed").
- **Why there is no More.** The review asked for a labelled More. Removing it
  is stronger: every view is visible, there is no menu state, and the review's
  More-focus finding cannot happen. It costs one 44px row compared with the
  first draft, which is the price of discoverability.
- **Reaction totals** (thumbs and karma) on narrow screens show as the first
  line of the My posts view, using the existing pill markup. That is the view
  they describe, and one tap from anywhere. On desktop the pill stays in the
  nav row. Open question 2 offers a slim line under the nav on every view
  instead.

### 4.3 Filter line

- The filter field (16px text, so iOS does not zoom), then Unread (a 44px
  toggle with `aria-pressed`), then Filters.
- **Filters** is 44 x 44 or wider, showing a funnel and the number of active
  filters. Its accessible name is dynamic ("Filters, 1 active"), with
  `aria-expanded` and `aria-controls="tfcc-filters"`.
- Opening it shows Sort, Folder and Tag as 44px selects in an auto-fit grid.

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
  - **Catch up only:** a visible **Read** button (check icon plus "Read",
    `data-act="read"`, aria-label "Mark read: <title>"). Triage stays one tap.
  - **Every view:** an **Actions** button ("...", `data-act="row-more"`,
    `aria-expanded`, `aria-controls="tfcc-act-<id>"`, aria-label "Actions for
    <title>").
- **The drawer** (one open at a time) holds Pin/Unpin, Mark read (not in Catch
  up, where it is already visible), Draft/Edit draft and Archive. Below those
  are a priority stepper (- / value / +, each 44 x 44), Folder, Add tag and
  Note. Every control is at least 44px. It is an auto-fit grid, so it reflows
  to one column at large text.
- **Priority** shows in the meta as `+2` only when it is not zero. The
  inline #30 +/- stay on desktop.

### 4.5 Measured heights

Measured on the mockups in gstack browse (`revised-*.html`). The current
figures are from `threads-narrow.html` and the first draft from
`recommended-320.html` / `concept-a-toolbar-drawer.html`. "First row" is the
first thread row's offset from the panel's top. "Total" is the panel's height
with Rows shown = 5 (Catch up has 3 sample rows). Every control in every
revised frame measured at least 44 x 44. The title links are the one
exception: they are 25px for a one-line title, which is over AA's 24px.

| State | 375 first row | 375 total | 320 first row | 320 total |
|---|---|---|---|---|
| Today, Threads at rest | 319 | 1146 | 379 | 1432 |
| First draft A, at rest | 165 | 728 | 165 | 808 |
| **Revised, Threads at rest** | **209** | **802** | **259** | **940** |
| Revised, filters open | 309 | 902 | 359 | 1040 |
| Revised, badge shelf open | 323 | 916 | 394 | 1075 |
| Revised, one drawer open (row 1) | 209 | 1061 | 259 | 1199 |
| Revised, Catch up at rest (3 rows) | 330 | 835 | 430 | 983 |
| Revised, Catch up, one drawer open | 330 | 1094 | 430 | 1242 |
| Revised, My posts (pill line shown) | 283 | - | 351 | - |
| Revised, collapsed | - | 118 | - | 118 |
| More open | n/a: there is no More | | | |
| Revised, 320 at 200% text | - | - | 430 | 2361 |

What the numbers say:
- At rest, the first row comes up by 110px at 375 and 120px at 320. Five rows
  take 495px instead of 731 at 375, and 583px instead of 957 at 320.
- An open drawer adds 259px, nearly all of it 44px controls. That is the
  honest cost of real touch targets. It is paid only for the one row being
  edited, and closing it is one tap on the same button.
- Catch up's first row is lower because of its two buttons and its
  explanatory paragraph, which are unchanged from today. Open question 5 asks
  whether to shorten that paragraph on narrow screens.

### 4.6 Tap counts

| Task | Today | First draft | Revised |
|---|---|---|---|
| Open a thread | 1 (title text) | 1 | 1 (whole title band) |
| Mark read in Catch up | 1 | 2 | **1** |
| Mark read elsewhere | 1 | 2 | 2 |
| Pin a thread | 1 | 2 | 2 |
| Change priority by 1 | 1 (22 x 16 target) | 2 | 2 (44 x 44 target) |
| Open Search | 1 | 2 | **1** |
| Open Drafts or Settings | 1 | 2 | **1** |
| See reaction totals | 0 (in nav) | 1 (More) | 1 (My posts) |
| Show after auto-hide | 1 ("Show") | 1 (icon) | 1 ("Show", text) |
| Filter by folder | 1 | 2 | 2 |

The rare edits (pin, priority, folder, tag, note, draft, archive) cost one more
tap. In exchange, every target goes from 22px to at least 44px and the
first screen shows threads. Nothing frequent got slower.

### 4.7 At 200% text

An Android WebView can apply the system font scale through `textZoom`, which
scales px text as well. Measured by doubling `--tfcc-text` and `--tfcc-text-sm` at
320px (the last frame of `revised-320.png`):

- No horizontal overflow, and every control is still at least 44 x 44.
- The trio wraps whole onto its own line, as today.
- Nav labels wrap inside their cells ("Catch up" over "3"), which grow
  because they use `min-height`.
- Titles wrap to 4-7 lines, and the meta wraps under the buttons.
- The first row is at 430px, and five rows are about 1760px. That is long but
  usable. Nothing clips and nothing is unreachable.

Supported: 320px wide at 100% and 200% text, and 375px at 100%. Rotation to
landscape crosses into the wide layout once the panel is over 616px wide
(section 5).

## 5. Breakpoint: the panel's own width

The review is right that the viewport is the wrong measure. The inline panel
sits in Torn's content column, and Expand changes its width without changing
the viewport.

**Decision: a `ResizeObserver` on the panel element, which toggles a
`tfcc-narrow` class on it.**

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
  WebView 105+ and iOS 16+ WKWebView. That is very likely on today's devices,
  but it is unverified for Torn PDA's user base (open question 3).
  `ResizeObserver` needs Chrome 64+ and iOS 13.4+.
- **ADR 0001.** The ADR confines DOM access to Torn's markup in two places
  (choosing a mount container, finding the reply textarea) and forbids any
  data path through Torn's markup. Observing the script's own element reads no
  Torn node and no Torn data. Its width is a layout fact the browser computes,
  like the `getBoundingClientRect` the fallback already relies on. This is
  therefore not a third access. CLAUDE.md treats a third access as an
  architectural change, so open question 4 asks the owner to confirm this
  reading. If the owner disagrees, the work needs ADR 0002 first.
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
- `navMoreOpen`: removed. There is no More menu.

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
- Wide panels (no `tfcc-narrow`): today's layout, including #30's inline
  priority and the reactions pill in the nav row.
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

- **Targets:** at least 44 x 44 for every control in the narrow layout, measured
  in both themes and at 200% text. Gaps are 6px. The title band is the full
  row width and at least 24px tall.
- **Names:** the icon buttons have `aria-label`s ("Refresh", "Expand", "Hide
  the panel"). The SVGs are `aria-hidden`. Show is visible text. Read is
  visible text with a per-row label. Filters is "Filters, N active".
- **State:** the nav cells and Unread keep `aria-pressed`. Actions and Filters
  use `aria-expanded` plus `aria-controls`, on ids prefixed `tfcc-` with the
  thread id. Nothing claims `role="tab"` or `role="menu"`, because the panel
  has no arrow-key handling.
- **Focus:** section 6. No user action leaves focus at the top of the page.
- **Order:** the DOM order is the visual order: title, meta, Read, Actions,
  drawer.
- **No hover, no `title` dependence:** every `title` duplicates visible text or
  an aria-label. A touch WebView never shows `title`.
- **Contrast:** only existing token pairs are used. `render-preview` gains
  narrow 320/375 Threads and Catch up previews (dark and light, with a drawer
  open) so `contrast-audit.mjs` measures them.
- **Text size and zoom:** `min-height`/`min-width` only, auto-fit grids, and no
  fixed heights. Section 4.7 shows the 200% behaviour.
- **Reduced motion:** the drawer and filters open without animation.

## 9. Behaviour that must survive

| Behaviour | How it survives |
|---|---|
| #8 auto-hide: only plain clicks on a thread link collapse | Read, Actions and the drawer controls are siblings of the title span, never inside the anchor. `threadLinkOf` returns null for them. Tests: `row-more` and `read` do not collapse. |
| Expand / takeover | The same `data-act="takeover"` with `aria-pressed`. If Expand crosses the breakpoint, section 6 applies. |
| Badge chip and shelf | The same chip content in a 44px box. The shelf opens under the header (measured above). |
| Reactions pill opens My posts | Unchanged on wide panels. On narrow panels it is the first line of My posts, where tapping it is harmless. |
| Rows cap and Show all | The cap applies before rendering. `openRowId` is reconciled against the capped rows. |
| Drafts and search | Drafts and Search are direct nav cells. Draft/Edit draft is in the drawer with the same `data-act`. |
| 320px header wrap rule | The trio is one nowrap unit, and at 320 it wraps whole onto line 2 (measured). |
| Collapsed panel | Header only, with "16 new" and a text "Show". |
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
  - a style test that every narrow control rule sets `min-height` and
    `min-width` of at least 44px.

  The mutation check gains entries that remove the Catch up Read button,
  break reconciliation, and break the focus fallback.

## 11. Review resolutions

The review is at `docs/records/review/2026-10-09-mobile-condense-codex.md`.
There were 23 findings: **19 accepted, 4 modified, 0 rejected outright.** Two
of the four modified findings partly decline the reviewer's fix, with reasons
given.

| # | Finding | Resolution | Reason / where |
|---|---|---|---|
| A1 | 44px claim false (40 x 44, chip pseudo-target) | Accepted | Real 44 x 44 boxes. The chip is a 44px button around the pill. The header is honestly two lines at 320. Sections 4.1, 4.5. |
| A2 | Catch up Mark read regresses to two taps | Accepted | A visible 44px Read on Catch up rows. Section 4.4. |
| A3 | Focus lost when an action removes its row | Accepted | Same control, then next row, previous row, view heading. The successor is captured before mutation. Section 6. |
| A4 | Stale `openRowId` | Accepted | Reconciled after every model build. Section 6. |
| A5 | Dirty editor destroyed by redraw | Modified | Corrected diagnosis: `change` already commits on blur, so the value survives. What gets lost is the tap that caused the blur. Fixed by a press-aware deferred flush, plus a `drawerEdit` mirror against forced redraws. Section 6. |
| A6 | Search and reactions hidden in More | Modified | Stronger than asked: More is removed and all six views are visible. Reaction totals are visible at the top of My posts, not on every view, which saves 50px. Open question 2 offers the alternative. Section 4.2. |
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

## 12. Open questions for the owner

1. **Is two taps acceptable for Pin outside Catch up?** Pin is the next most
   frequent row action. A visible star button beside Actions would make it
   one tap. The cost is about 50px of width on line 2 of every row.
2. **Reaction totals: My posts only, or on every view?** The recommendation
   shows them on My posts. The alternative is a 44px pill line under the nav
   on every view, which costs about 50px of first-screen height.
3. **Container queries in Torn PDA's WebViews.** Chrome 105+ / iOS 16+. Is
   there a known minimum iOS for Torn PDA? This only matters if section 5's
   choice is revisited in favour of pure CSS.
4. **ADR 0001 reading.** Do you agree that a `ResizeObserver` on the script's
   own `#tfcc-panel` is not a third DOM access? If not, ADR 0002 comes first.
5. **Catch up's explanatory paragraph** costs about 50px at 375 and 70px at
   320. Shorten it on narrow panels ("Read here hides a thread from this list;
   Torn's own counter clears when you open it.")?
6. **Concept B's dock** in takeover only, and **a Catch up selection mode**:
   are either worth their own issue later?
