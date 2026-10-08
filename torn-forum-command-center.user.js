// ==UserScript==
// @name         Torn Forum Command Center
// @namespace    https://github.com/DaftVino/torn-forum-command-center
// @version      0.1.0
// @description  TORN PDA COMPATIBLE. Replaces Torn's small subscribed-threads box with a full forum workspace: folders, tags, pins, read/unread tracking, catch-up since your last visit, local reply drafts, and author-aware search across the threads you follow.
// @author       DaftVino
// @license      MIT
// @match        https://www.torn.com/forums.php*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_xmlhttpRequest
// @connect      api.torn.com
// @run-at       document-end
// ==/UserScript==

// @match is deliberately the whole of forums.php, because the forum is a
// hash-routed single page and a query string cannot be expressed here.
// isForumsPage() below does the real scoping, and it must stay at least as
// strict as this line: Torn PDA does not honour @match at all and injects the
// script on every Torn page.

// @connect names exactly one host. api.torn.com is the only place this script
// ever sends a request, and it only ever sends GETs. Adding a host, a grant or
// a wider @match needs a stated reason in the PR description.

// @license is not decoration and not a duplicate of the LICENSE file. This
// file is the whole distribution: a player installs the raw .user.js, and the
// repository does not travel with it. Greasy Fork reads this key rather than
// the repo to decide what it is allowed to host.

// EVERY CHARACTER IN THIS FILE IS ASCII, ON PURPOSE. Torn PDA's
// UserScriptsProvider.adaptSource rewrites typographic quotes across the whole
// source before injecting it. In the sibling Education Scheduler that turned
// four curly apostrophes inside single-quoted strings into syntax errors, and
// nothing in the script ran at all. tests/metadata.test.js fails the build on
// any character outside 0x09-0x7E.

