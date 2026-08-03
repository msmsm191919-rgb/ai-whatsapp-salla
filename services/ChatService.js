"use strict";

const SallaDatabase = require('../database/db_instance');
const AIService = require('./AIService');
const HandoffService = require('./HandoffService');
const { sendMetaMessage } = require('../helpers/metaProvider');
const { checkLimit, incrementUsage } = require('../helpers/limitsEngine');
const waWeb = require('./waWeb');
const { Op } = require('sequelize');

class ChatService {

    constructor() {
        // Lazy loading helper
    }

    get db() {
        return SallaDatabase;
    }

    /**
     * Normalizes phone numbers to prevent cross-format query mismatches (+966 vs 00966 vs 966)
     */
    normalizePhone(phone) {
        if (!phone) return '';
        let cleaned = String(phone).replace(/\D/g, '');
        if (cleaned.startsWith('00')) cleaned = cleaned.slice(2);
        if (cleaned.startsWith('0')) cleaned = '966' + cleaned.slice(1);
        return cleaned;
    }

    /**
     * Fetches scoped, chronological previous messages for context memory.
     * Enforces tenant_id + exact phone variants isolation, excluding current message, failed logs, & non-interactive notifications.
     */
    async getScopedPreviousMessages(tenantId, fromPhone, currentMsgId = null) {
        try {
            const db = SallaDatabase.connection;
            if (!db || !db.models || !db.models.MessageLog) return [];

            const cleanPhone = String(fromPhone || '').trim();
            if (!cleanPhone) return [];

            const normalized = this.normalizePhone(cleanPhone);
            if (!normalized || normalized.length < 8) return [];

            const rawWithoutSuffix = cleanPhone.replace('@c.us', '');
            // Exact candidate phone string variants to match stored format without SQL wildcards or duplicate @c.us
            const phoneVariants = Array.from(new Set([
                rawWithoutSuffix,
                normalized,
                '+' + normalized,
                '00' + normalized,
                '0' + (normalized.startsWith('966') ? normalized.slice(3) : normalized),
                rawWithoutSuffix + '@c.us',
                normalized + '@c.us'
            ])).filter(v => v && v.length >= 8);

            const whereClause = {
                tenant_id: tenantId,
                to_phone: { [Op.in]: phoneVariants },
                status: { [Op.ne]: 'failed' }
            };

            // Exclude current message if a valid numeric ID is provided
            if (currentMsgId && !isNaN(Number(currentMsgId))) {
                whereClause.id = { [Op.ne]: Number(currentMsgId) };
            }

            // Fetch last 15 messages ordered DESC (newest first)
            const rawLogs = await db.models.MessageLog.findAll({
                where: whereClause,
                order: [
                    ['created_at', 'DESC'],
                    ['id', 'DESC']
                ],
                limit: 15
            });

            if (!rawLogs || rawLogs.length === 0) return [];

            const nonInteractiveScenarios = ['campaign', 'order_notification', 'cart_recovery', 'review_request', 'system_notification'];

            // Application-level filtering: preserve interactive AI chat replies while excluding groups & non-interactive notifications
            const filteredLogs = rawLogs.filter(log => {
                const phone = String(log.to_phone || '');
                if (phone.endsWith('@g.us')) return false; // Exclude groups
                const meta = log.metadata || {};
                if (meta.is_campaign === true) return false; // Exclude campaigns
                if (meta.scenario && nonInteractiveScenarios.includes(meta.scenario)) return false; // Exclude non-interactive scenarios
                return true;
            });

            // Reverse in JavaScript so AI receives oldest to newest chronologically
            const sortedLogs = filteredLogs.reverse();

            return sortedLogs.map(log => ({
                role: log.direction === 'out' ? 'assistant' : 'user',
                content: log.content
            }));
        } catch (e) {
            console.error("❌ Failed to fetch scoped previousMessages:", e.message);
            return [];
        }
    }

