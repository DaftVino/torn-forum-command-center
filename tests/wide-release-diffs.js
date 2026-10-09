'use strict';

// Releases: the Settings footer names the script version, so every version
// bump changes wide output in exactly one place. The golden was captured at
// 0.1.0 and is never regenerated; this literal follows @version, so a release
// commit (CLAUDE.md rule 8) needs no new entry here, while any other change to
// the footer still fails the exactly-once check in tests/wide-parity.test.js.

const { readSource } = require('./load-userscript');

const m = /^\/\/ @version\s+(\S+)/m.exec(readSource());
if (!m) throw new Error('@version not found in the userscript header');

const GOLDEN_VERSION = '0.1.0';

module.exports = {
  literals: [
    {
      item: 'release footer version', view: 'settings',
      from: 'Torn Forum Command Center ' + GOLDEN_VERSION + '. Reads only.',
      to: 'Torn Forum Command Center ' + m[1] + '. Reads only.',
    },
  ],
};
