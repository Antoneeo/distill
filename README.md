# distill — contract-first writing for AI agents

`distill` is a writing discipline for agents that produce text: **compile the text
contract before the prose, then close with a loss/noise gate.** It supports Claude Code,
Codex, Gemini CLI and Google Antigravity 2.0.

In an agentic system text is not description, it is work — it gets executed by agents and
decided on by humans. Two failure modes follow, and the skill targets both:

- **Loss** — a blocking fact is missing, so the human comes back to ask and the agent
  invents the gap.
- **Noise** — the blocking fact is there but drowned, so the agent degrades and the human
  stops reading, turning approval into a rubber stamp.

## Installation

### Claude Code — plugin (recommended)

```bash
claude plugin marketplace add Antoneeo/distill
claude plugin install distill@distill
```

This is the only channel that carries the **persistence hook**, which re-asserts the
discipline once per turn so it does not drift over a long session. The hook is declared in
the plugin manifest and loads with the plugin — nothing is written to your `settings.json`.

**If you installed 0.2.0 and ran `distill-enable-persistence`**, remove that wiring
*before* installing the plugin (see *Migrating from 0.2.0* below). Otherwise the reminder
is injected twice per turn, once from your settings file and once from the plugin.

### Gemini CLI, Codex, Antigravity — npm

```bash
npm install -g @antoneeo/distill-skill@latest
distill-install-skill
```

**If you previously copied the skill in by hand**, remove that directory first (e.g.
`~/.claude/skills/distill/`). The installer deliberately refuses to overwrite a directory
it did not create, so it will report `⏭️ Skipped` and leave your copy alone.

The installer copies `skills/distill/` into every detected client:

- Claude Code: `~/.claude/skills/distill/`
- Codex: `~/.codex/skills/distill/`
- Gemini CLI: `~/.gemini/skills/distill/`
- Google Antigravity: `~/.gemini/config/skills/distill/` (detected distinctly from Gemini
  CLI; override the home with `ANTIGRAVITY_HOME`)

Restart the relevant agent, or reload skills where the CLI supports it.

On Claude Code, if the distill **plugin** is installed, the installer skips the npm copy —
and removes a leftover one it owns from an earlier install: the plugin already carries the
skill and the hook there, and two copies of one doctrine under one name drift apart at the
first single-channel update. Hand-placed copies are never touched.

### Updating

Neither channel updates on its own. Plugin:

```bash
claude plugin marketplace update distill && claude plugin update distill@distill
```

then restart Claude Code. (The hook notifies you in-conversation when a new version
exists — see *Update notification* below — and updating stays your act.) npm:

```bash
npm install -g @antoneeo/distill-skill@latest && distill-install-skill
```

The installer refreshes every skill copy it owns; hand-edited copies are left alone.

## Persistence hook (Claude Code plugin only)

A skill can drift: it is loaded once, applied to the first text, then quietly skipped as the
session goes on. The doctrine says it must not lapse, but a clause telling an agent not to
drift cannot itself prevent drift — the instruction is what fades. This hook re-asserts it
once per turn.

It arrives with the plugin — `.claude-plugin/plugin.json` declares it as a `UserPromptSubmit`
hook and Claude Code loads it natively. There is nothing to enable, and nothing is written to
your `settings.json`.

To turn it off, disable or uninstall the plugin. The hook is one line of context (~110 tokens —
the discipline in miniature: since 0.7.0 both halves, reading and writing) per prompt and fails
open: any internal error exits silently rather than blocking your prompt.

Installing the skill via npm does **not** give you the hook. Only the plugin does, and only on
Claude Code — Gemini CLI, Codex and Antigravity get the doctrine with no mechanism behind it.

### Update notification and auto-update (plugin only)

Neither the plugin marketplace nor npm updates anything on its own, so the hook carries an
update lane: a detached worker checks the npm registry **at most once a day** and, when a
newer version exists, the per-turn reminder gains one extra line — shown **once per new
version**, then silenced. Updating stays your act (`/plugin`, or
`claude plugin update distill@distill`).

What leaves your machine: one anonymous GET of the package metadata to `registry.npmjs.org` —
the same request `npm install` makes; nothing about you or your session is sent. Opt out
entirely with `DISTILL_NO_UPDATE_CHECK=1` (no network, no cache, no extra line).

