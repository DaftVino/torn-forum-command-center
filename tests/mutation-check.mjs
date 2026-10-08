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
      "out.push('<span class=\"tfcc-row-title\"><a href=\"' + escapeHtml(threadUrl(row)) + '\">'\n      + escapeHtml(row.title) + '</a></span>');",
      "out.push('<span class=\"tfcc-row-title\"><a href=\"' + escapeHtml(threadUrl(row)) + '\">'\n      + row.title + '</a></span>');",
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
