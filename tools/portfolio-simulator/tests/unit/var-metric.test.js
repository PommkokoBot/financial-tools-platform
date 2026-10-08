// Guards the monthly 95% VaR column added in 1.1.0.
//
// Three things can go wrong here and none of them look wrong on screen:
//
//   1. The formula silently stops matching the engine. VaR is computed from the same two
//      numbers a simulated month uses -- expected monthly return (1+r)^(1/12)-1 and
//      monthly S.D. sd/sqrt(12). If somebody "simplifies" it to r/12, or to an arithmetic
//      monthly return, the column keeps printing a plausible percentage that no longer
//      describes the model that runs. Section 1 pins the arithmetic against values
//      computed independently here, not against the app's own constant.
//
//   2. The number is display-only, and must stay that way. Section 3 proves no engine
//      output moves when the funds that feed VaR are untouched -- the regression suite
//      covers the headline case, this covers the specific claim made in the code comment.
//
//   3. The caveat gets separated from the number. The sentence lives in ONE constant
//      shared by the page and the PDF, for the same reason the disclaimer does. Section 4
//      compares both rendered surfaces against that constant, so editing one side alone
//      turns this suite red.
const { makeEnv, REAL_FUNDS } = require('../lib/harness');
const { APP, requireFile } = require('../lib/paths');

const FILE = requireFile(APP, 'app under test');
const { w, run } = makeEnv(FILE, 11);

const results = { pass: [], fail: [] };
const check = (name, cond, detail) =>
  cond ? results.pass.push(name) : results.fail.push(name + (detail ? ' :: ' + detail : ''));
const near = (a, b, eps) => Math.abs(a - b) < (eps === undefined ? 1e-9 : eps);

run(`
  renderStaticChrome();
  window.monthlyVaR95 = monthlyVaR95;
  window.calculatePhaseStats = calculatePhaseStats;
  window.blendWeightedStats = blendWeightedStats;
  window.DISCLAIMER_RISK_METRICS = DISCLAIMER_RISK_METRICS;
  window.pdfPhaseStatsRows = pdfPhaseStatsRows;
`);

// Independent implementation of the intended formula. Written out longhand on purpose:
// importing the app's own constant and comparing it to itself would pass no matter what.
const Z95 = 1.6448536269514722;
const expectedVaR = (rAnnual, sdAnnual) =>
  Math.max(0, Z95 * (sdAnnual / Math.sqrt(12)) - (Math.pow(1 + rAnnual, 1 / 12) - 1));

// ---------- 1. The formula itself ----------
{
  const cases = [
    ['equity-like 8% / 18%', 0.08, 0.18],
    ['bond-like 4% / 4%', 0.04, 0.04],
    ['mixed 6% / 10%', 0.06, 0.10],
    ['high vol 10% / 35%', 0.10, 0.35],
  ];
  cases.forEach(([label, r, sd]) => {
    const got = w.monthlyVaR95(r, sd);
    check(`VaR matches the intended formula (${label})`, near(got, expectedVaR(r, sd), 1e-12),
      `got ${got} want ${expectedVaR(r, sd)}`);
  });

  // The documented worked example, to the 2 decimals the UI prints.
  // 18% / sqrt(12) = 5.1962% monthly S.D. -> x 1.6449 = 8.5471%, minus the COMPOUND
  // monthly return (1.08^(1/12)-1 = 0.6434%) = 7.90%. Using 8%/12 = 0.667% instead would
  // print 7.88%, which is the specific mistake check #3 below exists to catch.
  check('equity-like default prints 7.90%', (w.monthlyVaR95(0.08, 0.18) * 100).toFixed(2) === '7.90',
    (w.monthlyVaR95(0.08, 0.18) * 100).toFixed(2));

  // Guards against a drift back to the simpler-but-wrong r/12 drift term.
  const arithmetic = Math.max(0, Z95 * (0.18 / Math.sqrt(12)) - 0.08 / 12);
  check('VaR is NOT using the arithmetic r/12 monthly return',
    !near(w.monthlyVaR95(0.08, 0.18), arithmetic, 1e-9));

  check('zero S.D. gives 0, not a negative loss', w.monthlyVaR95(0.08, 0) === 0);
  check('blank / non-numeric S.D. gives 0', w.monthlyVaR95(0.08, '') === 0 && w.monthlyVaR95(0.08, NaN) === 0);
  check('VaR clamps at 0 when expected return outruns the risk',
    w.monthlyVaR95(2.0, 0.01) === 0, String(w.monthlyVaR95(2.0, 0.01)));
  check('higher S.D. always means higher VaR',
    w.monthlyVaR95(0.08, 0.30) > w.monthlyVaR95(0.08, 0.18));
  check('higher expected return always means lower VaR',
    w.monthlyVaR95(0.12, 0.18) < w.monthlyVaR95(0.08, 0.18));
}

