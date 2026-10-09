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
  assert.match(head, /class="tfcc-hbtn" data-act="refresh" aria-label="Refresh"/);
  assert.match(head, /data-act="takeover" aria-pressed="false" aria-label="Expand"/);
  assert.match(head, /data-act="collapse" aria-label="Hide the panel"/);
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
  assert.match(head, /data-act="takeover" aria-pressed="true" aria-label="Shrink"/);
  assert.match(head, /data-act="refresh" aria-label="Refreshing" aria-busy="true"/);
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

test('narrow My posts opens with the reaction totals, before the status line', () => {
  const { api } = bootNarrow({ env: { gmStore: [['tfcc:key', 'abcdefghij123456']] } });
  api.state.mine = api.setKarma(api.freshMine(), 1208, NOW);
  api.state.settings.view = 'mine';
  const html = api.panelHtml(api.buildPanelModel(NOW));
  const rx = html.indexOf('<div class="tfcc-rxline"><button type="button" class="tfcc-reactions');
  assert.ok(rx !== -1, 'the pill markup, reused');
  assert.ok(rx < html.indexOf('<div class="tfcc-infobar">'), 'it is the first line of the view');
});

// ---- filter line (spec 4.3) --------------------------------------------------

test('the narrow filter line is the field, Unread and a named Filters button', () => {
  const { api } = bootNarrow();
  seedRows(api, [{ id: 1, unread: 1 }]);
  const html = api.panelHtml(api.buildPanelModel(NOW));
  assert.match(html, /<div class="tfcc-bar tfcc-filterline"><input class="tfcc-grow" type="search" data-act="filter"/);
  assert.match(html, /data-act="unread-only" aria-pressed="false">Unread<\/button>/);
  assert.match(html, /data-act="filters" aria-expanded="false" aria-controls="tfcc-filters" aria-label="Filters, 0 active">/);
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
  assert.match(html, /aria-label="Filters, 2 active">.*<span>2<\/span><\/button>/);
});

test('open, the filter grid is visible and Filters says so', () => {
  const { api } = bootNarrow();
  seedRows(api, [{ id: 1, unread: 1 }]);
  api.state.filtersOpen = true;
  const html = api.panelHtml(api.buildPanelModel(NOW));
  assert.match(html, /data-act="filters" aria-expanded="true"/);
  assert.match(html, /<div class="tfcc-filtergrid" id="tfcc-filters">/);
});
