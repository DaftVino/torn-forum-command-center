'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { loadUserscript, FORUMS_LOCATION } = require('./load-userscript');

function forums(extra) {
  return Object.assign({}, FORUMS_LOCATION, extra || {});
}

function panelsIn(env) {
  return env.createdElements.filter((el) => el.id === 'tfcc-panel' && el.isConnected !== false);
}

test('a usable DOM at evaluation starts the script straight away', () => {
  const env = loadUserscript({ location: forums() });
  let ran = 0;
  env.exports.whenDocumentReady(env.doc, env.win, () => { ran += 1; });
  assert.strictEqual(ran, 1);
});

test('a DOM that arrives later still starts the script, with no navigation event', () => {
  // This is the Torn PDA failure shape: the webview evaluates the script before
  // body and documentElement exist, and nothing ever fires a route event.
  const env = loadUserscript({ location: forums() });
  const doc = {
    documentElement: null,
    body: null,
    addEventListener: env.doc.addEventListener,
    removeEventListener: env.doc.removeEventListener,
  };

  let ran = 0;
  env.exports.whenDocumentReady(doc, env.win, () => { ran += 1; });
  assert.strictEqual(ran, 0, 'nothing should run against a page that is not there');

  doc.documentElement = {};
  doc.body = {};
  env.advanceTimersBy(300);
  assert.strictEqual(ran, 1, 'the bounded poll is what rescues this case');
});

test('every readiness path firing together still starts the script exactly once', () => {
  const env = loadUserscript({ location: forums() });
  let ran = 0;
  env.exports.whenDocumentReady(env.doc, env.win, () => { ran += 1; });
  env.doc.fire('DOMContentLoaded');
  env.win.fire('load');
  env.advanceTimersBy(5000);
  assert.strictEqual(ran, 1);
});

test('a DOM that never arrives leaves no unbounded timer and never throws', () => {
  const env = loadUserscript({ location: forums() });
  const doc = { documentElement: null, body: null, addEventListener() {}, removeEventListener() {} };
  let ran = 0;
  assert.doesNotThrow(() => env.exports.whenDocumentReady(doc, env.win, () => { ran += 1; }));

  env.advanceTimersBy(1000 * 60 * 5);
  assert.strictEqual(ran, 0);
  // The badges dwell tick (issue #9) is expected to run while on forums.php;
  // it is not a readiness timer, so it is stopped before counting what is left.
  env.exports.stopDwell();
  assert.strictEqual(env.pendingTimerCount(), 0, 'the poll must give up rather than spin forever');
});

test('a callback that throws does not escape onto Torn page', () => {
  const env = loadUserscript({ location: forums() });
  assert.doesNotThrow(() => {
    env.exports.whenDocumentReady(env.doc, env.win, () => { throw new Error('boom'); });
  });
});

test('readiness listeners are cleaned up once it has started', () => {
  const env = loadUserscript({ location: forums() });
  const doc = { documentElement: null, body: null, ...{} };
  const listeners = {};
  doc.addEventListener = (t, fn) => { (listeners[t] = listeners[t] || []).push(fn); };
  doc.removeEventListener = (t, fn) => {
    const i = (listeners[t] || []).indexOf(fn);
    if (i !== -1) listeners[t].splice(i, 1);
  };

  env.exports.whenDocumentReady(doc, env.win, () => {});
  assert.strictEqual(listeners.DOMContentLoaded.length, 1);

  doc.documentElement = {};
  doc.body = {};
  env.advanceTimersBy(300);
  assert.strictEqual(listeners.DOMContentLoaded.length, 0, 'a started script should not keep listening');
});

test('navigation is observed once, however many times it is installed', () => {
  // Loaded off the forums route on purpose: on a forums URL the bootstrap has
  // already installed the observer, so a manual call would correctly be a
  // no-op and this test would prove nothing about the guard itself.
  const env = loadUserscript();
  let routes = 0;
  const onRoute = () => { routes += 1; };

  env.exports.observeNavigation(env.doc, env.win, onRoute);
  env.exports.observeNavigation(env.doc, env.win, onRoute);
  env.exports.observeNavigation(env.doc, env.win, onRoute);

  assert.strictEqual(env.observers.length, 1, 'a second install would double every redraw');
  assert.strictEqual((env.win.listeners.hashchange || []).length, 1);
});

