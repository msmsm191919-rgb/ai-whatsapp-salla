// services/waWeb.js
// ═══════════════════════════════════════════════════════════════════
// 📱 ربط واتساب عبر whatsapp-web.js (مسح QR) — جلسة مستقلة لكل تاجر
// ───────────────────────────────────────────────────────────────────
// قناة غير رسمية: الرسائل تطلع من واتساب جوال التاجر بعد مسح QR.
// كل تاجر له جلسة منفصلة (clientId = معرّف التاجر) — مناسب لـ SaaS.
// تعمل عبر HTTP polling (بدون socket.io).
// ═══════════════════════════════════════════════════════════════════
const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcode = require('qrcode');

const WEB_VERSION = 'https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/2.3000.1040093096-alpha.html';

const createWorker = global.createWorker || function(fn) {
    if (global.SAFE_MODE && global.SAFE_MODE.locked !== true) {
        console.error("❌ FATAL: SAFE_MODE.locked is compromised!");
        process.exit(1);
    }
    const isSafe = global.SAFE_MODE?.enabled || (
        process.env.NODE_ENV === 'staging' &&
        process.env.STAGING_SAFE_MODE === 'true' &&
        process.env.FORCE_SAFE_BYPASS !== 'true'
    );
    if (isSafe) {
        return function NOOP_WORKER() { return null; };
    }
    return fn;
};

// خريطة الجلسات: المفتاح = معرّف التاجر، القيمة = حالة جلسته
const sessions = new Map();

// 🔒 قفل داخلي: يمنع تشغيل start() المتزامن لنفس tenantId
const _starting = new Set();

function _session(tenantId) {
    const k = String(tenantId);
    if (!sessions.has(k)) {
        sessions.set(k, {
            client: null,
            status: 'disconnected',
            qr: '',
            error: '',
            poller: null,
            autoReplyActivatedTime: 0,
            initTries: 0,
            // New variables for Phase 1A:
            browserPid: null,
            reconnectAttempt: 0,
            reconnectTimer: null,
            circuitOpen: false,
            circuitOpenUntil: 0,
            lastVerifiedAt: 0,
            lastErrorCode: '',
            logoutIntent: false,
            halfOpenTrial: false,
            cleaning: false,
            syncPercent: 0
        });
    }
    return sessions.get(k);
}

function getState(tenantId) {
    const s = _session(tenantId);
    return { status: s.status, qr: s.qr, error: s.error };
}

function getSessionSnapshot(tenantId) {
    const k = String(tenantId);
    const s = _session(k);
    return {
        status: s.status,
        lastVerifiedAt: s.lastVerifiedAt || 0,
        reconnectAttempt: s.reconnectAttempt || 0,
        circuitOpen: s.circuitOpen || false,
        lastErrorCode: s.lastErrorCode || ''
    };
}

function isReady(tenantId) {
    return _session(tenantId).status === 'ready';
}

// 🔁 فحص احتياطي: حدث 'ready' متقلّب — نتأكد عبر client.getState()
function _startReadyPoller(tenantId) {
    const s = _session(tenantId);
    if (s.poller) return;
    let tries = 0;
    s.poller = setInterval(async function readyPollerWorker() {
        tries++;
        if (s.status === 'ready' || tries > 40 || !s.client) { clearInterval(s.poller); s.poller = null; return; }
        try {
            if (await s.client.getState() === 'CONNECTED') {
                s.status = 'ready'; s.qr = '';
                s.lastVerifiedAt = Date.now();
                s.reconnectAttempt = 0;
                console.log(`✅ [waWeb:${tenantId}] جاهز (عبر getState fallback)`);
                clearInterval(s.poller); s.poller = null;
            }
        } catch (e) { /* الصفحة لسّا تحمّل */ }
    }, 3000);
}

