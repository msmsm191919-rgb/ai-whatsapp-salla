// services/planGate.js
// بوابة الباقات الشاملة — تحكم بكل الداشبورد (صفحات + مميزات + حدود)
const SallaDatabase = require('../database/db_instance');
const { Op } = require('sequelize');

// ═══════════════════════════════════════════════════════════════════
// 🗺️ خريطة الباقات الكاملة
// ═══════════════════════════════════════════════════════════════════
// ⚠️ هذه الخريطة مطابقة 100% لـ views/pricing.html
// أي تعديل هنا لازم يتعدّل في pricing.html والعكس صحيح
const PLANS = {
    // ════════════════════════════════════════
    // 1️⃣ الأساسية — 79 ر.س / شهر — للبداية السريعة
    // 🎁 تجربة مجانية 7 أيام للعملاء الجدد (status='trial')، بعدها يدفع أو يتوقف
    // ════════════════════════════════════════
    // ✓ 10,000 رسالة شهرياً | ✓ 1 رقم واتساب | ✓ بوت رد آلي
    // ✓ استعادة السلات المتروكة | ✓ إشعارات حالة الطلب
    // ✓ إشعارات ترحيبية | ✓ دعم فني عبر الشات
    // ✗ ذكاء اصطناعي GPT-4o (بدلها GPT-4o Mini) | ✗ حملات تسويقية
    'الأساسية': {
        price_monthly: 79,
        price_yearly: 759,
        trial_days: 7,
        pages: [
            'dashboard', 'customers', 'scenarios', 'knowledge_base',
            'ai_settings', 'logs', 'settings', 'account',
            'automation_carts',   // ✅ مسموحة في الأساسية (استعادة السلات)
            'automation_orders',  // ✅ مسموحة في الأساسية (حالة الطلب)
            'campaigns'           // ✅ الحملات الجماعية مجانية للكل عبر QR (ميزتنا التنافسية)
        ],
        features: {
            campaigns: true,              // ✅ حملات جماعية مجانية (عبر QR) — متاحة لكل الباقات
            automation_carts: true,       // ✅ استعادة السلات المتروكة
            automation_orders: true,      // ✅ إشعارات حالة الطلب
            welcome_messages: true,       // ✅ إشعارات ترحيبية
            auto_reply_bot: true,         // ✅ بوت رد آلي (قوائم)
            ai_advanced: false,           // ❌ GPT-4o (يستخدم Mini فقط)
            api_access: false,
            custom_ai_training: false,
            white_label: false,
            priority_support: false,      // دعم عادي عبر الشات
            digital_products: false,      // ❌ تسليم منتجات رقمية (النمو فقط)
            customers_import: false,      // ❌ استيراد العملاء Excel
            ai_cart_negotiator: false,    // ❌ مفاوض AI ذكي
            whatsapp_qr: true,            // ✅ ربط QR (الطريقة الأساسية المجانية لكل الباقات)
            whatsapp_api: false           // ❌ WhatsApp Business API (النمو فأعلى فقط)
        },
        limits: {
            whatsapp_numbers: 1,
            team_members: 1,
            knowledge_docs: 3,
            messages_monthly: 10000,
            ai_model: 'GPT-4o Mini'
        },
        // السيناريوهات المتاحة (مطابقة لـ scenarios.html)
        scenarios: ['abandoned_cart', 'order_status']
    },

    // ════════════════════════════════════════
    // 2️⃣ النمو — 149 ر.س / شهر — الأكثر طلباً
    // ════════════════════════════════════════
    // 🔥 شامل كل مزايا الأساسية + التالي:
    // ✓ رسائل غير محدودة | ✓ GPT-4o | ✓ حملات تسويقية (Broadcast)
    // ✓ تسليم المنتجات الرقمية | ✓ استيراد العملاء (Excel)
    // ✓ استعادة سلات ذكية (مفاوض AI) | ✓ تذكير بتقييم المتجر
    // ✓ ربط 3 أرقام واتساب
    'النمو': {
        price_monthly: 149,
        price_yearly: 1430,
        trial_days: 0,
        pages: [
            'dashboard', 'customers', 'scenarios', 'knowledge_base',
            'ai_settings', 'logs', 'settings', 'account',
            'automation_carts', 'automation_orders',
            'campaigns'                   // ✅ النمو يضيف الحملات
        ],
        features: {
            campaigns: true,              // ✅
            automation_carts: true,
            automation_orders: true,
            welcome_messages: true,
            auto_reply_bot: true,
            ai_advanced: true,            // ✅ GPT-4o
            digital_products: true,       // ✅ تسليم منتجات رقمية + أكواد
            customers_import: true,       // ✅ استيراد Excel
            ai_cart_negotiator: true,     // ✅ مفاوض AI للسلات
            api_access: false,            // ❌ (الشركات فقط)
            custom_ai_training: false,
            white_label: false,
            priority_support: true,
            whatsapp_qr: true,            // ✅ ربط QR
            whatsapp_api: true            // ✅ WhatsApp Business API (متاح من النمو)
        },
        limits: {
            whatsapp_numbers: 3,
            team_members: 5,
            knowledge_docs: 10,
            // 🛡️ حد شهري واضح: 35,000 رسالة، بعدها رسوم زيادة بشفافية
            messages_monthly: 35000,           // الحد المعلن
            messages_overage_price: 0.02,      // ر.س لكل رسالة إضافية
            messages_hard_limit: 50000,        // الحد الصارم
            fair_use: true,
            ai_model: 'GPT-4o'
        },
        scenarios: ['abandoned_cart', 'order_status', 'review_request', 'birthday', 'reactivation']
    },

    // ════════════════════════════════════════
    // 3️⃣ الشركات — 299 ر.س / شهر — للكيانات الكبيرة
    // ════════════════════════════════════════
    // 🏢 شامل كل مزايا النمو + التالي:
    // ✓ API access | ✓ White-label | ✓ Custom AI training
    // ✓ تنبيه تخفيض السعر | ✓ أرقام واتساب غير محدودة
    'الشركات': {
        price_monthly: 299,
        price_yearly: 2850,
        trial_days: 0,
        pages: [
            'dashboard', 'customers', 'scenarios', 'knowledge_base',
            'ai_settings', 'logs', 'settings', 'account',
            'automation_carts', 'automation_orders', 'campaigns'
        ],
        features: {
            campaigns: true,
            automation_carts: true,
            automation_orders: true,
            welcome_messages: true,
            auto_reply_bot: true,
            ai_advanced: true,
            digital_products: true,
            customers_import: true,
            ai_cart_negotiator: true,
            api_access: true,             // ✅
            custom_ai_training: true,     // ✅
            white_label: true,            // ✅
            priority_support: true,
            whatsapp_qr: true,            // ✅ ربط QR
            whatsapp_api: true            // ✅ WhatsApp Business API
        },
        limits: {
            whatsapp_numbers: -1,
            team_members: -1,
            knowledge_docs: -1,
            // 🛡️ حد شهري واضح للشركات + رسوم زيادة مخفّضة
            messages_monthly: 100000,          // الحد المعلن
            messages_overage_price: 0.015,     // ر.س لكل رسالة إضافية (مخفّض)
            messages_hard_limit: 150000,       // الحد الصارم
            fair_use: true,
            ai_model: 'GPT-4o (Custom)'
        },
        scenarios: ['abandoned_cart', 'order_status', 'review_request', 'birthday', 'reactivation', 'price_drop']
    }
};

