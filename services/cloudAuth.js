/* 三国杀速查 —— 云端账号适配层（services/cloudAuth.js）
 * ---------------------------------------------------------------------------
 * 把 localAuth.js 的「本机账号」升级成真正的服务端账号，同时**不破坏离线可用**：
 *
 *   有服务器且连得上 → 注册 / 登录 / 收藏历史同步全走 HTTP
 *   连不上（断网、服务器挂了）→ 自动降级回本机账号，界面照常能用
 *
 * 本机账号表不再是权威源，而是「云端账号的离线镜像」：登录成功后由
 * LocalAuthService.adoptRemote() 把服务端账号和数据写成本机副本，
 * 原页面所有读取（我的页、收藏、历史）继续读本机，一行都不用改。
 *
 * 服务器地址解析顺序（改地址不用重新发版）：
 *   1. localStorage['sgs.api.base']   手动覆盖，可写多个用逗号分隔
 *   2. window.SGS_API_BASE            index.html / 壳注入，同样支持逗号分隔
 *   3. 同源（仅 http/https 且不是 127.0.0.1/localhost）——后端顺带托管页面时零配置
 *   4. 都没有 → 云端关闭，行为与升级前完全一致
 *
 * 多个候选按顺序试，第一个真正应答 /api 的会被记住。这样「家里局域网 IP 变了」
 * 或「桌面端后端就跑在本机」都不至于让登录直接失败。
 *
 * 接口面（与 LocalAuthService 对齐，调用方不用学新东西）：
 *   available() / base()
 *   register(username, password, nickname) -> {ok,user,session,data} | {ok:false,code,error}
 *   login(username, password)              -> 同上
 *   logout() / pull() / push(profile) / profile(patch)
 *
 * 错误 code：disabled | offline | notfound | badpwd | conflict | badrequest
 *            | ratelimited | unauthorized | server
 * ---------------------------------------------------------------------------
 */