// 🧹 تنظيف ملفات القفل العالقة لجلسة تاجر معيّن
function _cleanLocks(clientId) {
    try {
        const fs = require('fs');
        const path = require('path');
        const authDataPath = process.env.WWEBJS_AUTH_PATH || './.wwebjs_auth';
        const sessDir = path.resolve(authDataPath, 'session-' + clientId);
        for (const f of ['SingletonLock', 'SingletonCookie', 'SingletonSocket']) {
            const p = path.join(sessDir, f);
            if (fs.existsSync(p)) { try { fs.rmSync(p, { force: true }); } catch (e) {} }
        }
    } catch (e) { /* تجاهل */ }
}

// توحيد الرقم السعودي → chatId
function _chatId(phone) {
    const sPhone = String(phone == null ? '' : phone).trim();
    if (sPhone.endsWith('@c.us') || sPhone.endsWith('@lid')) {
        return sPhone;
    }
    let s = sPhone.replace(/\D/g, '');
    if (s.startsWith('00')) s = s.slice(2);
    if (s.startsWith('0')) s = '966' + s.slice(1);
    else if (s.startsWith('5') && s.length === 9) s = '966' + s;
    return s + '@c.us';
}

// دالة لتتبع والتقاط معرف العملية (PID) للمتصفح الخاص بالتاجر
function _capturePid(s) {
    if (s.client && s.client.pupBrowser && s.client.pupBrowser.process()) {
        s.browserPid = s.client.pupBrowser.process().pid;
        console.log(`[waWeb] Captured browser process PID: ${s.browserPid}`);
    }
}

// دالة تنظيف شجرة العمليات المتوافقة مع Windows و Linux لمنع تسرب الكروميوم
function _killProcessTree(pid) {
    try {
        const isWindows = process.platform === 'win32';
        if (isWindows) {
            const { execSync } = require('child_process');
            execSync(`taskkill /F /T /PID ${pid}`, { stdio: 'ignore' });
        } else {
            process.kill(pid, 'SIGKILL');
        }
        console.log(`[waWeb] Process ${pid} tree force closed successfully.`);
    } catch (e) {
        // العمليات قد تكون أغلقت بالفعل
    }
}

// دالة تصنيف للتحقق من المهلة المؤقتة أثناء الربط
function isTransientAuthTimeout(err) {
    if (!err) return false;
    const msg = typeof err === 'string' ? err : (err.message || String(err));
    return msg.toLowerCase().includes('auth timeout');
}

// دالة تصنيف للتحقق من أسباب تسجيل الخروج أو إزالة الجهاز
function isLogoutReason(reason) {
    if (!reason) return false;
    const r = typeof reason === 'string' ? reason : (reason.message || String(reason));
    const norm = r.toUpperCase();
    return norm.includes('LOGOUT') || norm.includes('UNPAIRED');
}

// دالة تصنيف للتحقق من إلغاء الترخيص أو فقدان الجلسة بشكل كامل
function isRevokedSession(errOrReason) {
    if (!errOrReason) return false;
    const r = typeof errOrReason === 'string' ? errOrReason : (errOrReason.message || String(errOrReason));
    const norm = r.toUpperCase();
    return norm.includes('LOGOUT') || norm.includes('UNPAIRED') || norm.includes('AUTH_FAILURE') || norm.includes('REVOKED');
}

// دالة تحليل آمنة لمهلة الربط للتأكد من قيمتها وحدودها
function getAuthTimeoutMs() {
    const rawVal = process.env.STAGING_AUTH_TIMEOUT_MS || process.env.AUTH_TIMEOUT_MS;
    let parsed = parseInt(rawVal, 10);
    const defaultVal = 300000; // 5 دقائق كقيمة افتراضية
    const minVal = 15000;      // حد أدنى 15 ثانية
    const maxVal = 900000;     // حد أقصى 15 دقيقة
    if (isNaN(parsed) || parsed <= 0) {
        return defaultVal;
    }
    if (parsed < minVal) return minVal;
    if (parsed > maxVal) return maxVal;
    return parsed;
}

