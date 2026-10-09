/*
 * Builds the static mockups for issue #33 (condense the narrow mobile view).
 *
 *   node docs/designs/mockups/33-mobile/build-mockups.mjs
 *
 * Design artefacts only. Nothing here is loaded by the userscript or the
 * tests. The tokens and base rules are copied from panelStyleText() so the
 * mockups look like the real panel; the m-* rules are the proposals.
 * Every file written is checked to be ASCII, like the userscript itself.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

// ---- icons: inline ASCII SVG, stroke style, currentColor -------------------
const P = {
  refresh: '<path d="M4 10a6 6 0 0 1 10.4-4.1M16 10a6 6 0 0 1-10.4 4.1"/><path d="M14.5 2.5v3.6h-3.6M5.5 17.5v-3.6h3.6"/>',
  expand: '<path d="M3 8V3h5M12 3h5v5M17 12v5h-5M8 17H3v-5"/>',
  shrink: '<path d="M8 3v5H3M17 8h-5V3M12 17v-5h5M3 12h5v5"/>',
  hide: '<path d="M5 12.5l5-5 5 5"/>',
  show: '<path d="M5 7.5l5 5 5-5"/>',
  more: '<path d="M4 10h.01M10 10h.01M16 10h.01" stroke-width="3.2"/>',
  filter: '<path d="M3 4h14l-5.5 6.5V16l-3 1.5v-7Z"/>',
  check: '<path d="M4 10.5l4 4 8-9"/>',
  search: '<circle cx="9" cy="9" r="5.5"/><path d="M13 13l4 4"/>',
  gear: '<circle cx="10" cy="10" r="3"/><path d="M10 2v3M10 15v3M2 10h3M15 10h3M4.3 4.3l2.1 2.1M13.6 13.6l2.1 2.1M4.3 15.7l2.1-2.1M13.6 6.4l2.1-2.1"/>',
  list: '<path d="M7 5h10M7 10h10M7 15h10M3 5h.01M3 10h.01M3 15h.01" />',
  clock: '<circle cx="10" cy="10" r="7"/><path d="M10 6v4l3 2"/>',
  person: '<circle cx="10" cy="7" r="3.2"/><path d="M4 17c1-3.3 3.3-5 6-5s5 1.7 6 5"/>',
  draft: '<path d="M4 16l1-4 8.5-8.5 3 3L8 15Z"/>',
  folder: '<path d="M3 6V4.5h5l1.5 2H17V16H3Z"/>',
  tag: '<path d="M3 3h7l7 7-7 7-7-7Z"/><path d="M7 7h.01" stroke-width="2.6"/>',
  note: '<path d="M4 3h12v14H4ZM7 7h6M7 10h6M7 13h4"/>',
  archive: '<path d="M3 4h14v4H3ZM4.5 8v8h11V8M8 11h4"/>',
  pin: '<path d="M10 2.5l2.3 4.8 5.2.7-3.8 3.6.9 5.2L10 14.3l-4.6 2.5.9-5.2L2.5 8l5.2-.7Z"/>',
  read: '<path d="M2.5 10.5l3.5 3.5 6.5-7.5M9 13.5l1 1 7-8"/>',
  down: '<path d="M5 8l5 5 5-5"/>',
  close: '<path d="M5 5l10 10M15 5L5 15"/>',
};
function ico(name, px) {
  const s = px || 20;
  return '<svg class="m-svg" width="' + s + '" height="' + s + '" viewBox="0 0 20 20" aria-hidden="true"'
    + ' focusable="false">' + P[name] + '</svg>';
}

// The real logo (LOGO_SVG) and karma icon (KARMA_ICON_SVG) from the userscript.
const LOGO = '<svg class="tfcc-logo" width="66" height="28" viewBox="10 9 106 45" role="img"'
  + ' aria-label="Forum Command Center" focusable="false"><g fill="#5C768F">'
  + '<path d="M10 20 21 10h22l-5 10H21v6h15l-5 10H21v17H10Z"/>'
  + '<path d="M79 16l-7 7c-2.9-2.8-6.7-4-10.5-4-6.6 0-11 5.2-11 12.5s4.4 12.5 11 12.5c3.8 0 7.6-1.2 10.5-4'
  + 'l7 7c-4.7 4.6-10.8 7-17.5 7C49 54 40 44.4 40 31.5S49 9 61.5 9C68.2 9 74.3 11.4 79 16Z"/>'
  + '<path d="M116 16l-7 7c-2.9-2.8-6.7-4-10.5-4-6.6 0-11 5.2-11 12.5S91.9 44 98.5 44c3.8 0 7.6-1.2 10.5-4'
  + 'l7 7c-4.7 4.6-10.8 7-17.5 7C86 54 77 44.4 77 31.5S86 9 98.5 9c6.7 0 12.8 2.4 17.5 7Z"/>'
  + '</g></svg>';
const KARMA = '<svg viewBox="149 50 702 900" aria-hidden="true" focusable="false" style="height:1em;width:auto">'
  + '<path fill="currentColor" fill-rule="evenodd" d="'
  + 'M 697 264 L 834 403 L 749 486 L 712 447 L 758 401 L 697 341 L 550 487 L 513 448 Z '
  + 'M 450 511 L 488 551 L 303 736 L 165 600 L 254 512 L 291 550 L 242 600 L 303 659 Z '
  + 'M 301 264 L 389 351 L 350 389 L 301 341 L 242 402 L 390 549 L 353 587 L 165 402 Z '
  + 'M 450 610 L 637 796 L 501 934 L 363 798 L 450 709 L 488 749 L 440 798 L 499 857 L 560 798 L 413 650 Z '
  + 'M 449 314 L 488 353 L 350 489 L 313 450 Z '
  + 'M 499 66 L 637 202 L 550 291 L 511 252 L 560 202 L 501 143 L 440 202 L 588 351 L 551 390 L 363 204 Z '
  + 'M 649 413 L 835 598 L 699 736 L 610 648 L 650 611 L 699 659 L 758 598 L 611 452 Z '
  + 'M 648 511 L 686 551 L 548 686 L 511 648 Z '
  + 'M 451 413 L 587 548 L 551 587 L 413 452 Z"/></svg>';
// The badge chip's cup and streak glyphs, simplified for the mockup.
const CUP = '<svg class="tfcc-ico tfcc-tier-gold" width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">'
  + '<path d="M4 2h8v3a4 4 0 0 1-8 0ZM4 3H2v1.5A2.5 2.5 0 0 0 4 7M12 3h2v1.5A2.5 2.5 0 0 1 12 7M8 9v3M5 14h6"'
  + ' fill="none" stroke="currentColor" stroke-width="1.5"/></svg>';
const FLAME = '<svg class="tfcc-ico" width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" style="color:var(--tm-warn-text)">'
  + '<path d="M8 1.5c.5 2.5 4 4 4 8a4 4 0 0 1-8 0c0-2 1-3 2-4 0 1.5.8 2.3 1.5 2.5C7 6 7.3 3.5 8 1.5Z"'
  + ' fill="none" stroke="currentColor" stroke-width="1.5"/></svg>';
const UP = '<span class="tfcc-thumb" aria-hidden="true">&#x1F44D;</span>';
const DOWN = '<span class="tfcc-thumb" aria-hidden="true">&#x1F44E;</span>';

// ---- sample rows, the same threads tests/render-preview.mjs uses -----------
const ROWS = [
  { id: 16589908, pinned: true, prio: 0, title: 'A practical education guide and script companion', unread: 3,
    time: '12m', forum: 'Tutorials and Guides', by: 'DaftVino', folder: 'Guides', draft: true, tags: ['reference'],
    note: 'The one to link people to.' },
  { id: 16474152, prio: 2, title: 'SideWinder - Advanced Sidebar for Torn City', unread: 12, time: '1h',
    forum: 'Tools and Userscripts', by: 'Sidewinder', folder: 'Scripts and tools', tags: ['read-later'] },
  { id: 16354991, prio: 0, title: 'You can search forums by user AND text - show it', unread: 1, time: '2d',
    forum: 'Suggestions', by: 'aplayer', tags: [] },
  { id: 15978774, prio: 0, title: 'A thread with a deliberately very long title that has to wrap on a narrow phone '
    + 'screen without pushing the page sideways', unread: 0, time: 'unknown', forum: 'Suggestions', by: 'verbose', tags: [] },
  { id: 16208166, prio: -1, title: 'Actual RSS feed for forum threads', unread: 0, time: 'unknown',
    forum: 'API Development', by: 'someone', tags: [], started: true },
];

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ---- CSS -------------------------------------------------------------------
const BASE_CSS = `
#tfcc-panel {
  --tm-bg: #1f1f1f; --tm-bg-2: #262626; --tm-bg-3: #111111; --tm-hover: #292929;
  --tm-border: #3a3a3a; --tm-border-2: #555555;
  --tm-text: #ffffff; --tm-muted: #b8b8b8; --tm-meta: #cfcfcf;
  --tm-good-bg: #2a6b3a; --tm-good-text: #7ee081; --tm-bad-text: #ff8080;
  --tm-warn-text: #e8c06a; --tm-accent-text: #6ea3d0;
  --tfcc-text-sm: 12px; --tfcc-text: 14px;
  --tfcc-gap-xs: 4px; --tfcc-gap-sm: 6px; --tfcc-gap: 8px; --tfcc-gap-lg: 14px;
  --tfcc-focus-ring: 2px solid var(--tm-good-text);
  --tfcc-tier-gold: #e8c06a;
  --tfcc-mine-bg: #d9d9d9; --tfcc-mine-hover: #c8c8c8; --tfcc-mine-pressed: #b0b0b0;
  --tfcc-mine-text: #141414; --tfcc-mine-border: #d9d9d9;
  --tfcc-started: #ff8080;
}
#tfcc-panel.tfcc-theme-light {
  --tm-bg: #f2f2f2; --tm-bg-2: #e8e8e8; --tm-bg-3: #ffffff; --tm-hover: #dcdcdc;
  --tm-border: #c4c4c4; --tm-border-2: #9a9a9a;
  --tm-text: #141414; --tm-muted: #4a4a4a; --tm-meta: #3a3a3a;
  --tm-good-bg: #cfe8d4; --tm-good-text: #1c5c2c; --tm-bad-text: #a11414;
  --tm-warn-text: #7a5600; --tm-accent-text: #14507d;
  --tfcc-tier-gold: #7a5600;
  --tfcc-mine-border: #5c5c5c;
  --tfcc-started: #a11414;
}
#tfcc-panel { box-sizing: border-box; width: 100%; border: 1px solid var(--tm-border-2);
  background: var(--tm-bg); color: var(--tm-text); border-radius: 6px;
  padding: 8px; margin: 0; font-size: var(--tfcc-text); line-height: 1.5; }
#tfcc-panel * { box-sizing: border-box; color: inherit; background: transparent; }
#tfcc-panel .tfcc-logo { display: block; flex: none; height: 28px; width: auto; color: #5c768f; }
#tfcc-panel .tfcc-logo path { fill: currentColor; }
#tfcc-panel button.tfcc-chip { display: inline-flex; align-items: center; gap: 3px; flex: 0 0 auto;
  white-space: nowrap; min-height: 28px; padding: 2px 8px; border-radius: 14px;
  font-size: var(--tfcc-text-sm); font-weight: bold; }
#tfcc-panel .tfcc-ico { display: inline-block; vertical-align: middle; flex: 0 0 auto; }
#tfcc-panel .tfcc-tier-gold { color: var(--tfcc-tier-gold); }
#tfcc-panel .tfcc-badge { background: var(--tm-good-bg); color: var(--tm-text);
  border-radius: 10px; padding: 0 8px; font-size: var(--tfcc-text-sm); font-weight: bold; }
#tfcc-panel button, #tfcc-panel select, #tfcc-panel input {
  font: inherit; color: var(--tm-text); background: var(--tm-bg-3);
  border: 1px solid var(--tm-border-2); border-radius: 4px; padding: 3px 8px; }
#tfcc-panel button { cursor: pointer; }
#tfcc-panel button * { pointer-events: none; }
#tfcc-panel button[aria-pressed="true"] { background: var(--tm-good-bg); }
#tfcc-panel :focus-visible { outline: var(--tfcc-focus-ring); outline-offset: 2px; }
#tfcc-panel button.tfcc-reactions { font-size: var(--tfcc-text-sm); padding: 0 8px;
  border-radius: 10px; background: var(--tm-bg-3); color: var(--tm-meta);
  border: 1px solid var(--tm-border); text-align: left; }
#tfcc-panel .tfcc-thumb { filter: grayscale(1) brightness(0) invert(1); }
#tfcc-panel.tfcc-theme-light .tfcc-thumb { filter: grayscale(1) brightness(0); }
#tfcc-panel .tfcc-rx { color: var(--tm-text); font-weight: bold; font-variant-numeric: tabular-nums; }
#tfcc-panel .tfcc-karma { display: inline-flex; align-items: center; gap: 0.25em; white-space: nowrap; color: var(--tm-text); }
#tfcc-panel button.tfcc-nav-mine { background: var(--tfcc-mine-bg); color: var(--tfcc-mine-text);
  border-color: var(--tfcc-mine-border); font-weight: bold; }
#tfcc-panel button.tfcc-nav-mine[aria-pressed="true"] { background: var(--tfcc-mine-pressed);
  box-shadow: inset 0 -3px 0 var(--tfcc-mine-text); }
#tfcc-panel .tfcc-rows { display: flex; flex-direction: column; gap: var(--tfcc-gap-xs); }
#tfcc-panel .tfcc-row { border: 1px solid var(--tm-border); border-radius: 4px;
  background: var(--tm-bg-2); padding: var(--tfcc-gap-xs) var(--tfcc-gap-sm); }
#tfcc-panel .tfcc-row-title { font-weight: bold; overflow-wrap: anywhere; flex: 1 1 0; min-width: 0; }
#tfcc-panel .tfcc-row-title a { color: var(--tm-text); text-decoration: none; }
#tfcc-panel .tfcc-pinned { color: var(--tm-warn-text); }
#tfcc-panel .tfcc-unread { color: var(--tm-good-text); font-weight: bold; font-variant-numeric: tabular-nums; }
#tfcc-panel .tfcc-meta { color: var(--tm-meta); font-size: var(--tfcc-text-sm);
  display: flex; gap: var(--tfcc-gap-sm); flex-wrap: wrap; margin-top: 2px; }
#tfcc-panel .tfcc-tag { background: var(--tm-bg-3); border: 1px solid var(--tm-border);
  border-radius: 3px; padding: 0 5px; font-size: var(--tfcc-text-sm); }
#tfcc-panel .tfcc-tag.tfcc-started { color: var(--tfcc-started); font-weight: bold; }
#tfcc-panel .tfcc-note { color: var(--tm-muted); font-size: var(--tfcc-text-sm); }
#tfcc-panel .tfcc-bar { display: flex; gap: var(--tfcc-gap-sm); flex-wrap: wrap; align-items: center;
  margin-top: var(--tfcc-gap); }
`;

// The proposals. Everything is m-* so it is plain which rules are new.
const PROPOSAL_CSS = `
#tfcc-panel .m-svg { display: block; fill: none; stroke: currentColor; stroke-width: 1.8;
  stroke-linecap: round; stroke-linejoin: round; flex: none; }
#tfcc-panel .m-sr { position: absolute; width: 1px; height: 1px; overflow: hidden;
  clip: rect(0 0 0 0); white-space: nowrap; }
/* Header: one line. Logo 24px tall, chip, then Refresh / Expand / Hide as one nowrap unit. */
#tfcc-panel .m-head { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; margin-bottom: 8px; }
#tfcc-panel .m-head .tfcc-logo { height: 24px; }
#tfcc-panel .m-trio { display: inline-flex; gap: 4px; flex-wrap: nowrap; margin-left: auto; }
#tfcc-panel button.m-ico { display: inline-flex; align-items: center; justify-content: center;
  width: 40px; min-height: 44px; padding: 0; }
