---
name: distill
version: 0.4.2
description: "Contract-first writing discipline that distills text to all signal: before writing, compile the text contract (reader, action, payload of assertions, abstraction level, form), then close with the loss/noise gate. ALWAYS use before writing or rewriting any non-trivial document — handoffs, reports, ADRs, analyses, READMEs, agent-facing docs — and whenever the user asks to shorten, tighten, condense, distill, rewrite, or audit an existing text, even if they don't name this skill. Chat replies are governed by the per-turn persistence hook, which carries this discipline in miniature; load the skill when a reply grows into a document."
---

# distill — text is written contract-first

**For whom**: the agent about to produce text. **To do what**: write text that passes the gate (§5), or audit existing text (§7). **Answers**: "how do I decide what to write, and how do I verify the result". **Does not answer**: grammar, and surface style — except where the form itself degrades comprehension, which §6 governs (mutilating compression); communication theory (above — lives in the text_skill project notes).

## 1. Why — the criterion that generates every rule

> **Root.** In an agentic system, text does not describe the work: it IS work. It gets executed — by agents that act and by humans that decide. Every defect in the text becomes a defect in the action.
>
> **North star.** The reader acts correctly on the first pass, spending the least attention possible. The writer spends the reader's attention: every word must earn it.
>
> **Two evils, symmetric.** **Loss**: a blocking fact is missing — the human reader comes back to ask, the agent reader fills the gap by inventing. **Noise**: the blocking fact is there but drowned — the agent degrades, the human stops reading and their approval becomes a rubber stamp.
>
> **Means.** Deciding what matters IS the work; the text is the residue of that decision. Bloated text is deferred judgment: it offloads onto every reader, forever, the decision the writer refused to make once.
>
> **Non-goals.** Not brevity, not elegance, not maximum compression: the distillate. A text can be too short. Brevity comes from removing blocks that serve nothing — never from mutilating the sentences that remain.

When a rule in this skill doesn't cover the case, decide by the north star: maximize the reader's correct action per unit of attention spent.

## 2. The contract — compile it before the prose

The contract comes before the prose because it conditions it: what you generate first changes what you generate next. A final gate filters; the contract changes the distribution the text is born from.

| # | Field | Question | Actually filled only if... |
|---|-------|----------|-----------------------------|
| 1 | **Reader** | who reads, what do they already know, in what situation? | named concretely ("the agent at the next bootstrap, cold", "Antonio, who followed the whole conversation"), with the list of what they **already know** — which becomes a list of repetition bans |
| 2 | **Action** | what must they be able to do right after? | an executable, verifiable verb: "approve or reject", "resume from node X", "reproduce the bug". Banned: "understand", "know", "be informed" — not falsifiable |
| 3 | **Payload** | what information do I actually want to transmit? | a list of **complete assertions** — sentences that can be true or false — classified [B]locking / [D]ecisional. "The system is robust" fails the test; "the retry runs 3 times with backoff" passes it. More than ~5 blocking items = you haven't selected yet: that is an inventory, not a judgment |
| 4 | **Level** | at what altitude of abstraction am I speaking? | delimited with the **three questions** of §3 — never with a bare label |
| 5 | **Form** | what does the ideal text look like for this reader? | register (§4) + **measurable** commitments: structure and budget in numbers ("3 fixed sections, ≤300 tokens"). No adjectives |

Action (field 2) precedes payload (field 3) because it is the selection criterion: a piece of information is "real" exactly when it serves the declared action. Grounded syntheses about context ("this is a test fixture, not an app"; "even wired together, the data contracts don't match") are first-class assertions — often the most decisional ones: the assertion discipline doesn't suppress conclusions, it forces them into falsifiable form.

**Grounding rule.** A valid contract is not reusable for any other text. If the same lines could sit on top of a different text, they contain no judgment: recompile with the names, facts and numbers of the current context.

**Where the contract lives** — field 1 decides:
- human reader in chat → in your thinking, never in the visible text;
- document for humans (report, client) → invisible in the deliverable; keep it where production is kept (proposal notes, commit message);
- document for agents → **it fuses with the document** (§4): never staple it on top duplicating the assertions — two copies of the same information diverge at the first edit.

**Proportionality.** Trivial texts (confirmations, one-line answers): no contract, only the north star. Substantial chat replies: implicit contract in your thinking, zero visible cost — this is what the per-turn persistence hook re-asserts at every prompt, because a skill invoked on demand never fires for chat. Documents: explicit contract before writing.

**Persistence.** The discipline does not lapse mid-session. It governs every text you produce from the moment it loads — at the proportion above, not only the first document after loading. The failure mode is drift: the contract gets compiled for the first text, then quietly skipped for the next three while the register slides back. If you are unsure whether it still applies, it does.

## 3. The level — delimit it with three questions, never a label

A label ("L2") is a category; what you need is a boundary. Declare:

1. **the question the text answers**, phrased with the real names of the current context;
2. **the neighboring question above** that it does NOT answer (and where that one is answered, if anywhere);
3. **the neighboring question below** that it does NOT answer (and where).

Example: *"I answer: 'how does the updater integrate with the N32 device?'. I do not answer: 'why does the updater exist' (above — KL vision). I do not answer: 'what values does the timeout take' (below — config, referenced)."* With this form, the level test for each sentence becomes mechanical: does it help answer the declared question? No → relocate it toward the right question.

