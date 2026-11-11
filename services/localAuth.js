/* 三国杀速查 —— 本地账号服务 LocalAuthService
 * ---------------------------------------------------------------------------
 * 零依赖的「虚拟本地后端」：以 localStorage 作为持久化介质，
 * 复刻注册 / 登录 / 会话 / 数据检视 / 导入导出 一整套账号能力。
 * 不依赖任何 Node.js 外部服务器，浏览器直接可用（开箱即用）。
 *
 * 存储键：
 *   sgs_local_users      账号表（JSON 数组，见下方 SCHEMA）
 *   sgs_current_session  当前登录会话（JSON 对象）
 *
 * SCHEMA（单个账号）：
 *   {
 *     id: "user_1710000000000",           // 唯一 ID
 *     username: "zhangliao",              // 登录名（唯一，大小写不敏感去重）
 *     password: "l1s:ab12cd34",           // 密码摘要（salted FNV-1a，非明文）
 *     nickname: "张文远",                  // 昵称/雅号，空则同账号名
 *     avatar: "avatar_default.webp",      // 头像（预留位）
 *     createdAt: "2026-09-24 10:00:00",   // 注册时间
 *     updatedAt: "2026-09-24 10:00:00",   // 最近数据变更时间
 *     userData: {
 *       favorites: [{v,id,n,t}],          // 该账号专属收藏武将（跨版本）
 *       history:   [{v,id,n,t}],          // 该账号专属查阅历史
 *       notes:     {},                    // 该账号专属心得战术
 *       settings:  {}                     // 主题/版本等偏好快照
 *     }
 *   }
 *
 * 账号数据隔离：业务数据（收藏/历史/心得）落盘键追加 "@<userId>" 命名空间，
 *   由 scopeKey(base) 解析；游客态用原键，登录态用 "<base>@<userId>"，
 *   因此切换账号后界面自动读取对应账号的数据，绝不串号。
 *
 * 接口一览（全部同步返回，与 Promise 兼容场景可 await）：
 *   register(username, password, nickname) -> {ok, user} | {ok:false, error}
 *   login(username, password)              -> {ok, user} | {ok:false, error}
 *   loginOrCreate(username, opts)          -> {ok, user}（验证码/微信等快捷通道）
 *   logout()                               -> {ok:true}
 *   current() / currentUser()              -> session | null
 *   getAllUsers()                          -> [{...user, stats:{...}}]
 *   getUserData(userId)                    -> userData 副本
 *   syncUserData(userId, userData)         -> {ok:true}
 *   updateUser(id, patch)                  -> {ok, user} | {ok:false, error}
 *   removeUser(id)                         -> {ok:true}
 *   exportData() / downloadData()          -> 备份 JSON（字符串 / 触发下载）
 *   importData(text|obj, {mode})           -> {ok, added, updated, total}
 *   clearAll()                             -> {ok:true}
 *   scopeKey(base)                         -> 数据隔离键名
 *   on(fn) / off(fn)                       -> 订阅 'sgs-auth-change' 事件
 * ---------------------------------------------------------------------------
 */
