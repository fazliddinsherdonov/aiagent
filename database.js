// ═══════════════════════════════════════════════════════════════════
// Database — PostgreSQL (Railway) yoki SQLite (lokal)
// Multi-tenant: har bir workspace alohida ajratilgan
// ═══════════════════════════════════════════════════════════════════
const bcrypt = require('bcryptjs');
const path   = require('path');

const USE_PG = !!process.env.DATABASE_URL;
let db, pgPool;

// ── PostgreSQL ────────────────────────────────────────────────────
async function initPostgres() {
  const { Pool } = require('pg');
  pgPool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });

  await pgPool.query(`
    -- Workspacelar (har bir oshxona)
    CREATE TABLE IF NOT EXISTS workspaces (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      slug TEXT UNIQUE NOT NULL,
      bot_token TEXT UNIQUE NOT NULL,
      bot_username TEXT,
      channel_id TEXT DEFAULT '',
      app_url TEXT DEFAULT '',
      status TEXT DEFAULT 'pending',
      plan TEXT DEFAULT 'basic',
      expires_at TIMESTAMP,
      owner_telegram_id TEXT NOT NULL,
      gemini_api_key TEXT DEFAULT '',
      groq_api_key TEXT DEFAULT '',
      claude_api_key TEXT DEFAULT '',
      ai_enabled TEXT DEFAULT '1',
      ai_system_prompt TEXT DEFAULT '',
      daily_report_time TEXT DEFAULT '20:00',
      daily_report_enabled TEXT DEFAULT '1',
      reminder_enabled TEXT DEFAULT '1',
      reminder_hour TEXT DEFAULT '9',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    -- Foydalanuvchilar (workspace ga bog'liq)
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      workspace_id INTEGER REFERENCES workspaces(id) ON DELETE CASCADE,
      telegram_id TEXT NOT NULL,
      first_name TEXT NOT NULL,
      last_name TEXT NOT NULL,
      phone TEXT,
      username TEXT,
      password_hash TEXT,
      role TEXT NOT NULL DEFAULT 'worker',
      is_blocked INTEGER NOT NULL DEFAULT 0,
      avatar TEXT,
      created_by INTEGER,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(workspace_id, telegram_id)
    );

    -- Ish loglari
    CREATE TABLE IF NOT EXISTS work_logs (
      id SERIAL PRIMARY KEY,
      workspace_id INTEGER REFERENCES workspaces(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      action TEXT NOT NULL,
      photo_path TEXT,
      photo_hash TEXT,
      photo_hash_sorted TEXT,
      note TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    -- Yo'qlik loglari
    CREATE TABLE IF NOT EXISTS absence_logs (
      id SERIAL PRIMARY KEY,
      workspace_id INTEGER REFERENCES workspaces(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      date DATE NOT NULL DEFAULT CURRENT_DATE,
      reason TEXT,
      reason_asked INTEGER DEFAULT 0,
      admin_notified INTEGER DEFAULT 0,
      days_missed INTEGER DEFAULT 1,
      status TEXT DEFAULT 'pending',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(workspace_id, user_id, date)
    );

    -- Job queue
    CREATE TABLE IF NOT EXISTS job_queue (
      id SERIAL PRIMARY KEY,
      workspace_id INTEGER REFERENCES workspaces(id) ON DELETE CASCADE,
      type TEXT NOT NULL,
      payload JSONB,
      status TEXT DEFAULT 'pending',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      processed_at TIMESTAMP
    );

    -- Super admin sozlamalari
    CREATE TABLE IF NOT EXISTS super_settings (
      key TEXT PRIMARY KEY,
      value TEXT
    );

    -- Indekslar
    CREATE INDEX IF NOT EXISTS idx_ws_slug      ON workspaces(slug);
    CREATE INDEX IF NOT EXISTS idx_ws_token     ON workspaces(bot_token);
    CREATE INDEX IF NOT EXISTS idx_ws_status    ON workspaces(status);
    CREATE INDEX IF NOT EXISTS idx_u_ws         ON users(workspace_id);
    CREATE INDEX IF NOT EXISTS idx_u_tgid       ON users(telegram_id);
    CREATE INDEX IF NOT EXISTS idx_u_role       ON users(role);
    CREATE INDEX IF NOT EXISTS idx_wl_ws        ON work_logs(workspace_id);
    CREATE INDEX IF NOT EXISTS idx_wl_uid       ON work_logs(user_id);
    CREATE INDEX IF NOT EXISTS idx_wl_hash      ON work_logs(photo_hash);
    CREATE INDEX IF NOT EXISTS idx_wl_hashs     ON work_logs(photo_hash_sorted);
    CREATE INDEX IF NOT EXISTS idx_al_ws        ON absence_logs(workspace_id);
    CREATE INDEX IF NOT EXISTS idx_al_uid       ON absence_logs(user_id);
  `);

  // Super admin default sozlamalari
  const defaults = [
    ['super_admin_tg_id', process.env.SUPER_ADMIN_TG_ID || ''],
    ['bot_token', process.env.BOT_TOKEN || ''],
    ['welcome_msg', 'Xush kelibsiz! Workspace ochish uchun bot tokeningizni yuboring.'],
  ];
  for (const [k,v] of defaults) {
    await pgPool.query(
      'INSERT INTO super_settings (key,value) VALUES ($1,$2) ON CONFLICT (key) DO NOTHING', [k,v]
    );
  }
  console.log('✅ PostgreSQL (multi-tenant) tayyor');
}

