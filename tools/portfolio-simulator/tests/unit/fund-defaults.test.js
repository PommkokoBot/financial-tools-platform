// Guards the default fund set the page loads with.
//
// The public default is deliberately NOT the team's real funds. Expected-return numbers
// printed next to a real fund's ticker on a public page read as a forecast for that fund,
// which is the one thing the disclaimer says this tool does not do. The real set is
// distributed as a case file instead.
//
// The S.D. values are load-bearing beyond risk: classifyAsset() buckets sd >= 8 as Equity
// and sd <= 4 as Bond, and getCorrelation() only returns the diversifying -0.10 for that
// exact pair. A bond fund at sd = 6 lands in "Mixed" (+0.70) and the very first thing a
// visitor sees would show no diversification benefit at all. Section 2 below pins that.
const fs = require('fs');
const vm = require('vm');
const { JSDOM } = require('jsdom');

const { APP, requireFile } = require('../lib/paths');
const html = fs.readFileSync(requireFile(APP, 'app under test'), 'utf8');
const scriptMatch = html.match(/<script>([\s\S]*?)<\/script>/);
if (!scriptMatch) throw new Error('No inline script found');
let script = scriptMatch[1];

const dom = new JSDOM(html, { runScripts: 'outside-only', pretendToBeVisual: true });
const { window } = dom;
const vmContext = dom.getInternalVMContext();

// Seeded PRNG substituted for Math.random so results are deterministic.
let seed = 42;
window.Math.random = function() {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  return (seed % 1000000) / 1000000;
};

// Stub canvas getContext (jsdom doesn't implement it)
window.HTMLCanvasElement.prototype.getContext = function() { return {}; };

// Stub Chart.js as a config-recording class
window.Chart = class {
  constructor(ctx, config) { this.config = config; }
  destroy() {}
};

// marked stub (used only by AI modal, unused in our tests)
window.marked = { parse: (x) => x };

const initScript = `
setupUIEventListeners();
renderPortTabs();
renderPriorityOrderUI();
renderChartPortOptions();
syncActivePortUI();
updatePhaseStatsTable();
`;

vm.runInContext(script, vmContext);
vm.runInContext(initScript, vmContext);
// Top-level const/let in a vm context land in the lexical environment, not on the
// global object, so explicitly copy the identifiers this test needs onto window.
vm.runInContext(`
  window.templatePhase1 = templatePhase1;
  window.templatePhase2 = templatePhase2;
  window.portfolios = portfolios;
  window.globalWithdrawal = globalWithdrawal;
  window.globalDriftData = globalDriftData;
  window.globalExportData = globalExportData;
  window.classifyAsset = classifyAsset;
  window.getCorrelation = getCorrelation;
`, vmContext);

const results = { pass: [], fail: [] };
function check(name, cond, detail) {
  if (cond) results.pass.push(name);
  else results.fail.push(name + (detail ? ' :: ' + detail : ''));
}
const near = (a, b, tol) => Math.abs(a - b) < (tol === undefined ? 1e-9 : tol);

const EQUITY = 'กองทุนหุ้น (ตัวอย่าง)';
const BOND = 'กองทุนตราสารหนี้ (ตัวอย่าง)';

// --- 1. Template sanity ---
const t1 = window.templatePhase1;
const t2 = window.templatePhase2;
check('templatePhase1 has 2 funds', t1.length === 2, JSON.stringify(t1));
check('templatePhase2 has 2 funds', t2.length === 2, JSON.stringify(t2));
check('templatePhase1 names correct', JSON.stringify(t1.map(f=>f.name)) === JSON.stringify([EQUITY, BOND]), JSON.stringify(t1.map(f=>f.name)));
check('templatePhase2 names correct', JSON.stringify(t2.map(f=>f.name)) === JSON.stringify([EQUITY, BOND]), JSON.stringify(t2.map(f=>f.name)));
check('templatePhase1 weights are 70/30', JSON.stringify(t1.map(f=>f.weight)) === JSON.stringify([70,30]), JSON.stringify(t1.map(f=>f.weight)));
check('templatePhase2 weights are 40/60', JSON.stringify(t2.map(f=>f.weight)) === JSON.stringify([40,60]), JSON.stringify(t2.map(f=>f.weight)));
check('templatePhase1 weights sum to 100', t1.reduce((s,f)=>s+f.weight,0) === 100, t1.reduce((s,f)=>s+f.weight,0));
check('templatePhase2 weights sum to 100', t2.reduce((s,f)=>s+f.weight,0) === 100, t2.reduce((s,f)=>s+f.weight,0));

// The agreed example numbers. Same fund, same figures, in both phases -- only weights differ.
[[t1,'phase1'],[t2,'phase2']].forEach(([tpl, label]) => {
  const eq = tpl.find(f => f.name === EQUITY);
  const bd = tpl.find(f => f.name === BOND);
  check(`${label} equity numbers are 1/7/18`, eq && eq.yield === 1 && eq.capGain === 7 && eq.sd === 18, JSON.stringify(eq));
  check(`${label} bond numbers are 2/2/4`, bd && bd.yield === 2 && bd.capGain === 2 && bd.sd === 4, JSON.stringify(bd));
});

