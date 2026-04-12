const router = require('express').Router();
const bcrypt = require('bcryptjs');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { queries } = require('../database');
const { requireOwner } = require('../middleware/auth');

// requireOwner = owner + superadmin kirishi mumkin
// requireOnlyOwner = faqat owner
function requireOnlyOwner(req, res, next) {
  requireOwner(req, res, () => {
    if (req.user.role !== 'owner') {
      return res.status(403).json({ error: 'Bu amal faqat Ega uchun' });
    }
    next();
  });
}

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      const dir = path.join(__dirname, '../uploads/avatars');
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    filename: (req, file, cb) => {
      cb(null, `${Date.now()}-${Math.random().toString(36).slice(2)}${path.extname(file.originalname)}`);
    }
  }),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!file.mimetype.startsWith('image/')) return cb(new Error('Faqat rasm'));
    cb(null, true);
  }
});

router.get('/stats', requireOwner, (req, res) => {
  res.json({ stats: queries.getStatsSummary(), dailyChart: queries.getDailyChart(), monthlyChart: queries.getMonthlyChart() });
});

// ── WORKERS ──────────────────────────────────────────────────────
router.get('/workers', requireOwner, (req, res) => {
  res.json(queries.getAllWorkers().map(u => { const {password_hash,...s}=u; return s; }));
});

router.post('/workers', requireOwner, upload.single('avatar'), async (req, res) => {
  try {
    const { first_name, last_name, telegram_id } = req.body;
    if (!first_name || !last_name) return res.status(400).json({ error: 'Ism va familya kerak' });
    if (!telegram_id) return res.status(400).json({ error: 'Telegram ID kerak' });
    const result = queries.createUser({ first_name, last_name, phone: null, telegram_id, username: null, password_hash: null, role: 'worker', created_by: req.user.id });
    if (req.file) queries.updateAvatar(result.lastInsertRowid, `/uploads/avatars/${req.file.filename}`);
    const u = queries.getUserById(result.lastInsertRowid);
    const {password_hash,...s}=u; res.json({ message: "Xodim qo'shildi", user: s });
  } catch(err) {
    if (err.message?.includes('UNIQUE')) return res.status(400).json({ error: 'Bu Telegram ID allaqachon mavjud' });
    res.status(500).json({ error: err.message });
  }
});

