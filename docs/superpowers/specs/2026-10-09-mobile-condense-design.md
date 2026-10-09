# Condense the narrow mobile view (#33)

**Status:** Proposal. The owner picks a direction before anything is built.
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

1. **Threads first.** The first row should start within about 170px of the
   panel's top, so the first screen shows three or more threads.
2. **Show what you read, hide what you change.** Titles, unread counts, pins,
   tags and notes stay on the row. Controls that change a thread go one tap
   away.
3. **One tap to anything frequent, two to anything rare.** Refresh, Hide, the
   views, Unread only and the filter field stay one tap away. Sort, the
   folder and tag filters and per-row edits are two taps away.
4. **44px where a thumb goes.** Every control in the condensed layout is at least
   44px tall. Width is at least 40px, with a gap between neighbours.
5. **No gestures, no hover, no floating layers.** Every disclosure is an inline
   region under the button that opened it. Nothing depends on swipe or
   long-press. Nothing is positioned over Torn's page except Expand, which
   already does that.
6. **Same actions, new places.** Every existing `data-act` keeps its name,
   handler and meaning. Condensing is markup and CSS. It is not new behaviour.

## 3. Three concepts

All three share the header from principle 1. The header is one line: the logo
at 24px, the badge chip, and then Refresh, Expand and Hide as 40 x 44 icon
buttons with aria-labels. "16 new" moves into the nav. "6 subscribed" moves
into the Threads count's accessible label and into Settings.

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

## 4. Recommendation: Concept A, with the dock kept for later

Build **Concept A**. Mockup at 320px: `recommended-320.html` / `.png`.

Reasons:
1. It meets the goal, condense without removing, with the least new behaviour.
   Every `data-act` keeps its name and handler, so the handler tests,
   `tests/handlers.test.js` coverage and the mutation check keep their meaning.
2. It roughly halves the panel: 1146 to 728px at 375, and 1432 to 808px at
   320. The first row moves up from 319 / 379px to 165px at both widths.
3. Every control in the condensed layout is 44px tall. The badge chip is the
   one exception, at 28px. The fix is a transparent `::after` hit area that
   leaves its look unchanged.
4. It is the safest on Torn's page. Nothing is sticky or floating, and there is
   no gesture.
5. B and C stay possible later. B's dock can be added to takeover alone. C's
   bulk Mark read can be added to Catch up as its own issue.

