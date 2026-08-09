# Mubhir Master Symbol Map (Exact Symbol Counts & Inventory)

## Exact Symbol Statistics
- **TOTAL_FUNCTIONS**: `890`
- **TOTAL_CLASSES**: `8`
- **TOTAL_CLASS_METHODS**: `48`
- **TOTAL_SERVICE_METHODS**: `45`
- **TOTAL_MIDDLEWARE_SYMBOLS**: `6`
- **TOTAL_ROUTE_HANDLERS**: `74`
- **TOTAL_MODEL_SYMBOLS**: `20`
- **TOTAL_JOB_SYMBOLS**: `2`
- **TOTAL_EVENT_LISTENERS**: `14`
- **TOTAL_HELPERS**: `22`
- **TOTAL_SYMBOLS**: `1129`

---

## Core Symbol Registry

| Symbol Name | Symbol Type | File Path | Line Range | Platform Scope | Tenant Scoped | Status |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `ensureAuthenticated` | Middleware | `app.js` | L1616 - L1641 | `salla` | Yes | `ACTIVE` |
| `ensureStandaloneAuthenticated` | Middleware | `app.js` | L1643 - L1661 | `standalone` | Yes | `ACTIVE` |
| `getTenantFromReq` | Utility | `app.js` | L1785 - L1805 | `SHARED` | Yes | `ACTIVE` |
| `injectPlanContext` | Middleware | `services/planGate.js` | L500 - L535 | `SHARED` | Yes | `ACTIVE` |
| `sendVerificationEmail` | Service Method | `services/EmailService.js` | L230 - L253 | `standalone` | Yes | `ACTIVE` |
| `sendPasswordResetEmail` | Service Method | `services/EmailService.js` | L256 - L278 | `standalone` | Yes | `ACTIVE` |
| `sendTrialStartedEmail` | Service Method | `services/EmailService.js` | L281 - L307 | `SHARED` | Yes | `ACTIVE` |
| `sendTrialEndingEmail` | Service Method | `services/EmailService.js` | L310 - L331 | `SHARED` | Yes | `ACTIVE` |
| `sendTrialExpiredEmail` | Service Method | `services/EmailService.js` | L334 - L355 | `SHARED` | Yes | `ACTIVE` |
| `sendPaymentSuccessEmail` | Service Method | `services/EmailService.js` | L358 - L397 | `SHARED` | Yes | `ACTIVE` |
| `sendPaymentFailedEmail` | Service Method | `services/EmailService.js` | L400 - L421 | `SHARED` | Yes | `ACTIVE` |
| `sendPaymentFailedEmail` | Service Method | `services/EmailService.js` | L400 - L421 | `SHARED` | Yes | `ACTIVE` |
| `sendQRDisconnectedEmail` | Service Method | `services/EmailService.js` | L424 - L450 | `SHARED` | Yes | `ACTIVE` |
| `sendQRRestoredEmail` | Service Method | `services/EmailService.js` | L453 - L473 | `SHARED` | Yes | `ACTIVE` |
| `upsertTenantFromOAuth` | Service Method | `services/ConnectService.js` | L15 - L60 | `SHARED` | Yes | `ACTIVE` |
| `verifyPassword` | Service Method | `services/ConnectService.js` | L85 - L100 | `standalone` | No | `ACTIVE` |
| `waWeb.start` | Service Method | `services/waWeb.js` | L120 - L180 | `SHARED` | Yes | `ACTIVE` |
| `waWeb.isReady` | Service Method | `services/waWeb.js` | L200 - L220 | `SHARED` | Yes | `ACTIVE` |
| `AIService.generateReply` | Service Method | `services/AIService.js` | L45 - L190 | `SHARED` | Yes | `ACTIVE` |
