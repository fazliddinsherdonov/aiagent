// Super Admin API — faqat super admin uchun
const router  = require('express').Router();
const { queries } = require('../database');
const { verifyToken: _v } = require('../middleware/auth');
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key';

function requireSuperAdmin(req, res, next) {
  const token = req.headers['authorization']?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Token kerak' });
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    if (decoded.role !== 'super_admin') return res.status(403).json({ error: 'Faqat Super Admin' });
    req.superAdmin = decoded;
    next();
  } catch { return res.status(401).json({ error: 'Token yaroqsiz' }); }
}

// Super admin login (tg id + maxsus parol)
router.post('/login', async (req, res) => {
  const { telegram_id, password } = req.body;
  const adminId = await queries.getSuperSetting('super_admin_tg_id');
  const adminPass = process.env.SUPER_ADMIN_PASSWORD || 'superadmin123';
  if (String(telegram_id) !== String(adminId)) return res.status(403).json({ error: 'Ruxsat yo\'q' });
  if (password !== adminPass) return res.status(401).json({ error: 'Parol noto\'g\'ri' });
  const token = jwt.sign({ role:'super_admin', tg_id: telegram_id }, JWT_SECRET, { expiresIn:'7d' });
  res.json({ token });
});

router.get('/workspaces', requireSuperAdmin, async (req, res) => {
  res.json(await queries.getAllWorkspaceStats());
});

router.get('/workspaces/:id', requireSuperAdmin, async (req, res) => {
  const ws    = await queries.getWorkspaceById(req.params.id);
  const stats = await queries.getWorkspaceStats(req.params.id);
  res.json({ ...ws, stats });
});

router.post('/workspaces/:id/activate', requireSuperAdmin, async (req, res) => {
  const { days = 30 } = req.body;
  await queries.activateWorkspace(req.params.id, days);
  const ws = await queries.getWorkspaceById(req.params.id);
  const { startWorkspaceBot } = require('../workspaceManager');
  await startWorkspaceBot(ws);
  res.json({ message: 'Faollashtirildi', workspace: ws });
});

router.post('/workspaces/:id/suspend', requireSuperAdmin, async (req, res) => {
  await queries.suspendWorkspace(req.params.id);
  const ws = await queries.getWorkspaceById(req.params.id);
  const { stopWorkspaceBot } = require('../workspaceManager');
  await stopWorkspaceBot(ws.bot_token);
  res.json({ message: 'To\'xtatildi' });
});

router.delete('/workspaces/:id', requireSuperAdmin, async (req, res) => {
  const ws = await queries.getWorkspaceById(req.params.id);
  if (!ws) return res.status(404).json({ error: 'Topilmadi' });
  const { stopWorkspaceBot } = require('../workspaceManager');
  await stopWorkspaceBot(ws.bot_token);
  await queries.deleteWorkspace(req.params.id);
  res.json({ message: 'O\'chirildi' });
});

router.get('/stats', requireSuperAdmin, async (req, res) => {
  const wsList = await queries.getAllWorkspaceStats();
  res.json({
    total: wsList.length,
    active: wsList.filter(w=>w.status==='active').length,
    pending: wsList.filter(w=>w.status==='pending').length,
    totalWorkers: wsList.reduce((s,w)=>s+(+w.workers||0),0),
    todayPhotos: wsList.reduce((s,w)=>s+(+w.today_photos||0),0),
    workspaces: wsList
  });
});

module.exports = router;
