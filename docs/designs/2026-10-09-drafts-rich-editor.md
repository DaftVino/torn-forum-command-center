# Drafts rich editor (#58)

**Status:** brief. Research comes first; there is no spec and no plan yet.
**Owner request:** 2026-10-09.
**Issue:** #58.

## The request

The Drafts view already holds local reply drafts, autosaves the reply box, and
offers Insert (into Torn's reply box) and Copy. The owner wants it to grow into
a real post editor. A player should be able to write a well-formatted Torn
forum post without ever writing HTML.

The owner's starting ideas, explicitly "just the starting ideas":

- text colours: Torn's standard colours, plus custom colours as an option;
- tables that align correctly when posted;
- links;
- alignment;
- quote boxes;
- an image adder that takes an https URL and converts it to the format Torn
  needs;
- an option to write in Markdown and convert it to Torn's format.

The aim is richer than a toolbar of tags. It should improve the posting
experience in any way it can, building on what Drafts already does.

## Reference input

`docs/reference/torn-forum-post-sample.html` is a real published post, supplied
by the owner, whose tables Torn renders correctly. Its header comment lists the
conventions it shows. The most consequential is that colours are Torn editor
variables (`var(--te-text-color-green)`), not hex. The `--te-` prefix suggests
Torn's forum uses a rich text editor rather than a plain textarea.

`docs/forum-post.md`, FCC's own post from #49, uses hex colours and bare
`<table>` markup. It has not been posted yet, and the research may show it
needs Torn's conventions too.

## Research questions (answer before designing)

1. **Is Torn's reply box a textarea or a rich editor?**
   - FCC finds `textarea[name="postText"]` and its fallbacks (around line 4501
     of the userscript, `findReplyBox`) and sets the value React's way.
   - If the visible editor is contenteditable, what does inserting HTML into
     it do?
   - How does the editor map onto the textarea, if one exists?
   - Answer this from the owner's own browser and DevTools, never from
     automation (see Constraints).
2. **What does Torn keep, and what does it strip?** Which tags and inline
   styles survive posting: colour variables against hex, font sizes,
   alignment, tables, `blockquote` or a quote class, `img`, links. Is there an
   allowlist?
3. **How do images work?** Is there a required host or a proxy format? This is
   what "convert the https to the proper format" refers to; establish what the
   proper format is.
4. **What is the full set of colour variables?** The sample uses
   `--te-text-color-green`, `-blue` and `-red`. List them all, and how they look
   in Torn's light and dark modes.
5. **Does Torn PDA's posting flow differ?**

## Constraints already known

- **ADR 0001.** FCC touches Torn's page in exactly two places: the mount
  container and the reply box. An editor inside FCC's own panel adds no DOM
  path. Changing how the reply box is found or written, for example to target
  a contenteditable, changes one of those two points and needs an ADR if the
  shape changes.
- **No automation on torn.com.** Torn's scripting rules risk a game ban.
  Research means the owner inspects their own browser and shares what they
  find, plus public documentation. Never drive a browser on torn.com.
- **The source is ASCII only** (`tests/metadata.test.js`). Any non-ASCII output,
  such as emoji or typographic punctuation, is written as escapes.
- **Read-only toward the account.** FCC never posts. The editor produces
  markup and Insert/Copy hands it over; the player presses Torn's Post button.
- **Narrow layout.** The Drafts view has to work in Torn PDA at 320px, following
  section 14 of `docs/superpowers/specs/2026-10-09-mobile-condense-design.md`.
- **Never read the userscript whole**; it is about 355KB. Use
  `docs/code-map.md`.

## Handoff log

### 2026-10-09 -- implementation waves through v0.2.2; editor brief opened

**Branch and what merged.**
- Everything is on `main`.
- Released `v0.2.2` (245d856, PR #57), after `v0.2.1` (a6506f5, PR #55) and
  `v0.2.0` (e19c9aa, PR #51).

PRs merged this session, all squash:

| Work | PRs |
|---|---|
| Six features | #22 auto-hide, #23 My posts, #25 rows cap, #26 author-only, #27 reactions, #28 badges |
| Follow-ups | #31, #32 |
| Mobile condense design | #34, #37 |
| Narrow layout | #38 |
| Narrow polish | #40, #42, #44, #46, #48 |
| Docs and forum post | #50 |
| README screenshots | #52 |
| Reactions pill and light logo | #54 |
| Match Torn default theme | #56 |

**What shipped.** `npm test` went from 309 to 1023 tests. The mutation check
guards 420 of 420 promises.

**What the plans got wrong (do not revert).**
- `isRecoveredValue` forgives only missing top-level fields.
  `isRecoveredOrganizer` (#4) and `canonicalClaims` (#47) cover the nested
  cases. A tidy-only change on load is a silent recovery, not damage.
- The wide-parity golden (`tests/fixtures/wide-golden.json`) is never
  regenerated. Each wide change is an exact-line entry in a
  `tests/wide-*-diffs.js` list. The version footer follows `@version` through
  `tests/wide-release-diffs.js`.
- Built-in Unfiled's collapse/order key is `"unfiled"`, and a folder's key is
  `"folder:<id>"`. A legacy folder whose id is literally "unfiled" depends on
  this.
- Match Torn resolves to the `tfcc-theme-light` or `tfcc-theme-dark` class
  before the class is applied, so per-theme tokens cover it. A diff-only review
  flagged this wrongly twice.

**What was discovered.**
- The Codex CLI sandbox (`-s read-only` or `workspace-write` with `-C`) fails on
  this Windows machine with "setup refresh had errors". Pipe the material on
  stdin with `--skip-git-repo-check` and ask for files as delimited text.
- gstack browse (`~/.claude/skills/gstack/browse/dist/browse.exe`) renders the
  local `preview/*.html`:
  - `viewport WxH`, `load-html`, and `eval <file.js>` work;
  - `screenshot --clip x,y,w,h` crops;
  - `screenshot "#tfcc-panel"` captures the panel element.
- Subagents share this session's scratchpad and can overwrite each other's
  scripts there. Give shared scripts distinct names.

**What is still open.**
- **Owner:** whether Torn's `rating` is net or likes-only. Checking it needs a
  topic post with at least one dislike.
- **Owner:** host the five forum-post images publicly, and fill the `{{...}}`
  placeholders in `docs/forum-post.md` before posting.
- **Owner:** upload v0.2.2 to Greasy Fork.
- Deferred: #35 (takeover-only bottom dock) and #36 (Catch up selection mode).

**Next phase.** This brief: research Torn's forum editor, then brainstorm, spec,
plan and build the Drafts rich editor (#58). The read manifest is in
`docs/designs/next-session-prompt.md`.

### 2026-10-10 -- Drafts rich editor built (#58); docs and verification done

**What shipped (on `feat/58-drafts-editor`, not yet merged).**
- The Drafts editor: Text, MD, HTML and Preview modes with lossless
  conversion; a toolbar; the image link fixer; free drafts; the Default editor
  setting; size limits that refuse rather than cut.
- Insert and autosave now use Torn's reply editor (#60) through one marked
  paste event, per ADR 0002 (Accepted, which amends ADR 0001's access point).
- `npm test` went from 1023 to 1114 tests. The mutation check guards 440 of
  440 promises.
- No version bump; the CHANGELOG entry is under `[Unreleased]`.

**What was discovered.**
- Built differently from the plan: the mode pill and emoji tabs use class
  `tfcc-modes`, the pane `tfcc-draft-editor`; the Preview light/dark switch is in
  the Preview bar; the over-limit notice ends "or keep it as it is"; typing or
  pasting at the limit shows a one-time notice; Markdown links percent-encode
  parentheses and spaces; image links refuse unsafe hosts and percent-encode
  parentheses. The spec is amended for the first three.
- forum-post.md had one hex colour (#5C768F); it is now
  `var(--te-text-color-gray2)`, the nearest of Torn's variables.

**What is still open (owner QA, blocks the release).** Spec section 9 items 1 to
6, now in `docs/qa-checklist.md` under "Drafts editor (#58)": live Insert and
Post on a reply and a new thread; Torn PDA; Copy then paste; v0.2.2 data loads
clean; 320px in PDA; fixed image links (Drive, Dropbox, Imgur JPG and GIF,
GitHub, Gyazo). README screenshots of the editor are not taken.

PR: to be opened.