test('a hash change, a popstate and a history call all reach the route handler', () => {
  const env = loadUserscript();
  let routes = 0;
  env.exports.observeNavigation(env.doc, env.win, () => { routes += 1; });

  env.win.fire('hashchange');
  env.advanceTimersBy(200);
  assert.strictEqual(routes, 1, 'hashchange is how the forum SPA moves');

  env.win.fire('popstate');
  env.advanceTimersBy(200);
  assert.strictEqual(routes, 2);

  env.win.history.pushState({}, '', '/forums.php#/p=threads&t=5');
  env.advanceTimersBy(200);
  assert.strictEqual(routes, 3);
});

test('a burst of mutations is debounced into one redraw', () => {
  const env = loadUserscript();
  let routes = 0;
  env.exports.observeNavigation(env.doc, env.win, () => { routes += 1; });

  for (let i = 0; i < 20; i += 1) env.observers[0].cb([], env.observers[0]);
  env.advanceTimersBy(500);
  assert.strictEqual(routes, 1, "Torn's React tree churns; one redraw is the answer");
});

test('a route handler that throws does not escape', () => {
  const env = loadUserscript({ location: forums() });
  env.exports.observeNavigation(env.doc, env.win, () => { throw new Error('boom'); });
  env.win.fire('hashchange');
  assert.doesNotThrow(() => env.advanceTimersBy(500));
});

test('a frozen history does not stop navigation being observed', () => {
  // History patching is defensive hardening. It must never be the reason the
  // panel fails to appear.
  const env = loadUserscript({
    history: Object.freeze({ pushState() {}, replaceState() {} }),
  });
  let routes = 0;
  assert.doesNotThrow(() => env.exports.observeNavigation(env.doc, env.win, () => { routes += 1; }));

  env.win.fire('hashchange');
  env.advanceTimersBy(200);
  assert.strictEqual(routes, 1, 'the direct route still works without history hooks');
});

test('the script mounts exactly one panel on the forums page', () => {
  const env = loadUserscript({ location: forums() });
  assert.strictEqual(panelsIn(env).length, 1);
  assert.strictEqual(env.exports.state.mounted, true);
});

test('repeated route syncs never stack a second panel', () => {
  const env = loadUserscript({ location: forums({ hash: '#/p=threads&t=1' }) });
  for (let i = 0; i < 5; i += 1) env.exports.syncToRoute(env.doc, env.win);
  assert.strictEqual(panelsIn(env).length, 1);
});

test('leaving forums.php unmounts the panel and its fallback', () => {
  const env = loadUserscript({ location: forums() });
  assert.strictEqual(panelsIn(env).length, 1);

  env.win.location.pathname = '/index.php';
  env.exports.syncToRoute(env.doc, env.win);

  assert.strictEqual(panelsIn(env).length, 0);
  assert.strictEqual(env.doc.getElementById('tfcc-fallback-mount'), null);
});

test('with no known container the panel goes into an owned fallback, never stacked', () => {
  const env = loadUserscript({ location: forums() });
  assert.ok(env.doc.getElementById('tfcc-fallback-mount'), 'no Torn container was offered, so we own one');

  for (let i = 0; i < 3; i += 1) env.exports.syncToRoute(env.doc, env.win);
  const fallbacks = env.createdElements.filter((el) => el.id === 'tfcc-fallback-mount' && el.isConnected !== false);
  assert.strictEqual(fallbacks.length, 1);
});

test('a known Torn container is preferred over the fallback', () => {
  const host = { isConnected: true, children: [], appendChild(c) { this.children.push(c); return c; }, insertBefore(c) { this.children.unshift(c); return c; } };
  const env = loadUserscript({ location: forums(), selectors: { '#forums-page-wrap': host } });
  assert.strictEqual(env.exports.findMountPoint(env.doc).host, host);
  assert.strictEqual(env.exports.findMountPoint(env.doc).owned, false);
});