// الدالة الموحدة لتنظيف موارد الجلسة وعمليات المتصفح العالقة مع حماية المجلدات
function _deleteSessionDirectory(clientId) {
    const tenantIdStr = String(clientId);
    // 1. تحقق من أن معرف التاجر هو رقم صالح فقط لمنع الهجمات
    if (!/^\d+$/.test(tenantIdStr)) {
        console.error(`❌ [waWeb:${tenantIdStr}] _deleteSessionDirectory: Invalid tenant ID format.`);
        return;
    }

    try {
        const fs = require('fs');
        const path = require('path');
        const authDataPath = process.env.WWEBJS_AUTH_PATH || './.wwebjs_auth';
        
        // 2. استخدام realpath/resolve
        const resolvedAuthPath = path.resolve(authDataPath);
        const targetDir = path.join(resolvedAuthPath, 'session-' + tenantIdStr);
        const resolvedTargetDir = path.resolve(targetDir);

        // 3. تأكد أن المسار النهائي يقع داخل مجلد الجلسات الرئيسي فقط (منع Path Traversal)
        if (!resolvedTargetDir.startsWith(resolvedAuthPath + path.sep)) {
            console.error(`❌ [waWeb:${tenantIdStr}] _deleteSessionDirectory: Path traversal attempt blocked! Path: ${resolvedTargetDir}`);
            return;
        }

        if (fs.existsSync(resolvedTargetDir)) {
            fs.rmSync(resolvedTargetDir, { recursive: true, force: true });
            console.log(`🧹 [waWeb:${tenantIdStr}] Deleted session directory: ${resolvedTargetDir}`);
        }
    } catch (e) {
        console.error(`❌ [waWeb:${tenantIdStr}] Failed to delete session directory:`, e.message);
    }
}

// الدالة الموحدة لتنظيف موارد الجلسة وعمليات المتصفح العالقة
async function cleanupSessionResources(tenantId, reason) {
    const k = String(tenantId);
    const s = sessions.get(k);
    if (!s) return;
    if (s.cleaning) {
        console.log(`[waWeb:${k}] cleanupSessionResources: cleanup already in progress (ignored)`);
        return;
    }
    s.cleaning = true;

    try {
        console.log(`🧹 [waWeb:${k}] Cleaning up resources (Reason: ${reason})...`);

        // Capture PID fallback if not already captured
        if (!s.browserPid && s.client && s.client.pupBrowser && s.client.pupBrowser.process()) {
            s.browserPid = s.client.pupBrowser.process().pid;
            console.log(`[waWeb:${k}] Captured browser process PID on cleanup fallback: ${s.browserPid}`);
        }

        // 1. إيقاف الـ Timers والـ Pollers الخاصة بالجلسة
        if (s.poller) { clearInterval(s.poller); s.poller = null; }
        if (s.reconnectTimer) { clearTimeout(s.reconnectTimer); s.reconnectTimer = null; }

        // 2. إزالة مستمعي الأحداث الذين تمت إضافتهم بواسطة مبهر
        if (s.client) {
            try {
                s.client.removeAllListeners('qr');
                s.client.removeAllListeners('loading_screen');
                s.client.removeAllListeners('authenticated');
                s.client.removeAllListeners('ready');
                s.client.removeAllListeners('auth_failure');
                s.client.removeAllListeners('disconnected');
                s.client.removeAllListeners('message_create');
            } catch (e) {
                console.error(`[waWeb:${k}] Error removing listeners:`, e.message);
            }
        }

        // 3. تدمير العميل بأمان مع مهلة أمان قصوى 8 ثوانٍ
        let destroyedGracefully = false;
        const originalClient = s.client;
        if (originalClient) {
            try {
                const destroyPromise = originalClient.destroy().then(() => { destroyedGracefully = true; });
                const timeoutPromise = new Promise(r => setTimeout(r, 8000));
                await Promise.race([destroyPromise, timeoutPromise]);
            } catch (e) {
                console.error(`[waWeb:${k}] Error destroying client:`, e.message);
            }
        }

        // 4. محاولة إغلاق المتصفح طبيعياً
        if (originalClient && originalClient.pupBrowser && !destroyedGracefully) {
            try {
                await originalClient.pupBrowser.close();
            } catch (e) {
                // تجاهل
            }
        }

        // 5. قتل العمليات المستهدفة يدوياً كخيار أخير إذا بقيت العملية حية
        const pid = s.browserPid;
        if (pid) {
            try {
                let exists = false;
                try {
                    process.kill(pid, 0);
                    exists = true;
                } catch (e) {
                    exists = false;
                }
                if (exists) {
                    _killProcessTree(pid);
                }
            } catch (e) {
                // تجاهل
            }
            s.browserPid = null;
        }

        s.client = null;

        // 6. تحديث الحالة
        if (reason === 'logout' || reason === 'auth_failure') {
            s.status = (reason === 'auth_failure') ? 'auth_required' : 'disconnected';
            s.qr = '';
        } else if (reason === 'expired') {
            s.status = 'subscription_expired';
            s.qr = '';
        }
    } finally {
        s.cleaning = false;
    }
}

