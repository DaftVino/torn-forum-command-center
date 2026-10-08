/*
 * Render preview - run manually, never part of `npm test`.
 *
 *   node tests/render-preview.mjs [outDir]
 *
 * Writes one standalone HTML file per view, using the real panelStyleText()
 * and the real panelHtml(), so the markup can be opened in a browser or
 * screenshotted. The unit tests assert on strings; this is for looking at it.
 *
 * It proves nothing about Torn's page. It catches the things a string
 * assertion cannot: an unclosed tag, a control with no contrast, a layout that
 * collapses at 375px.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { loadUserscript, FORUMS_LOCATION } = require('./load-userscript.js');

const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = process.argv[2] || path.join(here, '..', 'preview');
fs.mkdirSync(outDir, { recursive: true });

const NOW = Date.UTC(2026, 7, 8, 12, 0, 0);
const MIN = 60000;

const env = loadUserscript({
  location: Object.assign({}, FORUMS_LOCATION, { hash: '#/p=threads&f=61&t=16589908' }),
  now: NOW,
  gmStore: [['tfcc:key', 'abcdefghij123456']],
});
const api = env.exports;

const THREADS = [
  { id: 16589908, forumId: 61, title: 'A practical education guide and script companion', unread: 3, total: 214, author: 'DaftVino' },
  { id: 16407150, forumId: 63, title: 'Public API v2 project board', unread: 0, total: 88, author: 'Chedburn' },
  { id: 16474152, forumId: 67, title: 'SideWinder - Advanced Sidebar for Torn City', unread: 12, total: 46, author: 'Sidewinder' },
  { id: 16208166, forumId: 63, title: 'Actual RSS feed for forum threads', unread: 0, total: 9, author: 'someone' },
  { id: 16354991, forumId: 4, title: 'You can search forums by user AND text - show it', unread: 1, total: 31, author: 'aplayer' },
  { id: 15978774, forumId: 4, title: 'A thread with a deliberately very long title that has to wrap on a narrow phone screen without pushing the page sideways', unread: 0, total: 400, author: 'verbose' },
];

api.state.feed.subscribed = THREADS.map((t) => api.normaliseSubscribedRow({
  id: t.id, forum_id: t.forumId, title: t.title,
  author: { id: 1, username: t.author, karma: 10 },
  posts: { new: t.unread, total: t.total },
}));
api.state.feed.categories = [
  { id: 2, title: 'General Discussion', acronym: 'GD' },
  { id: 4, title: 'Suggestions', acronym: 'SU' },
  { id: 61, title: 'Tutorials and Guides', acronym: 'TG' },
  { id: 63, title: 'API Development', acronym: 'AD' },
  { id: 67, title: 'Tools and Userscripts', acronym: 'TU' },
];
api.state.feed.fetchedAt = NOW - 4 * MIN;
api.state.feed.activity = [
  { thread_id: 16589908, timestamp: (NOW - 12 * MIN) / 1000 },
  { thread_id: 16474152, timestamp: (NOW - 90 * MIN) / 1000 },
  { thread_id: 16354991, timestamp: (NOW - 3000 * MIN) / 1000 },
].map((r) => api.normaliseActivityRow(r));

let org = api.state.organizer;
org = api.upsertFolder(org, { id: 'guides', name: 'Guides', order: 0, forumIds: [61] });
org = api.upsertFolder(org, { id: 'scripts', name: 'Scripts and tools', order: 1, forumIds: [67] });
org = api.upsertFolder(org, { id: 'faction', name: 'Faction', order: 2, forumIds: [] });
org = api.togglePin(org, 16589908);
org = api.setPriority(org, 16474152, 2);
org = api.toggleTag(org, 16589908, 'reference');
org = api.toggleTag(org, 16474152, 'read-later');
org = api.setFolder(org, 16407150, 'scripts');
org.threads['16589908'].note = 'The one to link people to.';
org.lastCatchUpAt = NOW - 24 * 60 * MIN;
api.state.organizer = api.applyAutoAssign(org, api.state.feed.subscribed, NOW);

api.state.drafts = api.saveDraft(
  api.freshDrafts(), 16589908,
  'Thanks for this. One thing I would add is that the education time reduction\nalready shows up in actualDuration, so you do not need to reconstruct it.',
  NOW - 30 * MIN, 'A practical education guide and script companion',
);
api.state.postCache = api.postCacheAdd(api.freshPostCache(), 16589908, [
  { id: 1, authorName: 'DaftVino', at: NOW - 200 * MIN, text: 'The bank interest formula is compounded daily, not weekly. That is the part everybody gets wrong.' },
  { id: 2, authorName: 'Chedburn', at: NOW - 100 * MIN, text: 'Confirmed, and the display rounds down.' },
], { fetchedAt: NOW, pages: 1, complete: true });

// The Threads filter and the Search query are the same field on purpose, so
// the query is set per view below: an unfiltered Threads list, and a real
// query only where the Search view needs one.
api.state.searchResults = {
  mode: 'deep',
  query: 'interest',
  posts: api.searchPosts(api.state.postCache, api.state.rows, api.parseQuery('interest'), 20),
};
api.state.route = api.parseForumRoute(env.win.location);
api.state.replyBoxFound = true;
// The preview has no transport, so the refresh the bootstrap started never
// finishes and every header would read "Refreshing...".
api.state.refreshing = false;

// My posts: one thread with a local count, one started and quiet, one whose
// total was never looked up, so the mine previews show every row mark.
const mine = api.freshMine();
mine.fetchedAt = NOW - 4 * MIN;
mine.threads = [
  Object.assign(api.freshMineThread(16600001, NOW), {
    posted: true, title: 'Bazaar pricing etiquette', forumId: 2, totalKnown: true,
    postsTotal: 14, baselineTotal: 12, lastPostAt: NOW - 20 * MIN, myLastPostAt: NOW - 90 * MIN,
  }),
  Object.assign(api.freshMineThread(16600002, NOW), {
    started: true, title: 'My crime 2.0 notes', forumId: 2, totalKnown: true,
    postsTotal: 5, baselineTotal: 5, lastPostAt: NOW - 300 * MIN, myLastPostAt: NOW - 300 * MIN,
    tornNew: 0, tornNewKnown: true,
  }),
  Object.assign(api.freshMineThread(16600003, NOW), {
    posted: true, title: 'Faction recruitment thread', myLastPostAt: NOW - 600 * MIN,
  }),
];
// Thread reactions (#10): two started threads with thumbs and one net only, so
// the pill (with its "net ... on 1 more" form) and the karma icon are in every
// preview.
[[16600002, { topicAt: NOW - 5 * MIN, up: 30, down: 4 }],
 [16600004, { topicAt: NOW - 5 * MIN, up: 4, down: 1 }],
 [16600005, { reactAt: NOW - 5 * MIN, rating: -3 }]].forEach(([id, fields]) => {
  let t = mine.threads.find((x) => x.id === id);
  if (!t) {
    t = Object.assign(api.freshMineThread(id, NOW - 5 * MIN), { title: 'Started thread ' + id, forumId: 2 });
    mine.threads.push(t);
  }
  t.started = true;
  api.setReactionFields(t, fields);
});
api.state.mine = api.setKarma(mine, 1208, NOW - 5 * MIN);
api.recompute(NOW);

const css = api.panelStyleText();

// A stand-in for Torn's own stylesheet. Every one of these is the kind of bare
// element rule a large site really does ship, and every one of them beats an
// inherited colour, because inheritance only applies when NO rule matches.
// Without this the previews were far too clean to catch the bug they were
// meant to catch: the disclosure table's cells were readable here and black on
// the real site.
const HOSTILE_HOST_CSS = [
  'td, th { color: #000; background: #fff; }',
  'table { color: #000; border-collapse: separate; }',
  'h1, h2, h3, h4, h5, h6 { color: #111; }',
  'p { color: #222; }',
  'code, pre { color: #333; background: #eee; }',
  'div, span, li { color: #1a1a1a; }',
  'strong, b { color: #000; }',
  'a { color: #0645ad; }',
  'button, input, select, textarea { color: #000; background: #fff; }',
  'option { color: #000; background: #fff; }',
].join('\n');

function page(title, theme, body, width, hostile) {
  return [
    '<!doctype html>',
    '<html lang="en"><head><meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<title>' + title + '</title>',
    '<style>',
    // A stand-in for Torn's own page, so the panel is judged against a
    // background it will actually sit on rather than against white.
    'body { margin: 0; padding: 16px; font-family: Arial, Helvetica, sans-serif; font-size: 13px;',
    '  background: ' + (theme === 'light' ? '#e6e6e6' : '#0f0f0f') + '; }',
    '.frame { max-width: ' + width + 'px; margin: 0 auto; }',
    '.label { color: ' + (theme === 'light' ? '#333' : '#888') + '; font-size: 12px;',
    '  margin: 0 0 8px; font-family: monospace; }',
    // The host's rules come FIRST, exactly as they would on Torn, so our panel
    // stylesheet has to win on its own merits rather than on source order.
    hostile ? HOSTILE_HOST_CSS : '',
    css,
    '</style></head><body><div class="frame">',
    '<p class="label">' + title + '</p>',
    '<div id="tfcc-panel" class="tfcc-theme-' + theme + '">' + body + '</div>',
    '</div></body></html>',
  ].join('\n');
}

const written = [];
for (const view of api.VIEWS) {
  api.state.settings.view = view;
  api.state.searchQuery = view === 'search' ? 'by:DaftVino' : '';
  for (const theme of ['dark', 'light']) {
    api.state.settings.theme = theme;
    const body = api.panelHtml(api.buildPanelModel(NOW));
    const name = `${view}-${theme}.html`;
    fs.writeFileSync(path.join(outDir, name), page(`${view} / ${theme}`, theme, body, 1100));
    written.push(name);

    // The same view again, under a stylesheet that fights ours the way a real
    // host page does.
    const hostileName = `${view}-${theme}-hostile.html`;
    fs.writeFileSync(
      path.join(outDir, hostileName),
      page(`${view} / ${theme} / hostile host`, theme, body, 1100, true),
    );
    written.push(hostileName);
  }
}

// The narrow case is the one that matters most: this runs inside Torn PDA.
api.state.settings.view = 'threads';
api.state.settings.theme = 'dark';
api.state.searchQuery = '';
const narrow = api.panelHtml(api.buildPanelModel(NOW));
fs.writeFileSync(path.join(outDir, 'threads-narrow.html'), page('threads / narrow 375px', 'dark', narrow, 375));
written.push('threads-narrow.html');

// The cap line at PDA width, where it has to wrap without stranding the button.
api.state.settings.rowsShown = 3;
const cappedNarrow = api.panelHtml(api.buildPanelModel(NOW));
fs.writeFileSync(path.join(outDir, 'threads-capped-narrow.html'),
  page('threads / rows shown 3 / narrow 375px', 'dark', cappedNarrow, 375));
written.push('threads-capped-narrow.html');
api.state.settings.rowsShown = 0;

console.log('wrote ' + written.length + ' files to ' + outDir);
for (const w of written) console.log('  ' + w);
