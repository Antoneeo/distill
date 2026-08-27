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
