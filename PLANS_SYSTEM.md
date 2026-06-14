# 🗂️ نظام الباقات — مرجع شامل

> هذا المرجع هو **المصدر الوحيد (Single Source of Truth)** لكل ما يخص باقات الاشتراكات في النظام. أي تعديل على الباقات يجب أن يبدأ من هنا ثم يُطبّق على جميع الملفات.

---

## 📊 الباقات الثلاث

| # | الباقة | سعر شهري | سعر سنوي | موديل AI |
|---|--------|-------------|--------------|---------|
| 1 | **الأساسية** | 49 ر.س | 470 ر.س | GPT-4o Mini |
| 2 | **النمو** ⭐ الأكثر طلباً | 149 ر.س | 1,430 ر.س | GPT-4o Mini |
| 3 | **الشركات** | 299 ر.س | 2,850 ر.س | GPT-4o Mini |

> **ملاحظة**: جميع الباقات تستخدم GPT-4o Mini. قيمة `ai_advanced: true` تعني مزايا ذكية/تسويقية داخلية وليست موديل أغلى.

---

## 📋 المميزات لكل باقة (المعروضة في `views/pricing.html`)

### 1️⃣ الأساسية (49 ر.س)

| الميزة | الحالة | المفتاح |
|---------|--------|---------|
| 10,000 رسالة شهرية | ✅ | `limits.messages_monthly: 10000` |
| رقم 1 واتساب | ✅ | `limits.whatsapp_numbers: 1` |
| بوت رد آلي (قوائم) | ✅ | `features.auto_reply_bot` |
| أتمتة سلات متروكة | ✅ | `features.automation_carts` |
| إشعارات حالة الطلب | ✅ | `features.automation_orders` |
| رسائل ترحيبية | ✅ | `features.welcome_messages` |
| حملات جماعية (QR) | ✅ | `features.campaigns` |
| 1,000 رد ذكاء اصطناعي | ✅ | `limits.ai_replies_monthly: 1000` |
| ذكاء اصطناعي متقدم | ❌ | `features.ai_advanced: false` |
| استيراد العملاء Excel | ❌ | `features.customers_import: false` |
| API Access | ❌ | `features.api_access: false` |
| WhatsApp Business API | ❌ | `features.whatsapp_api: false` |

**السيناريوهات:** `abandoned_cart`, `order_status`

---

### 2️⃣ النمو (149 ر.س) — كل مزايا الأساسية + التالي:

| الميزة | المفتاح |
|---------|---------| 
| **رسائل غير محدودة** 🔥 | `limits.messages_monthly: -1` |
| **ذكاء اصطناعي متقدم** | `features.ai_advanced: true` |
| 7,000 رد ذكاء اصطناعي | `limits.ai_replies_monthly: 7000` |
| حملات تسويقية (Broadcast) | `features.campaigns: true` |
| تسليم منتجات رقمية + أكواد | `features.digital_products: true` |
| استيراد العملاء (Excel) | `features.customers_import: true` |
| أتمتة سلات ذكية (مفاوض AI) | `features.ai_cart_negotiator: true` |
| تذكير بتقييم المتجر | scenario: `review_request` |
| تهنئة عيد ميلاد | scenario: `birthday` |
| إعادة تنشيط العملاء | scenario: `reactivation` |
| ربط 3 أرقام واتساب | `limits.whatsapp_numbers: 3` |
| WhatsApp Business API | ❌ `features.whatsapp_api: false` |

---

### 3️⃣ الشركات (299 ر.س) — كل مزايا النمو + التالي:

| الميزة | المفتاح |
|---------|---------| 
| **API Access** (REST + Webhooks) | `features.api_access: true` |
| **Custom Knowledge Base (إعداد قاعدة معرفة مخصصة)** | `features.custom_ai_training: true` |
| **WhatsApp Business API** ✅ | `features.whatsapp_api: true` |
| 15,000 رد ذكاء اصطناعي | `limits.ai_replies_monthly: 15000` |
| تنبيه انخفاض سعر | scenario: `price_drop` |
| أرقام واتساب غير محدودة | `limits.whatsapp_numbers: -1` |

---

