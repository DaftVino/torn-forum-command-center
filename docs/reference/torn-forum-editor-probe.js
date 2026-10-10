// TFCC #58 editor probe (docs/reference/torn-forum-editor-findings-2026-10-09.md). READ-ONLY: it clicks nothing, types nothing, sends
// nothing. Paste into DevTools Console on a forum thread page you opened
// yourself, with the reply editor visible. It copies a JSON report to your
// clipboard; paste that back into the chat.
(() => {
  const cls = (el) => (el && typeof el.className === 'string' ? el.className : '');
  const path = (el) => {
    const out = [];
    for (let n = el, i = 0; n && n.nodeType === 1 && i < 8; n = n.parentElement, i += 1) {
      out.push(n.tagName.toLowerCase() + (n.id ? '#' + n.id : '') + (cls(n) ? '.' + cls(n).trim().split(/\s+/).join('.') : ''));
    }
    return out;
  };
  const vis = (el) => {
    const s = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    return { display: s.display, visibility: s.visibility, w: Math.round(r.width), h: Math.round(r.height) };
  };
  const report = { url: location.pathname + location.hash, ua: navigator.userAgent };

  // 1. Every textarea FCC's selectors could match.
  report.textareas = [...document.querySelectorAll('textarea')].map((t) => ({
    name: t.name, id: t.id, cls: cls(t), path: path(t), ...vis(t), valueLen: (t.value || '').length,
  }));

  // 2. Every contenteditable region (the likely visible rich editor).
  report.editables = [...document.querySelectorAll('[contenteditable]:not([contenteditable="false"])')].map((e) => ({
    tag: e.tagName.toLowerCase(), id: e.id, cls: cls(e), role: e.getAttribute('role'),
    path: path(e), ...vis(e), html: e.innerHTML.slice(0, 3000),
  }));

  // 3. Hidden inputs near the editor that might carry the post body.
  report.hiddenInputs = [...document.querySelectorAll('input[type="hidden"]')]
    .filter((i) => /post|text|body|content|message/i.test(i.name + i.id))
    .map((i) => ({ name: i.name, id: i.id, valueLen: (i.value || '').length, path: path(i) }));

  // 4. Editor toolbar controls: their labels tell us the feature set.
  const ed = report.editables.length ? document.querySelector('[contenteditable]:not([contenteditable="false"])') : null;
  let root = ed;
  for (let i = 0; root && i < 6; i += 1) root = root.parentElement;
  report.toolbar = root
    ? [...root.querySelectorAll('button,[role="button"],select')].slice(0, 80).map((b) => ({
        tag: b.tagName.toLowerCase(), cls: cls(b), label: b.getAttribute('aria-label') || b.title || (b.textContent || '').trim().slice(0, 40),
      }))
    : [];

  // 5. Library fingerprints.
  const has = (sel) => !!document.querySelector(sel);
  report.fingerprints = {
    prosemirror: has('.ProseMirror'), tiptap: has('.tiptap'), tinymce: has('.tox, .mce-content-body'),
    ckeditor: has('.ck-editor, .ck-content'), quill: has('.ql-editor'), lexical: has('[data-lexical-editor]'),
    slate: has('[data-slate-editor]'), draftjs: has('.DraftEditor-root'), jodit: has('.jodit'), froala: has('.fr-element'),
  };

  // 5b. TinyMCE, if that is the library. Torn's is 6.x, whose options are read
  //     with editor.options.get(); the visible body's id names the editor, since
  //     a thread page holds several and activeEditor cannot be trusted. Read only.
  const mce = window.tinymce || window.tinyMCE;
  const body = document.querySelector('#editor-wrapper .editor-content.mce-content-body');
  const edi = mce && body && typeof mce.get === 'function' ? mce.get(body.id) : null;
  const opt = (k) => {
    try { const v = edi && edi.options ? edi.options.get(k) : undefined; return v === undefined ? null : String(v).slice(0, 2000); }
    catch (e) { return 'unregistered'; }
  };
  report.tinymce = mce ? {
    version: [mce.majorVersion, mce.minorVersion].join('.'),
    editors: (typeof mce.get === 'function' ? mce.get() : mce.editors || []).length,
    editorId: body ? body.id : null,
    options: edi ? {
      plugins: opt('plugins'), toolbar: opt('toolbar'),
      valid_elements: opt('valid_elements'), extended_valid_elements: opt('extended_valid_elements'),
      invalid_elements: opt('invalid_elements'), valid_styles: opt('valid_styles'),
      paste_webkit_styles: opt('paste_webkit_styles'), paste_remove_styles_if_webkit: opt('paste_remove_styles_if_webkit'),
      paste_data_images: opt('paste_data_images'), images_upload_url: opt('images_upload_url') ? 'set' : null,
      color_map: opt('color_map'), font_size_formats: opt('font_size_formats'),
    } : null,
  } : null;
  report.editorWrapper = !!document.querySelector('#editor-wrapper .editor-content.mce-content-body');
  report.jquery = !!(window.jQuery || window.$ && window.$.fn && window.$.fn.jquery);

  // 6. Every --te-* custom property defined in readable stylesheets, with its
  //    value as currently resolved on this page (light or dark).
  const names = new Set();
  for (const sheet of document.styleSheets) {
    let rules;
    try { rules = sheet.cssRules; } catch (e) { continue; }
    const walk = (list) => {
      for (const r of list) {
        if (r.style) for (const p of r.style) if (p.startsWith('--te-')) names.add(p);
        if (r.cssRules) walk(r.cssRules);
      }
    };
    walk(rules);
  }
  const probeEl = ed || document.body;
  const cs = getComputedStyle(probeEl);
  report.teVars = [...names].sort().map((n) => [n, cs.getPropertyValue(n).trim()]);
  report.bodyClass = document.body.className;

  const json = JSON.stringify(report, null, 1);
  try { copy(json); console.log('TFCC probe: copied ' + json.length + ' chars to the clipboard.'); }
  catch (e) { console.log(json); }
})();
