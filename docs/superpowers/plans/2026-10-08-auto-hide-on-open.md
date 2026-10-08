# Auto-hide on opening a thread Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Settings option, off by default, that collapses the panel (and leaves takeover) when the user plain-clicks a thread link the panel rendered, persisting the collapse before the browser follows the link.

**Architecture:** Two pure engine helpers decide (`isPlainActivation`, `autoHideSettings`) and a third fixes a false "damaged" report on upgrade (`isRecoveredValue`). Every thread anchor the panel renders gains a `data-tfcc-thread` marker. The panel's existing delegated click listener finds a marked anchor with a bounded walk that stops at the panel (`threadLinkOf`) and calls a new `handlers.onThreadLink`, which persists synchronously and redraws one tick later. No access to Torn's markup is added (ADR 0001).

**Tech Stack:** One plain-JS userscript (`torn-forum-command-center.user.js`, ES5 style, ASCII only), Node's built-in `node:test` runner over a VM harness (`tests/load-userscript.js`). No dependencies.

**Spec:** `docs/superpowers/specs/2026-10-08-auto-hide-on-open-design.md`

## Global Constraints

- **Never read `torn-forum-command-center.user.js` whole.** It is about 150 KB. `grep -n` for the symbol (the code map at `docs/code-map.md` may be stale), then `Read` with `offset`/`limit` around it. Line numbers below are from `884f614` and will drift; grep first.
- Source is **ASCII only** (`tests/metadata.test.js`). No curly quotes, no apostrophes in new user-facing strings unless escaped as `\'`; the planned strings need none.
- The **engine section** (between `// ---- ENGINE START` and `// ---- ENGINE END`) is pure (`tests/purity.test.js`): no `document`, `window`, `location`, `setTimeout`, `GM_*`, `Date.now`. The three new engine helpers take everything as arguments.
- **ADR 0001:** no new access to Torn's markup. The click listener is the panel's own delegated listener on `#tfcc-panel`; `threadLinkOf` never reads above the panel. Say so in the PR description.
- **Read-only** (`tests/read-only.test.js`): the script initiates no navigation (no `location.href =`, `assign`, `replace`), no `.click()`, no synthetic event, no new `.focus()`. The browser's own default action on the user's click navigates.
- Setting: `settings.autoHideOnOpen`, default `false`, normalised `raw.autoHideOnOpen === true`. `SCHEMA_VERSION` stays `1`. Not exported.
- On auto-hide: `collapsed: true` **and** `takeover: false`, persisted **synchronously inside the click handler**; redraw is `setTimeout(..., 0)`, guarded by `isForumsPage(win.location)`.
- Only a plain activation: `button` 0 or absent; `ctrlKey`, `metaKey`, `shiftKey`, `altKey`, `defaultPrevented` all not `true`.
- Panel links only. `syncToRoute`/`captureVisit` are **not** changed.
- Settings label, exactly: `Hide the panel when I open a thread`. Checkbox `id="tfcc-autohide"`, `data-act="auto-hide"`, in Appearance after the autosave checkbox.
- Settings note, exactly: `Only thread links in this panel do this, and only a plain click. Opening a link in a new tab, or following links on the Torn page itself, leaves the panel as it is. Press Show to bring it back.`
- **Version:** the feature PR adds only a CHANGELOG entry under `## [Unreleased]`. It never touches `@version`, `SCRIPT_VERSION` or `package.json`. A later, separate release commit bumps all three, renames the heading, and is tagged (CLAUDE.md rule 8).
- `@match`, `@grant`, `@connect`: unchanged.
- Commits: conventional prefix, **no attribution footer, no Co-Authored-By**.
- Verification after every task: `npm test` and `npm run test:syntax`. After Task 6 and before the PR: `node tests/mutation-check.mjs > mutation.log 2>&1`, then read `mutation.log`. **Never pipe the mutation check into `head` or anything that closes the pipe early.** Delete `mutation.log` afterwards; do not commit it.

## Review Focus

1. **Upgrade from 0.1.0.** A user whose stored settings predate the field must not be told "Settings were damaged and have been reset." Pinned in Task 1 (`a settings blob saved by 0.1.0 is not reported as damaged`).
2. **Clicking the thread you are already on.** No `hashchange` fires, so only the deferred redraw collapses the panel. Pinned in Task 4 (`clicking the thread you are already on collapses without a hash change`).
3. **A click on text inside a link, or on a node with no `getAttribute`.** The walk must still find the anchor and must not throw. Pinned in Task 4 (`the link walk finds our marked anchor and never reads past the panel`).
4. **Keyboard Enter on a link.** Browsers deliver it as a `click` with `button: 0` and no modifiers; it must collapse. Pinned in Task 2 (`{}` and plain objects count) and walked in QA.
5. **A prevented click.** Something else cancelled navigation; collapsing would leave the user on the same page with the panel gone. Pinned in Task 2 and Task 4 (`defaultPrevented: true` changes nothing).

---

## File Structure

| File | Change | Responsibility |
|---|---|---|
| `torn-forum-command-center.user.js` | Modify | Setting, three engine helpers, link marker, click path, Settings control |
| `tests/auto-hide.test.js` | Create | Every promise of this feature, one suite, so each mutation names one file |
| `tests/load-userscript.js` | Modify | `EXPORT_NAMES` gains the new names |
| `tests/mutation-check.mjs` | Modify | Eight new entries |
| `docs/qa-checklist.md` | Modify | Auto-hide lines for PDA and desktop |
| `docs/architecture.md` | Modify | One paragraph: the panel's own click listener is not a Torn DOM path |
| `CHANGELOG.md` | Modify | `[Unreleased]` entry |
| `docs/code-map.md` | Regenerate | `/code-map` after the source moves |

---

### Task 0: Branch

**Files:** none.

- [ ] **Step 1: Create the feature worktree** (superpowers:using-git-worktrees)

The spec and this plan live on `docs/8-auto-hide-plan`, not on `main`. Branch from `origin/main` once the docs PR has merged; until then branch from `origin/docs/8-auto-hide-plan` instead, or the implementer will not find the spec. Run from the main checkout, not from inside `.claude/worktrees/`.

```bash
git fetch origin
git worktree add ../tfcc-8-auto-hide -b feat/8-auto-hide-on-open origin/main   # or origin/docs/8-auto-hide-plan
cd ../tfcc-8-auto-hide
npm test
```

Expected: all suites pass on a clean `main`.

---

### Task 1: The setting, and an upgrade that is not called damage

