// The PV <-> Nominal toggle (chunk B).
//
// The tool has always shown every baht figure deflated back to today's money without ever
// saying so, which is what made the yield-only cashflow look like it was shrinking: it is,
// in purchasing power, and that is the true and useful reading. The fix was to label the
// basis and let the reader switch, not to drop PV -- at the default 2.5% inflation a 30-year
// nominal figure is about 2.1x its real purchasing power, so a page quietly showing nominal
// reads as a far safer plan than it is.
//
// Three things here are easy to get wrong and invisible when wrong:
//
//   1. PV must stay the default and must still produce the exact numbers it always did.
//      This is the backward-compatibility half; regression.test.js covers the engine, this
//      covers what the page renders.
//   2. Portfolio values convert by a single factor per year, cashflows do NOT -- each month
//      inside a year carries its own deflator. Converting a year's cashflow with the
//      year-end factor overshoots by about 1.1%, which looks plausible and is wrong. The
//      run therefore carries a second nominal series, and the checks below fail if the page
//      ever goes back to multiplying its way there.
//   3. The factor must come from the inflation rate the RUN used, not from the input box.
//      Editing that box marks results stale but leaves them on screen, so reading it live
//      would redraw an old run against a rate it never saw.
const fs = require('fs');
const { makeEnv, REAL_FUNDS, flush } = require('../lib/harness');
const { APP, requireFile } = require('../lib/paths');
const FILE = requireFile(APP, 'app under test');

const results = { pass: [], fail: [] };
const check = (name, cond, detail) =>
  cond ? results.pass.push(name) : results.fail.push(name + (detail ? ' :: ' + String(detail).slice(0, 170) : ''));

const num = (s) => Number(String(s).replace(/[^\d.-]/g, ''));
const close = (a, b, tol = 1e-9) => Math.abs(a - b) <= tol * Math.max(1, Math.abs(b));

