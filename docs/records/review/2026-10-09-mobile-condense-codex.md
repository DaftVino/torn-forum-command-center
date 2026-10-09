# Codex adversarial review: condense the narrow mobile view (#33)

- **Model:** gpt-5.6-sol (Codex)
- **Effort:** high
- **Inputs:** `docs/superpowers/specs/2026-10-09-mobile-condense-design.md` as of
  commit a8cf608 (the first draft), plus the six PNGs then in
  `docs/designs/mockups/33-mobile/` (`current-375`, `current-320`,
  `concept-a-toolbar-drawer`, `concept-b-thumb-dock`, `concept-c-inbox-select`,
  `recommended-320`).
- **Verdict:** rethink.
- **Resolutions:** see "Review resolutions" in the spec.

The review follows verbatim. Only its typographic punctuation was converted to
ASCII (curly quotes, dashes, ellipses and the multiplication sign).

---

## Recommendation / Concept A

1. **Blocker -- the 44px claim is false.**  
   **Scenario:** An iPhone SE user at 320px taps Refresh, Expand, Hide, or a row's ellipsis. Those targets are 40x44, not 44x44; the badge's pseudo-element can overlap adjacent targets.  
   **Fix:** Use real 44x44 button boxes and a 44px badge button containing a smaller visual pill. Accept a two-line header at 320px if the arithmetic no longer fits.

2. **Major -- Catch up's primary action regresses from one tap to two.**  
   **Scenario:** A Pixel/Torn PDA user opens Catch up, then repeatedly taps `...`, waits through a redraw, and taps Mark read for every thread. Each read removes the row and shifts the list.  
   **Fix:** Keep a visible 44x44 Mark read button on Catch up rows. That view is explicitly a triage workflow.

3. **Major -- focus restoration fails when an action removes its row.**  
   **Scenario:** A TalkBack user opens row actions and activates Mark read in Catch up. The row disappears, so no matching `data-act="read" data-id=...` exists. Focus falls to the page or panel start.  
   **Fix:** Capture the row's successor before mutation and focus its title or Actions button. Define fallback order: same control -> next row -> previous row -> view heading.

4. **Major -- stale `openRowId` is not reconciled.**  
   **Scenario:** A user opens row A, then an automatic refresh archives, filters, or removes A. The drawer vanishes but `openRowId` remains. If A later returns, it can reopen unexpectedly.  
   **Fix:** After deriving visible rows, clear `openRowId` when its row is absent. Do the same after Mark read, archive, view changes, filter changes, and cap changes.

5. **Major -- editing can be destroyed by another redraw.**  
   **Scenario:** On iOS, the user opens A, types a note, then taps row B's `...` or Refresh. `innerHTML` replacement destroys A's input; the existing "pending redraw" guard does not specify dirty-value capture or drawer switching.  
   **Fix:** Mirror input values into state on every `input` event, or commit/cancel explicitly. Never redraw away a dirty editor without preserving its value and selection.

6. **Major -- moving Search and reactions into More is a real discoverability and tap-count regression.**  
   **Scenario:** A returning user who previously tapped Search or the reactions pill once now scans four tabs, guesses More, opens it, and selects the action. A new user cannot see that Search or Settings exist.  
   **Fix:** Keep Search directly visible. Give More a visible secondary label such as "Search, drafts, settings," and keep the reaction totals visible somewhere rather than hiding both the control and its information.

7. **Major -- selecting a More view produces another focus hole.**  
   **Scenario:** A VoiceOver user opens More and activates Drafts. The menu closes during redraw, so the original Drafts button no longer exists for restoration.  
   **Fix:** Move focus to the now-current More cell and announce "Drafts view." Specify this separately from generic selector-based restoration.

8. **Major -- the breakpoint watches the wrong thing.**  
   **Scenario:** On an 800px-wide tablet, Torn gives the injected panel a 300px column. `max-width:600px` does not fire, so the desktop controls wrap and overflow inside a phone-width panel.  
   **Fix:** Use a verified container query. If the target PDA WebView lacks support, use `ResizeObserver` on the panel's own mount/container, which ADR 0001 permits, and toggle a narrow class.

9. **Major -- 320px works only at default text size.**  
   **Scenario:** An iPhone user with larger text gets four fixed-width nav cells containing labels plus counts. "My posts" and "Catch up" wrap or clip inside a fixed 44px row; the packed header also wraps unpredictably.  
   **Fix:** Use `min-height`, not fixed height; test 200% text size and 320px reflow. Publish the actual supported zoom/text-size matrix.

10. **Major -- Hide becomes least discoverable exactly when it is most important.**  
    **Scenario:** A plain thread-link tap auto-hides the panel. When the user returns, the only recovery control is an unlabeled visual chevron; `title` is useless in a touch-only WebView.  
    **Fix:** Show visible text--at minimum "Show"--when collapsed. An accessible name alone does not help sighted touch users.

11. **Major -- the size savings are best-case figures, not task figures.**  
    **Scenario:** A 320px user opens filters or More, then a row drawer. The first thread is again pushed well below 165px, and an open drawer adds several hundred pixels. Catch-up triage repeatedly operates in that expanded state.  
    **Fix:** Report heights for at-rest, filters open, More open, shelf open, one drawer open, and common task sequences. Measure taps and scroll distance, not only closed-row height.

