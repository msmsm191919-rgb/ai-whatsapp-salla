# SaaS Transformation Plan: AI WhatsApp for Salla

## 1. Architecture Proposal (الهيكلة المقترحة)

لتحويل النظام إلى SaaS يدعم التعددية (Multi-Tenancy)، سننتقل من هيكلية "التطبيق الواحد" إلى هيكلية "المنصة المركزية".

### A. Technology Stack Updates
*   **Database (Core):** الانتقال من الذاكرة/الملفات إلى **PostgreSQL** أو **MySQL**. هذا ضروري جداً للعلاقات المعقدة (Store -> Plan -> Logs).
*   **Queue System:** إضافة **Redis + BullMQ**. عندما تأتي 1000 وب هوك من سلة في نفس الوقت، السيرفر لا يجب أن يعالجها فوراً (لتجنب البطء)، بل يضعها في طابور (Queue) وتتم معالجتها تباعاً.
*   **WhatsApp Provider:** استبدال `whatsapp-web.js` بـ **Meta Cloud API**.
    *   *لماذا؟* `web.js` يعتمد على متصفح وهمي يستهلك RAM عالية وغير مستقر مع تعدد الحسابات. Meta API هو الحل الرسمي، المستقر، ولا يحتاج لهاتف يعمل طوال الوقت.

### B. Data Model (Schema Design)
سنحتاج للجداول الرئيسية التالية:
1.  **Tenants (Merchants):** `id`, `salla_merchant_id`, `email`, `auth_token`, `settings (JSON)`.
2.  **Subscriptions:** `id`, `tenant_id`, `plan_id`, `start_date`, `end_date`, `status`.
3.  **Plans:** `id`, `name` (Basic, Pro, Enterprise), `msg_limit_monthly`, `ai_model_config`.
4.  **WhatsAppConfigs:** `tenant_id`, `meta_phone_id`, `meta_access_token`, `waba_id`.
5.  **MessageLogs:** `id`, `tenant_id`, `direction` (in/out), `status`, `cost_calc`.

---

## 2. Scope of Work (نطاق العمل)

### Phase 1: The Multi-Tenant Core (الأساس)
*   **Database Migration:** إعداد قاعدة البيانات وربطها بـ Node.js باستخدام ORM مثل Prisma أو Sequelize.
*   **Authentication Layer:** تعديل الـ Auth بحيث يتم التعرف على المتجر ليس فقط عند الدخول، بل عند استقبال أي Webhook (ربط `merchant_id` القادم من سلة بالسجل الخاص به في قاعدتنا).

### Phase 2: Meta Cloud API Integration (واتساب الرسمي)
*   بناء `WhatsAppService` جديد يتحدث مع Meta Graph API.
*   إنشاء Webhook Endpoint لاستقبال رسائل واتساب (يختلف عن ويب هوك سلة).
*   **Context Isolation:** التأكد من أنه عندما تصل رسالة واتساب، نعرف لأي متجر تتبع بناءً على `phone_number_id` وتوجيهها للـ AI الخاص بذلك المتجر.

### Phase 3: Plans & Limits Engine (محرك الباقات)
*   بناء **Middleware** بسيط: قبل إرسال أي رسالة AI، يقوم بفحص:
    1.  هل اشتراك المتجر فعال؟
    2.  هل تجاوز حد الرسائل هذا الشهر؟
*   إذا `نعم` -> أرسل.
*   إذا `لا` -> توقف وسجل السبب.

### Phase 4: Management Dashboard (لوحة الإدارة)
*   صفحة إعدادات لكل تاجر لربط حساب Meta الخاص به (إدخال Token & Phone ID).
*   عرض "شريط استهلاك" (Progress Bar) لعدد الرسائل المستخدمة vs المتاحة.

---

## 3. Timeline (الجدول الزمني التقديري)

بافتراض وجود مطور Full-stack واحد متفرغ:

| الأسبوع | التركيز | المخرجات |
| :--- | :--- | :--- |
| **Week 1** | **Database & Auth** | قاعدة بيانات جاهزة، تسجيل دخول ومزامنة بيانات التاجر من سلة. |
| **Week 2** | **Meta API Integration** | إرسال واستقبال رسائل عبر API الرسمي، وعزل البيانات لكل متجر. |
| **Week 3** | **Logic & Limits** | دمج الـ AI مع النظام الجديد، وتفعيل قيود الباقات. |
| **Week 4** | **Dashboard & Testing** | واجهة الإعدادات، واختبارات الحمل (Stress Testing). |

---

## 4. Operational Costs (تقدير التكلفة التشغيلية)

هذه ليست تكلفة التطوير، بل تكلفة تشغيل البنية التحتية (Infrastructure):
1.  **Server (VPS/Cloud):** حوالي $20 - $40 / شهرياً (لبداية تدعم 50-100 متجر).
2.  **Database (Managed DB):** حوالي $15 - $30 / شهرياً.
3.  **Redis:** حوالي $10 / شهرياً.
4.  **Meta Conversation Costs:** تدفع لشركة Meta مباشرة. (أول 1000 محادثة شهرياً مجانية لكل رقم، بعدها بضع سنتات للمحادثة).
5.  **OpenAI API:** حسب الاستهلاك (Pay as you go).

**Development Steps to Start:**
1.  Setup MySQL/PostgreSQL locally.
2.  Install Prisma (ORM).
3.  Refactor `app.js` to separate routes per functionality.