(function () {
  'use strict';

  var SCRIPT_VERSION = '0.1.0';

  var PANEL_ID = 'tfcc-panel';
  var FALLBACK_ID = 'tfcc-fallback-mount';
  var STYLE_ID = 'tfcc-style';
  var NAV_FLAG = '__tfccNavInstalled';
  var THEME_FLAG = '__tfccThemeObserved';

  var SCHEMA_VERSION = 1;
  var STORAGE_KEYS = Object.freeze({
    key: 'tfcc:key',
    settings: 'tfcc:settings',
    organizer: 'tfcc:organizer',
    drafts: 'tfcc:drafts',
    feed: 'tfcc:feed',
    postCache: 'tfcc:postcache',
    mine: 'tfcc:mine',
  });

  var API_BASE = 'https://api.torn.com/v2';
  var REQUEST_TIMEOUT_MS = 15000;
  var MIN_REQUEST_GAP_MS = 650;
  var REQUESTS_PER_WINDOW = 40;
  var RATE_WINDOW_MS = 60000;
  var CATEGORY_TTL_MS = 24 * 60 * 60 * 1000;
  var ENRICH_TTL_MS = 15 * 60 * 1000;
  var DEFAULT_ENRICH_BUDGET = 10;
  var MAX_ENRICH_BUDGET = 25;
  var DEEP_SEARCH_MAX_PAGES = 5;
  var DEEP_SEARCH_MAX_THREADS = 10;
  var POSTS_PER_PAGE = 20;

  var DOM_READY_POLL_MS = 250;
  var DOM_READY_MAX_POLLS = 40;
  var NAV_DEBOUNCE_MS = 150;
  var AUTOSAVE_DEBOUNCE_MS = 1200;

  // Torn PDA substitutes this literal in the source at injection time. The
  // sentinel it is compared against is assembled from fragments, so that same
  // substitution cannot rewrite the comparison and make a replaced slot look
  // unreplaced.
  var PDA_KEY_SLOT = '###PDA-APIKEY###';
  var PDA_KEY_SENTINEL = ['###', 'PDA-APIKEY', '###'].join('');

  var GREASY_FORK_URL = 'https://greasyfork.org/en/scripts/torn-forum-command-center';

  // ---- ENGINE START ----------------------------------------------------
  // Pure functions only. No DOM, no network, no GM_*, no ambient clock: any
  // function that needs the time takes it as an argument. tests/purity.test.js
  // reads this section with comments stripped and fails on a forbidden name.

  var PRIORITY_MIN = -2;
  var PRIORITY_MAX = 2;
  var DRAFT_MAX_CHARS = 20000;
  var POST_CACHE_MAX_POSTS = 2000;
  var MINE_MAX_THREADS = 200;
  var POST_CACHE_MAX_BYTES = 1500000;
  var EXPORT_PREFIX = 'TFCC1:';

  var ACTIVITY_SOURCES = Object.freeze(['enriched', 'feed', 'mine', 'enriched-stale', 'own-post', 'visit', 'none']);

  var SORT_MODES = Object.freeze(['activity', 'unread', 'priority', 'title', 'author', 'forum', 'added']);
  var SORT_LABELS = Object.freeze({
    activity: 'Last activity',
    unread: 'Unread first',
    priority: 'My priority',
    title: 'Title',
    author: 'Author',
    forum: 'Forum',
    added: 'Recently added',
  });

  var VIEWS = Object.freeze(['threads', 'catchup', 'search', 'drafts', 'settings']);

  var THEMES = Object.freeze(['dark', 'light', 'match']);

  var DEFAULT_FOLDERS = Object.freeze([
    Object.freeze({ id: 'guides', name: 'Guides', order: 0, forumIds: Object.freeze([]) }),
    Object.freeze({ id: 'scripts', name: 'Scripts and tools', order: 1, forumIds: Object.freeze([]) }),
    Object.freeze({ id: 'faction', name: 'Faction', order: 2, forumIds: Object.freeze([]) }),
  ]);

  // Torn's acceptable usage terms are explicit: "Multiple requests using invalid
  // keys may result in a temporary IP ban - you must account for this by
  // removing disabled or invalid keys upon error." These are the codes that mean
  // the key itself is no good, so retrying it can only earn that ban.
  //
  // Deliberately NOT here: 5 (rate limited), 9 (maintenance), 10 (owner in
  // federal jail), 11 (key changed too recently) and 17 (Torn backend error).
  // Every one of those passes on its own, and treating them as a dead key would
  // make a user re-enter a key that was never wrong.
  var KEY_REJECTED_CODES = Object.freeze([2, 13, 16, 18]);

  var TORN_ERRORS = Object.freeze({
    0: 'Torn reported an unknown error.',
    1: 'Torn rejected the request as empty.',
    2: 'That API key is not valid. Check it in Settings.',
    5: 'Torn is rate limiting this key. The script will back off; try again in a minute.',
    6: 'Torn does not recognise that ID.',
    7: 'That selection is not available to this key.',
    8: 'Torn has temporarily banned this IP from the API.',
    9: 'The Torn API is in maintenance mode.',
    10: 'That key owner is in federal jail.',
    11: 'That key has changed too recently.',
    13: 'That key has been disabled because the account is inactive.',
    16: 'That key cannot read your subscribed threads. Use a Minimal Access key; Limited Access also works. A Public Only key does not.',
    17: 'Torn had a backend error for that request.',
    18: 'That key has been paused by its owner.',
  });

  function isPlainObject(v) {
    return !!v && typeof v === 'object' && !Array.isArray(v);
  }

  function toInt(v, fallback) {
    var n = Number(v);
    if (!isFinite(n)) return fallback;
    return Math.floor(n);
  }

  function clamp(n, lo, hi) {
    if (n < lo) return lo;
    if (n > hi) return hi;
    return n;
  }

  function safeString(v, max) {
    if (typeof v !== 'string') return '';
    var limit = max === undefined ? 500 : max;
    return v.length > limit ? v.slice(0, limit) : v;
  }

  function uniqueStrings(list) {
    var seen = {};
    var out = [];
    for (var i = 0; i < list.length; i += 1) {
      var s = list[i];
      if (typeof s !== 'string' || !s) continue;
      if (Object.prototype.hasOwnProperty.call(seen, s)) continue;
      seen[s] = true;
      out.push(s);
    }
    return out;
  }

  // Torn hands out unix seconds. Everything inside this script is milliseconds,
  // converted once here so no comparison has to remember which unit it holds.
  function secondsToMs(v) {
    var n = Number(v);
    if (!isFinite(n) || n <= 0) return 0;
    return Math.floor(n) * 1000;
  }

  function escapeHtml(v) {
    return String(v === undefined || v === null ? '' : v)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // Deliberately not a DOM parse: the engine may not construct an element, and
  // a userscript that pipes forum HTML through innerHTML to read it back out is
  // handing an attacker a script tag. This strips tags and decodes the five
  // entities that matter, and nothing else.
  function stripHtml(html) {
    if (typeof html !== 'string' || !html) return '';
    return html
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|li|tr|h[1-6])>/gi, '\n')
      .replace(/<[^>]*>/g, ' ')
      .replace(/&nbsp;/gi, ' ')
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/&quot;/gi, '"')
      .replace(/&#0*39;|&apos;/gi, "'")
      .replace(/&amp;/gi, '&')
      .replace(/[ \t]+/g, ' ')
      // A block close becomes a newline and the next block open becomes a
      // space, so without this every paragraph break carries a stray indent
      // into the search index and into what the panel shows.
      .replace(/[ \t]*\n[ \t]*/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  // -- routing -----------------------------------------------------------

  function isForumsPage(loc) {
    try {
      var l = loc;
      if (!l) return false;
      var host = l.hostname;
      if (host !== 'www.torn.com' && host !== 'torn.com') return false;
      return l.pathname === '/forums.php';
    } catch (e) {
      return false;
    }
  }

  // The forum SPA addresses itself through the hash, but the same grammar also
  // turns up in the query string on links pasted from search engines, so both
  // are read. Unknown parameters are ignored rather than guessed at: research
  // could not confirm what b and a mean, so this never pretends to know.
  function parseForumRoute(loc) {
    var raw = '';
    try {
      raw = String((loc && loc.hash) || '');
      if (raw.charAt(0) === '#') raw = raw.slice(1);
      if (raw.charAt(0) === '/') raw = raw.slice(1);
      if (!raw) {
        raw = String((loc && loc.search) || '');
        if (raw.charAt(0) === '?') raw = raw.slice(1);
      }
    } catch (e) {
      raw = '';
    }

    var params = {};
    var parts = raw.split('&');
    for (var i = 0; i < parts.length; i += 1) {
      var eq = parts[i].indexOf('=');
      if (eq <= 0) continue;
      var k = parts[i].slice(0, eq);
      var v = parts[i].slice(eq + 1);
      if (!Object.prototype.hasOwnProperty.call(params, k)) params[k] = v;
    }

    function num(name) {
      if (!Object.prototype.hasOwnProperty.call(params, name)) return null;
      var n = Number(params[name]);
      if (!isFinite(n) || n <= 0 || Math.floor(n) !== n) return null;
      return n;
    }

    var view = Object.prototype.hasOwnProperty.call(params, 'p') ? String(params.p) : null;
    var threadId = num('t');
    var forumId = num('f');

    return Object.freeze({
      view: view,
      forumId: forumId,
      threadId: threadId,
      isThread: threadId !== null,
    });
  }

  // Indexed thread pages are titled "{Thread title} | {Category} | TORN". The
  // separator is the only structure this relies on, and a title that does not
  // match is stored verbatim rather than guessed at.
  function titleToThreadName(docTitle) {
    var t = safeString(docTitle, 300).trim();
    if (!t) return '';
    var parts = t.split('|');
    if (parts.length >= 3) return parts.slice(0, parts.length - 2).join('|').trim();
    if (parts.length === 2) return parts[0].trim();
    return t;
  }

  // -- storage normalisers -----------------------------------------------
  // Every normaliser is total: it takes anything at all and returns a valid
  // object. It never throws and never returns something half-valid, so a
  // corrupted key can only ever cost the user that one key.

  function settingsDefaults() {
    return {
      v: SCHEMA_VERSION,
      theme: 'dark',
      sort: 'activity',
      view: 'threads',
      collapsed: false,
      takeover: false,
      unreadOnly: false,
      folderFilter: null,
      tagFilter: null,
      autoRefreshMs: 0,
      enrichBudget: DEFAULT_ENRICH_BUDGET,
      autosaveDrafts: true,
      hideTornBox: false,
      // Issue #8. Off by default: an existing user sees no change.
      autoHideOnOpen: false,
      // The Torn error code that condemned the stored key, or 0. Persisted on
      // purpose: a userscript reloads on every navigation, so a rejection held
      // only in memory would spend one request per page view on a dead key,
      // which is the exact pattern the IP ban exists for.
      keyRejected: 0,
      deepSearchPages: DEEP_SEARCH_MAX_PAGES,
    };
  }

  function freshSettings() { return settingsDefaults(); }

  function normaliseSettings(raw) {
    var d = settingsDefaults();
    if (!isPlainObject(raw)) return d;
    if (toInt(raw.v, 0) > SCHEMA_VERSION) return d;
    var out = settingsDefaults();
    if (THEMES.indexOf(raw.theme) !== -1) out.theme = raw.theme;
    if (SORT_MODES.indexOf(raw.sort) !== -1) out.sort = raw.sort;
    if (VIEWS.indexOf(raw.view) !== -1) out.view = raw.view;
    out.collapsed = raw.collapsed === true;
    out.takeover = raw.takeover === true;
    out.unreadOnly = raw.unreadOnly === true;
    out.autosaveDrafts = raw.autosaveDrafts !== false;
    out.hideTornBox = raw.hideTornBox === true;
    out.autoHideOnOpen = raw.autoHideOnOpen === true;
    out.keyRejected = KEY_REJECTED_CODES.indexOf(toInt(raw.keyRejected, 0)) === -1
      ? 0 : toInt(raw.keyRejected, 0);
    out.folderFilter = typeof raw.folderFilter === 'string' ? safeString(raw.folderFilter, 64) : null;
    out.tagFilter = typeof raw.tagFilter === 'string' ? safeString(raw.tagFilter, 64) : null;
    var auto = toInt(raw.autoRefreshMs, 0);
    out.autoRefreshMs = [0, 120000, 300000, 900000].indexOf(auto) !== -1 ? auto : 0;
    out.enrichBudget = clamp(toInt(raw.enrichBudget, DEFAULT_ENRICH_BUDGET), 0, MAX_ENRICH_BUDGET);
    out.deepSearchPages = clamp(toInt(raw.deepSearchPages, DEEP_SEARCH_MAX_PAGES), 1, DEEP_SEARCH_MAX_PAGES);
    return out;
  }

  // An upgrade adds a top-level field the stored value never had. Filling those
  // from the normalised value before comparing keeps "damaged" meaning damaged:
  // a field that was present and changed, or one the normaliser dropped. Nested
  // shapes keep the strict comparison on purpose (spec: "The upgrade trap").
  function isRecoveredValue(raw, value) {
    if (raw === null) return false;
    var seen = isPlainObject(raw) && isPlainObject(value) ? Object.assign({}, value, raw) : raw;
    return JSON.stringify(seen) !== JSON.stringify(value);
  }

  // -- auto-hide on opening a thread (issue #8) ---------------------------
  // Only a plain activation counts. A modified or middle click opens the
  // thread somewhere else, and the user still wants the panel in this tab.
  // A prevented click does not navigate, so it must not collapse either.
  function isPlainActivation(click) {
    if (!isPlainObject(click)) return false;
    if (toInt(click.button, 0) !== 0) return false;
    if (click.ctrlKey === true || click.metaKey === true) return false;
    if (click.shiftKey === true || click.altKey === true) return false;
    if (click.defaultPrevented === true) return false;
    return true;
  }

  // Returns the same object when the setting is off, so the caller can tell by
  // identity that there is nothing to write. A collapsed panel in takeover
  // still covers the whole viewport, so opening a thread leaves takeover too.
  function autoHideSettings(settings) {
    if (!isPlainObject(settings) || settings.autoHideOnOpen !== true) return settings;
    return Object.assign({}, settings, { collapsed: true, takeover: false });
  }

  function freshOrganizer(now) {
    return {
      v: SCHEMA_VERSION,
      folders: DEFAULT_FOLDERS.map(function (f) {
        return { id: f.id, name: f.name, order: f.order, forumIds: [] };
      }),
      threads: {},
      lastCatchUpAt: toInt(now, 0),
    };
  }

  function normaliseThreadEntry(raw) {
    var e = {
      folderId: null,
      tags: [],
      pinned: false,
      priority: 0,
      note: '',
      title: '',
      forumId: 0,
      authorId: 0,
      authorName: '',
      lastVisitedAt: 0,
      lastSeenTotal: 0,
      lastPostTimeCached: 0,
      enrichedAt: 0,
      postsTotal: 0,
      isLocked: false,
      isSticky: false,
      firstSeenAt: 0,
      archived: false,
    };
    if (!isPlainObject(raw)) return e;
    if (typeof raw.folderId === 'string' && raw.folderId) e.folderId = safeString(raw.folderId, 64);
    if (Array.isArray(raw.tags)) {
      e.tags = uniqueStrings(raw.tags.map(function (t) { return safeString(t, 48).trim().toLowerCase(); })).slice(0, 24);
    }
    e.pinned = raw.pinned === true;
    e.archived = raw.archived === true;
    e.priority = clamp(toInt(raw.priority, 0), PRIORITY_MIN, PRIORITY_MAX);
    e.note = safeString(raw.note, 2000);
    e.title = safeString(raw.title, 300);
    e.forumId = Math.max(0, toInt(raw.forumId, 0));
    e.authorId = Math.max(0, toInt(raw.authorId, 0));
    e.authorName = safeString(raw.authorName, 60);
    e.lastVisitedAt = Math.max(0, toInt(raw.lastVisitedAt, 0));
    e.lastSeenTotal = Math.max(0, toInt(raw.lastSeenTotal, 0));
    e.lastPostTimeCached = Math.max(0, toInt(raw.lastPostTimeCached, 0));
    e.enrichedAt = Math.max(0, toInt(raw.enrichedAt, 0));
    e.postsTotal = Math.max(0, toInt(raw.postsTotal, 0));
    e.isLocked = raw.isLocked === true;
    e.isSticky = raw.isSticky === true;
    e.firstSeenAt = Math.max(0, toInt(raw.firstSeenAt, 0));
    return e;
  }

  function normaliseFolder(raw, index) {
    if (!isPlainObject(raw)) return null;
    var id = safeString(raw.id, 64).trim();
    var name = safeString(raw.name, 64).trim();
    if (!id || !name) return null;
    var forumIds = [];
    if (Array.isArray(raw.forumIds)) {
      for (var i = 0; i < raw.forumIds.length && forumIds.length < 40; i += 1) {
        var n = toInt(raw.forumIds[i], 0);
        if (n > 0 && forumIds.indexOf(n) === -1) forumIds.push(n);
      }
    }
    return { id: id, name: name, order: toInt(raw.order, index), forumIds: forumIds };
  }

  function normaliseOrganizer(raw, now) {
    if (!isPlainObject(raw)) return freshOrganizer(now);
    if (toInt(raw.v, 0) > SCHEMA_VERSION) return freshOrganizer(now);

    var folders = [];
    var seenFolder = {};
    if (Array.isArray(raw.folders)) {
      for (var i = 0; i < raw.folders.length && folders.length < 40; i += 1) {
        var f = normaliseFolder(raw.folders[i], i);
        if (!f) continue;
        if (Object.prototype.hasOwnProperty.call(seenFolder, f.id)) continue;
        seenFolder[f.id] = true;
        folders.push(f);
      }
    }
    if (!folders.length) {
      folders = DEFAULT_FOLDERS.map(function (d) {
        return { id: d.id, name: d.name, order: d.order, forumIds: [] };
      });
      folders.forEach(function (d) { seenFolder[d.id] = true; });
    }

    var threads = {};
    if (isPlainObject(raw.threads)) {
      var ids = Object.keys(raw.threads);
      for (var j = 0; j < ids.length && j < 5000; j += 1) {
        var id = ids[j];
        if (!/^[0-9]{1,12}$/.test(id)) continue;
        var entry = normaliseThreadEntry(raw.threads[id]);
        // A folder that no longer exists must not orphan the thread's notes.
        if (entry.folderId && !Object.prototype.hasOwnProperty.call(seenFolder, entry.folderId)) {
          entry.folderId = null;
        }
        threads[id] = entry;
      }
    }

    return {
      v: SCHEMA_VERSION,
      folders: folders.sort(function (a, b) { return a.order - b.order; }),
      threads: threads,
      lastCatchUpAt: Math.max(0, toInt(raw.lastCatchUpAt, 0)),
    };
  }

  function freshDrafts() { return { v: SCHEMA_VERSION, byThread: {} }; }

  function normaliseDrafts(raw) {
    if (!isPlainObject(raw)) return freshDrafts();
    if (toInt(raw.v, 0) > SCHEMA_VERSION) return freshDrafts();
    var out = freshDrafts();
    if (!isPlainObject(raw.byThread)) return out;
    var ids = Object.keys(raw.byThread);
    for (var i = 0; i < ids.length && i < 500; i += 1) {
      var id = ids[i];
      if (!/^[0-9]{1,12}$/.test(id)) continue;
      var d = raw.byThread[id];
      if (!isPlainObject(d)) continue;
      var text = safeString(d.text, DRAFT_MAX_CHARS);
      if (!text) continue;
      out.byThread[id] = {
        text: text,
        updatedAt: Math.max(0, toInt(d.updatedAt, 0)),
        title: safeString(d.title, 300),
      };
    }
    return out;
  }

  function freshFeed() {
    return { v: SCHEMA_VERSION, fetchedAt: 0, subscribed: [], activity: [], categories: [], categoriesAt: 0 };
  }

  function normaliseSubscribedRow(raw) {
    if (!isPlainObject(raw)) return null;
    var id = toInt(raw.id, 0);
    if (id <= 0) return null;
    var author = isPlainObject(raw.author) ? raw.author : {};
    var posts = isPlainObject(raw.posts) ? raw.posts : {};
    // This reads two shapes: Torn's nested response, and the flat row this
    // function itself returns and the feed cache stores. Without the flat
    // fallback the nested lookups miss on every reload, the four fields below
    // reset to zero, and loadKey sees the difference and tells the user their
    // cache was damaged when the only thing that damaged it was reading it.
    return {
      id: id,
      forumId: Math.max(0, toInt(raw.forum_id === undefined ? raw.forumId : raw.forum_id, 0)),
      title: safeString(raw.title, 300),
      authorId: Math.max(0, toInt(author.id === undefined ? raw.authorId : author.id, 0)),
      authorName: safeString(author.username === undefined ? raw.authorName : author.username, 60),
      postsNew: Math.max(0, toInt(posts['new'] === undefined ? raw.postsNew : posts['new'], 0)),
      postsTotal: Math.max(0, toInt(posts.total === undefined ? raw.postsTotal : posts.total, 0)),
    };
  }

  function normaliseActivityRow(raw) {
    if (!isPlainObject(raw)) return null;
    var threadId = toInt(raw.thread_id === undefined ? raw.threadId : raw.thread_id, 0);
    if (threadId <= 0) return null;
    var user = isPlainObject(raw.user) ? raw.user : {};
    var at = raw.at === undefined ? secondsToMs(raw.timestamp) : Math.max(0, toInt(raw.at, 0));
    return {
      threadId: threadId,
      postId: Math.max(0, toInt(raw.post_id === undefined ? raw.postId : raw.post_id, 0)),
      title: safeString(raw.title, 300),
      userName: safeString(user.username === undefined ? raw.userName : user.username, 60),
      at: at,
      isSeen: raw.is_seen === true || raw.isSeen === true,
      type: Math.max(0, toInt(raw.type, 0)),
    };
  }

  function normaliseCategoryRow(raw) {
    if (!isPlainObject(raw)) return null;
    var id = toInt(raw.id, 0);
    if (id <= 0) return null;
    return {
      id: id,
      title: safeString(raw.title, 80),
      acronym: safeString(raw.acronym, 12),
    };
  }

  function normaliseFeed(raw) {
    if (!isPlainObject(raw)) return freshFeed();
    if (toInt(raw.v, 0) > SCHEMA_VERSION) return freshFeed();
    var out = freshFeed();
    out.fetchedAt = Math.max(0, toInt(raw.fetchedAt, 0));
    out.categoriesAt = Math.max(0, toInt(raw.categoriesAt, 0));
    var i;
    if (Array.isArray(raw.subscribed)) {
      for (i = 0; i < raw.subscribed.length && out.subscribed.length < 2000; i += 1) {
        var s = normaliseSubscribedRow(raw.subscribed[i]);
        if (s) out.subscribed.push(s);
      }
    }
    if (Array.isArray(raw.activity)) {
      for (i = 0; i < raw.activity.length && out.activity.length < 300; i += 1) {
        var a = normaliseActivityRow(raw.activity[i]);
        if (a) out.activity.push(a);
      }
    }
    if (Array.isArray(raw.categories)) {
      for (i = 0; i < raw.categories.length && out.categories.length < 200; i += 1) {
        var c = normaliseCategoryRow(raw.categories[i]);
        if (c) out.categories.push(c);
      }
    }
    return out;
  }

  // -- my posts ---------------------------------------------------------------
  // Threads the key owner started (user/forumthreads) or posted in
  // (user/forumposts). Stored under its own key, tfcc:mine, because adding a
  // field to tfcc:feed would make loadKey report every existing user's feed
  // cache as damaged on the first load after upgrade.

  function pickList(data, names) {
    if (!isPlainObject(data)) return null;
    for (var i = 0; i < names.length; i += 1) {
      if (Array.isArray(data[names[i]])) return data[names[i]];
    }
    return null;
  }

  function freshMine() {
    return { v: SCHEMA_VERSION, fetchedAt: 0, selfId: 0, threads: [] };
  }

  function freshMineThread(id, now) {
    return {
      id: Math.max(0, toInt(id, 0)),
      forumId: 0,
      title: '',
      started: false,
      posted: false,
      myLastPostAt: 0,
      postsTotal: 0,
      totalKnown: false,
      lastPostAt: 0,
      lastPosterId: 0,
      infoAt: 0,
      baselineTotal: 0,
      firstSeenAt: Math.max(0, toInt(now, 0)),
      isLocked: false,
      tornNew: 0,
      tornNewKnown: false,
    };
  }

  // Reads only the shape freshMineThread produces. API rows go through
  // mineThreadFromApi first, so this never has to guess between two shapes.
  function normaliseMineThread(raw) {
    if (!isPlainObject(raw)) return null;
    var id = toInt(raw.id, 0);
    if (id <= 0) return null;
    var t = freshMineThread(id, 0);
    t.forumId = Math.max(0, toInt(raw.forumId, 0));
    t.title = safeString(raw.title, 300);
    t.started = raw.started === true;
    t.posted = raw.posted === true;
    t.myLastPostAt = Math.max(0, toInt(raw.myLastPostAt, 0));
    t.totalKnown = raw.totalKnown === true;
    t.postsTotal = t.totalKnown ? Math.max(0, toInt(raw.postsTotal, 0)) : 0;
    t.lastPostAt = Math.max(0, toInt(raw.lastPostAt, 0));
    t.lastPosterId = Math.max(0, toInt(raw.lastPosterId, 0));
    t.infoAt = Math.max(0, toInt(raw.infoAt, 0));
    t.baselineTotal = Math.max(0, toInt(raw.baselineTotal, 0));
    t.firstSeenAt = Math.max(0, toInt(raw.firstSeenAt, 0));
    t.isLocked = raw.isLocked === true;
    t.tornNewKnown = raw.tornNewKnown === true;
    t.tornNew = t.tornNewKnown ? Math.max(0, toInt(raw.tornNew, 0)) : 0;
    return t;
  }

  function normaliseMine(raw) {
    if (!isPlainObject(raw)) return freshMine();
    if (toInt(raw.v, 0) > SCHEMA_VERSION) return freshMine();
    var out = freshMine();
    out.fetchedAt = Math.max(0, toInt(raw.fetchedAt, 0));
    out.selfId = Math.max(0, toInt(raw.selfId, 0));
    if (Array.isArray(raw.threads)) {
      for (var i = 0; i < raw.threads.length && out.threads.length < MINE_MAX_THREADS; i += 1) {
        var t = normaliseMineThread(raw.threads[i]);
        if (t) out.threads.push(t);
      }
    }
    return out;
  }

  // Every postsTotal this script stores counts every post, topic included:
  // the unit of posts.total on user/forumsubscribedthreads, and so of
  // lastSeenTotal, which markRead writes from it. A thread object's `posts`
  // (user/forumthreads, forum/{id}/thread) counts REPLIES, one fewer: thread
  // 16589908 says posts: 1 and holds 2 posts. Live findings 3 and 4,
  // docs/reference/torn-api-live-findings-2026-10-08.md. Convert here and
  // nowhere else. -1 means unknown.
  function threadPostsTotal(raw) {
    if (!isPlainObject(raw)) return -1;
    if (typeof raw.posts === 'number' && isFinite(raw.posts) && raw.posts >= 0) {
      return Math.floor(raw.posts) + 1;
    }
    if (isPlainObject(raw.posts) && typeof raw.posts.total === 'number' && raw.posts.total >= 0) {
      return Math.floor(raw.posts.total);
    }
    return -1;
  }

  function mineThreadFromApi(raw) {
    if (!isPlainObject(raw)) return null;
    var id = toInt(raw.id, 0);
    if (id <= 0) return null;
    var author = isPlainObject(raw.author) ? raw.author : {};
    var last = isPlainObject(raw.last_poster) ? raw.last_poster : {};
    var total = threadPostsTotal(raw);
    var hasNew = typeof raw.new_posts === 'number' && isFinite(raw.new_posts);
    return {
      id: id,
      forumId: Math.max(0, toInt(raw.forum_id, 0)),
      title: safeString(raw.title, 300),
      authorId: Math.max(0, toInt(author.id, 0)),
      postsTotal: Math.max(0, total),
      totalKnown: total >= 0,
      lastPostAt: secondsToMs(raw.last_post_time),
      lastPosterId: Math.max(0, toInt(last.id, 0)),
      isLocked: raw.is_locked === true,
      // Torn's own unread count for a thread the key owner started (finding 1).
      tornNew: hasNew ? Math.max(0, Math.floor(raw.new_posts)) : 0,
      tornNewKnown: hasNew,
    };
  }

  // The post body arrives in `content` and is deliberately never read.
  function minePostFromApi(raw) {
    if (!isPlainObject(raw)) return null;
    var threadId = toInt(raw.thread_id, 0);
    if (threadId <= 0) return null;
    var author = isPlainObject(raw.author) ? raw.author : {};
    return {
      postId: Math.max(0, toInt(raw.id, 0)),
      threadId: threadId,
      authorId: Math.max(0, toInt(author.id, 0)),
      at: secondsToMs(raw.created_time === undefined ? raw.timestamp : raw.created_time),
    };
  }

  // postsTotal is posts + 1 via threadPostsTotal: same unit as posts.total.
  // A caller must not add 1 again.
  function parseThreadDetail(raw) {
    if (!isPlainObject(raw)) return null;
    var last = isPlainObject(raw.last_poster) ? raw.last_poster : {};
    var total = threadPostsTotal(raw);
    return {
      title: safeString(raw.title, 300),
      forumId: Math.max(0, toInt(raw.forum_id, 0)),
      postsTotal: Math.max(0, total),
      totalKnown: total >= 0,
      lastPostAt: secondsToMs(raw.last_post_time),
      lastPosterId: Math.max(0, toInt(last.id, 0)),
      isLocked: raw.is_locked === true,
      isSticky: raw.is_sticky === true,
    };
  }

  // First sight of a total sets the baseline, so the feature never reports a
  // user's whole posting history as unread on the day it is installed.
  function observeMineTotal(t, total, now) {
    if (!t.totalKnown) t.baselineTotal = total;
    t.postsTotal = total;
    t.totalKnown = true;
    t.infoAt = now;
  }

  // You do not have unread replies to a thread whose last word is yours.
  function advanceMineBaseline(t, selfId) {
    if (!t.totalKnown) return;
    var lastIsMine = (selfId > 0 && t.lastPosterId === selfId)
      || (t.lastPostAt > 0 && t.myLastPostAt >= t.lastPostAt);
    if (lastIsMine) t.baselineTotal = Math.max(t.baselineTotal, t.postsTotal);
  }

  function mineRecency(t) { return Math.max(t.myLastPostAt, t.lastPostAt); }

  function finishMine(out, byId, order) {
    var list = order.map(function (k) { return byId[k]; });
    list.sort(function (a, b) {
      var d = mineRecency(b) - mineRecency(a);
      return d !== 0 ? d : b.id - a.id;
    });
    out.threads = list.slice(0, MINE_MAX_THREADS);
    return out;
  }

  // started: mineThreadFromApi records; posts: minePostFromApi records.
  // complete false (one of the two lists failed) keeps the old fetchedAt, so
  // a partial answer never holds off the next attempt for a whole TTL.
  function mergeMineSnapshot(prev, started, posts, now, complete) {
    var t0 = toInt(now, 0);
    var base = normaliseMine(prev);
    var out = freshMine();
    out.fetchedAt = complete ? t0 : base.fetchedAt;
    out.selfId = base.selfId;
    var byId = {};
    var order = [];
    function rec(id) {
      var k = String(id);
      if (!Object.prototype.hasOwnProperty.call(byId, k)) {
        byId[k] = freshMineThread(id, t0);
        order.push(k);
      }
      return byId[k];
    }
    var i;
    for (i = 0; i < base.threads.length; i += 1) {
      var k0 = String(base.threads[i].id);
      // Torn's new_posts is only as fresh as the forumthreads page it came
      // on. A started thread that dropped off the page falls back to the
      // local count rather than keeping a count Torn no longer reports.
      base.threads[i].tornNewKnown = false;
      base.threads[i].tornNew = 0;
      byId[k0] = base.threads[i];
      order.push(k0);
    }
    for (i = 0; i < (started || []).length; i += 1) {
      var s = started[i];
      if (!s) continue;
      var r = rec(s.id);
      r.started = true;
      if (s.forumId) r.forumId = s.forumId;
      if (s.title) r.title = s.title;
      if (s.lastPostAt) r.lastPostAt = Math.max(r.lastPostAt, s.lastPostAt);
      if (s.lastPosterId) r.lastPosterId = s.lastPosterId;
      r.isLocked = s.isLocked === true;
      r.tornNewKnown = s.tornNewKnown === true;
      r.tornNew = r.tornNewKnown ? s.tornNew : 0;
      if (s.totalKnown) observeMineTotal(r, s.postsTotal, t0);
      if (!out.selfId && s.authorId) out.selfId = s.authorId;
    }
    for (i = 0; i < (posts || []).length; i += 1) {
      var p = posts[i];
      if (!p) continue;
      var rp = rec(p.threadId);
      rp.posted = true;
      rp.myLastPostAt = Math.max(rp.myLastPostAt, p.at);
      if (!out.selfId && p.authorId) out.selfId = p.authorId;
    }
    for (i = 0; i < order.length; i += 1) advanceMineBaseline(byId[order[i]], out.selfId);
    return finishMine(out, byId, order);
  }

  // normaliseMine doubles as the deep clone, so the input is never mutated.
  function applyMineDetail(snap, threadId, detail, now) {
    var out = normaliseMine(snap);
    if (!detail) return out;
    var id = toInt(threadId, 0);
    for (var i = 0; i < out.threads.length; i += 1) {
      var t = out.threads[i];
      if (t.id !== id) continue;
      if (detail.title && !t.title) t.title = detail.title;
      if (detail.forumId) t.forumId = detail.forumId;
      if (detail.lastPostAt) t.lastPostAt = Math.max(t.lastPostAt, detail.lastPostAt);
      if (detail.lastPosterId) t.lastPosterId = detail.lastPosterId;
      t.isLocked = detail.isLocked === true;
      if (detail.totalKnown) observeMineTotal(t, detail.postsTotal, toInt(now, 0));
      advanceMineBaseline(t, out.selfId);
    }
    return out;
  }

  function freshPostCache() { return { v: SCHEMA_VERSION, threads: {}, order: [] }; }

  function normalisePostCache(raw) {
    if (!isPlainObject(raw)) return freshPostCache();
    if (toInt(raw.v, 0) > SCHEMA_VERSION) return freshPostCache();
    var out = freshPostCache();
    if (!isPlainObject(raw.threads)) return out;
    var order = Array.isArray(raw.order) ? raw.order.filter(function (id) { return /^[0-9]{1,12}$/.test(id); }) : [];
    var ids = Object.keys(raw.threads).filter(function (id) { return /^[0-9]{1,12}$/.test(id); });
    for (var i = 0; i < ids.length; i += 1) {
      var t = raw.threads[ids[i]];
      if (!isPlainObject(t) || !Array.isArray(t.posts)) continue;
      var posts = [];
      for (var j = 0; j < t.posts.length && posts.length < POST_CACHE_MAX_POSTS; j += 1) {
        var p = t.posts[j];
        if (!isPlainObject(p)) continue;
        var pid = toInt(p.id, 0);
        if (pid <= 0) continue;
        posts.push({
          id: pid,
          authorId: Math.max(0, toInt(p.authorId, 0)),
          authorName: safeString(p.authorName, 60),
          at: Math.max(0, toInt(p.at, 0)),
          text: safeString(p.text, 8000),
        });
      }
      if (!posts.length) continue;
      out.threads[ids[i]] = {
        fetchedAt: Math.max(0, toInt(t.fetchedAt, 0)),
        pages: Math.max(0, toInt(t.pages, 0)),
        complete: t.complete === true,
        posts: posts,
      };
      if (order.indexOf(ids[i]) === -1) order.push(ids[i]);
    }
    out.order = order.filter(function (id) {
      return Object.prototype.hasOwnProperty.call(out.threads, id);
    });
    return postCacheEvict(out);
  }

  // -- api helpers (pure parts) -------------------------------------------

  function isKeyShaped(v) {
    return typeof v === 'string' && /^[A-Za-z0-9]{16}$/.test(v);
  }

  // The PDA slot only counts as a real key once PDA has replaced it AND the
  // replacement looks like a key. An unreplaced slot is not a credential and
  // must never be sent anywhere.
  function pdaInjectedKey(slotValue) {
    if (typeof slotValue !== 'string') return null;
    if (slotValue === PDA_KEY_SENTINEL) return null;
    return isKeyShaped(slotValue) ? slotValue : null;
  }

  // Anything that can reach a log, an error detail or a debug report goes
  // through here first. The key rides in the query string, so the whole query
  // string is what gets removed - not just the parameter we happen to remember.
  function redactUrl(url) {
    var s = String(url === undefined || url === null ? '' : url);
    var q = s.indexOf('?');
    if (q !== -1) s = s.slice(0, q) + '?[redacted]';
    return s;
  }

  // Every string that can reach a message, a log or a debug report goes through
  // here. redactUrl alone is not enough: a browser's own network error text
  // often quotes the whole request URL, so the key arrives inside a message
  // this script never built. Scrubbing the text is what catches that.
  function scrubDetail(text) {
    var s = safeString(text, 300);
    s = s.replace(/https?:\/\/[^\s"']+/gi, function (m) { return redactUrl(m); });
    s = s.replace(/key=[A-Za-z0-9]+/gi, 'key=[redacted]');
    return s;
  }

  function mapTornError(code, fallbackText) {
    var c = toInt(code, -1);
    if (Object.prototype.hasOwnProperty.call(TORN_ERRORS, c)) {
      return { code: c, message: TORN_ERRORS[c] };
    }
    return { code: c, message: safeString(fallbackText, 200) || 'Torn rejected the request.' };
  }

  function buildApiUrl(base, path, params) {
    var qs = [];
    var keys = params ? Object.keys(params) : [];
    for (var i = 0; i < keys.length; i += 1) {
      var v = params[keys[i]];
      if (v === undefined || v === null || v === '') continue;
      qs.push(encodeURIComponent(keys[i]) + '=' + encodeURIComponent(String(v)));
    }
    var joiner = path.charAt(0) === '/' ? '' : '/';
    return base + joiner + path + (qs.length ? '?' + qs.join('&') : '');
  }

  // The limiter holds state but reads no clock: every entry point takes `now`.
  // reserve() books a slot immediately and returns how long to wait for it, so
  // two concurrent callers serialise instead of both deciding they may go now.
  function makeRateLimiter(opts) {
    var o = opts || {};
    var gap = o.minGapMs === undefined ? MIN_REQUEST_GAP_MS : o.minGapMs;
    var cap = o.perWindow === undefined ? REQUESTS_PER_WINDOW : o.perWindow;
    var win = o.windowMs === undefined ? RATE_WINDOW_MS : o.windowMs;
    var stamps = [];
    var nextFreeAt = 0;

    return {
      reserve: function (now) {
        var t = toInt(now, 0);
        stamps = stamps.filter(function (s) { return s > t - win; });
        if (stamps.length >= cap) {
          return {
            ok: false,
            reason: 'throttled',
            retryAfterMs: Math.max(0, (stamps[0] + win) - t),
          };
        }
        var at = Math.max(t, nextFreeAt);
        nextFreeAt = at + gap;
        stamps.push(at);
        return { ok: true, waitMs: at - t, at: at };
      },
      used: function (now) {
        var t = toInt(now, 0);
        return stamps.filter(function (s) { return s > t - win; }).length;
      },
      reset: function () { stamps = []; nextFreeAt = 0; },
    };
  }

  // -- merge, unread, sort -------------------------------------------------

  function unreadFor(apiRow, entry) {
    var tornUnread = apiRow ? Math.max(0, toInt(apiRow.postsNew, 0)) : 0;
    var total = apiRow ? Math.max(0, toInt(apiRow.postsTotal, 0)) : (entry ? entry.postsTotal : 0);
    var seen = entry ? Math.max(0, toInt(entry.lastSeenTotal, 0)) : 0;
    var dismissed = total > 0 && seen >= total;
    return {
      tornUnread: tornUnread,
      postsTotal: total,
      lastSeenTotal: seen,
      dismissed: dismissed,
      unread: dismissed ? 0 : tornUnread,
    };
  }

  // A subscribed thread keeps Torn's own count, exactly as in Threads. Only a
  // thread Torn gives no count for is counted here, and an unknown total is
  // reported as unchecked so it can never pass for a thread checked and quiet.
  // Every total compared here counts the topic post: rec.postsTotal and
  // rec.baselineTotal are posts + 1 (threadPostsTotal), the same unit as the
  // subscribed posts.total that lastSeenTotal is written from. Live findings
  // 3 and 4, docs/reference/torn-api-live-findings-2026-10-08.md.
  function mineUnreadFor(apiRow, entry, rec) {
    var u;
    if (apiRow) {
      u = unreadFor(apiRow, entry);
      u.unreadSource = 'torn';
      return u;
    }
    // A started thread's new_posts is Torn's own unread count, like posts.new.
    if (rec && rec.totalKnown && rec.tornNewKnown) {
      u = unreadFor({ postsNew: rec.tornNew, postsTotal: rec.postsTotal }, entry);
      u.unreadSource = 'torn';
      return u;
    }
    var seen = entry ? Math.max(0, toInt(entry.lastSeenTotal, 0)) : 0;
    if (!rec || !rec.totalKnown) {
      return { tornUnread: 0, postsTotal: 0, lastSeenTotal: seen, dismissed: false, unread: 0, unreadSource: 'unchecked' };
    }
    var unread = Math.max(0, rec.postsTotal - Math.max(seen, rec.baselineTotal));
    return {
      tornUnread: 0,
      postsTotal: rec.postsTotal,
      lastSeenTotal: seen,
      dismissed: rec.postsTotal > 0 && seen >= rec.postsTotal,
      unread: unread,
      unreadSource: 'local',
    };
  }

  // What pulls a My posts thread into Threads. A read marker and a visit
  // deliberately do not, or marking your own thread read would file it.
  function isOrganised(entry, hasDraft) {
    if (hasDraft) return true;
    if (!entry) return false;
    return !!(entry.folderId || entry.tags.length || entry.pinned || entry.priority !== 0
      || entry.note || entry.archived);
  }

  // Takes the newest of every candidate rather than the first available one:
  // a fresh enrichment can still be older than an activity row that arrived
  // since. `source` reports which candidate won, so a surprising sort order is
  // diagnosable from the row itself instead of by guesswork.
  // extra is optional: { mineAt, ownPostAt } from a My posts record.
  function resolveLastActivity(entry, feedAt, now, maxAgeMs, extra) {
    var ttl = maxAgeMs === undefined ? ENRICH_TTL_MS : maxAgeMs;
    var t = toInt(now, 0);
    var candidates = [];

    if (entry && entry.lastPostTimeCached > 0) {
      var fresh = entry.enrichedAt > 0 && (t - entry.enrichedAt) <= ttl;
      candidates.push({ at: entry.lastPostTimeCached, source: fresh ? 'enriched' : 'enriched-stale' });
    }
    if (feedAt > 0) candidates.push({ at: feedAt, source: 'feed' });
    var x = extra || {};
    if (x.mineAt > 0) candidates.push({ at: x.mineAt, source: 'mine' });
    if (x.ownPostAt > 0) candidates.push({ at: x.ownPostAt, source: 'own-post' });
    if (entry && entry.lastVisitedAt > 0) candidates.push({ at: entry.lastVisitedAt, source: 'visit' });

    if (!candidates.length) return { at: null, source: 'none' };

    candidates.sort(function (a, b) {
      if (b.at !== a.at) return b.at - a.at;
      return ACTIVITY_SOURCES.indexOf(a.source) - ACTIVITY_SOURCES.indexOf(b.source);
    });
    return candidates[0];
  }

  function categoryIndex(categories) {
    var idx = {};
    for (var i = 0; i < (categories || []).length; i += 1) {
      var c = categories[i];
      if (c && c.id) idx[String(c.id)] = c;
    }
    return idx;
  }

  function feedIndex(activity) {
    var idx = {};
    for (var i = 0; i < (activity || []).length; i += 1) {
      var a = activity[i];
      if (!a || !a.threadId) continue;
      var k = String(a.threadId);
      if (!idx[k] || a.at > idx[k].at) idx[k] = a;
    }
    return idx;
  }

  function mergeThreads(input) {
    var subscribed = (input && input.subscribed) || [];
    var activity = (input && input.activity) || [];
    var categories = (input && input.categories) || [];
    var organizer = (input && input.organizer) || freshOrganizer(0);
    var drafts = (input && input.drafts) || freshDrafts();
    var now = toInt(input && input.now, 0);
    var ttl = input && input.enrichTtlMs !== undefined ? input.enrichTtlMs : ENRICH_TTL_MS;
    var mine = (input && input.mine) || freshMine();
    var mineById = {};
    for (var mi = 0; mi < mine.threads.length; mi += 1) mineById[String(mine.threads[mi].id)] = mine.threads[mi];

    var cats = categoryIndex(categories);
    var feeds = feedIndex(activity);
    var folderById = {};
    for (var fi = 0; fi < organizer.folders.length; fi += 1) {
      folderById[organizer.folders[fi].id] = organizer.folders[fi];
    }

    var byId = {};
    var order = [];

    function ensure(id) {
      var k = String(id);
      if (!Object.prototype.hasOwnProperty.call(byId, k)) {
        byId[k] = { id: k, numericId: Number(k) };
        order.push(k);
      }
      return byId[k];
    }

    var i;
    for (i = 0; i < subscribed.length; i += 1) {
      var s = subscribed[i];
      var rowS = ensure(s.id);
      rowS.api = s;
    }
    // A thread the user unsubscribed from keeps everything they wrote about it.
    // Dropping the row here would silently delete notes, tags and drafts.
    var known = Object.keys(organizer.threads);
    for (i = 0; i < known.length; i += 1) ensure(known[i]);
    var draftIds = Object.keys(drafts.byThread || {});
    for (i = 0; i < draftIds.length; i += 1) ensure(draftIds[i]);
    for (i = 0; i < mine.threads.length; i += 1) ensure(mine.threads[i].id);

    var rows = [];
    for (i = 0; i < order.length; i += 1) {
      var id = order[i];
      var api = byId[id].api || null;
      var entry = Object.prototype.hasOwnProperty.call(organizer.threads, id)
        ? organizer.threads[id]
        : normaliseThreadEntry(null);

      // Archived rows are still built here. Hiding them is a view decision, and
      // buildPanelModel makes it, so an archived thread with new posts can still
      // surface rather than being lost at the merge.
      var rec = Object.prototype.hasOwnProperty.call(mineById, id) ? mineById[id] : null;
      var u = rec ? mineUnreadFor(api, entry, rec) : unreadFor(api, entry);
      var unreadSource = rec ? u.unreadSource : (api ? 'torn' : 'none');
      var feedRow = Object.prototype.hasOwnProperty.call(feeds, id) ? feeds[id] : null;
      var act = resolveLastActivity(entry, feedRow ? feedRow.at : 0, now, ttl,
        rec ? { mineAt: rec.lastPostAt, ownPostAt: rec.myLastPostAt } : null);
      var forumId = (api && api.forumId) || entry.forumId || (rec && rec.forumId) || 0;
      var cat = Object.prototype.hasOwnProperty.call(cats, String(forumId)) ? cats[String(forumId)] : null;
      var folder = entry.folderId && Object.prototype.hasOwnProperty.call(folderById, entry.folderId)
        ? folderById[entry.folderId]
        : null;
      var draft = Object.prototype.hasOwnProperty.call(drafts.byThread || {}, id) ? drafts.byThread[id] : null;

      rows.push({
        id: id,
        numericId: Number(id),
        title: (api && api.title) || entry.title || (draft && draft.title) || (rec && rec.title) || ('Thread ' + id),
        forumId: forumId,
        forumName: cat ? cat.title : (forumId ? ('Forum ' + forumId) : 'Unknown forum'),
        authorId: (api && api.authorId) || entry.authorId || 0,
        authorName: (api && api.authorName) || entry.authorName || '',
        subscribed: !!api,
        postsTotal: u.postsTotal,
        tornUnread: u.tornUnread,
        unread: u.unread,
        dismissed: u.dismissed,
        pinned: entry.pinned,
        archived: entry.archived,
        priority: entry.priority,
        folderId: folder ? folder.id : null,
        folderName: folder ? folder.name : null,
        tags: entry.tags.slice(),
        note: entry.note,
        lastActivity: act.at,
        activitySource: act.source,
        lastVisitedAt: entry.lastVisitedAt,
        firstSeenAt: entry.firstSeenAt || (rec ? rec.firstSeenAt : 0),
        isLocked: entry.isLocked || !!(rec && rec.isLocked),
        isSticky: entry.isSticky,
        hasDraft: !!draft,
        draftUpdatedAt: draft ? draft.updatedAt : 0,
        needsEnrich: act.source !== 'enriched',
        mineRole: rec ? (rec.started ? 'started' : 'posted') : null,
        inThreads: !!api || !rec || isOrganised(entry, !!draft),
        unreadSource: unreadSource,
      });
    }

    return rows;
  }

  function compareStable(a, b) {
    var t = a.title.toLowerCase().localeCompare(b.title.toLowerCase());
    if (t !== 0) return t;
    return a.numericId - b.numericId;
  }

  // An unknown last activity is never treated as zero: a thread whose time we
  // could not resolve sorts to the bottom of the activity list rather than
  // claiming to be the oldest thing the user follows.
  function sortThreads(rows, mode) {
    var m = SORT_MODES.indexOf(mode) === -1 ? 'activity' : mode;
    var out = rows.slice();
    out.sort(function (a, b) {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      var d = 0;
      if (m === 'activity') {
        if (a.lastActivity === null && b.lastActivity === null) d = 0;
        else if (a.lastActivity === null) d = 1;
        else if (b.lastActivity === null) d = -1;
        else d = b.lastActivity - a.lastActivity;
      } else if (m === 'unread') {
        d = b.unread - a.unread;
        if (d === 0) {
          if (a.lastActivity === null && b.lastActivity === null) d = 0;
          else if (a.lastActivity === null) d = 1;
          else if (b.lastActivity === null) d = -1;
          else d = b.lastActivity - a.lastActivity;
        }
      } else if (m === 'priority') {
        d = b.priority - a.priority;
      } else if (m === 'title') {
        d = 0;
      } else if (m === 'author') {
        d = a.authorName.toLowerCase().localeCompare(b.authorName.toLowerCase());
      } else if (m === 'forum') {
        d = a.forumName.toLowerCase().localeCompare(b.forumName.toLowerCase());
      } else if (m === 'added') {
        d = b.firstSeenAt - a.firstSeenAt;
      }
      if (d !== 0) return d;
      return compareStable(a, b);
    });
    return out;
  }

  function catchUpList(rows, lastCatchUpAt) {
    var since = Math.max(0, toInt(lastCatchUpAt, 0));
    return rows.filter(function (r) {
      if (r.dismissed) return false;
      if (r.unread > 0) return true;
      return r.lastActivity !== null && r.lastActivity > since;
    });
  }

  // -- query parsing and search --------------------------------------------

  var QUERY_PREFIXES = Object.freeze(['by', 'tag', 'folder', 'is']);

  // Torn's own forum search understands "by:player words" but never exposes it
  // in the UI, which players have repeatedly asked for. The same grammar is
  // used here so one syntax covers both the local index and the launcher that
  // hands a query to Torn.
  function parseQuery(raw) {
    var s = typeof raw === 'string' ? raw : '';
    var terms = [];
    var re = /(-)?(?:([a-z]+):)?(?:"([^"]*)"|(\S+))/gi;
    var m = re.exec(s);
    while (m) {
      var negated = m[1] === '-';
      var prefix = m[2] ? m[2].toLowerCase() : null;
      var quoted = m[3] !== undefined;
      var value = (quoted ? m[3] : m[4]) || '';
      if (value) {
        if (prefix && QUERY_PREFIXES.indexOf(prefix) !== -1) {
          terms.push({ type: prefix, value: value.toLowerCase(), negated: negated });
        } else if (prefix) {
          // An unknown prefix is text, not a silently dropped filter.
          terms.push({ type: quoted ? 'phrase' : 'text', value: (prefix + ':' + value).toLowerCase(), negated: negated });
        } else {
          terms.push({ type: quoted ? 'phrase' : 'text', value: value.toLowerCase(), negated: negated });
        }
      }
      m = re.exec(s);
    }
    return { raw: s, terms: terms, isEmpty: terms.length === 0 };
  }

  function termMatchesThread(term, row) {
    var v = term.value;
    if (term.type === 'by') {
      return (row.authorName || '').toLowerCase().indexOf(v) !== -1;
    }
    if (term.type === 'tag') {
      return row.tags.some(function (t) { return t.indexOf(v) !== -1; });
    }
    if (term.type === 'folder') {
      return !!row.folderName && row.folderName.toLowerCase().indexOf(v) !== -1;
    }
    if (term.type === 'is') {
      if (v === 'unread') return row.unread > 0;
      if (v === 'pinned') return row.pinned;
      if (v === 'draft') return row.hasDraft;
      if (v === 'subscribed') return row.subscribed;
      if (v === 'archived') return row.archived;
      if (v === 'visited') return row.lastVisitedAt > 0;
      return false;
    }
    var hay = [row.title, row.authorName, row.forumName, row.note, row.tags.join(' ')]
      .join(' ')
      .toLowerCase();
    return hay.indexOf(v) !== -1;
  }

  function matchThread(row, query) {
    if (!query || query.isEmpty) return true;
    for (var i = 0; i < query.terms.length; i += 1) {
      var t = query.terms[i];
      var hit = termMatchesThread(t, row);
      if (t.negated ? hit : !hit) return false;
    }
    return true;
  }

  function matchPost(post, row, query) {
    if (!query || query.isEmpty) return false;
    var textTerms = 0;
    for (var i = 0; i < query.terms.length; i += 1) {
      var t = query.terms[i];
      var hit;
      if (t.type === 'by') {
        hit = (post.authorName || '').toLowerCase().indexOf(t.value) !== -1;
      } else if (t.type === 'text' || t.type === 'phrase') {
        textTerms += 1;
        hit = (post.text || '').toLowerCase().indexOf(t.value) !== -1;
      } else {
        hit = row ? termMatchesThread(t, row) : false;
      }
      if (t.negated ? hit : !hit) return false;
    }
    // A query with only filters and no text would otherwise return every post
    // in the cache, which is not what "search inside posts" means.
    return textTerms > 0 || query.terms.some(function (t) { return t.type === 'by' && !t.negated; });
  }

  function searchMetadata(rows, query) {
    return rows.filter(function (r) { return matchThread(r, query); });
  }

  function searchPosts(cache, rows, query, limit) {
    var out = [];
    var cap = limit === undefined ? 200 : limit;
    var rowById = {};
    for (var i = 0; i < rows.length; i += 1) rowById[rows[i].id] = rows[i];
    var ids = Object.keys((cache && cache.threads) || {});
    for (var j = 0; j < ids.length && out.length < cap; j += 1) {
      var t = cache.threads[ids[j]];
      var row = Object.prototype.hasOwnProperty.call(rowById, ids[j]) ? rowById[ids[j]] : null;
      for (var k = 0; k < t.posts.length && out.length < cap; k += 1) {
        var p = t.posts[k];
        if (matchPost(p, row, query)) {
          out.push({
            threadId: ids[j],
            threadTitle: row ? row.title : ('Thread ' + ids[j]),
            postId: p.id,
            authorName: p.authorName,
            at: p.at,
            text: p.text,
          });
        }
      }
    }
    out.sort(function (a, b) { return b.at - a.at; });
    return out;
  }

  // One click, one navigation. This builds the URL Torn itself understands and
  // hands it to the user; the script never fetches it.
  function buildNativeSearchUrl(query, forumId) {
    var q = typeof query === 'string' ? query.trim() : '';
    var base = 'https://www.torn.com/forums.php#/p=search&q=' + encodeURIComponent(q);
    var f = toInt(forumId, 0);
    if (f > 0) base += '&f=' + f;
    return base;
  }

  // -- custom key link ------------------------------------------------------

  // Exactly the selections this script requests, and no others: the least
  // privilege a Custom key can carry. tests/custom-key.test.js scans every
  // API call site and fails if a requested selection is missing here, or if
  // this lists one that is never requested. When #2 (user forumthreads,
  // forumposts) and #10 (user profile) merge, they add theirs here.
  var CUSTOM_KEY_SELECTIONS = Object.freeze({
    user: Object.freeze(['forumsubscribedthreads', 'forumfeed']),
    forum: Object.freeze(['categories', 'thread', 'posts']),
  });

  var CUSTOM_KEY_TITLE = 'Forum Command Center';

  // UNVERIFIED. Torn's api.html builds its custom key link in api.js, which
  // the saved docs/reference copy does not include; the page says only that
  // the link "will open your settings page in a new tab". This is the format
  // other Torn tools use. Release is gated on docs/qa-checklist.md comparing it
  // with a link generated on torn.com/api.html. If Torn's differs, change it
  // here and nowhere else.
  var CUSTOM_KEY_LINK_BASE = 'https://www.torn.com/preferences.php#tab=api?step=addNewKey';

  // A pure function of constants. The user clicks the result and confirms the
  // key on Torn's page; the script never requests it, and no key is ever part
  // of it.
  function buildCustomKeyUrl() {
    var url = CUSTOM_KEY_LINK_BASE + '&title=' + encodeURIComponent(CUSTOM_KEY_TITLE);
    var sections = Object.keys(CUSTOM_KEY_SELECTIONS);
    for (var i = 0; i < sections.length; i += 1) {
      url += '&' + sections[i] + '=' + CUSTOM_KEY_SELECTIONS[sections[i]].join(',');
    }
    return url;
  }

  // -- post cache ----------------------------------------------------------

  function postCacheSize(cache) {
    var posts = 0;
    var ids = Object.keys((cache && cache.threads) || {});
    for (var i = 0; i < ids.length; i += 1) posts += cache.threads[ids[i]].posts.length;
    var bytes = 0;
    try { bytes = JSON.stringify(cache || {}).length; } catch (e) { bytes = 0; }
    return { threads: ids.length, posts: posts, bytes: bytes };
  }

  // Evicts whole threads, oldest-used first, until both ceilings hold. A
  // half-evicted thread would make a later deep search silently incomplete
  // while looking cached, so threads are the unit.
  function postCacheEvict(cache) {
    var out = {
      v: SCHEMA_VERSION,
      threads: {},
      order: [],
    };
    var ids = (cache && cache.order ? cache.order.slice() : []).filter(function (id) {
      return cache.threads && Object.prototype.hasOwnProperty.call(cache.threads, id);
    });
    var extra = Object.keys((cache && cache.threads) || {}).filter(function (id) {
      return ids.indexOf(id) === -1;
    });
    ids = ids.concat(extra);

    // order is oldest-first; keep from the newest end.
    for (var i = ids.length - 1; i >= 0; i -= 1) {
      var id = ids[i];
      var candidate = cache.threads[id];
      var trialPosts = 0;
      var keys = Object.keys(out.threads);
      for (var k = 0; k < keys.length; k += 1) trialPosts += out.threads[keys[k]].posts.length;
      if (trialPosts + candidate.posts.length > POST_CACHE_MAX_POSTS && keys.length > 0) continue;
      out.threads[id] = candidate;
      out.order.unshift(id);
      var size = postCacheSize(out);
      if (size.bytes > POST_CACHE_MAX_BYTES && out.order.length > 1) {
        delete out.threads[id];
        out.order.shift();
      }
    }
    return out;
  }

  function postCacheAdd(cache, threadId, posts, meta) {
    var id = String(toInt(threadId, 0));
    var base = normalisePostCache(cache);
    if (id === '0') return base;
    var clean = [];
    var seen = {};
    for (var i = 0; i < (posts || []).length; i += 1) {
      var p = posts[i];
      if (!isPlainObject(p)) continue;
      var pid = toInt(p.id, 0);
      if (pid <= 0 || Object.prototype.hasOwnProperty.call(seen, pid)) continue;
      seen[pid] = true;
      var author = isPlainObject(p.author) ? p.author : {};
      clean.push({
        id: pid,
        authorId: Math.max(0, toInt(author.id === undefined ? p.authorId : author.id, 0)),
        authorName: safeString(author.username === undefined ? p.authorName : author.username, 60),
        at: p.at === undefined ? secondsToMs(p.created_time) : Math.max(0, toInt(p.at, 0)),
        text: safeString(p.text === undefined ? stripHtml(p.content) : p.text, 8000),
      });
    }
    if (!clean.length) return base;

    var next = {
      v: SCHEMA_VERSION,
      threads: Object.assign({}, base.threads),
      order: base.order.filter(function (x) { return x !== id; }),
    };
    next.threads[id] = {
      fetchedAt: Math.max(0, toInt(meta && meta.fetchedAt, 0)),
      pages: Math.max(0, toInt(meta && meta.pages, 0)),
      complete: !!(meta && meta.complete),
      posts: clean.slice(0, POST_CACHE_MAX_POSTS),
    };
    next.order.push(id);
    return postCacheEvict(next);
  }

  function postCachePostsFor(cache, threadId) {
    var id = String(threadId);
    var t = cache && cache.threads && Object.prototype.hasOwnProperty.call(cache.threads, id)
      ? cache.threads[id]
      : null;
    return t ? t.posts.slice() : [];
  }

  // -- organizer operations (all return a new organizer) --------------------

  function cloneOrganizer(org) {
    return {
      v: SCHEMA_VERSION,
      folders: org.folders.map(function (f) {
        return { id: f.id, name: f.name, order: f.order, forumIds: f.forumIds.slice() };
      }),
      threads: Object.keys(org.threads).reduce(function (acc, id) {
        var e = org.threads[id];
        acc[id] = Object.assign({}, e, { tags: e.tags.slice() });
        return acc;
      }, {}),
      lastCatchUpAt: org.lastCatchUpAt,
    };
  }

  function entryOf(org, threadId) {
    var id = String(threadId);
    if (!Object.prototype.hasOwnProperty.call(org.threads, id)) {
      org.threads[id] = normaliseThreadEntry(null);
    }
    return org.threads[id];
  }

  function folderFor(org, forumId) {
    var f = toInt(forumId, 0);
    if (f <= 0) return null;
    for (var i = 0; i < org.folders.length; i += 1) {
      if (org.folders[i].forumIds.indexOf(f) !== -1) return org.folders[i];
    }
    return null;
  }

  // Only fills an empty slot. A thread the user filed by hand is never moved by
  // a rule, because the rule is a default and the hand placement is a decision.
  function applyAutoAssign(org, subscribedRows, now) {
    var next = cloneOrganizer(org);
    for (var i = 0; i < (subscribedRows || []).length; i += 1) {
      var s = subscribedRows[i];
      var e = entryOf(next, s.id);
      if (!e.firstSeenAt) e.firstSeenAt = toInt(now, 0);
      if (!e.title) e.title = s.title;
      if (!e.forumId) e.forumId = s.forumId;
      if (!e.authorName) e.authorName = s.authorName;
      if (!e.authorId) e.authorId = s.authorId;
      e.postsTotal = s.postsTotal;
      if (!e.folderId) {
        var f = folderFor(next, s.forumId);
        if (f) e.folderId = f.id;
      }
    }
    return next;
  }

  function toggleTag(org, threadId, tag) {
    var clean = safeString(tag, 48).trim().toLowerCase();
    if (!clean) return org;
    var next = cloneOrganizer(org);
    var e = entryOf(next, threadId);
    var i = e.tags.indexOf(clean);
    if (i === -1) {
      if (e.tags.length >= 24) return org;
      e.tags.push(clean);
    } else {
      e.tags.splice(i, 1);
    }
    return next;
  }

  function setPriority(org, threadId, value) {
    var next = cloneOrganizer(org);
    entryOf(next, threadId).priority = clamp(toInt(value, 0), PRIORITY_MIN, PRIORITY_MAX);
    return next;
  }

  function setFolder(org, threadId, folderId) {
    var next = cloneOrganizer(org);
    var e = entryOf(next, threadId);
    if (!folderId) { e.folderId = null; return next; }
    var exists = next.folders.some(function (f) { return f.id === folderId; });
    e.folderId = exists ? folderId : null;
    return next;
  }

  function togglePin(org, threadId) {
    var next = cloneOrganizer(org);
    var e = entryOf(next, threadId);
    e.pinned = !e.pinned;
    return next;
  }

  function markRead(org, threadId, postsTotal, now) {
    var next = cloneOrganizer(org);
    var e = entryOf(next, threadId);
    e.lastSeenTotal = Math.max(e.lastSeenTotal, Math.max(0, toInt(postsTotal, 0)));
    if (toInt(now, 0) > 0) e.lastVisitedAt = Math.max(e.lastVisitedAt, toInt(now, 0));
    return next;
  }

  function upsertFolder(org, folder) {
    var f = normaliseFolder(folder, org.folders.length);
    if (!f) return org;
    var next = cloneOrganizer(org);
    var i = next.folders.findIndex(function (x) { return x.id === f.id; });
    if (i === -1) next.folders.push(f);
    else next.folders[i] = f;
    next.folders.sort(function (a, b) { return a.order - b.order; });
    return next;
  }

  // Deleting a folder un-files its threads. It never deletes them, because the
  // notes, tags and drafts hanging off a thread are the user's work and the
  // folder was only a label.
  function deleteFolder(org, folderId) {
    var next = cloneOrganizer(org);
    next.folders = next.folders.filter(function (f) { return f.id !== folderId; });
    var ids = Object.keys(next.threads);
    for (var i = 0; i < ids.length; i += 1) {
      if (next.threads[ids[i]].folderId === folderId) next.threads[ids[i]].folderId = null;
    }
    return next;
  }

  function allTags(org) {
    var counts = {};
    var ids = Object.keys(org.threads);
    for (var i = 0; i < ids.length; i += 1) {
      var tags = org.threads[ids[i]].tags;
      for (var j = 0; j < tags.length; j += 1) {
        counts[tags[j]] = (counts[tags[j]] || 0) + 1;
      }
    }
    return Object.keys(counts).sort().map(function (t) { return { tag: t, count: counts[t] }; });
  }

  // -- drafts --------------------------------------------------------------

  function saveDraft(drafts, threadId, text, now, title) {
    var id = String(toInt(threadId, 0));
    if (id === '0') return drafts;
    var next = { v: SCHEMA_VERSION, byThread: Object.assign({}, drafts.byThread) };
    var clean = safeString(text, DRAFT_MAX_CHARS);
    if (!clean.trim()) {
      delete next.byThread[id];
      return next;
    }
    next.byThread[id] = {
      text: clean,
      updatedAt: Math.max(0, toInt(now, 0)),
      title: safeString(title, 300) || (next.byThread[id] ? next.byThread[id].title : ''),
    };
    return next;
  }

  function draftFor(drafts, threadId) {
    var id = String(threadId);
    return drafts && drafts.byThread && Object.prototype.hasOwnProperty.call(drafts.byThread, id)
      ? drafts.byThread[id]
      : null;
  }

  function deleteDraft(drafts, threadId) {
    var next = { v: SCHEMA_VERSION, byThread: Object.assign({}, drafts.byThread) };
    delete next.byThread[String(threadId)];
    return next;
  }

  function draftList(drafts) {
    var ids = Object.keys((drafts && drafts.byThread) || {});
    return ids.map(function (id) {
      return {
        threadId: id,
        text: drafts.byThread[id].text,
        updatedAt: drafts.byThread[id].updatedAt,
        title: drafts.byThread[id].title,
      };
    }).sort(function (a, b) { return b.updatedAt - a.updatedAt; });
  }

  // -- export and import ----------------------------------------------------

  // btoa cannot hold anything above U+00FF, and forum titles are full of things
  // that are. Percent-encoding first keeps the payload inside Latin-1 without
  // pulling in a base64 implementation of our own.
  function b64EncodeUtf8(str, btoaFn) {
    var latin = encodeURIComponent(str).replace(/%([0-9A-F]{2})/gi, function (_, hex) {
      return String.fromCharCode(parseInt(hex, 16));
    });
    return btoaFn(latin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  function b64DecodeUtf8(b64, atobFn) {
    var padded = b64.replace(/-/g, '+').replace(/_/g, '/');
    while (padded.length % 4 !== 0) padded += '=';
    var binary = atobFn(padded);
    var pct = '';
    for (var i = 0; i < binary.length; i += 1) {
      pct += '%' + ('00' + binary.charCodeAt(i).toString(16)).slice(-2);
    }
    return decodeURIComponent(pct);
  }

  function encodeState(organizer, drafts, btoaFn) {
    var payload = {
      v: SCHEMA_VERSION,
      folders: organizer.folders.map(function (f) {
        return { id: f.id, name: f.name, order: f.order, forumIds: f.forumIds.slice() };
      }),
      threads: {},
      drafts: {},
    };
    var ids = Object.keys(organizer.threads);
    for (var i = 0; i < ids.length; i += 1) {
      var e = organizer.threads[ids[i]];
      var meaningful = e.folderId || e.tags.length || e.pinned || e.priority !== 0
        || e.note || e.lastSeenTotal || e.archived;
      if (!meaningful) continue;
      payload.threads[ids[i]] = {
        folderId: e.folderId, tags: e.tags.slice(), pinned: e.pinned, priority: e.priority,
        note: e.note, lastSeenTotal: e.lastSeenTotal, archived: e.archived,
        title: e.title, forumId: e.forumId, authorName: e.authorName,
      };
    }
    var dids = Object.keys((drafts && drafts.byThread) || {});
    for (var j = 0; j < dids.length; j += 1) {
      payload.drafts[dids[j]] = {
        text: drafts.byThread[dids[j]].text,
        updatedAt: drafts.byThread[dids[j]].updatedAt,
        title: drafts.byThread[dids[j]].title,
      };
    }
    return EXPORT_PREFIX + b64EncodeUtf8(JSON.stringify(payload), btoaFn);
  }

  function decodeState(text, atobFn) {
    var s = typeof text === 'string' ? text.trim() : '';
    if (!s) return { ok: false, reason: 'empty', detail: 'Nothing to import.' };
    if (s.indexOf(EXPORT_PREFIX) !== 0) {
      return { ok: false, reason: 'prefix', detail: 'That is not a Torn Forum Command Center export.' };
    }
    var body = s.slice(EXPORT_PREFIX.length);
    if (body.length > 400000) {
      return { ok: false, reason: 'oversize', detail: 'That export is too large to be genuine.' };
    }
    var json;
    try {
      json = b64DecodeUtf8(body, atobFn);
    } catch (e) {
      return { ok: false, reason: 'decode', detail: 'That export is damaged and cannot be decoded.' };
    }
    var payload;
    try {
      payload = JSON.parse(json);
    } catch (e2) {
      return { ok: false, reason: 'parse', detail: 'That export is damaged and cannot be read.' };
    }
    if (!isPlainObject(payload)) {
      return { ok: false, reason: 'shape', detail: 'That export does not contain a settings object.' };
    }
    if (toInt(payload.v, 0) !== SCHEMA_VERSION) {
      return { ok: false, reason: 'version', detail: 'That export was made by a different version of the script.' };
    }
    return { ok: true, payload: payload };
  }

  // Import is additive and reports its effect before it is applied. Nothing is
  // written on a rejection, so a partially valid export cannot half-land.
  function importState(organizer, drafts, text, atobFn) {
    var decoded = decodeState(text, atobFn);
    if (!decoded.ok) return decoded;
    var payload = decoded.payload;

    var org = cloneOrganizer(organizer);
    var addedFolders = 0;
    var changedThreads = 0;
    var addedDrafts = 0;

    if (Array.isArray(payload.folders)) {
      for (var i = 0; i < payload.folders.length && i < 40; i += 1) {
        var f = normaliseFolder(payload.folders[i], org.folders.length);
        if (!f) continue;
        if (!org.folders.some(function (x) { return x.id === f.id; })) {
          org.folders.push(f);
          addedFolders += 1;
        }
      }
      org.folders.sort(function (a, b) { return a.order - b.order; });
    }

    var known = {};
    org.folders.forEach(function (x) { known[x.id] = true; });

    if (isPlainObject(payload.threads)) {
      var ids = Object.keys(payload.threads);
      for (var j = 0; j < ids.length && j < 5000; j += 1) {
        if (!/^[0-9]{1,12}$/.test(ids[j])) continue;
        var incoming = normaliseThreadEntry(payload.threads[ids[j]]);
        if (incoming.folderId && !Object.prototype.hasOwnProperty.call(known, incoming.folderId)) {
          incoming.folderId = null;
        }
        var existing = entryOf(org, ids[j]);
        existing.folderId = incoming.folderId || existing.folderId;
        existing.tags = uniqueStrings(existing.tags.concat(incoming.tags)).slice(0, 24);
        existing.pinned = existing.pinned || incoming.pinned;
        existing.archived = existing.archived || incoming.archived;
        if (incoming.priority !== 0) existing.priority = incoming.priority;
        if (incoming.note) existing.note = incoming.note;
        if (incoming.title && !existing.title) existing.title = incoming.title;
        if (incoming.forumId && !existing.forumId) existing.forumId = incoming.forumId;
        if (incoming.authorName && !existing.authorName) existing.authorName = incoming.authorName;
        existing.lastSeenTotal = Math.max(existing.lastSeenTotal, incoming.lastSeenTotal);
        changedThreads += 1;
      }
    }

    var nextDrafts = { v: SCHEMA_VERSION, byThread: Object.assign({}, drafts.byThread) };
    if (isPlainObject(payload.drafts)) {
      var dids = Object.keys(payload.drafts);
      for (var k = 0; k < dids.length && k < 500; k += 1) {
        if (!/^[0-9]{1,12}$/.test(dids[k])) continue;
        var d = payload.drafts[dids[k]];
        if (!isPlainObject(d)) continue;
        var textValue = safeString(d.text, DRAFT_MAX_CHARS);
        if (!textValue) continue;
        var incomingAt = Math.max(0, toInt(d.updatedAt, 0));
        var current = nextDrafts.byThread[dids[k]];
        if (current && current.updatedAt >= incomingAt) continue;
        nextDrafts.byThread[dids[k]] = {
          text: textValue, updatedAt: incomingAt, title: safeString(d.title, 300),
        };
        addedDrafts += 1;
      }
    }

    return {
      ok: true,
      organizer: org,
      drafts: nextDrafts,
      summary: { addedFolders: addedFolders, changedThreads: changedThreads, addedDrafts: addedDrafts },
    };
  }

  // -- formatting ----------------------------------------------------------

  function formatCount(n) {
    var v = toInt(n, 0);
    if (v >= 1000000) return (v / 1000000).toFixed(1).replace(/\.0$/, '') + 'm';
    if (v >= 1000) return (v / 1000).toFixed(1).replace(/\.0$/, '') + 'k';
    return String(v);
  }

  // Math.round(bytes / 1024) reports a cache that genuinely holds something as
  // "0 KB", which reads as broken rather than small.
  function plural(n, one, many) {
    return toInt(n, 0) === 1 ? one : (many === undefined ? one + 's' : many);
  }

  function formatBytes(n) {
    var v = Math.max(0, toInt(n, 0));
    if (v < 1024) return v + ' B';
    if (v < 1024 * 1024) return (v / 1024).toFixed(v < 10240 ? 1 : 0) + ' KB';
    return (v / (1024 * 1024)).toFixed(1) + ' MB';
  }

  function formatRelativeTime(at, now) {
    if (at === null || at === undefined || at <= 0) return 'unknown';
    var delta = toInt(now, 0) - toInt(at, 0);
    if (delta < 0) return 'just now';
    var mins = Math.floor(delta / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return mins + 'm ago';
    var hours = Math.floor(mins / 60);
    if (hours < 24) return hours + 'h ago';
    var days = Math.floor(hours / 24);
    if (days < 30) return days + 'd ago';
    var months = Math.floor(days / 30);
    if (months < 12) return months + 'mo ago';
    return Math.floor(months / 12) + 'y ago';
  }

  // Torn City Time is UTC, which is what players quote to each other, so this
  // never renders a local-timezone string that would disagree with the game.
  function formatAbsoluteTime(at) {
    if (!at) return 'unknown';
    var d = new Date(toInt(at, 0));
    function pad(n) { return (n < 10 ? '0' : '') + n; }
    return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate())
      + ' ' + pad(d.getUTCHours()) + ':' + pad(d.getUTCMinutes()) + ' TCT';
  }

  // ---- ENGINE END ------------------------------------------------------

  // -- storage runtime -----------------------------------------------------

  // A distinct sentinel for "there was something stored and it could not be
  // read". Collapsing that into null would make a damaged key look exactly like
  // an absent one, and the user would lose their folders in silence.
  var PARSE_FAILED = { tfccParseFailed: true };

  function readRaw(name) {
    var v;
    try {
      v = GM_getValue(name, null);
    } catch (e) {
      return null;
    }
    if (typeof v !== 'string' || !v) return null;
    try {
      return JSON.parse(v);
    } catch (e2) {
      return PARSE_FAILED;
    }
  }

  function writeRaw(name, value) {
    try {
      GM_setValue(name, JSON.stringify(value));
      return { ok: true };
    } catch (e) {
      return { ok: false, reason: 'storage', detail: 'Could not save. Script storage refused the write.' };
    }
  }

  function loadKey(name, normaliser, now) {
    var raw = readRaw(name);
    if (raw === PARSE_FAILED) {
      return { value: normaliser(null, now), recovered: true, hadRaw: true };
    }
    var value = normaliser(raw, now);
    var recovered = isRecoveredValue(raw, value);
    return { value: value, recovered: recovered, hadRaw: raw !== null };
  }

  function saveKey(name, value) {
    return writeRaw(name, value);
  }

  function loadApiKey() {
    var stored = null;
    try {
      var v = GM_getValue(STORAGE_KEYS.key, null);
      stored = typeof v === 'string' ? v : null;
    } catch (e) {
      stored = null;
    }
    if (isKeyShaped(stored)) return stored;
    return pdaInjectedKey(PDA_KEY_SLOT);
  }

  function saveApiKey(value) {
    if (value === '' || value === null) {
      try { GM_setValue(STORAGE_KEYS.key, ''); return { ok: true }; } catch (e) { return { ok: false, reason: 'storage' }; }
    }
    if (!isKeyShaped(value)) {
      return { ok: false, reason: 'shape', detail: 'A Torn API key is 16 letters and digits.' };
    }
    try { GM_setValue(STORAGE_KEYS.key, value); return { ok: true }; } catch (e2) {
      return { ok: false, reason: 'storage', detail: 'Script storage refused the write.' };
    }
  }

  // -- the API adapter -----------------------------------------------------

  // Torn PDA is not Tampermonkey. Its own bridge routes through the Flutter
  // HTTP client and is the only tier guaranteed to work inside the app webview,
  // so it is tried first. Plain fetch is last because a cross-origin call to
  // api.torn.com depends on CORS headers this script does not control.
  function ambientTransports() {
    return {
      pda: (typeof PDA_httpGet === 'function') ? PDA_httpGet : null,
      gm: (typeof GM_xmlhttpRequest === 'function') ? GM_xmlhttpRequest : null,
      fetch: (typeof fetch === 'function') ? fetch : null,
    };
  }

  function transportName(t) {
    if (t.pda) return 'pda';
    if (t.gm) return 'gm';
    if (t.fetch) return 'fetch';
    return null;
  }

  // Never rejects. Every outcome, including a thrown transport, is a value, so
  // no caller has to remember a try/catch and no failure can escape onto Torn's
  // page as an unhandled rejection.
  function httpGet(url, transports) {
    var t = transports || ambientTransports();
    var name = transportName(t);
    if (!name) {
      return Promise.resolve({ ok: false, reason: 'network', detail: 'No HTTP transport is available.' });
    }

    return new Promise(function (resolve) {
      var settled = false;
      var timer = null;

      function finish(result) {
        if (settled) return;
        settled = true;
        if (timer !== null) { clearTimeout(timer); timer = null; }
        resolve(result);
      }

      // A timer race rather than AbortController: AbortController's behaviour
      // varies across the embedded webviews this script has to run in, and a
      // deadline that silently does not fire is worse than none.
      timer = setTimeout(function () {
        finish({ ok: false, reason: 'timeout', detail: 'Torn did not answer in time.' });
      }, REQUEST_TIMEOUT_MS);

      try {
        if (name === 'pda') {
          Promise.resolve(t.pda(url, { Accept: 'application/json' })).then(function (res) {
            var status = res && res.status !== undefined ? Number(res.status) : 0;
            finish({ ok: status >= 200 && status < 300, status: status, text: (res && res.responseText) || '', reason: status >= 200 && status < 300 ? null : 'http' });
          }, function (err) {
            finish({ ok: false, reason: 'network', detail: scrubDetail(err && err.message) });
          });
          return;
        }
        if (name === 'gm') {
          t.gm({
            method: 'GET',
            url: url,
            headers: { Accept: 'application/json' },
            timeout: REQUEST_TIMEOUT_MS,
            onload: function (res) {
              var status = res && res.status !== undefined ? Number(res.status) : 0;
              finish({ ok: status >= 200 && status < 300, status: status, text: (res && res.responseText) || '', reason: status >= 200 && status < 300 ? null : 'http' });
            },
            onerror: function () { finish({ ok: false, reason: 'network', detail: 'The request failed.' }); },
            ontimeout: function () { finish({ ok: false, reason: 'timeout', detail: 'Torn did not answer in time.' }); },
            onabort: function () { finish({ ok: false, reason: 'network', detail: 'The request was aborted.' }); },
          });
          return;
        }
        Promise.resolve(t.fetch(url, { method: 'GET', headers: { Accept: 'application/json' }, credentials: 'omit' }))
          .then(function (res) {
            var status = res && res.status !== undefined ? Number(res.status) : 0;
            return Promise.resolve(res.text()).then(function (text) {
              finish({ ok: status >= 200 && status < 300, status: status, text: text || '', reason: status >= 200 && status < 300 ? null : 'http' });
            }, function () {
              finish({ ok: false, reason: 'parse', detail: 'The response body could not be read.' });
            });
          }, function (err) {
            finish({ ok: false, reason: 'network', detail: scrubDetail(err && err.message) });
          });
      } catch (e) {
        finish({ ok: false, reason: 'network', detail: scrubDetail(e && e.message) });
      }
    });
  }

  var limiter = makeRateLimiter({});
  var inFlight = {};

  function delay(ms) {
    return new Promise(function (resolve) { setTimeout(resolve, Math.max(0, ms)); });
  }

  // No detail string built here may contain the key, so the URL is redacted
  // before it can reach one. tests/api.test.js scans every failure path for it.
  function tornApiGet(path, params, options) {
    var opts = options || {};
    var key = opts.key === undefined ? loadApiKey() : opts.key;
    if (!isKeyShaped(key)) {
      return Promise.resolve({ ok: false, reason: 'nokey', detail: 'Add a Torn API key in Settings. Use a Minimal Access key; Limited Access also works. A Public Only key does not.' });
    }
    // Nothing goes out while Torn has already refused this key. This gate is
    // in tornApiGet rather than in refreshAll so that enrichment, deep search
    // and any future caller are covered by it too.
    if (state.settings.keyRejected) {
      return Promise.resolve({
        ok: false,
        reason: 'keyrejected',
        code: state.settings.keyRejected,
        detail: mapTornError(state.settings.keyRejected, '').message
          + ' The script has stopped using it. Save a new key in Settings.',
      });
    }

    var full = buildApiUrl(API_BASE, path, Object.assign({}, params, {
      key: key,
      comment: 'ForumCommandCenter',
    }));
    var safe = redactUrl(full);
    var flightKey = path + '|' + JSON.stringify(params || {});

    if (opts.singleFlight !== false && Object.prototype.hasOwnProperty.call(inFlight, flightKey)) {
      return Promise.resolve({ ok: false, reason: 'inflight', detail: 'That request is already running.' });
    }

    var now = opts.now === undefined ? Date.now() : opts.now;
    var slot = (opts.limiter || limiter).reserve(now);
    if (!slot.ok) {
      return Promise.resolve({
        ok: false,
        reason: 'throttled',
        detail: 'Slowing down to stay inside Torn\'s API limit. Try again shortly.',
        retryAfterMs: slot.retryAfterMs,
      });
    }

    if (opts.singleFlight !== false) inFlight[flightKey] = true;

    var run = delay(slot.waitMs)
      .then(function () { return httpGet(full, opts.transports); })
      .then(function (res) {
        if (!res.ok) {
          return {
            ok: false,
            reason: res.reason || 'network',
            detail: scrubDetail(res.detail || ('Torn answered with status ' + (res.status || 0) + ' for ' + safe)),
            status: res.status || 0,
          };
        }
        var data;
        try {
          data = JSON.parse(res.text);
        } catch (e) {
          return { ok: false, reason: 'parse', detail: 'Torn sent something that is not JSON.' };
        }
        if (isPlainObject(data) && isPlainObject(data.error)) {
          var mapped = mapTornError(data.error.code, data.error.error);
          if (KEY_REJECTED_CODES.indexOf(mapped.code) !== -1) {
            rejectKey(mapped.code);
          }
          return { ok: false, reason: 'torn', code: mapped.code, detail: scrubDetail(mapped.message) };
        }
        if (!isPlainObject(data)) {
          return { ok: false, reason: 'parse', detail: 'Torn sent a response this script cannot read.' };
        }
        return { ok: true, data: data };
      })
      .catch(function (e) {
        return { ok: false, reason: 'network', detail: scrubDetail(e && e.message) };
      });

    return run.then(function (result) {
      delete inFlight[flightKey];
      return result;
    });
  }

  // ---- runtime state -----------------------------------------------------

  var state = {
    settings: freshSettings(),
    organizer: freshOrganizer(0),
    drafts: freshDrafts(),
    feed: freshFeed(),
    postCache: freshPostCache(),
    mine: freshMine(),
    refreshingMine: false,
    mineError: null,
    rows: [],
    loading: false,
    refreshing: false,
    lastError: null,
    notices: [],
    searchQuery: '',
    searchResults: null,
    deepBusy: false,
    deepProgress: null,
    draftFocusId: null,
    pendingRedraw: false,
    generation: 0,
    mounted: false,
    route: null,
    replyBoxFound: false,
  };

  // Anything that makes an in-flight request's answer no longer wanted goes
  // through here: a reset, a cleared key, leaving the page. refreshAll captures
  // the generation when it starts and checks it before every write, so a result
  // that arrives after one of those events is dropped instead of quietly
  // rebuilding data the user just told the script to throw away.
  function invalidateInFlight() {
    state.generation += 1;
    state.refreshing = false;
  }

  // Torn has refused the stored key. Stop using it immediately and remember
  // that across reloads.
  //
  // This deliberately does NOT invalidate work in flight. Doing so made the
  // refresh treat its own rejection as stale and swallow the message, leaving
  // the user with a panel that had silently stopped working and said nothing.
  // Nothing needs invalidating anyway: the request failed rather than returning
  // data, and every other caller is already gated in tornApiGet.
  //
  // The error is recorded here rather than left to the caller so that whichever
  // request happened to be the one refused, the panel says the same thing.
  function rejectKey(code) {
    if (state.settings.keyRejected === code) return;
    state.settings.keyRejected = code;
    persist('settings');
    state.lastError = {
      reason: 'keyrejected',
      detail: mapTornError(code, '').message
        + ' The script has stopped using it. Save a new key in Settings.',
    };
  }

  function clearKeyRejection() {
    if (!state.settings.keyRejected) return;
    state.settings.keyRejected = 0;
    persist('settings');
  }

  function notice(text, kind) {
    state.notices.push({ text: safeString(text, 300), kind: kind || 'info' });
    if (state.notices.length > 5) state.notices.shift();
  }

  function loadAll(now) {
    var s = loadKey(STORAGE_KEYS.settings, normaliseSettings, now);
    var o = loadKey(STORAGE_KEYS.organizer, normaliseOrganizer, now);
    var d = loadKey(STORAGE_KEYS.drafts, normaliseDrafts, now);
    var f = loadKey(STORAGE_KEYS.feed, normaliseFeed, now);
    var p = loadKey(STORAGE_KEYS.postCache, normalisePostCache, now);
    var m = loadKey(STORAGE_KEYS.mine, normaliseMine, now);
    state.settings = s.value;
    state.organizer = o.value;
    state.drafts = d.value;
    state.feed = f.value;
    state.postCache = p.value;
    state.mine = m.value;
    // A key that failed normalisation is reported rather than silently reset,
    // because a user who loses their folders deserves to know it happened.
    [['Settings', s], ['Folders and tags', o], ['Drafts', d], ['Cached thread list', f], ['Post cache', p], ['My posts list', m]]
      .forEach(function (pair) {
        if (pair[1].recovered) notice(pair[0] + ' were damaged and have been reset.', 'warn');
      });
  }

  function persist(which) {
    var map = {
      settings: [STORAGE_KEYS.settings, state.settings],
      organizer: [STORAGE_KEYS.organizer, state.organizer],
      drafts: [STORAGE_KEYS.drafts, state.drafts],
      feed: [STORAGE_KEYS.feed, state.feed],
      postCache: [STORAGE_KEYS.postCache, state.postCache],
      mine: [STORAGE_KEYS.mine, state.mine],
    };
    var pair = map[which];
    if (!pair) return { ok: true };
    var res = saveKey(pair[0], pair[1]);
    if (!res.ok) notice(res.detail || 'Could not save.', 'error');
    return res;
  }

  function recompute(now) {
    state.rows = mergeThreads({
      subscribed: state.feed.subscribed,
      activity: state.feed.activity,
      categories: state.feed.categories,
      organizer: state.organizer,
      drafts: state.drafts,
      mine: state.mine,
      now: now,
    });
  }

  // ---- data acquisition --------------------------------------------------

  function refreshAll(now, opts) {
    var options = opts || {};
    if (state.refreshing) return Promise.resolve({ ok: false, reason: 'inflight' });
    state.refreshing = true;
    var generation = state.generation;
    var budget = clamp(toInt(state.settings.enrichBudget, DEFAULT_ENRICH_BUDGET), 0, MAX_ENRICH_BUDGET);

    function stale() { return generation !== state.generation; }

    var work = tornApiGet('user/forumsubscribedthreads', {}, options)
      .then(function (res) {
        if (stale()) return { ok: false, reason: 'stale' };
        if (!res.ok) return res;
        var list = res.data.forumSubscribedThreads || res.data.forumSbuscribedThreads || [];
        state.feed.subscribed = [];
        for (var i = 0; i < list.length; i += 1) {
          var row = normaliseSubscribedRow(list[i]);
          if (row) state.feed.subscribed.push(row);
        }
        state.feed.fetchedAt = now;
        state.organizer = applyAutoAssign(state.organizer, state.feed.subscribed, now);
        return tornApiGet('user/forumfeed', {}, options);
      })
      .then(function (res) {
        if (stale()) return { ok: false, reason: 'stale' };
        if (!res || !res.ok) return res;
        var list = res.data.forumFeed || [];
        state.feed.activity = [];
        for (var i = 0; i < list.length; i += 1) {
          var row = normaliseActivityRow(list[i]);
          if (row) state.feed.activity.push(row);
        }
        if (state.feed.categoriesAt && (now - state.feed.categoriesAt) < CATEGORY_TTL_MS) {
          return { ok: true, skipped: true };
        }
        return tornApiGet('forum/categories', {}, options).then(function (cres) {
          if (stale()) return { ok: false, reason: 'stale' };
          if (cres.ok) {
            var cats = cres.data.categories || [];
            state.feed.categories = [];
            for (var j = 0; j < cats.length; j += 1) {
              var c = normaliseCategoryRow(cats[j]);
              if (c) state.feed.categories.push(c);
            }
            state.feed.categoriesAt = now;
          }
          // A missing category list costs labels, never data. It must not fail
          // the refresh that already succeeded.
          return { ok: true };
        });
      })
      .then(function (res) {
        if (stale()) return { ok: false, reason: 'stale' };
        if (!res || !res.ok) {
          // A stale result is not a failure the user needs to read about; they
          // caused it by resetting, clearing the key, or leaving the page.
          if (res && res.reason === 'stale') return res;
          state.lastError = { reason: res ? res.reason : 'network', detail: res ? res.detail : 'Refresh failed.' };
          return res;
        }
        state.lastError = null;
        recompute(now);
        if (budget <= 0) return { ok: true };
        var targets = state.rows
          .filter(function (r) { return r.subscribed && r.unread > 0 && r.activitySource !== 'enriched'; })
          .slice(0, budget);
        return enrichThreads(targets.map(function (r) { return r.numericId; }), now, options);
      })
      .then(function (res) {
        if (!stale()) {
          recompute(now);
          persist('feed');
          persist('organizer');
        }
        return res || { ok: true };
      })
      .catch(function (e) {
        state.lastError = { reason: 'network', detail: scrubDetail(e && e.message) };
        return { ok: false, reason: 'network' };
      });

    return work.then(function (r) {
      state.refreshing = false;
      return r;
    });
  }

  function enrichThreads(ids, now, opts) {
    var list = (ids || []).slice(0, MAX_ENRICH_BUDGET);
    if (!list.length) return Promise.resolve({ ok: true, enriched: 0 });
    var done = 0;
    var generation = state.generation;

    function step(i) {
      if (i >= list.length) return Promise.resolve({ ok: true, enriched: done });
      return tornApiGet('forum/' + list[i] + '/thread', {}, opts).then(function (res) {
        if (generation !== state.generation) return { ok: true, enriched: done, stale: true };
        if (res.ok && isPlainObject(res.data.thread)) {
          var t = res.data.thread;
          var id = String(list[i]);
          if (!Object.prototype.hasOwnProperty.call(state.organizer.threads, id)) {
            state.organizer.threads[id] = normaliseThreadEntry(null);
          }
          var e = state.organizer.threads[id];
          e.lastPostTimeCached = secondsToMs(t.last_post_time) || e.lastPostTimeCached;
          e.enrichedAt = now;
          e.isLocked = t.is_locked === true;
          e.isSticky = t.is_sticky === true;
          if (!e.title && t.title) e.title = safeString(t.title, 300);
          done += 1;
        } else if (res.reason === 'throttled') {
          // Stop the batch rather than grinding against the limit.
          return { ok: true, enriched: done, stoppedEarly: true };
        }
        return step(i + 1);
      });
    }

    return step(0);
  }

  function runDeepSearch(threadIds, queryText, now, opts) {
    var query = parseQuery(queryText);
    if (query.isEmpty) {
      return Promise.resolve({ ok: false, reason: 'empty', detail: 'Type something to search for.' });
    }
    // Two concurrent searches both read-modify-write state.postCache, so
    // whichever finished last would silently discard the other's fetched posts
    // - and the first to finish would re-enable the button while the other was
    // still running.
    if (state.deepBusy) {
      return Promise.resolve({ ok: false, reason: 'inflight', detail: 'A search is already running.' });
    }
    var ids = (threadIds || []).slice(0, DEEP_SEARCH_MAX_THREADS);
    var maxPages = clamp(toInt(state.settings.deepSearchPages, DEEP_SEARCH_MAX_PAGES), 1, DEEP_SEARCH_MAX_PAGES);
    state.deepBusy = true;
    state.deepProgress = { done: 0, total: ids.length };

    function fetchThread(i) {
      if (i >= ids.length) return Promise.resolve({ ok: true });
      var id = ids[i];
      var collected = [];

      function page(n) {
        if (n >= maxPages) return Promise.resolve({ complete: false });
        return tornApiGet('forum/' + id + '/posts', { offset: n * POSTS_PER_PAGE }, opts).then(function (res) {
          if (!res.ok) return { complete: false, error: res };
          var posts = res.data.posts || [];
          for (var j = 0; j < posts.length; j += 1) {
            var p = posts[j];
            collected.push({
              id: p.id,
              authorId: p.author && p.author.id,
              authorName: p.author && p.author.username,
              at: secondsToMs(p.created_time),
              text: stripHtml(p.content),
            });
          }
          if (posts.length < POSTS_PER_PAGE) return { complete: true };
          return page(n + 1);
        });
      }

      return page(0).then(function (r) {
        if (collected.length) {
          state.postCache = postCacheAdd(state.postCache, id, collected, {
            fetchedAt: now, pages: maxPages, complete: !!r.complete,
          });
        }
        state.deepProgress = { done: i + 1, total: ids.length };
        return fetchThread(i + 1);
      });
    }

    return fetchThread(0).then(function () {
      state.deepBusy = false;
      persist('postCache');
      state.searchResults = {
        mode: 'deep',
        query: queryText,
        posts: searchPosts(state.postCache, state.rows, query, 200),
      };
      return { ok: true, results: state.searchResults };
    }).catch(function (e) {
      state.deepBusy = false;
      return { ok: false, reason: 'network', detail: scrubDetail(e && e.message) };
    });
  }

  // ---- capture -----------------------------------------------------------

  // Reads location and document.title and nothing else. Every attempt to find
  // the current forums DOM failed research, so no data path may depend on it:
  // this is the whole of what the script learns from a page visit.
  function captureVisit(loc, docTitle, now) {
    var route = parseForumRoute(loc);
    if (!route.isThread) return { changed: false, route: route };
    var id = String(route.threadId);
    if (!Object.prototype.hasOwnProperty.call(state.organizer.threads, id)) {
      state.organizer.threads[id] = normaliseThreadEntry(null);
    }
    var e = state.organizer.threads[id];
    e.lastVisitedAt = toInt(now, 0);
    if (!e.firstSeenAt) e.firstSeenAt = toInt(now, 0);
    var name = titleToThreadName(docTitle);
    if (name && name.toLowerCase() !== 'forums') e.title = name;
    if (route.forumId) e.forumId = route.forumId;
    return { changed: true, route: route, threadId: id };
  }

  // ---- reply box and drafts ----------------------------------------------

  var REPLY_SELECTORS = Object.freeze([
    // Torn's own reply editor, most specific first. Every one of these is a
    // guess against markup research could not confirm, so failure here has to
    // be visible and harmless: the panel falls back to a copy button.
    'textarea[name="postText"]',
    '#quickReplyText',
    '.forums-thread-wrap textarea',
    '#forums-page-wrap textarea',
    'textarea',
  ]);

  function findReplyBox(doc) {
    if (!doc || typeof doc.querySelector !== 'function') return null;
    for (var i = 0; i < REPLY_SELECTORS.length; i += 1) {
      var el = null;
      try { el = doc.querySelector(REPLY_SELECTORS[i]); } catch (e) { el = null; }
      if (el && el.isConnected !== false) return el;
    }
    return null;
  }

  // React owns the value of its own textarea. Assigning .value directly updates
  // the DOM but not React's state, and the next render throws the text away.
  // Going through the prototype's native setter and then dispatching a bubbling
  // input event is what makes React accept the change.
  function insertDraft(doc, win, text) {
    var box = findReplyBox(doc);
    if (!box) {
      return { ok: false, reason: 'noreplybox', detail: 'No reply box found on this page. Use Copy instead.' };
    }
    try {
      var proto = win && win.HTMLTextAreaElement ? win.HTMLTextAreaElement.prototype : null;
      var desc = proto ? Object.getOwnPropertyDescriptor(proto, 'value') : null;
      if (desc && typeof desc.set === 'function') {
        desc.set.call(box, text);
      } else {
        box.value = text;
      }
      var EventCtor = win && win.Event ? win.Event : null;
      if (EventCtor) box.dispatchEvent(new EventCtor('input', { bubbles: true }));
      if (typeof box.focus === 'function') box.focus();
      return { ok: true };
    } catch (e) {
      return { ok: false, reason: 'insert', detail: 'Could not write into the reply box.' };
    }
  }

  // Autosave keeps its own record of which element it is listening to. The
  // panel redraws on every interaction, so attaching per draw would pile up a
  // listener each time and write the same draft over and over.
  var autosaveBox = null;
  var autosaveTimer = null;

  function attachAutosave(doc, win) {
    if (!state.settings.autosaveDrafts || !state.route || !state.route.isThread) {
      autosaveBox = null;
      return false;
    }
    var box = findReplyBox(doc);
    if (!box || typeof box.addEventListener !== 'function') {
      autosaveBox = null;
      return false;
    }
    if (autosaveBox === box) return true;
    autosaveBox = box;

    box.addEventListener('input', function () {
      if (autosaveTimer !== null) clearTimeout(autosaveTimer);
      autosaveTimer = setTimeout(function () {
        autosaveTimer = null;
        try {
          if (!state.settings.autosaveDrafts) return;
          if (!state.route || !state.route.isThread) return;
          var text = box.value === undefined || box.value === null ? '' : String(box.value);
          // An empty box never deletes a saved draft. Torn clears the reply box
          // after a successful post, and can hand back an empty textarea during
          // a re-render; either would otherwise wipe work the user still wants.
          // Deleting a draft is what the Delete button is for.
          if (!text.trim()) return;
          state.drafts = saveDraft(state.drafts, state.route.threadId, text, Date.now(), '');
          persist('drafts');
        } catch (e) { /* autosave must never throw onto Torn's page */ }
      }, AUTOSAVE_DEBOUNCE_MS);
    });
    return true;
  }

  function detachAutosave() {
    autosaveBox = null;
    if (autosaveTimer !== null) { clearTimeout(autosaveTimer); autosaveTimer = null; }
  }

  // ---- theme and styles --------------------------------------------------

  // What the page is actually painted, rather than what we guess it is called.
  // Torn's theme class name was never confirmed, and Match Torn did not in fact
  // follow Torn's web theme. A measured background cannot go stale that way.
  function measurePageTheme(doc, win) {
    try {
      if (!win || typeof win.getComputedStyle !== 'function') return null;
      var candidates = [doc && doc.body, doc && doc.documentElement];
      // "Could not read a colour" and "read a transparent colour" are different
      // answers. Only the second means the browser is painting its own white
      // canvas; the first has to fall through to the other signals.
      var readAny = false;
      for (var i = 0; i < candidates.length; i += 1) {
        if (!candidates[i]) continue;
        var style = win.getComputedStyle(candidates[i]);
        if (!style) continue;
        var raw = style.backgroundColor;
        if (typeof raw !== 'string' || !raw) continue;
        if (raw === 'transparent') { readAny = true; continue; }
        var m = /rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?/.exec(raw);
        if (!m) continue;
        readAny = true;
        // A transparent element paints nothing, so the colour comes from
        // further out. Keep looking rather than reading it as black.
        if (m[4] !== undefined && Number(m[4]) < 0.5) continue;
        var lum = 0.2126 * Number(m[1]) + 0.7152 * Number(m[2]) + 0.0722 * Number(m[3]);
        return lum < 128 ? 'dark' : 'light';
      }
      // Everything readable was transparent, so the browser paints white.
      return readAny ? 'light' : null;
    } catch (e) {
      return null;
    }
  }

  function resolveTheme(setting, doc, win) {
    if (setting === 'dark' || setting === 'light') return setting;

    var measured = measurePageTheme(doc, win);
    if (measured) return measured;

    try {
      var body = doc && doc.body;
      if (body && body.classList && typeof body.classList.contains === 'function') {
        if (body.classList.contains('dark-mode')) return 'dark';
        if (body.classList.contains('light-mode')) return 'light';
      }
    } catch (e) { /* Torn's theme class is a convenience, never a requirement */ }
    try {
      if (win && typeof win.matchMedia === 'function') {
        if (win.matchMedia('(prefers-color-scheme: light)').matches) return 'light';
      }
    } catch (e2) { /* fall through to the default */ }
    return 'dark';
  }

  // Applying the theme touches two class names and no markup, so it can run as
  // often as needed without costing anyone their caret.
  function applyThemeClass(doc, win) {
    try {
      var panel = doc.getElementById(PANEL_ID);
      if (!panel || !panel.classList) return null;
      var theme = resolveTheme(state.settings.theme, doc, win);
      panel.classList.remove('tfcc-theme-dark');
      panel.classList.remove('tfcc-theme-light');
      panel.classList.add('tfcc-theme-' + theme);
      return theme;
    } catch (e) {
      return null;
    }
  }

  // Torn's theme toggle changes a class, which is an attribute mutation. The
  // navigation observer only watches childList, so without this the panel kept
  // whichever theme it resolved on the page it first loaded into.
  function observeTheme(doc, win) {
    if (!doc || !win || win[THEME_FLAG]) return;
    win[THEME_FLAG] = true;
    try {
      if (typeof MutationObserver === 'function') {
        var mo = new MutationObserver(function () { applyThemeClass(doc, win); });
        if (doc.body) mo.observe(doc.body, { attributes: true, attributeFilter: ['class'] });
        if (doc.documentElement) {
          mo.observe(doc.documentElement, { attributes: true, attributeFilter: ['class', 'data-theme'] });
        }
      }
    } catch (e) { /* the panel keeps its current theme; nothing else breaks */ }
    try {
      if (typeof win.matchMedia === 'function') {
        var mq = win.matchMedia('(prefers-color-scheme: light)');
        if (mq && typeof mq.addEventListener === 'function') {
          mq.addEventListener('change', function () { applyThemeClass(doc, win); });
        }
      }
    } catch (e2) { /* same */ }
  }

  function panelStyleText() {
    return [
      // Colour values follow Torn Bookie Live Scores' default scheme so the two
      // scripts read as a family. --tm-* means "matches Bookie"; --tfcc-* is
      // local to this script. No font is set: the panel inherits Torn's, which
      // is what makes it look like part of the page rather than bolted on.
      '#' + PANEL_ID + ' {',
      '  --tm-bg: #1f1f1f; --tm-bg-2: #262626; --tm-bg-3: #111111; --tm-hover: #292929;',
      '  --tm-border: #3a3a3a; --tm-border-2: #555555;',
      '  --tm-text: #ffffff; --tm-muted: #b8b8b8; --tm-meta: #cfcfcf;',
      '  --tm-good-bg: #2a6b3a; --tm-good-text: #7ee081; --tm-bad-text: #ff8080;',
      '  --tm-warn-text: #e8c06a; --tm-accent-text: #6ea3d0;',
      '  --tfcc-text-sm: 12px; --tfcc-text: 14px; --tfcc-text-lg: 1.2em;',
      '  --tfcc-gap-xs: 4px; --tfcc-gap-sm: 6px; --tfcc-gap: 8px; --tfcc-gap-lg: 14px;',
      '  --tfcc-focus-ring: 2px solid var(--tm-good-text);',
      '}',
      '#' + PANEL_ID + '.tfcc-theme-light {',
      '  --tm-bg: #f2f2f2; --tm-bg-2: #e8e8e8; --tm-bg-3: #ffffff; --tm-hover: #dcdcdc;',
      '  --tm-border: #c4c4c4; --tm-border-2: #9a9a9a;',
      '  --tm-text: #141414; --tm-muted: #4a4a4a; --tm-meta: #3a3a3a;',
      '  --tm-good-bg: #cfe8d4; --tm-good-text: #1c5c2c; --tm-bad-text: #a11414;',
      '  --tm-warn-text: #7a5600; --tm-accent-text: #14507d;',
      '}',
      '#' + FALLBACK_ID + ' { position: fixed; right: 12px; bottom: 12px; z-index: 2147483000;',
      '  box-sizing: border-box; width: min(960px, calc(100vw - 24px)); max-width: calc(100vw - 24px);',
      '  max-height: calc(100vh - 24px); max-height: calc(100dvh - 24px); overflow-y: auto; }',
      '#' + PANEL_ID + ' { box-sizing: border-box; width: 100%; border: 1px solid var(--tm-border-2);',
      '  background: var(--tm-bg); color: var(--tm-text); border-radius: 6px;',
      '  padding: 10px 12px; margin: 12px 0; font-size: var(--tfcc-text); line-height: 1.5; }',
      '#' + PANEL_ID + ' * { box-sizing: border-box; }',
      // Inheritance is the weakest source in CSS: a value is inherited only
      // when NO rule matches. Torn styles bare elements - td, h4, p, code - so
      // any such rule of theirs beat our panel's inherited colour and painted
      // black text on the dark panel. background needs its own reset because it
      // is not inherited at all, which is how a host `code { background: #eee }`
      // survived the colour fix and left grey text on a grey block.
      // Both declarations are (1,0,0), so every rule below still wins.
      '#' + PANEL_ID + ' * { color: inherit; background: transparent; }',
      '#' + PANEL_ID + ' code, #' + PANEL_ID + ' pre {',
      '  font-family: ui-monospace, Consolas, monospace; font-size: var(--tfcc-text-sm);',
      '  color: var(--tm-accent-text); background: var(--tm-bg-3);',
      '  border-radius: 3px; padding: 0 4px; }',
      '#' + PANEL_ID + '.tfcc-takeover { position: fixed; inset: 0; margin: 0; border-radius: 0;',
      '  z-index: 2147483000; height: 100vh; height: 100dvh; max-height: 100vh; max-height: 100dvh;',
      '  overflow-y: auto; overflow-x: hidden; padding: 12px; }',
      '#' + PANEL_ID + ' .tfcc-head { display: flex; align-items: center; gap: var(--tfcc-gap);',
      '  flex-wrap: wrap; margin-bottom: var(--tfcc-gap); }',
      '#' + PANEL_ID + ' .tfcc-title { font-weight: bold; margin-right: auto; }',
      '#' + PANEL_ID + ' .tfcc-badge { background: var(--tm-good-bg); color: var(--tm-text);',
      '  border-radius: 10px; padding: 0 8px; font-size: var(--tfcc-text-sm); font-weight: bold; }',
      '#' + PANEL_ID + ' button, #' + PANEL_ID + ' select, #' + PANEL_ID + ' input,',
      '#' + PANEL_ID + ' textarea {',
      '  font: inherit; color: var(--tm-text); background: var(--tm-bg-3);',
      '  border: 1px solid var(--tm-border-2); border-radius: 4px; padding: 3px 8px; }',
      '#' + PANEL_ID + ' option { background: var(--tm-bg-3); color: var(--tm-text); }',
      '#' + PANEL_ID + ' button { cursor: pointer; }',
      '#' + PANEL_ID + ' button:hover { background: var(--tm-hover); }',
      '#' + PANEL_ID + ' .tfcc-linkbtn { display: inline-block; text-decoration: none;',
      '  color: var(--tm-text); background: var(--tm-bg-3); border: 1px solid var(--tm-border-2);',
      '  border-radius: 4px; padding: 3px 8px; }',
      '#' + PANEL_ID + ' .tfcc-linkbtn:hover { background: var(--tm-hover); }',
      '#' + PANEL_ID + ' button[aria-pressed="true"] { background: var(--tm-good-bg); }',
      '#' + PANEL_ID + ' :focus-visible { outline: var(--tfcc-focus-ring); outline-offset: 2px; }',
      // Every anchor, and every one of its states. An unstyled link falls back
      // to the browser default of rgb(0,0,238), which is all but black against
      // the dark panel; :visited falls back to purple, which is worse. Styling
      // only .tfcc-row-title a left the Search and Drafts links unreadable.
      '#' + PANEL_ID + ' a, #' + PANEL_ID + ' a:link, #' + PANEL_ID + ' a:visited,',
      '#' + PANEL_ID + ' a:hover, #' + PANEL_ID + ' a:active {',
      '  color: var(--tm-accent-text); }',
      '#' + PANEL_ID + ' a:hover { text-decoration: underline; }',
      '#' + PANEL_ID + ' .tfcc-row-title a, #' + PANEL_ID + ' .tfcc-row-title a:visited {',
      '  color: var(--tm-text); }',
      '#' + PANEL_ID + ' .tfcc-linkbtn, #' + PANEL_ID + ' .tfcc-linkbtn:visited {',
      '  color: var(--tm-text); }',
      '#' + PANEL_ID + ' .tfcc-nav { display: flex; gap: var(--tfcc-gap-sm); flex-wrap: wrap;',
      '  margin-bottom: var(--tfcc-gap); }',
      '#' + PANEL_ID + ' .tfcc-bar { display: flex; gap: var(--tfcc-gap-sm); flex-wrap: wrap;',
      '  align-items: center; margin-bottom: var(--tfcc-gap); }',
      '#' + PANEL_ID + ' .tfcc-grow { flex: 1 1 180px; min-width: 0; }',
      '#' + PANEL_ID + ' .tfcc-rows { display: flex; flex-direction: column; gap: var(--tfcc-gap-xs); }',
      '#' + PANEL_ID + ' .tfcc-row { border: 1px solid var(--tm-border); border-radius: 4px;',
      '  background: var(--tm-bg-2); padding: var(--tfcc-gap-sm) var(--tfcc-gap); }',
      '#' + PANEL_ID + ' .tfcc-row-main { display: flex; align-items: baseline; gap: var(--tfcc-gap-sm);',
      '  flex-wrap: wrap; }',
      '#' + PANEL_ID + ' .tfcc-row-title { font-weight: bold; overflow-wrap: anywhere;',
      // A zero flex-basis, not auto. flex-wrap decides line breaks from the
      // base size, BEFORE any shrinking, so `auto` (the title's full content
      // width) wraps the title onto a line of its own and strands the pin
      // marker above it. Zero always fits, then grows into what is left.
      '  flex: 1 1 0; min-width: 0; }',
      '#' + PANEL_ID + ' .tfcc-row-title a { color: var(--tm-text); text-decoration: none; }',
      '#' + PANEL_ID + ' .tfcc-row-title a:hover { text-decoration: underline; }',
      '#' + PANEL_ID + ' .tfcc-pinned { color: var(--tm-warn-text); }',
      '#' + PANEL_ID + ' .tfcc-unread { color: var(--tm-good-text); font-weight: bold;',
      '  font-variant-numeric: tabular-nums; }',
      '#' + PANEL_ID + ' .tfcc-meta { color: var(--tm-meta); font-size: var(--tfcc-text-sm);',
      '  display: flex; gap: var(--tfcc-gap); flex-wrap: wrap; margin-top: 2px; }',
      '#' + PANEL_ID + ' .tfcc-tag { background: var(--tm-bg-3); border: 1px solid var(--tm-border);',
      '  border-radius: 3px; padding: 0 5px; font-size: var(--tfcc-text-sm); }',
      '#' + PANEL_ID + ' .tfcc-actions { display: flex; gap: var(--tfcc-gap-xs); flex-wrap: wrap;',
      '  margin-top: var(--tfcc-gap-xs); }',
      '#' + PANEL_ID + ' .tfcc-actions button { font-size: var(--tfcc-text-sm); padding: 1px 6px; }',
      '#' + PANEL_ID + ' .tfcc-note { color: var(--tm-muted); font-size: var(--tfcc-text-sm); }',
      '#' + PANEL_ID + ' .tfcc-error { color: var(--tm-bad-text); font-weight: bold;',
      '  margin-bottom: var(--tfcc-gap); }',
      '#' + PANEL_ID + ' .tfcc-warn { color: var(--tm-warn-text); margin-bottom: var(--tfcc-gap-sm); }',
      '#' + PANEL_ID + ' .tfcc-empty { color: var(--tm-muted); padding: var(--tfcc-gap-lg) 0;',
      '  text-align: center; }',
      '#' + PANEL_ID + ' .tfcc-section { border: 1px solid var(--tm-border); border-radius: 4px;',
      '  padding: var(--tfcc-gap); margin-bottom: var(--tfcc-gap); }',
      '#' + PANEL_ID + ' .tfcc-section h4 { margin: 0 0 var(--tfcc-gap-sm) 0; font-size: var(--tfcc-text); }',
      '#' + PANEL_ID + ' .tfcc-draft { width: 100%; min-height: 90px; resize: vertical; }',
      '#' + PANEL_ID + ' .tfcc-hit { border-left: 3px solid var(--tm-accent-text); padding-left: 8px;',
      '  margin-bottom: var(--tfcc-gap-sm); }',
      '#' + PANEL_ID + ' .tfcc-hit-text { white-space: pre-wrap; overflow-wrap: anywhere;',
      '  color: var(--tm-meta); font-size: var(--tfcc-text-sm); }',
      '#' + PANEL_ID + ' .tfcc-kv { display: flex; gap: var(--tfcc-gap); flex-wrap: wrap;',
      '  align-items: center; margin-bottom: var(--tfcc-gap-sm); }',
      '#' + PANEL_ID + ' .tfcc-kv label { min-width: 150px; color: var(--tm-meta); }',
      '#' + PANEL_ID + ' .tfcc-danger { border-color: var(--tm-bad-text); color: var(--tm-bad-text); }',
      '#' + PANEL_ID + ' .tfcc-tos { border-collapse: collapse; width: 100%; margin-bottom: var(--tfcc-gap); }',
      '#' + PANEL_ID + ' .tfcc-tos th, #' + PANEL_ID + ' .tfcc-tos td {',
      '  border: 1px solid var(--tm-border); padding: 4px 8px; text-align: left;',
      '  font-size: var(--tfcc-text-sm); vertical-align: top;',
      // Stated outright rather than inherited. Table cells are the most
      // heavily styled elements on any host page, so this is where a bare
      // element rule of Torn's is most likely to reach in.
      '  color: var(--tm-text); background: transparent; }',
      '#' + PANEL_ID + ' .tfcc-tos th { color: var(--tm-meta); font-weight: normal; white-space: nowrap; }',
      // Narrow screens are the primary target: this runs inside Torn PDA.
      '@media (max-width: 600px) {',
      '  #' + FALLBACK_ID + ' { right: 4px; bottom: 4px; width: calc(100vw - 8px); }',
      '  #' + PANEL_ID + ' { padding: 8px; }',
      '  #' + PANEL_ID + ' .tfcc-kv label { min-width: 0; flex-basis: 100%; }',
      '  #' + PANEL_ID + ' .tfcc-grow { flex-basis: 100%; }',
      '  #' + PANEL_ID + ' .tfcc-row { padding: var(--tfcc-gap-xs) var(--tfcc-gap-sm); }',
      '  #' + PANEL_ID + ' .tfcc-actions { gap: 3px; }',
      '  #' + PANEL_ID + ' .tfcc-actions button { padding: 1px 5px; }',
      '  #' + PANEL_ID + ' .tfcc-actions input, #' + PANEL_ID + ' .tfcc-actions select {',
      '    padding: 1px 4px; font-size: var(--tfcc-text-sm); max-width: 46%; }',
      '  #' + PANEL_ID + ' .tfcc-meta { gap: var(--tfcc-gap-sm); }',
      '}',
    ].join('\n');
  }

  // The one feature that has to name Torn's own elements, and the only one
  // allowed to. It is done as a stylesheet rather than by removing a node: a
  // wrong guess then costs nothing at all, where a wrong querySelector plus
  // .remove() could take a piece of Torn's page with it. If none of these
  // selectors match, the box simply stays visible, which is the documented
  // behaviour rather than a silent failure.
  var TORN_BOX_SELECTORS = Object.freeze([
    '#forums-page-wrap .subscribed-threads-wrap',
    '.subscribed-threads-wrap',
    '#subscribed-threads',
  ]);

  var HIDE_STYLE_ID = 'tfcc-hide-torn-box';

  function applyHideTornBox(doc) {
    if (!doc || typeof doc.getElementById !== 'function') return;
    var existing = doc.getElementById(HIDE_STYLE_ID);
    if (!state.settings.hideTornBox) {
      if (existing && typeof existing.remove === 'function') existing.remove();
      return;
    }
    if (existing) return;
    var style = doc.createElement('style');
    style.id = HIDE_STYLE_ID;
    style.setAttribute('id', HIDE_STYLE_ID);
    style.textContent = TORN_BOX_SELECTORS.join(',\n') + ' { display: none !important; }';
    var host = doc.head || doc.documentElement || doc.body;
    if (host && typeof host.appendChild === 'function') host.appendChild(style);
  }

  function injectStyleOnce(doc) {
    if (!doc || typeof doc.getElementById !== 'function') return;
    if (doc.getElementById(STYLE_ID)) return;
    var style = doc.createElement('style');
    style.id = STYLE_ID;
    style.setAttribute('id', STYLE_ID);
    style.textContent = panelStyleText();
    var host = doc.head || doc.documentElement || doc.body;
    if (host && typeof host.appendChild === 'function') host.appendChild(style);
  }

  // ---- panel model and rendering -----------------------------------------

  function loadingModel(now) {
    return {
      loading: true,
      view: 'threads',
      version: SCRIPT_VERSION,
      theme: 'dark',
      collapsed: false,
      takeover: false,
      notices: [],
      rows: [],
      now: now,
    };
  }

  function errorModel(reason, detail, now) {
    return {
      loading: false,
      fatal: { reason: reason, detail: detail },
      view: 'threads',
      version: SCRIPT_VERSION,
      theme: 'dark',
      collapsed: false,
      takeover: false,
      notices: [],
      rows: [],
      now: now,
    };
  }

  var noopHandlers = Object.freeze({});

  function buildPanelModel(now) {
    var s = state.settings;
    var rows = state.rows;
    var query = parseQuery(state.searchQuery);

    var visible = rows.filter(function (r) {
      if (r.archived && !r.pinned && r.unread === 0) return false;
      if (s.unreadOnly && r.unread === 0) return false;
      if (s.folderFilter && r.folderId !== s.folderFilter) return false;
      if (s.tagFilter && r.tags.indexOf(s.tagFilter) === -1) return false;
      return matchThread(r, query);
    });

    var totalUnread = 0;
    for (var i = 0; i < rows.length; i += 1) totalUnread += rows[i].unread;

    return {
      loading: false,
      version: SCRIPT_VERSION,
      view: s.view,
      theme: s.theme,
      collapsed: s.collapsed,
      takeover: s.takeover,
      sort: s.sort,
      unreadOnly: s.unreadOnly,
      folderFilter: s.folderFilter,
      tagFilter: s.tagFilter,
      hasKey: isKeyShaped(loadApiKey()),
      refreshing: state.refreshing,
      lastFetchedAt: state.feed.fetchedAt,
      lastError: state.lastError,
      notices: state.notices.slice(),
      folders: state.organizer.folders.slice(),
      tags: allTags(state.organizer),
      categories: state.feed.categories.slice(),
      rows: sortThreads(visible, s.sort),
      allRows: rows,
      totals: {
        threads: rows.length,
        subscribed: rows.filter(function (r) { return r.subscribed; }).length,
        unread: totalUnread,
        drafts: draftList(state.drafts).length,
      },
      catchUp: sortThreads(catchUpList(rows, state.organizer.lastCatchUpAt), 'activity'),
      lastCatchUpAt: state.organizer.lastCatchUpAt,
      drafts: draftList(state.drafts),
      searchQuery: state.searchQuery,
      searchResults: state.searchResults,
      deepBusy: state.deepBusy,
      deepProgress: state.deepProgress,
      cacheSize: postCacheSize(state.postCache),
      route: state.route,
      draftFocusId: state.draftFocusId,
      replyBoxFound: state.replyBoxFound,
      settings: {
        autoRefreshMs: s.autoRefreshMs,
        enrichBudget: s.enrichBudget,
        autosaveDrafts: s.autosaveDrafts,
        hideTornBox: s.hideTornBox,
        autoHideOnOpen: s.autoHideOnOpen,
        deepSearchPages: s.deepSearchPages,
      },
      now: now,
    };
  }

  function threadUrl(row) {
    return 'https://www.torn.com/forums.php#/p=threads&f=' + (row.forumId || 0)
      + '&t=' + row.numericId + '&b=0&a=0';
  }

  // Purpose: marks an anchor the panel itself rendered as a link to a thread,
  // so the panel's own click listener can recognise it (issue #8). It is our
  // attribute on our markup, not a selector against Torn's, so Torn changing
  // its page cannot break it. Read only by threadLinkOf.
  var THREAD_LINK_ATTR = 'data-tfcc-thread';
  // Anchors hold text only today; the margin covers a later <mark> or <span>.
  var THREAD_LINK_MAX_DEPTH = 4;

  function threadLinkAttr(id) {
    return ' ' + THREAD_LINK_ATTR + '="' + escapeHtml(String(id)) + '"';
  }

  // Finds the thread anchor a click landed on, or inside. Reads only the panel's
  // own nodes: the walk stops at the panel and after THREAD_LINK_MAX_DEPTH steps,
  // so nothing of Torn's is ever read (ADR 0001). Every step is null-guarded.
  function threadLinkOf(node, panel) {
    var n = node;
    for (var i = 0; n && i < THREAD_LINK_MAX_DEPTH; i += 1) {
      if (n === panel) return null;
      if (typeof n.getAttribute === 'function' && n.getAttribute(THREAD_LINK_ATTR) !== null) return n;
      n = n.parentNode;
    }
    return null;
  }

  function btn(action, label, extra) {
    return '<button type="button" data-act="' + escapeHtml(action) + '"'
      + (extra || '') + '>' + escapeHtml(label) + '</button>';
  }

  function renderNav(model) {
    var labels = { threads: 'Threads', catchup: 'Catch up', search: 'Search', drafts: 'Drafts', settings: 'Settings' };
    var out = ['<div class="tfcc-nav">'];
    for (var i = 0; i < VIEWS.length; i += 1) {
      var v = VIEWS[i];
      var count = '';
      if (v === 'catchup' && model.catchUp.length) count = ' (' + model.catchUp.length + ')';
      if (v === 'drafts' && model.totals.drafts) count = ' (' + model.totals.drafts + ')';
      out.push('<button type="button" data-act="view" data-view="' + v + '" aria-pressed="'
        + (model.view === v ? 'true' : 'false') + '">' + escapeHtml(labels[v] + count) + '</button>');
    }
    out.push('</div>');
    return out.join('');
  }

  function renderRow(row, model) {
    var out = ['<div class="tfcc-row" data-id="' + escapeHtml(row.id) + '">'];
    out.push('<div class="tfcc-row-main">');
    if (row.pinned) out.push('<span class="tfcc-pinned" title="Pinned">*</span>');
    out.push('<span class="tfcc-row-title"><a href="' + escapeHtml(threadUrl(row)) + '"'
      + threadLinkAttr(row.id) + '>'
      + escapeHtml(row.title) + '</a></span>');
    if (row.unread > 0) {
      out.push('<span class="tfcc-unread">' + formatCount(row.unread) + ' new</span>');
    }
    if (!row.subscribed) out.push('<span class="tfcc-note">not subscribed</span>');
    if (row.isLocked) out.push('<span class="tfcc-note">locked</span>');
    out.push('</div>');

    out.push('<div class="tfcc-meta">');
    out.push('<span title="Where the time came from: ' + escapeHtml(row.activitySource) + '">'
      + escapeHtml(formatRelativeTime(row.lastActivity, model.now)) + '</span>');
    out.push('<span>' + escapeHtml(row.forumName) + '</span>');
    if (row.authorName) out.push('<span>by ' + escapeHtml(row.authorName) + '</span>');
    if (row.folderName) out.push('<span>' + escapeHtml(row.folderName) + '</span>');
    if (row.priority !== 0) out.push('<span>priority ' + (row.priority > 0 ? '+' : '') + row.priority + '</span>');
    if (row.hasDraft) out.push('<span class="tfcc-tag">draft</span>');
    for (var i = 0; i < row.tags.length; i += 1) {
      out.push('<span class="tfcc-tag">' + escapeHtml(row.tags[i]) + '</span>');
    }
    out.push('</div>');

    if (row.note) out.push('<div class="tfcc-note">' + escapeHtml(row.note) + '</div>');

    out.push('<div class="tfcc-actions">');
    out.push(btn('pin', row.pinned ? 'Unpin' : 'Pin', ' data-id="' + escapeHtml(row.id) + '"'));
    out.push(btn('read', 'Mark read', ' data-id="' + escapeHtml(row.id) + '"'));
    out.push(btn('prio-up', 'Priority +', ' data-id="' + escapeHtml(row.id) + '"'));
    out.push(btn('prio-down', 'Priority -', ' data-id="' + escapeHtml(row.id) + '"'));
    out.push('<select data-act="folder" data-id="' + escapeHtml(row.id) + '">');
    out.push('<option value="">Unfiled</option>');
    for (var f = 0; f < model.folders.length; f += 1) {
      var fo = model.folders[f];
      out.push('<option value="' + escapeHtml(fo.id) + '"'
        + (row.folderId === fo.id ? ' selected' : '') + '>' + escapeHtml(fo.name) + '</option>');
    }
    out.push('</select>');
    out.push('<input type="text" data-act="tag-input" data-id="' + escapeHtml(row.id)
      + '" placeholder="add tag" size="8">');
    // A note is edited in place rather than behind a button, because a button
    // needs somewhere to put the editor and every such place is another piece
    // of view state to get wrong.
    out.push('<input type="text" data-act="note-input" data-id="' + escapeHtml(row.id)
      + '" value="' + escapeHtml(row.note) + '" placeholder="note" size="14">');
    out.push(btn('draft', row.hasDraft ? 'Edit draft' : 'Draft', ' data-id="' + escapeHtml(row.id) + '"'));
    out.push(btn('archive', row.archived ? 'Unarchive' : 'Archive', ' data-id="' + escapeHtml(row.id) + '"'));
    out.push('</div>');
    out.push('</div>');
    return out.join('');
  }

  function renderThreadsView(model) {
    var out = ['<div class="tfcc-bar">'];
    out.push('<input class="tfcc-grow" type="search" data-act="filter" value="'
      + escapeHtml(model.searchQuery) + '" placeholder="filter: words, by:player, tag:x, is:unread">');
    out.push('<select data-act="sort">');
    for (var i = 0; i < SORT_MODES.length; i += 1) {
      out.push('<option value="' + SORT_MODES[i] + '"'
        + (model.sort === SORT_MODES[i] ? ' selected' : '') + '>'
        + escapeHtml(SORT_LABELS[SORT_MODES[i]]) + '</option>');
    }
    out.push('</select>');
    out.push('<select data-act="folder-filter"><option value="">All folders</option>');
    for (var f = 0; f < model.folders.length; f += 1) {
      out.push('<option value="' + escapeHtml(model.folders[f].id) + '"'
        + (model.folderFilter === model.folders[f].id ? ' selected' : '') + '>'
        + escapeHtml(model.folders[f].name) + '</option>');
    }
    out.push('</select>');
    if (model.tags.length) {
      out.push('<select data-act="tag-filter"><option value="">All tags</option>');
      for (var t = 0; t < model.tags.length; t += 1) {
        out.push('<option value="' + escapeHtml(model.tags[t].tag) + '"'
          + (model.tagFilter === model.tags[t].tag ? ' selected' : '') + '>'
          + escapeHtml(model.tags[t].tag + ' (' + model.tags[t].count + ')') + '</option>');
      }
      out.push('</select>');
    }
    out.push('<button type="button" data-act="unread-only" aria-pressed="'
      + (model.unreadOnly ? 'true' : 'false') + '">Unread only</button>');
    out.push('</div>');

    if (!model.rows.length) {
      out.push('<div class="tfcc-empty">Nothing matches. '
        + (model.totals.subscribed ? 'Try clearing the filters.' : 'Refresh to load your subscribed threads.')
        + '</div>');
    } else {
      out.push('<div class="tfcc-rows">');
      for (var r = 0; r < model.rows.length; r += 1) out.push(renderRow(model.rows[r], model));
      out.push('</div>');
    }
    return out.join('');
  }

  function renderCatchUpView(model) {
    var out = [];
    out.push('<div class="tfcc-bar">');
    out.push('<span class="tfcc-note">Since ' + escapeHtml(model.lastCatchUpAt
      ? formatAbsoluteTime(model.lastCatchUpAt) : 'your first run') + '</span>');
    out.push(btn('markall', 'Mark all read'));
    out.push(btn('catchup-done', 'Set catch-up point to now'));
    out.push('</div>');
    out.push('<p class="tfcc-note">Marking read here hides a thread from this list. '
      + 'It cannot clear Torn\'s own new-post counter, which only clears when you open the thread.</p>');
    if (!model.catchUp.length) {
      out.push('<div class="tfcc-empty">Nothing new. You are caught up.</div>');
      return out.join('');
    }
    var byFolder = {};
    for (var i = 0; i < model.catchUp.length; i += 1) {
      var k = model.catchUp[i].folderName || 'Unfiled';
      (byFolder[k] = byFolder[k] || []).push(model.catchUp[i]);
    }
    var names = Object.keys(byFolder).sort();
    for (var n = 0; n < names.length; n += 1) {
      out.push('<div class="tfcc-section"><h4>' + escapeHtml(names[n])
        + ' (' + byFolder[names[n]].length + ')</h4><div class="tfcc-rows">');
      for (var j = 0; j < byFolder[names[n]].length; j += 1) {
        out.push(renderRow(byFolder[names[n]][j], model));
      }
      out.push('</div></div>');
    }
    return out.join('');
  }

  function renderSearchView(model) {
    var out = [];
    out.push('<div class="tfcc-section"><h4>Search</h4>');
    out.push('<div class="tfcc-bar">');
    out.push('<input class="tfcc-grow" type="search" data-act="filter" value="'
      + escapeHtml(model.searchQuery)
      + '" placeholder="' + escapeHtml('words, "a phrase", by:player, tag:x, folder:y, is:unread, -exclude') + '">');
    out.push(btn('deep', model.deepBusy ? 'Searching...' : 'Search inside posts'));
    // Deliberately an anchor, not a button with a handler that assigns
    // location.href. Both load the same page, but a link makes the request
    // unambiguously the user's own click: the script initiates no navigation
    // and issues no non-API request to Torn at all.
    out.push('<a class="tfcc-linkbtn" href="' + escapeHtml(buildNativeSearchUrl(model.searchQuery, 0))
      + '">Search on Torn</a>');
    out.push('</div>');
    out.push('<p class="tfcc-note">Filtering searches titles, authors, forums, your notes and tags. '
      + 'Searching inside posts fetches up to ' + model.settings.deepSearchPages
      + ' pages for each of the threads currently listed, then keeps them for next time. '
      + 'Search on Torn hands the same query to Torn\'s own forum search, which understands by:player '
      + 'but never shows you a box for it.</p>');
    if (model.deepBusy && model.deepProgress) {
      out.push('<p class="tfcc-warn">Fetching ' + model.deepProgress.done + ' of '
        + model.deepProgress.total + ' threads.</p>');
    }
    out.push('</div>');

    var matched = model.rows;
    out.push('<div class="tfcc-section"><h4>Threads (' + matched.length + ')</h4>');
    if (!matched.length) out.push('<div class="tfcc-empty">No thread matches.</div>');
    else {
      out.push('<div class="tfcc-rows">');
      for (var i = 0; i < matched.length && i < 50; i += 1) out.push(renderRow(matched[i], model));
      out.push('</div>');
    }
    out.push('</div>');

    if (model.searchResults && model.searchResults.mode === 'deep') {
      out.push('<div class="tfcc-section"><h4>Posts ('
        + model.searchResults.posts.length + ')</h4>');
      if (!model.searchResults.posts.length) {
        out.push('<div class="tfcc-empty">No post matches in the cached pages.</div>');
      }
      for (var p = 0; p < model.searchResults.posts.length; p += 1) {
        var hit = model.searchResults.posts[p];
        out.push('<div class="tfcc-hit"><div><a href="https://www.torn.com/forums.php#/p=threads&t='
          + hit.threadId + '&b=0&a=0"' + threadLinkAttr(hit.threadId) + '>' + escapeHtml(hit.threadTitle) + '</a> '
          + '<span class="tfcc-note">' + escapeHtml(hit.authorName) + ', '
          + escapeHtml(formatRelativeTime(hit.at, model.now)) + '</span></div>');
        out.push('<div class="tfcc-hit-text">' + escapeHtml(hit.text.slice(0, 400)) + '</div></div>');
      }
      out.push('</div>');
    }
    out.push('<p class="tfcc-note">Cached posts: ' + model.cacheSize.posts + ' across '
      + model.cacheSize.threads + ' ' + plural(model.cacheSize.threads, 'thread')
      + ', about ' + escapeHtml(formatBytes(model.cacheSize.bytes)) + '.</p>');
    return out.join('');
  }

  function renderDraftsView(model) {
    var out = [];
    // The thread the user asked to write about wins over the one they happen to
    // be looking at, so the Draft button on a row works from anywhere.
    var current = model.draftFocusId
      || (model.route && model.route.isThread ? String(model.route.threadId) : null);
    if (current) {
      out.push('<div class="tfcc-section"><h4>Draft for this thread</h4>');
      var existing = '';
      for (var d = 0; d < model.drafts.length; d += 1) {
        if (model.drafts[d].threadId === current) existing = model.drafts[d].text;
      }
      out.push('<textarea class="tfcc-draft" data-act="draft-text" data-id="' + escapeHtml(current)
        + '">' + escapeHtml(existing) + '</textarea>');
      out.push('<div class="tfcc-actions">');
      out.push(btn('draft-save', 'Save draft', ' data-id="' + escapeHtml(current) + '"'));
      if (model.replyBoxFound) {
        out.push(btn('draft-insert', 'Insert into reply box', ' data-id="' + escapeHtml(current) + '"'));
      } else {
        out.push(btn('draft-copy', 'Copy', ' data-id="' + escapeHtml(current) + '"'));
      }
      out.push(btn('draft-delete', 'Delete', ' data-id="' + escapeHtml(current) + '"'));
      out.push('</div>');
      if (!model.replyBoxFound) {
        out.push('<p class="tfcc-note">No reply box was found on this page, so Insert is unavailable. '
          + 'Copy puts the draft on your clipboard instead.</p>');
      }
      out.push('</div>');
    } else {
      out.push('<p class="tfcc-note">Open a thread to write a draft for it.</p>');
    }

    out.push('<div class="tfcc-section"><h4>All drafts (' + model.drafts.length + ')</h4>');
    if (!model.drafts.length) out.push('<div class="tfcc-empty">No saved drafts.</div>');
    for (var i = 0; i < model.drafts.length; i += 1) {
      var dr = model.drafts[i];
      out.push('<div class="tfcc-hit"><div><a href="https://www.torn.com/forums.php#/p=threads&t='
        + escapeHtml(dr.threadId) + '&b=0&a=0"' + threadLinkAttr(dr.threadId) + '>'
        + escapeHtml(dr.title || ('Thread ' + dr.threadId)) + '</a> '
        + '<span class="tfcc-note">' + escapeHtml(formatRelativeTime(dr.updatedAt, model.now))
        + '</span></div>');
      out.push('<div class="tfcc-hit-text">' + escapeHtml(dr.text.slice(0, 300)) + '</div>');
      out.push('<div class="tfcc-actions">'
        + btn('draft-copy', 'Copy', ' data-id="' + escapeHtml(dr.threadId) + '"')
        + btn('draft-delete', 'Delete', ' data-id="' + escapeHtml(dr.threadId) + '"')
        + '</div></div>');
    }
    out.push('</div>');
    return out.join('');
  }

  function renderSettingsView(model) {
    var out = [];
    out.push('<div class="tfcc-section"><h4>Torn API key</h4>');
    out.push('<p class="tfcc-note">This script needs a key that can read your subscribed threads. On Torn, '
      + 'go to Settings, API Key, and create a <strong>Minimal Access</strong> key. A '
      + '<strong>Limited Access</strong> key also works but is not needed. A '
      + '<strong>Public Only</strong> key does not.</p>');
    // Torn's API terms require this to be stated clearly and visibly wherever
    // the user provides their key, in this table's form. It is rendered here
    // rather than buried in a readme because that is where the terms put it.
    out.push('<table class="tfcc-tos"><tbody>');
    out.push('<tr><th>Who can see your data</th><td>Nobody. It never leaves this device.</td></tr>');
    out.push('<tr><th>What it is used for</th><td>Public community tool: listing and organising the '
      + 'forum threads you subscribe to.</td></tr>');
    out.push('<tr><th>Storage</th><td>Key and cached thread data are stored in this browser only. '
      + 'Not shared, not uploaded, not included in an export.</td></tr>');
    out.push('<tr><th>Access level required</th><td>Minimal Access. Limited Access '
      + 'also works but is not needed. Public Only does not.</td></tr>');
    out.push('<tr><th>Requests made</th><td>GET only, to api.torn.com only. Never posts, replies, '
      + 'subscribes or changes anything on your account.</td></tr>');
    out.push('</tbody></table>');
    out.push('<div class="tfcc-kv"><label for="tfcc-key">API key</label>'
      + '<input id="tfcc-key" class="tfcc-grow" type="password" data-act="key-input" placeholder="'
      + (model.hasKey ? 'saved' : '16 letters and digits') + '">'
      + btn('key-save', 'Save') + btn('key-clear', 'Clear') + '</div>');
    out.push('<p class="tfcc-note">' + (model.hasKey ? 'A key is saved.' : 'No key saved yet.') + '</p>');
    // A plain anchor the user clicks, never a scripted navigation or a
    // request: Torn's own page creates the key, and only after the user
    // confirms it there. noopener keeps Torn's tab from reaching back into
    // this one.
    out.push('<div class="tfcc-actions"><a class="tfcc-linkbtn" href="' + escapeHtml(buildCustomKeyUrl())
      + '" target="_blank" rel="noopener noreferrer">Create a custom key on Torn</a></div>');
    out.push('<p class="tfcc-note">This opens Torn\'s key page in a new tab with only the selections this '
      + 'script uses. You confirm the key there, then paste it here.</p>');
    out.push('</div>');

    out.push('<div class="tfcc-section"><h4>Refreshing</h4>');
    out.push('<div class="tfcc-kv"><label for="tfcc-auto">Auto refresh</label>'
      + '<select id="tfcc-auto" data-act="auto-refresh">'
      + [[0, 'Off'], [120000, 'Every 2 minutes'], [300000, 'Every 5 minutes'], [900000, 'Every 15 minutes']]
        .map(function (o) {
          return '<option value="' + o[0] + '"'
            + (model.settings.autoRefreshMs === o[0] ? ' selected' : '') + '>' + o[1] + '</option>';
        }).join('')
      + '</select></div>');
    out.push('<div class="tfcc-kv"><label for="tfcc-budget">Activity lookups per refresh</label>'
      + '<input id="tfcc-budget" type="number" min="0" max="' + MAX_ENRICH_BUDGET
      + '" value="' + model.settings.enrichBudget + '" data-act="enrich-budget"></div>');
    out.push('<p class="tfcc-note">A refresh always makes two requests. Each activity lookup adds one more, '
      + 'and only runs for a thread that has unread posts and no recent time. The script keeps itself '
      + 'under 40 requests a minute regardless.</p>');
    out.push('</div>');

    out.push('<div class="tfcc-section"><h4>Appearance</h4>');
    out.push('<div class="tfcc-kv"><label for="tfcc-theme">Theme</label>'
      + '<select id="tfcc-theme" data-act="theme">'
      + THEMES.map(function (t) {
        var label = t === 'match' ? 'Match Torn' : (t.charAt(0).toUpperCase() + t.slice(1));
        return '<option value="' + t + '"' + (model.theme === t ? ' selected' : '') + '>' + label + '</option>';
      }).join('')
      + '</select></div>');
    out.push('<div class="tfcc-kv"><label for="tfcc-hide">Hide Torn\'s own subscribed box</label>'
      + '<input id="tfcc-hide" type="checkbox" data-act="hide-torn-box"'
      + (model.settings.hideTornBox ? ' checked' : '') + '></div>');
    out.push('<div class="tfcc-kv"><label for="tfcc-autosave">Autosave the reply box as a draft</label>'
      + '<input id="tfcc-autosave" type="checkbox" data-act="autosave"'
      + (model.settings.autosaveDrafts ? ' checked' : '') + '></div>');
    out.push('<div class="tfcc-kv"><label for="tfcc-autohide">Hide the panel when I open a thread</label>'
      + '<input id="tfcc-autohide" type="checkbox" data-act="auto-hide"'
      + (model.settings.autoHideOnOpen ? ' checked' : '') + '></div>');
    out.push('<p class="tfcc-note">Only thread links in this panel do this, and only a plain click. '
      + 'Opening a link in a new tab, or following links on the Torn page itself, leaves the panel '
      + 'as it is. Press Show to bring it back.</p>');
    out.push('</div>');

    out.push('<div class="tfcc-section"><h4>Folders</h4>');
    out.push('<p class="tfcc-note">A folder can claim a forum, and new subscriptions from that forum '
      + 'file themselves into it. Filing a thread by hand always wins over a rule.</p>');
    for (var i = 0; i < model.folders.length; i += 1) {
      var f = model.folders[i];
      out.push('<div class="tfcc-kv"><label>' + escapeHtml(f.name) + '</label>');
      out.push('<select data-act="folder-forum" data-id="' + escapeHtml(f.id) + '">');
      out.push('<option value="">Claim a forum...</option>');
      for (var c = 0; c < model.categories.length; c += 1) {
        var cat = model.categories[c];
        out.push('<option value="' + cat.id + '"'
          + (f.forumIds.indexOf(cat.id) !== -1 ? ' selected' : '') + '>' + escapeHtml(cat.title) + '</option>');
      }
      out.push('</select>');
      out.push(btn('folder-delete', 'Delete', ' data-id="' + escapeHtml(f.id) + '" class="tfcc-danger"'));
      out.push('</div>');
    }
    out.push('<div class="tfcc-kv"><label for="tfcc-newfolder">New folder</label>'
      + '<input id="tfcc-newfolder" type="text" data-act="folder-name" placeholder="name">'
      + btn('folder-add', 'Add') + '</div>');
    if (!model.categories.length) {
      out.push('<p class="tfcc-note">Forum names load on the first successful refresh.</p>');
    }
    out.push('</div>');

    out.push('<div class="tfcc-section"><h4>Backup</h4>');
    out.push('<div class="tfcc-actions">' + btn('export', 'Copy export string')
      + btn('import', 'Import from clipboard text') + '</div>');
    out.push('<textarea class="tfcc-draft" data-act="import-text" placeholder="Paste an export string here, then press Import"></textarea>');
    out.push('<p class="tfcc-note">An export carries folders, tags, pins, priorities, notes, read markers '
      + 'and drafts. It never carries your API key or the post cache.</p>');
    out.push('</div>');

    out.push('<div class="tfcc-section"><h4>Storage</h4>');
    out.push('<p class="tfcc-note">Post cache: ' + model.cacheSize.posts + ' '
      + plural(model.cacheSize.posts, 'post') + ', '
      + escapeHtml(formatBytes(model.cacheSize.bytes)) + '.</p>');
    out.push('<div class="tfcc-actions">'
      + btn('clear-cache', 'Clear post cache')
      + btn('reset-organizer', 'Reset folders and tags', ' class="tfcc-danger"')
      + btn('reset-all', 'Reset everything', ' class="tfcc-danger"')
      + btn('debug', 'Copy debug report')
      + '</div>');
    out.push('<p class="tfcc-note">A debug report carries the script version, the transport in use, '
      + 'counts and the last error. It never carries your key, your drafts, your notes or any post text.</p>');
    out.push('</div>');

    out.push('<p class="tfcc-note">Torn Forum Command Center ' + escapeHtml(model.version)
      + '. Reads only. It never posts, replies, subscribes or changes anything on your account.</p>');
    return out.join('');
  }

  function panelHtml(model) {
    if (model.loading) {
      return '<div class="tfcc-head"><span class="tfcc-title">Forum Command Center</span></div>'
        + '<div class="tfcc-empty">Loading your subscribed threads...</div>';
    }
    if (model.fatal) {
      return '<div class="tfcc-head"><span class="tfcc-title">Forum Command Center</span></div>'
        + '<div class="tfcc-error">' + escapeHtml(model.fatal.detail) + '</div>'
        + '<div class="tfcc-actions">' + btn('refresh', 'Try again') + '</div>';
    }

    var out = [];
    out.push('<div class="tfcc-head">');
    out.push('<span class="tfcc-title">Forum Command Center</span>');
    if (model.totals.unread > 0) {
      out.push('<span class="tfcc-badge">' + formatCount(model.totals.unread) + ' new</span>');
    }
    out.push('<span class="tfcc-note">' + model.totals.subscribed + ' subscribed</span>');
    out.push(btn('refresh', model.refreshing ? 'Refreshing...' : 'Refresh'));
    out.push('<button type="button" data-act="takeover" aria-pressed="'
      + (model.takeover ? 'true' : 'false') + '">' + (model.takeover ? 'Shrink' : 'Expand') + '</button>');
    out.push(btn('collapse', model.collapsed ? 'Show' : 'Hide'));
    out.push('</div>');

    if (model.collapsed) return out.join('');

    for (var n = 0; n < model.notices.length; n += 1) {
      out.push('<div class="tfcc-' + (model.notices[n].kind === 'error' ? 'error' : 'warn') + '">'
        + escapeHtml(model.notices[n].text) + '</div>');
    }
    if (model.lastError) {
      out.push('<div class="tfcc-error">' + escapeHtml(model.lastError.detail) + '</div>');
    }
    if (!model.hasKey) {
      out.push('<div class="tfcc-warn">No API key yet. Add one in Settings to load your subscribed threads.</div>');
    }

    out.push(renderNav(model));

    if (model.view === 'catchup') out.push(renderCatchUpView(model));
    else if (model.view === 'search') out.push(renderSearchView(model));
    else if (model.view === 'drafts') out.push(renderDraftsView(model));
    else if (model.view === 'settings') out.push(renderSettingsView(model));
    else out.push(renderThreadsView(model));

    if (model.lastFetchedAt) {
      out.push('<p class="tfcc-note">Updated ' + escapeHtml(formatRelativeTime(model.lastFetchedAt, model.now))
        + '.</p>');
    }
    return out.join('');
  }

  // Mount candidates, most specific first. Each is a guess against markup that
  // research could not confirm, which is exactly why an owned fixed fallback
  // exists: a wrong guess costs placement, never the script.
  var MOUNT_SELECTORS = Object.freeze([
    '#forums-page-wrap',
    '.forums-main-wrap',
    '#mainContainer .content-wrapper',
    '#mainContainer',
    '.content-wrapper',
  ]);

  function findMountPoint(doc) {
    if (!doc) return null;
    for (var i = 0; i < MOUNT_SELECTORS.length; i += 1) {
      var el = null;
      try { el = doc.querySelector(MOUNT_SELECTORS[i]); } catch (e) { el = null; }
      if (el && el.isConnected !== false) return { host: el, owned: false };
    }
    var existing = doc.getElementById(FALLBACK_ID);
    if (existing && existing.isConnected !== false) return { host: existing, owned: true };
    if (!doc.body || typeof doc.body.appendChild !== 'function') return null;
    var wrap = doc.createElement('div');
    wrap.id = FALLBACK_ID;
    wrap.setAttribute('id', FALLBACK_ID);
    doc.body.appendChild(wrap);
    return { host: wrap, owned: true };
  }

  var delegated = null;

  // An editable element inside the panel currently has the caret. The value the
  // user is typing is not in the model yet, so re-rendering would throw away
  // both the caret and the half-typed text.
  function panelHasEditableFocus(doc) {
    try {
      var active = doc.activeElement;
      if (!active) return false;
      var tag = String(active.tagName || '').toLowerCase();
      if (tag !== 'input' && tag !== 'textarea' && tag !== 'select') return false;
      var panel = doc.getElementById(PANEL_ID);
      if (!panel || typeof panel.contains !== 'function') return false;
      return panel.contains(active);
    } catch (e) {
      return false;
    }
  }

  function renderPanel(doc, win, model, handlers, force) {
    injectStyleOnce(doc);
    var mount = findMountPoint(doc);
    if (!mount) return null;

    var panel = doc.getElementById(PANEL_ID);
    if (!panel || panel.isConnected === false) {
      panel = doc.createElement('div');
      panel.id = PANEL_ID;
      panel.setAttribute('id', PANEL_ID);
      if (mount.owned) mount.host.appendChild(panel);
      else if (typeof mount.host.insertBefore === 'function' && mount.host.firstChild) {
        mount.host.insertBefore(panel, mount.host.firstChild);
      } else {
        mount.host.appendChild(panel);
      }
    }

    applyThemeClass(doc, win);
    panel.classList.toggle('tfcc-takeover', !!model.takeover);

    var html = panelHtml(model);

    // Writing the same string still destroys every node under it, taking the
    // caret, the selection and any half-typed value with them. innerHTML is not
    // read back for the comparison because a browser normalises what it returns.
    if (panel.__tfccHtml !== html) {
      if (!force && panelHasEditableFocus(doc)) {
        // Deferred, not dropped: the next draw renders current state anyway.
        state.pendingRedraw = true;
      } else {
        panel.__tfccHtml = html;
        panel.innerHTML = html;
        state.pendingRedraw = false;
      }
    }

    // One delegated listener for the whole panel: innerHTML replaces every node
    // on each render, so per-element listeners would leak on every redraw.
    if (handlers && handlers !== noopHandlers && delegated !== panel) {
      delegated = panel;
      panel.addEventListener('click', function (ev) {
        var t = ev && ev.target;
        // A thread link the panel rendered. The browser follows it; this only
        // gives the auto-hide setting a chance to persist first (issue #8).
        var link = threadLinkOf(t, panel);
        if (link) {
          if (typeof handlers.onThreadLink === 'function') {
            handlers.onThreadLink(link, {
              button: ev.button, ctrlKey: !!ev.ctrlKey, metaKey: !!ev.metaKey,
              shiftKey: !!ev.shiftKey, altKey: !!ev.altKey, defaultPrevented: !!ev.defaultPrevented,
            });
          }
          return;
        }
        var act = t && t.getAttribute ? t.getAttribute('data-act') : null;
        if (!act || typeof handlers.onAction !== 'function') return;
        handlers.onAction(act, t);
      });
      panel.addEventListener('change', function (ev) {
        var t = ev && ev.target;
        var act = t && t.getAttribute ? t.getAttribute('data-act') : null;
        if (!act || typeof handlers.onChange !== 'function') return;
        handlers.onChange(act, t);
      });
      // An update deferred while the user was typing has to arrive eventually.
      // Waiting a tick lets focus settle first, so this does not fire while the
      // caret is simply moving from one field to the next.
      panel.addEventListener('focusout', function () {
        if (!state.pendingRedraw) return;
        setTimeout(function () {
          if (!state.pendingRedraw) return;
          if (panelHasEditableFocus(doc)) return;
          draw(doc, win, handlers, true);
        }, 0);
      });
    }
    return panel;
  }

  function unmountPanel(doc) {
    if (!doc || typeof doc.getElementById !== 'function') return;
    var panel = doc.getElementById(PANEL_ID);
    if (panel && typeof panel.remove === 'function') panel.remove();
    var fb = doc.getElementById(FALLBACK_ID);
    if (fb && typeof fb.remove === 'function') fb.remove();
    delegated = null;
    state.mounted = false;
  }

  // ---- debug report ------------------------------------------------------

  function gatherDebugContext() {
    var t = ambientTransports();
    return {
      version: SCRIPT_VERSION,
      transport: transportName(t) || 'none',
      hasKey: isKeyShaped(loadApiKey()),
      route: state.route ? { view: state.route.view, forumId: state.route.forumId, isThread: state.route.isThread } : null,
      counts: {
        subscribed: state.feed.subscribed.length,
        activity: state.feed.activity.length,
        categories: state.feed.categories.length,
        organizerThreads: Object.keys(state.organizer.threads).length,
        folders: state.organizer.folders.length,
        drafts: Object.keys(state.drafts.byThread).length,
        cachedPosts: postCacheSize(state.postCache).posts,
      },
      lastFetchedAt: state.feed.fetchedAt,
      lastError: state.lastError ? { reason: state.lastError.reason, detail: state.lastError.detail } : null,
      mounted: state.mounted,
      replyBoxFound: state.replyBoxFound,
    };
  }

  // Deliberately a whitelist of scalars. Nothing here reads a draft, a note, a
  // post body, a thread title or the key, so no future field can leak one by
  // being added to state.
  function buildDebugReport(ctx) {
    var c = ctx || gatherDebugContext();
    var lines = [
      'Torn Forum Command Center debug report',
      'version: ' + c.version,
      'transport: ' + c.transport,
      'api key present: ' + (c.hasKey ? 'yes' : 'no'),
      'route view: ' + (c.route ? String(c.route.view) : 'none'),
      'route forum: ' + (c.route ? String(c.route.forumId) : 'none'),
      'on a thread: ' + (c.route && c.route.isThread ? 'yes' : 'no'),
      'mounted: ' + (c.mounted ? 'yes' : 'no'),
      'reply box found: ' + (c.replyBoxFound ? 'yes' : 'no'),
      'subscribed rows: ' + c.counts.subscribed,
      'activity rows: ' + c.counts.activity,
      'categories: ' + c.counts.categories,
      'organizer threads: ' + c.counts.organizerThreads,
      'folders: ' + c.counts.folders,
      'drafts: ' + c.counts.drafts,
      'cached posts: ' + c.counts.cachedPosts,
      'last fetch age ms: ' + (c.lastFetchedAt ? 'set' : 'never'),
      'last error: ' + (c.lastError ? (c.lastError.reason + ' - ' + c.lastError.detail) : 'none'),
    ];
    return lines.join('\n');
  }

  // ---- lifecycle ---------------------------------------------------------

  function whenDocumentReady(doc, win, onReady) {
    var finished = false;
    var timer = null;
    var polls = 0;

    function hasUsableDom() {
      try { return !!(doc && doc.documentElement && doc.body); } catch (e) { return false; }
    }

    function cleanup() {
      if (timer !== null) { clearTimeout(timer); timer = null; }
      if (doc && typeof doc.removeEventListener === 'function') doc.removeEventListener('DOMContentLoaded', check);
      if (win && typeof win.removeEventListener === 'function') win.removeEventListener('load', check);
    }

    function finish() {
      if (finished) return;
      finished = true;
      cleanup();
      try { onReady(); } catch (e) { /* startup failures must not escape onto Torn's page */ }
    }

    function check() {
      if (finished) return;
      if (hasUsableDom()) { finish(); return; }
      if (polls >= DOM_READY_MAX_POLLS) { finished = true; cleanup(); return; }
      if (timer === null) {
        polls += 1;
        timer = setTimeout(function () { timer = null; check(); }, DOM_READY_POLL_MS);
      }
    }

    if (hasUsableDom()) { finish(); return; }
    if (doc && typeof doc.addEventListener === 'function') doc.addEventListener('DOMContentLoaded', check);
    if (win && typeof win.addEventListener === 'function') win.addEventListener('load', check);
    check();
  }

  // True when every record came from something this script owns. Anything from
  // Torn's own tree is real navigation and must still get through.
  function isOwnMutation(doc, records) {
    try {
      if (!records || !records.length) return false;
      var owned = [PANEL_ID, FALLBACK_ID, STYLE_ID, HIDE_STYLE_ID]
        .map(function (id) { return doc.getElementById(id); })
        .filter(Boolean);
      if (!owned.length) return false;

      for (var i = 0; i < records.length; i += 1) {
        var target = records[i] && records[i].target;
        if (!target) return false;
        var inside = false;
        for (var j = 0; j < owned.length; j += 1) {
          if (owned[j] === target
            || (typeof owned[j].contains === 'function' && owned[j].contains(target))) {
            inside = true;
            break;
          }
        }
        if (!inside) return false;
      }
      return true;
    } catch (e) {
      return false;
    }
  }

  function observeNavigation(doc, win, onRoute) {
    if (!win || win[NAV_FLAG]) return;
    if (!doc || !doc.documentElement) return;
    win[NAV_FLAG] = true;

    var timer = null;
    function schedule() {
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(function () { timer = null; try { onRoute(); } catch (e) { /* never escape */ } }, NAV_DEBOUNCE_MS);
    }

    if (typeof win.addEventListener === 'function') {
      win.addEventListener('hashchange', schedule);
      win.addEventListener('popstate', schedule);
    }

    // History patching is defensive hardening. It must never be the reason the
    // panel fails to appear, so a hostile or frozen history is swallowed.
    try {
      var h = win.history;
      if (h && typeof h.pushState === 'function') {
        var push = h.pushState;
        h.pushState = function () { var r = push.apply(this, arguments); schedule(); return r; };
      }
      if (h && typeof h.replaceState === 'function') {
        var replace = h.replaceState;
        h.replaceState = function () { var r = replace.apply(this, arguments); schedule(); return r; };
      }
    } catch (e) { /* keep going without history hooks */ }

    try {
      if (typeof MutationObserver === 'function') {
        var mo = new MutationObserver(function (records) {
          // Without this filter the script feeds itself: the observer watches
          // documentElement with subtree true, renderPanel writes
          // panel.innerHTML, the panel is inside that subtree, so every render
          // schedules another one - forever, every debounce interval. The
          // visible result is that no text box can hold a caret and a click
          // lands on a node that has already been replaced.
          if (isOwnMutation(doc, records)) return;
          schedule();
        });
        mo.observe(doc.documentElement, { childList: true, subtree: true });
      }
    } catch (e2) { /* keep going without the observer */ }
  }

  // ---- wiring ------------------------------------------------------------

  function copyText(doc, win, text) {
    try {
      if (win && win.navigator && win.navigator.clipboard && typeof win.navigator.clipboard.writeText === 'function') {
        win.navigator.clipboard.writeText(text);
        return { ok: true };
      }
    } catch (e) { /* fall through to the textarea path */ }
    try {
      var ta = doc.createElement('textarea');
      ta.value = text;
      doc.body.appendChild(ta);
      if (typeof ta.select === 'function') ta.select();
      var done = typeof doc.execCommand === 'function' ? doc.execCommand('copy') : false;
      ta.remove();
      return { ok: !!done };
    } catch (e2) {
      return { ok: false };
    }
  }

  // Every asynchronous redraw goes through here. A refresh takes seconds, and
  // the user can leave the forums in that time; drawing unconditionally would
  // mount the panel onto whatever page they went to.
  function drawIfStillHere(doc, win, handlers) {
    if (!isForumsPage(win.location)) return;
    draw(doc, win, handlers);
  }

  function draw(doc, win, handlers, force) {
    var now = Date.now();
    state.route = parseForumRoute(win.location);
    state.replyBoxFound = !!findReplyBox(doc);
    attachAutosave(doc, win);
    renderPanel(doc, win, buildPanelModel(now), handlers, force);
    state.mounted = true;
  }

  function makeHandlers(doc, win) {
    function redraw() { draw(doc, win, handlers, true); }

    function idOf(el) { return el && el.getAttribute ? el.getAttribute('data-id') : null; }

    function valueOf(act) {
      var el = null;
      try { el = doc.querySelector('[data-act="' + act + '"]'); } catch (e) { el = null; }
      return el && el.value !== undefined ? String(el.value) : '';
    }

    var handlers = {
      // Not an act === case: a thread link is navigation the browser performs,
      // not a control, so tests/handlers.test.js does not pair it.
      onThreadLink: function (link, click) {
        if (!isPlainActivation(click)) return;
        var next = autoHideSettings(state.settings);
        if (next === state.settings) return;
        state.settings = next;
        persist('settings');
        // Deferred: redrawing now would replace the anchor while its click is
        // still being dispatched. It also covers a click on the thread already
        // open, where no hashchange will ever come.
        setTimeout(function () { if (isForumsPage(win.location)) redraw(); }, 0);
      },
      onAction: function (act, el) {
        var now = Date.now();
        var id = idOf(el);
        if (act === 'refresh') {
          state.notices = [];
          refreshAll(now).then(function () { if (isForumsPage(win.location)) redraw(); });
          redraw();
          return;
        }
        if (act === 'view') {
          var v = el.getAttribute('data-view');
          if (VIEWS.indexOf(v) !== -1) { state.settings.view = v; persist('settings'); }
          redraw(); return;
        }
        if (act === 'collapse') { state.settings.collapsed = !state.settings.collapsed; persist('settings'); redraw(); return; }
        if (act === 'takeover') { state.settings.takeover = !state.settings.takeover; persist('settings'); redraw(); return; }
        if (act === 'unread-only') { state.settings.unreadOnly = !state.settings.unreadOnly; persist('settings'); redraw(); return; }
        if (act === 'pin' && id) { state.organizer = togglePin(state.organizer, id); persist('organizer'); recompute(now); redraw(); return; }
        if (act === 'read' && id) {
          var row = state.rows.filter(function (r) { return r.id === id; })[0];
          state.organizer = markRead(state.organizer, id, row ? row.postsTotal : 0, now);
          persist('organizer'); recompute(now); redraw(); return;
        }
        if ((act === 'prio-up' || act === 'prio-down') && id) {
          var cur = state.organizer.threads[id] ? state.organizer.threads[id].priority : 0;
          state.organizer = setPriority(state.organizer, id, cur + (act === 'prio-up' ? 1 : -1));
          persist('organizer'); recompute(now); redraw(); return;
        }
        if (act === 'archive' && id) {
          var e = state.organizer.threads[id] || normaliseThreadEntry(null);
          state.organizer.threads[id] = Object.assign({}, e, { archived: !e.archived });
          persist('organizer'); recompute(now); redraw(); return;
        }
        if (act === 'markall') {
          for (var i = 0; i < state.rows.length; i += 1) {
            state.organizer = markRead(state.organizer, state.rows[i].id, state.rows[i].postsTotal, now);
          }
          persist('organizer'); recompute(now); redraw(); return;
        }
        if (act === 'catchup-done') {
          state.organizer.lastCatchUpAt = now; persist('organizer'); redraw(); return;
        }
        if (act === 'deep') {
          // The rows the user is looking at, not every row we hold: the search
          // view says "the threads currently listed", and fetching more than
          // that would spend their request budget on threads they filtered out.
          var listed = buildPanelModel(now).rows;
          var ids = listed.slice(0, DEEP_SEARCH_MAX_THREADS).map(function (r) { return r.numericId; });
          runDeepSearch(ids, state.searchQuery, now).then(function (res) {
            // Every other fallible action here reports its outcome. Dropping
            // this one made an empty query look identical to a broken feature.
            if (res && !res.ok && res.detail) notice(res.detail, 'warn');
            redraw();
          });
          redraw(); return;
        }
        if (act === 'key-save') {
          var res = saveApiKey(valueOf('key-input').trim());
          // A new key deserves a fresh chance, whatever Torn said about the old
          // one. Without this the script would refuse to use a key it has never
          // tried.
          if (res.ok) clearKeyRejection();
          notice(res.ok ? 'Key saved.' : (res.detail || 'That key was not accepted.'), res.ok ? 'info' : 'error');
          if (res.ok) refreshAll(Date.now()).then(function () { if (isForumsPage(win.location)) redraw(); });
          redraw(); return;
        }
        if (act === 'key-clear') {
          saveApiKey(''); clearKeyRejection(); invalidateInFlight();
          notice('Key cleared.', 'info'); redraw(); return;
        }
        if (act === 'draft' && id) {
          state.draftFocusId = id;
          state.settings.view = 'drafts';
          persist('settings');
          redraw(); return;
        }
        if (act === 'draft-save' && id) {
          state.drafts = saveDraft(state.drafts, id, valueOf('draft-text'), now, '');
          persist('drafts'); recompute(now); notice('Draft saved.', 'info'); redraw(); return;
        }
        if (act === 'draft-delete' && id) {
          state.drafts = deleteDraft(state.drafts, id); persist('drafts'); recompute(now); redraw(); return;
        }
        if (act === 'draft-copy' && id) {
          var d = draftFor(state.drafts, id);
          copyText(doc, win, d ? d.text : '');
          notice('Draft copied.', 'info'); redraw(); return;
        }
        if (act === 'draft-insert' && id) {
          var dd = draftFor(state.drafts, id);
          var ins = insertDraft(doc, win, dd ? dd.text : '');
          notice(ins.ok ? 'Draft inserted.' : (ins.detail || 'Could not insert.'), ins.ok ? 'info' : 'warn');
          redraw(); return;
        }
        if (act === 'folder-add') {
          var name = valueOf('folder-name').trim();
          if (name) {
            state.organizer = upsertFolder(state.organizer, {
              id: name.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40) || ('f' + now),
              name: name, order: state.organizer.folders.length, forumIds: [],
            });
            persist('organizer'); recompute(now);
          }
          redraw(); return;
        }
        if (act === 'folder-delete' && id) {
          state.organizer = deleteFolder(state.organizer, id); persist('organizer'); recompute(now); redraw(); return;
        }
        if (act === 'export') {
          copyText(doc, win, encodeState(state.organizer, state.drafts, win.btoa ? win.btoa.bind(win) : btoa));
          notice('Export copied to the clipboard.', 'info'); redraw(); return;
        }
        if (act === 'import') {
          var out = importState(state.organizer, state.drafts, valueOf('import-text'), win.atob ? win.atob.bind(win) : atob);
          if (!out.ok) { notice(out.detail, 'error'); redraw(); return; }
          state.organizer = out.organizer; state.drafts = out.drafts;
          persist('organizer'); persist('drafts'); recompute(now);
          notice('Imported ' + out.summary.addedFolders + ' folders, ' + out.summary.changedThreads
            + ' threads and ' + out.summary.addedDrafts + ' drafts.', 'info');
          redraw(); return;
        }
        if (act === 'clear-cache') { state.postCache = freshPostCache(); persist('postCache'); notice('Post cache cleared.', 'info'); redraw(); return; }
        if (act === 'reset-organizer') {
          invalidateInFlight();
          state.organizer = freshOrganizer(now); persist('organizer'); recompute(now);
          notice('Folders and tags reset.', 'info'); redraw(); return;
        }
        if (act === 'reset-all') {
          invalidateInFlight();
          state.settings = freshSettings(); state.organizer = freshOrganizer(now);
          state.drafts = freshDrafts(); state.feed = freshFeed(); state.postCache = freshPostCache();
          state.mine = freshMine(); state.mineError = null;
          persist('settings'); persist('organizer'); persist('drafts'); persist('feed'); persist('postCache');
          persist('mine');
          recompute(now); notice('Everything except your API key has been reset.', 'info'); redraw(); return;
        }
        if (act === 'debug') { copyText(doc, win, buildDebugReport()); notice('Debug report copied.', 'info'); redraw(); return; }
      },

      onChange: function (act, el) {
        var now = Date.now();
        var id = idOf(el);
        var value = el && el.value !== undefined ? String(el.value) : '';
        if (act === 'sort' && SORT_MODES.indexOf(value) !== -1) { state.settings.sort = value; persist('settings'); redraw(); return; }
        if (act === 'theme' && THEMES.indexOf(value) !== -1) { state.settings.theme = value; persist('settings'); redraw(); return; }
        if (act === 'filter') { state.searchQuery = value; redraw(); return; }
        if (act === 'folder-filter') { state.settings.folderFilter = value || null; persist('settings'); redraw(); return; }
        if (act === 'tag-filter') { state.settings.tagFilter = value || null; persist('settings'); redraw(); return; }
        if (act === 'folder' && id) { state.organizer = setFolder(state.organizer, id, value || null); persist('organizer'); recompute(now); redraw(); return; }
        if (act === 'note-input' && id) {
          var noteNext = cloneOrganizer(state.organizer);
          entryOf(noteNext, id).note = safeString(value, 2000);
          state.organizer = noteNext;
          persist('organizer'); recompute(now); redraw(); return;
        }
        if (act === 'tag-input' && id && value.trim()) {
          state.organizer = toggleTag(state.organizer, id, value.trim());
          persist('organizer'); recompute(now); redraw(); return;
        }
        if (act === 'auto-refresh') {
          state.settings = normaliseSettings(Object.assign({}, state.settings, { autoRefreshMs: Number(value) }));
          persist('settings');
          // Rescheduling here is the whole point. Setting it up once at startup
          // would mean the choice did nothing until the next page load.
          scheduleAutoRefresh(doc, win);
          redraw(); return;
        }
        if (act === 'enrich-budget') { state.settings.enrichBudget = clamp(toInt(value, DEFAULT_ENRICH_BUDGET), 0, MAX_ENRICH_BUDGET); persist('settings'); redraw(); return; }
        if (act === 'hide-torn-box') {
          state.settings.hideTornBox = !!el.checked;
          persist('settings'); applyHideTornBox(doc); redraw(); return;
        }
        if (act === 'autosave') {
          state.settings.autosaveDrafts = !!el.checked;
          persist('settings');
          if (!state.settings.autosaveDrafts) detachAutosave();
          redraw(); return;
        }
        if (act === 'auto-hide') {
          state.settings.autoHideOnOpen = !!el.checked;
          persist('settings'); redraw(); return;
        }
        if (act === 'folder-forum' && id) {
          var fid = toInt(value, 0);
          var folder = state.organizer.folders.filter(function (f) { return f.id === id; })[0];
          if (folder && fid > 0) {
            var ids = folder.forumIds.slice();
            var at = ids.indexOf(fid);
            if (at === -1) ids.push(fid); else ids.splice(at, 1);
            state.organizer = upsertFolder(state.organizer, Object.assign({}, folder, { forumIds: ids }));
            persist('organizer'); recompute(now);
          }
          redraw(); return;
        }
      },
    };

    return handlers;
  }

  // ---- bootstrap ---------------------------------------------------------

  var booted = false;
  var autoTimer = null;

  function syncToRoute(doc, win) {
    if (!isForumsPage(win.location)) {
      if (state.mounted) unmountPanel(doc);
      // A result that arrives after the user has left must not redraw a panel
      // onto another page, or write data gathered for a page they have gone.
      invalidateInFlight();
      detachAutosave();
      state.route = null;
      return;
    }
    var now = Date.now();
    var capture = captureVisit(win.location, doc.title, now);
    if (capture.changed) { persist('organizer'); recompute(now); }
    state.route = capture.route;
    draw(doc, win, makeHandlers(doc, win));
  }

  function scheduleAutoRefresh(doc, win) {
    if (autoTimer !== null) { clearInterval(autoTimer); autoTimer = null; }
    var ms = state.settings.autoRefreshMs;
    if (!ms) return;
    autoTimer = setInterval(function () {
      try {
        // hidden covers a backgrounded tab; hasFocus covers a tab that is
        // visible but not the one the user is working in. The rule speaks of
        // unfocused pages, so both are checked.
        if (doc.hidden === true) return;
        if (typeof doc.hasFocus === 'function' && !doc.hasFocus()) return;
        if (!isForumsPage(win.location)) return;
        refreshAll(Date.now()).then(function () { drawIfStillHere(doc, win, makeHandlers(doc, win)); });
      } catch (e) { /* an auto refresh must never throw onto the page */ }
    }, ms);
  }

  function init(doc, win) {
    if (booted) return;
    booted = true;

    var now = Date.now();
    loadAll(now);
    recompute(now);

    // The shell is drawn before anything is requested. A hung network then
    // looks like a slow panel rather than a script that never ran.
    state.route = parseForumRoute(win.location);
    renderPanel(doc, win, loadingModel(now), noopHandlers);

    applyHideTornBox(doc);
    var handlers = makeHandlers(doc, win);
    syncToRoute(doc, win);

    observeNavigation(doc, win, function () { syncToRoute(doc, win); });
    observeTheme(doc, win);

    if (isKeyShaped(loadApiKey())) {
      refreshAll(Date.now()).then(function () { drawIfStillHere(doc, win, handlers); });
    }
    scheduleAutoRefresh(doc, win);
  }

  // Torn PDA ignores @match entirely and injects on every Torn page, so this
  // guard is the real scoping. Everything above is a declaration; nothing has
  // run yet.
  if (typeof window !== 'undefined' && isForumsPage(window.location)) {
    whenDocumentReady(document, window, function () {
      init(document, window);
    });
  }

})();
