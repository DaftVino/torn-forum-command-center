'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const {
  KNOWN_PLACEHOLDERS,
  loadSourceFacts,
  verifyForumPost,
} = require('../scripts/forum-post-data');

const root = path.join(__dirname, '..');
const postPath = path.join(root, 'docs', 'forum-post.md');

test('forum post passes all source-derived verification checks', () => {
  const facts = loadSourceFacts();
  const html = fs.readFileSync(postPath, 'utf8');
  assert.equal(verifyForumPost(html, facts), true);
});

test('forum post source facts are internally consistent', () => {
  const facts = loadSourceFacts();

  assert.equal(facts.accessLevel, 'Minimal Access');
  assert.equal(facts.dayMs, 24 * 60 * 60 * 1000);
  assert.equal(facts.requestBudget.rateWindowMs, 60 * 1000);
  assert.equal(
    facts.requestBudget.threadsDefault,
    3 + facts.requestBudget.defaultEnrichBudget,
  );
  assert.equal(
    facts.requestBudget.mineDefault,
    2
      + facts.requestBudget.defaultEnrichBudget
      + Math.min(
        facts.requestBudget.reactionLookups,
        facts.requestBudget.defaultEnrichBudget,
      ),
  );
});

test('forum post contains exactly the approved placeholders', () => {
  const html = fs.readFileSync(postPath, 'utf8');
  const found = Array.from(
    html.matchAll(/\{\{([A-Z0-9_]+)\}\}/g),
    (match) => match[1],
  ).sort();

  assert.deepEqual(found, [...KNOWN_PLACEHOLDERS].sort());
});
