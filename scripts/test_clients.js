#!/usr/bin/env node
// Dev-only Node test battery for the CLIENTS registry (lib.js), the ownership
// marker, and the install/uninstall lifecycle (postinstall.js / preuninstall.js).
//
// NOT shipped: this file is deliberately absent from package.json `files`.
// Run it with:
//   node scripts/test_clients.js
//
// It guards the threats named in ANALYSIS_distill_packaging.md:
//   T1 shared-home double-install (Gemini CLI vs Antigravity under ~/.gemini)
//   T2 uninstall removing a directory this package did not create
//   T3 install overwriting a hand-edited skill silently
//
// TEST-DESIGN RULE, learned from a review finding: the T1 guard must be asserted
// STRUCTURALLY, never through `clientDetected`. Detection short-circuits on
// `commandExists(cmd)`, so on a machine where `agy` is installed a detection-based
// T1 test passes even with the guard deleted -- a tautology wearing a threat name.
// The structural assertions below depend on nothing that is installed.
//
// `lib.js` resolves each client's `home` from process.env / os.homedir() at
// module-load time, so pure-function cases stub the env and re-require a fresh
// module instance. Lifecycle cases run postinstall/preuninstall as child
// processes with client homes redirected into a throwaway temp dir, so the real
// user profile is never touched.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const LIB_PATH = require.resolve('./lib');
const POSTINSTALL = path.join(__dirname, 'postinstall.js');
const PREUNINSTALL = path.join(__dirname, 'preuninstall.js');
const UNINSTALL = path.join(__dirname, 'uninstall.js');
const MARKER_NAME = '.installed-by.json';
const CLIENT_ENV = ['CLAUDE_CONFIG_DIR', 'GEMINI_HOME', 'CODEX_HOME', 'ANTIGRAVITY_HOME'];

const leaked = [];
function tempHome(tag) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `distill-${tag}-`));
  leaked.push(dir);
  return dir;
}
// Fixtures are swept on exit rather than per-test: a failing assertion should
// leave the tree inspectable while the run is live.
process.on('exit', () => {
  for (const dir of leaked) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* best effort */ }
  }
});

function freshLib(env = {}) {
  const savedEnv = {};
  const managedKeys = [...CLIENT_ENV, 'HOME', 'USERPROFILE'];
  for (const k of managedKeys) {
    savedEnv[k] = process.env[k];
    if (k in env) {
      if (env[k] === undefined) delete process.env[k];
      else process.env[k] = env[k];
    } else {
      delete process.env[k];
    }
  }
  const savedHomedir = os.homedir;
  if (env.__homedir) os.homedir = () => env.__homedir;
  delete require.cache[LIB_PATH];
  let lib;
  try {
    lib = require('./lib');
  } finally {
    os.homedir = savedHomedir;
    for (const k of managedKeys) {
      if (savedEnv[k] === undefined) delete process.env[k];
      else process.env[k] = savedEnv[k];
    }
    delete require.cache[LIB_PATH];
  }
  return lib;
}

function clientByKey(lib, key) {
  const c = lib.CLIENTS.find((x) => x.key === key);
  assert.ok(c, `CLIENTS must contain a '${key}' entry`);
  return c;
}

// Redirect each client home with its own env var. Detection then short-circuits
// on the env-var branch, which is what we want when the test is about install
// mechanics rather than about detection.
function runScript(script, home, extraEnv = {}) {
  return execFileSync(process.execPath, [script], {
    encoding: 'utf8',
    env: {
      ...process.env,
      CLAUDE_CONFIG_DIR: path.join(home, '.claude'),
      GEMINI_HOME: path.join(home, '.gemini'),
      CODEX_HOME: path.join(home, '.codex'),
      ANTIGRAVITY_HOME: path.join(home, '.antigravity'),
      ...extraEnv,
    },
  });
}

// Redirect the whole home directory instead, with every client env var CLEARED,
// so homes resolve through os.homedir() and Gemini CLI / Antigravity genuinely
// share `<home>/.gemini` -- the real T1 geometry.
function runScriptSharedHome(script, home) {
  const env = { ...process.env, HOME: home, USERPROFILE: home };
  for (const k of CLIENT_ENV) delete env[k];
  return execFileSync(process.execPath, [script], { encoding: 'utf8', env });
}

// --- T1: the collision guard, asserted structurally (never skipped) ---------
test('T1 guard is declared: antigravity carries skillsSubdir + homeMarker, gemini carries neither', () => {
  const lib = freshLib({ __homedir: path.join(os.tmpdir(), 'distill-fixed') });
  const gemini = clientByKey(lib, 'gemini');
  const antigravity = clientByKey(lib, 'antigravity');

  assert.strictEqual(antigravity.skillsSubdir, 'config/skills',
    'deleting skillsSubdir reopens the shared-home double install');
  assert.ok(antigravity.homeMarker,
    'without homeMarker, detection fires on bare ~/.gemini, which every Antigravity user has');
  assert.strictEqual(gemini.skillsSubdir, undefined, 'gemini must keep the default skills subdir');
  assert.strictEqual(gemini.homeMarker, undefined, 'gemini must probe its bare home');
  assert.notStrictEqual(gemini.home, antigravity.homeMarker,
    'the marker must be strictly more specific than the shared home');
});

test('T1 bare ~/.gemini does not carry the Antigravity marker path', () => {
  const home = tempHome('marker-path');
  fs.mkdirSync(path.join(home, '.gemini'), { recursive: true });
  const lib = freshLib({ __homedir: home });
  const antigravity = clientByKey(lib, 'antigravity');
  assert.ok(!fs.existsSync(antigravity.homeMarker),
    'a bare ~/.gemini must not satisfy the Antigravity detection marker');

  fs.mkdirSync(path.join(home, '.gemini', 'config', 'skills'), { recursive: true });
  const lib2 = freshLib({ __homedir: home });
  assert.ok(fs.existsSync(clientByKey(lib2, 'antigravity').homeMarker),
    'creating ~/.gemini/config/skills must satisfy it');
});

