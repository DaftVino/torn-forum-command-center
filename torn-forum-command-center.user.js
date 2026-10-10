// ==UserScript==
// @name         Torn Forum Command Center
// @namespace    https://github.com/DaftVino/torn-forum-command-center
// @version      0.3.0
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

  var SCRIPT_VERSION = '0.3.0';

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
    badges: 'tfcc:badges',
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
  var MINE_TTL_MS = 15 * 60 * 1000;
  var MINE_PAGE_LIMIT = 100;
  // Thread reactions (#10). Thumbs change slowly, so each started thread's
  // opening post is read at most once per TOPIC_TTL_MS, and at most
  // min(REACTION_LOOKUPS_PER_RUN, enrichBudget) per My posts run.
  var TOPIC_TTL_MS = 12 * 60 * 60 * 1000;
  var REACTION_LOOKUPS_PER_RUN = 5;
  // The line is read on every view but data arrives only from My posts, so a
  // shorter threshold would call it stale nearly always. A day is "old".
  var REACTIONS_STALE_MS = 24 * 60 * 60 * 1000;
  // Without `from`, forum/{id}/posts is oldest first, 20 per page, with the
  // topic post at offset 0. Torn IGNORES `sort` and `limit`, so neither is sent:
  // a `sort=ASC` here would suggest a guarantee that does not exist. Evidence:
  // docs/reference/torn-api-live-findings-2026-10-08.md. The is_topic check in
  // topicPostFromApi stays the real guarantee.
  var TOPIC_POST_PARAMS = Object.freeze({ offset: 0 });
  // Forum karma (#10): the user/profile fallback is read at most this often.
  var KARMA_TTL_MS = 12 * 60 * 60 * 1000;
  // Endless-knot karma icon, supplied by the owner (docs/reference/karma-endless-knot.svg).
  // Changes from that file: fill is currentColor so it follows the theme; prolog,
  // title, desc, role, aria-labelledby and xmlns dropped; aria-hidden and focusable
  // added; sized to the text. ASCII only: Torn PDA rewrites anything else.
  var KARMA_ICON_SVG = '<svg viewBox="149 50 702 900" aria-hidden="true" focusable="false" style="height:1em;width:auto">'
    + '<path fill="currentColor" fill-rule="evenodd" d="'
    + 'M 697 264 L 834 403 L 749 486 L 712 447 L 758 401 L 697 341 L 550 487 L 513 448 Z '
    + 'M 450 511 L 488 551 L 303 736 L 165 600 L 254 512 L 291 550 L 242 600 L 303 659 Z '
    + 'M 301 264 L 389 351 L 350 389 L 301 341 L 242 402 L 390 549 L 353 587 L 165 402 Z '
    + 'M 450 610 L 637 796 L 501 934 L 363 798 L 450 709 L 488 749 L 440 798 L 499 857 L 560 798 L 413 650 Z '
    + 'M 449 314 L 488 353 L 350 489 L 313 450 Z '
    + 'M 499 66 L 637 202 L 550 291 L 511 252 L 560 202 L 501 143 L 440 202 L 588 351 L 551 390 L 363 204 Z '
    + 'M 649 413 L 835 598 L 699 736 L 610 648 L 650 611 L 699 659 L 758 598 L 611 452 Z '
    + 'M 648 511 L 686 551 L 548 686 L 511 648 Z '
    + 'M 451 413 L 587 548 L 551 587 L 413 452 Z'
    + '"/></svg>';
  // The owner's FCC logo (#30), in place of the header's title text. No id,
  // no aria-labelledby and no <title>: a fixed id would collide on Torn's page,
  // so the accessible name is an aria-label. The fill is the owner's color;
  // the .tfcc-logo rules repeat it so a host "svg * { fill }" cannot win.
  // The viewBox is cropped to the letters (x 10-116, y 9-54 of the original
  // 127x66 art), so the drawn edges, not blank margin, meet the chip height.
  // Sized by height in the stylesheet; the width follows the viewBox. No
  // xmlns: the HTML parser places an inline svg in its namespace itself.
  var LOGO_SVG = '<svg class="tfcc-logo" width="66" height="28"'
    + ' viewBox="10 9 106 45" role="img" aria-label="Forum Command Center" focusable="false">'
    + '<g fill="#5C768F">'
    + '<path d="M10 20 21 10h22l-5 10H21v6h15l-5 10H21v17H10Z"/>'
    + '<path d="M79 16l-7 7c-2.9-2.8-6.7-4-10.5-4-6.6 0-11 5.2-11 12.5s4.4 12.5 11 12.5c3.8 0 7.6-1.2 10.5-4'
    + 'l7 7c-4.7 4.6-10.8 7-17.5 7C49 54 40 44.4 40 31.5S49 9 61.5 9C68.2 9 74.3 11.4 79 16Z"/>'
    + '<path d="M116 16l-7 7c-2.9-2.8-6.7-4-10.5-4-6.6 0-11 5.2-11 12.5S91.9 44 98.5 44c3.8 0 7.6-1.2 10.5-4'
    + 'l7 7c-4.7 4.6-10.8 7-17.5 7C86 54 77 44.4 77 31.5S86 9 98.5 9c6.7 0 12.8 2.4 17.5 7Z"/>'
    + '</g></svg>';
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

  var GREASY_FORK_URL = 'https://greasyfork.org/en/scripts/599453-torn-forum-command-center';

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
  // Author-only mode (issue #4): the most posts pages one thread's walk reads
  // in one refresh, and the reasons a cut-short walk may store.
  var AUTHOR_MAX_PAGES = 3;
  var AUTHOR_CHECK_REASONS = Object.freeze(['', 'too-many']);

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

  var VIEWS = Object.freeze(['threads', 'catchup', 'search', 'drafts', 'settings', 'mine']);
  // Rows shown: 0 is All. A menu rather than a free number, so the settings
  // normaliser can refuse anything the menu never wrote and fall back to All.
  var ROWS_SHOWN_OPTIONS = Object.freeze([3, 5, 10, 20, 30, 0]);
  // Every view is in exactly one of these, and a test holds it there, so a new
  // view cannot ship without someone deciding whether the cap governs it.
  // Search and Drafts are uncapped on purpose: a search that hides matches
  // answers a different question from the one asked.
  var CAPPED_VIEWS = Object.freeze(['threads', 'catchup', 'mine']);
  var UNCAPPED_VIEWS = Object.freeze(['search', 'drafts', 'settings']);
  // The nav reads these, and so does the Settings note that names the capped
  // views, so adding a view to CAPPED_VIEWS updates that text by itself.
  var VIEW_LABELS = Object.freeze({
    threads: 'Threads', catchup: 'Catch up', search: 'Search', drafts: 'Drafts', settings: 'Settings',
    mine: 'My posts',
  });

  // Narrow layout (#33). The panel's own border-box width decides it, with 16px
  // of hysteresis so a scrollbar appearing cannot flap the layout (spec 5).
  var NARROW_ENTER_PX = 600;
  var NARROW_LEAVE_PX = 616;
  // Narrow header buttons scale between these, in half-pixel steps, so the
  // header stays on one line (spec 13b). HB_GAPS is the fixed gaps: logo-chip 6,
  // group 6, and 2 x 4 between the buttons. The narrow header CSS uses exactly
  // these gaps; tests/style.test.js holds the two together.
  var HB_MAX = 44;
  var HB_MIN = 24;
  var HB_STEP = 0.5;
  var HB_COMPACT_BELOW = 36;
  var HB_GAPS = 20;
  // The collapsed header's bare unread count sits in the logo group, 6px
  // after the chip (the group's gap). It is part of the one-line solve.
  var HB_COUNT_GAP = 6;
  // The logo's viewBox is 106 x 45; its height follows the button size between
  // 16 and 24px.
  var LOGO_ASPECT = 106 / 45;
  var LOGO_PER_HB = 0.545;
  var LOGO_MIN_PX = 16;
  var LOGO_MAX_PX = 24;
  // The narrow Catch up action row (#39): its controls sit 6px apart and never
  // wrap. CU_MODES are the label sets it can use: the full labels, the short
  // ones, and, when even those cannot fit, the short labels wrapping inside
  // their own buttons on the one row.
  var CU_GAP = 6;
  var CU_MODES = Object.freeze(['full', 'short', 'wrap']);

  // Info buttons (#33, spec 13d): key -> the button's accessible name. The
  // explanation text always stays in the markup; only its hidden attribute
  // follows state.openInfoId.
  var INFO_KEYS = Object.freeze({
    catchup: 'About Catch up',
    mine: 'About My posts',
    search: 'About Search',
    'settings-budget': 'About the request budget',
    'settings-author': 'About author-only mode',
    'settings-rows': 'About Rows shown',
    'settings-autohide': 'About hiding the panel',
    'settings-clip': 'About clipping',
    'settings-seethrough': 'About see-through',
    'settings-folders': 'About folders',
    'settings-badges': 'About badges',
    // #43: in the open narrow row's drawer, before the priority number.
    priority: 'About priority',
    // #58 C4: the Drafts editor.
    'drafts-editor': 'About drafts',
  });
  // #43: info keys that live in the open row's drawer. One shared key: only
  // the open drawer renders it, and it closes whenever that drawer does.
  var DRAWER_INFO_KEYS = Object.freeze(['priority']);
  var INFO_KEYS_BY_VIEW = Object.freeze({
    threads: Object.freeze(['priority']),
    catchup: Object.freeze(['catchup', 'priority']),
    search: Object.freeze(['search']),
    drafts: Object.freeze(['drafts-editor']),
    settings: Object.freeze(['settings-budget', 'settings-author', 'settings-rows', 'settings-autohide',
      'settings-clip', 'settings-seethrough', 'settings-folders', 'settings-badges']),
    mine: Object.freeze(['mine']),
  });
  // The events that close every disclosure (spec section 6 table).
  var TRANSIENT_RESET_EVENTS = Object.freeze(['view', 'collapse', 'auto-hide', 'breakpoint']);
  // The narrow view heading: the focus fallback when a row and both its
  // neighbours are gone (spec section 6, focus rule 3).
  var VIEW_HEADING_ID = 'tfcc-vh';

  var THEMES = Object.freeze(['dark', 'light', 'match']);

  var DEFAULT_FOLDERS = Object.freeze([
    Object.freeze({ id: 'guides', name: 'Guides', order: 0, forumIds: Object.freeze([]) }),
    Object.freeze({ id: 'scripts', name: 'Scripts and tools', order: 1, forumIds: Object.freeze([]) }),
    Object.freeze({ id: 'faction', name: 'Faction', order: 2, forumIds: Object.freeze([]) }),
  ]);

  // #45: the keys of the folder order and of the collapsed set. A folder's
  // key is FOLDER_KEY_PREFIX + its id; built-in Unfiled's is UNFILED_KEY,
  // which has no prefix, so no folder id can ever produce it. Before #45 a
  // folder named "Unfiled" got the id "unfiled" (PR #46 review): its key is
  // "folder:unfiled", a group of its own, and no data is migrated.
  var UNFILED_KEY = 'unfiled';
  var FOLDER_KEY_PREFIX = 'folder:';

  function folderKey(id) { return FOLDER_KEY_PREFIX + id; }

  // The folder id a key names, or null for Unfiled or anything else.
  function folderIdOfKey(key) {
    return typeof key === 'string' && key.indexOf(FOLDER_KEY_PREFIX) === 0 ? key.slice(FOLDER_KEY_PREFIX.length) : null;
  }

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
      // Match Torn by default (owner, 2026-10-09): the panel follows the page.
      // A saved choice, Dark included, is kept.
      theme: 'match',
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
      // Issue #4. Off by default: flag a thread as new only when its author
      // posts. Applies to Threads and Catch up; My posts ignores it.
      authorOnly: false,
      // Issue #8, on by default since #30. A stored false is kept.
      autoHideOnOpen: true,
      // The Torn error code that condemned the stored key, or 0. Persisted on
      // purpose: a userscript reloads on every navigation, so a rejection held
      // only in memory would spend one request per page view on a dead key,
      // which is the exact pattern the IP ban exists for.
      keyRejected: 0,
      deepSearchPages: DEEP_SEARCH_MAX_PAGES,
      // 0 is All. See ROWS_SHOWN_OPTIONS. 5 since #30; a stored value is kept.
      rowsShown: 5,
      // Issue #9. On by default; Settings has the off switch.
      badges: true,
      // #41: clip a row's title and summary to one line, at every width. On
      // by default; a stored false is kept.
      clipLines: true,
      // #43 (owner): the panel base and row cards are translucent. On by
      // default; a stored false is kept.
      seeThrough: true,
      // #58: the mode a new draft opens in. Existing drafts keep their own.
      draftLang: 'md',
      // #58 F1: default editor heights, desktop and phone (strict menu).
      editorHeightWide: 'large',
      editorHeightNarrow: 'medium',
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
    out.authorOnly = raw.authorOnly === true;
    // Absent takes the default (on, #30); present means only a real true, so
    // a corrupt value never starts collapsing the panel.
    out.autoHideOnOpen = Object.prototype.hasOwnProperty.call(raw, 'autoHideOnOpen')
      ? raw.autoHideOnOpen === true : d.autoHideOnOpen;
    out.badges = raw.badges !== false;
    // #41: only a real boolean is kept. Absent, or present but not a boolean,
    // takes the default (on): clipping is presentation only, so a corrupt
    // value costs nothing worse than the default look.
    out.clipLines = typeof raw.clipLines === 'boolean' ? raw.clipLines : d.clipLines;
    // #43: the same rule. Presentation only, so a junk value is not damage
    // either (isRecoveredSettings).
    out.seeThrough = typeof raw.seeThrough === 'boolean' ? raw.seeThrough : d.seeThrough;
    out.keyRejected = KEY_REJECTED_CODES.indexOf(toInt(raw.keyRejected, 0)) === -1
      ? 0 : toInt(raw.keyRejected, 0);
    out.folderFilter = typeof raw.folderFilter === 'string' ? safeString(raw.folderFilter, 64) : null;
    out.tagFilter = typeof raw.tagFilter === 'string' ? safeString(raw.tagFilter, 64) : null;
    var auto = toInt(raw.autoRefreshMs, 0);
    out.autoRefreshMs = [0, 120000, 300000, 900000].indexOf(auto) !== -1 ? auto : 0;
    out.enrichBudget = clamp(toInt(raw.enrichBudget, DEFAULT_ENRICH_BUDGET), 0, MAX_ENRICH_BUDGET);
    out.deepSearchPages = clamp(toInt(raw.deepSearchPages, DEEP_SEARCH_MAX_PAGES), 1, DEEP_SEARCH_MAX_PAGES);
    // Strict on type: toInt would floor 10.5 to 10 and accept "10", and the
    // menu wrote neither. Absent takes the default (#30); anything present but
    // off the menu is All, so a corrupt value never hides rows.
    if (Object.prototype.hasOwnProperty.call(raw, 'rowsShown')) {
      out.rowsShown = typeof raw.rowsShown === 'number' && ROWS_SHOWN_OPTIONS.indexOf(raw.rowsShown) !== -1
        ? raw.rowsShown : 0;
    }
    // #58: strict on the menu; absent or off it takes the default.
    out.draftLang = DRAFT_LANGS.indexOf(raw.draftLang) !== -1 ? raw.draftLang : d.draftLang;
    out.editorHeightWide = Object.prototype.hasOwnProperty.call(EDITOR_HEIGHTS, raw.editorHeightWide) ? raw.editorHeightWide : d.editorHeightWide;
    out.editorHeightNarrow = Object.prototype.hasOwnProperty.call(EDITOR_HEIGHTS, raw.editorHeightNarrow) ? raw.editorHeightNarrow : d.editorHeightNarrow;
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
      // #45: where Unfiled sits among the folders (an index into the folder
      // list, 0 to folders.length; folders.length means last), and the groups
      // collapsed on this device (folder keys and UNFILED_KEY).
      unfiledAt: DEFAULT_FOLDERS.length,
      collapsedFolders: [],
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
      // Author-only check result (issue #4). A cache: never exported.
      authorCheckedAt: 0,
      authorCheckTotal: 0,
      authorCheckSince: 0,
      authorNewCount: 0,
      authorLatestAt: 0,
      authorCheckComplete: false,
      authorCheckReason: '',
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
    e.authorCheckedAt = Math.max(0, toInt(raw.authorCheckedAt, 0));
    e.authorCheckTotal = Math.max(0, toInt(raw.authorCheckTotal, 0));
    e.authorCheckSince = Math.max(0, toInt(raw.authorCheckSince, 0));
    e.authorNewCount = Math.max(0, toInt(raw.authorNewCount, 0));
    e.authorLatestAt = Math.max(0, toInt(raw.authorLatestAt, 0));
    e.authorCheckComplete = raw.authorCheckComplete === true;
    e.authorCheckReason = AUTHOR_CHECK_REASONS.indexOf(raw.authorCheckReason) !== -1 ? raw.authorCheckReason : '';
    return e;
  }

  function normaliseFolder(raw, index) {
    if (!isPlainObject(raw)) return null;
    var id = safeString(raw.id, 64).trim();
    var name = safeString(raw.name, 64).trim();
    if (!id || !name) return null;
    var forumIds = [];
    if (Array.isArray(raw.forumIds)) {
      // #47 (PR #48 review): repeats are dropped here and the 40 cap is
      // applied by canonicalClaims, after the cross-folder pass, so neither
      // kind of duplicate uses up the cap.
      for (var i = 0; i < raw.forumIds.length && i < MAX_RAW_CLAIMS; i += 1) {
        var n = toInt(raw.forumIds[i], 0);
        if (n > 0 && forumIds.indexOf(n) === -1) forumIds.push(n);
      }
    }
    return { id: id, name: name, order: toInt(raw.order, index), forumIds: forumIds };
  }

  var MAX_CLAIMS = 40;
  var MAX_RAW_CLAIMS = 400;

  // #47 (PR #48 review): a forum is claimed by one folder at most. Given the
  // folders in the user's order, each forum stays with the FIRST folder that
  // claims it (the one folderFor already picks, so auto-filing does not
  // change), each list loses its repeats, and the cap applies after both.
  // Every boundary runs it: load, upsertFolder and import.
  function canonicalClaims(folders) {
    var taken = {};
    return folders.map(function (f) {
      var ids = [];
      for (var i = 0; i < f.forumIds.length && ids.length < MAX_CLAIMS; i += 1) {
        var n = f.forumIds[i];
        if (Object.prototype.hasOwnProperty.call(taken, n)) continue;
        taken[n] = true;
        ids.push(n);
      }
      return { id: f.id, name: f.name, order: f.order, forumIds: ids };
    });
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

    folders.sort(function (a, b) { return a.order - b.order; });
    folders = canonicalClaims(folders);
    // #45: both fields are new. Absent (every organizer saved before #45),
    // Unfiled is last and nothing is collapsed; isRecoveredValue fills absent
    // top-level fields, so that is not reported as damage.
    var collapsed = [];
    if (Array.isArray(raw.collapsedFolders)) {
      for (var c = 0; c < raw.collapsedFolders.length && collapsed.length <= folders.length; c += 1) {
        var key = raw.collapsedFolders[c];
        if (typeof key !== 'string' || collapsed.indexOf(key) !== -1) continue;
        var cid = folderIdOfKey(key);
        if (key === UNFILED_KEY || (cid !== null && Object.prototype.hasOwnProperty.call(seenFolder, cid))) collapsed.push(key);
      }
    }
    return {
      v: SCHEMA_VERSION,
      folders: folders,
      threads: threads,
      lastCatchUpAt: Math.max(0, toInt(raw.lastCatchUpAt, 0)),
      unfiledAt: clamp(toInt(raw.unfiledAt, folders.length), 0, folders.length),
      collapsedFolders: collapsed,
    };
  }

  // #43: a present see-through value that is not a boolean takes the default
  // without a "Settings were damaged" notice: it only changes how the panel
  // looks. Any other difference is still damage.
  function isRecoveredSettings(raw, value) {
    if (isPlainObject(raw) && Object.prototype.hasOwnProperty.call(raw, 'seeThrough') && typeof raw.seeThrough !== 'boolean') {
      raw = Object.assign({}, raw);
      delete raw.seeThrough;
    }
    return isRecoveredValue(raw, value);
  }

  // An upgrade adds per-thread fields (issue #4). They are nested inside the
  // threads map, which isRecoveredValue deliberately does not forgive, so fill
  // each raw thread entry's absent keys from its normalised entry first. A key
  // that is present and changed, a key the normaliser drops, and an entry it
  // drops all still differ, so they are still damage.
  function isRecoveredOrganizer(raw, value) {
    // #47 (PR #48 review): a list of whole positive forum ids that only lost
    // repeats, claims another folder holds first, or entries past the cap was
    // canonicalised, not damaged. Any other value in it is still damage.
    if (isPlainObject(raw) && Array.isArray(raw.folders) && isPlainObject(value) && Array.isArray(value.folders)) {
      var byId = {};
      value.folders.forEach(function (f) { byId[f.id] = f; });
      raw = Object.assign({}, raw, { folders: raw.folders.map(function (r) {
        if (!isPlainObject(r) || !Array.isArray(r.forumIds) || typeof r.id !== 'string') return r;
        var v = Object.prototype.hasOwnProperty.call(byId, r.id) ? byId[r.id] : null;
        var wellFormed = r.forumIds.every(function (n) { return typeof n === 'number' && n > 0 && Math.floor(n) === n; });
        return v && wellFormed ? Object.assign({}, r, { forumIds: v.forumIds }) : r;
      }) });
    }
    if (isPlainObject(raw) && isPlainObject(raw.threads) && isPlainObject(value) && isPlainObject(value.threads)) {
      var threads = {};
      Object.keys(raw.threads).forEach(function (id) {
        var r = raw.threads[id];
        var v = value.threads[id];
        threads[id] = isPlainObject(r) && isPlainObject(v) ? Object.assign({}, v, r) : r;
      });
      raw = Object.assign({}, raw, { threads: threads });
    }
    return isRecoveredValue(raw, value);
  }

  function freshDrafts() { return { v: SCHEMA_VERSION, byThread: {} }; }

  var FREE_DRAFTS_MAX = 100;
  var FREE_NAME_MAX = 80;

  function draftLangField(v) { return v === 'md' || v === 'html' ? v : null; }

  function normaliseDrafts(raw) {
    if (!isPlainObject(raw)) return freshDrafts();
    if (toInt(raw.v, 0) > SCHEMA_VERSION) return freshDrafts();
    var out = freshDrafts();
    if (isPlainObject(raw.byThread)) {
      var ids = Object.keys(raw.byThread);
      for (var i = 0; i < ids.length && i < 500; i += 1) {
        var id = ids[i];
        if (!/^[0-9]{1,12}$/.test(id)) continue;
        var d = raw.byThread[id];
        if (!isPlainObject(d)) continue;
        var text = safeString(d.text, DRAFT_MAX_CHARS);
        if (!text) continue;
        // Key order matters: the recovery check compares JSON, and a stored
        // draft was written in this order (saveDraft).
        var entry = { text: text, updatedAt: Math.max(0, toInt(d.updatedAt, 0)), title: safeString(d.title, 300) };
        var lang = draftLangField(d.lang);
        if (lang) entry.lang = lang;
        out.byThread[id] = entry;
      }
    }
    // #58: free drafts, tied to no thread. Absent stays absent, so an older
    // blob normalises byte-identical. A named draft may be empty.
    if (isPlainObject(raw.free)) {
      out.free = {};
      var fids = Object.keys(raw.free);
      for (var k = 0, kept = 0; k < fids.length && kept < FREE_DRAFTS_MAX; k += 1) {
        if (!/^n[0-9]{1,12}$/.test(fids[k])) continue;
        var f = raw.free[fids[k]];
        if (!isPlainObject(f)) continue;
        var fe = {
          name: safeString(f.name, FREE_NAME_MAX) || 'Untitled',
          text: safeString(f.text, DRAFT_MAX_CHARS),
          updatedAt: Math.max(0, toInt(f.updatedAt, 0)),
        };
        var fl = draftLangField(f.lang);
        if (fl) fe.lang = fl;
        out.free[fids[k]] = fe;
        kept += 1;
      }
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
    // Optional reaction fields (#10): canonical order, whole pairs only.
    var reactAt = Math.max(0, toInt(raw.reactAt, 0));
    var topicAt = Math.max(0, toInt(raw.topicAt, 0));
    var rx = {};
    if (reactAt > 0 && isReactionNumber(raw.rating, true)) {
      rx.reactAt = reactAt;
      rx.rating = Math.floor(raw.rating);
    }
    if (topicAt > 0) {
      rx.topicAt = topicAt;
      if (isReactionNumber(raw.up, false) && isReactionNumber(raw.down, false)) {
        rx.up = Math.floor(raw.up);
        rx.down = Math.floor(raw.down);
      }
    }
    setReactionFields(t, rx);
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
    // Optional forum karma (#10): a whole pair or nothing, and never added
    // when the stored blob lacked it, so an old cache round-trips unchanged.
    var karmaAt = Math.max(0, toInt(raw.karmaAt, 0));
    if (karmaAt > 0 && isReactionNumber(raw.karma, true)) {
      out.karma = Math.floor(raw.karma);
      out.karmaAt = karmaAt;
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
      // ForumThreadBase.rating (OpenAPI 6.13.8, undocumented). Whether it is
      // net or likes-only is not settled (live finding 13), so it is shown
      // only as "net" and never split into thumbs.
      rating: isReactionNumber(raw.rating, true) ? Math.floor(raw.rating) : null,
      // Torn's own unread count for a thread the key owner started (finding 1).
      tornNew: hasNew ? Math.max(0, Math.floor(raw.new_posts)) : 0,
      tornNewKnown: hasNew,
    };
  }

  // -- thread reactions: record fields (#10) --------------------------------
  // Five optional fields on a tfcc:mine record, always in this order. They are
  // nested inside threads[], so a default here would make loadKey call every
  // upgrading user's cache damaged; absent means unknown instead. Every write
  // goes through setReactionFields, so any write order serialises the way
  // normaliseMineThread writes it.
  var REACTION_FIELDS = ['reactAt', 'rating', 'topicAt', 'up', 'down'];

  function isReactionNumber(v, allowNegative) {
    return typeof v === 'number' && isFinite(v) && (allowNegative === true || v >= 0);
  }

  function setReactionFields(rec, changes) {
    var vals = {};
    var i;
    for (i = 0; i < REACTION_FIELDS.length; i += 1) {
      var k = REACTION_FIELDS[i];
      vals[k] = Object.prototype.hasOwnProperty.call(changes, k) ? changes[k] : rec[k];
      delete rec[k];
    }
    for (i = 0; i < REACTION_FIELDS.length; i += 1) {
      var key = REACTION_FIELDS[i];
      if (typeof vals[key] === 'number') rec[key] = vals[key];
    }
    return rec;
  }

  // A row with no rating leaves the old one alone, so it ages into stale
  // rather than vanishing or turning into a zero.
  function applyReactions(rec, row, now) {
    if (!rec || !row || typeof row.rating !== 'number') return rec;
    return setReactionFields(rec, { reactAt: Math.max(0, toInt(now, 0)), rating: row.rating });
  }

  // forum/{id}/posts page one. Only a post Torn flags is_topic counts, and only
  // with two real counts; `content` is never read. undefined = shape not
  // recognised (stamp nothing, retry next run); null = no usable topic post
  // (stamp the check, fall back to net, retry after the TTL).
  function topicPostFromApi(data, threadId) {
    var list = pickList(data, ['posts']);
    if (!list) return undefined;
    var id = toInt(threadId, 0);
    for (var i = 0; i < list.length; i += 1) {
      var p = list[i];
      if (!isPlainObject(p) || p.is_topic !== true) continue;
      if (p.thread_id !== undefined && toInt(p.thread_id, 0) !== id) continue;
      if (!isReactionNumber(p.likes, false) || !isReactionNumber(p.dislikes, false)) return null;
      return { up: Math.floor(p.likes), down: Math.floor(p.dislikes) };
    }
    return null;
  }

  // normaliseMine doubles as the deep clone, so the input is never mutated.
  function applyTopicPost(snap, threadId, topic, now) {
    var out = normaliseMine(snap);
    var id = toInt(threadId, 0);
    for (var i = 0; i < out.threads.length; i += 1) {
      if (out.threads[i].id !== id) continue;
      setReactionFields(out.threads[i], {
        topicAt: Math.max(0, toInt(now, 0)),
        up: topic ? topic.up : null,
        down: topic ? topic.down : null,
      });
    }
    return out;
  }

  // Started threads whose opening post is unchecked or older than ttl.
  // Never-checked first (newest activity first), then the oldest check.
  function reactionLookupTargets(snap, now, ttl, n) {
    var cap = Math.max(0, toInt(n, 0));
    if (!cap || !isPlainObject(snap) || !Array.isArray(snap.threads)) return [];
    var t0 = toInt(now, 0);
    var due = snap.threads.filter(function (r) {
      if (!r || r.started !== true) return false;
      var at = toInt(r.topicAt, 0);
      return at <= 0 || t0 - at >= ttl;
    });
    due.sort(function (a, b) {
      var ac = toInt(a.topicAt, 0) > 0 ? 1 : 0;
      var bc = toInt(b.topicAt, 0) > 0 ? 1 : 0;
      if (ac !== bc) return ac - bc;
      if (ac === 0) return (b.lastPostAt - a.lastPostAt) || (b.id - a.id);
      return (toInt(a.topicAt, 0) - toInt(b.topicAt, 0)) || (b.id - a.id);
    });
    return due.slice(0, cap).map(function (r) { return r.id; });
  }

  // -- thread reactions: totals (#10) ---------------------------------------
  // Up and down are only ever sums of real topic-post counts. rating is shown
  // only as "net" and never split. The API has no subscriber count at all
  // (docs/reference/torn-openapi-forum-excerpt-2026-10-08.json).

  var NO_SUBSCRIBERS = ' Torn\'s API has no subscriber count, so none is shown.';

  function formatSigned(n) {
    var v = toInt(n, 0);
    if (v > 0) return '+' + formatCount(v);
    if (v < 0) return '-' + formatCount(-v);
    return '0';
  }

  function reactionTotals(mine, now, staleMs) {
    var out = {
      state: 'unloaded', started: 0, up: null, down: null, thumbThreads: 0,
      net: null, netThreads: 0, updatedAt: 0, stale: false,
      // Forum karma: whatever the state, never defaulted to 0.
      karma: isPlainObject(mine) && isReactionNumber(mine.karma, true) ? Math.floor(mine.karma) : null,
    };
    var threads = isPlainObject(mine) && Array.isArray(mine.threads) ? mine.threads : [];
    for (var i = 0; i < threads.length; i += 1) {
      var t = threads[i];
      if (!t || t.started !== true) continue;
      out.started += 1;
      if (typeof t.up === 'number' && typeof t.down === 'number') {
        out.up = (out.up || 0) + t.up;
        out.down = (out.down || 0) + t.down;
        out.thumbThreads += 1;
        out.updatedAt = Math.max(out.updatedAt, toInt(t.topicAt, 0));
      } else if (typeof t.rating === 'number') {
        out.net = (out.net || 0) + t.rating;
        out.netThreads += 1;
        out.updatedAt = Math.max(out.updatedAt, toInt(t.reactAt, 0));
      }
    }
    if (out.started === 0) {
      out.state = isPlainObject(mine) && toInt(mine.fetchedAt, 0) > 0 ? 'empty' : 'unloaded';
      return out;
    }
    if (out.thumbThreads === 0 && out.netThreads === 0) { out.state = 'missing'; return out; }
    out.state = 'known';
    out.stale = toInt(now, 0) - out.updatedAt > staleMs;
    return out;
  }

  function reactionsTitle(r, now, pageLimit, opener) {
    var act = opener || 'Open My posts';
    if (!r || r.state === 'unloaded') return 'Not loaded yet. ' + act + ' to load the threads you started.' + NO_SUBSCRIBERS;
    if (r.state === 'empty') return 'Torn reports no threads you started.' + NO_SUBSCRIBERS;
    if (r.state === 'missing') return 'Torn has not reported thumbs or a rating for your threads yet.' + NO_SUBSCRIBERS;
    var ofText = ' of ' + r.started + ' ' + plural(r.started, 'thread') + ' you started';
    var text;
    if (r.thumbThreads > 0) {
      text = 'Thumbs up and down from the opening post of ' + r.thumbThreads + ofText + '.';
      if (r.netThreads > 0) {
        text += ' ' + r.netThreads + ' more ' + plural(r.netThreads, 'shows', 'show') + ' Torn\'s net rating until checked.';
      }
    } else {
      text = 'Torn\'s net rating for ' + r.netThreads + ofText + '; thumbs up and down appear once '
        + plural(r.netThreads, 'its', 'their') + ' opening ' + plural(r.netThreads, 'post is', 'posts are') + ' checked.';
    }
    text += ' Updated ' + formatRelativeTime(r.updatedAt, now) + '.';
    if (r.started >= pageLimit) {
      text += ' Torn sends your newest ' + pageLimit + ' threads per request; older ones keep the figures '
        + 'from when they were last seen.';
    }
    if (r.stale) text += ' ' + act + ' to update.';
    return text + NO_SUBSCRIBERS;
  }

  // -- forum karma (#10) -----------------------------------------------------
  // ForumThreadAuthor.karma (required int32, undocumented) is the key owner's
  // figure on every row of user/forumthreads and user/forumposts; user/profile
  // returns profile.karma. A figure is taken only if it is a finite number:
  // toInt(null, 0) would turn "unknown" into 0, which is the trap.
  function karmaFromAuthors(rows, timeField, selfId) {
    if (!Array.isArray(rows)) return null;
    var best = null;
    var bestAt = -1;
    for (var i = 0; i < rows.length; i += 1) {
      var r = rows[i];
      var a = isPlainObject(r) && isPlainObject(r.author) ? r.author : null;
      if (!a || !isReactionNumber(a.karma, true)) continue;
      if (selfId && a.id !== selfId) continue;
      var at = typeof r[timeField] === 'number' ? r[timeField] : 0;
      if (at > bestAt) { best = Math.floor(a.karma); bestAt = at; }
    }
    return best;
  }

  function karmaFromProfile(data) {
    var p = isPlainObject(data) && isPlainObject(data.profile) ? data.profile : null;
    return p && isReactionNumber(p.karma, true) ? Math.floor(p.karma) : null;
  }

  // The only writer. Both fields together or neither; removing and re-adding
  // puts them last, which is where normaliseMine writes them.
  function setKarma(snap, karma, now) {
    var out = normaliseMine(snap);
    delete out.karma;
    delete out.karmaAt;
    if (isReactionNumber(karma, true) && toInt(now, 0) > 0) {
      out.karma = Math.floor(karma);
      out.karmaAt = toInt(now, 0);
    }
    return out;
  }

  // Both counts must be the number 0: null/undefined mean the list failed or
  // was not parsed, and an unknown is not an empty list.
  function karmaFallbackDue(snap, now, ttl, threadRowCount, postRowCount) {
    if (threadRowCount !== 0 || postRowCount !== 0) return false;
    var at = toInt(snap && snap.karmaAt, 0);
    return at <= 0 || toInt(now, 0) - at >= ttl;
  }

  // Comma thousands, built by hand: toLocaleString reads the ambient locale.
  function formatKarma(n) {
    if (!isReactionNumber(n, true)) return '-';
    var digits = String(Math.abs(Math.floor(n)));
    var out = '';
    for (var i = 0; i < digits.length; i += 1) {
      if (i > 0 && (digits.length - i) % 3 === 0) out += ',';
      out += digits.charAt(i);
    }
    return (n < 0 ? '-' : '') + out;
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
      applyReactions(r, s, t0);
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
    // Forum karma (#10) is carried over as stored: a merge is not a sighting.
    // Without this, every run would drop a cached profile reading and re-arm
    // the user/profile fallback.
    if (typeof base.karma === 'number') {
      out.karma = base.karma;
      out.karmaAt = base.karmaAt;
    }
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

  function mineIsDue(snap, now, ttl) {
    var f = snap ? toInt(snap.fetchedAt, 0) : 0;
    return f <= 0 || (toInt(now, 0) - f) >= ttl;
  }

  // Lookups go only to threads Torn gives no count for, whose total is unknown
  // or older than the TTL, newest conversation first, inside the same budget
  // setting Threads uses.
  function mineLookupTargets(snap, subscribed, budget, now, ttl) {
    var n = clamp(toInt(budget, 0), 0, MAX_ENRICH_BUDGET);
    if (!n || !snap) return [];
    var subs = {};
    for (var i = 0; i < (subscribed || []).length; i += 1) subs[String(subscribed[i].id)] = true;
    var t = toInt(now, 0);
    var out = [];
    for (var j = 0; j < snap.threads.length && out.length < n; j += 1) {
      var r = snap.threads[j];
      if (subs[String(r.id)]) continue;
      if (r.totalKnown && (t - r.infoAt) < ttl) continue;
      out.push(r.id);
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

  // -- author-only mode (issue #4) ----------------------------------------
  // One step of the backwards walk over forum/{id}/posts?from=..&to=... Torn
  // returns newest first, at most perPage, and both from and to are
  // inclusive, so the next page starts with this page's oldest post again.
  // prevLink is the response's _metadata.links.prev, read only for null; the
  // URL itself is never fetched (the script builds its own).
  function authorPageStep(pagePosts, seenIds, perPage, prevLink) {
    var list = Array.isArray(pagePosts) ? pagePosts : [];
    var size = Math.max(1, toInt(perPage, POSTS_PER_PAGE));
    if (list.length < size || prevLink === null) return { done: true, complete: true, to: 0 };
    var seen = {};
    (Array.isArray(seenIds) ? seenIds : []).forEach(function (id) { seen[String(id)] = true; });
    var added = 0;
    var oldest = 0;
    for (var i = 0; i < list.length; i += 1) {
      var post = list[i];
      if (!isPlainObject(post)) continue;
      var t = toInt(post.created_time, 0);
      if (t > 0 && (oldest === 0 || t < oldest)) oldest = t;
      if (!seen[String(post.id)]) added += 1;
    }
    // A full page that brought nothing new: more than a page of posts share
    // one second, so to cannot move. Stop rather than loop; it is a lower bound.
    if (added === 0 || oldest === 0) return { done: true, complete: false, to: 0 };
    return { done: false, complete: false, to: oldest };
  }

  // Reads every page of one walk, concatenated. Each post id counts once, so
  // the boundary post that the inclusive to repeats is not counted twice. A
  // post counts as new only when it is strictly after the marker, which also
  // keeps a post at the marker out even if the request were built wrong.
  // complete comes from the walk (authorPageStep), not from a page length.
  function summariseAuthorPosts(posts, authorId, sinceMs, complete) {
    var list = Array.isArray(posts) ? posts : [];
    var aid = toInt(authorId, 0);
    var since = Math.max(0, toInt(sinceMs, 0));
    var seen = {};
    var out = { count: 0, latestAt: 0, newestAt: 0, complete: complete === true };
    for (var i = 0; i < list.length; i += 1) {
      var post = list[i];
      if (!isPlainObject(post)) continue;
      var key = post.id === undefined || post.id === null ? '' : String(post.id);
      if (key && seen[key]) continue;
      if (key) seen[key] = true;
      var at = secondsToMs(post.created_time);
      if (at <= since) continue;
      if (at > out.newestAt) out.newestAt = at;
      var pid = isPlainObject(post.author) ? toInt(post.author.id, 0) : 0;
      if (aid > 0 && pid === aid) {
        out.count += 1;
        if (at > out.latestAt) out.latestAt = at;
      }
    }
    return out;
  }

  var AUTHOR_REASON_TEXT = Object.freeze({
    never: 'Not checked for author posts yet. Torn reports new posts from someone. Refresh, or raise Activity lookups in Settings.',
    stale: 'New posts since the last check. Not rechecked yet. Refresh to check again.',
    'too-many': 'More posts are new than one refresh reads for a thread, so they could not all be read. None of those read is by the author; the older ones were not checked. Open the thread or mark it read to start counting again.',
    'no-author': 'The thread author is not known, so their posts cannot be picked out.',
    'no-marker': 'Open this thread or mark it read once, so there is a point to count from.',
  });

  // The point after which an author post counts as new: the last time the
  // user saw the thread (a captured visit or Mark read), else when the script
  // first saw it. Posts from before the install are deliberately not flagged.
  function authorSinceFor(entry) {
    if (!entry) return 0;
    return entry.lastVisitedAt > 0 ? entry.lastVisitedAt : Math.max(0, toInt(entry.firstSeenAt, 0));
  }

  // The author-only view of one row: 'none' (known: nothing new by the
  // author), 'author' (an exact count), 'author-atleast' (a lower bound) or
  // 'unchecked' (unknown, with a reason). An unknown is never folded into none.
  function authorStateFor(apiRow, entry, u) {
    var e = entry || normaliseThreadEntry(null);
    function unchecked(reason) { return { state: 'unchecked', count: 0, latestAt: 0, reason: reason }; }
    if (!u || u.dismissed || u.tornUnread === 0) return { state: 'none', count: 0, latestAt: 0, reason: '' };
    var authorId = (apiRow && apiRow.authorId) || e.authorId || 0;
    if (!authorId) return unchecked('no-author');
    var since = authorSinceFor(e);
    if (!since) return unchecked('no-marker');
    if (!e.authorCheckedAt) return unchecked('never');
    if (e.authorCheckSince !== since) return unchecked('stale');
    if (e.authorCheckTotal === u.postsTotal) {
      if (e.authorNewCount > 0) {
        return { state: e.authorCheckComplete ? 'author' : 'author-atleast', count: e.authorNewCount, latestAt: e.authorLatestAt, reason: '' };
      }
      // A walk cut short with no author post is never a known zero: the author
      // may have posted among the new posts the walk did not reach.
      return e.authorCheckComplete ? { state: 'none', count: 0, latestAt: 0, reason: '' } : unchecked('too-many');
    }
    if (e.authorNewCount > 0) {
      return { state: 'author-atleast', count: e.authorNewCount, latestAt: e.authorLatestAt, reason: 'grown' };
    }
    return unchecked('stale');
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
  function isOrganized(entry, hasDraft) {
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
    var authorOnly = !!(input && input.authorOnly);
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
      var au = authorOnly ? authorStateFor(api, entry, u) : null;
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
        unread: au ? ((au.state === 'author' || au.state === 'author-atleast') ? au.count : 0) : u.unread,
        // The any-poster count, whatever the setting. My posts ignores
        // author-only mode (issue #4) and reads this.
        anyUnread: u.unread,
        authorState: au ? au.state : 'off',
        authorNew: au ? au.count : 0,
        authorLatestAt: au ? au.latestAt : 0,
        authorReason: au ? au.reason : '',
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
        // Thread reactions (#10): null when unknown, never 0.
        up: rec && typeof rec.up === 'number' ? rec.up : null,
        down: rec && typeof rec.down === 'number' ? rec.down : null,
        rating: rec && typeof rec.rating === 'number' ? rec.rating : null,
        inThreads: !!api || !rec || isOrganized(entry, !!draft),
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

  function catchUpList(rows, lastCatchUpAt, mode) {
    var since = Math.max(0, toInt(lastCatchUpAt, 0));
    return rows.filter(function (r) {
      if (r.dismissed) return false;
      if (mode === 'author') {
        return (r.authorState === 'author' || r.authorState === 'author-atleast') && r.authorLatestAt > since;
      }
      if (r.unread > 0) return true;
      return r.lastActivity !== null && r.lastActivity > since;
    });
  }

  // Rows whose author activity is unknown. Kept out of the catch-up list, which
  // claims "the author posted", but listed beside it so nothing goes quiet.
  function catchUpUnchecked(rows) {
    return rows.filter(function (r) { return r.authorState === 'unchecked' && !r.archived; });
  }

  // My posts ignores author-only mode (issue #4): its rows go back to the
  // any-poster count. A row built with the setting off is returned as is.
  function anyPosterRow(r) {
    if (r.authorState === 'off') return r;
    return Object.assign({}, r, { unread: r.anyUnread, authorState: 'off', authorNew: 0, authorLatestAt: 0, authorReason: '' });
  }

  // Every list view's population and filters, in one place. sortThreads runs
  // after this, and a row cap (issue #3) goes after that, so the user always
  // sees the top N of what they asked for.
  function viewRows(rows, view, filters, query) {
    var f = filters || {};
    return rows.filter(function (r) {
      if (view === 'mine' ? !r.mineRole : !r.inThreads) return false;
      if (r.archived && !r.pinned && r.unread === 0) return false;
      if (f.unreadOnly && r.unread === 0 && r.authorState !== 'unchecked') return false;
      if (f.folderFilter && r.folderId !== f.folderFilter) return false;
      if (f.tagFilter && r.tags.indexOf(f.tagFilter) === -1) return false;
      return matchThread(r, query);
    });
  }

  // The last step before rendering a capped list. It runs after every filter
  // and the sort, so the user sees the top N of what they asked for. It copies
  // rather than slices in place, because the full list is still the one that
  // Search, deep search and the nav counts read.
  function capRows(rows, limit, expanded) {
    var list = Array.isArray(rows) ? rows : [];
    var lim = typeof limit === 'number' && ROWS_SHOWN_OPTIONS.indexOf(limit) !== -1 ? limit : 0;
    var total = list.length;
    var bites = lim > 0 && total > lim;
    var open = bites && expanded === true;
    return {
      rows: bites && !open ? list.slice(0, lim) : list.slice(),
      total: total,
      limit: lim,
      hidden: bites && !open ? total - lim : 0,
      expandable: bites,
      expanded: open,
    };
  }

  // #43: the row limit a capped view uses. Expand (takeover) shows every row,
  // with no "Showing N of M" line: All (0) while it lasts. The caller never
  // writes showAll, so Shrink brings back exactly the cap the user had.
  function rowLimitFor(rowsShown, takeover) {
    return takeover === true ? 0 : rowsShown;
  }

  // True when the panel should use the narrow layout. An unknown width (0,
  // NaN, a failed measurement) keeps whatever layout is current.
  function narrowFor(width, wasNarrow) {
    var was = wasNarrow === true;
    if (typeof width !== 'number' || !(width > 0)) return was;
    if (width <= NARROW_ENTER_PX) return true;
    if (width > NARROW_LEAVE_PX) return false;
    return was;
  }

  function headerLogoWidth(size) {
    return Math.min(LOGO_MAX_PX, Math.max(LOGO_MIN_PX, LOGO_PER_HB * size)) * LOGO_ASPECT;
  }

  // The largest header button size in [HB_MIN, HB_MAX], in HB_STEP steps, that
  // keeps logo, chip, buttons and the Show label on one line of `content`
  // pixels. fits is false only when even HB_MIN does not fit; the runtime then
  // lets the logo-and-chip group wrap, never the buttons (spec 13b, last resort).
  // countW is the collapsed header's bare unread count (0 when there is none);
  // it and its HB_COUNT_GAP are part of the line. showW is the Show button at
  // HB_MIN; showSlope is how much wider it gets per pixel of size (its padding
  // follows the size), 0 for a fixed width.
  function headerButtonSize(content, chipW, showW, icons, countW, showSlope) {
    var c = typeof content === 'number' && isFinite(content) ? content : 0;
    var chip = typeof chipW === 'number' && chipW > 0 ? chipW : 0;
    var show = typeof showW === 'number' && showW > 0 ? showW : 0;
    var count = typeof countW === 'number' && countW > 0 ? countW + HB_COUNT_GAP : 0;
    var slope = typeof showSlope === 'number' && isFinite(showSlope) ? showSlope : 0;
    var n = icons === 2 ? 2 : 3;
    for (var s = HB_MAX; s >= HB_MIN; s -= HB_STEP) {
      var showAt = show > 0 ? show + slope * (s - HB_MIN) : 0;
      if (headerLogoWidth(s) + chip + count + n * s + showAt + HB_GAPS <= c) return { size: s, fits: true };
    }
    return { size: HB_MIN, fits: false };
  }

  // Which labels keep the narrow Catch up row on one line (#39). full and short
  // are the widths of the row's controls (Mark all read, Set catch-up point,
  // its info button) with each label set, measured by the runtime. The full
  // labels win while they fit; the short ones only when the full would wrap;
  // 'wrap' when even the short ones cannot fit, so the labels wrap inside
  // their buttons and the row still holds one line of controls. Unknown
  // widths keep the full labels.
  function catchUpLabelMode(content, full, short) {
    var need = function (ws) {
      if (!Array.isArray(ws) || !ws.length) return null;
      var sum = CU_GAP * (ws.length - 1);
      for (var i = 0; i < ws.length; i += 1) {
        if (typeof ws[i] !== 'number' || !isFinite(ws[i]) || ws[i] < 0) return null;
        sum += ws[i];
      }
      return sum;
    };
    var c = typeof content === 'number' && isFinite(content) ? content : 0;
    var f = need(full);
    if (!(c > 0) || f === null) return CU_MODES[0];
    if (f <= c) return CU_MODES[0];
    var s = need(short);
    if (s !== null && s <= c) return CU_MODES[1];
    return CU_MODES[2];
  }

  // The number the narrow Filters button shows: the filters it hides. Sort is
  // an order and Unread has its own visible toggle, so neither counts.
  function activeFilterCount(settings) {
    var s = isPlainObject(settings) ? settings : {};
    return (s.folderFilter ? 1 : 0) + (s.tagFilter ? 1 : 0);
  }

  // The panel's transient view state (#33, spec section 6). Never persisted.
  function freshTransient() {
    return { openRowId: null, filtersOpen: false, openInfoId: null, drawerEdit: null };
  }

  // One transition of spec section 6's table. Row actions, refresh, filters and
  // the cap are identity here: reconcileTransient handles a row they remove.
  function nextTransient(t, ev) {
    var cur = isPlainObject(t) ? t : {};
    var out = {
      openRowId: typeof cur.openRowId === 'string' && cur.openRowId ? cur.openRowId : null,
      filtersOpen: cur.filtersOpen === true,
      openInfoId: typeof cur.openInfoId === 'string' && cur.openInfoId ? cur.openInfoId : null,
      drawerEdit: isPlainObject(cur.drawerEdit) ? cur.drawerEdit : null,
    };
    var type = isPlainObject(ev) ? ev.type : null;
    // drawerEdit survives every transition: it is the only copy of what was
    // typed until the field commits, and only that commit clears it.
    if (TRANSIENT_RESET_EVENTS.indexOf(type) !== -1) {
      return { openRowId: null, filtersOpen: false, openInfoId: null, drawerEdit: out.drawerEdit };
    }
    // #43: an explanation inside the drawer closes with it, and when another
    // row's drawer opens instead.
    var drawerInfo = DRAWER_INFO_KEYS.indexOf(out.openInfoId) !== -1;
    if (type === 'row-more' && typeof ev.id === 'string' && ev.id) {
      out.openRowId = out.openRowId === ev.id ? null : ev.id;
      if (drawerInfo) out.openInfoId = null;
      return out;
    }
    if (type === 'filters') { out.filtersOpen = !out.filtersOpen; return out; }
    // #39: a tap anywhere but the open drawer and its toggle closes the drawer.
    if (type === 'dismiss') { out.openRowId = null; if (drawerInfo) out.openInfoId = null; return out; }
    if (type === 'info' && Object.prototype.hasOwnProperty.call(INFO_KEYS, ev.key)) {
      out.openInfoId = out.openInfoId === ev.key ? null : ev.key;
      return out;
    }
    return out;
  }

  // After every model build: an open row that is not rendered (refreshed,
  // filtered, capped or archived away) closes, so it cannot reopen by itself
  // when it returns; an info key the view does not render closes too. An
  // uncommitted edit is kept (see nextTransient).
  function reconcileTransient(t, renderedIds, infoKeys) {
    var out = nextTransient(t, null);
    var ids = Array.isArray(renderedIds) ? renderedIds : [];
    var keys = Array.isArray(infoKeys) ? infoKeys : [];
    if (out.openRowId !== null && ids.indexOf(out.openRowId) === -1) out.openRowId = null;
    if (out.openInfoId !== null && keys.indexOf(out.openInfoId) === -1) out.openInfoId = null;
    if (out.openRowId === null && DRAWER_INFO_KEYS.indexOf(out.openInfoId) !== -1) out.openInfoId = null;
    return out;
  }

  // #43: the drawer's tag and note popup. { id, field } names the open one;
  // it is runtime state only, never saved. Opening the one already open
  // closes it; any other event closes it.
  var EDITOR_FIELDS = Object.freeze(['tag', 'note']);

  function nextEditor(editor, ev) {
    var cur = isPlainObject(editor) && typeof editor.id === 'string' && editor.id
      && EDITOR_FIELDS.indexOf(editor.field) !== -1 ? { id: editor.id, field: editor.field } : null;
    var e = isPlainObject(ev) ? ev : {};
    if (e.type === 'open' && typeof e.id === 'string' && e.id && EDITOR_FIELDS.indexOf(e.field) !== -1) {
      return cur && cur.id === e.id && cur.field === e.field ? null : { id: e.id, field: e.field };
    }
    if (e.type === 'close') return null;
    return cur;
  }

  // The popup lives inside its row's drawer, so it closes whenever that
  // drawer is not the open one: a view change, collapse, auto-hide, a
  // breakpoint cross, the row leaving the list, or a tap away all close the
  // drawer, and with it the popup.
  function reconcileEditor(editor, openRowId) {
    var cur = nextEditor(editor, null);
    return cur && cur.id === openRowId ? cur : null;
  }

  // An attribute-equals selector part. Quotes and backslashes are dropped, not
  // escaped: ids and keys are this script's own tokens and never contain them,
  // so a value that does is forged and must not shape the selector.
  function attrSel(name, value) {
    return '[' + name + '="' + String(value).replace(/["\\]/g, '') + '"]';
  }

  // Where focus goes after a redraw (spec section 6, focus rules). ctx.ids are
  // the rows rendered before the action, in DOM order, so the successor is
  // known even when the action removes the row.
  function focusPlan(target, ctx) {
    var t = isPlainObject(target) ? target : {};
    var c = isPlainObject(ctx) ? ctx : {};
    var ids = Array.isArray(c.ids) ? c.ids : [];
    var narrow = c.narrow === true;
    var out = [];
    if (typeof t.act === 'string' && t.act) {
      var same = attrSel('data-act', t.act);
      if (t.id) same += attrSel('data-id', t.id);
      if (t.view) same += attrSel('data-view', t.view);
      if (t.info) same += attrSel('data-info', t.info);
      out.push(same);
      if (t.id) {
        var at = ids.indexOf(String(t.id));
        var equiv = narrow ? (c.view === 'catchup' ? 'read' : 'row-more') : t.act;
        if (at !== -1) {
          if (at + 1 < ids.length) out.push(attrSel('data-act', equiv) + attrSel('data-id', ids[at + 1]));
          if (at > 0) out.push(attrSel('data-act', equiv) + attrSel('data-id', ids[at - 1]));
        }
      }
    }
    out.push(narrow ? '#' + VIEW_HEADING_ID : attrSel('data-act', 'view') + attrSel('aria-pressed', 'true'));
    return out;
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
      if (v === 'unread') return row.unread > 0 || row.authorState === 'unchecked';
      if (v === 'pinned') return row.pinned;
      if (v === 'draft') return row.hasDraft;
      if (v === 'subscribed') return row.subscribed;
      if (v === 'archived') return row.archived;
      if (v === 'visited') return row.lastVisitedAt > 0;
      if (v === 'started') return row.mineRole === 'started';
      if (v === 'posted') return row.mineRole === 'posted';
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
  // this lists one that is never requested. #2 added user forumthreads and
  // forumposts; #10 added user profile (the karma fallback).
  var CUSTOM_KEY_SELECTIONS = Object.freeze({
    user: Object.freeze(['forumsubscribedthreads', 'forumfeed', 'forumthreads', 'forumposts', 'profile']),
    forum: Object.freeze(['categories', 'thread', 'posts']),
  });

  var CUSTOM_KEY_TITLE = 'Forum Command Center';

  // Verified (#45): on 2026-10-09 the owner generated a custom key link on
  // torn.com and it matched buildCustomKeyUrl() exactly, character for
  // character. tests/custom-key.test.js pins that string. If Torn ever
  // changes its format, change it here and nowhere else.
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
      unfiledAt: unfiledIndex(org),
      collapsedFolders: Array.isArray(org.collapsedFolders) ? org.collapsedFolders.slice() : [],
    };
  }

  // #45: where Unfiled sits, clamped to the folder list. An organizer built
  // without the field (a caller's literal) has Unfiled last.
  function unfiledIndex(org) {
    var n = org && Array.isArray(org.folders) ? org.folders.length : 0;
    return clamp(toInt(org ? org.unfiledAt : n, n), 0, n);
  }

  // #45: the one order the user controls: every folder's key, with
  // UNFILED_KEY at its place among them. Settings lists it; Catch up groups
  // by it.
  function folderOrderKeys(org) {
    var keys = org.folders.map(function (f) { return folderKey(f.id); });
    keys.splice(unfiledIndex(org), 0, UNFILED_KEY);
    return keys;
  }

  // A new organizer whose folders follow keys (a permutation of
  // folderOrderKeys), renumbered 0..n-1, with Unfiled where keys put it.
  function withFolderOrder(org, keys) {
    var next = cloneOrganizer(org);
    var byId = {};
    next.folders.forEach(function (f) { byId[f.id] = f; });
    var folders = [];
    for (var i = 0; i < keys.length; i += 1) {
      if (keys[i] === UNFILED_KEY) { next.unfiledAt = folders.length; continue; }
      var id = folderIdOfKey(keys[i]);
      if (id === null || !Object.prototype.hasOwnProperty.call(byId, id)) continue;
      var f = byId[id];
      delete byId[id];
      f.order = folders.length;
      folders.push(f);
    }
    next.folders = folders;
    next.unfiledAt = clamp(next.unfiledAt, 0, folders.length);
    return next;
  }

  // Moves a folder, or Unfiled, one place up (delta -1) or down (+1). At
  // either end, or for a key that is not in the order, the organizer is
  // returned as it was (the same object), so the caller can tell.
  function moveFolder(org, key, delta) {
    var keys = folderOrderKeys(org);
    var i = keys.indexOf(key);
    var j = i + (delta < 0 ? -1 : 1);
    if (i === -1 || j < 0 || j >= keys.length) return org;
    keys[i] = keys[j];
    keys[j] = key;
    return withFolderOrder(org, keys);
  }

  function isFolderCollapsed(org, key) {
    return Array.isArray(org.collapsedFolders) && org.collapsedFolders.indexOf(key) !== -1;
  }

  // Collapsing only hides a group's rows on this device; it changes nothing
  // about the threads. An unknown key changes nothing.
  function toggleFolderCollapsed(org, key) {
    if (folderOrderKeys(org).indexOf(key) === -1) return org;
    var next = cloneOrganizer(org);
    var at = next.collapsedFolders.indexOf(key);
    if (at === -1) next.collapsedFolders.push(key);
    else next.collapsedFolders.splice(at, 1);
    return next;
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

  // #47: a folder claims any number of forums, and a forum is claimed by one
  // folder at most, so auto-filing never has to choose. A claim another
  // folder holds is refused (the same organizer comes back); it is never
  // moved, because Settings only offers the forums nobody claims.
  function claimForum(org, folderId, forumId) {
    var f = toInt(forumId, 0);
    if (f <= 0 || folderFor(org, f)) return org;
    var i = org.folders.findIndex(function (x) { return x.id === folderId; });
    if (i === -1 || org.folders[i].forumIds.length >= MAX_CLAIMS) return org;
    var next = cloneOrganizer(org);
    next.folders[i].forumIds.push(f);
    return next;
  }

  // #47: removing a claim changes only future auto-filing. Threads already
  // filed keep their folder, because by then the filing is theirs.
  function unclaimForum(org, folderId, forumId) {
    var f = toInt(forumId, 0);
    var i = org.folders.findIndex(function (x) { return x.id === folderId; });
    if (i === -1 || org.folders[i].forumIds.indexOf(f) === -1) return org;
    var next = cloneOrganizer(org);
    next.folders[i].forumIds = next.folders[i].forumIds.filter(function (x) { return x !== f; });
    return next;
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

  // #43 (PR #44 review): the drawer popup's Save adds a tag, never removes
  // one. Normalised exactly as toggleTag does. A tag already there leaves the
  // organizer as it was (the same object), so the caller can say so.
  function hasTag(org, threadId, tag) {
    var clean = safeString(tag, 48).trim().toLowerCase();
    var e = org && org.threads ? org.threads[String(threadId)] : null;
    return !!(clean && e && Array.isArray(e.tags) && e.tags.indexOf(clean) !== -1);
  }

  function addTag(org, threadId, tag) {
    var clean = safeString(tag, 48).trim().toLowerCase();
    if (!clean || hasTag(org, threadId, clean)) return org;
    return toggleTag(org, threadId, clean);
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
    // #45: Unfiled keeps its neighbours. Last stays last, so a new folder
    // lands above it; otherwise it stays just above the folder it preceded.
    var at = unfiledIndex(org);
    var after = at < org.folders.length ? org.folders[at].id : null;
    if (i === -1) next.folders.push(f);
    else next.folders[i] = f;
    next.folders.sort(function (a, b) { return a.order - b.order; });
    // #47 (PR #48 review): a forum another folder holds first stays there.
    next.folders = canonicalClaims(next.folders);
    var j = after === null ? -1 : next.folders.findIndex(function (x) { return x.id === after; });
    next.unfiledAt = j === -1 ? next.folders.length : j;
    return next;
  }

  // Deleting a folder un-files its threads. It never deletes them, because the
  // notes, tags and drafts hanging off a thread are the user's work and the
  // folder was only a label.
  function deleteFolder(org, folderId) {
    var next = cloneOrganizer(org);
    // #45: Unfiled keeps its place among the folders that remain.
    var gone = org.folders.findIndex(function (f) { return f.id === folderId; });
    if (gone !== -1 && gone < next.unfiledAt) next.unfiledAt -= 1;
    next.collapsedFolders = next.collapsedFolders.filter(function (k) { return k !== folderKey(folderId); });
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

  function nextDrafts(drafts) {
    var next = { v: SCHEMA_VERSION, byThread: Object.assign({}, (drafts && drafts.byThread) || {}) };
    if (drafts && drafts.free) next.free = Object.assign({}, drafts.free);
    return next;
  }

  function saveDraft(drafts, threadId, text, now, title, lang) {
    var id = String(toInt(threadId, 0));
    if (id === '0') return drafts;
    var next = nextDrafts(drafts);
    var clean = safeString(text, DRAFT_MAX_CHARS);
    if (!clean.trim()) {
      delete next.byThread[id];
      return next;
    }
    var entry = {
      text: clean,
      updatedAt: Math.max(0, toInt(now, 0)),
      title: safeString(title, 300) || (next.byThread[id] ? next.byThread[id].title : ''),
    };
    var l = draftLangField(lang);
    if (l) entry.lang = l;
    next.byThread[id] = entry;
    return next;
  }

  function isFreeKey(key) { return /^n[0-9]{1,12}$/.test(String(key)); }

  function draftFor(drafts, key) {
    var id = String(key);
    var bag = isFreeKey(id) ? (drafts && drafts.free) : (drafts && drafts.byThread);
    return bag && Object.prototype.hasOwnProperty.call(bag, id) ? bag[id] : null;
  }

  function draftLangOf(entry) { return entry && draftLangField(entry.lang) ? entry.lang : 'text'; }

  function deleteDraft(drafts, threadId) {
    var next = nextDrafts(drafts);
    delete next.byThread[String(threadId)];
    return next;
  }

  function newFreeDraft(drafts, now, lang) {
    var next = nextDrafts(drafts);
    next.free = next.free || {};
    if (Object.keys(next.free).length >= FREE_DRAFTS_MAX) return { drafts: drafts, id: null };
    // Ids stay within the 12 digits the normaliser accepts, wrapping rather
    // than growing a thirteenth.
    var n = Math.max(1, toInt(now, 0) % 1000000000000);
    while (Object.prototype.hasOwnProperty.call(next.free, 'n' + n)) n = n >= 999999999999 ? 1 : n + 1;
    var names = Object.keys(next.free).map(function (k) { return next.free[k].name; });
    var num = 1;
    while (names.indexOf('Untitled ' + num) !== -1) num += 1;
    var entry = { name: 'Untitled ' + num, text: '', updatedAt: Math.max(0, toInt(now, 0)) };
    var l = draftLangField(lang);
    if (l) entry.lang = l;
    next.free['n' + n] = entry;
    return { drafts: next, id: 'n' + n };
  }

  function saveFreeDraft(drafts, id, text, now, name, lang) {
    if (!isFreeKey(id) || !drafts.free || !drafts.free[id]) return drafts;
    var next = nextDrafts(drafts);
    var entry = {
      name: safeString(name, FREE_NAME_MAX).trim() || next.free[id].name,
      text: safeString(text, DRAFT_MAX_CHARS),
      updatedAt: Math.max(0, toInt(now, 0)),
    };
    var l = draftLangField(lang);
    if (l) entry.lang = l;
    next.free[id] = entry;
    return next;
  }

  function deleteFreeDraft(drafts, id) {
    var next = nextDrafts(drafts);
    if (next.free) delete next.free[String(id)];
    return next;
  }

  function draftList(drafts) {
    var out = [];
    var ids = Object.keys((drafts && drafts.byThread) || {});
    ids.forEach(function (id) {
      var d = drafts.byThread[id];
      out.push({ kind: 'thread', key: id, threadId: id, text: d.text, updatedAt: d.updatedAt, title: d.title, lang: draftLangOf(d) });
    });
    Object.keys((drafts && drafts.free) || {}).forEach(function (id) {
      var f = drafts.free[id];
      out.push({ kind: 'free', key: id, threadId: null, text: f.text, updatedAt: f.updatedAt, title: f.name, name: f.name, lang: draftLangOf(f) });
    });
    return out.sort(function (a, b) { return b.updatedAt - a.updatedAt; });
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

  function encodeState(organizer, drafts, btoaFn, badges) {
    var payload = {
      v: SCHEMA_VERSION,
      folders: organizer.folders.map(function (f) {
        return { id: f.id, name: f.name, order: f.order, forumIds: f.forumIds.slice() };
      }),
      // #45: where Unfiled sits in the order. Which groups are collapsed is
      // this device's view, so it is not exported.
      unfiledAt: unfiledIndex(organizer),
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
      if (drafts.byThread[dids[j]].lang) payload.drafts[dids[j]].lang = drafts.byThread[dids[j]].lang;
    }
    // #58: free drafts travel with the rest of the user's work.
    var fids = Object.keys((drafts && drafts.free) || {});
    if (fids.length) {
      payload.freeDrafts = {};
      fids.forEach(function (id) { payload.freeDrafts[id] = Object.assign({}, drafts.free[id]); });
    }
    if (badges) payload.badges = exportBadges(badges);
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

  // #45: an import carries the export's folder order. The folders it names
  // take its order, with Unfiled where it put it (last for an export made
  // before #45); folders only this device has keep their relative order and
  // join above Unfiled when it is last, else at the end.
  function importedOrder(org, payload) {
    var mine = folderOrderKeys(org).filter(function (k) { return k !== UNFILED_KEY; });
    var theirs = [];
    var listed = payload.folders.map(function (raw, i) { return normaliseFolder(raw, i); })
      .filter(function (x) { return !!x; })
      .sort(function (a, b) { return a.order - b.order; });
    for (var i = 0; i < listed.length; i += 1) {
      var lk = folderKey(listed[i].id);
      if (mine.indexOf(lk) !== -1 && theirs.indexOf(lk) === -1) theirs.push(lk);
    }
    var at = clamp(toInt(payload.unfiledAt, theirs.length), 0, theirs.length);
    var keys = theirs.slice();
    keys.splice(at, 0, UNFILED_KEY);
    var rest = mine.filter(function (k) { return theirs.indexOf(k) === -1; });
    if (at === theirs.length) keys.splice.apply(keys, [at, 0].concat(rest));
    else keys = keys.concat(rest);
    return keys;
  }

  // Import is additive and reports its effect before it is applied. Nothing is
  // written on a rejection, so a partially valid export cannot half-land.
  function importState(organizer, drafts, text, atobFn, badges) {
    var decoded = decodeState(text, atobFn);
    if (!decoded.ok) return decoded;
    var payload = decoded.payload;

    var org = cloneOrganizer(organizer);
    var addedFolders = 0;
    var changedThreads = 0;
    var addedDrafts = 0;
    var wanted = {};

    if (Array.isArray(payload.folders)) {
      for (var i = 0; i < payload.folders.length && i < 40; i += 1) {
        var f = normaliseFolder(payload.folders[i], org.folders.length);
        if (!f) continue;
        // #47: every claim travels. Claims are applied once the order is
        // known, below.
        if (!Object.prototype.hasOwnProperty.call(wanted, f.id)) wanted[f.id] = f.forumIds.slice();
        if (!org.folders.some(function (x) { return x.id === f.id; })) {
          f.forumIds = [];
          org.folders.push(f);
          addedFolders += 1;
        }
      }
      org.folders.sort(function (a, b) { return a.order - b.order; });
      org = withFolderOrder(org, importedOrder(org, payload));
    }
    // #47 (PR #48 review): this device's claims are made canonical first, so a
    // forum it already gave to a folder keeps that folder; then the export's
    // claims are added in the final folder order, so a forum the export gave
    // to two folders lands in the first of them.
    org.folders = canonicalClaims(org.folders);
    for (var wf = 0; wf < org.folders.length; wf += 1) {
      var want = Object.prototype.hasOwnProperty.call(wanted, org.folders[wf].id) ? wanted[org.folders[wf].id] : [];
      for (var w = 0; w < want.length; w += 1) org = claimForum(org, org.folders[wf].id, want[w]);
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

    var nextDraftsBag = nextDrafts(drafts);
    if (isPlainObject(payload.drafts)) {
      var dids = Object.keys(payload.drafts);
      for (var k = 0; k < dids.length && k < 500; k += 1) {
        if (!/^[0-9]{1,12}$/.test(dids[k])) continue;
        var d = payload.drafts[dids[k]];
        if (!isPlainObject(d)) continue;
        var textValue = safeString(d.text, DRAFT_MAX_CHARS);
        if (!textValue) continue;
        var incomingAt = Math.max(0, toInt(d.updatedAt, 0));
        var current = nextDraftsBag.byThread[dids[k]];
        if (current && current.updatedAt >= incomingAt) continue;
        nextDraftsBag.byThread[dids[k]] = {
          text: textValue, updatedAt: incomingAt, title: safeString(d.title, 300),
        };
        var importedLang = draftLangField(d.lang);
        if (importedLang) nextDraftsBag.byThread[dids[k]].lang = importedLang;
        addedDrafts += 1;
      }
    }
    if (isPlainObject(payload.freeDrafts)) {
      var incomingFree = normaliseDrafts({ v: SCHEMA_VERSION, byThread: {}, free: payload.freeDrafts }).free || {};
      nextDraftsBag.free = nextDraftsBag.free || {};
      Object.keys(incomingFree).forEach(function (id) {
        var have = nextDraftsBag.free[id];
        if (have && have.updatedAt >= incomingFree[id].updatedAt) return;
        if (!have && Object.keys(nextDraftsBag.free).length >= FREE_DRAFTS_MAX) return;
        nextDraftsBag.free[id] = incomingFree[id];
        addedDrafts += 1;
      });
    }

    var nextBadges = badges ? normaliseBadges(badges) : null;
    var addedBadges = 0;
    if (nextBadges && isPlainObject(payload.badges)) {
      var merged = mergeBadgeRecords(nextBadges, payload.badges);
      addedBadges = Object.keys(merged.earned).filter(function (id) {
        return !Object.prototype.hasOwnProperty.call(nextBadges.earned, id);
      }).length;
      nextBadges = merged;
    }

    return {
      ok: true,
      organizer: org,
      drafts: nextDraftsBag,
      badges: nextBadges,
      summary: { addedFolders: addedFolders, changedThreads: changedThreads, addedDrafts: addedDrafts,
        addedBadges: addedBadges },
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

  // -- badges (issue #9) ------------------------------------------------------
  // Spec: docs/superpowers/specs/2026-10-08-badges-design.md. Every rule here is
  // pure and takes the time as an argument. A day is a Torn day (UTC).

  var DAY_MS = 86400000;

  function tctDay(now) {
    return Math.floor(toInt(now, 0) / DAY_MS);
  }

  // Strict: a missed day resets the run. The clock going backwards (a fix to a
  // wrong device clock; UTC has no other way back) rebases to today without
  // crediting or costing anything, so a stored future day cannot block later
  // days.
  function creditDay(streak, today) {
    var s = { current: streak.current, best: streak.best, lastDay: streak.lastDay };
    var d = toInt(today, 0);
    if (s.lastDay < 0) {
      s.current = 1;
      s.lastDay = d;
      s.best = Math.max(s.best, 1);
      return { streak: s, credited: true };
    }
    var delta = d - s.lastDay;
    if (delta === 0) return { streak: s, credited: false };
    if (delta < 0) { s.lastDay = d; return { streak: s, credited: false }; }
    s.current = delta === 1 ? s.current + 1 : 1;
    s.lastDay = d;
    s.best = Math.max(s.best, s.current);
    return { streak: s, credited: true };
  }

  function streakView(streak, today) {
    if (!streak || streak.lastDay < 0) {
      return { state: 'none', current: 0, best: streak ? streak.best : 0 };
    }
    var delta = toInt(today, 0) - streak.lastDay;
    if (delta <= 0) return { state: 'counted', current: streak.current, best: streak.best };
    if (delta === 1) return { state: 'open', current: streak.current, best: streak.best };
    return { state: 'broken', current: 0, best: streak.best };
  }

  // A focused thread visit: 15 s on one thread route, counted only while the
  // page is visible and focused. Time away is never added (an inactive sample
  // clears lastAt), a route change starts again, and one sample adds at most
  // DWELL_MAX_STEP_MS so a throttled or sleeping timer cannot fake 15 s.
  var DWELL_MS = 15000;
  var DWELL_TICK_MS = 1000;
  var DWELL_MAX_STEP_MS = 2000;

  function freshDwell() {
    return { threadId: '', accMs: 0, lastAt: 0, done: false };
  }

  function dwellStep(dwell, threadId, active, now) {
    var d = dwell || freshDwell();
    var id = threadId ? String(threadId) : '';
    var t = toInt(now, 0);
    if (id !== d.threadId) {
      return { dwell: { threadId: id, accMs: 0, lastAt: id && active ? t : 0, done: false }, credit: null };
    }
    var next = { threadId: d.threadId, accMs: d.accMs, lastAt: d.lastAt, done: d.done };
    if (next.done || !id) return { dwell: next, credit: null };
    if (!active) { next.lastAt = 0; return { dwell: next, credit: null }; }
    if (next.lastAt === 0) { next.lastAt = t; return { dwell: next, credit: null }; }
    next.accMs += clamp(t - next.lastAt, 0, DWELL_MAX_STEP_MS);
    next.lastAt = t;
    if (next.accMs >= DWELL_MS) {
      next.done = true;
      return { dwell: next, credit: id };
    }
    return { dwell: next, credit: null };
  }

  var BADGE_VISIT_IDS_MAX = 200;   // a storage bound on one day's ids, not a rule
  var BADGE_BACKLOG_IDS_MAX = 100;
  var BADGE_FORUMS_MAX = 64;
  var BADGE_EARNED_MAX = 64;

  function freshBadges() {
    return {
      v: SCHEMA_VERSION,
      visits: 0,
      checkinDays: 0,
      bigBacklog: 0,
      firstCheckinAt: 0,
      streak: { current: 0, best: 0, lastDay: -1 },
      forums: [],
      today: { day: -1, firstLook: -1, backlogIds: [], visitIds: [] },
      earned: {},
    };
  }

  function badgeIdList(raw, max) {
    var out = [];
    if (!Array.isArray(raw)) return out;
    for (var i = 0; i < raw.length && out.length < max; i += 1) {
      var s = raw[i];
      if (typeof s !== 'string' || !/^[0-9]{1,12}$/.test(s)) continue;
      if (out.indexOf(s) === -1) out.push(s);
    }
    return out;
  }

  // Total, bounded, and it reads back its own output byte for byte: loadKey calls
  // anything else damage. Counters are top-level on purpose, so a later counter
  // is an absent top-level key that isRecoveredValue forgives. streak and today
  // are frozen for v1; changing them needs a v bump and a migration.
  function normaliseBadges(raw) {
    var out = freshBadges();
    if (!isPlainObject(raw)) return out;
    if (toInt(raw.v, 0) > SCHEMA_VERSION) return out;
    out.visits = Math.max(0, toInt(raw.visits, 0));
    out.checkinDays = Math.max(0, toInt(raw.checkinDays, 0));
    out.bigBacklog = Math.max(0, toInt(raw.bigBacklog, 0));
    out.firstCheckinAt = Math.max(0, toInt(raw.firstCheckinAt, 0));
    var s = isPlainObject(raw.streak) ? raw.streak : {};
    out.streak = {
      current: Math.max(0, toInt(s.current, 0)),
      best: Math.max(0, toInt(s.best, 0)),
      lastDay: Math.max(-1, toInt(s.lastDay, -1)),
    };
    if (out.streak.best < out.streak.current) out.streak.best = out.streak.current;
    if (Array.isArray(raw.forums)) {
      for (var i = 0; i < raw.forums.length && out.forums.length < BADGE_FORUMS_MAX; i += 1) {
        var f = raw.forums[i];
        if (typeof f !== 'number' || f <= 0 || Math.floor(f) !== f) continue;
        if (out.forums.indexOf(f) === -1) out.forums.push(f);
      }
    }
    var t = isPlainObject(raw.today) ? raw.today : {};
    out.today = {
      day: Math.max(-1, toInt(t.day, -1)),
      firstLook: Math.max(-1, toInt(t.firstLook, -1)),
      backlogIds: badgeIdList(t.backlogIds, BADGE_BACKLOG_IDS_MAX),
      visitIds: badgeIdList(t.visitIds, BADGE_VISIT_IDS_MAX),
    };
    if (isPlainObject(raw.earned)) {
      var ids = Object.keys(raw.earned);
      var kept = 0;
      for (var j = 0; j < ids.length && kept < BADGE_EARNED_MAX; j += 1) {
        var at = raw.earned[ids[j]];
        if (!/^[a-z0-9-]{1,32}$/.test(ids[j])) continue;
        if (typeof at !== 'number' || at <= 0 || Math.floor(at) !== at) continue;
        out.earned[ids[j]] = at;
        kept += 1;
      }
    }
    return out;
  }

  var STARTER_FOLDER_IDS = Object.freeze(['guides', 'scripts', 'faction']);
  var BADGE_GROUPS = Object.freeze([
    Object.freeze({ id: 'setup', label: 'Setup' }),
    Object.freeze({ id: 'presence', label: 'Presence' }),
    Object.freeze({ id: 'attention', label: 'Attention' }),
    Object.freeze({ id: 'care', label: 'Care' }),
    Object.freeze({ id: 'streak', label: 'Streaks' }),
  ]);
  var BADGE_TIER_LABELS = Object.freeze({ bronze: 'Bronze', silver: 'Silver', gold: 'Gold', legend: 'Legendary' });
  var BADGE_TIER_RANK = Object.freeze({ bronze: 1, silver: 2, gold: 3, legend: 4 });
  var BADGE_UNITS = Object.freeze({ visits: 'focused visits', forums: 'forums', best: 'days' });

  function badgeDef(id, name, group, tier, glyph, metric, target, rule) {
    return Object.freeze({ id: id, group: group, tier: tier, name: name, glyph: glyph,
      metric: metric, target: target, rule: rule });
  }

  // The whole catalogue. The evaluator, the progress bars and the Settings text
  // all read this table, so a rule and its description cannot drift apart.
  var BADGES = Object.freeze([
    badgeDef('switched-on', 'Switched on', 'setup', 'bronze', 'plug', 'switchedOn', 1,
      'Save an API key and finish a refresh.'),
    badgeDef('first-folder', 'First folder', 'setup', 'bronze', 'folder', 'ownFoldersFilled', 1,
      'Create a folder of your own and file a thread in it.'),
    badgeDef('caught-up', 'Caught up', 'presence', 'bronze', 'check', 'checkinDays', 1,
      'Finish a Torn day with Catch up empty.'),
    badgeDef('reader', 'Reader', 'attention', 'bronze', 'book', 'visits', 25,
      'Make 25 focused thread visits.'),
    badgeDef('bookworm', 'Bookworm', 'attention', 'gold', 'book', 'visits', 500,
      'Make 500 focused thread visits.'),
    badgeDef('explorer', 'Explorer', 'attention', 'bronze', 'compass', 'forums', 3,
      'Make focused visits in 3 different forums.'),
    badgeDef('well-travelled', 'Well travelled', 'attention', 'silver', 'compass', 'forums', 7,
      'Make focused visits in 7 different forums.'),
    badgeDef('cartographer', 'Cartographer', 'attention', 'gold', 'compass', 'forums', 12,
      'Make focused visits in 12 different forums.'),
    badgeDef('tidy-desk', 'Tidy desk', 'care', 'silver', 'trays', 'tidy', 1,
      'Follow at least 10 threads and leave none of them Unfiled.'),
    badgeDef('backlog-buster', 'Backlog buster', 'care', 'silver', 'broom', 'bigBacklog', 20,
      'Start a Torn day with 20 or more in Catch up, make focused visits to 10 of those threads, '
        + 'and finish with Catch up empty.'),
    badgeDef('streak-3', 'Three days', 'streak', 'bronze', 'flame', 'best', 3,
      'Finish 3 Torn days in a row with Catch up empty.'),
    badgeDef('streak-10', 'Ten days', 'streak', 'silver', 'flame', 'best', 10,
      'Finish 10 Torn days in a row with Catch up empty.'),
    badgeDef('streak-25', 'Twenty-five days', 'streak', 'silver', 'flame', 'best', 25,
      'Finish 25 Torn days in a row with Catch up empty.'),
    badgeDef('streak-100', 'Hundred days', 'streak', 'gold', 'flame', 'best', 100,
      'Finish 100 Torn days in a row with Catch up empty.'),
    badgeDef('streak-500', 'Five hundred days', 'streak', 'legend', 'flame', 'best', 500,
      'Finish 500 Torn days in a row with Catch up empty.'),
  ]);

  function badgeById(id) {
    for (var i = 0; i < BADGES.length; i += 1) if (BADGES[i].id === id) return BADGES[i];
    return null;
  }

  function badgeFacts(input) {
    var org = input.organizer;
    var feed = input.feed;
    var filed = {};
    var ids = Object.keys(org.threads);
    for (var i = 0; i < ids.length; i += 1) {
      var fid = org.threads[ids[i]].folderId;
      if (fid) filed[fid] = (filed[fid] || 0) + 1;
    }
    var own = 0;
    for (var j = 0; j < org.folders.length; j += 1) {
      var f = org.folders[j];
      if (STARTER_FOLDER_IDS.indexOf(f.id) === -1 && filed[f.id] > 0) own += 1;
    }
    var subs = feed.subscribed || [];
    var unfiled = 0;
    for (var k = 0; k < subs.length; k += 1) {
      var e = Object.prototype.hasOwnProperty.call(org.threads, String(subs[k].id)) ? org.threads[String(subs[k].id)] : null;
      if (!e || !e.folderId) unfiled += 1;
    }
    return {
      switchedOn: input.hasKey && !input.keyRejected && toInt(feed.fetchedAt, 0) > 0 ? 1 : 0,
      ownFoldersFilled: own,
      subscribed: subs.length,
      unfiledSubscribed: unfiled,
    };
  }

  function badgeMetrics(record, facts) {
    return {
      switchedOn: facts.switchedOn,
      ownFoldersFilled: facts.ownFoldersFilled,
      checkinDays: record.checkinDays,
      visits: record.visits,
      forums: record.forums.length,
      tidy: facts.subscribed >= 10 && facts.unfiledSubscribed === 0 ? 1 : 0,
      bigBacklog: record.bigBacklog,
      best: record.streak.best,
    };
  }

  function evaluateBadges(record, facts) {
    var m = badgeMetrics(record, facts);
    var newly = [];
    var progress = [];
    for (var i = 0; i < BADGES.length; i += 1) {
      var b = BADGES[i];
      var value = m[b.metric];
      var earnedAt = Object.prototype.hasOwnProperty.call(record.earned, b.id) ? record.earned[b.id] : 0;
      if (!earnedAt && value >= b.target) newly.push(b.id);
      progress.push({ id: b.id, value: Math.min(value, b.target), target: b.target, earned: earnedAt });
    }
    return { newly: newly, progress: progress };
  }

  function nextBadge(progress) {
    var best = null;
    for (var i = 0; i < progress.length; i += 1) {
      var p = progress[i];
      if (p.earned || p.value >= p.target) continue;
      if (!best || p.value / p.target > best.value / best.target) best = p;
    }
    return best;
  }

  function badgeToastText(ids, record, facts) {
    var known = [];
    for (var i = 0; i < ids.length; i += 1) {
      var b = badgeById(ids[i]);
      if (b) known.push(b);
    }
    if (!known.length) return '';
    if (known.length > 1) {
      return known.length + ' badges earned: ' + known.map(function (x) { return x.name; }).join(', ') + '.';
    }
    var one = known[0];
    var text = 'Badge earned: ' + one.name + ' (' + BADGE_TIER_LABELS[one.tier] + ').';
    var unit = Object.prototype.hasOwnProperty.call(BADGE_UNITS, one.metric) ? BADGE_UNITS[one.metric] : '';
    if (unit) {
      var value = badgeMetrics(record, facts)[one.metric];
      for (var j = 0; j < BADGES.length; j += 1) {
        var n = BADGES[j];
        if (n.metric === one.metric && n.target > one.target) {
          text += ' ' + Math.max(0, n.target - value) + ' more ' + unit + ' to ' + n.name + '.';
          break;
        }
      }
    }
    return text;
  }

  var CHECKIN_FRESH_MS = 30 * 60 * 1000;
  var BACKLOG_MIN_SIZE = 20;
  var BACKLOG_MIN_VISITS = 10;

  // A check-in: fresh data today, something followed, and nothing left in
  // Catch up. ctx.blockers is the Catch up count the panel shows (plus #4's
  // not-yet-checked rows when that mode is on); the runtime computes it.
  function checkinEligible(record, ctx, day) {
    var now = toInt(ctx.now, 0);
    var fetchedAt = toInt(ctx.fetchedAt, 0);
    return record.today.day === day
      && record.today.firstLook >= 0
      && fetchedAt > 0
      && fetchedAt >= now - CHECKIN_FRESH_MS
      && toInt(ctx.subscribed, 0) >= 1
      && toInt(ctx.blockers, 0) === 0;
  }

  function tryCheckin(r, ctx, day) {
    if (!checkinEligible(r, ctx, day)) return;
    var res = creditDay(r.streak, day);
    r.streak = res.streak;
    if (!res.credited) return;
    r.checkinDays += 1;
    if (!r.firstCheckinAt) r.firstCheckinAt = toInt(ctx.now, 0);
    if (r.today.firstLook >= BACKLOG_MIN_SIZE) {
      var hits = 0;
      for (var i = 0; i < r.today.visitIds.length; i += 1) {
        if (r.today.backlogIds.indexOf(r.today.visitIds[i]) !== -1) hits += 1;
      }
      if (hits >= BACKLOG_MIN_VISITS) r.bigBacklog = Math.max(r.bigBacklog, r.today.firstLook);
    }
  }

  function applyBadgeEvent(record, event, ctx) {
    var before = JSON.stringify(normaliseBadges(record));
    var r = normaliseBadges(record);
    var now = toInt(ctx.now, 0);
    var day = tctDay(now);
    if (r.today.day !== day) r.today = { day: day, firstLook: -1, backlogIds: [], visitIds: [] };
    var type = event && event.type;

    if (type === 'visit') {
      var id = String(event.threadId || '');
      if (/^[0-9]{1,12}$/.test(id) && r.today.visitIds.indexOf(id) === -1
        && r.today.visitIds.length < BADGE_VISIT_IDS_MAX) {
        r.today.visitIds.push(id);
        r.visits += 1;
        var forumId = toInt(event.forumId, 0);
        if (forumId > 0 && r.forums.indexOf(forumId) === -1 && r.forums.length < BADGE_FORUMS_MAX) {
          r.forums.push(forumId);
        }
      }
    } else if (type === 'refreshed') {
      if (r.today.firstLook < 0) {
        r.today.firstLook = Math.max(0, toInt(ctx.blockers, 0));
        r.today.backlogIds = badgeIdList(ctx.catchUpIds || [], BADGE_BACKLOG_IDS_MAX);
      }
      tryCheckin(r, ctx, day);
    } else if (type === 'catchup-changed') {
      tryCheckin(r, ctx, day);
    }

    var stamped = [];
    var ev = evaluateBadges(r, ctx.facts);
    for (var i = 0; i < ev.newly.length; i += 1) {
      if (Object.keys(r.earned).length >= BADGE_EARNED_MAX) break;
      r.earned[ev.newly[i]] = now;
      stamped.push(ev.newly[i]);
    }
    return { record: r, newly: stamped, changed: JSON.stringify(r) !== before };
  }

  function exportBadges(record) {
    var r = normaliseBadges(record);
    return {
      visits: r.visits,
      checkinDays: r.checkinDays,
      bigBacklog: r.bigBacklog,
      firstCheckinAt: r.firstCheckinAt,
      streak: r.streak,
      forums: r.forums,
      earned: r.earned,
    };
  }

  // Max, never sum: importing your own export twice changes nothing, and a
  // second device cannot inflate the first. Two devices' real activity is
  // under-counted, which is the safe direction.
  function mergeBadgeRecords(local, incoming) {
    var a = normaliseBadges(local);
    var b = normaliseBadges(Object.assign({ v: SCHEMA_VERSION }, incoming));
    var out = normaliseBadges(a);
    out.visits = Math.max(a.visits, b.visits);
    out.checkinDays = Math.max(a.checkinDays, b.checkinDays);
    out.bigBacklog = Math.max(a.bigBacklog, b.bigBacklog);
    out.firstCheckinAt = a.firstCheckinAt && b.firstCheckinAt
      ? Math.min(a.firstCheckinAt, b.firstCheckinAt)
      : (a.firstCheckinAt || b.firstCheckinAt);
    var takeB = b.streak.lastDay > a.streak.lastDay
      || (b.streak.lastDay === a.streak.lastDay && b.streak.current > a.streak.current);
    var chosen = takeB ? b.streak : a.streak;
    out.streak = { current: chosen.current, best: Math.max(a.streak.best, b.streak.best), lastDay: chosen.lastDay };
    for (var i = 0; i < b.forums.length && out.forums.length < BADGE_FORUMS_MAX; i += 1) {
      if (out.forums.indexOf(b.forums[i]) === -1) out.forums.push(b.forums[i]);
    }
    var ids = Object.keys(b.earned);
    for (var j = 0; j < ids.length; j += 1) {
      var has = Object.prototype.hasOwnProperty.call(out.earned, ids[j]);
      if (!has && Object.keys(out.earned).length >= BADGE_EARNED_MAX) continue;
      if (!has || b.earned[ids[j]] < out.earned[ids[j]]) out.earned[ids[j]] = b.earned[ids[j]];
    }
    return out;
  }

  // Icons are SVG paths written in ASCII: no emoji, no icon font, no <text>.
  // Frames carry the tier by shape as well as color.
  var BADGE_FRAMES = Object.freeze({
    bronze: 'M1 8a7 7 0 1 0 14 0a7 7 0 1 0 -14 0zM2.5 8a5.5 5.5 0 1 1 11 0a5.5 5.5 0 1 1 -11 0z',
    silver: 'M8 0.8L14.2 4.4V11.6L8 15.2L1.8 11.6V4.4ZM8 2.5L12.7 5.2V10.8L8 13.5L3.3 10.8V5.2Z',
    gold: 'M5.1 1H10.9L15 5.1V10.9L10.9 15H5.1L1 10.9V5.1ZM5.7 2.5H10.3L13.5 5.7V10.3L10.3 13.5H5.7L2.5 10.3V5.7Z',
    legend: 'M1 8a7 7 0 1 0 14 0a7 7 0 1 0 -14 0zM2 8a6 6 0 1 1 12 0a6 6 0 1 1 -12 0z'
      + 'M3 8a5 5 0 1 0 10 0a5 5 0 1 0 -10 0zM4 8a4 4 0 1 1 8 0a4 4 0 1 1 -8 0z',
  });
  var BADGE_GLYPHS = Object.freeze({
    plug: 'M6 4h1v2h2V4h1v2h1v2a3 3 0 0 1 -2.5 3V12h-1v-1A3 3 0 0 1 5 8V6h1z',
    folder: 'M4.5 5.5h2.5l1 1h3.5v4.5h-7z',
    check: 'M5 8.2l1 -1 1.5 1.5 3.5 -3.5 1 1 -4.5 4.5z',
    book: 'M4.5 5.5h3v5h-3zM8.5 5.5h3v5h-3z',
    compass: 'M8 4.5l1.2 3.5 -1.2 3.5 -1.2 -3.5z',
    trays: 'M4.5 5h7v1.5h-7zM4.5 7.5h7V9h-7zM4.5 10h7v1.5h-7z',
    broom: 'M9.5 4l1 0.6 -2 3.4 1.5 0.9 -2.5 3.6 -3 -1.8 2.5 -3.4 1.4 0.8z',
    flame: 'M8 4c1.5 1.5 3 3 3 4.8A3 3 0 0 1 5 8.8C5 7.5 6 7 6.5 6c0.3 1 1 1.3 1.5 1.5C8.2 6.5 8 5.2 8 4z',
    // Chip glyphs fill the whole 16 x 16 box.
    cup: 'M3 2h10v1h2v3a3 3 0 0 1 -3 3h-0.2A4 4 0 0 1 9 11.4V13h2v2H5v-2h2v-1.6A4 4 0 0 1 4.2 9H4'
      + 'a3 3 0 0 1 -3 -3V3h2zM2.5 4.5v1.5a1.5 1.5 0 0 0 0.6 1.2V4.5zM13 4.5v2.7a1.5 1.5 0 0 0 0.5 -1.2V4.5z',
    'cup-outline': 'M3 2h10v1h2v3a3 3 0 0 1 -3 3h-0.2A4 4 0 0 1 9 11.4V13h2v2H5v-2h2v-1.6A4 4 0 0 1 4.2 9H4'
      + 'a3 3 0 0 1 -3 -3V3h2zM4.5 3.5h7v4a3.5 3.5 0 0 1 -7 0z',
    'streak-on': 'M8 1c2.5 2.5 5 5 5 8a5 5 0 0 1 -10 0c0 -2 1.5 -3 2.3 -4.5c0.5 1.5 1.5 2 2.2 2.3C7.8 5 8 3 8 1z',
    'streak-off': 'M8 1c2.5 2.5 5 5 5 8a5 5 0 0 1 -10 0c0 -2 1.5 -3 2.3 -4.5c0.5 1.5 1.5 2 2.2 2.3C7.8 5 8 3 8 1z'
      + 'M8 4.5c1.5 1.6 3.5 3.3 3.5 4.5a3.5 3.5 0 0 1 -7 0c0 -1 0.6 -1.8 1.1 -2.6c0.6 1 1.6 1.4 2.4 1.6z',
  });

  // cls is 'bronze' | 'silver' | 'gold' | 'legend' | 'locked' | 'plain'.
  // glyph names a BADGE_GLYPHS entry. framed draws the tier frame around it.
  function badgeIcon(cls, glyph, size, framed) {
    var px = toInt(size, 16);
    var color = cls === 'locked' ? 'tfcc-locked' : (cls === 'plain' ? '' : 'tfcc-tier-' + cls);
    var frameKey = cls === 'locked' ? 'bronze' : cls;
    var paths = [];
    if (framed && Object.prototype.hasOwnProperty.call(BADGE_FRAMES, frameKey)) paths.push(BADGE_FRAMES[frameKey]);
    if (Object.prototype.hasOwnProperty.call(BADGE_GLYPHS, glyph)) paths.push(BADGE_GLYPHS[glyph]);
    return '<svg class="tfcc-ico' + (color ? ' ' + color : '') + '" viewBox="0 0 16 16" width="' + px
      + '" height="' + px + '" aria-hidden="true" focusable="false">'
      + paths.map(function (d) { return '<path d="' + d + '"/>'; }).join('') + '</svg>';
  }

  // ---- #58 editor constants ----------------------------------------------
  var DRAFT_LANGS = Object.freeze(['md', 'html', 'text']);
  // #58 F1: the editor textarea's default height, by Settings menu value.
  // Small is the CSS min-height the box always had (90px).
  var EDITOR_HEIGHTS = Object.freeze({ small: 90, medium: 160, large: 260, xlarge: 400 });
  var EDITOR_HEIGHT_LABELS = Object.freeze([['small', 'Small'], ['medium', 'Medium'], ['large', 'Large'], ['xlarge', 'Extra large']]);
  var TORN_COLORS = Object.freeze([
    Object.freeze({ name: 'red', light: '#f03e3e', dark: '#ff8787' }),
    Object.freeze({ name: 'pink', light: '#d6336c', dark: '#faa2c1' }),
    Object.freeze({ name: 'grape', light: '#ae3ec9', dark: '#e599f7' }),
    Object.freeze({ name: 'violet', light: '#7048e8', dark: '#d0bfff' }),
    Object.freeze({ name: 'indigo', light: '#4263eb', dark: '#bac8ff' }),
    Object.freeze({ name: 'blue', light: '#1c7ed6', dark: '#a5d8ff' }),
    Object.freeze({ name: 'cyan', light: '#1098ad', dark: '#99e9f2' }),
    Object.freeze({ name: 'teal', light: '#0ca678', dark: '#63e6be' }),
    Object.freeze({ name: 'green', light: '#37b24d', dark: '#8ce99a' }),
    Object.freeze({ name: 'lime', light: '#66a80f', dark: '#a9e34b' }),
    Object.freeze({ name: 'yellow', light: '#e67700', dark: '#ffd43b' }),
    Object.freeze({ name: 'orange', light: '#d9480f', dark: '#ffa94d' }),
    Object.freeze({ name: 'gray1', light: '#333333', dark: '#ffffff' }),
    Object.freeze({ name: 'gray2', light: '#666666', dark: '#dddddd' }),
    Object.freeze({ name: 'gray3', light: '#999999', dark: '#aaaaaa' }),
    Object.freeze({ name: 'gray4', light: '#cccccc', dark: '#888888' }),
    Object.freeze({ name: 'gray5', light: '#ffffff', dark: '#000000' }),
  ]);
  var TORN_COLOR_NAMES = Object.freeze(TORN_COLORS.map(function (c) { return c.name; }));
  var TORN_EMOJI = Object.freeze(['angel', 'angry', 'authority', 'beard', 'beaten_up', 'blushing',
    'bored_sleepy', 'confused', 'cool', 'cry', 'disappointed', 'dizzy', 'evil', 'grin', 'hushed',
    'kissing', 'laughing', 'love_chemistry', 'money', 'moustache', 'mugger_masked', 'nerd', 'party',
    'pirate', 'sick', 'smiley', 'tired', 'tongue', 'wink', 'zip_mouth']);
  var FONT_SIZE_MIN = 8;
  var FONT_SIZE_MAX = 36;
  var SIZE_PICKS = Object.freeze([10, 12, 14, 16, 18, 20, 24]);
  var HEADING_PX = Object.freeze({ 1: 24, 2: 18, 3: 16 });
  var PASTE_MARKER = '<!-- x-tinymce/html -->';
  var EDITOR_BG = Object.freeze({ light: '#ffffff', dark: '#111111' });
  // A security bound, never reached by a real draft: the source is capped at
  // DRAFT_MAX_CHARS (20000), and the largest expansion found is an empty
  // one-cell table per three characters ("|", newline, newline), about 38
  // times. A test pins the bound with the worst inputs found.
  var CLEAN_MAX_CHARS = 1000000;
  var URL_MAX_CHARS = 2000;
  // Open-element depth past which a new element is unwrapped (a ghost). Far
  // beyond any real post; it keeps the recursive serialisers off the call-stack
  // limit, which Torn PDA's WebView reaches sooner than Node does.
  var CLEAN_MAX_DEPTH = 100;
  var STRUCT_TAGS = { table: 1, tbody: 1, thead: 1, tfoot: 1, tr: 1, ul: 1, ol: 1 };

  // ---- HTML tokenizer ------------------------------------------------------

  var NAMED_ENTITIES = Object.freeze({
    amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0', rsquo: '\u2019', lsquo: '\u2018',
    rdquo: '\u201d', ldquo: '\u201c', ndash: '\u2013', mdash: '\u2014', hellip: '\u2026',
    copy: '\u00a9', reg: '\u00ae', trade: '\u2122', bull: '\u2022', middot: '\u00b7',
  });

  function decodeEntities(s) {
    return String(s).replace(/&(#[xX][0-9a-fA-F]{1,6}|#[0-9]{1,7}|[a-zA-Z]{2,8});/g, function (all, e) {
      if (e.charAt(0) === '#') {
        var hex = e.charAt(1) === 'x' || e.charAt(1) === 'X';
        var cp = hex ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return cp > 0 && cp <= 0x10ffff && !(cp >= 0xd800 && cp <= 0xdfff) ? String.fromCodePoint(cp) : all;
      }
      return Object.prototype.hasOwnProperty.call(NAMED_ENTITIES, e) ? NAMED_ENTITIES[e] : all;
    });
  }

  var VOID_TAGS = Object.freeze({ br: true, img: true, hr: true, input: true, meta: true, link: true, wbr: true });
  var RAW_TEXT_TAGS = Object.freeze({ script: true, style: true, textarea: true, title: true });

  function isSpaceChar(c) { return c === ' ' || c === '\n' || c === '\t' || c === '\r' || c === '\f'; }

  // One forward pass. Every loop advances, and nothing rescans the input, so a
  // hostile 100000-character draft costs one pass. Each token carries pos and
  // end, its span in the input (a comment between two tokens is in neither).
  function tokenizeHtml(html) {
    var s = String(html || '').slice(0, CLEAN_MAX_CHARS);
    var lower = s.toLowerCase();
    var out = [];
    var n = s.length;
    var i = 0;
    var textStart = 0;
    function flush(to) {
      if (to > textStart) out.push({ type: 'text', text: decodeEntities(s.slice(textStart, to)), pos: textStart, end: to });
    }
    while (i < n) {
      if (s.charAt(i) !== '<') { i += 1; continue; }
      if (s.substr(i, 4) === '<!--') {
        flush(i);
        var endC = s.indexOf('-->', i + 4);
        i = endC === -1 ? n : endC + 3;
        textStart = i;
        continue;
      }
      var m = /^<(\/?)([a-zA-Z][a-zA-Z0-9]{0,15})/.exec(s.slice(i, i + 18));
      if (!m) { i += 1; continue; }
      flush(i);
      var start = i;
      var j = i + m[0].length;
      var attrs = {};
      var selfClose = false;
      while (j < n) {
        while (j < n && isSpaceChar(s.charAt(j))) j += 1;
        var ch = s.charAt(j);
        if (ch === '>') { j += 1; break; }
        if (ch === '/') { selfClose = true; j += 1; continue; }
        var nameStart = j;
        while (j < n && !isSpaceChar(s.charAt(j)) && '=>/'.indexOf(s.charAt(j)) === -1) j += 1;
        var name = s.slice(nameStart, j).toLowerCase();
        if (!name) { j += 1; continue; }
        while (j < n && isSpaceChar(s.charAt(j))) j += 1;
        var val = '';
        if (s.charAt(j) === '=') {
          j += 1;
          while (j < n && isSpaceChar(s.charAt(j))) j += 1;
          var q = s.charAt(j);
          if (q === '"' || q === "'") {
            var close = s.indexOf(q, j + 1);
            if (close === -1) close = n;
            val = s.slice(j + 1, close);
            j = close + 1;
          } else {
            var vs = j;
            while (j < n && !isSpaceChar(s.charAt(j)) && s.charAt(j) !== '>') j += 1;
            val = s.slice(vs, j);
          }
        }
        if (!Object.prototype.hasOwnProperty.call(attrs, name)) attrs[name] = decodeEntities(val);
      }
      var tag = m[2].toLowerCase();
      if (m[1]) {
        out.push({ type: 'close', tag: tag, pos: start, end: j });
      } else {
        out.push({ type: 'open', tag: tag, attrs: attrs, selfClose: selfClose || VOID_TAGS[tag] === true, pos: start, end: j });
        if (RAW_TEXT_TAGS[tag] && !selfClose) {
          var endTag = lower.indexOf('</' + tag, j);
          var stop = endTag === -1 ? n : endTag;
          if (stop > j) out.push({ type: 'text', text: s.slice(j, stop), raw: true, pos: j, end: stop });
          j = stop;
        }
      }
      i = j;
      textStart = j;
    }
    flush(n);
    return out;
  }

  // ---- the cleaner -----------------------------------------------------------

  var STYLE_ORDER = Object.freeze(['text-align', 'color', 'font-size', 'text-decoration', 'width', 'height']);
  var SPAN_PROPS = Object.freeze(['color', 'font-size', 'text-decoration']);
  var DROP_WITH_CONTENT = Object.freeze({
    script: true, style: true, iframe: true, object: true, embed: true, template: true, noscript: true,
    title: true, textarea: true, head: true, svg: true, math: true, select: true, button: true,
  });
  var BLOCK_TAGS = Object.freeze({ p: true, ul: true, ol: true, blockquote: true, table: true });
  var HEADING_TAGS = Object.freeze({ h1: 24, h2: 18, h3: 16, h4: 16, h5: 16, h6: 16 });

  function cssValue(prop, v) {
    var val = String(v || '').trim().toLowerCase();
    if (prop === 'text-align') return /^(left|center|right|justify)$/.test(val) ? val : null;
    if (prop === 'text-decoration') return /^(underline|line-through)$/.test(val) ? val : null;
    if (prop === 'font-size') {
      var px = /^([0-9]{1,2})px$/.exec(val);
      var n = px ? parseInt(px[1], 10) : 0;
      return n >= FONT_SIZE_MIN && n <= FONT_SIZE_MAX ? n + 'px' : null;
    }
    if (prop === 'color') {
      var v2 = /^var\(--te-text-color-([a-z0-9]+)\)$/.exec(val.replace(/\s+/g, ''));
      if (v2) return TORN_COLOR_NAMES.indexOf(v2[1]) !== -1 ? 'var(--te-text-color-' + v2[1] + ')' : null;
      return /^#([0-9a-f]{3}|[0-9a-f]{6})$/.test(val) ? val : null;
    }
    if (prop === 'width' || prop === 'height') return /^[0-9]{1,4}(\.[0-9]{1,4})?(px|%)$/.test(val) ? val : null;
    return null;
  }

  function pickStyle(styleText, allowed) {
    var out = {};
    var parts = String(styleText || '').split(';');
    for (var i = 0; i < parts.length && i < 40; i += 1) {
      var k = parts[i].indexOf(':');
      if (k === -1) continue;
      var prop = parts[i].slice(0, k).trim().toLowerCase();
      if (allowed.indexOf(prop) === -1) continue;
      var v = cssValue(prop, parts[i].slice(k + 1));
      if (v !== null) out[prop] = v;
    }
    return out;
  }

  function styleAttr(style) {
    var parts = [];
    for (var i = 0; i < STYLE_ORDER.length; i += 1) {
      if (Object.prototype.hasOwnProperty.call(style || {}, STYLE_ORDER[i])) {
        parts.push(STYLE_ORDER[i] + ': ' + style[STYLE_ORDER[i]] + ';');
      }
    }
    return parts.length ? ' style="' + parts.join(' ') + '"' : '';
  }

  function safeHref(v) {
    var u = String(v || '').trim();
    return u.length <= URL_MAX_CHARS && /^https?:\/\/[^\s<>"'`]+$/i.test(u) ? u : '';
  }

  function emojiFromSrc(v) {
    var m = /^\/images\/emotions\/svg\/([a-z_]{2,20})\.svg$/.exec(String(v || ''));
    return m && TORN_EMOJI.indexOf(m[1]) !== -1 ? m[1] : '';
  }

  function safeImgSrc(v) {
    var u = String(v || '').trim();
    if (emojiFromSrc(u)) return u;
    return u.length <= URL_MAX_CHARS && /^https:\/\/[^\s<>"'`]+$/i.test(u) ? u : '';
  }

  // The element an input tag becomes, or null to unwrap it (its text is kept).
  function cleanElementFor(tag, attrs) {
    var el = function (t, extra) {
      var node = { tag: t, from: tag, style: {}, children: [] };
      return Object.assign(node, extra || {});
    };
    switch (tag) {
      case 'p': return el('p', { style: pickStyle(attrs.style, ['text-align']) });
      case 'h1': case 'h2': case 'h3': case 'h4': case 'h5': case 'h6':
        return el('p', { style: pickStyle(attrs.style, ['text-align']), heading: HEADING_TAGS[tag] });
      case 'br': return el('br');
      case 'span': return el('span', { style: pickStyle(attrs.style, SPAN_PROPS) });
      case 'b': case 'strong': return el('strong');
      case 'i': case 'em': return el('em');
      case 's': case 'strike': case 'del': return el('span', { style: { 'text-decoration': 'line-through' } });
      case 'u': case 'ins': return el('span', { style: { 'text-decoration': 'underline' } });
      case 'ul': case 'ol': case 'li': case 'blockquote': case 'thead': case 'tbody': case 'tfoot':
        return el(tag);
      case 'tr': return el('tr', { style: pickStyle(attrs.style, ['height']) });
      case 'table': case 'th': case 'td':
        return el(tag, { style: pickStyle(attrs.style, ['width', 'height', 'text-align']) });
      case 'a': {
        var href = safeHref(attrs.href);
        return href ? el('a', { href: href }) : null;
      }
      case 'img': {
        var src = safeImgSrc(attrs.src);
        return src ? el('img', { src: src, alt: safeString(attrs.alt || '', 200) }) : null;
      }
      default: return null;
    }
  }

  // Pops the stack down to (and including) the nearest element named in
  // `closes`, unless one named in `stops` comes first.
  function closeUpTo(stack, closes, stops) {
    for (var k = stack.length - 1; k > 0; k -= 1) {
      var t = stack[k].tag;
      if (closes.indexOf(t) !== -1) { stack.length = k; return; }
      if (stops.indexOf(t) !== -1) return;
    }
  }

  function buildCleanTree(tokens) {
    var root = { tag: '#root', from: '#root', style: {}, children: [] };
    var stack = [root];
    var skip = null;
    var skipDepth = 0;
    for (var i = 0; i < tokens.length; i += 1) {
      var tok = tokens[i];
      if (skip) {
        if (tok.type === 'open' && tok.tag === skip && !tok.selfClose) skipDepth += 1;
        else if (tok.type === 'close' && tok.tag === skip) { skipDepth -= 1; if (!skipDepth) skip = null; }
        continue;
      }
      var top = stack[stack.length - 1];
      if (tok.type === 'text') {
        if (!tok.raw) {
          // Adjacent text merges, so a dropped element between two runs
          // leaves one run and cleaning stays idempotent.
          var last = top.children[top.children.length - 1];
          if (last && last.text !== undefined) last.text += tok.text;
          else top.children.push({ text: tok.text });
        }
        continue;
      }
      if (tok.type === 'open') {
        // TinyMCE's own bookkeeping: "all" goes with its content, any other
        // bogus element is unwrapped (its content is the player's).
        var bogus = tok.attrs['data-mce-bogus'];
        if (bogus === 'all' || DROP_WITH_CONTENT[tok.tag]) {
          if (!tok.selfClose) { skip = tok.tag; skipDepth = 1; }
          continue;
        }
        var node = bogus !== undefined ? null : cleanElementFor(tok.tag, tok.attrs);
        if (!node) {
          // Unwrapped, but still a container: a ghost shares its parent's
          // children, so its close tag ends what was opened inside it.
          if (!tok.selfClose && !VOID_TAGS[tok.tag]) {
            stack.push({ tag: '#ghost', from: tok.tag, style: {}, children: top.children });
          }
          continue;
        }
        if (stack.length > CLEAN_MAX_DEPTH && !tok.selfClose && node.tag !== 'br' && node.tag !== 'img') {
          // Share the nearest ancestor that can hold text, so text under a
          // capped table or list part is kept rather than lost.
          var holder = top;
          for (var h = stack.length - 1; h > 0; h -= 1) {
            if (!STRUCT_TAGS[stack[h].tag]) { holder = stack[h]; break; }
          }
          stack.push({ tag: '#ghost', from: tok.tag, style: {}, children: holder.children });
          continue;
        }
        if (BLOCK_TAGS[node.tag]) closeUpTo(stack, ['p'], ['li', 'td', 'th', 'blockquote']);
        if (node.tag === 'li') closeUpTo(stack, ['li'], ['ul', 'ol']);
        if (node.tag === 'td' || node.tag === 'th') closeUpTo(stack, ['td', 'th'], ['tr', 'table']);
        if (node.tag === 'tr') closeUpTo(stack, ['tr'], ['tbody', 'thead', 'tfoot', 'table']);
        stack[stack.length - 1].children.push(node);
        if (!tok.selfClose && node.tag !== 'br' && node.tag !== 'img') stack.push(node);
        continue;
      }
      // A close tag ends the nearest open element that came from that tag.
      for (var k = stack.length - 1; k > 0; k -= 1) {
        if (stack[k].from === tok.tag) { stack.length = k; break; }
      }
    }
    return root;
  }

  function escText(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\u00a0/g, '&nbsp;');
  }

  function escAttr(s) {
    return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function isBlankText(node) { return node && node.text !== undefined && /^[ \t\r\n\f]*$/.test(node.text); }

  // Drops whitespace-only text at both ends and trims the edge text nodes.
  // Only ordinary spaces: a non-breaking space is content.
  function trimEdges(children) {
    var list = children.slice();
    while (list.length && isBlankText(list[0])) list.shift();
    while (list.length && isBlankText(list[list.length - 1])) list.pop();
    if (list.length && list[0].text !== undefined) list[0] = { text: list[0].text.replace(/^[ \t\r\n\f]+/, '') };
    var last = list.length - 1;
    if (last >= 0 && list[last].text !== undefined) list[last] = { text: list[last].text.replace(/[ \t\r\n\f]+$/, '') };
    return list;
  }

  function serInline(children) {
    var out = '';
    for (var i = 0; i < children.length; i += 1) {
      var c = children[i];
      if (c.text !== undefined) { out += escText(c.text.replace(/[ \t\r\n\f]+/g, ' ')); continue; }
      if (c.tag === 'br') { out += '<br>'; continue; }
      if (c.tag === 'img') {
        out += '<img src="' + escAttr(c.src) + '"' + (c.alt ? ' alt="' + escAttr(c.alt) + '"' : '') + '>';
        continue;
      }
      var inner = serInline(c.children);
      if (c.tag === 'a') {
        out += '<a href="' + escAttr(c.href) + '" target="_blank" rel="noopener">' + (inner || escText(c.href)) + '</a>';
        continue;
      }
      if (inner === '') continue;
      if (c.tag === 'strong' || c.tag === 'em') { out += '<' + c.tag + '>' + inner + '</' + c.tag + '>'; continue; }
      if (c.tag === 'span') {
        // One property per span, outermost first, so equal content serialises
        // equally however the input grouped its styles.
        for (var p = SPAN_PROPS.length - 1; p >= 0; p -= 1) {
          var prop = SPAN_PROPS[p];
          if (Object.prototype.hasOwnProperty.call(c.style, prop)) {
            inner = '<span style="' + prop + ': ' + c.style[prop] + ';">' + inner + '</span>';
          }
        }
        out += inner;
        continue;
      }
      out += inner; // a block or a table part inside inline content: its text
    }
    return out;
  }

  function isBlankInline(html) {
    return html.replace(/&nbsp;|<br>|[ \t\r\n\f]/g, '') === '';
  }

  function serParagraph(node) {
    var inner = serInline(trimEdges(node.children));
    if (isBlankInline(inner)) inner = '&nbsp;';
    else if (node.heading) inner = '<span style="font-size: ' + node.heading + 'px;"><strong>' + inner + '</strong></span>';
    return '<p' + styleAttr(node.style) + '>' + inner + '</p>';
  }

  // Content that may mix blocks and inline runs, unwrapped (li, td, th).
  function serMixed(children) {
    var out = '';
    var run = [];
    var flushRun = function () { if (run.length) out += serInline(trimEdges(run)); run = []; };
    for (var i = 0; i < children.length; i += 1) {
      var c = children[i];
      if (c.tag && BLOCK_TAGS[c.tag]) { flushRun(); out += serBlock(c); } else run.push(c);
    }
    flushRun();
    return out;
  }

  // Block content (root, blockquote): inline runs become paragraphs.
  function serBlocks(children, sep) {
    var out = [];
    var run = [];
    var flushRun = function () {
      var t = trimEdges(run);
      run = [];
      if (!t.length) return;
      out.push(serParagraph({ tag: 'p', style: {}, children: t }));
    };
    for (var i = 0; i < children.length; i += 1) {
      var c = children[i];
      if (c.tag && BLOCK_TAGS[c.tag]) { flushRun(); var b = serBlock(c); if (b) out.push(b); continue; }
      if (c.tag === 'li' || c.tag === 'tr' || c.tag === 'td' || c.tag === 'th'
        || c.tag === 'thead' || c.tag === 'tbody' || c.tag === 'tfoot') {
        flushRun();
        var inner = serBlocks(c.children, sep);
        if (inner) out.push(inner);
        continue;
      }
      run.push(c);
    }
    flushRun();
    return out.join(sep || '');
  }

  function tableRows(node) {
    var rows = [];
    for (var i = 0; i < node.children.length; i += 1) {
      var c = node.children[i];
      if (c.tag === 'tr') rows.push(c);
      else if (c.tag === 'thead' || c.tag === 'tbody' || c.tag === 'tfoot') rows = rows.concat(tableRows(c));
    }
    return rows;
  }

  function serRow(row) {
    var cells = '';
    for (var i = 0; i < row.children.length; i += 1) {
      var c = row.children[i];
      if (c.tag === 'td' || c.tag === 'th') {
        cells += '<' + c.tag + styleAttr(c.style) + '>' + serMixed(trimEdges(c.children)) + '</' + c.tag + '>';
      } else if (!isBlankText(c)) {
        cells += '<td>' + serMixed(trimEdges([c])) + '</td>';
      }
    }
    return cells ? '<tr' + styleAttr(row.style) + '>' + cells + '</tr>' : '';
  }

  function serBlock(node) {
    if (node.tag === 'p') return serParagraph(node);
    if (node.tag === 'blockquote') {
      var q = serBlocks(node.children);
      return q ? '<blockquote>' + q + '</blockquote>' : '';
    }
    if (node.tag === 'ul' || node.tag === 'ol') {
      var items = '';
      var loose = [];
      var flushLoose = function () {
        var t = trimEdges(loose);
        loose = [];
        if (t.length) items += '<li>' + serMixed(t) + '</li>';
      };
      for (var i = 0; i < node.children.length; i += 1) {
        var c = node.children[i];
        if (c.tag === 'li') { flushLoose(); items += '<li>' + serMixed(trimEdges(c.children)) + '</li>'; } else loose.push(c);
      }
      flushLoose();
      return items ? '<' + node.tag + '>' + items + '</' + node.tag + '>' : '';
    }
    if (node.tag === 'table') {
      var rows = tableRows(node).map(serRow).join('');
      return rows ? '<div><div><div class="table-wrap"><table' + styleAttr(node.style) + '><tbody>'
        + rows + '</tbody></table></div></div></div>' : '';
    }
    return '';
  }

  // The one allowlist. Preview, Insert, Copy, mode switching and autosave all
  // pass through it, and its output is canonical: cleaning twice changes
  // nothing, so equal posts compare equal.
  function cleanTornHtml(html) {
    return serBlocks(buildCleanTree(tokenizeHtml(html)).children);
  }

  // The same post laid out one block per line, for editing in HTML mode. The
  // cleaner drops the whitespace between blocks, so this round-trips.
  function htmlSource(clean) {
    return serBlocks(buildCleanTree(tokenizeHtml(clean)).children, '\n');
  }

  // ---- HTML source is line-based (#58 round 2) -------------------------------
  // The player types HTML the way they type Markdown: outside an open block,
  // each line is its own paragraph and an empty line is a gap (<p>&nbsp;</p>,
  // which is how Torn stores one). Inside an open block (a paragraph, a list,
  // a table, a quote, a div) a newline is only whitespace, so a list typed
  // over several lines stays one list. An inline element open at a line break
  // (<strong> over two lines) is closed there and reopened on the next line.
  // htmlSource output (one block per line, no empty lines) passes through
  // unchanged. Every reader of typed HTML (Preview, Insert, Copy, a mode
  // switch) goes through htmlSourceBlocks, so they all agree.
  var LINE_BLOCK_TAGS = Object.freeze({
    p: true, div: true, ul: true, ol: true, li: true, table: true, blockquote: true,
    h1: true, h2: true, h3: true, h4: true, h5: true, h6: true,
    thead: true, tbody: true, tfoot: true, tr: true, td: true, th: true,
  });
  // Opening one of these ends an open paragraph or heading, as the cleaner does.
  var LINE_ENDS_P = Object.freeze({
    p: true, ul: true, ol: true, blockquote: true, table: true,
    h1: true, h2: true, h3: true, h4: true, h5: true, h6: true,
  });

  // An open tag that shows something even when empty, so a line holding only
  // it is not blank: a line break, an image, a link (an empty link shows its
  // address).
  function lineContentTag(tag) { return VOID_TAGS[tag] === true || tag === 'a'; }

  // An inline element open at a line break is reopened on each later line, so
  // the reopened set is bounded (oldest dropped first): a hostile draft of
  // unclosed tags over thousands of lines stays linear.
  var LINE_REOPEN_MAX_TAGS = 8;
  var LINE_REOPEN_MAX_CHARS = 256;

  // The typed source cut into top-level pieces, each with the offset it starts
  // at: a block as typed, a line of loose text wrapped in <p>, or a gap.
  // A blank line inside an open top-level paragraph or heading ends it, so a
  // newline that missed the editor's Enter can never merge paragraphs for
  // good. With info, info.open is where the top-level block still open at the
  // end of src starts, or -1.
  function htmlLineSegments(src, info) {
    var s = String(src || '').replace(/\r\n?/g, '\n').slice(0, CLEAN_MAX_CHARS);
    if (s === '') return [];
    var toks = tokenizeHtml(s);
    var segs = [];
    var block = null; // the top-level block being copied: { start, html, stack }
    var inl = [];     // inline elements open at the top level: { tag, src }
    var inlChars = 0;
    var run = null;   // the loose text of the current line: { start, html, content }
    var lineStart = 0;
    var lineUsed = false;
    var reopen = function () { return inl.map(function (x) { return x.src; }).join(''); };
    var closers = function (from) {
      var c = '';
      for (var k = inl.length - 1; k >= from; k -= 1) c += '</' + inl[k].tag + '>';
      return c;
    };
    var runAdd = function (pos, html, content) {
      if (!run) run = { start: pos, html: reopen(), content: false };
      run.html += html;
      if (content) run.content = true;
    };
    var flushRun = function () {
      if (run && run.content) segs.push({ html: '<p>' + run.html + closers(0) + '</p>', offset: run.start });
      run = null;
    };
    var endLine = function (next) {
      flushRun();
      if (!lineUsed) segs.push({ html: '<p>&nbsp;</p>', offset: lineStart });
      lineStart = next;
      lineUsed = false;
    };
    var endBlock = function () {
      segs.push({ html: block.html, offset: block.start });
      block = null;
    };
    var setInl = function (n) {
      inl.length = n;
      inlChars = 0;
      for (var k = 0; k < inl.length; k += 1) inlChars += inl[k].src.length;
    };
    var pushInl = function (tag, attrs, html) {
      // Only what the cleaner keeps is worth reopening, and only once: the
      // same tag nested in itself looks no different.
      if (html.length > LINE_REOPEN_MAX_CHARS || !cleanElementFor(tag, attrs)) return;
      for (var k = 0; k < inl.length; k += 1) if (inl[k].src === html) return;
      inl.push({ tag: tag, src: html });
      inlChars += html.length;
      while (inl.length > LINE_REOPEN_MAX_TAGS || inlChars > LINE_REOPEN_MAX_CHARS) inlChars -= inl.shift().src.length;
    };
    var topText = function (text, pos) {
      var pieces = text.split('\n');
      var p = pos;
      for (var k = 0; k < pieces.length; k += 1) {
        var piece = pieces[k];
        if (/[^ \t\f]/.test(piece)) { runAdd(p, piece, true); lineUsed = true; } else if (run) run.html += piece;
        p += piece.length;
        if (k < pieces.length - 1) { endLine(p + 1); p += 1; }
      }
    };
    var seen = 0; // where the last token ended: anything between is a comment
    for (var i = 0; i < toks.length; i += 1) {
      var t = toks[i];
      var raw = s.slice(t.pos, t.end);
      // A line holding only a comment is not an empty line.
      if (t.pos > seen && !block) lineUsed = true;
      seen = t.end;
      if (block) {
        var st = block.stack;
        if (t.type === 'open' && !t.selfClose && (LINE_BLOCK_TAGS[t.tag] || DROP_WITH_CONTENT[t.tag])) {
          var top = st[st.length - 1];
          if ((LINE_ENDS_P[t.tag] && (top === 'p' || HEADING_TAGS[top]))
            || (t.tag === 'li' && top === 'li')
            || ((t.tag === 'td' || t.tag === 'th') && (top === 'td' || top === 'th'))
            || (t.tag === 'tr' && top === 'tr')) st.pop();
          if (!st.length) endBlock();
        } else if (t.type === 'text' && !t.raw && st.length === 1 && (st[0] === 'p' || HEADING_TAGS[st[0]])) {
          var gap = /\n[ \t\f]*\n/.exec(raw);
          if (gap) {
            block.html += raw.slice(0, gap.index);
            endBlock();
            topText(raw.slice(gap.index), t.pos + gap.index);
            continue;
          }
        } else if (t.type === 'close') {
          var at = st.lastIndexOf(t.tag);
          if (at !== -1) st.length = at;
          block.html += raw;
          if (!st.length) endBlock();
          continue;
        }
        if (block) {
          block.html += raw;
          if (t.type === 'open' && !t.selfClose && (LINE_BLOCK_TAGS[t.tag] || DROP_WITH_CONTENT[t.tag])) st.push(t.tag);
          continue;
        }
      }
      if (t.type === 'text') { topText(raw, t.pos); continue; }
      lineUsed = true;
      if (t.type === 'open' && (LINE_BLOCK_TAGS[t.tag] || DROP_WITH_CONTENT[t.tag])) {
        flushRun();
        block = { start: t.pos, html: raw, stack: [t.tag] };
        if (t.selfClose) endBlock();
        continue;
      }
      if (t.type === 'open') {
        runAdd(t.pos, raw, lineContentTag(t.tag));
        if (!t.selfClose) pushInl(t.tag, t.attrs, raw);
        continue;
      }
      // A close tag at the top level ends the inline elements it closes; a
      // stray one is dropped, as the cleaner would.
      for (var c = inl.length - 1; c >= 0; c -= 1) {
        if (inl[c].tag !== t.tag) continue;
        if (run) run.html += closers(c);
        setInl(c);
        break;
      }
    }
    if (s.length > seen && !block) lineUsed = true;
    if (info) info.open = block ? block.start : -1;
    if (block) endBlock();
    endLine(s.length);
    return segs;
  }

  // Typed HTML as the cleaned blocks Torn gets, each with the source offset a
  // tap in Preview returns the caret to.
  function htmlSourceBlocks(src) {
    var segs = htmlLineSegments(src);
    var out = [];
    for (var i = 0; i < segs.length; i += 1) {
      var clean = cleanTornHtml(segs[i].html);
      if (!clean) continue;
      var kids = buildCleanTree(tokenizeHtml(clean)).children;
      if (kids.length === 1) { out.push({ html: clean, offset: segs[i].offset }); continue; }
      for (var k = 0; k < kids.length; k += 1) {
        var h = serBlocks([kids[k]]);
        if (h) out.push({ html: h, offset: segs[i].offset });
      }
    }
    return out;
  }

  function htmlSourcePost(src) {
    return htmlSourceBlocks(src).map(function (b) { return b.html; }).join('');
  }

  // ---- Markdown to HTML ------------------------------------------------------

  var MD_ESCAPABLE = '\\*+~{}[]()!:<>&|#-._`';
  var MD_PAIRS = Object.freeze([['**', 'strong'], ['++', 'u'], ['~~', 's'], ['*', 'em']]);

  function mdWrap(kind, inner) {
    if (kind === 'strong' || kind === 'em') return '<' + kind + '>' + inner + '</' + kind + '>';
    return '<span style="text-decoration: ' + (kind === 'u' ? 'underline' : 'line-through') + ';">' + inner + '</span>';
  }

  function isEscaped(s, j) {
    var count = 0;
    for (var k = j - 1; k >= 0 && s.charAt(k) === '\\'; k -= 1) count += 1;
    return count % 2 === 1;
  }

  function findMdClose(s, d, from) {
    var j = s.indexOf(d, from);
    while (j !== -1) {
      var ok = !isEscaped(s, j);
      if (ok && d === '*' && (s.charAt(j + 1) === '*' || s.charAt(j - 1) === '*')) ok = false;
      if (ok) return j;
      j = s.indexOf(d, j + 1);
    }
    return -1;
  }

  function mdOpener(s, i) {
    var m = /^\{(#[0-9a-fA-F]{6}|#[0-9a-fA-F]{3}|[a-z][a-z0-9]{1,6}|[0-9]{1,2})\}/.exec(s.slice(i, i + 10));
    if (!m) return null;
    var v = m[1];
    var style = null;
    if (v.charAt(0) === '#') style = 'color: ' + v.toLowerCase() + ';';
    else if (/^[0-9]/.test(v)) {
      var n = parseInt(v, 10);
      if (n >= FONT_SIZE_MIN && n <= FONT_SIZE_MAX) style = 'font-size: ' + n + 'px;';
    } else if (TORN_COLOR_NAMES.indexOf(v) !== -1) style = 'color: var(--te-text-color-' + v + ');';
    return style ? { open: '<span style="' + style + '">', end: i + m[0].length } : null;
  }

  // Every {opener} paired with its {/} in one pass, innermost first, the way
  // brackets match. An opener left without a closer is literal text.
  function mdBracePairs(s) {
    var pairs = {};
    var open = [];
    var k = 0;
    while (k < s.length) {
      if (s.charAt(k) === '{' && !isEscaped(s, k)) {
        if (s.substr(k, 3) === '{/}') {
          if (open.length) pairs[open.pop()] = k;
          k += 3;
          continue;
        }
        var o = mdOpener(s, k);
        if (o) { open.push(k); k = o.end; continue; }
      }
      k += 1;
    }
    return pairs;
  }

  function mdLink(s, i, to) {
    var j = i + 1;
    while (j < to && (s.charAt(j) !== ']' || isEscaped(s, j))) j += 1;
    if (j >= to || s.charAt(j + 1) !== '(') return null;
    var k = s.indexOf(')', j + 2);
    if (k === -1 || k >= to) return null;
    return { text: s.slice(i + 1, j), textEnd: j, url: s.slice(j + 2, k).trim(), end: k + 1 };
  }

  var MD_MAX_DEPTH = 16;

  // Renders s[from, to) of one line. ctx carries the line's brace pairs; depth
  // caps nesting, so a hostile draft cannot exhaust the stack.
  function mdInlineRange(s, from, to, ctx, depth) {
    var out = '';
    var i = from;
    var n = to;
    var deep = depth >= MD_MAX_DEPTH;
    while (i < n) {
      var c = s.charAt(i);
      if (c === '\\' && i + 1 < n && MD_ESCAPABLE.indexOf(s.charAt(i + 1)) !== -1) {
        out += escText(s.charAt(i + 1));
        i += 2;
        continue;
      }
      var matched = false;
      for (var p = 0; p < MD_PAIRS.length; p += 1) {
        var d = MD_PAIRS[p][0];
        if (deep || s.substr(i, d.length) !== d) continue;
        if (d === '*' && s.charAt(i + 1) === '*') continue;
        var j = findMdClose(s, d, i + d.length);
        if (j > i + d.length && j + d.length <= n) {
          out += mdWrap(MD_PAIRS[p][1], mdInlineRange(s, i + d.length, j, ctx, depth + 1));
          i = j + d.length;
          matched = true;
        }
        break;
      }
      if (matched) continue;
      if (c === '{' && !deep && Object.prototype.hasOwnProperty.call(ctx.pairs, i)) {
        var o = mdOpener(s, i);
        var close = ctx.pairs[i];
        if (o && close > o.end && close + 3 <= n) {
          out += o.open + mdInlineRange(s, o.end, close, ctx, depth + 1) + '</span>';
          i = close + 3;
          continue;
        }
      }
      if (c === '!' && s.charAt(i + 1) === '[') {
        var im = mdLink(s, i + 1, n);
        if (im && safeImgSrc(im.url)) {
          out += '<img src="' + escAttr(im.url) + '"' + (im.text ? ' alt="' + escAttr(im.text) + '"' : '') + '>';
          i = im.end;
          continue;
        }
        if (im) {
          // An image whose source is not allowed stays literal text, not a link.
          out += '![';
          i += 2;
          continue;
        }
      }
      if (c === '[') {
        var ln = deep ? null : mdLink(s, i, n);
        if (ln && safeHref(ln.url)) {
          out += '<a href="' + escAttr(ln.url) + '">' + mdInlineRange(s, i + 1, ln.textEnd, ctx, depth + 1) + '</a>';
          i = ln.end;
          continue;
        }
      }
      if (c === ':') {
        var em = /^:([a-z_]{2,20}):/.exec(s.slice(i, Math.min(n, i + 23)));
        if (em && TORN_EMOJI.indexOf(em[1]) !== -1) {
          out += '<img src="/images/emotions/svg/' + em[1] + '.svg">';
          i += em[0].length;
          continue;
        }
      }
      if (c === '<') {
        if (s.substr(i, 4) === '<!--') {
          var ce = s.indexOf('-->', i + 4);
          i = ce === -1 || ce + 3 > n ? n : ce + 3;
          continue;
        }
        if (/^<\/?[a-zA-Z]/.test(s.slice(i, i + 3))) {
          var gt = s.indexOf('>', i);
          if (gt !== -1 && gt < n) { out += s.slice(i, gt + 1); i = gt + 1; continue; }
        }
        out += '&lt;';
        i += 1;
        continue;
      }
      if (c === '&') {
        var ent = /^&(#[xX][0-9a-fA-F]{1,6}|#[0-9]{1,7}|[a-zA-Z]{2,8});/.exec(s.slice(i, Math.min(n, i + 12)));
        if (ent) { out += ent[0]; i += ent[0].length; continue; }
        out += '&amp;';
        i += 1;
        continue;
      }
      if (c === '>') { out += '&gt;'; i += 1; continue; }
      if (c === '\u00a0') { out += '&nbsp;'; i += 1; continue; }
      out += c;
      i += 1;
    }
    return out;
  }

  function mdInline(s) {
    var line = String(s);
    return mdInlineRange(line, 0, line.length, { pairs: mdBracePairs(line) }, 0);
  }

  function splitCells(line) {
    var t = line.trim();
    if (t.charAt(0) === '|') t = t.slice(1);
    if (t.charAt(t.length - 1) === '|' && !isEscaped(t, t.length - 1)) t = t.slice(0, -1);
    var cells = [];
    var cur = '';
    for (var i = 0; i < t.length; i += 1) {
      var ch = t.charAt(i);
      if (ch === '\\' && t.charAt(i + 1) === '|') { cur += '\\|'; i += 1; continue; }
      if (ch === '|') { cells.push(cur.trim()); cur = ''; continue; }
      cur += ch;
    }
    cells.push(cur.trim());
    return cells;
  }

  function delimiterAligns(line) {
    if (line.indexOf('-') === -1) return null;
    var cells = splitCells(line);
    var aligns = [];
    for (var i = 0; i < cells.length; i += 1) {
      var m = /^(:?)-+(:?)$/.exec(cells[i]);
      if (!m) return null;
      aligns.push(m[1] && m[2] ? 'center' : m[2] ? 'right' : m[1] ? 'left' : '');
    }
    return aligns;
  }

  function mdTableCell(tag, text, align) {
    return '<' + tag + (align ? ' style="text-align: ' + align + ';"' : '') + '>' + mdInline(text) + '</' + tag + '>';
  }

  var BLOCK_HTML_LINE = /^\s*<(p|div|table|blockquote|ul|ol|h[1-6])\b/i;

  // Markdown source to blocks, each with the line it starts on, so Preview can
  // send a tap back to its source line.
  function mdBlocks(md) {
    var src = String(md || '');
    if (src === '') return [];
    var lines = src.replace(/\r\n?/g, '\n').split('\n');
    var out = [];
    var align = null;
    var i = 0;
    var alignAttr = function () { return align ? ' style="text-align: ' + align + ';"' : ''; };
    while (i < lines.length) {
      var line = lines[i];
      var start = i;
      var fence = /^:::[ \t]*(left|center|right|justify)[ \t]*$/i.exec(line);
      if (fence) { align = fence[1].toLowerCase(); i += 1; continue; }
      if (align && /^:::[ \t]*$/.test(line)) { align = null; i += 1; continue; }
      var trimmed = line.trim();
      if (trimmed.charAt(0) === '|') {
        var aligns = i + 1 < lines.length ? delimiterAligns(lines[i + 1]) : null;
        var header = splitCells(line);
        var rows = '';
        if (aligns && aligns.length === header.length) {
          rows += '<tr>' + header.map(function (h, k) { return mdTableCell('th', h, aligns[k]); }).join('') + '</tr>';
          i += 2;
        } else {
          aligns = [];
        }
        while (i < lines.length && lines[i].trim().charAt(0) === '|') {
          var cells = splitCells(lines[i]);
          rows += '<tr>' + cells.map(function (h, k) { return mdTableCell('td', h, aligns[k] || ''); }).join('') + '</tr>';
          i += 1;
        }
        out.push({ line: start, html: '<table><tbody>' + rows + '</tbody></table>' });
        continue;
      }
      if (/^[ \t]*>/.test(line)) {
        var quote = '';
        while (i < lines.length && /^[ \t]*>/.test(lines[i])) {
          var q = lines[i].replace(/^[ \t]*>[ \t]?/, '');
          quote += q.trim() === '' ? '<p>&nbsp;</p>' : '<p>' + mdInline(q) + '</p>';
          i += 1;
        }
        out.push({ line: start, html: '<blockquote>' + quote + '</blockquote>' });
        continue;
      }
      var listKind = /^[ \t]*[-*+][ \t]+/.test(line) ? 'ul' : /^[ \t]*[0-9]{1,9}[.)][ \t]+/.test(line) ? 'ol' : null;
      if (listKind) {
        var re = listKind === 'ul' ? /^[ \t]*[-*+][ \t]+/ : /^[ \t]*[0-9]{1,9}[.)][ \t]+/;
        var items = '';
        while (i < lines.length && re.test(lines[i])) {
          items += '<li>' + mdInline(lines[i].replace(re, '')) + '</li>';
          i += 1;
        }
        out.push({ line: start, html: '<' + listKind + '>' + items + '</' + listKind + '>' });
        continue;
      }
      i += 1;
      var h = /^(#{1,3})[ \t]+(.*)$/.exec(line);
      if (h && h[2].trim()) {
        out.push({ line: start, html: '<p' + alignAttr() + '><span style="font-size: ' + HEADING_PX[h[1].length]
          + 'px;"><strong>' + mdInline(h[2].trim()) + '</strong></span></p>' });
        continue;
      }
      if (BLOCK_HTML_LINE.test(line)) { out.push({ line: start, html: line }); continue; }
      out.push({ line: start, html: '<p' + alignAttr() + '>' + (trimmed === '' ? '&nbsp;' : mdInline(line)) + '</p>' });
    }
    return out.map(function (b) { return { line: b.line, html: cleanTornHtml(b.html) }; })
      .filter(function (b) { return b.html !== ''; });
  }

  function mdToHtml(md) {
    return mdBlocks(md).map(function (b) { return b.html; }).join('');
  }

  // ---- HTML to Markdown ------------------------------------------------------

  // Characters inside raw HTML kept in Markdown are written as entities, so
  // the Markdown reader never mistakes them for marks.
  function rawForMd(html) {
    return html.replace(/>([^<]*)</g, function (all, text) {
      return '>' + text.replace(/[\\*+~{}\[\]:|!_`#]/g, function (ch) { return '&#' + ch.charCodeAt(0) + ';'; }) + '<';
    });
  }

  function mdEscapeText(t, inTable) {
    var s = String(t).replace(/[\\*{}\[\]<&`]/g, '\\$&').replace(/\+\+/g, '\\+\\+').replace(/~~/g, '\\~\\~');
    s = s.replace(/:([a-z_]{2,20}):/g, function (all, name) {
      return TORN_EMOJI.indexOf(name) !== -1 ? '\\:' + name + ':' : all;
    });
    if (inTable) s = s.replace(/\|/g, '\\|');
    return s;
  }

  function mdLineStartEscape(line) {
    if (/^(#{1,3}[ \t]|[-*+][ \t]|>|\||:::)/.test(line)) return '\\' + line;
    var ol = /^([0-9]{1,9})([.)])([ \t])/.exec(line);
    if (ol) return ol[1] + '\\' + ol[2] + line.slice(ol[1].length + 1);
    return line;
  }

  function nodeHtml(node) {
    return serInline([node]);
  }

  function mdFromInline(children, inTable) {
    var out = '';
    for (var i = 0; i < children.length; i += 1) {
      var c = children[i];
      if (c.text !== undefined) { out += mdEscapeText(c.text.replace(/[ \t\r\n\f]+/g, ' '), inTable); continue; }
      if (c.tag === 'br') { out += '<br>'; continue; }
      if (c.tag === 'img') {
        var emoji = emojiFromSrc(c.src);
        if (emoji) { out += ':' + emoji + ':'; continue; }
        if (/[\])\s]/.test(c.alt) || /[()\s]/.test(c.src) || (inTable && /\|/.test(c.alt + c.src))) {
          out += rawForMd(nodeHtml(c));
        } else out += '![' + c.alt + '](' + c.src + ')';
        continue;
      }
      var inner = mdFromInline(c.children, inTable);
      if (inner === '' && c.tag !== 'a') continue;
      if (c.tag === 'a') {
        var hasImg = JSON.stringify(c.children).indexOf('"img"') !== -1;
        if (hasImg || /[()\s]/.test(c.href) || /[\[\]]/.test(inner) || (inTable && /\|/.test(c.href))) {
          out += rawForMd(nodeHtml(c));
        } else out += '[' + inner + '](' + c.href + ')';
        continue;
      }
      if (c.tag === 'strong' || c.tag === 'em') {
        var d = c.tag === 'strong' ? '**' : '*';
        if (/^\*|\*$/.test(inner) || /^[ \t]|[ \t]$/.test(inner)) out += rawForMd(nodeHtml(c));
        else out += d + inner + d;
        continue;
      }
      if (c.tag === 'span') {
        // Canonical spans carry one property each (serInline).
        var props = Object.keys(c.style);
        if (props.length !== 1) { out += rawForMd(nodeHtml(c)); continue; }
        var v = c.style[props[0]];
        if (props[0] === 'text-decoration') {
          var dd = v === 'underline' ? '++' : '~~';
          if (/^[+~]|[+~]$/.test(inner) || /^[ \t]|[ \t]$/.test(inner)) out += rawForMd(nodeHtml(c));
          else out += dd + inner + dd;
          continue;
        }
        var key = props[0] === 'font-size' ? v.replace('px', '')
          : /^var\(/.test(v) ? v.replace(/^var\(--te-text-color-|\)$/g, '') : v;
        out += '{' + key + '}' + inner + '{/}';
        continue;
      }
      out += inner;
    }
    return out;
  }

  function onlyChild(node, tag) {
    var kids = node.children.filter(function (k) { return !isBlankText(k); });
    return kids.length === 1 && kids[0].tag === tag ? kids[0] : null;
  }

  function headingLevel(p) {
    var span = onlyChild(p, 'span');
    if (!span || Object.keys(span.style).length !== 1 || !span.style['font-size']) return 0;
    var strong = onlyChild(span, 'strong');
    if (!strong) return 0;
    var px = parseInt(span.style['font-size'], 10);
    for (var lvl = 1; lvl <= 3; lvl += 1) if (HEADING_PX[lvl] === px) return { level: lvl, node: strong };
    return 0;
  }

  function isBlankParagraph(p) {
    return isBlankInline(serInline(trimEdges(p.children)));
  }

  function paragraphMd(p) {
    if (isBlankParagraph(p)) return '';
    var h = headingLevel(p);
    if (h) return '#'.repeat(h.level) + ' ' + mdFromInline(trimEdges(h.node.children), false);
    var line = mdFromInline(trimEdges(p.children), false);
    return mdLineStartEscape(line);
  }

  function tableMd(table) {
    if (Object.keys(table.style).length) return null;
    var rows = tableRows(table);
    if (!rows.length) return null;
    var width = -1;
    var headerForm = false;
    var aligns = [];
    for (var r = 0; r < rows.length; r += 1) {
      var row = rows[r];
      if (Object.keys(row.style).length) return null;
      var cells = row.children.filter(function (k) { return !isBlankText(k); });
      if (cells.some(function (k) { return k.tag !== 'td' && k.tag !== 'th'; })) return null;
      if (width === -1) width = cells.length; else if (cells.length !== width) return null;
      var allTh = cells.every(function (k) { return k.tag === 'th'; });
      var anyTh = cells.some(function (k) { return k.tag === 'th'; });
      if (r === 0) headerForm = allTh;
      else if (anyTh) return null;
      if (r === 0 && anyTh && !allTh) return null;
      for (var k = 0; k < cells.length; k += 1) {
        var st = cells[k].style;
        var keys = Object.keys(st);
        if (keys.some(function (x) { return x !== 'text-align'; })) return null;
        var a = st['text-align'] || '';
        if (r === 0) aligns[k] = a; else if (aligns[k] !== a) return null;
        if (cells[k].children.some(function (x) { return x.tag && BLOCK_TAGS[x.tag]; })) return null;
      }
    }
    if (!headerForm && aligns.some(function (a) { return a; })) return null;
    var lines = [];
    for (var r2 = 0; r2 < rows.length; r2 += 1) {
      var cs = rows[r2].children.filter(function (k) { return !isBlankText(k); });
      lines.push('| ' + cs.map(function (cell) { return mdFromInline(trimEdges(cell.children), true); }).join(' | ') + ' |');
      if (r2 === 0 && headerForm) {
        lines.push('| ' + aligns.map(function (a) {
          return a === 'center' ? ':---:' : a === 'right' ? '---:' : a === 'left' ? ':---' : '---';
        }).join(' | ') + ' |');
      }
    }
    return lines;
  }

  // Input is typed HTML source, so it is read line by line like Preview reads it.
  function htmlToMd(html) {
    var root = buildCleanTree(tokenizeHtml(htmlSourcePost(html)));
    var lines = [];
    var prevKind = null;
    var align = null;
    var setAlign = function (a) {
      if (a === align) return;
      if (align) lines.push(':::');
      if (a) lines.push(':::' + a);
      align = a;
    };
    for (var i = 0; i < root.children.length; i += 1) {
      var b = root.children[i];
      var kind = b.tag;
      if (b.tag === 'p') {
        setAlign(b.style['text-align'] || null);
        lines.push(paragraphMd(b));
        prevKind = 'p';
        continue;
      }
      setAlign(null);
      var raw = rawForMd(serBlock(b));
      if (b.tag === 'ul' || b.tag === 'ol') {
        var ok = prevKind !== b.tag;
        var items = [];
        for (var k = 0; ok && k < b.children.length; k += 1) {
          var li = b.children[k];
          if (li.tag !== 'li' || li.children.some(function (x) { return x.tag && BLOCK_TAGS[x.tag]; })) { ok = false; break; }
          var text = mdFromInline(trimEdges(li.children), false);
          items.push((b.tag === 'ul' ? '- ' : '1. ') + text);
        }
        if (ok) lines = lines.concat(items); else lines.push(raw);
      } else if (b.tag === 'blockquote') {
        var qok = prevKind !== 'blockquote';
        var ql = [];
        for (var q = 0; qok && q < b.children.length; q += 1) {
          var qp = b.children[q];
          if (qp.tag !== 'p' || Object.keys(qp.style).length || headingLevel(qp)) { qok = false; break; }
          var qt = isBlankParagraph(qp) ? '' : mdFromInline(trimEdges(qp.children), false);
          ql.push(qt === '' ? '>' : '> ' + qt);
        }
        if (qok) lines = lines.concat(ql); else lines.push(raw);
      } else if (b.tag === 'table') {
        var tl = tableMd(b);
        if (tl && prevKind !== 'table') lines = lines.concat(tl); else lines.push(raw);
      } else {
        lines.push(raw);
      }
      prevKind = kind;
    }
    setAlign(null);
    return lines.join('\n');
  }

  // ---- plain text ------------------------------------------------------------

  function textToHtml(text) {
    var src = String(text || '');
    if (src === '') return '';
    return cleanTornHtml(src.replace(/\r\n?/g, '\n').split('\n').map(function (line) {
      return line.trim() === '' ? '<p>&nbsp;</p>' : '<p>' + escText(line) + '</p>';
    }).join(''));
  }

  function textToMd(text) {
    var src = String(text || '');
    if (src === '') return '';
    return src.replace(/\r\n?/g, '\n').split('\n').map(function (line) {
      return line.trim() === '' ? '' : mdLineStartEscape(mdEscapeText(line.trim(), false));
    }).join('\n');
  }

  function plainInline(children) {
    var out = '';
    for (var i = 0; i < children.length; i += 1) {
      var c = children[i];
      if (c.text !== undefined) out += c.text.replace(/[ \t\r\n\f]+/g, ' ');
      else if (c.tag === 'br') out += '\n';
      else if (c.tag === 'img') out += emojiFromSrc(c.src) ? ':' + emojiFromSrc(c.src) + ':' : (c.alt || '');
      else out += plainInline(c.children);
    }
    return out;
  }

  function htmlToText(html) {
    var root = buildCleanTree(tokenizeHtml(cleanTornHtml(html)));
    var lines = [];
    var walk = function (nodes, prefix) {
      for (var i = 0; i < nodes.length; i += 1) {
        var b = nodes[i];
        if (b.tag === 'p') lines.push(prefix + plainInline(trimEdges(b.children)).replace(/\u00a0/g, ' ').trim());
        else if (b.tag === 'blockquote') walk(b.children, prefix + '> ');
        else if (b.tag === 'ul' || b.tag === 'ol') {
          b.children.forEach(function (li) { if (li.tag === 'li') lines.push(prefix + '- ' + plainInline(li.children).trim()); });
        } else if (b.tag === 'table') {
          tableRows(b).forEach(function (r) {
            lines.push(prefix + r.children.filter(function (c) { return c.tag; }).map(function (c) {
              return plainInline(c.children).trim();
            }).join(' | '));
          });
        }
      }
    };
    walk(root.children, '');
    return lines.join('\n');
  }

  // ---- Preview (#58) -----------------------------------------------------------

  function lineOffsets(text) {
    var out = [0];
    for (var i = 0; i < text.length; i += 1) if (text.charAt(i) === '\n') out.push(i + 1);
    return out;
  }

  // The post as Preview shows it: one entry per block, each with the source
  // offset a tap returns the caret to.
  function previewModel(lang, text) {
    var src = String(text || '').replace(/\r\n?/g, '\n');
    if (lang === 'md') {
      var starts = lineOffsets(src);
      return mdBlocks(src).map(function (b) { return { html: b.html, offset: starts[b.line] || 0 }; });
    }
    if (lang === 'html') return htmlSourceBlocks(src);
    if (src === '') return [];
    var lineStarts = lineOffsets(src);
    return src.split('\n').map(function (line, idx) {
      return { html: textToHtml(line === '' ? ' ' : line), offset: lineStarts[idx] };
    });
  }

  // Spec 4a: Preview loads no external image until the player asks. Torn's
  // own emoji are same-site and always show. Input is cleaned HTML, whose img
  // tags are always exactly <img src="..."> or <img src="..." alt="...">.
  function previewImages(html, show) {
    return String(html).replace(/<img src="(https:[^"]*)"( alt="[^"]*")?>/g, function (all, src, alt) {
      if (show) return '<img referrerpolicy="no-referrer" src="' + src + '"' + (alt || '') + '>';
      var host = (/^https:\/\/([^\/?#"]+)/.exec(src) || [])[1] || 'another site';
      return '<span class="tfcc-img-ph">[image from ' + host + ']</span>';
    });
  }

  // ---- conversion entry points -----------------------------------------------

  function postHtml(text, lang) {
    if (lang === 'md') return mdToHtml(text);
    if (lang === 'html') return htmlSourcePost(text);
    return textToHtml(text);
  }

  function convertDraft(text, from, to) {
    if (from === to) return String(text || '');
    if (to === 'text') return htmlToText(postHtml(text, from));
    if (to === 'html') return htmlSource(postHtml(text, from));
    if (from === 'text') return textToMd(text);
    return htmlToMd(text);
  }

  // ---- image link fixer (#58) ------------------------------------------------
  // A pure string rewrite: no lookup, no request. Rules and their sources are in
  // docs/reference/image-host-link-rules-2026-10-09.md.

  var IMAGE_EXT_RE = /\.(png|jpe?g|gif|webp)$/i;

  var IMAGE_HOWTO = Object.freeze({
    'photos.app.goo.gl': 'Google Photos links are pages. Open the photo, right-click it, choose Copy image address, and use that link (it starts with lh3.googleusercontent.com).',
    'photos.google.com': 'Google Photos links are pages. Open the photo, right-click it, choose Copy image address, and use that link (it starts with lh3.googleusercontent.com).',
    '1drv.ms': 'OneDrive links are pages. Open the image in OneDrive on the web, right-click it and choose Copy image address, or use another host.',
    'onedrive.live.com': 'OneDrive links are pages. Open the image in OneDrive on the web, right-click it and choose Copy image address, or use another host.',
    'ibb.co': 'That is the ImgBB page. On it, copy the Direct link field (it starts with i.ibb.co).',
    'postimg.cc': 'That is the Postimages page. Copy its Direct link (it starts with i.postimg.cc).',
    'postimages.org': 'That is the Postimages page. Copy its Direct link (it starts with i.postimg.cc).',
    'prnt.sc': 'Lightshot links are pages. Open it, right-click the image and choose Copy image address.',
    'tenor.com': 'Tenor links are pages. Right-click the GIF and choose Copy image address.',
  });

  function imageResult(status, url, host, note) {
    // Parentheses are encoded so a link can never close a Markdown ![alt](url) early.
    if (url && (status === 'ok' || status === 'fixed')) url = url.replace(/\(/g, '%28').replace(/\)/g, '%29');
    return { status: status, url: url, host: host, note: note || '' };
  }

  function pathPart(rest) { return rest.split(/[?#]/)[0]; }

  function queryParam(rest, name) {
    var m = new RegExp('[?&]' + name + '=([^&#]*)').exec(rest);
    return m ? m[1] : '';
  }

  function fixImageUrl(raw, depth) {
    var u = String(raw || '').trim();
    if (!u) return imageResult('refused', '', '', 'Paste an image link.');
    if (u.length > URL_MAX_CHARS) return imageResult('refused', '', '', 'That link is too long.');
    if (/^http:\/\//i.test(u)) return imageResult('refused', '', '', 'Torn needs an https link. Try the same link with https.');
    var m = /^https:\/\/([a-z0-9.-]+(?::[0-9]{1,5})?)(?=[\/?#]|$)([^\s"'<>`\\]*)$/i.exec(u);
    if (!m) return imageResult('refused', '', '', 'That is not a web link.');
    var host = m[1].toLowerCase().replace(/^www\./, '');
    var rest = m[2];
    var path = pathPart(rest);
    var ext = IMAGE_EXT_RE.test(path);

    if (host === 'editor.torn.com') return imageResult('ok', u, host, 'Uploaded to Torn.');
    if (host === 'drive.google.com') {
      var id = (/\/file\/(?:u\/[0-9]+\/)?d\/([A-Za-z0-9_-]{20,})/.exec(path) || [])[1] || '';
      if (!id) id = /^\/(open|uc|thumbnail)$/.test(path) ? (/^[A-Za-z0-9_-]{20,}$/.exec(queryParam(rest, 'id')) || [''])[0] : '';
      if (!id) return imageResult('refused', '', host, 'That is a Drive folder or page, not a file. Open the image file in Drive and copy its share link.');
      var fixedDrive = 'https://drive.google.com/thumbnail?id=' + id + '&sz=w1000';
      return imageResult(fixedDrive === u ? 'ok' : 'fixed', fixedDrive, host,
        'The file must be shared as "Anyone with the link". Drive serves it 1000px wide.');
    }
    if (host === 'docs.google.com') return imageResult('refused', '', host, 'Google Docs pages are not images.');
    if (host === 'dropbox.com') {
      if (/^\/scl\/fo\//.test(path)) return imageResult('refused', '', host, 'That is a Dropbox folder. Share the image file itself.');
      if (!/^\/(s|scl\/fi)\//.test(path)) return imageResult('refused', '', host, 'That Dropbox link is not a shared file.');
      var query = rest.slice(path.length).replace(/^\?/, '').split('#')[0];
      var params = query ? query.split('&').filter(function (q) { return q && !/^(dl|raw)=/.test(q); }) : [];
      params.push('raw=1');
      var fixedBox = 'https://www.dropbox.com' + path + '?' + params.join('&');
      return imageResult(fixedBox === u ? 'ok' : 'fixed', fixedBox, host, 'The link must be public.');
    }
    if (host === 'dl.dropboxusercontent.com') return imageResult('ok', u, host, '');
    if (host === 'github.com') {
      var gh = /^\/([^\/]+)\/([^\/]+)\/(?:blob|raw)\/(.+)$/.exec(path);
      if (!gh) return imageResult('refused', '', host, 'Open the image file on GitHub and copy that link.');
      if (/\.svg$/i.test(gh[3])) return imageResult('refused', '', host, 'GitHub serves SVG files as text, so they will not show. Use a PNG.');
      return imageResult('fixed', 'https://raw.githubusercontent.com/' + gh[1] + '/' + gh[2] + '/' + gh[3], host,
        'Public repositories only.');
    }
    if (host === 'raw.githubusercontent.com') {
      if (/\.svg$/i.test(path)) return imageResult('refused', '', host, 'GitHub serves SVG files as text, so they will not show. Use a PNG.');
      return imageResult('ok', u, host, '');
    }
    if (host === 'giphy.com') {
      var gi = /^\/(?:gifs|embed)\/(?:[^\/]*-)?([A-Za-z0-9]+)\/?$/.exec(path);
      if (!gi) return imageResult('refused', '', host, 'Open the GIF on Giphy and copy its link.');
      return imageResult('fixed', 'https://media.giphy.com/media/' + gi[1] + '/giphy.gif', host, '');
    }
    if (/^media[0-9]?\.giphy\.com$/.test(host)) return imageResult('ok', u, host, '');
    if (host === 'gyazo.com') {
      var gy = /^\/([0-9a-f]{32})\/?$/.exec(path);
      if (!gy) return imageResult('refused', '', host, 'Use Share, then Copy Direct Link on Gyazo.');
      return imageResult('fixed', 'https://i.gyazo.com/' + gy[1] + '.png', host,
        'Right for screenshots. For a GIF or video capture, use Share, then Copy Direct Link.');
    }
    if (host === 'i.gyazo.com') return imageResult('ok', u, host, '');
    if (host === 'imgur.com' || host === 'm.imgur.com') {
      if (/^\/(a|gallery|t|r|user)\//.test(path)) {
        return imageResult('howto', '', host, 'That is an Imgur album or gallery. Open the image, right-click it, choose Copy image address (it starts with i.imgur.com).');
      }
      var im = /^\/([A-Za-z0-9]{5,8})(?:\.[A-Za-z]{3,4})?\/?$/.exec(path);
      if (!im) return imageResult('refused', '', host, 'Open the image on Imgur and copy its link.');
      return imageResult('fixed', 'https://i.imgur.com/' + im[1] + '.png', host,
        'If it is a GIF, change .png to .gif. Imgur is blocked in the UK, so UK readers see a broken image.');
    }
    if (host === 'i.imgur.com') return imageResult('ok', u, host, 'Imgur is blocked in the UK, so UK readers see a broken image.');
    if (host === 'reddit.com' && path === '/media' && !(depth > 0)) {
      var inner = '';
      try { inner = decodeURIComponent(queryParam(rest, 'url')); } catch (e) { inner = ''; }
      var r = fixImageUrl(inner, 1);
      return r.status === 'ok' || r.status === 'fixed' ? imageResult('fixed', r.url, r.host, r.note) : r;
    }
    if (host === 'preview.redd.it') {
      return imageResult('fixed', 'https://i.redd.it' + path, host, 'Reddit images often refuse to show on other sites.');
    }
    if (host === 'i.redd.it') return imageResult('ok', u, host, 'Reddit images often refuse to show on other sites.');
    if (host === 'cdn.discordapp.com' || host === 'media.discordapp.net') {
      return imageResult('refused', '', host, 'Discord links expire after about a day, so the image would break. Upload it somewhere lasting.');
    }
    if (Object.prototype.hasOwnProperty.call(IMAGE_HOWTO, host) || /\.sharepoint\.com$/.test(host)) {
      return imageResult('howto', '', host, IMAGE_HOWTO[host] || IMAGE_HOWTO['onedrive.live.com']);
    }
    if (host === 'lh3.googleusercontent.com' || ext) return imageResult('ok', u, host, '');
    return imageResult('refused', '', host, 'This looks like a web page, not an image. Open the image itself and copy its address.');
  }

  // A bare https link in running text, without the punctuation that ends a
  // sentence or closes link markup around it.
  function bareLinksIn(text) {
    var out = [];
    var re = /https:\/\/[^\s<>"'`]+/gi;
    var m;
    while ((m = re.exec(text))) out.push(m[0].replace(/[).,;:!?\]]+$/, ''));
    return out;
  }

  // How many links in this running text the fixer would rewrite if they stood
  // alone: they are left as links, and counted so the notice can say so.
  function countFixableLinks(text, decode) {
    var n = 0;
    bareLinksIn(text).forEach(function (u) {
      if (fixImageUrl(decode ? u.replace(/&amp;/g, '&') : u).status === 'fixed') n += 1;
    });
    return n;
  }

  // Every image link in a draft that the fixer can rewrite, rewritten. A
  // fixable bare link that stands alone on its line becomes an image; one in a
  // sentence or inside link markup is left as it is and counted (leftAsLinks).
  function fixAllImages(lang, text) {
    var changed = 0;
    var left = 0;
    var src = String(text || '');
    if (lang === 'md') {
      src = src.replace(/(!\[[^\]\n]*\]\()([^)\s]+)(\))/g, function (all, a, url, b) {
        var r = fixImageUrl(url);
        if (r.status !== 'fixed') return all;
        changed += 1;
        return a + r.url + b;
      });
      src = src.split('\n').map(function (line) {
        var t = line.trim();
        if (/^https:\/\/\S+$/i.test(t)) {
          var r = fixImageUrl(t);
          if (r.status === 'fixed') {
            changed += 1;
            return line.replace(t, function () { return '![](' + r.url + ')'; });
          }
          return line;
        }
        left += countFixableLinks(line.replace(/!\[[^\]\n]*\]\([^)\s]+\)/g, ''), false);
        return line;
      }).join('\n');
    } else if (lang === 'html') {
      // Single- or double-quoted src, as players type either.
      src = src.replace(/(<img\b[^>]*?\bsrc=)(["'])([^"']*)\2/gi, function (all, a, q, url) {
        var r = fixImageUrl(url.replace(/&amp;/g, '&'));
        if (r.status !== 'fixed') return all;
        changed += 1;
        return a + q + r.url.replace(/&/g, '&amp;') + q;
      });
      if (src.length <= CLEAN_MAX_CHARS) {
        var tokens = tokenizeHtml(src);
        var stack = [];
        var edits = [];
        for (var i = 0; i < tokens.length; i += 1) {
          var tk = tokens[i];
          if (tk.type === 'open') {
            if (!tk.selfClose) stack.push(tk.tag);
          } else if (tk.type === 'close') {
            var at = stack.lastIndexOf(tk.tag);
            if (at !== -1) stack.length = at;
          } else if (!tk.raw) {
            var end = i + 1 < tokens.length ? tokens[i + 1].pos : src.length;
            var seg = src.slice(tk.pos, end);
            if (seg.indexOf('<') !== -1) continue; // a comment sits in here: leave it be
            if (stack.length) { left += countFixableLinks(seg, true); continue; }
            var lines = seg.split('\n');
            var off = tk.pos;
            for (var k = 0; k < lines.length; k += 1) {
              var ln = lines[k];
              var startsLine = k > 0 || off === 0 || src.charAt(off - 1) === '\n';
              var endsLine = k < lines.length - 1 || end >= src.length || src.charAt(end) === '\n';
              var tl = ln.trim();
              var fixed = startsLine && endsLine && /^https:\/\/\S+$/i.test(tl) ? fixImageUrl(tl.replace(/&amp;/g, '&')) : null;
              if (fixed && fixed.status === 'fixed') {
                changed += 1;
                var lead = ln.indexOf(tl);
                edits.push({ from: off + lead, to: off + lead + tl.length, text: '<img src="' + fixed.url.replace(/&/g, '&amp;') + '">' });
              } else {
                left += countFixableLinks(ln, true);
              }
              off += ln.length + 1;
            }
          }
        }
        for (var e = edits.length - 1; e >= 0; e -= 1) src = src.slice(0, edits[e].from) + edits[e].text + src.slice(edits[e].to);
      }
    }
    return { text: src, changed: changed, leftAsLinks: left };
  }

  // ---- custom color contrast (#58) ------------------------------------------

  function hexRgb(hex) {
    var h = String(hex || '').toLowerCase();
    if (/^#[0-9a-f]{3}$/.test(h)) h = '#' + h.charAt(1) + h.charAt(1) + h.charAt(2) + h.charAt(2) + h.charAt(3) + h.charAt(3);
    if (!/^#[0-9a-f]{6}$/.test(h)) return null;
    return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
  }

  function relLuminance(rgb) {
    var c = rgb.map(function (v) {
      var s = v / 255;
      return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  }

  function contrastRatio(a, b) {
    var x = hexRgb(a);
    var y = hexRgb(b);
    if (!x || !y) return 0;
    var l1 = relLuminance(x);
    var l2 = relLuminance(y);
    return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
  }

  // The themes a custom color is near-invisible in: under 2.5:1 against the
  // editor backgrounds the owner measured, fainter than every Torn text color
  // except the grays. Anything stronger is the player's choice.
  function colorWarnings(hex) {
    var out = [];
    ['light', 'dark'].forEach(function (theme) {
      var r = contrastRatio(hex, EDITOR_BG[theme]);
      if (r && r < 2.5) out.push({ theme: theme, ratio: Math.floor(r * 10) / 10 });
    });
    return out;
  }


  // ---- editor operations (#58) -----------------------------------------------
  // Pure edits on the source text and its selection. Each returns the new text
  // and the selection to restore, so the runtime only reads and writes the
  // panel's own textarea.

  function clampSel(text, start, end) {
    var n = text.length;
    var a = Math.max(0, Math.min(n, start | 0));
    var b = Math.max(0, Math.min(n, end | 0));
    return a <= b ? [a, b] : [b, a];
  }

  function wrapSelection(text, start, end, open, close, placeholder) {
    var t = String(text || '');
    var s = clampSel(t, start, end);
    var inner = s[0] === s[1] ? (placeholder || '') : t.slice(s[0], s[1]);
    var next = t.slice(0, s[0]) + open + inner + close + t.slice(s[1]);
    return { text: next, start: s[0] + open.length, end: s[0] + open.length + inner.length };
  }

  // Puts a block on lines of its own: a line break before it unless the caret
  // starts a line, and after it unless the caret ends one.
  function insertBlock(text, start, end, block) {
    var t = String(text || '');
    var s = clampSel(t, start, end);
    var before = s[0] > 0 && t.charAt(s[0] - 1) !== '\n' ? '\n' : '';
    var after = s[1] < t.length && t.charAt(s[1]) !== '\n' ? '\n' : '';
    var next = t.slice(0, s[0]) + before + block + after + t.slice(s[1]);
    var caret = s[0] + before.length + block.length;
    return { text: next, start: caret, end: caret };
  }

  function lineBounds(t, start, end) {
    var a = t.lastIndexOf('\n', start - 1) + 1;
    var nl = t.indexOf('\n', Math.max(end - (end > start && t.charAt(end - 1) === '\n' ? 1 : 0), start));
    return [a, nl === -1 ? t.length : nl];
  }

  function colorValue(value) {
    return TORN_COLOR_NAMES.indexOf(value) !== -1 ? 'var(--te-text-color-' + value + ')' : String(value).toLowerCase();
  }

  // The open and close marks for a toolbar button, in the draft's language.
  function markPair(lang, mark, value) {
    var md = lang === 'md';
    switch (mark) {
      case 'bold': return md ? ['**', '**'] : ['<strong>', '</strong>'];
      case 'italic': return md ? ['*', '*'] : ['<em>', '</em>'];
      case 'underline': return md ? ['++', '++'] : ['<span style="text-decoration: underline;">', '</span>'];
      case 'strike': return md ? ['~~', '~~'] : ['<span style="text-decoration: line-through;">', '</span>'];
      case 'color': return md ? ['{' + String(value).toLowerCase() + '}', '{/}'] : ['<span style="color: ' + colorValue(value) + ';">', '</span>'];
      case 'size': return md ? ['{' + (value | 0) + '}', '{/}'] : ['<span style="font-size: ' + (value | 0) + 'px;">', '</span>'];
      case 'link': return md ? ['[', '](' + value + ')'] : ['<a href="' + escAttr(value) + '">', '</a>'];
      default: return ['', ''];
    }
  }

  // A block tag in HTML source. An inline mark never spans one, so a selection
  // across two paragraphs is marked inside each, and the paragraphs stay two.
  var HTML_BLOCK_TAG = /<\/?(?:p|h[1-6]|li|ul|ol|blockquote|table|thead|tbody|tfoot|tr|td|th|div)(?:\s[^>]*)?>/gi;

  function applyMark(lang, text, start, end, mark, value) {
    var pair = markPair(lang, mark, value);
    var placeholder = mark === 'link' ? 'link text' : 'text';
    var t = String(text || '');
    var s = clampSel(t, start, end);
    var sel = t.slice(s[0], s[1]);
    HTML_BLOCK_TAG.lastIndex = 0;
    if (lang !== 'html' || s[0] === s[1] || !HTML_BLOCK_TAG.test(sel)) {
      return wrapSelection(t, s[0], s[1], pair[0], pair[1], placeholder);
    }
    var out = '';
    var last = 0;
    var wrap = function (part) { return part.trim() === '' ? part : pair[0] + part + pair[1]; };
    HTML_BLOCK_TAG.lastIndex = 0;
    var m;
    while ((m = HTML_BLOCK_TAG.exec(sel)) !== null) {
      out += wrap(sel.slice(last, m.index)) + m[0];
      last = m.index + m[0].length;
    }
    out += wrap(sel.slice(last));
    return { text: t.slice(0, s[0]) + out + t.slice(s[1]), start: s[0], end: s[0] + out.length };
  }

  var HTML_P_LINE = /^\s*<(?:p|h[1-6])(?:\s[^>]*)?>/i;
  var HTML_BLOCK_LINE = /^\s*<(?:p|h[1-6]|ul|ol|blockquote|table|div)(?:\s[^>]*)?>/i;
  var HTML_P_OPEN = /<(p|h[1-6])((?:\s[^>]*)?)>/gi;

  var HTML_CELL_OPEN = /<(th|td)((?:\s[^>]*)?)>/gi;
  var HTML_TABLE_SPAN = /<table\b[^>]*>[\s\S]*?<\/table\s*>/gi;

  // Sets text-align on each paragraph opening tag in a line (or, given
  // HTML_CELL_OPEN, each table cell), replacing any it had.
  function alignOpenTag(line, value, openTag) {
    return line.replace(openTag || HTML_P_OPEN, function (all, tag, attrs) {
      var decl = 'text-align: ' + value + ';';
      var sm = /\sstyle\s*=\s*("([^"]*)"|'([^']*)')/i.exec(attrs);
      if (!sm) return '<' + tag + attrs + ' style="' + decl + '">';
      var kept = String(sm[2] !== undefined ? sm[2] : sm[3]).split(';')
        .filter(function (d) { return d.trim() !== '' && !/^\s*text-align\s*:/i.test(d); })
        .map(function (d) { return d.trim() + ';'; });
      var style = [decl].concat(kept).join(' ');
      return '<' + tag + attrs.slice(0, sm.index) + ' style="' + style + '"' + attrs.slice(sm.index + sm[0].length) + '>';
    });
  }

  // HTML lines, split into block lines and runs of loose text between them.
  function htmlLineGroups(body, isBlock) {
    var groups = [];
    body.split('\n').forEach(function (l) {
      var block = isBlock(l);
      var prev = groups[groups.length - 1];
      if (!block && prev && !prev.block) prev.lines.push(l);
      else groups.push({ block: block, lines: [l] });
    });
    return groups;
  }

  function looseRun(lines) {
    return lines.map(function (l) { return l.trim() === '' ? '' : l; }).join('\n');
  }

  // HTML lines aligned: a paragraph line in place, loose text in a new one.
  function htmlAlignBody(body, value) {
    return htmlLineGroups(body, function (l) { return HTML_P_LINE.test(l); })
      .map(function (g) {
        if (g.block) return alignOpenTag(g.lines[0], value);
        var run = looseRun(g.lines);
        return run.trim() === '' && body.trim() !== '' ? run : '<p style="text-align: ' + value + ';">' + run + '</p>';
      }).join('\n');
  }

  function isMdTableLine(l) { return l.trim().charAt(0) === '|'; }

  // #58 B4: a Markdown table keeps its alignment in its delimiter row (the
  // --- row under the header), so aligning any line of it rewrites that row
  // for every column. Justify has no Markdown form and becomes left. A table
  // without that row cannot hold an alignment: null.
  function alignMdTable(lines, value) {
    var heads = splitCells(lines[0]);
    var aligns = lines.length > 1 ? delimiterAligns(lines[1]) : null;
    if (!aligns || aligns.length !== heads.length) return null;
    var cell = value === 'center' ? ':---:' : value === 'right' ? '---:' : ':---';
    return [lines[0], '| ' + heads.map(function () { return cell; }).join(' | ') + ' |'].concat(lines.slice(2));
  }

  // The line range [a, z) grown over every Markdown table it cuts, aligned as
  // whole tables, with the other lines fenced as before. Null when no table
  // line is in the range; { refused } when a table has no header row.
  function alignMdRange(t, a, z, value) {
    var lineAt = function (i) { var e = t.indexOf('\n', i); return t.slice(i, e === -1 ? t.length : e); };
    while (a > 0) {
      var pa = t.lastIndexOf('\n', a - 2) + 1;
      if (pa >= a || !isMdTableLine(lineAt(a)) || !isMdTableLine(t.slice(pa, a - 1))) break;
      a = pa;
    }
    while (z < t.length) {
      var last = t.slice(t.lastIndexOf('\n', z - 1) + 1, z);
      var nz = t.indexOf('\n', z + 1);
      if (!isMdTableLine(last) || !isMdTableLine(t.slice(z + 1, nz === -1 ? t.length : nz))) break;
      z = nz === -1 ? t.length : nz;
    }
    var lines = t.slice(a, z).split('\n');
    if (!lines.some(isMdTableLine)) return null;
    var runs = [];
    lines.forEach(function (l) {
      var table = isMdTableLine(l);
      var prev = runs[runs.length - 1];
      if (prev && prev.table === table) prev.lines.push(l); else runs.push({ table: table, lines: [l] });
    });
    var out = [];
    for (var i = 0; i < runs.length; i += 1) {
      var r = runs[i];
      if (r.table) {
        var aligned = alignMdTable(r.lines, value);
        if (!aligned) return { refused: 'table-header' };
        out = out.concat(aligned);
      } else if (r.lines.join('').trim() === '') {
        out = out.concat(r.lines);
      } else {
        out = out.concat([':::' + value], r.lines, [':::']);
      }
    }
    return { a: a, z: z, out: out.join('\n') };
  }

  // The HTML twin: every table the range touches is aligned whole (each th
  // and td), and the text around the tables is aligned as before. Null when
  // the range touches no table.
  function alignHtmlRange(t, a, z, value) {
    var touched = false;
    for (var grown = true; grown;) {
      grown = false;
      HTML_TABLE_SPAN.lastIndex = 0;
      var m;
      while ((m = HTML_TABLE_SPAN.exec(t)) !== null) {
        var ts = m.index;
        var te = ts + m[0].length;
        if (ts >= z || te <= a) continue;
        touched = true;
        var na = Math.min(a, t.lastIndexOf('\n', ts - 1) + 1);
        var ne = t.indexOf('\n', te);
        var nz = Math.max(z, ne === -1 ? t.length : ne);
        if (na !== a || nz !== z) { a = na; z = nz; grown = true; }
      }
    }
    if (!touched) return null;
    var body = t.slice(a, z);
    var out = '';
    var last = 0;
    var seg = function (part) { return part.trim() === '' ? part : htmlAlignBody(part, value); };
    HTML_TABLE_SPAN.lastIndex = 0;
    var tm;
    while ((tm = HTML_TABLE_SPAN.exec(body)) !== null) {
      out += seg(body.slice(last, tm.index)) + alignOpenTag(tm[0], value, HTML_CELL_OPEN);
      last = tm.index + tm[0].length;
    }
    out += seg(body.slice(last));
    return { a: a, z: z, out: out };
  }

  // Quote and alignment act on whole lines. In HTML a line that is already a
  // paragraph is aligned in place or quoted as it is, never put inside another
  // paragraph; loose text is wrapped in one.
  function applyBlockMark(lang, text, start, end, mark, value) {
    var t = String(text || '');
    var s = clampSel(t, start, end);
    var b = lineBounds(t, s[0], s[1]);
    if (mark === 'align') {
      var tb = lang === 'md' ? alignMdRange(t, b[0], b[1], value) : alignHtmlRange(t, b[0], b[1], value);
      if (tb && tb.refused) return { text: t, start: s[0], end: s[1], refused: tb.refused };
      if (tb) return { text: t.slice(0, tb.a) + tb.out + t.slice(tb.z), start: tb.a, end: tb.a + tb.out.length };
    }
    var body = t.slice(b[0], b[1]);
    var replaced;
    if (lang === 'md') {
      replaced = mark === 'quote'
        ? body.split('\n').map(function (l) { return l.trim() === '' ? '>' : '> ' + l; }).join('\n')
        : ':::' + value + '\n' + body + '\n:::';
    } else if (mark === 'quote') {
      replaced = '<blockquote>' + htmlLineGroups(body, function (l) { return HTML_BLOCK_LINE.test(l); })
        .map(function (g) {
          if (g.block) return g.lines[0].trim();
          var run = looseRun(g.lines);
          return run.trim() === '' && body.trim() !== '' ? '' : '<p>' + run + '</p>';
        }).join('') + '</blockquote>';
    } else {
      replaced = htmlAlignBody(body, value);
    }
    var next = t.slice(0, b[0]) + replaced + t.slice(b[1]);
    return { text: next, start: b[0], end: b[0] + replaced.length };
  }

  function tableSkeleton(lang, cols, rows, header) {
    var c = Math.max(1, Math.min(8, cols | 0));
    var r = Math.max(1, Math.min(30, rows | 0));
    var heads = [];
    var cells = [];
    for (var k = 0; k < c; k += 1) { heads.push('Column ' + (k + 1)); cells.push('Cell'); }
    if (lang === 'md') {
      var lines = [];
      if (header) {
        lines.push('| ' + heads.join(' | ') + ' |');
        lines.push('| ' + heads.map(function () { return '---'; }).join(' | ') + ' |');
      }
      for (var i = 0; i < r; i += 1) lines.push('| ' + cells.join(' | ') + ' |');
      return lines.join('\n');
    }
    var html = '<table><tbody>';
    if (header) html += '<tr>' + heads.map(function (h) { return '<th>' + h + '</th>'; }).join('') + '</tr>';
    for (var j = 0; j < r; j += 1) html += '<tr>' + cells.map(function (x) { return '<td>' + x + '</td>'; }).join('') + '</tr>';
    return html + '</tbody></table>';
  }

  function emojiSnippet(lang, name) {
    if (TORN_EMOJI.indexOf(name) === -1) return '';
    return lang === 'md' ? ':' + name + ':' : '<img src="/images/emotions/svg/' + name + '.svg">';
  }

  function imageSnippet(lang, url, alt) {
    var a = String(alt || '').replace(/[\[\]\n]/g, ' ').trim();
    return lang === 'md' ? '![' + a + '](' + url + ')'
      : '<img src="' + escAttr(url) + '"' + (a ? ' alt="' + escAttr(a) + '"' : '') + '>';
  }

  // An inline snippet (an emoji, an image) in place of the selection, with the
  // caret after it.
  function insertAtCaret(text, start, end, snippet) {
    var t = String(text || '');
    var s = clampSel(t, start, end);
    var next = t.slice(0, s[0]) + snippet + t.slice(s[1]);
    var caret = s[0] + snippet.length;
    return { text: next, start: caret, end: caret };
  }

  // The paragraph or list item the caret is inside, from the text before the
  // caret: its opening tag as typed, and the inline elements open inside it,
  // to close before the break and reopen after. It is read from the start of
  // the top-level block still open at the caret (by the same line rule
  // Preview and Insert use), not from the caret's line, so a paragraph that
  // runs over several lines still splits.
  function enterContext(before) {
    var info = {};
    htmlLineSegments(before, info);
    if (info.open < 0) return null;
    var head = before.slice(info.open);
    var toks = tokenizeHtml(head);
    var stack = [];
    for (var i = 0; i < toks.length; i += 1) {
      var t = toks[i];
      if (t.type === 'open' && !t.selfClose && !RAW_TEXT_TAGS[t.tag]) stack.push({ tag: t.tag, src: head.slice(t.pos, t.end), end: info.open + t.end });
      else if (t.type === 'close') {
        for (var k = stack.length - 1; k >= 0; k -= 1) if (stack[k].tag === t.tag) { stack.length = k; break; }
      }
    }
    for (var j = stack.length - 1; j >= 0; j -= 1) {
      if (stack[j].tag !== 'p' && stack[j].tag !== 'li') continue;
      var inner = stack.slice(j + 1);
      return {
        tag: stack[j].tag, src: stack[j].src, inner: inner.slice(),
        at: stack[j].end - stack[j].src.length, openEnd: stack[j].end,
        reopen: inner.map(function (x) { return x.src; }).join(''),
        close: inner.reverse().map(function (x) { return '</' + x.tag + '>'; }).join(''),
      };
    }
    return null;
  }

  // #58 round 2: what Enter does in the editor, or null for the browser's own
  // newline (which the line rule already makes a new paragraph, and an empty
  // line a gap). A selection is replaced first, as a typed key replaces it.
  //   HTML: inside <p ...>a|b</p> on the caret's line, the paragraph splits and
  //   keeps its opening tag (its alignment); inside <li>a|b</li>, the item
  //   splits. Shift+Enter is a line break, <br>.
  //   An EMPTY item (only whitespace and open inline tags before the caret,
  //   only closing tags after it) is removed and the caret goes to a new
  //   top-level line after the list's close, which ends the list as an empty
  //   Markdown marker does (htmlEmptyItemExit).
  //   Markdown: a list or quote line continues on the next line; a line that
  //   is only the marker loses it, which ends the list or quote.
  function htmlEmptyItemExit(before, after, ctx) {
    var between = before.slice(ctx.openEnd).replace(/<[a-zA-Z][a-zA-Z0-9]*(?:[ \t][^<>]*)?>/g, function (tag) {
      return /^<(?:img|br|hr)\b/i.test(tag) ? 'x' : '';
    });
    if (between.trim() !== '') return null;
    var close = /^(?:\s*<\/[a-zA-Z][a-zA-Z0-9]*[ \t]*>)*?\s*<\/li[ \t]*>/i.exec(after);
    if (!close) return null;
    var head = before.slice(0, ctx.at);
    var tail = after.slice(close[0].length);
    // The item had its own line: that line goes with it.
    if (/(^|\n)[ \t]*$/.test(head) && /^[ \t]*(\n|$)/.test(tail)) {
      head = head.replace(/[ \t]*$/, '');
      tail = tail.replace(/^[ \t]*\n?/, '');
    }
    // The close of the list holding the item: the first </ul> or </ol> at
    // this item's depth. The caret goes on a new line after it.
    var toks = tokenizeHtml(tail);
    var depth = 0;
    for (var i = 0; i < toks.length; i += 1) {
      var tk = toks[i];
      if (tk.tag !== 'ul' && tk.tag !== 'ol') continue;
      if (tk.type === 'open' && !tk.selfClose) depth += 1;
      else if (tk.type === 'close') {
        if (depth === 0) {
          var c = head.length + tk.end + 1;
          return { text: head + tail.slice(0, tk.end) + '\n' + tail.slice(tk.end), start: c, end: c };
        }
        depth -= 1;
      }
    }
    return null;
  }

  function editorEnter(lang, text, start, end, shift) {
    if (lang !== 'html' && lang !== 'md') return null;
    var t = String(text || '');
    var sel = clampSel(t, start, end);
    var before = t.slice(0, sel[0]);
    var after = t.slice(sel[1]);
    var lineStart = before.lastIndexOf('\n') + 1;
    var head = before.slice(lineStart);
    var put = function (ins) {
      var c = before.length + ins.length;
      return { text: before + ins + after, start: c, end: c };
    };
    if (lang === 'html') {
      if (shift) return put('<br>');
      // The caret inside a tag's own markup: the browser's newline.
      if (head.lastIndexOf('<') > head.lastIndexOf('>')) return null;
      var nb = before.replace(/\r\n?/g, '\n');
      var ctx = enterContext(nb);
      if (!ctx) return null;
      // An empty item ends the list (positions hold only without CRs).
      if (ctx.tag === 'li' && nb.length === before.length) {
        var exit = htmlEmptyItemExit(before, after, ctx);
        if (exit) return exit;
      }
      // Enter at the end of a heading (a size span holding bold) starts a
      // plain paragraph, not another heading.
      var closing = /^(?:<\/[a-zA-Z][a-zA-Z0-9]*[ \t]*>)*/.exec(after)[0];
      var atEnd = /<\/p[ \t]*>/i.test(closing) || /^[ \t]*(\n|$)/.test(after.slice(closing.length));
      var heading = ctx.tag === 'p' && ctx.inner.length === 2 && ctx.inner[0].tag === 'span'
        && /font-size/i.test(ctx.inner[0].src) && (ctx.inner[1].tag === 'strong' || ctx.inner[1].tag === 'b');
      if (heading && atEnd) {
        // The heading's own closing tags after the caret are replaced, so the
        // new paragraph holds none of them.
        var pEnd = /<\/p[ \t]*>/i.exec(closing);
        var ins = ctx.close + '</p>\n<p>';
        var c = before.length + ins.length;
        return { text: before + ins + (pEnd ? '</p>' : '') + after.slice(pEnd ? pEnd.index + pEnd[0].length : closing.length), start: c, end: c };
      }
      return put(ctx.close + '</' + ctx.tag + '>\n' + ctx.src + ctx.reopen);
    }
    if (shift) return null;
    var nl = after.indexOf('\n');
    var rest = nl === -1 ? after : after.slice(0, nl);
    var m = /^[ \t]*[-*+][ \t]+/.exec(head) || /^[ \t]*[0-9]{1,9}[.)][ \t]+/.exec(head) || /^[ \t]*>[ \t]?/.exec(head);
    if (!m) return null;
    if ((head + rest).slice(m[0].length).trim() === '') {
      return { text: t.slice(0, lineStart) + after.slice(rest.length), start: lineStart, end: lineStart };
    }
    var ol = /^([ \t]*)([0-9]{1,9})([.)][ \t]+)$/.exec(m[0]);
    if (ol) return put('\n' + ol[1] + Math.min(parseInt(ol[2], 10) + 1, 999999999) + ol[3]);
    var q = /^([ \t]*)>/.exec(m[0]);
    if (q) return put('\n' + q[1] + '> ');
    return put('\n' + m[0]);
  }

  // Common Unicode emoji, for the picker's second tab. Code points, not
  // characters, so the source stays ASCII (constraint 4). A pair is an emoji
  // and its variation selector.
  var UNICODE_EMOJI = Object.freeze([
    [0x1F600], [0x1F602], [0x1F642], [0x1F609], [0x1F60D], [0x1F60E], [0x1F914], [0x1F605],
    [0x1F622], [0x1F621], [0x1F631], [0x1F634], [0x1F923], [0x1F644], [0x1F62C], [0x1F91D],
    [0x1F44D], [0x1F44E], [0x1F44F], [0x1F64F], [0x1F4AA], [0x1F440], [0x1F525], [0x1F4AF],
    [0x1F389], [0x1F4B0], [0x1F480], [0x1F48A], [0x1F3C6], [0x2B50], [0x2705], [0x274C],
    [0x26A0, 0xFE0F], [0x2764, 0xFE0F], [0x1F494], [0x2708, 0xFE0F], [0x1F680], [0x23F0], [0x1F4CC],
  ].map(function (cps) { return String.fromCodePoint.apply(String, cps); }));

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

  function loadKey(name, normaliser, now, recoveredCheck) {
    var raw = readRaw(name);
    if (raw === PARSE_FAILED) {
      return { value: normaliser(null, now), recovered: true, hadRaw: true };
    }
    var value = normaliser(raw, now);
    var recovered = (recoveredCheck || isRecoveredValue)(raw, value);
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
    badges: freshBadges(),
    badgeShelfOpen: false,
    badgeCatalogueOpen: false,
    badgeToast: null,
    dwell: freshDwell(),
    mine: freshMine(),
    refreshingMine: false,
    mineError: null,
    // The last My posts run stopped its lookups at a throttle (#24). Runtime
    // only: a reload starts without the notice, and the next run decides again.
    mineThrottled: false,
    // Rows the last My posts run dropped for a missing id, per list (#24).
    // Counts only, for the debug report; runtime only, like mineThrottled.
    mineDropped: { threads: 0, posts: 0 },
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
    // #58: the draft open in the Drafts editor. Typing updates text and the
    // selection here without a redraw (onInput), the way drawerEdit does.
    editor: {
      key: null, lang: 'md', text: '', selStart: 0, selEnd: 0, mode: 'source', previewTheme: null,
      picker: null, confirmText: null, moreOpen: false, emojiTab: 'torn', name: '', imageCheck: null,
      fixOpen: false, fixCheck: null,
      pickerWarn: null, dirty: false, showImages: false, fields: {}, src: 'new|md', atLimit: false,
      undo: [], typingAt: 0,
    },
    // #58: the panel's resolved theme, set by applyThemeClass; Preview
    // defaults to it.
    themeResolved: null,
    pendingRedraw: false,
    generation: 0,
    mounted: false,
    route: null,
    replyBoxFound: false,
    // Show all, per capped view, until the page reloads. Never persisted and
    // never exported: the issue asks for "this session only", and a page load
    // is the only session boundary a userscript can see.
    showAll: {},
    // #33, all runtime only and reset on reload, like showAll. narrow follows
    // the panel's own width. The next four are spec section 6's transient
    // state; focusIntent carries a user action's focus plan into its redraw;
    // pressActive holds a redraw while a press that began in the panel is in
    // progress; liveMessage is the polite announcement after Read or Archive.
    narrow: false,
    openRowId: null,
    filtersOpen: false,
    openInfoId: null,
    drawerEdit: null,
    // #43: the drawer's open tag or note popup, { id, field }. Never saved.
    openEditor: null,
    focusIntent: null,
    pressActive: false,
    deferCommit: false,
    liveMessage: null,
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

  function currentTransient() {
    return { openRowId: state.openRowId, filtersOpen: state.filtersOpen,
      openInfoId: state.openInfoId, drawerEdit: state.drawerEdit };
  }
  function setTransient(t) {
    state.openRowId = t.openRowId;
    state.filtersOpen = t.filtersOpen;
    state.openInfoId = t.openInfoId;
    state.drawerEdit = t.drawerEdit;
  }
  function applyTransient(ev) { setTransient(nextTransient(currentTransient(), ev)); }

  // Every wholesale replacement of state.settings comes through here, so a
  // replacement that changes the view or collapses the panel closes the
  // disclosures exactly as the matching user action would (spec section 6).
  function replaceSettings(next) {
    if (next.view !== state.settings.view) applyTransient({ type: 'view' });
    else if (next.collapsed === true && state.settings.collapsed !== true) applyTransient({ type: 'collapse' });
    state.settings = next;
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

  // True once a write failed during the current action: its error notice
  // must not be replaced by that action's own success message. Every action
  // entry (onAction, onChange, onInput, a thread link) and a route change
  // clears it; persist sets it.
  var persistFailed = false;

  function notice(text, kind) {
    var k = kind || 'info';
    // A failed save is never hidden by a later "done" in the same action;
    // a warning or another error still replaces it.
    if (k === 'info' && persistFailed) return;
    // One status message at a time: a new one replaces the previous.
    state.notices = [{ text: safeString(text, 300), kind: k }];
  }

  // "A", "A and B", "A, B, and C": the comma before the last "and" keeps
  // "Folders and tags" readable as one name.
  function joinNames(names) {
    if (names.length < 3) return names.join(' and ');
    return names.slice(0, -1).join(', ') + ', and ' + names[names.length - 1];
  }

  function loadAll(now) {
    var s = loadKey(STORAGE_KEYS.settings, normaliseSettings, now, isRecoveredSettings);
    var o = loadKey(STORAGE_KEYS.organizer, normaliseOrganizer, now, isRecoveredOrganizer);
    var d = loadKey(STORAGE_KEYS.drafts, normaliseDrafts, now);
    var f = loadKey(STORAGE_KEYS.feed, normaliseFeed, now);
    var p = loadKey(STORAGE_KEYS.postCache, normalisePostCache, now);
    var m = loadKey(STORAGE_KEYS.mine, normaliseMine, now);
    var b = loadKey(STORAGE_KEYS.badges, normaliseBadges, now);
    state.settings = s.value;
    state.organizer = o.value;
    state.drafts = d.value;
    state.feed = f.value;
    state.postCache = p.value;
    state.mine = m.value;
    state.badges = b.value;
    // A key that failed normalisation is reported rather than silently reset,
    // because a user who loses their folders deserves to know it happened.
    var damaged = [];
    [['Settings', s], ['Folders and tags', o], ['Drafts', d], ['Cached thread list', f], ['Post cache', p], ['My posts list', m],
      ['Badges', b]]
      .forEach(function (pair) {
        if (pair[1].recovered) damaged.push(pair[0]);
      });
    // One slot for messages: every damaged store is named in a single notice.
    if (damaged.length) notice(joinNames(damaged) + ' were damaged and have been reset.', 'warn');
  }

  function persist(which) {
    var map = {
      settings: [STORAGE_KEYS.settings, state.settings],
      organizer: [STORAGE_KEYS.organizer, state.organizer],
      drafts: [STORAGE_KEYS.drafts, state.drafts],
      feed: [STORAGE_KEYS.feed, state.feed],
      postCache: [STORAGE_KEYS.postCache, state.postCache],
      mine: [STORAGE_KEYS.mine, state.mine],
      badges: [STORAGE_KEYS.badges, state.badges],
    };
    var pair = map[which];
    if (!pair) return { ok: true };
    var res = saveKey(pair[0], pair[1]);
    if (!res.ok) { persistFailed = true; notice(res.detail || 'Could not save.', 'error'); }
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
      authorOnly: state.settings.authorOnly === true,
    });
  }

  // ---- badges runtime (issue #9) ---------------------------------------------

  var BADGE_TOAST_MS = 6000;

  // The one Catch up list. buildPanelModel renders it and the badge check-in
  // counts it, so the two cannot disagree. Like the panel, it sees only the
  // Threads population: a My posts-only thread lives in its own view.
  function catchUpRowsNow() {
    var threadRows = state.rows.filter(function (r) { return r.inThreads; });
    var mode = state.settings.authorOnly ? 'author' : 'any';
    return sortThreads(catchUpList(threadRows, state.organizer.lastCatchUpAt, mode), 'activity');
  }

  // Author-only mode (issue #4): the "Not yet checked" group beside Catch up.
  // Empty when the mode is off, exactly as the panel shows it.
  function catchUpUncheckedNow() {
    if (!state.settings.authorOnly) return [];
    var threadRows = state.rows.filter(function (r) { return r.inThreads; });
    return sortThreads(catchUpUnchecked(threadRows), 'activity');
  }

  function badgeContext(now) {
    // Unknown is not clear (panel ruling 9): a not-yet-checked row blocks the
    // check-in now, and a later ordinary refresh the same Torn day can credit it.
    var cu = catchUpRowsNow().concat(catchUpUncheckedNow());
    return {
      now: now,
      facts: badgeFacts({
        organizer: state.organizer,
        feed: state.feed,
        hasKey: isKeyShaped(loadApiKey()),
        keyRejected: state.settings.keyRejected,
      }),
      blockers: cu.length,
      catchUpIds: cu.map(function (r) { return r.id; }),
      subscribed: state.feed.subscribed.length,
      fetchedAt: state.feed.fetchedAt,
    };
  }

  function queueBadgeToast(ids, now) {
    var ctx = badgeContext(now);
    state.badgeToast = { text: badgeToastText(ids, state.badges, ctx.facts), until: now + BADGE_TOAST_MS, announced: false };
  }

  // Every badge write goes through here. It applies one event to a FRESH read
  // of storage, so two tabs usually see each other's work. Best effort only:
  // cross-tab propagation is asynchronous, and no badge depends on an exact
  // count near a cap.
  function recordBadgeEvent(event, now) {
    if (!state.settings.badges) return null;
    try {
      var stored = loadKey(STORAGE_KEYS.badges, normaliseBadges, now).value;
      var res = applyBadgeEvent(stored, event, badgeContext(now));
      state.badges = res.record;
      if (res.changed) persist('badges');
      if (res.newly.length) queueBadgeToast(res.newly, now);
      return res;
    } catch (e) {
      return null;
    }
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
        var authorMode = state.settings.authorOnly === true;
        var targets = state.rows
          .filter(function (r) {
            if (!r.subscribed) return false;
            // Author mode selects on the author state, never on unread: an
            // unchecked row has unread 0 by design, so selecting on it would
            // check nothing, ever.
            if (authorMode) return r.authorState === 'unchecked' && (r.authorReason === 'never' || r.authorReason === 'stale');
            return r.unread > 0 && r.activitySource !== 'enriched';
          })
          .slice(0, budget);
        var ids = targets.map(function (r) { return r.numericId; });
        return authorMode ? checkAuthorPosts(ids, now, options, budget) : enrichThreads(ids, now, options);
      })
      .then(function (res) {
        if (!stale()) {
          recompute(now);
          persist('feed');
          persist('organizer');
          // A refresh that succeeded today: feed.fetchedAt is set only on success.
          if (state.lastError === null && state.feed.fetchedAt === now) {
            recordBadgeEvent({ type: 'refreshed' }, now);
          }
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

  // Author-only lookups (issue #4): forum/{id}/posts in place of
  // forum/{id}/thread. With from set, Torn returns the newest 20 posts at or
  // after it, newest first, and ignores offset; to (also inclusive) pages
  // further back, so each further page repeats the previous page's oldest
  // post, which summariseAuthorPosts counts once. from is marker + 1: a post
  // at the marker was already seen. Every page is one unit of the same lookup
  // budget, a thread gets at most AUTHOR_MAX_PAGES, and a further page is
  // fetched only while one request stays reserved for each thread not yet
  // started, so the refresh total never moves. URLs are built here, through
  // tornApiGet, from from and to; the prev URL Torn returns is read only for
  // null, never fetched, because it carries Torn's own parameters. The check
  // total is the subscribed posts.total; a thread's own "posts" counts
  // replies and is one less, so it must never be stored here (if one is ever
  // needed, threadPostsTotal converts it; never add 1 again after that). The
  // entry is re-read after the walk, because a handler may have replaced the
  // organizer while the requests were in flight.
  function checkAuthorPosts(ids, now, opts, budget) {
    var list = (ids || []).slice(0, MAX_ENRICH_BUDGET);
    if (!list.length) return Promise.resolve({ ok: true, checked: 0, requests: 0 });
    var cap = Math.min(MAX_ENRICH_BUDGET, Math.max(list.length, toInt(budget, list.length)));
    var spent = 0;
    var done = 0;
    var generation = state.generation;

    function step(i) {
      if (i >= list.length) return Promise.resolve({ ok: true, checked: done, requests: spent });
      var id = String(list[i]);
      var before = entryOf(state.organizer, id);
      var since = authorSinceFor(before);
      var row = state.rows.filter(function (r) { return r.id === id; })[0] || null;
      var authorId = (row && row.authorId) || before.authorId;
      var total = row ? row.postsTotal : before.postsTotal;
      var from = Math.floor(since / 1000) + 1;
      var posts = [];
      var pages = 0;

      function page(to) {
        var params = { from: from };
        if (to > 0) params.to = to;
        spent += 1;
        pages += 1;
        return tornApiGet('forum/' + id + '/posts', params, opts).then(function (res) {
          if (generation !== state.generation) return { stale: true };
          if (!(res.ok && isPlainObject(res.data) && Array.isArray(res.data.posts))) {
            return { failed: true, throttled: res.reason === 'throttled' };
          }
          var meta = isPlainObject(res.data._metadata) && isPlainObject(res.data._metadata.links) ? res.data._metadata.links : {};
          var seenIds = posts.map(function (p) { return isPlainObject(p) ? p.id : null; });
          var walk = authorPageStep(res.data.posts, seenIds, POSTS_PER_PAGE, meta.prev);
          posts = posts.concat(res.data.posts);
          if (walk.done) return { complete: walk.complete };
          // Breadth before depth: one request stays reserved for every
          // thread in this batch that has not had its first page yet.
          var reserved = list.length - (i + 1);
          if (pages >= AUTHOR_MAX_PAGES || spent + reserved >= cap) return { complete: false };
          return page(walk.to);
        });
      }

      return page(0).then(function (out) {
        if (out.stale) return { ok: true, checked: done, requests: spent, stale: true };
        if (out.failed && pages === 1) {
          // Nothing read: write nothing, so the row stays never/stale.
          if (out.throttled) return { ok: true, checked: done, requests: spent, stoppedEarly: true };
          return step(i + 1);
        }
        // A failed further page keeps what was read, as a walk cut short.
        var sum = summariseAuthorPosts(posts, authorId, since, out.complete === true);
        var e = entryOf(state.organizer, id);
        e.authorCheckedAt = now;
        e.authorCheckTotal = total;
        e.authorCheckSince = since;
        e.authorNewCount = sum.count;
        e.authorLatestAt = sum.latestAt;
        e.authorCheckComplete = sum.complete;
        e.authorCheckReason = !sum.complete && sum.count === 0 ? 'too-many' : '';
        if (sum.newestAt > 0) {
          // Newest first with no upper bound: the newest post read is the
          // thread's last post, however the walk ended.
          e.lastPostTimeCached = Math.max(e.lastPostTimeCached, sum.newestAt);
          e.enrichedAt = now;
        }
        done += 1;
        if (out.throttled) return { ok: true, checked: done, requests: spent, stoppedEarly: true };
        return step(i + 1);
      });
    }

    return step(0);
  }

  var MINE_SHAPE_THREADS = 'Torn\'s answer for your threads was not in the shape this version expects.';
  var MINE_SHAPE_POSTS = 'Torn\'s answer for your posts was not in the shape this version expects.';

  function enrichMine(ids, now, opts, generation) {
    function step(i) {
      if (i >= ids.length) return Promise.resolve({ ok: true });
      return tornApiGet('forum/' + ids[i] + '/thread', {}, opts).then(function (res) {
        if (generation !== state.generation) return { ok: false, reason: 'stale' };
        if (res.ok && res.data && isPlainObject(res.data.thread)) {
          state.mine = applyMineDetail(state.mine, ids[i], parseThreadDetail(res.data.thread), now);
        } else if (res.reason === 'throttled') {
          // Stop the batch rather than grinding against the limit. The rows not
          // reached keep saying "not checked yet".
          return { ok: true, stoppedEarly: true };
        }
        return step(i + 1);
      });
    }
    return step(0);
  }

  // Topic-post lookups for thumbs (#10): started threads only, only inside
  // refreshMine, after #2's lookups. Stops at the first throttle, like
  // enrichThreads. An unrecognised answer stamps nothing. Only the counts are
  // kept: topicPostFromApi never reads a post's content.
  function enrichReactions(ids, now, opts, generation) {
    function step(i) {
      if (i >= ids.length) return Promise.resolve({ ok: true });
      var params = { offset: TOPIC_POST_PARAMS.offset };
      return tornApiGet('forum/' + ids[i] + '/posts', params, opts).then(function (res) {
        if (generation !== state.generation) return { ok: false, reason: 'stale' };
        if (res.ok) {
          var topic = topicPostFromApi(res.data, ids[i]);
          if (topic !== undefined) state.mine = applyTopicPost(state.mine, ids[i], topic, now);
        } else if (res.reason === 'throttled') {
          return { ok: true, stoppedEarly: true };
        }
        return step(i + 1);
      });
    }
    return step(0);
  }

  // The karma fallback (#10): one user/profile request, only from refreshMine,
  // only when the caller found both lists empty (karmaFallbackDue). Reads
  // profile.karma and nothing else. A throttle or failure leaves karma unknown.
  function readKarmaProfile(now, opts, generation) {
    return tornApiGet('user/profile', {}, opts).then(function (res) {
      if (generation !== state.generation || !res.ok) return { ok: false };
      var k = karmaFromProfile(res.data);
      if (k !== null) state.mine = setKarma(state.mine, k, now);
      return { ok: true };
    });
  }

  // A separate, bounded action for the My posts view only: two lists, at
  // most enrichBudget lookups, then at most min(5, enrichBudget) opening-post
  // reads (#10); never the category list. Threads' refresh and auto refresh
  // never call this.
  function refreshMine(now, opts) {
    var options = opts || {};
    if (state.refreshingMine) return Promise.resolve({ ok: false, reason: 'inflight' });
    state.refreshingMine = true;
    var generation = state.generation;
    var budget = clamp(toInt(state.settings.enrichBudget, DEFAULT_ENRICH_BUDGET), 0, MAX_ENRICH_BUDGET);
    var params = { limit: MINE_PAGE_LIMIT };
    var started = null;
    var throttled = false;

    function stale() { return generation !== state.generation; }
    function fail(res, fallback) {
      state.mineError = { reason: (res && res.reason) || 'network', detail: scrubDetail((res && res.detail) || fallback) };
      return { ok: false, reason: state.mineError.reason, detail: state.mineError.detail };
    }

    var work = tornApiGet('user/forumthreads', params, options)
      .then(function (res) {
        if (stale()) return { ok: false, reason: 'stale' };
        if (!res.ok) return fail(res, 'Could not load your threads.');
        var list = pickList(res.data, ['forumThreads', 'forum_threads', 'threads']);
        if (!list) return fail({ reason: 'parse', detail: MINE_SHAPE_THREADS });
        started = list.map(mineThreadFromApi).filter(Boolean);
        state.mineDropped = { threads: list.length - started.length, posts: 0 };
        return tornApiGet('user/forumposts', params, options).then(function (pres) {
          if (stale()) return { ok: false, reason: 'stale' };
          var complete = false;
          var posts = [];
          var postRows = null;   // the raw posts list, null when it failed or did not parse
          var outcome = { ok: true };
          if (!pres.ok) {
            outcome = fail(pres, 'Could not load your posts.');
            state.mineError.detail = 'Threads you posted in could not be loaded: ' + state.mineError.detail;
            outcome.detail = state.mineError.detail;
          } else {
            var plist = pickList(pres.data, ['forumPosts', 'forum_posts', 'posts']);
            if (!plist) {
              outcome = fail({ reason: 'parse', detail: MINE_SHAPE_POSTS });
            } else {
              posts = plist.map(minePostFromApi).filter(Boolean);
              state.mineDropped.posts = plist.length - posts.length;
              postRows = plist;
              complete = true;
              state.mineError = null;
            }
          }
          state.mine = mergeMineSnapshot(state.mine, started, posts, now, complete);
          // Forum karma for free: the author of rows already fetched (#10).
          var seenKarma = karmaFromAuthors(list, 'first_post_time', state.mine.selfId);
          if (seenKarma === null) seenKarma = karmaFromAuthors(postRows, 'created_time', state.mine.selfId);
          if (seenKarma !== null) state.mine = setKarma(state.mine, seenKarma, now);
          var ids = mineLookupTargets(state.mine, state.feed.subscribed, budget, now, MINE_TTL_MS);
          // The karma fallback: only when both lists came back and both are
          // empty, so ids is empty too and the run is exactly 3 requests.
          var karmaDue = karmaFallbackDue(state.mine, now, KARMA_TTL_MS,
            list.length, Array.isArray(postRows) ? postRows.length : null);
          return (karmaDue ? readKarmaProfile(now, options, generation) : Promise.resolve({ ok: true }))
            .then(function () {
              if (stale()) return outcome;
              return enrichMine(ids, now, options, generation).then(function (er) {
                if (er && er.stoppedEarly) throttled = true;
                if (stale() || throttled) return outcome;
                var rn = Math.min(REACTION_LOOKUPS_PER_RUN, budget);
                var rids = reactionLookupTargets(state.mine, now, TOPIC_TTL_MS, rn);
                return enrichReactions(rids, now, options, generation).then(function (rr) {
                  if (rr && rr.stoppedEarly) throttled = true;
                  return outcome;
                });
              });
            });
        });
      })
      .then(function (res) {
        // A stale answer writes nothing: the user reset, cleared the key, or
        // left the page while it was in flight.
        if (!stale()) {
          state.mineThrottled = throttled;
          persist('mine');
          recompute(now);
        }
        return res;
      })
      .catch(function (e) {
        // A stale run's error is dropped like its answer (#24).
        if (stale()) return { ok: false, reason: 'stale' };
        return fail({ reason: 'network', detail: e && e.message }, 'My posts could not be loaded.');
      });

    return work.then(function (r) {
      state.refreshingMine = false;
      return r;
    });
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

  // ---- focused thread visits (issue #9) --------------------------------------

  // Reads the page's own visibility and focus, never Torn's markup (ADR 0001).
  // Takeover covers the thread, so time in takeover is not time on the thread.
  function dwellActive(doc) {
    try {
      if (!state.route || !state.route.isThread) return false;
      if (doc.hidden === true) return false;
      if (typeof doc.hasFocus === 'function' && doc.hasFocus() !== true) return false;
      return !state.settings.takeover;
    } catch (e) {
      return false;
    }
  }

  function sampleDwell(doc, win, now) {
    var id = state.route && state.route.isThread ? String(state.route.threadId) : '';
    var step = dwellStep(state.dwell, id, dwellActive(doc), now);
    state.dwell = step.dwell;
    if (!step.credit) return false;
    var entry = Object.prototype.hasOwnProperty.call(state.organizer.threads, step.credit)
      ? state.organizer.threads[step.credit] : null;
    var forumId = (state.route && state.route.forumId) || (entry ? entry.forumId : 0) || 0;
    recordBadgeEvent({ type: 'visit', threadId: step.credit, forumId: forumId }, now);
    return true;
  }

  var dwellTimer = null;
  var DWELL_FLAG = '__tfccDwellObserved';

  // A self-rescheduling timeout rather than setInterval, so a missed tick can
  // never queue a burst, and the step cap in dwellStep absorbs a late one.
  function startDwell(doc, win) {
    if (dwellTimer !== null) return;
    function tick() {
      dwellTimer = null;
      try {
        if (!isForumsPage(win.location)) return;
        var now = Date.now();
        var changed = sampleDwell(doc, win, now);
        if (state.badgeToast && now >= state.badgeToast.until) { state.badgeToast = null; changed = true; }
        if (changed) drawIfStillHere(doc, win, makeHandlers(doc, win));
      } catch (e) { /* the sampler must never throw onto Torn's page */ }
      dwellTimer = setTimeout(tick, DWELL_TICK_MS);
    }
    dwellTimer = setTimeout(tick, DWELL_TICK_MS);
    try {
      if (win && !win[DWELL_FLAG]) {
        win[DWELL_FLAG] = true;
        var onChange = function () {
          try { if (isForumsPage(win.location)) sampleDwell(doc, win, Date.now()); } catch (e) { /* never */ }
        };
        win.addEventListener('focus', onChange);
        win.addEventListener('blur', onChange);
        if (doc && typeof doc.addEventListener === 'function') doc.addEventListener('visibilitychange', onChange);
      }
    } catch (e2) { /* listeners are an accuracy aid; the tick still samples */ }
  }

  function stopDwell() {
    if (dwellTimer !== null) { clearTimeout(dwellTimer); dwellTimer = null; }
    state.dwell = freshDwell();
  }

  // ---- reply box and drafts ----------------------------------------------

  // Torn's reply box is TinyMCE 6.8.5 in inline mode: a contenteditable div,
  // not a textarea (docs/reference/torn-forum-editor-findings-2026-10-09.md).
  // These hooks are unhashed, and TornTools uses the same selector. There is
  // no textarea fallback on purpose: the old broad fallbacks matched a hidden
  // Report reason box and wrote the draft there (#60). A miss offers Copy.
  var REPLY_SELECTORS = Object.freeze([
    '#editor-wrapper .editor-content.mce-content-body',
  ]);

  function isShown(el) {
    try {
      var r = el.getBoundingClientRect();
      return !!r && r.width > 0 && r.height > 0;
    } catch (e) { return false; }
  }

  // A thread page holds several TinyMCE editors (the owner's probe found five).
  // Keep the connected, visible ones; if more than one is visible, the one in
  // the reply or new-thread form; if that is still ambiguous, none, so the
  // panel offers Copy rather than guessing.
  function findReplyBox(doc) {
    if (!doc || typeof doc.querySelectorAll !== 'function') return null;
    var all;
    try { all = Array.prototype.slice.call(doc.querySelectorAll(REPLY_SELECTORS[0]) || []); } catch (e) { return null; }
    var shown = all.filter(function (el) {
      return el && el.isConnected !== false && typeof el.getBoundingClientRect === 'function' && isShown(el);
    });
    if (shown.length === 1) return shown[0];
    var inForm = shown.filter(function (el) {
      try { return typeof el.closest === 'function' && !!el.closest('.forums-new-post-wrap'); } catch (e) { return false; }
    });
    return inForm.length === 1 ? inForm[0] : null;
  }

  // The paste lands at the caret, so the caret goes to the end first: Insert
  // adds to what the player has typed and never replaces it.
  function caretToEnd(doc, win, box) {
    try {
      var sel = win && typeof win.getSelection === 'function' ? win.getSelection() : null;
      if (!sel || !doc || typeof doc.createRange !== 'function') return;
      var range = doc.createRange();
      range.selectNodeContents(box);
      range.collapse(false);
      sel.removeAllRanges();
      sel.addRange(range);
    } catch (e) { /* the paste still lands, at TinyMCE's own caret */ }
  }

  // ADR 0002. One synthetic paste, marked as TinyMCE's own content so Torn's
  // paste_webkit_styles: 'none' filter keeps the styles (owner-observed, test
  // B). TinyMCE calls preventDefault on a paste it handles, so dispatchEvent
  // returning false, and the body having changed, together mean it landed.
  // The player still presses Post.
  function insertPost(doc, win, html) {
    var box = findReplyBox(doc);
    if (!box) {
      return { ok: false, reason: 'noreplybox', detail: 'No reply box found on this page. Use Copy instead.' };
    }
    var DT = win && win.DataTransfer;
    var CE = win && win.ClipboardEvent;
    if (typeof DT !== 'function' || typeof CE !== 'function') {
      return { ok: false, reason: 'unsupported', detail: 'This browser cannot insert for you. Use Copy instead.' };
    }
    try {
      var before = String(box.innerHTML);
      if (typeof box.focus === 'function') box.focus();
      caretToEnd(doc, win, box);
      var data = new DT();
      data.setData('text/html', PASTE_MARKER + html);
      data.setData('text/plain', htmlToText(html));
      var handled = box.dispatchEvent(new CE('paste', { clipboardData: data, bubbles: true, cancelable: true })) === false;
      if (handled && String(box.innerHTML) !== before) return { ok: true };
      return { ok: false, reason: 'refused', detail: 'Torn\'s editor did not accept the insert. Use Copy instead.' };
    } catch (e) {
      return { ok: false, reason: 'insert', detail: 'Could not write into the reply box. Use Copy instead.' };
    }
  }

  // Autosave keeps its own record of which element, which listener and which
  // thread it is serving. The panel redraws on every interaction, so attaching
  // per draw would pile up listeners; and a timer must save to the thread it
  // was started for, never to the one the player has since moved to.
  var autosaveBox = null;
  var autosaveTimer = null;
  var autosaveListener = null;
  var autosaveThread = null;

  function attachAutosave(doc, win) {
    void win;
    if (!state.settings.autosaveDrafts || !state.route || !state.route.isThread) { detachAutosave(); return false; }
    var box = findReplyBox(doc);
    if (!box || typeof box.addEventListener !== 'function') { detachAutosave(); return false; }
    var thread = String(state.route.threadId);
    if (autosaveBox === box && autosaveThread === thread) return true;
    detachAutosave();
    autosaveBox = box;
    autosaveThread = thread;
    autosaveListener = function () {
      if (autosaveTimer !== null) clearTimeout(autosaveTimer);
      autosaveTimer = setTimeout(function () {
        autosaveTimer = null;
        try {
          if (!state.settings.autosaveDrafts) return;
          if (!state.route || String(state.route.threadId) !== thread || autosaveBox !== box) return;
          // #58: the box is TinyMCE's body, so its HTML is the post, cleaned
          // like everything else and saved as an HTML draft, never over a
          // Markdown or Text draft the player wrote in the panel.
          var post = cleanTornHtml(String(box.innerHTML || ''));
          // An empty editor never deletes a saved draft. Torn clears the box
          // after a successful post, and can hand back an empty body during a
          // re-render; either would otherwise wipe work the user still wants.
          if (!htmlToText(post).trim() && post.indexOf('<img') === -1) return;
          var source = htmlSource(post);
          // Over the draft limit: skip rather than store a truncated post.
          if (source.length > DRAFT_MAX_CHARS) return;
          var existing = draftFor(state.drafts, thread);
          if (existing && draftLangOf(existing) !== 'html') return;
          state.drafts = saveDraft(state.drafts, thread, source, Date.now(), '', 'html');
          persist('drafts');
        } catch (e) { /* autosave must never throw onto Torn's page */ }
      }, AUTOSAVE_DEBOUNCE_MS);
    };
    box.addEventListener('input', autosaveListener);
    return true;
  }

  function detachAutosave() {
    if (autosaveBox && autosaveListener && typeof autosaveBox.removeEventListener === 'function') {
      try { autosaveBox.removeEventListener('input', autosaveListener); } catch (e) { /* the box is gone */ }
    }
    autosaveBox = null;
    autosaveListener = null;
    autosaveThread = null;
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
      // "Could not read a color" and "read a transparent color" are different
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
        // A transparent element paints nothing, so the color comes from
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
      state.themeResolved = theme;
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

  // The 17 Torn text colors for a Preview theme, as one declaration list, so
  // a cleaned post's var(--te-text-color-*) resolves inside the panel.
  function teVars(theme) {
    return TORN_COLORS.map(function (c) { return '--te-text-color-' + c.name + ': ' + c[theme] + ';'; }).join(' ');
  }

  function panelStyleText() {
    return [
      // Color values follow Torn Bookie Live Scores' default scheme so the two
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
      '  --tfcc-tier-bronze: #d6955b; --tfcc-tier-silver: #c3ccd6; --tfcc-tier-gold: #e8c06a;',
      '  --tfcc-tier-legend: #c9a2ff; --tfcc-locked: #8a8a8a;',
      // "started" in My posts (#30): 6.2:1 on the row, 7.8:1 on the tag fill.
      '  --tfcc-started: #ff8080;',
      // #45 (owner): the priority number, the logo's muted blue (#5C768F)
      // lightened for dark: 6.91:1 on the row, 7.52:1 on the panel. The logo
      // blue itself is 3.49:1 here, too low for 12px text.
      '  --tfcc-prio: #8db3d9;',
      // #53 (owner): the logo's color, per theme. Dark keeps #5C768F.
      '  --tfcc-logo: #5c768f;',
      // #43 (owner): the "See-through background" setting's two base layers,
      // --tm-bg and --tm-bg-2 with alpha: the panel's own background at 50%
      // and the thread row card at 75%. Dedicated tokens, so no other fill
      // (controls, pills, the shelf and toast, popups) changes. They are
      // painted only under #tfcc-panel.tfcc-seethrough.
      '  --tfcc-base-bg: rgba(31, 31, 31, 0.5); --tfcc-row-bg: rgba(38, 38, 38, 0.75);',
      // #33: the narrow header button size; fitHeader overrides it inline.
      '  --tfcc-hb: 44px;',
      // #33 nav numerals, v1 tint (spec 13f). The same in both themes, because
      // the color is the cell's own text color. contrast is in style.test.js.
      '  --tfcc-navnum-opacity: 0.14; --tfcc-navnum-opacity-selected: 0.09;',
      '  --tfcc-navlab-opacity: 0.9; --tfcc-navlab-opacity-selected: 0.96; --tfcc-navnum-size: 40px;',
      '}',
      '#' + PANEL_ID + '.tfcc-theme-light {',
      '  --tm-bg: #f2f2f2; --tm-bg-2: #e8e8e8; --tm-bg-3: #ffffff; --tm-hover: #dcdcdc;',
      '  --tm-border: #c4c4c4; --tm-border-2: #9a9a9a;',
      '  --tm-text: #141414; --tm-muted: #4a4a4a; --tm-meta: #3a3a3a;',
      '  --tm-good-bg: #cfe8d4; --tm-good-text: #1c5c2c; --tm-bad-text: #a11414;',
      '  --tm-warn-text: #7a5600; --tm-accent-text: #14507d;',
      '  --tfcc-tier-bronze: #8c4e17; --tfcc-tier-silver: #4f5966; --tfcc-tier-gold: #7a5600;',
      '  --tfcc-tier-legend: #6a2fb5; --tfcc-locked: #6e6e6e;',
      // "started" (#30): 6.5:1 on the row, 8.0:1 on the tag fill.
      '  --tfcc-started: #a11414;',
      // #45: the logo blue darkened for light: 6.21:1 on the row, 6.80:1 on
      // the panel (the logo blue is 4.22:1 here).
      '  --tfcc-prio: #2e5680;',
      // #53 (owner): #5C768F was all but invisible here; a muted dark blue,
      // 8.20:1 on the panel and 7.49:1 on the row, apart from the priority blue.
      '  --tfcc-logo: #2e4a66;',
      '  --tfcc-base-bg: rgba(242, 242, 242, 0.5); --tfcc-row-bg: rgba(232, 232, 232, 0.75);',
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
      // any such rule of theirs beat our panel's inherited color and painted
      // black text on the dark panel. background needs its own reset because it
      // is not inherited at all, which is how a host `code { background: #eee }`
      // survived the color fix and left grey text on a grey block.
      // Both declarations are (1,0,0), so every rule below still wins.
      '#' + PANEL_ID + ' * { color: inherit; background: transparent; }',
      '#' + PANEL_ID + ' code, #' + PANEL_ID + ' pre {',
      '  font-family: ui-monospace, Consolas, monospace; font-size: var(--tfcc-text-sm);',
      '  color: var(--tm-accent-text); background: var(--tm-bg-3);',
      '  border-radius: 3px; padding: 0 4px; }',
      '#' + PANEL_ID + '.tfcc-takeover { position: fixed; inset: 0; margin: 0; border-radius: 0;',
      '  z-index: 2147483000; height: 100vh; height: 100dvh; max-height: 100vh; max-height: 100dvh;',
      '  overflow-y: auto; overflow-x: hidden; padding: 12px; }',
      // #43 (owner): "See-through background", one class on the panel. Only
      // the panel's base and the row cards go translucent; text and every
      // control stay opaque (alpha on the color, never opacity). The blur is
      // a readability aid for a busy page under it; it cannot help a plain
      // one, so contrast was measured without it, and a browser without it
      // simply shows the page. Expand covers the page, so it stays solid.
      '#' + PANEL_ID + '.tfcc-seethrough { background: var(--tfcc-base-bg);',
      '  -webkit-backdrop-filter: blur(6px); backdrop-filter: blur(6px); }',
      '#' + PANEL_ID + '.tfcc-seethrough .tfcc-row { background: var(--tfcc-row-bg); }',
      '#' + PANEL_ID + '.tfcc-seethrough.tfcc-takeover { background: var(--tm-bg);',
      '  -webkit-backdrop-filter: none; backdrop-filter: none; }',
      '#' + PANEL_ID + '.tfcc-seethrough.tfcc-takeover .tfcc-row { background: var(--tm-bg-2); }',
      '#' + PANEL_ID + ' .tfcc-head { display: flex; align-items: center; gap: var(--tfcc-gap);',
      '  flex-wrap: wrap; margin-bottom: var(--tfcc-gap); }',
      // The logo (#30) stands where the bold title text stood: as tall as the
      // badge chip beside it (28px), its width from the viewBox. The fill
      // is pinned here as well as on the element, because a host rule beats a
      // presentation attribute. Contrast is in tests/contrast-audit.mjs.
      '#' + PANEL_ID + ' .tfcc-logo { display: block; flex: none; height: 28px; width: auto;',
      '  color: var(--tfcc-logo); }',
      '#' + PANEL_ID + ' .tfcc-logo path { fill: currentColor; }',
      // Title group left, control group right. The buttons are one nowrap unit,
      // so at 320-360 px the control group wraps onto its own line WHOLE and
      // Refresh, Expand and Hide stay together, in order.
      '#' + PANEL_ID + ' .tfcc-head-id { display: flex; align-items: center; gap: var(--tfcc-gap-sm);',
      '  flex-wrap: wrap; min-width: 0; }',
      '#' + PANEL_ID + ' .tfcc-head-ctl { display: flex; align-items: center; gap: var(--tfcc-gap);',
      '  flex-wrap: wrap; justify-content: flex-end; margin-left: auto; }',
      '#' + PANEL_ID + ' .tfcc-head-btns { display: inline-flex; gap: var(--tfcc-gap-xs); flex-wrap: nowrap; }',
      '#' + PANEL_ID + ' button.tfcc-chip { display: inline-flex; align-items: center; gap: 3px; flex: 0 0 auto;',
      '  white-space: nowrap; min-height: 28px; padding: 2px 8px; border-radius: 14px;',
      '  font-size: var(--tfcc-text-sm); font-weight: bold; }',
      '#' + PANEL_ID + ' .tfcc-chip * { pointer-events: none; }',
      '#' + PANEL_ID + ' .tfcc-ico { display: inline-block; vertical-align: middle; flex: 0 0 auto; }',
      '#' + PANEL_ID + ' .tfcc-ico path { fill: currentColor; fill-rule: evenodd; stroke: none; }',
      '#' + PANEL_ID + ' .tfcc-tier-bronze { color: var(--tfcc-tier-bronze); }',
      '#' + PANEL_ID + ' .tfcc-tier-silver { color: var(--tfcc-tier-silver); }',
      '#' + PANEL_ID + ' .tfcc-tier-gold { color: var(--tfcc-tier-gold); }',
      '#' + PANEL_ID + ' .tfcc-tier-legend { color: var(--tfcc-tier-legend); }',
      '#' + PANEL_ID + ' .tfcc-locked { color: var(--tfcc-locked); }',
      '#' + PANEL_ID + ' .tfcc-shelf, #' + PANEL_ID + ' .tfcc-toast { border: 1px solid var(--tm-border);',
      '  border-radius: 4px; padding: var(--tfcc-gap-sm) var(--tfcc-gap); margin-bottom: var(--tfcc-gap);',
      '  background: var(--tm-bg-2); }',
      '#' + PANEL_ID + ' .tfcc-badge-row { display: flex; gap: var(--tfcc-gap-sm); align-items: center;',
      '  flex-wrap: wrap; margin-bottom: var(--tfcc-gap-xs); }',
      '#' + PANEL_ID + ' .tfcc-bar-track { display: inline-block; background: var(--tm-bg-3);',
      '  border: 1px solid var(--tm-border); border-radius: 3px; height: 8px; width: 120px; max-width: 40%; }',
      '#' + PANEL_ID + ' .tfcc-bar-fill { display: block; background: var(--tm-good-text); height: 100%; }',
      '@media (prefers-reduced-motion: no-preference) {',
      '  #' + PANEL_ID + ' .tfcc-toast-new { animation: tfcc-fade-in 160ms ease-out; }',
      '}',
      '@keyframes tfcc-fade-in { from { opacity: 0; } to { opacity: 1; } }',
      '#' + PANEL_ID + ' .tfcc-badge { background: var(--tm-good-bg); color: var(--tm-text);',
      '  border-radius: 10px; padding: 0 8px; font-size: var(--tfcc-text-sm); font-weight: bold; }',
      '#' + PANEL_ID + ' button, #' + PANEL_ID + ' select, #' + PANEL_ID + ' input,',
      '#' + PANEL_ID + ' textarea {',
      '  font: inherit; color: var(--tm-text); background: var(--tm-bg-3);',
      '  border: 1px solid var(--tm-border-2); border-radius: 4px; padding: 3px 8px; }',
      '#' + PANEL_ID + ' option { background: var(--tm-bg-3); color: var(--tm-text); }',
      '#' + PANEL_ID + ' button { cursor: pointer; }',
      // The click listener reads data-act from ev.target alone, so a tap on a
      // span or icon inside a button (the reactions pill's numbers and thumbs)
      // must land on the button itself (#30).
      '#' + PANEL_ID + ' button * { pointer-events: none; }',
      '#' + PANEL_ID + ' button:hover { background: var(--tm-hover); }',
      // Thread reactions (#10). (1,1,1) beats the generic button rule (1,0,1);
      // :hover at (1,2,1) beats the generic button:hover (1,1,1).
      '#' + PANEL_ID + ' button.tfcc-reactions { font-size: var(--tfcc-text-sm); padding: 0 8px;',
      '  border-radius: 10px; background: var(--tm-bg-3); color: var(--tm-meta);',
      '  border: 1px solid var(--tm-border); white-space: normal; text-align: left; max-width: 100%; }',
      '#' + PANEL_ID + ' button.tfcc-reactions:hover { background: var(--tm-hover); }',
      // In the nav row (#30) the pill takes the auto margin, so it and My posts
      // group on the right; My posts then sits flush beside it. (1,2,1) beats
      // the button.tfcc-nav-mine margin at (1,1,1).
      '#' + PANEL_ID + ' .tfcc-nav button.tfcc-reactions { margin-left: auto; }',
      '#' + PANEL_ID + ' .tfcc-nav .tfcc-reactions + button.tfcc-nav-mine { margin-left: 0; }',
      // The thumbs (#30) drawn in one color: white on the dark panel (the
      // default tokens are dark), black on the light one.
      '#' + PANEL_ID + ' .tfcc-thumb { filter: grayscale(1) brightness(0) invert(1); }',
      '#' + PANEL_ID + '.tfcc-theme-light .tfcc-thumb { filter: grayscale(1) brightness(0); }',
      '#' + PANEL_ID + ' .tfcc-rx { color: var(--tm-text); font-weight: bold; font-variant-numeric: tabular-nums; }',
      '#' + PANEL_ID + ' .tfcc-karma { display: inline-flex; align-items: center; gap: 0.25em;',
      '  white-space: nowrap; color: var(--tm-text); }',
      '#' + PANEL_ID + ' .tfcc-karma svg { flex: none; }',
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
      // My posts stands apart from the other five by place only: last, and
      // pushed right. Its colors are every nav button's (#43, owner): the
      // normal fill, and the selected fill only while it is the current view.
      // Its old light-grey fill read as selected.
      '#' + PANEL_ID + ' button.tfcc-nav-mine { margin-left: auto; }',
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
      // Inline priority (#30): a number and two small buttons after the title.
      // (1,1,1) beats the generic button rule; flex: none keeps the three on
      // the title's line beside the zero-basis title.
      '#' + PANEL_ID + ' .tfcc-prio { flex: none; color: var(--tfcc-prio); font-size: var(--tfcc-text-sm);',
      '  font-variant-numeric: tabular-nums; }',
      '#' + PANEL_ID + ' button.tfcc-prio-btn { flex: none; font-size: var(--tfcc-text-sm); line-height: 1.2;',
      '  padding: 0 6px; min-width: 22px; }',
      '#' + PANEL_ID + ' .tfcc-unread { color: var(--tm-good-text); font-weight: bold;',
      '  font-variant-numeric: tabular-nums; }',
      '#' + PANEL_ID + ' .tfcc-meta { color: var(--tm-meta); font-size: var(--tfcc-text-sm);',
      '  display: flex; gap: var(--tfcc-gap); flex-wrap: wrap; margin-top: 2px; }',
      '#' + PANEL_ID + ' .tfcc-tag { background: var(--tm-bg-3); border: 1px solid var(--tm-border);',
      '  border-radius: 3px; padding: 0 5px; font-size: var(--tfcc-text-sm); }',
      '#' + PANEL_ID + ' .tfcc-tag.tfcc-started { color: var(--tfcc-started); font-weight: bold; }',
      '#' + PANEL_ID + ' .tfcc-actions { display: flex; gap: var(--tfcc-gap-xs); flex-wrap: wrap;',
      '  margin-top: var(--tfcc-gap-xs); }',
      '#' + PANEL_ID + ' .tfcc-actions button { font-size: var(--tfcc-text-sm); padding: 1px 6px; }',
      '#' + PANEL_ID + ' .tfcc-note { color: var(--tm-muted); font-size: var(--tfcc-text-sm); }',
      // #41: "Clip titles and summaries that wrap", one class on the panel. A
      // row's title and note (its summary) are one line with an ellipsis at
      // every width; a wide row carries the full text as a title tooltip and
      // a narrow one shows it whole while its drawer is open. Thread rows
      // only: Search hits and Drafts are not .tfcc-row.
      '#' + PANEL_ID + '.tfcc-clip .tfcc-row-main .tfcc-row-title { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }',
      '#' + PANEL_ID + '.tfcc-clip .tfcc-row > .tfcc-note { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }',
      '#' + PANEL_ID + '.tfcc-clip .tfcc-row.tfcc-open > .tfcc-note { white-space: normal; overflow: visible; }',
      // #33: anything carrying the hidden attribute stays hidden, whatever a
      // display rule on it or on the host says.
      '#' + PANEL_ID + ' [hidden] { display: none !important; }',
      '#' + PANEL_ID + ' .tfcc-gl { display: block; flex: none; }',
      // (1,1,1): beats a host "svg * { fill }" rule, as the logo rule does.
      '#' + PANEL_ID + ' .tfcc-gl path { fill: none; stroke: currentColor; stroke-width: 2;',
      '  stroke-linecap: round; stroke-linejoin: round; }',
      '#' + PANEL_ID + ' .tfcc-infobar { display: flex; align-items: center; gap: var(--tfcc-gap-sm);',
      // nowrap: a long note wraps inside itself, so its info button stays right
      // after it instead of dropping onto a line of its own (PR #38 review).
      '  flex-wrap: nowrap; margin-bottom: var(--tfcc-gap-sm); }',
      '#' + PANEL_ID + ' .tfcc-infobar > .tfcc-note { flex: 0 1 auto; min-width: 0; }',
      '#' + PANEL_ID + ' .tfcc-infobar h4 { margin: 0; }',
      // #43 (owner): an info button is a bare icon, at every width. It keeps
      // its 44px target and a transparent border (so its box does not move);
      // only the fill and the outline go. Hover and open tint the icon in the
      // accent color instead of filling a box; focus keeps the panel ring.
      '#' + PANEL_ID + ' button.tfcc-info { display: inline-flex; align-items: center; justify-content: center;',
      '  flex: none; min-width: 44px; min-height: 44px; padding: 0; border-color: transparent; background: transparent; }',
      '#' + PANEL_ID + ' button.tfcc-info:hover { background: transparent; color: var(--tm-accent-text); }',
      '#' + PANEL_ID + ' button.tfcc-info[aria-expanded="true"] { background: transparent; color: var(--tm-accent-text); }',
      '#' + PANEL_ID + ' .tfcc-infotext { border-left: 3px solid var(--tm-accent-text);',
      '  padding: 2px 0 2px 8px; margin: 0 0 var(--tfcc-gap-sm) 0; }',
      // Narrow only: the collapsed count's name, the view heading and the live
      // region all render in the narrow layout alone.
      '#' + PANEL_ID + '.tfcc-narrow .tfcc-sr { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px;',
      '  overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0; }',
      // ---- #33 narrow layout. Every rule below hangs off .tfcc-narrow, so a
      // wide panel never sees one. ----
      '#' + PANEL_ID + '.tfcc-narrow { padding: 8px; }',
      // Every narrow control is a real box of at least 44 x 44 (spec principle
      // 4). The header buttons override this with --tfcc-hb (spec 13b) at a
      // higher specificity. Text fields are 16px or more, or iOS zooms the page
      // when one takes focus. One selector per rule, so each is easy to find.
      '#' + PANEL_ID + '.tfcc-narrow button { min-height: 44px; min-width: 44px; }',
      '#' + PANEL_ID + '.tfcc-narrow select { min-height: 44px; min-width: 44px; font-size: max(16px, 1em); }',
      '#' + PANEL_ID + '.tfcc-narrow .tfcc-linkbtn { min-height: 44px; min-width: 44px; display: inline-flex;',
      '  align-items: center; }',
      '#' + PANEL_ID + '.tfcc-narrow input:not([type="checkbox"]) { min-height: 44px; min-width: 44px;',
      '  font-size: max(16px, 1em); }',
      '#' + PANEL_ID + '.tfcc-narrow textarea { font-size: max(16px, 1em); }',
      // A checkbox is reached through its 44px label.
      '#' + PANEL_ID + '.tfcc-narrow .tfcc-kv label { min-width: 0; flex-basis: 100%; min-height: 44px;',
      '  display: flex; align-items: center; }',
      '#' + PANEL_ID + '.tfcc-narrow .tfcc-grow { flex-basis: 100%; }',
      '#' + PANEL_ID + '.tfcc-narrow .tfcc-actions { gap: 6px; }',
      '#' + PANEL_ID + '.tfcc-narrow .tfcc-cap button { min-height: 44px; }',
      // #45: the group toggle and the order arrows keep the 44px target.
      '#' + PANEL_ID + '.tfcc-narrow button.tfcc-grp { min-height: 44px; }',
      '#' + PANEL_ID + '.tfcc-narrow button.tfcc-move { min-width: 44px; min-height: 44px; }',
      // #47: narrow Settings, tighter. One scale: 4px from a label to its own
      // control, 8px between items (and between stacked targets), 12px
      // between sections. Targets stay 44px and text keeps its size; only the
      // whitespace around them shrinks. Everything hangs off .tfcc-set, the
      // narrow Settings wrapper, so no other view moves.
      '#' + PANEL_ID + '.tfcc-narrow .tfcc-set .tfcc-section { margin-bottom: 12px; padding-bottom: 0; }',
      // (Every item ends in an 8px margin, which the border keeps inside the
      // section, so the bottom matches the 8px padding at the top.)
      '#' + PANEL_ID + '.tfcc-narrow .tfcc-set .tfcc-section > h4 { margin-bottom: 8px; }',
      '#' + PANEL_ID + '.tfcc-narrow .tfcc-set .tfcc-kv { gap: 8px; margin-bottom: 8px; }',
      // A label shares its control's line where both fit, and stacks only
      // where they do not, 4px above it (its -4px margin on the 8px gap).
      '#' + PANEL_ID + '.tfcc-narrow .tfcc-set .tfcc-kv > label { flex: 1 1 8em; min-height: 0; margin-bottom: -4px; }',
      // A checkbox's label is its 44px target, on the checkbox's line, with
      // the info icon (if any) after the checkbox.
      // The checkbox leads its line, so every checkbox lines up at the left
      // and every info icon at the right.
      '#' + PANEL_ID + '.tfcc-narrow .tfcc-set .tfcc-kvc > label { min-height: 44px; margin-bottom: 0; }',
      '#' + PANEL_ID + '.tfcc-narrow .tfcc-set .tfcc-kvc > input[type="checkbox"] { order: -1; margin: 0; }',
      // The new folder's name field shares Add's line.
      '#' + PANEL_ID + '.tfcc-narrow .tfcc-set .tfcc-kv > input[type="text"] { flex: 1 1 6em; min-width: 0; }',
      '#' + PANEL_ID + '.tfcc-narrow .tfcc-set .tfcc-infobar { margin-bottom: 8px; }',
      '#' + PANEL_ID + '.tfcc-narrow .tfcc-set p.tfcc-note { margin: 0 0 8px 0; }',
      '#' + PANEL_ID + '.tfcc-narrow .tfcc-set .tfcc-actions { margin: 0 0 8px 0; }',
      '#' + PANEL_ID + '.tfcc-narrow .tfcc-set .tfcc-draft { display: block; margin: 0 0 8px 0; }',
      // A note or info bar that explains the row above it sits 4px under it.
      '#' + PANEL_ID + '.tfcc-narrow .tfcc-set .tfcc-kv + .tfcc-infobar { margin-top: -4px; }',
      '#' + PANEL_ID + '.tfcc-narrow .tfcc-set .tfcc-kv + p.tfcc-note { margin-top: -4px; }',
      // #47: a folder row: name and arrows, then its claimed forums, then the
      // claim menu and Delete.
      // Line 1: the name takes what the arrows and Delete leave, wrapping
      // inside itself on a long name. Line 2 (.tfcc-claimline): the chips,
      // then the menu, wrapping onto further lines when there are many.
      // The name's line break never splits a word: at its narrowest the name
      // takes the first line alone and the controls drop under it, still
      // right-aligned.
      '#' + PANEL_ID + '.tfcc-narrow .tfcc-set .tfcc-forder > label { flex: 1 1 0; min-width: min-content;',
      '  flex-direction: column; align-items: flex-start; justify-content: center; }',
      '#' + PANEL_ID + '.tfcc-narrow .tfcc-set .tfcc-forder > button.tfcc-move:first-of-type { margin-left: auto; }',
      '#' + PANEL_ID + '.tfcc-narrow .tfcc-set button.tfcc-del { display: inline-flex; align-items: center;',
      '  justify-content: center; padding: 0; }',
      '#' + PANEL_ID + '.tfcc-narrow .tfcc-set .tfcc-claimline { flex: 1 1 100%; display: flex; flex-wrap: wrap; gap: 8px;',
      '  min-width: 0; }',
      '#' + PANEL_ID + '.tfcc-narrow .tfcc-set .tfcc-claimline .tfcc-claims { display: contents; }',
      // A folder row is several lines, so a rule marks where the next begins.
      '#' + PANEL_ID + '.tfcc-narrow .tfcc-set .tfcc-forder + .tfcc-forder { border-top: 1px solid var(--tm-border);',
      '  padding-top: 8px; }',
      '#' + PANEL_ID + '.tfcc-narrow .tfcc-set .tfcc-forder select { flex: 1 1 8em; min-width: 0; }',
      '#' + PANEL_ID + '.tfcc-narrow .tfcc-claim { border-radius: 22px; }',
      '#' + PANEL_ID + '.tfcc-narrow button.tfcc-unclaim { min-width: 44px; min-height: 44px; border-radius: 22px; }',
      // The header: one line. These gaps add up to HB_GAPS (20): logo-chip 6,
      // group 6, and 2 x 4 between the buttons.
      '#' + PANEL_ID + '.tfcc-narrow .tfcc-head { gap: 6px; flex-wrap: nowrap; margin-bottom: 6px; }',
      '#' + PANEL_ID + '.tfcc-narrow .tfcc-head-id { flex: 0 1 auto; flex-wrap: wrap; gap: 6px; min-width: 0; }',
      '#' + PANEL_ID + '.tfcc-narrow .tfcc-head-ctl { flex: none; flex-wrap: nowrap; gap: 0; }',
      '#' + PANEL_ID + '.tfcc-narrow .tfcc-head-btns { gap: 4px; }',
      '#' + PANEL_ID + '.tfcc-narrow .tfcc-logo { height: clamp(16px, calc(var(--tfcc-hb) * 0.545), 24px); }',
      '#' + PANEL_ID + '.tfcc-narrow button.tfcc-hbtn { display: inline-flex; align-items: center;',
      '  justify-content: center; width: var(--tfcc-hb); min-width: var(--tfcc-hb); min-height: var(--tfcc-hb); padding: 0; }',
      '#' + PANEL_ID + '.tfcc-narrow .tfcc-hbtn .tfcc-gl { width: clamp(14px, calc(var(--tfcc-hb) * 0.45), 20px);',
      '  height: auto; }',
      '#' + PANEL_ID + '.tfcc-narrow button.tfcc-hshow { display: inline-flex; align-items: center; gap: 2px;',
      '  min-width: var(--tfcc-hb); min-height: var(--tfcc-hb); font-weight: bold;',
      '  padding: 0 clamp(4px, calc(var(--tfcc-hb) * 0.2), 10px); }',
      '#' + PANEL_ID + '.tfcc-narrow button.tfcc-chip { min-width: 0; min-height: var(--tfcc-hb); padding: 0;',
      '  border: 0; border-radius: 0; background: transparent; }',
      '#' + PANEL_ID + '.tfcc-narrow .tfcc-pill { display: inline-flex; align-items: center; gap: 3px;',
      '  white-space: nowrap; min-height: min(28px, var(--tfcc-hb)); padding: 2px 8px; border-radius: 14px;',
      '  border: 1px solid var(--tm-border-2); background: var(--tm-bg-3); }',
      '#' + PANEL_ID + '.tfcc-narrow .tfcc-chip.tfcc-compact .tfcc-pill { padding: 1px 4px; gap: 1px; }',
      '#' + PANEL_ID + '.tfcc-narrow .tfcc-navgrid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr));',
      '  gap: 6px; margin-bottom: 6px; }',
      '#' + PANEL_ID + '.tfcc-narrow .tfcc-navgrid button { position: relative; overflow: hidden; display: flex;',
      '  align-items: center; justify-content: center; min-width: 44px; min-height: 44px; padding: 2px 4px;',
      '  font-weight: bold; }',
      // My posts sits in its grid cell; the wide auto margin would push it out.
      '#' + PANEL_ID + '.tfcc-narrow .tfcc-navgrid button.tfcc-nav-mine { margin-left: 0; }',
      '#' + PANEL_ID + '.tfcc-narrow .tfcc-navnum { position: absolute; inset: 0; display: flex; align-items: center;',
      '  justify-content: center; font-size: var(--tfcc-navnum-size); line-height: 1;',
      '  font-variant-numeric: tabular-nums; opacity: var(--tfcc-navnum-opacity); }',
      '#' + PANEL_ID + '.tfcc-narrow .tfcc-navlab { position: relative; max-width: 100%; white-space: nowrap;',
      '  overflow: hidden; text-overflow: ellipsis; opacity: var(--tfcc-navlab-opacity); }',
      '#' + PANEL_ID + '.tfcc-narrow .tfcc-navgrid button[aria-pressed="true"] { box-shadow: inset 0 -3px 0 currentColor; }',
      '#' + PANEL_ID + '.tfcc-narrow .tfcc-navgrid button[aria-pressed="true"] .tfcc-navnum {',
      '  opacity: var(--tfcc-navnum-opacity-selected); }',
      '#' + PANEL_ID + '.tfcc-narrow .tfcc-navgrid button[aria-pressed="true"] .tfcc-navlab {',
      '  opacity: var(--tfcc-navlab-opacity-selected); }',
      // #53: the My posts reactions pill. Not a button, so no border and no
      // 44px target: a content-sized rounded fill (the row card's), centred
      // on its line, 6 + 18 + 6 = 30px tall. The parts are flex items, so the
      // spacing is gaps and margins, with wider gaps either side of the dot.
      '#' + PANEL_ID + '.tfcc-narrow .tfcc-rxline { display: flex; justify-content: center; margin: 0 0 4px 0; }',
      '#' + PANEL_ID + '.tfcc-narrow .tfcc-rxpill { display: inline-flex; align-items: center; justify-content: center;',
      '  flex-wrap: wrap; gap: 4px; max-width: 100%; box-sizing: border-box; padding: 6px 14px;',
      '  border: 0; border-radius: 999px; background: var(--tm-bg-2); color: var(--tm-meta);',
      '  font-size: 14px; line-height: 18px; }',
      '#' + PANEL_ID + '.tfcc-narrow .tfcc-rxpill .tfcc-thumb + .tfcc-rx { margin-left: 4px; }',
      '#' + PANEL_ID + '.tfcc-narrow .tfcc-rxpill .tfcc-rxdot { margin: 0 4px; color: var(--tm-muted); }',
      '#' + PANEL_ID + '.tfcc-narrow .tfcc-rxpill .tfcc-rxage { margin-left: 2px; }',
      '#' + PANEL_ID + '.tfcc-narrow .tfcc-filterline { flex-wrap: wrap; gap: 6px; margin-bottom: 6px; }',
      '#' + PANEL_ID + '.tfcc-narrow .tfcc-filterline .tfcc-grow { flex: 1 1 8em; }',
      '#' + PANEL_ID + '.tfcc-narrow .tfcc-filterline button { display: inline-flex; align-items: center;',
      '  justify-content: center; gap: 4px; min-width: 44px; min-height: 44px; padding: 0 8px; white-space: nowrap; }',
      '#' + PANEL_ID + '.tfcc-narrow .tfcc-filtergrid { display: grid;',
      '  grid-template-columns: repeat(auto-fit, minmax(8em, 1fr)); gap: 6px; margin: 0 0 6px 0; }',
      '#' + PANEL_ID + '.tfcc-narrow .tfcc-row { padding: var(--tfcc-gap-xs) var(--tfcc-gap-sm); }',
      '#' + PANEL_ID + '.tfcc-narrow .tfcc-row-t { display: flex; gap: 4px; align-items: flex-start; }',
      '#' + PANEL_ID + '.tfcc-narrow .tfcc-row-t .tfcc-row-title { line-height: 1.35; }',
      // The whole title band opens the thread: at least 24px (WCAG 2.2 AA).
      '#' + PANEL_ID + '.tfcc-narrow .tfcc-row-t .tfcc-row-title a { display: block; padding: 3px 0; min-height: 24px; }',
      '#' + PANEL_ID + '.tfcc-narrow .tfcc-row-t .tfcc-row-title { flex: 1 1 0; min-width: 0; }',
      // #39, switched by the #41 setting (tfcc-clip): one line with an
      // ellipsis until the row's drawer opens. The cut is visual only: the
      // link's text, and so its accessible name, is whole, and the block keeps
      // the full width and 24px height of the tap target.
      '#' + PANEL_ID + '.tfcc-narrow.tfcc-clip .tfcc-row-t .tfcc-row-title a {',
      '  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }',
      '#' + PANEL_ID + '.tfcc-narrow.tfcc-clip .tfcc-row.tfcc-open .tfcc-row-t .tfcc-row-title a { white-space: normal; overflow: visible; }',
      '#' + PANEL_ID + '.tfcc-narrow .tfcc-row-t .tfcc-pinned { padding-top: 3px; }',
      '#' + PANEL_ID + '.tfcc-narrow .tfcc-row-l2 { display: flex; gap: 6px; align-items: flex-start; }',
      '#' + PANEL_ID + '.tfcc-narrow .tfcc-row-l2 .tfcc-meta { flex: 1 1 0; min-width: 0; margin-top: 0;',
      '  padding-top: 2px; gap: var(--tfcc-gap-sm); }',
      // #39: the meta is one line too, status first so a live status is the
      // last thing cut. A block, not a flex row, so the ellipsis can show.
      // Narrow only, and only with the #41 setting on: off, it wraps as a flex
      // row again, as before #39.
      '#' + PANEL_ID + '.tfcc-narrow.tfcc-clip .tfcc-row-l2 .tfcc-meta {',
      '  display: block; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }',
      '#' + PANEL_ID + '.tfcc-narrow.tfcc-clip .tfcc-row-l2 .tfcc-meta > * { margin-right: var(--tfcc-gap-sm); }',
      '#' + PANEL_ID + '.tfcc-narrow.tfcc-clip .tfcc-row.tfcc-open .tfcc-row-l2 .tfcc-meta { white-space: normal; overflow: visible; }',
      // PR #42 review: the parts have no space between them, so inline they
      // join into unbreakable runs that pushed the last part out of the meta
      // column, under the row's buttons, at 280px. Open, each part is atomic:
      // the line breaks between parts, and a part wider than the column
      // wraps inside itself. Closed, they stay inline so the ellipsis cuts.
      '#' + PANEL_ID + '.tfcc-narrow.tfcc-clip .tfcc-row.tfcc-open .tfcc-row-l2 .tfcc-meta > * { display: inline-block;',
      '  max-width: 100%; overflow-wrap: anywhere; }',
      '#' + PANEL_ID + '.tfcc-narrow .tfcc-row-btns { flex: none; display: inline-flex; gap: 6px; }',
      '#' + PANEL_ID + '.tfcc-narrow .tfcc-row-btns button { display: inline-flex; align-items: center;',
      '  justify-content: center; min-width: 44px; min-height: 44px; padding: 0 6px; }',
      '#' + PANEL_ID + '.tfcc-narrow .tfcc-row-btns button[aria-expanded="true"] { background: var(--tm-hover); }',
      '#' + PANEL_ID + '.tfcc-narrow .tfcc-drawer { display: grid;',
      '  grid-template-columns: repeat(auto-fit, minmax(7.5em, 1fr)); gap: 8px; margin-top: 6px;',
      '  padding-top: 8px; border-top: 1px solid var(--tm-border); }',
      '#' + PANEL_ID + '.tfcc-narrow .tfcc-drawer .tfcc-wide { grid-column: 1 / -1; }',
      // #39: the drawer is compact. Its controls are 32px (WCAG 2.5.8's floor
      // is 24px) with 8px between them; navigation outside it keeps 44px.
      // Fields get shorter by padding, never by font: they stay 16px so iOS
      // does not zoom.
      '#' + PANEL_ID + '.tfcc-narrow .tfcc-drawer button { min-height: 32px; min-width: 32px; padding: 0 6px; }',
      '#' + PANEL_ID + '.tfcc-narrow .tfcc-drawer select { min-height: 32px; min-width: 32px; padding: 4px 8px; }',
      '#' + PANEL_ID + '.tfcc-narrow .tfcc-drawer input:not([type="checkbox"]) { min-height: 32px; min-width: 32px;',
      '  padding: 4px 8px; }',
      // #43: the row also holds priority, so it is the drawer's widest line.
      // It never wraps: each target starts at 32px and shrinks toward the
      // 24px floor only when the row would not fit (about 27px with Mark read
      // at 320); the gaps are 8px down to a 236px row and close toward 4px
      // below it (280px), so even there every target keeps 24 x 32.
      '#' + PANEL_ID + '.tfcc-narrow .tfcc-drawer-btns { display: flex; flex-wrap: nowrap; align-items: center;',
      '  gap: clamp(4px, calc(4px + (100% - 216px) * 0.2), 8px); }',
      '#' + PANEL_ID + '.tfcc-narrow .tfcc-drawer-btns button { display: inline-flex; flex: 0 1 32px; align-items: center;',
      '  justify-content: center; min-width: 24px; padding: 0; }',
      // The priority group joins the row as its own items, pushed right.
      '#' + PANEL_ID + '.tfcc-narrow .tfcc-dprio { display: contents; }',
      '#' + PANEL_ID + '.tfcc-narrow .tfcc-dprio > :first-child { margin-left: auto; }',
      '#' + PANEL_ID + '.tfcc-narrow .tfcc-dprio .tfcc-prio { flex: none; }',
      // #43: the priority explanation spans the drawer, under the icon row.
      '#' + PANEL_ID + '.tfcc-narrow .tfcc-drawer > .tfcc-infotext { grid-column: 1 / -1; margin: 0; }',
      // #43: folder, Tag and Note on one row; the select takes what is left.
      '#' + PANEL_ID + '.tfcc-narrow .tfcc-drawer-org { display: flex; flex-wrap: nowrap; align-items: center; gap: 8px; }',
      '#' + PANEL_ID + '.tfcc-narrow .tfcc-drawer-org select { flex: 1 1 0; min-width: 32px; }',
      '#' + PANEL_ID + '.tfcc-narrow .tfcc-drawer-org button { flex: none; padding: 0 10px; }',
      // The tag or note popup: an opaque raised box in the drawer, the field
      // on its own line, Save and Cancel under it on the right.
      '#' + PANEL_ID + '.tfcc-narrow .tfcc-editor { display: flex; flex-wrap: wrap; gap: 8px; padding: 8px;',
      '  border: 1px solid var(--tm-border-2); border-radius: 4px; background: var(--tm-bg-3);',
      '  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.35); }',
      '#' + PANEL_ID + '.tfcc-narrow .tfcc-editor input { flex: 1 1 100%; }',
      '#' + PANEL_ID + '.tfcc-narrow .tfcc-editor .tfcc-edsave { margin-left: auto; }',
      '#' + PANEL_ID + '.tfcc-narrow .tfcc-drawer button.tfcc-on { box-shadow: inset 0 -3px 0 currentColor; }',
      // Monochrome, exactly as the thumbs (#30): white on dark, black on light.
      '#' + PANEL_ID + '.tfcc-narrow .tfcc-emo { display: block; font-size: 16px; line-height: 1;',
      '  filter: grayscale(1) brightness(0) invert(1); }',
      '#' + PANEL_ID + '.tfcc-narrow.tfcc-theme-light .tfcc-emo { filter: grayscale(1) brightness(0); }',
      // #41: the archive icon, in the button's own text color in both themes.
      '#' + PANEL_ID + '.tfcc-narrow .tfcc-archico { display: block; flex: none; }',
      '#' + PANEL_ID + '.tfcc-narrow .tfcc-archico path { fill: currentColor; }',
      '#' + PANEL_ID + '.tfcc-narrow .tfcc-vh { font-size: var(--tfcc-text); margin: 2px 0 6px 0; }',
      // A narrow info button and the control it explains share one line; at
      // 280px the control's label wraps inside it rather than strand the button.
      '#' + PANEL_ID + '.tfcc-narrow .tfcc-infogroup { display: flex; flex: 1 1 auto; flex-wrap: nowrap;',
      '  align-items: center; gap: 6px; min-width: 0; }',
      '#' + PANEL_ID + '.tfcc-narrow .tfcc-infogroup > :first-child { flex: 1 1 auto; white-space: normal;',
      '  justify-content: center; text-align: center; }',
      // #39: the Catch up actions share one line. Each control keeps its own
      // width (so fitCatchUp measures it), the panel's tfcc-cu-short class
      // swaps in the short labels, and tfcc-cu-wrap lets them wrap inside
      // their buttons when even the short labels cannot fit.
      '#' + PANEL_ID + '.tfcc-narrow .tfcc-cubar { flex-wrap: nowrap; align-items: stretch; gap: 6px; }',
      '#' + PANEL_ID + '.tfcc-narrow .tfcc-cubar > button { flex: none; white-space: nowrap; }',
      '#' + PANEL_ID + '.tfcc-narrow .tfcc-cubar .tfcc-infogroup { flex: none; }',
      '#' + PANEL_ID + '.tfcc-narrow .tfcc-cubar .tfcc-infogroup > :first-child { flex: none; white-space: nowrap; }',
      '#' + PANEL_ID + '.tfcc-narrow .tfcc-lshort { display: none; }',
      '#' + PANEL_ID + '.tfcc-narrow.tfcc-cu-short .tfcc-lfull { display: none; }',
      '#' + PANEL_ID + '.tfcc-narrow.tfcc-cu-short .tfcc-lshort { display: inline; }',
      '#' + PANEL_ID + '.tfcc-narrow.tfcc-cu-wrap .tfcc-cubar > button { flex: 1 1 0; min-width: 44px; white-space: normal; }',
      // The group is flattened, so the two label buttons are siblings in one
      // flex row with the same basis and share the width equally; the info
      // button keeps its own 44px (PR #40 review).
      '#' + PANEL_ID + '.tfcc-narrow.tfcc-cu-wrap .tfcc-cubar .tfcc-infogroup { display: contents; }',
      '#' + PANEL_ID + '.tfcc-narrow.tfcc-cu-wrap .tfcc-cubar .tfcc-infogroup > :first-child { flex: 1 1 0;',
      '  min-width: 44px; white-space: normal; }',
      '#' + PANEL_ID + ' .tfcc-error { color: var(--tm-bad-text); font-weight: bold;',
      '  margin-bottom: var(--tfcc-gap); }',
      '#' + PANEL_ID + ' .tfcc-warn { color: var(--tm-warn-text); margin-bottom: var(--tfcc-gap-sm); }',
      '#' + PANEL_ID + ' .tfcc-empty { color: var(--tm-muted); padding: var(--tfcc-gap-lg) 0;',
      '  text-align: center; }',
      '#' + PANEL_ID + ' .tfcc-section { border: 1px solid var(--tm-border); border-radius: 4px;',
      '  padding: var(--tfcc-gap); margin-bottom: var(--tfcc-gap); }',
      '#' + PANEL_ID + ' .tfcc-section h4 { margin: 0 0 var(--tfcc-gap-sm) 0; font-size: var(--tfcc-text); }',
      // #45: a folder group's heading is a toggle that looks like the heading.
      // Its rows sit under it while open; collapsed, only the heading shows.
      '#' + PANEL_ID + ' .tfcc-section h4.tfcc-grphead { margin: 0; }',
      '#' + PANEL_ID + ' .tfcc-grphead + .tfcc-rows { margin-top: var(--tfcc-gap-sm); }',
      '#' + PANEL_ID + ' button.tfcc-grp { display: flex; align-items: center; gap: var(--tfcc-gap-xs); width: 100%;',
      '  min-height: 24px; padding: 0; border: 0; background: transparent; color: var(--tm-text);',
      '  font: inherit; font-weight: bold; text-align: left; cursor: pointer; }',
      '#' + PANEL_ID + ' button.tfcc-grp:hover .tfcc-grpname { text-decoration: underline; }',
      // #45: the folder order arrows in Settings. A disabled one (the first
      // up, the last down) is dimmed; WCAG exempts an inactive control.
      '#' + PANEL_ID + ' button.tfcc-move { display: inline-flex; align-items: center; justify-content: center;',
      '  min-width: 24px; min-height: 24px; padding: 0 2px; }',
      '#' + PANEL_ID + ' button.tfcc-move:disabled { opacity: 0.45; cursor: default; }',
      // #47: a folder's claimed forums, each a chip with its remove button.
      '#' + PANEL_ID + ' .tfcc-claims { display: inline-flex; flex-wrap: wrap; gap: var(--tfcc-gap-xs); }',
      '#' + PANEL_ID + ' .tfcc-claim { display: inline-flex; align-items: center; gap: 2px; padding-left: 8px;',
      '  border: 1px solid var(--tm-border); border-radius: 12px; color: var(--tm-text); }',
      '#' + PANEL_ID + ' button.tfcc-unclaim { display: inline-flex; align-items: center; justify-content: center;',
      '  min-width: 24px; min-height: 24px; padding: 0; border: 0; border-radius: 12px; background: transparent;',
      '  color: inherit; }',
      '#' + PANEL_ID + ' .tfcc-draft { width: 100%; min-height: 90px; resize: vertical; }',
      '#' + PANEL_ID + ' .tfcc-modes { display: flex; gap: 0; margin-bottom: var(--tfcc-gap-sm); }',
      '#' + PANEL_ID + ' .tfcc-modes button { flex: 1 1 0; min-height: 32px; border-radius: 0; }',
      '#' + PANEL_ID + ' .tfcc-modes button[aria-pressed="true"] { background: var(--tm-good-bg); color: var(--tm-text); }',
      '#' + PANEL_ID + ' .tfcc-pvbar { display: flex; align-items: center; gap: var(--tfcc-gap-sm); margin-bottom: var(--tfcc-gap-sm); }',
      '#' + PANEL_ID + ' .tfcc-pv { border: 1px solid var(--tm-border); border-radius: 4px; padding: 8px; overflow-x: auto; }',
      '#' + PANEL_ID + ' .tfcc-pv-light { background: #ffffff; color: #333333; ' + teVars('light') + ' }',
      '#' + PANEL_ID + ' .tfcc-pv-dark { background: #111111; color: #dddddd; ' + teVars('dark') + ' }',
      '#' + PANEL_ID + ' .tfcc-pv-block { cursor: text; }',
      '#' + PANEL_ID + ' .tfcc-pv p { margin: 0; }',
      '#' + PANEL_ID + ' .tfcc-pv img { max-width: 100%; }',
      '#' + PANEL_ID + ' .tfcc-pv table { border-collapse: collapse; }',
      '#' + PANEL_ID + ' .tfcc-pv th, #' + PANEL_ID + ' .tfcc-pv td { border: 1px solid currentColor; padding: 2px 6px; }',
      '#' + PANEL_ID + ' .tfcc-pv blockquote { margin: 0 0 0 8px; padding-left: 8px; border-left: 3px solid currentColor; }',
      '#' + PANEL_ID + ' .tfcc-confirm { margin-bottom: var(--tfcc-gap-sm); }',
      '#' + PANEL_ID + ' .tfcc-tools { display: flex; flex-wrap: wrap; gap: 4px; margin-bottom: var(--tfcc-gap-sm); }',
      '#' + PANEL_ID + ' .tfcc-tools button { min-width: 32px; min-height: 32px; }',
      // E1: Save as free draft stands apart from Delete, in the accent color.
      '#' + PANEL_ID + ' .tfcc-actions button.tfcc-tofree { margin-left: var(--tfcc-gap-lg); color: var(--tm-accent-text); }',
      '#' + PANEL_ID + ' .tfcc-picker { border: 1px solid var(--tm-border); border-radius: 4px; padding: 8px; margin-bottom: var(--tfcc-gap-sm); }',
      '#' + PANEL_ID + ' .tfcc-swatches, #' + PANEL_ID + ' .tfcc-emoji { display: flex; flex-wrap: wrap; gap: 4px; }',
      '#' + PANEL_ID + ' .tfcc-swatch { display: block; width: 20px; height: 20px; border-radius: 3px; border: 1px solid var(--tm-border); }',
      '#' + PANEL_ID + ' .tfcc-actions button.tfcc-fixopen { margin-left: auto; }',
      '#' + PANEL_ID + ' .tfcc-img-check { display: block; max-width: 100%; max-height: 160px; margin: 4px 0; }',
      '#' + PANEL_ID + ' .tfcc-key { border-collapse: collapse; width: 100%; }',
      '#' + PANEL_ID + ' .tfcc-key th, #' + PANEL_ID + ' .tfcc-key td { border: 1px solid var(--tm-border); padding: 2px 6px; text-align: left; vertical-align: top; overflow-wrap: anywhere; }',
      '#' + PANEL_ID + '.tfcc-narrow .tfcc-modes button { min-width: 44px; min-height: 44px; }',
      // Symbol buttons: up to 40 wide, 44 tall, 4px gaps, right-aligned. The
      // primary row (Undo B I U Color Link More) never wraps: its buttons
      // shrink to a 32px floor, so 7 x 32 + 6 x 4 = 248 fits the 284px row a
      // 320px screen leaves. The More drawer may still wrap.
      '#' + PANEL_ID + '.tfcc-narrow .tfcc-tools button { flex: 0 1 40px; min-width: 32px; width: 40px; min-height: 44px; padding: 0; }',
      '#' + PANEL_ID + '.tfcc-narrow .tfcc-tools { gap: 4px; justify-content: flex-end; }',
      '#' + PANEL_ID + '.tfcc-narrow .tfcc-tools:not(.tfcc-tools-more) { flex-wrap: nowrap; }',
      '#' + PANEL_ID + '.tfcc-narrow .tfcc-draft, #' + PANEL_ID + '.tfcc-narrow .tfcc-picker input { font-size: 16px; }',
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
      // Narrow screens are the primary target: this runs inside Torn PDA. The
      // fallback mount is fixed to the viewport, so its offsets stay a viewport
      // query; everything inside the panel follows the panel's own width
      // through .tfcc-narrow (#33).
      '@media (max-width: 600px) {',
      '  #' + FALLBACK_ID + ' { right: 4px; bottom: 4px; width: calc(100vw - 8px); }',
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

  function badgeModel(now) {
    if (!state.settings.badges) return { enabled: false };
    var facts = badgeFacts({
      organizer: state.organizer, feed: state.feed,
      hasKey: isKeyShaped(loadApiKey()), keyRejected: state.settings.keyRejected,
    });
    var ev = evaluateBadges(state.badges, facts);
    var earned = BADGES.filter(function (b) {
      return Object.prototype.hasOwnProperty.call(state.badges.earned, b.id);
    }).sort(function (a, b) {
      var t = BADGE_TIER_RANK[b.tier] - BADGE_TIER_RANK[a.tier];
      return t !== 0 ? t : state.badges.earned[b.id] - state.badges.earned[a.id];
    });
    var next = nextBadge(ev.progress);
    return {
      enabled: true,
      earnedCount: earned.length,
      total: BADGES.length,
      bestTier: earned.length ? earned[0].tier : '',
      streak: streakView(state.badges.streak, tctDay(now)),
      earnedList: earned,
      next: next ? { badge: badgeById(next.id), value: next.value, target: next.target } : null,
      progress: ev.progress,
      shelfOpen: state.badgeShelfOpen,
      catalogueOpen: state.badgeCatalogueOpen,
      toast: state.badgeToast ? { text: state.badgeToast.text, announce: !state.badgeToast.announced } : null,
    };
  }

  function loadingModel(now) {
    return {
      loading: true,
      view: 'threads',
      version: SCRIPT_VERSION,
      theme: 'dark',
      collapsed: false,
      takeover: false,
      narrow: state.narrow === true,
      notices: [],
      rows: [],
      now: now,
      badges: badgeModel(now),
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
      narrow: state.narrow === true,
      notices: [],
      rows: [],
      now: now,
      badges: badgeModel(now),
    };
  }

  var noopHandlers = Object.freeze({});

  // Search lists at most this many thread rows.
  var SEARCH_ROWS_MAX = 50;

  // Catch up groups its shown rows by folder, in the user's folder order with
  // Unfiled where they put it (#45; before #45, by name). One helper, so the
  // focus order (renderedRowIds) is always the order the view renders. org is
  // the organizer, or any object with its folders, unfiledAt and
  // collapsedFolders. A collapsed group keeps its rows here; the view renders
  // only its heading.
  function groupCatchUp(rows, org) {
    var names = {};
    org.folders.forEach(function (f) { names[f.id] = f.name; });
    var byKey = {};
    for (var i = 0; i < rows.length; i += 1) {
      var fid = rows[i].folderId;
      var k = fid && Object.prototype.hasOwnProperty.call(names, fid) ? folderKey(fid) : UNFILED_KEY;
      (byKey[k] = byKey[k] || []).push(rows[i]);
    }
    return folderOrderKeys(org).filter(function (k) { return Object.prototype.hasOwnProperty.call(byKey, k); })
      .map(function (k) {
        return { key: k, name: k === UNFILED_KEY ? 'Unfiled' : names[folderIdOfKey(k)], rows: byKey[k],
          collapsed: isFolderCollapsed(org, k) };
      });
  }

  // The thread rows the current view renders, as string ids in DOM order.
  function renderedRowIds(view, capped, unchecked, rows, org) {
    var list = [];
    if (view === 'threads') list = capped.threads.rows;
    else if (view === 'mine') list = capped.mine.rows;
    else if (view === 'catchup') {
      // #45: a collapsed group renders no rows, so an open drawer in it closes.
      groupCatchUp(capped.catchup.rows, org).forEach(function (g) { if (!g.collapsed) list = list.concat(g.rows); });
      list = list.concat(unchecked || []);
    } else if (view === 'search') list = rows.slice(0, SEARCH_ROWS_MAX);
    return list.map(function (r) { return String(r.id); });
  }

  function buildPanelModel(now) {
    var s = state.settings;
    var edKey = editorKeyFor({ draftFocusId: state.draftFocusId, route: state.route });
    if (edKey !== state.editor.key) {
      // Spec 4a: switching drafts or threads never discards typed text.
      if (state.editor.dirty && state.editor.key) saveEditor(now);
      loadEditor(edKey, now);
    } else if (edKey && !state.editor.dirty && draftSig(draftFor(state.drafts, edKey)) !== state.editor.src) {
      // The stored draft changed behind a clean editor (autosave from Torn's
      // editor, an import, a setting read after boot): show what is stored,
      // keeping the pane the player is looking at.
      var keep = state.editor;
      loadEditor(edKey, now);
      state.editor.mode = keep.mode;
      state.editor.previewTheme = keep.previewTheme;
      state.editor.showImages = keep.showImages;
      // An open picker and what was typed into it are the player's, not the
      // stored draft's: a reload never wipes them mid-edit.
      ['picker', 'fields', 'imageCheck', 'fixOpen', 'fixCheck', 'pickerWarn', 'emojiTab', 'moreOpen', 'height', 'undo'].forEach(function (k) { state.editor[k] = keep[k]; });
      // With steps to undo, the reload is a step of its own: one Undo goes
      // back to what the editor showed before it, never past the newer stored
      // text. With none, Undo stays off, as on a freshly opened draft.
      if (keep.undo && keep.undo.length && (keep.text !== state.editor.text || keep.lang !== state.editor.lang)) {
        pushUndo(state.editor, keep);
      }
    }
    var rows = state.rows;
    var query = parseQuery(state.searchQuery);

    // Threads, Catch up, the header badge and Search see only the Threads
    // population. A My posts-only thread lives in its own view.
    var threadRows = rows.filter(function (r) { return r.inThreads; });
    // My posts ignores author-only mode (issue #4).
    var mineRows = rows.map(anyPosterRow);
    var mineAll = viewRows(mineRows, 'mine', {}, parseQuery(''));
    var visible = s.view === 'mine' ? viewRows(mineRows, 'mine', s, query) : viewRows(rows, 'threads', s, query);

    var totalUnread = 0;
    var totalUnchecked = 0;
    for (var i = 0; i < threadRows.length; i += 1) {
      totalUnread += threadRows[i].unread;
      if (threadRows[i].authorState === 'unchecked') totalUnchecked += 1;
    }

    // Each capped view caps its own sorted population, so the cap is the last
    // step after every filter and the sort: the top N of what was asked for.
    var sorted = sortThreads(visible, s.sort);
    var threadsSorted = s.view === 'mine' ? sortThreads(viewRows(rows, 'threads', s, query), s.sort) : sorted;
    var mineSorted = s.view === 'mine' ? sorted : sortThreads(viewRows(mineRows, 'mine', s, query), s.sort);
    var catchUp = catchUpRowsNow();
    var unchecked = catchUpUncheckedNow();
    var showAll = state.showAll || {};
    var limit = rowLimitFor(s.rowsShown, s.takeover);
    var capped = {
      threads: capRows(threadsSorted, limit, showAll.threads === true),
      catchup: capRows(catchUp, limit, showAll.catchup === true),
      mine: capRows(mineSorted, limit, showAll.mine === true),
    };
    // #33, spec section 6: after every model build, an open row or info that
    // this view does not render closes, and stays closed.
    var renderedIds = renderedRowIds(s.view, capped, unchecked, sorted, state.organizer);
    setTransient(reconcileTransient(currentTransient(), renderedIds, INFO_KEYS_BY_VIEW[s.view] || []));
    state.openEditor = reconcileEditor(state.openEditor, state.openRowId);

    return {
      loading: false,
      version: SCRIPT_VERSION,
      view: s.view,
      theme: s.theme,
      collapsed: s.collapsed,
      takeover: s.takeover,
      narrow: state.narrow === true,
      // #41: clip row titles and summaries to one line (the tfcc-clip class).
      clipLines: s.clipLines !== false,
      renderedIds: renderedIds,
      openRowId: state.openRowId,
      filtersOpen: state.filtersOpen,
      openInfoId: state.openInfoId,
      drawerEdit: state.drawerEdit,
      openEditor: state.openEditor,
      activeFilters: activeFilterCount(s),
      live: state.liveMessage && !state.liveMessage.announced ? state.liveMessage.text : null,
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
      // #45: the rest of the folder order, for Settings and Catch up.
      unfiledAt: unfiledIndex(state.organizer),
      collapsedFolders: state.organizer.collapsedFolders.slice(),
      tags: allTags(state.organizer),
      categories: state.feed.categories.slice(),
      // Whole on purpose: Search lists these and deep search fetches them.
      rows: sorted,
      allRows: threadRows,
      totals: {
        threads: threadRows.length,
        subscribed: threadRows.filter(function (r) { return r.subscribed; }).length,
        unread: totalUnread,
        unchecked: totalUnchecked,
        drafts: draftList(state.drafts).length,
      },
      // Whole on purpose: the Catch up nav count reads its length.
      catchUp: catchUp,
      badges: badgeModel(now),
      // What the capped views render. model.rows, model.catchUp and model.mine
      // stay whole, so Search and the nav counts are uncapped by construction.
      capped: capped,
      catchUpUnchecked: unchecked,
      authorOnly: s.authorOnly === true,
      mine: {
        total: mineAll.length,
        unread: mineAll.filter(function (r) { return r.unread > 0; }).length,
        unchecked: mineAll.filter(function (r) { return r.unreadSource === 'unchecked'; }).length,
        fetchedAt: state.mine.fetchedAt,
        refreshing: state.refreshingMine,
        error: state.mineError,
        throttled: state.mineThrottled === true,
      },
      lastCatchUpAt: state.organizer.lastCatchUpAt,
      drafts: draftList(state.drafts),
      reactions: reactionTotals(state.mine, now, REACTIONS_STALE_MS),
      searchQuery: state.searchQuery,
      searchResults: state.searchResults,
      deepBusy: state.deepBusy,
      deepProgress: state.deepProgress,
      cacheSize: postCacheSize(state.postCache),
      route: state.route,
      draftFocusId: state.draftFocusId,
      replyBoxFound: state.replyBoxFound,
      editor: Object.assign({}, state.editor),
      themeResolved: state.themeResolved || null,
      settings: {
        autoRefreshMs: s.autoRefreshMs,
        enrichBudget: s.enrichBudget,
        autosaveDrafts: s.autosaveDrafts,
        draftLang: s.draftLang,
        editorHeightWide: s.editorHeightWide,
        editorHeightNarrow: s.editorHeightNarrow,
        hideTornBox: s.hideTornBox,
        authorOnly: s.authorOnly,
        autoHideOnOpen: s.autoHideOnOpen,
        clipLines: s.clipLines !== false,
        seeThrough: s.seeThrough !== false,
        deepSearchPages: s.deepSearchPages,
        rowsShown: s.rowsShown,
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

  // Inline ASCII SVG icons (#33). Stroked in currentColor, so they follow the
  // theme; aria-hidden, because every button that holds one has an aria-label
  // or visible text.
  var GLYPHS = Object.freeze({
    refresh: 'M20 12a8 8 0 1 1-2.34-5.66M20 4v5h-5',
    expand: 'M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5',
    shrink: 'M9 4v5H4M20 9h-5V4M15 20v-5h5M4 15h5v5',
    up: 'M6 15l6-6 6 6',
    down: 'M6 9l6 6 6-6',
    // #45: a collapsed folder group's chevron (an open one uses down).
    right: 'M9 6l6 6-6 6',
    funnel: 'M4 5h16l-6 7v6l-4 2v-8z',
    more: 'M5.5 12h1M11.5 12h1M17.5 12h1',
    check: 'M5 12.5l4.5 4.5L19 7.5',
    info: 'M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18zM12 11v6M12 7.5v.5',
    close: 'M6 6l12 12M18 6L6 18',
    // #47: a bin, for a narrow folder row's Delete.
    trash: 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6',
  });

  function glyph(name) {
    return '<svg class="tfcc-gl" viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false">'
      + '<path d="' + GLYPHS[name] + '"/></svg>';
  }

  // An info button and the explanation it discloses (spec 13d). The text is
  // always in the markup, so aria-controls names a real element and the tests
  // that pin the wording keep reading it; only `hidden` follows the state.
  function renderInfoButton(key, openKey) {
    var open = openKey === key;
    return '<button type="button" class="tfcc-info" data-act="info" data-info="' + escapeHtml(key)
      + '" aria-expanded="' + (open ? 'true' : 'false') + '" aria-controls="tfcc-info-' + escapeHtml(key)
      + '" aria-label="' + escapeHtml(INFO_KEYS[key]) + '" title="' + escapeHtml(INFO_KEYS[key]) + '">'
      + glyph('info') + '</button>';
  }

  // html is this script's own text, already escaped where it carries data.
  function renderInfoText(key, openKey, html) {
    return '<p class="tfcc-note tfcc-infotext" id="tfcc-info-' + escapeHtml(key) + '"'
      + (openKey === key ? '' : ' hidden') + '>' + html + '</p>';
  }

  function btn(action, label, extra) {
    return '<button type="button" data-act="' + escapeHtml(action) + '"'
      + (extra || '') + '>' + escapeHtml(label) + '</button>';
  }

  function renderNav(model) {
    if (model.narrow) return renderNavNarrow(model);
    var out = ['<div class="tfcc-nav">'];
    for (var i = 0; i < VIEWS.length; i += 1) {
      var v = VIEWS[i];
      var count = '';
      if (v === 'catchup' && model.catchUp.length) count = ' (' + model.catchUp.length + ')';
      if (v === 'drafts' && model.totals.drafts) count = ' (' + model.totals.drafts + ')';
      if (v === 'mine' && model.mine && model.mine.unread) count = ' (' + model.mine.unread + ')';
      // My posts is last in VIEWS and right-aligned by its class (see the
      // .tfcc-nav-mine rules). The reactions pill (#30) goes right before it.
      if (v === 'mine') out.push(renderReactions(model));
      out.push('<button type="button" data-act="view" data-view="' + v + '"'
        + (v === 'mine' ? ' class="tfcc-nav-mine"' : '') + ' aria-pressed="'
        + (model.view === v ? 'true' : 'false') + '">' + escapeHtml(VIEW_LABELS[v] + count) + '</button>');
    }
    out.push('</div>');
    return out.join('');
  }

  function navNumeral(n) {
    var v = toInt(n, 0);
    return v > 999 ? '999+' : String(v);
  }

  // The narrow nav (spec 4.2, 13f): a 3 x 2 grid in VIEWS order. A count is a
  // large decorative numeral behind a one-line label; the number reaches
  // screen readers through the cell's own name. Zero draws no numeral.
  function renderNavNarrow(model) {
    var t = model.totals || { unread: 0, subscribed: 0, drafts: 0 };
    var counts = {
      threads: t.unread, catchup: model.catchUp ? model.catchUp.length : 0,
      drafts: t.drafts, mine: model.mine ? model.mine.unread : 0,
    };
    var names = {
      threads: 'Threads, ' + (t.unread ? formatCount(t.unread) + (model.authorOnly ? ' new by author' : ' new') : 'none new')
        + ', ' + t.subscribed + ' subscribed',
      catchup: 'Catch up, ' + (counts.catchup || 'none'),
      drafts: 'Drafts, ' + (counts.drafts || 'none'),
      mine: 'My posts, ' + (counts.mine ? counts.mine + ' new' : 'none new'),
    };
    var out = ['<div class="tfcc-nav tfcc-navgrid">'];
    for (var i = 0; i < VIEWS.length; i += 1) {
      var v = VIEWS[i];
      var n = toInt(counts[v], 0);
      out.push('<button type="button" data-act="view" data-view="' + v + '"'
        + (v === 'mine' ? ' class="tfcc-nav-mine"' : '')
        + ' aria-pressed="' + (model.view === v ? 'true' : 'false') + '"'
        + (names[v] ? ' aria-label="' + escapeHtml(names[v]) + '"' : '') + '>'
        + (n > 0 ? '<span class="tfcc-navnum" aria-hidden="true">' + navNumeral(n) + '</span>' : '')
        + '<span class="tfcc-navlab">' + escapeHtml(VIEW_LABELS[v]) + '</span></button>');
    }
    out.push('</div>');
    return out.join('');
  }

  // The thread's priority adjustment and its +/- controls (#30). The same
  // prio-up and prio-down actions as before, so storage and sort are unchanged.
  function renderPriority(row) {
    var p = toInt(row.priority, 0);
    var shown = (p > 0 ? '+' : '') + p;
    var idAttr = ' data-id="' + escapeHtml(row.id) + '"';
    return '<span class="tfcc-prio" title="' + escapeHtml('Priority adjustment: ' + shown
      + '. The Priority sort puts higher first.') + '">' + escapeHtml(shown) + '</span>'
      + btn('prio-up', '+', idAttr + ' class="tfcc-prio-btn" aria-label="Raise priority"'
        + ' title="Raise this thread\'s priority by 1"')
      + btn('prio-down', '-', idAttr + ' class="tfcc-prio-btn" aria-label="Lower priority"'
        + ' title="Lower this thread\'s priority by 1"');
  }

  // The unread count and the per-row status notes. Shared by the wide row
  // (on the title line) and the narrow row (first in the meta).
  function rowStatusHtml(row) {
    var out = [];
    // Author-only mode (issue #4) never shows Torn's any-poster count, and an
    // unknown is named, never left blank.
    var amode = row.authorState || 'off';
    if (amode === 'author' || amode === 'author-atleast') {
      out.push('<span class="tfcc-unread">' + formatCount(row.authorNew) + (amode === 'author-atleast' ? '+' : '')
        + ' new by author</span>');
    } else if (amode === 'unchecked') {
      out.push('<span class="tfcc-note tfcc-unchecked" title="'
        + escapeHtml(AUTHOR_REASON_TEXT[row.authorReason] || AUTHOR_REASON_TEXT.never)
        + '">author: not checked' + (row.authorReason === 'too-many' ? ' (too many new)' : '') + '</span>');
    } else if (amode === 'off' && row.unread > 0) {
      if (row.unreadSource === 'local') {
        // A count this script made, never passed off as Torn's.
        out.push('<span class="tfcc-unread" title="Counted on this device since you last marked it read or posted. '
          + 'Torn does not report unread counts for threads you do not follow.">'
          + formatCount(row.unread) + ' new</span><span class="tfcc-note">local count</span>');
      } else {
        out.push('<span class="tfcc-unread">' + formatCount(row.unread) + ' new</span>');
      }
    }
    // A total nobody looked up must never look like a checked zero.
    if (row.unreadSource === 'unchecked') out.push('<span class="tfcc-note">not checked yet</span>');
    if (!row.subscribed) out.push('<span class="tfcc-note">not subscribed</span>');
    if (row.isLocked) out.push('<span class="tfcc-note">locked</span>');
    return out.join('');
  }

  // The meta spans. Shared by the wide and the narrow row.
  function rowMetaHtml(row, model) {
    var out = [];
    // "started" is red (#30), so a thread you began stands out at a glance.
    if (row.mineRole === 'started') out.push('<span class="tfcc-tag tfcc-started">started</span>');
    else if (row.mineRole) out.push('<span class="tfcc-tag">posted in</span>');
    if (row.mineRole === 'started') {
      if (row.up !== null && row.down !== null) {
        out.push('<span class="tfcc-note">' + formatCount(row.up) + ' up, ' + formatCount(row.down) + ' down</span>');
      } else if (row.rating !== null) {
        out.push('<span class="tfcc-note" title="Torn\'s net rating. Thumbs up and down appear once the '
          + 'opening post is checked.">net ' + formatSigned(row.rating) + '</span>');
      }
    }
    out.push('<span title="Where the time came from: ' + escapeHtml(row.activitySource) + '">'
      + escapeHtml(formatRelativeTime(row.lastActivity, model.now)) + '</span>');
    out.push('<span>' + escapeHtml(row.forumName) + '</span>');
    if (row.authorName) out.push('<span>by ' + escapeHtml(row.authorName) + '</span>');
    if (row.folderName) out.push('<span>' + escapeHtml(row.folderName) + '</span>');
    if (row.hasDraft) out.push('<span class="tfcc-tag">draft</span>');
    for (var i = 0; i < row.tags.length; i += 1) {
      out.push('<span class="tfcc-tag">' + escapeHtml(row.tags[i]) + '</span>');
    }
    return out.join('');
  }

  function folderSelectHtml(row, model, extra) {
    var out = ['<select data-act="folder" data-id="' + escapeHtml(row.id) + '"' + extra + '>'];
    out.push('<option value="">Unfiled</option>');
    for (var f = 0; f < model.folders.length; f += 1) {
      var fo = model.folders[f];
      out.push('<option value="' + escapeHtml(fo.id) + '"'
        + (row.folderId === fo.id ? ' selected' : '') + '>' + escapeHtml(fo.name) + '</option>');
    }
    out.push('</select>');
    return out.join('');
  }

  function renderRow(row, model) {
    var out = ['<div class="tfcc-row" data-id="' + escapeHtml(row.id) + '">'];
    out.push('<div class="tfcc-row-main">');
    if (row.pinned) out.push('<span class="tfcc-pinned" title="Pinned">*</span>');
    // #41: with clipping on, the full title is a hover tooltip, since a wide
    // row has no drawer to open. On the span, not the link, so the link's
    // name stays its text, the full title.
    var clip = model.clipLines === true;
    out.push('<span class="tfcc-row-title"' + (clip ? ' title="' + escapeHtml(row.title) + '"' : '')
      + '><a href="' + escapeHtml(threadUrl(row)) + '"'
      + threadLinkAttr(row.id) + '>'
      + escapeHtml(row.title) + '</a></span>');
    // Priority sits beside the title (#30), not in the action row, where two
    // more buttons wrapped Archive onto a second line once Pin read Unpin.
    // Siblings of the title span, never inside the marked anchor, so a tap on
    // them is not a thread click and #8's auto-hide ignores it.
    out.push(renderPriority(row));
    out.push(rowStatusHtml(row));
    out.push('</div>');

    out.push('<div class="tfcc-meta">' + rowMetaHtml(row, model) + '</div>');

    if (row.note) {
      out.push('<div class="tfcc-note"' + (clip ? ' title="' + escapeHtml(row.note) + '"' : '') + '>'
        + escapeHtml(row.note) + '</div>');
    }

    // #33: an uncommitted edit is shown wherever its field renders.
    var edit = model.drawerEdit && model.drawerEdit.id === String(row.id) ? model.drawerEdit : null;
    out.push('<div class="tfcc-actions">');
    out.push(btn('pin', row.pinned ? 'Unpin' : 'Pin', ' data-id="' + escapeHtml(row.id) + '"'));
    out.push(btn('read', 'Mark read', ' data-id="' + escapeHtml(row.id) + '"'));
    out.push(folderSelectHtml(row, model, ''));
    out.push('<input type="text" data-act="tag-input" data-id="' + escapeHtml(row.id)
      + '"' + (edit && edit.field === 'tag-input' ? ' value="' + escapeHtml(edit.value) + '"' : '') + ' placeholder="add tag" size="8">');
    // A note is edited in place rather than behind a button, because a button
    // needs somewhere to put the editor and every such place is another piece
    // of view state to get wrong.
    out.push('<input type="text" data-act="note-input" data-id="' + escapeHtml(row.id)
      + '" value="' + escapeHtml(edit && edit.field === 'note-input' ? edit.value : row.note) + '" placeholder="note" size="14">');
    out.push(btn('draft', row.hasDraft ? 'Edit draft' : 'Draft', ' data-id="' + escapeHtml(row.id) + '"'));
    out.push(btn('archive', row.archived ? 'Unarchive' : 'Archive', ' data-id="' + escapeHtml(row.id) + '"'));
    out.push('</div>');
    out.push('</div>');
    return out.join('');
  }

  // The one row renderer the views call (#33).
  function rowHtml(row, model) {
    return model.narrow ? renderRowNarrow(row, model) : renderRow(row, model);
  }

  // Mark read as a check mark (spec 13e): named "Mark read", and described by
  // the row's title so a screen reader hears which thread.
  function readButton(row) {
    var id = escapeHtml(row.id);
    return '<button type="button" class="tfcc-read" data-act="read" data-id="' + id + '" aria-label="Mark read" title="Mark read"'
      + ' aria-describedby="tfcc-title-' + id + '">' + glyph('check') + '</button>';
  }

  // The drawer's emoji (#39, the owner's choice), as escapes so the source
  // stays ASCII. Drawn monochrome by the .tfcc-emo filter rules, like the
  // thumbs.
  var DRAWER_EMOJI = Object.freeze({
    pin: '\uD83D\uDCCC',
    draft: '\u270F\uFE0F',
  });

  function emojiIcon(emoji) {
    return '<span class="tfcc-emo" aria-hidden="true">' + emoji + '</span>';
  }

  // #41: Archive draws the "archive files" icon from UXWing, so the button
  // reads as archive, not delete (it replaced the wastebasket emoji). Archive
  // is reversible: the name and hint say Archive (or Unarchive), never Delete.
  // Source: uxwing.com/archive-files-icon/ (path data unchanged;
  // xmlns, rendering hints and clip-rule dropped). Licence, from
  // uxwing.com/license/ (read 2026-10-09): "All files on this site can
  // be used in personal, commercial, and client projects." "Attribution and
  // credit are NOT required; however, any credit will be much appreciated."
  // The icon page itself: "All icons on this site can be used for personal,
  // commercial, and client projects without attribution." Credit is given
  // anyway, here and in the README. No id and no xmlns (see LOGO_SVG); the
  // fill is currentColor, so it follows the theme with no filter, and the
  // .tfcc-archico rules repeat it so a host "svg * { fill }" cannot win.
  var ARCHIVE_SVG = '<svg class="tfcc-archico" viewBox="0 0 512 441.48" width="18" height="18" aria-hidden="true"'
    + ' focusable="false"><path fill="currentColor" fill-rule="evenodd" d="'
    + 'm439.55 3.74 67.81 78.75c2.5 1.95 4.11 5 4.11 8.42 0 1.02-.14 2-.41 2.94l.94 336.97c0 5.86-4.76 '
    + '10.62-10.62 10.62v.04H10.66C4.77 441.48 0 436.7 0 430.82V90.91c0-3 1.24-5.71 3.23-7.65L72.6 '
    + '3.66c2.1-2.39 5.04-3.62 8-3.62V0h350.84c3.25 0 6.16 1.45 8.11 3.74zM34.05 80.25h443.24l-50.73-58.93H85.4'
    + 'L34.05 80.25zm316.63 169.79c6.9.3 11.81 2.57 14.64 6.88 7.68 11.51-1.96 23.76-10.09 30.9l-90.69 '
    + '79.63c-7.72 8.53-18.71 8.53-26.42 0-10.53-12.29-63.8-59.72-83.42-81.81-6.8-7.65-15.21-18.1-8.13-28.72 '
    + '2.84-4.31 7.74-6.58 14.65-6.88h44.43v-76.57c0-4.81 3.93-8.74 8.74-8.74h83.23c4.81 0 8.75 3.94 8.75 '
    + '8.74v76.57h44.31z"/></svg>';

  // #43: what priority does, from the code: setPriority clamps it to
  // PRIORITY_MIN..PRIORITY_MAX, sortThreads uses it only for the My priority
  // sort (higher first, after pinned threads), and it is kept in the
  // organizer in this script's storage.
  var PRIORITY_INFO_TEXT = 'Your own ranking for this thread, from -2 to +2, saved only on this device. '
    + 'The My priority sort lists higher numbers first, after pinned threads.';

  // A compact drawer button (#39): the icon is decoration (aria-hidden); the
  // name and the hint are the words. tfcc-on marks a set state (pinned, a
  // draft saved, archived), so the state never rests on the name alone.
  function emojiButton(action, label, icon, on, rowId) {
    return '<button type="button" class="tfcc-emobtn' + (on ? ' tfcc-on' : '') + '" data-act="' + escapeHtml(action)
      + '" data-id="' + escapeHtml(rowId) + '" aria-label="' + escapeHtml(label) + '" title="' + escapeHtml(label) + '">'
      + icon + '</button>';
  }

  // The drawer's controls (spec 4.4): the same data-act values as the wide
  // action row, each at least 44px. Mark read is left out in Catch up, where
  // the row already shows it.
  function renderDrawer(row, model, inCatchUp) {
    var id = ' data-id="' + escapeHtml(row.id) + '"';
    var edit = model.drawerEdit && model.drawerEdit.id === String(row.id) ? model.drawerEdit : null;
    var out = [];
    // #39: Pin, Draft and Archive are compact emoji buttons on one row, with
    // Mark read beside them outside Catch up.
    out.push('<div class="tfcc-drawer-btns tfcc-wide">');
    out.push(emojiButton('pin', row.pinned ? 'Unpin' : 'Pin', emojiIcon(DRAWER_EMOJI.pin), row.pinned, row.id));
    if (!inCatchUp) out.push(readButton(row));
    out.push(emojiButton('draft', row.hasDraft ? 'Edit draft' : 'Draft', emojiIcon(DRAWER_EMOJI.draft), row.hasDraft, row.id));
    out.push(emojiButton('archive', row.archived ? 'Unarchive' : 'Archive', ARCHIVE_SVG, row.archived, row.id));
    // #43: priority in the desktop style (the number, then + and -), right-
    // aligned on the same row: the wide row's own renderPriority markup.
    // #43: an info button first, so the number is explained where it shows.
    out.push('<span class="tfcc-dprio">' + renderInfoButton('priority', model.openInfoId) + renderPriority(row) + '</span>');
    out.push('</div>');
    // Under the icon row, so opening it never makes that row wider.
    out.push(renderInfoText('priority', model.openInfoId, PRIORITY_INFO_TEXT));
    // #43: folder, Tag and Note share one row. Tag and Note open a small
    // popup in the drawer instead of holding inline fields.
    var ed = model.openEditor && model.openEditor.id === String(row.id) ? model.openEditor.field : null;
    var edId = 'tfcc-ed-' + escapeHtml(row.id);
    var opener = function (field, label, name, on) {
      return '<button type="button" class="tfcc-edbtn' + (on ? ' tfcc-on' : '') + '" data-act="editor"' + id
        + ' data-field="' + field + '" aria-haspopup="dialog" aria-expanded="' + (ed === field ? 'true' : 'false')
        + '" aria-controls="' + edId + '" aria-label="' + escapeHtml(name) + '" title="' + escapeHtml(name) + '">'
        + label + '</button>';
    };
    out.push('<div class="tfcc-drawer-org tfcc-wide">');
    out.push(folderSelectHtml(row, model, ' aria-label="Folder"'));
    out.push(opener('tag', 'Tag', 'Add tag', false));
    // A saved note shows as the set-state bar and the name "Edit note"; the
    // note itself is the row's own line, shown whole while the drawer is open.
    out.push(opener('note', 'Note', row.note ? 'Edit note' : 'Add note', !!row.note));
    out.push('</div>');
    out.push(renderEditor(row, ed, edit, edId));
    return out.join('');
  }

  // #43: the tag or note popup, inside the drawer under the folder row. It is
  // always in the open drawer's markup, so aria-controls names a real
  // element; hidden while closed. Its field mirrors into drawerEdit like the
  // inline fields did, so typed text survives a redraw. Enter saves (the
  // keydown listener), Escape cancels, and so do the two buttons.
  function renderEditor(row, field, edit, edId) {
    var id = ' data-id="' + escapeHtml(row.id) + '"';
    if (!field) return '<div class="tfcc-editor tfcc-wide" id="' + edId + '" hidden></div>';
    var mirror = field + '-input';
    var value = edit && edit.field === mirror ? edit.value : (field === 'note' ? row.note : '');
    var name = field === 'note' ? 'Note' : 'New tag';
    return '<div class="tfcc-editor tfcc-wide" id="' + edId + '" role="dialog" aria-label="'
      + (field === 'note' ? 'Edit the note' : 'Add a tag') + '">'
      + '<input type="text" data-act="editor-input"' + id + ' data-field="' + mirror + '" value="' + escapeHtml(value)
      + '" placeholder="' + (field === 'note' ? 'note' : 'tag') + '" aria-label="' + name + '">'
      + '<button type="button" class="tfcc-edsave" data-act="editor-save"' + id + ' data-field="' + field + '">Save</button>'
      + '<button type="button" data-act="editor-cancel"' + id + ' data-field="' + field + '">Cancel</button>'
      + '</div>';
  }

  // The narrow row (spec 4.4): the title as a full-width block link, then the
  // meta with the buttons on the right, then the note and the drawer. Read and
  // Actions are siblings of the title span, never inside the marked anchor, so
  // #8's auto-hide never sees them.
  function renderRowNarrow(row, model) {
    var id = escapeHtml(row.id);
    var open = model.openRowId === String(row.id);
    var inCatchUp = model.view === 'catchup';
    var p = toInt(row.priority, 0);
    // #39: tfcc-open lets the open row show its title, meta and note whole;
    // every other row holds each to one line.
    var out = ['<div class="tfcc-row' + (open ? ' tfcc-open' : '') + '" data-id="' + id + '">'];
    out.push('<div class="tfcc-row-t">');
    if (row.pinned) out.push('<span class="tfcc-pinned" title="Pinned">*</span>');
    out.push('<span class="tfcc-row-title"><a id="tfcc-title-' + id + '" href="' + escapeHtml(threadUrl(row)) + '"'
      + threadLinkAttr(row.id) + '>' + escapeHtml(row.title) + '</a></span></div>');
    out.push('<div class="tfcc-row-l2"><div class="tfcc-meta">' + rowStatusHtml(row)
      + (p !== 0 ? '<span class="tfcc-prio">' + escapeHtml((p > 0 ? '+' : '') + p) + '</span>' : '')
      + rowMetaHtml(row, model) + '</div><span class="tfcc-row-btns">');
    if (inCatchUp) out.push(readButton(row));
    out.push('<button type="button" data-act="row-more" data-id="' + id + '" aria-expanded="'
      + (open ? 'true' : 'false') + '" aria-controls="tfcc-act-' + id + '" aria-label="'
      // #39: while open the toggle is a close X; the same button closes it.
      + (open ? 'Close actions' : escapeHtml('Actions for ' + row.title)) + '" title="'
      + (open ? 'Close actions' : 'Actions') + '">'
      + glyph(open ? 'close' : 'more') + '</button>');
    out.push('</span></div>');
    if (row.note) out.push('<div class="tfcc-note">' + escapeHtml(row.note) + '</div>');
    out.push('<div class="tfcc-drawer" id="tfcc-act-' + id + '"'
      + (open ? '>' + renderDrawer(row, model, inCatchUp) : ' hidden>') + '</div>');
    out.push('</div>');
    return out.join('');
  }

  // The narrow view heading (spec 6, focus rule 3): the focus fallback. Visible
  // in Catch up, where it carries the catch-up date; visually hidden elsewhere.
  function renderViewHeading(model) {
    var catchup = model.view === 'catchup';
    var since = catchup ? ' <span class="tfcc-note">since ' + escapeHtml(model.lastCatchUpAt
      ? formatAbsoluteTime(model.lastCatchUpAt) : 'your first run') + '</span>' : '';
    return '<h3 class="tfcc-vh' + (catchup ? '' : ' tfcc-sr') + '" id="' + VIEW_HEADING_ID + '" tabindex="-1">'
      + escapeHtml(VIEW_LABELS[model.view] || VIEW_LABELS.threads) + since + '</h3>';
  }

  // extra goes on the select element; the wide bar passes '' so its markup is
  // unchanged (tests/wide-parity.test.js).
  function renderSortSelect(model, extra) {
    var out = ['<select data-act="sort"' + extra + '>'];
    for (var i = 0; i < SORT_MODES.length; i += 1) {
      out.push('<option value="' + SORT_MODES[i] + '"'
        + (model.sort === SORT_MODES[i] ? ' selected' : '') + '>'
        + escapeHtml(SORT_LABELS[SORT_MODES[i]]) + '</option>');
    }
    out.push('</select>');
    return out.join('');
  }

  function renderFolderFilterSelect(model, extra) {
    var out = ['<select data-act="folder-filter"' + extra + '><option value="">All folders</option>'];
    for (var f = 0; f < model.folders.length; f += 1) {
      out.push('<option value="' + escapeHtml(model.folders[f].id) + '"'
        + (model.folderFilter === model.folders[f].id ? ' selected' : '') + '>'
        + escapeHtml(model.folders[f].name) + '</option>');
    }
    out.push('</select>');
    return out.join('');
  }

  function renderTagFilterSelect(model, extra) {
    if (!model.tags.length) return '';
    var out = ['<select data-act="tag-filter"' + extra + '><option value="">All tags</option>'];
    for (var t = 0; t < model.tags.length; t += 1) {
      out.push('<option value="' + escapeHtml(model.tags[t].tag) + '"'
        + (model.tagFilter === model.tags[t].tag ? ' selected' : '') + '>'
        + escapeHtml(model.tags[t].tag + ' (' + model.tags[t].count + ')') + '</option>');
    }
    out.push('</select>');
    return out.join('');
  }

  // The filter bar Threads and My posts share.
  function renderListBar(model) {
    if (model.narrow) return renderListBarNarrow(model);
    var out = ['<div class="tfcc-bar">'];
    out.push('<input class="tfcc-grow" type="search" data-act="filter" value="'
      + escapeHtml(model.searchQuery) + '" placeholder="filter: words, by:player, tag:x, is:unread">');
    out.push(renderSortSelect(model, ''));
    out.push(renderFolderFilterSelect(model, ''));
    out.push(renderTagFilterSelect(model, ''));
    out.push('<button type="button" data-act="unread-only" aria-pressed="'
      + (model.unreadOnly ? 'true' : 'false') + '">Unread only</button>');
    out.push('</div>');
    return out.join('');
  }

  // The narrow filter line (spec 4.3): the field, Unread and Filters on one
  // line; Sort, Folder and Tag one tap away. The grid is always in the markup
  // so aria-controls names a real element.
  function renderListBarNarrow(model) {
    var active = toInt(model.activeFilters, 0);
    var out = ['<div class="tfcc-bar tfcc-filterline">'];
    out.push('<input class="tfcc-grow" type="search" data-act="filter" value="' + escapeHtml(model.searchQuery)
      + '" placeholder="filter: words, by:player, tag:x" aria-label="Filter threads">');
    out.push('<button type="button" data-act="unread-only" aria-pressed="'
      + (model.unreadOnly ? 'true' : 'false') + '">Unread</button>');
    out.push('<button type="button" data-act="filters" aria-expanded="' + (model.filtersOpen ? 'true' : 'false')
      + '" aria-controls="tfcc-filters" aria-label="' + escapeHtml('Filters, ' + active + ' active') + '" title="Filters">'
      + glyph('funnel') + (active ? '<span>' + active + '</span>' : '') + '</button>');
    out.push('</div>');
    out.push('<div class="tfcc-filtergrid" id="tfcc-filters"' + (model.filtersOpen ? '' : ' hidden') + '>'
      + renderSortSelect(model, ' aria-label="Sort"')
      + renderFolderFilterSelect(model, ' aria-label="Folder filter"')
      + renderTagFilterSelect(model, ' aria-label="Tag filter"') + '</div>');
    return out.join('');
  }

  // The line under a capped list. Nothing at all unless the cap is biting, so a
  // user on All, or with a list no longer than the cap, never sees it.
  function renderCapLine(cap, view) {
    if (!cap || !cap.expandable) return '';
    var text = cap.expanded ? 'Showing all ' + cap.total : 'Showing ' + cap.rows.length + ' of ' + cap.total;
    var label = cap.expanded ? 'Show ' + cap.limit + ' only' : 'Show all';
    return '<div class="tfcc-bar tfcc-cap"><span class="tfcc-note">' + escapeHtml(text) + '</span>'
      + btn('rows-toggle', label, ' data-view="' + escapeHtml(view) + '" title="Until the page reloads"')
      + '</div>';
  }

  // Threads and My posts share this list body; capView says whose cap applies.
  function renderThreadsView(model, capView) {
    var cv = capView === 'mine' ? 'mine' : 'threads';
    var out = [renderListBar(model)];

    if (!model.rows.length) {
      out.push('<div class="tfcc-empty">Nothing matches. '
        + (model.view === 'mine' || model.totals.subscribed ? 'Try clearing the filters.' : 'Refresh to load your subscribed threads.')
        + '</div>');
    } else {
      var shown = model.capped[cv].rows;
      out.push('<div class="tfcc-rows">');
      for (var r = 0; r < shown.length; r += 1) out.push(rowHtml(shown[r], model));
      out.push('</div>');
      out.push(renderCapLine(model.capped[cv], cv));
    }
    return out.join('');
  }

  function renderMineView(model) {
    var m = model.mine;
    var out = [];
    // #33 (spec 13c): narrow, the reaction totals are the first line of My
    // posts; since #53 a compact centered pill, not the nav button. Wide, the
    // button stays in the nav.
    if (model.narrow) {
      var rx = renderReactionsPill(model);
      if (rx) out.push('<div class="tfcc-rxline">' + rx + '</div>');
    }
    // Spec 13d item 4: the live status stays visible; the standing
    // description and the refresh rule go behind info.
    var status = [];
    if (m.fetchedAt) status.push('Updated ' + formatRelativeTime(m.fetchedAt, model.now) + '.');
    if (m.unchecked) status.push(m.unchecked + ' not checked yet.');
    var pending = reactionsPending(model);
    if (pending) status.push(pending);
    out.push('<div class="tfcc-infobar">'
      + (status.length ? '<span class="tfcc-note">' + escapeHtml(status.join(' ')) + '</span>' : '')
      + renderInfoButton('mine', model.openInfoId) + '</div>');
    out.push(renderInfoText('mine', model.openInfoId, escapeHtml('Threads you started or posted in. '
      + 'Opening My posts checks Torn again at most once every ' + Math.round(MINE_TTL_MS / 60000)
      + ' minutes; Refresh always does.')));
    // The spec's Throttled row (#24): lookups stopped at the limiter, and the
    // rows they did not reach keep saying "not checked yet".
    if (m.throttled) {
      out.push('<p class="tfcc-note">' + escapeHtml('Slowing down to stay inside Torn\'s API limit.') + '</p>');
    }

    if (m.error) {
      out.push('<div class="tfcc-error">' + escapeHtml(m.error.detail) + '</div>');
      out.push('<div class="tfcc-actions">' + btn('refresh', 'Try again') + '</div>');
      if (m.total && m.fetchedAt) {
        out.push('<p class="tfcc-note">' + escapeHtml('Showing the saved list from '
          + formatAbsoluteTime(m.fetchedAt) + '.') + '</p>');
      }
    }

    if (!m.total) {
      if (m.refreshing) {
        out.push('<div class="tfcc-empty">Loading the threads you started and posted in...</div>');
      } else if (m.error) {
        // The error above says what happened; a failed fetch is not an empty answer.
      } else if (m.fetchedAt) {
        out.push('<div class="tfcc-empty">Torn reports no threads you started or posted in.</div>');
      } else {
        out.push('<div class="tfcc-empty">Press Refresh to load the threads you started and posted in.</div>');
      }
      return out.join('');
    }

    // Unread only is the one filter that can empty a non-empty list without
    // the user typing anything, so it gets its own words, plus the count of
    // rows it hid because nobody has checked them yet.
    var onlyUnread = model.unreadOnly && !model.searchQuery && !model.folderFilter && !model.tagFilter;
    if (!model.rows.length && onlyUnread) {
      out.push(renderListBar(model));
      out.push('<div class="tfcc-empty">No new replies in your threads.'
        + (m.unchecked ? ' ' + m.unchecked + ' not checked yet.' : '') + '</div>');
      return out.join('');
    }
    out.push(renderThreadsView(model, 'mine'));
    return out.join('');
  }

  // A narrow Catch up action (#39): both label sets are in the markup and the
  // panel's tfcc-cu-short class picks one. The accessible name is always the
  // full label.
  function cuButton(action, full, short) {
    return '<button type="button" data-act="' + escapeHtml(action) + '" aria-label="' + escapeHtml(full) + '">'
      + '<span class="tfcc-lfull">' + escapeHtml(full) + '</span>'
      + '<span class="tfcc-lshort" aria-hidden="true">' + escapeHtml(short) + '</span></button>';
  }

  // #45: a folder group's rows container id. Folder ids are slugs, but an
  // imported one may hold anything. Letters, digits and "-" pass; every other
  // character, "_" included, becomes "_" and four hex digits, so two keys
  // never share an id (PR #46 review: "ops/a" and "ops?a" did).
  function groupDomId(key) {
    return 'tfcc-grp-' + String(key).replace(/[^A-Za-z0-9-]/g, function (c) {
      return '_' + ('000' + c.charCodeAt(0).toString(16)).slice(-4);
    });
  }

  // #45: a folder group's heading is a toggle. Its name (and visible text)
  // is the group's name and count; aria-expanded says whether its rows show.
  function renderGroupHead(g) {
    var open = !g.collapsed;
    return '<div class="tfcc-section"><h4 class="tfcc-grphead"><button type="button" class="tfcc-grp" data-act="group-toggle"'
      + ' data-id="' + escapeHtml(g.key) + '" aria-expanded="' + (open ? 'true' : 'false') + '" aria-controls="'
      + groupDomId(g.key) + '" title="' + escapeHtml((open ? 'Collapse ' : 'Expand ') + g.name) + '">'
      + glyph(open ? 'down' : 'right') + '<span class="tfcc-grpname">' + escapeHtml(g.name) + ' (' + g.rows.length
      + ')</span></button></h4>';
  }

  function renderCatchUpView(model) {
    var out = [];
    out.push(model.narrow ? '<div class="tfcc-bar tfcc-cubar">' : '<div class="tfcc-bar">');
    if (!model.narrow) {
      out.push('<span class="tfcc-note">Since ' + escapeHtml(model.lastCatchUpAt
        ? formatAbsoluteTime(model.lastCatchUpAt) : 'your first run') + '</span>');
    }
    out.push(model.narrow ? cuButton('markall', 'Mark all read', 'All read') : btn('markall', 'Mark all read'));
    // Narrow, the info button is grouped with the control it explains, and the
    // three share one line (#39): fitCatchUp picks the label set that fits.
    if (model.narrow) out.push('<span class="tfcc-infogroup">');
    // The short label is the owner's "Caught up" (#41), replacing an arrow
    // label that confused: "All read" marks threads read, "Caught up" moves
    // the catch-up point to now.
    out.push(model.narrow ? cuButton('catchup-done', 'Set catch-up point to now', 'Caught up')
      : btn('catchup-done', 'Set catch-up point to now'));
    out.push(renderInfoButton('catchup', model.openInfoId));
    if (model.narrow) out.push('</span>');
    out.push('</div>');
    out.push(renderInfoText('catchup', model.openInfoId, 'Marking read here hides a thread from this list. '
      + 'It cannot clear Torn\'s own new-post counter, which only clears when you open the thread.'));
    // Author-only mode (issue #4): threads not yet checked are listed apart,
    // so an unknown never reads as caught up.
    var unchecked = '';
    var pending = model.catchUpUnchecked || [];
    if (pending.length) {
      var u = ['<div class="tfcc-section"><h4>Not yet checked for author posts (' + pending.length
        + ')</h4><div class="tfcc-rows">'];
      for (var p = 0; p < pending.length; p += 1) u.push(rowHtml(pending[p], model));
      u.push('</div></div>');
      unchecked = u.join('');
    }
    if (!model.catchUp.length) {
      out.push('<div class="tfcc-empty">' + (model.authorOnly && pending.length
        ? 'No author updates in the threads checked.' : 'Nothing new. You are caught up.') + '</div>');
      out.push(unchecked);
      return out.join('');
    }
    // Cap the flat, activity-sorted list first, then group what is shown.
    // Capping per folder would show up to N rows times the folder count.
    var groups = groupCatchUp(model.capped.catchup.rows, {
      folders: model.folders, unfiledAt: model.unfiledAt, collapsedFolders: model.collapsedFolders,
    });
    for (var n = 0; n < groups.length; n += 1) {
      out.push(renderGroupHead(groups[n]));
      // #45: a collapsed group renders its heading only. The rows' container
      // stays, empty and hidden, so aria-controls names a real element.
      if (groups[n].collapsed) {
        out.push('<div class="tfcc-rows" id="' + groupDomId(groups[n].key) + '" hidden></div></div>');
        continue;
      }
      out.push('<div class="tfcc-rows" id="' + groupDomId(groups[n].key) + '">');
      for (var j = 0; j < groups[n].rows.length; j += 1) {
        out.push(rowHtml(groups[n].rows[j], model));
      }
      out.push('</div></div>');
    }
    out.push(renderCapLine(model.capped.catchup, 'catchup'));
    out.push(unchecked);
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
    if (model.narrow) out.push('<span class="tfcc-infogroup">');
    out.push('<a class="tfcc-linkbtn" href="' + escapeHtml(buildNativeSearchUrl(model.searchQuery, 0))
      + '">Search on Torn</a>');
    out.push(renderInfoButton('search', model.openInfoId));
    if (model.narrow) out.push('</span>');
    out.push('</div>');
    out.push(renderInfoText('search', model.openInfoId, 'Filtering searches titles, authors, forums, your notes and tags. '
      + 'Searching inside posts fetches up to ' + model.settings.deepSearchPages
      + ' pages for each of the threads currently listed, then keeps them for next time. '
      + 'Search on Torn hands the same query to Torn\'s own forum search, which understands by:player '
      + 'but never shows you a box for it.'));
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
      for (var i = 0; i < matched.length && i < SEARCH_ROWS_MAX; i += 1) out.push(rowHtml(matched[i], model));
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

  var EDITOR_MODES = Object.freeze([['text', 'Text'], ['md', 'MD'], ['html', 'HTML'], ['preview', 'Preview']]);

  function renderModePill(e) {
    var out = ['<div class="tfcc-modes" role="group" aria-label="Editor mode">'];
    for (var i = 0; i < EDITOR_MODES.length; i += 1) {
      var m = EDITOR_MODES[i][0];
      var on = m === 'preview' ? e.mode === 'preview' : e.mode === 'source' && e.lang === m;
      out.push('<button type="button" data-act="ed-mode" data-mode="' + m + '" aria-pressed="' + (on ? 'true' : 'false')
        + '">' + EDITOR_MODES[i][1] + '</button>');
    }
    out.push('</div>');
    return out.join('');
  }

  function renderPreview(model) {
    var e = model.editor;
    var theme = e.previewTheme || model.themeResolved || 'dark';
    var blocks = previewModel(e.lang, e.text);
    var hasExternal = blocks.some(function (b) { return /<img src="https:/.test(b.html); });
    var out = ['<div class="tfcc-pvbar">'];
    out.push('<span class="tfcc-note">Preview as Torn shows it.</span>');
    if (hasExternal && !e.showImages) out.push(btn('ed-pv-images', 'Show images'));
    for (var t = 0; t < 2; t += 1) {
      var th = t ? 'dark' : 'light';
      out.push('<button type="button" data-act="ed-pv-theme" data-theme="' + th + '" aria-pressed="'
        + (theme === th ? 'true' : 'false') + '">' + (t ? 'Dark' : 'Light') + '</button>');
    }
    out.push('</div><div class="tfcc-pv tfcc-pv-' + theme + '">');
    if (!blocks.length) out.push('<p class="tfcc-note">Nothing to preview yet.</p>');
    for (var i = 0; i < blocks.length; i += 1) {
      // blocks[i].html is cleanTornHtml output: the allowlist is what makes
      // rendering player-typed HTML inside the panel safe (spec section 5).
      out.push('<div class="tfcc-pv-block" data-act="ed-jump" data-offset="' + blocks[i].offset
        + '" title="Tap to edit here">' + previewImages(blocks[i].html, e.showImages) + '</div>');
    }
    out.push('</div>');
    return out.join('');
  }

  // Toolbar items: [act, data, label, aria label, primary-when-narrow].
  var EDITOR_TOOLS = Object.freeze([
    ['ed-mark', 'data-mark="bold"', '<b>B</b>', 'Bold', true],
    ['ed-mark', 'data-mark="italic"', '<i>I</i>', 'Italic', true],
    ['ed-mark', 'data-mark="underline"', '<u>U</u>', 'Underline', true],
    ['ed-picker', 'data-picker="color"', '<span style="border-bottom: 3px solid #e03131;">A</span>', 'Text color', true],
    ['ed-picker', 'data-picker="link"', '<span class="tfcc-emo" aria-hidden="true">\uD83D\uDD17</span>', 'Insert link', true],
    ['ed-mark', 'data-mark="strike"', '<s>S</s>', 'Strike through', false],
    ['ed-picker', 'data-picker="size"', 'aA', 'Text size', false],
    ['ed-picker', 'data-picker="align"', '\u2261', 'Alignment', false],
    ['ed-quote', '', '\u201C', 'Quote', false],
    ['ed-picker', 'data-picker="image"', '<span class="tfcc-emo" aria-hidden="true">\uD83D\uDDBC\uFE0F</span>', 'Insert image', false],
    ['ed-picker', 'data-picker="table"', '\u25A6', 'Insert table', false],
    ['ed-picker', 'data-picker="emoji"', '\u263A', 'Insert emoji', false],
    ['ed-picker', 'data-picker="help"', '?', 'Markdown help', false],
  ]);

  // C1: the help button reads X while the key is open, and says which key
  // it opens (Markdown or HTML) while it is closed.
  function isHelpTool(t) { return t[2] === '?'; }

  function helpToolFor(t, e) {
    if (e.picker === 'help') return [t[0], t[1], 'X', 'Close help', t[4]];
    return [t[0], t[1], t[2], e.lang === 'html' ? 'HTML help' : 'Markdown help', t[4]];
  }

  // t[1] (extra attributes) and t[2] (the button's face) are emitted
  // unescaped: they must stay trusted constant markup from the tool tables
  // (a styled letter or a JS-escaped symbol), never user or API text. Only
  // the name (t[3]) is escaped.
  function toolButton(t, disabled) {
    return '<button type="button" data-act="' + t[0] + '"' + (t[1] ? ' ' + t[1] : '') + ' aria-label="' + escapeHtml(t[3])
      + '" title="' + escapeHtml(t[3]) + '"' + (disabled ? ' disabled' : '') + '>' + t[2] + '</button>';
  }

  // E2: Undo leads the toolbar, and is all of it in Text mode.
  function undoButton(e) {
    return toolButton(['ed-undo', '', '\u21B6', 'Undo the last change', true], e.mode === 'preview' || !(e.undo && e.undo.length));
  }

  function renderEditorToolbar(model) {
    var e = model.editor;
    if (e.lang === 'text' && e.mode === 'source') {
      return '<div class="tfcc-tools" role="toolbar" aria-label="Formatting">' + undoButton(e) + '</div>';
    }
    var disabled = e.mode === 'preview';
    var out = ['<div class="tfcc-tools" role="toolbar" aria-label="Formatting">', undoButton(e)];
    for (var i = 0; i < EDITOR_TOOLS.length; i += 1) {
      var t = EDITOR_TOOLS[i];
      if (model.narrow && !t[4]) continue;
      if (isHelpTool(t)) {
        if (e.lang === 'text') continue;
        t = helpToolFor(t, e);
      }
      out.push(toolButton(t, disabled));
    }
    if (model.narrow) {
      out.push('<button type="button" data-act="ed-more" aria-expanded="' + (e.moreOpen ? 'true' : 'false')
        + '" aria-label="More tools" title="More tools"' + (disabled ? ' disabled' : '') + '>\u22EF</button>');
    }
    out.push('</div>');
    if (model.narrow && e.moreOpen && !disabled) {
      out.push('<div class="tfcc-tools tfcc-tools-more">');
      for (var k = 0; k < EDITOR_TOOLS.length; k += 1) {
        var mt = EDITOR_TOOLS[k];
        if (mt[4]) continue;
        if (isHelpTool(mt)) {
          if (e.lang === 'text') continue;
          mt = helpToolFor(mt, e);
        }
        out.push(toolButton(mt, false));
      }
      out.push('</div>');
    }
    if (e.picker && !disabled) out.push(renderPicker(model));
    return out.join('');
  }

  // C2/C3: the help is a key, not a lesson: what you type, what you get.
  // Players are assumed to know Markdown and HTML. No literal URLs here:
  // read-only.test.js audits every http(s) host in the source.
  var MD_KEY = Object.freeze([
    ['# Title, ## Title, ### Title', 'headings (the space after # is required)'],
    ['**bold**', 'bold'], ['*italic*', 'italic'], ['++underline++', 'underline'], ['~~strike~~', 'strike through'],
    ['{red}text{/}', '17 Torn colors, e.g. {red}'], ['{#ff8800}text{/}', 'any hex color'],
    ['{18}text{/}', 'size 8 to 36'], [':::center / left / right ... :::', 'aligned lines'],
    ['> text', 'quote'], ['- item / 1. item', 'bullet / numbered list'],
    ['| a | b |', 'table row (a --- row makes the header)'],
    ['[text](link)', 'link'], ['![alt](image link)', 'image'], [':grin:', 'Torn emoji'], ['\\*', 'backslash: show a mark as text (e.g. \\*)'],
    ['Not supported', 'code blocks, nested lists, #### and smaller, _underscores_, horizontal rules'],
  ]);

  var HTML_KEY = Object.freeze([
    ['<p>text</p>', 'paragraph'], ['<strong> / <em>', 'bold / italic'],
    ['<span style="text-decoration: underline">', 'underline (line-through: strike)'],
    ['<span style="color: var(--te-text-color-red)">', 'Torn color (or a #hex value)'],
    ['<span style="font-size: 18px">', 'text size'], ['<p style="text-align: center">', 'centered'],
    ['<blockquote><p>', 'quote'], ['<ul> / <ol> + <li>', 'bullet / numbered list'],
    ['<table><tr><th> / <td>', 'table'], ['<a href="...">', 'link'], ['<img src="..." alt="...">', 'image'],
    ['<img src="/images/emotions/svg/grin.svg">', 'Torn emoji'],
    ['Everything else', 'is stripped when posting'],
  ]);

  function renderKey(lang) {
    var rows = lang === 'html' ? HTML_KEY : MD_KEY;
    var out = ['<table class="tfcc-key"><thead><tr><th scope="col">You type</th><th scope="col">You get</th></tr></thead><tbody>'];
    rows.forEach(function (h) { out.push('<tr><td><code>' + escapeHtml(h[0]) + '</code></td><td>' + escapeHtml(h[1]) + '</td></tr>'); });
    out.push('</tbody></table>');
    return out.join('');
  }

  // The result of a link check, shared by the Image picker and the fixer
  // section: the converted link, the host's note, and (only after a check)
  // the thumbnail with its buttons. withCopy also shows the ready link.
  function renderImageCheck(out, r, insertBtn, withCopy) {
    if (!r) return;
    if (r.status === 'fixed') out.push('<p class="tfcc-note">Fixed for Torn: <code>' + escapeHtml(r.url) + '</code></p>');
    else if (withCopy && r.status === 'ok') out.push('<p class="tfcc-note">Ready to use: <code>' + escapeHtml(r.url) + '</code></p>');
    if (r.note) out.push('<p class="tfcc-note">' + escapeHtml(r.note) + '</p>');
    if (r.status === 'ok' || r.status === 'fixed') {
      // Loaded because the player tapped Check; no referrer (spec 4a).
      out.push('<img class="tfcc-img-check" referrerpolicy="no-referrer" src="' + escapeHtml(r.url) + '" alt="Preview of the image">'
        + (withCopy ? btn('ed-fix-copy', 'Copy link') : '') + insertBtn);
    }
  }

  var FIX_ALL_NOTE = 'Rewrites image page links (Drive, Dropbox, Imgur...) in this draft into direct image links. Nothing is uploaded.';

  // H1: the image link fixer, a section below the editor.
  function renderFixer(e) {
    var F = e.fields || {};
    var v = escapeHtml(Object.prototype.hasOwnProperty.call(F, 'ed-fix-url') ? F['ed-fix-url'] : '');
    var out = ['<div class="tfcc-picker tfcc-fixer" role="group" aria-label="Fix image link">'];
    out.push('<label for="tfcc-ed-fix" class="tfcc-note">Image link</label>'
      + '<input id="tfcc-ed-fix" type="url" data-act="ed-fix-url" value="' + v + '">' + btn('ed-fix-check', 'Check'));
    renderImageCheck(out, e.fixCheck, btn('ed-fix-insert', 'Insert into draft'), true);
    out.push('<div class="tfcc-actions">' + btn('ed-fix-all', 'Fix all links in this draft') + '</div>'
      + '<p class="tfcc-note">' + FIX_ALL_NOTE + '</p></div>');
    return out.join('');
  }

  function pickerClose(picker) { return btn('ed-picker-close', picker === 'help' ? 'Close' : 'Cancel'); }

  function renderPicker(model) {
    var e = model.editor;
    // Typed fields live in the editor state (onInput), so a redraw re-renders
    // what was typed instead of emptying it.
    var F = e.fields || {};
    var fv = function (k, d) { return escapeHtml(Object.prototype.hasOwnProperty.call(F, k) ? F[k] : d); };
    var out = ['<div class="tfcc-picker" role="group" aria-label="' + escapeHtml(e.picker) + '">'];
    if (e.picker === 'color') {
      var theme = model.themeResolved || 'dark';
      out.push('<div class="tfcc-swatches">');
      for (var i = 0; i < TORN_COLORS.length; i += 1) {
        var c = TORN_COLORS[i];
        out.push('<button type="button" data-act="ed-color" data-value="' + c.name + '" aria-label="' + c.name
          + (c.name === 'gray5' ? ', matches the page background' : '') + '" title="' + c.name + '">'
          + '<span class="tfcc-swatch" style="background: ' + c[theme] + ';" aria-hidden="true"></span></button>');
      }
      out.push('</div><label for="tfcc-ed-hex" class="tfcc-note">Custom color</label>'
        + '<input id="tfcc-ed-hex" type="text" data-act="ed-hex-input" placeholder="#ff8800" maxlength="7" value="' + fv('ed-hex-input', '') + '">'
        + btn('ed-color', 'Use custom color', ' data-value="custom"'));
      if (e.pickerWarn) {
        out.push('<p class="tfcc-note" role="alert">' + escapeHtml(e.pickerWarn) + ' Tap Use custom color again to use it anyway.</p>');
      }
    } else if (e.picker === 'size') {
      for (var s = 0; s < SIZE_PICKS.length; s += 1) out.push(btn('ed-size', SIZE_PICKS[s] + 'px', ' data-value="' + SIZE_PICKS[s] + '"'));
    } else if (e.picker === 'align') {
      ['left', 'center', 'right', 'justify'].forEach(function (a) { out.push(btn('ed-align', a.charAt(0).toUpperCase() + a.slice(1), ' data-value="' + a + '"')); });
    } else if (e.picker === 'link') {
      out.push('<label for="tfcc-ed-link" class="tfcc-note">Link address (https)</label>'
        + '<input id="tfcc-ed-link" type="url" data-act="ed-link-input" value="' + fv('ed-link-input', '') + '">' + btn('ed-link-apply', 'Add link'));
    } else if (e.picker === 'image') {
      out.push('<label for="tfcc-ed-img" class="tfcc-note">Image link</label>'
        + '<input id="tfcc-ed-img" type="url" data-act="ed-img-url" value="' + fv('ed-img-url', '') + '">'
        + '<label for="tfcc-ed-alt" class="tfcc-note">Description (optional)</label>'
        + '<input id="tfcc-ed-alt" type="text" data-act="ed-img-alt" maxlength="200" value="' + fv('ed-img-alt', '') + '">'
        + btn('ed-img-check', 'Check link'));
      renderImageCheck(out, e.imageCheck, btn('ed-img-insert', 'Insert image'), false);
      out.push('<p class="tfcc-note">Have the file, not a link? Upload it with Torn\'s own Insert Image button after Insert.</p>');
    } else if (e.picker === 'table') {
      out.push('<label for="tfcc-ed-cols" class="tfcc-note">Columns</label><input id="tfcc-ed-cols" type="number" min="1" max="8" value="' + fv('ed-cols', '2') + '" data-act="ed-cols">'
        + '<label for="tfcc-ed-rows" class="tfcc-note">Rows</label><input id="tfcc-ed-rows" type="number" min="1" max="30" value="' + fv('ed-rows', '2') + '" data-act="ed-rows">'
        + '<label for="tfcc-ed-head" class="tfcc-note">Header row</label><input id="tfcc-ed-head" type="checkbox"'
        + (F['ed-header'] === false ? '' : ' checked') + ' data-act="ed-header">'
        + btn('ed-table-insert', 'Insert table'));
    } else if (e.picker === 'emoji') {
      out.push('<div class="tfcc-modes" role="group" aria-label="Emoji set">'
        + '<button type="button" data-act="ed-emoji-tab" data-tab="torn" aria-pressed="' + (e.emojiTab !== 'unicode') + '">Torn</button>'
        + '<button type="button" data-act="ed-emoji-tab" data-tab="unicode" aria-pressed="' + (e.emojiTab === 'unicode') + '">Unicode</button></div>');
      out.push('<div class="tfcc-emoji">');
      if (e.emojiTab === 'unicode') {
        for (var u = 0; u < UNICODE_EMOJI.length; u += 1) {
          out.push('<button type="button" data-act="ed-emoji" data-value="u' + u + '" aria-label="Emoji ' + (u + 1) + '">' + UNICODE_EMOJI[u] + '</button>');
        }
      } else {
        for (var k = 0; k < TORN_EMOJI.length; k += 1) {
          var nm = TORN_EMOJI[k];
          out.push('<button type="button" data-act="ed-emoji" data-value="' + nm + '" aria-label="' + nm.replace(/_/g, ' ') + '" title="' + nm + '">'
            + '<img src="/images/emotions/svg/' + nm + '.svg" alt="" width="24" height="24"></button>');
        }
      }
      out.push('</div><p class="tfcc-note">More emoji: press Win + . (Windows) or Ctrl + Cmd + Space (Mac) while typing.</p>');
    } else if (e.picker === 'help') {
      out.push(renderKey(e.lang));
    }
    out.push('<div class="tfcc-actions">' + pickerClose(e.picker) + '</div></div>');
    return out.join('');
  }

  // C4: what drafts are and what each button does. Plain text, no data.
  var DRAFTS_INFO = 'A draft belongs to one thread, or is a free draft you can use for anything, such as a new thread. '
    + 'Save keeps it on this device only. Insert puts the post at the end of the reply box on Torn, and you still press Post yourself. '
    + 'Copy is for anywhere else. What you type in the reply box on Torn is also autosaved here as an HTML draft.';

  function renderEditorPane(model) {
    var e = model.editor;
    var key = e.key;
    var out = ['<div class="tfcc-section tfcc-draft-editor">'];
    var isFree = /^n[0-9]+$/.test(key);
    // The info button sits in an infobar beside the heading or the name's
    // label, as every other info button does, never inside the heading.
    if (isFree) {
      out.push('<div class="tfcc-infobar"><label class="tfcc-note" for="tfcc-ed-name">Draft name</label>'
        + renderInfoButton('drafts-editor', model.openInfoId) + '</div>'
        + '<input id="tfcc-ed-name" type="text" maxlength="80" data-act="ed-name" data-id="' + escapeHtml(key)
        + '" value="' + escapeHtml(e.name) + '">');
    } else {
      out.push('<div class="tfcc-infobar"><h4>Draft for this thread</h4>'
        + renderInfoButton('drafts-editor', model.openInfoId) + '</div>');
    }
    out.push(renderInfoText('drafts-editor', model.openInfoId, DRAFTS_INFO));
    out.push(renderModePill(e));
    if (e.confirmText) {
      out.push('<div class="tfcc-confirm" role="alert"><p class="tfcc-note">Plain text drops the formatting. Switch anyway?</p>'
        + btn('ed-mode-confirm', 'Switch') + btn('ed-mode-cancel', 'Cancel') + '</div>');
    }
    out.push(renderEditorToolbar(model));
    if (e.mode === 'preview') {
      out.push(renderPreview(model));
    } else {
      // B5: the height the player dragged it to survives every redraw.
      // F1: with no dragged height, the Settings default for this layout.
      var setH = model.narrow ? model.settings.editorHeightNarrow : model.settings.editorHeightWide;
      var useH = typeof e.height === 'number' && isFinite(e.height) && e.height > 0 ? e.height
        : (Object.prototype.hasOwnProperty.call(EDITOR_HEIGHTS, setH) ? EDITOR_HEIGHTS[setH] : EDITOR_HEIGHTS[model.narrow ? 'medium' : 'large']);
      var hgt = ' style="height: ' + Math.round(useH) + 'px;"';
      out.push('<textarea class="tfcc-draft" data-act="draft-text" data-id="' + escapeHtml(key)
        + '" maxlength="' + DRAFT_MAX_CHARS + '" aria-label="Draft text"' + hgt + '>' + escapeHtml(e.text) + '</textarea>');
    }
    out.push('<div class="tfcc-actions">');
    out.push(btn('draft-save', 'Save draft', ' data-id="' + escapeHtml(key) + '"'));
    out.push(model.replyBoxFound
      ? btn('draft-insert', 'Insert into reply box', ' data-id="' + escapeHtml(key) + '"')
      : btn('draft-copy', 'Copy', ' data-id="' + escapeHtml(key) + '"'));
    out.push(btn('draft-delete', 'Delete', ' data-id="' + escapeHtml(key) + '"'));
    // E1: a thread draft's text can move to a new free draft.
    if (!isFree) out.push(btn('draft-to-free', 'Save as free draft', ' class="tfcc-tofree" data-id="' + escapeHtml(key) + '"'));
    // H1: the image link fixer opens from the right end of the row.
    out.push(btn('ed-fix-open', 'Fix image link', ' class="tfcc-fixopen" aria-expanded="' + (e.fixOpen ? 'true' : 'false') + '"'));
    out.push('</div>');
    if (e.fixOpen) out.push(renderFixer(e));
    if (!model.replyBoxFound) out.push('<p class="tfcc-note">No reply box here, so Copy replaces Insert.</p>');
    out.push('</div>');
    return out.join('');
  }

  function renderDraftList(model) {
    var out = ['<div class="tfcc-section"><h4>All drafts (' + model.drafts.length + ')</h4>'];
    out.push('<div class="tfcc-actions">' + btn('draft-new', '+ New draft') + '</div>');
    if (!model.drafts.length) out.push('<div class="tfcc-empty">No saved drafts.</div>');
    for (var i = 0; i < model.drafts.length; i += 1) {
      var dr = model.drafts[i];
      var free = dr.kind === 'free';
      out.push('<div class="tfcc-hit' + (free ? ' tfcc-free' : '') + '"><div>');
      if (free) {
        out.push('<strong>' + escapeHtml(dr.title) + '</strong> <span class="tfcc-note">(free)</span> ');
      } else {
        out.push('<a href="https://www.torn.com/forums.php#/p=threads&t=' + escapeHtml(dr.threadId) + '&b=0&a=0"'
          + threadLinkAttr(dr.threadId) + '>' + escapeHtml(dr.title || ('Thread ' + dr.threadId)) + '</a> ');
      }
      out.push('<span class="tfcc-note">' + escapeHtml(formatRelativeTime(dr.updatedAt, model.now)) + '</span></div>');
      out.push('<div class="tfcc-hit-text">' + escapeHtml(dr.text.slice(0, 300)) + '</div>');
      out.push('<div class="tfcc-actions">'
        + btn('draft-edit', 'Edit', ' data-id="' + escapeHtml(dr.key) + '"')
        + btn('draft-copy', 'Copy', ' data-id="' + escapeHtml(dr.key) + '"')
        + btn('draft-delete', 'Delete', ' data-id="' + escapeHtml(dr.key) + '"')
        + '</div></div>');
    }
    out.push('</div>');
    return out.join('');
  }

  function renderDraftsView(model) {
    var out = [];
    if (model.editor && model.editor.key) out.push(renderEditorPane(model));
    else out.push('<p class="tfcc-note">Open a thread to write a draft for it, or start a new draft below.</p>');
    out.push(renderDraftList(model));
    return out.join('');
  }

  // The draft key the Drafts view edits: the thread the user asked to write
  // about (or a free draft) wins over the thread they happen to be looking at,
  // so the Draft button on a row works from anywhere.
  function editorKeyFor(model) {
    if (model.draftFocusId) return String(model.draftFocusId);
    return model.route && model.route.isThread ? String(model.route.threadId) : null;
  }

  // Points the editor at a draft. A saved draft brings its own language; a new
  // one opens in the Default editor mode (Settings).
  function defaultDraftLang() {
    return DRAFT_LANGS.indexOf(state.settings.draftLang) !== -1 ? state.settings.draftLang : 'md';
  }

  function loadEditor(key, now) {
    var d = key ? draftFor(state.drafts, key) : null;
    var lang = d ? draftLangOf(d) : defaultDraftLang();
    var text = d ? d.text : '';
    state.editor = {
      key: key, lang: lang, text: text, selStart: text.length, selEnd: text.length, mode: 'source',
      previewTheme: null, picker: null, confirmText: null, moreOpen: false, emojiTab: 'torn',
      name: d && d.name ? d.name : '', imageCheck: null, fixOpen: false, fixCheck: null, pickerWarn: null, dirty: false, showImages: false,
      fields: {}, src: draftSig(d), atLimit: false, height: null, undo: [], typingAt: 0,
    };
    void now;
  }

  // #58 E2: Undo. A snapshot of the text, mode and selection is pushed before
  // each edit; a typing burst pushes one at its start. The stack belongs to
  // the open draft: loadEditor starts a new one.
  var UNDO_MAX = 50;
  var TYPING_BURST_MS = 1000;

  // from: the state to snapshot when it is not e itself (a reload keeps the
  // editor it replaced).
  function pushUndo(e, from) {
    var f = from || e;
    var stack = (e.undo || []).concat([{ text: f.text, lang: f.lang, selStart: f.selStart, selEnd: f.selEnd }]);
    e.undo = stack.length > UNDO_MAX ? stack.slice(stack.length - UNDO_MAX) : stack;
    // Anything pushed here ends a typing burst: the next keystroke starts one.
    e.typingAt = 0;
  }

  // What the editor last loaded or saved, so buildPanelModel can tell when the
  // stored draft has changed behind a clean editor. A draft not yet stored is
  // keyed by the Default editor mode it would open in.
  function draftSig(d) {
    return d ? [d.text, draftLangOf(d), d.name || '', d.updatedAt].join('\n|') : 'new|' + defaultDraftLang();
  }

  function editorPostHtml() { return postHtml(state.editor.text, state.editor.lang); }

  // Saves the open draft. A blank thread draft is deleted, as before; a free
  // draft keeps its name even when empty. Returns whether it stored: a free
  // draft that no longer exists (deleted, or gone in Reset all) is not
  // recreated, and the editor stays dirty so the text is not taken for saved.
  function saveEditor(now) {
    var e = state.editor;
    if (!e.key) return false;
    if (/^n[0-9]+$/.test(e.key)) {
      if (!state.drafts.free || !state.drafts.free[e.key]) return false;
      state.drafts = saveFreeDraft(state.drafts, e.key, e.text, now, e.name, e.lang);
    } else state.drafts = saveDraft(state.drafts, e.key, e.text, now, '', e.lang);
    e.dirty = false;
    e.src = draftSig(draftFor(state.drafts, e.key));
    persist('drafts');
    return true;
  }

  // Spec section 4a: nothing is ever silently cut. An action whose result
  // would pass the draft limit is refused with this.
  function overLimitNotice(n) {
    notice('That would make this draft ' + n + ' characters, over the ' + DRAFT_MAX_CHARS
      + ' limit. Shorten it, or keep it as it is.', 'warn');
  }

  var BADGE_METRIC_LABELS = Object.freeze({
    visits: 'focused thread visits', forums: 'forums explored', best: 'days in a row',
    checkinDays: 'days', bigBacklog: 'threads in the backlog',
  });

  // #47: a Settings checkbox row. Narrow, it carries tfcc-kvc, so its label
  // keeps the 44px target and sits on the checkbox's line; a label over a
  // select or a text field needs no target of its own. Wide is unchanged.
  function checkRow(model) {
    return '<div class="tfcc-kv' + (model.narrow ? ' tfcc-kvc' : '') + '">';
  }

  function renderBadgeCatalogue(model) {
    var b = model.badges || { enabled: false };
    var out = ['<div class="tfcc-section"><h4>Badges</h4>'];
    out.push(checkRow(model) + '<label for="tfcc-badges">Show badges and record progress</label>'
      + '<input id="tfcc-badges" type="checkbox" data-act="badges-toggle"' + (b.enabled ? ' checked' : '') + '></div>');
    out.push('<div class="tfcc-infobar"><span class="tfcc-note">Recorded on this device only. No request is made.'
      + '</span>' + renderInfoButton('settings-badges', model.openInfoId) + '</div>');
    out.push(renderInfoText('settings-badges', model.openInfoId, 'Earned from what you do here: focused visits '
      + 'to threads, finishing Torn days with Catch up empty, and organizing. A visit counts once a Torn day, '
      + 'after 15 seconds with the page in front of you. A day is a Torn day, from 00:00 TCT. Nothing is sent '
      + 'anywhere, and no request is made. Turning this off stops recording, and a streak does not survive days '
      + 'with it off.'));
    if (!b.enabled) { out.push('</div>'); return out.join(''); }
    out.push('<div class="tfcc-badge-row"><button type="button" data-act="badges-catalogue" aria-expanded="'
      + (b.catalogueOpen ? 'true' : 'false') + '">' + (b.catalogueOpen ? 'Hide the list' : 'Show all '
      + b.total + ' badges') + '</button><span class="tfcc-note">' + b.earnedCount + ' of ' + b.total
      + ' earned</span></div>');
    if (!b.catalogueOpen) { out.push('</div>'); return out.join(''); }
    out.push('<p class="tfcc-note">Focused thread visits: ' + state.badges.visits + '. Forums explored: '
      + state.badges.forums.length + '. Streak: current ' + b.streak.current + ', best ' + b.streak.best + '.</p>');
    var byId = {};
    for (var p = 0; p < b.progress.length; p += 1) byId[b.progress[p].id] = b.progress[p];
    for (var g = 0; g < BADGE_GROUPS.length; g += 1) {
      out.push('<h4>' + escapeHtml(BADGE_GROUPS[g].label) + '</h4>');
      for (var i = 0; i < BADGES.length; i += 1) {
        var d = BADGES[i];
        if (d.group !== BADGE_GROUPS[g].id) continue;
        var pr = byId[d.id];
        out.push('<div class="tfcc-badge-row">' + badgeIcon(pr.earned ? d.tier : 'locked', d.glyph, 20, true)
          + '<strong>' + escapeHtml(d.name) + '</strong><span class="tfcc-note">'
          + escapeHtml(BADGE_TIER_LABELS[d.tier]) + '</span>');
        if (pr.earned) out.push('<span class="tfcc-note">Earned ' + escapeHtml(formatAbsoluteTime(pr.earned)) + '</span>');
        else if (pr.target > 1) {
          out.push(renderBadgeBar(pr.value, pr.target));
          if (Object.prototype.hasOwnProperty.call(BADGE_METRIC_LABELS, d.metric)) {
            out.push('<span class="tfcc-note">' + escapeHtml(BADGE_METRIC_LABELS[d.metric]) + '</span>');
          }
        } else out.push('<span class="tfcc-note">Not yet</span>');
        out.push('</div><p class="tfcc-note">' + escapeHtml(d.rule) + '</p>');
      }
    }
    out.push('</div>');
    return out.join('');
  }

  // #45: a folder's (or Unfiled's) up or down arrow in Settings. Disabled at
  // the end it cannot pass.
  function moveButton(key, label, dir, disabled) {
    var name = 'Move ' + label + ' ' + dir;
    return '<button type="button" class="tfcc-move" data-act="folder-' + dir + '" data-id="' + escapeHtml(key)
      + '" aria-label="' + escapeHtml(name) + '" title="' + escapeHtml(name) + '"' + (disabled ? ' disabled' : '') + '>'
      + glyph(dir) + '</button>';
  }

  function renderSettingsView(model) {
    var out = [];
    out.push('<div class="tfcc-section"><h4>Torn API key</h4>');
    // Spec 13d item 13: the ToS table below states every access level.
    out.push('<p class="tfcc-note">Create a <strong>Minimal Access</strong> key on Torn (Settings, API Key).</p>');
    // Torn's API terms require this to be stated clearly and visibly wherever
    // the user provides their key, in this table's form. It is rendered here
    // rather than buried in a readme because that is where the terms put it.
    out.push('<table class="tfcc-tos"><tbody>');
    out.push('<tr><th>Who can see your data</th><td>Nobody. It never leaves this device.</td></tr>');
    out.push('<tr><th>What it is used for</th><td>Public community tool: listing and organizing the '
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
    // Spec 13d item 16, the owner's wording.
    out.push('<p class="tfcc-note">Opens Torn in a new tab with only this script\'s selections.</p>');
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
    // The numbers are computed from the constants, so this promise cannot
    // drift from what the code does (CLAUDE.md constraint 7).
    var thumbsAt = function (b) { return Math.min(REACTION_LOOKUPS_PER_RUN, b); };
    var budgetText = 'A refresh of Threads makes two requests, plus one for the forum list at '
      + 'most once a day. Opening My posts, or refreshing while it is open, makes two requests of its own, '
      + 'at most once every ' + Math.round(MINE_TTL_MS / 60000) + ' minutes unless you press Refresh. '
      + 'Each activity lookup adds one more to either, and only runs for a thread with no recent time. '
      + 'My posts also reads the opening post of up to ' + REACTION_LOOKUPS_PER_RUN + ' threads you started, '
      + 'for their thumbs up and down, each at most once every ' + Math.round(TOPIC_TTL_MS / 3600000) + ' hours; '
      + 'with lookups set to 0 it reads none. '
      + 'If you have started no threads and written no posts, My posts instead reads your profile once '
      + 'for your forum karma, at most once every ' + Math.round(KARMA_TTL_MS / 3600000) + ' hours, '
      + 'which is 3 requests in all. '   // two lists + user/profile, at any lookup setting
      + 'With the default of ' + DEFAULT_ENRICH_BUDGET + ', a Threads refresh is at most '
      + (3 + DEFAULT_ENRICH_BUDGET) + ' requests and My posts at most '
      + (2 + DEFAULT_ENRICH_BUDGET + thumbsAt(DEFAULT_ENRICH_BUDGET))
      + '; at the largest setting of ' + MAX_ENRICH_BUDGET + ', ' + (3 + MAX_ENRICH_BUDGET) + ' and '
      + (2 + MAX_ENRICH_BUDGET + thumbsAt(MAX_ENRICH_BUDGET)) + '. '
      + 'The script keeps itself under ' + REQUESTS_PER_WINDOW + ' requests a minute regardless.';
    // CLAUDE.md constraint 7: the headline of the budget stays visible and is
    // computed from the constants and this user's lookup setting.
    var budget = model.settings.enrichBudget;
    out.push('<div class="tfcc-infobar"><span class="tfcc-note">' + escapeHtml('A Threads refresh is at most '
      + (3 + budget) + ' requests and My posts at most ' + (2 + budget + thumbsAt(budget))
      + '; never more than ' + REQUESTS_PER_WINDOW + ' a minute.') + '</span>'
      + renderInfoButton('settings-budget', model.openInfoId) + '</div>');
    out.push(renderInfoText('settings-budget', model.openInfoId, budgetText));
    out.push(checkRow(model) + '<label for="tfcc-author">Only flag new posts by the thread author</label>'
      // #45 (owner): a one-line hover summary. The checkbox's name stays its
      // label; the title is only its description.
      + '<input id="tfcc-author" type="checkbox" data-act="author-only" title="'
      + escapeHtml('Only show new when the thread\'s author posts, not other people\'s replies') + '"'
      + (model.settings.authorOnly ? ' checked' : '') + '></div>');
    // Shown whether the setting is on or off, so the limits are read first.
    // #45 (owner): it leads with what the setting does for the user.
    var authorText = 'With this on, a thread in Threads and Catch up is flagged new only when its author posts, '
      + 'so replies and comments from other people do not mark it new. This suits threads where you follow the '
      + 'author\'s updates, such as guides, scripts and announcements. It counts the author\'s posts since you '
      + 'last looked. Each activity lookup then reads the thread\'s posts since '
      + 'you last looked, ' + POSTS_PER_PAGE + ' at a time, newest first, instead of its last-post time. '
      + 'Each page is one lookup from the same allowance, so the cost does not change: with your setting of '
      + model.settings.enrichBudget + ', a Threads refresh is at most ' + (3 + model.settings.enrichBudget)
      + ' requests a refresh, on or off. A thread gets at most ' + AUTHOR_MAX_PAGES + ' pages, and only once '
      + 'every other thread has had its first. With more new posts than that, a count shows as a minimum '
      + '(N+), or as "not checked (too many new)" when none of the posts read is by the author. Threads not '
      + 'checked yet show "not checked". My posts ignores this setting. Posts from before you started using '
      + 'this script are not flagged, and edits are not detected.';
    out.push('<div class="tfcc-infobar"><span class="tfcc-note">'
      + escapeHtml('Costs no extra requests. Some threads may show "not checked".') + '</span>'
      + renderInfoButton('settings-author', model.openInfoId) + '</div>');
    out.push(renderInfoText('settings-author', model.openInfoId, authorText));
    out.push('</div>');

    out.push('<div class="tfcc-section"><h4>Appearance</h4>');
    out.push('<div class="tfcc-kv"><label for="tfcc-theme">Theme</label>'
      + '<select id="tfcc-theme" data-act="theme">'
      + THEMES.map(function (t) {
        var label = t === 'match' ? 'Match Torn' : (t.charAt(0).toUpperCase() + t.slice(1));
        return '<option value="' + t + '"' + (model.theme === t ? ' selected' : '') + '>' + label + '</option>';
      }).join('')
      + '</select></div>');
    out.push('<div class="tfcc-kv"><label for="tfcc-rows">Rows shown</label>'
      + '<select id="tfcc-rows" data-act="rows-shown">'
      + ROWS_SHOWN_OPTIONS.map(function (n) {
        return '<option value="' + n + '"' + (model.settings.rowsShown === n ? ' selected' : '') + '>'
          + (n === 0 ? 'All' : String(n)) + '</option>';
      }).join('')
      + '</select></div>');
    var cappedNames = CAPPED_VIEWS.map(function (v) { return VIEW_LABELS[v]; });
    out.push('<div class="tfcc-infobar"><span class="tfcc-note">Applies to '
      + escapeHtml(cappedNames.length > 1
        ? cappedNames.slice(0, -1).join(', ') + ' and ' + cappedNames[cappedNames.length - 1]
        : cappedNames.join(''))
      + '.</span>' + renderInfoButton('settings-rows', model.openInfoId) + '</div>');
    out.push(renderInfoText('settings-rows', model.openInfoId, 'Search and Drafts always show everything. '
      + 'A capped list says how many it is hiding, and Show all lifts the cap for that list until the page '
      + 'reloads. The default is 5.'));
    out.push(checkRow(model) + '<label for="tfcc-hide">Hide Torn\'s own subscribed box</label>'
      + '<input id="tfcc-hide" type="checkbox" data-act="hide-torn-box"'
      + (model.settings.hideTornBox ? ' checked' : '') + '></div>');
    out.push(checkRow(model) + '<label for="tfcc-autosave">Autosave the reply box as a draft</label>'
      + '<input id="tfcc-autosave" type="checkbox" data-act="autosave"'
      + (model.settings.autosaveDrafts ? ' checked' : '') + '></div>');
    out.push('<div class="tfcc-kv"><label for="tfcc-draftlang">Default editor for new drafts</label>'
      + '<select id="tfcc-draftlang" data-act="draft-lang">'
      + [['md', 'Markdown'], ['html', 'HTML'], ['text', 'Text']].map(function (o) {
        return '<option value="' + o[0] + '"' + (model.settings.draftLang === o[0] ? ' selected' : '') + '>' + o[1] + '</option>';
      }).join('') + '</select></div>');
    [['tfcc-edh-wide', 'ed-height-wide', 'Editor height (desktop)', model.settings.editorHeightWide],
      ['tfcc-edh-narrow', 'ed-height-narrow', 'Editor height (phone)', model.settings.editorHeightNarrow]].forEach(function (r) {
      out.push('<div class="tfcc-kv"><label for="' + r[0] + '">' + r[2] + '</label>'
        + '<select id="' + r[0] + '" data-act="' + r[1] + '">'
        + EDITOR_HEIGHT_LABELS.map(function (o) {
          return '<option value="' + o[0] + '"' + (r[3] === o[0] ? ' selected' : '') + '>' + o[1] + '</option>';
        }).join('') + '</select></div>');
    });
    out.push(checkRow(model) + '<label for="tfcc-autohide">Hide the panel when I open a thread</label>'
      + '<input id="tfcc-autohide" type="checkbox" data-act="auto-hide"'
      + (model.settings.autoHideOnOpen ? ' checked' : '') + '>'
      + renderInfoButton('settings-autohide', model.openInfoId) + '</div>');
    out.push(renderInfoText('settings-autohide', model.openInfoId, 'Only thread links in this panel do this, '
      + 'and only a plain click. Opening a link in a new tab, or following links on the Torn page itself, '
      + 'leaves the panel as it is. Press Show to bring it back.'));
    // #41: on by default. A class on the panel switches the CSS (tfcc-clip).
    out.push(checkRow(model) + '<label for="tfcc-clip">Clip titles and summaries that wrap</label>'
      + '<input id="tfcc-clip" type="checkbox" data-act="clip-lines"'
      + (model.settings.clipLines ? ' checked' : '') + '>'
      + renderInfoButton('settings-clip', model.openInfoId) + '</div>');
    out.push(renderInfoText('settings-clip', model.openInfoId, 'Each row\'s title and summary stay on one line, '
      + 'ending in ... when they would wrap. On a phone, open a row\'s actions to read it whole; on a wider '
      + 'screen, hover over it. Turn this off to let them wrap.'));
    // #43 (owner): on by default. A class on the panel switches the CSS
    // (tfcc-seethrough).
    out.push(checkRow(model) + '<label for="tfcc-seethrough">See-through background</label>'
      + '<input id="tfcc-seethrough" type="checkbox" data-act="see-through"'
      + (model.settings.seeThrough ? ' checked' : '') + '>'
      + renderInfoButton('settings-seethrough', model.openInfoId) + '</div>');
    out.push(renderInfoText('settings-seethrough', model.openInfoId, 'The panel shows Torn\'s page through it. '
      + 'Text can be harder to read over a busy page, or one much lighter or darker than the panel. '
      + 'Turn this off to make the panel solid.'));
    out.push('</div>');

    out.push('<div class="tfcc-section"><div class="tfcc-infobar"><h4>Folders</h4>'
      + renderInfoButton('settings-folders', model.openInfoId) + '</div>');
    // #45 (owner): what a folder is, how to use one, and why it helps. Each
    // claim is the code's: applyAutoAssign files a subscription with no folder
    // into the folder claiming its forum, a hand filing is never moved, Catch
    // up groups by folder in the order (groupCatchUp), the Threads folder
    // filter, encodeState, and the First folder badge (ownFoldersFilled).
    out.push(renderInfoText('settings-folders', model.openInfoId, ''
      + 'Folders organize only threads you subscribe to (and ones you file by hand); they never add other threads '
      + 'from a forum. To use them: add a folder below; optionally claim one or more forums, so new subscriptions '
      + 'from them file themselves into it; a forum belongs to one folder at a time, and removing a claim leaves '
      + 'the threads already filed where they are; or file a thread from the folder menu on its row. Filing by '
      + 'hand always '
      + 'wins over a claim. The arrows set the order, Unfiled included. This helps because Catch up groups threads '
      + 'with new posts by folder, in that order, so the ones you care about most come first, and a group you do '
      + 'not need right now collapses out of the way; Threads can also be filtered to one folder. Folders stay on '
      + 'this device and travel in the export. With badges on, filing a thread in a folder of your own earns the '
      + 'First folder badge.'));
    // #45: one list in the user's order, Unfiled included. Unfiled moves but
    // is built in: no delete, no rename, no forum claim.
    var orderKeys = folderOrderKeys({ folders: model.folders, unfiledAt: model.unfiledAt });
    var byId = {};
    var claimed = {};
    model.folders.forEach(function (x) {
      byId[x.id] = x;
      x.forumIds.forEach(function (n) { claimed[n] = true; });
    });
    var forumTitles = {};
    model.categories.forEach(function (cat) { forumTitles[cat.id] = cat.title; });
    for (var i = 0; i < orderKeys.length; i += 1) {
      var unf = orderKeys[i] === UNFILED_KEY;
      var f = unf ? { id: UNFILED_KEY, name: 'Unfiled' } : byId[folderIdOfKey(orderKeys[i])];
      // #47 (owner): narrow, Unfiled is one line: its note sits under its
      // name, inside the label, beside the arrows. Wide keeps main's markup.
      var unfNote = '<span class="tfcc-note">Threads in no folder</span>';
      out.push('<div class="tfcc-kv tfcc-forder"><label>' + escapeHtml(f.name) + (unf && model.narrow ? unfNote : '')
        + '</label>');
      out.push(moveButton(orderKeys[i], f.name, 'up', i === 0) + moveButton(orderKeys[i], f.name, 'down', i === orderKeys.length - 1));
      if (unf) {
        out.push((model.narrow ? '' : unfNote) + '</div>');
        continue;
      }
      // #47: each claimed forum is a chip with its own remove button, and the
      // menu adds one more claim. It offers only the forums no folder claims,
      // because a forum belongs to one folder at a time (claimForum).
      var claimHtml = [];
      if (f.forumIds.length) {
        claimHtml.push('<span class="tfcc-claims">');
        for (var q = 0; q < f.forumIds.length; q += 1) {
          var forumName = forumTitles[f.forumIds[q]] || ('Forum ' + f.forumIds[q]);
          var rm = 'Remove ' + forumName;
          claimHtml.push('<span class="tfcc-claim">' + escapeHtml(forumName) + '<button type="button" class="tfcc-unclaim"'
            + ' data-act="folder-unclaim" data-id="' + escapeHtml(f.id) + '" data-forum="' + f.forumIds[q] + '"'
            + ' aria-label="' + escapeHtml(rm) + '" title="' + escapeHtml(rm) + '">' + glyph('close') + '</button></span>');
        }
        claimHtml.push('</span>');
      }
      claimHtml.push('<select data-act="folder-forum" data-id="' + escapeHtml(f.id) + '" aria-label="'
        + escapeHtml('Claim a forum for ' + f.name) + '">');
      claimHtml.push('<option value="">Claim a forum...</option>');
      for (var c = 0; c < model.categories.length; c += 1) {
        var cat = model.categories[c];
        if (claimed[cat.id]) continue;
        claimHtml.push('<option value="' + cat.id + '">' + escapeHtml(cat.title) + '</option>');
      }
      claimHtml.push('</select>');
      // Narrow, Delete is a named 44px bin icon, so the name, both arrows and
      // Delete share one line down to a 280px phone. Wide keeps the word.
      var delName = 'Delete ' + f.name;
      var delHtml = model.narrow
        ? '<button type="button" data-act="folder-delete" data-id="' + escapeHtml(f.id) + '" class="tfcc-danger tfcc-del"'
          + ' aria-label="' + escapeHtml(delName) + '" title="' + escapeHtml(delName) + '">' + glyph('trash') + '</button>'
        : btn('folder-delete', 'Delete', ' data-id="' + escapeHtml(f.id) + '" class="tfcc-danger"');
      // #47 (owner): narrow, a folder row is two lines: the name, the arrows
      // and Delete; then the chips and the claim menu, in their own line.
      // Wide keeps main's order.
      if (model.narrow) out.push(delHtml + '<span class="tfcc-claimline">' + claimHtml.join('') + '</span>');
      else out.push(claimHtml.join('') + delHtml);
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
    out.push('<p class="tfcc-note">Never includes your API key or the post cache.</p>');
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
    out.push('<p class="tfcc-note">Never includes your key, drafts, notes or post text.</p>');
    out.push('</div>');

    out.push(renderBadgeCatalogue(model));

    out.push('<p class="tfcc-note">Torn Forum Command Center ' + escapeHtml(model.version)
      + '. Reads only. It never posts, replies, subscribes or changes anything on your account.</p>');
    return out.join('');
  }

  // The karma figure (#10): the owner's endless-knot icon (currentColor, so it
  // follows the theme) and a number. No visible word; the span carries the
  // meaning for assistive tech and the tooltip. The wording follows the Torn
  // wiki's Karma page (spec, "Karma definition").
  var KARMA_MEANING = '. Likes and dislikes on your forum posts, never below 0; some posts do not count.';
  function renderKarma(karma) {
    var n = formatKarma(karma);
    var title = 'Karma: ' + (n === '-' ? 'unknown' : n) + KARMA_MEANING;
    return '<span class="tfcc-karma" role="group" aria-label="Karma" title="' + escapeHtml(title) + '">'
      + KARMA_ICON_SVG + '<span class="tfcc-rx">' + escapeHtml(n) + '</span></span>';
  }

  // The thumbs in the reactions pill (#30). The owner asked for these emoji,
  // which overrides the ASCII-SVG icon convention for this pill only. They are
  // escapes so the source stays ASCII (Torn PDA rewrites typographic
  // characters), aria-hidden because the pill's aria-label says "up" and
  // "down", and drawn monochrome by the .tfcc-thumb filter rules.
  var THUMB_UP = '\uD83D\uDC4D';
  var THUMB_DOWN = '\uD83D\uDC4E';
  function thumb(glyph) {
    return '<span class="tfcc-thumb" aria-hidden="true">' + glyph + '</span>';
  }

  // The thread reactions pill (#10). Since #30 it sits in the nav row, right
  // before My posts, because it opens My posts; renderNav places it. The nav is
  // drawn after the collapsed early return, so it is hidden when collapsed. Up
  // and down are real topic-post sums; net is labelled. Karma follows them;
  // with no started threads and a known karma, it stands alone.
  function renderReactions(model) {
    var r = model.reactions;
    if (!model.hasKey || !r) return '';
    var karma = isReactionNumber(r.karma, true) ? r.karma : null;
    if (r.state === 'empty' && karma === null) return '';
    var known = r.state === 'known';
    var stale = known && r.stale;
    var rx = function (v) { return '<span class="tfcc-rx">' + escapeHtml(v) + '</span>'; };
    var parts = '';
    var spoken = '';
    if (r.state !== 'empty') {
      if (known && r.thumbThreads > 0) {
        var more = r.netThreads > 0 ? ', net ' + formatSigned(r.net) + ' on ' + r.netThreads + ' more' : '';
        parts = rx(formatCount(r.up)) + ' ' + thumb(THUMB_UP) + ' ' + rx(formatCount(r.down)) + ' ' + thumb(THUMB_DOWN)
          + (r.netThreads > 0 ? ', net ' + rx(formatSigned(r.net)) + ' on ' + r.netThreads + ' more' : '');
        spoken = formatCount(r.up) + ' up, ' + formatCount(r.down) + ' down' + more;
      } else if (known) {
        parts = 'net ' + rx(formatSigned(r.net));
        spoken = 'net ' + formatSigned(r.net);
      } else {
        parts = rx('-') + ' ' + thumb(THUMB_UP) + ' ' + rx('-') + ' ' + thumb(THUMB_DOWN);
        spoken = 'thumbs unknown';
      }
    }
    var age = stale ? ' (' + formatRelativeTime(r.updatedAt, model.now) + ')' : '';
    var title = reactionsTitle(r, model.now, MINE_PAGE_LIMIT);
    var said = (r.state === 'empty' ? '' : 'Your threads: ' + spoken + age + '. ')
      + 'Karma: ' + (karma === null ? 'unknown' : formatKarma(karma)) + '. ';
    var lead = r.state === 'empty' ? '' : parts + escapeHtml(age) + ' ';
    return '<button type="button" class="tfcc-reactions' + (stale ? ' tfcc-stale' : '')
      + '" data-act="view" data-view="mine" title="' + escapeHtml(title) + '" aria-label="'
      + escapeHtml(said + title) + '">' + lead + renderKarma(karma) + '</button>';
  }

  // The narrow reactions pill (#53): the first line of My posts, so it is not
  // a button (it would only open the view it sits in) and has no title (a
  // tooltip does nothing on touch). It shows up, down and karma; an unknown
  // figure is "-". Net moves to the status line (reactionsPending) and to the
  // aria-label, which carries the sentence the nav button speaks. A stale
  // pill keeps tfcc-stale and its visible age, as the button does.
  function renderReactionsPill(model) {
    var r = model.reactions;
    if (!model.hasKey || !r) return '';
    var karma = isReactionNumber(r.karma, true) ? r.karma : null;
    if (r.state === 'empty' && karma === null) return '';
    var known = r.state === 'known';
    var stale = known && r.stale;
    var rx = function (v) { return '<span class="tfcc-rx">' + escapeHtml(v) + '</span>'; };
    var thumbs = known && r.thumbThreads > 0;
    var spoken = 'thumbs unknown';
    if (thumbs) {
      spoken = formatCount(r.up) + ' up, ' + formatCount(r.down) + ' down'
        + (r.netThreads > 0 ? ', net ' + formatSigned(r.net) + ' on ' + r.netThreads + ' more' : '');
    } else if (known) {
      spoken = 'net ' + formatSigned(r.net);
    }
    var age = stale ? '(' + formatRelativeTime(r.updatedAt, model.now) + ')' : '';
    var said = (r.state === 'empty' ? '' : 'Your threads: ' + spoken + (age ? ' ' + age : '') + '. ')
      + 'Karma: ' + (karma === null ? 'unknown' : formatKarma(karma)) + '. ';
    var title = reactionsTitle(r, model.now, MINE_PAGE_LIMIT, 'Refresh');
    var lead = '';
    if (r.state !== 'empty') {
      lead = rx(thumbs ? formatCount(r.up) : '-') + thumb(THUMB_UP)
        + rx(thumbs ? formatCount(r.down) : '-') + thumb(THUMB_DOWN)
        + (age ? '<span class="tfcc-rxage">' + escapeHtml(age) + '</span>' : '')
        + '<span class="tfcc-rxdot" aria-hidden="true">\u2022</span>';
    }
    return '<div class="tfcc-rxpill' + (stale ? ' tfcc-stale' : '') + '" role="group" aria-label="'
      + escapeHtml(said + title) + '">' + lead
      + '<span class="tfcc-karma">' + KARMA_ICON_SVG + rx(formatKarma(karma)) + '</span></div>';
  }

  // The status-line clause for the narrow pill (#53): how many started
  // threads still lack thumbs. Worded "pending" so it is not read as the
  // reply lookups that the same line already calls "not checked yet".
  function reactionsPending(model) {
    var r = model.reactions;
    if (!model.narrow || !model.hasKey || !r) return '';
    if (r.state !== 'known' && r.state !== 'missing') return '';
    var n = r.started - r.thumbThreads;
    if (n <= 0) return '';
    return 'Thumbs pending on ' + n + ' of ' + r.started + ' ' + plural(r.started, 'thread') + ' you started.';
  }

  function renderHeadId(model) {
    return '<div class="tfcc-head-id">' + LOGO_SVG + renderBadgeChip(model) + '</div>';
  }

  // The narrow header (spec 4.1, 13a, 13b): logo, chip and, when collapsed, a
  // bare unread count, then Refresh, Expand/Shrink and Hide as icon buttons
  // that fitHeader sizes. Collapsed, the third button is the visible word Show.
  function renderHeadNarrow(model) {
    var count = '';
    if (model.collapsed && model.totals && model.totals.unread > 0) {
      var n = formatCount(model.totals.unread);
      var said = n + (model.authorOnly ? ' new by author' : ' new');
      // aria-label on a plain span is not reliably read, so the name is a
      // visually hidden span beside an aria-hidden numeral (spec 13a).
      count = '<span class="tfcc-badge tfcc-hcount"><span aria-hidden="true">' + escapeHtml(n) + '</span>'
        + '<span class="tfcc-sr">' + escapeHtml(said) + '</span></span>';
    }
    var out = ['<div class="tfcc-head">'];
    out.push('<div class="tfcc-head-id">' + LOGO_SVG + renderBadgeChip(model) + count + '</div>');
    out.push('<div class="tfcc-head-ctl"><span class="tfcc-head-btns">');
    out.push('<button type="button" class="tfcc-hbtn" data-act="refresh" aria-label="'
      + (model.refreshing ? 'Refreshing" title="Refreshing" aria-busy="true"' : 'Refresh" title="Refresh"') + '>'
      + glyph('refresh') + '</button>');
    out.push('<button type="button" class="tfcc-hbtn" data-act="takeover" aria-pressed="'
      + (model.takeover ? 'true' : 'false') + '" aria-label="' + (model.takeover ? 'Shrink' : 'Expand')
      + '" title="' + (model.takeover ? 'Shrink' : 'Expand') + '">'
      + glyph(model.takeover ? 'shrink' : 'expand') + '</button>');
    if (model.collapsed) {
      out.push('<button type="button" class="tfcc-hshow" data-act="collapse">' + glyph('down') + '<span>Show</span></button>');
    } else {
      out.push('<button type="button" class="tfcc-hbtn" data-act="collapse" aria-label="Hide the panel" title="Hide the panel">'
        + glyph('up') + '</button>');
    }
    out.push('</span></div></div>');
    // Spec 13d item 33: a live status, kept, on its own line so the header
    // stays one line.
    if (model.authorOnly && model.totals && model.totals.unchecked > 0) {
      out.push('<p class="tfcc-note">' + model.totals.unchecked + ' not checked</p>');
    }
    return out.join('');
  }

  function streakWords(s) {
    return s.current + ' ' + plural(s.current, 'day', 'days');
  }

  // One chip: a cup in the best earned tier's color, the count, then the
  // streak. Its children ignore pointer events, because click delegation
  // reads data-act from the event target and an SVG child has none.
  function renderBadgeChip(model) {
    var b = model.badges;
    if (!b || !b.enabled) return '';
    var label = 'Badges: ' + b.earnedCount + ' of ' + b.total + '.';
    var parts = [b.bestTier ? badgeIcon(b.bestTier, 'cup', 16) : badgeIcon('locked', 'cup-outline', 16),
      '<span>' + b.earnedCount + '</span>'];
    if (b.streak.state !== 'none') {
      label += ' Streak ' + streakWords(b.streak)
        + (b.streak.state === 'counted' ? ', today counted.' : ', today not yet.');
      parts.push(badgeIcon('plain', b.streak.state === 'counted' ? 'streak-on' : 'streak-off', 16));
      parts.push('<span>' + b.streak.current + '</span>');
    }
    label += ' Show badges.';
    // #33: narrow, the button is as tall as the header buttons and the pill
    // you see is a child span at most 28px tall (spec 4.1), so nothing overlaps.
    var inner = model.narrow ? '<span class="tfcc-pill">' + parts.join('') + '</span>' : parts.join('');
    return '<button type="button" class="tfcc-chip" data-act="badges-shelf" aria-expanded="'
      + (b.shelfOpen ? 'true' : 'false') + '" aria-label="' + escapeHtml(label) + '">'
      + inner + '</button>';
  }

  function renderBadgeBar(value, target) {
    var pct = target > 0 ? Math.round((Math.min(value, target) / target) * 100) : 0;
    return '<span class="tfcc-bar-track" role="progressbar" aria-valuenow="' + value + '" aria-valuemin="0"'
      + ' aria-valuemax="' + target + '"><span class="tfcc-bar-fill" style="width: ' + pct + '%"></span></span>'
      + '<span class="tfcc-note">' + value + ' / ' + target + '</span>';
  }

  function renderBadgeShelf(model) {
    var b = model.badges;
    if (!b || !b.enabled || !b.shelfOpen) return '';
    var out = ['<div class="tfcc-shelf">'];
    var s = b.streak;
    if (s.state === 'none') out.push('<div>No streak yet. Finish a Torn day with Catch up empty to start one.</div>');
    else if (s.state === 'broken') out.push('<div>Streak 0 Torn days. Best ' + s.best + '.</div>');
    else {
      out.push('<div>Streak ' + s.current + ' Torn ' + plural(s.current, 'day', 'days')
        + (s.state === 'counted' ? ', today counted.' : ', today not yet.') + ' Best ' + s.best + '.</div>');
    }
    if (b.next) {
      out.push('<div class="tfcc-badge-row">Next: ' + escapeHtml(b.next.badge.name) + ' '
        + renderBadgeBar(b.next.value, b.next.target) + '</div>');
    }
    if (b.earnedList.length) {
      out.push('<div class="tfcc-badge-row">');
      for (var i = 0; i < b.earnedList.length && i < 6; i += 1) {
        var e = b.earnedList[i];
        out.push('<span>' + badgeIcon(e.tier, e.glyph, 20, true) + ' ' + escapeHtml(e.name) + '</span>');
      }
      if (b.earnedList.length > 6) out.push('<span class="tfcc-note">+' + (b.earnedList.length - 6) + ' more</span>');
      out.push('</div>');
    }
    out.push('<div class="tfcc-badge-row"><span class="tfcc-note">' + b.earnedCount + ' of ' + b.total
      + ' earned</span>' + btn('badges-all', 'All badges') + '</div>');
    out.push('</div>');
    return out.join('');
  }

  function renderBadgeToast(model) {
    var b = model.badges;
    if (!b || !b.enabled || !b.toast) return '';
    return '<div class="tfcc-toast' + (b.toast.announce ? ' tfcc-toast-new' : '') + '"'
      + (b.toast.announce ? ' role="status"' : '') + '>' + escapeHtml(b.toast.text)
      + ' ' + btn('badges-toast-dismiss', 'Dismiss') + '</div>';
  }

  function panelHtml(model) {
    // #33: in a narrow panel this already is the narrow loading and error
    // header: renderBadgeChip draws the chip's narrow box from model.narrow and
    // .tfcc-narrow scales the logo. There are no controls to add; main's loading
    // and fatal headers have none, and fatal keeps its own Try again.
    var bareHead = '<div class="tfcc-head">' + renderHeadId(model) + '</div>';
    if (model.loading) {
      return bareHead
        + '<div class="tfcc-empty">Loading your subscribed threads...</div>';
    }
    if (model.fatal) {
      return bareHead
        + '<div class="tfcc-error">' + escapeHtml(model.fatal.detail) + '</div>'
        + '<div class="tfcc-actions">' + btn('refresh', 'Try again') + '</div>';
    }

    var out = [];
    if (model.narrow) {
      out.push(renderHeadNarrow(model));
    } else {
      out.push('<div class="tfcc-head">');
      out.push(renderHeadId(model));
      out.push('<div class="tfcc-head-ctl">');
      if (model.totals.unread > 0) {
        out.push('<span class="tfcc-badge">' + formatCount(model.totals.unread)
          + (model.authorOnly ? ' new by author' : ' new') + '</span>');
      }
      if (model.authorOnly && model.totals.unchecked > 0) {
        out.push('<span class="tfcc-note">' + model.totals.unchecked + ' not checked</span>');
      }
      out.push('<span class="tfcc-note">' + model.totals.subscribed + ' subscribed</span>');
      out.push('<span class="tfcc-head-btns">');
      out.push(btn('refresh', model.refreshing ? 'Refreshing...' : 'Refresh'));
      out.push('<button type="button" data-act="takeover" aria-pressed="'
        + (model.takeover ? 'true' : 'false') + '">' + (model.takeover ? 'Shrink' : 'Expand') + '</button>');
      out.push(btn('collapse', model.collapsed ? 'Show' : 'Hide'));
      out.push('</span></div></div>');
    }
    out.push(renderBadgeShelf(model));
    out.push(renderBadgeToast(model));
    out.push(renderLive(model));

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
    if (model.narrow) out.push(renderViewHeading(model));

    if (model.view === 'catchup') out.push(renderCatchUpView(model));
    else if (model.view === 'search') out.push(renderSearchView(model));
    else if (model.view === 'drafts') out.push(renderDraftsView(model));
    // #47: narrow, Settings sits in a wrapper its tighter spacing hangs off,
    // so no other view's sections change. Wide markup is unchanged.
    else if (model.view === 'settings') {
      out.push(model.narrow ? '<div class="tfcc-set">' + renderSettingsView(model) + '</div>' : renderSettingsView(model));
    }
    else if (model.view === 'mine') out.push(renderMineView(model));
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

  // #33: the class the narrow stylesheet hangs off. On our own element only.
  var NARROW_CLASS = 'tfcc-narrow';
  var CLIP_CLASS = 'tfcc-clip';
  var SEETHROUGH_CLASS = 'tfcc-seethrough';

  // The panel's border-box width, or 0 when it cannot be read. Reads only this
  // script's #tfcc-panel (the owner's ADR 0001 ruling, spec section 5).
  function measurePanelWidth(panel) {
    try {
      var r = panel && typeof panel.getBoundingClientRect === 'function' ? panel.getBoundingClientRect() : null;
      return r && typeof r.width === 'number' ? r.width : 0;
    } catch (e) {
      return 0;
    }
  }

  // Crossing the breakpoint closes every disclosure (spec section 6). The
  // class itself is written by renderPanel, so it survives a panel rebuilt
  // from scratch.
  function setNarrow(next) {
    state.narrow = next === true;
    applyTransient({ type: 'breakpoint' });
  }

  // Called by the ResizeObserver. A change of layout redraws, but not forced:
  // a caret in the panel still defers the markup (renderPanel's guard). The
  // class flips at once because renderPanel always writes it.
  function onPanelWidth(doc, win, panel, handlers, width) {
    var next = narrowFor(width, state.narrow);
    if (next === state.narrow) { fitHeader(panel, win); fitCatchUp(panel, win); return; }
    setNarrow(next);
    if (panel && panel.classList) panel.classList.toggle(NARROW_CLASS, state.narrow);
    draw(doc, win, handlers);
    fitHeader(panel, win);
    fitCatchUp(panel, win);
  }

  var resizeWatch = null;

  // One observer, on the panel this script created, set up beside the
  // delegated listener. Without ResizeObserver (Chrome < 64, iOS < 13.4) the
  // per-render measurement in renderPanel is the whole mechanism.
  function watchPanelWidth(doc, win, panel, handlers) {
    if (resizeWatch && resizeWatch.panel === panel) return true;
    if (resizeWatch) {
      try { resizeWatch.ro.disconnect(); } catch (e) { /* already gone */ }
      resizeWatch = null;
    }
    if (typeof ResizeObserver !== 'function') return false;
    try {
      var ro = new ResizeObserver(function (entries) {
        try {
          var entry = entries && entries[0];
          var box = entry && entry.borderBoxSize;
          box = box && (box[0] || box);
          var width = box && typeof box.inlineSize === 'number' ? box.inlineSize : measurePanelWidth(panel);
          onPanelWidth(doc, win, panel, handlers, width);
        } catch (e2) { /* a resize must never throw onto the page */ }
      });
      ro.observe(panel);
      resizeWatch = { panel: panel, ro: ro };
      return true;
    } catch (e3) {
      return false;
    }
  }

  function setHeaderSize(panel, size) {
    if (!panel.style || typeof panel.style.setProperty !== 'function') return;
    if (size === null) panel.style.removeProperty('--tfcc-hb');
    else panel.style.setProperty('--tfcc-hb', size + 'px');
  }

  // Sizes the narrow header buttons so the header stays on one line (spec
  // 13b). Reads only nodes inside this script's panel: its content width, the
  // chip and the Show button. Returns the size it set, or null.
  function fitHeader(panel, win) {
    try {
      if (!panel) return null;
      if (!state.narrow) { setHeaderSize(panel, null); return null; }
      var cs = win && typeof win.getComputedStyle === 'function' ? win.getComputedStyle(panel) : null;
      var pad = cs ? (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0) : 0;
      var content = (panel.clientWidth || 0) - pad;
      if (!(content > 0)) return null;
      var chip = panel.querySelector('.tfcc-chip');
      var show = panel.querySelector('.tfcc-hshow');
      // The loading and error headers have no buttons: nothing to fit.
      if (!show && !panel.querySelector('.tfcc-hbtn')) { setHeaderSize(panel, HB_MAX); return HB_MAX; }
      var icons = show ? 2 : 3;
      var width = function (el) {
        var r = el && typeof el.getBoundingClientRect === 'function' ? el.getBoundingClientRect() : null;
        return r && typeof r.width === 'number' ? r.width : 0;
      };
      // Show's padding follows the size, linearly across HB_MIN-HB_MAX, so it
      // is measured at both ends and the solve sees its width at every size.
      var show24 = 0;
      var slope = 0;
      if (show) {
        setHeaderSize(panel, HB_MIN);
        show24 = width(show);
        setHeaderSize(panel, HB_MAX);
        slope = (width(show) - show24) / (HB_MAX - HB_MIN);
      }
      // The collapsed bare count (spec 13a) shares the line with the logo.
      var countW = width(panel.querySelector('.tfcc-hcount'));
      var solve = function (withCount) {
        return headerButtonSize(content, width(chip), show24, icons, withCount ? countW : 0, slope);
      };
      if (chip && chip.classList) chip.classList.remove('tfcc-compact');
      var r = solve(true);
      if (r.size < HB_COMPACT_BELOW && chip && chip.classList) {
        chip.classList.add('tfcc-compact');
        r = solve(true);
      }
      // Last resort (spec 13b): when even HB_MIN cannot hold the count, the
      // count wraps under the logo and the buttons are sized without it.
      if (!r.fits && countW > 0) r = solve(false);
      setHeaderSize(panel, r.size);
      return r.size;
    } catch (e) {
      return null;
    }
  }

  // Keeps the narrow Catch up action row on one line (#39). Like fitHeader it
  // runs after every draw and on every resize, and reads only this script's
  // own nodes: the bar's width and its three controls, measured with each
  // label set. The choice is a class on the panel, so it survives the next
  // innerHTML rewrite. Returns the mode it set, or null.
  var CU_SHORT_CLASS = 'tfcc-cu-short';
  var CU_WRAP_CLASS = 'tfcc-cu-wrap';

  function fitCatchUp(panel, win) {
    try {
      if (!panel || !panel.classList) return null;
      // 'wrap' uses the short labels too, so it carries both classes.
      var setMode = function (m) {
        panel.classList.toggle(CU_SHORT_CLASS, m !== 'full');
        panel.classList.toggle(CU_WRAP_CLASS, m === 'wrap');
      };
      // The bar's controls, by their own data-act: markall renders only here.
      var mark = state.narrow ? panel.querySelector('button[data-act="markall"]') : null;
      if (!mark) { setMode('full'); return null; }
      var ctl = [mark, panel.querySelector('button[data-act="catchup-done"]'),
        panel.querySelector('button[data-info="catchup"]')];
      var bar = panel.querySelector('.tfcc-cubar');
      var content = bar && bar.clientWidth > 0 ? bar.clientWidth : 0;
      if (!(content > 0)) {
        var cs = win && typeof win.getComputedStyle === 'function' ? win.getComputedStyle(panel) : null;
        var pad = cs ? (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0) : 0;
        content = (panel.clientWidth || 0) - pad;
      }
      if (!(content > 0)) return null;
      var widths = function () {
        return ctl.map(function (el) {
          var r = el && typeof el.getBoundingClientRect === 'function' ? el.getBoundingClientRect() : null;
          return r && typeof r.width === 'number' ? r.width : 0;
        });
      };
      setMode('full');
      var full = widths();
      setMode('short');
      var mode = catchUpLabelMode(content, full, widths());
      setMode(mode);
      return mode;
    } catch (e) {
      return null;
    }
  }

  // #33, spec section 6 "Dirty inputs": a redraw held while a press that began
  // in the panel is in progress is flushed by the click, a pointercancel, or
  // this long after the pointer lifts with no click. Nothing is flushed while
  // the pointer is still down, so a slow tap keeps its target.
  var PRESS_FLUSH_MS = 300;
  var pressTimer = null;
  var pressWinBound = false;
  // #58 round 2: a keydown in the draft field already decided this Enter, so
  // the beforeinput of the same press is not handled twice.
  var draftEnterDecided = false;

  // #58 B1: a tap anywhere in the Preview edits there. The nearest preview
  // block above the tapped node (a paragraph, a bold run, an image inside
  // it), else the preview area itself (its empty space: the end of the
  // text). A link inside the preview is left to the browser. Our own nodes
  // only, and only for a tap no data-act claimed, so every other control
  // keeps exact-target delegation.
  var PREVIEW_TAP_MAX_DEPTH = 16;
  function hasClassName(n, c) {
    if (n.classList && typeof n.classList.contains === 'function') return n.classList.contains(c);
    var cls = typeof n.getAttribute === 'function' ? n.getAttribute('class') : null;
    return (' ' + String(cls || '') + ' ').indexOf(' ' + c + ' ') !== -1;
  }
  function previewTapOf(node, panel) {
    var n = node;
    for (var i = 0; n && i < PREVIEW_TAP_MAX_DEPTH; i += 1) {
      if (n === panel) return null;
      if (String(n.tagName || '').toUpperCase() === 'A') return null;
      if (hasClassName(n, 'tfcc-pv-block') || hasClassName(n, 'tfcc-pv')) return n;
      n = n.parentNode;
    }
    return null;
  }

  // #58 B5: the height the player dragged the draft textarea to. Measured on
  // the panel's own textarea (never Torn's markup) when a press over it ends
  // at a different height than it began; a failed measurement keeps the
  // current height.
  function draftFieldOf(panel) {
    try { return panel && typeof panel.querySelector === 'function' ? panel.querySelector('[data-act="draft-text"]') : null; } catch (e) { return null; }
  }
  // #58 round 2: puts an editor edit into the draft textarea in place. Only
  // the changed range is replaced, so a browser with setRangeText keeps its
  // own scroll position; the caret goes where the edit says. This script's
  // own field, never Torn's. False when the field would not take it.
  function writeDraftField(el, before, r) {
    var p = 0;
    var max = Math.min(before.length, r.text.length);
    while (p < max && before.charAt(p) === r.text.charAt(p)) p += 1;
    var q = 0;
    while (q < max - p && before.charAt(before.length - 1 - q) === r.text.charAt(r.text.length - 1 - q)) q += 1;
    try {
      if (typeof el.setRangeText === 'function') el.setRangeText(r.text.slice(p, r.text.length - q), p, before.length - q, 'end');
      if (String(el.value) !== r.text) el.value = r.text;
      if (typeof el.setSelectionRange === 'function') el.setSelectionRange(r.start, r.end);
      return String(el.value) === r.text;
    } catch (e) {
      return false;
    }
  }
  function fieldHeight(el) {
    try {
      var h = el && typeof el.getBoundingClientRect === 'function' ? el.getBoundingClientRect().height : null;
      return typeof h === 'number' && isFinite(h) && h > 0 ? Math.round(h) : null;
    } catch (e) { return null; }
  }
  var editorPressHeight = null;
  function editorPressStart(t) {
    var draft = !!t && typeof t.getAttribute === 'function' && t.getAttribute('data-act') === 'draft-text';
    editorPressHeight = draft ? fieldHeight(t) : null;
  }
  function editorPressEnd(doc) {
    var from = editorPressHeight;
    editorPressHeight = null;
    if (from === null || !state.editor || !state.editor.key) return;
    var h = fieldHeight(draftFieldOf(doc && typeof doc.getElementById === 'function' ? doc.getElementById(PANEL_ID) : null));
    if (h !== null && Math.abs(h - from) >= 2) state.editor.height = h;
  }

  function clearPress() {
    if (pressTimer !== null) { clearTimeout(pressTimer); pressTimer = null; }
    state.pressActive = false;
  }

  function flushAfterPress(doc, win, handlers) {
    if (state.pendingRedraw && !panelHasEditableFocus(doc)) draw(doc, win, handlers, true);
  }

  // Armed only by a pointerup.
  function armPressTimer(doc, win, handlers) {
    if (!state.pressActive) return;
    if (pressTimer !== null) clearTimeout(pressTimer);
    pressTimer = setTimeout(function () {
      pressTimer = null;
      if (!state.pressActive) return;
      clearPress();
      flushAfterPress(doc, win, handlers);
    }, PRESS_FLUSH_MS);
  }

  // The timer is not armed here: a press may last as long as it likes.
  function startPress(doc, win, handlers) {
    if (pressTimer !== null) { clearTimeout(pressTimer); pressTimer = null; }
    state.pressActive = true;
  }

  function endPress(doc, win, handlers) {
    if (!state.pressActive) return;
    clearPress();
    flushAfterPress(doc, win, handlers);
  }

  // #39: true when a click on t keeps the open drawer open: t is that row's
  // toggle (which closes it itself) or anything inside its drawer. Our own
  // nodes only.
  function insideOpenDrawer(panel, t) {
    var id = state.openRowId;
    if (!id || !t) return false;
    try {
      var get = function (k) { return typeof t.getAttribute === 'function' ? t.getAttribute(k) : null; };
      if (get('data-act') === 'row-more' && get('data-id') === id) return true;
      var sel = attrSel('id', 'tfcc-act-' + id);
      var drawer = panel.querySelector(sel);
      return !!(drawer && typeof drawer.contains === 'function' && drawer.contains(t));
    } catch (e) {
      return false;
    }
  }

  // #43: true when a click on t keeps the open popup open: t is inside the
  // popup or is the button that opened it. Our own nodes only.
  function insideOpenEditor(panel, t) {
    var ed = state.openEditor;
    if (!ed || !t) return false;
    try {
      var get = function (k) { return typeof t.getAttribute === 'function' ? t.getAttribute(k) : null; };
      if (get('data-act') === 'editor' && get('data-id') === ed.id && get('data-field') === ed.field) return true;
      var sel = attrSel('id', 'tfcc-ed-' + ed.id);
      var box = panel.querySelector(sel);
      return !!(box && typeof box.contains === 'function' && box.contains(t));
    } catch (e) {
      return false;
    }
  }

  // The popup's Save or Cancel for a key pressed in it, or a stand-in that
  // carries the same row and field when the button cannot be found.
  function editorButtonFor(panel, t, save) {
    var get = function (k) { return t && typeof t.getAttribute === 'function' ? t.getAttribute(k) : null; };
    var id = get('data-id');
    var field = get('data-field');
    if (field && /-input$/.test(field)) field = field.slice(0, -6);
    var b = null;
    var sel = attrSel('data-act', save ? 'editor-save' : 'editor-cancel') + attrSel('data-id', id);
    try { b = panel.querySelector(sel); } catch (e) { b = null; }
    if (b) return b;
    return { getAttribute: function (k) { return k === 'data-id' ? id : (k === 'data-field' ? field : null); } };
  }

  var clickAwayBound = false;
  var clickAwayCtx = null;

  function closeDrawerFromOutside(ev) {
    try {
      var c = clickAwayCtx;
      if (!c || !state.openRowId) return;
      var panel = c.doc.getElementById(PANEL_ID);
      if (!panel || typeof panel.contains !== 'function') return;
      // Inside the panel, the panel's own click listener decides.
      if (panel.contains(ev && ev.target)) return;
      applyTransient({ type: 'dismiss' });
      setTimeout(function () { draw(c.doc, c.win, c.handlers); }, 0);
    } catch (e) { /* a click elsewhere on the page must never throw */ }
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

    // #33: measured on every render, so the first paint is already right and a
    // WebView without ResizeObserver still condenses. Our own element only.
    var measured = narrowFor(measurePanelWidth(panel), state.narrow);
    if (measured !== state.narrow) {
      setNarrow(measured);
      model.narrow = state.narrow;
      model.openRowId = null; model.filtersOpen = false; model.openInfoId = null;
    }
    if (panel.classList) panel.classList.toggle(NARROW_CLASS, state.narrow === true);
    // #41: the clip setting is one class; the loading and error models carry
    // no rows, so they keep whatever the setting says.
    if (panel.classList) panel.classList.toggle(CLIP_CLASS, !state.settings || state.settings.clipLines !== false);
    // #43: the see-through setting is one class too.
    if (panel.classList) panel.classList.toggle(SEETHROUGH_CLASS, !state.settings || state.settings.seeThrough !== false);

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
      watchPanelWidth(doc, win, panel, handlers);
      panel.addEventListener('click', function (ev) {
        var t = ev && ev.target;
        // The press this click ends is over before its action runs, so the
        // action's own redraw also renders anything held during the press.
        var pressed = state.pressActive === true;
        if (pressed) clearPress();
        // #39: a tap anywhere but the open drawer and its toggle closes the
        // drawer, and then still does its own job below. The state closes at
        // once, so an action that redraws renders it closed in its own single
        // redraw (another row's toggle, a nav cell). The closing redraw itself
        // waits until after dispatch, for every target: the tapped node must
        // still be in the DOM while its native default action runs (a field
        // taking focus, a select opening, a label activating its control, a
        // link being followed). Not forced, so a caret in the panel defers it
        // (PR #40 review).
        if (state.openRowId && !insideOpenDrawer(panel, t)) {
          applyTransient({ type: 'dismiss' });
          setTimeout(function () { draw(doc, win, handlers); }, 0);
        }
        // #43: a tap outside the open tag or note popup (and its own button)
        // closes it, the same way and with the same deferred redraw. What was
        // typed stays in the mirror for when it is opened again.
        if (state.openEditor && !insideOpenEditor(panel, t)) {
          state.openEditor = nextEditor(state.openEditor, { type: 'close' });
          setTimeout(function () { draw(doc, win, handlers); }, 0);
        }
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
          // Never redraw inside the click that follows a link: the anchor must
          // still be there when the browser acts on it. onThreadLink's own
          // zero-delay redraw usually renders the held change; this covers a
          // click that does not auto-hide.
          if (pressed) setTimeout(function () { flushAfterPress(doc, win, handlers); }, 0);
          return;
        }
        var act = t && t.getAttribute ? t.getAttribute('data-act') : null;
        if (!act) {
          var pvTap = previewTapOf(t, panel);
          if (pvTap) { act = 'ed-jump'; t = pvTap; }
        }
        // A held redraw is flushed after dispatch too, never inside the click:
        // an action that redraws has already rendered it (pressed was cleared
        // above), so the flush only matters for a tap with no redraw of its own,
        // which is exactly a native control (field, select, label) whose node
        // must survive its click (PR #40 review).
        var flushLater = function () {
          if (pressed) setTimeout(function () { flushAfterPress(doc, win, handlers); }, 0);
        };
        if (!act || typeof handlers.onAction !== 'function') {
          flushLater();
          return;
        }
        // #33: the plan is captured before the action runs, from the rows the
        // user was looking at, and consumed by the action's own redraw.
        state.focusIntent = focusPlan(focusTargetOf(t), lastRender);
        try { handlers.onAction(act, t); } finally { state.focusIntent = null; }
        flushLater();
      });
      panel.addEventListener('change', function (ev) {
        var t = ev && ev.target;
        var act = t && t.getAttribute ? t.getAttribute('data-act') : null;
        if (!act || typeof handlers.onChange !== 'function') return;
        // A text field commits on blur, when the browser still reports it as
        // focused although focus is already on its way to the next control.
        // Its commit redraws a tick later, from wherever focus landed, and
        // never pulls focus back into the field (plan review). A select or a
        // checkbox keeps focus, so it brings its own plan.
        var text = isTextField(t);
        if (!text) state.focusIntent = focusPlan(focusTargetOf(t), lastRender);
        state.deferCommit = text;
        try { handlers.onChange(act, t); } finally { state.focusIntent = null; state.deferCommit = false; }
      });
      // #43: in the tag or note popup, Enter saves and Escape cancels.
      // #58 round 2: in the draft field, Enter keeps paragraphs (editorEnter).
      // A real key on this script's own textarea, never a synthetic event; the
      // browser's newline is cancelled only when the editor makes the edit.
      // A phone keyboard (Gboard) often reports Enter as keyCode 229, so the
      // field's beforeinput line break is handled too. A keydown that already
      // decided an Enter (handled, or left to the browser) marks it, and the
      // beforeinput that follows the same press is then left alone.
      panel.addEventListener('keydown', function (ev) {
        var t = ev && ev.target;
        var act = t && t.getAttribute ? t.getAttribute('data-act') : null;
        if (act === 'draft-text') {
          draftEnterDecided = false;
          // An IME's Enter accepts a candidate; Ctrl, Cmd or Alt+Enter is not typing.
          if (ev.isComposing === true || ev.keyCode === 229) return;
          if (ev.key !== 'Enter') return;
          draftEnterDecided = true;
          if (ev.ctrlKey || ev.metaKey || ev.altKey) return;
          if (typeof handlers.onDraftEnter !== 'function') return;
          if (handlers.onDraftEnter(t, ev.shiftKey === true) && typeof ev.preventDefault === 'function') ev.preventDefault();
          return;
        }
        // Enter in the fixer's Image link field runs Check, as pressing Check
        // does; it never reaches the draft's Enter. The field is read first,
        // so the check uses what is on screen.
        if (act === 'ed-fix-url') {
          if (ev.isComposing === true || ev.keyCode === 229) return;
          if (ev.key !== 'Enter' || ev.ctrlKey || ev.metaKey || ev.altKey || ev.shiftKey) return;
          if (typeof handlers.onAction !== 'function') return;
          if (typeof ev.preventDefault === 'function') ev.preventDefault();
          if (typeof handlers.onInput === 'function') handlers.onInput('ed-fix-url', t);
          handlers.onAction('ed-fix-check', t);
          return;
        }
        if (act !== 'editor-input' && act !== 'editor-save' && act !== 'editor-cancel') return;
        // PR #44 review: during IME composition Enter accepts a candidate and
        // Escape dismisses it; neither is meant for the popup.
        if (ev.isComposing === true || ev.keyCode === 229) return;
        var key = ev.key;
        if (key !== 'Escape' && key !== 'Esc' && !(key === 'Enter' && act === 'editor-input')) return;
        if (typeof handlers.onAction !== 'function') return;
        if (typeof ev.preventDefault === 'function') ev.preventDefault();
        handlers.onAction(key === 'Enter' ? 'editor-save' : 'editor-cancel', editorButtonFor(panel, t, key === 'Enter'));
      });
      panel.addEventListener('beforeinput', function (ev) {
        var t = ev && ev.target;
        var act = t && t.getAttribute ? t.getAttribute('data-act') : null;
        if (act !== 'draft-text') return;
        if (ev.inputType !== 'insertLineBreak' && ev.inputType !== 'insertParagraph') return;
        if (draftEnterDecided) { draftEnterDecided = false; return; }
        if (typeof handlers.onDraftEnter !== 'function') return;
        if (handlers.onDraftEnter(t, false) && typeof ev.preventDefault === 'function') ev.preventDefault();
      });
      panel.addEventListener('keyup', function (ev) {
        var t = ev && ev.target;
        if (t && t.getAttribute && t.getAttribute('data-act') === 'draft-text') draftEnterDecided = false;
      });
      panel.addEventListener('input', function (ev) {
        var t = ev && ev.target;
        var act = t && t.getAttribute ? t.getAttribute('data-act') : null;
        if (!act || typeof handlers.onInput !== 'function') return;
        handlers.onInput(act, t);
      });
      panel.addEventListener('pointerdown', function () { startPress(doc, win, handlers); });
      panel.addEventListener('pointerup', function () { armPressTimer(doc, win, handlers); });
      // #58 B2: the draft textarea's selection is mirrored whenever it can
      // change without typing (a drag, a double-click, Shift+arrows, Select
      // all), so a toolbar action after any redraw uses the highlighted range.
      // B5: a press that began on the textarea and ends at another height was
      // a resize.
      ['pointerdown', 'mousedown', 'touchstart'].forEach(function (type) {
        panel.addEventListener(type, function (ev) { editorPressStart(ev && ev.target); });
      });
      ['select', 'selectionchange', 'keyup', 'mouseup', 'pointerup', 'touchend'].forEach(function (type) {
        panel.addEventListener(type, function (ev) {
          var t = ev && ev.target;
          if (type === 'mouseup' || type === 'pointerup' || type === 'touchend') editorPressEnd(doc);
          var act = t && t.getAttribute ? t.getAttribute('data-act') : null;
          if (act !== 'draft-text' || typeof handlers.onSelect !== 'function') return;
          handlers.onSelect(act, t);
        });
      });
      panel.addEventListener('pointercancel', function () { endPress(doc, win, handlers); });
      // A pointer that lifts outside the panel (a mouse dragged off it) must
      // still end the press, or redraws would be held forever. This listens to
      // an event on the window; it reads no Torn markup (ADR 0001).
      if (!pressWinBound && win && typeof win.addEventListener === 'function') {
        pressWinBound = true;
        win.addEventListener('pointerup', function () { armPressTimer(doc, win, handlers); }, true);
        // #58 B5: a textarea resize dragged off the panel ends there too.
        win.addEventListener('pointerup', function () { editorPressEnd(doc); }, true);
      }
      // #39: a click outside the panel closes an open drawer. One capture-phase
      // listener on the window, bound once. It only asks whether the target is
      // inside this script's own #tfcc-panel: it reads no Torn markup (ADR
      // 0001), never cancels or stops the event, and redraws only our panel,
      // after dispatch, so Torn's own link still does its job.
      clickAwayCtx = { doc: doc, win: win, handlers: handlers };
      if (!clickAwayBound && win && typeof win.addEventListener === 'function') {
        clickAwayBound = true;
        win.addEventListener('click', function (ev) { closeDrawerFromOutside(ev); }, true);
      }
      // An update deferred while the user was typing has to arrive eventually.
      // Waiting a tick lets focus settle first, so this does not fire while the
      // caret is simply moving from one field to the next.
      panel.addEventListener('focusout', function () {
        if (!state.pendingRedraw) return;
        setTimeout(function () {
          if (!state.pendingRedraw) return;
          // A press in progress flushes on its own click (#33).
          if (state.pressActive) return;
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
        mineThreads: state.mine.threads.length,
        mineStarted: state.mine.threads.filter(function (t) { return t.started; }).length,
        minePosted: state.mine.threads.filter(function (t) { return t.posted; }).length,
        mineUnchecked: state.mine.threads.filter(function (t) { return !t.totalKnown; }).length,
        // Rows the last run dropped for a missing id (#24): counts, never a row.
        mineDroppedThreads: toInt(state.mineDropped.threads, 0),
        mineDroppedPosts: toInt(state.mineDropped.posts, 0),
        // Issue #4: rows Torn cannot answer (too many new) apart from rows
        // simply not reached yet. Counts only, never an author.
        authorUnchecked: state.rows.filter(function (r) { return r.authorState === 'unchecked'; }).length,
        authorTooMany: state.rows.filter(function (r) { return r.authorReason === 'too-many'; }).length,
        // Thread reactions (#10): counts of records only, never a figure.
        mineThumbsChecked: state.mine.threads.filter(function (t) { return t.started && t.topicAt > 0; }).length,
        mineThumbsFound: state.mine.threads.filter(function (t) { return t.started && typeof t.up === 'number'; }).length,
      },
      authorOnly: state.settings.authorOnly === true,
      lastFetchedAt: state.feed.fetchedAt,
      mineFetchedAt: state.mine.fetchedAt,
      // Reason only: a My posts detail can quote Torn's free text.
      mineError: state.mineError ? state.mineError.reason : null,
      lastError: state.lastError ? { reason: state.lastError.reason, detail: state.lastError.detail } : null,
      mounted: state.mounted,
      replyBoxFound: state.replyBoxFound,
      badges: {
        on: state.settings.badges === true,
        earned: Object.keys(state.badges.earned).length,
        current: state.badges.streak.current,
        best: state.badges.streak.best,
        checkinDays: state.badges.checkinDays,
        visits: state.badges.visits,
      },
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
      'badges: ' + (c.badges ? ((c.badges.on ? 'on' : 'off') + ', ' + c.badges.earned + ' earned, streak '
        + c.badges.current + '/' + c.badges.best + ', check-in days ' + c.badges.checkinDays
        + ', focused visits ' + c.badges.visits) : 'none'),
      'my posts threads: ' + c.counts.mineThreads,
      'my posts started: ' + c.counts.mineStarted,
      'my posts posted in: ' + c.counts.minePosted,
      'my posts unchecked: ' + c.counts.mineUnchecked,
      'my posts dropped rows: threads ' + c.counts.mineDroppedThreads + ', posts ' + c.counts.mineDroppedPosts,
      'my posts thumbs checked: ' + c.counts.mineThumbsChecked,
      'my posts thumbs found: ' + c.counts.mineThumbsFound,
      'my posts fetched: ' + (c.mineFetchedAt ? 'set' : 'never'),
      'my posts error: ' + (c.mineError ? safeString(c.mineError, 20) : 'none'),
      'author only: ' + (c.authorOnly ? 'on' : 'off'),
      'author unchecked: ' + c.counts.authorUnchecked + ' (too many new: ' + c.counts.authorTooMany + ')',
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

  // #58: Copy puts the formatted post on the clipboard. Pasted into Torn's
  // editor, the marked HTML keeps its styles. Pasted as text, it is the HTML
  // source, ready for Torn's code view. The result is reported only once the
  // clipboard has answered, so the panel never claims a copy that failed.
  function copyPost(doc, win, html, done) {
    var source = htmlSource(html);
    var report = function (ok) { try { if (typeof done === 'function') done({ ok: !!ok }); } catch (e) { /* never */ } };
    var nav = win && win.navigator;
    var clip = nav && nav.clipboard;
    var asText = function () {
      try {
        if (clip && typeof clip.writeText === 'function') {
          var t = clip.writeText(source);
          if (t && typeof t.then === 'function') { t.then(function () { report(true); }, function () { report(false); }); return; }
          report(true);
          return;
        }
      } catch (e) { /* fall through to the textarea path */ }
      report(copyText(doc, win, source).ok);
    };
    try {
      var Item = win && win.ClipboardItem;
      var BlobCtor = win && win.Blob;
      if (clip && typeof clip.write === 'function' && typeof Item === 'function' && typeof BlobCtor === 'function') {
        var item = new Item({
          'text/html': new BlobCtor([PASTE_MARKER + html], { type: 'text/html' }),
          'text/plain': new BlobCtor([source], { type: 'text/plain' }),
        });
        var p = clip.write([item]);
        if (p && typeof p.then === 'function') { p.then(function () { report(true); }, asText); return; }
        report(true);
        return;
      }
    } catch (e2) { /* fall through to plain text */ }
    asText();
  }

  // Every asynchronous redraw goes through here. A refresh takes seconds, and
  // the user can leave the forums in that time; drawing unconditionally would
  // mount the panel onto whatever page they went to.
  function drawIfStillHere(doc, win, handlers) {
    if (!isForumsPage(win.location)) return;
    draw(doc, win, handlers);
  }

  // What the last draw rendered, for the focus plan of the next action: the
  // rows as they were BEFORE the action, so a removed row's successor is known.
  var lastRender = { ids: [], view: 'threads', narrow: false };

  function focusTargetOf(el) {
    var get = function (k) { return el && typeof el.getAttribute === 'function' ? el.getAttribute(k) : null; };
    return { act: get('data-act'), id: get('data-id'), view: get('data-view'), info: get('data-info') };
  }

  function isTextField(el) {
    var tag = el && el.tagName ? String(el.tagName).toLowerCase() : '';
    if (tag === 'textarea') return true;
    if (tag !== 'input') return false;
    var type = el.getAttribute ? String(el.getAttribute('type') || 'text').toLowerCase() : 'text';
    return type !== 'checkbox' && type !== 'radio';
  }

  // A background redraw restores focus only if it was already inside the
  // panel (spec section 6, focus rule 4): it never pulls focus in.
  function focusPlanFromActive(doc) {
    try {
      var active = doc.activeElement;
      var panel = doc.getElementById(PANEL_ID);
      if (!active || !panel || typeof panel.contains !== 'function' || !panel.contains(active)) return null;
      return focusPlan(focusTargetOf(active), lastRender);
    } catch (e) {
      return null;
    }
  }

  function restoreSelection(el) {
    // #58: the Drafts editor keeps its own selection, so a redraw (a mode
    // switch, a tap in Preview) puts the caret back where it belongs.
    if (typeof el.getAttribute === 'function' && el.getAttribute('data-act') === 'draft-text'
      && typeof el.setSelectionRange === 'function') {
      try { el.setSelectionRange(state.editor.selStart, state.editor.selEnd); } catch (e) { /* not a text field */ }
      return;
    }
    var d = state.drawerEdit;
    if (!d || typeof el.setSelectionRange !== 'function' || typeof el.getAttribute !== 'function') return;
    // #43: the popup's field names its mirror in data-field.
    var f = el.getAttribute('data-act') === 'editor-input' ? el.getAttribute('data-field') : el.getAttribute('data-act');
    if (f !== d.field || el.getAttribute('data-id') !== d.id) return;
    if (d.selStart === null || d.selEnd === null) return;
    try { el.setSelectionRange(d.selStart, d.selEnd); } catch (e) { /* not a text field */ }
  }

  // Tries each selector of the plan inside the panel, in order. Our own nodes
  // only; the selectors use the grammar in the plan's Global Constraints.
  function restoreFocus(panel, plan) {
    if (!panel || !plan || typeof panel.querySelector !== 'function') return null;
    for (var i = 0; i < plan.length; i += 1) {
      var el = null;
      try { el = panel.querySelector(plan[i]); } catch (e) { el = null; }
      if (el && typeof el.focus === 'function') {
        // preventScroll: focus returns to our own control without moving the
        // page. A browser that ignores the option still focuses the element.
        try { el.focus({ preventScroll: true }); } catch (e2) { continue; }
        restoreSelection(el);
        return plan[i];
      }
    }
    return null;
  }

  function announce(text) { state.liveMessage = { text: text, announced: false }; }

  // #47: "Guides now claims API Development." and its opposite, by name.
  function claimAnnouncement(folderId, forumId, verb) {
    var n = toInt(forumId, 0);
    var folder = state.organizer.folders.filter(function (f) { return f.id === folderId; })[0];
    var cat = (state.feed.categories || []).filter(function (c) { return c.id === n; })[0];
    return (folder ? folder.name : 'The folder') + verb + (cat ? cat.title : 'Forum ' + n) + '.';
  }

  // One polite live region, rendered with the panel and announced once, the
  // way the badge toast's role="status" is (spec section 6, focus rule 5).
  // Narrow only, like the rest of the section 6 machinery: desktop markup
  // stays main's.
  function renderLive(model) {
    if (!model.narrow) return '';
    if (!model.live) return '';
    return '<div class="tfcc-sr" role="status" aria-live="polite">' + escapeHtml(model.live) + '</div>';
  }

  function draw(doc, win, handlers, force) {
    var now = Date.now();
    state.route = parseForumRoute(win.location);
    state.replyBoxFound = !!findReplyBox(doc);
    attachAutosave(doc, win);
    var before = doc.getElementById(PANEL_ID);
    var htmlBefore = before ? before.__tfccHtml : undefined;
    // A user action brings its own plan; otherwise follow where focus already is.
    var plan = state.focusIntent || focusPlanFromActive(doc);
    var model = buildPanelModel(now);
    var panel = renderPanel(doc, win, model, handlers, force);
    // Only a rewrite changes what is on screen. A deferred one (a caret in the
    // panel) leaves the old rows in the DOM, so lastRender must keep
    // describing them, or the next action's neighbours would be wrong.
    var rewrote = !!panel && panel.__tfccHtml !== htmlBefore;
    if (rewrote) {
      lastRender = { ids: model.renderedIds || [], view: model.view, narrow: model.narrow === true };
      // Only a rewrite destroys the focused node; an unchanged panel keeps it.
      if (plan) restoreFocus(panel, plan);
    }
    if (state.badgeToast && !state.pendingRedraw) state.badgeToast.announced = true;
    if (state.liveMessage && !state.pendingRedraw) state.liveMessage.announced = true;
    // The chip's width changes with its counts and Show replaces Hide, so the
    // header is re-fitted after every draw, not only on resize.
    fitHeader(panel || doc.getElementById(PANEL_ID), win);
    fitCatchUp(panel || doc.getElementById(PANEL_ID), win);
    state.mounted = true;
  }

  function makeHandlers(doc, win) {
    var commitTimer = null;
    function redraw() {
      // #33: while a press that began in the panel is in progress, a redraw
      // would replace the node under the finger and the tap would never arrive
      // as a click. Hold it; the click, a pointercancel or the timer after
      // pointerup flushes it (spec section 6, dirty inputs).
      if (state.pressActive) { state.pendingRedraw = true; return; }
      // A text field's commit (state.deferCommit, set by the change listener)
      // redraws a tick later, once focus has settled: Tab lands on the next
      // control and the redraw restores focus there; Enter leaves focus in the
      // field and the redraw restores it there.
      if (state.deferCommit) {
        state.pendingRedraw = true;
        if (commitTimer === null) {
          commitTimer = setTimeout(function () {
            commitTimer = null;
            if (state.pendingRedraw) redraw();
          }, 0);
        }
        return;
      }
      draw(doc, win, handlers, true);
    }
    // Work that finishes later (a refresh, My posts, deep search, a key check)
    // lands whenever it lands, maybe while the user is typing. It is not
    // forced, so renderPanel's caret guard defers it exactly as it defers an
    // auto refresh (plan review: a forced completion destroyed the only copy
    // of a half-typed drawer field).
    function quietRedraw() {
      if (state.pressActive) { state.pendingRedraw = true; return; }
      draw(doc, win, handlers, false);
    }

    function idOf(el) { return el && el.getAttribute ? el.getAttribute('data-id') : null; }

    function valueOf(act) {
      var el = null;
      try { el = doc.querySelector('[data-act="' + act + '"]'); } catch (e) { el = null; }
      return el && el.value !== undefined ? String(el.value) : '';
    }

    // #58: the panel's own draft textarea, for the selection at click time.
    // The editor's handlers never call valueOf.
    function editorField() { return draftFieldOf(doc.getElementById(PANEL_ID)); }
    // The textarea the last selection-mirror event (onSelect, onInput) came
    // from. Its live selection is the player's even once focus has moved to a
    // toolbar button.
    var lastSelField = null;
    // Only a focused field's selection, or that of the very field the last
    // mirror event came from, is the player's: a redraw (More, a picker)
    // renders a fresh textarea whose own selection means nothing, and the
    // mirrored one (onSelect) stands (#58 B2).
    function captureSelection() {
      var f = editorField();
      if (!f || typeof f.selectionStart !== 'number') return;
      // The mirror's field counts only while it still holds the mirrored text.
      if (doc.activeElement === f || (f === lastSelField && String(f.value) === state.editor.text)) {
        state.editor.text = String(f.value); state.editor.selStart = f.selectionStart; state.editor.selEnd = f.selectionEnd;
      }
    }
    // A picker's typed value, from the editor state (onInput), never from a
    // document query: Torn's page could hold the same data-act.
    function field(k, d) {
      var f = state.editor.fields || {};
      return Object.prototype.hasOwnProperty.call(f, k) ? f[k] : d;
    }
    function applyEdit(r, now) {
      // Spec 4a: never silently cut, never store past the limit.
      if (r.text.length > DRAFT_MAX_CHARS) { overLimitNotice(r.text.length); redraw(); return; }
      if (r.text !== state.editor.text) pushUndo(state.editor);
      state.editor.text = r.text; state.editor.selStart = r.start; state.editor.selEnd = r.end;
      state.editor.picker = null; state.editor.pickerWarn = null; state.editor.imageCheck = null;
      state.focusIntent = [attrSel('data-act', 'draft-text')];
      if (state.editor.text.trim()) saveEditor(now);
      redraw();
    }

    // #43: the popup's typed text: the field on screen, else the mirror. A
    // read of this script's own panel, never of the document.
    function valueOfEditor(id, field) {
      var el = null;
      try {
        var panel = doc.getElementById(PANEL_ID);
        var sel = attrSel('data-act', 'editor-input') + attrSel('data-id', id) + attrSel('data-field', field + '-input');
        el = panel && typeof panel.querySelector === 'function' ? panel.querySelector(sel) : null;
      } catch (e) { el = null; }
      if (el && el.value !== undefined) return String(el.value);
      var d = state.drawerEdit;
      return d && d.id === id && d.field === field + '-input' ? String(d.value) : '';
    }

    // Every way the view changes goes through here, so the disclosures close
    // with it (spec section 6). Tapping the current view changes nothing.
    // A message belongs to the view it was raised in: a view change clears it.
    function setView(v) {
      if (v !== state.settings.view) { applyTransient({ type: 'view' }); state.notices = []; }
      state.settings.view = v;
    }

    var handlers = {
      // Not an act === case: a thread link is navigation the browser performs,
      // not a control, so tests/handlers.test.js does not pair it.
      onThreadLink: function (link, click) {
        if (!isPlainActivation(click)) return;
        persistFailed = false;
        var next = autoHideSettings(state.settings);
        if (next === state.settings) return;
        // The shelf renders in the collapsed header too; hiding the panel closes it.
        state.badgeShelfOpen = false;
        // replaceSettings closes the disclosures: the panel collapses (spec 6).
        replaceSettings(next);
        persist('settings');
        // Deferred: redrawing now would replace the anchor while its click is
        // still being dispatched. It also covers a click on the thread already
        // open, where no hashchange will ever come.
        setTimeout(function () { if (isForumsPage(win.location)) redraw(); }, 0);
      },
      onAction: function (act, el) {
        // A new action: an earlier failed write no longer holds back its notices.
        persistFailed = false;
        var now = Date.now();
        var id = idOf(el);
        // E2: any action ends a typing burst; the next keystroke starts one.
        state.editor.typingAt = 0;
        if (act === 'refresh') {
          state.notices = [];
          // Refresh refreshes what the user is looking at: My posts runs its own
          // bounded fetch, every other view runs the Threads refresh, never both.
          var run = state.settings.view === 'mine' ? refreshMine(now) : refreshAll(now);
          run.then(function () { if (isForumsPage(win.location)) quietRedraw(); });
          redraw();
          return;
        }
        if (act === 'view') {
          var v = el.getAttribute('data-view');
          if (VIEWS.indexOf(v) !== -1) { setView(v); persist('settings'); }
          // Opening My posts is the user input that pays for it, once per TTL.
          if (v === 'mine' && isKeyShaped(loadApiKey()) && mineIsDue(state.mine, now, MINE_TTL_MS)) {
            refreshMine(now).then(function () { if (isForumsPage(win.location)) quietRedraw(); });
          }
          redraw(); return;
        }
        if (act === 'collapse') {
          state.settings.collapsed = !state.settings.collapsed;
          applyTransient({ type: state.settings.collapsed ? 'collapse' : 'show' });
          persist('settings'); redraw(); return;
        }
        if (act === 'takeover') { state.settings.takeover = !state.settings.takeover; persist('settings'); redraw(); return; }
        if (act === 'unread-only') { state.settings.unreadOnly = !state.settings.unreadOnly; persist('settings'); redraw(); return; }
        if (act === 'rows-toggle') {
          // Only a capped view can be expanded; anything else is ignored, so a
          // stale or forged data-view cannot plant state nothing reads.
          var cv = el && el.getAttribute ? el.getAttribute('data-view') : null;
          if (CAPPED_VIEWS.indexOf(cv) !== -1) state.showAll[cv] = state.showAll[cv] !== true;
          redraw(); return;
        }

        if (act === 'info') {
          // Only a known key; a forged one plants no state (spec 13d).
          var infoKey = el && el.getAttribute ? el.getAttribute('data-info') : null;
          if (Object.prototype.hasOwnProperty.call(INFO_KEYS, infoKey)) applyTransient({ type: 'info', key: infoKey });
          redraw(); return;
        }

        if (act === 'filters') { applyTransient({ type: 'filters' }); redraw(); return; }

        if (act === 'row-more' && id) { applyTransient({ type: 'row-more', id: id }); redraw(); return; }
        // #43: the drawer's Tag and Note popup. Opening moves focus into its
        // field; Save and Cancel return it to the button that opened it.
        if (act === 'editor' && id) {
          var edField = el.getAttribute('data-field');
          state.openEditor = nextEditor(state.openEditor, { type: 'open', id: id, field: edField });
          state.focusIntent = state.openEditor
            ? [attrSel('data-act', 'editor-input') + attrSel('data-id', id)]
            : [attrSel('data-act', 'editor') + attrSel('data-id', id) + attrSel('data-field', edField)];
          redraw(); return;
        }
        if ((act === 'editor-save' || act === 'editor-cancel') && id) {
          var sField = el.getAttribute('data-field');
          if (EDITOR_FIELDS.indexOf(sField) === -1) return;
          if (act === 'editor-save') {
            var typed = valueOfEditor(id, sField);
            if (sField === 'note') {
              var nNext = cloneOrganizer(state.organizer);
              entryOf(nNext, id).note = safeString(typed, 2000);
              state.organizer = nNext;
            } else if (typed.trim()) {
              if (hasTag(state.organizer, id, typed)) announce('Already tagged');
              else state.organizer = addTag(state.organizer, id, typed);
            }
            persist('organizer'); recompute(now);
          }
          if (state.drawerEdit && state.drawerEdit.id === id && state.drawerEdit.field === sField + '-input') state.drawerEdit = null;
          state.openEditor = nextEditor(state.openEditor, { type: 'close' });
          state.focusIntent = [attrSel('data-act', 'editor') + attrSel('data-id', id) + attrSel('data-field', sField)];
          redraw(); return;
        }
        if (act === 'pin' && id) { state.organizer = togglePin(state.organizer, id); persist('organizer'); recompute(now); redraw(); return; }
        if (act === 'read' && id) {
          var row = state.rows.filter(function (r) { return r.id === id; })[0];
          state.organizer = markRead(state.organizer, id, row ? row.postsTotal : 0, now);
          persist('organizer'); recompute(now); recordBadgeEvent({ type: 'catchup-changed' }, now);
          announce('Marked read.' + (state.settings.view === 'catchup' ? ' ' + catchUpRowsNow().length + ' left.' : ''));
          redraw(); return;
        }
        if ((act === 'prio-up' || act === 'prio-down') && id) {
          var cur = state.organizer.threads[id] ? state.organizer.threads[id].priority : 0;
          state.organizer = setPriority(state.organizer, id, cur + (act === 'prio-up' ? 1 : -1));
          persist('organizer'); recompute(now); redraw(); return;
        }
        if (act === 'archive' && id) {
          var e = state.organizer.threads[id] || normaliseThreadEntry(null);
          state.organizer.threads[id] = Object.assign({}, e, { archived: !e.archived });
          persist('organizer'); recompute(now); recordBadgeEvent({ type: 'catchup-changed' }, now);
          announce(e.archived ? 'Unarchived.' : 'Archived.');
          redraw(); return;
        }
        if (act === 'markall') {
          for (var i = 0; i < state.rows.length; i += 1) {
            // Catch up's Mark all read covers the Threads population only.
            if (!state.rows[i].inThreads) continue;
            // Author mode: an unchecked thread may hide author posts, so it
            // keeps them rather than being marked read unseen (issue #4).
            if (state.settings.authorOnly === true && state.rows[i].authorState === 'unchecked') continue;
            state.organizer = markRead(state.organizer, state.rows[i].id, state.rows[i].postsTotal, now);
          }
          persist('organizer'); recompute(now); recordBadgeEvent({ type: 'catchup-changed' }, now);
          announce('Marked all read.'); redraw(); return;
        }
        if (act === 'catchup-done') {
          state.organizer.lastCatchUpAt = now; persist('organizer');
          recordBadgeEvent({ type: 'catchup-changed' }, now); redraw(); return;
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
            quietRedraw();
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
          if (res.ok) refreshAll(Date.now()).then(function () { if (isForumsPage(win.location)) quietRedraw(); });
          redraw(); return;
        }
        if (act === 'key-clear') {
          saveApiKey(''); clearKeyRejection(); invalidateInFlight();
          notice('Key cleared.', 'info'); redraw(); return;
        }
        if (act === 'draft' && id) {
          state.draftFocusId = id;
          setView('drafts');
          persist('settings');
          redraw(); return;
        }
        if (act === 'ed-mode') {
          var mode = el.getAttribute('data-mode');
          var ed = state.editor;
          if (ed.mode === 'source') captureSelection();
          // Any mode choice answers a pending Text-switch question.
          ed.confirmText = null;
          if (mode === 'preview') { ed.mode = 'preview'; ed.picker = null; redraw(); return; }
          if (DRAFT_LANGS.indexOf(mode) === -1) return;
          if (mode === ed.lang) { ed.mode = 'source'; redraw(); return; }
          if (mode === 'text' && ed.lang !== 'text' && ed.text.trim()) { ed.confirmText = ed.lang; redraw(); return; }
          var converted = convertDraft(ed.text, ed.lang, mode);
          if (converted.length > DRAFT_MAX_CHARS) { overLimitNotice(converted.length); redraw(); return; }
          pushUndo(ed);
          ed.text = converted;
          ed.lang = mode; ed.mode = 'source'; ed.selStart = ed.selEnd = ed.text.length;
          if (ed.text.trim()) saveEditor(now);
          redraw(); return;
        }
        if (act === 'ed-pv-images') { state.editor.showImages = true; redraw(); return; }
        if (act === 'ed-mode-confirm') {
          var ec = state.editor;
          pushUndo(ec);
          ec.text = convertDraft(ec.text, ec.lang, 'text');
          ec.lang = 'text'; ec.mode = 'source'; ec.confirmText = null; ec.selStart = ec.selEnd = ec.text.length;
          if (ec.text.trim()) saveEditor(now);
          redraw(); return;
        }
        if (act === 'ed-mode-cancel') { state.editor.confirmText = null; redraw(); return; }
        if (act === 'ed-pv-theme') { state.editor.previewTheme = el.getAttribute('data-theme') === 'light' ? 'light' : 'dark'; redraw(); return; }
        if (act === 'ed-jump') {
          // B1: the preview's empty area carries no offset: the end of the text.
          var rawOff = el.getAttribute('data-offset');
          var off = Math.max(0, Math.min(state.editor.text.length, rawOff === null ? state.editor.text.length : toInt(rawOff, 0)));
          state.editor.mode = 'source'; state.editor.selStart = state.editor.selEnd = off;
          state.focusIntent = [attrSel('data-act', 'draft-text')];
          redraw(); return;
        }
        // #58: the toolbar and its pickers. A picker applies to the selection
        // it was opened on; its typed fields come from the editor state.
        var E = state.editor;
        if (act === 'ed-more') { captureSelection(); E.moreOpen = !E.moreOpen; redraw(); return; }
        if (act === 'ed-mark') {
          captureSelection();
          applyEdit(applyMark(E.lang, E.text, E.selStart, E.selEnd, el.getAttribute('data-mark')), now); return;
        }
        if (act === 'ed-quote') { captureSelection(); applyEdit(applyBlockMark(E.lang, E.text, E.selStart, E.selEnd, 'quote'), now); return; }
        if (act === 'ed-picker') {
          captureSelection();
          var which = el.getAttribute('data-picker');
          E.picker = E.picker === which ? null : which; E.pickerWarn = null; E.imageCheck = null;
          redraw(); return;
        }
        if (act === 'ed-picker-close') { E.picker = null; E.pickerWarn = null; E.imageCheck = null; redraw(); return; }
        if (act === 'ed-color') {
          var colV = el.getAttribute('data-value');
          if (colV === 'custom') {
            var hex = String(field('ed-hex-input', '')).trim().toLowerCase();
            if (!/^#([0-9a-f]{3}|[0-9a-f]{6})$/.test(hex)) { notice('Type a color like #ff8800.', 'warn'); redraw(); return; }
            var warns = colorWarnings(hex);
            var warnText = warns.length ? 'This color may be hard to see on Torn\'s ' + warns.map(function (w) { return w.theme; }).join(' and ')
              + ' theme.' : '';
            if (warnText && E.pickerWarn !== warnText) { E.pickerWarn = warnText; redraw(); return; }
            applyEdit(applyMark(E.lang, E.text, E.selStart, E.selEnd, 'color', hex), now); return;
          }
          if (TORN_COLOR_NAMES.indexOf(colV) === -1) return;
          applyEdit(applyMark(E.lang, E.text, E.selStart, E.selEnd, 'color', colV), now); return;
        }
        if (act === 'ed-size') {
          var sz = toInt(el.getAttribute('data-value'), 16);
          if (SIZE_PICKS.indexOf(sz) === -1) return;
          applyEdit(applyMark(E.lang, E.text, E.selStart, E.selEnd, 'size', sz), now); return;
        }
        if (act === 'ed-align') {
          var av = el.getAttribute('data-value');
          if (['left', 'center', 'right', 'justify'].indexOf(av) === -1) return;
          var ar = applyBlockMark(E.lang, E.text, E.selStart, E.selEnd, 'align', av);
          // B4: a Markdown table without a header row has nowhere to keep an
          // alignment; the text stays as it was.
          if (ar.refused) { E.picker = null; notice('Add a header row to align a Markdown table.', 'warn'); redraw(); return; }
          applyEdit(ar, now); return;
        }
        if (act === 'ed-link-apply') {
          var href = safeHref(field('ed-link-input', ''));
          if (!href) { notice('A link needs a full web address, starting with https or http.', 'warn'); redraw(); return; }
          // A Markdown destination ends at ')' or a space: encode them, so a
          // link like a wiki page's Foo_(bar) survives the round trip.
          if (E.lang === 'md') href = href.replace(/\(/g, '%28').replace(/\)/g, '%29').replace(/ /g, '%20');
          applyEdit(applyMark(E.lang, E.text, E.selStart, E.selEnd, 'link', href), now); return;
        }
        if (act === 'ed-img-check') {
          E.imageCheck = fixImageUrl(field('ed-img-url', ''));
          redraw(); return;
        }
        if (act === 'ed-img-insert') {
          var ic = E.imageCheck;
          if (!ic) { notice('Check the image link first.', 'warn'); redraw(); return; }
          if (ic.status !== 'ok' && ic.status !== 'fixed') return;
          applyEdit(insertAtCaret(E.text, E.selStart, E.selEnd, imageSnippet(E.lang, ic.url, String(field('ed-img-alt', '')))), now); return;
        }
        if (act === 'ed-table-insert') {
          var tbl = tableSkeleton(E.lang, toInt(field('ed-cols', 2), 2), toInt(field('ed-rows', 2), 2), field('ed-header', true) !== false);
          applyEdit(insertBlock(E.text, E.selStart, E.selEnd, tbl), now); return;
        }
        if (act === 'ed-emoji-tab') { E.emojiTab = el.getAttribute('data-tab') === 'unicode' ? 'unicode' : 'torn'; redraw(); return; }
        if (act === 'ed-emoji') {
          var ev = el.getAttribute('data-value') || '';
          var snip = /^u[0-9]+$/.test(ev) ? (UNICODE_EMOJI[toInt(ev.slice(1), -1)] || '') : emojiSnippet(E.lang, ev);
          if (!snip) return;
          applyEdit(insertAtCaret(E.text, E.selStart, E.selEnd, snip), now); return;
        }
        if (act === 'ed-fix-open') { captureSelection(); E.fixOpen = !E.fixOpen; if (!E.fixOpen) E.fixCheck = null; redraw(); return; }
        if (act === 'ed-fix-check') { E.fixCheck = fixImageUrl(field('ed-fix-url', '')); redraw(); return; }
        if (act === 'ed-fix-copy') {
          var fc = E.fixCheck;
          if (!fc || (fc.status !== 'ok' && fc.status !== 'fixed')) return;
          var cp = copyText(doc, win, fc.url);
          notice(cp.ok ? 'Link copied.' : 'Copy failed. Select the link above and copy it yourself.', cp.ok ? 'info' : 'warn');
          redraw(); return;
        }
        if (act === 'ed-fix-insert') {
          var fi = E.fixCheck;
          if (!fi) { notice('Check the image link first.', 'warn'); redraw(); return; }
          if (fi.status !== 'ok' && fi.status !== 'fixed') return;
          if (E.lang === 'text') { notice('Switch to Markdown or HTML to add images.', 'warn'); redraw(); return; }
          captureSelection();
          // Preview has no textarea, so the stored caret is stale: the image goes
          // at the end and the editor returns to source so the player sees it.
          if (E.mode === 'preview') { E.selStart = E.text.length; E.selEnd = E.text.length; E.mode = 'source'; }
          applyEdit(insertAtCaret(E.text, E.selStart, E.selEnd, imageSnippet(E.lang, fi.url, '')), now); return;
        }
        if (act === 'ed-fix-all') {
          captureSelection();
          if (E.lang === 'text') { notice('Switch to Markdown or HTML to add images.', 'warn'); redraw(); return; }
          var fx = fixAllImages(E.lang, E.text);
          if (fx.text.length > DRAFT_MAX_CHARS) { overLimitNotice(fx.text.length); redraw(); return; }
          if (fx.text !== E.text) pushUndo(E);
          E.text = fx.text;
          if (fx.changed && E.text.trim()) saveEditor(now);
          var fparts = [];
          if (fx.changed) fparts.push('Fixed ' + fx.changed + ' image link' + (fx.changed === 1 ? '' : 's') + '.');
          if (fx.leftAsLinks) {
            fparts.push(fx.leftAsLinks === 1 ? '1 link was left as a link (not on a line of its own).'
              : fx.leftAsLinks + ' links were left as links (not on a line of their own).');
          }
          notice(fparts.length ? fparts.join(' ') : 'No image links found to fix.', 'info');
          redraw(); return;
        }
        // E2: back one step: the text, mode and selection before the last edit.
        if (act === 'ed-undo') {
          if (!E.undo || !E.undo.length) return;
          var snap = E.undo[E.undo.length - 1];
          E.undo = E.undo.slice(0, -1);
          E.text = snap.text; E.lang = snap.lang; E.selStart = snap.selStart; E.selEnd = snap.selEnd;
          E.mode = 'source'; E.confirmText = null; E.picker = null; E.pickerWarn = null; E.imageCheck = null;
          E.dirty = true;
          state.focusIntent = [attrSel('data-act', 'draft-text')];
          if (E.text.trim()) saveEditor(now);
          redraw(); return;
        }
        // E1 (owner: move): the editor's text and mode become a new free
        // draft, which opens. The thread's stored draft stays as it was; the
        // unsaved typing goes with the free draft, so the editor is left clean
        // and the key switch does not save it into the thread.
        if (act === 'draft-to-free' && id) {
          if (E.key !== id || /^n[0-9]+$/.test(id)) return;
          captureSelection();
          var mf = newFreeDraft(state.drafts, now, E.lang);
          if (!mf.id) { notice('You have ' + FREE_DRAFTS_MAX + ' free drafts. Delete one to make another.', 'warn'); redraw(); return; }
          var mfName = mf.drafts.free[mf.id].name;
          state.drafts = saveFreeDraft(mf.drafts, mf.id, E.text, now, mfName, E.lang);
          E.dirty = false;
          state.draftFocusId = mf.id;
          if (persist('drafts').ok) notice('Saved as ' + mfName + '. The thread draft is unchanged.', 'info');
          recompute(now); redraw(); return;
        }
        if (act === 'draft-new') {
          var made = newFreeDraft(state.drafts, now, state.settings.draftLang);
          if (!made.id) { notice('You have ' + FREE_DRAFTS_MAX + ' free drafts. Delete one to make another.', 'warn'); redraw(); return; }
          state.drafts = made.drafts; persist('drafts');
          state.draftFocusId = made.id;
          redraw(); return;
        }
        if (act === 'draft-edit' && id) { state.draftFocusId = id; setView('drafts'); redraw(); return; }
        if (act === 'draft-save' && id) {
          // Saved only if it stored: an open draft is written now; one not open
          // must still exist.
          if (state.editor.key === id ? !saveEditor(now) : !draftFor(state.drafts, id)) {
            notice('This draft no longer exists. Copy your text, then use + New draft.', 'warn'); redraw(); return;
          }
          recompute(now); notice('Draft saved.', 'info'); redraw(); return;
        }
        if (act === 'draft-delete' && id) {
          if (/^n[0-9]+$/.test(id)) state.drafts = deleteFreeDraft(state.drafts, id);
          else state.drafts = deleteDraft(state.drafts, id);
          if (state.editor.key === id) { state.editor.key = null; if (state.draftFocusId === id) state.draftFocusId = null; }
          persist('drafts'); recompute(now); redraw(); return;
        }
        if (act === 'draft-copy' && id) {
          var cd = state.editor.key === id ? null : draftFor(state.drafts, id);
          copyPost(doc, win, cd ? postHtml(cd.text, draftLangOf(cd)) : editorPostHtml(), function (r) {
            notice(r.ok ? 'Post copied. Paste it into Torn\'s reply box.' : 'Copy failed. Switch to HTML, select the text and copy it yourself.', r.ok ? 'info' : 'warn');
            // The copy finishes later: redraw through the guarded path.
            if (isForumsPage(win.location)) quietRedraw();
          });
          return;
        }
        if (act === 'draft-insert' && id) {
          if (state.editor.key === id && state.editor.text.trim()) saveEditor(now);
          var ins = insertPost(doc, win, editorPostHtml());
          notice(ins.ok ? 'Post inserted. Check it, then press Post.' : (ins.detail || 'Could not insert.'), ins.ok ? 'info' : 'warn');
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
            recordBadgeEvent({ type: 'tick' }, now);
          }
          redraw(); return;
        }
        if ((act === 'folder-up' || act === 'folder-down') && id) {
          var moved = moveFolder(state.organizer, id, act === 'folder-up' ? -1 : 1);
          if (moved !== state.organizer) { state.organizer = moved; persist('organizer'); }
          // Focus stays on the arrow, or on the other one when this one is
          // now disabled at an end.
          var mKeys = folderOrderKeys(state.organizer);
          var mAt = mKeys.indexOf(id);
          var atEnd = act === 'folder-up' ? mAt === 0 : mAt === mKeys.length - 1;
          var mAct = atEnd ? (act === 'folder-up' ? 'folder-down' : 'folder-up') : act;
          state.focusIntent = [attrSel('data-act', mAct) + attrSel('data-id', id)];
          if (mAt !== -1) announce('Moved to ' + (mAt + 1) + ' of ' + mKeys.length + '.');
          redraw(); return;
        }
        if (act === 'group-toggle' && id) {
          // #45: hides or shows a folder group's rows on this device. Nothing
          // about the threads changes, so nothing is recomputed.
          state.organizer = toggleFolderCollapsed(state.organizer, id); persist('organizer');
          redraw(); return;
        }
        if (act === 'folder-unclaim' && id) {
          var forumId = el.getAttribute('data-forum');
          var unclaimed = unclaimForum(state.organizer, id, forumId);
          if (unclaimed !== state.organizer) {
            state.organizer = unclaimed;
            persist('organizer'); recompute(now);
            announce(claimAnnouncement(id, forumId, ' no longer claims '));
          }
          // The chip is gone, so focus goes to the folder's claim menu.
          state.focusIntent = [attrSel('data-act', 'folder-forum') + attrSel('data-id', id)];
          redraw(); return;
        }
        if (act === 'folder-delete' && id) {
          state.organizer = deleteFolder(state.organizer, id); persist('organizer'); recompute(now);
          recordBadgeEvent({ type: 'tick' }, now); redraw(); return;
        }
        if (act === 'export') {
          copyText(doc, win, encodeState(state.organizer, state.drafts, win.btoa ? win.btoa.bind(win) : btoa, state.badges));
          notice('Export copied to the clipboard.', 'info'); redraw(); return;
        }
        if (act === 'import') {
          var out = importState(state.organizer, state.drafts, valueOf('import-text'),
            win.atob ? win.atob.bind(win) : atob, state.badges);
          if (!out.ok) { notice(out.detail, 'error'); redraw(); return; }
          state.organizer = out.organizer; state.drafts = out.drafts;
          if (out.badges) { state.badges = out.badges; persist('badges'); }
          persist('organizer'); persist('drafts'); recompute(now);
          recordBadgeEvent({ type: 'tick' }, now);
          notice('Imported ' + out.summary.addedFolders + ' folders, ' + out.summary.changedThreads
            + ' threads and ' + out.summary.addedDrafts + ' drafts'
            + (out.summary.addedBadges ? ', and ' + out.summary.addedBadges + ' badges' : '') + '.', 'info');
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
          replaceSettings(freshSettings()); state.drawerEdit = null; state.organizer = freshOrganizer(now); state.showAll = {};
          state.drafts = freshDrafts(); state.feed = freshFeed(); state.postCache = freshPostCache();
          state.mine = freshMine(); state.mineError = null; state.mineThrottled = false;
          state.mineDropped = { threads: 0, posts: 0 };
          // A real reset: no backfill, nothing re-awarded until a new event earns it.
          state.badges = freshBadges(); state.badgeShelfOpen = false; state.badgeCatalogueOpen = false;
          state.badgeToast = null; state.dwell = freshDwell();
          // The open editor goes too: its draft is gone, and a dirty one must
          // not be saved back on the next draw or navigation.
          state.draftFocusId = null; loadEditor(null, now);
          persist('settings'); persist('organizer'); persist('drafts'); persist('feed'); persist('postCache');
          persist('mine');
          persist('badges');
          recompute(now); notice('Everything except your API key has been reset.', 'info'); redraw(); return;
        }
        if (act === 'badges-shelf') { state.badgeShelfOpen = !state.badgeShelfOpen; redraw(); return; }
        if (act === 'badges-all') {
          // Expand too: the shelf shows when collapsed, and Settings does not.
          state.badgeShelfOpen = false; state.badgeCatalogueOpen = true;
          state.settings.collapsed = false;
          setView('settings'); persist('settings'); redraw(); return;
        }
        if (act === 'badges-catalogue') { state.badgeCatalogueOpen = !state.badgeCatalogueOpen; redraw(); return; }
        if (act === 'badges-toast-dismiss') { state.badgeToast = null; redraw(); return; }
        if (act === 'debug') { copyText(doc, win, buildDebugReport()); notice('Debug report copied.', 'info'); redraw(); return; }
      },

      onChange: function (act, el) {
        persistFailed = false;
        var now = Date.now();
        var id = idOf(el);
        var value = el && el.value !== undefined ? String(el.value) : '';
        if (act === 'sort' && SORT_MODES.indexOf(value) !== -1) { state.settings.sort = value; persist('settings'); redraw(); return; }
        if (act === 'theme' && THEMES.indexOf(value) !== -1) { state.settings.theme = value; persist('settings'); redraw(); return; }
        if (act === 'filter') { state.searchQuery = value; redraw(); return; }
        if (act === 'folder-filter') { state.settings.folderFilter = value || null; persist('settings'); redraw(); return; }
        if (act === 'tag-filter') { state.settings.tagFilter = value || null; persist('settings'); redraw(); return; }
        if (act === 'folder' && id) {
          state.organizer = setFolder(state.organizer, id, value || null); persist('organizer'); recompute(now);
          recordBadgeEvent({ type: 'tick' }, now); redraw(); return;
        }
        if (act === 'note-input' && id) {
          var noteNext = cloneOrganizer(state.organizer);
          entryOf(noteNext, id).note = safeString(value, 2000);
          state.organizer = noteNext;
          state.drawerEdit = null;
          persist('organizer'); recompute(now); redraw(); return;
        }
        if (act === 'tag-input' && id && value.trim()) {
          state.organizer = toggleTag(state.organizer, id, value.trim());
          state.drawerEdit = null;
          persist('organizer'); recompute(now); redraw(); return;
        }
        if (act === 'auto-refresh') {
          replaceSettings(normaliseSettings(Object.assign({}, state.settings, { autoRefreshMs: Number(value) })));
          persist('settings');
          // Rescheduling here is the whole point. Setting it up once at startup
          // would mean the choice did nothing until the next page load.
          scheduleAutoRefresh(doc, win);
          redraw(); return;
        }
        if (act === 'rows-shown') {
          // Through the normaliser, like auto-refresh, so the select cannot
          // store anything the menu does not offer.
          replaceSettings(normaliseSettings(Object.assign({}, state.settings, { rowsShown: Number(value) })));
          // A new cap is a fresh statement of what the user wants; a Show all
          // from before it would silently override it.
          state.showAll = {};
          persist('settings'); redraw(); return;
        }
        if (act === 'enrich-budget') { state.settings.enrichBudget = clamp(toInt(value, DEFAULT_ENRICH_BUDGET), 0, MAX_ENRICH_BUDGET); persist('settings'); redraw(); return; }
        if (act === 'hide-torn-box') {
          state.settings.hideTornBox = !!el.checked;
          persist('settings'); applyHideTornBox(doc); redraw(); return;
        }
        if (act === 'author-only') {
          state.settings.authorOnly = !!el.checked;
          persist('settings'); recompute(now); redraw(); return;
        }
        if (act === 'autosave') {
          state.settings.autosaveDrafts = !!el.checked;
          persist('settings');
          if (!state.settings.autosaveDrafts) detachAutosave();
          redraw(); return;
        }
        if (act === 'draft-lang') {
          if (DRAFT_LANGS.indexOf(value) !== -1) { state.settings.draftLang = value; persist('settings'); }
          redraw(); return;
        }
        if (act === 'ed-height-wide' || act === 'ed-height-narrow') {
          if (Object.prototype.hasOwnProperty.call(EDITOR_HEIGHTS, value)) {
            state.settings[act === 'ed-height-wide' ? 'editorHeightWide' : 'editorHeightNarrow'] = value;
            persist('settings');
          }
          redraw(); return;
        }
        if (act === 'auto-hide') {
          state.settings.autoHideOnOpen = !!el.checked;
          persist('settings'); redraw(); return;
        }
        if (act === 'ed-header') {
          state.editor.fields = Object.assign({}, state.editor.fields, { 'ed-header': !!el.checked });
          return;
        }
        if (act === 'see-through') {
          state.settings.seeThrough = !!el.checked;
          persist('settings'); redraw(); return;
        }
        if (act === 'clip-lines') {
          state.settings.clipLines = !!el.checked;
          persist('settings'); redraw(); return;
        }
        if (act === 'badges-toggle') {
          state.settings.badges = !!el.checked;
          persist('settings');
          if (!state.settings.badges) { state.badgeShelfOpen = false; state.badgeToast = null; }
          redraw(); return;
        }
        if (act === 'folder-forum' && id) {
          // #47: the menu adds a claim; a chip's button removes one. A forum
          // another folder claims is not offered, and claimForum refuses it.
          var claimedOrg = claimForum(state.organizer, id, value);
          if (claimedOrg !== state.organizer) {
            state.organizer = claimedOrg;
            persist('organizer'); recompute(now);
            recordBadgeEvent({ type: 'tick' }, now);
            announce(claimAnnouncement(id, value, ' now claims '));
          }
          redraw(); return;
        }
      },
      // #33: mirror a drawer field on every keystroke, without a redraw, so a
      // forced redraw before the commit renders what was typed and restores
      // the caret (spec section 6, dirty inputs rule 3).
      // #58 B2: a selection made without typing, mirrored from the panel's
      // select, keyup, mouseup and pointer events on the draft textarea.
      // #58 round 2: Enter in the draft field. The field is edited in place,
      // as typing edits it: no redraw, so the caret, the scroll position and a
      // phone's keyboard stay put. Like any other edit it takes an Undo
      // snapshot, marks the draft dirty and is refused past the limit.
      // Returns whether the editor handled the key.
      onDraftEnter: function (el, shift) {
        var E = state.editor;
        if (!el || el.value === undefined || E.mode === 'preview') return false;
        var a = el.selectionStart;
        var b = el.selectionEnd;
        if (typeof a !== 'number' || typeof b !== 'number' || !isFinite(a) || !isFinite(b)) return false;
        var before = String(el.value);
        var r = editorEnter(E.lang, before, a, b, shift);
        if (!r) return false;
        persistFailed = false;
        if (before !== E.text) handlers.onInput('draft-text', el);
        if (r.text.length > DRAFT_MAX_CHARS) {
          overLimitNotice(r.text.length);
          state.focusIntent = [attrSel('data-act', 'draft-text')];
          redraw();
          return true;
        }
        E.selStart = a; E.selEnd = b;
        pushUndo(E);
        E.text = r.text; E.selStart = r.start; E.selEnd = r.end;
        E.dirty = true;
        E.atLimit = r.text.length >= DRAFT_MAX_CHARS;
        lastSelField = el;
        if (!writeDraftField(el, before, r)) { state.focusIntent = [attrSel('data-act', 'draft-text')]; redraw(); }
        return true;
      },
      onSelect: function (act, el) {
        if (act !== 'draft-text' || !el) return;
        lastSelField = el;
        var a = el.selectionStart;
        var b = el.selectionEnd;
        if (typeof a !== 'number' || typeof b !== 'number' || !isFinite(a) || !isFinite(b)) return;
        var len = state.editor.text.length;
        state.editor.selStart = Math.max(0, Math.min(len, a));
        state.editor.selEnd = Math.max(0, Math.min(len, b));
      },
      onInput: function (act, el) {
        persistFailed = false;
        // #43: the popup's field mirrors under the inline field's name.
        if (act === 'editor-input') act = el && el.getAttribute ? el.getAttribute('data-field') : null;
        if (act === 'draft-text') {
          var nn = function (v) { return typeof v === 'number' && isFinite(v) ? v : 0; };
          var raw = el && el.value !== undefined ? String(el.value) : '';
          var typed = raw.slice(0, DRAFT_MAX_CHARS);
          // E2: one Undo step per typing burst: a snapshot at its first
          // keystroke; a pause or any other action ends it.
          if (typed !== state.editor.text) {
            var tnow = Date.now();
            if (!state.editor.typingAt || tnow - state.editor.typingAt > TYPING_BURST_MS) pushUndo(state.editor);
            state.editor.typingAt = tnow;
          }
          state.editor.text = typed;
          // Spec 4a: nothing is silently cut. maxlength and the slice keep the
          // stored source within the limit; the player hears about it once per
          // crossing, on the next redraw, not on every keystroke at the limit.
          var atLimit = raw.length >= DRAFT_MAX_CHARS;
          if (atLimit && !state.editor.atLimit) {
            notice('This draft is at the ' + DRAFT_MAX_CHARS + '-character limit; anything past it was not added.', 'warn');
          }
          state.editor.atLimit = atLimit;
          state.editor.selStart = nn(el && el.selectionStart);
          state.editor.selEnd = nn(el && el.selectionEnd);
          lastSelField = el || null;
          state.editor.dirty = true;
          return;
        }
        if (act === 'ed-name') {
          state.editor.name = el && el.value !== undefined ? String(el.value).slice(0, FREE_NAME_MAX) : '';
          state.editor.dirty = true;
          return;
        }
        // #58: a picker's typed fields live in the editor state, so a redraw
        // re-renders them and the handlers never query the document.
        if (['ed-hex-input', 'ed-link-input', 'ed-img-url', 'ed-fix-url', 'ed-img-alt', 'ed-cols', 'ed-rows'].indexOf(act) !== -1) {
          state.editor.fields = Object.assign({}, state.editor.fields);
          state.editor.fields[act] = el && el.value !== undefined ? String(el.value).slice(0, URL_MAX_CHARS) : '';
          // A changed address needs a new check: Insert never uses an old one.
          if (act === 'ed-img-url') state.editor.imageCheck = null;
          if (act === 'ed-fix-url') state.editor.fixCheck = null;
          return;
        }
        if (act !== 'note-input' && act !== 'tag-input') return;
        var id = idOf(el);
        if (!id) return;
        var n = function (v) { return typeof v === 'number' && isFinite(v) ? v : null; };
        state.drawerEdit = {
          id: id, field: act, value: el && el.value !== undefined ? String(el.value) : '',
          selStart: n(el && el.selectionStart), selEnd: n(el && el.selectionEnd),
        };
      },
    };

    return handlers;
  }

  // ---- bootstrap ---------------------------------------------------------

  var booted = false;
  var autoTimer = null;

  function routeKey(r) {
    return r ? String(r.view) + '|' + String(r.forumId) + '|' + String(r.threadId) : '';
  }

  function syncToRoute(doc, win) {
    if (!isForumsPage(win.location)) {
      if (state.mounted) unmountPanel(doc);
      // A result that arrives after the user has left must not redraw a panel
      // onto another page, or write data gathered for a page they have gone.
      invalidateInFlight();
      detachAutosave();
      stopDwell();
      state.route = null;
      state.notices = [];
      persistFailed = false;
      return;
    }
    var now = Date.now();
    var capture = captureVisit(win.location, doc.title, now);
    if (capture.changed) { persist('organizer'); recompute(now); }
    // A message belongs to the place it was raised; navigating clears it.
    if (routeKey(state.route) !== routeKey(capture.route)) { state.notices = []; persistFailed = false; }
    state.route = capture.route;
    startDwell(doc, win);
    sampleDwell(doc, win, now);
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
