'use strict';

const fs = require('node:fs');
const path = require('node:path');

const KNOWN_PLACEHOLDERS = Object.freeze([
  'BANNER_URL',
  'SHOT_THREADS_URL',
  'SHOT_MOBILE_URL',
  'SHOT_CATCHUP_URL',
  'SHOT_SETTINGS_URL',
]);

// The published Greasy Fork listing (owner, 2026-10-09): the only link the post may carry.
const INSTALL_URL = 'https://greasyfork.org/en/scripts/599453-torn-forum-command-center';

const VIEW_LABELS = Object.freeze({
  threads: 'Threads',
  catchup: 'Catch up',
  search: 'Search',
  drafts: 'Drafts',
  settings: 'Settings',
  mine: 'My posts',
});

const ALLOWED_TAGS = new Set([
  'p',
  'strong',
  'em',
  'span',
  'ul',
  'ol',
  'li',
  'table',
  'tr',
  'th',
  'td',
  'a',
  'img',
]);

const BALANCED_TAGS = [
  'p',
  'strong',
  'em',
  'span',
  'ul',
  'ol',
  'li',
  'table',
  'tr',
  'th',
  'td',
  'a',
];

function rootPath() {
  return path.join(__dirname, '..');
}

function userscriptPath() {
  return path.join(rootPath(), 'torn-forum-command-center.user.js');
}

function forumPostPath() {
  return path.join(rootPath(), 'docs', 'forum-post.md');
}

function requiredMatch(text, pattern, label) {
  const match = text.match(pattern);
  if (!match) throw new Error(`could not extract ${label} from the userscript`);
  return match;
}

function numericConstant(source, name) {
  const pattern = new RegExp(`\\bvar\\s+${name}\\s*=\\s*([^;]+);`);
  const expression = requiredMatch(source, pattern, name)[1].trim();
  if (!/^[0-9+\-*/().\s]+$/.test(expression)) {
    throw new Error(`${name} is not a simple numeric expression`);
  }
  const value = Function(`"use strict"; return (${expression});`)();
  if (!Number.isFinite(value)) throw new Error(`${name} is not finite`);
  return value;
}

