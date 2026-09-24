const { makeEnv, REAL_FUNDS, flush } = require('../lib/harness');
const { APP, requireFile } = require('../lib/paths');
const FILE = requireFile(APP, 'app under test');
const results = { pass: 0, fail: [] };
const check = (name, cond, detail) => { if (cond) results.pass++; else results.fail.push(name + (detail !== undefined ? ' :: ' + detail : '')); };

function stubPdf(w) {
  w.pdfLog = { canvases: 0, docs: [] };
  w.html2canvas = async (el) => { w.pdfLog.canvases++; w.pdfLog.lastEl = el; return { toDataURL: () => 'data:image/jpeg;base64,AAAA' }; };
  w.jspdf = { jsPDF: class {
    constructor(opts) { this.opts = opts; this.pages = 1; this.images = []; this.links = []; this.saved = null; w.pdfLog.docs.push(this); }
    addPage(f, o) { this.pages++; this.addPageArgs = [f, o]; }
    addImage(...a) { this.images.push(a); }
    link(...a) { this.links.push(a); }
    save(n) { this.saved = n; }
  } };
}

// Captures the report DOM right before it is torn down, by wrapping html2canvas.
function captureRoot(w) {
  if (!w.__baseH2C) w.__baseH2C = w.html2canvas;
  const orig = w.__baseH2C;
  w.capturedPages = [];
  w.html2canvas = async (el) => { w.capturedPages.push(el.outerHTML); return orig(el); };
}

async function runMain(run) {
  run(`document.getElementById('btn-run-mc').click()`);
  await flush(200);
}

