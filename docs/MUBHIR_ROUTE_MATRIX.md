# Mubhir Master Route Matrix

| Method | Endpoint URL | Source File | Auth Guard | Tenant Resolver | Platform | View / Action | Status |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `GET` | `/` | `app.js` | None | Optional | Public | `index.html` (Landing Page) | `ACTIVE` |
| `GET` | `/connect` | `app.js` | None | None | Public | `connect.html` (Platform Chooser) | `ACTIVE` |
| `GET` | `/connect/standalone` | `app.js` | None | None | `standalone` | `standalone_signup.html` | `ACTIVE` |
| `POST` | `/connect/standalone` | `app.js` | Rate Limited | `ConnectService` | `standalone` | Signup & Auto-Login | `ACTIVE` |
| `POST` | `/auth/standalone/login` | `app.js` | Rate Limited | Password Verification | `standalone` | Native Login Session | `ACTIVE` |
| `GET` | `/auth/standalone/verify-email` | `app.js` | Single-use Token | Token lookup | `standalone` | Email Link Verification | `ACTIVE` |
| `GET` | `/auth/standalone/reset-password` | `app.js` | Single-use Token | Token lookup | `standalone` | Password Reset Form | `ACTIVE` |
| `POST` | `/auth/standalone/reset-password` | `app.js` | Token Verification | Token lookup | `standalone` | Update Password Hash | `ACTIVE` |
| `GET` | `/login` | `app.js` | None | None | `salla` | Redirects to Salla OAuth | `ACTIVE` |
| `GET` | `/oauth/callback` | `app.js` | Salla Passport | OAuth Exchange | `salla` | Salla Login Session | `ACTIVE` |
| `GET` | `/dashboard` | `routes/dashboard.js` | `ensureAuthenticated` | `tenant_id` / `salla_merchant_id` | `salla` (Guarded) | `views/dashboard.html` | `ACTIVE` |
| `GET` | `/standalone/dashboard` | `app.js` | `ensureStandaloneAuthenticated` | `tenant_id` | `standalone` | `views/standalone_dashboard.html` | `ACTIVE` |
| `GET` | `/standalone/billing` | `app.js` | `ensureStandaloneAuthenticated` | `tenant_id` | `standalone` | `views/billing.html` | `ACTIVE` |
| `GET` | `/standalone/whatsapp-web` | `app.js` | `ensureStandaloneAuthenticated` | `tenant_id` | `standalone` | `views/whatsapp_web.html` | `ACTIVE` |
| `GET` | `/whatsapp-web` | `app.js` | `ensureAuthenticated` | `tenant_id` | `salla` | `views/whatsapp_web.html` | `ACTIVE` |
| `GET` | `/billing` | `app.js` | `ensureAuthenticated` | `tenant_id` | `salla` | `views/billing.html` | `ACTIVE` |
| `GET` | `/admin/login` | `app.js` | Independent Admin Auth | None | Admin | `admin/login.html` | `ACTIVE` |
| `GET` | `/admin/dashboard` | `routes/admin.js` | `requireAdmin` | Admin Session | Admin | Admin Master Overview | `ACTIVE` |
