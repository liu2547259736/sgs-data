# sgs-data — 三国杀图鉴数据仓库

Flutter 化改造的 P0 产物。这是**独立 Git 仓库**，只放数据，不放 App 代码，
通过 jsDelivr tag 给 App 和网页版做增量更新。改一条武将技能文案不需要重新打包 App。

基准来源：`H:/AI/sgs-heroes/sgs-heroes-app/`（原主程序，只读，未做任何修改）。

## 目录结构

```
data-repo/
├── manifest.json          # App 唯一入口：version + 每个文件的 sha256/bytes
├── heroes/
│   ├── index.json         # 3740 条轻量索引（v/id/n/k/hp/lv/p/ord/img/av）
│   └── <ver>-NNN.json     # 每 500 将一片，11 片，含武将完整数据
├── skins/
│   └── <ver>-NNN.json     # 与 heroes 分片对齐，只放文字索引（sk/skn/ni/na）
├── images/                # 仅 il 主视觉 / av 头像 / icons 包图标
│   └── <ver>/<kind>/
├── meta/                  # index.json / search_index.json / 各版本 pack_icons 等
└── tools/
    ├── migrate.py         # 从主程序重新生成 heroes/skins/images/meta（幂等）
    ├── build_manifest.py  # 扫目录算 sha256 + bytes，重生成 manifest.json
    └── snapshot.py        # 生成 ../legacy-web 非皮肤快照
```

## 数据规则

- 除 `manifest.json` 外，所有 JSON 用 `{"data": ...}` 包一层，方便以后加 `deprecated` 等元字段
- `manifest.json` 的 `version` 是日期串，App **只比这个字段**决定要不要更新；
  同一天多次发布用 `python tools/build_manifest.py 2026.11.10-2` 手动递增
- `files[]` 里每条带 `sha256` 和 `bytes`，App 只下载 hash 变了的，写入走 drift 事务
- 字段沿用原库的 1~3 字母缩写（`id/n/k/hp/s/sk/skn/ord/pk/q/vo/bio`…），**不重命名**，
  否则 `v2/*.py` 整套生成脚本会失效
- 6 个版本：`sgsol` / `msgs` / `sgs` / `hlsgs` / `gjf` / `wxmini`，共 3740 将。
  原库的 `unreleased`（373 条、结构残缺、线上未发布）未收入

## 皮肤图与语音

**皮肤图 `sk/`（12901 张 / 706.6 MB）和语音 `voice/`（26556 个 / 1621.0 MB）不进本仓库。**

- `skins/*.json` 里的 `sk`/`skn` 保留的是**相对路径字符串**，例如
  `images/sgsol/sk/std_guanyu_ol0.webp`；真实 URL 前缀由 App 的 `env.dart` 拼接，
  当前尚未托管，先按占位处理
- 后续托管时建议把图片改成**内容寻址文件名**（md5 前 12 位），天然永久缓存，
  不用再手工 bump 原 `app.js` 的 `IMG_V`
- 语音线上本来就禁播（`app.js:1933` 的 `VOICE_ENABLED` 只在 file:/localhost/内网开），
  且本轮已定「只保图鉴核心」，整块丢弃无损失

## 内容物分类（原主程序）

| 类 | 内容 | 文件数 | 体积 | 去向 |
|---|---|---:|---:|---|
| A 核心图像 | il / av / icons | 8183 | 130.6 MB | 本仓库 `images/` |
| B 文本数据 | `data/*.json` 全量 | 457 | 60.0 MB | 本仓库 `heroes/` `skins/` `meta/`；原样快照在 `../legacy-web/data/` |
| C 静态资源 | assets / fonts / favicon / BGM | 290 | 34.4 MB | `../legacy-web/` |
| D 运行时代码 | index.html / app.js / style.css 等 | 16 | 0.7 MB | `../legacy-web/` |
| E 工程脚本 | v2 / tools / e2e / bat | 40 | 1.1 MB | `../legacy-web/` |
| F 皮肤图 | `images/*/sk/` | 12901 | 706.6 MB | ❌ 排除 |
| G 语音 | `images/*/voice/` | 26556 | 1621.0 MB | ❌ 排除 |
| H 垃圾 | `_backups/` `.bak-*` `_tmp_*` `unreleased/` | ~20 | 13.7 MB | ❌ 排除 |

`../legacy-web/` 是 A~E 的原样快照（独立仓库，可上 git，不推 CDN），
`../app/` 留给 P1 的 Flutter 工程，现在空着。

## 给 Flutter 解析层的已知坑（源数据结构不一致，共 6 类）

1. 顶层结构不统一：`gjf/wxmini` 无 `count`，只有 `hlsgs` 有 `roles`
2. 字段覆盖断崖：`skn` 在 `sgs`、`hlsgs` 整版缺失；`pk` 在 `gjf` 仅 103/683
3. 类型混用：`hp`/`hp0` 在 sgsol 有 54 条 float；`ord` 在 sgs 有 5 条 float；`wr` int/str 混用
4. `g` 语义冲突：主库是 `male/female`，`search_index.json` 里是 `m` 单字母
5. `sk[]`（纯路径）与 `skn[]`（带名对象）一一对应但数量不等（sgsol 4480 vs 4361）
6. `ni`/`na` 是「立绘/头像不可用」占位标记，前端要渲染首字占位卡

**全部在 Repository 层归一化，UI 只读干净模型。** 别在 `build()` 里碰 Dio。

## 重跑方式

```
python tools/migrate.py                    # 从主程序重建（会覆盖 data-repo 内的数据文件）
python tools/build_manifest.py            # 重算 sha256 / bytes
python tools/snapshot.py                  # 重建 ../legacy-web 快照
```

三个脚本只用 Python 标准库，只读源目录，绝不删源文件。
