/* ============================================================
   轻量对战 · 2v2 龙虎斗 —— 真实引擎版
   - 军争 160 张牌堆（逐张清单，与 battle/src/deck160.ts 同源）
   - 回合：判定→摸牌→出牌→弃牌→结束；响应/无懈/濒死/死亡/胜利
   - 武将来自 data/sgsol/characters.json（694 位：真名/势力/体力/技能/台词）
   - 27 位经典武将技能真实现（HERO_IMPL 白名单），其余武将可玩但技能标「未实装」
   - 原则：零依赖、与主 app 隔离、动效 ≤150ms、纯色卡+emoji、零立绘皮肤
   ============================================================ */
(function () {
  'use strict';

  /* ================= 工具 ================= */
  var $ = function (id) { return document.getElementById(id); };
  var sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
  var rnd = function (n) { return Math.floor(Math.random() * n); };
  var pick = function (a) { return a[rnd(a.length)]; };
  function shuffle(a) { a = a.slice(); for (var i = a.length - 1; i > 0; i--) { var j = rnd(i + 1), t = a[i]; a[i] = a[j]; a[j] = t; } return a; }
  var SUITS = { '♠': 0, '♥': 1, '♦': 2, '♣': 3 };
  var PT = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
  function ptStr(n) { return PT[n - 1] || String(n); }
  function isRed(c) { return c.suit === '♥' || c.suit === '♦'; }
  function isBlack(c) { return c.suit === '♠' || c.suit === '♣'; }
  function corner(c) { return c.suit + ptStr(c.point); }

  var KCOLOR = { wei: '#5b7fbe', shu: '#d9604f', wu: '#4aa56b', qun: '#8d9298', god: '#b8912f' };
  var KNAME = { wei: '魏', shu: '蜀', wu: '吴', qun: '群', god: '神' };

  /* ================= 军争 160 牌堆 ================= */
  /* [名, 规则键, 花色, 点数数组, 类别, 子类, 元素, 槽位, 射程] */
  var DEFS = [
    ['杀', 'sha', '♣', ['2','3','4','5','6','7','8','8','9','9','10','10','J','J'], 'b', 'n'],
    ['杀', 'sha', '♠', ['7','8','8','9','9','10','10'], 'b', 'n'],
    ['杀', 'sha', '♥', ['10','10','J'], 'b', 'n'],
    ['杀', 'sha', '♦', ['6','7','8','9','10','K'], 'b', 'n'],
    ['火杀', 'sha', '♥', ['4','7','10'], 'b', 'n', 'fire'],
    ['火杀', 'sha', '♦', ['4','5'], 'b', 'n', 'fire'],
    ['雷杀', 'sha', '♠', ['4','5','6','7','8'], 'b', 'n', 'thunder'],
    ['雷杀', 'sha', '♣', ['5','6','7','8'], 'b', 'n', 'thunder'],
    ['闪', 'shan', '♦', ['2','2','3','4','5','6','6','7','7','8','8','9','10','10','J','J','J'], 'b'],
    ['闪', 'shan', '♥', ['2','2','8','9','J','Q','K'], 'b'],
    ['桃', 'tao', '♦', ['2','3','Q'], 'b'],
    ['桃', 'tao', '♥', ['3','4','5','6','6','7','8','9','Q'], 'b'],
    ['酒', 'jiu', '♠', ['3','9'], 'b'],
    ['酒', 'jiu', '♣', ['3','9'], 'b'],
    ['酒', 'jiu', '♦', ['9'], 'b'],
    ['南蛮入侵', 'nanzheng', '♠', ['7','K'], 's'],
    ['南蛮入侵', 'nanzheng', '♣', ['7'], 's'],
    ['万箭齐发', 'wanjian', '♥', ['A'], 's'],
    ['桃园结义', 'taoyuan', '♥', ['A'], 's'],
    ['五谷丰登', 'wugu', '♥', ['3','4'], 's'],
    ['无懈可击', 'wuxie', '♠', ['J','K'], 's'],
    ['无懈可击', 'wuxie', '♣', ['Q','K'], 's'],
    ['无懈可击', 'wuxie', '♦', ['Q'], 's'],
    ['无懈可击', 'wuxie', '♥', ['A','K'], 's'],
    ['顺手牵羊', 'shunshou', '♠', ['3','4','J'], 's'],
    ['顺手牵羊', 'shunshou', '♦', ['3','4'], 's'],
    ['过河拆桥', 'guohe', '♠', ['3','4','Q'], 's'],
    ['过河拆桥', 'guohe', '♣', ['3','4'], 's'],
    ['过河拆桥', 'guohe', '♥', ['Q'], 's'],
    ['借刀杀人', 'jiedao', '♣', ['Q','K'], 's'],
    ['无中生有', 'wuzhong', '♥', ['7','8','9','J'], 's'],
    ['铁索连环', 'tieso', '♠', ['J','Q'], 's'],
    ['铁索连环', 'tieso', '♣', ['10','J','Q','K'], 's'],
    ['火攻', 'huogong', '♥', ['2','3'], 's'],
    ['火攻', 'huogong', '♦', ['Q'], 's'],
    ['决斗', 'juedou', '♠', ['A'], 's'],
    ['决斗', 'juedou', '♣', ['A'], 's'],
    ['决斗', 'juedou', '♦', ['A'], 's'],
    ['乐不思蜀', 'lebu', '♠', ['6'], 's', 'delay'],
    ['乐不思蜀', 'lebu', '♣', ['6'], 's', 'delay'],
    ['乐不思蜀', 'lebu', '♥', ['6'], 's', 'delay'],
    ['兵粮寸断', 'bingliang', '♠', ['10'], 's', 'delay'],
    ['兵粮寸断', 'bingliang', '♣', ['4'], 's', 'delay'],
    ['闪电', 'shandian', '♠', ['A'], 's', 'delay'],
    ['闪电', 'shandian', '♥', ['Q'], 's', 'delay'],
  ];
  var WEAPONS = [
    ['诸葛连弩', 'liannu', '♣', 'A', 1], ['诸葛连弩', 'liannu', '♦', 'A', 1],
    ['雌雄双股剑', 'cixiong', '♠', '2', 2], ['青釭剑', 'qinggang', '♠', '6', 2],
    ['青龙偃月刀', 'qinglong', '♠', '5', 3], ['丈八蛇矛', 'zhangba', '♠', 'Q', 3],
    ['贯石斧', 'guanshi', '♦', '5', 3], ['方天画戟', 'fangtian', '♦', 'Q', 4],
    ['麒麟弓', 'qilin', '♥', '5', 5], ['古锭刀', 'guding', '♠', 'A', 2],
    ['朱雀羽扇', 'zhuque', '♦', 'A', 4], ['寒冰剑', 'hanbing', '♠', '2', 2],
  ];
  var ARMORS = [
    ['八卦阵', 'bagua', '♠', '2'], ['八卦阵', 'bagua', '♣', '2'],
    ['藤甲', 'tengjia', '♠', '2'], ['藤甲', 'tengjia', '♣', '2'],
    ['仁王盾', 'renwang', '♣', '2'], ['白银狮子', 'baiyin', '♣', 'A'],
  ];
  var HORSES = [
    ['绝影', 'jueying', '♠', '5', 'horseP'], ['的卢', 'dilu', '♣', '5', 'horseP'],
    ['骅骝', 'hualiu', '♦', 'K', 'horseP'], ['爪黄飞电', 'zhaohuang', '♥', 'K', 'horseP'],
    ['大宛', 'dawan', '♠', 'K', 'horseM'], ['赤兔', 'chitu', '♥', '5', 'horseM'],
    ['紫骍', 'zixin', '♦', 'K', 'horseM'],
  ];
  var PSYM = { A: 1, J: 11, Q: 12, K: 13 };
  function buildDeck() {
    var cards = [], i = 0;
    function add(name, label, suit, p, kind, sub, element, slot, range) {
      cards.push({ uid: 'c' + (i++), name: name, label: label, suit: suit, point: p, kind: kind, sub: sub || null, element: element || null, slot: slot || null, range: range || 0 });
    }
    DEFS.forEach(function (d) {
      var sub = d[5] || (d[1] === 'sha' ? 'n' : null);
      d[3].forEach(function (sym) { add(d[1], d[0], d[2], PSYM[sym] || +sym, d[4] === 'b' ? 'basic' : 'scroll', sub, d[6], null, 0); });
    });
    WEAPONS.forEach(function (w) { add(w[1], w[0], w[2], PSYM[w[3]] || +w[3], 'equip', 'weapon', null, 'weapon', w[4]); });
    ARMORS.forEach(function (w) { add(w[1], w[0], w[2], PSYM[w[3]] || +w[3], 'equip', 'armor', null, 'armor', 0); });
    HORSES.forEach(function (w) { add(w[1], w[0], w[2], PSYM[w[3]] || +w[3], 'equip', w[4], null, w[4], 0); });
    if (cards.length !== 160) throw new Error('军争牌堆应为 160 张，实际 ' + cards.length);
    return cards;
  }

  /* ================= 武将数据 + 技能实装 ================= */
  var HERO_IMPL = {
    '张飞': ['咆哮'], '关羽': ['武圣'], '赵云': ['龙胆'], '马超': ['铁骑'],
    '甘宁': ['奇袭'], '吕蒙': ['克己'], '黄忠': ['烈弓'], '周瑜': ['英姿'],
    '陆逊': ['谦逊', '连营'], '孙权': ['制衡'], '孙尚香': ['枭姬'],
    '大乔': ['国色', '流离'], '吕布': ['无双'], '貂蝉': ['离间', '闭月'],
    '华佗': ['急救', '青囊'], '曹操': ['奸雄'], '司马懿': ['反馈', '鬼才'],
    '夏侯惇': ['刚烈'], '张辽': ['突袭'], '许褚': ['裸衣'], '郭嘉': ['天妒', '遗计'],
    '甄姬': ['洛神', '倾国'], '刘备': ['仁德'], '诸葛亮': ['空城'],
    '黄盖': ['苦肉'], '曹仁': ['据守'], '孟获': ['巨象'],
  };
  var ALLY_NAMES = Object.keys(HERO_IMPL);
  var dataCache = null;
  async function loadHeroes() {
    if (dataCache) return dataCache;
    var r = await fetch('data/sgsol/characters.json');
    var d = await r.json();
    var gs = d.generals, byName = {};
    Object.keys(gs).forEach(function (k) {
      var g = gs[k];
      if (!g || !g.n || !g.s || !g.s.length) return;
      if (g.p === 'shen' || g.p === 'mo') return;            // 神/魔不进池
      if (!byName[g.n]) byName[g.n] = [];
      byName[g.n].push(g);
    });
    var all = [], dedup = [];
    Object.keys(gs).forEach(function (k) {
      var g = gs[k];
      if (!g || !g.n || !g.s || !g.s.length || g.p === 'shen' || g.p === 'mo') return;
      all.push(g);
    });
    // 同名去重（优先标准包）
    Object.keys(byName).forEach(function (n) {
      var list = byName[n].slice().sort(function (a, b) { return (a.p === 'std' ? -1 : 0) - (b.p === 'std' ? -1 : 0); });
      dedup.push(list[0]);
    });
    dataCache = { all: all, dedup: dedup };
    /* 武将头像：一律用 characters.json 自带的 av（= 英雄图鉴同款，已逐张核实）
       ⚠️ 不再接入 wxres/portrait_map.json：该映射是手搓的派生表，实测 张飞↔曹操、
       赵云↔貂蝉(100501) 等多条错配，且无生成脚本可追溯，227 条无法逐条核对。
       2026-09-28 决定：宁可少一层「官方大图」，也不要货不对板。 */
    return dataCache;
  }
  function heroImpl(g) { return HERO_IMPL[g.n] || null; }   // null=技能未实装
  function heroHp(g) { return Math.max(2, Math.min(6, g.hp || 3)); }

  /* ================= 全局状态 ================= */
  var G = null;            // 当前对局
  var TOKEN = 0;           // 防止旧局异步污染
  var UI = { sel: [], tgt: [], mode: 'idle', resolve: null, host: false, phase: 'idle' };

  function newPlayer(seat, team, hero, isHuman, impl) {
    return {
      seat: seat, team: team, hero: hero, impl: impl, isHuman: isHuman,
      name: hero.n, k: hero.k, maxHp: heroHp(hero), hp: heroHp(hero),
      hand: [], equips: { weapon: null, armor: null, horseP: null, horseM: null },
      judges: [], alive: true, flipped: false, chained: false,
      shaUsed: 0, drunk: 0, naked: false, keshou: true, defending: false,
      skills: impl || [], dead: false,
    };
  }

  function dist(a, b) { var d = Math.abs(a.seat - b.seat); return Math.min(d, 4 - d); }
  function distTo(a, b) { var d = dist(a, b); if (a.equips.horseM) d -= 1; if (b.equips.horseP) d += 1; return Math.max(0, d); }
  function rangeOf(p) { return 1 + (p.equips.weapon ? p.equips.weapon.range : 0); }
  function inRange(a, b) { return distTo(a, b) <= rangeOf(a); }
  function alive() { return G.players.filter(function (p) { return p.alive; }); }
  function enemiesOf(p) { return G.players.filter(function (q) { return q.alive && q.team !== p.team; }); }
  function matesOf(p) { return G.players.filter(function (q) { return q.alive && q !== p && q.team === p.team; }); }
  function has(p, s) { return p.impl && p.impl.indexOf(s) >= 0 && p.alive; }
  function allHand(p) { return p.hand; }
  function cardName(c) { return c.label; }

  /* ================= 日志 / 提示 ================= */
  var logH = 0;
  function say(msg, cls) {
    var box = $('btlLog');
    var d = document.createElement('div');
    d.textContent = msg;
    if (cls) d.className = cls;
    box.appendChild(d);
    while (box.children.length > 6) box.firstChild.remove();
  }
  function quote(p, skill) {
    if (!p.hero.q) return null;
    var q = p.hero.q[skill] || (skill === '阵亡' ? p.hero.q['阵亡'] : null);
    if (!q) return null;
    var arr = String(q).split('/');
    return p.name + '：「' + pick(arr).trim() + '」';
  }
  function sayQuote(p, skill) { var t = quote(p, skill); if (t) say(t, 'bq'); }
  var toastH = 0;
  function toast(msg) {
    var t = $('btlToast');
    t.textContent = msg;
    t.classList.add('b-show');
    clearTimeout(toastH);
    toastH = setTimeout(function () { t.classList.remove('b-show'); }, 1500);
  }

  /* ================= 弹层（响应 / 多选一） ================= */
  function askBox(title, btns) {
    return new Promise(function (res) {
      var wrap = $('btlAsk'), t = $('btlAskT'), bs = $('btlAskBtns');
      t.textContent = title;
      bs.innerHTML = '';
      btns.forEach(function (b) {
        var el = document.createElement('button');
        el.type = 'button';
        el.className = b.cls || 'ano';
        el.textContent = b.t;
        el.onclick = function () { wrap.hidden = true; res(b.v); };
        bs.appendChild(el);
      });
      wrap.hidden = false;
    });
  }
  function askCards(title, cards) {          // 从亮出的牌里挑一张（五谷等）
    return new Promise(function (res) {
      var wrap = $('btlAsk'), t = $('btlAskT'), bs = $('btlAskBtns');
      t.textContent = title;
      bs.innerHTML = '';
      cards.forEach(function (c) {
        var el = document.createElement('button');
        el.type = 'button';
        el.className = 'ayes';
        el.textContent = c.label + ' ' + corner(c);
        el.onclick = function () { wrap.hidden = true; res(c); };
        bs.appendChild(el);
      });
      var no = document.createElement('button');
      no.type = 'button'; no.className = 'ano'; no.textContent = '随便拿一张';
      no.onclick = function () { wrap.hidden = true; res(null); };
      bs.appendChild(no);
      wrap.hidden = false;
    });
  }

  /* ================= 牌堆 / 摸牌 / 弃牌 ================= */
  function drawOne() {
    if (!G.deck.length) {
      if (!G.pile.length) throw new Error('牌堆与弃牌堆双空');
      G.deck = shuffle(G.pile);
      G.pile = [];
      say('🂠 牌堆洗回了 160 张');
    }
    return G.deck.pop();
  }
  function draw(p, n) { for (var i = 0; i < n; i++) { var c = drawOne(); if (!c) continue; p.hand.push(c); if (p.isHuman) say('你摸到 ' + c.label + ' ' + corner(c)); } }
  // 防御：任何路径混进来的空牌位统一清掉，避免排序/筛选时炸
  function sanitize() { G.players.forEach(function (p) { if (p.hand.indexOf(null) >= 0 || p.hand.indexOf(undefined) >= 0) p.hand = p.hand.filter(Boolean); }); }
  function toPile(cards) { cards.forEach(function (c) { G.pile.push(c); }); }
  function loseCard(p, c) {
    var i = p.hand.indexOf(c);
    if (i >= 0) p.hand.splice(i, 1);
    toPile([c]);
    if (has(p, '连营') && p.hand.length === 0) { draw(p, 1); say(p.name + ' 连营：拿回了 1 张牌'); }
  }
  function randHand(p) { return p.hand.length ? p.hand[rnd(p.hand.length)] : null; }

  /* ================= 装备 ================= */
  function equip(p, c) {
    var old = p.equips[c.slot];
    p.equips[c.slot] = c;
    if (old) { toPile([old]); if (has(p, '枭姬')) { draw(p, 2); sayQuote(p, '枭姬'); say(p.name + ' 枭姬：换装摸 2 张'); } }
    say(p.name + ' 装备了 ' + c.label);
  }
  function stealEquip(p, slot) {
    var c = p.equips[slot];
    if (!c) return null;
    p.equips[slot] = null;
    if (has(p, '枭姬')) { draw(p, 2); say(p.name + ' 枭姬：失去装备摸 2 张'); }
    return c;
  }

  /* ================= 判定 ================= */
  function ghostBest(q, why) {
    var ok;
    if (why === '乐不思蜀' || why === '兵粮寸断') ok = isRed;      // 都想改判成红（红→乐/兵失效）
    else if (why === '闪电') ok = function (c) { return c.suit !== '♠'; };
    else if (why === '八卦阵') ok = isRed;
    else return null;
    var cands = q.hand.filter(ok);
    return cands.length ? cands[0] : null;
  }
  function ghostWantChange(cur, why) {
    // 当前判定是否"不利"，需要改
    if (why === '乐不思蜀') return !isRed(cur);   // 判红才生效，非红=生效中？否：非红→不生效。想避免生效→希望改判红
    if (why === '兵粮寸断') return isBlack(cur);  // 判黑生效
    if (why === '闪电') return cur.suit === '♠';
    if (why === '八卦阵') return !isRed(cur);
    return false;
  }
  async function judge(p, why) {
    var c = drawOne();
    say(p.name + ' 判定（' + why + '）：' + c.label + ' ' + corner(c));
    renderAll();
    // 鬼才：可改判（每名鬼才角色一次，这里取第一个想改的）
    for (var i = 0; i < alive().length && !G.over; i++) {
      var q = alive()[i];
      if (!has(q, '鬼才') || q.hand.length === 0) continue;
      if (!ghostWantChange(c, why)) continue;
      var best = ghostBest(q, why);
      if (!best) continue;
      if (q.isHuman && !UI.host) {
        var v = await askBox('鬼才：用【' + best.label + ' ' + corner(best) + '】替换判定吗？', [{ t: '🔮 改判', v: true, cls: 'ayes' }, { t: '不改', v: false }]);
        if (!v) continue;
      }
      loseCard(q, best); toPile([c]); c = best;
      sayQuote(q, '鬼才');
      say(q.name + ' 鬼才改判：' + c.label + ' ' + corner(c));
      break;
    }
    // 天妒：判定者收走判定牌
    if (has(p, '天妒')) {
      p.hand.push(c);
      say(p.name + ' 天妒：收走判定牌');
    } else {
      toPile([c]);
    }
    renderAll();
    return c;
  }

  /* ================= 伤害 / 濒死 / 死亡 ================= */
  async function damage(src, tgt, n, opts) {
    opts = opts || {};
    if (!tgt.alive || G.over) return;
    // 藤甲：火焰伤害+1（普通杀已在出牌时挡下）
    if (tgt.equips.armor && tgt.equips.armor.name === 'tengjia' && opts.element === 'fire') n += 1;
    tgt.hp -= n;
    var how = opts.card ? '【' + opts.card.label + '】' : '';
    say((src ? src.name : '?') + ' 对 ' + tgt.name + ' 造成 ' + n + ' 点伤害' + (opts.element === 'fire' ? ' 🔥' : opts.element === 'thunder' ? ' ⚡' : ''));
    renderAll();
    // 反馈 / 奸雄 / 刚烈 / 遗计
    if (tgt.hp > 0) {
      if (has(tgt, '反馈') && src && (src.hand.length || hasEquip(src))) {
        var got = src.hand.length ? (function () { var c = randHand(src); src.hand.splice(src.hand.indexOf(c), 1); tgt.hand.push(c); return c; })() : null;
        sayQuote(tgt, '反馈');
        say(tgt.name + ' 反馈：从 ' + src.name + ' 处拿走 1 张牌');
      }
      if (has(tgt, '遗计')) { draw(tgt, 2); sayQuote(tgt, '遗计'); say(tgt.name + ' 遗计：摸 2 张'); }
      if (has(tgt, '奸雄') && opts.card) {
        tgt.hand.push(opts.card);
        var ix = G.pile.indexOf(opts.card); if (ix >= 0) G.pile.splice(ix, 1);
        sayQuote(tgt, '奸雄');
        say(tgt.name + ' 奸雄：拿走造成伤害的 ' + opts.card.label);
      }
      if (has(tgt, '刚烈') && src && src.alive) {
        sayQuote(tgt, '刚烈');
        var jc = await judge(tgt, '刚烈');
        if (isRed(jc)) {
          if (src.hand.length && (!src.isHuman || UI.host)) { var d = randHand(src); loseCard(src, d); say(src.name + ' 弃 1 张手牌响应刚烈'); }
          else if (src.isHuman && !UI.host && src.hand.length) {
            var v = await askBox('刚烈：' + tgt.name + ' 判定红色，你弃 1 张手牌，否则受 1 点伤害', [{ t: '弃牌', v: true, cls: 'ayes' }, { t: '掉血', v: false }]);
            if (v) { loseCard(src, src.hand[0]); say(src.name + ' 弃牌响应刚烈'); }
            else await damage(tgt, src, 1, {});
          } else {
            await damage(tgt, src, 1, {});
          }
        }
      }
      // 白银狮子
      if (tgt.equips.armor && tgt.equips.armor.name === 'baiyin' && tgt.hp > 0) { tgt.hp = Math.min(tgt.maxHp, tgt.hp + 1); say(tgt.name + ' 白银狮子：回复 1 点体力'); }
      // 铁索连环：属性伤害传导
      if (opts.element && tgt.chained) {
        tgt.chained = false;
        var chain = G.players.filter(function (q) { return q.alive && q !== tgt && q.chained; });
        for (var k = 0; k < chain.length; k++) { chain[k].chained = false; say('铁索传导 → ' + chain[k].name); await damage(src, chain[k], n, { element: opts.element }); }
      }
    }
    renderAll();
    if (tgt.hp <= 0) await dying(tgt, src);
    checkWin();
  }

  async function dying(tgt, src) {
    say('💀 ' + tgt.name + ' 濒死！求【桃】…');
    var order = [tgt].concat(alive().filter(function (q) { return q !== tgt; }));
    for (var i = 0; i < order.length && tgt.hp <= 0; i++) {
      var q = order[i];
      if (!q.alive) continue;
      var saveMate = (q.team === tgt.team);
      if (q.isHuman && !UI.host) {
        while (tgt.hp <= 0) {
          var t = findTao(q);
          if (!t) { await askBox(q === tgt ? '你没有能用的【桃】…' : '想救但没有【桃】', [{ t: '好吧', v: false }]); break; }
          var v = await askBox((q === tgt ? '你要死了！出【桃】自救吗？' : '救 ' + tgt.name + ' 吗？') + (t.conv ? '（' + t.conv + '：红色牌当桃）' : ''),
            [{ t: '🍑 出桃', v: true, cls: 'ayes' }, { t: '不救', v: false }]);
          if (!v) break;
          t = findTao(q);
          if (!t) break;
          loseCard(q, t.real);
          if (t.conv) sayQuote(q, t.conv);
          tgt.hp += 1;
          say(q.name + ' 出【' + (t.conv ? t.conv : '桃') + '】，' + tgt.name + ' 回到 ' + tgt.hp + ' 体力');
          renderAll();
        }
      } else if (saveMate || q === tgt) {
        while (tgt.hp <= 0) {
          var t2 = findTao(q);
          if (!t2) break;
          loseCard(q, t2.real);
          tgt.hp += 1;
          say(q.name + ' 吃【桃】救了 ' + tgt.name);
          renderAll();
          await sleep(500);
        }
      }
    }
    if (tgt.hp <= 0) await dead(tgt, src);
  }
  function findTao(p) {
    var t = p.hand.filter(function (c) { return c.name === 'tao'; });
    if (t.length) return { real: t[0], view: t[0], conv: null };
    if (has(p, '急救')) {
      var r = p.hand.filter(function (c) { return isRed(c); });
      if (r.length) return { real: r[0], view: Object.assign({}, r[0], { label: '桃', name: 'tao', kind: 'basic' }), conv: '急救' };
    }
    return null;
  }

  async function dead(p, killer) {
    p.alive = false; p.dead = true;
    toPile(p.hand); p.hand = [];
    ['weapon', 'armor', 'horseP', 'horseM'].forEach(function (s) { if (p.equips[s]) toPile([p.equips[s]]); p.equips[s] = null; });
    p.judges.forEach(function (c) { toPile([c]); }); p.judges = [];
    sayQuote(p, '阵亡');
    say('☠️ ' + p.name + ' 阵亡');
    if (killer && killer.alive && killer.team !== p.team) { draw(killer, 3); say(killer.name + ' 击杀奖励：摸 3 张'); }
    renderAll();
    await sleep(700);
  }

  function checkWin() {
    if (G.over) return;
    var dg = G.players.filter(function (p) { return p.team === 'dragon' && p.alive; }).length;
    var tg = G.players.filter(function (p) { return p.team === 'tiger' && p.alive; }).length;
    if (dg === 0 || tg === 0) {
      G.over = true;
      var win = dg > 0 ? 'dragon' : 'tiger';
      showOver(win);
    }
  }
  function showOver(winTeam) {
    var meWin = G.me && G.me.team === winTeam;
    $('btlOverT').textContent = meWin ? '🏆 龙队胜 · 你赢了！' : (winTeam === 'dragon' ? '🏆 龙队胜' : '🏆 虎队胜');
    $('btlOverT').style.color = meWin ? '#c56a1e' : '#2b2f2a';
    $('btlOverSub').textContent = meWin
      ? '「' + G.me.name + '」带队赢下第 ' + G.round + ' 轮。' + (G.me.alive ? '你还站着呢。' : '虽然你倒下了，队友carry住了。')
      : '第 ' + G.round + ' 轮惜败，换个武将再来！';
    $('btlOver').hidden = false;
    renderAll();
  }

  /* ================= 无懈可击 ================= */
  async function askWuxie(user, trick, targets) {
    for (var i = 0; i < alive().length; i++) {
      var q = alive()[i];
      var wx = q.hand.filter(function (c) { return c.name === 'wuxie'; });
      if (!wx.length) continue;
      var protect = targets.some(function (t) { return t.team === q.team; });
      var selfT = targets.indexOf(q) >= 0;
      if (!protect && !selfT) continue;
      if (q.isHuman && !UI.host) {
        var v = await askBox('【' + trick + '】目标含' + (selfT && targets.length === 1 ? '你' : '你方') + '，要出【无懈可击】抵消吗？', [{ t: '🛡️ 抵消', v: true, cls: 'ayes' }, { t: '算了', v: false }]);
        if (v) { loseCard(q, wx[0]); say(q.name + ' 打出【无懈可击】！【' + trick + '】被抵消'); return true; }
      } else if (Math.random() < (trick === '乐不思蜀' ? 0.7 : 0.45)) {
        loseCard(q, wx[0]); say(q.name + ' 打出【无懈可击】，【' + trick + '】被抵消'); await sleep(600); return true;
      }
    }
    return false;
  }

  /* ================= 闪 / 杀响应 ================= */
  function dodgeCandidates(p) {
    var list = p.hand.filter(function (c) { return c.name === 'shan'; }).map(function (c) { return { real: c, view: c }; });
    if (has(p, '龙胆')) p.hand.filter(function (c) { return c.name === 'sha'; }).slice(0, 1).forEach(function (c) { list.push({ real: c, view: Object.assign({}, c, { label: '闪', name: 'shan', _bySkill: '龙胆' }) }); });
    if (has(p, '倾国')) p.hand.filter(function (c) { return c.kind === 'equip' && isBlack(c); }).slice(0, 1).forEach(function (c) { list.push({ real: c, view: Object.assign({}, c, { label: '闪', name: 'shan', _bySkill: '倾国' }) }); });
    return list;
  }
  async function askDodge(p, via) {
    if (!p.alive) return false;
    // 八卦阵：先判定
    if (p.equips.armor && p.equips.armor.name === 'bagua') {
      var jc = await judge(p, '八卦阵');
      if (isRed(jc)) { say(p.name + ' 八卦阵生效，视为闪避！'); return true; }
    }
    var cands = dodgeCandidates(p);
    if (!cands.length) return false;
    if (p.isHuman && !UI.host) {
      var v = await askBox(via + '！要出【闪】吗？（手上有 ' + cands.length + ' 种打法）', [{ t: '🌀 闪！', v: true, cls: 'ayes' }, { t: '硬吃', v: false }]);
      if (!v) return false;
    } else {
      if (!(p.hp <= 2 ? true : Math.random() < 0.85)) return false;
      await sleep(300);
    }
    var c = cands[0];
    loseCard(p, c.real);
    if (c.view._bySkill) sayQuote(p, c.view._bySkill);
    say(p.name + ' 打出【闪】');
    showStage([c.view]);
    return true;
  }

  function shaCandidates(p) {   // 出杀（含武圣转化），用于决斗/南蛮响应
    var list = p.hand.filter(function (c) { return c.name === 'sha'; });
    if (has(p, '武圣')) list = list.concat(p.hand.filter(function (c) { return isRed(c) && c.name !== 'sha'; }));
    if (has(p, '龙胆')) list = list.concat(p.hand.filter(function (c) { return c.name === 'shan'; }));
    return list;
  }
  async function askSha(p, via) {
    if (!p.alive) return false;
    var cands = shaCandidates(p);
    if (!cands.length) return false;
    if (p.isHuman && !UI.host) {
      var v = await askBox(via + '！要出【杀】吗？（有 ' + cands.length + ' 张可用' + (has(p, '武圣') || has(p, '龙胆') ? '，含技能转化' : '') + '）', [{ t: '⚔️ 出杀', v: true, cls: 'ayes' }, { t: '认输', v: false }]);
      if (!v) return false;
    } else { await sleep(300); }
    var c = cands[0];
    loseCard(p, c);
    say(p.name + ' 打出【杀】');
    showStage([c]);
    return true;
  }

  /* ================= 出牌桌面展示 ================= */
  function showStage(cards, note) {
    var s = $('btlStage');
    s.innerHTML = cards.map(function (c) {
      return '<div class="bcard bmini k-' + kcls(c) + '"><span class="bic">' + cic(c) + '</span><span class="bnm2">' + c.label + '</span></div>';
    }).join('') + (note ? '<div class="bnote">' + note + '</div>' : '');
    clearTimeout(showStage._h);
    showStage._h = setTimeout(function () { s.innerHTML = ''; }, 1600);
  }
  function kcls(c) {
    if (c.kind === 'equip') return 'equip';
    if (c.kind === 'scroll') return 'trick';
    return { sha: 'sha', shan: 'shan', tao: 'tao', jiu: 'jiu' }[c.name] || 'trick';
  }
  function cic(c) {
    if (c.kind === 'equip') return c.slot === 'weapon' ? '🗡️' : c.slot === 'armor' ? '🛡️' : '🐴';
    if (c.name === 'sha') return c.element === 'fire' ? '🔥' : c.element === 'thunder' ? '⚡' : '⚔️';
    return { shan: '🌀', tao: '🍑', jiu: '🍶', wuxie: '🛡️', shunshou: '🐑', guohe: '🔨', wuzhong: '🎁', juedou: '🗡️', nanzheng: '🏹', wanjian: '🎯', taoyuan: '🏡', wugu: '🌾', lebu: '😄', bingliang: '🍜', shandian: '⚡', tieso: '⛓️', huogong: '🔥', jiedao: '🔪' }[c.name] || '🃏';
  }

  /* ================= 卡牌视图（转化技能） ================= */
  function views(p, c) {
    var vs = [Object.assign({}, c, { _real: c })];
    if (has(p, '武圣') && isRed(c) && c.name !== 'sha') vs.push(Object.assign({}, c, { label: '杀', name: 'sha', kind: 'basic', sub: 'n', element: null, _real: c, _bySkill: '武圣' }));
    if (has(p, '龙胆')) {
      if (c.name === 'sha') vs.push(Object.assign({}, c, { label: '闪', name: 'shan', kind: 'basic', sub: null, _real: c, _bySkill: '龙胆' }));
      if (c.name === 'shan') vs.push(Object.assign({}, c, { label: '杀', name: 'sha', kind: 'basic', sub: 'n', element: null, _real: c, _bySkill: '龙胆' }));
    }
    if (has(p, '奇袭') && isBlack(c) && c.name !== 'guohe') vs.push(Object.assign({}, c, { label: '过河拆桥', name: 'guohe', kind: 'scroll', sub: null, _real: c, _bySkill: '奇袭' }));
    if (has(p, '国色') && c.suit === '♦' && c.name !== 'lebu') vs.push(Object.assign({}, c, { label: '乐不思蜀', name: 'lebu', kind: 'scroll', sub: 'delay', _real: c, _bySkill: '国色' }));
    return vs;
  }

  /* ================= 出牌合法性 ================= */
  function judgeHas(t, name) { return t.judges.some(function (c) { return c.name === name; }); }
  function targetable(p, v) {
    var es = enemiesOf(p);
    var kongcheng = function (t) { return has(t, '空城') && t.hand.length === 0; };
    switch (v.name) {
      case 'sha': return es.filter(function (t) { return inRange(p, t) && !kongcheng(t); });
      case 'shunshou': return es.filter(function (t) { return distTo(p, t) <= 1 && (t.hand.length || Object.keys(t.equips).some(function (s) { return t.equips[s]; }) || t.judges.length) && !(has(t, '谦逊')); });
      case 'guohe': return G.players.filter(function (t) { return t.alive && t !== p && distTo(p, t) <= 1 && (t.hand.length || t.judges.length || Object.keys(t.equips).some(function (s) { return t.equips[s]; })); });
      case 'juedou': return es.filter(function (t) { return !kongcheng(t); });
      case 'huogong': return es.filter(function (t) { return t.hand.length > 0; });
      case 'jiedao': return es.filter(function (t) { return t.equips.weapon; });
      case 'lebu': return G.players.filter(function (t) { return t.alive && t !== p && distTo(p, t) <= 1 && !judgeHas(t, 'lebu') && !has(t, '谦逊'); });
      case 'bingliang': return es.filter(function (t) { return distTo(p, t) <= 1 && !judgeHas(t, 'bingliang'); });
      case 'shandian': return p.judges.some(function (c) { return c.name === 'shandian'; }) ? [] : [p];
      case 'tieso': return alive().filter(function (t) { return true; });
      default: return [];
    }
  }
  function playableViews(p) {
    p.hand = p.hand.filter(Boolean);
    var out = [];
    var shaOK = has(p, '咆哮') || p.equips.weapon && p.equips.weapon.name === 'liannu' || p.shaUsed < 1;
    p.hand.forEach(function (c) {
      views(p, c).forEach(function (v) {
        var ok = false, need = 0;
        if (v.kind === 'equip') { out.push({ card: c, view: v, need: 0 }); return; }
        switch (v.name) {
          case 'sha': ok = shaOK && targetable(p, v).length > 0; need = 1; break;
          case 'shan': ok = false; break;
          case 'tao': ok = p.hp < p.maxHp; break;
          case 'jiu': ok = p.drunk < 1; break;
          case 'wuzhong': case 'taoyuan': case 'wugu': ok = alive().length >= 1; break;
          case 'wanjian': case 'nanzheng': ok = alive().length >= 2; break;
          case 'wuxie': ok = false; break;
          case 'tieso': ok = alive().length >= 2; need = 2; break;
          case 'shandian': ok = !judgeHas(p, 'shandian'); need = 0; break;
          default: var ts = targetable(p, v); ok = ts.length > 0; need = 1;
        }
        if (ok) out.push({ card: c, view: v, need: need });
      });
    });
    return out;
  }

  /* ================= 技能按钮 ================= */
  function activeSkills(p) {
    var list = [];
    if (has(p, '制衡')) list.push({ s: '制衡', d: '弃任意手牌，摸同数量牌（每回合一次）' });
    if (has(p, '苦肉')) list.push({ s: '苦肉', d: '失去 1 点体力，摸 2 张牌' });
    if (has(p, '仁德')) list.push({ s: '仁德', d: '把至少 2 张手牌交给队友，你回复 1 点体力' });
    if (has(p, '青囊')) list.push({ s: '青囊', d: '弃 1 张手牌，一名角色回复 1 点体力' });
    if (has(p, '离间')) list.push({ s: '离间', d: '弃 1 张手牌，令两名敌武将决斗' });
    if (has(p, '裸衣')) list.push({ s: '裸衣', d: '摸牌阶段少摸 1 张，本回合杀与决斗伤害 +1' });
    if (has(p, '据守')) list.push({ s: '据守', d: '结束回合时翻面并摸 1 张；翻面时跳过回合' });
    return list;
  }

  /* ================= 渲染 ================= */
  function hpStr(p) { var s = ''; for (var i = 0; i < p.maxHp; i++) s += i < p.hp ? '♥' : '♡'; return s; }
  function avatarWrap(hero, cls) {
    var col = KCOLOR[hero.k] || KCOLOR.qun;
    var ch = (hero.n || '?').charAt(0);
    var img = hero.av ? '<img class="' + cls + '" src="' + hero.av + '" alt="" loading="lazy" onerror="this.remove()">' : '';
    return '<div class="bavwrap ' + (cls === 'bav' ? '' : cls) + '" style="background:' + col + '"><span>' + ch + '</span>' + img + '</div>';
  }
  function plateHtml(p, me) {
    var judgeBadges = p.judges.map(function (c) {
      return '<span class="vjudge-i" title="' + c.label + '">' + { lebu: '🎵', bingliang: '🍜', shandian: '⚡' }[c.name] + '</span>';
    }).join('');
    var tag = me ? '我' : (p.team === G.me.team ? '友' : '敌');
    var hpDots = '';
    for (var i = 0; i < p.maxHp; i++) hpDots += '<i class="' + (i < p.hp ? 'on' : '') + '"></i>';
    var eqs = [];
    if (p.equips.weapon) eqs.push('🗡' + p.equips.weapon.label);
    if (p.equips.armor) eqs.push('🛡' + p.equips.armor.label);
    if (p.equips.horseP) eqs.push('🐴+1');
    if (p.equips.horseM) eqs.push('🐎-1');
    var skl = p.impl ? p.impl.join('·') : '技能未实装';
    var dme = dist(G.me, p);
    var info = me
      ? '<span title="' + skl + '">' + skl + '</span>' + (p.chained ? ' ⛓️' : '') + (p.flipped ? ' 🔄' : '')
      : (p.seat + 1) + '号位·距离:' + dme + ' · <span title="' + skl + '">' + skl + '</span>' + (p.chained ? ' ⛓️' : '') + (p.flipped ? ' 🔄' : '');
    // 顶栏一栏：名字 + 体力点（原来名字是左侧 22px 竖条、血点压在立绘上，两者共吃掉 ~38% 立绘宽度）
    return '<div class="vtop">' +
        '<span class="vnm">' + p.name + '</span>' +
        '<span class="vhp">' + hpDots + '</span>' +
      '</div>' +
      // 立绘独立成区：1:1（源图 256x256 也是 1:1）→ 零裁剪、不再被任何东西遮挡
      '<div class="vface">' + avatarWrap(p.hero, 'vav') +
        '<span class="vtag ' + (tag === '敌' ? 'enemy' : tag === '友' ? 'ally' : 'me') + '">' + tag + '</span>' +
        '<span class="vhand">🃏' + p.hand.length + '</span>' +
        (judgeBadges ? '<span class="vjudge">' + judgeBadges + '</span>' : '') +
        (p.alive ? '' : '<div class="bstamp">阵亡</div>') +
        '<div class="vturn"></div>' +
      '</div>' +
      (me && eqs.length ? '<div class="vme-eq">' + eqs.map(function (e) { return '<span class="beq on">' + e + '</span>'; }).join('') + '</div>' : '') +
      '<div class="vinfo">' + info + '</div>';
  }
  function renderPlates() {
    if (!G) return;
    var seatR = G.players[(G.me.seat + 1) % 4];   // 下家敌人（右）
    var seatT = G.players[(G.me.seat + 3) % 4];   // 上家敌人（上）
    var seatL = G.players[(G.me.seat + 2) % 4];   // 队友（左）
    function mount(boxId, p, me) {
      var box = $(boxId);
      box.innerHTML = '';
      var el = document.createElement('div');
      el.className = 'bplate vplate' + (me ? ' vme' : '') + (p.alive ? '' : ' b-dead') + (G.turnP === p && p.alive ? ' b-active' : '');
      el.dataset.seat = p.seat;
      el.innerHTML = plateHtml(p, me);
      var inf = el.querySelector('.vinfo');
      if (inf) inf.title = p.hero.s.map(function (s) { return s.name + '：' + s.description; }).join('\n');
      if (!me) el.onclick = function () { plateClick(p); };
      box.appendChild(el);
    }
    mount('btlFoeR', seatR, false);
    mount('btlFoeT', seatT, false);
    mount('btlFoeL', seatL, false);
    mount('btlMe', G.me, true);
    $('btlDeck').textContent = '🂠 ' + G.deck.length + ' / 弃 ' + G.pile.length;
  }
  function renderHand() {
    var box = $('btlHand');
    box.innerHTML = '';
    if (!G) return;
    var myTurn = G.turnP === G.me && G.me.alive && !G.over;
    var play = myTurn && UI.phase === 'play';
    var pv = play ? playableViews(G.me) : [];
    G.me.hand.forEach(function (c) {
      var el = document.createElement('div');
      // 该手牌的可出视图（取第一个可出的；原生优先）
      var usable = pv.filter(function (x) { return x.card === c; });
      var v0 = usable.length ? usable[0].view : null;
      var disp = v0 || { label: c.label, suit: c.suit, point: c.point, kind: c.kind, name: c.name, element: c.element, slot: c.slot, _real: c };
      el.className = 'bcard vbcard k-' + kcls(disp) + (isRed(disp) ? ' c-red' : '') + (UI.sel.indexOf(c) >= 0 ? ' b-sel' : '');
      el.innerHTML = '<span class="vcorner">' + corner(c) + '</span><span class="vname2">' + disp.label + '</span><span class="vic">' + cic(disp) + '</span>' +
        (disp._bySkill ? '<span class="bconv">' + disp._bySkill + '→' + disp.label + '</span>' : '');
      el.onclick = function () { handClick(c); };
      box.appendChild(el);
    });
  }
  function renderSkills() {
    var list = G ? activeSkills(G.me) : [];
    ['btlSk0', 'btlSk1'].forEach(function (id, i) {
      var b = $(id);
      if (list[i]) { b.hidden = false; b.innerHTML = list[i].s + '<small>点我发动</small>'; b.dataset.sk = list[i].s; b.dataset.d = list[i].d; }
      else { b.hidden = true; b.dataset.sk = ''; }
    });
  }
  function renderTargets() {
    var others = G.players.filter(function (p) { return p !== G.me; });
    others.forEach(function (p) {
      var el = document.querySelector('.bplate[data-seat="' + p.seat + '"]');
      if (!el) return;
      var ok = UI.tgt.indexOf(p) >= 0;
      var cand = UI.tgtCands && UI.tgtCands.indexOf(p) >= 0;
      el.classList.toggle('b-targetable', !!cand);
      el.classList.toggle('b-dim', !!cand && !ok);
      el.classList.toggle('b-picked', ok);
    });
  }
  function renderTip() {
    var tip = $('btlGo');
    var t = $('btlRound');
    if (!G || !G.turnP) return;
    t.textContent = '第 ' + G.round + ' 轮' + (G.over ? ' · 结束' : G.turnP === G.me ? ' · 你的回合' : ' · ' + G.turnP.name + ' 的回合');
    var myPlay = G.turnP === G.me && UI.phase === 'play' && !G.over && !UI.host;
    var hint = $('btlHint');
    if (myPlay) {
      var sel = UI.sel.map(function (c) { return c.label; }).join('+');
      tip.textContent = sel ? (UI.tgt.length >= (UI.need || 1) ? '确定' : '选目标 👆') : '确定';
      tip.classList.toggle('b-ready', !!sel && UI.tgt.length >= (UI.need || 1));
      if (hint) hint.textContent = sel
        ? (UI.tgt.length >= (UI.need || 1) ? '使用【' + sel + '】→ ' + UI.tgt.map(function (t) { return t.name; }).join('、') : '使用【' + sel + '】：还差 ' + ((UI.need || 1) - UI.tgt.length) + ' 个目标')
        : '轮到你了，点牌再点确定';
    } else {
      tip.textContent = UI.host && G.turnP === G.me ? '托管中 🤖' : (G.turnP === G.me ? '…' : '等待 ' + G.turnP.name);
      tip.classList.remove('b-ready');
      if (hint) hint.textContent = G.over ? '' : (G.turnP === G.me ? '' : G.turnP.name + ' 正在行动…');
    }
  }
  function renderAll() { if (G) sanitize(); renderPlates(); renderHand(); renderSkills(); renderTargets(); renderTip(); }

  /* ================= 人类输入：出牌阶段 ================= */
  function plateClick(p) {
    if (!G || G.over) return;
    var myPlay = G.turnP === G.me && UI.phase === 'play' && !UI.host;
    if (!myPlay) { toast(p.name + '：' + p.hero.s.map(function (s) { return s.name; }).join('、')); return; }
    if (!UI.sel.length) { toast('先点下面一张牌'); return; }
    if (UI.tgtCands && UI.tgtCands.indexOf(p) < 0) { toast('这张牌打不了他'); return; }
    var i = UI.tgt.indexOf(p);
    if (i >= 0) UI.tgt.splice(i, 1); else { if (UI.tgt.length >= UI.need) UI.tgt.shift(); UI.tgt.push(p); }
    renderAll();
  }
  function handClick(c) {
    if (!G || G.over) return;
    var myPlay = G.turnP === G.me && UI.phase === 'play' && !UI.host;
    if (!myPlay) { toast('还没轮到你'); return; }
    var pv = playableViews(G.me);
    var us = pv.filter(function (x) { return x.card === c; });
    if (!us.length) {
      var tao = c.name === 'tao' && G.me.hp >= G.me.maxHp;
      toast(tao ? '满血吃桃浪费啦' : '这张现在用不了');
      return;
    }
    var i = UI.sel.indexOf(c);
    if (i >= 0) { UI.sel.splice(i, 1); UI.tgt = []; UI.need = 0; UI.tgtCands = null; }
    else {
      UI.sel = [c]; UI.tgt = [];
      var cur = us[0];
      UI.need = cur.need;
      UI.view = cur.view;
      var ts = targetable(G.me, cur.view);
      UI.tgtCands = cur.view.name === 'tao' || cur.view.name === 'jiu' || cur.view.name === 'shandian' ? [] : (cur.view.name === 'taoyuan' || cur.view.name === 'wugu' || cur.view.name === 'wanjian' || cur.view.name === 'nanzheng' || cur.view.name === 'wuzhong' ? [] : ts);
    }
    renderAll();
  }
  function goButton() {
    if (!G || G.over) return;
    var myPlay = G.turnP === G.me && UI.phase === 'play' && !UI.host;
    if (!myPlay || !UI.sel.length) { if (!UI.sel.length) toast('先点一张牌'); return; }
    var v = UI.view, need = UI.need;
    if (v.kind === 'equip' || v.name === 'tao' || v.name === 'jiu' || v.name === 'wuzhong' || v.name === 'taoyuan' || v.name === 'wugu' || v.name === 'wanjian' || v.name === 'nanzheng' || v.name === 'shandian') {
      UI.resolve({ type: 'play', card: UI.sel[0], view: v, targets: [] }); return;
    }
    if (UI.tgt.length < need) { toast(need === 2 ? '铁索要点 2 个人' : '选目标 👆'); return; }
    UI.resolve({ type: 'play', card: UI.sel[0], view: v, targets: UI.tgt.slice() });
  }

  function humanPlayTurn(p) {
    return new Promise(function (res) {
      UI.phase = 'play';
      UI.sel = []; UI.tgt = []; UI.need = 0; UI.tgtCands = null;
      UI.resolve = function (act) {
        UI.sel = []; UI.tgt = []; UI.need = 0; UI.tgtCands = null; UI.phase = 'wait'; UI.resolve = null;
        res(act);
      };
      renderAll();
    });
  }
  function endClicked() {
    if (!G || G.over) return;
    if (G.turnP === G.me && UI.phase === 'play' && !UI.host && UI.resolve) UI.resolve({ type: 'end' });
  }

  /* ================= 结算：每种牌 ================= */
  async function resolvePlay(p, act) {
    var v = act.view, tg = act.targets;
    var real = act.card;
    var conv = v._bySkill;
    // 从手里移除真实牌
    var ix = p.hand.indexOf(real);
    if (ix >= 0) p.hand.splice(ix, 1);
    showStage([v], p.name + ' → ' + (tg.length ? tg.map(function (t) { return t.name; }).join('、') : '全场'));
    if (conv) sayQuote(p, conv);
    p.shaUsed += (v.name === 'sha' ? 1 : 0);
    if (v.name === 'jiu') p.drunk += 1;

    switch (v.name) {
      case 'sha': await doSha(p, v, tg[0]); break;
      case 'tao': p.hp = Math.min(p.maxHp, p.hp + 1); say(p.name + ' 吃【桃】，体力 ' + p.hp); break;
      case 'jiu': say(p.name + ' 喝【酒】：下一张【杀】伤害 +1'); break;
      case 'wuzhong': draw(p, 2); say(p.name + ' 无中生有：摸 2 张'); break;
      case 'taoyuan': alive().forEach(function (q) { q.hp = Math.min(q.maxHp, q.hp + 1); }); say('【桃园结义】：全场回 1 体力'); break;
      case 'wugu': await doWugu(p); break;
      case 'wanjian': await doAoe(p, v, '万箭齐发', 'shan'); break;
      case 'nanzheng': await doAoe(p, v, '南蛮入侵', 'sha'); break;
      case 'shunshou': await doSteal(p, tg[0], true); break;
      case 'guohe': await doSteal(p, tg[0], false); break;
      case 'juedou': await doJuedou(p, tg[0]); break;
      case 'lebu': tg[0].judges.push(v); say(tg[0].name + ' 被贴了【乐不思蜀】'); break;
      case 'bingliang': tg[0].judges.push(v); say(tg[0].name + ' 被贴了【兵粮寸断】'); break;
      case 'shandian': p.judges.push(v); say(p.name + ' 头顶挂上了【闪电】⚡'); break;
      case 'tieso': tg.forEach(function (t) { t.chained = !t.chained; say(t.name + (t.chained ? ' 被连环 ⛓️' : ' 解除连环')); }); break;
      case 'huogong': await doHuogong(p, tg[0]); break;
      case 'jiedao': await doJiedao(p, tg[0]); break;
    }
    // 桃/无中生有/装备牌等入弃牌堆
    if (v.kind === 'equip' && v.name !== real.name) { /* 转化不会出装备 */ }
    toPile([real]);
    if (v.kind === 'equip') { /* 原生装备牌：直接穿上，不入弃 */ var i2 = G.pile.indexOf(real); if (i2 >= 0) G.pile.splice(i2, 1); equip(p, real); }
    renderAll();
  }

  async function doSha(p, v, t) {
    if (!t || !t.alive) return;
    say(p.name + ' 对 ' + t.name + ' 使用【' + v.label + '】');
    // 青釭剑：无视防具
    var armor = t.equips.armor;
    if (armor && p.equips.weapon && p.equips.weapon.name === 'qinggang') { say('青釭剑：无视 ' + t.name + ' 的 ' + armor.label); armor = null; }
    // 仁王盾：黑杀免疫
    if (armor && armor.name === 'renwang' && isBlack(v)) { say(t.name + ' 仁王盾：黑杀免疫！'); return; }
    // 藤甲：普通杀无效
    if (armor && armor.name === 'tengjia' && !v.element) { say(t.name + ' 藤甲：普通【杀】无效！'); return; }
    // 铁骑
    var noDodge = false;
    if (has(p, '铁骑')) {
      var jc = await judge(p, '铁骑');
      if (jc.suit !== '♥') { noDodge = true; sayQuote(p, '铁骑'); say('铁骑生效：' + t.name + ' 无法闪避'); }
    }
    // 烈弓
    if (has(p, '烈弓') && (t.hand.length >= p.hp || t.hp <= p.hp)) { noDodge = true; sayQuote(p, '烈弓'); say('烈弓生效：必中！'); }
    if (!noDodge) {
      var dodged = await askDodge(t, '【' + v.label + '】来了');
      if (dodged) return;
    }
    var dmg = 1 + (p.drunk > 0 ? 1 : 0) + (p.naked ? 1 : 0);
    if (p.drunk > 0) { p.drunk = 0; say('酒劲上头：伤害 +1'); }
    // 麒麟弓
    if (p.equips.weapon && p.equips.weapon.name === 'qilin' && (t.equips.horseP || t.equips.horseM)) {
      var slot = t.equips.horseP ? 'horseP' : 'horseM';
      var mc = stealEquip(t, slot); if (mc) { toPile([mc]); say('麒麟弓：射落 ' + t.name + ' 的' + mc.label); }
    }
    await damage(p, t, dmg, { card: v, element: v.element });
  }

  async function doAoe(p, v, label, needName) {
    for (var i = 0; i < alive().length; i++) {
      var t = alive()[i];
      if (t === p) continue;
      if (label === '南蛮入侵' && has(t, '巨象')) { sayQuote(t, '巨象'); say(t.name + ' 巨象：免疫南蛮入侵'); continue; }
      say('【' + label + '】→ ' + t.name);
      var canceled = await askWuxie(p, label, [t]);
      if (canceled) continue;
      if (t.equips.armor && t.equips.armor.name === 'tengjia' && (label === '南蛮入侵' || label === '万箭齐发')) { say(t.name + ' 藤甲：普通锦囊无效'); continue; }
      var ok = needName === 'shan' ? await askDodge(t, '【' + label + '】') : await askSha(t, '【' + label + '】');
      if (!ok) await damage(p, t, 1, { card: v, element: label === '万箭齐发' && v.element ? v.element : null });
      if (G.over) return;
    }
  }

  async function doWugu(p) {
    var cards = [];
    for (var i = 0; i < alive().length; i++) cards.push(drawOne());
    say('【五谷丰登】亮出 ' + cards.length + ' 张');
    showStage(cards);
    for (var j = 0; j < alive().length; j++) {
      var q = alive()[j];
      if (!cards.length) break;
      var c;
      if (q.isHuman && !UI.host) {
        c = await askCards('五谷丰登：挑一张', cards);
        if (!c) c = cards[0];
      } else {
        c = cards[0];
        await sleep(300);
      }
      cards.splice(cards.indexOf(c), 1);
      q.hand.push(c);
      say(q.name + ' 拿走 ' + c.label + ' ' + corner(c));
      renderAll();
    }
    toPile(cards);
  }

  async function doSteal(p, t, isShun) {
    var label = isShun ? '顺手牵羊' : '过河拆桥';
    if (t.judges.length) {
      var jc = t.judges.shift();
      toPile([jc]);
      say(p.name + ' 【' + label + '】拆掉 ' + t.name + ' 的判定区 ' + jc.label);
      return;
    }
    var slots = Object.keys(t.equips).filter(function (s) { return t.equips[s]; });
    if (t.hand.length && (!slots.length || Math.random() < 0.6)) {
      var c = randHand(t);
      t.hand.splice(t.hand.indexOf(c), 1);
      if (isShun) { p.hand.push(c); say(p.name + ' 顺手牵了 ' + t.name + ' 一张手牌（' + c.label + '）'); }
      else { toPile([c]); say(p.name + ' 拆了 ' + t.name + ' 一张手牌'); }
      if (p.isHuman) say('你' + (isShun ? '获得' : '弃置') + ' ' + c.label + ' ' + corner(c));
    } else if (slots.length) {
      var s = slots[0];
      var ec = stealEquip(t, s);
      if (ec) { if (isShun) { p.hand.push(ec); say(p.name + ' 牵走 ' + t.name + ' 的' + ec.label); } else { toPile([ec]); say(p.name + ' 拆掉 ' + t.name + ' 的' + ec.label); } }
    } else {
      say('【' + label + '】没有目标可拆…');
    }
  }

  async function doJuedou(p, t) {
    if (!t || !t.alive) return;
    if (await askWuxie(p, '决斗', [t])) return;
    say(p.name + ' 对 ' + t.name + ' 发起【决斗】！');
    var cur = t, other = p;
    while (true) {
      var need2 = has(other, '无双') ? 2 : 1;
      var played = 0;
      for (var i = 0; i < need2; i++) {
        if (await askSha(cur, '决斗！' + other.name + ' 出了【杀】')) played++;
        else break;
      }
      if (played < need2) { await damage(other, cur, 1 + (other.naked ? 1 : 0), { card: { label: '决斗' } }); break; }
      var tmp = cur; cur = other; other = tmp;
    }
  }

  async function doHuogong(p, t) {
    if (!t || !t.alive || !t.hand.length) { say('火攻没有生效（对方无手牌）'); return; }
    var show = t.hand[rnd(t.hand.length)];
    say('火攻：' + t.name + ' 亮出 ' + show.label + ' ' + corner(show) + '，' + p.name + ' 需弃同花色牌');
    var same = p.hand.filter(function (c) { return c.suit === show.suit; });
    if (!same.length) { say(p.name + ' 没有同花色，火攻失败'); return; }
    var use;
    if (p.isHuman && !UI.host) use = await askBox('弃【' + same[0].label + ' ' + corner(same[0]) + '】造成 1 点火焰伤害？', [{ t: '🔥 点', v: true, cls: 'ayes' }, { t: '算了', v: false }]);
    else use = true;
    if (use) { loseCard(p, same[0]); await damage(p, t, 1, { card: { label: '火攻' }, element: 'fire' }); }
  }

  async function doJiedao(p, t) {
    if (!t || !t.equips.weapon) return;
    var es = enemiesOf(t).filter(function (x) { return x !== p; });
    var tgt2 = es.length ? es[0] : null;
    if (!tgt2) { say('借刀杀人没有合适目标'); return; }
    say(p.name + ' 借刀杀人：令 ' + t.name + ' 对 ' + tgt2.name + ' 用【杀】');
    var ok = await askSha(t, p.name + ' 借刀逼你出杀');
    var w = t.equips.weapon;
    if (ok) {
      var dodged = await askDodge(tgt2, '【杀】');
      if (!dodged) await damage(t, tgt2, 1, { card: { label: '杀' } });
    } else {
      var wc = stealEquip(t, 'weapon');
      if (wc) { p.hand.push(wc); say(t.name + ' 不出杀，' + p.name + ' 收缴了' + wc.label); }
    }
  }

  /* ================= 弃牌阶段 ================= */
  function autoDiscard(p, n) {
    p.hand = p.hand.filter(Boolean);
    if (n <= 0) return;
    var keepPrio = { tao: 0, shan: 1, wuxie: 2, sha: 3 };
    p.hand.sort(function (a, b) { return (keepPrio[a.name] ?? 9) - (keepPrio[b.name] ?? 9); });
    var dropped = p.hand.splice(p.hand.length - n, n);
    toPile(dropped);
    say(p.name + ' 弃掉 ' + n + ' 张手牌');
    if (p.isHuman) say('弃了：' + dropped.map(function (c) { return c.label; }).join('、'));
  }

  /* ================= 主动技能 ================= */
  async function useActiveSkill(p, s) {
    if (G.turnP !== p || UI.phase !== 'play' || !p.alive) { toast('现在不能发动'); return; }
    switch (s) {
      case '制衡': {
        if (p.hand.length < 1) { toast('没有牌可换'); return; }
        var n;
        if (p.isHuman && !UI.host) {
          n = await (async function () {
            var v = await askBox('制衡：弃几张？（弃 A 摸 A）', [{ t: '弃 1 摸 1', v: 1, cls: 'ayes' }, { t: '弃 2 摸 2', v: 2, cls: 'ayes' }, { t: '弃 3 摸 3', v: p.hand.length >= 3 ? 3 : null, cls: 'ayes' }, { t: '不换了', v: 0 }]);
            return v || 0;
          })();
        } else {
          n = p.hand.filter(function (c) { return c.name !== 'tao' && c.name !== 'wuxie'; }).length >= 2 ? 2 : 0;
        }
        if (n > 0) { for (var i = 0; i < n; i++) loseCard(p, p.hand[p.hand.length - 1]); draw(p, n); sayQuote(p, '制衡'); say(p.name + ' 制衡：弃 ' + n + ' 摸 ' + n); renderAll(); }
        break;
      }
      case '苦肉': {
        if (p.hp <= 1) { toast('只剩一口气了，别苦肉'); return; }
        p.hp -= 1; draw(p, 2); sayQuote(p, '苦肉'); say(p.name + ' 苦肉：-1 体力摸 2 张');
        renderAll();
        if (p.hp <= 0) await dying(p, null);
        break;
      }
      case '仁德': {
        var mate = matesOf(p)[0];
        if (!mate) { toast('没有队友'); return; }
        if (p.hand.length < 2) { toast('手牌不足 2 张'); return; }
        var give = p.hand.splice(0, 2);
        mate.hand = mate.hand.concat(give);
        sayQuote(p, '仁德');
        say(p.name + ' 仁德：给 ' + mate.name + ' 2 张牌，回 1 体力');
        p.hp = Math.min(p.maxHp, p.hp + 1);
        renderAll();
        break;
      }
      case '青囊': {
        if (!p.hand.length) { toast('需要弃 1 张手牌'); return; }
        var hurt = alive().filter(function (q) { return q.hp < q.maxHp; });
        if (!hurt.length) { toast('没人受伤'); return; }
        var t = hurt[0];
        loseCard(p, p.hand[0]);
        t.hp = Math.min(t.maxHp, t.hp + 1);
        sayQuote(p, '青囊');
        say(p.name + ' 青囊：' + t.name + ' 回 1 体力');
        renderAll();
        break;
      }
      case '离间': {
        if (!p.hand.length) { toast('需要弃 1 张手牌'); return; }
        var males = enemiesOf(p).filter(function (q) { return q.hero.g !== 'female'; });
        if (males.length < 2) { toast('敌方男性武将不足两名'); return; }
        loseCard(p, p.hand[0]);
        sayQuote(p, '离间');
        await doJuedou(males[0], males[1]);
        break;
      }
      case '裸衣': {
        if (p.naked) { toast('已经裸衣了'); return; }
        p.naked = true; p._shaoDraw = true;
        sayQuote(p, '裸衣');
        say(p.name + ' 裸衣：本回合【杀】与【决斗】伤害 +1（摸牌阶段 -1）');
        break;
      }
      case '据守': {
        if (p.defending) { toast('已经据守了'); return; }
        p.defending = true;
        sayQuote(p, '据守');
        say(p.name + ' 据守：本回合结束将翻面并摸 1 张');
        break;
      }
    }
    renderAll();
  }

  /* ================= 回合流程 ================= */
  async function runTurn(p) {
    G.turnP = p;
    renderAll();
    say('▶ 轮到 ' + p.name + (p.team === 'dragon' ? '（龙）' : '（虎）'));
    await sleep(p.isHuman && !UI.host ? 300 : 500);
    // 洛神
    if (has(p, '洛神')) {
      var rounds = 0;
      while (rounds < 4 && p.alive) {
        var go2 = p.isHuman && !UI.host ? await askBox('洛神：判定黑色可拿一张牌，继续吗？', [{ t: '✨ 判定', v: true, cls: 'ayes' }, { t: '不判了', v: false }]) : true;
        if (!go2) break;
        var jc = await judge(p, '洛神');
        if (!isBlack(jc)) { say('洛神判定非黑，结束'); break; }
        rounds++;
        if (!has(p, '天妒')) { var extra = drawOne(); p.hand.push(extra); say(p.name + ' 洛神成功：获得 ' + extra.label + ' ' + corner(extra)); }
        sayQuote(p, '洛神');
        renderAll();
        if (!(p.isHuman && !UI.host)) await sleep(400);
      }
    }
    // 判定阶段
    if (p.judges.length) {
      UI.phase = 'judge'; renderAll();
      var js = p.judges.slice(); p.judges = [];
      for (var i = 0; i < js.length; i++) {
        var c = js[i];
        var rc = await judge(p, c.label);
        if (c.name === 'lebu') {
          // 官方：判定为红桃则无效，否则跳过出牌阶段
          if (isRed(rc)) say('判定红桃，【乐不思蜀】失效');
          else { p._skipPlay = true; say('【乐不思蜀】生效：' + p.name + ' 跳过出牌阶段'); }
          toPile([c]);
        }
        if (c.name === 'bingliang') {
          if (isBlack(rc)) { p._skipDraw = true; say('【兵粮寸断】生效：跳过摸牌阶段'); }
          else say('判定非黑，【兵粮寸断】失效');
          toPile([c]);
        }
        if (c.name === 'shandian') {
          if (rc.suit === '♠') {
            toPile([c]);
            say('⚡ 闪电劈中 ' + p.name + '！');
            await damage(null, p, 3, { card: { label: '闪电' }, element: 'thunder' });
          } else {
            var nx = G.players[(p.seat + 1) % 4];
            if (nx && nx.alive && nx !== p) { nx.judges.push(c); say('闪电移交给下家 ' + nx.name); }
            else toPile([c]);
          }
        }
        if (G.over) return;
        await sleep(400);
      }
    }
    // 摸牌阶段
    UI.phase = 'draw'; renderAll();
    if (p._skipDraw) { p._skipDraw = false; say(p.name + ' 跳过摸牌阶段'); }
    else if (has(p, '突袭')) {
      sayQuote(p, '突袭');
      var es = enemiesOf(p).filter(function (e) { return e.hand.length; });
      for (var k = 0; k < 2 && es.length; k++) {
        var e = es[k % es.length];
        var cc = randHand(e);
        e.hand.splice(e.hand.indexOf(cc), 1);
        p.hand.push(cc);
        say(p.name + ' 突袭：从 ' + e.name + ' 处拿走 1 张手牌');
      }
      if (p.isHuman) say('突袭到手：' + p.hand.slice(-2).map(function (x) { return x.label; }).join('、'));
    } else {
      var n = 2 + (has(p, '英姿') ? 1 : 0) - (p._shaoDraw ? 1 : 0);
      if (p._shaoDraw) p._shaoDraw = false;
      draw(p, n);
      if (!p.isHuman) say(p.name + ' 摸 ' + n + ' 张牌');
    }
    renderAll();
    // 出牌阶段
    p.shaUsed = 0; p.drunk = 0; p.naked = p._shaoDraw ? p.naked : p.naked;
    if (p._skipPlay) { p._skipPlay = false; say(p.name + ' 被乐，跳过出牌阶段'); }
    else {
      UI.phase = 'play'; renderAll();
      await playPhase(p);
    }
    if (G.over) return;
    // 弃牌阶段
    UI.phase = 'discard'; renderAll();
    var keep = p.hp;
    if (p.hand.length > keep) {
      if (has(p, '克己') && p.shaUsed === 0) { sayQuote(p, '克己'); say(p.name + ' 克己：本回合没用杀，跳过弃牌'); }
      else autoDiscard(p, p.hand.length - keep);
    }
    // 结束阶段
    if (has(p, '闭月')) { draw(p, 1); sayQuote(p, '闭月'); say(p.name + ' 闭月：摸 1 张'); }
    if (p.defending) {
      p.defending = false;
      p.flipped = true;
      draw(p, 1);
      say(p.name + ' 据守：翻面 🔄，摸 1 张（下回合跳过）');
    }
    UI.phase = 'wait';
    renderAll();
    await sleep(300);
  }

  async function playPhase(p) {
    if (p.isHuman && !UI.host) {
      while (true) {
        if (G.over) return;
        var act = await humanPlayTurn(p);
        if (act.type === 'end') { say('你结束了出牌'); return; }
        await resolvePlay(p, act);
        if (G.over) return;
        await sleep(200);
      }
    } else {
      // AI 出牌
      var steps = 0;
      while (steps < 8 && !G.over && p.alive) {
        var done = await aiOneAction(p);
        steps++;
        renderAll();
        if (!done) break;
        await sleep(520);
      }
      await sleep(250);
    }
  }

  /* ================= AI 决策 ================= */
  function aiViews(p) {
    var list = playableViews(p);
    // AI 视角排序：装备>桃>无中生有>杀>锦囊
    var pri = { wuzhong: 0, tao: 0, liannu: 1, bagua: 1, renwang: 1, baiyin: 1, tengjia: 1, horseP: 1, horseM: 1, sha: 2, juedou: 3, guohe: 3, shunshou: 3, lebu: 3, bingliang: 4, jiedao: 5, tieso: 6, huogong: 6, wugu: 4, taoyuan: 5, wanjian: 6, nanzheng: 6, shandian: 9 };
    list.sort(function (a, b) { return (pri[a.view.name] ?? 7) - (pri[b.view.name] ?? 7); });
    return list;
  }
  async function aiOneAction(p) {
    var list = aiViews(p);
    for (var i = 0; i < list.length; i++) {
      var x = list[i], v = x.view;
      // 装备优先
      if (v.kind === 'equip' && v.name === x.card.name) { await resolvePlay(p, { card: x.card, view: v, targets: [] }); return true; }
      if (v.name === 'tao' && p.hp < p.maxHp && (p.hp <= 2 || p.hand.length > 4)) { await resolvePlay(p, { card: x.card, view: v, targets: [] }); return true; }
      if (v.name === 'wuzhong') { await resolvePlay(p, { card: x.card, view: v, targets: [] }); return true; }
      if (v.name === 'sha') {
        var ts = targetable(p, v);
        if (ts.length) {
          ts.sort(function (a, b) { return a.hp - b.hp; });
          await resolvePlay(p, { card: x.card, view: v, targets: [ts[0]] });
          return true;
        }
      }
      if (v.name === 'juedou' && p.hand.filter(function (c) { return c.name === 'sha'; }).length >= 1) {
        var ts2 = targetable(p, v); if (ts2.length) { ts2.sort(function (a, b) { return a.hp - b.hp; }); await resolvePlay(p, { card: x.card, view: v, targets: [ts2[0]] }); return true; }
      }
      if (v.name === 'guohe' || v.name === 'shunshou' || v.name === 'lebu' || v.name === 'bingliang') {
        var ts3 = targetable(p, v);
        if (ts3.length) { ts3.sort(function (a, b) { return (a.team === p.team ? 1 : 0) - (b.team === p.team ? 1 : 0) || a.hp - b.hp; }); await resolvePlay(p, { card: x.card, view: v, targets: [ts3[0]] }); return true; }
      }
      if (v.name === 'jiu' && p.hp >= 2 && p.hand.some(function (c) { return c.name === 'sha'; })) { await resolvePlay(p, { card: x.card, view: v, targets: [] }); return true; }
    }
    // 主动技能
    var acts = activeSkills(p);
    for (var j = 0; j < acts.length; j++) {
      var s = acts[j].s;
      if (s === '青囊' && (p.hp < p.maxHp || matesOf(p).some(function (m) { return m.hp < m.maxHp; }))) { await useActiveSkill(p, s); return true; }
      if (s === '制衡' && p.hand.length >= 4) { await useActiveSkill(p, s); return true; }
      if (s === '苦肉' && p.hp >= 3 && p.hand.length <= 1) { await useActiveSkill(p, s); return true; }
      if (s === '仁德' && p.hand.length >= 5) { await useActiveSkill(p, s); return true; }
      if (s === '离间' && p.hand.length >= 2 && enemiesOf(p).filter(function (q) { return q.hero.g !== 'female'; }).length >= 2) { await useActiveSkill(p, s); return true; }
      if (s === '裸衣' && p.hand.some(function (c) { return c.name === 'sha'; })) { await useActiveSkill(p, s); return true; }
      if (s === '据守' && p.hp <= 2 && p.hand.length <= 2) { await useActiveSkill(p, s); return true; }
    }
    return false;
  }

  /* ================= 主循环 ================= */
  async function gameLoop(myToken) {
    while (!G.over && TOKEN === myToken) {
      var p = G.players[G.turnIdx];
      G.turnP = p;
      if (p.alive) {
        try {
          // 死斗期：第 12 轮起每回合开始流失 1 点体力，避免双方回血互耗陷入无限局
          if (G.round > 12 && p.alive && !G.over) {
            say('⏳ 死斗期（第 ' + G.round + ' 轮）：' + p.name + ' 体力流失 1');
            await damage(null, p, 1, { card: { label: '死斗' }, element: 'losshp' });
            renderAll();
            await sleep(260);
            if (G.over) { renderAll(); return; }
          }
          if (p.flipped) { p.flipped = false; say(p.name + ' 翻回正面，跳过此回合'); await sleep(600); }
          else await runTurn(p);
        } catch (err) {
          console.error('[battle]', err);
          say('⚠️ 引擎打了个磕绊，跳过这段回合');
        }
      }
      if (G.over || TOKEN !== myToken) return;
      checkWin();
      if (G.over) return;
      G.turnIdx = (G.turnIdx + 1) % 4;
      if (G.turnIdx === 0) G.round++;
      renderAll();
    }
  }

  /* ================= 开局 ================= */
  function startGame(myHero) {
    TOKEN++;
    var myToken = TOKEN;
    var heroes = G_all;
    // 我 = 1号位（龙），队友 3号位（龙），敌 2、4 号位（虎）；AI 优先选实装技能武将
    var implH = heroes.filter(function (h) { return h !== myHero && h.n !== myHero.n && HERO_IMPL[h.n]; });
    var restH = heroes.filter(function (h) { return h !== myHero && h.n !== myHero.n && !HERO_IMPL[h.n]; });
    var need = 3 - implH.length;
    var pool = shuffle(implH).concat(shuffle(restH).slice(0, Math.max(0, need))).slice(0, 3);
    G = {
      deck: shuffle(buildDeck()), pile: [], round: 1, over: false, turnIdx: 0, turnP: null,
      me: null, players: [],
    };
    var me = newPlayer(0, 'dragon', myHero, true, heroImpl(myHero));
    var ally = newPlayer(2, 'dragon', pool[0], false, heroImpl(pool[0]));
    var e1 = newPlayer(1, 'tiger', pool[1], false, heroImpl(pool[1]));
    var e2 = newPlayer(3, 'tiger', pool[2], false, heroImpl(pool[2]));
    G.players = [me, e1, ally, e2];   // 座位顺序：1我→2敌→3队友→4敌
    G.me = me;
    G.turnP = me;
    G.players.forEach(function (p) { draw(p, 4); });
    $('btlPick').hidden = true;
    $('btlGame').hidden = false;
    $('btlOver').hidden = true;
    say('⚔️ 2v2 龙虎斗开局！');
    say('你是 🐲 龙·' + me.name + '（' + me.maxHp + ' 体力），队友 ' + ally.name + '，敌方 ' + e1.name + ' / ' + e2.name);
    if (me.impl) say('你的技能：' + me.impl.join('、'));
    else say('⚠️ ' + me.name + ' 的技能还没实装，靠牌技打！');
    renderAll();
    gameLoop(myToken);
  }

  /* ================= 选将层 ================= */
  var G_all = [];          // 去重后的全部武将
  var pickPool = 'impl';
  var pickSel = null;
  var pickQ = '';
  async function openPick() {
    var data = await loadHeroes();
    G_all = data.dedup;
    renderPick();
  }
  function renderPick() {
    var grid = $('btlPickGrid');
    var list;
    if (pickQ) {
      list = G_all.filter(function (h) { return h.n.indexOf(pickQ) >= 0; });
      // 命中多条时：实装优先 → 标准包优先 → 短名优先
      list = list.slice().sort(function (a, b) {
        var ia = HERO_IMPL[a.n] ? 0 : 1, ib = HERO_IMPL[b.n] ? 0 : 1;
        if (ia !== ib) return ia - ib;
        if ((a.p === 'std') !== (b.p === 'std')) return a.p === 'std' ? -1 : 1;
        return a.n.length - b.n.length;
      });
    } else if (pickPool === 'impl') {
      list = G_all.filter(function (h) { return HERO_IMPL[h.n]; });
      // 按名字排序，经典在前
      list = list.slice().sort(function (a, b) { return ALLY_NAMES.indexOf(a.n) - ALLY_NAMES.indexOf(b.n); });
    } else {
      list = G_all.slice(0, 200);
      $('btlPickTip').textContent = '全部武将（前 200 位）—— 标红「未实装」的技能在对局里不生效，靠真牌技打';
    }
    if (!pickQ && pickPool === 'impl') $('btlPickTip').textContent = '经典实装武将：技能全部真的能发动。想要更多就切「全部武将」。';
    grid.innerHTML = '';
    list.slice(0, 120).forEach(function (h) {
      var imp = heroImpl(h);
      var el = document.createElement('div');
      el.className = 'phero' + (pickSel === h ? ' on' : '');
      var sks = h.s.map(function (s) {
        var on = imp && imp.indexOf(s.name) >= 0;
        return '<span class="' + (on ? '' : 'pnot') + '">' + s.name + (on ? '' : '·未实装') + '</span>';
      }).join(' ');
      el.innerHTML = avatarWrap(h, 'pav') +
        '<div class="bcol" style="min-width:0">' +
          '<div class="pnm">' + h.n + ' <span class="php">' + heroHp(h) + '体力</span> <small style="color:' + (KCOLOR[h.k] || '#888') + '">' + KNAME[h.k] + '</small></div>' +
          '<div class="psk">' + sks + '</div>' +
          '<div class="pmet">' + (h.t || '') + '</div>' +
        '</div>';
      el.onclick = function () {
        pickSel = h;
        $('btlPickGo').disabled = false;
        $('btlPickGo').classList.add('b-ready');
        $('btlPickTip').textContent = h.n + '：' + h.s.map(function (s) { return s.name; }).join('、') + (imp ? '（实装：' + imp.join('、') + '）' : '（技能未实装，凭牌技）');
        renderPick();
      };
      grid.appendChild(el);
    });
    if (!list.length) grid.innerHTML = '<div style="grid-column:1/-1;color:#6b7268;font-size:13px;padding:20px">没找到这个武将</div>';
  }

  /* ================= 绑定（幂等） ================= */
  var started = false;
  function bind() {
    $('btlBack').onclick = function () {
      if (!G || G.over) { if (window.__sgsGo) window.__sgsGo('mode'); return; }
      var sure = confirm('认输退出这局？');
      if (sure) { TOKEN++; G.over = true; if (window.__sgsGo) window.__sgsGo('mode'); }
    };
    $('btlGo').onclick = goButton;
    $('btlEnd').onclick = endClicked;
    $('btlSk0').onclick = function () { if (this.dataset.sk) useActiveSkill(G.me, this.dataset.sk); };
    $('btlSk1').onclick = function () { if (this.dataset.sk) useActiveSkill(G.me, this.dataset.sk); };
    $('btlHost').onclick = function () {
      UI.host = !UI.host;
      $('btlHost').classList.toggle('on', UI.host);
      toast(UI.host ? '托管中 🤖 交给 AI' : '收回指挥权');
      // 托管瞬间若正等人类出牌/响应，直接替他"结束出牌"，AI 接管
      if (UI.host && UI.resolve && G && G.turnP === G.me && UI.phase === 'play') UI.resolve({ type: 'end' });
      renderAll();
    };
    $('btlAgain').onclick = function () { $('btlOver').hidden = true; $('btlGame').hidden = true; $('btlPick').hidden = false; pickSel = null; $('btlPickGo').disabled = true; $('btlPickGo').classList.remove('b-ready'); renderPick(); };
    $('btlQuit').onclick = function () { $('btlOver').hidden = true; if (window.__sgsGo) window.__sgsGo('mode'); };
    $('btlPickBack').onclick = function () { if (window.__sgsGo) window.__sgsGo('mode'); };
    $('btlPickGo').onclick = function () { if (pickSel) startGame(pickSel); };
    $('btlPoolChips').addEventListener('click', function (e) {
      var b = e.target.closest('.pchip'); if (!b) return;
      pickPool = b.dataset.pool;
      this.querySelectorAll('.pchip').forEach(function (x) { x.classList.toggle('on', x === b); });
      pickSel = null; $('btlPickGo').disabled = true; $('btlPickGo').classList.remove('b-ready');
      renderPick();
    });
    $('btlPickSearch').addEventListener('input', function () { pickQ = this.value.trim(); renderPick(); });
    var entry = $('battleEntry');
    if (entry) entry.onclick = function () { if (window.__sgsGo) window.__sgsGo('battle'); };
    var skip = $('btlRotateSkip');
    if (skip) skip.onclick = function () { $('btlRotate').style.display = 'none'; };
  }

  function init() {
    if (started) return;
    started = true;
    $('btlGame').hidden = true;
    $('btlPick').hidden = false;
    openPick();
  }

  function boot() {
    bind();
    var mo = new MutationObserver(function () {
      if (document.body.dataset.tab === 'battle') init();
    });
    mo.observe(document.body, { attributes: true, attributeFilter: ['data-tab'] });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
