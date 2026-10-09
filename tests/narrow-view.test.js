'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { NOW, bootNarrow, seedRows, visible } = require('./narrow-helpers');

function headOf(html) {
  const i = html.indexOf('<div class="tfcc-head">');
  return html.slice(i, html.indexOf('</div></div>', i) + 12);
}

// ---- header (spec 4.1, 13a, 13b) ---------------------------------------------

test('the narrow header is three named icon buttons, in order, on the existing actions', () => {
  const { api } = bootNarrow();
  seedRows(api, [{ id: 1, unread: 16 }]);
  const head = headOf(api.panelHtml(api.buildPanelModel(NOW)));
  const acts = Array.from(head.matchAll(/<button[^>]*data-act="([a-z-]+)"/g), (m) => m[1]);
  assert.deepStrictEqual(acts.slice(-3), ['refresh', 'takeover', 'collapse']);
  assert.match(head, /class="tfcc-hbtn" data-act="refresh" aria-label="Refresh" title="Refresh"/);
  assert.match(head, /data-act="takeover" aria-pressed="false" aria-label="Expand" title="Expand"/);
  assert.match(head, /data-act="collapse" aria-label="Hide the panel" title="Hide the panel"/);
  assert.doesNotMatch(head, /subscribed/, '"6 subscribed" moves to the Threads cell\'s name');
  assert.doesNotMatch(head, /16 new/, 'the unread count is the Threads numeral while expanded');
  assert.doesNotMatch(head, />Refresh</, 'icons, not text');
});

test('collapsed, Show is visible text and the count is a bare "16" named "16 new"', () => {
  const { api } = bootNarrow();
  seedRows(api, [{ id: 1, unread: 16 }]);
  api.state.settings.collapsed = true;
  const head = headOf(api.panelHtml(api.buildPanelModel(NOW)));
  assert.match(head, /<button type="button" class="tfcc-hshow" data-act="collapse">.*<span>Show<\/span><\/button>/);
  assert.match(head, /<span class="tfcc-badge tfcc-hcount"><span aria-hidden="true">16<\/span><span class="tfcc-sr">16 new<\/span><\/span>/);
  assert.doesNotMatch(visible(head), /16 new/, 'sighted users see "16" only');
});

test('in author-only mode the collapsed count is named "new by author"', () => {
  const { api } = bootNarrow();
  const head = api.renderHeadNarrow({ narrow: true, collapsed: true, authorOnly: true,
    totals: { unread: 3, unchecked: 0 }, badges: { enabled: false } });
  assert.match(head, /<span aria-hidden="true">3<\/span><span class="tfcc-sr">3 new by author<\/span>/);
});

test('Expand reads Shrink, pressed, in takeover; Refresh says when it is busy', () => {
  const { api } = bootNarrow();
  api.state.settings.takeover = true;
  api.state.refreshing = true;
  const head = headOf(api.panelHtml(api.buildPanelModel(NOW)));
  assert.match(head, /data-act="takeover" aria-pressed="true" aria-label="Shrink" title="Shrink"/);
  assert.match(head, /data-act="refresh" aria-label="Refreshing" title="Refreshing" aria-busy="true"/);
});

test('the loading and error states use the narrow header, without controls', () => {
  const { api } = bootNarrow();
  for (const html of [api.panelHtml(api.loadingModel(NOW)), api.panelHtml(api.errorModel('x', 'broken', NOW))]) {
    assert.match(html, /^<div class="tfcc-head"><div class="tfcc-head-id"><svg class="tfcc-logo"/);
    assert.match(html, /<span class="tfcc-pill">/, 'the chip has its narrow box');
    assert.doesNotMatch(html, /tfcc-hbtn|tfcc-hshow/);
  }
});

test('the narrow chip wraps its pill in a span, so the 44px box and the 28px pill are separate', () => {
  const { api } = bootNarrow();
  const html = api.panelHtml(api.buildPanelModel(NOW));
  assert.match(html, /<button type="button" class="tfcc-chip" data-act="badges-shelf"[^>]*><span class="tfcc-pill">/);
});

// ---- nav (spec 4.2, 13f) -----------------------------------------------------

function navOf(html) {
  const i = html.indexOf('<div class="tfcc-nav tfcc-navgrid">');
  return i === -1 ? '' : html.slice(i, html.indexOf('</div>', i));
}

