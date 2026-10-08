# Auto-hide on opening a thread - design

**Status:** proposed, 2026-10-08. Awaiting `/plan-eng-review`.
**Issue:** #8, "feat: setting to auto-hide the panel when opening a thread".
**Related:** #2 (My posts view, PR #5), #3 (rows cap, PR #6), #4 (author-only
updates, PR #7). ADR 0001 governs.
**Target release:** the next minor cut from `main` after this merges. The
feature PR adds an `[Unreleased]` CHANGELOG entry only (see Version below).
**Plan:** `docs/superpowers/plans/2026-10-08-auto-hide-on-open.md`.

## Problem

A user clicks a thread link in the panel to read it, and the panel stays open
above or beside the thread. They press **Hide** by hand every time, then **Show**
to come back. The panel should be able to get out of the way on its own, when
the user asks it to.

## What the user gets

A Settings checkbox, **Hide the panel when I open a thread**, default **off**.
Existing users see no change.

With it on:

- A plain click (or Enter) on a thread link the panel rendered collapses the
  panel exactly as **Hide** does, persists that, and lets the browser follow the
  link. The panel arrives on the thread showing only its header, with **Show**.
- If the panel was in **Expand** (takeover), opening a thread also leaves
  takeover, so the thread underneath is readable.
- **Show** brings the panel back, inline. Nothing reopens it automatically.
- Ctrl-click, Cmd-click, Shift-click, Alt-click, middle-click, and
  long-press or right-click "open in new tab" do **not** collapse anything. The
  user is keeping the panel in this tab on purpose.
- Torn's own links (the forum list, breadcrumbs, a bookmark, a full reload into
  a thread) do **not** collapse the panel.

## Current behaviour (verified at `884f614`)

Line numbers are from `torn-forum-command-center.user.js` at `884f614`; grep
before trusting them.

- `settingsDefaults` (l.304) holds `collapsed: false` and `takeover: false`.
  `normaliseSettings` (l.330) accepts each only `=== true`.
- `panelHtml` (l.2967) renders `btn('collapse', model.collapsed ? 'Show' : 'Hide')`
  and, when collapsed, returns after the header (l.2991).
- `makeHandlers` (l.3352): `act === 'collapse'` and `act === 'takeover'` each
  flip their setting, `persist('settings')`, and `redraw()`.
- `renderPanel` (l.3066) toggles the `tfcc-takeover` class from
  `model.takeover` regardless of `collapsed`. Its single delegated `click`
  listener (l.3107) reads `data-act` off `ev.target` and ignores everything
  else, so a click on a thread anchor today does nothing in script and the
  browser follows the link.
- `.tfcc-takeover` is `position: fixed; inset: 0; height: 100vh` (l.2348). A
  collapsed panel in takeover therefore still covers the viewport with an empty
  box and a header. That is why takeover must be cleared here.
- Thread anchors are rendered in three places:
  - `renderRow` (l.2616) via `threadUrl(row)` (l.2591). Used by Threads, Catch
    up, the Search thread list, and #2's My posts.
  - `renderSearchView` deep-search post hits (l.2789).
  - `renderDraftsView` "All drafts" list (l.2839).
  The Search view's **Search on Torn** link (`tfcc-linkbtn`, l.2757) is a link
  to Torn's search, not to a thread.
- All three anchors are absolute `https://www.torn.com/forums.php#/p=threads...`
  URLs. The script runs only on `forums.php` (`@match` and `isForumsPage`), so
  from `www.torn.com` a click is a same-document hash change. Torn's forum is a
  hash-routed single page.
- Navigation: `observeNavigation` (l.3266) debounces `hashchange`, `popstate`,
  patched `pushState`/`replaceState` and a filtered MutationObserver by
  `NAV_DEBOUNCE_MS = 150`, then calls `syncToRoute` (l.3563), which runs
  `captureVisit` and `draw(doc, win, handlers)` (not forced).