test('a detached container is rejected in favour of the fallback', () => {
  const host = { isConnected: false };
  const env = loadUserscript({ location: forums(), selectors: { '#forums-page-wrap': host } });
  const mount = env.exports.findMountPoint(env.doc);
  assert.strictEqual(mount.owned, true, 'Torn replaced its own node mid-render');
});

test('a querySelector that throws falls through to the fallback rather than failing', () => {
  const env = loadUserscript({ location: forums() });
  env.doc.querySelector = () => { throw new Error('Torn changed something'); };
  assert.doesNotThrow(() => env.exports.findMountPoint(env.doc));
  assert.strictEqual(env.exports.findMountPoint(env.doc).owned, true);
});

test('the mount selector list is ordered most specific first', () => {
  const { exports: api } = loadUserscript();
  assert.strictEqual(api.MOUNT_SELECTORS[0], '#forums-page-wrap');
  assert.ok(api.MOUNT_SELECTORS.length >= 3, 'one guess is not a fallback strategy');
});

// ---- one status message at a time (#58) ----------------------------------

test('a new notice replaces the previous one; an info in a new action replaces an ordinary error', () => {
  const env = loadUserscript({ location: forums() });
  const api = env.exports;
  api.state.notices = [];
  api.notice('first', 'warn');
  api.notice('boom', 'error');
  assert.strictEqual(api.state.notices.map((n) => n.text).join('|'), 'boom');
  api.notice('all fine', 'info');
  assert.strictEqual(api.state.notices.map((n) => n.text).join('|'), 'all fine');
  assert.strictEqual(api.state.notices.length, 1);
});

// ---- a failed write is never hidden by its own action's success ---------

const NOW = 1700000000000;
const THREAD = forums({ hash: '#/p=threads&f=1&t=42&b=0&a=0' });
const el = (attrs) => ({ getAttribute: (k) => (attrs[k] === undefined ? null : attrs[k]) });
const shown = (api) => api.state.notices.map((n) => n.kind + ':' + n.text).join('|');

test('an info after a failed write in the same action is dropped; the next action may replace the error', () => {
  const env = loadUserscript({ location: forums(), gmWriteErrors: new Set(['tfcc:postcache']) });
  const api = env.exports;
  const h = api.makeHandlers(env.doc, env.win);
  h.onAction('clear-cache', el({ 'data-act': 'clear-cache' }));
  assert.strictEqual(api.state.notices.length, 1);
  assert.strictEqual(api.state.notices[0].kind, 'error', shown(api));
  assert.doesNotMatch(shown(api), /Post cache cleared/);
  // A later, unrelated action that saves fine says so over the old error.
  h.onAction('key-clear', el({ 'data-act': 'key-clear' }));
  assert.match(shown(api), /^info:Key cleared\.$/);
});

test('a warning after a failed write in the same action still replaces it', () => {
  const env = loadUserscript({ location: forums(), gmWriteErrors: new Set(['tfcc:postcache']) });
  const api = env.exports;
  const h = api.makeHandlers(env.doc, env.win);
  h.onAction('clear-cache', el({ 'data-act': 'clear-cache' }));
  api.notice('a warning', 'warn');
  assert.match(shown(api), /^warn:a warning$/);
});

test('Fix image links that cannot save keeps the error, not "Fixed 1 image link"', () => {
  const env = loadUserscript({ location: THREAD, now: NOW, gmWriteErrors: new Set(['tfcc:drafts']) });
  const api = env.exports;
  api.state.route = api.parseForumRoute(env.win.location);
  api.state.settings.view = 'drafts';
  api.state.drafts = api.saveDraft(api.freshDrafts(), 42, '![a](https://imgur.com/AbC12dE)', NOW, 'T', 'md');
  api.panelHtml(api.buildPanelModel(NOW));
  const h = api.makeHandlers(env.doc, env.win);
  h.onAction('ed-fix-all', el({ 'data-act': 'ed-fix-all' }));
  assert.notStrictEqual(api.state.editor.text, '![a](https://imgur.com/AbC12dE)', 'the fix was made');
  assert.strictEqual(api.state.notices.length, 1);
  assert.strictEqual(api.state.notices[0].kind, 'error', shown(api));
  assert.doesNotMatch(shown(api), /Fixed/);
});

