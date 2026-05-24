// Quick script to fix plan names and link demo tenant to the correct plan
require("dotenv").config();
const SallaDatabase = require("./database/db_instance");

(async () => {
    try {
        const db = await SallaDatabase.connect();
        const Plan = db.models.Plan;

        // 1. Create Arabic plans if they don't exist
        console.log("🌱 Creating Arabic-named plans...");
        // ⚠️ هذه المميزات مطابقة 100% لـ services/planGate.js و views/pricing.html
        const arabicPlans = [
            {
                name: 'الأساسية',
                price_monthly: 79,
                price_yearly: 759,
                msg_limit_monthly: 10000,
                trial_days: 7,               // 🎁 تجربة مجانية 7 أيام للعملاء الجدد
                is_active: true,
                features: {
                    whatsapp_count: 1,
                    campaigns: false,
                    automation: true,             // ✅ السلات + الطلبات مفتوحة
                    automation_carts: true,
                    automation_orders: true,
                    welcome_messages: true,
                    auto_reply_bot: true,
                    ai_enabled: true,
                    ai_advanced: false,
                    ai_model: 'GPT-4o Mini',
                    ai_training_docs: 3,
                    team_members: 1,
                    support_level: 'standard',
                    scenarios: 'basic'
                }
            },
            {
                name: 'النمو',
                price_monthly: 149,
                price_yearly: 1430,
                msg_limit_monthly: 15000,        // 🛡️ Fair Use: حد ناعم بدل "غير محدود"
                is_active: true,
                features: {
                    whatsapp_count: 3,
                    messages_overage_price: 0.02,  // ر.س لكل رسالة بعد الحد الناعم
                    messages_hard_limit: 30000,    // الحد الصارم
                    fair_use: true,
                    campaigns: true,
                    automation: true,
                    automation_carts: true,
                    automation_orders: true,
                    welcome_messages: true,
                    auto_reply_bot: true,
                    digital_products: true,
                    customers_import: true,
                    ai_cart_negotiator: true,
                    ai_enabled: true,
                    ai_advanced: true,
                    ai_model: 'GPT-4o',
                    ai_training_docs: 10,
                    team_members: 5,
                    support_level: 'priority',
                    api_access: false,
                    scenarios: 'advanced'
                }
            },
            {
                name: 'الشركات',
                price_monthly: 299,
                price_yearly: 2850,
                msg_limit_monthly: 30000,        // 🛡️ Fair Use: حد ناعم أعلى
                is_active: true,
                features: {
                    whatsapp_count: 'unlimited',
                    messages_overage_price: 0.015, // ر.س لكل رسالة (مخفّض)
                    messages_hard_limit: 60000,    // الحد الصارم
                    fair_use: true,
                    campaigns: true,
                    automation: true,
                    automation_carts: true,
                    automation_orders: true,
                    welcome_messages: true,
                    auto_reply_bot: true,
                    digital_products: true,
                    customers_import: true,
                    ai_cart_negotiator: true,
                    ai_enabled: true,
                    ai_advanced: true,
                    ai_model: 'GPT-4o (Custom)',
                    ai_training_docs: -1,
                    team_members: 'unlimited',
                    support_level: 'dedicated',
                    api_access: true,
                    scenarios: 'advanced',
                    ai_custom: true,
                    priority_support: true,
                    remove_branding: true,
                    white_label: true,
                    custom_ai_training: true
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
                await plan.update({ features: p.features, msg_limit_monthly: p.msg_limit_monthly, price_monthly: p.price_monthly, price_yearly: p.price_yearly });
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
            console.log("❌ Demo tenant not found");
        }

        console.log("\n✅ Done! All plans are now in Arabic and demo tenant is on النمو.");
        process.exit(0);
    } catch (e) {
        console.error('Error:', e.message);
        process.exit(1);
    }
})();
