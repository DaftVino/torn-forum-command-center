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

// ---- the dwell sampler, with the harness clock --------------------------------

function threadEnv(extra) {
  return loadUserscript(Object.assign({ location: forums({ hash: THREAD }), now: NOW, stepClock: true }, extra || {}));
}
function visits(env) { const b = stored(env); return b ? b.visits : 0; }
function secondsPass(env, n) { for (let i = 0; i < n; i += 1) env.advanceTimersBy(1000); }

test('fifteen visible, focused seconds on a thread make one focused visit', () => {
  const env = threadEnv();
  secondsPass(env, 14);
  assert.strictEqual(visits(env), 0);
  secondsPass(env, 1);
  assert.strictEqual(visits(env), 1);
  assert.deepStrictEqual(stored(env).forums, [61]);
  secondsPass(env, 60);
  assert.strictEqual(visits(env), 1, 'once per thread per day');
});

test('a hidden page accrues nothing, and accrues again once visible', () => {
  const env = threadEnv();
  env.doc.hidden = true;
  env.doc.fire('visibilitychange');
  secondsPass(env, 30);
  assert.strictEqual(visits(env), 0);
  env.doc.hidden = false;
  env.doc.fire('visibilitychange');
  secondsPass(env, 15);
  assert.strictEqual(visits(env), 1);
});

test('blur pauses and focus resumes, keeping the time so far', () => {
  const env = threadEnv();
  let focused = true;
  env.doc.hasFocus = () => focused;
  secondsPass(env, 10);
  focused = false;
  env.win.fire('blur');
  secondsPass(env, 30);
  focused = true;
  env.win.fire('focus');
  secondsPass(env, 4);
  assert.strictEqual(visits(env), 0, '10 + 4 is not 15');
  secondsPass(env, 1);
  assert.strictEqual(visits(env), 1);
});

test('a route change resets the time', () => {
  const env = threadEnv();
  secondsPass(env, 10);
  env.win.location.hash = '#/p=threads&f=4&t=8&b=0&a=0';
  env.exports.syncToRoute(env.doc, env.win);
  secondsPass(env, 14);
  assert.strictEqual(visits(env), 0);
  secondsPass(env, 1);
  assert.strictEqual(visits(env), 1);
  assert.deepStrictEqual(stored(env).today.visitIds, ['8']);
});

test('repeated syncToRoute on one thread adds only real time', () => {
  const env = threadEnv();
  for (let i = 0; i < 40; i += 1) env.exports.syncToRoute(env.doc, env.win); // React churn
  secondsPass(env, 14);
  for (let i = 0; i < 40; i += 1) env.exports.syncToRoute(env.doc, env.win);
  assert.strictEqual(visits(env), 0);
});

test('takeover covers the thread, so it accrues nothing', () => {
  const env = threadEnv();
  env.exports.state.settings.takeover = true;
  secondsPass(env, 30);
  assert.strictEqual(visits(env), 0);
});

test('collapsing the panel does not stop the dwell clock', () => {
  // #8 collapses the panel when a thread opens. The visit must still count.
  const env = threadEnv();
  env.exports.state.settings.collapsed = true;
  secondsPass(env, 15);
  assert.strictEqual(visits(env), 1);
});

test('a forum list page is not a thread', () => {
  const env = threadEnv({ location: forums({ hash: '#/p=forums&f=61' }) });
  secondsPass(env, 60);
  assert.strictEqual(visits(env), 0);
});

test('leaving forums.php stops the sampler', () => {
  const env = threadEnv();
  secondsPass(env, 5);
  env.win.location.pathname = '/index.php';
  env.exports.syncToRoute(env.doc, env.win);
  secondsPass(env, 60);
  assert.strictEqual(visits(env), 0);
});

// ---- view -------------------------------------------------------------------

function seeded() {
  const env = loadUserscript({ location: forums({ hash: THREAD }), now: NOW });
  const api = env.exports;
  api.state.badges = api.normaliseBadges({
    v: 1, visits: 30, checkinDays: 12, bigBacklog: 0, firstCheckinAt: NOW - 864000000,
    streak: { current: 12, best: 23, lastDay: 20734 }, forums: [61],
    today: { day: 20734, firstLook: 0, backlogIds: [], visitIds: [] },
    earned: { reader: NOW - 1000, 'streak-10': NOW - 2000, 'caught-up': NOW - 3000 },
  });
  return env;
}
function html(env) { return env.exports.panelHtml(env.exports.buildPanelModel(NOW)); }

