'use strict';

/*
 * Non-invasive test harness for torn-forum-command-center.user.js
 * --------------------------------------------------------------
 * The production userscript is a single IIFE that keeps its helpers private.
 * To exercise them from Node without touching the file on disk we:
 *   1. Read the production source verbatim.
 *   2. Inject (IN MEMORY ONLY) an export statement immediately before the final
 *      `})();` so the IIFE publishes its internals onto the sandbox global.
 *   3. Run the modified-in-memory source in a `vm` context with mocked globals.
 *
 * Adapted from the same pattern in Torn Education Scheduler and Torn Bookie
 * Live Scores. The file on disk is never modified by a test.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

// Default to UTC so every test sees the same clock. A test specifically about
// timezone handling pins its own.
process.env.TZ = process.env.TZ || 'UTC';

const SOURCE_PATH = path.join(__dirname, '..', 'torn-forum-command-center.user.js');

// Every name a test needs to reach. A function missing from this list is
// invisible to tests - add it here in the same commit that adds the function.
const EXPORT_NAMES = [
  // #58 editor operations
  'wrapSelection', 'insertBlock', 'markPair', 'applyMark', 'applyBlockMark', 'tableSkeleton', 'emojiSnippet', 'imageSnippet', 'UNICODE_EMOJI',
  // #58 image link fixer and colour contrast
  'fixImageUrl', 'fixAllImages', 'hexRgb', 'contrastRatio', 'colorWarnings', 'IMAGE_HOWTO',
  // identity and routing
  'SCRIPT_VERSION', 'STORAGE_KEYS', 'isForumsPage', 'parseForumRoute',
  // small shared helpers the suites assert on directly
  'isPlainObject', 'toInt', 'clamp', 'safeString', 'secondsToMs', 'uniqueStrings',
  'normaliseSubscribedRow', 'normaliseActivityRow', 'normaliseCategoryRow', 'normaliseFolder',
  'cloneOrganizer', 'entryOf', 'b64EncodeUtf8', 'b64DecodeUtf8', 'QUERY_PREFIXES',
  'DEFAULT_ENRICH_BUDGET', 'MAX_ENRICH_BUDGET', 'CATEGORY_TTL_MS', 'ENRICH_TTL_MS',
  'DEEP_SEARCH_MAX_PAGES', 'DEEP_SEARCH_MAX_THREADS', 'POSTS_PER_PAGE',
  // orchestration and live state
  'state', 'init', 'syncToRoute', 'refreshAll', 'enrichThreads', 'runDeepSearch',
  'loadAll', 'persist', 'recompute', 'makeHandlers', 'readRaw', 'writeRaw',
  'ambientTransports', 'transportName', 'injectStyleOnce', 'copyText', 'threadUrl',
  'THREAD_LINK_ATTR', 'THREAD_LINK_MAX_DEPTH', 'threadLinkAttr', 'threadLinkOf',
  'REPLY_SELECTORS', 'draw', 'applyHideTornBox', 'TORN_BOX_SELECTORS', 'isOwnMutation', 'panelHasEditableFocus',
  'attachAutosave', 'detachAutosave', 'invalidateInFlight', 'AUTOSAVE_DEBOUNCE_MS',
  // pure view renderers
  'panelHtml', 'renderNav', 'renderRow', 'renderThreadsView', 'renderCatchUpView',
  'renderSearchView', 'renderDraftsView', 'renderSettingsView',
  // storage normalisers
  'SCHEMA_VERSION', 'freshSettings', 'normaliseSettings', 'isPlainActivation', 'autoHideSettings',
  'freshOrganizer', 'normaliseOrganizer', 'normaliseThreadEntry',
  'freshDrafts', 'normaliseDrafts', 'freshFeed', 'normaliseFeed',
  'freshPostCache', 'normalisePostCache',
  'loadKey', 'saveKey', 'loadApiKey', 'saveApiKey', 'isKeyShaped', 'isRecoveredValue', 'isRecoveredOrganizer',
  // badges (issue #9)
  'tctDay', 'creditDay', 'streakView', 'freshDwell', 'dwellStep', 'DWELL_MS',
  'freshBadges', 'normaliseBadges', 'BADGES', 'badgeFacts', 'badgeMetrics', 'evaluateBadges',
  'nextBadge', 'badgeToastText', 'applyBadgeEvent', 'checkinEligible', 'mergeBadgeRecords',
  'exportBadges', 'badgeIcon',
  'recordBadgeEvent', 'catchUpRowsNow', 'sampleDwell', 'startDwell', 'stopDwell', 'badgeModel',
  'renderHeadId', 'renderBadgeChip', 'renderBadgeShelf', 'renderBadgeToast', 'renderBadgeCatalogue',
  // api adapter
  'API_BASE', 'REQUEST_TIMEOUT_MS', 'TORN_ERRORS', 'KEY_REJECTED_CODES', 'rejectKey', 'clearKeyRejection', 'mapTornError', 'redactUrl', 'scrubDetail',
  'buildApiUrl', 'httpGet', 'tornApiGet', 'makeRateLimiter',
  'MIN_REQUEST_GAP_MS', 'REQUESTS_PER_WINDOW', 'RATE_WINDOW_MS',
  'PDA_KEY_SENTINEL', 'PDA_KEY_SLOT', 'pdaInjectedKey',
  // engine: merge, unread, sort
  'ACTIVITY_SOURCES', 'resolveLastActivity', 'unreadFor', 'mergeThreads',
  'SORT_MODES', 'SORT_LABELS', 'sortThreads', 'catchUpList', 'catchUpUnchecked', 'checkAuthorPosts',
  'ROWS_SHOWN_OPTIONS', 'CAPPED_VIEWS', 'UNCAPPED_VIEWS', 'VIEW_LABELS', 'capRows', 'rowLimitFor', 'renderCapLine',
  // #33: narrow layout
  'PRESS_FLUSH_MS',
  'restoreFocus', 'renderLive', 'focusTargetOf',
  'rowHtml', 'renderRowNarrow', 'renderViewHeading', 'renderPriority', 'nextEditor', 'reconcileEditor',
  'renderListBarNarrow',
  'renderNavNarrow', 'navNumeral',
  'renderHeadNarrow', 'fitHeader',
  // #39: narrow polish
  'CU_GAP', 'CU_MODES', 'CU_SHORT_CLASS', 'CU_WRAP_CLASS', 'catchUpLabelMode', 'fitCatchUp',
  'GLYPHS', 'glyph', 'renderInfoButton', 'renderInfoText',
  'groupCatchUp', 'renderedRowIds', 'SEARCH_ROWS_MAX', 'replaceSettings',
  'NARROW_CLASS', 'applyTransient', 'measurePanelWidth', 'setNarrow', 'watchPanelWidth', 'onPanelWidth',
  'VIEW_HEADING_ID', 'focusPlan',
  'INFO_KEYS', 'INFO_KEYS_BY_VIEW', 'TRANSIENT_RESET_EVENTS', 'freshTransient', 'nextTransient', 'reconcileTransient',
  'NARROW_ENTER_PX', 'NARROW_LEAVE_PX', 'HB_MAX', 'HB_MIN', 'HB_STEP', 'HB_COMPACT_BELOW', 'HB_GAPS', 'HB_COUNT_GAP', 'LOGO_ASPECT', 'LOGO_PER_HB', 'LOGO_MIN_PX', 'LOGO_MAX_PX', 'narrowFor', 'headerLogoWidth', 'headerButtonSize', 'activeFilterCount',
  'authorPageStep', 'summariseAuthorPosts', 'AUTHOR_MAX_PAGES', 'authorSinceFor', 'authorStateFor', 'AUTHOR_REASON_TEXT',
  // engine: search
  'parseQuery', 'matchThread', 'matchPost', 'searchMetadata', 'searchPosts',
  'buildNativeSearchUrl', 'stripHtml',
  // engine: custom key link
  'CUSTOM_KEY_SELECTIONS', 'CUSTOM_KEY_TITLE', 'CUSTOM_KEY_LINK_BASE', 'buildCustomKeyUrl',
  // engine: post cache
  'POST_CACHE_MAX_POSTS', 'POST_CACHE_MAX_BYTES',
  'postCacheAdd', 'postCacheEvict', 'postCacheSize', 'postCachePostsFor',
  // engine: organizer
  'DEFAULT_FOLDERS', 'PRIORITY_MIN', 'PRIORITY_MAX',
  'folderFor', 'claimForum', 'unclaimForum', 'applyAutoAssign', 'toggleTag', 'addTag', 'hasTag', 'setPriority', 'setFolder',
  'togglePin', 'markRead', 'deleteFolder', 'upsertFolder', 'allTags',
  // #45: folder order and collapsing
  'UNFILED_KEY', 'folderOrderKeys', 'moveFolder', 'toggleFolderCollapsed', 'isFolderCollapsed',
  // engine: drafts
  'DRAFT_MAX_CHARS', 'saveDraft', 'draftFor', 'deleteDraft', 'draftList',
  'newFreeDraft', 'saveFreeDraft', 'deleteFreeDraft', 'draftLangOf', 'FREE_DRAFTS_MAX', 'FREE_NAME_MAX', 'isRecoveredSettings',
  // engine: my posts
  'MINE_MAX_THREADS', 'freshMine', 'freshMineThread', 'normaliseMine', 'normaliseMineThread',
  'mineThreadFromApi', 'minePostFromApi', 'pickList', 'threadPostsTotal', 'parseThreadDetail',
  'mergeMineSnapshot', 'applyMineDetail', 'mineUnreadFor', 'isOrganised',
  'mineLookupTargets', 'mineIsDue', 'viewRows',
  // runtime: my posts
  'MINE_TTL_MS', 'MINE_PAGE_LIMIT', 'refreshMine',
  // thread reactions (#10)
  'isReactionNumber', 'setReactionFields', 'applyReactions', 'topicPostFromApi', 'applyTopicPost',
  'reactionLookupTargets', 'reactionTotals', 'formatSigned', 'reactionsTitle', 'renderReactions',
  'enrichReactions', 'REACTIONS_STALE_MS', 'TOPIC_TTL_MS', 'REACTION_LOOKUPS_PER_RUN', 'TOPIC_POST_PARAMS',
  // forum karma (#10)
  'karmaFromAuthors', 'karmaFromProfile', 'setKarma', 'karmaFallbackDue', 'formatKarma', 'readKarmaProfile',
  'KARMA_TTL_MS', 'KARMA_ICON_SVG', 'LOGO_SVG',
  // engine: share
  'EXPORT_PREFIX', 'encodeState', 'decodeState', 'importState',
  // runtime: lifecycle
  'whenDocumentReady', 'observeNavigation', 'unmountPanel', 'findMountPoint',
  'MOUNT_SELECTORS', 'PANEL_ID', 'FALLBACK_ID',
  // runtime: capture
  'captureVisit', 'titleToThreadName',
  // runtime: panel
  'VIEWS', 'buildPanelModel', 'loadingModel', 'errorModel', 'noopHandlers',
  'renderPanel', 'panelStyleText', 'THEMES', 'resolveTheme', 'measurePageTheme', 'applyThemeClass', 'observeTheme',
  // runtime: drafts insertion
  'findReplyBox', 'insertPost', 'caretToEnd', 'copyPost',
  // runtime: debug
  'gatherDebugContext', 'buildDebugReport',
  // #58: Drafts rich editor
  'editorKeyFor', 'loadEditor', 'editorPostHtml', 'saveEditor', 'overLimitNotice', 'previewImages',
  'renderEditorPane', 'renderDraftList', 'renderModePill', 'renderPreview', 'teVars', 'EDITOR_MODES',
  'insertAtCaret', 'renderEditorToolbar', 'renderPicker', 'EDITOR_TOOLS',
  'TORN_COLORS', 'TORN_COLOR_NAMES', 'TORN_EMOJI', 'DRAFT_LANGS', 'FONT_SIZE_MIN', 'FONT_SIZE_MAX',
  'SIZE_PICKS', 'HEADING_PX', 'PASTE_MARKER', 'EDITOR_BG', 'CLEAN_MAX_CHARS', 'URL_MAX_CHARS',
  'mdInline', 'mdBlocks', 'mdToHtml', 'MD_ESCAPABLE',
  'htmlToMd', 'textToHtml', 'textToMd', 'htmlToText', 'postHtml', 'convertDraft', 'previewModel', 'htmlBlockOffsets',
  'decodeEntities', 'tokenizeHtml', 'cleanTornHtml', 'htmlSource', 'safeHref', 'safeImgSrc', 'emojiFromSrc',
  // formatting
  'formatRelativeTime', 'formatAbsoluteTime', 'formatCount', 'formatBytes', 'plural', 'escapeHtml',
];

function readSource() {
  return fs.readFileSync(SOURCE_PATH, 'utf8');
}

function buildInstrumentedSource() {
  const original = readSource();
  const marker = '})();';
  const idx = original.lastIndexOf(marker);
  if (idx === -1) throw new Error('Could not find IIFE close marker in production source');
  const pairs = EXPORT_NAMES
    .map((n) => `${JSON.stringify(n)}: (typeof ${n} !== 'undefined' ? ${n} : undefined)`)
    .join(', ');
  const injection = `\n;try { globalThis.__TFCC__ = { ${pairs} }; } catch (e) { globalThis.__TFCC_ERR__ = e; }\n`;
  return original.slice(0, idx) + injection + original.slice(idx);
}

// The default location is deliberately NOT the forums page. Loading the source
// is how a suite gets at the engine, and the bootstrap at the foot of the file
// runs on load: an engine test that happened to boot the runtime would be
// asserting against a moving target. Lifecycle suites opt in with
// `{ location: FORUMS_LOCATION }`.
const DEFAULT_LOCATION = Object.freeze({
  origin: 'https://www.torn.com',
  hostname: 'www.torn.com',
  pathname: '/index.php',
  href: 'https://www.torn.com/index.php',
  search: '',
  hash: '',
});

const FORUMS_LOCATION = Object.freeze({
  origin: 'https://www.torn.com',
  hostname: 'www.torn.com',
  pathname: '/forums.php',
  href: 'https://www.torn.com/forums.php',
  search: '',
  hash: '',
});

function makeSandbox(options = {}) {
  let currentNow = options.now === undefined ? Date.UTC(2026, 7, 7, 12, 0, 0) : options.now;

  class MockDate extends Date {
    constructor(...args) {
      if (args.length === 0) super(currentNow);
      else super(...args);
    }
    static now() { return currentNow; }
  }

  // sharedGmStore: two sandboxes over ONE store, the way two tabs share script
  // storage. A copy would hide every cross-tab bug.
  const gmStore = options.sharedGmStore || new Map(options.gmStore || []);
  const gmWriteErrors = options.gmWriteErrors || null;

  const documentListeners = {};
  const createdElements = [];

  // Observers registered by the script, so the fake innerHTML setter can fire
  // them the way a real MutationObserver would. Without this the harness cannot
  // see a render that re-triggers the observer watching it, which is exactly
  // the loop that shipped: renderPanel writes panel.innerHTML, the panel is
  // inside the observed subtree, and the observer schedules another render.
  const observers = [];

  // #33 options. All opt-in; the defaults leave every existing suite alone.
  let panelWidth = typeof options.panelWidth === 'number' ? options.panelWidth : 0;
  const focusLog = [];
  const queryLog = [];
  const resizeObservers = [];

  // The selector grammar the runtime promises for focus and measurement:
  // '#id', or an optional tag, then .class parts, then [attr="value"] parts.
  // Anything else answers null, so a runtime that strays fails its test.
  function parseSelector(sel) {
    const s = String(sel || '');
    if (/^#[A-Za-z0-9_-]+$/.test(s)) return { tag: null, classes: [], attrs: [['id', s.slice(1)]] };
    const m = /^([a-z][a-z0-9]*)?((?:\.[A-Za-z0-9_-]+)*)((?:\[[a-z-]+="[^"]*"\])*)$/.exec(s);
    if (!s || !m) return null;
    const attrs = [];
    const re = /\[([a-z-]+)="([^"]*)"\]/g;
    let a;
    while ((a = re.exec(m[3] || ''))) attrs.push([a[1], a[2]]);
    return { tag: m[1] || null, classes: (m[2] || '').split('.').filter(Boolean), attrs };
  }

  function makeStub(tag, attrs) {
    const classes = new Set(String(attrs.class || '').split(/\s+/).filter(Boolean));
    const stub = {
      tagName: tag.toUpperCase(),
      attributes: attrs,
      parentNode: null,
      getAttribute(k) { return Object.prototype.hasOwnProperty.call(attrs, k) ? attrs[k] : null; },
      classList: {
        add(c) { classes.add(c); }, remove(c) { classes.delete(c); },
        contains(c) { return classes.has(c); },
        toggle(c, on) { if (on === undefined ? !classes.has(c) : on) classes.add(c); else classes.delete(c); },
      },
      focus() { focusLog.push(Object.assign({}, attrs)); documentStub.activeElement = stub; },
      setSelectionRange(a, b) { stub.selection = [a, b]; },
      getBoundingClientRect() { return { width: options.measure ? options.measure(stub) : 0, height: 0 }; },
    };
    return stub;
  }

  // The offset just past an element's closing tag, counting nested elements of
  // the same name. A void element ends where its opening tag does.
  const VOID = new Set(['input', 'br', 'img', 'hr', 'meta', 'link', 'path']);
  function endOf(html, tag, start, openLen) {
    if (VOID.has(tag) || /\/>$/.test(html.slice(start, start + openLen))) return start + openLen;
    const re = new RegExp('<(/?)' + tag + '\\b[^>]*>', 'gi');
    re.lastIndex = start + openLen;
    let depth = 1;
    let t;
    while ((t = re.exec(html))) {
      if (t[1]) depth -= 1; else if (!/\/>$/.test(t[0])) depth += 1;
      if (depth === 0) return re.lastIndex;
    }
    return html.length;
  }

  function queryIn(el, sel, all) {
    const p = parseSelector(sel);
    if (!p) return all ? [] : null;
    if (!el._q || el._q.html !== el._innerHTML) el._q = { html: el._innerHTML, nodes: new Map() };
    const out = [];
    const tagRe = /<([a-zA-Z][a-zA-Z0-9]*)\b([^>]*)>/g;
    let m;
    let index = 0;
    while ((m = tagRe.exec(el._innerHTML))) {
      const idx = index;
      index += 1;
      const tag = m[1].toLowerCase();
      const attrs = {};
      const attrRe = /\s([a-zA-Z_:][-a-zA-Z0-9_:.]*)(?:="([^"]*)")?/g;
      let a;
      while ((a = attrRe.exec(m[2]))) attrs[a[1]] = a[2] === undefined ? '' : a[2];
      if (p.tag && p.tag !== tag) continue;
      const cls = String(attrs.class || '').split(/\s+/);
      if (!p.classes.every((c) => cls.includes(c))) continue;
      if (!p.attrs.every(([k, v]) => attrs[k] === v)) continue;
      let node = el._q.nodes.get(idx);
      if (!node) {
        node = makeStub(tag, attrs);
        // #39: where the element sits in its parent's markup, so a stub can
        // answer contains() for another stub from the same render.
        node._owner = el._q;
        node._start = m.index;
        node._end = endOf(el._innerHTML, tag, m.index, m[0].length);
        node.contains = (other) => other === node || (!!other && other._owner === node._owner
          && other._start > node._start && other._start < node._end);
        el._q.nodes.set(idx, node);
      }
      if (!all) return node;
      out.push(node);
    }
    return all ? out : null;
  }

  function notifyObservers(target) {
    for (const o of observers.slice()) {
      if (o.disconnected || !o.options || !o.options.childList) continue;
      // subtree: true means anything under the root counts, which is what the
      // script asks for and why its own writes came back to it.
      if (!o.options.subtree && o.target !== target) continue;
      sandbox.setTimeout(() => {
        if (!o.disconnected) o.cb([{ type: 'childList', target }], o);
      }, 0);
    }
  }

  function makeElement(tag) {
    const el = {
      tagName: String(tag || 'div').toUpperCase(),
      style: {
        setProperty(k, v) { this[k] = String(v); },
        removeProperty(k) { delete this[k]; },
        getPropertyValue(k) { return Object.prototype.hasOwnProperty.call(this, k) ? this[k] : ''; },
      },
      dataset: {},
      children: [],
      attributes: {},
      isConnected: true,
      parentNode: null,
      _innerHTML: '',
      textContent: '',
      value: '',
      classList: {
        _set: new Set(),
        add(...c) { c.forEach((x) => this._set.add(x)); },
        remove(...c) { c.forEach((x) => this._set.delete(x)); },
        toggle(c, on) { if (on === undefined) { if (this._set.has(c)) this._set.delete(c); else this._set.add(c); } else if (on) this._set.add(c); else this._set.delete(c); },
        contains(c) { return this._set.has(c); },
      },
      setAttribute(k, v) { this.attributes[k] = String(v); if (k === 'id') this.id = String(v); },
      getAttribute(k) { return Object.prototype.hasOwnProperty.call(this.attributes, k) ? this.attributes[k] : null; },
      removeAttribute(k) { delete this.attributes[k]; },
      appendChild(child) { this.children.push(child); if (child) child.parentNode = this; return child; },
      removeChild(child) {
        const i = this.children.indexOf(child);
        if (i !== -1) this.children.splice(i, 1);
        if (child) { child.parentNode = null; child.isConnected = false; }
        return child;
      },
      remove() { if (this.parentNode) this.parentNode.removeChild(this); else this.isConnected = false; },
      addEventListener(type, fn) { (this._listeners = this._listeners || {})[type] = (this._listeners[type] || []).concat(fn); },
      removeEventListener(type, fn) {
        if (!this._listeners || !this._listeners[type]) return;
        const i = this._listeners[type].indexOf(fn);
        if (i !== -1) this._listeners[type].splice(i, 1);
      },
      dispatchEvent(ev) {
        const list = (this._listeners && this._listeners[ev && ev.type]) || [];
        for (const fn of list.slice()) fn(ev);
        return !(ev && ev.defaultPrevented);
      },
      querySelector(sel) { return options.htmlQuery ? queryIn(this, sel, false) : null; },
      querySelectorAll(sel) { return options.htmlQuery ? queryIn(this, sel, true) : []; },
      getBoundingClientRect() { return { width: this.id === 'tfcc-panel' ? panelWidth : 0, height: 0 }; },
      get clientWidth() { return this.id === 'tfcc-panel' && panelWidth > 2 ? panelWidth - 2 : 0; },
      focus() { this._focused = true; },
      insertBefore(node, ref) {
        const i = this.children.indexOf(ref);
        if (i === -1) this.children.push(node); else this.children.splice(i, 0, node);
        if (node) node.parentNode = this;
        return node;
      },
      get firstChild() { return this.children[0] || null; },
    };
    Object.defineProperty(el, 'innerHTML', {
      configurable: true,
      enumerable: true,
      get() { return this._innerHTML; },
      set(v) {
        this._innerHTML = String(v);
        this.renderCount = (this.renderCount || 0) + 1;
        notifyObservers(this);
      },
    });
    createdElements.push(el);
    return el;
  }

  const body = makeElement('body');
  const head = makeElement('head');
  const documentElement = makeElement('html');

  const selectorTable = options.selectors || {};
  const documentStub = options.document || {
    readyState: options.readyState || 'complete',
    title: options.title === undefined ? 'Forums | TORN' : options.title,
    documentElement,
    head,
    body,
    createElement: makeElement,
    createTextNode: (t) => ({ nodeType: 3, textContent: String(t) }),
    createRange: () => ({
      selectNodeContents(n) { selectionLog.push({ op: 'selectNodeContents', node: n }); },
      collapse(toStart) { selectionLog.push({ op: 'collapse', toStart }); },
    }),
    querySelector(sel) {
      queryLog.push(String(sel));
      if (Object.prototype.hasOwnProperty.call(selectorTable, sel)) return selectorTable[sel];
      return null;
    },
    querySelectorAll(sel) {
      queryLog.push(String(sel));
      const hit = Object.prototype.hasOwnProperty.call(selectorTable, sel) ? selectorTable[sel] : null;
      if (!hit) return [];
      return Array.isArray(hit) ? hit : [hit];
    },
    getElementById(id) {
      const found = createdElements.find((el) => el.id === id && el.isConnected);
      return found || null;
    },
    addEventListener(type, fn) { (documentListeners[type] = documentListeners[type] || []).push(fn); },
    removeEventListener(type, fn) {
      const list = documentListeners[type] || [];
      const i = list.indexOf(fn);
      if (i !== -1) list.splice(i, 1);
    },
    fire(type) { for (const fn of (documentListeners[type] || []).slice()) fn({ type }); },
    listeners: documentListeners,
  };

  const historyCalls = [];
  const historyStub = options.history || {
    pushState(...a) { historyCalls.push(['pushState', a]); },
    replaceState(...a) { historyCalls.push(['replaceState', a]); },
  };

  const selectionLog = [];
  const clipboardLog = [];

  const windowStub = {
    location: Object.assign({}, DEFAULT_LOCATION, options.location || {}),
    history: historyStub,
    listeners: {},
    addEventListener(type, fn) { (windowStub.listeners[type] = windowStub.listeners[type] || []).push(fn); },
    removeEventListener(type, fn) {
      const list = windowStub.listeners[type] || [];
      const i = list.indexOf(fn);
      if (i !== -1) list.splice(i, 1);
    },
    fire(type, ev) { for (const fn of (windowStub.listeners[type] || []).slice()) fn(ev || { type }); },
    MutationObserver: class {
      constructor(cb) { this.cb = cb; this.disconnected = false; observers.push(this); }
      observe(target, opts) { this.target = target; this.options = opts || {}; this.disconnected = false; }
      disconnect() { this.disconnected = true; }
    },
    // The native setter path insertDraft() must use so React notices a change.
    HTMLTextAreaElement: function HTMLTextAreaElement() {},
    HTMLInputElement: function HTMLInputElement() {},
    Event: class FakeEvent {
      constructor(type, init) { this.type = type; this.bubbles = !!(init && init.bubbles); }
    },
    DataTransfer: class FakeDataTransfer {
      constructor() { this._d = {}; }
      setData(type, v) { this._d[type] = String(v); }
      getData(type) { return Object.prototype.hasOwnProperty.call(this._d, type) ? this._d[type] : ''; }
    },
    ClipboardEvent: class FakeClipboardEvent {
      constructor(type, init) {
        this.type = type;
        this.bubbles = !!(init && init.bubbles);
        this.cancelable = !!(init && init.cancelable);
        this.clipboardData = (init && init.clipboardData) || null;
        this.defaultPrevented = false;
      }
      preventDefault() { if (this.cancelable) this.defaultPrevented = true; }
    },
    ClipboardItem: class FakeClipboardItem { constructor(map) { this.types = Object.keys(map); this.map = map; } },
    Blob: class FakeBlob { constructor(parts, opts) { this.parts = parts; this.type = (opts && opts.type) || ''; } },
    getSelection: () => ({
      removeAllRanges() { selectionLog.push({ op: 'removeAllRanges' }); },
      addRange(r) { selectionLog.push({ op: 'addRange', range: r }); },
    }),
    navigator: {
      clipboard: {
        writeText(t) { clipboardLog.push({ op: 'writeText', text: t }); return Promise.resolve(); },
        write(items) { clipboardLog.push({ op: 'write', items }); return Promise.resolve(); },
      },
    },
    // Controllable, because resolveTheme now measures what the page paints
    // rather than guessing at a class name. `computedStyles` maps a stub
    // element to the style object getComputedStyle should return for it.
    getComputedStyle: (el) => {
      const table = options.computedStyles || {};
      if (el === body && table.body) return Object.assign({ getPropertyValue: () => '' }, table.body);
      if (el === documentElement && table.documentElement) {
        return Object.assign({ getPropertyValue: () => '' }, table.documentElement);
      }
      if (el && el.id === 'tfcc-panel' && typeof options.panelPadding === 'number') {
        const p = options.panelPadding + 'px';
        return { getPropertyValue: () => '', backgroundColor: '', paddingLeft: p, paddingRight: p };
      }
      return { getPropertyValue: () => '', backgroundColor: '' };
    },
    matchMedia: options.matchMedia || (() => ({ matches: false, addEventListener() {}, removeEventListener() {} })),
  };

  const nativeSetterCalls = [];
  windowStub.HTMLTextAreaElement.prototype = {};
  Object.defineProperty(windowStub.HTMLTextAreaElement.prototype, 'value', {
    configurable: true,
    get() { return this._value; },
    set(v) { nativeSetterCalls.push(v); this._value = v; },
  });

  // Deterministic timers. Readiness polling, navigation debounce, the request
  // timeout and the rate limiter use materially different delays; treating them
  // as one undated bag lets a navigation test fire a network timeout by accident.
  let nextTimerId = 1;
  let timerNow = 0;
  const timers = new Map();
  const runDue = () => {
    const due = Array.from(timers.entries())
      .filter(([, t]) => t.due <= timerNow)
      .sort((a, b) => a[1].due - b[1].due || a[0] - b[0]);
    for (const [id, t] of due) {
      timers.delete(id);
      if (typeof t.fn === 'function') t.fn();
    }
  };
  const runTimers = () => {
    if (timers.size === 0) return;
    const nextDue = Math.min(...Array.from(timers.values(), (t) => t.due));
    timerNow = Math.max(timerNow, nextDue);
    runDue();
  };
  // stepClock: Date.now() moves WITH each timer that fires, rather than jumping
  // once at the end. Opt-in, because existing suites were written against the
  // jump. The dwell sampler measures elapsed time inside its timer, so it needs
  // the stepped clock to see time pass at all.
  const advanceTimersBy = (ms) => {
    const startTimer = timerNow;
    const startNow = currentNow;
    const target = timerNow + Math.max(0, Number(ms) || 0);
    let guard = 0;
    while (timers.size > 0 && guard < 10000) {
      guard += 1;
      const nextDue = Math.min(...Array.from(timers.values(), (t) => t.due));
      if (nextDue > target) break;
      timerNow = nextDue;
      if (options.stepClock) currentNow = startNow + (timerNow - startTimer);
      runDue();
    }
    timerNow = target;
    currentNow = startNow + (target - startTimer);
  };

  const sandbox = {
    console: options.console || { log() {}, warn() {}, error() {}, info() {} },
    Date: MockDate,
    location: windowStub.location,
    window: windowStub,
    history: historyStub,
    document: documentStub,
    MutationObserver: windowStub.MutationObserver,
    Event: windowStub.Event,
    HTMLTextAreaElement: windowStub.HTMLTextAreaElement,
    HTMLInputElement: windowStub.HTMLInputElement,
    getComputedStyle: windowStub.getComputedStyle,
    matchMedia: windowStub.matchMedia,
    setTimeout: (fn, delay) => {
      const id = nextTimerId++;
      timers.set(id, { fn, due: timerNow + Math.max(0, Number(delay) || 0) });
      return id;
    },
    clearTimeout: (id) => { timers.delete(id); },
    setInterval: (fn, delay) => {
      const id = nextTimerId++;
      timers.set(id, { fn, due: timerNow + Math.max(0, Number(delay) || 0), interval: true });
      return id;
    },
    clearInterval: (id) => { timers.delete(id); },
    GM_setValue: (k, v) => {
      if (gmWriteErrors && gmWriteErrors.has(k)) throw new Error('quota exceeded');
      gmStore.set(k, v);
    },
    GM_getValue: (k, d) => (gmStore.has(k) ? gmStore.get(k) : d),
    // Deliberately NOT injecting Object, Array, JSON, Math, Promise and friends.
    // A vm context already has every ECMAScript intrinsic. Injecting the main
    // realm's versions makes `Object.keys(x).map(...)` return a MAIN-realm array
    // holding VM-realm objects, which transformFromVM below cannot see into, and
    // a deepStrictEqual then fails on prototype identity for values that are
    // structurally identical. Only genuinely host-provided globals go in here.
    URL, URLSearchParams, TextEncoder, TextDecoder,
  };

  if (options.atob !== false) sandbox.atob = (s) => Buffer.from(String(s), 'base64').toString('binary');
  if (options.btoa !== false) sandbox.btoa = (s) => Buffer.from(String(s), 'binary').toString('base64');

  // Adapter tiers are individually presentable so tier selection is testable.
  const calls = { pda: [], gm: [], fetch: [] };
  if (options.PDA_httpGet) {
    sandbox.PDA_httpGet = (url, headers) => {
      calls.pda.push({ url, headers });
      return options.PDA_httpGet(url, headers);
    };
  }
  if (options.GM_xmlhttpRequest) {
    sandbox.GM_xmlhttpRequest = (cfg) => {
      calls.gm.push(cfg);
      return options.GM_xmlhttpRequest(cfg);
    };
  }
  if (options.fetch) {
    sandbox.fetch = (url, init) => {
      calls.fetch.push({ url, init });
      return options.fetch(url, init);
    };
    windowStub.fetch = sandbox.fetch;
  }

  sandbox.globalThis = sandbox;
  sandbox.self = sandbox;

  if (options.resizeObserver) {
    const mode = options.resizeObserver;
    sandbox.ResizeObserver = class FakeResizeObserver {
      constructor(cb) {
        if (mode === 'throws') throw new Error('ResizeObserver unavailable');
        this.cb = cb; this.target = null; this.disconnected = false;
        resizeObservers.push(this);
      }
      observe(target) { this.target = target; this.disconnected = false; }
      disconnect() { this.disconnected = true; }
    };
  }
  function resize(width) {
    panelWidth = width;
    for (const ro of resizeObservers.slice()) {
      if (ro.disconnected || !ro.target) continue;
      const entry = { target: ro.target, contentRect: { width: Math.max(0, width - 2) } };
      if (options.resizeObserver !== 'no-box') entry.borderBoxSize = [{ inlineSize: width, blockSize: 0 }];
      ro.cb([entry], ro);
    }
  }

  return {
    sandbox, gmStore, win: windowStub, doc: documentStub, body, head,
    observers, historyCalls, calls, nativeSetterCalls, selectionLog, clipboardLog, createdElements,
    makeElement,
    runTimers, advanceTimersBy,
    resize, resizeObservers, focusLog, queryLog,
    pendingTimerCount: () => timers.size,
    setNow: (ms) => { currentNow = ms; },
    now: () => currentNow,
  };
}

function loadUserscript(options = {}) {
  const env = makeSandbox(options);
  const context = vm.createContext(env.sandbox);
  vm.runInContext(buildInstrumentedSource(), context, { filename: 'torn-forum-command-center.user.js' });
  if (env.sandbox.__TFCC_ERR__) throw env.sandbox.__TFCC_ERR__;
  if (!env.sandbox.__TFCC__) throw new Error('Export injection failed: __TFCC__ not set');

  // Capture the VM realm's prototypes by creating sample objects inside the VM.
  // Object/Array were injected from the main context, so `instanceof` is not a
  // reliable realm test; prototype identity is.
  const vmProtos = vm.runInContext(`
    (function () {
      return { objectProto: Object.getPrototypeOf({}), arrayProto: Object.getPrototypeOf([]) };
    })()
  `, context);

  function transformFromVM(value) {
    if (value === null || typeof value !== 'object') return value;
    if (typeof value.then === 'function') return value;
    if (value instanceof Map) {
      const m = new Map();
      for (const [k, v] of value) m.set(transformFromVM(k), transformFromVM(v));
      return m;
    }
    if (value instanceof Set) {
      const s = new Set();
      for (const v of value) s.add(transformFromVM(v));
      return s;
    }
    const proto = Object.getPrototypeOf(value);
    if (proto === vmProtos.arrayProto) return Array.from(value, transformFromVM);
    if (proto === vmProtos.objectProto) {
      const out = {};
      for (const key of Object.keys(value)) {
        const member = value[key];
        if (typeof member === 'function') {
          // A returned object can carry methods of its own - makeRateLimiter
          // hands back reserve/used/reset. Without wrapping them here, their
          // results come back as VM-realm objects and deepStrictEqual fails on
          // prototype identity for values that are structurally identical.
          // `this` stays bound to the VM object so its closure state still works.
          out[key] = (...args) => transformFromVM(member.apply(value, args));
        } else {
          out[key] = transformFromVM(member);
        }
      }
      return out;
    }
    return value;
  }

  function wrapExports(raw) {
    const wrapped = {};
    for (const [key, value] of Object.entries(raw)) {
      if (typeof value === 'function') {
        wrapped[key] = function (...args) { return transformFromVM(value.apply(this, args)); };
      } else if (Array.isArray(value)) {
        // Exported constants are frozen arrays created inside the vm, so
        // deepStrictEqual against a plain array in this realm fails on
        // prototype identity for values that are structurally identical.
        // Only arrays are converted: objects are left alone because the
        // production code compares some of them (noopHandlers) by identity.
        wrapped[key] = transformFromVM(value);
      } else {
        wrapped[key] = value;
      }
    }
    return wrapped;
  }

  return Object.assign({}, env, {
    exports: wrapExports(env.sandbox.__TFCC__),
    rawExports: env.sandbox.__TFCC__,
    transform: transformFromVM,
    runInVm: (expr) => vm.runInContext(expr, context),
  });
}

// A minimal Torn API response builder, so suites do not each invent a shape
// that drifts from the one the spec pins.
function subscribedThreadsPayload(threads) {
  return {
    forumSubscribedThreads: threads.map((t) => ({
      id: t.id,
      forum_id: t.forumId === undefined ? 61 : t.forumId,
      title: t.title === undefined ? `Thread ${t.id}` : t.title,
      author: t.author || { id: 100 + t.id, username: `user${t.id}`, karma: 5 },
      posts: { new: t.new === undefined ? 0 : t.new, total: t.total === undefined ? 10 : t.total },
    })),
  };
}

function forumFeedPayload(rows) {
  return {
    forumFeed: rows.map((r) => ({
      thread_id: r.threadId,
      post_id: r.postId === undefined ? 1 : r.postId,
      user: r.user || { id: 1, username: 'someone', karma: 1 },
      title: r.title === undefined ? `Thread ${r.threadId}` : r.title,
      text: r.text === undefined ? '' : r.text,
      timestamp: r.timestamp,
      is_seen: r.isSeen === undefined ? false : r.isSeen,
      type: r.type === undefined ? 1 : r.type,
    })),
  };
}

// Cloned from the redacted live captures in tests/fixtures/ (issue #14), so
// every field name, and every field the builder does not override, is what
// Torn actually sent on 2026-10-08. Options override single values only.
// `replies` is the raw API `posts` value, which counts REPLIES, not posts
// (live finding 3); `total` is accepted as an alias so #10's tests, written
// against the earlier builder, keep working. Either way it is the API value,
// never the stored postsTotal.
const FX_THREAD_ROW = require('./fixtures/user-forumthreads.json').forumThreads[0];
const FX_POST_ROW = require('./fixtures/user-forumposts.json').forumPosts[1];   // a reply, not the topic
const FX_THREAD = require('./fixtures/forum-thread.json').thread;
const FIXTURE_SELF_ID = FX_THREAD_ROW.author.id;   // the key owner in every fixture (1000)

function clone(o) { return JSON.parse(JSON.stringify(o)); }
function pick(v, fallback) { return v === undefined ? fallback : v; }

// ForumThreadAuthor requires id, username and karma. `karma` overrides the
// fixture's figure; `noKarma` drops the key, to model schema drift (#10).
function applyKarma(row, o) {
  if (o.karma === undefined && !o.noKarma) return;
  row.author = Object.assign({}, row.author);
  if (o.noKarma) delete row.author.karma;
  else row.author.karma = o.karma;
}

function forumThreadsPayload(threads) {
  return {
    forumThreads: threads.map((t) => {
      const row = Object.assign(clone(FX_THREAD_ROW), {
        id: t.id,
        forum_id: pick(t.forumId, FX_THREAD_ROW.forum_id),
        title: pick(t.title, `Thread ${t.id}`),
        posts: pick(t.replies, pick(t.total, FX_THREAD_ROW.posts)),
        first_post_time: pick(t.firstAt, FX_THREAD_ROW.first_post_time),
        last_post_time: pick(t.lastAt, FX_THREAD_ROW.last_post_time),
        new_posts: pick(t.newPosts, FX_THREAD_ROW.new_posts),
      });
      if (t.author) row.author = t.author;
      // ForumThreadBase requires rating (docs/reference/torn-openapi-forum-excerpt-2026-10-08.json).
      if (t.rating !== undefined) row.rating = t.rating;
      if (t.noRating) delete row.rating;
      applyKarma(row, t);
      if (t.lastPoster !== undefined) row.last_poster = t.lastPoster;
      if (t.noNewPosts) delete row.new_posts;
      return row;
    }),
    _metadata: { links: { prev: null, next: null } },
  };
}

function forumPostsPayload(posts) {
  return {
    forumPosts: posts.map((p) => {
      const row = Object.assign(clone(FX_POST_ROW), {
        id: p.id,
        thread_id: p.threadId,
        created_time: pick(p.at, FX_POST_ROW.created_time),
        is_topic: p.isTopic === true,
        content: pick(p.content, 'SECRET POST BODY ' + p.id),
      });
      if (p.author) row.author = p.author;
      applyKarma(row, p);
      return row;
    }),
    _metadata: { links: { prev: null, next: null } },
  };
}

// forum/{id}/thread. `replies` is the raw `posts` value, as above.
function forumThreadPayload(t) {
  const thread = Object.assign(clone(FX_THREAD), {
    id: t.id,
    forum_id: pick(t.forumId, FX_THREAD.forum_id),
    title: pick(t.title, `Thread ${t.id}`),
    posts: pick(t.replies, FX_THREAD.posts),
    last_post_time: pick(t.lastAt, FX_THREAD.last_post_time),
  });
  if (t.lastPoster !== undefined) thread.last_poster = t.lastPoster;
  if (t.noPosts) delete thread.posts;
  return { thread };
}

// A real, redacted Torn answer saved by #14 (tests/fixtures/). Every call parses
// afresh, so a test may mutate its copy without touching the next test's.
function loadFixture(name) {
  return JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', name + '.json'), 'utf8'));
}

// One real posts page standing in for many threads: every post's thread_id is
// set to `threadId`, and `body`, when given, replaces every post's content so a
// test can prove a post body never reaches storage or a report. Nothing else is
// changed, so the likes, dislikes and is_topic flags stay Torn's own.
function fixturePosts(name, threadId, body) {
  const page = loadFixture(name);
  page.posts.forEach((p) => {
    p.thread_id = threadId;
    if (body !== undefined) p.content = body;
  });
  return page;
}

// user/profile, UserProfileResponse. Only karma is read by the script.
function profilePayload(karma) {
  return { profile: karma === undefined ? {} : { karma } };
}

module.exports = {
  loadUserscript, readSource, buildInstrumentedSource, makeSandbox,
  EXPORT_NAMES, SOURCE_PATH, DEFAULT_LOCATION, FORUMS_LOCATION,
  subscribedThreadsPayload, forumFeedPayload,
  forumThreadsPayload, forumPostsPayload, forumThreadPayload, FIXTURE_SELF_ID,
  loadFixture, fixturePosts, profilePayload,
};