async function handleTechnicalFailure(tenantId, reason) {
    const k = String(tenantId);
    const s = _session(k);
    _starting.delete(k);
    console.warn(`⚠️ [waWeb:${k}] Technical failure triggered: ${reason}`);

    // Check if this is an official logout / disconnect from phone
    const isLogout = isLogoutReason(reason) || isRevokedSession(reason);

    if (isLogout) {
        console.log(`[waWeb:${k}] Official logout/disconnect/revocation detected. Stopping session and cleaning auth.`);
        await cleanupSessionResources(k, 'auth_failure'); // Sets status to auth_required
        _deleteSessionDirectory(k); // Clean session directory
        return;
    }

    // تنظيف الموارد فوراً
    await cleanupSessionResources(k, 'disconnected');

    // تحقق من صلاحية الاشتراك قبل جدولة الإقلاع
    const pGate = require('./planGate');
    const acc = await pGate.checkTenantAccess(k);
    if (!acc.allowed || s.logoutIntent) {
        console.log(`[waWeb:${k}] Reconnect aborted: Tenant status is ${acc.reason} or logout triggered.`);
        if (!acc.allowed) {
            s.status = (acc.reason === 'subscription_expired') ? 'subscription_expired' : 'disconnected';
        }
        return;
    }

    // If this was a Half-Open trial and it failed, immediately re-open the circuit!
    if (s.halfOpenTrial) {
        console.error(`❌ [waWeb:${k}] Half-Open trial failed! Re-opening circuit immediately.`);
        s.halfOpenTrial = false;
        s.circuitOpen = true;
        s.circuitOpenUntil = Date.now() + 15 * 60000; // Open circuit for another 15 minutes
        s.status = 'recovery_failed';
        s.lastErrorCode = 'half_open_trial_failed';
        s.reconnectAttempt = 0;
        return;
    }

    // جدولة الاسترجاع مع Exponential Backoff و Jitter
    s.reconnectAttempt = (s.reconnectAttempt || 0) + 1;
    s.status = 'recovering';

    if (s.reconnectAttempt > 5) {
        console.error(`❌ [waWeb:${k}] Circuit breaker opened! Too many reconnect attempts.`);
        s.circuitOpen = true;
        s.circuitOpenUntil = Date.now() + 15 * 60000; // قفل الدائرة 15 دقيقة
        s.status = 'recovery_failed';
        s.lastErrorCode = 'reconnect_limit_reached';
        s.reconnectAttempt = 0;
        return;
    }

    const backoffDelays = [5000, 15000, 45000, 120000, 300000];
    const baseDelay = backoffDelays[s.reconnectAttempt - 1] || 300000;
    const jitter = Math.floor(Math.random() * 4000) - 2000; // Jitter +/- 2ث
    const finalDelay = Math.max(1000, baseDelay + jitter);

    console.log(`⏳ [waWeb:${k}] Scheduling recovery attempt #${s.reconnectAttempt} in ${finalDelay}ms`);

    s.reconnectTimer = setTimeout(async function reconnectWorker() {
        const checkAcc = await pGate.checkTenantAccess(k);
        if (!checkAcc.allowed || s.logoutIntent) {
            console.log(`[waWeb:${k}] Recovery attempt aborted: status is ${checkAcc.reason}`);
            if (!checkAcc.allowed) {
                s.status = (checkAcc.reason === 'subscription_expired') ? 'subscription_expired' : 'disconnected';
            }
            return;
        }
        start(k);
    }, finalDelay);
}

