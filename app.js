/* 三国杀武将速查 —— 新国风三段式 TabBar 版
 *
 * 结构：首页（每日武将/快捷入口/功能宫格） | 英雄速查（多版本） | 我的（收藏/攻略/设置）
 * 复用既有英雄页逻辑（搜索/筛选/版本切换/详情/语音），新增：
 *   1. Tab 路由（body[data-tab]）
 *   2. 每日武将：按日期从当前版本武将池确定性选取
 *   3. 收藏：localStorage，跨版本记录 {v,id}，详情底部操作栏写入
 *   4. 主题：日间宣纸 / 夜间水墨（html[data-theme]）
 */
(function () {
  'use strict';

  /* ============ 常量与路径 ============ */
  const DEFAULT_VERSION = 'sgsol';
  const VERSION_KEY = 'sgs.ver';
  const THEME_KEY = 'sgs.theme';
  const FAV_KEY = 'sgs.favs';
  const FILTERS_OPEN_KEY = 'sgs.filtersOpen';
  const NAME_KEY = 'sgs.name';
  const HIST_KEY = 'sgs.hist';
  /* 历史 / 收藏的本地保留上限。原先是硬编码 60（2026-10-17 用户报障「历史查阅一直是 60」）：
     写盘前 slice(0,60) 导致计数涨到 60 就停住，收藏超 60 位时云同步还会静默截断。
     2000 条约 180KB，远低于 localStorage 单域 5MB，正常使用到不了顶。 */
  const HIST_MAX = 2000;
  const FAV_MAX = 2000;
  const WIFI_KEY = 'sgs.wifiOnly';
  const SEC_OPEN_KEY = 'sgs.secOpen';
  const USER_KEY = 'sgs.user';      // 登录会话镜像（权威来源：sgs_current_session）
  const DATA_DIR = 'data/';
  /* 资产版本串：由 index.html 注入（v2/bump_asset_version.py 维护）。
     平台 CDN 的边缘缓存会按内容编码分层，不带版本串的 URL 可能长时间拿到旧文件
     （实测：发新版后 Chrome 协商 br 拿到的仍是上一次发布的 app.js），故数据 JSON 一并挂上。
     图片默认不带版本串 —— 文件名与武将 id 绑定，避免整库重新下载。
     但「换过图」的版本要在这里登记内容版本 iv，否则旧缓存 / 旧的坏响应会一直命中：
     踩坑（2026-09-25）：构建正逐张覆盖 webp 时页面恰好请求某张图，读到「半写文件」→
     onerror → 卡片被换成首字占位，且这个状态会一直留在那张卡上。换图后记得 bump。 */
  const ASSET_V = String(window.__SGS_ASSET_V || '');
  const vq = (u) => (ASSET_V ? u + (u.indexOf('?') < 0 ? '?' : '&') + 'v=' + ASSET_V : u);
  const INDEX_URL = vq(DATA_DIR + 'index.json');
  const SEARCH_URL = vq(DATA_DIR + 'search_index.json');  // 跨版本搜索索引（v2/gen_search_index.py 生成）
  /* 「最新更新」数据：v2/gen_recent.py 从 changelog.json 的「新增武将」记录生成，
     只含最近 10 位（跨版本）的卡片字段。缺文件时整条筛选行自动隐藏，不影响其它功能。 */
  const RECENT_URL = vq(DATA_DIR + 'recent.json');
  const dataUrl = (version) => vq(`${DATA_DIR}${version}/characters.json`);
  const IMG_V = { hlsgs: '6', sgs: '3', gjf: '1', sgsol: '2', msgs: '2', wxmini: '1' };
  // msgs 1 / wxmini 1：2026-10-15 图片瘦身，sk/il/av 由 jpg/png 统一转 webp（msgs 皮肤、
  // 小程序立绘/头像/皮肤），URL 后缀变了但同源目录可能仍命中旧缓存，故登记破缓存。
  // 换图后 +1。gjf 1：2026-10-14 22:30 修正IF篇·霸王问鼎 4 张立绘
  //（幻孙策/幻大乔/幻周瑜/幻小乔），旧图被浏览器强缓存，必须靠iv 破缓存。
  // sgsol 2：2026-10-24 皮肤按「v 同源链并集」全量补齐（2784→4479 条，新增 1696 张），
  //           `_ol{n}` 编号大量新增，必须 +1 破缓存。
  // sgsol 1：2026-10-14 22:47 修正 au 串号 4 张原画（标关羽/标华雄/风曹仁/林董卓）
  // sgs 3：2026-10-24 皮肤按官方 RelationGeneralID 全量补齐（3374→4153 条，新增 780 张），
  //         并修掉孙尚香那张 0 字节空壳（后续编号已前移，必须 +1 破缓存）。
  // sgs 2：2026-10-23 23:5x 谋杨奉 il/av/sk 由官方剪影换成秋华活动页正式立绘，
  //         必须 +1 让所有客户端丢掉旧的剪影缓存。
  const imgV = (u, version) => (u && IMG_V[version]
    ? u + (u.indexOf('?') < 0 ? '?' : '&') + 'iv=' + IMG_V[version] : u);
  const rawAsset = (version, kind, name) => `images/${version}/${kind}/${name}.webp`;
  const assetPath = (version, kind, name) => imgV(rawAsset(version, kind, name), version);

  /* ============ 宿主桥（Android 壳 2.0 · 纯本地版）============
     壳通过 addJavascriptInterface 注入 window.SGSHost（见 android-apk MainActivity）：
       · isOffline()     -> "1" / "0"   资源是否全部内置（离线可用）
       · isSystemDark()  -> "1" / "0"   系统当前是否深色（壳是权威来源，不依赖 WebView 的媒体查询）
       · setTheme(t)                    把当前实际主题回报给壳 → 壳染系统栏底色 + 切换状态栏/导航栏图标明暗
     纯浏览器打开时 SGSHost 不存在，下面一律降级为空操作。 */
  const HOST = (function () {
    try {
      if (window.SGSHost && typeof window.SGSHost.setTheme === 'function') return window.SGSHost;
    } catch (e) { /* 老 WebView 访问未注入的接口会抛错，忽略 */ }
    return null;
  })();
  const IS_APP = !!HOST;
  const hostCall = (fn, def) => {
    if (!HOST) return def;
    try { const r = HOST[fn](); return (r === null || r === undefined) ? def : String(r); }
    catch (e) { return def; }
  };
  /* 桥的返回值一律当字符串看，但别只认 "1" —— 原生若返回 boolean（String(true) === "true"），
     只比对 "1" 会静默失效（这个坑在自测里真踩到过）。 */
  const isTrue = (v) => v === '1' || v === 'true' || v === 'yes';
  const IS_OFFLINE = IS_APP && isTrue(hostCall('isOffline', '0'));

  /* 壳把系统栏高度（CSS px）告知网页 —— env(safe-area-inset-*) 在部分 WebView / 老系统上取不到值时兜底。
     用 --sb-top/--sb-bottom 取「env() 与壳上报值」的较大者，两侧都不会漏安全区。 */
  window.__sgsSetInsets = function (top, bottom) {
    const r = document.documentElement;
    r.style.setProperty('--host-inset-top', (Number(top) || 0) + 'px');
    r.style.setProperty('--host-inset-bottom', (Number(bottom) || 0) + 'px');
  };
  /* 壳在系统深/浅色切换后回调（manifest 声明了 configChanges=uiMode，Activity 不重建，
     需要显式通知网页重新取色）。 */
  window.__sgsSysTheme = function () { if (themeMode() === 'auto') applyTheme('auto'); };

  /* ============ 词表 ============ */
  const KINGDOMS = [
    { k: 'all', label: '全部' },
    { k: 'wei', label: '魏' }, { k: 'shu', label: '蜀' }, { k: 'wu', label: '吴' },
    { k: 'qun', label: '群' }, { k: 'jin', label: '晋' }, { k: 'god', label: '神' },
    /* 性别筛选（2026-10-17 用户要求）：挂在势力行末尾，**不配势力色**（渲染时不出圆点）。
       数据来源 characters.json 的 g='male'|'female'，搜索索引里压成 'm'|'f'。 */
    { k: 'male', label: '男' }, { k: 'female', label: '女' }
  ];
  const SEX_KEYS = { male: 1, female: 1 };
  /* 势力/性别统一判定：characters 用 male/female，索引压成 m/f，两边都要认 */
  function isFemale(it) { return it.g === 'female' || it.g === 'f'; }
  function kingMatch(it, k) {
    if (k === 'all') return true;
    if (SEX_KEYS[k]) return k === 'female' ? isFemale(it) : !isFemale(it);
    return it.k === k;
  }
  /* 势力配色（2026-10-14 用户按官方卡面定，色值直接从参考图取样）：
     魏 #3d599b / 蜀 #ad362d / 吴 #42752b / 群 #88857e / 晋 #6d4f9d / 神 #a4803b（神为用户指定）。
     卡面势力条、占位立绘、筛选项圆点、详情页势力字都吃这套值，改一处即全局一致。 */
  const KC = { wei: '#3d599b', shu: '#ad362d', wu: '#42752b', qun: '#88857e', jin: '#6d4f9d', god: '#a4803b' };
  const KN = { wei: '魏', shu: '蜀', wu: '吴', qun: '群', jin: '晋', god: '神' };
  const ROLES = ['菜刀', '强命', '多刀', '过牌', '卖血', '辅助', '控场', '直伤', '防御', '爆发'];
  const LEVEL_ORDER = ['B', 'A', '普通', '稀有', '精良', '精品', '史诗', '传说', '限定', '神话', 'S', 'SS', 'SSS', '神'];
  const KIND = {
    lock: ['锁定技', 'k-lock'], limited: ['限定技', 'k-limited'], awakening: ['觉醒技', 'k-awakening'],
    transform: ['转换技', 'k-transform'], active: ['主动技', 'k-active'], passive: ['触发技', 'k-passive']
  };
  /* 版本简称：与 data/index.json 的 short 保持一致（同一版本不能两套名字 ——
     「移动版」在 index.json 里叫移动版，这里原先写「手杀」，导致计数栏与卡片角标各叫各的）。 */
  /* unreleased = 第 5 个版本「未实装」（OL/移动版/十周年 官方配置里尚未上线的条目）：
     数据独立成篇、不并入任何正式版，也刻意不进跨版本搜索索引（搜索四版时不搜它）。 */
  const VN = { sgsol: 'OL', msgs: '移动版', sgs: '十周年', hlsgs: '欢乐杀', gjf: '国际服', wxmini: '小程序', unreleased: '未实装' };
  const UNRELEASED_ID = 'unreleased';

  /* ============ 状态 ============ */
  let INDEX = [];
  /* 轻量版（子体）配置：由 data/index.json 顶层的 lite 字段提供。
     本体（全量版）的 index.json 没有这个字段 → LITE 恒为 null，下面所有分支都不生效，
     行为与加入这段代码之前逐字一致。
     lite 形如：{ hide: ['olnews','x10news','history','cards','battle','fk'] }
       olnews/x10news → 首页轮播不再显示资讯屏
       history        → 首页「三国史料学习」入口
       cards          → 「游戏牌种类」入口
       battle / fk    → 「轻量对战」「新月杀」入口
     皮肤图（各库 sk 目录）不随子体分发时，装配期会把每条武将的 sk 置空、保留 skn 的名称，
     详情页自动降级成「只有皮肤名、没有图」的列表。 */
  let LITE = null;
  let V = { id: DEFAULT_VERSION, short: 'OL', label: '三国杀OL', source: '' };
  let G = [], GLIST = [], PACKS = [], LEVELS = [], __NW_SET = null;
  /* newOnly：「最新更新」视图（2026-11-10）。**按当前服务器（库）**取最近入库的 10 位武将，
     它是势力行里「全部」之后的第一项（层级排在魏之前），与势力/包/品质互斥 —— 见 filtered()。 */
  const state = { kingdom: 'all', pack: null, sub: null, role: null, level: null, fut: false, q: '', scope: 'all', newOnly: false };
  /* 搜索范围：'all' = 四版一起搜（默认），否则只搜指定版本（复用顶部版本 tab 表达）。
     同名跨版折叠：默认只出一张代表卡，其余版本折成「另有 N 版」，GRP_OPEN 记录已点开的名字。 */
  const GRP_OPEN = new Set();
  let SS = null;             // 上一次搜索的统计 {raw, byVer, weak}，供计数栏说明用
  let daily = null;          // {v,id,n,t}
  let currentDetail = null;  // 当前详情 {v,id}
  let sheetTab = null;       // 详情页「归属 Tab」：在这个 Tab 里点开的武将；离开它先挂起、回来原样恢复
  let sheetScroll = 0;       // 挂起前的滚动位置，恢复时还原
  const $ = (id) => document.getElementById(id);

  /* ============ 工具 ============ */
  function fetchJSON(url) {
    return fetch(url, { cache: 'no-cache' }).then((r) => {
      if (!r.ok) throw new Error(`HTTP ${r.status} ${url}`);
      return r.json();
    });
  }
  function setStatus(text) {
    const el = $('status');
    if (!text) { el.hidden = true; return; }
    $('statusText').textContent = text;
    el.hidden = false;
  }
  let toastTimer = null;
  function toast(text) {
    const el = $('toast');
    el.textContent = text;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, 1900);
  }
  function safeGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function safeSet(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* 忽略 */ } }

  /* ============ 本地账号服务接入（services/localAuth.js） ============
   * 账号数据隔离：登录后收藏/历史/心得落到 "<键>@<userId>" 命名空间，
   * 游客态用原键，切换账号时仅需换作用域即可，互不串号。 */
  const LAS = () => window.LocalAuthService;                 // 服务实例（可能未加载）
  const sk = (base) => (LAS() ? LAS().scopeKey(base) : base); // 作用域键名解析

  /* ============ 触觉反馈（支持的设备静默震动，up/003 二.1） ============ */
  function tapFeel(ms) { try { if (navigator.vibrate) navigator.vibrate(ms); } catch (e) { /* 忽略 */ } }

  /* ============ 手势监听 Hook（up/003 四.1）
   * 封装 TouchStart/Move/End 判定拖拽位移：内置轴锁定（先滑出 lockPx 即锁定 x/y 轴），
   * onMove 里可按 axis 与业务条件 preventDefault；onEnd 返回位移/时长/是否快扫。
   * 返回解绑函数。对应 React 生态 useGesture Hook 的原生实现。 ============ */
  function onGesture(el, { onMove, onEnd, lockPx = 12 } = {}) {
    let sx = 0, sy = 0, st = 0, axis = null, id = null;
    const find = (e) => [...e.changedTouches].find((x) => x.identifier === id);
    function ts(e) {
      if (id !== null) return;
      const t = e.changedTouches[0];
      sx = t.clientX; sy = t.clientY; st = Date.now(); axis = null; id = t.identifier;
    }
    function tm(e) {
      if (id === null) return;
      const t = find(e);
      if (!t) return;
      const dx = t.clientX - sx, dy = t.clientY - sy;
      if (!axis) {
        if (Math.abs(dx) < lockPx && Math.abs(dy) < lockPx) return;
        axis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
      }
      if (onMove) onMove({ dx, dy, axis, ev: e });
    }
    function te(e) {
      if (id === null) return;
      const t = find(e);
      if (!t) return;
      const dx = t.clientX - sx, dy = t.clientY - sy, dt = Date.now() - st;
      const ax = axis; axis = null; id = null;
      if (onEnd) onEnd({ dx, dy, dt, axis: ax, fast: dt < 240 });
    }
    el.addEventListener('touchstart', ts, { passive: true });
    el.addEventListener('touchmove', tm, { passive: false });
    el.addEventListener('touchend', te, { passive: true });
    el.addEventListener('touchcancel', te, { passive: true });
    return () => {
      el.removeEventListener('touchstart', ts);
      el.removeEventListener('touchmove', tm);
      el.removeEventListener('touchend', te);
      el.removeEventListener('touchcancel', te);
    };
  }

  /* ============ 拼音工具：从武将 id 尾段取全拼（yj_caozhi→caozhi / SPguanyu→guanyu） ============ */
  function pyTail(id) {
    // 同名武将第二版 id 形如 sgs_zhangyi_2，需先剥掉尾部数字段，否则索引条会多出一个 "2" 组排最前
    const segs = String(id).replace(/_\d+$/, '').split('_');
    let tail = (segs.pop() || '').replace(/^sp/i, '').toLowerCase();
    if ((!tail || !/^[a-z]/.test(tail)) && segs.length) tail = segs.pop() || tail;  // 兜底：尾段为空/非字母则回退上一段
    return tail;
  }
  function isSubseq(q, s) {  // 缩写子序列匹配：'yx' ⊂ 'yangxiu'
    let i = 0;
    for (let j = 0; j < s.length && i < q.length; j++) if (s[j] === q[i]) i++;
    return i === q.length;
  }

  /* ============ 虚拟列表状态（vgrid：仅视口内卡片挂 DOM，up/003 一.1） ============ */
  const VG = { gap: 11, cols: 3, colW: 0, rowH: 0, pt: 0, pb: 0, items: [], raf: 0, lastKey: '' };
  let PYINI = new Map();  // id → 首字母（大写）
  let AZ = [];            // 数据中出现的首字母（有序）
  let HAS_ORD = false;    // 数据是否带游戏内序号 ord（带 = 按游戏顺序排 + 右侧条走分组跳转）
  let pyTipT = null, favBT = null;
  let SIDX = null, SIDX_P = null;  // 跨版本搜索索引（懒加载，gzip 约 78KB）
  /* 「最新更新」：RECENT 是按库分组的条目表 { sgsol:[…], msgs:[…], … }，每库最多 10 位。
     加载一次即常驻；失败留在 null，那一行筛选不出现，下次进英雄页再试。 */
  let RECENT = null, RECENT_META = null, RECENT_P = null;

  /* 条目所属版本：搜索索引条目带 v，浏览态完整数据没有 → 回落到当前版本 */
  const itemVer = (g) => g._v || g.v || V.id;

  /* 立绘 / 头像 URL。**数据里写了 img/av 字段时优先用它**：
     同一张图被别的库复用时（国际服 535 位复用现有四库立绘，文件仍在源库目录下），
     按「同版目录 + 同 id」的约定拼会得到 images/gjf/il/gjf_xxx.webp → 404。
     没写字段才按约定拼（四版内置数据都符合该约定，行为不变）。 */
  const picUrl = (rec, ver, id, kind, field) => {
    const v = ver || itemVer(rec);
    const i = id || (rec && rec.id);
    return (rec && rec[field]) ? imgV(rec[field], v) : assetPath(v, kind, i);
  };
  const recIl = (rec, ver, id) => picUrl(rec, ver, id, 'il', 'img');
  const recAv = (rec, ver, id) => picUrl(rec, ver, id, 'av', 'av');

  /* ============ 跨版本详情数据（点开他版武将时按需拉取并缓存） ============
     搜索结果点卡不再切换版本 Tab，而是直接把那位武将的详情读出来，
     所以这里单独存一份「版本 → generals」，与当前浏览版本 G 互不干扰。 */
  const VER_DATA = {};       // 版本 → generals（只缓存被点开过的版本）
  function generalsOf(v) { return v === V.id ? G : (VER_DATA[v] || null); }
  async function ensureVersionData(v) {
    if (v === V.id) return G;
    if (VER_DATA[v]) return VER_DATA[v];
    const r = await fetch(vq(dataUrl(v)));
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const gs = ((await r.json()).generals) || [];
    gs.forEach((g) => { g._v = v; });   // 标记来源版本：立绘 / 头像 / 包圆标按它取
    VER_DATA[v] = gs;
    return gs;
  }
  /* 当前详情条目：跟随 currentDetail.v，不再假定它属于当前浏览版本 */
  function detailHero() {
    if (!currentDetail) return null;
    const gs = generalsOf(currentDetail.v);
    return gs ? (gs.find((x) => x.id === currentDetail.id) || null) : null;
  }

  /* ============ 弱网判断（仅 Wi-Fi 加载高清资源用） ============ */
  function netWeak() {
    if (safeGet(WIFI_KEY) !== '1') return false;
    const c = navigator.connection || {};
    if (c.saveData) return true;
    const t = String(c.effectiveType || '').toLowerCase();
    return t.includes('2g') || t.includes('3g');
  }
  /* ============ 历史查阅（按账号隔离：sk(HIST_KEY)） ============ */
  function history() {
    try { return JSON.parse(safeGet(sk(HIST_KEY)) || '[]'); } catch (e) { return []; }
  }
  function pushHistory(g, v) {
    if (!g) return;
    const ver = v || V.id;
    let list = history().filter((h) => !(h.v === ver && h.id === g.id));
    list.unshift({ v: ver, id: g.id, n: g.n, t: g.t || '' });
    safeSet(sk(HIST_KEY), JSON.stringify(list.slice(0, HIST_MAX)));
  }

  /* ============ 轻量版（子体）功能裁剪 ============
     只在 data/index.json 顶层带 lite 字段时执行；本体（全量版）不带这个字段，
     applyLiteProfile 一次都不会被调用，界面与裁剪前逐字一致。
     判据统一用 index.json 的 lite.hide 列表，避免前端散落一堆版本判断。 */
  function applyLiteProfile(cfg) {
    const hide = new Set(cfg.hide || []);
    const $id = (x) => document.getElementById(x);

    if (hide.has('cards') && $id('modCards')) $id('modCards').hidden = true;
    if (hide.has('history') && $id('modHistory')) $id('modHistory').hidden = true;
    if (hide.has('fk') && $id('fkCard')) $id('fkCard').style.display = 'none';
    if (hide.has('battle')) {
      const b = $id('battleEntry');
      const holder = b && (b.closest('.gcard') || b.parentElement);
      if (holder) holder.hidden = true;      // 连整张卡一起收，别留个空框
    }

    /* 资讯屏：data/ol_news 与 data/x10_news 不随子体分发 → 轮播只剩「每日武将」一屏。
       只支持整组一起砍（只砍其中一个会让圆点索引与 slide 顺序错位）。 */
    if (hide.has('olnews') || hide.has('x10news')) {
      ['newsCard', 'news10Card'].forEach((id) => {
        const n = $id(id);
        if (n) n.remove();
      });
      BX.n = 1;
      BX.i = 0;
      const box = $id('bannerBox');
      if (box) box.style.setProperty('--bx-n', '1');
      const tr = $id('bxTrack');
      if (tr) tr.style.transform = 'translateX(0)';
      const dots = $id('bxDots');
      if (dots) dots.hidden = true;          // 单屏不需要圆点
    }
  }

  /* ============ Tab 路由 ============ */
  function go(tab) {
    /* 「规则与玩法 / 游戏牌种类」自 2026-10-14 起改成弹层（与首页其余卡一致），不再是整页：
       但 battle.js 退出对战时仍会 __sgsGo('mode') 回退 —— 这里统一转成「回首页 + 开弹层」。 */
    if (tab === 'mode' || tab === 'cards') { go('home'); openPane(tab); return; }
    closePanes();                       // 切到任何整页（含轻量对战）时先收起首页弹层
    document.body.dataset.tab = tab;
    for (const p of ['home', 'heroes', 'olnews', 'x10news', 'profile', 'battle']) {
      $('page-' + p).hidden = p !== tab;
    }
    for (const b of document.querySelectorAll('.tabbar .tab')) {
      b.classList.toggle('active', b.dataset.tab === tab);
    }
    if (tab === 'heroes') { vgMeasure(); vgSchedule(); loadSearchIndexSoon(); loadRecentSoon(); }  // 页面可见后重新度量虚拟列表，并静默预取全库索引与最新更新
    if (tab === 'olnews') { loadOlNews(); markOlNewsSeen(); }                    // OL 资讯页：按需加载本地 JSON
    if (tab === 'x10news') { loadX10News(); markX10NewsSeen(); }                 // 一将成名资讯页：按需加载本地 JSON
    syncSheetTab(tab);                                                           // 详情页随归属 Tab 挂起/恢复
    renderPybar();
    placeTabDot();
    window.scrollTo(0, 0);
  }

  window.__sgsGo = go;  // 对战页（battle.js）借用主路由返回/进入，不复制路由逻辑

  /* ============ 「规则与玩法 / 游戏牌种类」弹层（2026-10-14） ============
     这两块原先是整页（<main id="page-mode"> / <main id="page-cards">，走 go() 切 Tab、
     底部导航跟着跳走），现改成与首页其余卡同一套 dm-modal 原地弹层（云纹抬头 + ✕）。
     内容仍留在各自的 #page-mode / #page-cards 里，外部按 id 取文本或渲染的地方不受影响。
     遮罩点击 / ✕ 两种方式关闭；go() 切到任何整页时会自动收起。 */
  const PANES = {
    mode:  { mask: 'modeMask', modal: 'modeModal', close: 'modeClose' },
    cards: { mask: 'cardMask', modal: 'cardModal', close: 'cardClose' },
  };
  function openPane(which) {
    const p = PANES[which]; if (!p) return;
    $(p.mask).hidden = false;
    $(p.modal).hidden = false;
    document.body.style.overflow = 'hidden';
  }
  function closePane(which) {
    const p = PANES[which]; if (!p) return;
    const m = $(p.modal);
    if (m.hidden) return;               // 没开就别动滚动锁，免得误伤别的弹层
    $(p.mask).hidden = true;
    m.hidden = true;
    document.body.style.overflow = '';
  }
  function closePanes() { closePane('mode'); closePane('cards'); }
  for (const _pk of Object.keys(PANES)) {
    $(PANES[_pk].mask).addEventListener('click', () => closePane(_pk));
    $(PANES[_pk].close).addEventListener('click', () => closePane(_pk));
  }

  /* ============ 主题（跟随系统 / 日间宣纸 / 夜间水墨）============
     存储的是「用户的选择」（auto/paper/ink）；实际生效的配色由 systemTheme() 解析。
     —— 壳内：系统深浅色以壳的 Configuration 为准（SGSHost.isSystemDark），
        因为 manifest 声明了 configChanges=uiMode，Activity 不重建，
        WebView 的媒体查询不保证会重新求值；
     —— 浏览器内：用 matchMedia，并监听其变化。 */
  const DARK_MQ = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
  function systemTheme() {
    if (IS_APP) return isTrue(hostCall('isSystemDark', '0')) ? 'ink' : 'paper';
    return (DARK_MQ && DARK_MQ.matches) ? 'ink' : 'paper';
  }
  function themeMode() {
    const m = safeGet(THEME_KEY);
    return (m === 'paper' || m === 'ink') ? m : 'auto';
  }
  /* 把实际配色同步到「网页之外」的地方：① 页内 <meta theme-color>（浏览器地址栏 / 部分机型状态栏底）
     ② Android 壳（setTheme → 系统栏底色 + 图标明暗）。这是「系统栏与页面不断层」的关键一环。 */
  function applyThemeChrome(actual) {
    const dark = actual === 'ink';
    const bg = dark ? '#191612' : '#f7f3ec';
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', bg);
    if (HOST) { try { HOST.setTheme(dark ? 'ink' : 'paper'); } catch (e) { /* 忽略 */ } }
  }
  function applyTheme(mode) {
    const m = (mode === 'paper' || mode === 'ink') ? mode : 'auto';
    const actual = (m === 'auto') ? systemTheme() : m;
    const root = document.documentElement;
    root.dataset.theme = actual;      // 只驱动配色
    root.dataset.themeMode = m;       // 记录选择（auto/paper/ink），供调试与壳读取
    for (const b of document.querySelectorAll('#themeSeg button')) {
      b.classList.toggle('active', b.dataset.theme === m);
    }
    safeSet(THEME_KEY, m);
    applyThemeChrome(actual);
    syncSoon();  // 登录态：主题偏好写入本机账号档案
  }
  if (DARK_MQ) {
    const onSys = () => { if (themeMode() === 'auto') applyTheme('auto'); };
    if (DARK_MQ.addEventListener) DARK_MQ.addEventListener('change', onSys);
    else if (DARK_MQ.addListener) DARK_MQ.addListener(onSys);   // 老 WebView 回退
  }

  /* ============ 离线模式适配（Android 壳 · 纯本地版）============
     App 版把整站资源打进包内，没有 serve.py 可调：两个「同步最新」按钮
     无处可 POST；「仅 Wi-Fi 加载高清立绘与语音」也无意义（本地直读 + 语音未打包）。
     统一降级成说明态，而不是留着按钮让用户点了报错。 */
  function applyOfflineMode() {
    if (!IS_OFFLINE) return;
    document.documentElement.dataset.offline = '1';
    for (const id of ['olSyncBtn', 'x10SyncBtn']) {
      const b = $(id);
      if (!b) continue;
      b.textContent = '离线版';
      b.disabled = true;
      b.setAttribute('aria-disabled', 'true');
      b.classList.add('off');
    }
    const wifiRow = $('wifiSwitch') && $('wifiSwitch').closest('.setrow');
    if (wifiRow) wifiRow.hidden = true;
  }

  /* ============ 收藏（按账号隔离：sk(FAV_KEY)） ============ */
  function favs() {
    try { return JSON.parse(safeGet(sk(FAV_KEY)) || '[]'); } catch (e) { return []; }
  }
  function isFav(v, id) { return favs().some((f) => f.v === v && f.id === id); }
  function toggleFav() {
    if (!currentDetail) return;
    const { v, id } = currentDetail;
    let list = favs();
    if (isFav(v, id)) {
      list = list.filter((f) => !(f.v === v && f.id === id));
      toast('已取消收藏');
    } else {
      const g = detailHero();
      list.unshift({ v, id, n: g ? g.n : id, t: g ? (g.t || '') : '' });
      toast(UserStore.isLogin()
        ? '已加入我喜爱的武将 · 已存入本机账号'
        : '已保存至本机 · 登录后可按账号分区管理');
      // 朱砂印记按压 + 宣纸横幅 + 触觉反馈（up/003 二.1/二.3）
      const fb = $('favBtn');
      fb.classList.remove('pop'); void fb.offsetWidth; fb.classList.add('pop');
      showFavBanner('已收入偏爱武将');
      tapFeel(12);
    }
    safeSet(sk(FAV_KEY), JSON.stringify(list.slice(0, FAV_MAX)));
    renderFavs();
    renderFavBtn();
    renderPstats();
    if (UserStore.isLogin()) {
      syncSoon();
      const badge = $('rankBadge');
      if (badge && !badge.hidden) badge.textContent = rankName(list.length);  // 称号随收藏数实时进阶
    }
  }
  function renderFavBtn() {
    const b = $('favBtn');
    if (!currentDetail) return;
    const on = isFav(currentDetail.v, currentDetail.id);
    b.textContent = on ? '♥ 已收藏' : '☆ 收藏';
    b.classList.toggle('on', on);
  }

  /* ============ 版本切换 ============ */
  /* 版本 tab：浏览态 = 切版本；搜索态 = 收窄「搜索范围」（多一枚「全部」）。
     同一行两套语义是刻意的 —— 搜索态的结果本来就是四版混排，此时切版本没有意义，
     而用户想「只看 OL」时最自然的手势就是点那一格。 */
  function renderTabs() {
    const searching = isSearching();
    const allChip = searching
      ? `<button class="vtab vtab-all${state.scope === 'all' ? ' active' : ''}" role="tab"
           aria-selected="${state.scope === 'all'}" data-v=""><b>全部</b></button>`
      : '';
    /* 搜索态不列「未实装」：它不在跨版本搜索索引里，列出来点了只会是空结果 */
    $('vtabs').innerHTML = allChip + INDEX.filter((v) => !searching || v.id !== UNRELEASED_ID).map((v) => {
      const act = searching ? state.scope === v.id : v.id === V.id;
      return `<button class="vtab${act ? ' active' : ''}" role="tab"
         aria-selected="${act}" data-v="${v.id}">
         <b>${v.short}</b><i>${v.count}</i></button>`;
    }).join('');
    // 搜索框提示随范围变，让「现在搜的是哪一版」在输入前就看得见
    // 措辞不写死版本数（原为「四版」，加国际服后每加一库就要改一次）
    const q = $('q');
    if (q) q.placeholder = searching && state.scope !== 'all'
      ? `搜索${scopeLabel()}武将 / 称号 / 技能名`
      : '搜索全部武将 / 称号 / 技能名';
  }

  async function switchVersion(id) {
    if (!INDEX.some((v) => v.id === id)) id = INDEX.length ? INDEX[0].id : DEFAULT_VERSION;
    setStatus(`正在载入「${(INDEX.find((v) => v.id === id) || {}).label || id}」…`);
    try {
      const data = await fetchJSON(dataUrl(id));
      V = { id, short: data.short || id, label: data.label || id, source: data.source || '', roles: data.roles || null };
      G = data.generals || [];
      __NW_SET = null;   // 切库后重建新武将缓存
      /* 游戏内「格子」口径（2026-10-12）：标/界在游戏图鉴里是同一格子的形态切换，
         所以列表 / 计数 / 随机只认非界条目；界仍留在 G 里，靠详情页
         「标 | 界」跳转（jump 用 cp 找条目，open() 也从完整 G 取）照常可达。 */
      GLIST = G.filter((g) => g.jv !== 'jie');
      PACKS = data.packs || [];
      const present = new Set(GLIST.map((g) => g.lv).filter(Boolean));
      LEVELS = LEVEL_ORDER.filter((l) => present.has(l));
      // 拼音索引（up/003 一.3）：id 尾段全拼 → 首字母分组 + 缩写检索
      PYINI = new Map();
      for (const g of G) { g._py = pyTail(g.id); PYINI.set(g.id, (g._py[0] || 'a').toUpperCase()); }
      AZ = [...new Set([...PYINI.values()])].sort();
      // 游戏内序号：十周年等版本带 ord（官方灯序 + GeneralID），带则浏览态按游戏顺序排
      HAS_ORD = G.some((g) => g.jv !== 'jie' && typeof g.ord === 'number');
      state.kingdom = 'all'; state.pack = state.sub = state.role = state.level = null; state.fut = false; state.q = '';
      state.scope = 'all'; GRP_OPEN.clear();   // 换版本 = 退出搜索态，范围与折叠一起归零
      // 注意：state.newOnly 故意不清 —— 每个服务器都有自己的「最新 10 位」，换库就该换一份给他看
      $('q').value = '';
      safeSet(VERSION_KEY, id);
      PACK_ICONS_ALL[V.id] = undefined;  // 版本切换后重新校验该版图标（跨版本缓存其余版本保留）
      delete VER_DATA[V.id];             // 切走后该版成为「他版」，缓存作废，下次点开重新拉
      // 2026-10-14 起卡面不再显示卡包圆标 → 不再预取 pack_icons.json（函数保留备用）
      renderTabs();
      renderFilters();
      render();
      renderPstats();
      syncSoon();  // 登录态：版本偏好写入本机账号档案
      const vl = $('verLabel');
      if (vl) vl.textContent = `版本数据（${V.label || id}）`;
      setStatus(null);
    } catch (err) {
      setStatus(null);
      $('grid').innerHTML = '';
      $('empty').textContent = '数据载入失败：' + err.message +
        (location.protocol === 'file:' ? '（请通过 http 访问，file:// 下浏览器禁止读取本地 JSON）' : '');
      $('empty').hidden = false;
    }
  }

  async function openInVersion(v, id) {
    if (V.id !== v) {
      await switchVersion(v);
    }
    if (!G.some((g) => g.id === id)) { toast('该版本未收录此武将'); return; }
    open(id);
  }

  /* ============ 体力 ============ */
  function hpPips(v) {
    const n = Number(v) || 0;
    if (n > 8) return '';
    let out = '';
    const full = Math.floor(n);
    for (let i = 0; i < full; i++) out += '<i class="pip"></i>';
    if (n - full >= 0.5) out += '<i class="pip half"></i>';
    return '<span class="pips">' + out + '</span>';
  }
  /* 新武将：characters.json 里带 nw=<版本号> 的条目；只在当前版本亮红点 */
  function isNewG(g) {
    if (!g) return false;
    if (g.nw && g.nw === window.__SGS_APP_V) return true;
    if (__NW_SET === null) {
      __NW_SET = new Set((G || []).filter((x) => x && x.nw && x.nw === window.__SGS_APP_V).map((x) => x.id));
    }
    return !!(g.id && __NW_SET.has(g.id));
  }

  function hpText(g) {
    const max = Number(g.hp) || 0;
    const init = g.hp0 === undefined ? max : Number(g.hp0);
    const fmt = (x) => (Number.isInteger(x) ? String(x) : x.toFixed(1));
    return init !== max ? `${fmt(init)} / ${fmt(max)}` : fmt(max);
  }

  /* ============ 筛选条 ============ */
  function renderFilters() {
    /* 「最新 10」：势力行里夹在「全部」之后、魏之前（2026-11-10 用户定）。
       当前库在 recent.json 里没有条目时不出现，势力行跟没加过这个功能一样。 */
    const rc = recentOf();
    // 「最近更新」是独占筛选态：它亮着的时候阵营键一律不亮（否则「全部」会同时亮两个）
    const kgActive = (k) => !state.newOnly && state.kingdom === k.k;
    const kgHTML = (k) =>
      `<button class="kg k-${k.k}${kgActive(k) ? ' active' : ''}" data-k="${k.k}" aria-pressed="${kgActive(k)}">
        ${KC[k.k] ? `<i class="dot" style="background:${KC[k.k]}"></i>` : ''}${k.label}</button>`;
    const firstKg = KINGDOMS[0];   // 「全部」固定是第一项，最新 10 插在它后面
    $('kingdoms').innerHTML =
      (firstKg ? kgHTML(firstKg) : '')
      + (rc.length
        ? `<button class="kg kg-new${state.newOnly ? ' active' : ''}" data-new="1" type="button"
             aria-pressed="${state.newOnly}">最近更新</button>`
        : '')
      + KINGDOMS.slice(1).map(kgHTML).join('');
    // 分类上的红点：该分类里只要有一位新武将就点亮（含 px 附加分类）
    const __newPack = {};
    G.forEach((g) => {
      if (!isNewG(g)) return;
      if (g.p) __newPack[g.p] = 1;
      (g.px || []).forEach((x) => { __newPack[x] = 1; });
    });
    $('packRow').innerHTML = PACKS.map((p) =>
      `<button class="chip${state.pack === p.id ? ' active' : ''}" data-p="${p.id}">${p.label}${p.count ? `<i class="cnt">${p.count}</i>` : ''}${__newPack[p.id] ? '<i class="newdot" aria-label="有新武将"></i>' : ''}</button>`).join('');
    // 窄屏下分类行默认收起（点「筛选」才展开），chip 上的红点会被藏住 →
    // 让「筛选」键同点位亮一个（CSS ::after），面板展开后自动熄灭，不重复。
    const fbtn = $('filterBtn');
    if (fbtn) fbtn.classList.toggle('has-new', Object.keys(__newPack).length > 0);
    /* 二级扩展包（欢乐杀）：packs[].children 存在时才出现，其余版本行为完全不变 */
    const curPack = PACKS.find((p) => p.id === state.pack);
    const subs = (curPack && curPack.children) || [];
    const subRow = $('packSubRow');
    if (subRow) {
      subRow.hidden = subs.length === 0;
      subRow.innerHTML = subs.length
        ? `<button class="chip sub${state.sub ? '' : ' active'}" data-s="">全部<i class="cnt">${curPack.count || 0}</i></button>`
          + subs.map((c) => `<button class="chip sub${state.sub === c.id ? ' active' : ''}" data-s="${c.id}">${c.label}<i class="cnt">${c.count || 0}</i></button>`).join('')
        : '';
    }
    const roleSet = new Set(G.flatMap((g) => (g.tg && g.tg.roles) || []));
    const roleList = (V.roles && V.roles.length) ? V.roles : ROLES;
    $('roleRow').innerHTML = roleList.filter((r) => roleSet.has(r)).map((r) =>
      `<button class="chip role${state.role === r ? ' active' : ''}" data-r="${r}">${r}</button>`).join('');
    $('levelRow').innerHTML = LEVELS.map((l) =>
      `<button class="chip${state.level === l ? ' active' : ''}" data-l="${l}">${l}</button>`).join('');
    $('levelRow').hidden = LEVELS.length < 2;
    // 未实装/前瞻专区（up/004 任务3）：仅当版本内存在非 released 武将时出现，零数据零 UI
    const futN = G.filter((g) => g.rel && g.rel !== 'released').length;
    $('futRow').hidden = futN === 0;
    $('futRow').innerHTML = futN ? `<button class="chip${state.fut ? ' active' : ''}" data-fut="1">前瞻 ${futN}</button>` : '';
    const dirty = state.newOnly || state.kingdom !== 'all' || state.pack || state.sub || state.role || state.level || state.fut || state.q;
    $('clearBtn').hidden = !dirty;
    renderFilterBadge();
  }

  /* ============ 筛选面板折叠 ============ */
  const isSearching = () => !!state.q.trim();
  function activeFilterCount() {
    // 搜索态下包/品质/角色/前瞻不参与检索，角标只算阵营 —— 否则会显示一个点了也不生效的数字
    if (isSearching()) return state.kingdom !== 'all' ? 1 : 0;
    if (state.newOnly) return 1;   // 最新更新 = 一个独占的筛选态，角标记 1
    return (state.kingdom !== 'all' ? 1 : 0) + (state.pack ? 1 : 0) + (state.sub ? 1 : 0) + (state.role ? 1 : 0) + (state.level ? 1 : 0) + (state.fut ? 1 : 0);
  }
  function renderFilterBadge() {
    const n = activeFilterCount();
    const b = $('filterBadge');
    b.hidden = n === 0;
    b.textContent = String(n);
    $('filterBtn').classList.toggle('has', n > 0);
  }
  function setFiltersOpen(open, persist) {
    if (isSearching()) open = false;  // 搜索态：版本内筛选不参与检索，面板一律收起
    $('fpanel').classList.toggle('open', !!open);
    $('filterBtn').classList.toggle('on', !!open);
    $('filterBtn').setAttribute('aria-expanded', String(!!open));
    if (persist) safeSet(FILTERS_OPEN_KEY, open ? '1' : '0');
  }
  /* 搜索态样式开关（.htop.searching）：版本内筛选（包/品质/角色/前瞻）整块隐去，只留阵营行。
     与滚动折叠（.htop.folded）是两套独立状态，互不干扰。 */
  function setSearchMode(on) {
    const htop = $('htop');
    if (!htop) return;
    const is = htop.classList.contains('searching');
    if (is === !!on) return;
    htop.classList.toggle('searching', !!on);
    renderTabs();             // 版本行换语义：搜索态多一枚「全部」+ 高亮当前搜索范围
    if (on) setFiltersOpen(false, false);
    else initFiltersOpen();   // 退出搜索：按用户原偏好 / 活跃筛选恢复折叠状态
    renderFilterBadge();
  }
  function initFiltersOpen() {
    // 默认收起（首访）；记住用户上次选择；有活跃筛选时强制展开避免“列表变少却找不到原因”
    let open = safeGet(FILTERS_OPEN_KEY) !== null ? safeGet(FILTERS_OPEN_KEY) === '1' : false;
    if (activeFilterCount() > 0) open = true;
    setFiltersOpen(open, false);
  }

  /* ============ 跨版本搜索（一个搜索框搜四版） ============
   * 原来搜索只扫当前版本的内存数据，切版本还会清空输入框，用起来像「三个搜索框」。
   * 现在有搜索词就改走全库索引 data/search_index.json（由 v2/gen_search_index.py 预生成，
   * 2216 条 / 原始 336KB / gzip 78KB），绝不能为了搜索去拉四版完整 JSON（3.84MB）。
   * 索引条目字段：v 版本 / id / n 名 / t 称号 / gr 包 / lv 品质 / py 拼音 / sk 技能名 /
   *              jv 标界 / rel 上线状态 / ni,na 缺图标记。
   * ★ jv 与 rel 必须带上：搜索结果直接进 cardInner()，缺了列表卡片就不出徽章
   *   （详情页读完整 JSON 所以正常，只有列表会漏 —— 曾经真的漏过）。
   */
  function ensureSearchIndex() {
    if (SIDX) return Promise.resolve(SIDX);
    if (SIDX_P) return SIDX_P;
    SIDX_P = fetchJSON(SEARCH_URL)
      .then((d) => { SIDX = (d && d.items) || []; return SIDX; })
      .catch(() => { SIDX_P = null; return null; });  // 失败置空以便下次重试
    return SIDX_P;
  }
  function loadSearchIndexSoon() {
    if (SIDX || SIDX_P) return;
    const run = () => ensureSearchIndex().then((list) => { if (list && state.q.trim()) render(); });
    if (window.requestIdleCallback) requestIdleCallback(run, { timeout: 2000 });
    else setTimeout(run, 400);
  }
  /* ============ 「最新更新」筛选（2026-11-10）
   * 数据来自 data/recent.json（v2/gen_recent.py 生成）：**每个库各自**最近入库的 10 位武将，
   * 按更新声明 + 立绘入库时间排。它是势力行里「全部」之后的第一项，与势力/包/品质互斥。
   * 文件缺失 / 当前库没数据 → 这个 chip 不出现，其余筛选完全不受影响。 */
  function ensureRecent() {
    if (RECENT) return Promise.resolve(RECENT);
    if (RECENT_P) return RECENT_P;
    RECENT_P = fetchJSON(RECENT_URL)
      .then((d) => {
        RECENT = (d && d.libs) || {};
        RECENT_META = { app: (d && d.app) || '', generated: (d && d.generated) || '', limit: (d && d.limit) || 10 };
        return RECENT;
      })
      .catch(() => { RECENT_P = null; return null; });   // 失败置空：下次进英雄页再试
    return RECENT_P;
  }
  /* 当前库的「最近更新」条目；没有就返回空数组（chip 一并隐藏） */
  function recentOf(ver) { return (RECENT && RECENT[ver || V.id]) || []; }
  function loadRecentSoon() {
    if (RECENT || RECENT_P) return;
    const run = () => ensureRecent().then(() => {
      renderFilters();
      if (state.newOnly) render();
    });
    if (window.requestIdleCallback) requestIdleCallback(run, { timeout: 2000 });
    else setTimeout(run, 400);
  }
  /* 点「最新 10」：进入该库的更新视图并清掉版本内筛选（包/品质/角色/前瞻都是单库细分，
     留着会让 10 位里只剩两三位，看着像功能坏了）；再点一次退出。
     切版本时**不清**这个态 —— 每个服务器的「最近 10 位」是同一件东西，换库就该换一份给他看。 */
  function toggleRecent() {
    state.newOnly = !state.newOnly;
    if (state.newOnly) {
      state.kingdom = 'all';
      state.pack = state.sub = state.role = state.level = null;
      state.fut = false;
      if (state.q) { state.q = ''; $('q').value = ''; }   // 搜索态下点它 = 退出搜索看更新
      state.scope = 'all';
      GRP_OPEN.clear();
      if (!RECENT) loadRecentSoon();
    }
    renderFilters();
    render();
    tapFeel(10);
  }

  /* 全库命中：只保留阵营筛选（四版通用），包/品质/角色/前瞻是版本内概念，跨版混排会打架。
     搜索范围（state.scope）='all' 时四版一起搜，否则只搜指定版本。 */
  function vShort(id) { const v = INDEX.find((x) => x.id === id); return (v && v.short) || VN[id] || id; }
  function scopeLabel() { return state.scope === 'all' ? '全部版本' : vShort(state.scope); }

  function searchAll(q) {
    const scoped = state.scope !== 'all';
    const out = [], byVer = {};
    const pass = (fn) => {
      for (const it of SIDX) {
        if (scoped && it.v !== state.scope) continue;
        if (state.kingdom !== 'all' && !kingMatch(it, state.kingdom)) continue;
        const h = fn(it, q);
        if (h.s > 0) { out.push([h.s, it, h]); byVer[it.v] = (byVer[it.v] || 0) + 1; }
      }
    };
    pass(hitInfo);
    /* 兜底：主字段（名字/拼音/称号/技能名）一条都没命中，才拿包名/阵营再捞一遍，
       并在计数栏写明「兜底」—— 否则「蜀」会天天命中 594 条、把真结果淹掉。 */
    let weak = false;
    if (!out.length) { pass(weakInfo); weak = out.length > 0; }
    out.sort((a, b) => b[0] - a[0]);
    const list = out.map((x) => { x[1]._hit = x[2]; return x[1]; });
    SS = { raw: list.length, byVer, weak };
    return collapseByName(list);
  }
  /* 同名跨版聚合：四版同名武将默认只出一张代表卡（优先「当前搜索范围 >> 当前版本」那一版），
     其余版本折成卡片上的一行「另有 N 版」，点开才铺开。
     数据仍是四版各自独立的卡（技能/称号/品质都不同），所以是「折叠」不是「合并」。 */
  function collapseByName(list) {
    for (const g of list) { g._others = null; g._inGrp = null; }
    const groups = new Map();
    for (const g of list) { let a = groups.get(g.n); if (!a) groups.set(g.n, (a = [])); a.push(g); }
    const pref = state.scope !== 'all' ? state.scope : V.id;
    const done = new Set(), out = [];
    for (const g of list) {
      if (done.has(g.n)) continue;
      done.add(g.n);
      const a = groups.get(g.n);
      if (a.length === 1) { out.push(g); continue; }
      if (GRP_OPEN.has(g.n)) { a.forEach((x) => { x._inGrp = g.n; out.push(x); }); continue; }
      const rep = a.find((x) => x.v === pref) || a[0];
      rep._others = a.filter((x) => x !== rep);
      out.push(rep);
    }
    return out;
  }

  /* ============ 搜索与筛选 ============
   * 字段分层（up/005）：默认只搜搜索框承诺的三项 —— 名字（含拼音）/ 称号 / 技能名；
   * 包名·阵营·技能描述降为兜底（见 searchAll），避免「蜀」594 条、「其他」277 条这类噪声。
   * hitInfo 同时回报「命中原因 + 命中的原词」，卡片上直接写清为什么它在这儿。 */
  function hitInfo(g, q) {
    const name = (g.n || '').toLowerCase();
    if (name === q) return { s: 5, why: 'name', w: g.n };
    if (name.includes(q)) return { s: 4, why: 'name', w: g.n };
    if ((g.id || '').toLowerCase().includes(q)) return { s: 3.5, why: 'name', w: g.n };
    // 拼音检索（up/003 一.3）：纯字母 query 匹配 id 尾段全拼 —— 前缀 > 缩写子序列（'yx'→yangxiu）
    if (/^[a-z]{1,8}$/.test(q)) {
      const py = g._py || g.py || pyTail(g.id);  // 完整数据用 _py，搜索索引自带 py
      if (py.startsWith(q)) return { s: 3.2, why: 'pinyin', w: py };
      if (isSubseq(q, py)) return { s: 2.8, why: 'pinyin', w: py };
    }
    if ((g.t || '').toLowerCase().includes(q)) return { s: 2.4, why: 'title', w: g.t };
    // 搜索只走轻量索引（只有技能名 sk）；浏览态的完整数据带 description，这里一并兼容
    const skl = (g.s && g.s.length ? g.s.map((s) => s.name || '') : (g.sk || []));
    const hitSk = skl.find((n) => (n || '').toLowerCase().includes(q));
    if (hitSk) return { s: 2, why: 'skill', w: hitSk };
    return { s: 0, why: '', w: '' };
  }
  /* 兜底命中：包名 / 阵营 / 技能描述全文 */
  function weakInfo(g, q) {
    if ((g.gr || '').toLowerCase().includes(q)) return { s: 1.5, why: 'pack', w: g.gr };
    if ((KN[g.k] || '').includes(q)) return { s: 1.4, why: 'kingdom', w: KN[g.k] };
    const desc = (g.s && g.s.length ? g.s.map((s) => s.description || '') : []).join(' ').toLowerCase();
    if (desc.includes(q)) return { s: 1, why: 'desc', w: '' };
    return { s: 0, why: '', w: '' };
  }
  /* 命中原因 → 卡片上的长/短两种写法：长版进 title 提示，短版做左上角小章 */
  const HIT_TX = {
    title: (w) => '称号「' + w + '」',
    skill: (w) => '技能「' + w + '」',
    pinyin: (w) => '拼音 ' + w,
    pack: (w) => '所属包「' + w + '」',
    kingdom: (w) => '阵营 ' + w,
    desc: () => '技能描述命中'
  };
  const HIT_SHORT = { title: '称号', skill: '技能', pinyin: '拼音', pack: '卡包', kingdom: '阵营', desc: '描述' };
  function hitLabel(g) {
    const h = g._hit;
    if (!h || !h.why || h.why === 'name') return '';
    const f = HIT_TX[h.why];
    return f ? f(h.w || '') : '';
  }
  function filtered() {
    const q = state.q.trim().toLowerCase();
    // 搜索态：走全库索引（按 state.scope 收窄）；包/品质/角色/前瞻等版本内筛选不参与
    if (q) return SIDX ? searchAll(q) : [];
    // 「最新 10」：当前库最近入库的 10 位，顺序就是数据里的顺序（新的在前），不参与单库条件
    if (state.newOnly) return recentOf();
    const out = [];
    for (const g of GLIST) {
      if (state.kingdom !== 'all' && !kingMatch(g, state.kingdom)) continue;
      // 聚合型分类（移动版国战/稀有专属/1V1）：px 为附加分类，命中即显示；其余版本无 px，行为不变
      if (state.pack && g.p !== state.pack && !(g.px && g.px.indexOf(state.pack) >= 0)) continue;
      if (state.sub && !inSub(g, state.sub)) continue;
      if (state.level && g.lv !== state.level) continue;
      if (state.role && !((g.tg && g.tg.roles) || []).includes(state.role)) continue;
      // 前瞻开关（up/004 任务3）：开=只看未实装/测试/活动限定；rel 缺省视为 released，旧数据零影响
      if (state.fut && !(g.rel && g.rel !== 'released')) continue;
      out.push([1, g]);
    }
    return out.map((x) => x[1]);
  }

  /* ============ 列表 ============ */
  /* 名字首字：先去掉「（守卫剑阁2026）（夙志）」这类括号后缀，
     再剥掉 势/谋/界/神/起/疑 这些版本前缀 —— 否则「势臧洪」会取到无意义的「势」 */
  function nameInitial(n) {
    const s = (n || '?').replace(/（[^）]*）/g, '');
    const t = s.replace(/^(势|谋|界|神|起|疑|族包)/, '');
    return (t || s || '?').slice(0, 1);
  }
  /* 国风占位立绘卡（v2/mark_ph_images.py 打的 ni 标记）：
     BWIKI 对没图的武将返回一张 4.5KB 的「点击上传」灰图，直接铺在卡面上很穿帮，
     这里改为本地绘制的「空白画心」：宣纸底 + 内嵌古铜画框 + 淡云纹 + 武将剪影。
     无立绘武将的版本形态（守卫剑阁2026 / 英魂 / 疑包…）官方还没放图，先体面地空着。 */
  function phHeroHTML(g) {
    return `<span class="ph-hero" style="--k:${KC[g.k] || '#948a78'}" role="img" aria-label="${esc(g.n)} 暂无立绘">
        <svg class="phh-cloud" viewBox="0 0 100 44" preserveAspectRatio="none" aria-hidden="true">
          <path d="M-2 33c9-2 13-8 21-7s10 6 18 5 11-8 20-7 12 7 20 5 15-7 25-5"/>
          <path d="M-2 42c10-2 14-7 22-6s10 5 18 4 11-7 20-6 12 6 20 4 16-6 24-4"/>
        </svg>
        <svg class="phh-sil" viewBox="0 0 100 112" aria-hidden="true">
          <path d="M40 5h20l-2.5 7.5h-15z"/>
          <circle cx="50" cy="27" r="12.5"/>
          <path d="M50 40c-17 2-27.5 10.5-30.5 27L12 112h76l-7.5-45C77.5 50.5 67 42 50 40z"/>
          <path class="phh-collar" d="M32 108c4-23 8.5-35 18-45 9.5 10 14 22 18 45"/>
        </svg>
      </span>`;
  }
  /* 头像首字占位：na 标记（占位图 / 文件缺失）与图片 404 兜底共用 */
  function avInitHTML(g) {
    return `<span class="ph-av-init" style="--k:${KC[g.k] || '#948a78'}">${nameInitial(g.n)}</span>`;
  }
  function imgTag(g, cls) {
    const ver = itemVer(g);
    // 占位立绘 / 立绘缺失 → 本地国风占位卡，不再向 CDN 要那张「点击上传」图
    if (g.ni) return phHeroHTML(g);
    // g.img 是数据里写死的路径（不带版本串）→ 统一过一遍 imgV，换图后旧缓存才真正失效
    let src = imgV(g.img || rawAsset(ver, 'il', g.id), ver);
    // 弱网 + 「仅 Wi-Fi 加载高清图」开启：立绘降级为小头像
    if (src && !g.img && netWeak()) src = recAv(g, ver);
    if (!src) return phHeroHTML(g);
    // onload 渐现（up/003 一.2）：加载完成给所在卡片加 imgld，骨架让位、图片 300ms 淡入
    return `<img loading="lazy" src="${src}" alt="${g.n}"
             onload="if(this.closest('.card'))this.closest('.card').classList.add('imgld')"
             onerror="this.replaceWith(Object.assign(document.createElement('span'),{className:'ph-empty',textContent:'${(g.n || '?').slice(0, 1)}'}))">`;
  }
  /* 卡片的「归属版本」：搜索态用条目自身的版本（跨版本结果各归各版）；
     非搜索态用当前版本 —— 「未实装」的条目 _v 是 OL/移动版/十周年，
     若 data-v 跟着 _v 走，点进详情会去源版本里找，而它早已从源版本移除 → 查不到。 */
  const cardVer = (g) => (state.q.trim() ? itemVer(g) : V.id);
  function card(g) {
    return `<article class="card" data-id="${g.id}" data-v="${cardVer(g)}">${cardInner(g)}</article>`;
  }
  /* 手杀/十周年升级：包圆标懒加载（gr → 图标路径，fetch_msgs_icons.py 按版本产出）
     跨版本搜索时结果来自各个版本，每个版本各有一份 pack_icons.json，故按版本缓存。 */
  const PACK_ICONS_ALL = {};
  function loadPackIconsFor(ver) {
    if (PACK_ICONS_ALL[ver] !== undefined) return;
    PACK_ICONS_ALL[ver] = {};  // 先占位，避免并发重复请求
    fetch(vq(`${DATA_DIR}${ver}/pack_icons.json`)).then((r) => (r.ok ? r.json() : {}))
      .then((m) => { PACK_ICONS_ALL[ver] = m || {}; vgSchedule(); })
      .catch(() => { PACK_ICONS_ALL[ver] = {}; });
  }
  function loadPackIcons() { loadPackIconsFor(V.id); }
  function ensureAllIcons() { for (const v of INDEX) loadPackIconsFor(v.id); }
  function packIconFor(g) {
    const m = PACK_ICONS_ALL[itemVer(g)];
    return (m && g.gr) ? m[g.gr] : null;
  }
  const RARITY_CLS = {
    '史诗': 'shishi', '精品': 'jingpin', '普通': 'putong', '传说': 'ss', '稀有': 'a',
    'SSS': 'sss', 'SS': 'ss', 'S': 's', 'A': 'a', 'B': 'b', '神': 'shen'
  };
  /* 竖排名字的折列与字号：**按每张卡的实际可用高算**，不固定每列几个字。
     为什么必须算：势力条宽度是「按列数撑出来的」（.fbar 是 flex:0 0 auto，宽度取
     max-content = 列数 × 行高），而列数只能等于 <b class="fc"> 的块数。只要某块在列内
     二次折行，真实列数就多于块数 → 名字横向溢出条宽压到立绘上（2026-10-14 踩过）。
     所以硬约束是：percol ≤ floor(可用高 / 字号)。
       可用高 = 卡高 − 上下 padding − 势力字 − 间距 − 体力区（常量与 style.css 逐条对齐）
     ⚠ 另一坑：--kai 字体栈里的 "STKaiti"（华文楷体）在**竖排**下每字 advance = 1.3em
     （横排是 1em），12.5px 的字实际占 16.26px —— 6 字一列直接放不下。已从字体栈移除；
     下面一律按每字 1em 算，FNAME_SAFE 再留 1px 兜住字体差异。
     列数上限 3（用户 2026-10-14 定：超长名折 2~3 列、条子自适应变宽）；3 列都放不下的
     极长名（未实装的「XX（守卫剑阁2026）（XX）」16 字）靠缩字号达标，缩到下限仍不够才加列。 */
  const FNAME_FS = 12.5;      // 名字基准字号（= style.css .fn 的 --ffs 默认值）
  const FNAME_FS_MIN = 10.5;  // 名字最小字号，再小不可读
  const FNAME_SAFE = 1;       // 每列留 1px 余量，防亚像素/字体差异触发列内折行
  const FBAR_PADY = 9 + 8;    // .fbar 上下 padding
  const FBAR_FK = 10;         // .fbar .fk 势力字行高
  const FBAR_GAP = 3 * 2;     // .fbar gap 3px，共两个间隙
  const FHP_DOT = 5, FHP_GAP = 2;   // .fhp i 直径 / 点间距
  function fnameFit(nm, hp) {
    const len = nm.length;
    const phW = VG.phW || Math.max(70, (VG.colW || 110) - 2);
    const dots = hp && Number.isInteger(hp) && hp <= 8 ? hp * FHP_DOT + (hp - 1) * FHP_GAP
      : (hp ? FNAME_FS : 0);   // 数字形态占一行字高；无体力则 0
    const availH = phW * 1.32 - FBAR_PADY - FBAR_FK - FBAR_GAP - dots;
    const per1 = Math.max(1, Math.floor((availH - FNAME_SAFE) / FNAME_FS));
    let ncols = Math.max(1, Math.ceil(len / per1));
    let ffs = FNAME_FS;
    if (ncols > 3) {
      ncols = 3;
      const per = Math.max(1, Math.ceil(len / ncols));
      ffs = Math.floor(Math.max(FNAME_FS_MIN, Math.min(FNAME_FS, (availH - FNAME_SAFE) / per)) * 10) / 10;
      const perN = Math.max(1, Math.floor((availH - FNAME_SAFE) / ffs));
      if (per > perN) ncols = Math.max(1, Math.ceil(len / perN));   // 压到下限仍不够 → 加列，绝不折行
    }
    const percol = Math.max(1, Math.ceil(len / ncols));
    const cols = [];
    for (let i = 0; i < len; i += percol) cols.push(nm.slice(i, i + percol));
    return { cols, ffs };
  }
  /* 卡面版式（2026-10-14 用户要求，四版 + 未实装统一）：
     **只显示 势力 / 名称 / 体力 / 立绘** —— 左侧一条势力色竖条，条内自上而下是
     「势力字 / 竖排武将名 / 体力点」，右侧立绘占满余下宽度。
     已去掉：卡包圆标、稀有度、称号、首个技能、命中原因章、标·界徽章、待上线徽章、底部信息层。
     保留的两处是**功能件**（不是装饰，去掉会丢功能）：
       ① .vtag  「哪一版」小标 —— 跨版本搜索与未实装页里四版同名武将各成一张卡，没有它就分不清；
       ② .grp-x 「另有 N 版 / 收起」—— 同名跨版折叠的展开开关，去掉就展不开。
     体力规则：整数且 ≤8 出点（1 点 = 1 体力），其余（1.5 / 12 / 15…）直接出数字。 */
  function cardInner(g) {
    const needVtag = state.q.trim() || V.id === UNRELEASED_ID;
    const vtag = needVtag ? `<span class="vtag">${VN[itemVer(g)] || itemVer(g)}</span>` : '';
    const bits = [];
    if (g._others && g._others.length) {
      bits.push(`<button class="grp-x" data-grp="${esc(g.n)}" type="button" title="另有 ${g._others.length} 个版本，点开展开">另有 ${g._others.length} 版</button>`);
    } else if (g._inGrp) {
      bits.push(`<button class="grp-x on" data-grp="${esc(g.n)}" type="button" title="收起同名各版">收起</button>`);
    }
    const hitLine = bits.length ? `<div class="hit">${bits.join('')}</div>` : '';
    const nm = String(g.n || '');
    const hp = Number(g.hp) || 0;
    const fit = fnameFit(nm, hp);          // 折列 / 字号按本卡可用高算，见 fnameFit
    const cols = fit.cols;
    const hpHTML = !hp ? ''
      : (Number.isInteger(hp) && hp <= 8)
        ? `<span class="fhp">${'<i></i>'.repeat(hp)}</span>`
        : `<span class="fhp fhp-num">${Number.isInteger(hp) ? String(hp) : hp.toFixed(1)}</span>`;
    // --ffs 只在缩过字号时输出，别给 2600+ 张卡都挂冗余内联变量
    const ffsVar = fit.ffs !== FNAME_FS ? `;--ffs:${fit.ffs}px` : '';
    return `<div class="ph${g.ni ? ' no-il' : ''}" style="--fk:${KC[g.k] || KC.qun}${ffsVar}">
        <div class="fbar">
          <span class="fk">${KN[g.k] || ''}</span>
          <span class="fn">${cols.map((c) => `<b class="fc">${esc(c)}</b>`).join('')}</span>
          ${hpHTML}
        </div>
        <div class="pimg">${imgTag(g)}</div>
        ${isNewG(g) ? '<i class="newdot" aria-label="新武将"></i>' : ''}
        ${vtag}
        ${hitLine}
      </div>`;
  }
  /* ============ 虚拟网格（up/003 一.1，对应虚拟滚动组件范例）
   * 度量：vgMeasure 按容器宽算列宽/行高（3 列，≥560px 4 列）；
   * 布局：vgLayout 只把视口 ±1 行的卡片挂进 DOM（absolute 定位），
   *      范围未变化时跳过（lastKey），滚动经 rAF 节流（vgSchedule）；
   * 性能调优类：.vcard{will-change:transform;contain:layout style}，
   *            图片 lazy + 骨架渐现，innerHTML 批量重建仅在跨行时发生。 */
  function vgMeasure() {
    const el = $('grid');
    const cs = getComputedStyle(el);
    VG.pt = parseFloat(cs.paddingTop) || 0;
    VG.pb = parseFloat(cs.paddingBottom) || 0;
    VG.cols = window.matchMedia('(min-width:560px)').matches ? 4 : 3;
    const w = el.clientWidth - (parseFloat(cs.paddingLeft) || 0) - (parseFloat(cs.paddingRight) || 0);
    if (w <= 0) return false;  // 页面隐藏（display:none）时跳过
    VG.colW = (w - VG.gap * (VG.cols - 1)) / VG.cols;
    // .ph（卡面本体）实宽：卡片左右各 1px 边框 → colW - 2。fnameFit 按它算名字可用高
    VG.phW = Math.max(70, VG.colW - 2);
    VG.rowH = VG.colW * 1.32 + 2 + VG.gap;  // 立绘比例 1:1.32 + 上下边框 + 行距
    return true;
  }
  function vgLayout() {
    const el = $('grid');
    const items = VG.items;
    if (!items.length) { el.innerHTML = ''; el.style.height = ''; VG.lastKey = ''; return; }
    if (!vgMeasure()) return;
    const rows = Math.ceil(items.length / VG.cols);
    el.style.height = (VG.pt + rows * VG.rowH - VG.gap + VG.pb) + 'px';
    const rect = el.getBoundingClientRect();
    const vh = window.innerHeight || document.documentElement.clientHeight;
    const viewTop = Math.max(0, -rect.top);
    const viewBottom = Math.min(rect.height, vh - rect.top);
    let r0 = Math.max(0, Math.floor((viewTop - VG.pt) / VG.rowH) - 1);
    let r1 = Math.min(rows - 1, Math.ceil((viewBottom - VG.pt) / VG.rowH) + 1);
    const key = r0 + ':' + r1 + ':' + items.length + ':' + VG.cols;
    if (key === VG.lastKey) return;
    VG.lastKey = key;
    const frag = [];
    for (let r = r0; r <= r1; r++) {
      for (let c = 0; c < VG.cols; c++) {
        const i = r * VG.cols + c;
        if (i >= items.length) break;
        const g = items[i];
        const x = (c * (VG.colW + VG.gap)).toFixed(1);
        const y = (VG.pt + r * VG.rowH).toFixed(1);
        frag.push(`<article class="card vcard" data-id="${g.id}" data-v="${cardVer(g)}" style="left:${x}px;top:${y}px;width:${VG.colW.toFixed(1)}px">${cardInner(g)}</article>`);
      }
    }
    el.innerHTML = frag.join('');
    for (const im of el.querySelectorAll('img')) {  // 缓存命中直接显影，避免闪骨架
      if (im.complete && im.naturalWidth) { const c = im.closest('.card'); if (c) c.classList.add('imgld'); }
    }
  }
  function vgSchedule() { if (!VG.raf) VG.raf = requestAnimationFrame(() => { VG.raf = 0; vgLayout(); updatePyHighlight(); }); }
  function render() {
    const q = state.q.trim();
    const searching = !!q;
    setSearchMode(searching);   // 搜索态：版本内筛选（包/品质/角色/前瞻）收起置灰，只留阵营
    // 2026-10-14 起卡面不再显示卡包圆标 → 搜索态不必再预取各版 pack_icons.json

    // 索引还在路上：别急着显示「未找到」误导用户，就绪后 loadSearchIndexSoon 会自动重绘
    if (searching && !SIDX) {
      VG.items = [];
      VG.lastKey = '';
      $('grid').innerHTML = '';
      $('grid').style.height = '';
      $('count').textContent = '正在载入全库索引…';
      $('empty').hidden = true;
      $('empty').textContent = '';
      renderPybar();
      return;
    }

    const list = filtered();
    // 浏览态排序：带游戏内序号（ord）的版本 = 官方灯序 + GeneralID，即游戏图鉴里的顺序；
    // 其余版本保持 A-Z 拼音分组。搜索态按相关度排、最新更新按收录顺序，两者都不参与。
    if (!searching && !state.newOnly) {
      if (HAS_ORD) {
        // 选中包时按该包内序（pk[包].o），未选包时按全局游戏内序号 ord
        list.sort((a, b) => ordKey(a) - ordKey(b));
      } else {
        list.sort((a, b) => {
          const ia = PYINI.get(a.id) || 'Z', ib = PYINI.get(b.id) || 'Z';
          return ia === ib ? 0 : (ia < ib ? -1 : 1);
        });
      }
    }
    VG.items = list;
    if (searching) {
      const raw = SS ? SS.raw : list.length;
      const foldTx = raw > list.length ? `（${raw} 条同名已折叠）` : '';
      const weakTx = (SS && SS.weak) ? ' · 主字段无命中，已按包名/阵营兜底' : '';
      if (state.scope === 'all') {
        // 计数栏不再重复「全库检索「词」」（搜索框里就有），省下的宽度给四版分布
        const parts = INDEX.filter((v) => SS && SS.byVer[v.id]).map((v) => `${v.short} ${SS.byVer[v.id]}`);
        $('count').textContent = `命中 ${list.length} 名` + foldTx +
          (parts.length > 1 ? ` · ${parts.join(' / ')}` : '') + weakTx;
      } else {
        $('count').textContent = `范围 ${scopeLabel()} · 命中 ${list.length} 名` + foldTx + weakTx;
      }
      $('empty').textContent = `范围「${scopeLabel()}」没找到「${q}」`;
    } else if (state.newOnly) {
      // 只有一个库，所以不再报「来自哪几版」，改写这批的时间跨度（最新那条的日期）
      const d0 = list.length ? (list[0].date || '') : '';
      $('count').textContent = `最近更新 · ${list.length} 名` + (d0 ? ` · ${d0}` : '') + ` · ${V.short || V.id}`;
      $('empty').textContent = '暂无更新记录';
    } else {
      $('count').textContent = `共 ${list.length} 名武将` + (list.length !== GLIST.length ? ` / 全部 ${GLIST.length}` : '');
      $('empty').textContent = '未找到符合条件的武将';
    }
    VG.lastKey = '';
    vgLayout();
    $('empty').hidden = list.length > 0;
    renderPybar();
  }

  /* ============ 首页 ============ */
  function renderPicks() {
    const row = $('pickRow');
    if (!row || !GLIST.length) return;
    const day = Math.floor((Date.now() - new Date().getTimezoneOffset() * 60000) / 86400000);
    const step = Math.max(7, Math.floor(GLIST.length / 40)); // 稀疏取样，保证覆盖不同武将
    const seen = new Set(); const picks = [];
    for (let i = 0; picks.length < 8 && i < GLIST.length; i++) {
      const g = GLIST[(day * step + i * step) % GLIST.length];
      if (!g || seen.has(g.id)) continue;
      seen.add(g.id); picks.push(g);
    }
    row.innerHTML = picks.map((g) => {
      const inner = g.na ? avInitHTML(g)
        : `<img loading="lazy" src="${recAv(g)}" alt="${g.n}"
          onerror="this.replaceWith(Object.assign(document.createElement('span'),{className:'ph-av-init',textContent:'${nameInitial(g.n)}'}))">`;
      return `<button class="pick" data-pv="${V.id}" data-pid="${g.id}" type="button">
        <span class="pp" style="--k:${KC[g.k] || '#948a78'}">${inner}</span>
        <span class="pn">${g.n}<i>${VN[itemVer(g)] || ''}</i></span>
        <span class="pt">${g.t || g.gr || ''}</span>
      </button>`;
    }).join('');
  }

  /* ---------- 首页轮播（每日武将 / OL 资讯 / 一将成名资讯） ---------- */
  // 三屏：0 = 每日武将，1 = OL 资讯，2 = 一将成名（十周年）资讯。自动轮播 + 圆点 + 左右滑动。
  // 屏数由 BX.n 决定，CSS 侧配合 --bx-n（见 index.html 的 #bannerBox 内联样式）。
  const BX = { i: 0, n: 3, timer: 0, pause: false, drag: null, AUTO: 5200 };
  function bxGoto(i, anim) {
    BX.i = Math.max(0, Math.min(BX.n - 1, i));
    const tr = $('bxTrack');
    if (!tr) return;
    if (anim === false) tr.classList.add('no-anim');
    tr.style.transform = `translateX(${-BX.i * (100 / BX.n)}%)`;   // 每屏占 1/n（track 宽 n×100%）
    if (anim === false) requestAnimationFrame(() => tr.classList.remove('no-anim'));
    document.querySelectorAll('#bxDots .bx-dot').forEach((d) =>
      d.classList.toggle('active', Number(d.dataset.i) === BX.i));
  }
  function bxNext() { bxGoto(BX.i + 1 >= BX.n ? 0 : BX.i + 1); }
  function bxStart() {
    clearInterval(BX.timer);
    BX.timer = setInterval(() => { if (!BX.pause && !document.hidden) bxNext(); }, BX.AUTO);
  }
  function bxBind() {
    const dots = $('bxDots'), tr = $('bxTrack'), box = $('bannerBox');
    if (!box || box.dataset.bound) return;
    box.dataset.bound = '1';
    if (dots) dots.addEventListener('click', (e) => {
      const b = e.target.closest('.bx-dot');
      if (!b) return;
      bxGoto(Number(b.dataset.i)); bxStart();
    });
    if (tr) {
      // 触摸/鼠标拖动切换（移动 > 40px 才认，避免误触）
      const down = (x) => { BX.drag = { x0: x, dx: 0, on: true }; BX.pause = true; tr.classList.add('no-anim'); };
      const move = (x) => {
        if (!BX.drag || !BX.drag.on) return;
        BX.drag.dx = x - BX.drag.x0;
        tr.style.transform = `translateX(calc(${-BX.i * (100 / BX.n)}% + ${BX.drag.dx}px))`;
      };
      const up = () => {
        if (!BX.drag || !BX.drag.on) return;
        const dx = BX.drag.dx;
        BX.drag.on = false; BX.pause = false;
        tr.classList.remove('no-anim');
        if (Math.abs(dx) > 40) bxGoto(dx < 0 ? BX.i + 1 : BX.i - 1);
        else bxGoto(BX.i);
        setTimeout(bxStart, 600);
      };
      tr.addEventListener('touchstart', (e) => down(e.touches[0].clientX), { passive: true });
      tr.addEventListener('touchmove', (e) => move(e.touches[0].clientX), { passive: true });
      tr.addEventListener('touchend', up);
      tr.addEventListener('mousedown', (e) => { down(e.clientX); e.preventDefault(); });
      window.addEventListener('mousemove', (e) => { if (BX.drag && BX.drag.on) move(e.clientX); });
      window.addEventListener('mouseup', up);
    }
    bxStart();
  }
  // 资讯屏：封面整图铺满 + 底部压暗条上放「分类/条数/日期 + 最新公告标题」
  function renderNewsSlide() {
    const it = (OL && OL.items && OL.items.length) ? OL.items[0] : null;
    const sub = $('newsSub'), tt = $('newsTitle'), mt = $('newsMeta'), wrap = $('newsImgWrap');
    const card = $('newsCard');
    if (!it) {
      if (sub) sub.textContent = '暂无资讯';
      if (tt) tt.textContent = '（等待同步）';
      if (mt) mt.textContent = '';
      if (card) card.classList.add('no-cover');
      return;
    }
    const n = (OL.items || []).length;
    // 只取日期，不要时分（副标题一行放不下完整时间戳）
    const dt = String(it.pub || it.date || '').slice(0, 10);
    // 副标题行：分类 · 条数 · 日期（日期从药丸里挪出来，避免和长标题挤）
    if (sub) sub.textContent = `${it.cat || '资讯'} · 共 ${n} 条` + (dt ? ` · ${dt}` : '');
    // 标题去掉开头的日期段（「9.25-9.30 xxx」→「xxx」），否则药丸里放不下
    const t = String(it.title || '—').trim();
    const stripped = t.replace(/^\s*\d{1,2}[.\-月]\d{1,2}(?:\s*[-~～]\s*\d{1,2}[.\-月]\d{1,2})?\s*/, '');
    if (tt) tt.textContent = stripped || t;
    if (mt) mt.textContent = '';   // 已并入副标题
    // 无封面时退回暖金纸面（压暗条会显得突兀，用 no-cover 关掉）
    if (card) card.classList.toggle('no-cover', !it.cover);
    if (wrap) {
      wrap.innerHTML = '';
      if (it.cover) {
        const im = document.createElement('img');
        im.src = vq(DATA_DIR + 'ol_news/' + it.cover);
        im.alt = '';
        im.onerror = () => { im.remove(); if (card) card.classList.add('no-cover'); };
        wrap.appendChild(im);
      }
    }
  }

  // 轮播第 3 屏：最新一将成名（十周年）公告（与 OL 屏同构，只是换数据源）
  function renderNews10Slide() {
    const it = (X10 && X10.items && X10.items.length) ? X10.items[0] : null;
    const sub = $('news10Sub'), tt = $('news10Title'), mt = $('news10Meta'), wrap = $('news10ImgWrap');
    const card = $('news10Card');
    if (!it) {
      if (sub) sub.textContent = '暂无资讯';
      if (tt) tt.textContent = '（等待同步）';
      if (mt) mt.textContent = '';
      if (card) card.classList.add('no-cover');
      return;
    }
    const n = (X10.items || []).length;
    const dt = String(it.pub || it.date || '').slice(0, 10);
    if (sub) sub.textContent = `一将成名 · 共 ${n} 条` + (dt ? ` · ${dt}` : '');
    const t = String(it.title || '—').trim();
    const stripped = t.replace(/^\s*\d{1,2}[.\-月]\d{1,2}(?:\s*[-~～]\s*\d{1,2}[.\-月]\d{1,2})?\s*/, '');
    if (tt) tt.textContent = stripped || t;
    if (mt) mt.textContent = '';
    if (card) card.classList.toggle('no-cover', !it.cover);
    if (wrap) {
      wrap.innerHTML = '';
      if (it.cover) {
        const im = document.createElement('img');
        im.src = vq(DATA_DIR + 'x10_news/' + it.cover);
        im.alt = '';
        im.onerror = () => { im.remove(); if (card) card.classList.add('no-cover'); };
        wrap.appendChild(im);
      }
    }
  }

  /* ============ 首页「每日武将」= 十周年服务器的女武将横版皮肤 ============
     数据来自 data/sgs/female_skins.json（由 v2/build_sgs_female_skins.py 生成，
     只收 150 位女武将里宽高比 >= 1.05 的横版皮肤，共 558 张）。
     为什么不塞进 characters.json：横竖版必须读图片真实尺寸才知道，前端在渲染前
     拿不到；而且这份清单只有首页用一次，没必要撑大 1.8MB 的主库。 */
  let FEM_SK = null, FEM_SK_P = null;
  function loadFemaleSkins() {
    if (FEM_SK_P) return FEM_SK_P;
    FEM_SK_P = fetch(vq(DATA_DIR + 'sgs/female_skins.json'))
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d && d.items && d.items.length) { FEM_SK = d; renderHome(); }
      })
      .catch(() => {});
    return FEM_SK_P;
  }
  /* ===== 皮肤轮播：15 秒一张（2026-10-17 用户要求改掉「一天一张」） =====
     清单是「按武将分组、组内连续」排的（131 位 / 558 张，单人最多 13 张），
     要是按张顺序往后走，会连着十几次都是同一位武将，看着像卡住了。
     所以游标 k 不按「张」走，按「人」走：
         第 k 次 → 第 (k % 131) 位武将 → 该武将的第 (floor(k/131) + 散列) 张皮肤
     第一圈 131 位各亮一张，第二圈各亮第二张 —— 每 15 秒换人，也不漏皮肤。
     · 首帧落在「今天那张」的游标上；切后台不换，回前台立刻换一张
     · 换图不清空容器：新图淡入、旧图淡出后再移除（硬切会闪一下白）
     · 顺手预取下一张，15 秒的空档足够它进缓存 */
  const DSK_MS = 15000;
  let DSK_IDX = -1, DSK_T = 0, DSK_GS = null;

  function dskGroups() {
    if (DSK_GS) return DSK_GS;
    const pool = FEM_SK && FEM_SK.items;
    if (!pool || !pool.length) return null;
    const map = new Map(), out = [];
    pool.forEach((x) => {
      let g = map.get(x.id);
      if (!g) { g = { id: x.id, n: x.n, f: [] }; map.set(x.id, g); out.push(g); }
      g.f.push(x);
    });
    DSK_GS = out;
    return out;
  }
  /* 稳定散列：让「第二圈」起每个人换个起点，不至于都从自己第 1 张开始 */
  function dskHash(s) {
    let h = 0;
    for (let i = 0; i < String(s).length; i++) h = (h * 31 + String(s).charCodeAt(i)) & 0x7fffffff;
    return h;
  }
  /* 游标 k → 具体一张皮肤 */
  function dskPick(k) {
    const gs = dskGroups();
    if (!gs) return null;
    const G = gs.length;
    const g = gs[((k % G) + G) % G];
    const round = Math.floor(k / G);
    const i = ((round + dskHash(g.id)) % g.f.length + g.f.length) % g.f.length;
    return g.f[i];
  }
  function dskPreload(k) {
    const nx = dskPick(k);
    if (!nx || !nx.f) return;
    const pi = new Image();
    pi.src = imgV(nx.f, 'sgs');
  }
  function dskPaint(instant) {
    const it = dskPick(DSK_IDX);
    if (!it) return false;
    daily = { v: 'sgs', id: it.id, n: it.n, t: it.t || '' };
    $('dailyName').textContent = it.n;
    $('dailyTitle').textContent = it.sn || it.t || '';   // 皮肤名优先（如「战场绝版」），缺名回退称号
    const wrap = $('dailyImgWrap');
    const olds = Array.prototype.slice.call(wrap.querySelectorAll('img'));
    const im = document.createElement('img');
    im.alt = '';
    im.className = 'dsk-in';         // 先透明挂着，插进 DOM 后再出 opacity 才有过渡
    im.onerror = () => { im.remove(); };
    im.src = imgV(it.f, 'sgs');      // 皮肤图直接走路径，不经过 il/av 的拼装
    const put = () => {
      wrap.appendChild(im);
      if (instant) {
        im.classList.remove('dsk-in');
        olds.forEach((o) => o.remove());
        return;
      }
      requestAnimationFrame(() => requestAnimationFrame(() => im.classList.remove('dsk-in')));
      olds.forEach((o) => {
        o.classList.add('dsk-out');
        setTimeout(() => o.remove(), 520);
      });
    };
    if (im.decode) im.decode().then(put).catch(put); else im.onload = put;
    dskPreload(DSK_IDX + 1);
    return true;
  }
  function dskTick() {
    if (!dskGroups()) return;
    if (document.hidden) return;                       // 后台不动
    DSK_IDX += 1;
    dskPaint(false);
  }
  /* 返回 true = 已用横版皮肤渲染；false = 清单还没到位，调用方走兜底
     renderHome 会被反复调用（切版本 / 清单拉回 / 换主题），所以这里：
     游标只在第一次确定，图没变就不重绘，只重置计时器 */
  function renderDailySkin(day) {
    const gs = dskGroups();
    if (!gs) return false;
    if (DSK_IDX < 0) DSK_IDX = day % gs.length;        // 起点仍是「今天那位」
    const it = dskPick(DSK_IDX);
    if (!daily || daily.v !== 'sgs' || daily.id !== it.id || !$('dailyTitle').textContent) dskPaint(true);
    if (DSK_T) clearInterval(DSK_T);
    DSK_T = setInterval(dskTick, DSK_MS);
    return true;
  }
  /* 从后台切回来：立刻换一张（定时器在后台被浏览器节流，不补发） */
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && DSK_IDX >= 0 && $('dailyImgWrap').querySelector('img')) dskTick();
  });

  function renderHome() {
    // 每日武将：按日期确定性选取（本地时区）
    const day = Math.floor((Date.now() - new Date().getTimezoneOffset() * 60000) / 86400000);
    const d = new Date();
    $('dailyDate').textContent =
      `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 · 第 ${String(day).slice(-3)} 期`;
    if (!renderDailySkin(day)) {
      // 清单首次还没拉回来 → 先用当前版本武将占位，拉完 renderHome 会自动重渲染
      loadFemaleSkins();
      const g = GLIST.length ? GLIST[day % GLIST.length] : null;
      if (g) {
        daily = { v: V.id, id: g.id, n: g.n, t: g.t || '' };
        $('dailyName').textContent = g.n;
        $('dailyTitle').textContent = g.t || g.gr || '';
        const wrap = $('dailyImgWrap');
        wrap.innerHTML = '';
        if (!g.ni) {
          const im = document.createElement('img');
          im.src = recIl(g);
          im.alt = '';
          im.onerror = () => { im.remove(); };
          wrap.appendChild(im);
        }
      }
    }
    renderPicks();
    renderNewsSlide();   // 轮播第 2 屏：最新 OL 公告
    renderNews10Slide(); // 轮播第 3 屏：最新一将成名公告
    bxBind();            // 绑定圆点/拖动/自动轮播（幂等）
  }
  function goHeroesFilter(pack) {
    (async () => {
      if (pack && V.id !== 'sgsol') await switchVersion('sgsol');
      if (pack) { state.pack = pack; renderFilters(); render(); }
      go('heroes');
    })();
  }

  /* ============ 登录 / 注册与本地账号（services/localAuth.js） ============
   * 账号体系由 LocalAuthService 提供（localStorage 持久化，浏览器直接跑通）：
   *   sgs_local_users     账号表（用户名/密码摘要/昵称/注册时间/userData）
   *   sgs_current_session 登录会话
   * AuthAPI 退化为「档案读写适配层」：fetchProfile / saveProfile 直接落到
   * 对应账号的 userData（favorites/history/notes/settings），UI 层无需改动。
   * 数据隔离：收藏/历史/心得统一经 sk(...) 落到 "<键>@<userId>" 命名空间。 */
  const viaState = { mode: 'password' }; // 登入方式：password | code
  const NICK_POOL = ['汉寿亭侯', '常山赵子龙', '卧龙先生', '江东小霸王'];
  const AuthAPI = {
    _delay(ms) { return new Promise((r) => setTimeout(r, ms)); },
    async sendCode(account) { await this._delay(400); return { ok: true }; },
    /* 读取该账号档案（原「云端档案」位，现为本地账号 userData） */
    async fetchProfile(session) {
      const S = LAS();
      if (!S || !session || !session.userId) return null;
      return S.getUserData(session.userId);
    },
    /* 写回该账号档案（退出登录、登出前落盘、防抖同步均走这里） */
    async saveProfile(session, profile) {
      const S = LAS();
      if (!S || !session || !session.userId) return { ok: false };
      return S.syncUserData(session.userId, profile);
    }
  };
  const UserStore = {
    user: null,                       // 当前会话 {userId,username,nickname,avatar,token,loginAt}
    isLogin() { return !!this.user; },
    async loginWith(session) {
      this.user = session;
      safeSet(USER_KEY, JSON.stringify(session));   // 兼容旧键（其余逻辑读取同一份会话）
      await mergeCloud();                            // 登录即合并：游客数据 ∪ 该账号档案
      renderAuth();
      refreshAccountUI();
    },
    logout() {
      const s = this.user;
      if (s) { try { AuthAPI.saveProfile(s, cloudProfile()); } catch (e) { /* 忽略 */ } }  // 退出前落盘
      if (LAS()) LAS().logout();                     // 清 session（收藏保留在该账号命名空间里）
      this.user = null;
      try { localStorage.removeItem(USER_KEY); } catch (e) { /* 忽略 */ }
      renderAuth();
      refreshAccountUI();
    }
  };
  function notes() {
    try { return JSON.parse(safeGet(sk('sgs.notes')) || '{}') || {}; } catch (e) { return {}; }
  }
  /* 账号档案结构（与 LocalAuthService.userData 对齐） */
  function cloudProfile() {
    return {
      favorites: favs(),
      history: history(),
      settings: {
        currentVersion: V.id,
        theme: document.documentElement.dataset.theme,
        wifiOnly: safeGet(WIFI_KEY) === '1',
        nickname: UserStore.user ? UserStore.user.nickname : ''
      },
      notes: notes()
    };
  }
  /* 合并策略：收藏/历史并集（本机在前视为最新）；心得本机优先 */
  async function mergeCloud() {
    const s = UserStore.user;
    if (!s) return;
    try {
      const cloud = await AuthAPI.fetchProfile(s);
      if (cloud) {
        const key = (f) => f.v + '|' + f.id;
        const seenF = new Set(favs().map(key));
        const mergedF = (cloud.favorites || []).filter((f) => f && !seenF.has(key(f))).concat(favs());
        safeSet(sk(FAV_KEY), JSON.stringify(mergedF.slice(0, FAV_MAX)));
        const seenH = new Set(history().map(key));
        const mergedH = history().concat((cloud.history || []).filter((h) => h && !seenH.has(key(h))));
        safeSet(sk(HIST_KEY), JSON.stringify(mergedH.slice(0, HIST_MAX)));
      }
      await AuthAPI.saveProfile(s, cloudProfile());  // 合并结果回写账号档案
    } catch (e) { /* 容错：读写异常时保持本地模式 */ }
  }
  let syncT = null;
  function syncSoon() {  // 登录态数据变更后防抖同步（收藏/历史/设置/昵称）
    if (!UserStore.isLogin()) return;
    clearTimeout(syncT);
    syncT = setTimeout(() => {
      const s = UserStore.user;
      if (s) AuthAPI.saveProfile(s, cloudProfile()).catch(() => {});
    }, 800);
  }
  /* 段位称号：按收藏数授予 */
  const RANKS = [[25, '国士无双'], [10, '博通经籍'], [3, '小有所成'], [0, '初出茅庐']];
  function rankName(n) { for (const [min, t] of RANKS) if (n >= min) return t; return '初出茅庐'; }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  /* 登录态渲染联动：我的页头部 + 设置卡账号区 */
  function renderAuth() {
    const u = UserStore.user;
    document.body.dataset.auth = u ? 'user' : 'guest';
    applyName();
    const b = $('pname');
    if (b) b.title = u ? '点击修改昵称' : '点击登录 / 注册';
    const badge = $('rankBadge'), seal = $('loginSeal'), pav = $('pav');
    if (badge) { badge.hidden = !u; if (u) badge.textContent = rankName(favs().length); }
    if (seal) seal.hidden = !!u;
    if (pav) pav.classList.toggle('authed', !!u);
    const lb = $('acctBtn'), ll = $('acctLabel'), lr = $('logoutRow');
    if (lb) lb.textContent = u ? '切换账号' : '登录 / 注册';
    if (ll) ll.innerHTML = u
      ? `本地账号<span class="acct-sub">${esc(u.nickname)} · 数据已存本机</span>`
      : '本地账号<span class="acct-sub">游客数据仅存本机</span>';
    if (lr) lr.hidden = !u;
    renderPstats();
  }

  /* ============ 账号数据隔离联动 ============
   * 登录 / 切换 / 登出后：收藏、历史、统计、详情收藏按钮全部按新作用域重绘；
   * 检视面板打开时同步刷新。 */
  function refreshAccountUI() {
    renderFavs();
    renderPstats();
    renderFavBtn();
    updateLocalDataSub();
    if (GLIST.length) renderHome();                        // 首页收藏快捷入口随账号变化
    const ad = $('admodal');
    if (ad && !ad.hidden) renderAccountPanel();
  }
  /* 设置卡入口副标题：实时显示本机账号数 */
  function updateLocalDataSub() {
    const el = $('localDataSub');
    if (!el) return;
    const S = LAS();
    const n = S ? S.getAllUsers().length : 0;
    const cur = UserStore.user;
    el.innerHTML = `本机 ${n} 个账号${cur ? ' · 当前 ' + esc(cur.nickname) : ' · 游客态'} <i class="darr" aria-hidden="true">›</i>`;
  }
  /* 把当前作用域里的收藏/历史/心得落盘到账号档案（导出、检视、登出前调用） */
  function flushAccountData() {
    const s = UserStore.user;
    if (!s) return;
    try { AuthAPI.saveProfile(s, cloudProfile()); } catch (e) { /* 忽略 */ }
  }

  /* ============ 本地账号与数据管理（检视抽屉） ============ */
  function openAccountPanel() {
    renderAccountPanel();
    $('adm').hidden = false;
    $('admodal').hidden = false;
    document.body.style.overflow = 'hidden';
  }
  function closeAccountPanel() {
    const m = $('admodal'), k = $('adm');
    if (m.hidden) return;
    m.classList.add('closing'); k.classList.add('closing');
    setTimeout(() => {
      m.hidden = true; k.hidden = true;
      m.classList.remove('closing'); k.classList.remove('closing');
      document.body.style.overflow = '';
    }, 170);
  }
  function renderAccountPanel() {
    const S = LAS();
    if (!S) return;
    flushAccountData();                                    // 先落盘，保证收藏数是最新的
    const list = S.getAllUsers();
    const cur = UserStore.user;
    $('adStat').innerHTML =
      `<div class="ad-num"><b>${list.length}</b><span>本机已注册账号</span></div>
       <div class="ad-num"><b>${cur ? esc(cur.nickname) : '游客'}</b><span>当前登录</span></div>`;
    if (!list.length) {
      $('adList').innerHTML = '<p class="ad-empty">本机暂无注册账号 —— 登录弹窗切到【注册】即可新建。</p>';
      return;
    }
    $('adList').innerHTML = `<table class="ad-tb">
      <thead><tr><th>账号名</th><th>昵称</th><th>注册时间</th><th>收藏</th></tr></thead>
      <tbody>${list.map((u) => `<tr${u.isCurrent ? ' class="cur"' : ''}>
        <td class="ad-u">${esc(u.username)}${u.isCurrent ? '<i class="ad-cur">当前</i>' : ''}</td>
        <td>${esc(u.nickname)}</td>
        <td class="ad-t">${esc(u.createdAt)}</td>
        <td class="ad-n">${u.stats.favorites}</td>
      </tr>`).join('')}</tbody></table>`;
  }
  function exportAllData() {
    const S = LAS();
    if (!S) return;
    flushAccountData();
    const r = S.downloadData('sgs_backup.json');
    toast(r.count ? `已导出 ${r.count} 个账号 → sgs_backup.json` : '本机暂无账号，已导出空备份');
  }
  function importBackup(file) {
    const S = LAS();
    if (!S || !file) return;
    const fr = new FileReader();
    fr.onload = () => {
      const r = S.importData(String(fr.result), { mode: 'merge' });
      if (!r.ok) { toast('导入失败：' + r.error); return; }
      // 导入可能新增/更新了当前账号数据：重新合并并刷新界面
      if (UserStore.isLogin()) mergeCloud();
      renderAuth(); refreshAccountUI();
      toast(`导入完成：新增 ${r.added} 个，合并 ${r.updated} 个`);
    };
    fr.onerror = () => toast('读取文件失败');
    fr.readAsText(file, 'utf-8');
  }
  function clearAllAccounts() {
    const S = LAS();
    if (!S) return;
    const n = S.getAllUsers().length;
    if (!n) { toast('本机暂无账号可清空'); return; }
    if (!window.confirm(`确定清空本机 ${n} 个账号吗？\n账号、收藏、历史、心得将一并删除，此操作不可撤销。\n（建议先导出备份）`)) return;
    S.clearAll();
    UserStore.user = null;
    try { localStorage.removeItem(USER_KEY); } catch (e) { /* 忽略 */ }
    renderAuth(); refreshAccountUI();
    toast('已清空本机全部账号，已回到游客态');
  }

  /* ============ 我的页 ============ */
  function renderFavs() {
    const list = favs();
    const row = $('favRow');
    $('favEmpty').hidden = list.length > 0;
    row.innerHTML = list.map((f) => {
      // 完整条目优先（当前版或已缓存的跨版本数据），拿不到再退回中性色
      const arr = generalsOf(f.v);
      const gg = arr ? (arr.find((x) => x.id === f.id) || null) : null;
      const inner = gg && gg.na ? avInitHTML(gg)
        : `<img loading="lazy" src="${recAv(gg, f.v, f.id)}" alt="${f.n}"
          onerror="this.replaceWith(Object.assign(document.createElement('span'),{className:'ph-av-init',textContent:'${nameInitial(f.n)}'}))">`;
      return `<div class="favcard" data-v="${f.v}" data-id="${f.id}" tabindex="0" role="button" aria-label="查看${f.n}">
        <span class="fph" style="--k:${(gg && KC[gg.k]) || '#948a78'}">${inner}</span>
        <span class="fnm">${f.n}<i class="fv">${VN[f.v] || ''}</i></span>
        <button class="fav-x" type="button" data-rm="${f.v}|${f.id}" aria-label="移除收藏${f.n}">✕</button>
      </div>`;
    }).join('');
  }
  function renderPstats() {
    const n = favs().length;
    const h = history().length;
    $('pstats').textContent = `收藏 ${n} 名武将 · 当前浏览 ${V.label} ${GLIST.length} 名`;
    const sf = $('stFav'), sh = $('stHist'), sv = $('stVer');
    if (sf) sf.textContent = String(n);
    if (sh) sh.textContent = String(h);
    if (sv) sv.textContent = V.short || '—';
  }
  /* 我的页分区折叠（分组容器版）：默认收起，点卡头开合，localStorage 记忆 */
  function initSecFolds() {
    let saved = {};
    try { saved = JSON.parse(safeGet(SEC_OPEN_KEY) || '{}') || {}; } catch (e) { saved = {}; }
    for (const sec of document.querySelectorAll('.fold-sec')) {
      const head = sec.querySelector('.ghead');
      const body = sec.querySelector('.sec-body');
      if (!head || !body) continue;
      const key = sec.dataset.sec;
      const setOpen = (on, persist) => {
        sec.classList.toggle('open', on);
        body.classList.toggle('open', on);
        head.setAttribute('aria-expanded', String(on));
        if (persist) { saved[key] = on; safeSet(SEC_OPEN_KEY, JSON.stringify(saved)); }
      };
      setOpen(saved[key] === true, false);
      head.addEventListener('click', (e) => {
        if (e.target.closest('.sccats')) return; // 分类胶囊点击不触发折叠
        setOpen(!body.classList.contains('open'), true);
      });
      head.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpen(!body.classList.contains('open'), true); }
      });
    }
  }

  /* ============ 头像（2026-10-17：用武将立绘当头像） ============
     · 存 localStorage.sgs.profile.avatar = {v:版本, id:武将id, n:武将名, sex}
     · 不设时回落到昵称首字（原行为不变）
     · 数据源 = 当前浏览版本的 GLIST，立绘走 images/<ver>/il/<id>.webp */
  const AV_KEY = 'sgs.profile.avatar';
  function loadAvatar() {
    try { return JSON.parse(safeGet(AV_KEY) || 'null'); } catch (e) { return null; }
  }
  function saveAvatar(o) {
    try { o ? localStorage.setItem(AV_KEY, JSON.stringify(o)) : localStorage.removeItem(AV_KEY); } catch (e) {}
  }

  /* 昵称：游客读 localStorage；登录读 user.nickname（本机账号档案），点击编辑 */
  function applyName() {
    const u = UserStore.user;
    const name = u ? (u.nickname || '无名访客') : ((safeGet(NAME_KEY) || '').trim() || '无名访客');
    const b = $('pname'), av = $('pav');
    if (b) b.textContent = name;
    if (!av) return;
    const a = loadAvatar();
    if (a && a.v && a.id) {
      const key = a.v + '|' + a.id;
      if (av.dataset.avKey !== key) {                 // 防重复重绘（图片会重新下载）
        av.dataset.avKey = key;
        const src = imgV(a.img || rawAsset(a.v, 'il', a.id), a.v);
        av.innerHTML = '<img src="' + src + '" alt="" decoding="async">';
        av.classList.add('has-img');
      }
      av.title = '头像：' + (a.n || '') + '（点击更换）';
    } else {
      av.dataset.avKey = '';
      av.classList.remove('has-img');
      av.textContent = (!u && name === '无名访客') ? '访' : name.slice(0, 1);
      av.title = '点击更换头像';
    }
  }

  /* ---------- 选择头像弹层 ---------- */
  const AV_STATE = { sex: 'female', q: '' };
  function renderAvGrid(sex) {
    const grid = $('avGrid'), tabs = $('avTabs');
    if (!grid) return;
    if (sex) AV_STATE.sex = sex;
    if (tabs) [].forEach.call(tabs.children, (b) => b.classList.toggle('active', b.dataset.sex === AV_STATE.sex));
    const cur = loadAvatar();
    const q = AV_STATE.q.trim();
    const list = (GLIST || []).filter((g) =>
      (AV_STATE.sex === 'female' ? isFemale(g) : !isFemale(g)) && (!q || g.n.indexOf(q) >= 0));
    if (!list.length) {
      grid.innerHTML = '<div class="av-empty">' + (q ? '没有匹配「' + esc(q) + '」的武将' : '这个版本还没有可用的立绘') + '</div>';
      return;
    }
    grid.innerHTML = list.map((g) => {
      const on = (cur && cur.v === V.id && cur.id === g.id) ? ' on' : '';
      const src = imgV(g.img || rawAsset(V.id, 'il', g.id), V.id);
      return '<button class="av-cell' + on + '" type="button" data-id="' + g.id + '">' +
        '<img src="' + src + '" alt="" loading="lazy" decoding="async"><span>' + esc(g.n) + '</span></button>';
    }).join('');
    grid.scrollTop = 0;
  }
  function openAvatar() {
    const mask = $('avmask'), modal = $('avmodal');
    if (!mask || !modal) return;
    const cur = loadAvatar();
    AV_STATE.sex = (cur && cur.sex) || 'female';
    AV_STATE.q = '';
    const qin = $('avQ');
    if (qin) qin.value = '';
    renderAvGrid(AV_STATE.sex);
    mask.hidden = false; modal.hidden = false;
  }
  function closeAvatar() {
    const mask = $('avmask'), modal = $('avmodal');
    if (mask) mask.hidden = true;
    if (modal) modal.hidden = true;
  }
  function initAvatar() {
    const av = $('pav');
    if (av) av.addEventListener('click', openAvatar);
    const mask = $('avmask'), close = $('avclose'), tabs = $('avTabs'), grid = $('avGrid'), qin = $('avQ');
    if (mask) mask.addEventListener('click', closeAvatar);
    if (close) close.addEventListener('click', closeAvatar);
    if (qin) qin.addEventListener('input', () => { AV_STATE.q = qin.value; renderAvGrid(); });
    if (tabs) tabs.addEventListener('click', (e) => {
      const b = e.target.closest('.av-tab');
      if (!b) return;
      const sex = b.dataset.sex;
      if (sex === 'none') {                            // 恢复默认（昵称首字）
        saveAvatar(null);
        applyName();
        closeAvatar();
        toast('已恢复默认头像');
        return;
      }
      renderAvGrid(sex);
    });
    if (grid) grid.addEventListener('click', (e) => {
      const c = e.target.closest('.av-cell');
      if (!c) return;
      const g = GLIST.find((x) => x.id === c.dataset.id);
      if (!g) return;
      saveAvatar({ v: V.id, id: g.id, n: g.n, img: g.img || '', sex: isFemale(g) ? 'female' : 'male' });
      applyName();
      closeAvatar();
      toast('头像已换成 ' + g.n);
    });
  }
  function initNameEdit() {
    applyName();
    initAvatar();
    const b = $('pname');
    if (!b) return;
    b.addEventListener('click', () => {
      if (!UserStore.isLogin()) { openLogin(); return; }  // 游客态：点击唤起登录弹窗（002.md）
      if (b.isContentEditable) return;
      b.contentEditable = 'plaintext-only';
      if (b.isContentEditable !== true) b.contentEditable = 'true';
      b.focus();
      document.execCommand && document.execCommand('selectAll', false, null);
    });
    const save = () => {
      if (!b.isContentEditable) return;
      b.contentEditable = 'false';
      const v = b.textContent.replace(/\s+/g, ' ').trim().slice(0, 12);
      if (UserStore.isLogin()) {  // 登录态：改名并写入本地账号档案
        if (v) UserStore.user.nickname = v;
        safeSet(USER_KEY, JSON.stringify(UserStore.user));
        if (LAS() && v) LAS().updateUser(UserStore.user.userId, { nickname: v });
        applyName();
        renderAuth();
        syncSoon();
        toast(v ? '昵称已保存 · 已写入本机账号' : '昵称未修改');
      } else {
        safeSet(NAME_KEY, v);
        applyName();
        toast(v ? '昵称已保存' : '已恢复默认昵称');
      }
    };
    b.addEventListener('blur', save);
    b.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); b.blur(); }
    });
  }

  /* ============ 详情 ============ */
  /* 标/界 版本行：复刻游戏的「标 | 界」开关外观，但做成「当前高亮 + 另一版可点跳转」。
     游戏里是同一页内切技能，本 app 保持两条独立记录（用户指定），所以点击是跳转而非切换。 */
  function jvRowHTML(g) {
    if (!g.jv) return '';
    const cur = g.jv;
    const std = cur === 'biao';                    // 是否是标版
    const other = cur === 'jie' ? 'biao' : 'jie';
    const otherLabel = other === 'jie' ? '界' : '标';
    const hasOther = !!g.cp;
    const seg = (key, label) => {
      const on = key === cur;
      const cls = 'jv-seg' + (on ? ' on' : '') + (on ? '' : (hasOther ? ' link' : ' dim'));
      const attrs = on || !hasOther ? '' : ` role="button" tabindex="0" data-jump="${g.cp}"`;
      const tip = on ? '当前查看' : (hasOther ? `查看${label}版` : `本版无对应${label}版`);
      return `<span class="${cls}" title="${tip}"${attrs}>${label}</span>`;
    };
    const note = std
      ? '标准版技能'
      : '界限突破技能（与标准版不同）';
    return `<div class="d-jvrow">
      <span class="jv-switch">${seg('biao', '标')}${seg('jie', '界')}</span>
      <span class="jv-note">${note}${hasOther ? '' : '　·　无对应版本'}</span>
    </div>`;
  }
  function detailHTML(g) {
    const pips = hpPips(g.hp);
    /* 跨版本打开时标一下数据出处：同名武将各版技能文本不同，不标会误读成当前版本 */
    const dv = itemVer(g);
    const verChip = dv !== V.id ? `<span class="d-ver">${VN[dv] || dv}</span>` : '';
    /* 未上线标记：加强/前瞻内容尚未实装，详情页标题旁也标一下（与卡片徽章同源） */
    const relChip = (g.rel && g.rel !== 'released') ? `<span class="d-rel">待上线</span>` : '';
    let h = `<div class="d-head">
      ${imgTag(g)}
      <div>
        <h2 class="d-name">${g.n}${verChip}${relChip}</h2>
        ${g.t ? `<div class="d-title">${g.t}</div>` : ''}
        ${jvRowHTML(g)}
        <div class="d-rows">
          势力：<b style="color:${KC[g.k] || 'currentColor'}">${KN[g.k] || g.k || '—'}</b>${Number(g.hp) ? `　体力：${pips} ${hpText(g)}` : ''}<br>
          扩展包：<b>${g.gr}</b>${g.lv ? `　品质：<b>${g.lv}</b>` : ''}${g.g ? `　性别：<b>${g.g === 'male' ? '男' : '女'}</b>` : ''}
        </div>
        <div class="d-tags">
          ${((g.tg && g.tg.roles) || []).map((t) => `<span class="tag">${t}</span>`).join('')}
          ${((g.tg && g.tg.pros) || []).map((t) => `<span class="tag p">${t}</span>`).join('')}
          ${((g.tg && g.tg.cons) || []).map((t) => `<span class="tag c">${t}</span>`).join('')}
        </div>
      </div></div>`;

    /* 待上线说明：徽章只有 4 个字，手机上没有 title 悬浮，补一句正文说清含义 */
    if (g.rel && g.rel !== 'released') {
      h += `<div class="note rel-note">本页包含尚未在游戏内上线的改动，最终数值以官方实装为准。</div>`;
    }

    /* OL 版武将特点并入下方「武将攻略」区块，顶部不再重复一行小字 */
    if (g.ft && dv !== 'sgsol') h += `<div class="note">武将特点：${g.ft}</div>`;
    /* 移动版 / 国际服 / 小程序（官方拆包数据）：关键牌 + 适配身份/胜率。
       ★ 小程序 wr 是自带 % 的复合串（"5人场 38% ｜ 主公 1% ｜ 农民 39%"），
         且没有 fit 字段 —— 不套「适配身份：—」的壳，直接出「官方胜率」；尾 % 只给纯数字的 msgs/gjf 加。 */
    if ((dv === 'msgs' || dv === 'gjf') && g.kc) h += `<div class="note">关键牌：${g.kc}</div>`;
    if ((dv === 'msgs' || dv === 'gjf' || dv === 'wxmini') && (g.fit || g.wr)) {
      if (dv === 'wxmini' && !g.fit) h += `<div class="note">官方胜率：${g.wr}</div>`;
      else h += `<div class="note">适配身份：${g.fit || '—'}${g.wr ? `　官方胜率：${g.wr}%` : ''}</div>`;
    }
    /* 国际服：官方「打法思路」（CharacterData.SpellUsage） */
    if (dv === 'gjf' && g.su) {
      h += `<div class="sect"><h3>打法思路</h3><div class="prose">${g.su.replace(/\n/g, '<br>')}</div></div>`;
    }

    if (g.ab && g.ab.some((v) => v !== null && v !== undefined)) {
      const ABL = ['攻击', '防御', '辅助'];
      h += `<div class="sect"><h3>能力三维</h3>` + g.ab.map((v, i) => {
        const n = Math.max(0, Math.min(100, Number(v) || 0));
        return `<div class="abar"><span class="an">${ABL[i]}</span>` +
          `<span class="at"><i style="width:${n}%"></i></span><span class="av">${n}</span></div>`;
      }).join('') + '</div>';
    }

    if (g.s && g.s.length) {
      h += `<div class="sect"><h3>武将技能<small>共 ${g.s.length} 个</small></h3>` +
        g.s.map((s) => {
          const k = KIND[s.type] || ['技能', 'k-passive'];
          return `<div class="skill">
            <div class="s-top"><span class="s-nm">${s.name}</span><span class="kind ${k[1]}">${k[0]}</span></div>
            ${s.oneSentenceDesc ? `<div class="s-one">${s.oneSentenceDesc}</div>` : ''}
            <div class="s-org">${s.description || '（原文缺失）'}</div>
          </div>`;
        }).join('') + '</div>';
    }

    /* 武将攻略：官方评分星级 + 定位 + 技能 FAQ（07 武将资料拆包产出，仅十周年有） */
    if (g.gd && (g.gd.pos || g.gd.score || (g.gd.faq || []).length)) {
      const gd = g.gd;
      const faq = gd.faq || [];
      const star = Math.max(0, Math.min(5, Number(gd.star) || 0));
      h += `<div class="sect"><h3>武将攻略</h3>`;
      if (gd.score || star) {
        h += '<div class="gd-rate">' +
          (gd.score ? `<span class="gd-score">${gd.score}<small>/100</small></span>` : '') +
          (star ? `<span class="gd-star" aria-label="官方星级 ${star} 星">${'★'.repeat(star)}${'☆'.repeat(5 - star)}</span>` : '') +
          '</div>';
      }
      /* pos 与顶部「武将特点」同源，相同时不重复铺一遍 */
      if (gd.pos && gd.pos !== g.ft) h += `<div class="prose">${gd.pos}</div>`;
      if (faq.length) {
        h += `<details class="faq"><summary>技能 FAQ<small>${faq.length} 条</small></summary>` +
          faq.map((it) => `<div class="faq-item"><div class="fq">${it.q}</div><div class="fa">${it.a}</div></div>`).join('') +
          '</details>';
      }
      h += '</div>';
    }

    /* OL 版武将攻略：官方 RolePoint 文本 + 官方人物关系（无评分/FAQ，OL 官方数据只有这些） */
    if (dv === 'sgsol' && (g.ft || ((g.fr || []).length))) {
      h += `<div class="sect"><h3>武将攻略</h3>`;
      if (g.ft) h += `<div class="prose">${g.ft}</div>`;
      if ((g.fr || []).length) h += `<div class="note">人物关系：${g.fr.join('、')}</div>`;
      h += '</div>';
    }

    /* 台词播放按钮开关（按运行环境自动判定，勿写死）——
       ✔ 本地开发包（电脑 localhost / 局域网 IP / file://）：语音资源就在
         images/{sgsol|msgs}/voice/ 下（889M），显示 ▶ 可播；
       ✘ 纯本地 App（App 内 WebView，域名 appassets.androidplatform.net）：
         为控体积未打包语音（voice 目录已移出），不显示 ▶；
       ✘ 线上站（*.workbuddy.host / *.workbuddy.cn）：语音未随站发布，不显示 ▶。
       将来要把语音打进 App：把 voice 目录加回装配清单，并删掉下面的
       appassets 判定即可。 */
    const _vh = location.hostname;
    const VOICE_ENABLED = location.protocol === 'file:'
      || /^(localhost|127\.0\.0\.1|\[::1\]|::1)$/i.test(_vh)
      || /^(10\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[01])\.)/.test(_vh);
    const qk = Object.keys(g.q || {});
    const olv = ((dv === 'sgsol' || dv === 'msgs') && (g.olv || []).length) ? g.olv : null;
    if (olv) {
      /* OL/移动版 官方台词+语音：按皮肤语音组分组，▶ 播该技能全部语音
         （sgsol → images/sgsol/voice/*.ogg；msgs → images/msgs/voice/*.mp3） */
      const VBASE = dv === 'sgsol' ? 'images/sgsol/voice/' : 'images/msgs/voice/';
      const VEXT = dv === 'sgsol' ? '.ogg' : '.mp3';
      h += `<div class="sect"><h3>武将台词</h3>` + olv.map((grp) => {
        const body = (grp.items || []).map((it) => {
          const urls = (it.au || []).filter(Boolean).map((u) => VBASE + u + VEXT);
          const btn = (VOICE_ENABLED && urls.length) ? `<button class="vbtn" data-voices="${urls.join('|')}" aria-label="播放${it.k}语音">▶</button>` : '';
          return `<div class="quote"><div class="qn">${it.k}${btn}</div><div class="qt">` +
            (it.lines || []).map((l) => `「${l}」`).join('') + '</div></div>';
        }).join('');
        return `<div class="olv-g">${grp.grp}</div>` + body;
      }).join('') + '</div>';
    } else if (qk.length) {
      /* 台词来源（g.qs）不在页面平铺（硬规则）：统一归入免责声明弹窗 */
      h += `<div class="sect"><h3>武将台词</h3>` + qk.map((k) => {
        const vs = ((g.vo && g.vo[k]) || []).filter((u) => /^https?:/i.test(u));
        const btn = (VOICE_ENABLED && vs.length) ? `<button class="vbtn" data-voices="${vs.join('|')}" aria-label="播放${k}语音">▶</button>` : '';
        return `<div class="quote"><div class="qn">${k}${btn}</div><div class="qt">` +
          g.q[k].split('/').filter(Boolean).map((l) => `「${l}」`).join('') + '</div></div>';
      }).join('') + '</div>';
    } else {
      h += `<div class="sect"><h3>武将台词</h3><div class="note">该武将暂未收录台词</div></div>`;
    }

    /* OL 官方战功诗（x 字段，#### 拆两句） */
    if (dv === 'sgsol' && (g.gw || []).length) {
      h += `<div class="sect"><h3>武将战功</h3>` +
        `<div class="quote"><div class="qn">战功诗</div><div class="qt">` +
        g.gw.map((l) => `「${l}」`).join('') + '</div></div></div>';
    }

    if (g.bio) h += `<div class="sect"><h3>武将生平</h3><div class="prose">${g.bio}</div></div>`;

    /* OL/移动版/国际服 皮肤带官方名称 + 画师（skn 与 sk 一一对应，索引不破坏大图查看器）
       国际服的皮肤来自拆包 skin.lua（chrList 展开：一张皮肤挂在它的所有武将版本上），
       结构与 OL 完全同构 → 共用同一套渲染与大图查看器 */
    const sknList = g.skn || [];
    const skImgList = g.sk || [];
    if ((dv === 'sgsol' || dv === 'msgs' || dv === 'gjf') && sknList.length) {
      /* 有名称就当皮肤区存在：全量版 skImgList 有图，照旧出图；
         轻量版装配期清空了 sk 只剩 skn → 出「只有名字」的文字格，点开进查看器翻名字。 */
      h += `<div class="sect"><div class="sk-head"><h3>皮肤<small>共 ${sknList.length} 张</small></h3>` +
        `<span class="sk-hint">${skImgList.length ? '左右滑动 · 点击看大图' : '轻量版仅列皮肤名'}</span></div><div class="skins">` +
        sknList.map((s, i) => skImgList.length
          ? `<figure class="skfig"><img loading="lazy" src="${imgV(s.img, dv)}" alt="${g.n}·${s.n}" data-ski="${i}" onerror="this.closest('figure').remove()">` +
            `<figcaption>${s.n || ''}${s.painter ? `<small>${s.painter}</small>` : ''}</figcaption></figure>`
          : `<figure class="skfig no-img" data-ski="${i}"><figcaption>${s.n || ''}</figcaption></figure>`
        ).join('') +
        '</div></div>';
    } else if (skImgList.length) {
      h += `<div class="sect"><div class="sk-head"><h3>皮肤<small>共 ${skImgList.length} 张</small></h3>` +
        `<span class="sk-hint">左右滑动 · 点击看大图</span></div><div class="skins">` +
        skImgList.map((u, i) => `<img loading="lazy" src="${imgV(u, dv)}" alt="${g.n}皮肤${i + 1}" data-ski="${i}"
          onerror="this.remove()">`).join('') +
        '</div></div>';
    }
    if ((g.ot || []).length) h += `<div class="note">官方定位标签：${g.ot.join('、')}</div>`;
    return h;
  }

  /* open(id, ver)：ver 缺省=当前浏览版本（原路径完全同步，行为不变）；
     指定他版时按需拉取那版数据后原地打开详情 —— 不切版本 Tab，页面停在搜索结果上。 */
  function open(id, ver) {
    const v = ver || V.id;
    const gs = generalsOf(v);
    if (!gs) {
      ensureVersionData(v)
        .then(() => open(id, v))
        .catch(() => toast('该版本数据载入失败，请检查网络'));
      return;
    }
    const g = gs.find((x) => x.id === id);
    if (!g) { toast('该版本未收录此武将'); return; }
    currentDetail = { v, id };
    pushHistory(g, v);
    $('sheetBody').innerHTML = detailHTML(g);
    renderFavBtn();
    sheetTab = document.body.dataset.tab || 'heroes';   // 记住从哪个 Tab 点开的（底部切换后回来能原样恢复）
    sheetScroll = 0;
    $('sheet').hidden = false;
    $('mask').hidden = false;
    $('sheet').scrollTop = 0;
    document.body.style.overflow = 'hidden';
    renderPstats();
  }
  function close() {
    $('sheet').hidden = true;
    $('mask').hidden = true;
    currentDetail = null;
    sheetTab = null;                                    // 真正关闭：归属关系一并清掉
    sheetScroll = 0;
    document.body.style.overflow = '';
  }
  /* 详情页与底部 Tab 的关系（2026-10-14 用户报的「详情页压住我的/首页」）：
     底栏 z-index(50) 高于详情遮罩(30)，所以详情开着时底栏照样可点 —— 点了会切页面，
     但详情浮层一直盖在上面。这里改为：切走的 Tab ≠ 详情归属 Tab 时「挂起」（只隐藏，
     不销毁内容/不丢滚动位置），回到归属 Tab 再原样恢复；真正关闭仍只由 ✕/遮罩/下滑/Esc 触发。 */
  function syncSheetTab(tab) {
    if (!sheetTab) return;
    if (tab === sheetTab) {
      if ($('sheet').hidden) {                          // 回到归属 Tab：恢复
        $('sheet').hidden = false;
        $('mask').hidden = false;
        $('sheet').scrollTop = sheetScroll;
        document.body.style.overflow = 'hidden';
      }
    } else if (!$('sheet').hidden) {                    // 切到别的 Tab：挂起（保留 currentDetail 与内容）
      sheetScroll = $('sheet').scrollTop;
      $('sheet').hidden = true;
      $('mask').hidden = true;
      document.body.style.overflow = '';
    }
  }
  /* ============ 皮肤全屏查看器 ============ */
  let skList = [], skIdx = 0, skHero = '', skNames = [];
  function renderSkin() {
    const im = $('skImg');
    /* 说明条只输出「武将名 · 序号 / 总数 · 《皮肤名》」。
       刻意不再渲染 skn[].tn：该字段在移动版里装的是「武将生平」（332/1402 张），
       渲染出来就是皮肤查看器里冒出武将生平（2026-10-14 用户报的 bug）。
       OL 侧它本是皮肤台词/插图说明（仅 14/2116 张），样式 .skview .sk-tn 仍保留备用。 */
    const g = detailHero();
    const skn = (g && (g.skn || [])[skIdx]) || null;
    /* 轻量版分支：没有皮肤图（装配期已剔除各库 sk 目录），只翻名字。
       隐藏 <img>，把说明条换成「第 n / 共 m 张 · 《皮肤名》」，并提示未内置图。 */
    if (!skList.length) {
      const total = skNames.length;
      im.onerror = null;
      im.removeAttribute('src');
      im.alt = '';
      $('skview').classList.add('no-img');
      /* 排成一张居中的「皮肤名片」：大号皮肤名 + 武将/序号 + 一行说明。
         不直接丢一行小字，否则满屏深色里只有一句话，看着像加载失败。 */
      $('skCap').innerHTML =
        (skn && skn.n ? `<b class="sk-lite-name">《${skn.n}》</b>` : '') +
        `<span class="sk-lite-sub">${skHero} · ${skIdx + 1} / ${total}</span>` +
        '<span class="sk-lite-tag">轻量版未内置皮肤图</span>';
      $('skPrev').disabled = total < 2;
      $('skNext').disabled = total < 2;
      return;
    }
    $('skview').classList.remove('no-img');
    im.onerror = () => { $('skCap').textContent = '该皮肤图片暂缺'; im.removeAttribute('src'); };
    im.src = skList[skIdx];
    im.alt = `${skHero}皮肤 ${skIdx + 1}${skn && skn.n ? `·${skn.n}` : ''}`;
    $('skCap').innerHTML = `${skHero} · ${skIdx + 1} / ${skList.length}${skn && skn.n ? ` · 《${skn.n}》` : ''}`;
    $('skPrev').disabled = skList.length < 2;
    $('skNext').disabled = skList.length < 2;
  }
  function openSkins(startIdx) {
    const g = detailHero();
    /* 全量版：g.sk 有图，行为与原先完全一致。
       轻量版：装配期把 g.sk 清空、保留 g.skn 的名称 → 这里允许「只有名字没有图」也能打开，
       查看器降级成翻皮肤名（见 renderSkin 里 skList 为空的分支）。 */
    const hasImg = !!(g && g.sk && g.sk.length);
    const hasName = !!(g && g.skn && g.skn.length);
    if (!g || (!hasImg && !hasName)) return;
    skList = hasImg ? g.sk.map((u) => imgV(u, itemVer(g))) : [];
    skNames = hasName ? g.skn.map((x) => x.n || '') : [];
    const total = skList.length || skNames.length;
    skIdx = Math.min(Math.max(0, startIdx || 0), total - 1);
    skHero = g.n;
    renderSkin();
    $('skview').hidden = false;
  }
  function closeSkins() { $('skview').hidden = true; }
  function skinStep(d) {
    if (skList.length < 2) return;
    skIdx = (skIdx + d + skList.length) % skList.length;
    renderSkin();
  }

  function shareCard() {
    if (!currentDetail) return;
    const g = detailHero();
    if (!g) return;
    const skills = (g.s || []).map((s) => s.name).join('、');
    const text = `【${g.n} · ${g.t || ''}】${KN[g.k] || ''}势力 · ${g.gr} · 技能：${skills}（来自 三分归晋·武将速查）`;
    const done = () => toast('武将卡已复制到剪贴板');
    if (navigator.share) {
      navigator.share({ title: g.n, text }).catch(() => {});
    } else if (navigator.clipboard) {
      navigator.clipboard.writeText(text).then(done, () => toast('复制失败'));
    } else { toast('当前环境不支持分享'); }
  }

  /* ============ 右侧索引条（up/003 一.3；up/010 起带游戏序号的版本改成分组跳转） ============ */
  /* 分组跳转条的短标签：≤2 字照用；「SP1/国1/袖余/君主/其他」这类 3-4 字且以数字收尾的短名照用；
     「一将成名2011」取年份后两位；其余取前 2 字 */
  function shortLamp(s) {
    s = String(s || '');
    if (s.length <= 2) return s;
    if (s.length <= 4 && /\d$/.test(s)) return s;
    const m = s.match(/(\d{4})$/);
    if (m) return m[1].slice(2);
    return s.slice(0, 2);
  }
  /* 条目在「指定包」里是否属于小灯 sub：聚合型包（移动版国战/稀有专属/1V1）同一条目在不同包里
     属于不同小灯，数据里 pk[包] = {o:包内序, s:主小灯, sl?:[多灯]（如 824 同时在老友季与稀有）}；
     没有 pk 的旧版本数据回退到全局 sp —— 行为完全不变 */
  function inSub(g, sub, packId) {
    const p = packId || state.pack;
    const e = (g.pk && p && g.pk[p]) || null;
    if (e) return e.sl ? e.sl.indexOf(sub) >= 0 : e.s === sub;
    return g.sp === sub;
  }
  /* 排序键：选中包时按「该包内序」，否则按全局游戏内序号（未选包/其它版本行为不变） */
  function ordKey(g) {
    const p = state.pack;
    if (p && g.pk && g.pk[p]) return g.pk[p].o;
    // 无游戏内序号的条目（未入收集树）排末尾：ord 缺省或为 null 都按 1e9 算
    // （写 null 不兜底会被 `null - n` 当 0 排到最前，2026-10-14 国际服踩过）
    return (g.ord === undefined || g.ord === null) ? 1e9 : g.ord;
  }
  /* 游戏顺序下的跳转分组：未选包 → 9 个大包；选中包且有二级小灯 → 该包的小灯。
     小灯过多（群英荟萃 37 个）就不出条，交给二级标签行。 */
  /* 返回：null = 用 A-Z（非游戏顺序版本）；[] = 不出条；非空 = 分组跳转 */
  function jumpGroups() {
    if (!HAS_ORD) return null;
    if (state.sub) return [];             // 已选小灯：当前视图里没有可跳的其它小灯
    const out = [];
    if (state.pack) {
      const p = PACKS.find((x) => x.id === state.pack);
      const kids = (p && p.children) || [];
      if (!kids.length || kids.length > 16) return null;   // 小灯过多（群英荟萃 37）→ 退回 A-Z
      for (const c of kids) {
        const i = VG.items.findIndex((g) => inSub(g, c.id, state.pack));
        if (i >= 0) out.push({ label: shortLamp(c.label), i });
      }
    } else {
      for (const p of PACKS) {
        const i = VG.items.findIndex((g) => g.p === p.id);
        if (i >= 0) out.push({ label: shortLamp(p.label), i });
      }
    }
    return out.length > 1 ? out : [];
  }
  function renderPybar() {
    const bar = $('pybar');
    // 搜索态不出索引条：结果按相关度排，跨版本条目也没有分组
    // 「最新更新」同理：10 位来自不同库，首字母/包分组都只对当前版本成立，出来就是错的
    const show = document.body.dataset.tab === 'heroes' && !state.q.trim() && !state.newOnly && VG.items.length > 8;
    const grp = show ? jumpGroups() : null;
    if (!show || (grp && !grp.length)) {
      bar.hidden = true; bar._grp = null; return;   // 隐藏时清掉分组，避免残留下标被误用
    }
    bar.hidden = false;
    bar._grp = (grp && grp.length) ? grp : null;
    bar.classList.toggle('group', !!bar._grp);
    bar.innerHTML = bar._grp
      ? bar._grp.map((x, i) => `<b data-jd="${i}">${esc(x.label)}</b>`).join('')
      : AZ.map((L) => `<b data-l="${L}">${L}</b>`).join('');
  }
  function scrollToItem(idx, tip) {
    if (idx < 0) return;
    const row = Math.floor(idx / VG.cols);
    const y = window.scrollY + $('grid').getBoundingClientRect().top + VG.pt + row * VG.rowH - 130;
    window.scrollTo(0, Math.max(0, y));
    showPyTip(tip);
  }
  function pyJumpIdx(i) {
    const bar = $('pybar'), g = bar._grp && bar._grp[i];
    if (g) scrollToItem(g.i, g.label);
  }
  function pyJump(L) {
    scrollToItem(VG.items.findIndex((g) => (PYINI.get(g.id) || 'Z') === L), L);
  }
  function showPyTip(L) {
    const t = $('pyTip');
    t.textContent = L;
    t.classList.add('show');
    clearTimeout(pyTipT);
    pyTipT = setTimeout(() => t.classList.remove('show'), 620);
  }
  function updatePyHighlight() {
    const bar = $('pybar');
    if (bar.hidden || !VG.items.length) return;
    const rect = $('grid').getBoundingClientRect();
    const top = Math.max(0, Math.floor((Math.max(0, -rect.top + 140) - VG.pt) / VG.rowH)) * VG.cols;
    if (bar._grp) {
      let cur = -1;
      bar._grp.forEach((x, i) => { if (x.i <= top) cur = i; });
      for (const b of bar.children) b.classList.toggle('on', Number(b.dataset.jd) === cur);
      return;
    }
    const g = VG.items[top];
    const L = g ? (PYINI.get(g.id) || '') : '';
    for (const b of bar.children) b.classList.toggle('on', b.dataset.l === L);
  }
  function initPybar() {
    const bar = $('pybar');
    const hitAt = (x, y) => {
      const el = document.elementFromPoint(x, y);
      return (el && el.dataset) ? { l: el.dataset.l, jd: el.dataset.jd } : null;
    };
    const move = (e) => {
      const t = e.touches[0], h = hitAt(t.clientX, t.clientY);
      if (!h) return;
      if (h.jd !== undefined) pyJumpIdx(Number(h.jd));
      else if (h.l) pyJump(h.l);
      else return;
      e.preventDefault();
    };
    bar.addEventListener('touchstart', move, { passive: false });
    bar.addEventListener('touchmove', move, { passive: false });
    bar.addEventListener('click', (e) => {
      const j = e.target.closest('[data-jd]');
      if (j) { pyJumpIdx(Number(j.dataset.jd)); return; }
      const b = e.target.closest('[data-l]');
      if (b) pyJump(b.dataset.l);
    });
  }

  /* ============ TabBar 朱砂墨点吸附（up/003 三.2） ============ */
  function placeTabDot() {
    const dot = $('tabDot'), act = document.querySelector('.tabbar .tab.active');
    if (!dot) return;
    if (!act) { dot.style.opacity = '0'; return; }   // 牌库/资讯等无 Tab 页：墨点隐藏，避免残留在旧位置
    dot.style.opacity = '';
    const tb = document.querySelector('.tabbar').getBoundingClientRect();
    const ab = act.getBoundingClientRect();
    const w = Math.min(26, ab.width * 0.32);
    dot.style.width = w + 'px';
    dot.style.transform = `translateX(${(ab.left + ab.width / 2 - tb.left - w / 2).toFixed(1)}px)`;
  }

  /* ============ 收藏 · 宣纸横幅（up/003 二.3） ============ */
  function showFavBanner(text) {
    const b = $('favBanner');
    $('favBannerText').textContent = text;
    b.classList.add('show');
    clearTimeout(favBT);
    favBT = setTimeout(() => b.classList.remove('show'), 1500);
  }

  /* ============ 详情弹窗手势（up/003 二.2）
   * 纵轴：顶部向下拖拽 → 跟手位移（阻尼递减）+ 遮罩透明度联动，超阈值甩下关闭，否则回弹。
   * 与内容滚动共存：仅 scrollTop≤0 时进入拖拽。
   * 横轴：左右轻滑切换相邻武将已按用户要求取消（2026-10-12）。 ============ */
  function initSheetGestures() {
    const sheet = $('sheet'), mask = $('mask');
    let dragging = false;
    onGesture(sheet, {
      onMove({ dy, axis, ev }) {
        if (!currentDetail) return;
        if (axis === 'y' && sheet.scrollTop <= 0 && dy > 0) {
          dragging = true;
          ev.preventDefault();
          sheet.classList.add('gdrag');
          const damp = 1 - Math.min(dy / 640, 0.55);  // 越拉越涩的回弹阻尼
          sheet.style.transform = `translate(-50%, ${(dy * damp).toFixed(1)}px)`;
          mask.style.opacity = String(Math.max(0.12, 0.46 - dy / 520));
        }
      },
      onEnd({ dy, fast }) {
        if (dragging) {
          sheet.classList.remove('gdrag');
          sheet.classList.add('gspring');
          sheet.style.transform = '';
          mask.style.opacity = '';
          setTimeout(() => sheet.classList.remove('gspring'), 280);
          if (dy > 110 || (fast && dy > 60)) close();
        }
        dragging = false;
      }
    });
  }

  /* ============ 版本百科（科普面板「全版本区分」的唯一版本数据源） ============
     ★ 加新版本只改这一张表 —— 往 KEPU_VERS 加一条，面板里的版本枚举、名单、
       计数、入坑建议、以及最后的「本图鉴收录对账」全部自动跟上，不用再翻改文案。
     字段：
       id        与 data/index.json 的 versions[].id 对齐（对账用，必须一致）
       name      全称             aka      别名
       blurb     四字卖点（拼副标题用）
       plat      平台与互通       platNote 互通的补充（可空）
       play      玩法与定位       pay      氪金 / 平民友好度
       art       画风与 UI        advice   入坑建议
       adviceTip 建议的补充提醒（可空）
     ⚠ 文案里**不要写死版本个数**（别出现「四／五大」这类计数），一律用 KEPU_VERS.length 现算；
       也不要用相对说法（如「另外 N 款」），改成「各版本 / 其余版本」，加版本才不用回改。
     图鉴里存在但不属于「独立游戏版本」的条目（未实装等）由 KEPU_NONVER 排除。 */
  const KEPU_NONVER = ['unreleased'];
  const KEPU_VERS = [
    { id: 'sgsol', name: '三国杀OL', aka: '老杀 / 经典服', blurb: 'OL复古休闲',
      plat: 'PC 网页端 + OL 互通版 App，<b>双端数据互通</b>',
      platNote: '各版本中唯一官方互通的',
      play: '氛围平和，主打<b>国战休闲</b>；武将多为"进回合才发挥"的传统节奏，经典味最浓',
      pay: '主打国战休闲、传统节奏，属于"慢热但稳"的那类',
      art: '画风复古经典 + 传统 UI，<b>立绘未和谐</b>——老玩家的"白月光"',
      advice: '想找经典味 / 常驻 PC 端 / 爱打国战休闲' },
    { id: 'msgs', name: '手机三国杀', aka: '手杀 / 移动版', blurb: '手杀快节奏',
      plat: '纯手机端（App / 渠道服），<b>独立服务器</b>',
      platNote: '渠道服与官服之间也不互通',
      play: '<b>移动端主力</b>，主打<b>斗地主与军八</b>，追求<b>快节奏对抗</b>',
      pay: '<b>氪金点密集，白嫖体验艰难</b>——各版本里对平民最"劝退"的一档',
      art: '界面与 OL 互通版（重制版）同源风格，为移动端快节奏对抗优化',
      advice: '主力用手机玩 / 就爱斗地主、军八的快节奏 PVP',
      adviceTip: '做好氪金心理准备，或接受白嫖慢节奏' },
    { id: 'sgs', name: '三国杀：一将成名', aka: '新杀 / 十周年', blurb: '新杀玩法多',
      plat: '网页、Android、iOS 三端，<b>独立服务器</b>',
      platNote: '',
      play: '<b>玩法最丰富</b>，主打大量 <b>PVE</b>、<b>自走棋</b>、<b>肉鸽闯关</b>等内容',
      pay: '<b>对新手友好，低氪即可获取大量武将</b>，入坑门槛最低；代价是<b>强度膨胀快</b>——今天的新武将，可能就是明天的"时代眼泪"',
      art: '<b>新国风美术</b>，视觉表现最"新"，立绘与整体包装最贴近当下审美',
      advice: '纯新手入坑 / 喜欢 PVE、自走棋、肉鸽闯关 / 想低氪攒武将',
      adviceTip: '接受强度膨胀快的现实' },
    { id: 'hlsgs', name: '欢乐三国杀', aka: '欢杀 / 宝宝杀', blurb: '欢杀Q版养猫',
      plat: '纯手机端（App / 小程序），<b>独立服务器</b>',
      platNote: '',
      play: '<b>轻量化休闲</b>，特色是<b>模拟经营</b>（<b>家园养猫</b>等）；武将强度整体偏高，更偏"收集与养成的爽感"',
      pay: '走休闲养成路线，乐趣在<b>家园模拟经营</b>；注意其<b>武将数值天花板是各版本里最高的</b>',
      art: '<b>Q 版可爱画风</b>，萌系休闲路线，和其余版本"一眼就能区分"',
      advice: '只想轻松挂机休闲 / 爱模拟经营、家园养猫 / 吃 Q 版画风',
      adviceTip: '接受玩家群体较小的现状' },
    { id: 'gjf', name: '三国杀国际服', aka: '繁中版 / 台服', blurb: '国际服繁中独占',
      plat: '纯手机端（面向港澳台及海外），<b>独立服务器</b>',
      platNote: '由台湾代理商<b>独立运营</b>（官网 sanguosha.com.tw），<b>与国服数据完全不互通</b>；界面为繁体中文，客户端可切英文 / 日文',
      play: '身份局 + <b>2V2 排位</b>（月赛季）为主；独占<b>「萌鬼敲门」</b>（塔防 + 非对称竞技）、<b>「太虚幻境」</b>（PVE 闯关）、1V1 龙争虎斗；<b>支持单机模式</b>（不联网也能打）',
      pay: '独立运营，活动与卡池节奏自成一套，不与国服同步',
      art: '<b>国风写实</b>立绘 + 繁体界面，支持<b>动态造型</b>与皮肤切换；有独占卡面（如全新插画的 <b>SP 袁术</b>）与专属武将（<b>侠刘备、侠夏侯惇、侠徐庶</b>等「武侠篇」）',
      advice: '港澳台 / 海外玩家 / 想要繁体界面 / 喜欢收藏独占 SP 卡与专属武将',
      adviceTip: '国服玩家需另装客户端、跨区登录' },
    { id: 'wxmini', name: '三国杀小程序', aka: '微信小程序版', blurb: '微信点开即玩',
      plat: '微信小程序（微信内直接搜索即玩），<b>独立服务器</b>',
      platNote: '无需下载 App，微信里点开就玩；数据与各版本完全不互通',
      play: '主<b>身份场 / 斗地主 / 2v2 / PVE</b>（年兽、活动关卡）；<b>没有传统主公技</b>——主公技是它自己的一套机制（每轮开始时选一名角色生效）',
      pay: '按 <b>8 个系列</b>（志 / 极 / 万象 / 界限 / 限定 / 神话 / 一将 / 标准）收集武将，招募 / 活动 / 将魂合成并行',
      art: '立绘与各版本同源但走<b>轻量压缩</b>，界面为小程序原生风格，点开即玩、几乎不占存储',
      advice: '想微信里点开就玩 / 拉朋友开黑最省事 / 设备跑不动 App',
      adviceTip: '技能措辞是官方精简改写版，与其它版本不一致；对账以本库收录的原文为准' }
  ];

  /* 版本名单渲染：每个版本生成一句 <li>，各节共用 */
  const verLis = (fn) => KEPU_VERS.map((v) => `<li>${fn(v)}</li>`).join('');
  const VER_N = KEPU_VERS.length;

  /* ============ 历史科普弹窗（KepuModal · 数据驱动，加选题往 KEPU_TOPICS 加一项即可） ============
     ★ 每个选题在首页「功能特色」都有一张**独立入口卡**（见 index.html 的 .mods），
       弹窗一次只渲染被点开的那一节，**不再有选题 Tab 条**。所以新增选题时：
       ① KEPU_TOPICS 加一条（id / seal / nav / short / title / sub / sections）；
       ② 首页 .mods 加一张 <button class="mod" id="modXxx">；
       ③ 下面绑定 $('modXxx').addEventListener('click', () => openKepu('id'))。
     nav  = 弹窗顶部标题（＝用户点进来的那张卡的名称） */
  const KEPU_TOPICS = [
    {
      id: 'versions2026',
      seal: '科',
      nav: '三国杀科普',
      short: '全版本区分',
      title: '2026 三国杀全版本区分',
      sub: `${KEPU_VERS.map((v) => v.blurb).join(' · ')} —— ${VER_N} 个平行世界互不互通，选对版本不踩坑`,
      sections: [
        { h: '一、平台与数据互通：选版本前必看', html: `
          <p>先说结论：<b>${VER_N} 个版本 = ${VER_N} 款独立游戏</b>，账号、武将、充值<b>完全不互通</b>。</p>
          <ul>
            ${verLis((v) => `<b>${v.name}（${v.aka}）</b>：${v.plat}${v.platNote ? `——${v.platNote}` : ''}。`)}
          </ul>
          <p class="kp-note">一句话：在任何一款里氪的金、攒的将，都<b>带不进另外 ${VER_N - 1} 款</b>；换版本 = 重新开始。</p>` },
        { h: '二、官网各入口的真相：OL经典版、重制版与一将成名', html: `
          <p>OL 官网看着有三个入口，实际只对应<b>两款独立游戏</b>：</p>
          <ul>
            <li><b>「三国杀OL-经典版」</b>：面向<b>PC端老玩家</b>，保留<b>传统UI</b>，<b>立绘未和谐</b>——原汁原味的老杀。</li>
            <li><b>「三国杀OL-重制版」</b>：本质是面向移动端的<b>《三国杀OL互通版》入口</b>，UI与手机端一致，<b>数据与PC端互通</b>；但<b>部分立绘做了"和谐"处理</b>。</li>
            <li><b>「三国杀：一将成名」</b>：<b>完全独立的另一款游戏</b>（即十周年/新杀），<b>独立服务器，与OL不互通</b>——挂在OL官网下，只是"一家人名字像"。</li>
          </ul>
          <p>那为什么在这个官网上<b>找不到手杀、欢杀和国际服</b>？因为它们<b>都是完全独立的游戏</b>，各自另有官网——手杀 <b>m.sanguosha.com</b>、国际服（繁中版）<b>sanguosha.com.tw</b>，自然不会出现在 OL 官网里。</p>` },
        { h: `三、${VER_N} 个版本的核心玩法与定位`, html: `
          <ul>
            ${verLis((v) => `<b>${v.aka}</b>：${v.play}。`)}
          </ul>` },
        { h: '四、氪金与平民友好度：各版本的"坑法"', html: `
          <ul>
            ${verLis((v) => `<b>${v.aka.split(' / ')[0]}</b>：${v.pay}。`)}
          </ul>
          <p class="kp-note">一句话总结：<b>手杀氪得狠，新杀送得多但膨胀快</b>；国际服是独立运营的另一套节奏。预算有限优先看玩法偏好，别只看送得多不多。</p>` },
        { h: '五、画风与UI：视觉的第一印象', html: `
          <ul>
            ${verLis((v) => `<b>${v.aka.split(' / ')[0]}</b>：${v.art}。`)}
          </ul>` },
        { h: '六、总结与入坑建议', html: `
          <ul>
            ${verLis((v) => `<b>${v.advice}</b> → <b>${v.name}</b>${v.adviceTip ? `（${v.adviceTip}）` : ''}。`)}
          </ul>
          <p class="kp-note">最后敲黑板：<b>这几款游戏数据完全独立、互不互通</b>。下载前想清楚自己要什么，别充完钱才发现进错了"平行世界"。</p>` },
        { h: '七、本图鉴收录对账', html: `
          <p>下面把<b>本图鉴实际收录的全部版本</b>逐一列出来，与本文自动对账。若本文还没介绍到某个版本，这里会直接标出来：</p>
          <div id="kpVerAudit"><p class="kp-note">正在对账…</p></div>` }
      ]
    },
    {
      id: 'identity',
      seal: '查',
      nav: '身份局速查',
      short: '身份局速查',
      title: '身份局速查：主忠反内选将指南',
      sub: '四大身份选将流派 · 座次位置推荐 · 避坑名单 · 开局口诀——落座之前先看一眼',
      sections: [
        { h: '一、核心速查：主忠反内选将指南', html: `
          <div class="kp-role"><h4 class="kai"><span class="kd"></span>主公</h4>
            <div class="kp-row"><span class="kl">常备主</span><span class="kp-hero">刘备</span><span class="kp-hero">曹操</span><span class="kp-hero">孙权</span><span class="kp-hero">曹丕</span></div>
            <div class="kp-row"><span class="kl">非常备主</span><span class="kp-hero">孙策</span><span class="kp-hero">袁绍</span></div>
            <div class="kp-row"><span class="kl">新手推荐</span><span class="kp-hero">刘备</span><span class="kp-hero">曹操</span></div>
            <div class="kp-row"><span class="kl">高手向</span><span class="kp-hero">孙权</span><span class="kp-hero">曹丕</span></div>
            <div class="kp-row"><span class="kl">避坑提示</span><span class="kp-warn">鲁肃、貂蝉</span>（高嘲讽无保命）</div>
          </div>
          <div class="kp-role"><h4 class="kai"><span class="kd"></span>忠臣</h4>
            <div class="kp-row"><span class="kl">辅助流</span><span class="kp-hero">荀彧</span><span class="kp-hero">鲁肃</span></div>
            <div class="kp-row"><span class="kl">输出流</span><span class="kp-hero">张飞</span><span class="kp-hero">黄盖</span></div>
            <div class="kp-row"><span class="kl">控制流</span><span class="kp-hero">诸葛亮</span><span class="kp-hero">大乔</span></div>
            <div class="kp-row"><span class="kl">位置讲究</span>分近位 / 远位两种打法，详见「三、场景速查」</div>
          </div>
          <div class="kp-role"><h4 class="kai"><span class="kd"></span>反贼</h4>
            <div class="kp-row"><span class="kl">菜刀流</span><span class="kp-hero">吕布</span><span class="kp-hero">马超</span></div>
            <div class="kp-row"><span class="kl">爆将</span><span class="kp-hero">袁术</span><span class="kp-hero">黄盖</span></div>
            <div class="kp-row"><span class="kl">控制流</span><span class="kp-hero">张辽</span><span class="kp-hero">甘宁</span></div>
          </div>
          <div class="kp-role"><h4 class="kai"><span class="kd"></span>内奸</h4>
            <div class="kp-row"><span class="kl">控场流</span><span class="kp-hero">吕蒙</span><span class="kp-hero">姜维</span></div>
            <div class="kp-row"><span class="kl">苟活流</span><span class="kp-hero">赵云</span><span class="kp-hero">魏延</span></div>
            <div class="kp-row"><span class="kl">新手避坑</span><span class="kp-warn">新手慎玩内奸</span>（详见「四、避坑指南」）</div>
          </div>` },
        { h: '二、进阶速查：按武将定位分类', html: `
          <p>五大功能标签，选将时按定位快速对号：</p>
          <div class="kp-tags"><span class="kp-hero">爆发输出</span><span class="kp-hero">奶妈辅助</span><span class="kp-hero">控制干扰</span><span class="kp-hero">坦克肉盾</span><span class="kp-hero">过牌爆发</span></div>
          <p class="kp-note">各标签下的关联武将名单将在后续版本补充。</p>` },
        { h: '三、场景速查：按座次和位置推荐', html: `
          <ul>
            <li><b>近位（2号位、8号位）</b>：适合<b>防御强、控制强</b>的类型；</li>
            <li><b>远位（4、5、6号位）</b>：适合<b>输出型、辅助型</b>；</li>
            <li><b>主公近卫</b>：忠臣位于主公旁边，适合<b>护驾型</b>。</li>
          </ul>` },
        { h: '四、避坑指南', html: `
          <ul>
            <li><b>千万别选系列</b>：技能描述极其复杂、易引发<b>村规争议</b>的武将；强度极低、选后<b>坑队友</b>的武将；</li>
            <li><b>容易引起真人 PK 系列</b>：<span class="kp-warn">张角、于吉</span>——需频繁询问操作的武将，慎选。</li>
          </ul>` },
        { h: '五、玩法速查：身份局基本口诀', html: `
          <div class="kp-quote"><span class="kq">主公</span>别乱盲狙，留好防御。</div>
          <div class="kp-quote"><span class="kq">忠臣</span>保主护驾，替主挡刀。</div>
          <div class="kp-quote"><span class="kq">反贼</span>集火主公，别打忠臣。</div>
          <div class="kp-quote"><span class="kq">内奸</span>装忠骗反，最后单挑。</div>` }
      ]
    },
    {
      id: 'guozhan',
      seal: '战',
      nav: '国战专区',
      short: '国战专区',
      title: '国战专区：暗将双将搭配指南',
      sub: '珠联璧合 · 强力组合 · 暗将博弈 · 避坑指南——双将落定之前先看一眼',
      sections: [
        { h: '一、机制速查：国战基本规则', html: `
          <ul>
            <li><b>同势力双将</b>：每名玩家选择两名<b>同势力</b>（魏、蜀、吴、群）武将进行组合，初始体力为<b>4点</b>，手牌上限与当前体力值挂钩；</li>
            <li><b>暗置规则</b>：武将牌默认<b>暗置</b>——暗置时<b>无技能、无性别、无势力</b>，可在回合开始阶段或发动技能时<b>明置</b>；</li>
            <li><b>回合流程</b>：回合开始 → 判定 → 摸牌 → 出牌 → 弃牌 → 回合结束，共六个阶段；</li>
            <li><b>胜利条件</b>：消灭其他所有势力。</li>
          </ul>` },
        { h: '二、特殊判定：野心家与鏖战模式', html: `
          <div class="kp-role"><h4 class="kai"><span class="kd"></span>野心家判定</h4>
            <div class="kp-row">当你的势力与<b>场上现存势力数量相等</b>时，被判定为独立阵营<b>"野心家"</b>——需消灭全场其他玩家才能获胜；野心家击杀其他角色时<b>固定获得3张牌</b>。</div>
          </div>
          <div class="kp-role"><h4 class="kai"><span class="kd"></span>鏖战模式</h4>
            <div class="kp-row"><span class="kl">触发条件</span>游戏中仅剩<b>四名或更少</b>角色（七人以下游戏时为<b>三名或更少</b>），且全场没有超过一名势力相同的角色；</div>
            <div class="kp-row"><span class="kl">核心变化</span><span class="kp-warn">桃只能当做杀或闪使用或打出，不能用来回复体力</span>；</div>
            <div class="kp-row"><span class="kl">亮将规则</span>拥有<b>锁定技</b>的武将，可以在出牌阶段内<b>主动宣布亮将</b>。</div>
          </div>` },
        { h: '三、特殊标记系统', html: `
          <table class="kp-table">
            <thead><tr><th>标记</th><th>获取条件</th><th>效果</th></tr></thead>
            <tbody>
              <tr><td class="kt-k">先驱</td><td>首个明置武将的玩家</td><td>出牌阶段弃置，将手牌补至4张并观看一名其他角色的一张暗置武将牌</td></tr>
              <tr><td class="kt-k">阴阳鱼</td><td>首次全部明置时有多余单独阴阳鱼</td><td>出牌阶段弃置，摸1张牌或令本回合手牌上限+2</td></tr>
              <tr><td class="kt-k">珠联璧合</td><td>两武将形成珠联璧合关系并首次全部明置</td><td>弃置视为使用桃；出牌阶段弃置摸2张牌</td></tr>
            </tbody>
          </table>` },
        { h: '四、珠联璧合组合列表', html: `
          <p>两名武将基于历史或演义关系形成特殊联系，<b>首次全部明置时可获得额外收益</b>。各势力主要组合：</p>
          <div class="kp-role"><h4 class="kai"><span class="kd"></span>魏势力</h4>
            <div class="kp-row"><span class="kl">曹操</span><span class="kp-hero">许褚</span><span class="kp-hero">典韦</span><span class="kp-hero">卞夫人</span></div>
            <div class="kp-row"><span class="kl">曹丕</span><span class="kp-hero">甄姬</span><span class="kp-hero">崔琰&amp;毛玠</span></div>
            <div class="kp-row"><span class="kl">曹仁</span><span class="kp-hero">曹洪</span></div>
            <div class="kp-row"><span class="kl">夏侯惇</span><span class="kp-hero">夏侯渊</span></div>
            <div class="kp-row"><span class="kl">司马昭</span><span class="kp-hero">司马懿</span></div>
          </div>
          <div class="kp-role"><h4 class="kai"><span class="kd"></span>蜀势力</h4>
            <div class="kp-row"><span class="kl">刘备</span><span class="kp-hero">关羽</span><span class="kp-hero">张飞</span><span class="kp-hero">甘夫人</span><span class="kp-hero">法正</span></div>
            <div class="kp-row"><span class="kl">诸葛亮</span><span class="kp-hero">黄月英</span><span class="kp-hero">蒋琬费祎</span><span class="kp-hero">姜维</span></div>
            <div class="kp-row"><span class="kl">赵云</span><span class="kp-hero">刘禅</span></div>
            <div class="kp-row"><span class="kl">卧龙诸葛亮</span><span class="kp-hero">庞统</span><span class="kp-hero">黄月英</span></div>
          </div>
          <div class="kp-role"><h4 class="kai"><span class="kd"></span>吴势力</h4>
            <div class="kp-row"><span class="kl">周瑜</span><span class="kp-hero">小乔</span></div>
            <div class="kp-row"><span class="kl">孙策</span><span class="kp-hero">大乔</span></div>
            <div class="kp-row"><span class="kl">吕范</span><span class="kp-hero">孙尚香</span></div>
          </div>
          <div class="kp-role"><h4 class="kai"><span class="kd"></span>群势力</h4>
            <div class="kp-row"><span class="kl">吕布</span><span class="kp-hero">貂蝉</span></div>
            <div class="kp-row"><span class="kl">袁绍</span><span class="kp-hero">颜良&amp;文丑</span></div>
            <div class="kp-row"><span class="kl">贾诩</span><span class="kp-hero">李傕&amp;郭汜</span></div>
          </div>` },
        { h: '五、热门强力组合推荐', html: `
          <div class="kp-role"><h4 class="kai"><span class="kd"></span>魏势力</h4>
            <table class="kp-table">
              <thead><tr><th>组合</th><th>核心机制</th><th>定位</th><th>难度</th></tr></thead>
              <tbody>
                <tr><td class="kt-k">甄姬+张角</td><td>倾国提供黑牌，鬼道改判触发雷击</td><td>持续输出/控制</td><td>中</td></tr>
                <tr><td class="kt-k">华佗+郭嘉</td><td>急救稳定回复，遗计不断补牌</td><td>续航/信息掌控</td><td>低</td></tr>
                <tr><td class="kt-k">李典+袁绍</td><td>恂恂刷牌，攻心换底牌，连破压制</td><td>过牌/压制</td><td>中</td></tr>
                <tr><td class="kt-k">邓艾+张角</td><td>屯田蓄爆，鬼道改判清场</td><td>双核爆发</td><td>中高</td></tr>
              </tbody>
            </table>
          </div>
          <div class="kp-role"><h4 class="kai"><span class="kd"></span>蜀势力</h4>
            <table class="kp-table">
              <thead><tr><th>组合</th><th>核心机制</th><th>定位</th><th>难度</th></tr></thead>
              <tbody>
                <tr><td class="kt-k">关羽+张飞</td><td>武圣红牌当杀，咆哮无限出杀</td><td>暴力输出</td><td>低</td></tr>
                <tr><td class="kt-k">黄月英+卧龙诸葛</td><td>集智爆发，八阵保生存</td><td>锦囊爆发/控场</td><td>中</td></tr>
                <tr><td class="kt-k">马超+黄忠</td><td>强命输出，无视距离</td><td>菜刀/强命</td><td>低</td></tr>
              </tbody>
            </table>
          </div>
          <div class="kp-role"><h4 class="kai"><span class="kd"></span>吴势力</h4>
            <table class="kp-table">
              <thead><tr><th>组合</th><th>核心机制</th><th>定位</th><th>难度</th></tr></thead>
              <tbody>
                <tr><td class="kt-k">黄盖+孙尚香</td><td>苦肉过牌，结姻回复</td><td>极限过牌/爆发</td><td>中</td></tr>
                <tr><td class="kt-k">周泰+孙坚</td><td>不屈不死，英魂控牌</td><td>坦克/控制</td><td>低</td></tr>
                <tr><td class="kt-k">吕范+孙尚香</td><td>装备流核心，快速累积资源</td><td>装备运营</td><td>中</td></tr>
              </tbody>
            </table>
          </div>
          <div class="kp-role"><h4 class="kai"><span class="kd"></span>群势力</h4>
            <table class="kp-table">
              <thead><tr><th>组合</th><th>核心机制</th><th>定位</th><th>难度</th></tr></thead>
              <tbody>
                <tr><td class="kt-k">袁绍+邹氏</td><td>乱击群体输出，暗将阶段偷看身份</td><td>AOE输出/信息</td><td>低</td></tr>
                <tr><td class="kt-k">李傕&amp;郭汜+贾诩</td><td>双乱武爆发，完杀快速减员</td><td>爆发/收割</td><td>高</td></tr>
                <tr><td class="kt-k">左慈+于吉</td><td>高强度单将联动</td><td>综合/变化</td><td>中高</td></tr>
              </tbody>
            </table>
          </div>` },
        { h: '六、合纵连横模式（限时玩法）', html: `
          <p>合纵连横是国战的限时玩法，允许<b>跨势力自由混搭</b>主将与副将，打破传统同势力搭配的限制。</p>
          <ul>
            <li><b>典型搭配</b>：主袁绍 + 副李典（群+魏）——袁绍的乱击配合李典的恂恂，兼顾AOE与过牌；</li>
            <li><b>暴力爆发流</b>：界吕布、大宝 + 马超、张飞等菜刀，曹植保手牌防断牌；</li>
            <li><b>续航拉扯流</b>：吴苋为核心，手牌调配、团队续航、节奏压制兼具；</li>
            <li><b>控场运营流</b>：小乔 + 孔融防集火转移伤害，赵云 + 张角能打能抗。</li>
          </ul>` },
        { h: '七、暗将博弈：亮将时机与势力判断', html: `
          <div class="kp-role"><h4 class="kai"><span class="kd"></span>亮将时机</h4>
            <div class="kp-row"><span class="kl">不宜过早亮将</span>魏国多数武将适合隐藏至关键时刻再揭示身份——一旦被波及极易引发<b>连锁反应</b>，导致整队魏将被迫集体现身；</div>
            <div class="kp-row"><span class="kl">队友已明</span>己方队友身份已明时应<b>及时亮将</b>，继续藏匿只会错失支援良机；</div>
            <div class="kp-row"><span class="kl">回合外亮将</span>影响势力判定——暗将状态下击杀己方同势力角色<b>不会有弃牌惩罚</b>，可利用此机制混淆视听。</div>
          </div>
          <div class="kp-role"><h4 class="kai"><span class="kd"></span>暗将势力判断</h4>
            <div class="kp-row">暗置武将牌无技能、无性别、无势力，但可通过<b>技能读条</b>判断某暗将可能的势力；</div>
            <div class="kp-row"><span class="kl">威胁武将</span><span class="kp-warn">袁绍</span>（万箭齐发群体打击）、<span class="kp-warn">黄月英</span>（集智爆发）等。</div>
          </div>` },
        { h: '八、新手避坑指南', html: `
          <ul>
            <li><b>避免盲目跟风选魏</b>：同一势力人数超过三人且无其他势力成员时，<b>第四人起自动转为野心家</b>——盲目跟风可能适得其反；</li>
            <li><b>不建议优先选择</b>：<span class="kp-warn">黄忠、杜预、徐庶</span>等武将在国战模式中强度不理想或机制与模式不契合，应谨慎选择；</li>
            <li><b>生存优先原则</b>：除非处于一号位需主动开阵，否则应以<b>防御为导向</b>，优先刷取防御牌而非追求技能收益；</li>
            <li><b>限定技使用时机</b>：李傕&amp;郭汜的<b>凶算</b>需降低频率，不到关键时刻不能乱用限定技——需保留至少一个技能进单挑。</li>
          </ul>
          <p class="kp-note">国战武将随扩展包持续更新（如"君临天下"系列、"不臣篇"等），本篇组合与名单将随版本补充。</p>` }
      ]
    },
    {
      id: 'series',
      seal: '系',
      nav: '武将系列类型',
      short: '武将类型',
      title: '武将类型科普：名字前面那个字是什么意思',
      sub: '界 · 谋 · 势 · 极 · 志 · 神 · SP · 星 · 威 · 族 · 魔 · 喵 —— 前缀 = 系列标记，也是同一个武将有好几个版本的根本原因',
      sections: [
        { h: '一、先立规矩：前缀 = 系列标记，不是名字', html: `
          <p>武将名前面那个字（<b>界</b>、<b>谋</b>、<b>势</b>…），是<b>系列（扩展包）标记</b>——它回答"这张牌出自哪个系列"，跟人物叫什么没关系。</p>
          <ul>
            <li><b>「曹植」和「界曹植」是两张不同的武将牌</b>：同一个人，两套技能、两种强度。本库里搜「曹植」会命中各版本各自的原版 + 界 + 御 + 乐 等一堆，这<b>不是重复数据，是"同名不同系列"</b>（搜索默认折成一张，点底部的「另有 N 版」展开）。</li>
            <li><b>前缀只在本版本内有效</b>：同一个「谋」字，手杀叫《<b>谋攻篇</b>》、十周年叫《<b>谋定天下</b>》、OL 干脆只叫《<b>谋</b>》——三版系列名不同、成员不同、强度也不同，<b>不能跨版本套用</b>。</li>
            <li><b>前缀还透露"新设计还是老将加强"</b>：看「界」就知道是老将强化版，「谋」「势」「威」这类基本是新设计，这是判断强度的第一手信息。</li>
          </ul>
          <table class="kp-table">
            <thead><tr><th>前缀</th><th>系列正式名</th><th>出现版本</th><th>本库收录</th></tr></thead>
            <tbody id="kpSeriesBody"><tr><td colspan="4" class="kp-note">统计载入中…</td></tr></tbody>
          </table>
          <p class="kp-note"><span id="kpSeriesDetail">统计载入中…</span><br>怎么归类：<b>看名字前缀</b>，同一个字在不同版本可能是不同系列；「乐进 / 乐綝 / 乐就」是曹魏人物、「武安国」是《演义》人物，不计入系列。另有 110 名 OL 国战专用版本写作「<b>国战</b>曹操」「<b>国战</b>司马懿」，见下文。</p>` },

        { h: '二、「界」——界限突破：所有系列的起点', html: `
          <p>官方全称《<b>三国杀标准版·界限突破</b>》，<b>2014 年 4 月由游卡桌游推出</b>（百度百科/官方产品资料）。</p>
          <ul>
            <li><b>它不是新武将，是把老标准将"加强"</b>：首批修改 18 张武将牌、新增 3 张，共 <b>21 名</b>，另附一张新装备牌【木牛流马】。</li>
            <li><b>为什么要有它</b>：扩展包越出越多、军争局节奏加快，标准版的曹操、关羽、张飞、司马懿等一批名将沦为"废柴"。官方用"界武将"回应玩家对名将强度的期待——所以界武将<b>技能名大多和老版一样，效果被改写得更强</b>（如界司马懿【反馈】改为每受 1 点伤害就拿一张牌、【鬼才】可用装备牌改判）。</li>
            <li><b>后来不止标准将</b>：各端把「一将成名」也做了界限突破，手杀专有包名「<b>界一将成名</b>」——界徐盛、界于禁、界李儒、界朱然、界钟会、界左慈、界步练师都出自这里。</li>
            <li><b>本库：界武将是数量最多的系列</b><span id="kpSeriesJie"></span>。</li>
          </ul>
          <p class="kp-note">一句话：<b>界 = 老熟人的加强版</b>。看到「界」先别当成新武将，它一定有一位"原版"存在。</p>` },

        { h: '三、「谋」——兵法里的第一条主线，也是最强的一批', html: `
          <p>「谋」来自《<b>孙子兵法·谋攻篇</b>》。它是各版本共同的主线，但各版做法完全不同：</p>
          <ul>
            <li><b>手杀《谋攻篇》</b>：官方"谋"系列，<b>引入了护甲值机制</b>，整体强度明显高于「界」。分 <b>5 个子包</b>，每个子包带来一种至今没在别处复用的"绝版机制"（见下表）。</li>
            <li><b>十周年《谋定天下》</b>：按人物典故分子组，共 11 组——冢虎狼顾（司马懿）、子敬邀刀（鲁肃）、毒士鸩计（贾诩）、周郎将计（周瑜）、奇佐论胜（郭嘉）、幼麟绝战（姜维）、武侯定南（诸葛亮南征）…</li>
            <li><b>OL 只叫《谋》</b>：谋姜维、谋关羽、谋太史慈、谋董卓、谋孙坚、谋袁绍。</li>
          </ul>
          <p>手杀《谋攻篇》五个子包的机制（据游卡官方社区《谋攻篇引入的相关机制及定义》）：</p>
          <table class="kp-table">
            <thead><tr><th>子包</th><th>机制</th><th>官方定义</th></tr></thead>
            <tbody>
              <tr><td class="kt-k">知</td><td class="kt-nw">标记</td><td>达成技能设定的条件后获得标记，累积到一定数量即触发收益／觉醒／使命成功／技能升级</td></tr>
              <tr><td class="kt-k">识</td><td class="kt-nw">谋弈</td><td>发动人与目标各从多个选项中选一项；目标若没选到与发动人对应的选项，发动人"攻城成功"，执行所选效果</td></tr>
              <tr><td class="kt-k">同</td><td class="kt-nw">协力</td><td>从"同仇／并进／疏财／勠力"中选一项，与一名角色共同完成，达成即执行后续效果</td></tr>
              <tr><td class="kt-k">虞</td><td class="kt-nw">护甲</td><td>护甲上限 5。<b>受到伤害时优先扣护甲</b>，护甲不足才扣体力；<b>失去体力无视护甲</b>（伤害结算照旧存在，只是扣在护甲上）</td></tr>
              <tr><td class="kt-k">能</td><td class="kt-nw">蓄力</td><td>蓄力技(X/Y)：X 为开局获得的蓄力标记数、Y 为上限，发动按条件消耗标记；一名角色有多个蓄力技时<b>共用同一批标记</b>，X、Y 分别相加</td></tr>
            </tbody>
          </table>
          <p>「协力」四项的具体门槛：</p>
          <div class="kp-row"><span class="kl">同仇</span>双方造成的伤害之和不小于 4 点</div>
          <div class="kp-row"><span class="kl">并进</span>双方摸牌数之和不小于 8 张</div>
          <div class="kp-row"><span class="kl">疏财</span>双方弃置的牌包含 4 种花色</div>
          <div class="kp-row"><span class="kl">勠力</span>双方使用或打出的牌包含 4 种花色</div>` },

        { h: '四、「势」——兵势篇：手杀起家，国际服也有', html: `
          <p>「势」= 手杀《<b>兵势篇</b>》（取《孙子兵法·兵势篇》）。本库 43 名：<b>移动版 29 · 国际服 14</b>——原本是手杀独占，国际服后来也同步收录了这批，跨版本对账时别只盯一个库。</p>
          <ul>
            <li><b>4 个子包</b>：势包 / 正包 / 奇包 / 节包。代表：势周瑜、势魏延、势于吉、势曹真、势太史慈、势陆郁生。</li>
            <li><b>系列机制「乘势」</b>：一种附加效果——在多分支效果的技能里，<b>如果每个分支的触发条件都被满足了，就额外触发"乘势"</b>。乘势是<b>强制触发</b>：锁定技不可自选是否触发，非锁定技只要满足了条件，执行完分支后必定触发。首发于势魏延，后续界严颜、势孙綝、谋陈泰等也有。</li>
          </ul>
          <p class="kp-note"><b>千万别把它和"势力"混淆</b>：「势」是系列（前缀）；魏、蜀、吴、群、晋、神才是<b>势力</b>。游戏术语里的"势力"写在武将牌左上角，决定国战的胜负条件；而"势"只是系列名。</p>` },

        { h: '五、「神」与「SP」——最容易被误解的两个', html: `
          <div class="kp-role"><h4 class="kai"><span class="kd"></span>神 · 神话再临的神将</h4>
            <div class="kp-row"><span class="kl">性质</span>出自《<b>神话再临</b>》系列（风／火／林／山／阴／雷 六个子包），牌面上的势力就是独立的「<b>神</b>」——不属于魏蜀吴群晋。</div>
            <div class="kp-row"><span class="kl">势力规则</span>使用神武将的玩家，<b>在游戏开始时自行选定一个势力</b>（用于响应主公技、国战判定等）。</div>
            <div class="kp-row"><span class="kl">代表</span><span class="kp-hero">神关羽</span><span class="kp-hero">神吕布</span><span class="kp-hero">神诸葛亮</span><span class="kp-hero">神吕蒙</span><span class="kp-hero">神周瑜</span><span class="kp-hero">神曹操</span></div>
            <div class="kp-row"><span class="kl">手杀专属神将</span>神郭嘉、神荀彧（配《始计篇》智包）、神太史慈、神孙策（信包）</div>
            <div class="kp-row"><span class="kl">十周年另有</span>「限定-神·武」：神张飞、神张角、神邓艾、神许褚、神华佗、神黄忠、神庞统、神钟会</div>
            <div class="kp-row"><span class="kl">本库</span>126 名（欢乐杀 34 / 十周年 25 / 国际服 20 / 移动版 20 / OL 16 / 小程序 11）</div>
          </div>
          <div class="kp-role"><h4 class="kai"><span class="kd"></span>SP · 没有统一标准的"补位包"</h4>
            <div class="kp-row"><span class="kl">性质</span>官方收纳零散补充武将的扩展包。<b>成员之间没有统一标准</b>：势力各异、机制各异，很多 SP 武将名字里甚至不带 SP 二字。</div>
            <div class="kp-row"><span class="kl">手杀分法</span>按「<b>SP 武将组 1 ~ 15</b>」收纳，每组约 10 名：SP关羽、SP赵云、SP貂蝉、SP马超、SP姜维、SP庞德、SP贾诩…</div>
            <div class="kp-row"><span class="kl">OL 后续</span>官方把 OL 的 SP 与"原创设计"武将<b>重新分类进《星火燎原》</b>（设计师韩旭访谈：为解决"武将分类杂乱"问题）</div>
            <div class="kp-row"><span class="kl">本库</span>108 名（欢乐杀 26 / 移动版 19 / OL 18 / 国际服 17 / 十周年 16 / 小程序 12）</div>
          </div>
          <p class="kp-note">顺带一提：如今最常见的技能标签，源头也在《神话再临》——<b>锁定技</b>（风）、<b>限定技</b>（火）、<b>觉醒技</b>（山）、<b>转换技</b>（阴）、<b>废除区域</b>（雷）。</p>` },

        { h: '六、「星」——其实是三个不同系列', html: `
          <p>光看名字都带"星"，但它们是三套独立的东西，别当成一个：</p>
          <div class="kp-role"><h4 class="kai"><span class="kd"></span>星火燎原（十周年，48 名）</h4>
            <div class="kp-row">官方把原有的 SP 与原创设计武将<b>重新分类</b>而来。子组用<b>南斗六星</b>命名：<span class="kp-hero">天府</span><span class="kp-hero">天梁</span><span class="kp-hero">天机</span><span class="kp-hero">天同</span><span class="kp-hero">天相</span><span class="kp-hero">七杀</span>。</div>
            <div class="kp-row">官方设计说明（韩旭访谈）：取自《三国演义》第六十九回，依"<b>南斗主生</b>"取星寓意匹配人物——<b>天机</b>是善星、主智慧长寿，代表人物诸葛亮；<b>七杀</b>象征坚毅勇敢，对应白起、廉颇这类大将。</div>
          </div>
          <div class="kp-role"><h4 class="kai"><span class="kd"></span>星河璀璨（十周年，21 名）</h4>
            <div class="kp-row">赛季战令系列，靠"星河璀璨宝箱"产出（官方公告：每 100 次必得一名）。子组改用<b>北斗星宿</b>命名：<span class="kp-hero">天枢</span><span class="kp-hero">天璇</span><span class="kp-hero">玉衡</span><span class="kp-hero">开阳</span><span class="kp-hero">瑶光</span>。代表：星董卓、星袁术、星张春华、星张郃。</div>
          </div>
          <div class="kp-role"><h4 class="kai"><span class="kd"></span>将星独具（手杀，9 名）</h4>
            <div class="kp-row">手杀自己的"星"：星周不疑、星张辽、星张郃、星徐晃、星法正。手杀另有「<b>稀有专属</b>」系列（祢衡、庞德公、郑玄、南华老仙、杨彪等）与之相邻。</div>
          </div>
          <p class="kp-note"><b>本库「星」共 57 名</b>：十周年 20 · 欢乐杀 13 · 移动版 10 · 国际服 9 · 小程序 5。</p>` },

        { h: '七、「威」「族」「魔」「武」「喵」——版本专属的五张花活', html: `
          <div class="kp-role"><h4 class="kai"><span class="kd"></span>威 · 威震天下（十周年，15 名 / 欢乐杀 4 名）</h4>
            <div class="kp-row"><span class="kl">子组</span>威震天下 · 君威盖世 · 片羽威凤</div>
            <div class="kp-row"><span class="kl">机制</span><b>连招技</b>——按指定牌序"连招"以触发额外效果。官方公告里威董卓【据陲】标的就是"连招技（装备牌 + 锦囊牌）"。</div>
            <div class="kp-row"><span class="kl">代表</span><span class="kp-hero">威吕布</span><span class="kp-hero">威孙权</span><span class="kp-hero">威公孙瓒</span><span class="kp-hero">威关银屏</span></div>
          </div>
          <div class="kp-role"><h4 class="kai"><span class="kd"></span>族 · 门阀士族（<b>OL 专属</b>，34 名全在 OL）</h4>
            <div class="kp-row">以<b>家族</b>为单位成组：颍川荀氏（族荀淑、族荀谌、族荀采、族荀粲、族荀彧）、颍川钟氏（族钟会、族钟繇）、吴郡吴氏（族吴苋、族吴班）。</div>
            <div class="kp-row"><span class="kl">特色</span>强调<b>同族／同势力协同</b>——族将之间往往互为彼此技能的"接口"。</div>
          </div>
          <div class="kp-role"><h4 class="kai"><span class="kd"></span>魔 · 魔系列（OL 专属，6 名；另 1 名在手杀）</h4>
            <div class="kp-row">魔司马懿、魔吕布、魔貂蝉、魔曹操、魔孙权、魔张飞。官方 PV 里的招牌立意是"无天无界"，并围绕<b>勾玉（体力条）的颜色</b>做新机制。</div>
            <div class="kp-row"><span class="kl">注意</span>手杀那 1 名是<b>魔曹操</b>，出自《<b>蚀心入魔</b>》限时包（子组：限时武将-蚀心入魔-疑包），和 OL 的「魔」不是同一个系列。</div>
          </div>
          <div class="kp-role"><h4 class="kai"><span class="kd"></span>武 · 限定·武庙（<b>仅十周年</b>，6 名）</h4>
            <div class="kp-row">武关羽、武张飞、武诸葛亮、武皇甫嵩、武陆逊、武陆抗。全部 <b>SSS 品质</b>，属「限定专属」包下的"武庙"子组。</div>
            <div class="kp-row"><span class="kl">命名由来</span>"武庙"是历代官方祭祀名将的庙宇，能入武庙即被视为"武圣"级待遇——这大概也是这一批一律给到最高品质的原因。</div>
          </div>
          <div class="kp-role"><h4 class="kai"><span class="kd"></span>喵 · 喵喵杀（十周年 11 名 / 欢乐杀 专·喵）</h4>
            <div class="kp-row">十周年的整活系列，名字直接叫「体重之神」「变幻之神」「可爱之神」「委屈之神」「宫百万」；欢乐杀侧是喵步练师、喵关银屏、喵马云騄、喵曹婴、喵蔡文姬。</div>
          </div>` },

        { h: '八、有些系列根本没有前缀：始计篇 · 神话再临 · 一将成名', html: `
          <p>别以为"系列一定带前缀"。<b>手杀《始计篇》、神话再临、一将成名这几套，成员名字前面什么都不加</b>——所以光看名字认不出来，得靠图鉴的「<b>筛选</b>」面板按包去看。</p>
          <p>手杀《始计篇》的名字取自《孙子兵法·始计篇》原文："<b>将者，智、信、仁、勇、严也</b>"，五个子包也正因此得名，各带一种机制：</p>
          <table class="kp-table">
            <thead><tr><th>子包</th><th>机制</th><th>官方定义</th></tr></thead>
            <tbody>
              <tr><td class="kt-k">智</td><td class="kt-nw">智囊</td><td>一种锦囊分类，特指【无中生有】【过河拆桥】【无懈可击】三种；部分武将的技能可获取或联动"智囊"</td></tr>
              <tr><td class="kt-k">信</td><td class="kt-nw">使命技</td><td>拥有"成功／失败"条件与对应效果的技能类型，<b>成功或失败后该技能永久失效</b>——可以粗略理解为"有分支的觉醒技"</td></tr>
              <tr><td class="kt-k">仁</td><td class="kt-nw">仁区</td><td>场上一个独立于所有角色的<b>公共区域</b>，至多置入 6 张"仁"牌；溢出时最先置入的那张被顶入弃牌堆</td></tr>
              <tr><td class="kt-k">勇</td><td class="kt-nw">背水</td><td>技能中带"背水："字样的选项，可<b>依次执行该技能的其余选项</b>并支付背水所述代价；付不起代价就不能选背水</td></tr>
              <tr><td class="kt-k">严</td><td class="kt-nw">整肃</td><td>从"擂进／变阵／鸣止"中选一项令目标执行，其弃牌阶段结束时未失败，即获得整肃奖励（摸 2 张牌 或 回复 1 点体力）</td></tr>
            </tbody>
          </table>
          <p>整肃三选一的具体条件：</p>
          <div class="kp-row"><span class="kl">擂进</span>出牌阶段内使用的牌点数严格递增，且至少 3 张</div>
          <div class="kp-row"><span class="kl">变阵</span>出牌阶段内使用的牌花色全部相同，且至少 2 张</div>
          <div class="kp-row"><span class="kl">鸣止</span>弃牌阶段内弃置的牌花色两两不同，且至少 2 张</div>
          <p class="kp-note">另有《神话再临》按"风／火／林／山／阴／雷"分包、《一将成名》按年份分包（2011—2025 各期），同样不带前缀。<b>手杀《兵势篇》</b>与<b>十周年《江山如故》</b>（限时武将，机制"议事"）也属这一类，只是兵势篇的成员统一加了"势"字。</p>` },

        { h: '九、欢乐杀的两套独有分法', html: `
          <p>欢乐杀端的系列分组和另外三版都不一样，它的「界」和「专」是按自己的规则切的：</p>
          <div class="kp-role"><h4 class="kai"><span class="kd"></span>界 · 按颜色再分 5 档（74 名）</h4>
            <div class="kp-row"><span class="kp-hero">橙</span>27 名<span class="kp-hero">紫</span>19 名<span class="kp-hero">蓝</span>12 名<span class="kp-hero">绿</span>8 名<span class="kp-hero">白</span>8 名</div>
            <div class="kp-row">同一批界武将，在欢乐杀里再按品质色分档，和另外三版的"界"组织方式不同。</div>
          </div>
          <div class="kp-role"><h4 class="kai"><span class="kd"></span>专 · 专系列（34 名）</h4>
            <div class="kp-row">子组：<span class="kp-hero">念</span>5<span class="kp-hero">战</span>8<span class="kp-hero">隐</span>2<span class="kp-hero">特</span>2<span class="kp-hero">喵</span>17</div>
          </div>
          <div class="kp-role"><h4 class="kai"><span class="kd"></span>限 · 限时系列（136 名）</h4>
            <div class="kp-row">子组：<span class="kp-hero">谋</span>42<span class="kp-hero">SP</span>26<span class="kp-hero">锦</span>22<span class="kp-hero">绣</span>23<span class="kp-hero">星</span>13<span class="kp-hero">乐</span>6<span class="kp-hero">威</span>4</div>
            <div class="kp-row">欢乐杀的「谋」「星」「乐」「威」都收在「限」包下——这也是为什么同一名武将的"谋"版本，各版本之间强度不能横向比较。</div>
          </div>` },

        { h: '十、小程序独有的两个系列：极 与 志', html: `
          <p>小程序把武将按 <b>8 个系列</b>（志 / 极 / 万象 / 界限 / 限定 / 神话 / 一将 / 标准）分组收录。其中<b>「极」「志」这两个系列，名字前缀就是系列名，而且只在小程序里有</b>——另外五个版本一个都搜不到：</p>
          <div class="kp-role"><h4 class="kai"><span class="kd"></span>极 · 登峰造极（38 名，全在小程序）</h4>
            <div class="kp-row">按<b>才 / 智 / 权 / 武</b>四个子包收录：<span class="kp-hero">才</span>10 名（极貂蝉、极甄姬、极黄月英、极曹植）· <span class="kp-hero">智</span>9 名（极诸葛亮、极郭嘉、极周瑜、极荀彧）· <span class="kp-hero">权</span>8 名（极曹操、极刘备、极孙权、极司马懿）· <span class="kp-hero">武</span>11 名（极吕布、极关羽、极赵云、极张飞）。</div>
            <div class="kp-row"><span class="kl">定位</span>同一批人气名将的再进阶版本，普遍在「界」之后又做了一档强化——具体强化成什么样，<b>以本库收录的技能原文为准</b>。</div>
          </div>
          <div class="kp-role"><h4 class="kai"><span class="kd"></span>志 · 志系列（7 名，全在小程序）</h4>
            <div class="kp-row">按人物生平的三种「志」分三组：<span class="kp-hero">遂志</span>（志孙权、志徐氏、志朱士行）· <span class="kp-hero">悖志</span>（志曹操、志曹节）· <span class="kp-hero">憾志</span>（志张角、志伏皇后）。</div>
            <div class="kp-row"><span class="kl">注意</span>「志」是小程序自有的系列，不是势力也不是称号——同名武将在其它版本没有对应卡。</div>
          </div>
          <p class="kp-note">小程序的其余六个系列（万象 / 界限 / 限定 / 神话 / 一将 / 标准）沿用通行的划分方式，名字不带新前缀，在图鉴的「筛选」面板里直接选即可。</p>` },

        { h: '十一、速记口诀', html: `
          <div class="kp-quote"><span class="kq">界</span>老将加强版，2014 起，各版本均有，数量最多。</div>
          <div class="kp-quote"><span class="kq">谋</span>兵法谋攻，各版本最强主线；手杀 5 子包、十周年 11 组、OL 一个包。</div>
          <div class="kp-quote"><span class="kq">势</span>手杀《兵势篇》独有——是系列名，不是势力。</div>
          <div class="kp-quote"><span class="kq">神</span>《神话再临》的独立势力；SP 是没统一标准的补位包。</div>
          <div class="kp-quote"><span class="kq">星</span>三套：南斗六星（星火燎原）、北斗（星河璀璨）、将星独具。</div>
          <div class="kp-quote"><span class="kq">极</span>登峰造极——小程序独有，才 / 智 / 权 / 武 四包 38 名。</div>
          <div class="kp-quote"><span class="kq">志</span>志系列（悖志 / 憾志 / 遂志）——小程序独有 7 名。</div>
          <div class="kp-quote"><span class="kq">威族魔武喵</span>各版本专属花活：连招技 / 家族协同 / 勾玉色 / 武庙 / 整活。</div>
          <p class="kp-note">最后提醒：<b>前缀只是"系列标记"，强度还得看具体技能</b>。同名不同系列的卡，技能和品质往往完全不一样——用本库搜索时点开卡片看技能，比只看前缀靠谱。<br><br>资料出处：游卡官方社区《谋攻篇／始计篇引入的相关机制及定义》、三国杀 OL／十周年／移动版官网公告与产品资料、三国杀设计师韩旭访谈（星火燎原命名）、游戏术语词条（技能标签来源）、萌娘百科系列板块。本页系列与收录数由本库各版本图鉴实时统计。</p>` }
      ]
    },
    {
      id: 'quickref',
      seal: '速',
      nav: '线下速查',
      short: '线下速查',
      title: '线下速查：技能怎么用，三行看懂',
      sub: '面杀开局不用翻规则书 —— 技能六型 · 时机词字典 · 八个必查前提 · 经典武将三行卡',
      sections: [
        { h: '一、一套读法：任何技能都只看三行', html: `
          <p>技能描述是"法律文书体"——一句话里塞着好几个前提。线下别硬背，按固定顺序读三遍就够了：</p>
          <ol>
            <li><b>时机</b>——什么时候能发动？（看句子开头那几个字）</li>
            <li><b>前提</b>——要付什么代价？（"你可以"后面、逗号之前的那段）</li>
            <li><b>结果</b>——换来什么？（后半句）</li>
          </ol>
          <p>拿本库原文试一个——<b>华佗【青囊】</b>：「出牌阶段限一次，你可以弃置一张手牌，令一名角色回复1点体力。」</p>
          <div class="qr-card">
            <div class="qr-sk"><b>青囊</b><span class="kind k-active">主动技</span></div>
            <div class="qr-row"><span class="qr-l">什么时候</span><span>你的出牌阶段，每回合只能 1 次</span></div>
            <div class="qr-row"><span class="qr-l">要付什么</span><span>丢 1 张手牌</span></div>
            <div class="qr-row"><span class="qr-l">换来什么</span><span>任意一人（可以是你自己）回 1 点体力</span></div>
          </div>
          <p class="kp-note"><b>关键：先看时机。</b>时机决定这技能是"你主动点"还是"等别人触发"——线下九成的争论都卡在第一步。"出牌阶段"开头的，轮到你时自己想着；"当你……时／后"开头的，等条件发生。</p>` },

        { h: '二、技能六型速查：先分清"该不该你出手"', html: `
          <p>本库各版本合计的全部技能，按<b>发动方式</b>只分<b>六型</b>。认清这六型，就知道技能发动权在谁手里：</p>
          <table class="kp-table">
            <thead><tr><th>类型</th><th>本库数量</th><th>谁发起</th><th>牌桌上怎么认</th></tr></thead>
            <tbody id="kpKindBody"><tr><td colspan="4" class="kp-note">统计载入中…</td></tr></tbody>
          </table>
          <p class="kp-note">口诀：<b>主动你说了算，触发等信号，锁定没得商量，限定就一次，觉醒强制变，转换来回翻。</b>（数量由本库各版本技能表实时统计，随版本更新自动变化）</p>` },

        { h: '三、时机词字典：官方术语 → 牌桌人话', html: `
          <p>技能开头那两三个字就是"什么阶段"，翻成人话之后整句立刻能读：</p>
          <table class="kp-table">
            <thead><tr><th>官方写法</th><th>发生在什么时候</th><th>你要做什么</th></tr></thead>
            <tbody>
              <tr><td class="kt-k">准备阶段</td><td>你的回合刚开始</td><td>判定之前就能办事，别急着摸牌</td></tr>
              <tr><td class="kt-k">判定阶段</td><td>摸牌之前</td><td>处理判定区挂的【乐】【闪电】等</td></tr>
              <tr><td class="kt-k">摸牌阶段</td><td>你摸牌的时候</td><td>能改摸牌张数的技能在这</td></tr>
              <tr><td class="kt-k">出牌阶段</td><td>回合的正文时间</td><td>出牌、用技能都在这；最常见</td></tr>
              <tr><td class="kt-k">弃牌阶段</td><td>出牌结束之后</td><td>手牌超上限就要弃</td></tr>
              <tr><td class="kt-k">结束阶段</td><td>回合快结束时</td><td>本轮最后一次动手机会</td></tr>
              <tr><td class="kt-k">你的回合外</td><td><b>别人的回合里</b></td><td>也能用——如华佗【急救】</td></tr>
              <tr><td class="kt-k">当你受到伤害后</td><td>你挨打、人还活着</td><td>伤害已结算完（体力已扣）</td></tr>
              <tr><td class="kt-k">当你需要使用或打出【X】时</td><td>你缺那张【X】了</td><td>主公技常用的时点</td></tr>
              <tr><td class="kt-k">濒死时</td><td>有人体力掉到 0</td><td>进入求【桃】流程</td></tr>
            </tbody>
          </table>` },

        { h: '四、八个必查前提：线下吵架高发区', html: `
          <p>下面八条，是"两个人都读了技能却吵起来"的主要原因。开局遇到争议，按顺序对一遍：</p>
          <ol>
            <li><b>"其他角色"不含你自己</b>——本库 <b>37.3%</b> 的技能带这个词，写"其他角色"就只能指别人；而"一名角色"通常<b>可以是你自己</b>。</li>
            <li><b>"你可以"＝可选</b>（占 <b>64.3%</b>）——不发动不违规；反过来，<b>锁定技（23.6%）没有拒绝权</b>，这才是两者的分界。</li>
            <li><b>"任意"＝数量你定</b>（可以多张），<b>"一张"＝就一张</b>，多给不算。</li>
            <li><b>"限一次"要问限的是谁</b>——"<b>出牌阶段</b>限一次"只在你的出牌阶段算；"<b>每回合</b>限一次"谁的回合都算，别人回合触发过，你的回合还能再来。</li>
            <li><b>"视为"＝那不是一张真实的牌</b>——【离间】让 A 对 B"视为使用一张【决斗】"，这张牌不在任何人手里，通常不能被【无懈可击】响应（OL 的离间原文就直接写了"不能被【无懈可击】抵消"）。</li>
            <li><b>主公技只有坐在主公位才能用</b>——不是主公，技能栏里那一行直接作废。</li>
            <li><b>濒死求【桃】是"轮流问"</b>——从当前回合角色开始，按行动顺序每个角色都有机会出【桃】，一圈都没人出才死亡。</li>
            <li><b>"受到伤害后"≠"受到伤害时"</b>——"后"是伤害已经结算完；"时"是正在结算，还有机会改结果。</li>
          </ol>` },

        { h: '五、经典武将三行卡', html: `
          <p>线下最常摸到的就是标准版这批。按上面的读法逐张拆好，上桌直接对：</p>
          <div class="qr-list">
            <div class="qr-card">
              <div class="qr-nm">华佗<small>群 · 标准版</small></div>
              <div class="qr-sk"><b>急救</b><span class="kind k-active">主动技</span></div>
              <div class="qr-row"><span class="qr-l">什么时候</span><span>别人的回合里（回合外）</span></div>
              <div class="qr-row"><span class="qr-l">要付什么</span><span>手里有红色牌，当【桃】打出</span></div>
              <div class="qr-row"><span class="qr-l">换来什么</span><span>救回濒死的人，那张红牌进弃牌堆</span></div>
              <div class="qr-sk" style="margin-top:9px"><b>青囊</b><span class="kind k-active">主动技</span></div>
              <div class="qr-row"><span class="qr-l">什么时候</span><span>你的出牌阶段，每回合 1 次</span></div>
              <div class="qr-row"><span class="qr-l">要付什么</span><span>丢 1 张手牌</span></div>
              <div class="qr-row"><span class="qr-l">换来什么</span><span>任意一人（含自己）回 1 点体力</span></div>
            </div>
            <div class="qr-card">
              <div class="qr-nm">曹操<small>魏 · 标准版</small></div>
              <div class="qr-sk"><b>奸雄</b><span class="kind k-passive">触发技</span></div>
              <div class="qr-row"><span class="qr-l">什么时候</span><span>你受到伤害后，人还活着</span></div>
              <div class="qr-row"><span class="qr-l">要付什么</span><span>不用付，你想发动才发动</span></div>
              <div class="qr-row"><span class="qr-l">换来什么</span><span>获得造成伤害的那张牌</span></div>
              <div class="qr-sk" style="margin-top:9px"><b>护驾</b><span class="kind k-passive">触发技</span></div>
              <div class="qr-row"><span class="qr-l">什么时候</span><span>你需要使用或打出【闪】时</span></div>
              <div class="qr-row"><span class="qr-l">要付什么</span><span>你得是主公</span></div>
              <div class="qr-row"><span class="qr-l">换来什么</span><span>魏势力角色可代你出【闪】，视为你出的</span></div>
            </div>
            <div class="qr-card">
              <div class="qr-nm">孙权<small>吴 · 标准版</small></div>
              <div class="qr-sk"><b>制衡</b><span class="kind k-active">主动技</span></div>
              <div class="qr-row"><span class="qr-l">什么时候</span><span>你的出牌阶段，每回合 1 次</span></div>
              <div class="qr-row"><span class="qr-l">要付什么</span><span>弃置<b>任意张</b>牌（数量你定）</span></div>
              <div class="qr-row"><span class="qr-l">换来什么</span><span>摸等量的牌，等于免费换手牌</span></div>
              <div class="qr-sk" style="margin-top:9px"><b>救援</b><span class="kind k-lock">锁定技</span></div>
              <div class="qr-row"><span class="qr-l">什么时候</span><span>别人对你使用【桃】时</span></div>
              <div class="qr-row"><span class="qr-l">要付什么</span><span>你得是主公</span></div>
              <div class="qr-row"><span class="qr-l">换来什么</span><span>那张【桃】的回复值 +1（回 2 血）</span></div>
            </div>
            <div class="qr-card">
              <div class="qr-nm">貂蝉<small>群 · 标准版</small></div>
              <div class="qr-sk"><b>离间</b><span class="kind k-active">主动技</span></div>
              <div class="qr-row"><span class="qr-l">什么时候</span><span>你的出牌阶段，每回合 1 次</span></div>
              <div class="qr-row"><span class="qr-l">要付什么</span><span>弃 1 张牌，选两名<b>男性</b>其他角色</span></div>
              <div class="qr-row"><span class="qr-l">换来什么</span><span>后者"视为"对前者使用一张【决斗】</span></div>
              <div class="qr-sk" style="margin-top:9px"><b>闭月</b><span class="kind k-active">主动技</span></div>
              <div class="qr-row"><span class="qr-l">什么时候</span><span>你的结束阶段</span></div>
              <div class="qr-row"><span class="qr-l">要付什么</span><span>不用付任何东西</span></div>
              <div class="qr-row"><span class="qr-l">换来什么</span><span>白摸 1 张牌</span></div>
            </div>
            <div class="qr-card">
              <div class="qr-nm">张飞<small>蜀 · 标准版</small></div>
              <div class="qr-sk"><b>咆哮</b><span class="kind k-lock">锁定技</span></div>
              <div class="qr-row"><span class="qr-l">什么时候</span><span>你使用【杀】的时候</span></div>
              <div class="qr-row"><span class="qr-l">要付什么</span><span>不用付，也<b>不能选择不发动</b></span></div>
              <div class="qr-row"><span class="qr-l">换来什么</span><span>【杀】没有次数限制，想出几张出几张</span></div>
            </div>
            <div class="qr-card">
              <div class="qr-nm">刘备<small>蜀 · 标准版</small></div>
              <div class="qr-sk"><b>仁德</b><span class="kind k-active">主动技</span></div>
              <div class="qr-row"><span class="qr-l">什么时候</span><span>你的出牌阶段，次数不限</span></div>
              <div class="qr-row"><span class="qr-l">要付什么</span><span>把手牌交给一名其他角色</span></div>
              <div class="qr-row"><span class="qr-l">换来什么</span><span>本阶段给到第 2 张时，自己回 1 点体力</span></div>
              <div class="qr-sk" style="margin-top:9px"><b>激将</b><span class="kind k-passive">触发技</span></div>
              <div class="qr-row"><span class="qr-l">什么时候</span><span>你需要使用或打出【杀】时</span></div>
              <div class="qr-row"><span class="qr-l">要付什么</span><span>你得是主公</span></div>
              <div class="qr-row"><span class="qr-l">换来什么</span><span>蜀势力角色可代你出【杀】，视为你出的</span></div>
            </div>
          </div>
          <p class="kp-note">以上技能原文取<b>十周年</b>标准版；各版措辞略有出入（如 OL 的【离间】写明"不能被【无懈可击】抵消"），以你手上那副牌的<b>卡面文字</b>为准。</p>` },

        { h: '六、术语小词典', html: `
          <p>技能描述里那些看着眼熟、说不清的词：</p>
          <table class="kp-table">
            <thead><tr><th>术语</th><th>一句话</th></tr></thead>
            <tbody>
              <tr><td class="kt-k">濒死</td><td>体力降到 0 或以下，进入求【桃】流程，没人救才死亡</td></tr>
              <tr><td class="kt-k">结算</td><td>一张牌或一个技能的效果，从头走到尾的完整过程</td></tr>
              <tr><td class="kt-k">拼点</td><td>双方各出一张手牌比点数，比完<b>两张都进弃牌堆</b></td></tr>
              <tr><td class="kt-k">翻面</td><td>武将牌翻到背面，下次轮到你时翻回正面，<b>并跳过这个回合</b></td></tr>
              <tr><td class="kt-k">视为</td><td>用 A 当 B，但那不是一张真实存在的牌</td></tr>
              <tr><td class="kt-k">修正</td><td>改变数值（如"点数 +1"），改的是结果不是牌面</td></tr>
              <tr><td class="kt-k">响应</td><td>被别人指名时打出【闪】【杀】【无懈可击】等</td></tr>
              <tr><td class="kt-k">手牌上限</td><td>弃牌阶段允许保留的手牌数，通常等于你的当前体力</td></tr>
              <tr><td class="kt-k">判定区</td><td>身上挂着的【乐不思蜀】【兵粮寸断】【闪电】等延时锦囊</td></tr>
              <tr><td class="kt-k">装备区</td><td>武器／防具／进攻坐骑／防御坐骑 四个位置</td></tr>
              <tr><td class="kt-k">使用／打出／弃置</td><td>使用＝自己主动用牌；打出＝被要求时响应；弃置＝从手牌或装备区丢掉</td></tr>
            </tbody>
          </table>` },

        { h: '七、一句话总结', html: `
          <p><b>读技能 → 先看时机（谁主动），再看前提（付什么），最后看结果（换什么）。</b>遇到"其他角色／你可以／视为／限一次"这几个词，停下来多问一句。</p>
          <p class="kp-note">本页技能六型的数量由本库各版本武将资料<b>现算</b>（随版本库增删自动更新），技能原文取自各版本游戏内的实际描述；规则解释参照官方规则文本与游戏内技能描述。各端对同一技能的措辞、时点标注偶有差异，<b>线下以你所用牌堆的卡面文字为准</b>，有争议时优先查官方 FAQ。<br><br>配套工具：首页「<b>面杀速查</b>」——输入武将名，直接出该武将的技能三行卡；十周年图鉴的武将还带<b>官方技能问答</b>（卡片底部可展开），遇到"这技能到底怎么算"直接看官方答案。</p>` }
      ]
    },
    {
      id: 'evolve',
      seal: '演',
      nav: '技能改革对照',
      short: '技能沿革',
      title: '技能沿革：同一个武将，几套写法',
      sub: 'OL / 移动版 / 十周年 / 欢乐杀 / 国际服 / 小程序各自维护，同一个人被改成不同版本；这里把同名技能的各版原文并排摆出来，只标差异、不下结论',
      sections: [
        { h: '一、为什么同一个武将，能有几套技能', html: `
          <p>先把前提说清：<b>${VER_N} 个版本是 ${VER_N} 款独立游戏</b>，武将数值与技能文本各自维护、互不同步。同一个武将因此在各端被改成了不同写法 —— 这不是"谁抄谁"，而是各端按自己的平衡节奏<b>各改各的</b>。</p>
          <p class="kp-note" id="kpEvScope">本章对照图鉴收录的<b>全部版本</b>：OL / 移动版 / 十周年 / 欢乐杀 / 国际服 / 小程序（未实装库也一并列出）。其中<b>国际服、小程序</b>的技能描述直接取自官方客户端配置表、未做人工润色，这两版的资料会带「原文」小标 —— 看到这两版与其它版本"有出入"，请注意其中一部分只是官方的另一种写法，不等于规则不同。</p>
          <p>看技能改动，按这三个地方依次找，基本不会漏：</p>
          <table class="kp-table">
            <thead><tr><th>看哪儿</th><th>说的是什么</th><th>典型改动</th></tr></thead>
            <tbody>
              <tr><td class="kt-k">时点</td><td>什么时候能发动、一回合几次</td><td>「出牌阶段」→「出牌阶段限一次」</td></tr>
              <tr><td class="kt-k">代价</td><td>发动要付什么（弃牌 / 给牌 / 掉血）</td><td>「弃置一张牌」→「弃置所有手牌」</td></tr>
              <tr><td class="kt-k">结果</td><td>换来什么、怎么结算</td><td>「回复1点体力」→「视为使用一张基本牌」</td></tr>
            </tbody>
          </table>
          <p>除此之外，有两件事必须先分清，不然很容易把"换个写法"当成"改了规则"：</p>
          <ul>
            <li><b>标 / 界是两套写法</b>：同一款游戏里，老武将的<b>界限突破</b>版会重做技能，标版与界版<b>并存</b>。本库把两条记录都留着，页面里用「标」「界」标出。</li>
            <li><b>有些差异只是措辞</b>：例如 OL 写「锁定技，你使用【杀】无次数限制。」、欢乐杀写「锁定技你使用【杀】无次数限制。」—— 只差一个逗号，规则上没有任何区别。</li>
          </ul>
          <p class="kp-note">所以本页把差异分成三档：<b>完全一致</b> / <b>仅措辞</b>（去掉标点与空格后完全相同）/ <b>有出入</b>（去掉标点后仍不一样，需要逐字看）。差异只做<b>标注</b>，不做"哪版更强、哪版才算正统"的判断 —— 那是官方说了算的事，不该由工具来定。</p>` },
        { h: '二、本库的跨版本底账', html: `
          <p>下面这组数字是打开本页时按本库已收录的各版本武将资料<b>自动统计</b>出来的，不是手写的：</p>
          <div id="kpEvStat"><p class="kp-note">正在统计…</p></div>` },
        { h: '三、查一个武将：它的技能在各版本长什么样', html: `
          <p>输入<b>武将名</b>或<b>技能名</b>（一两个字就够）。命中的武将，会把它在不同版本里的<b>同名技能</b>原文并排摆出来，并把有出入的地方标出来。</p>
          <div class="kp-ev-search">
            <input id="kpEvQ" type="search" placeholder="输入武将名 / 技能名…" autocomplete="off" enterkeyhint="search" aria-label="搜索武将或技能">
            <span id="kpEvCnt" class="kp-ev-cnt"></span>
          </div>
          <div id="kpEvChips" class="kp-ev-chips"></div>
          <div id="kpEvBody" class="kp-ev-body"></div>` }
      ]
    }
  ];
  function renderKepu(topicId) {
    const t = KEPU_TOPICS.find((x) => x.id === topicId) || KEPU_TOPICS[0];
    /* 弹窗只展示被点开的那一节：顶部标题跟着选题走（每张入口卡 = 一个选题） */
    const kt = $('kTitle');
    if (kt) kt.textContent = t.nav || t.short;
    const km = $('kmodal');
    if (km) km.setAttribute('aria-label', t.nav || t.short);
    $('kbody').innerHTML = `
      <div class="kp-head">
        <div class="kp-head-txt">
          <h2>${t.title}</h2>
          <p class="kp-sub">${t.sub}</p>
        </div>
      </div>
      ${t.sections.map(s => `<section class="kp-sec"><h3 class="kai">${s.h}</h3>${s.html}</section>`).join('')}`;
    $('kbody').scrollTop = 0;
    if (t.id === 'evolve') initKepuEvolve();      // 技能沿革：统计 + 交互对照（数据异步加载）
    if (t.id === 'versions2026') initKepuVers();  // 全版本区分：与 data/index.json 对账
    if (t.id === 'series') initKepuSeries();      // 武将类型：系列计数现算（kepu_stats.json）
    if (t.id === 'quickref') initKepuQuickref();  // 线下速查：技能六型计数现算
  }
  function openKepu(topicId) {
    renderKepu(topicId);
    $('kmask').hidden = false;
    $('kmodal').hidden = false;
    document.body.style.overflow = 'hidden';
  }
  function closeKepu() {
    const m = $('kmodal'), k = $('kmask');
    if (m.hidden) return;
    m.classList.add('closing'); k.classList.add('closing');
    setTimeout(() => {
      m.hidden = true; k.hidden = true;
      m.classList.remove('closing'); k.classList.remove('closing');
      document.body.style.overflow = '';
    }, 170);
  }
  $('kmask').addEventListener('click', closeKepu);
  $('kclose').addEventListener('click', closeKepu);
  $('kbody').addEventListener('click', (e) => {          // 技能沿革：武将对照（选题 Tab 已取消，每个选题走首页独立入口）
    const pick = e.target.closest('[data-kpev-hero]');
    if (pick) { kpEvPick(pick.dataset.kpevHero); }
  });
  $('kbody').addEventListener('input', (e) => {          // 技能沿革：搜索框（委托，选项重建也不丢绑定）
    if (e.target && e.target.id === 'kpEvQ') kpEvSearch(e.target.value);
  });

  /* ============ 三国史料学习（内嵌模块 · 逻辑全在 history.js 的 HISTORY_MODULE） ============
     模块自成一体：只读 data/history/，与游戏库数据完全隔离（模块内已写明免责声明）。
     挂载到 #hpageBody（.dm-body，天然可滚动），关闭时 unmount 解绑事件、清空容器。 */
  async function openHistory() {
    $('hmask').hidden = false;
    $('hmodal').hidden = false;
    document.body.style.overflow = 'hidden';
    if (window.HISTORY_MODULE) {
      try { await window.HISTORY_MODULE.mount($('hpageBody')); }
      catch (e) { $('hpageBody').innerHTML =
        '<p style="color:var(--ink3);text-align:center;padding:40px 0">史料模块加载失败：' + (e && e.message) + '</p>'; }
    } else {
      $('hpageBody').innerHTML =
        '<p style="color:var(--ink3);text-align:center;padding:40px 0">史料模块未就绪（history.js 未加载）</p>';
    }
  }
  function closeHistory() {
    const m = $('hmodal'), k = $('hmask');
    if (m.hidden) return;
    m.classList.add('closing'); k.classList.add('closing');
    setTimeout(() => {
      m.hidden = true; k.hidden = true;
      m.classList.remove('closing'); k.classList.remove('closing');
      if (window.HISTORY_MODULE) window.HISTORY_MODULE.unmount();
      $('hpageBody').innerHTML = '';
      document.body.style.overflow = '';
    }, 170);
  }
  $('hmask').addEventListener('click', closeHistory);
  $('hclose').addEventListener('click', closeHistory);

  /* ============ 技能沿革（科普第 6 选题 · 跨版本技能对照） ============
     数据 data/skill_evolution.json（v2/build_skill_evolution.py 生成；跨 >=2 版的武将，数量见 meta.heroes）。
     口径：按【武将基础名】聚合（去掉「界」前缀），同一版本内的标 / 界两条记录都保留。
     差异三档：same 完全一致 / wording 仅措辞（去标点空白后相同）/ real 有出入。
     real 的做字符级 LCS 高亮 —— 以收录顺序里第一个版本为基准，标出其余版本相对它增改的片段。
     只呈现原文与差异，不判断"哪版才算正统"。 */
  const KP_EV_ORDER = ['sgsol', 'msgs', 'sgs', 'hlsgs', 'gjf', 'wxmini', 'unreleased'];
  const KP_EV_HOT = ['刘备', '关羽', '张飞', '赵云', '马超', '曹操', '诸葛亮', '孙权', '司马懿', '吕布', '貂蝉', '华佗'];
  const KP_EV_BADGE = {
    same: ['各版一致', 'ev-same'], wording: ['仅措辞不同', 'ev-word'],
    real: ['有出入', 'ev-real'], single: ['仅 1 版收录', 'ev-single']
  };
  const KP_EV = { data: null, loading: false, hero: null, q: '', idx: null, official: [] };

  /* 归一化：去空白 + 去全部标点 —— 只用于判断「是不是只换了写法」，不用于展示 */
  function kpEvNorm(s) {
    return String(s || '')
      .replace(/[\s\u3000]+/g, '')
      .replace(/[，。、；：！？…—～·,.;:!?"'「」『』【】（）()《》〈〉\[\]{}<>+\-*\/|]/g, '');
  }

  /* 字符级 LCS diff：返回 [[type, text]…]，type 0=两边都有 1=仅基准 2=仅对比项 */
  function kpEvDiff(a, b) {
    const A = Array.from(a || ''), B = Array.from(b || '');
    const n = A.length, m = B.length;
    if (!n || !m || n * m > 200000) return [[2, b || '']];   // 超长整段标出，避免卡顿
    const W = m + 1;
    const dp = new Uint8Array((n + 1) * W);
    for (let i = n - 1; i >= 0; i--) {
      const cur = i * W, nxt = cur + W;
      for (let j = m - 1; j >= 0; j--) {
        dp[cur + j] = A[i] === B[j] ? 3 : (dp[nxt + j] >= dp[cur + j + 1] ? 1 : 2);
      }
    }
    const out = [];
    const push = (t, ch) => {
      const last = out[out.length - 1];
      if (last && last[0] === t) last[1] += ch; else out.push([t, ch]);
    };
    let i = 0, j = 0;
    while (i < n && j < m) {
      const d = dp[i * W + j];
      if (d === 3) { push(0, A[i]); i++; j++; }
      else if (d === 1) { push(1, A[i]); i++; }
      else { push(2, B[j]); j++; }
    }
    while (i < n) push(1, A[i++]);
    while (j < m) push(2, B[j++]);
    return out;
  }

  /* 某武将跨版技能按【技能名】归拢：技能名 -> [{v, jie, t, d}…]（版本顺序，标在界前） */
  function kpEvGroups(h) {
    const map = new Map();
    KP_EV_ORDER.forEach((v) => {
      const recs = (h.v && h.v[v]) || [];
      recs.slice().sort((a, b) => a.j - b.j).forEach((r) => {
        (r.s || []).forEach((s) => {
          if (!map.has(s.n)) map.set(s.n, []);
          map.get(s.n).push({ v: v, jie: r.j ? 1 : 0, t: s.t, d: s.d });
        });
      });
    });
    return map;
  }
  function kpEvLevel(list) {
    if (list.length < 2) return 'single';
    if (new Set(list.map((x) => x.d)).size === 1) return 'same';
    return new Set(list.map((x) => kpEvNorm(x.d))).size === 1 ? 'wording' : 'real';
  }

  /* 单个武将的对照视图 */
  function kpEvHeroCard(h) {
    if (!h) return '<p class="kp-note">没找到这个武将 —— 它可能只在一个版本里收录（单版本没有"沿革"可对比）。</p>';
    const groups = kpEvGroups(h);
    const nv = Object.keys(h.v).length;
    let realN = 0, sameN = 0;
    const rows = [];
    groups.forEach((list, name) => {
      const lv = kpEvLevel(list);
      if (lv === 'real') realN++; else if (lv !== 'single') sameN++;
      const badge = KP_EV_BADGE[lv];
      const dup = {};
      list.forEach((x) => { dup[x.v] = (dup[x.v] || 0) + 1; });
      const base = list[0];
      const k0 = KIND[list[0].t];
      const line = list.map((x) => {
        let body, rw = false;
        if (lv === 'real' && x !== base) {
          /* 字符级高亮只保留「两边都有」与「本版新增/改动」两段 ——
             基准版独有的片段必须丢掉，否则两版文字会交错成读不通的乱文。
             另外：若丢掉后剩下的字不足本版原文的 70%，说明这句基本是重写的，
             逐字高亮只会更乱，此时整段标注、原文照登。 */
          const segs = kpEvDiff(base.d, x.d);
          const kept = segs.reduce((n, s) => n + (s[0] === 1 ? 0 : s[1].length), 0);
          const ratio = x.d && x.d.length ? kept / x.d.length : 1;
          if (ratio >= 0.7) {
            body = segs.filter((s) => s[0] !== 1).map((seg) =>
              seg[0] === 2 ? '<mark class="kp-ev-hl">' + esc(seg[1]) + '</mark>' : esc(seg[1])).join('');
          } else {
            body = esc(x.d || '');
            rw = true;
          }
        } else {
          body = esc(x.d || '（原文缺失）');
        }
        const tag = dup[x.v] > 1
          ? '<b class="kp-ev-jie' + (x.jie ? '' : ' ev-biao') + '">' + (x.jie ? '界' : '标') + '</b>' : '';
        /* 官方客户端直出的版本（国际服 / 小程序）加「原文」小标：这两版的措辞与其余四版的
           "库内人工润色版"不同源，标出来才不会把"官方另一种写法"读成"规则出入"。 */
        const off = KP_EV.official.indexOf(x.v) >= 0 ? '<b class="kp-ev-off">原文</b>' : '';
        return '<div class="kp-ev-row' + (x === base ? ' is-base' : '') + (rw ? ' is-rewrite' : '') + '">' +
          '<span class="kp-ev-vt">' + esc(VN[x.v] || x.v) + tag + off + '</span>' +
          '<span class="kp-ev-vd">' + body + '</span></div>';
      }).join('');
      rows.push('<div class="kp-ev-sk">' +
        '<div class="kp-ev-skhead"><b class="kai">' + esc(name) + '</b>' +
        (k0 ? '<span class="kind ' + k0[1] + '">' + k0[0] + '</span>' : '') +
        '<span class="kp-ev-badge ' + badge[1] + '">' + badge[0] + '</span></div>' +
        '<div class="kp-ev-rows">' + line + '</div></div>');
    });
    const head = '<div class="kp-ev-hero"><b class="kai">' + esc(h.n) + '</b>' +
      (KN[h.k] ? '<span class="kp-ev-k">' + KN[h.k] + '</span>' : '') +
      '<span class="kp-ev-vn">收录于 ' + nv + ' 个版本</span>' +
      (realN ? '<span class="kp-ev-badge ev-real">' + realN + ' 个技能有出入</span>'
             : '<span class="kp-ev-badge ev-same">技能全一致</span>') +
      '</div>';
    const tip = '<p class="kp-ev-tip">同一技能名并排。<mark class="kp-ev-hl">高亮</mark> = 该版本相对<b>基准版</b>' +
      '（每个技能取收录顺序最靠前的版本）多出或改动的那几个字；未高亮的文字各版相同。<b class="kp-ev-rw">版本名标红</b>' +
      '= 这一句与基准版差得太多、逐字对照反而读不通，原文照登。原文里的换行照原样保留。</p>' +
      (KP_EV.official.length
        ? '<p class="kp-note">带 <b class="kp-ev-off">原文</b> 小标的版本（' +
          KP_EV.official.map((v) => esc(VN[v] || v)).join(' / ') +
          '）直接取自官方客户端配置表、未做人工润色，措辞与其它版本本就不同源 —— 它的"出入"里有一部分只是官方另一种写法。</p>'
        : '');
    return head + tip + rows.join('');
  }

  /* 底账统计（全部读自数据文件，非手写） */
  function kpEvStatHtml(d) {
    const m = d.meta;
    const cnt = {};
    d.heroes.forEach((h) => { const k = Object.keys(h.v).length; cnt[k] = (cnt[k] || 0) + 1; });
    const dist = Object.keys(cnt).sort().map((k) => k + ' 版 ' + cnt[k] + ' 名').join(' · ');
    const pct = (100.0 * m.diffPairs / Math.max(1, m.pairs)).toFixed(1);
    return '<table class="kp-table"><tbody>' +
      '<tr><td class="kt-k">收录版本</td><td>' + m.versions.map((v) =>
        esc(VN[v] || v) + ((m.official || []).indexOf(v) >= 0 ? '<b class="kp-ev-off">原文</b>' : '')).join(' / ') + '</td></tr>' +
      '<tr><td class="kt-k">跨 ≥2 版的武将</td><td><b>' + m.heroes + '</b> 名（' + esc(dist) + '）</td></tr>' +
      '<tr><td class="kt-k">可对照的同名技能</td><td><b>' + m.pairs + '</b> 对</td></tr>' +
      '<tr><td class="kt-k">其中描述有出入</td><td><b>' + m.diffPairs + '</b> 对（' + pct + '%）· 涉及 <b>' + m.heroesWithDiff + '</b> 名武将</td></tr>' +
      '</tbody></table>' +
      '<p class="kp-note">数据更新至 <b>' + esc(m.generated) + '</b>，来源 <b>' + esc(m.source) + '</b>（同名的标 / 界算同一个人）。' +
      '只统计<b>同名技能</b> —— 改过名字的技能无法配对；只在一个版本收录的武将自己没有"沿革"，不计入。</p>';
  }

  function kpEvIndex() {
    if (KP_EV.idx) return KP_EV.idx;
    KP_EV.idx = KP_EV.data.heroes.map((h) => {
      let s = h.n;
      Object.keys(h.v).forEach((v) => (h.v[v] || []).forEach((r) => (r.s || []).forEach((x) => { s += '|' + x.n; })));
      return { h: h, s: s.toLowerCase() };
    });
    return KP_EV.idx;
  }
  function kpEvMatch(kw) {
    const q = (kw || '').trim().toLowerCase();
    if (!q) return [];
    return kpEvIndex().filter((x) => x.s.indexOf(q) >= 0).map((x) => x.h);
  }
  function kpEvChips(kw) {
    const box = $('kpEvChips');
    if (!box) return;
    const names = kw
      ? kpEvMatch(kw).slice(0, 24).map((h) => h.n)
      : KP_EV_HOT.filter((n) => KP_EV.data.heroes.some((h) => h.n === n));
    if (!names.length) {
      box.innerHTML = '<span class="kp-ev-none">没有匹配的武将 —— 试试只输一个字，或改输技能名（如「仁德」）</span>';
      return;
    }
    box.innerHTML = names.map((n) =>
      '<button class="kp-ev-chip' + (KP_EV.hero && KP_EV.hero.n === n ? ' active' : '') +
      '" data-kpev-hero="' + esc(n) + '" type="button">' + esc(n) + '</button>').join('');
  }
  function kpEvBody() {
    const el = $('kpEvBody');
    if (el) el.innerHTML = kpEvHeroCard(KP_EV.hero);
  }
  function kpEvSearch(kw) {
    KP_EV.q = kw || '';
    const q = KP_EV.q.trim();
    if ($('kpEvCnt')) $('kpEvCnt').textContent = q ? '命中 ' + kpEvMatch(q).length + ' 名' : '';
    kpEvChips(q);
    if (q) {                                   // 唯一命中就直接切过去，省一次点击
      const hit = kpEvMatch(q);
      if (hit.length === 1 && KP_EV.hero !== hit[0]) { KP_EV.hero = hit[0]; kpEvBody(); }
    }
  }
  function kpEvPick(name) {
    if (!KP_EV.data) return;
    const h = KP_EV.data.heroes.find((x) => x.n === name);
    if (!h) return;
    KP_EV.hero = h;
    kpEvChips(KP_EV.q.trim());
    kpEvBody();
  }
  function kpEvPaint() {
    const d = KP_EV.data;
    if (!d) return;
    if ($('kpEvStat')) $('kpEvStat').innerHTML = kpEvStatHtml(d);
    if (!KP_EV.hero) KP_EV.hero = d.heroes.find((h) => h.n === '刘备') || d.heroes[0];
    KP_EV.idx = null;
    kpEvChips(KP_EV.q.trim());
    kpEvBody();
  }
  /* 本图鉴收录对账（「全版本区分」第七节）：拿 data/index.json 实际收录的版本
     与 KEPU_VERS 比 —— 图鉴里有、本文没写 → 标「待补充」；本文写了、图鉴没有 → 单独列。
     这样以后接入新版本库时，打开这页就能立刻看到"哪一节还没补"，不会漏。 */
  function initKepuVers() {
    const box = $('kpVerAudit');
    if (!box) return;
    if (!INDEX.length) { box.innerHTML = '<p class="kp-note">版本清单尚未载入完成，关掉重开本页即可。</p>'; return; }
    const books = KEPU_VERS.map((v) => v.id);
    const libs = INDEX.filter((v) => !KEPU_NONVER.includes(v.id));
    const rows = libs.map((v) => {
      const ok = books.includes(v.id);
      return `<tr><td class="kt-k">${v.label}</td><td class="kt-nw">${v.short}</td>`
        + `<td class="kt-nw">${v.count}</td>`
        + `<td>${ok ? '已介绍' : '<span class="kp-warn">⚠ 本文待补充</span>'}</td></tr>`;
    }).join('');
    const notInLib = KEPU_VERS.filter((v) => !INDEX.some((x) => x.id === v.id));
    box.innerHTML = `<table class="kp-table">
        <thead><tr><th>图鉴中的版本</th><th>简称</th><th>武将数</th><th>本文状态</th></tr></thead>
        <tbody>${rows}</tbody></table>`
      + (notInLib.length
        ? `<p class="kp-note">另：本文已介绍、但本图鉴暂未收录 —— ${notInLib.map((v) => v.name).join('、')}。</p>`
        : '')
      + '<p class="kp-note">本表由图鉴数据自动生成，收录数与图鉴完全一致。若某版本出现「待补充」，说明对应的版本介绍还没写完。</p>';
  }

  function initKepuEvolve() {
    if (KP_EV.data) { kpEvPaint(); return; }
    if (KP_EV.loading) return;
    KP_EV.loading = true;
    fetchJSON(vq(DATA_DIR + 'skill_evolution.json'))
      .then((d) => { KP_EV.data = d; KP_EV.official = (d.meta && d.meta.official) || []; KP_EV.loading = false; kpEvPaint(); })
      .catch((e) => {
        KP_EV.loading = false;
        const s = $('kpEvStat');
        if (s) s.innerHTML = '<p class="kp-note">跨版本数据加载失败：' + esc(e && e.message ? e.message : '未知错误') + '</p>';
      });
  }

  /* ---- 科普统计（「武将类型」与「线下速查」两节共用）----
     数据来自 data/kepu_stats.json，由 v2/build_kepu_stats.py 从各版本 characters.json 现算。
     以前这里写的是手抄的四版计数（还带着某个日期），每加一个版本库就得回来手改一遍；
     改成现算 + 异步渲染后，加库只需重跑脚本。加载失败时只提示、不留空白表。 */
  const KP_ST = { data: null, loading: false, q: [] };
  function kepuStats(cb, fail) {
    if (KP_ST.data) { cb(KP_ST.data); return; }
    KP_ST.q.push([cb, fail]);
    if (KP_ST.loading) return;
    KP_ST.loading = true;
    fetchJSON(vq(DATA_DIR + 'kepu_stats.json'))
      .then((d) => {
        KP_ST.data = d; KP_ST.loading = false;
        KP_ST.q.splice(0).forEach((p) => p[0](d));
      })
      .catch((e) => {
        KP_ST.loading = false;
        KP_ST.q.splice(0).forEach((p) => p[1] && p[1](e));
      });
  }
  /* 系列「出现版本」文案：全都有 → 各版本均有；只有一个 → 仅 XX；否则简称并列 */
  function kpVerText(r, nAll) {
    if (r.libs.length === nAll) return '各版本均有';
    if (r.libs.length === 1) return '<b>仅 ' + esc(r.libs[0].short) + '</b>';
    return r.libs.map((x) => esc(x.short)).join(' · ');
  }
  const kpFailRow = (cols, e) =>
    `<tr><td colspan="${cols}" class="kp-note">统计数据加载失败：${esc(e && e.message ? e.message : '未知错误')}</td></tr>`;
  /* 「武将类型」第一节的系列表 + 各版本数量（原来是手写数字） */
  function initKepuSeries() {
    const fail = (e) => { const b = $('kpSeriesBody'); if (b) b.innerHTML = kpFailRow(4, e); };
    kepuStats((d) => {
      const b = $('kpSeriesBody');
      if (!b) return;
      b.innerHTML = d.series.map((r) =>
        `<tr><td class="kt-k">${esc(r.key)}</td><td>${esc(r.official)}</td>`
        + `<td>${kpVerText(r, d.libs.length)}</td><td class="kt-nw">${r.total}</td></tr>`).join('');
      const dt = $('kpSeriesDetail');
      if (dt) {
        dt.innerHTML = `数字按 <b>${d.libs.length}</b> 个版本的实际武将统计，会随版本更新而变动。<b>各版本数量</b>（`
          + d.libs.map((l) => esc(l.short)).join(' / ') + '）：'
          + d.series.map((r) => esc(r.key) + ' '
            + d.libs.map((l) => r.byLib[l.id] || '—').join(' / ')).join(' · ') + '。';
      }
      const jie = $('kpSeriesJie');
      const jr = d.series.find((r) => r.key === '界');
      if (jie && jr) {
        jie.innerHTML = `（共 ${jr.total} 名：`
          + jr.libs.map((x) => `${esc(x.short)} ${x.n}`).join(' / ') + '）';
      }
    }, fail);
  }
  /* 「线下速查」技能六型表：数量列现算（类型名/谁发起/怎么认仍是静态知识） */
  function initKepuQuickref() {
    const fail = (e) => { const b = $('kpKindBody'); if (b) b.innerHTML = kpFailRow(4, e); };
    kepuStats((d) => {
      const b = $('kpKindBody');
      if (!b) return;
      b.innerHTML = d.skillKinds.map((k) =>
        `<tr><td class="kt-k">${esc(k.label)}</td><td class="kt-nw">${k.count}</td>`
        + `<td class="kt-nw">${esc(k.who)}</td><td>${k.how}</td></tr>`).join('');
    }, fail);
  }

  /* ============ 面杀速查（线下辅助：输入武将 → 技能三行卡） ============
     与「三国杀科普」的分工：科普讲读法（方法论），这里给具体武将的现成答案。
     数据不新增任何文件 —— 直接筛当前版本已加载的 G（标准版 + 神话再临）。
     三行 = 谁主动（type 字段）/ 什么时候（qrWhen 按原文前缀提取）/ 原文。
     刻意不做「前提/结果」的二次加工：拆错了线下会拿着错解读吵架，
     宁可把官方原文原样摆出来，当最终判据。 */

  /* 经典包识别：各端命名不同（十周年「标准-XXX」「神话再临-X包」、
     移动版「标准包」、OL「标准」「风林火山」、欢乐杀「标·主」「标·虎」），
     统一用 gr 关键字匹配。写明「界限突破」的分组直接排除；
     十周年界将与原版同组、gr 分不开，由 classicList 按名字前缀补排。 */
  function isClassicGr(gr) {
    const s = gr || '';
    if (/界限突破|界一将|界·/.test(s)) return false;
    return /标准|神话再临|风林火山|标·/.test(s);
  }

  /* type → 「谁主动」一行（线下人话） */
  const QR_WHO = {
    active: '轮到相关阶段你自己发动；不吭声就是不发',
    passive: '先等条件发生（挨打／出牌／被指定），才轮到你决定发不发',
    lock: '条件一到自动生效，没有「不发动」这个选项',
    limited: '整局只能发动 1 次，时机你自己挑',
    awakening: '满足条件后强制触发，不能拒绝',
    transform: '一阴一阳两个形态，发动一次翻一次面'
  };

  /* 时机提取：按优先级匹配技能原文。规则顺序 = 线下判读的确定性顺序：
     明确阶段 > 开局/回合外/特定时点 > 队友视角 > 事件触发 > 转化技 > 持续型 > 通用兜底。
     先特殊后一般（「出牌阶段限一次」必须排在「出牌阶段」前）。 */
  const QR_WHEN = [
    // ① 明确的阶段
    [/^出牌阶段限一次/, '你的出牌阶段，每回合只能 1 次'],
    [/^出牌阶段.{0,6}限一次/, '你的出牌阶段，限 1 次'],
    [/^每轮限一次/, '每轮限 1 次'],
    [/^出牌阶段开始时/, '你的出牌阶段刚开始'],
    [/^出牌阶段/, '你的出牌阶段'],
    [/^准备阶段/, '你的准备阶段（回合刚开始）'],
    [/^判定阶段/, '你的判定阶段'],
    [/^摸牌阶段/, '你的摸牌阶段'],
    [/^弃牌阶段/, '你的弃牌阶段'],
    [/^结束阶段/, '你的结束阶段（回合快结束）'],
    [/^回合开始时/, '你的回合刚开始'],
    [/^回合结束时/, '你的回合结束时'],
    // ② 开局 / 回合外 / 特定时点
    [/^游戏开始时/, '开局时（一次性）'],
    [/回合外/, '别人的回合里（回合外也能用）'],
    [/当你死亡时/, '你死亡时（一次性，之后失效）'],
    [/当你摸牌时/, '你摸牌的时候'],
    [/当你每回合|当每回合首次/, '每回合首次满足条件时'],
    // ③ 队友视角（原文从队友的角度写，如主公技的代劳效果）
    [/其他.+?角色出牌阶段/, '其他角色的出牌阶段（由对方发动）'],
    [/^(其他|所有其他).*?角色可以(?:在|替)/, '你需要使用或打出时（队友可代劳）'],
    // ④ 事件触发——从具体到通用
    [/当你需要使用或打出【(.+?)】时/, '你需要使用或打出【$1】的时候'],
    [/当你受到.{0,6}伤害后/, '你受到伤害之后（体力已扣）'],
    [/当你受到.{0,6}伤害时/, '你受到伤害的时候（还在结算，能改结果）'],
    [/当你造成.{0,6}伤害后/, '你造成伤害之后'],
    [/当你成为【(.+?)】的目标(?:时|后)/, '你被【$1】指定为目标的时候'],
    [/当你成为.+?的目标(?:时|后)/, '你被指定为目标的时候'],
    [/当你于出牌阶段/, '你的出牌阶段'],
    [/当你于回合内/, '你的回合内'],
    [/当你失去(.+?)(?:时|后)/, '你失去$1之后'],
    [/当你使用(.+?)(?:时|后)/, '你使用$1的时候'],
    [/当你打出(.+?)(?:时|后)/, '你打出$1的时候'],
    [/判定牌生效(?:前|后)/, '判定牌生效前／后'],
    [/当其他角色使用.+?结算结束后/, '其他角色使用牌结算结束后'],
    [/^当其他/, '其他角色的相关时点'],
    [/一名角色的回合结束时/, '任意一名角色的回合结束时'],
    [/一名角色的回合开始时/, '任意一名角色的回合开始时'],
    [/^当?一名角色/, '任意一名角色的相关时点'],
    [/濒死/, '有人濒死时'],
    // ⑤ 转化技 / 主动技：自己挑时机
    [/^你可以将/, '你主动时（把一张牌当另一张牌使用）'],
    [/^你可以选择/, '你主动时（自己选时机与选项）'],
    [/^你可以/, '你主动时（自己选时机）'],
    [/^每回合限一次/, '每回合限 1 次（任何人的回合）'],
    // ⑥ 持续型：本来就不需要"发动"
    [/^(你计算|你使用.+?无|你不能|你视为|你使用的|你的|其他.+?势力角色对你)/, '持续生效（无需发动）'],
    [/^全场/, '持续生效（无需发动）'],
    [/^(若|只要)/, '满足条件时持续生效'],
    // ⑦ 通用兜底：把原文里的条件浓缩出来，总比只给一句"满足条件时"有用
    [/^【/, '相关牌结算时（见原文）'],
    [/^当你(.{2,24}?)(?:时|后)/, '你$1的时候'],
    [/出牌阶段/, '涉及出牌阶段（见原文）'],
    [/回合内/, '你的回合内']
  ];

  function qrWhen(desc) {
    let d = desc || '';
    for (let i = 0; i < 3; i++) {          // 逐层剥掉「主公技，锁定技，」这类类型前缀
      const nd = d.replace(/^(主公技|锁定技|觉醒技|限定技|转换技|阵法技|拼点技|隐匿技)[：:，,、\s]+/, '');
      if (nd === d) break;
      d = nd;
    }
    for (const [re, tx] of QR_WHEN) {
      const m = d.match(re);
      if (m) return tx.replace(/\$(\d)/g, (_, i) => m[Number(i)] || '');
    }
    if (d.indexOf('阶段') >= 0) return '按原文所述的阶段发动';
    return '满足条件时';
  }

  /* 经典武将列表：筛不到（如某版本无对应包）时回退全量，避免弹层空白。
     注意十周年把界武将和原版塞进同一个 gr 分组（「标准-灵心慧性」里原版和界华佗各占一半），
     光看 gr 分不开 —— 只能再按名字前缀排一次「界」。界武将不属于线下原版牌面。 */
  function classicList() {
    const hit = G.filter((g) => isClassicGr(g.gr) && !/^界/.test(g.n || ''));
    return hit.length ? hit : G;
  }

  function qrCardHtml(g) {
    const sk = (g.s || []).map((s) => {
      const k = KIND[s.type] || ['技能', 'k-passive'];
      return `<div class="qr-sk"><b>${esc(s.name)}</b><span class="kind ${k[1]}">${k[0]}</span></div>` +
        (QR_WHO[s.type] ? `<div class="qr-row"><span class="qr-l">谁主动</span><span>${QR_WHO[s.type]}</span></div>` : '') +
        `<div class="qr-row"><span class="qr-l">什么时候</span><span>${esc(qrWhen(s.description || ''))}</span></div>` +
        `<div class="qr-row"><span class="qr-l">原文</span><span>${esc(s.description || '（原文缺失）')}</span></div>`;
    }).join('');
    /* 官方技能问答：仅十周年图鉴带（gd.faq，337 名武将），其余三版自然为空、优雅降级。
       用原生 <details> 折叠 —— 线下最常见的"这技能到底怎么算"由官方答案直接兜住。 */
    const faq = (g.gd && g.gd.faq) || [];
    const faqHtml = faq.length
      ? `<details class="qr-faq"><summary>官方问答 ${faq.length} 条</summary>` +
        faq.map((f) => `<div class="qr-fq">Q：${esc(f.q)}</div><div class="qr-fa">A：${esc(f.a)}</div>`).join('') +
        `</details>`
      : '';
    return `<div class="qr-card" data-qn="${esc(g.n)}">` +
      `<div class="qr-nm">${esc(g.n)}<small>${KN[g.k] || ''}${g.gr ? ' · ' + esc(g.gr) : ''}</small></div>${sk}${faqHtml}</div>`;
  }

  const QK = { all: [] };
  function renderQuickList(kw) {
    const q = (kw || '').trim().toLowerCase();
    const hit = q
      ? QK.all.filter((g) => (g.n || '').toLowerCase().includes(q) || (g.t || '').toLowerCase().includes(q)
          || (g.s || []).some((s) => (s.name || '').toLowerCase().includes(q)))
      : QK.all;
    if ($('qrScope')) $('qrScope').innerHTML = `范围：<b>${VN[V.id] || V.short}</b> · 标准版 + 神话再临 共 <b>${QK.all.length}</b> 名` +
      (q ? `，命中 <b>${hit.length}</b> 名` : '');
    if ($('qrList')) $('qrList').innerHTML = hit.length ? hit.map(qrCardHtml).join('')
      : `<div class="qr-empty">没找到「${esc(kw)}」<br>试试只输入姓氏，或换一个技能名</div>`;
  }
  function openQuick() {
    QK.all = classicList();
    $('qbody').innerHTML =
      `<div class="qr-top"><input id="qrInput" class="qr-in" type="search" autocomplete="off" ` +
        `placeholder="输入武将名，如 华佗 / 曹操 / 张飞"><div class="qr-scope" id="qrScope"></div></div>` +
      `<div class="qr-tip">读技能三步：<b>谁主动</b> → <b>什么时候</b> → 对着<b>原文</b>收尾。发不发、几时发、付什么，原文里都有。</div>` +
      `<div class="qr-list" id="qrList"></div>`;
    renderQuickList('');
    $('qmask').hidden = false;
    $('qmodal').hidden = false;
    document.body.style.overflow = 'hidden';
    setTimeout(() => { const i = $('qrInput'); if (i) i.focus(); }, 80);
  }
  function closeQuick() {
    const m = $('qmodal'), k = $('qmask');
    if (!m || m.hidden) return;
    m.classList.add('closing'); k.classList.add('closing');
    setTimeout(() => {
      m.hidden = true; k.hidden = true;
      m.classList.remove('closing'); k.classList.remove('closing');
      document.body.style.overflow = '';
    }, 170);
  }
  $('qmask').addEventListener('click', closeQuick);
  $('qclose').addEventListener('click', closeQuick);
  $('qbody').addEventListener('input', (e) => {          // 输入即过滤（只换列表，不重建 input，避免光标丢失）
    if (e.target.id === 'qrInput') renderQuickList(e.target.value);
  });
  $('modQuick').addEventListener('click', openQuick);

  /* ============ 事件 ============ */
  // TabBar
  document.querySelector('.tabbar').addEventListener('click', (e) => {
    const t = e.target.closest('[data-tab]'); if (!t) return;
    go(t.dataset.tab);
  });

  // 首页
  // 轮播第 1 屏：每日武将 → 开武将详情（拖动过就不算点击，避免误触）
  $('dailyCard').addEventListener('click', () => {
    if (BX.drag && Math.abs(BX.drag.dx) > 10) return;
    if (daily) openInVersion(daily.v, daily.id);
  });
  // 轮播第 2 屏：OL 资讯 → 打开 OL 资讯页（原底部 Tab 入口移到此处）
  $('newsCard').addEventListener('click', () => {
    if (BX.drag && Math.abs(BX.drag.dx) > 10) return;
    go('olnews');
  });
  // 轮播第 3 屏：一将成名（十周年）资讯 → 打开一将成名资讯页
  $('news10Card').addEventListener('click', () => {
    if (BX.drag && Math.abs(BX.drag.dx) > 10) return;
    go('x10news');
  });
  /* 原「快捷双入口」（随机选将 / 武将图谱）已删除（2026-10-14）：
     随机选将与本页「今日精选」轮播重复；武将图谱入口由底部「武将」Tab 承担。
     对应 randomHero() 一并移除。 */
  /* 首页「功能特色」10 张卡 → 各自打开对应内容；科普家族的 6 个选题各自独立入口，
     弹窗只渲染被点开的那一节（见 renderKepu），不再出现选题 Tab 条。 */
  $('modIdentity').addEventListener('click', () => openKepu('identity'));      // 身份局速查
  $('modGz').addEventListener('click', () => openKepu('guozhan'));             // 国战专区
  $('modRank').addEventListener('click', () => openKepu('versions2026'));      // 三国杀科普（只查版本）
  $('modQuickref').addEventListener('click', () => openKepu('quickref'));      // 线下速查
  $('modSeries').addEventListener('click', () => openKepu('series'));          // 武将系列类型
  $('modEvolve').addEventListener('click', () => openKepu('evolve'));          // 技能改革对照
  $('modMode').addEventListener('click', () => openPane('mode'));     // 规则与玩法 → 弹层（原为整页 go('mode')）
  $('modCards').addEventListener('click', () => openPane('cards'));   // 游戏牌种类 → 弹层（原为整页 go('cards')）
  $('modHistory').addEventListener('click', openHistory);        // 三国史料学习（内嵌模块，逻辑见 history.js）

  // 版本行：浏览态 = 切版本；搜索态 = 收窄搜索范围（不再清空搜索词，也不再拉整版 JSON）
  $('vtabs').addEventListener('click', (e) => {
    const t = e.target.closest('[data-v]'); if (!t) return;
    if (isSearching()) {
      const id = t.dataset.v || 'all';
      if (id === state.scope) return;
      state.scope = id;
      GRP_OPEN.clear();          // 换范围 → 同名分组整体变了，折叠状态一并归零
      renderTabs(); render();
      tapFeel(10);
      return;
    }
    if (t.dataset.v === V.id) return;
    close();
    switchVersion(t.dataset.v).then(renderHome);
  });

  // 筛选面板折叠
  $('filterBtn').addEventListener('click', () => {
    if (isSearching()) return;   // 搜索态已置灰（disabled 也会拦住 click），这里双保险
    const opening = !$('fpanel').classList.contains('open');
    setFiltersOpen(opening, true);
  });

  // 筛选
  $('kingdoms').addEventListener('click', (e) => {
    if (e.target.closest('[data-new]')) { toggleRecent(); return; }   // 「最新 10」：势力行第一项
    const t = e.target.closest('[data-k]'); if (!t) return;
    state.newOnly = false;   // 点任一势力 = 主动离开「最近更新」，否则筛选看着没反应
    state.kingdom = t.dataset.k; renderFilters(); render();
    tapFeel(10);  // 切换阵营触觉反馈（up/003 二.1）
  });
  $('packRow').addEventListener('click', (e) => {
    const t = e.target.closest('[data-p]'); if (!t) return;
    state.pack = state.pack === t.dataset.p ? null : t.dataset.p;
    state.sub = null;   // 换一级包时二级归零，避免残留一个不属于该包的子灯
    renderFilters(); render();
  });
  const subRowEl = $('packSubRow');
  if (subRowEl) subRowEl.addEventListener('click', (e) => {
    const t = e.target.closest('[data-s]'); if (!t) return;
    const v = t.dataset.s || null;
    state.sub = state.sub === v ? null : v; renderFilters(); render();
  });
  $('roleRow').addEventListener('click', (e) => {
    const t = e.target.closest('[data-r]'); if (!t) return;
    state.role = state.role === t.dataset.r ? null : t.dataset.r; renderFilters(); render();
  });
  $('levelRow').addEventListener('click', (e) => {
    const t = e.target.closest('[data-l]'); if (!t) return;
    state.level = state.level === t.dataset.l ? null : t.dataset.l; renderFilters(); render();
  });
  $('futRow').addEventListener('click', () => {
    state.fut = !state.fut; renderFilters(); render();
  });
  let timer = null;
  $('q').addEventListener('input', (e) => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      state.q = e.target.value;
      if (!state.q.trim()) { state.scope = 'all'; GRP_OPEN.clear(); }   // 清空搜索 = 范围回「全部」
      renderFilters();
      render();
      // 首次搜索时索引可能还在预取路上：render 会先显示「正在载入」，就绪后再重绘一次出结果
      if (isSearching()) ensureSearchIndex().then(() => { if (isSearching()) render(); });
    }, 150);  // 即时搜索 150ms 防抖（up/003 一.3）
  });
  $('clearBtn').addEventListener('click', () => {
    state.kingdom = 'all'; state.pack = state.sub = state.role = state.level = null; state.fut = false; state.q = '';
    state.scope = 'all'; GRP_OPEN.clear();
    state.newOnly = false;
    $('q').value = ''; renderFilters(); render();
  });
  $('grid').addEventListener('click', (e) => {
    const grp = e.target.closest('[data-grp]');      // 同名跨版：原地展开/收起，不进详情
    if (grp) {
      const n = grp.dataset.grp;
      if (GRP_OPEN.has(n)) GRP_OPEN.delete(n); else GRP_OPEN.add(n);
      render();
      return;
    }
    const c = e.target.closest('[data-id]');
    if (!c) return;
    // 跨版本命中：原地打开那位武将的详情，不切版本 Tab（页面停在搜索结果上继续翻看）
    open(c.dataset.id, c.dataset.v || V.id);
  });

  // 今日精选（首页横滑）
  $('pickRow').addEventListener('click', (e) => {
    const c = e.target.closest('.pick'); if (!c) return;
    openInVersion(c.dataset.pv, c.dataset.pid);
  });

  // 收藏行（含右上角快捷移除）
  $('favRow').addEventListener('click', (e) => {
    const rm = e.target.closest('.fav-x');
    if (rm) {
      const [v, id] = (rm.dataset.rm || '').split('|');
      safeSet(sk(FAV_KEY), JSON.stringify(favs().filter((f) => !(f.v === v && f.id === id))));
      renderFavs(); renderFavBtn(); renderPstats();
      syncSoon();  // 登录态：移除收藏写入本机账号档案
      toast('已移除收藏');
      return;
    }
    const c = e.target.closest('.favcard'); if (!c) return;
    close();
    openInVersion(c.dataset.v, c.dataset.id).then(() => go('heroes'));
  });
  // 空态引导按钮
  $('goExplore').addEventListener('click', () => go('heroes'));

  // 战术心法：分类筛选 + 手风琴开合
  $('sccats').addEventListener('click', (e) => {
    const b = e.target.closest('[data-cat]'); if (!b) return;
    const cat = b.dataset.cat;
    for (const x of document.querySelectorAll('#sccats .chip')) {
      x.classList.toggle('active', x === b);
    }
    for (const art of document.querySelectorAll('#scrolls .scroll')) {
      art.hidden = cat !== 'all' && art.dataset.cat !== cat;
    }
  });
  $('scrolls').addEventListener('click', (e) => {
    const head = e.target.closest('.sc-head'); if (!head) return;
    head.parentElement.classList.toggle('open');
  });

  // 仅 Wi-Fi 加载高清资源
  function renderWifi() {
    $('wifiSwitch').setAttribute('aria-pressed', safeGet(WIFI_KEY) === '1' ? 'true' : 'false');
  }
  $('wifiSwitch').addEventListener('click', () => {
    const on = safeGet(WIFI_KEY) === '1';
    safeSet(WIFI_KEY, on ? '0' : '1');
    renderWifi();
    syncSoon();  // 登录态：流量偏好写入本机账号档案
    toast(on ? '已关闭 · 任何时候加载高清资源' : '已开启 · 弱网时立绘降级、语音暂停');
  });
  renderWifi();

  // 本地缓存估算与清理
  function fmtMB(bytes) { return (bytes / 1048576).toFixed(1) + ' MB'; }
  async function renderStorage() {
    const label = $('cacheLabel');
    try {
      if (navigator.storage && navigator.storage.estimate) {
        const { usage } = await navigator.storage.estimate();
        label.textContent = `本地缓存（约 ${fmtMB(usage || 0)}）`;
      } else {
        label.textContent = '本地缓存（由浏览器管理）';
      }
    } catch (e) { label.textContent = '本地缓存（由浏览器管理）'; }
  }
  $('cacheBtn').addEventListener('click', async () => {
    const btn = $('cacheBtn');
    btn.classList.add('loading'); btn.disabled = true;
    let cleared = 0;
    try {
      if (window.caches && caches.keys) {
        const keys = await caches.keys();
        for (const k of keys) { await caches.delete(k); cleared++; }
      }
    } catch (e) { /* 忽略 */ }
    btn.classList.remove('loading'); btn.disabled = false;
    renderStorage();
    toast(cleared ? `已清理 ${cleared} 项缓存存储` : '缓存存储已清空 · 图片 HTTP 缓存由浏览器管理');
  });

  // 主题 / 数据检测
  $('themeSeg').addEventListener('click', (e) => {
    const b = e.target.closest('[data-theme]'); if (b) applyTheme(b.dataset.theme);
  });
  $('checkBtn').addEventListener('click', async () => {
    $('checkBtn').disabled = true;
    $('checkBtn').classList.add('loading');
    $('checkNote').textContent = '正在检测版本清单…';
    try {
      const idx = await fetchJSON(INDEX_URL);
      const vs = idx.versions || [];
      $('checkNote').textContent = `检测完成 · ${vs.map((v) => `${v.label} ${v.count} 名`).join(' · ')}`;
    } catch (err) {
      $('checkNote').textContent = '检测失败：' + err.message;
    }
    $('checkBtn').disabled = false;
    $('checkBtn').classList.remove('loading');
  });

  // 详情
  $('favBtn').addEventListener('click', toggleFav);
  $('shareBtn').addEventListener('click', shareCard);
  $('mask').addEventListener('click', close);
  $('closeBtn').addEventListener('click', close);
  document.addEventListener('keydown', (e) => {
    if (!$('lmodal').hidden) {           // 登录弹窗最上层
      if (e.key === 'Escape') closeLogin();
      return;
    }
    if (!$('kmodal').hidden) {           // 三国杀科普弹窗
      if (e.key === 'Escape') closeKepu();
      return;
    }
    if (!$('hmodal').hidden) {           // 三国史料学习（内嵌模块；内部的卡片弹层自行处理 Esc）
      if (e.key === 'Escape') {
        const inner = $('hpageBody').querySelector('#hModal');
        if (inner && !inner.hidden) { inner.hidden = true; }
        else closeHistory();
      }
      return;
    }
    if (!$('qmodal').hidden) {           // 面杀速查弹窗
      if (e.key === 'Escape') closeQuick();
      return;
    }
    if (!$('admodal').hidden) {          // 本地账号与数据管理抽屉
      if (e.key === 'Escape') closeAccountPanel();
      return;
    }
    if (!$('dmodal').hidden) {           // 免责声明弹窗
      if (e.key === 'Escape') closeDisclaimer();
      return;
    }
    if (!$('gmmodal').hidden) {          // 术语速览弹窗
      if (e.key === 'Escape') closeGlossary();
      return;
    }
    if (!$('cdmodal').hidden) {          // 卡牌详情弹窗（牌库）
      if (e.key === 'Escape') closeCard();
      return;
    }
    if (!$('olmodal').hidden) {           // OL 资讯详情弹窗
      if (e.key === 'Escape') closeOlNews();
      return;
    }
    if (!$('skview').hidden) {
      if (e.key === 'Escape') closeSkins();
      if (e.key === 'ArrowLeft') skinStep(-1);
      if (e.key === 'ArrowRight') skinStep(1);
      return;
    }
    if (e.key === 'Escape') close();
    if (e.key === 'Enter' && document.activeElement === $('dailyCard') && daily) openInVersion(daily.v, daily.id);
  });

  // 皮肤查看器
  $('skClose').addEventListener('click', closeSkins);
  $('skview').addEventListener('click', (e) => { if (e.target === $('skview')) closeSkins(); });
  $('skPrev').addEventListener('click', () => skinStep(-1));
  $('skNext').addEventListener('click', () => skinStep(1));

  /* 吸顶头块 · 状态栏避让（沉浸式全屏下 sticky top:0 会顶到屏幕最上沿、被状态栏压住）。
     用 1px 哨兵探知「头块是否已吸顶」：哨兵滚出视口 = 头块粘住 → 加 .stuck
     （CSS 侧补足状态栏高度的 padding，并用等量负 margin 抵消高度增量，滚动不跳动）；
     滚回页顶、哨兵重新可见即撤掉，避免页头与头块之间凭空多出空白。 */
  (function initHtopStuck() {
    const htop = document.querySelector('.htop');
    if (!htop || typeof IntersectionObserver !== 'function') return;
    const sen = document.createElement('i');
    sen.setAttribute('aria-hidden', 'true');
    sen.style.cssText = 'display:block;height:1px;margin-bottom:-1px;pointer-events:none';
    htop.parentNode.insertBefore(sen, htop);
    new IntersectionObserver((entries) => {
      htop.classList.toggle('stuck', !entries[0].isIntersecting);
    }, { threshold: 0 }).observe(sen);
  })();

  // 全局滚动：虚拟列表布局 + htop 沉浸式折叠（up/003 三.1）
  // 锚点累计判定 + 折叠冷却期：移动端 Chrome 滚动锚定会产生 ±30px 以上的抖动，
  // 单帧方向判定会反复横跳；折叠建立后 600ms 内忽略反向信号，真反向累计 -40px 才还原
  let foldAnchor = 0, foldedAt = 0;
  window.addEventListener('scroll', () => {
    vgSchedule();
    const sy = window.scrollY;
    if (document.body.dataset.tab === 'heroes') {
      const htop = document.querySelector('.htop');
      if (htop) {
        const isFolded = htop.classList.contains('folded');
        const dy = sy - foldAnchor;
        if (sy <= 4) { htop.classList.remove('folded'); foldAnchor = sy; }
        else if (!isFolded && dy > 40) { htop.classList.add('folded'); foldAnchor = sy; foldedAt = Date.now(); }
        else if (isFolded && dy < -40 && Date.now() - foldedAt > 600) { htop.classList.remove('folded'); foldAnchor = sy; }
      }
    }
  }, { passive: true });
  // 视口变化：重新度量虚拟列表 + 墨点位置
  window.addEventListener('resize', () => { vgMeasure(); VG.lastKey = ''; vgSchedule(); placeTabDot(); });
  // 详情弹窗手势（仅下拉关闭；左右滑动切换相邻武将已取消）
  initSheetGestures();
  // A-Z 索引条
  initPybar();

  /* ============ 背景音乐（大厅曲 · 循环播放） ============
     音源 audio/bgm-outgame.v1.mp3 —— 小程序「大厅音乐」的 outgame 曲，
     32 秒短循环，已做首尾 1.5 秒交叉淡化（听感无缝）。
     默认开启；「我的 → 偏好与设置 → 背景音乐」可长期关闭（存档 sgs.bgm=0，
     之后每次启动都不播）。与台词语音互斥，切后台自动暂停、回前台续播。 */
  const BGM_KEY = 'sgs.bgm';
  const BGM_URL = 'audio/bgm-outgame.v1.mp3';
  const BGM_VOL = 0.32;                       // 背景乐压低，不抢台词
  const BGM_FADE_IN = 1400, BGM_FADE_OUT = 700;
  const BGM = { el: null, tick: 0, ducked: false, started: false };

  function bgmOn() { return safeGet(BGM_KEY) !== '0'; }

  /* 音量渐变：stop=true 时渐到 0 后暂停（避免硬切爆音） */
  function bgmFadeTo(target, ms, stop) {
    const el = BGM.el;
    if (!el) return;
    clearInterval(BGM.tick); BGM.tick = 0;
    const from = el.volume;
    if (!ms) { el.volume = target; if (stop) el.pause(); return; }
    const steps = Math.max(1, Math.round(ms / 40));
    let i = 0;
    BGM.tick = setInterval(() => {
      i++;
      el.volume = Math.max(0, Math.min(1, from + (target - from) * (i / steps)));
      if (i >= steps) {
        clearInterval(BGM.tick); BGM.tick = 0;
        el.volume = target;
        if (stop) el.pause();
      }
    }, 40);
  }

  function bgmPlay() {
    if (!bgmOn() || BGM.ducked || document.hidden) return;
    if (!BGM.el) {
      BGM.el = new Audio(BGM_URL);
      BGM.el.loop = true;                     // 单曲循环
      BGM.el.preload = 'auto';
      BGM.el.volume = 0;
    }
    const el = BGM.el;
    if (!el.paused && el.volume > 0) return;  // 已在播就不重入
    el.play().then(() => {
      bgmFadeTo(BGM_VOL, BGM_FADE_IN);
    }).catch(() => {
      bgmArmGesture();                        // 浏览器自动播放被拦 → 等第一次点触
    });
  }

  function bgmPause(ms) {
    if (!BGM.el || BGM.el.paused) return;
    bgmFadeTo(0, ms == null ? BGM_FADE_OUT : ms, true);
  }

  let bgmGestureArmed = false;
  function bgmArmGesture() {
    if (bgmGestureArmed) return;
    bgmGestureArmed = true;
    const kick = () => {
      bgmGestureArmed = false;
      document.removeEventListener('pointerdown', kick, true);
      document.removeEventListener('touchstart', kick, true);
      bgmPlay();
    };
    document.addEventListener('pointerdown', kick, true);
    document.addEventListener('touchstart', kick, true);
  }

  function bgmStart() {                       // 开屏退场后调用一次
    if (BGM.started) return;
    BGM.started = true;
    bgmPlay();
  }

  function bgmDuck(on) {                      // 台词 / 语音抢占音频时让位
    BGM.ducked = !!on;
    if (on) bgmPause(400); else bgmPlay();
  }

  function renderBgm() {
    const b = $('bgmSwitch');
    if (b) b.setAttribute('aria-pressed', bgmOn() ? 'true' : 'false');
  }

  if ($('bgmSwitch')) {
    $('bgmSwitch').addEventListener('click', () => {
      if (bgmOn()) {
        safeSet(BGM_KEY, '0');
        bgmPause(500);
        toast('已关闭背景音乐 · 以后打开也不会播放');
      } else {
        safeSet(BGM_KEY, '1');
        bgmPlay();
        toast('已开启背景音乐');
      }
      renderBgm();
    });
    renderBgm();
  }

  // 切后台主动停（安卓后台本就会掐音频，主动停更省电），回前台续播
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) bgmPause(250);
    else if (BGM.started) bgmPlay();
  });

  // 台词语音播放（单例，点击切换）
  let audio = null, playingBtn = null;
  $('sheetBody').addEventListener('click', (e) => {
    /* 选择器从 '.skins img' 放宽到 '.skins [data-ski]'：
       全量版缩略图是 <img data-ski>，命中自己；轻量版是 <figure data-ski> 文字胶囊，
       里面没有 img，用旧选择器点不动（2026-11-09 接入子体时发现）。 */
    const sk = e.target.closest('.skins [data-ski]');
    if (sk) { openSkins(Number(sk.dataset.ski) || 0); return; }
    /* 标/界 切换：本 app 保持两条独立记录，点击是跳到配对那一条（cp 字段） */
    const jp = e.target.closest('[data-jump]');
    if (jp) {
      const target = jp.dataset.jump;
      if (target && currentDetail) {
        open(target, currentDetail.v);
        const body = $('sheetBody');
        body.classList.remove('sheet-body-swap');
        void body.offsetWidth;
        body.classList.add('sheet-body-swap');
        tapFeel(8);
      }
      return;
    }
    const b = e.target.closest('.vbtn');
    if (!b) return;
    if (audio && playingBtn === b) {
      audio.pause(); audio.currentTime = 0;
      b.textContent = '▶'; b.classList.remove('on');
      audio = playingBtn = null;
      bgmDuck(false);                         // 台词停下，背景乐续播
      return;
    }
    if (audio) { audio.pause(); if (playingBtn) { playingBtn.textContent = '▶'; playingBtn.classList.remove('on'); } }
    bgmDuck(true);                            // 台词优先，背景乐让位
    const urls = (b.dataset.voices || '').split('|').filter(Boolean);
    if (!urls.length) return;
    if (netWeak()) { toast('当前网络较弱 · 已开启「仅 Wi-Fi 加载」，语音暂缓'); return; }
    audio = new Audio(urls[0]);
    playingBtn = b;
    audio.addEventListener('ended', () => {
      const i = urls.indexOf(audio.src) + 1;
      if (i > 0 && i < urls.length) { audio.src = urls[i]; audio.play().catch(() => {}); }
      else { b.textContent = '▶'; b.classList.remove('on'); audio = playingBtn = null; bgmDuck(false); }
    });
    audio.play().catch(() => {});
    b.textContent = '⏸'; b.classList.add('on');
  });

  /* ============ 登录弹窗（LoginModal · 登入 / 注册 双模式） ============ */
  const modalState = { mode: 'login' };   // login | register
  function openLogin() {
    setModalMode('login');
    for (const id of ['laccount', 'lpwd', 'lcode', 'rusername', 'rpwd', 'rpwd2', 'rnick']) {
      const el = $(id); if (el) el.value = '';
    }
    $('lerr').hidden = true;
    $('lmask').hidden = false;
    $('lmodal').hidden = false;
    document.body.style.overflow = 'hidden';
    setTimeout(() => { try { $('laccount').focus(); } catch (e) { /* 忽略 */ } }, 150);
  }
  function closeLogin() {
    $('lmask').hidden = true;
    $('lmodal').hidden = true;
    document.body.style.overflow = '';
  }
  /* 顶部主分段：【登入】/【注册】——注册隐藏验证码/微信通道，显示注册表单 */
  function setModalMode(m) {
    modalState.mode = (m === 'register') ? 'register' : 'login';
    const isReg = modalState.mode === 'register';
    for (const b of document.querySelectorAll('#lmode button')) {
      b.classList.toggle('active', b.dataset.mode === modalState.mode);
    }
    $('ltabs').hidden = isReg;
    $('accountField').hidden = isReg;          // 注册用独立字段，隐藏登入用的账号框
    $('regFields').hidden = !isReg;
    $('ldiv').hidden = isReg;
    $('lwechat').hidden = isReg;
    $('pwdField').hidden = isReg || viaState.mode !== 'password';
    $('codeField').hidden = isReg || viaState.mode !== 'code';
    $('lsubmit').textContent = isReg ? '立即注册' : '一键登入';
    $('ltitle').textContent = isReg ? '注册 · 开户' : '登入 · 归位';
    $('lsub').textContent = isReg
      ? '账号与收藏均存本机 · 可随时导出备份'
      : '账号密码本地校验 · 收藏 / 历史 / 心得按账号隔离';
    $('lerr').hidden = true;
  }
  function setVia(v) {
    viaState.mode = v;
    for (const b of document.querySelectorAll('#ltabs button')) {
      b.classList.toggle('active', b.dataset.via === v);
    }
    $('pwdField').hidden = modalState.mode === 'register' || v !== 'password';
    $('codeField').hidden = modalState.mode === 'register' || v !== 'code';
    $('lerr').hidden = true;
  }
  function startCodeCountdown() {
    let n = 60;
    const btn = $('sendCodeBtn');
    btn.disabled = true;
    const tick = () => {
      if (n <= 0) { btn.disabled = false; btn.textContent = '获取验证码'; return; }
      btn.textContent = `${n}s 后重发`;
      n -= 1;
      setTimeout(tick, 1000);
    };
    tick();
  }
  /* 登入：密码走本地账号严格校验；验证码 / 微信为快捷通道（无账号自动建号，仍按账号隔离） */
  async function doLogin(how) {
    const err = $('lerr');
    const show = (t) => { err.textContent = t; err.hidden = false; };
    const S = LAS();
    if (!S) { show('本地账号服务未加载，请刷新页面重试'); return; }
    const btn = $('lsubmit');
    const quick = (how === 'wechat' || how === 'code');

    if (quick) {
      const account = $('laccount').value.trim();
      if (how === 'code') {
        if (!account) { show('请输入手机号 / 账号名'); return; }
        const code = $('lcode').value.trim();
        if (!/^\d{6}$/.test(code)) { show('请输入 6 位数字验证码（演示环境任意 6 位数字）'); return; }
      }
      btn.disabled = true; btn.classList.add('loading');
      try {
        const r = S.loginOrCreate(account, { nickname: NICK_POOL[Math.floor(Math.random() * NICK_POOL.length)] });
        closeLogin();
        await UserStore.loginWith(r.session);
        toast(`欢迎，「${r.user.nickname}」· 收藏与历史已按账号隔离`);
      } catch (e) {
        show('登入失败：' + ((e && e.message) || '未知错误'));
      } finally {
        btn.disabled = false; btn.classList.remove('loading');
      }
      return;
    }

    const account = $('laccount').value.trim();
    const pwd = $('lpwd').value;
    if (!account) { show('请输入用户名'); return; }
    if (!pwd) { show('请输入密码'); return; }
    btn.disabled = true; btn.classList.add('loading');
    try {
      const r = S.login(account, pwd);
      if (!r.ok) {
        show(r.error);
        if (/没有这个账号/.test(r.error)) {            // 没账号→引导去注册
          setTimeout(() => { setModalMode('register'); $('rusername').value = account; }, 900);
        }
        return;
      }
      closeLogin();
      await UserStore.loginWith(r.session);
      toast(`欢迎归来，「${r.user.nickname}」· 已加载该账号的收藏`);
    } catch (e) {
      show('登入失败：' + ((e && e.message) || '未知错误'));
    } finally {
      btn.disabled = false; btn.classList.remove('loading');
    }
  }

  /* 注册：校验（用户名非空/不重复、密码 ≥6 位、两次一致）→ 落盘 → 自动登入 */
  async function doRegister() {
    const err = $('lerr');
    const show = (t) => { err.textContent = t; err.hidden = false; };
    const S = LAS();
    if (!S) { show('本地账号服务未加载，请刷新页面重试'); return; }
    const username = $('rusername').value.trim();
    const pwd = $('rpwd').value;
    const pwd2 = $('rpwd2').value;
    const nick = $('rnick').value.trim();
    if (!username) { show('请输入用户名（登录唯一标识）'); return; }
    if (pwd.length < S.PWD_MIN) { show(`密码不少于 ${S.PWD_MIN} 位`); return; }
    if (pwd !== pwd2) { show('两次输入的密码不一致'); return; }
    const btn = $('lsubmit');
    btn.disabled = true; btn.classList.add('loading');
    try {
      const r = S.register(username, pwd, nick);
      if (!r.ok) { show(r.error); return; }
      const lr = S.login(username, pwd);               // 注册成功即自动登入
      if (!lr.ok) { show('注册成功，但自动登入失败：' + lr.error); return; }
      closeLogin();
      await UserStore.loginWith(lr.session);
      toast(`注册成功，已自动登入 · 「${r.user.nickname}」`);
    } catch (e) {
      show('注册失败：' + ((e && e.message) || '未知错误'));
    } finally {
      btn.disabled = false; btn.classList.remove('loading');
    }
  }
  function initAuth() {
    // 恢复上次会话（刷新不掉线）：以 LocalAuthService 的会话为准
    const S = LAS();
    const s = S ? S.current() : null;
    if (s) { UserStore.user = s; safeSet(USER_KEY, JSON.stringify(s)); }
    else { try { localStorage.removeItem(USER_KEY); } catch (e) { /* 旧版 mock 会话作废 */ } }
    setModalMode('login');
    renderAuth();
    updateLocalDataSub();
    // 唤起入口：头部朱印 / 设置卡账号行（游客=登录，登录态=切换账号）
    $('loginSeal').addEventListener('click', openLogin);
    $('acctBtn').addEventListener('click', openLogin);
    $('logoutBtn').addEventListener('click', async () => {
      if (!UserStore.isLogin()) return;
      UserStore.logout();
      toast('已退出登录 · 收藏仍保留在该账号中');
    });
    // 弹窗本体
    $('lmask').addEventListener('click', closeLogin);
    $('lclose').addEventListener('click', closeLogin);
    $('lguest').addEventListener('click', closeLogin);
    $('lmode').addEventListener('click', (e) => {
      const b = e.target.closest('[data-mode]');
      if (b) setModalMode(b.dataset.mode);
    });
    $('ltabs').addEventListener('click', (e) => {
      const b = e.target.closest('[data-via]');
      if (b) setVia(b.dataset.via);
    });
    $('sendCodeBtn').addEventListener('click', async () => {
      const account = $('laccount').value.trim();
      if (!account) {
        $('lerr').textContent = '请先填写手机号 / 账号名';
        $('lerr').hidden = false;
        return;
      }
      $('sendCodeBtn').disabled = true;
      try { await AuthAPI.sendCode(account); } catch (e) { /* 忽略 */ }
      $('lerr').hidden = true;
      toast('验证码已发送（演示环境：任意 6 位数字可登入）');
      startCodeCountdown();
    });
    $('lform').addEventListener('submit', (e) => {
      e.preventDefault();
      if (modalState.mode === 'register') doRegister();
      else doLogin(viaState.mode);
    });
    $('lwechat').addEventListener('click', () => doLogin('wechat'));

    /* —— 本地账号与数据管理（检视抽屉） —— */
    $('localDataRow').addEventListener('click', openAccountPanel);
    $('adm').addEventListener('click', closeAccountPanel);
    $('adClose').addEventListener('click', closeAccountPanel);
    $('adExport').addEventListener('click', exportAllData);
    $('adImport').addEventListener('click', () => $('adFile').click());
    $('adFile').addEventListener('change', (e) => {
      const f = e.target.files && e.target.files[0];
      importBackup(f);
      e.target.value = '';
    });
    $('adClear').addEventListener('click', clearAllAccounts);
    // 账号表被外部改动（导入 / 删除 / 清空）时同步界面
    if (S && S.on) S.on(() => { updateLocalDataSub(); });
  }

  /* ============ 免责声明弹窗（DisclaimerModal · 原生等价组件） ============
     等价于 <DisclaimerModal :visible="dmOpen" @close="dmOpen = false" />：
     openDisclaimer()/closeDisclaimer() 即 visible 开关；
     遮罩 / 右上角× / 底部【我已悉知并同意】均为 close 触发器。
     入口：设置卡 disclaimRow + 页脚 ftDisclaim（全局唯一实例，复用组件）。 */
  function openDisclaimer() {
    $('dmask').hidden = false;
    $('dmodal').hidden = false;
    document.body.style.overflow = 'hidden';
  }
  function closeDisclaimer() {
    const m = $('dmodal'), k = $('dmask');
    if (m.hidden) return;                      // 已关闭（防连点重播退场动画）
    m.classList.add('closing'); k.classList.add('closing');
    setTimeout(() => {
      m.hidden = true; k.hidden = true;
      m.classList.remove('closing'); k.classList.remove('closing');
      document.body.style.overflow = '';
    }, 170);                                   // 与 dmout/fadeout .18s 对齐
  }
  function initDisclaimer() {
    $('disclaimRow').addEventListener('click', openDisclaimer);
    $('ftDisclaim').addEventListener('click', openDisclaimer);
    $('dmask').addEventListener('click', closeDisclaimer);
    $('dclose').addEventListener('click', closeDisclaimer);
    $('dagree').addEventListener('click', closeDisclaimer);
  }

  /* ============ 更新优化说明（UpdateModal · 数据驱动 data/changelog.json） ============
     触发一：启动时 window.__SGS_APP_V 与上次看过的版本（localStorage: sgs.seenUpdateV）不同
             → 开屏退场后自动弹一次，同一个版本只弹一次；
     触发二：我的 → 偏好与设置 → 更新优化说明（updateRow），随时手动打开，看得到全部历史。
     说明内容全部来自 data/changelog.json 的 updates 数组（加一条即多一次说明，不用改代码）；
     取不到数据时不弹空窗（自动触发静默跳过；手动打开则给提示文案）。
     版本号来源优先级：window.__SGS_APP_V（index.html，权威） > changelog.json 的 app 字段。 */
  const UPDATE_SEEN_KEY = 'sgs.seenUpdateV';
  const CHANGELOG_URL = 'data/changelog.json';
  let CHANGELOG = null, changelogTask = null;

  function appVersion() {
    return String(window.__SGS_APP_V || (CHANGELOG && CHANGELOG.app) || '').trim();
  }
  function loadChangelog() {
    if (changelogTask) return changelogTask;
    const url = CHANGELOG_URL + (window.__SGS_ASSET_V ? '?v=' + window.__SGS_ASSET_V : '');
    changelogTask = fetchJSON(url)
      .catch(() => ({ updates: [] }))                  // 拿不到就当没有（绝不弹空窗）
      .then((d) => { CHANGELOG = (d && Array.isArray(d.updates)) ? d : { updates: [] }; return CHANGELOG; });
    return changelogTask;
  }
  function updItemsHtml(items) {
    const list = (items || []).filter((it) => it && (it.d || it.t));
    if (!list.length) return '<p class="up-empty">本版暂无更细的分类。</p>';
    return '<ul class="up-list">' + list.map((it) => {
      const k = String(it.t || '更新').trim() || '更新';
      return '<li><span class="up-t" data-k="' + esc(k) + '">' + esc(k) + '</span>' +
             '<span class="up-d">' + esc(it.d || '') + '</span></li>';
    }).join('') + '</ul>';
  }
  function updBodyHtml(updates, expandFirst) {
    const list = (updates || []).filter((u) => u && u.v);
    if (!list.length) return '<p class="up-empty">暂无更新记录。</p>';
    return list.map((u, i) => {
      // 只有「版本变了 → 开屏退场后自动弹一次」时展开最新一版（i === 0）；
      // 从「我的 → 更新优化说明」手动进来自查历史，一律折叠，方便一眼扫版本列表。
      const open = expandFirst === true && i === 0;
      const ver = '<button class="up-ver" type="button" aria-expanded="' + (open ? 'true' : 'false') + '">' +
        '<b class="up-vno">' + esc(u.v) + '</b>' +
        (u.date ? '<span class="up-date">' + esc(u.date) + '</span>' : '') +
        (u.tag ? '<span class="up-tag">' + esc(u.tag) + '</span>' : '') +
        '<i class="up-chev" aria-hidden="true"></i></button>';
      return '<section class="up-sec' + (open ? ' is-open' : '') + '" data-v="' + esc(u.v) + '">' +
        ver + '<div class="up-body">' + updItemsHtml(u.items) + '</div></section>';
    }).join('');
  }
  function openUpdates(auto) {
    const m = $('umodal');
    $('umask').hidden = false;
    m.hidden = false;
    document.body.style.overflow = 'hidden';
    // auto === true 只发生在「版本变了 → 开屏退场后自动弹一次」，此时展开最新一版；
    // 手动进来（我的 → 更新优化说明）全部折叠。
    const expandFirst = auto === true;
    if (CHANGELOG) $('ubody').innerHTML = updBodyHtml(CHANGELOG.updates, expandFirst);
    else {
      $('ubody').innerHTML = '<p class="up-empty">正在载入更新说明…</p>';
      loadChangelog().then((cl) => { if (!m.hidden) $('ubody').innerHTML = updBodyHtml(cl.updates, expandFirst); });
    }
  }
  function closeUpdates() {
    const m = $('umodal'), k = $('umask');
    if (m.hidden) return;                              // 已关闭（防连点重播退场动画）
    m.classList.add('closing'); k.classList.add('closing');
    setTimeout(() => {
      m.hidden = true; k.hidden = true;
      m.classList.remove('closing'); k.classList.remove('closing');
      document.body.style.overflow = '';
    }, 170);                                           // 与 dmout/fadeout .18s 对齐
  }
  function syncUpdateRow() {                           // 入口行的副标题：v版本号 · 共 N 次
    const el = $('updateSub');
    if (!el) return;
    const v = appVersion();
    const n = (CHANGELOG && CHANGELOG.updates) ? CHANGELOG.updates.length : 0;
    el.innerHTML = (v ? 'v' + esc(v) : '查看历次更新') +
      (n > 1 ? ' · 共 ' + n + ' 次' : '') + ' <i class="darr" aria-hidden="true">›</i>';
  }
  function initUpdates() {
    $('updateRow').addEventListener('click', () => openUpdates(false));  // 手动：全部折叠
    $('umask').addEventListener('click', closeUpdates);
    $('uclose').addEventListener('click', closeUpdates);
    $('uok').addEventListener('click', closeUpdates);
    // 折叠交互：点版本头展开/收起（事件委托，ubody 内容整体换过也不用重绑）
    $('ubody').addEventListener('click', (e) => {
      const btn = e.target && e.target.closest ? e.target.closest('.up-ver') : null;
      if (!btn) return;
      const sec = btn.closest('.up-sec');
      if (!sec) return;
      const on = sec.classList.toggle('is-open');
      btn.setAttribute('aria-expanded', on ? 'true' : 'false');
    });
    syncUpdateRow();                                   // 先用静态版本号占位
    loadChangelog().then(syncUpdateRow);               // 数据到位后补「共 N 次」
  }
  function maybeShowUpdate() {                         // 开屏退场后的自动弹（版本变了才弹）
    const v = appVersion();
    if (!v || safeGet(UPDATE_SEEN_KEY) === v) return;  // 本版已看过 → 不再打扰
    loadChangelog().then((cl) => {
      if (!cl.updates.length) return;                  // 没有条目：不弹空窗
      safeSet(UPDATE_SEEN_KEY, v);
      openUpdates(true);                             // 自动首弹：展开最新一版
    }).catch(() => { /* 静默 */ });
  }

  /* ============ SplashScreen 开屏加载页（原生等价 <SplashScreen onFinish/>） ============
     进度来自真实预加载步骤（索引清单 45% / 版本数据 85% / 首屏渲染 100%），不做假进度；
     最小展示 3.5s → 600ms 淡出微放大 → 卸载；【跳过】或出错路径即时结束。 */
  const SPLASH_MIN = 3500;
  const SPLASH_QUOTES = [
    '山不厌高，海不厌深。周公吐哺，天下归心。',
    '运筹帷幄之中，决胜千里之外。',
    '一人一口，何足挂齿？',
    '鞠躬尽瘁，死而后已。',
    '老骥伏枥，志在千里；烈士暮年，壮心不已。',
    '既生瑜，何生亮。',
    '万事俱备，只欠东风。',
    '淡泊以明志，宁静以致远。'
  ];
  const SPLASH = { t0: 0, cdTimer: 0, qTimer: 0, finTimer: 0, done: false, out: false, onOut: 0 };
  function splashStart() {
    SPLASH.t0 = Date.now();
    let qi = Math.floor(Math.random() * SPLASH_QUOTES.length);
    const showQuote = () => {
      const el = $('spQuote');
      el.style.animation = 'none'; void el.offsetWidth; el.style.animation = '';  // 重播 ink-fade
      el.textContent = SPLASH_QUOTES[qi % SPLASH_QUOTES.length]; qi++;
    };
    showQuote();
    SPLASH.qTimer = setInterval(showQuote, 2000);
    SPLASH.cdTimer = setInterval(() => {
      const left = Math.ceil((SPLASH_MIN - (Date.now() - SPLASH.t0)) / 1000);
      $('splashSkip').textContent = left > 0 ? '跳过 ' + left + 's' : '进入';
    }, 250);
    $('splashSkip').addEventListener('click', splashSkipNow);
  }
  function splashProgress(p) {
    $('spFill').style.width = p + '%';
    $('spPct').textContent = p + '%';
  }
  function splashFinish() {
    if (SPLASH.done) return;
    SPLASH.done = true;
    splashProgress(100);
    SPLASH.finTimer = setTimeout(splashOut,              // 补足最小展示 3.5s 再退场
      Math.max(0, SPLASH_MIN - (Date.now() - SPLASH.t0)));
  }
  function splashSkipNow() {                             // 跳过：打断补足等待，立即退场
    if (SPLASH.out) return;
    SPLASH.done = true;                                  // 之后 boot 的 finish 直接 return
    if (SPLASH.finTimer) { clearTimeout(SPLASH.finTimer); SPLASH.finTimer = 0; }
    splashOut();
  }
  function splashOut() {
    if (SPLASH.out) return;
    SPLASH.out = true;
    clearInterval(SPLASH.cdTimer); clearInterval(SPLASH.qTimer);   // 退场时才停轮播/倒计时
    const el = $('splash');
    el.classList.add('out');                             // 600ms 淡出 + scale(1.04)
    setTimeout(() => {                                   // 随后从渲染树卸载，并交棒给开屏后的提示（更新优化说明）
      el.hidden = true;
      const cb = SPLASH.onOut; SPLASH.onOut = 0;         // 只触发一次（跳过路径也是同一条出口）
      if (cb) { try { cb(); } catch (e) { /* 静默 */ } }
    }, 620);
  }
  function precacheAvatars() {                           // 预缓存前 10 位高频武将缩略图（后台，不阻塞）
    // na（无头像，如「未实装」版本条目）跳过 —— 否则会为必然不存在的文件发一串 404
    try { G.slice(0, 10).forEach(g => { if (g.na) return; const im = new Image(); im.src = recAv(g); }); }
    catch (e) { /* 静默 */ }
  }

  /* ============ PageHeader 大抬头通用组件（原生等价） ============
     等价于 <PageHeader title="..." subtitle="..." badge="..." action={{label,onClick}} />：
     pageHeader(cfg) 渲染进挂载点并绑定右侧功能按键，两页复用同一工厂。 */
  function pageHeader(cfg) {
    const el = $(cfg.mount);
    el.innerHTML =
      '<div class="ph-left">' +
      '<div class="ph-titlerow">' +
      '<b class="ph-title kai">' + esc(cfg.title) + '</b></div>' +
      '<p class="ph-sub">' + esc(cfg.subtitle) + '</p></div>' +
      (cfg.actionLabel ? '<button class="phead-btn kai" type="button">' + esc(cfg.actionLabel) + '</button>' : '');
    if (cfg.actionLabel) el.querySelector('.phead-btn').addEventListener('click', cfg.onAction);
    return el;
  }
  function initHeroHeader() {
    pageHeader({
      mount: 'heroHead', seal: '将', title: '群英图谱',
      subtitle: '典藏全势力武将 · 技能台词全面收录',
      actionLabel: '随机',
      onAction: () => {
        if (!GLIST.length) { toast('武将数据加载中，请稍候'); return; }
        open(GLIST[Math.floor(Math.random() * GLIST.length)].id);   // 当前版本随机一位武将详情
        tapFeel(8);
      }
    });
  }
  /* 原 phead 大抬头已随「整页 → 弹层」一起去掉（弹层自带云纹抬头，标题＝首页卡名「规则与玩法」）；
     抬头里的「速览」按钮挪到弹层正文顶部的 .pane-bar，绑定见下。 */
  function initModePane() {
    $('modeGlossary').addEventListener('click', openGlossary);
    $('gmmask').addEventListener('click', closeGlossary);
    $('gmclose').addEventListener('click', closeGlossary);
    $('gmok').addEventListener('click', closeGlossary);
  }
  function openGlossary() {           // 术语速览：直接引用通用百科数据，零编造
    if (!MODERULES) { toast('规则数据加载中，请稍候'); return; }
    const wiki = MODERULES.versions.find(v => v.id === 'wiki');
    $('gmbody').innerHTML = wiki.modes.map(m =>
      '<section class="dm-sec"><h4>' + esc(m.name) + '</h4><p>' + esc(m.desc) + '</p></section>').join('');
    $('gmmask').hidden = false;
    $('gmmodal').hidden = false;
    document.body.style.overflow = 'hidden';
  }
  function closeGlossary() {
    $('gmmask').hidden = true;
    $('gmmodal').hidden = true;
    document.body.style.overflow = '';
  }

  /* ============ 牌库（游戏牌 · 第 5 模块 up/005.md · 原生等价组件） ============
     CardsView   → page-cards + renderCardFilters/renderCardGrid（类别×包 双层级筛选）
     CardPreview → openCard/closeCard（CSS 卡面大图 + 时机/目标/效果 结构化详情）
     数据：data/cards.json（core=规则书稳定内容全字段；list=截图名录节选，effect 待爬虫补全）
     契约：types/cards.ts · 爬虫：tools/fetch_cards.py */
  let CARDS = null;
  const CST = { cat: 'all', pkg: 'all' };                // 与英雄页筛选同构，避免"结果变少找不到原因"
  const CAT_META = {
    basic:   { label: '基本牌',  acc: 'var(--c-basic)' },
    scroll:  { label: '锦囊牌',  acc: 'var(--c-scroll)' },
    equip:   { label: '装备牌',  acc: 'var(--c-equip)' },
    special: { label: '双副类别', acc: 'var(--c-special)' }
  };
  const SUB_LABEL = {
    normal: '普通锦囊', delayed: '延时锦囊', faction: '势力锦囊',
    weapon: '武器', armor: '防具', horse: '坐骑', horse_p: '防御马', horse_m: '进攻马', treasure: '宝物'
  };
  /* 硬规则：卡牌的 src / note（含抓取来源与工作备注）一律不在页面展示，统一归入免责声明弹窗 */
  /* 原 phead 大抬头（seal 牌 / 「牌谱总表」）已去掉 —— 弹层抬头即首页卡名「游戏牌种类」，
     副标题「游戏牌图鉴 · 类别与包属一键速查」写在弹层正文顶部的 .pane-bar 里。 */
  function cardFiltered() {
    return CARDS.cards.filter((c) =>
      (CST.cat === 'all' || c.cat === CST.cat) &&
      (CST.pkg === 'all' || (c.pkg || []).includes(CST.pkg)));
  }
  function pkgUsed() {                                   // 当前类别下实际出现的包（不受 pkg 自身过滤影响）
    const used = new Set();
    for (const c of CARDS.cards) {
      if (CST.cat !== 'all' && c.cat !== CST.cat) continue;
      for (const p of (c.pkg || [])) used.add(p);
    }
    return CARDS.packages.filter((p) => used.has(p.id));
  }
  function renderCardFilters() {
    const cats = [['all', '全部']].concat(Object.entries(CAT_META).map(([k, v]) => [k, v.label]));
    $('cardCatRow').innerHTML = cats.map(([k, lab]) =>
      '<button class="chip' + (CST.cat === k ? ' active' : '') + '" data-ccat="' + k + '">' + lab + '</button>').join('');
    $('cardPkgRow').innerHTML =
      '<button class="chip' + (CST.pkg === 'all' ? ' active' : '') + '" data-cpkg="all">全部包</button>' +
      pkgUsed().map((p) =>
        '<button class="chip' + (CST.pkg === p.id ? ' active' : '') + '" data-cpkg="' + p.id + '">' + esc(p.label) + '</button>').join('');
    $('cardCount').textContent = '共 ' + cardFiltered().length + ' 张牌 · 名录持续补全中';
    $('cardClear').hidden = CST.cat === 'all' && CST.pkg === 'all';
  }
  function cardFaceHTML(c, big, attrs) {                 // 卡面：真图优先（c.img），无图回退 CSS 卡面（类别色带+变体角标+竖排牌名）
    const meta = CAT_META[c.cat] || CAT_META.basic;
    const vert = c.n.length >= 2 && c.n.length <= 3;     // 长名横排（如"挟天子以令诸侯"）
    const varHtml = c.variant ? '<span class="c-var">' + esc(c.variant) + '</span>' : '';
    const rangeHtml = !big && ((c.sub === 'weapon' && c.range) ? '<span class="c-rng">距' + c.range + '</span>'
      : (c.horse ? '<span class="c-rng">' + (c.horse > 0 ? '+1' : '-1') + '</span>' : ''));   // 大卡面不显示角标（信息区已有）
    const pks = (c.pkg || []).map((id) => {
      const p = CARDS.packages.find((x) => x.id === id);
      return p ? '<span class="c-pk">' + esc(p.label) + '</span>' : '';
    }).join('');
    const imgHtml = c.img ? '<img class="c-img" src="' + esc(c.img) + '" alt="' + esc(c.n) + '" loading="lazy"' +
      ' onerror="this.parentNode.classList.remove(\'has-img\');this.remove()">' : '';
    return '<div class="' + (big ? 'cdbig' : 'ccard') + (imgHtml ? ' has-img' : ' no-img') + '" style="--acc:' + meta.acc + '"' + (attrs || '') + '>' +
      imgHtml +
      '<span class="c-band"></span>' +
      (big ? '' : '<span class="c-cat">' + meta.label + '</span>') +
      varHtml +
      '<b class="c-name' + (vert ? '' : ' hori') + '">' + esc(c.n) + '</b>' +
      (imgHtml ? '' : '<span class="c-noimg">暂无卡面</span>') +
      '<span class="c-meta">' + pks + '</span>' +
      rangeHtml + '</div>';
  }
  function renderCardGrid() {
    const list = cardFiltered();
    $('cgrid').innerHTML = list.map((c) =>
      cardFaceHTML(c, false, ' role="button" tabindex="0" data-cid="' + c.id + '"')).join('');
    $('cempty').hidden = list.length > 0;
  }
  let CD_GUARD = 0;                                      // 开窗冷却：防 tap 串扰在开窗瞬间误关
  function openCard(id) {
    const now = Date.now();
    if (now - CD_GUARD < 250 && !$('cdmodal').hidden) return;
    CD_GUARD = now;
    const c = CARDS.cards.find((x) => x.id === id);
    if (!c) return;
    const meta = CAT_META[c.cat] || CAT_META.basic;
    const subLab = c.sub && SUB_LABEL[c.sub] ? SUB_LABEL[c.sub] : '';
    const cats = '<span class="cd-cat" style="--acc:' + meta.acc + '">' + meta.label + (subLab ? ' · ' + subLab : '') + '</span>' +
      ((c.sub === 'weapon' && c.range) ? '<span class="cd-cat" style="--acc:' + meta.acc + ';opacity:.85">攻击范围 ' + c.range + '</span>'
        : (c.horse ? '<span class="cd-cat" style="--acc:' + meta.acc + ';opacity:.85">' + (c.horse > 0 ? '防御马 +1' : '进攻马 -1') + '</span>' : ''));
    let suitHtml = '';                                   // 花色分布：数组（旧名录）或 {牌堆名:{♥:..}} 对象（爬虫）双形态兼容
    if (Array.isArray(c.suits)) {
      const parts = c.suits.map((s) => '<span class="cd-suit">' + s.suit + ' ' + esc(s.num) + '</span>');
      if (parts.length) suitHtml = '<div class="cd-suits">' + parts.join('') + '</div>';
    } else if (c.suits && typeof c.suits === 'object') {
      const parts = Object.entries(c.suits).map(([deck, m]) => {
        const segs = Object.entries(m || {}).filter(([, v]) => v).map(([su, v]) => su + esc(String(v)));
        return segs.length ? '<span class="cd-suit"><b>' + esc(deck) + '</b>' + segs.join(' ') + '</span>' : '';
      }).filter(Boolean);
      if (parts.length) suitHtml = '<div class="cd-suits">' + parts.join('') + '</div>';
    }
    const eff = c.effect
      ? '<section class="dm-sec"><h4>卡牌效果</h4><p>' + esc(c.effect) + '</p></section>'
      : '<section class="dm-sec"><h4>卡牌效果</h4><p>暂无详细说明，效果待补全</p></section>';
    $('cdBody').innerHTML =
      '<div class="cd-top">' + cardFaceHTML(c, true) +
      '<div class="cd-info"><div class="cd-cats">' + cats +
      (c.pkg || []).map((pid) => {
        const p = CARDS.packages.find((x) => x.id === pid);
        return p ? '<span class="cd-pk">' + esc(p.label) + '</span>' : '';
      }).join('') +
      '</div><h3 class="cd-tit">' + esc(c.variant ? c.variant + '【' + c.n + '】' : '【' + c.n + '】') + '</h3>' +
      suitHtml + '</div></div>' +
      (c.timing ? '<section class="dm-sec"><h4>使用时机</h4><p><b>' + esc(c.timing) + '</b></p></section>' : '') +
      (c.target ? '<section class="dm-sec"><h4>目标对象</h4><p>' + esc(c.target) + '</p></section>' : '') +
      eff;
    $('cdmask').hidden = false;
    $('cdmodal').hidden = false;
    document.body.style.overflow = 'hidden';
  }
  function closeCard() {
    if (Date.now() - CD_GUARD < 250) return;             // 刚开窗 250ms 内忽略关闭（人手不可能这么快点×）
    $('cdmask').hidden = true;
    $('cdmodal').hidden = true;
    document.body.style.overflow = '';
  }
  async function initCards() {
    try { CARDS = await fetchJSON(vq(DATA_DIR + 'cards.json')); } catch (e) { CARDS = null; }
    if (!CARDS || !CARDS.cards) { $('cardCount').textContent = '牌库数据加载失败'; return; }
    renderCardFilters();
    renderCardGrid();
    $('cardCatRow').addEventListener('click', (e) => {
      const t = e.target.closest('[data-ccat]'); if (!t) return;
      CST.cat = t.dataset.ccat; CST.pkg = 'all';         // 切类别重置包，杜绝空结果死胡同
      renderCardFilters(); renderCardGrid();
    });
    $('cardPkgRow').addEventListener('click', (e) => {
      const t = e.target.closest('[data-cpkg]'); if (!t) return;
      CST.pkg = CST.pkg === t.dataset.cpkg ? 'all' : t.dataset.cpkg;
      renderCardFilters(); renderCardGrid();
    });
    $('cardClear').addEventListener('click', () => {
      CST.cat = 'all'; CST.pkg = 'all'; renderCardFilters(); renderCardGrid();
    });
    $('cgrid').addEventListener('click', (e) => {
      const t = e.target.closest('[data-cid]'); if (t) openCard(t.dataset.cid);
    });
    $('cdmask').addEventListener('click', closeCard);
    $('cdclose').addEventListener('click', closeCard);
  }

  /* ============ OL 资讯模块（第六 Tab · 官方游戏资讯桥接） ============
     数据链路：官网 news/715 → v2/fetch_ol_news.py（构建期抓取）
               → data/ol_news/news.json（静态文件）+ data/ol_news/covers/*.webp
     ★ app 运行时不请求官网：官网有防盗链（Tengine ACL 校验 Referer）、会改版、有限流。
       构建期抓取 + 静态落地 = 离线可用、零跨域、官网页脚改版不影响。
     同步：本地服务运行时点「同步最新」→ POST /api/olnews/sync（serve.py 负责跑脚本）；
           双击 html 打开（file://）时该按钮不可用，需重跑 python v2/fetch_ol_news.py。
     「新品武将」：公告正文的固定模板块由 v2/parse_new_heroes.py 抽出，挂在条目的
               newHeroes 字段；详情页展示，并与当前武将库比对提示未收录。 */
  const OL_URL = vq(DATA_DIR + 'ol_news/news.json');
  const OL_SEEN_KEY = 'ol.seenIds';        // 已读资讯 id（用于 New 标签）
  let OL = null;                           // {updatedAt, since, count, items[]}
  const OLS = { cat: 'all', heroOnly: false };

  function olSeen() {
    try { return JSON.parse(safeGet(OL_SEEN_KEY) || '[]'); } catch (e) { return []; }
  }
  function olIsNew(it) {
    // 发布时间在 7 天内且未读过 = 新
    const seen = olSeen();
    if (seen.indexOf(it.id) >= 0) return false;
    const d = Date.parse((it.pub || it.date || '').replace(/-/g, '/'));
    if (!d) return false;
    return (Date.now() - d) <= 7 * 864e5;
  }
  function olUnseenCount() {
    if (!OL) return 0;
    return OL.items.filter(olIsNew).length;
  }
  function markOlNewsSeen() {
    if (!OL) return;
    const ids = OL.items.map((x) => x.id);
    safeSet(OL_SEEN_KEY, JSON.stringify(ids));
    renderOlNewDot();
  }
  function renderOlNewDot() {
    // 底部 Tab 的资讯入口已移除，未读角标改挂到轮播第 2 个圆点上（入口在此）
    const dot = $('bxDots') && $('bxDots').querySelector('.bx-dot[data-i="1"]');
    if (!dot) return;
    dot.classList.toggle('has-new', olUnseenCount() > 0);
  }

  function renderOlHeader() {
    pageHeader({
      mount: 'olNewsHead', seal: '讯', title: 'OL资讯',
      subtitle: '三国杀OL官网 · 活动公告与版本动态',
      // 底部 TabBar 的资讯入口已移除，入口在首页轮播第 2 屏 —— 故这里给「返回」
      // 而不是「刷新」（页内同步条已有一键同步按钮）
      actionLabel: '返回',
      onAction: () => go('home'),
    });
  }

  function renderOlSyncBar() {
    const bar = $('olSync'), tx = $('olSyncTx');
    if (!bar || !tx) return;
    bar.classList.remove('loading', 'stale');
    if (!OL) { tx.textContent = '数据加载中…'; bar.classList.add('loading'); return; }
    const when = OL.updatedAt || '未知';
    const stale = (Date.now() - Date.parse(when.replace(/-/g, '/'))) > 3 * 864e5;
    if (stale) bar.classList.add('stale');
    tx.textContent = (stale ? '数据已超过 3 天未同步 · ' : '数据更新于 ') + when +
      '　共 ' + (OL.count || 0) + ' 条';
  }

  // 分类筛选（含 New 标签）
  function renderOlCats() {
    const el = $('olCats');
    if (!el || !OL) return;
    const counts = {};
    OL.items.forEach((i) => { counts[i.cat] = (counts[i.cat] || 0) + 1; });
    const order = ['活动', '公告', '赛事', '资讯'];
    const cats = order.filter((c) => counts[c]);
    Object.keys(counts).forEach((c) => { if (cats.indexOf(c) < 0) cats.push(c); });

    const nNew = olUnseenCount();
    let html = '<button class="chip' + (OLS.cat === 'all' ? ' active' : '') +
      '" data-ocat="all" type="button">全部 ' + OL.items.length +
      (nNew ? '<i class="chip-new">NEW</i>' : '') + '</button>';
    html += cats.map((c) => {
      const cn = OL.items.filter((i) => i.cat === c && olIsNew(i)).length;
      return '<button class="chip' + (OLS.cat === c ? ' active' : '') +
        '" data-ocat="' + esc(c) + '" type="button">' + esc(c) + ' ' + counts[c] +
        (cn ? '<i class="chip-new">NEW</i>' : '') + '</button>';
    }).join('');
    el.innerHTML = html;
  }

  function olVisible() {
    if (!OL) return [];
    return OL.items.filter((i) => {
      if (OLS.cat !== 'all' && i.cat !== OLS.cat) return false;
      if (OLS.heroOnly && !(i.newHeroes && i.newHeroes.length)) return false;
      return true;
    });
  }

  function renderOlGrid() {
    const grid = $('olGrid'), emp = $('olEmpty'), cnt = $('olCount');
    if (!grid || !OL) return;
    const list = olVisible();
    if (cnt) cnt.textContent = list.length + ' / ' + OL.items.length + ' 条';
    const hb = $('olHeroOnly');
    if (hb) {
      const n = OL.items.filter((i) => i.newHeroes && i.newHeroes.length).length;
      hb.textContent = (OLS.heroOnly ? '✓ 只看有新武将' : '只看有新武将') +
        (n ? '（' + n + '）' : '');
      hb.style.fontWeight = OLS.heroOnly ? '600' : '';
    }
    if (!list.length) { grid.innerHTML = ''; if (emp) emp.hidden = false; return; }
    if (emp) emp.hidden = true;

    grid.innerHTML = list.map((i) => {
      const cover = i.cover ? vq(DATA_DIR + 'ol_news/' + i.cover) : '';
      const body = (i.body || '').replace(/\s+/g, ' ').trim();
      const sum = body ? body.slice(0, 150) : '（本条公告为图片形式，无文字正文）';
      const hs = i.newHeroes || [];
      const heroLine = hs.length
        ? '<div class="ol-heroline"><b>新武将</b>' + hs.map((h) =>
            esc(h.name) + '<span class="ol-hp">' + esc(h.countryName + '·' + (h.hp || '?') + '体力') + '</span>'
          ).join('　') + '</div>'
        : '';
      return '<article class="ol-card" data-oid="' + esc(i.id) + '">' +
        '<div class="ol-thumb">' +
        (cover ? '<img loading="lazy" src="' + esc(cover) + '" alt="">'
               : '<div class="ol-noimg">原文为图片公告</div>') +
        '<span class="ol-badge" data-cat="' + esc(i.cat) + '">' + esc(i.cat) + '</span>' +
        (hs.length ? '<span class="ol-newhero-tag">新武将 ' + hs.length + '</span>' : '') +
        (olIsNew(i) ? '' : '') +
        '</div>' +
        '<div class="ol-cbody">' +
        '<div class="ol-ct">' + esc(i.title) + '</div>' +
        '<div class="ol-cmeta"><span>' + esc(i.date) + '</span>' +
        '<span class="ol-cdot">·</span><span>' + (i.body || '').length + ' 字</span>' +
        (olIsNew(i) ? '<span class="ol-cdot">·</span><span style="color:var(--zhu);font-weight:600">NEW</span>' : '') +
        '</div>' +
        '<div class="ol-csum">' + esc(sum) + '</div>' +
        heroLine +
        '</div></article>';
    }).join('');
  }

  async function loadOlNews(force) {
    /* 轻量子体不装 data/ol_news，这里直接短路，省掉一次必然 404 的请求。 */
    if (LITE && (LITE.hide || []).includes('olnews')) return;
    const bar = $('olSync');
    if (!OL || force) {
      if (bar) { bar.classList.add('loading'); }
      try {
        OL = await fetchJSON(OL_URL + (force ? '?t=' + Date.now() : ''));
      } catch (e) {
        if (bar) { bar.classList.remove('loading'); bar.classList.add('stale'); }
        const tx = $('olSyncTx');
        if (tx) tx.textContent = '资讯数据读取失败：' + e.message;
        if (!OL) { const emp = $('olEmpty'); if (emp) { emp.textContent = '资讯数据未就绪，请先运行抓取脚本'; emp.hidden = false; } }
        return;
      }
    }
    renderOlSyncBar(); renderOlCats(); renderOlGrid(); renderOlNewDot();
  }

  /* ---------- 资讯详情弹窗 ---------- */
  let OL_GUARD = 0;
  function olHeroInLib(name) {
    // 在当前版本武将库里按名称模糊匹配（去掉「谋/界/SP/族/星/威」等前缀再比）
    const strip = (s) => String(s || '').replace(/^(谋|界|SP|sp|族|星|威|神|标)/, '');
    const target = strip(name);
    if (!target) return null;
    return G.find((g) => strip(g.n) === target) || G.find((g) => String(g.n) === String(name)) || null;
  }

  // ============ OL 资讯：正文 blocks 渲染（结构化排版） ============
  // 官网正文原是表格/分栏，剥成纯文本后散列严重。抓取期已把它结构化成
  // blocks（section/hero/table/kvline/kvlist/note/list/p/skills/ttl），
  // 这里按类型渲染，避免「一行一个词、留白巨大」。
  const OLC = { wei: '魏', shu: '蜀', wu: '吴', qun: '群', shen: '神', jin: '晋' };

  function olHeroCard(h) {
    const ck = h.countryKey || '';
    const stats = [
      h.hp ? h.hp + ' 体力' : '',
      h.gender === 'male' ? '男' : (h.gender === 'female' ? '女' : ''),
    ].filter(Boolean);
    return '<div class="olb-hero">' +
      '<div class="olb-hero-top">' +
      '<b class="olb-hero-name">' + esc(h.name || '') + '</b>' +
      (ck ? '<span class="olb-cty c-' + esc(ck) + '">' + esc(h.country || OLC[ck] || '') + '</span>' : '') +
      stats.map((s) => '<span class="olb-stat">' + esc(s) + '</span>').join('') +
      '</div>' +
      (h.feature ? '<div class="olb-feat">' + esc(h.feature) + '</div>' : '') +
      ((h.skills || []).length
        ? '<ul class="olb-skills">' + h.skills.map((s) =>
            '<li><b>【' + esc(s.name) + '】</b><span>' + esc(s.desc) + '</span></li>').join('') + '</ul>'
        : '') +
      (h.obtain ? '<div class="olb-obtain"><i>获取</i>' + esc(h.obtain) + '</div>' : '') +
      '</div>';
  }

  function olTable(t) {
    const head = t.head || [], rows = t.rows || [];
    const w = head.length;
    const LONG = 24;                       // 超过则默认折叠
    const long = rows.length > LONG;
    let html = '<div class="olb-tablewrap' + (long ? ' is-long' : '') + '">' +
      '<table class="olb-table">';
    if (t.title) html += '<caption>' + esc(t.title) + '</caption>';
    if (w >= 2) {
      html += '<thead><tr>' + head.map((h) => '<th>' + esc(h) + '</th>').join('') + '</tr></thead>';
    }
    html += '<tbody>';
    for (let ri = 0; ri < rows.length; ri++) {
      const r = rows[ri];
      const hide = long && ri >= LONG ? ' class="olb-hidden"' : '';
      html += '<tr' + hide + '>';
      for (let i = 0; i < w; i++) {
        const cell = r[i] == null ? '' : String(r[i]);
        html += '<td' + (i === 0 ? ' class="olb-td-k"' : '') + '>' + esc(cell) + '</td>';
      }
      html += '</tr>';
    }
    html += '</tbody></table>';
    if (long) {
      const label = '展开全部 ' + rows.length + ' 行 ↓';
      html += '<button class="olb-more" type="button" data-more="1" data-label="' +
        esc(label) + '">' + esc(label) + '</button>';
    }
    html += '</div>';
    return html;
  }

  function olBlocks(list) {
    if (!list || !list.length) return '';
    let out = '', i = 0;
    while (i < list.length) {
      const b = list[i];
      switch (b.type) {
        case 'section':
          out += '<h3 class="olb-sec">' + esc(b.text) + '</h3>'; i++; break;
        case 'ttl':
          out += '<h4 class="olb-ttl">' + esc(b.text) + '</h4>'; i++; break;
        case 'hero':
          out += olHeroCard(b); i++; break;
        case 'table':
          out += olTable(b); i++; break;
        case 'kvline':
          out += '<div class="olb-kv"><span class="olb-k">' + esc(b.k) + '</span>' +
                 '<span class="olb-v">' + esc(b.v) + '</span></div>'; i++; break;
        case 'kvlist': {
          out += '<div class="olb-kvlist">' + (b.items || []).map((p) =>
            '<div class="olb-kvrow"><span>' + esc(p.k) + '</span><b>' + esc(p.v) + '</b></div>').join('') +
            '</div>'; i++; break;
        }
        case 'note':
          out += '<p class="olb-note">' + esc(b.text) + '</p>'; i++; break;
        case 'list':
          out += '<ul class="olb-list' + (b.style === 'plain' ? ' plain' : '') + '">' +
            (b.items || []).map((x) => '<li>' + esc(x) + '</li>').join('') + '</ul>'; i++; break;
        case 'skills':
          out += '<ul class="olb-skills">' + (b.items || []).map((s) =>
            '<li><b>【' + esc(s.name) + '】</b><span>' + esc(s.desc) + '</span></li>').join('') + '</ul>';
          i++; break;
        default: {
          // 连续短 p 合并成一组，避免逐行撑开巨大的垂直留白
          const run = [];
          let j = i;
          while (j < list.length && list[j].type === 'p') {
            run.push(list[j].text); j++;
          }
          out += '<p class="olb-p">' + run.map(esc).join('<br>') + '</p>';
          i = j;
        }
      }
    }
    return out;
  }

  function openOlNews(id) {
    if (!OL) return;
    const it = OL.items.find((x) => x.id === id);
    if (!it) return;
    OL_GUARD = Date.now();

    const cover = it.cover ? vq(DATA_DIR + 'ol_news/' + it.cover) : '';
    const hs = it.newHeroes || [];

    const heroBlock = hs.length ? (
      '<div class="ol-newheros">' +
      '<div class="ol-nh-head">新品武将<i>共 ' + hs.length + ' 位 · 摘自公告原文</i></div>' +
      hs.map((h) => {
        const inLib = olHeroInLib(h.name);
        const stats = [h.countryName, h.hp ? h.hp + '体力' : '', h.gender === 'male' ? '男' : (h.gender === 'female' ? '女' : '')]
          .filter(Boolean).join(' · ');
        return '<div class="ol-nh">' +
          '<div class="ol-nh-top"><b>' + esc(h.name) + '</b>' +
          (h.countryName ? '<span class="kt">' + esc(h.countryName) + '</span>' : '') +
          '<span class="ol-nh-stats">' + esc(stats) + '</span></div>' +
          (h.feature ? '<div class="ol-nh-feat">' + esc(h.feature) + '</div>' : '') +
          (h.skills && h.skills.length
            ? '<ul class="ol-nh-sk">' + h.skills.map((s) =>
                '<li><b>【' + esc(s.name) + '】</b>' + esc(s.desc) + '</li>').join('') + '</ul>'
            : '') +
          (inLib
            ? '<div class="ol-nh-miss">武将库已收录 → <b data-onh="' + esc(inLib.id) + '">查看 ' +
              esc(inLib.n) + '</b></div>'
            : '<div class="ol-nh-miss">武将库尚未收录，可作为下次补录候选</div>') +
          '</div>';
      }).join('') +
      '</div>'
    ) : '';

    $('olBody').innerHTML =
      '<div class="ol-dh">' +
      '<div class="ol-dtop">' +
      '<span class="ol-dcat" data-cat="' + esc(it.cat) + '">' + esc(it.cat) + '</span>' +
      '<span class="ol-ddate">' + esc(it.pub || it.date) + '</span>' +
      (olIsNew(it) ? '<span class="ol-ddate" style="color:var(--zhu);font-weight:600">NEW</span>' : '') +
      '</div>' +
      '<h2>' + esc(it.title) + '</h2>' +
      '</div>' +
      (cover ? '<div class="ol-dcover"><img src="' + esc(cover) + '" alt=""></div>' : '') +
      heroBlock +
      ((it.blocks && it.blocks.length)
        ? '<div class="ol-dbody olb">' + olBlocks(it.blocks) + '</div>'
        : '<div class="ol-dbody">' +
          esc(it.body || '（本条公告为图片形式，无文字正文，请前往官网查看原图）') + '</div>') +
      '<div class="ol-src">' +
      '<a href="' + esc(it.url) + '" target="_blank" rel="noopener">查看官网原文 ↗</a>' +
      '<span style="font-size:11px;color:var(--ink3)">来源：三国杀OL官网</span>' +
      '</div>';

    $('olmask').hidden = false;
    $('olmodal').hidden = false;
    document.body.style.overflow = 'hidden';
  }
  function closeOlNews() {
    if (Date.now() - OL_GUARD < 250) return;
    $('olmask').hidden = true;
    $('olmodal').hidden = true;
    document.body.style.overflow = '';
  }

  /* ---------- 「同步最新」：走本地服务（file:// 下不可用） ---------- */
  async function syncOlNews() {
    const btn = $('olSyncBtn'), tx = $('olSyncTx');
    if (IS_OFFLINE) { toast('离线版已内置全部资讯，无需同步'); return; }
    if (location.protocol === 'file:') {
      toast('本地文件模式无法自动同步，请运行：python v2/fetch_ol_news.py --pages 5');
      return;
    }
    if (btn.disabled) return;
    btn.disabled = true;
    const old = btn.textContent;
    btn.textContent = '同步中…';
    if (tx) tx.textContent = '正在抓取官网最新资讯…';
    try {
      const r = await fetch('api/olnews/sync', { method: 'POST' });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || d.ok === false) throw new Error(d.error || ('HTTP ' + r.status));
      await loadOlNews(true);
      toast('同步完成，共 ' + (d.count != null ? d.count : (OL ? OL.count : '?')) + ' 条');
    } catch (e) {
      toast('同步失败：' + e.message);
      renderOlSyncBar();
    } finally {
      btn.disabled = false;
      btn.textContent = old;
    }
  }

  async function initOlNews() {
    renderOlHeader();
    if ($('olCats')) {
      $('olCats').addEventListener('click', (e) => {
        const t = e.target.closest('[data-ocat]'); if (!t) return;
        OLS.cat = t.dataset.ocat;
        renderOlCats(); renderOlGrid();
      });
    }
    if ($('olHeroOnly')) {
      $('olHeroOnly').addEventListener('click', () => {
        OLS.heroOnly = !OLS.heroOnly; renderOlGrid();
      });
    }
    if ($('olGrid')) {
      $('olGrid').addEventListener('click', (e) => {
        const t = e.target.closest('[data-oid]'); if (t) openOlNews(t.dataset.oid);
      });
    }
    if ($('olmask')) $('olmask').addEventListener('click', closeOlNews);
    if ($('olclose')) $('olclose').addEventListener('click', closeOlNews);
    if ($('olSyncBtn')) $('olSyncBtn').addEventListener('click', syncOlNews);
    // 详情页里「查看 X」跳到武将详情 + 长表格展开
    if ($('olBody')) {
      $('olBody').addEventListener('click', (e) => {
        const more = e.target.closest('[data-more]');
        if (more) {
          const wrap = more.closest('.olb-tablewrap');
          if (wrap) {
            const open = wrap.classList.toggle('expanded');
            wrap.querySelectorAll('.olb-hidden').forEach((tr) => {
              tr.classList.toggle('olb-hidden', !open);
            });
            more.textContent = open ? '收起 ↑' : more.dataset.label;
          }
          return;
        }
        const t = e.target.closest('[data-onh]'); if (!t) return;
        closeOlNews();
        setTimeout(() => { go('heroes'); open(t.dataset.onh); }, 120);
      });
    }
    // 预取数据以便 Tab 上有 NEW 角标（不阻塞首屏）
    loadOlNews(false);
  }

  /* ============ 一将成名资讯模块（轮播第 3 屏 · 三国杀十周年） ============
     数据链路：x.sanguosha.com/news/activity → v2/fetch_x10_news.py（构建期抓取）
               → data/x10_news/news.json + covers/*.png + heroes/*.png
     ★ 与 OL 资讯同构：列表/分类/详情弹窗复用 ol-* 样式与 olBlocks/olTable 纯函数。
     ★ 差异：一将成名公告的「新品武将上线」在抓取期已结构化（newHeroes[]），每项含
       name/quality/kingdom/kingdomKey/hp/gender/title/pack/modes/bio/skills/imgLocal，
       详情页据此渲染「立绘 + 设定 + 生平 + 技能」卡片。
     同步：本地服务运行时点「同步最新」→ POST /api/x10news/sync（serve.py 跑脚本并回拷）。 */
  const X10_URL = vq(DATA_DIR + 'x10_news/news.json');
  const X10_SEEN_KEY = 'x10.seenIds';
  let X10 = null;                          // {updatedAt, sourceName, count, items[]}
  const X10S = { cat: 'all', heroOnly: false };

  function x10Seen() {
    try { return JSON.parse(safeGet(X10_SEEN_KEY) || '[]'); } catch (e) { return []; }
  }
  function x10IsNew(it) {
    const seen = x10Seen();
    if (seen.indexOf(it.id) >= 0) return false;
    const d = Date.parse((it.pub || it.date || '').replace(/-/g, '/'));
    if (!d) return false;
    return (Date.now() - d) <= 7 * 864e5;
  }
  function x10UnseenCount() {
    if (!X10) return 0;
    return X10.items.filter(x10IsNew).length;
  }
  function markX10NewsSeen() {
    if (!X10) return;
    safeSet(X10_SEEN_KEY, JSON.stringify(X10.items.map((x) => x.id)));
    renderX10NewDot();
  }
  function renderX10NewDot() {
    // 未读角标挂在轮播第 3 个圆点上（入口在此）
    const dot = $('bxDots') && $('bxDots').querySelector('.bx-dot[data-i="2"]');
    if (!dot) return;
    dot.classList.toggle('has-new', x10UnseenCount() > 0);
  }

  function renderX10Header() {
    pageHeader({
      mount: 'x10NewsHead', seal: '成', title: '一将成名',
      subtitle: '三国杀十周年（一将成名）官网 · 活动资讯',
      actionLabel: '返回',
      onAction: () => go('home'),
    });
  }

  function renderX10SyncBar() {
    const bar = $('x10Sync'), tx = $('x10SyncTx');
    if (!bar || !tx) return;
    bar.classList.remove('loading', 'stale');
    if (!X10) { tx.textContent = '数据加载中…'; bar.classList.add('loading'); return; }
    const when = X10.updatedAt || '未知';
    const stale = (Date.now() - Date.parse(when.replace(/-/g, '/'))) > 3 * 864e5;
    if (stale) bar.classList.add('stale');
    tx.textContent = (stale ? '数据已超过 3 天未同步 · ' : '数据更新于 ') + when +
      '　共 ' + (X10.count || 0) + ' 条';
  }

  function renderX10Cats() {
    const el = $('x10Cats');
    if (!el || !X10) return;
    const counts = {};
    X10.items.forEach((i) => { counts[i.cat] = (counts[i.cat] || 0) + 1; });
    const order = ['活动', '公告', '赛事', '资讯'];
    const cats = order.filter((c) => counts[c]);
    Object.keys(counts).forEach((c) => { if (cats.indexOf(c) < 0) cats.push(c); });
    const nNew = x10UnseenCount();
    let html = '<button class="chip' + (X10S.cat === 'all' ? ' active' : '') +
      '" data-x10cat="all" type="button">全部 ' + X10.items.length +
      (nNew ? '<i class="chip-new">NEW</i>' : '') + '</button>';
    html += cats.map((c) => {
      const cn = X10.items.filter((i) => i.cat === c && x10IsNew(i)).length;
      return '<button class="chip' + (X10S.cat === c ? ' active' : '') +
        '" data-x10cat="' + esc(c) + '" type="button">' + esc(c) + ' ' + counts[c] +
        (cn ? '<i class="chip-new">NEW</i>' : '') + '</button>';
    }).join('');
    el.innerHTML = html;
  }

  function x10Visible() {
    if (!X10) return [];
    return X10.items.filter((i) => {
      if (X10S.cat !== 'all' && i.cat !== X10S.cat) return false;
      if (X10S.heroOnly && !(i.newHeroes && i.newHeroes.length)) return false;
      return true;
    });
  }

  function renderX10Grid() {
    const grid = $('x10Grid'), emp = $('x10Empty'), cnt = $('x10Count');
    if (!grid || !X10) return;
    const list = x10Visible();
    if (cnt) cnt.textContent = list.length + ' / ' + (X10.count || 0) + ' 条';
    const hb = $('x10HeroOnly');
    if (hb) {
      const n = X10.items.filter((i) => i.newHeroes && i.newHeroes.length).length;
      hb.textContent = (X10S.heroOnly ? '✓ 只看有新武将' : '只看有新武将') + (n ? '（' + n + '）' : '');
      hb.style.fontWeight = X10S.heroOnly ? '600' : '';
    }
    if (!list.length) { grid.innerHTML = ''; if (emp) emp.hidden = false; return; }
    if (emp) emp.hidden = true;

    grid.innerHTML = list.map((i) => {
      const cover = i.cover ? vq(DATA_DIR + 'x10_news/' + i.cover) : '';
      // 摘要：官网正文是把表格拍平的长文本，短词行（「武将名/品质/势力…」）读起来
      // 就是一串字段名，先剔除再截断，摘要才像人话。
      const clean = (i.body || '').split(/\r?\n/).map((s) => s.trim())
        .filter((s) => s.length > 8).join(' ');
      const sum = clean ? clean.slice(0, 150) : '（本条公告为图片形式，无文字正文）';
      const hs = i.newHeroes || [];
      const heroLine = hs.length
        ? '<div class="ol-heroline"><b>新武将</b>' + hs.map((h) =>
            esc(h.name) + '<span class="ol-hp">' + esc(h.kingdom + '·' + (h.hp || '?') + '体力') + '</span>'
          ).join('　') + '</div>'
        : '';
      return '<article class="ol-card" data-x10id="' + esc(i.id) + '">' +
        '<div class="ol-thumb">' +
        (cover ? '<img loading="lazy" src="' + esc(cover) + '" alt="">'
               : '<div class="ol-noimg">原文为图片公告</div>') +
        '<span class="ol-badge" data-cat="' + esc(i.cat) + '">' + esc(i.cat) + '</span>' +
        (hs.length ? '<span class="ol-newhero-tag">新武将 ' + hs.length + '</span>' : '') +
        '</div>' +
        '<div class="ol-cbody">' +
        '<div class="ol-ct">' + esc(i.title) + '</div>' +
        '<div class="ol-cmeta"><span>' + esc(i.date) + '</span>' +
        '<span class="ol-cdot">·</span><span>' + (i.body || '').length + ' 字</span>' +
        (x10IsNew(i) ? '<span class="ol-cdot">·</span><span style="color:var(--zhu);font-weight:600">NEW</span>' : '') +
        '</div>' +
        '<div class="ol-csum">' + esc(sum) + '</div>' +
        heroLine +
        '</div></article>';
    }).join('');
  }

  async function loadX10News(force) {
    /* 同上：轻量子体不装 data/x10_news。 */
    if (LITE && (LITE.hide || []).includes('x10news')) return;
    const bar = $('x10Sync');
    if (!X10 || force) {
      if (bar) bar.classList.add('loading');
      try {
        X10 = await fetchJSON(X10_URL + (force ? '?t=' + Date.now() : ''));
      } catch (e) {
        if (bar) { bar.classList.remove('loading'); bar.classList.add('stale'); }
        const tx = $('x10SyncTx');
        if (tx) tx.textContent = '资讯数据读取失败：' + e.message;
        if (!X10) { const emp = $('x10Empty'); if (emp) { emp.textContent = '资讯数据未就绪，请先运行抓取脚本'; emp.hidden = false; } }
        return;
      }
    }
    renderX10SyncBar(); renderX10Cats(); renderX10Grid(); renderX10NewDot();
  }

  /* ---------- 一将成名详情：正文分节（跳过已结构化的「新品武将」节） ---------- */
  function x10SectionHTML(body) {
    const raw = String(body || '');
    if (!raw.trim()) return '';
    // 按中文序号「一、」「二、」切节
    const secs = raw.split(/(?=^[一二三四五六七八九十]+、)/m).map((s) => s.trim()).filter(Boolean);
    return secs.map((sec) => {
      const lines = sec.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
      const title = lines[0] || '';
      if (/新品武将/.test(title)) return '';        // 新品武将已用结构化卡片展示，正文不重复
      const rest = lines.slice(1);
      const merged = [];
      let buf = [];
      const flush = () => { if (buf.length) { merged.push(buf.join(' ')); buf = []; } };
      for (const ln of rest) {
        if (ln.length <= 8) buf.push(ln);           // 表格碎片短行 → 合并成一行
        else { flush(); merged.push(ln); }
      }
      flush();
      return '<div class="x10-sec">' +
        (title ? '<h4 class="olb-ttl">' + esc(title) + '</h4>' : '') +
        merged.map((p) => '<p class="olb-p">' + esc(p) + '</p>').join('') +
        '</div>';
    }).join('');
  }

  let X10_GUARD = 0;
  function x10HeroCardHTML(h) {
    const inLib = olHeroInLib(h.name);
    const art = h.imgLocal ? vq(DATA_DIR + 'x10_news/' + h.imgLocal) : (h.img || '');
    const meta = [
      h.title ? '称号「' + h.title + '」' : '',
      h.pack || '',
      h.modes || '',
    ].filter(Boolean).join(' · ');
    return '<div class="x10-nh">' +
      '<div class="x10-nh-art">' +
      (art
        ? '<img loading="lazy" src="' + esc(art) + '" alt="' + esc(h.name) + '立绘">'
        : '<div class="x10-noart">暂无立绘</div>') +
      '</div>' +
      '<div class="x10-nh-main">' +
      '<div class="x10-nh-top"><b>' + esc(h.name) + '</b>' +
      (h.quality ? '<span class="x10-nh-q" data-q="' + esc(h.quality) + '">' + esc(h.quality) + '</span>' : '') +
      (h.kingdom ? '<span class="x10-nh-kt" data-k="' + esc(h.kingdomKey || '') + '">' + esc(h.kingdom) + '</span>' : '') +
      '</div>' +
      '<div class="x10-nh-meta">' +
      (h.hp ? '<i>' + esc(h.hp) + '</i> 体力' : '') +
      (h.gender ? ' · ' + esc(h.gender) : '') +
      (meta ? '<br>' + esc(meta) : '') + '</div>' +
      (h.bio ? '<div class="x10-nh-bio clamp">' + esc(h.bio) + '</div>' +
               '<button class="x10-nh-more" type="button" data-x10bio="1">展开生平 ↓</button>' : '') +
      ((h.skills || []).length
        ? '<ul class="ol-nh-sk">' + h.skills.map((s) =>
            '<li><b>【' + esc(s.name) + '】</b>' + esc(s.desc) + '</li>').join('') + '</ul>'
        : '') +
      (h.obtain ? '<div class="x10-nh-obtain"><i>获取</i>' + esc(h.obtain) + '</div>' : '') +
      (inLib
        ? '<div class="ol-nh-miss">武将库已收录 → <b data-x10onh="' + esc(inLib.id) + '">查看 ' + esc(inLib.n) + '</b></div>'
        : '<div class="ol-nh-miss">武将库尚未收录，可作为下次补录候选</div>') +
      '</div></div>';
  }

  function openX10News(id) {
    if (!X10) return;
    const it = X10.items.find((x) => x.id === id);
    if (!it) return;
    X10_GUARD = Date.now();

    const cover = it.cover ? vq(DATA_DIR + 'x10_news/' + it.cover) : '';
    const hs = it.newHeroes || [];
    const heroBlock = hs.length ? (
      '<div class="ol-newheros">' +
      '<div class="ol-nh-head">新品武将上线<i>共 ' + hs.length + ' 位 · 摘自官网原文</i></div>' +
      hs.map(x10HeroCardHTML).join('') +
      '</div>'
    ) : '';
    const bodyHTML = x10SectionHTML(it.body);

    $('x10Body').innerHTML =
      '<div class="ol-dh">' +
      '<div class="ol-dtop">' +
      '<span class="ol-dcat" data-cat="' + esc(it.cat) + '">' + esc(it.cat) + '</span>' +
      '<span class="ol-ddate">' + esc(it.pub || it.date) + '</span>' +
      (x10IsNew(it) ? '<span class="ol-ddate" style="color:var(--zhu);font-weight:600">NEW</span>' : '') +
      '</div>' +
      '<h2>' + esc(it.title) + '</h2>' +
      '</div>' +
      (cover ? '<div class="ol-dcover"><img src="' + esc(cover) + '" alt=""></div>' : '') +
      heroBlock +
      (bodyHTML ? '<div class="ol-dbody olb">' + bodyHTML + '</div>' : '') +
      '<div class="ol-src">' +
      '<a href="' + esc(it.url) + '" target="_blank" rel="noopener">查看官网原文 ↗</a>' +
      '<span style="font-size:11px;color:var(--ink3)">来源：三国杀一将成名官网（十周年）</span>' +
      '</div>';

    $('x10mask').hidden = false;
    $('x10modal').hidden = false;
    document.body.style.overflow = 'hidden';
  }
  function closeX10News() {
    if (Date.now() - X10_GUARD < 250) return;
    $('x10mask').hidden = true;
    $('x10modal').hidden = true;
    document.body.style.overflow = '';
  }

  /* ---------- 「同步最新」：走本地服务（file:// 下不可用） ---------- */
  async function syncX10News() {
    const btn = $('x10SyncBtn'), tx = $('x10SyncTx');
    if (IS_OFFLINE) { toast('离线版已内置全部资讯，无需同步'); return; }
    if (location.protocol === 'file:') {
      toast('本地文件模式无法自动同步，请运行：python v2/fetch_x10_news.py --pages 3');
      return;
    }
    if (btn.disabled) return;
    btn.disabled = true;
    const old = btn.textContent;
    btn.textContent = '同步中…';
    if (tx) tx.textContent = '正在抓取官网最新资讯…';
    try {
      const r = await fetch('api/x10news/sync', { method: 'POST' });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || d.ok === false) throw new Error(d.error || ('HTTP ' + r.status));
      await loadX10News(true);
      renderNews10Slide();
      toast('同步完成，共 ' + (d.count != null ? d.count : (X10 ? X10.count : '?')) + ' 条');
    } catch (e) {
      toast('同步失败：' + e.message);
      renderX10SyncBar();
    } finally {
      btn.disabled = false;
      btn.textContent = old;
    }
  }

  async function initX10News() {
    renderX10Header();
    if ($('x10Cats')) {
      $('x10Cats').addEventListener('click', (e) => {
        const t = e.target.closest('[data-x10cat]'); if (!t) return;
        X10S.cat = t.dataset.x10cat;
        renderX10Cats(); renderX10Grid();
      });
    }
    if ($('x10HeroOnly')) {
      $('x10HeroOnly').addEventListener('click', () => {
        X10S.heroOnly = !X10S.heroOnly; renderX10Grid();
      });
    }
    if ($('x10Grid')) {
      $('x10Grid').addEventListener('click', (e) => {
        const t = e.target.closest('[data-x10id]'); if (t) openX10News(t.dataset.x10id);
      });
    }
    if ($('x10mask')) $('x10mask').addEventListener('click', closeX10News);
    if ($('x10close')) $('x10close').addEventListener('click', closeX10News);
    if ($('x10SyncBtn')) $('x10SyncBtn').addEventListener('click', syncX10News);
    // 详情页里「展开生平」+「查看 X」跳到武将详情
    if ($('x10Body')) {
      $('x10Body').addEventListener('click', (e) => {
        const bio = e.target.closest('[data-x10bio]');
        if (bio) {
          const card = bio.closest('.x10-nh');
          const box = card && card.querySelector('.x10-nh-bio');
          if (box) {
            const open = box.classList.toggle('clamp');
            bio.textContent = open ? '展开生平 ↓' : '收起生平 ↑';
          }
          return;
        }
        const t = e.target.closest('[data-x10onh]'); if (!t) return;
        closeX10News();
        setTimeout(() => { go('heroes'); open(t.dataset.x10onh); }, 120);
      });
    }
    // 预取数据以便轮播第 3 屏 / 圆点角标（不阻塞首屏）
    loadX10News(false);
  }

  /* ============ 玩法模块（up/003 第四 Tab · 原生等价组件） ============
     GameplayView   → page-mode + renderMver/renderMcats/renderModeList（双层级联动）
     DeskSandbox    → renderDesk/pickSeat（SVG 环形连线 + 绝对定位座位 + 中央规则卡）
     PhaseAccordion → renderPhases（复用 .scroll/.sc-head 手风琴体系）
     数据：data/gameplayRules.json（官网实抓，结构见 types/gameplay.ts） */
  const MODE_URL = vq(DATA_DIR + 'gameplayRules.json');   // 挂版本串：CDN 按内容编码分层缓存，裸 URL 会长期拿到旧规则
  let MODERULES = null;
  const MO = { ver: 'ol', cat: null, view: 'identity8', seat: null };

  function modeVer() { return MODERULES.versions.find(v => v.id === MO.ver); }
  function modeRole(id) { return MODERULES.roles.find(r => r.id === id); }
  function shade(hex, amt) {           // 颜色提亮（径向高光用）
    const n = parseInt(hex.slice(1), 16), a = amt || 26;
    const r = Math.min(255, (n >> 16) + a), g = Math.min(255, ((n >> 8) & 255) + a), b = Math.min(255, (n & 255) + a);
    return 'rgb(' + r + ',' + g + ',' + b + ')';
  }
  function renderMver() {
    for (const b of document.querySelectorAll('#mverSeg button')) {
      b.classList.toggle('active', b.dataset.ver === MO.ver);
    }
  }
  function renderMcats() {
    const ver = modeVer();
    if (!ver.cats.some(c => c.id === MO.cat)) MO.cat = ver.cats[0].id;
    $('mcatBar').innerHTML = ver.cats.map(c =>
      '<button class="mcat' + (c.id === MO.cat ? ' active' : '') + '" data-cat="' + c.id + '" type="button">' + esc(c.label) + '</button>').join('');
  }
  function renderModeList() {
    const list = modeVer().modes.filter(m => m.cat === MO.cat);
    $('modeList').innerHTML = list.map(m => {
      const roles = (m.roles || []).map(r => '<div class="mr"><b>' + esc(r.name) + '</b> ' + esc(r.goal) + '</div>').join('');
      const tips = (m.tips || []).length ? '<ul class="mtips">' + m.tips.map(t => '<li>' + esc(t) + '</li>').join('') + '</ul>' : '';
      const mins = m.minutes ? '<span class="mbadge">' + esc(m.minutes) + '</span>' : '';
      /* 来源信息不在此平铺（硬规则）：source 保留在 JSON 契约里，统一归入免责声明弹窗 */
      return '<article class="mcard">' +
        '<div class="mcard-h"><b>' + esc(m.name) + '</b><span class="mbadge">' + esc(m.players) + '</span>' + mins + '</div>' +
        '<p>' + esc(m.desc) + '</p>' +
        (roles ? '<div class="mroles">' + roles + '</div>' : '') + tips +
        '</article>';
    }).join('');
  }
  function renderMviews() {
    $('mviewBar').innerHTML = MODERULES.sandbox.views.map(v =>
      '<button class="mcat' + (v.id === MO.view ? ' active' : '') + '" data-view="' + v.id + '" type="button">' + esc(v.label) + '</button>').join('');
  }
  function renderDesk() {
    const view = MODERULES.sandbox.views.find(v => v.id === MO.view);
    const seats = view.seats;
    let lines = '';
    for (let i = 0; i < seats.length; i++) {           // 相邻座次环形虚线
      const a = seats[i], b = seats[(i + 1) % seats.length];
      lines += '<line data-pair="' + a.no + '-' + b.no + '" x1="' + a.x + '" y1="' + a.y + '" x2="' + b.x + '" y2="' + b.y + '"/>';
    }
    const dots = seats.map(s => {
      const r = modeRole(s.role);
      return '<button class="seat" data-seat="' + s.no + '" type="button" aria-label="' + s.no + '号位 ' + esc(r.name) + '"' +
        ' style="left:' + s.x + '%;top:' + s.y + '%;background:radial-gradient(circle at 35% 28%,' + shade(r.color) + ',' + r.color + ')">' +
        '<span class="stotem">' + r.totem + '</span><span class="sname">' + esc(r.name) + '</span><span class="sno">' + s.no + '</span></button>';
    }).join('');
    $('desk').innerHTML = '<svg class="desk-svg" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">' + lines + '</svg>' + dots;
  }
  function hideDeskInfo() {
    const info = $('deskInfo');
    if (info.hidden) return;
    info.classList.add('closing');
    setTimeout(() => { info.hidden = true; info.classList.remove('closing'); }, 150);
    MO.seat = null;
    document.querySelectorAll('#desk .seat.sel').forEach(s => s.classList.remove('sel'));
    document.querySelectorAll('#desk .desk-svg line.hot').forEach(l => l.classList.remove('hot'));
  }
  function pickSeat(no) {
    if (MO.seat === no) { hideDeskInfo(); return; }    // 再点同一座位 = 收起
    const view = MODERULES.sandbox.views.find(v => v.id === MO.view);
    const s = view.seats.find(x => x.no === no);
    const r = modeRole(s.role);
    MO.seat = no;
    const n = view.seats.length;
    const idx = view.seats.findIndex(x => x.no === no);
    const prev = view.seats[(idx - 1 + n) % n], next = view.seats[(idx + 1) % n];
    document.querySelectorAll('#desk .desk-svg line').forEach(l => {   // 相邻连线高亮
      const p = l.dataset.pair.split('-').map(Number);
      l.classList.toggle('hot', (p[0] === no && (p[1] === prev.no || p[1] === next.no)) ||
                                (p[1] === no && (p[0] === prev.no || p[0] === next.no)));
    });
    document.querySelectorAll('#desk .seat').forEach(el => el.classList.toggle('sel', Number(el.dataset.seat) === no));
    const nearText = prev.no + '号位·' + esc(modeRole(prev.role).name) + '、' + next.no + '号位·' + esc(modeRole(next.role).name);
    $('deskInfo').innerHTML =
      '<button class="di-close" type="button" aria-label="关闭">✕</button>' +
      '<div class="di-head">' +
      '<b>' + esc(r.name) + ' · ' + s.no + '号位</b><small>' + esc(r.alias || '') + '</small></div>' +
      '<ul class="di-goals">' + r.goals.map(g => '<li>' + esc(g) + '</li>').join('') + '</ul>' +
      '<p class="di-row"><b>体力上限</b>' + esc(r.hpNote) + '</p>' +
      (r.reward ? '<p class="di-row warn"><b>奖惩</b>' + esc(r.reward) + '</p>' : '') +
      '<p class="di-near">相邻座次（距离1 · 环形）：' + nearText + '。进攻/防御距离受 −1马 / +1马 影响。</p>';
    const info = $('deskInfo');
    info.hidden = false;
    info.style.animation = 'none'; void info.offsetWidth; info.style.animation = '';  // 重播入场动画
    tapFeel(8);
  }
  function renderPhases() {
    const NUMS = '①②③④⑤⑥';
    $('phaseAcc').innerHTML = MODERULES.phases.map(p =>
      '<div class="scroll" data-ph="' + p.idx + '">' +
      '<button class="sc-head" type="button"><h4>' + NUMS[p.idx - 1] + ' ' + esc(p.name) + '</h4><i class="sc-arrow">▾</i></button>' +
      '<div class="sc-body"><p>' + esc(p.act) + '</p>' +
      '<p class="ph-skill"><b>典型技能</b>' + esc(p.skills) + '</p>' +
      '<div class="ph-trap"><b>时序陷阱</b>' + esc(p.trap) + '</div>' +
      '</div></div>').join('');
  }
  async function initMode() {
    try { MODERULES = await fetchJSON(MODE_URL); } catch (e) { MODERULES = null; }
    if (!MODERULES) return;
    renderMver(); renderMcats(); renderModeList(); renderMviews(); renderDesk(); renderPhases();
    $('mverSeg').addEventListener('click', (e) => {
      const b = e.target.closest('[data-ver]'); if (!b) return;
      MO.ver = b.dataset.ver; hideDeskInfo();
      renderMver(); renderMcats(); renderModeList();
    });
    $('mcatBar').addEventListener('click', (e) => {
      const b = e.target.closest('[data-cat]'); if (!b) return;
      MO.cat = b.dataset.cat; renderMcats(); renderModeList();
    });
    $('mviewBar').addEventListener('click', (e) => {
      const b = e.target.closest('[data-view]'); if (!b) return;
      MO.view = b.dataset.view; hideDeskInfo();
      renderMviews(); renderDesk();
    });
    $('desk').addEventListener('click', (e) => {
      const b = e.target.closest('.seat');
      if (b) { pickSeat(Number(b.dataset.seat)); return; }
      if (e.target === $('desk')) hideDeskInfo();      // 点案几空白收起
    });
    $('deskInfo').addEventListener('click', (e) => { if (e.target.closest('.di-close')) hideDeskInfo(); });
    $('phaseAcc').addEventListener('click', (e) => {   // 与战术心法同款手风琴委托
      const head = e.target.closest('.sc-head'); if (!head) return;
      head.parentElement.classList.toggle('open');
    });
  }

  /* 新月杀入口（只有 Android 壳里内置了游戏才出现）：
     壳里 window.SGSHost.launchGame() 直接切到同一个包内的 QtActivity；
     网页版没有 SGSHost → 整张卡保持隐藏，线上不显示。 */
  function initFkEntry() {
    const card = $('fkCard'), btn = $('fkEntry');
    if (!card || !btn) return;
    const host = window.SGSHost;
    if (!host || typeof host.launchGame !== 'function') return;
    card.style.display = '';                 // 交回 .gcard 自己的显示方式
    btn.addEventListener('click', () => {
      try { host.launchGame(); } catch (e) { alert('打开《新月杀》失败：' + e); }
    });
  }

  /* ============ 启动 ============ */
  async function boot() {
    SPLASH.onOut = () => { bgmStart(); maybeShowUpdate(); };   // 退场后：起背景乐，再判断要不要弹「更新优化说明」
    splashStart();
    applyTheme(themeMode());
    applyOfflineMode();
    initFiltersOpen();
    initSecFolds();
    initNameEdit();
    initAuth();
    initDisclaimer();
    initUpdates();
    initHeroHeader();
    initModePane();
    initMode();
    initFkEntry();
    initCards();
    /* 资讯初始化挪到下面 LITE 判定之后：轻量子体要在发请求前就知道「这两块被裁了」，
       否则 loadOlNews 会先打出一次必然 404 的请求（2026-11-09）。 */
    placeTabDot();
    renderStorage();
    renderFavs();
    setStatus('正在载入版本清单…');
    try {
      const idx = await fetchJSON(INDEX_URL);
      INDEX = idx.versions || [];
      LITE = idx.lite || null;
      if (LITE) applyLiteProfile(LITE);   // 子体裁剪；本体 idx 无 lite 字段 → 不执行
      initOlNews();                       // 本体照旧拉资讯；子体已在 loadOlNews 里短路
      initX10News();
      splashProgress(45);                            // 桩点：版本清单就绪
    } catch (err) {
      setStatus(null);
      $('empty').textContent = '无法读取 data/index.json：' + err.message +
        (location.protocol === 'file:' ? '（请通过 http 访问）' : '');
      $('empty').hidden = false;
      splashFinish();                                // 出错路径也收场，防开屏卡死
      return;
    }
    renderTabs();
    const saved = safeGet(VERSION_KEY);
    const target = INDEX.some((v) => v.id === saved) ? saved : DEFAULT_VERSION;
    try {
      await switchVersion(target);
      splashProgress(85);                            // 桩点：版本数据就绪
    } catch (err) {
      setStatus(null);
      $('empty').textContent = '无法载入版本数据：' + err.message;
      $('empty').hidden = false;
      splashFinish();
      return;
    }
    renderHome();
    splashProgress(100);                             // 桩点：首屏渲染完成
    precacheAvatars();                               // 后台预缓存缩略图，不阻塞退出
    // 首页轮播第 2/3 屏要显示最新公告 —— 后台静默拉一次（不 await，不阻塞开屏）
    loadOlNews().then(() => renderNewsSlide()).catch(() => {});
    loadX10News().then(() => renderNews10Slide()).catch(() => {});
    splashFinish();
  }

  boot();
})();
