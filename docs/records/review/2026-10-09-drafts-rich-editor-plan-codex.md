# Codex adversarial review: implementation plan for #58 (Drafts rich editor)

- **Model:** gpt-5.6-sol (Codex)
- **Effort:** high
- **Inputs:** piped on stdin, because the Codex sandbox fails on this machine.
  - `docs/superpowers/plans/2026-10-09-drafts-rich-editor.md` and its reference
    code, as of commit edb8ab3.
  - The spec, ADRs 0001 and 0002, and both research findings.
  - `CLAUDE.md`, `tests/read-only.test.js` and `tests/drafts.test.js`.
  - Excerpts of `torn-forum-command-center.user.js` and `tests/load-userscript.js`.
- **Verdict:** rework.
- **Resolutions:** see "Plan review resolutions" at the end of the plan.
  - 25 of the 28 findings were fixed or amended in the spec.
  - One is documented: whitespace.
  - Two were declined, with evidence: ES2015 built-ins, and gstack browse for
    local previews.

The review follows verbatim. Only its typographic punctuation was converted to ASCII.

---

## Findings

- **Blocker** -- `Task 3`, `Task 6`, and `Task 7`. The size rules cannot satisfy the lossless-conversion promise. A 20,000-character MD draft can expand past both `CLEAN_MAX_CHARS` and the 20,000-character storage cap. `saveEditor()` then calls `saveDraft()`, silently truncating the converted HTML while leaving the in-memory editor unchanged; the loss appears after reload. Emoji and nested spans can expand by much more than the claimed five times. Define one canonical storage representation with an adequate bound, or reject an oversized conversion visibly. Add a save, reload, and compare test for a maximum-size draft.

- **Blocker** -- `torn-forum-command-center.user.js:4497-4515` and `Task 7`. Research says a thread can contain five connected TinyMCE bodies, but `findReplyBox()` uses `querySelector()` and accepts the first connected match. It can insert into or autosave from a hidden edit box, recreating #60 with a different element. Query all exact-selector matches, select the visible reply/new-thread editor, and fail visibly when selection is ambiguous. Test a connected hidden body before a visible body.

- **Major** -- `Task 10` and `Task 11`. Preview and the image picker automatically create arbitrary external `<img>` requests on torn.com. This leaks the player's IP and Torn URL through the referrer and permits GET requests to local or private-network HTTPS endpoints. It also contradicts the standing `read-only.test.js` claim that requests go only to the Torn API. Decide this security surface explicitly: preferably show placeholders until the player opts to load an image; otherwise add `referrerpolicy="no-referrer"`, reject private/local destinations where practical, amend the security documentation, and test the behavior.

- **Major** -- `torn-forum-command-center.user.js:3845-3855` and `Task 6`. Real settings loading uses `isRecoveredSettings`, but the proposed legacy-settings test calls `isRecoveredValue`. The plan neither updates nor tests the checker used by `loadAll()`, so a v0.2.2 settings blob may display a damage notice solely because `draftLang` was added. Update `isRecoveredSettings` and exercise the actual `loadKey` or `loadAll` path.

- **Major** -- `torn-forum-command-center.user.js:4550-4582` and `Task 9`. The debounced autosave callback reads the current `state.route.threadId`, not the thread for which the listener and timer were created. Typing in thread A and navigating to thread B before the debounce expires can save A's HTML as B's draft. Old listeners also are never removed. Capture the thread id, cancel timers when the route or box changes, and verify the box is still the selected connected reply box before saving.

- **Major** -- `Task 8`. `copyPost()` reports `{ ok: true }` before `navigator.clipboard.write()` settles. If permission is denied, the UI announces success; the delayed `writeText` fallback may also fail because user activation has expired, and `copyText()` likewise ignores asynchronous rejection. Make copying asynchronous or callback-driven and show success only after resolution. Test rejected `write()` and rejected `writeText()`.

- **Major** -- `Task 11`. The custom-color confirmation cannot work in a real render. The first click sets `pickerWarn` and redraws, but the hex value is not stored or rendered back into the replacement input. The second click sees an empty field. The test passes only because its global `querySelector` stub keeps returning the old value across redraws. Store the pending hex in editor state and render it, or make the warning's confirmation action carry the validated color.

