// Guards the HTML-escaping fix from 2026-09-07.
//
// Portfolio and fund names are free text the user types, and they are concatenated
// into innerHTML in five places -- including into an attribute (value="...") in
// renderFundRows, which is the dangerous one, because a bare double quote there can
// break out of the attribute and add new ones.
//
// The predecessor of this file printed the rendered HTML for a human to read and
// always exited 0, so it could not fail in CI. This one asserts on the PARSED DOM
// instead of on strings: what matters is not whether the markup "looks escaped" but
// whether the browser ended up with extra elements or extra attributes.
const fs = require('fs');
const { JSDOM } = require('jsdom');
const { APP, requireFile } = require('../lib/paths');

const html = fs.readFileSync(requireFile(APP, 'app under test'), 'utf8');
const scriptSrc = html.match(/<script>\s*([\s\S]*?)<\/script>/)[1];

const results = { pass: [], fail: [] };
const check = (name, cond, detail) =>
  cond ? results.pass.push(name) : results.fail.push(name + (detail ? ' :: ' + detail : ''));

// Only the elements the render functions touch; we call them directly rather than
// through DOMContentLoaded, so the full element set is not needed.
const DOM_HTML = `<!DOCTYPE html><html><body>
  <div id="port-tabs-container"></div>
  <div id="priority-order-container"></div>
  <select id="chart-port-selector"></select>
  <table><tbody id="phase-metrics-body"></tbody></table>
  <table><tbody id="fund-rows"></tbody></table>
  <span id="total-weight-badge"></span>
  <span id="global-weight-badge"></span>
</body></html>`;

function render(portName, fundName) {
  const dom = new JSDOM(DOM_HTML, { runScripts: 'outside-only' });
  const { window } = dom;
  // One eval: top-level let/const in the app script do not bind to window, so a
  // second eval would not see the overrides. (Documented in the handoff.)
  window.eval(scriptSrc + `
    portfolios[0].name = ${JSON.stringify(portName)};
    portfolios[0].fundsData[1][0].name = ${JSON.stringify(fundName)};
    globalWithdrawal.priorityOrder = portfolios.map(p => p.id);
    renderPortTabs(); renderPriorityOrderUI(); renderChartPortOptions();
    renderFundRows(); updatePhaseStatsTable();
    window.__portfolioCount = portfolios.length;
  `);
  const d = window.document;
  return {
    window, d,
    tabs: d.getElementById('port-tabs-container'),
    priority: d.getElementById('priority-order-container'),
    selector: d.getElementById('chart-port-selector'),
    fundRows: d.getElementById('fund-rows'),
    stats: d.getElementById('phase-metrics-body'),
  };
}

// The app legitimately emits a few inline handlers of its own (movePriority,
// deletePortfolio). So the test is not "no on* attributes anywhere" -- it is
// "rendering a hostile name produces exactly the same set of handlers and the
// same element shape as rendering a harmless one".
const BENIGN_PORT = 'Portfolio One';
const BENIGN_FUND = 'FUND-A';

function shape(el) {
  return [...el.querySelectorAll('*')].map(n =>
    n.tagName + '[' + [...n.attributes].map(a => a.name).sort().join(',') + ']').join('|');
}

// ---------------------------------------------------------------- case 1: attack
const ATTACK_PORT = '<img src=x onerror=alert(1)>" onmouseover="alert(2)';
const ATTACK_FUND = '" onfocus="alert(3)" autofocus x="';
{
  const benign = render(BENIGN_PORT, BENIGN_FUND);
  const r = render(ATTACK_PORT, ATTACK_FUND);
  const keys = ['tabs', 'priority', 'selector', 'stats', 'fundRows'];

  for (const where of keys) {
    const el = r[where];
    check(`attack: no <img> injected into ${where}`,
      el.querySelectorAll('img').length === 0,
      `${el.querySelectorAll('img').length} img element(s)`);
    // Same elements, same attribute names as the harmless render: a payload that
    // added a handler or an element would change this fingerprint.
    check(`attack: ${where} has the same element/attribute shape as a harmless name`,
      shape(el) === shape(benign[where]),
      'differs from benign render');
  }

  // The attribute context is the one that can break out.
  const row = r.fundRows.children[0];
  const nameInput = row && row.querySelector('input[data-field="name"]');
  check('attack: fund table row count unchanged by the payload',
    r.fundRows.children.length === benign.fundRows.children.length,
    `${r.fundRows.children.length} vs ${benign.fundRows.children.length}`);
  check('attack: name input exists', !!nameInput);
  check('attack: no stray autofocus attribute on the name input',
    nameInput && !nameInput.hasAttribute('autofocus'));
  check('attack: the payload survives intact as DATA in .value (not markup)',
    nameInput && nameInput.value === ATTACK_FUND,
    nameInput ? JSON.stringify(nameInput.value) : '(no input)');
  check('attack: row still has its 5 inputs',
    row && row.querySelectorAll('input').length === 5,
    row ? String(row.querySelectorAll('input').length) : '(no row)');

  // The portfolio name lands in innerHTML contexts; it must appear as text.
  check('attack: portfolio name appears as text in the tabs, not markup',
    r.tabs.textContent.includes(ATTACK_PORT),
    JSON.stringify(r.tabs.textContent.slice(0, 120)));
  check('attack: chart selector has one option per portfolio plus "total"',
    r.selector.querySelectorAll('option').length === r.window.__portfolioCount + 1,
    String(r.selector.querySelectorAll('option').length));
  check('attack: selector option text is the raw name',
    [...r.selector.querySelectorAll('option')].some(o => o.textContent === ATTACK_PORT));
}

// ------------------------------------------------- case 2: ordinary & and quotes
const PLAIN_PORT = 'Fund A & B "Premium"';
const PLAIN_FUND = 'Bond "AAA" & Co.';
{
  const r = render(PLAIN_PORT, PLAIN_FUND);
  const nameInput = r.fundRows.querySelector('input[data-field="name"]');
  check('plain: & and quotes round-trip exactly in .value',
    nameInput && nameInput.value === PLAIN_FUND,
    nameInput ? JSON.stringify(nameInput.value) : '(no input)');
  check('plain: & and quotes render as text in the tabs',
    r.tabs.textContent.includes(PLAIN_PORT),
    JSON.stringify(r.tabs.textContent.slice(0, 120)));
  check('plain: no double-escaping (&amp;amp; must not appear)',
    !r.tabs.innerHTML.includes('&amp;amp;'));
}

// ------------------------------------------------------ case 3: ordinary Thai name
{
  const THAI_PORT = 'พอร์ต 1 (ปันผล/สภาพคล่อง)';
  const THAI_FUND = 'MGALL-UH';
  const r = render(THAI_PORT, THAI_FUND);
  const nameInput = r.fundRows.querySelector('input[data-field="name"]');
  check('thai: ordinary name unchanged in .value', nameInput && nameInput.value === THAI_FUND);
  check('thai: ordinary name rendered as-is in the tabs', r.tabs.textContent.includes(THAI_PORT));
  check('thai: no escape entities leaked into visible text',
    !r.tabs.textContent.includes('&quot;') && !r.tabs.textContent.includes('&#39;'));
}

console.log(`PASS ${results.pass.length}  FAIL ${results.fail.length}`);
results.fail.forEach(f => console.log('  XX  ' + f));
process.exit(results.fail.length ? 1 : 0);
