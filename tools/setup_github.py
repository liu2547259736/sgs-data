# -*- coding: utf-8 -*-
"""一键打通 GitHub + jsDelivr 数据链路。

前置：环境变量 GITHUB_TOKEN（Personal Access Token，classic 需 repo 权限，
      fine-grained 需目标仓库的 Contents 读写权限）。token 只通过 git 的
      http.extraHeader 在进程内传递，不写进 .git/config 或任何文件。

用法（在 sgs-flutter 目录下）：
    python data-repo/tools/setup_github.py --repo <user>/<repo> --dry-run
        只体检：API 连通性、token、仓库存在性、本地待推内容。不写任何东西。
    python data-repo/tools/setup_github.py --repo <user>/<repo> --create
        仓库不存在时自动创建（必须 public，jsDelivr 读不了私有仓库）。
    python data-repo/tools/setup_github.py --repo <user>/<repo> --create --all
        额外给另外三个仓库配 remote 并推送（注意：主程序与网页快照含官方
        原画，公开分发前请自行确认版权风险）。

默认只处理 data-repo —— 它是唯一需要经 CDN 分发的仓库。

本脚本解决三个实测踩过的坑：
  1. 沙箱注入的 HTTP_PROXY 对 github.com 返回 CONNECT 502；所有远端 git
     命令显式清空代理走直连（实测 3/3 成功）。
  2. 首次推送 148 MB / 8000+ 文件容易 RPC failed；调大 http.postBuffer
     并固定 HTTP/1.1。
  3. cdn.jsdelivr.net 在本机 TLS 握手失败；验证改用 fastly/gcore/testingcf。
"""
import argparse
import io
import json
import os
import re
import subprocess
import sys
import urllib.error
import urllib.request
from pathlib import Path

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', line_buffering=True)

HERE = Path(__file__).resolve().parent          # data-repo/tools
DATA = HERE.parent                              # data-repo
FLUTTER = DATA.parent                           # sgs-flutter
ROOT = FLUTTER.parent                           # sgs-heroes
STATE = HERE / 'sync-state.json'
ENV_DART = FLUTTER / 'app' / 'lib' / 'core' / 'env.dart'

REPOS = [
    ('main', ROOT / 'sgs-heroes-app'),
    ('data-repo', DATA),
    ('legacy-web', FLUTTER / 'legacy-web'),
    ('app', FLUTTER / 'app'),
]
CDN_HOSTS = [
    'fastly.jsdelivr.net',
    'gcore.jsdelivr.net',
    'testingcf.jsdelivr.net',
    'cdn.jsdelivr.net',
]
# 沙箱代理会劫持这些请求，统一走直连 opener
OPENER = urllib.request.build_opener(urllib.request.ProxyHandler({}))
NO_PROXY_GIT = ['-c', 'http.proxy=', '-c', 'https.proxy=']


def git(path, *args, token=None, check=True):
    cmd = ['git'] + NO_PROXY_GIT
    if token:
        cmd += ['-c', 'http.extraheader=AUTHORIZATION: bearer ' + token]
    cmd += list(args)
    return subprocess.run(cmd, cwd=str(path), check=check,
                          capture_output=True, text=True)


def api(method, path, token=None, body=None, timeout=20):
    headers = {
        'Accept': 'application/vnd.github+json',
        'User-Agent': 'sgs-sync/1.0',
        'X-GitHub-Api-Version': '2022-11-28',
    }
    if token:
        headers['Authorization'] = 'Bearer ' + token
    if body is not None:
        headers['Content-Type'] = 'application/json'
    req = urllib.request.Request(
        'https://api.github.com' + path,
        data=json.dumps(body).encode('utf-8') if body is not None else None,
        headers=headers, method=method)
    try:
        with OPENER.open(req, timeout=timeout) as r:
            raw = r.read().decode('utf-8')
            return r.status, (json.loads(raw) if raw.strip() else {})
    except urllib.error.HTTPError as e:
        raw = e.read().decode('utf-8')
        try:
            return e.code, json.loads(raw)
        except Exception:
            return e.code, {'message': raw[:200]}


