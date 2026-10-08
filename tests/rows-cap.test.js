'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { loadUserscript, FORUMS_LOCATION } = require('./load-userscript');

const NOW = 1700000000000;

function forums(extra) {
  return Object.assign({}, FORUMS_LOCATION, extra || {});
}

function ids(rows) {
  return Array.from(rows, (r) => r.id);
}

const R = (n) => Array.from({ length: n }, (_, i) => ({ id: String(i + 1) }));

test('every view is classified as capped or uncapped, exactly once', () => {
  // A new view cannot be added without deciding whether the Rows shown
  // setting governs it. This is the test that forces the call.
  const { exports: api } = loadUserscript();
  const capped = Array.from(api.CAPPED_VIEWS);
  const uncapped = Array.from(api.UNCAPPED_VIEWS);
  for (const v of api.VIEWS) {
    const n = (capped.includes(v) ? 1 : 0) + (uncapped.includes(v) ? 1 : 0);
    assert.strictEqual(n, 1, v + ' must be in exactly one of CAPPED_VIEWS or UNCAPPED_VIEWS');
  }
  for (const v of capped.concat(uncapped)) {
    assert.ok(Array.from(api.VIEWS).includes(v), v + ' is classified but is not a view');
  }
  assert.ok(uncapped.includes('search'), 'Search always shows every result');
  assert.ok(uncapped.includes('drafts'), 'Drafts always shows every draft');
  assert.ok(capped.includes('mine'), 'My posts is capped (issue #3)');
});

test('the menu is exactly 3, 5, 10, 20, 30 and All', () => {
  const { exports: api } = loadUserscript();
  assert.deepStrictEqual(Array.from(api.ROWS_SHOWN_OPTIONS), [3, 5, 10, 20, 30, 0]);
});

test('capRows keeps the first N rows and reports what it hid', () => {
  const { exports: api } = loadUserscript();
  const rows = R(5);
  const c = api.capRows(rows, 3, false);
  assert.deepStrictEqual(ids(c.rows), ['1', '2', '3']);
  assert.strictEqual(c.total, 5);
  assert.strictEqual(c.limit, 3);
  assert.strictEqual(c.hidden, 2);
  assert.strictEqual(c.expandable, true);
  assert.strictEqual(c.expanded, false);
  assert.strictEqual(rows.length, 5, 'the input is never mutated');
});

test('capRows does not bite on All, or on a list no longer than the cap', () => {
  const { exports: api } = loadUserscript();
  for (const [n, limit] of [[5, 0], [10, 10], [3, 5]]) {
    const c = api.capRows(R(n), limit, false);
    assert.strictEqual(c.rows.length, n, n + ' rows at limit ' + limit);
    assert.strictEqual(c.hidden, 0);
    assert.strictEqual(c.expandable, false, 'no "Showing 10 of 10" line');
  }
  const c11 = api.capRows(R(11), 10, false);
  assert.strictEqual(c11.hidden, 1, 'one over the cap is capped');
});

test('capRows treats an off-menu limit as All', () => {
  const { exports: api } = loadUserscript();
  for (const bad of [7, '3', 10.5, -3, NaN, null, undefined, true]) {
    const c = api.capRows(R(40), bad, false);
    assert.strictEqual(c.rows.length, 40, String(bad));
    assert.strictEqual(c.limit, 0, String(bad));
  }
});

test('capRows shows everything once expanded, and says so only if it mattered', () => {
  const { exports: api } = loadUserscript();
  const c = api.capRows(R(8), 3, true);
  assert.strictEqual(c.rows.length, 8);
  assert.strictEqual(c.hidden, 0);
  assert.strictEqual(c.expandable, true, 'the cap would bite, so the line still renders');
  assert.strictEqual(c.expanded, true);

  const short = api.capRows(R(2), 3, true);
  assert.strictEqual(short.expanded, false, 'nothing to expand');
});

test('capRows tolerates a non-array', () => {
  const { exports: api } = loadUserscript();
  const c = api.capRows(null, 3, false);
  assert.deepStrictEqual(Array.from(c.rows), []);
  assert.strictEqual(c.total, 0);
});
