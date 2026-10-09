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
