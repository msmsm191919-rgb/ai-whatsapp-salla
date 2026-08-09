# Mubhir System Architecture (Canonical Master Blueprint)

## Executive Overview
Mubhir (مبهر AI) is a single, unified, multi-tenant WhatsApp AI Marketing & Conversational Automation SaaS platform for merchants in Saudi Arabia.

The platform operates on:
- **One Product**
- **One Codebase**
- **One Database**
- **One Tenant Core (`tenant_id`)**
- **One Shared Business Core (AI, WhatsApp, Conversations, Customers, Campaigns, Billing, Email, Reports)**
- **One Independent Admin Panel**

---

## 1. Platform Taxonomy & Canonical Source of Truth

The system strictly enforces **TWO merchant platforms** and **ZERO custom/hardcoded business platforms**:

```
                               MUBHIR AI PLATFORM
                                        |
                 +----------------------+----------------------+
                 |                                             |
           platform=salla                             platform=standalone
     (Salla App Store Merchants)                    (Direct SaaS Merchants)
                 |                                             |
         Salla Auth / OAuth                            Mubhir Native Auth
                 |                                             |
                 +----------------------+----------------------+
                                        |
                             Canonical Tenant Context
                                   (tenant_id)
                                        |
                               Shared Business Core
```

### Absolute Rules:
1. **Single Source of Truth**: `tenant.platform` stored in the database.
2. **Forbidden Custom Enums**: No `platform=content_plus`, `platform=founder`, `platform=partner`, `platform=internal`.
3. **Forbidden Business Hardcoding**: No `if (store_name === 'محتوى بلس')` or `if (tenant_id === 41)` business logic branches for commercial privileges or free access.
4. **Billing/Entitlement Separation**: Free or Founder access is strictly handled via `billing_source=admin_grant` / `AdminGrant` entitlement records, NOT by custom platforms or hardcoded tenant ID checks.

---

## 2. Target Component Architecture

```
+-----------------------------------------------------------------------------------+
|                                  PUBLIC WEBSITE                                   |
|                        https://mubhirbot.com (Marketing)                          |
+------------------------------------------+----------------------------------------+
                                           |
                    +----------------------+----------------------+
                    |                                             |
         GET /connect (Salla)                           GET /connect (Standalone)
                    |                                             |
                    v                                             v
        passport.authenticate('salla')                 POST /auth/standalone/login
                    |                                             |
                    +----------------------+----------------------+
                                           |
                                  TenantContext Middleware
                                           |
                                           v
+-----------------------------------------------------------------------------------+
|                                SHARED BUSINESS CORE                               |
|  +-----------------+  +-----------------+  +-----------------+  +--------------+  |
|  |     AI Core     |  |  WhatsApp Core  |  | Customer Engine |  |  Campaigns   |  |
|  +-----------------+  +-----------------+  +-----------------+  +--------------+  |
|  +-----------------+  +-----------------+  +-----------------+  +--------------+  |
|  |   Conversations |  |  Billing Core   |  |   Email Engine  |  |  Audit Log   |  |
|  +-----------------+  +-----------------+  +-----------------+  +--------------+  |
+------------------------------------------+----------------------------------------+
                                           |
                                           v
+-----------------------------------------------------------------------------------+
|                               INDEPENDENT ADMIN PANEL                             |
|                        /admin/login  |  /admin/*  |  /admin/logout                |
+-----------------------------------------------------------------------------------+
```

---

## 3. Platform & Entitlement Matrix

| Platform | Authentication | Onboarding / Entry | Billing Source | Feature Scope |
| :--- | :--- | :--- | :--- | :--- |
| `salla` | Salla OAuth 2.0 Passport | Salla App Store Install | `salla` | Full Salla suite (Orders, Abandoned Carts, Webhooks, WhatsApp, AI) |
| `standalone` | Native Password + Email Link Verification | `/connect` Signup ➔ Email Verification ➔ Plan & Payment Setup ➔ WhatsApp Connection | `payment_gateway` / `admin_grant` | Core SaaS suite (WhatsApp, AI Assistant, Campaigns, Customers, Reports) |

---

## 4. Capability Engine (`can(tenantContext, feature)`)

All feature access decisions are centrally evaluated against four orthogonal layers:

$$\text{Access Granted} = \text{PlatformCapability} \land \text{PlanEntitlement} \land \text{SubscriptionState} \land \text{RolePermission}$$

- **Platform Capability**: e.g., `salla.orders` is restricted to `platform=salla`.
- **Plan Entitlement**: e.g., `whatsapp_api` is restricted to `Enterprise`.
- **Subscription State**: Active or Trial state.
- **Role Permission**: Owner vs. Staff permissions.
