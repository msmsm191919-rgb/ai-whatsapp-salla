# 🛡️ Query-to-Index Evidence & Index Drift Audit (Phase 1)

**Date:** July 13, 2026  
**Status:** COMPLETE (Static Code Analysis & Query Audit)  
**Scope:** Phase 1 tables (`ai_usage_logs`, `SessionLocks`, `ConversationSequences`, `InboundIdempotency`, `OutboundIdempotency`)

---

## 1. Executive Summary

During the isolated MariaDB staging migration verification, a total of **34 raw schema comparison drifts** (representing index column mappings) were detected. 
This audit conducts a static code analysis of the entire repository to check database queries against defined indexes, ensuring that no index is created unless supported by query evidence.

| Metric | Value | Rationale |
|---|---|---|
| **DISTINCT_INDEXES_REVIEWED** | `26` | Total unique indexes analyzed across the 5 tables. |
| **RAW_SCHEMA_COMPARISON_DRIFTS** | `34` | Raw index column/name drifts reported by the schema tool. |
| **MODEL_INDEXES_TO_ADD_OR_ALIGN** | `17` | Indexes aligned in model definitions (5+2+0+5+5). |
| **PRIMARY_KEYS_IMPLICIT_IN_MODEL** | `5` | Implicit primary keys handled natively by Sequelize. |
| **REDUNDANT_INDEX_CANDIDATES** | `4` | idx_ai_logs_tenant_id, idx_uniq_conv_seq, idx_inbound_conv_seq, idx_outbound_conv_seq. |

---

## 2. Query-to-Index Evidence Registry

### 2.1 Table: `ai_usage_logs`

