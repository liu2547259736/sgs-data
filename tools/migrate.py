# -*- coding: utf-8 -*-
"""从主程序生成 data-repo 的新格式数据。只读源目录，可重复运行（幂等）。

用法: python tools/migrate.py
产出: heroes/index.json, heroes/<ver>-NNN.json, skins/<ver>-NNN.json,
      images/<ver>/<il|av|icons>/*, meta/*
"""
import os
import sys
import json
import shutil
import io

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

ROOT = 'H:/AI/sgs-heroes'
APP = ROOT + '/sgs-heroes-app'
OUT = ROOT + '/sgs-flutter/data-repo'

# 线上在跑的 6 个版本；unreleased 未上线且结构残缺，不进新仓库
VERSIONS = ['sgsol', 'msgs', 'sgs', 'hlsgs', 'gjf', 'wxmini']
CHUNK = 500
IMAGE_KINDS = ('il', 'av', 'icons')   # 皮肤 sk / 语音 voice 不复制
META_FILES = [
    'index.json', 'search_index.json', 'cards.json', 'gameplayRules.json',
    'seriesRef.json', 'sgs_icons.json', 'kepu_stats.json', 'changelog.json',
    'skill_evolution.json', 'recent.json',
]

# 三国史料模块的自有数据（books/ contents/ cards/ compare/ ...），11 MB 纯文本。
# 主程序 history.js 只读这个目录；Flutter 端要做史料模块，必须一起进数据仓库。
HISTORY_SRC = APP + '/data/history'
HISTORY_DST = OUT + '/history'

# 原页面 1:1 骨架。App 的 WebView 壳按 URL 路径读覆盖层，覆盖层路径就是
# data-repo 相对路径，所以这里必须按 legacy-web 的原样路径平铺到 OUT 根下。
# 用镜像快照而不是主程序目录，保证随包 assets/shell 与 CDN 是同一份字节。
SHELL_SRC = ROOT + '/sgs-flutter/legacy-web'
# 与 app/tools/sync_shell_assets.py 的 SKIP_* 必须逐条一致
SHELL_SKIP_DIRS = {
    '.git', '_backups', '__pycache__', 'node_modules',
    'tools', 'v2', '_shots', 'unreleased',
}
SHELL_SKIP_NAMES = {'serve.py', '_launch.vbs', '.gitignore', '.DS_Store', 'Thumbs.db'}
SHELL_SKIP_PREFIX = ('e2e_', 'shot', '_shot')
SHELL_SKIP_SUFFIX = ('.py', '.pyc', '.bat', '.vbs', '.ps1', '.md', '.log', '.bak', '.cjs', '.mjs')


def rel_out(path, base=OUT):
    return os.path.relpath(path, base).replace(chr(92), '/')


def load(path):
    with open(path, encoding='utf-8') as f:
        return json.load(f)


KEPT = set()   # 本次生成/复制的文件相对路径（相对 OUT），用于镜像清理


def keep(path):
    KEPT.add(os.path.relpath(path, OUT).replace('\\', '/'))


def dump(path, obj):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(obj, f, ensure_ascii=False, separators=(',', ':'))
    keep(path)


def prune():
    """镜像清理：主程序/镜像里已不存在的文件，数据仓库里也删掉。

    范围是本脚本能产出的全部数据目录（含原页面骨架）；.git / tools /
    __pycache__ 与人工维护的 manifest.json / README.md / .gitignore 不碰。
    """
    manual = {'manifest.json', 'README.md', '.gitignore'}
    skip = {'.git', 'tools', '__pycache__'}
    removed = 0
    for root, dirs, names in os.walk(OUT):
        top = rel_out(root).split('/')[0]
        if top in skip:
            dirs[:] = []
            continue
        dirs[:] = [d for d in dirs if d not in skip]
        for name in names:
            path = os.path.join(root, name)
            r = rel_out(path)
            if r in KEPT or r in manual:
                continue
            os.remove(path)
            removed += 1
    for root, dirs, names in os.walk(OUT, topdown=False):
        if root == OUT:
            continue
        if rel_out(root).split('/')[0] in skip:
            continue
        if not os.listdir(root):
            os.rmdir(root)
    return removed


def build_heroes_and_skins():
    index_items = []
    version_meta = []
    skin_total = 0
    parts_total = 0

    for ver in VERSIONS:
        doc = load(APP + '/data/' + ver + '/characters.json')
        gens = doc['generals']
        version_meta.append({
            'id': ver,
            'short': doc.get('short'),
            'label': doc.get('label'),
            'source': doc.get('source'),
            'count': len(gens),
            'packs': doc.get('packs', []),
            'parts': (len(gens) + CHUNK - 1) // CHUNK,
        })

        for g in gens:
            index_items.append({
                'v': ver, 'id': g['id'], 'n': g.get('n'), 'k': g.get('k'),
                'hp': g.get('hp'), 'lv': g.get('lv'), 'p': g.get('p'),
                'ord': g.get('ord'), 'img': g.get('img'), 'av': g.get('av'),
            })

        part = 0
        for i in range(0, len(gens), CHUNK):
            part += 1
            parts_total += 1
            chunk = gens[i:i + CHUNK]
            tag = '%s-%03d' % (ver, part)

            dump(OUT + '/heroes/' + tag + '.json', {
                'data': {
                    'version': ver, 'part': part, 'count': len(chunk),
                    'generals': chunk,
                }
            })

            skin_items = []
            for g in chunk:
                sk = g.get('sk') or []
                skn = g.get('skn') or []
                if not sk and not skn:
                    continue
                item = {'id': g['id'], 'sk': sk, 'skn': skn}
                for flag in ('ni', 'na'):
                    if flag in g:
                        item[flag] = g[flag]
                skin_items.append(item)
                skin_total += len(sk)

            dump(OUT + '/skins/' + tag + '.json', {
                'data': {
                    'version': ver, 'part': part, 'count': len(skin_items),
                    'items': skin_items,
                }
            })

        print('  %-8s %4d 将 -> %d 片' % (ver, len(gens), part))

    dump(OUT + '/heroes/index.json', {
        'data': {
            'total': len(index_items),
            'versions': version_meta,
            'heroes': index_items,
        }
    })
    return len(index_items), skin_total, parts_total


