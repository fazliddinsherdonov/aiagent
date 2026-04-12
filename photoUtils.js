const crypto  = require('crypto');
const https   = require('https');
const http    = require('http');
const fs      = require('fs');
const path    = require('path');
const { queries } = require('./database');

// ═══════════════════════ JPEG Fingerprint ════════════════════
function jpegFingerprint(buffer) {
  const exactHash = crypto.createHash('sha256').update(buffer).digest('hex');
  if (buffer.length < 4 || buffer[0] !== 0xFF || buffer[1] !== 0xD8)
    return { exactHash, perceptualKey: null, format: 'other' };

  let width = 0, height = 0, scanDataOffset = -1, scanDataLength = 0;
  const qtChunks = [];
  let i = 2;
  while (i < buffer.length - 3) {
    if (buffer[i] !== 0xFF) { i++; continue; }
    const m = buffer[i + 1];
    if (m === 0xDA) {
      if (i + 3 < buffer.length) {
        const h = (buffer[i+2]<<8)|buffer[i+3];
        scanDataOffset = i + 2 + h;
        scanDataLength = buffer.length - 2 - scanDataOffset;
      }
      break;
    }
    if (m === 0xD9) break;
    if (m === 0x00 || (m >= 0xD0 && m <= 0xD9)) { i+=2; continue; }
    if (i+3 >= buffer.length) break;
    const segLen = (buffer[i+2]<<8)|buffer[i+3];
    if (segLen < 2) { i+=2; continue; }
    const segEnd = i+2+segLen;
    if (segEnd > buffer.length) break;
    if (m === 0xDB && segLen >= 3) qtChunks.push(buffer.slice(i+4, segEnd));
    if (m >= 0xC0 && m <= 0xC3 && segLen >= 9) {
      height = (buffer[i+5]<<8)|buffer[i+6];
      width  = (buffer[i+7]<<8)|buffer[i+8];
    }
    i = segEnd;
  }
  const qtHash = qtChunks.length
    ? crypto.createHash('md5').update(Buffer.concat(qtChunks)).digest('hex') : '';
  let pixelHash = '';
  if (scanDataOffset > 0 && scanDataLength > 512) {
    const chunks = [];
    for (const frac of [0.25, 0.5, 0.75]) {
      const pos = scanDataOffset + Math.floor(scanDataLength * frac);
      const end = Math.min(pos + 2048, buffer.length - 2);
      if (end > pos + 10) chunks.push(buffer.slice(pos, end));
    }
    if (chunks.length === 3)
      pixelHash = crypto.createHash('md5').update(Buffer.concat(chunks)).digest('hex');
  }
  let perceptualKey = null;
  if (width > 0 && height > 0 && qtHash && pixelHash)
    perceptualKey = crypto.createHash('sha256').update(`${width}x${height}:${qtHash}:${pixelHash}`).digest('hex');
  else if (width > 0 && pixelHash)
    perceptualKey = crypto.createHash('sha256').update(`${width}x${height}:${pixelHash}`).digest('hex');
  return { exactHash, perceptualKey, width, height, format: 'jpeg' };
}

// ═══════════════════════ PNG Fingerprint ═════════════════════
function pngFingerprint(buffer) {
  const exactHash = crypto.createHash('sha256').update(buffer).digest('hex');
  if (buffer.length < 8 || buffer.readUInt32BE(0) !== 0x89504E47)
    return { exactHash, perceptualKey: null, format: 'other' };
  let width = 0, height = 0;
  const idatChunks = [];
  let i = 8;
  while (i < buffer.length - 12) {
    if (i + 8 > buffer.length) break;
    const len  = buffer.readUInt32BE(i);
    if (len > buffer.length) break;
    const type = buffer.slice(i+4, i+8).toString('ascii');
    if (type === 'IHDR' && len >= 8) { width = buffer.readUInt32BE(i+8); height = buffer.readUInt32BE(i+12); }
    if (type === 'IDAT') idatChunks.push({ offset: i+8, len });
    if (type === 'IEND') break;
    i += 12 + len;
  }
  if (idatChunks.length === 0) return { exactHash, perceptualKey: null, width, height, format: 'png' };
  const totalIdat = idatChunks.reduce((s,c) => s+c.len, 0);
  const sizeGroup = Math.floor(totalIdat / 500);
  const picks = [0, Math.floor(idatChunks.length/2), idatChunks.length-1];
  const samples = picks.map(idx => {
    const c = idatChunks[idx];
    return buffer.slice(c.offset, Math.min(c.offset+2048, c.offset+c.len));
  });
  const pixelHash = crypto.createHash('md5').update(Buffer.concat(samples)).digest('hex');
  const perceptualKey = crypto.createHash('sha256')
    .update(`png:${width}x${height}:${sizeGroup}:${pixelHash}`).digest('hex');
  return { exactHash, perceptualKey, width, height, format: 'png' };
}

// ═══════════════════════ Umumiy ══════════════════════════════
function imageFingerprint(buffer) {
  if (buffer.length >= 2 && buffer[0] === 0xFF && buffer[1] === 0xD8) return jpegFingerprint(buffer);
  if (buffer.length >= 4 && buffer.readUInt32BE(0) === 0x89504E47) return pngFingerprint(buffer);
  return { exactHash: crypto.createHash('sha256').update(buffer).digest('hex'), perceptualKey: null, format: 'other' };
}

function getMimeType(buffer) {
  if (buffer[0] === 0xFF && buffer[1] === 0xD8) return 'image/jpeg';
  if (buffer.readUInt32BE(0) === 0x89504E47) return 'image/png';
  return 'image/jpeg';
}

function checkDuplicate(fp) {
  const byExact = queries.checkPhotoHash(fp.exactHash);
  if (byExact) return byExact;
  if (fp.perceptualKey) {
    const byP = queries.checkPhotoSortedHash(fp.perceptualKey);
    if (byP) return byP;
  }
  return null;
}

// ═══════════════════════ Vizual duplicate (Gemini) ═══════════
async function checkVisualDuplicate(keys, newBuffer, userId) {
  if (!keys.gemini && !keys.claude) return null;
  const { aiDuplicate } = require('./aiClient');

  const recentLogs = require('./database').getDb()
    .prepare(`SELECT photo_path FROM work_logs
              WHERE user_id=? AND action='photo' AND photo_path IS NOT NULL
              ORDER BY created_at DESC LIMIT 4`)
    .all(userId);
  if (recentLogs.length === 0) return null;

  const existingBuffers = [];
  const base = path.join(__dirname);
  for (const log of recentLogs) {
    const fp2 = path.join(base, log.photo_path);
    if (!fs.existsSync(fp2)) continue;
    try { existingBuffers.push(fs.readFileSync(fp2)); } catch {}
    if (existingBuffers.length >= 3) break;
  }
  if (existingBuffers.length === 0) return null;

  const mimeType = getMimeType(newBuffer);
  const isDup = await aiDuplicate(keys, newBuffer, existingBuffers, mimeType);
  return isDup ? { visual: true } : null;
}

function downloadBuffer(url) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https') ? https : http;
    lib.get(url, res => {
      if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}`));
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    }).on('error', reject);
  });
}

module.exports = { imageFingerprint, checkDuplicate, checkVisualDuplicate, downloadBuffer, getMimeType };
