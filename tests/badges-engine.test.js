'use strict';

// Issue #9: badges. Pure engine rules.
// Spec: docs/superpowers/specs/2026-10-08-badges-design.md
// Values are written out, never read from the constants under test.

const test = require('node:test');
const assert = require('node:assert');
const { loadUserscript } = require('./load-userscript');

const { exports: api } = loadUserscript();

const D = 20734;                 // 2026-10-08, as a TCT day number
const NOON = 1791460800000;      // 2026-10-08 12:00:00.000 TCT
const LAST_MS = 1791503999999;   // 2026-10-08 23:59:59.999 TCT
const MIDNIGHT = 1791504000000;  // 2026-10-09 00:00:00.000 TCT

function streak(current, best, lastDay) { return { current, best, lastDay }; }

// ---- day and streak ----------------------------------------------------------

test('a day is a Torn day: it turns over at 00:00 TCT', () => {
  assert.strictEqual(api.tctDay(NOON), 20734);
  assert.strictEqual(api.tctDay(LAST_MS), 20734);
  assert.strictEqual(api.tctDay(MIDNIGHT), 20735);
});

test('the first check-in starts a streak of one', () => {
  assert.deepStrictEqual(api.creditDay(streak(0, 0, -1), D), { streak: streak(1, 1, D), credited: true });
});

test('a second check-in on the same day changes nothing', () => {
  assert.deepStrictEqual(api.creditDay(streak(4, 9, D), D), { streak: streak(4, 9, D), credited: false });
});

test('the next day extends the streak', () => {
  assert.deepStrictEqual(api.creditDay(streak(4, 9, D), D + 1), { streak: streak(5, 9, D + 1), credited: true });
});

test('one millisecond either side of TCT midnight is two days in a row', () => {
  const first = api.creditDay(streak(0, 0, -1), api.tctDay(LAST_MS)).streak;
  assert.deepStrictEqual(api.creditDay(first, api.tctDay(MIDNIGHT)),
    { streak: streak(2, 2, 20735), credited: true });
});

test('a missed day breaks the streak and keeps the best', () => {
  assert.deepStrictEqual(api.creditDay(streak(12, 23, D), D + 2), { streak: streak(1, 23, D + 2), credited: true });
  assert.deepStrictEqual(api.creditDay(streak(12, 23, D), D + 30), { streak: streak(1, 23, D + 30), credited: true });
});

test('a new run past the old best raises best', () => {
  let s = streak(3, 3, D);
  s = api.creditDay(s, D + 5).streak;
  for (let d = 6; d <= 9; d += 1) s = api.creditDay(s, D + d).streak;
  assert.deepStrictEqual(s, streak(5, 5, D + 9));
});

test('the clock going backwards costs nothing', () => {
  assert.deepStrictEqual(api.creditDay(streak(7, 7, D), D - 1), { streak: streak(7, 7, D - 1), credited: false });
});

test('a stored day in the future does not block later days', () => {
  // The device clock ran three days fast when this was written, then was fixed.
  let r = api.creditDay(streak(5, 8, D + 3), D);
  assert.deepStrictEqual(r, { streak: streak(5, 8, D), credited: false });
  r = api.creditDay(r.streak, D + 1);
  assert.deepStrictEqual(r, { streak: streak(6, 8, D + 1), credited: true });
});

test('499 days in a row are 499, and the 500th makes 500', () => {
  let s = streak(0, 0, -1);
  for (let d = 0; d < 499; d += 1) s = api.creditDay(s, 20000 + d).streak;
  assert.strictEqual(s.best, 499);
  s = api.creditDay(s, 20499).streak;
  assert.strictEqual(s.best, 500);
});

test('the displayed streak never mutates and never warns', () => {
  const s = streak(4, 9, D);
  assert.deepStrictEqual(api.streakView(streak(0, 0, -1), D), { state: 'none', current: 0, best: 0 });
  assert.deepStrictEqual(api.streakView(s, D), { state: 'counted', current: 4, best: 9 });
  assert.deepStrictEqual(api.streakView(s, D - 1), { state: 'counted', current: 4, best: 9 });
  assert.deepStrictEqual(api.streakView(s, D + 1), { state: 'open', current: 4, best: 9 });
  assert.deepStrictEqual(api.streakView(s, D + 2), { state: 'broken', current: 0, best: 9 });
  assert.deepStrictEqual(s, streak(4, 9, D));
});

