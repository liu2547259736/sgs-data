/**
 * roster.ts —— 武将数据与系列字典契约（up/004.md 交付物1：轻量 Schema 补丁）
 *
 * 原则（004.md 核心原则）：最小侵入 —— 现有 characters.json 条目字段一个不动，
 * 仅【可选】新增 rel 字段；系列对齐走独立参考字典 seriesRef.json，不碰现有 packs。
 */

/** 未实装状态（up/004 任务3）。缺省/undefined 视为 released，旧数据零迁移。 */
export type RelStatus = 'released' | 'unreleased' | 'test_server' | 'special_mode';

/** 现有武将条目（data/<ver>/characters.json generals[]）—— 仅列与 004 相关字段，其余略 */
export interface General {
  id: string;          // 复合 id：系列/包前缀 + 拼音（如 mougong_mouzhaoyun）
  n: string;           // 武将名
  p: string;           // 扩展包 id（对应 index.json 该版本 packs[].id）
  gr?: string;         // 系列分组文本（如「谋攻篇-同包」）
  k?: string;          // 势力
  /** [004 新增·可选] 未实装状态；不写 = released。 */
  rel?: RelStatus;
  /** [004 新增·可选] 前瞻备注（爆料来源、测试服时间等），rel ≠ released 时建议填写 */
  relNote?: string;
  // ...其余既有字段（t/s/tg/img/av/sk/lv/ot/bio/ft/q/vo）保持原样，此处不展开
}

/** 参考系列条目（data/seriesRef.json platforms[].series[]） */
export interface SeriesRefEntry {
  id: string;
  label: string;
  src: Array<'moe' | 'task'>;      // 来源：萌百截图 / 004.md 列举
  status: 'mapped' | 'partial' | 'ref';
  map?: { ver: string; pack: string };  // status=mapped/partial 时指向现有 packs
  note?: string;                   // [出入] 标注等
}

export interface SeriesRefPlatform {
  platform: string;                // offline / sgsol / sgs / msgs / hw / miniapp / hls / gz
  label: string;
  boardTitle: string;              // 萌百截图板块标题原文（保留出处）
  series: SeriesRefEntry[];
  note?: string;
}

/**
 * 复合唯一维度（up/004 任务2）：`端 + 包 + 名 (+ 变体Tag/势力)`。
 * 严禁单凭 n 判重 ——「msgs·谋攻篇·谋赵云」与「sgs·谋定天下·谋赵云」必须并存。
 * 实现见 scripts/series-audit.mjs 的 heroUid() / mergeGenerals()。
 */
export declare function heroUid(ver: string, pack: string, name: string, tag?: string): string;

/**
 * 前端未实装筛选（up/004 任务3）：英雄页筛选面板「前瞻」chip。
 * - 数据层：generals[] 可选 rel 字段，缺省 released
 * - UI 层：仅当版本内存在 rel ≠ released 的武将时渲染（零数据零 UI），点击只看前瞻
 * - 等价接口语义：GET /generals?status=unreleased → rel ∈ {unreleased, test_server, special_mode}
 */
export type FutFilterQuery = { status?: RelStatus | 'all' };
