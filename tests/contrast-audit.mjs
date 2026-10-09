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
  const effectiveBg = (el) => {
    let node = el;
    while (node) {
      const bg = parse(getComputedStyle(node).backgroundColor);
      if (bg && bg.a > 0.5) return bg;
      node = node.parentElement;
    }
    return { r: 255, g: 255, b: 255, a: 1 };
  };

  const out = [];
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
    const bg = effectiveBg(el);
    const size = parseFloat(cs.fontSize) || 14;
    const bold = (parseInt(cs.fontWeight, 10) || 400) >= 700;
    const large = size >= 24 || (bold && size >= 19);
    const r = ratio(fg, bg);
    const need = large ? ${MIN_LARGE} : ${MIN_NORMAL};
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
    const bg = effectiveBg(el);
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
    const bg = effectiveBg(cell);
    const numEl = cell.querySelector('.tfcc-navnum');
    const under = numEl ? mix(fg, bg, parseFloat(getComputedStyle(numEl).opacity)) : bg;
    const label = mix(fg, under, parseFloat(getComputedStyle(lab).opacity));
    const r = ratio(label, under);
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
      const right = Math.max(...ctl.map((b) => b.getBoundingClientRect().right));
      if (right > cubar.getBoundingClientRect().right + 1) polishBad.push('the Catch up actions overflow the bar');
      if (ctl.some((b) => b.getBoundingClientRect().height < 43.5)) polishBad.push('a Catch up action under 44px');
    }
  }
  // #39: the drawer's Pin, Draft and Archive (and Mark read) share one row;
  // every drawer target is at least 24px, with 8px between the buttons.
  const drawerBtns = panel.querySelector('.tfcc-drawer-btns');
  if (drawerBtns) {
    const btns = Array.from(drawerBtns.querySelectorAll('button'));
    const rects = btns.map((b) => b.getBoundingClientRect());
    if (new Set(rects.map((r) => Math.round(r.top))).size !== 1) polishBad.push('the drawer buttons wrapped');
    for (let i = 1; i < rects.length; i += 1) {
      if (rects[i].left - rects[i - 1].right < 7.5) polishBad.push('drawer buttons closer than 8px');
    }
  }
  const drawerTargets = Array.from(panel.querySelectorAll('.tfcc-drawer button, .tfcc-drawer select, .tfcc-drawer input'));
  for (const el of drawerTargets) {
    const r = el.getBoundingClientRect();
    if (r.width < 23.5 || r.height < 23.5) {
      polishBad.push('a drawer target is ' + Math.round(r.width) + 'x' + Math.round(r.height) + ' (' + (el.getAttribute('data-act') || el.tagName) + ')');
    }
  }
  // #39: a closed row's title is one line, its note too.
  panel.querySelectorAll('.tfcc-narrow .tfcc-row:not(.tfcc-open) .tfcc-row-title a, .tfcc-narrow .tfcc-row:not(.tfcc-open) > .tfcc-note').forEach((el) => {
    const cs = getComputedStyle(el);
    const lh = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.4;
    const pad = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
    if (el.getBoundingClientRect().height - pad > lh * 1.5) polishBad.push('a closed row\\'s text takes more than one line');
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
    const r = ratio(ink, effectiveBg(el));
    if (r < ${MIN_LARGE}) out.push({ tag: 'emoji', cls: 'tfcc-emo', color: light ? 'black' : 'white', bg: 'button',
      ratio: Math.round(r * 100) / 100, need: ${MIN_LARGE}, text: el.parentElement.getAttribute('aria-label') });
  }
  out.seen = {
    polishBad: polishBad,
    cuMode: cuMode,
    cubar: !!cubar,
    drawerBtns: !!drawerBtns,
    emos: emos.length,
    navcells: panel.querySelectorAll('.tfcc-navgrid button').length,
    headBad: headBad,
    headInfo: headInfo,
    infoOff: infoOff,
    logo: panel.querySelectorAll('svg.tfcc-logo').length,
    started: panel.querySelectorAll('.tfcc-started').length,
  };
  return JSON.stringify({ rows: out, seen: out.seen });
})()
`;

const scriptFile = path.join(os.tmpdir(), 'tfcc-contrast-audit.js');
fs.writeFileSync(scriptFile, SCRIPT);

const pages = fs.readdirSync(previews).filter((f) => f.endsWith('.html')).sort();
let failures = 0;

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
  // Every preview has the header logo (#30), and every My posts preview has a
  // started row whose red "started" (#30) must have been measured.
  const missing = [];
  if (!seen.logo) missing.push('the FCC logo');
  if (page.startsWith('mine-') && !seen.started) missing.push('a red "started" tag');
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
  if (page.startsWith('narrow-catchup')) {
    if (!seen.cubar) missing.push('the Catch up action row');
    else console.log(`.. ${page}: Catch up labels ${seen.cuMode}`);
  }
  if (page.startsWith('narrow-') && page.includes('-drawer')) {
    if (!seen.drawerBtns) missing.push('the drawer button row');
    if (!seen.emos) missing.push('the drawer emoji');
  }
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

console.log(`\n${failures === 0 ? 'Every preview passes WCAG AA.' : failures + ' contrast problem(s) found.'}`);
process.exit(failures === 0 ? 0 : 1);