#tfcc-panel button.m-txt { min-height: 44px; padding: 0 10px; font-weight: bold; }
/* Segmented nav: four equal cells, label over count. */
#tfcc-panel .m-seg { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 4px; margin-bottom: 8px; }
#tfcc-panel .m-seg button { min-height: 44px; padding: 2px 2px; font-size: 13px; font-weight: bold;
  display: flex; flex-direction: column; align-items: center; justify-content: center; line-height: 1.15;
  white-space: nowrap; overflow: hidden; }
#tfcc-panel .m-seg .m-n { font-size: 11px; font-weight: bold; margin-top: 2px; padding: 0 6px;
  border-radius: 8px; background: var(--tm-good-bg); color: var(--tm-text); }
#tfcc-panel .m-seg .tfcc-nav-mine .m-n { background: var(--tm-bg-3); color: var(--tm-text); }
#tfcc-panel .m-seg .m-dim { font-size: 11px; font-weight: normal; color: var(--tm-muted); margin-top: 2px; }
/* An inline disclosure under the nav, never a floating overlay. */
#tfcc-panel .m-menu { border: 1px solid var(--tm-border-2); border-radius: 4px; background: var(--tm-bg-2);
  padding: 6px; margin: -4px 0 8px 0; display: grid; gap: 6px; }
