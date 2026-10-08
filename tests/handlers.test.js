'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { loadUserscript, FORUMS_LOCATION, readSource } = require('./load-userscript');

const NOW = 1700000000000;

function forums(extra) {
  return Object.assign({}, FORUMS_LOCATION, extra || {});
}

// Render every view with enough state that every conditional branch of the
// markup is reached, and collect every data-act it emits.
function renderedActions() {
  const env = loadUserscript({ location: forums({ hash: '#/p=threads&f=61&t=1' }), now: NOW });
  const api = env.exports;

  api.state.feed.subscribed = [1, 2].map((id) => api.normaliseSubscribedRow({
    id, forum_id: 61, title: 'Thread ' + id,
    author: { id: 3, username: 'someone', karma: 1 },
    posts: { new: id, total: 10 },
  }));
  api.state.feed.categories = [{ id: 61, title: 'Tutorials', acronym: 'TG' }];
  api.state.organizer = api.toggleTag(api.state.organizer, 1, 'atag');
  api.state.drafts = api.saveDraft(api.freshDrafts(), 1, 'a draft', NOW, 'Thread 1');
  api.state.postCache = api.postCacheAdd(api.freshPostCache(), 1, [
    { id: 9, authorName: 'x', at: NOW, text: 'cached body' },
  ], { fetchedAt: NOW });
  api.state.searchQuery = 'thread';
  api.state.route = api.parseForumRoute(env.win.location);
  api.recompute(NOW);

  const actions = new Set();
  for (const view of api.VIEWS) {
    for (const replyBox of [true, false]) {
      api.state.settings.view = view;
      api.state.replyBoxFound = replyBox;
      api.state.searchResults = { mode: 'deep', query: 'thread', posts: [{ threadId: '1', threadTitle: 'Thread 1', postId: 9, authorName: 'x', at: NOW, text: 'cached body' }] };
      const html = api.panelHtml(api.buildPanelModel(NOW));
      const re = /data-act="([a-z-]+)"/g;
      let m;
      while ((m = re.exec(html))) actions.add(m[1]);
    }
  }

  // Collapsed only ever renders the header, but it renders it, so include it.
  api.state.settings.collapsed = true;
  const collapsed = api.panelHtml(api.buildPanelModel(NOW));
  const re2 = /data-act="([a-z-]+)"/g;
  let m2;
  while ((m2 = re2.exec(collapsed))) actions.add(m2[1]);

  return { env, actions: [...actions].sort() };
}

// The handler is a chain of `act === 'name'` comparisons. Reading them out of
// the source is cruder than calling the handler, but it is the only way to see
// a case that exists for a control nobody renders.
function handledActions() {
  const src = readSource();
  const start = src.indexOf('function makeHandlers(');
  assert.ok(start !== -1, 'makeHandlers not found');
  const body = src.slice(start, src.indexOf('// ---- bootstrap', start));
  const out = new Set();
  const re = /act === '([a-z-]+)'/g;
  let m;
  while ((m = re.exec(body))) out.add(m[1]);
  return [...out].sort();
}

test('every control the panel renders has a handler', () => {
  // A button that renders and does nothing is the worst kind of bug: it looks
  // finished, the user clicks it, and nothing happens with no error anywhere.
  const { actions } = renderedActions();
  const handled = handledActions();

  // These carry data only; they are read by valueOf() rather than dispatched.
  const dataOnly = ['key-input', 'draft-text', 'import-text', 'folder-name'];

  const dead = actions.filter((a) => handled.indexOf(a) === -1 && dataOnly.indexOf(a) === -1);
  assert.deepStrictEqual(dead, [], 'controls that render but do nothing: ' + dead.join(', '));
});

test('every handler case corresponds to a control that is actually rendered', () => {
  const { actions } = renderedActions();
  const handled = handledActions();
  const orphans = handled.filter((a) => actions.indexOf(a) === -1);
  assert.deepStrictEqual(orphans, [], 'handlers for controls nobody renders: ' + orphans.join(', '));
});

test('the value-carrying controls are unique, so valueOf reads the right one', () => {
  // valueOf() finds the first element with a data-act. If two controls in the
  // same view shared one, saving the key could read the import box.
  const env = loadUserscript({ location: forums(), now: NOW });
  const api = env.exports;
  api.state.settings.view = 'settings';
  const html = api.panelHtml(api.buildPanelModel(NOW));

  for (const act of ['key-input', 'import-text', 'folder-name']) {
    const count = (html.match(new RegExp('data-act="' + act + '"', 'g')) || []).length;
    assert.strictEqual(count, 1, act + ' appears ' + count + ' times in the settings view');
  }
});

