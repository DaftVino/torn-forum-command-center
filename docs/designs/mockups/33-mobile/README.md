# Mockups for #33: condense the narrow mobile view

These are static design mockups. Nothing here is loaded by the userscript.
The spec is `docs/superpowers/specs/2026-10-09-mobile-condense-design.md`.

| File | What it shows |
|---|---|
| **`revised-375.html` / `.png`** | **The approved design (task-first A plus the owner's 2026-10-09 decisions) at 375px.** Dark and light: Threads at rest; Catch up with the one-tap Read and its info button closed, then open with a drawer open; filters open; badge shelf open; Threads with a drawer open; My posts with the reaction totals, info closed and open; collapsed with a text Show. The header is one line, with icon buttons sized by `fitHeader` (an inline script in the file). Nav counts are numbers only |
| **`revised-320.html` / `.png`** | **The same frames at 320px**, plus a 200% text frame and four 280px frames (Threads dark and light, collapsed, Catch up with info open) proving the header stays on one line |
| **`nav-count-variants.html` / `.png`** | The nav block only: the count as a large numeral behind a one-line label, in four contrast treatments (v1 tint, v2 ghost, v3 halo, v4 legible). Each is shown dark and light at 375, 320 and 280px, with a selected cell, a zero count, the no-count cells and 3-digit counts. The measured contrast (label and numeral) is printed under each block by an in-page script. Spec section 13f |
| **`nav-variants-in-panel.html` / `.png`** | A quick comparison: the four nav variants side by side, each in a full revised panel (header, nav, filter line and 4 rows) at 375px, with a dark row and a light row. Threads 16 is selected, with Catch up 3, Drafts 0 and My posts 128. The contrast figures are in `nav-count-variants` |
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
`viewport 1040x1300`. For `revised-375` use `viewport 2040x3700`, and for
`revised-320` use `viewport 1760x5300`.
