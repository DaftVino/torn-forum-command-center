'use strict';

const test = require('node:test');
const assert = require('node:assert');
const {
  loadUserscript, FORUMS_LOCATION, subscribedThreadsPayload, forumFeedPayload,
} = require('./load-userscript');

const KEY = 'abcdefghij123456';
const NOW = 1700000000000;

// 200 ms steps, not 1000. These tests hold a request open on purpose, and a
// coarser step would sail past the 15 second request deadline and time the
// request out - so the "in-flight" refresh would already be dead and the test
// would pass without ever reaching the staleness guard it exists to check.
// 30 x 200 ms clears the 650 ms rate-limit gap and stays well inside 15 s.
async function settle(env, ms) {
  const step = ms === undefined ? 200 : ms;
  for (let round = 0; round < 30; round += 1) {
    for (let i = 0; i < 15; i += 1) await Promise.resolve();
    env.advanceTimersBy(step);
  }
  for (let i = 0; i < 20; i += 1) await Promise.resolve();
}

// Without a re-entrancy guard the second call runs a real search against a
// transport that never answers, so it never settles. Racing it keeps the
// failure a clear assertion instead of a hung suite.
function bounded(promise) {
  // Many microtask turns, not one. The promise under test is created inside the
  // vm realm, and adopting a foreign thenable costs extra ticks - a one-tick
  // fallback wins the race against a promise that is already resolved.
  let ticks = Promise.resolve();
  for (let i = 0; i < 50; i += 1) ticks = ticks.then(() => {});
  return Promise.race([promise, ticks.then(() => ({ ok: 'never-settled' }))]);
}

// Torn's reply box: TinyMCE's contenteditable body (ADR 0002). Tests "type" by
// setting its HTML and dispatching input, the way TinyMCE's own typing does.
function replyBox(env) {
  const box = env.makeElement('div');
  box.getBoundingClientRect = () => ({ width: 600, height: 160 });
  env.doc.querySelectorAll = (sel) => (sel === '#editor-wrapper .editor-content.mce-content-body' ? [box] : []);
  Object.defineProperty(box, 'value', { get() { return box.innerHTML; }, set(v) { box.innerHTML = v ? '<p>' + v + '</p>' : '<p><br data-mce-bogus="1"></p>'; } });
  return box;
}

function forums(extra) {
  return Object.assign({}, FORUMS_LOCATION, extra || {});
}

// A transport that hands back control so a test can act while a refresh is
// genuinely mid-flight, which is the only way to reach the staleness guard.
function gatedTransport(table) {
  let release = null;
  const gate = new Promise((r) => { release = r; });
  let calls = 0;
  return {
    release: () => release(),
    calls: () => calls,
    fetch(url) {
      calls += 1;
      const path = url.replace('https://api.torn.com/v2/', '').split('?')[0];
      const body = Object.prototype.hasOwnProperty.call(table, path)
        ? table[path] : { error: { code: 6, error: 'Unknown' } };
      const answer = { status: 200, text: () => Promise.resolve(JSON.stringify(body)) };
      return calls === 1 ? gate.then(() => answer) : Promise.resolve(answer);
    },
  };
}

const TABLE = {
  'user/forumsubscribedthreads': subscribedThreadsPayload([{ id: 1, new: 2 }, { id: 2 }]),
  'user/forumfeed': forumFeedPayload([]),
  'forum/categories': { categories: [] },
};

test('a reset during an in-flight refresh is not undone when it lands', async () => {
  // The window is real: a refresh is at least two sequential requests with a
  // 650 ms gap between them, so there are seconds in which the user can open
  // Settings and press reset.
  const t = gatedTransport(TABLE);
  const env = loadUserscript({ location: forums(), now: NOW, gmStore: [['tfcc:key', KEY]], fetch: t.fetch });
  const api = env.exports;

  await settle(env);
  assert.ok(t.calls() >= 1, 'a refresh should be in flight');

  api.state.organizer = api.toggleTag(api.state.organizer, 99, 'made-by-hand');
  const handlers = api.makeHandlers(env.doc, env.win);
  handlers.onAction('reset-all', { getAttribute: () => null });

  assert.strictEqual(Object.keys(api.state.organizer.threads).length, 0, 'the reset itself worked');

  t.release();
  await settle(env);

  assert.strictEqual(api.state.feed.subscribed.length, 0,
    'the in-flight refresh repopulated data the user had just wiped');
  assert.strictEqual(Object.keys(api.state.organizer.threads).length, 0);
  assert.strictEqual(JSON.parse(env.gmStore.get('tfcc:feed')).subscribed.length, 0,
    'and it wrote that data back to storage');
});

