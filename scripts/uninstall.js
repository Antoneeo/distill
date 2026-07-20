#!/usr/bin/env node
// `distill-uninstall-skill` -- the SUPPORTED way to remove installed skills.
//
// Why this exists as a bin rather than only an npm hook: npm has not run the
// `preuninstall` lifecycle script since v7, so `npm uninstall -g` removes the
// package and silently leaves every installed skill directory behind. Verified
// empirically on npm 11.9.0 against an isolated prefix: all four client
// directories, markers included, survived the uninstall untouched.
//
// The `preuninstall` hook is kept as best-effort for npm versions that do honour
// it; this command is the one the README tells users to run.

const { CLIENTS, removeSkill } = require('./lib');

console.log('\n--- distill Skill Removal ---');

const tally = { removed: 0, foreign: 0, absent: 0, error: 0 };
for (const client of CLIENTS) {
  tally[removeSkill(client)] += 1;
}

if (tally.removed === 0 && tally.foreign === 0) {
  console.log('ℹ️  Nothing to remove: no installed skill directory found.');
}
if (tally.foreign > 0) {
  console.log(`ℹ️  ${tally.foreign} directory(ies) left alone because this package did not install them.`);
  console.log('   Remove those by hand if you want them gone.');
}
if (tally.error > 0) {
  console.log(`⚠️  ${tally.error} directory(ies) could not be removed; see the messages above.`);
  process.exitCode = 1;
}

console.log('-----------------------------\n');
