// Reference implementation for the #58 Drafts rich editor plan
// (docs/superpowers/plans/2026-10-09-drafts-rich-editor.md).
//
// NOT loaded by anything. Each plan task names the sections of this file it
// pastes into the userscript's engine section (between ENGINE START and
// ENGINE END), already indented for that IIFE. It was prototyped and checked
// in Node before the plan was written: cleaning is idempotent, Markdown
// round-trips every cleaned fixture (the published sample post, the owner's
// toolbar test and 19 edge cases), hostile input is neutralised, and the
// worst hostile input found costs under 200ms.
//
// It relies on helpers the userscript already has: isPlainObject and
// safeString. It defines URL_MAX_CHARS and EDITOR_BG once each.
//
// ASCII only, like the userscript. Every non-ASCII character is a backslash-u escape.
// Copy it with a tool that keeps escapes as typed: one editor in this repo's
// history turned them into the characters themselves, which Torn PDA's
// quote rewrite then breaks.
'use strict';
(function () {
  // ---- #58 editor constants ----------------------------------------------
  var DRAFT_LANGS = Object.freeze(['md', 'html', 'text']);
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
  // hostile 100000-character draft costs one pass.
  function tokenizeHtml(html) {
    var s = String(html || '').slice(0, CLEAN_MAX_CHARS);
    var lower = s.toLowerCase();
    var out = [];
    var n = s.length;
    var i = 0;
    var textStart = 0;
    function flush(to) {
      if (to > textStart) out.push({ type: 'text', text: decodeEntities(s.slice(textStart, to)), pos: textStart });
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
        out.push({ type: 'close', tag: tag, pos: start });
      } else {
        out.push({ type: 'open', tag: tag, attrs: attrs, selfClose: selfClose || VOID_TAGS[tag] === true, pos: start });
        if (RAW_TEXT_TAGS[tag] && !selfClose) {
          var endTag = lower.indexOf('</' + tag, j);
          var stop = endTag === -1 ? n : endTag;
          if (stop > j) out.push({ type: 'text', text: s.slice(j, stop), raw: true, pos: j });
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
        if (!tok.raw) top.children.push({ text: tok.text });
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
          + 'px;"><strong>' + mdInline(h[2]) + '</strong></span></p>' });
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

  function htmlToMd(html) {
    var root = buildCleanTree(tokenizeHtml(cleanTornHtml(html)));
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

  var HTML_BLOCK_OPEN = Object.freeze({
    p: true, h1: true, h2: true, h3: true, h4: true, h5: true, h6: true, ul: true, ol: true,
    blockquote: true, table: true, div: true,
  });

  // Where each top-level block starts in HTML the player typed, so a tap on
  // the preview can put the caret there.
  function htmlBlockOffsets(src) {
    var toks = tokenizeHtml(src);
    var depth = 0;
    var out = [];
    for (var i = 0; i < toks.length; i += 1) {
      var t = toks[i];
      if (t.type === 'open' && !t.selfClose) {
        if (depth === 0 && HTML_BLOCK_OPEN[t.tag]) out.push(t.pos);
        depth += 1;
      } else if (t.type === 'close') {
        depth = Math.max(0, depth - 1);
      }
    }
    return out;
  }

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
    if (lang === 'html') {
      var offs = htmlBlockOffsets(src);
      var root = buildCleanTree(tokenizeHtml(src));
      var parts = [];
      for (var k = 0; k < root.children.length; k += 1) {
        var h = serBlocks([root.children[k]]);
        if (h) parts.push(h);
      }
      return parts.map(function (h, idx) {
        return { html: h, offset: offs.length ? offs[Math.min(idx, offs.length - 1)] : 0 };
      });
    }
    if (src === '') return [];
    var lineStarts = lineOffsets(src);
    return src.split('\n').map(function (line, idx) {
      return { html: textToHtml(line === '' ? ' ' : line), offset: lineStarts[idx] };
    });
  }

  // ---- conversion entry points -----------------------------------------------

  function postHtml(text, lang) {
    if (lang === 'md') return mdToHtml(text);
    if (lang === 'html') return cleanTornHtml(text);
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
    var m = /^https:\/\/([^\/?#\s]+)([^\s"'<>`]*)$/i.exec(u);
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

  // Every image link in a draft that the fixer can rewrite, rewritten.
  function fixAllImages(lang, text) {
    var changed = 0;
    var src = String(text || '');
    if (lang === 'md') {
      src = src.replace(/(!\[[^\]\n]*\]\()([^)\s]+)(\))/g, function (all, a, url, b) {
        var r = fixImageUrl(url);
        if (r.status !== 'fixed') return all;
        changed += 1;
        return a + r.url + b;
      });
    } else if (lang === 'html') {
      // Single- or double-quoted src, as players type either.
      src = src.replace(/(<img\b[^>]*?\bsrc=)(["'])([^"']*)\2/gi, function (all, a, q, url) {
        var r = fixImageUrl(url.replace(/&amp;/g, '&'));
        if (r.status !== 'fixed') return all;
        changed += 1;
        return a + q + r.url.replace(/&/g, '&amp;') + q;
      });
    }
    return { text: src, changed: changed };
  }

  // ---- custom colour contrast (#58) ------------------------------------------

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

  // The themes a custom colour is hard to read in (WCAG AA, 4.5:1), against the
  // editor backgrounds the owner measured.
  function colorWarnings(hex) {
    var out = [];
    ['light', 'dark'].forEach(function (theme) {
      var r = contrastRatio(hex, EDITOR_BG[theme]);
      if (r && r < 4.5) out.push({ theme: theme, ratio: Math.floor(r * 10) / 10 });
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

  function applyMark(lang, text, start, end, mark, value) {
    var pair = markPair(lang, mark, value);
    var placeholder = mark === 'link' ? 'link text' : 'text';
    return wrapSelection(text, start, end, pair[0], pair[1], placeholder);
  }

  // Quote and alignment act on whole lines.
  function applyBlockMark(lang, text, start, end, mark, value) {
    var t = String(text || '');
    var s = clampSel(t, start, end);
    var b = lineBounds(t, s[0], s[1]);
    var body = t.slice(b[0], b[1]);
    var replaced;
    if (lang === 'md') {
      replaced = mark === 'quote'
        ? body.split('\n').map(function (l) { return l.trim() === '' ? '>' : '> ' + l; }).join('\n')
        : ':::' + value + '\n' + body + '\n:::';
    } else {
      var paras = body.split('\n').map(function (l) { return l.trim() === '' ? '' : l; }).join('\n');
      replaced = mark === 'quote'
        ? '<blockquote><p>' + paras + '</p></blockquote>'
        : '<p style="text-align: ' + value + ';">' + paras + '</p>';
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
})();
