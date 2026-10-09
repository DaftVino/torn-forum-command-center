# Codex adversarial review: PR #44, compact drawer, My posts colour, semi-transparent backgrounds (#43)

- **Model:** gpt-5.6-sol (Codex)
- **Effort:** high
- **Inputs:** the full diff of PR #44 (`feat/43-compact-drawer` at e10cba3) against `main`, piped on stdin.
- **Verdict:** merge-after-fixes.
- **Resolution:** all four findings are fixed test-first in the commits that follow this record.

The review follows verbatim. It contained no typographic punctuation to convert.

---

- Major - `torn-forum-command-center.user.js:7400`: Tag Save calls `toggleTag`. Entering a tag already on the thread removes it, despite the UI being named "Add tag". Scenario: a user forgets an existing tag, enters it, and Save silently deletes it. Use an add-only operation, or skip the update when the normalized tag already exists.

- Major - `torn-forum-command-center.user.js:6857`: Enter saves during IME composition. On a touch keyboard, Enter is commonly used to accept a candidate; the handler will prematurely save and close the popup. Ignore key events when `ev.isComposing` or `ev.keyCode === 229`, and add an IME test.

- Minor - `tests/wide-43-diffs.js:23`: `INFO_NAME` is not scoped to `button.tfcc-info` or `data-act="info"`. The parity test can pass if an info button is missed while an unrelated `aria-controls="tfcc-info-*"` element receives the replacement, because it checks only aggregate title counts. Scope the replacement to the complete info-button opening tag and assert the identities and exact number of replacements.

- Minor - `tests/wide-43-diffs.js:45`: The replacement categorized as "My posts colour" also removes `font-weight: bold`. Thus My posts changes typography across all widths, beyond the stated color change, while the replacement list and style test bless it. Retain `font-weight: bold`, or explicitly document and approve the typography change separately.

Verdict: merge-after-fixes.
