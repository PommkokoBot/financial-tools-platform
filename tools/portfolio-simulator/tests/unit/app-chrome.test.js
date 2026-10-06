// Guards the page "chrome" added in round C: the version string and the disclaimer.
//
// Two things here are easy to break by accident and invisible when broken:
//
//   1. The disclaimer wording lives in ONE constant shared by the page footer and every
//      PDF page. The obvious future mistake is editing the side you happen to be looking
//      at, leaving the tool saying two different things about itself. The checks below
//      compare the two rendered outputs against the same constant, so a one-sided edit
//      turns this suite red.
//
//   2. The visible disclaimer is the only thing on a public page that says these numbers
//      are not investment advice. Deleting the element would not break a single other
//      test, and nothing on screen would look wrong.
const path = require('path');
const { makeEnv } = require('../lib/harness');
const { APP, requireFile } = require('../lib/paths');

const { w, run } = makeEnv(requireFile(APP, 'app under test'), 7);

const results = { pass: [], fail: [] };
const check = (name, cond, detail) =>
  cond ? results.pass.push(name) : results.fail.push(name + (detail ? ' :: ' + detail : ''));

// Export the round-C constants and render the static chrome.
run(`
  renderStaticChrome();
  window.APP_VERSION = APP_VERSION;
  window.DISCLAIMER_CORE = DISCLAIMER_CORE;
  window.DISCLAIMER_SHORT = DISCLAIMER_SHORT;
  window.DISCLAIMER_WEB_PRIVACY = DISCLAIMER_WEB_PRIVACY;
  window.pdfDisclaimerHtml = pdfDisclaimerHtml;
  window.buildCaseWorkbook = buildCaseWorkbook;
`);

const doc = w.document;
const V = w.APP_VERSION;

// --- 1. Version string ---
check('APP_VERSION is defined', typeof V === 'string' && V.length > 0, String(V));
check('APP_VERSION looks like a version number', /^\d+\.\d+\.\d+$/.test(V || ''), String(V));

const headerLabel = doc.getElementById('app-version-label');
check('header shows the version', headerLabel && headerLabel.textContent === 'v' + V,
  headerLabel ? headerLabel.textContent : '(element missing)');

const footerVersion = doc.getElementById('footer-version');
check('footer shows the version', footerVersion && footerVersion.textContent.includes(V),
  footerVersion ? footerVersion.textContent : '(element missing)');

// --- 2. Short strip under the header ---
const strip = doc.getElementById('disclaimer-strip');
const stripText = doc.getElementById('disclaimer-strip-text');
check('disclaimer strip element exists', !!strip);
check('disclaimer strip has text', stripText && stripText.textContent.trim().length > 20,
  stripText ? stripText.textContent : '(element missing)');
check('disclaimer strip text comes from DISCLAIMER_SHORT',
  stripText && stripText.textContent === w.DISCLAIMER_SHORT);
check('disclaimer strip says it is not investment advice',
  stripText && stripText.textContent.includes('ไม่ใช่คำแนะนำการลงทุน'), stripText && stripText.textContent);
check('disclaimer strip says data stays on the user machine',
  stripText && /ไม่ถูกส่งออก|ในเครื่องของท่าน/.test(stripText.textContent), stripText && stripText.textContent);
// Agreed explicitly: a bar with a close button gets dismissed unread.
check('disclaimer strip is not dismissible (no button inside)',
  strip && strip.querySelectorAll('button, [role="button"], .close, [data-dismiss]').length === 0,
  strip ? strip.innerHTML.slice(0, 200) : '');

// --- 3. Full disclaimer in the footer ---
const full = doc.getElementById('disclaimer-full');
check('footer disclaimer element exists', !!full);
check('footer disclaimer carries the shared core wording',
  full && full.textContent.includes(w.DISCLAIMER_CORE),
  full ? full.textContent.slice(0, 160) : '(element missing)');
check('footer disclaimer carries the privacy sentence',
  full && full.textContent.includes(w.DISCLAIMER_WEB_PRIVACY),
  full ? full.textContent.slice(-160) : '');
check('footer disclaimer disclaims any tie to a financial institution',
  full && full.textContent.includes('ไม่มีความเกี่ยวข้องกับสถาบันการเงินหรือบริษัทหลักทรัพย์ใดๆ'));

