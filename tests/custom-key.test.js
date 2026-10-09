'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { loadUserscript, readSource } = require('./load-userscript');

// Issue #17. The Settings view offers a link to Torn's own key page, pre-filled
// with a Custom key that carries exactly the selections this script requests.
// The script makes no request for it: it is a plain anchor the user clicks, and
// the user confirms the key on Torn's page.

const SOURCE = readSource();
const { exports: api } = loadUserscript();

// -- the selection list cannot drift ---------------------------------------

// Reads the first argument of every tornApiGet call site and reduces it to a
// path pattern: string literals kept, every other operand replaced by <id>.
// 'forum/' + list[i] + '/thread' becomes forum/<id>/thread.
function requestedPaths(src) {
  const out = [];
  const marker = 'tornApiGet(';
  let i = src.indexOf(marker);
  while (i !== -1) {
    const start = i + marker.length;
    // The declaration itself takes a parameter, not a path.
    const before = src.slice(Math.max(0, i - 9), i);
    if (before !== 'function ') {
      let j = start;
      let depth = 0;
      let quote = null;
      while (j < src.length) {
        const c = src[j];
        if (quote) {
          if (c === '\\') { j += 2; continue; }
          if (c === quote) quote = null;
        } else if (c === "'" || c === '"') {
          quote = c;
        } else if (c === '(' || c === '[' || c === '{') {
          depth += 1;
        } else if (c === ')' || c === ']' || c === '}') {
          if (depth === 0) break;
          depth -= 1;
        } else if (c === ',' && depth === 0) {
          break;
        }
        j += 1;
      }
      const arg = src.slice(start, j).trim();
      const parts = arg.split('+').map((p) => p.trim());
      const pattern = parts.map((p) => {
        const m = /^'([^']*)'$/.exec(p);
        return m ? m[1] : '<id>';
      }).join('');
      out.push({ arg, pattern, literal: parts.some((p) => /^'[^']*'$/.test(p)) });
    }
    i = src.indexOf(marker, start);
  }
  return out;
}

// forum/<id>/thread -> forum, thread. user/forumfeed -> user, forumfeed.
function selectionOf(pattern) {
  const segs = pattern.split('/').filter((s) => s && s !== '<id>');
  return { section: segs[0], selection: segs[segs.length - 1] };
}

