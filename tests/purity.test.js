'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { readSource } = require('./load-userscript');

const START = '// ---- ENGINE START';
const END = '// ---- ENGINE END';

// Comments are prose. They are allowed to use ordinary English words like
// "window", "document" or "location"; the code beneath them is not.
//
// Regex literals have to be skipped as a unit. A character class such as
// [^\s"'] contains quote characters that are not string delimiters, and
// treating one as a delimiter would swallow the rest of the file and make this
// whole suite pass by finding nothing. The usual heuristic decides between
// division and a regex from the previous meaningful token.
const REGEX_PRECEDERS = new Set(['(', ',', '=', ':', '[', '!', '&', '|', '?', '{', '}', ';', '+', '-', '*', '%', '<', '>', '~', '^', 'return', 'typeof', 'case', 'in', 'of', 'new', 'delete', 'void', 'do', 'else']);

function regexAllowedAfter(out) {
  const trimmed = out.replace(/\s+$/, '');
  if (!trimmed) return true;
  const last = trimmed[trimmed.length - 1];
  if (REGEX_PRECEDERS.has(last)) return true;
  const word = /([A-Za-z_$][A-Za-z0-9_$]*)$/.exec(trimmed);
  return !!(word && REGEX_PRECEDERS.has(word[1]));
}

function stripComments(src) {
  let out = '';
  let i = 0;
  let mode = 'code';
  while (i < src.length) {
    const two = src.slice(i, i + 2);
    if (mode === 'code') {
      if (two === '//') { mode = 'line'; i += 2; continue; }
      if (two === '/*') { mode = 'block'; i += 2; continue; }
      const c = src[i];
      if (c === '/' && regexAllowedAfter(out)) {
        // Skip the literal and its flags wholesale, including any character
        // class, so nothing inside it is read as code or as a string.
        out += ' ';
        i += 1;
        let inClass = false;
        while (i < src.length) {
          if (src[i] === '\\') { i += 2; continue; }
          if (src[i] === '\n') break;
          if (src[i] === '[') inClass = true;
          else if (src[i] === ']') inClass = false;
          else if (src[i] === '/' && !inClass) { i += 1; break; }
          i += 1;
        }
        while (i < src.length && /[a-z]/.test(src[i])) i += 1;
        continue;
      }
      if (c === "'" || c === '"' || c === '`') {
        const quote = c;
        out += ' ';
        i += 1;
        while (i < src.length) {
          if (src[i] === '\\') { i += 2; continue; }
          if (src[i] === quote) { i += 1; break; }
          i += 1;
        }
        continue;
      }
      out += c;
      i += 1;
      continue;
    }
    if (mode === 'line') {
      if (src[i] === '\n') { mode = 'code'; out += '\n'; }
      i += 1;
      continue;
    }
    if (two === '*/') { mode = 'code'; i += 2; continue; }
    if (src[i] === '\n') out += '\n';
    i += 1;
  }
  return out;
}

function engineSection() {
  const src = readSource();
  const start = src.indexOf(START);
  const end = src.indexOf(END);
  assert.ok(start !== -1, 'ENGINE START marker missing');
  assert.ok(end > start, 'ENGINE END marker missing or before START');
  return stripComments(src.slice(start, end));
}

