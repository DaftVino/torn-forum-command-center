# Drafts rich editor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the Drafts view into a formatted-post editor:
- Text, MD, HTML and Preview modes;
- a toolbar;
- an image link fixer;
- Torn and Unicode emoji;
- free drafts;
- an Insert that actually reaches Torn's TinyMCE reply box, which also fixes #60.

**Architecture:**
- **Engine:** pure functions in the userscript's engine section: a tokenizer, an
  allowlist cleaner, Markdown to and from HTML, plain-text conversions, the
  preview model, the image fixer, contrast, and the editor operations. Tested in
  Node.
- **Runtime:** writes Torn's editor with a single marked synthetic `paste`
  (ADR 0002), copies with a `ClipboardItem`, and autosaves from the editor body.
- **View:** the Drafts view renders the editor from `state.editor`. Handlers
  edit `state.editor` and redraw.
- No new `@grant`, `@match` or `@connect`.

**Tech Stack:** a vanilla ES5-style userscript (one IIFE), `node:test`, the
existing `tests/load-userscript.js` vm harness, and `tests/mutation-check.mjs`.

**Spec:** `docs/superpowers/specs/2026-10-09-drafts-rich-editor-design.md`, with
`docs/adr/0002-write-the-reply-box-by-marked-paste.md`,
`docs/reference/torn-forum-editor-findings-2026-10-09.md` and
`docs/reference/image-host-link-rules-2026-10-09.md`.

**Reference code:** `docs/superpowers/plans/2026-10-09-drafts-rich-editor-reference.js`.
- It holds the engine code, prototyped and checked in Node before this plan was
  written. Tasks 1 to 6 paste named sections of it.
- It is the code, not a sketch: paste it verbatim, then make the task's tests
  pass. If a test shows the reference is wrong, fix both and say so in the
  commit message.

## Global Constraints

- **Never read `torn-forum-command-center.user.js` whole.** Grep
  `docs/code-map.md` for the symbol, then use `Read` with `offset`/`limit`.
- **The source is ASCII only** (`tests/metadata.test.js`).
  - Every non-ASCII character in a string or regex is a `\uXXXX` escape.
  - **Check after every paste:** `grep -nP '[^\x00-\x7F]' torn-forum-command-center.user.js`
    must print nothing.
  - One editor tool turned escapes into the characters themselves while this
    plan was being written.
- **The engine section is pure** (`tests/purity.test.js`): no DOM, no network,
  no `GM_*`, and no `Date.now`. Engine code goes between
  `// ---- ENGINE START` and `// ---- ENGINE END`. Runtime code goes after
  ENGINE END.
- **Exactly one `dispatchEvent` in the source.** After Task 8 it is the paste.
  Never `.click()`, `submit`, `requestSubmit` or a synthetic
  Mouse/Pointer/Keyboard/Touch event (`tests/read-only.test.js`).
- **DOM access to Torn's page** is the mount and the reply box only (ADR 0001,
  as amended by ADR 0002). The reply box selector is exactly
  `#editor-wrapper .editor-content.mce-content-body`.
- **New storage loads silently from older blobs.** An absent field takes its
  default. A draft's `lang` is omitted when it is Text. `free` and `draftLang`
  are top-level. Prove each with a test.
- **No version bump.** Add an `[Unreleased]` CHANGELOG entry only.
- **Wide parity.** Every wide change is an exact-line entry in
  `tests/wide-58-diffs.js`. `tests/fixtures/wide-golden.json` is never
  regenerated.
- **No attribution footer** on any commit or PR.
- **Every new function a test reaches** is added to `EXPORT_NAMES` in
  `tests/load-userscript.js`, in the same commit.
- **Commands:**
  - `npm test` (the suite);
  - `npm run test:syntax`;
  - `node tests/mutation-check.mjs > mutation.log 2>&1`. Never pipe it into
    `head`, because a SIGPIPE once corrupted the baseline.
- **Branch:** `feat/58-drafts-editor`, cut from `main` after the docs PR for
  `docs/58-editor-research` has merged. Never cut it from the docs branch.
- **Sizes** (spec section 4a):
  - `DRAFT_MAX_CHARS` stays 20000 and applies to the stored source. Any action
    whose result would exceed it is refused visibly, through
    `overLimitNotice(n)` (Task 10). Nothing is silently cut.
  - The cleaner reads at most `CLEAN_MAX_CHARS` = 1000000. It is a security
    bound that a real draft never reaches: the worst expansion measured is
    about 38 times. Task 1 pins it.
- **Line numbers in this plan drift.** They are from `62107f8`, and every
  engine insertion moves what follows. Locate code by symbol, with
  `grep -n "function name(" torn-forum-command-center.user.js`, then `Read`
  with offset and limit. Regenerate `docs/code-map.md` with `/code-map` at the
  end of Task 6 and Task 11, and again in Task 15.
- **Every task that edits the userscript** runs the ASCII grep in its test
  step, whether or not the step says so.
- **`mutation.log` is never committed.** Task 0 adds it to `.gitignore`, and
  every `git add` names its paths explicitly.

## Review Focus

The five inputs most likely to bite a player that no spec line spells out, with
the task that pins each:

1. **Windows line endings (`\r\n`) in a draft.** Every conversion normalises
   them, so `a\r\nb` converts exactly like `a\nb` (Task 2).
2. **Torn's editor already holds text when Insert is pressed.** The post is
   added after it, and nothing the player typed is replaced (Task 8).
3. **A Markdown draft near 20000 characters whose HTML is longer.** Insert and
   Copy send the whole post, uncut (Task 8).
4. **Switching MD, HTML, MD, HTML repeatedly.** After the first switch the text
   stops changing, so nothing drifts or grows (Task 3).
5. **An old draft holding raw HTML typed as text**, as the owner did in check
   3b. It loads as Text, and Preview shows the tags literally rather than
   rendering them (Task 11).

---

### Task 0: Branch, harness support for paste, selection and clipboard

**Files:**
- Modify: `tests/load-userscript.js`, in `makeSandbox` (the `windowStub` and the
  `makeElement` element)
- Test: `tests/harness.test.js`

**Interfaces:**
- Produces, on the sandbox window:
  - `DataTransfer`, with `setData(type, v)` and `getData(type)`;
  - `ClipboardEvent(type, init)`, which keeps `init.clipboardData`, `bubbles`
    and `cancelable`, has `preventDefault()`, and exposes `defaultPrevented`;
  - `getSelection()`, returning a log-backed stub;
  - `ClipboardItem(map)`;
  - `Blob(parts, opts)`;
  - `navigator.clipboard`, with `writeText(t)` and `write(items)` logged to
    `env.clipboardLog`.
- Produces on the document: `createRange()`, returning `{ selectNodeContents(n), collapse(b) }`.
- Produces on elements: `dispatchEvent(ev)` returns `!ev.defaultPrevented`, the
  real DOM contract.
- Produces on `env`: `env.selectionLog` and `env.clipboardLog`.

- [ ] **Step 1: Cut the branch**

```bash
git switch main && git pull --ff-only && git switch -c feat/58-drafts-editor
```

- [ ] **Step 2: Write the failing harness test** at the end of `tests/harness.test.js`

```js
test('#58: the harness models paste, selection and clipboard', () => {
  const env = loadUserscript();
  const w = env.sandbox.window;
  const dt = new w.DataTransfer();
  dt.setData('text/html', '<p>x</p>');
  assert.strictEqual(dt.getData('text/html'), '<p>x</p>');
  const ev = new w.ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true });
  assert.strictEqual(ev.clipboardData, dt);
  const box = env.makeElement('div');
  box.addEventListener('paste', (e) => e.preventDefault());
  assert.strictEqual(box.dispatchEvent(ev), false, 'a prevented event reports false');
  const range = env.doc.createRange();
  range.selectNodeContents(box);
  range.collapse(false);
  const sel = w.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
  assert.deepStrictEqual(env.selectionLog.map((x) => x.op), ['selectNodeContents', 'collapse', 'removeAllRanges', 'addRange']);
  w.navigator.clipboard.writeText('t');
  w.navigator.clipboard.write([new w.ClipboardItem({ 'text/plain': new w.Blob(['p'], { type: 'text/plain' }) })]);
  assert.deepStrictEqual(env.clipboardLog.map((x) => x.op), ['writeText', 'write']);
});
```

- [ ] **Step 3: Run it and watch it fail**

Run: `node --test tests/harness.test.js`
Expected: FAIL, `w.DataTransfer is not a constructor`.

- [ ] **Step 4: Implement it in `makeSandbox`**

Change the element's `dispatchEvent`, inside `makeElement`, to honour
`preventDefault`:

```js
      dispatchEvent(ev) {
        const list = (this._listeners && this._listeners[ev && ev.type]) || [];
        for (const fn of list.slice()) fn(ev);
        return !(ev && ev.defaultPrevented);
      },
```

Before `const windowStub = {`, add the logs:

```js
  const selectionLog = [];
  const clipboardLog = [];
```

Add these members to `windowStub`, after `Event:`:

```js
    DataTransfer: class FakeDataTransfer {
      constructor() { this._d = {}; }
      setData(type, v) { this._d[type] = String(v); }
      getData(type) { return Object.prototype.hasOwnProperty.call(this._d, type) ? this._d[type] : ''; }
    },
    ClipboardEvent: class FakeClipboardEvent {
      constructor(type, init) {
        this.type = type;
        this.bubbles = !!(init && init.bubbles);
        this.cancelable = !!(init && init.cancelable);
        this.clipboardData = (init && init.clipboardData) || null;
        this.defaultPrevented = false;
      }
      preventDefault() { if (this.cancelable) this.defaultPrevented = true; }
    },
    ClipboardItem: class FakeClipboardItem { constructor(map) { this.types = Object.keys(map); this.map = map; } },
    Blob: class FakeBlob { constructor(parts, opts) { this.parts = parts; this.type = (opts && opts.type) || ''; } },
    getSelection: () => ({
      removeAllRanges() { selectionLog.push({ op: 'removeAllRanges' }); },
      addRange(r) { selectionLog.push({ op: 'addRange', range: r }); },
    }),
    navigator: {
      clipboard: {
        writeText(t) { clipboardLog.push({ op: 'writeText', text: t }); return Promise.resolve(); },
        write(items) { clipboardLog.push({ op: 'write', items }); return Promise.resolve(); },
      },
    },
```

On the default `documentStub`, after `createTextNode`:

```js
    createRange: () => ({
      selectNodeContents(n) { selectionLog.push({ op: 'selectNodeContents', node: n }); },
      collapse(toStart) { selectionLog.push({ op: 'collapse', toStart }); },
    }),
```

Find the object `makeSandbox` returns, where `nativeSetterCalls` is exposed.
Add `selectionLog` and `clipboardLog` beside it, and make `loadUserscript`
pass them through to `env`, the same way `nativeSetterCalls` is passed.

- [ ] **Step 5: Run the harness test and the whole suite**

Run: `node --test tests/harness.test.js` and then `npm test`
Expected: PASS. The suite stays at its count plus 1, with no other change,
because nothing in the script calls these yet.

- [ ] **Step 6: Commit**

Add `mutation.log` to `.gitignore` (one line) first.

```bash
git add tests/load-userscript.js tests/harness.test.js .gitignore
git commit -m "test: harness models paste, selection and the async clipboard (#58)"
```

**Harness notes for later tasks:**
- The harness element's `getBoundingClientRect` returns width 0 for anything
  but the panel. A test that needs a visible Torn editor overrides it on that
  element, as `tinyBody` does in Task 7.
- `doc.querySelectorAll` answers from the sandbox's `selectors` table.
  Task 7's tests replace it directly.

---

### Task 1: Editor constants, the HTML tokenizer and the cleaner

**Files:**
- Modify: `torn-forum-command-center.user.js`, the engine section. Insert just
  before `// ---- ENGINE END`, after the drafts helpers (grep the code map for
  `draftList`).
- Modify: `tests/load-userscript.js` (`EXPORT_NAMES`)
- Create: `tests/editor-clean.test.js`

**Interfaces:**
- Produces these constants:
  - `TORN_COLORS`, `TORN_COLOR_NAMES` and `TORN_EMOJI`;
  - `DRAFT_LANGS`, which is `['md', 'html', 'text']`;
  - `FONT_SIZE_MIN` (8), `FONT_SIZE_MAX` (36), `SIZE_PICKS` and `HEADING_PX`;
  - `PASTE_MARKER`, which is `'<!-- x-tinymce/html -->'`;
  - `EDITOR_BG`, `CLEAN_MAX_CHARS` (100000) and `URL_MAX_CHARS` (2000).
- Produces these functions:
  - `decodeEntities(s)` returns a string;
  - `tokenizeHtml(html)` returns an array of
    `{type:'open'|'close'|'text', tag, attrs, selfClose, text, raw, pos}`;
  - `cleanTornHtml(html)` returns canonical HTML;
  - `htmlSource(clean)` returns the same HTML with one block per line;
  - `safeHref(v)` returns a string, or `''`;
  - `safeImgSrc(v)` returns a string, or `''`;
  - `emojiFromSrc(v)` returns an emoji name, or `''`.
- Internal, not exported: `buildCleanTree`, `serBlocks`, `serBlock`,
  `serInline`, `serMixed`, `trimEdges`, `tableRows`, `serRow`, `escText`,
  `escAttr` and `isBlankInline`.

- [ ] **Step 1: Write the failing tests** in `tests/editor-clean.test.js`

```js
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { loadUserscript } = require('./load-userscript');

const { exports: api } = loadUserscript();
const clean = api.cleanTornHtml;
const SAMPLE = fs.readFileSync(path.join(__dirname, '..', 'docs', 'reference', 'torn-forum-post-sample.html'), 'utf8');

// Copied by hand from the owner's probes (findings doc, Q4 and the emoji
// section), not from the production constant, so a typo in either fails.
const MEASURED_COLORS = [
  ['red', '#f03e3e', '#ff8787'], ['pink', '#d6336c', '#faa2c1'], ['grape', '#ae3ec9', '#e599f7'],
  ['violet', '#7048e8', '#d0bfff'], ['indigo', '#4263eb', '#bac8ff'], ['blue', '#1c7ed6', '#a5d8ff'],
  ['cyan', '#1098ad', '#99e9f2'], ['teal', '#0ca678', '#63e6be'], ['green', '#37b24d', '#8ce99a'],
  ['lime', '#66a80f', '#a9e34b'], ['yellow', '#e67700', '#ffd43b'], ['orange', '#d9480f', '#ffa94d'],
  ['gray1', '#333333', '#ffffff'], ['gray2', '#666666', '#dddddd'], ['gray3', '#999999', '#aaaaaa'],
  ['gray4', '#cccccc', '#888888'], ['gray5', '#ffffff', '#000000'],
];
const MEASURED_EMOJI = ['angel', 'angry', 'authority', 'beard', 'beaten_up', 'blushing', 'bored_sleepy',
  'confused', 'cool', 'cry', 'disappointed', 'dizzy', 'evil', 'grin', 'hushed', 'kissing', 'laughing',
  'love_chemistry', 'money', 'moustache', 'mugger_masked', 'nerd', 'party', 'pirate', 'sick', 'smiley',
  'tired', 'tongue', 'wink', 'zip_mouth'];

test('the 17 Torn colours and the 30 Torn emoji are exactly the measured sets', () => {
  assert.deepStrictEqual(api.TORN_COLORS.map((c) => [c.name, c.light, c.dark]), MEASURED_COLORS);
  assert.deepStrictEqual(api.TORN_EMOJI.slice(), MEASURED_EMOJI);
  assert.strictEqual(api.PASTE_MARKER, '<!-- x-tinymce/html -->');
});

test('TinyMCE bogus elements: "all" goes with its content, others unwrap', () => {
  assert.strictEqual(clean('<p><strong data-mce-bogus="1">hi</strong><span data-mce-bogus="all">caret</span></p>'), '<p>hi</p>');
});

test('cleaning the published sample keeps everything it shows', () => {
  // Independent of the round trip: counted in the source, then in the output.
  const c = clean(SAMPLE);
  const count = (s, re) => (s.match(re) || []).length;
  const body = SAMPLE.replace(/<!--[\s\S]*?-->/g, '');
  assert.strictEqual(count(c, /var\(--te-text-color-/g), count(body, /var\(--te-text-color-/g));
  assert.strictEqual(count(c, /<a href="https:\/\/greasyfork\.org/g), count(body, /<a href=/g));
  assert.strictEqual(count(c, /class="table-wrap"/g), count(body, /class="table-wrap"/g));
  assert.strictEqual(count(c, /<li>/g), count(body, /<li>/g));
  assert.strictEqual(count(c, /text-align: center/g), count(body, /text-align: center/g));
  for (const words of ['Education is one of', 'Tier 1 is the category', 'BIO2127', 'keep that education slot moving']) {
    assert.ok(c.indexOf(words) !== -1, words);
  }
});

test('allowed markup survives in canonical form', () => {
  assert.strictEqual(clean('<P STYLE="text-align:center">x</P>'), '<p style="text-align: center;">x</p>');
  assert.strictEqual(clean('<p><b>b</b> <i>i</i> <u>u</u> <s>s</s></p>'),
    '<p><strong>b</strong> <em>i</em> <span style="text-decoration: underline;">u</span> '
    + '<span style="text-decoration: line-through;">s</span></p>');
  assert.strictEqual(clean('<p><span style="font-size: 18px; color: var(--te-text-color-green);">h</span></p>'),
    '<p><span style="color: var(--te-text-color-green);"><span style="font-size: 18px;">h</span></span></p>');
  assert.strictEqual(clean('<p><a href="https://a.b/c">t</a></p>'),
    '<p><a href="https://a.b/c" target="_blank" rel="noopener">t</a></p>');
  assert.strictEqual(clean('<p><img src="/images/emotions/svg/angel.svg"></p>'),
    '<p><img src="/images/emotions/svg/angel.svg"></p>');
  assert.strictEqual(clean('<h2>Head</h2>'), '<p><span style="font-size: 18px;"><strong>Head</strong></span></p>');
});

test('every table gets the table-wrap trio and a tbody', () => {
  assert.strictEqual(clean('<table><tr><th>a</th></tr><tr><td style="text-align:right">1</td></tr></table>'),
    '<div><div><div class="table-wrap"><table><tbody><tr><th>a</th></tr>'
    + '<tr><td style="text-align: right;">1</td></tr></tbody></table></div></div></div>');
});

test('blank paragraphs, including TinyMCE bogus ones, become one canonical spacer', () => {
  assert.strictEqual(clean('<p><br data-mce-bogus="1"></p><p>&nbsp;</p><p> </p>'),
    '<p>&nbsp;</p><p>&nbsp;</p><p>&nbsp;</p>');
});

test('hostile markup is neutralised', () => {
  const cases = {
    '<script>alert(1)</script><p>ok</p>': '<p>ok</p>',
    '<img src=x onerror=alert(1)>': '',
    '<p onclick="x">t</p>': '<p>t</p>',
    '<a href="javascript:alert(1)">j</a>': '<p>j</p>',
    '<a href="&#106;avascript:alert(1)">j</a>': '<p>j</p>',
    '<img src="data:image/png;base64,AAA">': '',
    '<style>p{}</style><p>s</p>': '<p>s</p>',
    '<iframe src="https://e.com"></iframe>': '',
    '<svg><script>x</script></svg>t': '<p>t</p>',
    '<p style="background:url(javascript:x);color:red">c</p>': '<p>c</p>',
    '<img src="/images/other/x.svg">': '',
    '<img src="/images/emotions/svg/notreal.svg">': '',
  };
  for (const [input, want] of Object.entries(cases)) assert.strictEqual(clean(input), want, input);
});

test('an unwrapped container still closes what it opened', () => {
  assert.strictEqual(clean('<div><p>a</div>b'), '<p>a</p><p>b</p>');
});

test('cleaning is idempotent, and htmlSource round-trips', () => {
  for (const h of [SAMPLE, '<p>x <strong>y</strong></p><ul><li>a</li></ul>', '<blockquote><p>q</p></blockquote>']) {
    const c = clean(h);
    assert.strictEqual(clean(c), c);
    assert.strictEqual(clean(api.htmlSource(c)), c);
    assert.ok(api.htmlSource(c).indexOf('\n') !== -1 || c.indexOf('</p><') === -1);
  }
});

test('the cleaner reads a bounded input in one pass', () => {
  const t = Date.now();
  clean('<a '.repeat(30000));
  clean('<p>'.repeat(30000));
  clean('x'.repeat(200000));
  assert.ok(Date.now() - t < 2000, 'hostile input took ' + (Date.now() - t) + 'ms');
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `node --test tests/editor-clean.test.js`
Expected: FAIL, `api.TORN_COLORS` is undefined.

- [ ] **Step 3: Paste the reference sections**

From the reference file, paste:
- `// ---- #58 editor constants` up to and including `var URL_MAX_CHARS = 2000;`;
- `// ---- HTML tokenizer`;
- `// ---- the cleaner` up to, but not including, `// ---- Markdown to HTML`.

Put them before `// ---- ENGINE END`. Do not paste `EDITOR_BG` twice: the
constants block has it.

Add `DRAFT_LANGS` to the constants block:

```js
  var DRAFT_LANGS = Object.freeze(['md', 'html', 'text']);
```

(The reference already holds that line. Keep exactly one.)

Add these to `EXPORT_NAMES` in `tests/load-userscript.js`, under a
`// #58: Drafts rich editor` comment:

```js
  'TORN_COLORS', 'TORN_COLOR_NAMES', 'TORN_EMOJI', 'DRAFT_LANGS', 'FONT_SIZE_MIN', 'FONT_SIZE_MAX',
  'SIZE_PICKS', 'HEADING_PX', 'PASTE_MARKER', 'EDITOR_BG', 'CLEAN_MAX_CHARS', 'URL_MAX_CHARS',
  'decodeEntities', 'tokenizeHtml', 'cleanTornHtml', 'htmlSource', 'safeHref', 'safeImgSrc', 'emojiFromSrc',
```

- [ ] **Step 4: Run the tests, the ASCII check and the purity test**

Run:
- `node --test tests/editor-clean.test.js tests/purity.test.js tests/metadata.test.js`
- `grep -nP '[^\x00-\x7F]' torn-forum-command-center.user.js`

Expected: PASS, and the grep prints nothing.

- [ ] **Step 5: Run the suite and commit**

```bash
npm test
git add torn-forum-command-center.user.js tests/load-userscript.js tests/editor-clean.test.js
git commit -m "feat: Torn-safe HTML cleaner for the Drafts editor (#58)"
```

---

### Task 2: Markdown to HTML

**Files:**
- Modify: `torn-forum-command-center.user.js`, the engine section, after the
  cleaner
- Modify: `tests/load-userscript.js`
- Create: `tests/editor-markdown.test.js`

**Interfaces:**
- Consumes: `cleanTornHtml`, `escText`, `escAttr`, `safeHref`, `safeImgSrc`,
  `TORN_EMOJI`, `TORN_COLOR_NAMES` and `HEADING_PX`, from Task 1.
- Produces:
  - `mdInline(s)` returns HTML, not cleaned;
  - `mdBlocks(md)` returns `[{ line, html }]`, where `html` is cleaned;
  - `mdToHtml(md)` returns cleaned HTML;
  - `MD_ESCAPABLE`, a string.

- [ ] **Step 1: Write the failing tests** in `tests/editor-markdown.test.js`