test('the narrow nav is all six views in VIEWS order, with no More and no pill', () => {
  const { api } = bootNarrow({ env: { gmStore: [['tfcc:key', 'abcdefghij123456']] } });
  seedRows(api, [{ id: 1, unread: 16 }]);
  const nav = navOf(api.panelHtml(api.buildPanelModel(NOW)));
  const views = Array.from(nav.matchAll(/data-view="([a-z]+)"/g), (m) => m[1]);
  assert.deepStrictEqual(views, ['threads', 'catchup', 'search', 'drafts', 'settings', 'mine']);
  assert.doesNotMatch(nav, /tfcc-reactions/, 'the pill moves to the top of My posts');
  assert.match(nav, /data-view="mine" class="tfcc-nav-mine"/);
});

test('counts are decorative numerals behind one-line labels, carried in each cell\'s name', () => {
  const { api } = bootNarrow();
  seedRows(api, [{ id: 1, unread: 10 }, { id: 2, unread: 6 }]);
  const nav = navOf(api.panelHtml(api.buildPanelModel(NOW)));
  const model = api.buildPanelModel(NOW);
  assert.match(nav, new RegExp('data-view="threads" aria-pressed="true" aria-label="Threads, 16 new, '
    + model.totals.subscribed + ' subscribed"><span class="tfcc-navnum" aria-hidden="true">16</span>'
    + '<span class="tfcc-navlab">Threads</span></button>'));
  assert.match(nav, new RegExp('aria-label="Catch up, ' + model.catchUp.length + '"'));
  assert.match(nav, /aria-label="Drafts, none"><span class="tfcc-navlab">Drafts<\/span>/, 'zero draws no numeral');
  assert.match(nav, /data-view="search" aria-pressed="false"><span class="tfcc-navlab">Search<\/span>/);
  assert.match(nav, /data-view="settings" aria-pressed="false"><span class="tfcc-navlab">Settings<\/span>/);
});

test('a count over 999 shows as 999+', () => {
  const { api } = bootNarrow();
  assert.strictEqual(api.navNumeral(999), '999');
  assert.strictEqual(api.navNumeral(1000), '999+');
  assert.strictEqual(api.navNumeral(128), '128');
});

// ---- My posts reactions pill (#53) -------------------------------------------

const RX_KEY = { env: { gmStore: [['tfcc:key', 'abcdefghij123456']] } };
const UP = '\uD83D\uDC4D';
const DOWN = '\uD83D\uDC4E';

// threads: [[id, fields]] for started threads; fields as setReactionFields
// takes them, or null for a started thread nothing has reported on.
function mineWith(api, threads, karma, fetchedAt) {
  const mine = Object.assign(api.freshMine(), { fetchedAt: fetchedAt === undefined ? NOW : fetchedAt });
  mine.threads = threads.map(([id, fields]) => {
    const t = Object.assign(api.freshMineThread(id, NOW), { started: true, title: 'Started ' + id });
    if (fields) api.setReactionFields(t, fields);
    return t;
  });
  api.state.mine = karma === undefined ? mine : api.setKarma(mine, karma, NOW);
  api.state.settings.view = 'mine';
  api.recompute(NOW);
  return api.panelHtml(api.buildPanelModel(NOW));
}

function rxPillOf(html) {
  const i = html.indexOf('<div class="tfcc-rxline">');
  assert.ok(i !== -1, 'the pill line renders');
  const end = html.indexOf('<div class="tfcc-infobar">', i);
  return html.slice(i, end);
}

// The pill is a flex row, so its parts are separated by gaps, not spaces.
const rxText = (html) => html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
const ariaOf = (pill) => (/aria-label="([^"]*)"/.exec(pill) || [])[1] || '';
const noteOf = (html) => {
  const m = /<div class="tfcc-infobar">(?:<span class="tfcc-note">([^<]*)<\/span>)?/.exec(html);
  return m && m[1] ? m[1] : '';
};

const BOTH = [[1, { topicAt: NOW, up: 30, down: 4 }], [2, { topicAt: NOW, up: 4, down: 1 }],
  [3, { reactAt: NOW, rating: -3 }]];

