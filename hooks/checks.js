// The mechanically checkable half of the doctrine: §6, "catalog of the superfluous".
//
// §2 (compile the contract) and §5 (run the gate) are judgment and will stay judgment --
// no regex decides whether a block passes the deletion test. §6 is different: it is a list
// of surface patterns to delete on sight, and those are detectable.
//
// Every check below traces to one §6 bullet. Each is a pure function returning either null
// or {id, excerpt}. No I/O, no state, so they are testable in isolation.
//
// Checks run on prose ONLY. `stripCode()` removes fenced blocks, inline code and tables
// first: arrows, jargon and terse fragments are legitimate inside code and diagrams, and a
// check that fires on a Mermaid diagram is a false positive by construction.
//
// The assistant writes Italian to this user and English in project artifacts, so every
// pattern covers both.

const EXCERPT_MAX = 80;

function excerpt(match) {
  const s = String(match).replace(/\s+/g, ' ').trim();
  return s.length <= EXCERPT_MAX ? s : `${s.slice(0, EXCERPT_MAX - 1)}…`;
}

/** Remove fenced blocks, inline code, tables and blockquotes: §6 governs prose. */
function stripCode(text) {
  return String(text)
    .replace(/```[\s\S]*?```/g, ' ')     // fenced blocks
    .replace(/~~~[\s\S]*?~~~/g, ' ')
    .replace(/`[^`\n]*`/g, ' ')          // inline code
    .replace(/^\s*\|.*\|\s*$/gm, ' ')    // markdown table rows
    .replace(/^\s*>.*$/gm, ' ');         // blockquotes (often quoted source material)
}

const PATTERNS = [
  {
    id: 'ceremonial_opener',
    // §6: "ceremonial openers and closers"
    re: /^\s*(?:certamente|certo(?:,| )|volentieri|ottima domanda|buona domanda|sure[,!]|certainly|of course|great question|happy to help|i'?d be happy to)/i,
    firstLineOnly: true,
  },
  {
    id: 'compliance_announcement',
    // §6: "compliance announcements and status lines before the answer" -- the message
    // must begin with the answer; narrating your own process first is the ban.
    //
    // The pattern is a first-person perfect verb about the agent's own activity. An earlier
    // draft of this check required "Ho letto la|e" and caught 2 of ~9 real cases in the eval
    // corpus: the actual shape is "Ho letto TUTTO IL PROGETTO" (x4) and "Ho esaminato" (x2).
    // Recall, not precision, was the weak side.
    re: /^\s*(?:ho (?:letto|esaminato|analizzato|controllato|verificato|guardato|ispezionato|dato un'?occhiata)|ho applicato|ho seguito la skill|analisi completa|come richiesto,|i(?:'ve| have) (?:read|examined|reviewed|analyzed|analysed|looked at|gone through|applied)|analysis complete|as requested,)/i,
    firstLineOnly: true,
  },
  {
    id: 'status_line',
    // Same §6 bullet, different position: the hand-off sentence that announces the answer
    // instead of being it ("Ecco la risposta.", "Here's the answer."). It sits anywhere in
    // the opening line, so it cannot be caught by a start-anchored pattern.
    re: /\becco (?:la risposta|il quadro|l'?analisi|cosa ho trovato|il risultato)\b|\bhere'?s (?:the answer|the analysis|what i found)\b/i,
    firstLineOnly: true,
  },
  {
    id: 'meta_narration',
    // §6: "meta-narration ('I will now proceed to...')"
    re: /\b(?:procedo ora a|sto per (?:analizzare|spiegare|elencare)|adesso ti (?:spiego|elenco)|i will now (?:proceed|explain|analyze)|let me now (?:proceed|walk you)|in questa risposta (?:ti )?(?:spiegher|elencher))/i,
  },
  {
    id: 'hedging_chain',
    // §6: "hedging chains ('might perhaps in some cases')"
    re: /\b(?:potrebbe forse|forse potrebbe|magari in alcuni casi|in un certo senso potrebbe|might perhaps|could possibly maybe|may potentially|perhaps in some cases)\b/i,
  },
  {
    id: 'arrow_chain',
    // §6: "mutilating compression: arrow chains A→B→C in place of sentences".
    // Two or more arrows in a row, outside code. One arrow is often legitimate prose
    // ("0.2.0 → 0.3.0"); a chain is the pattern the doctrine names.
    re: /[^\s→>-]+\s*(?:→|->)\s*[^\s→>-]+\s*(?:→|->)\s*[^\s→>-]+/,
  },
  {
    id: 'unsupported_adjective',
    // §6: "adjectives with no supporting fact". LOW PRECISION BY DESIGN -- kept in phase 1
    // precisely to measure how noisy it is. Expected to be the first check dropped.
    re: /\b(?:robusto|robusta|flessibile|potente|solido|solida|elegante|robust|flexible|powerful|seamless|elegant)\b/i,
  },
];

/** §6: "the same information in intro, body and conclusion" — exact sentence repeated. */
function repeatedSentence(prose) {
  const sentences = prose
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.replace(/\s+/g, ' ').trim().toLowerCase())
    .filter((s) => s.split(' ').length >= 8);   // short repeats are usually legitimate
  const seen = new Map();
  for (const s of sentences) {
    const n = (seen.get(s) || 0) + 1;
    seen.set(s, n);
    if (n === 2) return { id: 'repeated_sentence', excerpt: excerpt(s) };
  }
  return null;
}

/**
 * Run every check over an assistant message.
 * Returns { words, findings: [{id, excerpt}] }. Never throws on odd input.
 */
function runChecks(message) {
  const raw = typeof message === 'string' ? message : '';
  const prose = stripCode(raw);
  const firstLine = (prose.split('\n').find((l) => l.trim() !== '') || '');
  const findings = [];

  for (const p of PATTERNS) {
    const target = p.firstLineOnly ? firstLine : prose;
    const m = target.match(p.re);
    if (m) findings.push({ id: p.id, excerpt: excerpt(m[0]) });
  }

  const rep = repeatedSentence(prose);
  if (rep) findings.push(rep);

  return {
    words: prose.split(/\s+/).filter(Boolean).length,
    findings,
  };
}

module.exports = { runChecks, stripCode, PATTERNS, EXCERPT_MAX };
