'use strict';
// LinkMe management console. Plain browser JavaScript served by the server
// itself (no build step). Every request goes to /api/* on this listener with
// the X-LinkMe-Console header; the session is an HttpOnly cookie.

const $ = (s, root = document) => root.querySelector(s);
const $$ = (s, root = document) => [...root.querySelectorAll(s)];
const app = $('#app');
// The console runs either at / on its own port or at /admin/ on the website;
// every request is relative to wherever this page was loaded from.
const API = location.pathname.replace(/[^/]*$/, '') + 'api';
const state = { me: null, overview: null, settings: null, draft: null, dirty: false, section: 'network', users: { q: '', status: 'all', offset: 0 } };

// ---------- helpers ----------
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad = n => String(n).padStart(2, '0');
function fmtTime(ms) { if (!ms) return '—'; const d = new Date(ms); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`; }
function relTime(ms) {
  if (!ms) return '从未';
  const s = Math.max(0, (Date.now() - ms) / 1000);
  if (s < 60) return '刚刚'; if (s < 3600) return Math.floor(s / 60) + ' 分钟前'; if (s < 86400) return Math.floor(s / 3600) + ' 小时前';
  if (s < 86400 * 30) return Math.floor(s / 86400) + ' 天前'; return fmtTime(ms).slice(0, 10);
}
function fmtBytes(n) {
  n = Number(n) || 0; if (n < 1024) return n + ' B';
  const u = ['KB', 'MB', 'GB', 'TB']; let i = -1; do { n /= 1024; i++ } while (n >= 1024 && i < u.length - 1);
  return (n >= 100 ? n.toFixed(0) : n.toFixed(1)) + ' ' + u[i];
}
const fmtNum = n => Number(n || 0).toLocaleString('zh-CN');
function avatarColor(id) { let h = 0; for (const c of String(id)) h = (h * 31 + c.charCodeAt(0)) % 360; return `hsl(${h} 55% 52%)`; }
function avatar(user, large) {
  const el = `<span class="avatar${large ? ' large' : ''}" data-color="${esc(avatarColor(user.id))}">${esc((user.name || '?').trim().slice(0, 1))}</span>`;
  return el;
}
// CSP forbids style attributes in markup; colour avatars after rendering.
function paintAvatars(root = document) { for (const a of $$('.avatar[data-color]', root)) { a.style.background = a.dataset.color; a.removeAttribute('data-color'); } }
const genderNames = { '': '未填写', male: '男', female: '女', other: '其他' };

const icons = {
  home: '<path d="M3 11.5 12 4l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.8-3.6 3.5-5.5 6.5-5.5s5.7 1.9 6.5 5.5"/><path d="M16 4.6a3.5 3.5 0 0 1 0 6.8M18 14.8c1.9.7 3.2 2.4 3.5 5.2"/>',
  shield: '<path d="M12 3 4.5 6v5.5c0 4.5 3.2 8.4 7.5 9.5 4.3-1.1 7.5-5 7.5-9.5V6z"/><path d="m9 12 2 2 4-4"/>',
  sliders: '<path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/>',
  key: '<circle cx="8" cy="15" r="4"/><path d="m11 12 9-9M17 6l3 3M14 9l2 2"/>',
  box: '<path d="M21 8 12 3 3 8v8l9 5 9-5z"/><path d="m3 8 9 5 9-5M12 13v8"/>',
  spark: '<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z"/>',
  image: '<rect x="3.5" y="4.5" width="17" height="15" rx="2.5"/><circle cx="9" cy="10" r="1.8"/><path d="m20.5 16-5-5-8 8"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01"/>',
  logout: '<path d="M15 4h4a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-4M10 16l-4-4 4-4M6 12h11"/>',
  lock: '<rect x="4.5" y="10.5" width="15" height="10" rx="2"/><path d="M8 10.5V7a4 4 0 0 1 8 0v3.5"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  back: '<path d="m15 18-6-6 6-6"/>',
  refresh: '<path d="M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7"/>',
  upload: '<path d="M12 16V4M7 9l5-5 5 5M4 20h16"/>',
  windows: '<path d="M3 5.5 10 4.5v7H3zM11.5 4.3 21 3v8.5h-9.5zM3 12.5h7v7L3 18.5zM11.5 12.5H21V21l-9.5-1.3z"/>',
  android: '<path d="M6 10h12v7a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1zM8 18v2.5M16 18v2.5M4 11v4M20 11v4M7.5 9a4.5 4.5 0 0 1 9 0M8.5 5 7 3M15.5 5 17 3"/>',
  apple: '<path d="M16.5 12.5c0-2.4 2-3.3 2-3.3-1.1-1.6-2.8-1.8-3.4-1.8-1.4-.1-2.8.9-3.5.9s-1.8-.8-3-.8C6.9 7.5 5 9 5 12c0 4 2.9 8.5 4.5 8.5 1 0 1.5-.7 2.8-.7s1.6.7 2.8.7C17 20.5 19 17 19 16.5c0 0-2.5-1-2.5-4zM14.5 5.5c.6-.8 1-1.8.9-2.8-.9 0-2 .6-2.6 1.4-.6.7-1 1.7-.9 2.7 1 .1 2-.5 2.6-1.3z"/>',
};
const icon = name => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name] || ''}</svg>`;

function toast(message, error) {
  const t = document.createElement('div'); t.className = 'toast' + (error ? ' error' : ''); t.textContent = message;
  $('#toasts').append(t); setTimeout(() => t.remove(), error ? 5000 : 2600);
}

class ApiError extends Error { constructor(message, status) { super(message); this.status = status; } }
async function api(path, { method = 'GET', body, raw } = {}) {
  const opts = { method, headers: { 'X-LinkMe-Console': '1' }, credentials: 'same-origin' };
  if (body !== undefined) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
  let res;
  try { res = await fetch(API + path, opts); } catch { throw new ApiError('无法连接服务器，请检查网络或服务是否在运行', 0); }
  const data = raw ? null : await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401 && path !== '/login') { state.me = null; renderLogin('登录已过期，请重新登录'); }
    throw new ApiError((data && data.error) || '请求失败（' + res.status + '）', res.status);
  }
  return data;
}
// Wrap an async click handler: disable the button while it runs, toast errors.
async function busy(button, fn) {
  if (button) button.disabled = true;
  try { return await fn(); } catch (e) { if (e.status !== 401) toast(e.message, true); } finally { if (button && button.isConnected) button.disabled = false; }
}

// ---------- modal ----------
function modal({ title, body, actions = [], wide }) {
  return new Promise(resolve => {
    const root = $('#modal-root');
    root.innerHTML = `<div class="modal-back"><div class="modal${wide ? ' wide' : ''}" role="dialog" aria-modal="true" aria-label="${esc(title)}"><header><h3>${esc(title)}</h3><button class="btn ghost small" data-close aria-label="关闭">✕</button></header><div class="body">${body}</div><div class="form-error" id="modal-error"></div><footer>${actions.map((a, i) => `<button class="btn ${a.kind || ''}" data-action="${i}">${esc(a.label)}</button>`).join('')}</footer></div></div>`;
    paintAvatars(root);
    const close = value => { root.innerHTML = ''; document.removeEventListener('keydown', onKey); resolve(value); };
    const onKey = e => { if (e.key === 'Escape') close(null); };
    document.addEventListener('keydown', onKey);
    $('[data-close]', root).onclick = () => close(null);
    $('.modal-back', root).addEventListener('mousedown', e => { if (e.target.classList.contains('modal-back')) close(null); });
    $$('[data-action]', root).forEach(b => b.onclick = async () => {
      const a = actions[+b.dataset.action];
      if (!a.run) return close(a.value ?? null);
      $('#modal-error').textContent = '';
      b.disabled = true;
      try { const v = await a.run($('.modal', root)); if (v !== false) close(v ?? true); }
      catch (e) { $('#modal-error').textContent = e.message; }
      finally { if (b.isConnected) b.disabled = false; }
    });
    const first = $('input,select,textarea', root); if (first) first.focus();
  });
}
const confirmModal = (title, text, label = '确认', kind = 'primary') => modal({ title, body: `<p>${text}</p>`, actions: [{ label: '取消' }, { label, kind, value: true }] });
function showCredentials(title, rows, note) {
  return modal({
    title,
    body: `<div class="credential">${rows.map(([k, v]) => `<div><span>${esc(k)}</span><code>${esc(v)}</code></div>`).join('')}</div><p class="help">${esc(note || '密码只显示这一次，请复制后安全地交给对方，并提醒对方登录后修改。')}</p>`,
    actions: [{ label: '复制全部', run: async () => { await copy(rows.map(([k, v]) => k + '：' + v).join('\n')); toast('已复制'); return false; } }, { label: '完成', kind: 'primary' }],
  });
}
async function copy(text) {
  try { await navigator.clipboard.writeText(text); }
  catch { const t = document.createElement('textarea'); t.value = text; document.body.append(t); t.select(); document.execCommand('copy'); t.remove(); }
}