**Auto-update is opt-in and off by default**: `DISTILL_AUTO_UPDATE=1` makes the worker run the
two update commands itself when a newer version appears (applied at the next client restart,
announced by the same one-time line). It is not the default because it means executing newly
published code without a per-version consent — if the repository were ever compromised, an
auto-updating install would follow it silently. Set it only if you accept that trade.

### Migrating from 0.2.0

0.2.0 wired this hook by editing `~/.claude/settings.json`. The dedicated cleanup command
(`distill-disable-persistence`) was removed in 0.6.0; the same cleanup still runs inside
`distill-uninstall-skill`, which unwires the settings.json entry and deletes the copied hook
file. If you only want the 0.2.0 wiring gone (to avoid a double injection next to the
plugin), remove the `UserPromptSubmit` entry whose command ends in `distill-persist.js` from
`~/.claude/settings.json` by hand.

## Uninstalling

```bash
distill-uninstall-skill          # removes the installed skills AND unwires the hook
npm uninstall -g @antoneeo/distill-skill
```

Run the command **before** `npm uninstall`, and in that order. npm has not executed the
`preuninstall` lifecycle script since v7, so `npm uninstall -g` on its own removes the
package and silently leaves every installed skill directory behind. Verified on npm 11.9.0.

### Install safety

The installer only ever touches directories it created, marked with an `.installed-by.json`
ownership file:

- A skill directory it does **not** own is never overwritten — it reports the skip and
  leaves your edits intact. Override with `DISTILL_FORCE_INSTALL=1`, which also *marks the
  directory as ours*, so a later `distill-uninstall-skill` will remove it along with
  anything else you put there.
- `distill-uninstall-skill` removes only marked directories. A hand-placed copy survives it
  and is reported, not deleted.
- An interrupted install leaves the directory marked but incomplete; the next install heals
  it silently rather than refusing to touch it.

## What the skill does

Five contract fields compiled **before** writing, because generation order beats
filtering — a gate filters a distribution that has already formed, a contract changes it:

| Field | Question |
|---|---|
| Reader | who reads, what do they already know, in what situation? |
| Action | what must they be able to do right after? |
| Payload | which complete assertions am I transmitting, blocking or decisional? |
| Level | at what altitude of abstraction, bounded by the questions above and below? |
| Form | register and a measurable budget |

Then a six-step gate: level test, deletion test (blocking / decisional / convenience /
superfluous), bidirectional coverage, action test, reader bans, form budget.

It also runs in **review mode**: reconstruct the contract an existing text should have had,
label every block, report losses and noise, rewrite, and declare the measure.

**Non-goals**, stated in the skill itself: not brevity, not elegance, not maximum
compression. The target is the distillate — a text can be too short. Telegraphic fragments
and arrow chains are noise disguised as brevity.

## When it fires

On writing or rewriting any non-trivial document: handoffs, reports, ADRs, analyses,
READMEs, agent-facing docs — and whenever you ask to shorten, tighten, condense, distill,
rewrite or audit an existing text. Chat replies are governed by the per-turn persistence
hook instead: an on-demand skill never fires mid-conversation, so since 0.5.0 the skill
stops promising it would.

It stays out of the way for translation, grammar-only fixes, creative writing and format
conversion.

## Status

Version 0.8.0. The skill text has been through four evaluation iterations; its trigger
accuracy has **not** yet been measured against a labeled query set. Treat the trigger
behavior as unvalidated.

If you remove the package with a bare `npm uninstall -g` while the persistence hook is
enabled, the hook keeps injecting on every prompt: it lives in `~/.claude/hooks/` and
survives the package. Run `distill-uninstall-skill` first, or remove the hook entry from
`~/.claude/settings.json` and delete `~/.claude/hooks/distill-persist.js` by hand.

## License

Apache-2.0 — the full terms are in the `LICENSE` file, the attribution in `NOTICE`. Copyright 2026 Antonio Pinto.

If you redistribute this skill, or a version you modified, keep `LICENSE` and `NOTICE` with it.

Using the skill in your own project carries no obligation.

Versions up to 0.8.0 were released under the MIT license and remain available under it.

If you use the skill in commercial work, a mention on your product page or website is appreciated. It is a request, not a condition of the license. A ready-made badge:

```markdown
[![Made with distill](https://img.shields.io/badge/made%20with-distill-blue)](https://www.npmjs.com/package/@antoneeo/distill-skill)
```
