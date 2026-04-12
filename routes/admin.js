const router = require('express').Router();
const bcrypt = require('bcryptjs');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { queries } = require('../database');
const { requireAdmin } = require('../middleware/auth');

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
    if (!file.mimetype.startsWith('image/')) return cb(new Error('Faqat rasm fayllari'));
    cb(null, true);
  }
});

// Dashboard stats
router.get('/stats', requireAdmin, (req, res) => {
  const stats = queries.getStatsSummary();
  const dailyChart = queries.getDailyChart();
  res.json({ stats, dailyChart });
});

// Workers
router.get('/workers', requireAdmin, (req, res) => {
  const workers = queries.getAllWorkers();
  res.json(workers.map(u => { const { password_hash, ...s } = u; return s; }));
});

router.post('/workers', requireAdmin, upload.single('avatar'), async (req, res) => {
  try {
    const { first_name, last_name, phone, telegram_id, username, password } = req.body;
    if (!first_name || !last_name) return res.status(400).json({ error: 'Ism va familya kerak' });

    const password_hash = password ? await bcrypt.hash(password, 10) : null;
    const avatarPath = req.file ? `/uploads/avatars/${req.file.filename}` : null;

    const result = queries.createUser({
      first_name, last_name,
      phone: phone || null,
      telegram_id: telegram_id || null,
      username: username || null,
      password_hash,
      role: 'worker',
      created_by: req.user.id
    });

    if (avatarPath) queries.updateAvatar(result.lastInsertRowid, avatarPath);
    const newUser = queries.getUserById(result.lastInsertRowid);
    const { password_hash: _, ...safeUser } = newUser;
    res.json({ message: 'Xodim qo\'shildi', user: safeUser });
  } catch (err) {
    if (err.message?.includes('UNIQUE')) return res.status(400).json({ error: 'Bu ma\'lumot allaqachon mavjud' });
    res.status(500).json({ error: 'Server xatosi' });
  }
});

router.put('/workers/:id', requireAdmin, upload.single('avatar'), async (req, res) => {
  try {
    const user = queries.getUserById(req.params.id);
    if (!user || user.role !== 'worker') return res.status(404).json({ error: 'Xodim topilmadi' });

    const updates = {};
    const fields = ['first_name', 'last_name', 'phone', 'telegram_id', 'username'];
    for (const f of fields) {
      if (req.body[f] !== undefined) updates[f] = req.body[f] || null;
    }
    if (req.body.password) updates.password_hash = await bcrypt.hash(req.body.password, 10);
    if (req.file) {
      updates.avatar = `/uploads/avatars/${req.file.filename}`;
    }

    queries.updateUser(req.params.id, updates);
    const updated = queries.getUserById(req.params.id);
    const { password_hash, ...safeUser } = updated;
    res.json({ message: 'Xodim yangilandi', user: safeUser });
  } catch (err) {
    res.status(500).json({ error: 'Server xatosi' });
  }
});

router.patch('/workers/:id/block', requireAdmin, (req, res) => {
  const user = queries.getUserById(req.params.id);
  if (!user || user.role !== 'worker') return res.status(404).json({ error: 'Xodim topilmadi' });
  const newBlocked = user.is_blocked ? 0 : 1;
  queries.blockUser(req.params.id, newBlocked);
  res.json({ message: newBlocked ? 'Bloklandi' : 'Blokdan chiqarildi', is_blocked: newBlocked });
});

router.delete('/workers/:id', requireAdmin, (req, res) => {
  const user = queries.getUserById(req.params.id);
  if (!user || user.role !== 'worker') return res.status(404).json({ error: 'Xodim topilmadi' });
  queries.deleteUser(req.params.id);
  res.json({ message: "Xodim o'chirildi" });
});

router.get('/logs', requireAdmin, (req, res) => {
  const { period = 'today' } = req.query;
  let logs;
  if (period === 'week') logs = queries.getLogsWeek();
  else if (period === 'month') logs = queries.getLogsMonth();
  else logs = queries.getLogsToday();
  res.json(logs);
});

module.exports = router;
