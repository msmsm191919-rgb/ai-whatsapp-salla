# Gate 19 — Plans, Pricing & Billing Audit

> **Audit Mode**: Read-Only Discovery

---

## 💳 Package & Pricing Alignment Summary

```properties
DATABASE_PLANS=3 (الأساسية: 49 SAR, النمو: 149 SAR, الشركات: 299 SAR)
CODE_PLANS=3 (Defined in services/planGate.js PLANS object)
PUBLIC_PRICING=3 Packages displayed on views/pricing.html
SALLA_PORTAL_PRICING=3 Packages submitted in Salla Partners Portal
PLAN_GATE_FEATURES=campaigns, automation_carts, automation_orders, welcome_messages, auto_reply_bot, ai_advanced, api_access, custom_ai_training, whatsapp_qr
PLAN_LIMITS=الأساسية (3,000 msgs, 1,000 AI replies), النمو (-1 unlimited), الشركات (-1 unlimited)
INTERNAL_AI_LIMITS=1,000 AI replies/mo for Basic Plan
VISIBLE_AI_LIMITS=Displayed on pricing cards
TRIAL_DAYS=3 Days free trial
PRICING_CONFLICTS=NONE (100% Alignment across DB, Code, and Views)
PLAN_FEATURE_CONFLICTS=NONE
BILLING_PROVIDER=Tap Payments (`services/TapService.js` & `/webhook/tap`) + Salla Billing API
SUBSCRIPTION_RENEWAL_FLOW=Auto-renewal timer check in Subscription model
UPGRADE_FLOW=Redirects to Salla App Store or Tap Checkout
DOWNGRADE_FLOW=Handled via admin portal or subscription expiration
CANCELLATION_FLOW=Subscription status updated to `cancelled`
```

---

## 📋 Discovered Package Tiers Matrix

| Package Name | Monthly Price | Yearly Price | Monthly Message Limit | Monthly AI Reply Limit | Included Features |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **الأساسية (Basic)** | 49 SAR | 470 SAR | 3,000 | 1,000 | WhatsApp QR, AI Auto Reply, Salla Integration, Basic Automation, Scenarios. |
| **النمو (Growth)** | 149 SAR | 1,430 SAR | Unlimited (-1) | Unlimited (-1) | All Basic features + Bulk Campaigns, Advanced AI, Abandoned Carts Recovery. |
| **الشركات (Enterprise)** | 299 SAR | 2,870 SAR | Unlimited (-1) | Unlimited (-1) | All Growth features + Cloud API, Dedicated IP, Custom AI Training, Priority Support. |
