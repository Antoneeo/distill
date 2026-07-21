#!/usr/bin/env node
// UserPromptSubmit hook: re-asserts the distill discipline once per turn.
//
// Why a hook and not just the doctrine: a clause telling an agent not to drift
// cannot itself prevent drift -- the instruction is what fades. This re-injects
// it at every turn, which is the only mechanism that survives a long session.
//
// Two constraints this file obeys, both from the skill it serves:
//   - the payload is ONE line. A hook that re-states the doctrine every turn
//     would be the noise distill exists to remove, paid forever.
//   - it fails open. Any internal error exits 0 with no output: this runs on
//     every prompt, so a crash here must never be able to block the session.

try {
  // Directive, self-contained, no undefined terms. The previous payload named the
  // contract and the gate — two mechanisms whose definitions live in the skill body,
  // which is NOT loaded on most turns. An instruction to run a procedure the agent has
  // not read is not an instruction. This states the criterion instead: the effort of
  // understanding belongs to the writer, and both failure modes are covered without
  // being named ("only what they need" = noise, "clear the first time" = loss).
  const REMINDER =
    'distill — give the answer and stop. No preamble, no closing caveats, no reasoning or '
    + 'alternatives unless asked; the reader asks when they want more. Exception: a risk '
    + 'they cannot undo comes first, not last.';

  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'UserPromptSubmit',
      additionalContext: REMINDER,
    },
  }));
} catch (e) {
  // Deliberately silent: never block a prompt because a reminder failed.
}

process.exit(0);