// ---------- 2. VaR carried on the stats objects ----------
{
  const s = run(`JSON.stringify(calculatePhaseStats([
    { id: 1, name: "a", weight: 70, yield: 1, capGain: 7, sd: 18 },
    { id: 2, name: "b", weight: 30, yield: 2, capGain: 2, sd: 4 } ]))`);
  const st = JSON.parse(s);
  check('calculatePhaseStats returns var95', typeof st.var95 === 'number', JSON.stringify(st));
  check('phase var95 is built from the phase total return and correlated S.D.',
    near(st.var95, expectedVaR(st.totalR, st.sd), 1e-12), `${st.var95} vs ${expectedVaR(st.totalR, st.sd)}`);
  // The correlated S.D. is lower than the naive weighted average, so VaR must be too --
  // this is the diversification benefit the default fund set exists to show.
  const naiveSd = 0.7 * 0.18 + 0.3 * 0.04;
  check('default mix VaR is below the no-correlation VaR (diversification shows up)',
    st.var95 < expectedVaR(st.totalR, naiveSd), `${st.var95} vs ${expectedVaR(st.totalR, naiveSd)}`);

  const b = JSON.parse(run(`JSON.stringify(blendWeightedStats([
    { weight: 0.6, yield: 0.01, growth: 0.07, sd: 0.18 },
    { weight: 0.4, yield: 0.02, growth: 0.02, sd: 0.04 } ]))`));
  check('blendWeightedStats returns var95', typeof b.var95 === 'number', JSON.stringify(b));
  check('blended var95 is built from the blended total return and S.D.',
    near(b.var95, expectedVaR(b.totalR, b.sd), 1e-12), `${b.var95} vs ${expectedVaR(b.totalR, b.sd)}`);

  const invalid = JSON.parse(run(`JSON.stringify(calculatePhaseStats([]))`));
  check('empty fund list still yields a numeric var95 of 0',
    invalid.var95 === 0 && invalid.valid === false, JSON.stringify(invalid));
}

