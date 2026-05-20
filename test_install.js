const SallaDatabase = require('./database')('Sequelize');

async function simulateInstall() {
    console.log("🚀 Simulating Salla App Installation...");

    // 1. بيانات وهمية تأتي من سلة عند التثبيت
    const mockMerchantData = {
        id: "1234567890", // Merchant ID from Salla
        name: "متجر الأزياء العصرية",
        email: "store@demo.com",
        domain: "fashion-demo.salla.sa"
    };

    const mockTokenData = {
        access_token: "access_token_xyz_123",
        refresh_token: "refresh_token_abc_456",
        expires_in: new Date(Date.now() + 3600 * 1000) // Expires in 1 hour
    };

    try {
        await SallaDatabase.connect();

        // 2. محاكاة إنشاء الـ Tenant
        console.log("-----------------------------------------");
        console.log("👤 Step 1: Identifying Tenant...");
        const tenant = await SallaDatabase.createOrUpdateTenant(mockMerchantData);
        console.log(`✅ Tenant Created/Found! ID: ${tenant.id} | Name: ${tenant.store_name}`);

        // 3. محاكاة حفظ التوكن
        console.log("-----------------------------------------");
        console.log("🔐 Step 2: Saving Secure Tokens...");
        await SallaDatabase.saveSallaOAuth(tenant.id, mockTokenData);
        console.log("✅ Tokens Linked to Tenant Successfully.");

        // 4. التحقق النهائي
        console.log("-----------------------------------------");
        const verifyTenant = await SallaDatabase.getTenantBySallaID(mockMerchantData.id);
        console.log("📝 Verification Query Result:");
        console.log(JSON.stringify(verifyTenant.toJSON(), null, 2));

        console.log("\n🎉 TEST PASSED: SaaS Multi-Tenancy Logic Works!");
        process.exit(0);

    } catch (error) {
        console.error("❌ Test Failed:", error);
        process.exit(1);
    }
}

require('dotenv').config();
simulateInstall();
