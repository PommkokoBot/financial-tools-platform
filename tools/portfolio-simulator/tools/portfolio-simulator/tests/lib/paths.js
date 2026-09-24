// Single source of truth for every path the test suites touch.
// Nothing in tests/ may hardcode an absolute path -- resolve it from here instead,
// so the suites run from any checkout and in CI.
const path = require('path');
const fs = require('fs');

const TESTS_DIR = path.resolve(__dirname, '..');          // tools/portfolio-simulator/tests
const TOOL_DIR = path.resolve(TESTS_DIR, '..');           // tools/portfolio-simulator
const REPO_ROOT = path.resolve(TOOL_DIR, '..', '..');     // repo root

// The app under test. Override with SIM_APP_FILE to test a candidate build
// without moving it into place first.
const APP = process.env.SIM_APP_FILE
  ? path.resolve(process.env.SIM_APP_FILE)
  : path.join(TOOL_DIR, 'index.html');

// The last released build. regression.test.js runs BOTH files through the same
// harness with the same seed and diffs the engine output field by field, so a
// harness change can never masquerade as an app change. See baseline/README.md.
const BASELINE = process.env.SIM_BASELINE_FILE
  ? path.resolve(process.env.SIM_BASELINE_FILE)
  : path.join(TESTS_DIR, 'baseline', 'portfolio-simulator.baseline.html');

// Scratch output (screenshots, generated xlsx/pdf). Git-ignored.
const OUT_DIR = process.env.SIM_OUT_DIR
  ? path.resolve(process.env.SIM_OUT_DIR)
  : path.join(TESTS_DIR, '.out');

const NODE_MODULES = path.join(TOOL_DIR, 'node_modules');

function ensureOut(sub) {
  const dir = sub ? path.join(OUT_DIR, sub) : OUT_DIR;
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function requireFile(p, what) {
  if (!fs.existsSync(p)) {
    throw new Error(`${what} not found at ${p}\n` +
      `Run the suites from tools/portfolio-simulator (npm test), or point SIM_APP_FILE / SIM_BASELINE_FILE at it.`);
  }
  return p;
}

module.exports = { TESTS_DIR, TOOL_DIR, REPO_ROOT, APP, BASELINE, OUT_DIR, NODE_MODULES, ensureOut, requireFile };
