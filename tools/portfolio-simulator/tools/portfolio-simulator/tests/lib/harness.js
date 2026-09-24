// Shared jsdom harness: loads the simulator HTML, seeds Math.random, stubs canvas/Chart/marked.
const fs = require('fs');
const vm = require('vm');
const { JSDOM } = require('jsdom');

function makeEnv(file, seed, extraStubs) {
  const html = fs.readFileSync(file, 'utf8');
  const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
  const dom = new JSDOM(html, { runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window;
  let s = seed;
  w.Math.random = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return (s % 1000000) / 1000000; };
  w.HTMLCanvasElement.prototype.getContext = function () { return {}; };
  w.chartLog = [];
  w.Chart = class {
    constructor(ctx, config) { this.config = config; this.data = config.data; w.chartLog.push(config); }
    destroy() {}
    toBase64Image() { return 'data:image/png;base64,iVBORw0KGgo='; }
  };
  w.marked = { parse: (x) => x };
  w.XLSX = require('xlsx');
  w.confirm = () => true;
  w.alertLog = [];
  w.alert = (m) => w.alertLog.push(String(m));
  w.scrollTo = () => {};
  w.HTMLElement.prototype.scrollIntoView = function () {};
  if (extraStubs) extraStubs(w);
  const ctx = dom.getInternalVMContext();
  vm.runInContext(script, ctx);
  vm.runInContext(`setupUIEventListeners(); renderPortTabs(); renderPriorityOrderUI(); renderChartPortOptions(); syncActivePortUI(); updatePhaseStatsTable();`, ctx);
  const run = (code) => vm.runInContext(code, ctx);
  return { dom, w, run };
}

// A realistic fund set (non-blank Expected values) so the engines produce non-trivial numbers.
const REAL_FUNDS = `
  const f1 = [
    { id: 1, name: "ES-WDEQ", weight: 20, yield: 1.0, capGain: 6.0, sd: 15.0 },
    { id: 2, name: "MGALL-UH", weight: 40, yield: 0.8, capGain: 6.5, sd: 14.0 },
    { id: 3, name: "TGSMART-A", weight: 20, yield: 3.0, capGain: 2.0, sd: 6.0 },
    { id: 4, name: "SCBGEARA", weight: 20, yield: 2.5, capGain: 1.0, sd: 3.0 } ];
  const f2 = [
    { id: 1, name: "MGALL-UH", weight: 40, yield: 0.8, capGain: 6.5, sd: 14.0 },
    { id: 2, name: "TGSMART-A", weight: 40, yield: 3.0, capGain: 2.0, sd: 6.0 },
    { id: 3, name: "SCBGEARA", weight: 20, yield: 2.5, capGain: 1.0, sd: 3.0 } ];
  portfolios.forEach(pt => { pt.fundsData[1] = JSON.parse(JSON.stringify(f1)); [2,3,4].forEach(i => pt.fundsData[i] = JSON.parse(JSON.stringify(f2))); });
`;

function flush(ms) { return new Promise(r => setTimeout(r, ms || 400)); }

module.exports = { makeEnv, REAL_FUNDS, flush };
