/* ============================================================
   三国史料学习模块 · 逻辑（可挂载 / 可卸载）
   架构：以书为中心 —— 书库(默认) → 卷目录 → 阅读器；
   学习路线/知识卡片/正史vs演义/题库 为衍生板块。
   只读 data/history/，不调用游戏库任何数据。
   related_sgs_character_id 仅作文字展示，不做跳转。

   接入方式（主 app 内嵌，不跳页）：
     window.HISTORY_MODULE.mount(el)   // el = 承载容器（主 app 的弹层体）
     window.HISTORY_MODULE.unmount()   // 关闭时调用，解绑事件、清空容器
   独立整页 history.html 仍可单独打开（它会自己建一个容器再 mount）。
   ============================================================ */
(function () {
  'use strict';

  const SRC_LABEL = {
    sanguozhi: '《三国志》正文', sgz: '《三国志》正文', peizhu: '裴松之注',
    yanyi: '《三国演义》', houhanshu: '《后汉书》', jinshu: '《晋书》',
    tongjian: '《资治通鉴》', chenshou: '陈寿专题'
  };
  const KIND_LABEL = { shishu: '纪传体史书', biannian: '编年体史书', xiaoshuo: '章回小说' };
  const DIFF_LABEL = { beginner: '入门', intermediate: '进阶', advanced: '深度' };
  const QTYPE_LABEL = { single: '单选', multi: '多选', judge: '判断', short: '简答' };
  const CN = ['一','二','三','四','五','六','七','八','九','十',
    '十一','十二','十三','十四','十五','十六','十七','十八','十九','二十',
    '二十一','二十二','二十三','二十四','二十五','二十六','二十七','二十八','二十九','三十'];

  /* 每个挂载周期独立的状态与容器引用 */
  let state = null;
  let root = null;      // 承载容器（.hpage）
  let detachFns = [];   // 事件解绑函数

  function $(id) { return root ? root.querySelector('#' + id) : null; }

  function bind(el, type, fn, opts) {
    if (!el) return;
    el.addEventListener(type, fn, opts);
    detachFns.push(() => el.removeEventListener(type, fn, opts));
  }

  async function loadJSON(path) {
    const r = await fetch('data/history/' + path, { cache: 'no-store' });
    if (!r.ok) throw new Error(path + ' ' + r.status);
    return r.json();
  }

  /* ---------- 骨架（内嵌用，无 head/body/子导航文档级样式） ---------- */
  function skeleton() {
    return `
    <header class="h-head">
      <div class="h-head-inner">
        <h1>三国史料学习</h1>
        <p class="h-head-sub">古籍通识 · 正史与演义分轨 · 通俗自测</p>
      </div>
    </header>

    <nav class="h-subnav" id="hSubnav" role="tablist">
      <button class="h-subtab active" data-view="shelf" type="button">书库</button>
      <button class="h-subtab" data-view="route" type="button">学习路线</button>
      <button class="h-subtab" data-view="cards" type="button">知识卡片</button>
      <button class="h-subtab" data-view="compare" type="button">正史vs演义</button>
      <button class="h-subtab" data-view="quiz" type="button">自测题库</button>
    </nav>

    <div class="h-diffbar" id="hDiffbar">
      <button class="h-chip active" data-diff="all" type="button">全部</button>
      <button class="h-chip" data-diff="beginner" type="button">入门</button>
      <button class="h-chip" data-diff="intermediate" type="button">进阶</button>
      <button class="h-chip" data-diff="advanced" type="button">深度</button>
    </div>

    <div class="h-main">
      <section id="view-shelf" class="h-view active"><div id="shelfList"></div></section>
      <section id="view-catalog" class="h-view"></section>
      <section id="view-reader" class="h-view"></section>

      <section id="view-route" class="h-view active"><div id="routeList" class="h-cards"></div></section>
      <section id="view-cards" class="h-view"><div id="cardList" class="h-cards"></div></section>
      <section id="view-compare" class="h-view"><div id="compareList" class="h-cards"></div></section>
      <section id="view-quiz" class="h-view">
        <div class="h-quiz-setup">
          <div class="h-quiz-scope" id="quizScopes"></div>
          <button id="quizStart" class="h-btn-primary" type="button">开始答题</button>
        </div>
        <div id="quizArea"></div>
      </section>
    </div>

    <div class="h-modal" id="hModal" hidden>
      <div class="h-modal-mask" id="hMask"></div>
      <div class="h-modal-body" id="hModalBody"></div>
    </div>

    <p class="h-disclaim">古籍属公有领域；历史科普仅供爱好者学习参考，不构成学术定论。本模块内容与三国杀游戏设定相互隔离。</p>`;
  }

  async function init() {
    try {
      const [idx, cards, cmp, quiz] = await Promise.all([
        loadJSON('index.json'), loadJSON('cards.json'),
        loadJSON('compare.json'), loadJSON('quiz.json')
      ]);
      if (!root) return;   // 加载途中已卸载
      state.books = idx.books || [];
      state.route = idx.route || [];
      state.cards = cards.items || [];
      state.compare = cmp.items || [];
      state.quiz = quiz.items || [];
      state.quizScopes = quiz.scopes || [];
      renderShelf(); renderRoute(); renderCards(); renderCompare(); renderQuizScopes();
    } catch (e) {
      const m = root && root.querySelector('.h-main');
      if (m) m.innerHTML =
        '<p style="text-align:center;color:var(--ink3);padding:40px 0">史料数据加载失败：' +
        e.message + '<br>请确认 data/history/ 目录下 JSON 文件完整。</p>';
    }
  }

  /* ============ 视图切换 ============ */
  function showView(v) {
    for (const s of root.querySelectorAll('.h-view')) s.classList.remove('active');
    const el = $('view-' + v); if (el) el.classList.add('active');
    const nav = (v === 'catalog' || v === 'reader') ? 'shelf' : v;
    for (const t of root.querySelectorAll('.h-subtab'))
      t.classList.toggle('active', t.dataset.view === nav);
    const db = $('hDiffbar');
    if (db) db.style.display = (v === 'route' || v === 'cards' || v === 'compare') ? '' : 'none';
    const sc = root.closest('#hpageBody') || root.parentElement;
    if (sc) sc.scrollTop = 0;
  }

  /* ============ ⓪ 书库 ============ */
  function renderShelf() {
    // 按相关性分组：三国直接史料（三国志/通鉴三国部分）/ 汉晋背景史料（后汉书/晋书）
    const groups = [
      { key: 'core', label: '三国直接史料', hint: '记载三国本身，可逐卷通读' },
      { key: 'related', label: '汉末 / 西晋背景', hint: '三国人物的前后时代，含汉末群雄与司马氏' },
    ];
    let html = '';
    for (const g of groups) {
      const items = state.books.filter((b) => (b.rel || (b.is_core ? 'core' : 'related')) === g.key);
      if (!items.length) continue;
      html += `<h4 class="h-shelf-group">${g.label}<span class="h-shelf-hint">${g.hint}</span></h4>` +
        '<div class="h-bookgrid">' + items.map(bookCard).join('') + '</div>';
    }
    $('shelfList').innerHTML = html;
  }

  function bookCard(b) {
    return `<article class="h-book ${b.catalog ? '' : 'h-book-na'}" ${b.catalog ? `data-open-book="${b.id}" style="cursor:pointer"` : ''}>
      <div class="h-book-spine h-accent-${b.accent || 'bronze'}"></div>
      <div class="h-book-main">
        <h3 class="h-card-title">${b.title}</h3>
        <p class="h-book-author">${b.author} · ${KIND_LABEL[b.kind] || ''}</p>
        <p class="h-card-sum" style="font-size:12px;color:var(--ink3)">${b.coverage}</p>
        ${b.is_core ? '<span class="h-badge src">核心必读</span>' : '<span class="h-badge src">辅助史料</span>'}
      </div>
      ${b.catalog ? '<div class="h-book-arrow">›</div>' : ''}
    </article>`;
  }

  async function openBook(bookId) {
    const meta = state.books.find((b) => b.id === bookId); if (!meta || !meta.catalog) return;
    showView('catalog');
    $('view-catalog').innerHTML = '<p style="text-align:center;color:var(--ink3);padding:24px">目录加载中…</p>';
    try {
      const cat = await loadJSON(meta.catalog);
      if (!root) return;
      state.curBook = meta; state.curCatalog = cat;
      renderCatalog();
    } catch (e) {
      if (root) $('view-catalog').innerHTML = `<p style="color:var(--ink3);text-align:center;padding:24px">目录加载失败：${e.message}</p>`;
    }
  }

  function renderCatalog() {
    const cat = state.curCatalog, meta = state.curBook;
    const ready = cat.chapters.filter((c) => c.status === 'ready').length;
    // 分组：按 chapters 里 part 的出现顺序（三国志 = 魏/蜀/吴；其余书无 part → 单组）
    const groups = [];
    for (const c of cat.chapters) {
      const g = c.part || '';
      if (!groups.includes(g)) groups.push(g);
    }
    let body = '';
    if (groups.length <= 1) {
      body = '<div class="h-cat-list">' +
        cat.chapters.map((c) => chRow(c, volLabel(c))).join('') + '</div>';
    } else {
      for (const g of groups) {
        const items = cat.chapters.filter((c) => (c.part || '') === g);
        if (!items.length) continue;
        const seg = /书$/.test(g) ? ' · ' + items.length + '卷' : '';
        body += `<h4 class="h-cat-part">${g}${seg}</h4><div class="h-cat-list">` +
          items.map((c) => chRow(c, volLabel(c))).join('') + '</div>';
      }
    }
    $('view-catalog').innerHTML = `
      <div class="h-back" data-nav="shelf">‹ 返回书库</div>
      <article class="h-card" style="margin-bottom:12px">
        <h3 class="h-card-title">${cat.title}</h3>
        <p class="h-book-author">${cat.author}</p>
        <p class="h-card-sum">${cat.intro}</p>
        <p class="h-card-sum" style="font-size:12px;color:var(--ink3)">
          共 ${cat.chapters.length} 篇 · 已录入 ${ready} 篇${cat.chapters.some((c) => c.source_note) ? ' · 部分原文无标点，按句末断句整理' : ''}</p>
      </article>${body}`;
  }

  /* 卷/篇标签：三国志用「卷X」并带书名分卷；其余用原卷号（如「卷第六十」/「帝纪第一」） */
  function volLabel(c) {
    if (c.part && typeof c.part_no === 'number' && c.part_no > 0 && c.part_no <= CN.length) {
      return '卷' + CN[c.part_no - 1];
    }
    return c.vol_no || ('第' + c.global_no + '卷');
  }

  function chRow(c, label) {
    const ready = c.status === 'ready';
    const note = c.source_note ? ' title="' + c.source_note + '"' : '';
    return `<button class="h-cat-row" data-open-ch="${c.id}" ${ready ? '' : 'disabled'} type="button"${note}>
      <span class="h-cat-vol">${label}</span>
      <span class="h-cat-t">${c.title}</span>
      ${ready ? '<span class="h-badge diff-beginner">已录入</span>' : '<span class="h-cat-pending">待录入</span>'}
    </button>`;
  }

  async function openChapter(chId) {
    showView('reader');
    $('view-reader').innerHTML = '<p style="text-align:center;color:var(--ink3);padding:24px">正文加载中…</p>';
    try {
      const ch = await loadJSON('contents/' + chId + '.json');
      if (!root) return;
      renderReader(ch);
    } catch (e) {
      if (root) $('view-reader').innerHTML = `<div class="h-back" data-nav="catalog">‹ 返回目录</div>
        <p style="color:var(--ink3);text-align:center;padding:24px">本章内容加载失败：${e.message}</p>`;
    }
  }

  function renderReader(ch) {
    const catCh = state.curCatalog && state.curCatalog.chapters.find((c) => c.id === ch.chapter_id);
    const volLabel = catCh ? volLabelOf(catCh) : (ch.vol_no || '');
    const orig = (ch.original || []).map((p) => `<p class="h-orig">${p}</p>`).join('');
    const pz = (ch.peizhu || []).map((p) =>
      `<div class="h-pz"><p class="h-orig">${p.text}</p><cite class="h-pz-src">—— ${p.source}</cite></div>`).join('');
    const noPunctNote = ch.book_id === 'sgz'
      ? '<p class="h-src-note">本卷据四库全书本录入，原文无标点，已按句末断句整理（不加句内逗号，避免误断）。</p>' : '';
    $('view-reader').innerHTML = `
      <div class="h-back" data-nav="catalog">‹ 返回目录</div>
      <article class="h-card h-reader${ch.book_id === 'sgz' ? ' has-nopunct' : ''}">
        <h3 class="h-card-title">${ch.title}</h3>
        <p class="h-book-author" style="margin-bottom:10px">${volLabel} · ${SRC_LABEL[ch.source_type] || ''}</p>
        ${noPunctNote}
        <div class="h-rsec"><h4>原文</h4>${orig}</div>
        ${pz ? `<div class="h-rsec"><h4>裴松之注 / 异说</h4>${pz}</div>` : ''}
      </article>`;
  }

  /* 目录里的卷标签（与 renderCatalog 一致） */
  function volLabelOf(c) {
    if (c.part && typeof c.part_no === 'number' && c.part_no > 0 && c.part_no <= CN.length) {
      return c.part + ' 卷' + CN[c.part_no - 1];
    }
    return c.vol_no || ('第' + c.global_no + '卷');
  }

  /* ============ 徽章 ============ */
  function badges(item, opts = {}) {
    let h = '<div class="h-badges">';
    if (opts.showDiff && item.difficulty)
      h += `<span class="h-badge diff-${item.difficulty}">${DIFF_LABEL[item.difficulty] || item.difficulty}</span>`;
    if (item.source_type) h += `<span class="h-badge src">${SRC_LABEL[item.source_type] || item.source_type}</span>`;
    if (item.is_fiction) h += '<span class="h-badge fiction">《三国演义》文学虚构，正史无记载</span>';
    if (opts.showRel && Array.isArray(item.related_sgs_character_id) && item.related_sgs_character_id.length)
      h += `<span class="h-badge rel">关联武将：${item.related_sgs_character_id.join('、')}</span>`;
    return h + '</div>';
  }

  const diffMatch = (d) => state.diff === 'all' || d === state.diff;

  /* ============ ① 学习路线 ============ */
  function renderRoute() {
    $('routeList').innerHTML = state.route.filter((r) => diffMatch(r.difficulty))
      .sort((a, b) => a.priority - b.priority)
      .map((r) => `
        <article class="h-card">
          ${badges(r, { showDiff: true })}
          <h3 class="h-card-title">${r.title}</h3>
          <p class="h-card-sum">${r.summary}</p>
          <p class="h-card-sum" style="color:var(--ink3);font-size:12px">
            建议用时约 ${r.estimated_min} 分钟 · 配套卡片 ${r.card_ids.length ? r.card_ids.length + ' 张' : '待补'}</p>
          ${r.card_ids.length ? `<button class="h-btn-primary" data-open-cards="${r.card_ids.join(',')}">阅读本阶卡片</button>` : ''}
        </article>`).join('') ||
      '<p style="color:var(--ink3);text-align:center;padding:24px">当前难度暂无路线内容</p>';
  }

  /* ============ ② 知识卡片 ============ */
  function renderCards() {
    $('cardList').innerHTML = state.cards.filter((c) => diffMatch(c.difficulty))
      .map((c) => `
        <article class="h-card" data-open-card="${c.id}" style="cursor:pointer">
          ${badges(c, { showDiff: true, showRel: true })}
          <h3 class="h-card-title">${c.title}</h3>
          <p class="h-card-sum">${c.summary}</p>
        </article>`).join('') ||
      '<p style="color:var(--ink3);text-align:center;padding:24px">当前难度暂无卡片</p>';
  }

  function openCard(id) {
    const c = state.cards.find((x) => x.id === id); if (!c) return;
    $('hModalBody').innerHTML = `
      ${badges(c, { showDiff: true, showRel: true })}
      <h3>${c.title}</h3>
      <p class="h-card-sum">${c.content_text}</p>
      ${c.quote ? `<blockquote class="h-card-quote">${c.quote}<cite>—— ${c.quote_source}</cite></blockquote>` : ''}
      ${c.pitfall ? `<p class="h-card-sum" style="background:var(--zhu-soft);padding:8px 10px;border-radius:8px"><b>易错点：</b>${c.pitfall}</p>` : ''}
      <p class="h-card-sum" style="color:var(--ink3);font-size:12px">出处：${c.reference || '—'} · 可信度 ${c.reliability_level || '—'}</p>`;
    $('hModal').hidden = false;
  }

  /* ============ ③ 正史 vs 演义 ============ */
  function renderCompare() {
    $('compareList').innerHTML = state.compare.filter((c) => diffMatch(c.difficulty))
      .sort((a, b) => a.priority - b.priority)
      .map((c) => `
        <article class="h-card">
          ${badges(c, { showDiff: true })}
          <h3 class="h-card-title">${c.title}</h3>
          <div class="h-cmp">
            <div class="h-cmp-col h-cmp-history"><h4>正史</h4>${c.history_side.text}
              <div style="margin-top:6px;font-size:11px;color:var(--ink3)">${c.history_side.reference}</div></div>
            <div class="h-cmp-col h-cmp-fiction"><h4>演义</h4>${c.fiction_side.text}
              <div style="margin-top:6px;font-size:11px;color:var(--ink3)">${c.fiction_side.reference}</div></div>
          </div>
          <p class="h-card-sum" style="background:var(--bronze-soft);padding:8px 10px;border-radius:8px">
            <b>结论：</b>${c.verdict}</p>
        </article>`).join('') ||
      '<p style="color:var(--ink3);text-align:center;padding:24px">当前难度暂无对照内容</p>';
  }

  /* ============ ④ 题库 ============ */
  function renderQuizScopes() {
    const chips = [{ id: 'all', label: '全部单元' }].concat(state.quizScopes);
    $('quizScopes').innerHTML = chips.map((s) =>
      `<button class="h-scope ${s.id === state.scope ? 'active' : ''}" data-scope="${s.id}" type="button">${s.label}</button>`).join('');
  }

  function renderQ(q, idx) {
    let body = '';
    if (q.type === 'single' || q.type === 'multi') {
      body = '<div class="h-q-opts">' + q.options.map((o, oi) =>
        `<button class="h-q-opt" data-q="${q.id}" data-o="${oi}" type="button">${String.fromCharCode(65 + oi)}. ${o}</button>`).join('') + '</div>';
    } else if (q.type === 'judge') {
      body = '<div class="h-q-opts">' + ['正确', '错误'].map((o, oi) =>
        `<button class="h-q-opt" data-q="${q.id}" data-o="${oi}" type="button">${o}</button>`).join('') + '</div>';
    } else {
      body = `<textarea class="h-q-opt" data-short="${q.id}" rows="3" style="resize:vertical;width:100%" placeholder="输入你的答案…"></textarea>`;
    }
    return `
      <div class="h-q" data-quiz="${q.id}">
        <span class="h-q-type">${QTYPE_LABEL[q.type]} · ${DIFF_LABEL[q.difficulty] || ''} · 考点：${q.exam_source}</span>
        <p class="h-q-stem">${idx + 1}. ${q.stem}</p>
        ${body}
        <button class="h-q-submit" data-submit="${q.id}" type="button">提交本题</button>
        <div class="h-q-exp" id="exp-${q.id}"></div>
      </div>`;
  }

  function checkAllDone() {
    const total = root.querySelectorAll('.h-q').length;
    const done = root.querySelectorAll('.h-q-submit:disabled').length;
    if (total && done === total) {
      let score = 0;
      for (const q of state.quiz) {
        const exp = $('exp-' + q.id);
        if (exp && exp.textContent.startsWith('回答正确')) score++;
      }
      const el = $('quizScore');
      if (el) { el.style.display = 'block'; el.textContent = `本次完成 ${done} 题，客观题答对 ${score} 题（简答题请对照解析自评）`; }
    }
  }

  /* ============ 事件绑定（全部挂 root，卸载时统一解绑） ============ */
  function bindEvents() {
    // 子导航
    bind($('hSubnav'), 'click', (e) => {
      const b = e.target.closest('.h-subtab'); if (!b) return;
      showView(b.dataset.view);
    });

    // 难度筛选
    bind($('hDiffbar'), 'click', (e) => {
      const b = e.target.closest('.h-chip'); if (!b) return;
      state.diff = b.dataset.diff;
      for (const c of root.querySelectorAll('.h-chip')) c.classList.toggle('active', c === b);
      renderRoute(); renderCards(); renderCompare();
    });

    // 题库：单元选择
    bind($('quizScopes'), 'click', (e) => {
      const b = e.target.closest('.h-scope'); if (!b) return;
      state.scope = b.dataset.scope; state.answers = {};
      renderQuizScopes(); $('quizArea').innerHTML = '';
    });

    // 题库：开始答题
    bind($('quizStart'), 'click', () => {
      const qs = state.quiz.filter((q) => state.scope === 'all' || q.scope_id === state.scope);
      if (!qs.length) { $('quizArea').innerHTML = '<p style="color:var(--ink3);text-align:center;padding:24px">该单元暂无题目</p>'; return; }
      state.answers = {};
      $('quizArea').innerHTML = qs.map((q, i) => renderQ(q, i)).join('') +
        `<p class="h-quiz-score" id="quizScore" style="display:none"></p>`;
    });

    // 全局委托（限 root 内）
    bind(root, 'click', (e) => {
      const bk = e.target.closest('[data-open-book]');
      if (bk) { openBook(bk.dataset.openBook); return; }
      const ch = e.target.closest('[data-open-ch]');
      if (ch && !ch.disabled) { openChapter(ch.dataset.openCh); return; }
      const nav = e.target.closest('[data-nav]');
      if (nav) { showView(nav.dataset.nav); return; }
      const open = e.target.closest('[data-open-card]');
      if (open) { openCard(open.dataset.openCard); return; }
      const jump = e.target.closest('[data-open-cards]');
      if (jump) { const t = root.querySelector('.h-subtab[data-view="cards"]'); if (t) t.click(); return; }
      if (e.target.closest('#hMask')) { $('hModal').hidden = true; return; }

      // 选项选中
      const opt = e.target.closest('.h-q-opt');
      if (opt && !opt.disabled && opt.tagName === 'BUTTON') {
        const q = state.quiz.find((x) => x.id === opt.dataset.q); if (!q) return;
        if (q.type === 'multi') { opt.classList.toggle('sel'); return; }
        const box = opt.closest('.h-q-opts');
        for (const o of box.querySelectorAll('.h-q-opt')) o.classList.remove('sel');
        opt.classList.add('sel');
        return;
      }

      // 提交本题
      const btn = e.target.closest('.h-q-submit');
      if (btn) {
        const q = state.quiz.find((x) => x.id === btn.dataset.submit); if (!q) return;
        const card = btn.closest('.h-q');
        let picked = [];
        if (q.type === 'short') {
          const ta = card.querySelector('[data-short]');
          picked = ta.value.trim() ? ['answered'] : [];
        } else {
          for (const o of card.querySelectorAll('.h-q-opt.sel')) picked.push(+o.dataset.o);
          if (q.type === 'judge') picked = picked.length ? [picked[0] === 0] : [];
        }
        if (!picked.length) { alert('请先作答'); return; }

        const exp = $('exp-' + q.id);
        let ok;
        if (q.type === 'short') {
          ok = null;
        } else {
          ok = q.answer.length === picked.length && q.answer.every((a) => picked.includes(a));
          for (const o of card.querySelectorAll('.h-q-opt')) {
            o.disabled = true; o.classList.remove('sel');
            const oi = +(o.dataset.o || 0);
            if (q.type === 'judge') {
              const isTrue = oi === 0;
              if (q.answer[0] === isTrue) o.classList.add('right');
              else if (picked[0] === isTrue) o.classList.add('wrong');
            } else {
              if (q.answer.includes(oi)) o.classList.add('right');
              else if (picked.includes(oi)) o.classList.add('wrong');
            }
          }
        }
        exp.innerHTML = `<b>${ok === null ? '参考答案' : ok ? '回答正确 ✓' : '回答错误 ✗'}</b>　${q.explanation}`;
        exp.classList.add('show');
        btn.disabled = true; btn.textContent = '已提交';
        checkAllDone();
      }
    });
  }

  /* ============ 对外接口 ============ */
  const HISTORY_MODULE = {
    /** 挂载到 el（el 应为可滚动容器） */
    async mount(el) {
      if (root) this.unmount();
      root = el;
      state = {
        books: [], route: [], cards: [], compare: [], quiz: [], quizScopes: [],
        diff: 'all', scope: 'all',
        curBook: null, curCatalog: null, curChapter: null, answers: {}
      };
      detachFns = [];
      root.classList.add('hpage');
      root.innerHTML = skeleton();
      bindEvents();
      await init();
    },
    /** 卸载：解绑事件、清空容器状态 */
    unmount() {
      for (const fn of detachFns) { try { fn(); } catch (e) {} }
      detachFns = [];
      root = null;
      state = null;
    },
    get mounted() { return !!root; }
  };

  window.HISTORY_MODULE = HISTORY_MODULE;

  /* 独立整页 history.html 的自举：页面里有 .hpage 宿主就直接挂载 */
  document.addEventListener('DOMContentLoaded', () => {
    const host = document.getElementById('hpageHost');
    if (host) HISTORY_MODULE.mount(host);
  });
})();
