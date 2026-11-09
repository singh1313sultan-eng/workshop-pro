/* Workshop Pro – core: icons, API client, router, UI helpers */
'use strict';

/* ---------------- icons (stroke icons, 24x24) ---------------- */
const ICONS = {
  grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  clipboard: '<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4V3h6v1M9 10h6M9 14h6M9 18h3"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  code: '<path d="m8 8-5 4 5 4M16 8l5 4-5 4M14 4l-4 16"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 0 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 0 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 0 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 0 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  wrench: '<path d="M14.7 6.3a4 4 0 0 0 5 5L21 12.6l-8.4 8.4a2.1 2.1 0 0 1-3-3L18 9.6l-1.3-1.3a4 4 0 0 1-5-5l2.6 2.6 2.4-.6.6-2.4z"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  back: '<path d="M19 12H5M12 19l-7-7 7-7"/>',
  sidebar: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16"/>',
  chevdown: '<path d="m6 9 6 6 6-6"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  check: '<path d="m5 12 5 5L20 7"/>',
  car: '<path d="M5 17h14v-5l-2-5H7l-2 5v5z"/><path d="M3 12h18"/><circle cx="7.5" cy="17" r="1.8"/><circle cx="16.5" cy="17" r="1.8"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 4-6 8-6s8 2 8 6"/>',
  phone: '<path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2z"/>',
  download: '<path d="M12 3v12m0 0-5-5m5 5 5-5M4 21h16"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>',
  print: '<path d="M6 9V3h12v6M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="7"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  alert: '<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 16v-4M12 8h.01"/>',
  star: '<path d="m12 3 2.8 5.8 6.2.9-4.5 4.4 1 6.2L12 17.4l-5.5 2.9 1-6.2L3 9.7l6.2-.9z"/>',
  trash: '<path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14M10 11v6M14 11v6"/>',
  edit: '<path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
  swap: '<path d="M17 3l4 4-4 4M21 7H9M7 21l-4-4 4-4M3 17h12"/>',
  lock: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  unlock: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 7.5-2"/>',
  flag: '<path d="M4 22V4M4 4h12l-2 4 2 4H4"/>',
  history: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5M12 7v5l3 2"/>',
  chat: '<path d="M21 12a8 8 0 0 1-11.6 7.1L3 21l1.9-6.4A8 8 0 1 1 21 12z"/>',
  receipt: '<path d="M5 3h14v18l-3-2-2 2-2-2-2 2-2-2-3 2z"/><path d="M9 8h6M9 12h6"/>',
  scan: '<path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2M7 8v8M10 8v8M14 8v8M17 8v8"/>',
  arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  chevron: '<path d="m9 6 6 6-6 6"/>',
  down: '<path d="m6 9 6 6 6-6"/>',
  shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
  gauge: '<path d="M12 14l4-4"/><path d="M3.3 19a10 10 0 1 1 17.4 0"/>',
  tag: '<path d="M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8z"/><circle cx="7.5" cy="7.5" r="1.5"/>',
  refresh: '<path d="M21 12a9 9 0 1 1-3-6.7L21 8M21 3v5h-5"/>',
  box: '<path d="M21 8 12 3 3 8v8l9 5 9-5z"/><path d="m3 8 9 5 9-5M12 13v8"/>',
  pen: '<path d="M3 21c3-1 5-3 7-6l4-4 3 3-4 4c-3 2-5 4-6 7"/><path d="m14 7 3-3 3 3-3 3"/>',
};
function ic(name, cls = '') {
  return `<svg class="i ${cls}" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name] || ''}</svg>`;
}
/* ---------------- side menu: collapse to icons, fold sections ---------------- */
function toggleSideMenu(force) {
  const mini = typeof force === 'boolean' ? force : !document.documentElement.classList.contains('side-mini');
  document.documentElement.classList.toggle('side-mini', mini);
  try { localStorage.setItem('wpSideMini', mini ? '1' : '0'); } catch { /* private mode */ }
  const b = $('#sideToggle');
  if (b) { b.title = mini ? 'Expand menu' : 'Collapse menu'; b.setAttribute('aria-label', b.title); b.setAttribute('aria-expanded', String(!mini)); }
}
function initSideMenu() {
  // saved choice per section (true = open); by default only the first section is open
  let state = {};
  try { state = JSON.parse(localStorage.getItem('wpNavOpen') || '{}') || {}; } catch { state = {}; }
  document.querySelectorAll('.side .navlabel').forEach((lab, i) => {
    const nav = lab.nextElementSibling;
    if (!nav || !nav.classList.contains('nav')) return;
    const key = lab.textContent.trim();
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'navlabel';
    btn.dataset.right = lab.dataset.right || '';
    if (!btn.dataset.right) delete btn.dataset.right;
    btn.innerHTML = `<span>${esc(key)}</span>${ic('chevdown', 'sm')}`;
    const set = (shut) => {
      nav.classList.toggle('folded', shut);
      btn.classList.toggle('folded', shut);
      btn.setAttribute('aria-expanded', String(!shut));
      btn.title = shut ? `Show ${key}` : `Hide ${key}`;
    };
    // a folded section still opens when you are on one of its pages
    const open = key in state ? state[key] : i === 0;
    set(!open && !nav.querySelector('a.on'));
    btn.onclick = () => {
      const shut = !nav.classList.contains('folded');
      set(shut);
      state[key] = !shut;
      try { localStorage.setItem('wpNavOpen', JSON.stringify(state)); } catch { /* private mode */ }
    };
    lab.replaceWith(btn);
  });
  toggleSideMenu(document.documentElement.classList.contains('side-mini'));
}

