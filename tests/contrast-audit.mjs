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
  out.seen = {
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
