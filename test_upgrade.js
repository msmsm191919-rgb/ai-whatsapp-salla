const { SallaDatabase } = require('./database/db_instance');
const BillingService = require('./services/BillingService');

async function testUpgrade() {
    console.log("🚀 Starting Upgrade Test...");

    // 1. Connect
    await SallaDatabase.connect();
    const db = SallaDatabase.connection;

    // 2. Get Tenant
    const tenantId = 123456789; // Demo Merchant ID
    const tenant = await db.models.Tenant.findOne({ where: { salla_merchant_id: tenantId } });

    if (!tenant) {
        console.error("❌ Demo Tenant Not Found!");
        return;
    }
    console.log(`👤 Found Tenant: ${tenant.store_name} (ID: ${tenant.id})`);

    // 3. Create Checkout for PRO Plan (Plan ID 2 based on seed)
    const checkout = await BillingService.createCheckout(tenant.id, 2, 'monthly');
    console.log(`💳 Checkout Created: ${checkout.payment_id}`);

    // 4. Process Success
    const result = await BillingService.processPaymentSuccess(checkout.payment_id);
    console.log("✅ Payment Process Result:", result);

    // 5. Verify Subscription
    const sub = await db.models.Subscription.findOne({
        where: { tenant_id: tenant.id },
        include: [db.models.Plan]
    });

    console.log(`🎉 Current Plan: ${sub.Plan.name} (Status: ${sub.status})`);

    if (sub.Plan.name === 'Pro') {
        console.log("🌟 UPGRADE SUCCESSFUL!");
    } else {
        console.error("⚠️ UPGRADE FAILED - Still on " + sub.Plan.name);
    }

    process.exit();
}

testUpgrade();