test('T1 detection does not fire on bare ~/.gemini when no CLI is on PATH', () => {
  const home = tempHome('detect-nopath');
  fs.mkdirSync(path.join(home, '.gemini'), { recursive: true });
  // PATH cleared so commandExists('agy') cannot short-circuit the probe. node is
  // invoked by absolute path, so it still runs.
  const script = `
    const lib = require(${JSON.stringify(LIB_PATH)});
    const a = lib.CLIENTS.find(c => c.key === 'antigravity');
    const g = lib.CLIENTS.find(c => c.key === 'gemini');
    process.stdout.write(JSON.stringify({ a: lib.clientDetected(a), g: lib.clientDetected(g) }));
  `;
  const env = { ...process.env, HOME: home, USERPROFILE: home, PATH: '', Path: '' };
  for (const k of CLIENT_ENV) delete env[k];
  const out = execFileSync(process.execPath, ['-e', script], { encoding: 'utf8', env });
  const seen = JSON.parse(out);
  assert.strictEqual(seen.a, false, 'bare ~/.gemini must NOT count as Antigravity installed');
  assert.strictEqual(seen.g, true, 'bare ~/.gemini DOES count as Gemini CLI installed');
});

// --- skill target paths ----------------------------------------------------
test('skillTarget resolves to <home>/skills/distill for claude/gemini/codex', () => {
  const fakeHome = path.join(os.tmpdir(), 'distill-test-home-fixed');
  const lib = freshLib({ __homedir: fakeHome });
  assert.strictEqual(
    lib.skillTarget(clientByKey(lib, 'claude')),
    path.join(fakeHome, '.claude', 'skills', 'distill'),
  );
  assert.strictEqual(
    lib.skillTarget(clientByKey(lib, 'gemini')),
    path.join(fakeHome, '.gemini', 'skills', 'distill'),
  );
  assert.strictEqual(
    lib.skillTarget(clientByKey(lib, 'codex')),
    path.join(fakeHome, '.codex', 'skills', 'distill'),
  );
});

test('T1 Antigravity target is distinct from Gemini CLI under a shared home', () => {
  const fakeHome = path.join(os.tmpdir(), 'distill-test-home-fixed');
  const lib = freshLib({ __homedir: fakeHome });
  assert.strictEqual(
    lib.skillTarget(clientByKey(lib, 'antigravity')),
    path.join(fakeHome, '.gemini', 'config', 'skills', 'distill'),
  );
  assert.notStrictEqual(
    lib.skillTarget(clientByKey(lib, 'gemini')),
    lib.skillTarget(clientByKey(lib, 'antigravity')),
  );
});

test('every reload string names this skill, not the package it was ported from', () => {
  const lib = freshLib();
  for (const client of lib.CLIENTS) {
    assert.ok(client.reload, `${client.key} must carry a reload hint`);
    assert.ok(
      !/agentic[- ]sdlc/i.test(client.reload),
      `${client.key} reload string still names the ported-from skill: ${client.reload}`,
    );
  }
});

// --- ownership marker ------------------------------------------------------
test('isOwned is false for a missing, malformed, array or foreign marker', () => {
  const lib = freshLib();
  const dir = tempHome('marker');
  assert.strictEqual(lib.isOwned(dir), false, 'no marker');

  const cases = ['not json', '', 'null', '5', '"a string"', '[]', '[{"package":"@antoneeo/distill-skill"}]'];
  for (const raw of cases) {
    fs.writeFileSync(path.join(dir, MARKER_NAME), raw, 'utf8');
    assert.strictEqual(lib.isOwned(dir), false, `malformed marker must fail toward "not ours": ${raw}`);
    assert.strictEqual(lib.readMarker(dir), null, `readMarker must return null for: ${raw}`);
  }

  fs.writeFileSync(path.join(dir, MARKER_NAME), JSON.stringify({ package: 'someone-else' }), 'utf8');
  assert.strictEqual(lib.isOwned(dir), false, 'foreign marker');

  lib.writeMarker(dir, '9.9.9');
  assert.strictEqual(lib.isOwned(dir), true, 'own marker');
  assert.strictEqual(lib.readMarker(dir).version, '9.9.9');
});

// --- install / uninstall lifecycle -----------------------------------------
test('install writes the skill and its marker, uninstall removes both', () => {
  const home = tempHome('roundtrip');
  const target = path.join(home, '.claude', 'skills', 'distill');

  runScript(POSTINSTALL, home);
  assert.ok(fs.existsSync(path.join(target, 'SKILL.md')), 'SKILL.md installed');
  assert.ok(fs.existsSync(path.join(target, MARKER_NAME)), 'marker written');

  runScript(PREUNINSTALL, home);
  assert.strictEqual(fs.existsSync(target), false, 'target removed on uninstall');
});

test('T1 a shared-home install lands in two distinct directories', () => {
  const home = tempHome('sharedhome');
  // Seed both client homes so the fs probe detects each on its own terms.
  fs.mkdirSync(path.join(home, '.gemini', 'config', 'skills'), { recursive: true });

  runScriptSharedHome(POSTINSTALL, home);
  const geminiTarget = path.join(home, '.gemini', 'skills', 'distill', 'SKILL.md');
  const antigravityTarget = path.join(home, '.gemini', 'config', 'skills', 'distill', 'SKILL.md');
  assert.ok(fs.existsSync(geminiTarget), 'Gemini CLI target installed');
  assert.ok(fs.existsSync(antigravityTarget), 'Antigravity target installed');

  runScriptSharedHome(PREUNINSTALL, home);
  assert.strictEqual(fs.existsSync(path.dirname(geminiTarget)), false, 'gemini target removed');
  assert.strictEqual(fs.existsSync(path.dirname(antigravityTarget)), false, 'antigravity target removed');
});

test('an interrupted install stays owned, so the next install heals it', () => {
  const home = tempHome('partial');
  const target = path.join(home, '.claude', 'skills', 'distill');
  // Simulate the crash window: marker claimed, copy never completed.
  fs.mkdirSync(target, { recursive: true });
  freshLib().writeMarker(target, '0.0.0-partial');
  assert.strictEqual(fs.existsSync(path.join(target, 'SKILL.md')), false, 'precondition: no content');

  const out = runScript(POSTINSTALL, home);
  assert.ok(!/Skipped Claude Code/.test(out), 'a half-installed target must NOT be skipped');
  assert.ok(fs.existsSync(path.join(target, 'SKILL.md')), 'next install heals the partial state');
});

