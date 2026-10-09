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

  api.state.feed.subscribed = [1, 2, 3, 4].map((id) => api.normaliseSubscribedRow({
    id, forum_id: 61, title: 'Thread ' + id,
    author: { id: 3, username: 'someone', karma: 1 },
    posts: { new: id, total: 10 },
  }));
  api.state.feed.categories = [{ id: 61, title: 'Tutorials', acronym: 'TG' }];
  api.state.organizer = api.toggleTag(api.state.organizer, 1, 'atag');
  // #47: a claimed forum, so its chip's remove button renders.
  api.state.organizer = api.claimForum(api.state.organizer, 'guides', 61);
  api.state.drafts = api.saveDraft(api.freshDrafts(), 1, 'a draft', NOW, 'Thread 1');
  api.state.postCache = api.postCacheAdd(api.freshPostCache(), 1, [
    { id: 9, authorName: 'x', at: NOW, text: 'cached body' },
  ], { fetchedAt: NOW });
  api.state.searchQuery = 'thread';
  api.state.route = api.parseForumRoute(env.win.location);
  api.recompute(NOW);
  // Badge controls render only when their state is open; open all of them.
  api.state.badgeShelfOpen = true;
  api.state.badgeCatalogueOpen = true;
  api.state.badgeToast = { text: 'Badge earned: Reader (Bronze).', until: NOW + 6000, announced: false };

  // Four rows under a cap of 3, so the Show all control renders too.
  api.state.settings.rowsShown = 3;

  const actions = new Set();
  // #33: the narrow layout renders controls the wide one does not (filters,
  // row-more, the drawer), so every view is rendered both ways, with a drawer
  // and the filters open.
  for (const narrow of [false, true]) {
    api.state.narrow = narrow;
    for (const view of api.VIEWS) {
      for (const replyBox of [true, false]) {
        api.state.settings.view = view;
        api.state.replyBoxFound = replyBox;
        api.state.searchResults = { mode: 'deep', query: 'thread', posts: [{ threadId: '1', threadTitle: 'Thread 1', postId: 9, authorName: 'x', at: NOW, text: 'cached body' }] };
        let model = api.buildPanelModel(NOW);
        if (narrow && model.renderedIds.length) {
          api.state.openRowId = model.renderedIds[0];
          api.state.filtersOpen = true;
          // #43: the tag popup, so its field renders too.
          api.state.openEditor = { id: model.renderedIds[0], field: 'tag' };
          model = api.buildPanelModel(NOW);
        }
        const html = api.panelHtml(model);
        const re = /data-act="([a-z-]+)"/g;
        let m;
        while ((m = re.exec(html))) actions.add(m[1]);
      }
    }
  }
  api.state.narrow = false;

  // Collapsed only ever renders the header, but it renders it, so include it.
  api.state.settings.collapsed = true;
  const collapsed = api.panelHtml(api.buildPanelModel(NOW));
  const re2 = /data-act="([a-z-]+)"/g;
  let m2;
  while ((m2 = re2.exec(collapsed))) actions.add(m2[1]);
  api.state.narrow = true;
  const collapsedNarrow = api.panelHtml(api.buildPanelModel(NOW));
  const re3 = /data-act="([a-z-]+)"/g;
  let m3;
  while ((m3 = re3.exec(collapsedNarrow))) actions.add(m3[1]);
  api.state.narrow = false;

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

test('the rows shown select changes, persists and clears any Show all', () => {
  const env = loadUserscript({ location: forums(), now: NOW });
  const api = env.exports;
  const handlers = api.makeHandlers(env.doc, env.win);
  const el = (act, value) => ({ getAttribute: (k) => (k === 'data-act' ? act : null), value });

  handlers.onChange('rows-shown', el('rows-shown', '10'));
  assert.strictEqual(api.state.settings.rowsShown, 10);
  assert.strictEqual(JSON.parse(env.gmStore.get('tfcc:settings')).rowsShown, 10, 'survives a reload');

  api.state.showAll.threads = true;
  handlers.onChange('rows-shown', el('rows-shown', '5'));
  assert.strictEqual(api.state.settings.rowsShown, 5);
  assert.strictEqual(api.state.showAll.threads, undefined, 'a new cap takes effect at once');

  handlers.onChange('rows-shown', el('rows-shown', 'banana'));
  assert.strictEqual(api.state.settings.rowsShown, 0, 'off the menu is All');
});

