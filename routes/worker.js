const router  = require('express').Router();
const multer  = require('multer');
const path    = require('path');
const fs      = require('fs');
const { queries, getDb } = require('../database');
const { verifyToken }    = require('../middleware/auth');
const { imageFingerprint, checkDuplicate, checkVisualDuplicate, getMimeType } = require('../photoUtils');
const { aiImage } = require('../aiClient');

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      const dir = path.join(__dirname, '../uploads/photos');
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    filename: (req, file, cb) => {
      cb(null, `${Date.now()}-${req.user.id}${path.extname(file.originalname)}`);
    }
  }),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!file.mimetype.startsWith('image/')) return cb(new Error('Faqat rasm fayllari'));
    cb(null, true);
  }
});

function getAiKeys() {
  return {
    gemini: queries.getSetting('gemini_api_key') || '',
    groq:   queries.getSetting('groq_api_key')   || '',
    claude: queries.getSetting('claude_api_key') || ''
  };
}
function aiEnabled() { return queries.getSetting('ai_enabled') !== '0'; }

router.get('/profile', verifyToken, (req, res) => {
  const user = queries.getUserById(req.user.id);
  const { password_hash, ...s } = user;
  res.json(s);
});

router.post('/avatar', verifyToken, upload.single('avatar'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Rasm kerak' });
  queries.updateAvatar(req.user.id, `/uploads/photos/${req.file.filename}`);
  res.json({ avatar: `/uploads/photos/${req.file.filename}` });
});

router.post('/photo', verifyToken, upload.single('photo'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Rasm kerak' });

  const filePath = path.join(__dirname, '..', 'uploads', 'photos', req.file.filename);
  let buffer;
  try { buffer = fs.readFileSync(filePath); }
  catch { return res.status(500).json({ error: 'Fayl o\'qishda xato' }); }

  // 1. Hash duplicate
  const fp  = imageFingerprint(buffer);
  const dup = checkDuplicate(fp);
  if (dup) {
    try { fs.unlinkSync(filePath); } catch {}
    return res.status(409).json({ error: 'Bu rasm allaqachon yuborilgan', duplicate: true, sent_at: dup.created_at });
  }

  // 2. Vizual duplicate (AI)
  const keys = getAiKeys();
  if (aiEnabled() && (keys.gemini || keys.claude)) {
    try {
      const vDup = await checkVisualDuplicate(keys, buffer, req.user.id);
      if (vDup) {
        try { fs.unlinkSync(filePath); } catch {}
        return res.status(409).json({ error: 'Bu sahna allaqachon yuborilgan', duplicate: true });
      }
    } catch (e) { console.error('[VISUAL]', e.message); }
  }

  const photoPath = `/uploads/photos/${req.file.filename}`;
  const note      = req.body.note || null;
  queries.addLog(req.user.id, 'photo', photoPath, note, fp.exactHash, fp.perceptualKey || fp.exactHash);
  res.json({ message: 'Rasm yuborildi', photo: photoPath });

  setImmediate(async () => {
    try {
      const user = queries.getUserById(req.user.id);
      const time = new Date(Date.now()+5*3600000).toISOString().replace('T',' ').slice(0,16);
      let aiText = '';
      if (aiEnabled() && (keys.gemini || keys.claude)) {
        try {
          const sysPrompt = queries.getSetting('ai_system_prompt') || '';
          aiText = await aiImage(keys, sysPrompt, buffer, getMimeType(buffer), note) || '';
        } catch {}
      }
      const caption = `📸 <b>${user.first_name} ${user.last_name}</b>\n🕐 ${time}` +
        (note ? `\n📝 ${note}` : '') + (aiText ? `\n\n🤖 <i>${aiText}</i>` : '');
      const botToken  = queries.getSetting('bot_token');
      const channelId = queries.getSetting('channel_id');
      if (botToken && channelId) {
        const { getBot } = require('../bot');
        const bot = getBot();
        if (bot) bot.sendPhoto(channelId, filePath, { caption, parse_mode:'HTML' }).catch(()=>{});
      }
    } catch (err) { console.error('[PHOTO]', err.message); }
  });
});

router.get('/my-logs', verifyToken, (req, res) => {
  const logs = getDb()
    .prepare('SELECT * FROM work_logs WHERE user_id=? ORDER BY created_at DESC LIMIT 50')
    .all(req.user.id);
  res.json(logs);
});

module.exports = router;
