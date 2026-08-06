# Gate 29 — Open Architecture Questions & Decisions for System Design

> **Audit Mode**: Read-Only Discovery
> **Purpose**: Frame strategic questions for owner review with ChatGPT post-audit.

---

## ❓ Strategic Architecture Questions

### 1. Standalone Account Authentication Policy
- **Current State**: `/connect/standalone` allows direct login by store name and email.
- **Question**: Post Salla approval, should Standalone merchants use Email + Password + OTP verification, or magic link authentication?

### 2. Standalone vs Salla Dashboard Layout Separation
- **Current State**: Both Salla and Standalone merchants share 85% of sidebar navigation items (including Abandoned Carts and Order Statuses).
- **Question**: Should we hide e-commerce cart/order automation items for service-based standalone merchants (like Content Plus)?

### 3. Canonical Tenant Cleanup
- **Current State**: DB contains Tenants 13, 41, 44, 45 for "محتوى بلس", with **Tenant 41** active and linked to the active WhatsApp session.
- **Question**: Should we consolidate or soft-delete stale duplicate dev records (Tenants 13, 44, 45) after review completion?

### 4. Transmit Alerting Channels
- **Current State**: WhatsApp disconnect alerts are logged to `MessageLogs` and PM2 logs.
- **Question**: Should we enable instant WhatsApp/SMS/Email disconnect alerts directly to the store owner's mobile number (`+966501577963`)?
