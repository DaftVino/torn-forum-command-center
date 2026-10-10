# Badges - design

**Status:** revised after the panel, 2026-10-08. The owner approved the
resolution. The plan is `docs/superpowers/plans/2026-10-08-badges.md`.
**Issue:** #9. Shares the header area with #10 (reactions tracker). Interacts
with #2 (My posts, PR #5), #3 (row cap, PR #6), #4 (author-only, PR #7) and #8
(auto-hide on open).
**Target release:** the next minor cut from `main` after this lands. The
feature PR adds an `## [Unreleased]` CHANGELOG entry only. A separate release
commit moves `@version`, `SCRIPT_VERSION`, `package.json`, the newest
CHANGELOG heading and the tag together (constraint 8). This is the same
convention as #2, #3, #4 and #8.

Every decision is stated as a decision, with its reason and the alternative it
beat.

## Panel resolution

The first draft of this spec went through a three-seat deliberation in two
rounds. The owner approved the resolution. The record is at
`docs/records/deliberate/2026-10-08-badges.md`. The draft was cut down hard:

- **The day is a TCT (UTC) day.** No local offset, no rollover setting, no
  DST or travel machinery.
- **Streaks are strict.** No rest days and no bridging. The 7-day rung is
  dropped.
- **The catalogue is exactly 15 badges, all visible.** No hidden badges, and
  no drafts, pins, tags, anniversary, comeback or clean sweep.
- **"Read" is now "focused thread visit".** 15 seconds accumulated only while
  the page is visible *and* focused. Metrics are named honestly.
- **Backlog buster is tied to the backlog itself.** It uses a stored set of
  the thread ids in that morning's Catch up.
- **With #4 on, "not checked" threads block a check-in** at that moment.
- **The chip is a cup in the best tier's color**, not a tiny featured-badge
  glyph. #10's tracker stays on its own line, as #10's spec places it.
- **Reset everything is a real reset.** There is no backfill.
- **Multi-tab accounting is best effort.** Nothing promises atomicity.

Where this document and the record disagree, this document is the design. The
record is the reasoning.

---

## 1. Goal and principle

The command center pays off when it is used regularly: set up once, organized,
and caught up most days. Badges give a small, honest reward for doing what the
user already came to the panel to do. They scale with regularity and
breadth, and they never pay for busywork.

**Two kinds of evidence, two kinds of reward.**

| Kind | Rewards | Evidence | Badges |
|---|---|---|---|
| **Presence** | Showing up and leaving the forums handled | Catch up is empty against fresh data on a TCT day | Caught up, the five streaks |
| **Attention** | Spending focused time on threads, across the forums | 15 s of visible, focused time on one thread page | Reader, Bookworm, the three forum badges, Backlog buster |
| **Setup and care** | Building the workspace | Organizer state | Switched on, First folder, Tidy desk |

Presence accepts triage. Clearing Catch up with Mark all read is a real
decision ("none of this matters to me today"), and the script cannot tell a
skim from neglect. Attention badges never accept a click as evidence.

## 2. Non-goals

- **No API requests.** No badge ever triggers one. The budget (13 per default
  refresh, 40 per rolling minute) and its Settings text are unchanged.
- **No new access to Torn's markup** (ADR 0001). The evidence is `location`,
  `document.hidden`, `document.hasFocus()`, page focus events, our own panel
  and our own state.
- **No points, levels, leaderboards, sharing, reminders, "at risk" warnings,
  sound or modals.**
- **No tamper-proofing against the device owner.** All state is local and
  editable. Anti-gaming means *not designing an incentive for busywork*.
- **No retro-credit across days.** A day that was not credited on that day is
  never credited later.
- **No dependency on #2, #3, #4, #8 or #10 code.** This runs correctly on
  current `main` (section 10).

---

## 3. Current behaviour this builds on (verified at `884f614`)

Line numbers are from `884f614`. Grep before trusting them.

- `captureVisit` (l.2098) runs from `syncToRoute` (l.3563) on **every**
  navigation callback, including the debounced `MutationObserver` that fires
  on Torn's React churn. A captured visit is a state re-asserted many times a
  minute, not an event. Counting calls would count renders.
- `captureVisit` creates an organizer entry for any opened thread, so "threads
  the panel tracks" is not a useful filter.
- `catchUpList(rows, lastCatchUpAt)` (l.911) keeps a non-dismissed row with
  `unread > 0` or `lastActivity > lastCatchUpAt`. `lastActivity` includes the
  `visit` candidate, so opening a thread on Torn puts it *into* Catch up until
  Mark read or Set catch-up point. This is unchanged here and recorded as open
  question 3.
- `markall` (l.3397) dismisses every row with a known total in one click.
  `catchup-done` (l.3403) moves `lastCatchUpAt` only.
- `panelHtml` (l.2967) emits `.tfcc-head` (title, `N new`, `N subscribed`,
  Refresh, Expand, Hide) and returns right after it when collapsed (l.2991).
  The loading and fatal heads hold only the title (l.2969, l.2973).
  `.tfcc-title` has `margin-right: auto` (l.2353).
- **Click delegation reads `ev.target.getAttribute('data-act')` directly**
  (l.3107-3111). It does not walk up to an ancestor. A click that lands on an
  SVG inside a button reaches no handler. This spec handles that in 8.1.
- `loadKey` (l.1568) reports damage whenever
  `JSON.stringify(raw) !== JSON.stringify(normalised)` (see 6.2).
- `persist(which)` writes one key's whole in-memory value. No tab hears
  another tab's writes: `@grant` has no `GM_addValueChangeListener`.
- `encodeState` and `importState` (l.1347, l.1412) cover folders, organizer
  fields and drafts. `decodeState` rejects any `v` other than 1 and ignores
  unknown fields.
- Reset everything (l.3491) resets every key except the API key.
- Auto refresh runs only in a visible, focused tab (l.3589-3590).

---

## 4. Motivation design

