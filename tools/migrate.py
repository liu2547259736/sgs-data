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
    'skill_evolution.json',
]


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
    """删掉主程序里已不存在、但上次同步残留下来的文件。
    只作用于 heroes/ skins/ images/ meta/ 四个数据目录，绝不触碰 .git/tools。
    """
    removed = 0
    for sub in ('heroes', 'skins', 'images', 'meta'):
        base = OUT + '/' + sub
        if not os.path.isdir(base):
            continue
        for root, dirs, names in os.walk(base):
            for name in names:
                p = root + '/' + name
                if os.path.relpath(p, OUT).replace('\\', '/') in KEPT:
                    continue
                os.remove(p)
                removed += 1
        for root, dirs, names in os.walk(base, topdown=False):
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


def main():
    print('[1/4] 生成 heroes/ 与 skins/ 分片')
    heroes, skins, parts = build_heroes_and_skins()
    print('[2/4] 复制非皮肤图片')
    imgs, img_bytes = copy_images()
    print('[3/4] 复制元数据')
    meta = copy_meta()
    print('[4/4] 镜像清理残留文件')
    stale = prune()

    print('')
    print('武将 %d 条 / 皮肤图引用 %d 条 / 分片 %d 个' % (heroes, skins, parts))
    print('图片 %d 张 / %.2f MB' % (imgs, img_bytes / 1024 / 1024))
    print('元数据 %d 个文件' % meta)
    print('清理上次同步残留 %d 个文件' % stale)


if __name__ == '__main__':
    main()
