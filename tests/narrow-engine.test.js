'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { loadUserscript } = require('./load-userscript');

const { exports: api } = loadUserscript();

// ---- the breakpoint (spec section 5) --------------------------------------

test('narrowFor enters at 600px or less and leaves only above 616px', () => {
  const cases = [
    // [width, wasNarrow, expected]
    [600, false, true], [601, false, false], [320, false, true],
    [610, true, true], [616, true, true], [617, true, false],
    [617, false, false], [1100, true, false],
  ];
  for (const [w, was, want] of cases) {
    assert.strictEqual(api.narrowFor(w, was), want, w + 'px from ' + (was ? 'narrow' : 'wide'));
  }
});

test('narrowFor keeps the current layout when the width is unknown', () => {
  // A harness, a detached panel or a failed measurement reads 0. Flipping on
  // that would make every unmeasurable panel narrow.
  for (const w of [0, -5, NaN, undefined, null, '500', Infinity * 0]) {
    assert.strictEqual(api.narrowFor(w, false), false, String(w) + ' from wide');
    assert.strictEqual(api.narrowFor(w, true), true, String(w) + ' from narrow');
  }
});

// ---- the header maths (spec section 13b) -----------------------------------
// C is the panel's content width: the panel minus 2 x 8px padding and 2 x 1px
// border. The chip measures 72px normal and 58px compact on the mockups.

test('headerButtonSize matches the spec widths', () => {
  const cases = [
    // [C, chip, show, icons, size]   viewport
    [325, 72, 0, 3, 44],    // 375: the ceiling
    [270, 72, 0, 3, 41.5],  // 320: the 0.5px step lands on 41.5 (the spec's "about 41")
    [230, 72, 0, 3, 32],    // 280 with the normal chip: under 36, so the runtime goes compact
    [230, 58, 0, 3, 35],    // 280 with the compact chip
    [188, 58, 0, 3, 24],    // the floor still fits at C = 188
    [270, 86, 0, 3, 38],    // 320 at 200% text: the chip widens to 86px
    [270, 58, 65, 2, 38.5], // one solve with a fixed 65px Show; fitHeader re-measures Show, giving 37 (narrow-runtime)
  ];
  for (const [c, chip, show, icons, size] of cases) {
    const r = api.headerButtonSize(c, chip, show, icons);
    assert.strictEqual(r.size, size, 'C=' + c + ' chip=' + chip + ' show=' + show);
    assert.strictEqual(r.fits, true);
  }
});

test('headerButtonSize never goes below the 24px floor and says when even that does not fit', () => {
  const r = api.headerButtonSize(187, 58, 0, 3);
  assert.deepStrictEqual(r, { size: 24, fits: false });
  assert.deepStrictEqual(api.headerButtonSize(40, 58, 0, 3), { size: 24, fits: false });
  assert.deepStrictEqual(api.headerButtonSize(NaN, 58, 0, 3), { size: 24, fits: false });
});

test('headerButtonSize never exceeds the 44px ceiling', () => {
  assert.deepStrictEqual(api.headerButtonSize(2000, 0, 0, 3), { size: 44, fits: true });
});

test('headerButtonSize returns the largest half-pixel size that keeps the header on one line', () => {
  // The one-line promise as an invariant: the chosen size fits, and the next
  // step up does not, for every content width from 150 to 400px.
  const need = (s, chip, show, n) => api.headerLogoWidth(s) + chip + n * s + show + api.HB_GAPS;
  for (const [chip, show, n] of [[72, 0, 3], [58, 0, 3], [58, 65, 2]]) {
    for (let c = 150; c <= 400; c += 1) {
      const r = api.headerButtonSize(c, chip, show, n);
      assert.ok(r.size >= api.HB_MIN && r.size <= api.HB_MAX, 'bounds at C=' + c);
      if (r.fits) {
        assert.ok(need(r.size, chip, show, n) <= c, 'one line at C=' + c);
        if (r.size < api.HB_MAX) assert.ok(need(r.size + api.HB_STEP, chip, show, n) > c, 'largest at C=' + c);
      } else {
        assert.ok(need(api.HB_MIN, chip, show, n) > c, 'fits:false only when 24px does not fit, C=' + c);
      }
    }
  }
});

