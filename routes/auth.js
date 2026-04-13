const router = require('express').Router();
const bcrypt = require('bcryptjs');
const { queries } = require('../database');
const { generateToken, validateTelegramData, verifyToken } = require('../middleware/auth');

// ── Workspace aniqlash ────────────────────────────────────────────
// 1. ws_slug / X-Workspace-Slug header
// 2. Telegram ID orqali — egasi bo'lgan workspace
async function resolveWorkspace(req, tgId) {
  // 1. Slug orqali
  const slug = req.headers['x-workspace-slug'] || req.query.ws || req.body?.ws_slug;
  if (slug) {
    const ws = await queries.getWorkspaceBySlug(slug);
    if (ws) return ws; // active, pending — barchasiga ruxsat
  }

  // 2. Telegram ID orqali — owner o'z workspace ini topadi
  if (tgId) {
    const ws = await queries.getWorkspaceByOwner(String(tgId));
    if (ws) return ws;
  }

  return null;
}

// ── Login ─────────────────────────────────────────────────────────
router.post('/login', async (req, res) => {
  try {
    const { identifier, id_type, password } = req.body;
    if (!identifier) return res.status(400).json({ error: 'ID kerak' });

    // Telegram ID ni oldindan olamiz — workspace topish uchun
    const tgId = (id_type !== 'phone' && !identifier.startsWith('+'))
      ? identifier.replace(/^@/, '')
      : null;

    // Workspace ni topamiz (tgId orqali ham)
    const ws = await resolveWorkspace(req, tgId);
    if (!ws) {
      return res.status(400).json({
        error: 'Workspace topilmadi. Bot orqali ilovani oching yoki admin bilan bog\'laning.'
      });
    }

    // Foydalanuvchini topamiz
    let user = null;
    if (id_type === 'phone' || identifier.startsWith('+')) {
      user = await queries.getUserByPhone(ws.id, identifier);
    } else {
      user = await queries.getUserByTelegramId(ws.id, tgId);
    }

    if (!user) return res.status(404).json({ error: 'Foydalanuvchi topilmadi' });
    if (user.is_blocked) return res.status(403).json({ error: 'Hisobingiz bloklangan' });

    // Faqat owner uchun parol kerak
    if (user.role === 'owner') {
      if (!password) return res.status(401).json({ error: 'Parol kerak' });
      if (!user.password_hash) return res.status(401).json({
        error: "Parol o'rnatilmagan. Botda /setpassword ishlating."
      });
      const valid = await bcrypt.compare(password, user.password_hash);
      if (!valid) return res.status(401).json({ error: "Parol noto'g'ri" });
    }

    const token = generateToken({ ...user, workspace_id: ws.id, workspace_slug: ws.slug });
    const { password_hash, ...safeUser } = user;
    res.json({ token, user: { ...safeUser, workspace_id: ws.id, workspace_slug: ws.slug } });
  } catch (err) {
    console.error('[auth/login]', err);
    res.status(500).json({ error: 'Server xatosi' });
  }
});

// ── Telegram WebApp auto-login ────────────────────────────────────
router.post('/telegram', async (req, res) => {
  try {
    const { initData, ws_slug } = req.body;

    // ws_slug dan workspace topamiz
    const slug = req.headers['x-workspace-slug'] || ws_slug || req.query.ws;
    let ws = null;
    if (slug) {
      ws = await queries.getWorkspaceBySlug(slug);
    }

    if (!ws) return res.status(400).json({ error: 'Workspace topilmadi' });

    const tgUser = validateTelegramData(initData, ws.bot_token);

    if (!tgUser && ws.bot_token) {
      return res.status(401).json({ error: "Telegram ma'lumotlari yaroqsiz" });
    }

    if (tgUser) {
      const user = await queries.getUserByTelegramId(ws.id, String(tgUser.id));
      if (!user) {
        return res.status(404).json({
          error: 'Hisobingiz topilmadi',
          telegram_id: String(tgUser.id),
          not_registered: true
        });
      }
      if (user.is_blocked) return res.status(403).json({ error: 'Hisobingiz bloklangan' });
      const token = generateToken({ ...user, workspace_id: ws.id, workspace_slug: ws.slug });
      const { password_hash, ...safeUser } = user;
      return res.json({ token, user: { ...safeUser, workspace_id: ws.id, workspace_slug: ws.slug } });
    }

    res.status(404).json({ error: "Hisobingiz topilmadi. Admin bilan bog'laning." });
  } catch (err) {
    console.error('[auth/telegram]', err);
    res.status(500).json({ error: 'Server xatosi' });
  }
});

// ── Parol o'zgartirish ────────────────────────────────────────────
router.post('/change-password', verifyToken, async (req, res) => {
  try {
    const { current_password, new_password } = req.body;
    if (!new_password || new_password.length < 4)
      return res.status(400).json({ error: "Parol kamida 4 ta belgi" });
    const user = await queries.getUserById(req.user.id);
    if (user.password_hash && current_password) {
      const valid = await bcrypt.compare(current_password, user.password_hash);
      if (!valid) return res.status(401).json({ error: "Joriy parol noto'g'ri" });
    }
    const hash = await bcrypt.hash(new_password, 10);
    await queries.updatePassword(req.user.id, hash);
    res.json({ message: "Parol o'zgartirildi" });
  } catch (err) {
    res.status(500).json({ error: 'Server xatosi' });
  }
});

router.get('/me', verifyToken, async (req, res) => {
  try {
    const user = await queries.getUserById(req.user.id);
    if (!user) return res.status(404).json({ error: 'Topilmadi' });
    const { password_hash, ...safeUser } = user;
    res.json(safeUser);
  } catch (err) {
    res.status(500).json({ error: 'Server xatosi' });
  }
});

module.exports = router;
