# 🚀 دليل نشر تطبيق "مبهر AI" على سيرفر VPS (Hostinger / DigitalOcean)

هذا الدليل يشرح خطوة بخطوة كيفية رفع مشروع Node.js وتشغيله على سيرفر Linux (Ubuntu 22.04/24.04).

---

## 🏗️ 1. تجهيز السيرفر (Initial Server Setup)

ادخل على السيرفر باستخدام SSH:
```bash
ssh root@your_server_ip
```

حدث النظام وثبت الأدوات الأساسية:
```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y curl git unzip
```

### تثبيت Node.js (استخدام الإصدار 18 أو 20 المستقر):
```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
```
تأكد من التثبيت:
```bash
node -v
npm -v
```

### تثبيت MySQL (استخدم MariaDB لخفتها وسرعتها):
```bash
sudo apt install -y mariadb-server
sudo mysql_secure_installation
# اتبع التعليمات: Set root password, Remove anonymous users, Disallow root login remotely, Remove test db, Reload privileges.
```

### إنشاء قاعدة البيانات:
ادخل للـ MySQL:
```bash
sudo mysql -u root -p
```
نفذ الأوامر التالية (استبدل `your_password` بكلمة سر قوية):
```sql
CREATE DATABASE salla_whatsapp_saas CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'salla_user'@'localhost' IDENTIFIED BY 'your_password';
GRANT ALL PRIVILEGES ON salla_whatsapp_saas.* TO 'salla_user'@'localhost';
FLUSH PRIVILEGES;
EXIT;
```

---

## 📥 2. رفع الكود (Clone & Setup)

اذهب للمجلد المناسب (مثلاً `/var/www`):
```bash
cd /var/www
# إذا عندك الرابط من Git:
# git clone https://github.com/your-username/your-repo.git mobher-ai
# إذا بترفع الملفات يدوياً (ZIP)، استخدم SFTP أو FileZilla لرفع الملفات إلى /var/www/mobher-ai
```

ادخل مجلد المشروع وثبت المكاتب:
```bash
cd /var/www/mobher-ai
npm install
```

---

## ⚙️ 3. إعدادات البيئة (.env)

انسخ ملف المثال:
```bash
cp .env.example .env
nano .env
```
عيّن القيم الحقيقية:
- `PORT=8095`
- `DATABASE_PASSWORD` (كلمة السر التي اخترتها للـ user في الخطوة 1)
- `SALLA_OAUTH_...` (اتركها فارغة الآن حتى نربط مع سلة)
- `OPENAI_API_KEY`

احفظ الملف (`Ctrl+O` ثم `Enter`، ثم `Ctrl+X`).

---

## 🚀 4. تشغيل التطبيق (PM2)

ثبت PM2 عالمياً:
```bash
sudo npm install -g pm2
```

شغل التطبيق:
```bash
pm2 start ecosystem.config.js
pm2 save
pm2 startup
# انسخ الأمر الذي يظهر لك ونفذه لتفعيل التشغيل التلقائي عند إعادة تشغيل السيرفر
```

تأكد أن التطبيق يعمل:
```bash
pm2 status
curl http://localhost:8095
```

---

## 🌐 5. ربط الدومين (Nginx Reverse Proxy)

ثبت Nginx:
```bash
sudo apt install -y nginx
```

أنشئ ملف إعداد للموقع (استبدل `your-domain.com` بدومينك):
```bash
sudo nano /etc/nginx/sites-available/mobher-ai
```
الصق المحتوى التالي:
```nginx
server {
    listen 80;
    server_name your-domain.com www.your-domain.com;

    location / {
        proxy_pass http://localhost:8095;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
```

فعل الموقع وأعد تشغيل Nginx:
```bash
sudo ln -s /etc/nginx/sites-available/mobher-ai /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl restart nginx
```

---

## 🔒 6. تفعيل الحماية (SSL/HTTPS)

استخدم Certbot للحصول على شهادة SSL مجانية:
```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d your-domain.com -d www.your-domain.com
```
اختر الخيار `2` (Redirect) لإجبار الزوار على استخدام HTTPS.

---

## 🔗 7. الخطوة الأخيرة: ربط سلة (Salla Partners)

1. خذ الدومين الجديد: `https://your-domain.com`
2. اذهب إلى [Salla Partners Portal](https://partners.salla.sa).
3. في إعدادات التطبيق (App Settings)، حدث الراوبط:
   - **Callback URL:** `https://your-domain.com/salla/callback` (أو حسب المسار في الكود)
   - **Webhook URL:** `https://your-domain.com/webhook`
4. انسخ `Client ID` و `Client Secret` و `Webhook Secret` من سلة.
5. ارجع للسيرفر وعدل ملف `.env`:
   ```bash
   nano .env
   ```
   الصق القيم الجديدة.
6. أعد تشغيل التطبيق لتحديث الإعدادات:
   ```bash
   pm2 restart mobher-ai-whatsapp
   ```

🎉 **مبروك! تطبيقك الآن يعمل 100% ومربوط بسلة.**
