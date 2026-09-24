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
`, vmContext);

const results = { pass: [], fail: [] };
function check(name, cond, detail) {
  if (cond) results.pass.push(name);
  else results.fail.push(name + (detail ? ' :: ' + detail : ''));
}

// --- 1. Template sanity ---
const t1 = window.templatePhase1;
const t2 = window.templatePhase2;
check('templatePhase1 has 4 funds', t1.length === 4, JSON.stringify(t1));
check('templatePhase2 has 3 funds', t2.length === 3, JSON.stringify(t2));
check('templatePhase1 names correct', JSON.stringify(t1.map(f=>f.name)) === JSON.stringify(["ES-WDEQ","MGALL-UH","TGSMART-A","SCBGEARA"]));
check('templatePhase2 names correct', JSON.stringify(t2.map(f=>f.name)) === JSON.stringify(["MGALL-UH","TGSMART-A","SCBGEARA"]));
check('templatePhase1 weights sum to 100', t1.reduce((s,f)=>s+f.weight,0) === 100, t1.reduce((s,f)=>s+f.weight,0));
check('templatePhase2 weights sum to 100', t2.reduce((s,f)=>s+f.weight,0) === 100, t2.reduce((s,f)=>s+f.weight,0));
check('templatePhase1 yield/capGain/sd all blank strings', t1.every(f => f.yield === "" && f.capGain === "" && f.sd === ""));
check('templatePhase2 yield/capGain/sd all blank strings', t2.every(f => f.yield === "" && f.capGain === "" && f.sd === ""));

// --- 2. calculatePhaseStats with blank fields: should be all-zero but valid (no NaN) ---
const stats1 = window.calculatePhaseStats(t1);
check('calculatePhaseStats(phase1) valid', stats1.valid === true, JSON.stringify(stats1));
check('calculatePhaseStats(phase1) no NaN', !isNaN(stats1.yield) && !isNaN(stats1.growth) && !isNaN(stats1.sd) && !isNaN(stats1.totalR), JSON.stringify(stats1));
check('calculatePhaseStats(phase1) all zero (blank inputs)', stats1.yield === 0 && stats1.growth === 0 && stats1.sd === 0 && stats1.totalR === 0, JSON.stringify(stats1));

const stats2 = window.calculatePhaseStats(t2);
check('calculatePhaseStats(phase2) valid', stats2.valid === true, JSON.stringify(stats2));
check('calculatePhaseStats(phase2) no NaN', !isNaN(stats2.yield) && !isNaN(stats2.growth) && !isNaN(stats2.sd) && !isNaN(stats2.totalR), JSON.stringify(stats2));

// --- 3. portfolios array wiring: both portfolios should have the new funds in all 4 phases ---
const portfolios = window.portfolios;
check('2 portfolios exist', portfolios.length === 2);
portfolios.forEach(pt => {
  [1,2,3,4].forEach(ph => {
    const funds = pt.fundsData[ph];
    const expectedNames = ph === 1 ? ["ES-WDEQ","MGALL-UH","TGSMART-A","SCBGEARA"] : ["MGALL-UH","TGSMART-A","SCBGEARA"];
    check(`portfolio ${pt.id} phase ${ph} fund names match`, JSON.stringify(funds.map(f=>f.name)) === JSON.stringify(expectedNames), JSON.stringify(funds.map(f=>f.name)));
    check(`portfolio ${pt.id} phase ${ph} weights sum 100`, funds.reduce((s,f)=>s+f.weight,0) === 100);
  });
});

// --- 4. renderFundRows: blank inputs should render as empty value attrs (no "NaN" or "undefined" strings) ---
window.switchActivePort(1);
window.switchTab(1);
const fundRowsHtml = window.document.getElementById('fund-rows').innerHTML;
check('renderFundRows: no NaN in HTML', !fundRowsHtml.includes('NaN'), fundRowsHtml.slice(0,300));
check('renderFundRows: no literal undefined in value attrs', !/value="undefined"/.test(fundRowsHtml));
check('renderFundRows: yield/capGain/sd inputs render as empty value=""', /data-field="yield" value=""/.test(fundRowsHtml) && /data-field="capGain" value=""/.test(fundRowsHtml) && /data-field="sd" value=""/.test(fundRowsHtml));

// --- 5. updatePhaseStatsTable: should run without throwing, and produce a table (no NaN%) ---
try {
  window.updatePhaseStatsTable();
  const statsHtml = window.document.getElementById('phase-metrics-body').innerHTML;
  check('updatePhaseStatsTable runs without throw', true);
  check('updatePhaseStatsTable: no NaN% in table', !statsHtml.includes('NaN'), statsHtml.slice(0,500));
} catch (e) {
  check('updatePhaseStatsTable runs without throw', false, e.stack);
}

// --- 6. Engine 1: runSimulation() should run without throwing and produce sane (non-NaN) numbers ---
window.document.getElementById('init-investment').value = '10000000';
window.document.getElementById('inflation-rate').value = '2.5';
window.document.getElementById('global-rebalance').value = '12';
try {
  const simResult = window.runSimulation();
  const totalY30 = simResult.resultsByYear['total'][30];
  check('runSimulation completes without throw', true);
  check('runSimulation: survivalRate is a finite number', isFinite(simResult.survivalRate), simResult.survivalRate);
  check('runSimulation: year30 median is finite (not NaN)', isFinite(totalY30.median), JSON.stringify(totalY30));
  // With all yield/growth/sd = 0, portfolio should stay flat at principal-ish level (no growth, no vol)
  // (deflated by inflation only) -- should NOT be NaN or wildly off.
  check('runSimulation: year30 median is non-negative', totalY30.median >= 0, totalY30.median);
} catch (e) {
  check('runSimulation completes without throw', false, e.stack);
}

// --- 7. Engine 2: runDriftVisualizer() ---
try {
  window.runDriftVisualizer();
  const driftY30 = window.globalDriftData.total[30];
  check('runDriftVisualizer completes without throw', true);
  check('runDriftVisualizer: year30 values finite', Object.values(driftY30).every(v => isFinite(v)), JSON.stringify(driftY30));
} catch (e) {
  check('runDriftVisualizer completes without throw', false, e.stack);
}

// --- 8. Heatmap engine ---
try {
  window.document.getElementById('heatmap-rates').value = '3%, 4%, 50000';
  window.runHeatmap(); // wrapped in setTimeout internally
  check('runHeatmap invoked without throw (sync part)', true);
} catch (e) {
  check('runHeatmap invoked without throw (sync part)', false, e.stack);
}

// --- 9. Optimizer functions with new fund sets ---
try {
  const cloud1 = window.generateFrontierCloud(1, 1); // portfolio 1, phase 1 (4 funds)
  check('generateFrontierCloud(phase1, 4 funds) returns cloud', cloud1 !== null && !cloud1.degenerate);
  check('generateFrontierCloud(phase1): samples are finite', cloud1.samples.every(s => isFinite(s.return) && isFinite(s.risk)));
  const presets1 = window.pickOptimizerPresets(cloud1, 0.015, {});
  check('pickOptimizerPresets(phase1) returns conservative/sharpe/aggressive', presets1.conservative && presets1.sharpe && presets1.aggressive);

  const cloud2 = window.generateFrontierCloud(1, 2); // portfolio 1, phase 2 (3 funds)
  check('generateFrontierCloud(phase2, 3 funds) returns cloud', cloud2 !== null && !cloud2.degenerate);
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
