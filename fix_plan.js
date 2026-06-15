// Quick script to fix plan names and sync DB with planGate.js
// ⚠️ هذه المميزات مطابقة 100% لـ services/planGate.js
require("dotenv").config();
const SallaDatabase = require("./database/db_instance");

(async () => {
    try {
        const db = await SallaDatabase.connect();
        const Plan = db.models.Plan;

        // 1. Create/Update Arabic plans (synced with planGate.js)
        console.log("🔄 Syncing plans with planGate.js...");
        const arabicPlans = [
            {
                name: 'الأساسية',
                price_monthly: 49,
                price_yearly: 470,
                msg_limit_monthly: 3000,
                trial_days: 7,
                is_active: true,
                features: {
                    campaigns: true,
                    automation_carts: true,
                    automation_orders: true,
                    welcome_messages: true,
                    auto_reply_bot: true,
                    ai_advanced: false,
                    api_access: false,
                    custom_ai_training: false,
                    digital_products: false,
                    customers_import: false,
                    ai_cart_negotiator: false,
                    whatsapp_qr: true,
                    whatsapp_api: false,
                    limits: {
                        whatsapp_numbers: 1,
                        messages_monthly: 3000,
                        ai_replies_monthly: 1000,
                        ai_model: 'GPT-4o Mini'
                    },
                    scenarios: ['abandoned_cart', 'order_status']
                }
            },
            {
                name: 'النمو',
                price_monthly: 149,
                price_yearly: 1430,
                msg_limit_monthly: -1,           // رسائل غير محدودة
                trial_days: 7,
                is_active: true,
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
                    api_access: false,
                    custom_ai_training: false,
                    whatsapp_qr: true,
                    whatsapp_api: false,          // ❌ حصر Meta API في باقة الشركات فقط
                    limits: {
                        whatsapp_numbers: 3,
                        messages_monthly: -1,
                        ai_replies_monthly: 7000,
                        ai_model: 'GPT-4o Mini'
                    },
                    scenarios: ['abandoned_cart', 'order_status', 'review_request', 'birthday', 'reactivation']
                }
            },
            {
                name: 'الشركات',
                price_monthly: 299,
                price_yearly: 2850,
                msg_limit_monthly: -1,           // رسائل غير محدودة
                trial_days: 7,
                is_active: true,
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
                    api_access: true,
                    custom_ai_training: true,
                    whatsapp_qr: true,
                    whatsapp_api: true,           // ✅ حصر Meta API في باقة الشركات فقط
                    limits: {
                        whatsapp_numbers: -1,
                        messages_monthly: -1,
                        ai_replies_monthly: 15000,
                        ai_model: 'GPT-4o Mini'
                    },
                    scenarios: ['abandoned_cart', 'order_status', 'review_request', 'birthday', 'reactivation', 'price_drop']
                }
            }
        ];

        for (const p of arabicPlans) {
            const [plan, created] = await Plan.findOrCreate({
                where: { name: p.name },
                defaults: p
            });
            if (created) {
                console.log(`  ✅ Created: ${p.name}`);
            } else {
                await plan.update({
                    features: p.features,
                    msg_limit_monthly: p.msg_limit_monthly,
                    price_monthly: p.price_monthly,
                    price_yearly: p.price_yearly,
                    trial_days: p.trial_days
                });
                console.log(`  🔄 Updated: ${p.name}`);
            }
        }

        // 2. Find النمو plan
        const growthPlan = await Plan.findOne({ where: { name: 'النمو' } });
        if (!growthPlan) {
            console.log("❌ النمو plan not found!");
            process.exit(1);
        }

        // 3. Fix Demo Tenant Subscription
        const tenant = await db.models.Tenant.findOne({
            where: { salla_merchant_id: 123456789 }
        });

        if (tenant) {
            const sub = await db.models.Subscription.findOne({ where: { tenant_id: tenant.id } });
            if (sub) {
                const currentPlan = await Plan.findByPk(sub.plan_id);
                console.log(`\n📋 Current plan: "${currentPlan?.name}" (ID: ${sub.plan_id})`);

                if (currentPlan?.name !== 'النمو') {
                    await sub.update({ plan_id: growthPlan.id });
                    console.log(`✅ Switched to "النمو" (ID: ${growthPlan.id})`);
                } else {
                    console.log("✅ Already on النمو plan!");
                }
            } else {
                // Create subscription
                await db.models.Subscription.create({
                    tenant_id: tenant.id,
                    plan_id: growthPlan.id,
                    status: 'active',
                    start_date: new Date(),
                    end_date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
                });
                console.log(`✅ Created subscription for النمو plan.`);
            }
        } else {
            console.log("⚠️ Demo tenant not found");
        }

        console.log("\n✅ Done! All plans synced with planGate.js.");
        process.exit(0);
    } catch (e) {
        console.error('Error:', e.message);
        process.exit(1);
    }
})();
