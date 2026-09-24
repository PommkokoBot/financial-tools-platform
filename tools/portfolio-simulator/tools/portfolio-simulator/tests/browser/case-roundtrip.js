// Real-browser: save a case to .xlsx via the UI, reload the page, re-open that file via the
// file picker, and verify the inputs on screen came back.
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path');
const { routeOffline, fileUrl } = require('../lib/browser-env');
const { APP, ensureOut, requireFile } = require('../lib/paths');
const FILE = requireFile(APP, 'app under test');
const OUT = ensureOut('case-roundtrip');

const SNAP = () => JSON.stringify({
  ports: portfolios.map(p => ({ n: p.name, w: p.allocWeight, t: p.topup, r: p.rebalance, ps: p.phaseSettings, f: [1, 2, 3, 4].map(i => p.fundsData[i].map(x => [x.name, x.weight, x.yield, x.capGain, x.sd])) })),
  wd: globalWithdrawal, m: [chartSimMethod, heatmapSimMethod, heatmapWithdrawalMode],
  inp: ['init-investment', 'inflation-rate', 'global-rebalance', 'heatmap-rates', 'heatmap-benchmark-rate', 'opt-conservative-min-return', 'opt-aggressive-max-risk'].map(id => document.getElementById(id).value)
});

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, acceptDownloads: true, locale: 'th-TH', timezoneId: 'Asia/Bangkok' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  page.on('dialog', d => d.accept()); // confirm() on import, alert() summary
  await routeOffline(page);
  // Headless has no native Save dialog, so exercise the plain-download fallback path.
  await page.addInitScript(() => { delete window.showSaveFilePicker; });
  await page.goto(fileUrl(FILE));
  await page.waitForFunction(() => typeof XLSX !== 'undefined' && typeof Chart !== 'undefined');

  // Build a case through real UI interactions where practical.
  await page.fill('#init-investment', '8800000');
  await page.fill('#inflation-rate', '3.1');
  await page.selectOption('#global-rebalance', '3');
  await page.click('#global-wd-mode-fixed');
  await page.fill('#global-wd-fixed-amt', '65000');
  await page.fill('#global-wd-start-y', '9');
  await page.click('#sim-mc-gbm');
  await page.evaluate(() => {
    portfolios[0].name = 'พอร์ต "ทดสอบ" & <A>';
    portfolios[0].fundsData[1][0].yield = 1.25;
    portfolios[0].fundsData[1][1].sd = 13.5;
    renderPortTabs(); renderFundRows(); updatePhaseStatsTable();
  });
  await page.click('#btn-run-mc');
  await page.waitForFunction(() => hasRunOnce && !simResultsStale, null, { timeout: 60000 });
  const before = await page.evaluate(SNAP);

  // Save the case through the modal
  await page.click('#btn-export-excel');
  const statusText = await page.textContent('#case-results-status');
  await page.fill('#case-name-input', 'ลูกค้า A / แผน 1');
  const dlP = page.waitForEvent('download', { timeout: 60000 });
  await page.click('#btn-save-case');
  const dl = await dlP;
  const xlsxPath = path.join(OUT, dl.suggestedFilename());
  await dl.saveAs(xlsxPath);
  const modalClosed = await page.evaluate(() => document.getElementById('case-modal').classList.contains('hidden'));

  // Fresh page, then open the saved file with the real file picker
  await page.goto(fileUrl(FILE));
  await page.waitForFunction(() => typeof XLSX !== 'undefined' && typeof Chart !== 'undefined');
  const defaults = await page.evaluate(SNAP);
  await page.setInputFiles('#case-file-input', xlsxPath);
  await page.waitForFunction(() => document.getElementById('status-badge').innerHTML.includes('เปิดเคสแล้ว'), null, { timeout: 30000 });
  const after = await page.evaluate(SNAP);

  // The re-opened case must run, and then export a PDF (checks the new watermark too)
  await page.click('#btn-run-mc');
  await page.waitForFunction(() => hasRunOnce && !simResultsStale, null, { timeout: 60000 });
  await page.click('#btn-export-pdf');
  const pdfP = page.waitForEvent('download', { timeout: 120000 });
  await page.click('#btn-generate-pdf');
  const pdf = await pdfP;
  const pdfPath = path.join(OUT, pdf.suggestedFilename());
  await pdf.saveAs(pdfPath);

  console.log(JSON.stringify({
    fileName: path.basename(xlsxPath), size: fs.statSync(xlsxPath).size, statusText, modalClosed,
    restored: before === after, changedFromDefaults: defaults !== after, pdfPath, errors
  }, null, 1));
  if (before !== after) {
    const a = JSON.parse(before), b = JSON.parse(after);
    console.log('DIFF KEYS:', Object.keys(a).filter(k => JSON.stringify(a[k]) !== JSON.stringify(b[k])));
  }
  await browser.close();
})().catch(e => { console.error('FAILED', e); process.exit(1); });
