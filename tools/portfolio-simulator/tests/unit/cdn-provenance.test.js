// Subresource Integrity: proves every cross-origin <script> in index.html is pinned to a
// digest we can re-derive, and that nothing new slipped in unprotected.
//
// Why this suite exists rather than "we added the attributes once and moved on":
//
//   A wrong integrity digest does not degrade. The browser refuses the script outright and
//   the tool loads to a dead page -- no error banner, nothing on screen, only a console
//   message nobody reads. That makes it the single most dangerous kind of edit in this file:
//   bump chart.js@4.5.1 to 4.6.0 in the URL, forget the digest, and the tool is broken for
//   every visitor while looking fine in the diff.
//
//   So the digests are not just stored here as constants to compare against themselves.
//   Each one is recomputed from the pinned npm package of the same version on every run.
//   The npm copies were verified byte-identical to the files the CDNs actually served
//   (downloaded through a browser on 2026-09-27, on a machine that can reach them -- CI and
//   the dev sandbox cannot). Two independent sources agreeing is what makes the digest
//   trustworthy; a hash taken from one mirror and checked against that same mirror proves
//   only that the file did not change on disk.
//
// If this suite goes red, do NOT re-pin the digest to whatever the file now hashes to. That
// deletes the check. Find out why the bytes moved first.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const TOOL_DIR = path.join(__dirname, '..', '..');
const NODE_MODULES = path.join(TOOL_DIR, 'node_modules');

// url        : the substring identifying the tag in index.html (includes the version)
// mirror     : the npm file confirmed byte-identical to what the CDN serves
// pkg        : package.json devDependency that must carry the same version
// version    : the version that must appear in BOTH the URL and package.json
// sha384/bytes : taken from the CDN download on 2026-09-27
const ASSETS = [
  {
    name: 'Chart.js',
    url: 'cdn.jsdelivr.net/npm/chart.js@4.5.1/dist/chart.umd.min.js',
    mirror: 'chart.js/dist/chart.umd.min.js',
    pkg: 'chart.js',
    version: '4.5.1',
    bytes: 208522,
    sha384: 'sha384-jb8JQMbMoBUzgWatfe6COACi2ljcDdZQ2OxczGA3bGNeWe+6DChMTBJemed7ZnvJ',
  },
  {
    name: 'SheetJS',
    url: 'cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js',
    mirror: '@e965/xlsx/dist/xlsx.full.min.js',
    pkg: '@e965/xlsx',
    version: '0.20.3',
    bytes: 951904,
    sha384: 'sha384-EnyY0/GSHQGSxSgMwaIPzSESbqoOLSexfnSMN2AP+39Ckmn92stwABZynq1JyzdT',
  },
  {
    name: 'html2canvas',
    url: 'cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js',
    mirror: 'html2canvas/dist/html2canvas.min.js',
    pkg: 'html2canvas',
    version: '1.4.1',
    bytes: 198689,
    sha384: 'sha384-ZZ1pncU3bQe8y31yfZdMFdSpttDoPmOZg2wguVK9almUodir1PghgT0eY7Mrty8H',
  },
  {
    name: 'jsPDF',
    url: 'cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js',
    mirror: 'jspdf/dist/jspdf.umd.min.js',
    pkg: 'jspdf',
    version: '2.5.1',
    bytes: 364463,
    sha384: 'sha384-JcnsjUPPylna1s1fvi1u12X5qjY5OL56iySh75FdtrwhO/SWXgMjoVqcKyIIWOLk',
  },
  {
    name: 'Font Awesome',
    url: 'cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css',
    mirror: '@fortawesome/fontawesome-free/css/all.min.css',
    pkg: '@fortawesome/fontawesome-free',
    version: '6.4.0',
    bytes: 102025,
    sha384: 'sha384-iw3OoTErCYJJB9mCa8LNS2hbsQ7M3C0EpIsO/H5+EGAkPGc6rk+V8i04oW/K5xq0',
    tag: 'link',
  },
];

// Cross-origin subresources that deliberately carry no integrity attribute, with the reason.
// Anything cross-origin and NOT listed here must be pinned, or the last check below fails.
const UNPINNED_BY_DECISION = [
  // Google Fonts answers with different CSS depending on the requesting browser, so a fixed
  // digest would break the page on some of them. It cannot be pinned, only removed. It is also
  // the only cross-origin subresource left without one: Font Awesome was pinned in round C2.
  'fonts.googleapis.com',
];

