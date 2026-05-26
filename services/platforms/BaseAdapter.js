// services/platforms/BaseAdapter.js
// الواجهة الموحّدة لكل المنصات (Salla, Zid, Shopify, Standalone)
// كل adapter يرث منها ويُنفّذ الـ methods.

class BaseAdapter {
    /**
     * اسم المنصة الفريد ('salla', 'zid', 'shopify', 'standalone')
     */
    static get platform() { throw new Error('platform getter not implemented'); }

    /**
     * بيانات العرض في صفحة الاختيار
     * @returns {{name, name_ar, logo, color, description}}
     */
    static get displayInfo() { throw new Error('displayInfo not implemented'); }

    /**
     * هل المنصة جاهزة للاتصال الحقيقي؟ (false = Mock فقط)
     */
    static get isReady() {
        return !!(process.env[`${this.platform.toUpperCase()}_CLIENT_ID`]);
    }

    /**
     * يرجّع URL لبدء OAuth (يفتح صفحة الموافقة من المنصة)
     * @param {string} state - random string لمنع CSRF
     * @param {string} redirectUri - الـ URL اللي ترجع له المنصة
     * @returns {string} OAuth authorization URL
     */
    static getAuthorizationUrl(state, redirectUri) { throw new Error('getAuthorizationUrl not implemented'); }

    /**
     * يستبدل الـ code بـ access token من المنصة
     * @param {string} code
     * @param {string} redirectUri
     * @returns {Promise<{access_token, refresh_token?, expires_in?, store_id, store_name, store_domain?, email?}>}
     */
    static async exchangeCodeForToken(code, redirectUri) { throw new Error('exchangeCodeForToken not implemented'); }

    /**
     * يجلب معلومات المتجر من المنصة باستخدام token
     * @returns {Promise<{store_id, store_name, store_domain?, email?, owner_name?}>}
     */
    static async fetchStoreInfo(accessToken) { throw new Error('fetchStoreInfo not implemented'); }

    /**
     * (اختياري) يجلب قائمة العملاء
     */
    static async fetchCustomers(accessToken, options = {}) { return []; }

    /**
     * (اختياري) يجلب قائمة الطلبات
     */
    static async fetchOrders(accessToken, options = {}) { return []; }
}

module.exports = BaseAdapter;
