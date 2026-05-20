# دليل النشر على Hostinger VPS

هذا الدليل يشرح كيفية رفع وتشغيل المشروع على سيرفر Hostinger VPS بنظام Ubuntu.

## 1. التجهيز الأولي (على السيرفر)

ادخل للسيرفر عبر SSH:
```bash
ssh root@YOUR_SERVER_IP
```

### تحديث النظام وتثبيت البرمجيات الأساسية
```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y curl git nginx
```

### تثبيت Node.js (v18+)
```bash
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt install -y nodejs
```

### تثبيت PM2 لإدارة التطبيق
```bash
sudo npm install -g pm2
```

### إعداد قاعدة البيانات (MySQL)
إذا كنت تستخدم MySQL محلياً على السيرفر:
```bash
sudo apt install -y mysql-server
sudo mysql_secure_installation
```
ادخل لـ MySQL وانشئ القاعدة:
```sql
CREATE DATABASE salla_smartbus_db;
CREATE USER 'salla_user'@'localhost' IDENTIFIED BY 'StrongPassword123!';
GRANT ALL PRIVILEGES ON salla_smartbus_db.* TO 'salla_user'@'localhost';
FLUSH PRIVILEGES;
EXIT;
```

---

## 2. رفع المشروع

يمكنك رفع المشروع باستخدام `git` (مفضل) أو `scp`. لنفترض أننا سنضعه في `/var/www/mobher-ai`.

```bash
mkdir -p /var/www/mobher-ai
cd /var/www/mobher-ai
# (قم برفع الملفات هنا أو عمل git clone)
```

### تثبيت المكتبات
```bash
npm install --production
```

### إعداد ملف البيئة .env
قم بإنشاء الملف:
```bash
nano .env
```
الصق محتوياته (تأكد من تعديل البيانات):
```env
PORT=3000
NODE_ENV=production
DATABASE_SERVER=localhost
DATABASE_NAME=salla_smartbus_db
DATABASE_USERNAME=salla_user
DATABASE_PASSWORD=StrongPassword123!
SALLA_OAUTH_CLIENT_ID=...
SALLA_OAUTH_CLIENT_SECRET=...
SALLA_OAUTH_CLIENT_REDIRECT_URI=https://your-domain.com/oauth/callback
SALLA_WEBHOOK_SECRET=...
OPENAI_API_KEY=...
META_VERIFY_TOKEN=...
```

---

## 3. التشغيل باستخدام PM2

تأكد من وجود ملف `ecosystem.config.js` في المشروع، ثم نفذ:

```bash
pm2 start ecosystem.config.js
pm2 save
pm2 startup
```

(انسخ الأمر الذي يظهر لك ونفذه لتثبيت التشغيل التلقائي عند إعادة التشغيل).

---

## 4. إعداد Nginx و Domain (SSL)

حرر ملف إعدادات Nginx:
```bash
sudo nano /etc/nginx/sites-available/mobher-ai
```

أضف المحتوى التالي:
```nginx
server {
    server_name your-domain.com;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
```

فعّل الموقع:
```bash
sudo ln -s /etc/nginx/sites-available/mobher-ai /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl restart nginx
```

### تفعيل HTTPS (SSL)
استخدم Certbot:
```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d your-domain.com
```

---

## 5. الروابط النهائية (للاستخدام في Salla و Meta)

بعد الانتهاء، ستكون الروابط كالتالي:

1. **Callback URL (Salla)**:
   `https://your-domain.com/oauth/callback`

2. **Webhook URL (Salla)**:
   `https://your-domain.com/webhook`
   *(الأحداث: basket.abandoned, app.installed, app.store.authorize)*

3. **Webhook URL (Meta)**:
   `https://your-domain.com/webhook/meta`
   *(Events: messages)*
   *(Verify Token: نفس الذي وضعته في .env)*

---

## أوامر مفيدة

- **عرض الحالة**: `pm2 status`
- **عرض السجلات**: `pm2 logs mobher-ai-whatsapp`
- **إعادة التشغيل**: `pm2 restart mobher-ai-whatsapp`