```js
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { loadUserscript } = require('./load-userscript');

const { exports: api } = loadUserscript();
const md = api.mdToHtml;
const BS = String.fromCharCode(92);

test('each line is a paragraph and each empty line a visible gap', () => {
  assert.strictEqual(md('one\n\ntwo'), '<p>one</p><p>&nbsp;</p><p>two</p>');
  assert.strictEqual(md(''), '');
});

test('Windows line endings convert exactly like Unix ones (Review Focus 1)', () => {
  assert.strictEqual(md('a\r\n\r\nb'), md('a\n\nb'));
  assert.deepStrictEqual(api.mdBlocks('a\r\nb').map((b) => b.line), [0, 1]);
});

test('every dialect row of spec section 3', () => {
  const rows = [
    ['**b** *i*', '<p><strong>b</strong> <em>i</em></p>'],
    ['++u++', '<p><span style="text-decoration: underline;">u</span></p>'],
    ['~~s~~', '<p><span style="text-decoration: line-through;">s</span></p>'],
    ['{red}x{/}', '<p><span style="color: var(--te-text-color-red);">x</span></p>'],
    ['{#FF8800}x{/}', '<p><span style="color: #ff8800;">x</span></p>'],
    ['{18}x{/}', '<p><span style="font-size: 18px;">x</span></p>'],
    ['# h', '<p><span style="font-size: 24px;"><strong>h</strong></span></p>'],
    ['## h', '<p><span style="font-size: 18px;"><strong>h</strong></span></p>'],
    ['### h', '<p><span style="font-size: 16px;"><strong>h</strong></span></p>'],
    [':::center\na\n:::', '<p style="text-align: center;">a</p>'],
    ['> q\n>\n> r', '<blockquote><p>q</p><p>&nbsp;</p><p>r</p></blockquote>'],
    ['- a\n- b', '<ul><li>a</li><li>b</li></ul>'],
    ['1. a\n2. b', '<ol><li>a</li><li>b</li></ol>'],
    ['[t](https://a.b)', '<p><a href="https://a.b" target="_blank" rel="noopener">t</a></p>'],
    ['![alt](https://i.imgur.com/x.png)', '<p><img src="https://i.imgur.com/x.png" alt="alt"></p>'],
    [':grin: :nope:', '<p><img src="/images/emotions/svg/grin.svg"> :nope:</p>'],
    [BS + '*lit' + BS + '*', '<p>*lit*</p>'],
    ['| A | B |\n|:-:|--:|\n| 1 | 2 |',
      '<div><div><div class="table-wrap"><table><tbody><tr><th style="text-align: center;">A</th>'
      + '<th style="text-align: right;">B</th></tr><tr><td style="text-align: center;">1</td>'
      + '<td style="text-align: right;">2</td></tr></tbody></table></div></div></div>'],
    ['| a | b |\n| c | d |',
      '<div><div><div class="table-wrap"><table><tbody><tr><td>a</td><td>b</td></tr>'
      + '<tr><td>c</td><td>d</td></tr></tbody></table></div></div></div>'],
    ['a <strong>raw</strong> b', '<p>a <strong>raw</strong> b</p>'],
  ];
  for (const [src, want] of rows) assert.strictEqual(md(src), want, JSON.stringify(src));
});

test('marks nest, and an unclosed mark is literal text', () => {
  assert.strictEqual(md('{red}{18}**x**{/}{/}'),
    '<p><span style="color: var(--te-text-color-red);"><span style="font-size: 18px;"><strong>x</strong></span></span></p>');
  assert.strictEqual(md('{red}open **bold'), '<p>{red}open **bold</p>');
  assert.strictEqual(md('{99}too big{/}'), '<p>{99}too big{/}</p>');
});

test('a bad link or image URL stays literal', () => {
  assert.strictEqual(md('[x](javascript:alert(1))'), '<p>[x](javascript:alert(1))</p>');
  assert.strictEqual(md('![x](http://a.b/c.png)'), '<p>![x](http://a.b/c.png)</p>');
});

test('inline HTML in Markdown is cleaned', () => {
  assert.strictEqual(md('a <img src=x onerror=alert(1)> b'), '<p>a b</p>');
});

test('the size bound: no 20000-character draft reaches CLEAN_MAX_CHARS', () => {
  // The worst expansions found while planning; a new dialect rule that beats
  // them has to raise the bound deliberately.
  for (const unit of ['|\n\n', '|\n>\n', '||\n\n', '| |\n\n', '# :cry:\n', '\n']) {
    const src = unit.repeat(Math.floor(api.DRAFT_MAX_CHARS / unit.length));
    assert.ok(api.mdToHtml(src).length < api.CLEAN_MAX_CHARS, JSON.stringify(unit));
  }
});

test('hostile Markdown stays fast and shallow', () => {
  const t = Date.now();
  md('{red}'.repeat(4000));
  md('{red}'.repeat(3000) + '{/}'.repeat(3000));
  md('[x'.repeat(9000));
  md('**{red}[a](https://x.y)*'.repeat(800));
  assert.ok(Date.now() - t < 2000, 'took ' + (Date.now() - t) + 'ms');
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `node --test tests/editor-markdown.test.js`
Expected: FAIL, `api.mdToHtml is not a function`.

- [ ] **Step 3: Paste the reference section** `// ---- Markdown to HTML`, up to
  but not including `// ---- HTML to Markdown`. Add these to `EXPORT_NAMES`:
  `'mdInline', 'mdBlocks', 'mdToHtml', 'MD_ESCAPABLE',`.

- [ ] **Step 4: Run the tests, the ASCII check and purity**

Run:
- `node --test tests/editor-markdown.test.js tests/purity.test.js tests/metadata.test.js`
- `grep -nP '[^\x00-\x7F]' torn-forum-command-center.user.js`

Expected: PASS, and the grep prints nothing.

- [ ] **Step 5: Run the suite and commit**

```bash
npm test
git add torn-forum-command-center.user.js tests/load-userscript.js tests/editor-markdown.test.js
git commit -m "feat: Markdown dialect to Torn HTML (#58)"
```

---

### Task 3: HTML to Markdown, plain text, conversions and the preview model

**Files:**
- Modify: `torn-forum-command-center.user.js`, the engine section
- Modify: `tests/load-userscript.js`
- Create: `tests/editor-convert.test.js`

**Interfaces:**
- Consumes: Tasks 1 and 2.
- Produces:
  - `htmlToMd(html)` returns Markdown;
  - `textToHtml(t)` and `textToMd(t)`;
  - `htmlToText(html)`;
  - `postHtml(text, lang)` returns the cleaned HTML of the post;
  - `convertDraft(text, from, to)` returns the source in `to`;
  - `previewModel(lang, text)` returns `[{ html, offset }]`;
  - `htmlBlockOffsets(src)` returns an array of offsets.

- [ ] **Step 1: Write the failing tests** in `tests/editor-convert.test.js`

```js
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { loadUserscript } = require('./load-userscript');

const { exports: api } = loadUserscript();
const SAMPLE = fs.readFileSync(path.join(__dirname, '..', 'docs', 'reference', 'torn-forum-post-sample.html'), 'utf8');
// The owner's toolbar test, from docs/reference/torn-forum-editor-findings-2026-10-09.md.
const TOOLBAR = '<blockquote><p><span style="text-decoration: underline;" data-mce-style="x">this </span>'
  + '<strong>is </strong>a <span style="color: var(--te-text-color-red);">red </span>'
  + '<span style="font-size: 10px;">test </span>a <em>table </em>below '
  + '<img src="/images/emotions/svg/angel.svg" data-mce-src="/images/emotions/svg/angel.svg">and&nbsp;</p></blockquote>'
  + '<table class="mce-item-table" style="width: 39.0052%; height: 154px;"><tbody><tr style="height: 28px;">'
  + '<th style="width: 34.6966%; height: 28px;">Route</th></tr><tr><td>Foundation</td></tr></tbody></table>'
  + '<p><br data-mce-bogus="1"></p><p><img src="https://editor.torn.com/abc-1.jpg"></p>';
const EDGES = [
  '<p>plain</p>',
  '<p style="text-align: center;">c</p><p style="text-align: center;">&nbsp;</p><p>x</p>',
  '<ul><li>a</li><li>b <strong>c</strong></li></ul><ul><li>second list</li></ul>',
  '<blockquote><p>q1</p><p>&nbsp;</p><p>q2</p></blockquote>',
  '<p><strong><em>both</em></strong> and <em><strong>both2</strong></em></p>',
  '<p>2*3*4 = a++b ~~ {red} [x] :grin: \\ & &lt;</p>',
  '<p>- not a list</p><p># not a heading</p><p>1. not ordered</p><p>&gt; not quote</p><p>| not table</p><p>:::center</p>',
  '<h2>Heading</h2><h1 style="text-align:right">Big</h1>',
  '<p><a href="https://a.b/c">link <strong>bold</strong></a> <a href="https://x.y/(paren)">p</a></p>',
  '<table><tr><td>a|b</td><td style="text-align:center">c</td></tr><tr><td>d</td><td style="text-align:center">e</td></tr></table>',
  '<table><tr><th>H</th><th style="text-align:right">R</th></tr><tr><td>1</td><td style="text-align:right">2</td></tr></table>',
  '<p>line<br>break</p>',
  '<p><span style="color:#FF8800; font-size: 14px; text-decoration: line-through">multi</span></p>',
  '<ol><li>one</li><li>two</li></ol>',
  'loose text <b>bold</b><p>para</p>more',
  '<p><img src="https://i.imgur.com/a.png" alt="the alt"></p>',
  '<p>&nbsp;&nbsp;indented</p>',
  '<p>a <span style="font-size: 18px;"><strong>not heading</strong></span> b</p>',
  '<p><span style="font-size: 24px;"><strong>real heading</strong></span></p>',
];

test('Markdown round-trips every cleaned fixture: nothing is lost', () => {
  for (const h of [SAMPLE, TOOLBAR].concat(EDGES)) {
    const c = api.cleanTornHtml(h);
    assert.strictEqual(api.mdToHtml(api.htmlToMd(c)), c, h.slice(0, 60));
  }
});

test('what Markdown can say is said in Markdown, not raw HTML', () => {
  assert.strictEqual(api.htmlToMd('<p><strong>b</strong> <span style="color: var(--te-text-color-red);">r</span></p>'),
    '**b** {red}r{/}');
  assert.strictEqual(api.htmlToMd('<p><span style="font-size: 24px;"><strong>T</strong></span></p><p>&nbsp;</p><ul><li>a</li></ul>'),
    '# T\n\n- a');
  assert.strictEqual(api.htmlToMd('<p><img src="/images/emotions/svg/grin.svg"></p>'), ':grin:');
});

test('a construct Markdown cannot say stays as cleaned inline HTML', () => {
  const md = api.htmlToMd('<table style="width: 40%;"><tr><td>x</td></tr></table>');
  assert.match(md, /^<div><div><div class="table-wrap"><table style="width: 40%;">/);
});

test('switching modes repeatedly settles after the first switch (Review Focus 4)', () => {
  let t = '# T\n{red}r{/} **b**\n| a | b |\n| --- | --- |\n| 1 | 2 |';
  const html1 = api.convertDraft(t, 'md', 'html');
  const md1 = api.convertDraft(html1, 'html', 'md');
  const html2 = api.convertDraft(md1, 'md', 'html');
  const md2 = api.convertDraft(html2, 'html', 'md');
  assert.strictEqual(html2, html1);
  assert.strictEqual(md2, md1);
  t = md2;
});

test('text conversions escape, and Text is the formatting-free view', () => {
  assert.strictEqual(api.textToMd('Hello *world*\n\n- not list'), 'Hello \\*world\\*\n\n\\- not list');
  assert.strictEqual(api.mdToHtml(api.textToMd('a <b> & c')), api.textToHtml('a <b> & c'));
  assert.strictEqual(api.textToHtml('<b>x</b>'), '<p>&lt;b&gt;x&lt;/b&gt;</p>');
  assert.strictEqual(api.htmlToText(api.mdToHtml('# T\n- a\n| x | y |\n> q\n:grin:')), 'T\n- a\nx | y\n> q\n:grin:');
});

test('postHtml is the cleaned post in each language', () => {
  assert.strictEqual(api.postHtml('**b**', 'md'), '<p><strong>b</strong></p>');
  assert.strictEqual(api.postHtml('<b>b</b>', 'html'), '<p><strong>b</strong></p>');
  assert.strictEqual(api.postHtml('**b**', 'text'), '<p>**b**</p>');
});

test('the preview model maps each block to its source offset', () => {
  assert.deepStrictEqual(api.previewModel('md', '# T\n\ntext\n- a\n- b').map((b) => b.offset), [0, 4, 5, 10]);
  assert.deepStrictEqual(api.previewModel('html', '<p>a</p>\n  <h2>b</h2>').map((b) => b.offset), [0, 11]);
  assert.deepStrictEqual(api.previewModel('text', 'one\n\ntwo').map((b) => b.html), ['<p>one</p>', '<p>&nbsp;</p>', '<p>two</p>']);
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `node --test tests/editor-convert.test.js`
Expected: FAIL, `api.htmlToMd is not a function`.

- [ ] **Step 3: Paste these reference sections**:
- `// ---- HTML to Markdown`;
- `// ---- plain text`;
- `// ---- Preview (#58)`;
- `// ---- conversion entry points`.

Add these to `EXPORT_NAMES`:
`'htmlToMd', 'textToHtml', 'textToMd', 'htmlToText', 'postHtml', 'convertDraft', 'previewModel', 'htmlBlockOffsets',`.

- [ ] **Step 4: Run the tests and the checks**

Run:
- `node --test tests/editor-convert.test.js tests/purity.test.js tests/metadata.test.js`
- the ASCII grep.

Expected: PASS.

- [ ] **Step 5: Run the suite and commit**

```bash
npm test
git add torn-forum-command-center.user.js tests/load-userscript.js tests/editor-convert.test.js
git commit -m "feat: HTML to Markdown, plain text and mode conversion with a lossless round-trip (#58)"
```

---

### Task 4: Image link fixer and colour contrast

**Files:**
- Modify: `torn-forum-command-center.user.js`, the engine section
- Modify: `tests/load-userscript.js`
- Create: `tests/editor-images.test.js`

**Interfaces:**
- Produces:
  - `fixImageUrl(url)` returns
    `{ status: 'ok'|'fixed'|'howto'|'refused', url, host, note }`;
  - `fixAllImages(lang, text)` returns `{ text, changed }`;
  - `hexRgb(hex)` returns `[r, g, b]`, or `null`;
  - `contrastRatio(a, b)` returns a number;
  - `colorWarnings(hex)` returns `[{ theme, ratio }]`.

- [ ] **Step 1: Write the failing tests** in `tests/editor-images.test.js`. One
  case per row of `docs/reference/image-host-link-rules-2026-10-09.md`:

```js
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { loadUserscript } = require('./load-userscript');

const { exports: api } = loadUserscript();
const fix = (u) => api.fixImageUrl(u);
const ID = '1GfhII9A5yDKVLFVv0F1SEPivpxvREb-h';
const DRIVE = 'https://drive.google.com/thumbnail?id=' + ID + '&sz=w1000';

test('deterministic hosts are rewritten exactly', () => {
  const rows = [
    ['https://drive.google.com/file/d/' + ID + '/view?usp=sharing', DRIVE],
    ['https://drive.google.com/file/u/0/d/' + ID + '/edit', DRIVE],
    ['https://drive.google.com/open?id=' + ID, DRIVE],
    ['https://www.dropbox.com/scl/fi/abc/pic.png?rlkey=KEY&dl=0', 'https://www.dropbox.com/scl/fi/abc/pic.png?rlkey=KEY&raw=1'],
    ['https://www.dropbox.com/s/abc/pic.png?dl=0', 'https://www.dropbox.com/s/abc/pic.png?raw=1'],
    ['https://github.com/o/r/blob/main/img/a.png', 'https://raw.githubusercontent.com/o/r/main/img/a.png'],
    ['https://giphy.com/gifs/cat-funny-abc123XYZ', 'https://media.giphy.com/media/abc123XYZ/giphy.gif'],
    ['https://gyazo.com/0123456789abcdef0123456789abcdef', 'https://i.gyazo.com/0123456789abcdef0123456789abcdef.png'],
    ['https://imgur.com/AbC12dE', 'https://i.imgur.com/AbC12dE.png'],
    ['https://www.reddit.com/media?url=https%3A%2F%2Fi.redd.it%2Fxyz.png', 'https://i.redd.it/xyz.png'],
    ['https://preview.redd.it/xyz.png?width=640&s=abc', 'https://i.redd.it/xyz.png'],
    // Every other input shape the host-rules file lists.
    ['https://drive.google.com/uc?id=' + ID + '&export=view', DRIVE],
    ['https://drive.google.com/uc?export=download&id=' + ID, DRIVE],
    ['https://giphy.com/embed/abc123XYZ', 'https://media.giphy.com/media/abc123XYZ/giphy.gif'],
    ['https://github.com/o/r/raw/main/a.png', 'https://raw.githubusercontent.com/o/r/main/a.png'],
    ['https://github.com/o/r/blob/main/a.png?raw=true', 'https://raw.githubusercontent.com/o/r/main/a.png'],
    ['https://www.dropbox.com/scl/fi/abc/pic.png?rlkey=KEY&st=x&dl=1', 'https://www.dropbox.com/scl/fi/abc/pic.png?rlkey=KEY&st=x&raw=1'],
  ];
  for (const [input, want] of rows) {
    const r = fix(input);
    assert.strictEqual(r.status, 'fixed', input);
    assert.strictEqual(r.url, want, input);
  }
  assert.match(fix('https://drive.google.com/file/d/' + ID + '/view').note, /Anyone with the link/);
});

test('direct links pass as they are', () => {
  for (const u of [DRIVE, 'https://editor.torn.com/0de3-1.jpg', 'https://example.com/pic.JPG?x=1',
    'https://i.imgur.com/x.gif', 'https://lh3.googleusercontent.com/pw/abc=w100',
    'https://dl.dropboxusercontent.com/s/abc/pic.png', 'https://raw.githubusercontent.com/o/r/main/a.png',
    'https://media.giphy.com/media/abc/giphy.gif', 'https://i.gyazo.com/0123456789abcdef0123456789abcdef.png',
    'https://i.redd.it/xyz.png']) {
    assert.strictEqual(fix(u).status, 'ok', u);
    assert.strictEqual(fix(u).url, u, u);
  }
});

test('hosts with no derivable link get an instruction', () => {
  for (const [u, re] of [
    ['https://photos.app.goo.gl/abc', /Copy image address/],
    ['https://1drv.ms/i/s!abc', /OneDrive/],
    ['https://ibb.co/8P0808s', /Direct link/],
    ['https://postimg.cc/abc', /Direct link/],
    ['https://imgur.com/a/AbC12', /album/],
    ['https://prnt.sc/abc', /Copy image address/],
    ['https://tenor.com/view/x-123', /Copy image address/],
    ['https://contoso.sharepoint.com/x', /OneDrive/],
  ]) {
    const r = fix(u);
    assert.strictEqual(r.status, 'howto', u);
    assert.match(r.note, re, u);
  }
});

test('expiring, insecure and non-image links are refused with a reason', () => {
  assert.match(fix('https://cdn.discordapp.com/attachments/1/2/a.png?ex=1').note, /expire/);
  assert.match(fix('http://a.b/c.png').note, /https/);
  assert.match(fix('https://example.com/page').note, /web page/);
  assert.match(fix('https://drive.google.com/drive/folders/1abcdefghijklmnopqrstu').note, /folder/);
  assert.match(fix('https://github.com/o/r/blob/main/a.svg').note, /SVG/);
  // A Reddit wrapper around a page link passes the inner verdict through.
  assert.strictEqual(fix('https://www.reddit.com/media?url=https%3A%2F%2Fibb.co%2Fabc').status, 'howto');
  for (const u of ['', 'javascript:alert(1)', 'https://a.b/"onerror=x.png', 'https://' + 'a'.repeat(2100) + '.png']) {
    assert.strictEqual(fix(u).status, 'refused', u.slice(0, 40));
  }
});

test('Fix image link rewrites every fixable image in a draft', () => {
  assert.deepStrictEqual(api.fixAllImages('md', '![a](https://imgur.com/AbC12dE) ![b](https://x.y/z.png)'),
    { text: '![a](https://i.imgur.com/AbC12dE.png) ![b](https://x.y/z.png)', changed: 1 });
  assert.deepStrictEqual(api.fixAllImages('html', '<img src="https://drive.google.com/file/d/' + ID + '/view">'),
    { text: '<img src="https://drive.google.com/thumbnail?id=' + ID + '&amp;sz=w1000">', changed: 1 });
  assert.deepStrictEqual(api.fixAllImages('html', "<img src='https://imgur.com/AbC12dE'>"),
    { text: "<img src='https://i.imgur.com/AbC12dE.png'>", changed: 1 });
  assert.deepStrictEqual(api.fixAllImages('text', '![a](https://imgur.com/AbC12dE)'),
    { text: '![a](https://imgur.com/AbC12dE)', changed: 0 });
});

test('a custom colour hard to read in a theme is flagged there', () => {
  assert.deepStrictEqual(api.colorWarnings('#ffd43b'), [{ theme: 'light', ratio: 1.4 }]);
  assert.deepStrictEqual(api.colorWarnings('#000000'), [{ theme: 'dark', ratio: 1.1 }]);
  assert.deepStrictEqual(api.colorWarnings('#777777').map((w) => w.theme), ['light', 'dark']);
  assert.deepStrictEqual(api.colorWarnings('#1c7ed6'), [{ theme: 'light', ratio: 4.1 }]);
  assert.strictEqual(Math.round(api.contrastRatio('#000000', '#ffffff')), 21);
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `node --test tests/editor-images.test.js`
Expected: FAIL, `api.fixImageUrl is not a function`.

- [ ] **Step 3: Paste the reference sections** `// ---- image link fixer (#58)`
  and `// ---- custom colour contrast (#58)`. Add these to `EXPORT_NAMES`:
  `'fixImageUrl', 'fixAllImages', 'hexRgb', 'contrastRatio', 'colorWarnings', 'IMAGE_HOWTO',`.

- [ ] **Step 4: Run the tests**

Run: `node --test tests/editor-images.test.js tests/purity.test.js`
Expected: PASS.

If a contrast figure differs in the last digit, the reference's `Math.floor`
is the rule. Correct the test's expected ratio, and never the rounding.

