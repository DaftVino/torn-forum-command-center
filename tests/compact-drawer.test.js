'use strict';

// #43: the compact drawer (inline priority, the tag and note popups), hover
// notes on every icon-only button, and the bare info icon.

const test = require('node:test');
const assert = require('node:assert');
const { NOW, bootNarrow, seedRows, panelOf, redraw, click } = require('./narrow-helpers');

// Every <button> in some markup, with its opening tag and its inner HTML.
function buttons(html) {
  const out = [];
  const re = /<button\b([^>]*)>([\s\S]*?)<\/button>/g;
  let m;
  while ((m = re.exec(html))) out.push({ attrs: m[1], inner: m[2] });
  return out;
}

// The words a sighted user reads on a button: its text, minus anything
// aria-hidden (icons, emoji) and visually hidden.
function visibleText(inner) {
  return inner
    .replace(/<svg[\s\S]*?<\/svg>/g, '')
    .replace(/<span[^>]*aria-hidden="true"[^>]*>[\s\S]*?<\/span>/g, '')
    .replace(/<[^>]+>/g, '')
    .trim();
}

function everyState() {
  const pages = [];
  for (const width of [343, 900]) {
    const { env, api } = bootNarrow({ width });
    seedRows(api, [{ id: 1, title: 'One', unread: 2 }, { id: 2, title: 'Two', unread: 1 }]);
    for (const view of api.VIEWS) {
      api.state.settings.view = view;
      api.state.openRowId = null;
      pages.push([width + ' ' + view, redraw(env)]);
      if (view === 'threads' || view === 'catchup') {
        api.state.openRowId = '1';
        pages.push([width + ' ' + view + ' open', redraw(env)]);
      }
    }
    api.state.settings.view = 'threads';
    api.state.settings.takeover = true;
    api.state.refreshing = true;
    pages.push([width + ' takeover', redraw(env)]);
    api.state.settings.takeover = false;
    api.state.refreshing = false;
    api.state.settings.collapsed = true;
    pages.push([width + ' collapsed', redraw(env)]);
  }
  return pages;
}

test('every icon-only button in the panel has a non-empty hover note (#43)', () => {
  let icons = 0;
  for (const [name, html] of everyState()) {
    for (const b of buttons(html)) {
      if (visibleText(b.inner) !== '') continue;
      icons += 1;
      const t = / title="([^"]*)"/.exec(b.attrs);
      assert.ok(t && t[1].trim() !== '', name + ': an icon-only button has no title: <button' + b.attrs + '>');
    }
  }
  assert.ok(icons > 10, 'the states render icon-only buttons (' + icons + ')');
});

test('the drawer\'s Mark read check mark is hinted "Mark read", like its name (#43)', () => {
  const { env, api } = bootNarrow();
  seedRows(api, [{ id: 7, title: 'Seven', unread: 1 }]);
  api.state.openRowId = '7';
  const html = redraw(env);
  const drawer = html.slice(html.indexOf('id="tfcc-act-7"'));
  assert.match(drawer, /data-act="read" data-id="7" aria-label="Mark read" title="Mark read"/);
});

