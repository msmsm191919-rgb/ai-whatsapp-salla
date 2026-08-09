# Mubhir Master File Classification Inventory

| File Path | Category | Platform Scope | Active Status | Description / Responsibility |
| :--- | :--- | :--- | :--- | :--- |
| `app.js` | `INFRASTRUCTURE` | `SHARED` | `ACTIVE` | Master Express application entry point, session middleware, Passport authentication, and central route mounts. |
| `routes/dashboard.js` | `SHARED` | `SALLA` | `ACTIVE` | Handler for Salla `/dashboard` route with platform guard redirecting standalone merchants to `/standalone/dashboard`. |
| `routes/api.js` | `SHARED` | `SHARED` | `ACTIVE` | Core REST API endpoints for messages, campaigns, customer management, AI settings, and simulator. |
| `routes/settings.js` | `SHARED` | `SHARED` | `ACTIVE` | Settings endpoints for WhatsApp, general store configuration, and AI settings. |
| `routes/admin.js` | `ADMIN_ONLY` | `ADMIN` | `ACTIVE` | Independent Admin panel routing (/admin/login, /admin/dashboard, merchant details, audit logs). |
| `services/EmailService.js` | `SHARED` | `SHARED` | `ACTIVE` | Transactional email layout engine and platform-aware email dispatch service. |
| `services/waWeb.js` | `SHARED` | `SHARED` | `ACTIVE` | WhatsApp Web.js client instance manager, session initialization, QR generation, and state tracking. |
| `services/AIService.js` | `SHARED` | `SHARED` | `ACTIVE` | AI prompt construction, knowledge base context injection, GPT-4o-mini invocation, and handoff rules. |
| `services/planGate.js` | `SHARED` | `SHARED` | `ACTIVE` | Single Source of Truth for commercial plan definitions (Basic, Growth, Enterprise) and feature limits. |
| `services/ConnectService.js` | `SHARED` | `SHARED` | `ACTIVE` | OAuth token exchange, tenant upserting, password verification, and credential security. |
| `database/db_instance.js` | `INFRASTRUCTURE` | `SHARED` | `ACTIVE` | Centralized Sequelize database instance connection and model associations. |
| `views/dashboard.html` | `SALLA_ONLY` | `SALLA` | `ACTIVE` | Dashboard view tailored for Salla merchants (includes abandoned cart & order status metrics). |
| `views/standalone_dashboard.html` | `STANDALONE_ONLY` | `STANDALONE` | `ACTIVE` | Dedicated dashboard view for Standalone merchants (clean SaaS metrics, no Salla branding). |
| `views/layouts/dashboard_master.html` | `SALLA_ONLY` | `SALLA` | `ACTIVE` | Layout master for Salla merchant views. |
| `views/layouts/standalone_dashboard_master.html` | `STANDALONE_ONLY` | `STANDALONE` | `ACTIVE` | Layout master for Standalone merchant views (Clean SaaS navigation). |
| `views/connect.html` | `PUBLIC` | `SHARED` | `ACTIVE` | Public chooser page for selecting Salla or Standalone connection flows. |
| `views/standalone_signup.html` | `STANDALONE_ONLY` | `STANDALONE` | `ACTIVE` | Native signup interface for Standalone merchants. |
| `views/billing.html` | `SHARED` | `SHARED` | `ACTIVE` | Subscription, billing state, and plan upgrade view. |
| `views/whatsapp_web.html` | `SHARED` | `SHARED` | `ACTIVE` | WhatsApp QR code pairing interface. |