#tfcc-panel .m-menu button { min-height: 44px; text-align: left; padding: 0 10px; display: flex;
  align-items: center; gap: 8px; }
#tfcc-panel .m-menu button.tfcc-reactions { min-height: 44px; border-radius: 4px; padding: 0 10px;
  font-size: 13px; flex-wrap: wrap; gap: 4px; }
/* Filter line: the field, Unread only, and a disclosure for the rest. */
#tfcc-panel .m-filter { display: flex; gap: 4px; margin-bottom: 8px; }
#tfcc-panel .m-filter input { flex: 1 1 0; min-width: 0; min-height: 44px; font-size: 16px; }
#tfcc-panel .m-filter button { min-height: 44px; padding: 0 8px; display: inline-flex; align-items: center; gap: 4px;
  font-size: 13px; white-space: nowrap; }
#tfcc-panel .m-filters-open { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; margin: -2px 0 8px 0; }
#tfcc-panel .m-filters-open select { min-height: 44px; font-size: 16px; min-width: 0; }
/* Row: title, unread, and a 40x44 "more" toggle. Priority leaves the title line. */
#tfcc-panel .m-row-main { display: flex; align-items: flex-start; gap: 6px; }
#tfcc-panel .m-row-main .tfcc-row-title { padding-top: 2px; line-height: 1.35; }
#tfcc-panel .m-row-main .tfcc-unread { flex: none; padding-top: 2px; font-size: 13px; }
#tfcc-panel button.m-more { flex: none; width: 40px; min-height: 40px; padding: 0; margin: -2px -4px 0 0;
  display: inline-flex; align-items: center; justify-content: center; border-color: var(--tm-border); }
#tfcc-panel button.m-more[aria-expanded="true"] { background: var(--tm-hover); border-color: var(--tm-border-2); }
#tfcc-panel .m-prio { font-weight: bold; color: var(--tm-meta); font-variant-numeric: tabular-nums; }
#tfcc-panel .m-rownote { color: var(--tm-muted); font-size: var(--tfcc-text-sm); margin-top: 1px; }
/* The drawer: today's actions, at touch size, two columns. */
#tfcc-panel .m-drawer { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; margin-top: 6px;
  padding-top: 8px; border-top: 1px solid var(--tm-border); }
#tfcc-panel .m-drawer button, #tfcc-panel .m-drawer select, #tfcc-panel .m-drawer input { min-height: 44px; min-width: 0; }
#tfcc-panel .m-drawer button { display: inline-flex; align-items: center; justify-content: center; gap: 6px; }
#tfcc-panel .m-drawer input, #tfcc-panel .m-drawer select { font-size: 16px; }
#tfcc-panel .m-wide { grid-column: 1 / -1; }
#tfcc-panel .m-step { display: flex; align-items: center; gap: 6px; }
#tfcc-panel .m-step button { width: 44px; font-weight: bold; font-size: 18px; }
#tfcc-panel .m-step .m-step-label { flex: 1 1 auto; text-align: center; color: var(--tm-meta); }
#tfcc-panel .m-cap { display: flex; align-items: center; gap: 8px; margin-top: 8px; }
#tfcc-panel .m-cap button { min-height: 44px; }
/* Concept B: thumb dock and icon action grid. */
#tfcc-panel .m-dock { position: sticky; bottom: 0; display: grid; grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 2px; background: var(--tm-bg); border-top: 1px solid var(--tm-border-2); padding: 4px 0 2px 0; margin: 8px -8px -8px -8px; }
#tfcc-panel .m-dock button { border: 0; min-height: 52px; padding: 2px 0; display: flex; flex-direction: column;
  align-items: center; justify-content: center; font-size: 11px; font-weight: bold; position: relative; border-radius: 6px; }
#tfcc-panel .m-dock button[aria-pressed="true"] { background: var(--tm-good-bg); }
#tfcc-panel .m-dock .m-bub { position: absolute; top: 2px; left: 50%; margin-left: 6px; font-size: 10px; line-height: 15px;
  min-width: 16px; padding: 0 4px; border-radius: 8px; background: var(--tm-good-text); color: var(--tm-bg); }
#tfcc-panel .m-rowbtn { display: block; width: 100%; text-align: left; border: 0; padding: 0; margin: 0;
  min-height: 24px; background: transparent; }
#tfcc-panel .m-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 4px; margin-top: 6px;
  padding-top: 6px; border-top: 1px solid var(--tm-border); }
#tfcc-panel .m-grid button { min-height: 52px; padding: 2px 0; display: flex; flex-direction: column; align-items: center;
  justify-content: center; font-size: 11px; gap: 2px; }
#tfcc-panel .m-takeover { min-height: 640px; display: flex; flex-direction: column; border-radius: 0; }
#tfcc-panel .m-takeover .tfcc-rows { flex: 1 1 auto; }
/* Concept C: inbox rows with a selection box and a contextual bar. */
#tfcc-panel .m-switch { display: flex; gap: 4px; margin-bottom: 8px; }
#tfcc-panel .m-switch > button.m-view { flex: 0 0 auto; min-height: 44px; display: inline-flex; align-items: center; gap: 6px;
  font-weight: bold; padding: 0 8px; }
#tfcc-panel .m-switch input { flex: 1 1 0; min-width: 0; min-height: 44px; font-size: 16px; }
#tfcc-panel .m-switch > button.m-ico { flex: none; }
#tfcc-panel .m-irow { display: flex; gap: 4px; align-items: flex-start; }
#tfcc-panel button.m-sel { flex: none; width: 36px; min-height: 44px; margin: -4px 0 -4px -6px; padding: 0; border: 0;
  background: transparent;
  display: inline-flex; align-items: center; justify-content: center; }
#tfcc-panel .m-box { width: 20px; height: 20px; border: 2px solid var(--tm-border-2); border-radius: 4px;
  display: inline-flex; align-items: center; justify-content: center; }
#tfcc-panel .m-sel[aria-pressed="true"] { background: transparent; }
#tfcc-panel .m-sel[aria-pressed="true"] .m-box { background: var(--tm-good-text); border-color: var(--tm-good-text); color: var(--tm-bg); }
#tfcc-panel .tfcc-row.m-picked { border-color: var(--tm-good-text); }
#tfcc-panel .m-irow-body { flex: 1 1 auto; min-width: 0; padding-top: 2px; }
#tfcc-panel .m-ititle { display: flex; gap: 6px; align-items: baseline; }
#tfcc-panel .m-ititle .tfcc-row-title { line-height: 1.35; }
#tfcc-panel .m-ctx { position: sticky; top: 0; z-index: 1; display: grid; grid-template-columns: repeat(6, minmax(0, 1fr));
  gap: 3px; background: var(--tm-good-bg); border-radius: 4px; padding: 4px; margin-bottom: 8px; }
