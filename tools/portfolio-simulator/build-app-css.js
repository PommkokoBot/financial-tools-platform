#!/usr/bin/env node
// Recompiles the Tailwind CSS that index.html carries inline, and writes it back
// into the <style id="tw-build"> block.
//
// index.html no longer loads the Tailwind Play CDN, so the classes it uses have to
// be compiled here. Run this after adding or changing ANY Tailwind class in the
// page, or that class will simply have no effect -- there is no longer a runtime
// compiler to catch it. The browser suites are what prove nothing shifted.
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { APP, TOOL_DIR, TESTS_DIR, ensureOut, requireFile } = require('../lib/paths');

const appPath = requireFile(APP, 'app under test');
const outCss = path.join(ensureOut(), 'tailwind-app.css');
const input = path.join(TESTS_DIR, 'lib', 'tailwind-input.css');

const STYLE_RE = /(<style id="tw-build">)[\s\S]*?(<\/style>)/;

// Scan a copy with the generated block emptied out. Scanning index.html as-is
// would feed last build's CSS back into the scanner -- the generated rules contain
// class-name-looking text, so every rebuild would emit more utilities than the one
// before and the file would creep upward forever.
const original = fs.readFileSync(appPath, 'utf8');
if (!STYLE_RE.test(original)) {
  console.error('Could not find <style id="tw-build"> in index.html -- was the block renamed or removed?');
  process.exit(1);
}
const scanPath = path.join(ensureOut(), 'tw-scan-source.html');
fs.writeFileSync(scanPath, original.replace(STYLE_RE, '$1$2'), 'utf8');

const r = spawnSync('npx', ['tailwindcss', '-i', input, '-o', outCss, '--content', scanPath, '--minify'],
  { cwd: TOOL_DIR, stdio: 'inherit', shell: process.platform === 'win32' });
if (r.status !== 0) { console.error('tailwindcss build failed'); process.exit(1); }

const css = fs.readFileSync(outCss, 'utf8').trim();
if (css.includes('</style>')) { console.error('refusing to inline: CSS contains </style>'); process.exit(1); }

const before = original.match(STYLE_RE)[0].length;
fs.writeFileSync(appPath, original.replace(STYLE_RE, `$1${css}$2`), 'utf8');

console.log(`Inlined ${css.length} bytes of CSS into index.html (block was ${before} bytes).`);
console.log('Now run: npm run test:browser   (geometry is the only thing that proves this is right)');
