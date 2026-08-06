# Gate 0 — Production Runtime Verification

> **Audit Mode**: Read-Only Discovery
> **Target**: Live Production VPS (`app.mubhirbot.com`)

---

## 📌 Production Environment Parameters

| Parameter | Discovered Empirical Value |
| :--- | :--- |
| **PRODUCTION_HOSTNAME** | `srv1707218` |
| **PRODUCTION_PUBLIC_IP** | `2.24.130.212` (IPv6: `2a02:4780:f:5dbd::1`) |
| **PRODUCTION_PROJECT_PATH** | `/root/ai-whatsapp-salla` |
| **PRODUCTION_GIT_BRANCH** | `release/salla-final-readiness` (tracked to `origin/main`) |
| **PRODUCTION_GIT_COMMIT** | `26f2ed0291d4052a6ff1ad3c2d36e45cdb7158eb` |
| **PRODUCTION_GIT_STATUS** | Clean tracking (Untracked scratch/utility scripts only) |
| **PRODUCTION_PM2_PROCESS** | `whatsapp-ai` (ID: `0`, Mode: `fork`, Status: `online`, PID: `25730`) |
| **PRODUCTION_PM2_SCRIPT** | `./app.js` |
| **PRODUCTION_PM2_CWD** | `/root/ai-whatsapp-salla` |
| **PRODUCTION_APP_PORT** | `8095` |
| **PRODUCTION_NGINX_UPSTREAM**| `http://localhost:8095` (Server Names: `mubhirbot.com`, `app.mubhirbot.com`) |
| **PRODUCTION_DATABASE_ENGINE**| `MySQL` |
| **PRODUCTION_DATABASE_NAME**| `mubhir_production` (Host: `127.0.0.1`, User: `root`) |
| **NODE_VERSION** | `v20.20.2` |
| **NPM_VERSION** | `10.8.2` |
| **REDIS_ENABLED** | `NO` (Native in-memory maps / database handlers used) |
| **QUEUE_SYSTEM** | Node async memory queue & Sequelize job retry |
| **CRON_JOBS_COUNT** | `0` system crons (Internal Node `setInterval` in `jobs/scheduler.js`) |
| **SYSTEMD_SERVICES** | `nginx.service`, `mysql.service`, `pm2-root.service` |

---

## 🔍 Process & Port Architecture
```
[Client Web Browser] ──(HTTPS/443)──► [Nginx 1.24.0 Proxy] ──(HTTP/8095)──► [PM2: whatsapp-ai (Node v20.20.2)]
                                                                               │
                                                                               ├──► [MySQL 127.0.0.1:3306 (mubhir_production)]
                                                                               ├──► [Puppeteer / LocalAuth (.wwebjs_auth/)]
                                                                               └──► [OpenAI API (gpt-4o-mini)]
```

---

## 🔒 Verification Evidence
- PM2 Memory Restart Limit: `400M`
- Nginx Configuration: `/etc/nginx/sites-enabled/` proxies `app.mubhirbot.com` to `127.0.0.1:8095`.
- Environment File: `/root/ai-whatsapp-salla/.env` loaded on boot.
