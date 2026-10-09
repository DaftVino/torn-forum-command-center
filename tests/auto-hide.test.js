'use strict';

// Issue #8: hide the panel when the user opens a thread from it.
// Spec: docs/superpowers/specs/2026-10-08-auto-hide-on-open-design.md

const test = require('node:test');
const assert = require('node:assert');
const { loadUserscript, FORUMS_LOCATION } = require('./load-userscript');

const NOW = 1700000000000;
const THREAD_HASH = '#/p=threads&f=61&t=5&b=0&a=0';

function forums(extra) {
  return Object.assign({}, FORUMS_LOCATION, extra || {});
}

function panelOf(env) {
  return env.doc.getElementById('tfcc-panel');
}

function storedSettings(env) {
  const raw = env.gmStore.get('tfcc:settings');
  return raw ? JSON.parse(raw) : null;
}

// ---- storage ---------------------------------------------------------------

test('the setting defaults on (#30), an explicit false stays off, and junk is off', () => {
  const { exports: api } = loadUserscript();
  assert.strictEqual(api.freshSettings().autoHideOnOpen, true);
  assert.strictEqual(api.normaliseSettings({ v: 1 }).autoHideOnOpen, true, 'an absent field takes the default');
  assert.strictEqual(api.normaliseSettings({ v: 1, autoHideOnOpen: false }).autoHideOnOpen, false,
    'a user who turned it off keeps it off');
  for (const bad of ['true', 1, 'yes', null, undefined, {}, []]) {
    assert.strictEqual(api.normaliseSettings({ v: 1, autoHideOnOpen: bad }).autoHideOnOpen, false,
      'corrupt must mean off: ' + JSON.stringify(bad));
  }
  assert.strictEqual(api.normaliseSettings({ v: 1, autoHideOnOpen: true }).autoHideOnOpen, true);
});

test('an explicit stored false survives a reload now that the default is on', () => {
  const { exports: api } = loadUserscript();
  const stored = Object.assign(api.freshSettings(), { autoHideOnOpen: false });
  const env = loadUserscript({ location: forums(), now: NOW, gmStore: [['tfcc:settings', JSON.stringify(stored)]] });
  assert.strictEqual(env.exports.state.settings.autoHideOnOpen, false);
  const notices = env.exports.state.notices.map((n) => n.text).join(' ');
  assert.doesNotMatch(notices, /Settings were damaged/);
});

test('the setting round-trips through storage and survives a reload', () => {
  const first = loadUserscript({ location: forums(), now: NOW });
  first.exports.state.settings.autoHideOnOpen = true;
  first.exports.persist('settings');
  assert.strictEqual(storedSettings(first).autoHideOnOpen, true);

  const again = loadUserscript({
    location: forums(), now: NOW,
    gmStore: [['tfcc:settings', first.gmStore.get('tfcc:settings')]],
  });
  assert.strictEqual(again.exports.state.settings.autoHideOnOpen, true);
  assert.strictEqual(again.exports.buildPanelModel(NOW).settings.autoHideOnOpen, true,
    'the Settings view reads model.settings, so the model must carry it');
});

test('a settings blob saved by 0.1.0 is not reported as damaged', () => {
  // 0.1.0 wrote every field it knew, in settingsDefaults order, and nothing
  // else. A field this release adds is absent from it. That is an upgrade, and
  // telling the user their settings were reset would be false.
  const { exports: api } = loadUserscript();
  const old = api.freshSettings();
  delete old.autoHideOnOpen;

  const env = loadUserscript({ location: forums(), now: NOW, gmStore: [['tfcc:settings', JSON.stringify(old)]] });
  const notices = env.exports.state.notices.map((n) => n.text).join(' ');
  assert.doesNotMatch(notices, /Settings were damaged/);

  const res = env.exports.loadKey('tfcc:settings', env.exports.normaliseSettings, NOW);
  assert.strictEqual(res.recovered, false);
  assert.strictEqual(res.value.autoHideOnOpen, true, 'an absent field takes the new default (#30)');
  assert.strictEqual(env.exports.state.settings.autoHideOnOpen, true);
});