test('the chip sits in the title group, before the controls', () => {
  const out = html(seeded());
  const id = out.indexOf('class="tfcc-head-id"');
  const chip = out.indexOf('data-act="badges-shelf"');
  const ctl = out.indexOf('class="tfcc-head-ctl"');
  assert.ok(id !== -1 && chip > id && ctl > chip);
  assert.match(out, /<span class="tfcc-head-btns">.*data-act="refresh".*data-act="takeover".*data-act="collapse".*<\/span>/);
  assert.match(out, /aria-label="Badges: 3 of 15\. Streak 12 days, today counted\. Show badges\."/);
  assert.match(out, /tfcc-tier-silver/, 'the cup is drawn in the best earned tier');
});

test('the chip renders when collapsed, while loading and on a fatal error', () => {
  const env = seeded();
  const api = env.exports;
  api.state.settings.collapsed = true;
  assert.match(html(env), /data-act="badges-shelf"/);
  assert.match(api.panelHtml(api.loadingModel(NOW)), /data-act="badges-shelf"/);
  assert.match(api.panelHtml(api.errorModel('x', 'broken', NOW)), /data-act="badges-shelf"/);
});

test('the shelf and the toast render when collapsed too', () => {
  const env = seeded();
  const api = env.exports;
  api.state.settings.collapsed = true;
  api.state.badgeShelfOpen = true;
  api.state.badgeToast = { text: 'Badge earned: Reader (Bronze).', until: NOW + 6000, announced: false };
  const out = html(env);
  assert.match(out, /class="tfcc-shelf"/);
  assert.match(out, /Streak 12 Torn days, today counted\. Best 23\./);
  assert.match(out, /role="status"[^>]*>Badge earned: Reader/);
});

test('the toast is announced once', () => {
  const env = seeded();
  const api = env.exports;
  api.state.badgeToast = { text: 'Badge earned: Reader (Bronze).', until: NOW + 6000, announced: false };
  api.draw(env.doc, env.win, api.makeHandlers(env.doc, env.win), true);
  assert.strictEqual(api.state.badgeToast.announced, true);
  assert.doesNotMatch(html(env), /role="status"/);
});

test('a broken streak shows 0, and no badges shows an outline cup', () => {
  const env = seeded();
  env.exports.state.badges.streak = { current: 12, best: 23, lastDay: 20730 };
  assert.match(html(env), /Streak 0 days/);
  const fresh = loadUserscript({ location: forums(), now: NOW });
  assert.match(html(fresh), /aria-label="Badges: 0 of 15\. Show badges\."/);
  assert.match(html(fresh), /tfcc-locked/);
});

test('badges off: no chip, no shelf, no toast', () => {
  const env = seeded();
  env.exports.state.settings.badges = false;
  env.exports.state.badgeShelfOpen = true;
  const out = html(env);
  assert.doesNotMatch(out, /tfcc-chip|tfcc-shelf|tfcc-toast/);
});

test('the catalogue lists all fifteen with how to earn them, collapsed by default', () => {
  const env = seeded();
  const api = env.exports;
  api.state.settings.view = 'settings';
  assert.match(html(env), /data-act="badges-catalogue" aria-expanded="false">Show all 15 badges/);
  api.state.badgeCatalogueOpen = true;
  const out = html(env);
  for (const b of api.BADGES) {
    assert.ok(out.includes(b.name), b.name);
    assert.ok(out.includes(api.BADGES.find((x) => x.id === b.id).rule.slice(0, 30)), b.id + ' rule');
  }
  assert.match(out, /Focused thread visits/);
  assert.match(out, /Forums explored/);
  assert.match(out, /role="progressbar" aria-valuenow="1" aria-valuemin="0" aria-valuemax="3"/);
  assert.doesNotMatch(out, /threads read/i);
});

test('the chip toggles the shelf, and All badges opens the catalogue', () => {
  const env = seeded();
  const api = env.exports;
  const h = api.makeHandlers(env.doc, env.win);
  h.onAction('badges-shelf', { getAttribute: () => null });
  assert.strictEqual(api.state.badgeShelfOpen, true);
  // The shelf also renders when collapsed, so All badges must expand the panel:
  // Settings is invisible while the panel is collapsed.
  api.state.settings.collapsed = true;
  h.onAction('badges-all', { getAttribute: () => null });
  assert.strictEqual(api.state.settings.collapsed, false);
  assert.strictEqual(api.state.settings.view, 'settings');
  assert.strictEqual(api.state.badgeCatalogueOpen, true);
  assert.strictEqual(api.state.badgeShelfOpen, false);
  h.onChange('badges-toggle', { checked: false, getAttribute: () => null });
  assert.strictEqual(api.state.settings.badges, false);
  assert.strictEqual(JSON.parse(env.gmStore.get('tfcc:settings')).badges, false);
});

