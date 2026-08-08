'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { loadUserscript } = require('./load-userscript');

const { exports: api } = loadUserscript();

const NOW = 1000000000;
const MIN = 60000;

function org(threads, folders) {
  const base = api.freshOrganizer(0);
  if (folders) base.folders = folders;
  Object.keys(threads || {}).forEach((id) => {
    base.threads[id] = api.normaliseThreadEntry(threads[id]);
  });
  return base;
}

function sub(id, extra) {
  return Object.assign({
    id, forumId: 61, title: 'Thread ' + id, authorId: 9, authorName: 'auth',
    postsNew: 0, postsTotal: 10,
  }, extra);
}

test('unread is Torn count until the user dismisses it', () => {
  const entry = api.normaliseThreadEntry({ lastSeenTotal: 0 });
  const u = api.unreadFor(sub(1, { postsNew: 3, postsTotal: 12 }), entry);
  assert.strictEqual(u.tornUnread, 3);
  assert.strictEqual(u.unread, 3);
  assert.strictEqual(u.dismissed, false);
});

test('marking read dismisses the thread until Torn reports more posts', () => {
  let o = org({ 1: { lastSeenTotal: 0 } });
  o = api.markRead(o, 1, 12, NOW);
  assert.strictEqual(o.threads['1'].lastSeenTotal, 12);

  // Same total: dismissed, so the catch-up list lets go of it.
  let u = api.unreadFor(sub(1, { postsNew: 3, postsTotal: 12 }), o.threads['1']);
  assert.strictEqual(u.dismissed, true);
  assert.strictEqual(u.unread, 0);
  assert.strictEqual(u.tornUnread, 3, 'Torn still says three; we only suppress our own view');

  // A new post lands: the thread comes back on its own.
  u = api.unreadFor(sub(1, { postsNew: 4, postsTotal: 13 }), o.threads['1']);
  assert.strictEqual(u.dismissed, false);
  assert.strictEqual(u.unread, 4);
});

test('marking read never lowers a marker a later refresh already raised', () => {
  let o = org({ 1: {} });
  o = api.markRead(o, 1, 30, NOW);
  o = api.markRead(o, 1, 10, NOW);
  assert.strictEqual(o.threads['1'].lastSeenTotal, 30);
});

test('last activity takes the newest candidate and says which one won', () => {
  const fresh = api.normaliseThreadEntry({ lastPostTimeCached: NOW - 20 * MIN, enrichedAt: NOW - MIN });

  // Enrichment is fresh but the feed has something newer, so the feed wins.
  let r = api.resolveLastActivity(fresh, NOW - 2 * MIN, NOW);
  assert.strictEqual(r.at, NOW - 2 * MIN);
  assert.strictEqual(r.source, 'feed');

  // Enrichment is fresh and newest.
  r = api.resolveLastActivity(fresh, NOW - 60 * MIN, NOW);
  assert.strictEqual(r.source, 'enriched');

  // Enrichment older than the TTL is still a floor, but it says so.
  const stale = api.normaliseThreadEntry({ lastPostTimeCached: NOW - 20 * MIN, enrichedAt: NOW - 60 * MIN });
  r = api.resolveLastActivity(stale, 0, NOW);
  assert.strictEqual(r.source, 'enriched-stale');

  // Only a local visit is known.
  r = api.resolveLastActivity(api.normaliseThreadEntry({ lastVisitedAt: NOW - 5 * MIN }), 0, NOW);
  assert.strictEqual(r.source, 'visit');

  // Nothing at all is unknown, never zero.
  r = api.resolveLastActivity(api.normaliseThreadEntry(null), 0, NOW);
  assert.strictEqual(r.at, null);
  assert.strictEqual(r.source, 'none');
});

test('a thread the user unsubscribed from keeps everything they wrote about it', () => {
  const o = org({ 77: { note: 'important', tags: ['keep'], pinned: true, title: 'Old thread' } });
  const rows = api.mergeThreads({ subscribed: [], activity: [], categories: [], organizer: o, drafts: api.freshDrafts(), now: NOW });

  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].subscribed, false, 'and it says so');
  assert.strictEqual(rows[0].note, 'important');
  assert.deepStrictEqual(rows[0].tags, ['keep']);
  assert.strictEqual(rows[0].pinned, true);
  assert.strictEqual(rows[0].title, 'Old thread');
});

test('a thread known only from a local visit appears without any API row', () => {
  const o = org({ 5: { title: 'Seen while browsing', lastVisitedAt: NOW - MIN } });
  const rows = api.mergeThreads({ subscribed: [], activity: [], organizer: o, drafts: api.freshDrafts(), now: NOW });
  assert.strictEqual(rows[0].title, 'Seen while browsing');
  assert.strictEqual(rows[0].activitySource, 'visit');
});

test('a thread that only has a draft still appears', () => {
  const drafts = api.saveDraft(api.freshDrafts(), 42, 'half written reply', NOW, 'Draft thread');
  const rows = api.mergeThreads({ subscribed: [], activity: [], organizer: api.freshOrganizer(0), drafts, now: NOW });
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].hasDraft, true);
  assert.strictEqual(rows[0].title, 'Draft thread');
});

