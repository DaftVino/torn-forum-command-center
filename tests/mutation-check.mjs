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
      // The first `return lines.join` in the file is the Markdown renderer's,
      // so the target is anchored on the report's own last line.
      "authorTooMany + ')',\n    ];\n    return lines.join('\\n');",
      "authorTooMany + ')',\n    ];\n    return lines.join('\\n') + '\\n' + JSON.stringify(state.organizer) + JSON.stringify(state.drafts);",
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
      "          state.drafts = saveDraft(state.drafts, thread, source, Date.now(), '', 'html');",
      '          void source;',
    ),
  },
  {
    name: 'an emptied reply box is autosaved over the draft',
    suite: 'tests/staleness.test.js',
    apply: (s) => s.replace("          if (!htmlToText(post).trim() && post.indexOf('<img') === -1) return;\n", ''),
  },
  {
    name: 'autosave overwrites a Markdown draft with Torn\'s HTML',
    suite: 'tests/editor-insert.test.js',
    apply: (s) => s.replace("          if (existing && draftLangOf(existing) !== 'html') return;\n", ''),
  },
  {
    name: 'a pending autosave saves to whichever thread is open now',
    suite: 'tests/editor-insert.test.js',
    apply: (s) => s.replace("if (!state.route || String(state.route.threadId) !== thread || autosaveBox !== box) return;", 'thread = String(state.route.threadId);'),
  },
  {
    name: 'autosave stores an over-limit post, cut short',
    suite: 'tests/editor-insert.test.js',
    apply: (s) => s.replace('          if (source.length > DRAFT_MAX_CHARS) return;\n', ''),
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
    name: 'anchors lose their color and fall back to browser blue',
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
    name: 'dropdown options lose the panel colors',
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
    name: 'panel content takes its color from the host page again',
    suite: 'tests/style.test.js',
    apply: (s) => s.replace(
      "      '#' + PANEL_ID + ' * { color: inherit; background: transparent; }',",
      '',
    ),
  },
  {
    name: 'table cells go back to inheriting their color',
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
      '      ? raw.autoHideOnOpen === true : d.autoHideOnOpen;',
      '      ? !!raw.autoHideOnOpen : d.autoHideOnOpen;',
    ),
  },
  {
    name: 'auto-hide is off again by default (#30)',
    suite: 'tests/auto-hide.test.js',
    apply: (s) => s.replace('      autoHideOnOpen: true,', '      autoHideOnOpen: false,'),
  },
  {
    name: 'a stored false for auto-hide is overridden by the new default (#30)',
    suite: 'tests/auto-hide.test.js',
    apply: (s) => s.replace('      ? raw.autoHideOnOpen === true : d.autoHideOnOpen;',
      '      ? raw.autoHideOnOpen !== false || d.autoHideOnOpen : d.autoHideOnOpen;'),
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
    // #43: the pressed-rule mutation it replaces guarded a rule the owner removed.
    name: '#43: My posts gets a fill of its own again, and looks selected',
    suite: 'tests/style.test.js',
    apply: (s) => s.replace("' button.tfcc-nav-mine { margin-left: auto; }',",
      "' button.tfcc-nav-mine { margin-left: auto; background: #d9d9d9; color: #141414; }',"),
  },
  {
    name: '#43: My posts is bold where the other nav buttons are not (PR #44 review)',
    suite: 'tests/style.test.js',
    apply: (s) => s.replace("' button.tfcc-nav-mine { margin-left: auto; }',", "' button.tfcc-nav-mine { margin-left: auto; font-weight: bold; }',"),
  },
  {
    name: '#43: a wide info button misses its listed hover note (PR #44 review)',
    suite: 'tests/wide-parity.test.js',
    apply: (s) => s.replace("+ '\" title=\"' + escapeHtml(INFO_KEYS[key]) + '\">'", "+ '\" title=\"' + escapeHtml(key) + '\">'"),
  },
  {
    name: '#43: the wide My posts color leaves the listed replacement',
    suite: 'tests/wide-parity.test.js',
    apply: (s) => s.replace("' button.tfcc-nav-mine { margin-left: auto; }',",
      "' button.tfcc-nav-mine { margin-left: auto; font-weight: bold; }',"),
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
    apply: (s) => s.replace('        inThreads: !!api || !rec || isOrganized(entry, !!draft),', '        inThreads: true,'),
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
    apply: (s) => s.replace('      threads: capRows(threadsSorted, limit,', '      threads: capRows(visible, limit,'),
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
      "      out.rowsShown = typeof raw.rowsShown === 'number' && ROWS_SHOWN_OPTIONS.indexOf(raw.rowsShown) !== -1",
      "      out.rowsShown = typeof raw.rowsShown === 'number' && raw.rowsShown >= 0",
    ),
  },
  {
    name: 'rows shown defaults to All again (#30)',
    suite: 'tests/storage.test.js',
    apply: (s) => s.replace('      rowsShown: 5,', '      rowsShown: 0,'),
  },
  {
    name: 'an absent rows shown becomes All instead of the default (#30)',
    suite: 'tests/storage.test.js',
    apply: (s) => s.replace("    if (Object.prototype.hasOwnProperty.call(raw, 'rowsShown')) {",
      "    if (true) {"),
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
    apply: (s) => s.replace('if (stale() || throttled) return outcome;', 'if (stale()) return outcome;'),
  },
  {
    name: 'an unknown thumbs figure renders 0',
    suite: 'tests/panel.test.js',
    apply: (s) => s.replace("parts = rx('-') + ' ' + thumb(THUMB_UP) + ' ' + rx('-') + ' ' + thumb(THUMB_DOWN);",
      "parts = rx('0') + ' ' + thumb(THUMB_UP) + ' ' + rx('0') + ' ' + thumb(THUMB_DOWN);"),
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
  // ---- badges (issue #9) ----
  { name: 'badges: the dwell threshold is zero', suite: 'tests/badges-engine.test.js',
    apply: (s) => s.replace('var DWELL_MS = 15000;', 'var DWELL_MS = 0;') },
  { name: 'badges: blur does not pause the dwell clock', suite: 'tests/badges-engine.test.js',
    apply: (s) => s.replace('if (!active) { next.lastAt = 0; return { dwell: next, credit: null }; }',
      'if (!active) { return { dwell: next, credit: null }; }') },
  { name: 'badges: one late sample can add any amount', suite: 'tests/badges-engine.test.js',
    apply: (s) => s.replace('next.accMs += clamp(t - next.lastAt, 0, DWELL_MAX_STEP_MS);',
      'next.accMs += Math.max(0, t - next.lastAt);') },
  { name: 'badges: the same day can be credited twice', suite: 'tests/badges-engine.test.js',
    apply: (s) => s.replace("if (delta === 0) return { streak: s, credited: false };", '') },
  { name: 'badges: a missed day is bridged', suite: 'tests/badges-engine.test.js',
    apply: (s) => s.replace('s.current = delta === 1 ? s.current + 1 : 1;', 's.current = s.current + 1;') },
  { name: 'badges: a break resets best', suite: 'tests/badges-engine.test.js',
    apply: (s) => s.replace('s.best = Math.max(s.best, s.current);\n    return { streak: s, credited: true };\n  }\n\n  function streakView',
      's.best = s.current;\n    return { streak: s, credited: true };\n  }\n\n  function streakView') },
  { name: 'badges: a stored future day blocks later days', suite: 'tests/badges-engine.test.js',
    apply: (s) => s.replace('if (delta < 0) { s.lastDay = d; return { streak: s, credited: false }; }',
      'if (delta < 0) return { streak: s, credited: false };') },
  { name: 'badges: stale data checks in', suite: 'tests/badges-engine.test.js',
    apply: (s) => s.replace('&& fetchedAt >= now - CHECKIN_FRESH_MS', '&& fetchedAt >= 0') },
  { name: 'badges: any ten visits count toward the backlog', suite: 'tests/badges-engine.test.js',
    apply: (s) => s.replace('if (r.today.backlogIds.indexOf(r.today.visitIds[i]) !== -1) hits += 1;', 'hits += 1;') },
  { name: 'badges: import sums visits', suite: 'tests/badges-engine.test.js',
    apply: (s) => s.replace('out.visits = Math.max(a.visits, b.visits);', 'out.visits = a.visits + b.visits;') },
  { name: 'badges: an upgrade is called damage', suite: 'tests/badges-storage.test.js',
    apply: (s) => s.replace('var recovered = (recoveredCheck || isRecoveredValue)(raw, value);',
      'var recovered = raw !== null && JSON.stringify(raw) !== JSON.stringify(value);') },
  { name: 'badges: the chip is dropped when collapsed', suite: 'tests/badges-runtime.test.js',
    apply: (s) => s.replace("+ renderBadgeChip(model) + '</div>';", "+ (model.collapsed ? '' : renderBadgeChip(model)) + '</div>';") },
  { name: 'badges: a render writes', suite: 'tests/badges-runtime.test.js',
    apply: (s) => s.replace('function buildPanelModel(now) {\n    var s = state.settings;',
      "function buildPanelModel(now) {\n    recordBadgeEvent({ type: 'visit', threadId: String(now % 1000000), forumId: 0 }, now);\n    var s = state.settings;") },
  { name: 'badges: writes come from memory, not a fresh read', suite: 'tests/badges-runtime.test.js',
    apply: (s) => s.replace('var stored = loadKey(STORAGE_KEYS.badges, normaliseBadges, now).value;', 'var stored = state.badges;') },
  { name: 'badges: off still records', suite: 'tests/badges-runtime.test.js',
    apply: (s) => s.replace('if (!state.settings.badges) return null;', '') },
  { name: 'badges: a hidden page accrues time', suite: 'tests/badges-runtime.test.js',
    apply: (s) => s.replace('if (doc.hidden === true) return false;', '') },
  { name: 'badges: an unfocused page accrues time', suite: 'tests/badges-runtime.test.js',
    apply: (s) => s.replace("if (typeof doc.hasFocus === 'function' && doc.hasFocus() !== true) return false;", '') },
  { name: 'badges: Reset everything keeps badges', suite: 'tests/badges-runtime.test.js',
    apply: (s) => s.replace('\n          persist(\'badges\');\n', '\n') },
  { name: 'badges: a tap on the cup misses the button', suite: 'tests/style.test.js',
    apply: (s) => s.replace("'#' + PANEL_ID + ' .tfcc-chip * { pointer-events: none; }',", '') },
  { name: 'a tap on a number or thumb in the reactions pill misses the button', suite: 'tests/style.test.js',
    apply: (s) => s.replace("'#' + PANEL_ID + ' button * { pointer-events: none; }',", '') },
  { name: 'badges: the day turns over at a local 04:00', suite: 'tests/badges-engine.test.js',
    apply: (s) => s.replace('return Math.floor(toInt(now, 0) / DAY_MS);',
      'return Math.floor((toInt(now, 0) - 4 * 3600000) / DAY_MS);') },
  { name: 'badges: a route change keeps the dwell time', suite: 'tests/badges-engine.test.js',
    apply: (s) => s.replace('return { dwell: { threadId: id, accMs: 0, lastAt: id && active ? t : 0, done: false }, credit: null };',
      'return { dwell: { threadId: id, accMs: d.accMs, lastAt: id && active ? t : 0, done: false }, credit: null };') },
  { name: 'badges: a thread counts twice in one Torn day', suite: 'tests/badges-engine.test.js',
    apply: (s) => s.replace('r.today.visitIds.indexOf(id) === -1', 'true') },
  { name: 'badges: Catch up rows do not block a check-in', suite: 'tests/badges-engine.test.js',
    apply: (s) => s.replace('&& toInt(ctx.blockers, 0) === 0;', ';') },
  { name: 'badges: an author-only unchecked row does not block a check-in', suite: 'tests/badges-runtime.test.js',
    apply: (s) => s.replace('var cu = catchUpRowsNow().concat(catchUpUncheckedNow());', 'var cu = catchUpRowsNow();') },
  // -- QA polish (#30) ------------------------------------------------------
  { name: 'the header logo loses its accessible name', suite: 'tests/panel.test.js',
    apply: (s) => s.replace(' role="img" aria-label="Forum Command Center" focusable="false">', ' focusable="false">') },
  { name: 'a host svg fill rule can repaint the logo', suite: 'tests/style.test.js',
    apply: (s) => s.replace("      '#' + PANEL_ID + ' .tfcc-logo path { fill: currentColor; }',\n", '') },
  { name: 'the inline priority controls are dropped from the row', suite: 'tests/panel.test.js',
    apply: (s) => s.replace('    out.push(renderPriority(row));\n', '') },
  { name: 'a priority button lands inside the thread link', suite: 'tests/panel.test.js',
    apply: (s) => s.replace("      + escapeHtml(row.title) + '</a></span>');",
      "      + escapeHtml(row.title) + renderPriority(row) + '</a></span>');") },
  { name: 'a priority button comes back to the action row', suite: 'tests/panel.test.js',
    apply: (s) => s.replace("    out.push(btn('read', 'Mark read', ' data-id=\"' + escapeHtml(row.id) + '\"'));",
      "    out.push(btn('read', 'Mark read', ' data-id=\"' + escapeHtml(row.id) + '\"'));\n"
      + "    out.push(btn('prio-up', 'Priority +', ' data-id=\"' + escapeHtml(row.id) + '\"'));") },
  { name: 'the reactions pill lands after My posts instead of before it', suite: 'tests/panel.test.js',
    apply: (s) => s.replace("      if (v === 'mine') out.push(renderReactions(model));\n", '')
      .replace("    out.push('</div>');\n    return out.join('');\n  }\n\n  // The thread's priority adjustment",
        "    out.push(renderReactions(model));\n    out.push('</div>');\n    return out.join('');\n  }\n\n  // The thread's priority adjustment") },
  { name: 'the thumbs are read aloud as emoji names', suite: 'tests/panel.test.js',
    apply: (s) => s.replace('<span class="tfcc-thumb" aria-hidden="true">', '<span class="tfcc-thumb">') },
  { name: 'the thumbs keep their colors in the dark theme', suite: 'tests/style.test.js',
    apply: (s) => s.replace(' .tfcc-thumb { filter: grayscale(1) brightness(0) invert(1); }', ' .tfcc-thumb { }') },
  { name: '"started" loses its red class', suite: 'tests/panel.test.js',
    apply: (s) => s.replace('<span class="tfcc-tag tfcc-started">started</span>', '<span class="tfcc-tag">started</span>') },
  { name: 'the light theme "started" red drops below AA', suite: 'tests/style.test.js',
    apply: (s) => s.replace("'  --tfcc-started: #a11414;',", "'  --tfcc-started: #e06060;',") },
  { name: 'badges: the reactions pill jumps ahead of the badge shelf', suite: 'tests/badges-runtime.test.js',
    apply: (s) => s.replace('    out.push(renderBadgeShelf(model));',
      '    out.push(renderReactions(model));\n    out.push(renderBadgeShelf(model));') },
  // My posts follow-ups (#24).
  { name: 'my posts: a stale run still writes its error', suite: 'tests/staleness.test.js',
    apply: (s) => s.replace("        if (stale()) return { ok: false, reason: 'stale' };\n        return fail({ reason: 'network'",
      "        return fail({ reason: 'network'") },
  { name: 'a new notice stacks instead of replacing the old one', suite: 'tests/navigation.test.js',
    apply: (s) => s.replace("    state.notices = [{ text: safeString(text, 300), kind: k }];",
      "    state.notices.push({ text: safeString(text, 300), kind: k });") },
  { name: 'navigating to another route keeps the old notice', suite: 'tests/navigation.test.js',
    apply: (s) => s.replace('    if (routeKey(state.route) !== routeKey(capture.route)) { state.notices = []; persistFailed = false; }', '') },
  { name: 'leaving the forums page keeps the old notice', suite: 'tests/navigation.test.js',
    apply: (s) => s.replace('      state.route = null;\n      state.notices = [];\n', '      state.route = null;\n') },
  // #58 final review: one central guard, in notice() and persist(), keeps a
  // failed write's error over its own action's success message.
  { name: 'Draft saved replaces the error of a failed save', suite: 'tests/editor-view.test.js',
    apply: (s) => s.replace("    if (k === 'info' && persistFailed) return;\n", '') },
  { name: 'a success notice hides a failed write in Clear post cache, Fix image links, Import, Insert', suite: 'tests/navigation.test.js',
    apply: (s) => s.replace("    if (k === 'info' && persistFailed) return;\n", '') },
  { name: 'a failed write never raises the hold on success notices', suite: 'tests/navigation.test.js',
    apply: (s) => s.replace('    if (!res.ok) { persistFailed = true; notice(', '    if (!res.ok) { notice(') },
  { name: 'a failed write holds back the next action notices too', suite: 'tests/navigation.test.js',
    apply: (s) => s.replace('        // A new action: an earlier failed write no longer holds back its notices.\n        persistFailed = false;\n', '') },
  { name: 'a panel view change keeps the old notice', suite: 'tests/navigation.test.js',
    apply: (s) => s.replace("      if (v !== state.settings.view) { applyTransient({ type: 'view' }); state.notices = []; }",
      "      if (v !== state.settings.view) { applyTransient({ type: 'view' }); }") },
  { name: 'undo: a same-draft reload is not its own step (Undo jumps past newer stored text)', suite: 'tests/editor-undo.test.js',
    apply: (s) => s.replace('        pushUndo(state.editor, keep);\n', '') },
  { name: 'B2: the mirrored field live selection is ignored once unfocused', suite: 'tests/editor-feedback.test.js',
    apply: (s) => s.replace('      if (doc.activeElement === f || (f === lastSelField && String(f.value) === state.editor.text)) {',
      '      if (doc.activeElement === f) {') },
  { name: 'three damaged stores lose the commas', suite: 'tests/storage.test.js',
    apply: (s) => s.replace("    return names.slice(0, -1).join(', ') + ', and ' + names[names.length - 1];", "    return names.join(' and ');") },
  { name: 'only the last damaged store is reported at load', suite: 'tests/storage.test.js',
    apply: (s) => s.replace('if (pair[1].recovered) damaged.push(pair[0]);', 'if (pair[1].recovered) damaged = [pair[0]];') },
  { name: 'my posts: a throttle is never recorded', suite: 'tests/mine-refresh.test.js',
    apply: (s) => s.replace('state.mineThrottled = throttled;', 'state.mineThrottled = false;') },
  { name: 'my posts: the throttle notice is not rendered', suite: 'tests/mine-refresh.test.js',
    apply: (s) => s.replace('    if (m.throttled) {', '    if (false) {') },
  { name: 'my posts: the throttle notice never clears', suite: 'tests/mine-refresh.test.js',
    apply: (s) => s.replace('state.mineThrottled = throttled;', 'state.mineThrottled = state.mineThrottled || throttled;') },
  { name: 'my posts: dropped threads are not counted', suite: 'tests/mine-refresh.test.js',
    apply: (s) => s.replace('state.mineDropped = { threads: list.length - started.length, posts: 0 };',
      'state.mineDropped = { threads: 0, posts: 0 };') },
  { name: 'my posts: dropped posts are not counted', suite: 'tests/mine-refresh.test.js',
    apply: (s) => s.replace('state.mineDropped.posts = plist.length - posts.length;', '') },
  { name: 'catch up: Mark all read stops at the rows cap', suite: 'tests/rows-cap.test.js',
    apply: (s) => s.replace("        if (act === 'markall') {\n          for (var i = 0; i < state.rows.length; i += 1) {",
      "        if (act === 'markall') {\n          for (var i = 0; i < Math.min(state.rows.length, toInt(state.settings.rowsShown, 0) || state.rows.length); i += 1) {") },
  // ---- #33: condense the narrow mobile view -------------------------------
  {
    name: 'Catch up loses its one-tap Read',
    suite: 'tests/narrow-view.test.js',
    apply: (s) => s.replace('if (inCatchUp) out.push(readButton(row));', 'if (false) out.push(readButton(row));'),
  },
  {
    name: 'Read is offered twice in Catch up',
    suite: 'tests/narrow-view.test.js',
    apply: (s) => s.replace('if (!inCatchUp) out.push(readButton(row));', 'out.push(readButton(row));'),
  },
  {
    name: 'a stale open row is not reconciled',
    suite: 'tests/narrow-engine.test.js',
    apply: (s) => s.replace('if (out.openRowId !== null && ids.indexOf(out.openRowId) === -1) out.openRowId = null;', ''),
  },
  {
    name: 'the model build no longer reconciles',
    suite: 'tests/narrow-state.test.js',
    apply: (s) => s.replace(
      'setTransient(reconcileTransient(currentTransient(), renderedIds, INFO_KEYS_BY_VIEW[s.view] || []));', ''),
  },
  {
    name: 'the focus plan skips the next row',
    suite: 'tests/narrow-engine.test.js',
    apply: (s) => s.replace('if (at + 1 < ids.length) out.push(', 'if (false) out.push('),
  },
  {
    name: 'focus is never restored after a redraw',
    suite: 'tests/narrow-focus.test.js',
    apply: (s) => s.replace('if (plan) restoreFocus(panel, plan);', ''),
  },
  {
    name: 'the breakpoint loses its hysteresis',
    suite: 'tests/narrow-engine.test.js',
    apply: (s) => s.replace('if (width > NARROW_LEAVE_PX) return false;', 'if (width > NARROW_ENTER_PX) return false;'),
  },
  {
    name: 'header buttons go under the 24px floor',
    suite: 'tests/narrow-engine.test.js',
    apply: (s) => s.replace('for (var s = HB_MAX; s >= HB_MIN; s -= HB_STEP) {', 'for (var s = HB_MAX; s >= 12; s -= HB_STEP) {'),
  },
  {
    name: 'header buttons grow past 44px',
    suite: 'tests/narrow-engine.test.js',
    apply: (s) => s.replace('var HB_MAX = 44;', 'var HB_MAX = 48;'),
  },
  {
    name: 'the chip never goes compact',
    suite: 'tests/narrow-runtime.test.js',
    apply: (s) => s.replace('if (r.size < HB_COMPACT_BELOW && chip && chip.classList) {', 'if (false) {'),
  },
  {
    name: 'the narrow class never reaches the panel',
    suite: 'tests/narrow-runtime.test.js',
    apply: (s) => s.replace("if (panel.classList) panel.classList.toggle(NARROW_CLASS, state.narrow === true);", ''),
  },
  {
    name: 'the ResizeObserver is never set up',
    suite: 'tests/narrow-runtime.test.js',
    apply: (s) => s.replace("if (typeof ResizeObserver !== 'function') return false;", 'return false;'),
  },
  {
    name: 'crossing the breakpoint keeps the drawer open',
    suite: 'tests/narrow-runtime.test.js',
    apply: (s) => s.replace("applyTransient({ type: 'breakpoint' });", ''),
  },
  {
    name: 'a view change keeps the drawer open',
    suite: 'tests/narrow-state.test.js',
    apply: (s) => s.replace("if (v !== state.settings.view) { applyTransient({ type: 'view' }); state.notices = []; }", "if (v !== state.settings.view) { state.notices = []; }"),
  },
  {
    name: 'auto-hide leaves the drawer open',
    suite: 'tests/auto-hide.test.js',
    apply: (s) => s.replace("else if (next.collapsed === true && state.settings.collapsed !== true) applyTransient({ type: 'collapse' });", ''),
  },
  {
    name: 'a narrow selected nav label loses contrast',
    suite: 'tests/style.test.js',
    apply: (s) => s.replace('--tfcc-navnum-opacity-selected: 0.09;', '--tfcc-navnum-opacity-selected: 0.14;'),
  },
  {
    name: 'the reactions pill returns to the narrow nav',
    suite: 'tests/narrow-view.test.js',
    apply: (s) => s.replace("var out = ['<div class=\"tfcc-nav tfcc-navgrid\">'];",
      "var out = ['<div class=\"tfcc-nav tfcc-navgrid\">' + renderReactions(model)];"),
  },
  // #53: the narrow My posts reactions pill.
  ...[
    ['the narrow pill is a button again', (s) => s.replace(
      "return '<div class=\"tfcc-rxpill'", "return '<button type=\"button\" class=\"tfcc-rxpill'")],
    ['the narrow pill gets a data-act', (s) => s.replace(
      "+ '\" role=\"group\" aria-label=\"'", "+ '\" data-act=\"view\" data-view=\"mine\" role=\"group\" aria-label=\"'")],
    ['the narrow pill gets a title', (s) => s.replace(
      "+ '\" role=\"group\" aria-label=\"'", "+ '\" title=\"' + escapeHtml(title) + '\" role=\"group\" aria-label=\"'")],
    ['the narrow pill renders the nav button', (s) => s.replace(
      'var rx = renderReactionsPill(model);', 'var rx = renderReactions(model);')],
    ['the pill aria-label drops net', (s) => s.replace(
      "+ (r.netThreads > 0 ? ', net ' + formatSigned(r.net) + ' on ' + r.netThreads + ' more' : '');\n    } else if (known) {\n      spoken = 'net '",
      ";\n    } else if (known) {\n      spoken = 'net '")],
    ['the pill shows net on the visible line', (s) => s.replace(
      "+ '<span class=\"tfcc-rxdot\" aria-hidden=\"true\">\\u2022</span>';",
      "+ (r.netThreads > 0 ? ' net ' + rx(formatSigned(r.net)) : '') + '<span class=\"tfcc-rxdot\" aria-hidden=\"true\">\\u2022</span>';")],
    ['an unknown thumb shows 0', (s) => s.replace(
      "lead = rx(thumbs ? formatCount(r.up) : '-')", "lead = rx(thumbs ? formatCount(r.up) : '0')")],
    ['the thumbs clause appears when every thread is checked', (s) => s.replace(
      '    if (n <= 0) return \'\';\n    return \'Thumbs pending', '    return \'Thumbs pending')],
    ['the thumbs clause never appears', (s) => s.replace('if (pending) status.push(pending);', '')],
    ['the thumbs clause reaches the wide status line', (s) => s.replace(
      'if (!model.narrow || !model.hasKey || !r) return \'\';', 'if (!model.hasKey || !r) return \'\';')],
    ['a stale pill loses tfcc-stale', (s) => s.replace(
      "'<div class=\"tfcc-rxpill' + (stale ? ' tfcc-stale' : '')", "'<div class=\"tfcc-rxpill'")],
    ['a stale pill loses its visible age', (s) => s.replace(
      "+ (age ? '<span class=\"tfcc-rxage\">' + escapeHtml(age) + '</span>' : '')", '')],
    ['the pill line stops centring', (s) => s.replace(
      '.tfcc-rxline { display: flex; justify-content: center;', '.tfcc-rxline { display: flex; justify-content: flex-start;')],
    ['the pill stretches to the full width', (s) => s.replace(
      ".tfcc-rxpill { display: inline-flex;", ".tfcc-rxpill { display: inline-flex; width: 100%;")],
    ['the pill gets a border', (s) => s.replace(
      "'  border: 0; border-radius: 999px; background: var(--tm-bg-2);", "'  border: 1px solid var(--tm-border); border-radius: 999px; background: var(--tm-bg-2);")],
  ].map(([name, apply]) => ({ name: '#53: ' + name, suite: 'tests/narrow-view.test.js', apply })),
  // #53 (owner): the logo's per-theme color.
  ...[
    ['the light logo is the raw #5C768F again', (s) => s.replace(
      "'  --tfcc-logo: #2e4a66;',", "'  --tfcc-logo: #5c768f;',")],
    ['the light logo goes black', (s) => s.replace(
      "'  --tfcc-logo: #2e4a66;',", "'  --tfcc-logo: #141414;',")],
    ['the dark logo changes color', (s) => s.replace(
      "'  --tfcc-logo: #5c768f;',", "'  --tfcc-logo: #8db3d9;',")],
    ['the logo rule ignores the token', (s) => s.replace(
      "'  color: var(--tfcc-logo); }',", "'  color: #5c768f; }',")],
  ].map(([name, apply]) => ({ name: '#53: ' + name, suite: 'tests/style.test.js', apply })),
  { name: 'the default theme is Dark again, not Match Torn', suite: 'tests/storage.test.js',
    apply: (s) => s.replace("      theme: 'match',", "      theme: 'dark',") },
  { name: '#53: an unlisted wide logo line', suite: 'tests/wide-parity.test.js',
    apply: (s) => s.replace("'  color: var(--tfcc-logo); }',", "'  color: var(--tfcc-logo); opacity: 1; }',") },
  {
    name: 'the collapsed count says "16 new" to sighted users',
    suite: 'tests/narrow-view.test.js',
    apply: (s) => s.replace(
      "count = '<span class=\"tfcc-badge tfcc-hcount\"><span aria-hidden=\"true\">' + escapeHtml(n) + '</span>'",
      "count = '<span class=\"tfcc-badge tfcc-hcount\"><span aria-hidden=\"true\">' + escapeHtml(said) + '</span>'"),
  },
  {
    name: 'wide rows render the narrow markup',
    suite: 'tests/wide-parity.test.js',
    apply: (s) => s.replace('return model.narrow ? renderRowNarrow(row, model) : renderRow(row, model);',
      'return renderRowNarrow(row, model);'),
  },
  {
    name: 'a closed explanation is shown anyway',
    suite: 'tests/info.test.js',
    apply: (s) => s.replace("+ (openKey === key ? '' : ' hidden') + '>' + html + '</p>';", "+ '>' + html + '</p>';"),
  },
  {
    name: 'the visible budget line stops following the setting',
    suite: 'tests/info.test.js',
    apply: (s) => s.replace("+ (3 + budget) + ' requests and My posts at most '", "+ 13 + ' requests and My posts at most '"),
  },
  {
    name: 'the Filters count ignores the tag filter',
    suite: 'tests/narrow-engine.test.js',
    apply: (s) => s.replace('return (s.folderFilter ? 1 : 0) + (s.tagFilter ? 1 : 0);', 'return (s.folderFilter ? 1 : 0);'),
  },
  {
    name: 'a press no longer holds the redraw',
    suite: 'tests/dirty-input.test.js',
    apply: (s) => s.replace('if (state.pressActive) { state.pendingRedraw = true; return; }', ''),
  },
  {
    // #43: the inline note field is the wide row's; the drawer's is a popup.
    name: 'a forced redraw drops what was typed in a note field',
    suite: 'tests/dirty-input.test.js',
    apply: (s) => s.replace("escapeHtml(edit && edit.field === 'note-input' ? edit.value : row.note) + '\" placeholder=\"note\" size=\"14\">');",
      "escapeHtml(row.note) + '\" placeholder=\"note\" size=\"14\">');"),
  },
  {
    name: '#43: a forced redraw drops what was typed in the drawer popup',
    suite: 'tests/compact-drawer.test.js',
    apply: (s) => s.replace("var value = edit && edit.field === mirror ? edit.value : (field === 'note' ? row.note : '');",
      "var value = field === 'note' ? row.note : '';"),
  },
  {
    name: 'the live region never renders',
    suite: 'tests/narrow-focus.test.js',
    apply: (s) => s.replace("if (!model.live) return '';", "return '';"),
  },
  {
    name: 'narrow text fields fall under 16px',
    suite: 'tests/style.test.js',
    apply: (s) => s.replace("'#' + PANEL_ID + '.tfcc-narrow textarea { font-size: max(16px, 1em); }',",
      "'#' + PANEL_ID + '.tfcc-narrow textarea { font-size: 12px; }',"),
  },
  {
    name: 'narrow controls shrink under 44px',
    suite: 'tests/style.test.js',
    apply: (s) => s.replace("'#' + PANEL_ID + '.tfcc-narrow button { min-height: 44px; min-width: 44px; }',",
      "'#' + PANEL_ID + '.tfcc-narrow button { min-height: 40px; min-width: 40px; }',"),
  },
  // ---- #33, added by the plan review ----------------------------------------
  {
    name: 'the no-click flush is armed on pointerdown, so a slow tap loses its target',
    suite: 'tests/dirty-input.test.js',
    apply: (s) => s.replace('state.pressActive = true;\n  }', 'state.pressActive = true;\n    armPressTimer(doc, win, handlers);\n  }'),
  },
  {
    name: 'the no-click flush is not 300ms',
    suite: 'tests/dirty-input.test.js',
    apply: (s) => s.replace('var PRESS_FLUSH_MS = 300;', 'var PRESS_FLUSH_MS = 3000;'),
  },
  {
    name: 'a thread-link click flushes inside its own dispatch',
    suite: 'tests/dirty-input.test.js',
    apply: (s) => s.replace('if (pressed) setTimeout(function () { flushAfterPress(doc, win, handlers); }, 0);',
      'if (pressed) flushAfterPress(doc, win, handlers);'),
  },
  {
    name: 'a pointerup outside the panel never ends the press',
    suite: 'tests/dirty-input.test.js',
    apply: (s) => s.replace("win.addEventListener('pointerup', function () { armPressTimer(doc, win, handlers); }, true);", ''),
  },
  {
    name: 'a background completion forces through the caret',
    suite: 'tests/dirty-input.test.js',
    apply: (s) => s.replace('draw(doc, win, handlers, false);\n    }', 'draw(doc, win, handlers, true);\n    }'),
  },
  {
    name: 'crossing the breakpoint drops an uncommitted edit',
    suite: 'tests/narrow-engine.test.js',
    apply: (s) => s.replace('return { openRowId: null, filtersOpen: false, openInfoId: null, drawerEdit: out.drawerEdit };',
      'return freshTransient();'),
  },
  {
    name: 'a deferred redraw updates the focus bookkeeping',
    suite: 'tests/narrow-focus.test.js',
    apply: (s) => s.replace('var rewrote = !!panel && panel.__tfccHtml !== htmlBefore;', 'var rewrote = !!panel;'),
  },
  {
    name: 'a text field\'s commit redraws at once and pulls focus back into it',
    suite: 'tests/narrow-focus.test.js',
    apply: (s) => s.replace('if (state.deferCommit) {', 'if (false) {'),
  },
  {
    name: 'a select\'s change brings no focus plan',
    suite: 'tests/narrow-focus.test.js',
    apply: (s) => s.replace('if (!text) state.focusIntent = focusPlan(focusTargetOf(t), lastRender);',
      'if (false) state.focusIntent = focusPlan(focusTargetOf(t), lastRender);'),
  },
  {
    name: 'a settings replacement that changes the view skips the reset',
    suite: 'tests/narrow-state.test.js',
    apply: (s) => s.replace("if (next.view !== state.settings.view) applyTransient({ type: 'view' });", ''),
  },
  {
    name: 'fitHeader reads the document instead of the panel',
    suite: 'tests/narrow-focus.test.js',
    apply: (s) => s.replace("var chip = panel.querySelector('.tfcc-chip');",
      "var chip = panel.querySelector('.tfcc-chip') || document.querySelector('.tfcc-chip');"),
  },
  {
    name: 'Show is measured at one size only',
    suite: 'tests/narrow-runtime.test.js',
    apply: (s) => s.replace('slope = (width(show) - show24) / (HB_MAX - HB_MIN);', 'slope = 0;'),
  },
  {
    name: 'an info bar lets its button wrap away from its note',
    suite: 'tests/style.test.js',
    apply: (s) => s.replace("'  flex-wrap: nowrap; margin-bottom: var(--tfcc-gap-sm); }',", "'  flex-wrap: wrap; margin-bottom: var(--tfcc-gap-sm); }',"),
  },
  {
    name: 'narrow Catch up loses the group that keeps its info button on the line',
    suite: 'tests/narrow-view.test.js',
    apply: (s) => s.replace("if (model.narrow) out.push('<span class=\"tfcc-infogroup\">');", "if (false) out.push('<span class=\"tfcc-infogroup\">');"),
  },
  {
    name: 'the collapsed count is left out of the header solve',
    suite: 'tests/narrow-engine.test.js',
    apply: (s) => s.replace("var count = typeof countW === 'number' && countW > 0 ? countW + HB_COUNT_GAP : 0;", 'var count = 0;'),
  },
  {
    name: 'fitHeader never measures the collapsed count',
    suite: 'tests/narrow-runtime.test.js',
    apply: (s) => s.replace("var countW = width(panel.querySelector('.tfcc-hcount'));", 'var countW = 0;'),
  },
  {
    name: 'a count that cannot fit shrinks the buttons instead of wrapping',
    suite: 'tests/narrow-runtime.test.js',
    apply: (s) => s.replace('if (!r.fits && countW > 0) r = solve(false);', ''),
  },
  {
    name: 'the narrow chip loses its 44px box',
    suite: 'tests/narrow-view.test.js',
    apply: (s) => s.replace("var inner = model.narrow ? '<span class=\"tfcc-pill\">'", "var inner = false ? '<span class=\"tfcc-pill\">'"),
  },
  // One per section 13d audit item (spec table numbers), each caught by the
  // literal owner map in tests/info.test.js.
  ...[
    ['2', "renderInfoButton('catchup', model.openInfoId)"],
    ['4', "renderInfoButton('mine', model.openInfoId)"],
    ['8', "renderInfoButton('search', model.openInfoId)"],
    ['17', "renderInfoButton('settings-budget', model.openInfoId)"],
    ['18', "renderInfoButton('settings-author', model.openInfoId)"],
    ['19', "renderInfoButton('settings-rows', model.openInfoId)"],
    ['20', "renderInfoButton('settings-autohide', model.openInfoId)"],
    ['21', "renderInfoButton('settings-folders', model.openInfoId)"],
    ['26', "renderInfoButton('settings-badges', model.openInfoId)"],
  ].map(([item, call]) => ({
    name: '13d item ' + item + ' loses its info button',
    suite: 'tests/info.test.js',
    apply: (s) => s.replace(call, "''"),
  })),
  {
    name: '13d item 11: the Drafts reply-box line is long again',
    suite: 'tests/info.test.js',
    apply: (s) => s.replace('No reply box here, so Copy replaces Insert.', 'No reply box was found on this page, so Insert is unavailable.'),
  },
  {
    name: '13d item 13: the key note is long again',
    suite: 'tests/info.test.js',
    apply: (s) => s.replace('Create a <strong>Minimal Access</strong> key on Torn (Settings, API Key).',
      'This script needs a key. Create a <strong>Minimal Access</strong> key on Torn (Settings, API Key).'),
  },
  {
    name: '13d item 16: the custom-key line is long again',
    suite: 'tests/info.test.js',
    apply: (s) => s.replace("Opens Torn in a new tab with only this script\\'s selections.",
      "This opens Torn in a new tab with only this script\\'s selections."),
  },
  {
    name: '13d item 23: the backup line is long again',
    suite: 'tests/info.test.js',
    apply: (s) => s.replace('Never includes your API key or the post cache.',
      'An export carries folders and tags. Never includes your API key or the post cache.'),
  },
  {
    name: '13d item 25: the debug line is long again',
    suite: 'tests/info.test.js',
    apply: (s) => s.replace('Never includes your key, drafts, notes or post text.',
      'A debug report carries counts. Never includes your key, drafts, notes or post text.'),
  },

  // ---- #39: narrow view polish ----------------------------------------------
  ...[
    // 1. The Catch up action row.
    ['the Catch up row never uses the short labels', (s) => s.replace('if (s !== null && s <= c) return CU_MODES[1];', '')],
    ['the Catch up row keeps the full labels even when they wrap', (s) => s.replace('if (f <= c) return CU_MODES[0];', 'return CU_MODES[0];')],
    ['the Catch up row is not fitted after a draw', (s) => s.replace('    fitCatchUp(panel || doc.getElementById(PANEL_ID), win);\n', '')],
    ['the Catch up row is not fitted on a resize', (s) => s.replace('{ fitHeader(panel, win); fitCatchUp(panel, win); return; }', '{ fitHeader(panel, win); return; }')],
    ['the Catch up accessible names take the short labels', (s) => s.replace('aria-label="\' + escapeHtml(full) + \'">\'', 'aria-label="\' + escapeHtml(short) + \'">\'')],
    ['the owner\'s short catch-up label is changed', (s) => s.replace("'Set catch-up point to now', 'Caught up')", "'Set catch-up point to now', 'Catch up')")],
    ['the short catch-up label goes back to the arrows (#41)', (s) => s.replace("'Set catch-up point to now', 'Caught up')",
      "'Set catch-up point to now', 'Catch-' + String.fromCharCode(8593) + ' 2 ' + String.fromCharCode(8595))")],
    ['the short Mark all read label is changed', (s) => s.replace("'Mark all read', 'All read')", "'Mark all read', 'Read all')")],
    ['the Catch up row may wrap', (s) => s.replace('.tfcc-cubar { flex-wrap: nowrap;', '.tfcc-cubar { flex-wrap: wrap;')],
    ['the Catch up wrap fallback keeps its labels on one line', (s) => s.replace(
      '.tfcc-cu-wrap .tfcc-cubar > button { flex: 1 1 0; min-width: 44px; white-space: normal; }',
      '.tfcc-cu-wrap .tfcc-cubar > button { flex: 1 1 0; min-width: 44px; white-space: nowrap; }')],
    // 2. One-line row text.
    ['a closed row\'s title is not cut to one line', (s) => s.replace("      '  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }',\n", "      '  }',\n")],
    ['the open row is not marked, so it never expands', (s) => s.replace("(open ? ' tfcc-open' : '')", "''")],
    // 3. The close toggle and click-away.
    ['the open toggle keeps the more glyph', (s) => s.replace("glyph(open ? 'close' : 'more')", "glyph('more')")],
    ['the open toggle is not named Close actions', (s) => s.replace("(open ? 'Close actions' :", "(open ? 'Actions' :")],
    ['dismiss no longer closes the drawer', (s) => s.replace("if (type === 'dismiss') { out.openRowId = null; if (drawerInfo) out.openInfoId = null; return out; }", '')],
    ['a tap elsewhere in the panel leaves the drawer open', (s) => s.replace('if (state.openRowId && !insideOpenDrawer(panel, t)) {', 'if (false) {')],
    ['a tap inside the drawer closes it', (s) => s.replace("return !!(drawer && typeof drawer.contains === 'function' && drawer.contains(t));", 'return false;')],
    // PR #40 review, finding 1: the closing redraw, and the press flush, run
    // after dispatch, so the tapped node keeps its native default action.
    ['the closing redraw runs inside the click and replaces the tapped node', (s) => s.replace(
      "          applyTransient({ type: 'dismiss' });\n          setTimeout(function () { draw(doc, win, handlers); }, 0);\n",
      "          applyTransient({ type: 'dismiss' });\n          draw(doc, win, handlers);\n")],
    ['the closing tap never redraws the drawer closed', (s) => s.replace(
      "          applyTransient({ type: 'dismiss' });\n          setTimeout(function () { draw(doc, win, handlers); }, 0);\n",
      "          applyTransient({ type: 'dismiss' });\n")],
    ['a held commit is flushed inside a native control\'s click', (s) => s.replace(
      '          if (pressed) setTimeout(function () { flushAfterPress(doc, win, handlers); }, 0);\n        };',
      '          if (pressed) flushAfterPress(doc, win, handlers);\n        };')],
    // PR #40 review, finding 2.
    ['the wrap fallback splits Mark against the whole catch-up group', (s) => s.replace(
      '.tfcc-cu-wrap .tfcc-cubar .tfcc-infogroup { display: contents; }',
      '.tfcc-cu-wrap .tfcc-cubar .tfcc-infogroup { flex: 1 1 0; min-width: 0; }')],
    ['the click-away window listener is never bound', (s) => s.replace(
      "win.addEventListener('click', function (ev) { closeDrawerFromOutside(ev); }, true);", '')],
    ['the click-away listener also closes on clicks inside the panel', (s) => s.replace('if (panel.contains(ev && ev.target)) return;', '')],
    ['the click-away listener cancels the outside click', (s) => s.replace(
      "      applyTransient({ type: 'dismiss' });\n      setTimeout(",
      "      if (ev && ev.preventDefault) ev.preventDefault();\n      applyTransient({ type: 'dismiss' });\n      setTimeout(")],
    // 4. The compact drawer.
    ['the drawer emoji reach screen readers', (s) => s.replace('\'<span class="tfcc-emo" aria-hidden="true">\'', '\'<span class="tfcc-emo">\'')],
    ['the archive button is named Delete', (s) => s.replace("emojiButton('archive', row.archived ? 'Unarchive' : 'Archive'", "emojiButton('archive', row.archived ? 'Unarchive' : 'Delete'")],
    ['a pinned row is not marked on its Pin button', (s) => s.replace("class=\"tfcc-emobtn' + (on ? ' tfcc-on' : '')", "class=\"tfcc-emobtn' + ''")],
    ['the drawer emoji stay in color on dark', (s) => s.replace("      '  filter: grayscale(1) brightness(0) invert(1); }',", "      '  filter: none; }',")],
    ['the drawer emoji stay in color on light', (s) => s.replace('.tfcc-narrow.tfcc-theme-light .tfcc-emo { filter: grayscale(1) brightness(0); }', '.tfcc-narrow.tfcc-theme-light .tfcc-emo { filter: none; }')],
    ['drawer buttons go under the 24px floor', (s) => s.replace('.tfcc-drawer button { min-height: 32px; min-width: 32px;', '.tfcc-drawer button { min-height: 20px; min-width: 20px;')],
    ['the drawer buttons may wrap', (s) => s.replace('.tfcc-drawer-btns { display: flex; flex-wrap: nowrap; align-items: center;', '.tfcc-drawer-btns { display: flex; flex-wrap: wrap; align-items: center;')],
    ['a drawer field is shortened by its font', (s) => s.replace("      '  padding: 4px 8px; }',", "      '  padding: 4px 8px; font-size: 12px; }',")],
  ].map(([name, apply]) => ({ name: '#39: ' + name, suite: 'tests/narrow-polish.test.js', apply })),
  ...[
    ['the archive button goes back to the wastebasket', (s) => s.replace(
      "row.archived ? 'Unarchive' : 'Archive', ARCHIVE_SVG,", "row.archived ? 'Unarchive' : 'Archive', emojiIcon('" + String.fromCharCode(92) + "uD83D" + String.fromCharCode(92) + "uDDD1'),")],
    ['the archive icon reaches screen readers', (s) => s.replace(
      ' width="18" height="18" aria-hidden="true"', ' width="18" height="18"')],
    ['the archive icon takes a fixed color', (s) => s.replace(
      'focusable="false"><path fill="currentColor" fill-rule="evenodd"', 'focusable="false"><path fill="#000" fill-rule="evenodd"')],
    ['a host svg fill rule can recolor the archive icon', (s) => s.replace(
      ".tfcc-narrow .tfcc-archico path { fill: currentColor; }',", ".tfcc-narrow .tfcc-archico path { }',")],
    ['the archive icon is drawn through the emoji filter', (s) => s.replace(
      ".tfcc-narrow .tfcc-archico { display: block; flex: none; }',", ".tfcc-narrow .tfcc-archico { display: block; flex: none; filter: invert(1); }',")],
    ['the archive icon carries an xmlns', (s) => s.replace(
      "'<svg class=\"tfcc-archico\" viewBox", "'<svg xmlns=\"http://www.w3.org/2000/svg\" class=\"tfcc-archico\" viewBox")],
  ].map(([name, apply]) => ({ name: '#41: ' + name, suite: 'tests/narrow-polish.test.js', apply })),
  // #41: the clip setting.
  ...[
    ['clipping defaults off', (s) => s.replace('      clipLines: true,\n', '      clipLines: false,\n')],
    ['an absent clipLines field turns clipping off', (s) => s.replace(
      "out.clipLines = typeof raw.clipLines === 'boolean' ? raw.clipLines : d.clipLines;", 'out.clipLines = raw.clipLines === true;')],
    ['a junk clipLines value is coerced instead of defaulted', (s) => s.replace(
      "out.clipLines = typeof raw.clipLines === 'boolean' ? raw.clipLines : d.clipLines;", 'out.clipLines = !!raw.clipLines;')],
    ['an explicit off is not kept', (s) => s.replace(
      "out.clipLines = typeof raw.clipLines === 'boolean' ? raw.clipLines : d.clipLines;", 'out.clipLines = d.clipLines;')],
    ['the panel never carries tfcc-clip', (s) => s.replace(
      'panel.classList.toggle(CLIP_CLASS, !state.settings || state.settings.clipLines !== false);', '')],
    ['the panel carries tfcc-clip whatever the setting says', (s) => s.replace(
      'panel.classList.toggle(CLIP_CLASS, !state.settings || state.settings.clipLines !== false);', 'panel.classList.toggle(CLIP_CLASS, true);')],
    ['a wide title has no tooltip', (s) => s.replace(
      "out.push('<span class=\"tfcc-row-title\"' + (clip ? ' title=\"' + escapeHtml(row.title) + '\"' : '')",
      "out.push('<span class=\"tfcc-row-title\"' + ''")],
    ['a wide note has no tooltip', (s) => s.replace(
      "out.push('<div class=\"tfcc-note\"' + (clip ? ' title=\"' + escapeHtml(row.note) + '\"' : '') + '>'",
      "out.push('<div class=\"tfcc-note\"' + '>'")],
    ['the wide title is not cut', (s) => s.replace(
      ".tfcc-clip .tfcc-row-main .tfcc-row-title { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }',",
      ".tfcc-clip .tfcc-row-main .tfcc-row-title { }',")],
    ['the note is not cut', (s) => s.replace(
      ".tfcc-clip .tfcc-row > .tfcc-note { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }',",
      ".tfcc-clip .tfcc-row > .tfcc-note { }',")],
    ['the narrow title is cut whatever the setting says', (s) => s.replace(
      "'.tfcc-narrow.tfcc-clip .tfcc-row-t .tfcc-row-title a {',", "'.tfcc-narrow .tfcc-row-t .tfcc-row-title a {',")],
    ['the narrow meta is cut whatever the setting says', (s) => s.replace(
      "'.tfcc-narrow.tfcc-clip .tfcc-row-l2 .tfcc-meta {',", "'.tfcc-narrow .tfcc-row-l2 .tfcc-meta {',")],
    ['an open narrow row keeps its note cut', (s) => s.replace(
      ".tfcc-clip .tfcc-row.tfcc-open > .tfcc-note { white-space: normal; overflow: visible; }',", ".tfcc-clip .tfcc-row.tfcc-open > .tfcc-note { }',")],
    ['an open row\'s meta parts join into unbreakable runs again (PR #42 review)', (s) => s.replace(
      ".tfcc-row.tfcc-open .tfcc-row-l2 .tfcc-meta > * { display: inline-block;',\n      '  max-width: 100%; overflow-wrap: anywhere; }',",
      ".tfcc-row.tfcc-open .tfcc-row-l2 .tfcc-meta > * { }',")],
    ['unticking the checkbox is not saved', (s) => s.replace(
      "          state.settings.clipLines = !!el.checked;\n          persist('settings'); redraw(); return;",
      "          state.settings.clipLines = !!el.checked;\n          redraw(); return;")],
    ['the checkbox does not show the setting', (s) => s.replace("+ (model.settings.clipLines ? ' checked' : '') + '>'", "+ '>'")],
    ['the clip info key is not registered', (s) => s.replace("    'settings-clip': 'About clipping',\n", '')],
  ].map(([name, apply]) => ({ name: '#41: ' + name, suite: 'tests/clip-lines.test.js', apply })),
  {
    name: '#41: wide rows carry the tooltip with clipping off',
    suite: 'tests/wide-parity.test.js',
    apply: (s) => s.replace("var clip = model.clipLines === true;", 'var clip = true;'),
  },
  {
    name: '#41: the Settings checkbox moves out of Appearance',
    suite: 'tests/wide-parity.test.js',
    // #43: the see-through setting now follows it inside Appearance.
    apply: (s) => s.replace("      + 'screen, hover over it. Turn this off to let them wrap.'));\n    // #43 (owner)",
      "      + 'screen, hover over it. Turn this off to let them wrap.'));\n    out.push('</div><div>');\n    // #43 (owner)"),
  },
  {
    name: '#39: the wide Catch up bar takes the narrow two-label buttons',
    suite: 'tests/wide-parity.test.js',
    apply: (s) => s.replace("model.narrow ? cuButton('markall', 'Mark all read', 'All read') : btn('markall', 'Mark all read')",
      "cuButton('markall', 'Mark all read', 'All read')"),
  },
  {
    name: '#43: Expand no longer shows every row',
    suite: 'tests/rows-cap.test.js',
    apply: (s) => s.replace('return takeover === true ? 0 : rowsShown;', 'return rowsShown;'),
  },
  {
    name: '#43: the model ignores takeover when it caps',
    suite: 'tests/rows-cap.test.js',
    apply: (s) => s.replace('var limit = rowLimitFor(s.rowsShown, s.takeover);', 'var limit = s.rowsShown;'),
  },
  ...[
    ['the check mark loses its hover note', (s) => s.replace('aria-label="Mark read" title="Mark read"', 'aria-label="Mark read"')],
    ['the info buttons lose their hover note', (s) => s.replace(
      "+ '\" title=\"' + escapeHtml(INFO_KEYS[key]) + '\">'", "+ '\">'")],
    ['the narrow Hide button loses its hover note', (s) => s.replace(
      'aria-label="Hide the panel" title="Hide the panel">', 'aria-label="Hide the panel">')],
    ['the Filters button loses its hover note', (s) => s.replace(
      "' active') + '\" title=\"Filters\">'", "' active') + '\">'")],
    ['the drawer loses its inline priority', (s) => s.replace(
      "    out.push('<span class=\"tfcc-dprio\">' + renderInfoButton('priority', model.openInfoId) + renderPriority(row) + '</span>');\n", '')],
    ['the drawer priority is not pushed right', (s) => s.replace(
      ".tfcc-dprio > :first-child { margin-left: auto; }',", ".tfcc-dprio > :first-child { }',")],
    ['the drawer row targets shrink below the 24px floor', (s) => s.replace(
      "  justify-content: center; min-width: 24px; padding: 0; }',", "  justify-content: center; min-width: 0; padding: 0; }',")],
    ['an info button gets its filled box back', (s) => s.replace(
      "padding: 0; border-color: transparent; background: transparent; }',", "padding: 0; border-color: var(--tm-border); }',")],
    ['an open info button fills its box again', (s) => s.replace(
      "button.tfcc-info[aria-expanded=\"true\"] { background: transparent; color: var(--tm-accent-text); }',",
      "button.tfcc-info[aria-expanded=\"true\"] { background: var(--tm-hover); }',")],
    ['an info button loses its tap target', (s) => s.replace(
      "  flex: none; min-width: 44px; min-height: 44px; padding: 0; border-color: transparent;",
      "  flex: none; padding: 0; border-color: transparent;")],
    ['the popup outlives its drawer', (s) => s.replace(
      '    state.openEditor = reconcileEditor(state.openEditor, state.openRowId);\n', '')],
  ].map(([name, apply]) => ({ name: '#43: ' + name, suite: 'tests/compact-drawer.test.js', apply })),
  ...[
    ['the drawer loses its priority info button', (s) => s.replace(
      "'<span class=\"tfcc-dprio\">' + renderInfoButton('priority', model.openInfoId) + renderPriority(row)",
      "'<span class=\"tfcc-dprio\">' + renderPriority(row)")],
    ['the priority info stays open when another row opens', (s) => s.replace(
      '      out.openRowId = out.openRowId === ev.id ? null : ev.id;\n      if (drawerInfo) out.openInfoId = null;\n',
      '      out.openRowId = out.openRowId === ev.id ? null : ev.id;\n')],
    ['the priority info outlives a closed drawer', (s) => s.replace(
      "    if (out.openRowId === null && DRAWER_INFO_KEYS.indexOf(out.openInfoId) !== -1) out.openInfoId = null;\n", '')],
    ['the priority text drops the range', (s) => s.replace('from -2 to +2, saved only on this device.', 'saved only on this device.')],
    ['the priority key is not registered', (s) => s.replace("    priority: 'About priority',\n", '')],
  ].map(([name, apply]) => ({ name: '#43: ' + name, suite: 'tests/info.test.js', apply })),
  ...[
    ['the see-through panel is solid', (s) => s.replace(".tfcc-seethrough { background: var(--tfcc-base-bg);',", ".tfcc-seethrough { background: var(--tm-bg);',")],
    ['the see-through rows are solid', (s) => s.replace(".tfcc-seethrough .tfcc-row { background: var(--tfcc-row-bg); }',", ".tfcc-seethrough .tfcc-row { background: var(--tm-bg-2); }',")],
    ['the panel is 60% opaque, not the owner\'s 50%', (s) => s.replace('--tfcc-base-bg: rgba(31, 31, 31, 0.5);', '--tfcc-base-bg: rgba(31, 31, 31, 0.6);')],
    ['the light row is 70% opaque, not the owner\'s 75%', (s) => s.replace('--tfcc-row-bg: rgba(232, 232, 232, 0.75);', '--tfcc-row-bg: rgba(232, 232, 232, 0.7);')],
    ['takeover lets the page show through', (s) => s.replace(".tfcc-seethrough.tfcc-takeover { background: var(--tm-bg);',", ".tfcc-seethrough.tfcc-takeover {',")],
    ['takeover rows let the page show through', (s) => s.replace(".tfcc-seethrough.tfcc-takeover .tfcc-row { background: var(--tm-bg-2); }',", ".tfcc-seethrough.tfcc-takeover .tfcc-row { }',")],
    ['the shelf and toast go see-through too (owner: base layers only)', (s) => s.replace(
      "'  background: var(--tm-bg-2); }',", "'  background: var(--tfcc-row-bg); }',")],
    ['the row token fills every row, setting or not', (s) => s.replace(
      "'  background: var(--tm-bg-2); padding: var(--tfcc-gap-sm) var(--tfcc-gap); }',",
      "'  background: var(--tfcc-row-bg); padding: var(--tfcc-gap-sm) var(--tfcc-gap); }',")],
    ['transparency by opacity, which fades the text', (s) => s.replace(
      "'  -webkit-backdrop-filter: blur(6px); backdrop-filter: blur(6px); }',",
      "'  -webkit-backdrop-filter: blur(6px); backdrop-filter: blur(6px); opacity: 0.5; }',")],
    ['the blur outlives the setting', (s) => s.replace(
      "'#' + PANEL_ID + '.tfcc-seethrough { background: var(--tfcc-base-bg);',\n      '  -webkit-backdrop-filter: blur(6px); backdrop-filter: blur(6px); }',",
      "'#' + PANEL_ID + '.tfcc-seethrough { background: var(--tfcc-base-bg); }',\n      '#' + PANEL_ID + ' { -webkit-backdrop-filter: blur(6px); backdrop-filter: blur(6px); }',")],
    ['see-through defaults off', (s) => s.replace('      seeThrough: true,\n', '      seeThrough: false,\n')],
    ['a junk see-through value is reported as damage', (s) => s.replace(
      "    var s = loadKey(STORAGE_KEYS.settings, normaliseSettings, now, isRecoveredSettings);",
      "    var s = loadKey(STORAGE_KEYS.settings, normaliseSettings, now);")],
    ['a stored see-through off is not kept', (s) => s.replace(
      "out.seeThrough = typeof raw.seeThrough === 'boolean' ? raw.seeThrough : d.seeThrough;", 'out.seeThrough = d.seeThrough;')],
    ['unticking see-through is not saved', (s) => s.replace(
      "          state.settings.seeThrough = !!el.checked;\n          persist('settings'); redraw(); return;",
      "          state.settings.seeThrough = !!el.checked;\n          redraw(); return;")],
    ['the panel class ignores the setting', (s) => s.replace(
      "panel.classList.toggle(SEETHROUGH_CLASS, !state.settings || state.settings.seeThrough !== false);",
      'panel.classList.toggle(SEETHROUGH_CLASS, true);')],
    ['the see-through note is not written', (s) => s.replace("'Turn this off to make the panel solid.'", "''")],
  ].map(([name, apply]) => ({ name: '#43: ' + name, suite: 'tests/transparency.test.js', apply })),
  {
    name: '#43: a see-through rule escapes its switch onto every wide panel',
    suite: 'tests/wide-parity.test.js',
    apply: (s) => s.replace("'#' + PANEL_ID + '.tfcc-seethrough .tfcc-row { background: var(--tfcc-row-bg); }',",
      "'#' + PANEL_ID + ' .tfcc-row-x { background: var(--tfcc-row-bg); }',"),
  },
  {
    name: '#43: the see-through checkbox renders ticked with the setting off',
    suite: 'tests/wide-parity.test.js',
    apply: (s) => s.replace("+ (model.settings.seeThrough ? ' checked' : '') + '>'", "+ ' checked>'"),
  },
  ...[
    ['a tap elsewhere in the drawer leaves the popup open', (s) => s.replace(
      'if (state.openEditor && !insideOpenEditor(panel, t)) {', 'if (false) {')],
    ['Tag Save toggles an existing tag off again (PR #44 review)', (s) => s.replace(
      "              if (hasTag(state.organizer, id, typed)) announce('Already tagged');\n              else state.organizer = addTag(state.organizer, id, typed);",
      "              state.organizer = toggleTag(state.organizer, id, typed.trim());")],
    ['addTag removes a tag that is already there', (s) => s.replace(
      '    if (!clean || hasTag(org, threadId, clean)) return org;\n    return toggleTag(org, threadId, clean);',
      '    if (!clean) return org;\n    return toggleTag(org, threadId, clean);')],
    ['Enter saves during IME composition (PR #44 review)', (s) => s.replace(
      '// Escape dismisses it; neither is meant for the popup.\n        if (ev.isComposing === true || ev.keyCode === 229) return;\n',
      '// Escape dismisses it; neither is meant for the popup.\n')],
    ['only isComposing counts as composition, not keyCode 229', (s) => s.replace(
      'meant for the popup.\n        if (ev.isComposing === true || ev.keyCode === 229) return;',
      'meant for the popup.\n        if (ev.isComposing === true) return;')],
    ['Escape no longer cancels the popup', (s) => s.replace("if (key !== 'Escape' && key !== 'Esc' && ", "if (key !== 'Esc' && ")],
    ['Enter no longer saves the popup', (s) => s.replace("!(key === 'Enter' && act === 'editor-input')", 'true')],
    ['opening the popup leaves focus on its button', (s) => s.replace(
      "            ? [attrSel('data-act', 'editor-input') + attrSel('data-id', id)]", '            ? null')],
    ['the popup field stops mirroring what is typed', (s) => s.replace(
      "        if (act === 'editor-input') act = el && el.getAttribute ? el.getAttribute('data-field') : null;\n", '')],
    ['Save on the note popup writes nothing', (s) => s.replace(
      '              entryOf(nNext, id).note = safeString(typed, 2000);\n', '')],
    ['Cancel keeps what was typed', (s) => s.replace(
      "          if (state.drawerEdit && state.drawerEdit.id === id && state.drawerEdit.field === sField + '-input') state.drawerEdit = null;\n", '')],
    ['the popup is not named', (s) => s.replace(
      "+ (field === 'note' ? 'Edit the note' : 'Add a tag') + '\">'", "+ '\">'")],
    ['a saved note does not show on the Note button', (s) => s.replace(
      "opener('note', 'Note', row.note ? 'Edit note' : 'Add note', !!row.note)", "opener('note', 'Note', 'Add note', false)")],
  ].map(([name, apply]) => ({ name: '#43: ' + name, suite: 'tests/compact-drawer.test.js', apply })),
  // #45 item 1: the priority number's own blue.
  ...[
    ['the priority number falls back to the meta grey', (s) => s.replace(
      "' .tfcc-prio { flex: none; color: var(--tfcc-prio);", "' .tfcc-prio { flex: none; color: var(--tm-meta);")],
    ['the dark priority blue is the raw logo blue, under AA', (s) => s.replace(
      "'  --tfcc-prio: #8db3d9;',", "'  --tfcc-prio: #5c768f;',")],
    ['the light priority blue is the raw logo blue, under AA', (s) => s.replace(
      "'  --tfcc-prio: #2e5680;',", "'  --tfcc-prio: #5c768f;',")],
  ].map(([name, apply]) => ({ name: '#45: ' + name, suite: 'tests/style.test.js', apply })),
  // #45 item 2: folder order, Unfiled, collapsible groups.
  ...[
    ['an organizer saved before #45 is reported as damaged', (s) => s.replace(
      '      unfiledAt: clamp(toInt(raw.unfiledAt, folders.length), 0, folders.length),',
      '      unfiledAt: clamp(toInt(raw.unfiledAt, 0), 0, folders.length),')],
    ['Unfiled defaults to the top instead of last', (s) => s.replace(
      '      unfiledAt: DEFAULT_FOLDERS.length,', '      unfiledAt: 0,')],
    ['moving does not swap', (s) => s.replace('    keys[i] = keys[j];\n    keys[j] = key;\n', '')],
    ['moving past an end wraps around instead of stopping', (s) => s.replace(
      '    if (i === -1 || j < 0 || j >= keys.length) return org;', '    if (i === -1) return org;\n    j = (j + keys.length) % keys.length;')],
    ['Catch up groups by name again, ignoring the order', (s) => s.replace(
      '    return folderOrderKeys(org).filter(function (k) {', '    return folderOrderKeys(org).sort().filter(function (k) {')],
    ['a collapsed group still renders its rows', (s) => s.replace(
      '      if (groups[n].collapsed) {', '      if (false) {')],
    ['a collapsed group still counts in the rendered rows, so its drawer stays open', (s) => s.replace(
      '{ if (!g.collapsed) list = list.concat(g.rows); }', '{ list = list.concat(g.rows); }')],
    ['collapsing is not saved', (s) => s.replace(
      "          state.organizer = toggleFolderCollapsed(state.organizer, id); persist('organizer');",
      '          state.organizer = toggleFolderCollapsed(state.organizer, id);')],
    ['a reorder is not saved', (s) => s.replace(
      "          if (moved !== state.organizer) { state.organizer = moved; persist('organizer'); }",
      '          if (moved !== state.organizer) { state.organizer = moved; }')],
    ['a new folder lands below Unfiled', (s) => s.replace(
      '    next.unfiledAt = j === -1 ? next.folders.length : j;', '    next.unfiledAt = j === -1 ? org.folders.length : j;')],
    ['deleting a folder above Unfiled moves Unfiled down a place', (s) => s.replace(
      '    if (gone !== -1 && gone < next.unfiledAt) next.unfiledAt -= 1;\n', '')],
    ['an import ignores the export\'s order', (s) => s.replace(
      '      org = withFolderOrder(org, importedOrder(org, payload));\n', '')],
    ['the first folder\'s up arrow is not disabled', (s) => s.replace(
      "      out.push(moveButton(orderKeys[i], f.name, 'up', i === 0)", "      out.push(moveButton(orderKeys[i], f.name, 'up', false)")],
    ['Unfiled can be deleted', (s) => s.replace(
      "      if (unf) {\n        out.push((model.narrow ? '' : unfNote) + '</div>');\n        continue;\n      }\n", '')],
    ['focus is lost when an arrow reaches its end', (s) => s.replace(
      "          var mAct = atEnd ? (act === 'folder-up' ? 'folder-down' : 'folder-up') : act;", '          var mAct = act;')],
    ['a real folder with id "unfiled" collides with built-in Unfiled (PR #46 review)', (s) => s.replace(
      '  function folderKey(id) { return FOLDER_KEY_PREFIX + id; }', '  function folderKey(id) { return id; }')],
    ['a collapsed bare folder id loads as if it were a key', (s) => s.replace(
      '        var cid = folderIdOfKey(key);', '        var cid = folderIdOfKey(key) || key;')],
    ['group DOM ids collide again (PR #46 review)', (s) => s.replace(
      "return '_' + ('000' + c.charCodeAt(0).toString(16)).slice(-4);", "return '_';")],
    ['the folder note drops the subscribed-only sentence', (s) => s.replace(
      "      + 'Folders organize only threads you subscribe to (and ones you file by hand); they never add other threads '\n      + 'from a forum. ",
      "      + '")],
    ['the narrow group toggle drops below 44px', (s) => s.replace(
      "'.tfcc-narrow button.tfcc-grp { min-height: 44px; }'", "'.tfcc-narrow button.tfcc-grp { min-height: 32px; }'")],
  ].map(([name, apply]) => ({ name: '#45: ' + name, suite: 'tests/folders.test.js', apply })),
  {
    name: '#45: the group heading markup drifts from its listed wide replacement',
    suite: 'tests/wide-parity.test.js',
    apply: (s) => s.replace("+ groupDomId(g.key) + '\" title=\"' + escapeHtml((open ? 'Collapse ' : 'Expand ') + g.name)",
      "+ groupDomId(g.key) + '\" title=\"' + escapeHtml((open ? 'Hide ' : 'Show ') + g.name)"),
  },
  // #45 (owner): the folder and author-only explanations.
  {
    name: '#45: the folder note stops explaining the order arrows',
    suite: 'tests/folders.test.js',
    apply: (s) => s.replace("wins over a claim. The arrows set the order, Unfiled included. This helps", "wins over a claim. This helps"),
  },
  {
    name: '#45: the author-only explanation no longer leads with what it does',
    suite: 'tests/panel.test.js',
    apply: (s) => s.replace("'With this on, a thread in Threads and Catch up is flagged new only when its author posts, '",
      "'With this on, a thread in Threads and Catch up counts as new only when its author posts, '"),
  },
  {
    name: '#45: the author-only checkbox loses its hover summary',
    suite: 'tests/panel.test.js',
    apply: (s) => s.replace(`type="checkbox" data-act="author-only" title="'`, `type="checkbox" data-act="author-only" data-x="'`),
  },
  // PR #46 review: the wide CSS list pins complete lines, not selectors.
  {
    name: '#45: an unlisted declaration joins an approved wide rule',
    suite: 'tests/wide-parity.test.js',
    apply: (s) => s.replace("      '  font: inherit; font-weight: bold; text-align: left; cursor: pointer; }',",
      "      '  font: inherit; font-weight: bold; font-style: italic; text-align: left; cursor: pointer; }',"),
  },
  {
    name: '#45: a second wide rule for the priority number overrides its color',
    suite: 'tests/wide-parity.test.js',
    apply: (s) => s.replace("      '#' + PANEL_ID + ' .tfcc-section h4.tfcc-grphead { margin: 0; }',",
      "      '#' + PANEL_ID + ' .tfcc-section h4.tfcc-grphead { margin: 0; }',\n      '#' + PANEL_ID + ' .tfcc-prio { color: var(--tm-meta); }',"),
  },
  {
    name: '#45: the light priority token changes outside its listed line',
    suite: 'tests/wide-parity.test.js',
    apply: (s) => s.replace("'  --tfcc-prio: #2e5680;',", "'  --tfcc-prio: #2e5681;',"),
  },
  {
    name: '#45: the priority color changes wide CSS outside its listed replacement',
    suite: 'tests/wide-parity.test.js',
    apply: (s) => s.replace("' .tfcc-prio { flex: none; color: var(--tfcc-prio); font-size: var(--tfcc-text-sm);'",
      "' .tfcc-prio { flex: none; color: var(--tfcc-prio); font-size: 11px;'"),
  },
  // #47 item 2: several forums per folder, one folder per forum.
  ...[
    ['a forum can be claimed by a second folder', (s) => s.replace(
      '    if (f <= 0 || folderFor(org, f)) return org;', '    if (f <= 0) return org;')],
    ['claimForum changes the organizer it was given', (s) => s.replace(
      '    var next = cloneOrganizer(org);\n    next.folders[i].forumIds.push(f);\n    return next;',
      '    org.folders[i].forumIds.push(f);\n    return org;')],
    ['removing a claim unfiles the threads it filed', (s) => s.replace(
      '    next.folders[i].forumIds = next.folders[i].forumIds.filter(function (x) { return x !== f; });\n',
      '    next.folders[i].forumIds = next.folders[i].forumIds.filter(function (x) { return x !== f; });\n'
      + '    Object.keys(next.threads).forEach(function (t) { if (next.threads[t].forumId === f) next.threads[t].folderId = null; });\n')],
    ['the claim menu offers forums another folder claims', (s) => s.replace(
      '        if (claimed[cat.id]) continue;\n', '')],
    ['a chip\'s remove button loses its name', (s) => s.replace(
      `' aria-label="' + escapeHtml(rm) + '" title="'`, `' title="'`)],
    ['an import drops the claims of a folder this device has', (s) => s.replace(
      '      for (var w = 0; w < want.length; w += 1) org = claimForum(org, org.folders[wf].id, want[w]);\n', '')],
    ['an import gives a forum a second claimant', (s) => s.replace(
      '          f.forumIds = [];\n          org.folders.push(f);', '          org.folders.push(f);')],
    ['a new claim is not saved', (s) => s.replace(
      "            state.organizer = claimedOrg;\n            persist('organizer');", '            state.organizer = claimedOrg;\n           ')],
    ['focus is lost when a chip is removed', (s) => s.replace(
      "          state.focusIntent = [attrSel('data-act', 'folder-forum') + attrSel('data-id', id)];\n", '')],
    ['the folder note says a folder claims one forum', (s) => s.replace(
      "optionally claim one or more forums, so new subscriptions '\n      + 'from them", "optionally claim a forum, so new subscriptions '\n      + 'from it")],
  ].map(([name, apply]) => ({ name: '#47: ' + name, suite: 'tests/claims.test.js', apply })),
  ...[
    ['the claim menu\'s name drifts from its listed wide replacement', (s) => s.replace(
      "escapeHtml('Claim a forum for ' + f.name)", "escapeHtml('Claim forum for ' + f.name)")],
    ['a chip rule changes wide CSS outside its listed lines', (s) => s.replace(
      "'  border: 1px solid var(--tm-border); border-radius: 12px; color: var(--tm-text); }',",
      "'  border: 1px solid var(--tm-border); border-radius: 4px; color: var(--tm-text); }',")],
    ['a narrow Settings spacing rule reaches a wide panel', (s) => s.replace(
      "'.tfcc-narrow .tfcc-set .tfcc-kv { gap: 8px; margin-bottom: 8px; }'", "' .tfcc-set .tfcc-kv { gap: 8px; margin-bottom: 8px; }'")],
  ].map(([name, apply]) => ({ name: '#47: ' + name, suite: 'tests/wide-parity.test.js', apply })),
  // #47 (PR #48 review): claims are canonical at every boundary.
  ...[
    ['the normaliser keeps a forum in two folders', (s) => s.replace(
      '    folders = canonicalClaims(folders);\n', '')],
    ['canonicalised claims are reported as damage', (s) => s.replace(
      'return v && wellFormed ? ', 'return v && false ? ')],
    ['invalid claims are forgiven as if canonical', (s) => s.replace(
      'var wellFormed = r.forumIds.every(', 'var wellFormed = true || r.forumIds.every(')],
    ['the claim cap is applied before duplicates are dropped', (s) => s.replace(
      'for (var i = 0; i < f.forumIds.length && ids.length < MAX_CLAIMS; i += 1) {',
      'for (var i = 0; i < f.forumIds.length && i < MAX_CLAIMS; i += 1) {')],
    ['upsertFolder lets a forum into a second folder', (s) => s.replace(
      '    next.folders = canonicalClaims(next.folders);\n', '')],
    ['an import keeps this device\'s duplicate claims', (s) => s.replace(
      '    org.folders = canonicalClaims(org.folders);\n    for (var wf', '    for (var wf')],
  ].map(([name, apply]) => ({ name: '#47: ' + name, suite: 'tests/claims.test.js', apply })),
  // #47 (owner): a narrow folder row is two lines.
  ...[
    ['narrow Delete drops back under the chips and menu', (s) => s.replace(
      `if (model.narrow) out.push(delHtml + '<span class="tfcc-claimline">' + claimHtml.join('') + '</span>');`,
      `if (model.narrow) out.push('<span class="tfcc-claimline">' + claimHtml.join('') + '</span>' + delHtml);`)],
    ['the narrow bin Delete loses its name', (s) => s.replace(
      `' aria-label="' + escapeHtml(delName) + '" title="'`, `' title="'`)],
    ['the chips and menu stop starting a line of their own', (s) => s.replace(
      "'.tfcc-narrow .tfcc-set .tfcc-claimline { flex: 1 1 100%;", "'.tfcc-narrow .tfcc-set .tfcc-claimline { flex: 0 1 auto;")],
    ['Unfiled\'s note leaves its name on a narrow panel', (s) => s.replace(
      "(unf && model.narrow ? unfNote : '')", "''").replace("(model.narrow ? '' : unfNote)", 'unfNote')],
  ].map(([name, apply]) => ({ name: '#47: ' + name, suite: 'tests/settings-spacing.test.js', apply })),
  {
    name: '#47: the bin Delete reaches a wide panel',
    suite: 'tests/wide-parity.test.js',
    apply: (s) => s.replace('      var delHtml = model.narrow\n', '      var delHtml = true\n'),
  },
  // #47 item 1: tighter narrow Settings.
  ...[
    ['sections lose their larger separation', (s) => s.replace(
      "'.tfcc-narrow .tfcc-set .tfcc-section { margin-bottom: 12px;", "'.tfcc-narrow .tfcc-set .tfcc-section { margin-bottom: 8px;")],
    ['a checkbox label loses its 44px target', (s) => s.replace(
      "'.tfcc-narrow .tfcc-set .tfcc-kvc > label { min-height: 44px;", "'.tfcc-narrow .tfcc-set .tfcc-kvc > label { min-height: 24px;")],
    ['a note drifts away from the row it explains', (s) => s.replace(
      "      '#' + PANEL_ID + '.tfcc-narrow .tfcc-set .tfcc-kv + p.tfcc-note { margin-top: -4px; }',\n", '')],
    ['the Settings wrapper renders on a wide panel', (s) => s.replace(
      "out.push(model.narrow ? '<div class=\"tfcc-set\">' + renderSettingsView(model) + '</div>' : renderSettingsView(model));",
      "out.push('<div class=\"tfcc-set\">' + renderSettingsView(model) + '</div>');")],
    ['the checkbox-row class renders on a wide panel', (s) => s.replace(
      "(model.narrow ? ' tfcc-kvc' : '')", "' tfcc-kvc'")],
    ['a Settings rule shrinks text', (s) => s.replace(
      "'.tfcc-narrow .tfcc-set p.tfcc-note { margin: 0 0 8px 0; }'", "'.tfcc-narrow .tfcc-set p.tfcc-note { margin: 0 0 8px 0; font-size: 11px; }'")],
  ].map(([name, apply]) => ({ name: '#47: ' + name, suite: 'tests/settings-spacing.test.js', apply })),
  // ---- #58 Task 7: Insert through Torn's TinyMCE editor ---------------------
  {
    name: 'the inserted paste loses TinyMCE internal marker, so Torn strips the styles',
    suite: 'tests/editor-insert.test.js',
    apply: (s) => s.replace("data.setData('text/html', PASTE_MARKER + html);", "data.setData('text/html', html);"),
  },
  {
    name: 'Insert no longer moves the caret to the end, so it can replace what was typed',
    suite: 'tests/editor-insert.test.js',
    apply: (s) => s.replace('      caretToEnd(doc, win, box);\n', ''),
  },
  {
    name: 'an ignored paste is reported as inserted',
    suite: 'tests/editor-insert.test.js',
    apply: (s) => s.replace("if (handled && String(box.innerHTML) !== before) return { ok: true };", 'return { ok: true };'),
  },
  {
    name: 'the first matching editor is taken, hidden or not (#60 by another route)',
    suite: 'tests/editor-insert.test.js',
    apply: (s) => s.replace('    if (shown.length === 1) return shown[0];', '    if (all.length) return all[0];'),
  },
  {
    name: 'two visible editors are guessed between',
    suite: 'tests/editor-insert.test.js',
    apply: (s) => s.replace('    return inForm.length === 1 ? inForm[0] : null;', '    return shown[0] || null;'),
  },

  // ---- #58 Task 14: the Drafts editor's promises ------------------------------
  {
    name: 'the cleaner takes any image source (data: URLs and bare names survive)',
    suite: 'tests/editor-clean.test.js',
    apply: (s) => s.replace('        var src = safeImgSrc(attrs.src);', '        var src = attrs.src;'),
  },
  {
    name: 'the cleaner accepts javascript: links',
    suite: 'tests/editor-clean.test.js',
    apply: (s) => s.replace("u.length <= URL_MAX_CHARS && /^https?:\\/\\/[^\\s<>\"'`]+$/i.test(u) ? u : '';", 'u;'),
  },
  {
    // Both guards at once: with only one removed, the other still drops the
    // script's text, and the mutation would change nothing.
    name: 'a script element\'s text reaches the post',
    suite: 'tests/editor-clean.test.js',
    apply: (s) => s.replace('    script: true, style: true, iframe: true,', '    style: true, iframe: true,')
      .replace('        if (!tok.raw) {', '        if (true) {'),
  },
  {
    name: 'the cleaner reads without a size bound',
    suite: 'tests/editor-clean.test.js',
    apply: (s) => s.replace('var s = String(html || \'\').slice(0, CLEAN_MAX_CHARS);', "var s = String(html || '');"),
  },
  {
    name: 'adjacent text runs stop merging, so cleaning is no longer idempotent',
    suite: 'tests/editor-clean.test.js',
    apply: (s) => s.replace('          if (last && last.text !== undefined) last.text += tok.text;\n          else top.children.push({ text: tok.text });',
      '          top.children.push({ text: tok.text });'),
  },
  {
    name: 'Markdown loses color on the way back from HTML',
    suite: 'tests/editor-convert.test.js',
    apply: (s) => s.replace("        out += '{' + key + '}' + inner + '{/}';", '        out += inner;'),
  },
  {
    name: 'an older drafts blob is marked damaged: lang materialised as text',
    suite: 'tests/editor-storage.test.js',
    apply: (s) => s.replace('        if (lang) entry.lang = lang;\n        out.byThread[id] = entry;',
      "        entry.lang = lang || 'text';\n        out.byThread[id] = entry;"),
  },
  {
    name: 'the Default editor setting is ignored',
    suite: 'tests/editor-view.test.js',
    apply: (s) => s.replace("    return DRAFT_LANGS.indexOf(state.settings.draftLang) !== -1 ? state.settings.draftLang : 'md';",
      "    return 'md';"),
  },
  {
    name: 'the height setting is ignored',
    suite: 'tests/editor-height.test.js',
    apply: (s) => s.replace("var setH = model.narrow ? model.settings.editorHeightNarrow : model.settings.editorHeightWide;",
      "var setH = 'small';"),
  },
  {
    name: 'the phone height uses the desktop setting',
    suite: 'tests/editor-height.test.js',
    apply: (s) => s.replace("var setH = model.narrow ? model.settings.editorHeightNarrow : model.settings.editorHeightWide;",
      "var setH = model.settings.editorHeightWide;"),
  },
  {
    name: 'Preview shows the Markdown draft as raw lines',
    suite: 'tests/editor-view.test.js',
    apply: (s) => s.replace("return mdBlocks(src).map(function (b) { return { html: b.html, offset: starts[b.line] || 0 }; });",
      "return src.split('\\n').map(function (l, i) { return { html: l, offset: starts[i] || 0 }; });"),
  },
  {
    name: 'the image fixer stops rewriting Drive links',
    suite: 'tests/editor-images.test.js',
    apply: (s) => s.replace("var fixedDrive = 'https://drive.google.com/thumbnail?id=' + id + '&sz=w1000';", 'var fixedDrive = u;'),
  },
  {
    name: 'switching to Text no longer asks first',
    suite: 'tests/editor-view.test.js',
    apply: (s) => s.replace("          if (mode === 'text' && ed.lang !== 'text' && ed.text.trim()) { ed.confirmText = ed.lang; redraw(); return; }\n", ''),
  },
  {
    name: 'a conversion past the draft limit is stored instead of refused',
    suite: 'tests/editor-view.test.js',
    apply: (s) => s.replace('          if (converted.length > DRAFT_MAX_CHARS) { overLimitNotice(converted.length); redraw(); return; }\n', ''),
  },

  // ---- #58 final review: HTML-mode blocks and Reset all ----------------------
  {
    name: 'HTML Align wraps a paragraph inside another paragraph again',
    suite: 'tests/editor-ops.test.js',
    apply: (s) => s.replace('        if (g.block) return alignOpenTag(g.lines[0], value);',
      "        if (g.block) return '<p style=\"text-align: ' + value + ';\">' + g.lines[0] + '</p>';"),
  },
  {
    name: 'HTML Quote puts each paragraph inside another paragraph again',
    suite: 'tests/editor-ops.test.js',
    apply: (s) => s.replace('          if (g.block) return g.lines[0].trim();', "          if (g.block) return '<p>' + g.lines[0].trim() + '</p>';"),
  },
  {
    name: 'an inline mark across two paragraphs merges them into one',
    suite: 'tests/editor-ops.test.js',
    apply: (s) => s.replace("    if (lang !== 'html' || s[0] === s[1] || !HTML_BLOCK_TAG.test(sel)) {", '    if (true) {'),
  },
  {
    name: 'a Markdown heading keeps its trailing space inside the bold',
    suite: 'tests/editor-ops.test.js',
    apply: (s) => s.replace("mdInline(h[2].trim()) + '</strong>", "mdInline(h[2]) + '</strong>"),
  },
  {
    name: 'Reset all leaves the old draft open in the editor',
    suite: 'tests/editor-view.test.js',
    apply: (s) => s.replace('          state.draftFocusId = null; loadEditor(null, now);\n', ''),
  },
  {
    name: 'Save recreates nothing yet reports a gone free draft as saved',
    suite: 'tests/editor-view.test.js',
    apply: (s) => s.replace("      if (!state.drafts.free || !state.drafts.free[e.key]) return false;\n", ''),
  },
  {
    name: 'Save says Draft saved whether or not it stored',
    suite: 'tests/editor-view.test.js',
    apply: (s) => s.replace('          if (state.editor.key === id ? !saveEditor(now) : !draftFor(state.drafts, id)) {',
      '          if (state.editor.key === id && (saveEditor(now), false)) {'),
  },
  {
    name: 'a pending Text-switch question survives another mode choice',
    suite: 'tests/editor-view.test.js',
    apply: (s) => s.replace('          ed.confirmText = null;\n', ''),
  },
  {
    name: 'a changed image address keeps the old check, so Insert uses the old URL',
    suite: 'tests/editor-view.test.js',
    apply: (s) => s.replace("          if (act === 'ed-img-url') state.editor.imageCheck = null;\n", ''),
  },
  // ---- #58 feedback Batch H: the image link fixer and bare links --------------
  {
    name: 'a bare fixable link alone on its line is not converted',
    suite: 'tests/editor-images.test.js',
    apply: (s) => s.replace("          if (r.status === 'fixed') {\n            changed += 1;\n            return line.replace(t,",
      "          if (r.status === 'never') {\n            changed += 1;\n            return line.replace(t,"),
  },
  {
    name: 'Fix all converts links inside sentences',
    suite: 'tests/editor-images.test.js',
    apply: (s) => s.replace(String.raw`        if (/^https:\/\/\S+$/i.test(t)) {`, String.raw`        if (/https:\/\/\S+/i.test(t)) {`),
  },
  {
    name: 'Fix all converts a bare link inside an open HTML block',
    suite: 'tests/editor-images.test.js',
    apply: (s) => s.replace('            if (stack.length) { left += countFixableLinks(seg, true); continue; }\n', ''),
  },
  {
    name: 'a changed fixer address keeps the old check, so Insert uses the old URL',
    suite: 'tests/editor-view.test.js',
    apply: (s) => s.replace("          if (act === 'ed-fix-url') state.editor.fixCheck = null;\n", ''),
  },
  {
    name: 'Fix all in Text mode rewrites anyway instead of asking to switch',
    suite: 'tests/editor-view.test.js',
    apply: (s) => s.replace("          if (E.lang === 'text') { notice('Switch to Markdown or HTML to add images.', 'warn'); redraw(); return; }\n          var fx =",
      '          var fx ='),
  },
  {
    name: 'the Copy result forces a redraw over the player typing',
    suite: 'tests/editor-view.test.js',
    apply: (s) => s.replace('            if (isForumsPage(win.location)) quietRedraw();\n          });\n          return;', '            redraw();\n          });\n          return;'),
  },

  // ---- #58 feedback Batch B: Preview tap, selection, tables, height ---------
  {
    name: 'a tap on an element inside a Preview block does nothing again',
    suite: 'tests/editor-feedback.test.js',
    apply: (s) => s.replace("          if (pvTap) { act = 'ed-jump'; t = pvTap; }", '          void pvTap;'),
  },
  {
    name: 'a selection made without typing is not mirrored, so actions use the typed caret',
    suite: 'tests/editor-feedback.test.js',
    apply: (s) => s.replace('          handlers.onSelect(act, t);\n', ''),
  },
  {
    name: 'an unfocused fresh textarea overrides the mirrored selection again',
    suite: 'tests/editor-feedback.test.js',
    apply: (s) => s.replace("      if (doc.activeElement === f || (f === lastSelField && String(f.value) === state.editor.text)) {", "      if (true) {"),
  },
  {
    name: 'Align on a table fences it as text again (Markdown and HTML)',
    suite: 'tests/editor-ops.test.js',
    apply: (s) => s.replace("      var tb = lang === 'md' ? alignMdRange(t, b[0], b[1], value) : alignHtmlRange(t, b[0], b[1], value);", '      var tb = null;'),
  },
  {
    name: 'a headerless Markdown table is fenced instead of refused',
    suite: 'tests/editor-ops.test.js',
    apply: (s) => s.replace("        if (!aligned) return { refused: 'table-header' };", "        if (!aligned) aligned = [':::' + value].concat(r.lines, [':::']);"),
  },
  {
    name: 'an HTML table aligns only the text around it, not its cells',
    suite: 'tests/editor-ops.test.js',
    apply: (s) => s.replace('      out += seg(body.slice(last, tm.index)) + alignOpenTag(tm[0], value, HTML_CELL_OPEN);', '      out += seg(body.slice(last, tm.index)) + tm[0];'),
  },
  {
    name: 'the dragged editor height is lost on the next redraw',
    suite: 'tests/editor-feedback.test.js',
    apply: (s) => s.replace('aria-label="Draft text"\' + hgt + \'>', 'aria-label="Draft text">'),
  },
  {
    name: 'Save as free draft also writes the typing into the thread draft',
    suite: 'tests/editor-undo.test.js',
    apply: (s) => s.replace('          E.dirty = false;\n          state.draftFocusId = mf.id;', '          state.draftFocusId = mf.id;'),
  },
  {
    name: 'Undo restores the mode but not the previous text',
    suite: 'tests/editor-undo.test.js',
    apply: (s) => s.replace('          E.text = snap.text; E.lang = snap.lang;', '          E.lang = snap.lang;'),
  },
  {
    name: 'every keystroke is its own Undo step',
    suite: 'tests/editor-undo.test.js',
    apply: (s) => s.replace('            if (!state.editor.typingAt || tnow - state.editor.typingAt > TYPING_BURST_MS) pushUndo(state.editor);', '            pushUndo(state.editor);'),
  },
  {
    name: 'the contrast warning fires for merely weak colors again (old 4.5:1 threshold)',
    suite: 'tests/editor-images.test.js',
    apply: (s) => s.replace('if (r && r < 2.5) out.push', 'if (r && r < 4.5) out.push'),
  },
  {
    name: 'the narrow toolbar is no longer right-aligned',
    suite: 'tests/editor-view.test.js',
    apply: (s) => s.replace('.tfcc-narrow .tfcc-tools { gap: 4px; justify-content: flex-end; }', '.tfcc-narrow .tfcc-tools { gap: 4px; }'),
  },
  {
    name: 'a toolbar button loses its full-word aria-label',
    suite: 'tests/editor-view.test.js',
    apply: (s) => s.replace("' aria-label=\"' + escapeHtml(t[3])", "' aria-label=\"' + escapeHtml(t[2])"),
  },
  {
    name: 'the Undo stack grows past 50 steps',
    suite: 'tests/editor-undo.test.js',
    apply: (s) => s.replace('  var UNDO_MAX = 50;', '  var UNDO_MAX = 60;'),
  },
  // #58 round 2, Batch I: Enter and blank lines keep paragraphs and gaps.
  {
    name: 'Insert ignores the HTML line rule: typed lines merge into one paragraph again',
    suite: 'tests/editor-enter.test.js',
    apply: (s) => s.replace("    if (lang === 'html') return htmlSourcePost(text);", "    if (lang === 'html') return cleanTornHtml(text);"),
  },
  {
    name: 'an empty line in HTML source is no longer a gap',
    suite: 'tests/editor-enter.test.js',
    apply: (s) => s.replace("      if (!lineUsed) segs.push({ html: '<p>&nbsp;</p>', offset: lineStart });", '      if (!lineUsed) segs.push({ html: \'\', offset: lineStart });'),
  },
  {
    name: 'Preview of HTML source ignores the line rule (Preview and Insert disagree)',
    suite: 'tests/editor-enter.test.js',
    apply: (s) => s.replace("    if (lang === 'html') return htmlSourceBlocks(src);", "    if (lang === 'html') return [{ html: cleanTornHtml(src), offset: 0 }].filter(function (b) { return b.html; });"),
  },
  {
    name: 'a switch from HTML to Markdown merges typed lines again',
    suite: 'tests/editor-enter.test.js',
    apply: (s) => s.replace('    var root = buildCleanTree(tokenizeHtml(htmlSourcePost(html)));', '    var root = buildCleanTree(tokenizeHtml(cleanTornHtml(html)));'),
  },
  {
    name: 'Enter inside an HTML paragraph splits it but drops its alignment',
    suite: 'tests/editor-enter.test.js',
    apply: (s) => s.replace("      return put(ctx.close + '</' + ctx.tag + '>\\n' + ctx.src + ctx.reopen);", "      return put(ctx.close + '</' + ctx.tag + '>\\n<' + ctx.tag + '>' + ctx.reopen);"),
  },
  {
    name: 'Enter inside an HTML paragraph or list item no longer splits it',
    suite: 'tests/editor-enter.test.js',
    apply: (s) => s.replace("      return put(ctx.close + '</' + ctx.tag + '>\\n' + ctx.src + ctx.reopen);", '      return null;'),
  },
  {
    name: 'Enter on a Markdown bullet line no longer continues the list',
    suite: 'tests/editor-enter.test.js',
    apply: (s) => s.replace("    return put('\\n' + m[0]);\n  }", '    return null;\n  }'),
  },
  {
    name: 'a numbered Markdown line continues with the same number',
    suite: 'tests/editor-enter.test.js',
    apply: (s) => s.replace("    if (ol) return put('\\n' + ol[1] + Math.min(parseInt(ol[2], 10) + 1, 999999999) + ol[3]);", "    if (ol) return put('\\n' + ol[1] + ol[2] + ol[3]);"),
  },
  {
    name: 'Enter on an empty list marker keeps the marker, so the list never ends',
    suite: 'tests/editor-enter.test.js',
    apply: (s) => s.replace('      return { text: t.slice(0, lineStart) + after.slice(rest.length), start: lineStart, end: lineStart };', '      return null;'),
  },
  {
    name: 'an IME composing Enter in the draft field is taken by the editor',
    suite: 'tests/editor-enter.test.js',
    apply: (s) => s.replace("          // An IME's Enter accepts a candidate; Ctrl, Cmd or Alt+Enter is not typing.\n          if (ev.isComposing === true || ev.keyCode === 229) return;\n", "          // An IME's Enter accepts a candidate; Ctrl, Cmd or Alt+Enter is not typing.\n"),
  },
  {
    name: 'in the draft field only isComposing counts as composition, not keyCode 229',
    suite: 'tests/editor-enter.test.js',
    apply: (s) => s.replace("not typing.\n          if (ev.isComposing === true || ev.keyCode === 229) return;", "not typing.\n          if (ev.isComposing === true) return;"),
  },
  {
    name: 'Ctrl or Cmd+Enter in the draft field is taken by the editor',
    suite: 'tests/editor-enter.test.js',
    apply: (s) => s.replace("          if (ev.ctrlKey || ev.metaKey || ev.altKey) return;\n", ''),
  },
  {
    name: 'an Enter edit takes no Undo snapshot',
    suite: 'tests/editor-enter.test.js',
    apply: (s) => s.replace('        pushUndo(E);\n        E.text = r.text; E.selStart = r.start; E.selEnd = r.end;', '        E.text = r.text; E.selStart = r.start; E.selEnd = r.end;'),
  },
  {
    name: 'an Enter edit redraws the panel, replacing the field under the caret',
    suite: 'tests/editor-enter.test.js',
    apply: (s) => s.replace('        if (!writeDraftField(el, before, r)) {', '        if (writeDraftField(el, before, r) || true) {'),
  },
  // Batch I fix round 1.
  {
    name: 'a blank line inside an open top-level paragraph no longer ends it (lines merge for good)',
    suite: 'tests/editor-enter.test.js',
    apply: (s) => s.replace('          if (gap) {\n            block.html += raw.slice(0, gap.index);', '          if (false) {\n            block.html += raw.slice(0, gap.index);'),
  },
  {
    name: 'Enter reads only the caret line, so a paragraph opened on an earlier line never splits',
    suite: 'tests/editor-enter.test.js',
    apply: (s) => s.replace('    var head = before.slice(info.open);', "    var head = before.slice(before.lastIndexOf('\\n') + 1);"),
  },
  {
    name: 'the HTML line rule reopens every unclosed inline tag on every line (quadratic)',
    suite: 'tests/editor-enter.test.js',
    apply: (s) => s.replace('      while (inl.length > LINE_REOPEN_MAX_TAGS || inlChars > LINE_REOPEN_MAX_CHARS) inlChars -= inl.shift().src.length;\n', ''),
  },
  {
    name: 'a phone keyboard line break (beforeinput) is not handled',
    suite: 'tests/editor-enter.test.js',
    apply: (s) => s.replace("        if (handlers.onDraftEnter(t, false) && typeof ev.preventDefault === 'function') ev.preventDefault();\n      });", '      });'),
  },
  {
    name: 'one Enter is handled twice: keydown and then its beforeinput',
    suite: 'tests/editor-enter.test.js',
    apply: (s) => s.replace('        if (draftEnterDecided) { draftEnterDecided = false; return; }\n', ''),
  },
  {
    name: 'a beforeinput mark outlives its press, so the next phone Enter is ignored',
    suite: 'tests/editor-enter.test.js',
    apply: (s) => s.replace("        if (t && t.getAttribute && t.getAttribute('data-act') === 'draft-text') draftEnterDecided = false;\n", ''),
  },
  {
    name: 'Enter at the end of a heading starts another heading',
    suite: 'tests/editor-enter.test.js',
    apply: (s) => s.replace('      if (heading && atEnd) {', '      if (false) {'),
  },
  {
    name: 'an Enter edit that reaches the limit does not mark the draft at the limit',
    suite: 'tests/editor-enter.test.js',
    apply: (s) => s.replace('        E.atLimit = r.text.length >= DRAFT_MAX_CHARS;\n', ''),
  },
  {
    name: 'an Enter edit past the draft limit is stored anyway',
    suite: 'tests/editor-enter.test.js',
    apply: (s) => s.replace('        if (r.text.length > DRAFT_MAX_CHARS) {\n          overLimitNotice(r.text.length);', '        if (false) {\n          overLimitNotice(r.text.length);'),
  },
  {
    name: 'Enter on an empty HTML list item adds another empty item instead of ending the list',
    suite: 'tests/editor-enter.test.js',
    apply: (s) => s.replace("      if (ctx.tag === 'li' && nb.length === before.length) {", '      if (false) {'),
  },
  {
    name: 'an HTML list item with only an image counts as empty and ends the list',
    suite: 'tests/editor-enter.test.js',
    apply: (s) => s.replace("      return /^<(?:img|br|hr)\\b/i.test(tag) ? 'x' : '';", "      return '';"),
  },
  {
    name: 'an empty nested list item ends the outer list, not its own',
    suite: 'tests/editor-enter.test.js',
    apply: (s) => s.replace("      if (tk.type === 'open' && !tk.selfClose) depth += 1;\n", ''),
  },
  {
    name: 'the narrow primary toolbar row wraps again',
    suite: 'tests/editor-view.test.js',
    apply: (s) => s.replace(".tfcc-narrow .tfcc-tools:not(.tfcc-tools-more) { flex-wrap: nowrap; }", '.tfcc-narrow .tfcc-tools:not(.tfcc-tools-more) { }'),
  },
  {
    name: 'the narrow toolbar buttons cannot shrink (fixed 40px)',
    suite: 'tests/editor-view.test.js',
    apply: (s) => s.replace('.tfcc-narrow .tfcc-tools button { flex: 0 1 40px; min-width: 32px;', '.tfcc-narrow .tfcc-tools button { flex: 0 0 40px; min-width: 40px;'),
  },
  {
    name: 'the narrow toolbar buttons shrink below the 32px floor',
    suite: 'tests/style.test.js',
    apply: (s) => s.replace('.tfcc-narrow .tfcc-tools button { flex: 0 1 40px; min-width: 32px;', '.tfcc-narrow .tfcc-tools button { flex: 0 1 40px; min-width: 24px;'),
  },
  {
    name: 'Enter in the fixer Image link field does not run Check',
    suite: 'tests/editor-enter.test.js',
    apply: (s) => s.replace("          handlers.onAction('ed-fix-check', t);\n", ''),
  },
  {
    name: 'Fix all says links were left "in sentences" again',
    suite: 'tests/editor-view.test.js',
    apply: (s) => s.replace("' links were left as links (not on a line of their own).'", "' links in sentences were left as links.'"),
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