test('every icon is ASCII SVG with no emoji and no text node', () => {
  const env = seeded();
  env.exports.state.settings.view = 'settings';
  env.exports.state.badgeCatalogueOpen = true;
  const out = html(env);
  assert.ok(/^[\x09-\x7e]*$/.test(out));
  assert.doesNotMatch(out, /<text[\s>]/, 'no SVG text node (a <textarea> is not one)');
});

// ---- reset and debug ------------------------------------------------------------

test('Reset everything really resets badges, and nothing returns silently', () => {
  const env = seeded();
  const api = env.exports;
  api.persist('badges');
  api.state.badgeShelfOpen = true;
  api.state.badgeToast = { text: 'x', until: NOW + 6000, announced: false };
  api.makeHandlers(env.doc, env.win).onAction('reset-all', { getAttribute: () => null });
  assert.deepStrictEqual(JSON.parse(env.gmStore.get('tfcc:badges')), api.freshBadges());
  assert.strictEqual(api.state.badgeShelfOpen, false);
  assert.strictEqual(api.state.badgeToast, null);
  api.draw(env.doc, env.win, api.makeHandlers(env.doc, env.win), true);
  assert.deepStrictEqual(JSON.parse(env.gmStore.get('tfcc:badges')).earned, {}, 'a redraw re-awards nothing');
});

test('Reset everything resets every key except the API key', () => {
  const env = seeded();
  const api = env.exports;
  env.gmStore.set('tfcc:key', KEY);
  api.makeHandlers(env.doc, env.win).onAction('reset-all', { getAttribute: () => null });
  for (const name of Object.keys(api.STORAGE_KEYS)) {
    if (name === 'key') { assert.strictEqual(env.gmStore.get('tfcc:key'), KEY); continue; }
    assert.ok(env.gmStore.has(api.STORAGE_KEYS[name]), name + ' was written by the reset');
  }
});

