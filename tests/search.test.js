'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { loadUserscript } = require('./load-userscript');

const { exports: api } = loadUserscript();

function row(extra) {
  return Object.assign({
    id: '1', numericId: 1, title: 'Bank interest guide', forumId: 61, forumName: 'Tutorials',
    authorId: 7, authorName: 'Chedburn', subscribed: true, postsTotal: 10, tornUnread: 0,
    unread: 0, dismissed: false, pinned: false, archived: false, priority: 0,
    folderId: 'guides', folderName: 'Guides', tags: ['money'], note: 'read before trading',
    lastActivity: 1000, activitySource: 'feed', lastVisitedAt: 0, firstSeenAt: 0,
    isLocked: false, isSticky: false, hasDraft: false, draftUpdatedAt: 0, needsEnrich: false,
  }, extra);
}

test('bare words, phrases and negation parse as expected', () => {
  const q = api.parseQuery('bank "interest rate" -stocks');
  assert.deepStrictEqual(q.terms, [
    { type: 'text', value: 'bank', negated: false },
    { type: 'phrase', value: 'interest rate', negated: false },
    { type: 'text', value: 'stocks', negated: true },
  ]);
});

test('every documented prefix parses, including negated', () => {
  const q = api.parseQuery('by:Ched tag:money folder:Guides is:unread -is:pinned -by:spammer');
  assert.deepStrictEqual(q.terms, [
    { type: 'by', value: 'ched', negated: false },
    { type: 'tag', value: 'money', negated: false },
    { type: 'folder', value: 'guides', negated: false },
    { type: 'is', value: 'unread', negated: false },
    { type: 'is', value: 'pinned', negated: true },
    { type: 'by', value: 'spammer', negated: true },
  ]);
});

test('an unknown prefix is treated as text rather than dropped silently', () => {
  // Dropping it would quietly widen the search and show results the user did
  // not ask for, which is worse than looking for the literal string.
  const q = api.parseQuery('colour:red');
  assert.deepStrictEqual(q.terms, [{ type: 'text', value: 'colour:red', negated: false }]);
});

test('an empty query matches everything rather than nothing', () => {
  const q = api.parseQuery('');
  assert.strictEqual(q.isEmpty, true);
  assert.strictEqual(api.matchThread(row(), q), true);
  assert.strictEqual(api.matchThread(row(), api.parseQuery('   ')), true);
  assert.strictEqual(api.matchThread(row(), null), true);
});

test('text search covers title, author, forum, note and tags', () => {
  const r = row();
  for (const term of ['bank', 'chedburn', 'tutorials', 'trading', 'money']) {
    assert.strictEqual(api.matchThread(r, api.parseQuery(term)), true, term);
  }
  assert.strictEqual(api.matchThread(r, api.parseQuery('racing')), false);
});

test('matching is case-insensitive', () => {
  assert.strictEqual(api.matchThread(row(), api.parseQuery('BANK')), true);
  assert.strictEqual(api.matchThread(row(), api.parseQuery('by:CHEDBURN')), true);
});

test('every term must match: terms are ANDed', () => {
  assert.strictEqual(api.matchThread(row(), api.parseQuery('bank guide')), true);
  assert.strictEqual(api.matchThread(row(), api.parseQuery('bank racing')), false);
});

test('negation excludes', () => {
  assert.strictEqual(api.matchThread(row(), api.parseQuery('-racing')), true);
  assert.strictEqual(api.matchThread(row(), api.parseQuery('-bank')), false);
  assert.strictEqual(api.matchThread(row({ pinned: true }), api.parseQuery('-is:pinned')), false);
});

test('the is: filters map to real row state', () => {
  assert.strictEqual(api.matchThread(row({ unread: 3 }), api.parseQuery('is:unread')), true);
  assert.strictEqual(api.matchThread(row({ unread: 0 }), api.parseQuery('is:unread')), false);
  assert.strictEqual(api.matchThread(row({ pinned: true }), api.parseQuery('is:pinned')), true);
  assert.strictEqual(api.matchThread(row({ hasDraft: true }), api.parseQuery('is:draft')), true);
  assert.strictEqual(api.matchThread(row({ subscribed: false }), api.parseQuery('is:subscribed')), false);
  assert.strictEqual(api.matchThread(row({ archived: true }), api.parseQuery('is:archived')), true);
  assert.strictEqual(api.matchThread(row({ lastVisitedAt: 5 }), api.parseQuery('is:visited')), true);

  // An unknown is: value matches nothing rather than everything.
  assert.strictEqual(api.matchThread(row(), api.parseQuery('is:purple')), false);
});

test('searchMetadata filters a list', () => {
  const rows = [row(), row({ id: '2', numericId: 2, title: 'Racing lines', tags: [], note: '' })];
  assert.deepStrictEqual(api.searchMetadata(rows, api.parseQuery('racing')).map((r) => r.id), ['2']);
  assert.strictEqual(api.searchMetadata(rows, api.parseQuery('')).length, 2);
});