test('Show all toggles one capped view and is never persisted', () => {
  const env = loadUserscript({ location: forums(), now: NOW });
  const api = env.exports;
  const handlers = api.makeHandlers(env.doc, env.win);
  const el = (attrs) => ({ getAttribute: (k) => (attrs[k] === undefined ? null : attrs[k]) });

  handlers.onAction('rows-toggle', el({ 'data-act': 'rows-toggle', 'data-view': 'threads' }));
  assert.strictEqual(api.state.showAll.threads, true);
  assert.strictEqual(api.state.showAll.catchup, undefined);

  handlers.onAction('rows-toggle', el({ 'data-act': 'rows-toggle', 'data-view': 'threads' }));
  assert.strictEqual(api.state.showAll.threads, false, 'Show N only puts the cap back');

  handlers.onAction('rows-toggle', el({ 'data-act': 'rows-toggle', 'data-view': 'mine' }));
  assert.strictEqual(api.state.showAll.mine, true, 'My posts is capped, so it expands');

  assert.doesNotThrow(() => {
    handlers.onAction('rows-toggle', el({ 'data-act': 'rows-toggle', 'data-view': 'search' }));
    handlers.onAction('rows-toggle', el({ 'data-act': 'rows-toggle' }));
  });
  assert.strictEqual(api.state.showAll.search, undefined, 'Search is never capped, so never expanded');

  handlers.onChange('rows-shown', { getAttribute: () => 'rows-shown', value: '3' });
  handlers.onAction('rows-toggle', el({ 'data-act': 'rows-toggle', 'data-view': 'catchup' }));
  const stored = env.gmStore.get('tfcc:settings') || '{}';
  assert.strictEqual(stored.indexOf('showAll'), -1, 'Show all lasts until the page reloads, no longer');
});

test('Reset everything also clears Show all', () => {
  const env = loadUserscript({ location: forums(), now: NOW });
  const api = env.exports;
  const handlers = api.makeHandlers(env.doc, env.win);
  api.state.showAll.threads = true;
  handlers.onAction('reset-all', { getAttribute: (k) => (k === 'data-act' ? 'reset-all' : null) });
  assert.deepStrictEqual(Object.keys(api.state.showAll), []);
});

test('Mark all read in author mode leaves unchecked threads unmarked', () => {
  const env = loadUserscript({ location: forums(), now: NOW });
  const api = env.exports;
  api.state.settings.authorOnly = true;
  api.state.organizer.threads['1'] = api.normaliseThreadEntry({ lastVisitedAt: NOW - 1000 });
  api.state.feed.subscribed = [1, 2].map((id) => api.normaliseSubscribedRow({
    id, forum_id: 61, title: 'T' + id, author: { id: 3, username: 'a', karma: 1 }, posts: { new: 2, total: 9 },
  }));
  api.state.organizer.threads['2'] = api.normaliseThreadEntry({
    lastVisitedAt: NOW - 1000, authorCheckedAt: 1, authorCheckTotal: 9, authorCheckSince: NOW - 1000,
    authorNewCount: 0, authorCheckComplete: true });
  api.recompute(NOW);
  api.makeHandlers(env.doc, env.win).onAction('markall', { getAttribute: () => null });
  assert.strictEqual(api.state.organizer.threads['1'].lastSeenTotal, 0, 'an unchecked thread must keep its unseen author posts');
  assert.strictEqual(api.state.organizer.threads['2'].lastSeenTotal, 9);
});

test('the author-only toggle saves, survives a reload, and turning it off restores the count', () => {
  const env = loadUserscript({ location: forums(), now: NOW });
  const api = env.exports;
  api.state.feed.subscribed = [api.normaliseSubscribedRow({
    id: 5, forum_id: 61, title: 'T', author: { id: 1, username: 'a', karma: 0 }, posts: { new: 2, total: 7 },
  })];
  api.recompute(NOW);
  const handlers = api.makeHandlers(env.doc, env.win);
  const box = (checked) => ({ getAttribute: () => null, checked, value: checked ? 'on' : '' });

  handlers.onChange('author-only', box(true));
  assert.strictEqual(JSON.parse(env.gmStore.get('tfcc:settings')).authorOnly, true);
  assert.strictEqual(api.state.rows[0].authorState, 'unchecked', 'the rows are recomputed, not only redrawn');
  assert.strictEqual(api.state.rows[0].unread, 0);

  const again = loadUserscript({ location: forums(), now: NOW,
    gmStore: [['tfcc:settings', env.gmStore.get('tfcc:settings')]] });
  assert.strictEqual(again.exports.state.settings.authorOnly, true);

  handlers.onChange('author-only', box(false));
  assert.strictEqual(api.state.rows[0].unread, 2, 'off means Torn\'s count again');
});
