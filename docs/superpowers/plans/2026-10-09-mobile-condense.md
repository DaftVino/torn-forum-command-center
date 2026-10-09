# Condense the narrow mobile view (#33) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When the panel's own width is 600px or less, render a condensed, touch-first layout (one-line scaling icon header, a 3 x 2 nav grid with v1 tint numerals, a filter line with a Filters disclosure, title-first rows with a one-tap Read in Catch up and a per-row Actions drawer), put every standing explanation behind an info button at every size, and leave the wide (desktop) layout byte-identical to main.

**Architecture:** A `ResizeObserver` on the script's own `#tfcc-panel` (plus a per-render measurement of the same element) sets `state.narrow` with 16px of hysteresis. The renderers branch on `model.narrow`; wide output keeps today's functions and strings, and a golden captured from main proves it. All new maths and the transient-state machine are pure engine functions (`narrowFor`, `headerButtonSize`, `nextTransient`, `reconcileTransient`, `focusPlan`, `activeFilterCount`); the runtime only measures the panel's own nodes, applies results, restores focus and holds a redraw while a press is in progress.

**Tech Stack:** One ES5 userscript IIFE (`torn-forum-command-center.user.js`), Node `node:test` suites run through the `vm` harness in `tests/load-userscript.js`. No dependencies.

**Spec:** `docs/superpowers/specs/2026-10-09-mobile-condense-design.md`. Read it first, and read section 13 twice: where an earlier section and section 13 disagree, section 13 wins. Where this plan and the spec disagree, the spec wins and this plan is amended. The review it answers is `docs/records/review/2026-10-09-mobile-condense-codex.md`; the approved mockups are `docs/designs/mockups/33-mobile/revised-375.html` and `revised-320.html` (their inline `fitHeader` script is the reference algorithm for Task 3 and Task 9).

## Global Constraints