const DEFAULT_PLAN = 'الأساسية';

// ═══════════════════════════════════════════════════════════════════
// 🛠️ Backward compatibility (سيناريوهات فقط)
// ═══════════════════════════════════════════════════════════════════
const PLAN_SCENARIOS = Object.fromEntries(
    Object.entries(PLANS).map(([name, cfg]) => [name, cfg.scenarios])
);
const ALL_SCENARIOS = ['abandoned_cart', 'review_request', 'order_status', 'birthday', 'reactivation', 'price_drop'];
const ALL_FEATURES = ['campaigns', 'automation_carts', 'automation_orders', 'api_access', 'custom_ai_training', 'white_label', 'priority_support'];

/**
 * يجلب باقة المتجر
 * @returns {Promise<{name:string, features:object}|null>}
 */
async function getTenantPlan(tenantId) {
    const db = SallaDatabase.connection;
    if (!db) return null;

    const sub = await db.models.Subscription.findOne({
        where: {
            tenant_id: tenantId,
            status: { [Op.in]: ['active', 'trial'] }
        },
        include: [db.models.Plan]
    });

    return sub?.Plan ? { name: sub.Plan.name, features: sub.Plan.features || {} } : null;
}

/**
 * هل السيناريو متاح في باقة معيّنة؟
 */
function isScenarioAllowed(planName, scenarioKey) {
    if (!planName) return false;
    const allowed = PLAN_SCENARIOS[planName] || PLAN_SCENARIOS['الأساسية'];
    return allowed.includes(scenarioKey);
}

/**
 * يرجع كل السيناريوهات المتاحة لباقة + المقفولة منها
 */