test('the logo follows the button size between 16 and 24px tall', () => {
  // Within floating-point rounding: the code multiplies by the 106 / 45 ratio.
  const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, a + ' vs ' + b);
  near(api.headerLogoWidth(50), 24 * 106 / 45); // the 24px cap (0.545 x 44 is 23.98, just under it)
  near(api.headerLogoWidth(44), 0.545 * 44 * 106 / 45);
  near(api.headerLogoWidth(24), 16 * 106 / 45);
  near(api.headerLogoWidth(36), 0.545 * 36 * 106 / 45);
});

test('the gap constant is the sum the stylesheet promises', () => {
  // logo-chip 6 + group 6 + 2 x 4 between buttons. tests/style.test.js checks
  // the narrow header CSS uses exactly these gaps.
  assert.strictEqual(api.HB_GAPS, 6 + 6 + 2 * 4);
});

// ---- the Filters button count (spec section 4.3) ---------------------------

test('activeFilterCount counts the folder and tag filters only', () => {
  assert.strictEqual(api.activeFilterCount({}), 0);
  assert.strictEqual(api.activeFilterCount({ folderFilter: 'guides' }), 1);
  assert.strictEqual(api.activeFilterCount({ folderFilter: 'guides', tagFilter: 'x' }), 2);
  assert.strictEqual(api.activeFilterCount({ sort: 'title', unreadOnly: true }), 0, 'sort and Unread are not filters behind the button');
  assert.strictEqual(api.activeFilterCount(null), 0);
});

// ---- the transient state machine (spec section 6) -------------------------

const OPEN = { openRowId: 'A', filtersOpen: true, openInfoId: 'catchup', drawerEdit: { id: 'A', field: 'note-input', value: 'x', selStart: 1, selEnd: 1 } };

test('Actions on row A opens A, and again closes it', () => {
  const a = api.nextTransient(api.freshTransient(), { type: 'row-more', id: 'A' });
  assert.strictEqual(a.openRowId, 'A');
  const closed = api.nextTransient(a, { type: 'row-more', id: 'A' });
  assert.strictEqual(closed.openRowId, null);
});

test('Actions on row B while A is open opens B and keeps A\'s uncommitted edit', () => {
  const b = api.nextTransient(OPEN, { type: 'row-more', id: 'B' });
  assert.strictEqual(b.openRowId, 'B');
  assert.deepStrictEqual(b.drawerEdit, OPEN.drawerEdit, 'the mirror lives until its field commits');
  assert.strictEqual(b.filtersOpen, true, 'filters are unchanged');
  assert.strictEqual(b.openInfoId, 'catchup', 'info is unchanged by row actions');
});

test('Filters toggles and touches nothing else', () => {
  const t = api.nextTransient(OPEN, { type: 'filters' });
  assert.strictEqual(t.filtersOpen, false);
  assert.strictEqual(t.openRowId, 'A');
});

test('an info button toggles its own key, one open at a time', () => {
  const t = api.nextTransient(api.freshTransient(), { type: 'info', key: 'catchup' });
  assert.strictEqual(t.openInfoId, 'catchup');
  assert.strictEqual(api.nextTransient(t, { type: 'info', key: 'catchup' }).openInfoId, null);
  assert.strictEqual(api.nextTransient(t, { type: 'info', key: 'settings-budget' }).openInfoId, 'settings-budget');
  assert.strictEqual(api.nextTransient(t, { type: 'info', key: 'not-a-key' }).openInfoId, 'catchup', 'an unknown key changes nothing');
});

test('a view change, Hide, auto-hide and the breakpoint close every disclosure but keep an uncommitted edit', () => {
  // The mirror is the only copy of what was typed until the field commits on
  // blur; a rotation or a redraw in between must not lose it (plan review).
  for (const type of ['view', 'collapse', 'auto-hide', 'breakpoint']) {
    assert.deepStrictEqual(api.nextTransient(OPEN, { type }),
      { openRowId: null, filtersOpen: false, openInfoId: null, drawerEdit: OPEN.drawerEdit }, type);
  }
  assert.deepStrictEqual(api.nextTransient(api.freshTransient(), { type: 'view' }), api.freshTransient());
});

