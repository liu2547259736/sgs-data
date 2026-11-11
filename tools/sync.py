# -*- coding: utf-8 -*-
"""主程序 -> Flutter 代码库 的单向同步入口。

唯一真源：H:/AI/sgs-heroes/sgs-heroes-app/  （本体，所有更新都先发生在这里）
单向流动：本体 -> data-repo / legacy-web / app -> git tag -> jsDelivr -> 多端 App

用法（在 sgs-flutter 目录下）：
    python data-repo/tools/sync.py --check
        只报告本体自上次同步以来改了什么，不写任何文件。
    python data-repo/tools/sync.py
        重建 data-repo 数据 + legacy-web 快照 + manifest + 变更记录，不碰 git。
    python data-repo/tools/sync.py --note "补了 3 个欢杀武将"
    python data-repo/tools/sync.py --commit
        额外给 4 个仓库做本地 commit，并给 data-repo 打 data-v<version> tag。
    python data-repo/tools/sync.py --commit --push
        额外 push（需要各仓库已配置 origin）。
    python data-repo/tools/sync.py --commit --gh <user>/<repo>
        额外验证 jsDelivr 能取到这个 tag 的 manifest.json。
    python data-repo/tools/sync.py --verify-cdn <user>/<repo>
        只验证 CDN 连通性，不扫描本体、不写文件、不碰 git。
    python data-repo/tools/sync.py --allow-shrink
        确实要删武将时放行（默认会拦住「老武将消失 / 武将数减少」）。

设计原则：
  - 只读本体，永远不反向写回。
  - 校验失败直接中止，一个文件都不写。
  - sync-state.json 记录每个武将的内容 hash，能精确报告「这次改了哪几个将」。
  - 所有 git 操作默认关闭，只有显式 --commit 才执行。
"""
import argparse
import datetime
import hashlib
import io
import json
import subprocess
import sys
import urllib.request
from pathlib import Path

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', line_buffering=True)

HERE = Path(__file__).resolve().parent          # data-repo/tools
DATA = HERE.parent                              # data-repo
FLUTTER = DATA.parent                           # sgs-flutter
ROOT = FLUTTER.parent                           # sgs-heroes
APP = ROOT / 'sgs-heroes-app'
TOOLS = HERE
STATE = HERE / 'sync-state.json'
LOG = HERE / 'sync-log.jsonl'
TZ = datetime.timezone(datetime.timedelta(hours=8))

VERSIONS = ['sgsol', 'msgs', 'sgs', 'hlsgs', 'gjf', 'wxmini']
EXCLUDE_DIRS = {'_backups', 'unreleased', '.git', '__pycache__'}
EXCLUDE_IMG_KINDS = {'sk', 'voice'}
REPOS = [
    ('main', APP),
    ('data-repo', DATA),
    ('legacy-web', FLUTTER / 'legacy-web'),
    ('app', FLUTTER / 'app'),
]

# jsDelivr 镜像。2026-11-11 实测：前三个国内直连能取到内容，
# cdn.jsdelivr.net 在本机 TLS 握手失败，保留供其它网络环境兜底。
CDN_HOSTS = [
    'fastly.jsdelivr.net',
    'gcore.jsdelivr.net',
    'testingcf.jsdelivr.net',
    'cdn.jsdelivr.net',
]

# 环境变量 HTTP_PROXY 指向 WorkBuddy 沙箱代理，对 github.com 返回
# "CONNECT tunnel failed 502"；而本机 7890 代理实测稳定（2026-11-11 推送成功）。
# 因此远端 git 命令要绕开沙箱代理：优先探测本地代理，找不到才退回直连。
# 与 setup_github.py 的 effective_proxy() 保持同一套候选，避免两处行为不一致。
PROXY_CANDIDATES = [
    'http://127.0.0.1:7890',
    'http://127.0.0.1:7897',
    'http://127.0.0.1:10809',
    'http://127.0.0.1:1080',
]
_PROXY_CACHE = None


def effective_proxy():
    global _PROXY_CACHE
    if _PROXY_CACHE is not None:
        return _PROXY_CACHE
    for proxy in PROXY_CANDIDATES:
        try:
            opener = urllib.request.build_opener(
                urllib.request.ProxyHandler({'http': proxy, 'https': proxy}))
            with opener.open('https://github.com/', timeout=6) as r:
                if r.status < 400:
                    _PROXY_CACHE = proxy
                    return proxy
        except Exception:
            pass
    _PROXY_CACHE = ''
    return ''


def git_net_args():
    proxy = effective_proxy()
    if proxy:
        return ['-c', 'http.proxy=' + proxy, '-c', 'https.proxy=' + proxy]
    return ['-c', 'http.proxy=', '-c', 'https.proxy=']


def now_iso():
    return datetime.datetime.now(TZ).isoformat(timespec='seconds')


def excluded_file(name):
    return '.bak' in name or name.startswith('_tmp_') or name.endswith('.tmp')


