// Guards the historical reference figures added in 1.3.0 (Past VaR / Past Max Drawdown).
//
// The defining property of this feature is a negative one: the numbers are entered by the
// user, displayed, saved and printed -- and read by nothing. A feature that does nothing
// cannot be verified by looking at it, so most of this suite checks that the rest of the
// tool is unaffected:
//
//   Section 3  the engine produces identical output whether or not they are filled in
//   Section 4  editing them does NOT mark the last Run stale (it would throw away a
//              perfectly valid result and send the user to press Run for nothing)
//   Section 5  a case file written before this release still opens, and a file written
//              now still carries the values back
//
// Section 2 owns the one piece of arithmetic here: the portfolio-level summary. It is
// deliberately not a single blended "past drawdown" -- see the comment in the app.
const XLSX = require('@e965/xlsx');
const { makeEnv, REAL_FUNDS, flush } = require('../lib/harness');
const { APP, requireFile } = require('../lib/paths');

const FILE = requireFile(APP, 'app under test');
const results = { pass: [], fail: [] };
const check = (name, cond, detail) =>
  cond ? results.pass.push(name) : results.fail.push(name + (detail ? ' :: ' + detail : ''));
const near = (a, b, eps) => Math.abs(a - b) < (eps === undefined ? 1e-9 : eps);
const bytes = (wb) => XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

// Two funds in phase 1 of the active portfolio, weights 70/30, both with history.
const FILLED = `
  portfolios[0].fundsData[1] = [
    { id: 1, name: 'กองทุน ก', weight: 70, yield: 1, capGain: 7, sd: 18, pastVar: 9.5, pastDd: 42 },
    { id: 2, name: 'กองทุน ข', weight: 30, yield: 2, capGain: 2, sd: 4, pastVar: 1.8, pastDd: 12 } ];
  renderFundRows();
`;

// ---------- 1. Default state: nothing entered, nothing shown, nothing opened ----------
{
  const { w, run } = makeEnv(FILE, 3);
  run(`renderStaticChrome();`);
  const d = w.document;
  check('panel starts collapsed', d.getElementById('past-panel').classList.contains('hidden'));
  check('toggle reports collapsed to screen readers',
    d.getElementById('btn-toggle-past').getAttribute('aria-expanded') === 'false');
  check('badge says nothing has been entered',
    d.getElementById('past-filled-badge').textContent.includes('ยังไม่ได้กรอก'),
    d.getElementById('past-filled-badge').textContent);
  check('no default fund ships with a historical value',
    run(`JSON.stringify(portfolios.every(pt => [1,2,3,4].every(ph => (pt.fundsData[ph]||[]).every(f => !pastHas(f.pastVar) && !pastHas(f.pastDd)))))`) === 'true');
  check('summary asks for input rather than printing a number',
    d.getElementById('past-summary').textContent.includes('กรอกการลงลึกสุด'),
    d.getElementById('past-summary').textContent);

  // The toggle is a button with a listener, not an inline onclick -- CSP forbids the latter.
  run(`document.getElementById('btn-toggle-past').dispatchEvent(new window.Event('click', { bubbles: true }))`);
  check('clicking the toggle opens the panel', !d.getElementById('past-panel').classList.contains('hidden'));
  check('toggle now reports expanded',
    d.getElementById('btn-toggle-past').getAttribute('aria-expanded') === 'true');
  run(`document.getElementById('btn-toggle-past').dispatchEvent(new window.Event('click', { bubbles: true }))`);
  check('clicking again closes it', d.getElementById('past-panel').classList.contains('hidden'));
}

