'use strict';
// v0.2.2's draft normaliser, frozen: what an older build does with a blob this
// build writes (spec section 6, downgrade). Copied from tag v0.2.2; never edit.
  var SCHEMA_VERSION = 1;
  var DRAFT_MAX_CHARS = 20000;
  function isPlainObject(v) {
    return !!v && typeof v === 'object' && !Array.isArray(v);
  }

  function toInt(v, fallback) {
    var n = Number(v);
    if (!isFinite(n)) return fallback;
    return Math.floor(n);
  }

  function safeString(v, max) {
    if (typeof v !== 'string') return '';
    var limit = max === undefined ? 500 : max;
    return v.length > limit ? v.slice(0, limit) : v;
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


module.exports = normaliseDrafts;
