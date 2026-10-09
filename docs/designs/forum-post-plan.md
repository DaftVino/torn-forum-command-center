# Forum post plan

## Editorial direction

The post introduces Forum Command Center as a calm, practical replacement for Torn's small subscribed-threads box.

The tone is warm and confident without overselling the script. It begins with the everyday problem, gives concrete player scenarios, offers a short installation path, and then provides a complete but scannable feature tour. Privacy and rules compliance remain visible instead of being buried in a closing disclaimer.

The design uses Torn-forum HTML only: `p`, `strong`, `em`, `span`, `ul`, `ol`, `li`, `table`, `tr`, `th`, `td`, `a`, and `img`. The muted FCC blue, `#5C768F`, identifies headings and the closing line. Decoration stays restrained so the banner, screenshots, and product itself carry the visual weight.

## Structure

1. Banner, centred title, and one-line tagline.
2. What it is:
   - Torn's subscribed-threads box is the problem.
   - FCC is the full workspace.
   - Official API, Minimal Access, read-only behaviour, and local storage.
3. Who it is for:
   - faction leader;
   - script author;
   - trader;
   - casual player;
   - Torn PDA player.
4. Quick start:
   - install;
   - use the custom-key link;
   - confirm the key on Torn;
   - paste and save it.
5. Feature tour:
   - all six views;
   - folders and personal organisation;
   - unread and Catch up;
   - appearance;
   - narrow/mobile layout;
   - My posts, reactions, karma, badges, and streaks;
   - drafts, search, export/import, debug report, and auto refresh.
6. Privacy, safety, and Torn's rules:
   - key handling;
   - GET-only API traffic;
   - source-derived request budgets;
   - limited page access;
   - no gameplay automation.
7. Four screenshots with short captions.
8. Feedback invitation and a concise closing line.

## Sources and claims

| Claim area | Primary source |
|---|---|
| Product purpose and broad feature set | Current `README.md`; `docs/architecture.md` |
| New and changed behaviour | `CHANGELOG.md` Unreleased section |
| Mobile layout and interaction details | `docs/qa-checklist.md`; specification sections 13-14 |
| API endpoints and request model | Userscript constants; Settings request-budget text; `docs/architecture.md` |
| Key access level and disclosure | Settings Torn API key table; QA checklist |
| Custom-key selections | `CUSTOM_KEY_SELECTIONS` |
| View names | `VIEWS` |
| Badge count and rules | `BADGES`; architecture Badges section |
| TCT day basis | `DAY_MS`, `tctDay`, and architecture Badges section |
| Logo artwork and colour | `LOGO_SVG` |
| Version, if ever added to the post | Userscript `@version` |

The post deliberately does not identify Torn's thread `rating` as either net reactions or likes-only. The source says that question remains unresolved, so the post describes the displayed label without assigning it an unverified meaning.

The post also avoids claims about subscriber counts because the architecture states that Torn's API does not publish one.

## Placeholders

| Placeholder | Purpose | Filled by | When |
|---|---|---|---|
| `{{BANNER_URL}}` | Publicly reachable FCC banner image | Repository owner or forum publisher | After `banner.html` is captured, uploaded, and its final image URL is known |
| Install link | Greasy Fork listing, https://greasyfork.org/en/scripts/599453-torn-forum-command-center | Filled by the owner, 2026-10-09 | Pinned by the verifier as the only link the post may carry |
| `{{SHOT_THREADS_URL}}` | Threads view screenshot | Repository owner or release tester | After final UI QA on the release build |
| `{{SHOT_MOBILE_URL}}` | Torn PDA/narrow-layout screenshot | Repository owner or release tester | After final real-device QA |
| `{{SHOT_CATCHUP_URL}}` | Catch up view screenshot | Repository owner or release tester | After final UI QA with representative folder groups |
| `{{SHOT_SETTINGS_URL}}` | Settings view screenshot | Repository owner or release tester | After final key-disclosure and layout QA |

No other placeholder is permitted. All placeholders must be replaced with final public URLs immediately before publishing to Torn.

## Verification

`scripts/forum-post-data.js` reads the userscript as text. It does not execute or `require()` the userscript.

The source parser extracts:

- `@version`;
- numeric request constants;
- `VIEWS`;
- `CUSTOM_KEY_SELECTIONS`;
- `BADGES`;
- the TCT-day formula;
- the Settings access-level disclosure.

The verifier then:

- computes the default Threads and My posts request maxima by the same formulas used in Settings;
- checks the rolling-minute limiter;
- checks the badge count and TCT-day wording;
- checks Minimal Access;
- compares the named custom-key selections with `CUSTOM_KEY_SELECTIONS`;
- compares the feature-tour view list with `VIEWS`;
- rejects unknown or missing placeholders;
- rejects links to other forum articles;
- checks any mentioned semantic version against `@version`;
- rejects unsupported HTML tags, Markdown links, Markdown headings, and BBCode;
- balances the supported non-void HTML tags;
- rejects any numeric literal in the post that is not one of the source-derived documented values.

Run:

```text
npm run verify:forum
npm test
```

The Node test imports and runs the same verifier checks used by the command-line script.

## Definition of done

The forum post is ready when:

- all required sections are present and easy to scan;
- every requested feature is represented without implying unsupported behaviour;
- all privacy and request-budget claims match the source;
- only the approved Torn-forum HTML tags are used;
- the banner and screenshot captions are in place;
- the verifier and the complete test suite pass;
- each placeholder has been replaced with its final public URL;
- the banner and screenshots have been visually checked at Torn's rendered forum width;
- the release build has completed the applicable real-browser and Torn PDA QA checklist;
- no unresolved live-API question has been turned into a factual claim.
