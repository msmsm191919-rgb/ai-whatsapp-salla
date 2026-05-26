// services/platforms/index.js
// Platform Registry — يدير الـ adapters ويوفر API موحّد

const SallaAdapter = require('./SallaAdapter');
const ZidAdapter = require('./ZidAdapter');
const ShopifyAdapter = require('./ShopifyAdapter');
const StandaloneAdapter = require('./StandaloneAdapter');

const ADAPTERS = {
    [SallaAdapter.platform]: SallaAdapter,
    [ZidAdapter.platform]: ZidAdapter,
    [ShopifyAdapter.platform]: ShopifyAdapter,
    [StandaloneAdapter.platform]: StandaloneAdapter
};

const PlatformRegistry = {
    /**
     * يرجّع adapter حسب اسم المنصة
     */
    get(platformName) {
        const adapter = ADAPTERS[platformName];
        if (!adapter) throw new Error(`Unknown platform: ${platformName}`);
        return adapter;
    },

    /**
     * قائمة بكل المنصات للعرض في صفحة الاختيار
     */
    list() {
        return Object.values(ADAPTERS).map(A => ({
            platform: A.platform,
            ...A.displayInfo,
            isReady: A.isReady,
            mockMode: !A.isReady && A.platform !== 'standalone'
        }));
    },

    /**
     * هل المنصة مدعومة؟
     */
    has(platformName) {
        return !!ADAPTERS[platformName];
    },

    ADAPTERS
};

module.exports = PlatformRegistry;
