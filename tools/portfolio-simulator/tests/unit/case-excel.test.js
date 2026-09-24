// Save/open a case as .xlsx — round trip through real workbook bytes, validation, UI reset.
const XLSX = require('xlsx');
const { makeEnv, flush } = require('../lib/harness');
const { APP, requireFile } = require('../lib/paths');
const FILE = requireFile(APP, 'app under test');
const results = { pass: 0, fail: [] };
const check = (name, cond, detail) => { if (cond) results.pass++; else results.fail.push(name + (detail !== undefined ? ' :: ' + detail : '')); };

// A deliberately awkward case: 3 portfolios, all 4 phases, blank Expected fields,
// special characters, non-default everything.
const COMPLEX = `
  addPortfolio();
  portfolios[0].name = 'พอร์ต "ปันผล" & <ลูกค้า A>';
  portfolios[0].allocWeight = 30; portfolios[1].allocWeight = 45; portfolios[2].allocWeight = 25;
  portfolios[0].topup = { amount: 12345, growth: 2.5, freq: 3, startY: 2, startM: 4, endY: 12, endM: 6 };
  portfolios[2].rebalance = { startY: 7, startM: 9 };
  portfolios.forEach((pt, i) => {
    pt.phaseSettings[2] = { enabled: true, startYear: 9 + i };
    pt.phaseSettings[3] = { enabled: true, startYear: 18 + i };
    pt.phaseSettings[4] = { enabled: i < 2, startYear: 24 + i };
    pt.fundsData[1] = [
      { id: 1, name: 'ES-WDEQ', weight: 20, yield: '', capGain: '', sd: '' },
      { id: 2, name: 'MGALL-UH', weight: 40, yield: 0.8, capGain: 6.5, sd: 14 },
      { id: 3, name: 'TGSMART-A', weight: 20, yield: 3, capGain: 2, sd: 6 },
      { id: 4, name: 'SCBGEARA "พิเศษ"', weight: 20, yield: 2.5, capGain: 1, sd: 3 }];
    pt.fundsData[2] = [
      { id: 5, name: 'MGALL-UH', weight: 40, yield: 0.8, capGain: 6.5, sd: 14 },
      { id: 6, name: 'TGSMART-A', weight: 60, yield: 3, capGain: 2, sd: 6 }];
    pt.fundsData[3] = [{ id: 7, name: 'KF-INCOME', weight: 100, yield: 3.2, capGain: 1.2, sd: 5 }];
    pt.fundsData[4] = [{ id: 8, name: 'ASP-AAA-R', weight: 100, yield: 1.8, capGain: 0.2, sd: 1.5 }];
  });
  globalWithdrawal = { mode: 'fixed_baht', fixedAmt: 77000, freq: 3, startY: 13, startM: 5, priorityOrder: [3, 1, 2] };
  chartSimMethod = 'gbm'; heatmapSimMethod = 'volcluster'; heatmapWithdrawalMode = 'planned';
  document.getElementById('init-investment').value = '12500000';
  document.getElementById('inflation-rate').value = '3.2';
  document.getElementById('global-rebalance').value = '6';
  document.getElementById('heatmap-rates').value = '2.5%, 5%, 80000';
  document.getElementById('heatmap-benchmark-rate').value = '2.1';
  document.getElementById('opt-conservative-min-return').value = '4.5';
  document.getElementById('opt-aggressive-max-risk').value = '12';
  renderPortTabs(); renderPriorityOrderUI(); syncActivePortUI(); updatePhaseStatsTable();
`;