**Files:**
- Modify: `torn-forum-command-center.user.js` (`settingsDefaults` ~l.304, `normaliseSettings` ~l.330, new `isRecoveredValue` after `normaliseSettings`, `loadKey` ~l.1568, `buildPanelModel` model `settings` block ~l.2580)
- Modify: `tests/load-userscript.js` (`EXPORT_NAMES`)
- Create: `tests/auto-hide.test.js`

**Interfaces:**
- Produces: `settings.autoHideOnOpen: boolean` (default `false`); `model.settings.autoHideOnOpen`; engine `isRecoveredValue(raw, value) -> boolean`.

- [ ] **Step 1: Create the suite with the storage tests**

Create `tests/auto-hide.test.js`:

```js
'use strict';

// Issue #8: hide the panel when the user opens a thread from it.
// Spec: docs/superpowers/specs/2026-10-08-auto-hide-on-open-design.md

const test = require('node:test');
const assert = require('node:assert');
const { loadUserscript, FORUMS_LOCATION } = require('./load-userscript');

const NOW = 1700000000000;
const THREAD_HASH = '#/p=threads&f=61&t=5&b=0&a=0';

function forums(extra) {
  return Object.assign({}, FORUMS_LOCATION, extra || {});
}

function panelOf(env) {
  return env.doc.getElementById('tfcc-panel');
}

function storedSettings(env) {
  const raw = env.gmStore.get('tfcc:settings');
  return raw ? JSON.parse(raw) : null;
}

// ---- storage ---------------------------------------------------------------

test('the setting defaults off and only a real true turns it on', () => {
  const { exports: api } = loadUserscript();
  assert.strictEqual(api.freshSettings().autoHideOnOpen, false);
  for (const bad of ['true', 1, 'yes', null, undefined, {}, []]) {
    assert.strictEqual(api.normaliseSettings({ v: 1, autoHideOnOpen: bad }).autoHideOnOpen, false,
      'corrupt must mean off: ' + JSON.stringify(bad));
  }
  assert.strictEqual(api.normaliseSettings({ v: 1, autoHideOnOpen: true }).autoHideOnOpen, true);
});

test('the setting round-trips through storage and survives a reload', () => {
  const first = loadUserscript({ location: forums(), now: NOW });
  first.exports.state.settings.autoHideOnOpen = true;
  first.exports.persist('settings');
  assert.strictEqual(storedSettings(first).autoHideOnOpen, true);

  const again = loadUserscript({
    location: forums(), now: NOW,
    gmStore: [['tfcc:settings', first.gmStore.get('tfcc:settings')]],
  });
  assert.strictEqual(again.exports.state.settings.autoHideOnOpen, true);
  assert.strictEqual(again.exports.buildPanelModel(NOW).settings.autoHideOnOpen, true,
    'the Settings view reads model.settings, so the model must carry it');
});

test('a settings blob saved by 0.1.0 is not reported as damaged', () => {
  // 0.1.0 wrote every field it knew, in settingsDefaults order, and nothing
  // else. A field this release adds is absent from it. That is an upgrade, and
  // telling the user their settings were reset would be false.
  const { exports: api } = loadUserscript();
  const old = api.freshSettings();
  delete old.autoHideOnOpen;

  const env = loadUserscript({ location: forums(), now: NOW, gmStore: [['tfcc:settings', JSON.stringify(old)]] });
  const notices = env.exports.state.notices.map((n) => n.text).join(' ');
  assert.doesNotMatch(notices, /Settings were damaged/);

  const res = env.exports.loadKey('tfcc:settings', env.exports.normaliseSettings, NOW);
  assert.strictEqual(res.recovered, false);
  assert.strictEqual(res.value.autoHideOnOpen, false);
});

test('a setting that is present but invalid is still reported', () => {
  const { exports: api } = loadUserscript();
  const bad = api.freshSettings();
  bad.collapsed = 'yes';
  const env = loadUserscript({ location: forums(), now: NOW, gmStore: [['tfcc:settings', JSON.stringify(bad)]] });
  const res = env.exports.loadKey('tfcc:settings', env.exports.normaliseSettings, NOW);
  assert.strictEqual(res.recovered, true, 'forgiving absent fields must not forgive wrong ones');
});

test('isRecoveredValue forgives only absent top-level fields', () => {
  const { exports: api } = loadUserscript();
  assert.strictEqual(api.isRecoveredValue(null, { a: 1 }), false, 'never stored is not a recovery');
  assert.strictEqual(api.isRecoveredValue({ a: 1 }, { a: 1, b: false }), false, 'an added field');
  assert.strictEqual(api.isRecoveredValue({ a: 'x' }, { a: 1 }), true, 'a changed value');
  assert.strictEqual(api.isRecoveredValue({ a: 1, z: 1 }, { a: 1 }), true, 'a dropped field');
  assert.strictEqual(api.isRecoveredValue('text', { a: 1 }), true, 'not an object at all');
  assert.strictEqual(api.isRecoveredValue({ n: { a: 1 } }, { n: { a: 1, b: 0 } }), true,
    'nested shapes keep the strict comparison');
});
```

- [ ] **Step 2: Export the new name**

In `tests/load-userscript.js`, in `EXPORT_NAMES`, change the storage-normalisers line:

```js
  'loadKey', 'saveKey', 'loadApiKey', 'saveApiKey', 'isKeyShaped',
```

to:

```js
  'loadKey', 'saveKey', 'loadApiKey', 'saveApiKey', 'isKeyShaped', 'isRecoveredValue',
```

- [ ] **Step 3: Run to see it fail**

Run: `node --test tests/auto-hide.test.js`
Expected: FAIL. `the setting defaults off` (`undefined !== false`), `round-trips` (`undefined`), `isRecoveredValue` (`api.isRecoveredValue is not a function`). The two damage tests pass for now; that is expected, because the field does not exist yet.

- [ ] **Step 4: Add the field**

In `settingsDefaults`, after `hideTornBox: false,`:

```js
      hideTornBox: false,
      // Issue #8. Off by default: an existing user sees no change.
      autoHideOnOpen: false,
```

In `normaliseSettings`, after `out.hideTornBox = raw.hideTornBox === true;`:

```js
    out.autoHideOnOpen = raw.autoHideOnOpen === true;
```

In `buildPanelModel`'s `settings: { ... }` block, after `hideTornBox: s.hideTornBox,`:

```js
        autoHideOnOpen: s.autoHideOnOpen,
```

- [ ] **Step 5: Run, and watch the upgrade test go red**

Run: `node --test tests/auto-hide.test.js`
Expected: `defaults off` and `round-trips` PASS. `a settings blob saved by 0.1.0 is not reported as damaged` now FAILS with a "Settings were damaged" match. This is the trap the spec describes, observed.