test('a setting that is present but invalid is still reported', () => {
  const { exports: api } = loadUserscript();
  const bad = api.freshSettings();
  bad.collapsed = 'yes';
  const env = loadUserscript({ location: forums(), now: NOW, gmStore: [['tfcc:settings', JSON.stringify(bad)]] });
  const res = env.exports.loadKey('tfcc:settings', env.exports.normaliseSettings, NOW);
  assert.strictEqual(res.recovered, true, 'forgiving absent fields must not forgive wrong ones');
});

test('isRecoveredValue forgives only absent top-level fields', () => {
  const { exports: api } = loadUserscript();
  assert.strictEqual(api.isRecoveredValue(null, { a: 1 }), false, 'never stored is not a recovery');
  assert.strictEqual(api.isRecoveredValue({ a: 1 }, { a: 1, b: false }), false, 'an added field');
  assert.strictEqual(api.isRecoveredValue({ a: 'x' }, { a: 1 }), true, 'a changed value');
  assert.strictEqual(api.isRecoveredValue({ a: 1, z: 1 }, { a: 1 }), true, 'a dropped field');
  assert.strictEqual(api.isRecoveredValue('text', { a: 1 }), true, 'not an object at all');
  assert.strictEqual(api.isRecoveredValue({ n: { a: 1 } }, { n: { a: 1, b: 0 } }), true,
    'nested shapes keep the strict comparison');
});

// ---- engine ----------------------------------------------------------------

const PLAIN = Object.freeze({
  button: 0, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, defaultPrevented: false,
});

test('only a plain activation counts', () => {
  const { exports: api } = loadUserscript();
  assert.strictEqual(api.isPlainActivation(Object.assign({}, PLAIN)), true);
  assert.strictEqual(api.isPlainActivation({}), true, 'Enter on a link carries button 0, or none at all');
  for (const k of ['ctrlKey', 'metaKey', 'shiftKey', 'altKey', 'defaultPrevented']) {
    assert.strictEqual(api.isPlainActivation(Object.assign({}, PLAIN, { [k]: true })), false, k);
  }
  assert.strictEqual(api.isPlainActivation(Object.assign({}, PLAIN, { button: 1 })), false, 'middle button');
  assert.strictEqual(api.isPlainActivation(Object.assign({}, PLAIN, { button: 2 })), false, 'right button');
  for (const bad of [null, undefined, 'click', 0, []]) {
    assert.strictEqual(api.isPlainActivation(bad), false, 'not a click: ' + String(bad));
  }
});

test('auto-hide collapses and leaves takeover only when the setting is on', () => {
  // rawExports: the wrapped exports copy return values, and this test is about identity.
  const raw = loadUserscript().rawExports;

  const off = Object.assign(raw.freshSettings(), { autoHideOnOpen: false, takeover: true });
  assert.strictEqual(raw.autoHideSettings(off), off, 'off returns the same object, so nothing is written');

  const on = Object.assign(raw.freshSettings(), { autoHideOnOpen: true, takeover: true });
  const out = raw.autoHideSettings(on);
  assert.notStrictEqual(out, on);
  assert.strictEqual(out.collapsed, true);
  assert.strictEqual(out.takeover, false, 'a collapsed panel in takeover still covers the thread');
  assert.strictEqual(out.autoHideOnOpen, true, 'the setting itself stays on');
  assert.strictEqual(on.collapsed, false, 'the argument is not mutated');
  assert.strictEqual(on.takeover, true, 'the argument is not mutated');

  assert.strictEqual(raw.autoHideSettings(null), null);
  assert.strictEqual(raw.autoHideSettings(undefined), undefined);
});

// ---- markup ----------------------------------------------------------------