// --- 3b. What the survival headline actually counts (1.4.0) ---
// The phrase "chance the portfolio survives" reads stronger than what is measured, in two
// specific ways that both flatter the result. Both must be stated, on the page and in the
// report, from one constant -- the same anti-drift arrangement as the disclaimer itself.
run(`window.DISCLAIMER_SURVIVAL = DISCLAIMER_SURVIVAL;`);
const riskNote = doc.getElementById('stats-risk-note');
check('page risk note carries the survival explanation',
  riskNote && riskNote.textContent.includes(w.DISCLAIMER_SURVIVAL),
  riskNote ? riskNote.textContent.slice(0, 120) : '(element missing)');
check('explanation names the 1,000 paths it counts',
  /1,000 เส้นทาง/.test(w.DISCLAIMER_SURVIVAL), w.DISCLAIMER_SURVIVAL);
check('explanation says the test is "more than 0 at the end of year 30"',
  /สิ้นปีที่ 30/.test(w.DISCLAIMER_SURVIVAL) && /มากกว่า 0/.test(w.DISCLAIMER_SURVIVAL), w.DISCLAIMER_SURVIVAL);
check('explanation admits it does not mean "never ran out along the way"',
  /ไม่ได้แปลว่าไม่เคยหมดระหว่างทาง/.test(w.DISCLAIMER_SURVIVAL), w.DISCLAIMER_SURVIVAL);
check('explanation admits "more than 0" is not "enough to live on"',
  /ไม่ได้แปลว่าเหลือพอใช้/.test(w.DISCLAIMER_SURVIVAL), w.DISCLAIMER_SURVIVAL);

// And it must match what the engine actually does: survival is counted once, after the
// last month, on the summed balance being greater than zero.
run(`window.__src = [...document.querySelectorAll('script')].filter(x => !x.src).map(x => x.textContent).join('');`);
check('the engine really counts end-of-horizon balance > 0',
  /let endTotal = portfolios\.reduce\([\s\S]{0,120}?if \(endTotal > 0\) successfulPaths\+\+;/.test(w.__src));

// --- 4. The anti-drift check: page and PDF must print the same core wording ---
const pdfHtml = w.pdfDisclaimerHtml('1 ม.ค. 2569');
check('PDF disclaimer carries the same shared core wording',
  pdfHtml.includes(w.DISCLAIMER_CORE), pdfHtml.slice(0, 200));
check('page and PDF disclaimers are not two independent copies',
  full && full.textContent.includes(w.DISCLAIMER_CORE) && pdfHtml.includes(w.DISCLAIMER_CORE));
// The privacy line is web-only by decision: the PDF wording was already approved as-is.
check('PDF wording was left unchanged (no privacy sentence added to it)',
  !pdfHtml.includes(w.DISCLAIMER_WEB_PRIVACY));

// --- 5. Version reaches the saved case file ---
// This is what makes a stranger's bug report traceable: the file they send back names
// the build that produced it.
try {
  const wb = w.buildCaseWorkbook('ทดสอบ');
  const meta = w.XLSX.utils.sheet_to_json(wb.Sheets['_meta'], { header: 1 });
  const row = meta.find(r => r && r[0] === 'appVersion');
  check('case file _meta contains appVersion', !!row, JSON.stringify(meta.map(r => r && r[0])));
  check('case file appVersion matches APP_VERSION', row && String(row[1]) === V, row ? String(row[1]) : '(missing)');
  check('case file still contains schemaVersion (backward compatible)',
    meta.some(r => r && r[0] === 'schemaVersion'));
} catch (e) {
  check('case file _meta contains appVersion', false, e.stack);
}

// --- 6. Version reaches the PDF cover ---
try {
  run(`
    const __root = document.createElement('div');
    const __cover = pdfBuildCover({ root: __root, asOf: { date: '1 ม.ค. 2569', time: '09:00' } });
    window.__coverHtml = __cover.page.innerHTML;
  `);
  check('PDF cover prints the version', w.__coverHtml.includes('v' + V),
    (w.__coverHtml || '').slice(0, 300));
} catch (e) {
  check('PDF cover prints the version', false, e.stack);
}

console.log(`PASS ${results.pass.length}  FAIL ${results.fail.length}`);
results.fail.forEach(f => console.log('  XX  ' + f));
process.exit(results.fail.length ? 1 : 0);
