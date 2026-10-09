'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { NOW, bootNarrow, seedRows, visible, click } = require('./narrow-helpers');

function htmlFor(api, view) {
  api.state.settings.view = view;
  return api.panelHtml(api.buildPanelModel(NOW));
}

// The owner-approved spec 13d audit, written out here and never read from the
// production constants, so dropping an item from both the code and
// INFO_KEYS_BY_VIEW still fails. info: the exact keys the view renders, with
// their accessible names. hidden: text that stays in the markup but is not
// shown until asked. visible: text that must be shown. gone: wording that the
// audit removed or shortened away.
const OWNER_13D = {
  threads: { info: {} },
  catchup: {
    info: { catchup: 'About Catch up' },
    hidden: ['Marking read here hides a thread from this list.'],
  },
  mine: {
    info: { mine: 'About My posts' },
    hidden: ['Threads you started or posted in.', 'at most once every 15 minutes; Refresh always does.'],
    visible: ['Updated 4m ago.'],
  },
  search: {
    info: { search: 'About Search' },
    hidden: ['Filtering searches titles, authors, forums, your notes and tags.'],
    visible: ['Cached posts:'],
  },
  drafts: {
    info: {},
    visible: ['No reply box here, so Copy replaces Insert.'],
    gone: ['No reply box was found'],
  },
  settings: {
    info: {
      'settings-budget': 'About the request budget',
      'settings-author': 'About author-only mode',
      'settings-rows': 'About Rows shown',
      'settings-autohide': 'About hiding the panel',
      'settings-folders': 'About folders',
      'settings-badges': 'About badges',
    },
    hidden: [
      'A refresh of Threads makes two requests',
      'With this on, a thread in Threads and Catch up counts as new only when',
      'Search and Drafts always show everything.',
      'Only thread links in this panel do this, and only a plain click.',
      'A folder can claim a forum',
      'Earned from what you do here',
    ],
    visible: [
      'Create a <strong>Minimal Access</strong> key on Torn (Settings, API Key).',
      'Opens Torn in a new tab with only this script\'s selections.',
      'A Threads refresh is at most 13 requests and My posts at most 17; never more than 40 a minute.',
      'Costs no extra requests. Some threads may show &quot;not checked&quot;.',
      'Applies to Threads, Catch up and My posts.',
      'Never includes your API key or the post cache.',
      'Never includes your key, drafts, notes or post text.',
      'Recorded on this device only. No request is made.',
    ],
    gone: ['This script needs a key', 'This opens Torn', 'An export carries', 'A debug report carries'],
  },
};

function seeded(width) {
  const { env, api } = bootNarrow({ width });
  seedRows(api, [{ id: 1, unread: 1 }]);
  api.state.mine.fetchedAt = NOW - 4 * 60000;
  api.state.route = api.parseForumRoute({ origin: 'https://www.torn.com', hostname: 'www.torn.com',
    pathname: '/forums.php', search: '', hash: '#/p=threads&f=61&t=1', href: 'https://www.torn.com/forums.php#/p=threads&f=61&t=1' });
  api.state.replyBoxFound = false;
  return { env, api };
}

test('every view renders exactly the owner\'s info buttons, each wired to a hidden text', () => {
  for (const width of [900, 343]) {
    const { api } = seeded(width);
    for (const [view, spec] of Object.entries(OWNER_13D)) {
      const html = htmlFor(api, view);
      const keys = Array.from(html.matchAll(/data-act="info" data-info="([a-z-]+)"/g), (m) => m[1]);
      assert.deepStrictEqual(keys.slice().sort(), Object.keys(spec.info).sort(), view + ' at ' + width);
      for (const [key, label] of Object.entries(spec.info)) {
        assert.match(html, new RegExp('data-info="' + key + '" aria-expanded="false" aria-controls="tfcc-info-'
          + key + '" aria-label="' + label + '"'), key);
        assert.match(html, new RegExp('<p class="tfcc-note tfcc-infotext" id="tfcc-info-' + key + '" hidden>'),
          key + ' is in the markup and hidden while closed');
      }
    }
  }
});

test('every audited text is hidden, visible or gone exactly as section 13d prescribes', () => {
  for (const width of [900, 343]) {
    const { api } = seeded(width);
    for (const [view, spec] of Object.entries(OWNER_13D)) {
      const html = htmlFor(api, view);
      const v = visible(html);
      for (const s of spec.hidden || []) {
        assert.ok(html.includes(s), view + ': still in the markup: ' + s);
        assert.ok(!v.includes(s), view + ': not shown until asked: ' + s);
      }
      for (const s of spec.visible || []) assert.ok(v.includes(s), view + ': visible: ' + s);
      for (const s of spec.gone || []) assert.ok(!html.includes(s), view + ': gone: ' + s);
    }
  }
});