// ── SQLite ────────────────────────────────────────────────────────
function initSqlite() {
  const { DatabaseSync } = require('node:sqlite');
  const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'data.db');
  db = new DatabaseSync(DB_PATH);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  db.exec(`
    CREATE TABLE IF NOT EXISTS workspaces (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL, slug TEXT UNIQUE NOT NULL,
      bot_token TEXT UNIQUE NOT NULL, bot_username TEXT,
      channel_id TEXT DEFAULT '', app_url TEXT DEFAULT '',
      status TEXT DEFAULT 'pending', plan TEXT DEFAULT 'basic',
      expires_at DATETIME, owner_telegram_id TEXT NOT NULL,
      gemini_api_key TEXT DEFAULT '', groq_api_key TEXT DEFAULT '',
      claude_api_key TEXT DEFAULT '', ai_enabled TEXT DEFAULT '1',
      ai_system_prompt TEXT DEFAULT '', daily_report_time TEXT DEFAULT '20:00',
      daily_report_enabled TEXT DEFAULT '1', reminder_enabled TEXT DEFAULT '1',
      reminder_hour TEXT DEFAULT '9',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      workspace_id INTEGER REFERENCES workspaces(id) ON DELETE CASCADE,
      telegram_id TEXT NOT NULL, first_name TEXT NOT NULL, last_name TEXT NOT NULL,
      phone TEXT, username TEXT, password_hash TEXT, role TEXT NOT NULL DEFAULT 'worker',
      is_blocked INTEGER NOT NULL DEFAULT 0, avatar TEXT, created_by INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(workspace_id, telegram_id)
    );
    CREATE TABLE IF NOT EXISTS work_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      workspace_id INTEGER REFERENCES workspaces(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      action TEXT NOT NULL, photo_path TEXT, photo_hash TEXT,
      photo_hash_sorted TEXT, note TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS absence_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      workspace_id INTEGER REFERENCES workspaces(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      date TEXT NOT NULL DEFAULT (DATE('now','localtime')),
      reason TEXT, reason_asked INTEGER DEFAULT 0,
      admin_notified INTEGER DEFAULT 0, days_missed INTEGER DEFAULT 1,
      status TEXT DEFAULT 'pending',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(workspace_id, user_id, date)
    );
    CREATE TABLE IF NOT EXISTS job_queue (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      workspace_id INTEGER, type TEXT NOT NULL, payload TEXT,
      status TEXT DEFAULT 'pending',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP, processed_at DATETIME
    );
    CREATE TABLE IF NOT EXISTS super_settings (key TEXT PRIMARY KEY, value TEXT);
    CREATE INDEX IF NOT EXISTS idx_ws_slug   ON workspaces(slug);
    CREATE INDEX IF NOT EXISTS idx_ws_token  ON workspaces(bot_token);
    CREATE INDEX IF NOT EXISTS idx_u_ws      ON users(workspace_id);
    CREATE INDEX IF NOT EXISTS idx_u_tgid    ON users(telegram_id);
    CREATE INDEX IF NOT EXISTS idx_wl_ws     ON work_logs(workspace_id);
    CREATE INDEX IF NOT EXISTS idx_wl_uid    ON work_logs(user_id);
    CREATE INDEX IF NOT EXISTS idx_wl_hash   ON work_logs(photo_hash);
    CREATE INDEX IF NOT EXISTS idx_al_ws     ON absence_logs(workspace_id);
  `);

  const ins = db.prepare('INSERT OR IGNORE INTO super_settings (key,value) VALUES (?,?)');
  [
    ['super_admin_tg_id', process.env.SUPER_ADMIN_TG_ID || ''],
    ['bot_token', process.env.BOT_TOKEN || ''],
    ['welcome_msg', 'Xush kelibsiz! Workspace ochish uchun bot tokeningizni yuboring.'],
  ].forEach(([k,v]) => ins.run(k,v));
  console.log('✅ SQLite (multi-tenant) tayyor');
}

