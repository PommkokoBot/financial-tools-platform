// Shared Playwright setup for the browser suites.
//
// The app loads Tailwind, Chart.js, SheetJS, html2canvas, jsPDF, Font Awesome and
// Google Fonts from CDNs. CI (and this sandbox) has no access to them, and even
// where it does, a test that silently renders without Tailwind measures a layout
// no real user ever sees. So every external request is intercepted and served
// from the local node_modules copy instead.
//
// Tailwind is the special case: the production page uses the Play CDN, which
// compiles CSS in the browser. There is no npm build of that script, so we
// pre-compile the same classes with the Tailwind CLI (npm run build:css) and
// inject the result. Layout measured this way matches the real page.
const fs = require('fs');
const path = require('path');
const { NODE_MODULES, TESTS_DIR, APP } = require('./paths');

const TAILWIND_CSS = path.join(TESTS_DIR, '.out', 'tailwind.css');

const LIBS = {
  'chart.umd.min.js': 'chart.js/dist/chart.umd.min.js',
  'marked.min.js': 'marked/marked.min.js',
  'xlsx.full.min.js': '@e965/xlsx/dist/xlsx.full.min.js',
  'html2canvas.min.js': 'html2canvas/dist/html2canvas.min.js',
  'jspdf.umd.min.js': 'jspdf/dist/jspdf.umd.min.js',
};

// Font Awesome's stylesheet, served with the correct media type so the browser parses it.
// It used to fall through to the empty-body catch-all below, which was survivable while the tag
// carried no integrity attribute. Now that it does, an empty body is a digest mismatch and the
// browser drops the stylesheet -- so the suites would have been testing a page whose icons had
// been refused, while reporting nothing. Serving the pinned npm copy (byte-identical to what
// cdnjs sends) means a real browser verifies that digest on every browser-suite run.
const CSS_LIBS = {
  'font-awesome/6.4.0/css/all.min.css': '@fortawesome/fontawesome-free/css/all.min.css',
};

const FONT_DIR = path.join(NODE_MODULES, '@fontsource/sarabun/files');
const FONT_CSS = ['thai', 'latin']
  .flatMap(sub => [400, 600, 700].map(wt =>
    `@font-face{font-family:'Sarabun';font-style:normal;font-weight:${wt};` +
    `src:url(https://fonts.gstatic.com/local/sarabun-${sub}-${wt}-normal.woff2) format('woff2');}`))
  .join('\n');

function tailwindShim() {
  if (!fs.existsSync(TAILWIND_CSS)) {
    throw new Error(
      `Tailwind build not found at ${TAILWIND_CSS}\n` +
      `Run "npm run build:css" first -- without it the browser suites would measure an unstyled page.`);
  }
  const css = fs.readFileSync(TAILWIND_CSS, 'utf8');
  return `(function(){var s=document.createElement("style");s.textContent=${JSON.stringify(css)};document.head.appendChild(s);})();`;
}

// Intercepts every non-file:// request. Anything not recognised is fulfilled with
// an empty body rather than allowed out, so a suite can never quietly depend on
// the network.
async function routeOffline(page) {
  const shim = tailwindShim();
  await page.route('**/*', route => {
    const url = route.request().url();
    if (url.startsWith('file://')) return route.continue();

    const lib = Object.keys(LIBS).find(k => url.endsWith(k));
    // index.html carries crossorigin="anonymous" on these tags, which Subresource Integrity
    // requires: the request becomes a CORS request, and a CDN that answers without
    // Access-Control-Allow-Origin makes the browser drop the script before it even checks the
    // hash. The real CDNs all send it, so the stub sends it too -- the point of this harness is
    // to behave like the CDN, not merely to hand over bytes.
    //
    // Measured, so nobody has to guess: removing this header does NOT currently break the
    // suites. Chromium does not enforce CORS on a response Playwright fulfils for a page loaded
    // from file://. So this header is faithfulness and future-proofing, not a load-bearing fix,
    // and the browser suites CANNOT catch a CDN that stops sending it. Only opening the
    // deployed page in a real browser can.
    //
    // What the suites DO verify, because these are the same bytes the digests in index.html
    // were taken from: a real browser runs its genuine integrity check on every run. A wrong
    // digest leaves the library undefined and the suites fail. tests/browser/sri-load.js proves
    // that with a deliberately corrupted digest as a negative control.
    if (lib) return route.fulfill({
      path: path.join(NODE_MODULES, LIBS[lib]),
      contentType: 'application/javascript',
      headers: { 'Access-Control-Allow-Origin': '*' },
    });

    const css = Object.keys(CSS_LIBS).find(k => url.includes(k));
    if (css) return route.fulfill({
      path: path.join(NODE_MODULES, CSS_LIBS[css]),
      contentType: 'text/css',
      headers: { 'Access-Control-Allow-Origin': '*' },
    });

    if (url.includes('tailwindcss')) return route.fulfill({ body: shim, contentType: 'application/javascript' });
    if (url.includes('fonts.googleapis.com')) return route.fulfill({ body: FONT_CSS, contentType: 'text/css' });

    const f = url.match(/local\/sarabun-(\w+)-(\d+)-normal\.woff2/);
    if (f) return route.fulfill({ path: path.join(FONT_DIR, `sarabun-${f[1]}-${f[2]}-normal.woff2`), contentType: 'font/woff2' });

    return route.fulfill({ body: '' });
  });
}

const fileUrl = (p) => 'file://' + path.resolve(p || APP);

// Waits until the stubbed libraries are actually live, then gives fonts/layout a
// moment to settle -- measuring before this point produces wrong geometry.
async function openApp(page, file) {
  await routeOffline(page);
  await page.goto(fileUrl(file));
  await page.waitForFunction(() => typeof Chart !== 'undefined' && typeof XLSX !== 'undefined');
  await page.waitForTimeout(1200);
}

module.exports = { routeOffline, openApp, fileUrl, LIBS, CSS_LIBS, FONT_CSS, TAILWIND_CSS };