test('tapping an info button opens it, a second tap closes it, and only one is open', () => {
  const { env, api } = bootNarrow({ width: 900 });
  api.state.settings.view = 'settings';
  env.exports.draw(env.doc, env.win, api.makeHandlers(env.doc, env.win), true);
  click(env, '[data-act="info"][data-info="settings-budget"]');
  let html = env.doc.getElementById('tfcc-panel').innerHTML;
  assert.match(html, /<p class="tfcc-note tfcc-infotext" id="tfcc-info-settings-budget">/);
  assert.match(html, /data-info="settings-budget" aria-expanded="true"/);
  click(env, '[data-act="info"][data-info="settings-rows"]');
  html = env.doc.getElementById('tfcc-panel').innerHTML;
  assert.match(html, /id="tfcc-info-settings-budget" hidden>/, 'opening another closes the first');
  assert.match(html, /id="tfcc-info-settings-rows">/);
  click(env, '[data-act="info"][data-info="settings-rows"]');
  assert.strictEqual(api.state.openInfoId, null);
});

test('an unknown data-info changes nothing and does not throw', () => {
  const { env, api } = bootNarrow({ width: 900 });
  const h = api.makeHandlers(env.doc, env.win);
  assert.doesNotThrow(() => h.onAction('info', { getAttribute: (k) => (k === 'data-info' ? 'evil' : 'info') }));
  assert.doesNotThrow(() => h.onAction('info', { getAttribute: () => null }));
  assert.strictEqual(api.state.openInfoId, null);
});

test('a view change closes the open info', () => {
  const { env, api } = bootNarrow({ width: 900 });
  api.state.settings.view = 'catchup';
  api.state.openInfoId = 'catchup';
  api.makeHandlers(env.doc, env.win).onAction('view', { getAttribute: (k) => (k === 'data-view' ? 'search' : 'view') });
  assert.strictEqual(api.state.openInfoId, null);
});

test('Catch up\'s standing paragraph is behind its info button, at every size', () => {
  for (const width of [900, 343]) {
    const { api } = bootNarrow({ width });
    const html = htmlFor(api, 'catchup');
    assert.match(html, /Marking read here hides a thread from this list\./, 'still in the markup');
    assert.doesNotMatch(visible(html), /Marking read here/, 'but not shown until asked');
  }
});

test('My posts keeps its live status visible and its description behind info', () => {
  const { api } = bootNarrow({ width: 900 });
  api.state.mine.fetchedAt = NOW - 4 * 60000;
  const html = htmlFor(api, 'mine');
  assert.match(visible(html), /Updated 4m ago\./);
  assert.doesNotMatch(visible(html), /Threads you started or posted in/);
  assert.match(html, /Threads you started or posted in\. Opening My posts checks Torn again at most once every 15 minutes; Refresh always does\./);
});

test('Settings states the real request budget visibly, computed from the user\'s setting', () => {
  const { api } = bootNarrow({ width: 900 });
  let html = htmlFor(api, 'settings');
  assert.match(visible(html), /A Threads refresh is at most 13 requests and My posts at most 17; never more than 40 a minute\./);
  api.state.settings.enrichBudget = 4;
  html = htmlFor(api, 'settings');
  assert.match(visible(html), /A Threads refresh is at most 7 requests and My posts at most 10; never more than 40 a minute\./);
  assert.match(html, /The script keeps itself under 40 requests a minute regardless\./, 'the full breakdown is behind info');
});

test('the required disclosures stay visible: the ToS table, key status and both privacy lines', () => {
  const { api } = bootNarrow({ width: 343 });
  const v = visible(htmlFor(api, 'settings'));
  for (const s of ['<th>Who can see your data</th>', '<th>Access level required</th>', '<th>Requests made</th>',
    'No key saved yet.', 'Create a <strong>Minimal Access</strong> key on Torn (Settings, API Key).',
    'Opens Torn in a new tab with only this script\'s selections.',
    '<tr><th>Access level required</th><td>Minimal Access. Limited Access also works but is not needed. Public Only does not.</td></tr>',
    'Never includes your API key or the post cache.',
    'Never includes your key, drafts, notes or post text.',
    'Recorded on this device only. No request is made.',
    'Applies to Threads, Catch up and My posts.',
    'Costs no extra requests. Some threads may show &quot;not checked&quot;.']) {
    assert.ok(v.includes(s), 'visible: ' + s);
  }
});

test('Drafts names the missing reply box in fewer words', () => {
  const { api } = bootNarrow({ width: 900 });
  api.state.route = api.parseForumRoute({ pathname: '/forums.php', hash: '#/p=threads&f=61&t=1', hostname: 'www.torn.com' });
  api.state.replyBoxFound = false;
  assert.match(htmlFor(api, 'drafts'), /No reply box here, so Copy replaces Insert\./);
});

test('every glyph is ASCII path data, drawn in currentColor and hidden from assistive tech', () => {
  const { api } = bootNarrow({ width: 900 });
  for (const name of Object.keys(api.GLYPHS)) {
    assert.match(api.GLYPHS[name], /^[MmLlHhVvAaZz0-9 .,-]+$/, name);
    const svg = api.glyph(name);
    assert.match(svg, /^<svg class="tfcc-gl" viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false">/);
  }
});
