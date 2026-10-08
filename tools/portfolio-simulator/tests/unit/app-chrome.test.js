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
const fs = require('fs');
const { APP, TOOL_DIR, requireFile } = require('../lib/paths');

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
  window.DISCLAIMER_RISK_METRICS = DISCLAIMER_RISK_METRICS;
  window.DISCLAIMER_MAXDD = DISCLAIMER_MAXDD;
  window.WD_MODE_NOTES = WD_MODE_NOTES;
  window.PDF_WD_MODE_LABELS = PDF_WD_MODE_LABELS;
  window.globalWithdrawal = globalWithdrawal;
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
const riskNote = doc.getElementById('risk-note-survival');
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

// --- 7. The link to the user manual (1.4.0) ---
// The manual existed for two releases with nothing on the page pointing at it. Three
// things about this one link can break without anything looking wrong on screen:
//
//   a) The filename carries a version number, so the obvious future mistake is shipping a
//      new manual and leaving the link on the old one -- or on a file that is not there at
//      all. The reader gets a 404, or last year's book, and nobody finds out.
//   b) target="_blank" is not politeness here. The tool keeps everything in the page and
//      has no backend, so opening the PDF in the same tab throws away whatever the person
//      had already typed in.
//   c) docs/README.md is the index of what lives in docs/. If the page and that index name
//      different files, one of them is lying to the reader.
const manualLink = doc.getElementById('manual-link');
check('footer links to the user manual', !!manualLink, '(no element with id="manual-link")');

const href = manualLink ? (manualLink.getAttribute('href') || '') : '';
check('manual link is a relative path inside docs/', /^docs\/[^/]+\.pdf$/.test(href), href);
check('manual link opens in a new tab (the page holds unsaved input)',
  manualLink && manualLink.getAttribute('target') === '_blank',
  manualLink ? String(manualLink.getAttribute('target')) : '');
check('manual link sets rel="noopener"',
  manualLink && (manualLink.getAttribute('rel') || '').includes('noopener'),
  manualLink ? String(manualLink.getAttribute('rel')) : '');
check('manual link has visible text',
  manualLink && manualLink.textContent.trim().length > 3,
  manualLink ? manualLink.textContent : '');

const manualPath = path.join(TOOL_DIR, href || 'docs/__missing__');
const manualThere = !!href && fs.existsSync(manualPath);
check('the file the manual link points at exists in the repo', manualThere, manualPath);
check('that file is a real PDF, not an empty placeholder',
  manualThere && fs.statSync(manualPath).size > 50000,
  manualThere ? fs.statSync(manualPath).size + ' bytes' : '(missing)');

// Pointing at a manual that exists is not enough: the old editions stay in docs/ on
// purpose (that folder's own rule is never to overwrite one), so "the file is there" would
// still pass if the link were left on last year's book. The link must name the NEWEST
// edition present. Deliberately not compared against APP_VERSION: a release that does not
// change the interface should keep the manual it has, and forcing a new one would mean
// shipping a reprint with nothing new in it.
const manualsInDocs = fs.existsSync(path.join(TOOL_DIR, 'docs'))
  ? fs.readdirSync(path.join(TOOL_DIR, 'docs'))
      .filter(f => /^PortfolioSimulator_UserManual_v\d+\.\d+\.\d+\.pdf$/.test(f))
  : [];
const verKey = (f) => (f.match(/v(\d+)\.(\d+)\.(\d+)\.pdf$/) || []).slice(1).map(Number);
const cmpVer = (a, b) => { const x = verKey(a), y = verKey(b);
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i]; return 0; };
const newestManual = manualsInDocs.slice().sort(cmpVer).pop();
check('docs/ contains at least one versioned manual', manualsInDocs.length > 0,
  JSON.stringify(manualsInDocs));
check('manual link points at the NEWEST edition in docs/, not an older one',
  !!newestManual && path.basename(href) === newestManual,
  `link=${path.basename(href)}  newest=${newestManual}  all=${JSON.stringify(manualsInDocs)}`);

const docsReadme = path.join(TOOL_DIR, 'docs', 'README.md');
check('docs/README.md exists', fs.existsSync(docsReadme), docsReadme);
check('docs/README.md lists the same file the page links to',
  !!href && fs.existsSync(docsReadme) &&
    fs.readFileSync(docsReadme, 'utf8').includes(path.basename(href)),
  href ? path.basename(href) : '');

// --- 8. Risk-metric explanations moved out of the stats panel (chunk A) ---
// Three long explanations concatenated into one paragraph under the table came to roughly
// 2,400 characters of grey text, which is a wall nobody reads. The wording is unchanged and
// still comes from the shared constants -- what changed is that each is its own bullet next
// to the main disclaimer, with a signpost left where they used to be. Both halves are checked
// here: a signpost with no bullets, or bullets with no signpost, each lose half the point.
check('the old single-paragraph risk note is gone', !doc.getElementById('stats-risk-note'));

const pointer = doc.getElementById('stats-risk-pointer');
check('a signpost is left under the stats table', !!pointer);
check('the signpost names where the explanations went',
  pointer && pointer.textContent.includes('คำอธิบายตัวเลขความเสี่ยง'),
  pointer ? pointer.textContent : '(element missing)');
