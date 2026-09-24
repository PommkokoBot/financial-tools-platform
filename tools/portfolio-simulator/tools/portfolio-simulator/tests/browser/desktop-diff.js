// Desktop geometry diff: baseline build vs app under test at 1440x900.
// Compares the box of every element with an id; any difference is a desktop
// regression from a change that was supposed to be mobile-only.
const { chromium } = require('playwright');
const { openApp } = require('../lib/browser-env');
const { APP, BASELINE, ensureOut, requireFile } = require('../lib/paths');
const OUT = ensureOut('desktop-diff');
(async () => {
  const browser = await chromium.launch();
  const res = {};
  for (const [label, file] of [['old', requireFile(BASELINE, 'baseline build')], ['new', requireFile(APP, 'app under test')]]) {
    const ctx = await browser.newContext({ viewport:{width:1440,height:900}, deviceScaleFactor:1, locale:'th-TH' });
    const page = await ctx.newPage();
    await openApp(page, file);
    // geometry fingerprint of every laid-out element with an id
    res[label] = await page.evaluate(()=>{
      const out = {};
      document.querySelectorAll('[id]').forEach(el=>{
        const r = el.getBoundingClientRect();
        if (r.width||r.height) out[el.id] = [Math.round(r.x),Math.round(r.y),Math.round(r.width),Math.round(r.height)];
      });
      return { docW: document.documentElement.scrollWidth, docH: document.documentElement.scrollHeight, geo: out };
    });
    await page.screenshot({ path:`${OUT}/${label}-desktop.png`, fullPage:false });
    await page.locator('#panel-glidepath').scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);
    await page.screenshot({ path:`${OUT}/${label}-desktop-funds.png` });
    await ctx.close();
  }
  await browser.close();
  const o=res.old, n=res.new;
  console.log('docW old/new:', o.docW, n.docW, '| docH old/new:', o.docH, n.docH);
  const ids = new Set([...Object.keys(o.geo), ...Object.keys(n.geo)]);
  const diffs=[];
  for (const id of ids) {
    const a=o.geo[id], b=n.geo[id];
    if (!a) { diffs.push(`+ only new: #${id} ${b.join(',')}`); continue; }
    if (!b) { diffs.push(`- only old: #${id} ${a.join(',')}`); continue; }
    if (a.join()!==b.join()) diffs.push(`~ #${id} old[${a.join(',')}] new[${b.join(',')}]`);
  }
  console.log('elements compared:', ids.size, '| diffs:', diffs.length);
  diffs.slice(0,60).forEach(d=>console.log('   '+d));
})().catch(e=>{console.error('FAILED',e);process.exit(1);});
