'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { loadUserscript } = require('./load-userscript');

const loaded = loadUserscript();
const api = loaded.exports;

test('the page guard accepts only the forums page on a Torn host', () => {
  const cases = [
    [{ hostname: 'www.torn.com', pathname: '/forums.php' }, true, 'canonical'],
    [{ hostname: 'torn.com', pathname: '/forums.php' }, true, 'apex host'],
    [{ hostname: 'www.torn.com', pathname: '/forums.php', search: '?p=threads' }, true, 'with a query'],
    [{ hostname: 'www.torn.com', pathname: '/forums.php', hash: '#/p=threads&t=1' }, true, 'with a hash'],

    [{ hostname: 'www.torn.com', pathname: '/index.php' }, false, 'another Torn page'],
    [{ hostname: 'www.torn.com', pathname: '/page.php' }, false, 'the generic page router'],
    [{ hostname: 'www.torn.com', pathname: '/forums.php/extra' }, false, 'a path below forums.php'],
    [{ hostname: 'www.torn.com', pathname: '/oldforums.php' }, false, 'a path that merely ends in it'],

    // A suffix host is the attack this guard exists for: notwww.torn.com and
    // torn.com.evil.example both end in the string we care about.
    [{ hostname: 'evil-torn.com', pathname: '/forums.php' }, false, 'a lookalike host'],
    [{ hostname: 'www.torn.com.evil.example', pathname: '/forums.php' }, false, 'a suffix-spoof host'],
    [{ hostname: 'forums.torn.com', pathname: '/forums.php' }, false, 'a subdomain'],
  ];

  for (const [loc, expected, label] of cases) {
    assert.strictEqual(api.isForumsPage(loc), expected, label);
  }
});

test('a missing or hostile location is refused without throwing', () => {
  assert.strictEqual(api.isForumsPage(null), false);
  assert.strictEqual(api.isForumsPage(undefined), false);
  assert.strictEqual(api.isForumsPage({}), false);
  assert.strictEqual(api.isForumsPage(0), false);

  const hostile = {
    get hostname() { throw new Error('nope'); },
    get pathname() { throw new Error('nope'); },
  };
  assert.doesNotThrow(() => api.isForumsPage(hostile));
  assert.strictEqual(api.isForumsPage(hostile), false);
});

test('the hash grammar is read from the hash, then from the query', () => {
  const fromHash = api.parseForumRoute({ hash: '#/p=threads&f=61&t=16589908&b=0&a=0' });
  assert.strictEqual(fromHash.view, 'threads');
  assert.strictEqual(fromHash.forumId, 61);
  assert.strictEqual(fromHash.threadId, 16589908);
  assert.strictEqual(fromHash.isThread, true);

  // Links pasted from a search engine carry the same grammar in the query.
  const fromQuery = api.parseForumRoute({ hash: '', search: '?p=forums&f=67&b=0&a=0' });
  assert.strictEqual(fromQuery.view, 'forums');
  assert.strictEqual(fromQuery.forumId, 67);
  assert.strictEqual(fromQuery.threadId, null);
  assert.strictEqual(fromQuery.isThread, false);
});

test('both hash spellings Torn uses are accepted', () => {
  const withSlash = api.parseForumRoute({ hash: '#/p=threads&t=5' });
  const withoutSlash = api.parseForumRoute({ hash: '#p=threads&t=5' });
  assert.strictEqual(withSlash.threadId, 5);
  assert.strictEqual(withoutSlash.threadId, 5);
});

test('junk parameters are ignored rather than guessed at', () => {
  const cases = [
    ['#/p=threads&t=abc', null],
    ['#/p=threads&t=-4', null],
    ['#/p=threads&t=1.5', null],
    ['#/p=threads&t=', null],
    ['#/p=threads', null],
    ['#', null],
    ['', null],
    ['#/&&&=&', null],
    ['#/t=0', null],
  ];
  for (const [hash, expected] of cases) {
    assert.strictEqual(api.parseForumRoute({ hash }).threadId, expected, hash);
  }
});

test('parsing a hostile location does not throw', () => {
  const hostile = { get hash() { throw new Error('nope'); }, get search() { throw new Error('nope'); } };
  assert.doesNotThrow(() => api.parseForumRoute(hostile));
  assert.strictEqual(api.parseForumRoute(hostile).threadId, null);
  assert.strictEqual(api.parseForumRoute(null).threadId, null);
});

test('the route object is frozen so a caller cannot rewrite it in place', () => {
  // Asserted inside the VM: the harness rebuilds cross-realm plain objects in
  // the main context, which would silently drop the freeze and make this pass
  // for the wrong reason.
  const frozen = loaded.runInVm(
    "Object.isFrozen(globalThis.__TFCC__.parseForumRoute({ hash: '#/p=threads&t=9' }))",
  );
  assert.strictEqual(frozen, true);
});

test('the first parameter wins when a hash repeats one', () => {
  // Deliberate: a repeated parameter is a malformed URL, and taking the first
  // is at least predictable. Taking the last would let a crafted link override
  // the thread the user actually opened.
  assert.strictEqual(api.parseForumRoute({ hash: '#/t=11&t=99' }).threadId, 11);
});

test('a thread title is read from the indexed title format, verbatim otherwise', () => {
  assert.strictEqual(api.titleToThreadName('My guide | Tutorials & Guides | TORN'), 'My guide');
  assert.strictEqual(api.titleToThreadName('A | B | C | TORN'), 'A | B');
  assert.strictEqual(api.titleToThreadName('Forums | TORN'), 'Forums');

  // A title that does not match the format is stored as it came, not guessed.
  assert.strictEqual(api.titleToThreadName('Something else entirely'), 'Something else entirely');
  assert.strictEqual(api.titleToThreadName(''), '');
  assert.strictEqual(api.titleToThreadName(null), '');
  assert.strictEqual(api.titleToThreadName(undefined), '');
});
