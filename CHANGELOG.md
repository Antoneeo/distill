# Changelog

All notable changes to `@antoneeo/distill-skill`.

## [Unreleased]

**The per-turn reminder carried the form, not the discipline — and 195 turns of phase-1
gate data proved it.** 56% of logged replies would have been flagged; the dominant
finding was `arrow_chain` (92 hits — the §6 mutilating compression the reminder never
mentioned), while the one thing the reminder did ban (compliance announcements) fired
once. Content noise — unselected assertions, process narration — is invisible to the
Stop-hook heuristics entirely, so the only place it can be governed is before
generation.

- **The persistence hook now carries the discipline in miniature**: selection (who
  reads, what they do next, ≤5 assertions serving that action), answer-first, complete
  sentences with arrow chains and fragments named as bans, no process narration. Same
  one-line, <260-char budget; still no skill-internal terms.
- **The skill description stops promising what an on-demand skill cannot keep.**
  "ALWAYS use before long chat replies" never fired — a skill is pull, the model never
  pulls mid-conversation. The declared boundary now: documents and audits load the
  skill; chat replies are governed by the hook. §2 Proportionality says the same.

## [0.4.2] — 2026-08-03

**An installed copy could not say which build it was.** What reaches a client is one file,
`skills/distill/SKILL.md` — no `package.json`, no `gemini-extension.json`, no
`plugin.json` — so nothing in it carried a version. Answering "is that fix in your copy?"
needed `npm view` plus a shasum comparison, and from a user's side it was unanswerable.

- `version:` in the SKILL.md frontmatter, and in `.claude-plugin/plugin.json`, which
  never had one.
- The battery's version-sync test now covers **every** bump point — SKILL.md,
  `package.json`, `gemini-extension.json`, `plugin.json`, README — as one test rather
  than two overlapping ones. A hand-maintained version string rots; what is asserted is
  that they all move together.

## [0.4.1] — 2026-07-21

**0.4.0 shipped a hooks block that produced no hooks.** Both its hooks were dead on the machine
that installed it — including the persistence hook that worked in 0.3.0. If you installed 0.4.0,
this release is the fix.

### Hooks move to `hooks/hooks.json`

Every plugin in Anthropic's own marketplace — `ralph-loop`, `hookify`, `security-guidance`, and
the two output-style plugins — declares its hooks in `hooks/hooks.json` at the plugin root, and
none of them puts a `hooks` key in `plugin.json`. The client loads that file automatically. Two
of those plugins ship a `Stop` hook from it.

`plugin.json` is now metadata only. `hooks/hooks.json` carries both `UserPromptSubmit` and
`Stop`.

Honesty about the diagnosis: the inline `hooks` key in `plugin.json` is **not** invalid — the
client's own schema types it as a supported union, and other plugins use it successfully. So the
root cause of 0.4.0's failure is not established, only its fix. What is verified is the layout
this release adopts.

### Manifest defects found by actually running the validator

- `marketplace.json` had **failed `claude plugin validate` since the day it was written**: root
  `$schema` and `description` are unrecognized keys. The description moves to
  `metadata.description`. Nobody had ever run the validator.
- `plugin.json` deliberately declares **no `version`**. With it set, the version string becomes
  the update cache key and pushing commits no longer reaches users until it is bumped; without
  it, the git SHA is used and every commit propagates. Same choice `caveman` and `hookify` make.
  A test now guards both manifests.

### `stop_hook_active` was read backwards

It means *"some `Stop` hook is configured to block"* — a fact about configuration, not "this hook
already blocked this response". The gate used to return early on it, which in phase 1 would have
silently starved data collection whenever any blocking Stop hook existed on the machine. It is
now recorded in the log line instead. The "Claude Code caps consecutive blocks at 8" cited in the
old comment appears in no documentation.

`last_assistant_message`, by contrast, is confirmed correct and is the recommended route —
reading the transcript file instead is the older, lossier one.

## [0.4.0] — 2026-07-20

A `Stop` hook that inspects what was actually written. **It never blocks** — this release
only records what it would have flagged, so the heuristics can be judged on real data before
any of them is allowed to interrupt a turn.

### Why a second hook

The `UserPromptSubmit` hook from 0.3.0 fires *before* generation, so it can carry the §2
contract reminder but has no purchase on §5's "run the gate before delivering". The `Stop`
hook fires after the response is generated and receives `last_assistant_message` — the full
text — which is the only point in the lifecycle where the gate has something to act on.

Only §6 is mechanised. §2 and §5 are judgment and stay judgment; §6 is a list of surface
patterns to delete on sight, and those are detectable.

### Added

- `hooks/distill-gate.js` — Stop hook, observational. Honours `stop_hook_active`, fails
  silently, always exits 0.
- `hooks/checks.js` — the §6 pattern set as pure functions. Code blocks, inline code, tables
  and blockquotes are stripped before every check: arrows and terse fragments are legitimate
  inside code, and a check that fires on a diagram is a false positive by construction.
