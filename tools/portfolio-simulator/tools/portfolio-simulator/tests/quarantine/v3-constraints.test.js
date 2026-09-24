const fs = require('fs');
const { JSDOM } = require('jsdom');

const NEW_FILE = '/tmp/work/institutional_portfolio_simulator.html';
const BASELINE_FILE = '/tmp/work/baseline_v2_optimizer.html';      // previous version (optimizer v1)
const PRE_OPTIMIZER_FILE = '/home/claude/institutional_portfolio_simulator.html'; // has optimizer v1 too (synced)

function extractScript(path) {
    const html = fs.readFileSync(path, 'utf8');
    const m = html.match(/<script>\s*([\s\S]*?)<\/script>/);
    if (!m) throw new Error('script not found in ' + path);
    return m[1];
}

const seeded = (seed) => `
    (function() {
        let s = ${seed};
        Math.random = function() {
            s = (s * 1103515245 + 12345) & 0x7fffffff;
            return s / 0x7fffffff;
        };
    })();
`;

// Boot a jsdom window using the REAL page markup (so every element the code touches
// exists exactly as shipped), with the browser-only bits the engine doesn't need stubbed.
function boot(filePath) {
    const html = fs.readFileSync(filePath, 'utf8');
    const dom = new JSDOM(html, { runScripts: 'outside-only' });
    const { window } = dom;
    window.HTMLCanvasElement.prototype.getContext = function () { return {}; };
    window.Element.prototype.scrollIntoView = function () {};
    window.alert = function (msg) { window.__lastAlert = msg; };
    // Minimal Chart.js stand-in that records the config it was handed, so chart-shape
    // assertions test what would actually be drawn.
    window.Chart = class {
        constructor(ctx, config) {
            this.config = config;
            window.__charts = window.__charts || [];
            window.__charts.push(config);
            window.__lastChart = config;
        }
        destroy() {}
    };
    return window;
}

// jsdom fires DOMContentLoaded while parsing, i.e. BEFORE we eval the page script, so the
// app's own init never runs and no listeners get attached. Run the same init the page's
// DOMContentLoaded handler would have run, so event-driven paths are actually exercised.
const INIT = `
    setupUIEventListeners();
    renderPortTabs();
    renderPriorityOrderUI();
    renderChartPortOptions();
    syncActivePortUI();
    updatePhaseStatsTable();
`;

let failures = 0;
function check(label, cond, extra) {
    if (!cond) failures++;
    console.log(`${cond ? '✅' : '❌'} ${label}${extra ? ' — ' + extra : ''}`);
}

// Find the most recent chart config whose first dataset carries a given label, so an
// assertion always targets the intended chart instead of "whatever was drawn last".
function chartWithFirstLabel(window, label) {
    const charts = window.__charts || [];
    for (let i = charts.length - 1; i >= 0; i--) {
        if (charts[i].data.datasets[0] && charts[i].data.datasets[0].label === label) return charts[i];
    }
    return null;
}

// =====================================================================
// TEST 1 — REGRESSION: the 3 simulation engines must be byte-identical to
// the previous version when called the way the app calls them.
// =====================================================================
function runEngines(filePath) {
    const window = boot(filePath);
    window.eval(extractScript(filePath) + '\n' + seeded(42) + `
        window.setTimeout = (fn) => fn();
        runSimulation();
        runDriftVisualizer();
        runHeatmap();
        window.__ged = JSON.parse(JSON.stringify(globalExportData.resultsByYear));
        window.__drift = JSON.parse(JSON.stringify(globalDriftData.total));
    `);
    return {
        survival: window.document.getElementById('metric-survival-rate').innerText,
        totalCapital: window.document.getElementById('metric-total-capital').innerText,
        cf: ['cf-year-1', 'cf-year-10', 'cf-year-20', 'cf-year-30'].map(id => window.document.getElementById(id).innerText).join('|'),
        withdrawn: window.document.getElementById('total-cf-withdrawn').innerText,
        resultsByYear: JSON.stringify(window.__ged),
        drift: JSON.stringify(window.__drift),
        heatmap: window.document.getElementById('heatmap-body').innerHTML
    };
}

