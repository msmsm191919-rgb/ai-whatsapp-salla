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

// خريطة الجلسات: المفتاح = معرّف التاجر، القيمة = حالة جلسته
// { client, status, qr, error, poller, autoReplyActivatedTime }
const sessions = new Map();

// 🔒 قفل داخلي: يمنع تشغيل start() المتزامن لنفس tenantId
const _starting = new Set();

function _session(tenantId) {
    const k = String(tenantId);
    if (!sessions.has(k)) {
        sessions.set(k, { client: null, status: 'disconnected', qr: '', error: '', poller: null, autoReplyActivatedTime: 0, initTries: 0 });
    }
    return sessions.get(k);
}

function getState(tenantId) {
    const s = _session(tenantId);
    return { status: s.status, qr: s.qr, error: s.error };
}
function isReady(tenantId) {
    return _session(tenantId).status === 'ready';
}

// 🔁 فحص احتياطي: حدث 'ready' متقلّب — نتأكد عبر client.getState()
function _startReadyPoller(tenantId) {
    const s = _session(tenantId);
    if (s.poller) return;
    let tries = 0;
    s.poller = setInterval(async () => {
        tries++;
        if (s.status === 'ready' || tries > 40 || !s.client) { clearInterval(s.poller); s.poller = null; return; }
        try {
            if (await s.client.getState() === 'CONNECTED') {
                s.status = 'ready'; s.qr = '';
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
        const sessDir = path.join(process.cwd(), '.wwebjs_auth', 'session-' + clientId);
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

async function _destroyClient(k) {
    const s = sessions.get(k);
    if (!s) return;
    if (s.poller) { clearInterval(s.poller); s.poller = null; }
    if (s.client) {
        try { await s.client.destroy(); } catch (e) { /* تجاهل أخطاء التدمير */ }
        s.client = null;
    }
}

function start(tenantId) {
    const k = String(tenantId);
    const s = _session(k);

    // 🔒 Lock: إذا كانت الجلسة قيد الإقلاع بالفعل → لا ننشئ client ثانٍ
    if (_starting.has(k)) {
        console.log(`[waWeb:${k}] start() مستدعى بينما الجلسة قيد الإقلاع — تم التجاهل`);
        return getState(k);
    }

    // 🔒 Guard: جلسة شغّالة فعلاً بـ client حيّ → لا نعيد التهيئة
    if (s.client && ['starting', 'qr', 'authenticated', 'ready'].includes(s.status)) {
        console.log(`[waWeb:${k}] start() مستدعى والجلسة جاهزة (${s.status}) — تم التجاهل`);
        return getState(k);
    }

    // 🧹 تدمير آمن لأي client قديم قبل إنشاء client جديد
    if (s.client) {
        console.log(`[waWeb:${k}] تدمير client قديم قبل إنشاء جديد...`);
        _destroyClient(k).catch(() => {});
    } else if (s.poller) {
        clearInterval(s.poller);
        s.poller = null;
    }

    _starting.add(k);
    s.status = 'starting';
    s.qr = '';
    s.error = '';
    s.autoReplyActivatedTime = 0;
    s.startupTime = Math.floor(Date.now() / 1000);
    _cleanLocks(k);

    const client = new Client({
        authStrategy: new LocalAuth({ clientId: k }),   // 🔑 جلسة منفصلة لكل تاجر
        webVersionCache: { type: 'remote', remotePath: WEB_VERSION },
        puppeteer: {
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--no-zygote', '--no-first-run']
        }
    });
    s.client = client;

    client.on('qr', (qr) => {
        // تأكد أن هذا الـ client لا يزال هو الـ client الفعلي للجلسة
        if (s.client !== client) return;
        s.initTries = 0; // Reset retry counter on successful QR generation
        s.status = 'qr';
        qrcode.toDataURL(qr, (err, url) => { if (!err) s.qr = url; });
        console.log(`📱 [waWeb:${k}] QR جاهز`);
    });

    client.on('loading_screen', (pct, msg) => {
        if (s.client !== client) return;
        console.log(`⏳ [waWeb:${k}] تحميل ${pct}% ${msg || ''}`);
    });

    client.on('authenticated', () => {
        if (s.client !== client) return;
        s.status = 'authenticated';
        s.qr = '';
        console.log(`🔑 [waWeb:${k}] تمت المصادقة`);
        _startReadyPoller(k);
    });

    client.on('ready', () => {
        if (s.client !== client) return;
        _starting.delete(k); // 🔓 رفع القفل
        s.initTries = 0; // Reset retry counter on successful connection
        s.status = 'ready';
        s.qr = '';
        s.autoReplyActivatedTime = Math.floor(Date.now() / 1000);
        console.log(`✅ [waWeb:${k}] متصل وجاهز. وقت تفعيل الرد التلقائي: ${s.autoReplyActivatedTime}`);
    });

    client.on('auth_failure', (m) => {
        if (s.client !== client) return;
        _starting.delete(k); // 🔓 رفع القفل عند الفشل
        s.status = 'error';
        s.error = String(m);
        console.error(`❌ [waWeb:${k}] فشل المصادقة`, m);
    });

    client.on('disconnected', (r) => {
        if (s.client !== client) return; // تجاهل أحداث client قديم
        _starting.delete(k); // 🔓 رفع القفل عند الانقطاع
        if (s.poller) { clearInterval(s.poller); s.poller = null; } // 🧹 إيقاف الـ poller
        s.status = 'disconnected';
        s.qr = '';
        s.client = null;
        console.warn(`⚠️ [waWeb:${k}] انقطع`, r);
    });

    // 💬 رد تلقائي ذكي على الرسائل الواردة الجديدة فقط (يتجاهل القديمة المعلقة تماماً)
    client.on('message', async (msg) => {
        if (s.client !== client) return; // تجاهل أحداث client قديم
        try {
            // 1. التحقق من الشروط الأساسية
            if (!msg.body || msg.body.trim() === '') return;
            if (msg.type !== 'chat') return;
            if (!msg.from) return;
            if (!msg.from.endsWith('@c.us') && !msg.from.endsWith('@lid')) return;
            if (msg.from.includes('@g.us')) return;
            if (msg.from.includes('status')) return;
            if (msg.fromMe) return;

            // ليست مجموعة: لا @g.us ويفضل chat.isGroup !== true إن أمكن
            try {
                const chat = await msg.getChat();
                if (chat && chat.isGroup) return;
            } catch (e) {}

            // 2. التحقق من وقت التفعيل (أي رسالة تصل بعد ready/الربط)
            if (!s.autoReplyActivatedTime || msg.timestamp < s.autoReplyActivatedTime) {
                console.log(`ℹ️ [waWeb:${k}] Ignored old message from ${msg.from} sent at ${msg.timestamp} (activated: ${s.autoReplyActivatedTime})`);
                return;
            }

            const fromPhone = msg.from.endsWith('@c.us')
                ? msg.from.replace('@c.us', '')
                : msg.from;

            const ChatService = require('./ChatService');
            // isSimulated:true → يولّد رد + يسجّل بدون إرسال (سنرسل نحن عبر waWeb)
            const result = await ChatService.handleIncomingMessage({
                fromPhone, messageBody: msg.body || '', tenantId: k, isSimulated: true
            });
            if (result && result.reply && s.client) {
                try { const chat = await msg.getChat(); chat.sendStateTyping(); } catch (e) {}
                setTimeout(async () => { try { await s.client.sendMessage(msg.from, result.reply); } catch (e) { console.error(`[waWeb:${k}] فشل إرسال الرد:`, e.message); } }, 1200);
            }
        } catch (e) { console.error(`[waWeb:${k}] خطأ معالجة رسالة واردة:`, e.message); }
    });

    client.initialize().catch(async (e) => {
        if (s.client !== client) return;
        _starting.delete(k); // 🔓 رفع القفل عند خطأ الإقلاع

        // Check if error is context destruction or navigation related
        const isContextError = /context was destroyed|navigation|Protocol error/i.test(e.message);

        if (isContextError && (!s.initTries || s.initTries < 3)) {
            s.initTries = (s.initTries || 0) + 1;
            
            // Set intermediate state so user sees "initializing_recovery" message instead of error
            s.status = 'initializing_recovery';
            s.qr = '';
            s.error = '';

            // Log detailed error stack trace along with metadata
            const errorTime = new Date().toISOString();
            console.warn(`[RECOVERY] [waWeb:${k}] Attempt ${s.initTries}/3 failed at ${errorTime} during initialization phase.`);
            console.warn(`Error Stack trace:\n${e.stack || e}`);

            // Clean up current client to prevent resource/Chrome leak
            try {
                await client.destroy();
            } catch (err) {
                console.error(`[waWeb:${k}] Error destroying client during recovery:`, err.message);
            }
            s.client = null;

            // Delete corrupted session directory only for context/navigation errors
            try {
                const fs = require('fs');
                const path = require('path');
                const sessDir = path.join(process.cwd(), '.wwebjs_auth', 'session-' + k);
                if (fs.existsSync(sessDir)) {
                    fs.rmSync(sessDir, { recursive: true, force: true });
                    console.log(`[RECOVERY] [waWeb:${k}] Successfully deleted corrupted session directory: ${sessDir}`);
                }
            } catch (err) {
                console.error(`[waWeb:${k}] Error deleting session directory:`, err.message);
            }

            // Retry startup after 3 seconds
            setTimeout(() => {
                start(k);
            }, 3000);
            return;
        }

        // Final failure after 3 attempts or for general errors
        s.initTries = 0;
        s.status = 'error';
        s.error = e.message;
        s.client = null;
        
        const finalErrorTime = new Date().toISOString();
        console.error(`❌ [waWeb:${k}] Final initialization failure at ${finalErrorTime}. Stack trace:\n${e.stack || e}`);

        try {
            await client.destroy();
        } catch (err) {
            // ignore
        }
    });
    return getState(k);
}

async function sendMessage(tenantId, phone, text) {
    const s = _session(tenantId);
    if (s.status !== 'ready' || !s.client) throw new Error('WhatsApp Web غير متصل لهذا التاجر');
    return s.client.sendMessage(_chatId(phone), text);
}

async function sendImage(tenantId, phone, dataUrl, caption = '') {
    const s = _session(tenantId);
    if (s.status !== 'ready' || !s.client) throw new Error('WhatsApp Web غير متصل لهذا التاجر');
    const m = /^data:(.+);base64,(.+)$/.exec(dataUrl || '');
    if (!m) return sendMessage(tenantId, phone, caption);
    const media = new MessageMedia(m[1], m[2], 'image.' + (m[1].split('/')[1] || 'jpg'));
    return s.client.sendMessage(_chatId(phone), media, caption ? { caption } : {});
}

async function logout(tenantId) {
    const k = String(tenantId);
    const s = _session(k);
    _starting.delete(k);
    try { if (s.client) await s.client.logout(); } catch (e) { /* ignore */ }
    await _destroyClient(k);
    s.status = 'disconnected';
    s.qr = '';
}

// 🔁 إعادة تشغيل الجلسة (إغلاق المتصفح ثم إقلاع) — تحتفظ بالربط، لإصلاح العالق
async function restart(tenantId) {
    const k = String(tenantId);
    _starting.delete(k); // 🔓 رفع أي قفل قديم قبل الإعادة
    await _destroyClient(k);
    _session(k).status = 'disconnected';
    _session(k).qr = '';
    return start(k);
}

// 🔄 استعادة كل الجلسات المحفوظة عند إقلاع الخادم
// يفحص مجلدات .wwebjs_auth/session-<id> ويعيد تشغيل كل تاجر متصل سابقاً
// (مُوزّع زمنياً لتجنّب إقلاع عدّة متصفحات دفعة واحدة)
function restoreAll() {
    try {
        const fs = require('fs');
        const path = require('path');
        const authDir = path.join(process.cwd(), '.wwebjs_auth');
        if (!fs.existsSync(authDir)) return [];
        const ids = fs.readdirSync(authDir)
            .filter(d => d.startsWith('session-'))
            .map(d => d.replace('session-', ''))
            .filter(Boolean);
        if (!ids.length) return [];
        console.log(`🔄 [waWeb] استعادة ${ids.length} جلسة محفوظة: ${ids.join(', ')}`);
        ids.forEach((id, i) => setTimeout(() => {
            try { start(id); } catch (e) { console.error(`[waWeb] فشل استعادة ${id}:`, e.message); }
        }, i * 4000)); // 4 ثوانٍ بين كل جلسة لتخفيف الحمل
        return ids;
    } catch (e) {
        console.error('[waWeb] restoreAll error:', e.message);
        return [];
    }
}

async function destroyAll() {
    console.log(`🧹 [waWeb] Destroying all active WhatsApp clients gracefully...`);
    const promises = [];
    for (const [k, s] of sessions.entries()) {
        if (s.client) {
            console.log(`- Closing client session: ${k}`);
            if (s.poller) { clearInterval(s.poller); s.poller = null; }
            promises.push(
                s.client.destroy().catch(e => console.error(`Error destroying client ${k}:`, e.message))
            );
        }
    }
    await Promise.all(promises);
    sessions.clear();
    console.log(`✅ [waWeb] All clients closed.`);
}

module.exports = { start, getState, isReady, sendMessage, sendImage, logout, restart, restoreAll, destroyAll };
