// Guards the Max Drawdown figure added in 1.2.0.
//
// The number is easy to produce and easy to produce WRONGLY in a way nobody notices,
// because any plausible-looking percentage passes a glance. The decision it encodes is
// that the drawdown is measured on a pure market index -- deposits and withdrawals are
// excluded -- so that a withdrawal plan spending itself down as intended does not report
// a catastrophic "loss". Everything below exists to keep that decision from quietly
// eroding:
//
//   1. With volatility switched off the arithmetic is fully determined, so sections 1
//      and 2 check the output against a number computed here rather than against the
//      app's own result.
//   2. Section 3 is the headline invariant: for a single-portfolio plan, adding a large
//      withdrawal must not move the drawdown by a single digit. If somebody ever changes
//      the measurement to run on the balance, this is the check that goes red.
//   3. Section 6 pins the caveat to the same constant on both surfaces, like the
//      disclaimer and the VaR note before it.
const { makeEnv, REAL_FUNDS } = require('../lib/harness');
const { APP, requireFile } = require('../lib/paths');

const FILE = requireFile(APP, 'app under test');
const results = { pass: [], fail: [] };
const check = (name, cond, detail) =>
  cond ? results.pass.push(name) : results.fail.push(name + (detail ? ' :: ' + detail : ''));
const near = (a, b, eps) => Math.abs(a - b) < (eps === undefined ? 1e-9 : eps);

// One fund, no volatility -> every month returns exactly the expected monthly return and
// the engine's randomness cannot influence the result.
const flatFunds = (capGain) => `
  while (portfolios.length > 1) deletePortfolio(portfolios[portfolios.length - 1].id);
  const f = [{ id: 1, name: "flat", weight: 100, yield: 0, capGain: ${capGain}, sd: 0 }];
  [1,2,3,4].forEach(i => portfolios[0].fundsData[i] = JSON.parse(JSON.stringify(f)));
`;

// ---------- 1. No volatility, positive return: a line that only goes up has no drawdown ----------
{
  const { run } = makeEnv(FILE, 5);
  run(flatFunds(7));
  const dd = JSON.parse(run(`JSON.stringify(runSimulation({ silent: true }).maxDrawdown)`));
  check('flat +7% portfolio has exactly zero drawdown',
    dd.median === 0 && dd.worst10 === 0, JSON.stringify(dd));
}

// ---------- 2. No volatility, negative return: the drawdown is computable by hand ----------
{
  const { run } = makeEnv(FILE, 5);
  run(flatFunds(-12));
  const dd = JSON.parse(run(`JSON.stringify(runSimulation({ silent: true }).maxDrawdown)`));
  // 360 months of a constant monthly loss, compounded. Peak is the starting index of 1.
  const monthly = Math.pow(1 - 0.12, 1 / 12) - 1;
  const expected = Math.pow(1 + monthly, 360) - 1;
  check('flat -12% portfolio drops to the compounded 30-year figure',
    near(dd.median, expected, 1e-12) && near(dd.worst10, expected, 1e-12),
    `got ${dd.median} want ${expected}`);
  // The same mistake the VaR formula had to avoid: a drawdown built from -12%/12 per month
  // would land somewhere else entirely.
  check('drawdown is NOT built from an arithmetic -12%/12 month',
    !near(dd.median, Math.pow(1 - 0.12 / 12, 360) - 1, 1e-6));
}