- [ ] **Step 6: Add `isRecoveredValue` and use it in `loadKey`**

In the engine, directly after the closing `}` of `normaliseSettings` and before `function freshOrganizer`:

```js
  // An upgrade adds a top-level field the stored value never had. Filling those
  // from the normalised value before comparing keeps "damaged" meaning damaged:
  // a field that was present and changed, or one the normaliser dropped. Nested
  // shapes keep the strict comparison on purpose (spec: "The upgrade trap").
  function isRecoveredValue(raw, value) {
    if (raw === null) return false;
    var seen = isPlainObject(raw) && isPlainObject(value) ? Object.assign({}, value, raw) : raw;
    return JSON.stringify(seen) !== JSON.stringify(value);
  }
```

In `loadKey` (runtime, ~l.1574), replace:

```js
    var recovered = raw !== null && JSON.stringify(raw) !== JSON.stringify(value);
```

with:

```js
    var recovered = isRecoveredValue(raw, value);
```

- [ ] **Step 7: Run everything**

Run: `node --test tests/auto-hide.test.js`
Expected: PASS (5 tests).

Run: `npm test && npm run test:syntax`
Expected: PASS. `tests/storage.test.js` "a damaged key is reported" and "a value that will not parse is reported" still pass: a present-but-wrong field and `PARSE_FAILED` are unaffected.

- [ ] **Step 8: Commit**

```bash
git add torn-forum-command-center.user.js tests/load-userscript.js tests/auto-hide.test.js
git commit -m "feat: autoHideOnOpen setting, and stop calling an upgrade damage (#8)"
```

---

### Task 2: Pure decisions

**Files:**
- Modify: `torn-forum-command-center.user.js` (engine, directly after `isRecoveredValue`)
- Modify: `tests/load-userscript.js`
- Test: `tests/auto-hide.test.js`

**Interfaces:**
- Consumes: `settings.autoHideOnOpen` (Task 1).
- Produces: `isPlainActivation(click) -> boolean`, where `click` is `{ button, ctrlKey, metaKey, shiftKey, altKey, defaultPrevented }`; `autoHideSettings(settings) -> settings` (same object when off; a copy with `collapsed: true, takeover: false` when on).

- [ ] **Step 1: Write the failing tests**

Append to `tests/auto-hide.test.js`:

```js
// ---- engine ----------------------------------------------------------------

const PLAIN = Object.freeze({
  button: 0, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, defaultPrevented: false,
});

test('only a plain activation counts', () => {
  const { exports: api } = loadUserscript();
  assert.strictEqual(api.isPlainActivation(Object.assign({}, PLAIN)), true);
  assert.strictEqual(api.isPlainActivation({}), true, 'Enter on a link carries button 0, or none at all');
  for (const k of ['ctrlKey', 'metaKey', 'shiftKey', 'altKey', 'defaultPrevented']) {
    assert.strictEqual(api.isPlainActivation(Object.assign({}, PLAIN, { [k]: true })), false, k);
  }
  assert.strictEqual(api.isPlainActivation(Object.assign({}, PLAIN, { button: 1 })), false, 'middle button');
  assert.strictEqual(api.isPlainActivation(Object.assign({}, PLAIN, { button: 2 })), false, 'right button');
  for (const bad of [null, undefined, 'click', 0, []]) {
    assert.strictEqual(api.isPlainActivation(bad), false, 'not a click: ' + String(bad));
  }
});

test('auto-hide collapses and leaves takeover only when the setting is on', () => {
  // rawExports: the wrapped exports copy return values, and this test is about identity.
  const raw = loadUserscript().rawExports;

  const off = Object.assign(raw.freshSettings(), { takeover: true });
  assert.strictEqual(raw.autoHideSettings(off), off, 'off returns the same object, so nothing is written');

  const on = Object.assign(raw.freshSettings(), { autoHideOnOpen: true, takeover: true });
  const out = raw.autoHideSettings(on);
  assert.notStrictEqual(out, on);
  assert.strictEqual(out.collapsed, true);
  assert.strictEqual(out.takeover, false, 'a collapsed panel in takeover still covers the thread');
  assert.strictEqual(out.autoHideOnOpen, true, 'the setting itself stays on');
  assert.strictEqual(on.collapsed, false, 'the argument is not mutated');
  assert.strictEqual(on.takeover, true, 'the argument is not mutated');

  assert.strictEqual(raw.autoHideSettings(null), null);
  assert.strictEqual(raw.autoHideSettings(undefined), undefined);
});
```

In `tests/load-userscript.js` `EXPORT_NAMES`, change:

```js
  'SCHEMA_VERSION', 'freshSettings', 'normaliseSettings',
```

to:

```js
  'SCHEMA_VERSION', 'freshSettings', 'normaliseSettings', 'isPlainActivation', 'autoHideSettings',
```

- [ ] **Step 2: Run to see it fail**

Run: `node --test tests/auto-hide.test.js`
Expected: FAIL, `api.isPlainActivation is not a function` and `raw.autoHideSettings is not a function`.

- [ ] **Step 3: Implement**

In the engine, directly after `isRecoveredValue`:

```js
  // -- auto-hide on opening a thread (issue #8) ---------------------------
  // Only a plain activation counts. A modified or middle click opens the
  // thread somewhere else, and the user still wants the panel in this tab.
  // A prevented click does not navigate, so it must not collapse either.
  function isPlainActivation(click) {
    if (!isPlainObject(click)) return false;
    if (toInt(click.button, 0) !== 0) return false;
    if (click.ctrlKey === true || click.metaKey === true) return false;
    if (click.shiftKey === true || click.altKey === true) return false;
    if (click.defaultPrevented === true) return false;
    return true;
  }

  // Returns the same object when the setting is off, so the caller can tell by
  // identity that there is nothing to write. A collapsed panel in takeover
  // still covers the whole viewport, so opening a thread leaves takeover too.
  function autoHideSettings(settings) {
    if (!isPlainObject(settings) || settings.autoHideOnOpen !== true) return settings;
    return Object.assign({}, settings, { collapsed: true, takeover: false });
  }
```

- [ ] **Step 4: Run**

Run: `node --test tests/auto-hide.test.js && node --test tests/purity.test.js`
Expected: PASS. Purity still passes: no DOM, no timer, no clock.

