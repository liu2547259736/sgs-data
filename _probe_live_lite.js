/* 线上轻量版冒烟：数据可解密、列表/详情可开、更新说明精简、无 4xx/5xx */
const { chromium } = require('playwright-core');
const EXE = 'C:/Users/Asuna/AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe';
const URL = 'https://sgs-heroes-lite.app.workbuddy.host/?sharecode=U6QZAAJ74L';

(async () => {
  const b = await chromium.launch({ executablePath: EXE });
  const ctx = await b.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 3,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  });
  const p = await ctx.newPage();
  const errs = [], bad = [];
  p.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
  p.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
  p.on('response', (r) => { if (r.status() >= 400) bad.push(r.status() + ' ' + r.url().slice(-60)); });

  await p.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await p.locator('#splashSkip').click({ timeout: 4000 }).catch(() => {});
  await p.waitForFunction(() => {
    const s = document.getElementById('splash');
    return !s || s.hidden || getComputedStyle(s).display === 'none';
  }, { timeout: 120000 }).catch(() => {});
  await p.click('#uok', { timeout: 5000 }).catch(() => {});
  await p.waitForTimeout(600);

  const ver = await p.evaluate(() => window.__SGS_APP_V);
  const lib = await p.evaluate(() => {
    const els = [...document.querySelectorAll('.vtab')];
    return els.map((e) => e.textContent.trim()).slice(0, 10);
  });
  console.log('版本', ver, '| 版本条', lib.join(','));

  await p.click('.tabbar .tab[data-tab="heroes"]');
  await p.waitForFunction(() => document.body.dataset.tab === 'heroes', { timeout: 30000 });
  await p.waitForTimeout(1800);

  const grid = await p.evaluate(() => {
    const cs = [...document.querySelectorAll('#grid .vcard')];
    const im = [...document.querySelectorAll('#grid .vcard img')];
    return { cards: cs.length, imgs: im.length, blank: im.filter((i) => !(i.complete && i.naturalWidth)).length };
  });
  console.log('列表', JSON.stringify(grid));

  // 滚动
  const steps = [];
  for (let i = 0; i < 5; i++) {
    await p.evaluate(() => window.scrollBy(0, 300));
    await p.waitForTimeout(140);
    steps.push(await p.evaluate(() => {
      const im = [...document.querySelectorAll('#grid .vcard img')];
      return { n: im.length, blank: im.filter((i) => !(i.complete && i.naturalWidth)).length };
    }));
  }
  console.log('滚动', steps.map((s) => JSON.stringify(s)).join(' '));

  // 详情
  await p.locator('#grid .vcard').first().click();
  await p.waitForSelector('#sheetBody .d-head', { timeout: 20000 });
  await p.waitForTimeout(700);
  const d = await p.evaluate(() => {
    const im = document.querySelector('#sheetBody .d-head img');
    const t = document.querySelector('#sheetBody').innerText;
    return { art: im ? (im.complete && im.naturalWidth > 0) : null, head: t.split('\n').filter(Boolean).slice(0, 6) };
  });
  console.log('详情', JSON.stringify(d));
  await p.screenshot({ path: '_reports/live_lite_detail.png' });
  await p.evaluate(() => { const s = document.getElementById('sheet'); if (s) { s.hidden = true; } });
  await p.waitForTimeout(300);
  await p.screenshot({ path: '_reports/live_lite_grid.png' });

  console.log('ERRORS', errs.length ? errs.slice(0, 5) : 'none');
  console.log('BAD RESP', bad.length ? bad.slice(0, 5) : 'none');
  await b.close();
})();
