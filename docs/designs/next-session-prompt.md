# Next session -- paste this into a fresh chat

> Delete this file in the first commit of the Drafts rich editor work; it is a launch pad, not a document.

## Start here

Run `/orient` before anything else, including clarifying questions. Then
research Torn's forum text editor and design the Drafts rich editor (#58): a
real editor in the Drafts view so players can write formatted Torn posts without
writing code.

## Read first

Read nothing else until you have these, in order:

1. `docs/designs/2026-10-09-drafts-rich-editor.md` (6.7K) -- the phase contract. It holds the owner's request, the five research questions to answer before designing, the known constraints, and the handoff log for everything shipped through v0.2.2.
2. `docs/reference/torn-forum-post-sample.html` (4.1K) -- a real published post the owner supplied, whose tables Torn renders correctly. Its header lists the markup conventions it shows: `var(--te-text-color-*)` colors, the `table-wrap` divs, `<p>&nbsp;</p>` spacers, `target="_blank" rel="noopener"`.
3. `docs/adr/0001-read-the-torn-api-not-the-forum-dom.md` (3.9K) -- FCC touches Torn's page in exactly two places, the mount and the reply box. An editor inside the panel adds no DOM path, but changing how the reply box is found or written changes one of the two.
4. `docs/code-map.md` (63.1K) -- read it in slices, never whole. Grep it for `findReplyBox` (line 274), `insertDraft` (275) and `renderDraftsView` (329). Then read the userscript at those anchors with offset/limit.
5. `docs/superpowers/specs/2026-10-09-mobile-condense-design.md` (101.4K) -- read section 14 only (from line 1156), by anchor. It defines the narrow layout rules the Drafts editor must meet at 320px in Torn PDA.
6. `tests/drafts.test.js` (5.1K) -- what Drafts already promises: local drafts, reply-box autosave, Insert/Copy. The editor builds on these and must not break them.

## Branch

`main` -- everything is on it: the v0.2.2 release (245d856), the editor brief, the sample post, and a fresh code map. Cut the research and spec work from `main` as `docs/58-editor-research`, and the implementation as `feat/58-drafts-editor`. Never cut one from the other.

## Constraints

- Never read `torn-forum-command-center.user.js` whole (about 355K). Use the code map, then offset/limit slices. Give every agent this rule.
- Never automate a browser on torn.com, because Torn's scripting rules risk a game ban. Research Torn's editor through the owner's own browser and DevTools (ask them for screenshots, the editor's DOM, or a saved post's stored HTML) and through public documentation. gstack browse is for the local `preview/*.html` files only.
- The userscript source is ASCII only (`tests/metadata.test.js`). Emoji, arrows and typographic punctuation the editor emits are written as JS escapes.
- FCC never posts. The editor produces markup, and Insert/Copy hands it to the player, who presses Torn's Post button. `tests/read-only.test.js` enforces no navigation, no `.click()` and no form submission.
- Do not revert these; they are binding from earlier phases:
  - wide-parity changes are exact-line entries in a `tests/wide-*-diffs.js` list, and the golden is never regenerated;
  - `isRecoveredValue`, `isRecoveredOrganizer` and `canonicalClaims` make an upgrade with new or tidied fields silent, not "damaged";
  - Match Torn resolves to the `tfcc-theme-light` or `tfcc-theme-dark` class.
- A new setting or stored field must load from an older blob without a damage notice. Prove it with a test.
- No version bump in a feature PR; add only an `[Unreleased]` CHANGELOG entry. A release is its own `chore(release)` PR, and the tag goes on the merged commit.
- No attribution footer on any commit or PR.

## Exit criteria

- The research findings are recorded in a committed `docs/reference/torn-forum-editor-findings-<date>.md`. It answers the brief's five questions, each marked "owner-observed" or "public docs", and lists what remains unknown.
- A spec exists in `docs/superpowers/specs/` and a plan in `docs/superpowers/plans/`. The plan has had an adversarial review, recorded under `docs/records/review/`. If the reply-box access point changes shape, an ADR is committed under `docs/adr/`.
- `npm test` passes (the suite is at 1023 now). If code changed, so do `npm run test:syntax` and `node tests/mutation-check.mjs > mutation.log 2>&1`, with the log read and every promise guarded.

## Unknowns and risks

- The central unknown: FCC finds the reply box as `textarea[name="postText"]`, but the sample's `--te-` color variables suggest Torn's visible editor is a rich editor. Whether inserted HTML survives, and how, decides the whole design. Only the owner's own browser can answer it.
- What Torn strips on save, the image format the owner calls "the proper format", and the full list of `--te-text-color-*` variables are all unverified.
- `docs/forum-post.md` uses hex colors and bare tables. The research may show it needs Torn's conventions before it is posted.
- Owner gates still open from the last session:
  - upload v0.2.2 to Greasy Fork;
  - host the forum-post images and fill the placeholders;
  - settle whether `rating` is net or likes-only (it needs a topic post with a dislike).
- Deferred and still open: #35 (takeover-only bottom dock) and #36 (Catch up selection mode).
- The untracked `.vscode/` folder is the owner's editor settings. It was left uncommitted on purpose and is not part of this work.
- The Codex CLI sandbox fails on this Windows machine ("setup refresh had errors"). For adversarial reviews, pipe the material on stdin with `codex exec ... --skip-git-repo-check -`.