test('an Import that cannot save keeps the error, not "Imported ..."', () => {
  const env = loadUserscript({ location: forums(), gmWriteErrors: new Set(['tfcc:organizer']) });
  const api = env.exports;
  let o = api.freshOrganizer(NOW);
  o = api.upsertFolder(o, { id: 'mine', name: 'My folder', order: 5, forumIds: [] });
  const text = api.encodeState(o, api.freshDrafts(), env.sandbox.btoa);
  const q = env.doc.querySelector;
  env.doc.querySelector = (sel) => (sel === '[data-act="import-text"]' ? { value: text } : q.call(env.doc, sel));
  const h = api.makeHandlers(env.doc, env.win);
  h.onAction('import', el({ 'data-act': 'import' }));
  assert.ok(api.state.organizer.folders.some((f) => f.id === 'mine'), 'the import was applied in memory');
  assert.strictEqual(api.state.notices.length, 1);
  assert.strictEqual(api.state.notices[0].kind, 'error', shown(api));
  assert.doesNotMatch(shown(api), /Imported/);
});

test('Insert after a save that failed keeps the error, not "Post inserted"', () => {
  const env = loadUserscript({ location: THREAD, now: NOW, gmWriteErrors: new Set(['tfcc:drafts']) });
  const api = env.exports;
  api.state.route = api.parseForumRoute(env.win.location);
  api.state.settings.view = 'drafts';
  api.panelHtml(api.buildPanelModel(NOW));
  // A visible TinyMCE body that accepts the marked paste, so Insert succeeds.
  const box = env.makeElement('div');
  box.getBoundingClientRect = () => ({ width: 600, height: 160 });
  box.innerHTML = '<p><br data-mce-bogus="1"></p>';
  box.addEventListener('paste', (ev) => {
    const html = ev.clipboardData.getData('text/html');
    ev.preventDefault();
    box.innerHTML += html.slice('<!-- x-tinymce/html -->'.length);
  });
  env.doc.querySelectorAll = (sel) => (/mce-content-body/.test(sel) ? [box] : []);
  const h = api.makeHandlers(env.doc, env.win);
  h.onInput('draft-text', Object.assign(el({ 'data-act': 'draft-text', 'data-id': '42' }), { value: 'words', selectionStart: 5, selectionEnd: 5 }));
  h.onAction('draft-insert', el({ 'data-act': 'draft-insert', 'data-id': '42' }));
  assert.match(box.innerHTML, /words/, 'the insert itself happened');
  assert.strictEqual(api.state.notices.length, 1);
  assert.strictEqual(api.state.notices[0].kind, 'error', shown(api));
  assert.doesNotMatch(shown(api), /Post inserted/);
});

test('a panel view change clears the notice; tapping the current view keeps it', () => {
  const env = loadUserscript({ location: forums() });
  const api = env.exports;
  const h = api.makeHandlers(env.doc, env.win);
  api.state.settings.view = 'threads';
  api.notice('stale words', 'warn');
  h.onAction('view', el({ 'data-act': 'view', 'data-view': 'threads' }));
  assert.strictEqual(api.state.notices.length, 1, 'same view');
  h.onAction('view', el({ 'data-act': 'view', 'data-view': 'settings' }));
  assert.strictEqual(api.state.settings.view, 'settings');
  assert.strictEqual(api.state.notices.length, 0, 'another view');
});

test('navigating to another thread clears the notice, a re-sync of the same route keeps it', () => {
  const env = loadUserscript({ location: forums({ hash: '#/p=threads&f=1&t=1' }) });
  const api = env.exports;
  api.notice('stale words', 'warn');
  api.syncToRoute(env.doc, env.win);
  assert.strictEqual(api.state.notices.length, 1, 'same route');
  env.win.location.hash = '#/p=threads&f=1&t=2';
  api.syncToRoute(env.doc, env.win);
  assert.strictEqual(api.state.notices.length, 0, 'another thread');
});

test('leaving the forums page clears the notice', () => {
  const env = loadUserscript({ location: forums() });
  const api = env.exports;
  api.notice('stale words', 'error');
  env.win.location.pathname = '/index.php';
  api.syncToRoute(env.doc, env.win);
  assert.strictEqual(api.state.notices.length, 0);
});
