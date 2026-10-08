# Next session — paste this into a fresh chat

> Delete this file once Wave A is underway; it is a launch pad, not a document.

## Start here

Run `/orient` before anything else, including clarifying questions. Then
implement the six merged feature plans in dependency waves, tracked on #20,
with one agent per plan in its own worktree:

- **Wave A**, in parallel: #8 auto-hide, then #2 My posts.
- **Wave B**, in parallel once Wave A has merged: #3 rows cap, #4 author-only,
  #10 reactions and karma, #9 badges. Merge them in that order, rebasing each
  onto `main`.

## Read first

Read nothing else until you have these, in order:

1. `docs/superpowers/plans/2026-10-08-auto-hide-on-open.md` (50.1K). The Wave A
   lead plan: it introduces `isRecoveredValue`, which every later
   settings-adding plan needs. Read it in slices: the header, Review Focus and
   the `### Task` headings. The implementing agent reads the rest.
2. `docs/superpowers/plans/2026-10-08-my-posts-view.md` (120.1K). The other
   Wave A plan, and the dependency hub: `tfcc:mine`, `refreshMine` and
   `threadPostsTotal`, which #3, #4 and #10 build on. Read it in slices: the
   header, Review Focus, the `### Task` headings and the closing "If #3 has
   merged first" section.
3. `docs/reference/torn-api-live-findings-2026-10-08.md` (6.6K). The live API
   behaviour every plan was corrected against: 16 findings, plus the owner's
   page checks.
4. `docs/code-map.md` (20.8K). The symbol index, current at `19b069f`. Grep it
   for a symbol, then read the userscript around that anchor.
5. `tests/custom-key.test.js` (7.5K). This coverage test fails until #2 adds
   `forumthreads` and `forumposts`, and #10 adds `profile`, to
   `CUSTOM_KEY_SELECTIONS`. That failure is intended.
6. `docs/records/deliberate/2026-10-08-badges.md` (5.3K). The owner's binding
   decisions for #9: a TCT day, strict streaks, and exactly 15 badges.

## Branch

`main`. Every plan, the live findings, the Minimal Access copy fix and the
custom-key link are merged. Cut each feature branch from `main` as
feat/<issue>-<slug>, for example feat/8-auto-hide, and never from another
feature branch. Wave B branches are cut only after Wave A has merged.

## Constraints

- Never read `torn-forum-command-center.user.js` whole (153K). Grep the map,
  then read slices. Give every agent this rule.
- **No feature PR bumps the version.** Each one adds only an `[Unreleased]`
  CHANGELOG entry, and the owner cuts one release commit and tag later. Two
  feature PRs will conflict in `CHANGELOG.md`: keep both entries, Added before
  Fixed.
- **Do not revert. A thread's `posts` counts replies.** `threadPostsTotal` adds
  1 exactly once. Never add it again (findings 3 and 4).
- **Do not revert. `from` is inclusive, newest first, at most 20.** `offset`,
  `limit` and `sort` are ignored. Go further back with the `prev` chain built
  from `to`, which is also inclusive, and de-duplicate by id (findings 6-9 and
  15).
- **Do not revert. Minimal Access is the minimum key level** (finding 16).
- **`isRecoveredValue` must be on `main` before #3, #4 or #9 merges.**
  Otherwise every upgrading user sees "Settings were damaged".
- **The default refresh stays at 13 requests or fewer.** The limiter holds 40
  per minute, and the Settings text must state the real numbers.
- Engine purity and ASCII-only source are enforced by tests. Every icon is
  ASCII SVG.
- Never automate a browser on torn.com. Torn's scripting rule risks a game
  ban. Anything live goes through the API, using the owner's keys in
  `~/.tfcc-key.txt`, which must never be printed or committed.
- After each plan, run the mutation check as
  `node tests/mutation-check.mjs > mutation.log 2>&1` and read the file. Never
  pipe it into `head`.
- No attribution footer on any commit or PR.

## Exit criteria

- Six feature PRs are merged to `main`, one each for #8, #2, #3, #4, #10 and
  #9.
- `npm test` passes on `main` after the last merge (the suite is at 309 now).
- `npm run test:syntax` passes, and `node tests/mutation-check.mjs > mutation.log 2>&1` reports every promise guarded.
- `docs/code-map.md` is regenerated and committed after the last merge.
- Every remaining owner gate is recorded as a comment on #20.

## Unknowns and risks

- **All six plans edit the same userscript.** Expect rebase conflicts inside
  each wave. Merge serially in the stated order, and re-run the full
  verification after each rebase rather than trusting the pre-rebase result.
- **The custom-key link format is unverified.** The owner must paste one link
  generated on torn.com/api.html before any release. This blocks the release,
  not the implementation.
- **v0.1.0 was never tagged.** `docs/qa-checklist.md` has still not been
  walked on a real account, so the first tag will carry v0.1.0 and all six
  features together. That needs the owner.
- **Still unknown:**
  - whether `rating` is net or likes-only;
  - how `f=0` links, deleted threads and private forums behave;
  - what the feed `type` values mean;
  - whether Torn PDA shares storage across tabs.

  Each plan treats these as unverified. None should be guessed into code.
- **`.claude/worktrees/` is untracked:** agent worktrees from the planning
  session. Remove them with `git worktree remove` once their branches are
  merged. They are not repo content.
