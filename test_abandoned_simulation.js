require('dotenv').config();
const SallaDatabase = require('./database/db_instance');
const ScenarioService = require('./services/ScenarioService');

// Mock Data mimicking a Salla Webhook Payload
const mockPayload = {
    merchant: 123456789, // Matches the mock tenant created in previous steps
    data: {
        id: "cart_998877",
        url: 'https://salla.sa/checkout/xyz',
        checkout_url: 'https://salla.sa/checkout/xyz',
        currency: "SAR",
        total: { amount: 350.00 },
        customer: {
            first_name: 'عبدالله',
            last_name: 'محمد',
            mobile: '+966555555555',
            mobile_code: 'SA'
        },
        items: [
            { name: "ساعة ذكية", product: { name: "ساعة ذكية برو" }, price: 150 },
            { name: "سماعة بلوتوث", product: { name: "سماعة عزل ضجيج" }, price: 200 }
        ]
    }
};

async function runTest() {
    try {
        console.log("🚀 Starting Abandoned Cart Simulation...");

        // 1. Connect DB
        await SallaDatabase.connect();

        // 2. Ensure Tenant Exists (Mock Setup)
        const db = SallaDatabase.connection;
        const [tenant] = await db.models.Tenant.findOrCreate({
            where: { salla_merchant_id: mockPayload.merchant },
            defaults: {
                store_name: "متجر التقنية",
                store_domain: "tech-store.com",
                email: "test@tech.com",
                settings: { abandoned_cart: true } // Enable Feature
            }
        });

        // 3. Ensure WhatsApp Config Exists (Mock)
        await db.models.WhatsAppConfig.findOrCreate({
            where: { tenant_id: tenant.id },
            defaults: {
                phone_number_id: "100000001",
                waba_id: "200000002",
                access_token: "mock_access_token" // Triggers Mock Mode in metaProvider
            }
        });

        // 4. Update Settings to ensure it's enabled
        if (!tenant.settings || !tenant.settings.abandoned_cart) {
            tenant.settings = { ...tenant.settings, abandoned_cart: true };
            await tenant.save();
        }

        // 5. Ensure Subscription Exists (CRITICAL for Limits)
        const [plan] = await db.models.Plan.findOrCreate({
            where: { name: 'Starter' },
            defaults: {
                price_monthly: 0,
                price_yearly: 0,
                msg_limit_monthly: 1000
            }
        });

        await db.models.Subscription.findOrCreate({
            where: { tenant_id: tenant.id },
            defaults: {
                plan_id: plan.id,
                status: 'active',
                start_date: new Date(),
                end_date: new Date(new Date().setFullYear(new Date().getFullYear() + 1))
            }
        });

        console.log(`✅ Tenant Ready: ${tenant.store_name} (ID: ${tenant.id})`);

        // 5. Run Scenario
        console.log("🔄 Triggering ScenarioService...");
        await ScenarioService.handleAbandonedCart(mockPayload);

        console.log("🏁 Simulation Complete.");
        process.exit(0);

    } catch (e) {
        console.error("❌ Test Failed:", e);
        process.exit(1);
    }
}

runTest();
