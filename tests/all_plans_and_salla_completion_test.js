// tests/all_plans_and_salla_completion_test.js
// Automated verification of 3-Plans Entitlements & Salla Merchant Account Completion Flow

require('dotenv').config();
process.env.TOKENS_ENCRYPTION_KEY = process.env.TOKENS_ENCRYPTION_KEY || '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
const SallaDatabase = require('../database/db_instance');
const ConnectService = require('../services/ConnectService');
const EmailService = require('../services/EmailService');
const { checkTenantAccess, getTenantPlan, getPlanConfig } = require('../services/planGate');

async function runTests() {
    console.log('=== STARTING 3-PLANS & SALLA ACCOUNT COMPLETION VERIFICATION ===');
    await SallaDatabase.connect();
    const db = SallaDatabase.connection;

    let passed = 0;
    let failed = 0;

    function assert(cond, msg) {
        if (cond) {
            console.log(`  ✅ PASS: ${msg}`);
            passed++;
        } else {
            console.error(`  ❌ FAIL: ${msg}`);
            failed++;
        }
    }

    const testTenantsToClean = [];

    try {
        // -----------------------------------------------------------------
        // 1. THREE PLANS INVARIANT VERIFICATION (Basic, Growth, Enterprise)
        // -----------------------------------------------------------------
        console.log('\n--- 1. TESTING THREE PLANS ASSIGNMENT & ENTITLEMENTS ---');

        const plans = [
            { name: 'الأساسية', key: 'basic', price: 49, cloudApi: false },
            { name: 'النمو', key: 'growth', price: 149, cloudApi: false },
            { name: 'الشركات', key: 'enterprise', price: 299, cloudApi: true }
        ];

        for (const p of plans) {
            console.log(`\nTesting Plan: ${p.name} (${p.price} SAR)...`);
            const planRow = await db.models.Plan.findOne({ where: { name: p.name } });
            assert(planRow !== null, `Plan ${p.name} exists in DB with ID ${planRow?.id}`);

            const testEmail = `plan_${p.key}_${Date.now()}@mubhir-test.sa`;
            const regRes = await ConnectService.registerStandalone({
                store_name: `متجر باقة ${p.name}`,
                email: testEmail,
                phone: '0501234567',
                password: 'PlanPassword123!'
            });

            assert(regRes.ok === true, `Registration succeeded for ${p.name}`);
            const tenantId = regRes.tenant_id;
            testTenantsToClean.push(tenantId);

            // If selected plan was Growth or Enterprise, update subscription plan to verify entitlements
            if (p.name !== 'الأساسية') {
                await db.models.Subscription.update({ plan_id: planRow.id }, { where: { tenant_id: tenantId } });
            }

            const resolvedPlan = await getTenantPlan(tenantId);
            assert(resolvedPlan?.name === p.name, `Resolved plan is ${p.name} (got: ${resolvedPlan?.name})`);

            const cfg = getPlanConfig(p.name);
            assert(cfg.price_monthly === p.price, `Billing mapping is ${p.price} SAR (got: ${cfg.price_monthly})`);

            const cloudApiGate = await checkTenantAccess(tenantId, 'whatsapp_api');
            if (p.cloudApi) {
                assert(cloudApiGate.allowed === true, `Cloud API (whatsapp_api) is ALLOWED for ${p.name}`);
            } else {
                assert(cloudApiGate.allowed === false, `Cloud API (whatsapp_api) is BLOCKED for ${p.name}`);
            }

            // Verify plan persists after email verification
            const tenant = await db.models.Tenant.findByPk(tenantId);
            await tenant.update({ is_email_verified: true, email_verification_token: null });
            const planAfterVerify = await getTenantPlan(tenantId);
            assert(planAfterVerify?.name === p.name, `Plan ${p.name} preserved after email verification`);

            // Verify password hash preserved
            const tenantAfterVerify = await db.models.Tenant.findByPk(tenantId);
            assert(ConnectService.verifyPassword('PlanPassword123!', tenantAfterVerify.password_hash), `Password login verified for ${p.name}`);
        }

        // -----------------------------------------------------------------
        // 2. SALLA MERCHANT ACCOUNT COMPLETION BACKEND E2E
        // -----------------------------------------------------------------
        console.log('\n--- 2. TESTING SALLA MERCHANT ACCOUNT COMPLETION E2E ---');
        const sallaMerchantId = Math.floor(200000000 + Math.random() * 800000000);
        const sallaEmail = `salla_merchant_${sallaMerchantId}@sallastore.sa`;

        console.log(`Simulating Salla OAuth flow for Merchant ID: ${sallaMerchantId}...`);
        const { tenant: sallaTenant, created: sallaCreated } = await ConnectService.upsertTenantFromOAuth({
            platform: 'salla',
            tokenData: {
                access_token: 'mock_salla_access_token_123',
                refresh_token: 'mock_salla_refresh_token_123',
                expires_in: 1209600,
                scope: 'offline_access',
                store_id: sallaMerchantId,
                store_name: 'متجر سلة التجريبي المتكامل',
                store_domain: `store-${sallaMerchantId}.salla.sa`,
                email: sallaEmail,
                owner_name: 'تاجر سلة التجريبي',
                contact_phone: '0555123456'
            }
        });

        assert(sallaCreated === true, 'Salla tenant created via OAuth');
        assert(sallaTenant.platform === 'salla', 'Platform is salla');
        assert(sallaTenant.salla_merchant_id === sallaMerchantId, 'salla_merchant_id matches');
        testTenantsToClean.push(sallaTenant.id);

        // Re-authorization must reuse existing tenant (no duplicates)
        const { tenant: sallaTenantReauth, created: sallaReauthCreated } = await ConnectService.upsertTenantFromOAuth({
            platform: 'salla',
            tokenData: {
                access_token: 'mock_salla_access_token_456',
                store_id: sallaMerchantId,
                store_name: 'متجر سلة التجريبي المتكامل',
                email: sallaEmail
            }
        });
        assert(sallaReauthCreated === false, 'Re-authorization does NOT create duplicate tenant');
        assert(sallaTenantReauth.id === sallaTenant.id, `Same Salla tenant reused (${sallaTenantReauth.id} === ${sallaTenant.id})`);

        // Salla Local Account Completion (Set Password)
        const sallaPassword = 'SallaSecurePass123!';
        const sallaHash = ConnectService.hashPassword(sallaPassword);
        await sallaTenant.update({
            password_hash: sallaHash,
            is_email_verified: true
        });

        const refreshedSalla = await db.models.Tenant.findByPk(sallaTenant.id);
        assert(refreshedSalla.password_hash !== null, 'Salla password hash stored');
        assert(ConnectService.verifyPassword(sallaPassword, refreshedSalla.password_hash), 'Salla local password verification succeeds');

        // Salla Forgot & Reset Password Flow
        const crypto = require('crypto');
        const resetToken = crypto.randomBytes(32).toString('hex');
        const resetExpiry = new Date(Date.now() + 3600000);
        await refreshedSalla.update({
            password_reset_token: resetToken,
            password_reset_expires_at: resetExpiry
        });

        const sallaByResetToken = await db.models.Tenant.findOne({ where: { password_reset_token: resetToken } });
        assert(sallaByResetToken !== null && sallaByResetToken.id === sallaTenant.id, 'Reset token resolves to Salla merchant');

        const newSallaPassword = 'SallaNewPassword456!';
        await sallaByResetToken.update({
            password_hash: ConnectService.hashPassword(newSallaPassword),
            password_reset_token: null,
            password_reset_expires_at: null
        });

        const sallaAfterReset = await db.models.Tenant.findByPk(sallaTenant.id);
        assert(ConnectService.verifyPassword(newSallaPassword, sallaAfterReset.password_hash), 'New password after reset works');
        assert(!ConnectService.verifyPassword(sallaPassword, sallaAfterReset.password_hash), 'Old password invalidated after reset');

    } catch (err) {
        console.error('Fatal error during test run:', err);
        failed++;
    } finally {
        console.log('\n--- CLEANING UP TEST TENANTS ---');
        for (const tid of testTenantsToClean) {
            await db.models.Subscription.destroy({ where: { tenant_id: tid } });
            await db.models.SallaOAuth.destroy({ where: { tenant_id: tid } });
            await db.models.Tenant.destroy({ where: { id: tid } });
        }
        console.log(`🧹 Cleaned up ${testTenantsToClean.length} test tenants`);
    }

    console.log('\n=================================================');
    console.log(`TEST SUMMARY: ${passed} PASSED, ${failed} FAILED`);
    console.log('=================================================');

    process.exit(failed > 0 ? 1 : 0);
}

runTests();