def copy_images():
    # icons/ 下还有 kingdom/ packages/ category/ 等二级目录，必须递归复制
    n = 0
    total = 0
    for ver in VERSIONS:
        for kind in IMAGE_KINDS:
            src = '%s/images/%s/%s' % (APP, ver, kind)
            if not os.path.isdir(src):
                continue
            for root, dirs, names in os.walk(src):
                rel = os.path.relpath(root, src).replace('\\', '/')
                sub = '' if rel == '.' else '/' + rel
                dst = '%s/images/%s/%s%s' % (OUT, ver, kind, sub)
                os.makedirs(dst, exist_ok=True)
                for name in names:
                    sp, dp = root + '/' + name, dst + '/' + name
                    if not os.path.isfile(sp):
                        continue
                    shutil.copy2(sp, dp)
                    keep(dp)
                    n += 1
                    total += os.path.getsize(dp)
    return n, total


def copy_meta():
    n = 0
    for name in META_FILES:
        sp = APP + '/data/' + name
        if os.path.isfile(sp):
            shutil.copy2(sp, OUT + '/meta/' + name)
            keep(OUT + '/meta/' + name)
            n += 1
    for ver in VERSIONS:
        sp = APP + '/data/' + ver + '/pack_icons.json'
        if os.path.isfile(sp):
            shutil.copy2(sp, OUT + '/meta/packs/' + ver + '.json')
            keep(OUT + '/meta/packs/' + ver + '.json')
            n += 1
    return n


def copy_history():
    """镜像复制 data/history/（含 books/contents 二级目录），返回 (文件数, 字节数)。"""
    if not os.path.isdir(HISTORY_SRC):
        return 0, 0
    n = 0
    total = 0
    for root, dirs, names in os.walk(HISTORY_SRC):
        rel = os.path.relpath(root, HISTORY_SRC).replace('\\', '/')
        sub = '' if rel == '.' else '/' + rel
        dst = HISTORY_DST + sub
        os.makedirs(dst, exist_ok=True)
        for name in names:
            sp, dp = root + '/' + name, dst + '/' + name
            if not os.path.isfile(sp):
                continue
            shutil.copy2(sp, dp)
            keep(dp)
            n += 1
            total += os.path.getsize(dp)
    return n, total


def _shell_keep(name):
    if name in SHELL_SKIP_NAMES or name.startswith(SHELL_SKIP_PREFIX):
        return False
    return not name.lower().endswith(SHELL_SKIP_SUFFIX)


def copy_shell():
    """把原页面骨架按原路径平铺进 data-repo；返回 (文件数, 字节数)。

    images/<版本>/<il|av|icons>/ 已由 copy_images() 生成，跳过以免重复搬运
    149MB；images/brand/ 这类页面自有图标仍要带上。皮肤 sk/ 与语音 voice/
    按工程约定永不进 git。
    """
    if not os.path.isdir(SHELL_SRC):
        return 0, 0
    n = 0
    total = 0
    for root, dirs, names in os.walk(SHELL_SRC):
        dirs[:] = sorted(d for d in dirs
                         if d not in SHELL_SKIP_DIRS and d not in ('sk', 'voice'))
        for name in sorted(names):
            if not _shell_keep(name):
                continue
            sp = os.path.join(root, name)
            rpath = os.path.relpath(sp, SHELL_SRC).replace(chr(92), '/')
            parts = rpath.split('/')
            if (len(parts) >= 3 and parts[0] == 'images'
                    and parts[1] in VERSIONS and parts[2] in IMAGE_KINDS):
                continue
            dp = OUT + '/' + rpath
            os.makedirs(os.path.dirname(dp), exist_ok=True)
            shutil.copy2(sp, dp)
            keep(dp)
            n += 1
            total += os.path.getsize(dp)
    return n, total


def main():
    print('[1/6] 生成 heroes/ 与 skins/ 分片')
    heroes, skins, parts = build_heroes_and_skins()
    print('[2/6] 复制非皮肤图片')
    imgs, img_bytes = copy_images()
    print('[3/6] 复制元数据')
    meta = copy_meta()
    print('[4/6] 复制史料数据')
    hist, hist_bytes = copy_history()
    print('[5/6] 复制原页面 1:1 骨架')
    shell, shell_bytes = copy_shell()
    print('[6/6] 镜像清理残留文件')
    stale = prune()

    print('')
    print('武将 %d 条 / 皮肤图引用 %d 条 / 分片 %d 个' % (heroes, skins, parts))
    print('图片 %d 张 / %.2f MB' % (imgs, img_bytes / 1024 / 1024))
    print('元数据 %d 个文件 / 史料 %d 个文件 %.2f MB' % (
        meta, hist, hist_bytes / 1024 / 1024))
    print('原页面骨架 %d 个文件 / %.2f MB' % (
        shell, shell_bytes / 1024 / 1024))
    print('清理上次同步残留 %d 个文件' % stale)


if __name__ == '__main__':
    main()
