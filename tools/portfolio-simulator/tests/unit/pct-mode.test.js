// The "% of portfolio" withdrawal mode (1.7.0) and the second survival measure that comes with it.
//
// Most of this suite runs with every fund's S.D. set to 0. With no volatility the whole 1,000-path
// simulation collapses to one deterministic path, which means the expected answer can be worked out
// here in plain arithmetic and compared against the engine, instead of asserting that one opaque
// number equals another opaque number. A test that only says "the output did not change" cannot
// tell a correct rule from a rule that was wrong from the first day.
//
// Two things are deliberately NOT asserted by clicking in jsdom: tests/lib/harness.js calls
// setupUIEventListeners() itself right after evaluating the page script, and jsdom then fires the
// real DOMContentLoaded during the first flush, which calls it a second time. Every listener is
// therefore attached twice here. Idempotent handlers (set a mode, paint a banner) survive that
// untouched and are safe to click; anything that flips state on each call is not.
const fs = require('fs');
const { makeEnv, flush } = require('../lib/harness');
const { APP, requireFile } = require('../lib/paths');
const FILE = requireFile(APP, 'app under test');
const XLSX = require('@e965/xlsx');

const results = { pass: [], fail: [] };
const check = (name, cond, detail) =>
  cond ? results.pass.push(name) : results.fail.push(name + (detail ? ' :: ' + String(detail).slice(0, 170) : ''));
const close = (a, b, tolRel) => Math.abs(a - b) <= Math.max(1e-9, Math.abs(b) * (tolRel === undefined ? 1e-9 : tolRel));
const num = (s) => Number(String(s).replace(/[^\d.-]/g, ''));
// updateGlobalWdMode is declared inside setupUIEventListeners and is not reachable from here, so
// the mode is switched the way a person switches it. Clicking is safe despite the harness attaching
// every listener twice (see the note at the top): the handler just sets a mode, so running it twice
// lands in the same place as running it once.
const BTN = { yield_only: 'global-wd-mode-yield', constant: 'global-wd-mode-constant',
              fixed_baht: 'global-wd-mode-fixed', pct_portfolio: 'global-wd-mode-pct' };
const pickMode = (run, mode) =>
  run(`document.getElementById('${BTN[mode]}').dispatchEvent(new window.Event('click', { bubbles: true }))`);

// One portfolio, no volatility, no DCA unless a scenario adds it. yield + capGain = total return.
const FLAT = (opts) => {
  const o = Object.assign({ yield: 2, capGain: 3, infl: 2.5, principal: 10000000, startY: 1, startM: 1 }, opts || {});
  return `
    document.getElementById('init-investment').value = ${o.principal};
    document.getElementById('inflation-rate').value = ${o.infl};
    document.getElementById('global-rebalance').value = 0;
    portfolios.length = 1; portfolios[0].allocWeight = 100;
    portfolios[0].topup = { amount: 0, growth: 0, freq: 1, startY: 1, startM: 1, endY: 1, endM: 1 };
    [1,2,3,4].forEach(i => { portfolios[0].fundsData[i] = [
      { id: 1, name: "FLAT", weight: 100, yield: ${o.yield}, capGain: ${o.capGain}, sd: 0 } ]; });
    globalWithdrawal.priorityOrder = [portfolios[0].id];
    globalWithdrawal.startY = ${o.startY}; globalWithdrawal.startM = ${o.startM};
  `;
};

// The same rule the engine is supposed to follow, written out independently: grow monthly at the
// annualised total return, re-fix the annual amount at the top of each simulation year off that
// moment's balance, pay a twelfth of it every month, never touch inflation.
function expectedPctPath({ principal, totalR, pct, startWdM, months }) {
  const g = Math.pow(1 + totalR, 1 / 12) - 1;
  let v = principal, base = 0, lockedYear = -1;
  for (let m = 1; m <= months; m++) {
    v *= (1 + g);
    if (m >= startWdM) {
      const simYear = Math.ceil(m / 12);
      if (lockedYear !== simYear) { base = v * (pct / 100); lockedYear = simYear; }
      v -= base / 12;
    }
  }
  return v;
}

