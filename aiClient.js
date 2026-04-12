// ═══════════════════════════════════════════════════════════════════
// AI Client — Multi-provider fallback
// Tartibi: Gemini → Groq → Claude Haiku
// Biri ishlamasa avtomatik keyingisiga o'tadi
// ═══════════════════════════════════════════════════════════════════
const https = require('https');

// ── HTTP so'rov yordamchi ────────────────────────────────────────
function httpRequest(options, body) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          resolve({ json, status: res.statusCode });
        } catch (e) {
          reject(new Error('Parse xatosi: ' + data.slice(0, 200)));
        }
      });
    });
    req.on('error', reject);
    req.setTimeout(20000, () => { req.destroy(); reject(new Error('Timeout')); });
    if (body) req.write(body);
    req.end();
  });
}

// ══════════════════════════════════════════════════════════════════
// GEMINI (Google) — gemini-2.0-flash
// Bepul: 1500 req/kun, 1M token/oy
// ══════════════════════════════════════════════════════════════════
async function geminiChat(apiKey, systemPrompt, messages) {
  const contents = messages.map(m => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content }]
  }));
  const body = JSON.stringify({
    system_instruction: { parts: [{ text: systemPrompt || defaultSystem() }] },
    contents,
    generationConfig: { maxOutputTokens: 1024, temperature: 0.7 }
  });
  const { json, status } = await httpRequest({
    hostname: 'generativelanguage.googleapis.com',
    path: `/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
  }, body);
  if (status === 429) throw new Error('RATE_LIMIT');
  if (json.error) throw new Error(json.error.message || 'Gemini xatosi');
  return json.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';
}

async function geminiImage(apiKey, systemPrompt, imageBuffer, mimeType, caption) {
  const base64 = imageBuffer.toString('base64');
  const body = JSON.stringify({
    system_instruction: { parts: [{ text: systemPrompt || imageSystem() }] },
    contents: [{ role: 'user', parts: [
      { inline_data: { mime_type: mimeType || 'image/jpeg', data: base64 } },
      { text: caption ? `Izoh: ${caption}\nTahlil qil.` : 'Bu ish rasmini tahlil qil.' }
    ]}],
    generationConfig: { maxOutputTokens: 400, temperature: 0.4 }
  });
  const { json, status } = await httpRequest({
    hostname: 'generativelanguage.googleapis.com',
    path: `/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
  }, body);
  if (status === 429) throw new Error('RATE_LIMIT');
  if (json.error) throw new Error(json.error.message || 'Gemini xatosi');
  return json.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';
}