- `persist` (l.1876) writes through `GM_setValue` synchronously.

## Decisions

| Question | Decision | Why |
|---|---|---|
| Stored shape | `settings.autoHideOnOpen: boolean`, default `false`. | One more field in the existing `tfcc:settings` key. |
| Normalising | Total: `out.autoHideOnOpen = raw.autoHideOnOpen === true`. A string `"true"`, `1`, `null`, an absent field all become `false`. | Same rule as `collapsed`, `takeover`, `hideTornBox`. Corrupt means off. |
| Schema version | Unchanged (`SCHEMA_VERSION = 1`). | Absent normalises to off; an older build drops the unknown field. Both directions are safe, **once the false damage report below is fixed**. |
| Upgrade from 0.1.0 | `loadKey` stops calling a value damaged just because it lacks a top-level field the normaliser now adds. A new pure engine helper, `isRecoveredValue(raw, value)`, fills absent top-level keys of a plain-object `raw` from `value` before the `JSON.stringify` comparison. | See "The upgrade trap" below. Without this, every existing user's first load after the release shows "Settings were damaged and have been reset." when nothing was damaged or reset. |
| Export | Not exported. | `encodeState` carries no settings today. |
| What triggers it | **Panel links only.** A click on an anchor the panel rendered and marked `data-tfcc-thread`. | See "Panel links, not routes" below. |
| Which panel links | Every thread anchor in every view: `renderRow` (Threads, Catch up, Search thread list, My posts), Search post hits, Drafts list. **Not** Search on Torn. | The issue's list. Search on Torn opens Torn's search page, not a thread to read. |
| Which clicks | Only a plain activation: `button === 0` (or absent), no Ctrl, Meta, Shift or Alt, and `defaultPrevented` false. | Modified clicks open elsewhere (new tab, new window, download); the panel in this tab is still wanted. Middle-click in modern browsers fires `auxclick`, not `click`, so it never reaches the listener; the `button` check covers older engines. Long-press on Torn PDA and right-click open a context menu and fire no `click`. A prevented click does not navigate, so it must not collapse. |
| Takeover | **Leave takeover.** The same write sets `collapsed: true` and `takeover: false`. **Show** then returns the inline panel; the user presses **Expand** again if they want it. | A collapsed panel in takeover still covers the viewport (see above). Restoring takeover on Show would need `tfcc-takeover` to depend on `collapsed`, which changes manual Hide too; out of scope (see Follow-ups). |
| Persist timing | `persist('settings')` runs **synchronously inside the click handler**, before the default action. | The issue: "persists `collapsed: true` before navigation", so a cross-document load (for example from `torn.com` without `www`) arrives already hidden. |
| Redraw timing | Deferred: `setTimeout(redraw, 0)`, guarded by `isForumsPage`. **Not** synchronous. | A synchronous redraw rewrites `panel.innerHTML` while the click is still being dispatched, detaching the anchor that is about to navigate. The spec allows a detached `a` to navigate, but there is no reason to rely on it in a PDA webview. A deferred redraw also covers the case below. |
| Same-page hash navigation | Correct in both cases. (1) The href differs from the current hash: `hashchange` fires, `syncToRoute` draws 150 ms later, but the deferred redraw has already rendered the collapsed header, so the second draw writes nothing (`__tfccHtml` matches). (2) The href equals the current hash (the user clicks the thread they are on): no `hashchange` fires, and the deferred redraw is what collapses the panel. | Tests pin both. |
| Already collapsed | Cannot happen through this path: a collapsed panel renders only its header, with no links. `autoHideSettings` is idempotent anyway. | |
| Focus after collapse | Not moved. The anchor is replaced and focus falls to the document, as it does after manual Hide. | `tests/read-only.test.js` allows exactly one `.focus()` call (the reply box). The page is navigating anyway. |
| Settings placement | Appearance section, after "Autosave the reply box as a draft": checkbox `#tfcc-autohide`, `data-act="auto-hide"`, label **Hide the panel when I open a thread**, with a note. | It changes what the panel looks like; Refreshing is about requests. |

