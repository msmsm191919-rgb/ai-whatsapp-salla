const { Op } = require('sequelize');

/**
 * Checks if a tenant is allowed to send a message based on their plan and usage.
 * @param {number} tenantId - The internal ID of the tenant.
 * @param {Object} models - The Sequelize models object (sequelize.models).
 * @param {string|null} action - The action type (e.g., 'campaign_msg', 'ai_reply'). Currently unused but good for future extensibility.
 * @param {number} count - The number of units (messages) attempting to be consumed. default is 1.
 * @returns {Promise<{allowed: boolean, reason?: string, subscription?: Object}>}
 */
async function checkLimit(tenantId, models, action = null, count = 1) {
    const { Subscription, Plan, UsageCounter } = models;

    try {
        // 1. Get Active Subscription with Plan
        const subscription = await Subscription.findOne({
            where: {
                tenant_id: tenantId,
                status: { [Op.in]: ['active', 'trial'] }
            },
            include: [Plan]
        });

        if (!subscription) {
            return { allowed: false, reason: "No active subscription found." };
        }

        if (subscription.end_date && new Date(subscription.end_date) < new Date()) {
            return { allowed: false, reason: "Subscription expired." };
        }

        const plan = subscription.Plan;
        if (!plan) {
            return { allowed: false, reason: "Plan details missing." };
        }

        // 2. Check Usage from UsageCounter
        const periodKey = new Date().toISOString().slice(0, 7); // YYYY-MM

        const usage = await UsageCounter.findOne({
            where: {
                tenant_id: tenantId,
                period_key: periodKey
            }
        });

        // Current usage before this action
        const currentCount = usage ? usage.messages_sent : 0;
        const projected = currentCount + count;

        // 🛡️ سياسة الاستخدام العادل (Fair Use)
        // الحدود الإضافية تُخزّن في plan.features:
        //   messages_hard_limit  → الحد الصارم (يتوقف الإرسال بعده)
        //   messages_overage_price → سعر الرسالة الإضافية (ر.س) بعد الحد الناعم
        const f = plan.features || {};
        const softLimit = plan.msg_limit_monthly;          // الحد الناعم
        const hardLimit = f.messages_hard_limit ?? null;   // الحد الصارم
        const overagePrice = f.messages_overage_price ?? null;

        // -1 = غير محدود تماماً (لا حدود)
        if (softLimit === -1) {
            return { allowed: true, subscription };
        }

        // 1) تجاوز الحد الصارم → إيقاف نهائي
        if (hardLimit && projected > hardLimit) {
            return {
                allowed: false,
                reason: `Hard message limit exceeded. Used: ${currentCount} / ${hardLimit} (hard). Attempting: ${count}.`,
                current: currentCount,
                limit: softLimit,
                hard_limit: hardLimit
            };
        }

        // 2) تجاوز الحد الناعم
        if (projected > softLimit) {
            // إذا الباقة تدعم overage → نسمح ونحسب التكلفة الإضافية
            if (overagePrice) {
                const overageUnits = projected - Math.max(currentCount, softLimit);
                return {
                    allowed: true,
                    subscription,
                    overage: true,
                    overage_units: overageUnits,
                    overage_price: overagePrice,
                    overage_cost_sar: +(overageUnits * overagePrice).toFixed(2),
                    current: currentCount,
                    limit: softLimit
                };
            }
            // لا overage (مثل المجانية/الأساسية) → رفض
            return {
                allowed: false,
                reason: `Monthly message limit exceeded. Used: ${currentCount} / ${softLimit}. Attempting to send: ${count}.`,
                current: currentCount,
                limit: softLimit
            };
        }

        return { allowed: true, subscription }; // ضمن الحد الناعم

    } catch (error) {
        console.error("Limits Engine Error:", error);
        return { allowed: false, reason: "Internal error checking limits." };
    }
}

/**
 * Increments the usage counter for a tenant using the UsageCounter model.
 * @param {Object|number} tenantIdOrInstance - Tenant ID or Subscription Instance
 * @param {Object} models - The Sequelize models object.
 */
async function incrementUsage(tenantIdOrInstance, models, count = 1) {
    const { UsageCounter } = models;
    let tenantId;

    // Resolve tenant_id
    if (typeof tenantIdOrInstance === 'object' && tenantIdOrInstance.tenant_id) {
        tenantId = tenantIdOrInstance.tenant_id;
    } else {
        tenantId = tenantIdOrInstance;
    }

    if (!tenantId) {
        console.error("incrementUsage: No tenant ID found");
        return;
    }

    try {
        const periodKey = new Date().toISOString().slice(0, 7); // YYYY-MM

        const [counter] = await UsageCounter.findOrCreate({
            where: { tenant_id: tenantId, period_key: periodKey },
            defaults: { messages_sent: 0, ai_requests: 0 }
        });

        await counter.increment('messages_sent', { by: count });
        // console.log(`usage incremented by ${count} for tenant ${tenantId}`);

    } catch (error) {
        console.error("Failed to increment usage for tenant " + tenantId, error);
    }
}

module.exports = { checkLimit, incrementUsage };
