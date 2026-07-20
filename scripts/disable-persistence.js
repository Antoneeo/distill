#!/usr/bin/env node
// `distill-disable-persistence` -- removes the hook, keeps the skill installed.
// Shares its implementation with the uninstaller so the two cannot diverge.

const { removePersistence } = require('./persistence');

console.log('\n--- distill persistence hook ---');
const result = removePersistence();

if (result.error) {
  console.log(`⚠️  ${result.error}`);
  process.exitCode = 1;
} else if (!result.unwired && !result.fileRemoved) {
  console.log('ℹ️  Not enabled — nothing to remove.');
}

console.log('--------------------------------\n');
