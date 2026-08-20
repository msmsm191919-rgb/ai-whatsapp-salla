// tests/standalone_public_access_lock_test.js
// Automated verification of Standalone Public Access Lock (Coming Soon) & Salla Active Flow

const http = require('http');
const SallaDatabase = require('../database/db_instance');
const app = require('../app');

async function runTests() {
    console.log('=== STARTING STANDALONE PUBLIC ACCESS LOCK TESTS ===');
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

    // Wait for server initialization
    const testPort = process.env.PORT || 8095;
    await new Promise(resolve => setTimeout(resolve, 1500));

    async function request(options, body = null) {
        return new Promise((resolve, reject) => {
            const req = http.request({
                hostname: '127.0.0.1',
                port: testPort,
                ...options
            }, (res) => {
                let data = '';
                res.on('data', chunk => data += chunk);
                res.on('end', () => {
                    resolve({ statusCode: res.statusCode, headers: res.headers, body: data });
                });
            });
            req.on('error', reject);
            if (body) {
                req.write(typeof body === 'string' ? body : JSON.stringify(body));
            }
            req.end();
        });
    }

    try {
        // -------------------------------------------------------------
        // 1. STANDALONE BYPASS TESTS (MUST BE BLOCKED WITH 403 / COMING SOON)
        // -------------------------------------------------------------
        console.log('\n--- 1. STANDALONE BYPASS TESTS ---');

        const initialTenantCount = await db.models.Tenant.count({ where: { platform: 'standalone' } });

        // GET /auth/standalone -> Shows Coming Soon
        const getStandaloneRes = await request({ path: '/auth/standalone', method: 'GET' });
        assert(getStandaloneRes.statusCode === 200, 'GET /auth/standalone returns 200 OK');
        assert(getStandaloneRes.body.includes('التاجر المستقل'), 'Page includes title "التاجر المستقل"');
        assert(getStandaloneRes.body.includes('قريباً'), 'Page includes badge "قريباً"');
        assert(getStandaloneRes.body.includes('العودة للرئيسية'), 'Page includes "العودة للرئيسية" button');
        assert(!getStandaloneRes.body.includes('id="form-register"'), 'No registration form on page');
        assert(!getStandaloneRes.body.includes('id="form-login"'), 'No login form on page');

        // POST /connect/standalone -> Blocked 403
        const postRegisterRes = await request({
            path: '/connect/standalone',
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        }, { store_name: 'Bypass Store', email: 'bypass@test.sa', password: 'Password123!' });

        assert(postRegisterRes.statusCode === 403, `POST /connect/standalone blocked with 403 (got: ${postRegisterRes.statusCode})`);
        const postRegisterJson = JSON.parse(postRegisterRes.body || '{}');
        assert(postRegisterJson.ok === false, 'POST /connect/standalone returned ok=false');
        assert(postRegisterJson.error && postRegisterJson.error.includes('قريباً'), 'Error mentions coming soon');

        // Verify NO tenants created during bypass attempt
        const tenantCountAfterBypass = await db.models.Tenant.count({ where: { platform: 'standalone' } });
        assert(tenantCountAfterBypass === initialTenantCount, 'Zero new Standalone tenants created during bypass attempt');

        // POST /auth/standalone/login -> Blocked 403
        const postLoginRes = await request({
            path: '/auth/standalone/login',
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        }, { email: 'bypass@test.sa', password: 'Password123!' });
        assert(postLoginRes.statusCode === 403, `POST /auth/standalone/login blocked with 403 (got: ${postLoginRes.statusCode})`);

        // POST /auth/standalone/resend-verification -> Blocked 403
        const postResendRes = await request({
            path: '/auth/standalone/resend-verification',
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        }, { email: 'bypass@test.sa' });
        assert(postResendRes.statusCode === 403, `POST /auth/standalone/resend-verification blocked with 403 (got: ${postResendRes.statusCode})`);

        // POST /auth/standalone/forgot-password -> Blocked 403
        const postForgotRes = await request({
            path: '/auth/standalone/forgot-password',
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        }, { email: 'bypass@test.sa' });
        assert(postForgotRes.statusCode === 403, `POST /auth/standalone/forgot-password blocked with 403 (got: ${postForgotRes.statusCode})`);

        // -------------------------------------------------------------
        // 2. SALLA ACTIVE FLOWS (MUST REMAIN 100% FUNCTIONAL)
        // -------------------------------------------------------------
        console.log('\n--- 2. SALLA ACTIVE FLOWS ---');

        // GET /auth/salla -> Works
        const getSallaRes = await request({ path: '/auth/salla', method: 'GET' });
        assert(getSallaRes.statusCode === 200, 'GET /auth/salla returns 200 OK');
        assert(getSallaRes.body.includes('بوابة تجار سلة') || getSallaRes.body.includes('حساب متجر سلة'), 'Salla title found on page');

        // POST /auth/salla/forgot-password -> Works
        const postSallaForgotRes = await request({
            path: '/auth/salla/forgot-password',
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        }, { email: 'nonexistent_salla@test.sa' });
        assert(postSallaForgotRes.statusCode === 200, 'POST /auth/salla/forgot-password returns 200 OK');
        const sallaForgotJson = JSON.parse(postSallaForgotRes.body || '{}');
        assert(sallaForgotJson.ok === true, 'Salla forgot-password returned generic ok=true');

        // -------------------------------------------------------------
        // 3. TENANT 41 RUNTIME SAFETY (EXISTING TENANT INTACT)
        // -------------------------------------------------------------
        console.log('\n--- 3. TENANT 41 RUNTIME SAFETY ---');
        const { checkTenantAccess } = require('../services/planGate');
        // Check if tenant 41 exists in DB or test mock tenant
        const tenant41 = await db.models.Tenant.findByPk(41);
        if (tenant41) {
            assert(tenant41.platform === 'standalone', 'Tenant 41 platform is standalone');
            assert(tenant41.status === 'active', 'Tenant 41 status is active');
            const access41 = await checkTenantAccess(41);
            assert(access41.allowed === true, 'Tenant 41 runtime access is ALLOWED');
        } else {
            console.log('  ℹ️ Tenant 41 not present in local SQLite test DB (will be verified on Production MySQL)');
        }

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
