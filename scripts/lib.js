// Shared helpers for the distill npm scripts (postinstall / preuninstall).
// Single source for client detection, skill-target paths and install ownership:
// postinstall and preuninstall must never disagree on what "Claude Code is
// installed" means, nor on which directories this package is allowed to touch.

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const PACKAGE_ROOT = path.resolve(__dirname, '..');

// One name, used for both the source directory and every install target, so the
// two can never drift apart (prior art hardcoded the literal in two places).
const SKILL_NAME = 'distill';
const SKILL_SOURCE = path.join(PACKAGE_ROOT, 'skills', SKILL_NAME);

const PACKAGE_NAME = '@antoneeo/distill-skill';

// Ownership marker. Written inside the installed skill dir at install time and
// read before any overwrite or removal: this package only ever destroys what it
// created. A hand-placed or hand-edited skill dir carries no marker and is left
// untouched. Leading dot so skill loaders ignore it alongside SKILL.md.
const MARKER_NAME = '.installed-by.json';

// One entry per supported AI client. `home` may be overridden by an env var
// (Claude Desktop / portable installs); presence of the home dir counts as
// detection even when the CLI is not on PATH.
const CLIENTS = [
  {
    key: 'claude',
    label: 'Claude Code',
    cmd: 'claude',
    home: process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'),
    envVar: 'CLAUDE_CONFIG_DIR',
    reload: 'Restart Claude Code to load it. Invoke via Skill tool as "distill".',
  },
  {
    key: 'gemini',
    label: 'Gemini CLI',
    cmd: 'gemini',
    home: process.env.GEMINI_HOME || path.join(os.homedir(), '.gemini'),
    envVar: 'GEMINI_HOME',
    reload: 'Run "gemini skills reload" or restart Gemini CLI to load it.',
  },
  {
    key: 'codex',
    label: 'Codex AI',
    cmd: 'codex',
    home: process.env.CODEX_HOME || path.join(os.homedir(), '.codex'),
    envVar: 'CODEX_HOME',
    reload: 'Restart Codex to load it. Invoke it as "$distill" or by asking to distill a text.',
  },
  {
    // Google Antigravity 2.0 discovers global agent skills under
    // ~/.gemini/config/skills/ -- the SAME home the legacy Gemini CLI claims.
    // To avoid a shared-home double-install (T1), this entry sets:
    //  - skillsSubdir 'config/skills': distinct target from gemini's ~/.gemini/skills
    //  - homeMarker on ~/.gemini/config/skills: detection never fires on bare
    //    ~/.gemini (which every Antigravity user has); only the Antigravity skills
    //    dir, the `agy` CLI, or ANTIGRAVITY_HOME count as "Antigravity installed".
    key: 'antigravity',
    label: 'Google Antigravity',
    cmd: 'agy',
    home: process.env.ANTIGRAVITY_HOME || path.join(os.homedir(), '.gemini'),
    envVar: 'ANTIGRAVITY_HOME',
    skillsSubdir: 'config/skills',
    homeMarker: path.join(
      process.env.ANTIGRAVITY_HOME || path.join(os.homedir(), '.gemini'),
      'config',
      'skills',
    ),
    reload: 'Restart Antigravity, or run "agy skills reload", to load it. Invoke by asking to distill a text.',
  },
];

function commandExists(cmd) {
  try {
    // execFileSync + shell:false, NOT execSync: a shell string on Windows routes
    // through cmd.exe, which resolves the current directory before PATH -- so a
    // stray `claude.bat` in the cwd would execute when the bin script is run from
    // an untrusted checkout. The timeout bounds a CLI that blocks on --version
    // (update check, network call): this runs inside the npm install critical
    // path with stdio ignored, so a hang would freeze `npm i -g` with no output.
    execFileSync(cmd, ['--version'], { stdio: 'ignore', timeout: 3000, shell: false });
    return true;
  } catch (e) {
    return false;
  }
}

function clientDetected(client) {
  // An entry may override the fs-existence probe with a `homeMarker` (a more
  // specific path than the bare home) so two clients sharing a home dir do not
  // both fire on its mere existence.
  const homePathToCheck = client.homeMarker || client.home;
  return commandExists(client.cmd)
    || Boolean(process.env[client.envVar])
    || fs.existsSync(homePathToCheck);
}

function skillTarget(client) {
  // An entry may override the default `skills` sub-path with `skillsSubdir`
  // (split on '/' to keep cross-platform path.join correctness).
  const subdir = client.skillsSubdir ? client.skillsSubdir.split('/') : ['skills'];
  return path.join(client.home, ...subdir, SKILL_NAME);
}

function markerPath(target) {
  return path.join(target, MARKER_NAME);
}

/**
 * Read the ownership marker of an installed skill dir.
 * Returns null when absent OR malformed: an unreadable marker must fail toward
 * "not ours", never toward "safe to delete".
 */
function readMarker(target) {
  try {
    const raw = fs.readFileSync(markerPath(target), 'utf8');
    const parsed = JSON.parse(raw);
    // Arrays are typeof 'object' too; excluding them keeps the contract this
    // docblock states literally true for every malformed shape.
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch (e) {
    return null;
  }
}

/**
 * True only when `target` was created by THIS package. Governs every overwrite
 * and every removal: a directory we did not create is never destroyed.
 */
function isOwned(target) {
  const marker = readMarker(target);
  return Boolean(marker) && marker.package === PACKAGE_NAME;
}

function writeMarker(target, version) {
  const payload = {
    package: PACKAGE_NAME,
    version,
    installedAt: new Date().toISOString(),
  };
  fs.writeFileSync(markerPath(target), `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

/**
 * Remove one client's installed skill, but ONLY if this package installed it.
 * Shared by the `distill-uninstall-skill` bin and the npm `preuninstall` hook,
 * so the two can never disagree about what is safe to delete.
 * Returns 'absent' | 'foreign' | 'removed' | 'error'.
 */
function removeSkill(client, log = console.log) {
  const target = skillTarget(client);
  if (!fs.existsSync(target)) return 'absent';

  if (!isOwned(target)) {
    log(`⏭️  Left ${target} in place: not installed by this package.`);
    return 'foreign';
  }

  try {
    fs.rmSync(target, { recursive: true, force: true });
    log(`🧹 Removed ${client.label} skill at: ${target}`);
    return 'removed';
  } catch (err) {
    log(`⚠️  Could not remove ${target}: ${err.message}`);
    return 'error';
  }
}

function copyRecursive(src, dest) {
  if (typeof fs.cpSync === 'function') {
    fs.cpSync(src, dest, { recursive: true, force: true });
    return;
  }
  // Fallback for Node < 16.7
  if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) copyRecursive(s, d);
    else fs.copyFileSync(s, d);
  }
}

module.exports = {
  PACKAGE_ROOT,
  PACKAGE_NAME,
  SKILL_NAME,
  SKILL_SOURCE,
  MARKER_NAME,
  CLIENTS,
  commandExists,
  clientDetected,
  skillTarget,
  markerPath,
  readMarker,
  isOwned,
  writeMarker,
  removeSkill,
  copyRecursive,
};