def scan_source():
    """主程序纳入 git 的文件清单：path -> 'size:mtime_ns'。"""
    out = {}
    for p in APP.rglob('*'):
        if not p.is_file():
            continue
        rel = p.relative_to(APP).as_posix()
        parts = rel.split('/')
        if any(d in EXCLUDE_DIRS for d in parts[:-1]):
            continue
        if len(parts) >= 3 and parts[0] == 'images' and parts[2] in EXCLUDE_IMG_KINDS:
            continue
        if excluded_file(parts[-1]):
            continue
        st = p.stat()
        out[rel] = '%d:%d' % (st.st_size, st.st_mtime_ns)
    return out


def hero_hashes():
    """每个武将逐条内容 hash，用于精确报告这次改了哪些将。"""
    out = {}
    for ver in VERSIONS:
        p = APP / 'data' / ver / 'characters.json'
        doc = json.loads(p.read_text(encoding='utf-8'))
        for g in doc.get('generals') or []:
            blob = json.dumps(g, ensure_ascii=False, sort_keys=True,
                              separators=(',', ':'))
            key = ver + '/' + str(g.get('id'))
            out[key] = hashlib.sha256(blob.encode('utf-8')).hexdigest()[:16]
    return out


def diff(before, after):
    added = sorted(set(after) - set(before))
    removed = sorted(set(before) - set(after))
    changed = sorted(k for k in set(before) & set(after) if before[k] != after[k])
    return added, changed, removed


def verify(state, heroes, allow_shrink):
    """发布前断言：版本文件可读、武将数不减少、老武将不消失。"""
    errs = []
    for ver in VERSIONS:
        p = APP / 'data' / ver / 'characters.json'
        if not p.is_file():
            errs.append('缺少 ' + p.as_posix())
            continue
        try:
            doc = json.loads(p.read_text(encoding='utf-8'))
            if not (doc.get('generals') or []):
                errs.append(ver + ' 武将数为 0')
        except Exception as e:
            errs.append(ver + ' JSON 无法解析: ' + str(e))

    old = state.get('heroes') or {}
    if old and not allow_shrink:
        gone = sorted(set(old) - set(heroes))
        if gone:
            errs.append('老武将消失 %d 条（%s ...），确认要删请加 --allow-shrink'
                        % (len(gone), ', '.join(gone[:3])))
        for ver in VERSIONS:
            o = sum(1 for k in old if k.startswith(ver + '/'))
            n = sum(1 for k in heroes if k.startswith(ver + '/'))
            if n < o:
                errs.append('%s 武将数 %d -> %d，减少' % (ver, o, n))
    return errs


def next_version():
    today = datetime.datetime.now(TZ).strftime('%Y.%m.%d')
    mf = DATA / 'manifest.json'
    cur = ''
    if mf.is_file():
        try:
            cur = json.loads(mf.read_text(encoding='utf-8')).get('version', '')
        except Exception:
            pass
    if cur == today:
        return today + '-2'
    if cur.startswith(today + '-'):
        try:
            return today + '-' + str(int(cur.rsplit('-', 1)[1]) + 1)
        except ValueError:
            pass
    return today


def run(script, *args):
    cmd = [sys.executable, str(script)] + [str(x) for x in args]
    print('  $ ' + Path(script).name + ' ' + ' '.join(str(x) for x in args))
    subprocess.run(cmd, check=True)


def git(path, *args, check=True, direct=False):
    cmd = ['git'] + (git_net_args() if direct else []) + list(args)
    return subprocess.run(cmd, cwd=str(path), check=check,
                          capture_output=True, text=True)


def commit_all(version, push):
    tag = 'data-v' + version
    for name, path in REPOS:
        if not (path / '.git').exists():
            subprocess.run(['git', 'init', '-q'], cwd=str(path), check=True)
            print('  %-12s git init' % name)
        if not git(path, 'status', '--porcelain').stdout.strip():
            print('  %-12s 无变更，跳过' % name)
            continue
        git(path, 'add', '-A')
        # 未配置身份时用临时身份，只作用于本次 commit，不改全局配置
        cfg = git(path, 'config', 'user.name', check=False)
        extra = [] if cfg.stdout.strip() else [
            '-c', 'user.name=sgs-sync', '-c', 'user.email=sync@local']
        subprocess.run(['git'] + extra + ['commit', '-q', '-m', 'sync ' + version],
                       cwd=str(path), check=True)
        print('  %-12s committed' % name)
        if name == 'data-repo':
            git(path, 'tag', '-f', tag)
        if push:
            if 'origin' not in git(path, 'remote').stdout.split():
                print('  %-12s 未配置 origin，跳过 push' % name)
                continue
            git(path, 'push', '-q', 'origin', 'HEAD', direct=True)
            if name == 'data-repo':
                git(path, 'push', '-q', 'origin', tag, direct=True)
            print('  %-12s pushed' % name)
    if not git(APP, 'config', 'user.name', check=False).stdout.strip():
        print('  提示：建议配置 git user.name / user.email，本次用了临时提交身份')
    return tag


