# -*- coding: utf-8 -*-
"""自动同步内核：本体 -> data-repo / legacy-web / app -> git -> jsDelivr。

三种触发方式共用这一个入口，靠同一把锁互斥，绝不会并发推送：

    一键同步.bat          python auto_sync.py --once
    每日定时（任务计划）   pythonw auto_sync.py --once
    目录监听（常驻）       pythonw auto_sync.py --watch

其它子命令：
    --force       忽略变更检测，强制重建并发布一次
    --stop        停掉正在运行的 --watch 监听
    --status      查看监听状态与最近日志
    --dry         只报告「会不会同步」，不写文件、不碰 git

设计原则：
  - 默认「有变更才推」：没改动时直接退出，不产生空 commit / 空 tag。
  - 变更判定复用 sync.py --check 的口径（本体文件 + 武将），
    额外补上四个仓库自身的未提交内容（新脚本、新配置也要能发布）。
  - 只读本体，永远不反向写回；真正写盘/推送全部交给 sync.py。
  - 任何失败只写日志、不抛到桌面，监听进程继续活着等下一次。
"""
import argparse
import datetime
import hashlib
import os
import re
import signal
import subprocess
import sys
import time
from pathlib import Path

# pythonw.exe 下 sys.stdout 是 None，不能无脑包装。
if sys.stdout is not None and hasattr(sys.stdout, 'reconfigure'):
    try:
        sys.stdout.reconfigure(encoding='utf-8', errors='replace', line_buffering=True)
    except (ValueError, OSError):
        pass

HERE = Path(__file__).resolve().parent          # data-repo/tools
DATA = HERE.parent                              # data-repo
FLUTTER = DATA.parent                           # sgs-flutter
APP = FLUTTER.parent / 'sgs-heroes-app'         # 唯一真源
SYNC = HERE / 'sync.py'
SKIN_SYNC = FLUTTER / 'skins-repo' / 'tools' / 'sync.py'  # 皮肤独立仓、独立 tag
LOGDIR = FLUTTER / 'logs'                       # 根目录，不属于任何 git 仓库
LOG = LOGDIR / 'auto-sync.log'
LOCK = LOGDIR / 'auto-sync.lock'
PID = LOGDIR / 'auto-sync.pid'

GH = 'liu2547259736/sgs-data'
REPOS = [
    ('main', APP),
    ('data-repo', DATA),
    ('legacy-web', FLUTTER / 'legacy-web'),
    ('app', FLUTTER / 'app'),
]

# 与 sync.py::scan_source() 的排除口径对齐。
# 语音（1621 MB / 26556 个）永不入 git，监听也剪掉；
# 皮肤 sk/ 纳入指纹（改图能被监听到），但发布走独立仓 sgs-skins、独立 tag，
# 不进数据仓库版本号，也不因皮肤仓有未提交就触发数据仓库打新 tag。
EXCLUDE_DIRS = {'_backups', 'unreleased', '.git', '__pycache__'}
EXCLUDE_IMG_KINDS = {'voice'}

POLL = 15        # 监听轮询间隔（秒）
QUIET = 30       # 文件停止变化多久后开始同步（防抖）
MAX_WAIT = 180   # 持续编辑时最多压多久，超时强制同步一次
SYNC_TIMEOUT = 1800   # 首次推 200MB 的 app 仓可能较慢
SKIN_TIMEOUT = 3600   # 皮肤仓首次 706MB / 12901 文件，留足时间


