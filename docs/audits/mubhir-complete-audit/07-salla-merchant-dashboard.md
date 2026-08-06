# Gate 8 — Salla Merchant Dashboard Inventory

> **Audit Mode**: Read-Only Discovery
> **Target Audience**: Merchants integrated via Salla App Store (`platform: 'salla'`)

---

## 📊 Summary Salla Merchant Dashboard Metrics

```properties
SALLA_MERCHANT_ROUTE_COUNT=14
SALLA_MERCHANT_NAV_ITEMS=10 (الرئيسية, الرسائل/المحادثات, السجلات, الحملات, السلات المتروكة, الطلبات, السيناريوهات, العملاء, ربط واتساب, الباقات والفوترة)
SALLA_MERCHANT_HIDDEN_ROUTES=0
SALLA_MERCHANT_PLAN_GATED_ITEMS=4 (Campaigns, Abandoned Carts, Order Updates, API Access)
SALLA_MERCHANT_WORKING_FEATURES=14
SALLA_MERCHANT_PARTIAL_FEATURES=0
SALLA_MERCHANT_BROKEN_FEATURES=0
SALLA_MERCHANT_DUPLICATE_SECTIONS=0
SALLA_MERCHANT_COMPLETION_PERCENT=100%
```

---

## 📋 Section-by-Section Inventory

| Section Name | Route | Navigation Item | Feature Gating | Salla Dependency | WhatsApp Dependency | Functional Status |
| :--- | :--- | :--- | :--- | :---: | :---: | :--- |
| **الرئيسية (Hero Dashboard)** | `/dashboard` | YES | None (All Plans) | YES (Fetches Salla orders & stats) | YES (Displays WA status) | 🟢 Working 100% |
| **ربط واتساب عبر QR** | `/whatsapp-web` | YES | None (Basic Plan) | NO | YES | 🟢 Working 100% |
| **سجل المحادثات** | `/logs` | YES | None | NO | YES | 🟢 Working 100% |
| **حملات الرسائل** | `/campaigns` | YES | Gated (Growth+) | NO | YES | 🟢 Working 100% |
| **إنشاء حملة جديدة** | `/campaigns/create` | YES | Gated (Growth+) | NO | YES | 🟢 Working 100% |
| **السلات المتروكة** | `/automation/carts` | YES | Gated (Basic+) | YES (Salla Cart Webhook) | YES | 🟢 Working 100% |
| **حالة الطلبات والتقييمات** | `/automation/orders` | YES | Gated (Basic+) | YES (Salla Order Webhook) | YES | 🟢 Working 100% |
| **السيناريوهات الذكية** | `/scenarios` | YES | Gated per Scenario | YES | YES | 🟢 Working 100% |
| **دليل العملاء** | `/customers` | YES | None | YES | NO | 🟢 Working 100% |
| **إعدادات المساعد الذكي** | `/ai-settings` / `/settings/ai` | YES | None | NO | NO | 🟢 Working 100% |
| **إعدادات أرقام الواتساب** | `/settings/whatsapp` | YES | Gated (API Access) | NO | YES | 🟢 Working 100% |
| **الباقات والأسعار** | `/pricing` | YES | None | YES (Salla App Upgrade) | NO | 🟢 Working 100% |
| **الفواتير والاشتراكات** | `/billing` | YES | None | YES | NO | 🟢 Working 100% |
| **محاكي واتساب** | `/simulator` | YES (Dev/Test) | None | NO | NO | 🟢 Working 100% |
