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
// #41: a summary long enough to wrap, so the clip previews show the cut.
org = api.toggleTag(org, 15978774, 'long');
org.threads['15978774'].note = 'A long summary note that goes on well past the width of a phone, and past a narrow '
  + 'desktop column too, so the clip setting has something to cut.';
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
  'svg, svg * { fill: #000; color: #000; }',
].join('\n');

// The real functions, by source text, with the constants and the one state
// field they read. A preview that drifted from the runtime would prove nothing.
const raw = env.rawExports;
const FIT_HEADER_SHIM = [
  'var state = { narrow: true };',
  ['HB_MAX', 'HB_MIN', 'HB_STEP', 'HB_COMPACT_BELOW', 'HB_GAPS', 'HB_COUNT_GAP', 'LOGO_ASPECT', 'LOGO_PER_HB', 'LOGO_MIN_PX', 'LOGO_MAX_PX']
    .map((k) => 'var ' + k + ' = ' + JSON.stringify(raw[k]) + ';').join('\n'),
  String(raw.headerLogoWidth),
  String(raw.headerButtonSize),
  'function setHeaderSize(panel, size) { if (size === null) panel.style.removeProperty("--tfcc-hb");'
    + ' else panel.style.setProperty("--tfcc-hb", size + "px"); }',
  String(raw.fitHeader),
  'fitHeader(document.getElementById("tfcc-panel"), window);',
  // #39: the Catch up row's fit, the same way.
  ['CU_GAP', 'CU_MODES', 'CU_SHORT_CLASS', 'CU_WRAP_CLASS']
    .map((k) => 'var ' + k + ' = ' + JSON.stringify(raw[k]) + ';').join('\n'),
  String(raw.catchUpLabelMode),
  String(raw.fitCatchUp),
  'fitCatchUp(document.getElementById("tfcc-panel"), window);',
].join('\n');

// #39: 200% text, the way spec 4.7 measured it: the panel's two text sizes
// doubled (an Android WebView's textZoom scales px text too).
const TEXT_200 = '#tfcc-panel { --tfcc-text: 28px; --tfcc-text-sm: 24px; }';

// #43: what shows through the translucent panel. We cannot read Torn's page
// (ADR 0001), so the panel is judged over the extremes: pure black, pure
// white, and a busy mid-grey stripe. colors are what the audit composites
// over (each stripe colour in turn, so a pattern is judged by its worst).
const UNDERLAYS = {
  black: { css: '#000000', colors: '0,0,0' },
  white: { css: '#ffffff', colors: '255,255,255' },
  busy: { css: 'repeating-linear-gradient(45deg, #4a4a4a 0 10px, #c8c8c8 10px 20px, #6e6e6e 20px 30px, #a0a0a0 30px 40px)',
    colors: '74,74,74;200,200,200;110,110,110;160,160,160' },
};

