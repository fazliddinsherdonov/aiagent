/* ════════════════════════════════════════════════════
   Xodimlar Boshqaruvi - Frontend SPA
════════════════════════════════════════════════════ */

const API = '/api';
let state = {
  token: localStorage.getItem('token'),
  user: JSON.parse(localStorage.getItem('user') || 'null'),
  currentPanel: null,
  currentTab: null,
};

/* ── Utils ──────────────────────────────────────── */
function showLoader() { document.getElementById('loader').classList.remove('hidden'); }
function hideLoader() { document.getElementById('loader').classList.add('hidden'); }
function showPage(id) {
  ['login-page','owner-panel','admin-panel','worker-panel'].forEach(p => {
    const el = document.getElementById(p);
    el.classList.toggle('hidden', p !== id);
  });
}

let toastTimer;
function showToast(msg, type = 'info') {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = `toast show ${type}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 3000);
}

async function http(method, url, body = null, isForm = false) {
  const opts = {
    method,
    headers: { 'Authorization': state.token ? `Bearer ${state.token}` : '' }
  };
  if (body && !isForm) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  } else if (body && isForm) {
    opts.body = body;
  }
  const res = await fetch(API + url, opts);
  const data = await res.json();
  if (!res.ok) {
    const err = new Error(data.error || 'Xato yuz berdi');
    err.duplicate = data.duplicate || false;
    err.sent_at = data.sent_at || null;
    throw err;
  }
  return data;
}

function togglePass(inputId, btn) {
  const inp = document.getElementById(inputId);
  if (inp.type === 'password') {
    inp.type = 'text';
    btn.innerHTML = '<i class="fas fa-eye-slash"></i>';
  } else {
    inp.type = 'password';
    btn.innerHTML = '<i class="fas fa-eye"></i>';
  }
}

function formatDate(dt) {
  if (!dt) return '—';
  const d = new Date(dt);
  return d.toLocaleString('uz-UZ', { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit' });
}
function formatDateShort(dt) {
  if (!dt) return '—';
  const d = new Date(dt);
  return d.toLocaleDateString('uz-UZ', { day:'2-digit', month:'short' });
}
function avatarHtml(user, size = 48) {
  if (user && user.avatar) {
    return `<img src="${user.avatar}" alt="${user.first_name}" style="width:${size}px;height:${size}px;object-fit:cover;border-radius:50%">`;
  }
  const initials = user ? `${user.first_name?.[0]||''}${user.last_name?.[0]||''}` : '?';
  return `<span style="font-size:${size*0.4}px;font-weight:700">${initials}</span>`;
}

/* ── Modal ──────────────────────────────────────── */
function openModal(title, bodyHtml) {
  document.getElementById('modal-title').textContent = title;
  document.getElementById('modal-body').innerHTML = bodyHtml;
  document.getElementById('modal-overlay').classList.remove('hidden');
}
function closeModal(e) {
  if (e && e.target !== document.getElementById('modal-overlay')) return;
  closeModalForce();
}
function closeModalForce() {
  document.getElementById('modal-overlay').classList.add('hidden');
  document.getElementById('modal-body').innerHTML = '';
}
function previewImage(src) {
  document.getElementById('img-preview-src').src = src;
  document.getElementById('img-preview').classList.remove('hidden');
}

/* ── Auth ────────────────────────────────────────── */
async function doLogin() {
  const activeRole = document.querySelector('.role-tab.active')?.dataset.role || 'worker';
  let identifier = '';
  let id_type = 'telegram';
  let password = '';

  if (activeRole === 'owner') {
    // Ega: telefon + parol
    const phone = document.getElementById('login-phone')?.value.trim() || '';
    password = document.getElementById('login-pass')?.value || '';
    if (!phone) return showToast('Telefon raqamini kiriting', 'error');
    if (!password) return showToast('Parolni kiriting', 'error');
    identifier = '+998' + phone;
    id_type = 'phone';
  } else {
    // Xodim / Admin / Superadmin: faqat Telegram ID
    identifier = document.getElementById('login-tgid')?.value.trim() || '';
    id_type = 'telegram';
    if (!identifier) return showToast('Telegram ID ni kiriting', 'error');
  }

  showLoader();
  try {
    const data = await http('POST', '/auth/login', { identifier, id_type, password });
    state.token = data.token;
    state.user = data.user;
    localStorage.setItem('token', state.token);
    localStorage.setItem('user', JSON.stringify(state.user));
    showToast(`Xush kelibsiz, ${data.user.first_name}!`, 'success');
    loadDashboard();
  } catch (err) {
    showToast(err.message, 'error');
  } finally {
    hideLoader();
  }
}

document.addEventListener('keydown', e => {
  if (e.key === 'Enter' && document.getElementById('login-page') && !document.getElementById('login-page').classList.contains('hidden')) {
    doLogin();
  }
});

async function tryTelegramAuth() {
  const tg = window.Telegram?.WebApp;
  if (!tg || !tg.initData) return false;
  tg.ready();
  tg.expand();
  try {
    const data = await http('POST', '/auth/telegram', { initData: tg.initData });
    state.token = data.token;
    state.user = data.user;
    localStorage.setItem('token', state.token);
    localStorage.setItem('user', JSON.stringify(state.user));
    return true;
  } catch (err) {
    // 404 - registered emas, login sahifasini ko'rsat
    return false;
  }
}

function doLogout() {
  state.token = null;
  state.user = null;
  localStorage.removeItem('token');
  localStorage.removeItem('user');
  showPage('login-page');
  showToast("Tizimdan chiqildi");
}

// Role tab switcher
document.querySelectorAll('.role-tab').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.role-tab').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    const role = btn.dataset.role;
    const workerField = document.getElementById('field-worker');
    const adminField  = document.getElementById('field-admin-owner');
    if (role === 'owner') {
      if (workerField) workerField.style.display = 'none';
      if (adminField)  adminField.style.display  = 'block';
    } else {
      // worker, admin, superadmin: telegram id
      if (workerField) workerField.style.display = 'block';
      if (adminField)  adminField.style.display  = 'none';
      // clear tgid input
      const tgEl = document.getElementById('login-tgid');
      if (tgEl) tgEl.value = '';
    }
  });
});

/* ── Init ────────────────────────────────────────── */
async function init() {
  showLoader();

  // Try Telegram WebApp auth
  const tgOk = await tryTelegramAuth();

  if (!tgOk && state.token && state.user) {
    // Validate existing token
    try {
      const me = await http('GET', '/auth/me');
      state.user = me;
      localStorage.setItem('user', JSON.stringify(me));
    } catch {
      state.token = null;
      state.user = null;
      localStorage.clear();
    }
  }

  if (state.token && state.user) {
    loadDashboard();
  } else {
    showPage('login-page');
  }

  hideLoader();
}

function loadDashboard() {
  const role = state.user.role;
  if (role === 'owner' || role === 'superadmin') {
    showPage('owner-panel');
    setUserBar('owner');
    ownerTab('dashboard', document.querySelector('#owner-panel .nav-item[data-tab="dashboard"]'));
  } else if (role === 'admin') {
    showPage('admin-panel');
    setUserBar('admin');
    adminTab('dashboard', document.querySelector('#admin-panel .nav-item[data-tab="dashboard"]'));
  } else {
    showPage('worker-panel');
    setUserBar('worker');
    workerTab('home', document.querySelector('#worker-panel .nav-item[data-tab="home"]'));
  }
}

function setUserBar(panel) {
  const u = state.user;
  const nameEl = document.getElementById(`${panel}-name-bar`);
  const avatarEl = document.getElementById(`${panel}-avatar-bar`);
  if (nameEl) nameEl.textContent = `${u.first_name} ${u.last_name}`;
  if (avatarEl) {
    if (u.avatar) {
      avatarEl.innerHTML = `<img src="${u.avatar}" alt="${u.first_name}">`;
    } else {
      const icon = u.role === 'owner' ? 'crown' : u.role === 'superadmin' ? 'star' : u.role === 'admin' ? 'user-tie' : 'user';
      avatarEl.innerHTML = `<i class="fas fa-${icon}"></i>`;
    }
  }
}

/* ════════════════════════════════════════════════════
   OWNER PANEL
════════════════════════════════════════════════════ */
function ownerTab(tab, btn) {
  document.querySelectorAll('#owner-panel .nav-item').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  state.currentTab = tab;

  const content = document.getElementById('owner-content');
  content.innerHTML = '<div style="text-align:center;padding:40px"><div class="loader-spinner" style="margin:auto;border-color:var(--border);border-top-color:var(--primary)"></div></div>';

  if (tab === 'dashboard') renderOwnerDashboard();
  else if (tab === 'workers') renderOwnerWorkers();
  else if (tab === 'admins') renderOwnerAdmins();
  else if (tab === 'stats') renderOwnerStats();
  else if (tab === 'settings') renderOwnerSettings();
}

async function renderOwnerDashboard() {
  try {
    const { stats, dailyChart } = await http('GET', '/owner/stats');
    const logs = await http('GET', '/owner/logs?period=today');
    document.getElementById('owner-content').innerHTML = `
      <div class="fade-in">
        <div class="stats-grid">
          <div class="stat-card blue">
            <div class="stat-icon"><i class="fas fa-users"></i></div>
            <div class="stat-value">${stats.totalWorkers}</div>
            <div class="stat-label">Xodimlar</div>
          </div>
          <div class="stat-card purple">
            <div class="stat-icon"><i class="fas fa-user-shield"></i></div>
            <div class="stat-value">${stats.totalAdmins}</div>
            <div class="stat-label">Adminlar</div>
          </div>
          <div class="stat-card green">
            <div class="stat-icon"><i class="fas fa-user-check"></i></div>
            <div class="stat-value">${stats.todayActive}</div>
            <div class="stat-label">Bugun faol</div>
          </div>
          <div class="stat-card orange">
            <div class="stat-icon"><i class="fas fa-camera"></i></div>
            <div class="stat-value">${stats.todayPhotos}</div>
            <div class="stat-label">Bugungi rasmlar</div>
          </div>
        </div>

        <div class="card">
          <div class="card-header">
            <span class="card-title"><i class="fas fa-chart-bar"></i> Haftalik faollik</span>
          </div>
          ${renderChart(dailyChart)}
        </div>

        <div class="card">
          <div class="card-header">
            <span class="card-title"><i class="fas fa-history"></i> Bugungi faoliyat</span>
          </div>
          ${logs.length === 0 ? '<div class="empty-state"><i class="fas fa-inbox"></i><p>Bugun faoliyat yoq</p></div>'
            : logs.map(l => logItemHtml(l)).join('')}
        </div>
      </div>`;
  } catch (err) {
    document.getElementById('owner-content').innerHTML = `<div class="empty-state"><i class="fas fa-exclamation-triangle"></i><p>${err.message}</p></div>`;
  }
}

function renderChart(data) {
  if (!data || data.length === 0) return '<p style="color:var(--text3);font-size:0.85rem;padding:8px 0">Ma\'lumot yoq</p>';
  const max = Math.max(...data.map(d => d.count), 1);
  return `
    <div class="chart-container">
      <div class="chart-bars">
        ${data.map(d => `
          <div class="chart-bar-wrap">
            <div class="chart-count">${d.count}</div>
            <div class="chart-bar" style="height:${Math.round((d.count/max)*80)+4}px" title="${d.count}"></div>
            <div class="chart-label">${d.date ? d.date.slice(5) : d.month || ''}</div>
          </div>`).join('')}
      </div>
    </div>`;
}

function logItemHtml(l) {
  return `
    <div class="log-item">
      <div class="log-icon photo"><i class="fas fa-camera"></i></div>
      <div class="log-info">
        <div class="log-name">${l.first_name} ${l.last_name}</div>
        <div class="log-time">${formatDate(l.created_at)}${l.note ? ' · ' + l.note : ''}</div>
      </div>
      ${l.photo_path ? `<img class="log-img" src="${l.photo_path}" onclick="previewImage('${l.photo_path}')">` : ''}
    </div>`;
}

async function renderOwnerWorkers() {
  try {
    const workers = await http('GET', '/owner/workers');
    document.getElementById('owner-content').innerHTML = `
      <div class="fade-in">
        <div class="section-header">
          <span class="section-title"><i class="fas fa-users" style="color:var(--primary)"></i> Xodimlar (${workers.length})</span>
          <button class="btn btn-primary btn-sm" onclick="openAddUserModal('worker','owner')">
            <i class="fas fa-plus"></i> Qo'shish
          </button>
        </div>
        <div class="search-bar">
          <i class="fas fa-search"></i>
          <input type="text" placeholder="Qidirish..." oninput="filterUsers(this.value,'worker-list')">
        </div>
        <div class="user-list" id="worker-list">
          ${workers.length === 0
            ? '<div class="empty-state"><i class="fas fa-users"></i><p>Xodimlar yoq</p></div>'
            : workers.map(w => workerCardHtml(w, 'owner')).join('')}
        </div>
      </div>`;
  } catch (err) {
    document.getElementById('owner-content').innerHTML = errorHtml(err.message);
  }
}

function workerCardHtml(w, panel) {
  const blocked = w.is_blocked;
  return `
    <div class="user-card fade-in" id="user-card-${w.id}" data-name="${w.first_name} ${w.last_name}">
      <div class="user-avatar">${avatarHtml(w)}</div>
      <div class="user-info">
        <div class="user-name">${w.first_name} ${w.last_name}
          ${blocked ? '<span class="badge badge-danger" style="margin-left:6px">Bloklangan</span>' : ''}
        </div>
        <div class="user-meta">
          ${w.phone ? `<span><i class="fas fa-phone"></i> ${w.phone}</span> ` : ''}
          ${w.telegram_id ? `<span><i class="fab fa-telegram"></i> ${w.telegram_id}</span>` : ''}
          ${w.username ? `<span><i class="fas fa-at"></i> ${w.username}</span>` : ''}
        </div>
      </div>
      <div class="user-actions">
        <button class="btn btn-outline btn-sm" onclick="openEditUserModal(${w.id},'worker','${panel}')" title="Tahrirlash">
          <i class="fas fa-edit"></i>
        </button>
        <button class="btn ${blocked ? 'btn-success' : 'btn-warning'} btn-sm" onclick="toggleBlock(${w.id},'worker','${panel}')" title="${blocked ? 'Ochish' : 'Bloklash'}">
          <i class="fas fa-${blocked ? 'lock-open' : 'ban'}"></i>
        </button>
        <button class="btn btn-danger btn-sm" onclick="deleteUser(${w.id},'worker','${panel}')" title="O'chirish">
          <i class="fas fa-trash"></i>
        </button>
      </div>
    </div>`;
}

function adminCardHtml(a) {
  const blocked = a.is_blocked;
  return `
    <div class="user-card fade-in" id="user-card-${a.id}" data-name="${a.first_name} ${a.last_name}">
      <div class="user-avatar">${avatarHtml(a)}</div>
      <div class="user-info">
        <div class="user-name">${a.first_name} ${a.last_name}
          ${blocked ? '<span class="badge badge-danger" style="margin-left:6px">Bloklangan</span>' : ''}
        </div>
        <div class="user-meta">
          ${a.phone ? `<span><i class="fas fa-phone"></i> ${a.phone}</span> ` : ''}
          ${a.telegram_id ? `<span><i class="fab fa-telegram"></i> ${a.telegram_id}</span>` : ''}
        </div>
        <div class="user-meta" style="font-size:0.72rem;color:var(--text3)">
          <span><i class="fas fa-calendar-alt"></i> ${formatDate(a.created_at)}</span>
        </div>
      </div>
      <div class="user-actions">
        <button class="btn btn-outline btn-sm" onclick="openEditUserModal(${a.id},'admin','owner')" title="Tahrirlash">
          <i class="fas fa-edit"></i>
        </button>
        <button class="btn ${blocked ? 'btn-success' : 'btn-warning'} btn-sm" onclick="toggleBlock(${a.id},'admin','owner')" title="${blocked ? 'Ochish' : 'Bloklash'}">
          <i class="fas fa-${blocked ? 'lock-open' : 'ban'}"></i>
        </button>
        <button class="btn btn-danger btn-sm" onclick="deleteUser(${a.id},'admin','owner')" title="O'chirish">
          <i class="fas fa-trash"></i>
        </button>
      </div>
    </div>`;
}

async function renderOwnerAdmins() {
  try {
    const admins = await http('GET', '/owner/admins');
    document.getElementById('owner-content').innerHTML = `
      <div class="fade-in">
        <div class="section-header">
          <span class="section-title"><i class="fas fa-user-shield" style="color:var(--primary)"></i> Adminlar (${admins.length})</span>
          <button class="btn btn-primary btn-sm" onclick="openAddUserModal('admin','owner')">
            <i class="fas fa-plus"></i> Qo'shish
          </button>
        </div>
        <div class="search-bar">
          <i class="fas fa-search"></i>
          <input type="text" placeholder="Qidirish..." oninput="filterUsers(this.value,'admin-list')">
        </div>
        <div class="user-list" id="admin-list">
          ${admins.length === 0
            ? '<div class="empty-state"><i class="fas fa-user-shield"></i><p>Adminlar yoq</p></div>'
            : admins.map(a => adminCardHtml(a)).join('')}
        </div>
      </div>`;
  } catch (err) {
    document.getElementById('owner-content').innerHTML = errorHtml(err.message);
  }
}

async function renderOwnerStats() {
  document.getElementById('owner-content').innerHTML = `
    <div class="fade-in">
      <div class="period-tabs">
        <button class="period-tab active" onclick="loadStats('today',this,'owner')">Bugun</button>
        <button class="period-tab" onclick="loadStats('week',this,'owner')">Hafta</button>
        <button class="period-tab" onclick="loadStats('month',this,'owner')">Oy</button>
      </div>
      <div id="stats-content"></div>
    </div>`;
  loadStats('today', document.querySelector('.period-tab.active'), 'owner');
}

async function loadStats(period, btn, panel) {
  document.querySelectorAll('.period-tab').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');

  const el = document.getElementById('stats-content');
  el.innerHTML = '<div style="text-align:center;padding:24px"><div class="loader-spinner" style="margin:auto;border-color:var(--border);border-top-color:var(--primary)"></div></div>';

  try {
    const data = await http('GET', `/stats/${period}`);
    const { logs, chart, summary } = data;
    el.innerHTML = `
      <div class="stats-grid" style="margin-bottom:16px">
        <div class="stat-card green">
          <div class="stat-icon"><i class="fas fa-user-check"></i></div>
          <div class="stat-value">${summary.todayActive}</div>
          <div class="stat-label">Faol xodimlar</div>
        </div>
        <div class="stat-card orange">
          <div class="stat-icon"><i class="fas fa-camera"></i></div>
          <div class="stat-value">${summary.todayPhotos}</div>
          <div class="stat-label">Rasmlar</div>
        </div>
      </div>
      <div class="card" style="margin-bottom:16px">
        <div class="card-header"><span class="card-title"><i class="fas fa-chart-line"></i> Faollik grafigi</span></div>
        ${renderChart(chart)}
      </div>
      <div class="card">
        <div class="card-header"><span class="card-title"><i class="fas fa-list"></i> Faoliyat tarixi (${logs.length})</span></div>
        ${logs.length === 0
          ? '<div class="empty-state"><i class="fas fa-inbox"></i><p>Ma\'lumot yoq</p></div>'
          : logs.map(l => logItemHtml(l)).join('')}
      </div>`;
  } catch (err) {
    el.innerHTML = errorHtml(err.message);
  }
}

async function renderOwnerSettings() {
  try {
    const settings = await http('GET', '/owner/settings');
    const isOwner = state.user.role === 'owner';

    document.getElementById('owner-content').innerHTML = `
      <div class="fade-in">

        ${isOwner ? `
        <div class="settings-section">
          <div class="settings-section-title">Bot sozlamalari</div>
          <div class="card">
            <div class="form-group">
              <label><i class="fab fa-telegram"></i> Bot Token</label>
              <div class="input-icon-right">
                <input type="password" id="s-bot-token" value="${settings.bot_token || ''}" placeholder="123456:ABC-DEF...">
                <button type="button" class="eye-btn" onclick="togglePass('s-bot-token',this)"><i class="fas fa-eye"></i></button>
              </div>
            </div>
            <div class="form-group" style="margin-top:12px">
              <label><i class="fas fa-hashtag"></i> Kanal ID (ixtiyoriy)</label>
              <input type="text" id="s-channel-id" value="${settings.channel_id || ''}" placeholder="@kanalname yoki -100123456789">
            </div>
          </div>
        </div>` : `
        <div class="settings-section">
          <div class="card" style="background:var(--bg);border:1.5px solid var(--border)">
            <p style="font-size:0.85rem;color:var(--text3);margin:0">
              <i class="fas fa-lock" style="color:var(--warning)"></i>
              Bot token va kanal sozlamalari faqat <b>Ega</b> tomonidan o'zgartirilishi mumkin.
            </p>
          </div>
        </div>`}

        <div class="settings-section">
          <div class="settings-section-title">Ilova sozlamalari</div>
          <div class="card">
            <div class="form-group">
              <label><i class="fas fa-tag"></i> Ilova nomi</label>
              <input type="text" id="s-app-name" value="${settings.app_name || ''}" placeholder="Xodimlar Boshqaruvi">
            </div>
            ${isOwner ? `
            <div class="form-group" style="margin-top:12px">
              <label><i class="fas fa-link"></i> Mini App URL</label>
              <input type="text" id="s-app-url" value="${settings.app_url || ''}" placeholder="https://yoursite.com">
            </div>` : ''}
          </div>
        </div>

        <button class="btn btn-primary btn-full" onclick="saveSettings()" style="margin-bottom:12px">
          <i class="fas fa-save"></i> Saqlash
        </button>

        ${isOwner ? `
        <div class="settings-section">
          <div class="settings-section-title"><i class="fas fa-robot" style="color:var(--primary)"></i> AI Yordamchi</div>
          <div class="card">
            <p style="font-size:0.8rem;color:var(--text3);margin-bottom:14px">
              <i class="fas fa-info-circle" style="color:var(--primary)"></i>
              Kamida 1 ta kalit kiriting. Biri ishlamasa avtomatik keyingisiga o'tadi.
            </p>

            <div class="form-group">
              <label style="display:flex;justify-content:space-between">
                <span><i class="fas fa-gem" style="color:#4285f4"></i> Google Gemini API</span>
                <a href="https://aistudio.google.com" target="_blank" style="font-size:0.75rem;color:var(--primary)">Bepul kalit olish →</a>
              </label>
              <div class="input-icon-right">
                <input type="password" id="s-gemini-key" value="${settings.gemini_api_key || ''}" placeholder="AIza...">
                <button type="button" class="eye-btn" onclick="togglePass('s-gemini-key',this)"><i class="fas fa-eye"></i></button>
              </div>
              <small style="color:var(--text3);font-size:0.72rem">Bepul • 1500 req/kun</small>
            </div>

            <div class="form-group" style="margin-top:12px">
              <label style="display:flex;justify-content:space-between">
                <span><i class="fas fa-bolt" style="color:#f55036"></i> Groq API</span>
                <a href="https://console.groq.com" target="_blank" style="font-size:0.75rem;color:var(--primary)">Bepul kalit olish →</a>
              </label>
              <div class="input-icon-right">
                <input type="password" id="s-groq-key" value="${settings.groq_api_key || ''}" placeholder="gsk_...">
                <button type="button" class="eye-btn" onclick="togglePass('s-groq-key',this)"><i class="fas fa-eye"></i></button>
              </div>
              <small style="color:var(--text3);font-size:0.72rem">Bepul • 14400 req/kun • Juda tez</small>
            </div>

            <div class="form-group" style="margin-top:12px">
              <label style="display:flex;justify-content:space-between">
                <span><i class="fas fa-brain" style="color:#c96442"></i> Claude (Anthropic) API</span>
                <a href="https://console.anthropic.com" target="_blank" style="font-size:0.75rem;color:var(--primary)">Kalit olish →</a>
              </label>
              <div class="input-icon-right">
                <input type="password" id="s-claude-key" value="${settings.claude_api_key || ''}" placeholder="sk-ant-...">
                <button type="button" class="eye-btn" onclick="togglePass('s-claude-key',this)"><i class="fas fa-eye"></i></button>
              </div>
              <small style="color:var(--text3);font-size:0.72rem">Pullik • Eng aqlli • Rasm tahlil</small>
            </div>

            <div class="form-group" style="margin-top:14px">
              <label><i class="fas fa-comment-dots"></i> AI tizim xabari (ixtiyoriy)</label>
              <textarea id="s-ai-prompt" rows="3"
                style="width:100%;padding:10px 14px;border:1.5px solid var(--border);border-radius:8px;resize:vertical;font-size:0.9rem;font-family:inherit;color:var(--text1)"
                placeholder="Masalan: Siz xodimlar boshqaruvi botisiz. Faqat ish bilan bog'liq savollarga javob bering.">${settings.ai_system_prompt || ''}</textarea>
            </div>

            <div style="display:flex;align-items:center;gap:10px;margin-top:12px">
              <label style="font-size:0.9rem;color:var(--text2)"><i class="fas fa-toggle-on"></i> AI holati</label>
              <select id="s-ai-enabled" style="padding:6px 12px;border:1.5px solid var(--border);border-radius:8px;background:var(--bg);color:var(--text1)">
                <option value="1" ${(settings.ai_enabled ?? '1') !== '0' ? 'selected' : ''}>✅ Yoqilgan</option>
                <option value="0" ${settings.ai_enabled === '0' ? 'selected' : ''}>❌ O'chirilgan</option>
              </select>
            </div>
          </div>
        </div>` : ''}

        ${isOwner ? `
        <div class="settings-section">
          <div class="settings-section-title"><i class="fas fa-robot" style="color:var(--primary)"></i> Agent sozlamalari</div>
          <div class="card">
            <div class="form-group">
              <label><i class="fas fa-chart-bar"></i> Kunlik hisobot vaqti</label>
              <input type="time" id="s-report-time" value="${settings.daily_report_time || '20:00'}"
                style="width:100%;padding:12px 14px;border:1.5px solid var(--border);border-radius:8px">
              <small style="color:var(--text3);font-size:0.72rem">Har kech shu vaqtda adminga hisobot yuboriladi</small>
            </div>
            <div style="display:flex;align-items:center;gap:10px;margin-top:12px">
              <label style="font-size:0.9rem;color:var(--text2)">Kunlik hisobot</label>
              <select id="s-report-enabled" style="padding:6px 12px;border:1.5px solid var(--border);border-radius:8px;background:var(--bg);color:var(--text1)">
                <option value="1" ${(settings.daily_report_enabled ?? '1') !== '0' ? 'selected' : ''}>✅ Yoqilgan</option>
                <option value="0" ${settings.daily_report_enabled === '0' ? 'selected' : ''}>❌ O'chirilgan</option>
              </select>
            </div>
            <div class="form-group" style="margin-top:12px">
              <label><i class="fas fa-bell"></i> Eslatma vaqti (soat)</label>
              <input type="number" id="s-reminder-hour" value="${settings.reminder_hour || '9'}" min="6" max="23"
                style="width:100%;padding:12px 14px;border:1.5px solid var(--border);border-radius:8px">
              <small style="color:var(--text3);font-size:0.72rem">Rasm yubormaganlarga eslatma (Dush-Shan)</small>
            </div>
            <div style="display:flex;align-items:center;gap:10px;margin-top:12px">
              <label style="font-size:0.9rem;color:var(--text2)">Eslatmalar</label>
              <select id="s-reminder-enabled" style="padding:6px 12px;border:1.5px solid var(--border);border-radius:8px;background:var(--bg);color:var(--text1)">
                <option value="1" ${(settings.reminder_enabled ?? '1') !== '0' ? 'selected' : ''}>✅ Yoqilgan</option>
                <option value="0" ${settings.reminder_enabled === '0' ? 'selected' : ''}>❌ O'chirilgan</option>
              </select>
            </div>
            <div style="display:flex;gap:8px;margin-top:14px">
              <button class="btn btn-outline btn-sm" onclick="triggerReport()" style="flex:1">
                <i class="fas fa-paper-plane"></i> Hisobotni hozir yuborish
              </button>
              <button class="btn btn-outline btn-sm" onclick="triggerReminder()" style="flex:1">
                <i class="fas fa-bell"></i> Eslatmani hozir
              </button>
            </div>
          </div>
        </div>` : ''}

        ${isOwner ? `
        <div class="settings-section">
          <div class="card">
            <p style="font-size:0.85rem;color:var(--text2);margin-bottom:12px">
              <i class="fas fa-exclamation-triangle" style="color:var(--warning)"></i>
              Bu amalni bajarganingizdan so'ng siz Admin bo'lib qolasiz!
            </p>
            <div class="form-group">
              <label><i class="fas fa-crown"></i> Yangi ega (foydalanuvchi ID)</label>
              <input type="number" id="s-new-owner-id" placeholder="Foydalanuvchi ID raqami">
            </div>
            <button class="btn btn-danger btn-full" style="margin-top:12px" onclick="transferOwnership()">
              <i class="fas fa-crown"></i> Egalikni o'tkazish
            </button>
          </div>
        </div>` : ''}

      </div>`;
  } catch (err) {
    document.getElementById('owner-content').innerHTML = errorHtml(err.message);
  }
}

async function saveSettings() {
  const isOwner = state.user.role === 'owner';
  const body = {};

  if (isOwner) {
    body.bot_token      = document.getElementById('s-bot-token')?.value || '';
    body.channel_id     = document.getElementById('s-channel-id')?.value || '';
    body.app_url        = document.getElementById('s-app-url')?.value || '';
    body.gemini_api_key      = document.getElementById('s-gemini-key')?.value      || '';
    body.groq_api_key        = document.getElementById('s-groq-key')?.value        || '';
    body.claude_api_key      = document.getElementById('s-claude-key')?.value      || '';
    body.ai_enabled          = document.getElementById('s-ai-enabled')?.value      || '1';
    body.ai_system_prompt    = document.getElementById('s-ai-prompt')?.value       || '';
    body.daily_report_time   = document.getElementById('s-report-time')?.value     || '20:00';
    body.daily_report_enabled= document.getElementById('s-report-enabled')?.value  || '1';
    body.reminder_enabled    = document.getElementById('s-reminder-enabled')?.value|| '1';
    body.reminder_hour       = document.getElementById('s-reminder-hour')?.value   || '9';
  }
  body.app_name = document.getElementById('s-app-name')?.value || '';

  try {
    await http('PUT', '/owner/settings', body);
    showToast('Sozlamalar saqlandi!', 'success');
  } catch (err) {
    showToast(err.message, 'error');
  }
}

/* ════════════════════════════════════════════════════
   ADMIN PANEL
════════════════════════════════════════════════════ */
function adminTab(tab, btn) {
  document.querySelectorAll('#admin-panel .nav-item').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  const content = document.getElementById('admin-content');
  content.innerHTML = '<div style="text-align:center;padding:40px"><div class="loader-spinner" style="margin:auto;border-color:var(--border);border-top-color:var(--primary)"></div></div>';

  if (tab === 'dashboard') renderAdminDashboard();
  else if (tab === 'workers') renderAdminWorkers();
  else if (tab === 'stats') renderAdminStats();
  else if (tab === 'profile') renderProfile('admin-content');
}

async function renderAdminDashboard() {
  try {
    const { stats, dailyChart } = await http('GET', '/admin/stats');
    const logs = await http('GET', '/admin/logs?period=today');
    document.getElementById('admin-content').innerHTML = `
      <div class="fade-in">
        <div class="stats-grid">
          <div class="stat-card blue">
            <div class="stat-icon"><i class="fas fa-users"></i></div>
            <div class="stat-value">${stats.totalWorkers}</div>
            <div class="stat-label">Xodimlar</div>
          </div>
          <div class="stat-card green">
            <div class="stat-icon"><i class="fas fa-user-check"></i></div>
            <div class="stat-value">${stats.todayActive}</div>
            <div class="stat-label">Bugun faol</div>
          </div>
          <div class="stat-card orange">
            <div class="stat-icon"><i class="fas fa-camera"></i></div>
            <div class="stat-value">${stats.todayPhotos}</div>
            <div class="stat-label">Rasmlar</div>
          </div>
          <div class="stat-card purple">
            <div class="stat-icon"><i class="fas fa-chart-line"></i></div>
            <div class="stat-value">${stats.weeklyLogs}</div>
            <div class="stat-label">Haftalik</div>
          </div>
        </div>
        <div class="card">
          <div class="card-header"><span class="card-title"><i class="fas fa-chart-bar"></i> Haftalik grafik</span></div>
          ${renderChart(dailyChart)}
        </div>
        <div class="card">
          <div class="card-header"><span class="card-title"><i class="fas fa-history"></i> Bugungi faoliyat</span></div>
          ${logs.length === 0 ? '<div class="empty-state"><i class="fas fa-inbox"></i><p>Bugun faoliyat yoq</p></div>'
            : logs.map(l => logItemHtml(l)).join('')}
        </div>
      </div>`;
  } catch (err) {
    document.getElementById('admin-content').innerHTML = errorHtml(err.message);
  }
}

async function renderAdminWorkers() {
  try {
    const workers = await http('GET', '/admin/workers');
    document.getElementById('admin-content').innerHTML = `
      <div class="fade-in">
        <div class="section-header">
          <span class="section-title"><i class="fas fa-users" style="color:var(--primary)"></i> Xodimlar (${workers.length})</span>
          <button class="btn btn-primary btn-sm" onclick="openAddUserModal('worker','admin')">
            <i class="fas fa-plus"></i> Qo'shish
          </button>
        </div>
        <div class="search-bar">
          <i class="fas fa-search"></i>
          <input type="text" placeholder="Qidirish..." oninput="filterUsers(this.value,'worker-list-admin')">
        </div>
        <div class="user-list" id="worker-list-admin">
          ${workers.length === 0
            ? '<div class="empty-state"><i class="fas fa-users"></i><p>Xodimlar yoq</p></div>'
            : workers.map(w => workerCardHtml(w, 'admin')).join('')}
        </div>
      </div>`;
  } catch (err) {
    document.getElementById('admin-content').innerHTML = errorHtml(err.message);
  }
}

function renderAdminStats() {
  document.getElementById('admin-content').innerHTML = `
    <div class="fade-in">
      <div class="period-tabs">
        <button class="period-tab active" onclick="loadStats('today',this,'admin')">Bugun</button>
        <button class="period-tab" onclick="loadStats('week',this,'admin')">Hafta</button>
        <button class="period-tab" onclick="loadStats('month',this,'admin')">Oy</button>
      </div>
      <div id="stats-content"></div>
    </div>`;
  loadStats('today', document.querySelector('.period-tab.active'), 'admin');
}

/* ════════════════════════════════════════════════════
   WORKER PANEL
════════════════════════════════════════════════════ */
function workerTab(tab, btn) {
  document.querySelectorAll('#worker-panel .nav-item').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  const content = document.getElementById('worker-content');
  content.innerHTML = '<div style="text-align:center;padding:40px"><div class="loader-spinner" style="margin:auto;border-color:var(--border);border-top-color:var(--primary)"></div></div>';

  if (tab === 'home') renderWorkerHome();
  else if (tab === 'photo') renderWorkerPhoto();
  else if (tab === 'logs') renderWorkerLogs();
  else if (tab === 'profile') renderProfile('worker-content');
}

async function renderWorkerHome() {
  const u = state.user;
  const now = new Date();
  document.getElementById('worker-content').innerHTML = `
    <div class="fade-in">
      <div class="profile-card">
        <div class="profile-banner"></div>
        <div class="profile-info">
          <div class="profile-avatar">${avatarHtml(u, 60)}</div>
          <div class="profile-name">${u.first_name} ${u.last_name}</div>
          <div class="profile-meta"><i class="fas fa-user"></i> Xodim · ${now.toLocaleDateString('uz-UZ', { weekday:'long', day:'numeric', month:'long' })}</div>
        </div>
      </div>

      <div class="stats-grid">
        <div class="stat-card blue">
          <div class="stat-icon"><i class="fas fa-camera"></i></div>
          <div class="stat-value" id="my-photo-count">—</div>
          <div class="stat-label">Bugungi rasmlar</div>
        </div>
        <div class="stat-card green">
          <div class="stat-icon"><i class="fas fa-calendar-check"></i></div>
          <div class="stat-value" id="my-total-count">—</div>
          <div class="stat-label">Jami rasmlar</div>
        </div>
      </div>

      <div class="card">
        <button class="btn btn-primary btn-full btn-lg" onclick="workerTab('photo', document.querySelector('#worker-panel .nav-item[data-tab=\\'photo\\']'))">
          <i class="fas fa-camera"></i> Rasm yuborish
        </button>
      </div>
    </div>`;

  // Load counts
  try {
    const logs = await http('GET', '/worker/my-logs');
    const today = new Date().toLocaleDateString('en-CA');
    const todayPhotos = logs.filter(l => l.created_at.startsWith(today) && l.action === 'photo').length;
    document.getElementById('my-photo-count').textContent = todayPhotos;
    document.getElementById('my-total-count').textContent = logs.length;
  } catch {}
}

function renderWorkerPhoto() {
  document.getElementById('worker-content').innerHTML = `
    <div class="fade-in">
      <div class="card">
        <div class="card-header"><span class="card-title"><i class="fas fa-camera"></i> Rasm yuborish</span></div>
        <div class="avatar-upload" style="margin-bottom:0">
          <div class="photo-upload-area" id="photo-drop" onclick="document.getElementById('photo-file').click()">
            <i class="fas fa-cloud-upload-alt"></i>
            <p>Rasm tanlash yoki suratga olish</p>
            <small>JPG, PNG, WEBP - max 10MB</small>
          </div>
          <div id="photo-preview-area" style="width:100%;display:none">
            <div class="photo-preview">
              <img id="photo-preview-img" src="" alt="preview">
              <button class="photo-preview-remove" onclick="clearPhotoPreview()">
                <i class="fas fa-times"></i>
              </button>
            </div>
          </div>
          <input type="file" id="photo-file" accept="image/*" style="display:none" onchange="previewPhoto(this)">
        </div>
        <div class="form-group" style="margin-top:12px">
          <label><i class="fas fa-comment"></i> Izoh (ixtiyoriy)</label>
          <textarea id="photo-note" placeholder="Qisqa izoh..." rows="2"></textarea>
        </div>
        <button class="btn btn-primary btn-full btn-lg" style="margin-top:12px" onclick="sendPhoto()">
          <i class="fas fa-paper-plane"></i> Yuborish
        </button>
      </div>
    </div>`;
}

function previewPhoto(input) {
  const file = input.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    document.getElementById('photo-preview-img').src = e.target.result;
    document.getElementById('photo-drop').style.display = 'none';
    document.getElementById('photo-preview-area').style.display = 'block';
  };
  reader.readAsDataURL(file);
}
function clearPhotoPreview() {
  document.getElementById('photo-file').value = '';
  document.getElementById('photo-drop').style.display = 'block';
  document.getElementById('photo-preview-area').style.display = 'none';
}

let _sendingPhoto = false;
async function sendPhoto() {
  if (_sendingPhoto) return;
  const file = document.getElementById('photo-file')?.files[0];
  if (!file) return showToast('Rasm tanlang', 'error');
  const note = document.getElementById('photo-note')?.value || '';
  const form = new FormData();
  form.append('photo', file);
  if (note) form.append('note', note);

  _sendingPhoto = true;
  const btn = document.querySelector('#worker-content .btn-primary');
  if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Yuborilmoqda...'; }
  showLoader();
  try {
    await http('POST', '/worker/photo', form, true);
    showToast('Rasm muvaffaqiyatli yuborildi!', 'success');
    clearPhotoPreview();
    document.getElementById('photo-note').value = '';
    setTimeout(() => workerTab('logs', document.querySelector('#worker-panel .nav-item[data-tab="logs"]')), 1000);
  } catch (err) {
    if (err.duplicate) {
      showToast('⚠️ Bu rasm allaqachon yuborilgan!', 'error');
    } else {
      showToast(err.message, 'error');
    }
    if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-paper-plane"></i> Yuborish'; }
  } finally {
    hideLoader();
    _sendingPhoto = false;
  }
}

async function renderWorkerLogs() {
  try {
    const logs = await http('GET', '/worker/my-logs');
    document.getElementById('worker-content').innerHTML = `
      <div class="fade-in">
        <div class="section-header">
          <span class="section-title"><i class="fas fa-history" style="color:var(--primary)"></i> Mening faoliyatim</span>
          <span class="badge badge-info">${logs.length} ta</span>
        </div>
        ${logs.length === 0
          ? '<div class="empty-state"><i class="fas fa-history"></i><p>Hali faoliyat yoq</p></div>'
          : logs.map(l => `
            <div class="log-item fade-in">
              <div class="log-icon photo"><i class="fas fa-camera"></i></div>
              <div class="log-info">
                <div class="log-name">Rasm yuborildi</div>
                <div class="log-time">${formatDate(l.created_at)}${l.note ? ' · ' + l.note : ''}</div>
              </div>
              ${l.photo_path ? `<img class="log-img" src="${l.photo_path}" onclick="previewImage('${l.photo_path}')">` : ''}
            </div>`).join('')}
      </div>`;
  } catch (err) {
    document.getElementById('worker-content').innerHTML = errorHtml(err.message);
  }
}

/* ════════════════════════════════════════════════════
   SHARED: Profile View
════════════════════════════════════════════════════ */
function renderProfile(containerId) {
  const u = state.user;
  document.getElementById(containerId).innerHTML = `
    <div class="fade-in">
      <div class="profile-card">
        <div class="profile-banner"></div>
        <div class="profile-info">
          <div class="profile-avatar">${avatarHtml(u, 60)}</div>
          <div class="profile-name">${u.first_name} ${u.last_name}</div>
          <div class="profile-meta">${u.role === 'owner' ? '👑 Ega' : u.role === 'admin' ? '🛡️ Admin' : '👤 Xodim'}</div>
        </div>
      </div>

      <div class="card">
        <div class="card-title" style="margin-bottom:12px"><i class="fas fa-info-circle"></i> Ma'lumotlar</div>
        <div class="info-list">
          ${u.phone ? `<div class="info-item"><i class="fas fa-phone"></i><div><div class="info-item-label">Telefon</div><div class="info-item-value">${u.phone}</div></div></div>` : ''}
          ${u.telegram_id ? `<div class="info-item"><i class="fab fa-telegram"></i><div><div class="info-item-label">Telegram ID</div><div class="info-item-value">${u.telegram_id}</div></div></div>` : ''}
          ${u.username ? `<div class="info-item"><i class="fas fa-at"></i><div><div class="info-item-label">Username</div><div class="info-item-value">@${u.username}</div></div></div>` : ''}
          <div class="info-item"><i class="fas fa-calendar"></i><div><div class="info-item-label">Ro'yxatdan o'tgan</div><div class="info-item-value">${formatDate(u.created_at)}</div></div></div>
        </div>
      </div>

      <div class="card">
        <div class="card-title" style="margin-bottom:12px"><i class="fas fa-key"></i> Parolni o'zgartirish</div>
        <div class="form-group">
          <label>Joriy parol</label>
          <input type="password" id="p-cur" placeholder="Joriy parol">
        </div>
        <div class="form-group" style="margin-top:10px">
          <label>Yangi parol</label>
          <input type="password" id="p-new" placeholder="Kamida 4 ta belgi">
        </div>
        <button class="btn btn-warning btn-full" style="margin-top:12px" onclick="changePassword()">
          <i class="fas fa-save"></i> Saqlash
        </button>
      </div>

      <button class="btn btn-danger btn-full" onclick="doLogout()">
        <i class="fas fa-sign-out-alt"></i> Tizimdan chiqish
      </button>
    </div>`;
}

async function triggerReport() {
  try {
    await http('POST', '/owner/trigger-report');
    showToast('📊 Hisobot yuborildi!', 'success');
  } catch (err) { showToast(err.message, 'error'); }
}

async function triggerReminder() {
  try {
    await http('POST', '/owner/trigger-reminder');
    showToast('⏰ Eslatmalar yuborildi!', 'success');
  } catch (err) { showToast(err.message, 'error'); }
}

async function transferOwnership() {
  const newId = document.getElementById('s-new-owner-id')?.value;
  if (!newId) return showToast('Yangi ega ID ni kiriting', 'error');
  if (!confirm('Egalikni o\'tkazishni tasdiqlaysizmi? Bu amalni qaytarib bo\'lmaydi!')) return;
  showLoader();
  try {
    const res = await http('POST', '/owner/transfer-owner', { new_owner_id: parseInt(newId) });
    showToast(res.message, 'success');
    setTimeout(() => doLogout(), 2000);
  } catch(err) {
    showToast(err.message, 'error');
  } finally {
    hideLoader();
  }
}

async function changePassword() {
  const cur = document.getElementById('p-cur')?.value || document.getElementById('s-cur-pass')?.value || '';
  const nw = document.getElementById('p-new')?.value || document.getElementById('s-new-pass')?.value || '';
  if (!nw || nw.length < 4) return showToast('Parol kamida 4 ta belgi', 'error');
  showLoader();
  try {
    await http('POST', '/auth/change-password', { current_password: cur, new_password: nw });
    showToast('Parol o\'zgartirildi!', 'success');
    if (document.getElementById('p-cur')) { document.getElementById('p-cur').value = ''; document.getElementById('p-new').value = ''; }
    if (document.getElementById('s-cur-pass')) { document.getElementById('s-cur-pass').value = ''; document.getElementById('s-new-pass').value = ''; }
  } catch (err) {
    showToast(err.message, 'error');
  } finally {
    hideLoader();
  }
}

/* ════════════════════════════════════════════════════
   SHARED: Add / Edit User Modal
════════════════════════════════════════════════════ */
function idTypeModal(type) {
  const phoneGroup = document.getElementById('modal-phone-group');
  const tgGroup = document.getElementById('modal-tg-group');
  document.querySelectorAll('.id-type-btn').forEach(b => b.classList.remove('active'));
  document.querySelector(`.id-type-btn[data-type="${type}"]`).classList.add('active');
  if (type === 'phone') {
    phoneGroup.style.display = 'block';
    tgGroup.style.display = 'none';
  } else {
    phoneGroup.style.display = 'none';
    tgGroup.style.display = 'block';
  }
}

function openAddUserModal(type, panel) {
  const title = type === 'worker' ? 'Xodim qo\'shish' : 'Admin / Super Admin qo\'shish';
  const isWorker = type === 'worker';
  openModal(title, `
    <div class="avatar-upload">
      <label class="avatar-upload-circle" id="modal-avatar-circle" for="modal-avatar-file">
        <i class="fas fa-camera"></i>
      </label>
      <input type="file" id="modal-avatar-file" accept="image/*" onchange="previewModalAvatar(this)">
      <small style="color:var(--text3)">Rasm qo'shish (ixtiyoriy)</small>
    </div>

    <div class="form-row">
      <div class="form-group">
        <label><i class="fas fa-user"></i> Ism *</label>
        <input type="text" id="m-first" placeholder="Ism">
      </div>
      <div class="form-group">
        <label><i class="fas fa-user"></i> Familya *</label>
        <input type="text" id="m-last" placeholder="Familya">
      </div>
    </div>

    <div class="form-group">
      <label><i class="fab fa-telegram"></i> Telegram ID *</label>
      <input type="text" id="m-tgid" placeholder="123456789"
        oninput="this.value=this.value.replace(/[^0-9]/g,\'\')">
    </div>

    ${!isWorker ? `
    <div class="form-group" style="margin-top:10px">
      <label><i class="fas fa-shield-alt"></i> Rol *</label>
      <select id="m-role" style="width:100%;padding:12px 16px;border:1.5px solid var(--border);border-radius:8px;font-size:0.9rem">
        <option value="admin">🛡️ Admin</option>
        <option value="superadmin">⭐ Super Admin</option>
      </select>
    </div>` : ''}

    <div class="modal-footer" style="padding:0;border:none;margin-top:12px">
      <button class="btn btn-ghost" onclick="closeModalForce()"><i class="fas fa-times"></i> Bekor</button>
      <button class="btn btn-primary" onclick="submitAddUser('${type}','${panel}')">
        <i class="fas fa-save"></i> Saqlash
      </button>
    </div>`);
}


function previewModalAvatar(input) {
  const file = input.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    const circle = document.getElementById('modal-avatar-circle');
    circle.innerHTML = `<img src="${e.target.result}" style="width:80px;height:80px;border-radius:50%;object-fit:cover">`;
  };
  reader.readAsDataURL(file);
}

async function submitAddUser(type, panel) {
  const first = document.getElementById('m-first')?.value.trim();
  const last = document.getElementById('m-last')?.value.trim();
  const tgid = document.getElementById('m-tgid')?.value.trim();
  const avatarFile = document.getElementById('modal-avatar-file')?.files[0];

  if (!first || !last) return showToast('Ism va familya kerak!', 'error');
  if (!tgid) return showToast('Telegram ID kerak!', 'error');

  const form = new FormData();
  form.append('first_name', first);
  form.append('last_name', last);
  form.append('telegram_id', tgid);
  if (type === 'admin') {
    const role = document.getElementById('m-role')?.value || 'admin';
    form.append('role', role);
  }

  if (avatarFile) form.append('avatar', avatarFile);

  const endpoint = panel === 'owner' ? `/owner/${type}s` : `/admin/workers`;

  showLoader();
  try {
    await http('POST', endpoint, form, true);
    showToast(`${type === 'worker' ? 'Xodim' : 'Admin'} qo'shildi!`, 'success');
    closeModalForce();
    if (panel === 'owner') {
      if (type === 'worker') renderOwnerWorkers();
      else renderOwnerAdmins();
    } else {
      renderAdminWorkers();
    }
  } catch (err) {
    showToast(err.message, 'error');
  } finally {
    hideLoader();
  }
}