- **Major** -- `Task 11`. Picker reads use the existing document-wide `valueOf()` and `doc.querySelector('[data-act="ed-header"]')`. These are not scoped to the panel, can match Torn or another script's markup first, and violate the two-host-DOM-access architecture and its null-guard requirement. Introduce panel-scoped lookup helpers and use them for every editor field.

- **Major** -- `Task 10`. Typing only updates `state.editor`; selecting another draft calls `loadEditor()` and silently discards the unsaved text and name. Route changes can do the same for an unsaved thread draft. Add a dirty flag and either panel autosave or an in-panel save/discard confirmation before changing keys. Test switching between two drafts after typing without pressing Save.

- **Major** -- `Task 1` and `Task 3`. `cleanTornHtml()` silently slices at 100,000 characters. The resulting post may be a valid but incomplete prefix, so Preview, Insert, Copy, and autosave all present silent data loss as success. A security bound should return an explicit oversize result, not silently alter user content.

- **Major** -- `Task 3`. Text conversion is not lossless even in the non-destructive direction: `textToMd()` trims every non-empty line, and the cleaner trims paragraph edges. A Text draft containing deliberate leading or trailing spaces changes when switched to MD or HTML. Either preserve those characters or document and confirm the loss like the MD/HTML-to-Text conversion.

- **Major** -- `Task 1`. The spec says TinyMCE `data-mce-bogus` nodes are dropped, but the cleaner only special-cases bogus `<br>`. Other bogus elements and their contents survive; the Task 9 test even expects a bogus `<strong>` to survive. Resolve the specification conflict and add tests for bogus spans and containers.

- **Major** -- `Task 4`. The image fixer has correctness gaps:
  - A Reddit media wrapper containing a `howto` result is converted into `status: 'fixed'` with an empty URL.
  - Imgur pages are always rewritten to `.png`, knowingly destroying GIF animation.
  - `fixAllImages('html', ...)` only recognizes double-quoted `src`, although users may type single-quoted or unquoted HTML.
  - The test claims every host-rule input shape but omits Drive `uc`, Giphy embed, GitHub raw/query forms, several direct-host forms, and other documented variants.
  
  Propagate non-`ok`/non-`fixed` Reddit results, stop guessing Imgur media type, tokenize HTML for bulk fixes, and create a table-driven test for every documented shape.

- **Major** -- `Task 5`. The HTML-link selection assertion is wrong. `<a href="https://a.b">` is 22 characters, so `wrapSelection()` returns `start: 22, end: 23`, not `21, 22`. The prescribed reference code and prescribed test cannot both pass.

- **Major** -- `Task 7`. The long-post test is guaranteed to fail before testing Insert: `('{red}**word**{/} ').repeat(1200)` is 20,400 characters, while the assertion requires it to be below 20,000. Redesign the fixture and independently assert that the full source survives conversion, not merely that Insert transmits the already-converted, possibly truncated result.

- **Major** -- `Task 4` and `Task 7`. The full suite will remain red. Adding hard-coded Drive, Dropbox, GitHub, Giphy, Gyazo, Imgur, and Reddit URLs violates the host allowlist in `read-only.test.js`, and Task 7 renames `insertDraft` without updating the later focus-audit test that slices the source starting at `function insertDraft`. The plan updates only the synthetic-event test. Rework both audits deliberately rather than weakening them to allow arbitrary network behavior.

- **Major** -- `Task 10`. The plan omits new runtime functions from `EXPORT_NAMES`, including at least `editorPostHtml`, which its own test calls. The stated interfaces also expose `editorKeyFor`, `loadEditor`, `renderEditorPane`, and `renderDraftList`, but no export step is given. Add an explicit export list in the same commit.

- **Major** -- `Task 14`. Two proposed security mutations do not change behavior:
  - Adding `onclick` to the internal node object does nothing because the serializer never emits that property.
  - Removing `script` from `DROP_WITH_CONTENT` still drops its raw text because `buildCleanTree()` ignores every `tok.raw`.
  
  Mutation-check will report these as uncaught. Mutate the actual serializer/attribute filter and the raw-text guard so each mutation demonstrably creates unsafe output.

