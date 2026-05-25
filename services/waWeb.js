// services/waWeb.js
// ═══════════════════════════════════════════════════════════════════
// 📱 ربط واتساب عبر whatsapp-web.js (مسح QR) — للتجربة
// ───────────────────────────────────────────────────────────────────
// قناة غير رسمية: الرسائل تطلع من واتساب الجوال الشخصي بعد مسح QR.
// ⚠️ خطر حظر أعلى من Meta الرسمي — مناسبة للتجربة لا للإنتاج الثقيل.
// تعمل عبر HTTP polling (بدون socket.io) لتبسيط التكامل.
// ═══════════════════════════════════════════════════════════════════
const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcode = require('qrcode');

let client = null;
let status = 'disconnected'; // disconnected | starting | qr | authenticated | ready | error
let qrDataUrl = '';
let lastError = '';

function getState() {
    return { status, qr: qrDataUrl, error: lastError };
}
function isReady() {
    return status === 'ready';
}

// توحيد الرقم السعودي → chatId
function _chatId(phone) {
    let s = String(phone == null ? '' : phone).replace(/\D/g, '');
    if (s.startsWith('00')) s = s.slice(2);
    if (s.startsWith('0')) s = '966' + s.slice(1);
    else if (s.startsWith('5') && s.length === 9) s = '966' + s;
    return s + '@c.us';
}

function start() {
    // إذا فيه جلسة شغّالة أو قيد الإقلاع، لا نعيد التهيئة
    if (client && ['starting', 'qr', 'authenticated', 'ready'].includes(status)) {
        return getState();
    }
    status = 'starting';
    qrDataUrl = '';
    lastError = '';

    client = new Client({
        authStrategy: new LocalAuth({ clientId: 'mobhir' }),
        // 🔧 تثبيت إصدار WhatsApp Web معروف-التوافق (يحل عَلَق "authenticated" بدون "ready")
        webVersionCache: {
            type: 'remote',
            remotePath: 'https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/2.3000.1040093096-alpha.html'
        },
        puppeteer: {
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--no-zygote', '--no-first-run']
        }
    });

    client.on('qr', (qr) => {
        status = 'qr';
        qrcode.toDataURL(qr, (err, url) => { if (!err) qrDataUrl = url; });
        console.log('📱 [waWeb] QR جاهز — امسحه من الصفحة');
    });
    client.on('loading_screen', (pct, msg) => console.log(`⏳ [waWeb] تحميل ${pct}% ${msg || ''}`));
    client.on('change_state', (s) => console.log(`🔄 [waWeb] الحالة: ${s}`));
    client.on('authenticated', () => { status = 'authenticated'; qrDataUrl = ''; console.log('🔑 [waWeb] تمت المصادقة'); });
    client.on('ready', () => { status = 'ready'; qrDataUrl = ''; console.log('✅ [waWeb] واتساب متصل وجاهز'); });
    client.on('auth_failure', (m) => { status = 'error'; lastError = String(m); console.error('❌ [waWeb] فشل المصادقة', m); });
    client.on('disconnected', (r) => { status = 'disconnected'; qrDataUrl = ''; client = null; console.warn('⚠️ [waWeb] انقطع الاتصال', r); });

    client.initialize().catch((e) => { status = 'error'; lastError = e.message; console.error('❌ [waWeb] فشل الإقلاع:', e.message); });
    return getState();
}

async function sendMessage(phone, text) {
    if (!isReady()) throw new Error('WhatsApp Web غير متصل');
    return client.sendMessage(_chatId(phone), text);
}

async function sendImage(phone, dataUrl, caption = '') {
    if (!isReady()) throw new Error('WhatsApp Web غير متصل');
    const m = /^data:(.+);base64,(.+)$/.exec(dataUrl || '');
    if (!m) return sendMessage(phone, caption);     // لو الصورة غير صالحة، أرسل النص فقط
    const media = new MessageMedia(m[1], m[2], 'image.' + (m[1].split('/')[1] || 'jpg'));
    return client.sendMessage(_chatId(phone), media, caption ? { caption } : {});
}

async function logout() {
    try { if (client) await client.logout(); } catch (e) { /* ignore */ }
    status = 'disconnected';
    qrDataUrl = '';
    client = null;
}

module.exports = { start, getState, isReady, sendMessage, sendImage, logout };