// If this ever grows past a line or two, the wall has quietly moved back.
check('the signpost stays short (it points, it does not explain)',
  pointer && pointer.textContent.length < 200,
  pointer ? pointer.textContent.length + ' chars' : '(element missing)');

const riskBullets = {
  'risk-note-survival': w.DISCLAIMER_SURVIVAL,
  'risk-note-var': w.DISCLAIMER_RISK_METRICS,
  'risk-note-maxdd': w.DISCLAIMER_MAXDD,
};
Object.entries(riskBullets).forEach(([id, text]) => {
  const el = doc.getElementById(id);
  check(`bullet #${id} exists`, !!el, '(element missing)');
  check(`bullet #${id} carries its shared constant verbatim`,
    el && el.textContent === text, el ? el.textContent.slice(0, 90) : '(element missing)');
});
check('the three explanations sit in one list',
  doc.querySelectorAll('#risk-notes li').length === 3,
  String(doc.querySelectorAll('#risk-notes li').length));

// --- 9. Withdrawal-mode naming (chunk A) ---
// Four surfaces name each mode: the button, the note under the buttons, the PDF label, and the
// id the engines switch on. A mode that gains a button but no note ships looking finished and
// reads as a blank line; one with no PDF label prints its raw id into the report.
const modeIds = Object.keys(w.PDF_WD_MODE_LABELS);
check('every withdrawal mode has a PDF label', modeIds.length >= 3, JSON.stringify(modeIds));
modeIds.forEach(m => {
  check(`mode "${m}" has a note under the buttons`,
    typeof w.WD_MODE_NOTES[m] === 'string' && w.WD_MODE_NOTES[m].length > 10,
    String(w.WD_MODE_NOTES[m]));
});
check('notes cover exactly the modes the PDF labels cover',
  JSON.stringify(Object.keys(w.WD_MODE_NOTES).sort()) === JSON.stringify(modeIds.slice().sort()),
  JSON.stringify(Object.keys(w.WD_MODE_NOTES)));

const modeNoteEl = doc.getElementById('global-wd-mode-note');
check('the mode note element exists', !!modeNoteEl, '(element missing)');
check('the mode note is filled for the mode selected on load',
  modeNoteEl && modeNoteEl.textContent.trim().length > 10,
  modeNoteEl ? modeNoteEl.textContent : '(element missing)');

// Renamed in chunk A. "ดึงคงที่สู้เงินเฟ้อ" read as a contradiction -- constant, yet fighting
// inflation -- and never said which of the two was constant (it is purchasing power; the baht
// figure rises). A stray copy left on any surface puts two names for one mode in front of the
// same reader.
const appSrc = fs.readFileSync(requireFile(APP, 'app under test'), 'utf8');
['ดึงคงที่สู้เงินเฟ้อ', 'ระบุยอด (บาท/เดือน)', 'ระบุยอดถอน (บาท/งวด)'].forEach(old => {
  check(`old mode wording is gone everywhere: "${old}"`, !appSrc.includes(old),
    'still present');
});

// --- 10. The withdrawal start cannot be dragged below year 1 (chunk A) ---
// min="1" on the input governs the spinner arrows only; a typed or pasted "-1" went straight
// through, and a negative startY makes startWdM negative. Withdrawals then begin in month 1 as
// usual, but monthsSinceWdStart starts at 12 or more -- so the very first withdrawal is already
// inflated by a year, and the fixed-amount frequency lands on different months. Wrong numbers,
// nothing on screen to say so. ("0" happened to be caught by the || 1 fallback; -1 was not.)
const fireInput = (el, v) => {
  el.value = String(v);
  el.dispatchEvent(new w.Event('input', { bubbles: true }));
};
const startYEl = doc.getElementById('global-wd-start-y');
const startMEl = doc.getElementById('global-wd-start-m');
check('the start-year input exists', !!startYEl, '(element missing)');
check('the start-month input exists', !!startMEl, '(element missing)');
if (startYEl && startMEl) {
  fireInput(startYEl, -3);
  check('a negative start year is clamped to 1', w.globalWithdrawal.startY === 1, String(w.globalWithdrawal.startY));
  fireInput(startYEl, 0);
  check('start year 0 resolves to 1', w.globalWithdrawal.startY === 1, String(w.globalWithdrawal.startY));
  fireInput(startYEl, 7);
  check('a valid start year is left alone', w.globalWithdrawal.startY === 7, String(w.globalWithdrawal.startY));
  fireInput(startMEl, -2);
  check('a negative start month is clamped to 1', w.globalWithdrawal.startM === 1, String(w.globalWithdrawal.startM));
  fireInput(startMEl, 6);
  check('a valid start month is left alone', w.globalWithdrawal.startM === 6, String(w.globalWithdrawal.startM));
}

console.log(`PASS ${results.pass.length}  FAIL ${results.fail.length}`);
results.fail.forEach(f => console.log('  XX  ' + f));
process.exit(results.fail.length ? 1 : 0);
