# Gate 13 — WhatsApp QR Architecture & Reliability Audit

> **Audit Mode**: Read-Only Discovery

---

## 📱 WhatsApp Engine Configuration

```properties
WHATSAPP_LIBRARY=whatsapp-web.js v1.23.0
SESSION_BASE_PATH=.wwebjs_auth/
SESSION_PATH_PATTERN=.wwebjs_auth/session-{tenantId}
ACTIVE_WHATSAPP_CLIENTS=1 (Tenant 41 connected and active in memory)
QR_REGENERATION_RULE=Generated on user demand via POST /api/wa-web/start
TRANSIENT_ERROR_SESSION_DELETE=NO (Session files preserved across transient network errors)
VERIFIED_LOGOUT_SESSION_DELETE=YES (Session files removed ONLY on explicit user logout or AUTH_FAILURE event)
DISTRIBUTED_LOCK_STATUS=YES (SessionLocks table / memory lock prevents duplicate client initialization)
FENCING_STATUS=YES (fencingToken increments per start call to reject stale callbacks)
SESSION_BACKUP_STATUS=YES (.wwebjs_auth directory backed up)
IDEMPOTENCY_STATUS=YES (Message id & timestamp deduplication)
RETRY_QUEUE_STATUS=YES (Failed outbound messages retried up to 3 times)
KILL_SWITCH_STATUS=DISABLED (TENANT_41_KILL_SWITCH=false)
AUTO_REPLY_STATUS=ENABLED (TENANT_41_AUTO_REPLY_ENABLED=true)
MANUAL_REPLY_STATUS=HANDOFF_SUPPORTED (HandoffService pauses AI when admin replies manually)
QR_STABILITY_TESTS=PASSED
QR_KNOWN_RISKS=Puppeteer Chromium memory overhead managed via PM2 max_memory_restart: 400M
```

---

## 🔍 Lifecycle State Machine

```
[LOGGED_OUT] ──(POST /api/wa-web/start)──► [INITIALIZING] ──(QR Event)──► [QR_GENERATED]
                                                                                │
                                                                       (User Scans QR)
                                                                                ▼
[READY] ◄──(AUTHENTICATED Event)── [AUTHENTICATED] ◄────────────────────────────┘
   │
   ├──► (Transient Network Drop) ──► [RECOVERING] ──► (Reconnected) ──► [READY]
   │
   └──► (User Unlinks Device / Auth Fail) ──► [AUTH_FAILED] ──► (Cleanup) ──► [LOGGED_OUT]
```