test('resetting folders and tags also survives an in-flight refresh', async () => {
  const t = gatedTransport(TABLE);
  const env = loadUserscript({ location: forums(), now: NOW, gmStore: [['tfcc:key', KEY]], fetch: t.fetch });
  const api = env.exports;

  await settle(env);
  const handlers = api.makeHandlers(env.doc, env.win);
  handlers.onAction('reset-organizer', { getAttribute: () => null });

  t.release();
  await settle(env);
  assert.strictEqual(Object.keys(api.state.organizer.threads).length, 0);
});

test('clearing the key stops an in-flight refresh from populating anything', async () => {
  const t = gatedTransport(TABLE);
  const env = loadUserscript({ location: forums(), now: NOW, gmStore: [['tfcc:key', KEY]], fetch: t.fetch });
  const api = env.exports;

  await settle(env);
  const handlers = api.makeHandlers(env.doc, env.win);
  handlers.onAction('key-clear', { getAttribute: () => null });

  t.release();
  await settle(env);
  assert.strictEqual(api.state.feed.subscribed.length, 0,
    'data fetched with a key the user has since revoked must not land');
});

test('leaving the forums page discards a refresh that is still running', async () => {
  const t = gatedTransport(TABLE);
  const env = loadUserscript({ location: forums(), now: NOW, gmStore: [['tfcc:key', KEY]], fetch: t.fetch });
  const api = env.exports;

  await settle(env);
  env.win.location.pathname = '/index.php';
  api.syncToRoute(env.doc, env.win);

  t.release();
  await settle(env);
  assert.strictEqual(api.state.mounted, false, 'the panel is gone');
  assert.strictEqual(env.doc.getElementById('tfcc-panel'), null,
    'and a late result must not bring it back on another page');
});

test('a second deep search while one is running is refused, not raced', async () => {
  // Both would read-modify-write state.postCache, and whichever landed last
  // would silently discard the other one's freshly fetched posts.
  const env = loadUserscript({
    location: forums(), now: NOW, gmStore: [['tfcc:key', KEY]],
    fetch: () => new Promise(() => {}),
  });
  const api = env.exports;

  const first = api.runDeepSearch([1], 'something', NOW);
  assert.strictEqual(api.state.deepBusy, true);

  const second = await bounded(api.runDeepSearch([2], 'something', NOW));
  assert.strictEqual(second.ok, false,
    second.ok === 'never-settled' ? 'the second search ran instead of being refused' : 'expected a refusal');
  assert.strictEqual(second.reason, 'inflight');

  void first;
});

test('a deep search with no query tells the user why nothing happened', async () => {
  const env = loadUserscript({ location: forums(), now: NOW, gmStore: [['tfcc:key', KEY]] });
  const api = env.exports;
  api.state.settings.view = 'search';
  api.state.searchQuery = '';

  const handlers = api.makeHandlers(env.doc, env.win);
  handlers.onAction('deep', { getAttribute: () => null });
  await settle(env);

  const notices = api.state.notices.map((n) => n.text).join(' ');
  assert.match(notices, /Type something to search for/,
    'silently doing nothing is indistinguishable from being broken');
});

test('the reply box autosaves what the user types', async () => {
  // The setting defaults to on and says so on the label. A user who types a
  // long reply and loses the tab has every reason to expect it was kept.
  const env = loadUserscript({ location: forums({ hash: '#/p=threads&f=61&t=77' }), now: NOW });
  const api = env.exports;

  const box = replyBox(env);
  api.syncToRoute(env.doc, env.win);
  assert.strictEqual(api.state.replyBoxFound, true);

  box.value = 'a reply I am part way through writing';
  box.dispatchEvent({ type: 'input' });
  env.advanceTimersBy(3000);

  assert.strictEqual(api.draftFor(api.state.drafts, 77).text, '<p>a reply I am part way through writing</p>');
  assert.ok(env.gmStore.has('tfcc:drafts'), 'and it survives a reload');
});

test('autosave is debounced rather than writing on every keystroke', () => {
  const env = loadUserscript({ location: forums({ hash: '#/p=threads&t=77' }), now: NOW });
  const api = env.exports;
  const box = replyBox(env);
  api.syncToRoute(env.doc, env.win);

  for (const chunk of ['a', 'ab', 'abc', 'abcd']) {
    box.value = chunk;
    box.dispatchEvent({ type: 'input' });
    env.advanceTimersBy(100);
  }
  assert.strictEqual(api.draftFor(api.state.drafts, 77), null, 'nothing written yet');

  env.advanceTimersBy(3000);
  assert.strictEqual(api.draftFor(api.state.drafts, 77).text, '<p>abcd</p>', 'one write, with the final text');
});

