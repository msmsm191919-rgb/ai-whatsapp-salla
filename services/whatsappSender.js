// services/whatsappSender.js
// Wrapper آمن لإرسال رسائل الواتساب — يستخدم whatsappClient الموجود
// ويفشل بهدوء لو الـ client مش جاهز (ما يكسر السكربتات).

let whatsappClient = null;
try {
    whatsappClient = require('../whatsappClient');
} catch (e) {
    console.warn('[whatsappSender] whatsappClient module not loaded:', e.message);
}

/**
 * تنظيف رقم الجوال السعودي وتحويله لصيغة WhatsApp Web (E.164 بدون +)
 * 0501234567 → 966501234567
 * +966501234567 → 966501234567
 */
function normalizePhone(phone) {
    if (!phone) return null;
    let p = String(phone).replace(/[^\d]/g, '');
    if (p.startsWith('00')) p = p.slice(2);
    if (p.startsWith('0')) p = '966' + p.slice(1);
    if (p.length === 9 && p.startsWith('5')) p = '966' + p;
    return p;
}

/**
 * إرسال رسالة نصية لعميل
 * @param {string} phone   رقم الجوال
 * @param {string} message نص الرسالة
 * @returns {Promise<{ok:boolean, error?:string, simulated?:boolean}>}
 */
async function send(phone, message) {
    const normalized = normalizePhone(phone);
    if (!normalized) return { ok: false, error: 'Invalid phone' };

    const status = whatsappClient && typeof whatsappClient.getStatus === 'function' ? whatsappClient.getStatus() : 'disconnected';

    // وضع المحاكاة لو الـ client مش جاهز (تطوير محلي أو لم يُمسح QR بعد)
    if (status !== 'ready' || typeof whatsappClient.sendRealWhatsAppMessage !== 'function') {
        console.log(`[📱 SIM → ${normalized}] (status: ${status})\n${message}\n---`);
        return { ok: true, simulated: true };
    }

    try {
        const ok = await whatsappClient.sendRealWhatsAppMessage(normalized, message);
        return ok ? { ok: true } : { ok: false, error: 'sendRealWhatsAppMessage returned false' };
    } catch (e) {
        console.error(`[whatsappSender] Failed to send to ${normalized}:`, e.message);
        return { ok: false, error: e.message };
    }
}

module.exports = { send, normalizePhone };
