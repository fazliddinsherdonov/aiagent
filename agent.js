const cron   = require('node-cron');
const { queries } = require('./database');
const { aiChat }  = require('./aiClient');
const { getActiveBots } = require('./workspaceManager');

// ── Workspace hisoboti ────────────────────────────────────────────
async function sendWorkspaceReport(ws, bot) {
  try {
    const stats   = await queries.getTodayWorkerStats(ws.id);
    const sent    = stats.filter(w => +w.photo_count > 0);
    const notSent = stats.filter(w => +w.photo_count === 0);
    const total   = stats.length;
    const today   = new Date().toLocaleDateString('uz-UZ', { day:'2-digit', month:'2-digit', year:'numeric' });

    let aiSummary = '';
    if (ws.ai_enabled !== '0') {
      const keys = { gemini:ws.gemini_api_key||'', groq:ws.groq_api_key||'', claude:ws.claude_api_key||'' };
      if (keys.gemini || keys.groq || keys.claude) {
        try {
          aiSummary = await aiChat(keys, '',
            [{ role:'user', content:`Bugun ${total}dan ${sent.length} rasm yubordi (${Math.round(sent.length/total*100||0)}%). Qisqacha xulosa ber.` }]);
        } catch {}
      }
    }

    let msg = `📊 <b>${ws.name} — Kunlik Hisobot</b>\n📅 ${today}\n${'─'.repeat(26)}\n\n`;
    msg += `👥 Jami: <b>${total}</b>  ✅ Yubordi: <b>${sent.length}</b>  ❌ Yubormadi: <b>${notSent.length}</b>\n`;
    msg += `📈 <b>${Math.round(sent.length/total*100||0)}%</b> faollik\n\n`;
    if (sent.length)   { msg += `✅ <b>Yubordilar:</b>\n`; sent.slice(0,15).forEach(w => { msg += `  • ${w.first_name} ${w.last_name} — ${w.photo_count}📸\n`; }); if (sent.length>15) msg += `  ...va yana ${sent.length-15}\n`; msg+='\n'; }
    if (notSent.length){ msg += `❌ <b>Yubormaganlar:</b>\n`; notSent.slice(0,15).forEach(w => { msg += `  • ${w.first_name} ${w.last_name}\n`; }); if (notSent.length>15) msg += `  ...va yana ${notSent.length-15}\n`; msg+='\n'; }
    if (aiSummary) msg += `🤖 <i>${aiSummary}</i>`;

    const admins = await queries.getAllAdmins(ws.id);
    for (const a of admins) {
      if (a.telegram_id) bot.sendMessage(a.telegram_id, msg, { parse_mode:'HTML' }).catch(()=>{});
    }
    if (ws.channel_id) bot.sendMessage(ws.channel_id, msg, { parse_mode:'HTML' }).catch(()=>{});
  } catch (err) { console.error(`[AGENT ${ws.name}] Hisobot:`, err.message); }
}

// ── Workspace eslatma ─────────────────────────────────────────────
async function sendWorkspaceReminders(ws, bot) {
  if (ws.reminder_enabled === '0') return;
  try {
    const missing = await queries.getMissingWorkersToday(ws.id);
    for (const w of missing) {
      if (!w.telegram_id) continue;
      const kb = ws.app_url ? {
        reply_markup: { inline_keyboard: [[{ text:'📸 Rasm yuborish', web_app:{ url:`${ws.app_url}/ws/${ws.slug}` } }]] }
      } : {};
      bot.sendMessage(w.telegram_id, `⏰ <b>Eslatma!</b> Bugun rasm yubormagansiz.`, { parse_mode:'HTML', ...kb }).catch(()=>{});
    }
  } catch (err) { console.error(`[AGENT ${ws.name}] Eslatma:`, err.message); }
}

