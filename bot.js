const TelegramBot = require('node-telegram-bot-api');
const fs   = require('fs');
const path = require('path');
const { queries } = require('./database');
const { imageFingerprint, checkDuplicate, checkVisualDuplicate, downloadBuffer, getMimeType } = require('./photoUtils');
const { aiChat, aiImage } = require('./aiClient');

let bot = null;
const conversations = new Map();
const MAX_HISTORY = 20;

function getHistory(cid) {
  if (!conversations.has(cid)) conversations.set(cid, []);
  return conversations.get(cid);
}
function addHistory(cid, role, content) {
  const h = getHistory(cid);
  h.push({ role, content });
  if (h.length > MAX_HISTORY) h.splice(0, h.length - MAX_HISTORY);
}
function clearHistory(cid) { conversations.delete(cid); }

async function getKeys() {
  return {
    gemini: await queries.getSetting('gemini_api_key') || '',
    groq:   await queries.getSetting('groq_api_key')   || '',
    claude: await queries.getSetting('claude_api_key') || ''
  };
}
function hasKey(k) { return !!(k.gemini || k.groq || k.claude); }
async function aiOn() { return await queries.getSetting('ai_enabled') !== '0'; }

function activeProviders(k) {
  return [k.gemini&&'Gemini', k.groq&&'Groq', k.claude&&'Claude'].filter(Boolean).join(' → ');
}

