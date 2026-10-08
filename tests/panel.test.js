'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { loadUserscript, FORUMS_LOCATION } = require('./load-userscript');

const NOW = 1700000000000;

function forums(extra) {
  return Object.assign({}, FORUMS_LOCATION, extra || {});
}

function panelHtmlOf(env) {
  const panel = env.doc.getElementById('tfcc-panel');
  return panel ? panel.innerHTML : '';
}

function seed(env, rows) {
  const api = env.exports;
  api.state.feed.subscribed = rows.map((r) => api.normaliseSubscribedRow({
    id: r.id, forum_id: r.forumId || 61, title: r.title || ('Thread ' + r.id),
    author: { id: 3, username: r.author || 'someone', karma: 1 },
    posts: { new: r.unread || 0, total: r.total || 10 },
  }));
  api.state.feed.categories = [{ id: 61, title: 'Tutorials and Guides', acronym: 'TG' }];
  api.recompute(NOW);
}

test('the loading shell renders before anything is requested', () => {
  // A hung network must look like a slow panel, never like a script that did
  // not run. This is the single most important thing about Torn PDA startup.
  const env = loadUserscript({ location: forums() });
  const model = env.exports.loadingModel(NOW);
  const html = env.exports.panelHtml(model);
  assert.match(html, /Loading your subscribed threads/);
  assert.match(html, /Forum Command Center/);
});

test('a fatal error renders a named message and a way out', () => {
  const env = loadUserscript();
  const html = env.exports.panelHtml(env.exports.errorModel('torn', 'That API key is not valid.', NOW));
  assert.match(html, /That API key is not valid/);
  assert.match(html, /data-act="refresh"/, 'a dead end is not an error state');
  assert.doesNotMatch(html, /Loading/);
});

test('every view builds a complete model and renders without throwing', () => {
  const env = loadUserscript({ location: forums() });
  seed(env, [{ id: 1, unread: 3 }, { id: 2 }]);

  for (const view of env.exports.VIEWS) {
    env.exports.state.settings.view = view;
    const model = env.exports.buildPanelModel(NOW);
    assert.strictEqual(model.view, view);
    let html;
    assert.doesNotThrow(() => { html = env.exports.panelHtml(model); }, view);
    assert.ok(html.length > 100, view + ' rendered almost nothing');
    assert.match(html, /data-act="view" data-view="threads"/, view + ' lost its navigation');
  }
});

test('the header shows the unread total and the subscribed count', () => {
  const env = loadUserscript({ location: forums() });
  seed(env, [{ id: 1, unread: 3 }, { id: 2, unread: 4 }, { id: 3 }]);
  const html = env.exports.panelHtml(env.exports.buildPanelModel(NOW));
  assert.match(html, /7 new/);
  assert.match(html, /3 subscribed/);
});

test('collapsing hides the body but keeps the header reachable', () => {
  const env = loadUserscript({ location: forums() });
  seed(env, [{ id: 1, unread: 3 }]);
  env.exports.state.settings.collapsed = true;
  const html = env.exports.panelHtml(env.exports.buildPanelModel(NOW));
  assert.match(html, /data-act="collapse"/);
  assert.doesNotMatch(html, /data-act="view"/, 'a collapsed panel should not render its views');
});

test('with no key the panel says so instead of looking broken', () => {
  const env = loadUserscript({ location: forums() });
  const html = env.exports.panelHtml(env.exports.buildPanelModel(NOW));
  assert.match(html, /No API key yet/);
});

test('filters narrow the list and an empty result explains itself', () => {
  const env = loadUserscript({ location: forums() });
  seed(env, [
    { id: 1, title: 'Bank interest guide', unread: 2 },
    { id: 2, title: 'Racing tips', unread: 0 },
  ]);

  env.exports.state.settings.unreadOnly = true;
  let model = env.exports.buildPanelModel(NOW);
  assert.deepStrictEqual(model.rows.map((r) => r.id), ['1']);

  env.exports.state.settings.unreadOnly = false;
  env.exports.state.searchQuery = 'racing';
  model = env.exports.buildPanelModel(NOW);
  assert.deepStrictEqual(model.rows.map((r) => r.id), ['2']);

  env.exports.state.searchQuery = 'nothing matches this';
  model = env.exports.buildPanelModel(NOW);
  assert.strictEqual(model.rows.length, 0);
  assert.match(env.exports.panelHtml(model), /Nothing matches/);
});