12. **Major -- the one-drawer rule is underspecified across panel state changes.**  
    **Scenario:** A user opens actions, follows a thread so the panel auto-hides, then returns and presses Show. The stale drawer may still be open. Rotation across the breakpoint can similarly resurrect hidden More/filter/drawer state.  
    **Fix:** Define an explicit state-transition table. Collapse, auto-hide, layout-mode changes, and navigation should close transient disclosures unless there is a deliberate reason to retain them.

13. **Major -- 40px ellipsis plus unread count still steals title width.**  
    **Scenario:** At 320px, a long title shares 270px with `12 new`, gaps, and a 40px button. The title still wraps heavily, and the tiny textual link--not the row--is the open-thread target.  
    **Fix:** Put unread and Actions on a compact metadata line, or make the safe non-action portion of the row activate the thread while keeping Actions a separate button.

14. **Minor -- the filter button lacks a specified accessible name.**  
    **Scenario:** TalkBack announces an icon or merely "1, button," giving no indication that it opens filters or that one filter is active.  
    **Fix:** Use a dynamic label such as "Filters, 1 active," with `aria-expanded`.

15. **Minor -- the chip pseudo-target is fragile.**  
    **Scenario:** The user taps between the badge and Refresh. An absolutely positioned `::after` may win hit testing over the visually adjacent control, depending on stacking and spacing.  
    **Fix:** Make the actual button 44px high and keep the small pill as an inner element; do not enlarge controls with overlapping pseudo-elements.

16. **Minor -- implementation scope is understated.**  
    **Scenario:** Tests pass because `data-act` strings remain, while focus fallback, stale state, dirty inputs, breakpoint transitions, disclosure exclusivity, and accessible announcements remain broken.  
    **Fix:** Treat this as a state-machine change, not "markup and CSS." Add interaction tests for every redraw and disappearance path.

## Concept B

1. **Blocker -- the sticky dock is unsafe inline.**  
   **Scenario:** In Torn PDA, an ancestor with `overflow` or `transform` changes the sticky containing block; the dock ends up halfway down the list or behind Torn's bottom UI.  
   **Fix:** Do not ship the dock inline. Restrict it to takeover only, with `safe-area-inset-bottom` handling and explicit testing against Android gesture navigation and iOS home indicators.

2. **Major -- the row disclosure is hidden and undersized.**  
   **Scenario:** A touch user taps the title expecting actions, opens the thread, and triggers auto-hide; the actual toggle is an unlabeled 24px metadata strip.  
   **Fix:** Use a visible 44px Actions button. Do not make metadata secretly interactive.

3. **Major -- two navigation systems will drift.**  
   **Scenario:** Search or Settings gains a badge or disabled state; the takeover dock is updated but the inline top navigation is not.  
   **Fix:** Render both from one view model and test parity, or avoid the dual layout.

## Concept C

1. **Major -- it optimizes bulk work by making every single-row action worse.**  
   **Scenario:** A user wants to pin one thread: tap checkbox, tap Pin, then Clear or deselect. A nearby title tap instead opens the thread and auto-hides the panel.  
   **Fix:** Keep per-row Actions; add selection only as an explicit Catch up mode.

2. **Major -- selection lifetime is undefined.**  
   **Scenario:** Select two rows, then refresh, filter, Show all, switch views, or open a thread. One selected row disappears, but the bar may still say "2 selected."  
   **Fix:** Define selection reconciliation and clear it on navigation. Announce removals and updated counts.

3. **Major -- bulk operations introduce partial-failure semantics.**  
   **Scenario:** Mark read succeeds for three threads but fails for two because data changed or request limits are reached. The proposal has no progress, retry, or error model.  
   **Fix:** Make bulk work a separate feature with per-item results, request-budget handling, and recovery tests.

4. **Minor -- 36px checkboxes miss the stated target.**  
   **Scenario:** A user with motor impairment repeatedly opens a thread while attempting to select it.  
   **Fix:** Give the checkbox/label a genuine non-overlapping 44x44 target.

## Ranked top five changes

1. Keep Mark read visible and one-tap in Catch up, with next-row focus after removal.
2. Replace the viewport breakpoint with container-aware behavior.
3. Use genuine 44x44 targets and allow an honest two-line 320px header.
4. Specify and test the complete redraw state machine, including stale rows, dirty inputs, focus fallbacks, collapse, and rotation.
5. Restore visible discovery for Search, Show, and reaction information; do not rely on More, icons, or `title`.

**Verdict: rethink.** The drawer pattern is salvageable, but the recommendation does not yet meet its touch-target claim, breaks the main Catch up workflow, and hand-waves the hardest redraw and focus cases.

**Better alternative:** a container-adaptive "task-first A": two-line header when necessary; directly visible Threads, Catch up, My posts, and Search; labeled More for Drafts/Settings; compact rows with a visible Actions button; and a dedicated one-tap Mark read button only in Catch up. Keep drawers for genuinely rare edits, but preserve the frequent workflow instead of uniformly hiding every action.