function hydrateIcons(root = document) {
  root.querySelectorAll('[data-icon]').forEach((el) => {
    el.innerHTML = ic(el.dataset.icon, el.classList.contains('logo') ? '' : '');
    el.removeAttribute('data-icon');
  });
}

/* ---------------- formatting ---------------- */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const LOCALE = 'en-AU';
const money = (n) => new Intl.NumberFormat(LOCALE, { style: 'currency', currency: (typeof App !== 'undefined' && App.meta && App.meta.workshop.currency) || 'AUD' }).format(Number(n || 0));
/* 0412345678 -> 0412 345 678 ; 0297481100 -> (02) 9748 1100 */
const fmtPhone = (p) => { const s = String(p || ''); return /^04\d{8}$/.test(s) ? s.replace(/^(\d{4})(\d{3})(\d{3})$/, '$1 $2 $3') : /^0[2378]\d{8}$/.test(s) ? s.replace(/^(\d{2})(\d{4})(\d{4})$/, '($1) $2 $3') : s; };
const fmtDate = (d) => (d ? new Date(d).toLocaleDateString(LOCALE, { day: '2-digit', month: 'short', year: 'numeric' }) : '—');
const fmtDT = (d) => (d ? new Date(d).toLocaleString(LOCALE, { day: '2-digit', month: 'short', hour: 'numeric', minute: '2-digit' }) : '—');
const fmtTime = (d) => new Date(d).toLocaleTimeString(LOCALE, { hour: 'numeric', minute: '2-digit' });
function rel(d) {
  const diff = new Date(d) - Date.now();
  const a = Math.abs(diff), m = Math.round(a / 60000), h = Math.round(a / 3600000), dd = Math.round(a / 86400000);
  const s = m < 60 ? `${m} min` : h < 36 ? `${h} h` : `${dd} days`;
  return diff >= 0 ? `in ${s}` : `${s} ago`;
}
function toLocalInput(d) {
  const x = new Date(d);
  x.setMinutes(x.getMinutes() - x.getTimezoneOffset());
  return x.toISOString().slice(0, 16);
}
const initials = (n) => String(n || '?').split(/\s+/).map((p) => p[0]).slice(0, 2).join('').toUpperCase();

