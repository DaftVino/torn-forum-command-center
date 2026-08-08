# CLAUDE.md

## Project

A Tampermonkey and Torn PDA userscript that replaces Torn's tiny subscribed-threads sidebar box with a full forum workspace: folders, tags, pinned threads, read/unread tracking, catch-up since last visit, locally saved reply drafts, and search across the threads you follow. Reads the official Torn API v2 forum endpoints with a Minimal-access key; all organisation stays in local script storage.

## Key docs

- Architecture: `docs/architecture.md`
- Conventions: `engineering-standards/repo-standards.md` in the `daftplate` repo — canonical, never copied here (its ADR 0001). Your local checkout path is recorded in `~/.claude/CLAUDE.md`.
- Workflow quick reference: `docs/quick-ref-workflow.md`
- Decisions: `docs/adr/` — read before proposing architectural changes
- Active plans: `docs/designs/`

## Commands

```
verify:  npm test
test:    npm test
deploy:  n/a
```

Run verify before every push. Never deploy without being asked.

## Workflow rules

The non-negotiable gates live in `~/.claude/CLAUDE.md` and govern this repo. Repo-specific additions only below.

Deviating from a standard requires an ADR here **and** a note queued to `~/.daftplate/outbox/` so the rule itself gets revisited upstream. Silent deviation is the one unforgivable move. Tasks live on this repo's GitHub Project (repo-standards §6.5) — never as draft cards, which agents cannot see.

## Repo-specific constraints

1. **The userscript is one large file and must never be read whole.** Grep `docs/code-map.md` for the symbol, then read only the lines around the anchor. A session that opens it wholesale has failed regardless of what it produced.
2. **No data path may touch Torn's markup.** See ADR 0001. Research could not confirm a single current forums selector, so all data comes from the API and the capture layer reads `location` and `document.title` only. DOM access exists in exactly two places — the mount container and the reply textarea — and both must degrade visibly. Adding a third is an architectural change, not a convenience.
3. **Selectors against the host site are fragile by nature.** Every DOM query needs a null guard and a visible failure path; a silent `undefined` in a userscript looks like the host site broke. Record the selector's purpose next to it, so the repair is possible when the site changes.
4. **The source is ASCII only, and `tests/metadata.test.js` enforces it.** Torn PDA rewrites typographic quotes across the whole file before injection. In the sibling Education Scheduler that turned four curly apostrophes into syntax errors and nothing ran at all. Never paste prose with smart quotes into this file.
5. **The engine section is pure and `tests/purity.test.js` enforces it.** No DOM, no network, no `GM_*`, no ambient clock. A function that needs the time takes it as an argument.
6. **The API key must never leave the device.** Not in an export, not in a log, not in a debug report, not in an error detail. Every detail string goes through `scrubDetail`, because a browser's own network error text quotes the request URL that this script never built.
7. **The request budget is a promise the panel makes to the user.** A default refresh is at most 13 requests, and the limiter holds 40 per rolling minute. Changing either means changing what the Settings view says.
8. **`@version`, the newest `CHANGELOG.md` heading, and the git tag move together in one commit.** Users update by version string; a bumped script with an unbumped header ships invisibly.
9. **`@match`, `@grant`, and `@connect` are the security surface.** Widening any of them needs a stated reason in the PR description. `@connect` names exactly one host.
10. **No secret reaches the script.** Everything in a userscript is readable by every user. API keys are entered by the user and held in script storage, never committed.

## Verification

```
npm test
npm run test:syntax
node tests/mutation-check.mjs
```

The mutation check breaks each user-visible promise in turn and asserts the
matching suite notices. It found six tests that passed for the wrong reason,
four of them self-referential — a timeout test that advanced the clock by the
constant it was testing, and limiter tests that looped that constant's own
value. Run it after adding a test that guards something important, not just
before a release.

It edits the production file in place and restores it, including on a signal.
**Do not pipe its output into `head`** or anything else that closes the pipe
early: a SIGPIPE once killed it mid-mutation, and the next run read the mutated
file as its pristine baseline. Redirect to a file and read that.

Release is blocked on `docs/qa-checklist.md`, walked on a real signed-in
account on real hardware. Automated tests cannot prove Torn PDA's injection or
Torn's live API.

## Pipeline

`brainstorming` → `writing-plans` → `/plan-eng-review` → `using-git-worktrees` → `test-driven-development` → `/code-map` (the file grew) → `/review` → `/ship`.

## Off

- `/land-and-deploy` and `/canary` — there is no deploy target. The release is a tag plus the raw file URL.
- `/gas-deploy` — wrong platform.
- `/qa` and `/browse` — the app under test is a third-party site the harness cannot log into. QA is manual, in a real browser, signed into a real account.

## Context budget

- The userscript is the repo. **Never read it whole**, at any size, for any reason. `docs/code-map.md` (from `/code-map`) is the index; grep it for the symbol, then `Read` with `offset`/`limit` around the anchor.
- Regenerate the map with `/code-map` whenever a session moves declarations; a stale anchor is worse than none, because it is trusted.
- Session start: `/orient`. Phase or session end: `/handoff`.

## Subagent defaults

- "Where is X handled?" → an Explore subagent over the script; take its answer, not its file dumps.
- Mechanical batch edits (renames, repeated call-site changes) → a cheaper-model subagent, one task per anchor region from the map.
