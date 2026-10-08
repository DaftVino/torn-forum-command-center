# Badges - design

**Status:** proposed, 2026-10-08. Awaiting a deliberation pass, then
`/plan-eng-review`. No plan exists yet.
**Issue:** #9. Shares the header with #10 (reactions tracker). Interacts with
#2 (My posts, PR #5), #3 (row cap, PR #6), #4 (author-only, PR #7) and #8
(auto-hide on open, spec in progress).
**Target release:** the next minor cut from `main` after this lands. Like #2,
#3 and #4, the feature PR adds an `## [Unreleased]` CHANGELOG entry and does
not bump `@version`; one release commit moves `@version`, `SCRIPT_VERSION`,
the newest CHANGELOG heading and the tag together (constraint 8).

Every decision below is stated as a decision, with its reason and the
alternative it beat. The reviewers should argue with the reasons, not hunt for
the decision.

---

## 1. Goal, and the one principle everything follows from

The command center pays off when it is used regularly: set up once, organised,
and caught up most days. Nothing currently rewards that habit. The goal is a
small, honest bump of satisfaction for doing what the user already came to the
panel to do. It should scale with skill and regularity, and it must never pay
for busywork.

**The principle: two kinds of evidence, two kinds of reward.**

| Kind | What it rewards | Evidence | Badges |
|---|---|---|---|
| **Presence** | Showing up and leaving the forums handled | Catch up is empty against fresh data, on a calendar day | Streaks, totals, "Caught up" |
| **Reading** | Actually reading, and organising what you read | A thread page stayed open and visible for 15 seconds, plus organiser state | Volume, skill, care |

Presence accepts triage. Clearing Catch up with Mark all read is a real
decision ("none of this matters to me today"), and the script cannot tell a
skim from neglect, so it does not try. Reading badges never accept a click as
reading. No badge in the reading kind can be earned without dwell evidence or
organiser state the user built. This split is how the design answers "do not
reward Mark read without reading" without punishing the user who triages
honestly.

## 2. Non-goals

- **No API requests.** Badges come only from what the script already sees.
  The request budget (13 per default refresh, 40 per rolling minute) and its
  Settings text do not change.
- **No new DOM access to Torn's markup.** ADR 0001 holds. Evidence comes from
  `location`, `document.title`, `document.hidden` (already read by auto
  refresh), our own panel, and our own state.
- **No points, levels, leaderboards, sharing or server.** See section 10.
- **No reminders, nags, "streak at risk" warnings, or anything outside the
  panel.** No sound, no modal, no notification.
- **No tamper-proofing against the device owner.** All state is local and
  editable by the user. Anti-gaming here means *not designing an incentive
  for busywork*. It does not mean stopping a user from cheating themselves.
