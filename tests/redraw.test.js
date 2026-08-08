'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { loadUserscript, FORUMS_LOCATION } = require('./load-userscript');

const NOW = 1700000000000;

function forums(extra) {
  return Object.assign({}, FORUMS_LOCATION, extra || {});
}

function panelOf(env) {
  return env.doc.getElementById('tfcc-panel');
}

function renders(env) {
  const p = panelOf(env);
  return p ? (p.renderCount || 0) : 0;
}

test('the panel does not redraw itself in a loop', () => {
  // The bug this exists for: observeNavigation watched documentElement with
  // subtree: true, and renderPanel writes panel.innerHTML. The panel is inside
  // that subtree, so every render scheduled another one, forever, every 150ms.
  //
  // A user cannot type into a text box that is being replaced three times a
  // second, and a click lands on a node that is gone by the time it resolves.
  const env = loadUserscript({ location: forums(), now: NOW });
  const before = renders(env);

  env.advanceTimersBy(10000);

  const after = renders(env);
  assert.ok(after - before <= 1,
    'the panel redrew ' + (after - before) + ' times in ten idle seconds');
});

test('Torn mutating its own page does not rewrite the panel', () => {
  // Torn's React tree churns constantly. Reacting to that by replacing the
  // whole panel is what destroys focus, so an unchanged route must not redraw.
  const env = loadUserscript({ location: forums(), now: NOW });
  const before = renders(env);

  for (let i = 0; i < 20; i += 1) {
    for (const o of env.observers) {
      if (!o.disconnected && typeof o.cb === 'function') o.cb([{ type: 'childList', target: env.body }], o);
    }
    env.advanceTimersBy(200);
  }

  assert.strictEqual(renders(env), before, 'Torn page churn rewrote our panel');
});

test('a real route change does redraw', () => {
  // The guard must not go so far that the panel stops following the user.
  const env = loadUserscript({ location: forums({ hash: '#/p=forums&f=61' }), now: NOW });
  const before = renders(env);

  env.win.location.hash = '#/p=threads&f=61&t=12345';
  env.win.fire('hashchange');
  env.advanceTimersBy(500);

  assert.ok(renders(env) > before, 'the panel did not follow a route change');
});

test('a redraw with identical content does not touch the DOM', () => {
  // Writing the same string still destroys every node under it, and with them
  // the caret, the selection and any half-typed value.
  const env = loadUserscript({ location: forums(), now: NOW });
  const handlers = env.exports.makeHandlers(env.doc, env.win);
  const before = renders(env);

  for (let i = 0; i < 5; i += 1) env.exports.draw(env.doc, env.win, handlers);
  assert.strictEqual(renders(env), before, 'an unchanged panel was rewritten anyway');
});

test('a redraw that changes something still happens', () => {
  const env = loadUserscript({ location: forums(), now: NOW });
  const handlers = env.exports.makeHandlers(env.doc, env.win);
  const before = renders(env);

  env.exports.state.settings.view = 'settings';
  env.exports.draw(env.doc, env.win, handlers);
  assert.ok(renders(env) > before, 'a real change must reach the screen');
});

test('typing is not interrupted by a background redraw', () => {
  // The reported symptom: click into the API key box and the caret vanishes.
  // A background redraw while an input inside the panel has focus must be
  // deferred, because the value the user is typing is not in the model yet and
  // re-rendering would throw it away along with the caret.
  const env = loadUserscript({ location: forums(), now: NOW });
  const handlers = env.exports.makeHandlers(env.doc, env.win);

  const input = env.makeElement('input');
  input.setAttribute('data-act', 'key-input');
  input.value = 'half-typed-key';
  env.doc.activeElement = input;
  panelOf(env).contains = () => true;

  const before = renders(env);
  env.exports.state.settings.view = 'settings';
  env.exports.draw(env.doc, env.win, handlers);

  assert.strictEqual(renders(env), before, 'a redraw landed while the user was typing');
  assert.strictEqual(input.value, 'half-typed-key');
});

test('the deferred redraw happens once focus leaves', () => {
  const env = loadUserscript({ location: forums(), now: NOW });
  const handlers = env.exports.makeHandlers(env.doc, env.win);

  const input = env.makeElement('input');
  input.setAttribute('data-act', 'key-input');
  env.doc.activeElement = input;
  panelOf(env).contains = () => true;

  env.exports.state.settings.view = 'settings';
  env.exports.draw(env.doc, env.win, handlers);
  const deferred = renders(env);

  // Focus moves away, and the update the user could not be shown arrives.
  env.doc.activeElement = null;
  panelOf(env).contains = () => false;
  env.exports.draw(env.doc, env.win, handlers);

  assert.ok(renders(env) > deferred, 'the deferred update never arrived');
});

