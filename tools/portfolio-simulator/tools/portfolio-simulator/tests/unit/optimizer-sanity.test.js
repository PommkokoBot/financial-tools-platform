const fs = require('fs');
const { JSDOM } = require('jsdom');
const { APP, requireFile } = require('../lib/paths');

function extractScript(path) {
    const html = fs.readFileSync(path, 'utf8');
    const m = html.match(/<script>\s*([\s\S]*?)<\/script>/);
    if (!m) throw new Error('script not found in ' + path);
    return m[1];
}

const seededRandomSrc = `
    (function() {
        let seed = 7;
        Math.random = function() {
            seed = (seed * 1103515245 + 12345) & 0x7fffffff;
            return seed / 0x7fffffff;
        };
    })();
`;

const domHtml = `<!DOCTYPE html><html><body>
  <input id="init-investment" value="10000000">
  <input id="inflation-rate" value="2.5">
  <select id="global-rebalance"><option value="12" selected>x</option></select>
  <div id="port-tabs-container"></div>
  <div id="priority-order-container"></div>
  <select id="chart-port-selector"></select>
  <table><tbody id="phase-metrics-body"></tbody></table>
  <table><tbody id="fund-rows"></tbody></table>
  <span id="total-weight-badge"></span>
  <span id="global-weight-badge"></span>
  <span id="metric-total-capital"></span>
  <span id="metric-survival-rate"></span>
  <span id="cf-year-1"></span><span id="cf-year-10"></span><span id="cf-year-20"></span><span id="cf-year-30"></span>
  <span id="total-cf-withdrawn"></span>
  <input id="chart-start-y" value="1"><input id="chart-end-y" value="30">
  <input id="heatmap-rates" value="3%, 4%, 50000, 100000">
  <input id="heatmap-benchmark-rate" value="1.5">
  <table><tbody id="heatmap-body"></tbody></table>
  <button id="btn-run-heatmap"></button>
  <span id="status-badge"></span>
  <button id="btn-optimize-sharpe" data-mode="sharpe" class="optimizer-btn"></button>
  <button id="btn-optimize-conservative" data-mode="conservative" class="optimizer-btn"></button>
  <button id="btn-optimize-aggressive" data-mode="aggressive" class="optimizer-btn"></button>
  <div id="section-optimizer" class="hidden"><p id="optimizer-subtitle"></p><canvas id="optimizerFrontierChart"></canvas><table><tbody id="optimizer-table-body"></tbody></table><input type="checkbox" id="optimizer-mc-toggle"><div id="optimizer-mc-wrap" class="hidden"><p id="optimizer-mc-note"></p><canvas id="optimizerCompareChart"></canvas></div></div>
</body></html>`;

const editedSrc = extractScript(requireFile(APP, 'app under test'));

// ---------- TEST 1: frontier math sanity (Min-Variance / Sharpe / 80th percentile) ----------
function test1() {
    const dom = new JSDOM(domHtml, { runScripts: 'outside-only' });
    const { window } = dom;
    // Everything that needs to read top-level `let`/`const` bindings (portfolios, cloud,
    // presets) happens in this ONE eval call -- per the project's documented jsdom lesson,
    // a second separate eval() can't see bindings set by the first.
    const driver = editedSrc + '\n' + seededRandomSrc + `
        window.__cloud = generateFrontierCloud(1, 1, 4000); // portfolio 1, phase 1 (6 funds in template)
        window.__presets = pickOptimizerPresets(window.__cloud, 0.015);

        // Degenerate case: portfolio with 1 fund shouldn't crash.
        portfolios[0].fundsData[1] = [{id: 999, name: "Solo Fund", weight: 100, yield: 3, capGain: 1, sd: 5}];
        window.__degenCloud = generateFrontierCloud(1, 1, 100);
        window.__degenPresets = pickOptimizerPresets(window.__degenCloud, 0.015);
    `;
    window.eval(driver);

    const cloud = window.__cloud;
    const presets = window.__presets;

    console.log('=== TEST 1: Frontier math sanity (portfolio 1, phase 1, 6 funds) ===');
    console.log('samples generated:', cloud.samples.length, '(expect ~4000, some may be dropped if invalid)');
    console.log('frontier points:', cloud.frontier.length);

    const minRiskInSamples = Math.min(...cloud.samples.map(s => s.risk));
    const conservativeRisk = presets.conservative.risk;
    console.log('conservative.risk === min risk across ALL samples:', Math.abs(conservativeRisk - minRiskInSamples) < 1e-12,
        `(conservative=${conservativeRisk}, trueMin=${minRiskInSamples})`);

    let bestSharpeCheck = -Infinity, bestSharpeSample = null;
    cloud.samples.forEach(s => {
        if (s.risk <= 0) return;
        const sr = (s.return - 0.015) / s.risk;
        if (sr > bestSharpeCheck) { bestSharpeCheck = sr; bestSharpeSample = s; }
    });
    const presetSharpeRatio = (presets.sharpe.return - 0.015) / presets.sharpe.risk;
    console.log('sharpe preset Sharpe ratio === best found by brute force:', Math.abs(presetSharpeRatio - bestSharpeCheck) < 1e-12,
        `(preset=${presetSharpeRatio.toFixed(6)}, bruteForce=${bestSharpeCheck.toFixed(6)})`);

    const returns = cloud.samples.map(s => s.return).sort((a, b) => a - b);
    const idx80 = Math.floor(0.8 * (returns.length - 1));
    const targetReturn = returns[idx80];
    console.log('aggressive.return >= 80th percentile target:', presets.aggressive.return >= targetReturn - 1e-9,
        `(aggressive.return=${presets.aggressive.return.toFixed(6)}, target80th=${targetReturn.toFixed(6)})`);
    const dominatedByLowerRisk = cloud.samples.some(s => s.risk < presets.aggressive.risk - 1e-9 && s.return >= presets.aggressive.return);
    console.log('aggressive point is NOT dominated by any lower-risk sample:', !dominatedByLowerRisk);

    const sampleWeightSums = cloud.samples.slice(0, 50).map(s => Object.values(s.weights).reduce((a,b)=>a+b,0));
    const allSumTo100 = sampleWeightSums.every(s => Math.abs(s - 100) < 1e-6);
    console.log('sampled weights all sum to 100% (first 50 checked):', allSumTo100);

    console.log('degenerate (1-fund) case handled without crash, degenerate flag:', window.__degenCloud.degenerate === true);
    console.log('degenerate presets all equal the single-fund point:',
        window.__degenPresets.conservative.risk === window.__degenPresets.sharpe.risk &&
        window.__degenPresets.sharpe.risk === window.__degenPresets.aggressive.risk);
}

