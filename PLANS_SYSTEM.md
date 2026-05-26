# 📋 نظام الباقات — التوثيق الشامل

> هذا الملف هو **المرجع الوحيد (Single Source of Truth)** لكل ما يخص الباقات والاشتراكات في النظام. أي تعديل على الباقات لازم يتم في الأماكن المذكورة هنا حتى يبقى النظام متماسك.

---

## 🎯 الباقات الثلاث

| # | الباقة | السعر شهرياً | السعر سنوياً | الموديل |
|---|--------|-------------|--------------|---------|
| 1 | **الأساسية** | 79 ر.س | 759 ر.س | GPT-4o Mini |
| 2 | **النمو** ⭐ الأكثر طلباً | 149 ر.س | 1,430 ر.س | GPT-4o |
| 3 | **الشركات** | 299 ر.س | 2,850 ر.س | GPT-4o (Custom) |

---

## 📦 مميزات كل باقة (مطابقة لـ `views/pricing.html`)

### 1️⃣ الأساسية (79 ر.س)

| المميزة | الحالة | المفتاح |
|---------|--------|---------|
| 10,000 رسالة شهرياً | ✅ | `limits.messages_monthly: 10000` |
| ربط 1 رقم واتساب | ✅ | `limits.whatsapp_numbers: 1` |
| بوت رد آلي (قوائم) | ✅ | `features.auto_reply_bot` |
| استعادة السلات المتروكة | ✅ | `features.automation_carts` |
| إشعارات حالة الطلب | ✅ | `features.automation_orders` |
| إشعارات ترحيبية | ✅ | `features.welcome_messages` |
| دعم فني عبر الشات | ✅ | `features.priority_support: false` (دعم عادي) |
| ذكاء اصطناعي GPT-4o | ❌ | يستخدم GPT-4o Mini |
| حملات تسويقية | ❌ | `features.campaigns: false` |
| تسليم منتجات رقمية | ❌ | |
| استيراد عملاء Excel | ❌ | |
| API Access | ❌ | |
| White-label | ❌ | |

**السيناريوهات النشطة:** `abandoned_cart`, `order_status`

---

### 2️⃣ النمو (149 ر.س) — شامل كل مزايا الأساسية + التالي:

| المميزة | المفتاح |
|---------|---------|
| **رسائل غير محدودة** 🚀 | `limits.messages_monthly: -1` |
| **GPT-4o** (دقة عالية) | `features.ai_advanced: true` |
| حملات تسويقية (Broadcast) | `features.campaigns: true` |
| تسليم المنتجات الرقمية + أكواد | `features.digital_products: true` |
| استيراد العملاء (Excel) | `features.customers_import: true` |
| استعادة سلات ذكية (مفاوض AI) | `features.ai_cart_negotiator: true` |
| تذكير بتقييم المتجر | scenario: `review_request` |
| عروض عيد الميلاد | scenario: `birthday` |
| إعادة تفعيل العملاء | scenario: `reactivation` |
| ربط 3 أرقام واتساب | `limits.whatsapp_numbers: 3` |

---

### 3️⃣ الشركات (299 ر.س) — شامل كل مزايا النمو + التالي:

| المميزة | المفتاح |
|---------|---------|
| **API Access** (REST + Webhooks) | `features.api_access: true` |
| **Custom AI Training** | `features.custom_ai_training: true` |
| **White-label** (إخفاء شعار مبهر) | `features.white_label: true` |
| تنبيه تخفيض السعر | scenario: `price_drop` |
| أرقام واتساب غير محدودة | `limits.whatsapp_numbers: -1` |

---

## 🗂️ خريطة الملفات — أين يعيش كل شي