const STAGE_STYLE = { checked_in: 'b-blue', in_progress: 'b-violet', ready_invoice: 'b-amber', ready_delivery: 'b-teal', delivered: 'b-slate' };
function stageBadge(stage) {
  const s = (App.meta?.stages || []).find((x) => x.key === stage);
  return `<span class="badge ${STAGE_STYLE[stage] || ''}"><span class="dot"></span>${esc(s ? s.label : stage)}</span>`;
}
function statusBadge(status) {
  return status === 'closed' ? '<span class="badge b-slate">Closed</span>' : status === 'on_hold' ? '<span class="badge b-amber">On hold</span>' : '<span class="badge b-green">Active</span>';
}
function promisedCell(j) {
  if (j.status === 'closed') return `<span class="muted">${fmtDT(j.promisedAt)}</span>`;
  return j.overdue ? `<span style="color:var(--red);font-weight:600">${fmtDT(j.promisedAt)}</span><div class="small" style="color:var(--red)">Overdue ${rel(j.promisedAt).replace(' ago', '')}</div>` : `${fmtDT(j.promisedAt)}<div class="small muted">${rel(j.promisedAt)}</div>`;
}
function vehLine(v) {
  return v ? `<span class="row" style="gap:8px"><span class="swatch" style="background:${esc(v.hex)}"></span><b>${esc(v.reg)}</b><span class="muted">${esc(v.model)}</span></span>` : '—';
}

/* ---------------- toasts, modal, drawer ---------------- */
function toast(msg, type = '') {
  const el = document.createElement('div');
  el.className = 'toast ' + type;
  el.innerHTML = (type === 'err' ? ic('alert') : `<span style="color:#5eead4">${ic('check')}</span>`) + `<span>${esc(msg)}</span>`;
  $('#toasts').appendChild(el);
  setTimeout(() => el.remove(), type === 'err' ? 4500 : 2600);
}
function openModal({ title, body, foot = '', wide = false, onMount }) {
  $('#layer').innerHTML = `<div class="scrim"><div class="modal ${wide ? 'wide' : ''}" role="dialog" aria-modal="true" aria-label="${esc(title)}">
    <header><h2>${title}</h2><button class="btn ghost icon" onclick="closeModal()" aria-label="Close">${ic('x')}</button></header>
    <div class="mb">${body}</div>${foot ? `<footer>${foot}</footer>` : ''}</div></div>`;
  const scrim = $('#layer .scrim');
  scrim.addEventListener('mousedown', (e) => { if (e.target === scrim) closeModal(); });
  const first = $('#layer .mb input, #layer .mb select, #layer .mb textarea');
  if (first) setTimeout(() => first.focus(), 30);
  onMount && onMount($('#layer .modal'));
}
function openDrawer(title, body) {
  $('#layer').innerHTML = `<div class="scrim" data-close style="padding:0;justify-content:flex-end;align-items:stretch"></div><aside class="drawer" role="dialog" aria-label="${esc(title)}">
    <header class="card-h"><h2>${title}</h2><button class="btn ghost icon" onclick="closeModal()" aria-label="Close">${ic('x')}</button></header><div class="mb">${body}</div></aside>`;
  $('#layer .scrim').addEventListener('click', closeModal);
}
function closeModal() { $('#layer').innerHTML = ''; }
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && $('#layer').innerHTML) closeModal();
  if (e.key === '/' && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) { e.preventDefault(); $('#gsearch')?.focus(); }
});
function confirmBox(title, text, okLabel = 'Confirm', danger = false) {
  return new Promise((resolve) => {
    openModal({ title, body: `<p style="margin:0">${text}</p>`, foot: `<button class="btn" id="cfNo">Cancel</button><button class="btn ${danger ? 'danger' : 'primary'}" id="cfOk">${okLabel}</button>` });
    $('#cfNo').onclick = () => { closeModal(); resolve(false); };
    $('#cfOk').onclick = () => { closeModal(); resolve(true); };
  });
}

