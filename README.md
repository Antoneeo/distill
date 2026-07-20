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

## Persistence hook (optional, Claude Code only)

A skill can drift: it is loaded once, applied to the first text, then quietly skipped as the
session goes on. The doctrine says it must not lapse, but a clause telling an agent not to
drift cannot itself prevent drift — the instruction is what fades. This hook re-asserts it
once per turn.

```bash
distill-enable-persistence     # opt in
distill-disable-persistence    # opt out, keeps the skill installed
```

Enabling copies `distill-persist.js` into `~/.claude/hooks/` and appends one
`UserPromptSubmit` entry to `~/.claude/settings.json`. It is **not** done by `npm install` —
your settings file is yours, shared with every other tool that registers hooks, and a bad
write there breaks Claude Code rather than merely breaking distill. So it takes a separate,
deliberate command.

What it guarantees:

- Your existing hooks are appended to, never replaced. Entries from other tools are left
  byte-identical.
- A timestamped backup of `settings.json` is written before any modification.
- The write is atomic, so an interrupted run cannot truncate the file.
- A `settings.json` that does not parse is refused outright and left untouched.
- Enabling twice is a no-op. Disabling removes only distill's entry and its own hook script.

Cost: one line of context (~15 tokens) added to every prompt, for as long as it is enabled.

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

On writing or rewriting non-trivial text: documents, handoffs, reports, ADRs, analyses,
READMEs, agent-facing docs, long chat replies — and whenever you ask to shorten, tighten,
condense, distill, rewrite or audit an existing text.

It stays out of the way for translation, grammar-only fixes, creative writing and format
conversion.

## Status

Version 0.2.0. The skill text has been through four evaluation iterations; its trigger
accuracy has **not** yet been measured against a labeled query set. Treat the trigger
behavior as unvalidated.

If you remove the package with a bare `npm uninstall -g` while the persistence hook is
enabled, the hook keeps injecting on every prompt: it lives in `~/.claude/hooks/` and
survives the package. Run `distill-uninstall-skill` first, or remove the hook entry from
`~/.claude/settings.json` and delete `~/.claude/hooks/distill-persist.js` by hand.

## License

MIT — Antonio Pinto