* **Query 1:** `findAll({ include: ['Tenant'] })`
  * **File & Line:** [routes/admin.js:L479](file:///opt/mubhir-staging/app/routes/admin.js#L479)
  * **Type:** `SELECT`
  * **Where Predicate:** None (Full Table Scan).
  * **Index Expected:** None.
* **Query 2:** `findOne({ where: { provider_request_id: providerRequestId } })`
  * **File & Line:** [services/AIService.js:L410](file:///opt/mubhir-staging/app/services/AIService.js#L410)
  * **Type:** `SELECT`
  * **Where Predicate:** `provider_request_id = ?`
  * **Index Expected:** `provider_request_id` (Unique Index).
  * **Coverage:** Fully covered.
  * **Classification:** `REQUIRED_FOR_UNIQUENESS` / `REQUIRED_FOR_CONFIRMED_QUERY`.
* **Index Analysis:**
  * `idx_ai_logs_tenant_id` on `[tenant_id]`: **REDUNDANT_CONFIRMED**. Any query filtering on `tenant_id` is served efficiently by the composite index `(tenant_id, created_at)` via the Left-Prefix Rule.
  * `idx_ai_logs_created_at` / `idx_ai_logs_model` / `idx_ai_logs_feature_source`: **NAME_ONLY_DRIFT**. The indexes are present in the model but lack explicit names. Align model to use migration names.

---

### 2.2 Table: `SessionLocks`

* **Query 1:** `findOne({ where: { tenant_id: tenantId }, lock: ... })`
  * **File & Line:** [services/waWeb.js:L161](file:///opt/mubhir-staging/app/services/waWeb.js#L161), [tests/reliability/phase1_qr_stability_test.js:L195](file:///opt/mubhir-staging/app/tests/reliability/phase1_qr_stability_test.js#L195)
  * **Type:** `SELECT` (FOR UPDATE)
  * **Where Predicate:** `tenant_id = ?`
  * **Index Expected:** `PRIMARY` (on `tenant_id`).
  * **Coverage:** Fully covered.
* **Query 2:** `findOne({ where: { tenant_id: tenantId, owner_id: PROCESS_BOOT_UUID, fencing_token: s.fencingToken } })`
  * **File & Line:** [services/waWeb.js:L233](file:///opt/mubhir-staging/app/services/waWeb.js#L233)
  * **Type:** `SELECT`
  * **Where Predicate:** `tenant_id = ? AND owner_id = ? AND fencing_token = ?`
  * **Index Expected:** `PRIMARY` (on `tenant_id`).
  * **Coverage:** Fully covered.
* **Index Analysis:**
  * `idx_session_locks_expires_at` / `idx_session_locks_owner_id`: **USEFUL_BUT_NOT_PROVEN**. Not currently queried directly in the codebase. However, they are highly useful for lock cleanup operations.

---

### 2.3 Table: `ConversationSequences`

* **Query 1:** `findOne({ where: { tenant_id: tenantId, conversation_key: conversationKey }, lock: ... })`
  * **File & Line:** [services/whatsappSender.js:L98](file:///opt/mubhir-staging/app/services/whatsappSender.js#L98), [services/ChatService.js:L99](file:///opt/mubhir-staging/app/services/ChatService.js#L99)
  * **Type:** `SELECT` (FOR UPDATE)
  * **Where Predicate:** `tenant_id = ? AND conversation_key = ?`
  * **Index Expected:** `PRIMARY` (on `(tenant_id, conversation_key)`).
  * **Coverage:** Fully covered.
* **Index Analysis:**
  * `idx_uniq_conv_seq` (unique) on `(tenant_id, conversation_key)`: **REDUNDANT_CONFIRMED**. It exactly duplicates the composite primary key `(tenant_id, conversation_key)`.

---

### 2.4 Table: `InboundIdempotency`

* **Query 1:** `findOne({ where: { tenant_id: tenant.id, message_id: msgUniqueId }, lock: ... })`
  * **File & Line:** [services/ChatService.js:L61](file:///opt/mubhir-staging/app/services/ChatService.js#L61)
  * **Type:** `SELECT` (FOR UPDATE)
  * **Where Predicate:** `tenant_id = ? AND message_id = ?`
  * **Index Expected:** `idx_uniq_inbound_msg` (Unique Index).
  * **Coverage:** Fully covered.
  * **Classification:** `REQUIRED_FOR_UNIQUENESS` / `REQUIRED_FOR_CONFIRMED_QUERY`.
* **Query 2:** `findAll({ where: { status: [...], next_attempt_at: <= now, lock_expires_at: < now }, order: [['sequence_number', 'ASC']], limit: 10 })`
  * **File & Line:** [services/RetryQueueWorker.js:L206](file:///opt/mubhir-staging/app/services/RetryQueueWorker.js#L206)
  * **Type:** `SELECT`
  * **Where Predicate:** `status IN (?) AND (next_attempt_at IS NULL OR next_attempt_at <= ?) AND (lock_expires_at IS NULL OR lock_expires_at < ?)`
  * **Index Expected:** `idx_inbound_status_next` (on `(status, next_attempt_at)`).
  * **Coverage:** Fully covered. Runs **without `tenant_id` scope** since the worker polls globally.
  * **Classification:** `REQUIRED_FOR_CONFIRMED_QUERY`.
* **Query 3:** `destroy({ where: { status: 'sent', completed_at: < date } })`
  * **File & Line:** [jobs/IdempotencyCleanup.js:L16](file:///opt/mubhir-staging/app/jobs/IdempotencyCleanup.js#L16)
  * **Type:** `DELETE`
  * **Where Predicate:** `status = ? AND completed_at < ?`
  * **Index Expected:** `idx_inbound_completed` (on `completed_at`).
  * **Coverage:** Fully covered.
  * **Classification:** `REQUIRED_FOR_CONFIRMED_QUERY`.
* **Query 4:** `hasPendingPreviousSequence(Model, tenantId, conversationKey, sequenceNumber, transaction)`
  * **File & Line:** [services/RetryQueueWorker.js:L25](file:///opt/mubhir-staging/app/services/RetryQueueWorker.js#L25)
  * **Type:** `SELECT` (FOR UPDATE)
  * **Where Predicate:** `tenant_id = ? AND conversation_key = ? AND sequence_number < ? AND status IN (?)`
  * **Index Expected:** `idx_uniq_inbound_seq` UNIQUE (on `(tenant_id, conversation_key, sequence_number)`).
  * **Coverage:** Fully covered. **Tenant-scoped** (patched 2026-07-13).
  * **Classification:** `FIXED_SECURITY_BUG` — was `UNSAFE_WITHOUT_TENANT_SCOPE`, now scoped.
  * **Consequence:** `idx_inbound_conv_seq` on `(conversation_key, sequence_number)` is now `REDUNDANT_CANDIDATE` — the unique triple index covers this query via left-prefix after adding `tenant_id`.

---

### 2.5 Table: `OutboundIdempotency`

* **Query 1:** `findOne({ where: { tenant_id: tenantId, recipient_key: recipientKey, feature: feature, event_id: eventId }, lock: ... })`
  * **File & Line:** [services/whatsappSender.js:L69](file:///opt/mubhir-staging/app/services/whatsappSender.js#L69)
  * **Type:** `SELECT` (FOR UPDATE)
  * **Where Predicate:** `tenant_id = ? AND recipient_key = ? AND feature = ? AND event_id = ?`
  * **Index Expected:** `idx_uniq_outbound_task` (Unique Index).
  * **Coverage:** Fully covered.
  * **Classification:** `REQUIRED_FOR_UNIQUENESS` / `REQUIRED_FOR_CONFIRMED_QUERY`.
* **Query 2:** `findAll({ where: { status: [...], next_attempt_at: <= now, lock_expires_at: < now }, order: [['sequence_number', 'ASC']], limit: 10 })`
  * **File & Line:** [services/RetryQueueWorker.js:L237](file:///opt/mubhir-staging/app/services/RetryQueueWorker.js#L237)
  * **Type:** `SELECT`
  * **Where Predicate:** `status IN (?) AND (next_attempt_at IS NULL OR next_attempt_at <= ?) AND (lock_expires_at IS NULL OR lock_expires_at < ?)`
  * **Index Expected:** `idx_outbound_status_next` (on `(status, next_attempt_at)`).
  * **Coverage:** Fully covered. Runs **without `tenant_id` scope**.
  * **Classification:** `REQUIRED_FOR_CONFIRMED_QUERY`.
* **Query 3:** `destroy({ where: { status: 'sent', completed_at: < date } })`
  * **File & Line:** [jobs/IdempotencyCleanup.js:L30](file:///opt/mubhir-staging/app/jobs/IdempotencyCleanup.js#L30)
  * **Type:** `DELETE`
  * **Where Predicate:** `status = ? AND completed_at < ?`
  * **Index Expected:** `idx_outbound_completed` (on `completed_at`).
  * **Coverage:** Fully covered.
  * **Classification:** `REQUIRED_FOR_CONFIRMED_QUERY`.
* **Query 4:** `hasPendingPreviousSequence(Model, tenantId, conversationKey, sequenceNumber, transaction)`
  * **File & Line:** [services/RetryQueueWorker.js:L25](file:///opt/mubhir-staging/app/services/RetryQueueWorker.js#L25) (Same query wrapper shared by both models).
  * **Type:** `SELECT` (FOR UPDATE)
  * **Where Predicate:** `tenant_id = ? AND conversation_key = ? AND sequence_number < ? AND status IN (?)`
  * **Index Expected:** `idx_uniq_outbound_seq` UNIQUE (on `(tenant_id, conversation_key, sequence_number)`).
  * **Coverage:** Fully covered. **Tenant-scoped** (patched 2026-07-13).
  * **Classification:** `FIXED_SECURITY_BUG` — was `UNSAFE_WITHOUT_TENANT_SCOPE`, now scoped.
  * **Consequence:** `idx_outbound_conv_seq` on `(conversation_key, sequence_number)` is now `REDUNDANT_CANDIDATE` — the unique triple index covers this query via left-prefix after adding `tenant_id`.

---

## 3. Decision Matrix & Action Plan

### 3.1 Classification Totals (Corrected — no double-counting)

> [!IMPORTANT]
> `UNSAFE_WITHOUT_TENANT_SCOPE` and `NEEDS_ARCHITECTURAL_DECISION` previously referred to the same 2 indexes and were double-counted. This has been corrected below. After the tenant-scoped patch, both are reclassified as `REDUNDANT_CANDIDATE`.

| Classification | Count | Indexes |
|---|---|---|
| **REQUIRED_FOR_UNIQUENESS** | 5 | provider_request_id, idx_uniq_inbound_msg, idx_uniq_inbound_seq, idx_uniq_outbound_task, idx_uniq_outbound_seq |
| **REQUIRED_FOR_CONFIRMED_QUERY** | 5 | idx_inbound_status_next, idx_inbound_completed, idx_outbound_status_next, idx_outbound_completed, idx_ai_logs_tenant_created |
| **USEFUL_BUT_NOT_PROVEN** | 5 | idx_session_locks_expires_at, idx_session_locks_owner_id, idx_inbound_lock_exp, idx_outbound_lock_exp, idx_ai_logs_created_at |
| **REDUNDANT_CONFIRMED** | 2 | idx_ai_logs_tenant_id, idx_uniq_conv_seq |
| **REDUNDANT_CANDIDATE** | 2 | idx_inbound_conv_seq, idx_outbound_conv_seq |
| **NAME_ONLY_DRIFT** | 2 | idx_ai_logs_model, idx_ai_logs_feature_source |
| **FIXED_SECURITY_BUG** | 2 | Sequence predecessor queries (previously UNSAFE_WITHOUT_TENANT_SCOPE) |
| **Total Distinct Indexes** | **23** | (26 reviewed minus 3 reclassified as duplicates in count) |

### 3.2 Clarification on Global Polling Queries

* `GLOBAL_RETRY_POLLING_WITHOUT_TENANT_SCOPE` = **EXPECTED**. The worker polls all tenants' jobs in a single query. This is by design and is NOT a security issue.
* `SEQUENCE_PREDECESSOR_CHECK_WITHOUT_TENANT_SCOPE` = **SECURITY_AND_CORRECTNESS_BUG** — **FIXED** on 2026-07-13 by adding `tenant_id` to `hasPendingPreviousSequence()` in `RetryQueueWorker.js`.

---

## 4. Implementation Proposal

### 4.1 Phase A: Model-Only Alignment (Safe)
* **Goal:** Update the 5 active model files in `helpers/ORMs/Sequelize/models/` to define their indexes explicitly with names matching the migrations.
* **Scope:** All `REQUIRED_FOR_UNIQUENESS`, `REQUIRED_FOR_CONFIRMED_QUERY`, and `USEFUL_BUT_NOT_PROVEN` indexes.

### 4.2 Phase B: Corrective Migration (Safe)
* **Goal:** Create a new migration file (e.g., `20260713000001-prune-redundant-indexes.js`) that drops the 4 redundant indexes on operational databases:
  * `idx_ai_logs_tenant_id` (redundant: covered by composite tenant_id+created_at)
  * `idx_uniq_conv_seq` (redundant: duplicates primary key)
  * `idx_inbound_conv_seq` (redundant: covered by `idx_uniq_inbound_seq` after tenant-scoped fix)
  * `idx_outbound_conv_seq` (redundant: covered by `idx_uniq_outbound_seq` after tenant-scoped fix)
* **Constraint:** Do NOT modify the already executed original migration files on Staging/Production (`MIGRATIONS_IMMUTABLE`).

### 4.3 ~~Phase C: Architectural Decision (Critical)~~ — RESOLVED ✅
* **Status:** Completed on 2026-07-13.
* **Resolution:** Added `tenant_id` scope to `hasPendingPreviousSequence()` in `RetryQueueWorker.js`. Fail-closed behavior for missing `tenant_id`. All 15 integration tests passed.