test('every thread link in every view carries the marker, and Search on Torn does not', () => {
  // Loops VIEWS, so a view added later (My posts, #2) is held to this too.
  const env = loadUserscript({ location: forums(), now: NOW });
  const api = env.exports;
  api.state.feed.subscribed = [5, 6].map((id) => api.normaliseSubscribedRow({
    id, forum_id: 61, title: 'Thread ' + id,
    author: { id: 3, username: 'someone', karma: 1 },
    posts: { new: 2, total: 10 },
  }));
  api.state.feed.categories = [{ id: 61, title: 'Tutorials', acronym: 'TG' }];
  api.state.drafts = api.saveDraft(api.freshDrafts(), 5, 'a draft', NOW, 'Thread 5');
  api.state.searchQuery = 'thread';
  api.state.searchResults = {
    mode: 'deep', query: 'thread',
    posts: [{ threadId: '6', threadTitle: 'Thread 6', postId: 9, authorName: 'x', at: NOW, text: 'body' }],
  };
  api.recompute(NOW);

  const perView = {};
  for (const view of api.VIEWS) {
    api.state.settings.view = view;
    const html = api.panelHtml(api.buildPanelModel(NOW));
    perView[view] = 0;
    for (const tag of html.match(/<a [^>]*>/g) || []) {
      if (/forums\.php#\/p=threads/.test(tag)) {
        perView[view] += 1;
        assert.match(tag, /data-tfcc-thread="\d+"/, view + ': unmarked thread link ' + tag);
      } else {
        assert.doesNotMatch(tag, /data-tfcc-thread/, view + ': a link that is not a thread is marked ' + tag);
      }
    }
  }
  // The fixture must actually reach every renderer, or the loop proves nothing.
  for (const view of ['threads', 'catchup', 'search', 'drafts']) {
    assert.ok(perView[view] > 0, view + ' rendered no thread link');
  }
  api.state.settings.view = 'search';
  assert.match(api.panelHtml(api.buildPanelModel(NOW)), /class="tfcc-linkbtn"/, 'Search on Torn was rendered and checked');
});

// ---- runtime: the click ------------------------------------------------------

function loaded(settings, hash) {
  const gmStore = settings ? [['tfcc:settings', JSON.stringify(Object.assign({ v: 1 }, settings))]] : [];
  return loadUserscript({ location: forums({ hash: hash || '#/p=forums&f=61' }), now: NOW, gmStore });
}

function threadLink(env, id, parent) {
  const a = env.makeElement('a');
  a.setAttribute('data-tfcc-thread', String(id));
  a.parentNode = parent;
  return a;
}

function click(target, extra) {
  return Object.assign({ type: 'click', target }, PLAIN, extra || {});
}

test('a fresh install collapses on a plain thread click, because the default is on (#30)', () => {
  const env = loaded(null);
  const panel = panelOf(env);
  panel.dispatchEvent(click(threadLink(env, 5, panel)));
  assert.strictEqual(storedSettings(env).collapsed, true);
});

test('a plain click on a panel thread link persists collapsed before navigation', () => {
  const env = loaded({ autoHideOnOpen: true });
  const panel = panelOf(env);
  assert.ok(panel, 'the panel mounted');
  assert.match(panel.innerHTML, /data-act="view"/, 'precondition: the panel is open');

  panel.dispatchEvent(click(threadLink(env, 5, panel)));

  // No timer has run yet. This is the moment the browser follows the link, so
  // a full page load from here must already find the panel hidden.
  assert.strictEqual(storedSettings(env).collapsed, true);
  assert.strictEqual(env.exports.state.settings.collapsed, true);

  env.advanceTimersBy(0);
  assert.doesNotMatch(panel.innerHTML, /data-act="view"/, 'only the header remains');
  assert.match(panel.innerHTML, /data-act="collapse">Show</);
});

test('with the setting off a thread link click changes nothing', () => {
  const env = loaded({ autoHideOnOpen: false });
  const panel = panelOf(env);
  const before = env.gmStore.get('tfcc:settings');

  panel.dispatchEvent(click(threadLink(env, 5, panel)));
  env.advanceTimersBy(1000);

  assert.strictEqual(env.exports.state.settings.collapsed, false);
  assert.strictEqual(env.gmStore.get('tfcc:settings'), before, 'nothing was written');
  assert.match(panel.innerHTML, /data-act="view"/);
});

test('a new-tab click, a middle click and a prevented click change nothing', () => {
  const cases = [{ ctrlKey: true }, { metaKey: true }, { shiftKey: true }, { altKey: true },
    { button: 1 }, { defaultPrevented: true }];
  for (const extra of cases) {
    const env = loaded({ autoHideOnOpen: true });
    const panel = panelOf(env);
    panel.dispatchEvent(click(threadLink(env, 5, panel), extra));
    env.advanceTimersBy(1000);
    assert.strictEqual(env.exports.state.settings.collapsed, false, JSON.stringify(extra));
    // The seeded blob has no collapsed key and nothing persists, so assert "not true", not "false".
    assert.notStrictEqual(storedSettings(env).collapsed, true, JSON.stringify(extra));
  }
});

