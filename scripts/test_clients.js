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

test('T2 uninstall leaves an unowned skill dir untouched', () => {
  const home = tempHome('preserve');
  const target = path.join(home, '.claude', 'skills', 'distill');
  fs.mkdirSync(target, { recursive: true });
  fs.writeFileSync(path.join(target, 'SKILL.md'), 'NOT OURS', 'utf8');

  const out = runScript(PREUNINSTALL, home);
  assert.match(out, /Left .* in place/);
  assert.ok(fs.existsSync(path.join(target, 'SKILL.md')), 'unowned dir must survive uninstall');
});
