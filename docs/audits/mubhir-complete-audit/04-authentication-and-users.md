# Gate 2 & 3 — Authentication, User Roles & Login Routes

> **Audit Mode**: Read-Only Discovery

---

## 👥 Discovered User Roles & Account Types

```properties
USER_TYPES=Salla Merchant, Standalone Merchant, System Admin, Demo Merchant
ROLE_TYPES=merchant, admin, superadmin
AUTHENTICATION_METHODS=Salla OAuth2, Standalone Direct Connect, Admin Password
LOGIN_ROUTES=/login, /connect/standalone, /admin/login
LOGOUT_ROUTES=/logout, /admin/logout
PASSWORD_RESET_AVAILABLE=NO (Managed externally by Salla for Salla merchants)
EMAIL_VERIFICATION_AVAILABLE=NO (Relying on platform OAuth / Standalone Direct)
EMAIL_OTP_AVAILABLE=NO (Delegated to Salla Platform Auth)
OTP_REQUIRED_ON_EVERY_LOGIN=NO (Salla OAuth handles OTP when required)
NEW_DEVICE_VERIFICATION_AVAILABLE=NO
TWO_FACTOR_AUTH_AVAILABLE=NO
SESSION_EXPIRY_POLICY=Rolling session (7 days default in Express-Session)
LOGIN_RATE_LIMITING=YES (express-rate-limit enabled on auth routes)
ACCOUNT_LOCKOUT=NO
CSRF_PROTECTION=Session state matching on OAuth callback
LOGIN_BYPASS_ROUTES=PERMANENTLY_DISABLED (/login/bypass returns 403 Forbidden)
DEMO_ACCOUNT_ROUTES=/simulator, /whatsapp-simulator
IMPERSONATION_AVAILABLE=NO
```

---

## 🔍 Detailed Login Route Audit

### 1. `/login` & `/oauth/redirect`
- **Method**: `GET`
- **Middleware**: `passport.authenticate('salla')`
- **Target User**: Salla Merchants (`platform: 'salla'`)
- **Flow**: Generates OAuth state, redirects to Salla authorization URL (`https://accounts.salla.sa/login`).
- **Post-Login Redirect**: `/dashboard?welcome=0` via `/oauth/salla/callback`.

### 2. `/connect/standalone`
- **Method**: `POST`
- **Middleware**: JSON parser, `express-rate-limit`
- **Target User**: Standalone Merchants (`platform: 'standalone'`)
- **Input Data**: `{ store_name, email, phone }`
- **Flow**: Calls `StandaloneAdapter` → `ConnectService.upsertTenantFromOAuth` → Resolves/creates Tenant (e.g. Tenant 41 for "محتوى بلس") → Calls `req.login(userSession)` → Returns `{ ok: true, redirect: '/dashboard?welcome=1&platform=standalone' }`.
- **Security Check**: Allows instant direct dashboard access for standalone merchant profiles without requiring Salla App Store approval.

### 3. `/admin/login`
- **Method**: `GET` / `POST`
- **Middleware**: Session Auth & `ADMIN_EMAILS` check
- **Target User**: Super Admin (`msmsm191919@gmail.com`)
- **Flow**: Validates admin credentials against `process.env.ADMIN_EMAILS`, sets `req.session.isAdmin = true`.