function getScenariosForPlan(planName) {
    const allowed = PLAN_SCENARIOS[planName] || PLAN_SCENARIOS['الأساسية'];
    return {
        plan: planName,
        allowed,
        locked: ALL_SCENARIOS.filter(s => !allowed.includes(s)),
        all: ALL_SCENARIOS
    };
}

/**
 * تحقق سريع من tenant_id — استخدمها في السيناريوهات
 */
async function canTenantUseScenario(tenantId, scenarioKey) {
    const plan = await getTenantPlan(tenantId);
    if (!plan) return false;
    return isScenarioAllowed(plan.name, scenarioKey);
}

/**
 * يفلتر مصفوفة tenants ليرجع اللي يحق لهم استخدام سيناريو
 */
async function filterTenantsByScenario(tenants, scenarioKey) {
    const result = [];
    for (const t of tenants) {
        if (await canTenantUseScenario(t.id, scenarioKey)) result.push(t);
    }
    return result;
}

// ═══════════════════════════════════════════════════════════════════
// 🆕 Universal Plan API (للداشبورد الكامل)
// ═══════════════════════════════════════════════════════════════════

function getPlanConfig(planName) {
    return PLANS[planName] || PLANS[DEFAULT_PLAN];
}

/** هل صفحة معيّنة متاحة في الباقة؟ */
function isPageAllowed(planName, pageKey) {
    return getPlanConfig(planName).pages.includes(pageKey);
}

/** هل ميزة معيّنة مفعّلة في الباقة؟ */
function isFeatureAllowed(planName, featureKey) {
    return getPlanConfig(planName).features[featureKey] === true;
}

/** ما هو الحد الأقصى لمورد معيّن؟ -1 = unlimited */
function getLimit(planName, limitKey) {
    return getPlanConfig(planName).limits[limitKey];
}

/** يرجع كل المعلومات للداشبورد (يُمرّر للـ views) */
function getPlanContext(planName) {
    const cfg = getPlanConfig(planName);
    return {
        plan_name: planName || DEFAULT_PLAN,
        plan_pages: cfg.pages,
        plan_features: cfg.features,
        plan_limits: cfg.limits,
        plan_scenarios: cfg.scenarios,
        // Helpers سهلين للاستخدام في Nunjucks
        can: {
            ...cfg.features,
            ...Object.fromEntries(cfg.pages.map(p => [`page_${p}`, true])),
            ...Object.fromEntries(cfg.scenarios.map(s => [`scenario_${s}`, true]))
        }
    };
}

/** اجلب الباقة الحالية للتينانت بكل المعلومات */
async function getFullPlanForTenant(tenantId) {
    const plan = await getTenantPlan(tenantId);
    return getPlanContext(plan?.name || DEFAULT_PLAN);
}

// ═══════════════════════════════════════════════════════════════════
// 🛡️ Middleware: حماية الـ routes
// ═══════════════════════════════════════════════════════════════════

/**
 * Middleware: تحقق إن الصفحة متاحة في باقة المتجر
 * استخدام: app.get('/campaigns', requirePage('campaigns'), handler)
 */
function requirePage(pageKey) {
    return async (req, res, next) => {
        try {
            const merchantId = req.user?.merchant?.id;
            if (!merchantId) return res.status(401).send("Unauthorized");
            const db = SallaDatabase.connection;
            const tenant = await db.models.Tenant.findOne({ where: { salla_merchant_id: merchantId } });
            const plan = tenant ? await getTenantPlan(tenant.id) : null;
            const planName = plan?.name || DEFAULT_PLAN;

            if (!isPageAllowed(planName, pageKey)) {
                // ضمان وجود user object للـ layout
                const safeUser = req.user || { merchant: { id: merchantId, name: tenant?.store_name || 'متجرك' } };
                if (!safeUser.merchant) safeUser.merchant = { id: merchantId, name: tenant?.store_name || 'متجرك' };

                return res.status(403).render('upgrade_required.html', {
                    user: safeUser,
                    plan_name: planName,
                    locked_feature: pageKey,
                    activePage: pageKey,
                    planContext: getPlanContext(planName),
                    ...getPlanContext(planName)
                });
            }

            req.tenantPlan = planName;
            req.planContext = getPlanContext(planName);
            next();
        } catch (e) {
            console.error('[requirePage] error:', e);
            next();
        }
    };
}

/**
 * Middleware: تحقق من ميزة معيّنة
 */