// ---------- 3. Cashflows do not touch the number (the whole design decision) ----------
{
  const base = makeEnv(FILE, 4321);
  base.run(`while (portfolios.length > 1) deletePortfolio(portfolios[portfolios.length - 1].id);` + REAL_FUNDS);
  const noWd = JSON.parse(base.run(`JSON.stringify(runSimulation({ silent: true }).maxDrawdown)`));

  const wd = makeEnv(FILE, 4321);
  wd.run(`while (portfolios.length > 1) deletePortfolio(portfolios[portfolios.length - 1].id);` + REAL_FUNDS +
    `globalWithdrawal.mode = 'fixed_baht'; globalWithdrawal.fixedAmt = 20000; globalWithdrawal.startY = 1;`);
  const withWd = wd.run(`JSON.stringify(runSimulation({ silent: true }))`);
  const withWdDd = JSON.parse(withWd).maxDrawdown;
  // Guard: if the withdrawal emptied the portfolio the index would simply stop moving and
  // this comparison would pass for the wrong reason.
  const survived = JSON.parse(withWd).survivalRate;
  check('withdrawal scenario did not deplete the portfolio (so the test means something)',
    survived === 100, `survivalRate ${survived}`);
  // Tolerance 1e-12, not exact equality: the index is a ratio, so cashflows cannot change
  // it mathematically, but they do change the magnitude of the floats being divided, which
  // moves the last bit or two. Measured difference is ~1e-16; anything that actually
  // measured the balance instead of the market would be off by percentage points.
  check('a 20,000/month withdrawal does not move the drawdown',
    near(noWd.median, withWdDd.median, 1e-12) && near(noWd.worst10, withWdDd.worst10, 1e-12),
    `${JSON.stringify(noWd)} vs ${JSON.stringify(withWdDd)}`);

  const dca = makeEnv(FILE, 4321);
  dca.run(`while (portfolios.length > 1) deletePortfolio(portfolios[portfolios.length - 1].id);` + REAL_FUNDS +
    `portfolios[0].topup = { amount: 50000, growth: 0, freq: 1, startY: 1, startM: 1, endY: 30, endM: 12 };`);
  const dcaDd = JSON.parse(dca.run(`JSON.stringify(runSimulation({ silent: true }).maxDrawdown)`));
  check('a 50,000/month DCA does not move the drawdown',
    near(noWd.median, dcaDd.median, 1e-12) && near(noWd.worst10, dcaDd.worst10, 1e-12),
    `${JSON.stringify(noWd)} vs ${JSON.stringify(dcaDd)}`);
}

// ---------- 4. Shape and ordering of the two reported numbers ----------
{
  const { w, run } = makeEnv(FILE, 2024);
  run(REAL_FUNDS);
  const r = JSON.parse(run(`JSON.stringify(runSimulation().maxDrawdown)`));
  check('both figures are negative or zero, never a gain',
    r.median <= 0 && r.worst10 <= 0, JSON.stringify(r));
  check('both figures stay within -100%', r.median >= -1 && r.worst10 >= -1, JSON.stringify(r));
  check('the bad case is at least as deep as the middle case',
    r.worst10 <= r.median, JSON.stringify(r));
  check('a volatile mix actually produces a drawdown', r.median < -0.01, JSON.stringify(r));

  // Same seed, more volatility -> deeper.
  const hv = makeEnv(FILE, 2024);
  hv.run(REAL_FUNDS + `portfolios.forEach(pt => [1,2,3,4].forEach(i => pt.fundsData[i].forEach(f => f.sd = f.sd * 2)));`);
  const hvDd = JSON.parse(hv.run(`JSON.stringify(runSimulation({ silent: true }).maxDrawdown)`));
  check('doubling S.D. deepens the drawdown', hvDd.median < r.median,
    `${hvDd.median} vs ${r.median}`);

  // ---------- 5. What the page shows ----------
  const card = w.document.getElementById('metric-max-drawdown');
  check('the metric card exists', !!card);
  check('card prints both figures, signed, to 1 decimal',
    card && /^-?\d+\.\d% \/ -?\d+\.\d%$/.test(card.textContent.trim()), card ? card.textContent : '(missing)');
  check('card matches the returned numbers',
    card && card.textContent.trim() === `${(r.median * 100).toFixed(1)}% / ${(r.worst10 * 100).toFixed(1)}%`,
    card ? card.textContent : '');
  check('globalExportData carries the drawdown for the report',
    run(`typeof globalExportData.maxDrawdown.median`) === 'number');

  // A silent run is what the Optimizer uses for its comparison runs. It must not repaint
  // the card with numbers from a portfolio the user is not looking at.
  const before = card.textContent;
  run(`runSimulation({ silent: true })`);
  check('a silent run leaves the card untouched', card.textContent === before, card.textContent);
}

