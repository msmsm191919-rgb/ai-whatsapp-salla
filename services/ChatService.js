const SallaDatabase = require('../database/db_instance');
const AIService = require('./AIService');
const { sendMetaMessage } = require('../helpers/metaProvider');

class ChatService {

    constructor() {
        this.db = SallaDatabase.connection;
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
                tenant = await this.db.models.Tenant.findByPk(tenantId, { include: ['WhatsAppConfig', 'Subscription'] });
            } else if (whatsAppId) {
                // Find tenant by their WhatsApp Phone ID
                const config = await this.db.models.WhatsAppConfig.findOne({
                    where: { phone_number_id: whatsAppId },
                    include: [{ model: this.db.models.Tenant, include: ['Subscription'] }]
                });
                tenant = config?.Tenant;
            }

            if (!tenant) throw new Error("Tenant/Config not found for this message.");

            console.log(`💬 Incoming Message for [${tenant.store_name}]: ${messageBody}`);

            // 2. تسجيل الرسالة الواردة
            await this.db.models.MessageLog.create({
                tenant_id: tenant.id,
                direction: 'in',
                content: messageBody,
                to_phone: fromPhone, // In this context, 'to_phone' is the customer phone user interacts with
                status: 'received'
            });

            // 3. الذكاء الاصطناعي (AI Logic)
            // نستخدم خدمة AI التي طورناها لإنشاء الرد
            const aiReply = await AIService.generateReply(tenant.id, messageBody, 'Customer');

            console.log(`🤖 AI Reply: ${aiReply}`);

            // 4. إرسال الرد
            if (isSimulated) {
                // للمحاكي: نعيد الرد مباشرة
                // ونسجله أيضاً
                await this.db.models.MessageLog.create({
                    tenant_id: tenant.id,
                    direction: 'out',
                    content: aiReply,
                    to_phone: fromPhone,
                    status: 'sent'
                });
                return { reply: aiReply };

            } else {
                // لواتساب الحقيقي: نرسل عبر API
                if (tenant.WhatsAppConfig && tenant.WhatsAppConfig.access_token) {
                    await sendMetaMessage(
                        tenant.WhatsAppConfig, // Pass the whole object
                        fromPhone,
                        aiReply
                    );
                }

                // نسجل الرد
                await this.db.models.MessageLog.create({
                    tenant_id: tenant.id,
                    direction: 'out',
                    content: aiReply,
                    to_phone: fromPhone,
                    status: 'sent'
                });

                return { status: 'sent', reply: aiReply };
            }

        } catch (error) {
            console.error("❌ ChatService Error:", error);
            return { error: error.message };
        }
    }
}

module.exports = new ChatService();
