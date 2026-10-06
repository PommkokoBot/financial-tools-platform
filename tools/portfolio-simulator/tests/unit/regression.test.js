// Regression: the PDF feature must not change any engine output.
const { makeEnv, REAL_FUNDS, flush } = require('../lib/harness');
const { APP, BASELINE, requireFile } = require('../lib/paths');
const OLD = requireFile(BASELINE, 'baseline build');
const NEW = requireFile(APP, 'app under test');

async function snapshot(file, scenario) {
  const { w, run } = makeEnv(file, 12345);
  run(scenario.setup);
  // Only the fields that existed before this release. runSimulation() gained maxDrawdown
  // in 1.2.0, and stringifying the whole object would make the snapshot differ for the one
  // change that was intended, hiding whether anything else moved. The new field is checked
  // separately below -- and in maxdd.test.js, which owns its arithmetic.
  const sim = run(`(() => { const r = runSimulation();
    return JSON.stringify({ resultsByYear: r.resultsByYear, randomPaths: r.randomPaths,
      cashflows: r.cashflows, survivalRate: r.survivalRate, totalCapitalInjected: r.totalCapitalInjected }); })()`);
  // Both surfaces of the new field: what runSimulation() hands back (read by the Optimizer's
  // comparison runs) and what it publishes for the report. Checking only one lets a build
  // that dropped the other pass as "identical".
  const hasNewField = run(`[typeof (runSimulation({ silent: true }).maxDrawdown || {}).median,
    typeof (globalExportData.maxDrawdown || {}).median].join('/')`);
  run(`runDriftVisualizer()`);
  const drift = run(`JSON.stringify(globalDriftData)`);
  const dom = run(`JSON.stringify(['metric-survival-rate','cf-year-1','cf-year-10','cf-year-20','cf-year-30','total-cf-withdrawn','metric-total-capital','phase-metrics-body'].map(id => document.getElementById(id).innerHTML))`);
  run(`document.getElementById('heatmap-rates').value = '3%, 4%, 50000, 100000'; runHeatmap();`);
  await flush(600);
  const hm1 = w.document.getElementById('heatmap-body').innerHTML;
  run(`heatmapWithdrawalMode='planned'; runHeatmap();`);
  await flush(600);
  const hm2 = w.document.getElementById('heatmap-body').innerHTML;
  return { sim, drift, dom, hasNewField, hm1, hm2 };
}

const scenarios = [
  // Whatever ships as the page default. Round C replaced the real-fund set with a generic
  // example set carrying numbers, so this scenario legitimately differed from the previous
  // baseline once -- and the baseline was promoted deliberately at that release. It is the
  // scenarios below, which set their own funds, that prove the engine math never moved.
  { name: 'page defaults', setup: `` },
  { name: 'real funds, yield_only', setup: REAL_FUNDS },
  { name: 'real funds, fixed_baht + gbm', setup: REAL_FUNDS + `globalWithdrawal.mode='fixed_baht'; globalWithdrawal.fixedAmt=60000; chartSimMethod='gbm'; heatmapSimMethod='gbm';` },
  { name: 'real funds, constant + volcluster + 3 ports', setup: REAL_FUNDS + `addPortfolio(); portfolios[2].allocWeight=20; portfolios[1].allocWeight=40; globalWithdrawal.mode='constant'; chartSimMethod='volcluster'; heatmapSimMethod='volcluster';` },
];

(async () => {
  let fails = 0;
  for (const sc of scenarios) {
    const a = await snapshot(OLD, sc);
    const b = await snapshot(NEW, sc);
    for (const k of Object.keys(a)) {
      // The new build must HAVE the new field and the baseline must not -- otherwise a
      // build that quietly dropped maxDrawdown would sail through as "identical".
      if (k === 'hasNewField') {
        const ok = a[k] === 'undefined/undefined' && b[k] === 'number/number';
        if (!ok) fails++;
        console.log(`${ok ? 'OK ' : 'XX '} [${sc.name}] maxDrawdown present in new build only (old=${a[k]} new=${b[k]})`);
        continue;
      }
      const same = a[k] === b[k];
      if (!same) fails++;
      console.log(`${same ? 'OK ' : 'XX '} [${sc.name}] ${k} (${a[k].length} chars)`);
    }
  }
  console.log(fails === 0 ? 'ALL IDENTICAL' : `${fails} DIFFERENCES`);
  process.exit(fails ? 1 : 0);
})();
