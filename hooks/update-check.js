#!/usr/bin/env node
// Detached update worker, spawned by distill-persist.js at most once per day.
// Never runs in the prompt path: the hook only reads the cache file this worker
// writes, so a slow registry can never slow a turn.
//
// Plugin channel only. The npm channel copies the persist hook alone into
// ~/.claude/hooks, so this file is absent there and the hook never spawns it;
// this worker double-checks by requiring ../.claude-plugin/plugin.json (the
// installed plugin's own manifest) for the local version, and exits when it is
// not there.
//
// Env contract (all read here AND honoured by the hook before spawning):
//   DISTILL_NO_UPDATE_CHECK=1  -> no network, no cache write, exit 0.
//   DISTILL_AUTO_UPDATE=1      -> opt-IN: on a newer version, run the client's
//                                 own update commands. Default is notify-only:
//                                 auto-update means executing newly published
//                                 code without a per-version consent, so it is
//                                 never the default.
//
// What leaves the machine: one anonymous GET of the package metadata to
// registry.npmjs.org — the same request `npm install` makes. Nothing else;
// nothing about the user or the session is sent. Declared in the README next
// to the gate-log policy.

const fs = require('fs');
const os = require('os');
const path = require('path');

const REGISTRY_URL = 'https://registry.npmjs.org/@antoneeo/distill-skill/latest';
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;

function claudeHome() {
  return process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
}
function cacheFile() {
  return path.join(claudeHome(), 'distill', 'update-check.json');
}

// 'x.y.z' numeric compare: negative when a < b, 0 on equal OR on any malformed
// input — an unparseable version must produce "no action", never a notification.
function cmpVersions(a, b) {
  const pa = String(a).split('.').map(Number);
  const pb = String(b).split('.').map(Number);
  if (pa.length !== 3 || pb.length !== 3 || pa.concat(pb).some(Number.isNaN)) return 0;
  for (let i = 0; i < 3; i++) {
    if (pa[i] !== pb[i]) return pa[i] - pb[i];
  }
  return 0;
}

function shouldCheck(cache, nowMs) {
  if (!cache || typeof cache.checkedAt !== 'string') return true;
  const t = Date.parse(cache.checkedAt);
  if (Number.isNaN(t)) return true;
  return nowMs - t > CHECK_INTERVAL_MS;
}

function readCache() {
  try {
    const parsed = JSON.parse(fs.readFileSync(cacheFile(), 'utf8'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch (e) {
    return null;
  }
}

function writeCache(cache) {
  const file = cacheFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(cache, null, 2)}\n`, 'utf8');
}

function localVersion() {
  try {
    const manifest = path.join(__dirname, '..', '.claude-plugin', 'plugin.json');
    const parsed = JSON.parse(fs.readFileSync(manifest, 'utf8'));
    return typeof parsed.version === 'string' ? parsed.version : null;
  } catch (e) {
    return null;   // npm channel, or a build with no manifest: not our lane
  }
}

function fetchLatest(cb) {
  const https = require('https');
  const req = https.get(REGISTRY_URL, { timeout: 5000 }, (res) => {
    if (res.statusCode !== 200) { res.resume(); return cb(null); }
    let body = '';
    res.setEncoding('utf8');
    res.on('data', (chunk) => { body += chunk; });
    res.on('end', () => {
      try {
        const v = JSON.parse(body).version;
        cb(typeof v === 'string' ? v : null);
      } catch (e) { cb(null); }
    });
  });
  req.on('timeout', () => req.destroy());
  req.on('error', () => cb(null));
}

// The client's own update path, exactly the two commands a user would run.
// shell:false always; a failure (claude not on PATH, no network, declined) is
// silent — the notification lane still informs on the next prompt.
function runAutoUpdate() {
  const { execFileSync } = require('child_process');
  const opts = { stdio: 'ignore', timeout: 120000, shell: false };
  execFileSync('claude', ['plugin', 'marketplace', 'update', 'distill'], opts);
  execFileSync('claude', ['plugin', 'update', 'distill@distill'], opts);
}

function main() {
  if (process.env.DISTILL_NO_UPDATE_CHECK === '1') return;
  const local = localVersion();
  if (!local) return;

  const prev = readCache() || {};
  if (!shouldCheck(prev, Date.now())) return;

  fetchLatest((latest) => {
    try {
      const cache = {
        checkedAt: new Date().toISOString(),
        latest: latest || prev.latest || null,
        notified: prev.notified || null,
        updatedTo: prev.updatedTo || null,
      };
      if (latest && cmpVersions(local, latest) < 0
          && process.env.DISTILL_AUTO_UPDATE === '1'
          && cache.updatedTo !== latest) {
        try {
          runAutoUpdate();
          cache.updatedTo = latest;   // set ONLY after both commands succeeded
        } catch (e) { /* notify lane covers it */ }
      }
      writeCache(cache);
    } catch (e) { /* best effort: a missing cache line is the acceptable failure */ }
  });
}

module.exports = { cmpVersions, shouldCheck, CHECK_INTERVAL_MS, REGISTRY_URL };

if (require.main === module) {
  try { main(); } catch (e) { /* never surface: nothing here may break a session */ }
}
