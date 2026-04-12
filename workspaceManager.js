// ═══════════════════════════════════════════════════════════════════
// Workspace Manager
// Har bir workspace ning botini boshqaradi
// Yangi token kelganda bot yaratadi, o'chirganda to'xtatadi
// ═══════════════════════════════════════════════════════════════════
const TelegramBot = require('node-telegram-bot-api');
const https = require('https');
const { queries } = require('./database');

// Faol botlar: token → bot instance
const activeBots = new Map();

// ── Token tekshirish (Telegram API) ───────────────────────────────
function verifyToken(token) {
  return new Promise((resolve, reject) => {
    https.get(`https://api.telegram.org/bot${token}/getMe`, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (json.ok) resolve(json.result);
          else reject(new Error(json.description || 'Token noto\'g\'ri'));
        } catch { reject(new Error('Javob parse xatosi')); }
      });
    }).on('error', reject);
  });
}

// ── Slug yaratish (oshxona nomi → url slug) ───────────────────────
function makeSlug(name) {
  return name.toLowerCase()
    .replace(/[^a-z0-9\u0400-\u04FF\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 30) + '-' + Date.now().toString(36);
}

// ── Workspace bot yaratish ────────────────────────────────────────
async function startWorkspaceBot(workspace) {
  if (activeBots.has(workspace.bot_token)) {
    return activeBots.get(workspace.bot_token);
  }

  try {
    const bot = new TelegramBot(workspace.bot_token, { polling: true });

    // Workspace bot handlerlari
    setupWorkspaceBotHandlers(bot, workspace);

    activeBots.set(workspace.bot_token, bot);
    console.log(`✅ Bot ishga tushdi: ${workspace.name} (@${workspace.bot_username})`);
    return bot;
  } catch (err) {
    console.error(`❌ Bot xatosi (${workspace.name}):`, err.message);
    return null;
  }
}

// ── Workspace bot to'xtatish ──────────────────────────────────────
async function stopWorkspaceBot(token) {
  const bot = activeBots.get(token);
  if (bot) {
    try { await bot.stopPolling(); } catch {}
    activeBots.delete(token);
    console.log(`🛑 Bot to'xtatildi: ${token.slice(0,10)}...`);
  }
}

// ── Barcha aktiv botlarni ishga tushirish ─────────────────────────
async function startAllBots() {
  const workspaces = await queries.getActiveWorkspaces();
  console.log(`[WM] ${workspaces.length} ta aktiv workspace boti ishga tushmoqda...`);
  for (const ws of workspaces) {
    await startWorkspaceBot(ws);
    // Rate limit uchun kichik pauza
    await new Promise(r => setTimeout(r, 300));
  }
}

// ── Workspace bot handlerlari ─────────────────────────────────────
function setupWorkspaceBotHandlers(bot, ws) {
  const { imageFingerprint, checkDuplicate: _checkDup, checkVisualDuplicate, downloadBuffer, getMimeType } = require('./photoUtils');
  const { aiChat, aiImage } = require('./aiClient');

  // Workspace scoped queries
  function checkDuplicate(fp) {
    return Promise.all([
      queries.checkPhotoHash(ws.id, fp.exactHash),
      fp.perceptualKey ? queries.checkPhotoSortedHash(ws.id, fp.perceptualKey) : null
    ]).then(([byE, byP]) => byE || byP);
  }

  function getKeys() {
    return {
      gemini: ws.gemini_api_key || '',
      groq:   ws.groq_api_key   || '',
      claude: ws.claude_api_key || ''
    };
  }
  function hasKey(k) { return !!(k.gemini || k.groq || k.claude); }
  function aiOn()    { return ws.ai_enabled !== '0'; }

  // Conversations xotirasi
  const conversations = new Map();
  function getHistory(cid) {
    if (!conversations.has(cid)) conversations.set(cid, []);
    return conversations.get(cid);
  }
  function addHistory(cid, role, content) {
    const h = getHistory(cid);
    h.push({ role, content });
    if (h.length > 20) h.splice(0, h.length - 20);
  }

  // /start
  bot.onText(/\/start/, async msg => {
    const chatId = String(msg.chat.id);
    const tgId   = String(msg.from.id);
    const user   = await queries.getUserByTelegramId(ws.id, tgId);

    if (!user) return bot.sendMessage(chatId,
      `👋 Salom, <b>${msg.from.first_name}</b>!\n\n` +
      `❌ ID: <code>${tgId}</code>\n\nTizimda yo'qsiz. Admin bilan bog'laning.`,
      { parse_mode:'HTML' });

    if (user.is_blocked) return bot.sendMessage(chatId,
      '🚫 Hisobingiz bloklangan.', { parse_mode:'HTML' });

    const roles = { owner:'👑 Ega', superadmin:'⭐ Super Admin', admin:'🛡️ Admin', worker:'👤 Xodim' };
    const kb = ws.app_url ? {
      reply_markup: { inline_keyboard: [[{ text:`🚀 ${ws.name}ni ochish`, web_app:{ url: ws.app_url + `/ws/${ws.slug}` } }]] }
    } : {};

    bot.sendMessage(chatId,
      `✅ Xush kelibsiz, <b>${user.first_name} ${user.last_name}</b>!\n` +
      `🏷 Rol: ${roles[user.role]||user.role}\n` +
      `🏢 ${ws.name}`,
      { parse_mode:'HTML', ...kb });
  });

  bot.onText(/\/myid/, msg => bot.sendMessage(msg.chat.id, `🆔 <code>${msg.from.id}</code>`, { parse_mode:'HTML' }));

  bot.onText(/\/help/, async msg => {
    const user = await queries.getUserByTelegramId(ws.id, String(msg.from.id));
    const isAdmin = user && ['owner','superadmin','admin'].includes(user.role);
    let text = `📖 <b>Buyruqlar — ${ws.name}</b>\n\n/start /myid /help`;
    if (aiOn()) text += '\n/ai /clear';
    if (isAdmin) text += '\n\n<b>Admin:</b>\n/stat /kim /xodimlar /bloklist\n/hisobot /eslatma\n/blok &lt;id&gt; /ochish &lt;id&gt;';
    bot.sendMessage(msg.chat.id, text, { parse_mode:'HTML' });
  });

  bot.onText(/\/stat/, async msg => {
    const user = await queries.getUserByTelegramId(ws.id, String(msg.from.id));
    if (!user || !['owner','superadmin','admin'].includes(user.role)) return;
    const stats = await queries.getWorkspaceStats(ws.id);
    bot.sendMessage(msg.chat.id,
      `📊 <b>${ws.name}</b>\n\n` +
      `👥 Xodimlar: <b>${stats?.workers||0}</b>\n` +
      `✅ Bugun faol: <b>${stats?.today_active||0}</b>\n` +
      `📸 Bugungi rasmlar: <b>${stats?.today_photos||0}</b>`,
      { parse_mode:'HTML' });
  });

  bot.onText(/\/kim/, async msg => {
    const user = await queries.getUserByTelegramId(ws.id, String(msg.from.id));
    if (!user || !['owner','superadmin','admin'].includes(user.role)) return;
    const missing = await queries.getMissingWorkersToday(ws.id);
    if (!missing.length) return bot.sendMessage(msg.chat.id, '✅ Bugun hamma rasm yubordi!');
    let text = `❌ <b>Kelmadi (${missing.length}):</b>\n\n`;
    missing.forEach((w,i) => {
      text += `${i+1}. ${w.first_name} ${w.last_name}`;
      if (w.reason) text += ` — <i>${w.reason}</i>`;
      text += '\n';
    });
    bot.sendMessage(msg.chat.id, text, { parse_mode:'HTML' });
  });

  bot.onText(/\/xodimlar/, async msg => {
    const user = await queries.getUserByTelegramId(ws.id, String(msg.from.id));
    if (!user || !['owner','superadmin','admin'].includes(user.role)) return;
    const workers = await queries.getAllWorkers(ws.id);
    const active  = workers.filter(w => !w.is_blocked);
    let text = `👥 <b>Xodimlar (${workers.length})</b>\n\n`;
    active.slice(0,25).forEach((w,i) => { text += `${i+1}. ${w.first_name} ${w.last_name} <code>${w.telegram_id}</code>\n`; });
    if (active.length > 25) text += `...va yana ${active.length-25} ta\n`;
    bot.sendMessage(msg.chat.id, text, { parse_mode:'HTML' });
  });

  bot.onText(/\/bloklist/, async msg => {
    const user = await queries.getUserByTelegramId(ws.id, String(msg.from.id));
    if (!user || !['owner','superadmin','admin'].includes(user.role)) return;
    const workers = await queries.getAllWorkers(ws.id);
    const blocked = workers.filter(w => w.is_blocked);
    if (!blocked.length) return bot.sendMessage(msg.chat.id, '✅ Bloklangan xodim yo\'q.');
    let text = `🔴 <b>Bloklangan (${blocked.length}):</b>\n\n`;
    blocked.forEach((w,i) => { text += `${i+1}. ${w.first_name} ${w.last_name} <code>${w.telegram_id}</code>\n`; });
    bot.sendMessage(msg.chat.id, text, { parse_mode:'HTML' });
  });

  bot.onText(/\/hisobot/, async msg => {
    const user = await queries.getUserByTelegramId(ws.id, String(msg.from.id));
    if (!user || !['owner','superadmin','admin'].includes(user.role)) return;
    const { sendWorkspaceReport } = require('./agent');
    await sendWorkspaceReport(ws, bot);
    bot.sendMessage(msg.chat.id, '📊 Hisobot yuborildi!');
  });

  bot.onText(/\/eslatma/, async msg => {
    const user = await queries.getUserByTelegramId(ws.id, String(msg.from.id));
    if (!user || !['owner','superadmin','admin'].includes(user.role)) return;
    const { sendWorkspaceReminders } = require('./agent');
    await sendWorkspaceReminders(ws, bot);
    bot.sendMessage(msg.chat.id, '⏰ Eslatmalar yuborildi!');
  });

  bot.onText(/\/blok (.+)/, async (msg, match) => {
    const user = await queries.getUserByTelegramId(ws.id, String(msg.from.id));
    if (!user || !['owner','superadmin','admin'].includes(user.role)) return;
    const target = await queries.getUserByTelegramId(ws.id, match[1].trim());
    if (!target) return bot.sendMessage(msg.chat.id, '❌ Topilmadi.');
    await queries.blockUser(target.id, true);
    if (target.telegram_id) bot.sendMessage(target.telegram_id, '🚫 Hisobingiz bloklandi.').catch(()=>{});
    bot.sendMessage(msg.chat.id, `✅ ${target.first_name} bloklandi.`);
  });

  bot.onText(/\/ochish (.+)/, async (msg, match) => {
    const user = await queries.getUserByTelegramId(ws.id, String(msg.from.id));
    if (!user || !['owner','superadmin','admin'].includes(user.role)) return;
    const target = await queries.getUserByTelegramId(ws.id, match[1].trim());
    if (!target) return bot.sendMessage(msg.chat.id, '❌ Topilmadi.');
    await queries.blockUser(target.id, false);
    if (target.telegram_id) bot.sendMessage(target.telegram_id, '✅ Hisobingiz tiklandi!').catch(()=>{});
    bot.sendMessage(msg.chat.id, `✅ ${target.first_name} blokdan chiqarildi.`);
  });

  bot.onText(/\/ai/, msg => {
    const keys = getKeys();
    if (!aiOn() || !hasKey(keys)) return bot.sendMessage(msg.chat.id, '🤖 AI sozlanmagan.');
    bot.sendMessage(msg.chat.id, `🤖 <b>AI Yordamchi faol!</b>\nSavol yozing yoki rasm yuboring.\n/clear — Suhbat tozalash`, { parse_mode:'HTML' });
  });

  bot.onText(/\/clear/, msg => { conversations.delete(String(msg.chat.id)); bot.sendMessage(msg.chat.id, '🗑 Tozalandi!'); });

  // Inline callback (bloklash tugmasi)
  bot.on('callback_query', async cq => {
    const data  = cq.data || '';
    const admin = await queries.getUserByTelegramId(ws.id, String(cq.from.id));
    if (!admin || !['owner','superadmin','admin'].includes(admin.role))
      return bot.answerCallbackQuery(cq.id, { text:'❌ Ruxsat yo\'q' });

    if (data.startsWith('block_')) {
      const uid    = parseInt(data.split('_')[1]);
      const worker = await queries.getUserById(uid);
      if (!worker) return bot.answerCallbackQuery(cq.id, { text:'❌ Topilmadi' });
      await queries.blockUser(uid, true);
      await queries.updateAbsenceStatus(ws.id, uid, 'blocked');
      if (worker.telegram_id) bot.sendMessage(worker.telegram_id, '🚫 Hisobingiz bloklandi.').catch(()=>{});
      bot.editMessageText((cq.message?.text||'') + `\n\n✅ ${admin.first_name} blokladi`,
        { chat_id:cq.message.chat.id, message_id:cq.message.message_id, parse_mode:'HTML' }).catch(()=>{});
      bot.answerCallbackQuery(cq.id, { text:`✅ Bloklandi` });
    } else if (data.startsWith('skip_')) {
      const uid = parseInt(data.split('_')[1]);
      await queries.updateAbsenceStatus(ws.id, uid, 'skipped');
      bot.editMessageText((cq.message?.text||'') + `\n\n✅ ${admin.first_name} o'tkazib yubordi`,
        { chat_id:cq.message.chat.id, message_id:cq.message.message_id, parse_mode:'HTML' }).catch(()=>{});
      bot.answerCallbackQuery(cq.id, { text:'✅ O\'tkazildi' });
    }
  });

  // Xabarlar
  bot.on('message', async msg => {
    if (msg.text && msg.text.startsWith('/')) return;
    if (!msg.text && !msg.photo) return;

    const chatId = String(msg.chat.id);
    const tgId   = String(msg.from.id);
    const user   = await queries.getUserByTelegramId(ws.id, tgId);
    if (!user || user.is_blocked) return;

    const keys = getKeys();
    const ai   = aiOn();

    // RASM
    if (msg.photo) {
      await bot.sendChatAction(chatId, 'upload_photo');
      try {
        const photo    = msg.photo[msg.photo.length-1];
        const fileInfo = await bot.getFile(photo.file_id);
        const fileUrl  = `https://api.telegram.org/file/bot${ws.bot_token}/${fileInfo.file_path}`;
        const buffer   = await downloadBuffer(fileUrl);
        const mime     = getMimeType(buffer);
        const fp       = imageFingerprint(buffer);
        const dup      = await checkDuplicate(fp);

        if (dup) {
          const t = new Date(dup.created_at).toLocaleString('uz-UZ', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' });
          return bot.sendMessage(chatId, `⚠️ <b>Bu rasm allaqachon yuborilgan!</b>\n🕐 ${t}\n\nYangi rasm yuboring.`, { parse_mode:'HTML' });
        }

        // Vizual duplicate
        if (ai && (keys.gemini||keys.claude)) {
          try {
            const vDup = await checkVisualDuplicate(keys, buffer, user.id);
            if (vDup) return bot.sendMessage(chatId, `⚠️ <b>Bu sahna allaqachon yuborilgan!</b>`, { parse_mode:'HTML' });
          } catch {}
        }

        const fs   = require('fs');
        const path = require('path');
        const dir  = path.join(__dirname, 'uploads', 'photos');
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive:true });
        const filename = `${Date.now()}-${user.id}-bot.jpg`;
        const filePath = path.join(dir, filename);
        fs.writeFileSync(filePath, buffer);
        const photoPath = `/uploads/photos/${filename}`;
        const note = msg.caption || null;
        await queries.addLog(ws.id, user.id, 'photo', photoPath, note, fp.exactHash, fp.perceptualKey||fp.exactHash);

        let aiText = '';
        if (ai && (keys.gemini||keys.claude)) {
          try { aiText = await aiImage(keys, ws.ai_system_prompt||'', buffer, mime, note) || ''; } catch {}
        }

        const time = new Date(Date.now()+5*3600000).toISOString().replace('T',' ').slice(0,16);
        await bot.sendMessage(chatId,
          `✅ <b>Rasm qabul qilindi!</b>\n🕐 ${time}` + (aiText ? `\n\n🤖 ${aiText}` : ''),
          { parse_mode:'HTML' });

        if (ws.channel_id) {
          const cap = `📸 <b>${user.first_name} ${user.last_name}</b>\n🕐 ${time}` +
            (note ? `\n📝 ${note}` : '') + (aiText ? `\n\n🤖 <i>${aiText}</i>` : '');
          bot.sendPhoto(ws.channel_id, filePath, { caption:cap, parse_mode:'HTML' }).catch(()=>{});
        }
      } catch (err) {
        console.error(`[WS ${ws.name}] Rasm xatosi:`, err.message);
        bot.sendMessage(chatId, '⚠️ Xato. Qayta yuboring.').catch(()=>{});
      }
      return;
    }

    // Sabab qabul qilish
    if (msg.text && user.role === 'worker') {
      const absence = await queries.getAbsenceToday(ws.id, user.id);
      if (absence && absence.status === 'asked' && !absence.reason) {
        await queries.saveReason(ws.id, user.id, msg.text.slice(0,300));
        const admins = await queries.getAllAdmins(ws.id);
        const time   = new Date().toLocaleString('uz-UZ', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' });
        for (const a of admins) {
          if (a.telegram_id) bot.sendMessage(a.telegram_id,
            `ℹ️ <b>${user.first_name} ${user.last_name}</b> kelmadi\n📝 Sabab: <i>${msg.text.slice(0,200)}</i>\n🕐 ${time}`,
            { parse_mode:'HTML' }).catch(()=>{});
        }
        return bot.sendMessage(chatId, `✅ Sababingiz qabul qilindi.`, { parse_mode:'HTML' });
      }
    }

    // AI chat
    if (!ai || !hasKey(keys)) return;
    try {
      await bot.sendChatAction(chatId, 'typing');
      addHistory(chatId, 'user', msg.text);
      const reply = await aiChat(keys, ws.ai_system_prompt||'', getHistory(chatId));
      addHistory(chatId, 'assistant', reply);
      bot.sendMessage(chatId, reply).catch(async () => bot.sendMessage(chatId, reply));
    } catch (err) {
      bot.sendMessage(chatId, err.message.includes('Barcha') ? '⚠️ AI ishlamaydi.' : '⚠️ Xato.').catch(()=>{});
    }
  });

  bot.on('polling_error', err => console.error(`[${ws.name}] Bot xatosi:`, err.message));
}

function getActiveBot(token) { return activeBots.get(token); }
function getActiveBots()     { return activeBots; }

module.exports = { startWorkspaceBot, stopWorkspaceBot, startAllBots, verifyToken, makeSlug, getActiveBot, getActiveBots };
