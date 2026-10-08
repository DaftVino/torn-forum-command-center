'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { loadUserscript, FORUMS_LOCATION, loadFixture } = require('./load-userscript');

const NOW = 1700000000000;
const HOUR = 60 * 60 * 1000;
const api = loadUserscript({ location: FORUMS_LOCATION, now: NOW }).exports;

const trow = (at, karma, id) => ({ id: at, first_post_time: at, author: { id: id === undefined ? 7 : id, username: 'me', karma } });

test('karma is read from an owned forumthreads row, newest first', () => {
  assert.strictEqual(api.karmaFromAuthors([trow(100, 5), trow(300, 34), trow(200, 9)], 'first_post_time', 7), 34);
  // The newest row has no usable figure: the next newest is used, never 0.
  assert.strictEqual(api.karmaFromAuthors([trow(300, null), trow(200, 9)], 'first_post_time', 7), 9);
  // Someone else's row is never taken when the owner is known...
  assert.strictEqual(api.karmaFromAuthors([trow(100, 5, 99)], 'first_post_time', 7), null);
  // ...and is taken on trust when it is not.
  assert.strictEqual(api.karmaFromAuthors([trow(100, 5, 99)], 'first_post_time', 0), 5);
  // forumposts rows use created_time.
  assert.strictEqual(api.karmaFromAuthors([{ created_time: 5, author: { id: 7, karma: -4 } }], 'created_time', 7), -4);
});

test('the real captures agree: thread row, post rows and profile all carry the same karma', () => {
  const threads = loadFixture('user-forumthreads').forumThreads;
  const posts = loadFixture('user-forumposts').forumPosts;
  const self = threads[0].author.id;
  const fromThreads = api.karmaFromAuthors(threads, 'first_post_time', self);
  assert.strictEqual(typeof fromThreads, 'number');
  assert.strictEqual(api.karmaFromAuthors(posts, 'created_time', self), fromThreads);
  assert.strictEqual(api.karmaFromProfile(loadFixture('user-profile-karma')), fromThreads);
});

test('karma is unknown when nothing usable is there, and unknown shows "-" not 0', () => {
  assert.strictEqual(api.karmaFromAuthors([], 'first_post_time', 7), null);
  assert.strictEqual(api.karmaFromAuthors(null, 'first_post_time', 7), null);
  assert.strictEqual(api.karmaFromAuthors([trow(1, '12')], 'first_post_time', 7), null, 'a string is not a number');
  assert.strictEqual(api.karmaFromAuthors([trow(1, NaN)], 'first_post_time', 7), null);
  assert.strictEqual(api.karmaFromAuthors([{ first_post_time: 1 }], 'first_post_time', 7), null, 'no author');
  for (const unknown of [null, undefined, NaN, '5', Infinity]) {
    assert.strictEqual(api.formatKarma(unknown), '-');
  }
  assert.strictEqual(api.formatKarma(0), '0', 'a real zero is shown');
  assert.strictEqual(api.formatKarma(1208), '1,208');
  assert.strictEqual(api.formatKarma(-12), '-12');
  assert.strictEqual(api.formatKarma(-1208), '-1,208');
  assert.strictEqual(api.formatKarma(1234567), '1,234,567');
});

test('karmaFromProfile reads profile.karma only', () => {
  assert.strictEqual(api.karmaFromProfile({ profile: { karma: 1208 } }), 1208);
  assert.strictEqual(api.karmaFromProfile({ profile: { karma: 0 } }), 0);
  assert.strictEqual(api.karmaFromProfile({ profile: { karma: null } }), null);
  assert.strictEqual(api.karmaFromProfile({ profile: {} }), null);
  assert.strictEqual(api.karmaFromProfile({ karma: 5 }), null);
  assert.strictEqual(api.karmaFromProfile(null), null);
});

