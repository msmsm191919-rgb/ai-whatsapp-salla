const assert = require('assert');
const crypto = require('crypto');

// Set env variables for tests
process.env.NODE_ENV = 'development';
process.env.SESSION_SECRET = 'test-session-secret-must-be-very-long-32-chars-long';
process.env.SALLA_DATABASE_DIALECT = 'sqlite';
process.env.SALLA_DATABASE_STORAGE = './tests/security/test_bootstrap_db.sqlite';
process.env.TOKENS_ENCRYPTION_KEY = crypto.randomBytes(32).toString('hex');

const SallaDatabase = require('../../database/db_instance');

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
    // Test 4: Token Expiry & Claim Integrity
    // ──────────────────────────────────────────────────────────
    console.log("\n--- [Test 4: Token Claim Validation & Expiry] ---");
    
    // Create an expired token record
    const expiredTokenHash = crypto.createHash('sha256').update('expired_token').digest('hex');
    await db.models.TenantLoginToken.create({
        tenant_id: tenant.id,
        token_hash: expiredTokenHash,
        purpose: 'login',
        expires_at: new Date(Date.now() - 5000) // expired 5 secs ago
    });

    const checkExpired = await db.models.TenantLoginToken.findOne({
        where: { token_hash: expiredTokenHash }
    });
    assert(new Date() > new Date(checkExpired.expires_at), "Token must be expired");
    console.log("✅ Expired token verified.");

    // Create a used token record
    const usedTokenHash = crypto.createHash('sha256').update('used_token').digest('hex');
    await db.models.TenantLoginToken.create({
        tenant_id: tenant.id,
        token_hash: usedTokenHash,
        purpose: 'login',
        expires_at: new Date(Date.now() + 60000),
        used_at: new Date()
    });

    const checkUsed = await db.models.TenantLoginToken.findOne({
        where: { token_hash: usedTokenHash }
    });
    assert(checkUsed.used_at, "Token must be marked as used");
    console.log("✅ Already used token verified.");

    console.log("\n🎉 ALL SESSION BOOTSTRAP AND EMAIL OUTBOX TESTS COMPLETED SUCCESSFULLY! 🎉\n");
}

runBootstrapTests().catch(err => {
    console.error("❌ TEST SUITE FAILED:", err);
    process.exit(1);
});