test('a post search with only filters and no text matches nothing', () => {
  // Otherwise "is:unread" alone would dump every cached post on the user, which
  // is not what searching inside posts means.
  const post = { id: 1, authorName: 'Ched', at: 5, text: 'hello world' };
  assert.strictEqual(api.matchPost(post, row(), api.parseQuery('is:unread')), false);
  assert.strictEqual(api.matchPost(post, row(), api.parseQuery('hello')), true);
  // by: on its own is a real intent: "everything this player wrote".
  assert.strictEqual(api.matchPost(post, row(), api.parseQuery('by:ched')), true);
});

test('post search combines author and text, the syntax Torn hides', () => {
  const post = { id: 1, authorName: 'Chedburn', at: 5, text: 'the bank interest formula' };
  assert.strictEqual(api.matchPost(post, row(), api.parseQuery('by:ched interest')), true);
  assert.strictEqual(api.matchPost(post, row(), api.parseQuery('by:someoneelse interest')), false);
  assert.strictEqual(api.matchPost(post, row(), api.parseQuery('by:ched racing')), false);
  assert.strictEqual(api.matchPost(post, row(), api.parseQuery('by:ched -racing')), true);
});

test('searchPosts returns newest first and respects its cap', () => {
  let cache = api.freshPostCache();
  cache = api.postCacheAdd(cache, 1, [
    { id: 1, authorName: 'a', at: 100, text: 'alpha match' },
    { id: 2, authorName: 'b', at: 300, text: 'beta match' },
    { id: 3, authorName: 'c', at: 200, text: 'gamma match' },
  ], { fetchedAt: 1 });

  const hits = api.searchPosts(cache, [row()], api.parseQuery('match'));
  assert.deepStrictEqual(hits.map((h) => h.at), [300, 200, 100]);
  assert.strictEqual(api.searchPosts(cache, [row()], api.parseQuery('match'), 2).length, 2);
});

test('the native search launcher builds a Torn URL and encodes the query', () => {
  const url = api.buildNativeSearchUrl('by:Ched bank interest');
  assert.ok(url.indexOf('https://www.torn.com/forums.php') === 0, url);
  assert.ok(url.indexOf('by%3AChed%20bank%20interest') !== -1, url);
  assert.strictEqual(api.buildNativeSearchUrl('x', 61).indexOf('&f=61') !== -1, true);
  assert.strictEqual(api.buildNativeSearchUrl('x', 0).indexOf('&f=') !== -1, false);
});

test('the native launcher never points anywhere but Torn', () => {
  for (const hostile of ['javascript:alert(1)', 'https://evil.example/#', '"><script>']) {
    assert.ok(api.buildNativeSearchUrl(hostile).indexOf('https://www.torn.com/forums.php#/p=search&q=') === 0);
  }
});

test('stripHtml removes markup without ever building a DOM', () => {
  assert.strictEqual(api.stripHtml('<b>bold</b> text'), 'bold text');
  assert.strictEqual(api.stripHtml('line<br>two'), 'line\ntwo');
  assert.strictEqual(api.stripHtml('<p>one</p><p>two</p>'), 'one\ntwo');
  assert.strictEqual(api.stripHtml('a &amp; b &lt;c&gt; &quot;d&quot; &#39;e&#39;'), 'a & b <c> "d" \'e\'');
  assert.strictEqual(api.stripHtml('&nbsp;spaced&nbsp;'), 'spaced');
  assert.strictEqual(api.stripHtml(''), '');
  assert.strictEqual(api.stripHtml(null), '');
});

test('a script tag in forum HTML is stripped to text, never executed', () => {
  // The engine may not construct an element, precisely so that piping forum
  // HTML through innerHTML to read it back out is not an option.
  const out = api.stripHtml('<script>steal()</script>ordinary text');
  assert.strictEqual(out.indexOf('<script') , -1);
  assert.ok(out.indexOf('ordinary text') !== -1);
});

test('escapeHtml neutralises every character that could break out of markup', () => {
  assert.strictEqual(api.escapeHtml('<img src=x onerror="a">'), '&lt;img src=x onerror=&quot;a&quot;&gt;');
  assert.strictEqual(api.escapeHtml("it's"), 'it&#39;s');
  assert.strictEqual(api.escapeHtml('a & b'), 'a &amp; b');
  assert.strictEqual(api.escapeHtml(null), '');
  assert.strictEqual(api.escapeHtml(undefined), '');
  assert.strictEqual(api.escapeHtml(5), '5');
});

test('is:started and is:posted pick My posts roles and are false elsewhere', () => {
  const s = row({ mineRole: 'started' });
  const p = row({ mineRole: 'posted' });
  const n = row({ mineRole: null });
  const started = api.parseQuery('is:started');
  const posted = api.parseQuery('is:posted');
  assert.deepStrictEqual([s, p, n].map((r) => api.matchThread(r, started)), [true, false, false]);
  assert.deepStrictEqual([s, p, n].map((r) => api.matchThread(r, posted)), [false, true, false]);
  assert.strictEqual(api.matchThread(n, api.parseQuery('-is:posted')), true);
});