async function geminiDuplicate(apiKey, newBuffer, existingBuffers, mimeType) {
  const parts = [
    { text: `${existingBuffers.length + 1} ta rasm bor. Birinchisi YANGI. Qolganlari ESKI.\nFAQAT "HA" yoki "YOQ": Yangi rasm eskilardan biri bilan BIR XIL SAHNA/JOYmi?` },
    { inline_data: { mime_type: mimeType, data: newBuffer.toString('base64') } },
    ...existingBuffers.map(b => ({ inline_data: { mime_type: mimeType, data: b.toString('base64') } }))
  ];
  const body = JSON.stringify({
    contents: [{ role: 'user', parts }],
    generationConfig: { maxOutputTokens: 5, temperature: 0 }
  });
  const { json, status } = await httpRequest({
    hostname: 'generativelanguage.googleapis.com',
    path: `/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
  }, body);
  if (status === 429) throw new Error('RATE_LIMIT');
  if (json.error) throw new Error(json.error.message || 'Gemini xatosi');
  const ans = json.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';
  return ans.toUpperCase().includes('HA');
}

// ══════════════════════════════════════════════════════════════════
// GROQ — llama-3.3-70b-versatile
// Bepul: 14400 req/kun, 500K token/daqiqa
// Rasm tahlili YO'Q (text only)
// ══════════════════════════════════════════════════════════════════
async function groqChat(apiKey, systemPrompt, messages) {
  const body = JSON.stringify({
    model: 'llama-3.3-70b-versatile',
    max_tokens: 1024,
    messages: [
      { role: 'system', content: systemPrompt || defaultSystem() },
      ...messages
    ]
  });
  const { json, status } = await httpRequest({
    hostname: 'api.groq.com',
    path: '/openai/v1/chat/completions',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
      'Content-Length': Buffer.byteLength(body)
    }
  }, body);
  if (status === 429) throw new Error('RATE_LIMIT');
  if (json.error) throw new Error(json.error.message || 'Groq xatosi');
  return json.choices?.[0]?.message?.content?.trim() || '';
}

// ══════════════════════════════════════════════════════════════════
// CLAUDE (Anthropic) — claude-haiku-4-5
// Pullik, lekin arzon: $0.80/1M input token
// Rasm tahlili bor
// ══════════════════════════════════════════════════════════════════
async function claudeChat(apiKey, systemPrompt, messages) {
  const body = JSON.stringify({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 1024,
    system: systemPrompt || defaultSystem(),
    messages
  });
  const { json, status } = await httpRequest({
    hostname: 'api.anthropic.com',
    path: '/v1/messages',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'Content-Length': Buffer.byteLength(body)
    }
  }, body);
  if (status === 429) throw new Error('RATE_LIMIT');
  if (json.error) throw new Error(json.error.message || 'Claude xatosi');
  return json.content?.[0]?.text?.trim() || '';
}

async function claudeImage(apiKey, systemPrompt, imageBuffer, mimeType, caption) {
  const base64 = imageBuffer.toString('base64');
  const body = JSON.stringify({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 400,
    system: systemPrompt || imageSystem(),
    messages: [{ role: 'user', content: [
      { type: 'image', source: { type: 'base64', media_type: mimeType || 'image/jpeg', data: base64 } },
      { type: 'text', text: caption ? `Izoh: ${caption}\nTahlil qil.` : 'Tahlil qil.' }
    ]}]
  });
  const { json, status } = await httpRequest({
    hostname: 'api.anthropic.com',
    path: '/v1/messages',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'Content-Length': Buffer.byteLength(body)
    }
  }, body);
  if (status === 429) throw new Error('RATE_LIMIT');
  if (json.error) throw new Error(json.error.message || 'Claude xatosi');
  return json.content?.[0]?.text?.trim() || '';
}

async function claudeDuplicate(apiKey, newBuffer, existingBuffers, mimeType) {
  const content = [
    { type: 'text', text: `${existingBuffers.length + 1} ta rasm. Birinchisi YANGI. Qolganlari ESKI.\nFAQAT "HA" yoki "YOQ": Yangi rasm eskilardan biri bilan BIR XIL SAHNA/JOYmi?` },
    { type: 'image', source: { type: 'base64', media_type: mimeType, data: newBuffer.toString('base64') } },
    ...existingBuffers.map(b => ({ type: 'image', source: { type: 'base64', media_type: mimeType, data: b.toString('base64') } }))
  ];
  const body = JSON.stringify({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 5,
    system: 'Faqat "HA" yoki "YOQ" de.',
    messages: [{ role: 'user', content }]
  });
  const { json, status } = await httpRequest({
    hostname: 'api.anthropic.com',
    path: '/v1/messages',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'Content-Length': Buffer.byteLength(body)
    }
  }, body);
  if (status === 429) throw new Error('RATE_LIMIT');
  if (json.error) throw new Error(json.error.message || 'Claude xatosi');
  const ans = json.content?.[0]?.text?.trim() || '';
  return ans.toUpperCase().includes('HA');
}

// ══════════════════════════════════════════════════════════════════
// MULTI-PROVIDER FALLBACK
// Gemini → Groq → Claude — biri ishlamasa keyingisi
// ══════════════════════════════════════════════════════════════════
function getProviders(keys) {
  const list = [];
  if (keys.gemini) list.push({ name: 'Gemini', key: keys.gemini });
  if (keys.groq)   list.push({ name: 'Groq',   key: keys.groq });
  if (keys.claude) list.push({ name: 'Claude', key: keys.claude });
  return list;
}

async function aiChat(keys, systemPrompt, messages) {
  const providers = getProviders(keys);
  for (const p of providers) {
    try {
      let result;
      if (p.name === 'Gemini') result = await geminiChat(p.key, systemPrompt, messages);
      else if (p.name === 'Groq') result = await groqChat(p.key, systemPrompt, messages);
      else result = await claudeChat(p.key, systemPrompt, messages);
      console.log(`[AI] ${p.name} javob berdi`);
      return result;
    } catch (err) {
      console.warn(`[AI] ${p.name} xato (${err.message}), keyingisi...`);
    }
  }
  throw new Error('Barcha AI provayderlar ishlamadi');
}

async function aiImage(keys, systemPrompt, imageBuffer, mimeType, caption) {
  // Rasm tahlili: Gemini → Claude (Groq rasm ko'rmaydi)
  const imageProviders = [];
  if (keys.gemini) imageProviders.push({ name: 'Gemini', key: keys.gemini });
  if (keys.claude) imageProviders.push({ name: 'Claude', key: keys.claude });

  for (const p of imageProviders) {
    try {
      let result;
      if (p.name === 'Gemini') result = await geminiImage(p.key, systemPrompt, imageBuffer, mimeType, caption);
      else result = await claudeImage(p.key, systemPrompt, imageBuffer, mimeType, caption);
      console.log(`[AI] ${p.name} rasm tahlil qildi`);
      return result;
    } catch (err) {
      console.warn(`[AI] ${p.name} rasm xato (${err.message}), keyingisi...`);
    }
  }
  return null; // Rasm tahlil muvaffaqiyatsiz — asosiy jarayon to'xtatilmaydi
}

async function aiDuplicate(keys, newBuffer, existingBuffers, mimeType) {
  const imageProviders = [];
  if (keys.gemini) imageProviders.push({ name: 'Gemini', key: keys.gemini });
  if (keys.claude) imageProviders.push({ name: 'Claude', key: keys.claude });

  for (const p of imageProviders) {
    try {
      let result;
      if (p.name === 'Gemini') result = await geminiDuplicate(p.key, newBuffer, existingBuffers, mimeType);
      else result = await claudeDuplicate(p.key, newBuffer, existingBuffers, mimeType);
      console.log(`[VISUAL] ${p.name}: ${result ? 'DUPLICATE' : 'yangi'}`);
      return result;
    } catch (err) {
      console.warn(`[VISUAL] ${p.name} xato (${err.message}), keyingisi...`);
    }
  }
  return false; // Tekshirib bo'lmasa — o'tkazib yuborish
}

// Default system promptlar
function defaultSystem() {
  return 'Siz xodimlar boshqaruvi tizimining yordamchi assistantsiz. ' +
         'O\'zbek tilida qisqa va aniq javob bering. ' +
         'Ish, qoidalar, jadval, vazifalar haqidagi savollarga javob bering.';
}
function imageSystem() {
  return 'Siz xodimlar nazorat tizimining AI yordamchisisiz. ' +
         'Yuborilgan ish rasmini O\'zbek tilida 1-2 jumlada tahlil qiling: ' +
         'nima ko\'rinyapti, qaysi joy, qanday faoliyat.';
}

module.exports = { aiChat, aiImage, aiDuplicate };
