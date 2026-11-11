/**
 * types/gameplay.ts — 「玩法」模块类型定义（up/003 四.2）
 *
 * 说明：本 App 为零依赖原生 JS，此文件作为数据契约与文档资产，
 * 供接入真实后端 / 迁移到 TS 工程时使用。运行时数据源为
 * data/gameplayRules.json（结构与本文件严格对应）。
 *
 * 数据来源（2026-09-23 实抓）：
 *  - OL 官网   https://www.sanguosha.com/mode            （模式全文）
 *  - 移动版官网 https://www.sanguosha.cn/pc/mode-info-1~5 （模式全文）
 *  - 十周年官网 https://sanguosha.youxi.com/main.html     （模式入口 + 自走棋简介）
 *  - 通用规则   fandom 规则页直连不可达，按官方通用规则整理（sourceNote 已标注）
 */

/** 版本标识：ol=三国杀OL / mob=移动版 / ten=十周年 / wiki=通用规则百科 */
export type VersionId = 'ol' | 'mob' | 'ten' | 'wiki';

/** 第二层玩法分类（印章横滑栏） */
export interface GameplayCategory {
  id: string;        // 如 'identity' / 'kingdom' / 'team' / 'fun' / 'basic'
  label: string;     // 如 '身份军争' / '阵营国战' / '多人组队' / '娱乐模式' / '基础规则'
}

/** 单个玩法模式（第一层版本 → 第二层分类 → 模式列表） */
export interface GameplayMode {
  id: string;              // 稳定标识，如 'ol-identity'
  name: string;            // 模式名称（官网原文）
  players: string;         // 人数（官网原文，如 '5-8人'）
  cat: string;             // 所属分类 id
  minutes?: string;        // 平均时长（移动版官网提供，如 '15分钟'）
  desc: string;            // 玩法简介（官网原文或轻度整理）
  tips?: string[];         // 快速攻略（官网原文）
  roles?: ModeRole[];      // 身份/阵营拆解（官网原文拆分）
  source: string;          // 数据来源 URL
  sourceNote?: string;     // 来源补充说明（如 fandom 不可达时的整理声明）
}

/** 模式内身份/阵营条目 */
export interface ModeRole {
  name: string;      // 主公 / 忠臣 / 反贼 / 内奸 / 魏蜀吴群…
  goal: string;      // 获胜目标（官网原文）
}

/** 版本对象（第一层分段控制器） */
export interface GameplayVersion {
  id: VersionId;
  label: string;     // 【三国杀OL】【移动版】【十周年】【通用规则百科】
  home: string;      // 数据源首页
  cats: GameplayCategory[];
  modes: GameplayMode[];
}

/** 沙盘身份牌颜色与图腾规范（up/003 二.2 新国风四色） */
export interface RoleStyle {
  id: 'zhu' | 'zhong' | 'zei' | 'jian';
  name: string;          // 主公 / 忠臣 / 反贼 / 内奸
  alias?: string;        // 沙盘别名：暖色主帅 / 暖色前锋 / 冷色前锋 / 冷色主帅
  color: string;         // 主公 #982B2B / 忠臣 #C59A5A / 反贼 #2D7C66 / 内奸 #234B73
  totem: string;         // 图腾印章单字：龙 / 虎 / 翎 / 眸
  goals: string[];       // 获胜判定目标
  hpNote: string;        // 初始体力上限变化（如 5/8人局主公 +1）
  reward?: string;       // 相关奖惩规则
}

/** 沙盘视图（3v3 统领三军 / 8人身份场 / 2v2 对抗） */
export interface SandboxView {
  id: string;            // 'sanguo3v3' | 'identity8' | 'duel2v2'
  label: string;
  note: string;          // 视图说明（座次顺时针、阵营对应关系）
  seats: SandboxSeat[];  // 座位（坐标为案几内百分比）
}

export interface SandboxSeat {
  no: number;            // 座位号（1 号位起，顺时针）
  x: number;             // 横向百分比 0-100
  y: number;             // 纵向百分比 0-100
  role: RoleStyle['id']; // 身份（示意沙盘用标准配置）
  team?: 'warm' | 'cold' | 'neutral'; // 暖色方 / 冷色方
}

/** 回合时序阶段（Fandom 百科严格定义的六阶段） */
export interface TurnPhase {
  idx: number;           // 1-6
  name: string;          // 阶段名
  act: string;           // 标准操作
  skills: string;        // 可触发的典型技能类型
  trap: string;          // 优先级陷阱（如后置先判）
}

/** gameplayRules.json 根结构 */
export interface GameplayRules {
  meta: { generated: string; note: string };
  versions: GameplayVersion[];
  roles: RoleStyle[];
  sandbox: { views: SandboxView[] };
  phases: TurnPhase[];
}
