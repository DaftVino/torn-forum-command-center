'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { loadUserscript } = require('./load-userscript');

const { exports: api } = loadUserscript();

function posts(n, from, text) {
  const out = [];
  for (let i = 0; i < n; i += 1) {
    out.push({ id: (from || 0) + i + 1, authorName: 'a', at: 1000 + i, text: text || ('post body ' + i) });
  }
  return out;
}

test('adding a thread stores its posts and remembers the order', () => {
  let c = api.freshPostCache();
  c = api.postCacheAdd(c, 1, posts(3), { fetchedAt: 10, pages: 1, complete: true });
  c = api.postCacheAdd(c, 2, posts(2, 100), { fetchedAt: 11, pages: 1, complete: true });

  assert.deepStrictEqual(c.order, ['1', '2']);
  assert.strictEqual(api.postCachePostsFor(c, 1).length, 3);
  assert.strictEqual(c.threads['1'].complete, true);
});

test('re-adding a thread moves it to the newest end rather than duplicating it', () => {
  let c = api.freshPostCache();
  c = api.postCacheAdd(c, 1, posts(2), { fetchedAt: 1 });
  c = api.postCacheAdd(c, 2, posts(2, 50), { fetchedAt: 2 });
  c = api.postCacheAdd(c, 1, posts(3), { fetchedAt: 3 });

  assert.deepStrictEqual(c.order, ['2', '1']);
  assert.strictEqual(api.postCachePostsFor(c, 1).length, 3, 'the newer fetch replaces the older one');
});

test('duplicate post ids within one add are collapsed', () => {
  let c = api.freshPostCache();
  c = api.postCacheAdd(c, 1, [
    { id: 5, text: 'first' }, { id: 5, text: 'again' }, { id: 6, text: 'other' },
  ], { fetchedAt: 1 });
  assert.strictEqual(api.postCachePostsFor(c, 1).length, 2);
});

test('an add with nothing usable leaves the cache alone', () => {
  let c = api.postCacheAdd(api.freshPostCache(), 1, posts(2), { fetchedAt: 1 });
  const before = JSON.stringify(c);
  c = api.postCacheAdd(c, 2, [], { fetchedAt: 2 });
  c = api.postCacheAdd(c, 3, [{ id: 0 }, null, 'x'], { fetchedAt: 3 });
  c = api.postCacheAdd(c, 0, posts(2), { fetchedAt: 4 });
  assert.strictEqual(JSON.stringify(c), before);
});

test('Torn post shape is accepted as it arrives', () => {
  // created_time is unix seconds and content is HTML. Both are converted at the
  // boundary so nothing downstream has to remember which unit or format it has.
  let c = api.freshPostCache();
  c = api.postCacheAdd(c, 1, [{
    id: 9, author: { id: 3, username: 'Ched' }, created_time: 1700000000,
    content: '<p>Hello <b>there</b></p>',
  }], { fetchedAt: 1 });

  const p = api.postCachePostsFor(c, 1)[0];
  assert.strictEqual(p.authorId, 3);
  assert.strictEqual(p.authorName, 'Ched');
  assert.strictEqual(p.at, 1700000000 * 1000);
  assert.strictEqual(p.text, 'Hello there');
});

test('the post ceiling holds and evicts whole threads, oldest first', () => {
  let c = api.freshPostCache();
  const per = 300;
  const needed = Math.ceil(api.POST_CACHE_MAX_POSTS / per) + 3;
  for (let i = 1; i <= needed; i += 1) {
    c = api.postCacheAdd(c, i, posts(per, i * 1000), { fetchedAt: i });
  }

  const size = api.postCacheSize(c);
  assert.ok(size.posts <= api.POST_CACHE_MAX_POSTS, 'posts: ' + size.posts);

  // The newest thread must survive; the oldest must be the one that went.
  assert.ok(c.order.indexOf(String(needed)) !== -1, 'the newest thread was evicted');
  assert.strictEqual(c.order.indexOf('1'), -1, 'the oldest thread should have gone');
});

test('the byte ceiling holds even when the post count is legal', () => {
  let c = api.freshPostCache();
  const fat = 'x'.repeat(7000);
  for (let i = 1; i <= 40; i += 1) {
    c = api.postCacheAdd(c, i, posts(10, i * 1000, fat), { fetchedAt: i });
  }
  const size = api.postCacheSize(c);
  assert.ok(size.bytes <= api.POST_CACHE_MAX_BYTES, 'bytes: ' + size.bytes);
  assert.ok(size.posts > 0, 'it must not evict everything');
});

test('eviction never leaves a thread half present', () => {
  let c = api.freshPostCache();
  for (let i = 1; i <= 12; i += 1) c = api.postCacheAdd(c, i, posts(250, i * 1000), { fetchedAt: i });

  // A partly evicted thread would look cached while silently searching less
  // than it holds, so threads are the unit of eviction.
  for (const id of c.order) {
    assert.ok(c.threads[id], id + ' is in order but not in threads');
    assert.ok(c.threads[id].posts.length > 0, id + ' kept an empty post list');
  }
  for (const id of Object.keys(c.threads)) {
    assert.ok(c.order.indexOf(id) !== -1, id + ' is in threads but not in order');
  }
});

test('eviction converges in one pass', () => {
  let c = api.freshPostCache();
  for (let i = 1; i <= 15; i += 1) c = api.postCacheAdd(c, i, posts(200, i * 1000), { fetchedAt: i });
  const once = api.postCacheEvict(c);
  const twice = api.postCacheEvict(once);
  assert.deepStrictEqual(twice.order, once.order, 'a second pass should change nothing');
});

test('a cache loaded from storage is normalised and capped on the way in', () => {
  const hostile = {
    v: 1,
    order: ['1', 'not-an-id', '2'],
    threads: {
      1: { fetchedAt: 1, posts: [{ id: 1, text: 'ok' }, { id: 0 }, null] },
      'bad-id': { posts: [{ id: 5, text: 'x' }] },
      2: { posts: 'not an array' },
      3: { posts: [{ id: 7, text: 'orphan not listed in order' }] },
    },
  };
  const c = api.normalisePostCache(hostile);
  assert.deepStrictEqual(Object.keys(c.threads).sort(), ['1', '3']);
  assert.strictEqual(api.postCachePostsFor(c, 1).length, 1);
  for (const id of c.order) assert.ok(c.threads[id], 'order and threads must agree');
});

test('postCacheSize reports zero for an empty cache without throwing', () => {
  const s = api.postCacheSize(api.freshPostCache());
  assert.strictEqual(s.posts, 0);
  assert.strictEqual(s.threads, 0);
  assert.ok(s.bytes > 0);
  assert.doesNotThrow(() => api.postCacheSize(null));
});

test('the cache caps are what the spec promises', () => {
  assert.strictEqual(api.POST_CACHE_MAX_POSTS, 2000);
  assert.strictEqual(api.POST_CACHE_MAX_BYTES, 1500000);
});