- **No badge for reactions received** (#10's likes, dislikes, subscribers).
  See section 10.

---

## 3. Current behaviour this design builds on (verified at `884f614`)

Line numbers are from `884f614`. `docs/code-map.md` was generated at
`d866047` and lags `c4d91e1` by a few lines.

- **Capture.** `captureVisit` (l.2098) runs from `syncToRoute` (l.3563) on
  *every* navigation callback. That includes the debounced `MutationObserver`,
  which fires on Torn's own React churn. Each call sets `lastVisitedAt = now`
  on the open thread. **A captured visit is therefore not an event. It is a
  state that is re-asserted many times a minute.** Counting `captureVisit`
  calls would count renders. Section 6.2 replaces it with a dwell timer.
- **Captured visits create organiser entries.** `captureVisit` adds a
  `threads[id]` entry for any thread opened, subscribed or not. So "threads
  the panel tracks" is not a meaningful filter: every opened thread becomes a
  row.
- **Catch up.** `catchUpList` (l.911) keeps a row when it is not dismissed and
  either `unread > 0` or `lastActivity > lastCatchUpAt`. `lastActivity`
  includes the `visit` candidate. **Side effect:** opening a non-dismissed
  thread on Torn puts it into Catch up until Mark read or "Set catch-up point
  to now". This design does not change that. It is open question Q5, because
  the streak is only as legible as Catch up.
- **Mark read** (l.1236) sets `lastSeenTotal` and `lastVisitedAt`. **Mark all
  read** (`markall`, l.3397) does that for every row, so one click dismisses
  every row with a known total. **Set catch-up point to now** (`catchup-done`,
  l.3403) moves `lastCatchUpAt` only. Rows with `unread > 0` stay.
- **Header.** `panelHtml` (l.2967) emits `.tfcc-head` holding the title,
  the `N new` badge, `N subscribed`, then Refresh, Expand and Hide. The
  collapsed panel returns right after the head (l.2991). The loading and fatal
  variants emit a head with only the title (l.2969, l.2973). CSS (l.2351):
  `.tfcc-head` is `display: flex; flex-wrap: wrap`, and `.tfcc-title` has
  `margin-right: auto`.
- **Storage.** `persist(which)` (l.1876) writes the whole in-memory value of
  one key. `loadKey` (l.1568) reports a key as "damaged" whenever
  `JSON.stringify(raw) !== JSON.stringify(normalised)`. A normaliser must
  therefore read back its own output byte for byte (the c4d91e1 lesson).
- **Cross-tab.** `@grant` is `GM_setValue`, `GM_getValue` and
  `GM_xmlhttpRequest`. There is no `GM_addValueChangeListener`, so a tab never
  hears about another tab's writes. Two tabs that each `persist` an in-memory
  copy lose updates, last writer wins. That is true of every key today.
- **Export.** `encodeState` (l.1347) writes folders, organiser fields and
  drafts. `decodeState` (l.1404) rejects any payload whose `v` is not
  `SCHEMA_VERSION`, and ignores fields it does not know. Settings are not
  exported (#3 relies on that).
- **Reset everything** (l.3491) resets every key except the API key.
- **Auto refresh** only runs when the tab is visible and focused (l.3589-3590).

---

## 4. Motivation design

### 4.1 What the research says, and what this design takes from it

| Mechanism | What works | The dark side | Decision here |
|---|---|---|---|
| **Fixed vs variable rewards** | Variable-ratio schedules (slot machines, loot) produce the most persistent and most compulsive behaviour. Fixed, legible criteria produce less compulsion and more sense of control. | Variable rewards are the core of manipulative design. They reward checking, not achieving. | **Every badge is deterministic and its rule is published.** No chance, no random drops, no mystery boxes. The only variability is natural (some days the forums are quiet), and quiet days are designed *not* to cost anything (4.3). The three hidden badges are surprising in *discovery* only. Their rules are fixed and are shown once earned. |
| **Goal-gradient effect** | Effort rises as a goal gets closer (Hull; Kivetz et al., coffee cards). A visible "3 more to go" pulls people over the line. | Endless ladders turn into chores. | Progress bars in the catalogue. The shelf shows **one** "next" goal, the nearest unearned badge, never a wall of them. Ladders are short (4 reading steps, 6 streak steps) and end. |
| **Streaks and loss aversion** | Losing something feels about twice as bad as gaining it. Streaks harness that, and they do build habits. | Streak anxiety. The "what-the-hell effect": after one break, people abandon the habit entirely. That is the opposite of the goal. | Earned **rest days** absorb occasional misses (4.3). **Best-ever is kept forever**, and so is every badge. A break shows as `0 (best 23)` in neutral colour. No red, no "you lost". A hidden **Back again** badge rewards returning after a break, at exactly the moment the user would otherwise quit. Totals ("Fifty days", any order) reward regularity that is not unbroken. |
| **Competence feedback** | Self-determination theory: rewards that inform ("you got good at this") support intrinsic motivation. Rewards that control ("do this to get that") undermine it (the overjustification effect). | Paying for an activity can make the activity feel like work. | Badges are named for what the user became ("Tidy desk", "Backlog buster"). They are not named for a quantity of clicks. Rules reward the outcome the user wanted anyway (a handled Catch up, an organised list), never a tally of actions. |
| **Rarity tiers** | Scarcity makes a reward meaningful. A visible ladder of rarity gives long-term goals. | Rarity that only comes from grinding is just a chore with a medal. | Four tiers by *expected time for a daily user*, not by action count (4.4). Legendary takes more than a year of real use and cannot be rushed: a streak needs calendar days, so no amount of clicking speeds it up. |
| **Endowed progress** | People who start with some progress finish more often. | Fake head starts are a known dark pattern. | Existing users get their **real** setup badges backfilled on upgrade (8.5). Nothing is granted that was not done. |

### 4.2 The verbs that count, and how each is evidenced

| Verb | Counts? | Evidence | Dedupe and anti-gaming |
|---|---|---|---|
| **Read a thread** | Yes, reading kind | The route stays on the same thread for `READ_DWELL_MS = 15000` while `document.hidden !== true` and the panel is not in Expand (takeover) mode. Runtime timer, section 6.2. | Once per thread per badge day. A cap of 200 distinct threads per day. Re-renders, React churn and repeated `captureVisit` cannot add a read, because the timer is armed once per thread change and the record dedupes by id. |
| **Mark read** (one row) | No count of its own | It can empty Catch up, which is a presence check-in. | Clicking it repeatedly does nothing: the check-in is once per day. |
| **Mark all read** | No count of its own | Same as Mark read. | Same. It never counts as reading (Q1). |
| **Set catch-up point to now** | No count of its own | Same. | Same. |
| **Catch up reaches empty** | Yes, presence: a **check-in** | Catch up's main list is empty, with fresh data (a successful refresh on the same badge day, at most 30 minutes old), and at least one subscribed thread. | Once per badge day, by construction. Refreshing more does nothing. |
| **Catch up already empty when opened** | Yes, presence: a **quiet check-in** | The first successful refresh of the day finds Catch up empty. | Same. A quiet week must not cost a streak. That is the whole reason this counts. |
| **Catch up cleared after reading** | Yes, skill: a **cleared day** | The check-in happens on a day whose first look was non-empty, and at least one thread was read that day. | Feeds Clean sweep and Backlog buster only. |
| **Create a folder and file into it** | Yes, setup, once | Organiser state: a folder that is not a starter folder holds at least one thread. | State-based and earned once. Toggling cannot re-earn it. |
| **Tag, pin** | Yes, setup, once | Organiser state. | Same. A pin toggled on and off earns First pin, once. That is acceptable: setup badges teach the feature, cost a click, and never repeat. |
| **Tags used well** | Yes, care | 3 distinct tags, each on 3 or more threads. | State-based. Creating empty tags is impossible, because a tag only exists on a thread. |
| **Folders kept tidy** | Yes, care | 10 or more subscribed threads and none unfiled. | State-based. Auto-assign rules count, because setting up rules is the skill. |
| **Save a draft** | Yes, setup, once | `tfcc:drafts` has an entry. | Earned once. |
| **Insert a draft into the reply box** | Yes, care | The `draft-insert` handler succeeds (`insertDraft` returns `ok`). | Once per thread per badge day. |
| **Refresh** | **Never** | | Only the first successful refresh ever counts, as part of "Switched on". Refresh counts are never a badge (section 10). |
| **Export, import, theme, sort, filters** | Never | | One-click actions with no outcome to reward. |

### 4.3 The streak in one paragraph (precise rules in section 5)

A **check-in** is a badge day on which Catch up ended empty against fresh data.
The streak counts consecutive check-in days. A day starts at 04:00 local time
by default, so a night owl's 01:30 session belongs to the day before. A day
with nothing to catch up still counts, as long as the panel refreshed that
day. Every 7 consecutive check-ins earn one **rest day**, up to 2 banked. A
missed day spends a banked rest day automatically, and the streak survives
without growing. A break that the bank cannot cover resets the current streak
to 1 on the next check-in. Best-ever, every badge and the banked rest days are
kept.

### 4.4 Tiers

| Tier | Frame shape | Expected time for a daily user | Count |
|---|---|---|---|
| Bronze | circle | under a week | 10 |
| Silver | hexagon | under two months | 10 |
| Gold | octagon with a notch ring | under a year | 3 |
| Legendary | double ring | over a year | 2 |

The tier is carried by the **frame shape and by text**, as well as by colour
(WCAG 1.4.1). Colour alone is never the signal.

---

## 5. Streak semantics, precisely

### 5.1 The badge day

```
badgeDay(now, tzOffsetMin, dayStartHour) =
  floor( (now - tzOffsetMin * 60000 - dayStartHour * 3600000) / 86400000 )
```

- `now` is epoch milliseconds. `tzOffsetMin` is `Date#getTimezoneOffset()` *at
  `now`*, computed in the runtime and passed in. Its sign is the platform's:
  UTC+10 is `-600`, UTC-5 is `300`, Nepal is `-345`. `dayStartHour` is a
  setting.
- `now - tzOffsetMin * 60000` is local wall-clock time expressed as if it were
  UTC, so the floor is the local calendar date's ordinal. Subtracting
  `dayStartHour` hours moves the boundary from midnight to that hour.
- **Decision: a rollover hour, not a separate grace window.** A grace hour
  plus midnight is two concepts that produce the same thing as one shifted
  boundary, and two concepts are harder to explain. Anki solved the same
  problem the same way ("next day starts at 4").
- **Setting:** `settings.dayStartHour`, menu `0..6`, default `4`. Shown as "A
  day starts at 04:00". The menu stops at 06:00 because a later start would
  make an early-morning session count for the previous day, which is
  surprising. A night-shift worker who needs a day starting at noon is open
  question Q7.
- **DST.** The offset is taken at the event's own `now`, so the local date is
  always right. Across a transition, the indices of two consecutive local dates
  still differ by exactly 1, even though the day was 23 or 25 hours long. In
  the repeated hour of a fall-back, both instances map to the same day. Tests
  pin both transitions.

### 5.2 The streak record

```
streak: {
  current: int >= 0,       // consecutive check-in days, as of lastDay
  best: int >= 0,          // never decreases
  lastDay: int,            // badgeDay of the last credited check-in; -1 = never
  bank: 0..2,              // rest days banked
  toNextRest: 0..6,        // check-ins since the last rest day was earned
  clearRun: int >= 0,      // consecutive cleared days (for Clean sweep)
  comebackArmed: bool      // a streak of 7 or more has broken since
}
```

A streak needs only the last qualifying day plus counts. There is no per-day
array anywhere.

### 5.3 Crediting a check-in: `creditCheckin(streak, today)`

Let `delta = today - lastDay`.

| Case | Effect | Why |
|---|---|---|
| `lastDay = -1` | `current = 1`, `lastDay = today`, `toNextRest = 1` | First ever. |
| `delta = 0` | no change | Once per day. This is the refresh-spam guard. |
| `delta = -1` | no change | The clock went back across one boundary: travel west, a rollover-hour change, or a clock fix. Treat it as the same day. Never decrease. |
| `delta <= -2` | `lastDay = today`. `current`, `best`, `bank` unchanged. `checkinDays` not incremented. | The clock was in the future and has been corrected, or the device clock is wrong. Without this rebase, a stored `lastDay` in 2030 would block every check-in for years. Neither break nor extend: an accident must never cost or pay. |
| `delta = 1` | `current += 1` | Consecutive. |
| `delta >= 2`, `missed = delta - 1 <= bank` | `bank -= missed`, `current += 1` | Rest days bridge the gap. The bridged days do not add to `current`: the count is of real check-ins. |
| `delta >= 2`, `missed > bank` | `if current >= 7: comebackArmed = true`. `current = 1`, `clearRun = 0`, `toNextRest = 0`. `bank` is **kept**. | A break. Best-ever stays. Banked rest days were earned by past regularity, and taking them away on top of the streak doubles the sting that makes people quit. |

After any case that credits (all except `delta <= 0`):
`best = max(best, current)`, `toNextRest += 1`, and
`if toNextRest >= 7: toNextRest = 0, bank = min(2, bank + 1)`.
`checkinDays += 1`. If `firstCheckinAt = 0`, it is set to `now`.

### 5.4 Displaying the streak: `streakStatus(streak, today)`

Display never mutates storage. Breaking happens lazily, at the next credited
check-in.

| `delta` | Shown | State |
|---|---|---|
| `lastDay = -1` | nothing (the streak segment is hidden) | `none` |
| `<= 0` | `current`, filled glyph | `counted` (today is done) |
| `1` | `current`, outline glyph | `open` (today not yet) |
| `>= 2`, `missed <= bank` | `current`, outline glyph, shelf says "1 rest day will cover yesterday" | `open-resting` |
| `>= 2`, `missed > bank` | `0`, with `best N` in the shelf | `broken` |

**Decision: no "at risk" state.** An outline glyph quietly shows that today is
not counted yet. There is no warning text, no colour change, no countdown. A
countdown is the single most anxiety-producing element of streak design, and
it pushes toward a check-in made for the streak's sake.

### 5.5 What makes a day a check-in

All must hold, evaluated by the pure `checkinEligible(...)`:

1. Badges are on (`settings.badges === true`).
2. **Fresh data.** The record has a **first look** for today (5.6), and
   `state.feed.fetchedAt >= now - CHECKIN_FRESH_MS` (30 minutes). An empty
   Catch up from a stale cache, a missing key or a rejected key never counts.
3. At least one subscribed thread (`state.feed.subscribed.length >= 1`).
   Without this, an account that follows nothing gets a free streak.
4. Catch up's **main list** is empty: `catchUpList(rows, lastCatchUpAt)`,
   unfiltered and **uncapped**. With #4 on, this is the author-mode list, and
   the "not yet checked" group does not block (section 9.3). With #3, it is
   the full list, never `model.capped`.

It is evaluated at three points: when a refresh succeeds, after any handler
that can shrink Catch up (`read`, `markall`, `catchup-done`, `archive`), and
after a draft or organiser change (cheap, idempotent).

**Decision: an auto refresh may credit a quiet check-in.** Auto refresh only
runs in a visible, focused tab, which means the user is there.

**Decision: a check-in while the panel is collapsed counts.** The collapsed
head still shows `N new` and the badge chip, so "nothing new" is visible. With
#8, collapsed is the normal state on a thread page. Requiring the panel to be
expanded would make the streak depend on a layout preference.

### 5.6 The first look of the day

The first successful refresh on a badge day records
`today.firstLook = catchUpList(...).length` (main list, uncapped). Later
refreshes that day do not change it. It decides:

- **quiet check-in**: `firstLook = 0` and the other rules hold. Credited at
  that refresh.
- **cleared day**: the check-in happens with `firstLook > 0` *and*
  `today.reads >= 1`. Then `clearedDays += 1` and `clearRun += 1`.
- **triage day**: the check-in happens with `firstLook > 0` and
  `today.reads = 0`. It counts for the streak, sets `clearRun = 0`, and is not
  a cleared day. This is the Mark-all-read-without-reading case. It keeps the
  user's presence streak and earns no reading credit.
- A quiet check-in leaves `clearRun` unchanged. A quiet day is not a failure
  of skill.
- **Backlog**: at a cleared check-in, `bigBacklog = max(bigBacklog, firstLook)`
  if `today.reads >= 10`.

**Edge, decided:** with `dayStartHour = 0`, a refresh at 23:58 and a clear at
00:05 do not credit the new day. The new day has no first look until a refresh
on it. With the default of 04:00 this almost never arises, and page load
refreshes anyway.

### 5.7 Clock changes and travel, summarised

| Situation | Result |
|---|---|
| Clock or zone moves back within the same day | `delta = 0`, nothing |
| Travel west repeats a calendar day | `delta = 0` or `-1`, nothing. The streak never decreases. |
| Travel east skips a calendar day (date line) | `delta = 2`. A banked rest day covers it, or it is a break. Accepted and documented. |
| Clock set years forward, then corrected | One check-in credited in "2030". On correction, `delta <= -2` rebases without credit or loss. |
| Clock set a day forward to farm one extra day | Works, once per manipulation. Not defended (non-goal: the device owner). |
| `dayStartHour` changed 4 to 0 at 02:00 | Can make the current night a new day, once. Accepted: one setting change, one day. |
| `dayStartHour` changed 0 to 4 at 02:00 | `delta` becomes 0 or -1. Nothing. |
| Badges turned off for 5 days, then on | The off days were missed days. Rest days apply, else it is a break. The Settings text says "Turning badges off pauses recording; a streak does not survive a long pause." (Q8) |

### 5.8 Purity

`badgeDay`, `creditCheckin`, `streakStatus`, `checkinEligible`,
`applyBadgeEvent`, `evaluateBadges`, `badgeFacts`, `normaliseBadges`,
`freshBadges`, `mergeBadgeRecords` and the `BADGES` catalogue all live in the
engine section. Every one takes `now`, `tzOffsetMin` and `dayStartHour` as
arguments where it needs them. None calls `Date`, a timer or storage.
`tests/purity.test.js` covers them by position, unchanged. The runtime
computes `tzOffsetMin` as `new Date(now).getTimezoneOffset()` and passes it in.

---

## 6. Data and engine

### 6.1 Storage key `tfcc:badges`

A new key: the seventh, or the eighth if #2's `tfcc:mine` lands first. It is a
separate key and not a field of `tfcc:organizer`, so that a damaged badge
record costs only badges, and adding it does not change the organizer's
stored shape, which would trip `loadKey`'s damaged check for every existing
user (the reason #2 gave for `tfcc:mine`).

```
tfcc:badges = {
  v: 1,
  // Counters are TOP-LEVEL on purpose (see "The upgrade trap" below).
  reads: int,              // distinct (thread, badge day) dwell reads, all time
  checkinDays: int,        // credited check-in days, all time
  clearedDays: int,        // cleared days (5.6), all time
  draftInserts: int,       // distinct (thread, badge day) successful inserts
  bigBacklog: int,         // largest first look cleared with >= 10 reads that day
  streak: { current, best, lastDay, bank, toNextRest, clearRun, comebackArmed },
  forums: [int],           // distinct forum ids with a credited read, max 64
  today: {
    day: int,              // badgeDay this block describes; -1 = none
    firstLook: int,        // -1 = no successful refresh yet today
    reads: int,
    readIds: [string],     // thread ids read today, max 200
    insertIds: [string]    // thread ids with a draft inserted today, max 50
  },
  earned: { "<badge id>": ms },   // earn time; max 64 entries
  firstCheckinAt: ms,      // 0 = never
  backfilled: bool         // the one-time upgrade backfill has run
}
```

**Bounded, by construction.** The only arrays are `forums` (64), `readIds`
(200) and `insertIds` (50). The `today` block is replaced whenever the badge
day changes, so per-day ids never accumulate. `earned` is capped at 64. The
worst case is a few kilobytes.

**`earned` keeps unknown ids.** The normaliser keeps any key matching
`/^[a-z0-9-]{1,32}$/` with a positive integer value, up to 64, even if the
running version's catalogue does not know it. Otherwise a downgrade followed
by an upgrade would silently delete badges a newer version had awarded. The
display ignores ids it does not know.

**The normaliser is total and reads back its own output.** Every field has a
type check and a clamp, every array is filtered and capped, and
`today.readIds` entries must match `/^[0-9]{1,12}$/`. The output's key order is
fixed and is the writer's key order, so `loadKey` never reports a freshly
written record as damaged. Test: `normaliseBadges(normaliseBadges(x))`
stringifies identically to `normaliseBadges(x)`, for the fresh record, a
populated record, and a damaged one. A `v` greater than 1 returns a fresh
record. That is the existing convention for every key.

### 6.1a The upgrade trap (load silently, now and later)

`loadKey` (l.1568) sets
`recovered = raw !== null && JSON.stringify(raw) !== JSON.stringify(value)`,
and `loadAll` turns that into "<key> were damaged and have been reset." Badges
touch it in three places. Each one is decided here:

1. **First run of `tfcc:badges`.** No value is stored, so `raw === null` and
   `recovered` is false. The record loads silently as `freshBadges()`. A test
   pins "no notice on a store with no `tfcc:badges`".
2. **The two new settings fields** (`badges`, `dayStartHour`) in
   `tfcc:settings`. Every upgrading user's stored settings lack them, the
   normaliser adds them, and the strings differ. Without a fix, every upgrade
   would print "Settings were damaged and have been reset." while nothing was
   reset. **This spec depends on `isRecoveredValue(raw, value)` from the #8
   spec** (`2026-10-08-auto-hide-on-open-design.md`, "The upgrade trap").
   That pure engine helper fills absent *top-level* keys of `raw` from
   `value` before comparing, and `loadKey` uses it. **If #8 has not merged
   when this lands, this PR adds `isRecoveredValue` exactly as #8 specifies**
   (same name, same body, same tests), and #8 then rebases onto it with no
   change. A test pins "a 0.1.0 settings blob with no `badges` or
   `dayStartHour` loads with no notice, and the values it did hold are kept".
3. **Later versions adding counters.** `isRecoveredValue` forgives only
   **top-level** absent keys. Nested shapes keep the strict comparison. So:
   - **Counters are top-level fields of the record**, not a nested
     `counters` object. A later version that adds a counter (for example
     `searchesWithHits`) adds a top-level key, which an older stored record
     lacks. `isRecoveredValue` forgives that, and the upgrade is silent.
   - **The nested blocks (`streak`, `today`) are frozen for `v: 1`.** A later
     change to their shape must bump `v` *and* ship a pure
     `migrateBadges(raw)` that upgrades the old shape. `loadKey` then compares
     `isRecoveredValue(migrateBadges(raw), value)` for this key, so a clean
     migration is not reported as damage. Nothing of this is built for v1. The
     rule is recorded so the next author does not walk into the trap.
   - `earned` and `forums` are nested but cannot trip on upgrade. `earned`
     keeps unknown ids instead of dropping them, and neither changes shape
     when the catalogue grows. A record beyond the caps (65 earned ids) is
     abnormal and *is* reported, as today.
   - A test builds a v1 record **without** one top-level counter (standing in
     for a record written before that counter existed) and asserts that it
     loads with no notice and keeps every other value.

**No event log.** A log would allow recomputing badges after a rule change, but
it is either unbounded or a window too short to recompute long streaks from.
The earned map with timestamps is the history. Counters are generic (reads,
days) so a later rule can reuse them.

### 6.2 Where each counter moves (runtime)

There is one choke point: `recordBadgeEvent(event, now)`.

```
function recordBadgeEvent(event, now) {
  if (!state.settings.badges) return;
  var stored = loadKey(STORAGE_KEYS.badges, normaliseBadges, now).value;  // re-read
  var ctx = { now: now, tzOffsetMin: new Date(now).getTimezoneOffset(),
              dayStartHour: state.settings.dayStartHour,
              facts: badgeFacts(state.organizer, state.drafts, state.feed, state.rows, keyOk()),
              catchUpCount: catchUpList(state.rows, state.organizer.lastCatchUpAt).length,
              freshAt: state.feed.fetchedAt };
  var res = applyBadgeEvent(stored, event, ctx);   // pure
  if (res.changed) saveKey(STORAGE_KEYS.badges, res.record);
  state.badges = res.record;
  if (res.newly.length) queueBadgeToast(res.newly, now);
}
```

| Event | Fired from | Notes |
|---|---|---|
| `{ type: 'read', threadId, forumId }` | The **dwell timer**: `syncToRoute` arms one `setTimeout(READ_DWELL_MS)` when the route's thread id differs from the armed one, and disarms it when the route leaves that thread or the page. On fire it re-checks `isForumsPage`, that the route is the same thread, `doc.hidden !== true`, and `!state.settings.takeover`. | Armed once per thread change. React churn re-runs `syncToRoute` and does not re-arm (same id), so renders cannot add a read. A full page navigation kills the timer, which is correct: the user left. |
| `{ type: 'refreshed' }` | `refreshAll` success path, after `recompute`, before the redraw | Sets `today.firstLook` if unset, then tries a check-in. |
| `{ type: 'catchup-changed' }` | Handlers `read`, `markall`, `catchup-done`, `archive`, after `recompute` | Tries a check-in. |
| `{ type: 'draft-insert', threadId }` | Handler `draft-insert`, only when `ins.ok` | Dedupe per thread per day. |
| `{ type: 'tick' }` | After `persist('organizer')` and `persist('drafts')` from a handler, and once at `init` | Re-evaluates the state-based badges (folders, tags, pins, drafts, tidy) and does nothing else. Not fired from `captureVisit`'s persist. That runs on churn, and nothing state-based changes there. |

**Never from the render path.** `buildPanelModel` and `panelHtml` call only
`evaluateBadges` (pure, read-only) and `streakStatus` for display. A test
renders 50 times and asserts zero writes to `tfcc:badges`.

### 6.3 Multiple tabs

Storage is shared and no tab hears another's writes. **Decision: badge updates
are operations applied to a fresh read, not snapshots written from memory.**
`recordBadgeEvent` re-reads `tfcc:badges` and applies the event in the same
synchronous turn, so the read-modify-write window is one tick of JavaScript.

- **Two tabs, same thread, both dwell 15 s.** Tab A writes `readIds: [T]`.
  Tab B re-reads, sees `T`, and does nothing. One read.
- **Two tabs both check in.** The second finds `delta = 0`. One day.
- **Two tabs, different threads.** Both reads land, because each applies to the
  other's result.
- **Residual risk:** Tampermonkey propagates a value to other tabs
  asynchronously, so two events less than the propagation delay apart (sub-
  second) can both apply to the same base. The worst case is one duplicated
  read of one thread on one day, or one lost read. A streak cannot be
  double-credited, because day credit is idempotent by value. Torn PDA's
  storage semantics across its tabs are unverified (Q6).
- **Toasts** come only from the tab whose operation earned the badge. Another
  tab shows it in its chip at its next `recordBadgeEvent` or `init`. It never
  toasts something it did not earn.

**Rejected:** `GM_addValueChangeListener`. It would widen `@grant`, the
security surface (constraint 9), for a toy feature. Also rejected: per-tab
counters merged by sum (a G-counter). Correct, but the record would grow with
every tab ever opened.

### 6.4 Pure evaluation

```
evaluateBadges(record, facts, now, tzOffsetMin, dayStartHour) -> {
  satisfied: { id: true },              // rules that hold right now
  earned:    { id: ms },                // record.earned, known ids only
  newly:     [id],                      // satisfied and not yet earned
  progress:  [{ id, value, target, earned, hidden }],
  streak:    streakStatus(record.streak, badgeDay(now, tzOffsetMin, dayStartHour)),
  next:      { id, value, target } | null   // nearest unearned visible badge
}
```

`applyBadgeEvent(record, event, ctx)` returns `{ record, newly, changed }`. It
applies the event, then calls `evaluateBadges` and stamps `earned[id] = now`
for each newly satisfied id. **Earned is permanent.** A rule that stops being
true (folders deleted, tags removed) never revokes a badge.

The catalogue is data, not closures:
`BADGES = [{ id, track, tier, name, icon, hidden, metric, target, rule }]`.
`metric` names a top-level counter of the record, a `streak` field, a `facts`
field, or a derived value.
`rule` is the user-facing text. The catalogue view, the progress bars and the
evaluator all read the same table, so the text cannot drift from the rule. A
test asserts every `metric` resolves.

`badgeFacts(organizer, drafts, feed, rows, keyOk)` is pure and derives:
`switchedOn` (key usable and `feed.fetchedAt > 0`), `ownFoldersFilled`,
`taggedThreads`, `tagsOnThree`, `pinned`, `drafts`, `subscribed`,
`unfiledSubscribed`.

"Nearest" for `next` means the visible unearned badge with the highest
`value / target`, ties broken by catalogue order. Hidden badges are never
`next`.

### 6.5 Requests

None. Nothing in this design calls `tornApiGet`. The read-only budget test
(`tests/read-only.test.js`) gains a case: a full session of badge events makes
zero requests beyond the refreshes the test itself triggers.

---

## 7. The badge catalogue (25)

Twenty-two visible and three hidden. It is grouped by track in the Settings
catalogue, so a user scans five short groups, not one long list.

Icon concept: a **glyph** (track or badge specific) inside a **tier frame**
(4.4). Both are SVG paths from ASCII strings (section 8.6).

### Setup - low return, teaches the panel (all Bronze)

| id | Name | Icon | Exact rule | Why |
|---|---|---|---|---|
| `switched-on` | Switched on | plug | A key is saved, not rejected, and a refresh has succeeded at least once (`feed.fetchedAt > 0`). | The first win. It confirms setup worked, which a user is otherwise unsure of. |
| `first-folder` | First folder | folder tab | A folder that is not one of the three starter folders (`guides`, `scripts`, `faction`) holds at least one thread. | "Create *and fill*". An empty folder is not organisation. |
| `first-tag` | First tag | tag | Any thread carries a tag. | Teaches tags exist. |
| `first-pin` | First pin | pin | Any thread is pinned. | Teaches pinning. |
| `first-draft` | First draft | page with a line | `tfcc:drafts` holds at least one draft. | Teaches drafts, which are invisible until needed. |
| `caught-up` | Caught up | check mark | `checkinDays >= 1`. | The first check-in. It names the habit the streaks then build. |

### Reading - volume, dwell-evidenced

`reads` counts distinct (thread, badge day) pairs with 15 s of visible dwell.
A thread re-read on another day counts again. Following a conversation over
days is reading.

| id | Name | Tier | Icon | Rule | Why |
|---|---|---|---|---|---|
| `reader-10` | Reader | Bronze | open book | `reads >= 10` | Two or three sessions. |
| `reader-50` | Regular reader | Silver | open book | `reads >= 50` | A couple of weeks. |
| `reader-250` | Bookworm | Gold | open book, bookmark | `reads >= 250` | Months. |
| `reader-1000` | Archivist | Legendary | stacked books | `reads >= 1000` | More than a year for most. Cannot be rushed: at most 200 a day, each needing 15 s. |
| `explorer` | Well travelled | Silver | compass | `forums.length >= 8` | Rewards breadth, without rewarding volume twice. Bounded and distinct, so it cannot be farmed. |

### Streaks and regularity - presence

| id | Name | Tier | Icon | Rule | Why |
|---|---|---|---|---|---|
| `streak-3` | Three in a row | Bronze | flame, "3" | `streak.best >= 3` | The early win, inside the first week. |
| `streak-7` | Full week | Bronze | flame, "7" | `streak.best >= 7` | Also earns the first rest day, so the badge and the safety net arrive together. |
| `streak-10` | Ten days | Silver | flame, "10" | `streak.best >= 10` | Asked for by the issue. |
| `streak-25` | Twenty-five days | Silver | flame, "25" | `streak.best >= 25` | Asked for by the issue. |
| `streak-100` | Hundred days | Gold | flame, ring | `streak.best >= 100` | Asked for by the issue. |
| `streak-500` | Five hundred days | Legendary | flame, double ring | `streak.best >= 500` | Asked for by the issue. Calendar-bound: at least 500 days. |
| `regular-50` | Fifty days | Silver | calendar | `checkinDays >= 50` | Rewards regularity that is not unbroken: the user who checks in four days a week for three months. It counters the all-or-nothing reading of a streak. |

All streak badges use `best`, not `current`, so a badge earned is never in
doubt.

### Care and skill - reading plus organisation

| id | Name | Tier | Icon | Rule | Why |
|---|---|---|---|---|---|
| `backlog` | Backlog buster | Silver | broom | `bigBacklog >= 20`: on one day, Catch up had 20 or more threads at the first look, you read at least 10 threads that day, and you finished caught up. | Competence: digging out after time away is the hardest real use. The 10-read floor means Mark all read alone never earns it. |
| `tidy` | Tidy desk | Silver | stacked trays | You follow at least 10 threads and none of them is Unfiled (`subscribed >= 10 && unfiledSubscribed = 0`). | Organisation that pays off every day. The floor of 10 stops it being trivial. |
| `tagger` | Labeller | Bronze | two tags | At least 3 distinct tags are each on 3 or more threads. | A tag used once is a note. A tag used across threads is a system. |
| `drafted` | Prepared | Silver | page with arrow | `draftInserts >= 5`: a saved draft was put into Torn's reply box on 5 different (thread, day) pairs. | Drafts are the most deliberate feature. Inserting one means it was used for real. |

### Hidden - surprise in discovery, fixed rules

Shown in the catalogue as "Hidden badge" with a "?" glyph and no rule until
earned. After that, the name and rule appear like any other badge.

| id | Name | Tier | Icon | Rule | Why hidden |
|---|---|---|---|---|---|
| `comeback` | Back again | Silver | rising arrow | `streak.comebackArmed && streak.current >= 7`: a streak of 7 or more broke, and you built a new one back to 7. | It lands at the exact moment the what-the-hell effect would make a user quit. Announced in advance, it would read as "you will fail". |
| `clean-sweep` | Clean sweep | Silver | broom, sparkle | `streak.clearRun >= 7`: seven cleared days (Catch up non-empty at first look, at least one thread read, finished caught up) without a triage-only day or a break between them. Quiet days neither break nor extend it. | A skill streak that a reader notices only after doing it. As a visible target it would push toward reading for the badge. |
| `anniversary` | One year on | Gold | candle | `now - firstCheckinAt >= 365 days` and `checkinDays >= 100`. | A thank-you. The 100-day floor keeps it from meaning "installed a year ago". |

**Tier totals:** Bronze 10, Silver 10, Gold 3, Legendary 2.

**Catalogue size, decided at 25.** The issue's required tracks and ladders need
about 18. The rest are skill badges that reward reading, plus the three hidden
ones. Grouped in five headings, with two lines per badge, this fits in the
Settings expander as two phone screens of scrolling. Anything larger stops
being scannable and starts reading as a grind list.

---

## 8. Display

### 8.1 Header layouts evaluated

The head today, at a 360 px Torn PDA panel (about 344 px inside the padding),
already wraps: title (~165 px bold), `3 new`, `12 subscribed`, Refresh,
Expand and Hide add up to about 500 px. Anything added competes for the first
line.

| Criterion | A. Inline strip: top N icons + `+K` | **B. Trophy chip + shelf** | C. Thin second header line |
|---|---|---|---|
| Controls never displaced | Weak. N icons plus a count is 80-130 px, so the buttons wrap further. | **Strong.** One chip of fixed width, 70-90 px. | Strong. Nothing is added to line 1. |
| PDA width | Icons shrink to 16 px. | One chip fits on line 1 beside the title. | Fine, but costs a whole line. |
| Touch targets | Each icon is a 16 px target, under the 24 px minimum (WCAG 2.5.8), and its name lives in a hover tooltip that PDA cannot show. | **One 28 px-tall button.** Names live in the shelf as text. | Same problem as A for the icons. |
| Scales with count | Needs top-N logic and a `+K` that says little. | **Shows count + best badge + streak, for any count.** | Same as A. |
| Collapsed state | Visible | **Visible** | Doubles the height of a collapsed panel on every thread page (#8 makes that the common case). |
| Room for #10's tracker | Two strips fight for line 1. | **A sibling chip with the same shape.** | Shares the line, which is its best feature. |
| Show-off value | Highest: every badge visible | Medium: best badge, count and streak visible; the rest one tap away. | High |
| Height cost | 0 to 1 line | **0 lines** (the shelf opens on demand) | Always 1 line |

**Decision: B, the trophy chip, with a tap-to-open shelf.** It is the only
option that meets "never displace the controls", the 24 px touch minimum and
the collapsed requirement at PDA width all at once, and it gives #10 a ready
slot. A's tooltips do not exist on touch, which is the primary platform.
C makes every collapsed panel taller forever, to show something the user
checks a few times a week. B's cost, that badges are one tap away, is what the
shelf is for: it shows them all, with names as text.

**What the chip shows:** the **highest-tier earned badge's icon** (newest
within that tier), the earned count, then the streak glyph and the current
streak.
**Decision: highest tier, not newest.** The chip is a trophy case. Showing the
newest would swap a Gold for a Bronze the moment a setup badge lands. The
toast already announces the newest.

- No badges yet: an outline cup glyph and `0`, so the feature is discoverable.
- Streak segment: hidden until the first check-in. Filled glyph when today is
  counted, outline when not. `0` when broken (5.4).
- Accessible name, for example: `aria-label="Badges: 7 of 25. Streak 12 days,
  today counted. Show badges"`. `aria-expanded` reflects the shelf.

### 8.2 Head structure

The head becomes two groups. Nothing is removed or reordered among the
existing controls.

```
<div class="tfcc-head">
  <div class="tfcc-head-id">                 <!-- flex, wrap, min-width 0 -->
    <span class="tfcc-title">Forum Command Center</span>
    <span class="tfcc-chips">                 <!-- badges chip; #10's chip after it -->
      <button class="tfcc-chip tfcc-chip-badges" data-act="shelf" data-shelf="badges" ...>
    </span>
  </div>
  <div class="tfcc-head-ctl">                <!-- flex, wrap, justify-content: flex-end, margin-left: auto -->
    <span class="tfcc-badge">3 new</span><span class="tfcc-note">12 subscribed</span>
    [Refresh] [Expand] [Hide]
  </div>
</div>
[shelf, when open]   [toast, when present]
```

- `.tfcc-title` loses `margin-right: auto`. `.tfcc-head-ctl` gains
  `margin-left: auto`, so the controls stay hard right at every width and wrap
  as a group, right-aligned, below the identity group.
- `.tfcc-chip` is `flex: 0 0 auto`, `max-width: 12em`, `white-space: nowrap`,
  `min-height: 28px`. It never grows and never pushes.
- The loading and fatal heads get the same identity group, so the chip shows
  there too. Badges are local and loaded before the loading shell is drawn.
- With badges off, `.tfcc-chips` holds only #10's chip, or is omitted.

### 8.3 Mockups

Wide (desktop, panel about 900 px), shelf closed, #10 present:

```
+------------------------------------------------------------------------------------------+
| Forum Command Center (G)7 |^12  [+34 -2 S15]         3 new  12 subscribed [Refresh][Expand][Hide] |
+------------------------------------------------------------------------------------------+
  (G) = icon of the best badge in a gold octagon frame   ^ = streak glyph, filled = today counted
```

Wide, shelf open:

```
+------------------------------------------------------------------------------------------+
| Forum Command Center [(G)7 |^12]v [+34 -2 S15]      3 new  12 subscribed [Refresh][Expand][Hide] |
| +--------------------------------------------------------------------------------------+ |
| | Streak 12 days, today counted. Best 23. Rest days banked: 1.                         | |
| | Next: Twenty-five days  [#########...........] 12 / 25                               | |
| | (G) Hundred days  (S) Ten days  (S) Tidy desk  (B) Full week  (B) Caught up  +2 more | |
| | 7 of 25 earned                                                    [All badges]       | |
| +--------------------------------------------------------------------------------------+ |
| [Threads] [Catch up (2)] [Search] [Drafts] [Settings]                                    |
```

Narrow (Torn PDA, 360 px), shelf closed:

```
+----------------------------------+
| Forum Command Center (G)7 |^12   |
| [+34 -2 S15]                     |
|          3 new  12 subscribed    |
|         [Refresh][Expand][Hide]  |
+----------------------------------+
```

Narrow, collapsed after opening a thread (#8), with a toast:

```
+----------------------------------+
| Forum Command Center (G)8 |^12   |
|         [Refresh][Expand][Show]  |
| Badge earned: Regular reader     |
| (Silver). 200 reads to Bookworm. |
|                              [x] |
+----------------------------------+
```

At the narrowest width (320 px), the title plus one chip (about 165 + 8 +
80 px) still fits on line 1. A second chip (#10) wraps inside the identity
group to its own line. The control group always starts on a fresh line,
right-aligned.

### 8.4 The shelf

- Toggled by the chip (`data-act="shelf"`). It is held in memory as
  `state.shelf = 'badges' | 'reactions' | null`: one shelf at a time, shared
  with #10, and closed on reload. It is not persisted: a shelf left open
  across page loads would be a permanent second header, which is option C.
- It renders directly under the head, **including when collapsed**. It holds:
  the streak sentence, rest days, the "next" goal with a progress bar, earned
  badges as icon plus name (text, wrapping, highest tier first, at most 6,
  then `+K more`), and an **All badges** button. That button opens Settings
  with the catalogue expanded (`data-act="badges-catalogue" data-open="1"`).
- When #8's auto-hide collapses the panel, it also closes the shelf.

### 8.5 The earn moment

- **An in-panel toast**, under the head (and under the shelf if open),
  **rendered even when collapsed**. Text, for example: `Badge earned: Full
  week (Bronze). You also earned a rest day.` or `... 3 more days to Ten
  days.` It names the next goal (goal gradient) when there is one.
- Several badges at once make one toast: `2 badges earned: Full week, Tidy
  desk.`
- It lasts `TOAST_MS = 6000`, with a dismiss button (`data-act="toast-dismiss"`).
  The removal redraw goes through the existing guard, so it never lands under
  a caret.
- **No sound, no modal, no focus steal.** `role="status"` is present on the
  toast's first render only. Later re-renders of the same toast omit it, so
  `innerHTML` replacement does not make a screen reader announce it twice.
- **Motion:** none by default. A 160 ms fade-in is applied only inside
  `@media (prefers-reduced-motion: no-preference)`. The motion is opt-in in
  CSS, so no JS reads `matchMedia`.
- **Upgrade backfill.** On the first load with no `tfcc:badges`, the
  state-based badges the user already qualifies for (setup, Tidy desk,
  Labeller) are earned **silently**, `backfilled = true` is set, and **one**
  info notice says `You already had 5 badges from your setup. See them under
  the trophy.` It is not one toast per badge. Counter badges start at zero:
  there is no dwell or check-in history to reconstruct, and inventing one from
  `lastVisitedAt` would award reading that was never evidenced.

### 8.6 Icons in ASCII source

- Each icon is
  `'<svg class="tfcc-ico tfcc-tier-' + tier + '" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false">' + FRAME_PATH[tier] + '<path d="' + GLYPH_PATH[glyph] + '"/></svg>'`.
  The path data is plain ASCII (`M`, `L`, `A`, `Z`, digits). There are no
  emoji, no icon fonts, no external images, and no `<text>` elements. Streak
  numerals are drawn as paths, so host fonts cannot affect them.
- **The host stylesheet can repaint SVG.** A host rule like
  `svg path { fill: #333 }` beats a `fill="currentColor"` *attribute*,
  because presentation attributes lose to any CSS rule. So fill is set in CSS:
  `#tfcc-panel .tfcc-ico path { fill: currentColor; stroke: none; }` at
  (1,1,1), and the tier colour is set by `#tfcc-panel .tfcc-tier-gold
  { color: var(--tfcc-tier-gold); }` at (1,1,0), which beats the (1,0,0)
  inherit floor. The hostile preview sheet in `tests/render-preview.mjs` gains
  `svg, svg * { fill: #000; color: #000 }` to prove it.
- Chip and catalogue icons are 16 px and 24 px, from the same paths.

### 8.7 Colour and contrast

New tokens in both theme blocks (`tests/style.test.js` "light overrides every
colour the dark theme sets" keeps passing). Match Torn picks one of the two
blocks, so it needs nothing extra.

| Token | Dark | vs `--tm-bg` #1f1f1f | vs `--tm-bg-3` #111 | Light | vs #f2f2f2 | vs #fff |
|---|---|---|---|---|---|---|
| `--tfcc-tier-bronze` | `#d6955b` | 6.52 | 7.47 | `#8c4e17` | 5.83 | 6.53 |
| `--tfcc-tier-silver` | `#c3ccd6` | 10.15 | 11.63 | `#4f5966` | 6.35 | 7.11 |
| `--tfcc-tier-gold` | `#e8c06a` | 9.56 | 10.95 | `#7a5600` | 5.94 | 6.65 |
| `--tfcc-tier-legend` | `#c9a2ff` | 7.92 | 9.08 | `#6a2fb5` | 6.98 | 7.82 |
| `--tfcc-locked` | `#8a8a8a` | 4.77 | 5.47 | `#6e6e6e` | 4.55 | 5.10 |

Measured with the WCAG formula `tests/contrast-audit.mjs` uses. Every pair
clears 4.5:1, so a tier colour may also be used for text such as the tier
label. Icons only need 3:1 (non-text, WCAG 1.4.11).
**`tests/contrast-audit.mjs` measures text only and cannot see an SVG fill.**
So `tests/style.test.js` gains a check that computes each `--tfcc-tier-*` and
`--tfcc-locked` token against `--tm-bg` and `--tm-bg-3` in both blocks and
requires at least 3:1. The progress bar fill uses `--tm-good-text` on
`--tm-bg-3`, both existing tokens.

### 8.8 The Settings catalogue

A new section, **Badges**, appended after Storage and before the version
footer:

```
Badges
  [x] Show badges and record progress
      A day starts at [04:00 v]
  Badges are earned from what you do here: reading threads, staying caught up,
  and keeping things organised. Nothing is sent anywhere, and no request is made.
  Turning badges off stops recording; a streak does not survive a long pause.
  [Show all 25 badges]                                    7 earned, 3 hidden

  (expanded:)
  Setup
    (B) Switched on      Earned 8 Oct 2026
        Save a key and refresh once.
    (o) First folder     Not yet
        Create a folder of your own and file a thread in it.
    ...
  Reading
    (B) Reader           Earned 9 Oct 2026
    (o) Regular reader   [#######.............] 18 / 50
        Read 50 threads. A thread counts once a day, after 15 seconds open.
    ...
  Streaks
    Current 12, best 23, rest days banked 1.
    ...
  Care
  Hidden
    (?) Hidden badge     Keep using the command center.
```

- The expander is a `button` with `aria-expanded`
  (`data-act="badges-catalogue"`). It is not a native `<details>`, whose open
  state would be lost on every `innerHTML` redraw. `state.catalogueOpen` is in
  memory and false on load ("collapsed by default").
- Each row: the icon (locked frames use `--tfcc-locked`), name, tier as text,
  the rule text from the catalogue table, and either the earned date
  (`formatAbsoluteTime`) or a progress bar. The bar is a `div` with
  `role="progressbar"`, `aria-valuenow`, `aria-valuemax` and a text value
  beside it. Boolean badges show "Not yet".
- Unearned hidden badges show "Hidden badge", a "?" glyph, and no rule or
  progress.
- **The off toggle** (`data-act="badges-toggle"`) is always visible, outside
  the expander. Off means: no chip, no shelf, no toast, no recording.
  `tfcc:badges` is **kept**, so turning badges back on resumes with the
  history intact. Reset everything is the way to delete it.
- `settings.badges` defaults to **true** (Q3). `settings.dayStartHour` defaults
  to 4, with a strict menu `0..6`. Anything else normalises to 4. Both live in
  `tfcc:settings`, so they are not exported, following #3's precedent.
- With `settings.dayStartHour` changed, the catalogue note says "Takes effect
  from the next check-in."

---

## 9. Interaction with sibling work

### 9.1 #2 My posts (PR #5)

- **Catch up.** #2 keeps My posts rows out of Catch up, out of the header
  `N new` and out of the Catch up nav count. A check-in is defined on the same
  `catchUpList` (`inThreads` rows only), so My posts never blocks or credits a
  check-in. Its own nav count is irrelevant here.
- **Reading.** A dwell read on one of your own threads counts like any other.
  Reading replies in your threads is reading.
- **Storage.** `tfcc:mine` and `tfcc:badges` are independent keys. Whichever
  lands second extends the `loadAll` damage list and the Reset everything
  list. A test that iterates `STORAGE_KEYS` and asserts Reset everything
  clears each (except `key`) makes the second PR notice.
- **No dependency** on `user/forumthreads` or any #2 endpoint.

### 9.2 #3 Rows shown (PR #6)

- The check-in counts the **full** `catchUpList`, never `model.capped.catchup`.
  A test with a cap of 3 and 5 Catch up rows asserts no check-in. Without it,
  a cap could hide rows and look like an empty list. It cannot today, because
  #3 shows "Showing 3 of 5", but the rule is pinned anyway.
- The catalogue is not a capped list. `CAPPED_VIEWS` is unaffected, and
  Settings stays in `UNCAPPED_VIEWS`.

### 9.3 #4 Only flag author updates (PR #7)

**The question: with #4 on, does "Catch up cleared" still count? Yes, and it
counts the author-mode main list.** With #4 on, Catch up shows only rows with
author updates, plus a separate "Not yet checked for author posts (N)" group
that #4 keeps out of the nav count.

- **Decision: the not-yet-checked group does not block a check-in.**
  Those rows are unknown, not updates by the setting's own definition. They
  are checked in batches of at most `enrichBudget` per refresh. If they
  blocked, the only way to unblock them would be to refresh again and again
  until the budget drained the group. That is refresh spam, the busywork this
  design forbids, and it would also spend the user's request budget. The user
  can still Mark read any of them.
- The badge rule follows the screen. In author mode, the empty-state text
  "No author updates in the threads checked." counts the same as "You are
  caught up." Both mean nothing actionable is left.
- Author mode makes check-ins easier, because fewer things count as new. That
  is correct: the user told the script what matters to them, and the streak
  measures being caught up *on that*.
- Implementation: the check-in calls `catchUpList(rows, at, mode)` with the
  same `mode` the Catch up view uses, and reads only the main list. If #4
  lands second, it passes its mode to that call. A test in either order pins
  "an unchecked-only Catch up credits a check-in".

### 9.4 #8 Auto-hide on open (`2026-10-08-auto-hide-on-open-design.md`)

With `settings.autoHideOnOpen` on, a plain click on a thread link the panel
rendered writes `collapsed: true` **and `takeover: false`** synchronously,
before navigation. A collapsed header is therefore the normal state on a
thread page, and takeover is never active over a thread opened from the
panel. Contract, whichever lands first:

0. **`isRecoveredValue`** is shared (6.1a). Whichever PR lands first adds it;
   the other uses it. Both add top-level settings fields (`autoHideOnOpen`;
   `badges`, `dayStartHour`), so both need it.

1. The head, **including `.tfcc-chips`**, renders before any collapsed early
   return, exactly as `panelHtml` does today. A test renders a collapsed panel
   and asserts the chip is present, in every theme. If #8 adds a distinct
   auto-collapsed state, the same test covers it.
2. Auto-collapse closes the shelf (`state.shelf = null`). Toasts still render
   in the collapsed state.
3. The dwell timer is independent of collapse: reading a thread with the
   panel auto-hidden is exactly the case it is for. Only Expand (takeover)
   suppresses a read credit, because takeover covers the page. Since #8
   clears takeover on a panel link click, a thread opened from the panel is
   always eligible. A thread opened some other way while takeover is still on
   is not, which is correct: the panel is covering it.
4. #8's `autoHideSettings` writes `tfcc:settings` only. It never touches
   `tfcc:badges`, and the collapse it causes is not a badge event.

### 9.5 #10 Reactions tracker

- **The slot.** `.tfcc-chips` holds the badges chip first, then #10's chip.
  Both use `.tfcc-chip` (same height, radius, padding, focus ring, nowrap,
  max-width) and the same `state.shelf` mechanism with
  `data-shelf="reactions"`, so one is open at a time. #10 owns its chip's
  contents, including its `-` unknown state and its own data source, and its
  own shelf.
- **Order, decided:** badges first, then reactions. Badges are local and
  always render immediately. Reactions depend on a fetch and may show `-`.
  Putting the steady element first keeps line 1 from shifting when #10's data
  arrives.
- If badges are off, #10's chip sits alone in `.tfcc-chips`. If #10 lands
  first, it creates `.tfcc-head-id` and `.tfcc-chips` as specified here, and
  this PR adds a chip to it.
- **No badge for reactions received** (section 10).

---

## 10. Rejected ideas, and why

| Idea | Why not |
|---|---|
| **Points and levels** (the issue's alternative) | More abstract, and every action needs a point value, which invites optimising for points. The short ladders already act as levels for the reading track. |
| **A badge for refreshing** (N refreshes, refresh streaks) | Pure busywork, and it would spend the user's API budget for a medal. |
| **Counting Mark read or Mark all read as reading** | Click-without-reading is exactly what the issue forbids. They count only toward presence. |
| **Counting `captureVisit` calls as reads** | They fire on React churn. That would count renders. |
| **Requiring the click to come from the panel's own link** ("read through the panel", taken literally) | It misses new-tab opens and Torn's own navigation, and punishes users for how they open threads. The panel tracks every opened thread anyway (section 3). |
| **"Zero archived threads with unread"** (suggested in the brief) | A snapshot that is true most of the time without effort, and true straight after archiving everything. It rewards the absence of activity. Tidy desk covers organisation with a real floor. |
| **Night owl** (check in between 00:00 and 04:00) | Rewards losing sleep. |
| **Quiet week** (7 days in a row with an empty first look) | Rewards something the user does not control: a variable reward in disguise. Quiet days are already protected; they do not need a prize. |
| **Belt and braces** (first export) | One click with no outcome. A backup is good practice but not a habit, and a badge does not make it one. |
| **Likes, dislikes or subscribers received** (#10's numbers) | Rewards popularity, which the user does not control, and makes the badge system depend on a fetch. |
| **Streak repair, or buying back a streak** | A monetisation pattern. Rest days are earned in advance, never bought after. |
| **"Streak at risk" warnings or countdowns** | The main source of streak anxiety (5.4). |
| **Strict streaks, no rest days** | Maximises the what-the-hell effect. One trip abroad ends 80 days of habit. |
| **Automatic rest days** (for example, any 1 day in 7 is free) | Simpler, but invisible, and it makes "consecutive" mean "6 of every 7" by rule. Earned rest days are legible ("banked: 1") and reward regularity before they protect it. Q2. |
| **`GM_addValueChangeListener` for cross-tab sync** | Widens `@grant` (constraint 9) for a toy. Section 6.3. |
| **Persisted shelf or catalogue open state** | A shelf that stays open is a permanent second header. A catalogue that stays open makes Settings two screens longer forever. |

---

## 11. Export, import, reset, debug

- **Export** (`encodeState`) adds a `badges` field:
  `{ reads, checkinDays, clearedDays, draftInserts, bigBacklog, streak, forums,
  earned, firstCheckinAt }`. The `today` block and
  `backfilled` are left out: they are scratch. `payload.v` stays 1. An older
  build's `decodeState` checks only `v` and its `importState` ignores unknown
  fields, so old builds still import new exports. That is the same additive
  path #4 relies on for organiser fields. The Backup note becomes "... notes,
  read markers, drafts and badges."
- **Import** merges with the pure `mergeBadgeRecords(local, incoming)`:
  - `earned`: union, keeping the **earlier** time for an id in both.
  - each counter: **max**, never sum. Importing your own export twice is then a
    no-op (idempotent), and importing from a second device cannot inflate.
    The cost: two devices' real activity under-counts (100 and 80 give 100,
    not 180). Under-counting is the safe direction.
  - `forums`: union, capped at 64.
  - `streak`: take the record with the larger `lastDay`. On a tie, take the
    larger `current`. `best = max(both)`. `comebackArmed` comes from the
    chosen record.
  - `firstCheckinAt`: the earlier non-zero value.
  - Then `evaluateBadges` runs. Badges newly satisfied by the merge are earned
    **silently**, and the import notice gains "and N badges".
  - Nothing is written on a rejected import, as today.
- **Reset everything** writes `freshBadges()` to `tfcc:badges` and sets
  `state.shelf = null`, `state.catalogueOpen = false` and `state.toasts = []`.
  Because `backfilled` is false again, the next `tick` silently re-earns the
  backfillable badges the user still qualifies for (in practice Switched on).
  This is accepted.
- **Reset folders and tags** does not touch badges. Earned badges are
  permanent, and the counters were not organiser state.
- **Damage.** `loadAll` loads `tfcc:badges` with the others and adds
  `['Badges', b]` to the damage notice list. A damaged record resets badges
  only.
- **Debug report** adds counts only: `badges: { enabled, earned: n,
  streakCurrent, streakBest, checkinDays, reads }`. No thread ids, no forum
  ids, no badge timestamps. The key appears nowhere in `tfcc:badges` or in any
  badge string. The badge code has no error path that could carry a detail,
  and `scrubDetail` is not needed for it.

---

## 12. Security and constraints

- **Engine purity:** all rules are pure and take time as arguments (5.8).
- **ASCII only:** all strings, icon paths and CSS. No emoji literal anywhere,
  including comments. `tests/metadata.test.js` enforces it.
- **ADR 0001:** no new DOM access to Torn's markup. The dwell timer reads
  `location` (through `parseForumRoute`) and `document.hidden`, which
  `scheduleAutoRefresh` already reads. Everything else is our own panel. No
  ADR is needed: this follows existing conventions (a storage key with a
  normaliser, settings fields, engine helpers, a runtime timer) and deviates
  from no standard, so no outbox note either.
- **`@match`, `@grant`, `@connect`:** unchanged.
- **The API key** never enters `tfcc:badges`, the export's `badges` block, a
  toast, or the debug report's badge block. A test greps each for a planted
  key.
- **Request budget:** unchanged, with zero requests (6.5).

---

## 13. Testing strategy

New suites: `tests/badges.test.js` (engine) and `tests/badges-runtime.test.js`
(runtime, with `tests/load-userscript.js` and `advanceTimersBy`). Tests assert
**absolute values** (`500`, `15000`, day indices written out), never the
constant under test. That is the mutation check's lesson about
self-referential tests.

### 13.1 Day and streak boundaries (engine)

1. `badgeDay` with `dayStartHour 4`: local 03:59:59.999 is day d-1, and 04:00
   is day d. With `dayStartHour 0`: 23:59:59.999 is d-1, and 00:00 is d.
2. Offsets: UTC (0), UTC-5 (`300`), UTC+10 (`-600`), Nepal (`-345`) and UTC+14
   (`-840`). Each case gives the same instant, the expected different local
   days, and written-out indices.
3. DST spring forward (a 23-hour local day) and fall back (25 hours), using the
   offset at each instant: consecutive local dates differ by exactly 1, and
   both instances of the repeated hour give the same day.
4. First check-in: `current 1`, `best 1`, `lastDay d`.
5. The same day twice: unchanged (idempotent). Same day across the rollover
   hour: 03:59 then 04:01 with `dayStartHour 4` are two different days.
6. Consecutive days: `current` increments.
7. One missed day, bank 0: reset to 1, best kept, bank kept.
8. One missed day, bank 1: bridged, bank 0, `current + 1` (not `+2`).
9. Two missed days, bank 1: a break, and the bank is kept at 1.
10. Two missed days, bank 2: bridged, bank 0.
11. Bank accrual: 0 after 6 check-ins, 1 at the 7th, 2 at the 14th, still 2
    at the 21st. `toNextRest` resets at a break.
12. Clock back within the day (`delta 0`) and by one day (`delta -1`): no
    change. By 3 days (`delta -3`): a rebase, `current`/`best`/`bank`
    unchanged, `checkinDays` unchanged. Then the next real day extends from
    the rebased day.
13. Far future then corrected: one future credit, then a rebase with no break.
14. Date-line skip (`delta 2`) with and without a banked rest day.
15. `streakStatus` for every row of the 5.4 table, including `open-resting`
    and `broken` showing 0, with display never mutating its input.
16. A `dayStartHour` change in both directions at 02:00 local.
17. 500 and 499: a streak loop of 499 consecutive days does not earn
    `streak-500`, and the 500th does. The loop starts from a literal epoch and
    asserts the literal `500`.
18. Comeback: armed only when a streak of 7 or more breaks (not 6), and
    earned when the new streak reaches 7.
19. `clearRun`: cleared days extend it, quiet days leave it unchanged, a
    triage-only day and a break reset it, and a rest-day bridge keeps it.

### 13.2 Check-in eligibility (engine)

Quiet arrival counts. An empty Catch up with 0 subscribed does not. Stale data
(fetched 31 minutes ago) does not, and 29 minutes does. No first look today
does not. Off does not. Mark all read with 0 reads counts as a check-in and
not as a cleared day. A cleared day needs `firstLook > 0` and one read.
Backlog needs `firstLook >= 20` and `reads >= 10`: 19 and 20, 9 and 10. The
#4 unchecked-only list counts. The #3 capped list is never consulted.

### 13.3 Badges and records (engine)

Every catalogue entry: below threshold, at threshold, and permanence after the
condition stops holding. Every `metric` resolves. Hidden badges are never
`next`, and their rule text is withheld until earned. `next` picks the
highest ratio. Setup facts from organiser fixtures, including a starter
folder not counting for First folder. Normaliser: total over junk, read-back
stringify-equal, caps (`readIds` 200, `forums` 64, `earned` 64, `insertIds`
50), unknown `earned` ids kept, `v: 2` gives a fresh record, `today`
replaced on a day change. `mergeBadgeRecords`: union, earlier time, max
counters, idempotent on a self-merge, the tie rules.

### 13.4 Runtime

- Dwell: no read at 14999 ms, a read at 15000. No read when the route changes
  first, when `document.hidden` is true at fire time, or when takeover is on.
  A second `syncToRoute` on the same thread (React churn) does not re-arm.
  Leaving and returning re-arms.
- Same thread, same day: 1 read. The next day: 2. 201 distinct threads in a
  day: 200.
- **Two tabs:** two sandboxes sharing one mocked GM store. Both dwell on
  thread T: `reads` is 1. Different threads: 2. Both check in: one day. Only
  the earning tab toasts.
- **Renders do not write:** 50 `draw` calls produce zero `GM_setValue` calls
  for `tfcc:badges`.
- Refresh success records the first look once. A second refresh does not
  overwrite it.
- Handlers `read`, `markall`, `catchup-done` and `archive` credit a check-in
  when they empty Catch up. `draft-insert` counts only on `ok`.
- Head: the chip renders in the normal, collapsed, loading and fatal heads.
  The controls stay in `.tfcc-head-ctl` in order Refresh, Expand, Hide. The
  chip is absent when off. With the shelf open while collapsed, the shelf
  renders.
- Toast: one per earn event, merged when several, `role="status"` only on
  first render, removed after `TOAST_MS`, deferred under a focused input,
  shown when collapsed. No toast for the backfill, and exactly one notice.
- Catalogue: every badge listed, collapsed by default, hidden badges masked,
  and every rendered `data-act` handled (`tests/handlers.test.js`'s
  rendered-equals-handled check gains `shelf`, `badges-catalogue`,
  `badges-toggle`, `day-start` and `toast-dismiss`).
- Settings: `badges` and `dayStartHour` round-trip. Off-menu values normalise
  to defaults. Off means no writes.
- **Upgrade is silent (6.1a):** a 0.1.0 `tfcc:settings` blob with neither new
  field loads with no damage notice and keeps its values; an absent
  `tfcc:badges` loads with no notice; a v1 record missing one top-level
  counter loads with no notice; a `streak` block with a junk value still is
  reported. The mutation check gains "`loadKey` compares with strict
  stringify again", which the settings case must catch.
- Export and import round-trip, a self-import is a no-op, an old export (no
  `badges`) imports, and the key never appears.
- Reset everything clears `tfcc:badges`. Reset folders and tags does not. A
  damaged `tfcc:badges` resets only itself, with one notice.
- No request: the counting transport sees nothing extra.
- Debug report: the badge block has counts only, with no thread or forum ids.

### 13.5 Style, visual, purity

- `tests/style.test.js`: the tier tokens are in both theme blocks, the
  computed non-text contrast is at least 3:1 against `--tm-bg` and
  `--tm-bg-3` in both, the icon `path` fill rule exists at (1,1,1), the motion
  sits only inside `prefers-reduced-motion: no-preference`,
  `.tfcc-head-ctl` has `margin-left: auto`, and `.tfcc-chip` does not grow.
- `tests/render-preview.mjs`: previews of the chip (none, some, broken
  streak), the shelf open, a toast, collapsed with a chip, and the catalogue
  open, in dark, light and hostile, at 360 px and wide. The hostile sheet
  gains SVG fill rules.
- `tests/contrast-audit.mjs` (manual): text in all new previews passes.
- `tests/purity.test.js` and `tests/metadata.test.js`: unchanged, and they
  must still pass.

### 13.6 Mutation check additions

| Mutation | Suite that must fail |
|---|---|
| The dwell guard ignores the elapsed time (credit at arm) | `badges-runtime` |
| The same-day guard removed from `creditCheckin` | `badges` |
| A rest day no longer bridges | `badges` |
| A break resets `best` | `badges` |
| The `delta <= -2` rebase removed (future clock blocks forever) | `badges` |
| Freshness ignored in eligibility | `badges` |
| A triage-only day counted as a cleared day | `badges` |
| The chip moved after the collapsed early return | `panel` / `badges-runtime` |
| `recordBadgeEvent` called from `buildPanelModel` | `badges-runtime` (render-writes test) |
| `recordBadgeEvent` writes from memory instead of re-reading | `badges-runtime` (two-tab test) |
| Import sums counters instead of max | `badges` |
| The check-in counts the capped list | `badges` |

Run as `node tests/mutation-check.mjs > mutation.log 2>&1`, then read the log.
Never pipe it.

### 13.7 QA checklist additions (`docs/qa-checklist.md`)

Walked on Torn PDA and desktop, on a real account:

- [ ] Upgrade: one notice, the setup badges you already qualify for, no toast
      storm.
- [ ] The chip sits right after the title in Dark, Light and Match Torn
      (toggle Torn's theme while it is open). Refresh, Expand and Hide are
      unmoved at PDA width.
- [ ] Open a thread and wait 15 s: Reader progress moves by 1 in the
      catalogue. Leave after 5 s: it does not.
- [ ] Open the same thread again today: no change.
- [ ] Collapse, then open a thread: the chip still shows, and a toast appears
      collapsed if one is earned.
- [ ] Two tabs on the same thread for 15 s: progress moves by 1.
- [ ] A quiet day: open forums, the refresh finds Catch up empty, and the
      streak glyph fills.
- [ ] Across the 04:00 boundary: check in at 03:50, then at 04:10. The streak
      grows by 1 (needs a late night, or a temporary `dayStartHour`).
- [ ] Turn badges off: the chip disappears, and nothing changes in the record
      over a session (debug report counts).
- [ ] Export, Reset everything, Import: the badges and best streak come back.

---

## 14. Assumptions

1. Fifteen seconds of visible dwell is a fair floor for "read". It is long
   enough to exclude bounce-opens, and short enough for a one-post update.
2. `document.hidden` is reliable in Torn PDA's webview. If it always reports
   `false`, the only effect is that background-tab dwell counts. That is
   accepted and is a QA line.
3. Tampermonkey's `GM_getValue` sees another tab's `GM_setValue` within about a
   second (6.3).
4. Users want badges on by default (Q3).
5. The visit-into-Catch-up side effect (section 3) stays as it is. The streak
   inherits it.

## 15. Open questions for the reviewers

1. **Should triage count toward the streak?** Decided yes: the streak measures
   presence. Mark all read can keep a streak alive without reading, and earns
   no reading badges. The alternative, requiring at least one read on any
   non-quiet day, makes the streak a reading streak and punishes the honest
   "none of this matters today". Argue it.
2. **Rest days: earned (1 per 7, cap 2, starting at 0), automatic, or none?**
   Starting at 0 means a new user's first missed day breaks their streak. The
   reasoning: a first-week streak is cheap to rebuild, and a free rest day
   before any habit exists teaches nothing. Starting at 1 is kinder.
3. **Default on for existing users?** Decided on, with a silent backfill and
   one notice. Off-by-default would be safer but nobody would find it.
4. **#4's unchecked group does not block a check-in** (9.3). The alternative
   is more honest about unknowns, but it pays for refresh spam.
5. **Should a captured visit dismiss a thread from Catch up** (that is, set
   `lastSeenTotal` to the known total)? Today, reading a thread on Torn puts
   it *into* Catch up until Mark read or Set catch-up point. That makes "caught
   up" harder to reach by reading than by clicking, which runs against this
   design's whole incentive. It is out of scope here (a Catch up behaviour
   change for all users), but it may deserve its own issue.
6. **Torn PDA storage across tabs.** Does PDA's `GM_getValue` see another tab's
   writes at all? If not, two PDA tabs can each count the same read once.
   The bound is still one per thread per day per tab.
7. **Is a `dayStartHour` menu of 0 to 6 enough?** A night-shift player whose
   "day" starts at noon is not served. A wider menu makes early-morning
   sessions surprising for everyone else.
8. **Should turning badges off pause the streak** instead of letting it lapse?
   Pausing is kinder, but it lets a user step around any missed day by
   toggling, and it complicates the rules for little gain.
9. **Is a separate "Reset badges" button wanted**, or is Reset everything
   enough? Not included, to keep the destructive surface small.
10. **Chip shows the highest-tier badge, not the newest** (8.1). The toast
    covers newness. Is the trophy-case reading right?
