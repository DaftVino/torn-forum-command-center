# Rows shown cap - design

**Status:** proposed, 2026-10-08.
**Issue:** #3, "feat: setting to cap rows shown in Threads, Catch up and My posts".
**Related:** #2 (My posts view), which this cap must also govern.
**Target release:** the next minor release cut from `main` after this merges.
The PR adds an `[Unreleased]` CHANGELOG entry only; the version bump is a
separate release commit (see Version below).

## Problem

A user who follows many threads gets a long scroll in Threads and Catch up, and
the panel takes over the sidebar. There is no way to cap how many rows a list
shows at once.

## What the user gets

A **Rows shown** setting in the Settings view, options **3, 5, 10, 20, 30,
All**, default **All**. Existing users see no change.

- It caps **Threads** and **Catch up** now, and **My posts** once #2 lands.
- **Search** and **Drafts** always show everything and ignore it.
- The cap is the last step: it applies after the folder filter, the tag filter,
  Unread only, the filter box, the sort mode and pinned-first. The user sees the
  top N of what they asked for.
- When the cap hides rows, the list ends with a line that says so, "Showing 10
  of 42", and a **Show all** button. Show all holds for that view until the page
  reloads. Once expanded, the same line reads "Showing all 42" with a **Show 10
  only** button that puts the cap back.
- The Catch up nav count `(N)` keeps counting everything.

## Decisions

| Question | Decision | Why |
|---|---|---|
| Stored shape | `settings.rowsShown`, a number from `ROWS_SHOWN_OPTIONS = [3, 5, 10, 20, 30, 0]`, where `0` means All. Default `0`. | A menu, not a free number, so the normaliser can refuse anything off the menu. `0` for All matches the existing `autoRefreshMs: 0` means Off convention. |
| Normalising | Total. Anything that is not a `number` on the menu becomes `0` (All): a string `"10"`, `10.5`, `-3`, `7`, `true`, `null`, an absent field. | The issue requires corrupt to mean All. Strict `typeof` rather than `toInt`, because `toInt(10.5)` floors to 10 and would accept a value the menu never wrote. |
| Schema version | Unchanged (`SCHEMA_VERSION = 1`). | An absent field already normalises to All, and an older build reading a newer blob builds from its own defaults and drops the unknown field. Both directions are safe without a bump. |
| Where the cap lives | One pure engine function, `capRows(rows, limit, expanded)`, in the engine section after `catchUpList`. It takes everything as arguments and copies rather than mutates. | Constraint 5 (engine purity). One helper means #2 calls the same function rather than growing a second cap. |
| Which views | `CAPPED_VIEWS = ['threads', 'catchup']` and `UNCAPPED_VIEWS = ['search', 'drafts', 'settings']`, both frozen engine constants. A test asserts every entry of `VIEWS` is in exactly one of them. | A new view (My posts) cannot be added to `VIEWS` without someone deciding whether it is capped. The failing test is the reminder. |
| Model shape | `model.rows` and `model.catchUp` stay the **full** sorted lists. A new `model.capped = { threads: <cap>, catchup: <cap> }` carries what the two views render. | `model.rows` is what the Search view lists and what deep search fetches ("the threads currently listed"), and `model.catchUp.length` is the nav count. Leaving both whole makes "Search is uncapped" and "the nav count is uncapped" structural rather than something each renderer has to remember. |
| Order of operations | `visible` (existing filter) -> `sortThreads` (pinned-first plus sort mode) -> `capRows`. Catch up: `catchUpList` -> `sortThreads(..., 'activity')` -> `capRows`. | The issue: top N of what was asked for. |
| Pinned threads | They take cap slots like any row. With five pinned threads and a cap of 3, the list shows three pinned threads and "Showing 3 of N". | Pinned-first is part of the sort, and the cap comes after the sort. Exempting pins would make "Rows shown 3" show eight rows, which is not what the setting says. |
| Catch up grouping | The cap applies to the flat, activity-sorted catch-up list, then the shown rows are grouped by folder as today. A folder heading's `(n)` counts the rows shown under it. | Capping each folder separately would show up to N times the folder count. A heading count that disagreed with the rows beneath it would read as a bug. |
| Mark all read | Unchanged: it still marks every row, including rows the cap hides. | It is labelled "all", and the "Showing 10 of 42" line makes the hidden rows visible. Changing its reach is out of scope. |
| Show all scope | In memory only: `state.showAll`, keyed by view (`{ threads: true }`). Never persisted, never exported. It survives hash navigation within `forums.php`. It clears on page reload, on any change to Rows shown, and on Reset everything. | The issue asks for "the current session only". A page reload is the session boundary a userscript has. Changing the setting is a fresh statement of what the user wants, so a stale expansion should not override it. |
| Show all and filters | The expansion holds per view across filter, sort and Unread only changes. | It means "stop capping this list". It does not mean "show this one result set". Resetting it on every keystroke in the filter box would be surprising. |
| Control | One action, `rows-toggle`, on a button carrying `data-view`. The label switches between "Show all" and "Show N only". | One handler case and one rendered control keep `tests/handlers.test.js`'s rendered-equals-handled check simple. |
| Placement | A `tfcc-bar tfcc-cap` line after the rows (after the last folder group in Catch up). No line at all when the cap does not bite: All, or a list no longer than the limit. | A capped list is short by definition, so the line is never far down. No new colours: the line uses `tfcc-note` and the stock button, so the contrast audit is unaffected. |
| Empty lists | Unchanged. The existing empty-state text renders, with no cap line. | |
| Settings control | A `select#tfcc-rows`, `data-act="rows-shown"`, in the Appearance section, labelled "Rows shown", with options 3, 5, 10, 20, 30, All. The note below it names the capped views from `CAPPED_VIEWS` through a module-level `VIEW_LABELS`, hoisted out of `renderNav`. | Deriving the text from the constant means #2 changes one array and the Settings text follows. |
| Export and import | **Not included.** `encodeState` carries folders, per-thread organiser state and drafts only. No setting (theme, sort, budget) is exported today, so `rowsShown` is not either. A test pins that the export payload carries no `rowsShown`. | The issue makes export conditional on settings already being exported. They are not. |
| Request budget | Unchanged. The cap is render-only and issues no request. Constraint 7's text in Settings does not change. | |
| Search's existing 50-row ceiling | Untouched. `renderSearchView` already stops at 50 rendered thread matches regardless of any setting. That is not this setting, and changing it is out of scope. | Noted so a reviewer does not read it as the cap leaking into Search. |

