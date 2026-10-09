#!/usr/bin/env node
'use strict';

const { verifyForumPostFiles } = require('./forum-post-data');

try {
  const facts = verifyForumPostFiles();
  console.log('forum post verification passed');
  console.log(`userscript version: ${facts.version}`);
  console.log(`views: ${facts.views.join(', ')}`);
  console.log(`badges: ${facts.badgeCount}`);
  console.log(
    `default request maxima: Threads ${facts.requestBudget.threadsDefault}, `
      + `My posts ${facts.requestBudget.mineDefault}`,
  );
  console.log(`rate limiter: ${facts.requestBudget.perMinute} requests per minute`);
  console.log(`key access level: ${facts.accessLevel}`);
} catch (error) {
  console.error(`forum post verification failed: ${error.message}`);
  process.exitCode = 1;
}
