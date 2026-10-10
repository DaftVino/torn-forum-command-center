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
3. **A plain paste strips every inline style, but a marked paste keeps them.**
   - Torn configures `paste_webkit_styles: 'none'`, so pasting rich HTML from
     another page loses colours, sizes, alignment and underline.
   - TinyMCE exempts content marked `<!-- x-tinymce/html -->` from that filter,
     because it treats it as its own.
   - Owner-observed (test B): a synthetic `paste` event carrying marked HTML,
     dispatched at the editor body, kept every style. Torn's code-view mirror
     updated too.
   - That route needs no page globals, so no `unsafeWindow`. It writes only to
     the reply box ADR 0001 already names.
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
  - **Synthetic paste, marked TinyMCE-internal (test B).** Owner-observed: every
    style kept (`text-align`, a colour variable, `font-size`, underline,
    `strong`), and Torn's code-view mirror updated.
  - **TinyMCE's `insertContent` (test C).** Owner-observed: the same result. It
    needs the page's `tinymce` global, which a Tampermonkey script with grants
    reaches only through `unsafeWindow`.
  - **Test A** (synthetic plain paste) was not run. Check 3a's real plain paste
    already showed the stripping.
  - **Not yet observed:** pressing Post after B, so it is unproven that the
    server receives B's content. The mirror updating is strong evidence that
    Torn's state saw the change.
- **Torn persists an unsent editor body per thread.** Owner-observed: content
  pasted in 3a came back after page refreshes until the owner moved to another
  thread.
  - The configured plugins include TinyMCE's `autosave`, which keeps drafts in
    `localStorage`. That is the likely mechanism; inferred, not confirmed.
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
underline went too: no element in the pasted body has a `style`. The cause is
Torn's configuration, `paste_webkit_styles: 'none'`, which the light-mode probe
read directly.

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

### The editor's configuration (owner-observed, light-mode probe)

Read with `tinymce.get(id).options.get(...)`:

| Option | Value |
|---|---|
| `plugins` | `autosave, autolink, table, lists`, plus Torn's own `PasteCleanupPlugin`, `EmbedYoutubePlugin`, `ProcessImagePlugin` and `PreserveFormattingPlugin` |
| `valid_elements` | not set, so TinyMCE 6's default HTML5 schema applies |
| `extended_valid_elements` | `i[class]` |
| `invalid_elements`, `valid_styles` | not set, so the editor itself allows any inline style |
| `paste_webkit_styles` | `none` |
| `paste_remove_styles_if_webkit` | `true` |
| `paste_data_images` | `true`: a pasted image file is accepted, and is presumably uploaded |
| `font_size_formats` | `8pt 10pt 12pt 14pt 18pt 24pt 36pt` |
| `color_map` | 22 entries, unread (they printed as objects) |

- The toolbar is Torn's own React toolbar. TinyMCE's toolbar is off.
- Its Change Font Size emitted `px` sizes in the toolbar test (10px, 18px), not
  the `pt` list above.
- `EmbedYoutubePlugin` suggests YouTube embeds are supported; the markup is
  unknown.

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

**Owner-observed config.** Torn ships its own `ProcessImagePlugin`, and
`paste_data_images` is on. Whether that plugin rehosts external images on
`editor.torn.com` is what test D asks.

**Unknown.**
- Whether a direct external image URL renders after save, for example an
  `i.imgur.com/....png` or a GitHub raw PNG.
- Whether Torn rehosts external images on save.

## Q4. The colour variables

Owner-observed in both themes. There are 17 text colours. The values come from
the Open Color palette: light shades in dark mode, deep shades in light mode.

| Variable | Light | Dark |
|---|---|---|
| `--te-text-color-red` | `#f03e3e` | `#ff8787` |
| `--te-text-color-pink` | `#d6336c` | `#faa2c1` |
| `--te-text-color-grape` | `#ae3ec9` | `#e599f7` |
| `--te-text-color-violet` | `#7048e8` | `#d0bfff` |
| `--te-text-color-indigo` | `#4263eb` | `#bac8ff` |
| `--te-text-color-blue` | `#1c7ed6` | `#a5d8ff` |
| `--te-text-color-cyan` | `#1098ad` | `#99e9f2` |
| `--te-text-color-teal` | `#0ca678` | `#63e6be` |
| `--te-text-color-green` | `#37b24d` | `#8ce99a` |
| `--te-text-color-lime` | `#66a80f` | `#a9e34b` |
| `--te-text-color-yellow` | `#e67700` | `#ffd43b` |
| `--te-text-color-orange` | `#d9480f` | `#ffa94d` |
| `--te-text-color-gray1` | `#333333` | `#ffffff` |
| `--te-text-color-gray2` | `#666666` | `#dddddd` |
| `--te-text-color-gray3` | `#999999` | `#aaaaaa` |
| `--te-text-color-gray4` | `#cccccc` | `#888888` |
| `--te-text-color-gray5` | `#ffffff` | `#000000` |

- The grays are relative to the page, not absolute:
  - gray1 is the strongest text in both themes;
  - gray5 is the page background colour in both themes, so text in it is
    invisible.
- The palette order above follows Open Color's hue wheel. Torn's picker order
  is unknown.

- **Why variables beat hex.** The variable resolves per theme. A post coloured
  `var(--te-text-color-red)` stays readable in a reader's light or dark mode.
  A hex colour is fixed: `#ff8787` on Torn's light background is pale, and
  gray1 `#ffffff` would vanish.
- That is why the toolbar emits variables. It is also why
  `docs/forum-post.md`'s hex colours should become variables before posting.
- The editor's other `--te-*` variables style its own chrome: background,
  buttons, tooltips. They are not for post content.

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

1. What Torn's server strips on save. Test: post a sample to a thread the owner
   controls, then read it back through the API (`forum/{id}/posts`, raw content).
   The API is the sanctioned channel. Until then, FCC emits only constructs the
   published sample proves survive a save.
2. Whether Post sends what test B inserted. The code-view mirror updating is
   strong evidence, not proof.
3. Whether `ProcessImagePlugin` rehosts external images (test D), and whether
   external direct image URLs render after save.
4. Whether Torn adds `table-wrap` on save.
5. Torn PDA's editor, clipboard and paste handling.
6. YouTube embed markup (`EmbedYoutubePlugin`).
7. The 22-entry `color_map` and Torn's picker order.