(async () => {
  // ---------- 1. Gating before any run ----------
  {
    const { w, run } = makeEnv(FILE, 7, stubPdf);
    run(`openPdfModal()`);
    const d = w.document;
    check('modal opens', !d.getElementById('pdf-modal').classList.contains('hidden'));
    check('generate disabled before first Run', d.getElementById('btn-generate-pdf').disabled === true);
    check('main status explains Run needed', d.getElementById('pdf-main-status').textContent.includes('Run Simulation'));
    check('heatmap checkbox disabled (never run)', d.getElementById('pdf-opt-heatmap').disabled === true);
    check('optimizer checkbox disabled (not opened)', d.getElementById('pdf-opt-optimizer').disabled === true);
    await run(`generatePdfReport({})`);
    check('generate refuses before run (alert)', w.alertLog.length === 1 && w.pdfLog.docs.length === 0, JSON.stringify(w.alertLog));
  }

  // ---------- 2. Full flow with real funds ----------
  const { w, run } = makeEnv(FILE, 11, (win) => { stubPdf(win); });
  run(REAL_FUNDS + `updatePhaseStatsTable();`);
  await runMain(run);
  const d = w.document;
  check('after Run: not stale', run(`simResultsStale`) === false && run(`hasRunOnce`) === true);

  run(`openPdfModal()`);
  check('generate enabled after Run', d.getElementById('btn-generate-pdf').disabled === false);
  check('heatmap still disabled (not run yet)', d.getElementById('pdf-opt-heatmap').disabled === true);

  // stale after edit
  run(`markDirty()`);
  run(`openPdfModal()`);
  check('markDirty => generate disabled', d.getElementById('btn-generate-pdf').disabled === true);
  check('stale reason shown', d.getElementById('pdf-main-status').textContent.includes('แก้ค่า'));
  await runMain(run);
  run(`openPdfModal()`);
  check('re-Run => enabled again', d.getElementById('btn-generate-pdf').disabled === false);

  // ---------- 2a. Minimal report (no optional sections) ----------
  captureRoot(w);
  await run(`generatePdfReport({ includeHeatmap: false, includeOptimizer: false })`);
  let doc = w.pdfLog.docs[w.pdfLog.docs.length - 1];
  check('jsPDF landscape/pt/a4', doc && doc.opts.orientation === 'landscape' && doc.opts.unit === 'pt' && doc.opts.format === 'a4', doc && JSON.stringify(doc.opts));
  check('minimal report = 4 pages', doc.images.length === 4 && doc.pages === 4, `${doc.images.length}/${doc.pages}`);
  check('addPage uses landscape', doc.addPageArgs && doc.addPageArgs[1] === 'landscape');
  check('every image fills full A4 landscape (841.89x595.28pt at 0,0)', doc.images.every(a => a[1] === 'JPEG' && a[2] === 0 && a[3] === 0 && a[4] === 841.89 && a[5] === 595.28));
  check('file saved with MoneyDirector name', /^MoneyDirector_Portfolio_Report_\d{4}-\d{2}-\d{2}_\d{4}\.pdf$/.test(doc.saved), doc.saved);
  const pages = w.capturedPages;
  check('each captured page is a .mdr-page', pages.length === 4 && pages.every(p => p.startsWith('<div class="mdr-page')));
  const disclaimerCore = 'รายงานนี้จัดทำโดยเครื่องมือจำลองพอร์ตการลงทุน (Portfolio Simulator) ของ Money Director เพื่อการทดลองจัดพอร์ตเท่านั้น';
  check('full disclaimer on EVERY page', pages.every(p => p.includes(disclaimerCore) && p.includes('ไม่มีความเกี่ยวข้องกับสถาบันการเงินหรือบริษัทหลักทรัพย์ใดๆ') && p.includes('เกี่ยวกับรายงานฉบับนี้')));
  check('credit + link text + as-of on every page', pages.every(p => /จัดทำโดย Money Director \| <span data-pdf-link="https:\/\/www.facebook.com\/themoneydirector">facebook.com\/themoneydirector<\/span> — ข้อมูลจำลองโดยผู้ใช้ ณ วันที่ .+?</.test(p)));
  check('watermark on every page', pages.every(p => p.includes('mdr-watermark-main">Money Director<')));
  check('no Asia Plus branding anywhere', pages.every(p => !/asia\s*plus/i.test(p)));
  check('page order: cover, summary, structure, MC', pages[0].includes('mdr-cover') && pages[1].includes('>สรุปผลการจำลอง<') && pages[2].includes('>โครงสร้างพอร์ตและสมมติฐานกองทุน<') && pages[3].includes('>วิถีความมั่งคั่ง 30 ปี (หักเงินเฟ้อ)<'));
  check('page numbers 2..4 of 4', [2, 3, 4].every(n => pages[n - 1].includes(`หน้า ${n} / 4`)));
  check('cover TOC lists 3 sections with page numbers', pages[0].includes('<span>สรุปผลการจำลอง</span><span>หน้า 2</span>') && pages[0].includes('<span>วิถีความมั่งคั่ง 30 ปี (Monte Carlo)</span><span>หน้า 4</span>') && !pages[0].includes('Heatmap</span>'));
  check('no customer-name field in report', pages.every(p => !p.includes('ชื่อลูกค้า')));
  // Summary numbers match what the app shows
  const surv = d.getElementById('metric-survival-rate').textContent;
  check('summary shows same survival rate as app', pages[1].includes(`>${surv}<`), surv);
  const y30 = Math.round(run(`globalExportData.resultsByYear.total[30].median`)).toLocaleString('th-TH');
  check('summary shows year-30 median', pages[1].includes(y30 + ' บาท'), y30);
  const cf10 = Math.round(run(`globalExportData.cashflows[9]`)).toLocaleString('th-TH');
  check('summary yearly table has year-10 cashflow', pages[1].includes(`<td>ปีที่ 10</td><td class="num">${cf10} บาท</td>`), cf10);
  // Structure: fund names/values, stats matrix values match app table
  check('structure lists all funds with entered values', ['ES-WDEQ', 'MGALL-UH', 'TGSMART-A', 'SCBGEARA'].every(n => pages[2].includes(`<td>${n}</td>`)) && pages[2].includes('<td class="num">14%</td>'));
  const appStats = [...d.querySelectorAll('#phase-metrics-body td')].map(td => td.textContent.trim()).filter(t => /%$/.test(t));
  const repStats = [...pages[2].matchAll(/<td class="num">(-?\d+\.\d{2}%)<\/td>/g)].map(m => m[1]);
  check('Phase Stats Matrix numbers identical to app table', appStats.length > 0 && JSON.stringify(appStats) === JSON.stringify(repStats), `${appStats.length} vs ${repStats.length}`);
  // MC chart was re-rendered from the live chart config with light theme
  const mcCfg = w.chartLog[w.chartLog.length - 1];
  check('MC chart re-rendered (line, 4 datasets, light ticks)', mcCfg.type === 'line' && mcCfg.data.datasets.length === 4 && mcCfg.options.scales.y.ticks.color === '#334155' && mcCfg.options.animation === false && mcCfg.options.responsive === false);
  check('on-screen chart options NOT mutated', run(`portfolioChartInstance.config.options.scales.y.ticks.color`) === '#94a3b8');
  check('on-screen chart data arrays NOT shared', mcCfg.data.datasets[1].data !== run(`portfolioChartInstance.config.data.datasets[1].data`));
  check('report DOM + overlay removed after export', !d.getElementById('mdr-report-root') && !d.getElementById('mdr-export-overlay'));
  check('pdfExportInProgress reset', run(`pdfExportInProgress`) === false);

  // ---------- 2b. Blank Expected fields render as "–" ----------
  {
    const e = makeEnv(FILE, 3, stubPdf);
    await runMain(e.run);
    captureRoot(e.w);
    await e.run(`generatePdfReport({})`);
    const st = e.w.capturedPages[2];
    check('blank Expected shown as – (not NaN/0/undefined)', st.includes('<td>ES-WDEQ</td><td class="num">20%</td><td class="num">–</td><td class="num">–</td><td class="num">–</td>') && !/NaN|undefined/.test(e.w.capturedPages.join('')));
  }

  // ---------- 3. Heatmap section ----------
  run(`document.getElementById('heatmap-rates').value = '3%, 4%, 50000'; runHeatmap();`);
  await flush(800);
  run(`openPdfModal()`);
  check('heatmap checkbox enabled + checked after Run Analysis', d.getElementById('pdf-opt-heatmap').disabled === false && d.getElementById('pdf-opt-heatmap').checked === true);
  const hmMeta = run(`JSON.stringify(lastHeatmapResult.meta)`);
  check('heatmap meta captured', hmMeta.includes('"ratesStr":"3%, 4%, 50000"') && hmMeta.includes('"benchmarkRateAnnual":1.5'), hmMeta);
  // structured rows agree with on-screen table
  const screenCells = [...d.querySelectorAll('#heatmap-body td div.font-semibold')].map(x => x.textContent);
  const dataCells = run(`JSON.stringify(lastHeatmapResult.rows.flatMap(r => r.cells.map(c => c.survRate.toFixed(1) + '%')))`);
  check('heatmap structured copy == on-screen table', JSON.stringify(screenCells) === dataCells, dataCells);

  // ---------- 4. Optimizer section ----------
  run(`runOptimizer('sharpe')`);
  run(`openPdfModal()`);
  check('optimizer checkbox enabled after Optimize', d.getElementById('pdf-opt-optimizer').disabled === false && d.getElementById('pdf-opt-optimizer').checked === true);
  check('optimizer note names port/phase/mode', d.getElementById('pdf-opt-optimizer-note').textContent.includes('เฟส 1') && d.getElementById('pdf-opt-optimizer-note').textContent.includes('Sharpe'));

  // ---------- 4a. Full report (both optional) ----------
  captureRoot(w);
  await run(`generatePdfReport({ includeHeatmap: true, includeOptimizer: true })`);
  doc = w.pdfLog.docs[w.pdfLog.docs.length - 1];
  const P = w.capturedPages;
  check('full report = 6 pages', doc.images.length === 6 && P.length === 6, P.length);
  check('page 5 = Heatmap, page 6 = Optimizer', P[4].includes('>Withdrawal Sustainability Heatmap<') && P[5].includes('>Portfolio Optimizer — Efficient Frontier<'));
  check('heatmap page cells + colors + FD', P[4].includes('mdr-heat-') && P[4].includes('FD:') && P[4].includes('3%, 4%, 50000'));
  check('optimizer page table lists funds + preset rows', ['ES-WDEQ', 'SCBGEARA'].every(n => P[5].includes(`<td>${n}</td>`)) && P[5].includes('<td>Sharpe สูงสุด</td>') && P[5].includes('<td>พอร์ตที่กรอกปัจจุบัน</td>'));
  check('frontier chart re-rendered as scatter', w.chartLog[w.chartLog.length - 1].type === 'scatter');
  check('full disclaimer + watermark on all 6 pages', P.every(p => p.includes(disclaimerCore) && p.includes('mdr-watermark-main')));
  check('page numbers x / 6', [2, 3, 4, 5, 6].every(n => P[n - 1].includes(`หน้า ${n} / 6`)));
  check('TOC includes heatmap p5 + optimizer p6', P[0].includes('<span>Withdrawal Sustainability Heatmap</span><span>หน้า 5</span>') && P[0].includes('<span>Portfolio Optimizer — Efficient Frontier</span><span>หน้า 6</span>'));

  // ---------- 4b. Only optimizer ----------
  captureRoot(w);
  await run(`generatePdfReport({ includeHeatmap: false, includeOptimizer: true })`);
  check('heatmap unticked => 5 pages, optimizer is page 5', w.capturedPages.length === 5 && w.capturedPages[4].includes('Efficient Frontier<'));

  // ---------- 5. Staleness of optional sections ----------
  run(`markDirty()`);
  check('markDirty marks heatmap stale', run(`lastHeatmapResult.stale`) === true);
  check('markDirty clears optimizer (hideOptimizerSection)', run(`optimizerCloud`) === null);
  await runMain(run);
  run(`openPdfModal()`);
  check('stale heatmap => checkbox disabled with reason', d.getElementById('pdf-opt-heatmap').disabled === true && d.getElementById('pdf-opt-heatmap-note').textContent.includes('Run Analysis ใหม่'));
  captureRoot(w);
  await run(`generatePdfReport({ includeHeatmap: true, includeOptimizer: true })`);
  check('requested-but-unavailable sections are skipped (4 pages)', w.capturedPages.length === 4);

  // ---------- 6. Pagination with a fake layout (jsdom has no layout) ----------
  run(`
    window.__origOverflow = mdrPageOverflows;
    mdrPageOverflows = function(p) { return p.inner.querySelectorAll('.mdr-port').length > 1 || p.inner.querySelectorAll('.mdr-port').length === 1 && p.inner.children.length > 3; };
    addPortfolio(); portfolios[2].allocWeight = 20; portfolios[1].allocWeight = 40;
  `);
  await runMain(run);
  captureRoot(w);
  await run(`generatePdfReport({})`);
  const Q = w.capturedPages;
  const structPages = Q.filter(p => p.includes('โครงสร้างพอร์ตและสมมติฐานกองทุน'));
  check('overflow => structure split into continuation pages', structPages.length >= 3 && Q.some(p => p.includes('โครงสร้างพอร์ตและสมมติฐานกองทุน (ต่อ)')), structPages.length);
  check('no portfolio card lost or duplicated', (Q.join('').match(/class="mdr-port mdr-block"/g) || []).length === 3);
  check('page numbering consistent after split', Q.every((p, i) => i === 0 || p.includes(`หน้า ${i + 1} / ${Q.length}`)));
  check('TOC points MC to correct page after split', Q[0].includes(`<span>วิถีความมั่งคั่ง 30 ปี (Monte Carlo)</span><span>หน้า ${Q.findIndex(p => p.includes('>วิถีความมั่งคั่ง 30 ปี (หักเงินเฟ้อ)<')) + 1}</span>`));
  run(`mdrPageOverflows = window.__origOverflow;`);

  // ---------- 7. Engine state untouched by export ----------
  const before = run(`JSON.stringify({p: portfolios, g: globalWithdrawal, e: globalExportData.cashflows})`);
  await run(`generatePdfReport({})`);
  check('export does not mutate portfolios/globalWithdrawal/results', before === run(`JSON.stringify({p: portfolios, g: globalWithdrawal, e: globalExportData.cashflows})`));

  // ---------- 8. Error path: html2canvas throws ----------
  w.html2canvas = async () => { throw new Error('boom'); };
  w.alertLog.length = 0;
  await run(`generatePdfReport({})`);
  check('error => alert, cleanup, flag reset', w.alertLog.some(a => a.includes('boom')) && !d.getElementById('mdr-report-root') && !d.getElementById('mdr-export-overlay') && run(`pdfExportInProgress`) === false);

  // ---------- 9. Missing libraries ----------
  w.html2canvas = undefined;
  w.alertLog.length = 0;
  await run(`generatePdfReport({})`);
  check('missing library => friendly alert', w.alertLog.some(a => a.includes('ไลบรารี')));

  console.log(`PASS ${results.pass}  FAIL ${results.fail.length}`);
  results.fail.forEach(f => console.log('  XX ' + f));
  process.exit(results.fail.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