test('the API key never reaches the badges record, the export block, a toast or the report', () => {
  const env = seeded();
  const api = env.exports;
  const btoa = (s) => Buffer.from(String(s), 'binary').toString('base64');
  const atob = (s) => Buffer.from(String(s), 'base64').toString('binary');
  env.gmStore.set('tfcc:key', KEY);
  api.persist('badges');
  api.state.badgeToast = { text: api.badgeToastText(['reader'], api.state.badges,
    { switchedOn: 1, ownFoldersFilled: 0, subscribed: 0, unfiledSubscribed: 0 }), until: NOW + 6000, announced: false };
  const exported = JSON.stringify(api.decodeState(
    api.encodeState(api.state.organizer, api.state.drafts, btoa, api.state.badges), atob).payload);
  const surfaces = {
    record: env.gmStore.get('tfcc:badges'), exported, toast: api.state.badgeToast.text,
    report: api.buildDebugReport(), panel: html(env),
  };
  assert.ok(env.gmStore.get('tfcc:key') === KEY, 'the key really is stored, so absence below means something');
  assert.match(surfaces.exported, /"badges":\{/, 'the export really carries the block');
  assert.match(surfaces.report, /badges: on/);
  for (const [name, text] of Object.entries(surfaces)) {
    assert.ok(typeof text === 'string' && text.length > 0, name + ' is non-empty');
    assert.ok(!text.includes(KEY), name + ' contains the API key');
  }
});

test('the debug report carries badge counts and no ids', () => {
  const env = seeded();
  const report = env.exports.buildDebugReport();
  assert.match(report, /badges: on, 3 earned, streak 12\/23, check-in days 12, focused visits 30/);
  assert.doesNotMatch(report, /20734|reader|streak-10/);
});

// ---- reconciled with siblings already on main (#8, #2, #3) ----------------------

test('auto-hide closes the badge shelf', () => {
  const env = seeded();
  const api = env.exports;
  api.state.settings.autoHideOnOpen = true;
  api.state.badgeShelfOpen = true;
  // #8's signature is onThreadLink(link, click); only the click is read.
  api.makeHandlers(env.doc, env.win).onThreadLink(null, { button: 0 });
  assert.strictEqual(api.state.settings.collapsed, true);
  assert.strictEqual(api.state.badgeShelfOpen, false);
});

test('a row cap never makes Catch up look empty to the check-in', () => {
  const env = seeded();
  const api = env.exports;
  api.state.settings.rowsShown = 3;
  api.state.feed.subscribed = [1, 2, 3, 4, 5].map((id) => api.normaliseSubscribedRow({ id, forum_id: 61,
    title: 'T' + id, author: { id: 3, username: 'a', karma: 1 }, posts: { new: 1, total: 10 } }));
  api.recompute(NOW);
  assert.strictEqual(api.buildPanelModel(NOW).capped.catchup.rows.length, 3, 'the view shows three');
  assert.strictEqual(api.catchUpRowsNow().length, 5, 'the check-in still counts five');
});

test('a visit recorded in one tab survives a write from another tab', () => {
  // Each write re-reads storage first. Writing from a tab's own memory would
  // let tab b, which loaded before tab a's visit, overwrite it.
  const shared = new Map();
  const a = loadUserscript({ location: forums({ hash: THREAD }), now: NOW, sharedGmStore: shared });
  const b = loadUserscript({ location: forums({ hash: THREAD }), now: NOW, sharedGmStore: shared });
  a.exports.recordBadgeEvent({ type: 'visit', threadId: '7', forumId: 61 }, NOW);
  b.exports.recordBadgeEvent({ type: 'visit', threadId: '8', forumId: 4 }, NOW + 1000);
  const rec = JSON.parse(shared.get('tfcc:badges'));
  assert.strictEqual(rec.visits, 2);
  assert.deepStrictEqual(rec.today.visitIds, ['7', '8']);
  assert.deepStrictEqual(rec.forums, [61, 4]);
});

// ---- reconciled with #4 (author-only): unknown is not clear (panel ruling 9) ----

function authorOnlyEnv(entry) {
  const env = loadUserscript({ location: forums(), now: NOW, gmStore: [['tfcc:key', KEY]] });
  const api = env.exports;
  api.state.settings.authorOnly = true;
  api.state.organizer.threads['9'] = api.normaliseThreadEntry(Object.assign({ lastVisitedAt: NOW - 1000 }, entry || {}));
  // One subscribed row with Torn-reported new posts. With no author check yet,
  // #4 lists it under "Not yet checked", not in the main Catch up list.
  api.state.feed.subscribed = [api.normaliseSubscribedRow({ id: 9, forum_id: 61, title: 'T',
    author: { id: 3, username: 'a', karma: 1 }, posts: { new: 2, total: 50 } })];
  api.state.feed.fetchedAt = NOW;
  api.recompute(NOW);
  return env;
}

test('an unchecked-only Catch up does not credit a check-in', () => {
  const env = authorOnlyEnv();
  const api = env.exports;
  assert.strictEqual(api.catchUpRowsNow().length, 0, 'the main list is empty');
  assert.strictEqual(api.buildPanelModel(NOW).catchUpUnchecked.length, 1, 'the row waits in Not yet checked');
  const r = api.recordBadgeEvent({ type: 'refreshed' }, NOW);
  assert.strictEqual(r.record.today.firstLook, 1, 'the unchecked row is a blocker');
  assert.deepStrictEqual(r.record.today.backlogIds, ['9']);
  assert.strictEqual(r.record.checkinDays, 0, 'no day is credited while a row is unchecked');
});

test('after a refresh checks them, a same-day check-in credits', () => {
  const env = authorOnlyEnv();
  const api = env.exports;
  assert.strictEqual(api.recordBadgeEvent({ type: 'refreshed' }, NOW).record.checkinDays, 0);
  // A later ordinary refresh the same Torn day checks the thread: no author post.
  Object.assign(api.state.organizer.threads['9'], { authorCheckedAt: NOW + 30000, authorCheckTotal: 50,
    authorCheckSince: NOW - 1000, authorNewCount: 0, authorCheckComplete: true });
  api.recompute(NOW + 60000);
  assert.strictEqual(api.buildPanelModel(NOW + 60000).catchUpUnchecked.length, 0, 'the row is now known');
  const r = api.recordBadgeEvent({ type: 'catchup-changed' }, NOW + 60000);
  assert.strictEqual(r.record.checkinDays, 1);
  assert.strictEqual(r.record.streak.lastDay, 20734, 'credited to the same Torn day, never an earlier one');
});

test('with author-only off, the unchecked group never blocks', () => {
  const env = authorOnlyEnv();
  const api = env.exports;
  api.state.settings.authorOnly = false;
  api.recompute(NOW);
  // In any-poster mode the same row is simply unread, so it blocks as Catch up.
  assert.strictEqual(api.catchUpRowsNow().length, 1);
  assert.strictEqual(api.buildPanelModel(NOW).catchUpUnchecked.length, 0);
  assert.strictEqual(api.recordBadgeEvent({ type: 'refreshed' }, NOW).record.today.firstLook, 1,
    'counted once, as Catch up, not twice');
});

