#!/usr/bin/env node
// `distill-disable-persistence` -- DEPRECATED cleanup path.
//
// 0.2.0 wired the persistence hook by editing ~/.claude/settings.json, via a
// `distill-enable-persistence` command that no longer exists: from 0.3.0 the hook
// is declared in .claude-plugin/plugin.json and Claude Code loads it natively, so
// nothing needs to touch the user's settings file.
//
// This command remains for one version so anyone who ran the 0.2.0 enable command
// has a supported way to undo it. Removing it in the same release that stopped
// creating the entry would strand those users with a wired hook and no way back.
// Scheduled for deletion in 0.4.0, together with scripts/settings.js.

const { removePersistence } = require('./persistence');

console.log('\n--- distill persistence hook (deprecated cleanup) ---');
const result = removePersistence();

if (result.error) {
  console.log(`⚠️  ${result.error}`);
  process.exitCode = 1;
} else if (!result.unwired && !result.fileRemoved) {
  console.log('ℹ️  Nothing to clean up: no settings.json entry from a 0.2.0 install.');
  console.log('   From 0.3.0 the hook ships with the Claude Code plugin instead.');
} else {
  console.log('   The 0.2.0 hook wiring has been removed.');
  console.log('   Install the plugin to get persistence back: /plugin marketplace add Antoneeo/distill');
}

console.log('-----------------------------------------------------\n');
