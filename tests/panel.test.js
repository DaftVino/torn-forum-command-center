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