### The upgrade trap

`loadKey` (l.1568) computes
`recovered = raw !== null && JSON.stringify(raw) !== JSON.stringify(value)`,
and `loadAll` (l.1857) turns `recovered` into the notice "Settings were damaged
and have been reset." A 0.1.0 user's stored `tfcc:settings` was written from
`settingsDefaults` order and has no `autoHideOnOpen`. The normaliser appends
`autoHideOnOpen: false`, the strings differ, and the user is told their
settings were reset when every value was kept. #2's spec found the same trap
for `tfcc:feed` and avoided it with a separate key; a new settings field cannot
do that.

The fix, in the engine:

```js
function isRecoveredValue(raw, value) {
  if (raw === null) return false;
  var seen = isPlainObject(raw) && isPlainObject(value) ? Object.assign({}, value, raw) : raw;
  return JSON.stringify(seen) !== JSON.stringify(value);
}
```

`Object.assign({}, value, raw)` takes the normalised key order, overlays every
value the store actually held, and appends any key the normaliser dropped. So:

- a field absent from the store (an upgrade) is not damage;
- a field present with a value the normaliser changed (`collapsed: "yes"`) is
  still damage;
- a field the normaliser dropped (unknown or from a future build) is still
  damage, exactly as today;
- a value that will not parse is still damage (`loadKey` handles
  `PARSE_FAILED` before this).

Only **top-level** absent fields are forgiven. Nested shapes (for example
per-thread entries in `tfcc:organizer`) keep today's strict comparison. This is
deliberately the smallest change that makes a new setting safe.

### Panel links, not routes

The issue asks whether a navigation that did not start in the panel (Torn's
own forum list) should also trigger it. **Recommendation: no, panel links
only.** Reasons:

1. **The panel would hide when the user did not ask.** The setting reads "when
   I open a thread". Following a link in Torn's list is opening a thread, but
   so is a full reload, a bookmark, a back-button press and Torn PDA reloading
   the webview. A route rule cannot tell these apart from `location` alone.
2. **It would fight Show.** With a route rule, the user who presses **Show** on
   a thread and then pages to page 2 (`&b=1`) or follows a quote link gets
   hidden again on the next `hashchange`. "Nothing reopens it automatically" has
   a mirror: nothing re-hides it after the user brought it back. Panel links
   cannot re-trigger, because the user is now clicking Torn's links.
3. **It would break Drafts.** The Drafts view keys its editor off the current
   thread route. A user who opens Drafts on a thread and navigates within it
   would lose the editor to a collapse.
4. **ADR 0001 stays exactly as tight.** The panel-link rule reads only the
   panel's own markup. A route rule would not need Torn's markup either, but
   it would make `syncToRoute` (the capture layer) a writer of UI state, which
   it is not today.

A route-based variant can be added later as a second option if users ask for it.

### ADR 0001 and DOM access

ADR 0001 confines DOM access **to Torn's markup** to two places: the mount
container and the reply textarea. This feature adds **no** access to Torn's
markup.

- The click listener is the panel's existing delegated listener on
  `#tfcc-panel`, a node the script created. No new listener is added to any of
  Torn's elements, to `document`, or to `window`.
- `threadLinkOf(target, panel)` walks from the click target up through
  `parentNode` and **stops at the panel** (and after at most
  `THREAD_LINK_MAX_DEPTH = 4` steps). It reads one attribute,
  `data-tfcc-thread`, which only the panel's own renderers write. A click that
  started outside the panel never reaches this listener, and the walk never
  reads anything above the panel.
- The script initiates no navigation. The browser's default action on the
  user's own click does, exactly as today. `tests/read-only.test.js` ("the
  script initiates no navigation of its own", "never simulates a user
  interaction") keeps passing unchanged.

