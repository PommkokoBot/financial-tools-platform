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
  const dom = run(`JSON.stringify(['metric-survival-rate','cf-year-1','cf-year-10','cf-year-20','cf-year-30','total-cf-withdrawn','metric-total-capital'].map(id => document.getElementById(id).innerHTML))`);
  // Kept separate from `dom` since 1.1.0: this table gained a VaR column, so its markup
  // legitimately differs from the baseline while every number in it must not. See
  // compareStats() below -- the comparison strips ONLY the new cell and then demands a
  // byte-for-byte match, so a changed Yield/Growth/Total/S.D. cell still fails.
  const stats = run(`document.getElementById('phase-metrics-body').innerHTML`);
  run(`document.getElementById('heatmap-rates').value = '3%, 4%, 50000, 100000'; runHeatmap();`);
  await flush(600);
  const hm1 = w.document.getElementById('heatmap-body').innerHTML;
  run(`heatmapWithdrawalMode='planned'; runHeatmap();`);
  await flush(600);
  const hm2 = w.document.getElementById('heatmap-body').innerHTML;
  return { sim, drift, dom, stats, hm1, hm2 };
}

// The VaR cell added in 1.1.0, as updatePhaseStatsTable() writes it.
// Leading \s* on purpose: the cell sits on its own line in the template literal, so the
// indentation in front of it belongs to the new column too. Leaving it behind would make
// every row differ by whitespace and hide whether the numbers actually matched.
const VAR_CELL = /\s*<td class="py-1\.5 text-center text-rose-300">\d+\.\d{2}%<\/td>/g;

// Compares the stats table of the new build against the baseline with the new VaR cells
// removed. Two guards keep this from quietly passing on a broken build:
//   - the strip must actually remove one cell per row (a vanished column fails here
//     instead of sailing through as "identical"),
//   - after stripping, the match is exact, so any existing cell that moved still fails.
function compareStats(oldHtml, newHtml) {
  const rows = (newHtml.match(/<tr/g) || []).length;
  const found = (newHtml.match(VAR_CELL) || []).length;
  if (rows === 0 || found !== rows) {
    return { same: false, why: `expected one VaR cell in each of ${rows} rows, found ${found}` };
  }
  const stripped = newHtml.replace(VAR_CELL, '');
  return { same: stripped === oldHtml, why: 'existing cells differ after removing the VaR column' };
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
      let same, why = '';
      if (k === 'stats') {
        const r = compareStats(a[k], b[k]);
        same = r.same; if (!same) why = ' :: ' + r.why;
      } else {
        same = a[k] === b[k];
      }
      if (!same) fails++;
      console.log(`${same ? 'OK ' : 'XX '} [${sc.name}] ${k} (${a[k].length} chars)${why}`);
    }
  }
  console.log(fails === 0 ? 'ALL IDENTICAL' : `${fails} DIFFERENCES`);
  process.exit(fails ? 1 : 0);
})();
