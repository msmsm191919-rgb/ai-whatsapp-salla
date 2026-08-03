# دليل عمليات بيئة Staging (Staging Operations Runbook)

**المشروع:** مبهر (Mubhir) — WhatsApp AI SaaS
**آخر تحديث:** 13 يوليو 2026
**الخادم:** `srv1707218` (IP: `[MASKED]`)

---

## ⚠️ تحذيرات حرجة

> [!CAUTION]
> **ممنوع** تشغيل `ecosystem-staging.config.js` بواسطة المستخدم `root`.
> **ممنوع** استخدام `PM2_HOME=/root/.pm2` لإدارة Staging.
> **ممنوع** استخدام `pm2 restart all` أو `pm2 kill` أو `pm2 delete all` على الخادم المشترك.
> **ممنوع** تعديل ملفات Production أو قاعدة بياناته أو جلسات WhatsApp الخاصة به.

---

## أمر التشغيل الوحيد المعتمد

```bash
sudo -u mubhir-staging env PM2_HOME=/opt/mubhir-staging/home/.pm2 \
  pm2 start /opt/mubhir-staging/app/ecosystem-staging.config.js
```

> [!IMPORTANT]
> هذا هو الأمر الوحيد المسموح لتشغيل بيئة Staging. أي أمر آخر سيؤدي إلى تشغيل مزدوج أو تعارض في المنافذ.

---

## أوامر الإدارة الصحيحة

### عرض حالة Staging

```bash
sudo -u mubhir-staging env PM2_HOME=/opt/mubhir-staging/home/.pm2 \
  pm2 list
```

### عرض سجلات Staging

```bash
sudo -u mubhir-staging env PM2_HOME=/opt/mubhir-staging/home/.pm2 \
  pm2 logs whatsapp-ai-staging --lines 200 --nostream
```

### عرض سجلات Staging بشكل مباشر (متابعة حية)

```bash
sudo -u mubhir-staging env PM2_HOME=/opt/mubhir-staging/home/.pm2 \
  pm2 logs whatsapp-ai-staging --lines 50
```

### إعادة تشغيل Staging (عند طلب صريح فقط)

```bash
sudo -u mubhir-staging env PM2_HOME=/opt/mubhir-staging/home/.pm2 \
  pm2 restart whatsapp-ai-staging --update-env
```

### إيقاف Staging

```bash
sudo -u mubhir-staging env PM2_HOME=/opt/mubhir-staging/home/.pm2 \
  pm2 stop whatsapp-ai-staging
```

### حفظ قائمة Staging (للاسترداد بعد Reboot)

```bash
sudo -u mubhir-staging env PM2_HOME=/opt/mubhir-staging/home/.pm2 \
  pm2 save
```

### عرض تفاصيل العملية

```bash
sudo -u mubhir-staging env PM2_HOME=/opt/mubhir-staging/home/.pm2 \
  pm2 describe whatsapp-ai-staging
```

---

## هيكل الملفات

| المسار | الوصف |
|---|---|
| `/opt/mubhir-staging/app/` | كود التطبيق |
| `/opt/mubhir-staging/app/.env.staging` | متغيرات البيئة |
| `/opt/mubhir-staging/app/ecosystem-staging.config.js` | إعدادات PM2 |
| `/opt/mubhir-staging/data/` | بيانات التطبيق (DB, auth) |
| `/opt/mubhir-staging/data/database_staging.sqlite` | قاعدة بيانات SQLite |
| `/opt/mubhir-staging/data/wwebjs_auth/` | جلسات WhatsApp |
| `/opt/mubhir-staging/logs/` | سجلات التطبيق |
| `/opt/mubhir-staging/logs/out.log` | سجل stdout |
| `/opt/mubhir-staging/logs/error.log` | سجل stderr |
| `/opt/mubhir-staging/run/` | ملفات PID |
| `/opt/mubhir-staging/home/.pm2/` | PM2 daemon home |
| `/opt/mubhir-staging/backups/` | نسخ احتياطية |

---

## إعدادات الشبكة

| المعامل | القيمة |
|---|---|
| **المنفذ الثابت** | `8096` |
| **العنوان** | `127.0.0.1` (localhost فقط — SSH tunnel مطلوب) |
| **Port Fallback** | **معطّل** — يفشل فوراً عند EADDRINUSE |

---

## حراسات التشغيل (Launch Guards)

يتم التحقق تلقائياً عند بدء التشغيل في بيئة `staging`:

1. **حارس المستخدم**: يجب أن يكون المستخدم `mubhir-staging`
2. **حارس PM2_HOME**: يجب أن يكون `/opt/mubhir-staging/home/.pm2`
3. **حارس Working Directory**: يجب أن يكون `/opt/mubhir-staging/app`
4. **حارس المنفذ**: `8096` ثابت — لا fallback

> [!NOTE]
> إذا فشل أي حارس، يتوقف التطبيق فوراً قبل فتح قاعدة البيانات أو تشغيل Chromium.

---

## استكشاف الأخطاء

### خطأ: `FATAL [LAUNCH GUARD]: Staging MUST run as user 'mubhir-staging'`

**السبب:** تم تشغيل Staging بواسطة `root` أو مستخدم آخر.
**الحل:** استخدم الأمر المعتمد أعلاه مع `sudo -u mubhir-staging`.

### خطأ: `FATAL [LAUNCH GUARD]: Staging requires PM2_HOME=...`

**السبب:** PM2 يعمل تحت daemon خاطئ.
**الحل:** تأكد من تمرير `PM2_HOME=/opt/mubhir-staging/home/.pm2`.

### خطأ: `FATAL [PORT CONFLICT]: Port 8096 is already in use`

**السبب:** عملية أخرى تستخدم المنفذ 8096.
**الحل:**
```bash
ss -tlnp | grep :8096
# حدد العملية المالكة وأوقفها إذا كانت نسخة مكررة
```

### خطأ: `FATAL [PORT VALIDATION]: PORT must contain digits only`

**السبب:** قيمة `PORT` في ملف البيئة غير صالحة.
**الحل:** تأكد أن `PORT=8096` بدون مسافات أو أحرف.

---

## الفرق بين Production و Staging

| المعامل | Production | Staging |
|---|---|---|
| PM2 Process Name | `whatsapp-ai` | `whatsapp-ai-staging` |
| PM2 Daemon | `/root/.pm2` | `/opt/mubhir-staging/home/.pm2` |
| User | `root` | `mubhir-staging` |
| Port | `8095` | `8096` |
| NODE_ENV | `production` | `staging` |
| Database | MariaDB `mubhir_production` | SQLite (مؤقت) |
| Directory | `/root/ai-whatsapp-salla` | `/opt/mubhir-staging/app` |

---

## أوامر مراقبة Production (قراءة فقط)

```bash
# عرض حالة Production (من root PM2)
pm2 list

# عرض سجلات Production
pm2 logs whatsapp-ai --lines 100 --nostream

# فحص المنافذ النشطة
ss -tlnp | grep -E ':8095|:8096|:8097'
```

> [!WARNING]
> **لا تُعد تشغيل Production إلا بإذن صريح ومكتوب.**
> لا تستخدم `pm2 restart all` أو `pm2 kill` على هذا الخادم.
