#!/usr/bin/env node
// `distill-enable-persistence` -- opt-in, Claude Code only.
//
// Deliberately NOT run by npm postinstall. ~/.claude/settings.json is authored
// and owned by the user and shared with every other tool that registers hooks;
// mutating it is a bigger act than dropping a skill file, so it takes a separate
// deliberate command. Same reasoning as the ownership marker, and the same shape
// caveman uses (its plugin install does not wire hooks either).

const fs = require('fs');
const os = require('os');
const { HOOK_SOURCE, hooksDir, installedHookPath, settingsPath } = require('./lib');
const { readSettings, writeSettings, isWired, wire } = require('./settings');

const sPath = settingsPath();
const hookPath = installedHookPath();

console.log('\n--- distill persistence hook ---');

let settings;
let stamp;
try {
  ({ settings, stamp } = readSettings(sPath));
} catch (err) {
  console.log(`⚠️  ${err.message}`);
  process.exitCode = 1;
  console.log('--------------------------------\n');
  return;
}

// Wired AND the script present. If the script was deleted by hand, a "wired"
// short-circuit would leave a hook command failing on every prompt while the one
// obvious repair command declined to act.
if (isWired(settings) && fs.existsSync(hookPath)) {
  console.log(`✅ Already enabled in ${sPath} — nothing to do.`);
  console.log('--------------------------------\n');
  return;
}

try {
  fs.mkdirSync(hooksDir(), { recursive: true });
  fs.copyFileSync(HOOK_SOURCE, hookPath);
} catch (err) {
  console.log(`⚠️  Could not install the hook script at ${hookPath}: ${err.message}`);
  process.exitCode = 1;
  console.log('--------------------------------\n');
  return;
}

if (isWired(settings)) {
  // Script was missing but the entry was intact: we just repaired it.
  console.log(`🔧 Restored the missing hook script at ${hookPath}`);
  console.log('   Restart Claude Code to activate.');
  console.log('--------------------------------\n');
  return;
}

// Only normalize separators on Windows: a legal POSIX path may contain a
// backslash, and rewriting it would corrupt the command.
const commandPath = os.platform() === 'win32' ? hookPath.split('\\').join('/') : hookPath;
if (/["`$\\]/.test(commandPath)) {
  console.log(`⚠️  Refusing to wire a hook path containing quote, backtick, $ or backslash: ${commandPath}`);
  console.log('   Move your Claude config to a path without shell metacharacters, or wire the hook by hand.');
  process.exitCode = 1;
  console.log('--------------------------------\n');
  return;
}
wire(settings, `node "${commandPath}"`);

let madeBackup = false;
try {
  ({ madeBackup } = writeSettings(sPath, settings, { expectStamp: stamp }));
} catch (err) {
  console.log(`⚠️  Could not write ${sPath}: ${err.message}`);
  console.log('   Your settings file was not modified.');
  process.exitCode = 1;
  console.log('--------------------------------\n');
  return;
}

console.log(`📎 Hook script:  ${hookPath}`);
console.log(`🔗 Wired into:   ${sPath} (UserPromptSubmit)`);
if (madeBackup) console.log('   A backup of the previous settings was written alongside it.');
console.log('   Restart Claude Code to activate.');
console.log('   Undo with: distill-disable-persistence (keeps the skill installed)');
console.log('--------------------------------\n');
