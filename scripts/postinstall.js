#!/usr/bin/env node

const fs = require('fs');
const {
  SKILL_SOURCE,
  CLIENTS,
  clientDetected,
  claudePluginPresent,
  skillTarget,
  isOwned,
  writeMarker,
  copyRecursive,
  removeSkill,
} = require('./lib');

const { version } = require('../package.json');
const FORCE = Boolean(process.env.DISTILL_FORCE_INSTALL);

function installSkill(client) {
  if (!fs.existsSync(SKILL_SOURCE)) {
    console.log(`⚠️  Skill source not found at ${SKILL_SOURCE}; skipping ${client.label} install.`);
    return false;
  }
  const target = skillTarget(client);

  // Never overwrite a skill dir this package did not create: it may be a hand
  // placed or hand edited copy, and a silent overwrite would destroy edits with
  // no signal. Refuse and tell the user how to proceed deliberately.
  if (fs.existsSync(target) && !isOwned(target)) {
    if (!FORCE) {
      console.log(`⏭️  Skipped ${client.label}: ${target} exists and was not installed by this package.`);
      console.log('   Remove it, or re-run with DISTILL_FORCE_INSTALL=1 to overwrite it.');
      return false;
    }
    console.log(`⚠️  Overwriting unowned ${target} (DISTILL_FORCE_INSTALL is set).`);
  }

  try {
    fs.mkdirSync(target, { recursive: true });
    // Claim ownership BEFORE mutating, then refresh after. If the copy dies
    // half-way (power loss, ENOSPC, kill), the directory is left "owned but
    // incomplete", which the next install heals silently. Marking only at the
    // end would leave it "unowned but full": the package would then refuse to
    // upgrade or remove its own debris, and would report it as someone else's.
    writeMarker(target, version);
    copyRecursive(SKILL_SOURCE, target);
    writeMarker(target, version);
    console.log(`📦 Installed ${client.label} skill at: ${target}`);
    console.log(`   ${client.reload}`);
    return true;
  } catch (err) {
    console.log(`⚠️  Failed to install ${client.label} skill: ${err.message}`);
    console.log(`   Manual install: copy "${SKILL_SOURCE}" to "${target}".`);
    return false;
  }
}

console.log('\n--- distill Skill Discovery ---');

let detected = false;
for (const client of CLIENTS) {
  if (clientDetected(client)) {
    console.log(`✅ Detected: ${client.label}`);
    detected = true;
    // On Claude Code the plugin channel owns the skill AND the per-turn hook.
    // Installing the npm copy next to it would put two versions of the same
    // doctrine under one name, drifting apart at the first single-channel
    // update. So: skip the install, and migrate away an owned copy a previous
    // npm install left behind. Hand-placed copies are never touched (removeSkill
    // refuses anything without our ownership marker).
    if (client.key === 'claude' && claudePluginPresent()) {
      console.log('⏭️  Claude Code is owned by the distill plugin (skill + per-turn hook); npm copy not installed.');
      const state = removeSkill(client, console.log);
      if (state === 'removed') {
        console.log('   Migrated: the redundant npm copy from a previous install was removed.');
      }
      continue;
    }
    installSkill(client);
  }
}

if (!detected) {
  console.log('ℹ️  No specific AI CLI detected globally, but you can still use the skill.');
  console.log(`   Copy "${SKILL_SOURCE}" into your client's skills directory.`);
}

console.log('------------------------------\n');
