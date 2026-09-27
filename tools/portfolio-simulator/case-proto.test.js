// Guards the prototype-key fix in the case-file parser (round B, 2026-09-24).
//
// Column headers in the "พอร์ต"/"กองทุน" sheets and setting keys in "ตั้งค่าหลัก" come
// from a file the user chose, and the parser uses them directly as property names.
// "__proto__" is special on a plain object: assigning to it replaces the object's
// prototype instead of adding a field, which can change how unrelated code behaves.
//
// Written to FAIL against the pre-fix parser, not just to pass against the fixed one.
const XLSX = require('@e965/xlsx'); // must match the SheetJS version index.html loads
const { makeEnv } = require('../lib/harness');
const { APP, requireFile } = require('../lib/paths');
const FILE = requireFile(APP, 'app under test');

const results = { pass: 0, fail: [] };
const check = (name, cond, detail) => { if (cond) results.pass++; else results.fail.push(name + (detail !== undefined ? ' :: ' + detail : '')); };

const bytes = (b64) => Buffer.from(b64, 'base64');

// Build a valid case file, then tamper with it the way a crafted upload would.
function makeWorkbook(tamper) {
  const A = makeEnv(FILE, 3);
  const wb = XLSX.read(bytes(A.run(`
    (function () {
      const wb = buildCaseWorkbook('proto');
      return XLSX.write(wb, { type: 'base64', bookType: 'xlsx' });
    })()
  `)), { type: 'buffer' });
  tamper(wb);
  return wb;
}

// Helper: read a sheet back to rows, change it, write it back.
function editSheet(wb, name, fn) {
  const aoa = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: true, defval: '' });
  wb.Sheets[name] = XLSX.utils.aoa_to_sheet(fn(aoa));
}

// ---------------------------------------------------------- 1. header row: __proto__
{
  const wb = makeWorkbook((wb) => {
    editSheet(wb, 'พอร์ต', (aoa) => {
      // Row 2 is the machine-key row the importer reads. Append a hostile column.
      aoa[1] = [...aoa[1], '__proto__'];
      for (let i = 2; i < aoa.length; i++) aoa[i] = [...aoa[i], '{"polluted":true}'];
      return aoa;
    });
  });

  const e = makeEnv(FILE, 7);
  e.w.__wb = wb;
  let threw = null;
  try { e.run(`importCaseFromWorkbook(window.__wb, { skipConfirm: true })`); }
  catch (ex) { threw = ex.message; }

  // The file is otherwise valid, so the import should simply ignore the hostile column.
  check('hostile "__proto__" column does not break the import', threw === null, threw);
  check('Object.prototype untouched inside the page',
    e.run(`String(({}).polluted)`) === 'undefined', e.run(`String(({}).polluted)`));
  check('portfolios still imported normally',
    e.run(`portfolios.length`) >= 1, e.run(`portfolios.length`));
  check('no portfolio carries a "polluted" field',
    e.run(`String(portfolios.some(p => 'polluted' in p))`) === 'false');
}

// -------------------------------------------------- 2. header row: constructor/prototype
{
  const wb = makeWorkbook((wb) => {
    editSheet(wb, 'กองทุน', (aoa) => {
      aoa[1] = [...aoa[1], 'constructor', 'prototype'];
      for (let i = 2; i < aoa.length; i++) aoa[i] = [...aoa[i], 'x', 'y'];
      return aoa;
    });
  });

  const e = makeEnv(FILE, 11);
  e.w.__wb = wb;
  let threw = null;
  try { e.run(`importCaseFromWorkbook(window.__wb, { skipConfirm: true })`); }
  catch (ex) { threw = ex.message; }
  check('hostile "constructor"/"prototype" columns do not break the import', threw === null, threw);
  check('funds still imported', e.run(`portfolios[0].fundsData[1].length`) > 0);
  check('fund names unaffected', typeof e.run(`portfolios[0].fundsData[1][0].name`) === 'string');
}