(async () => {
  // ---------- 1. The mode is wired from end to end ----------
  {
    const { w, run } = makeEnv(FILE, 101);
    const doc = w.document;
    run(`window.__notes = WD_MODE_NOTES; window.__labels = PDF_WD_MODE_LABELS; window.__floor = SURVIVAL_PV_FLOOR;`);
    check('the mode has a button', !!doc.getElementById('global-wd-mode-pct'));
    check('the button carries the short label agreed for it',
      (doc.getElementById('global-wd-mode-pct') || {}).textContent.trim() === '% ของพอร์ต',
      (doc.getElementById('global-wd-mode-pct') || {}).textContent);
    check('the mode has a note under the buttons',
      typeof w.__notes.pct_portfolio === 'string' && w.__notes.pct_portfolio.length > 30, String(w.__notes.pct_portfolio));
    check('the note says the amount is re-set each year',
      /ตั้งยอดใหม่ทุกต้นปี/.test(w.__notes.pct_portfolio || ''), String(w.__notes.pct_portfolio));
    check('the note says inflation is not added on top',
      /ไม่บวกเงินเฟ้อ/.test(w.__notes.pct_portfolio || ''), String(w.__notes.pct_portfolio));
    check('the mode has a PDF label', typeof w.__labels.pct_portfolio === 'string' && w.__labels.pct_portfolio.length > 5);
    check('the percentage input exists with the agreed default of 4',
      (doc.getElementById('global-wd-pct') || {}).value === '4', (doc.getElementById('global-wd-pct') || {}).value);
    check('the percentage panel is hidden until the mode is chosen',
      run(`document.getElementById('global-wd-pct-settings').style.display`) === 'none',
      run(`document.getElementById('global-wd-pct-settings').style.display`));
    pickMode(run, 'pct_portfolio');
    check('choosing the mode reveals the percentage panel',
      run(`document.getElementById('global-wd-pct-settings').style.display`) === 'block');
    check('choosing the mode highlights its button',
      /emerald/.test(run(`document.getElementById('global-wd-mode-pct').className`)),
      run(`document.getElementById('global-wd-mode-pct').className`));
    check('the floor is the 25% agreed, as a shared constant', w.__floor === 0.25, String(w.__floor));
  }

  // ---------- 2. The withdrawal rule itself, against arithmetic done here ----------
  {
    const { run } = makeEnv(FILE, 202);
    run(FLAT({ yield: 2, capGain: 3, startY: 1, startM: 1 }));
    run(`globalWithdrawal.mode = 'pct_portfolio'; globalWithdrawal.pct = 4;`);
    const out = JSON.parse(run(`JSON.stringify(runSimulation(true))`));
    const got = out.resultsByYear.total[30].median;          // PV, deflated by 30 years of inflation
    const infl = 0.025;
    const nominal = expectedPctPath({ principal: 10000000, totalR: 0.05, pct: 4, startWdM: 1, months: 360 });
    const want = nominal / Math.pow(1 + infl, 30);
    check('with zero volatility the year-30 value matches the rule computed independently',
      close(got, want, 1e-6), `engine ${got} vs arithmetic ${want}`);

    // Doubling the rate must take strictly more out, and the balance must stay positive: taking a
    // share of what is left cannot reach zero. This is the property that makes "survived" useless.
    run(`globalWithdrawal.pct = 8;`);
    const out8 = JSON.parse(run(`JSON.stringify(runSimulation(true))`));
    check('a higher percentage leaves less behind',
      out8.resultsByYear.total[30].median < got, `${out8.resultsByYear.total[30].median} vs ${got}`);
    check('even a punishing rate never empties the portfolio',
      out8.resultsByYear.total[30].median > 0 && out8.survivalRate === 100,
      `value ${out8.resultsByYear.total[30].median}, survivalRate ${out8.survivalRate}`);
  }

  // ---------- 3. Inflation must not reach the withdrawal ----------
  // The discriminating test of the whole mode. Run the identical plan at 1% and at 6% inflation and
  // compare the NOMINAL cashflow: the amounts handed over must be byte-identical, because the base
  // is re-read from the portfolio and never escalated. The same comparison in "constant" mode must
  // fail -- that mode is defined by escalating -- which is what proves this test can tell them apart.
  {
    const nomCf = (mode, infl) => {
      const { run } = makeEnv(FILE, 303);
      run(FLAT({ infl }));
      run(`globalWithdrawal.mode = '${mode}'; globalWithdrawal.pct = 4; globalWithdrawal.startY = 1; globalWithdrawal.startM = 1;`);
      run(`runSimulation()`);
      return JSON.parse(run(`JSON.stringify(globalExportData.cashflowsNominal)`));
    };
    const lo = nomCf('pct_portfolio', 1), hi = nomCf('pct_portfolio', 6);
    check('the cash actually handed over is the same at 1% and 6% inflation',
      JSON.stringify(lo) === JSON.stringify(hi), `year30 ${lo[29]} vs ${hi[29]}`);
    const cLo = nomCf('constant', 1), cHi = nomCf('constant', 6);
    check('the same comparison separates this mode from "Yield ตั้งต้น +เงินเฟ้อ"',
      JSON.stringify(cLo) !== JSON.stringify(cHi), `year30 ${cLo[29]} vs ${cHi[29]}`);
  }

  // ---------- 4. Within a year the payment holds still; at the new year it moves ----------
  {
    const { run } = makeEnv(FILE, 404);
    run(FLAT({ yield: 2, capGain: 3 }));
    run(`globalWithdrawal.mode = 'pct_portfolio'; globalWithdrawal.pct = 4; globalWithdrawal.startY = 1; globalWithdrawal.startM = 1;`);
    run(`runSimulation()`);
    const cf = JSON.parse(run(`JSON.stringify(globalExportData.cashflowsNominal)`));
    // Year 1 is twelve equal payments of base/12, so the annual total is exactly the base, which is
    // 4% of the balance after the first month's growth.
    const g = Math.pow(1.05, 1 / 12) - 1;
    check('year 1 pays exactly the amount fixed at the start of year 1',
      close(cf[0], 10000000 * (1 + g) * 0.04, 1e-6), `${cf[0]} vs ${10000000 * (1 + g) * 0.04}`);
    check('the yearly amount changes from one year to the next',
      cf[1] !== cf[0] && cf[2] !== cf[1], `${cf[0]} / ${cf[1]} / ${cf[2]}`);
  }

  // ---------- 5. Starting mid-plan ----------
  {
    const { run } = makeEnv(FILE, 505);
    run(FLAT({ startY: 11, startM: 1 }));
    run(`globalWithdrawal.mode = 'pct_portfolio'; globalWithdrawal.pct = 5;`);
    run(`runSimulation()`);
    const cf = JSON.parse(run(`JSON.stringify(globalExportData.cashflowsNominal)`));
    check('nothing is withdrawn before the start year',
      cf.slice(0, 10).every(v => v === 0), JSON.stringify(cf.slice(0, 11)));
    check('withdrawals begin in the start year', cf[10] > 0, String(cf[10]));
    const out = JSON.parse(run(`JSON.stringify(runSimulation(true))`));
    const want = expectedPctPath({ principal: 10000000, totalR: 0.05, pct: 5, startWdM: 121, months: 360 }) / Math.pow(1.025, 30);
    check('a plan that starts in year 11 still matches the arithmetic',
      close(out.resultsByYear.total[30].median, want, 1e-6),
      `engine ${out.resultsByYear.total[30].median} vs arithmetic ${want}`);
  }

  // ---------- 6. The second survival measure ----------
  {
    const { w, run } = makeEnv(FILE, 606);
    const doc = w.document;
    run(FLAT({ yield: 2, capGain: 3 }));
    run(`globalWithdrawal.mode = 'yield_only';`);
    run(`runSimulation()`);
    check('the other three modes keep the original measure',
      run(`globalExportData.survivalKind`) === 'standard', run(`globalExportData.survivalKind`));
    check('and the original label with it',
      doc.getElementById('metric-survival-label').textContent === run(`SURVIVAL_LABELS.standard`),
      doc.getElementById('metric-survival-label').textContent);
    check('with no threshold line under it',
      doc.getElementById('metric-survival-floor').textContent === '',
      doc.getElementById('metric-survival-floor').textContent);

    run(`globalWithdrawal.mode = 'pct_portfolio'; globalWithdrawal.pct = 9;`);
    const out = JSON.parse(run(`JSON.stringify(runSimulation())`));
    check('the % mode switches to the 25% measure', out.survivalKind === 'pv_floor', out.survivalKind);
    check('the headline reported is the one the mode uses',
      out.headlineRate === out.pvFloorRate, `${out.headlineRate} vs ${out.pvFloorRate}`);
    check('the old measure still says 100% here, which is why it was replaced',
      out.survivalRate === 100, String(out.survivalRate));
    check('the new measure disagrees with it, so it is actually measuring something',
      out.pvFloorRate < 100, String(out.pvFloorRate));
    check('the label on screen changed with the measure',
      doc.getElementById('metric-survival-label').textContent === run(`SURVIVAL_LABELS.pv_floor`),
      doc.getElementById('metric-survival-label').textContent);
    check('the number on screen is the new headline',
      close(num(doc.getElementById('metric-survival-rate').textContent), out.headlineRate, 1e-3),
      doc.getElementById('metric-survival-rate').textContent);
    check('the threshold is spelled out in baht rather than left to be worked out',
      /เกณฑ์/.test(doc.getElementById('metric-survival-floor').textContent) &&
      close(num(doc.getElementById('metric-survival-floor').textContent), Math.round(out.pvFloorAmount), 1e-3),
      doc.getElementById('metric-survival-floor').textContent);
    check('no colour class on the new measure, whose bands are not the old ones',
      !/emerald|yellow|red/.test(doc.getElementById('metric-survival-rate').className),
      doc.getElementById('metric-survival-rate').className);
  }

  // ---------- 7. The threshold counts the DCA money too ----------
  // A plan that adds another portfolio's worth of money over twenty years must not be judged
  // against the opening balance alone. Both sides of the comparison are in today's baht: the
  // contributions are discounted one by one, so the PV total sits between the nominal total and
  // the opening balance, and is reproduced here from the same schedule.
  {
    const { run } = makeEnv(FILE, 707);
    run(FLAT({ yield: 2, capGain: 3 }));
    run(`portfolios[0].topup = { amount: 20000, growth: 0, freq: 1, startY: 1, startM: 1, endY: 20, endM: 12 };`);
    run(`globalWithdrawal.mode = 'pct_portfolio'; globalWithdrawal.pct = 4;`);
    const out = JSON.parse(run(`JSON.stringify(runSimulation())`));
    const infM = Math.pow(1.025, 1 / 12) - 1;
    let wantPV = 10000000;
    for (let m = 1; m <= 240; m++) wantPV += 20000 / Math.pow(1 + infM, m);
    check('the PV capital base is reproduced exactly from the DCA schedule',
      close(out.totalCapitalInjectedPV, wantPV, 1e-9), `${out.totalCapitalInjectedPV} vs ${wantPV}`);
    check('it sits below the nominal total, as discounting must put it',
      out.totalCapitalInjectedPV < out.totalCapitalInjected,
      `${out.totalCapitalInjectedPV} vs ${out.totalCapitalInjected}`);
    check('and above the opening balance, because the DCA money is counted at all',
      out.totalCapitalInjectedPV > 10000000, String(out.totalCapitalInjectedPV));
    check('the threshold is a quarter of that base',
      close(out.pvFloorAmount, 0.25 * out.totalCapitalInjectedPV, 1e-9),
      `${out.pvFloorAmount} vs ${0.25 * out.totalCapitalInjectedPV}`);
    // The whole reason for including DCA: judged against the opening balance alone this plan would
    // be held to a bar roughly 40% lower, and would pass on money it never actually kept.
    check('including DCA raises the bar well above the opening-balance version',
      out.pvFloorAmount > 0.25 * 10000000 * 1.1,
      `${out.pvFloorAmount} vs ${0.25 * 10000000}`);
  }

  // ---------- 8. The label describes the run, not the buttons ----------
  // Changing the mode marks results stale but deliberately leaves them on screen. If the label
  // followed the buttons it would retitle a number the previous mode produced, which is a worse
  // failure than a stale number: the number would then be wrong rather than merely old.
  {
    const { w, run } = makeEnv(FILE, 808);
    const doc = w.document;
    run(FLAT({}));
    run(`globalWithdrawal.mode = 'yield_only';`);
    run(`runSimulation()`);
    const before = doc.getElementById('metric-survival-rate').textContent;
    pickMode(run, 'pct_portfolio');
    await flush(30);
    check('clicking the mode button does switch the mode',
      run(`globalWithdrawal.mode`) === 'pct_portfolio', run(`globalWithdrawal.mode`));
    check('but the headline label still describes the run that produced the number',
      doc.getElementById('metric-survival-label').textContent === run(`SURVIVAL_LABELS.standard`),
      doc.getElementById('metric-survival-label').textContent);
    check('and the number itself is untouched',
      doc.getElementById('metric-survival-rate').textContent === before,
      `${doc.getElementById('metric-survival-rate').textContent} vs ${before}`);
    check('the stale warning is what tells the reader to re-run',
      run(`simResultsStale`) === true);
    run(`runSimulation()`);
    check('re-running moves the label to the new measure',
      doc.getElementById('metric-survival-label').textContent === run(`SURVIVAL_LABELS.pv_floor`),
      doc.getElementById('metric-survival-label').textContent);
  }

  // ---------- 9. The heatmap banner ----------
  {
    const { w, run } = makeEnv(FILE, 909);
    const doc = w.document;
    const banner = () => doc.getElementById('hm-mode-mismatch');
    check('the banner exists', !!banner());
    check('it is hidden in the other modes', banner().classList.contains('hidden'), banner().className);
    pickMode(run, 'pct_portfolio');
    check('it appears in the % mode', !banner().classList.contains('hidden'), banner().className);
    check('it says the mode can hardly run out, in the agreed wording',
      /ขนาดการถอนเปลี่ยนแปลงตามมูลค่าพอร์ตที่เหลืออยู่/.test(banner().textContent), banner().textContent.slice(0, 120));
    check('it also warns the table below tests a different rule',
      /คนละแบบ/.test(banner().textContent), banner().textContent.slice(0, 200));
    pickMode(run, 'yield_only');
    check('it goes away again when the mode changes back', banner().classList.contains('hidden'), banner().className);
  }

  // ---------- 10. Case file, both directions ----------
  {
    const A = makeEnv(FILE, 111);
    A.run(FLAT({}));
    A.run(`globalWithdrawal.mode = 'pct_portfolio'; globalWithdrawal.pct = 6.5;`);
    const wb = A.run(`buildCaseWorkbook('pct')`);
    const aoa = XLSX.utils.sheet_to_json(wb.Sheets['ตั้งค่าหลัก'], { header: 1 });
    const row = aoa.find(r => r[0] === 'wdPct');
    check('the percentage is written into the case file under its own key', !!row, JSON.stringify(aoa.map(r => r[0])));
    check('with the value that was set', row && Number(row[2]) === 6.5, row && String(row[2]));
    check('and the mode key records the new mode',
      (aoa.find(r => r[0] === 'wdMode') || [])[2] === 'pct_portfolio',
      JSON.stringify(aoa.find(r => r[0] === 'wdMode')));

    const B = makeEnv(FILE, 222);
    // Re-read through real bytes rather than handing the object across, so the numeric cell has
    // actually been through the spreadsheet format on the way.
    const bytes = Buffer.from(A.run(`XLSX.write(buildCaseWorkbook('pct'), { bookType:'xlsx', type:'array' })`));
    B.w.__wb = XLSX.read(bytes, { type: 'buffer' });
    const res = B.run(`importCaseFromWorkbook(window.__wb, { skipConfirm: true })`);
    check('opening the file restores the mode', B.run(`globalWithdrawal.mode`) === 'pct_portfolio', B.run(`globalWithdrawal.mode`));
    check('opening the file restores the percentage', B.run(`globalWithdrawal.pct`) === 6.5, String(B.run(`globalWithdrawal.pct`)));
    check('the input shows it', B.run(`document.getElementById('global-wd-pct').value`) === '6.5', B.run(`document.getElementById('global-wd-pct').value`));
    check('the panel is open after loading', B.run(`document.getElementById('global-wd-pct-settings').style.display`) === 'block');
    check('the banner is painted after loading, not only on a click',
      !B.w.document.getElementById('hm-mode-mismatch').classList.contains('hidden'),
      B.w.document.getElementById('hm-mode-mismatch').className);
    check('a clean case still imports without warnings', res.warnings.length === 0, JSON.stringify(res.warnings));
  }

  // ---------- 11. A hand-edited case file cannot push the rate out of range ----------
  {
    const mk = (pct) => {
      const A = makeEnv(FILE, 333);
      A.run(FLAT({}));
      A.run(`globalWithdrawal.mode='pct_portfolio'; globalWithdrawal.pct = 4;`);
      const wb = A.run(`buildCaseWorkbook('x')`);
      const sh = wb.Sheets['ตั้งค่าหลัก'];
      const aoa = XLSX.utils.sheet_to_json(sh, { header: 1 });
      const idx = aoa.findIndex(r => r[0] === 'wdPct');
      aoa[idx][2] = pct;
      wb.Sheets['ตั้งค่าหลัก'] = XLSX.utils.aoa_to_sheet(aoa);
      const B = makeEnv(FILE, 444);
      B.w.__wb = XLSX.read(Buffer.from(XLSX.write(wb, { bookType: 'xlsx', type: 'array' })), { type: 'buffer' });
      B.run(`importCaseFromWorkbook(window.__wb, { skipConfirm: true })`);
      return B.run(`globalWithdrawal.pct`);
    };
    check('a negative rate in the file is clamped to 0, not used to pay money in', mk(-5) === 0, String(mk(-5)));
    check('a rate above 100 is clamped to 100', mk(400) === 100, String(mk(400)));
    check('a blank cell falls back to the default of 4', mk('') === 4, String(mk('')));
  }

  // ---------- 12. Typed input is clamped as well ----------
  // min/max on a number input govern the spinner arrows only; a typed or pasted value goes
  // straight past them into the engine.
  {
    const { run } = makeEnv(FILE, 555);
    const type = (v) => {
      run(`(() => { const el = document.getElementById('global-wd-pct'); el.value = '${v}';
            el.dispatchEvent(new window.Event('input', { bubbles: true })); })()`);
      return run(`globalWithdrawal.pct`);
    };
    check('typing a negative percentage clamps to 0', type('-3') === 0, String(type('-3')));
    check('typing more than 100 clamps to 100', type('250') === 100, String(type('250')));
    check('typing a valid rate is kept', type('3.5') === 3.5, String(type('3.5')));
  }

  // ---------- 13. The report carries the same names and definitions as the page ----------
  {
    const src = fs.readFileSync(FILE, 'utf8');
    check('the report takes the headline name from the shared constant, not a second copy',
      /SURVIVAL_LABELS\.pv_floor/.test(src) && !/โอกาสเหลือกำลังซื้อ ≥ 25%'/.test(src.replace(/SURVIVAL_LABELS = \{[\s\S]*?\};/, '')),
      'a literal copy of the label exists outside the constant');
    check('the report prints the definition belonging to the run it is reporting',
      /SURVIVAL_NOTES\[survKind\]/.test(src), 'not keyed off the run');
    check('the report also carries the DCA-discipline caveat',
      /DISCLAIMER_DCA_DISCIPLINE/.test(src) && src.match(/DISCLAIMER_DCA_DISCIPLINE/g).length >= 3,
      String((src.match(/DISCLAIMER_DCA_DISCIPLINE/g) || []).length) + ' occurrences');
    check('the report rows name the rate and say inflation is not added',
      /อัตราถอนต่อปี/.test(src) && /การปรับตามเงินเฟ้อ/.test(src), 'rows missing');
  }

  console.log(`PASS ${results.pass.length}  FAIL ${results.fail.length}`);
  results.fail.forEach(f => console.log('  XX  ' + f));
  process.exit(results.fail.length ? 1 : 0);
})();
