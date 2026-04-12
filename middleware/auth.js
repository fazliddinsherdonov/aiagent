const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { queries } = require('../database');

const JWT_SECRET = process.env.JWT_SECRET || 'your-super-secret-jwt-key-change-in-production';

function verifyToken(req, res, next) {
  const token = req.headers['authorization']?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Token kerak' });
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const user = queries.getUserById(decoded.id);
    if (!user) return res.status(401).json({ error: 'Foydalanuvchi topilmadi' });
    if (user.is_blocked) return res.status(403).json({ error: 'Hisobingiz bloklangan' });
    req.user = user;
    next();
  } catch {
    return res.status(401).json({ error: 'Token yaroqsiz' });
  }
}

function requireOwner(req, res, next) {
  verifyToken(req, res, () => {
    if (!['owner', 'superadmin'].includes(req.user.role)) {
      return res.status(403).json({ error: 'Faqat Ega yoki Super Admin uchun' });
    }
    next();
  });
}

function requireAdmin(req, res, next) {
  verifyToken(req, res, () => {
    if (!['owner', 'superadmin', 'admin'].includes(req.user.role)) {
      return res.status(403).json({ error: 'Ruxsat yoq' });
    }
    next();
  });
}

function generateToken(user) {
  return jwt.sign({ id: user.id, role: user.role }, JWT_SECRET, { expiresIn: '30d' });
}

function validateTelegramData(initData, botToken) {
  if (!initData || !botToken) return null;
  try {
    const params = new URLSearchParams(initData);
    const hash = params.get('hash');
    if (!hash) return null;
    params.delete('hash');
    const dataCheckString = Array.from(params.entries()).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>`${k}=${v}`).join('\n');
    const secretKey = crypto.createHmac('sha256','WebAppData').update(botToken).digest();
    const computedHash = crypto.createHmac('sha256',secretKey).update(dataCheckString).digest('hex');
    if (computedHash !== hash) return null;
    const userStr = params.get('user');
    return userStr ? JSON.parse(userStr) : null;
  } catch { return null; }
}

module.exports = { verifyToken, requireOwner, requireAdmin, generateToken, validateTelegramData };