// ------------------------------------------------ 3. settings sheet key: __proto__
{
  const wb = makeWorkbook((wb) => {
    editSheet(wb, 'ตั้งค่าหลัก', (aoa) => [...aoa, ['__proto__', 'hostile', '{"polluted":true}']]);
  });

  const e = makeEnv(FILE, 13);
  e.w.__wb = wb;
  let threw = null;
  try { e.run(`importCaseFromWorkbook(window.__wb, { skipConfirm: true })`); }
  catch (ex) { threw = ex.message; }
  check('hostile "__proto__" settings key does not break the import', threw === null, threw);
  check('Object.prototype untouched by the settings sheet',
    e.run(`String(({}).polluted)`) === 'undefined', e.run(`String(({}).polluted)`));
}

// --------------------------------------- 4. the guard is case-insensitive (Excel may recase)
{
  const wb = makeWorkbook((wb) => {
    editSheet(wb, 'พอร์ต', (aoa) => {
      aoa[1] = [...aoa[1], '__PROTO__'];
      for (let i = 2; i < aoa.length; i++) aoa[i] = [...aoa[i], '{"polluted":true}'];
      return aoa;
    });
  });
  const e = makeEnv(FILE, 17);
  e.w.__wb = wb;
  try { e.run(`importCaseFromWorkbook(window.__wb, { skipConfirm: true })`); } catch (ex) { /* reported below */ }
  check('uppercase "__PROTO__" is blocked too',
    e.run(`String(({}).polluted)`) === 'undefined', e.run(`String(({}).polluted)`));
}

// --------------------------------- 5. the guard is actually in place (fails before the fix)
//
// Checks 1-4 above pass on the pre-fix parser too: a spreadsheet cell is always a
// primitive, and assigning a primitive to "__proto__" is a silent no-op in JavaScript,
// so that path was never actually exploitable. These two check the mechanism itself,
// so that a future rewrite (say, Object.assign from sheet data) cannot quietly
// reintroduce the hazard.
{
  const e = makeEnv(FILE, 23);
  const proto = e.run(`
    (function () {
      const aoa = [['label'], ['portId', 'name', '__proto__'], [1, 'A', 'x']];
      const rows = caseRowsByKey(aoa, 'portId');
      return JSON.stringify({
        hasProto: Object.getPrototypeOf(rows[0]) !== null,
        keys: Object.keys(rows[0]),
      });
    })()
  `);
  const got = JSON.parse(proto);
  check('parsed rows have no prototype at all', got.hasProto === false, proto);
  check('a "__proto__" column is dropped, ordinary columns kept',
    !got.keys.includes('__proto__') && got.keys.includes('portId') && got.keys.includes('name'),
    got.keys.join(','));

  const sProto = e.run(`
    (function () {
      const o = caseKeyValues([['initInvestment', 'x', 1], ['__proto__', 'x', 'y']]);
      return JSON.stringify({ hasProto: Object.getPrototypeOf(o) !== null, keys: Object.keys(o) });
    })()
  `);
  const sGot = JSON.parse(sProto);
  check('settings object has no prototype either', sGot.hasProto === false, sProto);
  check('a "__proto__" settings key is dropped, ordinary keys kept',
    !sGot.keys.includes('__proto__') && sGot.keys.includes('initInvestment'), sGot.keys.join(','));
}

// ------------------------------------------- 6. an ordinary file still imports unchanged
{
  const wb = makeWorkbook(() => {});
  const e = makeEnv(FILE, 19);
  e.w.__wb = wb;
  const res = e.run(`importCaseFromWorkbook(window.__wb, { skipConfirm: true })`);
  check('REGRESSION: an untampered file still imports', !!res && res.portfolios >= 1, JSON.stringify(res));
  check('REGRESSION: no spurious warnings on a clean file', res && res.warnings.length === 0,
    res && res.warnings.join(' | '));
}

console.log(`PASS ${results.pass}  FAIL ${results.fail.length}`);
results.fail.forEach(f => console.log('  XX  ' + f));
process.exit(results.fail.length ? 1 : 0);
