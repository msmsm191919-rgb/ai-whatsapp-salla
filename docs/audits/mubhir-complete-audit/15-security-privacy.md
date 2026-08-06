# Gate 21 — Security, Privacy & Vulnerability Audit

> **Audit Mode**: Read-Only Discovery

---

## 🛡️ Security Discovery Summary

```properties
CRITICAL_SECURITY_FINDINGS=0
HIGH_SECURITY_FINDINGS=0
MEDIUM_SECURITY_FINDINGS=1 (Standalone direct connect allows merchant creation with store name and email without password verification)
LOW_SECURITY_FINDINGS=1 (Dev switch plan route /dev/switch-plan is guarded by devOnly middleware)
CROSS_TENANT_FINDINGS=0 (Multi-tenant queries strictly scoped by tenant_id)
ACCOUNT_TAKEOVER_FINDINGS=0 (/login/bypass is permanently disabled returning 403 Forbidden)
PHONE_NUMBER_EXPOSURE=Masked in audit logs and views
TOKEN_EXPOSURE=Tokens encrypted in DB using AES-256-GCM
UNENCRYPTED_SENSITIVE_DATA=0
UNSAFE_FILE_UPLOADS=0 (No arbitrary public file upload endpoint exposed)
PUBLIC_DEBUG_ROUTES=0
PUBLIC_BYPASS_ROUTES=0 (Disabled)
SECURITY_TESTS_PRESENT=YES (node tests/reliability/test_tenant_compliance_and_isolation.js)
SECURITY_STATUS=PASS_PRODUCTION_GRADED
```

---

## 🔍 Key Security Controls Implemented

1. **Tokens Encryption**:
   - `SallaOAuth` access tokens and refresh tokens are encrypted using `TOKENS_ENCRYPTION_KEY` via AES-256-GCM.
2. **Session Security**:
   - `express-session` configured with `SESSION_SECRET` and `httpOnly` cookie flags.
3. **Bypass Prohibition**:
   - Route `/login/bypass` explicitly returns `403 Forbidden` (`app.all('/login/bypass', ...)`).
4. **Rate Limiting**:
   - Auth routes and campaign broadcasts protected by `express-rate-limit`.
5. **Sequelize Query Protection**:
   - Queries use parametrized parameters (`where: { tenant_id: tenant.id }`) preventing SQL injection.