(function (global) {
  'use strict';

  const USERS_KEY = 'sgs_local_users';
  const SESSION_KEY = 'sgs_current_session';
  const SCOPE_SEP = '@';                       // 命名空间分隔符
  const AVATAR_DEFAULT = 'avatar_default.webp';
  const PWD_MIN = 6;                           // 密码最小长度
  const NAME_MIN = 2;                          // 用户名最小长度
  const FAV_MAX = 60;                          // 收藏 / 历史上限（与业务一致）
  const IMPORT_MODE = 'merge';                 // 默认导入策略：merge | replace

  /* ---------- 基础工具 ---------- */
  function get(k) { try { return global.localStorage.getItem(k); } catch (e) { return null; } }
  function set(k, v) { try { global.localStorage.setItem(k, v); return true; } catch (e) { return false; } }
  function del(k) { try { global.localStorage.removeItem(k); } catch (e) { /* 忽略 */ } }
  function parse(s, fallback) { try { return JSON.parse(s); } catch (e) { return fallback; } }

  function now() {
    const d = new Date();
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ` +
           `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
  }
  function uid() { return 'user_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6); }
  function token() { return 'local_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36); }
  function norm(s) { return String(s == null ? '' : s).trim(); }

  /* 轻量密码摘要：salted FNV-1a（16 进制）。
     说明：这是「不明文落盘」的妥协做法，不是加密算法，仅适用于单机本地场景。 */
  function hash(pwd) {
    const salt = Math.random().toString(36).slice(2, 8);
    let h = 0x811c9dc5;
    const s = salt + '::' + String(pwd);
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
    }
    return 'l1s:' + salt + ':' + h.toString(16).padStart(8, '0');
  }
  function verify(pwd, stored) {
    const parts = String(stored || '').split(':');
    if (parts.length !== 3) return false;
    let h = 0x811c9dc5;
    const s = parts[1] + '::' + String(pwd);
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
    }
    return h.toString(16).padStart(8, '0') === parts[2];
  }

  /* ---------- 账号表读写 ---------- */
  function readUsers() {
    const raw = parse(get(USERS_KEY), null);
    return Array.isArray(raw) ? raw.filter((u) => u && u.username) : [];
  }
  function writeUsers(list) { return set(USERS_KEY, JSON.stringify(list)); }
  function emptyData() { return { favorites: [], history: [], notes: {}, settings: {} }; }
  /* 补齐历史数据缺字段（老数据/手改备份容错） */
  function normalize(u) {
    u.userData = u.userData && typeof u.userData === 'object' ? u.userData : {};
    for (const k of ['favorites', 'history']) {
      if (!Array.isArray(u.userData[k])) u.userData[k] = [];
    }
    if (!u.userData.notes || typeof u.userData.notes !== 'object') u.userData.notes = {};
    if (!u.userData.settings || typeof u.userData.settings !== 'object') u.userData.settings = {};
    if (!u.avatar) u.avatar = AVATAR_DEFAULT;
    if (!u.createdAt) u.createdAt = now();
    return u;
  }
  function findByName(list, username) {
    const key = norm(username).toLowerCase();
    return list.find((u) => String(u.username).toLowerCase() === key) || null;
  }

  /* ---------- 会话 ---------- */
  function writeSession(user) {
    const s = {
      userId: user.id, username: user.username, nickname: user.nickname,
      avatar: user.avatar, token: token(), loginAt: now()
    };
    set(SESSION_KEY, JSON.stringify(s));
    return s;
  }
  function current() {
    const s = parse(get(SESSION_KEY), null);
    if (!s || !s.userId) return null;
    // 账号被删除 / 被清空：会话失效，静默回游客态
    if (!readUsers().some((u) => u.id === s.userId)) { del(SESSION_KEY); return null; }
    return s;
  }
  /* 事件广播：登录态或账号数据变化时通知 UI 重绘 */
  function emit(type, detail) {
    try {
      global.dispatchEvent(new CustomEvent('sgs-auth-change', {
        detail: Object.assign({ type: type }, detail || {})
      }));
    } catch (e) { /* 老浏览器无 CustomEvent：忽略 */ }
  }

  /* ---------- 核心接口 ---------- */
  /** 注册：校验（用户名非空且不重复、密码 ≥6 位）→ 落盘 → 初始化空数据集 */
  function register(username, password, nickname) {
    const name = norm(username);
    const pwd = String(password == null ? '' : password);
    if (!name) return { ok: false, error: '请输入用户名（登录唯一标识）' };
    if (name.length < NAME_MIN) return { ok: false, error: `用户名至少 ${NAME_MIN} 个字` };
    if (/\s/.test(name)) return { ok: false, error: '用户名不能包含空格' };
    if (pwd.length < PWD_MIN) return { ok: false, error: `密码不少于 ${PWD_MIN} 位` };
    const list = readUsers();
    if (findByName(list, name)) return { ok: false, error: '该用户名已被本机注册，请换一个或直接登入' };
    const t = now();
    const user = normalize({
      id: uid(), username: name, password: hash(pwd),
      nickname: norm(nickname) || name, avatar: AVATAR_DEFAULT,
      createdAt: t, updatedAt: t,
      userData: emptyData()
    });
    list.push(user);
    if (!writeUsers(list)) return { ok: false, error: '本地存储写入失败（浏览器可能禁用了 localStorage）' };
    emit('register', { userId: user.id });
    return { ok: true, user: user };
  }

  /** 登入：账号必须已注册，密码必须匹配 */
  function login(username, password) {
    const name = norm(username);
    if (!name) return { ok: false, error: '请输入用户名' };
    const user = findByName(readUsers(), name);
    if (!user) return { ok: false, error: '本机没有这个账号，请先切到「注册」新建' };
    if (!verify(password, user.password)) return { ok: false, error: '密码不正确' };
    const session = writeSession(user);
    emit('login', { userId: user.id });
    return { ok: true, user: user, session: session, data: user.userData };
  }

  /** 快捷登入（验证码 / 微信等演示通道）：无账号则自动建号，保证数据仍按账号隔离 */
  function loginOrCreate(username, opts) {
    const o = opts || {};
    const name = norm(username) || ('guest_' + Math.random().toString(36).slice(2, 8));
    const list = readUsers();
    let user = findByName(list, name);
    if (!user) {
      const t = now();
      user = normalize({
        id: uid(), username: name, password: hash('local_' + Math.random().toString(36).slice(2, 10)),
        nickname: norm(o.nickname) || name, avatar: AVATAR_DEFAULT,
        createdAt: t, updatedAt: t, userData: emptyData()
      });
      list.push(user);
      writeUsers(list);
      emit('register', { userId: user.id });
    }
    const session = writeSession(user);
    emit('login', { userId: user.id });
    return { ok: true, user: user, session: session, data: user.userData };
  }

  function logout() {
    del(SESSION_KEY);
    emit('logout', {});
    return { ok: true };
  }

  function currentUser() {
    const s = current();
    if (!s) return null;
    return findByName(readUsers(), s.username);
  }

  /** 数据检视：全部账号 + 统计（收藏数 / 历史数 / 心得数 / 是否当前登录） */
  function getAllUsers() {
    const s = current();
    return readUsers().map((u) => {
      normalize(u);
      return Object.assign({}, u, {
        password: '••••••',                       // 检视面板不回显凭证
        isCurrent: !!s && s.userId === u.id,
        stats: {
          favorites: u.userData.favorites.length,
          history: u.userData.history.length,
          notes: Object.keys(u.userData.notes || {}).length
        }
      });
    }).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  }

  function getUserData(userId) {
    const u = readUsers().find((x) => x.id === userId);
    return u ? normalize(u).userData : null;
  }

  /** 业务数据回写（收藏/历史/心得/设置），登录态数据变更时调用 */
  function syncUserData(userId, patch) {
    const list = readUsers();
    const u = list.find((x) => x.id === userId);
    if (!u) return { ok: false, error: '账号不存在' };
    normalize(u);
    if (patch) {
      if (Array.isArray(patch.favorites)) u.userData.favorites = patch.favorites.slice(0, FAV_MAX);
      if (Array.isArray(patch.history)) u.userData.history = patch.history.slice(0, FAV_MAX);
      if (patch.notes && typeof patch.notes === 'object') u.userData.notes = patch.notes;
      if (patch.settings && typeof patch.settings === 'object') u.userData.settings = patch.settings;
    }
    u.updatedAt = now();
    writeUsers(list);
    return { ok: true, user: u };
  }

  function updateUser(id, patch) {
    const list = readUsers();
    const u = list.find((x) => x.id === id);
    if (!u) return { ok: false, error: '账号不存在' };
    if (patch && patch.nickname != null) u.nickname = norm(patch.nickname) || u.username;
    if (patch && patch.avatar) u.avatar = patch.avatar;
    if (patch && patch.password) {
      if (String(patch.password).length < PWD_MIN) return { ok: false, error: `密码不少于 ${PWD_MIN} 位` };
      u.password = hash(patch.password);
    }
    u.updatedAt = now();
    writeUsers(list);
    const s = current();
    if (s && s.userId === u.id) set(SESSION_KEY, JSON.stringify(Object.assign({}, s, { nickname: u.nickname })));
    emit('update', { userId: u.id });
    return { ok: true, user: u };
  }

  function removeUser(id) {
    const list = readUsers().filter((u) => u.id !== id);
    writeUsers(list);
    // 连带清掉该账号的隔离命名空间数据
    try {
      const kill = [];
      for (let i = 0; i < global.localStorage.length; i++) {
        const k = global.localStorage.key(i);
        if (k && k.indexOf(SCOPE_SEP + id) > 0) kill.push(k);
      }
      kill.forEach((k) => global.localStorage.removeItem(k));
    } catch (e) { /* 忽略 */ }
    const s = current();
    if (!s) del(SESSION_KEY);
    emit('remove', { userId: id });
    return { ok: true };
  }

  /* ---------- 导入 / 导出 ---------- */
  function buildBackup() {
    return {
      app: 'sgs-heroes', type: 'local-auth-backup', version: 1,
      exportedAt: now(), count: readUsers().length,
      users: readUsers().map((u) => normalize(u))
    };
  }
  function exportData() { return JSON.stringify(buildBackup(), null, 2); }
  function downloadData(filename) {
    const name = filename || 'sgs_backup.json';
    const blob = new global.Blob([exportData()], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = global.document.createElement('a');
    a.href = url; a.download = name;
    global.document.body.appendChild(a);
    a.click();
    global.document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    return { ok: true, filename: name, count: readUsers().length };
  }
  /** 导入：默认 merge（同用户名合并收藏/历史并集，密码以外来为准不覆盖）；replace 则整体替换 */
  function importData(input, opts) {
    const mode = (opts && opts.mode) || IMPORT_MODE;
    let obj = input;
    if (typeof input === 'string') obj = parse(input, null);
    if (!obj) return { ok: false, error: '备份文件不是合法 JSON' };
    const incoming = Array.isArray(obj) ? obj : obj.users;
    if (!Array.isArray(incoming) || !incoming.length) return { ok: false, error: '备份里没有账号数据' };

    let list = mode === 'replace' ? [] : readUsers();
    let added = 0, updated = 0;
    for (const raw of incoming) {
      if (!raw || !raw.username) continue;
      const inc = normalize({
        id: raw.id || uid(),
        username: norm(raw.username),
        password: raw.password || hash('imported_' + Math.random().toString(36).slice(2, 8)),
        nickname: norm(raw.nickname) || norm(raw.username),
        avatar: raw.avatar || AVATAR_DEFAULT,
        createdAt: raw.createdAt || now(),
        updatedAt: now(),
        userData: Object.assign(emptyData(), raw.userData || {})
      });
      const hit = findByName(list, inc.username);
      if (!hit) { list.push(inc); added++; continue; }
      // 合并：收藏/历史按 (v,id) 去重并集，心得外来补齐缺失键
      const key = (f) => f && f.v + '|' + f.id;
      const favKeys = new Set(hit.userData.favorites.map(key));
      inc.userData.favorites.forEach((f) => { if (f && !favKeys.has(key(f))) hit.userData.favorites.push(f); });
      const hisKeys = new Set(hit.userData.history.map(key));
      inc.userData.history.forEach((h) => { if (h && !hisKeys.has(key(h))) hit.userData.history.push(h); });
      Object.keys(inc.userData.notes || {}).forEach((k) => {
        if (!(k in (hit.userData.notes || {}))) hit.userData.notes[k] = inc.userData.notes[k];
      });
      hit.updatedAt = now();
      updated++;
    }
    writeUsers(list);
    emit('import', { added: added, updated: updated });
    return { ok: true, added: added, updated: updated, total: list.length };
  }

  /** 清空重置：删除所有账号与其隔离数据（会话一并失效） */
  function clearAll() {
    const ids = readUsers().map((u) => u.id);
    del(USERS_KEY);
    ids.forEach((id) => {
      try {
        const kill = [];
        for (let i = 0; i < global.localStorage.length; i++) {
          const k = global.localStorage.key(i);
          if (k && k.indexOf(SCOPE_SEP + id) > 0) kill.push(k);
        }
        kill.forEach((k) => global.localStorage.removeItem(k));
      } catch (e) { /* 忽略 */ }
    });
    del(SESSION_KEY);
    emit('clear', {});
    return { ok: true };
  }

  /** 数据隔离键名：游客 <base>；登录 <base>@<userId> */
  function scopeKey(base) {
    const s = current();
    return s ? base + SCOPE_SEP + s.userId : base;
  }

  function on(fn) {
    const h = (e) => fn(e.detail);
    global.addEventListener('sgs-auth-change', h);
    return () => global.removeEventListener('sgs-auth-change', h);
  }

  global.LocalAuthService = {
    USERS_KEY: USERS_KEY, SESSION_KEY: SESSION_KEY, AVATAR_DEFAULT: AVATAR_DEFAULT,
    PWD_MIN: PWD_MIN,
    register: register, login: login, loginOrCreate: loginOrCreate, logout: logout,
    current: current, currentUser: currentUser, getAllUsers: getAllUsers,
    getUserData: getUserData, syncUserData: syncUserData,
    updateUser: updateUser, removeUser: removeUser,
    exportData: exportData, downloadData: downloadData, importData: importData,
    clearAll: clearAll, scopeKey: scopeKey, on: on
  };
})(window);
