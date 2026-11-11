/**
 * cards.ts —— 游戏牌图鉴契约（up/005.md 交付物1，第 5 模块「牌库」）
 * 数据源：data/cards.json（种子）；全量数据由 tools/fetch_cards.py 抓取词条后合并。
 */

export type CardCategory = 'basic' | 'scroll' | 'equip' | 'special';

/** 锦囊子类（cat=scroll 时） */
export type ScrollSub = 'normal' | 'delayed' | 'faction';
/** 装备子类（cat=equip 时）：武器 / 防具 / +1 马 / -1 马 / 宝物 */
export type EquipSub = 'weapon' | 'armor' | 'horse_p' | 'horse_m' | 'treasure';
/** 双副类别（cat=special 时）用 sub 存主类别，note 里说明副类别（如 藏锋=武器&宝物、艨艟=坐骑&坐骑） */
export type CardSub = ScrollSub | EquipSub | null;

/** 数据层级：core=规则书稳定内容（全字段） / list=名录层（仅名与归属，effect 空，待爬虫补全） */
export type CardLayer = 'core' | 'list';
/** 条目来源：rulebook=公开规则书 / capture=用户截图板块 / crawl=爬虫抓取的词条页 */
export type CardSrc = 'rulebook' | 'capture' | 'crawl';

/** 游戏牌条目（对应 005.md §1 实体属性 + §3.1 类型定义） */
export interface GameCard {
  id: string;                 // 稳定 id（拼音缩写 + 包前缀），如 qlyyd / gz_yjyg
  n: string;                  // 牌名（name）
  cat: CardCategory;          // 一级大类
  sub: CardSub;               // 子类
  pkg: string[];              // 扩展包/模式归属（packages[].id，可多个）
  variant?: string;           // 别名/前缀（如「雷」「火」「国」「冰」）
  range?: number | null;      // 武器攻击范围 / 顺手牵羊、兵粮寸断的距离限制
  horse?: 1 | -1 | null;      // 坐骑：+1 防御马 / -1 进攻马
  timing?: string;            // 使用时机（卡牌说明）
  target?: string;            // 目标对象与作用距离（target_rules）
  effect: string;             // 效果正文（effect_desc）；名录层为空串
  suits?: Array<{ suit: '♠' | '♥' | '♣' | '♦'; num: string }>;  // 牌堆花色点数（待爬虫核实填充）
  core?: boolean;             // true=核心层
  src?: CardSrc;              // 条目来源
  note?: string;              // 备注（双副类别说明 / 待核实标注）
}

/** data/cards.json 顶层结构 */
export interface CardsData {
  meta: {
    title: string;
    sources: string[];
    layers: string;
    incomplete: string;
  };
  packages: Array<{ id: string; label: string }>;
  cards: GameCard[];
}

/**
 * 爬虫（tools/fetch_cards.py）输出 cards_data.json 后，按本契约合并进 cards[]：
 * - 已有 id（或 牌名+包 命中）→ 跳过保留，绝不覆盖（对齐 004 防撞车原则）
 * - 新牌 → 补入，src 标 'crawl'，图片存 ./assets/cards/{category}/{name}.png
 * 前端等价接口语义：GET /cards?cat=scroll&sub=delayed&pkg=jz → 过滤渲染
 */
export type CardsQuery = {
  cat?: CardCategory | 'all';
  pkg?: string | 'all';
  q?: string;                 // 按牌名/变体检索
};
