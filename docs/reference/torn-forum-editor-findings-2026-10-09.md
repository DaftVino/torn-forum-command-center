# Torn forum editor findings (2026-10-09)

Research for #58, the Drafts rich editor. It answers the five questions in
`docs/designs/2026-10-09-drafts-rich-editor.md`.

**Provenance.**
- **Owner-observed** means the owner ran the read-only probe
  (`docs/reference/torn-forum-editor-probe.js`) in DevTools on pages they had
  opened themselves:
  - Chrome 154 on desktop, dark mode;
  - a thread in forum 999 and thread 16321895.
- **Public docs** means Torn's API schema, the Torn wiki or open-source code.
- No browser automation touched torn.com.

## Headline

1. **Torn's reply box is TinyMCE 6.8.5 in inline mode.** It is a
   contenteditable `div`, not a textarea, and there is no
   `textarea[name="postText"]`.
2. **FCC's Insert is broken today, and so is reply-box autosave.**
   - Neither of the first two selectors matches.
   - The broad fallbacks (`.forums-thread-wrap textarea`,
     `#forums-page-wrap textarea`, `textarea`) catch a hidden Report-reason
     textarea, `textarea.reason` inside `li.report`, sized 0x0.
   - Insert writes the draft there, and the panel says "Draft inserted".
   - Autosave listens to that same element, so it never sees what the player
     types.
   - The owner observed this in 3b. The probe showed a `textarea.reason` holding
     33 characters, the length of the owner's FCC draft, while the real editor
     stayed empty.
   - Filed separately as a bug.
3. **Pasting rich HTML strips every inline style.** That rules out "Copy as
   rich text" as the way to hand over formatted posts.
4. **Images in posts are hosted by Torn.** "The proper format" is an
   `https://editor.torn.com/...` URL, made by Torn's own Insert Image upload.

## Q1. Textarea or rich editor?

**Answer: a rich editor, TinyMCE 6.8.5, inline mode.**

Owner-observed: probe fingerprint `tinymce: true`, and `tinymce.majorVersion` /
`minorVersion` read 6.8.5.

The structure, in Torn's naming. Classes ending `___xxxxx` are CSS-module hashes
and will change without notice.

```
div.forums-new-post-wrap
  div.forums-create-new
    div.cont-gray.bottom-round
      form#editor-form
        input[name="post_id"] (hidden)
        div#editor-wrapper.post-editor-wrap
          div.editorRoot___SPDEh.editorRoot
            div.editorContentWrapper___zq88D.unreset
              div#mce_N.editor-content.mce-content-body.editorContent___fipTO   <- contenteditable, visible
              textarea.sourceArea___lGrOt.hidden___xSXji                         <- the code view's source box, hidden
```

- **Stable hooks.** `#editor-form`, `#editor-wrapper`, `.editor-content` and
  TinyMCE's own `.mce-content-body` are unhashed.
  - Public docs: TornTools uses exactly
    `#editor-wrapper .editor-content.mce-content-body`.
    - `src/common/features/add-debug-info/add-debug-info.ts:22`
    - `src/common/features/forum-warning/forum-warning.ts:42`
    - Repository at commit abc7881, 2026-10-07.
- **The editor id is not stable.** `mce_0` on one page and `mce_4` on another.
  The thread page held **5** TinyMCE editors, presumably one per hidden edit
  box, so `tinymce.activeEditor` cannot be trusted. Look the editor up by the
  visible body's id: `tinymce.get(body.id)`.
- **The source textarea.**
  - Unnamed and hidden.
  - It holds the HTML once content exists: 2538 characters after the toolbar
    test.
  - It is the code view ("Toggle Code Editor"), not a form field.
- **The toolbar, by `aria-label`:** Reset, Bold, Italic, Underline, Strike
  Through, Change Font Size, Change Font Color, Block Quote, Remove Format,
  List Alignment, Block Formatting Group, Insert Image, Insert Link, Open Emoji
  dialog, Toggle Code Editor. Post is `button.torn-btn`.