- **Never read `torn-forum-command-center.user.js` whole** (about 282 KB). For every symbol, run `grep -n "function <name>(" torn-forum-command-center.user.js` (the code map can be a commit stale), then `Read` with `offset`/`limit` around that line only. A session that opens the file wholesale has failed regardless of what it produced (CLAUDE.md constraint 1).
- The source is **ASCII only** (`tests/metadata.test.js`). Type every string by hand with straight quotes. Icons are inline ASCII SVG path data. No curly quotes, no ellipsis character, no multiplication sign, no emoji (the existing `THUMB_UP`/`THUMB_DOWN` escapes stay as they are).
- The engine section (between `// ---- ENGINE START` and `// ---- ENGINE END`) is pure (`tests/purity.test.js`): no DOM, no `state`, no `GM_*`, no `Date`, no timers. `narrowFor`, `headerButtonSize`, `headerLogoWidth`, `activeFilterCount`, `freshTransient`, `nextTransient`, `reconcileTransient`, `focusPlan` and their constants go inside it. Every measurement (`getBoundingClientRect`, `clientWidth`, `getComputedStyle`, `querySelector`) and every `state` access is runtime. Task 2 adds these names to the purity test's forbidden list.
- **No new requests, no new endpoints, no new Torn DOM access.** The `ResizeObserver` and `fitHeader` read only `#tfcc-panel` and nodes inside it (the owner's ADR 0001 ruling, spec section 5). DOM access to Torn's markup stays in exactly two places: the mount container and the reply textarea. Task 13 adds a test that records every `document.querySelector` call.
- **The request budget text stays true** (CLAUDE.md constraint 7): a default refresh is at most 13 requests and the limiter holds 40 a minute. The Settings view keeps a visible line computed from the constants and the user's own lookup setting (Task 8).
- **No version bump.** `@version`, `SCRIPT_VERSION` and `package.json` `version` are not touched; this PR adds an entry under `## [Unreleased]` in `CHANGELOG.md` only (Task 18). Constraint 8 is satisfied by the separate release commit.
- `@match`, `@grant` and `@connect` do not change.
- **Wide layout unchanged.** With `state.narrow === false`, every complete view (Threads, capped, collapsed, Catch up, My posts, Search, Drafts, Settings, loading, error), every nav and every row must stay byte-identical to main's golden, captured before any code change (`tests/wide-parity.test.js`, Task 1). The only wide changes allowed are the owner's section 13d items, each one literal replacement in `tests/wide-13d-diffs.js`. Every new stylesheet rule is scoped to `.tfcc-narrow`, apart from the listed 13d selectors.
- `node tests/mutation-check.mjs` edits the production file in place. **Never pipe it into `head`** or anything that closes the pipe early. Redirect to a file and read the file: `node tests/mutation-check.mjs > "$TMPDIR/mutation.txt" 2>&1; echo exit=$?` (use the session scratchpad if `$TMPDIR` is unset).
- Commit messages are Conventional Commits with **no** attribution, no `Co-Authored-By`, no generated-by footer, no session URL. Check the tail of every message.
- Every new `data-act` is a `<button>` (or the existing `select`/`input`) whose own element carries `data-act`; its children sit under the existing `#tfcc-panel button * { pointer-events: none; }`.
- Every DOM read in new runtime code is null-guarded and wrapped in `try/catch`, and a failure degrades to the wide layout (CLAUDE.md constraint 3).
- The runtime's selectors for focus and measurement use only this grammar: `#id`, `.class`, an optional tag or `.class` followed by `[attr="value"]` parts. The harness's `htmlQuery` (Task 2) implements exactly that grammar, so a runtime selector outside it fails its test.

## Review Focus

The riskiest promises, most likely to bite a real user first, each pinned to a named test in the task that owns the code:

1. **A TalkBack user marks the last row read in Catch up.** Focus must land on the previous row's Read, and with no rows left on the visible "Catch up" heading, never at the top of the page. Pinned by `narrow-focus.test.js`: "Read removes the last row: focus goes to the previous row's Read" and "Read removes the only row: focus goes to the view heading" (Task 13).
2. **An iOS user types a note in a drawer, then taps another row's Actions, a thread title, or holds a slow press.** iOS fires `change` and blur before the click, so the commit's redraw used to replace the node under the finger. The note must be saved and the tapped thing must happen: Actions opens in exactly one redraw, a thread link is never redrawn away inside its own click, and a press held past 300ms keeps its target. Pinned by `dirty-input.test.js`: "a tap on another control while a drawer input is dirty commits and acts, in one redraw", "a dirty field, then a plain thread-link tap: no redraw during the click, then one, with auto-hide" and "holding the pointer down past 300ms does not redraw; 300ms after it lifts with no click, it does" (Task 14).
3. **A refresh, filter, cap or archive removes the row whose drawer is open, and the row later returns.** It must come back closed. Pinned by `narrow-state.test.js`: "a stale open row is reconciled away and does not reopen when it returns" (Task 7) and the engine test "reconcileTransient clears an open row that is not rendered" (Task 4).
4. **A phone rotates across the breakpoint while a drawer input has focus, and a refresh lands before the field is left.** The class flips, the drawer and filters close, the markup update and the refresh's redraw both wait until focus leaves, and the typed value is committed on blur. Pinned by `narrow-runtime.test.js`: "crossing the breakpoint while typing defers the markup but closes the transients" (Task 6) and `dirty-input.test.js`: "typed, rotated across the breakpoint, refreshed, then blurred: the value persists" (Task 14).
5. **A very narrow panel or 200% text.** The header buttons never go under 24px and never wrap; 4-digit counts show as "999+" without wrapping the cell. Pinned by `narrow-engine.test.js`: "headerButtonSize never goes below the 24px floor and says when even that does not fit" (Task 3) and `narrow-view.test.js`: "a count over 999 shows as 999+" (Task 10).
6. **An old WebView without `ResizeObserver`.** The narrow layout must still apply, from the per-render measurement. Pinned by `narrow-runtime.test.js`: "without ResizeObserver the per-render measurement still picks the narrow layout" (Task 6).
7. **A forged or stale `data-info` / `data-id`.** An unknown info key changes nothing; Actions for an id no longer rendered is reconciled to closed on the next build. Pinned by `info.test.js`: "an unknown data-info changes nothing and does not throw" (Task 8) and `narrow-state.test.js`: "Actions for a row that is not rendered is reconciled closed" (Task 12).

---

## Files in scope

| File | Change |
|---|---|
| `torn-forum-command-center.user.js` | Engine: constants and the pure functions above. Runtime: `state` fields, `applyTransient`/`setView`, narrow detection (`measurePanelWidth`, `watchPanelWidth`, `onPanelWidth`, `setNarrow`), `fitHeader`, focus restoration, the live region, the press hold, `buildPanelModel`, `renderPanel`, `draw`, `makeHandlers`, every renderer named in the tasks, `panelStyleText` |
| `tests/load-userscript.js` | `EXPORT_NAMES`; opt-in harness options `panelWidth`, `panelPadding`, `measure`, `htmlQuery`, `resizeObserver`; `env.resize`, `env.focusLog`; `style.setProperty` |
| `tests/wide-seed.js` | **New.** The fixed workspace and capture used by the parity golden |
| `tests/make-wide-golden.mjs` | **New.** One-off generator, run once on main's code in Task 1 |
| `tests/fixtures/wide-golden.json` | **New.** Main's complete wide output: every view, loading and error |
| `tests/wide-13d-diffs.js` | **New.** The owner's 13d wide changes as literal replacements (filled in Task 8) |
| `tests/wide-parity.test.js` | **New.** Desktop stays byte-identical |
| `tests/narrow-helpers.js` | **New.** Shared boot/seed/query helpers for the narrow suites (not a `.test.js`, so `npm test` does not run it) |
| `tests/narrow-engine.test.js` | **New.** Pure maths, state machine, focus plan |
| `tests/narrow-runtime.test.js` | **New.** ResizeObserver, fallback, hysteresis wiring, `fitHeader` |
| `tests/narrow-state.test.js` | **New.** The spec section 6 transition table through real handlers |
| `tests/narrow-view.test.js` | **New.** Header, nav, filter line, rows, drawer markup |
| `tests/narrow-focus.test.js` | **New.** Focus restoration and the live region |
| `tests/dirty-input.test.js` | **New.** The press hold and `drawerEdit` |
| `tests/info.test.js` | **New.** Info buttons and the 13d audit |
| `tests/harness.test.js` | The new harness options |
| `tests/purity.test.js` | Forbidden names gain `ResizeObserver`, `getBoundingClientRect`, `getComputedStyle`, `querySelector` |
| `tests/handlers.test.js` | `renderedActions` renders every view narrow too |
| `tests/style.test.js` | Narrow rules, tokens, contrast, the moved media rules, the key note |
| `tests/panel.test.js` | The shortened Drafts line |
| `tests/auto-hide.test.js` | Read and Actions never collapse; auto-hide closes the transients |
| `tests/mutation-check.mjs` | 24 new entries |
| `tests/render-preview.mjs`, `tests/contrast-audit.mjs` | Narrow previews, header one-line check, v1 nav label check |
| `docs/architecture.md`, `docs/qa-checklist.md`, `CHANGELOG.md`, `docs/code-map.md` | Docs |

No other file is in scope without amending this plan.

---

### Task 1: Capture main's wide output as a golden, and guard it

This task changes **no** production code. It must run before any other task, on the branch's starting point (`origin/main`), because the golden is the record of what desktop looks like today.

**Files:**
- Create: `tests/wide-seed.js`, `tests/make-wide-golden.mjs`, `tests/fixtures/wide-golden.json`, `tests/wide-13d-diffs.js`, `tests/wide-parity.test.js`

**Interfaces:**
- Produces: `seedWide(api)`, `captureWide(loadUserscript, FORUMS_LOCATION)` returning `{ css: string[], views: { threads, threadsCapped, collapsed, catchup, mine, search, drafts, settings, loading, error }, nav: { [view]: string }, rows: { [view]: string[] } }`. Later tasks never edit the golden.

- [ ] **Step 1: Write the shared seed and capture**

Create `tests/wide-seed.js`:

```js
'use strict';

// One fixed workspace for the desktop parity check (#33). The generator that
// captured the golden from main and the test that compares against it both
// use this file, so the two can never seed differently.

const NOW = Date.UTC(2026, 7, 8, 12, 0, 0);
const MIN = 60000;

function seedWide(api) {
  api.state.feed.subscribed = [
    { id: 101, forum: 61, title: 'A practical education guide and script companion', unread: 3, total: 214, author: 'DaftVino' },
    { id: 102, forum: 63, title: 'Public API v2 project board', unread: 0, total: 88, author: 'Chedburn' },
    { id: 103, forum: 67, title: 'SideWinder - Advanced Sidebar for Torn City', unread: 12, total: 46, author: 'Sidewinder' },
    { id: 104, forum: 4, title: 'You can search forums by user AND text', unread: 1, total: 31, author: 'aplayer' },
  ].map((t) => api.normaliseSubscribedRow({
    id: t.id, forum_id: t.forum, title: t.title,
    author: { id: 1, username: t.author, karma: 10 },
    posts: { new: t.unread, total: t.total },
  }));
  api.state.feed.categories = [
    { id: 4, title: 'Suggestions', acronym: 'SU' },
    { id: 61, title: 'Tutorials and Guides', acronym: 'TG' },
    { id: 63, title: 'API Development', acronym: 'AD' },
    { id: 67, title: 'Tools and Userscripts', acronym: 'TU' },
  ];
  api.state.feed.fetchedAt = NOW - 4 * MIN;
  let org = api.state.organizer;
  org = api.togglePin(org, 101);
  org = api.setPriority(org, 103, 2);
  org = api.toggleTag(org, 101, 'reference');
  org = api.setFolder(org, 102, 'scripts');
  org.threads['101'].note = 'The one to link people to.';
  org.lastCatchUpAt = NOW - 24 * 60 * MIN;
  api.state.organizer = org;
  api.state.drafts = api.saveDraft(api.freshDrafts(), 101, 'A draft reply.', NOW - 30 * MIN,
    'A practical education guide and script companion');
  // My posts: one started thread with thumbs, so the reactions pill renders in
  // the wide nav (it needs a key, which captureWide provides).
  const mine = api.freshMine();
  mine.fetchedAt = NOW - 4 * MIN;
  mine.threads = [Object.assign(api.freshMineThread(16600002, NOW), {
    started: true, title: 'My crime 2.0 notes', forumId: 4, totalKnown: true,
    postsTotal: 5, baselineTotal: 5, lastPostAt: NOW - 300 * MIN, myLastPostAt: NOW - 300 * MIN,
    tornNew: 0, tornNewKnown: true,
  })];
  api.setReactionFields(mine.threads[0], { topicAt: NOW - 5 * MIN, up: 30, down: 4 });
  api.state.mine = api.setKarma(mine, 1208, NOW - 5 * MIN);
  api.state.settings.rowsShown = 0;
  api.state.settings.theme = 'dark';
  // The bootstrap's own refresh has no transport and may have failed in the
  // meantime; none of that belongs in a layout golden.
  api.state.refreshing = false;
  api.state.lastError = null;
  api.state.notices = [];
  api.recompute(NOW);
}

// Every complete wide view, plus the loading and error states. Drafts is
// captured on a thread page with no reply box, so its reply-box line renders.
function captureWide(loadUserscript, FORUMS_LOCATION) {
  const env = loadUserscript({
    location: FORUMS_LOCATION, now: NOW, gmStore: [['tfcc:key', 'abcdefghij123456']],
  });
  const api = env.exports;
  seedWide(api);
  const html = () => api.panelHtml(api.buildPanelModel(NOW));
  const out = { css: api.panelStyleText().split('\n'), views: {}, nav: {}, rows: {} };
  api.state.route = api.parseForumRoute({
    origin: 'https://www.torn.com', hostname: 'www.torn.com', pathname: '/forums.php', search: '',
    hash: '#/p=threads&f=61&t=101', href: 'https://www.torn.com/forums.php#/p=threads&f=61&t=101',
  });
  api.state.replyBoxFound = false;
  for (const view of ['threads', 'catchup', 'mine', 'search', 'drafts', 'settings']) {
    api.state.settings.view = view;
    out.views[view] = html();
  }
  api.state.settings.view = 'threads';
  api.state.settings.rowsShown = 3;
  out.views.threadsCapped = html();
  api.state.settings.rowsShown = 0;
  api.state.settings.collapsed = true;
  out.views.collapsed = html();
  api.state.settings.collapsed = false;
  out.views.loading = api.panelHtml(api.loadingModel(NOW));
  out.views.error = api.panelHtml(api.errorModel('x', 'Torn is unreachable.', NOW));
  for (const view of api.VIEWS) {
    api.state.settings.view = view;
    const model = api.buildPanelModel(NOW);
    out.nav[view] = api.renderNav(model);
    const list = view === 'catchup' ? model.catchUp : (view === 'mine' ? model.capped.mine.rows : model.rows);
    out.rows[view] = list.map((r) => api.renderRow(r, model));
  }
  api.state.settings.view = 'threads';
  return out;
}

module.exports = { NOW, seedWide, captureWide };
```

- [ ] **Step 2: Write the generator**

Create `tests/make-wide-golden.mjs`:

```js
/*
 * Captures the wide (desktop) panel output as a golden - run by hand, once,
 * on main's code. tests/wide-parity.test.js compares every later build with it.
 *
 *   node tests/make-wide-golden.mjs
 *
 * It refuses to overwrite an existing golden. A parity failure means the code
 * changed desktop, not that the golden is stale: regenerating would hide
 * exactly the regression the test exists to catch. --force is for an
 * owner-approved desktop change, and that change says so in its PR.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { loadUserscript, FORUMS_LOCATION } = require('./load-userscript.js');
const { captureWide } = require('./wide-seed.js');

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(here, 'fixtures', 'wide-golden.json');
if (fs.existsSync(out) && !process.argv.includes('--force')) {
  console.error('tests/fixtures/wide-golden.json exists. Refusing to overwrite it.');
  process.exit(1);
}
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify(captureWide(loadUserscript, FORUMS_LOCATION), null, 1) + '\n');
console.log('wrote ' + out);
```

- [ ] **Step 3: Capture the golden on main's code**

> Amended during implementation: the generator escapes non-ASCII characters (the pill's thumb emoji) as `\uXXXX`, so the golden stays ASCII; `JSON.parse` reads back identical strings.

Run: `git diff --quiet origin/main -- torn-forum-command-center.user.js && node tests/make-wide-golden.mjs`
Expected: `wrote .../tests/fixtures/wide-golden.json`. If the `git diff` guard fails, stop: the golden must come from main's code.

- [ ] **Step 4: Write the parity test**

Create `tests/wide-parity.test.js`:

```js
'use strict';

// Desktop does not change (#33, spec section 7). The golden was captured from
// main before any #33 code landed; see tests/make-wide-golden.mjs.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { loadUserscript, FORUMS_LOCATION } = require('./load-userscript');
const { captureWide } = require('./wide-seed');

const golden = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'wide-golden.json'), 'utf8'));

// The panel-internal rules that left `@media (max-width: 600px)` for
// `#tfcc-panel.tfcc-narrow` (spec section 5). Only these may disappear.
const MOVED_OUT_OF_MEDIA = new Set([
  '  #tfcc-panel { padding: 8px; }',
  '  #tfcc-panel .tfcc-kv label { min-width: 0; flex-basis: 100%; }',
  '  #tfcc-panel .tfcc-grow { flex-basis: 100%; }',
  '  #tfcc-panel .tfcc-row { padding: var(--tfcc-gap-xs) var(--tfcc-gap-sm); }',
  '  #tfcc-panel .tfcc-actions { gap: 3px; }',
  '  #tfcc-panel .tfcc-actions button { padding: 1px 5px; }',
  '  #tfcc-panel .tfcc-actions input, #tfcc-panel .tfcc-actions select {',
  '    padding: 1px 4px; font-size: var(--tfcc-text-sm); max-width: 46%; }',
  '  #tfcc-panel .tfcc-meta { gap: var(--tfcc-gap-sm); }',
]);

// The owner's section 13d changes are the only wide markup changes allowed.
// Each is one literal replacement, written in the commit that makes it
// (tests/wide-13d-diffs.js); every `from` must occur exactly once in main's
// golden, so a stale or widened entry fails here rather than hiding a change.
const D13 = require('./wide-13d-diffs');

function expectedView(view) {
  let html = golden.views[view];
  for (const d of D13.filter((x) => x.view === view)) {
    const n = html.split(d.from).length - 1;
    assert.strictEqual(n, 1, '13d item ' + d.item + ': its "from" occurs ' + n + ' times in main\'s ' + view);
    html = html.replace(d.from, () => d.to);
  }
  return html;
}

test('every complete wide view is main\'s, byte for byte, apart from the listed 13d items', () => {
  const now = captureWide(loadUserscript, FORUMS_LOCATION);
  const views = ['threads', 'threadsCapped', 'collapsed', 'catchup', 'mine', 'search', 'drafts', 'settings', 'loading', 'error'];
  assert.deepStrictEqual(Object.keys(golden.views).sort(), views.slice().sort(), 'the golden holds every view');
  for (const view of views) assert.strictEqual(now.views[view], expectedView(view), view);
});

test('the 13d list touches only the views the owner changed', () => {
  for (const d of D13) assert.ok(['catchup', 'mine', 'search', 'drafts', 'settings'].includes(d.view), d.item);
});

test('every wide nav and every wide row is byte-identical to main', () => {
  const now = captureWide(loadUserscript, FORUMS_LOCATION);
  assert.deepStrictEqual(Object.keys(now.nav).sort(), Object.keys(golden.nav).sort());
  for (const view of Object.keys(golden.nav)) {
    assert.strictEqual(now.nav[view], golden.nav[view], 'nav in ' + view);
    assert.deepStrictEqual(now.rows[view], golden.rows[view], 'rows in ' + view);
  }
});

test('no stylesheet line from main was removed or edited, apart from the rules that moved to .tfcc-narrow', () => {
  // A subsequence check: every old line still appears, in order. New lines
  // may be inserted anywhere; an edited line shows up as a missing one.
  const now = captureWide(loadUserscript, FORUMS_LOCATION).css;
  let at = 0;
  const missing = [];
  for (const line of golden.css) {
    if (MOVED_OUT_OF_MEDIA.has(line)) continue;
    const found = now.indexOf(line, at);
    if (found === -1) missing.push(line); else at = found + 1;
  }
  assert.deepStrictEqual(missing, [], 'wide CSS lines removed, edited or reordered');
});

// The only new rules a wide panel may see: the 13d info button, its text, the
// glyph it draws and the hidden attribute (spec 13d, every size). Everything
// else #33 adds hangs off .tfcc-narrow.
const WIDE_13D_SELECTORS = new Set([
  '#tfcc-panel [hidden]',
  '#tfcc-panel .tfcc-gl',
  '#tfcc-panel .tfcc-gl path',
  '#tfcc-panel .tfcc-infobar',
  '#tfcc-panel .tfcc-infobar h4',
  '#tfcc-panel button.tfcc-info',
  '#tfcc-panel button.tfcc-info[aria-expanded="true"]',
  '#tfcc-panel .tfcc-infotext',
]);

test('every new stylesheet rule is scoped to .tfcc-narrow or is a listed 13d rule', () => {
  const old = new Set(golden.css);
  const stray = captureWide(loadUserscript, FORUMS_LOCATION).css
    .filter((line) => !old.has(line) && line.indexOf('{') !== -1)
    .map((line) => line.slice(0, line.indexOf('{')).trim())
    .filter((sel) => sel.indexOf('.tfcc-narrow') === -1 && !WIDE_13D_SELECTORS.has(sel));
  assert.deepStrictEqual(stray, [], 'a new rule a wide panel would see');
});
```

Create `tests/wide-13d-diffs.js`, empty until Task 8 adds the owner's changes in the commit that makes them:

```js
'use strict';

// The owner-approved wide markup changes of spec section 13d, one literal
// replacement per audited item, applied to main's golden by
// tests/wide-parity.test.js. Task 8 fills this in.
module.exports = [];
```

- [ ] **Step 5: Run it**

Run: `node --test tests/wide-parity.test.js`
Expected: PASS (it compares main with itself). This is the baseline every later task must keep green.

- [ ] **Step 6: Commit**

```bash
git add tests/wide-seed.js tests/make-wide-golden.mjs tests/fixtures/wide-golden.json tests/wide-13d-diffs.js tests/wide-parity.test.js
git commit -m "test: capture main's wide panel as a parity golden before #33"
```

---

### Task 2: Harness options for width, measurement, queries and ResizeObserver

**Files:**
- Modify: `tests/load-userscript.js` (`makeSandbox`, `makeElement`, `windowStub.getComputedStyle`, the returned `env`)
- Modify: `tests/purity.test.js` (the `forbidden` list)
- Test: `tests/harness.test.js`

**Interfaces:**
- Produces, all opt-in (defaults unchanged, so every existing suite behaves as before):
  - `options.panelWidth` (number, default 0): `#tfcc-panel`'s `getBoundingClientRect().width`; its `clientWidth` is `panelWidth - 2` (a 1px border each side).
  - `options.panelPadding` (number): `getComputedStyle(panel).paddingLeft/Right` as `'Npx'`.
  - `options.htmlQuery` (boolean): every element's `querySelector`/`querySelectorAll` parses its own `innerHTML` with the selector grammar in Global Constraints and returns memoised stub nodes. A stub has `tagName`, `getAttribute`, `classList`, `focus()`, `setSelectionRange()`, `getBoundingClientRect()`.
  - `options.measure(stub)` returns a stub's width (default 0).
  - `options.resizeObserver`: `true` installs a fake `ResizeObserver`; `'no-box'` omits `borderBoxSize` from entries; `'throws'` makes the constructor throw.
  - `env.resize(width)` sets `panelWidth` and fires every connected fake observer. `env.resizeObservers` lists them. `env.focusLog` collects `{ ...attrs }` of every stub focused; a focus also sets `doc.activeElement` to the stub.
  - `env.queryLog`: every selector passed to `document.querySelector`/`querySelectorAll`, recorded from the moment the sandbox exists, so the script's bootstrap is recorded too (the ADR 0001 gate in Task 13).
  - Every element's `style` gains `setProperty`, `removeProperty`, `getPropertyValue`.

- [ ] **Step 1: Write the failing harness tests**

Append to `tests/harness.test.js`:

```js
// ---- #33 options -------------------------------------------------------------

test('panelWidth sizes only the panel, with a 1px border each side', () => {
  const env = loadUserscript({ panelWidth: 343 });
  const panel = env.makeElement('div');
  panel.setAttribute('id', 'tfcc-panel');
  assert.strictEqual(panel.getBoundingClientRect().width, 343);
  assert.strictEqual(panel.clientWidth, 341);
  const other = env.makeElement('div');
  assert.strictEqual(other.getBoundingClientRect().width, 0);
});

test('htmlQuery answers the runtime selector grammar from innerHTML, and only that', () => {
  const focusEnv = loadUserscript({ htmlQuery: true, measure: (n) => (n.classList.contains('wide') ? 72 : 10) });
  const el = focusEnv.makeElement('div');
  el.innerHTML = '<div><button type="button" data-act="read" data-id="2" class="tfcc-read wide">x</button>'
    + '<h3 id="tfcc-vh" tabindex="-1">Catch up</h3><button data-act="read" data-id="3"></button></div>';
  const read = el.querySelector('[data-act="read"][data-id="2"]');
  assert.ok(read);
  assert.strictEqual(read.getAttribute('data-id'), '2');
  assert.strictEqual(read.getBoundingClientRect().width, 72);
  assert.strictEqual(el.querySelector('.tfcc-read'), read, 'memoised per node');
  assert.strictEqual(el.querySelector('button.tfcc-read'), read);
  assert.ok(el.querySelector('#tfcc-vh'));
  assert.strictEqual(el.querySelectorAll('[data-act="read"]').length, 2);
  assert.strictEqual(el.querySelector('div > button'), null, 'outside the grammar');
  read.focus();
  assert.strictEqual(focusEnv.focusLog[0]['data-id'], '2');
  assert.strictEqual(focusEnv.doc.activeElement, read);
  el.innerHTML = '<p></p>';
  assert.strictEqual(el.querySelector('[data-act="read"][data-id="2"]'), null, 'a rewrite drops old nodes');
});

test('the fake ResizeObserver reports the border box, and env.resize fires it', () => {
  const env = loadUserscript({ resizeObserver: true });
  const seen = [];
  const ro = new env.sandbox.ResizeObserver((entries) => seen.push(entries[0].borderBoxSize[0].inlineSize));
  const target = env.makeElement('div');
  target.setAttribute('id', 'tfcc-panel');
  ro.observe(target);
  env.resize(500);
  assert.deepStrictEqual(seen, [500]);
  assert.strictEqual(target.getBoundingClientRect().width, 500);
  ro.disconnect();
  env.resize(700);
  assert.deepStrictEqual(seen, [500], 'a disconnected observer is silent');
});

test('queryLog records document queries from before the script runs', () => {
  const env = loadUserscript({ location: { pathname: '/forums.php', hostname: 'www.torn.com', href: 'https://www.torn.com/forums.php', hash: '', search: '', origin: 'https://www.torn.com' } });
  assert.ok(env.queryLog.length > 0, 'the bootstrap\'s mount search is in the log');
  assert.ok(env.queryLog.includes(env.exports.MOUNT_SELECTORS[0]));
});

test('style.setProperty and getComputedStyle padding are available', () => {
  const env = loadUserscript({ panelPadding: 8 });
  const panel = env.makeElement('div');
  panel.setAttribute('id', 'tfcc-panel');
  panel.style.setProperty('--tfcc-hb', '41.5px');
  assert.strictEqual(panel.style.getPropertyValue('--tfcc-hb'), '41.5px');
  panel.style.removeProperty('--tfcc-hb');
  assert.strictEqual(panel.style.getPropertyValue('--tfcc-hb'), '');
  assert.strictEqual(env.win.getComputedStyle(panel).paddingLeft, '8px');
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `node --test tests/harness.test.js`
Expected: FAIL (`getBoundingClientRect is not a function`, `ResizeObserver` undefined, and so on).

- [ ] **Step 3: Implement the options in `tests/load-userscript.js`**

In `makeSandbox`, after `const observers = [];`, add:

```js
  // #33 options. All opt-in; the defaults leave every existing suite alone.
  let panelWidth = typeof options.panelWidth === 'number' ? options.panelWidth : 0;
  const focusLog = [];
  const resizeObservers = [];

  // The selector grammar the runtime promises for focus and measurement:
  // '#id', or an optional tag, then .class parts, then [attr="value"] parts.
  // Anything else answers null, so a runtime that strays fails its test.
  function parseSelector(sel) {
    const s = String(sel || '');
    if (/^#[A-Za-z0-9_-]+$/.test(s)) return { tag: null, classes: [], attrs: [['id', s.slice(1)]] };
    const m = /^([a-z][a-z0-9]*)?((?:\.[A-Za-z0-9_-]+)*)((?:\[[a-z-]+="[^"]*"\])*)$/.exec(s);
    if (!s || !m) return null;
    const attrs = [];
    const re = /\[([a-z-]+)="([^"]*)"\]/g;
    let a;
    while ((a = re.exec(m[3] || ''))) attrs.push([a[1], a[2]]);
    return { tag: m[1] || null, classes: (m[2] || '').split('.').filter(Boolean), attrs };
  }

  function makeStub(tag, attrs) {
    const classes = new Set(String(attrs.class || '').split(/\s+/).filter(Boolean));
    const stub = {
      tagName: tag.toUpperCase(),
      attributes: attrs,
      parentNode: null,
      getAttribute(k) { return Object.prototype.hasOwnProperty.call(attrs, k) ? attrs[k] : null; },
      classList: {
        add(c) { classes.add(c); }, remove(c) { classes.delete(c); },
        contains(c) { return classes.has(c); },
        toggle(c, on) { if (on === undefined ? !classes.has(c) : on) classes.add(c); else classes.delete(c); },
      },
      focus() { focusLog.push(Object.assign({}, attrs)); documentStub.activeElement = stub; },
      setSelectionRange(a, b) { stub.selection = [a, b]; },
      getBoundingClientRect() { return { width: options.measure ? options.measure(stub) : 0, height: 0 }; },
    };
    return stub;
  }

  function queryIn(el, sel, all) {
    const p = parseSelector(sel);
    if (!p) return all ? [] : null;
    if (!el._q || el._q.html !== el._innerHTML) el._q = { html: el._innerHTML, nodes: new Map() };
    const out = [];
    const tagRe = /<([a-zA-Z][a-zA-Z0-9]*)\b([^>]*)>/g;
    let m;
    let index = 0;
    while ((m = tagRe.exec(el._innerHTML))) {
      const idx = index;
      index += 1;
      const tag = m[1].toLowerCase();
      const attrs = {};
      const attrRe = /\s([a-zA-Z_:][-a-zA-Z0-9_:.]*)(?:="([^"]*)")?/g;
      let a;
      while ((a = attrRe.exec(m[2]))) attrs[a[1]] = a[2] === undefined ? '' : a[2];
      if (p.tag && p.tag !== tag) continue;
      const cls = String(attrs.class || '').split(/\s+/);
      if (!p.classes.every((c) => cls.includes(c))) continue;
      if (!p.attrs.every(([k, v]) => attrs[k] === v)) continue;
      let node = el._q.nodes.get(idx);
      if (!node) { node = makeStub(tag, attrs); el._q.nodes.set(idx, node); }
      if (!all) return node;
      out.push(node);
    }
    return all ? out : null;
  }
```

`makeStub` refers to `documentStub`, which is declared later in the same function; that is fine because `focus()` only runs after the sandbox is built.

In `makeElement`, replace

```js
      style: {},
```

with

```js
      style: {
        setProperty(k, v) { this[k] = String(v); },
        removeProperty(k) { delete this[k]; },
        getPropertyValue(k) { return Object.prototype.hasOwnProperty.call(this, k) ? this[k] : ''; },
      },
```

and replace

```js
      querySelector() { return null; },
      querySelectorAll() { return []; },
```

with

```js
      querySelector(sel) { return options.htmlQuery ? queryIn(this, sel, false) : null; },
      querySelectorAll(sel) { return options.htmlQuery ? queryIn(this, sel, true) : []; },
      getBoundingClientRect() { return { width: this.id === 'tfcc-panel' ? panelWidth : 0, height: 0 }; },
      get clientWidth() { return this.id === 'tfcc-panel' && panelWidth > 2 ? panelWidth - 2 : 0; },
```

In `documentStub`, replace its `querySelector(sel) {` and `querySelectorAll(sel) {` first lines so each records the selector before answering:

```js
    querySelector(sel) {
      queryLog.push(String(sel));
```

```js
    querySelectorAll(sel) {
      queryLog.push(String(sel));
```

and declare `const queryLog = [];` next to `const focusLog = [];`. The log is always on; it costs nothing and needs no option, so the bootstrap's queries are never missed.

In `windowStub.getComputedStyle`, before the final `return`, add:

```js
      if (el && el.id === 'tfcc-panel' && typeof options.panelPadding === 'number') {
        const p = options.panelPadding + 'px';
        return { getPropertyValue: () => '', backgroundColor: '', paddingLeft: p, paddingRight: p };
      }
```

After `sandbox.self = sandbox;`, add:

```js
  if (options.resizeObserver) {
    const mode = options.resizeObserver;
    sandbox.ResizeObserver = class FakeResizeObserver {
      constructor(cb) {
        if (mode === 'throws') throw new Error('ResizeObserver unavailable');
        this.cb = cb; this.target = null; this.disconnected = false;
        resizeObservers.push(this);
      }
      observe(target) { this.target = target; this.disconnected = false; }
      disconnect() { this.disconnected = true; }
    };
  }
  function resize(width) {
    panelWidth = width;
    for (const ro of resizeObservers.slice()) {
      if (ro.disconnected || !ro.target) continue;
      const entry = { target: ro.target, contentRect: { width: Math.max(0, width - 2) } };
      if (options.resizeObserver !== 'no-box') entry.borderBoxSize = [{ inlineSize: width, blockSize: 0 }];
      ro.cb([entry], ro);
    }
  }
```

In the returned object, add `resize, resizeObservers, focusLog, queryLog,` next to `runTimers, advanceTimersBy,`.

- [ ] **Step 4: Add the purity names**

In `tests/purity.test.js`, inside `forbidden`, after the `MutationObserver` line, add:

```js
    [/\bResizeObserver\b/, 'ResizeObserver'],
    [/\bgetBoundingClientRect\b/, 'getBoundingClientRect'],
    [/\bgetComputedStyle\b/, 'getComputedStyle'],
    [/\bquerySelector(All)?\b/, 'querySelector'],
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `node --test tests/harness.test.js tests/purity.test.js`
Expected: PASS. If purity now fails on an existing engine line, stop and report it: that would be a pre-existing impurity, not something to paper over.

- [ ] **Step 6: Run the full suite**

Run: `npm test && npm run test:syntax`
Expected: PASS. Defaults are unchanged.

- [ ] **Step 7: Commit**

```bash
git add tests/load-userscript.js tests/harness.test.js tests/purity.test.js
git commit -m "test: harness options for panel width, queries and ResizeObserver (#33)"
```

---

### Task 3: Engine - the breakpoint and the header maths

**Files:**
- Modify: `torn-forum-command-center.user.js`: constants after `var VIEW_LABELS = Object.freeze({...});` (about line 181); functions after `function capRows(` (about line 1819)
- Modify: `tests/load-userscript.js` (`EXPORT_NAMES`)
- Create: `tests/narrow-engine.test.js`

**Interfaces:**
- Produces: constants `NARROW_ENTER_PX = 600`, `NARROW_LEAVE_PX = 616`, `HB_MAX = 44`, `HB_MIN = 24`, `HB_STEP = 0.5`, `HB_COMPACT_BELOW = 36`, `HB_GAPS = 20`, `LOGO_ASPECT = 106 / 45`, `LOGO_PER_HB = 0.545`, `LOGO_MIN_PX = 16`, `LOGO_MAX_PX = 24`; `narrowFor(width, wasNarrow) -> boolean`; `headerLogoWidth(size) -> number`; `headerButtonSize(content, chipW, showW, icons) -> { size: number, fits: boolean }`; `activeFilterCount(settings) -> number`.

- [ ] **Step 1: Export the names**

In `tests/load-userscript.js`, after the line `'ROWS_SHOWN_OPTIONS', 'CAPPED_VIEWS', 'UNCAPPED_VIEWS', 'VIEW_LABELS', 'capRows', 'renderCapLine',` add:

```js
  // #33: narrow layout
  'NARROW_ENTER_PX', 'NARROW_LEAVE_PX', 'HB_MAX', 'HB_MIN', 'HB_STEP', 'HB_COMPACT_BELOW', 'HB_GAPS',
  'LOGO_ASPECT', 'LOGO_PER_HB', 'LOGO_MIN_PX', 'LOGO_MAX_PX',
  'narrowFor', 'headerLogoWidth', 'headerButtonSize', 'activeFilterCount',
```

- [ ] **Step 2: Write the failing tests**

Create `tests/narrow-engine.test.js`:

```js
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { loadUserscript } = require('./load-userscript');

const { exports: api } = loadUserscript();

// ---- the breakpoint (spec section 5) --------------------------------------

test('narrowFor enters at 600px or less and leaves only above 616px', () => {
  const cases = [
    // [width, wasNarrow, expected]
    [600, false, true], [601, false, false], [320, false, true],
    [610, true, true], [616, true, true], [617, true, false],
    [617, false, false], [1100, true, false],
  ];
  for (const [w, was, want] of cases) {
    assert.strictEqual(api.narrowFor(w, was), want, w + 'px from ' + (was ? 'narrow' : 'wide'));
  }
});

test('narrowFor keeps the current layout when the width is unknown', () => {
  // A harness, a detached panel or a failed measurement reads 0. Flipping on
  // that would make every unmeasurable panel narrow.
  for (const w of [0, -5, NaN, undefined, null, '500', Infinity * 0]) {
    assert.strictEqual(api.narrowFor(w, false), false, String(w) + ' from wide');
    assert.strictEqual(api.narrowFor(w, true), true, String(w) + ' from narrow');
  }
});

// ---- the header maths (spec section 13b) -----------------------------------
// C is the panel's content width: the panel minus 2 x 8px padding and 2 x 1px
// border. The chip measures 72px normal and 58px compact on the mockups.

test('headerButtonSize matches the spec widths', () => {
  const cases = [
    // [C, chip, show, icons, size]   viewport
    [325, 72, 0, 3, 44],    // 375: the ceiling
    [270, 72, 0, 3, 41.5],  // 320: the 0.5px step lands on 41.5 (the spec's "about 41")
    [230, 72, 0, 3, 32],    // 280 with the normal chip: under 36, so the runtime goes compact
    [230, 58, 0, 3, 35],    // 280 with the compact chip
    [188, 58, 0, 3, 24],    // the floor still fits at C = 188
    [270, 86, 0, 3, 38],    // 320 at 200% text: the chip widens to 86px
    [270, 58, 65, 2, 38.5], // one solve with a fixed 65px Show; fitHeader re-measures Show, giving 37 (narrow-runtime)
  ];
  for (const [c, chip, show, icons, size] of cases) {
    const r = api.headerButtonSize(c, chip, show, icons);
    assert.strictEqual(r.size, size, 'C=' + c + ' chip=' + chip + ' show=' + show);
    assert.strictEqual(r.fits, true);
  }
});

test('headerButtonSize never goes below the 24px floor and says when even that does not fit', () => {
  const r = api.headerButtonSize(187, 58, 0, 3);
  assert.deepStrictEqual(r, { size: 24, fits: false });
  assert.deepStrictEqual(api.headerButtonSize(40, 58, 0, 3), { size: 24, fits: false });
  assert.deepStrictEqual(api.headerButtonSize(NaN, 58, 0, 3), { size: 24, fits: false });
});

test('headerButtonSize never exceeds the 44px ceiling', () => {
  assert.deepStrictEqual(api.headerButtonSize(2000, 0, 0, 3), { size: 44, fits: true });
});

test('headerButtonSize returns the largest half-pixel size that keeps the header on one line', () => {
  // The one-line promise as an invariant: the chosen size fits, and the next
  // step up does not, for every content width from 150 to 400px.
  const need = (s, chip, show, n) => api.headerLogoWidth(s) + chip + n * s + show + api.HB_GAPS;
  for (const [chip, show, n] of [[72, 0, 3], [58, 0, 3], [58, 65, 2]]) {
    for (let c = 150; c <= 400; c += 1) {
      const r = api.headerButtonSize(c, chip, show, n);
      assert.ok(r.size >= api.HB_MIN && r.size <= api.HB_MAX, 'bounds at C=' + c);
      if (r.fits) {
        assert.ok(need(r.size, chip, show, n) <= c, 'one line at C=' + c);
        if (r.size < api.HB_MAX) assert.ok(need(r.size + api.HB_STEP, chip, show, n) > c, 'largest at C=' + c);
      } else {
        assert.ok(need(api.HB_MIN, chip, show, n) > c, 'fits:false only when 24px does not fit, C=' + c);
      }
    }
  }
});

test('the logo follows the button size between 16 and 24px tall', () => {
  // Within floating-point rounding: the code multiplies by the 106 / 45 ratio.
  const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, a + ' vs ' + b);
  near(api.headerLogoWidth(50), 24 * 106 / 45); // the 24px cap (0.545 x 44 is 23.98, just under it)
  near(api.headerLogoWidth(44), 0.545 * 44 * 106 / 45);
  near(api.headerLogoWidth(24), 16 * 106 / 45);
  near(api.headerLogoWidth(36), 0.545 * 36 * 106 / 45);
});

test('the gap constant is the sum the stylesheet promises', () => {
  // logo-chip 6 + group 6 + 2 x 4 between buttons. tests/style.test.js checks
  // the narrow header CSS uses exactly these gaps.
  assert.strictEqual(api.HB_GAPS, 6 + 6 + 2 * 4);
});

// ---- the Filters button count (spec section 4.3) ---------------------------

test('activeFilterCount counts the folder and tag filters only', () => {
  assert.strictEqual(api.activeFilterCount({}), 0);
  assert.strictEqual(api.activeFilterCount({ folderFilter: 'guides' }), 1);
  assert.strictEqual(api.activeFilterCount({ folderFilter: 'guides', tagFilter: 'x' }), 2);
  assert.strictEqual(api.activeFilterCount({ sort: 'title', unreadOnly: true }), 0, 'sort and Unread are not filters behind the button');
  assert.strictEqual(api.activeFilterCount(null), 0);
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `node --test tests/narrow-engine.test.js`
Expected: FAIL: `api.narrowFor is not a function`.

> Amended during implementation: the logo-width test compares within 1e-9 (floating point) and checks the 24px cap at a 50px size, because 0.545 x 44 = 23.98 sits just under the cap.

- [ ] **Step 4: Add the constants**

Immediately after the `var VIEW_LABELS = Object.freeze({ ... });` block, add:

```js
  // Narrow layout (#33). The panel's own border-box width decides it, with 16px
  // of hysteresis so a scrollbar appearing cannot flap the layout (spec 5).
  var NARROW_ENTER_PX = 600;
  var NARROW_LEAVE_PX = 616;
  // Narrow header buttons scale between these, in half-pixel steps, so the
  // header stays on one line (spec 13b). HB_GAPS is the fixed gaps: logo-chip 6,
  // group 6, and 2 x 4 between the buttons. The narrow header CSS uses exactly
  // these gaps; tests/style.test.js holds the two together.
  var HB_MAX = 44;
  var HB_MIN = 24;
  var HB_STEP = 0.5;
  var HB_COMPACT_BELOW = 36;
  var HB_GAPS = 20;
  // The logo's viewBox is 106 x 45; its height follows the button size between
  // 16 and 24px.
  var LOGO_ASPECT = 106 / 45;
  var LOGO_PER_HB = 0.545;
  var LOGO_MIN_PX = 16;
  var LOGO_MAX_PX = 24;
```

- [ ] **Step 5: Add the functions**

After the closing `}` of `function capRows(`, add:

```js
  // True when the panel should use the narrow layout. An unknown width (0,
  // NaN, a failed measurement) keeps whatever layout is current.
  function narrowFor(width, wasNarrow) {
    var was = wasNarrow === true;
    if (typeof width !== 'number' || !(width > 0)) return was;
    if (width <= NARROW_ENTER_PX) return true;
    if (width > NARROW_LEAVE_PX) return false;
    return was;
  }

  function headerLogoWidth(size) {
    return Math.min(LOGO_MAX_PX, Math.max(LOGO_MIN_PX, LOGO_PER_HB * size)) * LOGO_ASPECT;
  }

  // The largest header button size in [HB_MIN, HB_MAX], in HB_STEP steps, that
  // keeps logo, chip, buttons and the Show label on one line of `content`
  // pixels. fits is false only when even HB_MIN does not fit; the runtime then
  // lets the logo-and-chip group wrap, never the buttons (spec 13b, last resort).
  function headerButtonSize(content, chipW, showW, icons) {
    var c = typeof content === 'number' && isFinite(content) ? content : 0;
    var chip = typeof chipW === 'number' && chipW > 0 ? chipW : 0;
    var show = typeof showW === 'number' && showW > 0 ? showW : 0;
    var n = icons === 2 ? 2 : 3;
    for (var s = HB_MAX; s >= HB_MIN; s -= HB_STEP) {
      if (headerLogoWidth(s) + chip + n * s + show + HB_GAPS <= c) return { size: s, fits: true };
    }
    return { size: HB_MIN, fits: false };
  }

  // The number the narrow Filters button shows: the filters it hides. Sort is
  // an order and Unread has its own visible toggle, so neither counts.
  function activeFilterCount(settings) {
    var s = isPlainObject(settings) ? settings : {};
    return (s.folderFilter ? 1 : 0) + (s.tagFilter ? 1 : 0);
  }
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `node --test tests/narrow-engine.test.js tests/purity.test.js`
Expected: PASS.

- [ ] **Step 7: Full suite and commit**

Run: `npm test && npm run test:syntax`
Expected: PASS.

```bash
git add torn-forum-command-center.user.js tests/load-userscript.js tests/narrow-engine.test.js
git commit -m "feat: pure narrow breakpoint and header-size maths (#33)"
```

---

### Task 4: Engine - the transient state machine

**Files:**
- Modify: `torn-forum-command-center.user.js`: constants after the Task 3 constants; functions after `function activeFilterCount(`
- Modify: `tests/load-userscript.js` (`EXPORT_NAMES`)
- Test: `tests/narrow-engine.test.js`

**Interfaces:**
- Produces: `INFO_KEYS` (frozen `{ key: accessibleName }`), `INFO_KEYS_BY_VIEW` (frozen `{ view: string[] }`), `TRANSIENT_RESET_EVENTS`; `freshTransient() -> { openRowId: null, filtersOpen: false, openInfoId: null, drawerEdit: null }`; `nextTransient(t, ev) -> transient` where `ev.type` is one of `'row-more'` (with `id`), `'filters'`, `'info'` (with `key`), `'view'`, `'collapse'`, `'auto-hide'`, `'breakpoint'`, or anything else (identity); `reconcileTransient(t, renderedIds, infoKeys) -> transient`. `drawerEdit` is `{ id, field, value, selStart, selEnd }` or null.

- [ ] **Step 1: Export the names**

Append to the `// #33: narrow layout` block in `EXPORT_NAMES`:

```js
  'INFO_KEYS', 'INFO_KEYS_BY_VIEW', 'TRANSIENT_RESET_EVENTS', 'freshTransient', 'nextTransient', 'reconcileTransient',
```

- [ ] **Step 2: Write the failing tests**

Append to `tests/narrow-engine.test.js`:

```js
// ---- the transient state machine (spec section 6) -------------------------

const OPEN = { openRowId: 'A', filtersOpen: true, openInfoId: 'catchup', drawerEdit: { id: 'A', field: 'note-input', value: 'x', selStart: 1, selEnd: 1 } };

test('Actions on row A opens A, and again closes it', () => {
  const a = api.nextTransient(api.freshTransient(), { type: 'row-more', id: 'A' });
  assert.strictEqual(a.openRowId, 'A');
  const closed = api.nextTransient(a, { type: 'row-more', id: 'A' });
  assert.strictEqual(closed.openRowId, null);
});

test('Actions on row B while A is open opens B and keeps A\'s uncommitted edit', () => {
  const b = api.nextTransient(OPEN, { type: 'row-more', id: 'B' });
  assert.strictEqual(b.openRowId, 'B');
  assert.deepStrictEqual(b.drawerEdit, OPEN.drawerEdit, 'the mirror lives until its field commits');
  assert.strictEqual(b.filtersOpen, true, 'filters are unchanged');
  assert.strictEqual(b.openInfoId, 'catchup', 'info is unchanged by row actions');
});

test('Filters toggles and touches nothing else', () => {
  const t = api.nextTransient(OPEN, { type: 'filters' });
  assert.strictEqual(t.filtersOpen, false);
  assert.strictEqual(t.openRowId, 'A');
});

test('an info button toggles its own key, one open at a time', () => {
  const t = api.nextTransient(api.freshTransient(), { type: 'info', key: 'catchup' });
  assert.strictEqual(t.openInfoId, 'catchup');
  assert.strictEqual(api.nextTransient(t, { type: 'info', key: 'catchup' }).openInfoId, null);
  assert.strictEqual(api.nextTransient(t, { type: 'info', key: 'settings-budget' }).openInfoId, 'settings-budget');
  assert.strictEqual(api.nextTransient(t, { type: 'info', key: 'not-a-key' }).openInfoId, 'catchup', 'an unknown key changes nothing');
});

test('a view change, Hide, auto-hide and the breakpoint close every disclosure but keep an uncommitted edit', () => {
  // The mirror is the only copy of what was typed until the field commits on
  // blur; a rotation or a redraw in between must not lose it (plan review).
  for (const type of ['view', 'collapse', 'auto-hide', 'breakpoint']) {
    assert.deepStrictEqual(api.nextTransient(OPEN, { type }),
      { openRowId: null, filtersOpen: false, openInfoId: null, drawerEdit: OPEN.drawerEdit }, type);
  }
  assert.deepStrictEqual(api.nextTransient(api.freshTransient(), { type: 'view' }), api.freshTransient());
});

test('Show, refresh, filter, cap and row actions leave the transients alone', () => {
  for (const type of ['show', 'refresh', 'filter', 'cap', 'pin', 'prio', 'read', 'archive', 'route', undefined]) {
    assert.deepStrictEqual(api.nextTransient(OPEN, { type }), OPEN, String(type));
  }
  assert.deepStrictEqual(api.nextTransient(OPEN, null), OPEN);
});

test('nextTransient normalises a damaged input', () => {
  assert.deepStrictEqual(api.nextTransient(null, null), api.freshTransient());
  assert.deepStrictEqual(api.nextTransient({ openRowId: 5, filtersOpen: 'yes', openInfoId: {}, drawerEdit: 'x' }, null),
    api.freshTransient());
});

test('reconcileTransient clears an open row that is not rendered', () => {
  const t = api.reconcileTransient(OPEN, ['B', 'C'], ['catchup']);
  assert.strictEqual(t.openRowId, null);
  assert.deepStrictEqual(t.drawerEdit, OPEN.drawerEdit, 'an uncommitted edit outlives its drawer');
  assert.strictEqual(t.openInfoId, 'catchup');
  assert.strictEqual(t.filtersOpen, true);
});

test('reconcileTransient keeps an open row that is still rendered', () => {
  assert.deepStrictEqual(api.reconcileTransient(OPEN, ['A', 'B'], ['catchup']), OPEN);
});

test('reconcileTransient clears an info key the view does not render', () => {
  assert.strictEqual(api.reconcileTransient(OPEN, ['A'], []).openInfoId, null);
  assert.strictEqual(api.reconcileTransient(OPEN, ['A'], api.INFO_KEYS_BY_VIEW.settings).openInfoId, null);
});

test('every view has an info key list, and every listed key has a name', () => {
  for (const v of api.VIEWS) {
    assert.ok(Array.isArray(api.INFO_KEYS_BY_VIEW[v]), v);
    for (const k of api.INFO_KEYS_BY_VIEW[v]) assert.match(api.INFO_KEYS[k], /^About /, k);
  }
  const listed = [].concat(...api.VIEWS.map((v) => api.INFO_KEYS_BY_VIEW[v]));
  assert.deepStrictEqual(listed.slice().sort(), Object.keys(api.INFO_KEYS).sort(), 'no key is orphaned or listed twice');
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `node --test tests/narrow-engine.test.js`
Expected: FAIL: `api.nextTransient is not a function`.

- [ ] **Step 4: Add the constants**

After the Task 3 constants, add:

```js
  // Info buttons (#33, spec 13d): key -> the button's accessible name. The
  // explanation text always stays in the markup; only its hidden attribute
  // follows state.openInfoId.
  var INFO_KEYS = Object.freeze({
    catchup: 'About Catch up',
    mine: 'About My posts',
    search: 'About Search',
    'settings-budget': 'About the request budget',
    'settings-author': 'About author-only mode',
    'settings-rows': 'About Rows shown',
    'settings-autohide': 'About hiding the panel',
    'settings-folders': 'About folders',
    'settings-badges': 'About badges',
  });
  var INFO_KEYS_BY_VIEW = Object.freeze({
    threads: Object.freeze([]),
    catchup: Object.freeze(['catchup']),
    search: Object.freeze(['search']),
    drafts: Object.freeze([]),
    settings: Object.freeze(['settings-budget', 'settings-author', 'settings-rows', 'settings-autohide',
      'settings-folders', 'settings-badges']),
    mine: Object.freeze(['mine']),
  });
  // The events that close every disclosure (spec section 6 table).
  var TRANSIENT_RESET_EVENTS = Object.freeze(['view', 'collapse', 'auto-hide', 'breakpoint']);
```

- [ ] **Step 5: Add the functions**

After `function activeFilterCount(`'s closing `}`, add:

```js
  // The panel's transient view state (#33, spec section 6). Never persisted.
  function freshTransient() {
    return { openRowId: null, filtersOpen: false, openInfoId: null, drawerEdit: null };
  }

  // One transition of spec section 6's table. Row actions, refresh, filters and
  // the cap are identity here: reconcileTransient handles a row they remove.
  function nextTransient(t, ev) {
    var cur = isPlainObject(t) ? t : {};
    var out = {
      openRowId: typeof cur.openRowId === 'string' && cur.openRowId ? cur.openRowId : null,
      filtersOpen: cur.filtersOpen === true,
      openInfoId: typeof cur.openInfoId === 'string' && cur.openInfoId ? cur.openInfoId : null,
      drawerEdit: isPlainObject(cur.drawerEdit) ? cur.drawerEdit : null,
    };
    var type = isPlainObject(ev) ? ev.type : null;
    // drawerEdit survives every transition: it is the only copy of what was
    // typed until the field commits, and only that commit clears it.
    if (TRANSIENT_RESET_EVENTS.indexOf(type) !== -1) {
      return { openRowId: null, filtersOpen: false, openInfoId: null, drawerEdit: out.drawerEdit };
    }
    if (type === 'row-more' && typeof ev.id === 'string' && ev.id) {
      out.openRowId = out.openRowId === ev.id ? null : ev.id;
      return out;
    }
    if (type === 'filters') { out.filtersOpen = !out.filtersOpen; return out; }
    if (type === 'info' && Object.prototype.hasOwnProperty.call(INFO_KEYS, ev.key)) {
      out.openInfoId = out.openInfoId === ev.key ? null : ev.key;
      return out;
    }
    return out;
  }

  // After every model build: an open row that is not rendered (refreshed,
  // filtered, capped or archived away) closes, so it cannot reopen by itself
  // when it returns; an info key the view does not render closes too. An
  // uncommitted edit is kept (see nextTransient).
  function reconcileTransient(t, renderedIds, infoKeys) {
    var out = nextTransient(t, null);
    var ids = Array.isArray(renderedIds) ? renderedIds : [];
    var keys = Array.isArray(infoKeys) ? infoKeys : [];
    if (out.openRowId !== null && ids.indexOf(out.openRowId) === -1) out.openRowId = null;
    if (out.openInfoId !== null && keys.indexOf(out.openInfoId) === -1) out.openInfoId = null;
    return out;
  }
```

- [ ] **Step 6: Run, full suite, commit**

Run: `node --test tests/narrow-engine.test.js tests/purity.test.js && npm test && npm run test:syntax`
Expected: PASS.

```bash
git add torn-forum-command-center.user.js tests/load-userscript.js tests/narrow-engine.test.js
git commit -m "feat: pure transient state machine for drawers, filters and info (#33)"
```

---

### Task 5: Engine - the focus plan

**Files:**
- Modify: `torn-forum-command-center.user.js`: constant `VIEW_HEADING_ID` after `TRANSIENT_RESET_EVENTS`; functions after `function reconcileTransient(`
- Modify: `tests/load-userscript.js` (`EXPORT_NAMES`)
- Test: `tests/narrow-engine.test.js`

**Interfaces:**
- Produces: `VIEW_HEADING_ID = 'tfcc-vh'`; `focusPlan(target, ctx) -> string[]`, where `target = { act, id, view, info }` (strings or null) and `ctx = { ids: string[] (rendered rows, DOM order, captured BEFORE the action), view, narrow }`. The list is: the same control, then the next row's equivalent, then the previous row's, then the fallback (`#tfcc-vh` narrow; the pressed nav cell wide). The equivalent is `read` in narrow Catch up, `row-more` elsewhere narrow, and the same `act` wide.

- [ ] **Step 1: Export**

Append `'VIEW_HEADING_ID', 'focusPlan',` to the `// #33` block in `EXPORT_NAMES`.

- [ ] **Step 2: Write the failing tests**

Append to `tests/narrow-engine.test.js`:

```js
// ---- the focus plan (spec section 6, focus rules) --------------------------

const IDS = ['1', '2', '3'];
const NARROW_CATCHUP = { ids: IDS, view: 'catchup', narrow: true };

test('Read removes the first row: same control, then the next row\'s Read, then the heading', () => {
  assert.deepStrictEqual(api.focusPlan({ act: 'read', id: '1' }, NARROW_CATCHUP), [
    '[data-act="read"][data-id="1"]', '[data-act="read"][data-id="2"]', '#tfcc-vh',
  ]);
});

test('Read removes a middle row: next row first, then the previous row', () => {
  assert.deepStrictEqual(api.focusPlan({ act: 'read', id: '2' }, NARROW_CATCHUP), [
    '[data-act="read"][data-id="2"]', '[data-act="read"][data-id="3"]', '[data-act="read"][data-id="1"]', '#tfcc-vh',
  ]);
});

test('Read removes the last row: the previous row, then the heading', () => {
  assert.deepStrictEqual(api.focusPlan({ act: 'read', id: '3' }, NARROW_CATCHUP), [
    '[data-act="read"][data-id="3"]', '[data-act="read"][data-id="2"]', '#tfcc-vh',
  ]);
});

test('Read removes the only row: the heading', () => {
  assert.deepStrictEqual(api.focusPlan({ act: 'read', id: '9' }, { ids: ['9'], view: 'catchup', narrow: true }), [
    '[data-act="read"][data-id="9"]', '#tfcc-vh',
  ]);
});

test('Archive from a Threads drawer falls back to the neighbours\' Actions', () => {
  assert.deepStrictEqual(api.focusPlan({ act: 'archive', id: '2' }, { ids: IDS, view: 'threads', narrow: true }), [
    '[data-act="archive"][data-id="2"]', '[data-act="row-more"][data-id="3"]', '[data-act="row-more"][data-id="1"]', '#tfcc-vh',
  ]);
});

test('wide falls back to the same control on the neighbour, then the pressed nav cell', () => {
  assert.deepStrictEqual(api.focusPlan({ act: 'read', id: '1' }, { ids: IDS, view: 'catchup', narrow: false }), [
    '[data-act="read"][data-id="1"]', '[data-act="read"][data-id="2"]', '[data-act="view"][aria-pressed="true"]',
  ]);
});

test('view, info and collapse controls name themselves exactly', () => {
  assert.deepStrictEqual(api.focusPlan({ act: 'view', view: 'drafts' }, { ids: [], view: 'drafts', narrow: true }),
    ['[data-act="view"][data-view="drafts"]', '#tfcc-vh']);
  assert.deepStrictEqual(api.focusPlan({ act: 'info', info: 'catchup' }, NARROW_CATCHUP),
    ['[data-act="info"][data-info="catchup"]', '#tfcc-vh']);
  assert.deepStrictEqual(api.focusPlan({ act: 'collapse' }, NARROW_CATCHUP), ['[data-act="collapse"]', '#tfcc-vh']);
});

test('a hostile attribute value cannot break out of the selector', () => {
  // Quotes and backslashes are dropped, so the value stays inside its own
  // attribute and cannot open a second selector.
  const plan = api.focusPlan({ act: 'read', id: '1"] , #x[a="\\' }, NARROW_CATCHUP);
  assert.strictEqual(plan[0], '[data-act="read"][data-id="1] , #x[a="]');
  assert.strictEqual(plan.length, 2, 'an id not in the list adds no neighbours');
});

test('an empty target still ends at the fallback', () => {
  assert.deepStrictEqual(api.focusPlan(null, null), ['[data-act="view"][aria-pressed="true"]']);
});
```

- [ ] **Step 3: Run to verify failure**

Run: `node --test tests/narrow-engine.test.js`
Expected: FAIL: `api.focusPlan is not a function`.

- [ ] **Step 4: Implement**

After `TRANSIENT_RESET_EVENTS`, add:

```js
  // The narrow view heading: the focus fallback when a row and both its
  // neighbours are gone (spec section 6, focus rule 3).
  var VIEW_HEADING_ID = 'tfcc-vh';
```

After `function reconcileTransient(`'s closing `}`, add:

```js
  // An attribute-equals selector part. Quotes and backslashes are dropped, not
  // escaped: ids and keys are this script's own tokens and never contain them,
  // so a value that does is forged and must not shape the selector.
  function attrSel(name, value) {
    return '[' + name + '="' + String(value).replace(/["\\]/g, '') + '"]';
  }

  // Where focus goes after a redraw (spec section 6, focus rules). ctx.ids are
  // the rows rendered before the action, in DOM order, so the successor is
  // known even when the action removes the row.
  function focusPlan(target, ctx) {
    var t = isPlainObject(target) ? target : {};
    var c = isPlainObject(ctx) ? ctx : {};
    var ids = Array.isArray(c.ids) ? c.ids : [];
    var narrow = c.narrow === true;
    var out = [];
    if (typeof t.act === 'string' && t.act) {
      var same = attrSel('data-act', t.act);
      if (t.id) same += attrSel('data-id', t.id);
      if (t.view) same += attrSel('data-view', t.view);
      if (t.info) same += attrSel('data-info', t.info);
      out.push(same);
      if (t.id) {
        var at = ids.indexOf(String(t.id));
        var equiv = narrow ? (c.view === 'catchup' ? 'read' : 'row-more') : t.act;
        if (at !== -1) {
          if (at + 1 < ids.length) out.push(attrSel('data-act', equiv) + attrSel('data-id', ids[at + 1]));
          if (at > 0) out.push(attrSel('data-act', equiv) + attrSel('data-id', ids[at - 1]));
        }
      }
    }
    out.push(narrow ? '#' + VIEW_HEADING_ID : attrSel('data-act', 'view') + attrSel('aria-pressed', 'true'));
    return out;
  }
```

- [ ] **Step 5: Run, full suite, commit**

Run: `node --test tests/narrow-engine.test.js tests/purity.test.js && npm test && npm run test:syntax`
Expected: PASS.

```bash
git add torn-forum-command-center.user.js tests/load-userscript.js tests/narrow-engine.test.js
git commit -m "feat: pure focus plan with next, previous and heading fallbacks (#33)"
```

---

### Task 6: Runtime - detect narrow from the panel's own width

**Files:**
- Modify: `torn-forum-command-center.user.js`: `var state = {` (about line 3212); new runtime helpers after `function invalidateInFlight(`; `function loadingModel(`, `function errorModel(`, `function buildPanelModel(`; new helpers before `function renderPanel(`; `function renderPanel(`
- Modify: `tests/load-userscript.js` (`EXPORT_NAMES`)
- Create: `tests/narrow-helpers.js`, `tests/narrow-runtime.test.js`

**Interfaces:**
- Consumes: `narrowFor`, `nextTransient`, `freshTransient`.
- Produces: `state.narrow`, `state.openRowId`, `state.filtersOpen`, `state.openInfoId`, `state.drawerEdit`, `state.focusIntent`, `state.pressActive`, `state.liveMessage` (all runtime only, never persisted); `NARROW_CLASS = 'tfcc-narrow'`; `currentTransient()`, `setTransient(t)`, `applyTransient(ev)`; `measurePanelWidth(panel) -> number`; `setNarrow(next)`; `watchPanelWidth(doc, win, panel, handlers) -> boolean`; `onPanelWidth(doc, win, panel, handlers, width)`; `model.narrow`.

- [ ] **Step 1: Export**

Append to the `// #33` block in `EXPORT_NAMES`:

```js
  'NARROW_CLASS', 'applyTransient', 'measurePanelWidth', 'setNarrow', 'watchPanelWidth', 'onPanelWidth',
```

- [ ] **Step 2: Create the shared narrow helpers**

Create `tests/narrow-helpers.js`:

```js
'use strict';

// Shared by the #33 suites. Not a .test.js file, so npm test does not run it.

const assert = require('node:assert');
const { loadUserscript, FORUMS_LOCATION } = require('./load-userscript');

const NOW = 1700000000000;

// Boots the runtime on forums.php. width is the panel's border-box width: 343
// is a 375px phone in a 16px gutter, 288 is 320px, 248 is 280px, 900 is wide.
function bootNarrow(opts = {}) {
  const env = loadUserscript(Object.assign({
    location: Object.assign({}, FORUMS_LOCATION, opts.hash ? { hash: opts.hash } : {}),
    now: NOW,
    panelWidth: opts.width === undefined ? 343 : opts.width,
    panelPadding: 8,
    htmlQuery: true,
  }, opts.env || {}));
  return { env, api: env.exports };
}

// rows: [{ id, title, unread }]. Ids become strings in the merged rows.
function seedRows(api, rows) {
  api.state.feed.subscribed = rows.map((r) => api.normaliseSubscribedRow({
    id: r.id, forum_id: 61, title: r.title || ('Thread ' + r.id),
    author: { id: 3, username: 'someone', karma: 1 },
    posts: { new: r.unread || 0, total: 10 },
  }));
  api.state.feed.categories = [{ id: 61, title: 'Tutorials and Guides', acronym: 'TG' }];
  api.state.settings.rowsShown = 0;
  api.recompute(NOW);
}

function panelOf(env) { return env.doc.getElementById('tfcc-panel'); }

function redraw(env) {
  env.exports.draw(env.doc, env.win, env.exports.makeHandlers(env.doc, env.win), true);
  return panelOf(env).innerHTML;
}

// What a sighted user sees: drop every closed explanation, every closed drawer
// and the closed filter grid.
function visible(html) {
  return html
    .replace(/<p class="tfcc-note tfcc-infotext" id="[^"]*" hidden>[\s\S]*?<\/p>/g, '')
    .replace(/<div class="tfcc-filtergrid" id="tfcc-filters" hidden>[\s\S]*?<\/div>/g, '')
    .replace(/<span class="tfcc-sr">[\s\S]*?<\/span>/g, '')
    .replace(/<h3 class="tfcc-vh tfcc-sr"[\s\S]*?<\/h3>/g, '');
}

// A real tap: the delegated listener on the panel receives the event.
function click(env, sel) {
  const panel = panelOf(env);
  const t = panel.querySelector(sel);
  assert.ok(t, 'nothing rendered for ' + sel);
  panel.dispatchEvent({ type: 'click', target: t, button: 0 });
  return t;
}

function lastFocus(env) {
  return env.focusLog.length ? env.focusLog[env.focusLog.length - 1] : null;
}

module.exports = { NOW, bootNarrow, seedRows, panelOf, redraw, visible, click, lastFocus };
```

- [ ] **Step 3: Write the failing tests**

Create `tests/narrow-runtime.test.js`:

```js
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { NOW, bootNarrow, seedRows, panelOf, redraw } = require('./narrow-helpers');

test('an unmeasured panel stays wide, which is every existing suite', () => {
  const { env, api } = bootNarrow({ width: 0 });
  assert.strictEqual(api.state.narrow, false);
  assert.strictEqual(panelOf(env).classList.contains('tfcc-narrow'), false);
  assert.strictEqual(api.buildPanelModel(NOW).narrow, false);
});

test('without ResizeObserver the per-render measurement still picks the narrow layout', () => {
  const { env, api } = bootNarrow({ width: 343 });
  assert.strictEqual(api.state.narrow, true);
  assert.strictEqual(panelOf(env).classList.contains('tfcc-narrow'), true);
  assert.strictEqual(api.buildPanelModel(NOW).narrow, true);
});

test('a wide panel is not narrow, and the class is absent', () => {
  const { env, api } = bootNarrow({ width: 900 });
  assert.strictEqual(api.state.narrow, false);
  assert.strictEqual(panelOf(env).classList.contains('tfcc-narrow'), false);
});

test('the ResizeObserver watches only the panel, once, across many draws', () => {
  const { env } = bootNarrow({ width: 900, env: { resizeObserver: true } });
  for (let i = 0; i < 5; i += 1) redraw(env);
  const live = env.resizeObservers.filter((ro) => !ro.disconnected);
  assert.strictEqual(live.length, 1);
  assert.strictEqual(live[0].target, panelOf(env), 'it observes the script\'s own #tfcc-panel and nothing of Torn\'s');
});

test('crossing into narrow flips the class, and hysteresis holds between 600 and 616', () => {
  const { env, api } = bootNarrow({ width: 900, env: { resizeObserver: true } });
  const panel = panelOf(env);
  let before = panel.renderCount;
  env.resize(500);
  assert.strictEqual(api.state.narrow, true);
  assert.strictEqual(panel.classList.contains('tfcc-narrow'), true);

  before = panel.renderCount;
  for (const w of [610, 616, 600, 616, 500]) env.resize(w);
  assert.strictEqual(api.state.narrow, true, 'still narrow inside the band');

  env.resize(617);
  assert.strictEqual(api.state.narrow, false);
  assert.strictEqual(panel.classList.contains('tfcc-narrow'), false);
});

test('crossing the breakpoint closes the drawer, the filters and the info', () => {
  const { env, api } = bootNarrow({ width: 900, env: { resizeObserver: true } });
  seedRows(api, [{ id: 1, unread: 1 }]);
  redraw(env);
  api.state.openRowId = '1';
  api.state.filtersOpen = true;
  api.state.openInfoId = 'catchup';
  env.resize(400);
  assert.strictEqual(api.state.openRowId, null);
  assert.strictEqual(api.state.filtersOpen, false);
  assert.strictEqual(api.state.openInfoId, null);
});

test('crossing the breakpoint while typing defers the markup but closes the transients', () => {
  const { env, api } = bootNarrow({ width: 900, env: { resizeObserver: true } });
  const panel = panelOf(env);
  const input = env.makeElement('input');
  input.setAttribute('data-act', 'note-input');
  env.doc.activeElement = input;
  panel.contains = () => true;
  api.state.filtersOpen = true;
  const before = panel.renderCount;
  env.resize(400);
  assert.strictEqual(panel.classList.contains('tfcc-narrow'), true, 'the class flips at once');
  assert.strictEqual(api.state.filtersOpen, false);
});

test('an entry without borderBoxSize falls back to the panel\'s own rect', () => {
  const { env, api } = bootNarrow({ width: 900, env: { resizeObserver: 'no-box' } });
  env.resize(500);
  assert.strictEqual(api.state.narrow, true);
});

test('a ResizeObserver that throws leaves the panel working', () => {
  const { env, api } = bootNarrow({ width: 343, env: { resizeObserver: 'throws' } });
  assert.strictEqual(api.state.narrow, true, 'the per-render measurement still applies');
  assert.ok(panelOf(env).innerHTML.length > 0);
});

test('measurePanelWidth survives a panel without a rect', () => {
  const { api } = bootNarrow({ width: 0 });
  assert.strictEqual(api.measurePanelWidth(null), 0);
  assert.strictEqual(api.measurePanelWidth({ getBoundingClientRect() { throw new Error('detached'); } }), 0);
  assert.strictEqual(api.measurePanelWidth({}), 0);
});
```

- [ ] **Step 4: Run to verify failure**

Run: `node --test tests/narrow-runtime.test.js`
Expected: FAIL: `state.narrow` is undefined and no class is set.

> Amended during implementation: until Task 9 the narrow and wide markup are identical, so renderPanel skips the rewrite and a crossing cannot be seen in `renderCount` or `pendingRedraw`. Those assertions moved to Task 9 ("a crossing redraws once; inside the band nothing redraws; while typing it defers").

- [ ] **Step 5: Add the state fields**

In `var state = {`, after `showAll: {},` add:

```js
    // #33, all runtime only and reset on reload, like showAll. narrow follows
    // the panel's own width. The next four are spec section 6's transient
    // state; focusIntent carries a user action's focus plan into its redraw;
    // pressActive holds a redraw while a press that began in the panel is in
    // progress; liveMessage is the polite announcement after Read or Archive.
    narrow: false,
    openRowId: null,
    filtersOpen: false,
    openInfoId: null,
    drawerEdit: null,
    focusIntent: null,
    pressActive: false,
    liveMessage: null,
```

- [ ] **Step 6: Add the transient helpers**

After `function invalidateInFlight(`'s closing `}`, add:

```js
  function currentTransient() {
    return { openRowId: state.openRowId, filtersOpen: state.filtersOpen,
      openInfoId: state.openInfoId, drawerEdit: state.drawerEdit };
  }
  function setTransient(t) {
    state.openRowId = t.openRowId;
    state.filtersOpen = t.filtersOpen;
    state.openInfoId = t.openInfoId;
    state.drawerEdit = t.drawerEdit;
  }
  function applyTransient(ev) { setTransient(nextTransient(currentTransient(), ev)); }
```

- [ ] **Step 7: Add `narrow` to every model**

In `loadingModel(now)` and `errorModel(reason, detail, now)`, after `takeover: false,` add `narrow: state.narrow === true,`. In `buildPanelModel(now)`'s returned object, after `takeover: s.takeover,` add `narrow: state.narrow === true,`.

- [ ] **Step 8: Add the width helpers**

Immediately before `function renderPanel(`, add:

```js
  // #33: the class the narrow stylesheet hangs off. On our own element only.
  var NARROW_CLASS = 'tfcc-narrow';

  // The panel's border-box width, or 0 when it cannot be read. Reads only this
  // script's #tfcc-panel (the owner's ADR 0001 ruling, spec section 5).
  function measurePanelWidth(panel) {
    try {
      var r = panel && typeof panel.getBoundingClientRect === 'function' ? panel.getBoundingClientRect() : null;
      return r && typeof r.width === 'number' ? r.width : 0;
    } catch (e) {
      return 0;
    }
  }

  // Crossing the breakpoint closes every disclosure (spec section 6). The
  // class itself is written by renderPanel, so it survives a panel rebuilt
  // from scratch.
  function setNarrow(next) {
    state.narrow = next === true;
    applyTransient({ type: 'breakpoint' });
  }

  // Called by the ResizeObserver. A change of layout redraws, but not forced:
  // a caret in the panel still defers the markup (renderPanel's guard). The
  // class flips at once because renderPanel always writes it.
  function onPanelWidth(doc, win, panel, handlers, width) {
    var next = narrowFor(width, state.narrow);
    if (next === state.narrow) return;
    setNarrow(next);
    if (panel && panel.classList) panel.classList.toggle(NARROW_CLASS, state.narrow);
    draw(doc, win, handlers);
  }

  var resizeWatch = null;

  // One observer, on the panel this script created, set up beside the
  // delegated listener. Without ResizeObserver (Chrome < 64, iOS < 13.4) the
  // per-render measurement in renderPanel is the whole mechanism.
  function watchPanelWidth(doc, win, panel, handlers) {
    if (resizeWatch && resizeWatch.panel === panel) return true;
    if (resizeWatch) {
      try { resizeWatch.ro.disconnect(); } catch (e) { /* already gone */ }
      resizeWatch = null;
    }
    if (typeof ResizeObserver !== 'function') return false;
    try {
      var ro = new ResizeObserver(function (entries) {
        try {
          var entry = entries && entries[0];
          var box = entry && entry.borderBoxSize;
          box = box && (box[0] || box);
          var width = box && typeof box.inlineSize === 'number' ? box.inlineSize : measurePanelWidth(panel);
          onPanelWidth(doc, win, panel, handlers, width);
        } catch (e2) { /* a resize must never throw onto the page */ }
      });
      ro.observe(panel);
      resizeWatch = { panel: panel, ro: ro };
      return true;
    } catch (e3) {
      return false;
    }
  }
```

- [ ] **Step 9: Measure and write the class in `renderPanel`**

In `renderPanel(doc, win, model, handlers, force)`, replace

```js
    applyThemeClass(doc, win);
    panel.classList.toggle('tfcc-takeover', !!model.takeover);

    var html = panelHtml(model);
```

with

```js
    applyThemeClass(doc, win);
    panel.classList.toggle('tfcc-takeover', !!model.takeover);

    // #33: measured on every render, so the first paint is already right and a
    // WebView without ResizeObserver still condenses. Our own element only.
    var measured = narrowFor(measurePanelWidth(panel), state.narrow);
    if (measured !== state.narrow) {
      setNarrow(measured);
      model.narrow = state.narrow;
      model.openRowId = null; model.filtersOpen = false; model.openInfoId = null;
    }
    if (panel.classList) panel.classList.toggle(NARROW_CLASS, state.narrow === true);

    var html = panelHtml(model);
```

(`model.openRowId` and friends do not exist until Task 7; writing them here is harmless and saves a second edit. `drawerEdit` is deliberately not cleared: an uncommitted edit outlives a breakpoint crossing.)

In the delegated-listener block, directly after `delegated = panel;`, add:

```js
      watchPanelWidth(doc, win, panel, handlers);
```

- [ ] **Step 10: Run, full suite, commit**

Run: `node --test tests/narrow-runtime.test.js && npm test && npm run test:syntax`
Expected: PASS. `tests/wide-parity.test.js` stays green: the harness default width is 0.

```bash
git add torn-forum-command-center.user.js tests/load-userscript.js tests/narrow-helpers.js tests/narrow-runtime.test.js
git commit -m "feat: narrow class from a ResizeObserver on the panel's own width (#33)"
```

---

### Task 7: Runtime - reconciliation and the resets the table requires

**Files:**
- Modify: `torn-forum-command-center.user.js`: new `SEARCH_ROWS_MAX` and `groupCatchUp`/`renderedRowIds` before `function buildPanelModel(`; `buildPanelModel`; `renderCatchUpView` (use `groupCatchUp`); `renderSearchView` (use `SEARCH_ROWS_MAX`); `makeHandlers` (`setView`, `view`, `draft`, `badges-all`, `collapse`, `onThreadLink`)
- Modify: `tests/load-userscript.js` (`EXPORT_NAMES`)
- Create: `tests/narrow-state.test.js`
- Modify: `tests/auto-hide.test.js`

**Interfaces:**
- Consumes: `reconcileTransient`, `INFO_KEYS_BY_VIEW`, `applyTransient`.
- Produces: `model.renderedIds` (string ids in DOM order for the current view), `model.openRowId`, `model.filtersOpen`, `model.openInfoId`, `model.drawerEdit`; `groupCatchUp(rows) -> [{ name, rows }]`; `SEARCH_ROWS_MAX = 50`.

- [ ] **Step 1: Export**

Append `'groupCatchUp', 'renderedRowIds', 'SEARCH_ROWS_MAX',` to the `// #33` block in `EXPORT_NAMES`.

- [ ] **Step 2: Write the failing tests**

Create `tests/narrow-state.test.js`:

```js
'use strict';

// Spec section 6's transition table, through the real model and handlers.
// Rows that need the Actions markup are in Task 12's part of this file.

const test = require('node:test');
const assert = require('node:assert');
const { NOW, bootNarrow, seedRows, redraw } = require('./narrow-helpers');

const SIX = [1, 2, 3, 4, 5, 6].map((id) => ({ id, title: 'Thread ' + id, unread: id }));

function handlersOf(env) { return env.exports.makeHandlers(env.doc, env.win); }
const el = (attrs) => ({ getAttribute: (k) => (attrs[k] === undefined ? null : attrs[k]) });

test('the model carries the rendered ids in DOM order, per view', () => {
  const { api } = bootNarrow();
  seedRows(api, SIX);
  api.state.settings.view = 'threads';
  api.state.settings.sort = 'title';
  assert.deepStrictEqual(api.buildPanelModel(NOW).renderedIds, ['1', '2', '3', '4', '5', '6']);
  api.state.settings.rowsShown = 3;
  assert.deepStrictEqual(api.buildPanelModel(NOW).renderedIds, ['1', '2', '3'], 'after the cap');
  api.state.settings.view = 'drafts';
  assert.deepStrictEqual(api.buildPanelModel(NOW).renderedIds, []);
});

test('Catch up ids follow the folder grouping the view renders', () => {
  const { api } = bootNarrow();
  seedRows(api, SIX);
  api.state.organizer = api.setFolder(api.state.organizer, '6', 'guides');
  api.recompute(NOW);
  api.state.settings.view = 'catchup';
  const model = api.buildPanelModel(NOW);
  const grouped = [].concat(...api.groupCatchUp(model.capped.catchup.rows).map((g) => g.rows.map((r) => String(r.id))));
  assert.deepStrictEqual(model.renderedIds, grouped);
  assert.strictEqual(model.renderedIds[0], '6', 'Guides sorts before Unfiled');
});

test('a stale open row is reconciled away and does not reopen when it returns', () => {
  const { api } = bootNarrow();
  seedRows(api, SIX);
  api.state.settings.view = 'threads';
  api.state.openRowId = '4';
  assert.strictEqual(api.buildPanelModel(NOW).openRowId, '4', 'still listed: unchanged');

  api.state.searchQuery = 'Thread 1';
  assert.strictEqual(api.buildPanelModel(NOW).openRowId, null, 'filtered out: closed');
  api.state.searchQuery = '';
  assert.strictEqual(api.buildPanelModel(NOW).openRowId, null, 'back in the list: still closed');
  assert.strictEqual(api.state.openRowId, null, 'written back to state');
});

test('the cap, Unread only and archive each reconcile the open row', () => {
  const { api } = bootNarrow();
  seedRows(api, SIX);
  api.state.settings.view = 'threads';
  api.state.settings.sort = 'title';

  api.state.openRowId = '6';
  api.state.settings.rowsShown = 3;
  assert.strictEqual(api.buildPanelModel(NOW).openRowId, null, 'capped away');
  api.state.settings.rowsShown = 0;

  api.state.openRowId = '2';
  // An archived thread with new posts stays listed (viewRows), so read it first.
  api.state.organizer = api.markRead(api.state.organizer, '2', 10, NOW);
  const e = api.state.organizer.threads['2'] || api.normaliseThreadEntry(null);
  api.state.organizer.threads['2'] = Object.assign({}, e, { archived: true });
  api.recompute(NOW);
  assert.strictEqual(api.buildPanelModel(NOW).openRowId, null, 'archived away');
});

test('a refresh that drops the open row reconciles it; one that keeps it does not', () => {
  const { api } = bootNarrow();
  seedRows(api, SIX);
  api.state.settings.view = 'threads';
  api.state.openRowId = '3';
  seedRows(api, SIX);
  assert.strictEqual(api.buildPanelModel(NOW).openRowId, '3');
  seedRows(api, SIX.filter((r) => r.id !== 3));
  assert.strictEqual(api.buildPanelModel(NOW).openRowId, null);
});

test('the filters stay open across refresh, filter and cap changes', () => {
  const { api } = bootNarrow();
  seedRows(api, SIX);
  api.state.filtersOpen = true;
  api.state.searchQuery = 'Thread';
  api.state.settings.rowsShown = 3;
  assert.strictEqual(api.buildPanelModel(NOW).filtersOpen, true);
});

test('changing view closes everything; tapping the current view changes nothing', () => {
  const { env, api } = bootNarrow();
  seedRows(api, SIX);
  api.state.settings.view = 'threads';
  Object.assign(api.state, { openRowId: '1', filtersOpen: true, openInfoId: null });
  handlersOf(env).onAction('view', el({ 'data-act': 'view', 'data-view': 'threads' }));
  assert.strictEqual(api.state.openRowId, '1', 'same view');
  handlersOf(env).onAction('view', el({ 'data-act': 'view', 'data-view': 'catchup' }));
  assert.strictEqual(api.state.openRowId, null);
  assert.strictEqual(api.state.filtersOpen, false);
});

test('the Draft action and All badges change view, so they close everything too', () => {
  const { env, api } = bootNarrow();
  seedRows(api, SIX);
  Object.assign(api.state, { openRowId: '1', filtersOpen: true });
  handlersOf(env).onAction('draft', el({ 'data-act': 'draft', 'data-id': '1' }));
  assert.strictEqual(api.state.settings.view, 'drafts');
  assert.strictEqual(api.state.openRowId, null);
  api.state.settings.view = 'threads';
  Object.assign(api.state, { openRowId: '1', filtersOpen: true });
  handlersOf(env).onAction('badges-all', el({ 'data-act': 'badges-all' }));
  assert.strictEqual(api.state.openRowId, null);
  assert.strictEqual(api.state.filtersOpen, false);
});

test('Hide closes everything, and Show leaves it closed', () => {
  const { env, api } = bootNarrow();
  seedRows(api, SIX);
  Object.assign(api.state, { openRowId: '1', filtersOpen: true, openInfoId: 'catchup' });
  handlersOf(env).onAction('collapse', el({ 'data-act': 'collapse' }));
  assert.strictEqual(api.state.settings.collapsed, true);
  assert.deepStrictEqual([api.state.openRowId, api.state.filtersOpen, api.state.openInfoId], [null, false, null]);
  handlersOf(env).onAction('collapse', el({ 'data-act': 'collapse' }));
  assert.strictEqual(api.state.settings.collapsed, false);
  assert.deepStrictEqual([api.state.openRowId, api.state.filtersOpen, api.state.openInfoId], [null, false, null]);
});

test('Reset everything replaces the settings through the transient reset', () => {
  // It replaces state.settings wholesale, which moves Settings to Threads; a
  // view change that skipped the reset would leave the filters open.
  const { env, api } = bootNarrow();
  seedRows(api, SIX);
  api.state.settings.view = 'settings';
  Object.assign(api.state, { openRowId: '1', filtersOpen: true, openInfoId: 'settings-rows',
    drawerEdit: { id: '1', field: 'note-input', value: 'x', selStart: 1, selEnd: 1 } });
  handlersOf(env).onAction('reset-all', el({ 'data-act': 'reset-all' }));
  assert.strictEqual(api.state.settings.view, 'threads');
  assert.deepStrictEqual([api.state.openRowId, api.state.filtersOpen, api.state.openInfoId, api.state.drawerEdit],
    [null, false, null, null], 'a real reset drops the edit mirror too');
});

test('a settings replacement that keeps the view keeps the transients', () => {
  const { env, api } = bootNarrow();
  seedRows(api, SIX);
  api.state.settings.view = 'settings';
  api.state.openInfoId = 'settings-rows';
  handlersOf(env).onChange('rows-shown', { getAttribute: (k) => (k === 'data-act' ? 'rows-shown' : null), value: '10' });
  assert.strictEqual(api.state.openInfoId, 'settings-rows');
  handlersOf(env).onChange('auto-refresh', { getAttribute: (k) => (k === 'data-act' ? 'auto-refresh' : null), value: '0' });
  assert.strictEqual(api.state.openInfoId, 'settings-rows');
});

test('Expand and Shrink leave the transients alone when no breakpoint is crossed', () => {
  const { env, api } = bootNarrow();
  seedRows(api, SIX);
  api.state.settings.view = 'threads';
  redraw(env);
  Object.assign(api.state, { openRowId: '1', filtersOpen: true });
  handlersOf(env).onAction('takeover', el({ 'data-act': 'takeover' }));
  assert.strictEqual(api.state.openRowId, '1');
  assert.strictEqual(api.state.filtersOpen, true);
});

test('a Torn route change inside forums.php reconciles through the redraw', () => {
  const { env, api } = bootNarrow();
  seedRows(api, SIX);
  api.state.settings.view = 'threads';
  api.state.openRowId = '99';
  api.syncToRoute(env.doc, env.win);
  assert.strictEqual(api.state.openRowId, null);
});
```

Append to `tests/auto-hide.test.js` (it already defines `loaded`, `threadLink`, `click`, `panelOf`, `storedSettings`):

```js
test('auto-hide closes the drawer, the filters and the info (#33)', () => {
  const env = loaded({ autoHideOnOpen: true });
  const panel = panelOf(env);
  Object.assign(env.exports.state, { openRowId: '5', filtersOpen: true, openInfoId: 'catchup' });
  panel.dispatchEvent(click(threadLink(env, 5, panel)));
  assert.strictEqual(storedSettings(env).collapsed, true);
  assert.strictEqual(env.exports.state.openRowId, null);
  assert.strictEqual(env.exports.state.filtersOpen, false);
  assert.strictEqual(env.exports.state.openInfoId, null);
});
```

- [ ] **Step 3: Run to verify failure**

Run: `node --test tests/narrow-state.test.js tests/auto-hide.test.js`
Expected: FAIL: `renderedIds` and `openRowId` are undefined on the model; the handlers leave the transients set.

> Amended during implementation: the archive case marks the row read first, because `viewRows` keeps an archived thread with new posts in the list.

- [ ] **Step 4: Add the helpers before `buildPanelModel`**

Immediately before `function buildPanelModel(`, add:

```js
  // Search lists at most this many thread rows.
  var SEARCH_ROWS_MAX = 50;

  // Catch up groups its shown rows by folder name, sorted. One helper, so the
  // focus order (renderedRowIds) is always the order the view renders.
  function groupCatchUp(rows) {
    var byFolder = {};
    for (var i = 0; i < rows.length; i += 1) {
      var k = rows[i].folderName || 'Unfiled';
      (byFolder[k] = byFolder[k] || []).push(rows[i]);
    }
    return Object.keys(byFolder).sort().map(function (name) { return { name: name, rows: byFolder[name] }; });
  }

  // The thread rows the current view renders, as string ids in DOM order.
  function renderedRowIds(view, capped, unchecked, rows) {
    var list = [];
    if (view === 'threads') list = capped.threads.rows;
    else if (view === 'mine') list = capped.mine.rows;
    else if (view === 'catchup') {
      groupCatchUp(capped.catchup.rows).forEach(function (g) { list = list.concat(g.rows); });
      list = list.concat(unchecked || []);
    } else if (view === 'search') list = rows.slice(0, SEARCH_ROWS_MAX);
    return list.map(function (r) { return String(r.id); });
  }
```

- [ ] **Step 5: Reconcile in `buildPanelModel`**

In `buildPanelModel(now)`, replace

```js
    var catchUp = catchUpRowsNow();
    var showAll = state.showAll || {};
```

with

```js
    var catchUp = catchUpRowsNow();
    var unchecked = catchUpUncheckedNow();
    var showAll = state.showAll || {};
    var capped = {
      threads: capRows(threadsSorted, s.rowsShown, showAll.threads === true),
      catchup: capRows(catchUp, s.rowsShown, showAll.catchup === true),
      mine: capRows(mineSorted, s.rowsShown, showAll.mine === true),
    };
    // #33, spec section 6: after every model build, an open row or info that
    // this view does not render closes, and stays closed.
    var renderedIds = renderedRowIds(s.view, capped, unchecked, sorted);
    setTransient(reconcileTransient(currentTransient(), renderedIds, INFO_KEYS_BY_VIEW[s.view] || []));
```

In the returned object, replace the whole `capped: { ... },` block with `capped: capped,` (keep its comment), replace `catchUpUnchecked: catchUpUncheckedNow(),` with `catchUpUnchecked: unchecked,`, and after `narrow: state.narrow === true,` add:

```js
      renderedIds: renderedIds,
      openRowId: state.openRowId,
      filtersOpen: state.filtersOpen,
      openInfoId: state.openInfoId,
      drawerEdit: state.drawerEdit,
```

- [ ] **Step 6: Use the helpers in the two renderers**

In `renderCatchUpView(model)`, replace

```js
    var shown = model.capped.catchup.rows;
    var byFolder = {};
    for (var i = 0; i < shown.length; i += 1) {
      var k = shown[i].folderName || 'Unfiled';
      (byFolder[k] = byFolder[k] || []).push(shown[i]);
    }
    var names = Object.keys(byFolder).sort();
    for (var n = 0; n < names.length; n += 1) {
      out.push('<div class="tfcc-section"><h4>' + escapeHtml(names[n])
        + ' (' + byFolder[names[n]].length + ')</h4><div class="tfcc-rows">');
      for (var j = 0; j < byFolder[names[n]].length; j += 1) {
        out.push(renderRow(byFolder[names[n]][j], model));
      }
      out.push('</div></div>');
    }
```

with

```js
    var groups = groupCatchUp(model.capped.catchup.rows);
    for (var n = 0; n < groups.length; n += 1) {
      out.push('<div class="tfcc-section"><h4>' + escapeHtml(groups[n].name)
        + ' (' + groups[n].rows.length + ')</h4><div class="tfcc-rows">');
      for (var j = 0; j < groups[n].rows.length; j += 1) {
        out.push(renderRow(groups[n].rows[j], model));
      }
      out.push('</div></div>');
    }
```

In `renderSearchView(model)`, replace `i < matched.length && i < 50;` with `i < matched.length && i < SEARCH_ROWS_MAX;`.

- [ ] **Step 7: Wire the resets in `makeHandlers`**

Inside `makeHandlers`, after `function valueOf(act) { ... }`, add:

```js
    // Every way the view changes goes through here, so the disclosures close
    // with it (spec section 6). Tapping the current view changes nothing.
    function setView(v) {
      if (v !== state.settings.view) applyTransient({ type: 'view' });
      state.settings.view = v;
    }
```

Then:
- In the `view` case, replace `if (VIEWS.indexOf(v) !== -1) { state.settings.view = v; persist('settings'); }` with `if (VIEWS.indexOf(v) !== -1) { setView(v); persist('settings'); }`.
- In the `draft` case, replace `state.settings.view = 'drafts';` with `setView('drafts');`.
- In the `badges-all` case, replace `state.settings.view = 'settings'; persist('settings'); redraw(); return;` with `setView('settings'); persist('settings'); redraw(); return;`.
- Replace the `collapse` line with:

```js
        if (act === 'collapse') {
          state.settings.collapsed = !state.settings.collapsed;
          applyTransient({ type: state.settings.collapsed ? 'collapse' : 'show' });
          persist('settings'); redraw(); return;
        }
```

- In `onThreadLink`, after `state.badgeShelfOpen = false;` add `applyTransient({ type: 'auto-hide' });`, and replace `state.settings = next;` with `replaceSettings(next);`.

Every wholesale replacement of `state.settings` goes through one helper, so none can change the view or collapse the panel without the reset. After `function applyTransient(` (Task 6), add:

```js
  // Every wholesale replacement of state.settings comes through here, so a
  // replacement that changes the view or collapses the panel closes the
  // disclosures exactly as the matching user action would (spec section 6).
  function replaceSettings(next) {
    if (next.view !== state.settings.view) applyTransient({ type: 'view' });
    else if (next.collapsed === true && state.settings.collapsed !== true) applyTransient({ type: 'collapse' });
    state.settings = next;
  }
```

Then in `makeHandlers`:
- `reset-all`: replace `state.settings = freshSettings(); state.organizer = freshOrganizer(now); state.showAll = {};` with `replaceSettings(freshSettings()); state.drawerEdit = null; state.organizer = freshOrganizer(now); state.showAll = {};`.
- `auto-refresh`: replace `state.settings = normaliseSettings(Object.assign({}, state.settings, { autoRefreshMs: Number(value) }));` with `replaceSettings(normaliseSettings(Object.assign({}, state.settings, { autoRefreshMs: Number(value) })));`.
- `rows-shown`: replace `state.settings = normaliseSettings(Object.assign({}, state.settings, { rowsShown: Number(value) }));` with `replaceSettings(normaliseSettings(Object.assign({}, state.settings, { rowsShown: Number(value) })));`.

Check with `grep -n "state.settings = " torn-forum-command-center.user.js` that no other wholesale assignment is left outside `loadAll` (which runs before the first render, when every transient is already null) and `replaceSettings` itself. Export `'replaceSettings'` in the `// #33` block of `EXPORT_NAMES`.

- [ ] **Step 8: Run, full suite, commit**

Run: `node --test tests/narrow-state.test.js tests/auto-hide.test.js tests/wide-parity.test.js && npm test && npm run test:syntax`
Expected: PASS. The parity test proves the Catch up and Search refactors kept the rows identical.

```bash
git add torn-forum-command-center.user.js tests/load-userscript.js tests/narrow-state.test.js tests/auto-hide.test.js
git commit -m "feat: reconcile transient state after every model build (#33)"
```

---

### Task 8: Info buttons at every size, and the section 13d audit

**Files:**
- Modify: `torn-forum-command-center.user.js`: new `GLYPHS`, `glyph`, `renderInfoButton`, `renderInfoText` before `function btn(`; `renderCatchUpView`, `renderMineView`, `renderSearchView`, `renderDraftsView`, `renderSettingsView`, `renderBadgeCatalogue`; `makeHandlers` (`info`); `panelStyleText`
- Modify: `tests/load-userscript.js` (`EXPORT_NAMES`)
- Create: `tests/info.test.js`
- Modify: `tests/style.test.js` (the key note), `tests/panel.test.js` (the Drafts line)

**Interfaces:**
- Consumes: `INFO_KEYS`, `INFO_KEYS_BY_VIEW`, `model.openInfoId`, `applyTransient`.
- Produces: `GLYPHS` (frozen `{ name: pathData }`: `refresh`, `expand`, `shrink`, `up`, `down`, `funnel`, `more`, `check`, `info`), `glyph(name) -> string`, `renderInfoButton(key, openKey)`, `renderInfoText(key, openKey, html)`; action `info` (reads `data-info`).

- [ ] **Step 1: Export**

Append `'GLYPHS', 'glyph', 'renderInfoButton', 'renderInfoText',` to the `// #33` block in `EXPORT_NAMES`.

- [ ] **Step 2: Write the failing tests**

Create `tests/info.test.js`:

```js
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { NOW, bootNarrow, seedRows, visible, click } = require('./narrow-helpers');

function htmlFor(api, view) {
  api.state.settings.view = view;
  return api.panelHtml(api.buildPanelModel(NOW));
}

// The owner-approved spec 13d audit, written out here and never read from the
// production constants, so dropping an item from both the code and
// INFO_KEYS_BY_VIEW still fails. info: the exact keys the view renders, with
// their accessible names. hidden: text that stays in the markup but is not
// shown until asked. visible: text that must be shown. gone: wording that the
// audit removed or shortened away.
const OWNER_13D = {
  threads: { info: {} },
  catchup: {
    info: { catchup: 'About Catch up' },
    hidden: ['Marking read here hides a thread from this list.'],
  },
  mine: {
    info: { mine: 'About My posts' },
    hidden: ['Threads you started or posted in.', 'at most once every 15 minutes; Refresh always does.'],
    visible: ['Updated 4m ago.'],
  },
  search: {
    info: { search: 'About Search' },
    hidden: ['Filtering searches titles, authors, forums, your notes and tags.'],
    visible: ['Cached posts:'],
  },
  drafts: {
    info: {},
    visible: ['No reply box here, so Copy replaces Insert.'],
    gone: ['No reply box was found'],
  },
  settings: {
    info: {
      'settings-budget': 'About the request budget',
      'settings-author': 'About author-only mode',
      'settings-rows': 'About Rows shown',
      'settings-autohide': 'About hiding the panel',
      'settings-folders': 'About folders',
      'settings-badges': 'About badges',
    },
    hidden: [
      'A refresh of Threads makes two requests',
      'With this on, a thread in Threads and Catch up counts as new only when',
      'Search and Drafts always show everything.',
      'Only thread links in this panel do this, and only a plain click.',
      'A folder can claim a forum',
      'Earned from what you do here',
    ],
    visible: [
      'Create a <strong>Minimal Access</strong> key on Torn (Settings, API Key).',
      'Opens Torn in a new tab with only this script\'s selections.',
      'A Threads refresh is at most 13 requests and My posts at most 17; never more than 40 a minute.',
      'Costs no extra requests. Some threads may show &quot;not checked&quot;.',
      'Applies to Threads, Catch up and My posts.',
      'Never includes your API key or the post cache.',
      'Never includes your key, drafts, notes or post text.',
      'Recorded on this device only. No request is made.',
    ],
    gone: ['This script needs a key', 'This opens Torn', 'An export carries', 'A debug report carries'],
  },
};

function seeded(width) {
  const { env, api } = bootNarrow({ width });
  seedRows(api, [{ id: 1, unread: 1 }]);
  api.state.mine.fetchedAt = NOW - 4 * 60000;
  api.state.route = api.parseForumRoute({ origin: 'https://www.torn.com', hostname: 'www.torn.com',
    pathname: '/forums.php', search: '', hash: '#/p=threads&f=61&t=1', href: 'https://www.torn.com/forums.php#/p=threads&f=61&t=1' });
  api.state.replyBoxFound = false;
  return { env, api };
}

test('every view renders exactly the owner\'s info buttons, each wired to a hidden text', () => {
  for (const width of [900, 343]) {
    const { api } = seeded(width);
    for (const [view, spec] of Object.entries(OWNER_13D)) {
      const html = htmlFor(api, view);
      const keys = Array.from(html.matchAll(/data-act="info" data-info="([a-z-]+)"/g), (m) => m[1]);
      assert.deepStrictEqual(keys.slice().sort(), Object.keys(spec.info).sort(), view + ' at ' + width);
      for (const [key, label] of Object.entries(spec.info)) {
        assert.match(html, new RegExp('data-info="' + key + '" aria-expanded="false" aria-controls="tfcc-info-'
          + key + '" aria-label="' + label + '"'), key);
        assert.match(html, new RegExp('<p class="tfcc-note tfcc-infotext" id="tfcc-info-' + key + '" hidden>'),
          key + ' is in the markup and hidden while closed');
      }
    }
  }
});

test('every audited text is hidden, visible or gone exactly as section 13d prescribes', () => {
  for (const width of [900, 343]) {
    const { api } = seeded(width);
    for (const [view, spec] of Object.entries(OWNER_13D)) {
      const html = htmlFor(api, view);
      const v = visible(html);
      for (const s of spec.hidden || []) {
        assert.ok(html.includes(s), view + ': still in the markup: ' + s);
        assert.ok(!v.includes(s), view + ': not shown until asked: ' + s);
      }
      for (const s of spec.visible || []) assert.ok(v.includes(s), view + ': visible: ' + s);
      for (const s of spec.gone || []) assert.ok(!html.includes(s), view + ': gone: ' + s);
    }
  }
});

test('tapping an info button opens it, a second tap closes it, and only one is open', () => {
  const { env, api } = bootNarrow({ width: 900 });
  api.state.settings.view = 'settings';
  env.exports.draw(env.doc, env.win, api.makeHandlers(env.doc, env.win), true);
  click(env, '[data-act="info"][data-info="settings-budget"]');
  let html = env.doc.getElementById('tfcc-panel').innerHTML;
  assert.match(html, /<p class="tfcc-note tfcc-infotext" id="tfcc-info-settings-budget">/);
  assert.match(html, /data-info="settings-budget" aria-expanded="true"/);
  click(env, '[data-act="info"][data-info="settings-rows"]');
  html = env.doc.getElementById('tfcc-panel').innerHTML;
  assert.match(html, /id="tfcc-info-settings-budget" hidden>/, 'opening another closes the first');
  assert.match(html, /id="tfcc-info-settings-rows">/);
  click(env, '[data-act="info"][data-info="settings-rows"]');
  assert.strictEqual(api.state.openInfoId, null);
});

test('an unknown data-info changes nothing and does not throw', () => {
  const { env, api } = bootNarrow({ width: 900 });
  const h = api.makeHandlers(env.doc, env.win);
  assert.doesNotThrow(() => h.onAction('info', { getAttribute: (k) => (k === 'data-info' ? 'evil' : 'info') }));
  assert.doesNotThrow(() => h.onAction('info', { getAttribute: () => null }));
  assert.strictEqual(api.state.openInfoId, null);
});

test('a view change closes the open info', () => {
  const { env, api } = bootNarrow({ width: 900 });
  api.state.settings.view = 'catchup';
  api.state.openInfoId = 'catchup';
  api.makeHandlers(env.doc, env.win).onAction('view', { getAttribute: (k) => (k === 'data-view' ? 'search' : 'view') });
  assert.strictEqual(api.state.openInfoId, null);
});

test('Catch up\'s standing paragraph is behind its info button, at every size', () => {
  for (const width of [900, 343]) {
    const { api } = bootNarrow({ width });
    const html = htmlFor(api, 'catchup');
    assert.match(html, /Marking read here hides a thread from this list\./, 'still in the markup');
    assert.doesNotMatch(visible(html), /Marking read here/, 'but not shown until asked');
  }
});

test('My posts keeps its live status visible and its description behind info', () => {
  const { api } = bootNarrow({ width: 900 });
  api.state.mine.fetchedAt = NOW - 4 * 60000;
  const html = htmlFor(api, 'mine');
  assert.match(visible(html), /Updated 4m ago\./);
  assert.doesNotMatch(visible(html), /Threads you started or posted in/);
  assert.match(html, /Threads you started or posted in\. Opening My posts checks Torn again at most once every 15 minutes; Refresh always does\./);
});

test('Settings states the real request budget visibly, computed from the user\'s setting', () => {
  const { api } = bootNarrow({ width: 900 });
  let html = htmlFor(api, 'settings');
  assert.match(visible(html), /A Threads refresh is at most 13 requests and My posts at most 17; never more than 40 a minute\./);
  api.state.settings.enrichBudget = 4;
  html = htmlFor(api, 'settings');
  assert.match(visible(html), /A Threads refresh is at most 7 requests and My posts at most 10; never more than 40 a minute\./);
  assert.match(html, /The script keeps itself under 40 requests a minute regardless\./, 'the full breakdown is behind info');
});

test('the required disclosures stay visible: the ToS table, key status and both privacy lines', () => {
  const { api } = bootNarrow({ width: 343 });
  const v = visible(htmlFor(api, 'settings'));
  for (const s of ['<th>Who can see your data</th>', '<th>Access level required</th>', '<th>Requests made</th>',
    'No key saved yet.', 'Create a <strong>Minimal Access</strong> key on Torn (Settings, API Key).',
    'Opens Torn in a new tab with only this script\'s selections.',
    '<tr><th>Access level required</th><td>Minimal Access. Limited Access also works but is not needed. Public Only does not.</td></tr>',
    'Never includes your API key or the post cache.',
    'Never includes your key, drafts, notes or post text.',
    'Recorded on this device only. No request is made.',
    'Applies to Threads, Catch up and My posts.',
    'Costs no extra requests. Some threads may show &quot;not checked&quot;.']) {
    assert.ok(v.includes(s), 'visible: ' + s);
  }
});

test('Drafts names the missing reply box in fewer words', () => {
  const { api } = bootNarrow({ width: 900 });
  api.state.route = api.parseForumRoute({ pathname: '/forums.php', hash: '#/p=threads&f=61&t=1', hostname: 'www.torn.com' });
  api.state.replyBoxFound = false;
  assert.match(htmlFor(api, 'drafts'), /No reply box here, so Copy replaces Insert\./);
});

test('every glyph is ASCII path data, drawn in currentColor and hidden from assistive tech', () => {
  const { api } = bootNarrow({ width: 900 });
  for (const name of Object.keys(api.GLYPHS)) {
    assert.match(api.GLYPHS[name], /^[MmLlHhVvAaZz0-9 .,-]+$/, name);
    const svg = api.glyph(name);
    assert.match(svg, /^<svg class="tfcc-gl" viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false">/);
  }
});
```

- [ ] **Step 3: Run to verify failure**

Run: `node --test tests/info.test.js`
Expected: FAIL: no `data-act="info"` anywhere.

- [ ] **Step 4: Add the glyphs and the info renderers**

Immediately before `function btn(action, label, extra) {`, add:

```js
  // Inline ASCII SVG icons (#33). Stroked in currentColor, so they follow the
  // theme; aria-hidden, because every button that holds one has an aria-label
  // or visible text.
  var GLYPHS = Object.freeze({
    refresh: 'M20 12a8 8 0 1 1-2.34-5.66M20 4v5h-5',
    expand: 'M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5',
    shrink: 'M9 4v5H4M20 9h-5V4M15 20v-5h5M4 15h5v5',
    up: 'M6 15l6-6 6 6',
    down: 'M6 9l6 6 6-6',
    funnel: 'M4 5h16l-6 7v6l-4 2v-8z',
    more: 'M5.5 12h1M11.5 12h1M17.5 12h1',
    check: 'M5 12.5l4.5 4.5L19 7.5',
    info: 'M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18zM12 11v6M12 7.5v.5',
  });

  function glyph(name) {
    return '<svg class="tfcc-gl" viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false">'
      + '<path d="' + GLYPHS[name] + '"/></svg>';
  }

  // An info button and the explanation it discloses (spec 13d). The text is
  // always in the markup, so aria-controls names a real element and the tests
  // that pin the wording keep reading it; only `hidden` follows the state.
  function renderInfoButton(key, openKey) {
    var open = openKey === key;
    return '<button type="button" class="tfcc-info" data-act="info" data-info="' + escapeHtml(key)
      + '" aria-expanded="' + (open ? 'true' : 'false') + '" aria-controls="tfcc-info-' + escapeHtml(key)
      + '" aria-label="' + escapeHtml(INFO_KEYS[key]) + '">' + glyph('info') + '</button>';
  }

  // html is this script's own text, already escaped where it carries data.
  function renderInfoText(key, openKey, html) {
    return '<p class="tfcc-note tfcc-infotext" id="tfcc-info-' + escapeHtml(key) + '"'
      + (openKey === key ? '' : ' hidden') + '>' + html + '</p>';
  }
```

- [ ] **Step 5: Catch up, My posts, Search, Drafts**

In `renderCatchUpView(model)`, replace

```js
    out.push(btn('catchup-done', 'Set catch-up point to now'));
    out.push('</div>');
    out.push('<p class="tfcc-note">Marking read here hides a thread from this list. '
      + 'It cannot clear Torn\'s own new-post counter, which only clears when you open the thread.</p>');
```

with

```js
    out.push(btn('catchup-done', 'Set catch-up point to now'));
    out.push(renderInfoButton('catchup', model.openInfoId));
    out.push('</div>');
    out.push(renderInfoText('catchup', model.openInfoId, 'Marking read here hides a thread from this list. '
      + 'It cannot clear Torn\'s own new-post counter, which only clears when you open the thread.'));
```

In `renderMineView(model)`, replace

```js
    var line = 'Threads you started or posted in.';
    if (m.fetchedAt) line += ' Updated ' + formatRelativeTime(m.fetchedAt, model.now) + '.';
    if (m.unchecked) line += ' ' + m.unchecked + ' not checked yet.';
    out.push('<p class="tfcc-note">' + escapeHtml(line) + '</p>');
```

with

```js
    // Spec 13d item 4: the live status stays visible; the standing
    // description and the refresh rule go behind info.
    var status = [];
    if (m.fetchedAt) status.push('Updated ' + formatRelativeTime(m.fetchedAt, model.now) + '.');
    if (m.unchecked) status.push(m.unchecked + ' not checked yet.');
    out.push('<div class="tfcc-infobar">'
      + (status.length ? '<span class="tfcc-note">' + escapeHtml(status.join(' ')) + '</span>' : '')
      + renderInfoButton('mine', model.openInfoId) + '</div>');
    out.push(renderInfoText('mine', model.openInfoId, escapeHtml('Threads you started or posted in. '
      + 'Opening My posts checks Torn again at most once every ' + Math.round(MINE_TTL_MS / 60000)
      + ' minutes; Refresh always does.')));
```

In `renderSearchView(model)`, replace

```js
      + '">Search on Torn</a>');
    out.push('</div>');
    out.push('<p class="tfcc-note">Filtering searches titles, authors, forums, your notes and tags. '
```

with

```js
      + '">Search on Torn</a>');
    out.push(renderInfoButton('search', model.openInfoId));
    out.push('</div>');
    out.push(renderInfoText('search', model.openInfoId, 'Filtering searches titles, authors, forums, your notes and tags. '
```

and change that statement's ending `+ 'but never shows you a box for it.</p>');` to `+ 'but never shows you a box for it.'));`.

In `renderDraftsView(model)`, replace

```js
        out.push('<p class="tfcc-note">No reply box was found on this page, so Insert is unavailable. '
          + 'Copy puts the draft on your clipboard instead.</p>');
```

with

```js
        out.push('<p class="tfcc-note">No reply box here, so Copy replaces Insert.</p>');
```

- [ ] **Step 6: Settings and the badge catalogue**

In `renderSettingsView(model)`:

1. Replace the four-line key note (`'<p class="tfcc-note">This script needs a key ...' ... 'key does not.</p>');`) with:

```js
    // Spec 13d item 13: the ToS table below states every access level.
    out.push('<p class="tfcc-note">Create a <strong>Minimal Access</strong> key on Torn (Settings, API Key).</p>');
```

2. Replace

```js
    out.push('<p class="tfcc-note">This opens Torn\'s key page in a new tab with only the selections this '
      + 'script uses. You confirm the key there, then paste it here.</p>');
```

with

```js
    // Spec 13d item 16, the owner's wording.
    out.push('<p class="tfcc-note">Opens Torn in a new tab with only this script\'s selections.</p>');
```

3. Change the budget paragraph's first line from `out.push('<p class="tfcc-note">A refresh of Threads makes two requests, plus one for the forum list at '` to `var budgetText = 'A refresh of Threads makes two requests, plus one for the forum list at '` and its last line from `+ 'The script keeps itself under ' + REQUESTS_PER_WINDOW + ' requests a minute regardless.</p>');` to `+ 'The script keeps itself under ' + REQUESTS_PER_WINDOW + ' requests a minute regardless.';`. Every line between stays exactly as it is. Then directly after it add:

```js
    // CLAUDE.md constraint 7: the headline of the budget stays visible and is
    // computed from the constants and this user's lookup setting.
    var budget = model.settings.enrichBudget;
    out.push('<div class="tfcc-infobar"><span class="tfcc-note">' + escapeHtml('A Threads refresh is at most '
      + (3 + budget) + ' requests and My posts at most ' + (2 + budget + thumbsAt(budget))
      + '; never more than ' + REQUESTS_PER_WINDOW + ' a minute.') + '</span>'
      + renderInfoButton('settings-budget', model.openInfoId) + '</div>');
    out.push(renderInfoText('settings-budget', model.openInfoId, budgetText));
```

4. Change the author-only paragraph's first line from `out.push('<p class="tfcc-note">With this on, a thread in Threads and Catch up counts as new only when its '` to `var authorText = 'With this on, a thread in Threads and Catch up counts as new only when its '` and its last line from `+ 'this script are not flagged, and edits are not detected.</p>');` to `+ 'this script are not flagged, and edits are not detected.';`. Then add:

```js
    out.push('<div class="tfcc-infobar"><span class="tfcc-note">'
      + escapeHtml('Costs no extra requests. Some threads may show "not checked".') + '</span>'
      + renderInfoButton('settings-author', model.openInfoId) + '</div>');
    out.push(renderInfoText('settings-author', model.openInfoId, authorText));
```

5. Replace the Rows shown note (from `var cappedNames = ...` through `+ 'and Show all lifts the cap for that list until the page reloads. The default is 5.</p>');`) with:

```js
    var cappedNames = CAPPED_VIEWS.map(function (v) { return VIEW_LABELS[v]; });
    out.push('<div class="tfcc-infobar"><span class="tfcc-note">Applies to '
      + escapeHtml(cappedNames.length > 1
        ? cappedNames.slice(0, -1).join(', ') + ' and ' + cappedNames[cappedNames.length - 1]
        : cappedNames.join(''))
      + '.</span>' + renderInfoButton('settings-rows', model.openInfoId) + '</div>');
    out.push(renderInfoText('settings-rows', model.openInfoId, 'Search and Drafts always show everything. '
      + 'A capped list says how many it is hiding, and Show all lifts the cap for that list until the page '
      + 'reloads. The default is 5.'));
```

6. Replace the auto-hide row and its note:

```js
    out.push('<div class="tfcc-kv"><label for="tfcc-autohide">Hide the panel when I open a thread</label>'
      + '<input id="tfcc-autohide" type="checkbox" data-act="auto-hide"'
      + (model.settings.autoHideOnOpen ? ' checked' : '') + '>'
      + renderInfoButton('settings-autohide', model.openInfoId) + '</div>');
    out.push(renderInfoText('settings-autohide', model.openInfoId, 'Only thread links in this panel do this, '
      + 'and only a plain click. Opening a link in a new tab, or following links on the Torn page itself, '
      + 'leaves the panel as it is. Press Show to bring it back.'));
```

7. Replace the Folders heading and note:

```js
    out.push('<div class="tfcc-section"><div class="tfcc-infobar"><h4>Folders</h4>'
      + renderInfoButton('settings-folders', model.openInfoId) + '</div>');
    out.push(renderInfoText('settings-folders', model.openInfoId, 'A folder can claim a forum, and new '
      + 'subscriptions from that forum file themselves into it. Filing a thread by hand always wins over a rule.'));
```

8. Replace the Backup note with `out.push('<p class="tfcc-note">Never includes your API key or the post cache.</p>');` and the Storage note with `out.push('<p class="tfcc-note">Never includes your key, drafts, notes or post text.</p>');`.

In `renderBadgeCatalogue(model)`, replace the `out.push('<p class="tfcc-note">Earned from what you do here: ...` statement with:

```js
    out.push('<div class="tfcc-infobar"><span class="tfcc-note">Recorded on this device only. No request is made.'
      + '</span>' + renderInfoButton('settings-badges', model.openInfoId) + '</div>');
    out.push(renderInfoText('settings-badges', model.openInfoId, 'Earned from what you do here: focused visits '
      + 'to threads, finishing Torn days with Catch up empty, and organising. A visit counts once a Torn day, '
      + 'after 15 seconds with the page in front of you. A day is a Torn day, from 00:00 TCT. Nothing is sent '
      + 'anywhere, and no request is made. Turning this off stops recording, and a streak does not survive days '
      + 'with it off.'));
```

- [ ] **Step 7: The handler**

In `makeHandlers`, inside `onAction`, directly after the `rows-toggle` case, add:

```js
        if (act === 'info') {
          // Only a known key; a forged one plants no state (spec 13d).
          var infoKey = el && el.getAttribute ? el.getAttribute('data-info') : null;
          if (Object.prototype.hasOwnProperty.call(INFO_KEYS, infoKey)) applyTransient({ type: 'info', key: infoKey });
          redraw(); return;
        }
```

- [ ] **Step 8: The stylesheet**

In `panelStyleText()`, directly after the `'#' + PANEL_ID + ' .tfcc-note { ... }',` line, add:

```js
      // #33: anything carrying the hidden attribute stays hidden, whatever a
      // display rule on it or on the host says.
      '#' + PANEL_ID + ' [hidden] { display: none !important; }',
      '#' + PANEL_ID + ' .tfcc-gl { display: block; flex: none; }',
      // (1,1,1): beats a host "svg * { fill }" rule, as the logo rule does.
      '#' + PANEL_ID + ' .tfcc-gl path { fill: none; stroke: currentColor; stroke-width: 2;',
      '  stroke-linecap: round; stroke-linejoin: round; }',
      '#' + PANEL_ID + ' .tfcc-infobar { display: flex; align-items: center; gap: var(--tfcc-gap-sm);',
      '  flex-wrap: wrap; margin-bottom: var(--tfcc-gap-sm); }',
      '#' + PANEL_ID + ' .tfcc-infobar h4 { margin: 0; }',
      '#' + PANEL_ID + ' button.tfcc-info { display: inline-flex; align-items: center; justify-content: center;',
      '  min-width: 44px; min-height: 44px; padding: 0; border-color: var(--tm-border); }',
      '#' + PANEL_ID + ' button.tfcc-info[aria-expanded="true"] { background: var(--tm-hover); }',
      '#' + PANEL_ID + ' .tfcc-infotext { border-left: 3px solid var(--tm-accent-text);',
      '  padding: 2px 0 2px 8px; margin: 0 0 var(--tfcc-gap-sm) 0; }',
```

- [ ] **Step 9: Update the two tests that pinned shortened wording**

In `tests/style.test.js`, replace the `KEY_HELP_NOTE` constant with:

```js
// #33 (spec 13d item 13) shortened the note. Every access level is still
// stated in the access-level row of the ToS table beside it.
const KEY_HELP_NOTE = 'Create a <strong>Minimal Access</strong> key on Torn (Settings, API Key).';
```

and in the test `'the key help names Minimal Access as the required level'`, replace the line `requiresMinimal(KEY_HELP_NOTE, 'the Settings key note');` with:

```js
  assert.match(KEY_HELP_NOTE, /Minimal Access/, 'the short note still names the level to create');
  assert.doesNotMatch(KEY_HELP_NOTE, /Limited|Custom/, 'and names no other level');
```

In `tests/panel.test.js`, replace `assert.match(html, /No reply box was found/, 'the user is told why, not left guessing');` with `assert.match(html, /No reply box here, so Copy replaces Insert\./, 'the user is told why, not left guessing');`.

In `tests/custom-key.test.js`, in `'the key section offers the link as a new-tab anchor'`, replace `assert.match(section, /only the selections this script uses/);` with:

```js
  // Spec 13d item 16: the point-of-action disclosure, in the owner's words. It
  // still says the link opens a new tab and carries nothing but this script's
  // selections.
  assert.match(section, /Opens Torn in a new tab with only this script's selections\./);
```

- [ ] **Step 10: Record the owner's wide changes for the parity test**

Replace the contents of `tests/wide-13d-diffs.js` with the list below. Each `from` was taken from main's actual output for the Task 1 seed; each `to` is what this task's code renders. `INFO` and `HID` are written out literally here, not borrowed from the script, so the expectation stays independent of the code it checks. If an entry fails, compare the two strings: change the entry only if the difference is inside that same 13d item, never to absorb anything else.

```js
'use strict';

// The owner-approved wide markup changes of spec section 13d, one literal
// replacement per audited item (the item numbers are the spec's audit table),
// applied to main's golden by tests/wide-parity.test.js.

const SVG_INFO = '<svg class="tfcc-gl" viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false">'
  + '<path d="M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18zM12 11v6M12 7.5v.5"/></svg>';

function INFO(key, label) {
  return '<button type="button" class="tfcc-info" data-act="info" data-info="' + key + '" aria-expanded="false"'
    + ' aria-controls="tfcc-info-' + key + '" aria-label="' + label + '">' + SVG_INFO + '</button>';
}

function HID(key, text) {
  return '<p class="tfcc-note tfcc-infotext" id="tfcc-info-' + key + '" hidden>' + text + '</p>';
}

module.exports = [
  {
    item: "2 Catch up", view: "catchup",
    from: "<button type=\"button\" data-act=\"catchup-done\">Set catch-up point to now</button></div><p class=\"tfcc-note\">Marking read here hides a thread from this list. It cannot clear Torn's own new-post counter, which only clears when you open the thread.</p>",
    to: "<button type=\"button\" data-act=\"catchup-done\">Set catch-up point to now</button>"
      + INFO("catchup", "About Catch up")
      + "</div>"
      + HID("catchup", "Marking read here hides a thread from this list. It cannot clear Torn's own new-post counter, which only clears when you open the thread."),
  },
  {
    item: "4 My posts", view: "mine",
    from: "<p class=\"tfcc-note\">Threads you started or posted in. Updated 4m ago.</p>",
    to: "<div class=\"tfcc-infobar\"><span class=\"tfcc-note\">Updated 4m ago.</span>"
      + INFO("mine", "About My posts")
      + "</div>"
      + HID("mine", "Threads you started or posted in. Opening My posts checks Torn again at most once every 15 minutes; Refresh always does."),
  },
  {
    item: "8 Search", view: "search",
    from: "Search on Torn</a></div><p class=\"tfcc-note\">Filtering searches titles, authors, forums, your notes and tags. Searching inside posts fetches up to 5 pages for each of the threads currently listed, then keeps them for next time. Search on Torn hands the same query to Torn's own forum search, which understands by:player but never shows you a box for it.</p>",
    to: "Search on Torn</a>"
      + INFO("search", "About Search")
      + "</div>"
      + HID("search", "Filtering searches titles, authors, forums, your notes and tags. Searching inside posts fetches up to 5 pages for each of the threads currently listed, then keeps them for next time. Search on Torn hands the same query to Torn's own forum search, which understands by:player but never shows you a box for it."),
  },
  {
    item: "11 Drafts", view: "drafts",
    from: "<p class=\"tfcc-note\">No reply box was found on this page, so Insert is unavailable. Copy puts the draft on your clipboard instead.</p>",
    to: "<p class=\"tfcc-note\">No reply box here, so Copy replaces Insert.</p>",
  },
  {
    item: "13 key note", view: "settings",
    from: "<p class=\"tfcc-note\">This script needs a key that can read your subscribed threads. On Torn, go to Settings, API Key, and create a <strong>Minimal Access</strong> key. A <strong>Limited Access</strong> key also works but is not needed. A <strong>Public Only</strong> key does not.</p>",
    to: "<p class=\"tfcc-note\">Create a <strong>Minimal Access</strong> key on Torn (Settings, API Key).</p>",
  },
  {
    item: "16 custom key", view: "settings",
    from: "<p class=\"tfcc-note\">This opens Torn's key page in a new tab with only the selections this script uses. You confirm the key there, then paste it here.</p>",
    to: "<p class=\"tfcc-note\">Opens Torn in a new tab with only this script's selections.</p>",
  },
  {
    item: "17 budget", view: "settings",
    from: "<p class=\"tfcc-note\">A refresh of Threads makes two requests, plus one for the forum list at most once a day. Opening My posts, or refreshing while it is open, makes two requests of its own, at most once every 15 minutes unless you press Refresh. Each activity lookup adds one more to either, and only runs for a thread with no recent time. My posts also reads the opening post of up to 5 threads you started, for their thumbs up and down, each at most once every 12 hours; with lookups set to 0 it reads none. If you have started no threads and written no posts, My posts instead reads your profile once for your forum karma, at most once every 12 hours, which is 3 requests in all. With the default of 10, a Threads refresh is at most 13 requests and My posts at most 17; at the largest setting of 25, 28 and 32. The script keeps itself under 40 requests a minute regardless.</p>",
    to: "<div class=\"tfcc-infobar\"><span class=\"tfcc-note\">A Threads refresh is at most 13 requests and My posts at most 17; never more than 40 a minute.</span>"
      + INFO("settings-budget", "About the request budget")
      + "</div>"
      + HID("settings-budget", "A refresh of Threads makes two requests, plus one for the forum list at most once a day. Opening My posts, or refreshing while it is open, makes two requests of its own, at most once every 15 minutes unless you press Refresh. Each activity lookup adds one more to either, and only runs for a thread with no recent time. My posts also reads the opening post of up to 5 threads you started, for their thumbs up and down, each at most once every 12 hours; with lookups set to 0 it reads none. If you have started no threads and written no posts, My posts instead reads your profile once for your forum karma, at most once every 12 hours, which is 3 requests in all. With the default of 10, a Threads refresh is at most 13 requests and My posts at most 17; at the largest setting of 25, 28 and 32. The script keeps itself under 40 requests a minute regardless."),
  },
  {
    item: "18 author-only", view: "settings",
    from: "<p class=\"tfcc-note\">With this on, a thread in Threads and Catch up counts as new only when its author has posted since you last looked. Each activity lookup then reads the thread's posts since you last looked, 20 at a time, newest first, instead of its last-post time. Each page is one lookup from the same allowance, so the cost does not change: with your setting of 10, a Threads refresh is at most 13 requests a refresh, on or off. A thread gets at most 3 pages, and only once every other thread has had its first. With more new posts than that, a count shows as a minimum (N+), or as \"not checked (too many new)\" when none of the posts read is by the author. Threads not checked yet show \"not checked\". My posts ignores this setting. Posts from before you started using this script are not flagged, and edits are not detected.</p>",
    to: "<div class=\"tfcc-infobar\"><span class=\"tfcc-note\">Costs no extra requests. Some threads may show &quot;not checked&quot;.</span>"
      + INFO("settings-author", "About author-only mode")
      + "</div>"
      + HID("settings-author", "With this on, a thread in Threads and Catch up counts as new only when its author has posted since you last looked. Each activity lookup then reads the thread's posts since you last looked, 20 at a time, newest first, instead of its last-post time. Each page is one lookup from the same allowance, so the cost does not change: with your setting of 10, a Threads refresh is at most 13 requests a refresh, on or off. A thread gets at most 3 pages, and only once every other thread has had its first. With more new posts than that, a count shows as a minimum (N+), or as \"not checked (too many new)\" when none of the posts read is by the author. Threads not checked yet show \"not checked\". My posts ignores this setting. Posts from before you started using this script are not flagged, and edits are not detected."),
  },
  {
    item: "19 rows shown", view: "settings",
    from: "<p class=\"tfcc-note\">Applies to Threads, Catch up and My posts. Search and Drafts always show everything. A capped list says how many it is hiding, and Show all lifts the cap for that list until the page reloads. The default is 5.</p>",
    to: "<div class=\"tfcc-infobar\"><span class=\"tfcc-note\">Applies to Threads, Catch up and My posts.</span>"
      + INFO("settings-rows", "About Rows shown")
      + "</div>"
      + HID("settings-rows", "Search and Drafts always show everything. A capped list says how many it is hiding, and Show all lifts the cap for that list until the page reloads. The default is 5."),
  },
  {
    item: "20 auto-hide", view: "settings",
    from: "data-act=\"auto-hide\" checked></div><p class=\"tfcc-note\">Only thread links in this panel do this, and only a plain click. Opening a link in a new tab, or following links on the Torn page itself, leaves the panel as it is. Press Show to bring it back.</p>",
    to: "data-act=\"auto-hide\" checked>"
      + INFO("settings-autohide", "About hiding the panel")
      + "</div>"
      + HID("settings-autohide", "Only thread links in this panel do this, and only a plain click. Opening a link in a new tab, or following links on the Torn page itself, leaves the panel as it is. Press Show to bring it back."),
  },
  {
    item: "21 folders", view: "settings",
    from: "<div class=\"tfcc-section\"><h4>Folders</h4><p class=\"tfcc-note\">A folder can claim a forum, and new subscriptions from that forum file themselves into it. Filing a thread by hand always wins over a rule.</p>",
    to: "<div class=\"tfcc-section\"><div class=\"tfcc-infobar\"><h4>Folders</h4>"
      + INFO("settings-folders", "About folders")
      + "</div>"
      + HID("settings-folders", "A folder can claim a forum, and new subscriptions from that forum file themselves into it. Filing a thread by hand always wins over a rule."),
  },
  {
    item: "23 backup", view: "settings",
    from: "<p class=\"tfcc-note\">An export carries folders, tags, pins, priorities, notes, read markers drafts and badges. It never carries your API key or the post cache.</p>",
    to: "<p class=\"tfcc-note\">Never includes your API key or the post cache.</p>",
  },
  {
    item: "25 debug", view: "settings",
    from: "<p class=\"tfcc-note\">A debug report carries the script version, the transport in use, counts and the last error. It never carries your key, your drafts, your notes or any post text.</p>",
    to: "<p class=\"tfcc-note\">Never includes your key, drafts, notes or post text.</p>",
  },
  {
    item: "26 badges", view: "settings",
    from: "<p class=\"tfcc-note\">Earned from what you do here: focused visits to threads, finishing Torn days with Catch up empty, and organising. A visit counts once a Torn day, after 15 seconds with the page in front of you. A day is a Torn day, from 00:00 TCT. Nothing is sent anywhere, and no request is made. Turning this off stops recording, and a streak does not survive days with it off.</p>",
    to: "<div class=\"tfcc-infobar\"><span class=\"tfcc-note\">Recorded on this device only. No request is made.</span>"
      + INFO("settings-badges", "About badges")
      + "</div>"
      + HID("settings-badges", "Earned from what you do here: focused visits to threads, finishing Torn days with Catch up empty, and organising. A visit counts once a Torn day, after 15 seconds with the page in front of you. A day is a Torn day, from 00:00 TCT. Nothing is sent anywhere, and no request is made. Turning this off stops recording, and a streak does not survive days with it off."),
  },
];
```

- [ ] **Step 11: Run, full suite, commit**

Run: `node --test tests/info.test.js tests/style.test.js tests/panel.test.js tests/handlers.test.js tests/custom-key.test.js tests/rows-cap.test.js tests/auto-hide.test.js tests/read-only.test.js tests/wide-parity.test.js && npm test && npm run test:syntax`
Expected: PASS. The handler pairing test now sees `info` both rendered and handled, and the parity test sees every wide byte change accounted for by one 13d entry.

```bash
git add torn-forum-command-center.user.js tests/load-userscript.js tests/info.test.js tests/style.test.js tests/panel.test.js tests/custom-key.test.js tests/wide-13d-diffs.js
git commit -m "feat: info buttons replace standing explanations at every size (#33)"
```

---

### Task 9: The narrow header and `fitHeader`

**Files:**
- Modify: `torn-forum-command-center.user.js`: `renderBadgeChip`; new `renderHeadNarrow` after `renderHeadId`; `panelHtml`; new `fitHeader` after `watchPanelWidth`; `onPanelWidth`; `draw`; `panelStyleText`
- Modify: `tests/load-userscript.js` (`EXPORT_NAMES`)
- Create: `tests/narrow-view.test.js`
- Modify: `tests/narrow-runtime.test.js`, `tests/style.test.js`

**Interfaces:**
- Consumes: `headerButtonSize`, `HB_*`, `glyph`, `state.narrow`.
- Produces: `renderHeadNarrow(model)`; `fitHeader(panel, win) -> number|null` (the size it set); CSS custom property `--tfcc-hb` on `#tfcc-panel` (default `44px` in the token block); chip class `tfcc-compact`.

- [ ] **Step 1: Export**

Append `'renderHeadNarrow', 'fitHeader',` to the `// #33` block in `EXPORT_NAMES`.

- [ ] **Step 2: Write the failing view tests**

Create `tests/narrow-view.test.js`:

```js
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { NOW, bootNarrow, seedRows, visible } = require('./narrow-helpers');

function headOf(html) {
  const i = html.indexOf('<div class="tfcc-head">');
  return html.slice(i, html.indexOf('</div></div>', i) + 12);
}

// ---- header (spec 4.1, 13a, 13b) ---------------------------------------------

test('the narrow header is three named icon buttons, in order, on the existing actions', () => {
  const { api } = bootNarrow();
  seedRows(api, [{ id: 1, unread: 16 }]);
  const head = headOf(api.panelHtml(api.buildPanelModel(NOW)));
  const acts = Array.from(head.matchAll(/<button[^>]*data-act="([a-z-]+)"/g), (m) => m[1]);
  assert.deepStrictEqual(acts.slice(-3), ['refresh', 'takeover', 'collapse']);
  assert.match(head, /class="tfcc-hbtn" data-act="refresh" aria-label="Refresh"/);
  assert.match(head, /data-act="takeover" aria-pressed="false" aria-label="Expand"/);
  assert.match(head, /data-act="collapse" aria-label="Hide the panel"/);
  assert.doesNotMatch(head, /subscribed/, '"6 subscribed" moves to the Threads cell\'s name');
  assert.doesNotMatch(head, /16 new/, 'the unread count is the Threads numeral while expanded');
  assert.doesNotMatch(head, />Refresh</, 'icons, not text');
});

test('collapsed, Show is visible text and the count is a bare "16" named "16 new"', () => {
  const { api } = bootNarrow();
  seedRows(api, [{ id: 1, unread: 16 }]);
  api.state.settings.collapsed = true;
  const head = headOf(api.panelHtml(api.buildPanelModel(NOW)));
  assert.match(head, /<button type="button" class="tfcc-hshow" data-act="collapse">.*<span>Show<\/span><\/button>/);
  assert.match(head, /<span class="tfcc-badge tfcc-hcount"><span aria-hidden="true">16<\/span><span class="tfcc-sr">16 new<\/span><\/span>/);
  assert.doesNotMatch(visible(head), /16 new/, 'sighted users see "16" only');
});

test('in author-only mode the collapsed count is named "new by author"', () => {
  const { api } = bootNarrow();
  const head = api.renderHeadNarrow({ narrow: true, collapsed: true, authorOnly: true,
    totals: { unread: 3, unchecked: 0 }, badges: { enabled: false } });
  assert.match(head, /<span aria-hidden="true">3<\/span><span class="tfcc-sr">3 new by author<\/span>/);
});

test('Expand reads Shrink, pressed, in takeover; Refresh says when it is busy', () => {
  const { api } = bootNarrow();
  api.state.settings.takeover = true;
  api.state.refreshing = true;
  const head = headOf(api.panelHtml(api.buildPanelModel(NOW)));
  assert.match(head, /data-act="takeover" aria-pressed="true" aria-label="Shrink"/);
  assert.match(head, /data-act="refresh" aria-label="Refreshing" aria-busy="true"/);
});

test('the loading and error states use the narrow header, without controls', () => {
  const { api } = bootNarrow();
  for (const html of [api.panelHtml(api.loadingModel(NOW)), api.panelHtml(api.errorModel('x', 'broken', NOW))]) {
    assert.match(html, /^<div class="tfcc-head"><div class="tfcc-head-id"><svg class="tfcc-logo"/);
    assert.match(html, /<span class="tfcc-pill">/, 'the chip has its narrow box');
    assert.doesNotMatch(html, /tfcc-hbtn|tfcc-hshow/);
  }
});

test('the narrow chip wraps its pill in a span, so the 44px box and the 28px pill are separate', () => {
  const { api } = bootNarrow();
  const html = api.panelHtml(api.buildPanelModel(NOW));
  assert.match(html, /<button type="button" class="tfcc-chip" data-act="badges-shelf"[^>]*><span class="tfcc-pill">/);
});
```

Append to `tests/narrow-runtime.test.js`:

```js
// ---- fitHeader (spec 13b) -----------------------------------------------------

// The chip measures 72px normal and 58px compact (spec 13b). The Show button's
// width follows the size, because its padding is clamp(4px, 0.2 x hb, 10px) on
// each side: 13b's own figure of 65px at a 24px size gives 55.4 + 0.4 x hb.
function fitEnv(width, collapsed) {
  let panel = null;
  const hbNow = () => parseFloat(panel.style.getPropertyValue('--tfcc-hb')) || 44;
  const measure = (n) => {
    if (n.classList.contains('tfcc-chip')) return n.classList.contains('tfcc-compact') ? 58 : 72;
    if (n.classList.contains('tfcc-hshow')) return 55.4 + 0.4 * hbNow();
    return 0;
  };
  const { env, api } = bootNarrow({ width, env: { measure, gmStore: collapsed
    ? [['tfcc:settings', JSON.stringify({ v: 1, collapsed: true })]] : [] } });
  panel = panelOf(env);
  redraw(env);
  return { env, api, hb: () => panel.style.getPropertyValue('--tfcc-hb') };
}

test('fitHeader sizes the header buttons from the panel\'s own width', () => {
  assert.strictEqual(fitEnv(343).hb(), '44px', '375px phone');
  assert.strictEqual(fitEnv(288).hb(), '41.5px', '320px phone');
});

test('below 36px the chip goes compact and the solve runs again', () => {
  const { env, hb } = fitEnv(248);
  assert.strictEqual(hb(), '35px');
  assert.strictEqual(panelOf(env).querySelector('.tfcc-chip').classList.contains('tfcc-compact'), true);
  const roomy = fitEnv(343);
  assert.strictEqual(panelOf(roomy.env).querySelector('.tfcc-chip').classList.contains('tfcc-compact'), false);
});

test('collapsed, the Show label is part of the solve, measured again at the size it gets', () => {
  // 320 collapsed: Show at 44px is 73px, the first solve goes compact at 36,
  // Show re-measured at 36 is 69.8px, and the second solve gives 37. 280
  // collapsed lands half a step above the floor. Spec 13b is amended to match.
  assert.strictEqual(fitEnv(288, true).hb(), '37px');
  assert.strictEqual(fitEnv(248, true).hb(), '24.5px');
});

test('the loading header has no buttons to fit, so it keeps the full size', () => {
  const { env, api } = bootNarrow({ width: 288 });
  const panel = panelOf(env);
  panel.innerHTML = api.panelHtml(api.loadingModel(NOW));
  assert.strictEqual(api.fitHeader(panel, env.win), 44);
});

test('a wide panel carries no header size at all', () => {
  const { hb } = fitEnv(900, [72, 58], 0);
  assert.strictEqual(hb(), '');
});

test('fitHeader reads nothing outside the panel and never throws', () => {
  const { env, api } = bootNarrow({ width: 343 });
  assert.strictEqual(api.fitHeader(null, env.win), null);
  assert.doesNotThrow(() => api.fitHeader({ querySelector() { throw new Error('x'); } }, env.win));
});
```

- [ ] **Step 3: Run to verify failure**

Run: `node --test tests/narrow-view.test.js tests/narrow-runtime.test.js`
Expected: FAIL: the header is the wide one, and `--tfcc-hb` is never set.

> Amended during implementation: `tests/narrow-runtime.test.js` also gains "a crossing redraws once; inside the band nothing redraws; while typing it defers", the `renderCount`/`pendingRedraw` assertions moved here from Task 6.

- [ ] **Step 4: The chip's pill**

In `renderBadgeChip(model)`, replace the final `return` with:

```js
    // #33: narrow, the button is as tall as the header buttons and the pill
    // you see is a child span at most 28px tall (spec 4.1), so nothing overlaps.
    var inner = model.narrow ? '<span class="tfcc-pill">' + parts.join('') + '</span>' : parts.join('');
    return '<button type="button" class="tfcc-chip" data-act="badges-shelf" aria-expanded="'
      + (b.shelfOpen ? 'true' : 'false') + '" aria-label="' + escapeHtml(label) + '">'
      + inner + '</button>';
```

- [ ] **Step 5: `renderHeadNarrow`**

After `function renderHeadId(`'s closing `}`, add:

```js
  // The narrow header (spec 4.1, 13a, 13b): logo, chip and, when collapsed, a
  // bare unread count, then Refresh, Expand/Shrink and Hide as icon buttons
  // that fitHeader sizes. Collapsed, the third button is the visible word Show.
  // withControls false is the loading and error header: logo and chip only.
  function renderHeadNarrow(model, withControls) {
    if (withControls === false) {
      return '<div class="tfcc-head"><div class="tfcc-head-id">' + LOGO_SVG + renderBadgeChip(model) + '</div></div>';
    }
    var count = '';
    if (model.collapsed && model.totals && model.totals.unread > 0) {
      var n = formatCount(model.totals.unread);
      var said = n + (model.authorOnly ? ' new by author' : ' new');
      // aria-label on a plain span is not reliably read, so the name is a
      // visually hidden span beside an aria-hidden numeral (spec 13a).
      count = '<span class="tfcc-badge tfcc-hcount"><span aria-hidden="true">' + escapeHtml(n) + '</span>'
        + '<span class="tfcc-sr">' + escapeHtml(said) + '</span></span>';
    }
    var out = ['<div class="tfcc-head">'];
    out.push('<div class="tfcc-head-id">' + LOGO_SVG + renderBadgeChip(model) + count + '</div>');
    out.push('<div class="tfcc-head-ctl"><span class="tfcc-head-btns">');
    out.push('<button type="button" class="tfcc-hbtn" data-act="refresh" aria-label="'
      + (model.refreshing ? 'Refreshing" aria-busy="true"' : 'Refresh"') + '>' + glyph('refresh') + '</button>');
    out.push('<button type="button" class="tfcc-hbtn" data-act="takeover" aria-pressed="'
      + (model.takeover ? 'true' : 'false') + '" aria-label="' + (model.takeover ? 'Shrink' : 'Expand') + '">'
      + glyph(model.takeover ? 'shrink' : 'expand') + '</button>');
    if (model.collapsed) {
      out.push('<button type="button" class="tfcc-hshow" data-act="collapse">' + glyph('down') + '<span>Show</span></button>');
    } else {
      out.push('<button type="button" class="tfcc-hbtn" data-act="collapse" aria-label="Hide the panel">'
        + glyph('up') + '</button>');
    }
    out.push('</span></div></div>');
    // Spec 13d item 33: a live status, kept, on its own line so the header
    // stays one line.
    if (model.authorOnly && model.totals && model.totals.unchecked > 0) {
      out.push('<p class="tfcc-note">' + model.totals.unchecked + ' not checked</p>');
    }
    return out.join('');
  }
```

- [ ] **Step 6: Branch in `panelHtml`**

In `panelHtml(model)`, the loading and fatal early returns get the narrow header too, without controls (main's loading and fatal headers have none; fatal keeps its own Try again). Replace

```js
    if (model.loading) {
      return '<div class="tfcc-head">' + renderHeadId(model) + '</div>'
        + '<div class="tfcc-empty">Loading your subscribed threads...</div>';
    }
    if (model.fatal) {
      return '<div class="tfcc-head">' + renderHeadId(model) + '</div>'
```

with

```js
    // #33: a narrow loading or error state gets the narrow header (scaled
    // logo, the chip's 44px box), with no controls, as on main.
    var bareHead = model.narrow ? renderHeadNarrow(model, false) : '<div class="tfcc-head">' + renderHeadId(model) + '</div>';
    if (model.loading) {
      return bareHead
        + '<div class="tfcc-empty">Loading your subscribed threads...</div>';
    }
    if (model.fatal) {
      return bareHead
```

Then replace the block from `out.push('<div class="tfcc-head">');` through `out.push('</span></div></div>');` with:

```js
    if (model.narrow) {
      out.push(renderHeadNarrow(model));
    } else {
      out.push('<div class="tfcc-head">');
      out.push(renderHeadId(model));
      out.push('<div class="tfcc-head-ctl">');
      if (model.totals.unread > 0) {
        out.push('<span class="tfcc-badge">' + formatCount(model.totals.unread)
          + (model.authorOnly ? ' new by author' : ' new') + '</span>');
      }
      if (model.authorOnly && model.totals.unchecked > 0) {
        out.push('<span class="tfcc-note">' + model.totals.unchecked + ' not checked</span>');
      }
      out.push('<span class="tfcc-note">' + model.totals.subscribed + ' subscribed</span>');
      out.push('<span class="tfcc-head-btns">');
      out.push(btn('refresh', model.refreshing ? 'Refreshing...' : 'Refresh'));
      out.push('<button type="button" data-act="takeover" aria-pressed="'
        + (model.takeover ? 'true' : 'false') + '">' + (model.takeover ? 'Shrink' : 'Expand') + '</button>');
      out.push(btn('collapse', model.collapsed ? 'Show' : 'Hide'));
      out.push('</span></div></div>');
    }
```

(The wide branch is the old code verbatim; `tests/wide-parity.test.js` proves it.)

- [ ] **Step 7: `fitHeader`**

After `function watchPanelWidth(`'s closing `}`, add:

```js
  function setHeaderSize(panel, size) {
    if (!panel.style || typeof panel.style.setProperty !== 'function') return;
    if (size === null) panel.style.removeProperty('--tfcc-hb');
    else panel.style.setProperty('--tfcc-hb', size + 'px');
  }

  // Sizes the narrow header buttons so the header stays on one line (spec
  // 13b). Reads only nodes inside this script's panel: its content width, the
  // chip and the Show button. Returns the size it set, or null.
  function fitHeader(panel, win) {
    try {
      if (!panel) return null;
      if (!state.narrow) { setHeaderSize(panel, null); return null; }
      var cs = win && typeof win.getComputedStyle === 'function' ? win.getComputedStyle(panel) : null;
      var pad = cs ? (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0) : 0;
      var content = (panel.clientWidth || 0) - pad;
      if (!(content > 0)) return null;
      var chip = panel.querySelector('.tfcc-chip');
      var show = panel.querySelector('.tfcc-hshow');
      // The loading and error headers have no buttons: nothing to fit.
      if (!show && !panel.querySelector('.tfcc-hbtn')) { setHeaderSize(panel, HB_MAX); return HB_MAX; }
      var icons = show ? 2 : 3;
      var width = function (el) {
        var r = el && typeof el.getBoundingClientRect === 'function' ? el.getBoundingClientRect() : null;
        return r && typeof r.width === 'number' ? r.width : 0;
      };
      if (chip && chip.classList) chip.classList.remove('tfcc-compact');
      setHeaderSize(panel, HB_MAX);
      var r = headerButtonSize(content, width(chip), width(show), icons);
      if (r.size < HB_COMPACT_BELOW && chip && chip.classList) {
        chip.classList.add('tfcc-compact');
        r = headerButtonSize(content, width(chip), width(show), icons);
      }
      setHeaderSize(panel, r.size);
      // Show's padding follows the size, so measure it once more at that size.
      if (show) { r = headerButtonSize(content, width(chip), width(show), icons); setHeaderSize(panel, r.size); }
      return r.size;
    } catch (e) {
      return null;
    }
  }
```

In `onPanelWidth`, replace its body's `if (next === state.narrow) return;` with:

```js
    if (next === state.narrow) { fitHeader(panel, win); return; }
```

and add `fitHeader(panel, win);` as the last line of the function (after `draw(doc, win, handlers);`).

In `draw(doc, win, handlers, force)`, after the `renderPanel(...)` call, add:

```js
    // The chip's width changes with its counts and Show replaces Hide, so the
    // header is re-fitted after every draw, not only on resize.
    fitHeader(doc.getElementById(PANEL_ID), win);
```

- [ ] **Step 8: The stylesheet**

In the `#tfcc-panel {` token block, after `'  --tfcc-started: #ff8080;',` add:

```js
      // #33: the narrow header button size; fitHeader overrides it inline.
      '  --tfcc-hb: 44px;',
```

After the `[hidden]`/info rules from Task 8, add:

```js
      // Narrow only: the collapsed count's name, the view heading and the live
      // region all render in the narrow layout alone.
      '#' + PANEL_ID + '.tfcc-narrow .tfcc-sr { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px;',
      '  overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0; }',
      // ---- #33 narrow layout. Every rule below hangs off .tfcc-narrow, so a
      // wide panel never sees one. ----
      '#' + PANEL_ID + '.tfcc-narrow { padding: 8px; }',
      // The header: one line. These gaps add up to HB_GAPS (20): logo-chip 6,
      // group 6, and 2 x 4 between the buttons.
      '#' + PANEL_ID + '.tfcc-narrow .tfcc-head { gap: 6px; flex-wrap: nowrap; margin-bottom: 6px; }',
      '#' + PANEL_ID + '.tfcc-narrow .tfcc-head-id { flex: 0 1 auto; flex-wrap: wrap; gap: 6px; min-width: 0; }',
      '#' + PANEL_ID + '.tfcc-narrow .tfcc-head-ctl { flex: none; flex-wrap: nowrap; gap: 0; }',
      '#' + PANEL_ID + '.tfcc-narrow .tfcc-head-btns { gap: 4px; }',
      '#' + PANEL_ID + '.tfcc-narrow .tfcc-logo { height: clamp(16px, calc(var(--tfcc-hb) * 0.545), 24px); }',
      '#' + PANEL_ID + '.tfcc-narrow button.tfcc-hbtn { display: inline-flex; align-items: center;',
      '  justify-content: center; width: var(--tfcc-hb); min-width: var(--tfcc-hb); min-height: var(--tfcc-hb); padding: 0; }',
      '#' + PANEL_ID + '.tfcc-narrow .tfcc-hbtn .tfcc-gl { width: clamp(14px, calc(var(--tfcc-hb) * 0.45), 20px);',
      '  height: auto; }',
      '#' + PANEL_ID + '.tfcc-narrow button.tfcc-hshow { display: inline-flex; align-items: center; gap: 2px;',
      '  min-width: var(--tfcc-hb); min-height: var(--tfcc-hb); font-weight: bold;',
      '  padding: 0 clamp(4px, calc(var(--tfcc-hb) * 0.2), 10px); }',
      '#' + PANEL_ID + '.tfcc-narrow button.tfcc-chip { min-width: 0; min-height: var(--tfcc-hb); padding: 0;',
      '  border: 0; border-radius: 0; background: transparent; }',
      '#' + PANEL_ID + '.tfcc-narrow .tfcc-pill { display: inline-flex; align-items: center; gap: 3px;',
      '  white-space: nowrap; min-height: min(28px, var(--tfcc-hb)); padding: 2px 8px; border-radius: 14px;',
      '  border: 1px solid var(--tm-border-2); background: var(--tm-bg-3); }',
      '#' + PANEL_ID + '.tfcc-narrow .tfcc-chip.tfcc-compact .tfcc-pill { padding: 1px 4px; gap: 1px; }',
```

Append to `tests/style.test.js`:

```js
test('the narrow header gaps add up to HB_GAPS, which the header maths assumes (#33)', () => {
  const gap = (sel) => Number((/gap: (\d+)px/.exec(blockFor(sel)) || [])[1]);
  const head = gap('#tfcc-panel.tfcc-narrow .tfcc-head');
  const id = gap('#tfcc-panel.tfcc-narrow .tfcc-head-id');
  const btns = gap('#tfcc-panel.tfcc-narrow .tfcc-head-btns');
  assert.strictEqual(id + head + 2 * btns, api.HB_GAPS);
  assert.match(blockFor('#tfcc-panel.tfcc-narrow .tfcc-head'), /flex-wrap: nowrap/);
  assert.match(blockFor('#tfcc-panel.tfcc-narrow .tfcc-head-ctl'), /flex: none/, 'the buttons never shrink or wrap');
  assert.match(blockFor('#tfcc-panel.tfcc-narrow button.tfcc-hbtn'), /width: var\(--tfcc-hb\)/);
  assert.match(blockFor('#tfcc-panel.tfcc-narrow .tfcc-logo'), /clamp\(16px, calc\(var\(--tfcc-hb\) \* 0\.545\), 24px\)/);
  assert.match(blockFor('#tfcc-panel.tfcc-narrow .tfcc-pill'), /min-height: min\(28px, var\(--tfcc-hb\)\)/);
});
```

- [ ] **Step 9: Run, full suite, commit**

Run: `node --test tests/narrow-view.test.js tests/narrow-runtime.test.js tests/style.test.js tests/wide-parity.test.js && npm test && npm run test:syntax`
Expected: PASS.

```bash
git add torn-forum-command-center.user.js tests/load-userscript.js tests/narrow-view.test.js tests/narrow-runtime.test.js tests/style.test.js
git commit -m "feat: one-line narrow header with icon buttons that scale to the width (#33)"
```

---

### Task 10: The narrow nav grid, the v1 numerals, and the reactions line in My posts

**Files:**
- Modify: `torn-forum-command-center.user.js`: `renderNav`; new `navNumeral`, `renderNavNarrow` after it; `renderMineView`; `panelStyleText`
- Modify: `tests/load-userscript.js` (`EXPORT_NAMES`)
- Test: `tests/narrow-view.test.js`, `tests/style.test.js`

**Interfaces:**
- Produces: `renderNavNarrow(model)`, `navNumeral(n) -> string`; tokens `--tfcc-navnum-opacity`, `--tfcc-navnum-opacity-selected`, `--tfcc-navlab-opacity`, `--tfcc-navlab-opacity-selected`, `--tfcc-navnum-size`.

- [ ] **Step 1: Export**

Append `'renderNavNarrow', 'navNumeral',` to the `// #33` block in `EXPORT_NAMES`.

- [ ] **Step 2: Write the failing tests**

Append to `tests/narrow-view.test.js`:

```js
// ---- nav (spec 4.2, 13f) -----------------------------------------------------

function navOf(html) {
  const i = html.indexOf('<div class="tfcc-nav tfcc-navgrid">');
  return i === -1 ? '' : html.slice(i, html.indexOf('</div>', i));
}

test('the narrow nav is all six views in VIEWS order, with no More and no pill', () => {
  const { api } = bootNarrow({ env: { gmStore: [['tfcc:key', 'abcdefghij123456']] } });
  seedRows(api, [{ id: 1, unread: 16 }]);
  const nav = navOf(api.panelHtml(api.buildPanelModel(NOW)));
  const views = Array.from(nav.matchAll(/data-view="([a-z]+)"/g), (m) => m[1]);
  assert.deepStrictEqual(views, ['threads', 'catchup', 'search', 'drafts', 'settings', 'mine']);
  assert.doesNotMatch(nav, /tfcc-reactions/, 'the pill moves to the top of My posts');
  assert.match(nav, /data-view="mine" class="tfcc-nav-mine"/);
});

test('counts are decorative numerals behind one-line labels, carried in each cell\'s name', () => {
  const { api } = bootNarrow();
  seedRows(api, [{ id: 1, unread: 10 }, { id: 2, unread: 6 }]);
  const nav = navOf(api.panelHtml(api.buildPanelModel(NOW)));
  const model = api.buildPanelModel(NOW);
  assert.match(nav, new RegExp('data-view="threads" aria-pressed="true" aria-label="Threads, 16 new, '
    + model.totals.subscribed + ' subscribed"><span class="tfcc-navnum" aria-hidden="true">16</span>'
    + '<span class="tfcc-navlab">Threads</span></button>'));
  assert.match(nav, new RegExp('aria-label="Catch up, ' + model.catchUp.length + '"'));
  assert.match(nav, /aria-label="Drafts, none"><span class="tfcc-navlab">Drafts<\/span>/, 'zero draws no numeral');
  assert.match(nav, /data-view="search" aria-pressed="false"><span class="tfcc-navlab">Search<\/span>/);
  assert.match(nav, /data-view="settings" aria-pressed="false"><span class="tfcc-navlab">Settings<\/span>/);
});

test('a count over 999 shows as 999+', () => {
  const { api } = bootNarrow();
  assert.strictEqual(api.navNumeral(999), '999');
  assert.strictEqual(api.navNumeral(1000), '999+');
  assert.strictEqual(api.navNumeral(128), '128');
});

test('narrow My posts opens with the reaction totals, before the status line', () => {
  const { api } = bootNarrow({ env: { gmStore: [['tfcc:key', 'abcdefghij123456']] } });
  api.state.mine = api.setKarma(api.freshMine(), 1208, NOW);
  api.state.settings.view = 'mine';
  const html = api.panelHtml(api.buildPanelModel(NOW));
  const rx = html.indexOf('<div class="tfcc-rxline"><button type="button" class="tfcc-reactions');
  assert.ok(rx !== -1, 'the pill markup, reused');
  assert.ok(rx < html.indexOf('<div class="tfcc-infobar">'), 'it is the first line of the view');
});
```

Append to `tests/style.test.js`:

```js
test('the v1 nav tokens are the owner\'s values (#33, spec 13f)', () => {
  const block = blockFor('#tfcc-panel');
  for (const [k, v] of [['--tfcc-navnum-opacity', '0.14'], ['--tfcc-navnum-opacity-selected', '0.09'],
    ['--tfcc-navlab-opacity', '0.9'], ['--tfcc-navlab-opacity-selected', '0.96'], ['--tfcc-navnum-size', '40px']]) {
    assert.ok(block.includes(k + ': ' + v + ';'), k);
  }
});

test('every nav label stays at 4.5:1 over the numeral painted on its cell, in both themes (#33)', () => {
  // The same composite the mockup's in-page script measures: the numeral is
  // the cell's text colour at the numeral opacity over the cell; the label is
  // the text colour at the label opacity over that numeral.
  const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const toHex = (c) => '#' + c.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
  const mix = (fg, bg, a) => fg.map((v, i) => v * a + bg[i] * (1 - a));
  const op = (name) => Number(new RegExp(name + ':\\s*([0-9.]+);').exec(blockFor('#tfcc-panel'))[1]);
  const dark = blockFor('#tfcc-panel');
  const light = blockFor('#tfcc-panel.tfcc-theme-light');
  const t = (block, name) => tokenValue(block, name);
  const states = [];
  for (const [theme, block] of [['dark', dark], ['light', light]]) {
    states.push([theme + ' default', t(block, '--tm-text'), t(block, '--tm-bg-3'), false]);
    states.push([theme + ' selected', t(block, '--tm-text'), t(block, '--tm-good-bg'), true]);
    states.push([theme + ' My posts', t(block, '--tfcc-mine-text'), t(block, '--tfcc-mine-bg'), false]);
    states.push([theme + ' My posts selected', t(block, '--tfcc-mine-text'), t(block, '--tfcc-mine-pressed'), true]);
  }
  for (const [label, text, cell, selected] of states) {
    const num = mix(hex(text), hex(cell), op(selected ? '--tfcc-navnum-opacity-selected' : '--tfcc-navnum-opacity'));
    const lab = mix(hex(text), num, op(selected ? '--tfcc-navlab-opacity-selected' : '--tfcc-navlab-opacity'));
    const r = ratio(toHex(lab), toHex(num));
    assert.ok(r >= 4.5, label + ': label over numeral is ' + r.toFixed(2) + ':1');
  }
});

test('the numeral takes its colour from the cell and has no outline (#33)', () => {
  const num = blockFor('#tfcc-panel.tfcc-narrow .tfcc-navnum');
  assert.doesNotMatch(num, /(^|[^-])color\s*:/, 'no colour of its own: currentColor is the cell\'s text');
  assert.doesNotMatch(css, /-webkit-text-stroke/, 'an outline is how v2 vanished');
  assert.match(num, /opacity: var\(--tfcc-navnum-opacity\)/);
  assert.match(blockFor('#tfcc-panel.tfcc-narrow .tfcc-navgrid button[aria-pressed="true"] .tfcc-navnum'),
    /opacity: var\(--tfcc-navnum-opacity-selected\)/);
  assert.match(blockFor('#tfcc-panel.tfcc-narrow .tfcc-navlab'), /white-space: nowrap/, 'a label never wraps');
});
```

- [ ] **Step 3: Run to verify failure**

Run: `node --test tests/narrow-view.test.js tests/style.test.js`
Expected: FAIL: no `tfcc-navgrid`, no tokens.

- [ ] **Step 4: Implement the nav**

At the top of `renderNav(model)`'s body, add `if (model.narrow) return renderNavNarrow(model);`. After `renderNav`'s closing `}`, add:

```js
  function navNumeral(n) {
    var v = toInt(n, 0);
    return v > 999 ? '999+' : String(v);
  }

  // The narrow nav (spec 4.2, 13f): a 3 x 2 grid in VIEWS order. A count is a
  // large decorative numeral behind a one-line label; the number reaches
  // screen readers through the cell's own name. Zero draws no numeral.
  function renderNavNarrow(model) {
    var t = model.totals || { unread: 0, subscribed: 0, drafts: 0 };
    var counts = {
      threads: t.unread, catchup: model.catchUp ? model.catchUp.length : 0,
      drafts: t.drafts, mine: model.mine ? model.mine.unread : 0,
    };
    var names = {
      threads: 'Threads, ' + (t.unread ? formatCount(t.unread) + (model.authorOnly ? ' new by author' : ' new') : 'none new')
        + ', ' + t.subscribed + ' subscribed',
      catchup: 'Catch up, ' + (counts.catchup || 'none'),
      drafts: 'Drafts, ' + (counts.drafts || 'none'),
      mine: 'My posts, ' + (counts.mine ? counts.mine + ' new' : 'none new'),
    };
    var out = ['<div class="tfcc-nav tfcc-navgrid">'];
    for (var i = 0; i < VIEWS.length; i += 1) {
      var v = VIEWS[i];
      var n = toInt(counts[v], 0);
      out.push('<button type="button" data-act="view" data-view="' + v + '"'
        + (v === 'mine' ? ' class="tfcc-nav-mine"' : '')
        + ' aria-pressed="' + (model.view === v ? 'true' : 'false') + '"'
        + (names[v] ? ' aria-label="' + escapeHtml(names[v]) + '"' : '') + '>'
        + (n > 0 ? '<span class="tfcc-navnum" aria-hidden="true">' + navNumeral(n) + '</span>' : '')
        + '<span class="tfcc-navlab">' + escapeHtml(VIEW_LABELS[v]) + '</span></button>');
    }
    out.push('</div>');
    return out.join('');
  }
```

At the top of `renderMineView(model)`, after `var out = [];`, add:

```js
    // #33 (spec 13c): narrow, the reaction totals are the first line of My
    // posts, in the existing pill markup. Wide, the pill stays in the nav.
    if (model.narrow) {
      var rx = renderReactions(model);
      if (rx) out.push('<div class="tfcc-rxline">' + rx + '</div>');
    }
```

- [ ] **Step 5: The stylesheet**

In the `#tfcc-panel {` token block, after `'  --tfcc-hb: 44px;',` add:

```js
      // #33 nav numerals, v1 tint (spec 13f). The same in both themes, because
      // the colour is the cell's own text colour. contrast is in style.test.js.
      '  --tfcc-navnum-opacity: 0.14; --tfcc-navnum-opacity-selected: 0.09;',
      '  --tfcc-navlab-opacity: 0.9; --tfcc-navlab-opacity-selected: 0.96; --tfcc-navnum-size: 40px;',
```

After the narrow header rules, add:

```js
      '#' + PANEL_ID + '.tfcc-narrow .tfcc-navgrid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr));',
      '  gap: 6px; margin-bottom: 6px; }',
      '#' + PANEL_ID + '.tfcc-narrow .tfcc-navgrid button { position: relative; overflow: hidden; display: flex;',
      '  align-items: center; justify-content: center; min-width: 44px; min-height: 44px; padding: 2px 4px;',
      '  font-weight: bold; }',
      // My posts sits in its grid cell; the wide auto margin would push it out.
      '#' + PANEL_ID + '.tfcc-narrow .tfcc-navgrid button.tfcc-nav-mine { margin-left: 0; }',
      '#' + PANEL_ID + '.tfcc-narrow .tfcc-navnum { position: absolute; inset: 0; display: flex; align-items: center;',
      '  justify-content: center; font-size: var(--tfcc-navnum-size); line-height: 1;',
      '  font-variant-numeric: tabular-nums; opacity: var(--tfcc-navnum-opacity); }',
      '#' + PANEL_ID + '.tfcc-narrow .tfcc-navlab { position: relative; max-width: 100%; white-space: nowrap;',
      '  overflow: hidden; text-overflow: ellipsis; opacity: var(--tfcc-navlab-opacity); }',
      '#' + PANEL_ID + '.tfcc-narrow .tfcc-navgrid button[aria-pressed="true"] { box-shadow: inset 0 -3px 0 currentColor; }',
      '#' + PANEL_ID + '.tfcc-narrow .tfcc-navgrid button[aria-pressed="true"] .tfcc-navnum {',
      '  opacity: var(--tfcc-navnum-opacity-selected); }',
      '#' + PANEL_ID + '.tfcc-narrow .tfcc-navgrid button[aria-pressed="true"] .tfcc-navlab {',
      '  opacity: var(--tfcc-navlab-opacity-selected); }',
      '#' + PANEL_ID + '.tfcc-narrow .tfcc-rxline { margin-bottom: 6px; }',
      '#' + PANEL_ID + '.tfcc-narrow .tfcc-rxline button.tfcc-reactions { width: 100%; min-width: 44px;',
      '  min-height: 44px; border-radius: 4px; padding: 0 10px; }',
```

The two `blockFor` lookups in the new style tests use the selector text before ` {`; the multi-line rules above put ` {` at the end of their first line, which is what `blockFor` searches for.

- [ ] **Step 6: Run, full suite, commit**

Run: `node --test tests/narrow-view.test.js tests/style.test.js tests/wide-parity.test.js tests/badges-runtime.test.js && npm test && npm run test:syntax`
Expected: PASS. The wide nav and its pill are byte-identical (parity).

```bash
git add torn-forum-command-center.user.js tests/load-userscript.js tests/narrow-view.test.js tests/style.test.js
git commit -m "feat: narrow 3x2 nav with v1 numerals and reactions atop My posts (#33)"
```

---

### Task 11: The narrow filter line and the Filters disclosure

**Files:**
- Modify: `torn-forum-command-center.user.js`: `renderListBar` (split out the three selects); new `renderSortSelect`, `renderFolderFilterSelect`, `renderTagFilterSelect`, `renderListBarNarrow`; `buildPanelModel` (`activeFilters`); `makeHandlers` (`filters`); `panelStyleText`
- Modify: `tests/load-userscript.js`, `tests/handlers.test.js`
- Test: `tests/narrow-view.test.js`, `tests/narrow-state.test.js`

**Interfaces:**
- Consumes: `activeFilterCount`, `model.filtersOpen`, `applyTransient`.
- Produces: `model.activeFilters`; action `filters`; region `#tfcc-filters`.

- [ ] **Step 1: Export**

Append `'renderListBarNarrow',` to the `// #33` block in `EXPORT_NAMES`.

- [ ] **Step 2: Make the handler pairing test render narrow too**

In `tests/handlers.test.js`, inside `renderedActions()`, replace

```js
  const actions = new Set();
  for (const view of api.VIEWS) {
    for (const replyBox of [true, false]) {
      api.state.settings.view = view;
      api.state.replyBoxFound = replyBox;
      api.state.searchResults = { mode: 'deep', query: 'thread', posts: [{ threadId: '1', threadTitle: 'Thread 1', postId: 9, authorName: 'x', at: NOW, text: 'cached body' }] };
      const html = api.panelHtml(api.buildPanelModel(NOW));
      const re = /data-act="([a-z-]+)"/g;
      let m;
      while ((m = re.exec(html))) actions.add(m[1]);
    }
  }
```

with

```js
  const actions = new Set();
  // #33: the narrow layout renders controls the wide one does not (filters,
  // row-more, the drawer), so every view is rendered both ways, with a drawer
  // and the filters open.
  for (const narrow of [false, true]) {
    api.state.narrow = narrow;
    for (const view of api.VIEWS) {
      for (const replyBox of [true, false]) {
        api.state.settings.view = view;
        api.state.replyBoxFound = replyBox;
        api.state.searchResults = { mode: 'deep', query: 'thread', posts: [{ threadId: '1', threadTitle: 'Thread 1', postId: 9, authorName: 'x', at: NOW, text: 'cached body' }] };
        let model = api.buildPanelModel(NOW);
        if (narrow && model.renderedIds.length) {
          api.state.openRowId = model.renderedIds[0];
          api.state.filtersOpen = true;
          model = api.buildPanelModel(NOW);
        }
        const html = api.panelHtml(model);
        const re = /data-act="([a-z-]+)"/g;
        let m;
        while ((m = re.exec(html))) actions.add(m[1]);
      }
    }
  }
  api.state.narrow = false;
```

and directly before `api.state.settings.collapsed = true;` add nothing else. After the existing collapsed block, add:

```js
  api.state.narrow = true;
  const collapsedNarrow = api.panelHtml(api.buildPanelModel(NOW));
  const re3 = /data-act="([a-z-]+)"/g;
  let m3;
  while ((m3 = re3.exec(collapsedNarrow))) actions.add(m3[1]);
  api.state.narrow = false;
```

- [ ] **Step 3: Write the failing tests**

Append to `tests/narrow-view.test.js`:

```js
// ---- filter line (spec 4.3) --------------------------------------------------

test('the narrow filter line is the field, Unread and a named Filters button', () => {
  const { api } = bootNarrow();
  seedRows(api, [{ id: 1, unread: 1 }]);
  const html = api.panelHtml(api.buildPanelModel(NOW));
  assert.match(html, /<div class="tfcc-bar tfcc-filterline"><input class="tfcc-grow" type="search" data-act="filter"/);
  assert.match(html, /data-act="unread-only" aria-pressed="false">Unread<\/button>/);
  assert.match(html, /data-act="filters" aria-expanded="false" aria-controls="tfcc-filters" aria-label="Filters, 0 active">/);
  assert.match(html, /<div class="tfcc-filtergrid" id="tfcc-filters" hidden><select data-act="sort" aria-label="Sort">/);
  assert.match(html, /<select data-act="folder-filter" aria-label="Folder filter">/);
});

test('the Filters button counts and shows the active filters', () => {
  const { api } = bootNarrow();
  seedRows(api, [{ id: 1, unread: 1 }]);
  api.state.organizer = api.toggleTag(api.state.organizer, '1', 'x');
  api.recompute(NOW);
  api.state.settings.folderFilter = 'guides';
  api.state.settings.tagFilter = 'x';
  const html = api.panelHtml(api.buildPanelModel(NOW));
  assert.match(html, /aria-label="Filters, 2 active">.*<span>2<\/span><\/button>/);
});

test('open, the filter grid is visible and Filters says so', () => {
  const { api } = bootNarrow();
  seedRows(api, [{ id: 1, unread: 1 }]);
  api.state.filtersOpen = true;
  const html = api.panelHtml(api.buildPanelModel(NOW));
  assert.match(html, /data-act="filters" aria-expanded="true"/);
  assert.match(html, /<div class="tfcc-filtergrid" id="tfcc-filters">/);
});
```

Append to `tests/narrow-state.test.js`:

```js
test('Filters toggles through the real click, and a view change closes it', () => {
  const { env, api } = bootNarrow();
  seedRows(api, SIX);
  api.state.settings.view = 'threads';
  redraw(env);
  require('./narrow-helpers').click(env, '[data-act="filters"]');
  assert.strictEqual(api.state.filtersOpen, true);
  require('./narrow-helpers').click(env, '[data-act="view"][data-view="mine"]');
  assert.strictEqual(api.state.filtersOpen, false);
});
```

- [ ] **Step 4: Run to verify failure**

Run: `node --test tests/narrow-view.test.js tests/narrow-state.test.js tests/handlers.test.js`
Expected: FAIL: no filter line; the pairing test may pass or fail at this point depending on order, which is fine until Step 7.

- [ ] **Step 5: Split the selects out of `renderListBar`**

Replace the whole of `function renderListBar(model) { ... }` with:

```js
  // extra goes on the select element; the wide bar passes '' so its markup is
  // unchanged (tests/wide-parity.test.js).
  function renderSortSelect(model, extra) {
    var out = ['<select data-act="sort"' + extra + '>'];
    for (var i = 0; i < SORT_MODES.length; i += 1) {
      out.push('<option value="' + SORT_MODES[i] + '"'
        + (model.sort === SORT_MODES[i] ? ' selected' : '') + '>'
        + escapeHtml(SORT_LABELS[SORT_MODES[i]]) + '</option>');
    }
    out.push('</select>');
    return out.join('');
  }

  function renderFolderFilterSelect(model, extra) {
    var out = ['<select data-act="folder-filter"' + extra + '><option value="">All folders</option>'];
    for (var f = 0; f < model.folders.length; f += 1) {
      out.push('<option value="' + escapeHtml(model.folders[f].id) + '"'
        + (model.folderFilter === model.folders[f].id ? ' selected' : '') + '>'
        + escapeHtml(model.folders[f].name) + '</option>');
    }
    out.push('</select>');
    return out.join('');
  }

  function renderTagFilterSelect(model, extra) {
    if (!model.tags.length) return '';
    var out = ['<select data-act="tag-filter"' + extra + '><option value="">All tags</option>'];
    for (var t = 0; t < model.tags.length; t += 1) {
      out.push('<option value="' + escapeHtml(model.tags[t].tag) + '"'
        + (model.tagFilter === model.tags[t].tag ? ' selected' : '') + '>'
        + escapeHtml(model.tags[t].tag + ' (' + model.tags[t].count + ')') + '</option>');
    }
    out.push('</select>');
    return out.join('');
  }

  // The filter bar Threads and My posts share.
  function renderListBar(model) {
    if (model.narrow) return renderListBarNarrow(model);
    var out = ['<div class="tfcc-bar">'];
    out.push('<input class="tfcc-grow" type="search" data-act="filter" value="'
      + escapeHtml(model.searchQuery) + '" placeholder="filter: words, by:player, tag:x, is:unread">');
    out.push(renderSortSelect(model, ''));
    out.push(renderFolderFilterSelect(model, ''));
    out.push(renderTagFilterSelect(model, ''));
    out.push('<button type="button" data-act="unread-only" aria-pressed="'
      + (model.unreadOnly ? 'true' : 'false') + '">Unread only</button>');
    out.push('</div>');
    return out.join('');
  }

  // The narrow filter line (spec 4.3): the field, Unread and Filters on one
  // line; Sort, Folder and Tag one tap away. The grid is always in the markup
  // so aria-controls names a real element.
  function renderListBarNarrow(model) {
    var active = toInt(model.activeFilters, 0);
    var out = ['<div class="tfcc-bar tfcc-filterline">'];
    out.push('<input class="tfcc-grow" type="search" data-act="filter" value="' + escapeHtml(model.searchQuery)
      + '" placeholder="filter: words, by:player, tag:x" aria-label="Filter threads">');
    out.push('<button type="button" data-act="unread-only" aria-pressed="'
      + (model.unreadOnly ? 'true' : 'false') + '">Unread</button>');
    out.push('<button type="button" data-act="filters" aria-expanded="' + (model.filtersOpen ? 'true' : 'false')
      + '" aria-controls="tfcc-filters" aria-label="' + escapeHtml('Filters, ' + active + ' active') + '">'
      + glyph('funnel') + (active ? '<span>' + active + '</span>' : '') + '</button>');
    out.push('</div>');
    out.push('<div class="tfcc-filtergrid" id="tfcc-filters"' + (model.filtersOpen ? '' : ' hidden') + '>'
      + renderSortSelect(model, ' aria-label="Sort"')
      + renderFolderFilterSelect(model, ' aria-label="Folder filter"')
      + renderTagFilterSelect(model, ' aria-label="Tag filter"') + '</div>');
    return out.join('');
  }
```

In `buildPanelModel`'s returned object, after `drawerEdit: state.drawerEdit,` add `activeFilters: activeFilterCount(s),`.

- [ ] **Step 6: The handler**

In `onAction`, directly after the `info` case, add:

```js
        if (act === 'filters') { applyTransient({ type: 'filters' }); redraw(); return; }
```

- [ ] **Step 7: The stylesheet**

After the narrow nav rules, add:

```js
      '#' + PANEL_ID + '.tfcc-narrow .tfcc-filterline { flex-wrap: wrap; gap: 6px; margin-bottom: 6px; }',
      '#' + PANEL_ID + '.tfcc-narrow .tfcc-filterline .tfcc-grow { flex: 1 1 8em; }',
      '#' + PANEL_ID + '.tfcc-narrow .tfcc-filterline button { display: inline-flex; align-items: center;',
      '  justify-content: center; gap: 4px; min-width: 44px; min-height: 44px; padding: 0 8px; white-space: nowrap; }',
      '#' + PANEL_ID + '.tfcc-narrow .tfcc-filtergrid { display: grid;',
      '  grid-template-columns: repeat(auto-fit, minmax(8em, 1fr)); gap: 6px; margin: 0 0 6px 0; }',
```

- [ ] **Step 8: Run, full suite, commit**

Run: `node --test tests/narrow-view.test.js tests/narrow-state.test.js tests/handlers.test.js tests/wide-parity.test.js && npm test && npm run test:syntax`
Expected: PASS, including the pairing test (`filters` rendered and handled).

```bash
git add torn-forum-command-center.user.js tests/load-userscript.js tests/handlers.test.js tests/narrow-view.test.js tests/narrow-state.test.js
git commit -m "feat: narrow filter line with a Filters disclosure (#33)"
```

---

### Task 12: Narrow rows, the one-tap Read, the Actions drawer and the view heading

**Files:**
- Modify: `torn-forum-command-center.user.js`: `renderRow` (split out `rowStatusHtml`, `rowMetaHtml`, `folderSelectHtml`); new `rowHtml`, `readButton`, `renderDrawer`, `renderRowNarrow`, `renderViewHeading`; `renderThreadsView`, `renderCatchUpView`, `renderSearchView` (use `rowHtml`; narrow Catch up drops the bar's "Since"); `panelHtml` (heading); `renderPanel` (an `input` listener); `makeHandlers` (`row-more`, `onInput`, commits clear `drawerEdit`); `panelStyleText`
- Modify: `tests/load-userscript.js`, `tests/auto-hide.test.js`
- Test: `tests/narrow-view.test.js`, `tests/narrow-state.test.js`

**Interfaces:**
- Consumes: `model.openRowId`, `model.drawerEdit`, `model.view`, `glyph`, `VIEW_HEADING_ID`, `applyTransient`.
- Produces: `rowHtml(row, model)`; `renderRowNarrow(row, model)`; `renderViewHeading(model)`; action `row-more`; `handlers.onInput(act, el)` mirroring `note-input`/`tag-input` into `state.drawerEdit`; element ids `tfcc-title-<id>`, `tfcc-act-<id>`, `tfcc-vh`.

- [ ] **Step 1: Export**

Append `'rowHtml', 'renderRowNarrow', 'renderViewHeading',` to the `// #33` block in `EXPORT_NAMES`.

- [ ] **Step 2: Write the failing tests**

Append to `tests/narrow-view.test.js`:

```js
// ---- rows (spec 4.4, 13e) ----------------------------------------------------

function rowOf(html, id) {
  const i = html.indexOf('<div class="tfcc-row" data-id="' + id + '">');
  assert.ok(i !== -1, 'row ' + id + ' rendered');
  const next = html.indexOf('<div class="tfcc-row" data-id=', i + 10);
  return html.slice(i, next === -1 ? undefined : next);
}

test('a narrow row gives the title the whole width, with unread and buttons on line 2', () => {
  const { api } = bootNarrow();
  seedRows(api, [{ id: 7, title: 'A practical education guide', unread: 3 }]);
  api.state.organizer = api.setPriority(api.state.organizer, '7', 2);
  api.recompute(NOW);
  const row = rowOf(api.panelHtml(api.buildPanelModel(NOW)), '7');
  assert.match(row, /<div class="tfcc-row-t"><span class="tfcc-row-title"><a id="tfcc-title-7" href="[^"]+" data-tfcc-thread="7">A practical education guide<\/a><\/span><\/div>/);
  assert.match(row, /<div class="tfcc-row-l2"><div class="tfcc-meta"><span class="tfcc-unread">3 new<\/span><span class="tfcc-prio">\+2<\/span>/,
    'unread first, then the priority in the meta');
  assert.doesNotMatch(row, /data-act="prio-up"/, 'no inline +/- outside the drawer');
});

test('priority shows in the meta only when it is not zero', () => {
  const { api } = bootNarrow();
  seedRows(api, [{ id: 7, unread: 1 }]);
  assert.doesNotMatch(rowOf(api.panelHtml(api.buildPanelModel(NOW)), '7'), /tfcc-prio/);
});

test('Catch up rows carry a one-tap Read: a check mark named Mark read, described by the title', () => {
  const { api } = bootNarrow();
  seedRows(api, [{ id: 7, unread: 3 }]);
  api.state.settings.view = 'catchup';
  const row = rowOf(api.panelHtml(api.buildPanelModel(NOW)), '7');
  assert.match(row, /<button type="button" class="tfcc-read" data-act="read" data-id="7" aria-label="Mark read" aria-describedby="tfcc-title-7"><svg class="tfcc-gl"[^>]*><path d="[^"]+"\/><\/svg><\/button>/,
    'the check mark alone, no text');
  assert.ok(row.indexOf('data-act="read"') < row.indexOf('data-act="row-more"'), 'DOM order: Read, then Actions');
});

test('Read is visible only in narrow Catch up', () => {
  const { api } = bootNarrow();
  seedRows(api, [{ id: 7, unread: 3 }]);
  api.state.settings.view = 'threads';
  assert.doesNotMatch(rowOf(api.panelHtml(api.buildPanelModel(NOW)), '7'), /class="tfcc-read"/);
  api.state.narrow = false;
  api.state.settings.view = 'catchup';
  assert.doesNotMatch(api.panelHtml(api.buildPanelModel(NOW)), /class="tfcc-read"/, 'wide keeps its action row');
});

test('every narrow row has an Actions button that controls an always-present, empty, hidden drawer', () => {
  const { api } = bootNarrow();
  seedRows(api, [{ id: 7, title: 'Seven', unread: 1 }]);
  const row = rowOf(api.panelHtml(api.buildPanelModel(NOW)), '7');
  assert.match(row, /data-act="row-more" data-id="7" aria-expanded="false" aria-controls="tfcc-act-7" aria-label="Actions for Seven">/);
  assert.match(row, /<div class="tfcc-drawer" id="tfcc-act-7" hidden><\/div>/);
});

test('an open drawer holds every row action at 44px, in the spec order', () => {
  const { api } = bootNarrow();
  seedRows(api, [{ id: 7, unread: 1 }]);
  api.state.openRowId = '7';
  const row = rowOf(api.panelHtml(api.buildPanelModel(NOW)), '7');
  assert.match(row, /data-act="row-more" data-id="7" aria-expanded="true"/);
  const acts = Array.from(row.slice(row.indexOf('tfcc-drawer')).matchAll(/data-act="([a-z-]+)"/g), (m) => m[1]);
  assert.deepStrictEqual(acts, ['pin', 'read', 'draft', 'archive', 'prio-down', 'prio-up', 'folder', 'tag-input', 'note-input']);
});

test('in Catch up the drawer leaves out Mark read, which is already on the row', () => {
  const { api } = bootNarrow();
  seedRows(api, [{ id: 7, unread: 1 }]);
  api.state.settings.view = 'catchup';
  api.state.openRowId = '7';
  const row = rowOf(api.panelHtml(api.buildPanelModel(NOW)), '7');
  assert.strictEqual((row.match(/data-act="read"/g) || []).length, 1);
});

test('only one drawer is open at a time', () => {
  const { api } = bootNarrow();
  seedRows(api, [{ id: 7, unread: 1 }, { id: 8, unread: 1 }]);
  api.state.openRowId = '8';
  const html = api.panelHtml(api.buildPanelModel(NOW));
  assert.strictEqual((html.match(/aria-expanded="true" aria-controls="tfcc-act-/g) || []).length, 1);
  assert.match(html, /id="tfcc-act-7" hidden><\/div>/);
});

test('the narrow view heading is visible in Catch up with its date, and hidden elsewhere', () => {
  const { api } = bootNarrow();
  api.state.settings.view = 'catchup';
  let html = api.panelHtml(api.buildPanelModel(NOW));
  assert.match(html, /<h3 class="tfcc-vh" id="tfcc-vh" tabindex="-1">Catch up <span class="tfcc-note">since [^<]+<\/span><\/h3>/);
  assert.doesNotMatch(html, /<span class="tfcc-note">Since /, 'the bar no longer repeats it');
  api.state.settings.view = 'threads';
  html = api.panelHtml(api.buildPanelModel(NOW));
  assert.match(html, /<h3 class="tfcc-vh tfcc-sr" id="tfcc-vh" tabindex="-1">Threads<\/h3>/);
});

test('a drawer edit mirror renders the typed value instead of the stored one', () => {
  const { api } = bootNarrow();
  seedRows(api, [{ id: 7, unread: 1 }]);
  api.state.openRowId = '7';
  api.state.drawerEdit = { id: '7', field: 'note-input', value: 'half typed', selStart: 4, selEnd: 4 };
  assert.match(api.panelHtml(api.buildPanelModel(NOW)), /data-act="note-input" data-id="7" value="half typed"/);
});
```

Append to `tests/narrow-state.test.js`:

```js
// ---- rows of the table that need the Actions markup (Task 12) ---------------

const { click } = require('./narrow-helpers');

test('Actions on A opens A and keeps the filters; again closes it', () => {
  const { env, api } = bootNarrow();
  seedRows(api, SIX);
  api.state.settings.view = 'threads';
  api.state.filtersOpen = true;
  redraw(env);
  click(env, '[data-act="row-more"][data-id="2"]');
  assert.strictEqual(api.state.openRowId, '2');
  assert.strictEqual(api.state.filtersOpen, true);
  click(env, '[data-act="row-more"][data-id="2"]');
  assert.strictEqual(api.state.openRowId, null);
});

test('Actions on B while A is open moves the drawer to B', () => {
  const { env, api } = bootNarrow();
  seedRows(api, SIX);
  redraw(env);
  click(env, '[data-act="row-more"][data-id="2"]');
  click(env, '[data-act="row-more"][data-id="3"]');
  assert.strictEqual(api.state.openRowId, '3');
});

test('Pin and priority keep the drawer open wherever the row moves', () => {
  const { env, api } = bootNarrow();
  seedRows(api, SIX);
  api.state.settings.sort = 'priority';
  redraw(env);
  click(env, '[data-act="row-more"][data-id="5"]');
  click(env, '[data-act="prio-up"][data-id="5"]');
  assert.strictEqual(api.state.openRowId, '5');
  click(env, '[data-act="pin"][data-id="5"]');
  assert.strictEqual(api.state.openRowId, '5');
});

test('Mark read in Threads keeps the row and its drawer', () => {
  const { env, api } = bootNarrow();
  seedRows(api, SIX);
  api.state.settings.view = 'threads';
  redraw(env);
  click(env, '[data-act="row-more"][data-id="4"]');
  click(env, '[data-act="read"][data-id="4"]');
  assert.strictEqual(api.state.openRowId, '4');
});

test('Archive closes the drawer of the row it removes', () => {
  const { env, api } = bootNarrow();
  seedRows(api, SIX);
  redraw(env);
  click(env, '[data-act="row-more"][data-id="4"]');
  // An archived thread with new posts stays listed, so read it first.
  click(env, '[data-act="read"][data-id="4"]');
  click(env, '[data-act="archive"][data-id="4"]');
  redraw(env);
  assert.strictEqual(api.state.openRowId, null);
});

test('Actions for a row that is not rendered is reconciled closed', () => {
  const { env, api } = bootNarrow();
  seedRows(api, SIX);
  api.makeHandlers(env.doc, env.win).onAction('row-more', { getAttribute: (k) => (k === 'data-id' ? '999' : 'row-more') });
  assert.strictEqual(api.state.openRowId, null, 'the redraw reconciled the forged id away');
});

test('an uncommitted edit outlives its drawer, and its commit clears it', () => {
  const { env, api } = bootNarrow();
  seedRows(api, SIX);
  redraw(env);
  click(env, '[data-act="row-more"][data-id="2"]');
  api.state.drawerEdit = { id: '2', field: 'note-input', value: 'unsaved', selStart: 7, selEnd: 7 };
  click(env, '[data-act="row-more"][data-id="2"]');
  assert.strictEqual(api.state.drawerEdit.value, 'unsaved', 'closed without a commit: still held');
  click(env, '[data-act="row-more"][data-id="2"]');
  assert.match(env.doc.getElementById('tfcc-panel').innerHTML, /data-act="note-input" data-id="2" value="unsaved"/,
    'reopened, the field shows what was typed');
  api.makeHandlers(env.doc, env.win).onChange('note-input',
    { getAttribute: (k) => (k === 'data-id' ? '2' : 'note-input'), value: 'unsaved' });
  assert.strictEqual(api.state.drawerEdit, null);
  assert.strictEqual(api.state.organizer.threads['2'].note, 'unsaved');
});

test('the wide row shows an uncommitted edit too, so crossing the breakpoint keeps it on screen', () => {
  const { api } = bootNarrow({ width: 900 });
  seedRows(api, SIX);
  api.state.drawerEdit = { id: '2', field: 'tag-input', value: 'half', selStart: 4, selEnd: 4 };
  const html = api.panelHtml(api.buildPanelModel(NOW));
  assert.match(html, /data-act="tag-input" data-id="2" value="half" placeholder="add tag" size="8">/);
});
```

Append to `tests/auto-hide.test.js`:

```js
test('Read and Actions are not thread links, so they never auto-hide (#33)', () => {
  const env = loaded({ autoHideOnOpen: true });
  const panel = panelOf(env);
  const row = env.makeElement('div');
  row.parentNode = panel;
  for (const act of ['row-more', 'read']) {
    const b = env.makeElement('button');
    b.setAttribute('data-act', act);
    b.setAttribute('data-id', '5');
    b.parentNode = row;
    assert.strictEqual(env.exports.threadLinkOf(b, panel), null, act);
    panel.dispatchEvent(click(b));
  }
  assert.notStrictEqual(storedSettings(env).collapsed, true);
});
```

- [ ] **Step 3: Run to verify failure**

Run: `node --test tests/narrow-view.test.js tests/narrow-state.test.js tests/auto-hide.test.js`
Expected: FAIL: rows render wide.

> Amended during implementation: the Archive test reads the row first, for the same `viewRows` reason as in Task 7.

- [ ] **Step 4: Split `renderRow` without changing its output**

In `renderRow(row, model)`:
1. Move the code from `// Author-only mode (issue #4) never shows Torn's any-poster count, and an` through the `if (row.isLocked) out.push('<span class="tfcc-note">locked</span>');` line into a new function placed just before `renderRow`:

```js
  // The unread count and the per-row status notes. Shared by the wide row
  // (on the title line) and the narrow row (first in the meta).
  function rowStatusHtml(row) {
    var out = [];
    // ... the moved lines, unchanged ...
    return out.join('');
  }
```

and put `out.push(rowStatusHtml(row));` where they were.

2. Move the lines between `out.push('<div class="tfcc-meta">');` and the matching `out.push('</div>');` (from `// "started" is red (#30)...` through the tags `for` loop) into:

```js
  function rowMetaHtml(row, model) {
    var out = [];
    // ... the moved lines, unchanged ...
    return out.join('');
  }
```

and replace the three statements with `out.push('<div class="tfcc-meta">' + rowMetaHtml(row, model) + '</div>');`.

3. Move the folder `<select>` lines into:

```js
  function folderSelectHtml(row, model, extra) {
    var out = ['<select data-act="folder" data-id="' + escapeHtml(row.id) + '"' + extra + '>'];
    out.push('<option value="">Unfiled</option>');
    for (var f = 0; f < model.folders.length; f += 1) {
      var fo = model.folders[f];
      out.push('<option value="' + escapeHtml(fo.id) + '"'
        + (row.folderId === fo.id ? ' selected' : '') + '>' + escapeHtml(fo.name) + '</option>');
    }
    out.push('</select>');
    return out.join('');
  }
```

and use `out.push(folderSelectHtml(row, model, ''));` in `renderRow`.

4. The wide row's two text fields show an uncommitted edit (`state.drawerEdit`) when one exists for them, so a value typed in a narrow drawer stays on screen after a rotation to wide. With no edit the markup is byte-identical. In `renderRow`, before `out.push('<div class="tfcc-actions">');`, add:

```js
    // #33: an uncommitted edit is shown wherever its field renders.
    var edit = model.drawerEdit && model.drawerEdit.id === String(row.id) ? model.drawerEdit : null;
```

replace `+ '" placeholder="add tag" size="8">');` with `+ '"' + (edit && edit.field === 'tag-input' ? ' value="' + escapeHtml(edit.value) + '"' : '') + ' placeholder="add tag" size="8">');`, and replace `+ '" value="' + escapeHtml(row.note) + '" placeholder="note" size="14">');` with `+ '" value="' + escapeHtml(edit && edit.field === 'note-input' ? edit.value : row.note) + '" placeholder="note" size="14">');`.

Run `node --test tests/wide-parity.test.js` now. Expected: PASS. If it fails, the split changed a byte; fix it before going on.

- [ ] **Step 5: Add the narrow row**

After `renderRow`, add:

```js
  // The one row renderer the views call (#33).
  function rowHtml(row, model) {
    return model.narrow ? renderRowNarrow(row, model) : renderRow(row, model);
  }

  // Mark read as a check mark (spec 13e): named "Mark read", and described by
  // the row's title so a screen reader hears which thread.
  function readButton(row) {
    var id = escapeHtml(row.id);
    return '<button type="button" class="tfcc-read" data-act="read" data-id="' + id + '" aria-label="Mark read"'
      + ' aria-describedby="tfcc-title-' + id + '">' + glyph('check') + '</button>';
  }

  // The drawer's controls (spec 4.4): the same data-act values as the wide
  // action row, each at least 44px. Mark read is left out in Catch up, where
  // the row already shows it.
  function renderDrawer(row, model, inCatchUp) {
    var id = ' data-id="' + escapeHtml(row.id) + '"';
    var edit = model.drawerEdit && model.drawerEdit.id === String(row.id) ? model.drawerEdit : null;
    var p = toInt(row.priority, 0);
    var out = [];
    out.push(btn('pin', row.pinned ? 'Unpin' : 'Pin', id));
    if (!inCatchUp) out.push(readButton(row));
    out.push(btn('draft', row.hasDraft ? 'Edit draft' : 'Draft', id));
    out.push(btn('archive', row.archived ? 'Unarchive' : 'Archive', id));
    out.push('<div class="tfcc-step tfcc-wide">'
      + btn('prio-down', '-', id + ' aria-label="Lower priority"')
      + '<span>Priority ' + escapeHtml((p > 0 ? '+' : '') + p) + '</span>'
      + btn('prio-up', '+', id + ' aria-label="Raise priority"') + '</div>');
    out.push(folderSelectHtml(row, model, ' class="tfcc-wide" aria-label="Folder"'));
    out.push('<input type="text" data-act="tag-input"' + id + ' value="'
      + escapeHtml(edit && edit.field === 'tag-input' ? edit.value : '') + '" placeholder="add tag" aria-label="Add tag">');
    out.push('<input type="text" data-act="note-input"' + id + ' value="'
      + escapeHtml(edit && edit.field === 'note-input' ? edit.value : row.note) + '" placeholder="note" aria-label="Note">');
    return out.join('');
  }

  // The narrow row (spec 4.4): the title as a full-width block link, then the
  // meta with the buttons on the right, then the note and the drawer. Read and
  // Actions are siblings of the title span, never inside the marked anchor, so
  // #8's auto-hide never sees them.
  function renderRowNarrow(row, model) {
    var id = escapeHtml(row.id);
    var open = model.openRowId === String(row.id);
    var inCatchUp = model.view === 'catchup';
    var p = toInt(row.priority, 0);
    var out = ['<div class="tfcc-row" data-id="' + id + '">'];
    out.push('<div class="tfcc-row-t">');
    if (row.pinned) out.push('<span class="tfcc-pinned" title="Pinned">*</span>');
    out.push('<span class="tfcc-row-title"><a id="tfcc-title-' + id + '" href="' + escapeHtml(threadUrl(row)) + '"'
      + threadLinkAttr(row.id) + '>' + escapeHtml(row.title) + '</a></span></div>');
    out.push('<div class="tfcc-row-l2"><div class="tfcc-meta">' + rowStatusHtml(row)
      + (p !== 0 ? '<span class="tfcc-prio">' + escapeHtml((p > 0 ? '+' : '') + p) + '</span>' : '')
      + rowMetaHtml(row, model) + '</div><span class="tfcc-row-btns">');
    if (inCatchUp) out.push(readButton(row));
    out.push('<button type="button" data-act="row-more" data-id="' + id + '" aria-expanded="'
      + (open ? 'true' : 'false') + '" aria-controls="tfcc-act-' + id + '" aria-label="'
      + escapeHtml('Actions for ' + row.title) + '">' + glyph('more') + '</button>');
    out.push('</span></div>');
    if (row.note) out.push('<div class="tfcc-note">' + escapeHtml(row.note) + '</div>');
    out.push('<div class="tfcc-drawer" id="tfcc-act-' + id + '"'
      + (open ? '>' + renderDrawer(row, model, inCatchUp) : ' hidden>') + '</div>');
    out.push('</div>');
    return out.join('');
  }

  // The narrow view heading (spec 6, focus rule 3): the focus fallback. Visible
  // in Catch up, where it carries the catch-up date; visually hidden elsewhere.
  function renderViewHeading(model) {
    var catchup = model.view === 'catchup';
    var since = catchup ? ' <span class="tfcc-note">since ' + escapeHtml(model.lastCatchUpAt
      ? formatAbsoluteTime(model.lastCatchUpAt) : 'your first run') + '</span>' : '';
    return '<h3 class="tfcc-vh' + (catchup ? '' : ' tfcc-sr') + '" id="' + VIEW_HEADING_ID + '" tabindex="-1">'
      + escapeHtml(VIEW_LABELS[model.view] || VIEW_LABELS.threads) + since + '</h3>';
  }
```

- [ ] **Step 6: Use `rowHtml` in the views, and add the heading**

- `renderThreadsView`: `out.push(renderRow(shown[r], model));` becomes `out.push(rowHtml(shown[r], model));`.
- `renderCatchUpView`: both `renderRow(` calls (the unchecked section and the grouped rows) become `rowHtml(`; and wrap the "Since" span: `if (!model.narrow) out.push('<span class="tfcc-note">Since ' + ... + '</span>');` (the expression inside is unchanged).
- `renderSearchView`: `out.push(renderRow(matched[i], model));` becomes `out.push(rowHtml(matched[i], model));`.
- `panelHtml`: replace `out.push(renderNav(model));` with:

```js
    out.push(renderNav(model));
    if (model.narrow) out.push(renderViewHeading(model));
```

- [ ] **Step 7: Handlers and the `input` listener**

In `onAction`, directly after the `filters` case, add:

```js
        if (act === 'row-more' && id) { applyTransient({ type: 'row-more', id: id }); redraw(); return; }
```

In `onChange`, in the `note-input` case add `state.drawerEdit = null;` before `persist('organizer');`, and in the `tag-input` case add `state.drawerEdit = null;` before `persist('organizer');`.

After the `onChange` function (before the closing `};` of `handlers`), add:

```js
      // #33: mirror a drawer field on every keystroke, without a redraw, so a
      // forced redraw before the commit renders what was typed and restores
      // the caret (spec section 6, dirty inputs rule 3).
      onInput: function (act, el) {
        if (act !== 'note-input' && act !== 'tag-input') return;
        var id = idOf(el);
        if (!id) return;
        var n = function (v) { return typeof v === 'number' && isFinite(v) ? v : null; };
        state.drawerEdit = {
          id: id, field: act, value: el && el.value !== undefined ? String(el.value) : '',
          selStart: n(el && el.selectionStart), selEnd: n(el && el.selectionEnd),
        };
      },
```

In `renderPanel`'s delegated block, after the `change` listener, add:

```js
      panel.addEventListener('input', function (ev) {
        var t = ev && ev.target;
        var act = t && t.getAttribute ? t.getAttribute('data-act') : null;
        if (!act || typeof handlers.onInput !== 'function') return;
        handlers.onInput(act, t);
      });
```

- [ ] **Step 8: The stylesheet**

After the narrow filter rules, add:

```js
      '#' + PANEL_ID + '.tfcc-narrow .tfcc-row { padding: var(--tfcc-gap-xs) var(--tfcc-gap-sm); }',
      '#' + PANEL_ID + '.tfcc-narrow .tfcc-row-t { display: flex; gap: 4px; align-items: flex-start; }',
      '#' + PANEL_ID + '.tfcc-narrow .tfcc-row-t .tfcc-row-title { line-height: 1.35; }',
      // The whole title band opens the thread: at least 24px (WCAG 2.2 AA).
      '#' + PANEL_ID + '.tfcc-narrow .tfcc-row-t .tfcc-row-title a { display: block; padding: 3px 0; min-height: 24px; }',
      '#' + PANEL_ID + '.tfcc-narrow .tfcc-row-t .tfcc-pinned { padding-top: 3px; }',
      '#' + PANEL_ID + '.tfcc-narrow .tfcc-row-l2 { display: flex; gap: 6px; align-items: flex-start; }',
      '#' + PANEL_ID + '.tfcc-narrow .tfcc-row-l2 .tfcc-meta { flex: 1 1 0; min-width: 0; margin-top: 0;',
      '  padding-top: 2px; gap: var(--tfcc-gap-sm); }',
      '#' + PANEL_ID + '.tfcc-narrow .tfcc-row-btns { flex: none; display: inline-flex; gap: 6px; }',
      '#' + PANEL_ID + '.tfcc-narrow .tfcc-row-btns button { display: inline-flex; align-items: center;',
      '  justify-content: center; min-width: 44px; min-height: 44px; padding: 0 6px; }',
      '#' + PANEL_ID + '.tfcc-narrow .tfcc-row-btns button[aria-expanded="true"] { background: var(--tm-hover); }',
      '#' + PANEL_ID + '.tfcc-narrow .tfcc-drawer { display: grid;',
      '  grid-template-columns: repeat(auto-fit, minmax(7.5em, 1fr)); gap: 6px; margin-top: 6px;',
      '  padding-top: 8px; border-top: 1px solid var(--tm-border); }',
      '#' + PANEL_ID + '.tfcc-narrow .tfcc-drawer .tfcc-wide { grid-column: 1 / -1; }',
      '#' + PANEL_ID + '.tfcc-narrow .tfcc-step { display: flex; align-items: center; gap: 6px; }',
      '#' + PANEL_ID + '.tfcc-narrow .tfcc-step span { flex: 1 1 auto; text-align: center; color: var(--tm-meta); }',
      '#' + PANEL_ID + '.tfcc-narrow .tfcc-vh { font-size: var(--tfcc-text); margin: 2px 0 6px 0; }',
```

- [ ] **Step 9: Run, full suite, commit**

Run: `node --test tests/narrow-view.test.js tests/narrow-state.test.js tests/auto-hide.test.js tests/handlers.test.js tests/wide-parity.test.js && npm test && npm run test:syntax`
Expected: PASS. The pairing test sees `row-more` rendered and handled.

```bash
git add torn-forum-command-center.user.js tests/load-userscript.js tests/narrow-view.test.js tests/narrow-state.test.js tests/auto-hide.test.js
git commit -m "feat: narrow rows with a one-tap Read in Catch up and an Actions drawer (#33)"
```

---

### Task 13: Focus restoration and the live region

**Files:**
- Modify: `torn-forum-command-center.user.js`: new `focusTargetOf`, `focusPlanFromActive`, `restoreSelection`, `restoreFocus`, `renderLive`, `announce` and var `lastRender` before `function draw(`; `draw`; `renderPanel` (click and change listeners set `state.focusIntent`); `makeHandlers` (`read`, `archive`, `markall` announce); `buildPanelModel` (`live`); `panelHtml`
- Modify: `tests/load-userscript.js`
- Create: `tests/narrow-focus.test.js`

**Interfaces:**
- Consumes: `focusPlan`, `model.renderedIds`, `catchUpRowsNow`.
- Produces: `restoreFocus(panel, plan) -> string|null` (the selector that took focus); `state.liveMessage = { text, announced }`; `model.live`; `renderLive(model)`.

- [ ] **Step 1: Export**

Append `'restoreFocus', 'renderLive', 'focusTargetOf',` to the `// #33` block in `EXPORT_NAMES`.

- [ ] **Step 2: Write the failing tests**

Create `tests/narrow-focus.test.js`:

```js
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { NOW, bootNarrow, seedRows, panelOf, redraw, click, lastFocus } = require('./narrow-helpers');

function catchUp(n) {
  const { env, api } = bootNarrow();
  seedRows(api, Array.from({ length: n }, (_, i) => ({ id: i + 1, unread: 1 })));
  api.state.settings.view = 'catchup';
  redraw(env);
  const ids = api.buildPanelModel(NOW).renderedIds;
  assert.strictEqual(ids.length, n, 'precondition: every seeded row is in Catch up');
  return { env, api, ids };
}

test('Read removes the first row: focus goes to the next row\'s Read', () => {
  const { env, ids } = catchUp(3);
  click(env, '[data-act="read"][data-id="' + ids[0] + '"]');
  assert.deepStrictEqual([lastFocus(env)['data-act'], lastFocus(env)['data-id']], ['read', ids[1]]);
});

test('Read removes a middle row: focus goes to the next row\'s Read', () => {
  const { env, ids } = catchUp(3);
  click(env, '[data-act="read"][data-id="' + ids[1] + '"]');
  assert.strictEqual(lastFocus(env)['data-id'], ids[2]);
});

test('Read removes the last row: focus goes to the previous row\'s Read', () => {
  const { env, ids } = catchUp(3);
  click(env, '[data-act="read"][data-id="' + ids[2] + '"]');
  assert.deepStrictEqual([lastFocus(env)['data-act'], lastFocus(env)['data-id']], ['read', ids[1]]);
});

test('Read removes the only row: focus goes to the view heading', () => {
  const { env, ids } = catchUp(1);
  click(env, '[data-act="read"][data-id="' + ids[0] + '"]');
  assert.strictEqual(lastFocus(env).id, 'tfcc-vh');
  assert.match(panelOf(env).innerHTML, /<h3 class="tfcc-vh" id="tfcc-vh" tabindex="-1">Catch up/);
});

test('Archive from a drawer focuses the next row\'s Actions', () => {
  const { env, api } = bootNarrow();
  seedRows(api, [{ id: 1 }, { id: 2 }, { id: 3 }]);
  api.state.settings.view = 'threads';
  api.state.settings.sort = 'title';
  redraw(env);
  click(env, '[data-act="row-more"][data-id="2"]');
  click(env, '[data-act="archive"][data-id="2"]');
  assert.deepStrictEqual([lastFocus(env)['data-act'], lastFocus(env)['data-id']], ['row-more', '3']);
});

test('Actions, a view cell, an info button and Hide keep focus on the same control', () => {
  const { env, api } = bootNarrow();
  seedRows(api, [{ id: 1, unread: 1 }]);
  api.state.settings.view = 'threads';
  redraw(env);
  click(env, '[data-act="row-more"][data-id="1"]');
  assert.deepStrictEqual([lastFocus(env)['data-act'], lastFocus(env)['data-id']], ['row-more', '1']);
  click(env, '[data-act="view"][data-view="catchup"]');
  assert.deepStrictEqual([lastFocus(env)['data-view'], lastFocus(env)['aria-pressed']], ['catchup', 'true']);
  click(env, '[data-act="info"][data-info="catchup"]');
  assert.strictEqual(lastFocus(env)['data-info'], 'catchup');
  click(env, '[data-act="collapse"]');
  assert.strictEqual(lastFocus(env).class, 'tfcc-hshow', 'the same button, which now reads Show');
});

test('a background redraw never pulls focus into the panel', () => {
  const { env, api } = bootNarrow();
  seedRows(api, [{ id: 1, unread: 1 }]);
  env.doc.activeElement = null;
  const before = env.focusLog.length;
  seedRows(api, [{ id: 1, unread: 2 }]);
  env.exports.draw(env.doc, env.win, api.makeHandlers(env.doc, env.win));
  assert.strictEqual(env.focusLog.length, before);
});

test('a background redraw that removes the focused row moves focus to its successor', () => {
  const { env, api } = bootNarrow();
  seedRows(api, [{ id: 1 }, { id: 2 }, { id: 3 }]);
  api.state.settings.view = 'threads';
  api.state.settings.sort = 'title';
  redraw(env);
  const panel = panelOf(env);
  env.doc.activeElement = panel.querySelector('[data-act="row-more"][data-id="2"]');
  panel.contains = () => true;
  seedRows(api, [{ id: 1 }, { id: 3 }]);
  env.exports.draw(env.doc, env.win, api.makeHandlers(env.doc, env.win));
  assert.deepStrictEqual([lastFocus(env)['data-act'], lastFocus(env)['data-id']], ['row-more', '3']);
});

test('Read announces once through a polite live region that survives the rewrite', () => {
  const { env, ids } = catchUp(3);
  click(env, '[data-act="read"][data-id="' + ids[0] + '"]');
  assert.match(panelOf(env).innerHTML, /<div class="tfcc-sr" role="status" aria-live="polite">Marked read\. 2 left\.<\/div>/);
  redraw(env);
  assert.doesNotMatch(panelOf(env).innerHTML, /Marked read\./, 'announced once, like the badge toast');
});

test('Archive and Mark all read announce too', () => {
  const { env, api } = bootNarrow();
  seedRows(api, [{ id: 1, unread: 1 }, { id: 2, unread: 1 }]);
  api.state.settings.view = 'catchup';
  redraw(env);
  click(env, '[data-act="markall"]');
  assert.match(panelOf(env).innerHTML, /role="status" aria-live="polite">Marked all read\.</);
  api.state.settings.view = 'threads';
  redraw(env);
  click(env, '[data-act="row-more"][data-id="1"]');
  click(env, '[data-act="archive"][data-id="1"]');
  assert.match(panelOf(env).innerHTML, /role="status" aria-live="polite">Archived\.</);
});

// ---- ADR 0001: Torn's markup is read in exactly two places ------------------

test('every document query, from bootstrap on, is a mount, reply-box or own-control selector', () => {
  // env.queryLog records from before the script runs, so an init-only query
  // is caught too. The whitelist is exact: no prefix match.
  const { env, api } = bootNarrow({ env: { resizeObserver: true } });
  seedRows(api, [{ id: 1, unread: 1 }, { id: 2, unread: 1 }]);
  api.state.settings.view = 'catchup';
  redraw(env);
  click(env, '[data-act="row-more"][data-id="1"]');
  click(env, '[data-act="read"][data-id="2"]');
  click(env, '[data-act="filters"]');
  env.resize(900);
  env.resize(300);
  api.state.settings.view = 'settings';
  redraw(env);
  click(env, '[data-act="key-save"]');
  const allowed = new Set([].concat(api.MOUNT_SELECTORS, api.REPLY_SELECTORS, [
    // valueOf() in makeHandlers reads the panel's own value-carrying controls.
    '[data-act="key-input"]', '[data-act="draft-text"]', '[data-act="import-text"]', '[data-act="folder-name"]',
  ]));
  const stray = env.queryLog.filter((s) => !allowed.has(s));
  assert.deepStrictEqual(stray, [], 'a document query outside ADR 0001\'s two places and our own controls');
  assert.ok(env.queryLog.includes(api.MOUNT_SELECTORS[0]), 'the log really did record the bootstrap');
});

test('every querySelector call site in the source is one of the known ones', () => {
  // A static audit, so a branch the runtime test never reaches is covered
  // too. document reads are the three that predate #33; #33 adds panel reads
  // only, on this script's own element.
  const src = require('./load-userscript').readSource();
  const calls = Array.from(src.matchAll(/(\w+)\.querySelector(?:All)?\(([^()]*)\)/g), (m) => m[1] + '(' + m[2] + ')');
  assert.deepStrictEqual(calls.slice().sort(), [
    'doc(MOUNT_SELECTORS[i])',
    'doc(REPLY_SELECTORS[i])',
    "doc('[data-act=\"' + act + '\"]')",
    "panel('.tfcc-chip')",
    "panel('.tfcc-hbtn')",
    "panel('.tfcc-hshow')",
    'panel(plan[i])',
  ].sort());
});
```

If the runtime test lists a selector that main already used before #33 (check with `git grep -n "<selector>" origin/main -- torn-forum-command-center.user.js`), add it to `allowed` with a comment naming the function that owns it. A selector #33 introduced is a stop condition, not a whitelist entry. If the static audit's list differs only because a call is written differently from this plan's code (for example a renamed loop variable), match the list to the code and say so in the commit message; a new receiver or a new document read is a stop condition.

Also append to `tests/narrow-focus.test.js`:

```js
// ---- focus after a text field commits (plan review) -------------------------

test('Tab from the tag field to the note field leaves focus in the note field', () => {
  const { env, api } = bootNarrow();
  seedRows(api, [{ id: 1 }, { id: 2 }]);
  api.state.settings.view = 'threads';
  api.state.settings.sort = 'title';
  redraw(env);
  click(env, '[data-act="row-more"][data-id="1"]');
  const panel = panelOf(env);
  panel.contains = () => true;
  const tag = panel.querySelector('[data-act="tag-input"][data-id="1"]');
  tag.value = 'newtag';
  env.doc.activeElement = tag;
  panel.dispatchEvent({ type: 'change', target: tag });
  // The browser moves focus after change; the redraw waits a tick for it.
  env.doc.activeElement = panel.querySelector('[data-act="note-input"][data-id="1"]');
  const before = env.focusLog.length;
  env.advanceTimersBy(0);
  assert.ok(api.state.organizer.threads['1'].tags.includes('newtag'));
  assert.ok(env.focusLog.length > before, 'focus was restored');
  assert.strictEqual(lastFocus(env)['data-act'], 'note-input', 'not pulled back into the tag field');
});

test('Tab out of the note field moves on to the next control, not back into the note', () => {
  const { env, api } = bootNarrow();
  seedRows(api, [{ id: 1 }, { id: 2 }]);
  api.state.settings.view = 'threads';
  api.state.settings.sort = 'title';
  redraw(env);
  click(env, '[data-act="row-more"][data-id="1"]');
  const panel = panelOf(env);
  panel.contains = () => true;
  const note = panel.querySelector('[data-act="note-input"][data-id="1"]');
  note.value = 'a note';
  env.doc.activeElement = note;
  panel.dispatchEvent({ type: 'change', target: note });
  env.doc.activeElement = panel.querySelector('[data-act="row-more"][data-id="2"]');
  env.advanceTimersBy(0);
  assert.strictEqual(api.state.organizer.threads['1'].note, 'a note');
  assert.deepStrictEqual([lastFocus(env)['data-act'], lastFocus(env)['data-id']], ['row-more', '2']);
});

test('Enter in the filter field keeps focus in the field', () => {
  const { env, api } = bootNarrow();
  seedRows(api, [{ id: 1, title: 'alpha' }, { id: 2, title: 'beta' }]);
  redraw(env);
  const panel = panelOf(env);
  panel.contains = () => true;
  const filter = panel.querySelector('[data-act="filter"]');
  filter.value = 'alpha';
  env.doc.activeElement = filter;
  panel.dispatchEvent({ type: 'change', target: filter });
  env.advanceTimersBy(0);
  assert.strictEqual(api.state.searchQuery, 'alpha');
  assert.strictEqual(lastFocus(env)['data-act'], 'filter');
});

test('a deferred redraw that removes a row leaves the focus bookkeeping on the rows still shown', () => {
  // The caret in row 1's note defers a background redraw that drops row 2.
  // The DOM still shows row 2, so a tap on its Actions must still find row 3
  // as its successor, not fall through to the heading.
  const { env, api } = bootNarrow();
  seedRows(api, [{ id: 1 }, { id: 2 }, { id: 3 }]);
  api.state.settings.view = 'threads';
  api.state.settings.sort = 'title';
  redraw(env);
  click(env, '[data-act="row-more"][data-id="1"]');
  const panel = panelOf(env);
  panel.contains = () => true;
  env.doc.activeElement = panel.querySelector('[data-act="note-input"][data-id="1"]');
  seedRows(api, [{ id: 1 }, { id: 3 }]);
  const before = panel.renderCount;
  env.exports.draw(env.doc, env.win, api.makeHandlers(env.doc, env.win));
  assert.strictEqual(panel.renderCount, before, 'deferred by the caret');
  click(env, '[data-act="row-more"][data-id="2"]');
  assert.deepStrictEqual([lastFocus(env)['data-act'], lastFocus(env)['data-id']], ['row-more', '3']);
});
```

- [ ] **Step 3: Run to verify failure**

Run: `node --test tests/narrow-focus.test.js`
Expected: FAIL: `focusLog` stays empty.

- [ ] **Step 4: Implement**

Immediately before `function draw(doc, win, handlers, force) {`, add:

```js
  // What the last draw rendered, for the focus plan of the next action: the
  // rows as they were BEFORE the action, so a removed row's successor is known.
  var lastRender = { ids: [], view: 'threads', narrow: false };

  function focusTargetOf(el) {
    var get = function (k) { return el && typeof el.getAttribute === 'function' ? el.getAttribute(k) : null; };
    return { act: get('data-act'), id: get('data-id'), view: get('data-view'), info: get('data-info') };
  }

  // A background redraw restores focus only if it was already inside the
  // panel (spec section 6, focus rule 4): it never pulls focus in.
  function focusPlanFromActive(doc) {
    try {
      var active = doc.activeElement;
      var panel = doc.getElementById(PANEL_ID);
      if (!active || !panel || typeof panel.contains !== 'function' || !panel.contains(active)) return null;
      return focusPlan(focusTargetOf(active), lastRender);
    } catch (e) {
      return null;
    }
  }

  function restoreSelection(el) {
    var d = state.drawerEdit;
    if (!d || typeof el.setSelectionRange !== 'function' || typeof el.getAttribute !== 'function') return;
    if (el.getAttribute('data-act') !== d.field || el.getAttribute('data-id') !== d.id) return;
    if (d.selStart === null || d.selEnd === null) return;
    try { el.setSelectionRange(d.selStart, d.selEnd); } catch (e) { /* not a text field */ }
  }

  // Tries each selector of the plan inside the panel, in order. Our own nodes
  // only; the selectors use the grammar in the plan's Global Constraints.
  function restoreFocus(panel, plan) {
    if (!panel || !plan || typeof panel.querySelector !== 'function') return null;
    for (var i = 0; i < plan.length; i += 1) {
      var el = null;
      try { el = panel.querySelector(plan[i]); } catch (e) { el = null; }
      if (el && typeof el.focus === 'function') {
        try { el.focus({ preventScroll: true }); } catch (e2) {
          try { el.focus(); } catch (e3) { continue; }
        }
        restoreSelection(el);
        return plan[i];
      }
    }
    return null;
  }

  function announce(text) { state.liveMessage = { text: text, announced: false }; }

  // One polite live region, rendered with the panel and announced once, the
  // way the badge toast's role="status" is (spec section 6, focus rule 5).
  // Narrow only, like the rest of the section 6 machinery: desktop markup
  // stays main's.
  function renderLive(model) {
    if (!model.narrow) return '';
    if (!model.live) return '';
    return '<div class="tfcc-sr" role="status" aria-live="polite">' + escapeHtml(model.live) + '</div>';
  }
```

Replace `draw` with:

```js
  function draw(doc, win, handlers, force) {
    var now = Date.now();
    state.route = parseForumRoute(win.location);
    state.replyBoxFound = !!findReplyBox(doc);
    attachAutosave(doc, win);
    var before = doc.getElementById(PANEL_ID);
    var htmlBefore = before ? before.__tfccHtml : undefined;
    // A user action brings its own plan; otherwise follow where focus already is.
    var plan = state.focusIntent || focusPlanFromActive(doc);
    var model = buildPanelModel(now);
    var panel = renderPanel(doc, win, model, handlers, force);
    // Only a rewrite changes what is on screen. A deferred one (a caret in the
    // panel) leaves the old rows in the DOM, so lastRender must keep
    // describing them, or the next action's neighbours would be wrong.
    var rewrote = !!panel && panel.__tfccHtml !== htmlBefore;
    if (rewrote) {
      lastRender = { ids: model.renderedIds || [], view: model.view, narrow: model.narrow === true };
      // Only a rewrite destroys the focused node; an unchanged panel keeps it.
      if (plan) restoreFocus(panel, plan);
    }
    if (state.badgeToast && !state.pendingRedraw) state.badgeToast.announced = true;
    if (state.liveMessage && !state.pendingRedraw) state.liveMessage.announced = true;
    // The chip's width changes with its counts and Show replaces Hide, so the
    // header is re-fitted after every draw, not only on resize.
    fitHeader(panel || doc.getElementById(PANEL_ID), win);
    state.mounted = true;
  }
```

(This replaces Task 9's `fitHeader(...)` line in `draw`; keep only this one.)

In `buildPanelModel`'s returned object, after `activeFilters: activeFilterCount(s),` add:

```js
      live: state.liveMessage && !state.liveMessage.announced ? state.liveMessage.text : null,
```

In `panelHtml`, after `out.push(renderBadgeToast(model));` add `out.push(renderLive(model));`.

In `renderPanel`'s `click` listener, replace

```js
        if (!act || typeof handlers.onAction !== 'function') return;
        handlers.onAction(act, t);
```

with

```js
        if (!act || typeof handlers.onAction !== 'function') return;
        // #33: the plan is captured before the action runs, from the rows the
        // user was looking at, and consumed by the action's own redraw.
        state.focusIntent = focusPlan(focusTargetOf(t), lastRender);
        try { handlers.onAction(act, t); } finally { state.focusIntent = null; }
```

and in the `change` listener replace `handlers.onChange(act, t);` with:

```js
        // A text field commits on blur, when the browser still reports it as
        // focused although focus is already on its way to the next control.
        // Its commit redraws a tick later, from wherever focus landed, and
        // never pulls focus back into the field (plan review). A select or a
        // checkbox keeps focus, so it brings its own plan.
        var text = isTextField(t);
        if (!text) state.focusIntent = focusPlan(focusTargetOf(t), lastRender);
        state.deferCommit = text;
        try { handlers.onChange(act, t); } finally { state.focusIntent = null; state.deferCommit = false; }
```

Next to `focusTargetOf`, add:

```js
  function isTextField(el) {
    var tag = el && el.tagName ? String(el.tagName).toLowerCase() : '';
    if (tag === 'textarea') return true;
    if (tag !== 'input') return false;
    var type = el.getAttribute ? String(el.getAttribute('type') || 'text').toLowerCase() : 'text';
    return type !== 'checkbox' && type !== 'radio';
  }
```

Add `deferCommit: false,` to `var state = {` next to `pressActive: false,`. In `makeHandlers`, replace `function redraw() { draw(doc, win, handlers, true); }` with:

```js
    var commitTimer = null;
    function redraw() {
      // A text field's commit (state.deferCommit, set by the change listener)
      // redraws a tick later, once focus has settled: Tab lands on the next
      // control and the redraw restores focus there; Enter leaves focus in the
      // field and the redraw restores it there.
      if (state.deferCommit) {
        state.pendingRedraw = true;
        if (commitTimer === null) {
          commitTimer = setTimeout(function () {
            commitTimer = null;
            if (state.pendingRedraw) redraw();
          }, 0);
        }
        return;
      }
      draw(doc, win, handlers, true);
    }
```

In `makeHandlers`:
- `read` case: before `redraw(); return;` add `announce('Marked read.' + (state.settings.view === 'catchup' ? ' ' + catchUpRowsNow().length + ' left.' : ''));`
- `archive` case: before `redraw(); return;` add `announce(e.archived ? 'Unarchived.' : 'Archived.');` (`e` is the entry before the toggle).
- `markall` case: before `redraw(); return;` add `announce('Marked all read.');`

Export `'MOUNT_SELECTORS'` and `'REPLY_SELECTORS'` are already in `EXPORT_NAMES`; nothing to add for them.

- [ ] **Step 5: Run, full suite, commit**

Run: `node --test tests/narrow-focus.test.js tests/redraw.test.js tests/badges-runtime.test.js tests/wide-parity.test.js && npm test && npm run test:syntax`
Expected: PASS. The wide parity golden has no live message, so it is unchanged. If a pre-existing suite dispatches a text-field `change` through the panel and reads the HTML straight away, it now needs `env.advanceTimersBy(0)` before the read (the commit redraws a tick later); change when it looks, never what it asserts.

```bash
git add torn-forum-command-center.user.js tests/load-userscript.js tests/narrow-focus.test.js
git commit -m "feat: restore focus after every redraw and announce Read and Archive (#33)"
```

---

### Task 14: Hold a redraw while a press is in progress, and keep background redraws behind the caret

**Files:**
- Modify: `torn-forum-command-center.user.js`: new `PRESS_FLUSH_MS`, `pressTimer`, `pressWinBound`, `startPress`, `armPressTimer`, `endPress`, `clearPress`, `flushAfterPress` before `function renderPanel(`; `renderPanel` (pointer listeners, the click listener, the focusout listener); `makeHandlers` (`redraw`, a new `quietRedraw`, the async completions)
- Modify: `tests/load-userscript.js`
- Create: `tests/dirty-input.test.js`

**Interfaces:**
- Produces: `PRESS_FLUSH_MS = 300`. `state.pressActive` is set on `pointerdown` in the panel and cleared by the next `click` (before its action runs), by `pointercancel`, or 300ms after the `pointerup` (on the panel or anywhere in the window) when no click followed. Nothing times out while the pointer is still down. While it is set, `makeHandlers`' `redraw()` and `quietRedraw()` only mark `state.pendingRedraw`.
- `quietRedraw()`: the redraw for work that finishes later (a refresh, My posts, deep search, a key check). It is not forced, so a caret in the panel defers it like any other background redraw.

- [ ] **Step 1: Export**

Append `'PRESS_FLUSH_MS',` to the `// #33` block in `EXPORT_NAMES`.

- [ ] **Step 2: Write the failing tests**

Create `tests/dirty-input.test.js`:

```js
'use strict';

// Spec section 6, "Dirty inputs". A tap on another control blurs a drawer
// field first; its change commits and redraws, and that redraw replaced the
// node under the finger, so the tap never arrived as a click.

const test = require('node:test');
const assert = require('node:assert');
const { NOW, bootNarrow, seedRows, panelOf, redraw, click } = require('./narrow-helpers');

function setup(extraEnv) {
  const { env, api } = bootNarrow({ env: extraEnv || {} });
  seedRows(api, [{ id: 1 }, { id: 2 }, { id: 3 }]);
  api.state.settings.view = 'threads';
  api.state.settings.sort = 'title';
  redraw(env);
  click(env, '[data-act="row-more"][data-id="1"]');
  const panel = panelOf(env);
  const note = panel.querySelector('[data-act="note-input"][data-id="1"]');
  note.value = 'typed note';
  return { env, api, panel, note };
}

// The same settle loop as tests/refresh.test.js: let promise chains and the
// timers they schedule run to the end.
async function settle(env) {
  for (let i = 0; i < 20; i += 1) {
    await new Promise((r) => setImmediate(r));
    env.runTimers();
  }
}

test('the no-click flush is 300ms, by contract', () => {
  // A literal, so changing the constant fails here (CLAUDE.md: a test must not
  // advance time by the constant it is testing).
  const { api } = bootNarrow();
  assert.strictEqual(api.PRESS_FLUSH_MS, 300);
});

test('a tap on another control while a drawer input is dirty commits and acts, in one redraw', () => {
  const { env, api, panel, note } = setup();
  const before = panel.renderCount;
  panel.dispatchEvent({ type: 'pointerdown', target: panel.querySelector('[data-act="row-more"][data-id="2"]') });
  panel.dispatchEvent({ type: 'change', target: note });
  assert.strictEqual(api.state.organizer.threads['1'].note, 'typed note', 'the change committed');
  env.advanceTimersBy(0);
  assert.strictEqual(panel.renderCount, before, 'its redraw is held while the press is in progress');
  panel.dispatchEvent({ type: 'pointerup', target: panel.querySelector('[data-act="row-more"][data-id="2"]') });
  click(env, '[data-act="row-more"][data-id="2"]');
  env.advanceTimersBy(0);
  assert.strictEqual(panel.renderCount, before + 1, 'one visible redraw for both');
  assert.strictEqual(api.state.openRowId, '2', 'the tapped action happened');
  assert.match(panel.innerHTML, /<div class="tfcc-note">typed note<\/div>/);
});

test('holding the pointer down past 300ms does not redraw; 300ms after it lifts with no click, it does', () => {
  const { env, panel, note } = setup();
  const before = panel.renderCount;
  panel.dispatchEvent({ type: 'pointerdown', target: panel });
  panel.dispatchEvent({ type: 'change', target: note });
  env.advanceTimersBy(1000);
  assert.strictEqual(panel.renderCount, before, 'a slow press keeps its target');
  panel.dispatchEvent({ type: 'pointerup', target: panel });
  env.advanceTimersBy(299);
  assert.strictEqual(panel.renderCount, before);
  env.advanceTimersBy(1);
  assert.strictEqual(panel.renderCount, before + 1);
  assert.strictEqual(env.exports.state.pressActive, false);
});

test('a pointerup outside the panel still ends the press', () => {
  const { env, panel, note } = setup();
  const before = panel.renderCount;
  panel.dispatchEvent({ type: 'pointerdown', target: panel });
  panel.dispatchEvent({ type: 'change', target: note });
  env.win.fire('pointerup', { type: 'pointerup' });
  env.advanceTimersBy(300);
  assert.strictEqual(panel.renderCount, before + 1, 'a press can never hold redraws forever');
});

test('a pointercancel flushes the held redraw', () => {
  const { env, panel, note } = setup();
  const before = panel.renderCount;
  panel.dispatchEvent({ type: 'pointerdown', target: panel });
  panel.dispatchEvent({ type: 'change', target: note });
  panel.dispatchEvent({ type: 'pointercancel', target: panel });
  env.advanceTimersBy(0);
  assert.strictEqual(panel.renderCount, before + 1);
  assert.strictEqual(env.exports.state.pressActive, false);
});

test('focus leaving the field during a press does not flush early', () => {
  const { env, panel, note } = setup();
  const before = panel.renderCount;
  panel.dispatchEvent({ type: 'pointerdown', target: panel });
  panel.dispatchEvent({ type: 'change', target: note });
  env.doc.activeElement = null;
  panel.dispatchEvent({ type: 'focusout', target: note });
  env.advanceTimersBy(0);
  assert.strictEqual(panel.renderCount, before, 'the focusout flush waits for the click');
  click(env, '[data-act="row-more"][data-id="3"]');
  env.advanceTimersBy(0);
  assert.strictEqual(panel.renderCount, before + 1);
});

test('a dirty field, then a plain thread-link tap: no redraw during the click, then one, with auto-hide', () => {
  // Redrawing while the click is being dispatched would remove the anchor
  // before the browser follows it. The thread-link branch never flushes
  // synchronously; the existing zero-delay redraw after dispatch does it.
  const { env, api, panel, note } = setup();
  api.state.settings.autoHideOnOpen = true;
  const before = panel.renderCount;
  const link = env.makeElement('a');
  link.setAttribute('data-tfcc-thread', '2');
  link.parentNode = panel;
  panel.dispatchEvent({ type: 'pointerdown', target: link });
  panel.dispatchEvent({ type: 'change', target: note });
  panel.dispatchEvent({ type: 'pointerup', target: link });
  panel.dispatchEvent({ type: 'click', target: link, button: 0, ctrlKey: false, metaKey: false,
    shiftKey: false, altKey: false, defaultPrevented: false });
  assert.strictEqual(panel.renderCount, before, 'nothing redraws inside the click');
  env.advanceTimersBy(0);
  assert.strictEqual(panel.renderCount, before + 1, 'one redraw after dispatch');
  assert.strictEqual(api.state.settings.collapsed, true, 'auto-hide still happened');
  assert.strictEqual(api.state.organizer.threads['1'].note, 'typed note', 'and the note was saved');
});

test('any redraw requested mid-press is held too', () => {
  const { env, api, panel } = setup();
  panel.dispatchEvent({ type: 'pointerdown', target: panel });
  const before = panel.renderCount;
  api.makeHandlers(env.doc, env.win).onAction('badges-shelf', { getAttribute: () => 'badges-shelf' });
  assert.strictEqual(panel.renderCount, before, 'held until the press ends');
  panel.dispatchEvent({ type: 'pointercancel', target: panel });
  assert.strictEqual(panel.renderCount, before + 1);
});

test('a forced redraw before the commit keeps what was typed and the caret', () => {
  const { env, api, panel, note } = setup();
  note.value = 'half';
  note.selectionStart = 2;
  note.selectionEnd = 3;
  panel.dispatchEvent({ type: 'input', target: note });
  assert.deepStrictEqual(api.state.drawerEdit, { id: '1', field: 'note-input', value: 'half', selStart: 2, selEnd: 3 });
  env.doc.activeElement = note;
  panel.contains = () => true;
  redraw(env);
  assert.match(panel.innerHTML, /data-act="note-input" data-id="1" value="half"/);
  const again = panel.querySelector('[data-act="note-input"][data-id="1"]');
  assert.deepStrictEqual(again.selection, [2, 3], 'the selection is restored on the new node');
});

test('typed, rotated across the breakpoint, refreshed, then blurred: the value persists', async () => {
  const { env, api, panel } = setup({ resizeObserver: true });
  const h = api.makeHandlers(env.doc, env.win);
  // The user starts a refresh, then types while it is in flight.
  h.onAction('refresh', { getAttribute: () => 'refresh' });
  const note = panel.querySelector('[data-act="note-input"][data-id="1"]');
  note.value = 'keep me';
  panel.dispatchEvent({ type: 'input', target: note });
  env.doc.activeElement = note;
  panel.contains = () => true;
  const before = panel.renderCount;
  env.resize(900);
  assert.strictEqual(api.state.narrow, false, 'rotated to wide');
  assert.strictEqual(api.state.drawerEdit.value, 'keep me', 'the crossing kept the mirror');
  await settle(env);
  assert.strictEqual(panel.renderCount, before, 'neither the crossing nor the refresh replaced the field');
  panel.dispatchEvent({ type: 'change', target: note });
  env.doc.activeElement = null;
  panel.contains = () => false;
  env.advanceTimersBy(0);
  assert.strictEqual(api.state.organizer.threads['1'].note, 'keep me');
  assert.strictEqual(api.state.drawerEdit, null, 'the commit cleared the mirror');
  assert.match(panel.innerHTML, /data-act="note-input" data-id="1" value="keep me"/, 'the wide row shows it');
});
```

- [ ] **Step 3: Run to verify failure**

Run: `node --test tests/dirty-input.test.js`
Expected: FAIL: the change's redraw lands immediately, and the refresh completion forces through the caret.

- [ ] **Step 4: Implement the press helpers**

Immediately before `function renderPanel(`, add:

```js
  // #33, spec section 6 "Dirty inputs": a redraw held while a press that began
  // in the panel is in progress is flushed by the click, a pointercancel, or
  // this long after the pointer lifts with no click. Nothing is flushed while
  // the pointer is still down, so a slow tap keeps its target.
  var PRESS_FLUSH_MS = 300;
  var pressTimer = null;
  var pressWinBound = false;

  function clearPress() {
    if (pressTimer !== null) { clearTimeout(pressTimer); pressTimer = null; }
    state.pressActive = false;
  }

  function flushAfterPress(doc, win, handlers) {
    if (state.pendingRedraw && !panelHasEditableFocus(doc)) draw(doc, win, handlers, true);
  }

  // Armed only by a pointerup.
  function armPressTimer(doc, win, handlers) {
    if (!state.pressActive) return;
    if (pressTimer !== null) clearTimeout(pressTimer);
    pressTimer = setTimeout(function () {
      pressTimer = null;
      if (!state.pressActive) return;
      clearPress();
      flushAfterPress(doc, win, handlers);
    }, PRESS_FLUSH_MS);
  }

  // The timer is not armed here: a press may last as long as it likes.
  function startPress(doc, win, handlers) {
    if (pressTimer !== null) { clearTimeout(pressTimer); pressTimer = null; }
    state.pressActive = true;
  }

  function endPress(doc, win, handlers) {
    if (!state.pressActive) return;
    clearPress();
    flushAfterPress(doc, win, handlers);
  }
```

- [ ] **Step 5: Wire the listeners**

In `renderPanel`'s delegated block, replace the `click` listener's opening lines

```js
      panel.addEventListener('click', function (ev) {
        var t = ev && ev.target;
```

with

```js
      panel.addEventListener('click', function (ev) {
        var t = ev && ev.target;
        // The press this click ends is over before its action runs, so the
        // action's own redraw also renders anything held during the press.
        var pressed = state.pressActive === true;
        if (pressed) clearPress();
```

In the same listener's thread-link branch, replace its `return;` with:

```js
          // Never redraw inside the click that follows a link: the anchor must
          // still be there when the browser acts on it. onThreadLink's own
          // zero-delay redraw usually renders the held change; this covers a
          // click that does not auto-hide.
          if (pressed) setTimeout(function () { flushAfterPress(doc, win, handlers); }, 0);
          return;
```

Change the early `if (!act || typeof handlers.onAction !== 'function') return;` to:

```js
        if (!act || typeof handlers.onAction !== 'function') {
          if (pressed) flushAfterPress(doc, win, handlers);
          return;
        }
```

and after the `try { handlers.onAction(act, t); } finally { ... }` line (Task 13) add:

```js
        if (pressed) flushAfterPress(doc, win, handlers);
```

After the `input` listener (Task 12), add:

```js
      panel.addEventListener('pointerdown', function () { startPress(doc, win, handlers); });
      panel.addEventListener('pointerup', function () { armPressTimer(doc, win, handlers); });
      panel.addEventListener('pointercancel', function () { endPress(doc, win, handlers); });
      // A pointer that lifts outside the panel (a mouse dragged off it) must
      // still end the press, or redraws would be held forever. This listens to
      // an event on the window; it reads no Torn markup (ADR 0001).
      if (!pressWinBound && win && typeof win.addEventListener === 'function') {
        pressWinBound = true;
        win.addEventListener('pointerup', function () { armPressTimer(doc, win, handlers); }, true);
      }
```

In the `focusout` listener's timeout, after `if (!state.pendingRedraw) return;` add:

```js
          // A press in progress flushes on its own click (#33).
          if (state.pressActive) return;
```

- [ ] **Step 6: Hold redraws in `makeHandlers`, and stop forcing background ones**

In `makeHandlers`, insert as the first line of `function redraw() {` (Task 13's version):

```js
      // #33: while a press that began in the panel is in progress, a redraw
      // would replace the node under the finger and the tap would never arrive
      // as a click. Hold it; the click, a pointercancel or the timer after
      // pointerup flushes it (spec section 6, dirty inputs).
      if (state.pressActive) { state.pendingRedraw = true; return; }
```

After `redraw`, add:

```js
    // Work that finishes later (a refresh, My posts, deep search, a key check)
    // lands whenever it lands, maybe while the user is typing. It is not
    // forced, so renderPanel's caret guard defers it exactly as it defers an
    // auto refresh (plan review: a forced completion destroyed the only copy
    // of a half-typed drawer field).
    function quietRedraw() {
      if (state.pressActive) { state.pendingRedraw = true; return; }
      draw(doc, win, handlers, false);
    }
```

Then switch every promise completion in `makeHandlers` from `redraw()` to `quietRedraw()`:
- `refresh`: `run.then(function () { if (isForumsPage(win.location)) redraw(); });` becomes `run.then(function () { if (isForumsPage(win.location)) quietRedraw(); });`.
- `view`: `refreshMine(now).then(function () { if (isForumsPage(win.location)) redraw(); });` becomes `... quietRedraw(); });`.
- `deep`: inside `runDeepSearch(...).then(function (res) { ... redraw(); });` the `redraw();` becomes `quietRedraw();`.
- `key-save`: `refreshAll(Date.now()).then(function () { if (isForumsPage(win.location)) redraw(); });` becomes `... quietRedraw(); });`.

The synchronous `redraw()` each of these actions makes straight away stays forced: that one is the user's own tap. Check with `grep -n "then(function" torn-forum-command-center.user.js` that no completion inside `makeHandlers` still calls `redraw()`.

- [ ] **Step 7: Run, full suite, commit**

Run: `node --test tests/dirty-input.test.js tests/redraw.test.js tests/narrow-focus.test.js tests/auto-hide.test.js tests/refresh.test.js tests/mine-refresh.test.js tests/key-rejection.test.js && npm test && npm run test:syntax`
Expected: PASS. The refresh, My posts and key suites still see their redraws: with no caret in the panel, a non-forced draw renders exactly as a forced one.

```bash
git add torn-forum-command-center.user.js tests/load-userscript.js tests/dirty-input.test.js
git commit -m "feat: hold redraws during a press and keep background redraws behind the caret (#33)"
```

---

### Task 15: Narrow stylesheet sweep: 44px boxes, 16px inputs, the moved media rules

**Files:**
- Modify: `torn-forum-command-center.user.js` (`panelStyleText`)
- Test: `tests/style.test.js`

**Interfaces:**
- Produces: the generic narrow control rule and the input rule; the `@media (max-width: 600px)` block holds only the fallback mount.

- [ ] **Step 1: Write the failing style gates**

In `tests/style.test.js`, replace the test `'there is a narrow-width rule, because Torn PDA is the primary target'` with:

```js
test('there is a narrow-width rule, because Torn PDA is the primary target', () => {
  // #33: the viewport query keeps only the fixed fallback mount, which really
  // is viewport-relative; the panel's own narrow rules hang off .tfcc-narrow.
  assert.match(css, /@media \(max-width: 600px\)/);
  const mq = css.slice(css.indexOf('@media (max-width: 600px)'), css.indexOf('}\n', css.indexOf('@media (max-width: 600px)') + 30) + 2);
  assert.match(mq, /#tfcc-fallback-mount/);
  assert.doesNotMatch(mq, /#tfcc-panel /, 'panel rules moved under .tfcc-narrow');
  assert.match(blockFor('#tfcc-panel.tfcc-narrow .tfcc-kv label'), /flex-basis:\s*100%/, 'label and control stack rather than clip');
});
```

and replace the test `'row controls are tightened on a phone, where the same nine appear per row'` with:

```js
test('narrow rows put their nine controls in a drawer, not a per-row strip (#33)', () => {
  assert.match(blockFor('#tfcc-panel.tfcc-narrow .tfcc-drawer'), /grid-template-columns: repeat\(auto-fit, minmax\(7\.5em, 1fr\)\)/,
    'auto-fit, so 200% text reflows to one column');
});
```

Append:

```js
// Every narrow rule, as [selector, body].
function narrowRules() {
  const out = [];
  const re = /(#tfcc-panel\.tfcc-narrow[^{]*)\{([^}]*)\}/g;
  let m;
  while ((m = re.exec(css))) out.push([m[1].trim(), m[2]]);
  return out;
}

test('every narrow control outside the header has a real 44px box (#33, spec principle 4)', () => {
  for (const sel of ['#tfcc-panel.tfcc-narrow button', '#tfcc-panel.tfcc-narrow select',
    '#tfcc-panel.tfcc-narrow .tfcc-linkbtn', '#tfcc-panel.tfcc-narrow input:not([type="checkbox"])']) {
    assert.match(blockFor(sel), /min-height: 44px; min-width: 44px;/, sel);
  }
  const headerOrTitle = /tfcc-hbtn|tfcc-hshow|tfcc-chip|tfcc-row-title a/;
  for (const [sel, body] of narrowRules()) {
    if (!/button|select|input|tfcc-linkbtn/.test(sel) || headerOrTitle.test(sel)) continue;
    for (const prop of ['min-height', 'min-width']) {
      const m = new RegExp(prop + ':\\s*([0-9.]+)px').exec(body);
      if (m) assert.ok(Number(m[1]) >= 44, sel + ' sets ' + prop + ' ' + m[1] + 'px');
    }
  }
});

test('the header buttons use the scaled size, and only they go below 44px', () => {
  for (const [sel, body] of narrowRules()) {
    if (/tfcc-hbtn|tfcc-hshow/.test(sel) && /min-height/.test(body)) assert.match(body, /min-height: var\(--tfcc-hb\)/, sel);
  }
});

test('narrow rules use min sizes, no fixed heights, no pseudo-element targets, no motion (#33)', () => {
  for (const [sel, body] of narrowRules()) {
    assert.doesNotMatch(body, /(^|[^-])height:\s*\d/, sel + ' sets a fixed height');
    assert.doesNotMatch(sel, /::?(after|before)/, sel + ' is a pseudo-element hit area');
    assert.doesNotMatch(body, /transition|animation/, sel + ' animates');
  }
});

test('narrow text fields are 16px or more, so iOS does not zoom (#33)', () => {
  for (const sel of ['#tfcc-panel.tfcc-narrow input:not([type="checkbox"])', '#tfcc-panel.tfcc-narrow select',
    '#tfcc-panel.tfcc-narrow textarea']) {
    assert.match(blockFor(sel), /font-size: max\(16px, 1em\);/, sel);
  }
});
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test tests/style.test.js`
Expected: FAIL: no generic rule; the media block still has panel rules.

- [ ] **Step 3: Implement**

In `panelStyleText()`, replace the media block

```js
      '@media (max-width: 600px) {',
      '  #' + FALLBACK_ID + ' { right: 4px; bottom: 4px; width: calc(100vw - 8px); }',
      ... (the nine panel lines) ...
      '}',
```

with

```js
      // Narrow screens are the primary target: this runs inside Torn PDA. The
      // fallback mount is fixed to the viewport, so its offsets stay a viewport
      // query; everything inside the panel follows the panel's own width
      // through .tfcc-narrow (#33).
      '@media (max-width: 600px) {',
      '  #' + FALLBACK_ID + ' { right: 4px; bottom: 4px; width: calc(100vw - 8px); }',
      '}',
```

Directly after the `'#' + PANEL_ID + '.tfcc-narrow { padding: 8px; }',` line (Task 9), add:

```js
      // Every narrow control is a real box of at least 44 x 44 (spec principle
      // 4). The header buttons override this with --tfcc-hb (spec 13b) at a
      // higher specificity. Text fields are 16px or more, or iOS zooms the page
      // when one takes focus. One selector per rule, so each is easy to find.
      '#' + PANEL_ID + '.tfcc-narrow button { min-height: 44px; min-width: 44px; }',
      '#' + PANEL_ID + '.tfcc-narrow select { min-height: 44px; min-width: 44px; font-size: max(16px, 1em); }',
      '#' + PANEL_ID + '.tfcc-narrow .tfcc-linkbtn { min-height: 44px; min-width: 44px; display: inline-flex;',
      '  align-items: center; }',
      '#' + PANEL_ID + '.tfcc-narrow input:not([type="checkbox"]) { min-height: 44px; min-width: 44px;',
      '  font-size: max(16px, 1em); }',
      '#' + PANEL_ID + '.tfcc-narrow textarea { font-size: max(16px, 1em); }',
      // A checkbox is reached through its 44px label.
      '#' + PANEL_ID + '.tfcc-narrow .tfcc-kv label { min-width: 0; flex-basis: 100%; min-height: 44px;',
      '  display: flex; align-items: center; }',
      '#' + PANEL_ID + '.tfcc-narrow .tfcc-grow { flex-basis: 100%; }',
      '#' + PANEL_ID + '.tfcc-narrow .tfcc-actions { gap: 6px; }',
      '#' + PANEL_ID + '.tfcc-narrow .tfcc-cap button { min-height: 44px; }',
```

`.tfcc-narrow .tfcc-row` and `.tfcc-narrow .tfcc-meta` gap already came in Task 12. `blockFor(sel)` finds `sel + ' {'`, so `'#tfcc-panel.tfcc-narrow button'` matches only the generic rule (the header's `button.tfcc-hbtn {` does not contain `button {`).

- [ ] **Step 4: Run, full suite, commit**

Run: `node --test tests/style.test.js tests/wide-parity.test.js && npm test && npm run test:syntax`
Expected: PASS. The parity CSS test allows exactly the nine moved lines to disappear.

```bash
git add torn-forum-command-center.user.js tests/style.test.js
git commit -m "feat: narrow 44px boxes and 16px inputs; viewport query keeps only the fallback (#33)"
```

---

### Task 16: Narrow previews and the contrast audit

**Files:**
- Modify: `tests/render-preview.mjs`, `tests/contrast-audit.mjs`, `tests/load-userscript.js` (export `HB_*` already done)

These two scripts are run by hand and never by `npm test`.

- [ ] **Step 1: A narrow `page()` with the real `fitHeader`**

In `tests/render-preview.mjs`, change `function page(title, theme, body, width, hostile)` to `function page(title, theme, body, width, hostile, narrow)`, and replace its `'<div id="tfcc-panel" class="tfcc-theme-' + theme + '">' + body + '</div>',` line with:

```js
    '<div id="tfcc-panel" class="tfcc-theme-' + theme + (narrow ? ' tfcc-narrow' : '') + '">' + body + '</div>',
    // #33: the production fitHeader and headerButtonSize, verbatim, so the
    // preview's header is sized exactly as the script sizes it.
    narrow ? '<script>' + FIT_HEADER_SHIM + '</script>' : '',
```

Above `function page(`, add:

```js
// The real functions, by source text, with the constants and the one state
// field they read. A preview that drifted from the runtime would prove nothing.
const raw = env.rawExports;
const FIT_HEADER_SHIM = [
  'var state = { narrow: true };',
  ['HB_MAX', 'HB_MIN', 'HB_STEP', 'HB_COMPACT_BELOW', 'HB_GAPS', 'LOGO_ASPECT', 'LOGO_PER_HB', 'LOGO_MIN_PX', 'LOGO_MAX_PX']
    .map((k) => 'var ' + k + ' = ' + JSON.stringify(raw[k]) + ';').join('\n'),
  String(raw.headerLogoWidth),
  String(raw.headerButtonSize),
  'function setHeaderSize(panel, size) { if (size === null) panel.style.removeProperty("--tfcc-hb");'
    + ' else panel.style.setProperty("--tfcc-hb", size + "px"); }',
  String(raw.fitHeader),
  'fitHeader(document.getElementById("tfcc-panel"), window);',
].join('\n');
```

- [ ] **Step 2: The narrow previews**

After the `threads-capped-narrow.html` block, add:

```js
// #33: the condensed layout. Panel widths are the spec's: a 375, 320 and
// 280px phone inside a 16px gutter. Each state in dark and light.
api.state.narrow = true;
const NARROW_STATES = [
  ['threads', () => { api.state.settings.view = 'threads'; }],
  ['threads-drawer', () => { api.state.settings.view = 'threads'; api.state.openRowId = '16474152'; }],
  ['catchup', () => { api.state.settings.view = 'catchup'; }],
  ['catchup-info-drawer', () => { api.state.settings.view = 'catchup'; api.state.openInfoId = 'catchup';
    api.state.openRowId = '16474152'; }],
  ['filters', () => { api.state.settings.view = 'threads'; api.state.filtersOpen = true; }],
  ['mine', () => { api.state.settings.view = 'mine'; }],
  ['collapsed', () => { api.state.settings.view = 'threads'; api.state.settings.collapsed = true; }],
  ['shelf', () => { api.state.settings.view = 'threads'; api.state.badgeShelfOpen = true; }],
];
for (const [label, setUp] of NARROW_STATES) {
  for (const [vp, panelPx] of [[375, 343], [320, 288], [280, 248]]) {
    for (const theme of ['dark', 'light']) {
      Object.assign(api.state, { openRowId: null, filtersOpen: false, openInfoId: null, badgeShelfOpen: false });
      api.state.settings.collapsed = false;
      api.state.settings.theme = theme;
      setUp();
      const body = api.panelHtml(api.buildPanelModel(NOW));
      const name = `narrow-${label}-${vp}-${theme}.html`;
      fs.writeFileSync(path.join(outDir, name),
        page(`narrow ${label} / ${vp}px / ${theme}`, theme, body, panelPx, label === 'threads', true));
      written.push(name);
    }
  }
}
api.state.narrow = false;
Object.assign(api.state, { openRowId: null, filtersOpen: false, openInfoId: null, badgeShelfOpen: false });
api.state.settings.collapsed = false;
```

The badges block that follows sets `api.state.badges`; the narrow `shelf` state above shows whatever badges the earlier seed has, which is enough for the header and shelf layout. If `16474152` is not rendered in a state (the drawer id), the reconciliation in `buildPanelModel` closes it and the preview simply shows no drawer: check `narrow-threads-drawer-*.html` shows one, and if not, set `openRowId` to `api.buildPanelModel(NOW).renderedIds[1]` instead.

- [ ] **Step 3: The contrast audit learns the nav and the header**

In `tests/contrast-audit.mjs`, inside `SCRIPT`:

1. In the generic text walk, after `if (!own) return;`, add:

```js
    // #33: the nav numeral is decorative (aria-hidden) and below 3:1 by the
    // owner's choice; the label over it is measured below instead.
    if (el.closest('.tfcc-navnum')) return;
```

2. Before the `out.seen = {` line, add:

```js
  // #33, spec 13f: every nav label at 4.5:1 or better over the numeral painted
  // on its cell (or over the cell, where there is no numeral), composited
  // exactly as the mockup's in-page script does.
  const mix = (fg, bg, a) => ({ r: fg.r * a + bg.r * (1 - a), g: fg.g * a + bg.g * (1 - a), b: fg.b * a + bg.b * (1 - a), a: 1 });
  panel.querySelectorAll('.tfcc-navgrid button').forEach((cell) => {
    const lab = cell.querySelector('.tfcc-navlab');
    if (!lab) return;
    const fg = parse(getComputedStyle(cell).color);
    const bg = effectiveBg(cell);
    const numEl = cell.querySelector('.tfcc-navnum');
    const under = numEl ? mix(fg, bg, parseFloat(getComputedStyle(numEl).opacity)) : bg;
    const label = mix(fg, under, parseFloat(getComputedStyle(lab).opacity));
    const r = ratio(label, under);
    if (r >= ${MIN_NORMAL}) return;
    out.push({ tag: 'nav', cls: 'tfcc-navlab', color: 'composited', bg: 'numeral', ratio: Math.round(r * 100) / 100,
      need: ${MIN_NORMAL}, text: lab.textContent });
  });
  // #33, spec 13b: the narrow header stays on one line. Every header button
  // shares one top, the header is no taller than a button (plus a pixel of
  // rounding), and no button is under the 24px floor.
  const head = panel.classList.contains('tfcc-narrow') ? panel.querySelector('.tfcc-head') : null;
  const headBad = [];
  if (head) {
    const btns = Array.from(head.querySelectorAll('.tfcc-head-btns button'));
    const tops = new Set(btns.map((b) => Math.round(b.getBoundingClientRect().top)));
    const tallest = Math.max(...btns.map((b) => b.getBoundingClientRect().height));
    if (tops.size !== 1) headBad.push('header buttons on ' + tops.size + ' lines');
    if (btns.some((b) => b.getBoundingClientRect().width < 23.5)) headBad.push('a header button under 24px');
    const ctl = head.querySelector('.tfcc-head-ctl').getBoundingClientRect();
    if (Math.round(ctl.top) !== Math.round(head.getBoundingClientRect().top)) headBad.push('the buttons wrapped under the logo');
    if (!(tallest > 0)) headBad.push('no header buttons measured');
    // Expanded, nothing may wrap at all: a logo or chip on a second line makes
    // the header taller than one button. Collapsed, only the bare count may
    // wrap under the logo (spec 4.1), so the height check is expanded only.
    const collapsed = !!head.querySelector('.tfcc-hshow');
    const headH = head.getBoundingClientRect().height;
    if (!collapsed && headH > tallest + 1) headBad.push('the expanded header is ' + Math.round(headH)
      + 'px tall, more than one ' + Math.round(tallest) + 'px row');
  }
```

3. Change `out.seen = {` to include `navcells: panel.querySelectorAll('.tfcc-navgrid button').length, headBad: headBad,` and in the Node half, after the existing `missing` checks, add:

```js
  if (page.startsWith('narrow-') && !page.includes('-collapsed-') && !seen.navcells) missing.push('the narrow nav cells');
  if (seen.headBad && seen.headBad.length) {
    console.log(`!! ${page}: ${seen.headBad.join('; ')}`);
    failures += seen.headBad.length;
  }
```

- [ ] **Step 4: Run them**

Run: `node tests/render-preview.mjs > "$TMPDIR/preview.txt" 2>&1; node tests/contrast-audit.mjs > "$TMPDIR/contrast.txt" 2>&1; echo exit=$?` and read both files.
Expected: `Every preview passes WCAG AA.` and `exit=0`. If the browse binary is missing the audit exits 2 and says so; record that, do not record a pass. Open `preview/narrow-threads-320-dark.html`, `narrow-catchup-info-drawer-280-light.html` and `narrow-collapsed-280-dark.html` and compare them with `docs/designs/mockups/33-mobile/revised-320.png` by eye: one-line header, 3 x 2 nav, title-first rows.

- [ ] **Step 5: Commit**

```bash
git add tests/render-preview.mjs tests/contrast-audit.mjs
git commit -m "test: narrow previews, a one-line header check and the v1 nav label audit (#33)"
```

---

### Task 17: Mutation-check entries

**Files:**
- Modify: `tests/mutation-check.mjs` (`MUTATIONS`, append before its closing `];`)

- [ ] **Step 1: Add the entries**

Every `apply` string must match the source exactly as Tasks 3 to 15 wrote it; a stale one prints `SKIP` and counts as a failure. Append:

```js
  // ---- #33: condense the narrow mobile view -------------------------------
  {
    name: 'Catch up loses its one-tap Read',
    suite: 'tests/narrow-view.test.js',
    apply: (s) => s.replace('if (inCatchUp) out.push(readButton(row));', 'if (false) out.push(readButton(row));'),
  },
  {
    name: 'Read is offered twice in Catch up',
    suite: 'tests/narrow-view.test.js',
    apply: (s) => s.replace('if (!inCatchUp) out.push(readButton(row));', 'out.push(readButton(row));'),
  },
  {
    name: 'a stale open row is not reconciled',
    suite: 'tests/narrow-engine.test.js',
    apply: (s) => s.replace('if (out.openRowId !== null && ids.indexOf(out.openRowId) === -1) out.openRowId = null;', ''),
  },
  {
    name: 'the model build no longer reconciles',
    suite: 'tests/narrow-state.test.js',
    apply: (s) => s.replace(
      'setTransient(reconcileTransient(currentTransient(), renderedIds, INFO_KEYS_BY_VIEW[s.view] || []));', ''),
  },
  {
    name: 'the focus plan skips the next row',
    suite: 'tests/narrow-engine.test.js',
    apply: (s) => s.replace('if (at + 1 < ids.length) out.push(', 'if (false) out.push('),
  },
  {
    name: 'focus is never restored after a redraw',
    suite: 'tests/narrow-focus.test.js',
    apply: (s) => s.replace('if (plan) restoreFocus(panel, plan);', ''),
  },
  {
    name: 'the breakpoint loses its hysteresis',
    suite: 'tests/narrow-engine.test.js',
    apply: (s) => s.replace('if (width > NARROW_LEAVE_PX) return false;', 'if (width > NARROW_ENTER_PX) return false;'),
  },
  {
    name: 'header buttons go under the 24px floor',
    suite: 'tests/narrow-engine.test.js',
    apply: (s) => s.replace('for (var s = HB_MAX; s >= HB_MIN; s -= HB_STEP) {', 'for (var s = HB_MAX; s >= 12; s -= HB_STEP) {'),
  },
  {
    name: 'header buttons grow past 44px',
    suite: 'tests/narrow-engine.test.js',
    apply: (s) => s.replace('var HB_MAX = 44;', 'var HB_MAX = 48;'),
  },
  {
    name: 'the chip never goes compact',
    suite: 'tests/narrow-runtime.test.js',
    apply: (s) => s.replace('if (r.size < HB_COMPACT_BELOW && chip && chip.classList) {', 'if (false) {'),
  },
  {
    name: 'the narrow class never reaches the panel',
    suite: 'tests/narrow-runtime.test.js',
    apply: (s) => s.replace("if (panel.classList) panel.classList.toggle(NARROW_CLASS, state.narrow === true);", ''),
  },
  {
    name: 'the ResizeObserver is never set up',
    suite: 'tests/narrow-runtime.test.js',
    apply: (s) => s.replace("if (typeof ResizeObserver !== 'function') return false;", 'return false;'),
  },
  {
    name: 'crossing the breakpoint keeps the drawer open',
    suite: 'tests/narrow-runtime.test.js',
    apply: (s) => s.replace("applyTransient({ type: 'breakpoint' });", ''),
  },
  {
    name: 'a view change keeps the drawer open',
    suite: 'tests/narrow-state.test.js',
    apply: (s) => s.replace("if (v !== state.settings.view) applyTransient({ type: 'view' });", ''),
  },
  {
    name: 'auto-hide leaves the drawer open',
    suite: 'tests/auto-hide.test.js',
    apply: (s) => s.replace("applyTransient({ type: 'auto-hide' });", ''),
  },
  {
    name: 'a narrow selected nav label loses contrast',
    suite: 'tests/style.test.js',
    apply: (s) => s.replace('--tfcc-navnum-opacity-selected: 0.09;', '--tfcc-navnum-opacity-selected: 0.14;'),
  },
  {
    name: 'the reactions pill returns to the narrow nav',
    suite: 'tests/narrow-view.test.js',
    apply: (s) => s.replace("var out = ['<div class=\"tfcc-nav tfcc-navgrid\">'];",
      "var out = ['<div class=\"tfcc-nav tfcc-navgrid\">' + renderReactions(model)];"),
  },
  {
    name: 'the collapsed count says "16 new" to sighted users',
    suite: 'tests/narrow-view.test.js',
    apply: (s) => s.replace(
      "count = '<span class=\"tfcc-badge tfcc-hcount\"><span aria-hidden=\"true\">' + escapeHtml(n) + '</span>'",
      "count = '<span class=\"tfcc-badge tfcc-hcount\"><span aria-hidden=\"true\">' + escapeHtml(said) + '</span>'"),
  },
  {
    name: 'wide rows render the narrow markup',
    suite: 'tests/wide-parity.test.js',
    apply: (s) => s.replace('return model.narrow ? renderRowNarrow(row, model) : renderRow(row, model);',
      'return renderRowNarrow(row, model);'),
  },
  {
    name: 'a closed explanation is shown anyway',
    suite: 'tests/info.test.js',
    apply: (s) => s.replace("+ (openKey === key ? '' : ' hidden') + '>' + html + '</p>';", "+ '>' + html + '</p>';"),
  },
  {
    name: 'the visible budget line stops following the setting',
    suite: 'tests/info.test.js',
    apply: (s) => s.replace("+ (3 + budget) + ' requests and My posts at most '", "+ 13 + ' requests and My posts at most '"),
  },
  {
    name: 'the Filters count ignores the tag filter',
    suite: 'tests/narrow-engine.test.js',
    apply: (s) => s.replace('return (s.folderFilter ? 1 : 0) + (s.tagFilter ? 1 : 0);', 'return (s.folderFilter ? 1 : 0);'),
  },
  {
    name: 'a press no longer holds the redraw',
    suite: 'tests/dirty-input.test.js',
    apply: (s) => s.replace('if (state.pressActive) { state.pendingRedraw = true; return; }', ''),
  },
  {
    name: 'a forced redraw drops what was typed in a drawer',
    suite: 'tests/dirty-input.test.js',
    apply: (s) => s.replace("escapeHtml(edit && edit.field === 'note-input' ? edit.value : row.note)", 'escapeHtml(row.note)'),
  },
  {
    name: 'the live region never renders',
    suite: 'tests/narrow-focus.test.js',
    apply: (s) => s.replace("if (!model.live) return '';", "return '';"),
  },
  {
    name: 'narrow text fields fall under 16px',
    suite: 'tests/style.test.js',
    apply: (s) => s.replace("'#' + PANEL_ID + '.tfcc-narrow textarea { font-size: max(16px, 1em); }',",
      "'#' + PANEL_ID + '.tfcc-narrow textarea { font-size: 12px; }',"),
  },
  {
    name: 'narrow controls shrink under 44px',
    suite: 'tests/style.test.js',
    apply: (s) => s.replace("'#' + PANEL_ID + '.tfcc-narrow button { min-height: 44px; min-width: 44px; }',",
      "'#' + PANEL_ID + '.tfcc-narrow button { min-height: 40px; min-width: 40px; }',"),
  },
  // ---- #33, added by the plan review ----------------------------------------
  {
    name: 'the no-click flush is armed on pointerdown, so a slow tap loses its target',
    suite: 'tests/dirty-input.test.js',
    apply: (s) => s.replace('state.pressActive = true;\n  }', 'state.pressActive = true;\n    armPressTimer(doc, win, handlers);\n  }'),
  },
  {
    name: 'the no-click flush is not 300ms',
    suite: 'tests/dirty-input.test.js',
    apply: (s) => s.replace('var PRESS_FLUSH_MS = 300;', 'var PRESS_FLUSH_MS = 3000;'),
  },
  {
    name: 'a thread-link click flushes inside its own dispatch',
    suite: 'tests/dirty-input.test.js',
    apply: (s) => s.replace('if (pressed) setTimeout(function () { flushAfterPress(doc, win, handlers); }, 0);',
      'if (pressed) flushAfterPress(doc, win, handlers);'),
  },
  {
    name: 'a pointerup outside the panel never ends the press',
    suite: 'tests/dirty-input.test.js',
    apply: (s) => s.replace("win.addEventListener('pointerup', function () { armPressTimer(doc, win, handlers); }, true);", ''),
  },
  {
    name: 'a background completion forces through the caret',
    suite: 'tests/dirty-input.test.js',
    apply: (s) => s.replace('draw(doc, win, handlers, false);\n    }', 'draw(doc, win, handlers, true);\n    }'),
  },
  {
    name: 'crossing the breakpoint drops an uncommitted edit',
    suite: 'tests/narrow-engine.test.js',
    apply: (s) => s.replace('return { openRowId: null, filtersOpen: false, openInfoId: null, drawerEdit: out.drawerEdit };',
      'return freshTransient();'),
  },
  {
    name: 'a deferred redraw updates the focus bookkeeping',
    suite: 'tests/narrow-focus.test.js',
    apply: (s) => s.replace('var rewrote = !!panel && panel.__tfccHtml !== htmlBefore;', 'var rewrote = !!panel;'),
  },
  {
    name: 'a text field\'s commit redraws at once and pulls focus back into it',
    suite: 'tests/narrow-focus.test.js',
    apply: (s) => s.replace('if (state.deferCommit) {', 'if (false) {'),
  },
  {
    name: 'a text field\'s change brings its own focus plan',
    suite: 'tests/narrow-focus.test.js',
    apply: (s) => s.replace('if (!text) state.focusIntent = focusPlan(focusTargetOf(t), lastRender);',
      'state.focusIntent = focusPlan(focusTargetOf(t), lastRender);'),
  },
  {
    name: 'a settings replacement that changes the view skips the reset',
    suite: 'tests/narrow-state.test.js',
    apply: (s) => s.replace("if (next.view !== state.settings.view) applyTransient({ type: 'view' });", ''),
  },
  {
    name: 'fitHeader reads the document instead of the panel',
    suite: 'tests/narrow-focus.test.js',
    apply: (s) => s.replace("var chip = panel.querySelector('.tfcc-chip');",
      "var chip = panel.querySelector('.tfcc-chip') || document.querySelector('.tfcc-chip');"),
  },
  {
    name: 'Show is not measured again at the size it gets',
    suite: 'tests/narrow-runtime.test.js',
    apply: (s) => s.replace('if (show) { r = headerButtonSize(content, width(chip), width(show), icons); setHeaderSize(panel, r.size); }', ''),
  },
  {
    name: 'the loading header stays wide in a narrow panel',
    suite: 'tests/narrow-view.test.js',
    apply: (s) => s.replace('var bareHead = model.narrow ? renderHeadNarrow(model, false) :', 'var bareHead = false ? renderHeadNarrow(model, false) :'),
  },
  // One per section 13d audit item (spec table numbers), each caught by the
  // literal owner map in tests/info.test.js.
  ...[
    ['2', "renderInfoButton('catchup', model.openInfoId)"],
    ['4', "renderInfoButton('mine', model.openInfoId)"],
    ['8', "renderInfoButton('search', model.openInfoId)"],
    ['17', "renderInfoButton('settings-budget', model.openInfoId)"],
    ['18', "renderInfoButton('settings-author', model.openInfoId)"],
    ['19', "renderInfoButton('settings-rows', model.openInfoId)"],
    ['20', "renderInfoButton('settings-autohide', model.openInfoId)"],
    ['21', "renderInfoButton('settings-folders', model.openInfoId)"],
    ['26', "renderInfoButton('settings-badges', model.openInfoId)"],
  ].map(([item, call]) => ({
    name: '13d item ' + item + ' loses its info button',
    suite: 'tests/info.test.js',
    apply: (s) => s.replace(call, "''"),
  })),
  {
    name: '13d item 11: the Drafts reply-box line is long again',
    suite: 'tests/info.test.js',
    apply: (s) => s.replace('No reply box here, so Copy replaces Insert.', 'No reply box was found on this page, so Insert is unavailable.'),
  },
  {
    name: '13d item 13: the key note is long again',
    suite: 'tests/info.test.js',
    apply: (s) => s.replace('Create a <strong>Minimal Access</strong> key on Torn (Settings, API Key).',
      'This script needs a key. Create a <strong>Minimal Access</strong> key on Torn (Settings, API Key).'),
  },
  {
    name: '13d item 16: the custom-key line is long again',
    suite: 'tests/info.test.js',
    apply: (s) => s.replace("Opens Torn in a new tab with only this script\\'s selections.",
      "This opens Torn in a new tab with only this script\\'s selections."),
  },
  {
    name: '13d item 23: the backup line is long again',
    suite: 'tests/info.test.js',
    apply: (s) => s.replace('Never includes your API key or the post cache.',
      'An export carries folders and tags. Never includes your API key or the post cache.'),
  },
  {
    name: '13d item 25: the debug line is long again',
    suite: 'tests/info.test.js',
    apply: (s) => s.replace('Never includes your key, drafts, notes or post text.',
      'A debug report carries counts. Never includes your key, drafts, notes or post text.'),
  },
```

Notes for whoever runs this:
- The "narrow text fields" mutation changes only the textarea rule on purpose; the style test checks each of the three field rules separately, so it must notice.
- Two entries match a line break plus indentation (`state.pressActive = true;\n  }` in `startPress`, and `draw(doc, win, handlers, false);\n    }` in `quietRedraw`). The source uses LF line endings; if an entry prints `SKIP`, compare the indentation with the code and fix the entry, not the code.
- The `13d item 16` entry matches the source text, where the apostrophe is written `\'` inside a single-quoted string; in the `.mjs` file that is `\\'` inside a double-quoted string, as above.
- If any entry reports `WEAK`, tighten the test it names, not the mutation.

- [ ] **Step 2: Run the mutation check, redirected to a file**

Run: `node tests/mutation-check.mjs > "$TMPDIR/mutation.txt" 2>&1; echo exit=$?` then read `$TMPDIR/mutation.txt` with `Read`. **Never** pipe it into `head`.
Expected: every line `OK`, including the 54 new ones, and `exit=0`. Then `git status --short` must show `torn-forum-command-center.user.js` unchanged and no `.mutation-backup`.

If one prints `WEAK`, the test it names passes for the wrong reason: fix the test, not the mutation, and say in the test's comment what it now guards.

- [ ] **Step 3: Commit**

```bash
git add tests/mutation-check.mjs
git commit -m "test: mutation entries for every #33 promise"
```

---

### Task 18: Docs, code map, changelog, final verification, push

**Files:**
- Modify: `docs/architecture.md`, `docs/qa-checklist.md`, `CHANGELOG.md`, `docs/code-map.md`

- [ ] **Step 1: Architecture: the owner's ADR 0001 ruling and the narrow layout**

In `docs/architecture.md`, at the end of the "## Mount and navigation" section (before "### Rendering, and why it is guarded three ways"), add:

```markdown
### The narrow layout and ADR 0001

A panel 600px wide or less condenses (#33). The width is the panel's own, not
the viewport's: the inline panel sits in Torn's content column, and Expand
changes its width without changing the viewport. A `ResizeObserver` on
`#tfcc-panel`, plus a measurement of the same element on every render, sets
`state.narrow` with 16px of hysteresis (enter at 600, leave above 616), and
`renderPanel` writes the `tfcc-narrow` class. Without `ResizeObserver` the
per-render measurement is the whole mechanism. `fitHeader` then sizes the
header buttons (`--tfcc-hb`, 24 to 44px) from the panel's content width, the
chip and the Show button, so the header stays on one line.

**The owner's ruling (2026-10-09):** a `ResizeObserver` on the script's own
`#tfcc-panel`, and measuring nodes inside it, stays within ADR 0001. It is not
a third DOM access: ADR 0001 confines access to Torn's markup to the mount
container and the reply textarea, and neither the observer nor `fitHeader`
reads a Torn node or Torn data. This interprets ADR 0001 and does not reverse
it, so the ADR is unchanged (repo-standards section 6.3).
`tests/narrow-focus.test.js` records every `document.querySelector` call to
keep it that way.

The narrow markup is a branch of each renderer on `model.narrow`; the wide
markup is main's, byte for byte, and `tests/wide-parity.test.js` compares it
with a golden captured before #33. The transient view state (the open drawer,
the open filters, the open explanation, a drawer field's typed value) is a
pure state machine (`nextTransient`, `reconcileTransient`), reconciled after
every model build, and focus after a redraw follows `focusPlan`: the same
control, the next row, the previous row, then the view heading. While a press
that began in the panel is in progress, a redraw is held until its click, so a
commit-on-blur can no longer replace the node under the finger.
```

In "## Verification", change "It breaks each of 83 user-visible promises" to the current count, from `grep -c "^    suite:" tests/mutation-check.mjs` (179 if Task 17 added all 54 to main's 125).

- [ ] **Step 2: QA checklist**

In `docs/qa-checklist.md`, after the "### Layout" section, add:

```markdown
### Narrow view (#33)

Walk on Torn PDA, portrait, on the narrowest phone you have, then landscape.

- [ ] The header is one line: logo, badge chip, then three icon buttons. Nothing
      wraps at 375, 320 or 280px wide. At 280px the chip's padding tightens.
- [ ] TalkBack/VoiceOver reads the header buttons as "Refresh", "Expand" and
      "Hide the panel". Collapsed, the third button shows the word "Show" and
      the unread count is a bare number read as "16 new".
- [ ] The nav is a 3 x 2 grid: Threads, Catch up, Search, Drafts, Settings, My
      posts (light grey, last). Counts are faint large numerals behind the
      labels; no label wraps. A screen reader reads "Threads, 16 new, 6
      subscribed".
- [ ] The first thread row is well up the first screen. Every button outside the
      header is at least a fingertip (44px) and none overlaps another.
- [ ] Tapping the filter field does not zoom the page (iOS). Filters opens Sort,
      Folder and Tag; its number counts the folder and tag filters.
- [ ] Catch up: the check mark on a row marks it read in one tap, and focus lands
      on the next row's check mark. The last row's moves focus to the previous
      row; the only row's moves focus to the "Catch up" heading. TalkBack says
      "Marked read. N left."
- [ ] Actions ("...") opens one drawer at a time with Pin, Mark read (not in
      Catch up), Draft, Archive, the priority stepper, Folder, Add tag and Note.
- [ ] Type a note in a drawer, then tap another row's Actions without pressing
      Enter. The note is saved AND the other drawer opens.
- [ ] Tapping Actions or the check mark never hides the panel. A plain tap on a
      thread title still opens it and auto-hides (#8), and the drawer is closed
      when you come back.
- [ ] Rotate to landscape: past about 616px the wide layout returns and every
      drawer, filter and explanation closes. Rotate back: narrow again.
- [ ] Expand, then Shrink: the layout follows the panel's width, not the
      screen's.
- [ ] My posts opens with the reaction totals on its first line. On desktop the
      pill is still in the nav, before My posts.
- [ ] Every info button opens its explanation under it and closes it again.
      Settings still shows the ToS table, the request-budget line and both
      privacy lines without opening anything. At default settings (Activity
      lookups per refresh = 10) the budget line reads "A Threads refresh is at
      most 13 requests and My posts at most 17; never more than 40 a minute.";
      set the lookups to 4 and it reads 7 and 10.
- [ ] Android system font at 200%: nothing clips or scrolls sideways; the header
      is still one line.
```

In the same file, update the two lines this issue makes false: replace "At the narrowest PDA width the nav wraps and My posts is still last and" (and its continuation line) with "At the narrowest PDA width the nav is a 3 x 2 grid and My posts is still last and reachable." and replace "Refresh, Expand and Hide stay on the header row at the narrowest PDA" (and its continuation "width, portrait and landscape; the tracker wraps in its own line.") with "At the narrowest PDA width the tracker is the first line of My posts; on desktop it stays in the nav." Read the surrounding lines first and keep their checkbox style.

- [ ] **Step 3: CHANGELOG under `[Unreleased]` (no version bump)**

In `CHANGELOG.md`, under `## [Unreleased]`, append to the existing `### Changed` list:

```markdown
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
```

Do not touch `// @version`, `SCRIPT_VERSION` or `package.json`.

- [ ] **Step 4: Refresh the code map**

Run the `/code-map` skill (declarations moved: every new function in Tasks 3 to 14). Then spot-check: `grep -n "fitHeader\|renderRowNarrow\|focusPlan" docs/code-map.md` must match `grep -n "function fitHeader(\|function renderRowNarrow(\|function focusPlan(" torn-forum-command-center.user.js`.

- [ ] **Step 5: Final verification**

Run:

```
npm test
npm run test:syntax
git diff --check origin/main
node tests/mutation-check.mjs > "$TMPDIR/mutation.txt" 2>&1; echo exit=$?
```

Read `$TMPDIR/mutation.txt`. Expected: all green, every mutation `OK`, `exit=0`, and `git status --short` clean apart from the docs being committed. Confirm `grep -c "@version" torn-forum-command-center.user.js` is unchanged from main and `git diff origin/main -- package.json` is empty.

- [ ] **Step 6: Commit and push**

```bash
git add docs/architecture.md docs/qa-checklist.md CHANGELOG.md docs/code-map.md
git commit -m "docs: narrow view, the ADR 0001 ruling, QA lines and changelog (#33)"
git push -u origin feat/33-mobile-condense
```

Check each commit message's tail on the branch (`git log origin/main..HEAD --format=%B`) for any attribution line before pushing. Do not open a PR from this plan; `/review` and `/ship` follow.

---

## Spec coverage map

| Spec item | Task |
|---|---|
| 4.1 / 13a / 13b header, `--tfcc-hb`, compact chip, collapsed "16", Show text | 3, 9 |
| 4.2 / 13f nav grid, v1 numerals, names, no More; 13c pill placement | 10 |
| 4.3 filter line, Filters "N active", grid | 11 |
| 4.4 / 13e rows, title band, one-tap Read (check only), Actions, drawer, priority in meta | 12 |
| 5 ResizeObserver on `#tfcc-panel`, hysteresis, fallback, media query split, ADR ruling | 6, 15, 18 |
| 6 state machine, reconciliation, focus rules, dirty inputs, live region | 4, 5, 7, 12, 13, 14 |
| 7 desktop unchanged | 1 (and every task's parity run) |
| 8 accessibility: 44px, names, aria-expanded/controls, no pseudo targets, contrast | 9-12, 15, 16 |
| 9 #8 auto-hide, Expand, chip/shelf, cap, drafts, search survive | 7, 12 (auto-hide tests), existing suites |
| 10 tests list, mutation entries | every task, 17 |
| 13d info buttons and the audit table | 8 |

## Plan review resolutions

The Codex adversarial review of the first version of this plan (gpt-5.6-sol, high effort) is recorded verbatim at `docs/records/review/2026-10-09-mobile-condense-plan-codex.md`. Verdict: rework. 13 findings plus 2 specific decisions: **11 accepted, 2 modified, 0 rejected**; both specific decisions accepted.

| # | Finding | Verdict | Reason | Task changed |
|---|---|---|---|---|
| 1 | Blocker: the 300ms timer starts on `pointerdown`, so a slow press loses its target; the test advanced time by the constant it tested | Accepted | The flush is armed only by `pointerup`, on the panel or (capture phase) on the window, so a press can never hold redraws forever. Tests assert the literal 300, hold the pointer for 1000ms with no redraw, and never advance time by `PRESS_FLUSH_MS` (CLAUDE.md lines 52-55) | 14, 17 |
| 2 | Blocker: the thread-link branch flushed the held redraw synchronously inside the click | Accepted | The link branch never redraws during dispatch; it schedules the flush with a zero delay, after `onThreadLink`'s own zero-delay redraw (`torn-forum-command-center.user.js:5839-5842`). New test: dirty field, plain thread-link tap, auto-hide | 14, 17 |
| 3 | Major: crossing the breakpoint cleared `drawerEdit`, and a forced async completion could then destroy the only typed value | Accepted | `drawerEdit` now lives until its field commits (it survives every transient reset and reconciliation, and renders in the wide row too). Every promise completion in `makeHandlers` uses a non-forced `quietRedraw`, so the caret guard defers it. New test: type, rotate, let a refresh complete, blur, value persists | 4, 6, 12, 14, 17 |
| 4 | Major: the golden held only three complete views; new unscoped wide CSS could pass | Accepted | The golden holds every complete wide view plus loading and error, captured before any code change. The 13d changes are literal `from`/`to` replacements in `tests/wide-13d-diffs.js`, each `from` required exactly once in main's output. Every new rule must contain `.tfcc-narrow` or be one of eight listed 13d selectors | 1, 8, 9, 13 |
| 5 | Major: `lastRender` updated even when the rewrite was deferred | Accepted | `lastRender` updates only when `renderPanel` actually rewrote the panel. New test: a deferred redraw drops row 2, then a tap on row 2's stale Actions still lands focus on row 3 | 13, 17 |
| 6 | Major: a text field's `change` captured a plan that pulled focus back into the field after Tab | Accepted | Text fields bring no focus plan. Their commit redraws one tick later from wherever focus landed: Tab lands on the next control, Enter stays in the field. Tests: Tab from tag to note, Tab from note to the next row's Actions, Enter in the filter | 13, 17 |
| 7 | Major: the info audit iterated production constants | Accepted | `tests/info.test.js` carries the owner's 13d map literally (keys, names, hidden, visible and removed texts) and checks it at 900 and 343px. One mutation per audited item: 9 info buttons and 5 shortened texts | 8, 17 |
| 8 | Major: the ADR gate began after bootstrap and accepted any `[data-act=` prefix | Accepted | The harness records every `document.querySelector` from the moment the sandbox exists. The runtime test checks an exact whitelist (mount, reply box, and the four `valueOf` controls). A static audit pins every `querySelector` call site in the source | 2, 13, 17 |
| 9 | Major: `reset-all` replaced the settings without the transient reset | Accepted | Every wholesale settings replacement goes through `replaceSettings` (reset-all, auto-refresh, rows-shown, auto-hide). Reset-all also drops the edit mirror. New tests for reset-all and for replacements that keep the view | 7, 17 |
| 10 | Major: collapsed 320 was 36.5 in the spec but 38.5 in the plan; Task 16 never checked header height | Modified | Neither number. Recomputed from the 13b algorithm with Show re-measured at each size (55.4 + 0.4 x s, from 13b's own 65px at 24px and the padding clamp): 37 at 320 and 24.5 at 280. The spec line is corrected in this branch with a note. The contrast audit now fails an expanded header taller than one button row | 3, 9, 16; spec 13b |
| 11 | Minor: loading and fatal headers were not branched | Modified | Branched to the narrow header (scaled logo, the chip's narrow box) but without controls, because main's loading and fatal headers have none (`torn-forum-command-center.user.js:5371-5378`) and fatal keeps its own Try again. `fitHeader` keeps 44px when there are no buttons to fit | 9, 17 |
| 12 | Minor: the custom-key copy was chosen to fit an old test | Accepted | The owner's words, "Opens Torn in a new tab with only this script's selections.", with `tests/custom-key.test.js` updated to assert that disclosure | 8, 17 |
| 13 | Minor: the QA budget line hard-coded 13/17 | Accepted | Qualified "at default settings (Activity lookups per refresh = 10)", with the values at 4 lookups | 18 |
| D1 | The "Public Only" test loosening | Accepted (by the reviewer) | Kept, with a direct assertion on the visible ToS access-level row in `tests/info.test.js` as well as `KEY_HELP_ROW` in `tests/style.test.js` | 8 |
| D2 | The 300ms press timer | Accepted | The same change as finding 1 | 14 |

**Every intermediate commit stays green.** Checked task by task after the revision. Task 1 leaves `tests/wide-13d-diffs.js` empty, so the full-view comparison holds against main. Each 13d change lands in Task 8 together with its replacement entry and the updated tests (`style.test.js`, `panel.test.js`, `custom-key.test.js`). The `.tfcc-narrow` scoping rule is enforced from Task 1 with the 13d selectors already listed. `.tfcc-sr` is narrow-scoped in Task 9, and the live region is narrow-only. `replaceSettings` (Task 7) needs only `applyTransient` (Task 6). The text-field commit deferral (Task 13) changes only redraws reached through the panel's own `change` listener; handlers called directly in existing suites still redraw at once. If a pre-existing suite dispatches a text-field `change` through the panel and reads the HTML straight away, add `env.advanceTimersBy(0)` before its read: that changes when it looks, not what it asserts. No reordering was needed.

## Spec ambiguities resolved in this plan

1. **320px header size: 41 or 41.5?** Spec 13b's algorithm (largest size in 0.5px steps that fits) gives 41.5 for C = 270 and a 72px chip; its table rounds to "about 41" from the mockup measurement. The algorithm wins: tests assert 41.5 (Task 3).
2. **Does the collapsed "16" enter the header solve?** The mockup's `fitHeader` leaves it out, and the spec says the badge "is what wraps beneath the logo when space runs out". The solve excludes it (Task 9).
3. **Below the floor.** `headerButtonSize` returns `{ size: 24, fits: false }` instead of the mockup's silent 24, so the "never below 24, never wraps the buttons" promise is testable (Task 3).
4. **What counts as an active filter?** Folder and tag only; Sort is an order and Unread has its own visible toggle (Task 3).
5. **View heading on desktop.** The spec's heading belongs to the narrow focus rules; adding it to wide would change desktop markup. Wide falls back to the pressed nav cell instead (Task 5, Task 12).
6. **Background redraws and focus.** Rule 4 ("never move focus") and the table row "refresh removes the open row: if focus was in that row, next row" read together as: a background redraw restores focus only if focus was already inside the panel, and never pulls it in (Task 13).
7. **Shortened custom-key line.** The owner's 13d wording, "Opens Torn in a new tab with only this script's selections.", is used as written, and `tests/custom-key.test.js` is updated to assert the same disclosure in those words (Task 8; changed by the plan review).
8. **Shortened key note vs the key-help test.** The short note no longer says "Public Only"; the test now pins the ToS access-level row for that, and pins the short note for naming only Minimal Access (Task 8).
9. **Tapping the current view's nav cell.** Treated as no view change, so it does not close an open drawer (Task 7).
10. **The 300ms press flush.** Armed only by `pointerup` (on the panel, or on the window when the pointer lifts elsewhere), so a press may last as long as it likes; 300ms after the lift with no click, the held redraw is flushed (Task 14; changed by the plan review).
11. **The live region.** Rendered inside the panel and announced once, the badge toast's accepted precedent, rather than a node outside the panel (which would be a new insert into Torn's mount). Narrow only, so desktop markup stays main's. A QA line checks TalkBack really speaks it (Task 13, Task 18).
12. **Drawers and `aria-controls`.** Every row renders its drawer element, empty and `hidden` while closed, so `aria-controls` always names a real element without duplicating every control per row (Task 12).
13. **Collapsed header size at 320 and 280.** Spec 13b said 36.5 and "reaches the 24px floor". Its own algorithm, with Show re-measured at each size (55.4 + 0.4 x s, from 13b's 65px at 24px and the padding clamp), gives 37 and 24.5. This is arithmetic, not a decision, so the spec line is corrected in this branch with a note, and the tests assert 37 and 24.5 (Task 9).
14. **Spec 6, dirty inputs rule 4 ("closing a drawer with an uncommitted tag field discards that text").** The drawer mirror now lives until its field commits (plan review). In practice nothing changes: closing a drawer is a tap, the tap blurs the field, and blur commits it, as today. The mirror only matters when a node is destroyed without a blur (a rotation, a forced redraw), and then keeping the text is the point (Task 4, Task 12, Task 14).
15. **Which redraws are "background".** Every promise completion in `makeHandlers` (refresh, My posts, deep search, key check) now uses the non-forced `quietRedraw`, so the caret guard defers it like an auto refresh. The synchronous redraw of the tap that started the work stays forced (Task 14).

## Stop conditions

Stop and amend this plan (and, if needed, the spec) if any of these becomes necessary:

- reading the userscript whole, or editing a symbol not named in a task;
- an engine function needing anything that is not an argument;
- any request, endpoint or budget change, or a `document.querySelector` outside the mount, the reply box and `[data-act=...]`;
- regenerating `tests/fixtures/wide-golden.json`, or any wide markup change beyond the 13d info buttons and shortened texts;
- a mutation that cannot be made to bite without weakening another test.

## Completion gate

Done when `npm test`, `npm run test:syntax` and `git diff --check origin/main` pass, every mutation in `node tests/mutation-check.mjs` (output redirected to a file) reports `OK`, the narrow previews pass `tests/contrast-audit.mjs` (or the run is recorded as not measured because browse is missing), the `[Unreleased]` CHANGELOG entry is present with no version bump, and the branch is pushed. Release stays blocked on the new "Narrow view (#33)" block of `docs/qa-checklist.md`, walked on a real signed-in account in Torn PDA.