test('T3 install refuses to overwrite an unowned skill dir', () => {
  const home = tempHome('unowned');
  const target = path.join(home, '.claude', 'skills', 'distill');
  fs.mkdirSync(target, { recursive: true });
  fs.writeFileSync(path.join(target, 'SKILL.md'), 'HAND EDITED', 'utf8');

  const out = runScript(POSTINSTALL, home);
  assert.match(out, /Skipped Claude Code/);
  assert.strictEqual(
    fs.readFileSync(path.join(target, 'SKILL.md'), 'utf8'),
    'HAND EDITED',
    'hand-edited content must survive',
  );
});

test('T3 DISTILL_FORCE_INSTALL overrides the refusal deliberately', () => {
  const home = tempHome('force');
  const target = path.join(home, '.claude', 'skills', 'distill');
  fs.mkdirSync(target, { recursive: true });
  fs.writeFileSync(path.join(target, 'SKILL.md'), 'HAND EDITED', 'utf8');

  runScript(POSTINSTALL, home, { DISTILL_FORCE_INSTALL: '1' });
  assert.notStrictEqual(
    fs.readFileSync(path.join(target, 'SKILL.md'), 'utf8'),
    'HAND EDITED',
    'force must overwrite',
  );
  assert.ok(fs.existsSync(path.join(target, MARKER_NAME)), 'marker written after forced install');
});

test('the uninstall bin removes owned dirs and reports a foreign one', () => {
  const home = tempHome('uninstall-bin');
  runScript(POSTINSTALL, home);
  const owned = path.join(home, '.claude', 'skills', 'distill');
  assert.ok(fs.existsSync(owned), 'precondition: installed');

  // Plant a foreign copy in another client's slot.
  const foreign = path.join(home, '.codex', 'skills', 'distill');
  fs.rmSync(path.join(foreign, MARKER_NAME), { force: true });
  fs.writeFileSync(path.join(foreign, 'SKILL.md'), 'NOT OURS', 'utf8');

  const out = runScript(UNINSTALL, home);
  assert.strictEqual(fs.existsSync(owned), false, 'owned dir removed by the bin');
  assert.ok(fs.existsSync(path.join(foreign, 'SKILL.md')), 'foreign dir survives the bin');
  assert.match(out, /left alone because this package did not install them/);
});

// --- persistence hook: settings.json merge ---------------------------------
// These run against FIXTURE settings files in a temp dir. The real
// ~/.claude/settings.json is never read or written by the battery.
const S = require('./settings');

function writeFixture(dir, obj) {
  const p = path.join(dir, 'settings.json');
  fs.writeFileSync(p, typeof obj === 'string' ? obj : JSON.stringify(obj, null, 2), 'utf8');
  return p;
}

const CAVEMAN_CMD = { type: 'command', command: 'node "C:/Users/x/.claude/hooks/caveman-mode-tracker.js"' };
const CAVEMAN_ENTRY = { hooks: [CAVEMAN_CMD] };

// The battery's isolation is load-bearing: several tests spawn bins that resolve
// their own paths. Assert the redirection actually works instead of trusting it,
// and refuse to run if a settings path ever resolves inside the real home.
// The real config this battery must never touch. Resolved once, with no override
// in effect, so it is the genuine ~/.claude/settings.json.
const REAL_CLAUDE_DIR = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');

test('battery isolation: path helpers honour CLAUDE_CONFIG_DIR', () => {
  // claudeHome() reads the env at CALL time, so set it around the call rather than
  // through freshLib (which restores the env before it returns).
  const lib = require('./lib');
  const fake = path.join(os.tmpdir(), 'distill-isolation-probe');
  const saved = process.env.CLAUDE_CONFIG_DIR;
  try {
    process.env.CLAUDE_CONFIG_DIR = fake;
    assert.strictEqual(lib.settingsPath(), path.join(fake, 'settings.json'),
      'settingsPath must follow CLAUDE_CONFIG_DIR, or the battery writes the real config');
    assert.strictEqual(lib.installedHookPath(), path.join(fake, 'hooks', 'distill-persist.js'));
    delete process.env.CLAUDE_CONFIG_DIR;
    assert.ok(lib.settingsPath().startsWith(os.homedir()),
      'without the override it resolves under the home dir (sanity check on the probe)');
  } finally {
    if (saved === undefined) delete process.env.CLAUDE_CONFIG_DIR;
    else process.env.CLAUDE_CONFIG_DIR = saved;
  }
});

// Guard: a settings fixture must never BE the real config. On Windows os.tmpdir()
// sits under the home dir, so "outside home" is the wrong invariant -- what matters
// is that the path is not inside the real Claude config dir.
function assertNotRealConfig(p) {
  const resolved = path.resolve(p);
  assert.ok(!resolved.toLowerCase().startsWith(path.resolve(REAL_CLAUDE_DIR).toLowerCase()),
    `refusing to run a settings test against the real Claude config: ${resolved}`);
}

test('T7 unwire preserves a CO-LOCATED third-party hook in the same entry', () => {
  // Claude Code groups several commands under one entry. Removing the whole entry
  // because it contains one of ours would delete a stranger's hook.
  const dir = tempHome('settings-colocated');
  const shared = { matcher: '', hooks: [CAVEMAN_CMD, { type: 'command', command: 'node "/h/distill-persist.js"' }] };
  const p = writeFixture(dir, { hooks: { UserPromptSubmit: [shared] } });
  assertNotRealConfig(p);

  const { settings } = S.readSettings(p);
  assert.strictEqual(S.unwire(settings), true);
  S.writeSettings(p, settings, { backup: false });

  const after = JSON.parse(fs.readFileSync(p, 'utf8'));
  assert.strictEqual(after.hooks.UserPromptSubmit.length, 1, 'entry survives');
  assert.deepStrictEqual(after.hooks.UserPromptSubmit[0].hooks, [CAVEMAN_CMD],
    'caveman command preserved, ours removed');
  assert.strictEqual(after.hooks.UserPromptSubmit[0].matcher, '', 'entry fields preserved');
});

