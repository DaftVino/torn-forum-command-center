# Mockups for #33: condense the narrow mobile view

These are static design mockups. Nothing here is loaded by the userscript.
The spec is `docs/superpowers/specs/2026-10-09-mobile-condense-design.md`.

| File | What it shows |
|---|---|
| `current-375.png`, `current-320.png` | Today's panel, from `tests/render-preview.mjs` (`threads-narrow.html`) at 375px and 320px viewports |
| `concept-a-toolbar-drawer.html` / `.png` | A: one-line header, four-cell nav with More, filter line, per-row "..." drawer. 375px; dark at rest, light with More and a drawer open, dark with filters open |
| `concept-b-thumb-dock.html` / `.png` | B: views in a sticky bottom dock (takeover), tap-to-expand rows with an icon grid. 375px; dark and light |
| `concept-c-inbox-select.html` / `.png` | C: view switcher, inbox rows with select boxes, contextual bulk action bar. 375px; dark at rest, light with two rows selected, dark with the view menu open |
| `recommended-320.html` / `.png` | The recommendation (A) at 320px; dark at rest, light with a drawer open, dark with More open |
| `build-mockups.mjs` | Regenerates the four HTML files: `node docs/designs/mockups/33-mobile/build-mockups.mjs` |

The pink dashed line marks roughly one screen of Torn PDA web view (560px from
the top of the frame).

The mockups reuse the panel's real colour tokens, logo, karma icon and class
names. The `m-*` classes are the proposal. All files are ASCII.

To redo the screenshots, use gstack browse: `viewport 1210x1300`,
`load-html <file>`, then `screenshot <file>.png`. For the 320px file use
`viewport 1040x1300`.
