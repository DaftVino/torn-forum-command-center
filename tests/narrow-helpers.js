'use strict';

// Shared by the #33 suites. Not a .test.js file, so npm test does not run it.

const assert = require('node:assert');
const { loadUserscript, FORUMS_LOCATION } = require('./load-userscript');

const NOW = 1700000000000;

// Boots the runtime on forums.php. width is the panel's border-box width: 343
// is a 375px phone in a 16px gutter, 288 is 320px, 248 is 280px, 900 is wide.
function bootNarrow(opts = {}) {
  const env = loadUserscript(Object.assign({
    location: Object.assign({}, FORUMS_LOCATION, opts.hash ? { hash: opts.hash } : {}),
    now: NOW,
    panelWidth: opts.width === undefined ? 343 : opts.width,
    panelPadding: 8,
    htmlQuery: true,
  }, opts.env || {}));
  return { env, api: env.exports };
}

// rows: [{ id, title, unread }]. Ids become strings in the merged rows.
function seedRows(api, rows) {
  api.state.feed.subscribed = rows.map((r) => api.normaliseSubscribedRow({
    id: r.id, forum_id: 61, title: r.title || ('Thread ' + r.id),
    author: { id: 3, username: 'someone', karma: 1 },
    posts: { new: r.unread || 0, total: 10 },
  }));
  api.state.feed.categories = [{ id: 61, title: 'Tutorials and Guides', acronym: 'TG' }];
  api.state.settings.rowsShown = 0;
  api.recompute(NOW);
}

function panelOf(env) { return env.doc.getElementById('tfcc-panel'); }

function redraw(env) {
  env.exports.draw(env.doc, env.win, env.exports.makeHandlers(env.doc, env.win), true);
  return panelOf(env).innerHTML;
}

// What a sighted user sees: drop every closed explanation, every closed drawer
// and the closed filter grid.
function visible(html) {
  return html
    .replace(/<p class="tfcc-note tfcc-infotext" id="[^"]*" hidden>[\s\S]*?<\/p>/g, '')
    .replace(/<div class="tfcc-filtergrid" id="tfcc-filters" hidden>[\s\S]*?<\/div>/g, '')
    .replace(/<span class="tfcc-sr">[\s\S]*?<\/span>/g, '')
    .replace(/<h3 class="tfcc-vh tfcc-sr"[\s\S]*?<\/h3>/g, '');
}

// A real tap: the delegated listener on the panel receives the event.
function click(env, sel) {
  const panel = panelOf(env);
  const t = panel.querySelector(sel);
  assert.ok(t, 'nothing rendered for ' + sel);
  panel.dispatchEvent({ type: 'click', target: t, button: 0 });
  return t;
}

function lastFocus(env) {
  return env.focusLog.length ? env.focusLog[env.focusLog.length - 1] : null;
}

module.exports = { NOW, bootNarrow, seedRows, panelOf, redraw, visible, click, lastFocus };
