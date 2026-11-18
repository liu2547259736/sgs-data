const { chromium } = require('playwright-core');
const EXE = 'C:/Users/Asuna/AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe';
const URL = 'https://sgs-heroes-lite.app.workbuddy.host/?sharecode=U6QZAAJ74L';
(async () => {
  const b = await chromium.launch({ executablePath: EXE });
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3 });
  const p = await ctx.newPage();
  await p.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await p.locator('#splashSkip').click({ timeout: 4000 }).catch(()=>{});
  await p.waitForFunction(() => { const s=document.getElementById('splash'); return !s||s.hidden||getComputedStyle(s).display==='none'; }, {timeout:120000}).catch(()=>{});
  await p.click('#uok', { timeout: 5000 }).catch(()=>{});
  await p.click('.tabbar .tab[data-tab="heroes"]');
  await p.waitForFunction(() => document.body.dataset.tab === 'heroes', { timeout: 30000 });
  await p.waitForTimeout(3000);

  const stat = async (label) => {
    const r = await p.evaluate(() => {
      const im = [...document.querySelectorAll('#grid .vcard img')];
      const no = im.filter((i) => !(i.complete && i.naturalWidth));
      return {
        n: im.length, blank: no.length,
        sample: no.slice(0, 3).map((i) => ({ src: i.currentSrc.split('/').slice(-2).join('/'), c: i.complete, nw: i.naturalWidth })),
        cards: document.querySelectorAll('#grid .vcard').length,
        loaded: [...document.querySelectorAll('#grid .vcard.imgld')].length,
      };
    });
    console.log(label, JSON.stringify(r));
  };
  await stat('静止 3s 后');

  const t0 = Date.now();
  await p.evaluate(() => window.scrollBy(0, 900));
  await p.waitForTimeout(1500);
  await stat('滚动后 1.5s');
  await p.waitForTimeout(3000);
  await stat('滚动后 4.5s');
  // 单图加载耗时
  const perf = await p.evaluate(() => performance.getEntriesByType('resource')
    .filter((r) => /\/il\/|\.webp|\.jpg/.test(r.name))
    .map((r) => Math.round(r.duration)).slice(-12));
  console.log('近 12 张图耗时(ms)', perf.join(','));
  await b.close();
})();
