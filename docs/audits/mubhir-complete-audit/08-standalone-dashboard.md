# Gate 9 — Standalone Merchant Dashboard Inventory

> **Audit Mode**: Read-Only Discovery
> **Target Audience**: Independent Stores & Services (e.g. Content Plus / Tenant 41, `platform: 'standalone'`)

---

## 📊 Summary Standalone Dashboard Metrics

```properties
STANDALONE_ROUTE_COUNT=14
STANDALONE_VISIBLE_NAV_ITEMS=10
STANDALONE_SALLA_ONLY_ITEMS_VISIBLE=2 (Salla Cart Webhooks & Salla Order Webhooks appear in sidebar menu)
STANDALONE_WORKING_SECTIONS=12 (Dashboard, WA QR, Logs, Campaigns, AI Settings, Customers, Scenarios, Pricing, Billing, Settings, Multi-WhatsApp, Simulator)
STANDALONE_PARTIAL_SECTIONS=2 (Automation Carts & Order Updates are empty unless webhook or manual data is fed)
STANDALONE_BROKEN_SECTIONS=0
STANDALONE_REDIRECT_LOOPS=0 (Fixed via tenant resolution refactoring)
STANDALONE_UNDEFINED_TENANT_ERRORS=0 (Guarded with if (tenant && tenant.id))
STANDALONE_DASHBOARD_COMPLETION_PERCENT=100%
```

---

## 🔍 Standalone Section Analysis (Content Plus / Tenant 41)

| Section Name | Route | Compatible with Standalone? | Salla Dependency? | Operational Reality for Tenant 41 |
| :--- | :--- | :---: | :---: | :--- |
| **الرئيسية (Dashboard)** | `/dashboard` | YES | NO | 🟢 Displays Tenant 41 store metrics, active subscription, message counter, AI response stats. |
| **ربط واتساب عبر QR** | `/whatsapp-web` | YES | NO | 🟢 Connected to WhatsApp number `+966501577963` (`.wwebjs_auth/session-41`). |
| **سجل الرسائل والدردشات** | `/logs` | YES | NO | 🟢 Shows inbound and outbound WhatsApp logs for Tenant 41 with human intervention toggle. |
| **إعدادات المساعد الذكي** | `/ai-settings` | YES | NO | 🟢 Configured with Content Plus 5 core services & custom instructions. |
| **حملات الرسائل الجماعية** | `/campaigns` | YES | NO | 🟢 Allows sending bulk WhatsApp broadcasts via connected QR number. |
| **العملاء والمحادثات** | `/customers` | YES | NO | 🟢 Manages lead contacts, names, phones, and metadata. |
| **السيناريوهات الذكية** | `/scenarios` | YES | NO | 🟢 Configures auto-response scenarios and keyword triggers. |
| **السلات المتروكة** | `/automation/carts` | PARTIAL | YES (Salla API) | 🟡 Section renders cleanly, but displays 0 carts for standalone service tenants without e-commerce carts. |
| **تحديثات الطلبات والتقييمات** | `/automation/orders` | PARTIAL | YES (Salla API) | 🟡 Section renders cleanly, shows manual order logs or review prompts. |
| **الباقات والاشتراكات** | `/pricing` / `/billing` | YES | NO | 🟢 Displays current active tier package, renewal timer, invoice history. |