function start(tenantId) {
    const k = String(tenantId);
    const s = _session(k);

    // 🔒 Lock: إذا كانت الجلسة قيد الإقلاع بالفعل
    if (_starting.has(k)) {
        console.log(`[waWeb:${k}] start() مستدعى بينما الجلسة قيد الإقلاع — تم التجاهل`);
        return getState(k);
    }

    // 🔒 Block: إذا كانت الجلسة قيد التنظيف
    if (s.cleaning) {
        console.log(`[waWeb:${k}] start() مستدعى بينما الجلسة قيد التنظيف — تم التجاهل`);
        return getState(k);
    }

    // 🔒 Guard: جلسة شغّالة فعلاً
    if (s.client && ['starting', 'qr', 'authenticated', 'ready', 'syncing'].includes(s.status)) {
        console.log(`[waWeb:${k}] start() مستدعى والجلسة جاهزة (${s.status}) — تم التجاهل`);
        return getState(k);
    }

    // 🔒 Circuit Breaker: فحص فتح الدائرة
    if (s.circuitOpen) {
        const now = Date.now();
        if (now < s.circuitOpenUntil) {
            console.warn(`[waWeb:${k}] Start blocked: Circuit Breaker is OPEN until ${new Date(s.circuitOpenUntil).toISOString()}`);
            s.status = 'recovery_failed';
            return getState(k);
        }
        console.log(`[waWeb:${k}] Half-Open state reached: attempting single recovery trial.`);
        s.circuitOpen = false; // Reset to allow this check
        s.halfOpenTrial = true;
    }

    // إقلاع غير متزامن
    _starting.add(k);
    if (s.status !== 'syncing' && s.status !== 'starting') {
        s.status = 'starting';
    }
    s.qr = '';
    s.error = '';
    s.autoReplyActivatedTime = 0;
    s.startupTime = Math.floor(Date.now() / 1000);

    (async () => {
        try {
            // 1. تحقق من الاشتراك وصلاحية الحساب قبل كل إقلاع
            const planGate = require('./planGate');
            const access = await planGate.checkTenantAccess(k);
            if (!access.allowed) {
                console.warn(`[waWeb:${k}] Plan gate blocked startup: ${access.reason}`);
                s.status = (access.reason === 'subscription_expired') ? 'subscription_expired' : 'disconnected';
                _starting.delete(k);
                return;
            }

            _cleanLocks(k);

            const fs = require('fs');
            const path = require('path');
            const authDataPath = process.env.WWEBJS_AUTH_PATH || './.wwebjs_auth';
            const resolvedPath = path.resolve(authDataPath);
            if (!fs.existsSync(resolvedPath)) {
                fs.mkdirSync(resolvedPath, { recursive: true, mode: 0o700 });
                if (process.env.NODE_ENV === 'staging') {
                    console.log(`🛡️ [STAGING] Created staging session directory: ${resolvedPath}`);
                }
            }

            const authTimeout = getAuthTimeoutMs();
            console.log(`🚀 [waWeb:${k}] Initializing client with authTimeoutMs: ${authTimeout}`);

            const client = new Client({
                authStrategy: new LocalAuth({
                    clientId: k,
                    dataPath: resolvedPath
                }),
                authTimeoutMs: authTimeout,
                qrMaxRetries: 5,
                webVersionCache: { type: 'remote', remotePath: WEB_VERSION },
                puppeteer: {
                    headless: true,
                    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--no-zygote', '--no-first-run']
                }
            });
            s.client = client;

            client.on('qr', (qr) => {
                if (s.client !== client) return;
                _capturePid(s);
                s.status = 'qr';
                qrcode.toDataURL(qr, (err, url) => { if (!err) s.qr = url; });
                console.log(`📱 [waWeb:${k}] QR جاهز`);
            });

            client.on('loading_screen', (pct, msg) => {
                if (s.client !== client) return;
                _capturePid(s);
                s.status = 'syncing';
                s.syncPercent = pct;
                console.log(`⏳ [waWeb:${k}] تحميل ${pct}% ${msg || ''}`);
            });

            client.on('authenticated', () => {
                if (s.client !== client) return;
                _capturePid(s);
                s.status = 'syncing';
                s.qr = '';
                console.log(`🔑 [waWeb:${k}] تمت المصادقة`);
                _startReadyPoller(k);
            });

            client.on('ready', () => {
                if (s.client !== client) return;
                _capturePid(s);
                _starting.delete(k);
                s.status = 'ready';
                s.qr = '';
                s.initTries = 0;
                s.lastVerifiedAt = Date.now();
                s.reconnectAttempt = 0; // تصفير العداد بعد النجاح الفعلي
                s.circuitOpen = false;  // Ensure circuit is closed
                s.halfOpenTrial = false; // Reset Half-Open trial flag
                s.autoReplyActivatedTime = Math.floor(Date.now() / 1000);
                console.log(`✅ [waWeb:${k}] متصل وجاهز.`);
            });

            client.on('auth_failure', async (m) => {
                if (s.client !== client) return;
                _starting.delete(k);
                console.error(`❌ [waWeb:${k}] فشل المصادقة`, m);
                await cleanupSessionResources(k, 'auth_failure');
                _deleteSessionDirectory(k);
                s.error = String(m);
            });

            client.on('disconnected', async (r) => {
                if (s.client !== client) return;
                await handleTechnicalFailure(k, `disconnected: ${r}`);
            });

            // 📩 الاستماع للرسائل الواردة
            client.on('message_create', async (msg) => {
                if (s.client !== client) return;
                try {
                    if (!msg.body || msg.body.trim() === '') return;
                    if (msg.type !== 'chat') return;

                    if (msg.fromMe === true) {
                        const chatKey = msg.to;
                        if (!chatKey || (!chatKey.endsWith('@c.us') && !chatKey.endsWith('@lid'))) return;
                        if (chatKey.includes('@g.us') || chatKey.includes('status')) return;

                        const HandoffService = require('./HandoffService');
                        const cleanChatKey = HandoffService.getChatKey(chatKey);

                        const botCache = s.aiSentMsgs;
                        const msgBodyTrimred = (msg.body || '').trim();
                        if (botCache && botCache.has(msgBodyTrimred)) {
                            botCache.delete(msgBodyTrimred);
                            return;
                        }

                        const fromPhone = cleanChatKey.split('@')[0];
                        const SallaDatabase = require('../database/db_instance');
                        if (SallaDatabase.connection) {
                            await SallaDatabase.connection.models.MessageLog.create({
                                tenant_id: k,
                                direction: 'out',
                                content: msg.body || '',
                                to_phone: fromPhone,
                                status: 'sent',
                                metadata: { sender: 'human' }
                            });
                        }

                        console.log(`👤 [waWeb:${k}] Owner replied from device to ${cleanChatKey}. Pausing AI...`);
                        await HandoffService.pauseChat(k, cleanChatKey, {
                            reason: 'merchant_whatsapp_reply',
                            last_message: msg.body,
                            channel: 'phone',
                            last_human_message_at: new Date().toISOString()
                        });
                        return;
                    }

                    if (!msg.from) return;
                    if (!msg.from.endsWith('@c.us') && !msg.from.endsWith('@lid')) return;
                    if (msg.from.includes('@g.us') || msg.from.includes('status')) return;

                    try {
                        const chat = await msg.getChat();
                        if (chat && chat.isGroup) return;
                    } catch (e) {}

                    if (!s.autoReplyActivatedTime || msg.timestamp < s.autoReplyActivatedTime) return;

                    const fromPhone = msg.from.endsWith('@c.us') ? msg.from.replace('@c.us', '') : msg.from;
                    const HandoffService = require('./HandoffService');
                    const chatKey = HandoffService.getChatKey(msg.from);
                    const isPaused = await HandoffService.isPaused(k, chatKey);

                    if (isPaused) {
                        const SallaDatabase = require('../database/db_instance');
                        await SallaDatabase.connection.models.MessageLog.create({
                            tenant_id: k,
                            direction: 'in',
                            content: msg.body || '',
                            to_phone: fromPhone,
                            status: 'received'
                        });
                        return;
                    }

                    if (HandoffService.shouldTriggerHandoff(msg.body)) {
                        const planGate = require('./planGate');
                        const access = await planGate.checkTenantAccess(k);
                        if (!access.allowed) {
                            const SallaDatabase = require('../database/db_instance');
                            await SallaDatabase.connection.models.MessageLog.create({
                                tenant_id: k,
                                direction: 'in',
                                content: msg.body || '',
                                to_phone: fromPhone,
                                status: 'received'
                            });
                            return;
                        }

                        await HandoffService.pauseChat(k, chatKey, {
                            reason: 'keyword',
                            last_message: msg.body,
                            channel: 'qr'
                        });
                        const replyText = "تم تحويل محادثتك للموظف المختص، وسيتم الرد عليك في أقرب وقت ممكن. 🌸";
                        const SallaDatabase = require('../database/db_instance');

                        await SallaDatabase.connection.models.MessageLog.create({ tenant_id: k, direction: 'in', content: msg.body || '', to_phone: fromPhone, status: 'received' });
                        await SallaDatabase.connection.models.MessageLog.create({ tenant_id: k, direction: 'out', content: replyText, to_phone: fromPhone, status: 'sent' });

                        s.aiSentMsgs = s.aiSentMsgs || new Set();
                        s.aiSentMsgs.add(replyText.trim());

                        setTimeout(async () => {
                            try { await s.client.sendMessage(msg.from, replyText); } catch (e) {}
                        }, 1200);
                        return;
                    }

                    const ChatService = require('./ChatService');
                    const result = await ChatService.handleIncomingMessage({
                        fromPhone, messageBody: msg.body || '', tenantId: k, isSimulated: true
                    });
                    if (result && result.reply && s.client) {
                        try { const chat = await msg.getChat(); chat.sendStateTyping(); } catch (e) {}
                        s.aiSentMsgs = s.aiSentMsgs || new Set();
                        s.aiSentMsgs.add(result.reply.trim());
                        setTimeout(async () => { try { await s.client.sendMessage(msg.from, result.reply); } catch (e) {} }, 1200);
                    }
                } catch (e) { console.error(`[waWeb:${k}] Error in message create:`, e.message); }
            });

            await client.initialize();
        } catch (e) {
            _starting.delete(k);
            const isTimeout = isTransientAuthTimeout(e);
            const attempt = s.initTries + 1;
            console.error(`❌ [waWeb:${k}] Initialization failed on attempt ${attempt}/2. Error: ${e.message || e}`);
            
            if (isTimeout && s.initTries < 2) {
                s.initTries++;
                console.log(`⚠️ [waWeb:${k}] Temporary timeout (Attempt ${s.initTries}/2). Re-initializing client without destroying auth files...`);
                s.status = s.status === 'qr' ? 'starting' : 'syncing';
                await cleanupSessionResources(k, 'timeout_retry');
                setTimeout(() => {
                    start(k);
                }, 3000);
            } else {
                s.initTries = 0;
                await handleTechnicalFailure(k, `init_failed: ${e.message || e}`);
                s.status = 'auth_required';
                s.error = String(e.message || e);
            }
        }
    })();

    return getState(k);
}

