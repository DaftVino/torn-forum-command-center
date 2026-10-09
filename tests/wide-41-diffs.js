'use strict';

// #41: the owner-approved wide markup change of the clip setting, with the
// setting OFF (the state the parity golden is compared in). One literal
// replacement, applied by tests/wide-parity.test.js after the 13d list: the
// new Settings checkbox and its info button, after the auto-hide one. What
// turning the setting ON adds is asserted by its own test there, not here.

const INFO = '<button type="button" class="tfcc-info" data-act="info" data-info="settings-clip" aria-expanded="false"'
  + ' aria-controls="tfcc-info-settings-clip" aria-label="About clipping">'
  + '<svg class="tfcc-gl" viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false">'
  + '<path d="M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18zM12 11v6M12 7.5v.5"/></svg></button>';

const AUTOHIDE_END = 'leaves the panel as it is. Press Show to bring it back.</p>';

module.exports = [
  {
    item: '41 clip setting', view: 'settings',
    from: AUTOHIDE_END,
    to: AUTOHIDE_END
      + '<div class="tfcc-kv"><label for="tfcc-clip">Clip titles and summaries that wrap</label>'
      + '<input id="tfcc-clip" type="checkbox" data-act="clip-lines">' + INFO + '</div>'
      + '<p class="tfcc-note tfcc-infotext" id="tfcc-info-settings-clip" hidden>Each row\'s title and summary stay '
      + 'on one line, ending in ... when they would wrap. On a phone, open a row\'s actions to read it whole; '
      + 'on a wider screen, hover over it. Turn this off to let them wrap.</p>',
  },
];