#tfcc-panel .m-ctx-head { grid-column: 1 / -1; display: flex; justify-content: space-between; align-items: center;
  font-weight: bold; font-size: 13px; padding: 0 2px; }
#tfcc-panel .m-ctx button { min-height: 48px; padding: 2px 0; display: flex; flex-direction: column; align-items: center;
  justify-content: center; font-size: 11px; gap: 2px; background: var(--tm-bg-3); }
#tfcc-panel .m-ctx-head button { min-height: 32px; flex-direction: row; padding: 0 8px; font-size: 12px; }
#tfcc-panel .m-vmenu { border: 1px solid var(--tm-border-2); border-radius: 4px; background: var(--tm-bg-2);
  padding: 4px; margin: -4px 0 8px 0; }
#tfcc-panel .m-vmenu button { display: flex; width: 100%; min-height: 44px; align-items: center; gap: 10px;
  border: 0; border-radius: 4px; padding: 0 8px; text-align: left; }
#tfcc-panel .m-vmenu .m-count { margin-left: auto; font-size: 12px; font-weight: bold; color: var(--tm-good-text); }
`;

const PAGE_CSS = `
html, body { margin: 0; }
body { font-family: Arial, Helvetica, sans-serif; padding: 16px; display: flex; gap: 24px;
  align-items: flex-start; background: #8a8a8a; }
.phone { flex: none; }
.cap { font: 12px/1.4 ui-monospace, Consolas, monospace; color: #111; margin: 0 0 6px 0; max-width: 100%; }
.screen { box-sizing: border-box; position: relative; padding: 16px; overflow: hidden; }
.screen.dark { background: #0f0f0f; }
.screen.light { background: #e6e6e6; }
.fold { position: absolute; left: 0; right: 0; border-top: 2px dashed #e0457b; pointer-events: none; }
.fold span { position: absolute; right: 4px; top: -18px; font: 11px ui-monospace, Consolas, monospace;
  color: #fff; background: #e0457b; padding: 0 4px; border-radius: 3px; }
`;

// ---- shared pieces -----------------------------------------------------------
function chip() {
  return '<button type="button" class="tfcc-chip" data-act="badges-shelf" aria-expanded="false"'
    + ' aria-label="Badges: 4 of 31. Streak 5 days, today counted. Show badges.">'
    + CUP + '<span>4</span>' + FLAME + '<span>5</span></button>';
}
function trio(takeover) {
  return '<span class="m-trio">'
    + '<button type="button" class="m-ico" data-act="refresh" aria-label="Refresh" title="Refresh">' + ico('refresh') + '</button>'
    + '<button type="button" class="m-ico" data-act="takeover" aria-pressed="' + (takeover ? 'true' : 'false') + '"'
    + ' aria-label="' + (takeover ? 'Shrink' : 'Expand') + '" title="' + (takeover ? 'Shrink' : 'Expand') + '">'
    + ico(takeover ? 'shrink' : 'expand') + '</button>'
    + '<button type="button" class="m-ico" data-act="collapse" aria-label="Hide" title="Hide">' + ico('hide') + '</button>'
    + '</span>';
}
function pill() {
  return '<button type="button" class="tfcc-reactions" data-act="view" data-view="mine"'
    + ' aria-label="Your threads: 34 up, 5 down, net -3 on 1 more. Karma: 1,208. Open My posts.">'
    + '<span class="tfcc-rx">34</span> ' + UP + ' <span class="tfcc-rx">5</span> ' + DOWN
    + ', net <span class="tfcc-rx">-3</span> on 1 more <span class="tfcc-karma">' + KARMA
    + '<span class="tfcc-rx">1,208</span></span></button>';
}
function meta(r, opts) {
  const o = opts || {};
  const bits = [];
  if (r.started) bits.push('<span class="tfcc-tag tfcc-started">started</span>');
  if (r.prio && o.prioInMeta) bits.push('<span class="m-prio" title="Priority">' + (r.prio > 0 ? '+' : '') + r.prio + '</span>');
  bits.push('<span>' + esc(r.time) + '</span>');
  bits.push('<span>' + esc(r.forum) + '</span>');
  if (!o.noAuthor) bits.push('<span>by ' + esc(r.by) + '</span>');
  if (r.folder) bits.push('<span>' + esc(r.folder) + '</span>');
  if (r.draft) bits.push('<span class="tfcc-tag">draft</span>');
  for (const t of r.tags) bits.push('<span class="tfcc-tag">' + esc(t) + '</span>');
  return '<div class="tfcc-meta">' + bits.join('') + '</div>';
}
function titleLink(r) {
  return '<span class="tfcc-row-title"><a href="#t' + r.id + '" data-tfcc-thread="' + r.id + '">'
    + esc(r.title) + '</a></span>';
}
function screen(theme, width, body, opts) {
  const o = opts || {};
  const fold = o.fold ? '<div class="fold" style="top:' + o.fold + 'px"><span>' + esc(o.foldLabel || 'first screen') + '</span></div>' : '';
  return '<div class="phone" style="width:' + width + 'px">'
    + '<p class="cap">' + esc(o.caption) + '</p>'
    + '<div class="screen ' + theme + '" style="width:' + width + 'px' + (o.height ? ';height:' + o.height + 'px' : '') + '">'
    + '<div id="tfcc-panel" class="tfcc-theme-' + theme + (o.panelClass ? ' ' + o.panelClass : '') + '">' + body + '</div>'
    + fold + '</div></div>';
}
function page(title, desc, phones, extraCss) {
  return '<!doctype html>\n<html lang="en"><head><meta charset="utf-8">\n'
    + '<meta name="viewport" content="width=device-width, initial-scale=1">\n'
    + '<title>' + esc(title) + '</title>\n'
    + '<!-- ' + esc(desc) + ' -->\n'
    + '<style>' + PAGE_CSS + BASE_CSS + PROPOSAL_CSS + (extraCss || '') + '</style></head>\n<body>\n'
    + phones.join('\n') + '\n</body></html>\n';
}

// ---- Concept A: Toolbar and drawer ------------------------------------------
function aSeg(active, moreOpen) {
  const cell = (view, label, n, cls, extra) => '<button type="button" data-act="view" data-view="' + view + '"'
    + (cls ? ' class="' + cls + '"' : '') + ' aria-pressed="' + (active === view ? 'true' : 'false') + '"'
    + (extra || '') + '>' + label + n + '</button>';
  return '<div class="m-seg" role="group" aria-label="Views">'
    + cell('threads', 'Threads', '<span class="m-n">16 new</span>', '', ' aria-label="Threads, 16 new, 6 subscribed"')
    + cell('catchup', 'Catch up', '<span class="m-n">3</span>')
    + cell('mine', 'My posts', '<span class="m-n">1</span>', 'tfcc-nav-mine')
    + '<button type="button" data-act="nav-more" aria-expanded="' + (moreOpen ? 'true' : 'false') + '"'
    + ' aria-controls="tfcc-nav-more" aria-label="More views: Search, Drafts 1, Settings">More'
    + '<span class="m-dim">Drafts 1</span></button>'
    + '</div>'
    + (moreOpen ? '<div class="m-menu" id="tfcc-nav-more">'
      + '<button type="button" data-act="view" data-view="search" aria-pressed="false">' + ico('search', 18) + 'Search</button>'
      + '<button type="button" data-act="view" data-view="drafts" aria-pressed="false">' + ico('draft', 18) + 'Drafts (1)</button>'
      + '<button type="button" data-act="view" data-view="settings" aria-pressed="false">' + ico('gear', 18) + 'Settings</button>'
      + pill() + '</div>' : '');
}
function aFilter(open) {
  return '<div class="m-filter">'
    + '<input type="search" data-act="filter" placeholder="filter threads" aria-label="Filter: words, by:player, tag:x, is:unread">'
    + '<button type="button" data-act="unread-only" aria-pressed="false">Unread</button>'
    + '<button type="button" data-act="filters-toggle" aria-expanded="' + (open ? 'true' : 'false') + '"'
    + ' aria-label="Sort and filters, 1 active">' + ico('filter', 18) + '1</button></div>'
    + (open ? '<div class="m-filters-open">'
      + '<select data-act="sort" aria-label="Sort"><option>Last activity</option></select>'
      + '<select data-act="folder-filter" aria-label="Folder"><option>All folders</option></select>'
      + '<select data-act="tag-filter" aria-label="Tag" class="m-wide"><option>All tags</option></select></div>' : '');
}
function aRow(r, open) {
  const id = ' data-id="' + r.id + '"';
  let h = '<div class="tfcc-row" data-id="' + r.id + '"><div class="m-row-main">'
    + (r.pinned ? '<span class="tfcc-pinned" title="Pinned" style="padding-top:2px">*</span>' : '')
    + titleLink(r)
    + (r.unread ? '<span class="tfcc-unread">' + r.unread + ' new</span>' : '')
    + '<button type="button" class="m-more" data-act="row-more"' + id + ' aria-expanded="' + (open ? 'true' : 'false') + '"'
    + ' aria-controls="tfcc-act-' + r.id + '" aria-label="Actions for ' + esc(r.title) + '">' + ico(open ? 'close' : 'more', 18) + '</button>'
    + '</div>' + meta(r, { prioInMeta: true });
  if (r.note) h += '<div class="m-rownote">' + esc(r.note) + '</div>';
  if (open) {
    h += '<div class="m-drawer" id="tfcc-act-' + r.id + '">'
      + '<button type="button" data-act="pin"' + id + '>' + ico('pin', 18) + (r.pinned ? 'Unpin' : 'Pin') + '</button>'
      + '<button type="button" data-act="read"' + id + '>' + ico('read', 18) + 'Mark read</button>'
      + '<div class="m-step m-wide"><button type="button" data-act="prio-down"' + id + ' aria-label="Lower priority">-</button>'
      + '<span class="m-step-label">Priority <b>' + (r.prio > 0 ? '+' : '') + r.prio + '</b></span>'
      + '<button type="button" data-act="prio-up"' + id + ' aria-label="Raise priority">+</button></div>'
      + '<select data-act="folder"' + id + ' class="m-wide" aria-label="Folder"><option>' + esc(r.folder || 'Unfiled') + '</option></select>'
      + '<input type="text" data-act="tag-input"' + id + ' placeholder="add tag" aria-label="Add tag">'
      + '<input type="text" data-act="note-input"' + id + ' placeholder="note" value="' + esc(r.note || '') + '" aria-label="Note">'
      + '<button type="button" data-act="draft"' + id + '>' + ico('draft', 18) + (r.draft ? 'Edit draft' : 'Draft') + '</button>'
      + '<button type="button" data-act="archive"' + id + '>' + ico('archive', 18) + 'Archive</button>'
      + '</div>';
  }
  return h + '</div>';
}
function conceptA(theme, opts) {
  const o = opts || {};
  const rows = ROWS.map((r, i) => aRow(r, o.openRow === i)).join('');
  return '<div class="m-head">' + LOGO + chip() + trio(false) + '</div>'
    + aSeg('threads', o.moreOpen) + aFilter(o.filtersOpen)
    + '<div class="tfcc-rows">' + rows + '</div>'
    + '<div class="m-cap"><span class="tfcc-note">Showing 5 of 6</span>'
    + '<button type="button" data-act="rows-toggle" data-view="threads">Show all</button></div>'
    + '<p class="tfcc-note" style="margin:8px 0 0 0">Updated 4m ago.</p>';
}

// ---- Concept B: Thumb dock ----------------------------------------------------
function bRow(r, open) {
  const id = ' data-id="' + r.id + '"';
  let h = '<div class="tfcc-row" data-id="' + r.id + '">'
    + '<div class="m-row-main">' + (r.pinned ? '<span class="tfcc-pinned" style="padding-top:2px">*</span>' : '')
    + titleLink(r) + (r.unread ? '<span class="tfcc-unread">' + r.unread + ' new</span>' : '') + '</div>'
    // The rest of the row is one disclosure button, separate from the title link.
    + '<button type="button" class="m-rowbtn" data-act="row-more"' + id + ' aria-expanded="' + (open ? 'true' : 'false') + '"'
    + ' aria-label="Actions for ' + esc(r.title) + '">' + meta(r, { prioInMeta: true }) + '</button>';
  if (open) {
    const g = (act, icon, label) => '<button type="button" data-act="' + act + '"' + id + '>' + ico(icon, 20) + label + '</button>';
    h += '<div class="m-grid">'
      + g('pin', 'pin', r.pinned ? 'Unpin' : 'Pin') + g('read', 'read', 'Read')
      + g('prio-up', 'hide', 'Priority +') + g('prio-down', 'show', 'Priority -')
      + g('folder-pick', 'folder', 'Folder') + g('tag-pick', 'tag', 'Tag')
      + g('draft', 'draft', r.draft ? 'Edit draft' : 'Draft') + g('archive', 'archive', 'Archive')
      + '</div>';
  }
  return h + '</div>';
}
function conceptB(theme, opts) {
  const o = opts || {};
  const dock = (v, icon, label, n) => '<button type="button" data-act="view" data-view="' + v + '" aria-pressed="'
    + (v === (o.view || 'threads') ? 'true' : 'false') + '"' + (n ? ' aria-label="' + label + ', ' + n + '"' : '') + '>'
    + ico(icon, 22) + label + (n ? '<span class="m-bub">' + n + '</span>' : '') + '</button>';
  const rows = ROWS.map((r, i) => bRow(r, o.openRow === i)).join('');
  return '<div class="m-head">' + LOGO + chip()
    + '<span class="m-trio"><button type="button" class="m-ico" data-act="view" data-view="settings" aria-label="Settings">'
    + ico('gear') + '</button>' + trio(o.takeover).replace('<span class="m-trio">', '').replace(/<\/span>$/, '') + '</span></div>'
    + '<div class="m-filter"><input type="search" data-act="filter" placeholder="filter threads" aria-label="Filter">'
    + '<button type="button" data-act="unread-only" aria-pressed="true">Unread</button>'
    + '<button type="button" data-act="filters-toggle" aria-expanded="false" aria-label="Sort and filters">' + ico('filter', 18) + '</button></div>'
    + '<div class="tfcc-rows">' + rows + '</div>'
    + '<div class="m-dock" role="group" aria-label="Views">'
    + dock('threads', 'list', 'Threads', '16') + dock('catchup', 'clock', 'Catch up', '3')
    + dock('search', 'search', 'Search') + dock('drafts', 'draft', 'Drafts', '1') + dock('mine', 'person', 'My posts', '1')
    + '</div>';
}

// ---- Concept C: Inbox and select ---------------------------------------------
function cRow(r, picked) {
  const id = ' data-id="' + r.id + '"';
  return '<div class="tfcc-row' + (picked ? ' m-picked' : '') + '" data-id="' + r.id + '"><div class="m-irow">'
    + '<button type="button" class="m-sel" data-act="select"' + id + ' aria-pressed="' + (picked ? 'true' : 'false') + '"'
    + ' aria-label="Select ' + esc(r.title) + '"><span class="m-box">' + (picked ? ico('check', 14) : '') + '</span></button>'
    + '<div class="m-irow-body"><div class="m-ititle">' + (r.pinned ? '<span class="tfcc-pinned">*</span>' : '')
    + titleLink(r) + (r.unread ? '<span class="tfcc-unread">' + r.unread + '</span>' : '') + '</div>'
    + meta(r, { prioInMeta: true, noAuthor: true }) + '</div></div></div>';
}
function conceptC(theme, opts) {
  const o = opts || {};
  const picked = o.picked || [];
  const rows = ROWS.map((r, i) => cRow(r, picked.indexOf(i) !== -1)).join('');
  let second;
  if (picked.length) {
    const b = (act, icon, label) => '<button type="button" data-act="' + act + '-selected">' + ico(icon, 18) + label + '</button>';
    second = '<div class="m-ctx" role="toolbar" aria-label="' + picked.length + ' selected">'
      + '<div class="m-ctx-head"><span>' + picked.length + ' selected</span>'
      + '<button type="button" data-act="select-none">' + ico('close', 14) + '&nbsp;Clear</button></div>'
      + b('pin', 'pin', 'Pin') + b('read', 'read', 'Read') + b('folder', 'folder', 'Folder')
      + b('tag', 'tag', 'Tag') + b('archive', 'archive', 'Archive') + b('more', 'more', 'More') + '</div>';
  } else {
    second = '<div class="m-switch"><button type="button" class="m-view" data-act="view-menu" aria-expanded="'
      + (o.menuOpen ? 'true' : 'false') + '" aria-label="View: Threads, 16 new. Change view">Threads'
      + '<span class="tfcc-badge">16</span>' + ico('down', 16) + '</button>'
      + '<input type="search" data-act="filter" placeholder="filter" aria-label="Filter">'
      + '<button type="button" class="m-ico" data-act="filters-toggle" aria-expanded="false" aria-label="Sort and filters">'
      + ico('filter', 18) + '</button></div>';
    if (o.menuOpen) {
      const v = (view, icon, label, n, pressed) => '<button type="button" data-act="view" data-view="' + view + '" aria-pressed="'
        + (pressed ? 'true' : 'false') + '">' + ico(icon, 18) + label + (n ? '<span class="m-count">' + n + '</span>' : '') + '</button>';
      second += '<div class="m-vmenu">' + v('threads', 'list', 'Threads', '16 new', true) + v('catchup', 'clock', 'Catch up', '3')
        + v('search', 'search', 'Search') + v('drafts', 'draft', 'Drafts', '1') + v('mine', 'person', 'My posts', '1')
        + v('settings', 'gear', 'Settings') + '<div style="padding:4px 0 0 0">' + pill() + '</div></div>';
    }
  }
  return '<div class="m-head">' + LOGO + chip() + trio(false) + '</div>' + second
    + '<div class="tfcc-rows">' + rows + '</div>'
    + '<div class="m-cap"><span class="tfcc-note">Showing 5 of 6</span>'
    + '<button type="button" data-act="rows-toggle" data-view="threads">Show all</button></div>';
}

// ---- Revised recommendation: task-first A (after the Codex review) -------------
// r-* classes. Sizes are em (the panel is 14px) so the 200% frame scales with
// the tokens. Every control box is a real 44x44 minimum: min-height and
// min-width, never a fixed height, and no pseudo-element hit areas.
const REVISED_CSS = `
body.r-wrap { flex-wrap: wrap; max-width: 1700px; }
#tfcc-panel.tfcc-narrow { padding: 8px; }
#tfcc-panel .r-head { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; margin-bottom: 6px; }
#tfcc-panel .r-id { display: flex; align-items: center; gap: 6px; min-width: 0; flex-wrap: wrap; }
#tfcc-panel .r-head .tfcc-logo { height: 24px; }
#tfcc-panel .r-ctl { display: inline-flex; align-items: center; gap: 6px; flex-wrap: nowrap; margin-left: auto; }
#tfcc-panel button.r-ico { display: inline-flex; align-items: center; justify-content: center;
  min-width: 44px; min-height: 44px; padding: 0; }
#tfcc-panel button.r-show { min-height: 44px; min-width: 44px; padding: 0 10px; font-weight: bold;
  display: inline-flex; align-items: center; gap: 4px; }
/* The chip: a 44px button with no chrome of its own; the 28px pill is a child. */
#tfcc-panel button.r-chip { min-height: 44px; min-width: 44px; padding: 0; border: 0; background: transparent;
  display: inline-flex; align-items: center; }
#tfcc-panel .r-pill { display: inline-flex; align-items: center; gap: 3px; white-space: nowrap; min-height: 28px;
  padding: 2px 8px; border-radius: 14px; border: 1px solid var(--tm-border-2); background: var(--tm-bg-3);
  font-size: var(--tfcc-text-sm); font-weight: bold; }
/* Nav: all six views, VIEWS order, 3 x 2. No More menu. */
#tfcc-panel .r-nav { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 6px; margin-bottom: 6px; }
#tfcc-panel .r-nav button { min-height: 44px; padding: 2px 4px; font-weight: bold; font-size: 0.93em; line-height: 1.2;
  display: flex; flex-wrap: wrap; align-items: center; justify-content: center; gap: 2px 5px; text-align: center; }
#tfcc-panel .r-n { font-size: 0.8em; font-weight: bold; padding: 0 6px; border-radius: 8px; line-height: 1.5;
  background: var(--tm-good-bg); color: var(--tm-text); }