    /**
     * معالجة رسالة واردة مع تطبيق Idempotency و FSM والـ Hard Stop
     */
    async handleIncomingMessage({ fromPhone, messageBody, tenantId, whatsAppId, isSimulated = false, messageId = null }) {
        try {
            let tenant;

            // 1. تحديد التاجر (Tenant Identification)
            if (tenantId) {
                tenant = await SallaDatabase.connection.models.Tenant.findByPk(tenantId, { include: ['WhatsAppConfig', 'Subscription'] });
            } else if (whatsAppId) {
                const config = await SallaDatabase.connection.models.WhatsAppConfig.findOne({
                    where: { phone_number_id: whatsAppId },
                    include: [{ model: SallaDatabase.connection.models.Tenant, include: ['Subscription'] }]
                });
                tenant = config?.Tenant;
            }

            if (!tenant) throw new Error("Tenant/Config not found for this message.");

            console.log(`💬 Incoming Message for [${tenant.store_name}]: ${messageBody}`);

            // 1.5. Handoff Guard Check - Silent suppression (no repeated auto-reply)
            const chatKey = HandoffService.getChatKey(fromPhone);
            const isPaused = await HandoffService.isPaused(tenant.id, chatKey);
            if (isPaused) {
                console.log(`[ChatService] AI reply paused for tenant ${tenant.id} chat ${fromPhone} (Handoff Active). Returning silent suppression.`);
                return {
                    status: 'handoff_paused',
                    reply: null
                };
            }

            // If idempotency features are disabled by feature flag, run fallback behavior
            if (process.env.IDEMPOTENCY_ENABLED !== 'true') {
                return await this._handleFallback({ fromPhone, messageBody, tenant, isSimulated });
            }

            const db = SallaDatabase.connection;
            const crypto = require('crypto');
            
            // Generate deterministic message id if not passed
            const msgUniqueId = messageId || 'in_' + crypto.createHash('md5').update(String(fromPhone) + '_' + String(messageBody)).digest('hex');
            const conversationKey = String(tenant.id) + '_' + String(fromPhone);

            let jobRecord = null;
            let alreadySentReply = null;
            let needsAiGeneration = true;
            let generatedText = null;

            await db.transaction(async (t) => {
                let record = await db.models.InboundIdempotency.findOne({
                    where: { tenant_id: tenant.id, message_id: msgUniqueId },
                    lock: t.LOCK.UPDATE,
                    transaction: t
                });

                if (record) {
                    if (record.status === 'sent') {
                        alreadySentReply = record.generated_reply_text;
                        return;
                    }
                    if (['processing', 'dispatching'].includes(record.status)) {
                        throw new Error("Message is currently being processed by another worker process.");
                    }
                    if (record.status === 'generated') {
                        needsAiGeneration = false;
                        generatedText = record.generated_reply_text;
                        await record.update({
                            status: 'processing',
                            attempt_count: record.attempt_count + 1,
                            last_attempt_at: db.Sequelize.literal(db.options.dialect === 'sqlite' ? "datetime('now')" : "NOW()")
                        }, { transaction: t });
                        jobRecord = record;
                        return;
                    }
                    await record.update({
                        status: 'processing',
                        attempt_count: record.attempt_count + 1,
                        last_attempt_at: db.Sequelize.literal(db.options.dialect === 'sqlite' ? "datetime('now')" : "NOW()")
                    }, { transaction: t });
                    jobRecord = record;
                    needsAiGeneration = !record.generated_reply_text;
                    generatedText = record.generated_reply_text;
                } else {
                    let seqRecord = await db.models.ConversationSequence.findOne({
                        where: { tenant_id: tenant.id, conversation_key: conversationKey },
                        lock: t.LOCK.UPDATE,
                        transaction: t
                    });

                    let nextSeq = 1;
                    if (!seqRecord) {
                        seqRecord = await db.models.ConversationSequence.create({
                            tenant_id: tenant.id,
                            conversation_key: conversationKey,
                            last_sequence_number: 1
                        }, { transaction: t });
                    } else {
                        nextSeq = Number(seqRecord.last_sequence_number) + 1;
                        await seqRecord.update({ last_sequence_number: nextSeq }, { transaction: t });
                    }

                    jobRecord = await db.models.InboundIdempotency.create({
                        tenant_id: tenant.id,
                        message_id: msgUniqueId,
                        sender_id: String(fromPhone),
                        normalized_whatsapp_id: String(fromPhone),
                        chat_id: String(fromPhone),
                        message_body: messageBody,
                        conversation_key: conversationKey,
                        sequence_number: nextSeq,
                        status: 'processing',
                        attempt_count: 1
                    }, { transaction: t });
                }
            });

            if (alreadySentReply) {
                console.log(`[ChatService] Deduplication match! Returning response for ${msgUniqueId}.`);
                return { reply: alreadySentReply };
            }

            // 2. Hard Stop guard checks before AI execution
            const isReady = await waWeb.verifyLockActive(tenant.id);
            if (!isReady && !isSimulated) {
                console.warn(`[ChatService] Hard stop triggered: WhatsApp not connected. Message queued.`);
                await jobRecord.update({
                    status: 'retryable',
                    last_error: 'Hard Stop: WhatsApp is not ready'
                });
                return {
                    status: 'queued',
                    reply: 'تم استلام رسالتك وهي قيد الانتظار لحين اتصال النظام. ⏳'
                };
            }

            // 3. AI Generation Guard
            let aiReply = generatedText;
            if (needsAiGeneration) {
                const limitCheck = await checkLimit(tenant.id, db.models, 'ai_reply', 1);
                if (!limitCheck.allowed) {
                    await jobRecord.update({
                        status: 'failed_permanent',
                        last_error: `Limit reached: ${limitCheck.reason}`
                    });
                    return {
                        error: 'limit_reached',
                        reply: '⛔ تم تجاوز الحد الشهري للرسائل في باقتك.'
                    };
                }

                // Anti-Spam burst protection
                const twoMinutesAgo = new Date(Date.now() - 2 * 60 * 1000);
                const recentMessageCount = await db.models.InboundIdempotency.count({
                    where: {
                        tenant_id: tenant.id,
                        sender_id: String(fromPhone),
                        status: 'sent',
                        created_at: { [Op.gte]: twoMinutesAgo }
                    }
                });

                if (recentMessageCount >= 8) {
                    console.warn(`⚠️ [ChatService] Anti-Spam burst protection triggered for ${fromPhone}. Pausing AI...`);
                    await HandoffService.pauseChat(tenant.id, chatKey, {
                        reason: 'bot_loop_detected',
                        last_message: messageBody
                    });
                    await jobRecord.update({
                        status: 'failed_permanent',
                        last_error: 'Anti-Spam: Bot loop detected.'
                    });
                    return { error: 'anti_spam_triggered', reply: null };
                }

                // Fetch scoped chronological previousMessages
                const previousMessages = await this.getScopedPreviousMessages(tenant.id, fromPhone, msgUniqueId);

                // Call OpenAI with history and simulation options
                aiReply = await AIService.generateReply(tenant.id, messageBody, 'Customer', previousMessages, {
                    isSimulator: isSimulated,
                    skipUsage: isSimulated,
                    skipAiUsageLog: isSimulated
                });
                
                await jobRecord.update({
                    status: 'generated',
                    generated_reply_text: aiReply,
                    generated_at: db.Sequelize.literal(db.options.dialect === 'sqlite' ? "datetime('now')" : "NOW()")
                });
            }

            await jobRecord.update({ status: 'dispatching' });

            let sendSuccess = false;
            let sendError = null;

            try {
                if (isSimulated) {
                    sendSuccess = true;
                } else {
                    if (tenant.WhatsAppConfig && tenant.WhatsAppConfig.access_token && tenant.WhatsAppConfig.access_token !== 'mock_access_token') {
                        await sendMetaMessage(tenant.WhatsAppConfig, fromPhone, aiReply);
                        sendSuccess = true;
                    } else {
                        await waWeb.sendMessage(tenant.id, fromPhone, aiReply);
                        sendSuccess = true;
                    }
                }
            } catch (err) {
                sendError = err.message;
                console.error(`[ChatService] Delivery failed for message ${msgUniqueId}:`, sendError);
            }

            if (sendSuccess) {
                const msgLog = await db.models.MessageLog.create({
                    tenant_id: tenant.id,
                    direction: 'out',
                    content: aiReply,
                    to_phone: fromPhone,
                    status: 'sent'
                });

                await jobRecord.update({
                    status: 'sent',
                    completed_at: db.Sequelize.literal(db.options.dialect === 'sqlite' ? "datetime('now')" : "NOW()"),
                    reply_message_log_id: msgLog.id
                });

                await incrementUsage(tenant.id, db.models, 1);
                return { status: 'sent', reply: aiReply };
            } else {
                const attempts = Number(jobRecord.attempt_count);
                const maxAttempts = Number(jobRecord.max_attempts || 5);
                
                if (attempts >= maxAttempts) {
                    await jobRecord.update({
                        status: 'dead_letter',
                        dead_lettered_at: db.Sequelize.literal(db.options.dialect === 'sqlite' ? "datetime('now')" : "NOW()"),
                        last_error: sendError
                    });
                } else {
                    const delaySeconds = Math.pow(2, attempts) * 15;
                    await jobRecord.update({
                        status: 'retryable',
                        last_error: sendError,
                        next_attempt_at: db.Sequelize.literal(db.options.dialect === 'sqlite' ? `datetime('now', '+${delaySeconds} seconds')` : `DATE_ADD(NOW(), INTERVAL ${delaySeconds} SECOND)`)
                    });
                }
                throw new Error(`Delivery failed: ${sendError}`);
            }

        } catch (error) {
            console.error("❌ ChatService Error:", error);
            return { error: error.message };
        }
    }

