# Codex adversarial review: PR #46, priority colour, reorderable collapsible folders, custom key verified (#45)

- **Model:** gpt-5.6-sol (Codex)
- **Effort:** high
- **Inputs:** the full diff of PR #46 (`feat/45-folders-priority`) against `main`, piped on stdin.
- **Verdict:** merge-after-fixes.
- **Resolution:** all three findings are fixed test-first in the commits that follow this record.

The review follows verbatim, with its 3 non-ASCII characters (em dashes) written as ASCII "--".

---

- **Blocker** -- `torn-forum-command-center.user.js:2423-2454, 7762-7764`  
  Previous versions could create a folder named `Unfiled`, producing id `"unfiled"`. The new reservation only protects newly created folders. On upgrade, `folderOrderKeys()` emits the same key for both the folder and built-in group; Settings misidentifies both as built-in, Catch up duplicates/mixes them, and `withFolderOrder()` drops the real folder during reorder/import. `"unfiled"` in `collapsedFolders` is also ambiguous.  
  **Fix:** migrate reserved IDs during normalization and import, rewriting every thread reference, or represent built-in Unfiled with a namespace/type that cannot collide. Test an old saved organizer and old export containing a real `"unfiled"` folder.

- **Minor** -- `torn-forum-command-center.user.js:5943-5946`  
  `groupDomId()` is not injective. Imported folder ids such as `"ops/a"` and `"ops?a"` both become `tfcc-grp-ops_a`, producing duplicate DOM ids and incorrect `aria-controls` relationships.  
  **Fix:** use collision-free encoding or assign unique generated DOM ids per group.

- **Major** -- `tests/wide-45-diffs.js:30-42`; `tests/wide-parity.test.js:167-170`  
  The replacement list broadly permits any rule bearing an approved selector; it does not pin the rule bodies. An unapproved change such as adding `font-style: italic` to `button.tfcc-grp`, or a second overriding `.tfcc-prio` rule, passes the wide-golden guard. The two new `--tfcc-prio` declarations are likewise not exact replacement entries.  
  **Fix:** list and compare complete inserted/replaced CSS lines, including both token declarations, with exact occurrence counts; reject extra rules even when their selector is approved.

**Verdict: merge-after-fixes.**