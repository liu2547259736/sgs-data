/* 验证虚拟列表滚动时卡片 / 图片 DOM 是否被复用（iOS 立绘空白修复的核心断言） */
const { chromium } = require('playwright-core');
const EXE = 'C:/Users/Asuna/AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe';

(async () => {
  const ver = process.argv[2] || 'msgs';
  const b = await chromium.launch({ executablePath: EXE });
  const p = await b.newPage({ viewport: { width: 430, height: 900 } });
  const errs = [];
  p.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
  p.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text()); });

  await p.goto('http://127.0.0.1:8899/', { waitUntil: 'domcontentloaded' });
  await p.locator('#splashSkip').click({ timeout: 3000 }).catch(() => {});
  await p.waitForFunction(() => {
    const s = document.getElementById('splash');
    return !s || s.hidden || getComputedStyle(s).display === 'none';
  }, { timeout: 90000 }).catch(() => {});
  await p.click('#uclose', { timeout: 4000 }).catch(() => {});
  await p.waitForTimeout(300);
  await p.evaluate((v) => { localStorage.setItem('sgs.ver', v); }, ver);
  await p.reload({ waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => {
    const s = document.getElementById('splash');
    return !s || s.hidden || getComputedStyle(s).display === 'none';
  }, { timeout: 90000 }).catch(() => {});
  await p.click('#uclose', { timeout: 4000 }).catch(() => {});
  await p.click('.tabbar .tab[data-tab="heroes"]');
  await p.waitForFunction(() => document.body.dataset.tab === 'heroes', { timeout: 30000 });
  await p.waitForTimeout(1200);

  // 给当前挂载的卡片打戳，滚动后看同一个戳还在不在（= DOM 被复用，没有整体重建）
  const stampBefore = await p.evaluate(() => {
    window.__stamp = 0;
    document.querySelectorAll('#grid .vcard').forEach((c) => { c.__stamp = ++window.__stamp; });
    return { n: document.querySelectorAll('#grid .vcard').length, imgs: document.querySelectorAll('#grid .vcard img').length };
  });

  // 逐格滚动（模拟手指滑动），每步都检查一次
  const steps = [];
  for (let i = 0; i < 8; i++) {
    await p.evaluate(() => window.scrollBy(0, 260));
    await p.waitForTimeout(120);
    steps.push(await p.evaluate(() => {
      const cards = [...document.querySelectorAll('#grid .vcard')];
      const imgs = [...document.querySelectorAll('#grid .vcard img')];
      return {
        cards: cards.length,
        kept: cards.filter((c) => c.__stamp).length,
        imgs: imgs.length,
        imgBlank: imgs.filter((i) => !(i.complete && i.naturalWidth)).length,
        scrolling: document.body.classList.contains('is-scrolling'),
      };
    }));
  }
  await p.waitForTimeout(400);

  const tail = await p.evaluate(() => {
    const cards = [...document.querySelectorAll('#grid .vcard')];
    const imgs = [...document.querySelectorAll('#grid .vcard img')];
    return {
      cards: cards.length,
      imgBlank: imgs.filter((i) => !(i.complete && i.naturalWidth)).length,
      noimgld: [...document.querySelectorAll('#grid .vcard img')]
        .filter((i) => i.complete && i.naturalWidth && !i.closest('.card').classList.contains('imgld')).length,
      idle: !document.body.classList.contains('is-scrolling'),
      first: cards[0] ? cards[0].dataset.id : null,
    };
  });

  console.log('初始', JSON.stringify(stampBefore));
  steps.forEach((s, i) => console.log('  step' + (i + 1), JSON.stringify(s)));
  console.log('静止', JSON.stringify(tail));
  console.log('ERRORS', errs.length ? errs.slice(0, 5) : 'none');
  await p.screenshot({ path: `_reports/ios_scroll_${ver}.png` });
  await b.close();
})();