// ---- dwell -------------------------------------------------------------------

const T0 = NOON;

// samples: [threadId, active, now]. A fake clock passed in; nothing ambient.
function runDwell(samples) {
  let d = api.freshDwell();
  const credits = [];
  for (const [id, active, now] of samples) {
    const r = api.dwellStep(d, id, active, now);
    d = r.dwell;
    if (r.credit) credits.push([r.credit, now]);
  }
  return { dwell: d, credits };
}

function seconds(id, from, count, active) {
  const out = [];
  for (let s = 0; s <= count; s += 1) out.push([id, active !== false, from + s * 1000]);
  return out;
}

test('fifteen focused seconds credit the thread, and fourteen do not', () => {
  assert.deepStrictEqual(runDwell(seconds('7', T0, 14)).credits, []);
  assert.deepStrictEqual(runDwell(seconds('7', T0, 15)).credits, [['7', T0 + 15000]]);
});

test('a thread is credited once however long it stays open', () => {
  assert.deepStrictEqual(runDwell(seconds('7', T0, 120)).credits, [['7', T0 + 15000]]);
});

test('a pause keeps the time so far, and time away never counts', () => {
  const samples = seconds('7', T0, 10)                     // 10 s focused
    .concat([['7', false, T0 + 10500], ['7', false, T0 + 40000]]) // blurred or hidden
    .concat(seconds('7', T0 + 40000, 4));                  // back: re-arm, then 4 s
  assert.deepStrictEqual(runDwell(samples).credits, [], '10 + 4 is not 15');
  const more = samples.concat([['7', true, T0 + 45000]]);
  assert.deepStrictEqual(runDwell(more).credits, [['7', T0 + 45000]]);
});

test('a route change resets the time', () => {
  const samples = seconds('7', T0, 10).concat(seconds('8', T0 + 10000, 14));
  assert.deepStrictEqual(runDwell(samples).credits, [], '10 s on 7 plus 14 s on 8 credits neither');
  const more = samples.concat([['8', true, T0 + 25000]]);
  assert.deepStrictEqual(runDwell(more).credits, [['8', T0 + 25000]]);
});

test('one late sample adds at most two seconds', () => {
  const r = runDwell([['7', true, T0], ['7', true, T0 + 60000]]);
  assert.deepStrictEqual(r.credits, []);
  assert.strictEqual(r.dwell.accMs, 2000);
});

test('a clock that goes backwards adds nothing', () => {
  const r = runDwell([['7', true, T0 + 5000], ['7', true, T0], ['7', true, T0 + 1000]]);
  assert.strictEqual(r.dwell.accMs, 1000);
});

test('inactive time and no thread never credit', () => {
  assert.deepStrictEqual(runDwell(seconds('7', T0, 60, false)).credits, []);
  const none = runDwell(seconds('', T0, 60));
  assert.deepStrictEqual(none.credits, []);
  assert.strictEqual(none.dwell.accMs, 0);
});

test('the dwell threshold is fifteen seconds', () => {
  assert.strictEqual(api.DWELL_MS, 15000);
});

// ---- catalogue -----------------------------------------------------------------

const ZERO_FACTS = { switchedOn: 0, ownFoldersFilled: 0, subscribed: 0, unfiledSubscribed: 0 };