test('HOOK_PATTERN does not claim an unrelated path containing the substring', () => {
  assert.strictEqual(S.isOurCommand({ command: 'node /opt/distill-persistence-analyzer/run.js' }), false);
  assert.strictEqual(S.isOurCommand({ command: 'node "/h/hooks/distill-persist.js"' }), true);
  assert.strictEqual(S.isOurCommand({ command: 'node /h/hooks/distill-persist.js' }), true);
});

test('a non-object hooks key or non-array event is refused, not overwritten', () => {
  const dir = tempHome('settings-shape');
  for (const bad of [{ hooks: [] }, { hooks: 'x' }, { hooks: { UserPromptSubmit: { a: 1 } } }]) {
    const p = path.join(dir, `bad-${Math.abs(JSON.stringify(bad).length)}.json`);
    const raw = JSON.stringify(bad, null, 2);
    fs.writeFileSync(p, raw, 'utf8');
    assert.throws(() => S.readSettings(p), /Refusing to modify it/, `should refuse: ${raw}`);
    assert.strictEqual(fs.readFileSync(p, 'utf8'), raw, 'left byte-identical');
  }
});

test('a concurrent modification between read and write is refused', () => {
  const dir = tempHome('settings-race');
  const p = writeFixture(dir, { model: 'opus' });
  const { settings, stamp } = S.readSettings(p);
  S.wire(settings, 'node "/h/distill-persist.js"');
  // Another writer lands first.
  fs.writeFileSync(p, JSON.stringify({ model: 'opus', statusLine: 'x' }, null, 2), 'utf8');
  assert.throws(() => S.writeSettings(p, settings, { expectStamp: stamp }), /changed on disk/);
  const after = JSON.parse(fs.readFileSync(p, 'utf8'));
  assert.strictEqual(after.statusLine, 'x', "the other writer's key survives");
});

test('a failed write leaves no temp file and does not truncate the target', () => {
  const dir = tempHome('settings-atomic');
  const p = writeFixture(dir, { model: 'opus' });
  const original = fs.readFileSync(p, 'utf8');
  // Circular structure makes JSON.stringify throw inside writeSettings.
  const circular = { model: 'opus' };
  circular.self = circular;
  assert.throws(() => S.writeSettings(p, circular, { backup: false }));
  assert.strictEqual(fs.readFileSync(p, 'utf8'), original, 'target intact');
  assert.strictEqual(fs.readdirSync(dir).filter((f) => f.endsWith('.distill-tmp')).length, 0,
    'no orphan temp file');
});

test('removePersistence unwires the entry AND deletes the hook script', () => {
  const home = tempHome('persist-remove');
  const sp = path.join(home, 'settings.json');
  assertNotRealConfig(sp);
  fs.writeFileSync(sp, JSON.stringify({ hooks: { UserPromptSubmit: [CAVEMAN_ENTRY] } }, null, 2), 'utf8');

  const out = execFileSync(process.execPath, ['-e', `
    process.env.CLAUDE_CONFIG_DIR = ${JSON.stringify(home)};
    const { removePersistence } = require(${JSON.stringify(path.join(__dirname, 'persistence.js'))});
    const fs = require('fs'), path = require('path');
    const hp = path.join(${JSON.stringify(home)}, 'hooks', 'distill-persist.js');
    fs.mkdirSync(path.dirname(hp), { recursive: true });
    fs.writeFileSync(hp, '// stub', 'utf8');
    const s = JSON.parse(fs.readFileSync(${JSON.stringify(sp)}, 'utf8'));
    s.hooks.UserPromptSubmit.push({ hooks: [{ type: 'command', command: 'node "' + hp.split('\\\\').join('/') + '"' }] });
    fs.writeFileSync(${JSON.stringify(sp)}, JSON.stringify(s, null, 2), 'utf8');
    const r = removePersistence(() => {});
    process.stdout.write(JSON.stringify({ r, fileGone: !fs.existsSync(hp) }));
  `], { encoding: 'utf8' });

  const { r, fileGone } = JSON.parse(out);
  assert.strictEqual(r.unwired, true, 'entry unwired');
  assert.strictEqual(r.fileRemoved, true, 'hook script deleted');
  assert.strictEqual(fileGone, true);
  const after = JSON.parse(fs.readFileSync(sp, 'utf8'));
  assert.deepStrictEqual(after.hooks.UserPromptSubmit, [CAVEMAN_ENTRY], 'caveman entry kept');
});

test('the uninstall bin unwires a hook even with no skills installed', () => {
  const home = tempHome('uninstall-unwires');
  const claude = path.join(home, '.claude');
  fs.mkdirSync(path.join(claude, 'hooks'), { recursive: true });
  const hp = path.join(claude, 'hooks', 'distill-persist.js');
  fs.writeFileSync(hp, '// stub', 'utf8');
  const sp = path.join(claude, 'settings.json');
  assertNotRealConfig(sp);
  fs.writeFileSync(sp, JSON.stringify({
    hooks: { UserPromptSubmit: [{ hooks: [{ type: 'command', command: `node "${hp.split('\\').join('/')}"` }] }] },
  }, null, 2), 'utf8');

  runScript(UNINSTALL, home);
  const after = JSON.parse(fs.readFileSync(sp, 'utf8'));
  assert.strictEqual(after.hooks, undefined, 'our entry removed and empty scaffolding pruned');
  assert.strictEqual(fs.existsSync(hp), false, 'hook script removed');
});

// --- §6 checks + Stop-hook gate (phase 1, observational) --------------------
const CHECKS = require('../hooks/checks');
const GATE = path.join(__dirname, '..', 'hooks', 'distill-gate.js');

function ids(text) {
  return CHECKS.runChecks(text).findings.map((f) => f.id).sort();
}