def log(msg):
    line = '[%s] %s' % (datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S'), msg)
    try:
        print(line, flush=True)
    except Exception:
        pass
    try:
        LOGDIR.mkdir(parents=True, exist_ok=True)
        # 超过 2MB 只留后半段，避免常驻进程把日志写爆。
        if LOG.exists() and LOG.stat().st_size > 2 * 1024 * 1024:
            LOG.write_bytes(LOG.read_bytes()[-512 * 1024:])
        with LOG.open('a', encoding='utf-8') as f:
            f.write(line + '\n')
    except Exception:
        pass


def child_env():
    """清掉宿主注入的沙箱代理。

    sync.py 自己会探测本机 7890 代理，并用 `git -c http.proxy=...`
    显式下发给远端 git 命令；verify_cdn 则走空 ProxyHandler 直连。
    这里全删只是防止沙箱代理抢在前面把 github.com 劫持掉。
    """
    env = os.environ.copy()
    for key in ('HTTP_PROXY', 'HTTPS_PROXY', 'http_proxy', 'https_proxy',
                'ALL_PROXY', 'all_proxy'):
        env.pop(key, None)
    return env


def run(args, cwd=None, timeout=None):
    return subprocess.run(
        [str(a) for a in args], cwd=str(cwd or FLUTTER),
        capture_output=True, text=True, encoding='utf-8', errors='replace',
        timeout=timeout, env=child_env(),
    )


def acquire_lock():
    """Windows 文件锁：只在真正执行同步期间持有，watch 循环不持锁。

    这样监听常驻时，手动 / 定时触发依然能各跑各的（后来者会看到
    「已有同步在跑」并跳过，不会并发 push）。
    """
    import msvcrt
    LOGDIR.mkdir(parents=True, exist_ok=True)
    fh = open(LOCK, 'a+b')
    try:
        fh.seek(0)
        msvcrt.locking(fh.fileno(), msvcrt.LK_NBLCK, 1)
    except OSError:
        fh.close()
        return None
    try:
        fh.seek(0)
        fh.truncate()
        fh.write(str(os.getpid()).encode('ascii'))
        fh.flush()
    except OSError:
        pass
    return fh


def release_lock(fh):
    if fh is None:
        return
    import msvcrt
    try:
        fh.seek(0)
        msvcrt.locking(fh.fileno(), msvcrt.LK_UNLCK, 1)
    except OSError:
        pass
    try:
        fh.close()
    except OSError:
        pass


def detect_changes():
    """返回 (原因列表, 错误)。复用 sync.py --check 的判定口径。"""
    reasons = []
    try:
        r = run([sys.executable, SYNC, '--check'], timeout=300)
    except subprocess.TimeoutExpired:
        return [], 'sync.py --check 超时（300s）'
    if r.returncode != 0:
        tail = ((r.stderr or '') + (r.stdout or '')).strip()[-600:]
        return [], 'sync.py --check 失败: ' + tail

    out = r.stdout or ''
    m = re.search(r'文件变更: 新增 (\d+) / 修改 (\d+) / 删除 (\d+)', out)
    if m and sum(int(x) for x in m.groups()):
        reasons.append('本体文件 新增/修改/删除 = %s' % '/'.join(m.groups()))
    m = re.search(r'武将变更: 新增 (\d+) / 修改 (\d+) / 删除 (\d+)', out)
    if m and sum(int(x) for x in m.groups()):
        reasons.append('武将 新增/修改/删除 = %s' % '/'.join(m.groups()))

    for name, path in REPOS:
        if not (path / '.git').exists():
            continue
        g = subprocess.run(
            ['git', 'status', '--porcelain'], cwd=str(path),
            capture_output=True, text=True, encoding='utf-8', errors='replace',
        )
        lines = [ln for ln in (g.stdout or '').splitlines() if ln.strip()]
        if lines:
            reasons.append('%s 仓有 %d 项未提交' % (name, len(lines)))

    # 皮肤独立仓：单独判定。注意不要把它加进 REPOS，否则皮肤仓有未提交
    # 会误触发数据仓库打新 tag。
    if SKIN_SYNC.is_file():
        try:
            rs = run([sys.executable, SKIN_SYNC, '--check'], timeout=300)
        except subprocess.TimeoutExpired:
            log('皮肤 --check 超时（忽略，不阻塞数据同步）')
        else:
            if rs.returncode == 0 and 'CHANGED' in (rs.stdout or ''):
                reasons.append('皮肤资源变更（独立仓 sgs-skins）')
            elif rs.returncode != 0:
                log('皮肤 --check 失败（忽略）：%s'
                    % (rs.stderr or '').strip()[-200:])
    return reasons, None


def sync_once(source, force=False, dry=False):
    """跑一次完整同步。

    返回 True=发布了新版本 / None=正常跳过 / False=失败（任务计划据此报错）。
    """
    fh = acquire_lock()
    if fh is None:
        log('已有同步正在执行，本次跳过（来源 %s）' % source)
        return None
    try:
        if force:
            reasons = ['手动强制发布']
        else:
            reasons, err = detect_changes()
            if err:
                log('变更检测失败：%s' % err)
                return False
            if not reasons:
                log('无变更，跳过（来源 %s）' % source)
                return None
        log('检测到变更 → %s' % '；'.join(reasons))
        if dry:
            log('--dry：只检测，不执行同步')
            return None

        # 数据与皮肤是两条独立发布线：各自仓库、各自 tag、各自版本，
        # 只是共用这一把锁和一次触发，避免并发推送。
        skin_changed = any('皮肤资源变更' in r for r in reasons)
        data_reasons = [r for r in reasons if '皮肤资源变更' not in r]
        published = False

        if force or data_reasons:
            note = ('auto/%s: %s' % (source, '; '.join(data_reasons)))[:200]
            cmd = [sys.executable, SYNC, '--commit', '--push', '--gh', GH,
                   '--note', note]
            log('开始同步：$ sync.py --commit --push --gh %s' % GH)
            try:
                r = run(cmd, timeout=SYNC_TIMEOUT)
            except subprocess.TimeoutExpired:
                log('同步超时（%ds），请查看日志排查' % SYNC_TIMEOUT)
                return False
            for line in (r.stdout or '').splitlines():
                if line.strip():
                    log('  | ' + line.rstrip())
            if r.returncode != 0:
                log('同步失败（exit %d）：%s' % (
                    r.returncode, (r.stderr or '').strip()[-600:]))
                return False
            published = True
            log('数据同步完成 OK（来源 %s）' % source)

        if (force or skin_changed) and SKIN_SYNC.is_file():
            cmd = [sys.executable, SKIN_SYNC, '--commit', '--push', '--tag',
                   '--note', 'auto/%s: 皮肤资源变更' % source]
            log('开始皮肤同步：$ skins-repo/tools/sync.py --commit --push --tag')
            try:
                r = run(cmd, timeout=SKIN_TIMEOUT)
            except subprocess.TimeoutExpired:
                log('皮肤同步超时（%ds）' % SKIN_TIMEOUT)
                return False
            for line in (r.stdout or '').splitlines():
                if line.strip():
                    log('  | ' + line.rstrip())
            if r.returncode != 0:
                log('皮肤同步失败（exit %d）：%s' % (
                    r.returncode, (r.stderr or '').strip()[-600:]))
                return False
            published = True
            log('皮肤同步完成 OK（独立仓 sgs-skins，不绑定数据版本）')

        if not published:
            log('无实际发布动作（来源 %s）' % source)
            return None
        return True
    finally:
        release_lock(fh)


def fingerprint():
    """主程序纳入范围内的轻量指纹：路径 + size + mtime_ns。

    不读文件内容、不解析 characters.json，15 秒一次开销很低；
    用 os.walk 在目录层剪掉 .git / _backups / images/*/voice。
    皮肤 sk/ 纳入指纹（这样改图能被监听到），但发布时走独立仓、不进数据 tag。
    精确判定仍交给两个 sync.py --check。
    """
    h = hashlib.sha256()
    count = 0
    for root, dirs, files in os.walk(str(APP)):
        dirs[:] = sorted(d for d in dirs if d not in EXCLUDE_DIRS)
        relroot = os.path.relpath(root, str(APP)).replace('\\', '/')
        parts = [] if relroot == '.' else relroot.split('/')
        if len(parts) >= 2 and parts[0] == 'images':
            dirs[:] = [d for d in dirs if d not in EXCLUDE_IMG_KINDS]
        for name in sorted(files):
            if '.bak' in name or name.startswith('_tmp_') or name.endswith('.tmp'):
                continue
            rel = '/'.join(parts + [name])
            try:
                st = os.stat(os.path.join(root, name))
            except OSError:
                continue
            h.update(rel.encode('utf-8', 'replace'))
            h.update(('|%d:%d|' % (st.st_size, st.st_mtime_ns)).encode('ascii'))
            count += 1
    return h.hexdigest(), count


def pid_alive(pid):
    """Windows 上 os.kill(pid, 0) 会真的 TerminateProcess，绝不能拿它探活。

    这里只 OpenProcess 拿一个查询句柄，随即关闭，不碰目标进程。
    """
    try:
        import ctypes
        from ctypes import wintypes
        k = ctypes.WinDLL('kernel32', use_last_error=True)
        k.OpenProcess.argtypes = (wintypes.DWORD, wintypes.BOOL, wintypes.DWORD)
        k.OpenProcess.restype = wintypes.HANDLE
        handle = k.OpenProcess(0x1000, False, int(pid))  # QUERY_LIMITED_INFORMATION
        if not handle:
            return False
        k.CloseHandle.argtypes = (wintypes.HANDLE,)
        k.CloseHandle(handle)
        return True
    except Exception:
        return False


def watch():
    """常驻监听：文件变了 → 防抖 → 同步。"""
    if watch_already_running():
        return
    LOGDIR.mkdir(parents=True, exist_ok=True)
    PID.write_text(str(os.getpid()), encoding='ascii')
    base, count = fingerprint()
    log('监听启动 pid=%d，纳入 %d 个文件，轮询 %ds / 防抖 %ds' % (
        os.getpid(), count, POLL, QUIET))
    last_seen = base
    dirty_since = None
    while True:
        time.sleep(POLL)
        try:
            fp, n = fingerprint()
            now = time.time()
            if fp != base:
                if dirty_since is None:
                    dirty_since = now
                    log('检测到本体变化（%d 个文件），等待安静期…' % n)
                quiet_ok = (fp == last_seen)
                waited = now - dirty_since
                if (quiet_ok and waited >= QUIET) or waited >= MAX_WAIT:
                    log('安静 %ds，触发同步' % int(waited))
                    sync_once('watch')
                    # 同步会重建下游，但绝不写本体；重取指纹作为新基线。
                    base, _ = fingerprint()
                    last_seen = base
                    dirty_since = None
                else:
                    last_seen = fp
            else:
                if dirty_since is not None:
                    log('本体已回到上次同步状态，取消待同步')
                dirty_since = None
                last_seen = fp
        except Exception as e:
            log('监听循环异常（继续运行）：%s' % e)
            time.sleep(POLL)


def watch_already_running():
    """watch 启动时的单实例检查：PID 文件 + 进程存活判断。"""
    if not PID.exists():
        return False
    try:
        old = int(PID.read_text(encoding='ascii').strip())
    except (ValueError, OSError):
        return False
    if pid_alive(old):
        log('监听已在运行（pid=%d），本次不重复启动' % old)
        return True
    return False


def stop_watch():
    if not PID.exists():
        log('没有正在运行的监听')
        return
    try:
        old = int(PID.read_text(encoding='ascii').strip())
        os.kill(old, signal.SIGTERM)
        log('已停止监听 pid=%d' % old)
    except (ValueError, OSError) as e:
        log('停止失败（可能已退出）：%s' % e)
    try:
        PID.unlink()
    except OSError:
        pass


def _say(text):
    """输出被 `| head` 之类的管道提前关闭时，Windows 会抛 OSError 22。"""
    try:
        print(text, flush=True)
    except (OSError, ValueError):
        pass


def status():
    alive = False
    pid = ''
    if PID.exists():
        pid = PID.read_text(encoding='ascii').strip()
        try:
            alive = pid_alive(int(pid))
        except ValueError:
            pass
    _say('监听状态 : %s %s' % (
        '运行中' if alive else '未运行', ('pid=' + pid) if alive else ''))
    _say('日志文件 : %s' % LOG)
    if LOG.exists():
        _say('--- 最近 15 行 ---')
        lines = LOG.read_text(encoding='utf-8', errors='replace').splitlines()
        for line in lines[-15:]:
            _say(line)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--once', action='store_true', help='跑一次（有变更才推）')
    ap.add_argument('--watch', action='store_true', help='常驻监听本体目录')
    ap.add_argument('--force', action='store_true', help='忽略变更检测强制发布一次')
    ap.add_argument('--dry', action='store_true', help='只检测，不写文件不碰 git')
    ap.add_argument('--stop', action='store_true', help='停止监听')
    ap.add_argument('--status', action='store_true', help='查看状态')
    a = ap.parse_args()

    if a.status:
        status()
        return
    if a.stop:
        stop_watch()
        return
    if a.watch:
        watch()
        return
    ok = sync_once('once' if not a.force else 'force',
                   force=a.force, dry=a.dry)
    # True=已发布 / None=无变更跳过，都算正常；只有 False 才是失败。
    sys.exit(1 if ok is False else 0)


if __name__ == '__main__':
    main()