router.put('/workers/:id', requireOwner, upload.single('avatar'), async (req, res) => {
  try {
    const user = queries.getUserById(req.params.id);
    if (!user || user.role !== 'worker') return res.status(404).json({ error: 'Topilmadi' });
    const updates = {};
    ['first_name','last_name','telegram_id'].forEach(f => { if (req.body[f] !== undefined) updates[f] = req.body[f] || null; });
    if (req.file) updates.avatar = `/uploads/avatars/${req.file.filename}`;
    queries.updateUser(req.params.id, updates);
    const u = queries.getUserById(req.params.id);
    const {password_hash,...s}=u; res.json({ message: 'Yangilandi', user: s });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

router.patch('/workers/:id/block', requireOwner, (req, res) => {
  const user = queries.getUserById(req.params.id);
  if (!user || user.role !== 'worker') return res.status(404).json({ error: 'Topilmadi' });
  const nb = user.is_blocked ? 0 : 1;
  queries.blockUser(req.params.id, nb);
  res.json({ message: nb ? 'Bloklandi' : 'Blokdan chiqarildi', is_blocked: nb });
});

router.delete('/workers/:id', requireOwner, (req, res) => {
  const user = queries.getUserById(req.params.id);
  if (!user || user.role !== 'worker') return res.status(404).json({ error: 'Topilmadi' });
  queries.deleteUser(req.params.id);
  res.json({ message: "O'chirildi" });
});

// ── ADMINS ───────────────────────────────────────────────────────
router.get('/admins', requireOwner, (req, res) => {
  res.json(queries.getAllAdmins().map(u => { const {password_hash,...s}=u; return s; }));
});

router.post('/admins', requireOwner, upload.single('avatar'), async (req, res) => {
  try {
    const { first_name, last_name, telegram_id, role } = req.body;
    if (!first_name || !last_name) return res.status(400).json({ error: 'Ism va familya kerak' });
    if (!telegram_id) return res.status(400).json({ error: 'Telegram ID kerak' });
    const adminRole = role === 'superadmin' ? 'superadmin' : 'admin';
    const result = queries.createUser({ first_name, last_name, phone: null, telegram_id, username: null, password_hash: null, role: adminRole, created_by: req.user.id });
    if (req.file) queries.updateAvatar(result.lastInsertRowid, `/uploads/avatars/${req.file.filename}`);
    const u = queries.getUserById(result.lastInsertRowid);
    const {password_hash,...s}=u; res.json({ message: "Admin qo'shildi", user: s });
  } catch(err) {
    if (err.message?.includes('UNIQUE')) return res.status(400).json({ error: 'Bu Telegram ID allaqachon mavjud' });
    res.status(500).json({ error: err.message });
  }
});

router.put('/admins/:id', requireOwner, upload.single('avatar'), async (req, res) => {
  try {
    const user = queries.getUserById(req.params.id);
    if (!user || !['admin','superadmin'].includes(user.role)) return res.status(404).json({ error: 'Topilmadi' });
    const updates = {};
    ['first_name','last_name','telegram_id'].forEach(f => { if (req.body[f] !== undefined) updates[f] = req.body[f] || null; });
    if (req.body.role && ['admin','superadmin'].includes(req.body.role)) updates.role = req.body.role;
    if (req.file) updates.avatar = `/uploads/avatars/${req.file.filename}`;
    queries.updateUser(req.params.id, updates);
    const u = queries.getUserById(req.params.id);
    const {password_hash,...s}=u; res.json({ message: 'Yangilandi', user: s });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

router.patch('/admins/:id/block', requireOwner, (req, res) => {
  const user = queries.getUserById(req.params.id);
  if (!user || !['admin','superadmin'].includes(user.role)) return res.status(404).json({ error: 'Topilmadi' });
  const nb = user.is_blocked ? 0 : 1;
  queries.blockUser(req.params.id, nb);
  res.json({ message: nb ? 'Bloklandi' : 'Blokdan chiqarildi', is_blocked: nb });
});

router.delete('/admins/:id', requireOwner, (req, res) => {
  const user = queries.getUserById(req.params.id);
  if (!user || !['admin','superadmin'].includes(user.role)) return res.status(404).json({ error: 'Topilmadi' });
  queries.deleteUser(req.params.id);
  res.json({ message: "O'chirildi" });
});

// ── TRANSFER OWNER — faqat owner ─────────────────────────────────
router.post('/transfer-owner', requireOnlyOwner, (req, res) => {
  const { new_owner_id } = req.body;
  if (!new_owner_id) return res.status(400).json({ error: 'Yangi ega ID kerak' });
  const newOwner = queries.getUserById(new_owner_id);
  if (!newOwner) return res.status(404).json({ error: 'Foydalanuvchi topilmadi' });
  queries.transferOwner(new_owner_id, req.user.id);
  res.json({ message: `Egalik ${newOwner.first_name} ${newOwner.last_name} ga o'tkazildi` });
});

// ── SETTINGS — bot_token va app_url faqat owner ───────────────────
router.get('/settings', requireOwner, (req, res) => {
  const all = queries.getAllSettings();
  // superadmin uchun maxfiy maydonlarni yashirish
  if (req.user.role === 'superadmin') {
    const { bot_token, ...safe } = all;
    return res.json({ ...safe, bot_token: undefined });
  }
  res.json(all);
});

router.put('/settings', requireOwner, (req, res) => {
  // superadmin faqat app_name ni o'zgartira oladi
  if (req.user.role === 'superadmin') {
    if (req.body.app_name !== undefined) queries.setSetting('app_name', req.body.app_name);
    return res.json({ message: 'Sozlamalar saqlandi' });
  }
  // owner — hammasini o'zgartira oladi
  ['bot_token','channel_id','app_name','app_url',
   'gemini_api_key','groq_api_key','claude_api_key','ai_enabled','ai_system_prompt',
   'daily_report_time','daily_report_enabled','reminder_enabled','reminder_hour',
   'work_start_hour','work_end_hour'
  ].forEach(k => {
    if (req.body[k] !== undefined) queries.setSetting(k, req.body[k]);
  });
  if (req.body.bot_token) {
    try { const { startBot } = require('../bot'); startBot(req.body.bot_token); } catch {}
  }
  res.json({ message: 'Sozlamalar saqlandi' });
});

router.get('/logs', requireOwner, (req, res) => {
  const { period='today' } = req.query;
  const logs = period==='week' ? queries.getLogsWeek() : period==='month' ? queries.getLogsMonth() : queries.getLogsToday();
  res.json(logs);
});

module.exports = router;

// ── Agent trigger ─────────────────────────────────────────────────
router.post('/trigger-report', requireOwner, async (req, res) => {
  try {
    const { sendDailyReport } = require('../agent');
    await sendDailyReport();
    res.json({ message: 'Hisobot yuborildi' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/trigger-reminder', requireOwner, async (req, res) => {
  try {
    const { sendReminders } = require('../agent');
    await sendReminders();
    res.json({ message: 'Eslatmalar yuborildi' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});