test('each §6 check fires on its positive fixture', () => {
  // Single-purpose fixture: "Ecco cosa ho trovato" would legitimately also trip status_line.
  assert.deepStrictEqual(ids('Certamente! Il progetto è uno scheletro mai collegato.'), ['ceremonial_opener']);
  assert.deepStrictEqual(ids('Ho letto la skill e l\'ho applicata. Il progetto è uno scheletro.'),
    ['compliance_announcement']);
  // Recall matters more than precision here: the corpus shape is "Ho letto TUTTO IL
  // PROGETTO" / "Ho esaminato", which an earlier draft requiring "Ho letto la|e" missed.
  assert.deepStrictEqual(ids('Ho letto tutto il progetto — sono solo 3 file.'), ['compliance_announcement']);
  assert.deepStrictEqual(ids('Ho esaminato il progetto e conta 30 righe.'), ['compliance_announcement']);
  assert.deepStrictEqual(ids('I have reviewed the project. It is a skeleton.'), ['compliance_announcement']);
  // status_line sits mid-line, so a start-anchored pattern cannot catch it.
  assert.deepStrictEqual(ids('Il progetto è minuscolo. Ecco il quadro completo.'), ['status_line']);
  assert.deepStrictEqual(ids('Procedo ora a elencare i difetti trovati nel modulo.'), ['meta_narration']);
  assert.deepStrictEqual(ids('Il fix potrebbe forse risolvere il problema in alcuni casi.'), ['hedging_chain']);
  assert.deepStrictEqual(ids('Il flusso e semplice: initApp chiama fetchData poi renderData scrive.\ninitApp -> fetchData -> renderData'),
    ['arrow_chain']);
  assert.deepStrictEqual(ids('Il sistema e robusto e ben progettato.'), ['unsupported_adjective']);
});

test('repeated_sentence fires only on a long exact repeat', () => {
  const long = 'La misura mostra che la perdita bloccante e simmetrica tra i due bracci.';
  assert.deepStrictEqual(ids(`${long} Altro testo qui in mezzo. ${long}`), ['repeated_sentence']);
  // Short repeats are legitimate and must not fire.
  assert.deepStrictEqual(ids('Va bene. Qualcosa in mezzo. Va bene.'), []);
});

test('clean prose produces no findings', () => {
  assert.deepStrictEqual(
    ids('Il blocco fallisce perche unwire rimuove l\'intera voce invece del singolo comando. Il fix filtra a livello di hook.'),
    [],
  );
});

test('code blocks are immune — the false positives I expect', () => {
  // An arrow chain inside a fenced block is a diagram, not mutilating compression.
  assert.deepStrictEqual(ids('Il flusso e descritto sotto.\n\n```\nA -> B -> C\n```\n'), []);
  // ...and inline code.
  assert.deepStrictEqual(ids('Vedi `initApp -> fetchData -> renderData` nel sorgente.'), []);
  // A quoted line (blockquote) is source material, not our prose.
  assert.deepStrictEqual(ids('> Certamente! Ecco la risposta.\n\nQuesto e cio che ha risposto.'), []);
  // A markdown table row must not trip the arrow chain.
  assert.deepStrictEqual(ids('| da | a |\n| A -> B -> C | x |'), []);
});