So the constraint "DOM access exists in exactly two places" is untouched: this
is the panel's DOM, not Torn's. No ADR and no outbox note are needed.

**Selector record (CLAUDE.md constraint 3).** The marker attribute is ours, not
a host selector, so it cannot break when Torn changes. It still gets a purpose
comment next to its constant, and `threadLinkOf` is null-guarded at every step
(`node` absent, no `getAttribute`, no `parentNode`). If Torn ever wraps the
panel so clicks stop bubbling to it, the visible failure is that the panel
simply does not hide: the link still navigates and **Hide** still works. That
is the safe direction, and a QA line walks it.

## Interfaces

```js
// Engine (pure; between normaliseSettings and freshOrganizer).
//
// isPlainActivation(click) -> boolean
//   click: a plain object { button, ctrlKey, metaKey, shiftKey, altKey,
//   defaultPrevented } copied off the event by the runtime. Total: anything
//   that is not a plain object is false. button absent counts as 0.
//
// autoHideSettings(settings) -> settings
//   When settings.autoHideOnOpen === true, a copy with collapsed: true and
//   takeover: false. Otherwise the SAME object, untouched, so the caller can
//   test identity to know nothing changed. Never mutates its argument.

// Runtime (panel section, next to threadUrl).
var THREAD_LINK_ATTR = 'data-tfcc-thread';
var THREAD_LINK_MAX_DEPTH = 4;
// threadLinkAttr(id) -> ' data-tfcc-thread="<escaped id>"'
// threadLinkOf(node, panel) -> element | null

// makeHandlers(...) gains:
// handlers.onThreadLink(link, click) -> void
```

Rendered markup gains ` data-tfcc-thread="<id>"` on every thread anchor:

```html
<a href="https://www.torn.com/forums.php#/p=threads&amp;f=61&amp;t=5&amp;b=0&amp;a=0" data-tfcc-thread="5">Title</a>
```

`onThreadLink` is not an `act === '...'` case, so `tests/handlers.test.js`'s
rendered-equals-handled scan is unaffected by it. The new checkbox is
`data-act="auto-hide"` with an `onChange` case `act === 'auto-hide'`, which
that scan does see and pair.

## Settings text

Label: **Hide the panel when I open a thread**

Note under it:

> Only thread links in this panel do this, and only a plain click. Opening a
> link in a new tab, or following links on the Torn page itself, leaves the
> panel as it is. Press Show to bring it back.

ASCII only, and worded so that no apostrophe is needed in the source string.

The view model's `settings` block (`buildPanelModel`) gains
`autoHideOnOpen: s.autoHideOnOpen`, since the Settings view reads
`model.settings`, not `state.settings`.

## Sibling plans

- **#2, My posts (PR #5).** My posts rows render through `renderRow`, so they
  carry `data-tfcc-thread` with no extra work and honour this setting. The
  guard is structural: `tests/auto-hide.test.js` renders **every** entry of
  `VIEWS` and asserts that every `forums.php#/p=threads` anchor carries
  `data-tfcc-thread`. If #2 lands second it gets this for free; if #2 lands
  first, adding `mine` to `VIEWS` puts My posts under the same test. If #2 ever
  renders a thread anchor outside `renderRow`, that test fails until the anchor
  is marked. #2 also adds `forums.php#/p=threads&f=0&t=<id>` links for threads
  with no known forum; those are thread links and are covered the same way.
- **#3, Rows shown (PR #6).** No functional interaction. Its `rows-toggle` is a
  `data-act` button, not a link; its in-memory `state.showAll` is untouched by a
  collapse. Both PRs add a control to the Appearance section and a field to
  `settingsDefaults`/`normaliseSettings`; whichever lands second resolves the
  adjacent-line conflict by keeping both. **#3's `rowsShown` hits the upgrade
  trap too.** If this PR lands first, `isRecoveredValue` covers `rowsShown`
  with no further work. If #3 lands first without a fix, its release would
  show the false "Settings were damaged" notice; this PR then fixes it.
