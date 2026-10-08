/*
 * Mutation check - run manually, never part of `npm test`.
 *
 *   node tests/mutation-check.mjs
 *
 * A test that passes proves nothing until you have watched it fail for the
 * reason it claims to guard. This breaks each user-visible promise in turn,
 * runs only the suite that is supposed to notice, and asserts that it fails.
 * The source file is restored after every mutation, including on a crash.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const here = path.dirname(fileURLToPath(import.meta.url));
const SOURCE = path.join(here, '..', 'torn-forum-command-center.user.js');
const BACKUP = path.join(here, '..', '.mutation-backup');

// This script edits the production file in place, so being killed between the
// mutation and the restore leaves a broken script on disk. That has already
// happened once, from a SIGPIPE when the output was piped into `head`, and the
// next run then read the mutated file as its pristine baseline and silently
// skipped the mutation it could no longer find. Three guards, in order:
//
//   1. A backup on disk that outlives the process. If one is here at startup,
//      the previous run died mid-mutation and this restores it and stops.
//   2. Handlers for every way this process can be asked to stop.
//   3. A per-suite timeout, so a hung suite cannot hold the file hostage.
//
// Do not pipe this script's output into `head`, `grep -m` or anything else that
// closes the pipe early. Redirect to a file and read that instead.
if (fs.existsSync(BACKUP)) {
  fs.writeFileSync(SOURCE, fs.readFileSync(BACKUP, 'utf8'));
  fs.unlinkSync(BACKUP);
  console.error('A previous run died mid-mutation. The source has been restored from the backup.');
  console.error('Re-run the check; nothing was verified this time.');
  process.exit(1);
}

const original = fs.readFileSync(SOURCE, 'utf8');
fs.writeFileSync(BACKUP, original);

let restored = false;
function restore() {
  if (restored) return;
  restored = true;
  try { fs.writeFileSync(SOURCE, original); } catch (e) { /* nothing left to do */ }
  try { if (fs.existsSync(BACKUP)) fs.unlinkSync(BACKUP); } catch (e) { /* ditto */ }
}

process.on('exit', restore);
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGBREAK']) {
  process.on(signal, () => { restore(); process.exit(130); });
}
process.on('uncaughtException', (err) => { restore(); console.error(err); process.exit(1); });

