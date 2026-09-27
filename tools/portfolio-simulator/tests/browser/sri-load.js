#!/usr/bin/env node
// Real-browser check that the Subresource Integrity digests in index.html are correct.
//
// The unit suite (unit/cdn-provenance.test.js) compares strings and recomputes hashes in
// node. That catches a typo'd or stale digest, but it is still node checking node. This suite
// hands the page to an actual browser with the real integrity attributes in place and asks
// the only question that matters: did all four libraries execute?
//
// It works because tests/lib/browser-env.js serves each CDN URL from the pinned npm package
// -- the same bytes the digests were taken from -- and answers with Access-Control-Allow-Origin,
// exactly as the real CDNs do. So Chromium runs its genuine integrity verification against
// genuine bytes. Corrupt a digest in index.html and this suite goes red with the libraries
// undefined, which is precisely how it would fail for a visitor.
//
// What it does NOT prove: that the real CDNs send the CORS header. Nothing offline can prove
// that. It has to be confirmed by opening the deployed page once in a real browser.
const { chromium } = require('playwright');
const { openApp, routeOffline, fileUrl } = require('../lib/browser-env');
const { APP, requireFile } = require('../lib/paths');

const LIBS = [
  ['Chart.js', 'typeof Chart !== "undefined"'],
  ['SheetJS', 'typeof XLSX !== "undefined"'],
  ['html2canvas', 'typeof html2canvas !== "undefined"'],
  ['jsPDF', 'typeof window.jspdf !== "undefined" && typeof window.jspdf.jsPDF === "function"'],
];

(async () => {
  const results = { pass: [], fail: [] };
  const check = (name, cond, detail) =>
    cond ? results.pass.push(name) : results.fail.push(name + (detail ? ' :: ' + detail : ''));

  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await browser.newPage();

  // Anything the browser refused -- a failed integrity check lands here, and only here.
  const consoleErrors = [];
  page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('pageerror', e => consoleErrors.push('pageerror: ' + e.message));

  await routeOffline(page);
  await page.goto(fileUrl(requireFile(APP, 'app under test')));
  await page.waitForTimeout(2500); // no waitForFunction: a blocked script must show up as a failure, not a timeout

  for (const [name, expr] of LIBS) {
    const ok = await page.evaluate(`(() => { try { return !!(${expr}); } catch (e) { return false; } })()`);
    check(`${name} executed despite the integrity check`, ok,
      'undefined -- the browser refused the script, which is what a wrong digest looks like');
  }

  // The tool's own code only runs if the libraries did.
  const appAlive = await page.evaluate(`(() => typeof runSimulation === "function" && !!document.getElementById("disclaimer-strip"))()`);
  check('the tool itself initialised', appAlive);

  const integrityErrors = consoleErrors.filter(t => /integrity|Subresource/i.test(t));
  check('no integrity violations reported by the browser', integrityErrors.length === 0,
    integrityErrors.join(' | '));

  const corsErrors = consoleErrors.filter(t => /Access-Control-Allow-Origin|CORS/i.test(t));
  check('no CORS failures on the crossorigin="anonymous" tags', corsErrors.length === 0,
    corsErrors.join(' | '));

  // --- the negative control: the suite must be able to fail ---
  // A passing SRI test is worthless unless a wrong digest actually breaks the page. Rather
  // than trusting that, corrupt one digest in a copy of the page and confirm the browser
  // refuses it. If this does not fail, the checks above are not measuring anything.
  const fs = require('fs');
  const path = require('path');
  const { ensureOut } = require('../lib/paths');
  const sabotaged = path.join(ensureOut(), 'sri-sabotaged.html');
  const html = fs.readFileSync(APP, 'utf8');
  fs.writeFileSync(sabotaged, html.replace(
    'sha384-jb8JQMbMoBUzgWatfe6COACi2ljcDdZQ2OxczGA3bGNeWe+6DChMTBJemed7ZnvJ',
    'sha384-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'));

  const page2 = await browser.newPage();
  await routeOffline(page2);
  await page2.goto(fileUrl(sabotaged));
  await page2.waitForTimeout(2500);
  const chartBlocked = await page2.evaluate(`(() => typeof Chart === "undefined")()`);
  check('NEGATIVE CONTROL: a wrong Chart.js digest really does block the script', chartBlocked,
    'Chart loaded anyway -- the browser is not enforcing integrity, so the checks above prove nothing');

  await browser.close();

  console.log(`PASS ${results.pass.length}  FAIL ${results.fail.length}`);
  results.fail.forEach(f => console.log('  XX  ' + f));
  if (consoleErrors.length) {
    console.log('\nconsole output from the good page (for reference):');
    consoleErrors.forEach(t => console.log('   ' + t.slice(0, 200)));
  }
  process.exit(results.fail.length ? 1 : 0);
})();