test('the path scanner sees every call site the source makes', () => {
  const paths = requestedPaths(SOURCE);
  const sites = (SOURCE.match(/tornApiGet\(/g) || []).length - 1; // minus the declaration
  assert.strictEqual(paths.length, sites);
  assert.ok(paths.length >= 5, 'expected at least the five current endpoints');
  for (const p of paths) {
    assert.ok(p.literal, 'a call site has no literal path, so its selection cannot be checked: ' + p.arg);
    const s = selectionOf(p.pattern);
    assert.ok(s.section && s.selection && s.section !== s.selection,
      'could not read a section and selection from ' + p.pattern);
  }
});

test('the custom key carries every selection the script requests, and nothing else', () => {
  // When #2 (user/forumthreads, user/forumposts) and #10 (user/profile) merge,
  // their new tornApiGet calls make this fail until CUSTOM_KEY_SELECTIONS
  // lists their selections too. That is the point of the test.
  const requested = {};
  for (const p of requestedPaths(SOURCE)) {
    const s = selectionOf(p.pattern);
    requested[s.section] = requested[s.section] || new Set();
    requested[s.section].add(s.selection);
  }
  const listed = api.CUSTOM_KEY_SELECTIONS;
  assert.ok(listed && typeof listed === 'object', 'CUSTOM_KEY_SELECTIONS is not exported');
  assert.ok(Object.isFrozen(listed), 'the selection list must be frozen');

  for (const section of Object.keys(requested)) {
    for (const sel of requested[section]) {
      assert.ok((listed[section] || []).indexOf(sel) !== -1,
        'requested but missing from the custom key: ' + section + '/' + sel);
    }
  }
  // Least privilege: a selection the script never asks for has no business on
  // the key.
  for (const section of Object.keys(listed)) {
    assert.ok(Object.isFrozen(listed[section]), section + ' list must be frozen');
    for (const sel of listed[section]) {
      assert.ok(requested[section] && requested[section].has(sel),
        'on the custom key but never requested: ' + section + '/' + sel);
    }
  }
});

// -- the link ----------------------------------------------------------------

function hashParams(url) {
  const hash = url.slice(url.indexOf('#') + 1);
  return new URLSearchParams(hash.slice(hash.indexOf('?') + 1));
}

test('the key link is ASCII, carries no key, and names exactly the selections', () => {
  const url = api.buildCustomKeyUrl();
  assert.match(url, /^[\x20-\x7e]+$/, 'the link must be printable ASCII');
  assert.doesNotMatch(url, /[?&#]key=/i, 'a key must never be placed in the link');
  assert.ok(url.indexOf('https://www.torn.com/preferences.php#tab=api?') === 0,
    'the link must open Torn\'s own key page: ' + url);

  const q = hashParams(url);
  assert.strictEqual(q.get('step'), 'addNewKey');
  assert.strictEqual(q.get('user'), api.CUSTOM_KEY_SELECTIONS.user.join(','));
  assert.strictEqual(q.get('forum'), api.CUSTOM_KEY_SELECTIONS.forum.join(','));
  const sections = [...q.keys()].filter((k) => k !== 'step' && k !== 'title').sort();
  assert.deepStrictEqual(sections, Object.keys(api.CUSTOM_KEY_SELECTIONS).sort(),
    'the link names a section the selection list does not, or misses one');
});

test('the key title is URL-encoded in the link', () => {
  assert.strictEqual(api.CUSTOM_KEY_TITLE, 'Forum Command Center');
  const url = api.buildCustomKeyUrl();
  assert.ok(url.indexOf('&title=' + encodeURIComponent(api.CUSTOM_KEY_TITLE) + '&') !== -1,
    'the title is not encoded: ' + url);
  assert.doesNotMatch(url, / /);
  assert.strictEqual(hashParams(url).get('title'), api.CUSTOM_KEY_TITLE);
});

// -- the Settings view -------------------------------------------------------

function keySection() {
  api.state.settings.view = 'settings';
  const html = api.panelHtml(api.buildPanelModel(1700000000000));
  return html.slice(html.indexOf('Torn API key'), html.indexOf('Refreshing'));
}

function decodeAttr(v) {
  return v.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}

test('the key section offers the link as a new-tab anchor', () => {
  const section = keySection();
  const m = /<a [^>]*>Create a custom key on Torn<\/a>/.exec(section);
  assert.ok(m, 'the Create a custom key link is missing from the key section');
  const tag = m[0];
  assert.match(tag, /class="tfcc-linkbtn"/, 'it must be styled as a button');
  assert.match(tag, / target="_blank"/);
  const rel = /\brel="([^"]*)"/.exec(tag);
  assert.ok(rel, 'the link has no rel');
  assert.ok(rel[1].split(/\s+/).indexOf('noopener') !== -1, 'rel must include noopener');
  assert.ok(rel[1].split(/\s+/).indexOf('noreferrer') !== -1, 'rel must include noreferrer');
  const href = /\bhref="([^"]*)"/.exec(tag);
  assert.strictEqual(decodeAttr(href[1]), api.buildCustomKeyUrl());
  // Spec 13d item 16: the point-of-action disclosure, in the owner's words. It
  // still says the link opens a new tab and carries nothing but this script's
  // selections.
  assert.match(section, /Opens Torn in a new tab with only this script's selections\./);
});

test('every new-tab anchor in the source is opened without an opener', () => {
  const tags = SOURCE.match(/<a [^>]*target="_blank"[^>]*>/g) || [];
  assert.ok(tags.length >= 1);
  for (const t of tags) assert.match(t, /rel="[^"]*\bnoopener\b/, 'missing noopener: ' + t);
});

// #45: the owner generated a custom key link on torn.com on 2026-10-09 and
// pasted it; it is this string exactly, so the format is verified.
test('the custom key link is exactly the one Torn generated for the owner (#45)', () => {
  assert.strictEqual(api.buildCustomKeyUrl(),
    'https://www.torn.com/preferences.php#tab=api?step=addNewKey&title=Forum%20Command%20Center'
    + '&user=forumsubscribedthreads,forumfeed,forumthreads,forumposts,profile&forum=categories,thread,posts');
});