// No default fund may carry a real fund's ticker -- see the header comment.
const REAL_TICKERS = ['ES-WDEQ','MGALL-UH','TGSMART-A','SCBGEARA'];
check('no real fund tickers in the public default set',
  t1.concat(t2).every(f => !REAL_TICKERS.some(t => f.name.includes(t))),
  JSON.stringify(t1.concat(t2).map(f=>f.name)));

// --- 2. Asset classification and the diversification the defaults are meant to show ---
check('equity default classifies as Equity', window.classifyAsset(18) === 'Equity', window.classifyAsset(18));
check('bond default classifies as Bond', window.classifyAsset(4) === 'Bond', window.classifyAsset(4));
check('the default pair gets the diversifying correlation (-0.10)',
  near(window.getCorrelation('Equity','Bond'), -0.10), window.getCorrelation('Equity','Bond'));
// The trap this pins: sd = 6 would silently become "Mixed" at +0.70.
check('a bond at sd=6 would NOT classify as Bond (why 4 was chosen)',
  window.classifyAsset(6) !== 'Bond', window.classifyAsset(6));

// --- 3. calculatePhaseStats: exact expected values for the agreed defaults ---
// phase 1 (70/30): yield .7*1 + .3*2 = 1.3% | growth .7*7 + .3*2 = 5.5%
const stats1 = window.calculatePhaseStats(t1);
check('calculatePhaseStats(phase1) valid', stats1.valid === true, JSON.stringify(stats1));
check('calculatePhaseStats(phase1) no NaN', ['yield','growth','sd','totalR'].every(k => isFinite(stats1[k])), JSON.stringify(stats1));
check('phase1 yield = 1.30%', near(stats1.yield, 0.013, 1e-12), stats1.yield);
check('phase1 growth = 5.50%', near(stats1.growth, 0.055, 1e-12), stats1.growth);
check('phase1 total return = 6.80%', near(stats1.totalR, 0.068, 1e-12), stats1.totalR);
check('phase1 blended S.D. = 12.54%', near(stats1.sd, 0.1253698, 1e-6), stats1.sd);
// The whole point of the default set: the blend must be visibly safer than the naive average.
check('phase1 S.D. is below the naive weighted average (diversification is visible)',
  stats1.sd < (0.70*0.18 + 0.30*0.04) - 0.005, `${stats1.sd} vs naive ${0.70*0.18 + 0.30*0.04}`);

// phase 2 (40/60): yield .4*1 + .6*2 = 1.6% | growth .4*7 + .6*2 = 4.0%
const stats2 = window.calculatePhaseStats(t2);
check('calculatePhaseStats(phase2) valid', stats2.valid === true, JSON.stringify(stats2));
check('calculatePhaseStats(phase2) no NaN', ['yield','growth','sd','totalR'].every(k => isFinite(stats2[k])), JSON.stringify(stats2));
check('phase2 yield = 1.60%', near(stats2.yield, 0.016, 1e-12), stats2.yield);
check('phase2 growth = 4.00%', near(stats2.growth, 0.040, 1e-12), stats2.growth);
check('phase2 blended S.D. = 7.36%', near(stats2.sd, 0.0735825, 1e-6), stats2.sd);
check('phase2 S.D. is below the naive weighted average',
  stats2.sd < (0.40*0.18 + 0.60*0.04) - 0.005, `${stats2.sd} vs naive ${0.40*0.18 + 0.60*0.04}`);
// The two phases must actually differ, otherwise the default set demonstrates nothing
// about the phase mechanism it was chosen to demonstrate.
check('phase 2 is lower risk than phase 1 (the phase mechanism is visible)',
  stats2.sd < stats1.sd - 0.02, `${stats1.sd} -> ${stats2.sd}`);

// --- 4. portfolios array wiring: both portfolios get the templates in all 4 phases ---
const portfolios = window.portfolios;
check('2 portfolios exist', portfolios.length === 2);
portfolios.forEach(pt => {
  [1,2,3,4].forEach(ph => {
    const funds = pt.fundsData[ph];
    const expectedWeights = ph === 1 ? [70,30] : [40,60];
    check(`portfolio ${pt.id} phase ${ph} fund names match`, JSON.stringify(funds.map(f=>f.name)) === JSON.stringify([EQUITY, BOND]), JSON.stringify(funds.map(f=>f.name)));
    check(`portfolio ${pt.id} phase ${ph} weights are ${expectedWeights.join('/')}`, JSON.stringify(funds.map(f=>f.weight)) === JSON.stringify(expectedWeights), JSON.stringify(funds.map(f=>f.weight)));
    check(`portfolio ${pt.id} phase ${ph} weights sum 100`, funds.reduce((s,f)=>s+f.weight,0) === 100);
  });
});
// Deep copy, not shared references -- editing one portfolio must not move the other.
portfolios[0].fundsData[1][0].weight = 99;
check('portfolios hold independent copies of the template',
  portfolios[1].fundsData[1][0].weight === 70 && window.templatePhase1[0].weight === 70,
  `p2=${portfolios[1].fundsData[1][0].weight} tpl=${window.templatePhase1[0].weight}`);