- Checks: `ceremonial_opener`, `compliance_announcement`, `status_line`, `meta_narration`,
  `hedging_chain`, `arrow_chain`, `repeated_sentence`, `unsupported_adjective`. Italian and
  English, since the assistant writes both.

### Validated against the real eval corpus, not only fixtures

Run over the 20 archived eval outputs:

| | flagged |
|---|---|
| without-skill runs | 8 / 8 |
| with-skill runs | 3 / 12 |

The three with-skill hits are exactly the defects this project recorded by hand — iteration-1
(before the §6 rule existed), iteration-2/run4, iteration-3/run4 — and iteration-4 is clean
at 0/4. The checks independently reproduce the 2/3 → 1/4 → 0/4 trajectory that manual
inspection had found.

A first draft of `compliance_announcement` caught only **2 of ~9** real cases: it required
"Ho letto la|e" while the corpus shape is "Ho letto *tutto il progetto*" and "Ho esaminato".
Recall, not precision, was the weak side. Fixed before release, and `status_line` was added
for the mid-line variant a start-anchored pattern cannot see.

### Privacy — the log is OFF unless you turn it on

**Nothing is written unless `DISTILL_GATE_LOG=1` is set.** With the variable unset the hook
reads nothing, writes nothing and exits. Any other value ("0", "true", "yes", empty) is also
off; only the exact string `1` enables it. Asserted by a test.

This matters because the hook otherwise runs on every turn of every session for everyone who
installs the plugin. A writing skill has no business creating files derived from a user's
conversations because its author wanted data.

When you do opt in, the log at `~/.claude/distill/gate-log.jsonl` still **never contains the
message body** — only a timestamp, word count, finding ids and the matched fragment capped
at 80 characters. Asserted by a canary test that plants a secret in the message and checks
it never reaches disk.

### Deprecation rescheduled

0.3.0 said `distill-disable-persistence` and `scripts/settings.js` would be removed in 0.4.0.
**Deferred to 0.5.0.** 0.3.0 was published hours before this release, so it was not a real
migration window for anyone who enabled the 0.2.0 hook.

## [0.3.0] — 2026-07-20

The persistence hook now ships through the Claude Code plugin manifest. It no longer touches
your `settings.json`.

### Why this changed one version after 0.2.0

0.2.0 justified its opt-in `settings.json` wiring partly on a claimed precedent: that caveman
also required a deliberate install step for its hooks. That was wrong. Caveman declares hooks
in `.claude-plugin/plugin.json` with `${CLAUDE_PLUGIN_ROOT}`, and Claude Code loads them
natively when the plugin installs. The settings-merge module — which produced three blocking
defects in review, including one that deleted a co-located third-party hook — existed to make
safe an operation the platform never required.

It also never got switched on. Between 0.2.0 shipping and this release, the persistence clause
had no mechanism behind it anywhere.

### Added

- `.claude-plugin/plugin.json` — declares the `UserPromptSubmit` hook via `${CLAUDE_PLUGIN_ROOT}`.
- `.claude-plugin/marketplace.json` — the repository is its own marketplace. Install with
  `claude plugin marketplace add Antoneeo/distill && claude plugin install distill@distill`.
- Tests asserting the manifest resolves to a file that exists, that the marketplace parses,
  that the skill sits at the plugin-convention path `skills/distill/SKILL.md`, and that every
  declared `bin` and `files` entry exists on disk.

### Removed

- `distill-enable-persistence`. Superseded by the plugin manifest.

### Deprecated

- `distill-disable-persistence`, retained for one version so anyone who ran the 0.2.0 enable
  command can undo it. `scripts/settings.js` survives in removal-only form for the same reason —
  the safe direction, since it deletes our own entry and creates none. Both go in 0.4.0.

### Migration

If you ran `distill-enable-persistence` on 0.2.0, run `distill-disable-persistence` **before**
installing the plugin. Otherwise the reminder is injected twice per turn.

### Unchanged

The npm package still delivers the skill to Gemini CLI, Codex and Antigravity. Those clients
get the doctrine and no hook. Note that caveman reaches its clients through each one's *native*
install path rather than copying files into their directories; adopting that model would remove
this package's hand-copying and its ownership-marker machinery entirely. Deferred, not rejected.

## [0.2.0] — 2026-07-20

Two doctrine additions and the mechanism that backs the first, found by comparing distill
against a compression-oriented skill (caveman) and asking what each covers that the other
does not.

### Added — doctrine (`SKILL.md`)

- **§2 Persistence** — the discipline does not lapse mid-session; it governs every text from
  the moment it loads, at the proportion §2 already sets. Names drift as the failure mode.
  Deliberately *not* a copy of "active every response": that would mandate contract
  compilation on one-line confirmations, contradicting Proportionality two sentences earlier.
- **§5 Cost of misreading** — the deletion test decides what to keep, never how tersely to
  state it. Where misreading is expensive or irreversible, full sentences and protective
  redundancy outrank the budget. Closes a real gap: distill had no risk-proportionality, so a
  destructive command and a status line were treated identically. Derived from the north star
  rather than written as a carve-out, so the "every rule generates from one criterion"
  property holds.

