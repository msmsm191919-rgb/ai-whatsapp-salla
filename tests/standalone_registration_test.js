// tests/standalone_registration_test.js
// Comprehensive E2E Test Battery for Standalone Registration, Email Verification & Plan Invariants

const SallaDatabase = require('../database/db_instance');
const ConnectService = require('../services/ConnectService');
const EmailService = require('../services/EmailService');
const { checkTenantAccess } = require('../services/planGate');

async function runTests() {
    console.log('=== STARTING STANDALONE REGISTRATION E2E TEST BATTERY ===');
    
    // Ensure DB connection
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

    const testEmailA = `test_a_${Date.now()}@mubhir-test.sa`;
    const testEmailD = `test_d_${Date.now()}@mubhir-test.sa`;

    try {
        // -------------------------------------------------------------
        // TEST A: NEW ACCOUNT
        // -------------------------------------------------------------
        console.log('\n--- TEST A: NEW ACCOUNT ---');
        const countBeforeA = await db.models.Tenant.count({ where: { platform: 'standalone', email: testEmailA } });
        assert(countBeforeA === 0, 'Tenant does not exist prior to test');

        const resA = await ConnectService.registerStandalone({
            store_name: 'متجر اختبار أ',
            email: testEmailA,
            phone: '0501112233',
            password: 'SecurePassword123!'
        });

        assert(resA.ok === true, 'registerStandalone returned ok=true');
        assert(resA.created === true, 'created flag is true');
        assert(resA.case === 'NEW_ACCOUNT', 'case is NEW_ACCOUNT');
        assert(typeof resA.tenant_id === 'number', `tenant_id is numeric (${resA.tenant_id})`);

        const tenantA = await db.models.Tenant.findByPk(resA.tenant_id);
        assert(tenantA !== null, 'Tenant record found in DB');
        assert(tenantA.password_hash !== null && tenantA.password_hash.includes(':'), 'password_hash is hashed with salt (not plaintext)');
        assert(ConnectService.verifyPassword('SecurePassword123!', tenantA.password_hash), 'verifyPassword returns true for correct password');
        assert(!ConnectService.verifyPassword('WrongPassword', tenantA.password_hash), 'verifyPassword returns false for wrong password');
        assert(tenantA.is_email_verified === false, 'is_email_verified is false initially');
        assert(tenantA.email_verification_token !== null, 'email_verification_token is generated');

        // Check Subscription and Plan
        const subA = await db.models.Subscription.findOne({ where: { tenant_id: tenantA.id } });
        assert(subA !== null, 'Subscription record created');
        const planA = await db.models.Plan.findByPk(subA.plan_id);
        assert(planA !== null && planA.name === 'الأساسية', `Plan is Basic ("الأساسية"), got: ${planA?.name}`);

        const { getTenantPlan, checkTenantAccess } = require('../services/planGate');
        const planAccessA = await getTenantPlan(tenantA.id);
        assert(planAccessA !== null && planAccessA.name === 'الأساسية', `getTenantPlan resolves to Basic ("الأساسية"), got: ${planAccessA?.name}`);

        const gateAccessA = await checkTenantAccess(tenantA.id);
        assert(gateAccessA.allowed === true, 'General access is allowed for Basic active trial');

        const cloudApiAccessA = await checkTenantAccess(tenantA.id, 'whatsapp_api');
        assert(cloudApiAccessA.allowed === false, 'Cloud API (whatsapp_api) is blocked for Basic plan');

        // Test Verification Link Flow
        const tokenA = tenantA.email_verification_token;
        const tenantByToken = await db.models.Tenant.findOne({ where: { email_verification_token: tokenA } });
        assert(tenantByToken !== null && tenantByToken.id === tenantA.id, 'Token resolves to correct tenant');

        await tenantByToken.update({
            is_email_verified: true,
            email_verified_at: new Date(),
            email_verification_token: null
        });

        const refreshedTenantA = await db.models.Tenant.findByPk(tenantA.id);
        assert(refreshedTenantA.is_email_verified === true, 'Tenant is now verified');
        assert(refreshedTenantA.email_verification_token === null, 'Token cleared after verification (prevents replay)');

        // -------------------------------------------------------------
        // TEST B: SAME UNVERIFIED EMAIL
        // -------------------------------------------------------------
        console.log('\n--- TEST B: SAME UNVERIFIED EMAIL (RE-REGISTER) ---');
        const testEmailB = `test_b_${Date.now()}@mubhir-test.sa`;

        // Register initial unverified
        const resB1 = await ConnectService.registerStandalone({
            store_name: 'متجر اختبار ب',
            email: testEmailB,
            phone: '0502223344',
            password: 'OriginalPassword123!'
        });
        assert(resB1.ok === true && resB1.created === true, 'Initial registration succeeded');
        const tenantIdB = resB1.tenant_id;
        const tenantB1 = await db.models.Tenant.findByPk(tenantIdB);
        const originalTokenB = tenantB1.email_verification_token;
        const originalHashB = tenantB1.password_hash;

        const countBeforeB2 = await db.models.Tenant.count({ where: { platform: 'standalone', email: testEmailB } });
        assert(countBeforeB2 === 1, 'Exactly 1 tenant exists before re-register');

        // Re-register same unverified email
        const resB2 = await ConnectService.registerStandalone({
            store_name: 'متجر اختبار ب المعدل',
            email: testEmailB,
            phone: '0509999999',
            password: 'NewPasswordAttempt!'
        });

        assert(resB2.ok === true, 'Re-registration returned ok=true');
        assert(resB2.created === false, 'created flag is false (tenant reused)');
        assert(resB2.case === 'EXISTING_UNVERIFIED', 'case is EXISTING_UNVERIFIED');
        assert(resB2.tenant_id === tenantIdB, `Same tenant_id preserved (${resB2.tenant_id} === ${tenantIdB})`);

        const countAfterB2 = await db.models.Tenant.count({ where: { platform: 'standalone', email: testEmailB } });
        assert(countAfterB2 === 1, 'Tenant count remains exactly 1 (0 new tenants created)');

        const tenantB2 = await db.models.Tenant.findByPk(tenantIdB);
        assert(tenantB2.password_hash === originalHashB, 'Password was NOT overwritten during re-registration');
        assert(tenantB2.email_verification_token !== originalTokenB, 'New verification token was generated');

        // -------------------------------------------------------------
        // TEST C: SAME VERIFIED EMAIL
        // -------------------------------------------------------------
        console.log('\n--- TEST C: SAME VERIFIED EMAIL (REJECTION) ---');
        // Mark B as verified
        await tenantB2.update({ is_email_verified: true, email_verification_token: null });

        const countBeforeC = await db.models.Tenant.count({ where: { platform: 'standalone', email: testEmailB } });
        const resC = await ConnectService.registerStandalone({
            store_name: 'محاولة تسجيل مكرر',
            email: testEmailB,
            phone: '0500000000',
            password: 'AnotherPassword!'
        });

        assert(resC.ok === false, 'Registration of verified email was rejected (ok=false)');
        assert(resC.case === 'EXISTING_VERIFIED', 'case is EXISTING_VERIFIED');
        assert(resC.error && resC.error.includes('يوجد حساب بهذا البريد'), 'Proper localized error returned');

        const countAfterC = await db.models.Tenant.count({ where: { platform: 'standalone', email: testEmailB } });
        assert(countAfterC === countBeforeC, 'Tenant count unchanged (0 duplicates created)');

        // -------------------------------------------------------------
        // TEST D: 5 CONCURRENT REGISTRATIONS
        // -------------------------------------------------------------
        console.log('\n--- TEST D: 5 CONCURRENT REGISTRATIONS ---');
        const countBeforeD = await db.models.Tenant.count({ where: { platform: 'standalone', email: testEmailD } });
        assert(countBeforeD === 0, 'No tenant exists before concurrent test');

        const promises = [];
        for (let i = 0; i < 5; i++) {
            promises.push(ConnectService.registerStandalone({
                store_name: `متجر متزامن ${i}`,
                email: testEmailD,
                phone: `050000000${i}`,
                password: 'ConcurrentPass123!'
            }));
        }

        const resultsD = await Promise.all(promises);
        const countAfterD = await db.models.Tenant.count({ where: { platform: 'standalone', email: testEmailD } });
        assert(countAfterD === 1, `CONCURRENT_TENANTS_CREATED: Exactly 1 tenant created (got ${countAfterD}) across 5 simultaneous requests`);

        const createdCount = resultsD.filter(r => r.ok && r.created === true).length;
        assert(createdCount === 1, `Exactly 1 response has created=true (got ${createdCount})`);

        // -------------------------------------------------------------
        // TEST E: RESEND VERIFICATION API
        // -------------------------------------------------------------
        console.log('\n--- TEST E: RESEND VERIFICATION API ---');
        const resendRes1 = await ConnectService.resendVerificationEmail(testEmailD);
        assert(resendRes1.ok === true, 'resendVerificationEmail returned ok=true');
        assert(resendRes1.email_sent === true || resendRes1.email_sent === false, 'resend response has valid email_sent status');

        // Test with non-existent email (must give generic response to prevent account enumeration)
        const resendResNonExistent = await ConnectService.resendVerificationEmail('nonexistent_user_xyz@test.sa');
        assert(resendResNonExistent.ok === true, 'Non-existent email gets generic ok=true (no account enumeration)');
        assert(resendResNonExistent.email_sent === false, 'No email sent for non-existent account');

        // -------------------------------------------------------------
        // CLEANUP TEST DATA
        // -------------------------------------------------------------
        console.log('\n--- CLEANING UP TEST DATA ---');
        const testTenants = await db.models.Tenant.findAll({
            where: {
                email: [testEmailA, testEmailB, testEmailD]
            }
        });
        for (const t of testTenants) {
            await db.models.Subscription.destroy({ where: { tenant_id: t.id } });
            await t.destroy();
        }
        console.log(`  🧹 Cleaned up ${testTenants.length} temporary test tenants`);

    } catch (err) {
        console.error('Fatal error during test run:', err);
        failed++;
    }

    console.log('\n=================================================');
    console.log(`TEST SUMMARY: ${passed} PASSED, ${failed} FAILED`);
    console.log('=================================================');

    process.exit(failed > 0 ? 1 : 0);
}

runTests();