// ---------- 2. The summary arithmetic ----------
{
  const { w, run } = makeEnv(FILE, 3);
  run(`renderStaticChrome();` + FILLED);
  const d = w.document;
  const text = d.getElementById('past-summary').textContent.replace(/\s+/g, ' ');

  check('range shows the shallowest and deepest entered value',
    text.includes('-12.0%') && text.includes('-42.0%'), text.slice(0, 160));
  // 0.70 x 42 + 0.30 x 12 = 33.0, i.e. "if every fund bottomed in the same month".
  check('weighted upper bound is weight-weighted, not a plain average',
    text.includes('-33.0%') && !text.includes('-27.0%'), text.slice(0, 220));
  check('upper bound is labelled as an assumption, not as history',
    /ถ้าทุกกองทุนลงลึกสุดพร้อมกัน/.test(text) && /เป็นขอบบน/.test(text), text.slice(0, 260));
  check('coverage of the entered funds is stated', /100% ของน้ำหนัก/.test(text), text.slice(0, 200));

  const summary = JSON.parse(run(`JSON.stringify(pastSummaryData(portfolios[0].fundsData[1]))`));
  check('summary data: min/max/upper bound', near(summary.min, 12) && near(summary.max, 42) && near(summary.upperBound, 33),
    JSON.stringify(summary));

  // Partially filled: the weighted figure must use only the funds that have a value, and
  // say how much of the portfolio that actually covers.
  run(`portfolios[0].fundsData[1][1].pastDd = ''; renderFundRows();`);
  const partial = JSON.parse(run(`JSON.stringify(pastSummaryData(portfolios[0].fundsData[1]))`));
  check('partial entry: upper bound uses only the funds that have values',
    near(partial.upperBound, 42) && partial.filledDd === 1, JSON.stringify(partial));
  check('partial entry: coverage reports the 70% weight actually covered',
    near(partial.coverage, 70), JSON.stringify(partial));
  check('partial entry is visible on screen', d.getElementById('past-summary').textContent.includes('70%'));

  // Per-fund model VaR sits beside the entered one so the comparison is like for like.
  run(FILLED);
  const row = d.querySelectorAll('#past-rows tr')[0];
  const modelCell = row.children[2].textContent.trim();
  const modelVar = JSON.parse(run(`JSON.stringify(monthlyVaR95(0.08, 0.18))`));
  check('model VaR column shows this fund\'s own VaR',
    modelCell === (modelVar * 100).toFixed(2) + '%', `${modelCell} vs ${(modelVar * 100).toFixed(2)}%`);
  check('entered value is shown in its own box',
    row.children[1].querySelector('input').value === '9.5', row.children[1].querySelector('input').value);
}

// ---------- 3. The engine cannot see these values ----------
{
  const a = makeEnv(FILE, 909);
  a.run(REAL_FUNDS);
  const plain = a.run(`JSON.stringify(runSimulation({ silent: true }))`);

  const b = makeEnv(FILE, 909);
  b.run(REAL_FUNDS + `portfolios.forEach(pt => [1,2,3,4].forEach(ph => (pt.fundsData[ph]||[]).forEach(f => { f.pastVar = 7.7; f.pastDd = 55; })));`);
  const filled = b.run(`JSON.stringify(runSimulation({ silent: true }))`);
  check('filling every historical box changes nothing the engine produces', plain === filled,
    `${String(plain).slice(0, 60)} vs ${String(filled).slice(0, 60)}`);

  // Including the forward-looking figures the tool derives from the fund inputs.
  const statsA = a.run(`JSON.stringify(calculatePhaseStats(portfolios[0].fundsData[1]))`);
  const statsB = b.run(`JSON.stringify(calculatePhaseStats(portfolios[0].fundsData[1]))`);
  check('phase stats (incl. VaR) are unaffected too', statsA === statsB);
}

