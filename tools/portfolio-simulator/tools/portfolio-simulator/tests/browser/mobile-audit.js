// Read-only mobile audit: measures overflow, cramped inputs, tap targets; saves screenshots.
const { chromium, devices } = require('playwright');
const fs = require('fs');
const path = require('path');
const { openApp } = require('../lib/browser-env');
const { ensureOut } = require('../lib/paths');
const OUT = ensureOut('mobile-audit');

(async () => {
  const browser = await chromium.launch();
  for (const [label, cfg] of [['android-360', { viewport: { width: 360, height: 800 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }], ['iphone-390', { ...devices['iPhone 12'] }]]) {
    const ctx = await browser.newContext({ ...cfg, locale: 'th-TH' });
    const page = await ctx.newPage();
    await openApp(page);

    const metrics = await page.evaluate(() => {
      const vw = window.innerWidth;
      const overflowing = [...document.querySelectorAll('body *')]
        .filter(el => { const r = el.getBoundingClientRect(); return r.width > 0 && (r.right > vw + 1 || r.left < -1) && getComputedStyle(el).position !== 'fixed'; })
        .filter(el => !el.closest('.overflow-x-auto') && !el.closest('#pdf-modal') && !el.closest('#case-modal') && !el.closest('#ai-modal'))
        .slice(0, 12)
        .map(el => `${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}.${(el.className || '').toString().split(' ').slice(0, 2).join('.')} w=${Math.round(el.getBoundingClientRect().width)}`);
      const small = [...document.querySelectorAll('button, input, select')]
        .map(el => ({ el, r: el.getBoundingClientRect() }))
        .filter(o => o.r.width > 0 && (o.r.height < 32 || o.r.width < 32))
        .map(o => `${o.el.tagName.toLowerCase()}${o.el.id ? '#' + o.el.id : ''} ${Math.round(o.r.width)}x${Math.round(o.r.height)}`);
      const fundInputs = [...document.querySelectorAll('#fund-rows input')].map(i => Math.round(i.getBoundingClientRect().width));
      const tbl = document.querySelector('#fund-rows').closest('table');
      return {
        vw, docScrollWidth: document.documentElement.scrollWidth,
        horizontalPageScroll: document.documentElement.scrollWidth > vw + 1,
        overflowing, smallTargets: [...new Set(small)].slice(0, 14), smallCount: small.length,
        fundInputWidths: fundInputs.slice(0, 6), fundTableWidth: Math.round(tbl.getBoundingClientRect().width),
        fundTableScrollable: tbl.parentElement.scrollWidth > tbl.parentElement.clientWidth,
        headerButtonsRow: Math.round(document.getElementById('btn-export-excel').getBoundingClientRect().width),
        statsTableScroll: (() => { const t = document.getElementById('phase-metrics-body').closest('div'); return t.scrollWidth > t.clientWidth; })(),
        heatmapScroll: (() => { const t = document.getElementById('heatmap-body').closest('div'); return t.scrollWidth > t.clientWidth; })(),
        chartHeight: Math.round(document.getElementById('portfolioChart').getBoundingClientRect().height)
      };
    });
    console.log('==== ' + label + ' ====');
    console.log(JSON.stringify(metrics, null, 1));

    // screenshots of key areas
    await page.screenshot({ path: `${OUT}/${label}-01-top.png` });
    await page.locator('#panel-glidepath').scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${OUT}/${label}-02-funds.png` });
    await page.click('#btn-run-mc');
    await page.waitForFunction(() => hasRunOnce, null, { timeout: 60000 });
    await page.locator('#section-mc').scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${OUT}/${label}-03-chart.png` });
    await page.click('#btn-export-pdf');
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${OUT}/${label}-04-pdfmodal.png` });
    await ctx.close();
  }
  await browser.close();
})().catch(e => { console.error('FAILED', e); process.exit(1); });