- **jQuery is on the page.**
  - Public docs: TornTools writes `innerHTML` on the editor body, then calls
    jQuery `.keyup()` in page context. Its comment reads "Need jQuery as
    dispatchEvent is not working".
  - So a plain DOM write plus a native event is known not to reach Torn's state.
- **What inserting HTML does depends on the route.**
  - **Paste of rich clipboard HTML.** Owner-observed (3a): structure survives,
    style attributes do not. See Q2.
  - **The toolbar test.** Owner-observed: the test post's HTML, styles included,
    matches the editor body exactly. TinyMCE only adds `data-mce-*` bookkeeping
    attributes and a `mce-item-table` class.
    - **To confirm:** whether that HTML went in through the toolbar, or was
      pasted into Torn's code view. If it was the code view, pasting FCC's HTML
      there keeps its styles.
  - **Native textarea setter and `input` event (FCC today).** It never reaches
    the editor; see Headline 2.
- **Torn persists an unsent editor body per thread.** Owner-observed: content
  pasted in 3a came back after page refreshes until the owner moved to another
  thread.
  - Where Torn stores it is unknown.
  - This overlaps with what FCC's reply-box autosave was for.

## Q2. What does Torn keep, and what does it strip?

### On paste (owner-observed, 3a)

The owner pasted the rendered `torn-forum-post-sample.html`.

**Kept:**
- `strong`, `ul`, `ol`, `li`, `br`;
- links with `target="_blank" rel="noopener"`;
- the `div > div > div.table-wrap > table` nesting with `th` cells;
- blank paragraphs, now `<p><br data-mce-bogus="1"></p>`.

**Stripped:** every `style` attribute, including:
- `color: var(--te-text-color-*)`;
- `font-size`;
- `text-align`;
- `text-decoration: underline`.

The owner noticed the lost alignment. The probe shows the colours, sizes and
underline went too: no element in the pasted body has a `style`. TinyMCE 6's
default paste filter, `paste_webkit_styles: 'none'`, would explain it. That is
an inference, not confirmed.

### In the editor (owner-observed, toolbar test)

Markup the editor itself produced and held:
- `blockquote > p` for Block Quote;
- `<span style="color: var(--te-text-color-red);">`;
- `<span style="font-size: 10px;">` and `18px`;
- `<span style="text-decoration: underline;">`;
- `strong` and `em`;
- `<img src="/images/emotions/svg/angel.svg">` for an emoji. Torn's emoji are
  site-relative SVG images.
- Toolbar-made tables:
  - plain `<table style="width: 39%; height: 154px;">` with per-cell
    `width`/`height` styles, from TinyMCE's resize handles;
  - **no** `table-wrap` wrapper.
- The published sample's tables do have `div > div > div.table-wrap`.
  - Either Torn adds it on save or render, or the sample's author had it from
    an earlier paste. **Unknown which.**

### On save (server-side)

**Unknown.** Nothing has been posted and read back.
- The probe's `valid_elements` read returned null.
- That proves nothing: the probe used TinyMCE 5's `editor.settings`, and 6.x
  reads options with `editor.options.get(...)`.
- Public docs: the published sample proves that inline `color: var(...)`,
  `font-size`, `text-align` and `text-decoration` spans survive a save.
- Public docs: the API's `ForumPost.content` returns "raw value (with HTML)".
  `is_legacy` marks posts "made using the old formatting engine which doesn't
  use HTML". Source: `docs/reference/torn-openapi-forum-excerpt-2026-10-08.json`.
- Public docs (wiki, via search summary only): BBCode was phased out for an HTML
  editor. The last BBCode surface, committee mass mail, was replaced in August
  2024.
- Public docs (API schema): a quote of another post is structural
  (`has_quote`, `quoted_post_id`), not inline markup. A Block Quote made in the
  editor is a plain `blockquote`.

## Q3. Images

**Owner-observed.**
- An `<img>` pointing at a Google Drive `/file/d/.../view` page renders broken.
  That is a web page, not an image, so it does not show whether external
  hosts are blocked.
- A working image is `https://editor.torn.com/<uuid>-<number>.jpg`, made by
  Torn's Insert Image upload. The trailing number may be the uploader's player
  ID; that is unconfirmed.

