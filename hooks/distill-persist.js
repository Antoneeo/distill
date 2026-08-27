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
  // machinery — it IS the discipline in miniature. Two halves, one north star (§2):
  // the READING half (restate before answering, kill alternatives only by a named fact,
  // recompress the question when options tie) governs the thinking that precedes the
  // reply — for an autoregressive model a method is real only if it changes generation
  // ORDER, so it is phrased as a sequence constraint, not an exhortation. The WRITING
  // half (selection, answer-first, the §6 bans) is the 0.5.0 payload, justified then by
  // 195 turns of phase-1 gate data (56% flagged, arrow chains 92×). One line still; the
  // budget rose from <260 to <500 chars when the reading half joined — both sides of
  // the channel now ride in one payload, per version, not per turn.
  const REMINDER =
    'distill — first, in thinking: restate their point in its strongest form (cannot '
    + 'write it = keep reading); kill an alternative only by naming the killing fact, '
    + 'keep it on the map; options that tie = recompress the question. Then write only '
    + 'what serves the reader’s next action (≤5 assertions): answer first, complete '
    + 'sentences — no arrow chains, no preamble, no process narration. Declare the '
    + 'unverified; irreversible risks come first.';

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
