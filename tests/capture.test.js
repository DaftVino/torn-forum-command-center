'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { loadUserscript, FORUMS_LOCATION } = require('./load-userscript');

const NOW = 1700000000000;

function forums(extra) {
  return Object.assign({}, FORUMS_LOCATION, extra || {});
}

// The bootstrap captures the visit as the script loads, so the sandbox clock
// has to be the same NOW the assertions use. Otherwise the load-time capture
// sets firstSeenAt to a different instant and every later assertion is arguing
// with the script rather than testing it.
function load(hash) {
  return loadUserscript({ location: forums({ hash }), now: NOW });
}

test('visiting a thread records the visit, its title and its forum', () => {
  const env = load('#/p=threads&f=61&t=16589908');
  const res = env.exports.captureVisit(
    env.win.location,
    'A practical education guide | Tutorials & Guides | TORN',
    NOW,
  );

  assert.strictEqual(res.changed, true);
  const entry = env.exports.state.organizer.threads['16589908'];
  assert.strictEqual(entry.lastVisitedAt, NOW);
  assert.strictEqual(entry.firstSeenAt, NOW);
  assert.strictEqual(entry.title, 'A practical education guide');
  assert.strictEqual(entry.forumId, 61);
});

test('capture reads only location and the document title', () => {
  // Research could not confirm a single current forums selector, so nothing the
  // script learns from a page visit may come from Torn markup. A document with
  // no query methods at all must still capture.
  const env = load('#/p=threads&t=42');
  const res = env.exports.captureVisit({ hash: '#/p=threads&t=42' }, 'Some thread | Forum | TORN', NOW);
  assert.strictEqual(res.changed, true);
  assert.strictEqual(env.exports.state.organizer.threads['42'].title, 'Some thread');
});

test('a non-thread route captures nothing', () => {
  const env = load('#/p=forums&f=61');
  const before = Object.keys(env.exports.state.organizer.threads).length;
  const res = env.exports.captureVisit(env.win.location, 'Forums | TORN', NOW);
  assert.strictEqual(res.changed, false);
  assert.strictEqual(Object.keys(env.exports.state.organizer.threads).length, before);
});

test('the generic forums title is not stored as a thread name', () => {
  // Torn's SPA updates the title after the route, so a capture that fires early
  // would otherwise name every thread "Forums".
  const env = load('#/p=threads&t=7');
  env.exports.captureVisit(env.win.location, 'Forums | TORN', NOW);
  assert.strictEqual(env.exports.state.organizer.threads['7'].title, '');
});

test('a later visit updates the time but keeps the first-seen stamp', () => {
  const env = load('#/p=threads&t=7');
  env.exports.captureVisit(env.win.location, 'Thread | F | TORN', NOW);
  env.exports.captureVisit(env.win.location, 'Thread | F | TORN', NOW + 500000);

  const entry = env.exports.state.organizer.threads['7'];
  assert.strictEqual(entry.firstSeenAt, NOW);
  assert.strictEqual(entry.lastVisitedAt, NOW + 500000);
});

test('capture never overwrites a note, tag or pin the user set', () => {
  const env = load('#/p=threads&t=7');
  env.exports.state.organizer = env.exports.toggleTag(env.exports.state.organizer, 7, 'keep');
  env.exports.state.organizer.threads['7'].note = 'my note';
  env.exports.captureVisit(env.win.location, 'New title | F | TORN', NOW);

  const entry = env.exports.state.organizer.threads['7'];
  assert.deepStrictEqual(entry.tags, ['keep']);
  assert.strictEqual(entry.note, 'my note');
});

test('a captured thread is searchable before any API refresh', () => {
  // "Search within previously visited threads" has to work on the first run,
  // before anything has been fetched.
  const env = load('#/p=threads&f=61&t=7');
  env.exports.captureVisit(env.win.location, 'Bank interest formula | Guides | TORN', NOW);
  env.exports.recompute(NOW);

  const hits = env.exports.searchMetadata(env.exports.state.rows, env.exports.parseQuery('interest'));
  assert.strictEqual(hits.length, 1);
  assert.strictEqual(hits[0].subscribed, false);
});

test('a hostile or missing title does not throw and is not guessed at', () => {
  const env = load('#/p=threads&t=7');
  for (const title of [null, undefined, '', 123, {}, 'x'.repeat(5000)]) {
    assert.doesNotThrow(() => env.exports.captureVisit(env.win.location, title, NOW), String(title));
  }
  assert.ok(env.exports.state.organizer.threads['7'].title.length <= 300, 'the title is capped');
});

test('capture is what makes a visit a last-activity source', () => {
  const env = load('#/p=threads&t=7');
  env.exports.captureVisit(env.win.location, 'T | F | TORN', NOW - 60000);
  env.exports.recompute(NOW);
  const row = env.exports.state.rows.find((r) => r.id === '7');
  assert.strictEqual(row.activitySource, 'visit');
  assert.strictEqual(row.lastActivity, NOW - 60000);
});