`tests/read-only.test.js` ("every request goes to the Torn API and nowhere
else") now fails. The fixer's source names the hosts it rewrites to. Extend
the test deliberately, with a separate, named list. Never widen `allowed`:

```js
  // #58: hosts the image link fixer writes into a player's own image links.
  // A pure string rewrite: nothing fetches them. Preview loads a player's
  // image only after they tap Show images (spec section 4a), with no referrer.
  const imageFixerHosts = new Set([
    'drive.google.com', 'www.dropbox.com', 'raw.githubusercontent.com', 'media.giphy.com',
    'i.gyazo.com', 'i.imgur.com', 'i.redd.it',
  ]);
  const stray = [...hosts].filter((h) => !allowed.has(h) && !imageFixerHosts.has(h));
```

In the same test, assert that each image-fixer host appears in the source only
inside `function fixImageUrl`, so the list cannot be borrowed by anything that
fetches:

```js
  const fixer = SOURCE.slice(SOURCE.indexOf('function fixImageUrl('), SOURCE.indexOf('function fixAllImages('));
  for (const h of imageFixerHosts) {
    const outside = SOURCE.split(fixer).join('').indexOf('https://' + h);
    assert.strictEqual(outside, -1, h + ' appears outside the image fixer');
  }
```

- [ ] **Step 5: Run the suite and commit**

```bash
npm test
git add torn-forum-command-center.user.js tests/load-userscript.js tests/editor-images.test.js
git commit -m "feat: image link fixer and custom colour contrast check (#58)"
```

---

### Task 5: Editor operations

**Files:**
- Modify: `torn-forum-command-center.user.js`, the engine section
- Modify: `tests/load-userscript.js`
- Create: `tests/editor-ops.test.js`

**Interfaces:**
- Produces:
  - `wrapSelection(text, start, end, open, close, placeholder)` returns `{ text, start, end }`;
  - `insertBlock(text, start, end, block)` returns `{ text, start, end }`;
  - `markPair(lang, mark, value)` returns `[open, close]`;
  - `applyMark(lang, text, start, end, mark, value)`;
  - `applyBlockMark(lang, text, start, end, 'quote'|'align', value)`;
  - `tableSkeleton(lang, cols, rows, header)` returns a string;
  - `emojiSnippet(lang, name)` and `imageSnippet(lang, url, alt)`.
- `mark` is one of `'bold'`, `'italic'`, `'underline'`, `'strike'`, `'color'`,
  `'size'` or `'link'`.
- `UNICODE_EMOJI` is an array of strings, built from code points.

- [ ] **Step 1: Write the failing tests** in `tests/editor-ops.test.js`

```js
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { loadUserscript } = require('./load-userscript');

const { exports: api } = loadUserscript();

test('a mark wraps the selection, or inserts a placeholder at the caret', () => {
  assert.deepStrictEqual(api.applyMark('md', 'hello world', 6, 11, 'bold'), { text: 'hello **world**', start: 8, end: 13 });
  assert.deepStrictEqual(api.applyMark('md', 'hi', 2, 2, 'color', 'red'), { text: 'hi{red}text{/}', start: 7, end: 11 });
  assert.deepStrictEqual(api.applyMark('html', 'x', 0, 1, 'color', '#FF0000'),
    { text: '<span style="color: #ff0000;">x</span>', start: 30, end: 31 });
  // '<a href="https://a.b">' is 22 characters long.
  assert.deepStrictEqual(api.applyMark('html', 'x', 0, 1, 'link', 'https://a.b'),
    { text: '<a href="https://a.b">x</a>', start: 22, end: 23 });
});

test('quote and alignment act on whole lines', () => {
  assert.deepStrictEqual(api.applyBlockMark('md', 'a\nb\nc', 2, 3, 'align', 'center'),
    { text: 'a\n:::center\nb\n:::\nc', start: 2, end: 17 });
  assert.strictEqual(api.applyBlockMark('md', 'a\nb\n\nc', 0, 6, 'quote').text, '> a\n> b\n>\n> c');
});

test('a block lands on lines of its own', () => {
  assert.deepStrictEqual(api.insertBlock('abc', 1, 1, '| x |'), { text: 'a\n| x |\nbc', start: 7, end: 7 });
  assert.deepStrictEqual(api.insertBlock('', 0, 0, 'T'), { text: 'T', start: 1, end: 1 });
});

test('the table skeleton is valid in both languages', () => {
  assert.strictEqual(api.tableSkeleton('md', 2, 1, true), '| Column 1 | Column 2 |\n| --- | --- |\n| Cell | Cell |');
  assert.strictEqual(api.mdToHtml(api.tableSkeleton('md', 2, 1, true)), api.cleanTornHtml(api.tableSkeleton('html', 2, 1, true)));
  assert.strictEqual(api.tableSkeleton('md', 99, 99, false).split('\n').length, 30);
});

test('emoji and image snippets', () => {
  assert.strictEqual(api.emojiSnippet('md', 'grin'), ':grin:');
  assert.strictEqual(api.emojiSnippet('html', 'grin'), '<img src="/images/emotions/svg/grin.svg">');
  assert.strictEqual(api.emojiSnippet('md', 'nope'), '');
  assert.strictEqual(api.imageSnippet('md', 'https://a.b/c.png', 'a [b]'), '![a  b](https://a.b/c.png)');
  assert.strictEqual(api.imageSnippet('html', 'https://a.b/c.png?x=1&y=2', ''), '<img src="https://a.b/c.png?x=1&amp;y=2">');
});

test('the Unicode emoji set is single emoji, built from code points', () => {
  assert.ok(api.UNICODE_EMOJI.length >= 36);
  for (const e of api.UNICODE_EMOJI) assert.ok([...e].length <= 2 && e.codePointAt(0) > 0x2000, JSON.stringify(e));
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `node --test tests/editor-ops.test.js`
Expected: FAIL.

- [ ] **Step 3: Paste the reference section** `// ---- editor operations (#58)`.
Then add the Unicode set after `imageSnippet`. It is built from code points so
the source stays ASCII:

```js
  // Common Unicode emoji, for the picker's second tab. Code points, not
  // characters, so the source stays ASCII (constraint 4). A pair is an emoji
  // and its variation selector.
  var UNICODE_EMOJI = Object.freeze([
    [0x1F600], [0x1F602], [0x1F642], [0x1F609], [0x1F60D], [0x1F60E], [0x1F914], [0x1F605],
    [0x1F622], [0x1F621], [0x1F631], [0x1F634], [0x1F923], [0x1F644], [0x1F62C], [0x1F91D],
    [0x1F44D], [0x1F44E], [0x1F44F], [0x1F64F], [0x1F4AA], [0x1F440], [0x1F525], [0x1F4AF],
    [0x1F389], [0x1F4B0], [0x1F480], [0x1F48A], [0x1F3C6], [0x2B50], [0x2705], [0x274C],
    [0x26A0, 0xFE0F], [0x2764, 0xFE0F], [0x1F494], [0x2708, 0xFE0F], [0x1F680], [0x23F0], [0x1F4CC],
  ].map(function (cps) { return String.fromCodePoint.apply(String, cps); }));
```

Add these to `EXPORT_NAMES`:
`'wrapSelection', 'insertBlock', 'markPair', 'applyMark', 'applyBlockMark', 'tableSkeleton', 'emojiSnippet', 'imageSnippet', 'UNICODE_EMOJI',`.

- [ ] **Step 4: Run the tests and the ASCII grep**

Expected: PASS.

- [ ] **Step 5: Run the suite and commit**

```bash
npm test
git add torn-forum-command-center.user.js tests/load-userscript.js tests/editor-ops.test.js
git commit -m "feat: toolbar operations for Markdown and HTML sources (#58)"
```

---

### Task 6: Storage: draft language, free drafts, the Default editor setting, export and import

**Files:**
- Modify: `torn-forum-command-center.user.js`:
  - `settingsDefaults` and `normaliseSettings` (code map `freshSettings`, line 498);
  - `normaliseDrafts` (line 796);
  - the drafts helpers (`saveDraft`, line 2704, through `draftList`);
  - `encodeState` and `importState` (around lines 2769 and 2861).
- Modify: `tests/load-userscript.js`
- Create: `tests/editor-storage.test.js`

**Interfaces:**
- Produces:
  - `saveDraft(drafts, threadId, text, now, title, lang)`. `lang` is optional;
    `'md'` or `'html'` is stored, and anything else is omitted.
  - `newFreeDraft(drafts, now, lang)` returns `{ drafts, id }`. `id` is
    `'n' + digits`, or `null` when full.
  - `saveFreeDraft(drafts, id, text, now, name, lang)` and `deleteFreeDraft(drafts, id)`.
  - `draftFor(drafts, key)` takes a thread id or a free id.
  - `draftLangOf(entry)` returns `'md'|'html'|'text'`.
  - `draftList(drafts)` gains `kind: 'thread'|'free'`, `key`, `lang`, and `name`
    for free drafts. `threadId` is `null` for free drafts, and `title` is their
    name.
  - `settings.draftLang` is `'md'|'html'|'text'`, default `'md'`.
  - `FREE_DRAFTS_MAX = 100` and `FREE_NAME_MAX = 80`.
- Stored key order:
  - a thread draft is `{ text, updatedAt, title, lang? }`;
  - a free draft is `{ name, text, updatedAt, lang? }`.
  - The normaliser emits that same order, because `isRecoveredValue` compares
    `JSON.stringify` output.

- [ ] **Step 1: Write the failing tests** in `tests/editor-storage.test.js`

```js
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { loadUserscript } = require('./load-userscript');

const { exports: api } = loadUserscript();
const NOW = 1700000000000;

test('a v0.2.2 drafts blob loads unchanged and silently', () => {
  const old = { v: 1, byThread: { 42: { text: '<p>typed html</p>', updatedAt: 5, title: 'T' } } };
  const value = api.normaliseDrafts(old);
  assert.strictEqual(JSON.stringify(value), JSON.stringify(old));
  assert.strictEqual(api.isRecoveredValue(old, value), false, 'no damage notice');
  assert.strictEqual(api.draftLangOf(value.byThread[42]), 'text', 'an old draft is Text (Review Focus 5)');
});

test('a v0.2.2 settings blob loads silently through the real load path, with the Markdown default', () => {
  // The real path: loadKey with isRecoveredSettings, which loadAll uses.
  const old = JSON.parse(JSON.stringify(api.freshSettings()));
  delete old.draftLang;
  const env = loadUserscript({ gmStore: [['tfcc:settings', JSON.stringify(old)]] });
  const res = env.exports.loadKey(env.exports.STORAGE_KEYS.settings, env.exports.normaliseSettings, NOW,
    env.exports.isRecoveredSettings);
  assert.strictEqual(res.value.draftLang, 'md');
  assert.strictEqual(res.recovered, false, 'no damage notice');
});

test('a v0.2.2 drafts blob loads silently through the real load path', () => {
  const old = { v: 1, byThread: { 42: { text: 'x', updatedAt: 5, title: 'T' } } };
  const env = loadUserscript({ gmStore: [['tfcc:drafts', JSON.stringify(old)]] });
  const res = env.exports.loadKey(env.exports.STORAGE_KEYS.drafts, env.exports.normaliseDrafts, NOW);
  assert.strictEqual(res.recovered, false);
});

test('the v0.2.2 normaliser keeps byThread text from a blob this build writes (downgrade)', () => {
  const legacy = require('./fixtures/legacy-normalise-drafts-v0.2.2.js');
  let d = api.saveDraft(api.freshDrafts(), 3, '**b**', NOW, 'T', 'md');
  const made = api.newFreeDraft(d, NOW, 'md');
  d = api.saveFreeDraft(made.drafts, made.id, 'f', NOW, 'F', 'md');
  const back = legacy(JSON.parse(JSON.stringify(d)));
  assert.strictEqual(back.byThread[3].text, '**b**');
  assert.strictEqual(back.free, undefined, 'the documented downgrade loss');
});

test('draftLang is strict on the menu', () => {
  for (const [raw, want] of [['html', 'html'], ['text', 'text'], ['md', 'md'], ['HTML', 'md'], [3, 'md'], [null, 'md']]) {
    assert.strictEqual(api.normaliseSettings({ v: 1, draftLang: raw }).draftLang, want, String(raw));
  }
});

test('a draft language is stored only when it is not Text', () => {
  let d = api.saveDraft(api.freshDrafts(), 7, 'x', NOW, 'T', 'md');
  assert.deepStrictEqual(Object.keys(d.byThread[7]), ['text', 'updatedAt', 'title', 'lang']);
  d = api.saveDraft(d, 7, 'x', NOW, 'T', 'text');
  assert.deepStrictEqual(Object.keys(d.byThread[7]), ['text', 'updatedAt', 'title']);
  for (const junk of ['text', 'TEXT', 5, null]) {
    const n = api.normaliseDrafts({ v: 1, byThread: { 1: { text: 'a', updatedAt: 1, title: '', lang: junk } } });
    assert.strictEqual(n.byThread[1].lang, undefined, String(junk));
  }
});

test('free drafts: create, save, list, cap, delete', () => {
  let r = api.newFreeDraft(api.freshDrafts(), NOW, 'md');
  assert.match(r.id, /^n[0-9]{1,12}$/);
  assert.strictEqual(r.drafts.free[r.id].name, 'Untitled 1');
  let d = api.saveFreeDraft(r.drafts, r.id, '# Guide', NOW + 1, 'Education guide v2', 'md');
  assert.deepStrictEqual(Object.keys(d.free[r.id]), ['name', 'text', 'updatedAt', 'lang']);
  d = api.saveDraft(d, 9, 'reply', NOW + 2, 'Thread 9');
  const list = api.draftList(d);
  assert.deepStrictEqual(list.map((x) => [x.kind, x.key]), [['thread', '9'], ['free', r.id]]);
  assert.strictEqual(list[1].title, 'Education guide v2');
  assert.strictEqual(api.draftFor(d, r.id).text, '# Guide');
  assert.ok(api.saveDraft(d, 10, 'x', NOW, '').free[r.id], 'saving a reply keeps free drafts');
  assert.ok(api.deleteDraft(d, 9).free[r.id], 'deleting a reply keeps free drafts');
  d = api.deleteFreeDraft(d, r.id);
  assert.strictEqual(api.draftFor(d, r.id), null);
  let full = api.freshDrafts();
  for (let i = 0; i < api.FREE_DRAFTS_MAX; i += 1) full = api.newFreeDraft(full, NOW + i, 'md').drafts;
  assert.strictEqual(api.newFreeDraft(full, NOW, 'md').id, null);
  // The largest id wraps instead of growing a 13th digit.
  const edge = api.newFreeDraft(api.newFreeDraft(api.freshDrafts(), 999999999999, 'md').drafts, 999999999999, 'md');
  assert.strictEqual(edge.id, 'n1');
});

test('a stored free-drafts blob normalises, and keeps an empty named draft', () => {
  const raw = { v: 1, byThread: {}, free: { n1: { name: 'A', text: '', updatedAt: 3 }, bad: { name: 'x', text: 'y', updatedAt: 1 }, n2: 'junk' } };
  const n = api.normaliseDrafts(raw);
  assert.deepStrictEqual(Object.keys(n.free), ['n1']);
  assert.strictEqual(n.free.n1.text, '');
});

test('export and import carry free drafts and the language', () => {
  let d = api.saveDraft(api.freshDrafts(), 3, '**b**', NOW, 'T', 'md');
  const r = api.newFreeDraft(d, NOW, 'html');
  d = api.saveFreeDraft(r.drafts, r.id, '<p>x</p>', NOW, 'Free', 'html');
  const blob = api.encodeState(api.freshOrganizer(NOW), d, (s) => Buffer.from(s, 'utf8').toString('base64'));
  const back = api.importState(api.freshOrganizer(NOW), api.freshDrafts(), blob, (s) => Buffer.from(s, 'base64').toString('utf8'));
  assert.strictEqual(back.drafts.byThread[3].lang, 'md');
  assert.strictEqual(back.drafts.free[r.id].text, '<p>x</p>');
  assert.strictEqual(back.drafts.free[r.id].lang, 'html');
});
```

Before relying on the export test, check the real signatures of `encodeState`
and `importState` (code map anchors). Adapt only the encoder and decoder
arguments to match how `tests/share.test.js` calls them.

Create the frozen downgrade fixture, `tests/fixtures/legacy-normalise-drafts-v0.2.2.js`.
It is v0.2.2's `normaliseDrafts`, copied verbatim from the release tag, so it
never changes with the code:

```bash
git show v0.2.2:torn-forum-command-center.user.js > "$TEMP/tfcc-v022.js"
grep -n "function freshDrafts\|function normaliseDrafts\|function isPlainObject\|function toInt\|function safeString\|var DRAFT_MAX_CHARS\|var SCHEMA_VERSION" "$TEMP/tfcc-v022.js"
```

Copy those seven declarations, verbatim, into the fixture, in this wrapper:

```js
'use strict';
// v0.2.2's draft normaliser, frozen: what an older build does with a blob this
// build writes (spec section 6, downgrade). Copied from tag v0.2.2; never edit.
/* <the seven declarations, verbatim> */
module.exports = normaliseDrafts;
```

- [ ] **Step 2: Run them and watch them fail**

Run: `node --test tests/editor-storage.test.js`
Expected: FAIL.

- [ ] **Step 3: Implement**

In `settingsDefaults()`, after `seeThrough: true,`:

```js
      // #58: the mode a new draft opens in. Existing drafts keep their own.
      draftLang: 'md',
```

In `normaliseSettings`, before `return out;`:

```js
    // #58: strict on the menu; absent or off it takes the default.
    out.draftLang = DRAFT_LANGS.indexOf(raw.draftLang) !== -1 ? raw.draftLang : d.draftLang;
```

`normaliseSettings` sits above `DRAFT_LANGS` in the file. It is a function
called at runtime, after every `var` has its value, so the order is fine. Check
it anyway: grep for `var DRAFT_LANGS`, and confirm it is not inside a function.

Add `draftLang` to the model's `settings` object in `buildPanelModel` (line
~5490, `autosaveDrafts: s.autosaveDrafts,`):

```js
        draftLang: s.draftLang,
```

Replace `normaliseDrafts` with:

```js
  var FREE_DRAFTS_MAX = 100;
  var FREE_NAME_MAX = 80;

  function draftLangField(v) { return v === 'md' || v === 'html' ? v : null; }

  function normaliseDrafts(raw) {
    if (!isPlainObject(raw)) return freshDrafts();
    if (toInt(raw.v, 0) > SCHEMA_VERSION) return freshDrafts();
    var out = freshDrafts();
    if (isPlainObject(raw.byThread)) {
      var ids = Object.keys(raw.byThread);
      for (var i = 0; i < ids.length && i < 500; i += 1) {
        var id = ids[i];
        if (!/^[0-9]{1,12}$/.test(id)) continue;
        var d = raw.byThread[id];
        if (!isPlainObject(d)) continue;
        var text = safeString(d.text, DRAFT_MAX_CHARS);
        if (!text) continue;
        // Key order matters: the recovery check compares JSON, and a stored
        // draft was written in this order (saveDraft).
        var entry = { text: text, updatedAt: Math.max(0, toInt(d.updatedAt, 0)), title: safeString(d.title, 300) };
        var lang = draftLangField(d.lang);
        if (lang) entry.lang = lang;
        out.byThread[id] = entry;
      }
    }
    // #58: free drafts, tied to no thread. Absent stays absent, so an older
    // blob normalises byte-identical. A named draft may be empty.
    if (isPlainObject(raw.free)) {
      out.free = {};
      var fids = Object.keys(raw.free);
      for (var k = 0, kept = 0; k < fids.length && kept < FREE_DRAFTS_MAX; k += 1) {
        if (!/^n[0-9]{1,12}$/.test(fids[k])) continue;
        var f = raw.free[fids[k]];
        if (!isPlainObject(f)) continue;
        var fe = {
          name: safeString(f.name, FREE_NAME_MAX) || 'Untitled',
          text: safeString(f.text, DRAFT_MAX_CHARS),
          updatedAt: Math.max(0, toInt(f.updatedAt, 0)),
        };
        var fl = draftLangField(f.lang);
        if (fl) fe.lang = fl;
        out.free[fids[k]] = fe;
        kept += 1;
      }
    }
    return out;
  }
```

Replace the drafts helpers, from `function saveDraft(` through the end of
`function draftList(`, with:

```js
  function nextDrafts(drafts) {
    var next = { v: SCHEMA_VERSION, byThread: Object.assign({}, (drafts && drafts.byThread) || {}) };
    if (drafts && drafts.free) next.free = Object.assign({}, drafts.free);
    return next;
  }

  function saveDraft(drafts, threadId, text, now, title, lang) {
    var id = String(toInt(threadId, 0));
    if (id === '0') return drafts;
    var next = nextDrafts(drafts);
    var clean = safeString(text, DRAFT_MAX_CHARS);
    if (!clean.trim()) {
      delete next.byThread[id];
      return next;
    }
    var entry = {
      text: clean,
      updatedAt: Math.max(0, toInt(now, 0)),
      title: safeString(title, 300) || (next.byThread[id] ? next.byThread[id].title : ''),
    };
    var l = draftLangField(lang);
    if (l) entry.lang = l;
    next.byThread[id] = entry;
    return next;
  }

  function isFreeKey(key) { return /^n[0-9]{1,12}$/.test(String(key)); }

  function draftFor(drafts, key) {
    var id = String(key);
    var bag = isFreeKey(id) ? (drafts && drafts.free) : (drafts && drafts.byThread);
    return bag && Object.prototype.hasOwnProperty.call(bag, id) ? bag[id] : null;
  }

  function draftLangOf(entry) { return entry && draftLangField(entry.lang) ? entry.lang : 'text'; }

  function deleteDraft(drafts, threadId) {
    var next = nextDrafts(drafts);
    delete next.byThread[String(threadId)];
    return next;
  }

  function newFreeDraft(drafts, now, lang) {
    var next = nextDrafts(drafts);
    next.free = next.free || {};
    if (Object.keys(next.free).length >= FREE_DRAFTS_MAX) return { drafts: drafts, id: null };
    // Ids stay within the 12 digits the normaliser accepts, wrapping rather
    // than growing a thirteenth.
    var n = Math.max(1, toInt(now, 0) % 1000000000000);
    while (Object.prototype.hasOwnProperty.call(next.free, 'n' + n)) n = n >= 999999999999 ? 1 : n + 1;
    var names = Object.keys(next.free).map(function (k) { return next.free[k].name; });
    var num = 1;
    while (names.indexOf('Untitled ' + num) !== -1) num += 1;
    var entry = { name: 'Untitled ' + num, text: '', updatedAt: Math.max(0, toInt(now, 0)) };
    var l = draftLangField(lang);
    if (l) entry.lang = l;
    next.free['n' + n] = entry;
    return { drafts: next, id: 'n' + n };
  }

  function saveFreeDraft(drafts, id, text, now, name, lang) {
    if (!isFreeKey(id) || !drafts.free || !drafts.free[id]) return drafts;
    var next = nextDrafts(drafts);
    var entry = {
      name: safeString(name, FREE_NAME_MAX).trim() || next.free[id].name,
      text: safeString(text, DRAFT_MAX_CHARS),
      updatedAt: Math.max(0, toInt(now, 0)),
    };
    var l = draftLangField(lang);
    if (l) entry.lang = l;
    next.free[id] = entry;
    return next;
  }

  function deleteFreeDraft(drafts, id) {
    var next = nextDrafts(drafts);
    if (next.free) delete next.free[String(id)];
    return next;
  }

  function draftList(drafts) {
    var out = [];
    var ids = Object.keys((drafts && drafts.byThread) || {});
    ids.forEach(function (id) {
      var d = drafts.byThread[id];
      out.push({ kind: 'thread', key: id, threadId: id, text: d.text, updatedAt: d.updatedAt, title: d.title, lang: draftLangOf(d) });
    });
    Object.keys((drafts && drafts.free) || {}).forEach(function (id) {
      var f = drafts.free[id];
      out.push({ kind: 'free', key: id, threadId: null, text: f.text, updatedAt: f.updatedAt, title: f.name, name: f.name, lang: draftLangOf(f) });
    });
    return out.sort(function (a, b) { return b.updatedAt - a.updatedAt; });
  }
```