| Mechanism | Evidence | Dark side | Decision |
|---|---|---|---|
| **Fixed vs variable rewards** | Variable-ratio schedules drive compulsive checking. Fixed, legible rules support a sense of control. | Variable rewards are the core of manipulative design. | **Every badge is deterministic, visible and published with its rule.** No chance, no hidden badges, no mystery. |
| **Goal gradient** | Effort rises near a visible goal. | Endless ladders become chores. | Progress bars in the catalogue. The shelf shows one "next" goal (the nearest unearned badge). Every ladder is short and ends. |
| **Streaks and loss aversion** | Streaks build habits because losing one hurts. | Anxiety, and the what-the-hell effect: after a break, people quit. | **Strict streaks, softened in presentation, not in rules.** Best-ever and every badge are kept forever. A break shows as `0`, with `best 23` in neutral color. There is no red, no "lost", no countdown and no warning. The low rungs (3, 10) are quick to re-earn. The panel chose strictness over rest days: rest days were a second system to explain and test, and they made "consecutive" mean something other than consecutive. |
| **Competence feedback** | Informational rewards support intrinsic motivation. Controlling ones undermine it. | Overjustification. | Names describe what the user became or did ("Tidy desk", "Backlog buster"), not click tallies. |
| **Rarity tiers** | Scarcity gives meaning. | Grind-only rarity is a chore with a medal. | Tiers follow the *calendar time* a daily user needs, which clicking cannot shorten (4.2). |

### 4.1 The verbs, and their evidence

| Verb | Counts? | Evidence | Anti-gaming |
|---|---|---|---|
| **Focused thread visit** | Yes | 15 s accumulated on one thread route while `!document.hidden && document.hasFocus()` and not in Expand (takeover). Section 5.3. | Once per thread per TCT day. Renders and React churn cannot add time: time comes only from a sampled clock while active. |
| **Forum explored** | Yes | The forum id of a credited focused visit. | Distinct ids, so it cannot be farmed. |
| **Mark read, Mark all read, Set catch-up point** | Only by emptying Catch up | Section 5.4 | Repeating does nothing: once per day. |
| **Catch up empty** | Yes: a **check-in** | Section 5.4 | Once per day. Refreshing more does nothing. |
| **Already quiet** | Yes: a check-in | The first fresh refresh of the day finds Catch up empty. | A quiet week must not cost a streak. |
| **Create a folder and file into it** | Once | Organizer state | Earned once, never revoked, never re-earned. |
| **File every followed thread** | Once | Organizer state, with a floor of 10 | Same |
| **Refresh** | **Never** | | Only the first successful refresh, as Switched on. |
| **Drafts, pins, tags, export, theme, sort** | Never | | Cut by the panel. They are features, not habits. |

### 4.2 Tiers

| Tier | Frame shape | Calendar time for a daily user | Badges |
|---|---|---|---|
| Bronze | circle | under a week | 6 |
| Silver | hexagon | weeks | 5 |
| Gold | octagon | months | 3 |
| Legendary | double ring | over a year | 1 |

The tier is carried by frame shape and by text as well as color (WCAG
1.4.1).

---

## 5. Day, streak, attention and check-in

### 5.1 The day: Torn City Time

```
tctDay(now) = Math.floor(now / 86400000)     // now: epoch ms. TCT is UTC.
```

**Decision: a TCT day, not a local day.** Torn's own daily reset, and so
everything Torn players plan their day around, is understood to be TCT
midnight (not verified in this repo; `formatAbsoluteTime` already shows TCT). A UTC day
has no DST, no travel, no offset argument and no setting, so the panel cut a
whole class of edge cases and tests. The cost is that a player at UTC-8 has
their "day" turn over at 16:00 local. That is how Torn's own day works, and
the catalogue text says so ("a day is a Torn day, which starts at 00:00 TCT").

### 5.2 Streak record and crediting

```
streak: { current: int >= 0, best: int >= 0, lastDay: int }   // lastDay -1 = never
```

`creditDay(streak, today)` (pure), with `delta = today - lastDay`:

| Case | Result | Why |
|---|---|---|
| `lastDay = -1` | `current 1`, `lastDay today` | The first check-in. |
| `delta = 0` | unchanged | Once per day: this is the refresh-spam guard. |
| `delta = 1` | `current + 1` | Consecutive. |
| `delta >= 2` | `current = 1` | Strict. A missed day breaks the streak. |
| `delta < 0` | `lastDay = today`. `current` and `best` unchanged, and `checkinDays` not incremented. | **The clock went backwards, or a stored day is in the future.** UTC has no legitimate way back, so this is a clock fix or a wrong device clock. It must never cost a day: nothing is reset. A stored future day must not block later days: rebasing to today means tomorrow is `delta = 1` again. The rebase credits nothing. |

After a crediting case (the first three rows): `best = max(best, current)`,
`checkinDays += 1`, and `firstCheckinAt` is set if it is 0.

**Worked example of the future guard:** the device clock runs 3 days fast, and
a check-in records `lastDay = D + 3`. The clock is fixed, and today is `D`
(`delta = -3`): rebase to `D`. On `D + 1`: `delta = 1`, so the streak
extends. No day is lost, and no stored day blocks anything.

**Display**, `streakView(streak, today)`, which never mutates:

| `delta` | Number shown | Glyph |
|---|---|---|
| `lastDay = -1` | streak segment hidden | |
| `<= 0` | `current` | filled: today is counted |
| `1` | `current` | outline: today not yet |
| `>= 2` | `0`, and the shelf shows `best N` | outline |

There is no "at risk" state and no countdown.

### 5.3 Focused thread visits (the dwell design)

**The pure accumulator.** It lives in the engine and takes the clock as an
argument:

