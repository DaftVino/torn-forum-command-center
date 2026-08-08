# Next session — paste this into a fresh chat

> Delete this file once the QA gate is underway; it is a launch pad, not a document.

## Start here

Run `/orient` before anything else, including clarifying questions. Then walk
`docs/qa-checklist.md` top to bottom on a real signed-in Torn account, on both
desktop Tampermonkey and Torn PDA, recording the result of every box.

## Read first

Read nothing else until you have these, in order:

1. `docs/qa-checklist.md` (9.4K) — the release gate, and the only thing standing between v0.1.0 and a tag
2. `docs/superpowers/plans/2026-08-07-v0.1.0-command-center.md` (15.7K) — the plan, and its handoff log naming five corrections marked do not revert
3. `docs/rules-compliance.md` (8.7K) — Torn's verbatim scripting rule and API terms, clause by clause against the code; re-check it if Torn revises either
4. `CLAUDE.md` (5.9K) — repo rules, including never reading the userscript whole
5. `docs/code-map.md` (18.7K) — the index; grep it for a symbol, then read the userscript around that anchor rather than opening the userscript
6. `docs/architecture.md` (12.2K) — why the panel renders the way it does, if a QA failure needs a fix

## Branch

`main` — 19 commits, every one of v0.1.0, no remote and no PR. The repo has
never had a second branch. QA findings that need a code change go on a branch
off `main` (`fix/<slug>`), not onto `main` directly. Do not create a remote
without asking; the owner will do that.

## Constraints

- Five corrections in the plan's handoff log are marked **do not revert**. The
  redraw guards are the one most likely to be undone by someone tidying up:
  `isOwnMutation` and the identical-render skip overlap deliberately, and
  removing either brings back a loop that made every text box untypeable.
- Never call `invalidateInFlight` from `rejectKey`. It made the refresh treat
  its own rejection as stale and swallow the message.
- The source is ASCII only and `tests/metadata.test.js` fails the build on any
  other character. Torn PDA rewrites typographic quotes before injection.
- The engine section is pure and `tests/purity.test.js` enforces it: no DOM, no
  network, no `GM_*`, no ambient clock.
- `@match`, `@grant` and `@connect` are the security surface. `@connect` names
  exactly one host. Widening any of them needs a stated reason.
- The API key must never reach an export, a log, a debug report or an error
  detail.
- Do not read `torn-forum-command-center.user.js` whole. It is 150K.
- Release is blocked until the QA gate passes. Do not tag v0.1.0 before then.

## Exit criteria

- `npm test` green (suite is at 301 now)
- `npm run test:syntax` passes
- `node tests/mutation-check.mjs` reports 50/50 guarded and leaves `git status` clean
- `node tests/render-preview.mjs` then `node tests/contrast-audit.mjs` reports every preview passing WCAG AA
- Every box in `docs/qa-checklist.md` is ticked or has a recorded failure, committed
- Any QA failure has an issue or a fix branch, and the handoff log records what was found

## Unknowns and risks

- Nothing in the QA checklist has ever been run. It needs a real Torn account, a
  real API key and a real device, so the owner has to do it or supply access.
- The redraw loop was fixed but only verified in the harness. If the panel still
  flickers on a live forum page, the remaining suspect is Torn destroying the
  container the panel mounts into, which forces a legitimate re-create. The
  debug report names the mount; if that is what is happening, consider making
  the owned fallback the default.
- Whether a Limited Access key is sufficient is inferred from Torn's access
  levels being hierarchical, not observed. If a Limited key is rejected, the
  panel's message names the two selections it needs and that string is what to
  correct.
- The scripting rule was supplied by the owner from a page no automated route
  can reach, and no copy of it was saved. Only the API docs page is archived, in
  `docs/reference/`. If the rule is revised, someone has to notice by hand.
- There is no GitHub remote. Nothing is backed up off this machine.
- The mutation check edits the userscript in place and restores it. Do not pipe
  its output into `head`: a SIGPIPE once killed it mid-mutation and left the
  source broken.