// ── Workspace yo'qlik tekshiruvi ──────────────────────────────────
async function checkWorkspaceAbsent(ws, bot) {
  try {
    const missing = await queries.getMissingWorkersToday(ws.id);
    for (const w of missing) {
      if (!w.telegram_id || w.reason_asked) continue;
      await queries.upsertAbsence(ws.id, w.id, { reason_asked:1, status:'asked' });
      bot.sendMessage(w.telegram_id,
        `❓ <b>Bugun rasm yubormagansiz.</b>\n\nKelmagan sababingizni yozing.`,
        { parse_mode:'HTML' }).catch(()=>{});
    }

    // 3 kun kelmaganlarni adminga bildir
    for (const w of missing) {
      if (w.admin_notified) continue;
      const consec = await queries.getConsecutiveMissing(ws.id, w.id);
      const days   = +consec?.days || 1;
      const admins = await queries.getAllAdmins(ws.id);
      const reasonText = w.reason ? `📝 "<i>${w.reason}</i>"` : `📝 Javob bermadi`;
      let msgText = `⚠️ <b>${w.first_name} ${w.last_name}</b> ${days} kun kelmadi\n${reasonText}`;

      if (days >= 3) {
        msgText = `🚨 <b>${w.first_name} ${w.last_name}</b> ${days} kun ketma-ket kelmadi!\n${reasonText}\n\n<b>Bloklash kerakmi?</b>`;
        for (const a of admins) {
          if (!a.telegram_id) continue;
          bot.sendMessage(a.telegram_id, msgText, {
            parse_mode:'HTML',
            reply_markup: { inline_keyboard: [[
              { text:'🔴 Bloklash', callback_data:`block_${w.id}` },
              { text:'✅ O\'tkazib yuborish', callback_data:`skip_${w.id}` }
            ]]}
          }).catch(()=>{});
        }
      } else {
        for (const a of admins) {
          if (a.telegram_id) bot.sendMessage(a.telegram_id, msgText, { parse_mode:'HTML' }).catch(()=>{});
        }
      }
      await queries.upsertAbsence(ws.id, w.id, { ...w, admin_notified:1, days_missed:days, status: days>=3?'block_requested':'notified' });
    }
  } catch (err) { console.error(`[AGENT ${ws.name}] Absent:`, err.message); }
}

// ── Barcha workspacelar uchun cron ───────────────────────────────
function startAgent() {
  // Kechqurun 17:00 — sabab so'rash
  cron.schedule('0 17 * * 1-6', async () => {
    const workspaces = await queries.getActiveWorkspaces();
    for (const ws of workspaces) {
      const bot = require('./workspaceManager').getActiveBot(ws.bot_token);
      if (bot) await checkWorkspaceAbsent(ws, bot);
    }
  }, { timezone:'Asia/Tashkent' });

  // Kechqurun 20:00 — kunlik hisobot
  cron.schedule('0 20 * * *', async () => {
    const workspaces = await queries.getActiveWorkspaces();
    for (const ws of workspaces) {
      if (ws.daily_report_enabled === '0') continue;
      const bot = require('./workspaceManager').getActiveBot(ws.bot_token);
      if (bot) await sendWorkspaceReport(ws, bot);
    }
  }, { timezone:'Asia/Tashkent' });

  // Ertalab 9:00 — eslatma
  cron.schedule('0 9 * * 1-6', async () => {
    const workspaces = await queries.getActiveWorkspaces();
    for (const ws of workspaces) {
      if (ws.reminder_enabled === '0') continue;
      const bot = require('./workspaceManager').getActiveBot(ws.bot_token);
      if (bot) await sendWorkspaceReminders(ws, bot);
    }
  }, { timezone:'Asia/Tashkent' });

  // Muddat tugashini tekshirish (har kuni 10:00)
  cron.schedule('0 10 * * *', async () => {
    const workspaces = await queries.getAllWorkspaces();
    const { getSuperBot } = require('./superBot');
    const sBot = getSuperBot();
    const adminId = await queries.getSuperSetting('super_admin_tg_id');

    for (const ws of workspaces) {
      if (ws.status !== 'active' || !ws.expires_at) continue;
      const daysLeft = Math.ceil((new Date(ws.expires_at) - Date.now()) / (24*3600*1000));

      if (daysLeft <= 0) {
        await queries.suspendWorkspace(ws.id);
        const { stopWorkspaceBot } = require('./workspaceManager');
        await stopWorkspaceBot(ws.bot_token);
        if (ws.owner_telegram_id && sBot) {
          sBot.sendMessage(ws.owner_telegram_id,
            `⚠️ <b>${ws.name}</b> muddati tugadi.\nDavom etish uchun to'lov qiling.`,
            { parse_mode:'HTML' }).catch(()=>{});
        }
        if (adminId && sBot) {
          sBot.sendMessage(adminId, `⏰ <b>${ws.name}</b> muddati tugadi va to'xtatildi.`, { parse_mode:'HTML' }).catch(()=>{});
        }
      } else if (daysLeft === 3) {
        if (ws.owner_telegram_id && sBot) {
          sBot.sendMessage(ws.owner_telegram_id,
            `⚠️ <b>${ws.name}</b> muddati <b>3 kun</b> ichida tugaydi!\nTo'lovni amalga oshiring.`,
            { parse_mode:'HTML' }).catch(()=>{});
        }
        if (adminId && sBot) {
          sBot.sendMessage(adminId,
            `⚠️ <b>${ws.name}</b> — ${daysLeft} kun qoldi.\n` +
            `Uzaytirish: <code>/faollashtir ${ws.id} 30</code>`,
            { parse_mode:'HTML' }).catch(()=>{});
        }
      }
    }
  }, { timezone:'Asia/Tashkent' });

  console.log('✅ Agent (multi-tenant) ishga tushdi');
}

module.exports = { startAgent, sendWorkspaceReport, sendWorkspaceReminders };
