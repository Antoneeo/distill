// Shared removal path for the persistence hook: used by both
// `distill-disable-persistence` and `distill-uninstall-skill`, so the two can
// never disagree about what gets cleaned up.

const fs = require('fs');
const { installedHookPath, settingsPath } = require('./lib');
const { readSettings, writeSettings, unwire } = require('./settings');

/**
 * Unwire the hook from settings.json and delete the copied hook script.
 * Returns { unwired, fileRemoved, error }. Never throws: this runs inside
 * uninstall, where a failure must degrade to a message rather than abort.
 */
function removePersistence(log = console.log) {
  const sPath = settingsPath();
  const hookPath = installedHookPath();
  const result = { unwired: false, fileRemoved: false, error: null };

  try {
    const { settings, existed, stamp } = readSettings(sPath);
    if (existed && unwire(settings)) {
      writeSettings(sPath, settings, { expectStamp: stamp });
      result.unwired = true;
      log(`🔗 Unwired the persistence hook from ${sPath}`);
    }
  } catch (err) {
    // A settings file we cannot parse is one we must not rewrite. Say so and
    // continue: the hook script can still be removed.
    result.error = err.message;
  }

  try {
    if (fs.existsSync(hookPath)) {
      fs.rmSync(hookPath, { force: true });
      result.fileRemoved = true;
      log(`🧹 Removed the hook script at ${hookPath}`);
    }
  } catch (err) {
    result.error = result.error || `Could not remove ${hookPath}: ${err.message}`;
  }

  return result;
}

module.exports = { removePersistence };
