# Mubhir AI — Executive Summary & Audit Overview

> **Audit Mode**: READ-ONLY DISCOVERY
> **Date**: August 6, 2026
> **Scope**: Complete Codebase, Production Environment, Data Architecture, User Flows, AI Engine, and Salla App Review Status.

---

## 📌 Executive Summary

This document serves as the **Single Source of Truth** for the entire Mubhir AI application platform. It consolidates empirical findings gathered from the live production VPS (`2.24.130.212`), MySQL Production Database (`mubhir_production`), application codebase, route maps, and operational logs.

### Key Operational Findings
1. **Live Production Infrastructure**:
   - Hosted on Ubuntu 24.04 LTS (Hostinger VPS `srv1707218`, IP: `2.24.130.212`).
   - Process Managed by PM2 (Process `whatsapp-ai` ID `0`, Node `v20.20.2`, Port `8095`).
   - Reverse Proxy: Nginx 1.24.0 handling SSL for `mubhirbot.com` & `app.mubhirbot.com`.
   - Production Database: **MySQL** (`mubhir_production` on 127.0.0.1) containing 14 tables and 45 tenant records.

2. **Salla App Store Status**:
   - Current Status: **Under Review ("تطبيقك تحت المراجعة")** in Salla Partners Portal (`https://portal.salla.partners/apps/963671145`).
   - App Client ID: `15b36531-e554-4a66-baa9-58d85e238ae8`.
   - Public App Store listing is locked pending Salla review completion.

3. **Multi-Tenant Architecture & Standalone Capability**:
   - The platform supports both Salla OAuth merchants and Standalone merchants.
   - **Content Plus ("محتوى بلس")** is configured as a standalone tenant (`Tenant ID: 41`, `platform: 'standalone'`).
   - Standalone merchants access the dashboard via `/connect/standalone` without requiring Salla App Store approval.
   - Active WhatsApp session for Tenant 41 (`.wwebjs_auth/session-41`) is connected and verified live (`+966501577963`).

4. **Authentication & Tenant Isolation Refactoring**:
   - `getTenantFromReq(req)` and `resolveTenant(req)` unify tenant identification across `app.js`, `routes/dashboard.js`, and `services/planGate.js`.
   - Prior dependency on `salla_merchant_id` only has been replaced with `tenant_id` resolution first, resolving access issues for Standalone merchants.
   - All dashboard queries have been guarded against `undefined` values to prevent Sequelize errors (`WHERE parameter "tenant_id" has invalid "undefined" value`).

5. **AI Assistant & Engine**:
   - Model: OpenAI `gpt-4o-mini`.
   - Custom Instructions & Knowledge Base are isolated per tenant in `settings.ai_config` and `settings.knowledge_base`.
   - System prompts are dynamically constructed via `services/PromptManager.js`.

---

## 📊 Summary Metrics Table

| Metric | Empirical Value |
| :--- | :--- |
| **Total Source Files** | 1,886 (381 `.js`, 47 `.html`, 35 `.json`, 25 `.md`) |
| **Total Registered Routes** | 102 (71 in `app.js`, 31 in `routes/` directory) |
| **Total Production Database Tables** | 14 (`Tenants`, `Subscriptions`, `Plans`, `WhatsAppConfigs`, `MessageLogs`, `Customers`, `Campaigns`, `Carts`, `SallaOAuth`, `WebhookEvents`, `UsageCounters`, `Payments`, `AiUsageLogs`, `SequelizeMeta`) |
| **Total Registered Tenants** | 45 Tenants (1 Salla Demo, 2 Salla Real, 14 Standalone, 28 Test/Draft) |
| **Content Plus Active Tenant ID** | **Tenant 41** (`session-41`, `store_name: محتوى بلس`) |
| **WhatsApp Engine** | `whatsapp-web.js` v1.23.0 + Puppeteer LocalAuth |
| **Audit Status** | **Complete & Verified (Read-Only)** |