def current_version():
    if not STATE.is_file():
        return ''
    return (json.loads(STATE.read_text(encoding='utf-8')).get('version') or '')


def repo_exists(owner, name, token):
    code, doc = api('GET', '/repos/%s/%s' % (owner, name), token)
    if code == 200:
        return True, doc
    if code == 404:
        return False, {}
    return None, doc


def create_repo(name, token):
    code, doc = api('POST', '/user/repos', token, {
        'name': name,
        'description': 'Sanguosha Heroes Atlas - data repository (CDN source)',
        'private': False,          # jsDelivr 无法读取私有仓库
        'has_issues': False,
        'has_wiki': False,
        'has_projects': False,
    })
    return code, doc


def set_remote(path, url, dry):
    if dry:
        return
    existing = git(path, 'remote', check=False).stdout.split()
    if 'origin' in existing:
        git(path, 'remote', 'set-url', 'origin', url)
    else:
        git(path, 'remote', 'add', 'origin', url)


def push_repo(path, tag, token, dry, is_data):
    if dry:
        print('    [dry-run] 跳过 push')
        return
    # 首次推送 148 MB / 8000+ 文件，避免 RPC failed 与 HTTP/2 流重置
    git(path, 'config', 'http.postBuffer', '524288000')
    git(path, 'config', 'http.version', 'HTTP/1.1')
    print('    push HEAD ...')
    p = git(path, 'push', '-u', 'origin', 'HEAD', '--progress',
            token=token, check=False)
    if p.returncode:
        print('    push 失败: ' + (p.stderr or p.stdout).strip()[-400:])
        raise SystemExit(2)
    if is_data and tag:
        print('    push tag %s ...' % tag)
        git(path, 'push', 'origin', tag, '--progress', token=token)
    print('    pushed')


def verify_cdn(gh, tag, version):
    urls = ['https://%s/gh/%s@%s/manifest.json' % (h, gh, tag)
            for h in CDN_HOSTS]
    urls.append('https://raw.githubusercontent.com/%s/%s/manifest.json'
                % (gh, tag))
    for url in urls:
        host = url.split('/')[2]
        try:
            with OPENER.open(url, timeout=12) as r:
                doc = json.loads(r.read().decode('utf-8'))
            got = doc.get('version')
            ok = got == version
            print('    %-26s version=%s files=%d %s' % (
                host, got, len(doc.get('files') or []),
                'OK' if ok else '版本不一致（CDN 可能未刷新）'))
            if ok:
                return True
        except Exception as e:
            print('    %-26s 不可用: %s' % (host, str(e)[:60]))
    return False


