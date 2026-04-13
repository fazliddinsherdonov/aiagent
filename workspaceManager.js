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
  const conversations  = new Map();
  const pendingCheckin = new Map(); // tgId → { wsId, userId, type: 'in'|'out' }
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
    const user    = await queries.getUserByTelegramId(ws.id, String(msg.from.id));
    const isAdmin = user && ['owner','superadmin','admin'].includes(user.role);
    const isWorker = user && user.role === 'worker';

    let text = `📖 <b>Buyruqlar — ${ws.name}</b>\n\n`;
    text += `/start — Boshlash\n/myid — ID ko'rish\n/help — Yordam\n`;
    if (aiOn()) text += `/ai — AI yordamchi\n/clear — Suhbat tozalash\n`;

    if (isWorker || isAdmin) {
      text += `\n<b>⏰ Vaqt hisobi:</b>\n`;
      text += `/kirish — Ish boshlanishi\n`;
      text += `/chiqish — Ish tugashi\n`;
      text += `/vaqt — Bugungi ish vaqtim\n`;
      text += `/mening_vaqtim — Oylik hisobot\n`;
      text += `\n<b>📅 Ta'til/Kasallik:</b>\n`;
      text += `/tatil YYYY-MM-DD YYYY-MM-DD — Ta'til so'rovi\n`;
      text += `/kasal — Bugun kasal\n`;
    }

    if (isAdmin) {
      text += `\n<b>🛡 Admin:</b>\n`;
      text += `/stat /kim /xodimlar /bloklist\n`;
      text += `/hisobot /eslatma\n`;
      text += `/blok &lt;id&gt; /ochish &lt;id&gt;\n`;
    }

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

  // ── /kirish — ish boshlanishi ──────────────────────────────────
  bot.onText(/\/kirish/, async msg => {
    const chatId = String(msg.chat.id);
    const user   = await queries.getUserByTelegramId(ws.id, String(msg.from.id));
    if (!user || user.is_blocked) return;
    if (user.role !== 'worker') return bot.sendMessage(chatId, '❌ Bu buyruq faqat xodimlar uchun.');

    const today = await queries.getTodayAttendance(ws.id, user.id);
    if (today?.check_in) {
      const t = new Date(today.check_in).toLocaleTimeString('uz-UZ', { hour:'2-digit', minute:'2-digit' });
      return bot.sendMessage(chatId, `⚠️ Siz bugun <b>${t}</b> da kirgansiz.`, { parse_mode:'HTML' });
    }

    // GPS lokatsiya so'rash
    bot.sendMessage(chatId,
      `📍 <b>Kirish vaqti belgilanmoqda</b>\n\nJoylashuvingizni yuboring (ixtiyoriy) yoki /skip yozing:`,
      {
        parse_mode: 'HTML',
        reply_markup: {
          keyboard: [[{ text: '📍 Joylashuvni yuborish', request_location: true }],
                     [{ text: '⏩ O\'tkazib yuborish' }]],
          resize_keyboard: true, one_time_keyboard: true
        }
      });

    // Pending state
    pendingCheckin.set(String(msg.from.id), { wsId: ws.id, userId: user.id, type: 'in' });
  });

  // ── /chiqish — ish tugashi ─────────────────────────────────────
  bot.onText(/\/chiqish/, async msg => {
    const chatId = String(msg.chat.id);
    const user   = await queries.getUserByTelegramId(ws.id, String(msg.from.id));
    if (!user || user.is_blocked) return;
    if (user.role !== 'worker') return bot.sendMessage(chatId, '❌ Bu buyruq faqat xodimlar uchun.');

    const today = await queries.getTodayAttendance(ws.id, user.id);
    if (!today?.check_in) {
      return bot.sendMessage(chatId, `⚠️ Avval /kirish buyrug'ini bering.`);
    }
    if (today?.check_out) {
      const t = new Date(today.check_out).toLocaleTimeString('uz-UZ', { hour:'2-digit', minute:'2-digit' });
      return bot.sendMessage(chatId, `⚠️ Siz bugun <b>${t}</b> da chiqqansiz.`, { parse_mode:'HTML' });
    }

    bot.sendMessage(chatId,
      `📍 <b>Chiqish vaqti belgilanmoqda</b>\n\nJoylashuvingizni yuboring (ixtiyoriy):`,
      {
        parse_mode: 'HTML',
        reply_markup: {
          keyboard: [[{ text: '📍 Joylashuvni yuborish', request_location: true }],
                     [{ text: '⏩ O\'tkazib yuborish' }]],
          resize_keyboard: true, one_time_keyboard: true
        }
      });

    pendingCheckin.set(String(msg.from.id), { wsId: ws.id, userId: user.id, type: 'out' });
  });

  // ── /vaqt — bugungi ish vaqtim ────────────────────────────────
  bot.onText(/\/vaqt/, async msg => {
    const user = await queries.getUserByTelegramId(ws.id, String(msg.from.id));
    if (!user) return;
    const today = await queries.getTodayAttendance(ws.id, user.id);
    if (!today?.check_in) return bot.sendMessage(msg.chat.id, '📋 Bugun hali kirmagansiz.');
    const inTime  = new Date(today.check_in).toLocaleTimeString('uz-UZ', { hour:'2-digit', minute:'2-digit' });
    const outTime = today.check_out
      ? new Date(today.check_out).toLocaleTimeString('uz-UZ', { hour:'2-digit', minute:'2-digit' })
      : 'Hali chiqmagan';
    const mins   = today.work_minutes || 0;
    const hours  = Math.floor(mins / 60);
    const remain = mins % 60;
    bot.sendMessage(msg.chat.id,
      `⏰ <b>Bugungi ish vaqti</b>\n\n` +
      `🟢 Kirish: <b>${inTime}</b>\n` +
      `🔴 Chiqish: <b>${outTime}</b>\n` +
      (mins > 0 ? `⏱ Ishlagan: <b>${hours}s ${remain}d</b>` : ''),
      { parse_mode:'HTML' });
  });

  // ── /tatil [sana1] [sana2] — ta'til so'rovi ──────────────────
  bot.onText(/\/tatil(.*)/, async (msg, match) => {
    const chatId = String(msg.chat.id);
    const user   = await queries.getUserByTelegramId(ws.id, String(msg.from.id));
    if (!user || user.is_blocked) return;
    if (user.role !== 'worker') return;

    const args = (match[1]||'').trim().split(/\s+/);
    // Format: /tatil 2024-01-15 2024-01-17 [sabab]
    const dateReg = /^\d{4}-\d{2}-\d{2}$/;
    if (args.length < 2 || !dateReg.test(args[0]) || !dateReg.test(args[1])) {
      return bot.sendMessage(chatId,
        `📅 <b>Ta'til so'rovi</b>\n\n` +
        `Foydalanish: <code>/tatil YYYY-MM-DD YYYY-MM-DD [sabab]</code>\n\n` +
        `Misol:\n<code>/tatil 2024-01-15 2024-01-17 Oilaviy</code>`,
        { parse_mode:'HTML' });
    }

    const startDate = args[0];
    const endDate   = args[1];
    const reason    = args.slice(2).join(' ') || null;

    const start = new Date(startDate);
    const end   = new Date(endDate);
    if (end < start) return bot.sendMessage(chatId, '❌ Tugash sanasi boshlanish sanasidan oldin.');

    const days = Math.ceil((end - start) / (24*3600*1000)) + 1;
    const result = await queries.createLeaveRequest(ws.id, user.id, 'leave', startDate, endDate, reason);
    const reqId  = result.lastInsertRowid;

    bot.sendMessage(chatId,
      `✅ <b>Ta'til so'rovi yuborildi</b>\n\n` +
      `📅 ${startDate} — ${endDate} (${days} kun)\n` +
      (reason ? `📝 Sabab: ${reason}\n` : '') +
      `⏳ Admin ko'rib chiqadi.`,
      { parse_mode:'HTML' });

    // Adminga xabar
    const admins = await queries.getAllAdmins(ws.id);
    for (const a of admins) {
      if (!a.telegram_id) continue;
      bot.sendMessage(a.telegram_id,
        `📅 <b>${user.first_name} ${user.last_name}</b> ta'til so'radi\n` +
        `📆 ${startDate} — ${endDate} (${days} kun)\n` +
        (reason ? `📝 ${reason}\n` : '') +
        `\n<b>Qaror bering:</b>`,
        {
          parse_mode: 'HTML',
          reply_markup: {
            inline_keyboard: [[
              { text: '✅ Tasdiqlash', callback_data: `leave_ok_${reqId}_${user.telegram_id}` },
              { text: '❌ Rad etish',  callback_data: `leave_no_${reqId}_${user.telegram_id}` }
            ]]
          }
        }).catch(()=>{});
    }
  });

  // ── /kasal — kasallik ─────────────────────────────────────────
  bot.onText(/\/kasal(.*)/, async (msg, match) => {
    const user = await queries.getUserByTelegramId(ws.id, String(msg.from.id));
    if (!user || user.is_blocked || user.role !== 'worker') return;
    const today = new Date().toISOString().slice(0,10);
    const reason = (match[1]||'').trim() || 'Kasallik';
    const result = await queries.createLeaveRequest(ws.id, user.id, 'sick', today, today, reason);
    const reqId  = result.lastInsertRowid;

    bot.sendMessage(msg.chat.id,
      `🤒 <b>Kasallik xabari yuborildi</b>\nAdmin xabardor qilindi.`,
      { parse_mode:'HTML' });

    const admins = await queries.getAllAdmins(ws.id);
    for (const a of admins) {
      if (!a.telegram_id) continue;
      bot.sendMessage(a.telegram_id,
        `🤒 <b>${user.first_name} ${user.last_name}</b> bugun kasal\n📝 ${reason}`,
        {
          parse_mode:'HTML',
          reply_markup: { inline_keyboard: [[
            { text:'✅ Qabul', callback_data:`leave_ok_${reqId}_${user.telegram_id}` },
            { text:'❌ Rad',   callback_data:`leave_no_${reqId}_${user.telegram_id}` }
          ]]}
        }).catch(()=>{});
    }
  });

  // ── /mening_vaqtim — oylik ish vaqtim ────────────────────────
  bot.onText(/\/mening_vaqtim/, async msg => {
    const user = await queries.getUserByTelegramId(ws.id, String(msg.from.id));
    if (!user) return;
    const records = await queries.getMonthlyAttendance(ws.id, user.id);
    if (!records.length) return bot.sendMessage(msg.chat.id, '📋 Bu oy ma\'lumot yo\'q.');
    const totalMins  = records.reduce((s,r) => s + (+r.work_minutes||0), 0);
    const totalHours = Math.floor(totalMins/60);
    const days       = records.filter(r => r.check_in).length;
    let text = `📊 <b>Oylik hisobotingiz</b>\n\n`;
    text += `📅 Ish kunlari: <b>${days}</b>\n`;
    text += `⏱ Jami soat: <b>${totalHours}s ${totalMins%60}d</b>\n\n`;
    records.slice(0,10).forEach(r => {
      const d  = r.date;
      const ci = r.check_in  ? new Date(r.check_in).toLocaleTimeString('uz-UZ',{hour:'2-digit',minute:'2-digit'}) : '—';
      const co = r.check_out ? new Date(r.check_out).toLocaleTimeString('uz-UZ',{hour:'2-digit',minute:'2-digit'}) : '—';
      const h  = Math.floor((+r.work_minutes||0)/60);
      const m  = (+r.work_minutes||0)%60;
      text += `${d}: ${ci}→${co} (${h}s${m}d)\n`;
    });
    bot.sendMessage(msg.chat.id, text, { parse_mode:'HTML' });
  });

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

    } else if (data.startsWith('leave_ok_') || data.startsWith('leave_no_')) {
      // leave_ok_<reqId>_<workerTgId>
      const parts      = data.split('_');
      const approved   = parts[1] === 'ok';
      const reqId      = parseInt(parts[2]);
      const workerTgId = parts[3];
      const status     = approved ? 'approved' : 'rejected';

      await queries.reviewLeave(reqId, status, admin.id);

      const statusText = approved ? '✅ Tasdiqlandi' : '❌ Rad etildi';
      bot.editMessageText(
        (cq.message?.text||'') + `\n\n${statusText} — ${admin.first_name}`,
        { chat_id:cq.message.chat.id, message_id:cq.message.message_id, parse_mode:'HTML' }
      ).catch(()=>{});

      // Xodimga xabar
      if (workerTgId) {
        bot.sendMessage(workerTgId,
          approved
            ? `✅ <b>So'rovingiz tasdiqlandi!</b>\nAdmin: ${admin.first_name}`
            : `❌ <b>So'rovingiz rad etildi.</b>\nAdmin: ${admin.first_name}`,
          { parse_mode:'HTML' }).catch(()=>{});
      }
      bot.answerCallbackQuery(cq.id, { text: statusText });
    }
  });

  // Xabarlar
  bot.on('message', async msg => {
    if (msg.text && msg.text.startsWith('/')) return;
    if (!msg.text && !msg.photo && !msg.location) return;

    const chatId = String(msg.chat.id);
    const tgId   = String(msg.from.id);
    const user   = await queries.getUserByTelegramId(ws.id, tgId);
    if (!user || user.is_blocked) return;

    const keys = getKeys();
    const ai   = aiOn();

    // ── LOKATSIYA (kirish/chiqish GPS) ────────────────────────────
    if (msg.location || (msg.text && msg.text === '⏩ O\'tkazib yuborish')) {
      const pending = pendingCheckin.get(tgId);
      if (!pending) return;
      pendingCheckin.delete(tgId);

      const lat = msg.location?.latitude  || null;
      const lng = msg.location?.longitude || null;

      // GPS tekshiruv (agar work_locations sozlangan bo'lsa)
      let locationOk = true;
      let distanceMsg = '';
      if (lat && lng) {
        const locations = await queries.getWorkLocations(ws.id);
        if (locations.length > 0) {
          // Eng yaqin joyga masofani hisoblash (Haversine)
          const closest = locations.map(loc => {
            const R    = 6371000; // metr
            const dLat = (lat - loc.lat) * Math.PI/180;
            const dLng = (lng - loc.lng) * Math.PI/180;
            const a    = Math.sin(dLat/2)**2 +
                         Math.cos(lat*Math.PI/180) * Math.cos(loc.lat*Math.PI/180) *
                         Math.sin(dLng/2)**2;
            const dist = Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a)));
            return { ...loc, dist };
          }).sort((a,b) => a.dist - b.dist)[0];

          if (closest.dist > closest.radius_meters) {
            locationOk = false;
            distanceMsg = `\n⚠️ Ish joyidan ${closest.dist}m uzoqdasiz (ruxsat: ${closest.radius_meters}m)`;
          } else {
            distanceMsg = `\n📍 ${closest.name}dan ${closest.dist}m`;
          }
        }
      }

      const time = new Date().toLocaleTimeString('uz-UZ', { hour:'2-digit', minute:'2-digit' });

      if (pending.type === 'in') {
        await queries.checkIn(pending.wsId, pending.userId, lat, lng);
        bot.sendMessage(chatId,
          `🟢 <b>Kirish qayd etildi: ${time}</b>${distanceMsg}` +
          (!locationOk ? '\n\n⚠️ Ish joyidan tashqaridasiz — admin xabardor qilindi.' : ''),
          { parse_mode:'HTML', reply_markup: { remove_keyboard: true } });

        if (!locationOk) {
          const admins = await queries.getAllAdmins(ws.id);
          for (const a of admins) {
            if (a.telegram_id) bot.sendMessage(a.telegram_id,
              `⚠️ <b>${user.first_name} ${user.last_name}</b> ish joyidan tashqarida kirdi\n📍 ${distanceMsg.trim()}`,
              { parse_mode:'HTML' }).catch(()=>{});
          }
        }
      } else {
        await queries.checkOut(pending.wsId, pending.userId, lat, lng);
        const att  = await queries.getTodayAttendance(pending.wsId, pending.userId);
        const mins = att?.work_minutes || 0;
        const h    = Math.floor(mins/60);
        const m    = mins%60;
        bot.sendMessage(chatId,
          `🔴 <b>Chiqish qayd etildi: ${time}</b>\n⏱ Ishlagan: <b>${h}s ${m}d</b>${distanceMsg}`,
          { parse_mode:'HTML', reply_markup: { remove_keyboard: true } });
      }
      return;
    }

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