async function sendMessage(tenantId, phone, text) {
    const s = _session(tenantId);
    if (s.status !== 'ready' || !s.client) throw new Error('WhatsApp Web غير متصل لهذا التاجر');
    s.aiSentMsgs = s.aiSentMsgs || new Set();
    s.aiSentMsgs.add(text.trim());
    return s.client.sendMessage(_chatId(phone), text);
}

async function sendImage(tenantId, phone, dataUrl, caption = '') {
    const s = _session(tenantId);
    if (s.status !== 'ready' || !s.client) throw new Error('WhatsApp Web غير متصل لهذا التاجر');
    s.aiSentMsgs = s.aiSentMsgs || new Set();
    if (caption) s.aiSentMsgs.add(caption.trim());

    const m = /^data:(.+);base64,(.+)$/.exec(dataUrl || '');
    if (!m) return sendMessage(tenantId, phone, caption);
    const media = new MessageMedia(m[1], m[2], 'image.' + (m[1].split('/')[1] || 'jpg'));
    return s.client.sendMessage(_chatId(phone), media, caption ? { caption } : {});
}

async function logout(tenantId) {
    const k = String(tenantId);
    const s = _session(k);
    s.logoutIntent = true;
    _starting.delete(k);
    await cleanupSessionResources(k, 'logout');
    _deleteSessionDirectory(k);
    s.logoutIntent = false;
}