/* ---------------- API client ---------------- */
async function api(method, url, body) {
  let r;
  try {
    const headers = body ? { 'Content-Type': 'application/json' } : {};
    const uid = App.authMode === 'dev' && localStorage.getItem('wpUser');
    if (uid) headers['X-User-Id'] = uid;
    const outlet = localStorage.getItem('wpOutlet');
    if (outlet) headers['X-Outlet-Id'] = outlet;
    r = await fetch('/api' + url, { method, headers, body: body ? JSON.stringify(body) : undefined });
  } catch {
    toast('Cannot reach the server. Check your connection.', 'err');
    throw new Error('network');
  }
  const data = await r.json().catch(() => ({}));
  if (r.status === 401 && App.authMode === 'password') {
    showLogin(data.error === 'Please sign in' ? 'Your session has ended. Please sign in again.' : data.error);
    const err = new Error(data.error || 'Please sign in');
    err.status = 401;
    throw err;
  }
  if (r.status === 403 && data.details && data.details.mustChangePassword) {
    changePasswordModal(true).then(() => location.reload());
  }
  if (r.status === 401 && localStorage.getItem('wpUser')) {
    // the chosen user was removed or deactivated: fall back to the default user
    localStorage.removeItem('wpUser');
    toast(data.error || 'Please choose a user again', 'err');
    App.loadMe().then(() => App.render());
  }
  if (!r.ok) {
    const err = new Error(data.error || `Request failed (${r.status})`);
    err.status = r.status;
    err.details = data.details;
    throw err;
  }
  return data;
}
/* run an action with a busy button and error toast; returns result or undefined */
async function act(btn, fn, okMsg) {
  const b = btn instanceof Element ? btn : null;
  const html = b?.innerHTML;
  if (b) { b.disabled = true; b.innerHTML = '<span class="spin"></span>' + (b.textContent.trim() ? ' Saving…' : ''); }
  try {
    const res = await fn();
    if (okMsg) toast(okMsg);
    return res;
  } catch (e) {
    if (e.message !== 'network') toast(e.message, 'err');
    if (e.details?.field) { const f = document.querySelector(`[name="${e.details.field}"]`); f?.classList.add('err'); f?.focus(); }
    return undefined;
  } finally {
    if (b && b.isConnected) { b.disabled = false; b.innerHTML = html; }
  }
}