test('an archived thread is hidden until it has something new to say', () => {
  const env = loadUserscript({ location: forums() });
  seed(env, [{ id: 1, unread: 0 }]);
  env.exports.state.organizer.threads['1'] = env.exports.normaliseThreadEntry({ archived: true });
  env.exports.recompute(NOW);
  assert.strictEqual(env.exports.buildPanelModel(NOW).rows.length, 0);

  seed(env, [{ id: 1, unread: 5 }]);
  env.exports.state.organizer.threads['1'] = env.exports.normaliseThreadEntry({ archived: true });
  env.exports.recompute(NOW);
  assert.strictEqual(env.exports.buildPanelModel(NOW).rows.length, 1, 'new posts bring it back');
});

test('catch up says plainly what marking read can and cannot do', () => {
  // The panel must not imply a sync with Torn that does not exist.
  const env = loadUserscript({ location: forums() });
  seed(env, [{ id: 1, unread: 2 }]);
  env.exports.state.settings.view = 'catchup';
  const html = env.exports.panelHtml(env.exports.buildPanelModel(NOW));
  assert.match(html, /cannot clear Torn/i);
});

test('catch up groups by folder and reports an empty state', () => {
  const env = loadUserscript({ location: forums() });
  seed(env, [{ id: 1, unread: 2 }]);
  env.exports.state.organizer = env.exports.setFolder(env.exports.state.organizer, 1, 'guides');
  env.exports.recompute(NOW);
  env.exports.state.settings.view = 'catchup';
  assert.match(env.exports.panelHtml(env.exports.buildPanelModel(NOW)), /Guides \(1\)/);

  seed(env, [{ id: 1, unread: 0 }]);
  env.exports.state.organizer.lastCatchUpAt = NOW;
  env.exports.recompute(NOW);
  assert.match(env.exports.panelHtml(env.exports.buildPanelModel(NOW)), /You are caught up/);
});

test('the drafts view offers Insert with a reply box and Copy without one', () => {
  const env = loadUserscript({ location: forums({ hash: '#/p=threads&f=61&t=99' }) });
  env.exports.state.settings.view = 'drafts';
  env.exports.state.route = env.exports.parseForumRoute(env.win.location);

  env.exports.state.replyBoxFound = true;
  assert.match(env.exports.panelHtml(env.exports.buildPanelModel(NOW)), /data-act="draft-insert"/);

  env.exports.state.replyBoxFound = false;
  const html = env.exports.panelHtml(env.exports.buildPanelModel(NOW));
  assert.doesNotMatch(html, /data-act="draft-insert"/);
  assert.match(html, /data-act="draft-copy"/);
  assert.match(html, /No reply box was found/, 'the user is told why, not left guessing');
});

test('a thread title from Torn is escaped, never rendered as markup', () => {
  const env = loadUserscript({ location: forums() });
  seed(env, [{ id: 1, title: '<img src=x onerror="alert(1)">', author: '<script>x</script>' }]);
  const html = env.exports.panelHtml(env.exports.buildPanelModel(NOW));

  assert.strictEqual(html.indexOf('<img src=x'), -1, 'a forum title reached the DOM as markup');
  assert.strictEqual(html.indexOf('<script>x'), -1);
  assert.match(html, /&lt;img src=x/);
});

test('a note and a tag the user typed are escaped too', () => {
  const env = loadUserscript({ location: forums() });
  seed(env, [{ id: 1 }]);
  env.exports.state.organizer.threads['1'] = env.exports.normaliseThreadEntry({
    note: '</div><script>bad()</script>', tags: ['<b>x</b>'],
  });
  env.exports.recompute(NOW);
  const html = env.exports.panelHtml(env.exports.buildPanelModel(NOW));
  assert.strictEqual(html.indexOf('<script>bad'), -1);
  assert.strictEqual(html.indexOf('<b>x</b>'), -1);
});

