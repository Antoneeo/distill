// The ONLY module that writes to a file this package does not own.
//
// `~/.claude/settings.json` is authored by the user and shared with every other
// tool that registers hooks. A bad write here does not degrade distill -- it
// makes Claude Code unconfigurable, or silently deletes another tool's config.
// Every function below is written to fail toward "change nothing":
//
//   - refuse if the existing file, or the `hooks` subtree, is not the shape we expect
//   - back up before any modification
//   - append to the hook array, never assign (other tools live there too)
//   - remove at HOOK granularity, not entry granularity: Claude Code groups several
//     commands under one entry, so dropping a whole entry can delete a stranger's hook
//   - write atomically (temp + rename) so an interrupted write cannot truncate
//   - detect a concurrent modification between read and write, and abort rather than
//     clobber it (Claude Code writes this file itself)

const fs = require('fs');
const path = require('path');

const HOOK_EVENT = 'UserPromptSubmit';
const HOOK_FILE = 'distill-persist.js';

// Anchored to a path separator + the exact filename. A bare substring match would
// claim `/opt/distill-persistence-analyzer/run.js` as ours -- and then delete it.
const HOOK_PATTERN = /[\\/]distill-persist\.js(?:["'\s]|$)/;

function shapeError(message) {
  const e = new Error(message);
  e.code = 'ESETTINGSSHAPE';
  return e;
}

function readSettings(settingsPath) {
  if (!fs.existsSync(settingsPath)) return { settings: {}, existed: false, stamp: null };
  const raw = fs.readFileSync(settingsPath, 'utf8');
  const stat = fs.statSync(settingsPath);
  const stamp = `${stat.mtimeMs}:${stat.size}`;

  if (raw.trim() === '') return { settings: {}, existed: true, stamp };

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    // Do NOT repair, do NOT overwrite. A settings file we cannot parse is one we
    // cannot safely edit; the user's config is worth more than this feature.
    const e = new Error(
      `${settingsPath} is not valid JSON (${err.message}). Refusing to modify it. ` +
      'Fix the file by hand, then re-run.',
    );
    e.code = 'ESETTINGSPARSE';
    throw e;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw shapeError(`${settingsPath} does not contain a JSON object. Refusing to modify it.`);
  }

  // Validate the subtree we touch. Overwriting an unexpected shape would destroy
  // another tool's configuration silently.
  if ('hooks' in parsed && parsed.hooks !== undefined && parsed.hooks !== null) {
    if (typeof parsed.hooks !== 'object' || Array.isArray(parsed.hooks)) {
      throw shapeError(
        `${settingsPath} has a "hooks" key that is not an object. Refusing to modify it.`,
      );
    }
    const evt = parsed.hooks[HOOK_EVENT];
    if (evt !== undefined && evt !== null && !Array.isArray(evt)) {
      throw shapeError(
        `${settingsPath} has "hooks.${HOOK_EVENT}" that is not an array. Refusing to modify it.`,
      );
    }
  }
  return { settings: parsed, existed: true, stamp };
}

function backupPath(settingsPath, stamp) {
  return `${settingsPath}.distill-backup-${stamp.replace(/[:.]/g, '-')}`;
}

/**
 * Atomic, backed-up write. `expectStamp` is the stamp returned by readSettings:
 * if the file changed in the meantime, abort rather than silently drop the other
 * writer's keys.
 */
function writeSettings(settingsPath, settings, { backup = true, expectStamp } = {}) {
  const exists = fs.existsSync(settingsPath);

  if (exists && expectStamp !== undefined && expectStamp !== null) {
    const stat = fs.statSync(settingsPath);
    if (`${stat.mtimeMs}:${stat.size}` !== expectStamp) {
      const e = new Error(
        `${settingsPath} changed on disk since it was read. Refusing to overwrite ` +
        'another writer\'s changes. Re-run the command.',
      );
      e.code = 'ESETTINGSRACE';
      throw e;
    }
  }

  let madeBackup = false;
  if (backup && exists) {
    fs.copyFileSync(settingsPath, backupPath(settingsPath, new Date().toISOString()));
    madeBackup = true;
  }

  // Resolve symlinks: renaming onto the link path would replace a dotfile-managed
  // symlink with a regular file and silently detach the user's real config.
  const target = exists ? fs.realpathSync(settingsPath) : settingsPath;
  const tmp = `${target}.distill-tmp`;
  fs.mkdirSync(path.dirname(target), { recursive: true });
  try {
    fs.writeFileSync(tmp, `${JSON.stringify(settings, null, 2)}\n`, 'utf8');
    fs.renameSync(tmp, target);
  } catch (err) {
    try { fs.rmSync(tmp, { force: true }); } catch (e) { /* best effort */ }
    throw err;
  }
  return { madeBackup };
}

function hookEntries(settings) {
  const hooks = settings.hooks;
  if (!hooks || typeof hooks !== 'object' || Array.isArray(hooks)) return [];
  const arr = hooks[HOOK_EVENT];
  return Array.isArray(arr) ? arr : [];
}

function isOurCommand(h) {
  return Boolean(h) && typeof h.command === 'string' && HOOK_PATTERN.test(h.command);
}

function entryHasOurs(entry) {
  return Boolean(entry) && Array.isArray(entry.hooks) && entry.hooks.some(isOurCommand);
}

function isWired(settings) {
  return hookEntries(settings).some(entryHasOurs);
}

/**
 * Append our hook entry. Returns false when already wired (idempotent), true
 * when the settings object was modified. Other tools' entries are never read,
 * reordered or rewritten -- only appended after.
 */
function wire(settings, command) {
  if (isWired(settings)) return false;
  if (!settings.hooks) settings.hooks = {};
  if (!Array.isArray(settings.hooks[HOOK_EVENT])) settings.hooks[HOOK_EVENT] = [];
  settings.hooks[HOOK_EVENT].push({
    hooks: [{ type: 'command', command }],
  });
  return true;
}

/**
 * Remove ONLY our hook commands, at hook granularity.
 *
 * Claude Code allows several commands to share one entry. Dropping the whole
 * entry because it contains one of ours would delete a co-located third-party
 * hook -- silent data loss in a file we do not own. So: filter commands; drop the
 * entry only once WE emptied it; prune the event array and the `hooks` key only
 * if we emptied those too.
 *
 * Returns false when nothing of ours was present.
 */
function unwire(settings) {
  const entries = hookEntries(settings);
  if (!entries.some(entryHasOurs)) return false;

  const kept = [];
  for (const entry of entries) {
    if (!entryHasOurs(entry)) {
      kept.push(entry);
      continue;
    }
    const remaining = entry.hooks.filter((h) => !isOurCommand(h));
    if (remaining.length > 0) {
      kept.push({ ...entry, hooks: remaining });
    }
    // else: the entry held only our command(s) -- drop it entirely.
  }

  if (kept.length > 0) {
    settings.hooks[HOOK_EVENT] = kept;
  } else {
    delete settings.hooks[HOOK_EVENT];
    if (Object.keys(settings.hooks).length === 0) delete settings.hooks;
  }
  return true;
}

module.exports = {
  HOOK_EVENT,
  HOOK_FILE,
  HOOK_PATTERN,
  readSettings,
  writeSettings,
  backupPath,
  isWired,
  isOurCommand,
  wire,
  unwire,
};
