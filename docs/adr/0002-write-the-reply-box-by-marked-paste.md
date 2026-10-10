# ADR 0002: Write Torn's reply box with a marked paste event

**Status:** Proposed. It is accepted when the #58 implementation merges.
**Date:** 2026-10-09
**Amends:** ADR 0001's reply-box access point. It changes the shape, not the
count. FCC still touches Torn's page in exactly two places.

## Context

ADR 0001 confines DOM access to two places: the mount container and "finding
the reply textarea". FCC found the textarea with `textarea[name="postText"]`
and broad fallbacks. It wrote the textarea through the native value setter and
a bubbling `input` event, and autosave listened to it.

Research for #58 found that this no longer matches Torn's page:
`docs/reference/torn-forum-editor-findings-2026-10-09.md`, owner-observed in
DevTools.

- **Torn's reply box is TinyMCE 6.8.5 in inline mode:** a contenteditable
  `div.editor-content.mce-content-body` inside `#editor-wrapper`.
  - There is no `postText` textarea.
  - The broad fallbacks matched a hidden Report reason textarea instead, so
    Insert wrote there and reported success (#60).
- **Torn configures `paste_webkit_styles: 'none'`,** so ordinary pasted HTML
  loses every inline style.
- **The editor accepts formatted content three ways,** with every style kept
  and Torn's own state updated:
  - **A synthetic `paste` event** whose HTML starts with TinyMCE's
    internal-content marker `<!-- x-tinymce/html -->` (test B).
  - **TinyMCE's `insertContent` API** (test C).
  - **Writing `innerHTML` then firing jQuery `keyup` from page context**, as
    TornTools does.

## Decision

FCC finds the reply box as `#editor-wrapper .editor-content.mce-content-body`.
It drops every textarea selector.

**Writing:**
1. Move the selection to the end of that element with a `Range`.
2. Dispatch one `ClipboardEvent('paste')` at it. The event carries the cleaned
   post as marker-prefixed `text/html`, plus `text/plain`.

**Success** is `dispatchEvent` returning `false`, because TinyMCE called
`preventDefault`, and the element's HTML having changed. Anything else falls
back visibly to Copy.

**Reading:** autosave reads the element's `innerHTML` on `input`, cleaned by the
same allowlist as everything else.

The paste replaces the `input` event as the script's single synthetic event.
`tests/read-only.test.js` keeps asserting there is exactly one.

## Alternatives considered

**TinyMCE's `insertContent`.** It is the cleanest API and was verified in test
C. Rejected:
- In Tampermonkey it needs the page's `tinymce` global, which means adding
  `@grant unsafeWindow`.
- That widens the security surface (CLAUDE.md constraint 9) and hands the page
  the script's context.
- The paste route reaches the same result through the DOM alone.

**`innerHTML` plus jQuery `keyup`,** TornTools' way. Rejected:
- It needs page-context jQuery, which brings the same `unsafeWindow` problem.
- It bypasses TinyMCE's own model and undo.
- TornTools' comment records that a native event was not enough.

**Copy only, never Insert.** No write path at all. Rejected:
- A plain paste of rich HTML is stripped of styles, so the player would have to
  use Torn's code view by hand: three more steps on a phone.
- Copy remains as the fallback.

## Consequences

**Easier:**
- One tap puts a formatted post into Torn's editor, with no new `@grant` and no
  page globals.
- #60's wrong write is gone, because no textarea selector remains.

**Harder:**
- The write depends on TinyMCE's internal-content marker and its paste handler.
  Both are TinyMCE behaviour, not a Torn API, and could change with a TinyMCE
  upgrade.
- The failure is detected and visible, and Copy covers it.
- A synthetic paste in Torn PDA's webview is unverified until release QA.

**Revisit if:**
- Torn replaces TinyMCE;
- the marker stops exempting styles;
- PDA's webview refuses synthetic paste events;
- or Torn publishes a supported way to prefill a post.