portfolios[0].fundsData[1][0].weight = 70;

// --- 5. renderFundRows: the example numbers must actually reach the input boxes ---
window.switchActivePort(1);
window.switchTab(1);
const fundRowsHtml = window.document.getElementById('fund-rows').innerHTML;
check('renderFundRows: no NaN in HTML', !fundRowsHtml.includes('NaN'), fundRowsHtml.slice(0,300));
check('renderFundRows: no literal undefined in value attrs', !/value="undefined"/.test(fundRowsHtml));
check('renderFundRows: equity S.D. box shows 18', /data-field="sd" value="18"/.test(fundRowsHtml));
check('renderFundRows: bond S.D. box shows 4', /data-field="sd" value="4"/.test(fundRowsHtml));
check('renderFundRows: no blank Expected boxes left', !/data-field="(yield|capGain|sd)" value=""/.test(fundRowsHtml));

// --- 6. updatePhaseStatsTable: should run without throwing, and produce a table (no NaN%) ---
try {
  window.updatePhaseStatsTable();
  const statsHtml = window.document.getElementById('phase-metrics-body').innerHTML;
  check('updatePhaseStatsTable runs without throw', true);
  check('updatePhaseStatsTable: no NaN% in table', !statsHtml.includes('NaN'), statsHtml.slice(0,500));
} catch (e) {
  check('updatePhaseStatsTable runs without throw', false, e.stack);
}

// --- 7. Engine 1: runSimulation() with the defaults must produce sane numbers ---
window.document.getElementById('init-investment').value = '10000000';
window.document.getElementById('inflation-rate').value = '2.5';
window.document.getElementById('global-rebalance').value = '12';
try {
  const simResult = window.runSimulation();
  const totalY30 = simResult.resultsByYear['total'][30];
  check('runSimulation completes without throw', true);
  check('runSimulation: survivalRate is a finite number', isFinite(simResult.survivalRate), simResult.survivalRate);
  check('runSimulation: year30 median is finite (not NaN)', isFinite(totalY30.median), JSON.stringify(totalY30));
  check('runSimulation: year30 median is non-negative', totalY30.median >= 0, totalY30.median);
  // Unlike the old blank defaults (which produced a flat line), the example numbers must
  // actually grow the portfolio -- a visitor who clicks Run should see the tool do something.
  check('runSimulation: defaults now produce growth, not a flat line',
    totalY30.median > 10000000, totalY30.median);
} catch (e) {
  check('runSimulation completes without throw', false, e.stack);
}

// --- 8. Engine 2: runDriftVisualizer() ---
try {
  window.runDriftVisualizer();
  const driftY30 = window.globalDriftData.total[30];
  check('runDriftVisualizer completes without throw', true);
  check('runDriftVisualizer: year30 values finite', Object.values(driftY30).every(v => isFinite(v)), JSON.stringify(driftY30));
} catch (e) {
  check('runDriftVisualizer completes without throw', false, e.stack);
}

// --- 9. Heatmap engine ---
try {
  window.document.getElementById('heatmap-rates').value = '3%, 4%, 50000';
  window.runHeatmap(); // wrapped in setTimeout internally
  check('runHeatmap invoked without throw (sync part)', true);
} catch (e) {
  check('runHeatmap invoked without throw (sync part)', false, e.stack);
}

// --- 10. Optimizer with the new two-fund sets ---
try {
  const cloud1 = window.generateFrontierCloud(1, 1); // portfolio 1, phase 1
  check('generateFrontierCloud(phase1) returns cloud', cloud1 !== null && !cloud1.degenerate);
  check('generateFrontierCloud(phase1): samples are finite', cloud1.samples.every(s => isFinite(s.return) && isFinite(s.risk)));
  const presets1 = window.pickOptimizerPresets(cloud1, 0.015, {});
  check('pickOptimizerPresets(phase1) returns conservative/sharpe/aggressive', presets1.conservative && presets1.sharpe && presets1.aggressive);

  const cloud2 = window.generateFrontierCloud(1, 2); // portfolio 1, phase 2
  check('generateFrontierCloud(phase2) returns cloud', cloud2 !== null && !cloud2.degenerate);
  const presets2 = window.pickOptimizerPresets(cloud2, 0.015, {});
  check('pickOptimizerPresets(phase2) returns conservative/sharpe/aggressive', presets2.conservative && presets2.sharpe && presets2.aggressive);
} catch (e) {
  check('optimizer functions run without throw', false, e.stack);
}

// --- Report ---
console.log('=== PASS (' + results.pass.length + ') ===');
results.pass.forEach(p => console.log('  OK  ' + p));
console.log('=== FAIL (' + results.fail.length + ') ===');
results.fail.forEach(f => console.log('  XX  ' + f));
process.exit(results.fail.length > 0 ? 1 : 0);
