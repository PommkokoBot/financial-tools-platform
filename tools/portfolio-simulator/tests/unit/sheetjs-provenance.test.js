// Proves the SheetJS the tests run against is byte-for-byte the SheetJS users get.
//
// index.html loads SheetJS 0.20.3 from cdn.sheetjs.com. npm's own `xlsx` package is
// abandoned at 0.18.5 (CVE-2023-30533, prototype pollution reachable whenever the tool
// parses a file the user supplies), so the test side installs `@e965/xlsx`, a
// third-party republish of the same release.
//
// A republish is somebody else's copy. If it silently diverged -- a patched build, a
// different release relabelled, or an outright hostile edit -- every case-file suite
// would keep passing while proving nothing about the bytes a real browser executes.
// That is worse than no test, because it reads as confidence.
//
// So the digest below is pinned. It was taken on 2026-09-26 from
// https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js, downloaded
// through a browser on a machine that can reach the CDN (this sandbox cannot), and the
// installed mirror matched it exactly. If this suite ever goes red, the mirror moved:
// stop, get the official file again, and compare before touching anything else.
//
// The same digest is the Subresource Integrity value for the <script> tag, and as of round
// C2 it is applied there. This suite still owns the SheetJS-specific checks -- the runtime
// version the library reports, and the abandoned npm `xlsx` not creeping back in --
// while unit/cdn-provenance.test.js owns the SRI tags for all four libraries.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const EXPECTED = {
  version: '0.20.3',
  bytes: 951904,
  sha384_b64: 'EnyY0/GSHQGSxSgMwaIPzSESbqoOLSexfnSMN2AP+39Ckmn92stwABZynq1JyzdT',
  md5: '6b3130af1ceadf07caa0ec08af7addff',
};

const results = { pass: [], fail: [] };
const check = (name, cond, detail) =>
  cond ? results.pass.push(name) : results.fail.push(name + (detail ? ' :: ' + detail : ''));

const MIRROR = path.join(__dirname, '..', '..', 'node_modules', '@e965', 'xlsx', 'dist', 'xlsx.full.min.js');

if (!fs.existsSync(MIRROR)) {
  console.log('PASS 0  FAIL 1');
  console.log('  XX  @e965/xlsx is not installed -- run npm install');
  process.exit(1);
}

const buf = fs.readFileSync(MIRROR);

check('mirror size matches the official 0.20.3 build',
  buf.length === EXPECTED.bytes, `${buf.length} bytes, expected ${EXPECTED.bytes}`);

const sha384 = crypto.createHash('sha384').update(buf).digest('base64');
check('mirror sha384 matches the official 0.20.3 build',
  sha384 === EXPECTED.sha384_b64, `got sha384-${sha384}`);

const md5 = crypto.createHash('md5').update(buf).digest('hex');
check('mirror md5 matches the official 0.20.3 build',
  md5 === EXPECTED.md5, `got ${md5}`);

// The version the library reports at runtime, not just the string in package.json --
// a relabelled tarball would pass the metadata check and fail this one.
const XLSX = require('@e965/xlsx');
check('loaded library reports version ' + EXPECTED.version,
  XLSX.version === EXPECTED.version, `reports ${XLSX.version}`);

// index.html must be asking for that same version. These drift apart the moment
// somebody bumps one side and forgets the other, and nothing else would notice.
const appHtml = fs.readFileSync(path.join(__dirname, '..', '..', 'index.html'), 'utf8');
const tag = appHtml.match(/https:\/\/cdn\.sheetjs\.com\/xlsx-([0-9.]+)\/[^"']*xlsx\.full\.min\.js/);
check('index.html loads SheetJS from cdn.sheetjs.com', !!tag,
  'no cdn.sheetjs.com script tag found');
check('index.html requests the same version the tests run',
  tag && tag[1] === EXPECTED.version, tag ? `index.html asks for ${tag[1]}` : '(no tag)');

// 0.18.5 is the abandoned npm release with the known prototype-pollution issue. It must
// not come back in through a transitive dependency and shadow the good copy.
const legacy = path.join(__dirname, '..', '..', 'node_modules', 'xlsx', 'package.json');
check('the abandoned npm `xlsx` package is not installed',
  !fs.existsSync(legacy),
  fs.existsSync(legacy) ? 'node_modules/xlsx exists -- version ' +
    (JSON.parse(fs.readFileSync(legacy, 'utf8')).version || '?') : '');

console.log(`PASS ${results.pass.length}  FAIL ${results.fail.length}`);
results.fail.forEach(f => console.log('  XX  ' + f));
process.exit(results.fail.length ? 1 : 0);