// Everything that must survive save -> open.
const SNAPSHOT = `JSON.stringify({
  portfolios: portfolios.map(p => ({ name: p.name, allocWeight: p.allocWeight, topup: p.topup, rebalance: p.rebalance,
    phaseSettings: p.phaseSettings,
    funds: [1,2,3,4].map(ph => p.fundsData[ph].map(f => [f.name, f.weight, f.yield, f.capGain, f.sd])) })),
  withdrawal: globalWithdrawal,
  methods: [chartSimMethod, heatmapSimMethod, heatmapWithdrawalMode],
  inputs: ['init-investment','inflation-rate','global-rebalance','heatmap-rates','heatmap-benchmark-rate','opt-conservative-min-return','opt-aggressive-max-risk'].map(id => document.getElementById(id).value)
})`;

const bytes = (wb) => XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
const reread = (buf) => XLSX.read(buf, { type: 'buffer' });

(async () => {
  // ---------- 1. Round trip ----------
  const A = makeEnv(FILE, 5);
  A.run(COMPLEX);
  const before = A.run(SNAPSHOT);
  const buf = bytes(A.run(`buildCaseWorkbook('เคสทดสอบ A')`));
  check('workbook serializes to real xlsx bytes', buf.length > 3000, buf.length);

  const wbBack = reread(buf);
  check('sheets present', ['_meta', 'ตั้งค่าหลัก', 'พอร์ต', 'กองทุน', 'ผลจำลอง 30 ปี'].every(s => wbBack.SheetNames.includes(s)), wbBack.SheetNames.join('|'));

  const B = makeEnv(FILE, 9);
  B.w.__wb = wbBack;
  const res = B.run(`importCaseFromWorkbook(window.__wb, { skipConfirm: true })`);
  check('import reports 3 portfolios / 24 fund rows', res && res.portfolios === 3 && res.funds === 24, res && `${res.portfolios}/${res.funds}`);
  const after = B.run(SNAPSHOT);
  check('ROUND TRIP: every input identical after save -> open', before === after, (() => {
    const a = JSON.parse(before), b = JSON.parse(after);
    return Object.keys(a).filter(k => JSON.stringify(a[k]) !== JSON.stringify(b[k])).join(',') || 'n/a';
  })());
  check('blank Expected stays blank (not 0)', B.run(`JSON.stringify([portfolios[0].fundsData[1][0].yield, portfolios[0].fundsData[1][0].capGain, portfolios[0].fundsData[1][0].sd])`) === '["","",""]',
    B.run(`JSON.stringify([portfolios[0].fundsData[1][0].yield])`));
  check('special characters in names survive', B.run(`portfolios[0].name`) === 'พอร์ต "ปันผล" & <ลูกค้า A>' && B.run(`portfolios[0].fundsData[1][3].name`) === 'SCBGEARA "พิเศษ"', B.run(`portfolios[0].name`));
  check('priority order preserved', B.run(`globalWithdrawal.priorityOrder.join(',')`) === '3,1,2', B.run(`globalWithdrawal.priorityOrder.join(',')`));
  check('mode buttons restyled after import', B.run(`document.getElementById('global-wd-mode-fixed').className.includes('purple') && document.getElementById('sim-mc-gbm').className.includes('amber') && document.getElementById('sim-hm-volcluster').className.includes('amber') && document.getElementById('hm-wd-planned').className.includes('amber')`));
  check('fixed-withdrawal panel shown + fields filled', B.run(`document.getElementById('global-wd-fixed-settings').style.display`) === 'block' && B.run(`document.getElementById('global-wd-fixed-amt').value`) === '77000');
  check('names escaped in rendered tabs (no raw <)', !B.w.document.getElementById('port-tabs-container').innerHTML.includes('<ลูกค้า'));
  check('import produced no warnings for a clean case', res.warnings.length === 0, JSON.stringify(res.warnings));
  check('phase stats table re-rendered', B.w.document.getElementById('phase-metrics-body').innerHTML.includes('เฟส 4'));

  // ---------- 2. Results sheet rules ----------
  {
    const e = makeEnv(FILE, 4);
    let wb = e.run(`buildCaseWorkbook('x')`);
    let aoa = XLSX.utils.sheet_to_json(wb.Sheets['ผลจำลอง 30 ปี'], { header: 1 });
    check('no Run yet => results sheet explains why', aoa[0][0] === 'ยังไม่มีผลจำลองในไฟล์นี้' && String(aoa[1][1]).includes('ยังไม่ได้กด'), JSON.stringify(aoa[1]));
    check('meta hasResults FALSE', XLSX.utils.sheet_to_json(wb.Sheets['_meta'], { header: 1 }).find(r => r[0] === 'hasResults')[1] === 'FALSE');

    e.run(`document.getElementById('btn-run-mc').click()`);
    await flush(200);
    wb = e.run(`buildCaseWorkbook('x')`);
    aoa = XLSX.utils.sheet_to_json(wb.Sheets['ผลจำลอง 30 ปี'], { header: 1 });
    check('after Run => 31 data rows + header', aoa.length === 32 && aoa[0][0] === 'ปีที่ (Year)', aoa.length);
    check('year-30 median in sheet matches engine', Math.abs(aoa[31][3] - e.run(`globalExportData.resultsByYear.total[30].median`)) < 1e-6);
    check('meta hasResults TRUE', XLSX.utils.sheet_to_json(wb.Sheets['_meta'], { header: 1 }).find(r => r[0] === 'hasResults')[1] === 'TRUE');

    e.run(`markDirty()`);
    wb = e.run(`buildCaseWorkbook('x')`);
    aoa = XLSX.utils.sheet_to_json(wb.Sheets['ผลจำลอง 30 ปี'], { header: 1 });
    check('stale results are NOT written to the file', aoa[0][0] === 'ยังไม่มีผลจำลองในไฟล์นี้' && String(aoa[1][1]).includes('แก้ค่าหลัง Run'), JSON.stringify(aoa[1]));
    check('case modal status warns when stale', (e.run(`openCaseModal()`), e.w.document.getElementById('case-results-status').textContent.includes('ไม่ตรงกับค่าที่แก้ไว้')));
  }

  // ---------- 3. Import clears the previous run ----------
  {
    const e = makeEnv(FILE, 6);
    e.run(`document.getElementById('btn-run-mc').click()`);
    await flush(200);
    e.run(`document.getElementById('heatmap-rates').value='3%'; runHeatmap();`);
    await flush(600);
    e.run(`runOptimizer('sharpe')`);
    check('setup: has run + heatmap + optimizer', e.run(`hasRunOnce && !!lastHeatmapResult && !!optimizerCloud`));
    e.w.__wb = reread(buf);
    e.run(`importCaseFromWorkbook(window.__wb, { skipConfirm: true })`);
    check('import clears run state', e.run(`hasRunOnce === false && simResultsStale === false && lastHeatmapResult === null && optimizerCloud === null && portfolioChartInstance === null`));
    check('import clears metrics + heatmap table', e.w.document.getElementById('metric-survival-rate').textContent === '-- %' && e.w.document.getElementById('cf-year-10').textContent === '--' && e.w.document.getElementById('heatmap-body').innerHTML.includes('Run Analysis'));
    check('status badge says case opened', e.w.document.getElementById('status-badge').innerHTML.includes('เปิดเคสแล้ว'));
    check('optimizer section hidden', e.w.document.getElementById('section-optimizer').classList.contains('hidden'));
    // and the imported case can be run immediately
    e.run(`document.getElementById('btn-run-mc').click()`);
    await flush(300);
    check('imported case runs without error', e.run(`hasRunOnce && isFinite(globalExportData.resultsByYear.total[30].median)`));
  }

  // ---------- 4. Tolerant to Excel edits: reordered columns, renamed Thai labels, extra title row ----------
  {
    const wb = reread(buf);
    const ports = XLSX.utils.sheet_to_json(wb.Sheets['พอร์ต'], { header: 1 });
    const order = [...ports[1].keys()].reverse(); // reverse every column
    const shuffled = ports.map(r => order.map(i => r[i]));
    shuffled[0] = shuffled[0].map(() => 'ชื่อคอลัมน์ที่ผู้ใช้แก้เอง');
    wb.Sheets['พอร์ต'] = XLSX.utils.aoa_to_sheet([['เคสของลูกค้า A (แถวที่ผู้ใช้แทรกเอง)'], ...shuffled]);
    const e = makeEnv(FILE, 2);
    e.w.__wb = wb;
    let ok = true, err = '';
    try { e.run(`importCaseFromWorkbook(window.__wb, { skipConfirm: true })`); } catch (ex) { ok = false; err = ex.message; }
    check('columns reversed + labels renamed + extra row => still imports', ok && e.run(`portfolios.length`) === 3 && e.run(`portfolios[0].allocWeight`) === 30, err);
  }

  // ---------- 5. Edited values in Excel are picked up ----------
  {
    const wb = reread(buf);
    const funds = XLSX.utils.sheet_to_json(wb.Sheets['กองทุน'], { header: 1 });
    funds[2][4] = 9.9;  // first fund row, Yield column
    wb.Sheets['กองทุน'] = XLSX.utils.aoa_to_sheet(funds);
    const st = XLSX.utils.sheet_to_json(wb.Sheets['ตั้งค่าหลัก'], { header: 1 });
    st.find(r => r[0] === 'initInvestment')[2] = 7000000;
    wb.Sheets['ตั้งค่าหลัก'] = XLSX.utils.aoa_to_sheet(st);
    const e = makeEnv(FILE, 3);
    e.w.__wb = wb;
    e.run(`importCaseFromWorkbook(window.__wb, { skipConfirm: true })`);
    check('value edited in Excel is imported', e.run(`portfolios[0].fundsData[1][0].yield`) === 9.9 && e.w.document.getElementById('init-investment').value === '7000000');
  }

  // ---------- 6. Rejections (nothing applied) ----------
  const expectReject = (label, mutate, expectText) => {
    const wb = reread(buf);
    mutate(wb);
    const e = makeEnv(FILE, 8);
    const stateBefore = e.run(SNAPSHOT);
    e.w.__wb = wb;
    let msg = '';
    try { e.run(`importCaseFromWorkbook(window.__wb, { skipConfirm: true })`); } catch (ex) { msg = ex.message; }
    check(label, msg.includes(expectText) && e.run(SNAPSHOT) === stateBefore, msg || '(no error thrown)');
  };
  expectReject('reject: no _meta sheet', wb => { delete wb.Sheets['_meta']; wb.SheetNames = wb.SheetNames.filter(n => n !== '_meta'); }, 'ไม่พบชีต "_meta"');
  expectReject('reject: another tool\'s case', wb => {
    const a = XLSX.utils.sheet_to_json(wb.Sheets['_meta'], { header: 1 }); a.find(r => r[0] === 'tool')[1] = 'retire-rich-planner';
    wb.Sheets['_meta'] = XLSX.utils.aoa_to_sheet(a);
  }, 'เคสของเครื่องมืออื่น');
  expectReject('reject: newer schema version', wb => {
    const a = XLSX.utils.sheet_to_json(wb.Sheets['_meta'], { header: 1 }); a.find(r => r[0] === 'schemaVersion')[1] = 99;
    wb.Sheets['_meta'] = XLSX.utils.aoa_to_sheet(a);
  }, 'เวอร์ชันใหม่กว่า');
  expectReject('reject: portId column removed', wb => {
    const a = XLSX.utils.sheet_to_json(wb.Sheets['พอร์ต'], { header: 1 }).map(r => r.slice(1));
    wb.Sheets['พอร์ต'] = XLSX.utils.aoa_to_sheet(a);
  }, 'ไม่พบแถวคีย์');
  expectReject('reject: 4 portfolios', wb => {
    const a = XLSX.utils.sheet_to_json(wb.Sheets['พอร์ต'], { header: 1 });
    const extra = a[2].slice(); extra[0] = 99; a.push(extra);
    wb.Sheets['พอร์ต'] = XLSX.utils.aoa_to_sheet(a);
  }, 'สูงสุด 3 พอร์ต');
  expectReject('reject: duplicate portId', wb => {
    const a = XLSX.utils.sheet_to_json(wb.Sheets['พอร์ต'], { header: 1 }); a[3][0] = a[2][0];
    wb.Sheets['พอร์ต'] = XLSX.utils.aoa_to_sheet(a);
  }, 'ซ้ำกับแถวก่อนหน้า');
  expectReject('reject: fund pointing at unknown portfolio', wb => {
    const a = XLSX.utils.sheet_to_json(wb.Sheets['กองทุน'], { header: 1 }); a[2][0] = 77;
    wb.Sheets['กองทุน'] = XLSX.utils.aoa_to_sheet(a);
  }, 'ไม่มีอยู่ในชีตพอร์ต');
  expectReject('reject: bad phase number', wb => {
    const a = XLSX.utils.sheet_to_json(wb.Sheets['กองทุน'], { header: 1 }); a[2][1] = 7;
    wb.Sheets['กองทุน'] = XLSX.utils.aoa_to_sheet(a);
  }, 'เฟสต้องเป็น 1–4');
  expectReject('reject: fund with no name', wb => {
    const a = XLSX.utils.sheet_to_json(wb.Sheets['กองทุน'], { header: 1 }); a[2][2] = '';
    wb.Sheets['กองทุน'] = XLSX.utils.aoa_to_sheet(a);
  }, 'ไม่มีชื่อกองทุน');

  // ---------- 7. Warnings (import still succeeds) ----------
  {
    const wb = reread(buf);
    const a = XLSX.utils.sheet_to_json(wb.Sheets['กองทุน'], { header: 1 });
    a[2][3] = 5; // weights no longer sum to 100
    wb.Sheets['กองทุน'] = XLSX.utils.aoa_to_sheet(a);
    const p = XLSX.utils.sheet_to_json(wb.Sheets['พอร์ต'], { header: 1 });
    p[2][12] = 'FALSE'; // phase 2 off but 3/4 on  -> auto-corrected + warning
    p[2][1] = '';       // no name -> warning
    wb.Sheets['พอร์ต'] = XLSX.utils.aoa_to_sheet(p);
    const e = makeEnv(FILE, 10);
    e.w.__wb = wb;
    const r = e.run(`importCaseFromWorkbook(window.__wb, { skipConfirm: true })`);
    const w = r.warnings.join(' | ');
    check('warn: weights not 100%', w.includes('น้ำหนักกองทุนรวม'), w);
    check('warn: phase opened out of order + auto-corrected', w.includes('เปิดเฟสข้ามลำดับ') && e.run(`portfolios[0].phaseSettings[3].enabled`) === false);
    check('warn: missing portfolio name replaced', w.includes('ไม่มีชื่อ') && e.run(`portfolios[0].name`) === 'พอร์ต 1');
    check('import still applied despite warnings', e.run(`portfolios.length`) === 3);
  }

  // ---------- 8. confirm() cancel => nothing changes ----------
  {
    const e = makeEnv(FILE, 12, (w) => { w.confirm = () => false; });
    const stateBefore = e.run(SNAPSHOT);
    e.w.__wb = reread(buf);
    const r = e.run(`importCaseFromWorkbook(window.__wb)`);
    check('cancelling the confirm leaves everything untouched', r === null && e.run(SNAPSHOT) === stateBefore);
  }

  // ---------- 9. File naming ----------
  {
    const e = makeEnv(FILE, 13);
    check('file name uses the case name', /^PortfolioCase_ลูกค้า_A_\d{4}-\d{2}-\d{2}_\d{4}\.xlsx$/.test(e.run(`caseFileName('ลูกค้า A')`)), e.run(`caseFileName('ลูกค้า A')`));
    check('file name sanitizes illegal characters', e.run(`caseFileName('a/b:c*?"<>|d')`).includes('abcd'), e.run(`caseFileName('a/b:c*?"<>|d')`));
    check('no case name => date-only file name', /^PortfolioCase_\d{4}-\d{2}-\d{2}_\d{4}\.xlsx$/.test(e.run(`caseFileName('')`)), e.run(`caseFileName('')`));
  }

  // ---------- 10. Save paths: Save-dialog (File System Access) / fallback download / cancel ----------
  {
    // 10a. Save dialog available -> bytes written through the handle, no plain download
    const e = makeEnv(FILE, 21, (w) => {
      w.captured = null; w.wroteViaDownload = false;
      w.Blob = class { constructor(parts) { this.parts = parts; } };
      w.showSaveFilePicker = async (opts) => { w.pickerOpts = opts; return {
        createWritable: async () => ({ write: async (b) => { w.captured = b; }, close: async () => { w.closed = true; } })
      }; };
    });
    e.run(`XLSX.writeFile = () => { window.wroteViaDownload = true; };`);
    e.run(`document.getElementById('case-name-input').value = 'ลูกค้า A';`);
    await e.run(`exportCaseToExcel()`);
    check('save dialog: suggested name keeps the Thai case name', /ลูกค้า_A/.test(e.w.pickerOpts.suggestedName), e.w.pickerOpts && e.w.pickerOpts.suggestedName);
    check('save dialog: workbook bytes written through the handle', !!e.w.captured && e.w.closed === true && e.w.wroteViaDownload === false);
    const wroteBytes = e.w.captured.parts[0];
    check('save dialog: bytes are a real xlsx that re-imports', (() => {
      try { const wb2 = XLSX.read(Buffer.from(wroteBytes), { type: 'buffer' }); return wb2.SheetNames.includes('กองทุน'); } catch (x) { return false; }
    })());
    check('save dialog: modal closed after saving', e.w.document.getElementById('case-modal').classList.contains('hidden'));

    // 10b. User cancels the dialog -> nothing saved at all
    const c = makeEnv(FILE, 22, (w) => {
      w.wroteViaDownload = false;
      w.showSaveFilePicker = async () => { const err = new Error('cancel'); err.name = 'AbortError'; throw err; };
    });
    c.run(`XLSX.writeFile = () => { window.wroteViaDownload = true; };`);
    c.run(`openCaseModal()`);
    await c.run(`exportCaseToExcel()`);
    check('cancel: no file written and modal stays open', c.w.wroteViaDownload === false && !c.w.document.getElementById('case-modal').classList.contains('hidden') && c.w.alertLog.length === 0);

    // 10c. Browser without the API -> plain download fallback
    const f = makeEnv(FILE, 23, (w) => { w.dl = null; });
    f.run(`delete window.showSaveFilePicker; XLSX.writeFile = (wb, name) => { window.dl = name; };`);
    await f.run(`document.getElementById('case-name-input').value = 'Case B'; exportCaseToExcel();`);
    check('fallback: plain download used with the right file name', /^PortfolioCase_Case_B_/.test(f.w.dl || ''), f.w.dl);
    check('fallback: modal closed', f.w.document.getElementById('case-modal').classList.contains('hidden'));

    // 10d. Dialog blocked by the browser (non-Abort error) -> falls back instead of failing
    const g = makeEnv(FILE, 24, (w) => { w.dl = null; w.showSaveFilePicker = async () => { throw new Error('blocked by policy'); }; });
    g.run(`XLSX.writeFile = (wb, name) => { window.dl = name; };`);
    await g.run(`exportCaseToExcel()`);
    check('blocked dialog: falls back to plain download, no error alert', !!g.w.dl && g.w.alertLog.length === 0, g.w.dl);
  }

  console.log(`PASS ${results.pass}  FAIL ${results.fail.length}`);
  results.fail.forEach(f => console.log('  XX ' + f));
  process.exit(results.fail.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
