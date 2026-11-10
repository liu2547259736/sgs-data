# -*- coding: utf-8 -*-
"""把主程序非皮肤内容复制成 legacy-web 原样快照。只读源目录，绝不删源文件。

用法: python tools/snapshot.py
排除: images/*/sk/、images/*/voice/、*_backups/、data/unreleased/、.bak-*、_tmp_*、*.tmp
语义: 镜像同步 —— 源里删掉的文件，目标里也会清掉（绝不碰 .git 与源文件）
"""
import os
import sys
import shutil
import io

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

ROOT = 'H:/AI/sgs-heroes'
APP = ROOT + '/sgs-heroes-app'
OUT = ROOT + '/sgs-flutter/legacy-web'

EXCLUDE_DIRS = {'_backups', 'unreleased', '.git', '__pycache__'}
EXCLUDE_IMG_KINDS = {'sk', 'voice'}


def excluded_file(name):
    return '.bak' in name or name.startswith('_tmp_') or name.endswith('.tmp')


def main():
    n = 0
    total = 0
    kept = set()
    for root, dirs, names in os.walk(APP):
        rel = os.path.relpath(root, APP).replace(os.sep, '/')
        parts = [] if rel == '.' else rel.split('/')

        kept_dirs = []
        for d in dirs:
            if d in EXCLUDE_DIRS:
                continue
            if len(parts) == 2 and parts[0] == 'images' and d in EXCLUDE_IMG_KINDS:
                continue
            kept_dirs.append(d)
        dirs[:] = kept_dirs

        dst_dir = OUT if rel == '.' else OUT + '/' + rel
        os.makedirs(dst_dir, exist_ok=True)

        for name in names:
            if excluded_file(name):
                continue
            sp = os.path.join(root, name)
            if not os.path.isfile(sp):
                continue
            dp = dst_dir + '/' + name
            shutil.copy2(sp, dp)
            kept.add(os.path.relpath(dp, OUT).replace(os.sep, '/'))
            n += 1
            total += os.path.getsize(dp)

    gitignore = (
        '.git/' + chr(10)
        + '__pycache__/' + chr(10)
        + '*.tmp' + chr(10)
        + '*.bak' + chr(10)
        + '*.bak-*' + chr(10)
        + 'images/*/sk/' + chr(10)
        + 'images/*/voice/' + chr(10)
        + '_backups/' + chr(10)
    )
    with open(OUT + '/.gitignore', 'w', encoding='utf-8') as f:
        f.write(gitignore)
    kept.add('.gitignore')

    stale = 0
    for root, dirs, names in os.walk(OUT):
        dirs[:] = [d for d in dirs if d not in ('.git', '__pycache__')]
        for name in names:
            p = os.path.join(root, name)
            rel = os.path.relpath(p, OUT).replace(os.sep, '/')
            if rel in kept:
                continue
            os.remove(p)
            stale += 1

    print('复制 %d 个文件 / %.2f MB' % (n, total / 1024 / 1024))
    print('镜像清理 %d 个残留文件' % stale)
    print('目标: %s' % OUT)


if __name__ == '__main__':
    main()
