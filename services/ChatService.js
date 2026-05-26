const SallaDatabase = require('../database/db_instance');
const AIService = require('./AIService');
const { sendMetaMessage } = require('../helpers/metaProvider');
const { checkLimit, incrementUsage } = require('../helpers/limitsEngine');

class ChatService {

    constructor() {
        // Lazy: SallaDatabase.connection يُقرأ لحظة الاستخدام (في كل method)
    }

    get db() {
        return SallaDatabase;
    }

    /**
     * معالجة رسالة واردة (سواء من واتساب أو المحاكي)
     * @param {Object} params 
     * @param {string} params.fromPhone - رقم العميل
     * @param {string} params.messageBody - نص الرسالة
     * @param {string} params.tenantId - معرف التاجر (اختياري، يفضل تحديده)
     * @param {string} params.whatsAppIds - (اختياري) للبحث عن التاجر عبر رقم واتساب
     * @param {boolean} params.isSimulated - هل هي محاكاة؟
     */
    async handleIncomingMessage({ fromPhone, messageBody, tenantId, whatsAppId, isSimulated = false }) {
        try {
            let tenant;

            // 1. تحديد التاجر (Tenant Identification)
            if (tenantId) {
                tenant = await SallaDatabase.connection.models.Tenant.findByPk(tenantId, { include: ['WhatsAppConfig', 'Subscription'] });
            } else if (whatsAppId) {
                // Find tenant by their WhatsApp Phone ID
                const config = await SallaDatabase.connection.models.WhatsAppConfig.findOne({
                    where: { phone_number_id: whatsAppId },
                    include: [{ model: SallaDatabase.connection.models.Tenant, include: ['Subscription'] }]
                });
                tenant = config?.Tenant;
            }

            if (!tenant) throw new Error("Tenant/Config not found for this message.");

            console.log(`💬 Incoming Message for [${tenant.store_name}]: ${messageBody}`);

            // 2. تسجيل الرسالة الواردة (مهم — نسجل دائماً)
            await SallaDatabase.connection.models.MessageLog.create({
                tenant_id: tenant.id,
                direction: 'in',
                content: messageBody,
                to_phone: fromPhone,
                status: 'received'
            });

            // 🚦 LIMIT CHECK — قبل توليد الرد وإرساله
            const limitCheck = await checkLimit(tenant.id, SallaDatabase.connection.models, 'ai_reply', 1);
            if (!limitCheck.allowed) {
                console.warn(`⛔ [LIMIT BLOCK] ChatService tenant ${tenant.id}: ${limitCheck.reason}`);
                await SallaDatabase.connection.models.MessageLog.create({
                    tenant_id: tenant.id,
                    direction: 'out',
                    content: `[LIMIT_BLOCKED] ${limitCheck.reason}`,
                    to_phone: fromPhone,
                    status: 'blocked'
                });
                return {
                    error: 'limit_reached',
                    reason: limitCheck.reason,
                    current: limitCheck.current,
                    limit: limitCheck.limit,
                    reply: '⛔ تم تجاوز الحد الشهري للرسائل في باقتك. يرجى ترقية الباقة للاستمرار.'
                };
            }

            // 3. الذكاء الاصطناعي (AI Logic)
            const aiReply = await AIService.generateReply(tenant.id, messageBody, 'Customer');

            console.log(`🤖 AI Reply: ${aiReply}`);

            // 4. إرسال الرد
            if (isSimulated) {
                await SallaDatabase.connection.models.MessageLog.create({
                    tenant_id: tenant.id,
                    direction: 'out',
                    content: aiReply,
                    to_phone: fromPhone,
                    status: 'sent'
                });
                await incrementUsage(tenant.id, SallaDatabase.connection.models, 1);
                return { reply: aiReply };

            } else {
                if (tenant.WhatsAppConfig && tenant.WhatsAppConfig.access_token) {
                    await sendMetaMessage(
                        tenant.WhatsAppConfig,
                        fromPhone,
                        aiReply
                    );
                }

                await SallaDatabase.connection.models.MessageLog.create({
                    tenant_id: tenant.id,
                    direction: 'out',
                    content: aiReply,
                    to_phone: fromPhone,
                    status: 'sent'
                });
                await incrementUsage(tenant.id, SallaDatabase.connection.models, 1);

                return { status: 'sent', reply: aiReply };
            }

        } catch (error) {
            console.error("❌ ChatService Error:", error);
            return { error: error.message };
        }
    }
}

module.exports = new ChatService();
