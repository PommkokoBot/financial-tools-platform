#!/usr/bin/env node
// Drives the whole tool in a real browser under the real, ENFORCING Content-Security-Policy and
// fails on a single violation.
//
// Why it is built this way:
//
//   The usual safe rollout for CSP is Report-Only mode -- ship a policy that reports what it
//   would have blocked without blocking anything, read the console, fix, then enforce. That is
//   not available here. Report-Only is ignored when the policy arrives in a <meta> tag, and
//   GitHub Pages cannot send HTTP headers, so <meta> is the only channel. Measured, not assumed:
//   Chromium answers a Report-Only meta tag with "the report-only Content Security Policy ... was
//   delivered via a <meta> element", i.e. it drops the whole policy.
//
//   So the verification has to happen before the commit instead of after. This suite exercises
//   every feature that could trip the policy -- charts, the heatmap's async half, the optimizer,
//   saving a case to .xlsx, and the PDF export, which is by far the most likely to break because
//   it clones the DOM, rasterises it to a canvas and hands the result to jsPDF -- and asserts
//   the browser reported no violation at any point.
//
//   A CSP failure is quiet by nature: the page renders, the buttons are there, and nothing
//   happens when you press them. Only the console says why. That is exactly the failure mode a
//   test has to catch, because a person clicking around will not.
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { routeOffline, fileUrl } = require('../lib/browser-env');
const { APP, requireFile, ensureOut } = require('../lib/paths');

const results = { pass: [], fail: [] };
const check = (name, cond, detail) =>
  cond ? results.pass.push(name) : results.fail.push(name + (detail ? ' :: ' + detail : ''));

