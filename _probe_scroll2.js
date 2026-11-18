/* 校验增量复用没有造成错位 / 换版本不刷新 / 搜索不刷新 */
const { chromium } = require('playwright-core');
const EXE = 'C:/Users/Asuna/AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe';

const snap = () => [...document.querySelectorAll('#grid .vcard')]
  .map((c) => c.dataset.id + ':' + c.style.top + ':' + c.style.left);

(async () => {
  const b = await chromium.launch({ executablePath: EXE });
  const p = await b.newPage({ viewport: { width: 430, height: 900 } });
  const errs = [];
  p.on('pageerror', (e) => errs.push('pageerror: ' + e.message));

  await p.goto('http://127.0.0.1:8899/', { waitUntil: 'domcontentloaded' });
  await p.locator('#splashSkip').click({ timeout: 3000 }).catch(() => {});
  await p.waitForFunction(() => {
    const s = document.getElementById('splash');
    return !s || s.hidden || getComputedStyle(s).display === 'none';
  }, { timeout: 90000 }).catch(() => {});
  await p.click('#uclose', { timeout: 4000 }).catch(() => {});
  await p.waitForTimeout(300);
  await p.evaluate(() => localStorage.setItem('sgs.ver', 'msgs'));
  await p.reload({ waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => {
    const s = document.getElementById('splash');
    return !s || s.hidden || getComputedStyle(s).display === 'none';
  }, { timeout: 90000 }).catch(() => {});
  await p.click('#uclose', { timeout: 4000 }).catch(() => {});
  await p.click('.tabbar .tab[data-tab="heroes"]');
  await p.waitForFunction(() => document.body.dataset.tab === 'heroes', { timeout: 30000 });
  await p.waitForTimeout(1200);

  const top0 = await p.evaluate(snap);
  console.log('顶部卡片数', top0.length, '首张', top0[0]);

  // 滚下去再滚回来，位置对应的 id 必须一致
  await p.evaluate(() => window.scrollBy(0, 1400));
  await p.waitForTimeout(350);
  const mid = await p.evaluate(snap);
  await p.evaluate(() => window.scrollTo(0, 0));
  await p.waitForTimeout(350);
  const top1 = await p.evaluate(snap);
  console.log('滚回顶部一致:', JSON.stringify(top0) === JSON.stringify(top1),
    '| mid 首张', mid[0], '| 数量', mid.length);

  // 换版本：列表必须真的换掉
  await p.evaluate(() => document.querySelector('#vtabs .vtab[data-v="sgsol"]').click());
  await p.waitForTimeout(1400);
  const v2 = await p.evaluate(snap);
  console.log('切到 OL 后首张', v2[0], '| 与移动版不同:',
    JSON.stringify(v2) !== JSON.stringify(top1));

  // 搜索：结果必须刷新
  await p.fill('#q', '关羽');
  await p.waitForTimeout(900);
  const s1 = await p.evaluate(snap);
  await p.fill('#q', '曹操');
  await p.waitForTimeout(900);
  const s2 = await p.evaluate(snap);
  console.log('搜索关羽', s1.length, s1[0], '→ 曹操', s2.length, s2[0],
    '| 结果确实变了:', JSON.stringify(s1) !== JSON.stringify(s2));

  // 详情页立绘
  await p.fill('#q', '关羽');
  await p.waitForTimeout(800);
  await p.locator('#grid .vcard').first().click();
  await p.waitForSelector('#sheetBody .d-head', { timeout: 15000 });
  await p.waitForTimeout(700);
  const d = await p.evaluate(() => {
    const im = document.querySelector('#sheetBody .d-head img');
    return im ? { src: im.getAttribute('src').split('/').pop(), ok: im.complete && im.naturalWidth > 0, lazy: im.getAttribute('loading') } : null;
  });
  console.log('详情页立绘', JSON.stringify(d));
  await p.screenshot({ path: '_reports/ios_detail_guan.png' });

  console.log('ERRORS', errs.length ? errs.slice(0, 5) : 'none');
  await b.close();
})();