test('the engine touches no DOM, no network, no storage and no ambient clock', () => {
  const code = engineSection();

  const forbidden = [
    // The engine must be runnable with no page at all, so a test can pin a
    // behaviour without inventing a browser to hold it.
    [/\bdocument\b/, 'document'],
    [/\bwindow\b/, 'window'],
    [/\blocation\b(?!\s*\))/, 'location'],
    [/\bnavigator\b/, 'navigator'],
    [/\bfetch\s*\(/, 'fetch('],
    [/\bXMLHttpRequest\b/, 'XMLHttpRequest'],
    // The host APIs by name. Not a bare GM_/PDA_ prefix match: PDA_KEY_SENTINEL
    // is a frozen string the engine compares against, and comparing a string is
    // pure. Invoking the bridge is the hazard, so the bridge is what is named.
    [/\bGM_(get|set|delete|list)Value\b/, 'GM_*Value'],
    [/\bGM_xmlhttpRequest\b/, 'GM_xmlhttpRequest'],
    [/\bGM_setClipboard\b/, 'GM_setClipboard'],
    [/\bGM_info\b/, 'GM_info'],
    [/\bPDA_http[A-Za-z]*\b/, 'PDA_http*'],
    [/\bGM_[A-Za-z_]+\s*\(/, 'a GM_ call'],
    [/\bPDA_[A-Za-z_]+\s*\(/, 'a PDA_ call'],
    [/\bMutationObserver\b/, 'MutationObserver'],
    [/\bResizeObserver\b/, 'ResizeObserver'],
    [/\bgetBoundingClientRect\b/, 'getBoundingClientRect'],
    [/\bgetComputedStyle\b/, 'getComputedStyle'],
    [/\bquerySelector(All)?\b/, 'querySelector'],
    [/\bsetTimeout\s*\(/, 'setTimeout('],
    [/\bsetInterval\s*\(/, 'setInterval('],
    [/\balert\s*\(/, 'alert('],
    [/\bconsole\s*\./, 'console.'],
    [/\blocalStorage\b/, 'localStorage'],
    [/\bsessionStorage\b/, 'sessionStorage'],

    // The clock is the subtle one. Every engine function that needs the time
    // takes it as an argument, so a test can pin a date instead of racing one.
    [/\bDate\s*\.\s*now\b/, 'Date.now'],
    [/\bnew\s+Date\s*\(\s*\)/, 'new Date() with no argument'],
    [/\bperformance\s*\.\s*now\b/, 'performance.now'],
    [/\bMath\s*\.\s*random\b/, 'Math.random'],
  ];

  const found = [];
  for (const [re, label] of forbidden) {
    const m = re.exec(code);
    if (m) {
      const line = code.slice(0, m.index).split('\n').length;
      found.push(`${label} at engine line ${line}: ${code.split('\n')[line - 1].trim()}`);
    }
  }
  assert.deepStrictEqual(found, [], 'engine purity violations:\n' + found.join('\n'));
});

test('new Date with an explicit argument is still allowed', () => {
  // formatAbsoluteTime needs one, and it is deterministic: the value comes from
  // the caller, so it cannot smuggle the ambient clock into a pure function.
  assert.ok(/new\s+Date\s*\(\s*toInt/.test(engineSection()));
});

test('the engine section is a meaningful share of the file', () => {
  // A guard against the markers quietly drifting to enclose almost nothing,
  // which would make the purity test above pass while proving nothing.
  const src = readSource();
  const section = src.slice(src.indexOf(START), src.indexOf(END));
  assert.ok(section.length > 20000, 'engine section is suspiciously small: ' + section.length);
});

test('the comment stripper does not itself hide code', () => {
  assert.strictEqual(stripComments('var a = 1; // window\n').includes('window'), false);
  assert.strictEqual(stripComments('/* document */ var a = 1;').includes('document'), false);
  assert.strictEqual(stripComments('var a = "// not a comment"; var b;').includes('var b'), true);
  assert.strictEqual(stripComments("var a = 'document';").includes('document'), false);
  assert.strictEqual(stripComments('var window2 = 1;').includes('window2'), true);
});

test('the comment stripper survives a regex literal with a quote in it', () => {
  // This exact shape lives in scrubDetail. A stripper that read the double
  // quote inside the character class as a string delimiter would swallow
  // everything up to the next quote in the file, and the purity test above
  // would then pass by inspecting almost nothing.
  const code = 'var re = /https?:\\/\\/[^\\s"\']+/gi; var after = document;';
  const stripped = stripComments(code);
  assert.ok(stripped.includes('var after'), 'the stripper lost the rest of the line');
  assert.ok(stripped.includes('document'), 'real code after a regex must still be visible');
});

test('division is not mistaken for a regex literal', () => {
  const stripped = stripComments('var half = total / 2; var x = document;');
  assert.ok(stripped.includes('var x'));
  assert.ok(stripped.includes('document'));
});