```
dwell = { threadId: '', accMs: 0, lastAt: 0, done: false }

dwellStep(dwell, threadId, active, now) -> { dwell, credit: threadId | null }
  if threadId !== dwell.threadId:                 // route change: reset
      return { dwell: { threadId, accMs: 0, lastAt: active ? now : 0, done: false }, credit: null }
  if dwell.done or !threadId:   return { dwell, credit: null }
  if !active:                   lastAt = 0                       // pause, keep accMs
  else if lastAt === 0:         lastAt = now                     // resume
  else:
      accMs += clamp(now - lastAt, 0, DWELL_MAX_STEP_MS)         // 0 if the clock went back
      lastAt = now
      if accMs >= DWELL_MS: done = true, credit = threadId
```

- `DWELL_MS = 15000`. `DWELL_TICK_MS = 1000`. `DWELL_MAX_STEP_MS = 2000`.
- **Active** = on a thread route, `doc.hidden !== true`,
  `typeof doc.hasFocus !== 'function' || doc.hasFocus() === true`, and
  `!state.settings.takeover`. Takeover is excluded because the panel then
  covers the thread. #8 clears takeover when a panel thread link is opened,
  so the normal path is unaffected.
- **Pause and resume.** Blur or hide sets `lastAt = 0`, and the time spent
  away is never added. On return, the next sample restarts the clock.
  `accMs` survives the pause, so 10 s, a blur, then 5 s credits.
- **Route change resets** `accMs`, so 10 s on thread A plus 5 s on thread B
  credits neither.
- **The step cap.** One sample may add at most 2 s. A throttled timer, a
  sleeping laptop or a frozen webview therefore cannot turn one late tick into
  15 s. Under-counting is the safe direction.
- **Runtime sampling.** A self-rescheduling `setTimeout(DWELL_TICK_MS)` chain
  runs while the script is on `forums.php`. It is started in `init`, stopped
  by the leave-the-page branch of `syncToRoute`, and restarted when
  `syncToRoute` sees the page again. A chain is used rather than
  `setInterval` because the test harness fires an interval only once.
  Samples are also taken immediately on `window` `focus` and `blur` and on
  `document` `visibilitychange`, so a pause starts at the real moment, not up
  to a tick later. All three listeners are installed once, behind a flag like
  `NAV_FLAG`, and every one is wrapped in `try`, so nothing can throw onto
  Torn's page.
- A credit calls `recordBadgeEvent({ type: 'visit', threadId, forumId }, now)`.
  `forumId` comes from `state.route.forumId`, or the organizer entry if that
  is 0.

**Once per thread per TCT day.** The record keeps `today.visitIds`. A credit
for a thread already in it does nothing. **The daily cap of 200 ids stays,
for one reason: it is the storage bound on that array.** No badge depends on
it. The largest visit badge is 500 in total, and the cap limits a single day
only.

**Naming.** In the UI, the metrics are **"Focused thread visits"** and
**"Forums explored"**. "Read" never appears, because 15 seconds of focus is
not proof of reading, and the panel was right to insist on that.

### 5.4 Check-in

A **check-in** credits today's streak day. All of these must hold
(`checkinEligible`, pure):

1. Badges are on (`settings.badges === true`).
2. **Fresh data.** The record holds a first look for today (5.5), and
   `feed.fetchedAt >= now - CHECKIN_FRESH_MS`, where `CHECKIN_FRESH_MS` is
   30 minutes.
3. At least one subscribed thread.
4. **No blockers.** `checkinBlockers(...)` returns 0. On current `main`, that
   is `catchUpList(state.rows, organizer.lastCatchUpAt).length`: unfiltered
   and uncapped, the same list `model.catchUp` is built from.
   **With #4's author-only mode on**, the not-yet-checked rows also block
   (section 10.3). That is a blocker *at that moment*: a later ordinary
   refresh on the same TCT day may check them and credit the day.

It is evaluated on four triggers: when a refresh succeeds (the `refreshed`
event), and after the `read`, `markall`, `catchup-done` and `archive`
handlers. It is never evaluated in the render path. No badge logic ever
starts a refresh.

**Triage counts.** An empty Catch up after Mark all read is a valid check-in.
**A quiet day counts.** Fresh data that finds Catch up already empty, with at
least one subscribed thread, credits the day at that refresh.

**Decision: an auto refresh may credit a quiet day.** Auto refresh runs only
in a visible, focused tab.

**Decision: a check-in while collapsed counts.** The collapsed head shows
`N new` and the chip. With #8 that is the normal state on a thread page.

### 5.5 The first look, and the backlog

The first successful refresh on a TCT day writes, once:

- `today.firstLook = checkinBlockers(...)` (the size of Catch up then);
- `today.backlogIds`, the ids of the Catch up rows at that moment, in Catch up
  order, capped at **100**.

**Backlog buster** is evaluated at the moment of a check-in. It is earned when
`today.firstLook >= 20` and **at least 10 of today's focused visits are ids in
`today.backlogIds`**. The clear has to come from the backlog itself: ten
unrelated visits plus Mark all read cannot earn it, because the ten visits
must be threads that were in that morning's Catch up. The record keeps
`bigBacklog = max(bigBacklog, firstLook)` for cleared days that met the visit
rule, for the progress bar.

The thresholds (20 and 10) are far from both caps (`backlogIds` 100,
`visitIds` 200). A first look larger than 100 stores the first 100 rows in
Catch up order, and 10 of 100 is still reachable. A backlog that large
already passes 20.

### 5.6 What is in the record

```
tfcc:badges = {
  v: 1,
  visits: int,            // focused thread visits, all time (thread, TCT day) pairs
  checkinDays: int,       // credited days, all time
  bigBacklog: int,        // largest first look cleared under the backlog rule
  firstCheckinAt: ms,     // 0 = never
  streak: { current, best, lastDay },
  forums: [int],          // distinct forum ids of credited visits, cap 64
  today: {
    day: int,             // tctDay this block describes, -1 = none
    firstLook: int,       // -1 = no successful refresh yet today
    backlogIds: [string], // cap 100
    visitIds: [string]    // cap 200
  },
  earned: { "<id>": ms }  // cap 64, unknown ids kept
}
```

