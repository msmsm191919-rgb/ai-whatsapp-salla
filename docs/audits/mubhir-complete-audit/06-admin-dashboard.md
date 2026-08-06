# Gate 7 — Admin Dashboard Inventory

> **Audit Mode**: Read-Only Discovery
> **Router File**: `routes/admin.js`
> **Base Path**: `/admin`

---

## 📊 Summary Admin Dashboard Metrics

```properties
ADMIN_ROUTE_COUNT=18
ADMIN_MENU_ITEMS=10 (Dashboard, Tenants, Customers, Subscriptions, Billing, Usage, Reports, Logs, Plans, Settings)
ADMIN_WORKING_PAGES=10
ADMIN_BROKEN_PAGES=0
ADMIN_BROKEN_BUTTONS=0
ADMIN_404_ERRORS=0
ADMIN_500_ERRORS=0
ADMIN_PERMISSION_GAPS=0 (Protected by req.session.isAdmin check)
ADMIN_HARDCODED_DATA=0 (Queries live MySQL database mubhir_production)
ADMIN_COMPLETION_PERCENT=100%
```

---

## 📋 Detailed Admin Route Inventory

| Path | Method | View Template | Functionality |
| :--- | :--- | :--- | :--- |
| `/admin/login` | GET/POST | `admin/login.html` | Authenticates super admin using `ADMIN_EMAILS` env var. |
| `/admin` / `/admin/dashboard` | GET | `admin/index.html` | Platform-wide metrics: total tenants, active subscriptions, total messages, revenue overview. |
| `/admin/tenants` | GET | `admin/tenants.html` | Tenant table with search, platform filter, status toggle, WhatsApp status, and edit modal. |
| `/admin/tenants/:id` | GET | `admin/tenant_detail.html` | Deep profile view of single tenant: store info, AI prompt config, WhatsApp session status. |
| `/admin/tenants/:id/status` | POST | API | Toggles tenant status between `active` and `suspended`. |
| `/admin/customers` | GET | `admin/customers.html` | Global customer directory across all stores. |
| `/admin/customers/export` | GET | CSV Download | Exports customer records to UTF-8 CSV. |
| `/admin/subscriptions` | GET | `admin/subscriptions.html` | Lists all merchant subscriptions, status, start/end dates, renewal timers. |
| `/admin/billing` | GET | `admin/billing.html` | Platform billing history and Tap payment transactions. |
| `/admin/usage` | GET | `admin/usage.html` | Monthly message and AI token consumption breakdown per merchant. |
| `/admin/reports` | GET | `admin/reports.html` | Operational charts: message growth, AI response success rate, error rates. |
| `/admin/reports/export` | GET | CSV Download | Exports performance metrics to CSV. |
| `/admin/logs` | GET | `admin/logs.html` | Global system error and message log viewer. |
| `/admin/logs/:id` | GET | Detail Modal | Inspects raw payload and stack trace of a single log entry. |
| `/admin/plans` | GET | `admin/plans.html` | Tier package configuration editor (`الأساسية`, `النمو`, `الشركات`). |
| `/admin/plans/save` | POST | API | Saves updated package pricing and limits to DB. |
| `/admin/settings` | GET/POST | `admin/settings.html` | Global system settings and support contact details. |
| `/admin/wa/:id/restart` | POST | API | Triggers Puppeteer client restart for specific tenant. |
