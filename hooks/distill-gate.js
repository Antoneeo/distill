#!/usr/bin/env node
// Stop hook -- PHASE 1: OBSERVATIONAL ONLY. It never blocks.
//
// Fires after the assistant finishes generating, and receives `last_assistant_message` on
// stdin: the full text of what was just written. That is the only point in the lifecycle
// where §5's "run the gate before delivering" has anything to act on -- the
// UserPromptSubmit hook fires before generation and cannot see the result.
//
// Why observational first: the §6 checks are heuristics over natural language. Letting an
// unvalidated heuristic interrupt a turn is how you teach someone to disable the tool. This
// phase records what it WOULD have flagged so the checks can be judged on real data.
//
// PRIVACY (T14, a design constraint not a mitigation): the message body is never logged.
// Only a word count, the finding ids, and the matched fragment capped at 80 characters.
// A tool that turns every conversation on the machine into an on-disk transcript is not
// worth having.
//
// Phase 2 -- deciding what may block -- is deliberately out of scope until this has data.

const fs = require('fs');
const os = require('os');
const path = require('path');

const NEVER_BLOCK = true;   // phase 1 invariant, asserted by the test battery

// OFF BY DEFAULT. Writing a file derived from someone's conversations is not something a
// writing skill should do because its author wanted data. Set DISTILL_GATE_LOG=1 to opt in;
// with the variable unset this hook reads nothing, writes nothing and exits immediately.
const ENABLED = process.env.DISTILL_GATE_LOG === '1';

function main() {
  if (!ENABLED) return;

  let raw = '';
  try {
    raw = fs.readFileSync(0, 'utf8');
  } catch (e) {
    return;   // no stdin: nothing to inspect
  }

  let input;
  try {
    input = JSON.parse(raw);
  } catch (e) {
    return;
  }
  if (!input || typeof input !== 'object') return;

  // Honour the loop guard now, so phase 2 inherits it rather than bolting it on.
  // When true, this hook has already blocked this response; Claude Code caps consecutive
  // blocks at 8 and we must yield well before that.
  if (input.stop_hook_active === true) return;

  const message = input.last_assistant_message;
  if (typeof message !== 'string' || message.trim() === '') return;

  const { runChecks } = require('./checks');
  const { words, findings } = runChecks(message);

  // Nothing to record and nothing learned from an empty line.
  if (findings.length === 0 && words < 400) return;

  const dir = path.join(process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'), 'distill');
  fs.mkdirSync(dir, { recursive: true });

  const line = JSON.stringify({
    ts: new Date().toISOString(),
    prompt_id: typeof input.prompt_id === 'string' ? input.prompt_id : null,
    stop_reason: typeof input.stop_reason === 'string' ? input.stop_reason : null,
    words,
    findings,                    // {id, excerpt<=80} only -- never the message
    would_block: findings.length > 0,
  });
  fs.appendFileSync(path.join(dir, 'gate-log.jsonl'), `${line}\n`, 'utf8');
}

try {
  main();
} catch (e) {
  // Deliberately silent. This runs on every turn of every session on this machine; a Stop
  // hook that throws could hold a turn open. A missing log line is the acceptable failure.
}

// Phase 1 invariant: always 0, no stdout. Emitting `decision: "block"` or a non-zero exit
// would interrupt the turn on the strength of unvalidated heuristics.
if (NEVER_BLOCK) process.exit(0);
