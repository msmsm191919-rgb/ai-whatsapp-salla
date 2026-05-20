require('dotenv').config();
const SallaDatabase = require('./database/db_instance');
const ScenarioService = require('./services/ScenarioService');

// Mock Data mimicking a Salla Order Completed Payload
const mockPayload = {
    merchant: 123456789, // Default demo merchant
    event: 'order.created', // Or whatever triggers it
    data: {
        id: "order_556677",
        currency: "SAR",
        total: { amount: 840.00 },
        customer: {
            first_name: 'سارة',
            last_name: 'الأحمد',
            email: 'sara@example.com',
            mobile: '+966544444444',
            mobile_code: 'SA'
        },
        items: [
            { name: "فستان سهرة", price: 500 },
            { name: "حقيبة يد", price: 340 }
        ]
    }
};

async function runTest() {
    try {
        console.log("🚀 Starting Review Request Simulation...");

        // 1. Connect DB
        await SallaDatabase.connect();
        const db = SallaDatabase.connection;

        // 2. Ensure Tenant Exists
        const [tenant] = await db.models.Tenant.findOrCreate({
            where: { salla_merchant_id: mockPayload.merchant },
            defaults: {
                store_name: "متجر الأزياء",
                store_domain: "fashion-store.com",
                email: "admin@fashion.com",
                settings: { review_request: true } // Enable Feature
            }
        });

        // 3. Ensure WhatsApp Config
        await db.models.WhatsAppConfig.findOrCreate({
            where: { tenant_id: tenant.id },
            defaults: {
                phone_number_id: "100000001",
                waba_id: "200000002",
                access_token: "mock_access_token"
            }
        });

        // 4. Ensure Subscription (For limits)
        const [plan] = await db.models.Plan.findOrCreate({
            where: { name: 'Starter' },
            defaults: { msg_limit_monthly: 1000, price_monthly: 0 }
        });

        await db.models.Subscription.findOrCreate({
            where: { tenant_id: tenant.id },
            defaults: { plan_id: plan.id, status: 'active', start_date: new Date() }
        });

        // 5. Enable Setting
        if (!tenant.settings || !tenant.settings.review_request) {
            tenant.settings = { ...tenant.settings, review_request: true };
            await tenant.save();
        }

        console.log(`✅ Tenant Ready: ${tenant.store_name} (ID: ${tenant.id})`);

        // 6. Run Scenario
        console.log("🔄 Triggering ScenarioService.handleOrderCompleted...");
        await ScenarioService.handleOrderCompleted(mockPayload);

        console.log("🏁 Simulation Complete.");
        process.exit(0);

    } catch (e) {
        console.error("❌ Test Failed:", e);
        process.exit(1);
    }
}

runTest();
