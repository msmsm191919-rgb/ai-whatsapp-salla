const assert = require('assert');
const crypto = require('crypto');

// Set env variables for tests
process.env.NODE_ENV = 'development';
process.env.SESSION_SECRET = 'test-session-secret-must-be-very-long-32-chars-long';
process.env.SALLA_DATABASE_DIALECT = 'sqlite';
process.env.SALLA_DATABASE_STORAGE = './tests/security/test_bootstrap_db.sqlite';
process.env.TOKENS_ENCRYPTION_KEY = crypto.randomBytes(32).toString('hex');
process.env.ALLOW_SCHEMA_SYNC = 'true';
process.env.APP_URL = 'https://localhost:8095';

const SallaDatabase = require('../../database/db_instance');

async function claimToken(db, tokenHash) {
    const now = new Date();
    const [updatedCount] = await db.models.TenantLoginToken.update(
        { used_at: now },
        {
            where: {
                token_hash: tokenHash,
                used_at: null,
                revoked_at: null,
                expires_at: {
                    [db.Sequelize.Op.gt]: now
                }
            }
        }
    );
    return updatedCount;
}

async function runBootstrapTests() {
    console.log("🧪 Starting Salla Easy Mode Session Bootstrap Integration Tests...\n");

    const fs = require('fs');
    const path = require('path');
    const dbFile = path.resolve('./tests/security/test_bootstrap_db.sqlite');
    if (fs.existsSync(dbFile)) {
        try { fs.unlinkSync(dbFile); } catch(e){}
    }

    // Connect & Sync
    await SallaDatabase.connect();
    const db = SallaDatabase.connection;

    // Drop and Sync to start clean
    await db.drop();
    await db.sync({ force: true });

    // Seed Plans
    await db.models.Plan.bulkCreate([
        { id: 1, name: 'الأساسية', price: 49 },
        { id: 2, name: 'النمو', price: 149 },
        { id: 3, name: 'الشركات', price: 299 }
    ]);

    const ConnectService = require('../../services/ConnectService');

    // ──────────────────────────────────────────────────────────
    // Test 1: First installation with valid email
    // ──────────────────────────────────────────────────────────
    console.log("--- [Test 1: First installation with valid email] ---");
    
    const tokenData = {
        access_token: 'valid_access_token_123',
        refresh_token: 'valid_refresh_token_123',
        expires_in: 86400,
        store_id: 'merchant_111',
        store_name: 'متجر العطور الأصيل',
        store_domain: 'aseel-perfumes.salla.sa',
        email: 'merchant@aseel-perfumes.com',
        owner_name: 'عبدالرحمن العتيبي',
        contact_phone: '966500000001'
    };

    const res = await ConnectService.upsertTenantFromOAuth({
        platform: 'salla',
        tokenData
    });

    assert.strictEqual(res.created, true, "Tenant must be created");
    const tenant = res.tenant;
    assert.strictEqual(tenant.email, 'merchant@aseel-perfumes.com', "Email must be saved correctly");
    assert.strictEqual(tenant.settings.welcome_email_status, 'pending', "Welcome email status should be pending");

    // Check token was generated in TenantLoginTokens table
    const tokenRecord = await db.models.TenantLoginToken.findOne({
        where: { tenant_id: tenant.id }
    });
    assert(tokenRecord, "A bootstrap login token record must be created");
    assert(tokenRecord.token_hash, "Token hash must be populated");
    assert.strictEqual(tokenRecord.purpose, 'login', "Purpose must be 'login'");
    assert(tokenRecord.expires_at > new Date(), "Expiry must be in the future");
    console.log("✅ Token successfully generated and hashed in the DB.");

    // Check EmailOutbox entry
    const outboxRecord = await db.models.EmailOutbox.findOne({
        where: { tenant_id: tenant.id }
    });
    assert(outboxRecord, "Email outbox record must be created");
    assert.strictEqual(outboxRecord.template, 'salla_welcome', "Template must be salla_welcome");
    assert.strictEqual(outboxRecord.status, 'pending', "Outbox status must be pending");
    assert.strictEqual(outboxRecord.recipient, 'merchant@aseel-perfumes.com', "Recipient must be saved");
    console.log("✅ Welcome email registered in the outbox.");

    // ──────────────────────────────────────────────────────────
    // Test 2: Double/Re-installation (Idempotency)
    // ──────────────────────────────────────────────────────────
    console.log("\n--- [Test 2: Re-installation Idempotency checks] ---");
    const res2 = await ConnectService.upsertTenantFromOAuth({
        platform: 'salla',
        tokenData
    });
    assert.strictEqual(res2.created, false, "Tenant must not be re-created");

    // Check that welcome email was NOT generated again (only 1 outbox record should exist)
    const outboxRecords = await db.models.EmailOutbox.findAll({
        where: { tenant_id: tenant.id, template: 'salla_welcome' }
    });
    assert.strictEqual(outboxRecords.length, 1, "Duplicate outbox records must be prevented");
    console.log("✅ Email outbox duplicate checks passed.");

    // ──────────────────────────────────────────────────────────
    // Test 3: Missing Email Fallback
    // ──────────────────────────────────────────────────────────
    console.log("\n--- [Test 3: Missing Email Fallback] ---");
    const tokenDataNoEmail = {
        access_token: 'valid_access_token_456',
        refresh_token: 'valid_refresh_token_456',
        expires_in: 86400,
        store_id: 'merchant_222',
        store_name: 'متجر بلا بريد',
        store_domain: 'no-email.salla.sa',
        email: '', // missing
        owner_name: 'صالح الأحمد',
        contact_phone: '966500000002'
    };

    const resNoEmail = await ConnectService.upsertTenantFromOAuth({
        platform: 'salla',
        tokenData: tokenDataNoEmail
    });

    const tenantNoEmail = resNoEmail.tenant;
    assert.strictEqual(tenantNoEmail.email, null, "Email must be null");
    assert.strictEqual(tenantNoEmail.settings.welcome_email_status, 'missing_recipient', "welcome_email_status must be 'missing_recipient'");

    const outboxNoEmail = await db.models.EmailOutbox.findOne({
        where: { tenant_id: tenantNoEmail.id }
    });
    assert(outboxNoEmail, "Outbox record should exist");
    assert.strictEqual(outboxNoEmail.status, 'missing_recipient', "Outbox status must be 'missing_recipient'");
    console.log("✅ Welcome email status correctly marked as 'missing_recipient'.");

    // ──────────────────────────────────────────────────────────
    // Test 4: Token Expiry, Claim Integrity, Revocation
    // ──────────────────────────────────────────────────────────
    console.log("\n--- [Test 4: Token Claim Validation, Expiry & Revocation] ---");
    
    // Create an expired token record
    const expiredTokenHash = crypto.createHash('sha256').update('expired_token').digest('hex');
    await db.models.TenantLoginToken.create({
        tenant_id: tenant.id,
        token_hash: expiredTokenHash,
        purpose: 'login',
        expires_at: new Date(Date.now() - 5000) // expired 5 secs ago
    });

    const claimExpiredRes = await claimToken(db, expiredTokenHash);
    assert.strictEqual(claimExpiredRes, 0, "Claiming an expired token must update 0 rows");
    console.log("✅ Expired token claim rejection verified.");

    // Create a used token record
    const usedTokenHash = crypto.createHash('sha256').update('used_token').digest('hex');
    await db.models.TenantLoginToken.create({
        tenant_id: tenant.id,
        token_hash: usedTokenHash,
        purpose: 'login',
        expires_at: new Date(Date.now() + 60000),
        used_at: new Date()
    });

    const claimUsedRes = await claimToken(db, usedTokenHash);
    assert.strictEqual(claimUsedRes, 0, "Claiming an already used token must update 0 rows");
    console.log("✅ Already used token claim rejection verified.");

    // Create a revoked token record
    const revokedTokenHash = crypto.createHash('sha256').update('revoked_token').digest('hex');
    await db.models.TenantLoginToken.create({
        tenant_id: tenant.id,
        token_hash: revokedTokenHash,
        purpose: 'login',
        expires_at: new Date(Date.now() + 60000),
        revoked_at: new Date()
    });

    const claimRevokedRes = await claimToken(db, revokedTokenHash);
    assert.strictEqual(claimRevokedRes, 0, "Claiming a revoked token must update 0 rows");
    console.log("✅ Revoked token claim rejection verified.");

    // ──────────────────────────────────────────────────────────
    // Test 5: Concurrent Claim Validation
    // ──────────────────────────────────────────────────────────
    console.log("\n--- [Test 5: Concurrent Token Claim Verification] ---");
    const concurrentToken = 'concurrent_magic_token_value';
    const concurrentHash = crypto.createHash('sha256').update(concurrentToken).digest('hex');

    await db.models.TenantLoginToken.create({
        tenant_id: tenant.id,
        token_hash: concurrentHash,
        purpose: 'login',
        expires_at: new Date(Date.now() + 60000)
    });

    // Run claims concurrently
    const [p1, p2] = await Promise.all([
        claimToken(db, concurrentHash),
        claimToken(db, concurrentHash)
    ]);

    assert.strictEqual(p1 + p2, 1, "Exactly one parallel claim attempt must succeed");
    console.log(`✅ Concurrent claim verified. Success count: ${p1 + p2} (Attempt 1: ${p1}, Attempt 2: ${p2})`);

    // ──────────────────────────────────────────────────────────
    // Test 6: Environment Boot Validation checks
    // ──────────────────────────────────────────────────────────
    console.log("\n--- [Test 6: Env Boot Verification] ---");
    const envValidator = require('../../helpers/envValidator');

    // Staging without APP_URL must throw/exit
    const origExit = process.exit;
    let exitCode = null;
    process.exit = (code) => {
        exitCode = code;
    };

    process.env.NODE_ENV = 'staging';
    delete process.env.APP_URL;

    envValidator();
    assert.strictEqual(exitCode, 1, "App must call process.exit(1) on staging if APP_URL is missing");
    console.log("✅ Staging boot validation without APP_URL halts boot correctly.");

    // Staging with invalid APP_URL (not https)
    process.env.APP_URL = 'http://insecure-domain.com';
    envValidator();
    assert.strictEqual(exitCode, 1, "App must call process.exit(1) on staging if APP_URL does not start with https://");
    console.log("✅ Staging boot validation with insecure APP_URL protocol halts boot correctly.");

    // Staging with sync alter active
    process.env.APP_URL = 'https://valid-domain.com';
    process.env.ALLOW_SCHEMA_SYNC = 'true';
    envValidator();
    assert.strictEqual(exitCode, 1, "App must call process.exit(1) on staging if ALLOW_SCHEMA_SYNC=true is set");
    console.log("✅ Staging boot validation with ALLOW_SCHEMA_SYNC=true halts boot correctly.");

    // Restore env and exit mock
    process.exit = origExit;
    process.env.NODE_ENV = 'development';
    process.env.ALLOW_SCHEMA_SYNC = 'true';
    process.env.APP_URL = 'https://localhost:8095';

    console.log("\n🎉 ALL SESSION BOOTSTRAP AND EMAIL OUTBOX TESTS COMPLETED SUCCESSFULLY! 🎉\n");
}

runBootstrapTests().catch(err => {
    console.error("❌ TEST SUITE FAILED:", err);
    process.exit(1);
});
