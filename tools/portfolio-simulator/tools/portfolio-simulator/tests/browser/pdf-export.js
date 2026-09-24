// Real-browser end-to-end: generate the PDF in headless Chromium and save it.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const { routeOffline, fileUrl } = require('../lib/browser-env');
const { APP, ensureOut, requireFile } = require('../lib/paths');
const FILE = process.argv[2] ? path.resolve(process.argv[2]) : requireFile(APP, 'app under test');
const OUT = process.argv[3] ? path.resolve(process.argv[3]) : ensureOut('pdf-export');
const MODE = process.argv[4] || 'full'; // full | minimal


(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 800 }, acceptDownloads: true, locale: 'th-TH', timezoneId: 'Asia/Bangkok' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  await routeOffline(page);
  await page.goto(fileUrl(FILE));
  await page.waitForFunction(() => typeof Chart !== 'undefined' && typeof html2canvas !== 'undefined' && window.jspdf);

  // Realistic fund values (the new defaults have blank Expected fields).
  await page.evaluate(() => {
    const f1 = [
      { id: 1, name: "ES-WDEQ", weight: 20, yield: 1.0, capGain: 6.0, sd: 15.0 },
      { id: 2, name: "MGALL-UH", weight: 40, yield: 0.8, capGain: 6.5, sd: 14.0 },
      { id: 3, name: "TGSMART-A", weight: 20, yield: 3.0, capGain: 2.0, sd: 6.0 },
      { id: 4, name: "SCBGEARA", weight: 20, yield: 2.5, capGain: 1.0, sd: 3.0 }];
    const f2 = [
      { id: 1, name: "MGALL-UH", weight: 40, yield: 0.8, capGain: 6.5, sd: 14.0 },
      { id: 2, name: "TGSMART-A", weight: 40, yield: 3.0, capGain: 2.0, sd: 6.0 },
      { id: 3, name: "SCBGEARA", weight: 20, yield: 2.5, capGain: 1.0, sd: 3.0 }];
    portfolios.forEach(pt => { pt.fundsData[1] = JSON.parse(JSON.stringify(f1)); [2, 3, 4].forEach(i => pt.fundsData[i] = JSON.parse(JSON.stringify(f2))); });
    renderFundRows(); updatePhaseStatsTable();
  });
  if (MODE === 'three') {
    await page.evaluate(() => {
      addPortfolio(); portfolios[2].name = 'พอร์ต 3 (DCA เติบโตสูง ทดสอบชื่อยาว & "อักขระพิเศษ" <b>)'; portfolios[2].allocWeight = 20; portfolios[1].allocWeight = 40;
      const extra = [{ id: 11, name: 'KF-SINCOME-FX-R', weight: 10, yield: 2.5, capGain: 0.5, sd: 3 }, { id: 12, name: 'ASP-AAA-R', weight: 10, yield: 1.8, capGain: 0.2, sd: 1.5 }];
      portfolios.forEach(pt => { pt.phaseSettings[3].enabled = true; pt.phaseSettings[4].enabled = true; [3, 4].forEach(i => { pt.fundsData[i] = pt.fundsData[i].map(f => ({ ...f, weight: f.weight * 0.8 })).concat(JSON.parse(JSON.stringify(extra))); }); });
      globalWithdrawal.mode = 'fixed_baht'; globalWithdrawal.fixedAmt = 45000;
      switchActivePort(1); renderPriorityOrderUI(); updatePhaseStatsTable();
    });
  }
  await page.click('#btn-run-mc');
  await page.waitForFunction(() => hasRunOnce && !simResultsStale, null, { timeout: 60000 });
  if (MODE === 'full' || MODE === 'three') {
    await page.click('#btn-run-heatmap');
    await page.waitForFunction(() => lastHeatmapResult && !lastHeatmapResult.stale, null, { timeout: 120000 });
    await page.click('#btn-optimize-sharpe');
    await page.waitForFunction(() => !!optimizerCloud);
  }
  await page.evaluate(() => window.scrollTo(0, 900)); // export from a scrolled position on purpose
  await page.click('#btn-export-pdf');
  const state = await page.evaluate(() => ({
    gen: document.getElementById('btn-generate-pdf').disabled,
    hm: document.getElementById('pdf-opt-heatmap').checked, opt: document.getElementById('pdf-opt-optimizer').checked }));
  const dlP = page.waitForEvent('download', { timeout: 120000 });
  await page.click('#btn-generate-pdf');
  const dl = await dlP;
  const pdfPath = path.join(OUT, dl.suggestedFilename());
  await dl.saveAs(pdfPath);
  const after = await page.evaluate(() => ({ scrollY: window.scrollY, root: !!document.getElementById('mdr-report-root'), overlay: !!document.getElementById('mdr-export-overlay'), progress: document.getElementById('pdf-progress').textContent }));
  console.log(JSON.stringify({ state, pdfPath, size: fs.statSync(pdfPath).size, after, errors }, null, 1));
  await browser.close();
})().catch(e => { console.error('FAILED', e); process.exit(1); });