test('Show, refresh, filter, cap and row actions leave the transients alone', () => {
  for (const type of ['show', 'refresh', 'filter', 'cap', 'pin', 'prio', 'read', 'archive', 'route', undefined]) {
    assert.deepStrictEqual(api.nextTransient(OPEN, { type }), OPEN, String(type));
  }
  assert.deepStrictEqual(api.nextTransient(OPEN, null), OPEN);
});

test('nextTransient normalises a damaged input', () => {
  assert.deepStrictEqual(api.nextTransient(null, null), api.freshTransient());
  assert.deepStrictEqual(api.nextTransient({ openRowId: 5, filtersOpen: 'yes', openInfoId: {}, drawerEdit: 'x' }, null),
    api.freshTransient());
});

test('reconcileTransient clears an open row that is not rendered', () => {
  const t = api.reconcileTransient(OPEN, ['B', 'C'], ['catchup']);
  assert.strictEqual(t.openRowId, null);
  assert.deepStrictEqual(t.drawerEdit, OPEN.drawerEdit, 'an uncommitted edit outlives its drawer');
  assert.strictEqual(t.openInfoId, 'catchup');
  assert.strictEqual(t.filtersOpen, true);
});

test('reconcileTransient keeps an open row that is still rendered', () => {
  assert.deepStrictEqual(api.reconcileTransient(OPEN, ['A', 'B'], ['catchup']), OPEN);
});

test('reconcileTransient clears an info key the view does not render', () => {
  assert.strictEqual(api.reconcileTransient(OPEN, ['A'], []).openInfoId, null);
  assert.strictEqual(api.reconcileTransient(OPEN, ['A'], api.INFO_KEYS_BY_VIEW.settings).openInfoId, null);
});

test('every view has an info key list, and every listed key has a name', () => {
  for (const v of api.VIEWS) {
    assert.ok(Array.isArray(api.INFO_KEYS_BY_VIEW[v]), v);
    for (const k of api.INFO_KEYS_BY_VIEW[v]) assert.match(api.INFO_KEYS[k], /^About /, k);
  }
  const listed = [].concat(...api.VIEWS.map((v) => api.INFO_KEYS_BY_VIEW[v]));
  assert.deepStrictEqual(listed.slice().sort(), Object.keys(api.INFO_KEYS).sort(), 'no key is orphaned or listed twice');
});

// ---- the focus plan (spec section 6, focus rules) --------------------------

const IDS = ['1', '2', '3'];
const NARROW_CATCHUP = { ids: IDS, view: 'catchup', narrow: true };

test('Read removes the first row: same control, then the next row\'s Read, then the heading', () => {
  assert.deepStrictEqual(api.focusPlan({ act: 'read', id: '1' }, NARROW_CATCHUP), [
    '[data-act="read"][data-id="1"]', '[data-act="read"][data-id="2"]', '#tfcc-vh',
  ]);
});

test('Read removes a middle row: next row first, then the previous row', () => {
  assert.deepStrictEqual(api.focusPlan({ act: 'read', id: '2' }, NARROW_CATCHUP), [
    '[data-act="read"][data-id="2"]', '[data-act="read"][data-id="3"]', '[data-act="read"][data-id="1"]', '#tfcc-vh',
  ]);
});

test('Read removes the last row: the previous row, then the heading', () => {
  assert.deepStrictEqual(api.focusPlan({ act: 'read', id: '3' }, NARROW_CATCHUP), [
    '[data-act="read"][data-id="3"]', '[data-act="read"][data-id="2"]', '#tfcc-vh',
  ]);
});

test('Read removes the only row: the heading', () => {
  assert.deepStrictEqual(api.focusPlan({ act: 'read', id: '9' }, { ids: ['9'], view: 'catchup', narrow: true }), [
    '[data-act="read"][data-id="9"]', '#tfcc-vh',
  ]);
});