test('the catalogue is exactly these fifteen badges, all visible', () => {
  assert.deepStrictEqual(api.BADGES.map((b) => [b.id, b.name, b.tier, b.metric, b.target]), [
    ['switched-on', 'Switched on', 'bronze', 'switchedOn', 1],
    ['first-folder', 'First folder', 'bronze', 'ownFoldersFilled', 1],
    ['caught-up', 'Caught up', 'bronze', 'checkinDays', 1],
    ['reader', 'Reader', 'bronze', 'visits', 25],
    ['bookworm', 'Bookworm', 'gold', 'visits', 500],
    ['explorer', 'Explorer', 'bronze', 'forums', 3],
    ['well-travelled', 'Well travelled', 'silver', 'forums', 7],
    ['cartographer', 'Cartographer', 'gold', 'forums', 12],
    ['tidy-desk', 'Tidy desk', 'silver', 'tidy', 1],
    ['backlog-buster', 'Backlog buster', 'silver', 'bigBacklog', 20],
    ['streak-3', 'Three days', 'bronze', 'best', 3],
    ['streak-10', 'Ten days', 'silver', 'best', 10],
    ['streak-25', 'Twenty-five days', 'silver', 'best', 25],
    ['streak-100', 'Hundred days', 'gold', 'best', 100],
    ['streak-500', 'Five hundred days', 'legend', 'best', 500],
  ]);
  for (const b of api.BADGES) {
    assert.ok(b.rule && !/\bread\b/i.test(b.rule), b.id + ' has a rule and never says read');
    assert.strictEqual(b.hidden, undefined, 'nothing is hidden');
  }
});

test('every metric the catalogue names is computed', () => {
  const m = api.badgeMetrics(api.freshBadges(), ZERO_FACTS);
  for (const b of api.BADGES) assert.strictEqual(typeof m[b.metric], 'number', b.metric);
});

function recordWith(metric, value) {
  const r = api.freshBadges();
  const facts = Object.assign({}, ZERO_FACTS);
  if (metric === 'visits') r.visits = value;
  else if (metric === 'checkinDays') r.checkinDays = value;
  else if (metric === 'bigBacklog') r.bigBacklog = value;
  else if (metric === 'best') r.streak = { current: value, best: value, lastDay: 20000 };
  else if (metric === 'forums') r.forums = Array.from({ length: value }, (_, i) => i + 1);
  else if (metric === 'switchedOn') facts.switchedOn = value;
  else if (metric === 'ownFoldersFilled') facts.ownFoldersFilled = value;
  else if (metric === 'tidy') { facts.subscribed = 10; facts.unfiledSubscribed = value ? 0 : 1; }
  return { r, facts };
}

test('each badge is earned at its target and not one below it', () => {
  for (const b of api.BADGES) {
    const below = recordWith(b.metric, b.target - 1);
    assert.ok(!api.evaluateBadges(below.r, below.facts).newly.includes(b.id), b.id + ' below target');
    const at = recordWith(b.metric, b.target);
    assert.ok(api.evaluateBadges(at.r, at.facts).newly.includes(b.id), b.id + ' at target');
  }
});

test('an earned badge stays earned when its condition stops holding', () => {
  const r = api.freshBadges();
  r.earned['tidy-desk'] = NOON;
  const ev = api.evaluateBadges(r, ZERO_FACTS);
  assert.ok(!ev.newly.includes('tidy-desk'));
  assert.strictEqual(ev.progress.find((p) => p.id === 'tidy-desk').earned, NOON);
});

test('facts: a starter folder is not your own, and Tidy desk needs ten followed', () => {
  const org = {
    v: 1,
    folders: [{ id: 'guides', name: 'Guides', order: 0, forumIds: [] }, { id: 'mine', name: 'Mine', order: 1, forumIds: [] }],
    threads: { 1: Object.assign(api.normaliseThreadEntry(null), { folderId: 'guides' }) },
    lastCatchUpAt: 0,
  };
  const feed = { subscribed: [{ id: '1' }], fetchedAt: NOON };
  assert.strictEqual(api.badgeFacts({ organizer: org, feed, hasKey: true, keyRejected: 0 }).ownFoldersFilled, 0);
  org.threads[2] = Object.assign(api.normaliseThreadEntry(null), { folderId: 'mine' });
  const facts = api.badgeFacts({ organizer: org, feed, hasKey: true, keyRejected: 0 });
  assert.deepStrictEqual(facts, { switchedOn: 1, ownFoldersFilled: 1, subscribed: 1, unfiledSubscribed: 0 });
  assert.strictEqual(api.badgeMetrics(api.freshBadges(), facts).tidy, 0, 'one followed thread is under the floor of 10');
  assert.strictEqual(api.badgeFacts({ organizer: org, feed, hasKey: true, keyRejected: 2 }).switchedOn, 0);
  assert.strictEqual(api.badgeFacts({ organizer: org, feed: { subscribed: [], fetchedAt: 0 }, hasKey: true, keyRejected: 0 }).switchedOn, 0);
});