- **Major** -- `Task 13`. Wide parity is self-referential: the implementer is told to copy the current failing render into the expected diff. Any accidental markup or CSS regression is thereby approved automatically. Produce the expected replacement from a reviewed fixture or require explicit owner approval of the captured diff before committing it.

- **Major** -- `Task 1`, `Task 3`, `Task 7`, and `Task 10`. Several tests pass for the wrong reason:
  - The "measured sets" test checks only array lengths, one color, and two emoji.
  - The round-trip target is `cleanTornHtml(h)`, so sanitizer data loss can define its own expected result.
  - The long Insert test compares against the already-converted result and cannot detect conversion truncation.
  - The "+ New draft ... Insert uses the editor's text" test never calls `insertPost`.
  
  Add complete expected constant fixtures, semantic preservation assertions, original-source length/content assertions, and an actual Insert spy or fake TinyMCE call.

- **Major** -- `Task 10` and `Task 11`. The implementation misses explicit layout requirements. Pickers have Cancel but no Done action, and image fixing occurs only after clicking Check rather than "as the player pastes." Add the required controls and input/paste handling, or amend the approved spec before implementation.

- **Major** -- `Task 5`. The production reference is not ES5-style. It uses `String.fromCodePoint()` during userscript initialization and `String.prototype.repeat()` for headings. A webview without `fromCodePoint` will crash the entire script before mounting. Use a small surrogate-pair helper and loop-based repetition, then test without those built-ins.

- **Major** -- `Task 1` through `Task 15`. Large engine insertions shift every later declaration, but the plan continues relying on old code-map anchors until the final task. This violates the repository rule that a stale map is worse than none. Regenerate the map after the engine insertion phase and again after the view/runtime phase, or remove all stale line references and use symbol searches exclusively.

- **Minor** -- `Task 6`. `newFreeDraft()` can increment `n999999999999` to a 13-digit id, which `isFreeKey()` and the normalizer reject. Use a bounded collision search that wraps within the accepted 12-digit range.

- **Minor** -- `Task 13`. It directs the worker to use `gstack browse` even though CLAUDE.md explicitly disables `/browse` for this project. Use the repository renderer and stored screenshots for local inspection, leaving signed-in Torn testing to the owner checklist.

- **Minor** -- `Task 15`. The spec requires proving that an older build's normalizer retains `byThread` text, but no task implements that compatibility test. Add a fixture or frozen legacy normalizer test.

- **Minor** -- `Task 15`. `git add -A -- . ':!.vscode'` can commit `mutation.log`, which earlier tasks create in the repository root. Write logs to a temporary directory or explicitly exclude/remove the file.

- **Minor** -- `Task 4`, `Task 6`, `Task 7`, `Task 10`, and `Task 11`. The global rule says to run the ASCII check after every paste, but several task-specific verification steps omit it. Make the check part of every production-edit task or a single mandatory scripted verification command.

## Specific decisions

- Store one canonical draft representation with an explicit size policy. Do not silently truncate converted content.
- Select the reply editor from all matching TinyMCE bodies using visibility and context, not first-match order.
- Do not auto-load arbitrary remote images in Preview. Use placeholders with an explicit Load action.
- Scope every editor-field query to `#tfcc-panel`; reserve document queries for the two ADR-approved Torn access points.
- Make panel edits dirty and autosave them locally before switching drafts.
- Make Copy completion asynchronous and report the actual clipboard result.
- Replace captured-current-output parity with a reviewed expected artifact.
- Treat the sanitizer as security code: use effective mutations and independent expected fixtures, not only round trips through the same cleaner.
- Resolve the picker, bogus-node, image-paste, and legacy-normalizer spec gaps before implementation begins.

## Ranked top 5

1. Lossless mode conversion is impossible under the proposed 20,000/100,000-character truncation rules.
2. First-match reply-box selection can write into one of Torn's hidden TinyMCE editors.
3. Preview introduces arbitrary external requests and private-network/referrer exposure without an architectural decision.
4. The actual legacy-settings recovery path is neither updated nor tested.
5. Autosave can save thread A's editor content into thread B after SPA navigation.

Verdict: rework