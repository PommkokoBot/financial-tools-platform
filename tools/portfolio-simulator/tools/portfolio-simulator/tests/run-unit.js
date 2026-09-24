#!/usr/bin/env node
// Runs every jsdom suite in a child process and aggregates the exit codes.
//
// Each suite gets its own process on purpose: they all build a full jsdom window
// and replace Math.random with a seeded PRNG, so sharing one process would let
// one suite's global state leak into the next and make a failure impossible to
// attribute. Slower to start, but a red result always means what it says.
const { spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const UNIT_DIR = path.join(__dirname, 'unit');
const only = process.argv[2]; // optional substring filter: npm test -- case

const suites = fs.readdirSync(UNIT_DIR)
  .filter(f => f.endsWith('.test.js'))
  .filter(f => !only || f.includes(only))
  .sort();

if (!suites.length) {
  console.error(only ? `No suite matches "${only}"` : 'No suites found');
  process.exit(1);
}

const results = [];
for (const file of suites) {
  const started = Date.now();
  process.stdout.write(`\n\x1b[1m▶ ${file}\x1b[0m\n`);
  const r = spawnSync(process.execPath, [path.join(UNIT_DIR, file)], {
    stdio: ['ignore', 'pipe', 'pipe'],
    encoding: 'utf8',
    env: process.env,
  });
  const secs = ((Date.now() - started) / 1000).toFixed(1);
  const out = (r.stdout || '') + (r.stderr || '');
  const ok = r.status === 0;

  // Suites print their own detail; echo it in full on failure, summarise on pass.
  if (ok) {
    const summary = out.split('\n').filter(l => /PASS|OK |ALL IDENTICAL|✅/.test(l)).slice(-3).join('\n');
    if (summary) console.log(summary);
  } else {
    console.log(out);
  }
  console.log(`${ok ? '\x1b[32m✔ pass\x1b[0m' : '\x1b[31m✘ FAIL\x1b[0m'}  ${file}  (${secs}s)`);
  results.push({ file, ok, secs });
}

const failed = results.filter(r => !r.ok);
console.log('\n' + '─'.repeat(58));
for (const r of results) console.log(`  ${r.ok ? '✔' : '✘'}  ${r.file.padEnd(34)} ${r.secs}s`);
console.log('─'.repeat(58));
console.log(failed.length
  ? `\x1b[31m${failed.length} of ${results.length} suites FAILED\x1b[0m`
  : `\x1b[32mall ${results.length} suites passed\x1b[0m`);

process.exit(failed.length ? 1 : 0);