def verify_cdn(gh, tag, version):
    """逐个试数据源，任一返回匹配版本即算通过。

    用空 ProxyHandler 走直连：沙箱代理对 cdn.jsdelivr.net 和
    raw.githubusercontent.com 会 SSL EOF，而直连实测可用。
    push 完成后 jsDelivr 首次拉取可能要几分钟，失败不抛异常。
    """
    direct = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    urls = ['https://%s/gh/%s@%s/manifest.json' % (h, gh, tag)
            for h in CDN_HOSTS]
    urls.append('https://raw.githubusercontent.com/%s/%s/manifest.json'
                % (gh, tag))
    for url in urls:
        host = url.split('/')[2]
        try:
            with direct.open(url, timeout=12) as r:
                doc = json.loads(r.read().decode('utf-8'))
            got = doc.get('version')
            files = len(doc.get('files') or [])
            ok = got == version
            print('  %-26s version=%s files=%d %s' % (
                host, got, files,
                'OK' if ok else '版本不一致（CDN 可能未刷新）'))
            if ok:
                return True
        except Exception as e:
            print('  %-26s 不可用: %s' % (host, str(e)[:60]))
    print('  全部数据源均未返回匹配版本')
    return False


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--check', action='store_true', help='只看变更，不写文件')
    ap.add_argument('--version', help='手动指定 manifest version')
    ap.add_argument('--note', default='', help='本次同步备注，写进日志')
    ap.add_argument('--commit', action='store_true')
    ap.add_argument('--push', action='store_true')
    ap.add_argument('--gh', default='', help='data-repo 的 GitHub user/repo')
    ap.add_argument('--allow-shrink', action='store_true')
    ap.add_argument('--verify-cdn', default='',
                    help='只验证 CDN 连通性：<user>/<repo>，不写文件、不碰 git')
    a = ap.parse_args()

    if a.verify_cdn:
        st = json.loads(STATE.read_text(encoding='utf-8')) if STATE.is_file() else {}
        ver = st.get('version') or ''
        vtag = 'data-v' + ver if ver else ''
        print('[CDN] 本地当前版本 %s / tag %s' % (ver or '(无)', vtag or '(无)'))
        sys.exit(0 if verify_cdn(a.verify_cdn, vtag, ver) else 1)

    state = json.loads(STATE.read_text(encoding='utf-8')) if STATE.is_file() else {}
    print('[0] 扫描主程序本体 ...')
    src = scan_source()
    heroes = hero_hashes()
    fa, fc, fr = diff(state.get('source') or {}, src)
    ha, hc, hr = diff(state.get('heroes') or {}, heroes)
    print('    纳入文件 %d / 武将 %d' % (len(src), len(heroes)))
    print('    文件变更: 新增 %d / 修改 %d / 删除 %d' % (len(fa), len(fc), len(fr)))
    print('    武将变更: 新增 %d / 修改 %d / 删除 %d' % (len(ha), len(hc), len(hr)))
    for k in (ha + hc + hr)[:12]:
        print('      ' + k)
    if a.check:
        return

    errs = verify(state, heroes, a.allow_shrink)
    if errs:
        print('[!] 校验未通过，已中止（不写任何文件）')
        for e in errs:
            print('    - ' + e)
        sys.exit(1)
    print('[1] 校验通过')

    version = a.version or next_version()
    print('[2] 重建下游（version=%s）' % version)
    run(TOOLS / 'migrate.py')
    run(TOOLS / 'snapshot.py')
    run(TOOLS / 'build_manifest.py', version)

    mf = json.loads((DATA / 'manifest.json').read_text(encoding='utf-8'))
    print('[3] 写同步状态')
    new_state = {
        'last_sync': now_iso(),
        'version': version,
        'source': src,
        'heroes': heroes,
        'counts': mf.get('counts'),
        'manifest_sha256': hashlib.sha256(
            (DATA / 'manifest.json').read_bytes()).hexdigest()[:16],
    }
    STATE.write_text(json.dumps(new_state, ensure_ascii=False,
                                separators=(',', ':')), encoding='utf-8')
    entry = {
        'at': new_state['last_sync'],
        'version': version,
        'note': a.note,
        'counts': mf.get('counts'),
        'files': {'added': len(fa), 'modified': len(fc), 'removed': len(fr)},
        'heroes': {'added': ha, 'modified': hc, 'removed': hr},
    }
    with LOG.open('a', encoding='utf-8') as f:
        f.write(json.dumps(entry, ensure_ascii=False,
                           separators=(',', ':')) + chr(10))
    print('    sync-state.json / sync-log.jsonl 已更新')

    if a.commit:
        print('[4] 同步 git')
        tag = commit_all(version, a.push)
        if a.gh:
            print('[5] 验证 CDN')
            verify_cdn(a.gh, tag, version)
    print('完成: version=%s  武将=%s' % (
        version, (mf.get('counts') or {}).get('heroes')))


if __name__ == '__main__':
    main()
