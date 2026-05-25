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
// { client, status, qr, error, poller }
const sessions = new Map();

function _session(tenantId) {
    const k = String(tenantId);
    if (!sessions.has(k)) {
        sessions.set(k, { client: null, status: 'disconnected', qr: '', error: '', poller: null });
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
    let s = String(phone == null ? '' : phone).replace(/\D/g, '');
    if (s.startsWith('00')) s = s.slice(2);
    if (s.startsWith('0')) s = '966' + s.slice(1);
    else if (s.startsWith('5') && s.length === 9) s = '966' + s;
    return s + '@c.us';
}

function start(tenantId) {
    const k = String(tenantId);
    const s = _session(k);
    // جلسة شغّالة أو قيد الإقلاع → لا نعيد التهيئة
    if (s.client && ['starting', 'qr', 'authenticated', 'ready'].includes(s.status)) {
        return getState(k);
    }
    s.status = 'starting';
    s.qr = '';
    s.error = '';
    _cleanLocks(k);

    s.client = new Client({
        authStrategy: new LocalAuth({ clientId: k }),   // 🔑 جلسة منفصلة لكل تاجر
        webVersionCache: { type: 'remote', remotePath: WEB_VERSION },
        puppeteer: {
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--no-zygote', '--no-first-run']
        }
    });

    s.client.on('qr', (qr) => {
        s.status = 'qr';
        qrcode.toDataURL(qr, (err, url) => { if (!err) s.qr = url; });
        console.log(`📱 [waWeb:${k}] QR جاهز`);
    });
    s.client.on('loading_screen', (pct, msg) => console.log(`⏳ [waWeb:${k}] تحميل ${pct}% ${msg || ''}`));
    s.client.on('authenticated', () => { s.status = 'authenticated'; s.qr = ''; console.log(`🔑 [waWeb:${k}] تمت المصادقة`); _startReadyPoller(k); });
    s.client.on('ready', () => { s.status = 'ready'; s.qr = ''; console.log(`✅ [waWeb:${k}] متصل وجاهز`); });
    s.client.on('auth_failure', (m) => { s.status = 'error'; s.error = String(m); console.error(`❌ [waWeb:${k}] فشل المصادقة`, m); });
    s.client.on('disconnected', (r) => { s.status = 'disconnected'; s.qr = ''; s.client = null; console.warn(`⚠️ [waWeb:${k}] انقطع`, r); });

    s.client.initialize().catch((e) => { s.status = 'error'; s.error = e.message; console.error(`❌ [waWeb:${k}] فشل الإقلاع:`, e.message); });
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
    const s = _session(tenantId);
    try { if (s.client) await s.client.logout(); } catch (e) { /* ignore */ }
    if (s.poller) { clearInterval(s.poller); s.poller = null; }
    s.status = 'disconnected';
    s.qr = '';
    s.client = null;
}

// 🔁 إعادة تشغيل الجلسة (إغلاق المتصفح ثم إقلاع) — تحتفظ بالربط، لإصلاح العالق
async function restart(tenantId) {
    const s = _session(tenantId);
    try { if (s.client) await s.client.destroy(); } catch (e) { /* ignore */ }
    if (s.poller) { clearInterval(s.poller); s.poller = null; }
    s.client = null;
    s.status = 'disconnected';
    s.qr = '';
    return start(tenantId);
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

module.exports = { start, getState, isReady, sendMessage, sendImage, logout, restart, restoreAll };
