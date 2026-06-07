// services/whatsappSender.js
// Wrapper آمن لإرسال رسائل الواتساب — يستخدم waWeb أو Meta API حسب المتاح للتاجر
// ويفشل بهدوء لو الـ client مش جاهز (ما يكسر السكربتات).

const waWeb = require('./waWeb');
const { sendMetaMessage } = require('../helpers/metaProvider');
const SallaDatabase = require('../database/db_instance');

let whatsappClient = null;
try {
    whatsappClient = require('../whatsappClient');
} catch (e) {
    console.warn('[whatsappSender] whatsappClient module not loaded:', e.message);
}

/**
 * تنظيف رقم الجوال السعودي وتحويله لصيغة WhatsApp Web (E.164 بدون +)
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
 * @param {number|string|null} tenantId معرف التاجر لتحديد قناة الاتصال الخاصة به
 * @returns {Promise<{ok:boolean, error?:string, simulated?:boolean, channel?:string}>}
 */
async function send(phone, message, tenantId = null) {
    const normalized = normalizePhone(phone);
    if (!normalized) return { ok: false, error: 'Invalid phone' };

    // 1. إذا تم تمرير tenantId، نقوم بالتوجيه الذكي المبني على باقة التاجر
    if (tenantId) {
        const planGate = require('./planGate');
        let planName = 'الأساسية';
        try {
            const plan = await planGate.getTenantPlan(tenantId);
            planName = plan ? plan.name : 'الأساسية';
        } catch (planErr) {
            console.error(`[whatsappSender] Failed to fetch plan for tenant ${tenantId}:`, planErr.message);
        }

        if (planName === 'الشركات') {
            // أ. باقة الشركات: يفضل Meta API إذا كانت إعداداتها متوفرة
            const db = SallaDatabase.connection;
            if (db) {
                const metaConfig = await db.models.WhatsAppConfig.findOne({ where: { tenant_id: tenantId } });
                if (metaConfig && metaConfig.access_token && metaConfig.access_token !== 'mock_access_token') {
                    try {
                        await sendMetaMessage(metaConfig, normalized, message);
                        return { ok: true, channel: 'meta_api' };
                    } catch (e) {
                        console.error(`[whatsappSender] Meta API failed for Enterprise tenant ${tenantId}, trying QR backup...`, e.message);
                    }
                }
            }

            // تراجع للـ QR كاحتياطي لباقة الشركات
            if (waWeb.isReady(tenantId)) {
                try {
                    await waWeb.sendMessage(tenantId, normalized, message);
                    return { ok: true, channel: 'qr' };
                } catch (e) {
                    console.error(`[whatsappSender] QR backup failed for Enterprise tenant ${tenantId}:`, e.message);
                    return { ok: false, error: `Enterprise sending failed (Meta API failed and QR backup failed: ${e.message})` };
                }
            }

            return { ok: false, error: 'No active WhatsApp channel (Meta API or QR backup) configured for this Enterprise tenant.' };

        } else {
            // ب. باقات الأساسية والنمو: يُسمح فقط بـ QR WhatsApp
            if (waWeb.isReady(tenantId)) {
                try {
                    await waWeb.sendMessage(tenantId, normalized, message);
                    return { ok: true, channel: 'qr' };
                } catch (e) {
                    console.error(`[whatsappSender] QR failed for tenant ${tenantId}:`, e.message);
                    return { ok: false, error: `QR send failed: ${e.message}` };
                }
            }

            return { ok: false, error: 'QR WhatsApp is not connected. Meta API is locked for your plan (Requires Companies plan).' };
        }
    }

    // 2. الـ Fallback القديم (عند عدم تمرير tenantId) - للتطوير المحلي فقط
    const isProduction = process.env.NODE_ENV === 'production';
    const status = whatsappClient && typeof whatsappClient.getStatus === 'function' ? whatsappClient.getStatus() : 'disconnected';

    if (status !== 'ready' || typeof whatsappClient.sendRealWhatsAppMessage !== 'function') {
        if (isProduction) {
            // في الإنتاج، لا نقبل المحاكاة كإرسال ناجح
            return { ok: false, error: 'WhatsApp not connected (Simulation blocked in production).' };
        }
        console.log(`[📱 SIM → ${normalized}] (status: ${status})\n${message}\n---`);
        return { ok: true, simulated: true };
    }

    try {
        const ok = await whatsappClient.sendRealWhatsAppMessage(normalized, message);
        return ok ? { ok: true, channel: 'global_qr' } : { ok: false, error: 'sendRealWhatsAppMessage returned false' };
    } catch (e) {
        console.error(`[whatsappSender] Failed to send to ${normalized}:`, e.message);
        return { ok: false, error: e.message };
    }
}

module.exports = { send, normalizePhone };