function startBot(token, opts = {}) {
  if (bot) { try { bot.stopPolling(); } catch {} bot = null; }
  if (!token) return null;

  try {
    const botOpts = opts.mode === 'webhook'
      ? { webHook: false }  // webhook ni express handle qiladi
      : { polling: true };

    bot = new TelegramBot(token, botOpts);

    if (opts.mode === 'webhook' && opts.webhookUrl) {
      bot.setWebHook(opts.webhookUrl).then(() =>
        console.log('✅ Webhook o\'rnatildi:', opts.webhookUrl)
      ).catch(console.error);
    }

    // ── Handlers ──────────────────────────────────────────────
    bot.onText(/\/start/, async (msg) => {
      const chatId = String(msg.chat.id);
      const tgId   = String(msg.from.id);
      const user   = await queries.getUserByTelegramId(tgId);
      const url    = await queries.getSetting('app_url') || '';
      const name   = await queries.getSetting('app_name') || 'Xodimlar';
      const kb = url ? { reply_markup: { inline_keyboard: [[{ text:`🚀 ${name}ni ochish`, web_app:{url} }]] } } : {};

      if (!user) return bot.sendMessage(chatId,
        `👋 Salom, <b>${msg.from.first_name}</b>!\n\n❌ ID: <code>${tgId}</code>\n\nTizimda yo'qsiz. Admin bilan bog'laning.`,
        { parse_mode:'HTML', ...kb });
      if (user.is_blocked) return bot.sendMessage(chatId, '🚫 Hisobingiz bloklangan.', { parse_mode:'HTML' });

      const roles = { owner:'👑 Ega', superadmin:'⭐ Super Admin', admin:'🛡️ Admin', worker:'👤 Xodim' };
      const keys  = await getKeys();
      const ai    = await aiOn();
      await bot.sendMessage(chatId,
        `✅ Xush kelibsiz, <b>${user.first_name} ${user.last_name}</b>!\n` +
        `🏷 Rol: ${roles[user.role]||user.role}\n` +
        (ai && hasKey(keys) ? `🤖 AI: <b>${activeProviders(keys)}</b>\n` : '') +
        `\n` + (url ? '👇 Ilovani oching:' : '⚙️ URL sozlanmagan.'),
        { parse_mode:'HTML', ...kb });
    });

    bot.onText(/\/myid/, msg => bot.sendMessage(msg.chat.id, `🆔 <code>${msg.from.id}</code>`, { parse_mode:'HTML' }));

    bot.onText(/\/help/, async msg => {
      const tgId = String(msg.from.id);
      const user = await queries.getUserByTelegramId(tgId);
      const keys = await getKeys();
      const ai   = await aiOn();
      const isAdmin = user && ['owner','superadmin','admin'].includes(user.role);
      const isOwner = user && ['owner','superadmin'].includes(user.role);

      let text = `📖 <b>Buyruqlar</b>\n\n`;
      text += `<b>Hammaga:</b>\n`;
      text += `/start — Boshlash\n/myid — Telegram ID\n/help — Yordam\n`;
      if (ai && hasKey(keys)) text += `/ai — AI holati\n/clear — Suhbatni tozalash\n`;

      if (isAdmin) {
        text += `\n<b>Admin buyruqlari:</b>\n`;
        text += `/stat — Tezkor statistika\n`;
        text += `/kim — Bugun kelmagan xodimlar\n`;
        text += `/xodimlar — Xodimlar ro'yxati\n`;
        text += `/bloklist — Bloklangan xodimlar\n`;
        text += `/hisobot — Hisobotni hozir yuborish\n`;
        text += `/eslatma — Eslatmani hozir yuborish\n`;
        text += `/blok &lt;telegram_id&gt; — Xodimni bloklash\n`;
        text += `/ochish &lt;telegram_id&gt; — Blokdan chiqarish\n`;
      }
      if (isOwner) {
        text += `\n<b>Ega buyruqlari:</b>\n`;
        text += `/sozla — Sozlamalar ko'rish\n`;
      }

      bot.sendMessage(msg.chat.id, text, { parse_mode:'HTML' });
    });

    bot.onText(/\/ai/, async msg => {
      const keys = await getKeys();
      const ai   = await aiOn();
      if (!ai || !hasKey(keys)) return bot.sendMessage(msg.chat.id, '🤖 AI sozlanmagan.');
      bot.sendMessage(msg.chat.id,
        `🤖 <b>AI Yordamchi faol!</b>\n⚡ <b>${activeProviders(keys)}</b>\n\nSavol yozing yoki rasm yuboring!\n/clear — Suhbat tozalash`,
        { parse_mode:'HTML' });
    });

    bot.onText(/\/clear/, msg => { clearHistory(String(msg.chat.id)); bot.sendMessage(msg.chat.id, '🗑 Tozalandi!'); });

    bot.onText(/\/hisobot/, async msg => {
      const user = await queries.getUserByTelegramId(String(msg.from.id));
      if (!user || !['owner','superadmin','admin'].includes(user.role)) return;
      const { sendDailyReport } = require('./agent');
      await sendDailyReport();
      bot.sendMessage(msg.chat.id, '📊 Hisobot yuborildi!');
    });

    bot.onText(/\/eslatma/, async msg => {
      const user = await queries.getUserByTelegramId(String(msg.from.id));
      if (!user || !['owner','superadmin','admin'].includes(user.role)) return;
      const { sendReminders } = require('./agent');
      await sendReminders();
      bot.sendMessage(msg.chat.id, '⏰ Eslatmalar yuborildi!');
    });

    // ── /stat — tezkor statistika ──────────────────────────────
    bot.onText(/\/stat/, async msg => {
      const user = await queries.getUserByTelegramId(String(msg.from.id));
      if (!user || !['owner','superadmin','admin'].includes(user.role)) return;
      try {
        const stats = await queries.getStatsSummary();
        const appName = await queries.getSetting('app_name') || 'Xodimlar';
        const today = new Date().toLocaleDateString('uz-UZ', { day:'2-digit', month:'2-digit', year:'numeric' });
        bot.sendMessage(msg.chat.id,
          `📊 <b>${appName} — Statistika</b>\n📅 ${today}\n${'─'.repeat(24)}\n\n` +
          `👥 Jami xodimlar: <b>${stats.totalWorkers}</b>\n` +
          `🛡 Adminlar: <b>${stats.totalAdmins}</b>\n\n` +
          `✅ Bugun faol: <b>${stats.todayActive}</b>\n` +
          `📸 Bugun rasmlar: <b>${stats.todayPhotos}</b>\n` +
          `📅 Haftalik: <b>${stats.weeklyLogs}</b>\n` +
          `📆 Oylik: <b>${stats.monthlyLogs}</b>`,
          { parse_mode:'HTML' });
      } catch (err) {
        bot.sendMessage(msg.chat.id, '❌ Xato: ' + err.message);
      }
    });

    // ── /kim — bugun kelmagan xodimlar ────────────────────────
    bot.onText(/\/kim/, async msg => {
      const user = await queries.getUserByTelegramId(String(msg.from.id));
      if (!user || !['owner','superadmin','admin'].includes(user.role)) return;
      try {
        const missing = await queries.getMissingWorkersToday();
        if (missing.length === 0) {
          return bot.sendMessage(msg.chat.id, '✅ Bugun hamma rasm yubordi!', { parse_mode:'HTML' });
        }
        let text = `❌ <b>Bugun kelmagan xodimlar (${missing.length} ta):</b>\n\n`;
        missing.forEach((w, i) => {
          const reason = w.reason ? `\n   📝 <i>${w.reason}</i>` : '';
          const status = w.status === 'blocked' ? ' 🔴' : w.status === 'replied' ? ' 💬' : '';
          text += `${i+1}. ${w.first_name} ${w.last_name}${status}${reason}\n`;
        });
        bot.sendMessage(msg.chat.id, text, { parse_mode:'HTML' });
      } catch (err) {
        bot.sendMessage(msg.chat.id, '❌ Xato: ' + err.message);
      }
    });

    // ── /bloklist — bloklangan xodimlar ───────────────────────
    bot.onText(/\/bloklist/, async msg => {
      const user = await queries.getUserByTelegramId(String(msg.from.id));
      if (!user || !['owner','superadmin','admin'].includes(user.role)) return;
      try {
        const allWorkers = await queries.getAllWorkers();
        const blocked = allWorkers.filter(w => w.is_blocked);
        if (blocked.length === 0) {
          return bot.sendMessage(msg.chat.id, '✅ Bloklangan xodimlar yo\'q.', { parse_mode:'HTML' });
        }
        let text = `🔴 <b>Bloklangan xodimlar (${blocked.length} ta):</b>\n\n`;
        blocked.forEach((w, i) => {
          text += `${i+1}. ${w.first_name} ${w.last_name}`;
          if (w.telegram_id) text += ` <code>${w.telegram_id}</code>`;
          text += '\n';
        });
        bot.sendMessage(msg.chat.id, text, { parse_mode:'HTML' });
      } catch (err) {
        bot.sendMessage(msg.chat.id, '❌ Xato: ' + err.message);
      }
    });

    // ── /xodimlar — barcha xodimlar ro'yxati ──────────────────
    bot.onText(/\/xodimlar/, async msg => {
      const user = await queries.getUserByTelegramId(String(msg.from.id));
      if (!user || !['owner','superadmin','admin'].includes(user.role)) return;
      try {
        const workers = await queries.getAllWorkers();
        const active  = workers.filter(w => !w.is_blocked);
        const blocked = workers.filter(w => w.is_blocked);
        let text = `👥 <b>Xodimlar ro'yxati (${workers.length} ta)</b>\n`;
        text += `✅ Faol: ${active.length}  🔴 Bloklangan: ${blocked.length}\n\n`;
        active.slice(0, 30).forEach((w, i) => {
          text += `${i+1}. ${w.first_name} ${w.last_name}`;
          if (w.telegram_id) text += ` <code>${w.telegram_id}</code>`;
          text += '\n';
        });
        if (active.length > 30) text += `... va yana ${active.length - 30} ta\n`;
        bot.sendMessage(msg.chat.id, text, { parse_mode:'HTML' });
      } catch (err) {
        bot.sendMessage(msg.chat.id, '❌ Xato: ' + err.message);
      }
    });

    // ── /sozla — sozlamalar menyusi (faqat Ega) ───────────────
    bot.onText(/\/sozla/, async msg => {
      const user = await queries.getUserByTelegramId(String(msg.from.id));
      if (!user || !['owner','superadmin'].includes(user.role)) {
        return bot.sendMessage(msg.chat.id, '❌ Bu buyruq faqat Ega va Super Admin uchun.');
      }
      const settings = await queries.getAllSettings();
      const isOwner  = user.role === 'owner';

      let text = `⚙️ <b>Sozlamalar</b>\n\n`;
      text += `📱 Ilova: <b>${settings.app_name || '—'}</b>\n`;
      if (isOwner) {
        text += `🔗 URL: <code>${settings.app_url || '—'}</code>\n`;
        text += `🤖 Bot token: <b>${settings.bot_token ? '✅ Sozlangan' : '❌ Yo\'q'}</b>\n`;
        text += `📢 Kanal: <b>${settings.channel_id || '—'}</b>\n\n`;
        text += `🧠 Gemini: <b>${settings.gemini_api_key ? '✅' : '❌'}</b>  `;
        text += `⚡ Groq: <b>${settings.groq_api_key ? '✅' : '❌'}</b>  `;
        text += `🔶 Claude: <b>${settings.claude_api_key ? '✅' : '❌'}</b>\n`;
        text += `🤖 AI holati: <b>${settings.ai_enabled !== '0' ? '✅ Yoqilgan' : '❌ O\'chirilgan'}</b>\n\n`;
      }
      text += `📊 Hisobot vaqti: <b>${settings.daily_report_time || '20:00'}</b>\n`;
      text += `📊 Hisobot: <b>${settings.daily_report_enabled !== '0' ? '✅' : '❌'}</b>\n`;
      text += `⏰ Eslatma: <b>${settings.reminder_enabled !== '0' ? '✅' : '❌'}</b>  `;
      text += `Vaqt: <b>${settings.reminder_hour || '9'}:00</b>\n\n`;
      text += `💡 Sozlamalarni o'zgartirish uchun Mini App dan foydalaning.`;

      bot.sendMessage(msg.chat.id, text, { parse_mode:'HTML' });
    });

    // ── /blok <telegram_id> — xodimni bloklash ────────────────
    bot.onText(/\/blok (.+)/, async (msg, match) => {
      const user = await queries.getUserByTelegramId(String(msg.from.id));
      if (!user || !['owner','superadmin','admin'].includes(user.role)) return;
      const targetTgId = match[1].trim();
      try {
        const target = await queries.getUserByTelegramId(targetTgId);
        if (!target) return bot.sendMessage(msg.chat.id, '❌ Xodim topilmadi. Telegram ID ni tekshiring.');
        if (target.role !== 'worker') return bot.sendMessage(msg.chat.id, '❌ Faqat xodimlarni bloklash mumkin.');
        await queries.blockUser(target.id, true);
        if (target.telegram_id) {
          botRef.sendMessage(target.telegram_id,
            '🚫 <b>Hisobingiz bloklandi.</b>\nAdmin bilan bog\'laning.',
            { parse_mode:'HTML' }).catch(()=>{});
        }
        bot.sendMessage(msg.chat.id,
          `✅ <b>${target.first_name} ${target.last_name}</b> bloklandi.`,
          { parse_mode:'HTML' });
      } catch (err) {
        bot.sendMessage(msg.chat.id, '❌ Xato: ' + err.message);
      }
    });

    // ── /ochish <telegram_id> — blokdan chiqarish ─────────────
    bot.onText(/\/ochish (.+)/, async (msg, match) => {
      const user = await queries.getUserByTelegramId(String(msg.from.id));
      if (!user || !['owner','superadmin','admin'].includes(user.role)) return;
      const targetTgId = match[1].trim();
      try {
        const target = await queries.getUserByTelegramId(targetTgId);
        if (!target) return bot.sendMessage(msg.chat.id, '❌ Xodim topilmadi.');
        await queries.blockUser(target.id, false);
        if (target.telegram_id) {
          botRef.sendMessage(target.telegram_id,
            '✅ <b>Hisobingiz tiklandi!</b>\nEndi tizimdan foydalana olasiz.',
            { parse_mode:'HTML' }).catch(()=>{});
        }
        bot.sendMessage(msg.chat.id,
          `✅ <b>${target.first_name} ${target.last_name}</b> blokdan chiqarildi.`,
          { parse_mode:'HTML' });
      } catch (err) {
        bot.sendMessage(msg.chat.id, '❌ Xato: ' + err.message);
      }
    });

    // ── Xabarlar ──────────────────────────────────────────────
    bot.on('message', async (msg) => {
      if (msg.text && msg.text.startsWith('/')) return;
      if (!msg.text && !msg.photo) return;

      const chatId = String(msg.chat.id);
      const tgId   = String(msg.from.id);
      const user   = await queries.getUserByTelegramId(tgId);
      if (!user || user.is_blocked) return;

      const keys = await getKeys();
      const ai   = await aiOn();

      // ── RASM ────────────────────────────────────────────────
      if (msg.photo) {
        await bot.sendChatAction(chatId, 'upload_photo');
        try {
          const photo    = msg.photo[msg.photo.length - 1];
          const fileInfo = await bot.getFile(photo.file_id);
          const fileUrl  = `https://api.telegram.org/file/bot${token}/${fileInfo.file_path}`;
          const buffer   = await downloadBuffer(fileUrl);
          const mime     = getMimeType(buffer);

          // Hash duplicate
          const fp  = imageFingerprint(buffer);
          const dup = await checkDuplicate(fp);
          if (dup) {
            const t = new Date(dup.created_at)
              .toLocaleString('uz-UZ', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' });
            return bot.sendMessage(chatId,
              `⚠️ <b>Bu rasm allaqachon yuborilgan!</b>\n🕐 ${t}\n\nYangi rasm yuboring.`,
              { parse_mode:'HTML' });
          }

          // Vizual duplicate
          if (ai && (keys.gemini || keys.claude)) {
            await bot.sendChatAction(chatId, 'typing');
            try {
              const vDup = await checkVisualDuplicate(keys, buffer, user.id);
              if (vDup) return bot.sendMessage(chatId,
                `⚠️ <b>Bu sahna allaqachon yuborilgan!</b>\n\nBoshqa joydan yangi rasm yuboring.`,
                { parse_mode:'HTML' });
            } catch (e) { console.error('[VISUAL]', e.message); }
          }

          // Saqlash
          const uploadDir = path.join(__dirname, 'uploads', 'photos');
          if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
          const filename = `${Date.now()}-${user.id}-bot.jpg`;
          const filePath = path.join(uploadDir, filename);
          fs.writeFileSync(filePath, buffer);
          await queries.addLog(user.id, 'photo', `/uploads/photos/${filename}`,
            msg.caption||null, fp.exactHash, fp.perceptualKey||fp.exactHash);

          // AI tahlil
          let aiText = '';
          if (ai && (keys.gemini || keys.claude)) {
            try {
              await bot.sendChatAction(chatId, 'typing');
              const sysPrompt = await queries.getSetting('ai_system_prompt') || '';
              aiText = await aiImage(keys, sysPrompt, buffer, mime, msg.caption||null) || '';
            } catch (e) { console.error('[AI img]', e.message); }
          }

          const time = new Date(Date.now()+5*3600000).toISOString().replace('T',' ').slice(0,16);
          await bot.sendMessage(chatId,
            `✅ <b>Rasm qabul qilindi!</b>\n🕐 ${time}` +
            (aiText ? `\n\n🤖 ${aiText}` : ''),
            { parse_mode:'HTML' });

          // Kanal
          const chId = await queries.getSetting('channel_id');
          if (chId) {
            const cap = `📸 <b>${user.first_name} ${user.last_name}</b>\n🕐 ${time}` +
              (msg.caption ? `\n📝 ${msg.caption}` : '') +
              (aiText ? `\n\n🤖 <i>${aiText}</i>` : '');
            bot.sendPhoto(chId, filePath, { caption:cap, parse_mode:'HTML' }).catch(()=>{});
          }
        } catch (err) {
          console.error('[BOT rasm]', err.message);
          bot.sendMessage(chatId, '⚠️ Xato. Qayta yuboring.').catch(()=>{});
        }
        return;
      }

      // ── MATN ────────────────────────────────────────────────
      if (!ai || !hasKey(keys)) {
        // AI yo'q bo'lsa ham sabab qabul qilamiz
        if (msg.text && user.role === 'worker') {
          const absence = await queries.getAbsenceToday(user.id);
          if (absence && absence.status === 'asked' && !absence.reason) {
            await queries.saveReason(user.id, msg.text.slice(0, 300));
            // Adminlarga yetkazish
            const { notifyAdminsAboutAbsent } = require('./agent');
            await notifyAdminsAboutAbsent();
            return bot.sendMessage(chatId,
              `✅ Sababingiz qabul qilindi.\nAdmin ko'rib chiqadi.`,
              { parse_mode:'HTML' });
          }
        }
        return;
      }
      try {
        await bot.sendChatAction(chatId, 'typing');

        // Xodim sabab yozayaptimi?
        if (user.role === 'worker') {
          const absence = await queries.getAbsenceToday(user.id);
          if (absence && absence.status === 'asked' && !absence.reason) {
            await queries.saveReason(user.id, msg.text.slice(0, 300));
            const { notifyAdminsAboutAbsent } = require('./agent');
            await notifyAdminsAboutAbsent();
            return bot.sendMessage(chatId,
              `✅ Sababingiz qabul qilindi: "<i>${msg.text.slice(0,100)}</i>"\nAdmin ko'rib chiqadi.`,
              { parse_mode:'HTML' });
          }
        }
        addHistory(chatId, 'user', msg.text);
        const sysPrompt = await queries.getSetting('ai_system_prompt') || '';
        const reply = await aiChat(keys, sysPrompt, getHistory(chatId));
        addHistory(chatId, 'assistant', reply);
        bot.sendMessage(chatId, reply).catch(async () => bot.sendMessage(chatId, reply));
      } catch (err) {
        console.error('[AI chat]', err.message);
        bot.sendMessage(chatId,
          err.message.includes('Barcha') ? '⚠️ AI hozir ishlamaydi.' :
          err.message.includes('429') ? '⏳ Limit oshdi. Kuting.' : '⚠️ Xato.'
        ).catch(()=>{});
      }
    });

    bot.on('polling_error', err => console.error('Bot xatosi:', err.message));

    // ── Inline tugma callback (bloklash / o'tkazish) ──────────
    bot.on('callback_query', async (cq) => {
      const data    = cq.data || '';
      const adminId = String(cq.from.id);
      const admin   = await queries.getUserByTelegramId(adminId);

      if (!admin || !['owner','superadmin','admin'].includes(admin.role)) {
        return bot.answerCallbackQuery(cq.id, { text: '❌ Ruxsat yo\'q' });
      }

      // block_<userId>
      if (data.startsWith('block_')) {
        const userId = parseInt(data.split('_')[1]);
        const worker = await queries.getUserById(userId);
        if (!worker) return bot.answerCallbackQuery(cq.id, { text: '❌ Xodim topilmadi' });

        await queries.blockUser(userId, true);
        await queries.updateAbsenceStatus(userId, 'blocked');

        // Xodimga xabar
        if (worker.telegram_id) {
          botRef.sendMessage(worker.telegram_id,
            `🚫 <b>Hisobingiz bloklandi.</b>\nSabab: Ko'p kun kelmadingiz.\nAdmin bilan bog'laning.`,
            { parse_mode:'HTML' }).catch(()=>{});
        }

        // Tugmani yangilash
        bot.editMessageText(
          `${cq.message?.text || ''}\n\n✅ <b>${admin.first_name} tomonidan bloklandi</b>`,
          { chat_id: cq.message.chat.id, message_id: cq.message.message_id, parse_mode:'HTML' }
        ).catch(()=>{});

        bot.answerCallbackQuery(cq.id, { text: `✅ ${worker.first_name} bloklandi` });
        console.log(`[AGENT] ${worker.first_name} bloklandi (admin: ${admin.first_name})`);
      }

      // skip_<userId>
      else if (data.startsWith('skip_')) {
        const userId = parseInt(data.split('_')[1]);
        const worker = await queries.getUserById(userId);
        await queries.updateAbsenceStatus(userId, 'skipped');

        bot.editMessageText(
          `${cq.message?.text || ''}\n\n✅ <b>${admin.first_name} o'tkazib yubordi</b>`,
          { chat_id: cq.message.chat.id, message_id: cq.message.message_id, parse_mode:'HTML' }
        ).catch(()=>{});

        bot.answerCallbackQuery(cq.id, { text: '✅ O\'tkazib yuborildi' });
      }

      else {
        bot.answerCallbackQuery(cq.id);
      }
    });
    console.log('✅ Bot ishga tushdi');
    return bot;
  } catch (err) {
    console.error('Bot xatosi:', err.message);
    return null;
  }
}

function getBot() { return bot; }
module.exports = { startBot, getBot };
