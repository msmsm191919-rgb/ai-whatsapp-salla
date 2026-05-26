// services/platforms/StandaloneAdapter.js
// "منصة" خاصة للمستخدمين بدون متجر إلكتروني — يستخدمون مبهر مع موقع/تطبيق خاص
// لا يحتاج OAuth خارجي، يستخدم signup عادي

const BaseAdapter = require('./BaseAdapter');

class StandaloneAdapter extends BaseAdapter {
    static get platform() { return 'standalone'; }

    static get displayInfo() {
        return {
            name: 'Standalone',
            name_ar: 'مستقل',
            logo: '/images/platforms/standalone.svg',
            color: '#0D9488',
            color_accent: '#14B8A6',
            description: 'استخدم مبهر بدون منصة — لموقعك الخاص أو تطبيقك',
            domain: ''
        };
    }

    static get isReady() { return true; }

    /**
     * الـ Standalone لا يحتاج OAuth — يفتح فورم signup مباشرة
     */
    static getAuthorizationUrl(state, redirectUri) {
        return `${redirectUri}?platform=standalone&state=${state}&standalone=1`;
    }

    /**
     * "Exchange" للـ Standalone = يأخذ بيانات signup مباشرة (store_name, email)
     */
    static async exchangeCodeForToken(code, redirectUri, params = {}) {
        const { store_name, email, phone } = params;
        if (!store_name || !email) throw new Error('store_name & email required for standalone signup');

        const storeId = `standalone_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        return {
            access_token: `standalone_${storeId}`,  // غير مستخدم — مجرد placeholder
            store_id: storeId,
            store_name,
            store_domain: null,
            email,
            owner_name: store_name,
            contact_phone: phone || null
        };
    }

    static async fetchStoreInfo() {
        return null; // لا توجد منصة خارجية للجلب منها
    }
}

module.exports = StandaloneAdapter;
