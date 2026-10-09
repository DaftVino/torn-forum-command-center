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