test('an emptied reply box does not delete the saved draft', () => {
  // Torn clears the reply box after a successful post, and it can hand back an
  // empty editor body mid-render. Either would otherwise wipe the draft.
  const env = loadUserscript({ location: forums({ hash: '#/p=threads&t=77' }), now: NOW });
  const api = env.exports;
  const box = replyBox(env);
  api.syncToRoute(env.doc, env.win);

  box.value = 'something worth keeping';
  box.dispatchEvent({ type: 'input' });
  env.advanceTimersBy(3000);

  box.value = '';
  box.dispatchEvent({ type: 'input' });
  env.advanceTimersBy(3000);

  assert.strictEqual(api.draftFor(api.state.drafts, 77).text, '<p>something worth keeping</p>');
});

test('autosave does nothing when the setting is off', () => {
  const env = loadUserscript({
    location: forums({ hash: '#/p=threads&t=77' }), now: NOW,
    gmStore: [['tfcc:settings', JSON.stringify({ v: 1, autosaveDrafts: false })]],
  });
  const api = env.exports;
  const box = replyBox(env);
  api.syncToRoute(env.doc, env.win);

  box.value = 'typed with autosave off';
  box.dispatchEvent({ type: 'input' });
  env.advanceTimersBy(3000);
  assert.strictEqual(api.draftFor(api.state.drafts, 77), null);
});

test('autosave attaches once, not once per redraw', () => {
  const env = loadUserscript({ location: forums({ hash: '#/p=threads&t=77' }), now: NOW });
  const api = env.exports;
  const box = replyBox(env);
  for (let i = 0; i < 6; i += 1) api.syncToRoute(env.doc, env.win);
  assert.strictEqual((box._listeners.input || []).length, 1,
    'the panel redraws constantly; a listener per redraw would pile up');
});

const { forumThreadsPayload, forumPostsPayload } = require('./load-userscript');   // built from tests/fixtures/

function gatedOn(table, heldPath) {
  let release = null;
  const gate = new Promise((r) => { release = r; });
  return {
    release: () => release(),
    fetch(url) {
      const path = url.replace('https://api.torn.com/v2/', '').split('?')[0];
      const body = Object.prototype.hasOwnProperty.call(table, path)
        ? table[path] : { error: { code: 6, error: 'Unknown' } };
      const answer = { status: 200, text: () => Promise.resolve(JSON.stringify(body)) };
      return path === heldPath ? gate.then(() => answer) : Promise.resolve(answer);
    },
  };
}

test('a reset while My posts is loading drops the late answer', async () => {
  const table = Object.assign({}, TABLE, {
    'user/forumthreads': forumThreadsPayload([{ id: 10, replies: 3 }]),
    'user/forumposts': forumPostsPayload([{ id: 1, threadId: 20 }]),
  });
  const t = gatedOn(table, 'user/forumthreads');
  const env = loadUserscript({ location: forums(), now: NOW, gmStore: [['tfcc:key', KEY]], fetch: t.fetch });
  const api = env.exports;
  await settle(env);                       // init's Threads refresh completes

  api.refreshMine(NOW);
  await settle(env);                       // now held on user/forumthreads
  api.makeHandlers(env.doc, env.win).onAction('reset-all', { getAttribute: () => null });

  t.release();
  await settle(env);
  assert.strictEqual(api.state.mine.threads.length, 0, 'a late answer refilled what the user wiped');
  const stored = env.gmStore.get('tfcc:mine');
  assert.ok(!stored || JSON.parse(stored).threads.length === 0, 'and wrote it back to storage');
});

// The success path drops a stale answer; the error path must too (#24). The
// chain reaches its catch only through a throw, so the test makes one: the
// first read of the subscribed list after both lists land clears the key
// (which invalidates the run) and then throws, as a bug in a stale run would.
test('clearing the key while My posts is loading drops a late error too', async () => {
  const table = Object.assign({}, TABLE, {
    'user/forumthreads': forumThreadsPayload([{ id: 10, replies: 3 }]),
    'user/forumposts': forumPostsPayload([{ id: 1, threadId: 20 }]),
  });
  const t = gatedOn(table, 'none');
  const env = loadUserscript({ location: forums(), now: NOW, gmStore: [['tfcc:key', KEY]], fetch: t.fetch });
  const api = env.exports;
  await settle(env);                       // init's Threads refresh completes
  const handlers = api.makeHandlers(env.doc, env.win);
  const feed = api.state.feed;
  const subs = feed.subscribed;
  let fired = false;
  Object.defineProperty(feed, 'subscribed', {
    configurable: true,
    get() {
      if (fired) return subs;
      fired = true;
      handlers.onAction('key-clear', { getAttribute: () => null });
      throw new Error('boom after the key was cleared');
    },
  });

  const p = api.refreshMine(NOW);
  await settle(env);
  const res = await p;
  assert.ok(fired, 'the throw was reached');
  assert.strictEqual(api.state.mineError, null, 'a stale run wrote its error after the key was cleared');
  assert.strictEqual(res.reason, 'stale');
});
