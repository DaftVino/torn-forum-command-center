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
    name: 'the page guard accepts any host ending in torn.com',
    suite: 'tests/route.test.js',
    apply: (s) => s.replace(
      "      if (host !== 'www.torn.com' && host !== 'torn.com') return false;",
      "      if (host.indexOf('torn.com') === -1) return false;",
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