(async () => {
  const { w, run } = makeEnv(FILE, 4242);
  const doc = w.document;
  run(REAL_FUNDS + `document.getElementById('btn-run-mc').click();`);
  await flush(500);

  run(`window.__ex = globalExportData;`);
  const pv = JSON.parse(run(`JSON.stringify(globalExportData.cashflows)`));
  const nom = JSON.parse(run(`JSON.stringify(globalExportData.cashflowsNominal)`));
  const infM = JSON.parse(run(`JSON.stringify(globalExportData.infMonthly)`));
  const cell = (y) => {
    const el = doc.getElementById('cf-year-' + y);
    return el ? num(el.textContent) : NaN;
  };
  const chartData = (label) => {
    const cfg = w.chartLog[w.chartLog.length - 1];
    const ds = cfg && cfg.data && cfg.data.datasets.find(d => d.label === label);
    return ds ? ds.data : null;
  };

  // ---------- 1. The run happened and carried both series ----------
  check('the run completed', JSON.parse(run(`JSON.stringify(hasRunOnce)`)) === true);
  check('a PV cashflow series was stored', Array.isArray(pv) && pv.length === 30, pv && pv.length);
  check('a nominal cashflow series was stored too', Array.isArray(nom) && nom.length === 30, nom && nom.length);
  check('the run recorded the monthly inflation it used',
    typeof infM === 'number' && isFinite(infM) && infM > 0, String(infM));
  check('the recorded rate matches the inflation input',
    close(infM, Math.pow(1 + (Number(doc.getElementById('inflation-rate').value) / 100), 1 / 12) - 1, 1e-12),
    String(infM));
  check('nominal is never below PV in a year with a withdrawal',
    pv.every((v, i) => v === 0 || nom[i] >= v));

  // ---------- 2. PV is the default and nothing moved ----------
  check('the page opens in PV', JSON.parse(run(`JSON.stringify(viewBasis)`)) === 'pv');
  check('the PV button is the active one',
    (doc.getElementById('basis-pv').className || '').includes('bg-purple-500/20'),
    doc.getElementById('basis-pv').className);
  check('the chart title says the figures are deflated',
    (doc.getElementById('chart-title-text').textContent || '').includes('หักเงินเฟ้อ'),
    doc.getElementById('chart-title-text').textContent);
  [10, 20, 30].forEach(y => {
    check(`PV table year ${y} is the stored PV figure, unscaled`,
      cell(y) === Math.round(pv[y - 1]), `${cell(y)} vs ${Math.round(pv[y - 1])}`);
  });
  const pvTotal = num(doc.getElementById('total-cf-withdrawn').textContent);
  check('PV total is the sum of the PV series',
    pvTotal === Math.round(pv.reduce((a, b) => a + b, 0)),
    `${pvTotal} vs ${Math.round(pv.reduce((a, b) => a + b, 0))}`);

  // ---------- 3. Flipping to nominal ----------
  doc.getElementById('basis-nominal').dispatchEvent(new w.Event('click', { bubbles: true }));
  await flush(50);
  check('the toggle switched the basis', JSON.parse(run(`JSON.stringify(viewBasis)`)) === 'nominal');
  check('the nominal button is now the active one',
    (doc.getElementById('basis-nominal').className || '').includes('bg-purple-500/20'));
  check('the chart title stops claiming the figures are deflated',
    !(doc.getElementById('chart-title-text').textContent || '').includes('หักเงินเฟ้อ') &&
    (doc.getElementById('chart-title-text').textContent || '').includes('ค่าในอนาคต'),
    doc.getElementById('chart-title-text').textContent);
  check('the cashflow column header names the basis',
    (doc.getElementById('cf-col-head').textContent || '').includes('ค่าในอนาคต'),
    doc.getElementById('cf-col-head').textContent);

  [10, 20, 30].forEach(y => {
    check(`nominal table year ${y} comes from the stored nominal series`,
      cell(y) === Math.round(nom[y - 1]), `${cell(y)} vs ${Math.round(nom[y - 1])}`);
  });

  // The whole reason the second series exists. A year's cashflow deflated month by month is
  // about 1.1% below the same figure scaled by the year-end factor -- close enough to look
  // right, far enough to be wrong by tens of thousands of baht over thirty years.
  [20, 30].forEach(y => {
    const naive = pv[y - 1] * Math.pow(1 + infM, 12 * y);
    check(`nominal year ${y} is NOT the year-end factor applied to the PV figure`,
      Math.abs(naive / nom[y - 1] - 1) > 0.005 && cell(y) !== Math.round(naive),
      `shown ${cell(y)} · stored ${Math.round(nom[y - 1])} · naive ${Math.round(naive)}`);
  });

  // ---------- 4. Portfolio values DO convert by the single yearly factor ----------
  // Deflated once a year by one factor, so the trip back is exact -- and because every path
  // at a given year is scaled by the same positive constant, the 10th/50th/90th stay the
  // same paths they were. No re-sorting, no re-running.
  const resTotal = JSON.parse(run(`JSON.stringify(globalExportData.resultsByYear.total)`));
  const median = chartData('Base (50th)');
  check('the chart was redrawn on the flip', Array.isArray(median) && median.length > 0,
    median && median.length);
  if (Array.isArray(median) && median.length === 31) {
    const bad = [];
    [5, 15, 30].forEach(y => {
      const want = resTotal[y].median * Math.pow(1 + infM, 12 * y);
      if (!close(median[y], want, 1e-9)) bad.push(`y${y}: ${median[y]} vs ${want}`);
    });
    check('every charted year is its PV value times that year\'s factor', bad.length === 0, bad.join(' | '));
    check('year 0 is untouched by the conversion', close(median[0], resTotal[0].median, 1e-9),
      `${median[0]} vs ${resTotal[0].median}`);
  } else {
    check('every charted year is its PV value times that year\'s factor', false,
      'chart series was not the expected 31 points: ' + (median && median.length));
  }

  // ---------- 5. Money actually paid in never flips ----------
  // "ทุนที่ใส่ไปจริง" is cash handed over, not a projection. Deflating it would answer a
  // question nobody asked, and the label does not carry a basis for exactly that reason.
  // The figure is written once, during a run -- so "it did not change when I flipped" is
  // true for free and proves nothing. The question is whether a run made WHILE nominal is
  // selected produces a different number, which is the way this could actually break.
  const capPvRun = doc.getElementById('metric-total-capital').textContent;
  check('its label carries no basis, because it is money actually paid in',
    !/หักเงินเฟ้อ|ค่าในอนาคต/.test(doc.getElementById('metric-total-capital').parentElement.textContent),
    doc.getElementById('metric-total-capital').parentElement.textContent.trim());

  doc.getElementById('basis-pv').dispatchEvent(new w.Event('click', { bubbles: true }));
  await flush(50);
  check('flipping back restores PV', JSON.parse(run(`JSON.stringify(viewBasis)`)) === 'pv');
  check('flipping back restores the PV figures', cell(20) === Math.round(pv[19]),
    `${cell(20)} vs ${Math.round(pv[19])}`);

  // ---------- 6. The conversion uses the run's rate, not the live input ----------
  // Editing the inflation box marks the results stale but leaves them on screen. Reading the
  // box at display time would quietly redraw the finished run against a rate it never saw.
  const inflEl = doc.getElementById('inflation-rate');
  inflEl.value = '9';
  inflEl.dispatchEvent(new w.Event('input', { bubbles: true }));
  doc.getElementById('basis-nominal').dispatchEvent(new w.Event('click', { bubbles: true }));
  await flush(50);
  check('changing the inflation box does not change the stored rate',
    JSON.parse(run(`JSON.stringify(globalExportData.infMonthly)`)) === infM);
  check('the cashflow table still shows the run\'s own nominal series',
    cell(30) === Math.round(nom[29]),
    `${cell(30)} vs ${Math.round(nom[29])}`);
  // The cashflow table reads a stored series, so it cannot notice a wrong rate. The portfolio
  // values are the ones multiplied by viewFactor, so they are where reading the live input
  // instead of the run's own rate actually shows up.
  const medianAfterEdit = chartData('Base (50th)');
  const wantY30 = resTotal[30].median * Math.pow(1 + infM, 360);
  check('portfolio values convert with the run\'s rate, not the edited input',
    Array.isArray(medianAfterEdit) && close(medianAfterEdit[30], wantY30, 1e-9),
    medianAfterEdit ? `${medianAfterEdit[30]} vs ${wantY30}` : '(no chart series)');
  inflEl.value = '2.5';
  inflEl.dispatchEvent(new w.Event('input', { bubbles: true }));
  doc.getElementById('basis-pv').dispatchEvent(new w.Event('click', { bubbles: true }));
  await flush(50);

  // ---------- 7. The fold: markup contract only ----------
  // Whether a click actually folds the panel is checked in the browser suite, not here.
  // tests/lib/harness.js calls setupUIEventListeners() itself right after evaluating the
  // page script, and jsdom then fires the real DOMContentLoaded during the first flush --
  // which calls it a second time. Every listener therefore ends up attached twice in this
  // harness, so one click runs a toggle twice and lands back where it started. That is an
  // artefact of the harness (a browser fires DOMContentLoaded once), and it is why a toggle
  // must never be asserted by clicking it here. Idempotent handlers are unaffected, which is
  // why the basis buttons above are safe: setting a basis twice sets the same basis.
  const detail = doc.getElementById('cf-detail');
  const foldBtn = doc.getElementById('btn-toggle-cf');
  check('the cashflow detail block exists', !!detail, '(element missing)');
  check('the cashflow detail starts open', detail && !detail.classList.contains('hidden'),
    detail ? detail.className : '(element missing)');
  check('the fold button exists', !!foldBtn, '(element missing)');
  check('the fold button offers to close, matching the open state',
    foldBtn && foldBtn.textContent.includes('ซ่อนรายละเอียด'),
    foldBtn ? foldBtn.textContent : '(element missing)');
  check('the fold button is big enough to tap',
    foldBtn && /min-h-\[32px\]/.test(foldBtn.className), foldBtn ? foldBtn.className : '');

  // 7b. The two basis buttons must stay tappable AFTER applyViewBasis has run, not just in the
  // markup. applyViewBasis assigns className wholesale, so sizing classes added to the HTML
  // alone are wiped the first time the basis is applied -- which is exactly how these two
  // shipped at 23px in the first place. The basis has already been flipped twice by now, so
  // both the selected and unselected strings have been applied to these elements.
  ['basis-pv', 'basis-nominal'].forEach(id => {
    const b = doc.getElementById(id);
    check(`#${id} is still big enough to tap after the basis was applied`,
      b && /min-h-\[32px\]/.test(b.className), b ? b.className : '(element missing)');
    check(`#${id} lays out as a flex box so min-height actually raises it`,
      b && /inline-flex/.test(b.className) && /items-center/.test(b.className),
      b ? b.className : '(element missing)');
  });
  // The markup is what the user sees in the moment before the script runs. If it drifts from
  // the on/off strings, the buttons visibly resize on load.
  const rawHtml = fs.readFileSync(FILE, 'utf8');
  const markup = rawHtml.match(/<button id="basis-(?:pv|nominal)"[^>]*>/g) || [];
  check('both basis buttons carry the sizing classes in the markup too', markup.length === 2 &&
    markup.every(m => /min-h-\[32px\]/.test(m) && /inline-flex/.test(m)), markup.join(' | '));

  // ---------- 8. The table shows the years it promises ----------
  const rows = doc.querySelectorAll('#cf-table-body tr');
  check('the table has one row per headline year', rows.length === 4, String(rows.length));
  [1, 10, 20, 30].forEach(y => {
    check(`row for year ${y} exists`, !!doc.getElementById('cf-year-' + y));
  });
  // Read through a null-safe accessor: the interesting failure is the element being gone,
  // and reading .textContent off null throws and takes the whole suite with it, reporting
  // nothing about the forty checks above.
  const cfNote = (doc.getElementById('cf-note') || {}).textContent || '';
  check('the caveat under the table is present', cfNote.length > 100, cfNote.length + ' chars');
  check('the caveat says the figure is a median, not a mean', /ค่ากลาง \(Median\)/.test(cfNote), cfNote.slice(0, 60));
  check('the caveat warns the total is a sum of medians', /ไม่เท่ากับค่ากลางของผลรวม/.test(cfNote), cfNote.slice(0, 60));

  // ---------- 9. A run made while nominal is selected (kept last on purpose) ----------
  // "ทุนที่ใส่ไปจริง" is written once, during a run, so checking that it did not change when
  // the basis flipped proves nothing -- nothing redraws it. The way this could actually break
  // is a run performed while nominal is selected, so that is what is done here. It runs the
  // engine again and advances the seeded PRNG, which is why it sits after every check that
  // compares against the first run's numbers.
  doc.getElementById('basis-nominal').dispatchEvent(new w.Event('click', { bubbles: true }));
  await flush(50);
  run(`document.getElementById('btn-run-mc').click();`);
  await flush(500);
  check('capital injected is identical whether the run happened in PV or in nominal',
    doc.getElementById('metric-total-capital').textContent === capPvRun,
    `nominal-run ${doc.getElementById('metric-total-capital').textContent} vs pv-run ${capPvRun}`);
  check('a run started in nominal leaves the page in nominal',
    JSON.parse(run(`JSON.stringify(viewBasis)`)) === 'nominal');
  const nom2 = JSON.parse(run(`JSON.stringify(globalExportData.cashflowsNominal)`));
  check('the fresh run produced its own nominal series',
    Array.isArray(nom2) && nom2.length === 30 && cell(30) === Math.round(nom2[29]),
    `${cell(30)} vs ${nom2 && Math.round(nom2[29])}`);

  console.log(`PASS ${results.pass.length}  FAIL ${results.fail.length}`);
  results.fail.forEach(f => console.log('  XX  ' + f));
  process.exit(results.fail.length ? 1 : 0);
})();
