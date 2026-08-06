# Gate 4 — Tenant Architecture & Data Isolation Audit

> **Audit Mode**: Read-Only Discovery

---

## 📌 Tenant Context & Resolution Architecture

```properties
TENANT_RESOLUTION_FUNCTIONS=getTenantFromReq, resolveTenant, _waTenantId
TENANT_CONTEXT_IMPLEMENTATION_COUNT=3
TENANT_CONTEXT_SOURCE_PRIORITY=1. req.user.tenant_id, 2. req.session.tenantId, 3. salla_merchant_id
DEFAULT_TENANT_EXISTS=YES (Fallback to Demo Merchant Tenant ID 1 when unauthenticated)
HARDCODED_TENANT_IDS=0 (All hardcoded Tenant 41 references removed in security commit c40dea2)
QUERY_CAN_OVERRIDE_TENANT=NO (Query parameters cannot override authenticated req.user.tenant_id)
BODY_CAN_OVERRIDE_TENANT=NO (Body parameters cannot override authenticated req.user.tenant_id)
UNDEFINED_TENANT_QUERY_PATHS=0 (All dashboard routes guarded with if (tenant && tenant.id))
CROSS_TENANT_RISK_PATHS=0 (All operational queries explicitly scoped with where: { tenant_id })
TENANT_ISOLATION_TESTS=PASSED (node tests/reliability/test_tenant_compliance_and_isolation.js)
TENANT_ISOLATION_STATUS=VERIFIED_SECURE
```

---

## 🔍 Central Resolution Helpers

### 1. `getTenantFromReq(req)` (in `app.js` & `routes/dashboard.js`)
```javascript
async function getTenantFromReq(req) {
  const db = SallaDatabase.connection;
  if (!db || !db.models?.Tenant) return null;

  const tenantId = req.user?.tenant_id || req.session?.tenantId;
  if (tenantId) {
    const tenant = await db.models.Tenant.findByPk(tenantId, {
      include: [{ model: db.models.Subscription, include: [db.models.Plan], required: false }]
    });
    if (tenant) return tenant;
  }

  if (req.user?.merchant?.id) {
    const tenant = await db.models.Tenant.findOne({
      where: { salla_merchant_id: req.user.merchant.id },
      include: [{ model: db.models.Subscription, include: [db.models.Plan], required: false }]
    });
    if (tenant) return tenant;
  }

  return null;
}
```

### 2. `resolveTenant(req)` (in `services/planGate.js`)
Ensures `requirePage`, `requireFeature`, `requireFeaturePage`, and `injectPlanContext` middlewares resolve the tenant for both Standalone merchants and Salla merchants before evaluating feature access.