Run: `npm test && npm run test:syntax`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add torn-forum-command-center.user.js tests/load-userscript.js tests/auto-hide.test.js
git commit -m "feat: pure decisions for auto-hide on opening a thread (#8)"
```

---

### Task 3: Mark every thread link the panel renders

**Files:**
- Modify: `torn-forum-command-center.user.js` (`threadUrl` ~l.2591, `renderRow` ~l.2620, `renderSearchView` post hits ~l.2789, `renderDraftsView` list ~l.2839)
- Modify: `tests/load-userscript.js`
- Test: `tests/auto-hide.test.js`

**Interfaces:**
- Produces: `THREAD_LINK_ATTR = 'data-tfcc-thread'`, `THREAD_LINK_MAX_DEPTH = 4`, `threadLinkAttr(id) -> string` (`' data-tfcc-thread="<escaped id>"'`). Task 4 reads the attribute through `THREAD_LINK_ATTR`.

- [ ] **Step 1: Write the failing test**

Append to `tests/auto-hide.test.js`:

```js
// ---- markup ----------------------------------------------------------------

test('every thread link in every view carries the marker, and Search on Torn does not', () => {
  // Loops VIEWS, so a view added later (My posts, #2) is held to this too.
  const env = loadUserscript({ location: forums(), now: NOW });
  const api = env.exports;
  api.state.feed.subscribed = [5, 6].map((id) => api.normaliseSubscribedRow({
    id, forum_id: 61, title: 'Thread ' + id,
    author: { id: 3, username: 'someone', karma: 1 },
    posts: { new: 2, total: 10 },
  }));
  api.state.feed.categories = [{ id: 61, title: 'Tutorials', acronym: 'TG' }];
  api.state.drafts = api.saveDraft(api.freshDrafts(), 5, 'a draft', NOW, 'Thread 5');
  api.state.searchQuery = 'thread';
  api.state.searchResults = {
    mode: 'deep', query: 'thread',
    posts: [{ threadId: '6', threadTitle: 'Thread 6', postId: 9, authorName: 'x', at: NOW, text: 'body' }],
  };
  api.recompute(NOW);

  const perView = {};
  for (const view of api.VIEWS) {
    api.state.settings.view = view;
    const html = api.panelHtml(api.buildPanelModel(NOW));
    perView[view] = 0;
    for (const tag of html.match(/<a [^>]*>/g) || []) {
      if (/forums\.php#\/p=threads/.test(tag)) {
        perView[view] += 1;
        assert.match(tag, /data-tfcc-thread="\d+"/, view + ': unmarked thread link ' + tag);
      } else {
        assert.doesNotMatch(tag, /data-tfcc-thread/, view + ': a link that is not a thread is marked ' + tag);
      }
    }
  }
  // The fixture must actually reach every renderer, or the loop proves nothing.
  for (const view of ['threads', 'catchup', 'search', 'drafts']) {
    assert.ok(perView[view] > 0, view + ' rendered no thread link');
  }
  api.state.settings.view = 'search';
  assert.match(api.panelHtml(api.buildPanelModel(NOW)), /class="tfcc-linkbtn"/, 'Search on Torn was rendered and checked');
});
```

- [ ] **Step 2: Run to see it fail**

Run: `node --test tests/auto-hide.test.js`
Expected: FAIL, `threads: unmarked thread link <a href="https://www.torn.com/forums.php#/p=threads&amp;f=61...">`.

- [ ] **Step 3: Implement**

Directly after the `threadUrl` function:

```js
  // Purpose: marks an anchor the panel itself rendered as a link to a thread,
  // so the panel's own click listener can recognise it (issue #8). It is our
  // attribute on our markup, not a selector against Torn's, so Torn changing
  // its page cannot break it. Read only by threadLinkOf.
  var THREAD_LINK_ATTR = 'data-tfcc-thread';
  // Anchors hold text only today; the margin covers a later <mark> or <span>.
  var THREAD_LINK_MAX_DEPTH = 4;

  function threadLinkAttr(id) {
    return ' ' + THREAD_LINK_ATTR + '="' + escapeHtml(String(id)) + '"';
  }
```

In `renderRow`, replace:

```js
    out.push('<span class="tfcc-row-title"><a href="' + escapeHtml(threadUrl(row)) + '">'
      + escapeHtml(row.title) + '</a></span>');
```

with:

```js
    out.push('<span class="tfcc-row-title"><a href="' + escapeHtml(threadUrl(row)) + '"'
      + threadLinkAttr(row.id) + '>'
      + escapeHtml(row.title) + '</a></span>');