- **#4, Only flag author updates (PR #7).** No functional interaction. Same
  adjacent-line conflict in the settings normaliser (#4's control is under
  Refreshing, so the view itself does not collide). `settings.authorOnly` is
  top-level and covered by `isRecoveredValue`. **#4's seven new per-thread
  fields in `organizer.threads[id]` are nested and are not covered**: an
  upgraded organizer would report "Folders and tags were damaged". #4 needs its
  own nested fill, or a recursive version of this helper; that is #4's
  decision, flagged here so it is not missed.
- **All three and this one** add an entry under `## [Unreleased]` in
  `CHANGELOG.md`. The conflict there is textual; keep every entry.

## Version

The feature PR adds only a CHANGELOG entry under `## [Unreleased]`. It never
touches `@version`, `SCRIPT_VERSION` or `package.json`. One separate release
commit on `main` later bumps all three, renames the `[Unreleased]` heading to
the version and date, and is tagged (CLAUDE.md rule 8). This is the shared
convention of #2, #3, #4 and #8.

## Security and constraints

- **Engine purity (constraint 5).** `isPlainActivation` and `autoHideSettings`
  are pure: no DOM, no event object (the runtime copies six scalars out), no
  clock, no storage. They live inside the engine markers, so
  `tests/purity.test.js` covers them unchanged.
- **ASCII only (constraint 4).** Label and note are plain ASCII.
- **Request budget (constraint 7).** No request. The Settings budget text does
  not change.
- **`@match`, `@grant`, `@connect` (constraint 9).** Unchanged.
- **API key (constraint 6).** Not touched.
- **Read-only.** No navigation initiated by the script, no `.click()`, no
  synthetic event, no new `.focus()`.

## Testing

New suite `tests/auto-hide.test.js`:

| Promise | Test |
|---|---|
| The setting defaults off, round-trips, survives a reload, and corrupt is off | storage section of the suite |
| A 0.1.0-shaped settings blob (no `autoHideOnOpen`) loads with `recovered: false` and no damage notice; a present-but-invalid field still reports | storage section of the suite |
| `isPlainActivation` is true for a plain click and Enter, false for each modifier, middle button, prevented, and non-objects | engine |
| `autoHideSettings` returns the same object when off, a collapsed, non-takeover copy when on, and never mutates | engine |
| With it on, a plain click on a panel thread link writes `collapsed: true` to `tfcc:settings` **before any timer runs** | runtime |
| With it off, the same click changes nothing in state or storage | runtime |
| A modified click, a middle click and a prevented click change nothing | runtime |
| Takeover is cleared, and the panel loses `tfcc-takeover` | runtime |
| A click on a `data-act` button still dispatches as before, and a click on Search on Torn does not collapse | runtime |
| Clicking the thread you are already on collapses without a `hashchange` | runtime |
| A hash change into the thread after the click leaves the panel collapsed and does not rewrite it again | runtime |
| A reload after the click arrives collapsed | runtime |
| `threadLinkOf` stops at the panel and at the depth limit, and survives nodes with no `getAttribute` or `parentNode` | runtime |
| Every thread anchor in every view carries `data-tfcc-thread`; Search on Torn does not | markup |
| The checkbox renders checked or not, and its change handler persists | settings |

`tests/handlers.test.js` needs no change: it already pairs every rendered
`data-act` with a handler case, so it now also requires `auto-hide`.

Mutation-check entries (`tests/mutation-check.mjs`):