| الملف | الدور |
|------|------|
| **`services/planGate.js`** | **المصدر الوحيد للحقيقة** — تعريف PLANS + middlewares (`requirePage`, `requireFeature`, `injectPlanContext`) |
| `fix_plan.js` | يبذر الباقات في DB (`Plan` table) — لازم يطابق planGate |
| `views/pricing.html` | صفحة الأسعار للعميل — UI فقط، لازم تطابق planGate |
| `views/layouts/dashboard_master.html` | السايدبار + Dev Switcher + قفل العناصر حسب الباقة |
| `views/upgrade_required.html` | صفحة الترقية الموحّدة (تظهر عند 403) |
| `views/ai_settings.html` | كرت "نموذج الذكاء النشط" |
| `views/settings.html` | إعدادات WhatsApp + Banner أرقام الباقة + API gate |
| `services/AIService.js` | يقرأ `ai_advanced` ويختار الموديل (`gpt-4o` أو `gpt-4o-mini`) |
| `app.js` (سطر 247) | تسجيل `injectPlanContext` **قبل** كل الـ routes |

---

## 🛡️ ثلاث طبقات حماية

### 1️⃣ Backend Middleware (`planGate.requirePage`)
```js
app.get("/campaigns", planGate.requirePage('campaigns'), handler);
```
- يفحص الباقة من DB
- يرجع HTTP 403 + يعرض `upgrade_required.html` إذا الميزة مقفلة
- يحقن `req.planContext` و `req.tenantPlan`

### 2️⃣ Global Context Injection (`planGate.injectPlanContext`)
```js
// app.js:247 — لازم يكون قبل كل app.use('/route', ...)
app.use(planGate.injectPlanContext());
```
- يضع `res.locals.planContext` لكل request
- تستخدمه جميع الـ views (للسايدبار، الكروت، الـ banners)

### 3️⃣ Frontend Lock (Templates)
```nunjucks
{% if planContext.can.campaigns %}
    <a href="/campaigns">حملات</a>
{% else %}
    <a href="/campaigns" class="locked">🔒 حملات</a>
{% endif %}
```

---

## 📱 نظام الأرقام المتعددة (Multi-WhatsApp)

### الحدود حسب الباقة:
| الباقة | عدد الأرقام |
|--------|------------|
| الأساسية | 1 رقم فقط |
| النمو | 3 أرقام |
| الشركات | بلا حدود (`-1`) |

### Schema:
```js
WhatsAppConfig {
  tenant_id,
  phone_number_id (unique per Meta),
  waba_id,
  access_token,
  phone_number (display),
  label (مثلاً "الدعم الفني"),
  is_primary (boolean — رقم واحد فقط per tenant),
  status: active|pending|disconnected
}

Tenant.hasOne(WhatsAppConfig, scope:{is_primary:true})  // legacy
Tenant.hasMany(WhatsAppConfig, as:'WhatsAppNumbers')    // الجديد
```

### API Endpoints:
| Method | Endpoint | الدور |
|--------|----------|-----|
| POST | `/api/whatsapp-numbers` | إضافة رقم (يفحص حد الباقة) |
| PUT | `/api/whatsapp-numbers/:id` | تعديل رقم |
| DELETE | `/api/whatsapp-numbers/:id` | حذف رقم (يمنع حذف primary لو فيه غيره) |
| POST | `/api/whatsapp-numbers/:id/make-primary` | جعل رقم primary |

### كيف يعمل التوجيه:
- Meta يرسل webhook إلى `/webhook/meta` مع `phone_number_id`
- الكود يبحث في `WhatsAppConfig.findOne({ phone_number_id })`
- يحصل على `tenant_id` ومعه access_token
- يرد عبر الـ token الخاص بنفس الرقم
- **النتيجة**: كل رقم يستقبل/يرسل مستقلاً، لكن usage counter موحّد per tenant

### UI في `/settings/whatsapp`:
- Banner أعلى الصفحة: "مربوط X من أصل Y"
- قسم "الرقم الأساسي" (الفورم الموجود)
- قسم "الأرقام الإضافية" (يظهر للنمو/الشركات فقط):
  - زر "إضافة رقم" يفتح Modal
  - قائمة بالأرقام مع badges (نشط/منقطع)
  - زر ⭐ (جعله primary) + زر 🗑 (حذف)

---

## 🌐 نظام Multi-Platform OAuth (4 منصات)

النظام يدعم 4 منصات بأبستراكشن موحّد:

| المنصة | OAuth | الحالة |
|--------|-------|--------|
| **سلة (Salla)** | OAuth 2.0 عبر accounts.salla.sa | ✅ جاهز (passport-strategy) |
| **زد (Zid)** | OAuth عبر oauth.zid.sa | ✅ Adapter جاهز + Mock للتطوير |
| **شوبيفاي (Shopify)** | OAuth per-shop | ✅ Adapter جاهز + Mock |
| **مستقل (Standalone)** | Signup مباشر (بدون OAuth) | ✅ جاهز |

### بنية الـ Code:

```
services/platforms/
├── BaseAdapter.js          ← الواجهة الموحّدة (interface)
├── SallaAdapter.js         ← Salla API
├── ZidAdapter.js           ← Zid API
├── ShopifyAdapter.js       ← Shopify API
├── StandaloneAdapter.js    ← لا API خارجي
└── index.js                ← PlatformRegistry

services/ConnectService.js  ← Orchestrator (upsertTenantFromOAuth)
```

### الـ Flow:
```
1. /connect → صفحة اختيار المنصة (تعرض الـ 4 cards)
        ↓
2. /connect/:platform → يُولّد state ويحوّل لـ OAuth URL
   • إذا في Mock mode → يحاكي رجوع مباشر للـ callback
   • Standalone → يفتح صفحة signup
        ↓
3. OAuth provider يطلب موافقة المتجر
        ↓
4. /oauth/:platform/callback?code=XXX&state=YYY
        ↓
5. adapter.exchangeCodeForToken(code, redirectUri, shopDomain?)
   → يرجع { access_token, store_id, store_name, ... }
        ↓
6. ConnectService.upsertTenantFromOAuth({ platform, tokenData })
   - يبحث عن Tenant بـ (platform, platform_store_id)
   - إذا غير موجود → ينشئ Tenant + Subscription trial (7 يوم)
   - يحفظ access_token في SallaOAuth جدول (مع meta.platform)
        ↓
7. يحوّل لـ /dashboard?welcome=1&platform=:platform
```

### Schema الجديد للـ Tenant:
```js
{
  platform: 'salla'|'zid'|'shopify'|'standalone',  // NEW
  platform_store_id: string,                        // NEW (generic)
  salla_merchant_id: BIGINT (nullable),             // legacy للتوافق
  store_name, store_domain, email,
  contact_email, contact_phone                       // NEW
}
```

### للإنتاج — احصل على مفاتيح OAuth:

| المنصة | المكان |
|--------|--------|
| Salla | [salla.dev/partners](https://salla.dev/partners) → `SALLA_OAUTH_CLIENT_ID`, `SALLA_OAUTH_CLIENT_SECRET` |
| Zid | [web.zid.sa/partners](https://web.zid.sa) → `ZID_CLIENT_ID`, `ZID_CLIENT_SECRET` |
| Shopify | [partners.shopify.com](https://partners.shopify.com) → `SHOPIFY_CLIENT_ID`, `SHOPIFY_CLIENT_SECRET` |
| Standalone | لا يحتاج مفاتيح — يعمل دائماً |

كل منصة لها **Mock Mode تلقائي**: إذا المفاتيح فاضية → الـ Adapter يحاكي ردود واقعية لاختبار الـ Flow بدون حساب فعلي.

### Redirect URIs اللي تسجلها في كل منصة:
- Salla: `https://your-domain.com/oauth/salla/callback`
- Zid: `https://your-domain.com/oauth/zid/callback`
- Shopify: `https://your-domain.com/oauth/shopify/callback`

---

## 💳 نظام الدفع (Tap Payments)

### الـ Flow الكامل:

```
1. العميل يضغط "اشترك الآن" في pricing.html
        ↓
2. JS: POST /billing/checkout { plan_name, billing_period }
        ↓
3. BillingService.initiateTapCheckout()
   - يحسب المبلغ
   - ينشئ Payment record (status=pending)
   - يستدعي TapService.createCharge()
   - يحفظ provider_payment_id من Tap
   - يرجّع checkoutUrl
        ↓
4. المستخدم يتحوّل إلى Tap checkout (في وضع Mock يتحوّل مباشرة لـ return)
        ↓
5. بعد الدفع:
   - Tap يرسل webhook POST /webhook/tap (server-to-server)
   - Tap يحوّل المستخدم لـ GET /billing/return?tap_id=...
        ↓
6. BillingService.processPaymentSuccess(chargeId):
   - Payment.status = 'paid'
   - Subscription.plan_id = new plan
   - Subscription.status = 'active'
   - Subscription.end_date = +30 يوم (أو +365 سنوي)
        ↓
7. العميل يصل /billing?status=success → يشوف رسالة نجاح
```

### ملفات Tap:
| الملف | الدور |
|------|------|
| `services/TapService.js` | الاتصال المباشر مع Tap API + Mock Mode |
| `services/BillingService.js` | `initiateTapCheckout()`, `processPaymentSuccess()`, `processPaymentFailure()` |
| `app.js` (سطر ~1093) | Routes: `/billing/checkout`, `/billing/return`, `/webhook/tap`, `/billing` |
| `views/billing.html` | صفحة الفواتير + سجل المدفوعات |
| `views/pricing.html` | أزرار `startCheckout('اسم الباقة')` |
| `views/upgrade_required.html` | زر `upgradeDirectly('اسم الباقة')` |

### Mock Mode (للتطوير):
- إذا `TAP_SECRET_KEY` فاضي أو يبدأ بـ `mock` في `.env` → كل دفعة تنجح تلقائياً
- مفيد لاختبار الـ Flow بدون حساب Tap حقيقي
- الـ Mock URL يحوّل مباشرة لـ `/billing/return?status=CAPTURED&mock=1`

### للإنتاج:
1. روح [dashboard.tap.company](https://dashboard.tap.company) سجّل تطبيق
2. احصل على:
   - `TAP_PUBLIC_KEY` (pk_test_xxx أو pk_live_xxx)
   - `TAP_SECRET_KEY` (sk_test_xxx أو sk_live_xxx)
   - `TAP_WEBHOOK_SECRET` (لتحقق التوقيع)
3. ضبط webhook URL في Tap dashboard: `https://your-domain.com/webhook/tap`
4. حدّث `.env` بالقيم
5. اختبر في `sandbox` أولاً قبل `live`

### حالات الدفع المدعومة:
| Tap Status | الإجراء |
|-----------|--------|
| `CAPTURED` / `PAID` | ✅ تفعيل الاشتراك |
| `FAILED` / `DECLINED` | ❌ Payment.status = 'failed' |
| `CANCELLED` / `VOID` | ❌ تسجيل + لا تفعيل |
| `INITIATED` / `IN_PROGRESS` | ℹ️ تجاهل (انتظار webhook نهائي) |

---

## 🔌 ربط الذكاء الاصطناعي

### كيف يختار الموديل تلقائياً:

```
عميل يرسل رسالة واتساب
        ↓
Meta Webhook → POST /webhook/meta  (app.js:383)
        ↓
AIService.generateReply(tenant_id, msg)  (services/AIService.js:27)
        ↓
يقرأ Subscription.Plan.features.ai_advanced من DB
        ↓
   ├─ true  →  OpenAI("gpt-4o")        ← النمو/الشركات
   └─ false →  OpenAI("gpt-4o-mini")   ← الأساسية
        ↓
يرسل الرد عبر sendMetaMessage()
        ↓
يحفظ في MessageLog + يزيد UsageCounter
```

### المتطلبات لتشغيل AI حقيقي:
1. `.env` يحتوي `OPENAI_API_KEY=sk-...`
2. الحساب على [platform.openai.com](https://platform.openai.com/account/billing) لديه **رصيد فعّال**
3. لو الرصيد منتهي → خطأ 429 → الكود يرجع تلقائياً لـ `mockResponse()` (المستخدم ما يشوف خطأ)

---

## 🧪 الـ Dev Plan Switcher

أداة تطوير في `dashboard_master.html` (الزاوية السفلى اليسرى) — للتبديل بين الباقات فوراً بدون login جديد:

```
GET /dev/switch-plan/الأساسية
GET /dev/switch-plan/النمو
GET /dev/switch-plan/الشركات
```

⚠️ **لازم تنحذف قبل النشر للإنتاج** أو تتخفّى خلف `if (process.env.NODE_ENV === 'development')`.

---

## ✏️ كيف تضيف/تعدّل باقة جديدة

1. **عدّل `services/planGate.js`** — أضف الباقة في `PLANS` مع `pages`, `features`, `limits`, `scenarios`
2. **عدّل `fix_plan.js`** — أضف نفس الباقة في `arabicPlans[]` بنفس الـ features
3. **عدّل `views/pricing.html`** — أضف كرت العرض للعميل
4. **عدّل `views/layouts/dashboard_master.html`** — أضف الباقة في `plans_list` للـ Dev Switcher
5. **عدّل `views/upgrade_required.html`** — أضف المميزة في `feature_info` مع `need` و `price`
6. **شغّل** `node fix_plan.js` لتحديث DB
7. **أعد تشغيل** الخادم: `node app.js`

---

## 🐛 الأخطاء الشائعة والإصلاحات السابقة

### 1. `injectPlanContext` ما يشتغل
**السبب:** كان مسجّل بعد `app.use('/dashboard', dashboardRoutes)` في app.js.  
**الحل:** نقله لسطر 247 **قبل** كل تسجيلات الـ Router.

### 2. السلات والطلبات كانت مقفلة في الأساسية بالخطأ
**السبب:** ظنّيت إنها مميزات متقدمة، لكن `pricing.html` بتقول إنها متاحة في الأساسية.  
**الحل:** تم تصحيح `planGate.js` و `fix_plan.js` و `upgrade_required.html`.

### 3. كان يقول "ترقية الباقة — 149 ر.س/شهر" للـ API gate
**السبب:** نص ثابت قديم.  
**الحل:** تم تصحيحه ليقول "ترقية إلى الشركات — 299 ر.س/شهر" (مع متغيرات ديناميكية).

### 4. الـ AI كان يستدعي `gpt-3.5-turbo` للأساسية
**السبب:** كود قديم.  
**الحل:** تم تغييره لـ `gpt-4o-mini` ليطابق وعد الـ pricing.

### 5. `logs.html` يرمي خطأ `Cannot read properties of null (reading 'length')`
**السبب:** `log.to_phone | slice(-2)` على قيمة null.  
**الحل:** `{{ (log.to_phone or '--') | slice(-2) }}`.

### 6. صفحة الـ WhatsApp Settings تعرض حقل لرقم واحد فقط رغم أن النمو تسمح بـ 3
**السبب:** علاقة `Tenant.hasOne(WhatsAppConfig)` في الـ Schema.  
**الحل المؤقت:** Banner واضح + قسم "أرقام إضافية — قريباً" يعرض الحد المسموح من الباقة.  
**الحل النهائي (مطلوب):** تغيير العلاقة لـ `hasMany` + بناء UI كامل.

---

## ✅ المواءمة الكاملة (Single Source of Truth)

كل من الأماكن التالية لازم تكون **متطابقة 100%** على الأسعار والمميزات:

```
services/planGate.js  ←→  fix_plan.js (DB)  ←→  views/pricing.html
       ↓                        ↓                       ↓
        كلهم متفقين: 79 / 149 / 299 ر.س
```

أي تغيير في باقة لازم يُحدّث الثلاث الأماكن معاً، وإلا سيظهر mismatch بين ما يراه العميل في الأسعار وما يحدث فعلياً.

---

## 📞 خطوط الاتصال السريعة للنظام

| المسار | الوصف |
|--------|------|
| `/dashboard` | الصفحة الرئيسية بعد الدخول |
| `/pricing` | صفحة الباقات (عامة) |
| `/settings/whatsapp` | إعدادات WhatsApp + API |
| `/ai-settings` | شخصية المساعد + كرت الموديل |
| `/scenarios` | إدارة السيناريوهات (مع أقفال حسب الباقة) |
| `/campaigns` | الحملات (مقفلة في الأساسية) |
| `/automation/carts` | السلات المتروكة |
| `/automation/orders` | حالة الطلبات |
| `/dev/switch-plan/:name` | ⚠️ Dev only — تبديل الباقة |

---

_آخر تحديث: مايو 2026 — بعد إعادة هيكلة كاملة لنظام الباقات._
