# Gate 10 — Dashboard Feature Comparison Matrix

> **Audit Mode**: Read-Only Discovery

---

## 📊 Comprehensive Capability Matrix

| Feature | Salla Merchant (`platform: 'salla'`) | Standalone Merchant (`platform: 'standalone'`) | Shared Component? | Platform Specific? | Plan Gated? | Current Route | Backend Dependency | Database Table |
| :--- | :---: | :---: | :---: | :---: | :---: | :--- | :--- | :--- |
| **Main Hero Dashboard** | YES | YES | YES | NO | NO | `/dashboard` | `routes/dashboard.js` | `Tenants`, `Subscriptions`, `UsageCounters` |
| **WhatsApp QR Pairing** | YES | YES | YES | NO | NO | `/whatsapp-web` | `services/waWeb.js` | `WhatsAppConfigs` |
| **AI Assistant Config** | YES | YES | YES | NO | NO | `/ai-settings` | `services/AIService.js` | `Tenants.settings` |
| **Knowledge Base (Custom Text)**| YES | YES | YES | NO | NO | `/ai-settings` | `services/PromptManager.js` | `Tenants.settings` |
| **Message & Chat Logs** | YES | YES | YES | NO | NO | `/logs` | `app.js` | `MessageLogs` |
| **Broadcast Campaigns** | YES | YES | YES | NO | YES (Growth+) | `/campaigns` | `app.js` | `Campaigns`, `Customers` |
| **Customer Directory** | YES | YES | YES | NO | NO | `/customers` | `app.js` | `Customers` |
| **Smart Scenarios** | YES | YES | YES | NO | YES | `/scenarios` | `app.js` | `Tenants.settings` |
| **Abandoned Cart Recovery** | YES | NO (Mock/Empty) | NO | YES (Salla Cart Webhook) | YES (Basic+) | `/automation/carts` | `jobs/cartRecoveryJob.js` | `Carts` |
| **Order Status & Reviews** | YES | NO (Mock/Empty) | NO | YES (Salla Order Webhook) | YES (Basic+) | `/automation/orders` | `jobs/orderStatusJob.js` | `MessageLogs` |
| **Multi-WhatsApp Numbers** | YES | YES | YES | NO | YES (API Access) | `/settings/whatsapp` | `app.js` | `WhatsAppConfigs` |
| **Tier Plans & Pricing** | YES | YES | YES | NO | NO | `/pricing` | `app.js` | `Plans`, `Subscriptions` |
| **Billing & Invoices** | YES | YES | YES | NO | NO | `/billing` | `services/BillingService.js`| `Payments` |
| **WhatsApp Simulator** | YES | YES | YES | NO | NO | `/simulator` | `app.js` | Memory / Mock Engine |

---

## 📈 Platform Distribution Overview

```properties
SHARED_DASHBOARD_PERCENT=85%
SALLA_ONLY_FEATURE_COUNT=2 (Abandoned Carts, Order Status Webhooks)
STANDALONE_ONLY_FEATURE_COUNT=0
CURRENT_UI_BRANCHING_METHOD=Nunjucks conditional rendering & planGate middleware
CAPABILITY_MATRIX_EXISTS=YES
PLATFORM_CHECKS_SCATTERED=NO (Centralized in getTenantFromReq and resolveTenant)
RECOMMENDATION_BLOCKED_UNTIL_AUDIT_COMPLETE=YES
```
