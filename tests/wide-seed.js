'use strict';

// One fixed workspace for the desktop parity check (#33). The generator that
// captured the golden from main and the test that compares against it both
// use this file, so the two can never seed differently.

const NOW = Date.UTC(2026, 7, 8, 12, 0, 0);
const MIN = 60000;

function seedWide(api, clipLines) {
  api.state.feed.subscribed = [
    { id: 101, forum: 61, title: 'A practical education guide and script companion', unread: 3, total: 214, author: 'DaftVino' },
    { id: 102, forum: 63, title: 'Public API v2 project board', unread: 0, total: 88, author: 'Chedburn' },
    { id: 103, forum: 67, title: 'SideWinder - Advanced Sidebar for Torn City', unread: 12, total: 46, author: 'Sidewinder' },
    { id: 104, forum: 4, title: 'You can search forums by user AND text', unread: 1, total: 31, author: 'aplayer' },
  ].map((t) => api.normaliseSubscribedRow({
    id: t.id, forum_id: t.forum, title: t.title,
    author: { id: 1, username: t.author, karma: 10 },
    posts: { new: t.unread, total: t.total },
  }));
  api.state.feed.categories = [
    { id: 4, title: 'Suggestions', acronym: 'SU' },
    { id: 61, title: 'Tutorials and Guides', acronym: 'TG' },
    { id: 63, title: 'API Development', acronym: 'AD' },
    { id: 67, title: 'Tools and Userscripts', acronym: 'TU' },
  ];
  api.state.feed.fetchedAt = NOW - 4 * MIN;
  let org = api.state.organizer;
  org = api.togglePin(org, 101);
  org = api.setPriority(org, 103, 2);
  org = api.toggleTag(org, 101, 'reference');
  org = api.setFolder(org, 102, 'scripts');
  org.threads['101'].note = 'The one to link people to.';
  org.lastCatchUpAt = NOW - 24 * 60 * MIN;
  api.state.organizer = org;
  api.state.drafts = api.saveDraft(api.freshDrafts(), 101, 'A draft reply.', NOW - 30 * MIN,
    'A practical education guide and script companion');
  // My posts: one started thread with thumbs, so the reactions pill renders in
  // the wide nav (it needs a key, which captureWide provides).
  const mine = api.freshMine();
  mine.fetchedAt = NOW - 4 * MIN;
  mine.threads = [Object.assign(api.freshMineThread(16600002, NOW), {
    started: true, title: 'My crime 2.0 notes', forumId: 4, totalKnown: true,
    postsTotal: 5, baselineTotal: 5, lastPostAt: NOW - 300 * MIN, myLastPostAt: NOW - 300 * MIN,
    tornNew: 0, tornNewKnown: true,
  })];
  api.setReactionFields(mine.threads[0], { topicAt: NOW - 5 * MIN, up: 30, down: 4 });
  api.state.mine = api.setKarma(mine, 1208, NOW - 5 * MIN);
  api.state.settings.rowsShown = 0;
  api.state.settings.theme = 'dark';
  // #41: the golden predates the clip setting, so parity is checked with it
  // off, where the wide rows must be main's byte for byte. Main's code has no
  // such field and ignores this. What "on" adds is asserted separately in
  // tests/wide-parity.test.js, never by regenerating the golden.
  api.state.settings.clipLines = clipLines === true;
  // The bootstrap's own refresh has no transport and may have failed in the
  // meantime; none of that belongs in a layout golden.
  api.state.refreshing = false;
  api.state.lastError = null;
  api.state.notices = [];
  api.recompute(NOW);
}

// Every complete wide view, plus the loading and error states. Drafts is
// captured on a thread page with no reply box, so its reply-box line renders.
function captureWide(loadUserscript, FORUMS_LOCATION, clipLines) {
  const env = loadUserscript({
    location: FORUMS_LOCATION, now: NOW, gmStore: [['tfcc:key', 'abcdefghij123456']],
  });
  const api = env.exports;
  seedWide(api, clipLines);
  const html = () => api.panelHtml(api.buildPanelModel(NOW));
  const out = { css: api.panelStyleText().split('\n'), views: {}, nav: {}, rows: {} };
  api.state.route = api.parseForumRoute({
    origin: 'https://www.torn.com', hostname: 'www.torn.com', pathname: '/forums.php', search: '',
    hash: '#/p=threads&f=61&t=101', href: 'https://www.torn.com/forums.php#/p=threads&f=61&t=101',
  });
  api.state.replyBoxFound = false;
  for (const view of ['threads', 'catchup', 'mine', 'search', 'drafts', 'settings']) {
    api.state.settings.view = view;
    out.views[view] = html();
  }
  api.state.settings.view = 'threads';
  api.state.settings.rowsShown = 3;
  out.views.threadsCapped = html();
  api.state.settings.rowsShown = 0;
  api.state.settings.collapsed = true;
  out.views.collapsed = html();
  api.state.settings.collapsed = false;
  out.views.loading = api.panelHtml(api.loadingModel(NOW));
  out.views.error = api.panelHtml(api.errorModel('x', 'Torn is unreachable.', NOW));
  for (const view of api.VIEWS) {
    api.state.settings.view = view;
    const model = api.buildPanelModel(NOW);
    out.nav[view] = api.renderNav(model);
    const list = view === 'catchup' ? model.catchUp : (view === 'mine' ? model.capped.mine.rows : model.rows);
    out.rows[view] = list.map((r) => api.renderRow(r, model));
  }
  api.state.settings.view = 'threads';
  return out;
}

module.exports = { NOW, seedWide, captureWide };
