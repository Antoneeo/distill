#!/usr/bin/env node
// UserPromptSubmit hook: re-asserts the distill discipline once per turn.
//
// Why a hook and not just the doctrine: a clause telling an agent not to drift
// cannot itself prevent drift -- the instruction is what fades. This re-injects
// it at every turn, which is the only mechanism that survives a long session.
//
// Two constraints this file obeys, both from the skill it serves:
//   - the payload is ONE line. A hook that re-states the doctrine every turn
//     would be the noise distill exists to remove, paid forever. (The update
//     notification below is the sole, bounded exception: one extra line, shown
//     once per new version, then silenced by the `notified` marker.)
//   - it fails open. Any internal error exits 0 with no output: this runs on
//     every prompt, so a crash here must never be able to block the session.

const fs = require('fs');
const os = require('os');
const path = require('path');

function claudeHome() {
  return process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
}

// Update lane (plugin channel only -- see hooks/update-check.js). This hook
// NEVER touches the network: it reads the cache file the detached worker
// writes, and spawns that worker when the cache is stale. In the npm channel
// the worker file is not copied next to this hook, so the existsSync guard
// keeps the whole lane off.
function updateNotification() {
  if (process.env.DISTILL_NO_UPDATE_CHECK === '1') return null;

  const workerPath = path.join(__dirname, 'update-check.js');
  if (!fs.existsSync(workerPath)) return null;

  const { cmpVersions, shouldCheck } = require('./update-check');

  const cacheDir = path.join(claudeHome(), 'distill');
  const cacheFile = path.join(cacheDir, 'update-check.json');
  let cache = null;
  try {
    const parsed = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) cache = parsed;
  } catch (e) { /* no cache yet */ }

  if (shouldCheck(cache, Date.now())) {
    try {
      const { spawn } = require('child_process');
      const child = spawn(process.execPath, [workerPath], { detached: true, stdio: 'ignore' });
      child.on('error', () => { /* silent: the check is a convenience */ });
      child.unref();
    } catch (e) { /* silent */ }
  }

  if (!cache || typeof cache.latest !== 'string') return null;

  let local = null;
  try {
    const manifest = JSON.parse(
      fs.readFileSync(path.join(__dirname, '..', '.claude-plugin', 'plugin.json'), 'utf8'));
    if (typeof manifest.version === 'string') local = manifest.version;
  } catch (e) { return null; }
  if (!local || cmpVersions(local, cache.latest) >= 0) return null;
  if (cache.notified === cache.latest) return null;

  // Once per version: persist the marker before announcing, so a write failure
  // means a repeat next turn (annoying) rather than a spam loop being possible.
  try {
    cache.notified = cache.latest;
    fs.mkdirSync(cacheDir, { recursive: true });
    fs.writeFileSync(cacheFile, `${JSON.stringify(cache, null, 2)}\n`, 'utf8');
  } catch (e) { /* still announce this once */ }

  if (cache.updatedTo === cache.latest) {
    return `distill ${cache.latest} was auto-installed (this session still runs ${local}) — restart the client to apply it.`;
  }
  return `distill ${cache.latest} is available (installed: ${local}) — update via /plugin, or: claude plugin update distill@distill`;
}

try {
  // Directive, self-contained, no undefined terms: an instruction to run a procedure the
  // agent has not read is not an instruction, so the payload never names skill-internal
  // machinery — it IS the discipline in miniature. The previous payload carried only the
  // form criterion (answer first, no preamble); 195 turns of phase-1 gate data showed
  // what that leaves uncovered: 56% of replies would have been flagged, arrow chains 92
  // times (the §6 mutilation the form criterion never mentions), and content noise —
  // process narration, unselected assertions — which no Stop-hook heuristic can see at
  // all. So the payload now also carries selection (who reads, what they do next, ≤5
  // assertions) and the two bans the data demanded. Same one-line, <260-char budget.
  const REMINDER =
    'distill — decide who reads and what they do next; write only what serves that '
    + '(≤5 assertions). Answer first, stop. Complete sentences — no arrow chains '
    + 'or fragments. No preamble, no process narration, no unasked alternatives. '
    + 'Irreversible risks come first.';

  let context = REMINDER;
  try {
    const note = updateNotification();
    if (note) context = `${REMINDER}\n${note}`;
  } catch (e) { /* the reminder always ships, with or without the lane */ }

  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'UserPromptSubmit',
      additionalContext: context,
    },
  }));
} catch (e) {
  // Deliberately silent: never block a prompt because a reminder failed.
}

process.exit(0);
