'use strict';

// Issue #9: badges. Runtime: events, triggers, tabs, renders.
// Spec: docs/superpowers/specs/2026-10-08-badges-design.md

const test = require('node:test');
const assert = require('node:assert');
const {
  loadUserscript, FORUMS_LOCATION, subscribedThreadsPayload, forumFeedPayload,
} = require('./load-userscript');

const KEY = 'abcdefghij123456';
const NOW = 1791460800000; // 2026-10-08 12:00 TCT
const THREAD = '#/p=threads&f=61&t=7&b=0&a=0';

function forums(extra) { return Object.assign({}, FORUMS_LOCATION, extra || {}); }
function stored(env) {
  const raw = env.gmStore.get('tfcc:badges');
  return raw ? JSON.parse(raw) : null;
}

async function settle(env) {
  for (let round = 0; round < 30; round += 1) {
    for (let i = 0; i < 15; i += 1) await Promise.resolve();
    env.advanceTimersBy(1000);
  }
  for (let i = 0; i < 20; i += 1) await Promise.resolve();
}

function router(table) {
  return (url) => {
    const p = url.replace('https://api.torn.com/v2/', '').split('?')[0];
    const body = Object.prototype.hasOwnProperty.call(table, p) ? table[p] : { error: { code: 6, error: 'Unknown' } };
    return Promise.resolve({ status: 200, text: () => Promise.resolve(JSON.stringify(body)) });
  };
}

const QUIET = {
  'user/forumsubscribedthreads': subscribedThreadsPayload([{ id: 1 }, { id: 2 }]),
  'user/forumfeed': forumFeedPayload([{ threadId: 1, timestamp: (NOW - 3600000) / 1000 }]),
  'forum/categories': { categories: [{ id: 61, title: 'Tutorials', acronym: 'TG' }] },
};

test('a successful refresh on a quiet day records the first look and checks in', async () => {
  const env = loadUserscript({ location: forums(), now: NOW, gmStore: [['tfcc:key', KEY]], fetch: router(QUIET) });
  await settle(env);
  const b = stored(env);
  assert.strictEqual(b.today.firstLook, 0);
  assert.strictEqual(b.checkinDays, 1);
  assert.ok(b.earned['switched-on'] && b.earned['caught-up']);
});

test('a refresh with unread posts records the backlog and does not check in; Mark all read then does', async () => {
  const table = Object.assign({}, QUIET, {
    'user/forumsubscribedthreads': subscribedThreadsPayload([{ id: 1, new: 3 }, { id: 2, new: 1 }]),
  });
  const env = loadUserscript({ location: forums(), now: NOW, gmStore: [['tfcc:key', KEY]], fetch: router(table) });
  await settle(env);
  assert.strictEqual(stored(env).today.firstLook, 2);
  assert.deepStrictEqual(stored(env).today.backlogIds.slice().sort(), ['1', '2']);
  assert.strictEqual(stored(env).checkinDays, 0);
  const h = env.exports.makeHandlers(env.doc, env.win);
  h.onAction('markall', { getAttribute: () => null });
  assert.strictEqual(stored(env).checkinDays, 1);
});

test('the check-in counts exactly the rows the Catch up view shows', () => {
  const env = loadUserscript({ location: forums(), now: NOW });
  const api = env.exports;
  api.state.feed.subscribed = [1, 2, 3].map((id) => api.normaliseSubscribedRow({
    id, forum_id: 61, title: 'T' + id, author: { id: 9, username: 'a', karma: 1 }, posts: { new: id === 3 ? 0 : 2, total: 10 },
  }));
  api.recompute(NOW);
  assert.strictEqual(api.catchUpRowsNow().length, api.buildPanelModel(NOW).catchUp.length);
});

test('renders never write badges', () => {
  const env = loadUserscript({ location: forums({ hash: THREAD }), now: NOW });
  const before = env.gmStore.get('tfcc:badges');
  for (let i = 0; i < 50; i += 1) env.exports.draw(env.doc, env.win, env.exports.makeHandlers(env.doc, env.win), true);
  assert.strictEqual(env.gmStore.get('tfcc:badges'), before);
});

test('nothing is evaluated on load: no backfill', () => {
  const org = { v: 1, folders: [{ id: 'mine', name: 'Mine', order: 0, forumIds: [] }],
    threads: { 5: { folderId: 'mine' } }, lastCatchUpAt: 0 };
  const env = loadUserscript({ location: forums(), now: NOW, gmStore: [['tfcc:organizer', JSON.stringify(org)]] });
  assert.strictEqual(env.gmStore.get('tfcc:badges'), undefined);
  assert.strictEqual(Object.keys(env.exports.state.badges.earned).length, 0);
});

test('an organiser change evaluates, and earns with a toast', () => {
  const env = loadUserscript({ location: forums(), now: NOW });
  const api = env.exports;
  const h = api.makeHandlers(env.doc, env.win);
  api.state.organizer = api.upsertFolder(api.state.organizer, { id: 'mine', name: 'Mine', order: 3, forumIds: [] });
  h.onChange('folder', { value: 'mine', getAttribute: (k) => (k === 'data-id' ? '5' : null) });
  assert.ok(stored(env).earned['first-folder']);
  assert.match(api.state.badgeToast.text, /Badge earned: First folder \(Bronze\)\./);
});

test('two tabs on one store count one visit, not two', () => {
  const shared = new Map();
  const a = loadUserscript({ location: forums({ hash: THREAD }), now: NOW, sharedGmStore: shared });
  const b = loadUserscript({ location: forums({ hash: THREAD }), now: NOW, sharedGmStore: shared });
  a.exports.recordBadgeEvent({ type: 'visit', threadId: '7', forumId: 61 }, NOW);
  b.exports.recordBadgeEvent({ type: 'visit', threadId: '7', forumId: 61 }, NOW + 1000);
  b.exports.recordBadgeEvent({ type: 'visit', threadId: '8', forumId: 61 }, NOW + 2000);
  assert.strictEqual(JSON.parse(shared.get('tfcc:badges')).visits, 2);
  assert.strictEqual(b.exports.state.badgeToast, null, 'b earned nothing new, so b shows no toast');
});

test('with badges off, nothing is recorded', () => {
  const env = loadUserscript({ location: forums(), now: NOW });
  env.exports.state.settings.badges = false;
  assert.strictEqual(env.exports.recordBadgeEvent({ type: 'visit', threadId: '7', forumId: 61 }, NOW), null);
  assert.strictEqual(env.gmStore.get('tfcc:badges'), undefined);
});

test('badge events never make a request', () => {
  const seen = [];
  const env = loadUserscript({ location: forums(), now: NOW, fetch: (u) => { seen.push(u); return new Promise(() => {}); } });
  const before = seen.length;
  for (const type of ['visit', 'refreshed', 'catchup-changed', 'tick']) {
    env.exports.recordBadgeEvent({ type, threadId: '7', forumId: 61 }, NOW);
  }
  assert.strictEqual(seen.length, before);
});