test('Archive from a Threads drawer falls back to the neighbours\' Actions', () => {
  assert.deepStrictEqual(api.focusPlan({ act: 'archive', id: '2' }, { ids: IDS, view: 'threads', narrow: true }), [
    '[data-act="archive"][data-id="2"]', '[data-act="row-more"][data-id="3"]', '[data-act="row-more"][data-id="1"]', '#tfcc-vh',
  ]);
});

test('wide falls back to the same control on the neighbour, then the pressed nav cell', () => {
  assert.deepStrictEqual(api.focusPlan({ act: 'read', id: '1' }, { ids: IDS, view: 'catchup', narrow: false }), [
    '[data-act="read"][data-id="1"]', '[data-act="read"][data-id="2"]', '[data-act="view"][aria-pressed="true"]',
  ]);
});

test('view, info and collapse controls name themselves exactly', () => {
  assert.deepStrictEqual(api.focusPlan({ act: 'view', view: 'drafts' }, { ids: [], view: 'drafts', narrow: true }),
    ['[data-act="view"][data-view="drafts"]', '#tfcc-vh']);
  assert.deepStrictEqual(api.focusPlan({ act: 'info', info: 'catchup' }, NARROW_CATCHUP),
    ['[data-act="info"][data-info="catchup"]', '#tfcc-vh']);
  assert.deepStrictEqual(api.focusPlan({ act: 'collapse' }, NARROW_CATCHUP), ['[data-act="collapse"]', '#tfcc-vh']);
});

test('a hostile attribute value cannot break out of the selector', () => {
  // Quotes and backslashes are dropped, so the value stays inside its own
  // attribute and cannot open a second selector.
  const plan = api.focusPlan({ act: 'read', id: '1"] , #x[a="\\' }, NARROW_CATCHUP);
  assert.strictEqual(plan[0], '[data-act="read"][data-id="1] , #x[a="]');
  assert.strictEqual(plan.length, 2, 'an id not in the list adds no neighbours');
});

test('an empty target still ends at the fallback', () => {
  assert.deepStrictEqual(api.focusPlan(null, null), ['[data-act="view"][aria-pressed="true"]']);
});

// ---- the collapsed count is part of the solve (PR #38 review) ---------------
// Show is passed as its width at 24px plus a slope: its padding is
// clamp(4px, 0.2 x size, 10px) a side, linear across 24-44px (65px at 24 is
// spec 13b's own figure). The count "16" is about 30px; "128" about 37px.

test('Show grows with the size when a slope is given', () => {
  // 320 collapsed, no count, compact chip: spec 13b's 37.
  assert.deepStrictEqual(api.headerButtonSize(270, 58, 65, 2, 0, 0.4), { size: 37, fits: true });
});

test('the collapsed count and its 6px gap are part of the one-line solve', () => {
  // 320 collapsed with "16": one line at 26px, where 26.5 would overflow.
  assert.deepStrictEqual(api.headerButtonSize(270, 58, 65, 2, 30, 0.4), { size: 26, fits: true });
  const need = (s, count) => api.headerLogoWidth(s) + 58 + (count ? count + 6 : 0) + 2 * s
    + (65 + 0.4 * (s - 24)) + api.HB_GAPS;
  assert.ok(need(26, 30) <= 270 && need(26.5, 30) > 270, 'the largest size that keeps the count on the line');
  // 375 with "16", normal chip: 38.
  assert.deepStrictEqual(api.headerButtonSize(325, 72, 65, 2, 30, 0.4), { size: 38, fits: true });
});

test('when even 24px cannot hold the count, the solve says so', () => {
  // 280 with "16", and 320 with "128": the count has to wrap.
  assert.deepStrictEqual(api.headerButtonSize(230, 58, 65, 2, 30, 0.4), { size: 24, fits: false });
  assert.deepStrictEqual(api.headerButtonSize(270, 58, 65, 2, 37, 0.4), { size: 24, fits: false });
});