const MUTATIONS = [
  {
    name: 'injection time is not document-end',
    suite: 'tests/metadata.test.js',
    apply: (s) => s.replace('// @run-at       document-end', '// @run-at       document-idle'),
  },
  {
    name: 'a typographic quote reaches the source',
    suite: 'tests/metadata.test.js',
    // The exact shape that stopped the sibling Education Scheduler dead inside
    // Torn PDA, before bootstrap, with no panel and no error.
    apply: (s) => s.replace(
      "var GREASY_FORK_URL = 'https",
      "var GREASY_FORK_URL = 'Torn’s script, see https",
    ),
  },
  {
    name: 'the DOM readiness poll is removed',
    suite: 'tests/navigation.test.js',
    apply: (s) => s.replace('var DOM_READY_MAX_POLLS = 40;', 'var DOM_READY_MAX_POLLS = 0;'),
  },
  {
    name: 'navigation can be installed twice',
    suite: 'tests/navigation.test.js',
    apply: (s) => s.replace('if (!win || win[NAV_FLAG]) return;', 'if (!win) return;'),
  },
  {
    name: 'error details are no longer scrubbed',
    suite: 'tests/api.test.js',
    apply: (s) => s.replace(
      /function scrubDetail\(text\) \{[\s\S]*?\n  \}/,
      'function scrubDetail(text) {\n    return safeString(text, 300);\n  }',
    ),
  },
  {
    name: 'the request deadline is widened out of usefulness',
    suite: 'tests/api.test.js',
    apply: (s) => s.replace('var REQUEST_TIMEOUT_MS = 15000;', 'var REQUEST_TIMEOUT_MS = 99999999;'),
  },
  {
    name: 'the minimum request gap is removed',
    suite: 'tests/ratelimit.test.js',
    apply: (s) => s.replace('var MIN_REQUEST_GAP_MS = 650;', 'var MIN_REQUEST_GAP_MS = 0;'),
  },
  {
    name: 'the rolling window ceiling is removed',
    suite: 'tests/ratelimit.test.js',
    apply: (s) => s.replace('var REQUESTS_PER_WINDOW = 40;', 'var REQUESTS_PER_WINDOW = 100000;'),
  },
  {
    name: 'the dynamic viewport height override is removed',
    suite: 'tests/style.test.js',
    apply: (s) => s.replace(/height: 100dvh; max-height: 100vh; max-height: 100dvh;/, 'max-height: 100vh;'),
  },
  {
    name: 'the enrichment budget is ignored',
    suite: 'tests/refresh.test.js',
    apply: (s) => s.replace('.slice(0, budget);', '.slice(0, 100);'),
  },
  {
    name: 'a damaged storage key is silently treated as absent',
    suite: 'tests/storage.test.js',
    apply: (s) => s.replace('return PARSE_FAILED;', 'return null;'),
  },
  {
    name: 'the cached feed cannot read back the shape it wrote',
    suite: 'tests/storage.test.js',
    apply: (s) => s.replace(
      'author.username === undefined ? raw.authorName : author.username',
      'author.username',
    ),
  },
  {
    name: 'a thread title is written to the panel without escaping',
    suite: 'tests/panel.test.js',
    apply: (s) => s.replace(
      "      + threadLinkAttr(row.id) + '>'\n      + escapeHtml(row.title) + '</a></span>');",
      "      + threadLinkAttr(row.id) + '>'\n      + row.title + '</a></span>');",
    ),
  },
  {
    name: 'the debug report includes the raw state',
    suite: 'tests/debug-report.test.js',
    apply: (s) => s.replace(
      "    return lines.join('\\n');",
      "    return lines.join('\\n') + '\\n' + JSON.stringify(state.organizer) + JSON.stringify(state.drafts);",
    ),
  },
  {
    // Sorting unknown to the TOP, not coercing it to zero. Coercion happens to
    // sort it last anyway, so that mutation changes no observable behaviour and
    // would prove nothing about the test that claims to guard this.
    name: 'an unknown last activity sorts first instead of last',
    suite: 'tests/merge.test.js',
    apply: (s) => s.replace(
      "        else if (a.lastActivity === null) d = 1;\n        else if (b.lastActivity === null) d = -1;\n        else d = b.lastActivity - a.lastActivity;\n      } else if (m === 'unread') {",
      "        else if (a.lastActivity === null) d = -1;\n        else if (b.lastActivity === null) d = 1;\n        else d = b.lastActivity - a.lastActivity;\n      } else if (m === 'unread') {",
    ),
  },
  {
    name: 'the export carries the API key',
    suite: 'tests/share.test.js',
    apply: (s) => s.replace(
      '    var payload = {\n      v: SCHEMA_VERSION,',
      '    var payload = {\n      key: loadApiKey(),\n      v: SCHEMA_VERSION,',
    ),
  },
  {
    name: 'the staleness guard is removed, so a reset can be undone',
    suite: 'tests/staleness.test.js',
    apply: (s) => s.replace('function stale() { return generation !== state.generation; }',
      'function stale() { return false; }'),
  },
  {
    name: 'a reset no longer invalidates work already in flight',
    suite: 'tests/staleness.test.js',
    apply: (s) => s.replace(
      '  function invalidateInFlight() {\n    state.generation += 1;',
      '  function invalidateInFlight() {\n    state.generation += 0;',
    ),
  },
  {
    name: 'deep search loses its re-entrancy guard',
    suite: 'tests/staleness.test.js',
    apply: (s) => s.replace(
      "    if (state.deepBusy) {\n      return Promise.resolve({ ok: false, reason: 'inflight', detail: 'A search is already running.' });\n    }",
      '',
    ),
  },
  {
    name: 'autosave stops writing anything',
    suite: 'tests/staleness.test.js',
    apply: (s) => s.replace(
      "          state.drafts = saveDraft(state.drafts, state.route.threadId, text, Date.now(), '');",
      '          void text;',
    ),
  },
  {
    name: 'an emptied reply box is autosaved over the draft',
    suite: 'tests/staleness.test.js',
    apply: (s) => s.replace('          if (!text.trim()) return;', ''),
  },
  {
    name: 'a late refresh redraws onto whatever page the user went to',
    suite: 'tests/staleness.test.js',
    apply: (s) => s.replace(
      '  function drawIfStillHere(doc, win, handlers) {\n    if (!isForumsPage(win.location)) return;\n    draw(doc, win, handlers);\n  }',
      '  function drawIfStillHere(doc, win, handlers) {\n    draw(doc, win, handlers);\n  }',
    ),
  },
  {
    name: 'the Note control loses its handler',
    suite: 'tests/handlers.test.js',
    apply: (s) => s.replace("        if (act === 'note-input' && id) {", "        if (false && id) {"),
  },
  {
    name: 'a request verb other than GET appears',
    suite: 'tests/read-only.test.js',
    apply: (s) => s.replace("            method: 'GET',", "            method: 'POST',"),
  },
  {
    name: 'the script simulates a click on a Torn element',
    suite: 'tests/read-only.test.js',
    apply: (s) => s.replace(
      "      if (typeof box.focus === 'function') box.focus();",
      "      if (typeof box.click === 'function') box.click();",
    ),
  },
  {
    name: 'the script navigates on its own again',
    suite: 'tests/read-only.test.js',
    apply: (s) => s.replace(
      "        if (act === 'deep') {",
      "        if (act === 'never') { win.location.href = 'https://www.torn.com/'; }\n        if (act === 'deep') {",
    ),
  },
  {
    name: 'auto refresh defaults to on',
    suite: 'tests/read-only.test.js',
    apply: (s) => s.replace('      autoRefreshMs: 0,', '      autoRefreshMs: 120000,'),
  },
  {
    name: 'auto refresh keeps firing while the page is hidden',
    suite: 'tests/read-only.test.js',
    apply: (s) => s.replace('        if (doc.hidden === true) return;', ''),
  },
  {
    name: 'a second @connect host is declared',
    suite: 'tests/read-only.test.js',
    apply: (s) => s.replace(
      '// @connect      api.torn.com',
      '// @connect      api.torn.com\n// @connect      example.com',
    ),
  },
  {
    name: 'a key Torn rejected keeps being retried',
    suite: 'tests/key-rejection.test.js',
    apply: (s) => s.replace(
      '    if (state.settings.keyRejected) {',
      '    if (false && state.settings.keyRejected) {',
    ),
  },
  {
    name: 'the rejection is not remembered across a reload',
    suite: 'tests/key-rejection.test.js',
    apply: (s) => s.replace(
      "    out.keyRejected = KEY_REJECTED_CODES.indexOf(toInt(raw.keyRejected, 0)) === -1\n      ? 0 : toInt(raw.keyRejected, 0);",
      '    out.keyRejected = 0;',
    ),
  },
  {
    name: 'a temporary Torn error is treated as a dead key',
    suite: 'tests/key-rejection.test.js',
    apply: (s) => s.replace(
      'var KEY_REJECTED_CODES = Object.freeze([2, 13, 16, 18]);',
      'var KEY_REJECTED_CODES = Object.freeze([2, 5, 13, 16, 17, 18]);',
    ),
  },
  {
    name: 'the API terms disclosure is dropped from the key screen',
    suite: 'tests/read-only.test.js',
    apply: (s) => s.replace("out.push('<table class=\"tfcc-tos\"><tbody>');", "out.push('');"),
  },
  {
    name: 'automatic requests keep firing on an unfocused window',
    suite: 'tests/read-only.test.js',
    apply: (s) => s.replace(
      "        if (typeof doc.hasFocus === 'function' && !doc.hasFocus()) return;",
      '',
    ),
  },
  {
    name: 'the script generates an alert',
    suite: 'tests/read-only.test.js',
    apply: (s) => s.replace(
      '  function notice(text, kind) {',
      '  function notice(text, kind) {\n    if (kind === "never") alert(text);',
    ),
  },
  {
    name: 'the script rewrites the page title to draw attention',
    suite: 'tests/read-only.test.js',
    apply: (s) => s.replace(
      '    state.mounted = true;',
      '    doc.title = "(" + state.rows.length + ") " + doc.title;\n    state.mounted = true;',
    ),
  },
  {
    name: 'the script pulls the window into focus',
    suite: 'tests/read-only.test.js',
    apply: (s) => s.replace(
      "      if (typeof box.focus === 'function') box.focus();",
      "      if (typeof box.focus === 'function') { win.focus(); box.focus(); }",
    ),
  },
  {
    name: 'anchors lose their colour and fall back to browser blue',
    suite: 'tests/style.test.js',
    apply: (s) => s.replace(
      "      '#' + PANEL_ID + ' a, #' + PANEL_ID + ' a:link, #' + PANEL_ID + ' a:visited,',",
      "      '',",
    ),
  },
  {
    name: 'visited row titles are left to turn purple',
    suite: 'tests/style.test.js',
    apply: (s) => s.replace(
      "      '#' + PANEL_ID + ' .tfcc-row-title a, #' + PANEL_ID + ' .tfcc-row-title a:visited {',",
      "      '#' + PANEL_ID + ' .tfcc-row-title a {',",
    ),
  },
  {
    name: 'dropdown options lose the panel colours',
    suite: 'tests/style.test.js',
    apply: (s) => s.replace(
      "      '#' + PANEL_ID + ' option { background: var(--tm-bg-3); color: var(--tm-text); }',",
      "      '',",
    ),
  },
  {
    name: 'the Settings key help names Limited Access as the requirement again',
    suite: 'tests/style.test.js',
    apply: (s) => s.replace(
      "    out.push('<tr><th>Access level required</th><td>Minimal Access. Limited Access '\n      + 'also works but is not needed. Public Only does not.</td></tr>');",
      "    out.push('<tr><th>Access level required</th><td>Limited Access. Public Only '\n      + 'does not.</td></tr>');",
    ),
  },
  {
    name: 'the observer reads our own renders as page navigation again',
    suite: 'tests/redraw.test.js',
    apply: (s) => s.replace(
      '          if (isOwnMutation(doc, records)) return;',
      '',
    ),
  },
  {
    name: 'an identical render is written to the DOM anyway',
    suite: 'tests/redraw.test.js',
    apply: (s) => s.replace(
      '    if (panel.__tfccHtml !== html) {',
      '    if (true) {',
    ),
  },
  {
    name: 'a background redraw interrupts typing',
    suite: 'tests/redraw.test.js',
    apply: (s) => s.replace(
      '      if (!force && panelHasEditableFocus(doc)) {',
      '      if (false) {',
    ),
  },
  {
    name: 'a held update is never flushed when focus leaves',
    suite: 'tests/redraw.test.js',
    apply: (s) => s.replace(
      "      panel.addEventListener('focusout', function () {",
      "      panel.addEventListener('never-fires', function () {",
    ),
  },
  {
    name: 'panel content takes its colour from the host page again',
    suite: 'tests/style.test.js',
    apply: (s) => s.replace(
      "      '#' + PANEL_ID + ' * { color: inherit; background: transparent; }',",
      '',
    ),
  },
  {
    name: 'table cells go back to inheriting their colour',
    suite: 'tests/style.test.js',
    apply: (s) => s.replace(
      "      '  color: var(--tm-text); background: transparent; }',",
      "      '  }',",
    ),
  },
  {
    name: 'Match Torn goes back to guessing at a class name',
    suite: 'tests/style.test.js',
    apply: (s) => s.replace(
      '    var measured = measurePageTheme(doc, win);\n    if (measured) return measured;',
      '',
    ),
  },
  {
    name: 'a transparent body is read as black',
    suite: 'tests/style.test.js',
    apply: (s) => s.replace(
      '        if (m[4] !== undefined && Number(m[4]) < 0.5) continue;',
      '',
    ),
  },
  {
    name: 'nothing watches for Torn changing its theme',
    suite: 'tests/style.test.js',
    apply: (s) => s.replace('    observeTheme(doc, win);', ''),
  },
  {
    name: 'the page guard accepts any host ending in torn.com',
    suite: 'tests/route.test.js',
    apply: (s) => s.replace(
      "      if (host !== 'www.torn.com' && host !== 'torn.com') return false;",
      "      if (host.indexOf('torn.com') === -1) return false;",
    ),
  },
  {
    name: 'a requested selection is dropped from the custom key',
    suite: 'tests/custom-key.test.js',
    apply: (s) => s.replace(
      "    forum: Object.freeze(['categories', 'thread', 'posts']),",
      "    forum: Object.freeze(['categories', 'thread']),",
    ),
  },
  {
    name: 'the custom key link carries a key',
    suite: 'tests/custom-key.test.js',
    apply: (s) => s.replace(
      "    var url = CUSTOM_KEY_LINK_BASE + '&title=' + encodeURIComponent(CUSTOM_KEY_TITLE);",
      "    var url = CUSTOM_KEY_LINK_BASE + '&key=' + 'x' + '&title=' + encodeURIComponent(CUSTOM_KEY_TITLE);",
    ),
  },
  {
    name: 'the custom key link opens Torn with a handle back to this tab',
    suite: 'tests/custom-key.test.js',
    apply: (s) => s.replace(
      '\'" target="_blank" rel="noopener noreferrer">Create a custom key on Torn</a></div>\');',
      '\'" target="_blank">Create a custom key on Torn</a></div>\');',
    ),
  },
  {
    name: 'auto-hide ignores its setting, so every thread link collapses the panel',
    suite: 'tests/auto-hide.test.js',
    apply: (s) => s.replace(
      "if (!isPlainObject(settings) || settings.autoHideOnOpen !== true) return settings;",
      'if (!isPlainObject(settings)) return settings;',
    ),
  },
  {
    name: 'a Ctrl-click into a new tab collapses the panel in this one',
    suite: 'tests/auto-hide.test.js',
    apply: (s) => s.replace(
      'if (click.ctrlKey === true || click.metaKey === true) return false;',
      'if (click.metaKey === true) return false;',
    ),
  },
  {
    name: 'opening a thread leaves takeover covering it',
    suite: 'tests/auto-hide.test.js',
    apply: (s) => s.replace(
      'return Object.assign({}, settings, { collapsed: true, takeover: false });',
      'return Object.assign({}, settings, { collapsed: true });',
    ),
  },
  {
    name: 'the collapse is persisted only after navigation has begun',
    suite: 'tests/auto-hide.test.js',
    apply: (s) => s.replace(
      "        persist('settings');\n        // Deferred: redrawing now",
      "        setTimeout(function () { persist('settings'); }, 0);\n        // Deferred: redrawing now",
    ),
  },
  {
    name: 'the auto-hide setting accepts any truthy value',
    suite: 'tests/auto-hide.test.js',
    apply: (s) => s.replace(
      'out.autoHideOnOpen = raw.autoHideOnOpen === true;',
      'out.autoHideOnOpen = !!raw.autoHideOnOpen;',
    ),
  },
  {
    name: 'a row link loses its thread marker',
    suite: 'tests/auto-hide.test.js',
    apply: (s) => s.replace("      + threadLinkAttr(row.id) + '>'", "      + '>'"),
  },
  {
    name: 'the thread link walk climbs out of the panel',
    suite: 'tests/auto-hide.test.js',
    apply: (s) => s.replace(
      'if (n === panel) return null;',
      'if (n === panel) { n = n.parentNode; continue; }',
    ),
  },
  {
    name: 'an upgrade that adds a setting is reported as damage again',
    suite: 'tests/auto-hide.test.js',
    apply: (s) => s.replace(
      'var seen = isPlainObject(raw) && isPlainObject(value) ? Object.assign({}, value, raw) : raw;',
      'var seen = raw;',
    ),
  },
  // My posts (#2)
  {
    name: 'My posts is no longer the last nav button',
    suite: 'tests/panel.test.js',
    apply: (s) => s.replace("['threads', 'catchup', 'search', 'drafts', 'settings', 'mine']",
      "['threads', 'catchup', 'search', 'drafts', 'mine', 'settings']"),
  },
  {
    name: 'the My posts button is no longer right-aligned',
    suite: 'tests/style.test.js',
    apply: (s) => s.replace(' button.tfcc-nav-mine { margin-left: auto; ', ' button.tfcc-nav-mine { '),
  },
  {
    name: 'the My posts pressed rule loses to the generic one',
    suite: 'tests/style.test.js',
    apply: (s) => s.replace(' button.tfcc-nav-mine[aria-pressed="true"] {', ' .tfcc-nav-mine-x[aria-pressed="true"] {'),
  },
  {
    name: 'Unread only is ignored in My posts',
    suite: 'tests/panel.test.js',
    apply: (s) => s.replace("      if (f.unreadOnly && r.unread === 0 && r.authorState !== 'unchecked') return false;",
      "      if (f.unreadOnly && r.unread === 0 && r.authorState !== 'unchecked' && view !== 'mine') return false;"),
  },
  {
    name: 'first sight no longer sets the baseline, so history floods as new',
    suite: 'tests/mine.test.js',
    apply: (s) => s.replace('    if (!t.totalKnown) t.baselineTotal = total;', ''),
  },
  {
    name: 'your own last post no longer clears the count',
    suite: 'tests/mine.test.js',
    apply: (s) => s.replace('    if (lastIsMine) t.baselineTotal = Math.max(t.baselineTotal, t.postsTotal);', ''),
  },
  {
    name: 'an unknown total passes for a checked zero',
    suite: 'tests/mine.test.js',
    apply: (s) => s.replace("dismissed: false, unread: 0, unreadSource: 'unchecked' };",
      "dismissed: false, unread: 0, unreadSource: 'local' };"),
  },
  {
    name: 'a thread\'s reply count is stored as its total (live findings 3 and 4)',
    suite: 'tests/mine.test.js',
    apply: (s) => s.replace('      return Math.floor(raw.posts) + 1;', '      return Math.floor(raw.posts);'),
  },
  {
    name: 'Torn\'s new_posts is ignored for started threads',
    suite: 'tests/mine.test.js',
    apply: (s) => s.replace('    if (rec && rec.totalKnown && rec.tornNewKnown) {', '    if (false) {'),
  },
  {
    name: 'the My posts TTL is removed',
    suite: 'tests/mine-refresh.test.js',
    apply: (s) => s.replace('var MINE_TTL_MS = 15 * 60 * 1000;', 'var MINE_TTL_MS = 0;'),
  },
  {
    name: 'My posts lookups ignore the budget',
    suite: 'tests/mine-refresh.test.js',
    apply: (s) => s.replace('for (var j = 0; j < snap.threads.length && out.length < n; j += 1) {',
      'for (var j = 0; j < snap.threads.length; j += 1) {'),
  },
  {
    name: 'a post body is kept',
    suite: 'tests/mine.test.js',
    apply: (s) => s.replace('      threadId: threadId,\n      authorId:',
      '      threadId: threadId,\n      content: raw.content,\n      authorId:'),
  },
  {
    name: 'every My posts thread floods Threads',
    suite: 'tests/merge.test.js',
    apply: (s) => s.replace('        inThreads: !!api || !rec || isOrganised(entry, !!draft),', '        inThreads: true,'),
  },
  {
    name: 'the My posts staleness guard is removed',
    suite: 'tests/staleness.test.js',
    apply: (s) => s.replace('    function stale() { return generation !== state.generation; }\n    function fail(',
      '    function stale() { return false; }\n    function fail('),
  },
  {
    name: 'the rows shown cap is ignored',
    suite: 'tests/rows-cap.test.js',
    apply: (s) => s.replace('    var bites = lim > 0 && total > lim;', '    var bites = false;'),
  },
  {
    name: 'the Threads cap runs before the sort',
    suite: 'tests/rows-cap.test.js',
    apply: (s) => s.replace('        threads: capRows(threadsSorted, s.rowsShown,', '        threads: capRows(visible, s.rowsShown,'),
  },
  {
    name: 'the My posts cap runs before the sort',
    suite: 'tests/rows-cap.test.js',
    apply: (s) => s.replace("    var mineSorted = s.view === 'mine' ? sorted :", "    var mineSorted = s.view === 'mine' ? visible :"),
  },
  {
    name: 'the Catch up nav count counts only the capped rows',
    suite: 'tests/rows-cap.test.js',
    apply: (s) => s.replace(
      "      if (v === 'catchup' && model.catchUp.length) count = ' (' + model.catchUp.length + ')';",
      "      if (v === 'catchup' && model.catchUp.length) count = ' (' + model.capped.catchup.rows.length + ')';",
    ),
  },
  {
    name: 'Search renders the capped list',
    suite: 'tests/rows-cap.test.js',
    apply: (s) => s.replace('    var matched = model.rows;', '    var matched = model.capped.threads.rows;'),
  },
  {
    name: 'an off-menu rows shown is stored instead of falling back to All',
    suite: 'tests/storage.test.js',
    apply: (s) => s.replace(
      "    out.rowsShown = typeof raw.rowsShown === 'number' && ROWS_SHOWN_OPTIONS.indexOf(raw.rowsShown) !== -1",
      "    out.rowsShown = typeof raw.rowsShown === 'number' && raw.rowsShown >= 0",
    ),
  },
  {
    name: 'an upgrade from a blob without rowsShown is reported as damaged',
    suite: 'tests/storage.test.js',
    apply: (s) => s.replace(
      'var recovered = (recoveredCheck || isRecoveredValue)(raw, value);',
      'var recovered = raw !== null && JSON.stringify(raw) !== JSON.stringify(value);',
    ),
  },
  // -- author-only mode (issue #4) --
  {
    name: 'author mode falls back to Torn\'s any-poster count',
    suite: 'tests/author.test.js',
    apply: (s) => s.replace(
      "unread: au ? ((au.state === 'author' || au.state === 'author-atleast') ? au.count : 0) : u.unread,",
      'unread: u.unread,',
    ),
  },
  {
    name: 'a post exactly at the read marker is counted as new',
    suite: 'tests/author.test.js',
    apply: (s) => s.replace('      if (at <= since) continue;', '      if (at < since) continue;'),
  },
  {
    name: 'the boundary post that inclusive to repeats is counted twice',
    suite: 'tests/author.test.js',
    apply: (s) => s.replace('if (key && seen[key]) continue;', ''),
  },
  {
    name: 'every page ends the walk as complete, so a cut-short walk becomes a false none',
    suite: 'tests/author.test.js',
    apply: (s) => s.replace(
      'if (list.length < size || prevLink === null) return { done: true, complete: true, to: 0 };',
      'return { done: true, complete: true, to: 0 };',
    ),
  },
  {
    name: 'a walk that makes no progress is called complete',
    suite: 'tests/author.test.js',
    apply: (s) => s.replace(
      'if (added === 0 || oldest === 0) return { done: true, complete: false, to: 0 };',
      'if (added === 0 || oldest === 0) return { done: true, complete: true, to: 0 };',
    ),
  },
  {
    name: 'the page cap is ignored, so one thread walks until the budget runs out',
    suite: 'tests/refresh.test.js',
    apply: (s) => s.replace('if (pages >= AUTHOR_MAX_PAGES || spent + reserved >= cap)', 'if (spent + reserved >= cap)'),
  },
  {
    name: 'further pages take budget reserved for threads not yet started',
    suite: 'tests/refresh.test.js',
    apply: (s) => s.replace('if (pages >= AUTHOR_MAX_PAGES || spent + reserved >= cap)', 'if (pages >= AUTHOR_MAX_PAGES || spent >= cap)'),
  },
  {
    name: 'a further page is requested without to, so the walk re-reads page 0',
    suite: 'tests/refresh.test.js',
    apply: (s) => s.replace('if (to > 0) params.to = to;', ''),
  },
  {
    name: 'a failed further page is recorded as a complete walk',
    suite: 'tests/refresh.test.js',
    apply: (s) => s.replace(
      'var sum = summariseAuthorPosts(posts, authorId, since, out.complete === true);',
      'var sum = summariseAuthorPosts(posts, authorId, since, out.complete !== false);',
    ),
  },
  {
    name: 'a walk cut short with no author post is read as a known zero',
    suite: 'tests/author.test.js',
    apply: (s) => s.replace(
      "return e.authorCheckComplete ? { state: 'none', count: 0, latestAt: 0, reason: '' } : unchecked('too-many');",
      "return { state: 'none', count: 0, latestAt: 0, reason: '' };",
    ),
  },
  {
    name: 'the request sends the marker itself, which inclusive from returns as new',
    suite: 'tests/refresh.test.js',
    apply: (s) => s.replace('var from = Math.floor(since / 1000) + 1;', 'var from = Math.floor(since / 1000);'),
  },
  {
    name: 'the check total is stored as a thread reply count (posts.total - 1)',
    suite: 'tests/refresh.test.js',
    apply: (s) => s.replace('e.authorCheckTotal = total;', 'e.authorCheckTotal = total - 1;'),
  },
  {
    name: 'an author check is never invalidated by new posts',
    suite: 'tests/author.test.js',
    apply: (s) => s.replace('if (e.authorCheckTotal === u.postsTotal) {', 'if (true) {'),
  },
  {
    name: 'author-mode lookups select on the any-poster unread count',
    suite: 'tests/refresh.test.js',
    apply: (s) => s.replace(
      "if (authorMode) return r.authorState === 'unchecked' && (r.authorReason === 'never' || r.authorReason === 'stale');",
      'if (authorMode) return r.unread > 0;',
    ),
  },
  {
    name: 'Unread only hides unchecked rows',
    suite: 'tests/panel.test.js',
    apply: (s) => s.replace(" && r.authorState !== 'unchecked') return false;", ') return false;'),
  },
  {
    name: 'My posts follows author-only mode instead of ignoring it',
    suite: 'tests/panel.test.js',
    apply: (s) => s.replace('    var mineRows = rows.map(anyPosterRow);', '    var mineRows = rows;'),
  },
  {
    name: 'Mark all read marks an unchecked thread in author mode',
    suite: 'tests/handlers.test.js',
    apply: (s) => s.replace(
      "if (state.settings.authorOnly === true && state.rows[i].authorState === 'unchecked') continue;", ''),
  },
  {
    name: 'the organizer goes back to the strict comparison, so new per-thread fields read as damage',
    suite: 'tests/storage.test.js',
    apply: (s) => s.replace(
      'loadKey(STORAGE_KEYS.organizer, normaliseOrganizer, now, isRecoveredOrganizer)',
      'loadKey(STORAGE_KEYS.organizer, normaliseOrganizer, now)',
    ),
  },
  {
    name: 'the per-entry check forgives a corrupt thread entry',
    suite: 'tests/storage.test.js',
    apply: (s) => s.replace(
      'threads[id] = isPlainObject(r) && isPlainObject(v) ? Object.assign({}, v, r) : r;',
      'threads[id] = isPlainObject(v) ? v : r;',
    ),
  },
  // -- thread reactions (#10) ----------------------------------------------
  {
    name: 'a missing rating reads as 0',
    suite: 'tests/reactions.test.js',
    apply: (s) => s.replace('rating: isReactionNumber(raw.rating, true) ? Math.floor(raw.rating) : null,',
      'rating: toInt(raw.rating, 0),'),
  },
  {
    name: 'a topic post with null likes reads as 0',
    suite: 'tests/reactions.test.js',
    apply: (s) => s.replace(
      'if (!isReactionNumber(p.likes, false) || !isReactionNumber(p.dislikes, false)) return null;',
      'if (false) return null;'),
  },
  {
    name: 'any post counts as the topic post',
    suite: 'tests/reactions.test.js',
    apply: (s) => s.replace('if (!isPlainObject(p) || p.is_topic !== true) continue;', 'if (!isPlainObject(p)) continue;'),
  },
  {
    name: 'a thread counts by both thumbs and net',
    suite: 'tests/reactions.test.js',
    apply: (s) => s.replace("} else if (typeof t.rating === 'number') {", "}\n      if (typeof t.rating === 'number') {"),
  },
  {
    name: 'threads you only posted in are counted',
    suite: 'tests/reactions.test.js',
    apply: (s) => s.replace('if (!t || t.started !== true) continue;', 'if (!t) continue;'),
  },
  {
    name: 'reaction figures never go stale',
    suite: 'tests/reactions.test.js',
    apply: (s) => s.replace('out.stale = toInt(now, 0) - out.updatedAt > staleMs;', 'out.stale = false;'),
  },
  {
    name: 'the topic TTL is ignored',
    suite: 'tests/reactions.test.js',
    apply: (s) => s.replace('return at <= 0 || t0 - at >= ttl;', 'return true;'),
  },
  {
    name: 'the normaliser always emits topicAt',
    suite: 'tests/storage.test.js',
    apply: (s) => s.replace('    if (topicAt > 0) {\n      rx.topicAt = topicAt;', '    if (true) {\n      rx.topicAt = topicAt;'),
  },
  {
    name: 'topic lookups ignore their cap',
    suite: 'tests/reactions-lookups.test.js',
    apply: (s) => s.replace('var rn = Math.min(REACTION_LOOKUPS_PER_RUN, budget);', 'var rn = 1000;'),
  },
  {
    name: 'topic lookups run after a throttle',
    suite: 'tests/reactions-lookups.test.js',
    apply: (s) => s.replace('if (stale() || (er && er.stoppedEarly)) return outcome;', 'if (stale()) return outcome;'),
  },
  {
    name: 'an unknown thumbs figure renders 0',
    suite: 'tests/panel.test.js',
    apply: (s) => s.replace("parts = rx('-') + ' up, ' + rx('-') + ' down';", "parts = rx('0') + ' up, ' + rx('0') + ' down';"),
  },
  {
    name: 'the reactions line renders while collapsed',
    suite: 'tests/panel.test.js',
    apply: (s) => s.replace("    if (model.collapsed) return out.join('');",
      "    out.push(renderReactions(model));\n    if (model.collapsed) return out.join('');"),
  },
  {
    name: 'the subscriber sentence is dropped',
    suite: 'tests/panel.test.js',
    apply: (s) => s.replace("var NO_SUBSCRIBERS = ' Torn\\'s API has no subscriber count, so none is shown.';",
      "var NO_SUBSCRIBERS = '';"),
  },
  // -- forum karma (#10) -----------------------------------------------------
  {
    name: 'unknown karma renders 0',
    suite: 'tests/karma.test.js',
    apply: (s) => s.replace("if (!isReactionNumber(n, true)) return '-';", "if (!isReactionNumber(n, true)) return '0';"),
  },
  {
    name: 'the panel turns unknown karma into 0',
    suite: 'tests/panel.test.js',
    apply: (s) => s.replace('var karma = isReactionNumber(r.karma, true) ? r.karma : null;',
      'var karma = isReactionNumber(r.karma, true) ? r.karma : 0;'),
  },
  {
    name: 'the karma fallback runs in the default refresh',
    suite: 'tests/karma-refresh.test.js',
    // refreshAll must never call readKarmaProfile.
    apply: (s) => s.replace(/(function refreshAll\([^)]*\)\s*\{)/,
      '$1 readKarmaProfile(toInt(arguments[0], 0), {}, state.generation);'),
  },
  {
    name: 'the karma fallback runs although a thread or post exists',
    suite: 'tests/karma-refresh.test.js',
    // Killed by the "row without karma" test: only an unknown karma leaves the
    // fallback due, so that is where the guard has to hold.
    apply: (s) => s.replace('if (threadRowCount !== 0 || postRowCount !== 0) return false;', ''),
  },
  {
    name: 'the karma icon keeps the owner file black instead of currentColor',
    suite: 'tests/karma.test.js',
    apply: (s) => s.replace('<path fill="currentColor" fill-rule="evenodd"', '<path fill="#000000" fill-rule="evenodd"'),
  },
  {
    name: 'a My posts merge drops the cached karma, re-arming the profile read every run',
    suite: 'tests/karma-refresh.test.js',
    apply: (s) => s.replace("if (typeof base.karma === 'number') {", 'if (false) {'),
  },
];

