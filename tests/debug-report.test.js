'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { loadUserscript, FORUMS_LOCATION } = require('./load-userscript');

const KEY = 'abcdefghij123456';
const NOW = 1700000000000;

function loaded() {
  const env = loadUserscript({
    location: Object.assign({}, FORUMS_LOCATION, { hash: '#/p=threads&f=61&t=16589908' }),
    now: NOW,
    gmStore: [['tfcc:key', KEY]],
    GM_xmlhttpRequest: (cfg) => cfg.onload({ status: 200, responseText: '{}' }),
  });
  const api = env.exports;

  // Fill state with everything a report must never repeat back.
  api.state.feed.subscribed = [api.normaliseSubscribedRow({
    id: 1, forum_id: 61, title: 'A private faction plan nobody else should read',
    author: { id: 2, username: 'SecretPlanner', karma: 1 }, posts: { new: 2, total: 9 },
  })];
  api.state.organizer.threads['1'] = api.normaliseThreadEntry({
    note: 'my confidential note about a war',
    tags: ['confidential-tag'],
  });
  api.state.drafts = api.saveDraft(api.freshDrafts(), 1, 'the reply I have not posted yet', NOW, 'A private faction plan');
  api.state.postCache = api.postCacheAdd(api.freshPostCache(), 1, [
    { id: 5, authorName: 'someone', at: NOW, text: 'a post body quoted from the forum' },
  ], { fetchedAt: NOW });
  api.state.lastError = { reason: 'torn', detail: 'That API key is not valid. Check it in Settings.' };
  const mine = api.freshMine();
  mine.threads = [Object.assign(api.freshMineThread(77, NOW), {
    posted: true, title: 'MY SECRET THREAD TITLE', totalKnown: true, postsTotal: 3, baselineTotal: 1,
  })];
  api.state.mine = mine;
  api.state.mineError = { reason: 'torn', detail: 'Threads you posted in could not be loaded: SECRET POST BODY' };
  api.recompute(NOW);
  return env;
}

test('the report carries what a maintainer needs', () => {
  const env = loaded();
  const report = env.exports.buildDebugReport();

  assert.match(report, /Torn Forum Command Center debug report/);
  assert.match(report, new RegExp('version: ' + env.exports.SCRIPT_VERSION));
  assert.match(report, /transport: gm/, 'which transport tier ran is the first thing to know');
  assert.match(report, /api key present: yes/);
  assert.match(report, /subscribed rows: 1/);
  assert.match(report, /drafts: 1/);
  assert.match(report, /cached posts: 1/);
  assert.match(report, /on a thread: yes/);
  assert.match(report, /last error: torn - That API key is not valid/);
  assert.match(report, /my posts threads: 1/);
  assert.match(report, /my posts posted in: 1/);
  assert.match(report, /my posts unchecked: 0/);
  assert.match(report, /my posts error: torn/);
});

test('the report never carries anything private', () => {
  // A denylist scan over the whole rendered report, not a spot check: the point
  // is that a field added to state later cannot leak by being added.
  const env = loaded();
  const report = env.exports.buildDebugReport();

  const forbidden = [
    [KEY, 'the API key'],
    ['my confidential note about a war', 'a note'],
    ['the reply I have not posted yet', 'a draft'],
    ['a post body quoted from the forum', 'a cached post body'],
    ['A private faction plan', 'a thread title'],
    ['SecretPlanner', 'an author name'],
    ['confidential-tag', 'a tag'],
    ['16589908', 'the thread id currently open'],
    ['MY SECRET THREAD TITLE', 'a My posts thread title'],
    ['SECRET POST BODY', 'My posts error free text'],
  ];

  for (const [needle, label] of forbidden) {
    assert.strictEqual(report.indexOf(needle), -1, 'the debug report leaked ' + label + ':\n' + report);
  }
});

test('the report is a whitelist of scalars, so new state cannot leak into it', () => {
  const env = loaded();
  const ctx = env.exports.gatherDebugContext();

  // Everything reachable from the context is a number, a boolean, a short
  // enumerated string or null. No free text from Torn, and no user text.
  const walk = (value, path) => {
    if (value === null) return;
    if (typeof value === 'number' || typeof value === 'boolean') return;
    if (typeof value === 'string') {
      assert.ok(value.length <= 120, path + ' is a long string: ' + value);
      return;
    }
    assert.strictEqual(typeof value, 'object', path + ' is a ' + typeof value);
    for (const k of Object.keys(value)) walk(value[k], path + '.' + k);
  };
  walk(ctx, 'ctx');
});

test('a report with no key says no rather than saying nothing', () => {
  const env = loadUserscript();
  const report = env.exports.buildDebugReport();
  assert.match(report, /api key present: no/);
  assert.match(report, /transport: none/);
  assert.match(report, /last error: none/);
});

test('the report renders before anything has loaded', () => {
  const env = loadUserscript();
  assert.doesNotThrow(() => env.exports.buildDebugReport());
  assert.ok(env.exports.buildDebugReport().length > 100);
});

test('an error detail in the report is already scrubbed of any URL', () => {
  const env = loaded();
  env.exports.state.lastError = {
    reason: 'network',
    detail: env.exports.scrubDetail('failed loading https://api.torn.com/v2/user/forumfeed?key=' + KEY),
  };
  const report = env.exports.buildDebugReport();
  assert.strictEqual(report.indexOf(KEY), -1);
  assert.match(report, /\[redacted\]/);
});