In `encodeState`, after the thread-drafts loop, write `lang` and the free
drafts:

```js
      if (drafts.byThread[dids[j]].lang) payload.drafts[dids[j]].lang = drafts.byThread[dids[j]].lang;
```

Put that line inside the existing loop, after the object literal. Then, after
the loop:

```js
    // #58: free drafts travel with the rest of the user's work.
    var fids = Object.keys((drafts && drafts.free) || {});
    if (fids.length) {
      payload.freeDrafts = {};
      fids.forEach(function (id) { payload.freeDrafts[id] = Object.assign({}, drafts.free[id]); });
    }
```

In `importState`, change `var nextDrafts = {...}` to `var nextDraftsBag = nextDrafts(drafts);`.
The helper's name now clashes with the local variable, so rename the local and
every use of it in `importState`. In the thread loop, add after `title`:

```js
        var importedLang = draftLangField(d.lang);
        if (importedLang) nextDraftsBag.byThread[dids[k]].lang = importedLang;
```

Then, after the thread loop:

```js
    if (isPlainObject(payload.freeDrafts)) {
      var incomingFree = normaliseDrafts({ v: SCHEMA_VERSION, byThread: {}, free: payload.freeDrafts }).free || {};
      nextDraftsBag.free = nextDraftsBag.free || {};
      Object.keys(incomingFree).forEach(function (id) {
        var have = nextDraftsBag.free[id];
        if (have && have.updatedAt >= incomingFree[id].updatedAt) return;
        if (!have && Object.keys(nextDraftsBag.free).length >= FREE_DRAFTS_MAX) return;
        nextDraftsBag.free[id] = incomingFree[id];
        addedDrafts += 1;
      });
    }
```

Add these to `EXPORT_NAMES`:
`'saveDraft', 'draftFor', 'deleteDraft', 'draftList', 'newFreeDraft', 'saveFreeDraft', 'deleteFreeDraft', 'draftLangOf', 'FREE_DRAFTS_MAX', 'FREE_NAME_MAX', 'encodeState', 'importState', 'isRecoveredSettings',`.
Skip any that are already listed.

- [ ] **Step 4: Run the tests**

Run: `node --test tests/editor-storage.test.js tests/drafts.test.js tests/share.test.js tests/storage.test.js`
Expected: PASS. The old drafts tests still hold, because `saveDraft`'s
five-argument behaviour is unchanged.

- [ ] **Step 5: Run the suite and commit**

```bash
npm test
git add torn-forum-command-center.user.js tests/load-userscript.js tests/editor-storage.test.js tests/fixtures/legacy-normalise-drafts-v0.2.2.js
git commit -m "feat: draft language, free drafts and the Default editor setting, loading old blobs silently (#58)"
```

Then run `/code-map`, because the engine has grown, and commit `docs/code-map.md`
as "docs: refresh the code map".

---

### Task 7: Insert through Torn's editor (ADR 0002, fixes #60)

**Files:**
- Modify: `torn-forum-command-center.user.js`: `REPLY_SELECTORS`,
  `findReplyBox` and `insertDraft` (code map lines 274 and 275; the source
  around 4498 to 4545)
- Modify: `tests/drafts.test.js` (the three `insertDraft` tests),
  `tests/read-only.test.js`, `tests/mutation-check.mjs` (any entry quoting the
  old `insertDraft` lines) and `tests/load-userscript.js`
- Create: `tests/editor-insert.test.js`

**Interfaces:**
- Consumes: `cleanTornHtml`, `htmlToText` and `PASTE_MARKER`.
- Produces:
  - `REPLY_SELECTORS` is `['#editor-wrapper .editor-content.mce-content-body']`;
  - `findReplyBox(doc)` returns the element or `null`, unchanged;
  - `insertPost(doc, win, html)` returns `{ ok, reason, detail }`. It replaces
    `insertDraft`. `html` must already be cleaned.
  - `caretToEnd(doc, win, box)` returns nothing.

- [ ] **Step 1: Write the failing tests** in `tests/editor-insert.test.js`

```js
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { loadUserscript } = require('./load-userscript');

const SEL = '#editor-wrapper .editor-content.mce-content-body';

// A visible TinyMCE body: handles a marked paste by appending its HTML, the
// way the owner observed TinyMCE do it (test B).
function tinyBody(env, initial) {
  const box = env.makeElement('div');
  box.getBoundingClientRect = () => ({ width: 600, height: 160 });
  box.innerHTML = initial || '<p><br data-mce-bogus="1"></p>';
  const seen = [];
  box.addEventListener('paste', (ev) => {
    seen.push(ev);
    const html = ev.clipboardData.getData('text/html');
    if (html.indexOf('<!-- x-tinymce/html -->') !== 0) return;
    ev.preventDefault();
    box.innerHTML = box.innerHTML + html.slice('<!-- x-tinymce/html -->'.length);
  });
  env.doc.querySelectorAll = (sel) => (sel === SEL ? [box] : []);
  return { box, seen };
}

function body(env, w, inForm) {
  const b = env.makeElement('div');
  b.getBoundingClientRect = () => ({ width: w, height: w ? 100 : 0 });
  b.closest = (sel) => (sel === '.forums-new-post-wrap' && inForm ? {} : null);
  return b;
}

test('several TinyMCE bodies: the visible one, then the one in the reply form, else none', () => {
  const env = loadUserscript();
  const hidden = body(env, 0, false);
  const shown = body(env, 600, false);
  env.doc.querySelectorAll = () => [hidden, shown];
  assert.strictEqual(env.exports.findReplyBox(env.doc), shown, 'a hidden edit box before the reply box is skipped');
  const editBox = body(env, 600, false);
  const reply = body(env, 600, true);
  env.doc.querySelectorAll = () => [editBox, reply];
  assert.strictEqual(env.exports.findReplyBox(env.doc), reply, 'two visible: the one in .forums-new-post-wrap');
  env.doc.querySelectorAll = () => [body(env, 600, false), body(env, 600, false)];
  assert.strictEqual(env.exports.findReplyBox(env.doc), null, 'ambiguous: never guess');
  env.doc.querySelectorAll = () => { throw new Error('Torn changed something'); };
  assert.strictEqual(env.exports.findReplyBox(env.doc), null);
});

test('Insert pastes the marked post into Torn\'s editor and reports success', () => {
  const env = loadUserscript();
  const { box, seen } = tinyBody(env);
  const res = env.exports.insertPost(env.doc, env.sandbox.window, '<p><strong>b</strong></p>');
  assert.deepStrictEqual(res, { ok: true });
  assert.strictEqual(seen.length, 1);
  assert.strictEqual(seen[0].type, 'paste');
  assert.ok(seen[0].bubbles && seen[0].cancelable);
  assert.strictEqual(seen[0].clipboardData.getData('text/html'), '<!-- x-tinymce/html --><p><strong>b</strong></p>');
  assert.strictEqual(seen[0].clipboardData.getData('text/plain'), 'b');
  assert.match(box.innerHTML, /<strong>b<\/strong>/);
});

test('Insert puts the caret at the end first, so nothing typed is replaced (Review Focus 2)', () => {
  const env = loadUserscript();
  const { box } = tinyBody(env, '<p>already typed</p>');
  env.exports.insertPost(env.doc, env.sandbox.window, '<p>new</p>');
  assert.deepStrictEqual(env.selectionLog.map((x) => x.op), ['selectNodeContents', 'collapse', 'removeAllRanges', 'addRange']);
  assert.strictEqual(env.selectionLog[0].node, box);
  assert.strictEqual(env.selectionLog[1].toStart, false);
  assert.strictEqual(box.innerHTML, '<p>already typed</p><p>new</p>');
});

test('a long post is sent whole (Review Focus 3)', () => {
  const env = loadUserscript();
  const { seen } = tinyBody(env);
  const md = ('{red}**word**{/} ').repeat(1100); // 18700 characters
  const html = env.exports.mdToHtml(md);
  assert.ok(md.length < env.exports.DRAFT_MAX_CHARS && html.length > env.exports.DRAFT_MAX_CHARS);
  // The source survives conversion whole, independent of what Insert sends.
  assert.strictEqual((html.match(/<strong>word<\/strong>/g) || []).length, 1100);
  env.exports.insertPost(env.doc, env.sandbox.window, html);
  assert.strictEqual(seen[0].clipboardData.getData('text/html'), '<!-- x-tinymce/html -->' + html);
});

test('an editor that ignores the paste is reported, and Copy is offered', () => {
  const env = loadUserscript();
  const box = body(env, 600, true);
  env.doc.querySelectorAll = (sel) => (sel === SEL ? [box] : []);
  const res = env.exports.insertPost(env.doc, env.sandbox.window, '<p>x</p>');
  assert.strictEqual(res.ok, false);
  assert.strictEqual(res.reason, 'refused');
  assert.match(res.detail, /Copy/);
});

test('no editor on the page means Copy, never a Report box (#60)', () => {
  const env = loadUserscript();
  const reason = env.makeElement('textarea');
  reason.getBoundingClientRect = () => ({ width: 100, height: 20 });
  env.doc.querySelector = (sel) => (/textarea/.test(sel) ? reason : null);
  env.doc.querySelectorAll = (sel) => (/textarea/.test(sel) ? [reason] : []);
  assert.strictEqual(env.exports.findReplyBox(env.doc), null);
  const res = env.exports.insertPost(env.doc, env.sandbox.window, '<p>x</p>');
  assert.strictEqual(res.reason, 'noreplybox');
  assert.strictEqual(reason.value, '');
  assert.deepStrictEqual(env.exports.REPLY_SELECTORS.slice(), [SEL]);
});

test('a browser without DataTransfer is told to use Copy', () => {
  const env = loadUserscript();
  tinyBody(env);
  const win = Object.assign({}, env.sandbox.window, { DataTransfer: undefined });
  const res = env.exports.insertPost(env.doc, win, '<p>x</p>');
  assert.strictEqual(res.reason, 'unsupported');
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `node --test tests/editor-insert.test.js`
Expected: FAIL, `insertPost is not a function`.

- [ ] **Step 3: Implement it.** Replace `REPLY_SELECTORS`, its comment, and
  `insertDraft` with:

```js
  // Torn's reply box is TinyMCE 6.8.5 in inline mode: a contenteditable div,
  // not a textarea (docs/reference/torn-forum-editor-findings-2026-10-09.md).
  // These hooks are unhashed, and TornTools uses the same selector. There is
  // no textarea fallback on purpose: the old broad fallbacks matched a hidden
  // Report reason box and wrote the draft there (#60). A miss offers Copy.
  var REPLY_SELECTORS = Object.freeze([
    '#editor-wrapper .editor-content.mce-content-body',
  ]);
```

Replace `findReplyBox` with the version below (spec section 7, "Several
matches"). It reads only the matched elements' size and ancestry. That is part
of the same reply-box access point, and every call is guarded.

```js
  function isShown(el) {
    try {
      var r = el.getBoundingClientRect();
      return !!r && r.width > 0 && r.height > 0;
    } catch (e) { return false; }
  }

  // A thread page holds several TinyMCE editors (the owner's probe found five).
  // Keep the connected, visible ones; if more than one is visible, the one in
  // the reply or new-thread form; if that is still ambiguous, none, so the
  // panel offers Copy rather than guessing.
  function findReplyBox(doc) {
    if (!doc || typeof doc.querySelectorAll !== 'function') return null;
    var all;
    try { all = Array.prototype.slice.call(doc.querySelectorAll(REPLY_SELECTORS[0]) || []); } catch (e) { return null; }
    var shown = all.filter(function (el) {
      return el && el.isConnected !== false && typeof el.getBoundingClientRect === 'function' && isShown(el);
    });
    if (shown.length === 1) return shown[0];
    var inForm = shown.filter(function (el) {
      try { return typeof el.closest === 'function' && !!el.closest('.forums-new-post-wrap'); } catch (e) { return false; }
    });
    return inForm.length === 1 ? inForm[0] : null;
  }
```

Then add:

```js
  // The paste lands at the caret, so the caret goes to the end first: Insert
  // adds to what the player has typed and never replaces it.
  function caretToEnd(doc, win, box) {
    try {
      var sel = win && typeof win.getSelection === 'function' ? win.getSelection() : null;
      if (!sel || !doc || typeof doc.createRange !== 'function') return;
      var range = doc.createRange();
      range.selectNodeContents(box);
      range.collapse(false);
      sel.removeAllRanges();
      sel.addRange(range);
    } catch (e) { /* the paste still lands, at TinyMCE's own caret */ }
  }

  // ADR 0002. One synthetic paste, marked as TinyMCE's own content so Torn's
  // paste_webkit_styles: 'none' filter keeps the styles (owner-observed, test
  // B). TinyMCE calls preventDefault on a paste it handles, so dispatchEvent
  // returning false, and the body having changed, together mean it landed.
  // The player still presses Post.
  function insertPost(doc, win, html) {
    var box = findReplyBox(doc);
    if (!box) {
      return { ok: false, reason: 'noreplybox', detail: 'No reply box found on this page. Use Copy instead.' };
    }
    var DT = win && win.DataTransfer;
    var CE = win && win.ClipboardEvent;
    if (typeof DT !== 'function' || typeof CE !== 'function') {
      return { ok: false, reason: 'unsupported', detail: 'This browser cannot insert for you. Use Copy instead.' };
    }
    try {
      var before = String(box.innerHTML);
      if (typeof box.focus === 'function') box.focus();
      caretToEnd(doc, win, box);
      var data = new DT();
      data.setData('text/html', PASTE_MARKER + html);
      data.setData('text/plain', htmlToText(html));
      var handled = box.dispatchEvent(new CE('paste', { clipboardData: data, bubbles: true, cancelable: true })) === false;
      if (handled && String(box.innerHTML) !== before) return { ok: true };
      return { ok: false, reason: 'refused', detail: 'Torn\'s editor did not accept the insert. Use Copy instead.' };
    } catch (e) {
      return { ok: false, reason: 'insert', detail: 'Could not write into the reply box. Use Copy instead.' };
    }
  }