function requireFeature(featureKey) {
    return async (req, res, next) => {
        try {
            const merchantId = req.user?.merchant?.id;
            if (!merchantId) return res.status(401).json({ error: 'unauthorized' });
            const db = SallaDatabase.connection;
            const tenant = await db.models.Tenant.findOne({ where: { salla_merchant_id: merchantId } });
            const plan = tenant ? await getTenantPlan(tenant.id) : null;
            const planName = plan?.name || DEFAULT_PLAN;

            if (!isFeatureAllowed(planName, featureKey)) {
                return res.status(403).json({
                    error: 'feature_not_in_plan',
                    feature: featureKey,
                    plan: planName,
                    message: `الميزة "${featureKey}" غير متاحة في باقة "${planName}". رفّع باقتك للاستفادة منها.`
                });
            }
            next();
        } catch (e) { console.error('[requireFeature] error:', e); next(); }
    };
}

/**
 * Middleware: يحقن planContext لكل request (للسايدبار والـ views)
 */
function injectPlanContext() {
    return async (req, res, next) => {
        try {
            const merchantId = req.user?.merchant?.id;
            const db = SallaDatabase.connection;
            if (merchantId && db) {
                const tenant = await db.models.Tenant.findOne({
                    where: { salla_merchant_id: merchantId },
                    include: [{ model: db.models.Subscription, include: [db.models.Plan] }]
                });
                const subscription = tenant?.Subscription;
                const planName = subscription?.Plan?.name || DEFAULT_PLAN;
                let subStatus = subscription?.status || null;
                const subEndDate = subscription?.end_date;

                if (subStatus === 'trial' && subEndDate && new Date(subEndDate) < new Date()) {
                    subStatus = 'expired';
                }

                const trialDaysLeft = (subscription?.status === 'trial' && subStatus === 'trial' && subEndDate)
                    ? Math.ceil((new Date(subEndDate) - new Date()) / (1000 * 60 * 60 * 24))
                    : null;

                res.locals.planContext = getPlanContext(planName);
                res.locals.plan_name = planName;
                res.locals.sub_status = subStatus;
                res.locals.trial_days_left = (subscription?.status === 'trial' && trialDaysLeft !== null && trialDaysLeft >= 0) ? trialDaysLeft : null;
                req.tenantPlan = planName;
            } else {
                res.locals.planContext = getPlanContext(DEFAULT_PLAN);
                res.locals.plan_name = DEFAULT_PLAN;
                res.locals.sub_status = null;
                res.locals.trial_days_left = null;
                req.tenantPlan = DEFAULT_PLAN;
            }
            next();
        } catch (e) { next(); }
    };
}

module.exports = {
    // Plans registry
    PLANS,
    DEFAULT_PLAN,
    ALL_SCENARIOS,
    ALL_FEATURES,
    PLAN_SCENARIOS,

    // Lookups
    getPlanConfig,
    getTenantPlan,
    getFullPlanForTenant,
    getPlanContext,

    // Checks
    isPageAllowed,
    isFeatureAllowed,
    isScenarioAllowed,
    getLimit,
    getScenariosForPlan,
    canTenantUseScenario,
    filterTenantsByScenario,

    // Middlewares
    requirePage,
    requireFeature,
    injectPlanContext,

    // Salla App Plans Mapping
    SALLA_PLANS_MAPPING: {
        get basic() { return process.env.SALLA_PLAN_BASIC_ID || null; },
        get growth() { return process.env.SALLA_PLAN_GROWTH_ID || null; },
        get enterprise() { return process.env.SALLA_PLAN_ENTERPRISE_ID || null; }
    },

    /**
     * يرجع اسم الباقة الداخلي بمبهر بناءً على معرف باقة سلة (planId)
     */
    getPlanNameBySallaPlanId(sallaPlanId) {
        if (!sallaPlanId) return null;

        const basicId = process.env.SALLA_PLAN_BASIC_ID;
        const growthId = process.env.SALLA_PLAN_GROWTH_ID;
        const enterpriseId = process.env.SALLA_PLAN_ENTERPRISE_ID;

        if (basicId && String(sallaPlanId) === String(basicId)) return 'الأساسية';
        if (growthId && String(sallaPlanId) === String(growthId)) return 'النمو';
        if (enterpriseId && String(sallaPlanId) === String(enterpriseId)) return 'الشركات';

        return null;
    },

    /**
     * يرجع اسم الباقة الداخلي بمبهر بناءً على اسم باقة سلة (planName)
     */
    getPlanNameBySallaPlanName(sallaPlanName) {
        if (!sallaPlanName) return null;

        if (sallaPlanName === 'الأساسية' || sallaPlanName === 'basic') return 'الأساسية';
        if (sallaPlanName === 'النمو' || sallaPlanName === 'growth') return 'النمو';
        if (sallaPlanName === 'الشركات' || sallaPlanName === 'enterprise') return 'الشركات';

        return null;
    }
};
