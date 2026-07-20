# Changelog

All notable changes to `@antoneeo/distill-skill`.

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