    /**
     * Fallback معالجة الرسائل بدون Idempotency
     */
    async _handleFallback({ fromPhone, messageBody, tenant, isSimulated }) {
        // Handoff Guard Check
        const chatKey = HandoffService.getChatKey(fromPhone);
        const isPaused = await HandoffService.isPaused(tenant.id, chatKey);
        if (isPaused) {
            console.log(`[_handleFallback] AI reply paused for tenant ${tenant.id} chat ${fromPhone} (Handoff Active). Returning silent suppression.`);
            return { status: 'handoff_paused', reply: null };
        }

        await SallaDatabase.connection.models.MessageLog.create({
            tenant_id: tenant.id,
            direction: 'in',
            content: messageBody,
            to_phone: fromPhone,
            status: 'received'
        });

        const limitCheck = await checkLimit(tenant.id, SallaDatabase.connection.models, 'ai_reply', 1);
        if (!limitCheck.allowed) {
            return { reply: '⛔ تم تجاوز الحد الشهري للرسائل في باقتك.' };
        }

        // Fetch scoped previous messages
        const previousMessages = await this.getScopedPreviousMessages(tenant.id, fromPhone);

        const aiReply = await AIService.generateReply(tenant.id, messageBody, 'Customer', previousMessages, {
            isSimulator: isSimulated,
            skipUsage: isSimulated,
            skipAiUsageLog: isSimulated
        });
        
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
                await sendMetaMessage(tenant.WhatsAppConfig, fromPhone, aiReply);
            } else {
                await waWeb.sendMessage(tenant.id, fromPhone, aiReply);
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
    }
}

module.exports = new ChatService();

