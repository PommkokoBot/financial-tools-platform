const fs = require('fs');
const { JSDOM } = require('jsdom');

const NEW_FILE = '/tmp/work/institutional_portfolio_simulator.html';
const script = fs.readFileSync(NEW_FILE, 'utf8').match(/<script>\s*([\s\S]*?)<\/script>/)[1];

const seeded = `(function(){ let s = 5; Math.random = function(){ s = (s*1103515245+12345)&0x7fffffff; return s/0x7fffffff; }; })();`;
const INIT = `setupUIEventListeners(); renderPortTabs(); renderPriorityOrderUI(); renderChartPortOptions(); syncActivePortUI(); updatePhaseStatsTable();`;

function boot() {
    const dom = new JSDOM(fs.readFileSync(NEW_FILE, 'utf8'), { runScripts: 'outside-only' });
    const { window } = dom;
    window.HTMLCanvasElement.prototype.getContext = function () { return {}; };
    window.Element.prototype.scrollIntoView = function () {};
    window.Chart = class { constructor(c, cfg) { window.__charts = window.__charts || []; window.__charts.push(cfg); } destroy() {} };
    return window;
}

let failures = 0;
const check = (label, cond, extra) => { if (!cond) failures++; console.log(`${cond ? '✅' : '❌'} ${label}${extra ? ' — ' + extra : ''}`); };

(async () => {
    // ---------- Cache reuse ----------
    console.log('=== Comparison cache: reuse vs invalidation ===');
    const w = boot();
    w.eval(script + '\n' + seeded + INIT + `
        window.setTimeout = (fn) => fn();   // run the render's internal yield synchronously
        // Count how many times the heavy override simulation actually runs.
        window.__simCalls = 0;
        const realRunSimulation = runSimulation;
        runSimulation = function(opts) {
            if (opts && opts.silent) window.__simCalls++;
            return realRunSimulation(opts);
        };

        realRunSimulation();      // baseline
        hasRunOnce = true;
        runOptimizer('sharpe');
        document.getElementById('optimizer-mc-toggle').checked = true;
        document.getElementById('optimizer-mc-toggle').dispatchEvent(new window.Event('change', { bubbles: true }));
        window.__afterSharpe = window.__simCalls;                       // expect 1

        const pick = (v) => {
            const r = document.querySelector('input[name="optimizer-compare-mode"][value="' + v + '"]');
            r.checked = true; r.dispatchEvent(new window.Event('change', { bubbles: true }));
        };
        pick('aggressive');  window.__afterAggressive = window.__simCalls;   // expect 2 (new mode)
        pick('sharpe');      window.__afterBackToSharpe = window.__simCalls; // expect 2 (cache hit)

        // Now move the AGGRESSIVE cap. Sharpe's allocation is untouched by that constraint,
        // so re-selecting Sharpe must still hit the cache, while Aggressive must recompute.
        document.getElementById('opt-aggressive-max-risk').value = '5';
        refreshOptimizerFromConstraints();
        window.__afterConstraintChange = window.__simCalls;

        pick('sharpe');      window.__sharpeAfterConstraint = window.__simCalls;
        pick('aggressive');  window.__aggressiveAfterConstraint = window.__simCalls;
    `);

    check('first comparison runs one simulation', w.__afterSharpe === 1, `calls=${w.__afterSharpe}`);
    check('switching to a new mode runs one more', w.__afterAggressive === 2, `calls=${w.__afterAggressive}`);
    check('switching back is a cache HIT (no extra simulation)', w.__afterBackToSharpe === 2, `calls=${w.__afterBackToSharpe}`);
    check('re-selecting Sharpe after moving the AGGRESSIVE cap is still a cache hit',
        w.__sharpeAfterConstraint === w.__afterConstraintChange,
        `before=${w.__afterConstraintChange}, after=${w.__sharpeAfterConstraint}`);
    check('selecting Aggressive after its cap moved DOES recompute',
        w.__aggressiveAfterConstraint === w.__sharpeAfterConstraint + 1,
        `before=${w.__sharpeAfterConstraint}, after=${w.__aggressiveAfterConstraint}`);

    // ---------- Debounce (real timers) ----------
    console.log('\n=== Constraint input debounce (real timers) ===');
    const w2 = boot();
    w2.eval(script + '\n' + seeded + INIT + `
        window.__refreshCount = 0;
        const realRefresh = refreshOptimizerFromConstraints;
        refreshOptimizerFromConstraints = function() { window.__refreshCount++; return realRefresh(); };
        runOptimizer('aggressive');
        window.__refreshCount = 0; // ignore the initial run
        // Simulate typing "5.25" -> 4 input events in quick succession.
        const input = document.getElementById('opt-aggressive-max-risk');
        ['5', '5.', '5.2', '5.25'].forEach(v => {
            input.value = v;
            input.dispatchEvent(new window.Event('input', { bubbles: true }));
        });
        window.__countImmediatelyAfterTyping = window.__refreshCount;
        // Closure defined in THIS eval so it keeps lexical access to the top-level
        // let-binding (a separate window.eval() later cannot see it).
        window.__getAggRisk = () => (optimizerPresets && optimizerPresets.aggressive) ? optimizerPresets.aggressive.risk : null;
    `);
    check('rapid typing does not refresh immediately', w2.__countImmediatelyAfterTyping === 0,
        `refreshes=${w2.__countImmediatelyAfterTyping}`);

    await new Promise(res => setTimeout(res, 700)); // let the 400ms debounce elapse
    const finalCount = w2.eval('window.__refreshCount');
    const finalRisk = w2.__getAggRisk();
    check('debounce collapses 4 keystrokes into exactly 1 refresh', finalCount === 1, `refreshes=${finalCount}`);
    check('the final typed value is the one applied (S.D. <= 5.25%)', finalRisk <= 0.0525 + 1e-12,
        `risk=${(finalRisk * 100).toFixed(3)}%`);

    console.log(`\n${failures === 0 ? '✅ ALL CHECKS PASSED' : `❌ ${failures} CHECK(S) FAILED`}`);
    process.exitCode = failures === 0 ? 0 : 1;
})();