test('opening a thread from takeover leaves takeover', () => {
  const env = loaded({ autoHideOnOpen: true, takeover: true });
  const panel = panelOf(env);
  assert.strictEqual(panel.classList.contains('tfcc-takeover'), true, 'precondition');

  panel.dispatchEvent(click(threadLink(env, 5, panel)));
  assert.strictEqual(storedSettings(env).takeover, false);

  env.advanceTimersBy(0);
  assert.strictEqual(panel.classList.contains('tfcc-takeover'), false,
    'a collapsed panel in takeover would still cover the thread');
});

test('controls still dispatch, and a link that is not a thread does not collapse', () => {
  const env = loaded({ autoHideOnOpen: true });
  const panel = panelOf(env);

  const button = env.makeElement('button');
  button.setAttribute('data-act', 'unread-only');
  button.parentNode = panel;
  panel.dispatchEvent(click(button));
  assert.strictEqual(env.exports.state.settings.unreadOnly, true, 'data-act clicks are untouched');

  const searchOnTorn = env.makeElement('a');
  searchOnTorn.setAttribute('class', 'tfcc-linkbtn');
  searchOnTorn.parentNode = panel;
  panel.dispatchEvent(click(searchOnTorn));
  env.advanceTimersBy(0);
  assert.strictEqual(env.exports.state.settings.collapsed, false);
});

test('the inline priority buttons beside a title dispatch and never collapse the panel (#30)', () => {
  const env = loaded({ autoHideOnOpen: true });
  const panel = panelOf(env);
  // The real shape: the buttons are siblings of the title span inside the
  // row's main line, never inside the marked anchor.
  const main = env.makeElement('div');
  main.parentNode = panel;
  threadLink(env, 5, main);
  for (const act of ['prio-up', 'prio-up', 'prio-down']) {
    const b = env.makeElement('button');
    b.setAttribute('data-act', act);
    b.setAttribute('data-id', '5');
    b.parentNode = main;
    panel.dispatchEvent(click(b));
  }
  env.advanceTimersBy(0);
  assert.strictEqual(env.exports.state.organizer.threads['5'].priority, 1, 'the existing handlers ran');
  assert.strictEqual(env.exports.state.settings.collapsed, false, 'a priority click is not a thread click');
  assert.notStrictEqual(storedSettings(env).collapsed, true);
});

test('clicking the thread you are already on collapses without a hash change', () => {
  // Same href as the current hash: the browser fires no hashchange, so the
  // deferred redraw is the only thing that can draw the collapsed panel.
  const env = loaded({ autoHideOnOpen: true }, THREAD_HASH);
  const panel = panelOf(env);
  panel.dispatchEvent(click(threadLink(env, 5, panel)));
  env.advanceTimersBy(0);
  assert.doesNotMatch(panel.innerHTML, /data-act="view"/);
});

test('a hash change into the thread after the click keeps the panel collapsed', () => {
  const env = loaded({ autoHideOnOpen: true });
  const panel = panelOf(env);
  panel.dispatchEvent(click(threadLink(env, 5, panel)));

  env.advanceTimersBy(0);
  const drawn = panel.renderCount;
  env.win.location.hash = THREAD_HASH;
  env.win.fire('hashchange');
  env.advanceTimersBy(1000);
  assert.strictEqual(panel.renderCount, drawn, 'the collapsed header was already drawn, so the route draw writes nothing');

  assert.strictEqual(env.exports.state.route.isThread, true, 'the route followed the hash');
  assert.strictEqual(env.exports.state.settings.collapsed, true);
  assert.doesNotMatch(panel.innerHTML, /data-act="view"/);
});

test('a reload after the click arrives already hidden', () => {
  const env = loaded({ autoHideOnOpen: true });
  panelOf(env).dispatchEvent(click(threadLink(env, 5, panelOf(env))));

  const again = loadUserscript({
    location: forums({ hash: THREAD_HASH }), now: NOW,
    gmStore: [['tfcc:settings', env.gmStore.get('tfcc:settings')]],
  });
  assert.strictEqual(again.exports.state.settings.collapsed, true);
  assert.strictEqual(again.exports.state.settings.autoHideOnOpen, true);
  assert.doesNotMatch(panelOf(again).innerHTML, /data-act="view"/);
});