// ---------- login ----------
function renderLogin(message) {
  app.innerHTML = `<div class="login"><div class="login-card"><div class="brand">${brandMark()}<div><b>${esc(brand.name)} 管理后台</b><span>用户与系统管理</span></div></div>
  <form id="login-form" autocomplete="on"><label class="field">用户名<input type="text" name="username" autocomplete="username" required></label>
  <label class="field">密码<input type="password" name="password" autocomplete="current-password" required></label>
  <div class="form-error">${esc(message || '')}</div><button class="btn primary" type="submit">登录</button></form>
  <p class="help">后台账号与应用账号相互独立。忘记密码时，可在服务器上运行：<br><code>linkme-server -config 配置文件 -console-admin 用户名 -console-password-file 密码文件</code></p></div></div>`;
  $('#login-form').onsubmit = async e => {
    e.preventDefault();
    const f = e.target, button = $('button', f), error = $('.form-error', f);
    button.disabled = true; error.textContent = '';
    try { await api('/login', { method: 'POST', body: { username: f.username.value, password: f.password.value } }); await start(); }
    catch (err) { error.textContent = err.message; button.disabled = false; }
  };
  $('input', app).focus();
}

// ---------- shell and routing ----------
const pages = [
  ['overview', '概览', 'home'], ['users', '用户管理', 'users'], ['admins', '后台管理员', 'shield'],
  ['settings', '系统设置', 'sliders'], ['brand', '品牌与图标', 'image'], ['ai', 'AI 模型', 'spark'], ['aidex', 'linkme-AIdex', 'box'], ['credentials', '凭据与密钥', 'key'], ['packages', '客户端安装包', 'box'], ['audit', '操作日志', 'list'],
];
function shell() {
  if ($('.shell')) return;
  app.innerHTML = `<div class="shell"><aside class="side"><div class="brand">${brandMark()}<div><b>${esc(brand.name)}</b><span>管理后台</span></div></div>
   ${pages.map(([id, label, ic]) => `<button class="nav" data-nav="${id}">${icon(ic)}<span>${label}</span></button>`).join('')}
   <div class="side-foot"><div class="side-user">当前登录<b>${esc(state.me.username)}</b></div>
   <button class="nav" data-act="password">${icon('lock')}<span>修改密码</span></button><button class="nav" data-act="logout">${icon('logout')}<span>退出登录</span></button></div></aside>
   <div><div class="topbar"><button class="btn ghost small" data-act="menu" aria-label="菜单">${icon('menu')}</button><b>${esc(brand.name)} 管理后台</b></div><main class="main" id="main"></main></div></div>`;
  app.addEventListener('click', e => {
    const nav = e.target.closest('[data-nav]');
    if (nav) { if (!leaveSettings()) return; const target = '#/' + nav.dataset.nav; if (location.hash === target) route(); else location.hash = target; $('.shell').classList.remove('menu-open'); return; }
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'menu') $('.shell').classList.toggle('menu-open');
    if (act === 'logout') busy(null, async () => { await api('/logout', { method: 'POST' }); state.me = null; renderLogin(); });
    if (act === 'password') changeOwnPassword();
  });
}
function leaveSettings() { return !state.dirty || confirm('系统设置有未保存的修改，确定离开？'); }
window.addEventListener('beforeunload', e => { if (state.dirty) { e.preventDefault(); e.returnValue = ''; } });
function route() {
  if (!state.me) return;
  shell();
  const [page = 'overview', id] = location.hash.replace(/^#\/?/, '').split('/');
  if (page !== 'settings') state.dirty = false;
  $$('.nav[data-nav]').forEach(n => n.classList.toggle('active', n.dataset.nav === page || (page === 'user' && n.dataset.nav === 'users')));
  const main = $('#main');
  main.onclick = main.onchange = null;
  main.innerHTML = '<div class="loading"><div class="spinner"></div></div>';
  const views = { overview, users, user: () => userDetail(id), admins, settings, brand: branding, ai: aiModel, aidex: aidexPage, credentials, packages, audit };
  (views[page] || overview)().catch(e => { if (e.status !== 401) main.innerHTML = `<div class="card card-body empty">${esc(e.message)}</div>`; });
  window.scrollTo(0, 0);
}
window.addEventListener('hashchange', route);
function head(title, sub, actions = '') { return `<div class="page-head"><div><h1>${esc(title)}</h1>${sub ? `<p>${sub}</p>` : ''}</div><div class="spacer"></div>${actions}</div>`; }
function restartBanner(pending) {
  if (!pending) return '';
  return `<div class="banner"><div><b>设置已保存，重启服务后生效。</b> ${state.me.supervised ? '' : '当前服务不是由系统服务启动的，请在服务器上手动重启。'}</div><div class="spacer"></div>${state.me.supervised ? `<button class="btn primary small" data-restart>立即重启服务</button>` : ''}</div>`;
}
document.addEventListener('click', e => { const b = e.target.closest('[data-restart]'); if (b) restart(b); });

async function restart(button) {
  const ok = await confirmModal('重启服务', '重启期间（通常几秒）所有用户会短暂断线，客户端会自动重连。确定现在重启？', '重启', 'primary');
  if (!ok) return;
  await busy(button, async () => {
    const before = (await api('/overview')).started;
    await api('/restart', { method: 'POST' });
    const overlay = document.createElement('div'); overlay.className = 'overlay';
    overlay.innerHTML = '<div><div class="spinner"></div><b>正在重启服务…</b><small id="restart-note">请稍候</small></div>'; document.body.append(overlay);
    const deadline = Date.now() + 90000;
    while (Date.now() < deadline) {
      await new Promise(r => setTimeout(r, 1500));
      try { const o = await api('/overview'); if (o.started !== before) { overlay.remove(); toast('服务已重启，新设置已生效'); route(); return; } } catch { }
    }
    overlay.remove();
    toast('服务没有在 90 秒内恢复，请登录服务器检查日志', true);
  });
}

// ---------- overview ----------
async function overview() {
  const o = await api('/overview'); state.overview = o;
  const c = o.counts;
  const stat = (label, value, sub) => `<div class="card stat"><span>${label}</span><b>${value}</b>${sub ? `<small>${sub}</small>` : ''}</div>`;
  const feature = (on, label) => `<span class="badge ${on ? 'ok' : ''}">${on ? '已启用' : '未启用'} · ${label}</span>`;
  const uptime = (() => { const s = (Date.now() - o.started) / 1000; const d = Math.floor(s / 86400), h = Math.floor(s % 86400 / 3600), m = Math.floor(s % 3600 / 60); return (d ? d + ' 天 ' : '') + (h ? h + ' 小时 ' : '') + m + ' 分钟'; })();
  $('#main').innerHTML = head('概览', 'LinkMe ' + esc(o.version) + ' · 已运行 ' + uptime, `<button class="btn" data-refresh>${icon('refresh')}刷新</button>`) + restartBanner(o.restartPending) +
    `<div class="stack"><div class="stats">
      ${stat('用户总数', fmtNum(c.users), fmtNum(c.disabled) + ' 个已停用')}${stat('当前在线', fmtNum(c.online), fmtNum(c.sessions) + ' 个有效登录')}
      ${stat('群聊', fmtNum(c.groups), '进行中会议 ' + fmtNum(c.meetings))}${stat('消息总数', fmtNum(c.messages), '网盘占用 ' + fmtBytes(c.driveBytes))}
    </div>
    <div class="grid two">
     <div class="card"><div class="card-head"><div><h2>存储</h2><p>数据目录和文件存储盘的剩余空间</p></div></div><div class="card-body stack">
      <div><div class="row"><b>数据目录</b><span class="spacer"></span><span class="help">剩余 ${fmtBytes(o.dataFree)}</span></div><div class="path">${esc(o.dataDir)}</div></div>
      ${o.volumes.map(v => `<div><div class="row"><b>${v.id === 'primary' ? '主存储盘' : '附加存储盘 ' + esc(v.id)}</b>${v.ready ? '<span class="badge ok">可用</span>' : `<span class="badge danger">不可用</span>`}<span class="spacer"></span><span class="help">剩余 ${fmtBytes(v.free)}</span></div><div class="path">${esc(v.root)}</div>${v.error ? `<div class="help">${esc(v.error)}</div>` : ''}</div>`).join('')}
     </div></div>
     <div class="card"><div class="card-head"><div><h2>服务</h2><p>地址、端口与已启用的功能</p></div></div><div class="card-body stack">
      <dl class="kv"><dt>API 地址</dt><dd>${esc(o.publicURL)}</dd><dt>下载页</dt><dd><a href="${esc(o.downloadURL)}" target="_blank" rel="noopener">${esc(o.downloadURL)}</a></dd>
      <dt>监听</dt><dd>API ${esc(o.listen)} · 下载 ${esc(o.downloadListen || '未开放')} · 后台 ${esc(o.consoleListen)}</dd><dt>配置文件</dt><dd class="path">${esc(o.configPath || '未使用配置文件')}</dd>
      <dt>进程管理</dt><dd>${o.supervised ? '由系统服务托管，可在后台重启' : '手动运行（后台无法自动重启）'}</dd></dl>
      <div class="row">${feature(o.registration, '自助注册')}${feature(o.emailAuth, '邮箱登录')}${feature(o.media, '媒体中继')}${feature(o.ai, 'Me 助手')}</div>
     </div></div>
    </div></div>`;
  $('[data-refresh]').onclick = route;
}

// ---------- users ----------
function userRow(u) {
  const status = u.disabled ? '<span class="badge danger">已停用</span>' : '<span class="badge ok">正常</span>';
  return `<tr class="clickable" data-user="${esc(u.id)}"><td><div class="person">${avatar(u)}<div><b>${esc(u.name)}${u.ai ? ' <span class="badge accent">助手</span>' : ''}</b><small>${esc(u.number)}</small></div></div></td>
   <td class="hide-sm">${esc(u.email || '—')}</td><td class="hide-sm">${esc(u.jobTitle || '—')}</td>
   <td><div class="row">${status}<span class="dot${u.online ? ' on' : ''}" title="${u.online ? '在线' : '离线'}"></span></div></td>
   <td class="hide-sm">${u.sessions}</td><td class="hide-sm">${relTime(u.lastSeen)}</td><td class="hide-sm">${fmtBytes(u.driveUsed)}</td></tr>`;
}
async function users() {
  const f = state.users;
  $('#main').innerHTML = head('用户管理', '新建账号、修改资料、重置密码、停用或删除账号，所有操作都会记入操作日志。', `<button class="btn primary" data-create-user>${icon('plus')}新建用户</button>`) +
   `<div class="card"><div class="toolbar"><input type="search" id="user-search" placeholder="搜索姓名、号码、邮箱、手机或职位" value="${esc(f.q)}">
    <div class="tabs" id="user-status">${[['all', '全部'], ['active', '正常'], ['disabled', '已停用']].map(([k, l]) => `<button data-status="${k}" class="${f.status === k ? 'active' : ''}">${l}</button>`).join('')}</div></div>
    <div class="table-wrap"><table><thead><tr><th>用户</th><th class="hide-sm">邮箱</th><th class="hide-sm">职位</th><th>状态</th><th class="hide-sm">登录设备</th><th class="hide-sm">最近活动</th><th class="hide-sm">网盘</th></tr></thead><tbody id="user-rows"></tbody></table></div>
    <div class="pager" id="user-pager"></div></div>`;
  let timer;
  $('#user-search').oninput = e => { clearTimeout(timer); timer = setTimeout(() => { f.q = e.target.value.trim(); f.offset = 0; loadUsers(); }, 250); };
  $('#user-status').onclick = e => { const b = e.target.closest('[data-status]'); if (!b) return; f.status = b.dataset.status; f.offset = 0; $$('#user-status button').forEach(x => x.classList.toggle('active', x === b)); loadUsers(); };
  $('[data-create-user]').onclick = createUser;
  $('#user-rows').onclick = e => { const r = e.target.closest('[data-user]'); if (r) location.hash = '#/user/' + r.dataset.user; };
  await loadUsers();
}
async function loadUsers() {
  const f = state.users;
  const q = new URLSearchParams({ q: f.q, status: f.status, offset: f.offset });
  const res = await api('/users?' + q);
  const rows = $('#user-rows'); if (!rows) return;
  rows.innerHTML = res.items.map(userRow).join('') || `<tr><td colspan="7" class="empty">${f.q ? '没有匹配的用户' : '还没有用户，点击右上角“新建用户”'}</td></tr>`;
  paintAvatars(rows);
  const end = Math.min(res.offset + res.items.length, res.total);
  $('#user-pager').innerHTML = `<span>共 ${fmtNum(res.total)} 人${res.total ? `，显示 ${res.offset + 1}–${end}` : ''}</span><span class="spacer"></span>
   <button class="btn small" data-page="-1" ${res.offset <= 0 ? 'disabled' : ''}>上一页</button><button class="btn small" data-page="1" ${end >= res.total ? 'disabled' : ''}>下一页</button>`;
  $('#user-pager').onclick = e => { const b = e.target.closest('[data-page]'); if (!b) return; f.offset = Math.max(0, f.offset + 50 * +b.dataset.page); loadUsers(); };
}
function profileFields(v = {}, { create } = {}) {
  const emailRequired = state.overview?.emailAuth;
  return `<div class="fields">
   <label class="field">姓名 *<input type="text" name="name" maxlength="32" required value="${esc(v.name)}"></label>
   <label class="field">邮箱${emailRequired ? ' *' : ''}<input type="email" name="email" maxlength="120" value="${esc(v.email)}" ${emailRequired ? 'required' : ''}><small>${emailRequired ? '已启用邮箱登录，员工用此邮箱登录' : '可选；启用邮箱登录后作为登录名'}</small></label>
   <label class="field">手机号<input type="text" name="phone" maxlength="32" value="${esc(v.phone)}"></label>
   <label class="field">性别<select name="gender">${Object.entries(genderNames).map(([k, l]) => `<option value="${k}" ${v.gender === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
   <label class="field wide">职位<input type="text" name="jobTitle" maxlength="64" value="${esc(v.jobTitle)}"></label>
   ${create ? `<label class="field wide">初始密码<input type="text" name="password" maxlength="72" placeholder="留空自动生成安全密码" autocomplete="off"><small>8–72 个字符；建议留空自动生成</small></label>` : `<label class="field wide">个性签名<textarea name="bio" maxlength="150" rows="2">${esc(v.bio)}</textarea></label>`}
  </div>`;
}
function formValues(form, names) { const out = {}; for (const n of names) { const el = form.elements[n]; if (el) out[n] = el.value.trim(); } return out; }
async function createUser() {
  if (!state.overview) state.overview = await api('/overview').catch(() => null);
  const result = await modal({
    title: '新建用户', body: `<form id="create-form">${profileFields({}, { create: true })}</form>`,
    actions: [{ label: '取消' }, {
      label: '创建', kind: 'primary', run: async m => {
        const form = $('#create-form', m); if (!form.reportValidity()) return false;
        const v = formValues(form, ['name', 'email', 'phone', 'gender', 'jobTitle', 'password']);
        return api('/users', { method: 'POST', body: v });
      }
    }],
  });
  if (!result) return;
  const rows = [['姓名', result.user.name], ['LinkMe 号', result.user.number]];
  if (result.initialPassword) rows.push(['初始密码', result.initialPassword]);
  await showCredentials('账号已创建', rows, result.initialPassword ? undefined : '员工可用 LinkMe 号（或邮箱）和你设置的密码登录。');
  if (location.hash.startsWith('#/users')) loadUsers(); else location.hash = '#/users';
}

async function userDetail(id) {
  const d = await api('/users/' + encodeURIComponent(id));
  const u = d.user, s = d.stats, quota = d.driveQuota || 1, pct = Math.min(100, u.driveUsed / quota * 100);
  const mini = (label, value) => `<div class="mini"><span>${label}</span><b>${value}</b></div>`;
  $('#main').innerHTML = `<button class="back" data-back>${icon('back')}返回用户列表</button>
  <div class="card card-body" id="user-head"><div class="profile-head">${avatar(u, true)}<div><h1>${esc(u.name)}</h1>
   <div class="meta"><span>LinkMe 号 ${esc(u.number)}</span>${u.email ? `<span>· ${esc(u.email)}</span>` : ''}<span>· 创建于 ${fmtTime(u.created)}</span></div></div><span class="spacer"></span>
   <div class="row">${u.disabled ? `<span class="badge danger">已停用${u.reason ? '：' + esc(u.reason) : ''}</span>` : '<span class="badge ok">正常</span>'}<span class="badge ${u.online ? 'ok' : ''}"><span class="dot${u.online ? ' on' : ''}"></span>${u.online ? '在线' : '离线'}</span>${u.ai ? '<span class="badge accent">Me 助手</span>' : ''}</div></div></div>
  <div class="detail" id="user-detail">
   <div class="stack">
    <div class="card"><div class="card-head"><div><h2>基本资料</h2><p>修改后员工的客户端会立即更新</p></div></div><div class="card-body"><form id="profile-form">${profileFields({ ...u, bio: d.bio, gender: d.gender })}</form></div>
     <div class="save-bar"><span>LinkMe 号不可修改</span><span class="spacer"></span><button class="btn primary" data-save-profile>保存资料</button></div></div>
    <div class="card"><div class="card-head"><div><h2>登录设备</h2><p>${d.devices.length ? d.devices.length + ' 台设备当前处于登录状态' : '当前没有登录的设备'}</p></div><span class="spacer"></span>${d.devices.length ? '<button class="btn small" data-signout-all>全部下线</button>' : ''}</div>
     <div class="card-body">${d.devices.map(x => `<div class="device"><div><b>${esc(x.device || '未知设备')}</b><small>登录于 ${fmtTime(x.created)} · 最近活动 ${relTime(x.lastSeen)}</small></div><button class="btn small" data-revoke="${esc(x.id)}">下线</button></div>`).join('') || '<div class="empty">—</div>'}</div></div>
   </div>
   <div class="stack">
    <div class="card"><div class="card-head"><h2>使用情况</h2></div><div class="card-body stack">
     <div class="minis">${mini('好友', fmtNum(s.friends))}${mini('参与的群', fmtNum(s.groups))}${mini('创建的群', fmtNum(s.ownedGroups))}${mini('发送消息', fmtNum(s.messages))}${mini('网盘文件', fmtNum(s.driveFiles))}${mini('聊天附件', fmtBytes(s.attachmentBytes))}</div>
     <div><div class="row"><b>网盘空间</b><span class="spacer"></span><span class="help">${fmtBytes(u.driveUsed)} / ${fmtBytes(quota)}</span></div><div class="meter${pct > 90 ? ' low' : ''}"><i id="drive-meter"></i></div></div>
    </div></div>
    <div class="card"><div class="card-head"><h2>账号安全</h2></div><div class="card-body">
     <div class="action-line"><div><b>重置密码</b><small>设置新密码或自动生成；该账号所有设备会被下线</small></div><button class="btn" data-reset-password>重置密码</button></div>
     <div class="action-line"><div><b>${u.disabled ? '启用账号' : '停用账号'}</b><small>${u.disabled ? '恢复后员工可以重新登录' : '停用后立即下线，且无法再登录；数据保留'}</small></div>${u.disabled ? '<button class="btn primary" data-enable>启用账号</button>' : '<button class="btn danger" data-disable>停用账号</button>'}</div>
    </div></div>
    <div class="card danger-zone"><div class="card-head"><h2>危险操作</h2></div><div class="card-body">
     <div class="action-line"><div><b>重置头像</b><small>恢复为系统分配的卡通头像</small></div><button class="btn" data-reset-avatar>重置头像</button></div>
     <div class="action-line"><div><b>删除账号</b><small>删除网盘、个人空间和好友关系；聊天记录保留并显示为“已注销用户”。不可恢复。</small></div><button class="btn danger solid" data-delete-user ${u.ai ? 'disabled' : ''}>删除账号</button></div>
    </div></div>
   </div>
  </div>`;
  paintAvatars($('#main'));
  $('#drive-meter').style.width = pct + '%';
  const main = $('#main'), path = '/users/' + encodeURIComponent(id);
  $('[data-back]').onclick = () => { location.hash = '#/users'; };
  $('[data-save-profile]').onclick = e => busy(e.currentTarget, async () => {
    const form = $('#profile-form'); if (!form.reportValidity()) return;
    await api(path, { method: 'PATCH', body: formValues(form, ['name', 'email', 'phone', 'gender', 'jobTitle', 'bio']) });
    toast('资料已保存'); userDetail(id);
  });
  main.onclick = e => {
    const t = e.target.closest('button'); if (!t) return;
    if (t.dataset.revoke) busy(t, async () => { await api(path + '/sessions/' + encodeURIComponent(t.dataset.revoke), { method: 'DELETE' }); toast('该设备已下线'); userDetail(id); });
    else if (t.hasAttribute('data-signout-all')) busy(t, async () => { if (!await confirmModal('全部下线', `确定让 ${esc(u.name)} 的所有设备退出登录？`)) return; const r = await api(path + '/signout', { method: 'POST' }); toast(`已下线 ${r.signedOut} 台设备`); userDetail(id); });
    else if (t.hasAttribute('data-reset-password')) resetUserPassword(u, path);
    else if (t.hasAttribute('data-disable')) disableUser(u, path);
    else if (t.hasAttribute('data-enable')) busy(t, async () => { await api(path + '/status', { method: 'POST', body: { disabled: false } }); toast('账号已启用'); userDetail(id); });
    else if (t.hasAttribute('data-reset-avatar')) busy(t, async () => { if (!await confirmModal('重置头像', '恢复为系统分配的卡通头像？')) return; await api(path + '/avatar', { method: 'DELETE' }); toast('头像已重置'); });
    else if (t.hasAttribute('data-delete-user')) deleteUser(u, path);
  };
}
async function resetUserPassword(u, path) {
  const r = await modal({
    title: '重置密码', body: `<p>为 <b>${esc(u.name)}</b>（${esc(u.number)}）设置新密码。该账号的所有设备会被下线。</p><label class="field">新密码<input type="text" id="new-password" maxlength="72" placeholder="留空自动生成安全密码" autocomplete="off"><small>8–72 个字符</small></label>`,
    actions: [{ label: '取消' }, { label: '重置', kind: 'primary', run: m => api(path + '/password', { method: 'POST', body: { password: $('#new-password', m).value } }) }],
  });
  if (!r) return;
  if (r.password) await showCredentials('密码已重置', [['姓名', u.name], ['LinkMe 号', u.number], ['新密码', r.password]]);
  else toast(`密码已重置，已下线 ${r.signedOut} 台设备`);
  userDetail(u.id);
}
async function disableUser(u, path) {
  const r = await modal({
    title: '停用账号', body: `<p>停用后 <b>${esc(u.name)}</b> 会立即下线，且无法再登录。聊天记录、网盘等数据会保留，可随时重新启用。</p><label class="field">停用原因（可选，仅后台可见）<input type="text" id="disable-reason" maxlength="120" placeholder="例如：离职、账号异常"></label>`,
    actions: [{ label: '取消' }, { label: '停用', kind: 'danger solid', run: m => api(path + '/status', { method: 'POST', body: { disabled: true, reason: $('#disable-reason', m).value } }) }],
  });
  if (r) { toast('账号已停用'); userDetail(u.id); }
}
async function deleteUser(u, path) {
  const r = await modal({
    title: '删除账号', body: `<p>将永久删除 <b>${esc(u.name)}</b> 的网盘文件、个人空间、好友关系和登录状态。聊天记录会保留，显示为“已注销用户”。<b>此操作不可恢复。</b></p><label class="field">请输入该账号的 LinkMe 号 <b>${esc(u.number)}</b> 确认<input type="text" id="confirm-number" inputmode="numeric" autocomplete="off"></label>`,
    actions: [{ label: '取消' }, { label: '永久删除', kind: 'danger solid', run: m => api(path, { method: 'DELETE', body: { confirmNumber: $('#confirm-number', m).value.trim() } }) }],
  });
  if (r) { toast('账号已删除'); location.hash = '#/users'; }
}

// ---------- console administrators ----------
async function admins() {
  const list = await api('/admins');
  $('#main').innerHTML = head('后台管理员', '可以登录本后台的账号，与应用里的员工账号相互独立。', `<button class="btn primary" data-create-admin>${icon('plus')}添加管理员</button>`) +
   `<div class="card"><div class="table-wrap"><table><thead><tr><th>用户名</th><th>状态</th><th class="hide-sm">创建时间</th><th class="hide-sm">最近登录</th><th></th></tr></thead><tbody>
   ${list.map(a => `<tr><td><b>${esc(a.username)}</b>${a.self ? ' <span class="badge accent">当前账号</span>' : ''}</td><td>${a.disabled ? '<span class="badge danger">已停用</span>' : '<span class="badge ok">正常</span>'}</td>
    <td class="hide-sm">${fmtTime(a.created)}</td><td class="hide-sm">${relTime(a.lastLogin)}</td>
    <td><div class="row end">${a.self ? '' : `<button class="btn small" data-admin-password="${esc(a.id)}" data-name="${esc(a.username)}">重置密码</button>
     <button class="btn small" data-admin-toggle="${esc(a.id)}" data-disabled="${a.disabled}">${a.disabled ? '启用' : '停用'}</button>
     <button class="btn small danger" data-admin-delete="${esc(a.id)}" data-name="${esc(a.username)}">删除</button>`}</div></td></tr>`).join('')}
   </tbody></table></div></div>`;
  $('[data-create-admin]').onclick = async () => {
    const r = await modal({
      title: '添加后台管理员', body: `<form id="admin-form" class="stack"><label class="field">用户名<input type="text" name="username" maxlength="32" required pattern="[A-Za-z0-9_.\\-]{3,32}"><small>3–32 位字母、数字或 _ . -</small></label><label class="field">初始密码<input type="text" name="password" minlength="10" maxlength="72" required autocomplete="off"><small>至少 10 个字符，请对方登录后修改</small></label></form>`,
      actions: [{ label: '取消' }, { label: '添加', kind: 'primary', run: m => { const f = $('#admin-form', m); if (!f.reportValidity()) return false; return api('/admins', { method: 'POST', body: { username: f.username.value.trim(), password: f.password.value } }); } }],
    });
    if (r) { toast('管理员已添加'); admins(); }
  };
  $('#main').onclick = async e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.adminToggle) busy(b, async () => { await api('/admins/' + b.dataset.adminToggle, { method: 'PATCH', body: { disabled: b.dataset.disabled !== 'true' } }); admins(); });
    if (b.dataset.adminDelete) { if (await confirmModal('删除管理员', `确定删除后台账号 <b>${esc(b.dataset.name)}</b>？`, '删除', 'danger solid')) busy(b, async () => { await api('/admins/' + b.dataset.adminDelete, { method: 'DELETE' }); toast('已删除'); admins(); }); }
    if (b.dataset.adminPassword) {
      const r = await modal({ title: '重置管理员密码', body: `<label class="field">${esc(b.dataset.name)} 的新密码<input type="text" id="admin-new-password" minlength="10" maxlength="72" autocomplete="off"><small>至少 10 个字符；该管理员的其他登录会失效</small></label>`, actions: [{ label: '取消' }, { label: '重置', kind: 'primary', run: m => api('/admins/' + b.dataset.adminPassword, { method: 'PATCH', body: { password: $('#admin-new-password', m).value } }) }] });
      if (r) toast('密码已重置');
    }
  };
}
async function changeOwnPassword() {
  const r = await modal({
    title: '修改我的密码', body: `<form id="own-form" class="stack"><label class="field">当前密码<input type="password" name="current" autocomplete="current-password" required></label><label class="field">新密码<input type="password" name="password" minlength="10" maxlength="72" autocomplete="new-password" required><small>至少 10 个字符</small></label><label class="field">再次输入新密码<input type="password" name="again" autocomplete="new-password" required></label></form>`,
    actions: [{ label: '取消' }, {
      label: '修改', kind: 'primary', run: m => {
        const f = $('#own-form', m); if (!f.reportValidity()) return false;
        if (f.password.value !== f.again.value) throw new Error('两次输入的新密码不一致');
        return api('/me/password', { method: 'POST', body: { current: f.current.value, password: f.password.value } });
      }
    }],
  });
  if (r) toast('密码已修改，其他登录已失效');
}

// ---------- settings ----------
const MB = 1048576;
const sections = [
  { id: 'network', title: '地址与端口', desc: '修改端口后需要重启服务，并同步调整服务器防火墙；客户端需要能访问“对外地址”。', fields: [
    ['public_url', 'text', '对外 API 地址', '客户端连接的地址，例如 http://chat.example.com:8250'],
    ['download_url', 'text', '下载页地址', '例如 http://chat.example.com:8251'],
    ['listen', 'text', 'API 监听地址', '例如 :8250'],
    ['download_listen', 'text', '下载页监听地址', '留空则不单独开放下载页'],
    ['console.public', 'bool', '在网站提供管理后台入口', '开启后可从下载页右上角“管理后台”或 /admin/ 打开；关闭后只能通过下面的后台端口访问'],
    ['console.listen', 'text', '管理后台端口（独立）', '例如 :8253；改为 127.0.0.1:8253 后只能在服务器本机访问', true],
  ] },
  { id: 'storage', title: '数据与存储', desc: '数据目录保存数据库与文件。修改目录前请先停止服务并把原目录完整复制过去。', fields: [
    ['data_dir', 'text', '数据目录', '数据库与默认文件存储位置', true],
    ['storage.root', 'text', '文件存储目录', '留空则使用数据目录', true],
    ['downloads_dir', 'text', '安装包目录', '下载页提供的客户端安装包所在目录', true],
    ['storage.primary_enabled', 'bool', '启用主存储盘', '关闭后不再向主存储盘写入新文件'],
    ['storage.require_marker', 'bool', '校验存储盘标记', '开启后，目录中缺少 .welink-storage 标记（磁盘未挂载）时拒绝写入'],
    ['storage.reserve_bytes', 'mb', '保留空闲空间（MB）', '磁盘剩余空间低于此值时停止接收上传'],
    ['storage.concurrent_uploads', 'int', '同时处理的上传数', '1–64'],
    ['storage.volumes', 'volumes', '附加存储盘', '主存储盘满时新文件写入这些磁盘；ID 一旦使用请勿修改', true],
  ] },
  { id: 'accounts', title: '账号与登录', desc: '账号统一在“用户管理”中创建和管理。', fields: [
    ['registration.enabled', 'bool', '开放自助注册', '关闭后员工只能由管理员在后台创建'],
    ['email_auth.enabled', 'bool', '使用邮箱 + 验证码登录', '需先在“凭据与密钥”中配置邮件服务'],
    ['directory.all_users', 'bool', '通讯录显示所有员工', '关闭后员工只能看到好友'],
    ['email_auth.credentials_file', 'text', '邮件服务凭据文件', '在“凭据与密钥”中保存后会自动填写', true],
  ] },
  { id: 'chat', title: '聊天与消息', desc: '0 表示不限制。', fields: [
    ['chat.max_attachment_bytes', 'mb', '单个附件上限（MB）', '0 为不限'],
    ['chat.persist_attachment_bytes', 'mb', '附件永久保存上限（MB）', '超过此大小的附件仅在线中转'],
    ['chat.offline_queue_bytes', 'mb', '离线消息队列容量（MB）'],
    ['chat.offline_queue_messages', 'int', '离线消息队列条数'],
    ['chat.uploads_per_hour', 'int', '每小时上传次数上限', '0 为不限'],
    ['chat.received_cache_messages', 'int', '客户端本地缓存消息条数'],
    ['chat.received_cache_bytes', 'mb', '客户端本地缓存容量（MB）'],
    ['chat.received_cache_days', 'int', '客户端本地缓存天数'],
    ['chat.received_cache_conversations', 'int', '客户端缓存会话数'],
  ] },
  { id: 'drive', title: '网盘与个人空间', fields: [
    ['drive.quota_gb', 'int', '每人网盘容量（GB）', '降低额度不会删除已有文件'],
    ['drive.max_files', 'int', '每人最多文件数'],
    ['drive.max_folders', 'int', '每人最多文件夹数'],
    ['drive.max_folder_depth', 'int', '文件夹最大层级'],
    ['spaces.max_document_bytes', 'mb', '个人空间单篇文档上限（MB）'],
    ['spaces.max_documents', 'int', '个人空间文档总数上限'],
  ] },
  { id: 'meetings', title: '会议与通话', desc: '媒体中继（TURN）让处在不同网络的设备也能稳定通话；启用后需开放中继端口。', fields: [
    ['meetings.max_participants', 'int', '会议最多人数', '2–32'],
    ['meetings.duration_minutes', 'int', '会议最长时长（分钟）'],
    ['meetings.stun_urls', 'list', 'STUN 地址', '每行一个，例如 stun:chat.example.com:8252', true],
    ['media.enabled', 'bool', '启用媒体中继', '密钥在“凭据与密钥”中设置'],
    ['media.public_address', 'text', '中继公网地址', '服务器的公网 IP 或域名'],
    ['media.listen', 'text', '中继监听地址', '例如 :8252（TCP 与 UDP）'],
    ['media.urls', 'list', '中继地址（TURN）', '每行一个，例如 turn:chat.example.com:8252?transport=udp', true],
    ['media.relay_min_port', 'int', '中继端口范围起始'],
    ['media.relay_max_port', 'int', '中继端口范围结束'],
    ['media.direct_timeout_ms', 'int', '直连超时（毫秒）', '超过后改走中继，1000–30000'],
    ['media.credential_seconds', 'int', '中继凭据有效期（秒）'],
    ['media.max_allocations_per_user', 'int', '每人最多中继连接'],
    ['media.bytes_per_second', 'kb', '每人中继带宽上限（KB/s）', '0 表示不限制（默认）'],
    ['media.realm', 'text', '中继域（realm）'],
    ['media.secret_file', 'text', '中继密钥文件', '在“凭据与密钥”中生成后会自动填写', true],
    ['media.allowed_peer_cidrs', 'list', '允许中继的内网网段', '每行一个 CIDR，留空则只允许公网地址', true],
  ] },
  { id: 'ai', title: 'Me 助手', desc: '接口地址、API Key、模型 ID 在“AI 模型”页面设置；这里是用量限制。', fields: [
    ['ai.context_messages', 'int', '上下文消息条数', '2–200'],
    ['ai.context_characters', 'int', '上下文字符数', '1000–200000'],
    ['ai.concurrent_requests', 'int', '同时处理的请求数', '1–32'],
  ] },
  { id: 'raw', title: '配置文件（高级）', desc: '直接编辑完整的 JSON 配置，保存前会校验。' },
];
const getPath = (o, p) => p.split('.').reduce((v, k) => v?.[k], o);
function setPath(o, p, v) { const ks = p.split('.'); const last = ks.pop(); const t = ks.reduce((x, k) => (x[k] ??= {}), o); t[last] = v; }
function fieldHTML([path, type, label, help, wide]) {
  const v = getPath(state.draft, path), id = 'f-' + path.replace(/\./g, '-');
  const helpHTML = help ? `<small>${esc(help)}</small>` : '';
  if (type === 'bool') return `<label class="check field-bool${wide ? ' wide' : ''}"><input type="checkbox" class="switch" id="${id}" data-path="${path}" data-type="bool" ${v ? 'checked' : ''}><span>${esc(label)}${help ? `<br><small class="help">${esc(help)}</small>` : ''}</span></label>`;
  if (type === 'list') return `<label class="field${wide ? ' wide' : ''}">${esc(label)}<textarea id="${id}" rows="3" data-path="${path}" data-type="list">${esc((v || []).join('\n'))}</textarea>${helpHTML}</label>`;
  if (type === 'volumes') return `<div class="field wide"><span>${esc(label)}</span><div class="list-editor" id="volumes">${(v || []).map((x, i) => `<div class="item"><input type="text" placeholder="ID（如 disk2）" value="${esc(x.id)}" data-volume="${i}" data-key="id"><input type="text" placeholder="目录（如 /mnt/disk2/linkme）" value="${esc(x.root)}" data-volume="${i}" data-key="root"><button type="button" class="btn small" data-remove-volume="${i}">移除</button></div>`).join('')}
    <div><button type="button" class="btn small" data-add-volume>${icon('plus')}添加存储盘</button></div></div>${helpHTML ? `<span class="help">${esc(help)}</span>` : ''}</div>`;
  let shown = v ?? '';
  if (type === 'mb') shown = v ? +(v / MB).toFixed(2) : 0;
  if (type === 'kb') shown = v ? Math.round(v / 1024) : 0;
  const input = type === 'text' ? 'text' : 'number';
  return `<label class="field${wide ? ' wide' : ''}">${esc(label)}<input type="${input}" id="${id}" data-path="${path}" data-type="${type}" value="${esc(shown)}" ${input === 'number' ? 'min="0" step="any"' : ''}>${helpHTML}</label>`;
}
function readField(el) {
  const t = el.dataset.type;
  if (t === 'bool') return el.checked;
  if (t === 'list') return el.value.split('\n').map(x => x.trim()).filter(Boolean);
  if (t === 'int') return Math.round(Number(el.value) || 0);
  if (t === 'mb') return Math.round((Number(el.value) || 0) * MB);
  if (t === 'kb') return Math.round((Number(el.value) || 0) * 1024);
  return el.value.trim();
}
async function settings() {
  const res = await api('/settings');
  state.settings = res; state.draft = structuredClone(res.settings); state.dirty = false;
  $('#main').innerHTML = head('系统设置', '保存后写入配置文件 <span class="path">' + esc(res.configPath || '（未使用配置文件）') + '</span>，重启服务后生效。每次保存前的版本会备份在 config-backups 目录。') +
    `<div id="settings-banner">${restartBanner(res.restartPending)}</div>${res.fileError ? `<div class="banner"><b>配置文件当前无法读取：</b>${esc(res.fileError)}</div>` : ''}${res.editable ? '' : '<div class="banner"><b>服务启动时没有指定配置文件（-config），无法在后台保存设置。</b></div>'}
    <div class="settings-layout"><nav class="settings-nav" id="settings-nav">${sections.map(s => `<button data-section="${s.id}">${s.title}</button>`).join('')}</nav>
    <div class="card" id="settings-card"></div></div>`;
  $('#settings-nav').onclick = e => { const b = e.target.closest('[data-section]'); if (!b) return; syncRaw(); state.section = b.dataset.section; renderSection(); };
  renderSection();
}
function syncRaw() {
  const raw = $('#raw-config'); if (!raw) return true;
  try { state.draft = JSON.parse(raw.value); return true; } catch (e) { toast('JSON 格式错误：' + e.message, true); return false; }
}
function renderSection() {
  const s = sections.find(x => x.id === state.section) || sections[0];
  $$('#settings-nav button').forEach(b => b.classList.toggle('active', b.dataset.section === s.id));
  const card = $('#settings-card');
  const body = s.id === 'raw'
    ? `<label class="field">完整配置（JSON）<textarea id="raw-config" rows="24" spellcheck="false">${esc(JSON.stringify(state.draft, null, 2))}</textarea></label>`
    : `<div class="fields" id="fields">${s.fields.map(fieldHTML).join('')}</div>`;
  card.innerHTML = `<div class="card-head"><div><h2>${s.title}</h2>${s.desc ? `<p>${esc(s.desc)}</p>` : ''}</div></div><div class="card-body">${body}</div>
   <div class="save-bar"><span id="dirty-note">${state.dirty ? '有未保存的修改' : '所有修改都已保存'}</span><span class="spacer"></span><button class="btn" data-discard ${state.dirty ? '' : 'disabled'}>放弃修改</button><button class="btn primary" data-save-settings ${state.settings.editable ? '' : 'disabled'}>保存设置</button></div>`;
  const markDirty = () => { state.dirty = true; $('#dirty-note').textContent = '有未保存的修改'; $('[data-discard]').disabled = false; };
  card.oninput = e => {
    const el = e.target;
    if (el.dataset.path) { setPath(state.draft, el.dataset.path, readField(el)); markDirty(); }
    else if (el.dataset.volume) { state.draft.storage.volumes[+el.dataset.volume][el.dataset.key] = el.value.trim(); markDirty(); }
    else if (el.id === 'raw-config') markDirty();
  };
  card.onchange = card.oninput;
  card.onclick = e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.hasAttribute('data-add-volume')) { (state.draft.storage.volumes ??= []).push({ id: '', root: '' }); markDirty(); renderSection(); }
    if (b.dataset.removeVolume) { state.draft.storage.volumes.splice(+b.dataset.removeVolume, 1); markDirty(); renderSection(); }
    if (b.hasAttribute('data-discard')) { state.draft = structuredClone(state.settings.settings); state.dirty = false; renderSection(); }
    if (b.hasAttribute('data-save-settings')) saveSettings(b);
  };
}
async function saveSettings(button) {
  if (!syncRaw()) return;
  const before = state.settings.settings;
  const risky = [['listen', 'API 端口'], ['console.listen', '后台端口'], ['data_dir', '数据目录'], ['storage.root', '文件存储目录']].filter(([p]) => JSON.stringify(getPath(before, p)) !== JSON.stringify(getPath(state.draft, p)));
  if (risky.length && !await confirmModal('确认修改', `你修改了：<b>${risky.map(r => r[1]).join('、')}</b>。<br>修改端口后需要同步调整防火墙；修改目录前请确认数据已复制到新位置，否则重启后会以空数据启动。确定保存？`, '保存', 'primary')) return;
  await busy(button, async () => {
    const r = await api('/settings', { method: 'PUT', body: state.draft });
    state.settings.settings = structuredClone(state.draft); state.dirty = false;
    toast('设置已保存');
    $('#settings-banner').innerHTML = restartBanner(r.restartPending);
    renderSection();
  });
}



// ---------- branding ----------
const brand = { name: 'LinkMe', iconVersion: '' };
async function loadBrand() {
  try { const b = await (await fetch(API + '/brand', { cache: 'no-store' })).json(); brand.name = b.name || 'LinkMe'; brand.iconVersion = b.iconVersion || ''; } catch { }
  document.title = brand.name + ' 管理后台';
}
// The sidebar/login mark: the uploaded icon, or the default "M" tile.
function brandMark() { return brand.iconVersion ? `<img class="brand-mark brand-img" src="${API}/brand/icon?v=${esc(brand.iconVersion)}" alt="">` : '<div class="brand-mark">M</div>'; }
async function branding() {
  const b = await api('/branding');
  brand.name = b.name; brand.iconVersion = b.iconVersion || '';
  const preview = () => brand.iconVersion ? `<img src="${API}/brand/icon?v=${esc(brand.iconVersion)}" alt="">` : '<span class="default-mark">M</span>';
  $('#main').innerHTML = head('品牌与图标', '修改软件名称、上传图标后立即生效：下载页、管理后台和员工的客户端都会显示新的名称与图标。') +
   `<div class="grid two"><div class="card"><div class="card-head"><div><h2>软件名称</h2><p>默认为 ${esc(b.default)}</p></div></div><div class="card-body stack">
     <label class="field">名称<input type="text" id="brand-name" maxlength="24" value="${esc(b.name)}" placeholder="${esc(b.default)}"><small>1–24 个字符，例如公司或产品名称；留空恢复默认</small></label></div>
     <div class="save-bar"><span>客户端在线时会立即更新</span><span class="spacer"></span><button class="btn primary" data-save-brand>保存名称</button></div></div>
    <div class="card"><div class="card-head"><div><h2>软件图标</h2><p>PNG 或 JPG，建议 512×512 的正方形图片</p></div></div><div class="card-body stack">
     <div class="brand-preview"><div class="brand-icon-preview" id="brand-icon">${preview()}</div><div><b id="brand-preview-name">${esc(b.name)}</b><small>${b.icon ? '已使用自定义图标' : '当前为默认图标'}</small></div></div>
     <input type="file" id="brand-file" class="hidden" accept="image/png,image/jpeg"><div class="progress hidden" id="brand-progress"><i></i></div></div>
     <div class="save-bar"><span>非正方形图片会自动居中裁剪</span><span class="spacer"></span>${b.icon ? '<button class="btn danger small" data-reset-icon>恢复默认图标</button>' : ''}<button class="btn primary" data-upload-icon>${icon('upload')}上传图标</button></div></div></div>
    <div class="card" id="brand-scope"><div class="card-body"><b>生效范围</b><ul class="help">
     <li>下载页、会议邀请页、网盘分享页、管理后台：名称与图标</li>
     <li>Windows、macOS、安卓客户端界面：登录页、窗口标题、会话列表等处的名称与图标；Windows 任务栏与托盘图标（含新消息呼吸灯）</li>
     <li>不会改变：安卓桌面上的 App 名称与启动图标、安装包文件名（需重新打包）</li></ul></div></div>`;
  $('#brand-name').oninput = e => { $('#brand-preview-name').textContent = e.target.value.trim() || b.default; };
  $('[data-save-brand]').onclick = e => busy(e.currentTarget, async () => {
    const r = await api('/branding', { method: 'PUT', body: { name: $('#brand-name').value.trim() } });
    brand.name = r.name; document.title = brand.name + ' 管理后台'; refreshChrome(); toast('名称已保存并生效');
  });
  $('[data-upload-icon]').onclick = () => $('#brand-file').click();
  $('#brand-file').onchange = e => {
    const file = e.target.files[0]; if (!file) return;
    if (file.size > 4 * 1048576) { toast('图标文件不能超过 4 MB', true); return; }
    busy($('[data-upload-icon]'), async () => {
      const res = await fetch(API + '/branding/icon', { method: 'PUT', headers: { 'X-LinkMe-Console': '1' }, body: file, credentials: 'same-origin' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new ApiError(data.error || '上传失败', res.status);
      brand.iconVersion = data.iconVersion || ''; refreshChrome(); toast('图标已更新'); branding();
    });
  };
  const reset = $('[data-reset-icon]');
  if (reset) reset.onclick = () => confirmModal('恢复默认图标', '删除自定义图标，恢复默认图标？', '恢复', 'danger solid').then(ok => ok && busy(reset, async () => {
    const r = await api('/branding/icon', { method: 'DELETE' }); brand.iconVersion = r.iconVersion || ''; refreshChrome(); toast('已恢复默认图标'); branding();
  }));
}
// Re-render the sidebar brand after a change.
function refreshChrome() {
  const side = $('.side .brand'); if (side) { side.innerHTML = `${brandMark()}<div><b>${esc(brand.name)}</b><span>管理后台</span></div>`; }
  const top = $('.topbar b'); if (top) top.textContent = brand.name + ' 管理后台';
}

// ---------- AI model ----------
// Presets only pre-fill the form; every field stays editable.
const aiPresets = [
  { id: 'deepseek', label: 'DeepSeek', api: 'chat', baseUrl: 'https://api.deepseek.com', model: 'deepseek-chat', models: ['deepseek-chat', 'deepseek-reasoner'] },
  { id: 'qwen', label: '通义千问', api: 'chat', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen-plus', models: ['qwen-plus', 'qwen-max', 'qwen-turbo'] },
  { id: 'kimi', label: 'Kimi', api: 'chat', baseUrl: 'https://api.moonshot.cn/v1', model: '', models: [] },
  { id: 'glm', label: '智谱 GLM', api: 'chat', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', model: '', models: [] },
  { id: 'ollama', label: 'Ollama（本机）', api: 'chat', baseUrl: 'http://127.0.0.1:11434/v1', model: '', models: [] },
  { id: 'openai', label: 'OpenAI', api: 'responses', baseUrl: 'https://api.openai.com/v1', model: '', models: [] },
];
async function aiModel() {
  const c = await api('/ai');
  $('#main').innerHTML = head('AI 模型', 'Me 助手使用的大模型。<b>接口地址、API Key、模型 ID</b> 为必填项，可接入 DeepSeek、通义千问、Kimi、智谱等兼容 OpenAI 接口的模型。') +
    `<div id="ai-banner">${restartBanner(c.restartPending)}</div>
    <div class="card"><div class="card-head"><div><h2>模型接入</h2><p>${c.running ? '<span class="badge ok">Me 助手运行中</span>' : '<span class="badge">Me 助手未运行</span>'} 保存后重启服务生效</p></div></div>
    <div class="card-body stack"><form id="ai-form" class="stack" autocomplete="off">
      <label class="check"><input type="checkbox" class="switch" name="enabled" ${c.enabled ? 'checked' : ''}><span>启用 Me 助手<br><small class="help">员工的会话列表中会出现 AI 助手“Me”</small></span></label>
      <div class="field"><span>快速填写</span><div class="row">${aiPresets.map(p => `<button type="button" class="btn small" data-preset="${p.id}">${esc(p.label)}</button>`).join('')}</div><small class="help">只会预填接口类型、地址和常用模型 ID，可再修改。</small></div>
      <div class="fields">
        <label class="field wide">接口类型<select name="api">
          <option value="chat" ${c.api === 'chat' ? 'selected' : ''}>OpenAI 兼容 · Chat Completions（DeepSeek、通义千问、Kimi、智谱、Ollama 等）</option>
          <option value="responses" ${c.api === 'responses' ? 'selected' : ''}>OpenAI · Responses（支持桌面端本机任务）</option>
        </select><small id="api-hint"></small></label>
        <label class="field wide">接口地址 *<input type="text" name="baseUrl" required value="${esc(c.baseUrl)}" placeholder="例如 https://api.deepseek.com" spellcheck="false"><small>不含 /chat/completions，系统会自动拼接</small></label>
        <label class="field">API Key *<input type="password" name="apiKey" ${c.keySet ? '' : 'required'} placeholder="${c.keySet ? '已设置，留空表示不修改' : '例如 sk-…'}" autocomplete="new-password"><small class="secret-state">${c.keySet ? '● 已设置（出于安全不显示）' : '○ 未设置'}</small></label>
        <label class="field">模型 ID *<input type="text" name="model" required list="ai-models" value="${esc(c.model)}" placeholder="例如 deepseek-chat" spellcheck="false"><datalist id="ai-models"></datalist></label>
        <label class="field" id="effort-field">推理强度<select name="effort">${['low', 'medium', 'high', 'xhigh'].map(v => `<option ${c.effort === v ? 'selected' : ''}>${v}</option>`).join('')}</select><small>仅 Responses 接口使用</small></label>
      </div>
      <p class="help" id="ai-result" role="status"></p>
    </form></div>
    <div class="save-bar"><span>先测试连接，确认可用后再保存</span><span class="spacer"></span><button class="btn" data-ai-test>测试连接</button><button class="btn primary" data-ai-save>保存</button></div></div>`;
  const form = $('#ai-form');
  const sync = () => {
    const chat = form.api.value === 'chat';
    $('#effort-field').classList.toggle('hidden', chat);
    $('#api-hint').textContent = chat ? '对话可正常使用；桌面端“本机任务”需要 OpenAI Responses 接口。' : '对话与桌面端本机任务（Codex）都可使用。';
  };
  sync(); form.api.onchange = sync;
  const values = () => ({ enabled: form.enabled.checked, api: form.api.value, baseUrl: form.baseUrl.value.trim(), apiKey: form.apiKey.value.trim(), model: form.model.value.trim(), effort: form.effort.value });
  const result = (text, ok) => { const r = $('#ai-result'); r.textContent = text; r.style.color = ok === undefined ? '' : ok ? 'var(--ok)' : 'var(--danger)'; };
  form.onclick = e => {
    const b = e.target.closest('[data-preset]'); if (!b) return;
    const p = aiPresets.find(x => x.id === b.dataset.preset);
    form.api.value = p.api; form.baseUrl.value = p.baseUrl; form.model.value = p.model;
    $('#ai-models').innerHTML = p.models.map(m => `<option value="${esc(m)}">`).join('');
    sync(); result(`已填入 ${p.label} 的接口地址${p.model ? '和模型 ID' : '，请填写模型 ID'}，再填写 API Key${p.id === 'ollama' ? '（Ollama 可填任意内容）' : ''}。`);
    (p.model ? form.apiKey : form.model).focus();
  };
  $('[data-ai-test]').onclick = e => busy(e.currentTarget, async () => {
    result('正在调用模型…');
    try { const r = await api('/ai/test', { method: 'POST', body: values() }); result(`连接成功（${(r.ms / 1000).toFixed(1)} 秒）。模型回复：${r.reply}`, true); }
    catch (err) { result('连接失败：' + err.message, false); }
  });
  $('[data-ai-save]').onclick = e => busy(e.currentTarget, async () => {
    if (!form.reportValidity()) return;
    const r = await api('/ai', { method: 'PUT', body: values() });
    toast('AI 模型配置已保存'); $('#ai-banner').innerHTML = restartBanner(r.restartPending);
    form.apiKey.value = ''; form.apiKey.required = false; form.apiKey.placeholder = '已设置，留空表示不修改'; form.querySelector('.secret-state').textContent = '● 已设置（出于安全不显示）';
  });
}

// ---------- credentials ----------
async function credentials() {
  const files = await api('/files'), byKind = Object.fromEntries(files.map(f => [f.kind, f]));
  const status = f => `<div class="row"><span class="path">${esc(f.path || '尚未创建（保存后自动创建并写入配置）')}</span>${f.exists ? `<span class="badge ok">已保存 · ${fmtTime(f.modified)}</span>` : '<span class="badge">未配置</span>'}${f.error ? `<span class="badge danger">${esc(f.error)}</span>` : ''}</div>`;
  const secret = (f, key, label) => `<label class="field">${label}<input type="password" name="${key}" autocomplete="new-password" placeholder="${f.secrets[key] ? '已设置，留空表示不修改' : '未设置'}"><small class="secret-state">${f.secrets[key] ? '● 已设置（出于安全不显示）' : '○ 未设置'}</small></label>`;
  const e = byKind.email, m = byKind.media;
  $('#main').innerHTML = head('凭据与密钥', '这些私密文件由配置引用，文件权限为仅服务可读。密钥只能写入、不会回显。保存后需重启服务生效。') + `<div id="cred-banner"></div><div class="stack">
   <div class="card"><div class="card-head"><div><h2>邮件服务（腾讯云 SES）</h2><p>用于邮箱登录、注册和找回密码的验证码邮件</p></div></div><div class="card-body stack">${status(e)}
    <form id="email-form" class="fields"><label class="field">SecretId<input type="text" name="secretId" value="${esc(e.values.secretId)}" autocomplete="off"></label>${secret(e, 'secretKey', 'SecretKey')}
    <label class="field">地域<select name="region">${['ap-guangzhou', 'ap-hongkong'].map(r => `<option ${e.values.region === r ? 'selected' : ''}>${r}</option>`).join('')}</select></label>
    <label class="field">模板 ID<input type="number" name="templateId" value="${esc(e.values.templateId || '')}"></label>
    <label class="field">发件地址<input type="text" name="from" value="${esc(e.values.from)}" placeholder="LinkMe <no-reply@example.com>"></label>
    <label class="field">邮件主题<input type="text" name="subject" value="${esc(e.values.subject)}" placeholder="LinkMe 验证码"></label></form></div>
    <div class="save-bar"><span>启用邮箱登录：系统设置 → 账号与登录</span><span class="spacer"></span><button class="btn primary" data-save-file="email">保存</button></div></div>
   <div class="card"><div class="card-head"><div><h2>媒体中继密钥</h2><p>通话与会议中继（TURN）使用的共享密钥</p></div></div><div class="card-body stack">${status(m)}
    <form id="media-form" class="fields">${secret(m, 'secret', '密钥')}</form></div>
    <div class="save-bar"><span>更换密钥后正在进行的通话可能需要重新接通</span><span class="spacer"></span><button class="btn" data-generate-media>自动生成新密钥</button><button class="btn primary" data-save-file="media">保存</button></div></div>
  </div>`;
  $('#main').onclick = ev => {
    const b = ev.target.closest('button'); if (!b) return;
    const save = body => busy(b, async () => { await api('/files/' + (b.dataset.saveFile || 'media'), { method: 'PUT', body }); toast('已保存，重启服务后生效'); await credentials(); $('#cred-banner').innerHTML = restartBanner(true); });
    if (b.dataset.saveFile === 'email') { const f = $('#email-form'); save({ ...formValues(f, ['secretId', 'secretKey', 'region', 'from', 'subject']), templateId: Number(f.templateId.value) || 0 }); }
    if (b.dataset.saveFile === 'media') save({ secret: $('#media-form').secret.value.trim() });
    if (b.hasAttribute('data-generate-media')) confirmModal('生成中继密钥', '生成新的随机密钥并保存？', '生成').then(ok => ok && save({ generate: true }));
  };
}

// ---------- packages ----------
const packageInfo = {
  'LinkMe-Setup.exe': ['windows', 'Windows 安装包', '.exe'],
  'LinkMe-Android.apk': ['android', 'Android 安装包', '.apk'],
  'LinkMe-macOS-arm64.zip': ['apple', 'macOS 应用（Apple 芯片）', '.zip'],
};
async function packages() {
  const res = await api('/downloads');
  $('#main').innerHTML = head('客户端安装包', `员工在 <a href="${esc(res.url)}" target="_blank" rel="noopener">下载页</a> 获取客户端。已安装的客户端会从本服务器<b>自动更新</b>到“从官网更新”取得的官方版本；手动上传的安装包可供下载，但不会推送自动更新。`) +
   `<div class="card" id="release-card"></div><div class="card">${res.items.map(p => { const [ic, label, ext] = packageInfo[p.name]; return `<div class="package"><div class="icon">${icon(ic)}</div><div class="info"><b>${label}</b>
     <small>${p.exists ? `${fmtBytes(p.size)} · 更新于 ${fmtTime(p.modified)}` : '尚未上传'}</small>${p.sha256 ? `<small class="path">SHA-256 ${esc(p.sha256)}</small>` : ''}<div class="progress hidden"><i></i></div></div>
     <input type="file" class="hidden" accept="${ext}" data-file="${p.name}"><button class="btn" data-upload="${p.name}">${icon('upload')}${p.exists ? '上传新版本' : '上传'}</button>${p.exists ? `<button class="btn danger small" data-remove="${p.name}">删除</button>` : ''}</div>`; }).join('')}</div>
   <p class="help">目录：<span class="path">${esc(res.dir)}</span></p>`;
  releaseCard($('#release-card'), 'app-release', '客户端', 'packages');
  $('#main').onclick = async e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.upload) $(`[data-file="${b.dataset.upload}"]`).click();
    if (b.dataset.remove && await confirmModal('删除安装包', `从下载页删除 ${esc(packageInfo[b.dataset.remove][1])}？`, '删除', 'danger solid')) busy(b, async () => { await api('/downloads/' + b.dataset.remove, { method: 'DELETE' }); toast('已删除'); packages(); });
  };
  $('#main').onchange = e => { const input = e.target.closest('[data-file]'); if (input?.files[0]) uploadPackage(input.dataset.file, input.files[0], input.closest('.package')); };
}
function uploadPackage(name, file, row) {
  const bar = $('.progress', row), fill = $('i', bar), button = $('[data-upload]', row);
  bar.classList.remove('hidden'); button.disabled = true;
  const xhr = new XMLHttpRequest();
  xhr.open('PUT', API + '/downloads/' + encodeURIComponent(name));
  xhr.setRequestHeader('X-LinkMe-Console', '1');
  xhr.upload.onprogress = e => { if (e.lengthComputable) fill.style.width = (e.loaded / e.total * 100) + '%'; };
  xhr.onload = () => {
    let data = {}; try { data = JSON.parse(xhr.responseText); } catch { }
    if (xhr.status === 200) { toast(`已上传 ${file.name}（${fmtBytes(data.size)}）`); packages(); }
    else { toast(data.error || '上传失败', true); bar.classList.add('hidden'); button.disabled = false; if (xhr.status === 401) renderLogin('登录已过期，请重新登录'); }
  };
  xhr.onerror = () => { toast('上传中断，请重试', true); bar.classList.add('hidden'); button.disabled = false; };
  xhr.send(file);
}

// ---------- official releases (linkme-AIdex, client apps) ----------
// The server mirrors signed official releases; clients download and update
// only from this server. Both pages share this card.
const platformNames = { 'windows/amd64': 'Windows', 'darwin/arm64': 'macOS（Apple 芯片）', 'android/arm64': 'Android' };
let releaseTimer;
async function releaseCard(box, kind, label, page, check) {
  clearTimeout(releaseTimer);
  let res;
  try { res = await api('/' + kind + (check ? '?check=1' : '')); } catch (e) { if (!check) throw e; toast(e.message, true); res = await api('/' + kind); }
  if (location.hash !== '#/' + page || !document.body.contains(box)) return;
  const updating = res.state === 'updating', pct = res.total ? Math.floor(res.done * 100 / res.total) : 0;
  const newer = res.official && res.official !== res.version;
  box.innerHTML = `<div class="package"><div class="icon">${icon('box')}</div><div class="info"><b>本服务器发布的官方版本：${res.published ? esc(res.version) : '暂无'}</b>
     <small>${res.published ? res.platforms.map(p => `${platformNames[p.platform] || esc(p.platform)} ${fmtBytes(p.size)}${p.ready ? '' : '（文件缺失）'}`).join(' · ') : '客户端暂时无法从本服务器' + (kind === 'aidex' ? '下载 ' + label : '自动更新') + '，请从官网更新。'}</small>
     <small>官网最新：${res.official ? esc(res.official) + (newer ? '（可更新）' : '（已是最新）') : '未检查'}</small>
     ${updating ? `<div class="progress"><i style="width:${pct}%"></i></div><small>正在从官网下载… ${fmtBytes(res.done)} / ${fmtBytes(res.total)}</small>` : ''}
     ${res.state === 'failed' ? `<small class="error-text">更新失败：${esc(res.error)}</small>` : res.state === 'done' ? '<small>已更新，客户端会自动获取新版本。</small>' : ''}</div>
     <button class="btn" data-release="check" ${updating ? 'disabled' : ''}>${icon('refresh')}检查官网版本</button>
     <button class="btn primary" data-release="update" ${updating ? 'disabled' : ''}>${icon('upload')}从官网更新</button></div>`;
  box.onclick = e => {
    const b = e.target.closest('[data-release]'); if (!b) return; e.stopPropagation();
    if (b.dataset.release === 'check') busy(b, () => releaseCard(box, kind, label, page, true));
    else busy(b, async () => { await api('/' + kind + '/update', { method: 'POST' }); toast('开始从官网更新'); releaseCard(box, kind, label, page); });
  };
  if (updating) releaseTimer = setTimeout(() => releaseCard(box, kind, label, page), 1000);
}
async function aidexPage() {
  $('#main').innerHTML = head('linkme-AIdex', 'Me 处理本机文件和任务的组件。桌面客户端首次使用时从<b>本服务器</b>下载，之后本服务器有新版本时会<b>自动更新</b>；客户端不会访问官网。') +
    '<div class="card" id="release-card"></div><p class="help">官网发布的文件带有 LinkMe 签名，服务器和客户端都会校验签名与 SHA-256，校验不通过不会使用。</p>';
  await releaseCard($('#release-card'), 'aidex', 'linkme-AIdex', 'aidex');
}

// ---------- audit ----------
const actionNames = {
  'login': '登录后台', 'logout': '退出后台', 'change-own-password': '修改自己的密码', 'reset-admin-password': '重置管理员密码', 'create-admin': '添加管理员',
  'enable-admin': '启用管理员', 'disable-admin': '停用管理员', 'delete-admin': '删除管理员', 'cli-create-admin': '命令行创建管理员', 'cli-reset-password': '命令行重置管理员密码',
  'update-aidex': '从官网更新 linkme-AIdex', 'update-app-release': '从官网更新客户端', 'create-user': '新建用户', 'update-user': '修改用户资料', 'reset-password': '重置用户密码', 'disable-user': '停用用户', 'enable-user': '启用用户',
  'sign-out-user': '用户全部下线', 'revoke-device': '下线用户设备', 'reset-avatar': '重置用户头像', 'delete-user': '删除用户',
  'save-settings': '保存系统设置', 'save-credentials': '更新凭据', 'upload-package': '上传安装包', 'delete-package': '删除安装包', 'restart': '重启服务', 'save-ai': '修改 AI 模型', 'save-brand-name': '修改软件名称', 'upload-brand-icon': '上传软件图标', 'reset-brand-icon': '恢复默认图标',
};
async function audit(before) {
  const list = await api('/audit' + (before ? '?before=' + before : ''));
  const rows = list.map(e => `<tr><td>${fmtTime(e.created)}</td><td><b>${esc(e.username)}</b></td><td>${esc(actionNames[e.action] || e.action)}</td><td>${esc(e.targetName || '')}</td><td class="hide-sm">${esc(e.detail)}</td><td class="hide-sm">${esc(e.ip)}</td></tr>`).join('');
  if (before) { $('#audit-rows').insertAdjacentHTML('beforeend', rows); }
  else {
    $('#main').innerHTML = head('操作日志', '后台中的每一次操作都会记录在这里。') +
     `<div class="card"><div class="table-wrap"><table><thead><tr><th>时间</th><th>管理员</th><th>操作</th><th>对象</th><th class="hide-sm">详情</th><th class="hide-sm">IP</th></tr></thead><tbody id="audit-rows">${rows || '<tr><td colspan="6" class="empty">暂无记录</td></tr>'}</tbody></table></div><div class="pager" id="audit-more"></div></div>`;
  }
  const more = $('#audit-more');
  more.innerHTML = list.length === 100 ? '<span class="spacer"></span><button class="btn small">加载更早的记录</button>' : '';
  if (list.length === 100) $('button', more).onclick = () => audit(list[list.length - 1].created);
}

// ---------- start ----------
async function start() {
  await loadBrand();
  try { state.me = await api('/me'); } catch { return renderLogin(); }
  app.innerHTML = '';
  if (!location.hash) location.hash = '#/overview';
  route();
}
start();