async function openEditUserModal(id, type, panel) {
  showLoader();
  try {
    const endpoint = panel === 'owner' ? `/owner/${type}s` : `/admin/workers`;
    const list = await http('GET', endpoint);
    const user = list.find(u => u.id === id);
    if (!user) return showToast('Foydalanuvchi topilmadi', 'error');

    const title = type === 'worker' ? 'Xodimni tahrirlash' : 'Adminni tahrirlash';
    openModal(title, `
      <div class="avatar-upload">
        <label class="avatar-upload-circle" id="modal-avatar-circle" for="modal-edit-avatar">
          ${user.avatar ? `<img src="${user.avatar}" style="width:80px;height:80px;border-radius:50%;object-fit:cover">` : '<i class="fas fa-camera"></i>'}
        </label>
        <input type="file" id="modal-edit-avatar" accept="image/*" onchange="previewModalAvatarEdit(this)">
      </div>

      <div class="form-row">
        <div class="form-group">
          <label>Ism *</label>
          <input type="text" id="e-first" value="${user.first_name || ''}">
        </div>
        <div class="form-group">
          <label>Familya *</label>
          <input type="text" id="e-last" value="${user.last_name || ''}">
        </div>
      </div>
      <div class="form-group">
        <label><i class="fas fa-phone"></i> Telefon</label>
        <input type="tel" id="e-phone" value="${user.phone || ''}" placeholder="+998...">
      </div>
      <div class="form-group">
        <label><i class="fab fa-telegram"></i> Telegram ID</label>
        <input type="text" id="e-tgid" value="${user.telegram_id || ''}" placeholder="Telegram ID">
      </div>
      <div class="form-group">
        <label><i class="fas fa-at"></i> Username</label>
        <input type="text" id="e-uname" value="${user.username || ''}" placeholder="username (@ siz)">
      </div>
      <div class="form-group">
        <label><i class="fas fa-key"></i> Yangi parol (o'zgartirmoqchi bo'lsangiz)</label>
        <div class="input-icon-right">
          <input type="password" id="e-pass" placeholder="Bo'sh qoldirsangiz o'zgarmaydi">
          <button type="button" class="eye-btn" onclick="togglePass('e-pass',this)"><i class="fas fa-eye"></i></button>
        </div>
      </div>
      <div class="modal-footer" style="padding:0;border:none;margin-top:8px">
        <button class="btn btn-ghost" onclick="closeModalForce()"><i class="fas fa-times"></i> Bekor</button>
        <button class="btn btn-primary" onclick="submitEditUser(${id},'${type}','${panel}')">
          <i class="fas fa-save"></i> Saqlash
        </button>
      </div>`);
  } catch (err) {
    showToast(err.message, 'error');
  } finally {
    hideLoader();
  }
}

