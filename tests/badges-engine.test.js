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