function quotedValues(text) {
  const values = [];
  const pattern = /'([^'\\]*(?:\\.[^'\\]*)*)'/g;
  let match;
  while ((match = pattern.exec(text)) !== null) {
    values.push(match[1].replace(/\\'/g, "'").replace(/\\\\/g, '\\'));
  }
  return values;
}

function extractViews(source) {
  const body = requiredMatch(
    source,
    /\bvar\s+VIEWS\s*=\s*Object\.freeze\(\s*\[([\s\S]*?)\]\s*\);/,
    'VIEWS',
  )[1];
  const views = quotedValues(body);
  if (!views.length) throw new Error('VIEWS is empty');
  return views;
}

function extractCustomKeySelections(source) {
  const start = source.indexOf('var CUSTOM_KEY_SELECTIONS');
  const end = source.indexOf('var DAY_MS', start);
  if (start < 0 || end < 0) {
    throw new Error('could not isolate CUSTOM_KEY_SELECTIONS');
  }

  const block = source.slice(start, end);
  const selections = {};
  const propertyPattern = /(\w+)\s*:\s*Object\.freeze\(\s*\[([\s\S]*?)\]\s*\)/g;
  let match;
  while ((match = propertyPattern.exec(block)) !== null) {
    selections[match[1]] = quotedValues(match[2]);
  }

  if (!selections.user || !selections.forum) {
    throw new Error('CUSTOM_KEY_SELECTIONS must contain user and forum arrays');
  }
  return selections;
}

function extractBadgeCount(source) {
  const body = requiredMatch(
    source,
    /\bvar\s+BADGES\s*=\s*Object\.freeze\(\s*\[([\s\S]*?)\]\s*\);\s*\n\s*function\s+badgeById/,
    'BADGES',
  )[1];
  return (body.match(/\bbadgeDef\s*\(/g) || []).length;
}

function extractAccessLevel(source) {
  const marker = source.indexOf('Access level required');
  if (marker < 0) throw new Error('Settings access-level row is missing');
  const disclosure = source.slice(marker, marker + 700);
  const match = disclosure.match(/Minimal Access|Limited Access|Public Only/);
  if (!match || match[0] !== 'Minimal Access') {
    throw new Error('Settings does not name Minimal Access as the required level');
  }
  return match[0];
}

function extractVersion(source) {
  return requiredMatch(
    source,
    /^\s*\/\/\s*@version\s+(\d+\.\d+\.\d+)\s*$/m,
    '@version',
  )[1];
}

function buildSourceFacts(source) {
  const defaultEnrichBudget = numericConstant(source, 'DEFAULT_ENRICH_BUDGET');
  const maxEnrichBudget = numericConstant(source, 'MAX_ENRICH_BUDGET');
  const reactionLookups = numericConstant(source, 'REACTION_LOOKUPS_PER_RUN');
  const requestsPerWindow = numericConstant(source, 'REQUESTS_PER_WINDOW');
  const rateWindowMs = numericConstant(source, 'RATE_WINDOW_MS');
  const dayMs = numericConstant(source, 'DAY_MS');

  const tctBody = requiredMatch(
    source,
    /function\s+tctDay\s*\(\s*now\s*\)\s*\{([\s\S]*?)\}/,
    'tctDay',
  )[1];
  if (!/Math\.floor\s*\(\s*toInt\s*\(\s*now\s*,\s*0\s*\)\s*\/\s*DAY_MS\s*\)/.test(tctBody)) {
    throw new Error('tctDay no longer divides the epoch by DAY_MS');
  }
  if (dayMs !== 24 * 60 * 60 * 1000) {
    throw new Error(`DAY_MS is ${dayMs}, not one UTC day`);
  }
  if (rateWindowMs !== 60 * 1000) {
    throw new Error(`RATE_WINDOW_MS is ${rateWindowMs}, not one minute`);
  }

  const thumbsAt = (budget) => Math.min(reactionLookups, budget);

  return {
    version: extractVersion(source),
    views: extractViews(source),
    customKeySelections: extractCustomKeySelections(source),
    badgeCount: extractBadgeCount(source),
    accessLevel: extractAccessLevel(source),
    dayMs,
    requestBudget: {
      defaultEnrichBudget,
      maxEnrichBudget,
      reactionLookups,
      threadsDefault: 3 + defaultEnrichBudget,
      mineDefault: 2 + defaultEnrichBudget + thumbsAt(defaultEnrichBudget),
      threadsMaximum: 3 + maxEnrichBudget,
      mineMaximum: 2 + maxEnrichBudget + thumbsAt(maxEnrichBudget),
      perMinute: requestsPerWindow,
      rateWindowMs,
    },
  };
}

function loadSourceFacts() {
  return buildSourceFacts(fs.readFileSync(userscriptPath(), 'utf8'));
}

function decodeEntities(text) {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&mdash;/g, '-')
    .replace(/&ndash;/g, '-')
    .replace(/&nbsp;/g, ' ');
}

function plainText(html) {
  // Inline tags vanish without a gap, so "<strong>Minimal Access</strong>."
  // reads "Minimal Access."; block tags still separate words.
  return decodeEntities(html
    .replace(/<\/?(?:strong|em|span|a|b|i)\b[^>]*>/gi, '')
    .replace(/<[^>]*>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

function verifyAllowedTags(html) {
  const pattern = /<\/?([a-z][a-z0-9]*)\b[^>]*>/gi;
  let match;
  while ((match = pattern.exec(html)) !== null) {
    const tag = match[1].toLowerCase();
    if (!ALLOWED_TAGS.has(tag)) {
      throw new Error(`forum post uses unsupported <${tag}> tag`);
    }
  }

  for (const tag of BALANCED_TAGS) {
    const openings = (html.match(new RegExp(`<${tag}(?:\\s[^>]*)?>`, 'gi')) || []).length;
    const closings = (html.match(new RegExp(`</${tag}>`, 'gi')) || []).length;
    if (openings !== closings) {
      throw new Error(`forum post has unbalanced <${tag}> tags: ${openings} open / ${closings} close`);
    }
  }
}

function verifyPlaceholders(html) {
  const found = [];
  const pattern = /\{\{([A-Z0-9_]+)\}\}/g;
  let match;
  while ((match = pattern.exec(html)) !== null) found.push(match[1]);

  const unknown = found.filter((name) => !KNOWN_PLACEHOLDERS.includes(name));
  if (unknown.length) {
    throw new Error(`forum post contains unknown placeholder: ${unknown.join(', ')}`);
  }

  for (const name of KNOWN_PLACEHOLDERS) {
    const count = found.filter((foundName) => foundName === name).length;
    if (count !== 1) {
      throw new Error(`forum post must contain ${name} exactly once, found ${count}`);
    }
  }

  if (html.includes('{{') && found.length !== KNOWN_PLACEHOLDERS.length) {
    throw new Error('forum post contains a malformed placeholder');
  }
}

function verifyLinks(html) {
  const pattern = /<a\b[^>]*\bhref="([^"]+)"[^>]*>/gi;
  let match;
  let installLinks = 0;
  while ((match = pattern.exec(html)) !== null) {
    const href = match[1];
    if (/torn\.com\/forums/i.test(href)) {
      throw new Error(`forum post links to another Torn forum article: ${href}`);
    }
    if (href !== INSTALL_URL) {
      throw new Error(`forum post contains an unapproved link: ${href}`);
    }
    installLinks += 1;
  }
  if (installLinks === 0) {
    throw new Error(`forum post has no install link to ${INSTALL_URL}`);
  }
}

function verifyViews(html, facts) {
  const startMarker = '<span style="color: var(--te-text-color-gray2)"><strong>Views</strong></span>';
  const endMarker = '<span style="color: var(--te-text-color-gray2)"><strong>Folders and personal organization</strong></span>';
  const start = html.indexOf(startMarker);
  const end = html.indexOf(endMarker, start + startMarker.length);
  if (start < 0 || end < 0) throw new Error('could not isolate the Views feature block');

  const block = html.slice(start, end);
  const listed = [];
  const pattern = /<li><strong>([^<]+)<\/strong>/g;
  let match;
  while ((match = pattern.exec(block)) !== null) listed.push(decodeEntities(match[1]));

  const expected = facts.views.map((view) => {
    const label = VIEW_LABELS[view];
    if (!label) throw new Error(`VIEWS contains an undocumented view key: ${view}`);
    return label;
  });

  const actualSorted = [...new Set(listed)].sort();
  const expectedSorted = [...new Set(expected)].sort();
  if (JSON.stringify(actualSorted) !== JSON.stringify(expectedSorted)) {
    throw new Error(
      `forum post views differ from VIEWS: expected ${expectedSorted.join(', ')}, found ${actualSorted.join(', ')}`,
    );
  }
}

function verifyCustomKeySelections(html, facts) {
  const expected = `The pre-filled selections are user: ${facts.customKeySelections.user.join(', ')}; `
    + `forum: ${facts.customKeySelections.forum.join(', ')}.`;
  if (!plainText(html).includes(expected)) {
    throw new Error(`forum post custom-key selections differ from source: ${expected}`);
  }
}

function verifyRequestBudget(html, facts) {
  const text = plainText(html);
  const match = text.match(
    /A Threads refresh is at most (\d+) requests and My posts at most (\d+) at the default lookup setting; the limiter never allows more than (\d+) requests in a minute\./,
  );
  if (!match) throw new Error('forum post is missing the canonical request-budget sentence');

  const actual = match.slice(1).map(Number);
  const expected = [
    facts.requestBudget.threadsDefault,
    facts.requestBudget.mineDefault,
    facts.requestBudget.perMinute,
  ];
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`forum post request budget is ${actual.join('/')}, expected ${expected.join('/')}`);
  }
}

function verifyBadgesAndDay(html, facts) {
  const badgeMatch = html.match(/There are <strong>(\d+) badges<\/strong>/);
  if (!badgeMatch) throw new Error('forum post is missing the badge-count claim');
  if (Number(badgeMatch[1]) !== facts.badgeCount) {
    throw new Error(`forum post says ${badgeMatch[1]} badges, source has ${facts.badgeCount}`);
  }

  if (!plainText(html).includes('Streaks advance by TCT (UTC) day.')) {
    throw new Error('forum post must identify badge streaks as TCT (UTC) days');
  }
  if (facts.dayMs !== 86400000) {
    throw new Error('source TCT day is not one UTC day');
  }
}

function verifyAccessLevel(html, facts) {
  if (facts.accessLevel !== 'Minimal Access') {
    throw new Error(`unexpected source access level: ${facts.accessLevel}`);
  }

  const required = [
    'FCC reads Torn\'s official API with a Minimal Access key.',
    'Create a Minimal Access key',
    'FCC asks for Minimal Access.',
  ];
  const text = plainText(html);
  for (const claim of required) {
    if (!text.includes(claim)) {
      throw new Error(`forum post is missing access-level text: ${claim}`);
    }
  }
}

function verifyNumericClaims(html, facts) {
  const text = plainText(html);
  const values = (text.match(/\b\d+\b/g) || []).map(Number);
  const expectedValues = [
    facts.badgeCount,
    facts.requestBudget.threadsDefault,
    facts.requestBudget.mineDefault,
    facts.requestBudget.perMinute,
  ];

  for (const value of values) {
    if (!expectedValues.includes(value)) {
      throw new Error(`forum post contains an unverified numeric claim: ${value}`);
    }
  }

  for (const value of expectedValues) {
    if (!values.includes(value)) {
      throw new Error(`forum post is missing source-derived numeric value: ${value}`);
    }
  }
}

function verifyVersions(html, facts) {
  const versions = plainText(html).match(/\bv?(\d+\.\d+\.\d+)\b/g) || [];
  for (const value of versions) {
    const version = value.replace(/^v/, '');
    if (version !== facts.version) {
      throw new Error(`forum post mentions version ${version}, userscript is ${facts.version}`);
    }
  }
}

function verifyForbiddenFormats(html) {
  const forbidden = [
    [/^#{1,6}\s/m, 'Markdown heading'],
    [/^\|.*\|\s*$/m, 'Markdown table row'],
    [/\[[^\]\n]+\]\([^)]+\)/, 'Markdown link'],
    [/\[(?:\/?(?:b|i|size|url|list|table|tr|th|td)|\*)[^\]]*\]/i, 'BBCode tag'],
    [/<script\b/i, 'script tag'],
    [/<style\b/i, 'style tag'],
  ];
  for (const [pattern, label] of forbidden) {
    if (pattern.test(html)) throw new Error(`forum post contains a forbidden ${label}`);
  }
}

function verifyForumPost(html, facts) {
  if (typeof html !== 'string' || !html.trim()) throw new Error('forum post is empty');

  verifyAllowedTags(html);
  verifyForbiddenFormats(html);
  verifyPlaceholders(html);
  verifyLinks(html);
  verifyViews(html, facts);
  verifyCustomKeySelections(html, facts);
  verifyRequestBudget(html, facts);
  verifyBadgesAndDay(html, facts);
  verifyAccessLevel(html, facts);
  verifyNumericClaims(html, facts);
  verifyVersions(html, facts);

  return true;
}

function verifyForumPostFiles() {
  const facts = loadSourceFacts();
  const html = fs.readFileSync(forumPostPath(), 'utf8');
  verifyForumPost(html, facts);
  return facts;
}

module.exports = {
  KNOWN_PLACEHOLDERS,
  VIEW_LABELS,
  buildSourceFacts,
  loadSourceFacts,
  plainText,
  verifyForumPost,
  verifyForumPostFiles,
};