#tfcc-panel .r-nav .tfcc-nav-mine .r-n { background: var(--tm-bg-3); }
/* Filter line. */
#tfcc-panel .r-filter { display: flex; gap: 6px; margin-bottom: 6px; flex-wrap: wrap; }
#tfcc-panel .r-filter input { flex: 1 1 8em; min-width: 0; min-height: 44px; font-size: max(16px, 1em); }
#tfcc-panel .r-filter button { min-height: 44px; min-width: 44px; padding: 0 8px; display: inline-flex;
  align-items: center; justify-content: center; gap: 4px; white-space: nowrap; }
#tfcc-panel .r-filters-open { display: grid; grid-template-columns: repeat(auto-fit, minmax(8em, 1fr)); gap: 6px;
  margin: 0 0 6px 0; }
#tfcc-panel .r-filters-open select { min-height: 44px; min-width: 0; font-size: max(16px, 1em); }
/* View heading: the focus fallback when the last row goes. */
#tfcc-panel .r-vh { font-size: 1em; margin: 2px 0 6px 0; display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
#tfcc-panel .r-catchbar { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 6px; align-items: center; }
#tfcc-panel .r-catchbar button { min-height: 44px; }
#tfcc-panel .tfcc-section { border: 1px solid var(--tm-border); border-radius: 4px; padding: 6px; margin-bottom: 6px; }
#tfcc-panel .tfcc-section h4 { margin: 0 0 6px 0; font-size: 1em; }
/* Rows: the title has the whole width; unread, meta and the buttons share line 2. */
#tfcc-panel .r-t { display: flex; gap: 4px; align-items: flex-start; }
#tfcc-panel .r-t .tfcc-row-title { line-height: 1.35; }
#tfcc-panel .r-t .tfcc-row-title a { display: block; padding: 3px 0; min-height: 24px; }
#tfcc-panel .r-t .tfcc-pinned { padding-top: 3px; }
#tfcc-panel .r-l2 { display: flex; gap: 6px; align-items: flex-start; }
#tfcc-panel .r-l2 .tfcc-meta { flex: 1 1 0; min-width: 0; margin-top: 0; padding-top: 2px; }
#tfcc-panel .r-l2 .tfcc-unread { font-size: 1em; }
#tfcc-panel .r-btns { flex: none; display: inline-flex; gap: 6px; }
#tfcc-panel .r-btns button { min-width: 44px; min-height: 44px; padding: 0 6px; display: inline-flex;
  align-items: center; justify-content: center; gap: 4px; border-color: var(--tm-border); }
