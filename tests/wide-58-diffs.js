'use strict';

// #58: the owner-approved wide changes for the Drafts rich editor (spec
// docs/superpowers/specs/2026-10-09-drafts-rich-editor-design.md, section 8).
// The golden is never regenerated; every change a wide panel sees is named
// here, applied by tests/wide-parity.test.js after the release list.
//
// The wide seed's draft is an old one with no language, so it opens in Text:
// the toolbar row is hidden there (spec section 2) and the preview bar shows
// only in Preview. Their rules are still in the stylesheet, so they are
// listed in `inserted`. The 44px narrow sizes hang entirely off .tfcc-narrow
// and add nothing here.
//
// literals: exact markup replacements in a view (`from` occurs exactly once).
// inserted: the complete new stylesheet lines a wide panel may now see.

const literals = [
  // US spelling (Batch A, owner): the Settings transparency table says organizing.
  {
    item: '58b US spelling organizing', view: 'settings',
    from: 'Public community tool: listing and organising the forum threads you subscribe to.',
    to: 'Public community tool: listing and organizing the forum threads you subscribe to.',
  },
  // The drafts view: main's "Draft for this thread" section becomes the editor
  // pane: the mode pill (Text | MD | HTML | Preview, the draft's mode pressed),
  // then the textarea, held to DRAFT_MAX_CHARS and given a word name (plan
  // review item 1). The action row and the Copy note are main's.
  {
    item: '58 drafts editor pane', view: 'drafts',
    from: '<div class="tfcc-section"><h4>Draft for this thread</h4>'
      + '<textarea class="tfcc-draft" data-act="draft-text" data-id="101">',
    to: '<div class="tfcc-section tfcc-draft-editor"><h4>Draft for this thread '
      + '<button type="button" class="tfcc-info" data-act="info" data-info="drafts-editor" aria-expanded="false" '
      + 'aria-controls="tfcc-info-drafts-editor" aria-label="About drafts" title="About drafts">'
      + '<svg class="tfcc-gl" viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false">'
      + '<path d="M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18zM12 11v6M12 7.5v.5"/></svg></button></h4>'
      + '<p class="tfcc-note tfcc-infotext" id="tfcc-info-drafts-editor" hidden>'
      + 'A draft belongs to one thread, or is a free draft you can use for anything, such as a new thread. '
      + 'Save keeps it on this device only. Insert puts the post at the end of the reply box on Torn, and you still press Post yourself. '
      + 'Copy is for anywhere else. What you type in the reply box on Torn is also autosaved here as an HTML draft.</p>'
      + '<div class="tfcc-modes" role="group" aria-label="Editor mode">'
      + '<button type="button" data-act="ed-mode" data-mode="text" aria-pressed="true">Text</button>'
      + '<button type="button" data-act="ed-mode" data-mode="md" aria-pressed="false">MD</button>'
      + '<button type="button" data-act="ed-mode" data-mode="html" aria-pressed="false">HTML</button>'
      + '<button type="button" data-act="ed-mode" data-mode="preview" aria-pressed="false">Preview</button>'
      + '</div>'
      // E2: in Text mode the toolbar row is just Undo, disabled until there
      // is something to undo.
      + '<div class="tfcc-tools" role="toolbar" aria-label="Formatting">'
      + '<button type="button" data-act="ed-undo" aria-label="Undo the last change" title="Undo the last change" disabled>Undo</button>'
      + '</div>'
      + '<textarea class="tfcc-draft" data-act="draft-text" data-id="101" maxlength="20000" aria-label="Draft text">',
  },
  // E1: a thread draft's action row ends with Save as free draft, after a gap.
  {
    item: '58e save as free draft', view: 'drafts',
    from: '<button type="button" data-act="draft-delete" data-id="101">Delete</button></div><p class="tfcc-note">',
    to: '<button type="button" data-act="draft-delete" data-id="101">Delete</button>'
      + '<button type="button" data-act="draft-to-free" class="tfcc-tofree" data-id="101">Save as free draft</button>'
      + '</div><p class="tfcc-note">',
  },
  // All drafts gains + New draft under its heading.
  {
    item: '58 new draft', view: 'drafts',
    from: '<h4>All drafts (1)</h4>',
    to: '<h4>All drafts (1)</h4><div class="tfcc-actions"><button type="button" data-act="draft-new">+ New draft</button></div>',
  },
  // Each listed draft opens in the editor with Edit, before Copy and Delete.
  {
    item: '58 edit draft', view: 'drafts',
    from: '<div class="tfcc-hit-text">A draft reply.</div><div class="tfcc-actions">',
    to: '<div class="tfcc-hit-text">A draft reply.</div><div class="tfcc-actions">'
      + '<button type="button" data-act="draft-edit" data-id="101">Edit</button>',
  },
  // Settings: the Default editor row after the autosave row (spec section 2:
  // Markdown, HTML or Text, Markdown by default).
  {
    item: '58 default editor', view: 'settings',
    from: '<input id="tfcc-autosave" type="checkbox" data-act="autosave" checked></div>',
    to: '<input id="tfcc-autosave" type="checkbox" data-act="autosave" checked></div>'
      + '<div class="tfcc-kv"><label for="tfcc-draftlang">Default editor for new drafts</label>'
      + '<select id="tfcc-draftlang" data-act="draft-lang"><option value="md" selected>Markdown</option>'
      + '<option value="html">HTML</option><option value="text">Text</option></select></div>',
  },
];