// ── Universal query wrapper ───────────────────────────────────────
const q = {
  async get(sql, params=[]) {
    if (USE_PG) {
      let paramIndex = 0;
      const pgSql = sql.replace(/\?/g, () => '$' + (++paramIndex) + '::TEXT');
      const res = await pgPool.query(pgSql, params);
      return res.rows[0] || null;
    }
    return db.prepare(sql).get(...params) || null;
  },
  async all(sql, params=[]) {
    if (USE_PG) {
      let paramIndex = 0;
      const pgSql = sql.replace(/\?/g, () => '$' + (++paramIndex) + '::TEXT');
      const res = await pgPool.query(pgSql, params);
      return res.rows;
    }
    return db.prepare(sql).all(...params);
  },
  async run(sql, params=[]) {
    if (USE_PG) {
      let paramIndex = 0;
      const pgSql = sql.replace(/\?/g, () => '$' + (++paramIndex) + '::TEXT');
      try {
        const res = await pgPool.query(pgSql + ' RETURNING id', params);
        return { lastInsertRowid: res.rows[0]?.id };
      } catch {
        const res = await pgPool.query(pgSql, params);
        return { lastInsertRowid: null };
      }
    }
    const r = db.prepare(sql).run(...params);
    return { lastInsertRowid: r.lastInsertRowid };
  }
};