/* ---------------- router ---------------- */
const App = {
  meta: null,
  routes: [],
  current: null,
  ui: {},
  route(pattern, view) {
    const keys = [];
    const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => (keys.push(k), '([^/]+)')) + '$');
    this.routes.push({ re, keys, view });
  },
  go(hash) { location.hash = hash; },
  async render() {
    const raw = location.hash.replace(/^#/, '') || '/';
    const [path, qs] = raw.split('?');
    const query = new URLSearchParams(qs || '');
    const r = this.routes.find((x) => x.re.test(path)) || this.routes.find((x) => x.re.test('/'));
    const m = path.match(r.re) || [];
    const params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
    const token = (this.current = Symbol());
    const view = $('#view');
    if (!view.dataset.keep) view.innerHTML = `<div class="loading"><div class="skel" style="height:44px;width:40%"></div><div class="skel"></div><div class="skel"></div><div class="skel"></div></div>`;
    delete view.dataset.keep;
    try {
      const out = await r.view(params, query);
      if (token !== this.current) return;
      $('#pageTitle').textContent = out.title;
      document.title = out.title + ' · Workshop Pro';
      $('#backBtn').classList.toggle('hide', !out.back);
      $('#backBtn').onclick = () => (out.back ? App.go(out.back) : history.back());
      $$('[data-nav]').forEach((a) => a.classList.toggle('on', a.dataset.nav === out.nav));
      view.innerHTML = out.html;
      out.after && out.after(view);
    } catch (e) {
      if (token !== this.current) return;
      $('#pageTitle').textContent = e.status === 403 ? 'No access' : 'Error';
      view.innerHTML = `<div class="card empty"><div class="ic">${ic(e.status === 403 ? 'shield' : 'alert', 'lg')}</div><h3>${e.status === 404 ? 'Not found' : e.status === 403 ? 'You don’t have access to this page' : 'Something went wrong'}</h3><p>${esc(e.message)}</p><div class="row" style="gap:8px;justify-content:center"><button class="btn" onclick="userMenu()">${App.authMode === 'password' ? 'Account' : 'Switch user'}</button>${App.can('dashboard.view') ? '<a class="btn" href="#/">Back to dashboard</a>' : ''}</div></div>`;
    }
  },
  /* re-render the current page without the loading skeleton (after an update) */
  refresh() { $('#view').dataset.keep = '1'; return this.render(); },
  me: null,
  can(right) { return !!this.me && this.me.rights.includes(right); },
  async loadMe() {
    try { this.me = await api('GET', '/me'); } catch { this.me = null; }
    const u = this.me?.user;
    $('#meAv').textContent = u ? initials(u.name) : '?';
    $('#meName').textContent = u ? u.name : 'No user';
    $('#meRole').textContent = this.me?.role?.name || '';
    $$('[data-right]').forEach((el) => el.classList.toggle('hide', !this.can(el.dataset.right)));
    return this.me;
  },
  authMode: 'password',
  async start() {
    hydrateIcons();
    initSideMenu();
    try { this.authMode = (await (await fetch('/api/auth/mode')).json()).mode || 'password'; } catch { this.authMode = 'password'; }
    if (this.authMode === 'password') {
      const r = await fetch('/api/me');
      if (r.status === 401) { showLogin(); return; }
    }
    await this.loadMe();
    document.documentElement.classList.remove('booting'); // signed in: show the app
    if (typeof App.loadClock === 'function') await App.loadClock();
    if (this.me && this.me.mustChangePassword) { await changePasswordModal(true); location.reload(); return; }
    $('#meBox').title = this.authMode === 'password' ? 'Account' : 'Switch user';
    try { this.meta = await api('GET', '/meta'); $('#wsName').textContent = this.meta.workshop.name; } catch { /* shown by toast */ }
    if (typeof initBranchPicker === 'function') initBranchPicker();
    updateBrandbar();
    // the app always opens on the Dashboard (or the first screen this user is allowed to see)
    const home = this.can('dashboard.view') ? '#/' : this.can('jobs.view') ? '#/jobs' : '#/settings';
    if ((location.hash || '#/') !== home) history.replaceState(null, '', location.pathname + location.search + home);
    window.addEventListener('hashchange', () => { closeModal(); this.render().then(() => window.scrollTo(0, 0)); });
    $('#gsearch').addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.value.trim()) { App.go('#/walkin?q=' + encodeURIComponent(e.target.value.trim())); e.target.value = ''; e.target.blur(); } });
    this.updateBadges();
    this.render();
  },
  async updateBadges() {
    if (!this.can('dashboard.view')) return;
    try {
      const d = await api('GET', '/dashboard');
      const el = $('#navApprovals');
      el.textContent = d.kpis.pendingApprovals;
      el.classList.toggle('hide', !d.kpis.pendingApprovals);
      const ls = $('#navLowStock');
      ls.textContent = d.kpis.lowStockParts;
      ls.classList.toggle('hide', !d.kpis.lowStockParts);
    } catch {}
  },
};

/* simple vehicle illustration used in a few places */
function carSvg(hex = '#64748b', w = 120) {
  return `<svg width="${w}" viewBox="0 0 224 100" aria-hidden="true"><ellipse cx="112" cy="92" rx="94" ry="5" fill="#0f172a" opacity=".1"/>
    <path d="M18 66 L18 58 L104 58 L114 34 Q116 30 122 30 L168 30 Q176 30 180 38 L194 58 L204 62 Q210 64 210 72 L210 84 L14 84 L14 72 Q14 66 18 66Z" fill="${esc(hex)}" stroke="rgba(0,0,0,.15)"/>
    <path d="M122 38 L144 38 L144 56 L116 56Z M150 38 L168 38 Q172 38 174 42 L182 56 L150 56Z" fill="#dbeafe" opacity=".9"/>
    <circle cx="54" cy="84" r="14" fill="#1f2937"/><circle cx="54" cy="84" r="6" fill="#9ca3af"/><circle cx="170" cy="84" r="14" fill="#1f2937"/><circle cx="170" cy="84" r="6" fill="#9ca3af"/></svg>`;
}