async function restart(tenantId) {
    const k = String(tenantId);
    _starting.delete(k);
    await cleanupSessionResources(k, 'restart');
    return start(k);
}

const restoreAll = createWorker(function restoreAllSessionsWorker() {
    try {
        const fs = require('fs');
        const path = require('path');
        const authDataPath = process.env.WWEBJS_AUTH_PATH || './.wwebjs_auth';
        const authDir = path.resolve(authDataPath);
        if (!fs.existsSync(authDir)) return [];
        const ids = fs.readdirSync(authDir)
            .filter(d => d.startsWith('session-'))
            .map(d => d.replace('session-', ''))
            .filter(Boolean);
        if (!ids.length) return [];
        console.log(`🔄 [waWeb] استعادة ${ids.length} جلسة محفوظة: ${ids.join(', ')}`);
        ids.forEach((id, i) => setTimeout(() => {
            try { start(id); } catch (e) { console.error(`[waWeb] فشل استعادة ${id}:`, e.message); }
        }, i * 4000));
        return ids;
    } catch (e) {
        console.error('[waWeb] restoreAll error:', e.message);
        return [];
    }
});

async function destroyAll() {
    console.log(`🧹 [waWeb] Destroying all active WhatsApp clients gracefully...`);
    const promises = [];
    for (const [k, s] of sessions.entries()) {
        if (s.client) {
            promises.push(
                cleanupSessionResources(k, 'shutdown')
            );
        }
    }
    await Promise.all(promises);
    sessions.clear();
    console.log(`✅ [waWeb] All clients closed.`);
}

// Health check poller (runs background check every 30 seconds)
setInterval(async function healthCheckPollerWorker() {
    for (const [k, s] of sessions.entries()) {
        if (s.client && s.status === 'ready') {
            try {
                const state = await s.client.getState();
                if (state === 'CONNECTED') {
                    s.lastVerifiedAt = Date.now();
                    s.reconnectAttempt = 0; // reset reconnect count on verified connection
                } else {
                    console.warn(`⚠️ [waWeb:${k}] Health check state not CONNECTED: ${state}`);
                    s.client.emit('disconnected', 'health_check_failed');
                }
            } catch (e) {
                console.warn(`⚠️ [waWeb:${k}] Health check request failed:`, e.message);
                s.client.emit('disconnected', 'health_check_timeout');
            }
        }
    }
}, 30000);

module.exports = { start, getState, isReady, sendMessage, sendImage, logout, restart, restoreAll, destroyAll, getSessionSnapshot, cleanupSessionResources, _sessions: sessions };
