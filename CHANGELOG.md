# Changelog

All notable changes to `@antoneeo/distill-skill`.

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
