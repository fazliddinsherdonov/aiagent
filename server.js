require('dotenv').config();
const express = require('express');
const cors    = require('cors');
const path    = require('path');
const { initialize, queries } = require('./database');

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// ── Routes ────────────────────────────────────────────────────────
app.use('/api/auth',       require('./routes/auth'));
app.use('/api/owner',      require('./routes/owner'));
app.use('/api/admin',      require('./routes/admin'));
app.use('/api/worker',     require('./routes/worker'));
app.use('/api/stats',      require('./routes/stats'));
app.use('/api/superadmin', require('./routes/superAdmin'));

// ── Workspace based static ────────────────────────────────────────
// /ws/:slug — workspace mini app
app.get('/ws/:slug', async (req, res) => {
  const ws = await queries.getWorkspaceBySlug(req.params.slug);
  if (!ws || ws.status !== 'active')
    return res.status(404).send('<h2>Workspace topilmadi yoki faol emas</h2>');
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.use(express.static(path.join(__dirname, 'public')));
app.get('*', (req, res) => {
  if (!req.path.startsWith('/api'))
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

async function main() {
  await initialize();

  // Super Bot (sizning asosiy botingiz)
  const { startSuperBot } = require('./superBot');
  const superToken = process.env.SUPER_BOT_TOKEN || await queries.getSuperSetting('bot_token');
  startSuperBot(superToken);

  // Barcha aktiv workspace botlarini ishga tushirish
  const { startAllBots } = require('./workspaceManager');
  await startAllBots();

  // Agent (cron jobs)
  const { startAgent } = require('./agent');
  startAgent();

  app.listen(PORT, () => {
    console.log(`✅ Server: http://localhost:${PORT}`);
    console.log(`📦 DB: ${process.env.DATABASE_URL ? 'PostgreSQL' : 'SQLite'}`);
  });
}

main().catch(err => {
  console.error('Server xatosi:', err);
  process.exit(1);
});