test('forum names come from the category list and fall back visibly', () => {
  const rows = api.mergeThreads({
    subscribed: [sub(1, { forumId: 61 }), sub(2, { forumId: 999 })],
    activity: [], categories: [{ id: 61, title: 'Tutorials and Guides', acronym: 'TG' }],
    organizer: api.freshOrganizer(0), drafts: api.freshDrafts(), now: NOW,
  });
  const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
  assert.strictEqual(byId['1'].forumName, 'Tutorials and Guides');
  assert.strictEqual(byId['2'].forumName, 'Forum 999', 'an unknown forum is named, never blank');
});

test('activity rows collapse to the newest one per thread', () => {
  const rows = api.mergeThreads({
    subscribed: [sub(1)],
    activity: [
      { threadId: 1, at: NOW - 10 * MIN },
      { threadId: 1, at: NOW - 2 * MIN },
      { threadId: 1, at: NOW - 40 * MIN },
    ].map((r) => api.normaliseActivityRow(r)),
    organizer: api.freshOrganizer(0), drafts: api.freshDrafts(), now: NOW,
  });
  assert.strictEqual(rows[0].lastActivity, NOW - 2 * MIN);
});

test('sorting puts pinned first in every mode', () => {
  const rows = api.mergeThreads({
    subscribed: [sub(1, { postsNew: 9, title: 'aaa' }), sub(2, { title: 'zzz' })],
    activity: [], organizer: org({ 2: { pinned: true } }),
    drafts: api.freshDrafts(), now: NOW,
  });
  for (const mode of api.SORT_MODES) {
    assert.strictEqual(api.sortThreads(rows, mode)[0].id, '2', 'mode ' + mode);
  }
});

test('an unknown last activity sorts last, never as the oldest', () => {
  const rows = api.mergeThreads({
    subscribed: [sub(1), sub(2), sub(3)],
    activity: [api.normaliseActivityRow({ threadId: 2, at: NOW - 100 * MIN })],
    organizer: org({ 3: { lastVisitedAt: NOW - MIN } }),
    drafts: api.freshDrafts(), now: NOW,
  });
  const sorted = api.sortThreads(rows, 'activity');
  assert.deepStrictEqual(sorted.map((r) => r.id), ['3', '2', '1']);
  assert.strictEqual(sorted[2].lastActivity, null);
});

test('sorting is stable and total for every mode', () => {
  const rows = api.mergeThreads({
    subscribed: [sub(1, { title: 'b' }), sub(2, { title: 'a' }), sub(3, { title: 'a' })],
    activity: [], organizer: api.freshOrganizer(0), drafts: api.freshDrafts(), now: NOW,
  });
  for (const mode of api.SORT_MODES) {
    const once = api.sortThreads(rows, mode).map((r) => r.id);
    const twice = api.sortThreads(api.sortThreads(rows, mode), mode).map((r) => r.id);
    assert.deepStrictEqual(once, twice, 'mode ' + mode + ' is not stable');
    assert.strictEqual(once.length, 3);
  }
  // The tie-break is title then id, so equal titles keep a defined order.
  assert.deepStrictEqual(api.sortThreads(rows, 'title').map((r) => r.id), ['2', '3', '1']);
});

test('an unknown sort mode falls back rather than returning nothing', () => {
  const rows = api.mergeThreads({
    subscribed: [sub(1), sub(2)], activity: [],
    organizer: api.freshOrganizer(0), drafts: api.freshDrafts(), now: NOW,
  });
  assert.strictEqual(api.sortThreads(rows, 'nonsense').length, 2);
  assert.strictEqual(api.sortThreads(rows, undefined).length, 2);
});

test('catch-up holds what is new and lets go of what was dismissed', () => {
  const rows = api.mergeThreads({
    subscribed: [
      sub(1, { postsNew: 2, postsTotal: 10 }),
      sub(2, { postsNew: 0, postsTotal: 5 }),
      sub(3, { postsNew: 4, postsTotal: 20 }),
    ],
    activity: [api.normaliseActivityRow({ threadId: 2, at: NOW - MIN })],
    organizer: org({ 3: { lastSeenTotal: 20 } }),
    drafts: api.freshDrafts(), now: NOW,
  });

  const list = api.catchUpList(rows, NOW - 10 * MIN).map((r) => r.id).sort();
  assert.deepStrictEqual(list, ['1', '2'],
    'thread 1 has unread, thread 2 moved since the marker, thread 3 was dismissed');

  // Moving the marker forward drops the thread that had activity but no unread.
  assert.deepStrictEqual(api.catchUpList(rows, NOW).map((r) => r.id), ['1']);
});

test('a merge with no inputs at all produces nothing and does not throw', () => {
  assert.deepStrictEqual(api.mergeThreads({}), []);
  assert.deepStrictEqual(api.mergeThreads(), []);
});