test('the next goal is the closest unearned badge', () => {
  const r = api.freshBadges();
  r.visits = 20;                                        // reader 20/25 = 0.8
  r.forums = [1, 2];                                    // explorer 2/3 = 0.67
  const next = api.nextBadge(api.evaluateBadges(r, ZERO_FACTS).progress);
  assert.strictEqual(next.id, 'reader');
});

test('the toast names the badge, its tier, and the next rung of the same ladder', () => {
  const r = api.freshBadges();
  r.visits = 25;
  assert.strictEqual(api.badgeToastText(['reader'], r, ZERO_FACTS),
    'Badge earned: Reader (Bronze). 475 more focused visits to Bookworm.');
  assert.strictEqual(api.badgeToastText(['streak-10', 'tidy-desk'], r, ZERO_FACTS),
    '2 badges earned: Ten days, Tidy desk.');
  assert.strictEqual(api.badgeToastText(['switched-on'], r, ZERO_FACTS), 'Badge earned: Switched on (Bronze).');
});

// ---- events --------------------------------------------------------------------

const FACTS = { switchedOn: 1, ownFoldersFilled: 0, subscribed: 3, unfiledSubscribed: 3 };

function ctx(over) {
  return Object.assign({ now: NOON, facts: FACTS, blockers: 0, catchUpIds: [], subscribed: 3, fetchedAt: NOON }, over || {});
}

function apply(rec, events) {
  let r = rec || api.freshBadges();
  const newly = [];
  for (const [event, c] of events) {
    const out = api.applyBadgeEvent(r, event, c);
    r = out.record;
    newly.push(...out.newly);
  }
  return { r, newly };
}

const visit = (id, forumId) => ({ type: 'visit', threadId: String(id), forumId: forumId || 0 });
const REFRESHED = { type: 'refreshed' };
const CHANGED = { type: 'catchup-changed' };

test('a visit counts once per thread per Torn day, and forums are distinct', () => {
  const day1 = apply(null, [[visit(7, 61), ctx()], [visit(7, 61), ctx()], [visit(8, 61), ctx()], [visit(9, 4), ctx()]]);
  assert.strictEqual(day1.r.visits, 3);
  assert.deepStrictEqual(day1.r.forums, [61, 4]);
  const day2 = apply(day1.r, [[visit(7, 61), ctx({ now: MIDNIGHT + 1000 })]]);
  assert.strictEqual(day2.r.visits, 4, 'the same thread counts again on a new Torn day');
});

test('a quiet day counts: fresh data that finds Catch up already empty', () => {
  const out = apply(null, [[REFRESHED, ctx()]]);
  assert.strictEqual(out.r.checkinDays, 1);
  assert.deepStrictEqual(out.r.streak, { current: 1, best: 1, lastDay: D });
  assert.ok(out.newly.includes('caught-up'));
  assert.ok(out.newly.includes('switched-on'));
  assert.strictEqual(out.r.earned['caught-up'], NOON);
});

test('triage counts: a non-empty first look, then Catch up emptied with no visits', () => {
  const out = apply(null, [[REFRESHED, ctx({ blockers: 5 })], [CHANGED, ctx({ now: NOON + 60000 })]]);
  assert.strictEqual(out.r.today.firstLook, 5);
  assert.strictEqual(out.r.checkinDays, 1);
});

test('the first look is taken once a day and never overwritten', () => {
  const out = apply(null, [[REFRESHED, ctx({ blockers: 5 })], [REFRESHED, ctx({ blockers: 2, now: NOON + 60000 })]]);
  assert.strictEqual(out.r.today.firstLook, 5);
  assert.strictEqual(out.r.checkinDays, 0);
});

test('stale data does not count: 29 minutes old does, 31 minutes old does not', () => {
  const base = apply(null, [[REFRESHED, ctx({ blockers: 1 })]]).r;
  assert.strictEqual(apply(base, [[CHANGED, ctx({ now: NOON + 29 * 60000 })]]).r.checkinDays, 1);
  assert.strictEqual(apply(base, [[CHANGED, ctx({ now: NOON + 31 * 60000 })]]).r.checkinDays, 0);
});

