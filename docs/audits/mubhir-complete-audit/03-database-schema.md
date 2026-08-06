# Gate 5 — Database Schema & Data Dictionary

> **Audit Mode**: Read-Only Discovery
> **Engine**: MySQL (`mubhir_production` on Production VPS)

---

## 📊 Database Metrics Summary

```properties
DATABASE_TABLE_COUNT=14
DATABASE_MODEL_COUNT=11
TABLES_WITH_TENANT_ID=10 (Subscriptions, WhatsAppConfigs, MessageLogs, Customers, Campaigns, Carts, SallaOAuth, WebhookEvents, UsageCounters, Payments)
TABLES_WITHOUT_TENANT_ID=4 (Tenants, Plans, AiUsageLogs, SequelizeMeta)
ORPHAN_RECORDS=0
DUPLICATE_TENANTS=4 (Tenant 13, Tenant 41, Tenant 44, Tenant 45 for 'محتوى بلس')
BROKEN_FOREIGN_KEYS=0
MISSING_INDEXES=0
SENSITIVE_FIELDS_UNENCRYPTED=0 (Access tokens encrypted via TOKENS_ENCRYPTION_KEY AES-256-GCM)
AUDIT_LOG_AVAILABLE=YES (MessageLogs, WebhookEvents, UsageCounters)
EMAIL_VERIFICATION_TABLE=NO (Built-in via Salla OAuth / Standalone Direct)
OTP_TABLE=NO (Handled externally by Salla Auth)
NOTIFICATION_TABLE=NO (Logged in MessageLogs)
```

---

## 🗄️ Detailed Table Inventory

| Table Name | Primary Key | Foreign Keys | `tenant_id` Field | Production Record Count | Core Purpose |
| :--- | :--- | :--- | :---: | :---: | :--- |
| **`Tenants`** | `id` (INT) | None | N/A (Is Tenant) | 45 | Stores merchant store profile, platform, domain, status, and JSON settings. |
| **`Subscriptions`** | `id` (INT) | `tenant_id`, `plan_id` | YES | 45 | Tracks active merchant plan subscription, status (`trial`/`active`/`expired`), start/end dates. |
| **`Plans`** | `id` (INT) | None | NO | 3 | Defines platform tier packages: `الأساسية` (49 SAR), `النمو` (149 SAR), `الشركات` (299 SAR). |
| **`WhatsAppConfigs`** | `id` (INT) | `tenant_id` | YES | 1 | Stores primary and extra WhatsApp phone numbers, WABA IDs, access tokens. |
| **`MessageLogs`** | `id` (INT) | `tenant_id` | YES | 83 | Audits all inbound and outbound WhatsApp messages, timestamps, and delivery statuses. |
| **`Customers`** | `id` (INT) | `tenant_id` | YES | 3 | Customer directory per store: phone number, name, email, metadata. |
| **`Campaigns`** | `id` (INT) | `tenant_id` | YES | 2 | WhatsApp marketing broadcast campaign records and execution stats. |
| **`Carts`** | `id` (INT) | `tenant_id` | YES | 0 | Abandoned shopping cart tracking and recovery status. |
| **`SallaOAuth`** | `id` (INT) | `tenant_id` | YES | 29 | Encrypted OAuth access tokens, refresh tokens, and expiration timestamps for Salla stores. |
| **`WebhookEvents`** | `id` (INT) | `tenant_id` | YES | 22 | Incoming webhook payload audit log from Salla and Meta. |
| **`UsageCounters`** | `id` (INT) | `tenant_id` | YES | 2 | Monthly usage quota counter (messages sent, AI replies, period key `YYYY-MM`). |
| **`Payments`** | `id` (INT) | `tenant_id`, `plan_id` | YES | 0 | Tap payment transaction history and invoices. |
| **`ai_usage_logs`** | `id` (INT) | `tenant_id` | YES | 0 | Detailed OpenAI API token usage and cost accounting. |
| **`SequelizeMeta`** | `name` (VARCHAR) | None | NO | 1 | Sequelize database migration execution tracker. |

---

## 🔒 Encryption & Data Safety
- Access tokens inside `SallaOAuth` and `WhatsAppConfigs` are encrypted using AES-256-GCM (`TOKENS_ENCRYPTION_KEY`).
- Session cookies use `SESSION_SECRET`.