| Mutation | Suite that must fail |
|---|---|
| the setting is ignored, so every link click collapses | `tests/auto-hide.test.js` |
| a Ctrl-click (new tab) collapses the panel | `tests/auto-hide.test.js` |
| opening a thread leaves takeover covering it | `tests/auto-hide.test.js` |
| the collapse is persisted only after navigation (in the deferred timer) | `tests/auto-hide.test.js` |
| the normaliser accepts any truthy value | `tests/auto-hide.test.js` |
| a row link loses its thread marker | `tests/auto-hide.test.js` |
| the link walk escapes the panel | `tests/auto-hide.test.js` |
| an upgrade that adds a setting is reported as damage again | `tests/auto-hide.test.js` |

One existing entry must be re-aimed: "a thread title is written to the panel
without escaping" matches the exact `renderRow` anchor text that the marker
changes, so it would report `SKIP ... stale` until its `apply` string follows
the new text.

Run as `node tests/mutation-check.mjs > mutation.log 2>&1`, then read the log.
Never pipe it.

## QA checklist additions (`docs/qa-checklist.md`)

Under "Torn PDA" > "Layout", and mirrored in "Desktop regression":

- [ ] Settings, tick "Hide the panel when I open a thread". Tap a thread in
      Threads: the thread opens and the panel shows only its header with Show.
- [ ] Reload the thread page: the panel is still collapsed.
- [ ] Show brings the panel back and it stays open while you page through the
      thread and follow Torn's own links.
- [ ] In Expand (takeover), tap a thread in Catch up: takeover ends, the thread
      is readable, the panel is collapsed. Show returns the inline panel.
- [ ] Repeat from Search (a thread row and a post hit) and from Drafts.
- [ ] Search on Torn does not collapse the panel.
- [ ] Long-press a thread link (PDA) or Ctrl-click and middle-click it
      (desktop) and open it in a new tab: the panel in this tab stays open.
- [ ] Tap the thread you are already on: the panel collapses.
- [ ] Untick the setting: tapping a thread leaves the panel open.
- [ ] Keyboard only (desktop): Tab to a thread link and press Enter: the panel
      collapses and the thread opens.

## Assumptions

1. Torn's forum does not call `preventDefault` on a click inside our panel
   before our listener sees it, and does not stop it bubbling to the panel.
   If it does, the panel simply does not hide (safe direction); QA catches it.
2. A plain click on a same-document hash link navigates even though the panel
   is redrawn a tick later. The redraw is deferred precisely so the anchor is
   still attached during dispatch.
3. Torn PDA's webview delivers a tap as a `click` with `button === 0` and no
   modifiers, and a long-press as a context menu with no `click`.
4. Clearing takeover on auto-hide is what users want. A user who lives in
   takeover presses Expand after Show. If that proves annoying, see
   Follow-ups.
5a. `GM_setValue` is treated as written when it returns. Tampermonkey hands the write to its background page by message, so on a cross-document load (a thread link from `torn.com` without `www`) the write is best effort. Every link the panel renders is `www.torn.com` on a page that is already `forums.php`, so the normal case is a same-document hash change and the write has long finished.
5. Settings are shared across tabs through `tfcc:settings`, as today. A tab
   opened after an auto-hide also starts collapsed, exactly as after a manual
   Hide.
6. Forgiving an absent top-level field is not a weaker damage check in any case
   that matters: a corrupt store produces a wrong or unparseable value, not a
   cleanly missing key. A stored value of `{}` for settings now loads quietly
   as defaults instead of with a notice; that is the same outcome either way.
7. "Opening a thread" means a thread link. Forum and search links are not
   thread links, even when they land on a list of threads.

## Follow-ups (not in this PR)

- Manual **Hide** under takeover leaves a viewport-sized empty box. Rendering
  `tfcc-takeover` only when not collapsed would fix it and would let Show
  restore takeover. That changes the existing Hide button and gets its own
  issue.
- A second option, "also hide when I open a thread from Torn's own list",
  through `syncToRoute`, if users ask.

## Non-goals

- Auto-showing the panel on any route.
- Any change to the manual Hide, Show, Expand or Shrink buttons.
- Any request, endpoint or budget change.