console.log('=== TEST 1: REGRESSION vs previous version (all 3 engines, same seed) ===');
const before = runEngines(BASELINE_FILE);
const after = runEngines(NEW_FILE);
Object.keys(before).forEach(k => {
    check(`engine output "${k}" identical`, before[k] === after[k],
        before[k] === after[k] ? '' : `\n   before: ${String(before[k]).slice(0, 160)}\n   after : ${String(after[k]).slice(0, 160)}`);
});

// =====================================================================
// TEST 2 — CONSTRAINT LOGIC (pickOptimizerPresets)
// =====================================================================
console.log('\n=== TEST 2: constraint logic (return floor / risk cap) ===');
{
    const window = boot(NEW_FILE);
    window.eval(extractScript(NEW_FILE) + '\n' + seeded(7) + `
        window.__cloud = generateFrontierCloud(1, 1, 4000);
        window.__noConstraint  = pickOptimizerPresets(window.__cloud, 0.015);
        window.__emptyObj      = pickOptimizerPresets(window.__cloud, 0.015, {});
        window.__nullFields    = pickOptimizerPresets(window.__cloud, 0.015, { conservativeMinReturn: null, aggressiveMaxRisk: null });
    `);
    const cloud = window.__cloud;
    const base = window.__noConstraint;

    // Backward-compatibility: omitting constraints, passing {}, or passing explicit nulls
    // must all reproduce the ORIGINAL preset definitions exactly.
    check('no-constraint call unchanged vs {} ', JSON.stringify(base.conservative) === JSON.stringify(window.__emptyObj.conservative) &&
        JSON.stringify(base.aggressive) === JSON.stringify(window.__emptyObj.aggressive) &&
        JSON.stringify(base.sharpe) === JSON.stringify(window.__emptyObj.sharpe));
    check('no-constraint call unchanged vs explicit nulls', JSON.stringify(base.conservative) === JSON.stringify(window.__nullFields.conservative) &&
        JSON.stringify(base.aggressive) === JSON.stringify(window.__nullFields.aggressive));
    check('unconstrained conservative is still the global min-risk sample',
        Math.abs(base.conservative.risk - Math.min(...cloud.samples.map(s => s.risk))) < 1e-12);
    check('warnings object empty when no constraints set', Object.keys(base.warnings || {}).length === 0);

    // --- Conservative + return floor ---
    // Pick a floor that sits between the min-variance point's return and the max return,
    // so it genuinely binds (otherwise the test would prove nothing).
    const maxReturn = Math.max(...cloud.samples.map(s => s.return));
    const floor = (base.conservative.return + maxReturn) / 2;
    window.eval(`window.__withFloor = pickOptimizerPresets(window.__cloud, 0.015, { conservativeMinReturn: ${floor} });`);
    const wf = window.__withFloor;
    const eligibleByReturn = cloud.samples.filter(s => s.return >= floor);
    const trueMinRiskAmongEligible = Math.min(...eligibleByReturn.map(s => s.risk));
    check('floor actually binds (picked point differs from unconstrained min-variance)',
        wf.conservative.risk !== base.conservative.risk,
        `unconstrained risk=${(base.conservative.risk * 100).toFixed(3)}%, constrained risk=${(wf.conservative.risk * 100).toFixed(3)}%`);
    check('constrained conservative meets the return floor', wf.conservative.return >= floor - 1e-12,
        `return=${(wf.conservative.return * 100).toFixed(3)}% vs floor=${(floor * 100).toFixed(3)}%`);
    check('constrained conservative is the MIN-RISK point among those meeting the floor',
        Math.abs(wf.conservative.risk - trueMinRiskAmongEligible) < 1e-12);
    check('constrained conservative is not dominated (no sample with <= risk and >= return meeting floor)',
        !cloud.samples.some(s => s.return >= floor && s.risk < wf.conservative.risk - 1e-12));
    check('sharpe is NOT affected by the conservative constraint',
        JSON.stringify(wf.sharpe) === JSON.stringify(base.sharpe));
    check('aggressive is NOT affected by the conservative constraint',
        JSON.stringify(wf.aggressive) === JSON.stringify(base.aggressive));

    // --- Aggressive + risk cap ---
    const minRisk = Math.min(...cloud.samples.map(s => s.risk));
    const cap = (minRisk + base.aggressive.risk) / 2; // binds below the unconstrained pick
    window.eval(`window.__withCap = pickOptimizerPresets(window.__cloud, 0.015, { aggressiveMaxRisk: ${cap} });`);
    const wc = window.__withCap;
    const eligibleByRisk = cloud.samples.filter(s => s.risk <= cap);
    const trueMaxReturnAmongEligible = Math.max(...eligibleByRisk.map(s => s.return));
    check('cap actually binds (picked point differs from unconstrained 80th-pct pick)',
        wc.aggressive.risk !== base.aggressive.risk,
        `unconstrained risk=${(base.aggressive.risk * 100).toFixed(3)}%, capped risk=${(wc.aggressive.risk * 100).toFixed(3)}%`);
    check('constrained aggressive respects the S.D. cap', wc.aggressive.risk <= cap + 1e-12,
        `risk=${(wc.aggressive.risk * 100).toFixed(3)}% vs cap=${(cap * 100).toFixed(3)}%`);
    check('constrained aggressive is the MAX-RETURN point within the cap',
        Math.abs(wc.aggressive.return - trueMaxReturnAmongEligible) < 1e-12);
    check('constrained aggressive is not dominated (no sample within cap with higher return)',
        !cloud.samples.some(s => s.risk <= cap && s.return > wc.aggressive.return + 1e-12));
    check('conservative is NOT affected by the aggressive constraint',
        JSON.stringify(wc.conservative) === JSON.stringify(base.conservative));

    // --- Edge cases: constraints that exclude every sample ---
    window.eval(`
        window.__impossible = pickOptimizerPresets(window.__cloud, 0.015, { conservativeMinReturn: 9.99, aggressiveMaxRisk: 0.000001 });
    `);
    const imp = window.__impossible;
    check('impossible return floor -> conservative is null (not a silent fallback)', imp.conservative === null);
    check('impossible risk cap -> aggressive is null (not a silent fallback)', imp.aggressive === null);
    check('warning text produced for conservative', typeof imp.warnings.conservative === 'string' && imp.warnings.conservative.length > 0,
        imp.warnings.conservative);
    check('warning text produced for aggressive', typeof imp.warnings.aggressive === 'string' && imp.warnings.aggressive.length > 0,
        imp.warnings.aggressive);
    check('sharpe still returned even when both constraints are impossible', !!imp.sharpe);
}