#tfcc-panel .r-btns button[aria-expanded="true"] { background: var(--tm-hover); border-color: var(--tm-border-2); }
#tfcc-panel .r-btns button.r-read { font-weight: bold; border-color: var(--tm-border-2); }
#tfcc-panel .r-note { color: var(--tm-muted); font-size: var(--tfcc-text-sm); }
#tfcc-panel .r-drawer { display: grid; grid-template-columns: repeat(auto-fit, minmax(7.5em, 1fr)); gap: 6px; margin-top: 6px;
  padding-top: 8px; border-top: 1px solid var(--tm-border); }
#tfcc-panel .r-drawer button, #tfcc-panel .r-drawer select, #tfcc-panel .r-drawer input { min-height: 44px; min-width: 0; }
#tfcc-panel .r-drawer button { display: inline-flex; align-items: center; justify-content: center; gap: 6px; }
#tfcc-panel .r-drawer input, #tfcc-panel .r-drawer select { font-size: max(16px, 1em); }
#tfcc-panel .r-drawer .r-wide { grid-column: 1 / -1; }
#tfcc-panel .r-step { display: flex; align-items: center; gap: 6px; }
#tfcc-panel .r-step button { min-width: 44px; font-weight: bold; font-size: 1.25em; }
#tfcc-panel .r-step span { flex: 1 1 auto; text-align: center; color: var(--tm-meta); }
#tfcc-panel .r-cap { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-top: 6px; }
#tfcc-panel .r-cap button { min-height: 44px; }
#tfcc-panel .r-shelf { border: 1px solid var(--tm-border); border-radius: 4px; padding: 6px 8px; margin-bottom: 6px;
  background: var(--tm-bg-2); }
