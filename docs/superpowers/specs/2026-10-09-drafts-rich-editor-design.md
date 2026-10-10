# Drafts rich editor - design

**Status:** approved in conversation 2026-10-09; written spec awaiting owner review.
**Issue:** #58. It also fixes #60, Insert writing into a hidden Report reason box.
**Research:** `docs/reference/torn-forum-editor-findings-2026-10-09.md`. It is
marked throughout as owner-observed or public docs.
**Brief:** `docs/designs/2026-10-09-drafts-rich-editor.md`.
**ADR:** `docs/adr/0002-write-the-reply-box-by-marked-paste.md`.
**Release:** the PR adds an `[Unreleased]` CHANGELOG entry only. The version
bump is its own `chore(release)` PR, and release is blocked on the QA items in
section 9.

## 1. Problem

The Drafts view holds plain-text reply drafts, and Insert and Copy hand them
over. A player who wants a well-formatted Torn post, with colors, a table, a
centred heading or an image, has to build it in Torn's own editor. Torn's
editor has no table button, no Markdown, no drafts that outlive a page, and no
way to see a post in both themes.

Insert is also broken today (#60). Torn's reply box became a TinyMCE editor. The
fallback selectors now match a hidden Report reason textarea, so Insert reports
success while writing nowhere useful, and autosave listens to the same wrong
box.

## 2. What the player gets

- **A mode pill** at the top of the editor: `Text | MD | HTML | Preview`.
  - The pill shows one pane at a time, never a preview under the editor
    (owner's request).
  - New drafts open in the **Default editor** mode, set in Settings.
- **A toolbar:** Bold, Italic, Underline, Strike, Color, Size, Align, Quote,
  Link, Image, Table.
  - In **MD** and **HTML** each button wraps the selection, or inserts at the
    caret, in that language's marks.
  - In **Preview** the toolbar is disabled.
  - In **Text** the toolbar is hidden.
- **Preview** renders the post as Torn will, using Torn's measured colors for
  either theme.
  - A light/dark switch sits in the Preview bar, not beside the pill.
  - It defaults to the panel's resolved theme.
  - **Tapping a paragraph** in Preview returns to the source mode with the caret
    at that paragraph.
- **Switching** between Text, MD and HTML converts the draft (section 4).
- **Free drafts:** besides per-thread reply drafts, **+ New draft** creates a
  named draft tied to no thread, such as a new thread's opening post.
  - All drafts lists both kinds; a free draft carries a marker.
  - Either kind opens in the editor with **Edit**.
- **Insert into reply box** puts the formatted post at the end of Torn's
  editor, wherever that editor is on the page: a thread reply or a new thread.
- **Copy** puts the formatted post on the clipboard. Pasted into Torn's editor
  it keeps its styles; pasted as text it is the HTML source.
- **Settings > Drafts > Default editor:** Markdown, HTML or Text. The default
  is Markdown.

Out of scope, by owner decision:
- **Live mode** (Obsidian-style editable preview) is dropped. Tap-to-edit
  Preview replaces it.
  - Torn's own editor is the live editor after Insert.
  - The estimate was 1,200 to 2,500 added lines, mostly untestable in Node, and
    fighting the panel's innerHTML redraw model.

Back in scope (owner, 2026-10-09):
- **The image link fixer** (section 8).
- **Emoji**: Torn's 30 and Unicode (sections 3 and 8).

Still out of scope:
- **YouTube embeds** (owner, 2026-10-09: not needed).
- **Uploading image files to Torn.** It needs Torn's undocumented upload
  endpoint, which ADR 0001 rules out and which Torn's scripting rules put at
  risk. The image picker points to Torn's own Insert Image button for files.

The README and forum-post updates are in scope, and they gate release (section 9).

## 3. The Markdown dialect

It is line-based on purpose, because players expect Enter to behave as it does
in Torn's editor.

| Source | Output |
|---|---|
| A non-empty line | `<p>...</p>` |
| An empty line | `<p>&nbsp;</p>`, a visible gap, as in the published guide |
| `**b**` / `*i*` | `<strong>` / `<em>` |
| `++u++` | `<span style="text-decoration: underline;">` |
| `~~s~~` | `<span style="text-decoration: line-through;">` |
| `{red}x{/}` | `<span style="color: var(--te-text-color-red);">`, for any of the 17 names |
| `{#rrggbb}x{/}` | `<span style="color: #rrggbb;">` |
| `{18}x{/}` | `<span style="font-size: 18px;">`. Any whole number from 8 to 36, the cleaner's range; the Size picker offers 10, 12, 14, 16, 18, 20 and 24 |
| `# h` / `## h` / `### h` | `<p><span style="font-size: 24px/18px/16px;"><strong>h</strong></span></p>` |
| `:::center` ... `:::` (also `left`, `right`, `justify`) | each line's `<p>` gets `style="text-align: center;"` |
| `> line` | consecutive lines join into one `<blockquote>`, each line a `<p>` |
| `- item` / `1. item` | `<ul>` / `<ol>` with `<li>`, one level |
| `[t](https://...)` | `<a href="..." target="_blank" rel="noopener">t</a>`; `http(s)` only |
| `![alt](https://...)` | `<img src="..." alt="alt">` |
| a GFM pipe table, with `:--:` alignment | `<div><div><div class="table-wrap"><table><tbody>`. The first row is `<th>` when a delimiter row follows it. An aligned column puts `style="text-align: ..."` on its cells |
| `:grin:` (any of Torn's 30 emoji names) | `<img src="/images/emotions/svg/grin.svg">`, exactly as Torn's editor inserts it. An unknown name stays literal text |
| `\*` and the like | a literal character |
| inline HTML | kept, then cleaned (section 5) |

Marks nest. `{red}{18}**x**{/}{/}` gives a red, 18px, bold "x".

- An unclosed mark is literal text, never an error.
- A **?** button in the toolbar opens a short reference for the marks: it
  reads the table above in plain words.

Why headings are not `<h2>`: the published guide uses sized bold spans, which
are proven to survive a save. `<h*>` is not proven.

## 4. Converting between modes

- **Pure engine functions,** no DOM:
  - `mdToHtml`;
  - `htmlToMd`;
  - `textToHtml`;
  - `textToMd`;
  - `htmlToText`;
  - `cleanTornHtml` (section 5).
- **MD to HTML** is exact.
- **HTML to MD** converts every construct the dialect expresses. Anything it
  cannot express, such as a table cell width, stays in the Markdown as inline
  HTML, cleaned. So `mdToHtml(htmlToMd(h))` equals `cleanTornHtml(h)` for every
  cleaned `h`. This round-trip is the "nothing is lost" promise, and the
  mutation check guards it.
- **Text to MD or HTML** escapes the text, and each line becomes a paragraph.
- **MD or HTML to Text** drops formatting.
  - The pill does not switch at once. The panel shows "Plain text drops the
    formatting. Switch anyway?" with **Switch** and **Cancel**, in the panel and
    never a browser dialog.
- **Preview** renders `cleanTornHtml` of the current mode's HTML. Text becomes
  paragraphs.
- **Tap-to-edit:** each top-level block in the preview carries the source line
  (MD), or the block index (HTML), that it came from. A tap switches back to the
  draft's source mode and puts the caret at the start of that line or block. It
  uses the panel's existing focus plan, so the caret survives the redraw.

## 4a. Size, images in Preview, whitespace (amended after the plan review)

**Size:**
- A draft's source is at most `DRAFT_MAX_CHARS` (20000), as today.
- Converting to HTML can make it longer. If a mode switch, a toolbar action or
  the image fixer would produce a source over 20000, the panel refuses with a
  notice, and the draft is unchanged:
  "That would make this draft N characters, over the 20000 limit. Shorten it,
  or keep it as it is."
- Typing or pasting at the 20000 limit shows a one-time notice.
- Autosave skips a Torn-editor body whose HTML source is over the limit, so it
  never stores a truncated post.
- Nothing is ever silently cut.

**Images in Preview:**
- Preview does not load external images until the player taps
  **Show images**. Until then each image is a placeholder naming its host.
  This keeps the panel from sending requests to arbitrary hosts.
- Torn's own emoji (site-relative SVGs) always show.
- Loaded images use `referrerpolicy="no-referrer"`.
- `tests/read-only.test.js` names the image hosts the link fixer writes, as
  string rewrites that nothing fetches without the player's tap.

**Whitespace:** HTML collapses runs of spaces, and so does Torn's own post. A
Text draft's leading or repeated spaces therefore collapse when it becomes
Markdown or HTML, exactly as they would on Torn. This is documented, not
confirmed.

**Unsaved edits:** typing marks the open draft dirty. Opening another draft,
or moving to another thread, saves the dirty draft first, so switching never
discards text.

## 5. The cleaner, `cleanTornHtml`

One allowlist cleaner, pure and engine-side. Preview, Insert, Copy, HTML-mode
switching and autosave capture all go through it.

**Why it is security-critical:** Preview renders player-typed HTML inside FCC's
panel on torn.com.

**Allowed:**

| Element | Allowed attributes and styles |
|---|---|
| `p` | `text-align: left/center/right/justify` |
| `br` | none |
| `span` | `color` (a `var(--te-text-color-<one of 17>)` or `#rgb` / `#rrggbb`), `font-size` (`8px` to `36px`), `text-decoration` (`underline` / `line-through`) |
| `strong`, `em` | none. `b` maps to `strong`, `i` to `em`, `s`, `strike` and `del` to a line-through span, `u` to an underline span |
| `ul`, `ol`, `li` | none |
| `blockquote` | none |
| `a` | `href`, `http://` or `https://` only, with `target="_blank" rel="noopener"` forced |
| `img` | `src`: `https://`, or exactly `/images/emotions/svg/<one of the 30 names>.svg`. Also `alt` |
| `div` | only the `table-wrap` trio around a table, which the cleaner itself emits; other `div`s unwrap to their children |
| `table`, `tbody`, `tr`, `th`, `td` | `width` / `height` in `px` or `%`, `text-align` |

- Every other style property is dropped.
- **Dropped with their contents:** `script`, `style`, `iframe`, `object`,
  `embed`, `template`, comments, and TinyMCE's `data-mce-bogus="all"`
  elements.
- **TinyMCE's other bogus elements** (`data-mce-bogus` with any other value)
  are unwrapped, so the player's text inside them is kept. A bogus `<br>` is
  dropped. (Amended after the plan review.)
- **Unwrapped:** every other element, keeping its text.
- **Removed:** every `on*` attribute and every `data-*` attribute.
- **Output** is canonical: lower-case tags and fixed attribute order, so
  equality tests are meaningful.
- **Input is capped** at `CLEAN_MAX_CHARS` (1000000), a security bound that a
  real draft never reaches. The worst Markdown expansion measured is about 38
  times (an empty one-cell table per three characters), so a 20000-character
  draft stays under 760000. A test pins this. (Amended after the plan review.)
- The tokenizer is linear, with no backtracking regex over the whole input.
  The worst case measured cleans in under 100ms.

## 6. Drafts and settings storage

**Drafts blob:** `{ v, byThread: { "<threadId>": { text, updatedAt, title, lang? } }, free?: { "<id>": { name, text, lang?, updatedAt } } }`

- `lang` is `"md"` or `"html"`, and is **omitted when it is Text**.
  - Stored legacy drafts have no `lang`, so they normalise byte-identical.
  - Nested shapes are compared strictly by the recovery check, and a
    materialised `lang: "text"` would mark every old drafts blob as damaged.
  - Unknown `lang` values normalise to absent, meaning Text.
- `free` is top-level, so an older blob without it is forgiven by
  `isRecoveredValue`.
  - Ids match `/^n[0-9]{1,12}$/`.
  - At most 100 free drafts, each text capped at `DRAFT_MAX_CHARS`, and each
    name at 80 characters.
  - The default name is "Untitled N".
- `SCHEMA_VERSION` does not change. An older build reading a newer blob keeps
  `byThread` text and drops `free`, the documented downgrade loss.

**Settings:** `draftLang: 'md' | 'html' | 'text'`, default `'md'`.
- It is strict on the menu. Absent or off the menu takes the default.
- It is top-level, so recovery forgives it.

**Tests prove each of these:**
- an older drafts blob loads with no damage notice;
- an older settings blob loads with no damage notice;
- a stored `lang: "text"` and a junk `lang` both normalise to absent;
- an older build's normaliser keeps `byThread` text.

**Export and import** include `free` and `lang`, through the existing claims
path.

## 7. Handing over: Insert, Copy, autosave

**The reply box** is `#editor-wrapper .editor-content.mce-content-body`.
- These are unhashed hooks. TornTools uses the same selector, last changed
  2026-10-07.
- `REPLY_SELECTORS` loses every textarea entry. There is no textarea to find:
  - `textarea[name="postText"]` and `#quickReplyText` no longer exist;
  - the broad fallbacks caught the Report box (#60).
- If the selector misses, `replyBoxFound` is false and the panel offers Copy,
  as today.
- **Several matches.** A thread page holds several TinyMCE editors. FCC takes
  every exact-selector match and keeps the connected, visible ones (non-zero
  size).
  - One left: that one.
  - Several: the one inside `.forums-new-post-wrap`, the reply and new-thread
    form the owner's probe found.
  - Still ambiguous: no reply box, so Copy. FCC never guesses between two
    visible editors. (Amended after the plan review.)

**Insert** (ADR 0002):
- **The steps:**
  1. Clean the post.
  2. Move the selection to the end of the editor body with a `Range`.
  3. Dispatch one `ClipboardEvent('paste')` at the body. Its `DataTransfer`
     holds `text/html` = `<!-- x-tinymce/html -->` + the post, and `text/plain`
     = the post's text.
- **Why the marker:** it tells TinyMCE the content is its own, so Torn's
  `paste_webkit_styles: 'none'` filter does not strip the styles.
  - Owner-observed (test B): every style kept, and Torn's code-view mirror
    updated.
- **Success:** TinyMCE calls `preventDefault` on a paste it handles, so
  `dispatchEvent` returning `false` and the body's HTML having changed means
  success.
- **Anything else** is a visible failure: "Torn's editor did not accept the
  insert. Use Copy instead."
- **Insert appends, and never erases** what is in Torn's editor. Torn's Reset
  clears it.
- No `.click()`, no `submit`, no navigation. The player presses Post.
- `read-only.test.js` changes from "the only synthetic event is the input
  event" to "the only synthetic event is the paste a draft insert needs". It
  still asserts exactly one `dispatchEvent` in the source.

**Copy:**
- Where `navigator.clipboard.write` and `ClipboardItem` exist, write a
  `ClipboardItem` with:
  - `text/html` = the marked post;
  - `text/plain` = the cleaned HTML source.
- Otherwise fall back to `copyText` with the HTML source.
- Copy from the All drafts list copies that draft's post.

**Autosave** (the existing `autosaveDrafts` setting):
- It listens for `input` on the editor body.
- After the existing debounce it saves the cleaned body HTML as the current
  thread's draft, with `lang: "html"`.
- It does so **only when that thread has no draft, or its draft is already
  HTML**. It never overwrites a Text or MD draft.
- An empty body never deletes, as today.
- It runs on thread pages only, as today.

## 8. Layout

**Wide** (Drafts view):
- the pill row and theme switch;
- the toolbar row;
- the editor pane: a textarea, or the preview `div`;
- the action row: Save draft, Insert or Copy, Delete;
- then All drafts with **+ New draft**.
- Every wide change is an exact-line entry in a new `tests/wide-58-diffs.js`.
  The golden is not regenerated.

**Narrow** (spec section 14 rules apply, at 320px in Torn PDA):
- The pill is one row of four 44px segments, labelled `Text`, `MD`, `HTML`,
  `Preview`.
- The toolbar shows B, I, U, Color and Link, plus **More**. More opens a drawer
  with S, Size, Align, Quote, Image, Table and **?**, at 44px with 8px gaps.
- The editor textarea text is 16px, so iOS does not zoom.
- The Color, Size, Align, Link, Image and Table pickers open inline in the
  panel, never as browser dialogs.
  - A choice applies at once: a swatch, a size, an alignment, an emoji, or
    the picker's Add, Insert or Use button.
  - **Cancel** closes the picker without a change. There is no separate Done.
    (Amended after the plan review.)
  - A picker's typed fields (hex, link, image URL and description, table
    size) are kept in the editor state as the player types, so a redraw never
    empties them.
- Every icon-only button has a word name (`aria-label` and `title`).
- Emoji or arrows in labels are JS escapes. The source stays ASCII.

**Pickers:**
- **Color:** the 17 Torn swatches, each named, plus a hex field.
  - A custom hex under 4.5:1 contrast against either theme's editor background
    shows a warning naming the theme. The backgrounds are `--te-background-color`,
    `#fff` light and `#111` dark, both measured.
  - gray5 carries "matches the page background".
- **Image:** a URL field, an alt-text field, and a **Fix link** step that runs as
  the player pastes. The rules come from
  `docs/reference/image-host-link-rules-2026-10-09.md`.
  - **Rewritten:** a pure function, `fixImageUrl(url)`, returns
    `{ url, host, status, note }`. It rewrites deterministic hosts:
    - Google Drive, to `thumbnail?id=ID&sz=w1000` (owner-verified);
    - Dropbox, to `raw=1`;
    - GitHub, to `raw.githubusercontent.com`;
    - Giphy, to `media.giphy.com`;
    - Gyazo, to `i.gyazo.com/<hash>.png`;
    - a single Imgur image, to `i.imgur.com/ID.png`;
    - Reddit's media wrapper, to the URL inside it.
    - The picker shows both the old and the new link, plus that host's caveat:
      for example "Drive: the file must be shared 'Anyone with the link'".
  - **Accepted as is:** `https://editor.torn.com/...`, and `https://` URLs
    ending in `.png`, `.jpg`, `.jpeg`, `.gif` or `.webp`.
  - **Not derivable:** Google Photos, OneDrive, ImgBB, Postimages, Imgur albums,
    Lightshot and Tenor. The picker shows that host's one-line instruction (the
    tooltip the owner asked for), for example "On the ImgBB page, copy the
    Direct link field".
  - **Refused, with a reason:**
    - Discord CDN links, which expire;
    - `http:`;
    - anything else with no image extension: "This looks like a web page, not
      an image".
  - **For files:** "Have the file, not a link? Upload it with Torn's own Insert
    Image button after Insert."
  - **The check runs when the player taps Check link.** That is a deliberate
    action, not on every keystroke, because the panel does not redraw while a
    field is being typed in. (Amended after the plan review: the earlier text
    said "as the player pastes".)
  - **A preview thumbnail** of the fixed URL shows in the picker, so a dead link
    is visible before it is inserted. Tapping Check link is what loads it.
    - The image is loaded with `referrerpolicy="no-referrer"`, so the host
      never learns the Torn page it was viewed from.
  - **A Fix image link button** also sits in the Drafts toolbar's More drawer.
    It rewrites every fixable image URL already in the draft and reports how
    many it changed.
- **Emoji:** a toolbar button (in More when narrow) with two tabs.
  - **Torn:** the 30 emoji, drawn from Torn's own same-origin SVGs. In MD a tap
    inserts `:name:`; in HTML it inserts the `<img>`. The names are a frozen
    engine constant, `TORN_EMOJI`, from the owner's emoji check: `angel`, `angry`, `authority`, `beard`, `beaten_up`, `blushing`, `bored_sleepy`, `confused`, `cool`, `cry`, `disappointed`, `dizzy`, `evil`, `grin`, `hushed`, `kissing`, `laughing`, `love_chemistry`, `money`, `moustache`, `mugger_masked`, `nerd`, `party`, `pirate`, `sick`, `smiley`, `tired`, `tongue`, `wink`, `zip_mouth`.
  - **Unicode:** a curated set of about 40 common emoji, inserted as
    characters. Each is written as a JS escape, so the source stays ASCII.
  - **A tip** under the tabs: "More emoji: press Win + . (Windows) or
    Ctrl + Cmd + Space (Mac) while typing."
- **Table:** columns 1 to 8, rows 1 to 30, header row on or off. It inserts a
  skeleton in the current mode's language.

## 9. Testing and release

**Engine tests (Node):**
- each dialect row in section 3;
- marks that nest and marks left unclosed;
- the round-trip property over a fixture set:
  - `docs/reference/torn-forum-post-sample.html`;
  - the owner's toolbar test HTML from the findings;
  - hand-made edge cases;
- the cleaner: every allowlist row, plus hostile input (`<script>`,
  `onerror=`, `javascript:` and `data:` URLs, nested `<style>`, `<img src=x
  onerror>`, unclosed tags, 20000-character input);
- the contrast warning;
- emoji shortcodes, including an unknown name staying literal, and the
  cleaner refusing any other site-relative image;
- image URL classification, and `fixImageUrl` for every row of the host-rules
  file: each input shape, each refusal, and the rewritten output exactly;
- the storage rules in section 6.

**Runtime tests:**
- Insert:
  - dispatches exactly one paste whose `text/html` starts with the marker;
  - moves the selection to the end;
  - reports success only when `preventDefault` was called and the body changed;
  - reports a miss as Copy;
  - never matches `textarea.reason`, the #60 regression;
- autosave never overwrites an MD draft;
- Copy writes both MIME types;
- the mode pill converts;
- the Text switch asks first;
- tap-to-edit lands the caret;
- the settings default applies to new drafts only.

**Gates:**
- `tests/purity.test.js` covers the new engine functions.
- The mutation check gains promises for:
  - the cleaner (it drops `on*`, and it refuses `javascript:`);
  - the round-trip;
  - old drafts loading silently;
  - Insert never erasing;
  - autosave never overwriting MD;
  - the single dispatch.
- `npm test`, `npm run test:syntax` and `node tests/mutation-check.mjs > mutation.log 2>&1`
  must pass, with the log read.

**Release QA**, added to `docs/qa-checklist.md` and walked by the owner on a real
account:
1. Insert a Markdown draft with every construct into a reply and a new thread.
   Press Post in the owner's test thread, then confirm the published post
   matches Preview. This settles what Torn keeps on save:
   - quote;
   - strike;
   - italic;
   - cell alignment;
   - `table-wrap`.
2. The same Insert in Torn PDA (Android, and iOS if available). The synthetic
   paste must work in PDA's webview, otherwise the panel offers Copy.
3. Copy, then paste into Torn's editor: the styles survive.
4. Old drafts and settings from v0.2.2 load with no damage notice.
5. At 320px in PDA, the pill, toolbar, More drawer and pickers fit, with 44px
   targets.
6. Fixed image links render after Post. Check each of these:
   - a Drive file;
   - a Dropbox file;
   - an Imgur single image, as a JPG and as a GIF;
   - a GitHub image;
   - a Gyazo screenshot.
   A host that fails is moved to "not derivable" before release.

**Docs before release** (owner request, 2026-10-09). The release PR is blocked
until these are done:
- **`README.md`** describes the editor:
  - the modes;
  - the toolbar;
  - the Markdown marks;
  - free drafts;
  - Insert and Copy;
  - the Default editor setting.
- **`docs/forum-post.md`** gains the editor in its feature list. Its own colors
  move from hex to `var(--te-text-color-*)`, so the post reads well in both
  themes.
- **Screenshots** of the editor, if the README's set covers Drafts.

## 10. Risks

| Risk | Mitigation |
|---|---|
| Torn changes its editor or the TinyMCE paste rules | One selector and one dispatch, both behind a visible failure that falls back to Copy |
| A synthetic paste fails in PDA's webview | `dispatchEvent`'s return value detects it, and Copy works. QA item 2 |
| Torn strips something on save that its editor kept | The dialect emits only constructs the published guide proves, plus quote, strike, italic and cell alignment, which QA item 1 checks before release. If one fails, it changes in the dialect, not in the architecture |
| Hostile HTML in a draft runs in the panel | Allowlist cleaner, tested with hostile fixtures and guarded by the mutation check |
| The script grows by about 1,500 to 2,200 lines | The engine functions stay pure and Node-tested. `/code-map` is regenerated in the PR |
