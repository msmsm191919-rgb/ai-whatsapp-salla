# Mubhir Master Route Matrix (Complete 74 Endpoints Audit)

| # | Method | Endpoint URL | Source File | Auth Guard | Tenant Resolver | Platform Scope | Type | Status |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| 1 | `GET` | `/` | `app.js` | None | None | Public | View | `ACTIVE` |
| 2 | `GET` | `/connect` | `app.js` | None | None | Public | View | `ACTIVE` |
| 3 | `GET` | `/connect/:platform` | `app.js` | None | None | Public | View/Flow | `ACTIVE` |
| 4 | `POST` | `/connect/standalone` | `app.js` | Rate Limit | `ConnectService` | `standalone` | API | `ACTIVE` |
| 5 | `POST` | `/auth/standalone/login` | `app.js` | Rate Limit | Password Verify | `standalone` | API | `ACTIVE` |
| 6 | `GET` | `/auth/standalone/verify-email` | `app.js` | Token | Token Lookup | `standalone` | View/Flow | `ACTIVE` |
| 7 | `POST` | `/auth/standalone/forgot-password` | `app.js` | Rate Limit | Email Lookup | `standalone` | API | `ACTIVE` |
| 8 | `GET` | `/auth/standalone/reset-password` | `app.js` | Token | Token Lookup | `standalone` | View | `ACTIVE` |
| 9 | `POST` | `/auth/standalone/reset-password` | `app.js` | Token | Token Lookup | `standalone` | API | `ACTIVE` |
| 10 | `GET` | `/login` | `app.js` | Salla OAuth | Salla Passport | `salla` | Redirect | `ACTIVE` |
| 11 | `GET` | `/oauth/redirect` | `app.js` | Salla OAuth | Salla Passport | `salla` | Redirect | `ACTIVE` |
| 12 | `GET` | `/oauth/callback` | `app.js` | OAuth State | Salla Passport | `salla` | Redirect | `ACTIVE` |
| 13 | `GET` | `/privacy` | `app.js` | None | None | Public | View | `ACTIVE` |
| 14 | `GET` | `/terms` | `app.js` | None | None | Public | View | `ACTIVE` |
| 15 | `GET` | `/support` | `app.js` | None | None | Public | View | `ACTIVE` |
| 16 | `GET` | `/account` | `app.js` | `ensureAuth` | `tenant_id` | Shared | View | `ACTIVE` |
| 17 | `GET` | `/refreshToken` | `app.js` | `ensureAuth` | `tenant_id` | Shared | API | `ACTIVE` |
| 18 | `GET` | `/orders` | `app.js` | `ensureAuth` | `salla_merchant_id` | `salla` | View | `ACTIVE` |
| 19 | `GET` | `/logout` | `app.js` | None | Session | Shared | Action | `ACTIVE` |
| 20 | `GET` | `/admin/login` | `app.js` | None | Admin Session | Admin | View | `ACTIVE` |
| 21 | `POST` | `/admin/login` | `app.js` | Rate Limit | Admin Verify | Admin | API | `ACTIVE` |
| 22 | `GET` | `/admin/logout` | `app.js` | None | Admin Session | Admin | Action | `ACTIVE` |
| 23 | `GET` | `/standalone/dashboard` | `app.js` | `ensureStandalone` | `tenant_id` | `standalone` | View | `ACTIVE` |
| 24 | `GET` | `/standalone/billing` | `app.js` | `ensureStandalone` | `tenant_id` | `standalone` | View | `ACTIVE` |
| 25 | `GET` | `/standalone/whatsapp-web` | `app.js` | `ensureStandalone` | `tenant_id` | `standalone` | View | `ACTIVE` |
| 26 | `GET` | `/logs` | `app.js` | `ensureAuth` | `tenant_id` | Shared | View | `ACTIVE` |
| 27 | `GET` | `/logs/export` | `app.js` | `ensureAuth` | `tenant_id` | Shared | Download | `ACTIVE` |
| 28 | `GET` | `/settings/whatsapp` | `app.js` | `ensureAuth` | `tenant_id` | Shared | View | `ACTIVE` |
| 29 | `POST` | `/api/whatsapp-numbers` | `app.js` | `ensureAuth` | `tenant_id` | Shared | API | `ACTIVE` |
| 30 | `PUT` | `/api/whatsapp-numbers/:id` | `app.js` | `ensureAuth` | `tenant_id` | Shared | API | `ACTIVE` |
| 31 | `DELETE` | `/api/whatsapp-numbers/:id` | `app.js` | `ensureAuth` | `tenant_id` | Shared | API | `ACTIVE` |
| 32 | `POST` | `/api/whatsapp-numbers/:id/make-primary` | `app.js` | `ensureAuth` | `tenant_id` | Shared | API | `ACTIVE` |
| 33 | `POST` | `/settings/whatsapp` | `app.js` | `ensureAuth` | `tenant_id` | Shared | API | `ACTIVE` |
| 34 | `POST` | `/settings/generate-api-key` | `app.js` | `ensureAuth` | `tenant_id` | Shared | API | `ACTIVE` |
| 35 | `GET` | `/scenarios` | `app.js` | `ensureAuth` | `tenant_id` | Shared | View | `ACTIVE` |
| 36 | `POST` | `/api/scenarios/save` | `app.js` | `ensureAuth` | `tenant_id` | Shared | API | `ACTIVE` |
| 37 | `GET` | `/dev/switch-plan/:plan` | `app.js` | `devOnly` | `tenant_id` | Dev | API | `ACTIVE` |
| 38 | `GET` | `/api/scenarios/trigger/:key` | `app.js` | Key Token | Webhook Lookup | Shared | Webhook | `ACTIVE` |
| 39 | `POST` | `/billing/checkout` | `app.js` | `ensureAuth` | `tenant_id` | Shared | API | `ACTIVE` |
| 40 | `GET` | `/billing/return` | `app.js` | Gateway Token | `tenant_id` | Shared | Redirect | `ACTIVE` |
| 41 | `POST` | `/webhook/tap` | `app.js` | Signature | Provider Payload | Shared | Webhook | `ACTIVE` |
| 42 | `GET` | `/billing` | `app.js` | `ensureAuth` | `tenant_id` | Shared | View | `ACTIVE` |
| 43 | `GET` | `/pricing` | `app.js` | None | None | Public | View | `ACTIVE` |
| 44 | `GET` | `/automation/carts` | `app.js` | `ensureAuth` | `salla_merchant_id` | `salla` | View | `ACTIVE` |
| 45 | `GET` | `/automation/orders` | `app.js` | `ensureAuth` | `salla_merchant_id` | `salla` | View | `ACTIVE` |
| 46 | `GET` | `/campaigns` | `app.js` | `ensureAuth` | `tenant_id` | Shared | View | `ACTIVE` |
| 47 | `GET` | `/campaigns/create` | `app.js` | `ensureAuth` | `tenant_id` | Shared | View | `ACTIVE` |
| 48 | `GET` | `/customers` | `app.js` | `ensureAuth` | `tenant_id` | Shared | View | `ACTIVE` |
| 49 | `GET` | `/whatsapp-web` | `app.js` | `ensureAuth` | `tenant_id` | `salla` | View | `ACTIVE` |
| 50 | `GET` | `/simulator` | `app.js` | None | None | Dev | View | `ACTIVE` |
| 51 | `POST` | `/api/wa-web/start` | `app.js` | `ensureAuth` | `tenant_id` | Shared | API | `ACTIVE` |
| 52 | `GET` | `/api/wa-web/status` | `app.js` | `ensureAuth` | `tenant_id` | Shared | API | `ACTIVE` |
| 53 | `POST` | `/api/wa-web/logout` | `app.js` | `ensureAuth` | `tenant_id` | Shared | API | `ACTIVE` |
| 54 | `POST` | `/api/customers` | `app.js` | `ensureAuth` | `tenant_id` | Shared | API | `ACTIVE` |
| 55 | `DELETE` | `/api/customers/:id` | `app.js` | `ensureAuth` | `tenant_id` | Shared | API | `ACTIVE` |
| 56 | `POST` | `/api/customers/import` | `app.js` | `ensureAuth` | `tenant_id` | Shared | API | `ACTIVE` |
| 57 | `GET` | `/customers/export` | `app.js` | `ensureAuth` | `tenant_id` | Shared | Download | `ACTIVE` |
| 58 | `POST` | `/api/campaigns/send` | `app.js` | `ensureAuth` | `tenant_id` | Shared | API | `ACTIVE` |
| 59 | `GET` | `/settings/ai` | `app.js` | `ensureAuth` | `tenant_id` | Shared | View | `ACTIVE` |
| 60 | `GET` | `/ai-settings` | `app.js` | `ensureAuth` | `tenant_id` | Shared | View | `ACTIVE` |
| 61 | `POST` | `/settings/ai` | `app.js` | `ensureAuth` | `tenant_id` | Shared | API | `ACTIVE` |
| 62 | `POST` | `/test/send-message` | `app.js` | `devOnly` | `tenant_id` | Dev | API | `ACTIVE` |
| 63 | `GET` | `/settings` | `app.js` | `ensureAuth` | `tenant_id` | Shared | View | `ACTIVE` |
| 64 | `POST` | `/api/settings/save` | `app.js` | `ensureAuth` | `tenant_id` | Shared | API | `ACTIVE` |
| 65 | `POST` | `/api/demo/chat` | `app.js` | Rate Limit | Demo Tenant | Public | API | `ACTIVE` |
| 66 | `GET` | `/dashboard` | `routes/dashboard.js` | `ensureAuth` | `tenant_id` / `salla_merchant_id` | `salla` | View | `ACTIVE` |
| 67 | `GET` | `/api/billing/simulate-success` | `routes/api.js` | `devOnly` | `tenant_id` | Dev | API | `ACTIVE` |
| 68 | `GET` | `/api/billing/summary` | `routes/api.js` | `ensureAuth` | `tenant_id` | Shared | API | `ACTIVE` |
| 69 | `POST` | `/api/billing/checkout` | `routes/api.js` | `ensureAuth` | `tenant_id` | Shared | API | `ACTIVE` |
| 70 | `GET` | `/api/conversations/paused` | `routes/api.js` | `ensureAuth` | `tenant_id` | Shared | API | `ACTIVE` |
| 71 | `POST` | `/api/conversations/resume` | `routes/api.js` | `ensureAuth` | `tenant_id` | Shared | API | `ACTIVE` |
| 72 | `GET` | `/api/inbox/conversations` | `routes/api.js` | `ensureAuth` | `tenant_id` | Shared | API | `ACTIVE` |
| 73 | `GET` | `/api/inbox/messages/:phone` | `routes/api.js` | `ensureAuth` | `tenant_id` | Shared | API | `ACTIVE` |
| 74 | `POST` | `/api/inbox/send` | `routes/api.js` | `ensureAuth` | `tenant_id` | Shared | API | `ACTIVE` |
