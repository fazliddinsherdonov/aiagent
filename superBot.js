// ═══════════════════════════════════════════════════════════════════
// Super Bot — Sizning asosiy botingiz
// Yangi workspace yaratish, to'lov tasdiqlash, nazorat
// ═══════════════════════════════════════════════════════════════════
const TelegramBot = require('node-telegram-bot-api');
const { queries } = require('./database');
const { verifyToken, makeSlug, startWorkspaceBot, stopWorkspaceBot } = require('./workspaceManager');

let superBot = null;

// Workspace yaratish holatlari (pending conversations)
const setupState = new Map();
// state: { step: 'token'|'name'|'done', token, botInfo, name }

function startSuperBot(token) {
  if (!token) { console.log('[SuperBot] Token yo\'q, o\'tkazildi'); return null; }
  if (superBot) { try { superBot.stopPolling(); } catch {} superBot = null; }

  superBot = new TelegramBot(token, { polling: true });

  async function isSuperAdmin(tgId) {
    const adminId = await queries.getSuperSetting('super_admin_tg_id');
    return String(tgId) === String(adminId);
  }

  // ── /start ──────────────────────────────────────────────────────
  superBot.onText(/\/start/, async msg => {
    const tgId  = String(msg.from.id);
    const isAdmin = await isSuperAdmin(tgId);

    if (isAdmin) {
      return superBot.sendMessage(msg.chat.id,
        `👑 <b>Super Admin panel</b>\n\n` +
        `/workspacelar — Barcha workspacelar\n` +
        `/stat — Umumiy statistika\n` +
        `/yangi — Yangi workspace qo'shish\n` +
        `/faollashtir &lt;id&gt; &lt;kunlar&gt; — To'lovni tasdiqlash\n` +
        `/toxtattir &lt;id&gt; — Workspace to'xtatish\n` +
        `/ochir &lt;id&gt; — Workspace o'chirish`,
        { parse_mode: 'HTML' });
    }

    // Oddiy foydalanuvchi — workspace egasi bo'lishi mumkin
    const existing = await queries.getWorkspaceByOwner(tgId);
    if (existing) {
      const status = existing.status === 'active' ? '✅ Faol' :
                     existing.status === 'pending' ? '⏳ To\'lov kutilmoqda' : '❌ To\'xtatilgan';
      return superBot.sendMessage(msg.chat.id,
        `🏢 <b>Sizning workspace:</b> ${existing.name}\n` +
        `📊 Holat: ${status}\n` +
        (existing.expires_at ? `⏰ Muddat: ${new Date(existing.expires_at).toLocaleDateString('uz-UZ')}\n` : '') +
        `\nQo'shimcha workspace uchun: /yangi_workspace`,
        { parse_mode: 'HTML' });
    }

    superBot.sendMessage(msg.chat.id,
      `👋 Salom, <b>${msg.from.first_name}</b>!\n\n` +
      `Bu tizim orqali o'z xodimlar boshqaruv botingizni yaratishingiz mumkin.\n\n` +
      `Boshlash uchun: /yangi_workspace`,
      { parse_mode: 'HTML' });
  });

  // ── /yangi_workspace — yangi workspace yaratish ─────────────────
  superBot.onText(/\/yangi_workspace/, async msg => {
    const tgId = String(msg.from.id);
    setupState.set(tgId, { step: 'token' });
    superBot.sendMessage(msg.chat.id,
      `🤖 <b>Yangi workspace yaratish</b>\n\n` +
      `<b>1-qadam:</b> @BotFather ga boring va yangi bot yarating:\n` +
      `1. @BotFather ga /newbot yozing\n` +
      `2. Bot nomini kiriting (masalan: Kamolon Osh Bot)\n` +
      `3. Username kiriting (masalan: kamolon_osh_bot)\n` +
      `4. Olingan token ni shu yerga yuboring\n\n` +
      `📌 Token ko'rinishi: <code>123456789:ABC-DEF1234...</code>`,
      { parse_mode: 'HTML' });
  });

  // ── Super admin: yangi workspace qo'shish ───────────────────────
  superBot.onText(/\/yangi/, async msg => {
    if (!await isSuperAdmin(String(msg.from.id))) return;
    const tgId = String(msg.from.id);
    setupState.set(tgId, { step: 'token', isSuperAdmin: true });
    superBot.sendMessage(msg.chat.id,
      `🤖 Yangi workspace uchun bot tokenini yuboring:`,
      { parse_mode: 'HTML' });
  });

  // ── /workspacelar — super admin ─────────────────────────────────
  superBot.onText(/\/workspacelar/, async msg => {
    if (!await isSuperAdmin(String(msg.from.id))) return;
    try {
      const wsList = await queries.getAllWorkspaceStats();
      if (!wsList.length) return superBot.sendMessage(msg.chat.id, '📭 Workspace yo\'q.');
      let text = `🏢 <b>Barcha workspacelar (${wsList.length}):</b>\n\n`;
      wsList.forEach((ws, i) => {
        const status = ws.status === 'active' ? '✅' : ws.status === 'pending' ? '⏳' : '❌';
        text += `${i+1}. ${status} <b>${ws.name}</b> (ID: ${ws.id})\n`;
        text += `   👥 ${ws.workers} xodim  📸 Bugun: ${ws.today_photos}\n`;
        if (ws.expires_at) text += `   ⏰ ${new Date(ws.expires_at).toLocaleDateString('uz-UZ')}\n`;
        text += '\n';
      });
      superBot.sendMessage(msg.chat.id, text, { parse_mode: 'HTML' });
    } catch (err) {
      superBot.sendMessage(msg.chat.id, '❌ Xato: ' + err.message);
    }
  });

  // ── /stat — super admin ─────────────────────────────────────────
  superBot.onText(/\/stat/, async msg => {
    if (!await isSuperAdmin(String(msg.from.id))) return;
    try {
      const wsList = await queries.getAllWorkspaceStats();
      const active  = wsList.filter(w => w.status === 'active').length;
      const pending = wsList.filter(w => w.status === 'pending').length;
      const totalWorkers = wsList.reduce((s,w) => s + (+w.workers||0), 0);
      const todayPhotos  = wsList.reduce((s,w) => s + (+w.today_photos||0), 0);
      superBot.sendMessage(msg.chat.id,
        `📊 <b>Umumiy statistika</b>\n\n` +
        `🏢 Workspacelar: <b>${wsList.length}</b>\n` +
        `✅ Faol: <b>${active}</b>\n` +
        `⏳ To'lov kutmoqda: <b>${pending}</b>\n\n` +
        `👥 Jami xodimlar: <b>${totalWorkers}</b>\n` +
        `📸 Bugungi rasmlar: <b>${todayPhotos}</b>`,
        { parse_mode: 'HTML' });
    } catch (err) {
      superBot.sendMessage(msg.chat.id, '❌ Xato: ' + err.message);
    }
  });

  // ── /faollashtir <id> <kunlar> ───────────────────────────────────
  superBot.onText(/\/faollashtir (.+)/, async (msg, match) => {
    if (!await isSuperAdmin(String(msg.from.id))) return;
    const parts = match[1].trim().split(/\s+/);
    const wsId  = parseInt(parts[0]);
    const days  = parseInt(parts[1]) || 30;
    try {
      const ws = await queries.getWorkspaceById(wsId);
      if (!ws) return superBot.sendMessage(msg.chat.id, '❌ Workspace topilmadi.');

      await queries.activateWorkspace(wsId, days);

      // Botni ishga tushirish (agar pending bo'lsa)
      if (ws.status !== 'active') {
        const updatedWs = await queries.getWorkspaceById(wsId);
        await startWorkspaceBot(updatedWs);
      }

      const expires = new Date(Date.now() + days*24*3600*1000).toLocaleDateString('uz-UZ');
      superBot.sendMessage(msg.chat.id,
        `✅ <b>${ws.name}</b> faollashtirildi!\n⏰ Muddat: ${expires} (${days} kun)`,
        { parse_mode: 'HTML' });

      // Workspace egasiga xabar
      if (ws.owner_telegram_id) {
        superBot.sendMessage(ws.owner_telegram_id,
          `🎉 <b>${ws.name}</b> workspace faollashtirildi!\n` +
          `⏰ Muddat: ${expires}\n\n` +
          `Xodimlaringizni qo'shishni boshlashingiz mumkin.\n` +
          (ws.app_url ? `🔗 Panel: ${ws.app_url}/ws/${ws.slug}` : ''),
          { parse_mode: 'HTML' }).catch(()=>{});
      }
    } catch (err) {
      superBot.sendMessage(msg.chat.id, '❌ Xato: ' + err.message);
    }
  });

  // ── /toxtattir <id> ──────────────────────────────────────────────
  superBot.onText(/\/toxtattir (.+)/, async (msg, match) => {
    if (!await isSuperAdmin(String(msg.from.id))) return;
    const wsId = parseInt(match[1].trim());
    try {
      const ws = await queries.getWorkspaceById(wsId);
      if (!ws) return superBot.sendMessage(msg.chat.id, '❌ Topilmadi.');
      await queries.suspendWorkspace(wsId);
      await stopWorkspaceBot(ws.bot_token);
      if (ws.owner_telegram_id) {
        superBot.sendMessage(ws.owner_telegram_id,
          `⚠️ <b>${ws.name}</b> to'xtatildi.\nTo'lovni amalga oshiring.`,
          { parse_mode:'HTML' }).catch(()=>{});
      }
      superBot.sendMessage(msg.chat.id, `✅ ${ws.name} to'xtatildi.`);
    } catch (err) {
      superBot.sendMessage(msg.chat.id, '❌ Xato: ' + err.message);
    }
  });

  // ── /ochir <id> ──────────────────────────────────────────────────
  superBot.onText(/\/ochir (.+)/, async (msg, match) => {
    if (!await isSuperAdmin(String(msg.from.id))) return;
    const wsId = parseInt(match[1].trim());
    try {
      const ws = await queries.getWorkspaceById(wsId);
      if (!ws) return superBot.sendMessage(msg.chat.id, '❌ Topilmadi.');
      await stopWorkspaceBot(ws.bot_token);
      await queries.deleteWorkspace(wsId);
      superBot.sendMessage(msg.chat.id, `🗑 ${ws.name} o'chirildi.`);
    } catch (err) {
      superBot.sendMessage(msg.chat.id, '❌ Xato: ' + err.message);
    }
  });

  // ── Xabarlar — workspace yaratish flow ──────────────────────────
  superBot.on('message', async msg => {
    if (msg.text && msg.text.startsWith('/')) return;
    if (!msg.text) return;

    const tgId = String(msg.from.id);
    const state = setupState.get(tgId);
    if (!state) return;

    // QADAM 1: Token qabul qilish
    if (state.step === 'token') {
      const token = msg.text.trim();
      if (!/^\d+:[A-Za-z0-9_-]+$/.test(token)) {
        return superBot.sendMessage(msg.chat.id,
          '❌ Token formati noto\'g\'ri.\nMisol: <code>123456789:ABC-DEF1234ghIkl-zyx57W2v1u123ew11</code>',
          { parse_mode:'HTML' });
      }

      // Token mavjudligini tekshirish
      const existing = await queries.getWorkspaceByToken(token);
      if (existing) {
        setupState.delete(tgId);
        return superBot.sendMessage(msg.chat.id, '❌ Bu token allaqachon ro\'yxatdan o\'tgan.');
      }

      superBot.sendMessage(msg.chat.id, '⏳ Token tekshirilmoqda...');
      try {
        const botInfo = await verifyToken(token);
        setupState.set(tgId, { ...state, step: 'name', token, botInfo });
        superBot.sendMessage(msg.chat.id,
          `✅ Bot topildi: <b>@${botInfo.username}</b>\n\n` +
          `<b>2-qadam:</b> Tashkilot nomini yozing:\n` +
          `(Masalan: Kamolon Osh Markazi)`,
          { parse_mode:'HTML' });
      } catch (err) {
        setupState.delete(tgId);
        superBot.sendMessage(msg.chat.id, `❌ Token noto'g'ri: ${err.message}\nQayta urinib ko'ring: /yangi_workspace`);
      }
      return;
    }

    // QADAM 2: Nom qabul qilish
    if (state.step === 'name') {
      const name = msg.text.trim();
      if (name.length < 2 || name.length > 50) {
        return superBot.sendMessage(msg.chat.id, '❌ Nom 2-50 belgi orasida bo\'lsin.');
      }

      try {
        const slug = makeSlug(name);
        const result = await queries.createWorkspace({
          name, slug,
          bot_token: state.token,
          bot_username: state.botInfo.username,
          owner_telegram_id: tgId
        });

        const wsId = result.lastInsertRowid;
        setupState.delete(tgId);

        // Owner ni users jadvaliga ham qo'shish (login uchun kerak)
        // Parol keyinroq /setpassword orqali o'rnatiladi
        await queries.createUser({
          workspace_id: wsId,
          first_name: msg.from.first_name || 'Ega',
          last_name: msg.from.last_name || '',
          telegram_id: tgId,
          username: msg.from.username || null,
          phone: null,
          password_hash: null,
          role: 'owner',
          created_by: null
        });

        // Super adminga xabar
        const adminId = await queries.getSuperSetting('super_admin_tg_id');
        if (adminId) {
          superBot.sendMessage(adminId,
            `🆕 <b>Yangi workspace so'rovi:</b>\n\n` +
            `🏢 Nom: <b>${name}</b>\n` +
            `🤖 Bot: @${state.botInfo.username}\n` +
            `👤 Egasi: <a href="tg://user?id=${tgId}">${msg.from.first_name}</a> (<code>${tgId}</code>)\n` +
            `🆔 Workspace ID: <b>${wsId}</b>\n\n` +
            `To'lovdan so'ng faollashtirish:\n` +
            `<code>/faollashtir ${wsId} 30</code>`,
            { parse_mode:'HTML',
              reply_markup: { inline_keyboard: [[
                { text:`✅ 30 kun faollashtir`, callback_data:`activate_${wsId}_30` },
                { text:`❌ Rad et`, callback_data:`reject_${wsId}` }
              ]]}
            }).catch(()=>{});
        }

        superBot.sendMessage(msg.chat.id,
          `✅ <b>So'rovingiz qabul qilindi!</b>\n\n` +
          `🏢 ${name}\n🤖 @${state.botInfo.username}\n\n` +
          `⏳ To'lovdan so'ng admin faollashtiradi.\n` +
          `Faollashtirilganda xabar keladi.`,
          { parse_mode:'HTML' });
      } catch (err) {
        setupState.delete(tgId);
        superBot.sendMessage(msg.chat.id, '❌ Xato: ' + err.message);
      }
      return;
    }
  });

  // Inline callback (super admin tugmalari)
  superBot.on('callback_query', async cq => {
    const data = cq.data || '';
    if (!await isSuperAdmin(String(cq.from.id)))
      return superBot.answerCallbackQuery(cq.id, { text:'❌ Ruxsat yo\'q' });

    if (data.startsWith('activate_')) {
      const [, wsId, days] = data.split('_');
      const ws = await queries.getWorkspaceById(parseInt(wsId));
      if (!ws) return superBot.answerCallbackQuery(cq.id, { text:'❌ Topilmadi' });

      await queries.activateWorkspace(parseInt(wsId), parseInt(days)||30);
      const updatedWs = await queries.getWorkspaceById(parseInt(wsId));
      await startWorkspaceBot(updatedWs);

      const expires = new Date(Date.now()+(parseInt(days)||30)*24*3600*1000).toLocaleDateString('uz-UZ');
      superBot.editMessageText(
        (cq.message?.text||'') + `\n\n✅ Faollashtirildi! Muddat: ${expires}`,
        { chat_id:cq.message.chat.id, message_id:cq.message.message_id, parse_mode:'HTML' }
      ).catch(()=>{});

      if (ws.owner_telegram_id) {
        superBot.sendMessage(ws.owner_telegram_id,
          `🎉 <b>${ws.name}</b> faollashtirildi!\n⏰ Muddat: ${expires}\n\nBoshlashingiz mumkin!`,
          { parse_mode:'HTML' }).catch(()=>{});
      }
      superBot.answerCallbackQuery(cq.id, { text:'✅ Faollashtirildi' });

    } else if (data.startsWith('reject_')) {
      const wsId = parseInt(data.split('_')[1]);
      const ws   = await queries.getWorkspaceById(wsId);
      if (ws && ws.owner_telegram_id) {
        superBot.sendMessage(ws.owner_telegram_id,
          `❌ So'rovingiz rad etildi. Murojaat uchun admin bilan bog'laning.`
        ).catch(()=>{});
      }
      if (ws) await queries.deleteWorkspace(wsId);
      superBot.editMessageText(
        (cq.message?.text||'') + '\n\n❌ Rad etildi',
        { chat_id:cq.message.chat.id, message_id:cq.message.message_id, parse_mode:'HTML' }
      ).catch(()=>{});
      superBot.answerCallbackQuery(cq.id, { text:'❌ Rad etildi' });
    }
  });

  // /setpassword — owner parol o'rnatadi (birinchi kirish uchun)
  superBot.onText(/\/setpassword (.+)/, async (msg, match) => {
    const tgId = String(msg.from.id);
    const newPass = match[1].trim();
    if (newPass.length < 4) {
      return superBot.sendMessage(msg.chat.id, "❌ Parol kamida 4 ta belgi bo'lsin.");
    }
    try {
      const bcrypt = require('bcryptjs');
      const ws = await queries.getWorkspaceByOwner(tgId);
      if (!ws) return superBot.sendMessage(msg.chat.id, '❌ Sizning workspace topilmadi.');
      const user = await queries.getUserByTelegramId(ws.id, tgId);
      if (!user || user.role !== 'owner') return superBot.sendMessage(msg.chat.id, '❌ Ega hisobi topilmadi.');
      const hash = await bcrypt.hash(newPass, 10);
      await queries.updatePassword(user.id, hash);
      superBot.sendMessage(msg.chat.id,
        `✅ <b>Parol o'rnatildi!</b>\n\n` +
        `Endi mini-appga kirish uchun:\n` +
        `📱 Telefon: <code>${user.phone || '+998XXXXXXXXX (qo\'shing)'}</code>\n` +
        `🔑 Parol: (az holatda saqlang)\n\n` +
        `<i>Xavfsizlik uchun bu xabarni o'chirib tashlang.</i>`,
        { parse_mode: 'HTML' });
    } catch (err) {
      superBot.sendMessage(msg.chat.id, '❌ Xato: ' + err.message);
    }
  });

  // /myprofile — owner o'z ma'lumotlarini ko'radi
  superBot.onText(/\/myprofile/, async (msg) => {
    const tgId = String(msg.from.id);
    try {
      const ws = await queries.getWorkspaceByOwner(tgId);
      if (!ws) return superBot.sendMessage(msg.chat.id, '❌ Workspace topilmadi.');
      const user = await queries.getUserByTelegramId(ws.id, tgId);
      if (!user) return superBot.sendMessage(msg.chat.id, '❌ Hisobingiz topilmadi.');
      superBot.sendMessage(msg.chat.id,
        `👑 <b>Sizning profilingiz</b>\n\n` +
        `🏢 Workspace: <b>${ws.name}</b>\n` +
        `👤 Ism: <b>${user.first_name} ${user.last_name}</b>\n` +
        `📱 Telefon: <code>${user.phone || 'Kiritilmagan'}</code>\n` +
        `🔑 Parol: ${user.password_hash ? '✅ O\'rnatilgan' : '❌ O\'rnatilmagan'}\n\n` +
        `Parol o'rnatish: /setpassword YANGIPAROL\n` +
        `Kirish sahifasi: ${ws.app_url ? ws.app_url + '/ws/' + ws.slug : 'URL sozlanmagan'}`,
        { parse_mode: 'HTML' });
    } catch (err) {
      superBot.sendMessage(msg.chat.id, '❌ Xato: ' + err.message);
    }
  });

  superBot.on('polling_error', err => console.error('[SuperBot] Xato:', err.message));
  console.log('✅ Super Bot ishga tushdi');
  return superBot;
}

function getSuperBot() { return superBot; }
module.exports = { startSuperBot, getSuperBot };
