# SaaS Database Schema Proposal

## 1. Core Concept: Tenant Isolation
*   **TenantID Definition:** `TenantID` هو المعرف الداخلي (Primary Key) في جدول `Tenants`.
*   **Mapping:** سيتم ربط `merchant_id` القادم من سلة (مثل `12345678`) بـ `TenantID` الداخلي الخاص بنا.
*   **Isolation Strategy:** كل جدول "تابع" (Logs, Tokens, Configs) **يجب** أن يحتوي على عمود `tenant_id`. أي استعلام (Query) للنظام **يجب** أن يتضمن شرط `WHERE tenant_id = X`.

---

## 2. Entity Relationship Diagram (ERD) Structure

سنقوم بإنشاء الجداول الستة التالية. الأسهم (->) تشير للعلاقات.

### A. `Tenants` (The Stores)
الجدول الرئيسي. يمثل "المتجر" المسجل لدينا.
*   `id` (INT, PK, Auto Increment) **[هذا هو TenantID]**
*   `salla_merchant_id` (BIGINT, Unique, Indexed) -> *رقم المتجر في سلة*
*   `store_name` (STRING)
*   `store_domain` (STRING)
*   `email` (STRING) -> *للتواصل والفواتير*
*   `created_at`

### B. `Plans` (System Configuration)
جدول ثابت (Lookup Table) نعرف فيه الباقات.
*   `id` (INT, PK)
*   `name` (STRING) -> *Examples: "Basic", "Growth", "Enterprise"*
*   `monthly_msg_limit` (INT) -> *سقف الرسائل*
*   `price_monthly` (DECIMAL)
*   `ai_model_config` (JSON) -> *تخصيص الـ AI لكل باقة*

### C. `Subscriptions` (Billing State)
يربط المتجر بالباقة.
*   `id` (INT, PK)
*   `tenant_id` (INT, FK -> Tenants.id)
*   `plan_id` (INT, FK -> Plans.id)
*   `status` (ENUM: 'active', 'expired', 'trial')
*   `current_period_start` (DATETIME)
*   `current_period_end` (DATETIME)
*   `usage_counter` (INT) -> *عدد الرسائل المستهلكة هذا الشهر*

### D. `WhatsAppConfigs` (Meta Integration)
بيانات ربط واتساب API لكل متجر.
*   `id` (INT, PK)
*   `tenant_id` (INT, FK -> Tenants.id)
*   `phone_number_id` (STRING, Indexed) -> *من Meta، نستخدمه لفرز الرسائل الواردة*
*   `waba_id` (STRING) -> *WhatsApp Business Account ID*
*   `access_token` (TEXT) -> *Permanent Token*

### E. `SallaOAuth` (Authentication)
التوكن لكي نتحدث مع متجر سلة (قراءة الطلبات/المنتجات).
*   `id` (INT, PK)
*   `tenant_id` (INT, FK -> Tenants.id)
*   `access_token` (TEXT)
*   `refresh_token` (TEXT)
*   `expires_in` (DATETIME)

### F. `MessageLogs` (Audit & Usage)
سجل دقيق لكل رسالة لغرض المحاسبة والمراجعة.
*   `id` (BIGINT, PK)
*   `tenant_id` (INT, FK -> Tenants.id)
*   `salla_order_id` (STRING, Nullable) -> *لربط الرسالة بطلب معين*
*   `direction` (ENUM: 'inbound', 'outbound')
*   `status` (ENUM: 'sent', 'delivered', 'read', 'failed')
*   `cost_units` (INT) -> *لحساب التكلفة إذا أردنا تعقيداً مستقبلاً*

---

## 3. Implementation Workflow

1.  **Init:** إنشاء هذه الجداول في MySQL.
2.  **Mapping Logic:** تعديل كود `SallaAPI.onAuth` ليقوم بـ:
    *   البحث عن `salla_merchant_id`.
    *   غير موجود؟ -> إنشاء سجل في `Tenants`.
    *   موجود؟ -> تحديث التوكن في `SallaOAuth`.
3.  **Webhook Handling:**
    *   عند وصول Webhook -> استخراج `merchant_id` -> البحث عن `TenantID`.
    *   تمرير `TenantID` لكل الوظائف اللاحقة (AI, WhatsApp).
