# -*- coding: utf-8 -*-
"""扫描 data-repo 生成 manifest.json（每个文件带 sha256 + bytes）。可重复运行。

用法:
    python tools/build_manifest.py                  # version 用当天日期
    python tools/build_manifest.py 2026.11.10-2    # 同一天多次发布时手动递增
"""
import os
import sys
import json
import hashlib
import datetime
import io

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

OUT = 'H:/AI/sgs-heroes/sgs-flutter/data-repo'
SKIP_DIRS = {'.git', 'tools', '__pycache__'}
SKIP_FILES = {'manifest.json', 'README.md', '.gitignore'}


def sha256(path):
    h = hashlib.sha256()
    with open(path, 'rb') as f:
        for block in iter(lambda: f.read(1 << 20), b''):
            h.update(block)
    return h.hexdigest()


def load(path):
    with open(path, encoding='utf-8') as f:
        return json.load(f)


def count_skins():
    total = 0
    d = OUT + '/skins'
    for name in os.listdir(d):
        if not name.endswith('.json'):
            continue
        doc = load(d + '/' + name)
        for item in doc['data']['items']:
            total += len(item.get('sk') or [])
    return total


def count_images():
    total = 0
    d = OUT + '/images'
    for root, dirs, files in os.walk(d):
        total += len(files)
    return total


def main():
    files = []
    for root, dirs, names in os.walk(OUT):
        dirs[:] = [d for d in dirs if d not in SKIP_DIRS]
        for name in names:
            if name in SKIP_FILES:
                continue
            path = os.path.join(root, name)
            rel = os.path.relpath(path, OUT).replace('\\', '/')
            files.append({
                'path': rel,
                'sha256': sha256(path),
                'bytes': os.path.getsize(path),
            })
    files.sort(key=lambda x: x['path'])

    now = datetime.datetime.now(datetime.timezone(datetime.timedelta(hours=8)))
    version = sys.argv[1] if len(sys.argv) > 1 else now.strftime('%Y.%m.%d')
    heroes = load(OUT + '/heroes/index.json')['data']['total']

    manifest = {
        'schema': 1,
        'version': version,
        'updated_at': now.isoformat(timespec='seconds'),
        'counts': {
            'heroes': heroes,
            'skins': count_skins(),
            'images': count_images(),
            'shell': sum(1 for f in files if not f['path'].startswith(
                ('heroes/', 'skins/', 'meta/', 'history/', 'tools/'))),
            'files': len(files),
        },
        'files': files,
    }

    with open(OUT + '/manifest.json', 'w', encoding='utf-8') as f:
        json.dump(manifest, f, ensure_ascii=False, indent=2)

    total_bytes = sum(x['bytes'] for x in files)
    biggest = max(files, key=lambda x: x['bytes'])
    print('version      : %s' % version)
    print('counts       : %s' % manifest['counts'])
    print('清单文件数   : %d' % len(files))
    print('清单总大小   : %.2f MB' % (total_bytes / 1024 / 1024))
    print('最大单文件   : %s (%.2f MB)' % (biggest['path'], biggest['bytes'] / 1024 / 1024))


if __name__ == '__main__':
    main()