(function (global) {
  'use strict';

  const BASE_KEY = 'sgs.api.base';
  const TOKEN_KEY = 'sgs.cloud.token';
  const TIMEOUT = 8000;          // 单次请求超时：手机弱网也不至于卡住登录按钮

  /* ---------- 存储小工具 ---------- */
  function ls(k) { try { return global.localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { global.localStorage.setItem(k, v); return true; } catch (e) { return false; } }
  function lsDel(k) { try { global.localStorage.removeItem(k); } catch (e) { /* 忽略 */ } }
  function trimSlash(s) { return String(s == null ? '' : s).trim().replace(/\/+$/, ''); }

  /* ---------- 地址解析 ---------- */
  function normalizeBase(raw) {
    let s = trimSlash(raw);
    if (!s) return '';
    s = s.replace(/\/api\/v1$/i, '');      // 允许用户直接粘贴带 /api/v1 的地址
    return trimSlash(s);
  }

  function splitList(raw) {
    return String(raw == null ? '' : raw)
      .split(',')
      .map((s) => normalizeBase(s))
      .filter(Boolean);
  }

  /* 候选服务器地址（按顺序尝试，第一个真正应答的会被记住）：
     1. localStorage['sgs.api.base']  手动覆盖，可写多个用逗号分隔
     2. window.SGS_API_BASE           页面/壳注入，同样支持逗号分隔
     3. 同源（仅 http/https 且不是回环）——后端顺带托管页面时零配置 */
  let chosen = '';

  function bases() {
    const manual = splitList(ls(BASE_KEY) || '');
    if (manual.length) return manual;
    const baked = splitList(global.SGS_API_BASE || '');
    if (baked.length) return baked;
    try {
      const loc = global.location;
      if (!loc || !/^https?:$/.test(loc.protocol)) return [];
      const h = String(loc.hostname || '');
      if (!h || h === '127.0.0.1' || h === 'localhost' || h === '::1' || h === '0.0.0.0') return [];
      return [trimSlash(loc.origin)];
    } catch (e) {
      return [];
    }
  }

  function base() {
    const list = bases();
    if (!list.length) return '';
    if (chosen && list.indexOf(chosen) >= 0) return chosen;
    return list[0];
  }

  function available() { return bases().length > 0; }
  function token() { return ls(TOKEN_KEY) || ''; }
  function setBase(url) {
    const list = splitList(url);
    if (list.length) lsSet(BASE_KEY, list.join(','));
    else lsDel(BASE_KEY);
    chosen = '';
    return list.join(',');
  }

  function codeOf(status) {
    switch (status) {
      case 400: return 'badrequest';
      case 401: return 'unauthorized';
      case 403: return 'badpwd';
      case 404: return 'notfound';
      case 409: return 'conflict';
      case 429: return 'ratelimited';
      default: return status >= 500 ? 'server' : 'badrequest';
    }
  }

  /* ---------- 请求 ---------- */
  /* 单次请求。code === 'retry' 表示「这个地址不像是我们的后端」（连不上 / 返回的不是
     JSON / 404 页面），调用方应该换下一个候选；其它 code 都是权威答复，直接采信。 */
  async function request(root, path, opts) {
    let ctl = null;
    let timer = null;
    try {
      if (typeof global.AbortController === 'function') {
        ctl = new global.AbortController();
        timer = setTimeout(() => ctl.abort(), TIMEOUT);
      }
    } catch (e) { ctl = null; }

    const headers = { Accept: 'application/json' };
    if (opts.body) headers['Content-Type'] = 'application/json';
    const t = token();
    if (t && opts.auth !== false) headers.Authorization = 'Bearer ' + t;

    try {
      const res = await global.fetch(root + '/api/v1' + path, {
        method: opts.method || (opts.body ? 'POST' : 'GET'),
        headers: headers,
        body: opts.body ? JSON.stringify(opts.body) : undefined,
        cache: 'no-store',
        signal: ctl ? ctl.signal : undefined
      });
      let data = null;
      try { data = JSON.parse(await res.text()); } catch (e) { data = null; }
      if (!data || typeof data !== 'object') return { ok: false, code: 'retry' };
      if (!res.ok) {
        return {
          ok: false,
          code: codeOf(res.status),
          status: res.status,
          error: data.error || ('服务器返回 ' + res.status)
        };
      }
      if (data.ok === false) {
        return { ok: false, code: 'server', error: data.error || '服务器返回异常' };
      }
      return Object.assign({ ok: true }, data);
    } catch (e) {
      // 断网 / 超时 / 跨域被拒 —— 换下一个候选地址
      return { ok: false, code: 'retry' };
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  async function api(path, opts) {
    opts = opts || {};
    const list = bases();
    if (!list.length) return { ok: false, code: 'disabled', error: '未配置账号服务器' };
    let last = { ok: false, code: 'offline', error: '连不上账号服务器' };
    for (let i = 0; i < list.length; i++) {
      const r = await request(list[i], path, opts);
      if (r.code === 'retry') continue;
      chosen = list[i];          // 记住能用的那个，后续请求直接命中
      return r;
    }
    return last;
  }

  /* ---------- 本机镜像 ---------- */
  /* 把服务端账号写成本机副本，并返回页面用的 session（userId 与云端一致，
     所以收藏/历史的 "<键>@<userId>" 命名空间在各设备间是同一套）。 */
  function adopt(result, password) {
    const S = global.LocalAuthService;
    if (!S || !S.adoptRemote || !result || !result.user) return null;
    const adopted = S.adoptRemote(result.user, result.data, result.session, password);
    if (!adopted) return null;
    if (result.session && result.session.token) lsSet(TOKEN_KEY, result.session.token);
    return adopted.session;
  }

  /* ---------- 在途请求登记 ----------
   * 退出登录时如果还有档案正在上传，先注销会让那次上传 401、刚写的收藏白写。
   * 所以把上传挂在这里，logout 前等它们落地。
   */
  const pending = new Set();
  function track(p) {
    const q = Promise.resolve(p).catch(() => ({ ok: false, code: 'offline' }));
    pending.add(q);
    q.then(() => pending.delete(q));
    return q;
  }

  /* ---------- 对外接口 ---------- */
  async function register(username, password, nickname) {
    const r = await api('/register', {
      body: { username: username, password: password, nickname: nickname },
      auth: false
    });
    if (!r.ok) return r;
    const session = adopt(r, password);
    return { ok: true, user: r.user, session: session, data: r.data, rev: r.rev };
  }

  async function login(username, password) {
    const r = await api('/login', {
      body: { username: username, password: password },
      auth: false
    });
    if (!r.ok) return r;
    const session = adopt(r, password);
    return { ok: true, user: r.user, session: session, data: r.data, rev: r.rev };
  }

  async function logout() {
    // 等正在上传的档案落地，再注销
    if (pending.size) { try { await Promise.all(Array.from(pending)); } catch (e) { /* 忽略 */ } }
    const t = token();
    lsDel(TOKEN_KEY);
    if (!t || !base()) return { ok: true };
    // token 已经清掉，这里手动带上旧 token 去注销
    const root = base();
    try {
      await global.fetch(root + '/api/v1/logout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + t },
        body: '{}',
        cache: 'no-store'
      });
    } catch (e) { /* 断网也无所谓：本地已经登出，服务端 token 到期自动失效 */ }
    return { ok: true };
  }

  /** 拉云端档案（登录后用，或开屏静默合并其它设备的改动） */
  async function pull() {
    const r = await api('/me');
    if (!r.ok) return r;
    const S = global.LocalAuthService;
    if (S && S.adoptRemote) S.adoptRemote(r.user, r.data, null, null);
    return { ok: true, user: r.user, data: r.data, rev: r.rev };
  }

  /** 推本地档案到云端（收藏 / 历史 / 心得 / 设置），服务端做并集合并 */
  function push(profile) {
    return track(api('/data', { body: { data: profile } }).then((r) => {
      if (!r.ok) {
        if (r.code === 'unauthorized') lsDel(TOKEN_KEY);   // token 过期：清掉，等下次登录
        return r;
      }
      return { ok: true, data: r.data, rev: r.rev };
    }));
  }

  /** 改昵称 / 改密码 */
  async function profile(patch) {
    const r = await api('/profile', { body: patch || {} });
    if (r.ok && r.user) {
      const S = global.LocalAuthService;
      if (S && S.adoptRemote) S.adoptRemote(r.user, null, null, patch && patch.password ? patch.password : null);
    }
    return r;
  }

  global.CloudAuth = {
    BASE_KEY: BASE_KEY,
    base: base,
    setBase: setBase,
    available: available,
    token: token,
    register: register,
    login: login,
    logout: logout,
    pull: pull,
    push: push,
    profile: profile
  };
})(typeof window !== 'undefined' ? window : globalThis);
