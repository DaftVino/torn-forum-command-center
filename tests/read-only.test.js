'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { loadUserscript, readSource } = require('./load-userscript');

// The single most important promise this script makes to its users and to Torn
// is that it never acts on the player's behalf. That promise was verified once
// by hand, which is worth nothing six months from now. These tests are the
// standing version of that audit.
//
// Torn's scripting rules could not be fetched directly (rules.php and the wiki
// both refuse automated requests), so the rule text behind these assertions is
// a paraphrase corroborated across several forum threads rather than the
// verbatim source. The assertions themselves do not depend on that: they pin
// concrete properties of this file that are conservative under any reading.

const SOURCE = readSource();

// Directives are read from the metadata block only. The prose below it
// discusses @connect and @grant by name, and a whole-file regex happily
// mistakes a sentence about a directive for the directive itself.
const META = SOURCE.slice(
  SOURCE.indexOf('// ==UserScript=='),
  SOURCE.indexOf('// ==/UserScript==') + '// ==/UserScript=='.length,
);

function directive(name) {
  const re = new RegExp('^//\\s*@' + name + '\\s+(\\S+)\\s*$', 'gm');
  const out = [];
  let m = re.exec(META);
  while (m) { out.push(m[1]); m = re.exec(META); }
  return out;
}