test('the link walk finds our marked anchor and never reads past the panel', () => {
  const env = loaded(null);
  const find = env.rawExports.threadLinkOf;
  const panel = panelOf(env);

  const a = threadLink(env, 5, panel);
  const span = env.makeElement('span');
  span.parentNode = a;
  assert.strictEqual(find(a, panel), a);
  assert.strictEqual(find(span, panel), a, 'a click on text inside the link');
  assert.strictEqual(find({ parentNode: a }, panel), a, 'a node with no getAttribute is stepped over');

  // A marked element above the panel must be invisible to the walk.
  const outside = env.makeElement('div');
  outside.setAttribute('data-tfcc-thread', '9');
  const otherPanel = env.makeElement('div');
  otherPanel.parentNode = outside;
  const inner = env.makeElement('span');
  inner.parentNode = otherPanel;
  assert.strictEqual(find(inner, otherPanel), null);

  // The walk is bounded.
  let node = env.makeElement('a');
  node.setAttribute('data-tfcc-thread', '1');
  for (let i = 0; i < 6; i += 1) {
    const child = env.makeElement('span');
    child.parentNode = node;
    node = child;
  }
  assert.strictEqual(find(node, panel), null);

  assert.strictEqual(find(null, panel), null);
  assert.strictEqual(find(undefined, panel), null);
  assert.strictEqual(find({}, panel), null);
});

// ---- settings view -------------------------------------------------------------

test('the Settings checkbox shows the setting and saves a change', () => {
  const env = loadUserscript({ location: forums(), now: NOW });
  const api = env.exports;
  api.state.settings.view = 'settings';

  let html = api.panelHtml(api.buildPanelModel(NOW));
  assert.match(html, /<label for="tfcc-autohide">Hide the panel when I open a thread<\/label>/);
  assert.match(html, /<input id="tfcc-autohide" type="checkbox" data-act="auto-hide" checked>/, 'checked by default (#30)');
  assert.match(html, /Only thread links in this panel do this, and only a plain click\./);

  const handlers = api.makeHandlers(env.doc, env.win);
  handlers.onChange('auto-hide', { getAttribute: () => null, checked: false, value: '' });
  assert.strictEqual(storedSettings(env).autoHideOnOpen, false, 'unticking is saved');
  html = api.panelHtml(api.buildPanelModel(NOW));
  assert.match(html, /<input id="tfcc-autohide" type="checkbox" data-act="auto-hide">/);

  handlers.onChange('auto-hide', { getAttribute: () => null, checked: true, value: 'on' });
  assert.strictEqual(api.state.settings.autoHideOnOpen, true);
  assert.strictEqual(storedSettings(env).autoHideOnOpen, true, 'a change the user made must survive a reload');

  html = api.panelHtml(api.buildPanelModel(NOW));
  assert.match(html, /data-act="auto-hide" checked>/);

  handlers.onChange('auto-hide', { getAttribute: () => null, checked: false, value: '' });
  assert.strictEqual(storedSettings(env).autoHideOnOpen, false);
});

test('auto-hide closes the drawer, the filters and the info (#33)', () => {
  const env = loaded({ autoHideOnOpen: true });
  const panel = panelOf(env);
  Object.assign(env.exports.state, { openRowId: '5', filtersOpen: true, openInfoId: 'catchup' });
  panel.dispatchEvent(click(threadLink(env, 5, panel)));
  assert.strictEqual(storedSettings(env).collapsed, true);
  assert.strictEqual(env.exports.state.openRowId, null);
  assert.strictEqual(env.exports.state.filtersOpen, false);
  assert.strictEqual(env.exports.state.openInfoId, null);
});

test('Read and Actions are not thread links, so they never auto-hide (#33)', () => {
  const env = loaded({ autoHideOnOpen: true });
  const panel = panelOf(env);
  const row = env.makeElement('div');
  row.parentNode = panel;
  for (const act of ['row-more', 'read']) {
    const b = env.makeElement('button');
    b.setAttribute('data-act', act);
    b.setAttribute('data-id', '5');
    b.parentNode = row;
    assert.strictEqual(env.exports.threadLinkOf(b, panel), null, act);
    panel.dispatchEvent(click(b));
  }
  assert.notStrictEqual(storedSettings(env).collapsed, true);
});