- **Bounded.** The arrays are capped at 64, 100 and 200. `today` is replaced
  whenever `tctDay(now)` differs from `today.day`, in either direction.
- **Counters are top-level** so a later counter upgrades silently (6.2).
- **`earned` keeps unknown ids** that match `/^[a-z0-9-]{1,32}$/`, so a
  downgrade followed by an upgrade does not delete badges a newer build
  awarded. The display ignores unknown ids.
- **No event log.** The earned map with timestamps is the history.

---

## 6. Storage, upgrade safety, multi-tab

### 6.1 Key and settings

- New key `STORAGE_KEYS.badges = 'tfcc:badges'`. It is separate from the
  organizer, so damage costs only badges, and the organizer's stored shape is
  unchanged.
- New setting `settings.badges: boolean`, default `true`, normalised as
  `raw.badges !== false` (corrupt means on, like `autosaveDrafts`). It lives
  in `tfcc:settings` and is not exported (#3's precedent).
- Loaded in `loadAll` with the others. `['Badges', b]` joins the damage notice
  list.

### 6.2 The upgrade trap

`loadKey` calls any stored value whose JSON differs from its normalised form
"damaged", and `loadAll` tells the user it was reset.

1. **`tfcc:badges` on first run.** `raw === null`, so it is not recovered and
   loads silently as `freshBadges()`. Pinned by a test.
2. **The new `badges` settings field.** Every upgrader's stored settings lack
   it. **This spec requires `isRecoveredValue(raw, value)` exactly as the #8
   plan (Task 1, Step 6) specifies:** a pure engine helper that fills absent
   *top-level* keys of `raw` from `value` before comparing, which `loadKey`
   then uses. If #8 is not on `main` when this is built, this PR adds it,
   with #8's body, placement (directly after `normaliseSettings`) and test.
   Pinned by "a 0.1.0 settings blob with no `badges` loads with no notice".
3. **Later counters.** Counters are top-level, so a later version that adds
   one is forgiven by `isRecoveredValue`. The nested blocks (`streak`,
   `today`) are frozen for `v: 1`. Changing their shape needs a `v` bump plus
   a pure migration applied before the comparison. That is not built now; it
   is recorded so the next author does not walk into the trap. Pinned by "a
   v1 record missing one top-level counter loads with no notice".
4. **The normaliser reads back its own output.** Key order is fixed, and
   `normaliseBadges(normaliseBadges(x))` stringifies identically. It joins
   `tests/storage.test.js` "what a normaliser writes, it can read back
   unchanged".

### 6.3 One choke point, and multiple tabs

Every badge write goes through `recordBadgeEvent(event, now)`:

```
if (!state.settings.badges) return;
var stored = loadKey(STORAGE_KEYS.badges, normaliseBadges, now).value;   // re-read
var res = applyBadgeEvent(stored, event, badgeContext(now));              // pure
if (res.changed) persist('badges') with res.record;
state.badges = res.record;
if (res.newly.length) queueBadgeToast(res.newly, now);
```

**Best effort, not atomic.** The event is applied to a fresh read in the same
synchronous turn, so two tabs usually see each other's writes: two tabs on
the same thread give one visit, and two tabs checking in give one day. But
Tampermonkey propagates values between tabs asynchronously, and Torn PDA's
cross-tab behaviour is unverified. Two events close together can apply to the
same base. The result is an occasional duplicated or lost visit. A day credit
cannot double, because day credit is idempotent by value. **No badge hinges
on an exact count near a cap or near another tab's write.** The smallest count
threshold is 3 (forums, days). An off-by-one there costs or gives one day's
worth of progress, and never crosses a cap.

Rejected: `GM_addValueChangeListener` (it widens `@grant`, constraint 9) and
per-tab counters merged by sum (unbounded).

A toast appears only in the tab whose operation earned the badge. Other tabs
pick it up at their next `recordBadgeEvent` or reload.

---

## 7. The catalogue: 15 badges, all visible

`BADGES` is a frozen engine table of
`{ id, group, tier, name, glyph, metric, target, rule }`. The evaluator, the
progress bars and the catalogue text all read it. `metric` is a key of the
pure `badgeMetrics(record, facts)` result. The metrics take no clock; the
only time-dependent badge rules live in `applyBadgeEvent`, which takes `now`
in its context.

| # | id | Name | Group | Tier | Metric | Target | Rule text (as shown) | Why |
|---|---|---|---|---|---|---|---|---|
| 1 | `switched-on` | Switched on | Setup | Bronze | `switchedOn` (0/1) | 1 | Save an API key and finish a refresh. | Confirms setup worked, which users are otherwise unsure of. |
| 2 | `first-folder` | First folder | Setup | Bronze | `ownFoldersFilled` | 1 | Create a folder of your own and file a thread in it. | The owner's "setup for a folder". The starter folders (`guides`, `scripts`, `faction`) do not count: an untouched default is not setup. |
| 3 | `caught-up` | Caught up | Presence | Bronze | `checkinDays` | 1 | Finish a day with Catch up empty. | Names the habit the streaks then build. |
| 4 | `reader` | Reader | Attention | Bronze | `visits` | 25 | Make 25 focused thread visits. | About a week of normal use (3 to 5 threads a day). |
| 5 | `bookworm` | Bookworm | Attention | Gold | `visits` | 500 | Make 500 focused thread visits. | Months, not days: one thread counts once a day, and each needs 15 s of focus. |
| 6 | `explorer` | Explorer | Attention | Bronze | `forums` | 3 | Make focused visits in 3 different forums. | Most players live in one or two forums. A third is a deliberate step. |
| 7 | `well-travelled` | Well travelled | Attention | Silver | `forums` | 7 | ... in 7 different forums. | Real breadth. |
| 8 | `cartographer` | Cartographer | Attention | Gold | `forums` | 12 | ... in 12 different forums. | About a quarter of the 43 forums (live count, 2026-10-08). |
| 9 | `tidy-desk` | Tidy desk | Care | Silver | `tidy` (0/1) | 1 | Follow at least 10 threads and leave none Unfiled. | Organization that pays off daily. The floor of 10 stops it being trivial. Folder rules count, because setting up rules is the skill. |
| 10 | `backlog-buster` | Backlog buster | Care | Silver | `bigBacklog` | 20 | Start a day with 20 or more in Catch up, make focused visits to 10 of those threads, and finish with Catch up empty. | Digging out after time away is the hardest real use. Tied to the backlog's own ids (5.5). |
| 11 | `streak-3` | Three days | Streak | Bronze | `best` | 3 | Finish 3 Torn days in a row with Catch up empty. | The early win, within the first week. |
| 12 | `streak-10` | Ten days | Streak | Silver | `best` | 10 | ... 10 days in a row. | |
| 13 | `streak-25` | Twenty-five days | Streak | Silver | `best` | 25 | ... 25 days in a row. | |
| 14 | `streak-100` | Hundred days | Streak | Gold | `best` | 100 | ... 100 days in a row. | |
| 15 | `streak-500` | Five hundred days | Streak | Legendary | `best` | 500 | ... 500 days in a row. | Bound to the calendar: no less than 500 days. |

**Tiers:** Bronze 6 (switched-on, first-folder, caught-up, reader, explorer,
streak-3). Silver 5 (well-travelled, tidy-desk, backlog-buster, streak-10,
streak-25). Gold 3 (bookworm, cartographer, streak-100). Legendary 1
(streak-500).

**Threshold arguments.**

- **Reader 25, Bookworm 500.** 25 is quick for an active user and about a week
  for a light one. That is a Bronze. 500 needs months even at 5 a day, so it
  is a Gold. A middle rung (100) was considered and dropped: the panel
  capped the catalogue at 15, and two forum rungs plus five streak rungs
  already carry the "next goal" pull.
- **Forums 3 / 7 / 12.** These are counted in distinct forum ids, not
  visits. The thresholds are spaced so each needs a deliberate visit to new
  territory. `forum/categories` listed 43 forums live on 2026-10-08
  (open question 1, PR #15), so 12 is about a quarter of the board.
- **Streaks 3 / 10 / 25 / 100 / 500**, as the owner set. All of them use
  `best`, so an earned streak badge is never in doubt after a break.

**Earned is permanent.** A rule that stops holding (folders deleted, a thread
unfiled) never revokes a badge.

**"Next goal".** The shelf names the visible unearned badge with the highest
`value / target`, ties broken by catalogue order. It was kept: it serves the
streak and attention ladders, which are not cut.

---

## 8. Display

### 8.1 Header layout (decided after the panel)

Three layouts were evaluated: an inline strip of icons with a `+K` count; a
single chip that opens a shelf; and a thin second header line. **The chip
wins.** It is one tap target of at least 28 px rather than many 16 px icons
with hover tooltips that do not exist on touch. It has a fixed width at any
badge count, and it is visible when collapsed. The second line was rejected
because it makes every collapsed panel taller forever.

**The head becomes two groups:**

```
<div class="tfcc-head">
  <div class="tfcc-head-id">                   title group
    <span class="tfcc-title">Forum Command Center</span>
    <button class="tfcc-chip" data-act="badges-shelf" aria-expanded="false" aria-label="...">
      [cup svg] 7  [streak svg] 12
    </button>
  </div>
  <div class="tfcc-head-ctl">                  control group
    <span class="tfcc-badge">3 new</span> <span class="tfcc-note">12 subscribed</span>
    <span class="tfcc-head-btns">[Refresh] [Expand] [Hide]</span>
  </div>
</div>
```

- `.tfcc-title` loses `margin-right: auto`. `.tfcc-head-ctl` gets
  `margin-left: auto` with `flex-wrap: wrap` and `justify-content: flex-end`.
  `.tfcc-head-btns` is `display: inline-flex; flex-wrap: nowrap`. **Refresh,
  Expand and Hide therefore stay together and in order.**
- **Retracted from the draft:** "0 lines". At 320 to 360 px, the control
  group may wrap onto its own line, as a unit, right-aligned under the title
  group. The head can be two lines at phone width. It already wraps today.
- The chip is `flex: 0 0 auto; white-space: nowrap; min-height: 28px`. It
  never grows.
- **The chip shows:** a **cup drawn in the tier color of the best earned
  badge**, the earned count, then a streak glyph and the current streak
  number. **Decision: not a featured-badge glyph.** A 16 px rendering of one
  badge's own art is illegible, and the cup's color carries the same
  information (the best tier) legibly. With no badges, the cup is drawn as an
  outline in `--tfcc-locked`. The streak segment is hidden until the first
  check-in. Its glyph is filled when today is counted and an outline when
  not, and the number is `0` after a break (5.2).
- **Clicks reach the button.** The current delegation reads `data-act` from
  `ev.target` only (section 3), so every child of the chip gets
  `pointer-events: none`. A tap on the cup or the number then targets the
  button. A test asserts the rule exists.
- `aria-label`, for example: `Badges: 7 of 15. Streak 12 days, today counted.
  Show badges.` `aria-expanded` reflects the shelf.
- The loading and fatal heads emit the same title group, chip included.
  Badges are loaded before the loading shell is drawn.
- With badges off, the title group holds only the title.

**#10's tracker is not in the title group.** #10's spec places it on its own
line, `.tfcc-subhead`, directly under the head, emitted after the collapsed
early return. This spec puts nothing in `.tfcc-subhead`. The shelf and toast
(below) render between `.tfcc-head` and `.tfcc-subhead`.

### 8.2 Mockups

Wide (about 900 px), shelf closed, #10 present:

```
+--------------------------------------------------------------------------------------+
| Forum Command Center [U 7 ^12]                 3 new  12 subscribed [Refresh][Expand][Hide] |
| Your threads: 34 up, 2 down                                       (#10's subhead)     |
+--------------------------------------------------------------------------------------+
  U = cup in the best tier's color     ^ = streak glyph, filled = today counted
```

Wide, shelf open:

```
+--------------------------------------------------------------------------------------+
| Forum Command Center [U 7 ^12]v                3 new  12 subscribed [Refresh][Expand][Hide] |
| +----------------------------------------------------------------------------------+ |
| | Streak 12 Torn days, today counted. Best 23.                                     | |
| | Next: Twenty-five days  [##########..........] 12 / 25                           | |
| | (G) Hundred days  (S) Ten days  (S) Tidy desk  (B) Caught up  +3 more            | |
| | 7 of 15 earned                                              [All badges]         | |
| +----------------------------------------------------------------------------------+ |
| Your threads: 34 up, 2 down                                                          |
```

Narrow (360 px, Torn PDA). The control group wraps as a unit:

```
+----------------------------------+
| Forum Command Center [U 7 ^12]   |
|   3 new 12 subscribed            |
|         [Refresh][Expand][Hide]  |
| Your threads: 34 up, 2 down      |
+----------------------------------+
```

Narrow, 320 px, collapsed after opening a thread (#8), with a toast. #10's
subhead is hidden when collapsed:

```
+------------------------------+
| Forum Command Center [U8 ^12]|
|     [Refresh][Expand][Show]  |
| Badge earned: Reader         |
| (Bronze). 475 more focused   |
| visits to Bookworm.      [x] |
+------------------------------+
```

At 320 px the title (about 165 px bold) and the chip (about 80 px) fit on one
line inside the 304 px content width. If a host font makes them wider, the
chip wraps under the title inside the title group. The controls are never
pushed off their own line.

### 8.3 The shelf

- Toggled by the chip. `state.badgeShelfOpen` is in memory only, false on load
  and never persisted (a shelf that stays open is a permanent second header).
- It renders directly under `.tfcc-head`, **also when collapsed**. It holds
  the streak sentence, the "next" goal with a progress bar, up to 6 earned
  badges as icon plus name (highest tier first, then newest), then
  `+K more`, the earned count, and **All badges**. That button
  (`data-act="badges-all"`) expands the panel if it is collapsed (Settings
  cannot be seen collapsed), switches to Settings, opens the catalogue and
  closes the shelf.
- When #8's auto-hide collapses the panel, it also closes the shelf
  (reconciliation in 10.1). Manual Hide leaves the shelf open.

### 8.4 The earn toast

- An in-panel line under the head (and under the shelf if it is open),
  **rendered when collapsed too**. For example: `Badge earned: Reader
  (Bronze). 475 more focused visits to Bookworm.` It names the next rung of the same ladder
  when there is one.
- Several at once make one toast: `2 badges earned: Ten days, Tidy desk.`
- Removed after `BADGE_TOAST_MS = 6000` by a runtime timer, or by its dismiss button
  (`data-act="badges-toast-dismiss"`). The removal redraw is a background
  redraw, so the existing guard defers it while an input has focus.
- **No sound, no modal, no focus change.** `role="status"` is present only on
  the toast's first render, so an `innerHTML` re-render does not make a screen
  reader announce it twice.
- **Motion** is opt-in CSS only: a 160 ms fade inside
  `@media (prefers-reduced-motion: no-preference)`. No JS reads `matchMedia`
  for this.

### 8.5 Icons: SVG from ASCII strings

- `badgeIcon(tier, glyph, size)` returns
  `<svg class="tfcc-ico tfcc-tier-<tier>" viewBox="0 0 16 16" width=".." height=".." aria-hidden="true" focusable="false"><path d="FRAME"/><path d="GLYPH"/></svg>`.
  The path data is ASCII (`M L A Z` and digits). There are no emoji, no icon
  fonts, no images and no `<text>`. The chip uses its own `cup` and `streak`
  glyphs. Catalogue rows use frame plus glyph at 20 px.
- Glyphs: `plug` (Switched on), `folder` (First folder), `check` (Caught up),
  `book` (Reader, Bookworm), `compass` (Explorer, Well travelled,
  Cartographer), `trays` (Tidy desk), `broom` (Backlog buster), `flame`
  (streaks). Frames by tier (4.2).
- **The host stylesheet can repaint SVG.** A host `svg path { fill: #333 }`
  beats a `fill` attribute, so fill is set in CSS at (1,1,1):
  `#tfcc-panel .tfcc-ico path { fill: currentColor; stroke: none; }`. Color
  is set by `#tfcc-panel .tfcc-tier-gold { color: var(--tfcc-tier-gold); }`
  at (1,1,0), which beats the (1,0,0) inherit floor. The hostile preview sheet
  gains `svg, svg * { fill: #000; color: #000; }` to prove it.

### 8.6 Color and contrast, in every theme

New tokens in **both** theme blocks. Match Torn applies one of the two classes,
so it is covered by them.

| Token | Dark | vs #1f1f1f | vs #111 | Light | vs #f2f2f2 | vs #fff |
|---|---|---|---|---|---|---|
| `--tfcc-tier-bronze` | `#d6955b` | 6.52 | 7.47 | `#8c4e17` | 5.83 | 6.53 |
| `--tfcc-tier-silver` | `#c3ccd6` | 10.15 | 11.63 | `#4f5966` | 6.35 | 7.11 |
| `--tfcc-tier-gold` | `#e8c06a` | 9.56 | 10.95 | `#7a5600` | 5.94 | 6.65 |
| `--tfcc-tier-legend` | `#c9a2ff` | 7.92 | 9.08 | `#6a2fb5` | 6.98 | 7.82 |
| `--tfcc-locked` | `#8a8a8a` | 4.77 | 5.47 | `#6e6e6e` | 4.55 | 5.10 |

Every pair clears 4.5:1, so the tokens are safe for tier label text as well.
Icons need 3:1. `tests/contrast-audit.mjs` measures text only and cannot see
an SVG fill. `tests/style.test.js` therefore computes every `--tfcc-tier-*`
and `--tfcc-locked` token against `--tm-bg`, `--tm-bg-2` (the shelf and toast
surface; its weakest pair is `--tfcc-locked` in light, about 4.2:1) and
`--tm-bg-3` in both blocks and requires at least 3:1. The existing "light
overrides every color" check matches `--tm-` only, so a companion check
requires every `--tfcc-tier-*` and `--tfcc-locked` token set in the dark block
to be set in the light block too.

### 8.7 The Settings catalogue and the off toggle

A **Badges** section is appended after Storage, before the version footer:

```
Badges
  [x] Show badges and record progress
  Earned from what you do here: focused visits to threads, finishing Torn days
  with Catch up empty, and organizing. A day is a Torn day (00:00 TCT).
  Nothing is sent anywhere, and no request is made. Turning this off stops
  recording; a streak does not survive days with it off.
  [Show all 15 badges]                                   7 of 15 earned
  (expanded, grouped Setup / Presence / Attention / Care / Streak)
    (B) Switched on        Earned 8 Oct 2026
        Save an API key and finish a refresh.
    (o) Reader             [#############.......] 18 / 25 focused thread visits
        Make 25 focused thread visits. A thread counts once a Torn day,
        after 15 seconds with this page in front.
    ...
  Streak: current 12, best 23.
```

- The expander is a `button` with `aria-expanded`
  (`data-act="badges-catalogue"`), not `<details>`, whose open state an
  `innerHTML` redraw would lose. `state.badgeCatalogueOpen` is in memory and
  false on load.
- Each row has the icon (locked frames use `--tfcc-locked`), the name, the
  tier as text, the rule text from `BADGES`, and either the earned date or a
  progress bar. The bar is a `div` with `role="progressbar"`, `aria-valuenow`
  and `aria-valuemax`, with the text value beside it. 0/1 metrics show "Not
  yet".
- **The off toggle** (`data-act="badges-toggle"`) sits outside the expander.
  Off means no chip, no shelf, no toast and no recording, because
  `recordBadgeEvent` returns first. `tfcc:badges` is kept, so turning badges
  back on resumes the history. Days while off are missed days, and the text
  says so.

---

## 9. Reset, import, export, debug

- **Reset everything really resets.** It writes `freshBadges()`, clears
  `state.badges`, the shelf, the catalogue state, queued toasts and the dwell
  accumulator. After it, nothing is granted except by a new event: a fresh
  successful refresh can earn Switched on again, *with a toast*, because the
  user really did refresh. Nothing is re-awarded silently. There is no
  backfill flag and no backfill pass.
- **Backfill was considered and rejected.** The draft granted state-based
  badges silently on upgrade. The panel rejected it for two reasons: it grants
  badges with no evidence trail, and it would silently re-award after Reset
  everything. Upgraders instead earn First folder and Tidy desk at their next
  organizer change or refresh, each with a toast. That is a small, honest
  welcome back.
  - **State-based badges are evaluated only on an event.** The `tick` event
    fires after a handler persists the organizer, and `refreshed` fires on
    refresh success. Neither fires on load, on render, or from
    `captureVisit`.
- **Export** adds a `badges` block: `{ visits, checkinDays, bigBacklog,
  firstCheckinAt, streak, forums, earned }`. `today` is scratch and is not
  exported. `payload.v` stays 1. An older build ignores the field.
- **Import restores badges: yes.** `mergeBadgeRecords(local, incoming)` is
  pure:
  - `earned`: union, keeping the earlier time;
  - counters: **max**, never sum, so a self-import is a no-op;
  - `forums`: union, capped at 64;
  - `streak`: the one with the larger `lastDay` (on a tie, the larger
    `current`), with `best = max`;
  - `firstCheckinAt`: the earlier non-zero value.

  The import notice gains "and N badges". A restore after Reset everything is
  the user's explicit act and is reported, not silent. Two devices'
  activity under-counts (max, not sum). That is the safe direction.
- **Reset folders and tags** does not touch badges.
- **Debug report:** `badges: on/off`, `badges earned: N`,
  `streak: current/best`, `check-in days`, `focused visits`. These are
  scalars only, with no ids. The key never enters `tfcc:badges`, the export
  block, a toast or the report, and a test plants a key and greps all four.

---

## 10. Sibling work: self-contained, and how the second PR reconciles

This feature runs correctly on current `main` with none of the siblings
merged. For each sibling, whichever PR merges **second** does the
reconciliation. The steps are given for both orders, and a test makes the
second PR fail until it is done.

### 10.1 #8 Auto-hide on open (shared `isRecoveredValue`)

- **#8 first:** `isRecoveredValue` is on `main`. This PR does not add it. It
  only adds the badges tests that rely on it. In `panelHtml` the chip already
  sits in the head, so #8's collapse shows it. Add to #8's `onThreadLink`
  path: `state.badgeShelfOpen = false`. Test: "auto-hide closes the badge
  shelf".
- **#9 first:** this PR adds `isRecoveredValue` byte-identical to #8's plan
  Task 1 Step 6, including its test, placed in `tests/badges-storage.test.js`.
  When #8 rebases, it **drops** its own Step 6 code (keeping its test, which
  then passes as is), and adds `state.badgeShelfOpen = false` to its
  auto-hide path along with the same test.
- Either way: a test renders a collapsed panel and asserts the chip is
  present (in this PR), and the dwell accumulator is unaffected by collapse.

### 10.2 #2 My posts (PR #5)

- Catch up stays `inThreads` rows only in #2, so the check-in is unchanged in
  meaning.
- **#2 first:** `checkinBlockers` must count exactly what `model.catchUp`
  counts. If #2 changed `buildPanelModel`'s catch-up expression (for example
  to filter `inThreads`), copy that expression into `checkinBlockers`. The
  parity test "the check-in counts exactly the rows the Catch up view shows"
  (built from `buildPanelModel(now).catchUp.length`) fails until it matches.
- **#9 first:** #2 runs the same parity test after its change, and updates
  `checkinBlockers` in the same commit.
- Storage: `tfcc:mine` and `tfcc:badges` both join `loadAll`, `persist`'s map
  and Reset everything. On conflict, keep both sides. The test "Reset
  everything resets every key except the API key" iterates `STORAGE_KEYS`, so
  it fails if either is left out.

### 10.3 #4 Only flag author updates (PR #7)

- **The rule:** with author-only mode on, the "not yet checked" rows block a
  check-in at that moment. A later ordinary refresh the same TCT day can check
  them and credit the day. There is no badge-triggered refresh and no credit
  for an earlier day.
- **#4 first:** in `checkinBlockers`, use #4's `catchUpList(rows, at, mode)`
  for the main list, and add the count of rows that #4's Catch up shows in
  its "Not yet checked" group when `settings.authorOnly` is true. Tests: "an
  unchecked-only Catch up does not credit a check-in", and "after a refresh
  checks them, a same-day check-in credits".
- **#9 first:** #4 makes the same change to `checkinBlockers` and adds the
  same two tests. The parity test (10.2) is extended to include the unchecked
  group when mode is on.

### 10.4 #3 Rows shown (PR #6)

- The check-in counts the **full** list, never `model.capped`.
- **#3 first:** add the test "a cap of 3 with 5 Catch up rows does not credit
  a check-in". **#9 first:** #3 adds the same test. The parity test already
  reads `model.catchUp`, the full list in #3's design.

### 10.5 #10 Reactions tracker

- #10 puts its tracker in `.tfcc-subhead` after the head, hidden when
  collapsed, and adds nothing to `.tfcc-head`. This PR adds nothing to
  `.tfcc-subhead`. The badge shelf and toast render between the head and the
  subhead.
- **#10 first:** this PR's head split must keep `.tfcc-subhead` immediately
  after the shelf and toast, and leave #10's tests unchanged. **#9 first:**
  #10 emits its subhead after `renderBadgeShelf` and `renderBadgeToast`.
  Test (in whichever lands second): "the subhead follows the badge shelf".

---

## 11. Security and constraints

- **Engine purity.** `tctDay`, `creditDay`, `streakView`, `dwellStep`,
  `checkinEligible`, `badgeFacts`, `badgeMetrics`, `evaluateBadges`,
  `applyBadgeEvent`, `freshBadges`, `normaliseBadges`, `mergeBadgeRecords`,
  `badgeIcon`, `isRecoveredValue` and `BADGES` are all pure and take `now` as
  an argument. `tests/purity.test.js` covers them by position.
- **ASCII only**, including every SVG path and string.
- **ADR 0001:** no new access to Torn's markup. The dwell sampler reads
  `location` (through `parseForumRoute`), `document.hidden` (already read by
  auto refresh) and `document.hasFocus()` (likewise), and listens to window
  focus and blur and `visibilitychange`. These are page lifecycle signals,
  not markup. No ADR and no outbox note are needed.
- **`@match`, `@grant`, `@connect`:** unchanged.
- **Requests:** zero. `tests/badges-runtime.test.js` has the case "badge events
  never make a request", and the existing `tests/read-only.test.js` still
  holds because nothing here calls the transport.

## 12. Testing strategy (detailed in the plan)

- `tests/badges-engine.test.js`: `tctDay` at TCT midnight (23:59:59.999 and
  00:00:00.000). `creditDay` for first, same day, +1, +2 and +30 days, and
  negative deltas including a 3-day future stored day and recovery. Best kept
  after a break. 499 vs 500. `dwellStep` with an explicit clock: accumulate,
  pause on inactive, resume, route reset, the step cap, a backwards clock,
  done once. `checkinEligible`: every rule, with 29 vs 31 minutes freshness.
  Backlog: 19/20 first look, 9/10 backlog visits, and ten non-backlog visits
  do not count. Every catalogue entry at below, at and above target. The
  normaliser and merge.
- `tests/badges-runtime.test.js`: the dwell sampler with the harness clock,
  covering hidden, blur, refocus, route change and takeover. Once per thread
  per day. Two tabs sharing one store. Renders never write. Check-in
  triggers. Toast. Chip in collapsed, loading and fatal heads. Off writes
  nothing. Reset, export, import. Handler coverage.
- `tests/harness.test.js`: the two opt-in harness options the sampler and
  multi-tab tests depend on, `stepClock` (Date.now moves with each timer) and
  `sharedGmStore` (two sandboxes over one store), each proven on its own.
- `tests/badges-storage.test.js`: upgrade silence (6.2) and `isRecoveredValue`.
- `tests/style.test.js`: tokens in both blocks, 3:1 computed, the icon fill
  rule, `pointer-events: none` in the chip, motion only under
  `no-preference`, and the control-group rules.
- `tests/render-preview.mjs`: the chip, shelf, toast, collapsed and catalogue
  states at **320 px and 360 px**, in dark, light and Match Torn (resolved
  both ways), plain and hostile.
- Mutation-check entries for each promise (plan, Task 12).

## 13. Open questions

1. **How many forums does `forum/categories` list?** **Answered:**
   43, live on 2026-10-08 (`docs/reference/torn-api-live-findings-2026-10-08.md`
   finding 14, fixture `tests/fixtures/forum-categories.json`, PR #15).
   Cartographer at 12 is about a quarter of the board, so the threshold
   stands and is no longer a release gate. A faction forum outside that list
   can also count, so 43 is a lower bound on what is reachable.
2. **Torn PDA cross-tab storage.** Does PDA's `GM_getValue` see another PDA
   tab's write? If not, two PDA tabs can each count the same visit once. This
   is accepted under best-effort accounting.
3. **Opening a thread puts it into Catch up** (section 3). Reaching "caught
   up" by reading is harder than by clicking. A Catch up change for all users
   is out of scope; it may deserve its own issue.
4. **Does `document.hasFocus()` behave in Torn PDA's webview?** If it always
   returns true, the only effect is that a backgrounded app with the page
   still "visible" can accrue time. `hidden` usually covers that. QA line.