// ---------- 3. The column is rendered, and the page agrees with the PDF rows ----------
{
  run(REAL_FUNDS + `updatePhaseStatsTable();`);
  const d = w.document;
  const headers = [...d.querySelectorAll('thead th')].map(th => th.textContent.trim());
  check('table header carries a VaR column', headers.some(h => /VaR 95%/.test(h)), headers.join(' | '));

  const rows = [...d.querySelectorAll('#phase-metrics-body tr')];
  check('stats table rendered some rows', rows.length > 0, String(rows.length));
  check('every stats row has a VaR cell as its last column',
    rows.every(tr => /^\d+\.\d{2}%$/.test(tr.lastElementChild.textContent.trim())),
    rows.map(tr => tr.lastElementChild.textContent.trim()).join(','));

  // The PDF structure table is asserted elsewhere to match this table cell for cell;
  // here we check the underlying rows carry the same var95 the page printed.
  const pdfRows = JSON.parse(run(`JSON.stringify(pdfPhaseStatsRows().map(r => ({ type: r.type, var95: r.s.var95, sd: r.s.sd, totalR: r.s.totalR })))`));
  check('pdfPhaseStatsRows carry var95 for every row',
    pdfRows.length > 0 && pdfRows.every(r => typeof r.var95 === 'number'), JSON.stringify(pdfRows.slice(0, 2)));
  check('pdf row var95 matches the formula for that row',
    pdfRows.every(r => near(r.var95, expectedVaR(r.totalR, r.sd), 1e-12)));
  const pageVaRs = rows.map(tr => tr.lastElementChild.textContent.trim());
  const rowVaRs = pdfRows.map(r => (r.var95 * 100).toFixed(2) + '%');
  check('page VaR cells equal the PDF row values, in the same order',
    JSON.stringify(pageVaRs) === JSON.stringify(rowVaRs), `${pageVaRs.join(',')} vs ${rowVaRs.join(',')}`);
}

// ---------- 4. The caveat travels with the number ----------
{
  const d = w.document;
  const note = d.getElementById('risk-note-var');
  check('risk note element exists on the page', !!note);
  // Back to equality in chunk A: the three caveats were split out of the single paragraph
  // under the stats table into one bullet each, so this element now holds this constant and
  // nothing else. A hand-edited copy of the sentence on the page still fails here.
  check('risk note text comes from DISCLAIMER_RISK_METRICS',
    note && note.textContent === w.DISCLAIMER_RISK_METRICS, note ? note.textContent.slice(0, 80) : '(missing)');
  check('risk note says the normal assumption understates extremes',
    /กระจายตัวแบบปกติ/.test(w.DISCLAIMER_RISK_METRICS) && /ต่ำกว่า/.test(w.DISCLAIMER_RISK_METRICS),
    w.DISCLAIMER_RISK_METRICS);
  check('risk note says this is not the maximum possible loss',
    /ไม่ใช่ตัวเลขขาดทุนสูงสุด/.test(w.DISCLAIMER_RISK_METRICS), w.DISCLAIMER_RISK_METRICS);

  // Anti-drift: the PDF must print the same sentence, not a second copy of it.
  const structureHtml = run(`(() => {
    const __root = document.createElement('div');
    const __pages = pdfBuildStructure({ root: __root, asOf: { date: '1 ม.ค. 2569', time: '09:00' } });
    return __pages.map(p => p.page.innerHTML).join('');
  })()`);
  check('PDF structure page prints the same risk note',
    structureHtml.includes(w.DISCLAIMER_RISK_METRICS));
  check('PDF structure table has a VaR header',
    /VaR 95% \/ เดือน/.test(structureHtml));
}

// ---------- 5. VaR is display-only ----------
{
  // Same seed, same inputs, with and without reading the VaR values first: if VaR ever
  // consumed a random draw or mutated stats, these would diverge.
  const a = makeEnv(FILE, 99);
  a.run(REAL_FUNDS);
  const outA = a.run(`JSON.stringify(runSimulation({ silent: true }).resultsByYear.total.map(x => x.median))`);

  const b = makeEnv(FILE, 99);
  b.run(REAL_FUNDS);
  b.run(`portfolios.forEach(pt => [1,2,3,4].forEach(i => calculatePhaseStats(pt.fundsData[i]).var95)); updatePhaseStatsTable();`);
  const outB = b.run(`JSON.stringify(runSimulation({ silent: true }).resultsByYear.total.map(x => x.median))`);

  check('reading VaR does not change a single simulated number', outA === outB,
    `${String(outA).slice(0, 80)} vs ${String(outB).slice(0, 80)}`);
}

console.log(`PASS ${results.pass.length}  FAIL ${results.fail.length}`);
results.fail.forEach(f => console.log('  XX  ' + f));
process.exit(results.fail.length ? 1 : 0);