/* ---------- CloudMesh brand bar: country flag + currency from the workshop profile ---------- */
const COUNTRIES = { AU: 'Australia', NZ: 'New Zealand', IN: 'India', GB: 'United Kingdom', US: 'United States' };
function starPts(cx, cy, R, r, n) { const p = []; for (let i = 0; i < n * 2; i++) { const a = (Math.PI * i) / n - Math.PI / 2; const d = i % 2 ? r : R; p.push((cx + d * Math.cos(a)).toFixed(1) + ',' + (cy + d * Math.sin(a)).toFixed(1)); } return p.join(' '); }
function flagSvg(code) {
  if (code === 'AU' || code === 'NZ') {
    // blue ensign: Union Jack in the canton + stars (Australia: Commonwealth Star + Southern Cross; NZ: four red stars)
    const uj = '<clipPath id="ujc"><path d="M0 0h60v30H0z"/></clipPath><g clip-path="url(#ujc)"><path d="M0 0l60 30M60 0L0 30" stroke="#fff" stroke-width="6"/><path d="M0 0l60 30M60 0L0 30" stroke="#C8102E" stroke-width="2.4"/><path d="M30 0v30M0 15h60" stroke="#fff" stroke-width="10"/><path d="M30 0v30M0 15h60" stroke="#C8102E" stroke-width="6"/></g>';
    const stars = code === 'AU'
      ? '<polygon fill="#fff" points="' + starPts(30, 45, 9, 4.2, 7) + '"/>' + [[90, 48, 4.5], [75, 27, 4.5], [90, 10, 4.5], [104, 23, 4.5]].map(([x, y, s]) => '<polygon fill="#fff" points="' + starPts(x, y, s, s * 0.45, 7) + '"/>').join('') + '<polygon fill="#fff" points="' + starPts(97, 32, 2.6, 1.2, 5) + '"/>'
      : [[90, 48], [76, 27], [90, 10], [103, 23]].map(([x, y]) => '<polygon fill="#C8102E" stroke="#fff" stroke-width="1" points="' + starPts(x, y, 4.6, 1.9, 5) + '"/>').join('');
    return '<svg viewBox="0 0 120 60" aria-hidden="true"><rect width="120" height="60" fill="#012169"/>' + uj + stars + '</svg>';
  }
  if (code === 'IN') return '<svg viewBox="0 0 30 20" aria-hidden="true"><rect width="30" height="20" fill="#fff"/><rect width="30" height="6.67" fill="#FF9933"/><rect y="13.33" width="30" height="6.67" fill="#138808"/><circle cx="15" cy="10" r="2.6" fill="none" stroke="#000080" stroke-width=".6"/></svg>';
  return '<svg viewBox="0 0 30 15" aria-hidden="true"><rect width="30" height="15" fill="#64748b"/><text x="15" y="11" font-size="9" text-anchor="middle" fill="#fff" font-family="sans-serif">' + esc(code) + '</text></svg>';
}
function updateBrandbar() {
  const w = (typeof App !== 'undefined' && App.meta && App.meta.workshop) || {};
  const code = (w.country || (App.meta && App.meta.country) || 'AU').toUpperCase();
  const cur = w.currency || 'AUD';
  const locale = w.locale || 'en-AU';
  let sym = '$';
  try { sym = new Intl.NumberFormat(locale, { style: 'currency', currency: cur, currencyDisplay: 'narrowSymbol' }).formatToParts(0).find((p) => p.type === 'currency').value; } catch {}
  const f = document.getElementById('bbFlag');
  if (f) f.innerHTML = flagSvg(code);
  const n = document.getElementById('bbCname'); if (n) n.textContent = COUNTRIES[code] || code;
  const s = document.getElementById('bbSym'); if (s) s.textContent = sym;
  const k = document.getElementById('bbCode'); if (k) k.textContent = cur;
  const chip = document.getElementById('bbCur'); if (chip) chip.title = 'All amounts are in ' + cur + (cur === 'AUD' ? ' (Australian dollars), GST inclusive totals shown on invoices' : '');
}
document.addEventListener('DOMContentLoaded', updateBrandbar);