// ---------- 6. The caveat travels with the number ----------
{
  const { w, run } = makeEnv(FILE, 77);
  run(`renderStaticChrome(); window.DISCLAIMER_MAXDD = DISCLAIMER_MAXDD; window.DISCLAIMER_RISK_METRICS = DISCLAIMER_RISK_METRICS;`);
  const note = w.document.getElementById('stats-risk-note');
  check('page note carries the drawdown caveat',
    note && note.textContent.includes(w.DISCLAIMER_MAXDD), note ? note.textContent.slice(-120) : '(missing)');
  check('page note still carries the VaR caveat too',
    note && note.textContent.includes(w.DISCLAIMER_RISK_METRICS));
  check('caveat says cashflows are excluded',
    /ไม่รวมเงินที่ใส่เพิ่มและเงินที่ถอนออก/.test(w.DISCLAIMER_MAXDD), w.DISCLAIMER_MAXDD);
  check('caveat says the bad case is not a worst-case bound',
    /ไม่ใช่ขอบเขตสูงสุด/.test(w.DISCLAIMER_MAXDD), w.DISCLAIMER_MAXDD);

  // 1.4.0 renamed the metric. The old Thai term is kept only as the gloss inside the
  // caveat sentence; anywhere else it means a rename was done in one place and missed in
  // another, which is how a tool ends up calling one number two things.
  run(`window.__html = document.documentElement.innerHTML;`);
  // split/join, not replace: the caveat appears twice in the document -- once as the
  // rendered note and once as the string literal in the inline script -- and removing
  // only the first would leave the literal behind and fail for the wrong reason.
  const strayOldTerm = w.__html.split(w.DISCLAIMER_MAXDD).join('').includes('ลงลึกสุด');
  check('the old term "ลงลึกสุด" survives only inside the caveat gloss', !strayOldTerm);
  check('the metric card is labelled Max Drawdown',
    /Max Drawdown/.test(w.document.getElementById('metric-max-drawdown').parentElement.textContent),
    w.document.getElementById('metric-max-drawdown').parentElement.textContent);
  check('the caveat still carries the Thai gloss once',
    /Max Drawdown \(การลงลึกสุดจากจุดสูงสุด\)/.test(w.DISCLAIMER_MAXDD), w.DISCLAIMER_MAXDD);

  run(REAL_FUNDS + `runSimulation();`);
  const summaryHtml = run(`(() => {
    const __root = document.createElement('div');
    const __pages = pdfBuildSummary({ root: __root, asOf: { date: '1 ม.ค. 2569', time: '09:00' } });
    return __pages.map(p => p.page.innerHTML).join('');
  })()`);
  const dd = JSON.parse(run(`JSON.stringify(globalExportData.maxDrawdown)`));
  check('PDF summary prints the same two figures as the page',
    summaryHtml.includes((dd.median * 100).toFixed(1) + '%') && summaryHtml.includes((dd.worst10 * 100).toFixed(1) + '%'),
    JSON.stringify(dd));
  check('PDF summary prints the same caveat constant',
    summaryHtml.includes(w.DISCLAIMER_MAXDD));
  check('PDF summary labels which figure is which',
    /เส้นทางกลาง \(50th\)/.test(summaryHtml) && /กรณีแย่ \(10th\)/.test(summaryHtml));
}

console.log(`PASS ${results.pass.length}  FAIL ${results.fail.length}`);
results.fail.forEach(f => console.log('  XX  ' + f));
process.exit(results.fail.length ? 1 : 0);