// ── Queries ───────────────────────────────────────────────────────
const queries = {
  // ── Workspace ──────────────────────────────────────────────────
  getWorkspaceById:       (id)    => q.get('SELECT * FROM workspaces WHERE id=?', [id]),
  getWorkspaceBySlug:     (slug)  => q.get('SELECT * FROM workspaces WHERE slug=?', [slug]),
  getWorkspaceByToken:    (token) => q.get('SELECT * FROM workspaces WHERE bot_token=?', [token]),
  getWorkspaceByOwner:    (tgId)  => q.get('SELECT * FROM workspaces WHERE owner_telegram_id=?', [tgId]),
  getAllWorkspaces:        ()      => q.all('SELECT * FROM workspaces ORDER BY created_at DESC'),
  getActiveWorkspaces:    ()      => q.all("SELECT * FROM workspaces WHERE status='active'"),

  createWorkspace: (data) => q.run(
    `INSERT INTO workspaces (name,slug,bot_token,bot_username,owner_telegram_id,status)
     VALUES (?,?,?,?,?,'pending')`,
    [data.name, data.slug, data.bot_token, data.bot_username||'', data.owner_telegram_id]
  ),
  updateWorkspace: async (id, data) => {
    const keys   = Object.keys(data);
    const fields = keys.map((k,i) => USE_PG ? `${k}=$${i+1}` : `${k}=?`).join(', ');
    const vals   = [...keys.map(k => data[k]), id];
    return q.run(`UPDATE workspaces SET ${fields},updated_at=CURRENT_TIMESTAMP WHERE id=${USE_PG?`$${keys.length+1}`:'?'}`, vals);
  },
  activateWorkspace: (id, days=30) => {
    const expires = new Date(Date.now() + days*24*3600*1000).toISOString();
    return q.run("UPDATE workspaces SET status='active',expires_at=? WHERE id=?", [expires, id]);
  },
  suspendWorkspace:  (id) => q.run("UPDATE workspaces SET status='suspended' WHERE id=?", [id]),
  deleteWorkspace:   (id) => q.run('DELETE FROM workspaces WHERE id=?', [id]),

  getWorkspaceStats: (wsId) => q.get(`
    SELECT
      (SELECT COUNT(*) FROM users WHERE workspace_id=? AND role='worker' AND is_blocked=0) as workers,
      (SELECT COUNT(*) FROM users WHERE workspace_id=? AND role IN ('admin','superadmin') AND is_blocked=0) as admins,
      (SELECT COUNT(DISTINCT user_id) FROM work_logs WHERE workspace_id=? AND DATE(created_at)=CURRENT_DATE) as today_active,
      (SELECT COUNT(*) FROM work_logs WHERE workspace_id=? AND action='photo' AND DATE(created_at)=CURRENT_DATE) as today_photos
  `, [wsId, wsId, wsId, wsId]),

  getAllWorkspaceStats: () => q.all(`
    SELECT w.id, w.name, w.slug, w.status, w.expires_at, w.owner_telegram_id,
           COUNT(DISTINCT u.id) as total_users,
           COUNT(DISTINCT CASE WHEN u.role='worker' AND u.is_blocked=0 THEN u.id END) as workers,
           COUNT(DISTINCT CASE WHEN wl.action='photo' AND DATE(wl.created_at)=CURRENT_DATE THEN wl.id END) as today_photos
    FROM workspaces w
    LEFT JOIN users u ON u.workspace_id=w.id
    LEFT JOIN work_logs wl ON wl.workspace_id=w.id
    GROUP BY w.id ORDER BY w.created_at DESC
  `),

  // ── Users (workspace scoped) ───────────────────────────────────
  getUserById:         (id)              => q.get('SELECT * FROM users WHERE id=?', [id]),
  getUserByTelegramId: (wsId, tgId)      => q.get('SELECT * FROM users WHERE workspace_id=? AND telegram_id=?', [wsId, String(tgId)]),
  getUserByPhone:      (wsId, phone)     => q.get('SELECT * FROM users WHERE workspace_id=? AND phone=?', [wsId, phone]),
  getAllWorkers:        (wsId)            => q.all("SELECT * FROM users WHERE workspace_id=? AND role='worker' ORDER BY created_at DESC", [wsId]),
  getAllAdmins:         (wsId)            => q.all("SELECT * FROM users WHERE workspace_id=? AND role IN ('admin','superadmin') ORDER BY created_at DESC", [wsId]),
  getAllActiveWorkers:  (wsId)            => q.all("SELECT * FROM users WHERE workspace_id=? AND role='worker' AND is_blocked=0", [wsId]),

  createUser: (data) => q.run(
    'INSERT INTO users (workspace_id,first_name,last_name,phone,telegram_id,username,password_hash,role,created_by) VALUES (?,?,?,?,?,?,?,?,?)',
    [data.workspace_id, data.first_name, data.last_name, data.phone||null,
     data.telegram_id||null, data.username||null, data.password_hash||null,
     data.role, data.created_by||null]
  ),
  updateUser: async (id, data) => {
    const keys   = Object.keys(data);
    const fields = keys.map((k,i) => USE_PG ? `${k}=$${i+1}` : `${k}=?`).join(', ');
    const vals   = [...keys.map(k => data[k]), id];
    return q.run(`UPDATE users SET ${fields},updated_at=CURRENT_TIMESTAMP WHERE id=${USE_PG?`$${keys.length+1}`:'?'}`, vals);
  },
  deleteUser:     (id)    => q.run('DELETE FROM users WHERE id=?', [id]),
  blockUser:      (id, b) => q.run('UPDATE users SET is_blocked=?,updated_at=CURRENT_TIMESTAMP WHERE id=?', [b?1:0,id]),
  updatePassword: (id, h) => q.run('UPDATE users SET password_hash=?,updated_at=CURRENT_TIMESTAMP WHERE id=?', [h,id]),
  updateAvatar:   (id, p) => q.run('UPDATE users SET avatar=? WHERE id=?', [p,id]),
  transferOwner: async (wsId, newId, oldId) => {
    await q.run("UPDATE users SET role='superadmin' WHERE id=?", [oldId]);
    await q.run("UPDATE users SET role='owner' WHERE id=?", [newId]);
  },

  // ── Work logs ─────────────────────────────────────────────────
  addLog: (wsId,uid,act,photo=null,note=null,hash=null,sortedHash=null) =>
    q.run('INSERT INTO work_logs (workspace_id,user_id,action,photo_path,photo_hash,photo_hash_sorted,note) VALUES (?,?,?,?,?,?,?)',
      [wsId,uid,act,photo,hash,sortedHash,note]),

  checkPhotoHash:       (wsId,hash) => hash ? q.get('SELECT id,created_at FROM work_logs WHERE workspace_id=? AND photo_hash=? LIMIT 1', [wsId,hash]) : Promise.resolve(null),
  checkPhotoSortedHash: (wsId,hash) => hash ? q.get('SELECT id,created_at FROM work_logs WHERE workspace_id=? AND photo_hash_sorted=? LIMIT 1', [wsId,hash]) : Promise.resolve(null),

  getLogsToday:  (wsId) => q.all("SELECT wl.*,u.first_name,u.last_name,u.avatar FROM work_logs wl JOIN users u ON wl.user_id=u.id WHERE wl.workspace_id=? AND DATE(wl.created_at)=CURRENT_DATE ORDER BY wl.created_at DESC", [wsId]),
  getLogsWeek:   (wsId) => q.all("SELECT wl.*,u.first_name,u.last_name FROM work_logs wl JOIN users u ON wl.user_id=u.id WHERE wl.workspace_id=? AND wl.created_at>=CURRENT_DATE-INTERVAL'6 days' ORDER BY wl.created_at DESC", [wsId]),
  getLogsMonth:  (wsId) => q.all("SELECT wl.*,u.first_name,u.last_name FROM work_logs wl JOIN users u ON wl.user_id=u.id WHERE wl.workspace_id=? AND wl.created_at>=DATE_TRUNC('month',CURRENT_DATE) ORDER BY wl.created_at DESC", [wsId]),

  getStatsSummary: (wsId) => queries.getWorkspaceStats(wsId),

  getDailyChart:  (wsId) => q.all("SELECT DATE(created_at) as date,COUNT(*) as count FROM work_logs WHERE workspace_id=? AND created_at>=CURRENT_DATE-INTERVAL'6 days' GROUP BY DATE(created_at) ORDER BY date ASC", [wsId]),
  getMonthlyChart:(wsId) => q.all("SELECT TO_CHAR(created_at,'YYYY-MM') as month,COUNT(*) as count FROM work_logs WHERE workspace_id=? AND created_at>=DATE_TRUNC('month',CURRENT_DATE)-INTERVAL'11 months' GROUP BY TO_CHAR(created_at,'YYYY-MM') ORDER BY month ASC", [wsId]),

  getTodayWorkerStats: (wsId) => q.all(`
    SELECT u.id,u.first_name,u.last_name,u.telegram_id,COUNT(wl.id) as photo_count
    FROM users u
    LEFT JOIN work_logs wl ON u.id=wl.user_id AND wl.workspace_id=? AND wl.action='photo' AND DATE(wl.created_at)=CURRENT_DATE
    WHERE u.workspace_id=? AND u.role='worker' AND u.is_blocked=0
    GROUP BY u.id ORDER BY photo_count DESC
  `, [wsId, wsId]),

  getMissingWorkersToday: (wsId) => q.all(`
    SELECT u.id,u.first_name,u.last_name,u.telegram_id,
           COALESCE(al.reason,'') as reason,
           COALESCE(al.reason_asked,0) as reason_asked,
           COALESCE(al.admin_notified,0) as admin_notified,
           COALESCE(al.days_missed,1) as days_missed,
           COALESCE(al.status,'pending') as status
    FROM users u
    LEFT JOIN work_logs wl ON u.id=wl.user_id AND wl.workspace_id=? AND wl.action='photo' AND DATE(wl.created_at)=CURRENT_DATE
    LEFT JOIN absence_logs al ON u.id=al.user_id AND al.workspace_id=? AND al.date=CURRENT_DATE
    WHERE u.workspace_id=? AND u.role='worker' AND u.is_blocked=0 AND wl.id IS NULL
  `, [wsId, wsId, wsId]),

  getAbsenceToday:      (wsId,uid) => q.get("SELECT * FROM absence_logs WHERE workspace_id=? AND user_id=? AND date=CURRENT_DATE", [wsId,uid]),
  getConsecutiveMissing:(wsId,uid) => q.get("SELECT COUNT(*) as days FROM absence_logs WHERE workspace_id=? AND user_id=? AND date>=CURRENT_DATE-INTERVAL'3 days' AND status IN ('pending','notified','replied')", [wsId,uid]),
  upsertAbsence: (wsId,uid,data) => q.run(
    `INSERT INTO absence_logs (workspace_id,user_id,date,reason,reason_asked,admin_notified,days_missed,status)
     VALUES (?,?,CURRENT_DATE,?,?,?,?,?)
     ON CONFLICT (workspace_id,user_id,date) DO UPDATE SET
     reason=EXCLUDED.reason,reason_asked=EXCLUDED.reason_asked,
     admin_notified=EXCLUDED.admin_notified,days_missed=EXCLUDED.days_missed,status=EXCLUDED.status`,
    [wsId,uid,data.reason||null,data.reason_asked||0,data.admin_notified||0,data.days_missed||1,data.status||'pending']
  ),
  updateAbsenceStatus: (wsId,uid,status) => q.run("UPDATE absence_logs SET status=? WHERE workspace_id=? AND user_id=? AND date=CURRENT_DATE", [status,wsId,uid]),
  saveReason:          (wsId,uid,reason) => q.run("UPDATE absence_logs SET reason=?,status='replied' WHERE workspace_id=? AND user_id=? AND date=CURRENT_DATE", [reason,wsId,uid]),

  // ── Super settings ─────────────────────────────────────────────
  getSuperSetting:  (key) => q.get('SELECT value FROM super_settings WHERE key=?', [key]).then(r => r?.value||null),
  setSuperSetting:  (key,val) => q.run('INSERT INTO super_settings (key,value) VALUES (?,?) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value', [key,val]),

  // ── Workspace settings (shorthand) ────────────────────────────
  getWsSetting: (ws, key) => ws[key] || null,
};