function previewModalAvatarEdit(input) {
  const file = input.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    const circle = document.getElementById('modal-avatar-circle');
    circle.innerHTML = `<img src="${e.target.result}" style="width:80px;height:80px;border-radius:50%;object-fit:cover">`;
  };
  reader.readAsDataURL(file);
}

async function submitEditUser(id, type, panel) {
  const form = new FormData();
  form.append('first_name', document.getElementById('e-first').value.trim());
  form.append('last_name', document.getElementById('e-last').value.trim());
  form.append('phone', document.getElementById('e-phone').value.trim());
  form.append('telegram_id', document.getElementById('e-tgid').value.trim());
  form.append('username', document.getElementById('e-uname').value.trim());
  const pass = document.getElementById('e-pass').value;

  const avatarFile = document.getElementById('modal-edit-avatar')?.files[0];
  if (avatarFile) form.append('avatar', avatarFile);

  const endpoint = panel === 'owner' ? `/owner/${type}s/${id}` : `/admin/workers/${id}`;
  showLoader();
  try {
    await http('PUT', endpoint, form, true);
    showToast('Muvaffaqiyatli yangilandi!', 'success');
    closeModalForce();
    if (panel === 'owner') {
      if (type === 'worker') renderOwnerWorkers();
      else renderOwnerAdmins();
    } else {
      renderAdminWorkers();
    }
  } catch (err) {
    showToast(err.message, 'error');
  } finally {
    hideLoader();
  }
}