/* ---------------- listings: List / Tiles view and pages that fit the screen ----------------
   Every listing table (table.tbl.rt) gets a bar under it with the page controls and a
   List / Tiles switch. A page holds as many rows (or tiles) as fit on the screen, so you
   page through a listing instead of scrolling. The view choice is remembered per device. */
const LV = { mode: (() => { try { return localStorage.getItem('wpListView') || 'list'; } catch { return 'list'; } })(), pages: {} };
const lvTables = () => [...document.querySelectorAll('#view table.tbl.rt')];
const lvKey = (tbl) => location.hash.split('?')[0] + ':' + lvTables().indexOf(tbl);
function lvSetMode(mode) {
  LV.mode = mode;
  try { localStorage.setItem('wpListView', mode); } catch { /* private mode */ }
  lvTables().forEach((t) => lvPage(t));
}
function lvGo(btn, dir) {
  const tbl = btn.closest('.lv-pager').__tbl;
  if (!tbl) return;
  LV.pages[lvKey(tbl)] = (LV.pages[lvKey(tbl)] || 0) + dir;
  lvPage(tbl);
  const top = (tbl.closest('.card') || tbl).getBoundingClientRect().top;
  if (top < 0) window.scrollBy({ top: top - 90 });
}
/* how many rows / tiles fit between the top of the listing and the bottom of the screen */
function lvFit(tbl, rows) {
  const body = tbl.tBodies[0];
  const phone = window.innerWidth <= 720;
  const reserve = 58 + (phone ? 76 : 16); // the page bar, plus the phone's bottom menu
  const top = Math.max(body.getBoundingClientRect().top + window.scrollY, phone ? 120 : 150);
  const avail = window.innerHeight - Math.min(top, window.innerHeight * 0.55) - reserve;
  const sample = rows.slice(0, 6);
  if (!sample.length) return { size: 10, h: 48, step: 1, min: 10 };
  if (tbl.classList.contains('tiles') && !phone) {
    const cols = Math.max(1, getComputedStyle(body).gridTemplateColumns.split(' ').filter(Boolean).length);
    const h = Math.max(...sample.map((r) => r.getBoundingClientRect().height)) + 12;
    return { size: cols * Math.max(1, Math.floor(avail / h)), h, step: cols, min: cols };
  }
  const h = sample.reduce((s, r) => s + r.getBoundingClientRect().height, 0) / sample.length || 48;
  const min = 3;
  return { size: Math.max(min, Math.floor(avail / h)), h, step: 1, min };
}
function lvPage(tbl, resetPage, again) {
  const body = tbl.tBodies[0];
  if (!body || !tbl.__lv) return;
  tbl.classList.toggle('tiles', LV.mode === 'tiles');
  const all = [...body.rows];
  const rows = all.filter((r) => !r.classList.contains('hide'));
  // measure with only a few rows showing, so a temporary scrollbar can't change the layout
  all.forEach((r) => (r.style.display = 'none'));
  rows.slice(0, 3).forEach((r) => (r.style.display = ''));
  const fit = lvFit(tbl, rows.slice(0, 3));
  let size = fit.size, pages, p;
  const key = lvKey(tbl);
  const want = resetPage ? 0 : LV.pages[key] || 0;
  const apply = () => {
    pages = Math.max(1, Math.ceil(rows.length / size));
    p = Math.min(Math.max(0, want), pages - 1);
    rows.forEach((r, i) => (r.style.display = i < p * size || i >= (p + 1) * size ? 'none' : ''));
  };
  apply();
  // measure the real page and drop rows until it fits the screen without scrolling
  for (let i = 0; i < 6; i++) {
    const over = document.documentElement.scrollHeight - window.innerHeight;
    if (over <= 1 || size <= fit.min) break;
    size = Math.max(fit.min, size - Math.max(fit.step, Math.ceil(over / fit.h / fit.step) * fit.step));
    apply();
  }
  LV.pages[key] = p;
  // tiles: hiding rows can remove the scrollbar and make room for another column – measure once more
  if (!again && tbl.classList.contains('tiles') && fit.step > 0) {
    const cols = getComputedStyle(body).gridTemplateColumns.split(' ').filter(Boolean).length;
    if (cols !== fit.step) return lvPage(tbl, false, true);
  }
  const from = rows.length ? p * size + 1 : 0, to = Math.min(rows.length, (p + 1) * size);
  const bar = tbl.__lv;
  bar.innerHTML = `<span class="small muted">${rows.length ? `${from}–${to} of ${rows.length}` : 'Nothing to show'}</span>
    ${pages > 1 ? `<div class="row lv-pages" style="gap:4px"><button class="btn sm icon" onclick="lvGo(this,-1)" ${p ? '' : 'disabled'} aria-label="Previous page">${ic('back', 'sm')}</button><span class="small" style="min-width:70px;text-align:center">Page ${p + 1} of ${pages}</span><button class="btn sm icon" onclick="lvGo(this,1)" ${p < pages - 1 ? '' : 'disabled'} aria-label="Next page" style="transform:scaleX(-1)">${ic('back', 'sm')}</button></div>` : '<span></span>'}
    <div class="seg lv-mode" role="group" aria-label="View"><button class="${LV.mode === 'list' ? 'on' : ''}" onclick="lvSetMode('list')" title="List view">${ic('menu', 'sm')}<span>List</span></button><button class="${LV.mode === 'tiles' ? 'on' : ''}" onclick="lvSetMode('tiles')" title="Tile view">${ic('grid', 'sm')}<span>Tiles</span></button></div>`;
  bar.__tbl = tbl;
}
function lvEnhance(tbl) {
  if (tbl.__lv) return;
  const host = tbl.closest('.tbl-wrap') || tbl;
  const bar = document.createElement('div');
  bar.className = 'lv-pager';
  host.after(bar);
  tbl.__lv = bar;
  lvPage(tbl);
  lvPage(tbl); // again, now that the page bar has its height
}
(function lvWatch() {
  let queued = new Set(), reset = new Set(), timer = null;
  const run = () => {
    timer = null;
    lvTables().forEach((t) => { if (!t.__lv) lvEnhance(t); });
    queued.forEach((t) => t.isConnected && t.__lv && lvPage(t, reset.has(t)));
    queued = new Set(); reset = new Set();
  };
  const kick = () => { if (!timer) timer = setTimeout(run, 0); };
  new MutationObserver((recs) => {
    for (const r of recs) {
      if (r.type === 'attributes') { // a filter showed or hid rows
        if (r.target.tagName === 'TR') { const t = r.target.closest('table.tbl.rt'); if (t) { queued.add(t); reset.add(t); kick(); } }
        continue;
      }
      if (r.target.closest && r.target.closest('.lv-pager')) continue;
      if ([...r.addedNodes].some((n) => n.nodeType === 1 && (n.matches('table.tbl.rt, tr') || n.querySelector('table.tbl.rt')))) {
        const t = r.target.closest && r.target.closest('table.tbl.rt');
        if (t) queued.add(t);
        kick();
      }
    }
  }).observe(document.getElementById('view') || document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
  let rt;
  window.addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(() => lvTables().forEach((t) => lvPage(t)), 150); });
})();
