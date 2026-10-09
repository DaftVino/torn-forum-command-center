# Mockups for #33: condense the narrow mobile view

These are static design mockups. Nothing here is loaded by the userscript.
The spec is `docs/superpowers/specs/2026-10-09-mobile-condense-design.md`.

| File | What it shows |
|---|---|
| **`revised-375.html` / `.png`** | **The current recommendation, task-first A (after the Codex review), at 375px.** Dark and light: Threads at rest, Catch up with the one-tap Read, Catch up with one drawer open, filters open, badge shelf open, Threads with one drawer open, My posts with the reaction totals, collapsed with a text Show |
| **`revised-320.html` / `.png`** | **The same frames at 320px**, plus a 200% text frame |
| `current-375.png`, `current-320.png` | Today's panel, from `tests/render-preview.mjs` (`threads-narrow.html`) at 375px and 320px viewports |
| `concept-a-toolbar-drawer.html` / `.png` | A: one-line header, four-cell nav with More, filter line, per-row "..." drawer. 375px; dark at rest, light with More and a drawer open, dark with filters open |
| `concept-b-thumb-dock.html` / `.png` | B: views in a sticky bottom dock (takeover), tap-to-expand rows with an icon grid. 375px; dark and light |
| `concept-c-inbox-select.html` / `.png` | C: view switcher, inbox rows with select boxes, contextual bulk action bar. 375px; dark at rest, light with two rows selected, dark with the view menu open |
| `recommended-320.html` / `.png` | The first-draft recommendation (A) at 320px, superseded by `revised-*`; kept for the record |
| `build-mockups.mjs` | Regenerates all six HTML files: `node docs/designs/mockups/33-mobile/build-mockups.mjs` |

The concept files and `recommended-320` are the first draft that the Codex review
(`docs/records/review/2026-10-09-mobile-condense-codex.md`) assessed. They are kept
for history.

The pink dashed line marks roughly one screen of Torn PDA web view (560px from
the top of the frame).

The mockups reuse the panel's real colour tokens, logo, karma icon and class
names. The `m-*` classes are the proposal. All files are ASCII.

To redo the screenshots, use gstack browse: `viewport 1210x1300`,
`load-html <file>`, then `screenshot <file>.png`. For the 320px file use
`viewport 1040x1300`. For `revised-375` use `viewport 2040x2800`, and for
`revised-320` use `viewport 1760x3400`.
