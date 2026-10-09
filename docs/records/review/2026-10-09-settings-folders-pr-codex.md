# Codex adversarial review: PR #48, tighter narrow Settings and several forums per folder (#47)

- **Model:** gpt-5.6-sol (Codex)
- **Effort:** high
- **Inputs:** the full diff of PR #48 (`feat/47-settings-folders` at 3f81590) against `main`, piped on stdin.
- **Verdict:** merge-after-fixes.
- **Resolution:** the finding is fixed test-first in the commits that follow this record.

The review follows verbatim. Only its typographic punctuation was converted to ASCII.

---

- **Major - `torn-forum-command-center.user.js:2510`**: Exclusivity is enforced only when adding a claim, not when loading/normalizing existing organizers or using `upsertFolder`. Pre-#47 data could already contain `guides:[61]` and `scripts:[61]`; both claims survive, both chips render, and `folderFor` silently picks whichever folder comes first. Those duplicates also consume the 40-entry cap and persist through import (`:2834`). Fix by canonicalizing every organizer at load/import/upsert boundaries: deduplicate within each folder and retain each forum only in the first deterministic local folder. Add regression tests for cross-folder and same-folder duplicates, including import into such local data.

**Verdict: merge-after-fixes.**