function page(title, theme, body, width, hostile, narrow, extraCss, underlay, takeover) {
  return [
    '<!doctype html>',
    '<html lang="en"><head><meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<title>' + title + '</title>',
    '<style>',
    // A stand-in for Torn's own page, so the panel is judged against a
    // background it will actually sit on rather than against white.
    'body { margin: 0; padding: 16px; font-family: Arial, Helvetica, sans-serif; font-size: 13px;',
    '  background: ' + (underlay ? underlay.css : (theme === 'light' ? '#e6e6e6' : '#0f0f0f')) + '; }',
    '.frame { max-width: ' + width + 'px; margin: 0 auto; }',
    '.label { color: ' + (theme === 'light' ? '#333' : '#888') + '; font-size: 12px;',
    '  margin: 0 0 8px; font-family: monospace; }',
    // The host's rules come FIRST, exactly as they would on Torn, so our panel
    // stylesheet has to win on its own merits rather than on source order.
    hostile ? HOSTILE_HOST_CSS : '',
    css,
    extraCss || '',
    '</style></head><body' + (underlay ? ' data-underlay="' + underlay.colors + '"' : '') + '><div class="frame">',
    '<p class="label">' + title + '</p>',
    // #41: the runtime puts tfcc-clip on the panel while the setting is on.
    '<div id="tfcc-panel" class="tfcc-theme-' + theme + (narrow ? ' tfcc-narrow' : '') + (takeover ? ' tfcc-takeover' : '')
      + (api.state.settings.clipLines !== false ? ' tfcc-clip' : '')
      // #43: the see-through setting is a class too (on by default).
      + (api.state.settings.seeThrough !== false ? ' tfcc-seethrough' : '') + '">' + body + '</div>',
    // #33: the production fitHeader and headerButtonSize, verbatim, so the
    // preview's header is sized exactly as the script sizes it.
    narrow ? '<script>' + FIT_HEADER_SHIM + '</script>' : '',
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

// #41: the clip setting on and off on a wide panel, at a desktop column narrow
// enough (720px) that the long title and summary would wrap.
for (const clip of [true, false]) {
  api.state.settings.clipLines = clip;
  for (const theme of ['dark', 'light']) {
    api.state.settings.theme = theme;
    const body = api.panelHtml(api.buildPanelModel(NOW));
    const name = `clip-${clip ? 'on' : 'off'}-threads-wide-${theme}.html`;
    fs.writeFileSync(path.join(outDir, name), page(`threads / clip ${clip ? 'on' : 'off'} / wide 720px / ${theme}`, theme, body, 720));
    written.push(name);
  }
}
api.state.settings.clipLines = true;
api.state.settings.theme = 'dark';

// The cap line at PDA width, where it has to wrap without stranding the button.
api.state.settings.rowsShown = 3;
const cappedNarrow = api.panelHtml(api.buildPanelModel(NOW));
fs.writeFileSync(path.join(outDir, 'threads-capped-narrow.html'),
  page('threads / rows shown 3 / narrow 375px', 'dark', cappedNarrow, 375));
written.push('threads-capped-narrow.html');
api.state.settings.rowsShown = 0;

// #33: the condensed layout. Panel widths are the spec's: a 375, 320 and
// 280px phone inside a 16px gutter. Each state in dark and light.
api.state.narrow = true;
const NARROW_STATES = [
  ['threads', () => { api.state.settings.view = 'threads'; }],
  ['threads-drawer', () => { api.state.settings.view = 'threads'; api.state.openRowId = '16474152'; }],
  ['catchup', () => { api.state.settings.view = 'catchup'; }],
  ['catchup-info-drawer', () => { api.state.settings.view = 'catchup'; api.state.openInfoId = 'catchup';
    api.state.openRowId = '16474152'; }],
  ['filters', () => { api.state.settings.view = 'threads'; api.state.filtersOpen = true; }],
  ['mine', () => { api.state.settings.view = 'mine'; }],
  ['collapsed', () => { api.state.settings.view = 'threads'; api.state.settings.collapsed = true; }],
  ['shelf', () => { api.state.settings.view = 'threads'; api.state.badgeShelfOpen = true; }],
  // PR #38 review: every view with an info button, so the audit checks each
  // button sits on the line of the control it follows.
  ['search', () => { api.state.settings.view = 'search'; }],
  ['settings', () => { api.state.settings.view = 'settings'; }],
  // #39: the Catch up row and an open drawer at 200% text, and a pinned row's
  // drawer so the "on" state of an emoji button is measured too.
  ['catchup-200', () => { api.state.settings.view = 'catchup'; }, TEXT_200],
  ['threads-drawer-200', () => { api.state.settings.view = 'threads'; api.state.openRowId = '16474152'; }, TEXT_200],
  ['threads-drawer-pinned', () => { api.state.settings.view = 'threads'; api.state.openRowId = '16589908'; }],
  // #41: the clip setting off, where the title, summary and meta wrap again;
  // and on with the long row's drawer open, where it shows them whole.
  ['threads-clipoff', () => { api.state.settings.view = 'threads'; api.state.settings.clipLines = false; }],
  ['threads-drawer-long', () => { api.state.settings.view = 'threads'; api.state.openRowId = '15978774'; }],
  // #43: the tag and note popup open in the drawer (the note on a row that has one).
  ['threads-drawer-tag', () => { api.state.settings.view = 'threads'; api.state.openRowId = '16474152';
    api.state.openEditor = { id: '16474152', field: 'tag' }; }],
  ['threads-drawer-note', () => { api.state.settings.view = 'threads'; api.state.openRowId = '16589908';
    api.state.openEditor = { id: '16589908', field: 'note' }; }],
  // #43: the drawer's priority explanation open, under its icon row.
  ['threads-drawer-prioinfo', () => { api.state.settings.view = 'threads'; api.state.openRowId = '16474152';
    api.state.openInfoId = 'priority'; }],
  ['catchup-drawer-note', () => { api.state.settings.view = 'catchup'; api.state.openRowId = '16474152';
    api.state.openEditor = { id: '16474152', field: 'note' }; }],
];
for (const [label, setUp, extraCss] of NARROW_STATES) {
  for (const [vp, panelPx] of [[375, 343], [320, 288], [280, 248]]) {
    // 200% text is supported at 320px and up (spec 4.7), not at 280.
    if (extraCss === TEXT_200 && vp === 280) continue;
    for (const theme of ['dark', 'light']) {
      Object.assign(api.state, { openRowId: null, filtersOpen: false, openInfoId: null, badgeShelfOpen: false, openEditor: null });
      api.state.settings.collapsed = false;
      api.state.settings.clipLines = true;
      api.state.settings.theme = theme;
      setUp();
      const body = api.panelHtml(api.buildPanelModel(NOW));
      const name = `narrow-${label}-${vp}-${theme}.html`;
      fs.writeFileSync(path.join(outDir, name),
        page(`narrow ${label} / ${vp}px / ${theme}`, theme, body, panelPx, label === 'threads', true, extraCss));
      written.push(name);
    }
  }
}
api.state.narrow = false;
api.state.settings.clipLines = true;
Object.assign(api.state, { openRowId: null, filtersOpen: false, openInfoId: null, badgeShelfOpen: false, openEditor: null });
api.state.settings.collapsed = false;

// #43: the see-through panel over each underlay, in both themes: rows and a
// drawer, Catch up's heading, and the views whose text sits straight on the
// panel (Search's posts, Settings). Report-only in the audit unless they
// pass. The same views in takeover, and with the setting off, must be solid,
// so those are audited.
const UNDERLAY_STATES = [
  ['narrow-threads-drawer', true, () => { api.state.settings.view = 'threads'; api.state.openRowId = '16474152'; }],
  ['narrow-catchup', true, () => { api.state.settings.view = 'catchup'; }],
  ['wide-threads', false, () => { api.state.settings.view = 'threads'; }],
  ['wide-search', false, () => { api.state.settings.view = 'search'; api.state.searchQuery = 'by:DaftVino'; }],
  ['wide-settings', false, () => { api.state.settings.view = 'settings'; }],
];
for (const [label, narrowState, setUp] of UNDERLAY_STATES) {
  for (const [uname, underlay] of Object.entries(UNDERLAYS)) {
    for (const theme of ['dark', 'light']) {
      Object.assign(api.state, { openRowId: null, filtersOpen: false, openInfoId: null, badgeShelfOpen: false, openEditor: null });
      api.state.searchQuery = '';
      api.state.narrow = narrowState;
      api.state.settings.theme = theme;
      setUp();
      const body = api.panelHtml(api.buildPanelModel(NOW));
      const width = narrowState ? 343 : 900;
      for (const [prefix, takeover, see] of [['', false, true], ['takeover-', true, true], ['solid-', false, false]]) {
        if (prefix && label !== 'wide-threads' && label !== 'narrow-threads-drawer') continue;
        api.state.settings.seeThrough = see;
        const name = prefix + `underlay-${uname}-${label}-${theme}.html`;
        fs.writeFileSync(path.join(outDir, name), page(`${label} over ${uname}${takeover ? ' / takeover' : ''}`
          + `${see ? '' : ' / see-through off'} / ${theme}`, theme, body, width, false, narrowState, '', underlay, takeover));
        written.push(name);
      }
      api.state.settings.seeThrough = true;
    }
  }
}
api.state.narrow = false;
api.state.searchQuery = '';
Object.assign(api.state, { openRowId: null, filtersOpen: false, openInfoId: null, badgeShelfOpen: false, openEditor: null });
api.state.settings.theme = 'dark';
api.state.settings.view = 'threads';

// Badges (issue #9). Match Torn applies one of the two theme classes, so dark
// and light cover it; both are rendered here under the hostile host too.
api.state.badges = api.normaliseBadges({
  v: 1, visits: 30, checkinDays: 12, bigBacklog: 0, firstCheckinAt: NOW - 864000000,
  streak: { current: 12, best: 23, lastDay: Math.floor(NOW / 86400000) }, forums: [61, 63, 67],
  today: { day: Math.floor(NOW / 86400000), firstLook: 0, backlogIds: [], visitIds: [] },
  earned: { reader: NOW - 1000, 'streak-10': NOW - 2000, 'caught-up': NOW - 3000, explorer: NOW - 4000,
    'switched-on': NOW - 5000, 'tidy-desk': NOW - 6000, 'streak-100': NOW - 7000 },
});
const BADGE_STATES = [
  ['chip', () => { api.state.settings.collapsed = false; api.state.badgeShelfOpen = false; api.state.badgeToast = null; }],
  ['shelf', () => { api.state.badgeShelfOpen = true; }],
  ['toast', () => { api.state.badgeShelfOpen = false;
    api.state.badgeToast = { text: 'Badge earned: Reader (Bronze). 475 more focused visits to Bookworm.', until: NOW + 6000, announced: false }; }],
  ['collapsed', () => { api.state.settings.collapsed = true; api.state.badgeShelfOpen = true;
    api.state.badgeToast = { text: 'Badge earned: Ten days (Silver). 15 more days to Twenty-five days.', until: NOW + 6000, announced: false }; }],
  ['catalogue', () => { api.state.settings.collapsed = false; api.state.badgeShelfOpen = false; api.state.badgeToast = null;
    api.state.settings.view = 'settings'; api.state.badgeCatalogueOpen = true; }],
];
for (const [label, setUp] of BADGE_STATES) {
  api.state.settings.view = 'threads';
  setUp();
  for (const theme of ['dark', 'light']) {
    api.state.settings.theme = theme;
    const body = api.panelHtml(api.buildPanelModel(NOW));
    for (const width of [320, 360]) {
      for (const hostile of [false, true]) {
        const name = `badges-${label}-${theme}-${width}${hostile ? '-hostile' : ''}.html`;
        fs.writeFileSync(path.join(outDir, name),
          page(`badges ${label} / ${theme} / ${width}px${hostile ? ' / hostile' : ''}`, theme, body, width, hostile));
        written.push(name);
      }
    }
  }
}
api.state.settings.collapsed = false;
api.state.badgeCatalogueOpen = false;
api.state.badgeToast = null;

console.log('wrote ' + written.length + ' files to ' + outDir);
for (const w of written) console.log('  ' + w);