// SQLite fixes
function fixSqliteQueries() {
  queries.getLogsToday  = (wsId) => q.all("SELECT wl.*,u.first_name,u.last_name,u.avatar FROM work_logs wl JOIN users u ON wl.user_id=u.id WHERE wl.workspace_id=? AND DATE(wl.created_at)=DATE('now','localtime') ORDER BY wl.created_at DESC", [wsId]);
  queries.getLogsWeek   = (wsId) => q.all("SELECT wl.*,u.first_name,u.last_name FROM work_logs wl JOIN users u ON wl.user_id=u.id WHERE wl.workspace_id=? AND wl.created_at>=DATE('now','-6 days','localtime') ORDER BY wl.created_at DESC", [wsId]);
  queries.getLogsMonth  = (wsId) => q.all("SELECT wl.*,u.first_name,u.last_name FROM work_logs wl JOIN users u ON wl.user_id=u.id WHERE wl.workspace_id=? AND wl.created_at>=DATE('now','start of month','localtime') ORDER BY wl.created_at DESC", [wsId]);
  queries.getDailyChart = (wsId) => q.all("SELECT DATE(created_at,'localtime') as date,COUNT(*) as count FROM work_logs WHERE workspace_id=? AND created_at>=DATE('now','-6 days','localtime') GROUP BY DATE(created_at,'localtime') ORDER BY date ASC", [wsId]);
  queries.getMonthlyChart=(wsId) => q.all("SELECT strftime('%Y-%m',created_at,'localtime') as month,COUNT(*) as count FROM work_logs WHERE workspace_id=? AND created_at>=DATE('now','-11 months','start of month','localtime') GROUP BY strftime('%Y-%m',created_at,'localtime') ORDER BY month ASC", [wsId]);
  queries.getTodayWorkerStats = (wsId) => q.all(`
    SELECT u.id,u.first_name,u.last_name,u.telegram_id,COUNT(wl.id) as photo_count
    FROM users u
    LEFT JOIN work_logs wl ON u.id=wl.user_id AND wl.workspace_id=? AND wl.action='photo' AND DATE(wl.created_at)=DATE('now','localtime')
    WHERE u.workspace_id=? AND u.role='worker' AND u.is_blocked=0
    GROUP BY u.id ORDER BY photo_count DESC
  `, [wsId, wsId]);
  queries.getMissingWorkersToday = (wsId) => q.all(`
    SELECT u.id,u.first_name,u.last_name,u.telegram_id,
           COALESCE(al.reason,'') as reason, COALESCE(al.reason_asked,0) as reason_asked,
           COALESCE(al.admin_notified,0) as admin_notified, COALESCE(al.days_missed,1) as days_missed,
           COALESCE(al.status,'pending') as status
    FROM users u
    LEFT JOIN work_logs wl ON u.id=wl.user_id AND wl.workspace_id=? AND wl.action='photo' AND DATE(wl.created_at)=DATE('now','localtime')
    LEFT JOIN absence_logs al ON u.id=al.user_id AND al.workspace_id=? AND al.date=DATE('now','localtime')
    WHERE u.workspace_id=? AND u.role='worker' AND u.is_blocked=0 AND wl.id IS NULL
  `, [wsId, wsId, wsId]);
  queries.getAbsenceToday       = (wsId,uid) => q.get("SELECT * FROM absence_logs WHERE workspace_id=? AND user_id=? AND date=DATE('now','localtime')", [wsId,uid]);
  queries.getConsecutiveMissing = (wsId,uid) => q.get("SELECT COUNT(*) as days FROM absence_logs WHERE workspace_id=? AND user_id=? AND date>=DATE('now','-3 days','localtime') AND status IN ('pending','notified','replied')", [wsId,uid]);
  queries.upsertAbsence = (wsId,uid,data) => q.run(
    `INSERT OR REPLACE INTO absence_logs (workspace_id,user_id,date,reason,reason_asked,admin_notified,days_missed,status)
     VALUES (?,?,DATE('now','localtime'),?,?,?,?,?)`,
    [wsId,uid,data.reason||null,data.reason_asked||0,data.admin_notified||0,data.days_missed||1,data.status||'pending']
  );
  queries.updateAbsenceStatus = (wsId,uid,s) => q.run("UPDATE absence_logs SET status=? WHERE workspace_id=? AND user_id=? AND date=DATE('now','localtime')", [s,wsId,uid]);
  queries.saveReason = (wsId,uid,r) => q.run("UPDATE absence_logs SET reason=?,status='replied' WHERE workspace_id=? AND user_id=? AND date=DATE('now','localtime')", [r,wsId,uid]);
  queries.getWorkspaceStats = (wsId) => q.get(`
    SELECT
      (SELECT COUNT(*) FROM users WHERE workspace_id=? AND role='worker' AND is_blocked=0) as workers,
      (SELECT COUNT(*) FROM users WHERE workspace_id=? AND role IN ('admin','superadmin') AND is_blocked=0) as admins,
      (SELECT COUNT(DISTINCT user_id) FROM work_logs WHERE workspace_id=? AND DATE(created_at)=DATE('now','localtime')) as today_active,
      (SELECT COUNT(*) FROM work_logs WHERE workspace_id=? AND action='photo' AND DATE(created_at)=DATE('now','localtime')) as today_photos
  `, [wsId,wsId,wsId,wsId]);
  queries.getAllWorkspaceStats = () => q.all(`
    SELECT w.id,w.name,w.slug,w.status,w.expires_at,w.owner_telegram_id,
           COUNT(DISTINCT u.id) as total_users,
           COUNT(DISTINCT CASE WHEN u.role='worker' AND u.is_blocked=0 THEN u.id END) as workers,
           COUNT(DISTINCT CASE WHEN wl.action='photo' AND DATE(wl.created_at)=DATE('now','localtime') THEN wl.id END) as today_photos
    FROM workspaces w
    LEFT JOIN users u ON u.workspace_id=w.id
    LEFT JOIN work_logs wl ON wl.workspace_id=w.id
    GROUP BY w.id ORDER BY w.created_at DESC
  `);
  queries.getSuperSetting  = (key) => { const r = db.prepare('SELECT value FROM super_settings WHERE key=?').get(key); return Promise.resolve(r?.value||null); };
  queries.setSuperSetting  = (key,val) => q.run('INSERT OR REPLACE INTO super_settings (key,value) VALUES (?,?)', [key,val]);
  queries.checkPhotoHash       = (wsId,hash) => Promise.resolve(hash ? db.prepare('SELECT id,created_at FROM work_logs WHERE workspace_id=? AND photo_hash=? LIMIT 1').get(wsId,hash) : null);
  queries.checkPhotoSortedHash = (wsId,hash) => Promise.resolve(hash ? db.prepare('SELECT id,created_at FROM work_logs WHERE workspace_id=? AND photo_hash_sorted=? LIMIT 1').get(wsId,hash) : null);
}

async function initialize() {
  if (USE_PG) { await initPostgres(); }
  else { initSqlite(); fixSqliteQueries(); }
  return queries;
}

function getDb() { return USE_PG ? pgPool : db; }
module.exports = { initialize, getDb, queries, USE_PG };
