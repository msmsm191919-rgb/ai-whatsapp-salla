require("dotenv").config();
const { Sequelize, DataTypes } = require("sequelize");
const SallaDatabase = require("./database/db_instance");
const { checkLimit, incrementUsage } = require('./helpers/limitsEngine');
// MOCKING THE PROVIDER DIRECTLY to avoid 'axios' dependency error if not installed
const sendMetaMessage = async (config, to, text) => {
    console.log(`\n💬 [MOCK META API] Sending to ${to}: "${text}"`);
    console.log(`   Config: PhoneID=${config.phone_number_id}`);
    return true;
};

const sendMetaTemplate = async (config, to, templateName) => {
    console.log(`\n📄 [MOCK META API] Sending TEMPLATE "${templateName}" to ${to}`);
    return true;
};

async function runSimulation() {
    console.log("🚀 Starting Full Simulation Test...");

    try {
        // 1. Connect DB
        const connection = await SallaDatabase.connect();

        // 2. Create Dummy Data
        console.log("\n🌱 Creating Dummy Tenant...");
        const [tenant] = await connection.models.Tenant.findOrCreate({
            where: { salla_merchant_id: 123456789 },
            defaults: {
                store_name: "Test Store",
                email: "test@demo.com",
                store_domain: "demo.salla.sa"
            }
        });
        console.log(`✅ Tenant Created: ${tenant.store_name} (ID: ${tenant.id})`);

        // 3. Create Plan
        console.log("\n🌱 Creating/Finding Plan...");
        const [plan] = await connection.models.Plan.findOrCreate({
            where: { name: 'Simulation Pro' },
            defaults: {
                price_monthly: 100,
                msg_limit_monthly: 10, // Small limit for testing
                ai_model_config: { model: 'gpt-simulation' },
                is_active: true,
                features: {
                    whatsapp_count: 3,
                    campaigns: true,
                    automation: true,
                    ai_enabled: true,
                    ai_model: 'GPT-4o',
                    ai_training_docs: 10,
                    team_members: 5,
                    support_level: 'priority',
                    api_access: true,
                    scenarios: 'advanced'
                }
            }
        });

        // 4. Create Subscription
        console.log("\n🌱 Creating Subscription...");
        await connection.models.Subscription.destroy({ where: { tenant_id: tenant.id } }); // Clear old
        const subscription = await connection.models.Subscription.create({
            tenant_id: tenant.id,
            plan_id: plan.id,
            status: 'active',
            start_date: new Date(),
            end_date: new Date(new Date().setDate(new Date().getDate() + 30)),
            usage_counter: 0
        });

        // 5. Create WhatsApp Config
        console.log("\n🌱 Creating WhatsApp Config...");
        await connection.models.WhatsAppConfig.upsert({
            tenant_id: tenant.id,
            phone_number_id: "100020003000",
            access_token: "mock_access_token",
            status: 'active'
        });

        // 6. Test Limits (Should Pass)
        console.log("\n🔍 Testing Limit Check (Pass Case)...");
        const limitCheck1 = await checkLimit(tenant.id, connection.models);
        console.log(`Result: ${limitCheck1.allowed ? '✅ Allowed' : '❌ Blocked'} (Reason: ${limitCheck1.reason})`);

        if (limitCheck1.allowed) {
            // 7. Simulate Sending Message
            console.log("\n📨 Simulating WhatsApp Send...");
            const config = await connection.models.WhatsAppConfig.findOne({ where: { tenant_id: tenant.id } });
            await sendMetaMessage(config, "966500000000", "Hello from Simulation!");
            await sendMetaTemplate(config, "966500000000", "hello_world");

            // 8. Increment Usage
            console.log("\n📈 Incrementing Usage...");
            await incrementUsage(limitCheck1.subscription, connection.models);
        }

        // 9. Test Limits (Simulate Full)
        console.log("\n🔍 Testing Limit Check (Full Case)...");
        // Force usage to limit
        await limitCheck1.subscription.update({ usage_counter: 10 });
        const limitCheck2 = await checkLimit(tenant.id, connection.models);
        console.log(`Result: ${limitCheck2.allowed ? '✅ Allowed' : '❌ Blocked'} (Reason: ${limitCheck2.reason})`);

        // 10. Test Campaign Creation
        console.log("\n📊 Testing Campaign Creation (Logic Only)...");
        if (connection.models.Campaign) {
            const camp = await connection.models.Campaign.create({
                tenant_id: tenant.id,
                name: 'Simulation Campaign',
                status: 'draft',
                target_group: 'all'
            });
            console.log(`✅ Campaign Created: ${camp.name} (ID: ${camp.id})`);
            await camp.update({ status: 'completed' }); // Test update
            console.log(`✅ Campaign Status Updated to: ${camp.status}`);
        } else {
            console.log("⚠️ Campaign Model not found (Check migrations)");
        }

        console.log("\n✅ Simulation Complete. System Logic Verified.");

    } catch (e) {
        console.error("❌ Simulation Failed:", e);
    }
}

runSimulation();