test('a user action redraws even while an input has focus', () => {
  // Pressing Save while the caret is still in the key box has to show the
  // result. Only background triggers are deferred.
  const env = loadUserscript({ location: forums(), now: NOW });

  const input = env.makeElement('input');
  input.setAttribute('data-act', 'key-input');
  input.value = 'abcdefghij123456';
  env.doc.activeElement = input;
  panelOf(env).contains = () => true;
  env.doc.querySelector = (sel) => (sel === '[data-act="key-input"]' ? input : null);

  const handlers = env.exports.makeHandlers(env.doc, env.win);
  const before = renders(env);
  handlers.onAction('key-save', { getAttribute: () => null });

  assert.ok(renders(env) > before, 'the user pressed a button and nothing changed on screen');
});

test('the navigation observer ignores our own writes', () => {
  // The structural fix, asserted directly: a mutation whose target is inside
  // the panel must not be treated as page navigation.
  const env = loadUserscript({ location: forums(), now: NOW });
  const panel = panelOf(env);
  const before = renders(env);

  for (const o of env.observers) {
    if (!o.disconnected && typeof o.cb === 'function') o.cb([{ type: 'childList', target: panel }], o);
  }
  env.advanceTimersBy(500);

  assert.strictEqual(renders(env), before, 'our own render was read as navigation');
});

test('leaving a field flushes an update that was held back', () => {
  // pendingRedraw has to be more than a flag. Without a flush the panel would
  // sit stale until the user happened to press something else.
  const env = loadUserscript({ location: forums(), now: NOW });
  const handlers = env.exports.makeHandlers(env.doc, env.win);
  const panel = panelOf(env);

  const input = env.makeElement('input');
  input.setAttribute('data-act', 'key-input');
  env.doc.activeElement = input;
  panel.contains = () => true;

  env.exports.state.settings.view = 'settings';
  env.exports.draw(env.doc, env.win, handlers);
  assert.strictEqual(env.exports.state.pendingRedraw, true, 'the update should be held');
  const held = renders(env);

  // The caret leaves the panel entirely.
  env.doc.activeElement = null;
  panel.contains = () => false;
  panel.dispatchEvent({ type: 'focusout' });
  env.advanceTimersBy(10);

  assert.ok(renders(env) > held, 'the held update never arrived after focus left');
  assert.strictEqual(env.exports.state.pendingRedraw, false);
});

test('moving between two fields does not flush mid-edit', () => {
  const env = loadUserscript({ location: forums(), now: NOW });
  const handlers = env.exports.makeHandlers(env.doc, env.win);
  const panel = panelOf(env);

  const input = env.makeElement('input');
  input.setAttribute('data-act', 'key-input');
  env.doc.activeElement = input;
  panel.contains = () => true;

  env.exports.state.settings.view = 'settings';
  env.exports.draw(env.doc, env.win, handlers);
  const held = renders(env);

  // focusout fires, but the caret landed on another field in the same panel.
  panel.dispatchEvent({ type: 'focusout' });
  env.advanceTimersBy(10);

  assert.strictEqual(renders(env), held, 'the panel redrew while the caret was still in it');
});

test('isOwnMutation tells our nodes from Torn own', () => {
  // Tested directly because the two guards overlap: the identical-render skip
  // hides the loop even with this filter removed, so a test that counts renders
  // cannot tell whether this one is doing anything.
  const env = loadUserscript({ location: forums(), now: NOW });
  const api = env.exports;
  const panel = panelOf(env);
  const style = env.createdElements.find((el) => el.id === 'tfcc-style');

  assert.strictEqual(api.isOwnMutation(env.doc, [{ target: panel }]), true);
  assert.strictEqual(api.isOwnMutation(env.doc, [{ target: style }]), true);

  // A child of the panel counts as ours, which is what a real innerHTML write
  // reports: the target is the container whose children changed.
  panel.contains = (n) => n === panel || n === 'a-child';
  assert.strictEqual(api.isOwnMutation(env.doc, [{ target: 'a-child' }]), true);

  // Anything from Torn is real navigation and must get through.
  assert.strictEqual(api.isOwnMutation(env.doc, [{ target: env.body }]), false);
  assert.strictEqual(api.isOwnMutation(env.doc, [{ target: panel }, { target: env.body }]), false,
    'a mixed batch contains a real change and must not be dropped');

  // Degenerate input never silently swallows a navigation.
  assert.strictEqual(api.isOwnMutation(env.doc, []), false);
  assert.strictEqual(api.isOwnMutation(env.doc, null), false);
  assert.strictEqual(api.isOwnMutation(env.doc, [{}]), false);
});

test('the route handler is not called for our own mutations', () => {
  // The isolating test: count route callbacks, not renders.
  const env = loadUserscript({ now: NOW });
  let routes = 0;
  env.exports.observeNavigation(env.doc, env.win, () => { routes += 1; });

  const observer = env.observers[env.observers.length - 1];
  const ourNode = env.doc.createElement('div');
  ourNode.setAttribute('id', 'tfcc-panel');
  env.doc.body.appendChild(ourNode);

  observer.cb([{ type: 'childList', target: ourNode }], observer);
  env.advanceTimersBy(500);
  assert.strictEqual(routes, 0, 'our own render was treated as navigation');

  observer.cb([{ type: 'childList', target: env.body }], observer);
  env.advanceTimersBy(500);
  assert.strictEqual(routes, 1, 'a real page change must still get through');
});
