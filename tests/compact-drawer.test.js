'use strict';

// #43: the compact drawer (inline priority, the tag and note popups), hover
// notes on every icon-only button, and the bare info icon.

const test = require('node:test');
const assert = require('node:assert');
const { NOW, bootNarrow, seedRows, panelOf, redraw, click, lastFocus } = require('./narrow-helpers');

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

// ---- item 1: priority inline, desktop style ---------------------------------

function drawerRow(api, env, view, id) {
  api.state.settings.view = view;
  api.state.openRowId = id;
  const html = redraw(env);
  const d = html.slice(html.indexOf('id="tfcc-act-' + id + '"'));
  const row = /<div class="tfcc-drawer-btns tfcc-wide">([\s\S]*?)<\/div>/.exec(d);
  assert.ok(row, 'the drawer button row in ' + view);
  return { drawer: d, row: row[1] };
}

test('the drawer shows priority as the number then + and -, on the button row, in Threads and Catch up (#43)', () => {
  const { env, api } = bootNarrow();
  seedRows(api, [{ id: 7, title: 'Seven', unread: 1 }]);
  api.state.organizer = api.setPriority(api.state.organizer, '7', 2);
  api.recompute(NOW);
  for (const view of ['threads', 'catchup']) {
    const { drawer, row } = drawerRow(api, env, view, '7');
    const model = api.buildPanelModel(NOW);
    const wide = api.renderPriority(model.rows.find((r) => r.id === '7'));
    assert.ok(row.endsWith(wide + '</span>'), view + ': the desktop markup, last on the row, right of Archive');
    assert.match(row, /<span class="tfcc-dprio"><button type="button" class="tfcc-info" data-act="info" data-info="priority"[^>]*>[\s\S]*?<\/button><span class="tfcc-prio"/,
      view + ': info, then the number');
    assert.match(row, /<span class="tfcc-prio" title="[^"]+">\+2<\/span><button type="button" data-act="prio-up" data-id="7" class="tfcc-prio-btn" aria-label="Raise priority" title="Raise this thread's priority by 1">\+<\/button><button type="button" data-act="prio-down" data-id="7" class="tfcc-prio-btn" aria-label="Lower priority" title="Lower this thread's priority by 1">-<\/button>/);
    assert.doesNotMatch(drawer, /tfcc-step|Priority \+2/, view + ': the full-width stepper is gone');
  }
});

test('the drawer priority still raises and lowers through the row\'s own actions (#43)', () => {
  const { env, api } = bootNarrow();
  seedRows(api, [{ id: 7, title: 'Seven', unread: 1 }]);
  drawerRow(api, env, 'threads', '7');
  panelOf(env).contains = () => true;
  click(env, '[data-act="prio-up"][data-id="7"]');
  assert.strictEqual(api.state.organizer.threads['7'].priority, 1);
  assert.strictEqual(api.state.openRowId, '7', 'the drawer stays open');
  click(env, '[data-act="prio-down"][data-id="7"]');
  click(env, '[data-act="prio-down"][data-id="7"]');
  assert.strictEqual(api.state.organizer.threads['7'].priority, -1);
});