test('narrow My posts opens with the reactions pill, before the status line', () => {
  const { api } = bootNarrow(RX_KEY);
  const html = mineWith(api, [], 1208);
  const rx = html.indexOf('<div class="tfcc-rxline"><div class="tfcc-rxpill" role="group" aria-label="');
  assert.ok(rx !== -1, 'the pill is a labelled group');
  assert.ok(rx < html.indexOf('<div class="tfcc-infobar">'), 'it is the first line of the view');
});

test('the narrow pill is not a button: no button, no data-act, no title anywhere in it', () => {
  const { api } = bootNarrow(RX_KEY);
  const pill = rxPillOf(mineWith(api, BOTH, 1208));
  assert.doesNotMatch(pill, /<button/, 'it already sits inside My posts');
  assert.doesNotMatch(pill, /data-act=/);
  assert.doesNotMatch(pill, /data-view=/);
  assert.doesNotMatch(pill, / title="/, 'titles are useless on touch');
  assert.doesNotMatch(pill, /tfcc-reactions/, 'not the nav button markup');
});

test('the narrow pill shows up, down, a faint dot and karma, and no net', () => {
  const { api } = bootNarrow(RX_KEY);
  const pill = rxPillOf(mineWith(api, BOTH, 1208));
  assert.strictEqual(rxText(pill), '34 ' + UP + ' 5 ' + DOWN + ' \u2022 1,208');
  assert.match(pill, /<span class="tfcc-rx">34<\/span>/, 'the numbers are bold (tfcc-rx)');
  assert.match(pill, /<span class="tfcc-rxdot" aria-hidden="true">\u2022<\/span>/);
  assert.match(pill, /<span class="tfcc-thumb" aria-hidden="true">/, 'the monochrome thumbs, reused');
  assert.ok(pill.includes(api.KARMA_ICON_SVG), 'the karma icon, reused');
  assert.doesNotMatch(rxText(pill), /net|more/, 'net moves out of the pill');
});

test('the pill\'s aria-label carries the full sentence, net included', () => {
  const { api } = bootNarrow(RX_KEY);
  const aria = ariaOf(rxPillOf(mineWith(api, BOTH, 1208)));
  assert.match(aria, /^Your threads: 34 up, 5 down, net -3 on 1 more\. Karma: 1,208\. /);
  assert.match(aria, /Thumbs up and down from the opening post of 2 of 3 threads you started\. 1 more shows Torn&#39;s net rating until checked\./);
  assert.doesNotMatch(aria, /Open My posts/, 'it is already open');
});

test('the status line names the threads whose thumbs are unchecked, and only then', () => {
  const { api } = bootNarrow(RX_KEY);
  let html = mineWith(api, BOTH, 1208, NOW - 4 * 60000);
  // "3 not checked yet" is the reply lookups (none of these rows has a total
  // yet); the thumbs clause says what it is about, so the two never merge.
  assert.strictEqual(noteOf(html), 'Updated 4m ago. 3 not checked yet. Thumbs pending on 1 of 3 threads you started.');
  html = mineWith(api, BOTH.slice(0, 2), 1208, NOW - 4 * 60000);
  assert.strictEqual(noteOf(html), 'Updated 4m ago. 2 not checked yet.', 'every thumb checked: nothing added');
  html = mineWith(api, [[1, { reactAt: NOW, rating: 2 }]], 1208, NOW - 4 * 60000);
  assert.strictEqual(noteOf(html), 'Updated 4m ago. 1 not checked yet. Thumbs pending on 1 of 1 thread you started.');
});

test('wide, the status line never carries the thumbs clause (the nav pill says net)', () => {
  const { api } = bootNarrow(Object.assign({ width: 900 }, RX_KEY));
  api.state.narrow = false;
  const html = mineWith(api, BOTH, 1208, NOW - 4 * 60000);
  assert.doesNotMatch(html, /Thumbs pending/);
});

test('unknown values show "-", never 0', () => {
  const { api } = bootNarrow(RX_KEY);
  // Started threads Torn has said nothing about, and no karma yet.
  let pill = rxPillOf(mineWith(api, [[1, null]]));
  assert.strictEqual(rxText(pill), '- ' + UP + ' - ' + DOWN + ' \u2022 -');
  // Net ratings only: the thumbs are still unknown.
  pill = rxPillOf(mineWith(api, [[1, { reactAt: NOW, rating: 2 }]], 7));
  assert.strictEqual(rxText(pill), '- ' + UP + ' - ' + DOWN + ' \u2022 7');
  assert.match(ariaOf(pill), /^Your threads: net \+2\. Karma: 7\. /);
});

test('with no started threads the pill is karma alone, with no dot', () => {
  const { api } = bootNarrow(RX_KEY);
  const pill = rxPillOf(mineWith(api, [], 1208));
  assert.strictEqual(rxText(pill), '1,208');
  assert.doesNotMatch(pill, /tfcc-rxdot/);
});

test('stale figures keep tfcc-stale and a visible age on the pill', () => {
  const { api } = bootNarrow(RX_KEY);
  const old = NOW - 3 * 24 * 3600000;
  const pill = rxPillOf(mineWith(api, [[1, { topicAt: old, up: 1, down: 1 }]], 9));
  assert.match(pill, /<div class="tfcc-rxpill tfcc-stale" role="group"/);
  assert.match(pill, /<span class="tfcc-rxage">\(3d ago\)<\/span>/);
  assert.match(ariaOf(pill), /Refresh to update\./, 'the action that works from here');
});

test('the pill line centres a shrink-to-fit, borderless, rounded pill about 30px tall', () => {
  const css = bootNarrow().api.panelStyleText();
  const block = (sel) => {
    const i = css.indexOf(sel + ' {');
    assert.ok(i !== -1, 'no rule block for ' + sel);
    return css.slice(i, css.indexOf('}', i));
  };
  const line = block('#tfcc-panel.tfcc-narrow .tfcc-rxline');
  assert.match(line, /display: flex;/);
  assert.match(line, /justify-content: center;/);
  assert.match(line, /margin: 0 0 4px 0;/);
  const pill = block('#tfcc-panel.tfcc-narrow .tfcc-rxpill');
  assert.match(pill, /display: inline-flex;/);
  assert.match(pill, /max-width: 100%;/);
  assert.doesNotMatch(pill, /(^|[ ;])width:/, 'sized to its content');
  assert.doesNotMatch(pill, /flex: 1|flex-grow/, 'never stretched');
  assert.match(pill, /border-radius: 999px;/);
  assert.match(pill, /padding: 6px 14px;/);
  assert.match(pill, /line-height: 18px;/, '6 + 18 + 6 = 30px');
  assert.match(pill, /font-size: 14px;/);
  assert.match(pill, /background: var\(--tm-bg-2\);/, 'the row card fill');
  assert.match(pill, /border: 0;/, 'no border, so it does not read as a button');
  assert.doesNotMatch(css, /\.tfcc-rxline button\.tfcc-reactions/, 'the full-width button rule is gone');
});

// ---- filter line (spec 4.3) --------------------------------------------------

test('the narrow filter line is the field, Unread and a named Filters button', () => {
  const { api } = bootNarrow();
  seedRows(api, [{ id: 1, unread: 1 }]);
  const html = api.panelHtml(api.buildPanelModel(NOW));
  assert.match(html, /<div class="tfcc-bar tfcc-filterline"><input class="tfcc-grow" type="search" data-act="filter"/);
  assert.match(html, /data-act="unread-only" aria-pressed="false">Unread<\/button>/);
  assert.match(html, /data-act="filters" aria-expanded="false" aria-controls="tfcc-filters" aria-label="Filters, 0 active" title="Filters">/);
  assert.match(html, /<div class="tfcc-filtergrid" id="tfcc-filters" hidden><select data-act="sort" aria-label="Sort">/);
  assert.match(html, /<select data-act="folder-filter" aria-label="Folder filter">/);
});

test('the Filters button counts and shows the active filters', () => {
  const { api } = bootNarrow();
  seedRows(api, [{ id: 1, unread: 1 }]);
  api.state.organizer = api.toggleTag(api.state.organizer, '1', 'x');
  api.recompute(NOW);
  api.state.settings.folderFilter = 'guides';
  api.state.settings.tagFilter = 'x';
  const html = api.panelHtml(api.buildPanelModel(NOW));
  assert.match(html, /aria-label="Filters, 2 active" title="Filters">.*<span>2<\/span><\/button>/);
});

test('open, the filter grid is visible and Filters says so', () => {
  const { api } = bootNarrow();
  seedRows(api, [{ id: 1, unread: 1 }]);
  api.state.filtersOpen = true;
  const html = api.panelHtml(api.buildPanelModel(NOW));
  assert.match(html, /data-act="filters" aria-expanded="true"/);
  assert.match(html, /<div class="tfcc-filtergrid" id="tfcc-filters">/);
});

// ---- rows (spec 4.4, 13e) ----------------------------------------------------

function rowOf(html, id) {
  // #39: an open row also carries tfcc-open.
  const m = new RegExp('<div class="tfcc-row(?: tfcc-open)?" data-id="' + id + '">').exec(html);
  assert.ok(m, 'row ' + id + ' rendered');
  const i = m.index;
  const rest = /<div class="tfcc-row(?: tfcc-open)?" data-id=/g;
  rest.lastIndex = i + 10;
  const n = rest.exec(html);
  return html.slice(i, n ? n.index : undefined);
}

test('a narrow row gives the title the whole width, with unread and buttons on line 2', () => {
  const { api } = bootNarrow();
  seedRows(api, [{ id: 7, title: 'A practical education guide', unread: 3 }]);
  api.state.organizer = api.setPriority(api.state.organizer, '7', 2);
  api.recompute(NOW);
  const row = rowOf(api.panelHtml(api.buildPanelModel(NOW)), '7');
  assert.match(row, /<div class="tfcc-row-t"><span class="tfcc-row-title"><a id="tfcc-title-7" href="[^"]+" data-tfcc-thread="7">A practical education guide<\/a><\/span><\/div>/);
  assert.match(row, /<div class="tfcc-row-l2"><div class="tfcc-meta"><span class="tfcc-unread">3 new<\/span><span class="tfcc-prio">\+2<\/span>/,
    'unread first, then the priority in the meta');
  assert.doesNotMatch(row, /data-act="prio-up"/, 'no inline +/- outside the drawer');
});

test('priority shows in the meta only when it is not zero', () => {
  const { api } = bootNarrow();
  seedRows(api, [{ id: 7, unread: 1 }]);
  assert.doesNotMatch(rowOf(api.panelHtml(api.buildPanelModel(NOW)), '7'), /tfcc-prio/);
});

test('Catch up rows carry a one-tap Read: a check mark named Mark read, described by the title', () => {
  const { api } = bootNarrow();
  seedRows(api, [{ id: 7, unread: 3 }]);
  api.state.settings.view = 'catchup';
  const row = rowOf(api.panelHtml(api.buildPanelModel(NOW)), '7');
  assert.match(row, /<button type="button" class="tfcc-read" data-act="read" data-id="7" aria-label="Mark read" title="Mark read" aria-describedby="tfcc-title-7"><svg class="tfcc-gl"[^>]*><path d="[^"]+"\/><\/svg><\/button>/,
    'the check mark alone, no text');
  assert.ok(row.indexOf('data-act="read"') < row.indexOf('data-act="row-more"'), 'DOM order: Read, then Actions');
});

test('Read is visible only in narrow Catch up', () => {
  const { api } = bootNarrow();
  seedRows(api, [{ id: 7, unread: 3 }]);
  api.state.settings.view = 'threads';
  assert.doesNotMatch(rowOf(api.panelHtml(api.buildPanelModel(NOW)), '7'), /class="tfcc-read"/);
  api.state.narrow = false;
  api.state.settings.view = 'catchup';
  assert.doesNotMatch(api.panelHtml(api.buildPanelModel(NOW)), /class="tfcc-read"/, 'wide keeps its action row');
});

test('every narrow row has an Actions button that controls an always-present, empty, hidden drawer', () => {
  const { api } = bootNarrow();
  seedRows(api, [{ id: 7, title: 'Seven', unread: 1 }]);
  const row = rowOf(api.panelHtml(api.buildPanelModel(NOW)), '7');
  assert.match(row, /data-act="row-more" data-id="7" aria-expanded="false" aria-controls="tfcc-act-7" aria-label="Actions for Seven" title="Actions">/);
  assert.match(row, /<div class="tfcc-drawer" id="tfcc-act-7" hidden><\/div>/);
});

test('an open drawer holds every row action at 44px, in the spec order', () => {
  const { api } = bootNarrow();
  seedRows(api, [{ id: 7, unread: 1 }]);
  api.state.openRowId = '7';
  const row = rowOf(api.panelHtml(api.buildPanelModel(NOW)), '7');
  assert.match(row, /data-act="row-more" data-id="7" aria-expanded="true"/);
  const acts = Array.from(row.slice(row.indexOf('tfcc-drawer')).matchAll(/data-act="([a-z-]+)"/g), (m) => m[1]);
  assert.deepStrictEqual(acts, ['pin', 'read', 'draft', 'archive', 'info', 'prio-up', 'prio-down', 'folder', 'editor', 'editor']);
});

test('in Catch up the drawer leaves out Mark read, which is already on the row', () => {
  const { api } = bootNarrow();
  seedRows(api, [{ id: 7, unread: 1 }]);
  api.state.settings.view = 'catchup';
  api.state.openRowId = '7';
  const row = rowOf(api.panelHtml(api.buildPanelModel(NOW)), '7');
  assert.strictEqual((row.match(/data-act="read"/g) || []).length, 1);
});

test('only one drawer is open at a time', () => {
  const { api } = bootNarrow();
  seedRows(api, [{ id: 7, unread: 1 }, { id: 8, unread: 1 }]);
  api.state.openRowId = '8';
  const html = api.panelHtml(api.buildPanelModel(NOW));
  assert.strictEqual((html.match(/aria-expanded="true" aria-controls="tfcc-act-/g) || []).length, 1);
  assert.match(html, /id="tfcc-act-7" hidden><\/div>/);
});

test('the narrow view heading is visible in Catch up with its date, and hidden elsewhere', () => {
  const { api } = bootNarrow();
  api.state.settings.view = 'catchup';
  let html = api.panelHtml(api.buildPanelModel(NOW));
  assert.match(html, /<h3 class="tfcc-vh" id="tfcc-vh" tabindex="-1">Catch up <span class="tfcc-note">since [^<]+<\/span><\/h3>/);
  assert.doesNotMatch(html, /<span class="tfcc-note">Since /, 'the bar no longer repeats it');
  api.state.settings.view = 'threads';
  html = api.panelHtml(api.buildPanelModel(NOW));
  assert.match(html, /<h3 class="tfcc-vh tfcc-sr" id="tfcc-vh" tabindex="-1">Threads<\/h3>/);
});

test('a drawer edit mirror renders the typed value instead of the stored one', () => {
  const { api } = bootNarrow();
  seedRows(api, [{ id: 7, unread: 1 }]);
  api.state.openRowId = '7';
  api.state.drawerEdit = { id: '7', field: 'note-input', value: 'half typed', selStart: 4, selEnd: 4 };
  // #43: in the note popup.
  api.state.openEditor = { id: '7', field: 'note' };
  assert.match(api.panelHtml(api.buildPanelModel(NOW)), /data-act="editor-input" data-id="7" data-field="note-input" value="half typed"/);
});

// ---- an info button stays on the line of the control it follows -----------

test('narrow Catch up keeps its info button in one group with "Set catch-up point to now"', () => {
  const { api } = bootNarrow();
  api.state.settings.view = 'catchup';
  const html = api.panelHtml(api.buildPanelModel(NOW));
  assert.match(html, /<span class="tfcc-infogroup"><button type="button" data-act="catchup-done" aria-label="Set catch-up point to now"><span class="tfcc-lfull">Set catch-up point to now<\/span><span class="tfcc-lshort" aria-hidden="true">[^<]*<\/span><\/button><button type="button" class="tfcc-info" data-act="info" data-info="catchup"/);
});

test('narrow Search keeps its info button in one group with "Search on Torn"', () => {
  const { api } = bootNarrow();
  api.state.settings.view = 'search';
  const html = api.panelHtml(api.buildPanelModel(NOW));
  assert.match(html, /<span class="tfcc-infogroup"><a class="tfcc-linkbtn" href="[^"]*">Search on Torn<\/a><button type="button" class="tfcc-info" data-act="info" data-info="search"/);
});

test('wide Catch up and Search have no info group (desktop markup is main\'s plus 13d)', () => {
  const { api } = bootNarrow({ width: 900 });
  for (const view of ['catchup', 'search']) {
    api.state.settings.view = view;
    assert.doesNotMatch(api.panelHtml(api.buildPanelModel(NOW)), /tfcc-infogroup/, view);
  }
});