// =====================================================================
// TEST 3 — UI FLOW: constraints read from the DOM, warnings rendered,
// null preset handled in the table, frontier reference lines drawn.
// =====================================================================
console.log('\n=== TEST 3: UI flow with constraints ===');
{
    const window = boot(NEW_FILE);
    const doc = window.document;
    window.eval(extractScript(NEW_FILE) + '\n' + seeded(11) + INIT + `
        window.setTimeout = (fn) => fn();
        // 1) No constraints: plain run
        runOptimizer('conservative');
        window.__subtitlePlain = document.getElementById('optimizer-subtitle').innerText;
        window.__presetsPlain = optimizerPresets;
        window.__chartsAfterPlain = window.__charts.length;

        // 2) Set a binding S.D. cap for Aggressive, via the real input + listener path
        const capInput = document.getElementById('opt-aggressive-max-risk');
        capInput.value = '5';
        capInput.dispatchEvent(new window.Event('input', { bubbles: true }));
        window.__presetsCapped = optimizerPresets;
        window.__subtitleCapped = document.getElementById('optimizer-subtitle').innerText;

        // 3) Impossible floor for Conservative -> warning + null preset in the table
        document.getElementById('opt-conservative-min-return').value = '999';
        document.getElementById('opt-conservative-min-return').dispatchEvent(new window.Event('input', { bubbles: true }));
        window.__presetsImpossible = optimizerPresets;
    `);

    check('section-optimizer revealed after clicking a preset', !doc.getElementById('section-optimizer').classList.contains('hidden'));
    check('subtitle shows no constraint text when boxes are empty', !window.__subtitlePlain.includes('เงื่อนไข:'), window.__subtitlePlain);
    check('subtitle reports the active S.D. cap', window.__subtitleCapped.includes('S.D. ≤ 5.00%'), window.__subtitleCapped);
    check('S.D. cap respected via the DOM path', window.__presetsCapped.aggressive.risk <= 0.05 + 1e-12,
        `risk=${(window.__presetsCapped.aggressive.risk * 100).toFixed(3)}%`);
    check('capped aggressive differs from the unconstrained one',
        window.__presetsCapped.aggressive.risk !== window.__presetsPlain.aggressive.risk);

    const cfg = chartWithFirstLabel(window, 'กลุ่มตัวอย่างสุ่ม'); // the frontier scatter chart
    check('frontier chart was (re)drawn after the constraint change', !!cfg);
    const capLine = cfg.data.datasets.find(d => (d.label || '').includes('เพดานความเสี่ยง'));
    check('frontier chart draws the S.D. cap reference line', !!capLine, capLine ? capLine.label : '(missing)');
    check('cap reference line is vertical at the cap value',
        !!capLine && capLine.data.length === 2 && capLine.data[0].x === 5 && capLine.data[1].x === 5);

    check('impossible floor -> conservative preset is null', window.__presetsImpossible.conservative === null);
    const warnEl = doc.getElementById('opt-constraint-warning');
    check('constraint warning is visible in the UI', !warnEl.classList.contains('hidden'));
    check('warning mentions Conservative', warnEl.innerHTML.includes('Conservative'));
    const tbodyHtml = doc.getElementById('optimizer-table-body').innerHTML;
    check('weights table shows the "no matching allocation" message instead of stale weights',
        tbodyHtml.includes('ไม่มีสัดส่วนใดผ่านเงื่อนไข'));
}

