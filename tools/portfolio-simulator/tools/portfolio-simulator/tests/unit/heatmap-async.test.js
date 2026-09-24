const fs = require('fs');
const vm = require('vm');
const { JSDOM } = require('jsdom');

const { APP, requireFile } = require('../lib/paths');
const html = fs.readFileSync(requireFile(APP, 'app under test'), 'utf8');
const scriptMatch = html.match(/<script>([\s\S]*?)<\/script>/);
let script = scriptMatch[1];

const dom = new JSDOM(html, { runScripts: 'outside-only', pretendToBeVisual: true });
const { window } = dom;
const vmContext = dom.getInternalVMContext();

let seed = 7;
window.Math.random = function() {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  return (seed % 1000000) / 1000000;
};
window.HTMLCanvasElement.prototype.getContext = function() { return {}; };
window.Chart = class { constructor(ctx, config) { this.config = config; } destroy() {} };
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

window.document.getElementById('init-investment').value = '10000000';
window.document.getElementById('inflation-rate').value = '2.5';
window.document.getElementById('heatmap-rates').value = '3%, 4%, 50000';

window.runHeatmap(); // kicks off setTimeout(...,50)

setTimeout(() => {
  const body = window.document.getElementById('heatmap-body').innerHTML;
  const hasNaN = body.includes('NaN');
  const hasPercent = /\d+\.\d%/.test(body);
  console.log('Heatmap body populated:', body.length > 200);
  console.log('Heatmap body has NaN:', hasNaN);
  console.log('Heatmap body has percentages:', hasPercent);
  console.log('--- sample ---');
  console.log(body.slice(0, 600));
  process.exit(hasNaN || body.length < 200 ? 1 : 0);
}, 300);
