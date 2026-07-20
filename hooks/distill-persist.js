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
  const REMINDER =
    'distill active — compile the contract before non-trivial text; run the gate before delivering.';

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