// =====================================================================
// TEST 4 — MONTE CARLO COMPARISON CHART: 3 lines x 2 sets, band fills,
// and the independent "เทียบกับ" selector.
// =====================================================================
console.log('\n=== TEST 4: MC comparison chart (bands + selector) ===');
{
    const window = boot(NEW_FILE);
    const doc = window.document;
    window.eval(extractScript(NEW_FILE) + '\n' + seeded(23) + INIT + `
        window.setTimeout = (fn) => fn();
        runSimulation();          // baseline for the comparison
        hasRunOnce = true;
        runOptimizer('sharpe');
        document.getElementById('optimizer-mc-toggle').checked = true;
        document.getElementById('optimizer-mc-toggle').dispatchEvent(new window.Event('change', { bubbles: true }));
        window.__chartsAfterFirstCompare = window.__charts.length;
        window.__baseSeries = JSON.parse(JSON.stringify(globalExportData.resultsByYear['total']));
        window.__cacheKeysAfterFirst = Object.keys(optimizerCompareCache);

        // Switch the comparison target WITHOUT touching the preset buttons.
        const aggRadio = document.querySelector('input[name="optimizer-compare-mode"][value="aggressive"]');
        aggRadio.checked = true;
        aggRadio.dispatchEvent(new window.Event('change', { bubbles: true }));
        window.__selectedModeAfterSwitch = optimizerSelectedMode;
        window.__cacheKeysAfterSwitch = Object.keys(optimizerCompareCache);
    `);

    const compareCharts = (window.__charts || []).filter(c => c.data.datasets[0] && c.data.datasets[0].label === 'พอร์ตเดิม: 90th');
    check('two comparison charts were drawn (initial + after switching target)', compareCharts.length === 2, `got ${compareCharts.length}`);
    const cfg = compareCharts[0];
    window.__compareCfgAgg = compareCharts[compareCharts.length - 1];
    check('comparison chart has 6 datasets (3 lines x 2 sets)', cfg.data.datasets.length === 6, `got ${cfg.data.datasets.length}`);
    const ds = cfg.data.datasets;
    check('original band fills to its own 90th line (fill: 0)', ds[1].fill === 0);
    check('optimized band fills to its own 90th line (fill: 3)', ds[4].fill === 3);
    check('median lines do not fill', ds[2].fill === false && ds[5].fill === false);
    check('original side uses the purple family', ds[2].borderColor === '#a855f7' && ds[1].backgroundColor.startsWith('rgba(168,85,247'));
    check('optimized side uses the contrasting cyan family', ds[5].borderColor === '#22d3ee' && ds[4].backgroundColor.startsWith('rgba(34,211,238'));
    check('band fills are mostly transparent (alpha 0.20)', ds[1].backgroundColor.includes('0.20') && ds[4].backgroundColor.includes('0.20'));
    check('legend hides the two bare fill-anchor lines',
        cfg.options.plugins.legend.labels.filter({ datasetIndex: 0 }) === false &&
        cfg.options.plugins.legend.labels.filter({ datasetIndex: 3 }) === false &&
        cfg.options.plugins.legend.labels.filter({ datasetIndex: 2 }) === true);

    // The plotted baseline series must be the real 10th/50th/90th from globalExportData.
    const base = window.__baseSeries;
    check('baseline 90th series matches globalExportData.best', JSON.stringify(ds[0].data) === JSON.stringify(base.map(d => d.best)));
    check('baseline 50th series matches globalExportData.median', JSON.stringify(ds[2].data) === JSON.stringify(base.map(d => d.median)));
    check('baseline 10th series matches globalExportData.worst', JSON.stringify(ds[1].data) === JSON.stringify(base.map(d => d.worst)));
    const ordered = base.every(d => d.best >= d.median && d.median >= d.worst);
    check('percentile ordering holds (90th >= 50th >= 10th) for every year', ordered);
    const optOrdered = ds[3].data.every((v, i) => v >= ds[5].data[i] && ds[5].data[i] >= ds[4].data[i]);
    check('percentile ordering holds for the optimized side too', optOrdered);

    // Selector independence + caching
    check('switching the selector does NOT change which preset the table/frontier shows',
        window.__selectedModeAfterSwitch === 'sharpe', `optimizerSelectedMode=${window.__selectedModeAfterSwitch}`);
    check('switching the selector redraws the comparison with different data',
        JSON.stringify(window.__compareCfgAgg.data.datasets[5].data) !== JSON.stringify(cfg.data.datasets[5].data));
    check('comparison runs are cached per mode', window.__cacheKeysAfterFirst.length === 1 && window.__cacheKeysAfterSwitch.length === 2,
        `after first: [${window.__cacheKeysAfterFirst}], after switch: [${window.__cacheKeysAfterSwitch}]`);
    check('baseline side is unchanged when switching comparison target',
        JSON.stringify(window.__compareCfgAgg.data.datasets[2].data) === JSON.stringify(cfg.data.datasets[2].data));

    const note = doc.getElementById('optimizer-mc-note').innerHTML;
    check('note reports the year-30 median difference', note.includes('มัธยฐานปีที่ 30'), note.slice(0, 120));
}