let failures = 0;
let checked = 0;

try {
  for (const m of MUTATIONS) {
    const mutated = m.apply(original);
    if (mutated === original) {
      console.log(`SKIP  ${m.name}\n      the mutation matched nothing - it is stale, fix it`);
      failures += 1;
      continue;
    }
    fs.writeFileSync(SOURCE, mutated);
    const run = spawnSync(process.execPath, ['--test', m.suite], {
      cwd: path.join(here, '..'),
      encoding: 'utf8',
      // A mutation can turn a bounded wait into an unbounded one. Without this,
      // one bad mutation hangs the whole check and the restore never runs.
      timeout: 60000,
    });
    checked += 1;
    if (run.error && run.error.code === 'ETIMEDOUT') {
      console.log(`HUNG  ${m.name}\n      ${m.suite} did not finish in 60s under this mutation`);
      failures += 1;
      fs.writeFileSync(SOURCE, original);
      continue;
    }
    if (run.status === 0) {
      console.log(`WEAK  ${m.name}\n      ${m.suite} still passes - nothing guards this`);
      failures += 1;
    } else {
      const caught = (run.stdout.match(/^✖ (?!.*tests\\).*/gm) || [])
        .slice(0, 3)
        .map((l) => l.replace(/\s*\(\d.*/, '').trim());
      console.log(`OK    ${m.name}\n      caught by: ${caught.join(' | ') || '(a suite failure)'}`);
    }
    fs.writeFileSync(SOURCE, original);
  }
} finally {
  fs.writeFileSync(SOURCE, original);
}

console.log(`\n${checked - failures}/${MUTATIONS.length} promises are genuinely guarded.`);
process.exit(failures === 0 ? 0 : 1);