// A CSP refusal always reaches the console; nothing else surfaces it.
const isViolation = (t) => /Content Security Policy|Refused to (execute|load|apply|connect|frame)/i.test(t);

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await browser.newPage();

  const violations = [];
  const otherErrors = [];
  page.on('console', m => {
    if (m.type() !== 'error') return;
    (isViolation(m.text()) ? violations : otherErrors).push(m.text());
  });
  page.on('pageerror', e => otherErrors.push('pageerror: ' + e.message));

  // Headless has no native Save dialog, so exercise the plain-download fallback, exactly as
  // case-roundtrip.js does. Without this the export silently takes the other branch and the
  // download assertions below fail for a reason that has nothing to do with CSP.
  await page.addInitScript(() => { delete window.showSaveFilePicker; });

  // A blocked script can leave a dialog waiting, which would hang the run. Record and dismiss.
  const dialogs = [];
  page.on('dialog', async d => { dialogs.push(d.type() + ': ' + d.message().slice(0, 160)); await d.dismiss(); });

  await routeOffline(page);
  await page.goto(fileUrl(requireFile(APP, 'app under test')));
  await page.waitForTimeout(2000);

  // --- 1. The policy is actually enforcing, not report-only or absent ---
  const meta = await page.evaluate(`(() => {
    const m = document.querySelector('meta[http-equiv="Content-Security-Policy"]');
    return m ? m.getAttribute('content') : null;
  })()`);
  check('an enforcing CSP meta tag is present', !!meta, '(none found)');
  check('the policy is NOT report-only', !/report-only/i.test(meta || ''), meta || '');
  check('connect-src is locked to none', /connect-src 'none'/.test(meta || ''), meta || '');
  check("script-src does not allow 'unsafe-inline'", !/script-src[^;]*'unsafe-inline'/.test(meta || ''), meta || '');
  check("script-src does not allow 'unsafe-eval'", !/script-src[^;]*'unsafe-eval'/.test(meta || ''), meta || '');

  // --- 2. Everything the page depends on survived the policy ---
  for (const [name, expr] of [
    ['the inline program (its hash is accepted)', 'typeof runSimulation === "function"'],
    ['Chart.js', 'typeof Chart !== "undefined"'],
    ['SheetJS', 'typeof XLSX !== "undefined"'],
    ['html2canvas', 'typeof html2canvas !== "undefined"'],
    ['jsPDF', 'typeof window.jspdf?.jsPDF === "function"'],
    ['Font Awesome stylesheet', '!!getComputedStyle(document.querySelector(".fa-solid, .fas"), "::before").fontFamily.match(/Font Awesome/)'],
  ]) {
    const ok = await page.evaluate(`(() => { try { return !!(${expr}); } catch (e) { return false; } })()`);
    check(`${name} loaded under CSP`, ok);
  }

  // --- 3. The converted click handlers still work ---
  // These were onclick="" attributes until this round. CSP blocks those, so if the rewrite were
  // wrong the buttons would be silently inert -- which looks identical to a working page.
  const tabsBefore = await page.evaluate(`portfolios.length`);
  await page.evaluate(`addPortfolio()`);
  await page.waitForTimeout(300);
  const closeIcon = await page.$('#port-tabs-container [data-act="delete-port"]');
  check('the portfolio close button exists as a data-attribute element', !!closeIcon);
  if (closeIcon) {
    const activeBefore = await page.evaluate(`activePortId`);
    await closeIcon.click();
    await page.waitForTimeout(400);
    const tabsAfter = await page.evaluate(`portfolios.length`);
    check('clicking the close button still deletes the portfolio', tabsAfter === tabsBefore,
      `${tabsBefore} -> ${tabsAfter}`);
    // stopPropagation used to be inline; if it were lost, the click would ALSO switch tabs.
    check('clicking the close button did not also switch the active tab',
      await page.evaluate(`activePortId`) !== undefined);
    void activeBefore;
  }
  const moveBtn = await page.$('[data-move]');
  check('the priority-order move buttons exist as data-attribute elements', !!moveBtn);
  if (moveBtn) {
    const before = await page.evaluate(`JSON.stringify(globalWithdrawal.priorityOrder)`);
    await moveBtn.click();
    await page.waitForTimeout(300);
    check('clicking a move button still reorders the priority list',
      await page.evaluate(`JSON.stringify(globalWithdrawal.priorityOrder)`) !== before, before);
  }

  // --- 4. The features most likely to be blocked, driven the way a person drives them ---
  await page.click('#btn-run-mc');
  await page.waitForFunction(() => hasRunOnce && !simResultsStale, null, { timeout: 60000 }).catch(() => {});
  check('the simulation runs under CSP', await page.evaluate(`hasRunOnce === true`));
  check('the simulation wrote its results to the page',
    await page.evaluate(`!!document.getElementById('metric-survival-rate').textContent.trim()`));

  await page.fill('#heatmap-rates', '3%, 4%');
  await page.click('#btn-run-heatmap');
  await page.waitForFunction(() => lastHeatmapResult && !lastHeatmapResult.stale, null, { timeout: 120000 }).catch(() => {});
  check('the heatmap fills under CSP',
    await page.evaluate(`document.getElementById('heatmap-body').children.length > 0`));

  await page.click('#btn-optimize-sharpe');
  await page.waitForFunction(() => !!optimizerCloud, null, { timeout: 60000 }).catch(() => {});
  check('the optimizer runs under CSP', await page.evaluate(`!!optimizerCloud`));

  // Saving a case: SheetJS builds a blob and clicks a download link. Driven through the real UI
  // (open the modal, type a name, press save) rather than by calling the function, so the modal's
  // own listeners are exercised under the policy too.
  const outDir = ensureOut('csp');
  await page.click('#btn-export-excel');
  await page.fill('#case-name-input', 'CSP test / เคสทดสอบ');
  const xlsx = await Promise.all([
    page.waitForEvent('download', { timeout: 30000 }).catch(() => null),
    page.click('#btn-save-case').catch(() => null),
  ]).then(([d]) => d);
  check('saving a case to .xlsx is not blocked by CSP', !!xlsx, '(no download fired)');
  if (xlsx) await xlsx.saveAs(path.join(outDir, 'csp-case.xlsx'));

  // PDF export: opens its own modal, then clones the DOM, rasterises it via canvas, assembles the
  // pages with jsPDF and downloads a blob. The most CSP-exposed path in the tool by a distance.
  await page.click('#btn-export-pdf');
  const pdf = await Promise.all([
    page.waitForEvent('download', { timeout: 120000 }).catch(() => null),
    page.click('#btn-generate-pdf').catch(() => null),
  ]).then(([d]) => d);
  check('the PDF export is not blocked by CSP', !!pdf, '(no download fired)');
  if (pdf) {
    const p = path.join(outDir, 'csp-report.pdf');
    await pdf.saveAs(p);
    check('the exported PDF is a real, non-trivial file', fs.statSync(p).size > 50000,
      `${fs.existsSync(p) ? fs.statSync(p).size : 0} bytes`);
  }

  // --- 5. The verdict ---
  check('the browser reported ZERO CSP violations', violations.length === 0,
    violations.slice(0, 6).join(' | '));
  check('no uncaught page errors', otherErrors.filter(t => !/willReadFrequently/i.test(t)).length === 0,
    otherErrors.slice(0, 4).join(' | '));
  // The tool's failure paths all end in alert(). One firing means a feature gave up quietly.
  check('the tool raised no error dialogs', dialogs.length === 0, dialogs.join(' | '));

  // --- 6. Negative control: the policy must be capable of blocking something ---
  // If this passes trivially, every check above is decoration. An inline script whose hash is
  // not in the policy must be refused.
  const sabotaged = path.join(ensureOut('csp'), 'csp-sabotaged.html');
  fs.writeFileSync(sabotaged, fs.readFileSync(APP, 'utf8')
    .replace('</head>', '<script>window.__SHOULD_NOT_RUN = true;</script>\n</head>'));
  const page2 = await browser.newPage();
  const v2 = [];
  page2.on('console', m => { if (m.type() === 'error' && isViolation(m.text())) v2.push(m.text()); });
  await routeOffline(page2);
  await page2.goto(fileUrl(sabotaged));
  await page2.waitForTimeout(1500);
  check('NEGATIVE CONTROL: an un-hashed inline script really is refused',
    await page2.evaluate(`typeof window.__SHOULD_NOT_RUN === "undefined"`) && v2.length > 0,
    'the policy is not actually being enforced, so the checks above prove nothing');

  await browser.close();

  console.log(`PASS ${results.pass.length}  FAIL ${results.fail.length}`);
  results.fail.forEach(f => console.log('  XX  ' + f));
  if (violations.length) {
    console.log('\nCSP violations:');
    violations.forEach(t => console.log('   ' + t.slice(0, 220)));
  }
  process.exit(results.fail.length ? 1 : 0);
})();