// =====================================================================
// TEST 5 — fundsData is still never mutated by any of this
// =====================================================================
console.log('\n=== TEST 5: no mutation of the real fund table ===');
{
    const window = boot(NEW_FILE);
    window.eval(extractScript(NEW_FILE) + '\n' + seeded(31) + INIT + `
        window.setTimeout = (fn) => fn();
        window.__before = JSON.stringify(portfolios.map(p => p.fundsData));
        runSimulation();
        hasRunOnce = true;
        document.getElementById('opt-aggressive-max-risk').value = '6';
        document.getElementById('opt-conservative-min-return').value = '3';
        runOptimizer('aggressive');
        document.getElementById('optimizer-mc-toggle').checked = true;
        document.getElementById('optimizer-mc-toggle').dispatchEvent(new window.Event('change', { bubbles: true }));
        document.querySelector('input[name="optimizer-compare-mode"][value="conservative"]').checked = true;
        document.querySelector('input[name="optimizer-compare-mode"][value="conservative"]').dispatchEvent(new window.Event('change', { bubbles: true }));
        window.__after = JSON.stringify(portfolios.map(p => p.fundsData));
    `);
    check('portfolios[*].fundsData byte-identical after the full optimizer flow', window.__before === window.__after);
}

console.log(`\n${failures === 0 ? '✅ ALL CHECKS PASSED' : `❌ ${failures} CHECK(S) FAILED`}`);
process.exitCode = failures === 0 ? 0 : 1;