## 🔒 حدود الذكاء الاصطناعي الداخلية (مخفية عن المستخدم)

> **مهم**: هذه الحدود داخلية ولا تُعرض للمستخدم. الهدف منها حماية التكلفة.

| الباقة | حد ردود AI الشهرية | الموديل |
|--------|---------------------|---------|
| الأساسية | 1,000 | GPT-4o Mini |
| النمو | 7,000 | GPT-4o Mini |
| الشركات | 15,000 | GPT-4o Mini |

**التطبيق**: `helpers/limitsEngine.js` يفحص `action === 'ai_reply'` ويقارن `ai_requests` بالحد من `planGate.getLimit()`.

---

## 🔐 Meta WhatsApp Business API

> **Meta API محصور حصرياً في باقة الشركات (299 ر.س)**

| الباقة | whatsapp_qr | whatsapp_api | الملاحظة |
|--------|-------------|-------------|----------|
| الأساسية | ✅ | ❌ | QR فقط |
| النمو | ✅ | ❌ | QR فقط |
| الشركات | ✅ | ✅ | QR + Meta API |

**نقاط التحقق**:
- `app.js:616` — يفحص `whatsapp_api` قبل إرسال Meta
- `app.js:1455` — يحمي صفحة WhatsApp API settings
- `app.js:1629` — يحمي POST WhatsApp API settings  
- `routes/settings.js` — محمي بـ `requireFeaturePage('whatsapp_api')`

---

## 🎁 التجربة المجانية

| الباقة | trial_days | الملاحظة |
|--------|-----------|----------|
| الأساسية | 7 أيام | status='trial' |
| النمو | 7 أيام | status='trial' |
| الشركات | 7 أيام | status='trial' |

**التطبيق**: `database/index.js` → `ensureTrialSubscription()` ينشئ trial مع الباقة الافتراضية (الأساسية).

---

## 🗺️ خريطة الملفات

| الملف | الدور |
|------|------|
| **`services/planGate.js`** | **المرجع الرئيسي** — تعريف PLANS + middlewares (`requirePage`, `requireFeature`, `injectPlanContext`) |
| `fix_plan.js` | سكريبت مزامنة الباقات في DB (مطابق 100% لـ planGate) |
| `views/pricing.html` | صفحة التسعير — UI يعكس بيانات planGate |
| `views/index.html` | الصفحة الرئيسية — أسعار الباقات |
| `views/layouts/dashboard_master.html` | القالب الرئيسي + Dev Switcher + عرض معلومات الباقة |
| `views/upgrade_required.html` | صفحة الترقية المطلوبة (عند رفض 403) |
| `views/ai_settings.html` | شارة "ميزة الذكاء المتقدم" |
| `views/settings.html` | إعدادات WhatsApp + Banner ترقية الباقة + API gate |
| `services/AIService.js` | يستخدم `planGate.checkTenantAccess` قبل كل رد |
| `helpers/limitsEngine.js` | فحص حدود الرسائل + ردود AI |
| `services/BillingService.js` | معالجة الاشتراكات والمدفوعات |
| `database/index.js` | Seed Plans عند التشغيل + `ensureTrialSubscription` |
| `app.js:315` | يحقن `injectPlanContext` **قبل** كل الـ routes |

---

## 🔄 تدفق التحقق

### 1️⃣ Backend Middleware (`planGate.requirePage`)
```js
app.get("/campaigns", planGate.requirePage('campaigns'), handler);
```
- يجلب الباقة من DB
- يرجع HTTP 403 + صفحة `upgrade_required.html` إذا الميزة غير مسموحة
- يضيف `req.planContext` و `req.tenantPlan`

### 2️⃣ Global Context Injection (`planGate.injectPlanContext`)
```js
// app.js:315 — يعمل قبل كل route
app.use(planGate.injectPlanContext());
```
- يضيف `res.locals.planContext` و `res.locals.plan_name` و `res.locals.sub_status`
- متاح لكل الـ views تلقائياً

### 3️⃣ Feature Check في APIs
```js
// لحماية endpoints بمزايا محددة
router.post('/settings/whatsapp', planGate.requireFeature('whatsapp_api'), handler);
```
