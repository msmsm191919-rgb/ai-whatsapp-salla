const SallaDatabase = require('../database/db_instance');

class HandoffService {

    /**
     * توحيد وتنسيق معرّف المحادثة/العميل
     * @param {string} phoneOrLid
     * @returns {string}
     */
    getChatKey(phoneOrLid) {
        const s = String(phoneOrLid || '').trim();
        if (s.endsWith('@c.us') || s.endsWith('@lid')) {
            return s;
        }
        let cleaned = s.replace(/\D/g, '');
        if (cleaned.startsWith('00')) cleaned = cleaned.slice(2);
        if (cleaned.startsWith('0')) cleaned = '966' + cleaned.slice(1);
        else if (cleaned.startsWith('5') && cleaned.length === 9) cleaned = '966' + cleaned;
        return cleaned + '@c.us';
    }

    /**
     * فحص هل المحادثة متوقفة مؤقتاً لصالح الموظف البشري
     * @param {number|string} tenantId
     * @param {string} chatKey
     * @returns {Promise<boolean>}
     */
    async isPaused(tenantId, chatKey) {
        try {
            const db = SallaDatabase.connection;
            if (!db) return false;
            const tenant = await db.models.Tenant.findByPk(tenantId);
            if (!tenant) return false;

            const settings = tenant.settings || {};
            const pausedChats = settings.paused_chats || {};
            const chat = pausedChats[chatKey];

            if (!chat || !chat.paused) return false;

            if (chat.auto_expires_at) {
                const now = new Date();
                const expires = new Date(chat.auto_expires_at);
                if (now > expires) {
                    // منتهية الصلاحية: استئناف تلقائي آمن وتحديث السجل
                    delete pausedChats[chatKey];
                    tenant.settings = settings;
                    tenant.changed('settings', true);
                    await tenant.save();
                    console.log(`⏰ [HandoffService] Auto-resumed chat for ${chatKey} due to expiration.`);
                    return false;
                }
            }
            return true;
        } catch (e) {
            console.error('[HandoffService.isPaused] Error:', e);
            return false;
        }
    }

    /**
     * التحقق من وجود كلمات مفتاحية لطلب موظف أو تقديم شكوى
     * @param {string} messageText
     * @returns {boolean}
     */
    shouldTriggerHandoff(messageText) {
        if (!messageText) return false;
        const text = messageText.toLowerCase().trim();
        const keywords = [
            'موظف',
            'بشري',
            'مسؤول',
            'مسؤل',
            'كلموني',
            'تكلمني',
            'اتصلوا علي',
            'شكوى',
            'اشتكيت',
            'البوت ما فهم',
            'ما فهمت',
            'أبي شخص',
            'ابي شخص',
            'أبغى أحد',
            'ابغى احد'
        ];
        return keywords.some(keyword => text.includes(keyword));
    }

    /**
     * إيقاف الرد التلقائي للمحادثة وتحويلها للموظف
     * @param {number|string} tenantId
     * @param {string} chatKey
     * @param {Object} metadata
     * @returns {Promise<boolean>}
     */
    async pauseChat(tenantId, chatKey, metadata = {}) {
        try {
            const db = SallaDatabase.connection;
            if (!db) return false;
            const tenant = await db.models.Tenant.findByPk(tenantId);
            if (!tenant) return false;

            const settings = tenant.settings || {};
            settings.paused_chats = settings.paused_chats || {};

            const now = Date.now();
            const duration = metadata.durationMs || (60 * 60 * 1000); // 60 minutes default
            settings.paused_chats[chatKey] = {
                paused: true,
                requested_at: new Date(now).toISOString(),
                auto_expires_at: new Date(now + duration).toISOString(),
                ...metadata
            };
            delete settings.paused_chats[chatKey].durationMs;

            tenant.settings = settings;
            tenant.changed('settings', true);
            await tenant.save();
            console.log(`⏸️ [HandoffService] Chat for ${chatKey} paused successfully.`);
            return true;
        } catch (e) {
            console.error('[HandoffService.pauseChat] Error:', e);
            return false;
        }
    }

    /**
     * استئناف الرد التلقائي للـ AI للمحادثة
     * @param {number|string} tenantId
     * @param {string} chatKey
     * @returns {Promise<boolean>}
     */
    async resumeChat(tenantId, chatKey) {
        try {
            const db = SallaDatabase.connection;
            if (!db) return false;
            const tenant = await db.models.Tenant.findByPk(tenantId);
            if (!tenant) return false;

            const settings = tenant.settings || {};
            const pausedChats = settings.paused_chats || {};

            if (pausedChats[chatKey]) {
                delete pausedChats[chatKey];
                tenant.settings = settings;
                tenant.changed('settings', true);
                await tenant.save();
                console.log(`▶️ [HandoffService] Chat for ${chatKey} resumed successfully.`);
                return true;
            }
            return false;
        } catch (e) {
            console.error('[HandoffService.resumeChat] Error:', e);
            return false;
        }
    }

    /**
     * جرد المحادثات الموقوفة مؤقتاً للتاجر وتحديث المنتهي تلقائياً
     * @param {number|string} tenantId
     * @returns {Promise<Object>}
     */
    async listPausedChats(tenantId) {
        try {
            const db = SallaDatabase.connection;
            if (!db) return {};
            const tenant = await db.models.Tenant.findByPk(tenantId);
            if (!tenant) return {};

            const settings = tenant.settings || {};
            const pausedChats = settings.paused_chats || {};
            const now = new Date();
            let changed = false;

            for (const key of Object.keys(pausedChats)) {
                const chat = pausedChats[key];
                if (chat.auto_expires_at && now > new Date(chat.auto_expires_at)) {
                    delete pausedChats[key];
                    changed = true;
                }
            }

            if (changed) {
                tenant.settings = settings;
                tenant.changed('settings', true);
                await tenant.save();
            }

            return pausedChats;
        } catch (e) {
            console.error('[HandoffService.listPausedChats] Error:', e);
            return {};
        }
    }
}

module.exports = new HandoffService();