The ladder only names the rungs: **L0** intent (why it exists) → **L1** architecture (how it's organized) → **L2** design (how it works) → **L3** implementation (with what, exactly). Composition rules: one level per section; monotone descent (never oscillate L1→L3→L1); the declared level is the payload of the text, other levels appear only as anchors — one line of context upward, one reference downward. Under budget pressure, cut from the bottom (L3 → reference) and protect the top: details can be reconstructed from the code, intent cannot.

## 4. Registers — the reader chooses the form

| Register | Optimizes | Form constraints |
|----------|-----------|------------------|
| **Chat** (human in the flow) | reading time | the answer to the question is in the first sentence; complete sentences, plain lexicon; never repeat what the conversation already established; headings and tables only if the content truly has that structure |
| **Docs for humans** (report, ADR) | durable understanding | minimal context → decision → consequences; one idea per paragraph; slight redundancy allowed only as an anchor |
| **Docs for agents** (handoff, KL, analyses) | tokens + retrievability | form fused with the contract: **scope header** (for whom / to do what / answers / does not answer, with pointers) + **body organized by assertions**, each carrying only the supporting detail it needs (exact command, path, table). Stable terminology: one concept = one name, always the same. Self-contained: no "as discussed", no relative dates. No connective prose |

Why stable terminology: for a human, lexical variation is elegance; for an agent it is cost — retrieval and grep work on constant terms.

## 5. The gate — compiled from the contract, run before delivering

On every block, in order:

1. **Level test**: does it answer the declared question? No → relocate it to the section/document of its altitude; at most a one-line reference remains in its place. Relocate, don't delete: off-level content is often true and useful — elsewhere.
2. **Deletion test** (at the declared altitude): if I delete this, the reader fails the action → **BLOCKING**, keep it up front; decides worse → **DECISIONAL**, keep it if the budget holds; loses only a lookup → **CONVENIENCE**, one line or a link; nothing changes → **SUPERFLUOUS**, delete.

   **Cost of misreading.** The deletion test decides what to keep, never how tersely to state it. Where misreading a block is expensive or irreversible — destructive commands, security consequences, order-dependent steps, anything the reader cannot undo — write it in full sentences, name the consequence, and keep the redundancy that makes the wrong reading hard to reach. Budget yields here, not the reverse: compression that saves tokens by leaving a catastrophic step ambiguous minimizes attention spent at the cost of the correct action, which is the north star inverted. If this busts the form budget, update the contract — do not shrink the warning.

On the whole text:

3. **Bidirectional coverage**: is every payload assertion in the text? (hole = loss) — does every part of the text serve an assertion? (leftover = noise). Check the text against your **discoveries** too, not only against the contract: a fact that emerged during the work and would change the reader's decision enters the payload even if the contract didn't anticipate it and even if it busts the budget — update the contract, don't silence the discovery.
4. **Action test**: after reading, can the reader execute the contract's action?
5. **Reader bans**: nothing the reader "already knows" is re-explained.
6. **Form**: the budget and structure promised in the contract are respected.

## 6. Catalog of the superfluous — delete on sight

- restating the request you received; ceremonial openers and closers; meta-narration ("I will now proceed to...")
- compliance announcements and status lines before the answer ("I read/applied the skill", "analysis complete, here is the answer"): the message begins with the answer — the process isn't narrated, it shows in the result
- the same information in intro, body and conclusion
- adjectives with no supporting fact ("robust", "flexible", "powerful"); hedging chains ("might perhaps in some cases")
- explanations of what the reader declaredly already knows
- sections filled in only because the template has them (filler, decorative "N/A")
- in agent docs: historical narrative and changelogs in the body, references to the conversation, relative dates ("yesterday"), decorative markdown
- **mutilating compression**: telegraphic fragments, arrow chains A→B→C in place of sentences, acronyms invented on the spot. It is noise disguised as brevity: it shifts the cost onto the reader.

## 7. Review mode — auditing an existing text

1. Reconstruct the contract the text should have had (5 fields, grounded). If information needed to fill it is missing (reader? action?), **ask for it**: an audit on an invented contract is itself noise.
2. Run the gate (§5), labeling every block: B / D / C / S / off-level.
3. Report: losses (absent assertions), noise (S blocks and their weight on the total), level violations.
4. Rewrite fulfilling the contract. Declare the measure: tokens before → after, and what was relocated where.

## 8. Example of a compiled contract (end-of-session handoff, agent doc)

```
Reader: agent at the next bootstrap, cold. Already knows: updater architecture
  (KL active). Doesn't know: anything about this session.
Action: resume work from node A3.2 without re-reading the session.
Payload:
  [B] timeout fix in device_sync.py: done and tested, NOT committed
  [B] t_retry fails for a cause UNRELATED to the fix (issue #142)
  [D] polling approach discarded: it doubled the load on the device
Level: "where we are and what remains to do" (status, L2).
  Not: "why the updater exists" (above, KL). Not: "the line-by-line diff" (below, working tree).
Form: agent doc; sections Status / Next step / Risks; ≤ 300 tokens.
```

Ten lines that are not reusable for any other text — and the document they produce is almost already written.