const results = { pass: [], fail: [] };
const check = (name, cond, detail) =>
  cond ? results.pass.push(name) : results.fail.push(name + (detail ? ' :: ' + detail : ''));

const html = fs.readFileSync(path.join(TOOL_DIR, 'index.html'), 'utf8');
const pkgJson = JSON.parse(fs.readFileSync(path.join(TOOL_DIR, 'package.json'), 'utf8'));

for (const a of ASSETS) {
  // --- the tag in index.html ---
  const kind = a.tag || 'script';
  const attr = kind === 'link' ? 'href' : 'src';
  const tagRe = new RegExp('<' + kind + '\\b[^>]*' + attr + '="https://' +
    a.url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '"[^>]*>', 's');
  const m = html.match(tagRe);
  check(`${a.name}: index.html loads ${a.version} from the expected URL`, !!m, `no tag matching ${a.url}`);
  if (!m) continue;
  const tag = m[0];

  check(`${a.name}: tag carries crossorigin="anonymous"`,
    /crossorigin="anonymous"/.test(tag),
    'SRI without it makes the browser drop the script: ' + tag.replace(/\s+/g, ' ').slice(0, 160));

  const got = (tag.match(/integrity="([^"]+)"/) || [])[1];
  check(`${a.name}: tag carries an integrity digest`, !!got,
    tag.replace(/\s+/g, ' ').slice(0, 160));

  // --- the digest, recomputed from bytes rather than compared to itself ---
  const mirror = path.join(NODE_MODULES, a.mirror);
  if (!fs.existsSync(mirror)) {
    check(`${a.name}: npm mirror is installed`, false, `${a.mirror} missing -- run npm install`);
    continue;
  }
  const buf = fs.readFileSync(mirror);
  check(`${a.name}: mirror size matches the CDN download`, buf.length === a.bytes,
    `${buf.length} bytes, expected ${a.bytes}`);

  const derived = 'sha384-' + crypto.createHash('sha384').update(buf).digest('base64');
  check(`${a.name}: pinned digest still matches the recorded CDN bytes`, derived === a.sha384,
    `recomputed ${derived}`);
  check(`${a.name}: the digest in index.html is the one derived from those bytes`,
    got === derived,
    `index.html has ${got}, bytes hash to ${derived}`);

  // --- version drift between the URL, package.json, and the digest above ---
  const pinned = (pkgJson.devDependencies || {})[a.pkg];
  check(`${a.name}: package.json pins the same version the page loads`,
    pinned === a.version, `package.json says ${pinned}, page loads ${a.version}`);
}

// --- nothing new slipped in unprotected ---
// Catches the future commit that adds a CDN <script> and never thinks about integrity.
const crossOriginScripts = [...html.matchAll(/<script\b[^>]*\bsrc="(https:\/\/[^"]+)"[^>]*>/gs)]
  .map(m => ({ tag: m[0], url: m[1] }));
const unpinned = crossOriginScripts.filter(s =>
  !/integrity="/.test(s.tag) && !UNPINNED_BY_DECISION.some(u => s.url.includes(u)));
check('every cross-origin <script> in index.html is pinned with SRI',
  unpinned.length === 0,
  unpinned.map(s => s.url).join(', '));
const SCRIPT_ASSETS = ASSETS.filter(a => (a.tag || 'script') === 'script');
check('the known libraries are still the only cross-origin scripts',
  crossOriginScripts.length === SCRIPT_ASSETS.length,
  `found ${crossOriginScripts.length}: ` + crossOriginScripts.map(s => s.url).join(', '));

// Same rule for stylesheets, with the two documented exceptions.
const crossOriginLinks = [...html.matchAll(/<link\b[^>]*\bhref="(https:\/\/[^"]+)"[^>]*>/gs)]
  .map(m => ({ tag: m[0], url: m[1] }));
const unpinnedLinks = crossOriginLinks.filter(s =>
  !/integrity="/.test(s.tag) && !UNPINNED_BY_DECISION.some(u => s.url.includes(u)));
check('every cross-origin stylesheet is either pinned or listed as a known exception',
  unpinnedLinks.length === 0,
  unpinnedLinks.map(s => s.url).join(', '));

console.log(`PASS ${results.pass.length}  FAIL ${results.fail.length}`);
results.fail.forEach(f => console.log('  XX  ' + f));
process.exit(results.fail.length ? 1 : 0);
