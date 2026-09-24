// Regression: the PDF feature must not change any engine output.
const { makeEnv, REAL_FUNDS, flush } = require('../lib/harness');
const { APP, BASELINE, requireFile } = require('../lib/paths');
const OLD = requireFile(BASELINE, 'baseline build');
const NEW = requireFile(APP, 'app under test');

async function snapshot(file, scenario) {
  const { w, run } = makeEnv(file, 12345);
  run(scenario.setup);
  const sim = run(`JSON.stringify(runSimulation())`);
  run(`runDriftVisualizer()`);
  const drift = run(`JSON.stringify(globalDriftData)`);
  const dom = run(`JSON.stringify(['metric-survival-rate','cf-year-1','cf-year-10','cf-year-20','cf-year-30','total-cf-withdrawn','metric-total-capital','phase-metrics-body'].map(id => document.getElementById(id).innerHTML))`);
  run(`document.getElementById('heatmap-rates').value = '3%, 4%, 50000, 100000'; runHeatmap();`);
  await flush(600);
  const hm1 = w.document.getElementById('heatmap-body').innerHTML;
  run(`heatmapWithdrawalMode='planned'; runHeatmap();`);
  await flush(600);
  const hm2 = w.document.getElementById('heatmap-body').innerHTML;
  return { sim, drift, dom, hm1, hm2 };
}

const scenarios = [
  { name: 'new defaults (blank Expected)', setup: `` },
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
      const same = a[k] === b[k];
      if (!same) fails++;
      console.log(`${same ? 'OK ' : 'XX '} [${sc.name}] ${k} (${a[k].length} chars)`);
    }
  }
  console.log(fails === 0 ? 'ALL IDENTICAL' : `${fails} DIFFERENCES`);
  process.exit(fails ? 1 : 0);
})();