test('clicking a row control changes state and persists it', () => {
  const env = loadUserscript({ location: forums(), now: NOW });
  const api = env.exports;
  api.state.feed.subscribed = [api.normaliseSubscribedRow({
    id: 5, forum_id: 61, title: 'T', author: { id: 1, username: 'a', karma: 0 }, posts: { new: 2, total: 7 },
  })];
  api.recompute(NOW);

  const handlers = api.makeHandlers(env.doc, env.win);
  const el = (attrs) => ({ getAttribute: (k) => (attrs[k] === undefined ? null : attrs[k]) });

  handlers.onAction('pin', el({ 'data-act': 'pin', 'data-id': '5' }));
  assert.strictEqual(api.state.organizer.threads['5'].pinned, true);
  assert.ok(env.gmStore.has('tfcc:organizer'), 'a change the user made must survive a reload');

  handlers.onAction('prio-up', el({ 'data-act': 'prio-up', 'data-id': '5' }));
  assert.strictEqual(api.state.organizer.threads['5'].priority, 1);

  handlers.onAction('read', el({ 'data-act': 'read', 'data-id': '5' }));
  assert.strictEqual(api.state.organizer.threads['5'].lastSeenTotal, 7, 'read marks against the real total');

  handlers.onAction('archive', el({ 'data-act': 'archive', 'data-id': '5' }));
  assert.strictEqual(api.state.organizer.threads['5'].archived, true);
});

test('changing a setting persists it', () => {
  const env = loadUserscript({ location: forums(), now: NOW });
  const api = env.exports;
  const handlers = api.makeHandlers(env.doc, env.win);
  const el = (act, value) => ({ getAttribute: (k) => (k === 'data-act' ? act : null), value });

  handlers.onChange('sort', el('sort', 'unread'));
  assert.strictEqual(api.state.settings.sort, 'unread');
  assert.strictEqual(JSON.parse(env.gmStore.get('tfcc:settings')).sort, 'unread');

  handlers.onChange('theme', el('theme', 'light'));
  assert.strictEqual(api.state.settings.theme, 'light');

  // A value that is not on the menu is refused rather than stored.
  handlers.onChange('sort', el('sort', 'chaos'));
  assert.strictEqual(api.state.settings.sort, 'unread');
});

test('a handler for an unknown action does nothing and does not throw', () => {
  const env = loadUserscript({ location: forums(), now: NOW });
  const handlers = env.exports.makeHandlers(env.doc, env.win);
  const el = { getAttribute: () => null };
  assert.doesNotThrow(() => handlers.onAction('not-a-real-action', el));
  assert.doesNotThrow(() => handlers.onChange('not-a-real-action', el));
  assert.doesNotThrow(() => handlers.onAction('pin', el), 'no data-id must not throw');
});

test('the Draft button opens that thread even from another route', () => {
  // The button lives on a row in the Threads view, which is not a thread page.
  // Without a focus id the drafts view would key off the route and show the
  // editor for nothing at all.
  const env = loadUserscript({ location: forums(), now: NOW });
  const api = env.exports;
  api.state.feed.subscribed = [api.normaliseSubscribedRow({
    id: 8, forum_id: 61, title: 'T', author: { id: 1, username: 'a', karma: 0 }, posts: { new: 0, total: 3 },
  })];
  api.recompute(NOW);

  const handlers = api.makeHandlers(env.doc, env.win);
  handlers.onAction('draft', { getAttribute: (k) => (k === 'data-id' ? '8' : null) });

  assert.strictEqual(api.state.settings.view, 'drafts');
  assert.strictEqual(api.state.draftFocusId, '8');
  assert.match(api.panelHtml(api.buildPanelModel(NOW)), /data-act="draft-save" data-id="8"/);
});

test('a note typed on a row is saved', () => {
  const env = loadUserscript({ location: forums(), now: NOW });
  const api = env.exports;
  const handlers = api.makeHandlers(env.doc, env.win);

  handlers.onChange('note-input', {
    getAttribute: (k) => (k === 'data-id' ? '3' : (k === 'data-act' ? 'note-input' : null)),
    value: 'check this before the war',
  });
  assert.strictEqual(api.state.organizer.threads['3'].note, 'check this before the war');
  assert.strictEqual(JSON.parse(env.gmStore.get('tfcc:organizer')).threads['3'].note, 'check this before the war');

  // Clearing it is how a note is deleted; an empty string must not be refused.
  handlers.onChange('note-input', {
    getAttribute: (k) => (k === 'data-id' ? '3' : null), value: '',
  });
  assert.strictEqual(api.state.organizer.threads['3'].note, '');
});

