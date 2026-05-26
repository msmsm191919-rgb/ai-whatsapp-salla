# 🚨 قائمة التسليم — ملفات لا يجب تسليمها للمطور

> اقرأ هذا الملف **قبل أي تسليم** (لأي مطور، GitHub، أو نشر).

---

## 🔴 ممنوع تسليمها مطلقاً (Secrets)

### 1. ملف `.env`
**يحتوي:**
- `OPENAI_API_KEY` — مفتاحك على OpenAI (ينضرب الرصيد إذا تسرّب)
- `SALLA_OAUTH_CLIENT_SECRET` — سرّ تطبيقك على سلة
- `SALLA_WEBHOOK_SECRET` — التحقق من Webhooks
- `SESSION_SECRET` — تشفير الـ Sessions
- `META_VERIFY_TOKEN` — Verify token لـ WhatsApp Cloud API

**البديل:** سلّم ملف `.env.example` فيه أسماء المفاتيح فقط بدون قيم.

### 2. ملفات قاعدة البيانات (`database/*.sqlite`)
**تحتوي:**
- بيانات تجار حقيقيين (`Tenants`)
- Access tokens لـ WhatsApp و Salla
- محادثات العملاء (`MessageLog`)
- بيانات اشتراكات + مدفوعات

**البديل:** سلّم schema فقط عبر:
```bash
node setup_db.js   # ينشئ DB فارغة جديدة
node fix_plan.js   # يبذر الباقات
```

### 3. ملفات الشهادات `.pem` / `.key` / `.cert`
SSL certificates إذا وُجدت.

---

## 🟡 يُحذف قبل النشر للإنتاج (Dev Tools)

### في الكود:

| الملف / الموقع | السبب |
|----------------|--------|
| `app.js:1024` → `GET /dev/switch-plan/:plan` | endpoint تطوير يبدّل الباقات بدون auth |
| `views/layouts/dashboard_master.html` (Dev Switcher widget) | Widget عائم لتبديل الباقات — visible للعموم! |
| `test_*.js` (كل الملفات) | scripts اختبار |
| `check_*.js`, `simulate_*.js` | أدوات debugging |
| `switch_to_basic.js`, `switch_to_enterprise.js` | scripts تبديل يدوي |
| `fix_ui.js`, `copy_logo.js` | scripts مؤقتة |

### كيف تحذفها (آمن):
```bash
# 1. احذف Dev Switcher endpoint من app.js
#    (سطر 1022-1054 — البحث عن "DEV ONLY")

# 2. احذف Dev Switcher widget من dashboard_master.html
#    (تقريباً السطر 410-470 — البحث عن "DEV Plan Switcher" أو "dev-switcher")

# 3. أو احمها خلف environment check:
if (process.env.NODE_ENV === 'development') { /* dev routes */ }
```

---

## 🟢 آمن للتسليم (الكود الأساسي)

- ✅ كل ملفات `views/`, `routes/`, `services/`, `helpers/`, `jobs/`, `controllers/`
- ✅ `app.js`, `package.json`, `package-lock.json`
- ✅ `Dockerfile`, `docker-compose.yml`
- ✅ `README.md`, `PLANS_SYSTEM.md`, `DEPLOYMENT_GUIDE.md`, `PRODUCTION_GUIDE.md`
- ✅ `.gitignore`, `.env.example`
- ✅ `ecosystem.config.js` (PM2 config)

---

## 📋 خطوات التسليم الآمن

### خطوة 1: نظّف الـ Secrets
```bash
# إنشاء .env.example بدون قيم
cp .env .env.example
# ثم افتح .env.example وامسح القيم بعد علامة "="
```

### خطوة 2: نظّف قاعدة البيانات
```bash
# لا تسلّم DB الإنتاج، فقط schema
rm database/*.sqlite
```

### خطوة 3: عطّل أدوات الـ DEV
```bash
# علّق Dev Switcher widget في dashboard_master.html
# علّق /dev/switch-plan route في app.js
# أو شيلهم نهائياً
```

### خطوة 4: اختبر الـ .gitignore
```bash
git status
# لازم .env و *.sqlite ما تظهر في "untracked" أو "modified"
```

### خطوة 5: حضّر الـ Handover Package
```bash
# أنشئ ZIP أو Push لـ GitHub
# الملفات اللي لازم تكون موجودة:
- README.md
- PLANS_SYSTEM.md          ← دليل الباقات
- DEPLOYMENT_GUIDE.md      ← دليل النشر
- HANDOVER_CHECKLIST.md    ← (هذا الملف)
- .env.example             ← مفاتيح فاضية
- package.json
- كل الكود المصدري
```

---

## ⚠️ ما يحتاج المطور يعرفه عند الاستلام

أرسل له هذه التعليمات معاً:

```text
1. انسخ .env.example إلى .env
2. احصل على المفاتيح:
   - OPENAI_API_KEY من platform.openai.com
   - SALLA_OAUTH_* من salla.dev (التطبيقات)
   - META_VERIFY_TOKEN — اخترع نص عشوائي
3. شغّل:
   npm install
   node setup_db.js
   node fix_plan.js
   node app.js
4. اقرأ PLANS_SYSTEM.md لفهم بنية الباقات
5. اقرأ DEPLOYMENT_GUIDE.md للنشر للإنتاج
```

---

## 🔐 إذا تسرّب أحد المفاتيح:

### OpenAI Key مسرّب:
1. روح [platform.openai.com/api-keys](https://platform.openai.com/api-keys)
2. Revoke المفتاح القديم
3. أنشئ مفتاح جديد
4. حدّث `.env` على السيرفر

### Salla Secret مسرّب:
1. ادخل [salla.dev/dashboard](https://salla.dev)
2. تطبيقاتي → التطبيق → Reset Secret
3. حدّث `.env`

### Session Secret مسرّب:
1. غيّر قيمة `SESSION_SECRET` في `.env`
2. أعد تشغيل الخادم — كل الـ sessions القديمة ستُلغى تلقائياً

---

## ✅ الـ `.gitignore` المُحدّث يحمي:

- `.env*` (كل بيئات)
- `*.sqlite*` (كل قواعد البيانات)
- `*.pem`, `*.key`, `*.cert` (الشهادات)
- `node_modules/`, `dist/`, `build/`
- `test_*.js`, `check_*.js`, `simulate_*.js`, `switch_to_*.js`
- ملفات OS و IDE

---

_آخر تحديث: مايو 2026_