**Public docs (forum posts via search summaries, low confidence).**
- Players report that an image must be a direct `.png`, `.jpg` or `.gif` URL.
- Pasting an image into the editor uploads it to Torn.
- Discord-hosted images stopped working.

**Consequence for FCC.**
- Converting an arbitrary https URL to an `editor.torn.com` URL means uploading
  through Torn's undocumented editor endpoint. ADR 0001 rejects undocumented
  endpoints, and `@connect` names only `api.torn.com`.
- So FCC cannot do the conversion. It can:
  - accept `editor.torn.com` URLs as they are;
  - flag a URL that is plainly a page rather than an image (Drive, Dropbox and
    Imgur page links, no image extension);
  - tell the player to upload through Torn's own Insert Image.

**Unknown.**
- Whether a direct external image URL renders after save, for example an
  `i.imgur.com/....png` or a GitHub raw PNG.
- Whether Torn rehosts external images on save.

## Q4. The colour variables

Owner-observed, **dark mode only**. There are 17 text colours. Their values
match the Open Color palette (shades 2 to 5):

| Variable | Dark value | Variable | Dark value |
|---|---|---|---|
| `--te-text-color-blue` | `#a5d8ff` | `--te-text-color-lime` | `#a9e34b` |
| `--te-text-color-cyan` | `#99e9f2` | `--te-text-color-orange` | `#ffa94d` |
| `--te-text-color-grape` | `#e599f7` | `--te-text-color-pink` | `#faa2c1` |
| `--te-text-color-gray1` | `#ffffff` | `--te-text-color-red` | `#ff8787` |
| `--te-text-color-gray2` | `#dddddd` | `--te-text-color-teal` | `#63e6be` |
| `--te-text-color-gray3` | `#aaaaaa` | `--te-text-color-violet` | `#d0bfff` |
| `--te-text-color-gray4` | `#888888` | `--te-text-color-yellow` | `#ffd43b` |
| `--te-text-color-gray5` | `#000000` | `--te-text-color-green` | `#8ce99a` |
| `--te-text-color-indigo` | `#bac8ff` | | |

- **Why variables beat hex.** The variable resolves per theme. A post coloured
  `var(--te-text-color-red)` stays readable in a reader's light or dark mode.
  A hex colour is fixed: `#ff8787` on Torn's light background is pale, and
  gray1 `#ffffff` would vanish.
- That is why the toolbar emits variables. It is also why
  `docs/forum-post.md`'s hex colours should become variables before posting.
- The editor's other `--te-*` variables style its own chrome: background,
  buttons, tooltips. They are not for post content.
- **Unknown:** the light-mode values.

## Q5. Torn PDA

- **Public docs.** Torn PDA (Manuito83/torn-pda, at 2026-10-02) has no posting
  flow of its own. It shows Torn's web page in a webview.
  - `lib/providers/userscripts_provider.dart:352` rewrites curly quotes across
    the whole script source.
  - It wraps the script in `(function(){ ... }())` in the page context.
  - So the page's `window.tinymce` and jQuery would be reachable from the
    script without `unsafeWindow`. This is inferred, not run.
- **Unknown, owner to check:**
  - whether the mobile page uses the same TinyMCE editor;
  - whether the clipboard and Torn's code view work in PDA.

## What remains unknown

1. What Torn's server strips on save. Test: post the toolbar test to a thread
   the owner controls, then read it back through the API (`forum/{id}/posts`,
   raw content). The API is the sanctioned channel.
2. TinyMCE's configured `valid_elements`, `valid_styles` and paste options. The
   committed probe now reads them with `editor.options.get(...)`.
3. The light-mode values of the 17 colour variables.
4. Whether an editor-API insert (`tinymce.get(id).insertContent(html)`) reaches
   Torn's state, so that Post sends it. TornTools' comment suggests a plain DOM
   write does not.
5. Whether external direct image URLs survive save and render.
6. Whether Torn adds `table-wrap` on save.
7. Torn PDA's editor, clipboard and code view.
8. Where Torn keeps its per-thread unsent body.
9. Whether pasting HTML into Torn's code view keeps every style.