// ---------- TEST 2: runSimulation() override isolation ----------
// Fund ids for portfolio 1 / phase 1 are fixed by templatePhase1 in the app's own source
// (ids 1-6, weights 10/10/20/10/10/40) -- hardcoding the weight maps here (instead of
// deriving them via a second, separate window.eval() call) sidesteps the documented
// "separate eval() can't see a previous eval's let/const bindings" issue entirely.
const SAME_WEIGHTS = { 1: 10, 2: 10, 3: 20, 4: 10, 5: 10, 6: 40 };
const SKEWED_WEIGHTS = { 1: 100, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 };

function test2() {
    const dom = new JSDOM(domHtml, { runScripts: 'outside-only' });
    const { window } = dom;
    window.eval(editedSrc + '\n' + seededRandomSrc + `
        window.__gedRef = globalExportData; // stash the reference -- bare "globalExportData"
                                             // (a top-level let) is invisible to a later,
                                             // separate window.eval() call on this window.
        runSimulation();
        window.__baselineSurvival = document.getElementById('metric-survival-rate').innerText;
        window.__baselineExportData = JSON.parse(JSON.stringify(globalExportData.resultsByYear['total']));
    `);

    // Reset the PRNG seed to the SAME starting point before the override call, so both
    // calls consume an identical random sequence -- isolates "does the override machinery
    // change anything when weights are unchanged" from "randomness differs between calls".
    window.eval(seededRandomSrc + `
        window.__overrideResult = runSimulation({ silent: true, overridePortId: 1, overridePhase: 1, overrideWeights: ${JSON.stringify(SAME_WEIGHTS)} });
        window.__survivalAfterSilentCall = document.getElementById('metric-survival-rate').innerText;
        window.__exportDataAfterSilentCall = window.__gedRef.resultsByYear['total'];
    `);

    console.log('\n=== TEST 2: runSimulation() override isolation ===');
    const sameWeightsResult = window.__overrideResult.resultsByYear['total'];
    const baseline = window.__baselineExportData;
    const identical = JSON.stringify(sameWeightsResult) === JSON.stringify(baseline);
    console.log('override with UNCHANGED weights reproduces baseline exactly (same seed):', identical);

    console.log('silent:true did NOT touch DOM (survival rate span unchanged):',
        window.__survivalAfterSilentCall === window.__baselineSurvival,
        `(before=${window.__baselineSurvival}, after=${window.__survivalAfterSilentCall})`);
    console.log('silent:true did NOT touch globalExportData:',
        JSON.stringify(window.__exportDataAfterSilentCall) === JSON.stringify(baseline));

    // TEST 2b: override with DIFFERENT (skewed) weights should change the result, and must
    // NOT mutate the live fundsData (pt.fundsData must be byte-identical after the call).
    const dom2 = new JSDOM(domHtml, { runScripts: 'outside-only' });
    const window2 = dom2.window;
    window2.eval(editedSrc + '\n' + seededRandomSrc + `
        window.__portfoliosRef = portfolios;
        window.__origFundsSnapshot = JSON.stringify(portfolios[0].fundsData[1]);
        runSimulation(); // baseline
        window.__baseline2 = JSON.stringify(globalExportData.resultsByYear['total']);
    `);
    window2.eval(seededRandomSrc + `
        window.__skewedResult = runSimulation({ silent: true, overridePortId: 1, overridePhase: 1, overrideWeights: ${JSON.stringify(SKEWED_WEIGHTS)} });
        window.__fundsAfterOverride = JSON.stringify(window.__portfoliosRef[0].fundsData[1]);
    `);
    console.log('\n=== TEST 2b: override with DIFFERENT weights changes result & never mutates fundsData ===');
    const differs = window2.__baseline2 !== JSON.stringify(window2.__skewedResult.resultsByYear['total']);
    console.log('skewed-weight override produces a DIFFERENT result than baseline:', differs);
    console.log('pt.fundsData[1] unchanged after the override call (deep-equal to pre-call snapshot):',
        window2.__origFundsSnapshot === window2.__fundsAfterOverride);
}

test1();
test2();
