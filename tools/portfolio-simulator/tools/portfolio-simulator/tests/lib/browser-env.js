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
  'xlsx.full.min.js': 'xlsx/dist/xlsx.full.min.js',
  'html2canvas.min.js': 'html2canvas/dist/html2canvas.min.js',
  'jspdf.umd.min.js': 'jspdf/dist/jspdf.umd.min.js',
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
    if (lib) return route.fulfill({ path: path.join(NODE_MODULES, LIBS[lib]), contentType: 'application/javascript' });

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

module.exports = { routeOffline, openApp, fileUrl, LIBS, FONT_CSS, TAILWIND_CSS };
