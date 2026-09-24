const { chromium } = require('playwright');
const path = require('path');
const { openApp } = require('../lib/browser-env');
const { ensureOut } = require('../lib/paths');
const fails=[]; const oks=[];
const chk=(n,c,d)=>c?oks.push(n):fails.push(n+(d?' :: '+d:''));
(async()=>{
  const browser = await chromium.launch();
  const ctx = await browser.newContext({viewport:{width:1440,height:900},locale:'th-TH'});
  const page = await ctx.newPage();
  await openApp(page);
  const badge = ()=>page.evaluate(()=>{const b=document.getElementById('heatmap-status-badge');return {t:b.textContent.trim(),c:b.className};});

  let b = await badge();
  chk('initial badge = waiting/neutral', b.t.includes('รอการกด') && !b.c.includes('emerald') && !b.c.includes('red'), JSON.stringify(b));

  // main sim first (heatmap needs it? run anyway)
  await page.click('#btn-run-mc'); await page.waitForFunction(()=>hasRunOnce,null,{timeout:120000});
  await page.click('#btn-run-heatmap');
  await page.waitForFunction(()=>document.getElementById('heatmap-status-badge').textContent.includes('อัปเดต'),null,{timeout:120000});
  b = await badge();
  chk('after Run Analysis = green/updated', b.t.includes('อัปเดต') && b.c.includes('emerald'), JSON.stringify(b));

  // change a MAIN input -> markDirty -> heatmap badge must go stale
  await page.fill('#init-investment','12000000');
  await page.dispatchEvent('#init-investment','input');
  await page.waitForTimeout(300);
  b = await badge();
  chk('main input change -> heatmap stale (red)', b.t.includes('ค่าเปลี่ยนแปลง') && b.c.includes('red'), JSON.stringify(b));

  // re-run, then change a HEATMAP-ONLY input -> markHeatmapDirty
  await page.click('#btn-run-mc'); await page.waitForFunction(()=>hasRunOnce && !simResultsStale,null,{timeout:120000});
  await page.click('#btn-run-heatmap');
  await page.waitForFunction(()=>document.getElementById('heatmap-status-badge').textContent.includes('อัปเดต'),null,{timeout:120000});
  await page.fill('#heatmap-rates','3%, 4%, 5%');
  await page.dispatchEvent('#heatmap-rates','input');
  await page.waitForTimeout(300);
  b = await badge();
  chk('heatmap-only input change -> stale (red)', b.t.includes('ค่าเปลี่ยนแปลง') && b.c.includes('red'), JSON.stringify(b));

  // benchmark rate too
  await page.click('#btn-run-heatmap');
  await page.waitForFunction(()=>document.getElementById('heatmap-status-badge').textContent.includes('อัปเดต'),null,{timeout:120000});
  await page.fill('#heatmap-benchmark-rate','4');
  await page.dispatchEvent('#heatmap-benchmark-rate','input');
  await page.waitForTimeout(300);
  b = await badge();
  chk('benchmark-rate change -> stale (red)', b.t.includes('ค่าเปลี่ยนแปลง') && b.c.includes('red'), JSON.stringify(b));

  await page.locator('#heatmap-status-badge').scrollIntoViewIfNeeded();
  await page.screenshot({path: path.join(ensureOut('heatmap-badge'),'badge-stale.png')});
  await browser.close();
  console.log('PASS '+oks.length+'  FAIL '+fails.length);
  oks.forEach(o=>console.log('  OK  '+o)); fails.forEach(f=>console.log('  XX  '+f));
  process.exit(fails.length?1:0);
})().catch(e=>{console.error('FAILED',e);process.exit(1);});