test('the script never simulates a user interaction', () => {
  // Clicking, submitting or faking a pointer or key event is the exact shape of
  // "acting on the player's behalf". None of it may appear at all.
  const forbidden = [
    [/\.click\s*\(/, 'an element .click() call'],
    [/\.submit\s*\(/, 'a form .submit() call'],
    [/requestSubmit/, 'requestSubmit'],
    [/new\s+MouseEvent/, 'a synthetic MouseEvent'],
    [/new\s+PointerEvent/, 'a synthetic PointerEvent'],
    [/new\s+KeyboardEvent/, 'a synthetic KeyboardEvent'],
    [/new\s+TouchEvent/, 'a synthetic TouchEvent'],
    [/HTMLElement\.prototype\.click/, 'the prototype click'],
    [/\.form\s*\.\s*submit/, 'a form submit'],
  ];

  const found = [];
  for (const [re, label] of forbidden) {
    if (re.test(SOURCE)) found.push(label);
  }
  assert.deepStrictEqual(found, [], 'the script simulates interaction: ' + found.join(', '));
});

test('the only synthetic event is the input event a draft insert needs', () => {
  // React owns its own textarea. Writing the value without telling React means
  // the next render throws the text away, so this one event is load-bearing.
  // It types into a box; it does not send anything. The user still presses Post.
  const dispatches = SOURCE.match(/dispatchEvent\s*\([^)]*\)/g) || [];
  assert.strictEqual(dispatches.length, 1, 'unexpected dispatchEvent calls: ' + dispatches.join(' | '));
  assert.match(dispatches[0], /new EventCtor\('input'/);
});

test('every request is a GET', () => {
  const methods = (SOURCE.match(/method:\s*'([A-Z]+)'/g) || []);
  assert.ok(methods.length > 0, 'no HTTP method found at all - has the adapter moved?');
  for (const m of methods) {
    assert.match(m, /'GET'/, 'a non-GET request appears: ' + m);
  }

  const writeVerbs = [/'POST'/, /'PUT'/, /'DELETE'/, /'PATCH'/, /PDA_httpPost/, /PDA_httpPut/, /PDA_httpDelete/, /PDA_httpPatch/];
  for (const re of writeVerbs) {
    assert.strictEqual(re.test(SOURCE), false, 'a write verb appears in the source: ' + re);
  }
});

test('the script initiates no navigation of its own', () => {
  // "Search on Torn" is an anchor, not a scripted assignment. Both load the
  // same page, but a link makes the request unambiguously the user's own click.
  const forbidden = [
    [/location\s*\.\s*href\s*=/, 'a location.href assignment'],
    [/location\s*\.\s*assign\s*\(/, 'location.assign'],
    [/location\s*\.\s*replace\s*\(/, 'location.replace'],
    [/location\s*\.\s*reload\s*\(/, 'location.reload'],
    [/window\.open\s*\(/, 'window.open'],
    [/GM_openInTab/, 'GM_openInTab'],
  ];
  const found = [];
  for (const [re, label] of forbidden) if (re.test(SOURCE)) found.push(label);
  assert.deepStrictEqual(found, [], 'the script navigates on its own: ' + found.join(', '));
});

test('every request goes to the Torn API and nowhere else', () => {
  const { exports: api } = loadUserscript();
  assert.strictEqual(api.API_BASE, 'https://api.torn.com/v2');

  // Any other absolute URL in the source must be something rendered as a link
  // for the user to click, never something the script fetches.
  const urls = (SOURCE.match(/https?:\/\/[^\s'"`)]+/g) || [])
    .map((u) => u.replace(/[.,]$/, ''));
  const hosts = new Set(urls.map((u) => {
    const m = /^https?:\/\/([^/]+)/.exec(u);
    return m ? m[1] : u;
  }));

  const allowed = new Set([
    'api.torn.com',      // the only host anything is ever fetched from
    'www.torn.com',      // thread and search links the user clicks
    'greasyfork.org',    // the homepage in the metadata block
    'github.com',        // the namespace in the metadata block
  ]);
  const stray = [...hosts].filter((h) => !allowed.has(h));
  assert.deepStrictEqual(stray, [], 'unexpected hosts in the source: ' + stray.join(', '));
});

test('the declared network surface is one host', () => {
  assert.deepStrictEqual(directive('connect'), ['api.torn.com']);
});

test('no grant gives the script a way to act on the account', () => {
  assert.deepStrictEqual(directive('grant').sort(), ['GM_getValue', 'GM_setValue', 'GM_xmlhttpRequest']);

  // Named individually so that adding one is a deliberate, reviewable act
  // rather than something that slips in with an unrelated feature.
  for (const g of ['GM_download', 'GM_openInTab', 'GM_notification', 'GM_registerMenuCommand', 'unsafeWindow']) {
    assert.strictEqual(directive('grant').indexOf(g), -1, g + ' was granted');
  }
});

test('the automatic request path is opt-in and bounded', () => {
  // The one thing here that is not one-input-one-request. It is off unless the
  // user turns it on, it only offers intervals of minutes, and it stops while
  // the page is not visible.
  const { exports: api } = loadUserscript();
  assert.strictEqual(api.freshSettings().autoRefreshMs, 0, 'auto refresh must default to off');

  for (const ms of [1000, 5000, 30000, 60000, 17]) {
    assert.strictEqual(api.normaliseSettings({ v: 1, autoRefreshMs: ms }).autoRefreshMs, 0,
      ms + 'ms should not be an accepted interval');
  }
  for (const ms of [120000, 300000, 900000]) {
    assert.strictEqual(api.normaliseSettings({ v: 1, autoRefreshMs: ms }).autoRefreshMs, ms);
  }

  assert.match(SOURCE, /if \(doc\.hidden === true\) return;/,
    'the interval must not fire while the page is hidden');
});

test('a refresh cannot exceed the request budget the panel promises', () => {
  const { exports: api } = loadUserscript();
  const worstCase = 2 + 1 + api.MAX_ENRICH_BUDGET;
  assert.ok(worstCase <= api.REQUESTS_PER_WINDOW,
    'the worst-case refresh (' + worstCase + ') must fit inside one minute of budget');
  assert.ok(api.DEEP_SEARCH_MAX_THREADS * api.DEEP_SEARCH_MAX_PAGES <= 50,
    'a deep search must stay bounded');
});

test('nothing in the source reads as an action on the account', () => {
  // A coarse net over the vocabulary of the things this script promises never
  // to do. It exists to make an accidental addition loud.
  const words = [
    'addToBazaar', 'sendMoney', 'attackPlayer', 'travelTo', 'buyItem',
    'useItem', 'enrol', 'enroll', 'subscribeThread', 'postReply', 'createThread',
  ];
  const found = words.filter((w) => new RegExp('\\b' + w + '\\b', 'i').test(SOURCE));
  assert.deepStrictEqual(found, [], 'action-shaped identifiers found: ' + found.join(', '));
});

test('the API terms disclosure is rendered where the key is entered', () => {
  // Torn's API terms: if a service stores or shares the key or the data, the
  // terms "need to be clearly and visibly stated in any place where user is
  // providing their API key in the table format highlighted above". This is
  // that table, in the Settings view, beside the key input.
  const { exports: api } = loadUserscript();
  api.state.settings.view = 'settings';
  const html = api.panelHtml(api.buildPanelModel(1700000000000));

  assert.match(html, /class="tfcc-tos"/, 'the disclosure table is missing');
  for (const row of [/Who can see your data/, /What it is used for/, /Storage/, /Access level required/, /Requests made/]) {
    assert.match(html, row, 'the disclosure is missing a row: ' + row);
  }
  assert.match(html, /Nobody\. It never leaves this device/);
  assert.match(html, /Minimal/);

  // And it is in the same section as the input, not somewhere else entirely.
  const keySection = html.slice(html.indexOf('Torn API key'), html.indexOf('Refreshing'));
  assert.match(keySection, /data-act="key-input"/);
  assert.match(keySection, /class="tfcc-tos"/);
});

test('automatic requests stop when the page is not the one being used', () => {
  // The rule speaks of unfocused pages. document.hidden only covers a
  // backgrounded tab; a visible but unfocused window needs hasFocus too.
  assert.match(SOURCE, /if \(doc\.hidden === true\) return;/);
  assert.match(SOURCE, /if \(typeof doc\.hasFocus === 'function' && !doc\.hasFocus\(\)\) return;/);
});

test('a key Torn has rejected is never sent again', () => {
  // "you must account for this by removing disabled or invalid keys upon error"
  // - Torn's acceptable usage terms. The penalty named there is an IP ban.
  const { exports: api } = loadUserscript();
  assert.deepStrictEqual(api.KEY_REJECTED_CODES.slice().sort((a, b) => a - b), [2, 13, 16, 18]);

  // Codes that are temporary must not be in that list, or a user would be told
  // to replace a key that was never wrong.
  for (const temporary of [5, 9, 10, 11, 17]) {
    assert.strictEqual(api.KEY_REJECTED_CODES.indexOf(temporary), -1,
      'code ' + temporary + ' is temporary and must not condemn the key');
  }
  assert.match(SOURCE, /if \(state\.settings\.keyRejected\) \{/,
    'the gate must be in tornApiGet so every caller is covered');
});
