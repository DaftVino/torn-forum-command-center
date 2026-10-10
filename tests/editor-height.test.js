'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { loadUserscript } = require('./load-userscript');

const NOW = 1700000000000;
const THREAD = { href: 'https://www.torn.com/forums.php#/p=threads&f=67&t=42&b=0&a=0', hash: '#/p=threads&f=67&t=42&b=0&a=0', search: '' };

function boot(narrow) {
  const env = loadUserscript({ location: THREAD, now: NOW });
  const api = env.exports;
  api.state.narrow = narrow === true;
  api.state.drafts = api.saveDraft(api.freshDrafts(), 42, 'hello', NOW, 'T', 'md');
  api.state.route = api.parseForumRoute(env.win.location);
  api.state.settings.view = 'drafts';
  return { env, api };
}
const html = (api) => api.panelHtml(api.buildPanelModel(NOW));
const heightOf = (h) => (/data-act="draft-text"[^>]*style="height: (\d+)px;"/.exec(h) || [])[1];

test('F1: defaults are Large on desktop and Medium on phone', () => {
  assert.strictEqual(heightOf(html(boot(false).api)), '260');
  assert.strictEqual(heightOf(html(boot(true).api)), '160');
});

test('F1: each layout reads its own setting, and Small is the old 90px', () => {
  const w = boot(false).api;
  w.state.settings.editorHeightWide = 'small';
  w.state.settings.editorHeightNarrow = 'xlarge';
  assert.strictEqual(heightOf(html(w)), '90');
  const n = boot(true).api;
  n.state.settings.editorHeightWide = 'small';
  n.state.settings.editorHeightNarrow = 'xlarge';
  assert.strictEqual(heightOf(html(n)), '400');
});

test('F1: a dragged height wins over the setting', () => {
  const { api } = boot(false);
  html(api);
  api.state.editor.height = 321;
  assert.strictEqual(heightOf(html(api)), '321');
});

test('F1: Settings shows both selects and a change is stored', () => {
  const { env, api } = boot(false);
  api.state.settings.view = 'settings';
  const h = html(api);
  assert.match(h, /<select id="tfcc-edh-wide" data-act="ed-height-wide">/);
  assert.match(h, /Editor height \(phone\)/);
  assert.match(h, /<option value="medium" selected>Medium<\/option><option value="large">Large/);
  const hs = api.makeHandlers(env.doc, env.win);
  const sel = (act, value) => ({ value, getAttribute: (n) => (n === 'data-act' ? act : null), hasAttribute: () => false, tagName: 'SELECT' });
  hs.onChange('ed-height-wide', sel('ed-height-wide', 'xlarge'));
  hs.onChange('ed-height-narrow', sel('ed-height-narrow', 'small'));
  assert.strictEqual(api.state.settings.editorHeightWide, 'xlarge');
  assert.strictEqual(api.state.settings.editorHeightNarrow, 'small');
  hs.onChange('ed-height-wide', sel('ed-height-wide', 'huge'));
  assert.strictEqual(api.state.settings.editorHeightWide, 'xlarge', 'off the menu changes nothing');
});

test('F1: the heights are strict on the menu', () => {
  const { api } = boot(false);
  for (const [raw, want] of [['small', 'small'], ['xlarge', 'xlarge'], ['XL', 'large'], [3, 'large'], [null, 'large'], ['toString', 'large']]) {
    assert.strictEqual(api.normaliseSettings({ v: 1, editorHeightWide: raw }).editorHeightWide, want, String(raw));
  }
  assert.strictEqual(api.normaliseSettings({ v: 1, editorHeightNarrow: 'bogus' }).editorHeightNarrow, 'medium');
});

test('F1: an older settings blob loads silently with the defaults', () => {
  const { api } = boot(false);
  const old = JSON.parse(JSON.stringify(api.freshSettings()));
  delete old.editorHeightWide;
  delete old.editorHeightNarrow;
  const env = loadUserscript({ gmStore: [['tfcc:settings', JSON.stringify(old)]] });
  const res = env.exports.loadKey(env.exports.STORAGE_KEYS.settings, env.exports.normaliseSettings, NOW,
    env.exports.isRecoveredSettings);
  assert.strictEqual(res.value.editorHeightWide, 'large');
  assert.strictEqual(res.value.editorHeightNarrow, 'medium');
  assert.strictEqual(res.recovered, false, 'no damage notice');
});