test('a row links to the thread on Torn with its forum and thread id', () => {
  const env = loadUserscript({ location: forums() });
  seed(env, [{ id: 16589908, forumId: 61 }]);
  const html = env.exports.panelHtml(env.exports.buildPanelModel(NOW));
  assert.match(html, /https:\/\/www\.torn\.com\/forums\.php#\/p=threads&amp;f=61&amp;t=16589908/);
});

test('a row reports where its activity time came from', () => {
  // A surprising sort order has to be diagnosable from the row itself.
  const env = loadUserscript({ location: forums() });
  seed(env, [{ id: 1 }]);
  env.exports.state.feed.activity = [env.exports.normaliseActivityRow({ thread_id: 1, timestamp: NOW / 1000 })];
  env.exports.recompute(NOW);
  assert.match(env.exports.panelHtml(env.exports.buildPanelModel(NOW)), /Where the time came from: feed/);
});

test('rendering twice does not stack panels or duplicate listeners', () => {
  const env = loadUserscript({ location: forums() });
  const before = env.createdElements.filter((el) => el.id === 'tfcc-panel').length;
  const handlers = env.exports.makeHandlers(env.doc, env.win);

  env.exports.renderPanel(env.doc, env.win, env.exports.buildPanelModel(NOW), handlers);
  env.exports.renderPanel(env.doc, env.win, env.exports.buildPanelModel(NOW), handlers);

  const panels = env.createdElements.filter((el) => el.id === 'tfcc-panel' && el.isConnected !== false);
  assert.strictEqual(panels.length, 1);
  assert.strictEqual(before, 1);

  const panel = env.doc.getElementById('tfcc-panel');
  assert.strictEqual((panel._listeners.click || []).length, 1, 'innerHTML redraws would leak per-render listeners');
});

test('the stylesheet is injected exactly once', () => {
  const env = loadUserscript({ location: forums() });
  for (let i = 0; i < 5; i += 1) env.exports.injectStyleOnce(env.doc);
  const styles = env.createdElements.filter((el) => el.id === 'tfcc-style');
  assert.strictEqual(styles.length, 1);
});

test('takeover is a class on our own panel, never a change to Torn', () => {
  const env = loadUserscript({ location: forums() });
  env.exports.state.settings.takeover = true;
  env.exports.renderPanel(env.doc, env.win, env.exports.buildPanelModel(NOW), env.exports.noopHandlers);
  assert.strictEqual(env.doc.getElementById('tfcc-panel').classList.contains('tfcc-takeover'), true);

  env.exports.state.settings.takeover = false;
  env.exports.renderPanel(env.doc, env.win, env.exports.buildPanelModel(NOW), env.exports.noopHandlers);
  assert.strictEqual(env.doc.getElementById('tfcc-panel').classList.contains('tfcc-takeover'), false);
});

test('a damaged storage key is reported in the panel rather than silently reset', () => {
  const env = loadUserscript({
    location: forums(),
    gmStore: [['tfcc:organizer', '{ not json']],
  });
  const notices = env.exports.state.notices.map((n) => n.text).join(' ');
  assert.match(notices, /Folders and tags were damaged/);
  assert.match(panelHtmlOf(env), /damaged/);
});

test('a cache that holds something never reports zero', () => {
  // Rounding to whole kilobytes reported a real cache as "0 KB", which reads as
  // broken rather than small.
  const { exports: api } = loadUserscript();
  assert.strictEqual(api.formatBytes(0), '0 B');
  assert.strictEqual(api.formatBytes(512), '512 B');
  assert.strictEqual(api.formatBytes(1024), '1.0 KB');
  assert.strictEqual(api.formatBytes(20480), '20 KB');
  assert.strictEqual(api.formatBytes(1024 * 1024 * 3), '3.0 MB');
  assert.strictEqual(api.formatBytes(-5), '0 B');
  assert.strictEqual(api.formatBytes('nonsense'), '0 B');
});

test('counts read as English, not as a template', () => {
  const { exports: api } = loadUserscript();
  assert.strictEqual(api.plural(1, 'thread'), 'thread');
  assert.strictEqual(api.plural(0, 'thread'), 'threads');
  assert.strictEqual(api.plural(2, 'thread'), 'threads');
  assert.strictEqual(api.plural(1, 'entry', 'entries'), 'entry');
  assert.strictEqual(api.plural(3, 'entry', 'entries'), 'entries');
});

function seedMine(env) {
  const api = env.exports;
  const s = api.freshMine();
  s.selfId = 7;
  s.fetchedAt = NOW;
  s.threads = [
    Object.assign(api.freshMineThread(50, NOW), { posted: true, title: 'Reply thread', totalKnown: true, postsTotal: 12, baselineTotal: 10 }),
    Object.assign(api.freshMineThread(51, NOW), { started: true, title: 'My guide', totalKnown: true, postsTotal: 5, baselineTotal: 5 }),
    Object.assign(api.freshMineThread(52, NOW), { posted: true, title: 'Unchecked thread' }),
  ];
  api.state.mine = s;
  api.recompute(NOW);
}

test('My posts-only threads stay out of Threads, Catch up and the header count', () => {
  const env = loadUserscript({ location: forums() });
  seed(env, [{ id: 1, unread: 3 }]);
  seedMine(env);
  env.exports.state.settings.view = 'threads';
  const model = env.exports.buildPanelModel(NOW);
  assert.deepStrictEqual(model.rows.map((r) => r.id), ['1']);
  assert.strictEqual(model.totals.unread, 3, 'the header badge counts Threads only');
  assert.ok(model.catchUp.every((r) => r.id !== '50'));
  assert.strictEqual(model.mine.unread, 1);
  assert.strictEqual(model.mine.unchecked, 1);
  assert.strictEqual(model.mine.total, 3);
});

test('the My posts model lists its own population, and Unread only narrows it', () => {
  const env = loadUserscript({ location: forums() });
  seed(env, [{ id: 1, unread: 3 }]);
  seedMine(env);
  env.exports.state.settings.view = 'mine';
  assert.deepStrictEqual(env.exports.buildPanelModel(NOW).rows.map((r) => r.id).sort(), ['50', '51', '52']);
  env.exports.state.settings.unreadOnly = true;
  assert.deepStrictEqual(env.exports.buildPanelModel(NOW).rows.map((r) => r.id), ['50']);
});

test('My posts is the last nav button, classed, labelled and pressed like the rest', () => {
  const env = loadUserscript({ location: forums() });
  seed(env, [{ id: 1 }]);
  seedMine(env);
  assert.strictEqual(env.exports.VIEWS[env.exports.VIEWS.length - 1], 'mine');
  for (const view of ['threads', 'mine']) {
    env.exports.state.settings.view = view;
    const html = env.exports.panelHtml(env.exports.buildPanelModel(NOW));
    const nav = /<div class="tfcc-nav">([\s\S]*?)<\/div>/.exec(html)[1];
    const buttons = nav.match(/<button[^>]*>[^<]*<\/button>/g);
    const last = buttons[buttons.length - 1];
    assert.match(last, /data-view="mine"/);
    assert.match(last, /class="tfcc-nav-mine"/);
    assert.match(last, />My posts \(1\)</, 'the count is My posts rows with new replies');
    assert.match(last, new RegExp('aria-pressed="' + (view === 'mine') + '"'));
  }
});

test('the My posts view marks roles, local counts and unchecked rows honestly', () => {
  const env = loadUserscript({ location: forums() });
  seed(env, [{ id: 1 }]);
  seedMine(env);
  env.exports.state.settings.view = 'mine';
  const html = env.exports.panelHtml(env.exports.buildPanelModel(NOW));
  assert.match(html, /Threads you started or posted in/);
  assert.match(html, /1 not checked yet/);
  assert.match(html, /started/);
  assert.match(html, /posted in/);
  assert.match(html, /2 new<\/span>[\s\S]*?local count/);
  assert.match(html, /title="Counted on this device/);
  assert.match(html, /data-act="unread-only"/);
  assert.match(html, /data-act="sort"/);
  for (const act of ['pin', 'read', 'prio-up', 'prio-down', 'folder', 'tag-input', 'note-input', 'draft', 'archive']) {
    assert.match(html, new RegExp('data-act="' + act + '" data-id="50"'), act + ' missing on a My posts row');
  }
});

test('My posts empty, loading, error and filtered states each say what happened', () => {
  const env = loadUserscript({ location: forums() });
  const api = env.exports;
  seed(env, [{ id: 1 }]);
  api.state.settings.view = 'mine';
  api.state.mine = api.freshMine();
  api.recompute(NOW);
  api.state.refreshingMine = true;
  assert.match(api.panelHtml(api.buildPanelModel(NOW)), /Loading the threads you started and posted in/);
  api.state.refreshingMine = false;
  api.state.mine.fetchedAt = NOW;
  assert.match(api.panelHtml(api.buildPanelModel(NOW)), /Torn reports no threads you started or posted in/);
  api.state.mineError = { reason: 'torn', detail: 'Torn had a backend error.' };
  const err = api.panelHtml(api.buildPanelModel(NOW));
  assert.match(err, /Torn had a backend error/);
  assert.match(err, /data-act="refresh"/);
  assert.doesNotMatch(err, /Torn reports no threads/, 'a failed fetch is not an empty answer');
  api.state.mineError = null;
  seedMine(env);
  api.state.settings.unreadOnly = true;
  api.state.searchQuery = 'zzz-no-match';
  assert.match(api.panelHtml(api.buildPanelModel(NOW)), /Nothing matches/);
  api.state.searchQuery = '';
  api.state.mine.threads.forEach((t) => { t.baselineTotal = t.postsTotal; });
  api.recompute(NOW);
  assert.match(api.panelHtml(api.buildPanelModel(NOW)), /No new replies in your threads/);
});

test('Threads rows never carry My posts marks', () => {
  const env = loadUserscript({ location: forums() });
  seed(env, [{ id: 1, unread: 2 }]);
  env.exports.state.settings.view = 'threads';
  const html = env.exports.panelHtml(env.exports.buildPanelModel(NOW));
  assert.doesNotMatch(html, /local count|not checked yet|posted in/);
});

test('Settings states both request budgets, from the constants', () => {
  const env = loadUserscript({ location: forums() });
  seed(env, [{ id: 1 }]);
  env.exports.state.settings.view = 'settings';
  const html = env.exports.panelHtml(env.exports.buildPanelModel(NOW));
  const api = env.exports;
  const thumbs = (b) => Math.min(api.REACTION_LOOKUPS_PER_RUN, b);
  assert.strictEqual(3 + api.DEFAULT_ENRICH_BUDGET, 13);
  assert.match(html, /Opening My posts, or refreshing while it is open, makes two requests of its own/);
  assert.match(html, new RegExp('at most once every ' + (api.MINE_TTL_MS / 60000) + ' minutes'));
  assert.match(html, new RegExp('My posts also reads the opening post of up to ' + api.REACTION_LOOKUPS_PER_RUN
    + ' threads you started, for their thumbs up and down, each at most once every '
    + (api.TOPIC_TTL_MS / 3600000) + ' hours; with lookups set to 0 it reads none\\.'));
  assert.match(html, new RegExp('a Threads refresh is at most ' + (3 + api.DEFAULT_ENRICH_BUDGET)
    + '\\s+requests and My posts at most ' + (2 + api.DEFAULT_ENRICH_BUDGET + thumbs(api.DEFAULT_ENRICH_BUDGET))
    + '; at the largest setting of ' + api.MAX_ENRICH_BUDGET + ', ' + (3 + api.MAX_ENRICH_BUDGET) + ' and '
    + (2 + api.MAX_ENRICH_BUDGET + thumbs(api.MAX_ENRICH_BUDGET)) + '\\.'));
  assert.match(html, new RegExp('If you have started no threads and written no posts, My posts instead reads your profile once for your forum karma, at most once every '
    + (api.KARMA_TTL_MS / 3600000) + ' hours, which is 3 requests in all\\.'));
  assert.match(html, /a Threads refresh is at most 13\s+requests and My posts at most 17; at the largest setting of 25, 28 and 32\./);
  assert.match(html, /under 40 requests a minute/);
});

// -- author-only mode (issue #4) -------------------------------------------

test('author mode: Unread only keeps unchecked rows visible', () => {
  const env = loadUserscript({ location: forums() });
  env.exports.state.settings.authorOnly = true;
  env.exports.state.settings.unreadOnly = true;
  env.exports.state.organizer.threads['1'] = env.exports.normaliseThreadEntry({ lastVisitedAt: NOW - 1000 });
  seed(env, [{ id: 1, unread: 4 }]);
  const model = env.exports.buildPanelModel(NOW);
  assert.strictEqual(model.rows.length, 1, 'an unknown must not be hidden as if it were known-empty');
  assert.strictEqual(model.totals.unchecked, 1);
  assert.strictEqual(model.catchUp.length, 0);
  assert.strictEqual(model.catchUpUnchecked.length, 1);
});

test('author mode: My posts ignores the setting and keeps the any-poster count', () => {
  const env = loadUserscript({ location: forums() });
  seed(env, [{ id: 1, unread: 3 }]);
  seedMine(env);
  const api = env.exports;
  // Thread 1 is subscribed and also one the user posted in.
  api.state.mine.threads.push(Object.assign(api.freshMineThread(1, NOW), { posted: true, title: 'Thread 1' }));
  api.state.settings.view = 'mine';
  api.recompute(NOW);
  const off = api.buildPanelModel(NOW);
  const offHtml = api.panelHtml(off);

  api.state.settings.authorOnly = true;
  api.recompute(NOW);
  const on = api.buildPanelModel(NOW);
  assert.deepStrictEqual(on.mine, off.mine, 'the My posts counts do not move');
  assert.deepStrictEqual(on.rows.map((r) => [r.id, r.unread]), off.rows.map((r) => [r.id, r.unread]));
  const onHtml = api.panelHtml(on);
  assert.doesNotMatch(onHtml, /by author|author: not checked/, 'no author-only wording in My posts');
  assert.match(offHtml, /3 new/);
  assert.match(onHtml, /3 new/);
  api.state.settings.unreadOnly = true;
  assert.deepStrictEqual(api.buildPanelModel(NOW).rows.map((r) => r.id).sort(), ['1', '50']);
});

function authorEnv(entry, unread) {
  const env = loadUserscript({ location: forums() });
  env.exports.state.settings.authorOnly = true;
  env.exports.state.organizer.threads['1'] = env.exports.normaliseThreadEntry(Object.assign({ lastVisitedAt: NOW - 1000 }, entry));
  seed(env, [{ id: 1, unread: unread === undefined ? 37 : unread, total: 50 }]);
  return env;
}

test('author mode never prints Torn\'s any-poster count', () => {
  const env = authorEnv({});
  const html = env.exports.panelHtml(env.exports.buildPanelModel(NOW));
  assert.doesNotMatch(html, /37 new|>37</, 'the any-poster count must not appear as a badge');
  assert.match(html, /author: not checked/);
  assert.match(html, /1 not checked/);
});

test('author mode shows N new by author, and N+ for a lower bound', () => {
  const base = { authorCheckedAt: 1, authorCheckTotal: 50, authorCheckSince: NOW - 1000, authorNewCount: 2, authorLatestAt: NOW - 500 };
  let html = env2html(authorEnv(Object.assign({ authorCheckComplete: true }, base)));
  assert.match(html, /2 new by author/);
  assert.doesNotMatch(html, /2\+ new by author/);
  html = env2html(authorEnv(Object.assign({ authorCheckComplete: false }, base)));
  assert.match(html, /2\+ new by author/);
  function env2html(env) { return env.exports.panelHtml(env.exports.buildPanelModel(NOW)); }
});

test('author mode says too many new when no post read is by the author', () => {
  const env = authorEnv({ authorCheckedAt: 1, authorCheckTotal: 50, authorCheckSince: NOW - 1000,
    authorNewCount: 0, authorCheckComplete: false, authorCheckReason: 'too-many' });
  const html = env.exports.panelHtml(env.exports.buildPanelModel(NOW));
  assert.match(html, /author: not checked \(too many new\)/);
  assert.match(html, /could not all be read/, 'the tooltip says why');
  assert.doesNotMatch(html, /37 new/);
});

test('catch up lists unchecked threads under their own heading', () => {
  const env = authorEnv({});
  env.exports.state.settings.view = 'catchup';
  const html = env.exports.renderCatchUpView(env.exports.buildPanelModel(NOW));
  assert.match(html, /Not yet checked for author posts \(1\)/);
  assert.doesNotMatch(html, /You are caught up/, 'an unchecked thread means we cannot claim that');
  assert.match(html, /No author updates in the threads checked/);
});

test('settings states the author-only option and the real request cost', () => {
  const env = loadUserscript({ location: forums() });
  const html = env.exports.renderSettingsView(env.exports.buildPanelModel(NOW));
  assert.match(html, /Only flag new posts by the thread author/);
  assert.match(html, /data-act="author-only"/);
  assert.match(html, /at most 13 requests/);
  assert.match(html, /edits are not detected/i, 'the limit is shown before the setting is turned on');
  assert.match(html, /My posts ignores this setting/);
  // The figure must be computed from the user's budget, not hard-coded. 13
  // alone would also pass with a constant string, so use a different budget.
  env.exports.state.settings.enrichBudget = 4;
  assert.match(env.exports.renderSettingsView(env.exports.buildPanelModel(NOW)), /at most 7 requests a refresh/);
});

// -- thread reactions (#10) --------------------------------------------------

const KEY_STORE = [['tfcc:key', 'abcdefghij123456']];

function withMine(env, threads, fetchedAt) {
  const api = env.exports;
  api.state.mine = Object.assign(api.freshMine(), { fetchedAt: fetchedAt === undefined ? NOW : fetchedAt, threads });
  api.recompute(NOW);
}

function startedRec(api, id, fields, title) {
  const rec = api.freshMineThread(id, NOW);
  rec.started = true;
  if (title) rec.title = title;
  if (fields) api.setReactionFields(rec, fields);
  return rec;
}

const TH = (up, down, at) => ({ topicAt: at === undefined ? NOW : at, up, down });
const NET = (rating) => ({ reactAt: NOW, rating });

function htmlOf(env) {
  return env.exports.panelHtml(env.exports.buildPanelModel(NOW));
}

function bootPanel() {
  const env = loadUserscript({ location: forums(), gmStore: KEY_STORE });
  seed(env, [{ id: 1 }]);
  return env;
}

test('the reactions line sits under the header row, never inside it', () => {
  const env = bootPanel();
  withMine(env, [startedRec(env.exports, 1, TH(34, 5))]);
  const html = htmlOf(env);
  const sub = html.indexOf('<div class="tfcc-subhead">');
  assert.ok(sub > html.indexOf('<div class="tfcc-head">'));
  const head = html.slice(html.indexOf('<div class="tfcc-head">'), sub);
  assert.doesNotMatch(head, /tfcc-reactions/);
  assert.match(head, /data-act="collapse"/, 'the subhead starts after the whole header row');
  assert.match(html, /Your threads: <span class="tfcc-rx">34<\/span> up, <span class="tfcc-rx">5<\/span> down /);
});

test('unknown renders "-", never 0', () => {
  const env = bootPanel();
  withMine(env, [], 0);
  let html = htmlOf(env);
  assert.match(html, /Your threads: <span class="tfcc-rx">-<\/span> up, <span class="tfcc-rx">-<\/span> down/);
  assert.doesNotMatch(html, /<span class="tfcc-rx">0<\/span>/);
  withMine(env, [startedRec(env.exports, 1)]);
  html = htmlOf(env);
  assert.match(html, /<span class="tfcc-rx">-<\/span> up/);
  assert.match(html, /has not reported thumbs or a rating/);
});

test('net is labelled, never split, and named as Torn\'s', () => {
  const env = bootPanel();
  withMine(env, [startedRec(env.exports, 1, NET(12))]);
  let html = htmlOf(env);
  assert.match(html, /Your threads: net <span class="tfcc-rx">\+12<\/span> /);
  assert.doesNotMatch(html, / up, /);
  withMine(env, [startedRec(env.exports, 1, TH(4, 1)), startedRec(env.exports, 2, NET(-3))]);
  html = htmlOf(env);
  assert.match(html, /<span class="tfcc-rx">4<\/span> up, <span class="tfcc-rx">1<\/span> down, net <span class="tfcc-rx">-3<\/span> on 1 more/);
});

test('known zeros render 0', () => {
  const env = bootPanel();
  withMine(env, [startedRec(env.exports, 1, TH(0, 0))]);
  assert.match(htmlOf(env), /<span class="tfcc-rx">0<\/span> up, <span class="tfcc-rx">0<\/span> down/);
});

test('every tooltip says subscribers cannot be shown', () => {
  const env = bootPanel();
  for (const threads of [[], [startedRec(env.exports, 1)], [startedRec(env.exports, 1, TH(1, 1))]]) {
    withMine(env, threads, threads.length ? NOW : 0);
    assert.match(htmlOf(env), /class="tfcc-reactions[^"]*"[^>]* title="[^"]*API has no subscriber count, so none is shown\."/);
  }
});

test('stale figures carry a visible age, not just a colour', () => {
  const env = bootPanel();
  withMine(env, [startedRec(env.exports, 1, TH(1, 1, NOW - 3 * 24 * 3600000))]);
  const html = htmlOf(env);
  assert.match(html, /class="tfcc-reactions tfcc-stale"/);
  assert.match(html, /down \(3d ago\) /);
});

test('hidden when collapsed, without a key, and when you started nothing', () => {
  const env = bootPanel();
  withMine(env, [startedRec(env.exports, 1, TH(1, 1))]);
  env.exports.state.settings.collapsed = true;
  assert.doesNotMatch(htmlOf(env), /tfcc-subhead/);
  env.exports.state.settings.collapsed = false;
  withMine(env, [], NOW);
  assert.doesNotMatch(htmlOf(env), /tfcc-subhead/, 'empty is not unknown');
  const nokey = loadUserscript({ location: forums() });
  seed(nokey, [{ id: 1 }]);
  withMine(nokey, [startedRec(nokey.exports, 1, TH(1, 1))]);
  assert.doesNotMatch(htmlOf(nokey), /tfcc-subhead/);
});

test('tapping the line opens My posts through the existing view action', () => {
  const env = bootPanel();
  withMine(env, [startedRec(env.exports, 1, TH(1, 1))]);
  assert.match(htmlOf(env), /<button type="button" class="tfcc-reactions" data-act="view" data-view="mine"/);
});

const visibleText = (html) => html.replace(/<[^>]*>/g, '');

function withKarma(env, karma) {
  const api = env.exports;
  api.state.mine = api.setKarma(api.state.mine, karma, NOW);
  api.recompute(NOW);
}

test('karma follows the thumbs as the icon and a number, with an aria-label and no visible word', () => {
  const env = bootPanel();
  withMine(env, [startedRec(env.exports, 1, TH(34, 5))]);
  withKarma(env, 1208);
  const html = htmlOf(env);
  assert.match(html, /<span class="tfcc-rx">5<\/span> down <span class="tfcc-karma" role="group" aria-label="Karma" title="Karma: 1,208\. Likes and dislikes on your forum posts, never below 0; some posts do not count\.">/);
  assert.ok(html.includes(env.exports.KARMA_ICON_SVG), 'the icon constant is what is injected');
  assert.match(html, /<span class="tfcc-rx">1,208<\/span><\/span><\/button>/);
  assert.ok(html.indexOf('tfcc-karma') > html.indexOf('down'), 'karma follows thumbs up and down');
  assert.doesNotMatch(visibleText(html), /karma/i, 'the word is never visible text');
  assert.match(html, /class="tfcc-reactions"[^>]*aria-label="[^"]*Karma: 1,208\./, 'the button speaks it too');
});

test('unknown karma shows "-", never 0, and a real 0 shows 0', () => {
  const env = bootPanel();
  withMine(env, [startedRec(env.exports, 1, TH(34, 5))]);
  let html = htmlOf(env);
  assert.match(html, /title="Karma: unknown\. Likes and dislikes on your forum posts, never below 0; some posts do not count\."/);
  assert.match(html, /<span class="tfcc-rx">-<\/span><\/span>/);
  assert.doesNotMatch(visibleText(html), /karma/i);
  withKarma(env, 0);
  html = htmlOf(env);
  assert.match(html, /<span class="tfcc-rx">0<\/span><\/span>/);
  assert.match(html, /title="Karma: 0\./);
  withKarma(env, -12);
  assert.match(htmlOf(env), /<span class="tfcc-rx">-12<\/span><\/span>/);
});

test('with no threads started, known karma is shown alone; unknown stays hidden', () => {
  const env = bootPanel();
  withMine(env, [], NOW);
  assert.doesNotMatch(htmlOf(env), /tfcc-subhead/, 'nothing to say yet');
  withKarma(env, 1208);
  const html = htmlOf(env);
  assert.match(html, /<div class="tfcc-subhead"><button type="button" class="tfcc-reactions" data-act="view" data-view="mine"/);
  assert.doesNotMatch(visibleText(html), /Your threads/);
  assert.match(html, /<span class="tfcc-rx">1,208<\/span>/);
  assert.doesNotMatch(visibleText(html), /karma/i);
});

test('My posts shows each started thread its thumbs, or a labelled net', () => {
  const env = loadUserscript({ location: forums(), gmStore: KEY_STORE });
  seed(env, []);
  const api = env.exports;
  withMine(env, [
    startedRec(api, 41, TH(12, 3), 'Alpha'),
    startedRec(api, 42, NET(9), 'Beta'),
    startedRec(api, 43, null, 'Gamma'),
  ]);
  api.state.settings.view = 'mine';
  const html = htmlOf(env);
  assert.match(html, /<span class="tfcc-note">12 up, 3 down<\/span>/);
  assert.match(html, /<span class="tfcc-note" title="[^"]*">net \+9<\/span>/);
  assert.strictEqual((html.match(/class="tfcc-note"[^>]*>(\d+ up|net )/g) || []).length, 2, 'Gamma gets no meta');
});

test('the karma line is also present before My posts has loaded, as "-"', () => {
  const env = bootPanel();
  withMine(env, [], 0);
  const html = htmlOf(env);
  assert.match(html, /Your threads: <span class="tfcc-rx">-<\/span> up, <span class="tfcc-rx">-<\/span> down <span class="tfcc-karma"/);
  assert.match(html, /<span class="tfcc-rx">-<\/span><\/span>/);
});