#tfcc-panel .r-shelf .r-shelf-row { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; margin-top: 4px; }
#tfcc-panel .r-shelf button { min-height: 44px; }
#tfcc-panel .r-bar-track { display: inline-block; background: var(--tm-bg-3); border: 1px solid var(--tm-border);
  border-radius: 3px; height: 8px; width: 120px; max-width: 40%; }
#tfcc-panel .r-bar-fill { display: block; background: var(--tm-good-text); height: 100%; width: 40%; }
#tfcc-panel .r-rx { margin-bottom: 6px; }
#tfcc-panel .r-rx button.tfcc-reactions { min-height: 44px; border-radius: 4px; padding: 0 10px; width: 100%; }
`;

function rChip() {
  return '<button type="button" class="tfcc-chip r-chip" data-act="badges-shelf" aria-expanded="false"'
    + ' aria-label="Badges: 4 of 31. Streak 5 days, today counted. Show badges.">'
    + '<span class="r-pill">' + CUP + '<span>4</span>' + FLAME + '<span>5</span></span></button>';
}
function rHead(o) {
  const collapsed = !!o.collapsed;
  return '<div class="r-head"><div class="r-id">' + LOGO + rChip() + '</div>'
    + '<span class="r-ctl tfcc-head-btns">'
    + (collapsed ? '<span class="tfcc-badge">16 new</span>' : '')
    + '<button type="button" class="r-ico" data-act="refresh" aria-label="Refresh">' + ico('refresh') + '</button>'
    + '<button type="button" class="r-ico" data-act="takeover" aria-pressed="false" aria-label="Expand">' + ico('expand') + '</button>'
    + (collapsed
      ? '<button type="button" class="r-show" data-act="collapse" aria-label="Show the panel">' + ico('show', 18) + 'Show</button>'
      : '<button type="button" class="r-ico" data-act="collapse" aria-label="Hide the panel">' + ico('hide') + '</button>')
    + '</span></div>';
}
function rNav(active) {
  const cell = (v, label, n, cls, aria) => '<button type="button" data-act="view" data-view="' + v + '"'
    + (cls ? ' class="' + cls + '"' : '') + ' aria-pressed="' + (active === v ? 'true' : 'false') + '"'
    + (aria ? ' aria-label="' + aria + '"' : '') + '><span>' + label + '</span>' + (n ? '<span class="r-n">' + n + '</span>' : '') + '</button>';
  return '<div class="r-nav tfcc-nav" role="group" aria-label="Views">'
    + cell('threads', 'Threads', '16 new', '', 'Threads, 16 new, 6 subscribed')
    + cell('catchup', 'Catch up', '3', '', 'Catch up, 3')
    + cell('search', 'Search', '')
    + cell('drafts', 'Drafts', '1', '', 'Drafts, 1')
    + cell('settings', 'Settings', '')
    + cell('mine', 'My posts', '1', 'tfcc-nav-mine', 'My posts, 1 new')
    + '</div>';
}
function rFilter(open) {
  return '<div class="r-filter">'
    + '<input type="search" data-act="filter" placeholder="filter threads" aria-label="Filter: words, by:player, tag:x, is:unread">'
    + '<button type="button" data-act="unread-only" aria-pressed="false">Unread</button>'
    + '<button type="button" data-act="filters-toggle" aria-expanded="' + (open ? 'true' : 'false') + '"'
    + ' aria-controls="tfcc-filters" aria-label="Filters, 1 active">' + ico('filter', 18) + '1</button></div>'
    + (open ? '<div class="r-filters-open" id="tfcc-filters">'
      + '<select data-act="sort" aria-label="Sort"><option>Last activity</option></select>'
      + '<select data-act="folder-filter" aria-label="Folder"><option>Guides</option></select>'
      + '<select data-act="tag-filter" aria-label="Tag"><option>All tags</option></select></div>' : '');
}
function rRow(r, o) {
  const id = ' data-id="' + r.id + '"';
  const open = !!o.open;
  const catchup = !!o.catchup;
  const bits = [];
  if (r.unread) bits.push('<span class="tfcc-unread">' + r.unread + ' new</span>');
  if (r.started) bits.push('<span class="tfcc-tag tfcc-started">started</span>');
  if (r.prio) bits.push('<span class="m-prio" title="Priority">' + (r.prio > 0 ? '+' : '') + r.prio + '</span>');
  bits.push('<span>' + esc(r.time) + '</span>', '<span>' + esc(r.forum) + '</span>', '<span>by ' + esc(r.by) + '</span>');
  if (r.folder && !catchup) bits.push('<span>' + esc(r.folder) + '</span>');
  if (r.draft) bits.push('<span class="tfcc-tag">draft</span>');
  for (const t of r.tags) bits.push('<span class="tfcc-tag">' + esc(t) + '</span>');
  let h = '<div class="tfcc-row" data-id="' + r.id + '">'
    + '<div class="r-t">' + (r.pinned ? '<span class="tfcc-pinned" title="Pinned">*</span>' : '') + titleLink(r) + '</div>'
    + '<div class="r-l2"><div class="tfcc-meta">' + bits.join('') + '</div><span class="r-btns">'
    + (catchup ? '<button type="button" class="r-read" data-act="read"' + id + ' aria-label="Mark read: ' + esc(r.title) + '">'
      + ico('check', 18) + 'Read</button>' : '')
    + '<button type="button" data-act="row-more"' + id + ' aria-expanded="' + (open ? 'true' : 'false') + '"'
    + ' aria-controls="tfcc-act-' + r.id + '" aria-label="Actions for ' + esc(r.title) + '">' + ico(open ? 'close' : 'more', 18) + '</button>'
    + '</span></div>';
  if (r.note) h += '<div class="r-note">' + esc(r.note) + '</div>';
  if (open) {
    h += '<div class="r-drawer" id="tfcc-act-' + r.id + '">'
      + '<button type="button" data-act="pin"' + id + '>' + ico('pin', 18) + (r.pinned ? 'Unpin' : 'Pin') + '</button>'
      + (catchup ? '' : '<button type="button" data-act="read"' + id + '>' + ico('read', 18) + 'Mark read</button>')
      + '<button type="button" data-act="draft"' + id + '>' + ico('draft', 18) + (r.draft ? 'Edit draft' : 'Draft') + '</button>'
      + '<button type="button" data-act="archive"' + id + '>' + ico('archive', 18) + 'Archive</button>'
      + '<div class="r-step r-wide"><button type="button" data-act="prio-down"' + id + ' aria-label="Lower priority">-</button>'
      + '<span>Priority <b>' + (r.prio > 0 ? '+' : '') + r.prio + '</b></span>'
      + '<button type="button" data-act="prio-up"' + id + ' aria-label="Raise priority">+</button></div>'
      + '<select data-act="folder"' + id + ' class="r-wide" aria-label="Folder"><option>' + esc(r.folder || 'Unfiled') + '</option></select>'
      + '<input type="text" data-act="tag-input"' + id + ' placeholder="add tag" aria-label="Add tag">'
      + '<input type="text" data-act="note-input"' + id + ' placeholder="note" value="' + esc(r.note || '') + '" aria-label="Note">'
      + '</div>';
  }
  return h + '</div>';
}
function rShelf() {
  return '<div class="r-shelf"><div>Streak 5 Torn days, today counted. Best 9.</div>'
    + '<div class="r-shelf-row">Next: Regular <span class="r-bar-track"><span class="r-bar-fill"></span></span>'
    + '<span class="tfcc-note">10 / 25</span></div>'
    + '<div class="r-shelf-row"><span class="tfcc-note">4 of 31 earned</span>'
    + '<button type="button" data-act="badges-all">All badges</button></div></div>';
}
function revisedThreads(o) {
  const opts = o || {};
  if (opts.collapsed) return rHead({ collapsed: true });
  const rows = ROWS.map((r, i) => rRow(r, { open: opts.openRow === i })).join('');
  return rHead({}) + (opts.shelf ? rShelf() : '') + rNav('threads') + rFilter(opts.filtersOpen)
    + '<h3 class="m-sr" tabindex="-1">Threads</h3>'
    + '<div class="tfcc-rows">' + rows + '</div>'
    + '<div class="r-cap"><span class="tfcc-note">Showing 5 of 6</span>'
    + '<button type="button" data-act="rows-toggle" data-view="threads">Show all</button></div>'
    + '<p class="tfcc-note" style="margin:6px 0 0 0">Updated 4m ago.</p>';
}
function revisedCatchup(o) {
  const opts = o || {};
  const pick = [ROWS[0], ROWS[1], ROWS[2]];
  const group = (name, list, start) => '<div class="tfcc-section"><h4>' + esc(name) + ' (' + list.length + ')</h4><div class="tfcc-rows">'
    + list.map((r, j) => rRow(r, { catchup: true, open: opts.openRow === start + j })).join('') + '</div></div>';
  return rHead({}) + rNav('catchup')
    + '<h3 class="r-vh" tabindex="-1">Catch up <span class="tfcc-note" style="font-weight:normal">since 7 Aug 12:00</span></h3>'
    + '<div class="r-catchbar"><button type="button" data-act="markall">Mark all read</button>'
    + '<button type="button" data-act="catchup-done">Set catch-up point to now</button></div>'
    + '<p class="tfcc-note" style="margin:0 0 6px 0">Marking read here hides a thread from this list. It cannot clear '
    + 'Torn\'s own new-post counter, which only clears when you open the thread.</p>'
    + group('Guides', [pick[0]], 0) + group('Scripts and tools', [pick[1]], 1) + group('Unfiled', [pick[2]], 2);
}
function revisedMine() {
  return rHead({}) + rNav('mine')
    + '<div class="r-rx">' + pill() + '</div>'
    + '<p class="tfcc-note" style="margin:0 0 6px 0">Threads you started or posted in. Updated 4m ago.</p>'
    + rFilter(false) + '<div class="tfcc-rows">' + rRow(ROWS[4], {}) + '</div>';
}
function rScreen(theme, width, body, caption, extra) {
  return screen(theme, width, body, Object.assign({ caption: caption, panelClass: 'tfcc-narrow' }, extra || {}));
}
function revisedPage(width) {
  const w = width;
  const fold = { fold: FOLD, foldLabel: FOLD_LABEL };
  const phones = [
    rScreen('dark', w, revisedThreads(), 'R / dark / ' + w + ' / Threads at rest', fold),
    rScreen('light', w, revisedThreads(), 'R / light / ' + w + ' / Threads at rest', fold),
    rScreen('dark', w, revisedCatchup({}), 'R / dark / ' + w + ' / Catch up, one-tap Read', fold),
    rScreen('light', w, revisedCatchup({ openRow: 1 }), 'R / light / ' + w + ' / Catch up, one drawer open'),
    rScreen('light', w, revisedThreads({ filtersOpen: true }), 'R / light / ' + w + ' / filters open'),
    rScreen('dark', w, revisedThreads({ shelf: true }), 'R / dark / ' + w + ' / badge shelf open'),
    rScreen('dark', w, revisedThreads({ openRow: 0 }), 'R / dark / ' + w + ' / Threads, one drawer open'),
    rScreen('light', w, revisedMine(), 'R / light / ' + w + ' / My posts, reactions visible'),
    rScreen('dark', w, revisedThreads({ collapsed: true }), 'R / dark / ' + w + ' / collapsed, Show has text'),
    rScreen('light', w, revisedThreads({ collapsed: true }), 'R / light / ' + w + ' / collapsed, Show has text'),
  ];
  if (w === 320) {
    phones.push(screen('dark', w, revisedThreads(), { caption: 'R / dark / 320 / text at 200%',
      panelClass: 'tfcc-narrow" style="--tfcc-text: 28px; --tfcc-text-sm: 24px' }));
  }
  return phones;
}

// ---- write -----------------------------------------------------------------------
const FOLD = 560;
const FOLD_LABEL = 'about one screen of PDA web view';
const files = {
  'concept-a-toolbar-drawer.html': page('Concept A: toolbar and drawer',
    'Issue #33 concept A at 375px: one-line header, four-cell nav with More, filter line, per-row drawer.', [
      screen('dark', 375, conceptA('dark'), { caption: 'A / dark / 375 / at rest', fold: FOLD, foldLabel: FOLD_LABEL }),
      screen('light', 375, conceptA('light', { openRow: 1, moreOpen: true, filtersOpen: false }),
        { caption: 'A / light / 375 / More open, row 2 drawer open' }),
      screen('dark', 375, conceptA('dark', { filtersOpen: true, openRow: 0 }),
        { caption: 'A / dark / 375 / filters open, row 1 drawer open' }),
    ]),
  'concept-b-thumb-dock.html': page('Concept B: thumb dock',
    'Issue #33 concept B at 375px: views in a sticky bottom dock, tap-to-expand rows with an icon grid.', [
      screen('dark', 375, conceptB('dark', { takeover: true }), { caption: 'B / dark / 375 / Expand (takeover)',
        panelClass: 'm-takeover', fold: FOLD, foldLabel: FOLD_LABEL }),
      screen('light', 375, conceptB('light', { takeover: true, openRow: 1 }), { caption: 'B / light / 375 / row 2 expanded',
        panelClass: 'm-takeover' }),
    ]),
  'concept-c-inbox-select.html': page('Concept C: inbox and select',
    'Issue #33 concept C at 375px: view switcher menu, inbox rows with a select box, contextual action bar.', [
      screen('dark', 375, conceptC('dark'), { caption: 'C / dark / 375 / at rest', fold: FOLD, foldLabel: FOLD_LABEL }),
      screen('light', 375, conceptC('light', { picked: [1, 2] }), { caption: 'C / light / 375 / two rows selected' }),
      screen('dark', 375, conceptC('dark', { menuOpen: true }), { caption: 'C / dark / 375 / view menu open' }),
    ]),
  'recommended-320.html': page('Recommended at 320px',
    'Issue #33 recommendation (concept A plus the priority stepper) at 320px, dark and light.', [
      screen('dark', 320, conceptA('dark'), { caption: 'Rec / dark / 320 / at rest', fold: FOLD, foldLabel: FOLD_LABEL }),
      screen('light', 320, conceptA('light', { openRow: 0 }), { caption: 'Rec / light / 320 / row 1 drawer open' }),
      screen('dark', 320, conceptA('dark', { moreOpen: true }), { caption: 'Rec / dark / 320 / More open' }),
    ]),
  'revised-375.html': page('Revised recommendation at 375px',
    'Issue #33 revised recommendation (task-first A, after the Codex review) at 375px, dark and light.',
    ['<div style="display:flex;flex-wrap:wrap;gap:24px;align-items:flex-start;max-width:2100px">'
      + revisedPage(375).join('\n') + '</div>'], REVISED_CSS),
  'revised-320.html': page('Revised recommendation at 320px',
    'Issue #33 revised recommendation (task-first A, after the Codex review) at 320px, dark and light, plus 200% text.',
    ['<div style="display:flex;flex-wrap:wrap;gap:24px;align-items:flex-start;max-width:1900px">'
      + revisedPage(320).join('\n') + '</div>'], REVISED_CSS),
};

for (const [name, html] of Object.entries(files)) {
  for (let i = 0; i < html.length; i += 1) {
    if (html.charCodeAt(i) > 126) throw new Error(name + ': non-ASCII character at ' + i);
  }
  fs.writeFileSync(path.join(here, name), html);
  console.log('wrote ' + name);
}
