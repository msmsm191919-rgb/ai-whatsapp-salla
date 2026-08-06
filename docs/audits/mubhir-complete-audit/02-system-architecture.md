# Gate 1 & 2 — System Architecture & Codebase Map

> **Audit Mode**: Read-Only Discovery

---

## 📁 Directory Structure & Component Map

| Directory / File | Core Purpose | Key Files | Unused / Backup / Notes |
| :--- | :--- | :--- | :--- |
| **`app.js`** | Primary application entry point, Express configuration, session handling, core routes, and server boot. | `app.js` (3,450 lines) | Contains inline backup routes from early iterations. |
| **`routes/`** | Router modules split by functional responsibility. | `dashboard.js`, `api.js`, `admin.js` | 3 active router files handling sub-routes. |
| **`services/`** | Business logic, integrations, AI engine, plan gating, and WhatsApp service. | `waWeb.js`, `AIService.js`, `PromptManager.js`, `planGate.js`, `ConnectService.js`, `HandoffService.js` | Contains 28 service files. |
| **`adapters/`** | Multi-platform OAuth adapters. | `SallaAdapter.js`, `StandaloneAdapter.js`, `PlatformRegistry.js` | `ZidAdapter.js` and `ShopifyAdapter.js` are disabled. |
| **`database/`** | Database connection instance, Sequelize models, and seeds. | `db_instance.js`, `config.js`, `index.js`, models | Contains SQLite fallback files for local dev. |
| **`models/`** | Sequelize model definitions. | `Tenant.js`, `Subscription.js`, `Plan.js`, `MessageLog.js`, `Customer.js`, `Campaign.js`, `Cart.js`, `WhatsAppConfig.js`, `SallaOAuth.js`, `UsageCounter.js`, `Payment.js` | 11 core Sequelize models. |
| **`views/`** | Nunjucks HTML templates for client and admin dashboards. | `dashboard.html`, `whatsapp_web.html`, `campaigns.html`, `scenarios.html`, `pricing.html`, `billing.html`, `logs.html`, `standalone_signup.html`, `admin/*.html` | 42 HTML view templates. |
| **`public/`** | Static assets (CSS, JS, images, icons). | `css/`, `js/`, `images/` | Tailwind/Vanilla CSS & JS bundles. |
| **`jobs/`** | Background jobs and automation schedulers. | `scheduler.js`, `cartRecoveryJob.js`, `orderStatusJob.js` | Internal `setInterval` runners. |
| **`tests/`** | Automated unit, integration, and reliability test suites. | `reliability/`, `security/`, `unit/` | 251 test files and scratch suites. |
| **`docs/`** | Project documentation and audit reports. | `audits/`, `LAUNCH_FREEZE.md` | Contains past audit logs. |
| **`backups/`** | Legacy file snapshots. | `app.js.security_backup` | Preserved for rollback safety. |
| **`.wwebjs_auth/`** | Persistent WhatsApp Puppeteer session directories. | `session-41`, `session-13` | Production session storage. |

---

## 📊 Summary Codebase Metrics

```properties
TOTAL_SOURCE_FILES=1886
TOTAL_ROUTE_FILES=4 (app.js + 3 in routes/)
TOTAL_SERVICE_FILES=28
TOTAL_MODEL_FILES=11
TOTAL_VIEW_FILES=42
TOTAL_TEST_FILES=251
UNTRACKED_FILES=12 (Local scratch/utility scripts)
DUPLICATE_FILES=4 (Duplicate fallback files in backups/)
DEAD_OR_UNUSED_FILES=8 (Disabled Zid/Shopify adapters & legacy views)
SENSITIVE_FILES_FOUND=2 (.env, .env.production)
HARDCODED_SECRET_LOCATIONS=0 (All secrets loaded via process.env)
```