test('the fallback is due only with no threads and no posts, and a stale or absent figure', () => {
  const fresh = api.freshMine();
  assert.strictEqual(api.karmaFallbackDue(fresh, NOW, api.KARMA_TTL_MS, 0, 0), true);
  assert.strictEqual(api.karmaFallbackDue(fresh, NOW, api.KARMA_TTL_MS, 1, 0), false, 'a started thread');
  assert.strictEqual(api.karmaFallbackDue(fresh, NOW, api.KARMA_TTL_MS, 0, 1), false, 'a post');
  assert.strictEqual(api.karmaFallbackDue(fresh, NOW, api.KARMA_TTL_MS, null, 0), false, 'a list that failed is unknown, not empty');
  assert.strictEqual(api.karmaFallbackDue(fresh, NOW, api.KARMA_TTL_MS, 0, undefined), false);
  const known = api.setKarma(fresh, 10, NOW);
  assert.strictEqual(api.karmaFallbackDue(known, NOW + api.KARMA_TTL_MS - 1, api.KARMA_TTL_MS, 0, 0), false, 'cached for 12 hours');
  assert.strictEqual(api.karmaFallbackDue(known, NOW + api.KARMA_TTL_MS, api.KARMA_TTL_MS, 0, 0), true, 'due at the boundary');
  assert.strictEqual(api.KARMA_TTL_MS, 12 * HOUR);
});

test('setKarma writes both fields together, last, and clears on a non-number', () => {
  const snap = api.setKarma(api.freshMine(), 34, NOW);
  assert.strictEqual(snap.karma, 34);
  assert.strictEqual(snap.karmaAt, NOW);
  const keys = Object.keys(snap);
  assert.deepStrictEqual(keys.slice(-2), ['karma', 'karmaAt']);
  assert.deepStrictEqual(api.normaliseMine(JSON.parse(JSON.stringify(snap))), snap, 'round trips');
  const cleared = api.setKarma(snap, null, NOW);
  assert.ok(!('karma' in cleared) && !('karmaAt' in cleared));
  assert.strictEqual(api.setKarma(api.freshMine(), 0, NOW).karma, 0, 'a real zero is stored');
});

test('a My posts merge keeps the karma it already had', () => {
  const snap = api.setKarma(api.freshMine(), 34, NOW);
  const merged = api.mergeMineSnapshot(snap, [], [], NOW + 1, true);
  assert.strictEqual(merged.karma, 34);
  assert.strictEqual(merged.karmaAt, NOW, 'the sighting keeps its own date');
  assert.ok(!('karma' in api.mergeMineSnapshot(api.freshMine(), [], [], NOW, true)), 'never back-filled');
});

test('the icon is ASCII, follows the theme colour, and carries nothing active', () => {
  const svg = api.KARMA_ICON_SVG;
  assert.match(svg, /^[\x00-\x7F]+$/, 'ASCII only (tests/metadata.test.js rule, Torn PDA rewrites the rest)');
  assert.ok(svg.includes('currentColor'));
  assert.ok(!svg.includes('#000000'), 'the owner file is black; it must follow the theme instead');
  assert.ok(svg.includes('aria-hidden="true"') && svg.includes('focusable="false"'));
  assert.ok(svg.includes('viewBox="149 50 702 900"'));
  for (const banned of ['<title', '<desc', '<script', '<?xml', 'xmlns', 'http', 'href', 'javascript:']) {
    assert.ok(!svg.includes(banned), 'no ' + banned);
  }
  assert.doesNotMatch(svg, /\son[a-z]+=/i, 'no event attribute');
});

test('the inline icon draws the same path as the committed owner file', () => {
  const file = fs.readFileSync(path.join(__dirname, '..', 'docs', 'reference', 'karma-endless-knot.svg'), 'utf8');
  const d = /\sd="([^"]+)"/.exec(file)[1];
  assert.ok(api.KARMA_ICON_SVG.includes(' d="' + d + '"'), 'path data drifted from docs/reference/karma-endless-knot.svg');
});
