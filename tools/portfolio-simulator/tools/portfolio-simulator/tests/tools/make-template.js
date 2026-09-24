// Builds the blank case template with the app's OWN exporter (so the format can't drift),
// adds a human-readable instructions sheet + column widths, then proves it re-imports.
const XLSX = require('xlsx');
const fs = require('fs');
const { makeEnv } = require('../lib/harness');
const { APP, ensureOut, requireFile } = require('../lib/paths');
const pathMod = require('path');
const FILE = requireFile(APP, 'app under test');
const OUT = process.argv[2] || pathMod.join(ensureOut(), 'PortfolioCase_Template.xlsx');

const A = makeEnv(FILE, 1);
// Default state = new default fund set with blank Expected fields (exactly what a fresh page has)
const wb = A.run(`buildCaseWorkbook('แม่แบบเคส (Template)')`);

// ---- instructions sheet (ignored by the importer, purely for the person filling it in) ----
const help = [
  ['วิธีใช้ไฟล์แม่แบบนี้ — Institutional Portfolio Simulator (Money Director)'],
  [],
  ['1', 'กรอก/แก้ค่าในชีต "ตั้งค่าหลัก", "พอร์ต", "กองทุน" แล้วบันทึกไฟล์'],
  ['2', 'เปิดเว็บเครื่องมือ → กดปุ่ม "เปิดเคส" → เลือกไฟล์นี้ → ยืนยัน'],
  ['3', 'กด "ประมวลผลกราฟ (Run Simulation)" เพื่อดูผล'],
  [],
  ['กติกาสำคัญ'],
  ['•', 'ห้ามลบชีต "_meta", "ตั้งค่าหลัก", "พอร์ต", "กองทุน" และห้ามลบแถวที่เป็น "คีย์"'],
  ['', 'ในชีตพอร์ต/กองทุน แถวที่ 1 เป็นชื่อภาษาไทย (แก้ได้) แถวที่ 2 เป็นคีย์ (ห้ามแก้) ข้อมูลเริ่มแถวที่ 3'],
  ['•', 'สลับลำดับคอลัมน์ หรือแทรกแถวชื่อเรื่องด้านบนได้ ระบบอ่านจากแถวคีย์'],
  ['•', 'เพิ่มพอร์ตได้สูงสุด 3 พอร์ต (เพิ่มแถวในชีต "พอร์ต" และตั้ง "รหัสพอร์ต" ไม่ซ้ำกัน)'],
  ['•', 'เพิ่ม/ลบกองทุนได้ตามต้องการ (1 แถว = 1 กองทุนใน 1 เฟส) โดยอ้าง "รหัสพอร์ต" และ "เฟส" (1–4) ให้ถูก'],
  ['•', 'ช่อง Yield / Growth / S.D. เว้นว่างได้ (ระบบจะนับเป็น 0% จนกว่าจะกรอก) แต่ "ชื่อกองทุน" ต้องมีเสมอ'],
  ['•', 'เฟส 3 จะเปิดได้ต่อเมื่อเปิดเฟส 2 และเฟส 4 ต้องเปิดเฟส 3 ก่อน (ถ้าผิดลำดับ ระบบจะปรับให้และแจ้งเตือน)'],
  ['•', 'น้ำหนักกองทุนในแต่ละเฟสควรรวม 100% และสัดส่วนพอร์ตรวมควรเป็น 100% (ถ้าไม่ครบจะเตือน แต่ยังเปิดได้)'],
  ['•', 'ชีต "ผลจำลอง 30 ปี" เป็นผลลัพธ์อย่างเดียว ระบบไม่อ่านกลับ — เปิดเคสแล้วต้องกด Run ใหม่'],
  [],
  ['ค่าที่ต้องพิมพ์ให้ตรงรูปแบบ (ชีต "ตั้งค่าหลัก")'],
  ['wdMode', 'yield_only = ถอนเฉพาะ Yield | constant = ถอนคงที่สู้เงินเฟ้อ | fixed_baht = ระบุยอดบาท/งวด'],
  ['chartSimMethod / heatmapSimMethod', 'traditional | gbm | volcluster'],
  ['heatmapWithdrawalMode', 'immediate = Stress ทันทีเดือนที่ 1 | planned = ตามวันเริ่มถอนจริง'],
  ['globalRebalanceFreq', 'จำนวนเดือนต่อรอบ Rebalance เช่น 12 = ทุก 1 ปี, 0 = ปล่อยไหล (ใช้ได้เฉพาะ 0,1,3,6,12,24,36)'],
  ['priorityOrder', 'ลำดับขายเงินต้นเมื่อ Yield ไม่พอ เช่น 1,2 หมายถึงขายพอร์ตรหัส 1 ก่อน แล้วค่อยพอร์ต 2'],
  ['optConservativeMinReturn / optAggressiveMaxRisk', 'เว้นว่าง = ไม่ระบุเงื่อนไข'],
  [],
  ['หมายเหตุ', 'ไฟล์นี้ทำงานในเครื่องของคุณทั้งหมด เว็บไม่มีเซิร์ฟเวอร์เก็บข้อมูล จึงไม่มีการส่งข้อมูลออกไปที่ใด'],
];
const wsHelp = XLSX.utils.aoa_to_sheet(help);
wsHelp['!cols'] = [{ wch: 34 }, { wch: 104 }];
XLSX.utils.book_append_sheet(wb, wsHelp, 'วิธีใช้');
// put the instructions first so it is what opens
wb.SheetNames = ['วิธีใช้', ...wb.SheetNames.filter(n => n !== 'วิธีใช้')];

// readable column widths
const widths = {
  '_meta': [{ wch: 18 }, { wch: 72 }],
  'ตั้งค่าหลัก': [{ wch: 26 }, { wch: 58 }, { wch: 26 }],
  'พอร์ต': [{ wch: 10 }, { wch: 30 }, ...Array(16).fill({ wch: 15 })],
  'กองทุน': [{ wch: 10 }, { wch: 7 }, { wch: 26 }, { wch: 12 }, { wch: 11 }, { wch: 11 }, { wch: 11 }],
  'ผลจำลอง 30 ปี': [{ wch: 12 }, ...Array(6).fill({ wch: 24 })]
};
Object.keys(widths).forEach(n => { if (wb.Sheets[n]) wb.Sheets[n]['!cols'] = widths[n]; });

XLSX.writeFile(wb, OUT);
console.log('written:', OUT, fs.statSync(OUT).size, 'bytes');
console.log('sheets:', wb.SheetNames.join(' | '));

// ---- prove the template imports cleanly ----
const back = XLSX.read(fs.readFileSync(OUT), { type: 'buffer' });
const B = makeEnv(FILE, 2);
B.w.__wb = back;
const res = B.run(`importCaseFromWorkbook(window.__wb, { skipConfirm: true })`);
console.log('import ok:', JSON.stringify({ portfolios: res.portfolios, funds: res.funds, warnings: res.warnings }));
console.log('funds phase1 of port1:', B.run(`JSON.stringify(portfolios[0].fundsData[1].map(f => [f.name, f.weight, f.yield]))`));
console.log('blank Expected preserved:', B.run(`portfolios[0].fundsData[1][0].yield === '' ? 'yes' : 'NO'`));