test('the priority group is pushed right and its targets shrink only to the 24px floor (#43)', () => {
  const { api } = bootNarrow();
  const css = api.panelStyleText();
  assert.match(css, /#tfcc-panel\.tfcc-narrow \.tfcc-dprio \{ display: contents; \}/);
  assert.match(css, /#tfcc-panel\.tfcc-narrow \.tfcc-dprio > :first-child \{ margin-left: auto; \}/);
  assert.match(css, /#tfcc-panel\.tfcc-narrow \.tfcc-drawer-btns button \{[^}]*flex: 0 1 32px;[^}]*min-width: 24px;/);
  assert.doesNotMatch(css, /\.tfcc-step/, 'the stepper rules are gone');
});

test('the drawer\'s Mark read check mark is hinted "Mark read", like its name (#43)', () => {
  const { env, api } = bootNarrow();
  seedRows(api, [{ id: 7, title: 'Seven', unread: 1 }]);
  api.state.openRowId = '7';
  const html = redraw(env);
  const drawer = html.slice(html.indexOf('id="tfcc-act-7"'));
  assert.match(drawer, /data-act="read" data-id="7" aria-label="Mark read" title="Mark read"/);
});

// ---- the bare info icon (owner, #43) ---------------------------------------

function ruleBody(css, sel) {
  const at = css.indexOf(sel + ' {');
  assert.ok(at !== -1, 'no rule for ' + sel);
  return css.slice(at + sel.length + 2, css.indexOf('}', at));
}

test('every info button is a bare icon: no fill, no visible border, the same 44px target (#43)', () => {
  const { api } = bootNarrow();
  const css = api.panelStyleText();
  const base = ruleBody(css, '#tfcc-panel button.tfcc-info');
  assert.match(base, /min-width: 44px; min-height: 44px;/, 'the tap target is kept');
  assert.match(base, /border-color: transparent;/);
  assert.match(base, /background: transparent;/);
  for (const sel of ['#tfcc-panel button.tfcc-info:hover', '#tfcc-panel button.tfcc-info[aria-expanded="true"]']) {
    const body = ruleBody(css, sel);
    assert.match(body, /background: transparent;/, sel + ' brings no box back');
    assert.match(body, /color: var\(--tm-accent-text\);/, sel + ' tints the icon instead');
  }
  // Nothing later gives it a fill or a border again, and focus keeps the ring.
  for (const m of css.matchAll(/([^\n{}]*tfcc-info\b[^{]*)\{([^}]*)\}/g)) {
    if (/tfcc-infotext|tfcc-infobar|tfcc-infogroup/.test(m[1])) continue;
    assert.doesNotMatch(m[2], /background:\s*var|border-color:\s*var|outline:\s*(none|0)/, m[1].trim());
  }
  assert.match(css, /#tfcc-panel :focus-visible \{ outline: var\(--tfcc-focus-ring\); outline-offset: 2px; \}/);
});

test('an info button is still a real button with its name, hint, state and target (#43)', () => {
  const { env, api } = bootNarrow();
  seedRows(api, [{ id: 1, unread: 1 }]);
  api.state.settings.view = 'catchup';
  const html = redraw(env);
  assert.match(html, /<button type="button" class="tfcc-info" data-act="info" data-info="catchup" aria-expanded="false" aria-controls="tfcc-info-catchup" aria-label="[^"]+" title="[^"]+"><svg class="tfcc-gl"/);
});

// ---- item 3: folder, Tag and Note on one row; the tag and note popup -------

function openDrawer(rows) {
  const { env, api } = bootNarrow();
  seedRows(api, rows || [{ id: 1, title: 'One' }, { id: 2, title: 'Two' }, { id: 3, title: 'Three' }]);
  api.state.settings.view = 'threads';
  api.state.settings.sort = 'title';
  redraw(env);
  click(env, '[data-act="row-more"][data-id="1"]');
  const panel = panelOf(env);
  return { env, api, panel };
}

function openEditor(env, field) {
  click(env, '[data-act="editor"][data-id="1"][data-field="' + field + '"]');
  return panelOf(env).querySelector('[data-act="editor-input"][data-id="1"]');
}

test('folder, Tag and Note share one row; Tag and Note are buttons that control the popup (#43)', () => {
  const { panel } = openDrawer();
  const html = panel.innerHTML;
  const org = /<div class="tfcc-drawer-org tfcc-wide">([\s\S]*?)<\/div>/.exec(html);
  assert.ok(org, 'one row');
  assert.deepStrictEqual(Array.from(org[1].matchAll(/data-act="([a-z-]+)"/g), (m) => m[1]), ['folder', 'editor', 'editor']);
  assert.match(org[1], /<select data-act="folder" data-id="1" aria-label="Folder">/);
  assert.ok(org[1].includes('<button type="button" class="tfcc-edbtn" data-act="editor" data-id="1" data-field="tag" aria-haspopup="dialog"'
    + ' aria-expanded="false" aria-controls="tfcc-ed-1" aria-label="Add tag" title="Add tag">Tag</button>'));
  assert.ok(org[1].includes('<button type="button" class="tfcc-edbtn" data-act="editor" data-id="1" data-field="note" aria-haspopup="dialog"'
    + ' aria-expanded="false" aria-controls="tfcc-ed-1" aria-label="Add note" title="Add note">Note</button>'));
  // aria-controls names a real element while the drawer is open; closed, it is empty and hidden.
  assert.match(html, /<div class="tfcc-editor tfcc-wide" id="tfcc-ed-1" hidden><\/div>/);
  assert.doesNotMatch(html, /data-act="(tag|note)-input"/, 'no inline fields in the narrow drawer');
  assert.doesNotMatch(html, /id="tfcc-ed-2"/, 'only the open row renders a popup target');
});

test('Tag opens a named dialog in the panel and moves focus into its field (#43)', () => {
  const { env, api, panel } = openDrawer();
  const input = openEditor(env, 'tag');
  assert.ok(input, 'the field renders');
  assert.deepStrictEqual(env.transform(api.state.openEditor), { id: '1', field: 'tag' });
  const html = panel.innerHTML;
  assert.match(html, /<div class="tfcc-editor tfcc-wide" id="tfcc-ed-1" role="dialog" aria-label="Add a tag"><input type="text" data-act="editor-input" data-id="1" data-field="tag-input" value="" placeholder="tag" aria-label="New tag"><button type="button" class="tfcc-edsave" data-act="editor-save" data-id="1" data-field="tag">Save<\/button><button type="button" data-act="editor-cancel" data-id="1" data-field="tag">Cancel<\/button><\/div>/);
  assert.match(html, /data-field="tag" aria-haspopup="dialog" aria-expanded="true"/);
  assert.deepStrictEqual([lastFocus(env)['data-act'], lastFocus(env)['data-id']], ['editor-input', '1']);
  assert.strictEqual(api.state.openRowId, '1', 'the drawer stays open');
});

test('Enter in the tag field adds the tag, as the inline field did, and focus returns to Tag (#43)', () => {
  const { env, api, panel } = openDrawer();
  const input = openEditor(env, 'tag');
  input.value = 'later';
  panel.dispatchEvent({ type: 'input', target: input });
  let prevented = 0;
  panel.dispatchEvent({ type: 'keydown', key: 'Enter', target: input, preventDefault() { prevented += 1; } });
  assert.deepStrictEqual(Array.from(api.state.organizer.threads['1'].tags), ['later']);
  assert.strictEqual(prevented, 1);
  assert.strictEqual(api.state.openEditor, null, 'the popup closed');
  assert.strictEqual(api.state.drawerEdit, null, 'the mirror cleared');
  assert.strictEqual(api.state.openRowId, '1', 'the drawer stays open');
  assert.deepStrictEqual([lastFocus(env)['data-act'], lastFocus(env)['data-field']], ['editor', 'tag']);
  assert.match(panel.innerHTML, /<span class="tfcc-tag">later<\/span>/, 'the tag shows as a chip, where tags always show');
});

test('Save on the note popup writes the note field; the Note button then reads Edit note and shows a set state (#43)', () => {
  const { env, api, panel } = openDrawer();
  const input = openEditor(env, 'note');
  input.value = 'remember this';
  panel.dispatchEvent({ type: 'input', target: input });
  click(env, '[data-act="editor-save"][data-id="1"]');
  assert.strictEqual(api.state.organizer.threads['1'].note, 'remember this');
  const html = panel.innerHTML;
  assert.match(html, /class="tfcc-edbtn tfcc-on" data-act="editor" data-id="1" data-field="note"[^>]* aria-label="Edit note" title="Edit note">Note</);
  assert.match(html, /<div class="tfcc-note">remember this<\/div>/);
  // Reopened, the popup starts from the saved note.
  openEditor(env, 'note');
  assert.match(panel.innerHTML, /data-act="editor-input" data-id="1" data-field="note-input" value="remember this"/);
});

test('Escape and Cancel close the popup without saving, and drop what was typed (#43)', () => {
  for (const how of ['escape', 'cancel']) {
    const { env, api, panel } = openDrawer();
    const input = openEditor(env, 'note');
    input.value = 'nope';
    panel.dispatchEvent({ type: 'input', target: input });
    if (how === 'escape') panel.dispatchEvent({ type: 'keydown', key: 'Escape', target: input });
    else click(env, '[data-act="editor-cancel"][data-id="1"]');
    assert.strictEqual(api.state.openEditor, null, how);
    assert.ok(!api.state.organizer.threads['1'] || api.state.organizer.threads['1'].note === '', how + ': nothing saved');
    assert.strictEqual(api.state.drawerEdit, null, how + ': the typed text is dropped');
    assert.strictEqual(api.state.openRowId, '1', how + ': the drawer stays open');
    assert.deepStrictEqual([lastFocus(env)['data-act'], lastFocus(env)['data-field']], ['editor', 'note'], how);
  }
});

test('other keys in the popup do nothing; Enter on Cancel is the button\'s own click (#43)', () => {
  const { env, api, panel } = openDrawer();
  const input = openEditor(env, 'tag');
  panel.dispatchEvent({ type: 'keydown', key: 'a', target: input });
  assert.deepStrictEqual(env.transform(api.state.openEditor), { id: '1', field: 'tag' });
  panel.dispatchEvent({ type: 'keydown', key: 'Enter', target: panel.querySelector('[data-act="editor-cancel"][data-id="1"]') });
  assert.deepStrictEqual(env.transform(api.state.openEditor), { id: '1', field: 'tag' }, 'not a save');
});

test('typed text survives a forced redraw, with the caret, through the drawerEdit mirror (#43)', () => {
  const { env, api, panel } = openDrawer();
  const input = openEditor(env, 'note');
  input.value = 'half';
  input.selectionStart = 2;
  input.selectionEnd = 3;
  panel.dispatchEvent({ type: 'input', target: input });
  assert.deepStrictEqual(env.transform(api.state.drawerEdit), { id: '1', field: 'note-input', value: 'half', selStart: 2, selEnd: 3 });
  env.doc.activeElement = input;
  panel.contains = () => true;
  redraw(env);
  assert.match(panel.innerHTML, /data-act="editor-input" data-id="1" data-field="note-input" value="half"/);
  const again = panel.querySelector('[data-act="editor-input"][data-id="1"]');
  assert.deepStrictEqual(again.selection, [2, 3], 'the selection is restored on the new node');
});

test('a background redraw while typing in the popup is deferred by the caret (#43)', () => {
  const { env, api, panel } = openDrawer();
  const input = openEditor(env, 'tag');
  env.doc.activeElement = input;
  panel.contains = () => true;
  const before = panel.renderCount;
  api.state.organizer = api.togglePin(api.state.organizer, '2');
  api.recompute(NOW);
  env.exports.draw(env.doc, env.win, api.makeHandlers(env.doc, env.win));
  assert.strictEqual(panel.renderCount, before, 'deferred');
  assert.strictEqual(api.state.pendingRedraw, true);
});

test('the popup closes with its drawer: view change, collapse, auto-hide, breakpoint, the row leaving, a tap outside the panel (#43)', () => {
  const cases = {
    view: ({ env }) => click(env, '[data-act="view"][data-view="drafts"]'),
    collapse: ({ env }) => click(env, '[data-act="collapse"]'),
    'auto-hide': ({ env, api, panel }) => {
      api.state.settings.autoHideOnOpen = true;
      panel.dispatchEvent({ type: 'click', target: panel.querySelector('[data-tfcc-thread="2"]'), button: 0 });
      env.advanceTimersBy(0);
    },
    breakpoint: ({ env }) => { env.resize(900); redraw(env); },
    'row leaves': ({ env, api }) => { seedRows(api, [{ id: 2, title: 'Two' }, { id: 3, title: 'Three' }]); redraw(env); },
    outside: ({ env, panel }) => {
      const outside = env.makeElement('a');
      panel.contains = (n) => n !== outside;
      env.doc.activeElement = null; // the tap outside took focus from the field
      env.win.fire('click', { type: 'click', target: outside });
      env.advanceTimersBy(0);
    },
  };
  for (const [name, act] of Object.entries(cases)) {
    const ctx = openDrawer();
    openEditor(ctx.env, 'tag');
    assert.ok(ctx.api.state.openEditor, name + ': precondition');
    act(ctx);
    ctx.api.buildPanelModel(NOW);
    assert.strictEqual(ctx.api.state.openEditor, null, name);
    assert.doesNotMatch(ctx.panel.innerHTML, /role="dialog"/, name + ': not drawn');
  }
});

test('a tap elsewhere in the drawer closes the popup but keeps the drawer and the typed text (#43)', () => {
  const { env, api, panel } = openDrawer();
  panel.contains = () => true;
  const input = openEditor(env, 'note');
  input.value = 'draft words';
  panel.dispatchEvent({ type: 'input', target: input });
  const before = panel.renderCount;
  click(env, '[data-act="pin"][data-id="1"]');
  assert.strictEqual(api.state.openEditor, null);
  assert.strictEqual(api.state.openRowId, '1', 'the drawer stays');
  assert.strictEqual(api.state.organizer.threads['1'].pinned, true, 'and Pin still did its job');
  env.advanceTimersBy(0);
  assert.ok(panel.renderCount > before);
  assert.doesNotMatch(panel.innerHTML, /role="dialog"/);
  assert.strictEqual(api.state.drawerEdit.value, 'draft words', 'kept for the next open');
  openEditor(env, 'note');
  assert.match(panel.innerHTML, /data-field="note-input" value="draft words"/);
});

test('a tap inside the popup keeps it open; its own button toggles it; the other button switches (#43)', () => {
  const { env, api, panel } = openDrawer();
  panel.contains = () => true;
  openEditor(env, 'tag');
  click(env, '[data-act="editor-input"][data-id="1"]');
  assert.deepStrictEqual(env.transform(api.state.openEditor), { id: '1', field: 'tag' }, 'a tap in the field');
  click(env, '[data-act="editor"][data-id="1"][data-field="note"]');
  assert.deepStrictEqual(env.transform(api.state.openEditor), { id: '1', field: 'note' }, 'switched');
  click(env, '[data-act="editor"][data-id="1"][data-field="note"]');
  assert.strictEqual(api.state.openEditor, null, 'toggled closed');
});

test('the popup state is never saved (#43)', () => {
  const { env } = openDrawer();
  openEditor(env, 'tag');
  for (const [k, v] of env.gmStore) assert.doesNotMatch(String(k) + JSON.stringify(v), /openEditor/, k);
});

test('nextEditor and reconcileEditor are the popup\'s whole state machine (#43)', () => {
  const { api } = bootNarrow();
  const t = (x) => JSON.parse(JSON.stringify(x));
  assert.deepStrictEqual(t(api.nextEditor(null, { type: 'open', id: '1', field: 'tag' })), { id: '1', field: 'tag' });
  assert.strictEqual(api.nextEditor({ id: '1', field: 'tag' }, { type: 'open', id: '1', field: 'tag' }), null, 'toggle');
  assert.deepStrictEqual(t(api.nextEditor({ id: '1', field: 'tag' }, { type: 'open', id: '1', field: 'note' })), { id: '1', field: 'note' });
  assert.strictEqual(api.nextEditor({ id: '1', field: 'tag' }, { type: 'close' }), null);
  assert.strictEqual(api.nextEditor(null, { type: 'open', id: '1', field: 'folder' }), null, 'only tag and note');
  assert.deepStrictEqual(t(api.reconcileEditor({ id: '1', field: 'note' }, '1')), { id: '1', field: 'note' });
  assert.strictEqual(api.reconcileEditor({ id: '1', field: 'note' }, '2'), null, 'another drawer');
  assert.strictEqual(api.reconcileEditor({ id: '1', field: 'note' }, null), null, 'no drawer');
});

test('desktop rows keep their inline tag and note fields (#43)', () => {
  const { env, api } = bootNarrow({ width: 900 });
  seedRows(api, [{ id: 1, title: 'One' }]);
  const html = redraw(env);
  assert.match(html, /<input type="text" data-act="tag-input" data-id="1" placeholder="add tag" size="8">/);
  assert.match(html, /<input type="text" data-act="note-input" data-id="1" value="" placeholder="note" size="14">/);
  assert.doesNotMatch(html, /data-act="editor/);
});