async function toggleBlock(id, type, panel) {
  const endpoint = panel === 'owner' ? `/owner/${type}s/${id}/block` : `/admin/workers/${id}/block`;
  showLoader();
  try {
    const res = await http('PATCH', endpoint);
    showToast(res.message, 'success');
    if (panel === 'owner') {
      if (type === 'worker') renderOwnerWorkers();
      else renderOwnerAdmins();
    } else {
      renderAdminWorkers();
    }
  } catch (err) {
    showToast(err.message, 'error');
  } finally {
    hideLoader();
  }
}

async function deleteUser(id, type, panel) {
  openModal('O\'chirishni tasdiqlash', `
    <div class="confirm-delete">
      <i class="fas fa-exclamation-triangle"></i>
      <p>Ushbu ${type === 'worker' ? 'xodim' : 'admin'}ni o'chirishni tasdiqlaysizmi?<br><strong>Bu amalni qaytarib bo'lmaydi!</strong></p>
    </div>
    <div class="modal-footer" style="padding:0;border:none;margin-top:16px">
      <button class="btn btn-ghost" onclick="closeModalForce()">Bekor</button>
      <button class="btn btn-danger" onclick="confirmDelete(${id},'${type}','${panel}')">
        <i class="fas fa-trash"></i> O'chirish
      </button>
    </div>`);
}

async function confirmDelete(id, type, panel) {
  const endpoint = panel === 'owner' ? `/owner/${type}s/${id}` : `/admin/workers/${id}`;
  showLoader();
  try {
    await http('DELETE', endpoint);
    showToast("O'chirildi!", 'success');
    closeModalForce();
    if (panel === 'owner') {
      if (type === 'worker') renderOwnerWorkers();
      else renderOwnerAdmins();
    } else {
      renderAdminWorkers();
    }
  } catch (err) {
    showToast(err.message, 'error');
  } finally {
    hideLoader();
  }
}

/* ── Helpers ────────────────────────────────────── */
function filterUsers(query, listId) {
  const q = query.toLowerCase();
  document.querySelectorAll(`#${listId} .user-card`).forEach(card => {
    const name = card.dataset.name?.toLowerCase() || '';
    card.style.display = name.includes(q) ? '' : 'none';
  });
}
function errorHtml(msg) {
  return `<div class="empty-state"><i class="fas fa-exclamation-triangle"></i><p>${msg}</p></div>`;
}

/* ── Start ──────────────────────────────────────── */
init();
