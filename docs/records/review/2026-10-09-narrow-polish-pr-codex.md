# Codex adversarial review: PR #40, narrow view polish (#39)

- **Model:** gpt-5.6-sol (Codex)
- **Effort:** high
- **Inputs:** piped on stdin, because the reviewer's sandbox could not read files: spec section 14 and the full diff of PR #40 (`feat/39-narrow-polish` at 767cf6e) against `main`.
- **Verdict:** merge-after-fixes.
- **Resolution:** both findings fixed test-first in the commits that follow this record.

The review follows verbatim. Only its typographic punctuation was converted to ASCII, and its two arrows are written as the `\u2191` / `\u2193` escapes the source uses.

---

- **Major -- `torn-forum-command-center.user.js:6576-6589`**: Internal click-away redraws synchronously for everything except thread links. With Filters and a row drawer open, tapping a filter input/select/label dismisses the drawer and replaces the clicked node before its native focus, picker, or label activation runs. The closing click can therefore lose its own action. Defer dismissal/redraw for all native default-action targets until after dispatch, not only `threadLinkOf`, and add a filter-control regression test.

- **Major -- `torn-forum-command-center.user.js:4739-4742`**: The wrap fallback does not make the two label buttons share the remaining width. The outer flex splits space between Mark and the entire catch-up/info group; at 320px/200% this gives roughly 132px to "All read" but only 82px to "Catch-\u2191 2 \u2193". The latter can wrap excessively or overflow its button. The visual test only checks button rectangles, so it misses overflowing text. Flatten the three controls for fallback layout--e.g. `display: contents` on the group--and allocate equal flex widths to the two label buttons with a fixed 44px info button. Assert equal label-button widths and `scrollWidth <= clientWidth`.

**Verdict: merge-after-fixes.**