(async () => {

// ---------- 4. Editing them must not invalidate the last Run ----------
{
  const { w, run } = makeEnv(FILE, 11);
  run(REAL_FUNDS + `document.getElementById('btn-run-mc').click();`);
  await flush(300);
  const badgeBefore = w.document.getElementById('status-badge').innerHTML;
  const staleBefore = run(`simResultsStale`);
  const ddBefore = w.document.getElementById('metric-max-drawdown').textContent;

  run(`document.getElementById('btn-toggle-past').dispatchEvent(new window.Event('click', { bubbles: true }));`);
  const input = w.document.querySelector('#past-rows input[data-past="pastDd"]');
  check('an input exists to type into', !!input);
  input.value = '37';
  input.dispatchEvent(new w.Event('input', { bubbles: true }));

  check('the value reached the fund object',
    run(`portfolios.find(p => p.id === activePortId).fundsData[currentEditingPhase][0].pastDd`) === 37);
  check('typing a historical value does NOT mark results stale', run(`simResultsStale`) === staleBefore && staleBefore === false);
  check('the "press Run again" badge is untouched',
    w.document.getElementById('status-badge').innerHTML === badgeBefore);
  check('the drawdown card from the last Run still stands',
    w.document.getElementById('metric-max-drawdown').textContent === ddBefore, ddBefore);
  check('the summary updated live without a re-run',
    w.document.getElementById('past-summary').textContent.includes('-37.0%'),
    w.document.getElementById('past-summary').textContent.slice(0, 120));

  // Blank means "not provided", not zero -- otherwise clearing a box would silently claim
  // the fund never fell.
  input.value = '';
  input.dispatchEvent(new w.Event('input', { bubbles: true }));
  check('clearing a box stores blank, not 0',
    run(`portfolios.find(p => p.id === activePortId).fundsData[currentEditingPhase][0].pastDd`) === '');
  // A fact sheet prints -42%; a person may type either form.
  input.value = '-42';
  input.dispatchEvent(new w.Event('input', { bubbles: true }));
  check('a negative entry is stored as a magnitude',
    run(`portfolios.find(p => p.id === activePortId).fundsData[currentEditingPhase][0].pastDd`) === 42);
}

// ---------- 4b. A Run refreshes the comparison line by itself ----------
// Found by looking at a real PDF export: the panel kept saying "press Run to compare"
// after a Run had already finished, because only typing refreshed it. Checked here with
// NO typing after the Run -- typing would hide the bug by refreshing the panel as a
// side effect, which is exactly how the first version of this check passed by accident.
{
  const { w, run } = makeEnv(FILE, 12);
  run(`renderStaticChrome();` + REAL_FUNDS + FILLED);
  run(`document.getElementById('btn-toggle-past').dispatchEvent(new window.Event('click', { bubbles: true }));`);
  const beforeRun = w.document.getElementById('past-summary').textContent;
  check('before any Run the panel asks for one', beforeRun.includes('กด "ประมวลผลกราฟ"'), beforeRun.slice(0, 120));

  run(`document.getElementById('btn-run-mc').click();`);
  await flush(300);
  const afterRun = w.document.getElementById('past-summary').textContent;
  check('a Run refreshes the comparison line without the user touching anything',
    !afterRun.includes('กด "ประมวลผลกราฟ"'), afterRun.slice(0, 160));
  check('the refreshed line carries this Run\'s own figures',
    afterRun.includes(run(`fmtDrawdown(globalExportData.maxDrawdown.median)`)) &&
    afterRun.includes(run(`fmtDrawdown(globalExportData.maxDrawdown.worst10)`)),
    afterRun.slice(0, 200));
}

// ---------- 5. Case file: both directions of compatibility ----------
{
  const A = makeEnv(FILE, 21);
  A.run(REAL_FUNDS + FILLED + `document.getElementById('btn-run-mc').click();`);
  await flush(300);
  const wb = A.run(`buildCaseWorkbook('ทดสอบอดีต')`);
  const buf = bytes(wb);
  const reread = XLSX.read(buf, { type: 'buffer' });

  const fundsAoa = XLSX.utils.sheet_to_json(reread.Sheets['กองทุน'], { header: 1 });
  check('funds sheet gained the two keys, appended at the end',
    fundsAoa[1].slice(-2).join(',') === 'pastVar,pastDd', JSON.stringify(fundsAoa[1]));
  check('existing fund keys kept their order',
    fundsAoa[1].slice(0, 7).join(',') === 'portId,phase,fundName,weight,yield,capGain,sd', JSON.stringify(fundsAoa[1]));
  check('schemaVersion stayed at 1 (nothing was redefined)',
    XLSX.utils.sheet_to_json(reread.Sheets['_meta'], { header: 1 }).find(r => r && r[0] === 'schemaVersion')[1] === 1);

  const resultsAoa = XLSX.utils.sheet_to_json(reread.Sheets['ผลจำลอง 30 ปี'], { header: 1 });
  const ddMed = resultsAoa.find(r => r && r[0] === 'maxDrawdownMedian');
  const ddW10 = resultsAoa.find(r => r && r[0] === 'maxDrawdownWorst10');
  const live = JSON.parse(A.run(`JSON.stringify(globalExportData.maxDrawdown)`));
  check('results sheet carries the drawdown figures', !!ddMed && !!ddW10,
    JSON.stringify(resultsAoa.slice(-4)));
  check('saved drawdown matches what the app showed',
    !!ddMed && !!ddW10 && near(ddMed[2], live.median * 100, 1e-3) && near(ddW10[2], live.worst10 * 100, 1e-3),
    `${ddMed && ddMed[2]} / ${ddW10 && ddW10[2]} vs ${live.median * 100} / ${live.worst10 * 100}`);

  // Open it in a fresh instance.
  const B = makeEnv(FILE, 22);
  B.w.__wb = reread;
  const parsed = B.run(`JSON.stringify(parseCaseWorkbook(window.__wb).state.portfolios[0].fundsData[1].map(f => [f.name, f.pastVar, f.pastDd]))`);
  check('historical values survive save -> open',
    JSON.parse(parsed)[0][1] === 9.5 && JSON.parse(parsed)[0][2] === 42 && JSON.parse(parsed)[1][2] === 12, parsed);
  const warn = B.run(`JSON.stringify((parseCaseWorkbook(window.__wb).warnings || []))`);
  check('no warnings produced by the new columns', warn === '[]', warn);

  // A file saved BEFORE 1.3.0: same sheet with the two columns physically removed.
  const legacy = XLSX.read(buf, { type: 'buffer' });
  const aoa = XLSX.utils.sheet_to_json(legacy.Sheets['กองทุน'], { header: 1 }).map(r => r.slice(0, 7));
  legacy.Sheets['กองทุน'] = XLSX.utils.aoa_to_sheet(aoa);
  const C = makeEnv(FILE, 23);
  C.w.__wb = legacy;
  const old = C.run(`JSON.stringify(parseCaseWorkbook(window.__wb).state.portfolios[0].fundsData[1].map(f => [f.pastVar, f.pastDd]))`);
  check('a pre-1.3.0 case file still opens, with the boxes blank',
    JSON.parse(old).every(p => p[0] === '' && p[1] === ''), old);
  const oldWarn = C.run(`JSON.stringify((parseCaseWorkbook(window.__wb).warnings || []))`);
  check('an old file produces no warnings either', oldWarn === '[]', oldWarn);
}

// ---------- 6. The report prints them only when they exist ----------
{
  const empty = makeEnv(FILE, 31);
  empty.run(REAL_FUNDS + `document.getElementById('btn-run-mc').click();`);
  await flush(300);
  await flush(300);
  const emptyHtml = empty.run(`(() => { const r = document.createElement('div');
    return pdfBuildSummary({ root: r, asOf: { date: '1 ม.ค. 2569', time: '09:00' } }).map(p => p.page.innerHTML).join(''); })()`);
  check('a report from an untouched panel has no historical block',
    !emptyHtml.includes('ค่าที่เคยเกิดขึ้นจริงในอดีต'));

  const filled = makeEnv(FILE, 31);
  filled.run(REAL_FUNDS + FILLED + `document.getElementById('btn-run-mc').click();`);
  await flush(300);
  filled.run(`window.DISCLAIMER_PAST = DISCLAIMER_PAST;`);
  const html = filled.run(`(() => { const r = document.createElement('div');
    return pdfBuildSummary({ root: r, asOf: { date: '1 ม.ค. 2569', time: '09:00' } }).map(p => p.page.innerHTML).join(''); })()`);
  check('the block appears once values exist', html.includes('ค่าที่เคยเกิดขึ้นจริงในอดีต'));
  check('entered values are printed with their sign',
    html.includes('-42.0%') && html.includes('-9.5%'), html.slice(html.indexOf('เคยเกิดขึ้นจริง'), html.indexOf('เคยเกิดขึ้นจริง') + 500));
  check('the report carries the same caveat constant as the page',
    html.includes(filled.w.DISCLAIMER_PAST));
  check('the page note is that same constant',
    filled.w.document.getElementById('past-panel-note').textContent === filled.w.DISCLAIMER_PAST);
  check('the caveat says the values are not used in any calculation',
    /ไม่ถูกนำไปใช้ในการคำนวณ/.test(filled.w.DISCLAIMER_PAST), filled.w.DISCLAIMER_PAST);
}

console.log(`PASS ${results.pass.length}  FAIL ${results.fail.length}`);
results.fail.forEach(f => console.log('  XX  ' + f));
process.exit(results.fail.length ? 1 : 0);

})();
