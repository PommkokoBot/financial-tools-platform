#!/usr/bin/env node
// Promotes the current index.html to be the regression baseline.
//
// Run this ONLY when releasing a version you have verified -- the baseline is
// what proves future changes did not move the numbers, so promoting an unverified
// build silently blesses whatever it got wrong. Old baselines are not kept as
// files; git history and release tags are the archive.
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { APP, BASELINE, requireFile } = require('../lib/paths');

const r = spawnSync(process.execPath, [path.join(__dirname, '..', 'run-unit.js')], { stdio: 'inherit' });
if (r.status !== 0) {
  console.error('\nRefusing to update the baseline: the suites do not pass against the current index.html.');
  process.exit(1);
}

fs.copyFileSync(requireFile(APP, 'app under test'), BASELINE);
console.log(`\nBaseline updated from ${APP}\n  -> ${BASELINE}\nCommit it together with the release.`);
