'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { readSource, loadUserscript, SOURCE_PATH } = require('./load-userscript');

function metadataBlock(src) {
  const start = src.indexOf('// ==UserScript==');
  const end = src.indexOf('// ==/UserScript==');
  assert.ok(start !== -1 && end > start, 'metadata block is missing');
  return src.slice(start, end + '// ==/UserScript=='.length);
}

function directive(block, name) {
  const re = new RegExp('^//\\s*@' + name + '\\s+(.*)$', 'gm');
  const out = [];
  let m = re.exec(block);
  while (m) { out.push(m[1].trim()); m = re.exec(block); }
  return out;
}

test('the security surface is exactly what the spec pins', () => {
  const block = metadataBlock(readSource());

  assert.deepStrictEqual(directive(block, 'match'), ['https://www.torn.com/forums.php*']);

  // Widening any of these needs a stated reason in the PR description. The test
  // exists so that widening cannot happen by accident.
  assert.deepStrictEqual(
    directive(block, 'grant').sort(),
    ['GM_getValue', 'GM_setValue', 'GM_xmlhttpRequest'],
  );
  assert.deepStrictEqual(directive(block, 'connect'), ['api.torn.com']);

  assert.deepStrictEqual(directive(block, 'downloadURL'), []);
  assert.deepStrictEqual(directive(block, 'updateURL'), []);
});

test('injection time is document-end, which is what Torn PDA needs', () => {
  // Not document-idle: PDA's webview may evaluate before the page DOM exists,
  // and not document-start either, because nothing here intercepts requests.
  assert.deepStrictEqual(directive(metadataBlock(readSource()), 'run-at'), ['document-end']);
});

test('the version agrees with the constant and with package.json', () => {
  const block = metadataBlock(readSource());
  const metaVersion = directive(block, 'version')[0];
  const { exports } = loadUserscript();
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));

  assert.strictEqual(metaVersion, exports.SCRIPT_VERSION);
  assert.strictEqual(metaVersion, pkg.version);
});

test('a license is declared, because this file is the whole distribution', () => {
  assert.deepStrictEqual(directive(metadataBlock(readSource()), 'license'), ['MIT']);
});

test('every character in the source is ASCII', () => {
  // This is the regression that killed the sibling Education Scheduler inside
  // Torn PDA. PDA's UserScriptsProvider.adaptSource rewrites typographic quotes
  // across the whole file before injection, so a curly apostrophe inside a
  // single-quoted string becomes a syntax error and nothing runs at all.
  const src = readSource();
  const offenders = [];
  for (let i = 0; i < src.length; i += 1) {
    const code = src.charCodeAt(i);
    const ok = code === 0x09 || code === 0x0a || code === 0x0d || (code >= 0x20 && code <= 0x7e);
    if (!ok) {
      offenders.push({ index: i, code: '0x' + code.toString(16), near: src.slice(Math.max(0, i - 30), i + 30) });
      if (offenders.length >= 5) break;
    }
  }
  assert.deepStrictEqual(offenders, [], 'non-ASCII characters found: ' + JSON.stringify(offenders, null, 2));
});

test('the source survives the exact transformation Torn PDA applies', () => {
  // PDA replaces these four characters throughout the source before injecting.
  // Running the transformed text through the syntax checker proves the file is
  // still valid JavaScript on the other side of it.
  const src = fs.readFileSync(SOURCE_PATH, 'utf8');
  const adapted = src
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'");
  assert.strictEqual(adapted, src, 'the source should already contain no typographic quotes');
  assert.doesNotThrow(() => new Function(adapted));
});

test('the Torn PDA key slot appears exactly once and its sentinel is assembled', () => {
  const src = readSource();
  const slot = '###' + 'PDA-APIKEY' + '###';
  const literalOccurrences = src.split("'" + slot + "'").length - 1;
  assert.strictEqual(literalOccurrences, 1,
    'the PDA key slot must appear exactly once as a string literal');

  // The comparison value must be built from fragments, or PDA's own string
  // replacement would rewrite it too and a replaced slot would look unreplaced.
  assert.ok(/PDA_KEY_SENTINEL\s*=\s*\[\s*'###'\s*,\s*'PDA-APIKEY'\s*,\s*'###'\s*\]\.join\(''\)/.test(src),
    'PDA_KEY_SENTINEL must be assembled from fragments at runtime');
});

test('the script does not run on a page it does not own', () => {
  // The metadata @match cannot be trusted alone: Torn PDA ignores it entirely.
  const { exports, doc } = loadUserscript({ location: { pathname: '/index.php' } });
  assert.strictEqual(exports.state.mounted, false);
  assert.strictEqual(doc.getElementById('tfcc-panel'), null);
});