## Interfaces

```js
// Engine constants (next to VIEWS).
var ROWS_SHOWN_OPTIONS = Object.freeze([3, 5, 10, 20, 30, 0]); // 0 = All
var CAPPED_VIEWS = Object.freeze(['threads', 'catchup']);
var UNCAPPED_VIEWS = Object.freeze(['search', 'drafts', 'settings']);
var VIEW_LABELS = Object.freeze({ threads: 'Threads', catchup: 'Catch up',
  search: 'Search', drafts: 'Drafts', settings: 'Settings' });

// Engine. Pure: no DOM, no state, no clock. Never mutates `rows`.
// capRows(rows, limit, expanded) -> {
//   rows:       the rows to render (a copy),
//   total:      rows.length before the cap,
//   limit:      the effective limit, 0 for All or an off-menu value,
//   hidden:     how many the cap is hiding right now,
//   expandable: true when the cap would bite (limit > 0 and total > limit),
//   expanded:   true when expandable and the user chose Show all,
// }

// Runtime.
state.showAll = {};                       // { threads?: true, catchup?: true }
model.capped = { threads: <capRows result>, catchup: <capRows result> };
renderCapLine(cap, view) -> string        // '' when !cap.expandable
```

## How #2 (My posts) reconciles

This PR and #2 can merge in either order. Whichever lands second does the
reconciliation, and a test makes the second one fail until it does.

**If this PR merges first.** #2 adds `'mine'` to `VIEWS`. The test
"every view is classified as capped or uncapped" then fails. To pass it, #2:

1. adds `'mine'` to `CAPPED_VIEWS` and `mine: 'My posts'` to
   `VIEW_LABELS`;
2. builds its sorted list in `buildPanelModel`, then sets
   `model.capped.mine = capRows(sortedMyPosts, s.rowsShown, state.showAll.mine === true)`;