const inserted = [
  // Task 10: the mode pill (pressed uses --tm-good-bg, as every pressed
  // button does; there is no --tm-accent-bg token), the preview bar and pane
  // with Torn's measured colors for each theme, and the Text confirm.
  '#tfcc-panel .tfcc-modes { display: flex; gap: 0; margin-bottom: var(--tfcc-gap-sm); }',
  '#tfcc-panel .tfcc-modes button { flex: 1 1 0; min-height: 32px; border-radius: 0; }',
  '#tfcc-panel .tfcc-modes button[aria-pressed="true"] { background: var(--tm-good-bg); color: var(--tm-text); }',
  '#tfcc-panel .tfcc-pvbar { display: flex; align-items: center; gap: var(--tfcc-gap-sm); margin-bottom: var(--tfcc-gap-sm); }',
  '#tfcc-panel .tfcc-pv { border: 1px solid var(--tm-border); border-radius: 4px; padding: 8px; overflow-x: auto; }',
  '#tfcc-panel .tfcc-pv-light { background: #ffffff; color: #333333; --te-text-color-red: #f03e3e; '
    + '--te-text-color-pink: #d6336c; --te-text-color-grape: #ae3ec9; --te-text-color-violet: #7048e8; '
    + '--te-text-color-indigo: #4263eb; --te-text-color-blue: #1c7ed6; --te-text-color-cyan: #1098ad; '
    + '--te-text-color-teal: #0ca678; --te-text-color-green: #37b24d; --te-text-color-lime: #66a80f; '
    + '--te-text-color-yellow: #e67700; --te-text-color-orange: #d9480f; --te-text-color-gray1: #333333; '
    + '--te-text-color-gray2: #666666; --te-text-color-gray3: #999999; --te-text-color-gray4: #cccccc; '
    + '--te-text-color-gray5: #ffffff; }',
  '#tfcc-panel .tfcc-pv-dark { background: #111111; color: #dddddd; --te-text-color-red: #ff8787; '
    + '--te-text-color-pink: #faa2c1; --te-text-color-grape: #e599f7; --te-text-color-violet: #d0bfff; '
    + '--te-text-color-indigo: #bac8ff; --te-text-color-blue: #a5d8ff; --te-text-color-cyan: #99e9f2; '
    + '--te-text-color-teal: #63e6be; --te-text-color-green: #8ce99a; --te-text-color-lime: #a9e34b; '
    + '--te-text-color-yellow: #ffd43b; --te-text-color-orange: #ffa94d; --te-text-color-gray1: #ffffff; '
    + '--te-text-color-gray2: #dddddd; --te-text-color-gray3: #aaaaaa; --te-text-color-gray4: #888888; '
    + '--te-text-color-gray5: #000000; }',
  '#tfcc-panel .tfcc-pv-block { cursor: text; }',
  '#tfcc-panel .tfcc-pv p { margin: 0; }',
  '#tfcc-panel .tfcc-pv img { max-width: 100%; }',
  '#tfcc-panel .tfcc-pv table { border-collapse: collapse; }',
  '#tfcc-panel .tfcc-pv th, #tfcc-panel .tfcc-pv td { border: 1px solid currentColor; padding: 2px 6px; }',
  '#tfcc-panel .tfcc-pv blockquote { margin: 0 0 0 8px; padding-left: 8px; border-left: 3px solid currentColor; }',
  '#tfcc-panel .tfcc-confirm { margin-bottom: var(--tfcc-gap-sm); }',
  // Task 11: the toolbar, the inline pickers, the swatches and emoji grid,
  // the image check thumbnail and the ? reference.
  '#tfcc-panel .tfcc-tools { display: flex; flex-wrap: wrap; gap: 4px; margin-bottom: var(--tfcc-gap-sm); }',
  '#tfcc-panel .tfcc-tools button { min-width: 32px; min-height: 32px; }',
  // E1: Save as free draft, apart from Delete in a secondary color.
  '#tfcc-panel .tfcc-actions button.tfcc-tofree { margin-left: var(--tfcc-gap-lg); color: var(--tm-accent-text); }',
  '#tfcc-panel .tfcc-picker { border: 1px solid var(--tm-border); border-radius: 4px; padding: 8px; margin-bottom: var(--tfcc-gap-sm); }',
  '#tfcc-panel .tfcc-swatches, #tfcc-panel .tfcc-emoji { display: flex; flex-wrap: wrap; gap: 4px; }',
  '#tfcc-panel .tfcc-swatch { display: block; width: 20px; height: 20px; border-radius: 3px; border: 1px solid var(--tm-border); }',
  '#tfcc-panel .tfcc-img-check { display: block; max-width: 100%; max-height: 160px; margin: 4px 0; }',
  '#tfcc-panel .tfcc-key { border-collapse: collapse; width: 100%; }',
  '#tfcc-panel .tfcc-key th, #tfcc-panel .tfcc-key td { border: 1px solid var(--tm-border); padding: 2px 6px; text-align: left; vertical-align: top; overflow-wrap: anywhere; }',
];

module.exports = { literals, inserted };
