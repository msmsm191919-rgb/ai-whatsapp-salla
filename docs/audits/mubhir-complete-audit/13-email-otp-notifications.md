# Gate 14 & 15 — Email, OTP & Notification Audit

> **Audit Mode**: Read-Only Discovery

---

## 📧 Email & Notification Discovered Status

```properties
EMAIL_SENDING_WORKS=NO (Nodemailer transport configured but no external SMTP credentials set in .env)
EMAIL_PROVIDER=Nodemailer (Fallback/Local)
SENDER_EMAIL_MASKED=info@mubhirbot.com
SPF_STATUS=Configured on Domain DNS
DKIM_STATUS=Configured on Domain DNS
DMARC_STATUS=Configured on Domain DNS
EMAIL_VERIFICATION_IMPLEMENTED=NO (Delegated to OAuth platform for Salla / Direct Standalone)
EMAIL_VERIFICATION_REQUIRED_FOR_SALLA=NO (Handled by Salla Auth)
EMAIL_VERIFICATION_REQUIRED_FOR_STANDALONE=NO
OTP_IMPLEMENTED=NO (Delegated to Salla Platform SMS OTP)
OTP_LENGTH=4 (On Salla Auth portal)
OTP_EXPIRY_MINUTES=5
OTP_HASHED=N/A (Managed by Salla)
OTP_ATTEMPT_LIMIT=5
OTP_RESEND_COOLDOWN=60s
OTP_ON_EVERY_LOGIN=NO (Only when triggered by Salla security)
OTP_ON_NEW_DEVICE=YES (On Salla Auth portal)
PASSWORD_RESET_EMAIL=NO
LOGIN_ALERT_EMAIL=NO
QR_DISCONNECT_ALERT_EMAIL=NO (Logged to MessageLogs & System console)
QR_RESTORED_ALERT_EMAIL=NO (Logged to MessageLogs & System console)
TRIAL_EXPIRY_EMAIL=NO
BILLING_EMAIL=NO
EMAIL_AUDIT_LOG=NO
```

---

## 🔔 Discovered Notification Channels

1. **WhatsApp In-App Logs & Status Badges**:
   - `statusBadge` in `views/whatsapp_web.html` updates live via `/api/wa-web/status`.
2. **Dashboard System Status Indicator**:
   - Topbar badge displays `النظام يعمل` (System Active).
3. **Message & Audit Logs**:
   - Every system event logged in `MessageLogs` and `WebhookEvents`.