```

In `tests/load-userscript.js`, add `'insertPost', 'caretToEnd'` and remove
`'insertDraft'` if it is listed.

In `tests/drafts.test.js`, delete the three tests that use `insertDraft`, the
native setter and the `input` event:
- "insertDraft writes through the native setter so React notices";
- "insertDraft dispatches a bubbling input event";
- "with no reply box the panel is told to offer Copy instead of throwing".

`tests/editor-insert.test.js` now carries those promises. Rewrite
"findReplyBox prefers the most specific selector and skips detached nodes" as:

```js
test('findReplyBox finds Torn\'s editor body and skips a detached one', () => {
  const env = loadUserscript();
  const body = env.makeElement('div');
  body.getBoundingClientRect = () => ({ width: 600, height: 160 });
  env.doc.querySelectorAll = (sel) => (sel === '#editor-wrapper .editor-content.mce-content-body' ? [body] : []);
  assert.strictEqual(env.exports.findReplyBox(env.doc), body);
  body.isConnected = false;
  assert.strictEqual(env.exports.findReplyBox(env.doc), null, 'a detached node is not a reply box');
});
```

Rewrite "a querySelector that throws does not take the script down" to stub
`env.doc.querySelectorAll`, since that is now the call that can throw.

In `tests/read-only.test.js`, in the focus audit ("the only focus call is on
the reply box"), change both `'function insertDraft'` and the message
`'inside insertDraft'` to `insertPost`. The one `box.focus()` call stays, so
the count of two holds.

In `tests/read-only.test.js`, replace the second test with:

```js
test('the only synthetic event is the paste a draft insert needs', () => {
  // ADR 0002: Torn's reply box is TinyMCE, and one marked paste is how a
  // formatted post reaches it. It types into a box; it does not send anything.
  // The user still presses Post.
  const dispatches = SOURCE.match(/dispatchEvent\s*\([^)]*\)/g) || [];
  assert.strictEqual(dispatches.length, 1, 'unexpected dispatchEvent calls: ' + dispatches.join(' | '));
  assert.match(dispatches[0], /new CE\('paste'/);
  assert.ok(!/new\s+(?:window\.)?ClipboardEvent\s*\(\s*'(?:copy|cut)'/.test(SOURCE), 'no synthetic copy or cut');
});
```

The draft handler at code map line ~8054 (`act === 'draft-insert'`) still calls
`insertDraft`. Point it at the new function for now; Task 10 rewrites it:

```js
        if (act === 'draft-insert' && id) {
          var dd = draftFor(state.drafts, id);
          var ins = insertPost(doc, win, dd ? postHtml(dd.text, draftLangOf(dd)) : '');
          notice(ins.ok ? 'Draft inserted.' : (ins.detail || 'Could not insert.'), ins.ok ? 'info' : 'warn');
          redraw(); return;
        }
```

In `tests/mutation-check.mjs`, grep for `insertDraft`, `EventCtor` and
`HTMLTextAreaElement`. Rewrite each entry that names the old lines so it breaks
the same promise in the new code. For example, "the native setter is
bypassed" becomes "the paste is not marked as TinyMCE content":

```js
  {
    name: 'the inserted paste loses TinyMCE\'s internal marker, so Torn strips the styles',
    suite: 'tests/editor-insert.test.js',
    apply: (s) => s.replace("data.setData('text/html', PASTE_MARKER + html);", "data.setData('text/html', html);"),
  },
  {
    name: 'Insert no longer moves the caret to the end, so it can replace what was typed',
    suite: 'tests/editor-insert.test.js',
    apply: (s) => s.replace('      caretToEnd(doc, win, box);\n', ''),
  },
  {
    name: 'an ignored paste is reported as inserted',
    suite: 'tests/editor-insert.test.js',
    apply: (s) => s.replace("if (handled && String(box.innerHTML) !== before) return { ok: true };", 'return { ok: true };'),
  },
  {
    name: 'the first matching editor is taken, hidden or not (#60 by another route)',
    suite: 'tests/editor-insert.test.js',
    apply: (s) => s.replace('    if (shown.length === 1) return shown[0];', '    if (all.length) return all[0];'),
  },
  {
    name: 'two visible editors are guessed between',
    suite: 'tests/editor-insert.test.js',
    apply: (s) => s.replace('    return inForm.length === 1 ? inForm[0] : null;', '    return shown[0] || null;'),
  },
```

- [ ] **Step 4: Run the tests**

Run: `node --test tests/editor-insert.test.js tests/drafts.test.js tests/read-only.test.js`
Expected: PASS.

- [ ] **Step 5: Run the suite and the mutation check, then commit**

Run `npm test`. Then run `node tests/mutation-check.mjs > mutation.log 2>&1`,
read `mutation.log`, and confirm every entry reports caught.

```bash
git add torn-forum-command-center.user.js tests/editor-insert.test.js tests/drafts.test.js tests/read-only.test.js tests/mutation-check.mjs tests/load-userscript.js
git commit -m "fix: Insert pastes into Torn's TinyMCE editor, never a Report box (#58, #60)"
```

---

### Task 8: Copy as a formatted post

**Files:**
- Modify: `torn-forum-command-center.user.js`, after `copyText` (code map line
  388)
- Modify: `tests/load-userscript.js`
- Test: `tests/editor-insert.test.js` (append)

**Interfaces:**
- Produces: `copyPost(doc, win, html, done)` returns nothing. It calls
  `done({ ok })` once the clipboard has answered, which may be after a promise
  settles. The handler shows its notice from `done`, never before.

- [ ] **Step 1: Write the failing test** (append to `tests/editor-insert.test.js`)

```js
const settle = () => new Promise((r) => setImmediate(r));

test('Copy writes the marked post as HTML and the source as plain text, then reports', async () => {
  const env = loadUserscript();
  const results = [];
  env.exports.copyPost(env.doc, env.sandbox.window, '<p><strong>b</strong></p><p>c</p>', (r) => results.push(r));
  assert.deepStrictEqual(results, [], 'not before the clipboard answers');
  await settle();
  assert.deepStrictEqual(results, [{ ok: true }]);
  const item = env.clipboardLog.find((x) => x.op === 'write').items[0];
  assert.deepStrictEqual(item.types.slice().sort(), ['text/html', 'text/plain']);
  assert.deepStrictEqual(item.map['text/html'].parts, ['<!-- x-tinymce/html --><p><strong>b</strong></p><p>c</p>']);
  assert.deepStrictEqual(item.map['text/plain'].parts, ['<p><strong>b</strong></p>\n<p>c</p>']);
});

test('a refused rich copy falls back to text, and a refused text copy reports failure', async () => {
  const env = loadUserscript();
  const w = env.sandbox.window;
  const results = [];
  const win = Object.assign({}, w, { navigator: { clipboard: {
    write: () => Promise.reject(new Error('denied')),
    writeText: (t) => { env.clipboardLog.push({ op: 'writeText', text: t }); return Promise.resolve(); },
  } } });
  env.exports.copyPost(env.doc, win, '<p>x</p>', (r) => results.push(r));
  await settle(); await settle();
  assert.deepStrictEqual(results, [{ ok: true }]);
  assert.deepStrictEqual(env.clipboardLog.map((x) => x.op), ['writeText']);
  const results2 = [];
  const win2 = Object.assign({}, w, { ClipboardItem: undefined, navigator: { clipboard: {
    writeText: () => Promise.reject(new Error('denied')),
  } } });
  env.exports.copyPost(env.doc, win2, '<p>x</p>', (r) => results2.push(r));
  await settle(); await settle();
  assert.deepStrictEqual(results2, [{ ok: false }]);
});
```

The fallback calls `writeText` directly, not `copyText`. `copyText`'s
`execCommand` path needs user activation, which has gone by the time a promise
has rejected.

- [ ] **Step 2: Run it and watch it fail**

Run: `node --test tests/editor-insert.test.js`
Expected: FAIL, `copyPost is not a function`.

- [ ] **Step 3: Implement it.** Add after `copyText`:

```js
  // #58: Copy puts the formatted post on the clipboard. Pasted into Torn's
  // editor, the marked HTML keeps its styles. Pasted as text, it is the HTML
  // source, ready for Torn's code view. The result is reported only once the
  // clipboard has answered, so the panel never claims a copy that failed.
  function copyPost(doc, win, html, done) {
    var source = htmlSource(html);
    var report = function (ok) { try { if (typeof done === 'function') done({ ok: !!ok }); } catch (e) { /* never */ } };
    var nav = win && win.navigator;
    var clip = nav && nav.clipboard;
    var asText = function () {
      try {
        if (clip && typeof clip.writeText === 'function') {
          var t = clip.writeText(source);
          if (t && typeof t.then === 'function') { t.then(function () { report(true); }, function () { report(false); }); return; }
          report(true);
          return;
        }
      } catch (e) { /* fall through to the textarea path */ }
      report(copyText(doc, win, source).ok);
    };
    try {
      var Item = win && win.ClipboardItem;
      var BlobCtor = win && win.Blob;
      if (clip && typeof clip.write === 'function' && typeof Item === 'function' && typeof BlobCtor === 'function') {
        var item = new Item({
          'text/html': new BlobCtor([PASTE_MARKER + html], { type: 'text/html' }),
          'text/plain': new BlobCtor([source], { type: 'text/plain' }),
        });
        var p = clip.write([item]);
        if (p && typeof p.then === 'function') { p.then(function () { report(true); }, asText); return; }
        report(true);
        return;
      }
    } catch (e2) { /* fall through to plain text */ }
    asText();
  }
```

The handler (Task 10) calls it like this:

```js
copyPost(doc, win, html, function (r) {
  notice(r.ok ? 'Post copied. Paste it into Torn\'s reply box.' : 'Copy failed. Switch to HTML, select the text and copy it yourself.', r.ok ? 'info' : 'warn');
  redraw();
});
```

Add `'copyPost'` to `EXPORT_NAMES`.

- [ ] **Step 4: Run the tests**

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
npm test
git add torn-forum-command-center.user.js tests/editor-insert.test.js tests/load-userscript.js
git commit -m "feat: Copy puts the formatted post on the clipboard (#58)"
```

---

### Task 9: Autosave from Torn's editor

**Files:**
- Modify: `torn-forum-command-center.user.js`, `attachAutosave` (code map line
  276; source around 4550 to 4583)
- Modify: `tests/staleness.test.js` (the `replyBox` helper and the autosave
  tests), `tests/mutation-check.mjs` (the two autosave entries at lines ~186 to
  198)
- Test: `tests/editor-insert.test.js` (append)

**Interfaces:**
- Consumes: `cleanTornHtml`, `htmlSource`, `htmlToText`, `draftFor`,
  `draftLangOf` and `saveDraft`.

- [ ] **Step 1: Write the failing tests** (append)

```js
function autosaveEnv(drafts) {
  const env = loadUserscript({ location: Object.assign({}, require('./load-userscript').FORUMS_LOCATION, { hash: '#/p=threads&f=1&t=42&b=0&a=0' }) });
  const api = env.exports;
  const box = env.makeElement('div');
  box.getBoundingClientRect = () => ({ width: 600, height: 160 });
  env.doc.querySelectorAll = (sel) => (sel === SEL ? [box] : []);
  api.state.route = api.parseForumRoute(env.win.location);
  if (drafts) api.state.drafts = drafts;
  api.attachAutosave(env.doc, env.win);
  const input = (html) => {
    box.innerHTML = html;
    box.dispatchEvent(new env.sandbox.window.Event('input', { bubbles: true }));
  };
  const type = (html) => { input(html); env.advanceTimersBy(api.AUTOSAVE_DEBOUNCE_MS + 10); };
  return { env, api, box, input, type };
}

test('autosave saves Torn\'s editor as a cleaned HTML draft', () => {
  const { api, type } = autosaveEnv();
  type('<p><strong data-mce-style="x">hi</strong></p>');
  const d = api.draftFor(api.state.drafts, 42);
  assert.strictEqual(d.lang, 'html');
  assert.strictEqual(d.text, '<p><strong>hi</strong></p>');
});

test('typing in thread 42 then moving to thread 43 before the debounce saves nothing to 43', () => {
  const { env, api, input } = autosaveEnv();
  input('<p>for 42</p>');
  api.state.route = api.parseForumRoute({ hash: '#/p=threads&f=1&t=43&b=0&a=0', pathname: '/forums.php', host: 'www.torn.com' });
  env.advanceTimersBy(api.AUTOSAVE_DEBOUNCE_MS + 10);
  assert.strictEqual(api.draftFor(api.state.drafts, 43), null);
});

test('an editor body over the draft limit is not autosaved, so nothing is stored cut short', () => {
  const { api, type } = autosaveEnv();
  type('<p>' + 'x'.repeat(api.DRAFT_MAX_CHARS + 10) + '</p>');
  assert.strictEqual(api.draftFor(api.state.drafts, 42), null);
});

test('autosave never overwrites a Markdown or Text draft', () => {
  for (const lang of ['md', undefined]) {
    const { api, type } = autosaveEnv(
      require('./load-userscript').loadUserscript().exports.saveDraft({ v: 1, byThread: {} }, 42, '**mine**', 1, 'T', lang));
    type('<p>torn side</p>');
    assert.strictEqual(api.draftFor(api.state.drafts, 42).text, '**mine**', String(lang));
  }
});

test('an empty editor never deletes or overwrites a draft', () => {
  const { api, type } = autosaveEnv();
  type('<p>keep</p>');
  type('<p><br data-mce-bogus="1"></p>');
  assert.strictEqual(api.draftFor(api.state.drafts, 42).text, '<p>keep</p>');
});
```

Check how the existing suites reach timers. If `env.advanceTimersBy` is not on
`env`, use the name `tests/staleness.test.js` uses.

- [ ] **Step 2: Run them and watch them fail**

Expected: FAIL. The current listener reads `box.value`.

- [ ] **Step 3: Implement it.** Replace `attachAutosave` and `detachAutosave`,
  and the two `var autosave...` lines above them, with:

```js
  // Autosave keeps its own record of which element, which listener and which
  // thread it is serving. The panel redraws on every interaction, so attaching
  // per draw would pile up listeners; and a timer must save to the thread it
  // was started for, never to the one the player has since moved to.
  var autosaveBox = null;
  var autosaveTimer = null;
  var autosaveListener = null;
  var autosaveThread = null;

  function attachAutosave(doc, win) {
    void win;
    if (!state.settings.autosaveDrafts || !state.route || !state.route.isThread) { detachAutosave(); return false; }
    var box = findReplyBox(doc);
    if (!box || typeof box.addEventListener !== 'function') { detachAutosave(); return false; }
    var thread = String(state.route.threadId);
    if (autosaveBox === box && autosaveThread === thread) return true;
    detachAutosave();
    autosaveBox = box;
    autosaveThread = thread;
    autosaveListener = function () {
      if (autosaveTimer !== null) clearTimeout(autosaveTimer);
      autosaveTimer = setTimeout(function () {
        autosaveTimer = null;
        try {
          if (!state.settings.autosaveDrafts) return;
          if (!state.route || String(state.route.threadId) !== thread || autosaveBox !== box) return;
          // #58: the box is TinyMCE's body, so its HTML is the post, cleaned
          // like everything else and saved as an HTML draft, never over a
          // Markdown or Text draft the player wrote in the panel.
          var post = cleanTornHtml(String(box.innerHTML || ''));
          // An empty editor never deletes a saved draft. Torn clears the box
          // after a successful post, and can hand back an empty body during a
          // re-render; either would otherwise wipe work the user still wants.
          if (!htmlToText(post).trim() && post.indexOf('<img') === -1) return;
          var source = htmlSource(post);
          // Over the draft limit: skip rather than store a truncated post.
          if (source.length > DRAFT_MAX_CHARS) return;
          var existing = draftFor(state.drafts, thread);
          if (existing && draftLangOf(existing) !== 'html') return;
          state.drafts = saveDraft(state.drafts, thread, source, Date.now(), '', 'html');
          persist('drafts');
        } catch (e) { /* autosave must never throw onto Torn's page */ }
      }, AUTOSAVE_DEBOUNCE_MS);
    };
    box.addEventListener('input', autosaveListener);
    return true;
  }

  function detachAutosave() {
    if (autosaveBox && autosaveListener && typeof autosaveBox.removeEventListener === 'function') {
      try { autosaveBox.removeEventListener('input', autosaveListener); } catch (e) { /* the box is gone */ }
    }
    autosaveBox = null;
    autosaveListener = null;
    autosaveThread = null;
    if (autosaveTimer !== null) { clearTimeout(autosaveTimer); autosaveTimer = null; }
  }
```

In `tests/staleness.test.js`, change the `replyBox(env)` helper to build the
editor body:

```js
// Torn's reply box: TinyMCE's contenteditable body (ADR 0002). Tests "type" by
// setting its HTML and dispatching input, the way TinyMCE's own typing does.
function replyBox(env) {
  const box = env.makeElement('div');
  box.getBoundingClientRect = () => ({ width: 600, height: 160 });
  env.doc.querySelectorAll = (sel) => (sel === '#editor-wrapper .editor-content.mce-content-body' ? [box] : []);
  Object.defineProperty(box, 'value', { get() { return box.innerHTML; }, set(v) { box.innerHTML = '<p>' + v + '</p>'; } });
  return box;
}
```

With this, existing tests that set `box.value = 'text'` keep working. Any
assertion on a saved draft's text must now expect `'<p>text</p>'`. Update each
such assertion, and update any test whose title says "textarea" to "reply box".

In `tests/mutation-check.mjs`:
- Update "autosave stops writing anything" to replace the new `saveDraft(...)`
  line, `"          state.drafts = saveDraft(state.drafts, thread, source, Date.now(), '', 'html');"`.
- Update "an emptied reply box is autosaved over the draft" to remove the new
  empty-check line.
- Add:

```js
  {
    name: 'autosave overwrites a Markdown draft with Torn\'s HTML',
    suite: 'tests/editor-insert.test.js',
    apply: (s) => s.replace("          if (existing && draftLangOf(existing) !== 'html') return;\n", ''),
  },
  {
    name: 'a pending autosave saves to whichever thread is open now',
    suite: 'tests/editor-insert.test.js',
    apply: (s) => s.replace("if (!state.route || String(state.route.threadId) !== thread || autosaveBox !== box) return;", 'thread = String(state.route.threadId);'),
  },
  {
    name: 'autosave stores an over-limit post, cut short',
    suite: 'tests/editor-insert.test.js',
    apply: (s) => s.replace('          if (source.length > DRAFT_MAX_CHARS) return;\n', ''),
  },
```

- [ ] **Step 4: Run the tests**

Run: `node --test tests/editor-insert.test.js tests/staleness.test.js`
Expected: PASS.

- [ ] **Step 5: Run the suite and the mutation check, then commit**

```bash
npm test
node tests/mutation-check.mjs > mutation.log 2>&1   # then read mutation.log
git add torn-forum-command-center.user.js tests/editor-insert.test.js tests/staleness.test.js tests/mutation-check.mjs
git commit -m "fix: autosave reads Torn's editor and never overwrites a panel draft (#58, #60)"
```

---

### Task 10: The editor view: mode pill, pane, Preview, actions, free drafts

**Files:**
- Modify: `torn-forum-command-center.user.js`:
  - initial `state` (code map: `draftFocusId: null`, line 3753), adding `editor`;
  - `buildPanelModel` (line ~5489), adding `model.editor`;
  - `renderDraftsView` (line 6260), rewritten;
  - the panel CSS array (grep `tfcc-draft`);
  - `restoreSelection` (line ~7738);
  - `makeHandlers`: the draft actions (line ~8037), `onChange`, and `onInput`.
- Create: `tests/editor-view.test.js`
- Modify: `tests/handlers.test.js`, the `dataOnly` list and `renderedActions`
  setup

**Interfaces:**
- Consumes: `postHtml`, `convertDraft`, `previewModel`, `draftFor`,
  `draftLangOf`, `saveDraft`, `saveFreeDraft`, `newFreeDraft`,
  `deleteFreeDraft`, `insertPost` and `copyPost`.
- Produces:
  - `state.editor` is `{ key, lang, text, selStart, selEnd, mode: 'source'|'preview', previewTheme: null|'light'|'dark', picker: null|string, confirmText: null|'md'|'html', moreOpen: false, emojiTab: 'torn', name, imageCheck: null, pickerWarn: null }`;
  - `editorKeyFor(model)` returns the draft key the Drafts view edits, or `null`;
  - `loadEditor(key, now)` points `state.editor` at a draft;
  - `editorPostHtml()` returns the cleaned post for the open draft;
  - `renderEditorPane(model)` and `renderDraftList(model)` return HTML strings.
- The new `data-act` values are `ed-mode`, `ed-mode-confirm`, `ed-mode-cancel`,
  `ed-pv-theme`, `ed-pv-images`, `ed-jump`, `draft-new`, `draft-edit` and
  `ed-name`, which carries data only.
- `previewImages(html, show)` is a pure engine function that returns HTML.

- [ ] **Step 1: Write the failing tests** in `tests/editor-view.test.js`

```js
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { loadUserscript, FORUMS_LOCATION } = require('./load-userscript');

const NOW = 1700000000000;
const THREAD = Object.assign({}, FORUMS_LOCATION, { hash: '#/p=threads&f=1&t=42&b=0&a=0' });
const el = (attrs) => ({ getAttribute: (k) => (attrs[k] === undefined ? null : attrs[k]) });

function drafts(env) {
  const api = env.exports;
  api.state.route = api.parseForumRoute(env.win.location);
  api.state.settings.view = 'drafts';
  return api;
}

test('a new thread draft opens in the Default editor mode', () => {
  const env = loadUserscript({ location: THREAD, now: NOW });
  const api = drafts(env);
  api.state.settings.draftLang = 'html';
  const html = api.panelHtml(api.buildPanelModel(NOW));
  assert.match(html, /data-act="ed-mode" data-mode="html" aria-pressed="true"/);
  assert.match(html, /<textarea class="tfcc-draft" data-act="draft-text" data-id="42"/);
});

test('an old draft holding raw HTML opens as Text, and Preview shows the tags (Review Focus 5)', () => {
  const env = loadUserscript({ location: THREAD, now: NOW });
  const api = drafts(env);
  api.state.drafts = api.normaliseDrafts({ v: 1, byThread: { 42: { text: '<p><strong>bold</strong> test</p>', updatedAt: 1, title: 'T' } } });
  api.state.settings.draftLang = 'md';
  api.panelHtml(api.buildPanelModel(NOW)); // loads the draft into the editor
  const h = api.makeHandlers(env.doc, env.win);
  h.onAction('ed-mode', el({ 'data-act': 'ed-mode', 'data-mode': 'preview' }));
  const html = api.panelHtml(api.buildPanelModel(NOW));
  assert.strictEqual(api.state.editor.lang, 'text');
  assert.match(html, /data-act="ed-mode" data-mode="text" aria-pressed="false"/);
  assert.match(html, /&lt;strong&gt;bold&lt;\/strong&gt;/);
  assert.doesNotMatch(html, /<strong>bold<\/strong>/);
});

test('switching MD to HTML converts the text; switching to Text asks first', () => {
  const env = loadUserscript({ location: THREAD, now: NOW });
  const api = drafts(env);
  api.state.settings.draftLang = 'md';
  api.panelHtml(api.buildPanelModel(NOW));
  const h = api.makeHandlers(env.doc, env.win);
  h.onInput('draft-text', Object.assign(el({ 'data-act': 'draft-text', 'data-id': '42' }), { value: '**b**', selectionStart: 5, selectionEnd: 5 }));
  h.onAction('ed-mode', el({ 'data-act': 'ed-mode', 'data-mode': 'html' }));
  assert.strictEqual(api.state.editor.lang, 'html');
  assert.strictEqual(api.state.editor.text, '<p><strong>b</strong></p>');
  h.onAction('ed-mode', el({ 'data-act': 'ed-mode', 'data-mode': 'text' }));
  assert.strictEqual(api.state.editor.lang, 'html', 'not yet');
  assert.match(api.panelHtml(api.buildPanelModel(NOW)), /Plain text drops the formatting/);
  h.onAction('ed-mode-confirm', el({ 'data-act': 'ed-mode-confirm' }));
  assert.strictEqual(api.state.editor.lang, 'text');
  assert.strictEqual(api.state.editor.text, 'b');
});

test('Preview renders cleaned blocks that jump back to their source line', () => {
  const env = loadUserscript({ location: THREAD, now: NOW });
  const api = drafts(env);
  api.state.drafts = api.saveDraft(api.freshDrafts(), 42, '# T\nline <img src=x onerror=alert(1)>', NOW, 'T', 'md');
  api.panelHtml(api.buildPanelModel(NOW)); // loads the draft into the editor
  const h = api.makeHandlers(env.doc, env.win);
  h.onAction('ed-mode', el({ 'data-act': 'ed-mode', 'data-mode': 'preview' }));
  const html = api.panelHtml(api.buildPanelModel(NOW));
  assert.match(html, /class="tfcc-pv-block" data-act="ed-jump" data-offset="0"/);
  assert.match(html, /data-act="ed-jump" data-offset="4"/);
  assert.doesNotMatch(html, /onerror/);
  h.onAction('ed-jump', el({ 'data-act': 'ed-jump', 'data-offset': '4' }));
  assert.strictEqual(api.state.editor.mode, 'source');
  assert.deepStrictEqual([api.state.editor.selStart, api.state.editor.selEnd], [4, 4]);
});

test('+ New draft makes a free draft and opens it; Insert uses the editor\'s text', () => {
  const env = loadUserscript({ location: FORUMS_LOCATION, now: NOW });
  const api = drafts(env);
  const h = api.makeHandlers(env.doc, env.win);
  h.onAction('draft-new', el({ 'data-act': 'draft-new' }));
  const key = api.state.draftFocusId;
  assert.match(key, /^n[0-9]+$/);
  api.panelHtml(api.buildPanelModel(NOW));
  assert.strictEqual(api.state.editor.key, key);
  h.onInput('draft-text', Object.assign(el({ 'data-act': 'draft-text', 'data-id': key }), { value: '{red}hi{/}', selectionStart: 0, selectionEnd: 0 }));
  assert.strictEqual(api.editorPostHtml(), '<p><span style="color: var(--te-text-color-red);">hi</span></p>');
  h.onAction('draft-save', el({ 'data-act': 'draft-save', 'data-id': key }));
  assert.strictEqual(api.draftFor(api.state.drafts, key).text, '{red}hi{/}');
  assert.strictEqual(api.draftFor(api.state.drafts, key).lang, 'md');
  const list = api.panelHtml(api.buildPanelModel(NOW));
  assert.match(list, /tfcc-free/);
  assert.match(list, /data-act="draft-edit" data-id="n/);
  // Insert sends the editor's converted post to Torn's editor.
  const pasted = [];
  const box = env.makeElement('div');
  box.getBoundingClientRect = () => ({ width: 600, height: 160 });
  box.addEventListener('paste', (ev) => { pasted.push(ev.clipboardData.getData('text/html')); ev.preventDefault(); box.innerHTML += 'x'; });
  env.doc.querySelectorAll = (sel) => (sel === '#editor-wrapper .editor-content.mce-content-body' ? [box] : []);
  h.onAction('draft-insert', el({ 'data-act': 'draft-insert', 'data-id': key }));
  assert.deepStrictEqual(pasted, ['<!-- x-tinymce/html --><p><span style="color: var(--te-text-color-red);">hi</span></p>']);
});

test('opening another draft after typing, without Save, keeps what was typed', () => {
  const env = loadUserscript({ location: FORUMS_LOCATION, now: NOW });
  const api = drafts(env);
  const h = api.makeHandlers(env.doc, env.win);
  h.onAction('draft-new', el({ 'data-act': 'draft-new' }));
  const first = api.state.draftFocusId;
  api.panelHtml(api.buildPanelModel(NOW));
  h.onInput('draft-text', Object.assign(el({ 'data-act': 'draft-text', 'data-id': first }), { value: 'unsaved words', selectionStart: 0, selectionEnd: 0 }));
  h.onAction('draft-new', el({ 'data-act': 'draft-new' }));
  api.panelHtml(api.buildPanelModel(NOW));
  assert.notStrictEqual(api.state.editor.key, first);
  assert.strictEqual(api.draftFor(api.state.drafts, first).text, 'unsaved words');
});

test('a switch that would pass the draft limit is refused, and the draft is unchanged', () => {
  const env = loadUserscript({ location: THREAD, now: NOW });
  const api = drafts(env);
  api.panelHtml(api.buildPanelModel(NOW));
  const h = api.makeHandlers(env.doc, env.win);
  const big = ':grin:\n'.repeat(2500); // 17500 characters, about 100000 as HTML
  h.onInput('draft-text', Object.assign(el({ 'data-act': 'draft-text', 'data-id': '42' }), { value: big, selectionStart: 0, selectionEnd: 0 }));
  h.onAction('ed-mode', el({ 'data-act': 'ed-mode', 'data-mode': 'html' }));
  assert.strictEqual(api.state.editor.lang, 'md');
  assert.strictEqual(api.state.editor.text, big);
  assert.ok(api.state.notices.some((n) => /over the 20000 limit/.test(n.text)));
});

test('Preview shows a placeholder for an external image until Show images', () => {
  const env = loadUserscript({ location: THREAD, now: NOW });
  const api = drafts(env);
  api.state.drafts = api.saveDraft(api.freshDrafts(), 42, '![a](https://i.imgur.com/x.png) :grin:', NOW, 'T', 'md');
  api.panelHtml(api.buildPanelModel(NOW));
  const h = api.makeHandlers(env.doc, env.win);
  h.onAction('ed-mode', el({ 'data-act': 'ed-mode', 'data-mode': 'preview' }));
  let html = api.panelHtml(api.buildPanelModel(NOW));
  assert.doesNotMatch(html, /src="https:\/\/i\.imgur\.com/);
  assert.match(html, /\[image from i\.imgur\.com\]/);
  assert.match(html, /src="\/images\/emotions\/svg\/grin\.svg"/, 'Torn emoji always show');
  h.onAction('ed-pv-images', el({ 'data-act': 'ed-pv-images' }));
  html = api.panelHtml(api.buildPanelModel(NOW));
  assert.match(html, /<img referrerpolicy="no-referrer" src="https:\/\/i\.imgur\.com\/x\.png"/);
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `node --test tests/editor-view.test.js`
Expected: FAIL.

- [ ] **Step 3: Implement the state and the model.** In the initial `state`,
  after `draftFocusId: null,`:

```js
    // #58: the draft open in the Drafts editor. Typing updates text and the
    // selection here without a redraw (onInput), the way drawerEdit does.
    editor: {
      key: null, lang: 'md', text: '', selStart: 0, selEnd: 0, mode: 'source', previewTheme: null,
      picker: null, confirmText: null, moreOpen: false, emojiTab: 'torn', name: '', imageCheck: null,
      pickerWarn: null, dirty: false, showImages: false, fields: {},
    },
```

After `renderDraftsView` (runtime section), add the helpers:

```js
  function editorKeyFor(model) {
    if (model.draftFocusId) return String(model.draftFocusId);
    return model.route && model.route.isThread ? String(model.route.threadId) : null;
  }

  // Points the editor at a draft. A saved draft brings its own language; a new
  // one opens in the Default editor mode (Settings).
  function loadEditor(key, now) {
    var d = key ? draftFor(state.drafts, key) : null;
    var lang = d ? draftLangOf(d) : (DRAFT_LANGS.indexOf(state.settings.draftLang) !== -1 ? state.settings.draftLang : 'md');
    var text = d ? d.text : '';
    state.editor = {
      key: key, lang: lang, text: text, selStart: text.length, selEnd: text.length, mode: 'source',
      previewTheme: null, picker: null, confirmText: null, moreOpen: false, emojiTab: 'torn',
      name: d && d.name ? d.name : '', imageCheck: null, pickerWarn: null, dirty: false, showImages: false,
      fields: {},
    };
    void now;
  }

  function editorPostHtml() { return postHtml(state.editor.text, state.editor.lang); }

  // Saves the open draft. A blank thread draft is deleted, as before; a free
  // draft keeps its name even when empty.
  function saveEditor(now) {
    var e = state.editor;
    if (!e.key) return;
    if (/^n[0-9]+$/.test(e.key)) state.drafts = saveFreeDraft(state.drafts, e.key, e.text, now, e.name, e.lang);
    else state.drafts = saveDraft(state.drafts, e.key, e.text, now, '', e.lang);
    e.dirty = false;
    persist('drafts');
  }

  // Spec section 4a: nothing is ever silently cut. An action whose result
  // would pass the draft limit is refused with this.
  function overLimitNotice(n) {
    notice('That would make this draft ' + n + ' characters, over the ' + DRAFT_MAX_CHARS
      + ' limit. Shorten it, or keep it as it is.', 'warn');
  }
```

In `buildPanelModel`, before `return`, make sure the editor follows the
current key, then pass a copy:

```js
    var edKey = editorKeyFor({ draftFocusId: state.draftFocusId, route: state.route });
    if (edKey !== state.editor.key) {
      // Spec 4a: switching drafts or threads never discards typed text.
      if (state.editor.dirty && state.editor.key) saveEditor(now);
      loadEditor(edKey, now);
    }
```

Put that block where `now` is in scope, at the start of `buildPanelModel`. Then
add to the returned model:

```js
      editor: Object.assign({}, state.editor),
      themeResolved: state.themeResolved || null,
```

`state.themeResolved` does not exist yet. Set it in `applyThemeClass`, right
after `var theme = resolveTheme(...)`:

```js
      state.themeResolved = theme;
```

Add `themeResolved: null,` to the initial state.

- [ ] **Step 4: Implement the view.** Replace `renderDraftsView` with the
  following. Keep `btn`, `escapeHtml`, `threadLinkAttr` and
  `formatRelativeTime`, which already exist.

```js
  var EDITOR_MODES = Object.freeze([['text', 'Text'], ['md', 'MD'], ['html', 'HTML'], ['preview', 'Preview']]);

  function renderModePill(e) {
    var out = ['<div class="tfcc-pill" role="group" aria-label="Editor mode">'];
    for (var i = 0; i < EDITOR_MODES.length; i += 1) {
      var m = EDITOR_MODES[i][0];
      var on = m === 'preview' ? e.mode === 'preview' : e.mode === 'source' && e.lang === m;
      out.push('<button type="button" data-act="ed-mode" data-mode="' + m + '" aria-pressed="' + (on ? 'true' : 'false')
        + '">' + EDITOR_MODES[i][1] + '</button>');
    }
    out.push('</div>');
    return out.join('');
  }

  function renderPreview(model) {
    var e = model.editor;
    var theme = e.previewTheme || model.themeResolved || 'dark';
    var blocks = previewModel(e.lang, e.text);
    var hasExternal = blocks.some(function (b) { return /<img src="https:/.test(b.html); });
    var out = ['<div class="tfcc-pvbar">'];
    out.push('<span class="tfcc-note">Preview as Torn shows it.</span>');
    if (hasExternal && !e.showImages) out.push(btn('ed-pv-images', 'Show images'));
    for (var t = 0; t < 2; t += 1) {
      var th = t ? 'dark' : 'light';
      out.push('<button type="button" data-act="ed-pv-theme" data-theme="' + th + '" aria-pressed="'
        + (theme === th ? 'true' : 'false') + '">' + (t ? 'Dark' : 'Light') + '</button>');
    }
    out.push('</div><div class="tfcc-pv tfcc-pv-' + theme + '">');
    if (!blocks.length) out.push('<p class="tfcc-note">Nothing to preview yet.</p>');
    for (var i = 0; i < blocks.length; i += 1) {
      // blocks[i].html is cleanTornHtml output: the allowlist is what makes
      // rendering player-typed HTML inside the panel safe (spec section 5).
      out.push('<div class="tfcc-pv-block" data-act="ed-jump" data-offset="' + blocks[i].offset
        + '" title="Tap to edit here">' + previewImages(blocks[i].html, e.showImages) + '</div>');
    }
    out.push('</div>');
    return out.join('');
  }

  function renderEditorPane(model) {
    var e = model.editor;
    var key = e.key;
    var out = ['<div class="tfcc-section tfcc-editor">'];
    var isFree = /^n[0-9]+$/.test(key);
    if (isFree) {
      out.push('<label class="tfcc-note" for="tfcc-ed-name">Draft name</label>'
        + '<input id="tfcc-ed-name" type="text" maxlength="80" data-act="ed-name" data-id="' + escapeHtml(key)
        + '" value="' + escapeHtml(e.name) + '">');
    } else {
      out.push('<h4>Draft for this thread</h4>');
    }
    out.push(renderModePill(e));
    if (e.confirmText) {
      out.push('<div class="tfcc-confirm" role="alert"><p class="tfcc-note">Plain text drops the formatting. Switch anyway?</p>'
        + btn('ed-mode-confirm', 'Switch') + btn('ed-mode-cancel', 'Cancel') + '</div>');
    }
    out.push(renderEditorToolbar(model));
    if (e.mode === 'preview') {
      out.push(renderPreview(model));
    } else {
      out.push('<textarea class="tfcc-draft" data-act="draft-text" data-id="' + escapeHtml(key)
        + '" maxlength="' + DRAFT_MAX_CHARS + '" aria-label="Draft text">' + escapeHtml(e.text) + '</textarea>');
    }
    out.push('<div class="tfcc-actions">');
    out.push(btn('draft-save', 'Save draft', ' data-id="' + escapeHtml(key) + '"'));
    out.push(model.replyBoxFound
      ? btn('draft-insert', 'Insert into reply box', ' data-id="' + escapeHtml(key) + '"')
      : btn('draft-copy', 'Copy', ' data-id="' + escapeHtml(key) + '"'));
    out.push(btn('draft-delete', 'Delete', ' data-id="' + escapeHtml(key) + '"'));
    out.push('</div>');
    if (!model.replyBoxFound) out.push('<p class="tfcc-note">No reply box here, so Copy replaces Insert.</p>');
    out.push('</div>');
    return out.join('');
  }

  function renderDraftList(model) {
    var out = ['<div class="tfcc-section"><h4>All drafts (' + model.drafts.length + ')</h4>'];
    out.push('<div class="tfcc-actions">' + btn('draft-new', '+ New draft') + '</div>');
    if (!model.drafts.length) out.push('<div class="tfcc-empty">No saved drafts.</div>');
    for (var i = 0; i < model.drafts.length; i += 1) {
      var dr = model.drafts[i];
      var free = dr.kind === 'free';
      out.push('<div class="tfcc-hit' + (free ? ' tfcc-free' : '') + '"><div>');
      if (free) {
        out.push('<strong>' + escapeHtml(dr.title) + '</strong> <span class="tfcc-note">(free)</span> ');
      } else {
        out.push('<a href="https://www.torn.com/forums.php#/p=threads&t=' + escapeHtml(dr.threadId) + '&b=0&a=0"'
          + threadLinkAttr(dr.threadId) + '>' + escapeHtml(dr.title || ('Thread ' + dr.threadId)) + '</a> ');
      }
      out.push('<span class="tfcc-note">' + escapeHtml(formatRelativeTime(dr.updatedAt, model.now)) + '</span></div>');
      out.push('<div class="tfcc-hit-text">' + escapeHtml(dr.text.slice(0, 300)) + '</div>');
      out.push('<div class="tfcc-actions">'
        + btn('draft-edit', 'Edit', ' data-id="' + escapeHtml(dr.key) + '"')
        + btn('draft-copy', 'Copy', ' data-id="' + escapeHtml(dr.key) + '"')
        + btn('draft-delete', 'Delete', ' data-id="' + escapeHtml(dr.key) + '"')
        + '</div></div>');
    }
    out.push('</div>');
    return out.join('');
  }

  function renderDraftsView(model) {
    var out = [];
    if (model.editor && model.editor.key) out.push(renderEditorPane(model));
    else out.push('<p class="tfcc-note">Open a thread to write a draft for it, or start a new draft below.</p>');
    out.push(renderDraftList(model));
    return out.join('');
  }
```

Add the engine function `previewImages` to the Preview section of the engine
(after `previewModel`), with its test in `tests/editor-convert.test.js`:

```js
  // Spec 4a: Preview loads no external image until the player asks. Torn's
  // own emoji are same-site and always show. Input is cleaned HTML, whose img
  // tags are always exactly <img src="..."> or <img src="..." alt="...">.
  function previewImages(html, show) {
    return String(html).replace(/<img src="(https:[^"]*)"( alt="[^"]*")?>/g, function (all, src, alt) {
      if (show) return '<img referrerpolicy="no-referrer" src="' + src + '"' + (alt || '') + '>';
      var host = (/^https:\/\/([^\/?#"]+)/.exec(src) || [])[1] || 'another site';
      return '<span class="tfcc-img-ph">[image from ' + host + ']</span>';
    });
  }
```

```js
test('previewImages holds external images back and never touches Torn emoji', () => {
  const h = '<p><img src="https://i.imgur.com/x.png" alt="a"> <img src="/images/emotions/svg/grin.svg"></p>';
  assert.strictEqual(api.previewImages(h, false),
    '<p><span class="tfcc-img-ph">[image from i.imgur.com]</span> <img src="/images/emotions/svg/grin.svg"></p>');
  assert.strictEqual(api.previewImages(h, true),
    '<p><img referrerpolicy="no-referrer" src="https://i.imgur.com/x.png" alt="a"> <img src="/images/emotions/svg/grin.svg"></p>');
});
```

Task 11 defines `renderEditorToolbar`. Add this temporary stub now, and replace
it in Task 11:

```js
  function renderEditorToolbar(model) { void model; return ''; }
```

- [ ] **Step 5: Add the CSS.** Find the panel CSS array: grep for
  `'#' + PANEL_ID + ' .tfcc-draft`, or for `tfcc-hit-text`. Append these lines
  where the drafts rules sit. `TORN_COLORS` is in the engine, and the CSS
  builder runs at runtime, so build the variable lines from it:

```js
      '#' + PANEL_ID + ' .tfcc-pill { display: flex; gap: 0; margin-bottom: var(--tfcc-gap-sm); }',
      '#' + PANEL_ID + ' .tfcc-pill button { flex: 1 1 0; min-height: 32px; border-radius: 0; }',
      '#' + PANEL_ID + ' .tfcc-pill button[aria-pressed="true"] { background: var(--tm-accent-bg); color: var(--tm-accent-text); }',
      '#' + PANEL_ID + ' .tfcc-pvbar { display: flex; align-items: center; gap: var(--tfcc-gap-sm); margin-bottom: var(--tfcc-gap-sm); }',
      '#' + PANEL_ID + ' .tfcc-pv { border: 1px solid var(--tm-border); border-radius: 4px; padding: 8px; overflow-x: auto; }',
      '#' + PANEL_ID + ' .tfcc-pv-light { background: #ffffff; color: #333333; ' + teVars('light') + ' }',
      '#' + PANEL_ID + ' .tfcc-pv-dark { background: #111111; color: #dddddd; ' + teVars('dark') + ' }',
      '#' + PANEL_ID + ' .tfcc-pv-block { cursor: text; }',
      '#' + PANEL_ID + ' .tfcc-pv p { margin: 0; }',
      '#' + PANEL_ID + ' .tfcc-pv img { max-width: 100%; }',
      '#' + PANEL_ID + ' .tfcc-pv table { border-collapse: collapse; }',
      '#' + PANEL_ID + ' .tfcc-pv th, #' + PANEL_ID + ' .tfcc-pv td { border: 1px solid currentColor; padding: 2px 6px; }',
      '#' + PANEL_ID + ' .tfcc-pv blockquote { margin: 0 0 0 8px; padding-left: 8px; border-left: 3px solid currentColor; }',
      '#' + PANEL_ID + ' .tfcc-confirm { margin-bottom: var(--tfcc-gap-sm); }',
```

Use the token names the stylesheet already defines. Grep the CSS array for
`--tm-accent-bg`, `--tm-border` and `--tfcc-gap-sm`, and if any differs,
substitute the existing token. Do not invent new tokens. Add the helper beside
the CSS builder (runtime):

```js
  // The 17 Torn text colours for a Preview theme, as one declaration list, so
  // a cleaned post's var(--te-text-color-*) resolves inside the panel.
  function teVars(theme) {
    return TORN_COLORS.map(function (c) { return '--te-text-color-' + c.name + ': ' + c[theme] + ';'; }).join(' ');
  }
```

- [ ] **Step 6: Implement the handlers.** In `makeHandlers`' click chain,
  replace the `draft-save`, `draft-delete`, `draft-copy` and `draft-insert`
  cases, and the existing `draft` case that sets `state.draftFocusId` (keep it
  as it is), with:

```js
        if (act === 'ed-mode') {
          var mode = el.getAttribute('data-mode');
          var ed = state.editor;
          if (mode === 'preview') { ed.mode = 'preview'; ed.picker = null; redraw(); return; }
          if (DRAFT_LANGS.indexOf(mode) === -1) return;
          if (mode === ed.lang) { ed.mode = 'source'; redraw(); return; }
          if (mode === 'text' && ed.lang !== 'text' && ed.text.trim()) { ed.confirmText = ed.lang; redraw(); return; }
          var converted = convertDraft(ed.text, ed.lang, mode);
          if (converted.length > DRAFT_MAX_CHARS) { overLimitNotice(converted.length); redraw(); return; }
          ed.text = converted;
          ed.lang = mode; ed.mode = 'source'; ed.selStart = ed.selEnd = ed.text.length;
          if (ed.text.trim()) saveEditor(now);
          redraw(); return;
        }
        if (act === 'ed-pv-images') { state.editor.showImages = true; redraw(); return; }
        if (act === 'ed-mode-confirm') {
          var ec = state.editor;
          ec.text = convertDraft(ec.text, ec.lang, 'text');
          ec.lang = 'text'; ec.mode = 'source'; ec.confirmText = null; ec.selStart = ec.selEnd = ec.text.length;
          if (ec.text.trim()) saveEditor(now);
          redraw(); return;
        }
        if (act === 'ed-mode-cancel') { state.editor.confirmText = null; redraw(); return; }
        if (act === 'ed-pv-theme') { state.editor.previewTheme = el.getAttribute('data-theme') === 'light' ? 'light' : 'dark'; redraw(); return; }
        if (act === 'ed-jump') {
          var off = Math.max(0, Math.min(state.editor.text.length, toInt(el.getAttribute('data-offset'), 0)));
          state.editor.mode = 'source'; state.editor.selStart = state.editor.selEnd = off;
          state.focusIntent = ['textarea[data-act="draft-text"]'];
          redraw(); return;
        }
        if (act === 'draft-new') {
          var made = newFreeDraft(state.drafts, now, state.settings.draftLang);
          if (!made.id) { notice('You have ' + FREE_DRAFTS_MAX + ' free drafts. Delete one to make another.', 'warn'); redraw(); return; }
          state.drafts = made.drafts; persist('drafts');
          state.draftFocusId = made.id;
          redraw(); return;
        }
        if (act === 'draft-edit' && id) { state.draftFocusId = id; state.settings.view = 'drafts'; redraw(); return; }
        if (act === 'draft-save' && id) {
          if (state.editor.key === id) saveEditor(now);
          recompute(now); notice('Draft saved.', 'info'); redraw(); return;
        }
        if (act === 'draft-delete' && id) {
          if (/^n[0-9]+$/.test(id)) state.drafts = deleteFreeDraft(state.drafts, id);
          else state.drafts = deleteDraft(state.drafts, id);
          if (state.editor.key === id) { state.editor.key = null; if (state.draftFocusId === id) state.draftFocusId = null; }
          persist('drafts'); recompute(now); redraw(); return;
        }
        if (act === 'draft-copy' && id) {
          var cd = state.editor.key === id ? null : draftFor(state.drafts, id);
          copyPost(doc, win, cd ? postHtml(cd.text, draftLangOf(cd)) : editorPostHtml(), function (r) {
            notice(r.ok ? 'Post copied. Paste it into Torn\'s reply box.' : 'Copy failed. Switch to HTML, select the text and copy it yourself.', r.ok ? 'info' : 'warn');
            redraw();
          });
          return;
        }
        if (act === 'draft-insert' && id) {
          if (state.editor.key === id && state.editor.text.trim()) saveEditor(now);
          var ins = insertPost(doc, win, editorPostHtml());
          notice(ins.ok ? 'Post inserted. Check it, then press Post.' : (ins.detail || 'Could not insert.'), ins.ok ? 'info' : 'warn');
          redraw(); return;
        }
```

Check whether `state.focusIntent` exists, and what shape it takes. Grep
`focusIntent`, and use the existing plan format (an array of selectors in the
plan grammar) if it differs.

In `onInput`, before the `note-input`/`tag-input` filter, add:

```js
        if (act === 'draft-text') {
          var nn = function (v) { return typeof v === 'number' && isFinite(v) ? v : 0; };
          state.editor.text = el && el.value !== undefined ? String(el.value).slice(0, DRAFT_MAX_CHARS) : '';
          state.editor.selStart = nn(el && el.selectionStart);
          state.editor.selEnd = nn(el && el.selectionEnd);
          state.editor.dirty = true;
          return;
        }
        if (act === 'ed-name') {
          state.editor.name = el && el.value !== undefined ? String(el.value).slice(0, FREE_NAME_MAX) : '';
          state.editor.dirty = true;
          return;
        }
```

In `restoreSelection`, before the `drawerEdit` logic, add:

```js
    if (typeof el.getAttribute === 'function' && el.getAttribute('data-act') === 'draft-text'
      && typeof el.setSelectionRange === 'function') {
      try { el.setSelectionRange(state.editor.selStart, state.editor.selEnd); } catch (e) { /* not a text field */ }
      return;
    }
```

`restoreSelection` returns early when `state.drawerEdit` is null. Move the new
block above that early return.

In `tests/handlers.test.js`, add `'ed-name'` to `dataOnly`. In
`renderedActions`, before the narrow loop, add:

```js
  api.state.drafts = api.newFreeDraft(api.state.drafts, NOW, 'md').drafts;
```

Inside the view loop, when `view === 'drafts'`, render the editor in three
states, so `ed-mode-confirm`, `ed-mode-cancel`, `ed-pv-theme` and `ed-jump`
all render:
- source;
- `confirmText: 'md'`;
- preview with text.

```js
        if (view === 'drafts') {
          api.state.editor.text = '# T\n![a](https://i.imgur.com/x.png)'; // an external image, so Show images renders
          for (const patch of [{ mode: 'source' }, { confirmText: 'md' }, { mode: 'preview', confirmText: null }]) {
            Object.assign(api.state.editor, patch);
            const hh = api.panelHtml(api.buildPanelModel(NOW));
            let mm;
            const rr = /data-act="([a-z-]+)"/g;
            while ((mm = rr.exec(hh))) actions.add(mm[1]);
          }
          Object.assign(api.state.editor, { mode: 'source' });
        }
```

Add the following to `EXPORT_NAMES`:

```js
  'editorKeyFor', 'loadEditor', 'editorPostHtml', 'saveEditor', 'overLimitNotice', 'previewImages',
  'renderEditorPane', 'renderDraftList', 'renderModePill', 'renderPreview', 'teVars', 'EDITOR_MODES',
  'buildPanelModel',
```

Skip `buildPanelModel` if it is already listed. `tests/handlers.test.js`
already calls it, so check first.

- [ ] **Step 7: Run the tests**

Run: `node --test tests/editor-view.test.js tests/editor-convert.test.js tests/handlers.test.js tests/drafts.test.js`
Expected: PASS.

`tests/wide-parity.test.js` now FAILS on the drafts view. Task 13 records the
approved diff, so do not touch the golden.

- [ ] **Step 8: Commit**

The suite is red only on wide parity, which Task 13 fixes. Say so in the commit
message:

```bash
git add torn-forum-command-center.user.js tests/editor-view.test.js tests/handlers.test.js
git commit -m "feat: Drafts editor with Text/MD/HTML/Preview modes and free drafts (#58)

Wide parity is updated in the next task's wide-58 list."
```

---

### Task 11: Toolbar, pickers and the image fixer UI

**Files:**
- Modify: `torn-forum-command-center.user.js`: `renderEditorToolbar` (which
  replaces the stub), the pickers, the CSS, and the handlers
- Modify: `tests/editor-view.test.js` (append) and `tests/handlers.test.js`
  (`dataOnly`, picker states)

**Interfaces:**
- Consumes: `applyMark`, `applyBlockMark`, `insertBlock`, `tableSkeleton`,
  `emojiSnippet`, `imageSnippet`, `fixImageUrl`, `fixAllImages`,
  `colorWarnings`, `UNICODE_EMOJI`, `TORN_COLORS`, `TORN_EMOJI` and
  `SIZE_PICKS`.
- Produces these `data-act` values:
  - `ed-mark` (`data-mark`);
  - `ed-picker` (`data-picker` is `color`, `size`, `align`, `link`, `image`,
    `table`, `emoji` or `help`);
  - `ed-picker-close`;
  - `ed-color`, `ed-size` and `ed-align` (each with `data-value`);
  - `ed-quote`, `ed-link-apply`, `ed-img-check`, `ed-img-insert`,
    `ed-table-insert`;
  - `ed-emoji` (`data-value`), `ed-emoji-tab` (`data-tab`);
  - `ed-fix-images` and `ed-more`.
- Data only: `ed-hex-input`, `ed-link-input`, `ed-img-url`, `ed-img-alt`,
  `ed-cols`, `ed-rows` and `ed-header`.

- [ ] **Step 1: Write the failing tests** (append to `tests/editor-view.test.js`)

```js
function editorAt(text, lang, sel) {
  const env = loadUserscript({ location: THREAD, now: NOW });
  const api = drafts(env);
  api.state.settings.draftLang = lang;
  api.panelHtml(api.buildPanelModel(NOW));
  // No panel is mounted in the harness, so captureSelection finds no field and
  // keeps the selection the editor state already holds: the one set here.
  Object.assign(api.state.editor, { text, selStart: sel[0], selEnd: sel[1] });
  return { env, api, h: api.makeHandlers(env.doc, env.win) };
}

test('Bold wraps the selection in the draft\'s language', () => {
  const { api, h } = editorAt('hello world', 'md', [6, 11]);
  h.onAction('ed-mark', el({ 'data-act': 'ed-mark', 'data-mark': 'bold' }));
  assert.strictEqual(api.state.editor.text, 'hello **world**');
});

test('a colour from the picker wraps the selection it was opened on', () => {
  const { api, h } = editorAt('hi there', 'html', [3, 8]);
  h.onAction('ed-picker', el({ 'data-act': 'ed-picker', 'data-picker': 'color' }));
  h.onAction('ed-color', el({ 'data-act': 'ed-color', 'data-value': 'red' }));
  assert.strictEqual(api.state.editor.text, 'hi <span style="color: var(--te-text-color-red);">there</span>');
  assert.strictEqual(api.state.editor.picker, null);
});

// A picker field typed into: the panel's input event, as the browser sends it.
const typeInto = (h, act, value) => h.onInput(act, Object.assign(el({ 'data-act': act }), { value }));

test('a hard-to-read custom colour asks once, keeps the typed hex across the redraw, then applies', () => {
  const { api, h } = editorAt('x', 'md', [0, 1]);
  h.onAction('ed-picker', el({ 'data-act': 'ed-picker', 'data-picker': 'color' }));
  typeInto(h, 'ed-hex-input', '#ffd43b');
  h.onAction('ed-color', el({ 'data-act': 'ed-color', 'data-value': 'custom' }));
  const html = api.panelHtml(api.buildPanelModel(NOW));
  assert.match(html, /hard to read on Torn&#39;s light theme|hard to read on Torn's light theme/);
  assert.match(html, /data-act="ed-hex-input"[^>]*value="#ffd43b"/, 'the redraw keeps what was typed');
  assert.strictEqual(api.state.editor.text, 'x');
  h.onAction('ed-color', el({ 'data-act': 'ed-color', 'data-value': 'custom' }));
  assert.strictEqual(api.state.editor.text, '{#ffd43b}x{/}');
});

test('picker fields are read from the editor state, never from the page', () => {
  const { env, api, h } = editorAt('x', 'md', [0, 1]);
  // Torn's page (or another script) holding an element with the same data-act
  // must not be read.
  env.doc.querySelector = (s) => (s === '[data-act="ed-link-input"]' ? { value: 'https://evil.example/' } : null);
  h.onAction('ed-picker', el({ 'data-act': 'ed-picker', 'data-picker': 'link' }));
  typeInto(h, 'ed-link-input', 'https://a.b');
  h.onAction('ed-link-apply', el({ 'data-act': 'ed-link-apply' }));
  assert.strictEqual(api.state.editor.text, '[x](https://a.b)');
});

test('a toolbar edit that would pass the draft limit is refused', () => {
  const { api, h } = editorAt('y'.repeat(19995), 'md', [0, 19995]);
  h.onAction('ed-mark', el({ 'data-act': 'ed-mark', 'data-mark': 'bold' }));
  h.onAction('ed-mark', el({ 'data-act': 'ed-mark', 'data-mark': 'bold' }));
  h.onAction('ed-mark', el({ 'data-act': 'ed-mark', 'data-mark': 'bold' }));
  assert.ok(api.state.editor.text.length <= api.DRAFT_MAX_CHARS);
  assert.ok(api.state.notices.some((n) => /over the 20000 limit/.test(n.text)));
});

test('the image picker fixes a Drive link and inserts it; a page link shows how to fix it', () => {
  const { api, h } = editorAt('', 'md', [0, 0]);
  h.onAction('ed-picker', el({ 'data-act': 'ed-picker', 'data-picker': 'image' }));
  typeInto(h, 'ed-img-url', 'https://drive.google.com/file/d/1GfhII9A5yDKVLFVv0F1SEPivpxvREb-h/view?usp=sharing');
  typeInto(h, 'ed-img-alt', 'pic');
  h.onAction('ed-img-check', el({ 'data-act': 'ed-img-check' }));
  const html = api.panelHtml(api.buildPanelModel(NOW));
  assert.match(html, /thumbnail\?id=1GfhII9A5yDKVLFVv0F1SEPivpxvREb-h&amp;sz=w1000/);
  assert.match(html, /Anyone with the link/);
  h.onAction('ed-img-insert', el({ 'data-act': 'ed-img-insert' }));
  assert.strictEqual(api.state.editor.text, '![pic](https://drive.google.com/thumbnail?id=1GfhII9A5yDKVLFVv0F1SEPivpxvREb-h&sz=w1000)');
  h.onAction('ed-picker', el({ 'data-act': 'ed-picker', 'data-picker': 'image' }));
  typeInto(h, 'ed-img-url', 'https://ibb.co/8P0808s');
  h.onAction('ed-img-check', el({ 'data-act': 'ed-img-check' }));
  const html2 = api.panelHtml(api.buildPanelModel(NOW));
  assert.match(html2, /Direct link/);
  assert.doesNotMatch(html2, /data-act="ed-img-insert"/);
  assert.match(html2, /Insert Image button/);
});

test('emoji: a Torn emoji inserts its shortcode; the tip names the system picker', () => {
  const { api, h } = editorAt('a', 'md', [1, 1]);
  h.onAction('ed-picker', el({ 'data-act': 'ed-picker', 'data-picker': 'emoji' }));
  const html = api.panelHtml(api.buildPanelModel(NOW));
  assert.match(html, /src="\/images\/emotions\/svg\/grin.svg"/);
  assert.match(html, /Win \+ \./);
  h.onAction('ed-emoji', el({ 'data-act': 'ed-emoji', 'data-value': 'grin' }));
  assert.strictEqual(api.state.editor.text, 'a:grin:');
});

test('Fix image link rewrites the whole draft and says how many', () => {
  const { api, h } = editorAt('![a](https://imgur.com/AbC12dE)', 'md', [0, 0]);
  h.onAction('ed-fix-images', el({ 'data-act': 'ed-fix-images' }));
  assert.strictEqual(api.state.editor.text, '![a](https://i.imgur.com/AbC12dE.png)');
  assert.ok(api.state.notices.some((n) => /1 image link/.test(n.text)));
});

test('narrow shows five tools and More; the rest are in the drawer', () => {
  const { env, api } = editorAt('', 'md', [0, 0]);
  void env;
  api.state.narrow = true;
  let html = api.panelHtml(api.buildPanelModel(NOW));
  assert.match(html, /data-act="ed-more"/);
  assert.doesNotMatch(html, /data-mark="strike"/);
  api.state.editor.moreOpen = true;
  html = api.panelHtml(api.buildPanelModel(NOW));
  assert.match(html, /data-mark="strike"/);
});
```

- [ ] **Step 2: Run them and watch them fail**

- [ ] **Step 3: Implement the toolbar and pickers.** Replace the stub
  `renderEditorToolbar`:

```js
  // Toolbar items: [act, data, label, aria label, primary-when-narrow].
  var EDITOR_TOOLS = Object.freeze([
    ['ed-mark', 'data-mark="bold"', 'B', 'Bold', true],
    ['ed-mark', 'data-mark="italic"', 'I', 'Italic', true],
    ['ed-mark', 'data-mark="underline"', 'U', 'Underline', true],
    ['ed-picker', 'data-picker="color"', 'Colour', 'Text colour', true],
    ['ed-picker', 'data-picker="link"', 'Link', 'Insert link', true],
    ['ed-mark', 'data-mark="strike"', 'S', 'Strike through', false],
    ['ed-picker', 'data-picker="size"', 'Size', 'Text size', false],
    ['ed-picker', 'data-picker="align"', 'Align', 'Alignment', false],
    ['ed-quote', '', 'Quote', 'Quote', false],
    ['ed-picker', 'data-picker="image"', 'Image', 'Insert image', false],
    ['ed-picker', 'data-picker="table"', 'Table', 'Insert table', false],
    ['ed-picker', 'data-picker="emoji"', 'Emoji', 'Insert emoji', false],
    ['ed-fix-images', '', 'Fix image links', 'Fix image links in this draft', false],
    ['ed-picker', 'data-picker="help"', '?', 'Markdown marks', false],
  ]);

  function toolButton(t, disabled) {
    return '<button type="button" data-act="' + t[0] + '"' + (t[1] ? ' ' + t[1] : '') + ' aria-label="' + escapeHtml(t[3])
      + '" title="' + escapeHtml(t[3]) + '"' + (disabled ? ' disabled' : '') + '>' + escapeHtml(t[2]) + '</button>';
  }

  function renderEditorToolbar(model) {
    var e = model.editor;
    if (e.lang === 'text' && e.mode === 'source') return '';
    var disabled = e.mode === 'preview';
    var out = ['<div class="tfcc-tools" role="toolbar" aria-label="Formatting">'];
    for (var i = 0; i < EDITOR_TOOLS.length; i += 1) {
      var t = EDITOR_TOOLS[i];
      if (model.narrow && !t[4]) continue;
      if (t[2] === '?' && e.lang !== 'md') continue;
      out.push(toolButton(t, disabled));
    }
    if (model.narrow) {
      out.push('<button type="button" data-act="ed-more" aria-expanded="' + (e.moreOpen ? 'true' : 'false')
        + '"' + (disabled ? ' disabled' : '') + '>More</button>');
    }
    out.push('</div>');
    if (model.narrow && e.moreOpen && !disabled) {
      out.push('<div class="tfcc-tools tfcc-tools-more">');
      for (var k = 0; k < EDITOR_TOOLS.length; k += 1) {
        if (!EDITOR_TOOLS[k][4] && !(EDITOR_TOOLS[k][2] === '?' && e.lang !== 'md')) out.push(toolButton(EDITOR_TOOLS[k], false));
      }
      out.push('</div>');
    }
    if (e.picker && !disabled) out.push(renderPicker(model));
    return out.join('');
  }

  var MD_HELP = Object.freeze([
    ['**bold**', 'bold'], ['*italic*', 'italic'], ['++underline++', 'underline'], ['~~strike~~', 'strike through'],
    ['{red}text{/}', 'a Torn colour (red, pink, grape, violet, indigo, blue, cyan, teal, green, lime, yellow, orange, gray1 to gray5)'],
    ['{#ff8800}text{/}', 'any colour'], ['{18}text{/}', 'text size, 8 to 36'], ['# Title', 'a big bold line (## and ### are smaller)'],
    [':::center', 'centre the lines up to the next :::'], ['> text', 'a quote'], ['- item', 'a list (1. for numbers)'],
    // No literal URLs here: read-only.test.js audits every http(s) host in the source.
    ['[text](link address)', 'a link (https only)'], ['![description](image link)', 'an image'], [':grin:', 'a Torn emoji'],
    ['| a | b |', 'a table row; a --- row under the first makes it a header'], ['\\*', 'a literal mark character'],
  ]);

  function pickerClose() { return btn('ed-picker-close', 'Cancel'); }

  function renderPicker(model) {
    var e = model.editor;
    // Typed fields live in the editor state (onInput), so a redraw re-renders
    // what was typed instead of emptying it.
    var F = e.fields || {};
    var fv = function (k, d) { return escapeHtml(Object.prototype.hasOwnProperty.call(F, k) ? F[k] : d); };
    var out = ['<div class="tfcc-picker" role="group" aria-label="' + escapeHtml(e.picker) + '">'];
    if (e.picker === 'color') {
      var theme = model.themeResolved || 'dark';
      out.push('<div class="tfcc-swatches">');
      for (var i = 0; i < TORN_COLORS.length; i += 1) {
        var c = TORN_COLORS[i];
        out.push('<button type="button" data-act="ed-color" data-value="' + c.name + '" aria-label="' + c.name
          + (c.name === 'gray5' ? ', matches the page background' : '') + '" title="' + c.name + '">'
          + '<span class="tfcc-swatch" style="background: ' + c[theme] + ';" aria-hidden="true"></span></button>');
      }
      out.push('</div><label for="tfcc-ed-hex" class="tfcc-note">Custom colour</label>'
        + '<input id="tfcc-ed-hex" type="text" data-act="ed-hex-input" placeholder="#ff8800" maxlength="7" value="' + fv('ed-hex-input', '') + '">'
        + btn('ed-color', 'Use custom colour', ' data-value="custom"'));
      if (e.pickerWarn) {
        out.push('<p class="tfcc-note" role="alert">' + escapeHtml(e.pickerWarn) + ' Tap Use custom colour again to use it anyway.</p>');
      }
    } else if (e.picker === 'size') {
      for (var s = 0; s < SIZE_PICKS.length; s += 1) out.push(btn('ed-size', SIZE_PICKS[s] + 'px', ' data-value="' + SIZE_PICKS[s] + '"'));
    } else if (e.picker === 'align') {
      ['left', 'center', 'right', 'justify'].forEach(function (a) { out.push(btn('ed-align', a.charAt(0).toUpperCase() + a.slice(1), ' data-value="' + a + '"')); });
    } else if (e.picker === 'link') {
      out.push('<label for="tfcc-ed-link" class="tfcc-note">Link address (https)</label>'
        + '<input id="tfcc-ed-link" type="url" data-act="ed-link-input" value="' + fv('ed-link-input', '') + '">' + btn('ed-link-apply', 'Add link'));
    } else if (e.picker === 'image') {
      out.push('<label for="tfcc-ed-img" class="tfcc-note">Image link</label>'
        + '<input id="tfcc-ed-img" type="url" data-act="ed-img-url" value="' + fv('ed-img-url', '') + '">'
        + '<label for="tfcc-ed-alt" class="tfcc-note">Description (optional)</label>'
        + '<input id="tfcc-ed-alt" type="text" data-act="ed-img-alt" maxlength="200" value="' + fv('ed-img-alt', '') + '">'
        + btn('ed-img-check', 'Check link'));
      var r = e.imageCheck;
      if (r) {
        if (r.status === 'fixed') out.push('<p class="tfcc-note">Fixed for Torn: <code>' + escapeHtml(r.url) + '</code></p>');
        if (r.note) out.push('<p class="tfcc-note">' + escapeHtml(r.note) + '</p>');
        if (r.status === 'ok' || r.status === 'fixed') {
          // Loaded because the player tapped Check link; no referrer (spec 4a).
          out.push('<img class="tfcc-img-check" referrerpolicy="no-referrer" src="' + escapeHtml(r.url) + '" alt="Preview of the image">'
            + btn('ed-img-insert', 'Insert image'));
        }
      }
      out.push('<p class="tfcc-note">Have the file, not a link? Upload it with Torn\'s own Insert Image button after Insert.</p>');
    } else if (e.picker === 'table') {
      out.push('<label for="tfcc-ed-cols" class="tfcc-note">Columns</label><input id="tfcc-ed-cols" type="number" min="1" max="8" value="' + fv('ed-cols', '2') + '" data-act="ed-cols">'
        + '<label for="tfcc-ed-rows" class="tfcc-note">Rows</label><input id="tfcc-ed-rows" type="number" min="1" max="30" value="' + fv('ed-rows', '2') + '" data-act="ed-rows">'
        + '<label for="tfcc-ed-head" class="tfcc-note">Header row</label><input id="tfcc-ed-head" type="checkbox"'
        + (F['ed-header'] === false ? '' : ' checked') + ' data-act="ed-header">'
        + btn('ed-table-insert', 'Insert table'));
    } else if (e.picker === 'emoji') {
      out.push('<div class="tfcc-pill" role="group" aria-label="Emoji set">'
        + '<button type="button" data-act="ed-emoji-tab" data-tab="torn" aria-pressed="' + (e.emojiTab !== 'unicode') + '">Torn</button>'
        + '<button type="button" data-act="ed-emoji-tab" data-tab="unicode" aria-pressed="' + (e.emojiTab === 'unicode') + '">Unicode</button></div>');
      out.push('<div class="tfcc-emoji">');
      if (e.emojiTab === 'unicode') {
        for (var u = 0; u < UNICODE_EMOJI.length; u += 1) {
          out.push('<button type="button" data-act="ed-emoji" data-value="u' + u + '" aria-label="Emoji ' + (u + 1) + '">' + UNICODE_EMOJI[u] + '</button>');
        }
      } else {
        for (var k = 0; k < TORN_EMOJI.length; k += 1) {
          var nm = TORN_EMOJI[k];
          out.push('<button type="button" data-act="ed-emoji" data-value="' + nm + '" aria-label="' + nm.replace(/_/g, ' ') + '" title="' + nm + '">'
            + '<img src="/images/emotions/svg/' + nm + '.svg" alt="" width="24" height="24"></button>');
        }
      }
      out.push('</div><p class="tfcc-note">More emoji: press Win + . (Windows) or Ctrl + Cmd + Space (Mac) while typing.</p>');
    } else if (e.picker === 'help') {
      out.push('<dl class="tfcc-help">');
      MD_HELP.forEach(function (h) { out.push('<dt><code>' + escapeHtml(h[0]) + '</code></dt><dd>' + escapeHtml(h[1]) + '</dd>'); });
      out.push('</dl>');
    }
    out.push('<div class="tfcc-actions">' + pickerClose() + '</div></div>');
    return out.join('');
  }
```

The Unicode buttons insert `UNICODE_EMOJI[u]` by index (`data-value="u<index>"`),
so no non-ASCII character ever enters the markup source.

Add the handlers, in the same click chain. `editorField()` reads the panel's
own textarea, never Torn's page:

```js
        // The panel's own draft textarea, for the selection at click time.
        function editorField() {
          var panel = doc.getElementById(PANEL_ID);
          try { return panel && typeof panel.querySelector === 'function' ? panel.querySelector('[data-act="draft-text"]') : null; } catch (e) { return null; }
        }
        function captureSelection() {
          var f = editorField();
          if (f && typeof f.selectionStart === 'number') {
            state.editor.text = String(f.value); state.editor.selStart = f.selectionStart; state.editor.selEnd = f.selectionEnd;
          }
        }
        // A picker's typed value, from the editor state (onInput), never from a
        // document query: Torn's page could hold the same data-act.
        function field(k, d) {
          var f = state.editor.fields || {};
          return Object.prototype.hasOwnProperty.call(f, k) ? f[k] : d;
        }
        function applyEdit(r) {
          // Spec 4a: never silently cut, never store past the limit.
          if (r.text.length > DRAFT_MAX_CHARS) { overLimitNotice(r.text.length); redraw(); return; }
          state.editor.text = r.text; state.editor.selStart = r.start; state.editor.selEnd = r.end;
          state.editor.picker = null; state.editor.pickerWarn = null; state.editor.imageCheck = null;
          state.focusIntent = ['textarea[data-act="draft-text"]'];
          if (state.editor.text.trim()) saveEditor(now);
          redraw();
        }
```

Define `editorField`, `captureSelection`, `field` and `applyEdit` once, inside
`makeHandlers`, next to `valueOf`. The editor's handlers never call `valueOf`.
Then add the cases:

```js
        var E = state.editor;
        if (act === 'ed-more') { E.moreOpen = !E.moreOpen; redraw(); return; }
        if (act === 'ed-mark') {
          captureSelection();
          applyEdit(applyMark(E.lang, E.text, E.selStart, E.selEnd, el.getAttribute('data-mark'))); return;
        }
        if (act === 'ed-quote') { captureSelection(); applyEdit(applyBlockMark(E.lang, E.text, E.selStart, E.selEnd, 'quote')); return; }
        if (act === 'ed-picker') {
          captureSelection();
          var which = el.getAttribute('data-picker');
          E.picker = E.picker === which ? null : which; E.pickerWarn = null; E.imageCheck = null;
          redraw(); return;
        }
        if (act === 'ed-picker-close') { E.picker = null; E.pickerWarn = null; E.imageCheck = null; redraw(); return; }
        if (act === 'ed-color') {
          var cv = el.getAttribute('data-value');
          if (cv === 'custom') {
            var hex = String(field('ed-hex-input', '')).trim().toLowerCase();
            if (!/^#([0-9a-f]{3}|[0-9a-f]{6})$/.test(hex)) { notice('Type a colour like #ff8800.', 'warn'); redraw(); return; }
            var warns = colorWarnings(hex);
            var warnText = warns.length ? 'This colour is hard to read on Torn\'s ' + warns.map(function (w) { return w.theme; }).join(' and ')
              + ' theme (contrast ' + warns.map(function (w) { return w.ratio; }).join(' and ') + ' to 1).' : '';
            if (warnText && E.pickerWarn !== warnText) { E.pickerWarn = warnText; redraw(); return; }
            applyEdit(applyMark(E.lang, E.text, E.selStart, E.selEnd, 'color', hex)); return;
          }
          if (TORN_COLOR_NAMES.indexOf(cv) === -1) return;
          applyEdit(applyMark(E.lang, E.text, E.selStart, E.selEnd, 'color', cv)); return;
        }
        if (act === 'ed-size') { applyEdit(applyMark(E.lang, E.text, E.selStart, E.selEnd, 'size', toInt(el.getAttribute('data-value'), 16))); return; }
        if (act === 'ed-align') {
          var av = el.getAttribute('data-value');
          if (['left', 'center', 'right', 'justify'].indexOf(av) === -1) return;
          applyEdit(applyBlockMark(E.lang, E.text, E.selStart, E.selEnd, 'align', av)); return;
        }
        if (act === 'ed-link-apply') {
          var href = safeHref(field('ed-link-input', ''));
          if (!href) { notice('Links must start with https:// or http://.', 'warn'); redraw(); return; }
          applyEdit(applyMark(E.lang, E.text, E.selStart, E.selEnd, 'link', href)); return;
        }
        if (act === 'ed-img-check') {
          E.imageCheck = fixImageUrl(field('ed-img-url', ''));
          redraw(); return;
        }
        if (act === 'ed-img-insert') {
          var ic = E.imageCheck;
          if (!ic || (ic.status !== 'ok' && ic.status !== 'fixed')) return;
          applyEdit(insertAtCaret(E.text, E.selStart, E.selEnd, imageSnippet(E.lang, ic.url, String(field('ed-img-alt', ''))))); return;
        }
        if (act === 'ed-table-insert') {
          var tbl = tableSkeleton(E.lang, toInt(field('ed-cols', 2), 2), toInt(field('ed-rows', 2), 2), field('ed-header', true) !== false);
          applyEdit(insertBlock(E.text, E.selStart, E.selEnd, tbl)); return;
        }
        if (act === 'ed-emoji-tab') { E.emojiTab = el.getAttribute('data-tab') === 'unicode' ? 'unicode' : 'torn'; redraw(); return; }
        if (act === 'ed-emoji') {
          var ev = el.getAttribute('data-value') || '';
          var snip = /^u[0-9]+$/.test(ev) ? (UNICODE_EMOJI[toInt(ev.slice(1), -1)] || '') : emojiSnippet(E.lang, ev);
          if (!snip) return;
          applyEdit(insertAtCaret(E.text, E.selStart, E.selEnd, snip)); return;
        }
        if (act === 'ed-fix-images') {
          captureSelection();
          var fx = fixAllImages(E.lang, E.text);
          if (fx.text.length > DRAFT_MAX_CHARS) { overLimitNotice(fx.text.length); redraw(); return; }
          E.text = fx.text;
          if (fx.changed && E.text.trim()) saveEditor(now);
          notice(fx.changed ? 'Fixed ' + fx.changed + ' image link' + (fx.changed === 1 ? '' : 's') + ' for Torn.' : 'No image links needed fixing.', 'info');
          redraw(); return;
        }
```

Add the engine helper `insertAtCaret` to the editor-operations section, with a
test in `tests/editor-ops.test.js`:

```js
  function insertAtCaret(text, start, end, snippet) {
    var t = String(text || '');
    var s = clampSel(t, start, end);
    var next = t.slice(0, s[0]) + snippet + t.slice(s[1]);
    var caret = s[0] + snippet.length;
    return { text: next, start: caret, end: caret };
  }
```

```js
test('insertAtCaret replaces the selection and puts the caret after', () => {
  assert.deepStrictEqual(api.insertAtCaret('ab', 1, 1, ':grin:'), { text: 'a:grin:b', start: 7, end: 7 });
});
```

Export `insertAtCaret`, `renderEditorToolbar`, `renderPicker` and
`EDITOR_TOOLS`.

Mirror the picker fields into the editor state as the player types. In
`onInput`, beside the `draft-text` case:

```js
        if (['ed-hex-input', 'ed-link-input', 'ed-img-url', 'ed-img-alt', 'ed-cols', 'ed-rows'].indexOf(act) !== -1) {
          state.editor.fields = Object.assign({}, state.editor.fields);
          state.editor.fields[act] = el && el.value !== undefined ? String(el.value).slice(0, URL_MAX_CHARS) : '';
          return;
        }
```

In the `onChange` chain, for the checkbox:

```js
        if (act === 'ed-header') {
          state.editor.fields = Object.assign({}, state.editor.fields, { 'ed-header': !!el.checked });
          return;
        }
```

`loadEditor` resets `fields` to `{}`. That is right: a new draft starts with an
empty picker.

CSS, appended next to Task 10's lines:

```js
      '#' + PANEL_ID + ' .tfcc-tools { display: flex; flex-wrap: wrap; gap: 4px; margin-bottom: var(--tfcc-gap-sm); }',
      '#' + PANEL_ID + ' .tfcc-tools button { min-width: 32px; min-height: 32px; }',
      '#' + PANEL_ID + ' .tfcc-picker { border: 1px solid var(--tm-border); border-radius: 4px; padding: 8px; margin-bottom: var(--tfcc-gap-sm); }',
      '#' + PANEL_ID + ' .tfcc-swatches, #' + PANEL_ID + ' .tfcc-emoji { display: flex; flex-wrap: wrap; gap: 4px; }',
      '#' + PANEL_ID + ' .tfcc-swatch { display: block; width: 20px; height: 20px; border-radius: 3px; border: 1px solid var(--tm-border); }',
      '#' + PANEL_ID + ' .tfcc-img-check { display: block; max-width: 100%; max-height: 160px; margin: 4px 0; }',
      '#' + PANEL_ID + ' .tfcc-help dt { margin-top: 4px; }',
      '#' + PANEL_ID + '.tfcc-narrow .tfcc-tools button, #' + PANEL_ID + '.tfcc-narrow .tfcc-pill button { min-width: 44px; min-height: 44px; }',
      '#' + PANEL_ID + '.tfcc-narrow .tfcc-tools { gap: 8px; }',
      '#' + PANEL_ID + '.tfcc-narrow .tfcc-draft, #' + PANEL_ID + '.tfcc-narrow .tfcc-picker input { font-size: 16px; }',
```

In `tests/handlers.test.js`:
- Add `'ed-hex-input', 'ed-link-input', 'ed-img-url', 'ed-img-alt', 'ed-cols', 'ed-rows', 'ed-header'`
  to `dataOnly`.
- Extend the drafts-view rendering in `renderedActions`: render once with each
  `picker` value, with `emojiTab` set to `'torn'` and to `'unicode'`, with
  `imageCheck` set to a fixed result, and in narrow with `moreOpen: true`.
  That way every new `data-act` renders.

- [ ] **Step 4: Run the tests**

Run: `node --test tests/editor-view.test.js tests/editor-ops.test.js tests/handlers.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add torn-forum-command-center.user.js tests/editor-view.test.js tests/editor-ops.test.js tests/handlers.test.js tests/load-userscript.js
git commit -m "feat: editor toolbar, pickers, image link fixer and emoji (#58)"
```

Then run `/code-map`, because the runtime and view have grown, and commit
`docs/code-map.md` as "docs: refresh the code map".

---

### Task 12: Settings: Default editor

**Files:**
- Modify: `torn-forum-command-center.user.js`: `renderSettingsView`, next to
  the autosave row (line ~6503), and the `onChange` chain (line ~8207)
- Test: `tests/editor-view.test.js` (append)

- [ ] **Step 1: Write the failing test**

```js
test('Settings offers the Default editor, and a change applies to new drafts only', () => {
  const env = loadUserscript({ location: THREAD, now: NOW });
  const api = env.exports;
  api.state.settings.view = 'settings';
  const html = api.panelHtml(api.buildPanelModel(NOW));
  assert.match(html, /<select id="tfcc-draftlang" data-act="draft-lang">/);
  assert.match(html, /<option value="md" selected>Markdown<\/option>/);
  api.state.drafts = api.saveDraft(api.freshDrafts(), 42, '**b**', NOW, 'T', 'md');
  const h = api.makeHandlers(env.doc, env.win);
  h.onChange('draft-lang', Object.assign(el({ 'data-act': 'draft-lang' }), { value: 'html' }));
  assert.strictEqual(api.state.settings.draftLang, 'html');
  api.state.route = api.parseForumRoute(env.win.location);
  api.state.settings.view = 'drafts';
  api.panelHtml(api.buildPanelModel(NOW));
  assert.strictEqual(api.state.editor.lang, 'md', 'the saved draft keeps its own mode');
});
```

Check how `onChange` receives its element in `tests/handlers.test.js` (around
line 167: `handlers.onChange('sort', el('sort', 'unread'))`), and match that
helper's shape.

- [ ] **Step 2: Run it and watch it fail**

- [ ] **Step 3: Implement it.** After the autosave row in `renderSettingsView`:

```js
    out.push('<div class="tfcc-kv"><label for="tfcc-draftlang">Default editor for new drafts</label>'
      + '<select id="tfcc-draftlang" data-act="draft-lang">'
      + [['md', 'Markdown'], ['html', 'HTML'], ['text', 'Text']].map(function (o) {
        return '<option value="' + o[0] + '"' + (model.settings.draftLang === o[0] ? ' selected' : '') + '>' + o[1] + '</option>';
      }).join('') + '</select></div>');
```

In the `onChange` chain:

```js
        if (act === 'draft-lang') {
          if (DRAFT_LANGS.indexOf(value) !== -1) { state.settings.draftLang = value; persist('settings'); }
          redraw(); return;
        }
```

Here `value` is whatever the chain uses for `el.value`. Check the
`rows-shown` case.

- [ ] **Step 4: Run the tests, then commit**

```bash
node --test tests/editor-view.test.js tests/handlers.test.js
git add torn-forum-command-center.user.js tests/editor-view.test.js
git commit -m "feat: Default editor setting for new drafts (#58)"
```

---

### Task 13: Wide parity, narrow fit, contrast

**Files:**
- Create: `tests/wide-58-diffs.js`
- Modify: `tests/wide-parity.test.js` (require and apply D58),
  `tests/wide-seed.js` only if the drafts seed needs `draftLang` pinned (it
  must not: the default is `md`)
- Run: `tests/render-preview.mjs` and `tests/contrast-audit.mjs`, read-only
  checks

- [ ] **Step 1: Capture what changed.** Run `npm test` and read the
  wide-parity failure. It prints the current and expected drafts and settings
  views, and the new CSS lines.

- [ ] **Step 2: Write `tests/wide-58-diffs.js`**, in the shape of
  `tests/wide-53-diffs.js` plus a `literals` list:

```js
'use strict';

// #58: the owner-approved wide changes for the Drafts rich editor (spec
// docs/superpowers/specs/2026-10-09-drafts-rich-editor-design.md). The golden
// is never regenerated; every change a wide panel sees is named here.
//
// literals: exact markup replacements in a view (`from` occurs exactly once).
// inserted: the complete new stylesheet lines a wide panel may now see.

const literals = [
  // The drafts view: main's "Draft for this thread" section and list become the
  // editor pane and the list with + New draft and Edit.
  { item: '58 drafts editor', view: 'drafts', from: '<FROM: copied verbatim from the golden>', to: '<TO: copied verbatim from the current render>' },
  // Settings: the Default editor row after the autosave row.
  { item: '58 default editor', view: 'settings', from: '<FROM>', to: '<TO>' },
];

const inserted = [
  // Every new CSS line from Tasks 10 and 11 that a wide panel sees, verbatim.
];

module.exports = { literals, inserted };
```

**The `<FROM>`/`<TO>` markers must not survive.** Fill each one by copying the
exact strings from the parity failure output:
- `from` is the smallest unique span of main's golden that covers the change;
- `to` is the current render's replacement for that span.

Fill `inserted` with every new CSS line verbatim, including the two
`tfcc-pv-light`/`tfcc-pv-dark` lines with their 17 variables. Lines that hang
entirely off `.tfcc-narrow` are not wide-visible, so leave them out.

**The captured diff is not approved by being captured** (plan review). Before
committing the list:
1. Check each `to` against spec section 8 (Wide): the pill row, the toolbar
   row, the pane, the action row, and All drafts with **+ New draft**. Any
   markup the spec does not describe is a bug to fix, not a line to list.
2. Render main's wide Drafts and Settings views beside the new ones with
   `tests/render-preview.mjs`, and screenshot both with gstack browse. The
   owner's brief allows gstack browse for local preview files; it is never
   pointed at torn.com.
3. Put the screenshots in the PR description under "Wide changes for
   approval". The owner approves them in the PR review.
4. Every CSS line in `inserted` must be one this plan's Tasks 10 and 11
   wrote. A line the plan does not contain is not listed.

- [ ] **Step 3: Wire it in.** In `tests/wide-parity.test.js`:
- add `const D58 = require('./wide-58-diffs');` after `D53`;
- in `expectedView`, apply `D58.literals` after `DREL.literals`;
- add `D58.inserted` to whichever list the CSS-multiset test compares. Follow
  how `D53.inserted` is consumed (grep `D53.inserted`).
- Add a test that the #58 list touches only Drafts and Settings:

```js
test('the #58 list touches only Drafts and Settings', () => {
  assert.ok(D58.literals.length > 0);
  for (const d of D58.literals) assert.ok(['drafts', 'settings'].includes(d.view), d.item);
});
```

- [ ] **Step 4: Run wide parity**

Run: `node --test tests/wide-parity.test.js`
Expected: PASS.

- [ ] **Step 5: Check the narrow fit and the contrast**

1. Run `node tests/render-preview.mjs` (read its header for its arguments),
   with the Drafts view at 320px, in source and with each picker open.
2. Load the result in gstack browse: `viewport 320x800`, `load-html`, then
   `screenshot "#tfcc-panel"`.
3. Confirm all of the following:
   - the pill's four segments fit on one row;
   - the toolbar shows B, I, U, Colour, Link and More, all 44px;
   - nothing scrolls sideways;
   - the textarea text is 16px.
4. Run `node tests/contrast-audit.mjs`. It must pass. If it audits panel tokens
   only, add the pill's pressed state to its list in the same way #53 added the
   logo token.

- [ ] **Step 6: Run the suite and commit**

```bash
npm test
git add tests/wide-58-diffs.js tests/wide-parity.test.js tests/contrast-audit.mjs
git commit -m "test: wide parity list for the Drafts editor (#58)"
```

---

### Task 14: Mutation-check promises

**Files:**
- Modify: `tests/mutation-check.mjs`

- [ ] **Step 1: Add one entry per promise.** Each entry breaks one promise, and
  names the suite that must notice. Match the exact source lines you pasted;
  copy each `apply` target from the userscript with grep, never from memory.

```js
  {
    name: 'the cleaner takes any image source (data: URLs and bare names survive)',
    suite: 'tests/editor-clean.test.js',
    apply: (s) => s.replace('        var src = safeImgSrc(attrs.src);', '        var src = attrs.src;'),
  },
  {
    name: 'the cleaner accepts javascript: links',
    suite: 'tests/editor-clean.test.js',
    apply: (s) => s.replace("/^https?:\\/\\/[^\\s<>\"'`]+$/i.test(u) ? u : '';", "u;"),
  },
  {
    // Both guards at once: with only one removed, the other still drops the
    // script's text, and the mutation would change nothing (plan review).
    name: 'a script element\'s text reaches the post',
    suite: 'tests/editor-clean.test.js',
    apply: (s) => s.replace("script: true, style: true, iframe: true,", "style: true, iframe: true,")
      .replace("        if (!tok.raw) top.children.push({ text: tok.text });", '        top.children.push({ text: tok.text });'),
  },
  {
    name: 'Markdown loses colour on the way back from HTML',
    suite: 'tests/editor-convert.test.js',
    apply: (s) => s.replace("out += '{' + key + '}' + inner + '{/}';", 'out += inner;'),
  },
  {
    name: 'an older drafts blob is marked damaged: lang materialised as text',
    suite: 'tests/editor-storage.test.js',
    apply: (s) => s.replace('        if (lang) entry.lang = lang;\n        out.byThread[id] = entry;',
      "        entry.lang = lang || 'text';\n        out.byThread[id] = entry;"),
  },
  {
    name: 'the Default editor setting is ignored',
    suite: 'tests/editor-view.test.js',
    apply: (s) => s.replace("var lang = d ? draftLangOf(d) : (DRAFT_LANGS.indexOf(state.settings.draftLang) !== -1 ? state.settings.draftLang : 'md');",
      "var lang = d ? draftLangOf(d) : 'md';"),
  },
  {
    name: 'Preview renders the draft without cleaning it',
    suite: 'tests/editor-view.test.js',
    apply: (s) => s.replace("return mdBlocks(src).map(function (b) { return { html: b.html, offset: starts[b.line] || 0 }; });",
      "return src.split('\\n').map(function (l, i) { return { html: l, offset: starts[i] || 0 }; });"),
  },
  {
    name: 'the image fixer stops rewriting Drive links',
    suite: 'tests/editor-images.test.js',
    apply: (s) => s.replace("var fixedDrive = 'https://drive.google.com/thumbnail?id=' + id + '&sz=w1000';", 'var fixedDrive = u;'),
  },
  {
    name: 'switching to Text no longer asks first',
    suite: 'tests/editor-view.test.js',
    apply: (s) => s.replace("if (mode === 'text' && ed.lang !== 'text' && ed.text.trim()) { ed.confirmText = ed.lang; redraw(); return; }", ''),
  },
```

- [ ] **Step 2: Run the check and read the log**

Run: `node tests/mutation-check.mjs > mutation.log 2>&1`, then read `mutation.log`.
Expected: every entry is caught.

If an entry reports "apply changed nothing", its `apply` target does not match
the source. Copy the line from the userscript with grep, and fix the target. If
an entry is not caught, the test does not guard its promise: strengthen the
test, not the mutation.

- [ ] **Step 3: Commit**

```bash
git add tests/mutation-check.mjs
git commit -m "test: mutation check guards the editor's promises (#58)"
```

---

### Task 15: Docs, map, and final verification

**Files:**
- Modify:
  - `CHANGELOG.md` (`[Unreleased]`);
  - `CLAUDE.md` (constraint 2: "the reply textarea" becomes "the reply box,
    Torn's editor body");
  - `docs/adr/0001-read-the-torn-api-not-the-forum-dom.md` (add
    `**Amended by:** ADR 0002` under the status);
  - `docs/adr/0002-write-the-reply-box-by-marked-paste.md` (status
    `Accepted`, with the date);
  - `docs/qa-checklist.md` (spec section 9 items 1 to 6);
  - `docs/architecture.md` (the reply-box paragraph);
  - `README.md`;
  - `docs/forum-post.md`;
  - `docs/designs/2026-10-09-drafts-rich-editor.md` (handoff log entry).
- Regenerate: `docs/code-map.md` (`/code-map`)

- [ ] **Step 1: Add the CHANGELOG entry** under `## [Unreleased]`

```markdown
### Added

- Drafts is now a post editor (#58).
  - **Modes:** Text, Markdown, HTML and Preview, switched with a pill.
    Switching converts the draft without losing anything. Preview shows the
    post the way Torn will, in its light or dark theme, and tapping a
    paragraph jumps back to it.
  - **Toolbar:** bold, italic, underline, strike, Torn's 17 text colours or a
    custom colour, size, alignment, quote, link, image, table, emoji (Torn's
    own and Unicode) and a Markdown help card.
  - **Image link fixer:** paste a Google Drive, Dropbox, GitHub, Giphy,
    Gyazo, Imgur or Reddit link, and the editor rewrites it into a link Torn
    can show. Hosts that cannot be rewritten get a one-line how-to.
  - **Free drafts:** drafts not tied to a thread, such as a new thread's
    opening post.
  - **Default editor setting** for new drafts.

### Fixed

- Insert into reply box now reaches Torn's reply editor. It had been writing
  into a hidden Report reason box since Torn's editor change (#60). Insert
  adds to what is already in the editor and never replaces it, and you
  still press Post yourself.
- Autosave reads Torn's editor again, and never overwrites a draft you
  wrote in the panel.
```

- [ ] **Step 2: Update the docs.**
  - **QA checklist:** copy spec section 9's QA items 1 to 6 verbatim into
    `docs/qa-checklist.md`, under a "Drafts editor (#58)" heading.
  - **README:** describe the editor in the Drafts section:
    - the modes;
    - the toolbar;
    - the Markdown marks table (copy `MD_HELP`'s rows);
    - free drafts;
    - Insert and Copy;
    - the image link fixer and its host list;
    - the Default editor setting.
  - **`docs/forum-post.md`:** add the editor to its feature list, and change
    every hex colour to the nearest `var(--te-text-color-*)`, using the light
    and dark table in the findings.
  - **ASCII check:** `docs/` is not covered by the ASCII rule, but the README
    may be included in Greasy Fork copy, so keep it plain ASCII.

- [ ] **Step 3: Regenerate the code map.** Run `/code-map`, then
  `git diff --stat docs/code-map.md`.

- [ ] **Step 4: Run the full verification**

```bash
npm test
npm run test:syntax
node tests/mutation-check.mjs > mutation.log 2>&1
grep -nP '[^\x00-\x7F]' torn-forum-command-center.user.js
```

Expected:
- every test passes;
- the syntax check is OK;
- `mutation.log` shows every promise caught (read it);
- the grep prints nothing.

- [ ] **Step 5: Add a handoff log entry** to
  `docs/designs/2026-10-09-drafts-rich-editor.md` covering:
  - what shipped;
  - what was discovered;
  - the open owner QA items, which are spec section 9's items 1 to 6;
  - the PR.

- [ ] **Step 6: Commit, push, and open the PR**

```bash
git status --short   # mutation.log is ignored; .vscode/ is the owner's and stays out
git add CHANGELOG.md CLAUDE.md README.md docs/adr docs/qa-checklist.md docs/architecture.md \
  docs/forum-post.md docs/designs/2026-10-09-drafts-rich-editor.md docs/code-map.md
git commit -m "docs: Drafts editor in the README, forum post, QA checklist and ADRs (#58)"
git push -u origin feat/58-drafts-editor
```

Open the PR with `gh pr create`. Title: "feat: Drafts rich editor (#58)".

**Body:**
- the summary;
- "Closes #58. Closes #60.";
- the security-surface statement: "`@match`, `@grant` and `@connect` are
  unchanged";
- the reply-box change, pointing to ADR 0002;
- the test count before and after;
- the mutation-check result;
- the owner QA list, which blocks the release.

**No attribution footer.** Check the body's last line before submitting.

---

## Plan review resolutions

The Codex adversarial review is in
`docs/records/review/2026-10-09-drafts-rich-editor-plan-codex.md`. Its verdict
was "rework". Each finding is answered here. **Fixed** means this plan, the
spec, ADR 0002 or the reference code changed.

| # | Finding | Resolution |
|---|---|---|
| 1 | Blocker: the size rules break lossless conversion, and saving silently truncates | **Fixed.** Spec 4a: any result over `DRAFT_MAX_CHARS` is refused through `overLimitNotice`, at the mode switch, every toolbar edit, Fix image links and autosave. The textarea has `maxlength`. `CLEAN_MAX_CHARS` is 1000000, measured against the worst expansion found (38x) and pinned by a Task 2 test, so a real draft is never sliced |
| 2 | Blocker: first-match reply box, with five TinyMCE editors | **Fixed.** `findReplyBox` takes every match, keeps the visible ones, prefers `.forums-new-post-wrap`, and refuses when ambiguous (spec 7, ADR 0002). Tests cover a hidden body first, two visible bodies, and an ambiguous pair. Two mutations guard it |
| 3 | Major: Preview loads arbitrary external images | **Fixed.** Placeholders until the player taps Show images, with `referrerpolicy="no-referrer"`. Emoji always show. The read-only host audit gains a named image-fixer list confined to `fixImageUrl` (spec 4a, Tasks 4 and 10) |
| 4 | Major: the legacy-settings test bypasses `isRecoveredSettings` | **Fixed.** The Task 6 tests go through `loadKey` with `isRecoveredSettings`, as `loadAll` does |
| 5 | Major: an autosave timer saves to the thread open now | **Fixed.** The thread and box are captured per listener, the old listener is removed, and the stale route is checked. Test and mutation added |
| 6 | Major: Copy reports success before the clipboard answers | **Fixed.** `copyPost` takes a `done` callback, called only on settlement. Rejected `write` falls back to `writeText`, and a rejected `writeText` reports failure. Tests added |
| 7 | Major: the custom-colour confirmation loses the typed hex | **Fixed.** Picker fields live in `state.editor.fields` (via `onInput`) and render back. The test asserts the redrawn value |
| 8 | Major: picker reads use document-wide `valueOf` | **Fixed.** Editor handlers read `field()` from state only. A test proves a same-named element on Torn's page is ignored |
| 9 | Major: unsaved text is discarded when switching drafts | **Fixed.** A `dirty` flag, with a save before `loadEditor` changes key. Test added |
| 10 | Major: the cleaner slices silently | **Fixed** by #1. The slice is a security bound that a real draft cannot reach, and a test proves it |
| 11 | Major: Text to MD/HTML trims spaces | **Documented** (spec 4a). HTML, and so Torn's post, collapses whitespace anyway. Preserving spaces would mean emitting `&nbsp;` runs players did not ask for |
| 12 | Major: `data-mce-bogus` handling contradicts the spec | **Fixed.** The spec now says `"all"` is dropped with its content and others are unwrapped. The reference code does that. A Task 1 test was added, and the Task 9 test no longer expects a bogus element to survive |
| 13 | Major: image fixer gaps | **Fixed:** the Reddit wrapper passes non-fixable verdicts through, and `fixAllImages` accepts single quotes. Every documented input shape is now a row in the Task 4 table. **Kept:** the Imgur `.png` rewrite, with its GIF note. It is unverified, so release QA item 6 tests a JPG and a GIF, and a failure moves Imgur to "not derivable" before release |
| 14 | Major: wrong offsets in the link selection test | **Fixed** (22 and 23) |
| 15 | Major: the long-post fixture is over the limit | **Fixed.** 1100 repeats (18700 characters), plus an assertion that conversion preserved every unit |
| 16 | Major: the read-only host audit and the `insertDraft` focus audit will fail | **Fixed.** Task 4 extends the host audit deliberately with a confined list. Task 7 retargets the focus audit to `insertPost` |
| 17 | Major: missing exports | **Fixed.** Explicit export lists in Tasks 10 and 11 |
| 18 | Major: two mutations change nothing | **Fixed.** Replaced with an image-source mutation, and a script mutation that removes both guards together |
| 19 | Major: self-referential wide parity | **Fixed.** Each `to` is checked against spec 8, and the before and after screenshots go to the owner for approval in the PR. Only CSS lines the plan wrote may be listed |
| 20 | Major: tests that pass for the wrong reason | **Fixed.** Full constant fixtures copied from the probes; an independent sample-preservation test; source-preservation counts in the long-post test; a real Insert in the free-draft test |
| 21 | Major: no Done button; check "as the player pastes" | **Spec amended.** Choices apply at once and Cancel closes, so a Done would add nothing. The image check runs on the Check link tap, because the panel does not redraw on keystrokes |
| 22 | Major: `fromCodePoint` and `repeat` are not ES5 | **Not changed.** The script already depends on ES2015 built-ins (`Object.assign` in the drafts code), and Torn PDA runs modern webviews. The plan's "ES5-style" means syntax, not built-ins |
| 23 | Major: stale code-map anchors | **Fixed.** Global constraint: locate by symbol, because line numbers drift. The map is regenerated after Tasks 6, 11 and 15 |
| 24 | Minor: a 13-digit free-draft id | **Fixed.** The id wraps within 12 digits. Test added |
| 25 | Minor: gstack browse is disabled | **Not changed.** The owner's brief for this phase allows gstack browse for local preview files, never for torn.com. CLAUDE.md's "Off" entry concerns QA of the live site |
| 26 | Minor: no legacy-normaliser test | **Fixed.** A frozen v0.2.2 `normaliseDrafts` fixture, copied from tag `v0.2.2`, with a downgrade test |
| 27 | Minor: `git add -A` can commit `mutation.log` | **Fixed.** `mutation.log` is in `.gitignore`, and every `git add` names its paths |
| 28 | Minor: the ASCII check is missing from some tasks | **Fixed.** A global rule: every userscript-editing task runs it |