test('gate never blocks: no block path exists in the source', () => {
  // Strip comments first: the file *documents* what it refuses to do, and the assertion
  // is about executable code, not about prose describing it.
  const src = fs.readFileSync(GATE, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/^\s*\/\/.*$/gm, ' ');
  assert.ok(!/decision["']?\s*:\s*["']block/.test(src), 'phase 1 must contain no block decision');
  assert.ok(!/process\.exit\(\s*[1-9]/.test(src), 'phase 1 must never exit non-zero');
  // And prove it behaviourally, not only by inspection.
  const home = tempHome('gate-exit');
  const r = execFileSync(process.execPath, [GATE], {
    input: JSON.stringify({ last_assistant_message: 'Certamente! ' + 'parola '.repeat(500) }),
    encoding: 'utf8', env: { ...process.env, CLAUDE_CONFIG_DIR: home },
  });
  assert.strictEqual(r, '', 'even a maximally-flagged message produces no stdout');
});

test('gate logs findings without ever recording the message body', () => {
  const home = tempHome('gate-log');
  assertNotRealConfig(path.join(home, 'settings.json'));
  const secret = 'CONFIDENZIALE-CANARINO-9973 dettagli privati della conversazione';
  const payload = JSON.stringify({
    hook_event_name: 'Stop',
    prompt_id: 'pid-1',
    stop_reason: 'end_turn',
    stop_hook_active: false,
    last_assistant_message: `Certamente! ${secret}`,
  });

  const res = execFileSync(process.execPath, [GATE], {
    input: payload,
    encoding: 'utf8',
    env: { ...process.env, CLAUDE_CONFIG_DIR: home, DISTILL_GATE_LOG: '1' },
  });
  assert.strictEqual(res, '', 'a phase-1 gate must emit nothing on stdout');

  const logPath = path.join(home, 'distill', 'gate-log.jsonl');
  assert.ok(fs.existsSync(logPath), 'log line appended');
  const raw = fs.readFileSync(logPath, 'utf8');
  assert.ok(!raw.includes('CONFIDENZIALE-CANARINO-9973'),
    'T14: the message body must never reach the log');
  const entry = JSON.parse(raw.trim());
  assert.deepStrictEqual(entry.findings.map((f) => f.id), ['ceremonial_opener']);
  assert.strictEqual(entry.would_block, true);
  assert.ok(entry.words > 0);
  for (const f of entry.findings) {
    assert.ok(f.excerpt.length <= CHECKS.EXCERPT_MAX, 'excerpt stays capped');
  }
});

test('gate is OFF by default: no env var, no file, no read of the message', () => {
  const home = tempHome('gate-optout');
  const env = { ...process.env, CLAUDE_CONFIG_DIR: home };
  delete env.DISTILL_GATE_LOG;
  const out = execFileSync(process.execPath, [GATE], {
    input: JSON.stringify({ last_assistant_message: 'Certamente! Ecco la risposta.' }),
    encoding: 'utf8',
    env,
  });
  assert.strictEqual(out, '', 'silent');
  assert.strictEqual(fs.existsSync(path.join(home, 'distill')), false,
    'without opt-in the hook must not even create its directory');

  // An explicit value other than "1" is also off — no accidental truthiness.
  for (const v of ['0', 'true', 'yes', '']) {
    execFileSync(process.execPath, [GATE], {
      input: JSON.stringify({ last_assistant_message: 'Certamente! test' }),
      encoding: 'utf8',
      env: { ...process.env, CLAUDE_CONFIG_DIR: home, DISTILL_GATE_LOG: v },
    });
    assert.strictEqual(fs.existsSync(path.join(home, 'distill')), false,
      `DISTILL_GATE_LOG=${JSON.stringify(v)} must not enable logging`);
  }
});

test('gate records stop_hook_active instead of short-circuiting on it', () => {
  // `stop_hook_active` means "some Stop hook is configured to block", not "this hook already
  // blocked". Phase 1 never blocks, so it must keep logging regardless -- otherwise any
  // unrelated blocking Stop hook on the machine silently starves the data collection.
  const home = tempHome('gate-active');
  const out = execFileSync(process.execPath, [GATE], {
    input: JSON.stringify({ stop_hook_active: true, last_assistant_message: 'Certamente! test' }),
    encoding: 'utf8',
    env: { ...process.env, CLAUDE_CONFIG_DIR: home, DISTILL_GATE_LOG: '1' },
  });
  assert.strictEqual(out, '', 'still no stdout: phase 1 never blocks');

  const logPath = path.join(home, 'distill', 'gate-log.jsonl');
  assert.ok(fs.existsSync(logPath), 'a flagged message must be logged even when the flag is set');
  const entry = JSON.parse(fs.readFileSync(logPath, 'utf8').trim().split('\n').pop());
  assert.strictEqual(entry.stop_hook_active, true, 'the flag is recorded for phase 2 to reason about');
  assert.strictEqual(entry.would_block, true, 'and it is still only an observation');
});

test('gate survives malformed stdin', () => {
  const home = tempHome('gate-junk');
  for (const junk of ['', 'not json', '[]', 'null', '{"last_assistant_message":42}']) {
    const out = execFileSync(process.execPath, [GATE], {
      input: junk, encoding: 'utf8', env: { ...process.env, CLAUDE_CONFIG_DIR: home },
    });
    assert.strictEqual(out, '', `must stay silent on: ${junk}`);
  }
});

// --- Claude Code plugin channel --------------------------------------------
test('hooks live in hooks/hooks.json, the channel every first-party plugin uses', () => {
  // Anthropic's own ralph-loop, hookify, security-guidance and the two output-style plugins all
  // declare hooks in hooks/hooks.json and none of them puts a `hooks` key in plugin.json.
  // The client loads that file automatically. Full write-up in the CHANGELOG, 0.4.1.
  const root = path.join(__dirname, '..');
  const manifest = JSON.parse(fs.readFileSync(path.join(root, '.claude-plugin', 'plugin.json'), 'utf8'));
  assert.strictEqual(manifest.name, 'distill');
  assert.ok(!('hooks' in manifest),
    'plugin.json must stay metadata-only: the two channels MERGE, so declaring here too registers twice');

  const cfg = JSON.parse(fs.readFileSync(path.join(root, 'hooks', 'hooks.json'), 'utf8'));
  assert.ok(cfg.hooks, 'the file needs the top-level `hooks` wrapper key or it parses to undefined');

  for (const event of ['UserPromptSubmit', 'Stop']) {
    const entries = cfg.hooks[event];
    assert.ok(Array.isArray(entries) && entries.length > 0, `must declare a ${event} hook`);
    const cmd = entries[0].hooks[0].command;
    assert.match(cmd, /\$\{CLAUDE_PLUGIN_ROOT\}/,
      `${event} must resolve through \${CLAUDE_PLUGIN_ROOT}, not an absolute path`);
    // The referenced script must actually exist at that location in the repo...
    const rel = cmd.match(/\$\{CLAUDE_PLUGIN_ROOT\}\/([^"]+)/)[1];
    assert.ok(fs.existsSync(path.join(root, rel)), `${event} points at a missing file: ${rel}`);
    // ...and must survive `npm pack`. Existing on disk is not enough: a file absent from
    // package.json `files` ships as a plugin whose hooks silently do nothing, which is the
    // exact failure 0.4.1 exists to fix.
    const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
    assert.ok(pkg.files.includes(rel), `${event} target is not in package.json files: ${rel}`);
  }

  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  assert.ok(pkg.files.includes('hooks/hooks.json'),
    'the hook config itself must ship, or the published plugin declares no hooks at all');
});

test('marketplace manifest carries no key the validator rejects', () => {
  // `claude plugin validate` fails on `$schema` and a root `description`; the description
  // belongs under `metadata`. This manifest failed validation from the day it was written.
  const root = path.join(__dirname, '..');
  const mkt = JSON.parse(fs.readFileSync(path.join(root, '.claude-plugin', 'marketplace.json'), 'utf8'));
  assert.ok(!('$schema' in mkt), '`$schema` is an unrecognized key at marketplace root');
  assert.ok(!('description' in mkt), 'root `description` is rejected; use metadata.description');
  assert.ok(mkt.metadata && typeof mkt.metadata.description === 'string');
});

test('marketplace manifest parses and points at this repo', () => {
  const root = path.join(__dirname, '..');
  const mkt = JSON.parse(fs.readFileSync(path.join(root, '.claude-plugin', 'marketplace.json'), 'utf8'));
  assert.ok(Array.isArray(mkt.plugins) && mkt.plugins.length === 1);
  assert.strictEqual(mkt.plugins[0].name, 'distill');
  assert.strictEqual(mkt.plugins[0].source, './');
});

test('the skill sits where the plugin convention requires', () => {
  // Verified against the official discord/imessage/telegram plugins: skills/<name>/SKILL.md
  const root = path.join(__dirname, '..');
  assert.ok(fs.existsSync(path.join(root, 'skills', 'distill', 'SKILL.md')));
});

test('every declared bin points at a file that exists, and enable is gone', () => {
  const root = path.join(__dirname, '..');
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  for (const [name, rel] of Object.entries(pkg.bin)) {
    assert.ok(fs.existsSync(path.join(root, rel)), `bin ${name} points at missing ${rel}`);
  }
  assert.ok(!('distill-enable-persistence' in pkg.bin),
    'the settings.json enable path is superseded by the plugin manifest');
  // Everything in `files` must exist too, or the tarball silently ships short.
  for (const rel of pkg.files) {
    assert.ok(fs.existsSync(path.join(root, rel)), `files entry missing on disk: ${rel}`);
  }
});

test('every bump point states the same version, SKILL.md included', () => {
  // What a client actually gets is ONE file: skills/distill/SKILL.md. No
  // package.json, no gemini-extension.json, no plugin.json. Without a version in
  // its frontmatter nothing in an installed copy says which build it is, and
  // answering "is that fix in yours?" takes `npm view` plus a shasum compare.
  // The string alone would rot, so what is asserted is the SYNC.
  const root = path.join(__dirname, '..');
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  for (const rel of ['gemini-extension.json', path.join('.claude-plugin', 'plugin.json')]) {
    const manifest = JSON.parse(fs.readFileSync(path.join(root, rel), 'utf8'));
    assert.strictEqual(manifest.version, pkg.version, `${rel} version drifted`);
  }
  const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8');
  assert.ok(readme.includes(`Version ${pkg.version}`), `README does not state Version ${pkg.version}`);
  const skill = fs.readFileSync(path.join(root, 'skills', 'distill', 'SKILL.md'), 'utf8');
  const m = skill.match(/^version:\s*(\S+)\s*$/m);
  assert.ok(m, 'SKILL.md frontmatter must carry `version:` — it is the only file a client gets');
  assert.strictEqual(m[1], pkg.version,
    `SKILL.md says ${m[1]} and package.json says ${pkg.version}: a version the reader cannot trust is worse than none`);
});

test('T7 wiring appends and leaves another tool\'s hook byte-identical', () => {
  const dir = tempHome('settings-merge');
  const p = writeFixture(dir, { hooks: { UserPromptSubmit: [CAVEMAN_ENTRY] }, model: 'opus' });
  assertNotRealConfig(p);

  const { settings } = S.readSettings(p);
  assert.strictEqual(S.wire(settings, 'node "/h/distill-persist.js"'), true);
  S.writeSettings(p, settings);

  const after = JSON.parse(fs.readFileSync(p, 'utf8'));
  assert.strictEqual(after.hooks.UserPromptSubmit.length, 2, 'appended, not replaced');
  assert.deepStrictEqual(after.hooks.UserPromptSubmit[0], CAVEMAN_ENTRY, 'caveman entry untouched');
  assert.strictEqual(after.model, 'opus', 'unrelated keys preserved');
  assert.ok(S.isWired(after));
});

test('T9 wiring is idempotent', () => {
  const dir = tempHome('settings-idem');
  const p = writeFixture(dir, { hooks: { UserPromptSubmit: [CAVEMAN_ENTRY] } });
  const { settings } = S.readSettings(p);
  S.wire(settings, 'node "/h/distill-persist.js"');
  S.writeSettings(p, settings);

  const { settings: second } = S.readSettings(p);
  assert.strictEqual(S.wire(second, 'node "/h/distill-persist.js"'), false, 'second wire is a no-op');
  assert.strictEqual(second.hooks.UserPromptSubmit.length, 2, 'no duplicate entry');
});

test('a backup is written before any modification', () => {
  const dir = tempHome('settings-backup');
  const p = writeFixture(dir, { hooks: {}, model: 'opus' });
  const original = fs.readFileSync(p, 'utf8');

  const { settings } = S.readSettings(p);
  S.wire(settings, 'node "/h/distill-persist.js"');
  S.writeSettings(p, settings);

  const backups = fs.readdirSync(dir).filter((f) => f.includes('distill-backup'));
  assert.strictEqual(backups.length, 1, 'exactly one backup');
  assert.strictEqual(fs.readFileSync(path.join(dir, backups[0]), 'utf8'), original,
    'backup holds the pre-modification content');
});

test('T6 malformed settings are refused, not overwritten', () => {
  const dir = tempHome('settings-broken');
  const broken = '{ "hooks": { oops not json';
  const p = writeFixture(dir, broken);

  assert.throws(() => S.readSettings(p), /not valid JSON/);
  assert.strictEqual(fs.readFileSync(p, 'utf8'), broken, 'file left byte-identical');

  // A JSON array is valid JSON but the wrong shape -- also refused.
  const p2 = path.join(dir, 'arr.json');
  fs.writeFileSync(p2, '[]', 'utf8');
  assert.throws(() => S.readSettings(p2), /does not contain a JSON object/);
});

test('unwire removes only our entry and prunes what we emptied', () => {
  const dir = tempHome('settings-unwire');
  const p = writeFixture(dir, { hooks: { UserPromptSubmit: [CAVEMAN_ENTRY] } });
  const { settings } = S.readSettings(p);
  S.wire(settings, 'node "/h/distill-persist.js"');
  S.writeSettings(p, settings);

  const { settings: loaded } = S.readSettings(p);
  assert.strictEqual(S.unwire(loaded), true);
  S.writeSettings(p, loaded);

  const after = JSON.parse(fs.readFileSync(p, 'utf8'));
  assert.strictEqual(after.hooks.UserPromptSubmit.length, 1, 'ours gone');
  assert.deepStrictEqual(after.hooks.UserPromptSubmit[0], CAVEMAN_ENTRY, 'theirs kept');
  assert.strictEqual(S.unwire(after), false, 'second unwire is a no-op');
});

test('unwire on a file that only ever had our entry leaves no empty scaffolding', () => {
  const dir = tempHome('settings-prune');
  const p = writeFixture(dir, { model: 'opus' });
  const { settings } = S.readSettings(p);
  S.wire(settings, 'node "/h/distill-persist.js"');
  S.unwire(settings);
  assert.strictEqual(settings.hooks, undefined, 'hooks key removed when we emptied it');
  assert.strictEqual(settings.model, 'opus', 'unrelated keys survive');
});

test('the hook emits one line of additionalContext and exits 0', () => {
  const out = execFileSync(process.execPath, [path.join(__dirname, '..', 'hooks', 'distill-persist.js')], {
    encoding: 'utf8',
    // Isolated home + update lane off: the baseline payload must not depend on
    // any real update-check cache on the machine running the battery.
    env: { ...process.env, CLAUDE_CONFIG_DIR: tempHome('hook-baseline'), DISTILL_NO_UPDATE_CHECK: '1' },
  });
  const parsed = JSON.parse(out);
  assert.strictEqual(parsed.hookSpecificOutput.hookEventName, 'UserPromptSubmit');
  const ctx = parsed.hookSpecificOutput.additionalContext;
  assert.match(ctx, /^distill/, 'must identify its source among other tools\' hooks');
  assert.strictEqual(ctx.split('\n').length, 1, 'payload must stay one line');
  assert.ok(ctx.length < 260, `payload must stay small, got ${ctx.length} chars`);
  // The payload must stand alone: the skill body is not loaded on most turns, so naming
  // its internal machinery would instruct the agent to run a procedure it has not read.
  for (const jargon of ['contract', 'the gate', 'payload', 'distillate']) {
    assert.ok(!ctx.toLowerCase().includes(jargon),
      `payload must not rely on skill-internal term "${jargon}"`);
  }
});

test('T2 uninstall leaves an unowned skill dir untouched', () => {
  const home = tempHome('preserve');
  const target = path.join(home, '.claude', 'skills', 'distill');
  fs.mkdirSync(target, { recursive: true });
  fs.writeFileSync(path.join(target, 'SKILL.md'), 'NOT OURS', 'utf8');

  const out = runScript(PREUNINSTALL, home);
  assert.match(out, /Left .* in place/);
  assert.ok(fs.existsSync(path.join(target, 'SKILL.md')), 'unowned dir must survive uninstall');
});

// --- update lane (0.6.0): worker + notification ------------------------------

const PERSIST_HOOK = path.join(__dirname, '..', 'hooks', 'distill-persist.js');
const UPDATE_WORKER = path.join(__dirname, '..', 'hooks', 'update-check.js');
const { cmpVersions, shouldCheck, CHECK_INTERVAL_MS } = require('../hooks/update-check');

// Every hook run in these tests keeps `checkedAt` fresh in the fixture cache, so
// the hook never spawns a live worker (a real worker would hit the registry).
function writeUpdateCache(home, cache) {
  const dir = path.join(home, 'distill');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'update-check.json'), JSON.stringify(cache), 'utf8');
}
function readUpdateCache(home) {
  return JSON.parse(fs.readFileSync(path.join(home, 'distill', 'update-check.json'), 'utf8'));
}
function runPersistHook(env) {
  const out = execFileSync(process.execPath, [PERSIST_HOOK], {
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
  return JSON.parse(out).hookSpecificOutput.additionalContext;
}

test('cmpVersions compares numerically and treats malformed input as equal', () => {
  assert.ok(cmpVersions('0.5.0', '0.6.0') < 0);
  assert.ok(cmpVersions('0.6.0', '0.5.0') > 0);
  assert.strictEqual(cmpVersions('1.2.3', '1.2.3'), 0);
  assert.ok(cmpVersions('0.9.0', '0.10.0') < 0, 'numeric, not lexicographic');
  // Malformed must mean "no action", never a notification.
  assert.strictEqual(cmpVersions('abc', '1.0.0'), 0);
  assert.strictEqual(cmpVersions('1.0', '1.0.0'), 0);
});

test('shouldCheck: missing or stale cache checks, a fresh one does not', () => {
  const now = Date.now();
  assert.strictEqual(shouldCheck(null, now), true);
  assert.strictEqual(shouldCheck({}, now), true);
  assert.strictEqual(shouldCheck({ checkedAt: 'not-a-date' }, now), true);
  assert.strictEqual(shouldCheck({ checkedAt: new Date(now - 1000).toISOString() }, now), false);
  assert.strictEqual(
    shouldCheck({ checkedAt: new Date(now - CHECK_INTERVAL_MS - 1000).toISOString() }, now), true);
});

test('DISTILL_NO_UPDATE_CHECK=1 stops the worker before any network or write', () => {
  const home = tempHome('worker-off');
  execFileSync(process.execPath, [UPDATE_WORKER], {
    env: { ...process.env, CLAUDE_CONFIG_DIR: home, DISTILL_NO_UPDATE_CHECK: '1' },
  });
  assert.ok(!fs.existsSync(path.join(home, 'distill', 'update-check.json')),
    'opted-out worker must not create the cache file');
});

test('a newer cached version adds ONE notification line, once', () => {
  const home = tempHome('notify');
  writeUpdateCache(home, {
    checkedAt: new Date().toISOString(), latest: '99.0.0', notified: null, updatedTo: null,
  });

  const first = runPersistHook({ CLAUDE_CONFIG_DIR: home });
  const lines = first.split('\n');
  assert.strictEqual(lines.length, 2, 'reminder + one notification line');
  assert.match(lines[0], /^distill/, 'first line stays the untouched reminder');
  assert.ok(lines[0].length < 260, 'reminder budget unchanged by the lane');
  assert.match(lines[1], /99\.0\.0/);
  assert.match(lines[1], /update/i);
  assert.strictEqual(readUpdateCache(home).notified, '99.0.0', 'marker persisted');

  const second = runPersistHook({ CLAUDE_CONFIG_DIR: home });
  assert.strictEqual(second.split('\n').length, 1, 'same version never announces twice');
});

test('an auto-installed version announces the restart instead of the update', () => {
  const home = tempHome('notify-updated');
  writeUpdateCache(home, {
    checkedAt: new Date().toISOString(), latest: '99.0.0', notified: null, updatedTo: '99.0.0',
  });
  const ctx = runPersistHook({ CLAUDE_CONFIG_DIR: home });
  const lines = ctx.split('\n');
  assert.strictEqual(lines.length, 2);
  assert.match(lines[1], /restart/i);
});

test('DISTILL_NO_UPDATE_CHECK=1 silences the notification lane in the hook too', () => {
  const home = tempHome('notify-off');
  writeUpdateCache(home, {
    checkedAt: new Date().toISOString(), latest: '99.0.0', notified: null, updatedTo: null,
  });
  const ctx = runPersistHook({ CLAUDE_CONFIG_DIR: home, DISTILL_NO_UPDATE_CHECK: '1' });
  assert.strictEqual(ctx.split('\n').length, 1);
});

test('an equal or older cached version adds nothing', () => {
  const home = tempHome('notify-equal');
  writeUpdateCache(home, {
    checkedAt: new Date().toISOString(), latest: '0.0.1', notified: null, updatedTo: null,
  });
  const ctx = runPersistHook({ CLAUDE_CONFIG_DIR: home });
  assert.strictEqual(ctx.split('\n').length, 1);
});
