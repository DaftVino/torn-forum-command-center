/*
 * Contrast audit - run manually, never part of `npm test`.
 *
 *   node tests/render-preview.mjs
 *   node tests/contrast-audit.mjs
 *
 * Renders each preview in a real browser and measures the WCAG contrast ratio
 * of every element's text against its effective background. The unit tests
 * assert on the CSS text; this measures what a browser actually paints, which
 * is the only way to catch a colour nobody set.
 *
 * It found the bug it was written for: links in the Search and Drafts views had
 * no colour rule of their own, so they fell back to the browser default of
 * rgb(0, 0, 238) - all but black against the dark panel. Only .tfcc-row-title a
 * had ever been styled.
 *
 * Requires the gstack browse binary. If that is not available this exits with a
 * message rather than pretending to have checked anything.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.join(here, '..');
const previews = path.join(repo, 'preview');

// The binary is browse on a posix box and browse.exe on Windows.
const BROWSE_DIR = path.join(os.homedir(), '.claude', 'skills', 'gstack', 'browse', 'dist');
const BROWSE = [path.join(BROWSE_DIR, 'browse'), path.join(BROWSE_DIR, 'browse.exe')]
  .find((p) => fs.existsSync(p));
if (!BROWSE) {
  console.error('The gstack browse binary is not in ' + BROWSE_DIR);
  console.error('Nothing was measured. Do not record this run as a pass.');
  process.exit(2);
}
if (!fs.existsSync(previews)) {
  console.error('No previews found. Run `node tests/render-preview.mjs` first.');
  process.exit(2);
}

// WCAG AA: 4.5:1 for body text, 3:1 for large text (>=24px, or >=19px bold).
const MIN_NORMAL = 4.5;
const MIN_LARGE = 3;

const SCRIPT = `
(() => {
  const panel = document.getElementById('tfcc-panel');
  if (!panel) return JSON.stringify({ error: 'no panel' });

  const parse = (c) => {
    const m = /rgba?\\((\\d+),\\s*(\\d+),\\s*(\\d+)(?:,\\s*([\\d.]+))?/.exec(c || '');
    return m ? { r: +m[1], g: +m[2], b: +m[3], a: m[4] === undefined ? 1 : +m[4] } : null;
  };
  const lum = (c) => {
    const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
  };
  const ratio = (a, b) => {
    const l1 = lum(a), l2 = lum(b);
    return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
  };
  // Walk up until something actually paints a background, the way a browser
  // composites it. An element with no background of its own is not the thing
  // its text sits on.
  // #43: the panel and its rows are translucent, so a background is the
  // composite of every layer down to the first opaque one, or down to the
  // page. An underlay preview names what is under the page (data-underlay):
  // a pattern lists each of its colours, and the worst for the text wins.
  const underlays = (() => {
    const u = document.body.getAttribute('data-underlay');
    if (!u) return null;
    return u.split(';').map((t) => { const c = t.split(',').map(Number); return { r: c[0], g: c[1], b: c[2], a: 1 }; });
  })();
  const over = (top, base) => ({ r: top.r * top.a + base.r * (1 - top.a), g: top.g * top.a + base.g * (1 - top.a),
    b: top.b * top.a + base.b * (1 - top.a), a: 1 });
  const effectiveBgs = (el) => {
    const layers = [];
    let base = null;
    let node = el;
    while (node) {
      if (underlays && node === document.body) break;
      const bg = parse(getComputedStyle(node).backgroundColor);
      if (bg && bg.a > 0) {
        if (bg.a >= 0.999) { base = [bg]; break; }
        layers.push(bg);
      }
      node = node.parentElement;
    }
    const bases = base || underlays || [{ r: 255, g: 255, b: 255, a: 1 }];
    return bases.map((b) => layers.slice().reverse().reduce((acc, l) => over(l, acc), b));
  };
  // The background a mark sits on: for a foreground, the composite it has the
  // least contrast with.
  const effectiveBg = (el, fg) => {
    const all = effectiveBgs(el);
    if (!fg) return all[0];
    return all.reduce((w, b) => (ratio(fg, b) < ratio(fg, w) ? b : w), all[0]);
  };

  const out = [];
  let prioSeen = 0;
  // #43: the worst ratio seen for each kind of text, for the underlay report:
  // nav labels, meta text (meta lines, notes, post text, explanations) and
  // body text (everything else).
  const cats = {};
  const note = (cat, r, text) => {
    if (!cats[cat] || r < cats[cat].r) cats[cat] = { r: Math.round(r * 100) / 100, text: String(text || '').trim().slice(0, 40) };
  };
  panel.querySelectorAll('*').forEach((el) => {
    // Only elements that paint their own text, so a container is not blamed
    // for the contrast of a child that sets its own colour.
    const own = Array.from(el.childNodes).some((n) => n.nodeType === 3 && n.textContent.trim());
    if (!own) return;
    // #33: the nav numeral is decorative (aria-hidden) and below 3:1 by the
    // owner's choice; the label over it is measured below instead.
    if (el.closest('.tfcc-navnum')) return;
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') return;

    const fg = parse(cs.color);
    if (!fg) return;
    const bg = effectiveBg(el, fg);
    const size = parseFloat(cs.fontSize) || 14;
    const bold = (parseInt(cs.fontWeight, 10) || 400) >= 700;
    const large = size >= 24 || (bold && size >= 19);
    const r = ratio(fg, bg);
    const need = large ? ${MIN_LARGE} : ${MIN_NORMAL};
    note(el.closest('.tfcc-nav') ? 'nav' : el.closest('.tfcc-meta, .tfcc-note, .tfcc-hit-text, .tfcc-infotext') ? 'meta' : 'body',
      r, el.textContent);
    // Text on a thread row sits on the 75% surface, not straight on the panel.
    if (el.closest('.tfcc-row') && !el.closest('button, select, input')) note('row', r, el.textContent);
    // #45: the priority number's own blue, measured where it sits (the row's
    // meta line, the wide title line, the narrow drawer).
    if (el.classList.contains('tfcc-prio')) { prioSeen += 1; note('prio', r, el.textContent); }
    if (r >= need) return;

    out.push({
      tag: el.tagName.toLowerCase(),
      cls: String(el.className || '').slice(0, 40),
      color: cs.color,
      bg: 'rgb(' + bg.r + ', ' + bg.g + ', ' + bg.b + ')',
      ratio: Math.round(r * 100) / 100,
      need: need,
      text: (el.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 50),
    });
  });
  // Non-text marks (#10's karma icon): an inline SVG painted in currentColor
  // has no text node, so the walk above never sees it. WCAG 1.4.11 asks 3:1
  // for a graphic that carries meaning.
  panel.querySelectorAll('svg').forEach((el) => {
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') return;
    const fg = parse(cs.color);
    if (!fg) return;
    const bg = effectiveBg(el, fg);
    const r = ratio(fg, bg);
    if (r >= ${MIN_LARGE}) return;
    out.push({
      tag: 'svg',
      cls: String((el.parentElement && el.parentElement.className) || '').slice(0, 40) + ' (icon)',
      color: cs.color,
      bg: 'rgb(' + bg.r + ', ' + bg.g + ', ' + bg.b + ')',
      ratio: Math.round(r * 100) / 100,
      need: ${MIN_LARGE},
      text: el.parentElement ? (el.parentElement.getAttribute('aria-label') || '') : '',
    });
  });
  // #43: every info button is a bare icon. No fill and no visible border of
  // its own, so its glyph (WCAG 1.4.11, a meaningful graphic) is measured at
  // 3:1 or better against whatever the button sits on, and in its hover and
  // open tint too.
  const infoBad = [];
  let infoIcons = 0;
  panel.querySelectorAll('button.tfcc-info').forEach((b) => {
    if (b.closest('[hidden]') || getComputedStyle(b).display === 'none') return;
    const cs = getComputedStyle(b);
    const fill = parse(cs.backgroundColor);
    const edge = parse(cs.borderTopColor);
    if (fill && fill.a > 0) infoBad.push('an info button has a fill (' + cs.backgroundColor + ')');
    if (edge && edge.a > 0 && parseFloat(cs.borderTopWidth) > 0) infoBad.push('an info button has a visible border');
    if (b.getBoundingClientRect().width < 23.5) infoBad.push('an info button target under 24px');
    const glyph = b.querySelector('svg');
    if (!glyph) { infoBad.push('an info button has no icon'); return; }
    infoIcons += 1;
    const tints = [parse(getComputedStyle(glyph).color), parse(getComputedStyle(panel).getPropertyValue('--tm-accent-text').trim()
      .replace(/^#(..)(..)(..)$/, (m, r, g, bl) => 'rgb(' + parseInt(r, 16) + ', ' + parseInt(g, 16) + ', ' + parseInt(bl, 16) + ')'))];
    tints.forEach((fg, i) => {
      if (!fg) return;
      const bg = effectiveBg(b, fg);
      const r = ratio(fg, bg);
      note('icon', r, b.getAttribute('aria-label'));
      if (r < ${MIN_LARGE}) out.push({ tag: 'info', cls: 'tfcc-info (' + (i ? 'hover/open tint' : 'icon') + ')', color: 'rgb(' + fg.r + ', ' + fg.g + ', ' + fg.b + ')',
        bg: 'rgb(' + bg.r + ', ' + bg.g + ', ' + bg.b + ')', ratio: Math.round(r * 100) / 100, need: ${MIN_LARGE}, text: b.getAttribute('aria-label') });
    });
  });
  // #30: the elements this audit must have measured, so a preview that stops
  // rendering them fails rather than passing by omission.
  // #33, spec 13f: every nav label at 4.5:1 or better over the numeral painted
  // on its cell (or over the cell, where there is no numeral), composited
  // exactly as the mockup's in-page script does.
  const mix = (fg, bg, a) => ({ r: fg.r * a + bg.r * (1 - a), g: fg.g * a + bg.g * (1 - a), b: fg.b * a + bg.b * (1 - a), a: 1 });
  panel.querySelectorAll('.tfcc-navgrid button').forEach((cell) => {
    const lab = cell.querySelector('.tfcc-navlab');
    if (!lab) return;
    const fg = parse(getComputedStyle(cell).color);
    const bg = effectiveBg(cell, fg);
    const numEl = cell.querySelector('.tfcc-navnum');
    const under = numEl ? mix(fg, bg, parseFloat(getComputedStyle(numEl).opacity)) : bg;
    const label = mix(fg, under, parseFloat(getComputedStyle(lab).opacity));
    const r = ratio(label, under);
    note('nav', r, lab.textContent);
    if (r >= ${MIN_NORMAL}) return;
    out.push({ tag: 'nav', cls: 'tfcc-navlab', color: 'composited', bg: 'numeral', ratio: Math.round(r * 100) / 100,
      need: ${MIN_NORMAL}, text: lab.textContent });
  });
  // #33, spec 13b: the narrow header stays on one line. Every header button
  // shares one top, the header is no taller than a button (plus a pixel of
  // rounding), and no button is under the 24px floor.
  const head = panel.classList.contains('tfcc-narrow') ? panel.querySelector('.tfcc-head') : null;
  const headBad = [];
  const headInfo = {};
  if (head) {
    const btns = Array.from(head.querySelectorAll('.tfcc-head-btns button'));
    const tops = new Set(btns.map((b) => Math.round(b.getBoundingClientRect().top)));
    const tallest = Math.max(...btns.map((b) => b.getBoundingClientRect().height));
    if (tops.size !== 1) headBad.push('header buttons on ' + tops.size + ' lines');
    if (btns.some((b) => b.getBoundingClientRect().width < 23.5)) headBad.push('a header button under 24px');
    const ctl = head.querySelector('.tfcc-head-ctl').getBoundingClientRect();
    // The buttons share the logo group's line: they start above its bottom.
    // (Collapsed, the bare count may wrap inside that group, which makes it
    // taller and centres the buttons lower; that is allowed, spec 4.1.)
    const idBox = head.querySelector('.tfcc-head-id').getBoundingClientRect();
    if (ctl.top >= idBox.bottom - 1) headBad.push('the buttons wrapped under the logo');
    if (!(tallest > 0)) headBad.push('no header buttons measured');
    // Expanded, nothing may wrap at all: a logo or chip on a second line makes
    // the header taller than one button. Collapsed, the bare count may wrap
    // under the logo only when even 24px buttons cannot hold it (spec 13b):
    // the Node half allows that at 280px only.
    headInfo.collapsed = !!head.querySelector('.tfcc-hshow');
    headInfo.height = Math.round(head.getBoundingClientRect().height);
    headInfo.row = Math.round(tallest);
  }
  // PR #38 review: an info button sits on the line of the control it follows.
  const infoOff = [];
  panel.querySelectorAll('button.tfcc-info').forEach((b) => {
    const cs = getComputedStyle(b);
    if (cs.display === 'none' || b.closest('[hidden]')) return;
    const prev = b.previousElementSibling;
    if (!prev) return;
    const r = b.getBoundingClientRect();
    const p = prev.getBoundingClientRect();
    if (!(r.top < p.bottom && r.bottom > p.top)) infoOff.push(b.getAttribute('data-info'));
  });
  // #39: the Catch up actions share one line at every width. Their tops match
  // (the bar stretches its items), so a wrapped control shows as a second top.
  const polishBad = [];
  const cubar = panel.classList.contains('tfcc-narrow') ? panel.querySelector('.tfcc-cubar') : null;
  let cuMode = '';
  let cuWidths = '';
  if (cubar) {
    cuMode = panel.classList.contains('tfcc-cu-wrap') ? 'wrap' : panel.classList.contains('tfcc-cu-short') ? 'short' : 'full';
    const ctl = ['button[data-act="markall"]', 'button[data-act="catchup-done"]', 'button[data-info="catchup"]']
      .map((s) => cubar.querySelector(s));
    if (ctl.some((b) => !b)) polishBad.push('a Catch up control is missing');
    else {
      // One line: every control overlaps one horizontal band. (In the wrap
      // fallback the label buttons grow taller and the info button stays
      // centred, so their tops differ while they share the row.)
      const rs = ctl.map((b) => b.getBoundingClientRect());
      if (!(Math.max(...rs.map((r) => r.top)) < Math.min(...rs.map((r) => r.bottom)))) {
        polishBad.push('the Catch up actions are not on one line (' + cuMode + ')');
      }
      if (rs.some((r, i) => i > 0 && r.left < rs[i - 1].right)) polishBad.push('the Catch up actions overlap');
      // PR #40 review: no label overflows its button, and in the wrap
      // fallback the two label buttons share the width equally.
      ctl.forEach((b) => {
        if (b.scrollWidth > b.clientWidth) {
          polishBad.push('"' + b.getAttribute('aria-label') + '" overflows its button (' + b.scrollWidth + ' > ' + b.clientWidth + ')');
        }
      });
      if (cuMode === 'wrap' && Math.abs(rs[0].width - rs[1].width) > 1) {
        polishBad.push('the wrap fallback splits the labels ' + Math.round(rs[0].width) + ' / ' + Math.round(rs[1].width) + ', not equally');
      }
      cuWidths = rs.map((r) => Math.round(r.width)).join(' / ');
      const right = Math.max(...ctl.map((b) => b.getBoundingClientRect().right));
      if (right > cubar.getBoundingClientRect().right + 1) polishBad.push('the Catch up actions overflow the bar');
      if (ctl.some((b) => b.getBoundingClientRect().height < 43.5)) polishBad.push('a Catch up action under 44px');
    }
  }
  // #39: the drawer's Pin, Draft and Archive (and Mark read) share one row;
  // every drawer target is at least 24px, with 8px between the buttons.
  // #43: priority (number, + and -) shares that row, right-aligned. The row
  // never wraps or overflows; its targets are 24px or more; the gaps are 8px
  // on a row of 236px or more, and close toward 4px only below that (Threads
  // at 280px). The geometry is reported for each drawer page.
  const drawerBtns = panel.querySelector('.tfcc-drawer-btns');
  let drawerGeo = '';
  if (drawerBtns) {
    const btns = Array.from(drawerBtns.querySelectorAll('button'));
    const rects = btns.map((b) => b.getBoundingClientRect());
    const box = drawerBtns.getBoundingClientRect();
    if (new Set(rects.map((r) => Math.round(r.top))).size !== 1) polishBad.push('the drawer buttons wrapped');
    if (rects.some((r) => r.right > box.right + 0.5)) polishBad.push('the drawer buttons overflow their row');
    const minGap = box.width >= 236 ? 7.5 : 3.5;
    const gaps = [];
    for (let i = 1; i < rects.length; i += 1) {
      const g = rects[i].left - rects[i - 1].right;
      gaps.push(Math.round(g * 10) / 10);
      if (g < minGap) polishBad.push('drawer buttons closer than ' + Math.round(minGap) + 'px on a ' + Math.round(box.width) + 'px row');
    }
    const up = drawerBtns.querySelector('[data-act="prio-up"]');
    const down = drawerBtns.querySelector('[data-act="prio-down"]');
    const num = drawerBtns.querySelector('.tfcc-prio');
    if (!up || !down || !num) polishBad.push('the drawer priority group is missing');
    else {
      const n = num.getBoundingClientRect();
      if (!(n.right <= up.getBoundingClientRect().left && up.getBoundingClientRect().right <= down.getBoundingClientRect().left)) {
        polishBad.push('the drawer priority is not number, +, - in order');
      }
      if (Math.abs(down.getBoundingClientRect().right - box.right) > 1) polishBad.push('the drawer priority is not right-aligned');
    }
    drawerGeo = 'row ' + Math.round(box.width) + 'px, targets ' + rects.map((r) => Math.round(r.width) + 'x' + Math.round(r.height)).join(' ')
      + ', gaps ' + gaps.join(' ');
  }
  // #43 (PR #44 review): My posts is set exactly like the other nav buttons:
  // the same font weight as theirs at this width, whatever that is.
  const navBtns = Array.from(panel.querySelectorAll('.tfcc-nav button[data-act="view"]'));
  const mineBtn = navBtns.find((b) => b.getAttribute('data-view') === 'mine');
  if (mineBtn) {
    const weights = new Set(navBtns.map((b) => getComputedStyle(b).fontWeight));
    if (weights.size !== 1) polishBad.push('the nav buttons differ in weight: ' + Array.from(weights).join(' / '));
  }
  // #43: folder, Tag and Note share one row that never wraps or overflows;
  // the tag or note popup, when open, sits inside the drawer with its field
  // and both buttons inside it.
  const org = panel.querySelector('.tfcc-drawer-org');
  let editorSeen = false;
  if (org) {
    const kids = Array.from(org.children).map((k) => k.getBoundingClientRect());
    const box = org.getBoundingClientRect();
    if (!(Math.max(...kids.map((r) => r.top)) < Math.min(...kids.map((r) => r.bottom)))) polishBad.push('folder, Tag and Note are not on one line');
    if (kids.some((r) => r.right > box.right + 0.5 || r.left < box.left - 0.5)) polishBad.push('the folder row overflows');
    for (let i = 1; i < kids.length; i += 1) if (kids[i].left - kids[i - 1].right < 7.5) polishBad.push('folder row targets closer than 8px');
  }
  const editor = panel.querySelector('.tfcc-editor[role="dialog"]');
  if (editor) {
    editorSeen = true;
    const e = editor.getBoundingClientRect();
    const d = editor.closest('.tfcc-drawer').getBoundingClientRect();
    if (e.left < d.left - 0.5 || e.right > d.right + 0.5) polishBad.push('the popup leaves its drawer');
    for (const k of editor.querySelectorAll('input, button')) {
      const r = k.getBoundingClientRect();
      if (r.left < e.left || r.right > e.right) polishBad.push('a popup control leaves the popup');
    }
    if (!editor.getAttribute('aria-label')) polishBad.push('the popup has no name');
  }
  const drawerTargets = Array.from(panel.querySelectorAll('.tfcc-drawer button, .tfcc-drawer select, .tfcc-drawer input'));
  for (const el of drawerTargets) {
    const r = el.getBoundingClientRect();
    if (r.width < 23.5 || r.height < 23.5) {
      polishBad.push('a drawer target is ' + Math.round(r.width) + 'x' + Math.round(r.height) + ' (' + (el.getAttribute('data-act') || el.tagName) + ')');
    }
  }
  // #39, switched by #41's setting (tfcc-clip): with it on, a closed row's
  // title and note are one line at every width, and the narrow meta too; with
  // it off, nothing is cut. An open narrow row shows its text whole.
  const clip = panel.classList.contains('tfcc-clip');
  const isNarrow = panel.classList.contains('tfcc-narrow');
  const multiLine = (el) => {
    const cs = getComputedStyle(el);
    const lh = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.4;
    const pad = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
    return el.getBoundingClientRect().height - pad > lh * 1.5;
  };
  // Cut means clipped out of sight: hidden overflow with more content than
  // box. Visible overflow is checked by the containment test below.
  const isCut = (el) => getComputedStyle(el).overflowX === 'hidden' && el.scrollWidth > el.clientWidth + 1;
  // PR #42 review: a row whose text is meant to be whole (an open row, or any
  // row with clipping off) must keep every meta part inside the row's content
  // box and clear of every button in the row, or a part is hidden under them.
  const hits = (a, b) => a.left < b.right - 0.5 && b.left < a.right - 0.5 && a.top < b.bottom - 0.5 && b.top < a.bottom - 0.5;
  panel.querySelectorAll(clip ? '.tfcc-row.tfcc-open' : '.tfcc-row').forEach((row) => {
    const rs = getComputedStyle(row);
    const r = row.getBoundingClientRect();
    const box = { left: r.left + parseFloat(rs.borderLeftWidth) + parseFloat(rs.paddingLeft) - 0.5,
      right: r.right - parseFloat(rs.borderRightWidth) - parseFloat(rs.paddingRight) + 0.5 };
    const buttons = Array.from(row.querySelectorAll('.tfcc-row-btns button')).map((b) => b.getBoundingClientRect());
    row.querySelectorAll('.tfcc-meta > *').forEach((part) => {
      const p = part.getBoundingClientRect();
      if (!p.width) return;
      const m = part.parentElement.getBoundingClientRect();
      if (p.left < box.left || p.right > box.right) polishBad.push('a meta part ("' + part.textContent + '") leaves its row');
      if (p.left < m.left - 0.5 || p.right > m.right + 0.5) polishBad.push('a meta part ("' + part.textContent + '") leaves its meta column');
      if (buttons.some((b) => hits(p, b))) polishBad.push('a meta part ("' + part.textContent + '") sits under a row button');
    });
  });
  const closedText = Array.from(panel.querySelectorAll(isNarrow
    ? '.tfcc-row:not(.tfcc-open) .tfcc-row-title a, .tfcc-row:not(.tfcc-open) > .tfcc-note, .tfcc-row:not(.tfcc-open) .tfcc-row-l2 .tfcc-meta'
    : '.tfcc-row-main .tfcc-row-title, .tfcc-row > .tfcc-note'));
  let cut = 0;
  let wrapped = 0;
  for (const el of closedText) {
    if (multiLine(el)) wrapped += 1;
    if (isCut(el)) cut += 1;
  }
  if (clip && wrapped) polishBad.push(wrapped + ' closed row text(s) take more than one line with clipping on');
  if (!clip && cut) polishBad.push(cut + ' row text(s) are cut with clipping off');
  // Wide, a cut title or note carries its full text as a tooltip.
  if (!isNarrow) {
    for (const el of closedText) {
      if (clip && isCut(el) && el.getAttribute('title') !== el.textContent) polishBad.push('a cut wide row text has no full tooltip');
    }
  }
  let openWhole = 0;
  panel.querySelectorAll('.tfcc-row.tfcc-open .tfcc-row-title a, .tfcc-row.tfcc-open > .tfcc-note, .tfcc-row.tfcc-open .tfcc-row-l2 .tfcc-meta').forEach((el) => {
    if (isCut(el)) polishBad.push('an open row\\'s text is cut');
    else if (multiLine(el)) openWhole += 1;
  });
  // #39: the drawer emoji, monochrome per theme with the thumbs' filter, and
  // the colour that filter paints (white on dark, black on light) at 3:1 or
  // better against what it sits on (WCAG 1.4.11, a meaningful graphic).
  const light = panel.classList.contains('tfcc-theme-light');
  const emos = Array.from(panel.querySelectorAll('.tfcc-emo'));
  for (const el of emos) {
    const f = getComputedStyle(el).filter;
    const want = light ? 'grayscale(1) brightness(0)' : 'grayscale(1) brightness(0) invert(1)';
    if (f !== want) { polishBad.push('emoji filter is "' + f + '", not "' + want + '"'); continue; }
    const ink = light ? { r: 0, g: 0, b: 0, a: 1 } : { r: 255, g: 255, b: 255, a: 1 };
    const r = ratio(ink, effectiveBg(el, ink));
    if (r < ${MIN_LARGE}) out.push({ tag: 'emoji', cls: 'tfcc-emo', color: light ? 'black' : 'white', bg: 'button',
      ratio: Math.round(r * 100) / 100, need: ${MIN_LARGE}, text: el.parentElement.getAttribute('aria-label') });
  }
  // #41: the archive icon paints its path in the button's currentColor, in
  // both themes, at 3:1 or better against the button (WCAG 1.4.11), and no
  // filter recolours it.
  const icos = Array.from(panel.querySelectorAll('svg.tfcc-archico'));
  for (const el of icos) {
    const path = el.querySelector('path');
    const fill = parse(getComputedStyle(path).fill);
    const own = parse(getComputedStyle(el.parentElement).color);
    if (getComputedStyle(el).filter !== 'none') polishBad.push('the archive icon has a filter');
    if (!fill || !own || fill.r !== own.r || fill.g !== own.g || fill.b !== own.b) {
      polishBad.push('the archive icon is ' + getComputedStyle(path).fill + ', not its button\\'s colour');
      continue;
    }
    const r = ratio(fill, effectiveBg(el, fill));
    if (r < ${MIN_LARGE}) out.push({ tag: 'icon', cls: 'tfcc-archico', color: getComputedStyle(path).fill, bg: 'button',
      ratio: Math.round(r * 100) / 100, need: ${MIN_LARGE}, text: el.parentElement.getAttribute('aria-label') });
    const box = el.getBoundingClientRect();
    if (Math.round(box.width) !== 18 || Math.round(box.height) !== 18) polishBad.push('the archive icon is ' + Math.round(box.width) + 'x' + Math.round(box.height));
  }
  // #45: the folder group toggles and the Settings order arrows keep their
  // targets: 44px on a narrow panel, 24px or more on a wide one.
  const narrowPanel = panel.classList.contains('tfcc-narrow');
  const grps = Array.from(panel.querySelectorAll('button.tfcc-grp'));
  // #47: and so do the claimed-forum chips' remove buttons.
  panel.querySelectorAll('button.tfcc-grp, button.tfcc-move, button.tfcc-unclaim').forEach((b) => {
    if (b.closest('[hidden]') || getComputedStyle(b).display === 'none') return;
    const r = b.getBoundingClientRect();
    const min = narrowPanel ? 43.5 : 23.5;
    const wide = !b.classList.contains('tfcc-grp');
    if (r.height < min || (wide && r.width < min)) {
      polishBad.push('"' + (b.getAttribute('aria-label') || b.textContent.trim()) + '" is ' + Math.round(r.width) + 'x' + Math.round(r.height));
    }
  });
  // #47: Settings. At every width no two controls overlap. Narrow (the
  // tighter layout), consecutive items in a section are at least 6px apart,
  // except a note or info bar that explains the row above it, which sits 4px
  // under it (3.5 allowed for rounding), so nothing collapses to zero. Wide
  // is main's layout, whose Backup buttons meet the text box, so it is not
  // held to the narrow gap.
  let setGaps = 0;
  const isSettings = !!panel.querySelector('[data-act="folder-forum"], [data-act="folder-name"]');
  if (isSettings) {
    const shown = (el) => !el.closest('[hidden]') && getComputedStyle(el).display !== 'none' && el.getBoundingClientRect().height > 0;
    const ctls = Array.from(panel.querySelectorAll('.tfcc-section button, .tfcc-section select, .tfcc-section input, '
      + '.tfcc-section textarea, .tfcc-section a.tfcc-linkbtn, .tfcc-section .tfcc-kv > label')).filter(shown);
    for (let i = 0; i < ctls.length; i += 1) {
      for (let j = i + 1; j < ctls.length; j += 1) {
        if (ctls[i].contains(ctls[j]) || ctls[j].contains(ctls[i])) continue;
        if (hits(ctls[i].getBoundingClientRect(), ctls[j].getBoundingClientRect())) {
          polishBad.push('Settings controls overlap: ' + (ctls[i].getAttribute('data-act') || ctls[i].tagName) + ' and '
            + (ctls[j].getAttribute('data-act') || ctls[j].tagName));
        }
      }
    }
    if (narrowPanel) panel.querySelectorAll('.tfcc-section').forEach((sec) => {
      const kids = Array.from(sec.children).filter(shown);
      for (let i = 1; i < kids.length; i += 1) {
        const gap = kids[i].getBoundingClientRect().top - kids[i - 1].getBoundingClientRect().bottom;
        const explains = kids[i - 1].classList.contains('tfcc-kv')
          && (kids[i].classList.contains('tfcc-infobar') || (kids[i].tagName === 'P' && kids[i].classList.contains('tfcc-note')));
        const min = explains ? 3.5 : 5.5;
        setGaps += 1;
        if (gap < min) {
          polishBad.push('Settings items ' + Math.round(gap * 10) / 10 + 'px apart, under ' + Math.round(min) + ' ('
            + (kids[i - 1].className || kids[i - 1].tagName) + ' / ' + (kids[i].className || kids[i].tagName) + ')');
        }
      }
    });
  }
  out.seen = {
    setGaps: setGaps,
    unclaims: panel.querySelectorAll('button.tfcc-unclaim').length,
    polishBad: polishBad.concat(infoBad),
    grp: grps.length,
    grpCollapsed: grps.filter((b) => b.getAttribute('aria-expanded') === 'false').length,
    moves: panel.querySelectorAll('button.tfcc-move').length,
    icos: icos.length,
    clip: clip,
    cut: cut,
    wrapped: wrapped,
    openWhole: openWhole,
    cuMode: cuMode,
    cuWidths: cuWidths,
    cubar: !!cubar,
    drawerBtns: !!drawerBtns,
    drawerGeo: drawerGeo,
    editorSeen: editorSeen,
    infoIcons: infoIcons,
    cats: cats,
    org: !!org,
    emos: emos.length,
    navcells: panel.querySelectorAll('.tfcc-navgrid button').length,
    headBad: headBad,
    headInfo: headInfo,
    infoOff: infoOff,
    logo: panel.querySelectorAll('svg.tfcc-logo').length,
    started: panel.querySelectorAll('.tfcc-started').length,
    prio: prioSeen,
  };
  return JSON.stringify({ rows: out, seen: out.seen });
})()
`;

const scriptFile = path.join(os.tmpdir(), 'tfcc-contrast-audit.js');
fs.writeFileSync(scriptFile, SCRIPT);

const pages = fs.readdirSync(previews).filter((f) => f.endsWith('.html')).sort();
let failures = 0;
// #43: the translucent panel over black, white and a busy underlay. Report
// only: we cannot know Torn's page (ADR 0001), so these say how bad it can
// get rather than gate the build. The same views in takeover are solid and
// are audited like every other page.
const UNDERLAY_RE = /^underlay-(black|white|busy)-(.+)-(dark|light)\.html$/;
const report = {};
let reportBelow = 0;

for (const page of pages) {
  spawnSync(BROWSE, ['load-html', path.join('preview', page)], { cwd: repo, encoding: 'utf8' });
  const run = spawnSync(BROWSE, ['eval', scriptFile], { cwd: repo, encoding: 'utf8' });
  const raw = (run.stdout || '').replace(/---[^\n]*---/g, '').trim();

  let rows;
  try {
    rows = JSON.parse(raw);
  } catch (e) {
    console.log(`?? ${page}: could not read the result (${raw.slice(0, 80)})`);
    failures += 1;
    continue;
  }
  if (rows.error) {
    console.log(`?? ${page}: ${rows.error}`);
    failures += 1;
    continue;
  }
  const seen = rows.seen || {};
  rows = rows.rows;
  const u = UNDERLAY_RE.exec(page);
  if (u) {
    const key = u[3] + ' / ' + u[1];
    report[key] = report[key] || {};
    for (const [cat, v] of Object.entries(seen.cats || {})) {
      if (!report[key][cat] || v.r < report[key][cat].r) report[key][cat] = Object.assign({ page: u[2] }, v);
    }
    const line = ['body', 'meta', 'nav', 'icon', 'prio'].filter((c) => seen.cats && seen.cats[c])
      .map((c) => c + ' ' + seen.cats[c].r).join(', ');
    console.log(`RR ${page}: worst ${line}; ${rows.length} below AA (report only)`);
    if (rows.length) reportBelow += 1;
    continue;
  }
  // Every preview has the header logo (#30), and every My posts preview has a
  // started row whose red "started" (#30) must have been measured.
  const missing = [];
  if (!seen.logo) missing.push('the FCC logo');
  if (page.startsWith('mine-') && !seen.started) missing.push('a red "started" tag');
  // #45: every Threads page, wide and narrow, has a row with a priority, so
  // its blue number must have been measured.
  if (/^(threads-|narrow-threads-|clip-)/.test(page) && !seen.prio) missing.push('the blue priority number');
  if (page.startsWith('narrow-') && !page.includes('-collapsed-') && !seen.navcells) missing.push('the narrow nav cells');
  // The narrow header is one row tall, except a collapsed header at 280px,
  // whose count may wrap when even 24px buttons cannot hold it (spec 13b).
  const hi = seen.headInfo || {};
  if (page.startsWith('narrow-') && hi.row && hi.height > hi.row + 1 && !(hi.collapsed && page.includes('-280-'))) {
    seen.headBad = (seen.headBad || []).concat(['the header is ' + hi.height + 'px tall, more than one ' + hi.row + 'px row']);
  }
  if (page.startsWith('narrow-') && page.includes('-280-') && hi.collapsed) {
    console.log(`.. ${page}: collapsed header ${hi.height}px for a ${hi.row}px row (the count may wrap here)`);
  }
  // At 320px and up an info button shares the line of the control it follows;
  // at 280px it may wrap, and the audit says where.
  if (page.startsWith('narrow-') && (seen.infoOff || []).length) {
    if (page.includes('-280-')) console.log(`.. ${page}: info button on its own line: ${seen.infoOff.join(', ')}`);
    else seen.headBad = (seen.headBad || []).concat(['info button off its control\'s line: ' + seen.infoOff.join(', ')]);
  }
  // #39: every narrow Catch up page has the one-line action row, and every
  // page with an open drawer has its button row and the emoji.
  // #45: every Catch up page has its folder group toggles; a collapsed page
  // has a collapsed one; every Settings page has the order arrows.
  if (/^(narrow-)?catchup-/.test(page) && !seen.grp) missing.push('a folder group toggle');
  if (/catchup-collapsed/.test(page) && !seen.grpCollapsed) missing.push('a collapsed folder group');
  if (/^(narrow-)?settings-/.test(page) && !seen.moves) missing.push('the folder order arrows');
  // #47: every Settings page measured its item gaps, and the claims pages
  // their chips.
  if (/^narrow-settings-/.test(page) && !seen.setGaps) missing.push('the Settings item gaps');
  if (/settings-claims/.test(page) && seen.unclaims < 3) missing.push('the claimed-forum chips');
  if (page.startsWith('narrow-catchup')) {
    if (!seen.cubar) missing.push('the Catch up action row');
    else console.log(`.. ${page}: Catch up labels ${seen.cuMode}, widths ${seen.cuWidths}`);
  }
  if (page.startsWith('narrow-') && page.includes('-drawer')) {
    if (!seen.drawerBtns) missing.push('the drawer button row');
    if (!seen.emos) missing.push('the drawer emoji');
    if (!seen.icos) missing.push('the archive icon');
    if (seen.drawerGeo) console.log(`.. ${page}: drawer ${seen.drawerGeo}`);
    if (!seen.org) missing.push('the folder, Tag and Note row');
    if (/-drawer-(tag|note)-/.test(page) && !seen.editorSeen) missing.push('the open tag or note popup');
  }
  // #41: the clip previews must show the setting doing its job: on cuts the
  // long title and summary, off wraps them, and an open long row is whole.
  if (page.startsWith('clip-on-') || /^narrow-threads-(\d|drawer-long)/.test(page)) {
    if (!seen.clip) missing.push('the tfcc-clip class');
    else if (!seen.cut) missing.push('a row text cut by the clip setting');
    else console.log(`.. ${page}: clip on, ${seen.cut} cut, open whole ${seen.openWhole}`);
  }
  if (page.startsWith('clip-off-') || page.startsWith('narrow-threads-clipoff-')) {
    if (seen.clip) missing.push('clipping off');
    else if (!seen.wrapped) missing.push('a row text that wraps with clipping off');
    else console.log(`.. ${page}: clip off, ${seen.wrapped} wrapped`);
  }
  if (page.startsWith('narrow-threads-drawer-long-') && !seen.openWhole) missing.push('the open long row shown whole');
  // #43: a view with info buttons must have measured their bare icons.
  if (/(^|-)(catchup|search|settings)(-|\.)/.test(page) && !page.startsWith('badges-') && !seen.infoIcons) missing.push('a bare info icon');
  if ((seen.polishBad || []).length) seen.headBad = (seen.headBad || []).concat(seen.polishBad);
  if (seen.headBad && seen.headBad.length) {
    console.log(`!! ${page}: ${seen.headBad.join('; ')}`);
    failures += seen.headBad.length;
  }
  if (missing.length) {
    console.log(`?? ${page}: nothing measured for ${missing.join(', ')}`);
    failures += 1;
    continue;
  }
  if (!rows.length) {
    console.log(`OK ${page}`);
    continue;
  }
  failures += rows.length;
  console.log(`!! ${page}: ${rows.length} element(s) below the WCAG AA threshold`);
  for (const r of rows.slice(0, 10)) {
    console.log(`     ${r.tag}.${r.cls || '(none)'} ${r.color} on ${r.bg} = ${r.ratio}:1, needs ${r.need}:1`);
    console.log(`       "${r.text}"`);
  }
}

// #43: the transparency table, worst case per theme and underlay.
if (Object.keys(report).length) {
  console.log('\nTranslucent panel, worst contrast per theme and underlay (report only; AA is 4.5 for text, 3 for icons):');
  console.log('| Theme / underlay | Body text | Meta text | Nav labels | Info icons | Any text on a row (75%) | Priority number |');
  console.log('|---|---|---|---|---|---|---|');
  for (const key of Object.keys(report).sort()) {
    const c = (k) => (report[key][k] ? report[key][k].r.toFixed(2) + ' (' + report[key][k].page + ')' : '-');
    console.log('| ' + key + ' | ' + c('body') + ' | ' + c('meta') + ' | ' + c('nav') + ' | ' + c('icon') + ' | ' + c('row') + ' | ' + c('prio') + ' |');
  }
  console.log(reportBelow + ' underlay preview(s) have text below AA; these are reported, not failed.');
}

console.log(`\n${failures === 0 ? 'Every preview passes WCAG AA.' : failures + ' contrast problem(s) found.'}`);
process.exit(failures === 0 ? 0 : 1);