def write_env(repo, dry):
    if not ENV_DART.is_file():
        print('  [!] 找不到 env.dart，跳过回写: %s' % ENV_DART)
        return
    src = ENV_DART.read_text(encoding='utf-8')
    new, hits = re.subn(
        r"static const String githubRepo = '[^']*';",
        "static const String githubRepo = '%s';" % repo, src, count=1)
    if hits != 1:
        print('  [!] env.dart 里 githubRepo 格式不符，未修改')
        return
    if dry:
        print('  [dry-run] 将回写 env.dart: githubRepo = %r' % repo)
        return
    if new != src:
        ENV_DART.write_text(new, encoding='utf-8', newline='\n')
        print('  env.dart 已回写 githubRepo = %r' % repo)
    else:
        print('  env.dart 已是 %r，无需修改' % repo)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--repo', default=os.environ.get('GITHUB_REPO', ''),
                    help='data-repo 的 GitHub <user>/<repo>')
    ap.add_argument('--create', action='store_true', help='仓库不存在时自动创建')
    ap.add_argument('--all', action='store_true',
                    help='给四个仓库都配 remote 并推送（默认只 data-repo）')
    ap.add_argument('--dry-run', action='store_true', help='只体检，不写任何东西')
    ap.add_argument('--skip-env', action='store_true', help='不回写 env.dart')
    a = ap.parse_args()

    if '/' not in a.repo:
        print('请用 --repo <user>/<repo> 指定数据仓库，例如 --repo asuna/sgs-data')
        raise SystemExit(2)
    owner, name = a.repo.split('/', 1)
    token = os.environ.get('GITHUB_TOKEN', '').strip()
    dry = a.dry_run
    version = current_version()
    tag = 'data-v' + version if version else ''

    print('=== GitHub CDN 链路体检 ===')
    print('  目标仓库 : %s' % a.repo)
    print('  本地版本 : %s / tag %s' % (version or '(无)', tag or '(无)'))
    print('  token    : %s' % ('已提供' if token else '未提供（真实操作需要）'))
    print('  模式     : %s' % ('dry-run（不写任何文件）' if dry else '执行'))

    print('[1] API 连通性')
    code, doc = api('GET', '/rate_limit', token, timeout=12)
    print('    GET /rate_limit -> %s  remaining=%s' % (
        code, (doc.get('resources') or {}).get('core', {}).get('remaining', '?')))
    if code != 200:
        print('    [!] api.github.com 不可达，后续无法继续')
        raise SystemExit(2)

    if token:
        code, me = api('GET', '/user', token)
        if code == 200:
            print('    身份: %s（%s）' % (me.get('login'), me.get('type')))
            if (me.get('login') or '').lower() != owner.lower():
                print('    [!] token 属于 %s，但 --repo 写的是 %s；'
                      '组织仓库请确认权限' % (me.get('login'), owner))
        else:
            print('    [!] token 校验失败: %s %s' % (code, doc.get('message', '')))

    print('[2] 仓库存在性')
    exists, info = repo_exists(owner, name, token)
    if exists is True:
        print('    已存在  private=%s  default_branch=%s' % (
            info.get('private'), info.get('default_branch')))
        if info.get('private'):
            print('    [!] 私有仓库 jsDelivr 读不到，请改为 public')
    elif exists is False:
        print('    不存在')
        if a.create and token and not dry:
            code, doc = create_repo(name, token)
            if code in (201, 202):
                print('    已创建 public 仓库')
                exists = True
            else:
                print('    [!] 创建失败: %s %s' % (code, doc.get('message')))
        elif not a.create:
            print('    加 --create 可自动创建')
    else:
        print('    [!] 查询失败: %s' % info.get('message'))

    print('[3] 配置 remote 并推送')
    targets = REPOS if a.all else [('data-repo', DATA)]
    for rname, path in targets:
        if rname == 'data-repo':
            url = 'https://github.com/%s.git' % a.repo
        else:
            url = 'https://github.com/%s/%s-%s.git' % (owner, name, rname)
        cur = git(path, 'remote', 'get-url', 'origin', check=False).stdout.strip()
        print('  %-12s origin: %s -> %s' % (rname, cur or '(无)', url))
        if not dry:
            set_remote(path, url, dry)
            # 主程序和网页快照体积大，--all 之外不强推
            push_repo(path, tag, token, dry, rname == 'data-repo')

    if not a.skip_env:
        print('[4] 回写 Flutter 配置')
        write_env(a.repo, dry)

    print('[5] 验证 CDN')
    if dry:
        print('    [dry-run] 跳过（需先真实推送）')
        return
    ok = verify_cdn(a.repo, tag, version)
    print('    CDN 验证: %s' % ('通过' if ok else '未通过（首次推送后可能需等几分钟）'))
    if not ok:
        print('    可稍后单独重跑: python data-repo/tools/sync.py --verify-cdn %s'
              % a.repo)


if __name__ == '__main__':
    main()