```

In `renderSearchView`, replace:

```js
        out.push('<div class="tfcc-hit"><div><a href="https://www.torn.com/forums.php#/p=threads&t='
          + hit.threadId + '&b=0&a=0">' + escapeHtml(hit.threadTitle) + '</a> '
```

with:

```js
        out.push('<div class="tfcc-hit"><div><a href="https://www.torn.com/forums.php#/p=threads&t='
          + hit.threadId + '&b=0&a=0"' + threadLinkAttr(hit.threadId) + '>' + escapeHtml(hit.threadTitle) + '</a> '
```

In `renderDraftsView`, replace:

```js
      out.push('<div class="tfcc-hit"><div><a href="https://www.torn.com/forums.php#/p=threads&t='
        + escapeHtml(dr.threadId) + '&b=0&a=0">'
```

with:

```js
      out.push('<div class="tfcc-hit"><div><a href="https://www.torn.com/forums.php#/p=threads&t='
        + escapeHtml(dr.threadId) + '&b=0&a=0"' + threadLinkAttr(dr.threadId) + '>'
```

Do **not** touch the Search on Torn anchor (`tfcc-linkbtn`).

In `tests/load-userscript.js` `EXPORT_NAMES`, change:

```js
  'ambientTransports', 'transportName', 'injectStyleOnce', 'copyText', 'threadUrl',
```

to:

```js
  'ambientTransports', 'transportName', 'injectStyleOnce', 'copyText', 'threadUrl',
  'THREAD_LINK_ATTR', 'THREAD_LINK_MAX_DEPTH', 'threadLinkAttr',
```

- [ ] **Step 4: Run**

Run: `node --test tests/auto-hide.test.js && node --test tests/panel.test.js`
Expected: PASS. `panel.test.js` "a row links to the thread on Torn" still matches, because the attribute follows the `href`.

Run: `npm test && npm run test:syntax`
Expected: PASS.

Run: `node tests/render-preview.mjs && node tests/contrast-audit.mjs`
Expected: every preview OK (no style change; this confirms it).

- [ ] **Step 5: Re-aim the existing escaping mutation**

The entry `'a thread title is written to the panel without escaping'` in
`tests/mutation-check.mjs` (~l.132) matches the exact `renderRow` anchor text
Step 3 just changed, so it would now report `SKIP ... stale`. Replace its
`apply` with:

```js
    apply: (s) => s.replace(
      "      + threadLinkAttr(row.id) + '>'\n      + escapeHtml(row.title) + '</a></span>');",
      "      + threadLinkAttr(row.id) + '>'\n      + row.title + '</a></span>');",
    ),
```

Then:

```bash
node tests/mutation-check.mjs > mutation.log 2>&1
```

Read `mutation.log` with the Read tool. Expected: that entry reads `OK`, and no
entry reads `SKIP`. Delete `mutation.log`.

- [ ] **Step 6: Commit**

```bash
git add torn-forum-command-center.user.js tests/load-userscript.js tests/auto-hide.test.js tests/mutation-check.mjs
git commit -m "feat: mark the thread links the panel renders (#8)"
```

---

### Task 4: The click path

**Files:**
- Modify: `torn-forum-command-center.user.js` (new `threadLinkOf` after `threadLinkAttr`; `renderPanel`'s delegated click listener ~l.3107; `makeHandlers` ~l.3363)
- Modify: `tests/load-userscript.js`
- Test: `tests/auto-hide.test.js`

**Interfaces:**
- Consumes: `isPlainActivation`, `autoHideSettings` (Task 2); `THREAD_LINK_ATTR`, `THREAD_LINK_MAX_DEPTH` (Task 3); `persist`, `isForumsPage`, `draw` (existing).
- Produces: `threadLinkOf(node, panel) -> element | null`; `handlers.onThreadLink(link, click) -> void`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/auto-hide.test.js`:

```js
// ---- runtime: the click ------------------------------------------------------

function loaded(settings, hash) {
  const gmStore = settings ? [['tfcc:settings', JSON.stringify(Object.assign({ v: 1 }, settings))]] : [];
  return loadUserscript({ location: forums({ hash: hash || '#/p=forums&f=61' }), now: NOW, gmStore });
}

function threadLink(env, id, parent) {
  const a = env.makeElement('a');
  a.setAttribute('data-tfcc-thread', String(id));
  a.parentNode = parent;
  return a;
}

function click(target, extra) {
  return Object.assign({ type: 'click', target }, PLAIN, extra || {});
}

test('a plain click on a panel thread link persists collapsed before navigation', () => {
  const env = loaded({ autoHideOnOpen: true });
  const panel = panelOf(env);
  assert.ok(panel, 'the panel mounted');
  assert.match(panel.innerHTML, /data-act="view"/, 'precondition: the panel is open');

  panel.dispatchEvent(click(threadLink(env, 5, panel)));

  // No timer has run yet. This is the moment the browser follows the link, so
  // a full page load from here must already find the panel hidden.
  assert.strictEqual(storedSettings(env).collapsed, true);
  assert.strictEqual(env.exports.state.settings.collapsed, true);

  env.advanceTimersBy(0);
  assert.doesNotMatch(panel.innerHTML, /data-act="view"/, 'only the header remains');
  assert.match(panel.innerHTML, /data-act="collapse">Show</);
});

test('with the setting off a thread link click changes nothing', () => {
  const env = loaded(null);
  const panel = panelOf(env);
  const before = env.gmStore.get('tfcc:settings');

  panel.dispatchEvent(click(threadLink(env, 5, panel)));
  env.advanceTimersBy(1000);

  assert.strictEqual(env.exports.state.settings.collapsed, false);
  assert.strictEqual(env.gmStore.get('tfcc:settings'), before, 'nothing was written');
  assert.match(panel.innerHTML, /data-act="view"/);
});

test('a new-tab click, a middle click and a prevented click change nothing', () => {
  const cases = [{ ctrlKey: true }, { metaKey: true }, { shiftKey: true }, { altKey: true },
    { button: 1 }, { defaultPrevented: true }];
  for (const extra of cases) {
    const env = loaded({ autoHideOnOpen: true });
    const panel = panelOf(env);
    panel.dispatchEvent(click(threadLink(env, 5, panel), extra));
    env.advanceTimersBy(1000);
    assert.strictEqual(env.exports.state.settings.collapsed, false, JSON.stringify(extra));
    // The seeded blob has no collapsed key and nothing persists, so assert "not true", not "false".
    assert.notStrictEqual(storedSettings(env).collapsed, true, JSON.stringify(extra));
  }
});

test('opening a thread from takeover leaves takeover', () => {
  const env = loaded({ autoHideOnOpen: true, takeover: true });
  const panel = panelOf(env);
  assert.strictEqual(panel.classList.contains('tfcc-takeover'), true, 'precondition');

  panel.dispatchEvent(click(threadLink(env, 5, panel)));
  assert.strictEqual(storedSettings(env).takeover, false);

  env.advanceTimersBy(0);
  assert.strictEqual(panel.classList.contains('tfcc-takeover'), false,
    'a collapsed panel in takeover would still cover the thread');
});

test('controls still dispatch, and a link that is not a thread does not collapse', () => {
  const env = loaded({ autoHideOnOpen: true });
  const panel = panelOf(env);

  const button = env.makeElement('button');
  button.setAttribute('data-act', 'unread-only');
  button.parentNode = panel;
  panel.dispatchEvent(click(button));
  assert.strictEqual(env.exports.state.settings.unreadOnly, true, 'data-act clicks are untouched');

  const searchOnTorn = env.makeElement('a');
  searchOnTorn.setAttribute('class', 'tfcc-linkbtn');
  searchOnTorn.parentNode = panel;
  panel.dispatchEvent(click(searchOnTorn));
  env.advanceTimersBy(0);
  assert.strictEqual(env.exports.state.settings.collapsed, false);
});

test('clicking the thread you are already on collapses without a hash change', () => {
  // Same href as the current hash: the browser fires no hashchange, so the
  // deferred redraw is the only thing that can draw the collapsed panel.
  const env = loaded({ autoHideOnOpen: true }, THREAD_HASH);
  const panel = panelOf(env);
  panel.dispatchEvent(click(threadLink(env, 5, panel)));
  env.advanceTimersBy(0);
  assert.doesNotMatch(panel.innerHTML, /data-act="view"/);
});

test('a hash change into the thread after the click keeps the panel collapsed', () => {
  const env = loaded({ autoHideOnOpen: true });
  const panel = panelOf(env);
  panel.dispatchEvent(click(threadLink(env, 5, panel)));

  env.advanceTimersBy(0);
  const drawn = panel.renderCount;
  env.win.location.hash = THREAD_HASH;
  env.win.fire('hashchange');
  env.advanceTimersBy(1000);
  assert.strictEqual(panel.renderCount, drawn, 'the collapsed header was already drawn, so the route draw writes nothing');

  assert.strictEqual(env.exports.state.route.isThread, true, 'the route followed the hash');
  assert.strictEqual(env.exports.state.settings.collapsed, true);
  assert.doesNotMatch(panel.innerHTML, /data-act="view"/);
});

test('a reload after the click arrives already hidden', () => {
  const env = loaded({ autoHideOnOpen: true });
  panelOf(env).dispatchEvent(click(threadLink(env, 5, panelOf(env))));

  const again = loadUserscript({
    location: forums({ hash: THREAD_HASH }), now: NOW,
    gmStore: [['tfcc:settings', env.gmStore.get('tfcc:settings')]],
  });
  assert.strictEqual(again.exports.state.settings.collapsed, true);
  assert.strictEqual(again.exports.state.settings.autoHideOnOpen, true);
  assert.doesNotMatch(panelOf(again).innerHTML, /data-act="view"/);
});

test('the link walk finds our marked anchor and never reads past the panel', () => {
  const env = loaded(null);
  const find = env.rawExports.threadLinkOf;
  const panel = panelOf(env);

  const a = threadLink(env, 5, panel);
  const span = env.makeElement('span');
  span.parentNode = a;
  assert.strictEqual(find(a, panel), a);
  assert.strictEqual(find(span, panel), a, 'a click on text inside the link');
  assert.strictEqual(find({ parentNode: a }, panel), a, 'a node with no getAttribute is stepped over');

  // A marked element above the panel must be invisible to the walk.
  const outside = env.makeElement('div');
  outside.setAttribute('data-tfcc-thread', '9');
  const otherPanel = env.makeElement('div');
  otherPanel.parentNode = outside;
  const inner = env.makeElement('span');
  inner.parentNode = otherPanel;
  assert.strictEqual(find(inner, otherPanel), null);

  // The walk is bounded.
  let node = env.makeElement('a');
  node.setAttribute('data-tfcc-thread', '1');
  for (let i = 0; i < 6; i += 1) {
    const child = env.makeElement('span');
    child.parentNode = node;
    node = child;
  }
  assert.strictEqual(find(node, panel), null);

  assert.strictEqual(find(null, panel), null);
  assert.strictEqual(find(undefined, panel), null);
  assert.strictEqual(find({}, panel), null);
});
```

In `tests/load-userscript.js` `EXPORT_NAMES`, extend the line added in Task 3:

```js
  'THREAD_LINK_ATTR', 'THREAD_LINK_MAX_DEPTH', 'threadLinkAttr', 'threadLinkOf',
```

- [ ] **Step 2: Run to see it fail**

Run: `node --test tests/auto-hide.test.js`
Expected: FAIL. `persists collapsed before navigation` (`false !== true`), `takeover` (precondition passes, then `true !== false`), the two hash tests and reload (`data-act="view"` still present), `link walk` (`find is not a function`). `setting off`, `new-tab click`, and `controls still dispatch` pass already; they guard against over-reach and must keep passing.

- [ ] **Step 3: Add `threadLinkOf`**

Directly after `threadLinkAttr`:

```js
  // Finds the thread anchor a click landed on, or inside. Reads only the panel's
  // own nodes: the walk stops at the panel and after THREAD_LINK_MAX_DEPTH steps,
  // so nothing of Torn's is ever read (ADR 0001). Every step is null-guarded.
  function threadLinkOf(node, panel) {
    var n = node;
    for (var i = 0; n && i < THREAD_LINK_MAX_DEPTH; i += 1) {
      if (n === panel) return null;
      if (typeof n.getAttribute === 'function' && n.getAttribute(THREAD_LINK_ATTR) !== null) return n;
      n = n.parentNode;
    }
    return null;
  }
```

- [ ] **Step 4: Route marked-link clicks in the delegated listener**

In `renderPanel`, replace:

```js
      panel.addEventListener('click', function (ev) {
        var t = ev && ev.target;
        var act = t && t.getAttribute ? t.getAttribute('data-act') : null;
```

with:

```js
      panel.addEventListener('click', function (ev) {
        var t = ev && ev.target;
        // A thread link the panel rendered. The browser follows it; this only
        // gives the auto-hide setting a chance to persist first (issue #8).
        var link = threadLinkOf(t, panel);
        if (link) {
          if (typeof handlers.onThreadLink === 'function') {
            handlers.onThreadLink(link, {
              button: ev.button, ctrlKey: !!ev.ctrlKey, metaKey: !!ev.metaKey,
              shiftKey: !!ev.shiftKey, altKey: !!ev.altKey, defaultPrevented: !!ev.defaultPrevented,
            });
          }
          return;
        }
        var act = t && t.getAttribute ? t.getAttribute('data-act') : null;
```

- [ ] **Step 5: Add `onThreadLink` to `makeHandlers`**

In `makeHandlers`, in the `handlers` object, before `onAction: function (act, el) {`:

```js
      // Not an act === case: a thread link is navigation the browser performs,
      // not a control, so tests/handlers.test.js does not pair it.
      onThreadLink: function (link, click) {
        if (!isPlainActivation(click)) return;
        var next = autoHideSettings(state.settings);
        if (next === state.settings) return;
        state.settings = next;
        persist('settings');
        // Deferred: redrawing now would replace the anchor while its click is
        // still being dispatched. It also covers a click on the thread already
        // open, where no hashchange will ever come.
        setTimeout(function () { if (isForumsPage(win.location)) redraw(); }, 0);
      },
```

- [ ] **Step 6: Run**

Run: `node --test tests/auto-hide.test.js`
Expected: PASS (all tests so far).

Run: `npm test && npm run test:syntax`
Expected: PASS. In particular `tests/read-only.test.js` (no navigation, no `.click()`, no new `.focus()`), `tests/handlers.test.js` (no new `act ===` case), `tests/panel.test.js` "rendering twice does not stack ... listeners" (still one click listener), `tests/redraw.test.js`.

- [ ] **Step 7: Commit**

```bash
git add torn-forum-command-center.user.js tests/load-userscript.js tests/auto-hide.test.js
git commit -m "feat: hide the panel when a thread is opened from it (#8)"
```

---

### Task 5: The Settings control

**Files:**
- Modify: `torn-forum-command-center.user.js` (`renderSettingsView` Appearance section ~l.2910; `makeHandlers` `onChange` ~l.3534)
- Test: `tests/auto-hide.test.js`

**Interfaces:**
- Consumes: `model.settings.autoHideOnOpen` (Task 1).
- Produces: `data-act="auto-hide"` checkbox and its `onChange` case.

- [ ] **Step 1: Write the failing test**

Append to `tests/auto-hide.test.js`:

```js
// ---- settings view -------------------------------------------------------------

test('the Settings checkbox shows the setting and saves a change', () => {
  const env = loadUserscript({ location: forums(), now: NOW });
  const api = env.exports;
  api.state.settings.view = 'settings';

  let html = api.panelHtml(api.buildPanelModel(NOW));
  assert.match(html, /<label for="tfcc-autohide">Hide the panel when I open a thread<\/label>/);
  assert.match(html, /<input id="tfcc-autohide" type="checkbox" data-act="auto-hide">/, 'unchecked by default');
  assert.match(html, /Only thread links in this panel do this, and only a plain click\./);

  const handlers = api.makeHandlers(env.doc, env.win);
  handlers.onChange('auto-hide', { getAttribute: () => null, checked: true, value: 'on' });
  assert.strictEqual(api.state.settings.autoHideOnOpen, true);
  assert.strictEqual(storedSettings(env).autoHideOnOpen, true, 'a change the user made must survive a reload');

  html = api.panelHtml(api.buildPanelModel(NOW));
  assert.match(html, /data-act="auto-hide" checked>/);

  handlers.onChange('auto-hide', { getAttribute: () => null, checked: false, value: '' });
  assert.strictEqual(storedSettings(env).autoHideOnOpen, false);
});
```

- [ ] **Step 2: Run to see it fail**

Run: `node --test tests/auto-hide.test.js`
Expected: FAIL on the label match.

- [ ] **Step 3: Render the control**

In `renderSettingsView`, directly after the autosave checkbox push (the line ending `+ (model.settings.autosaveDrafts ? ' checked' : '') + '></div>');`):

```js
    out.push('<div class="tfcc-kv"><label for="tfcc-autohide">Hide the panel when I open a thread</label>'
      + '<input id="tfcc-autohide" type="checkbox" data-act="auto-hide"'
      + (model.settings.autoHideOnOpen ? ' checked' : '') + '></div>');
    out.push('<p class="tfcc-note">Only thread links in this panel do this, and only a plain click. '
      + 'Opening a link in a new tab, or following links on the Torn page itself, leaves the panel '
      + 'as it is. Press Show to bring it back.</p>');
```

- [ ] **Step 4: Handle the change**

In `onChange`, directly after the `if (act === 'autosave') { ... }` block:

```js
        if (act === 'auto-hide') {
          state.settings.autoHideOnOpen = !!el.checked;
          persist('settings'); redraw(); return;
        }
```

- [ ] **Step 5: Run**

Run: `node --test tests/auto-hide.test.js && node --test tests/handlers.test.js`
Expected: PASS. `handlers.test.js` now sees `auto-hide` both rendered and handled.

Run: `npm test && npm run test:syntax`
Expected: PASS, including `tests/metadata.test.js` (ASCII).

Run: `node tests/render-preview.mjs && node tests/contrast-audit.mjs`
Expected: every preview OK (stock checkbox and `tfcc-note`).

- [ ] **Step 6: Commit**

```bash
git add torn-forum-command-center.user.js tests/auto-hide.test.js
git commit -m "feat: Settings checkbox for auto-hide on opening a thread (#8)"
```

---

### Task 6: Mutation-check entries

**Files:**
- Modify: `tests/mutation-check.mjs` (append to `MUTATIONS`, before the closing `];`)

**Interfaces:**
- Consumes: the exact source strings written in Tasks 1 to 4. If a step there was adapted, adapt the `apply` string to match, or the run reports `SKIP ... stale`.

- [ ] **Step 1: Append the entries**

Directly before the final `];` of `MUTATIONS`:

```js
  {
    name: 'auto-hide ignores its setting, so every thread link collapses the panel',
    suite: 'tests/auto-hide.test.js',
    apply: (s) => s.replace(
      "if (!isPlainObject(settings) || settings.autoHideOnOpen !== true) return settings;",
      'if (!isPlainObject(settings)) return settings;',
    ),
  },
  {
    name: 'a Ctrl-click into a new tab collapses the panel in this one',
    suite: 'tests/auto-hide.test.js',
    apply: (s) => s.replace(
      'if (click.ctrlKey === true || click.metaKey === true) return false;',
      'if (click.metaKey === true) return false;',
    ),
  },
  {
    name: 'opening a thread leaves takeover covering it',
    suite: 'tests/auto-hide.test.js',
    apply: (s) => s.replace(
      'return Object.assign({}, settings, { collapsed: true, takeover: false });',
      'return Object.assign({}, settings, { collapsed: true });',
    ),
  },
  {
    name: 'the collapse is persisted only after navigation has begun',
    suite: 'tests/auto-hide.test.js',
    apply: (s) => s.replace(
      "        persist('settings');\n        // Deferred: redrawing now",
      "        setTimeout(function () { persist('settings'); }, 0);\n        // Deferred: redrawing now",
    ),
  },
  {
    name: 'the auto-hide setting accepts any truthy value',
    suite: 'tests/auto-hide.test.js',
    apply: (s) => s.replace(
      'out.autoHideOnOpen = raw.autoHideOnOpen === true;',
      'out.autoHideOnOpen = !!raw.autoHideOnOpen;',
    ),
  },
  {
    name: 'a row link loses its thread marker',
    suite: 'tests/auto-hide.test.js',
    apply: (s) => s.replace("      + threadLinkAttr(row.id) + '>'", "      + '>'"),
  },
  {
    name: 'the thread link walk climbs out of the panel',
    suite: 'tests/auto-hide.test.js',
    apply: (s) => s.replace(
      'if (n === panel) return null;',
      'if (n === panel) { n = n.parentNode; continue; }',
    ),
  },
  {
    name: 'an upgrade that adds a setting is reported as damage again',
    suite: 'tests/auto-hide.test.js',
    apply: (s) => s.replace(
      'var seen = isPlainObject(raw) && isPlainObject(value) ? Object.assign({}, value, raw) : raw;',
      'var seen = raw;',
    ),
  },
```

Each mutation's expected catcher:

| Mutation | Test that fails |
|---|---|
| ignores its setting | `with the setting off a thread link click changes nothing`; `auto-hide collapses ... only when the setting is on` |
| Ctrl-click | `only a plain activation counts`; `a new-tab click, a middle click and a prevented click change nothing` |
| takeover | `opening a thread from takeover leaves takeover`; `auto-hide collapses ...` |
| persisted after navigation | `a plain click ... persists collapsed before navigation` (asserts storage before any timer runs) |
| any truthy value | `the setting defaults off and only a real true turns it on` |
| row marker | `every thread link in every view carries the marker` |
| walk climbs out | `the link walk finds our marked anchor and never reads past the panel` |
| upgrade is damage | `a settings blob saved by 0.1.0 is not reported as damaged`; `isRecoveredValue forgives only absent top-level fields` |

- [ ] **Step 2: Run the mutation check, redirected to a file**

```bash
node tests/mutation-check.mjs > mutation.log 2>&1
```

Then read `mutation.log` with the Read tool (not `head`).
Expected: every line `OK`, including the eight new ones; no `WEAK`, no `SKIP`, no `HUNG`; the last line reads `N/N promises are genuinely guarded.` If an entry reports `SKIP`, its `apply` string no longer matches the source: fix the string, not the source.

Confirm the source is pristine afterwards:

```bash
git status --short torn-forum-command-center.user.js
```

Expected: no output (the check restored it). Then `rm mutation.log`.

- [ ] **Step 3: Run**

Run: `npm test && npm run test:syntax`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add tests/mutation-check.mjs
git commit -m "test: mutation entries for auto-hide on opening a thread (#8)"
```

---

### Task 7: Docs, changelog, code map

**Files:**
- Modify: `docs/qa-checklist.md`
- Modify: `docs/architecture.md`
- Modify: `CHANGELOG.md`
- Regenerate: `docs/code-map.md`

- [ ] **Step 1: QA checklist**

In `docs/qa-checklist.md`, under `## Torn PDA` > `### Layout`, after the line `- [ ] Rotate the device while in takeover mode.`, add:

```markdown

### Hide on opening a thread

- [ ] Settings, tick "Hide the panel when I open a thread". Tap a thread in
      Threads: the thread opens and the panel shows only its header with Show.
- [ ] Reload the thread page: the panel is still collapsed.
- [ ] Show brings the panel back, and it stays open while you page through the
      thread and follow Torn's own links.
- [ ] In Expand (takeover), tap a thread in Catch up: takeover ends, the thread
      is readable, and the panel is collapsed. Show returns the inline panel.
- [ ] Repeat from Search (a thread row and a post hit) and from Drafts.
- [ ] Search on Torn does not collapse the panel.
- [ ] Long-press a thread link and open it in a new tab: the panel in this tab
      stays open.
- [ ] Tap the thread you are already on: the panel collapses.
- [ ] Untick the setting: tapping a thread leaves the panel open.
```

Under `## Desktop regression`, after `- [ ] Keyboard only: tab through the panel. Focus is always visible.`, add:

```markdown
- [ ] With "Hide the panel when I open a thread" on: a plain click on a thread
      collapses the panel and opens the thread; Ctrl-click and middle-click open
      it in a new tab and leave this panel open; Tab to a thread link and press
      Enter collapses it. Reload: still collapsed. Untick: nothing collapses.
- [ ] Same, from takeover: takeover ends and the thread is readable.
```

- [ ] **Step 2: Architecture note**

In `docs/architecture.md`, directly after the paragraph that begins `So no data path touches Torn's markup. DOM access exists in exactly two places,` add:

```markdown
The panel's own markup is not one of those places and is not a data path. Its
single delegated click listener on `#tfcc-panel` also recognises the thread
links the panel rendered, by a `data-tfcc-thread` attribute only the panel
writes, so the "Hide the panel when I open a thread" setting can persist a
collapse before the browser follows the link. The lookup (`threadLinkOf`)
stops at the panel and never reads Torn's nodes. The script still initiates no
navigation: the user's click does.
```

- [ ] **Step 3: CHANGELOG**

In `CHANGELOG.md`, under `## [Unreleased]`, replace `Nothing yet.` (or, if a sibling PR already landed an entry, add to its `### Added` and `### Fixed` lists) with:

```markdown
### Added

- Settings, Appearance: **Hide the panel when I open a thread**, off by
  default. A plain click on a thread link in the panel (Threads, Catch up,
  Search, Drafts, and My posts) collapses the panel and leaves Expand, then the
  thread opens. Show brings it back. New-tab clicks and Torn's own links leave
  the panel alone. (#8)

### Fixed

- Upgrading no longer reports "Settings were damaged and have been reset" just
  because a release added a setting. Nothing was being reset. (#8)
```

Do **not** touch `@version`, `SCRIPT_VERSION` or `package.json`.

- [ ] **Step 4: Refresh the code map**

Run the `/code-map` skill (daftplate:code-map). It rewrites `docs/code-map.md`.
Then:

```bash
grep -n "threadLinkOf\|autoHideSettings\|isPlainActivation\|isRecoveredValue" docs/code-map.md
```

Expected: all four appear with anchors.

- [ ] **Step 5: Full verification**

```bash
npm test
npm run test:syntax
node tests/mutation-check.mjs > mutation.log 2>&1
```

Read `mutation.log`: all `OK`. `rm mutation.log`. `git status --short` shows only the intended files.

Check the version did not move:

```bash
git diff origin/main -- package.json
git diff origin/main -- torn-forum-command-center.user.js | grep -n "@version\|SCRIPT_VERSION"
```

Expected: no output from either.

- [ ] **Step 6: Commit**

```bash
git add docs/qa-checklist.md docs/architecture.md CHANGELOG.md docs/code-map.md
git commit -m "docs: QA lines, architecture note, changelog and code map for auto-hide (#8)"
```

- [ ] **Step 7: PR description must state**

- ADR 0001: no new access to Torn's markup; the listener is the panel's own, and `threadLinkOf` stops at the panel.
- `@match`, `@grant`, `@connect` unchanged.
- No request; budget text unchanged.
- The upgrade fix (`isRecoveredValue`), and that #3's `rowsShown` and #4's `authorOnly` benefit from it, while #4's nested per-thread fields do not.
- Release is still blocked on the QA lines above, walked on Torn PDA and desktop.
- End the body at its last substantive line. No attribution footer.

---

## Sibling plans

- **#2 My posts (PR #5):** My posts rows use `renderRow`, so they carry the marker for free. The markup test in Task 3 loops `VIEWS`, so if #2 lands first, `mine` is checked here; if this lands first, #2's new view is held to it automatically. If #2 renders a thread anchor anywhere other than `renderRow` (for example a `f=0` link), it must call `threadLinkAttr(id)` or the test fails.
- **#3 Rows shown (PR #6):** no functional interaction (`rows-toggle` is a button). Adjacent-line conflicts in `settingsDefaults`, `normaliseSettings`, the model `settings` block, the Appearance section and `[Unreleased]`: keep both sides. `rowsShown` is covered by `isRecoveredValue`.
- **#4 Author-only (PR #7):** no functional interaction. Same adjacent-line conflicts in settings. `authorOnly` is covered by `isRecoveredValue`; its nested per-thread organizer fields are not, and #4 must handle that.
- **Release:** none of the four PRs bumps the version. One release commit later moves `@version`, `SCRIPT_VERSION`, `package.json` and the `[Unreleased]` heading together, and is tagged.