3. renders `model.capped.mine.rows`, then `renderCapLine(model.capped.mine, 'mine')`;
4. adds one test to `tests/rows-cap.test.js` that copies "Threads caps after
   the sort" for My posts: six rows in reverse title order, a cap of 3, and
   the top three asserted, plus "Showing 3 of 6" and the `rows-toggle` button
   with `data-view="mine"`. It also adds My posts to the "Search lists every
   match" style guard if My posts shares `model.rows`.

The Settings note then reads "Applies to Threads, Catch up and My posts" with no
text change, because it is built from `CAPPED_VIEWS`. The `rows-toggle` handler
already accepts any view in `CAPPED_VIEWS`, so it needs no change.

**If #2 merges first.** This PR rebases onto it and does steps 1 to 4 itself
before review. `renderNav`'s label map will already contain `mine`. This PR
moves that map to `VIEW_LABELS` in the same commit that hoists it. The plan's
Task 2 and Task 4 say where.

Either way the closing artifact for #3, "caps My posts", is proved by that
My posts cap test. If #2 has not landed when #3 closes, that clause is
proved by the classification test instead: My posts cannot exist uncapped.

## Testing

| Promise | Suite |
|---|---|
| `capRows` caps, copies, reports totals, ignores off-menu limits, expands | `tests/rows-cap.test.js` (new) |
| Every `VIEWS` entry is in exactly one of `CAPPED_VIEWS` / `UNCAPPED_VIEWS` | `tests/rows-cap.test.js` |
| `rowsShown` round-trips, defaults to All, and corrupt or off-menu values become All | `tests/storage.test.js` |
| The setting survives a reload | `tests/storage.test.js` |
| Threads caps after filter, Unread only, sort and pinned-first | `tests/rows-cap.test.js` |
| Catch up caps the activity-sorted list, the nav count stays full, and headings count shown rows | `tests/rows-cap.test.js` |
| Search and Drafts render every row with the cap at 3 | `tests/rows-cap.test.js` |
| "Showing N of M", Show all, Show N only, and no line when the cap does not bite | `tests/rows-cap.test.js` |
| The settings select changes and persists the value and clears Show all; Show all is never persisted | `tests/handlers.test.js` |
| Every rendered control has a handler, including `rows-toggle` and `rows-shown` | `tests/handlers.test.js` (fixture grows to make the cap bite) |
| The export carries no `rowsShown` | `tests/share.test.js` |
| The engine stays pure | `tests/purity.test.js` (unchanged; it covers `capRows` by position) |

Five new mutations in `tests/mutation-check.mjs`. Each breaks one promise above:
the cap is ignored, the cap runs before the sort, the nav count counts capped
rows, Search renders the capped list, and the normaliser accepts an off-menu
value.

`docs/qa-checklist.md` gains a Rows shown block under "The workspace", walked on
a real account on both Torn PDA and desktop.

## Assumptions

- **Session means page load.** A userscript has no other session boundary it can
  observe reliably. Hash navigation inside `forums.php` keeps the expansion.
  Leaving the page does not.
- **Show all is per view.** Expanding Threads does not expand Catch up.
- **Pinned rows consume slots.** The issue's "top N of what they asked for"
  includes pinned-first. A user who wants pins always visible sets a larger cap.
- **No per-view setting and no pagination.** Both were rejected in the issue.
- **Settings stay out of export.** If a later change starts exporting settings,
  `rowsShown` goes with them. The share test that pins its absence will fail
  and has to be updated deliberately.
- **Version.** This PR does not bump the version. #2, #3 and #4 share one
  convention: each adds its entry under `## [Unreleased]`, and a single release
  commit on `main` later moves `@version`, `SCRIPT_VERSION`, `package.json`,
  the newest `CHANGELOG.md` heading and the tag together (constraint 8). The
  three PRs can then merge in any order with no version conflicts, and the
  tag lands on a commit that a squash merge cannot discard.
- **No ADR.** This follows existing conventions: a settings field, an engine
  helper, a view-model field. It changes no architecture and deviates from no
  standard, so no ADR and no outbox note are needed.

## Non-goals

- Pagination, infinite scroll, or a per-view cap.
- Changing Search's existing 50-row rendering ceiling.
- Changing what Mark all read or Set catch-up point act on.
- Any request, endpoint or budget change.
