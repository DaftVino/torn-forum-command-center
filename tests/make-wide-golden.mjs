/*
 * Captures the wide (desktop) panel output as a golden - run by hand, once,
 * on main's code. tests/wide-parity.test.js compares every later build with it.
 *
 *   node tests/make-wide-golden.mjs
 *
 * It refuses to overwrite an existing golden. A parity failure means the code
 * changed desktop, not that the golden is stale: regenerating would hide
 * exactly the regression the test exists to catch. --force is for an
 * owner-approved desktop change, and that change says so in its PR.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { loadUserscript, FORUMS_LOCATION } = require('./load-userscript.js');
const { captureWide } = require('./wide-seed.js');

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(here, 'fixtures', 'wide-golden.json');
if (fs.existsSync(out) && !process.argv.includes('--force')) {
  console.error('tests/fixtures/wide-golden.json exists. Refusing to overwrite it.');
  process.exit(1);
}
fs.mkdirSync(path.dirname(out), { recursive: true });
// Escaped to ASCII: the reactions pill's thumbs are emoji, and the repo keeps
// its sources ASCII. JSON.parse reads the escapes back to the same string.
const json = JSON.stringify(captureWide(loadUserscript, FORUMS_LOCATION), null, 1)
  .replace(/[\u007f-￿]/g, (c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));
fs.writeFileSync(out, json + '\n');
console.log('wrote ' + out);
