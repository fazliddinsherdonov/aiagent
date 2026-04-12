# 🏢 Xodimlar Boshqaruvi — Telegram Mini App

Employee management system as a Telegram Mini App with Owner, Admin, and Worker roles.

## ✅ Imkoniyatlar

| Ega (Owner) | Admin | Xodim (Worker) |
|---|---|---|
| Xodimlarni ko'rish, qo'shish, tahrirlash, bloklash, o'chirish | Xodimlarni boshqarish | Profil ko'rish |
| Adminlarni boshqarish | Statistikani ko'rish | Rasm yuborish |
| Kunlik/haftalik/oylik statistika | Parolni o'zgartirish | Faoliyat tarixi |
| Bot va kanal ulash | — | Parolni o'zgartirish |
| Barcha sozlamalar | — | — |

---

## 🚀 O'rnatish

### 1. Talablar
- Node.js 18+
- npm 9+

### 2. Loyihani yuklab olish va o'rnatish

```bash
# Loyiha papkasiga kiring
cd employee-management-miniapp

# Paketlarni o'rnatish
npm install

# .env faylini yarating
cp .env.example .env
```

### 3. .env faylini sozlash

```env
PORT=3000
JWT_SECRET=your-super-secret-random-key-here
BOT_TOKEN=your-telegram-bot-token
APP_URL=https://yourdomain.com
```

### 4. Ishga tushirish

```bash
# Production
npm start

# Development (auto-restart)
npm run dev
```

---

## 🤖 Telegram Bot sozlash

### Bot yaratish:
1. Telegramda @BotFather ga yozing
2. `/newbot` buyrug'ini yuboring
3. Bot nomi va username bering
4. Olingan tokenni `.env` faylga yoki app Sozlamalarga kiriting

### Mini App sozlash:
1. @BotFather ga `/mybots` yuboring
2. Botingizni tanlang
3. **Bot Settings** → **Menu Button** → URL kiriting: `https://yourdomain.com`

### Kanal ulash (ixtiyoriy):
1. Botni kanalga admin qilib qo'shing
2. Kanal ID sini Sozlamalar bo'limiga kiriting

---

## 📱 Foydalanish

### Birinchi kirish:
- **Telefon:** (bo'sh)
- **Parol:** `owner123`
- ⚠️ **Darhol parolni o'zgartiring!**

### Foydalanuvchi qo'shish tartibi:
1. Ega yoki Admin sifatida kiring
2. "Xodimlar" bo'limiga kiring
3. "+" tugmasini bosing
4. **Ism, Familya** kiriting
5. **ID turi** tanlang: Telefon yoki Telegram ID
6. **Parol** kiriting (xodim o'zi o'zgartirishi mumkin)

### Telegram orqali kirish:
Agar Telegram ID qo'shilgan bo'lsa, Mini App ochilganda avtomatik kiradi.

---

## 🗂 Loyiha Tuzilmasi

```
project/
├── server.js           # Asosiy server
├── database.js         # SQLite bazasi
├── bot.js              # Telegram bot
├── middleware/
│   └── auth.js         # JWT autentifikatsiya
├── routes/
│   ├── auth.js         # Login/parol marshrutlari
│   ├── owner.js        # Ega marshrutlari
│   ├── admin.js        # Admin marshrutlari
│   └── worker.js       # Xodim marshrutlari
├── public/
│   ├── index.html      # SPA asosiy sahifa
│   ├── style.css       # Dizayn
│   └── app.js          # Frontend mantiq
├── uploads/            # Yuklangan fayllar
├── data.db             # SQLite bazasi (avtomatik yaratiladi)
├── .env.example
└── package.json
```

---

## 🌐 Serverga yuklash (Ubuntu/Debian)

```bash
# Node.js o'rnatish
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# PM2 o'rnatish (jarayon menejeri)
sudo npm install -g pm2

# Loyihani serverga ko'chirish
scp -r ./project user@yourserver.com:/var/www/miniapp

# Serverda
cd /var/www/miniapp
npm install --production
cp .env.example .env
nano .env  # Sozlamalarni kiriting

# PM2 bilan ishga tushirish
pm2 start server.js --name "miniapp"
pm2 save
pm2 startup

# Nginx sozlash
sudo apt install nginx
sudo nano /etc/nginx/sites-available/miniapp
```

**Nginx config:**
```nginx
server {
    listen 80;
    server_name yourdomain.com;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
        client_max_body_size 20M;
    }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/miniapp /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl restart nginx

# SSL (HTTPS) — Telegram uchun ZARUR
sudo apt install certbot python3-certbot-nginx
sudo certbot --nginx -d yourdomain.com
```

---

## 🔐 Xavfsizlik

- JWT tokenlar 30 kunlik
- Parollar bcrypt bilan shifrlangan (10 rounds)
- SQL injection himoyasi (parametrli so'rovlar)
- Fayl yuklash cheklangan (5MB avatar, 10MB foto)
- Faqat rasm fayllari qabul qilinadi

---

## 📞 API Endpointlar

| Method | URL | Tavsif |
|---|---|---|
| POST | /api/auth/login | Kirish |
| POST | /api/auth/telegram | Telegram auth |
| POST | /api/auth/change-password | Parol o'zgartirish |
| GET | /api/auth/me | Joriy foydalanuvchi |
| GET | /api/owner/workers | Xodimlar ro'yxati |
| POST | /api/owner/workers | Xodim qo'shish |
| PUT | /api/owner/workers/:id | Xodimni tahrirlash |
| PATCH | /api/owner/workers/:id/block | Bloklash/ochish |
| DELETE | /api/owner/workers/:id | O'chirish |
| GET | /api/owner/admins | Adminlar ro'yxati |
| POST | /api/owner/admins | Admin qo'shish |
| GET | /api/owner/settings | Sozlamalar |
| PUT | /api/owner/settings | Sozlamalarni saqlash |
| POST | /api/worker/photo | Rasm yuborish |

---

*Ishlab chiqilgan: 2024 · Node.js + SQLite + Telegram Mini App*
