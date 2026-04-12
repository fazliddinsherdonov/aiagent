const router = require('express').Router();
const bcrypt = require('bcryptjs');
const { queries } = require('../database');
const { generateToken, validateTelegramData, verifyToken } = require('../middleware/auth');

// Workspace ni slug orqali aniqlash
// Frontend X-Workspace-Slug header yoki body.ws_slug orqali yuboradi
async function resolveWorkspace(req) {
  const slug = req.headers['x-workspace-slug'] || req.query.ws || req.body.ws_slug;
  if (!slug) return null;
  const ws = await queries.getWorkspaceBySlug(slug);
  if (!ws || ws.status !== 'active') return null;
  return ws;
}

router.post('/login', async (req, res) => {
  try {
    const { identifier, id_type, password } = req.body;
    if (!identifier) return res.status(400).json({ error: 'ID kerak' });

    const ws = await resolveWorkspace(req);
    if (!ws) return res.status(400).json({ error: 'Workspace topilmadi. Sahifani qaytadan oching.' });

    let user = null;

    if (id_type === 'phone' || identifier.startsWith('+')) {
      // Telefon bilan qidirish — topilmasa Telegram ID orqali ham qidirish
      user = await queries.getUserByPhone(ws.id, identifier);
    } else {
      // Telegram ID orqali (owner ham shu bilan kira oladi)
      const tgId = identifier.replace(/^@/, '');
      user = await queries.getUserByTelegramId(ws.id, tgId);
    }

    if (!user) return res.status(404).json({ error: 'Foydalanuvchi topilmadi' });
    if (user.is_blocked) return res.status(403).json({ error: 'Hisobingiz bloklangan' });

    // Faqat owner uchun parol kerak
    if (user.role === 'owner') {
      if (!password) return res.status(401).json({ error: 'Parol kerak' });
      if (!user.password_hash) return res.status(401).json({ error: "Parol o'rnatilmagan. Bot orqali /setpassword ishlating." });
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

// Telegram WebApp auto-login
router.post('/telegram', async (req, res) => {
  try {
    const { initData } = req.body;

    const ws = await resolveWorkspace(req);
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