Two details come from the other concepts:
- **The priority stepper** (from B's grid) replaces the 22 x 16 +/- on narrow
  screens. Desktop keeps the inline #30 controls.
- **Count badges in the nav cells** (from B's dock) replace the
  "Catch up (3)" text.

### Breakpoint

`@media (max-width: 600px)`, the breakpoint `panelStyleText()` already uses for
narrow screens. One markup, CSS decides:
- Desktop (above 600px): the "..." toggle, the More cell, the filter
  disclosure button and the stepper are `display: none`. The drawer's controls
  show inline as today's action row, and the nav shows all six views as now.
- Narrow (600px and under): the drawer is hidden unless its row is open, and so
  on.

A container query on the panel would track the panel's own width, which is
better, since the inline panel is narrower than the viewport. See open
question 4.

## 5. What stays exactly as it is

- Every `data-act` name, value and handler, plus storage, the model and the
  request budget (13 per refresh, 40 per minute).
- The desktop layout above 600px, including #30's inline priority.
- The thread link markup (`data-tfcc-thread`) and #8's plain-click rule.
- The badge chip's markup, aria-label and look, the shelf, the toast and the
  catalogue.
- The reactions pill's markup and behaviour (opens My posts). Only its place on
  narrow screens moves into More.
- The cap line and Show all. The cap line gets a 44px button.
- The Search, Drafts and Settings views, apart from the shared 44px minimum
  height and 16px input text on narrow screens.
- The colour tokens, both themes and the focus ring. No new colour is
  introduced. The count badge reuses the `.tfcc-badge` pair (`--tm-good-bg` on
  `--tm-text`), which `tests/contrast-audit.mjs` already covers.

## 6. Accessibility

- **Targets:** 44px tall for every control in the condensed layout. The icon
  buttons are 40px wide with 4px gaps, so the trio fits in 270px. That is
  above WCAG 2.2 AA's 24px and at Apple's 44pt. The chip gets an `::after` hit
  area so the 28px pill has a 44px target.
- **Names:** the icon buttons carry `aria-label` and `title` (Refresh, Expand or
  Shrink, Hide or Show). The SVGs are `aria-hidden`. A nav cell's label
  includes its count ("Threads, 16 new, 6 subscribed"). The "..." toggle is
  "Actions for <title>".
- **State:** the view cells keep `aria-pressed`, as now. More, the filter
  button and "..." use `aria-expanded` plus `aria-controls` on an id prefixed
  `tfcc-` with the thread id. These are buttons, not `role="tab"` or
  `role="menu"`, because those roles promise arrow-key handling the panel does
  not have.
- **Focus survives a redraw.** The panel re-renders with `innerHTML`, which
  drops focus. After a redraw the user caused, the implementation refocuses
  the element with the same `data-act` and `data-id` (or `data-view`). Without
  this, a keyboard or TalkBack user lands at the top of the page after every
  "..." tap.
- **Order:** the DOM order is the visual order. The drawer follows its row's
  meta, so the swipe order in TalkBack reads title, meta, actions.
- **No hover:** nothing appears on hover. Every `title` is a duplicate of
  visible text or of an aria-label.
- **Contrast:** only existing token pairs are used. `tests/contrast-audit.mjs`
  gets the new narrow previews (section 9) so it measures them in both
  themes.
- **Reduced motion:** the drawer opens without animation. If a transition is
  added, it goes under `prefers-reduced-motion: no-preference`, like the toast.

## 7. Behaviour that must survive

| Behaviour | How it survives |
|---|---|
| #8 auto-hide: only plain clicks on a thread link collapse | The "..." toggle, stepper and drawer controls are siblings of the title span, never inside the `data-tfcc-thread` anchor, so `threadLinkOf` returns null for them. A test asserts that `row-more` does not collapse. |
| Expand / takeover | The trio keeps `data-act="takeover"` and `aria-pressed`. Only the label becomes an icon. Takeover's own CSS is unchanged. |
| Badge chip and shelf | The chip is unchanged and stays in the header. The shelf still opens under the header. |
| Reactions pill opens My posts | The same button, `data-act="view" data-view="mine"`, now inside More on narrow screens. Desktop is unchanged. |
| Rows cap and Show all | The cap applies before rendering, as now. The open drawer is keyed by thread id, so Show all does not lose it. |
| Drafts | Draft / Edit draft is in the drawer with the same `data-act="draft"`. Drafts is in More, with its count shown on the More cell. |
| Search | The Search view is in More. The filter field stays on the Threads and My posts screens. |
| 320px header wrap rule | Refresh, Expand and Hide stay one `nowrap` unit (`.tfcc-head-btns`). If text zoom makes the line overflow, the unit wraps whole, in order, as now. |
| Collapsed panel | Collapsed shows only the header line. Hide becomes Show, a chevron with the label "Show". Open question 1 asks whether Show should keep a text label. |
| Redraws under the caret | The tag and note inputs in the drawer are ordinary panel inputs, so the existing `pendingRedraw` guard covers them. |

## 8. Constraints

- **ASCII-only source.** The new icons (refresh, expand, shrink, chevron, dots,
  funnel, star, check, pencil, archive, search, gear) are inline SVG paths
  written in ASCII, `currentColor`, `aria-hidden`. The thumbs stay as the
  owner-approved emoji, written as the `THUMB_UP` / `THUMB_DOWN` surrogate-pair
  escapes in the source.
- **No new Torn DOM access (ADR 0001).** All of this is panel markup and the
  panel stylesheet. Nothing reads the host page.
- **No new requests.** Nothing here fetches anything.
- **No hover-only affordance.** See section 6.
- **Delegated clicks read `data-act` from `ev.target`.** Every new control is a
  `<button>` carrying its own `data-act`, and its icon and text children sit
  under the existing `button * { pointer-events: none }` rule. The "..."
  toggle's SVG is not a target.
- **New view state is in `state`, not the DOM.** An `open` attribute on a
  `<details>` element would be wiped by the next background redraw.
  `openRowId`, `navMoreOpen` and `filtersOpen` live in `state` and are never
  persisted, like `showAll`. A view change closes all three.

## 9. Implementation notes (for the plan, not decided here)

- New actions: `row-more` (`data-id`), `nav-more` and `filters-toggle`. Each
  toggles one state key and calls `redraw()`.
- `renderRow` emits the drawer always, with a `tfcc-open` class when
  `openRowId` matches. CSS hides the closed drawer on narrow screens and always
  shows it on desktop. The priority stepper is drawer markup, hidden on
  desktop. The inline #30 priority is hidden on narrow screens.
- `tests/render-preview.mjs` gains `threads-narrow-320-{dark,light}` and an
  open-drawer variant, so `contrast-audit.mjs` measures them.
- QA checklist: replace "Priority (#30) at the narrowest width" with the
  drawer stepper. Add "every narrow control is at least 44px tall" and "...
  does not hide the panel".

## 10. Open questions for the owner

1. **Hide and Show as icons or text?** Show is the one control a collapsed
   panel offers, and #8 collapses the panel often. Keep "Show" as text (about
   56px) when collapsed, and use the chevron icon when open? The mockups use
   icons throughout.
2. **Should Mark read stay visible on rows in Catch up?** It is the one action
   used daily. A 40 x 44 check button beside "..." in Catch up only would keep
   it at one tap, at the cost of title width.
3. **Where should the reactions pill live on narrow screens?** The recommendation
   puts it in More. The alternative is a slim line under the nav, which costs
   about 28px.
4. **Viewport media query or container query?** 600px matches the existing
   rule. A container query on the panel would also condense a narrow panel on
   a tablet or desktop sidebar. Its support in PDA's WebView is very likely,
   but it is unverified on the owner's device.
5. **Concept B's dock in takeover only.** Worth a follow-up issue once A ships?
6. **Concept C's bulk Mark read in Catch up.** Worth its own issue?
