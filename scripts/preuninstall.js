#!/usr/bin/env node
// npm `preuninstall` hook -- BEST EFFORT ONLY.
//
// npm has not run this lifecycle script since v7 (confirmed on 11.9.0: an
// isolated `npm uninstall -g` left every installed skill directory in place).
// It is kept for older npm versions and for anything that still honours it.
// The supported removal path is the `distill-uninstall-skill` bin, which shares
// the same ownership-checked implementation in lib.js.

const { CLIENTS, removeSkill } = require('./lib');
const { removePersistence } = require('./persistence');

CLIENTS.forEach((client) => removeSkill(client));

// Also unwire the hook: leaving it wired after the package is gone would inject
// on every prompt with no way to turn it off via the (now absent) bins.
removePersistence();