test('changing the auto-refresh interval reschedules the timer', () => {
  // Setting this up once at startup would mean the choice did nothing at all
  // until the next page load, which looks exactly like a broken setting.
  const env = loadUserscript({ location: forums(), now: NOW });
  const api = env.exports;
  const before = env.pendingTimerCount();

  const handlers = api.makeHandlers(env.doc, env.win);
  handlers.onChange('auto-refresh', { getAttribute: () => null, value: '120000' });

  assert.strictEqual(api.state.settings.autoRefreshMs, 120000);
  assert.ok(env.pendingTimerCount() > before, 'a timer should now be armed');

  handlers.onChange('auto-refresh', { getAttribute: () => null, value: '0' });
  assert.strictEqual(api.state.settings.autoRefreshMs, 0);
});

test('hiding Torn own box is a stylesheet, never a node removal', () => {
  // The one feature that has to name Torn's elements. A wrong guess must cost
  // nothing, where a wrong querySelector plus .remove() could take a piece of
  // Torn's page with it.
  const env = loadUserscript({ location: forums(), now: NOW });
  const api = env.exports;
  assert.strictEqual(env.doc.getElementById('tfcc-hide-torn-box'), null, 'off by default');

  const handlers = api.makeHandlers(env.doc, env.win);
  handlers.onChange('hide-torn-box', { getAttribute: () => null, checked: true, value: 'on' });

  const style = env.doc.getElementById('tfcc-hide-torn-box');
  assert.ok(style, 'the setting must actually do something');
  assert.match(style.textContent, /display: none !important/);
  assert.strictEqual(style.tagName, 'STYLE');

  handlers.onChange('hide-torn-box', { getAttribute: () => null, checked: false, value: '' });
  assert.strictEqual(env.doc.getElementById('tfcc-hide-torn-box'), null, 'turning it off must undo it');
});

test('the hide rule is applied at startup, not only when toggled', () => {
  const env = loadUserscript({
    location: forums(), now: NOW,
    gmStore: [['tfcc:settings', JSON.stringify({ v: 1, hideTornBox: true })]],
  });
  assert.ok(env.doc.getElementById('tfcc-hide-torn-box'), 'a saved setting must survive a reload');
});

test('deep search fetches the threads currently listed, not every thread held', () => {
  // The search view says "the threads currently listed". Fetching more would
  // spend the user's request budget on threads they had filtered out.
  const env = loadUserscript({ location: forums(), now: NOW, gmStore: [['tfcc:key', 'abcdefghij123456']] });
  const api = env.exports;
  api.state.feed.subscribed = [1, 2, 3].map((id) => api.normaliseSubscribedRow({
    id, forum_id: 61, title: id === 1 ? 'Bank interest' : ('Racing ' + id),
    author: { id: 1, username: 'a', karma: 0 }, posts: { new: 0, total: 3 },
  }));
  api.recompute(NOW);
  api.state.searchQuery = 'bank';

  const model = api.buildPanelModel(NOW);
  assert.deepStrictEqual(model.rows.map((r) => r.id), ['1'], 'the filter is what defines "listed"');
});

test('Mark all read writes no marker for a My posts-only thread', () => {
  const env = loadUserscript({ location: forums(), now: NOW });
  const api = env.exports;
  api.state.feed.subscribed = [api.normaliseSubscribedRow({ id: 1, forum_id: 61, title: 'A', author: { id: 3, username: 's' }, posts: { new: 2, total: 10 } })];
  const s = api.freshMine();
  s.threads = [Object.assign(api.freshMineThread(50, NOW), { posted: true, totalKnown: true, postsTotal: 12, baselineTotal: 10 })];
  api.state.mine = s;
  api.recompute(NOW);
  const handlers = api.makeHandlers(env.doc, env.win);
  handlers.onAction('markall', { getAttribute: () => null });
  assert.ok(api.state.organizer.threads['1'], 'the Threads row is marked');
  assert.strictEqual(api.state.organizer.threads['50'], undefined, 'the My posts row is untouched');
});