### Added — persistence hook (opt-in, Claude Code only)

- `distill-enable-persistence` / `distill-disable-persistence`. Copies
  `hooks/distill-persist.js` into `~/.claude/hooks/` and appends one `UserPromptSubmit` entry
  to `~/.claude/settings.json`.
- **Not wired by `npm install`.** `settings.json` is the user's file and shared with other
  tools; a bad write there breaks Claude Code, not just distill. Same reasoning as the
  ownership marker in 0.1.0, and the same shape caveman uses.
- Safety: appends rather than replaces (other tools' entries stay byte-identical); timestamped
  backup before any modification; atomic write; refuses a `settings.json` that does not parse
  and leaves it untouched; idempotent both ways.
- The hook script is *copied* into `~/.claude/hooks/` rather than referenced inside global
  `node_modules`, so `npm uninstall -g` cannot leave a hook command pointing at a deleted file.
- `distill-uninstall-skill` now also unwires the hook.
- Hook payload is one line and fails open: any internal error exits 0 silently, because this
  runs on every prompt and must never be able to block a session.

### Hardening from independent review (pre-release)

An adversarial review of this release found three blocking defects, all verified by
execution and all fixed before publishing:

- **`unwire()` deleted co-located third-party hooks.** It matched at *entry* granularity but
  removed the whole entry; Claude Code groups several commands under one entry, so disabling
  distill could delete another tool's hook from the same entry. Now filters at *hook*
  granularity and drops the entry only once it is empty. Mutation-verified.
- **The test battery's isolation was enforced by nothing.** Breaking the `CLAUDE_CONFIG_DIR`
  path helper still passed every test while the battery rewrote the developer's real
  `settings.json`. Isolation is now asserted, and settings tests refuse to run against a path
  inside the real Claude config dir.
- **Three advertised behaviours had no test:** hook-file deletion, uninstall unwiring, and the
  atomic write. All three could be disabled without failing anything. Now covered.

Also fixed: `hooks: []` silently wired nothing while reporting success; a non-array
`hooks.UserPromptSubmit` was overwritten instead of refused; the hook identifier matched any
command merely *containing* `distill-persist`, so a path like
`/opt/distill-persistence-analyzer/run.js` was claimed as ours and deleted; re-running enable
would not restore a hand-deleted hook script; a concurrent write between read and write
silently dropped the other writer's keys; renaming onto a symlinked `settings.json` replaced
the symlink with a regular file; the backup message printed even when no backup was made;
`preuninstall` did not unwire the hook.

### Not done, deliberately

- No compressed-register row and no exception to §6's mutilating-compression ban. Both were
  considered and rejected: they would import grammar compression into a doctrine that names it
  a non-goal.
- The hook is Claude Code only. Gemini CLI, Codex and Antigravity receive the doctrine change
  but no persistence mechanism in this version.

## [0.1.0] — 2026-07-20

First packaged release. The skill text itself predates this package: it is the English
rename of `testo-netto` v0.2, developed and evaluated in a separate research workspace.

### Added

- `skills/distill/SKILL.md` — the contract-first writing discipline (8 sections).
- Multi-client installer for Claude Code, Codex, Gemini CLI and Google Antigravity 2.0,
  with the shared-home guard that keeps Antigravity (`~/.gemini/config/skills/`) distinct
  from Gemini CLI (`~/.gemini/skills/`).
- **Ownership marker** (`.installed-by.json`): the installer refuses to overwrite a skill
  directory it did not create, and the uninstaller leaves such a directory in place.
  `DISTILL_FORCE_INSTALL=1` overrides the refusal deliberately. This is a deviation from
  the sibling `@antoneeo/agentic-sdlc-skill` package, which overwrites and removes
  unconditionally.
- `distill-uninstall-skill` bin — the supported removal path. npm has not run the
  `preuninstall` lifecycle script since v7, so `npm uninstall -g` alone leaves every
  installed skill directory behind (verified on npm 11.9.0 against an isolated prefix).
  The `preuninstall` hook is retained as best-effort for older npm versions; both paths
  share one ownership-checked implementation, `removeSkill()` in `lib.js`.
- `scripts/test_clients.js` — 14-case battery covering target-path resolution, the
  shared-home guard, marker semantics, partial-install recovery, and install/uninstall
  round trips against redirected client homes. Not shipped in the published package.

### Notes

- `commandExists` uses `execFileSync` with `shell: false` and a 3s timeout rather than
  `execSync` with a shell string: on Windows a shell string resolves the current directory
  before PATH, and an unbounded probe can hang `npm i -g` with no output.
- The ownership marker is written *before* the copy and refreshed after, so an interrupted
  install stays owned and self-heals instead of locking the package out of its own directory.

### Known limitations

- Trigger accuracy is unmeasured: no eval run against a labeled query set has completed.
- Installs verified on Windows only, against redirected homes and an isolated npm prefix.