test('no subscriptions, no first look today, or a blocker: no check-in', () => {
  assert.strictEqual(apply(null, [[REFRESHED, ctx({ subscribed: 0 })]]).r.checkinDays, 0);
  assert.strictEqual(apply(null, [[CHANGED, ctx()]]).r.checkinDays, 0, 'no refresh yet today');
  const yesterday = apply(null, [[REFRESHED, ctx({ blockers: 2 })]]).r;
  assert.strictEqual(apply(yesterday, [[CHANGED, ctx({ now: MIDNIGHT + 1000, fetchedAt: MIDNIGHT + 500 })]]).r.checkinDays, 0,
    'yesterday\'s first look does not carry into today');
  assert.strictEqual(apply(null, [[REFRESHED, ctx({ blockers: 1 })]]).r.checkinDays, 0);
});

test('refresh spam adds nothing: one day is one day', () => {
  const events = [];
  for (let i = 0; i < 20; i += 1) events.push([REFRESHED, ctx({ now: NOON + i * 1000, fetchedAt: NOON + i * 1000 })]);
  assert.strictEqual(apply(null, events).r.checkinDays, 1);
});

test('a check-in after a clock correction neither breaks nor blocks the streak', () => {
  const r = api.freshBadges();
  r.streak = { current: 5, best: 8, lastDay: D + 3 };   // written while the clock ran fast
  const fixed = apply(r, [[REFRESHED, ctx()]]).r;
  assert.deepStrictEqual(fixed.streak, { current: 5, best: 8, lastDay: D });
  const next = apply(fixed, [[REFRESHED, ctx({ now: MIDNIGHT + 1000, fetchedAt: MIDNIGHT + 1000 })]]).r;
  assert.deepStrictEqual(next.streak, { current: 6, best: 8, lastDay: D + 1 });
});

function backlogDay(firstLook, visitedIds) {
  const ids = Array.from({ length: firstLook }, (_, i) => String(100 + i));
  const events = [[REFRESHED, ctx({ blockers: firstLook, catchUpIds: ids })]];
  for (const id of visitedIds) events.push([visit(id, 61), ctx({ now: NOON + 1000 })]);
  events.push([CHANGED, ctx({ now: NOON + 2000 })]);
  return apply(null, events);
}

test('Backlog buster: 20 at the first look and 10 of those visited', () => {
  const ten = Array.from({ length: 10 }, (_, i) => 100 + i);
  const out = backlogDay(20, ten);
  assert.strictEqual(out.r.bigBacklog, 20);
  assert.ok(out.newly.includes('backlog-buster'));
});

test('Backlog buster: 19 at the first look is not a backlog', () => {
  assert.strictEqual(backlogDay(19, Array.from({ length: 10 }, (_, i) => 100 + i)).r.bigBacklog, 0);
});

test('Backlog buster: 9 backlog visits are not enough', () => {
  assert.strictEqual(backlogDay(20, Array.from({ length: 9 }, (_, i) => 100 + i)).r.bigBacklog, 0);
});

test('Backlog buster: ten visits outside the backlog do not count', () => {
  const out = backlogDay(25, Array.from({ length: 10 }, (_, i) => 900 + i));
  assert.strictEqual(out.r.checkinDays, 1, 'Mark all read still checks in');
  assert.strictEqual(out.r.bigBacklog, 0, 'but the backlog was never visited');
});

test('a repeated event reports no change, and a tick only evaluates', () => {
  const once = api.applyBadgeEvent(api.freshBadges(), REFRESHED, ctx());
  const again = api.applyBadgeEvent(once.record, REFRESHED, ctx({ now: NOON + 1000 }));
  assert.strictEqual(again.changed, false);
  const tick = api.applyBadgeEvent(api.freshBadges(), { type: 'tick' }, ctx({ facts: Object.assign({}, FACTS, { ownFoldersFilled: 1 }) }));
  assert.deepStrictEqual(tick.newly, ['switched-on', 'first-folder']);
  assert.strictEqual(tick.record.checkinDays, 0);
});
