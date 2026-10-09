# Codex adversarial review: implementation plan for #33 (condense the narrow mobile view)

- **Model:** gpt-5.6-sol (Codex)
- **Effort:** high
- **Inputs:** `docs/superpowers/plans/2026-10-09-mobile-condense.md` as of commit 78a7e02 (the first plan), `docs/superpowers/specs/2026-10-09-mobile-condense-design.md`, and the code in the plan's worktree (`torn-forum-command-center.user.js`, `tests/`, `CLAUDE.md`).
- **Verdict:** rework.
- **Resolutions:** see "Plan review resolutions" in the plan.

The review follows verbatim. Only its typographic punctuation was converted to ASCII (dashes, curly quotes and arrows).

---

## Findings

- **Blocker** -- `docs/superpowers/plans/2026-10-09-mobile-condense.md:3954-3980,3890-3899`; `CLAUDE.md:52-55`. The 300ms timer starts on `pointerdown`, so a 301ms press flushes and replaces the target before its click. The test repeats the repository's explicitly condemned pattern by advancing time using `PRESS_FLUSH_MS`, so changing the constant cannot fail it. Start the no-click timer only after `pointerup`, assert the literal 300ms contract, and test that holding past 300ms while still down does not redraw.

- **Blocker** -- plan Task 14 lines `4001-4013`; current `torn-forum-command-center.user.js:5839-5842`. A dirty input followed by tapping a thread link holds the change redraw, but the link branch then calls `flushAfterPress()` synchronously. That defeats the existing deliberate deferred redraw and may remove the anchor before browser navigation. Never synchronously flush a thread-link click; reuse its zero-delay post-dispatch redraw and test dirty-input + plain thread-link navigation + auto-hide.

- **Major** -- plan Task 6 lines `1395-1408`, Task 12 lines `3459-3471`; test lines `1290-1304`; current source `torn-forum-command-center.user.js:5818,5852`. Crossing the breakpoint immediately clears `drawerEdit`. If an async refresh then completes before blur, its forced redraw can destroy the only typed value. The rotation test uses a detached dummy input and never types, commits, or verifies persistence. Preserve the edit mirror until commit, stop forcing background redraws through the caret guard, and test input -> rotation -> refresh completion -> blur.

- **Major** -- plan Task 1 lines `148-172,253-281`. The "wide byte-identical" golden captures complete markup only for Threads/capped/collapsed. Search, Drafts, Settings, Catch up and My posts capture only `renderNav` and synthetic `renderRow` calls. The CSS test also permits arbitrary new unscoped wide rules. A broken wide Settings panel or global `#tfcc-panel button` rule passes. Snapshot every complete wide view and require new CSS to be `.tfcc-narrow`-scoped except an explicit 13d whitelist.

- **Major** -- plan Task 13 lines `3755-3763`. `lastRender` is updated even when `renderPanel` deferred the rewrite. The recorded IDs can describe the new model while the DOM still contains the old rows, corrupting later next/previous focus decisions. Update `lastRender` only after an actual rewrite, and add a deferred-redraw test where the focused row disappears.

- **Major** -- plan Task 13 lines `3798-3803`. Every `change` captures focus intent from the changed element. Keyboard-tabbing out of a note/tag field can redraw and force focus back into that field instead of the newly focused control. Do not restore focus to blur-committed text fields; test Tab navigation out of both drawer inputs.

- **Major** -- plan Task 8 lines `1861-1969`, Task 17 lines `4474-4482`; spec section 13d. The info audit is self-referential: it iterates production `INFO_KEYS_BY_VIEW`. Removing `settings-folders`, `settings-autohide`, `settings-author`, `settings-rows`, `settings-badges`, or Search from both constants and rendering can pass. Assert the literal owner-approved key map and verify every section-13d paragraph is hidden/visible as prescribed; add mutations for each audited item.

- **Major** -- plan Task 13 lines `3657-3675`. The ADR gate begins recording only after bootstrap and accepts any selector merely starting with `[data-act=`. An init-only Torn selector, or `[data-act="x"] .torn-row`, passes. No proposed runtime read currently violates ADR 0001, but this test does not prove that. Instrument `document.querySelector` before script loading and use an exact selector whitelist or static call-site audit.

- **Major** -- plan Task 7 lines `1790-1815`; current `torn-forum-command-center.user.js:5997-6016`. `reset-all` replaces `state.settings` directly, changing Settings to Threads without `setView`; `filtersOpen` can survive the view change. Route every settings replacement through a transient reset and add a reset-all state test.

- **Major** -- spec section 13b line `889` says collapsed 320px is 36.5px, while plan tests require 38.5px at lines `629,2369-2371`. The plan's ambiguity list does not resolve this contradiction despite declaring section 13 authoritative. Amend the spec with owner confirmation or implement 36.5px. Also, Task 16 claims to check header height but lines `4324-4335` never do; expanded logo/chip wrapping can pass. Add a real expanded-header height assertion.

- **Minor** -- plan Task 9 changes only the normal `panelHtml` header. Current early loading/fatal branches at `torn-forum-command-center.user.js:5371-5378` still render `renderHeadId` rather than the narrow icon header. Branch those states too, or explicitly exclude them from the goal and tests.

- **Minor** -- plan Task 8 line `2118` retains "only the selections this script uses" to satisfy an old test, while section 13d item 16 specifies "only this script's selections." Product copy should not be chosen to avoid updating a test. Use the owner text and update the semantic test.

- **Minor** -- the request-budget implementation at plan lines `2124-2131` is correctly computed and tested at two lookup settings. The QA text at lines `4619-4621` nevertheless hardcodes 13/17 without saying "at defaults," so it becomes false after the user changes the lookup setting. Qualify that checklist line.

## Specific decisions

- **"Public Only" test loosening:** Accept. Section 13d explicitly shortens the nearby note, while `tests/style.test.js:223-228` continues pinning "Public Only does not" in the visible ToS row and the complete key section. Keep a direct assertion on that row.
- **300ms press timer:** Reject. The proposed lifecycle loses slow/long taps, and its test is self-referential.

No ASCII defect was found in the proposed userscript code blocks; they are ASCII-only. The pure engine additions likewise contain no DOM, clock, timers, `state`, or `GM_*` access.

## Ranked top 5

1. Fix the pointer timer and its self-referential test.
2. Prevent synchronous redraw during thread-link click dispatch.
3. Preserve dirty input across breakpoint plus asynchronous redraw.
4. Replace the incomplete wide-parity golden.
5. Fix deferred-render/focus bookkeeping and keyboard focus restoration.

**Verdict: rework.**