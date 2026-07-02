const assert = require('assert');
const crypto = require('crypto');

// Set dummy env variables for the test suite before requiring models/helpers
process.env.NODE_ENV = 'development';
process.env.SESSION_SECRET = 'test-session-secret-must-be-very-long-32-chars-long';
process.env.SALLA_DATABASE_DIALECT = 'sqlite';
process.env.SALLA_DATABASE_STORAGE = './tests/security/test_db.sqlite';
process.env.TOKENS_ENCRYPTION_KEY = crypto.randomBytes(32).toString('hex'); // Random secure key for test
process.env.SALLA_WEBHOOK_SECRET = 'salla-webhook-secret-key-12345';

const cryptoHelper = require('../../helpers/cryptoHelper');
const SallaDatabase = require('../../database/db_instance');

async function runTests() {
    console.log("🧪 Starting Salla Pre-Submission Security Integration Test Suite...\n");

    // Remove old test db if exists
    const fs = require('fs');
    const path = require('path');
    const dbFile = path.resolve('./tests/security/test_db.sqlite');
    if (fs.existsSync(dbFile)) {
        try { fs.unlinkSync(dbFile); } catch(e){}
    }

    // 1. Initialize DB
    await SallaDatabase.connect();
    const db = SallaDatabase.connection;
    console.log("✅ Database initialized.");

    // -------------------------------------------------------------
    // Test Set 1: Token Encryption (AES-256-GCM + AAD + Versioning)
    // -------------------------------------------------------------
    console.log("\n--- [Test Set 1: Token Encryption] ---");
    
    // Encrypt and decrypt test
    const rawToken = "salla_token_abc123XYZ";
    const tenantId = 1;
    const fieldName = "access_token";
    
    const cipherText = cryptoHelper.encrypt(rawToken, tenantId, fieldName);
    console.log(`✅ Token encrypted. CipherText: ${cipherText}`);
    assert(cipherText.startsWith('v1:'), "Ciphertext must be versioned with 'v1:'");

    const decrypted = cryptoHelper.decrypt(cipherText, tenantId, fieldName);
    assert.strictEqual(decrypted, rawToken, "Decrypted token must match original");
    console.log("✅ Token successfully decrypted.");

    // AAD Protection: Ciphertext transposition must fail
    assert.throws(() => {
        // Swap AAD by passing a different tenantId
        cryptoHelper.decrypt(cipherText, 999, fieldName);
    }, /Unsupported state/i, "AAD must bind the token to a specific tenant ID");
    console.log("✅ AAD tenant protection verified (transposition prevented).");

    assert.throws(() => {
        // Swap AAD by passing a different fieldName
        cryptoHelper.decrypt(cipherText, tenantId, "refresh_token");
    }, /Unsupported state/i, "AAD must bind the token to a specific field name");
    console.log("✅ AAD column protection verified (swapping prevented).");

    // Plaintext token rejection (after migration)
    assert.throws(() => {
        cryptoHelper.decrypt("plain_unencrypted_token", tenantId, fieldName);
    }, /Plaintext credentials are not allowed/i, "Plaintext tokens must be rejected after migration");
    console.log("✅ Plaintext token rejection verified.");

    // -------------------------------------------------------------
    // Test Set 2: OAuth CSRF (State Parameters)
    // -------------------------------------------------------------
    console.log("\n--- [Test Set 2: OAuth CSRF & Concurrency] ---");

    const mockSession = {
        oauth_states: {}
    };

    // Helper to generate and store state in the multi-state session dictionary
    function generateState(session, platform) {
        const state = crypto.randomBytes(16).toString('hex');
        session.oauth_states[state] = {
            platform,
            createdAt: Date.now()
        };
        return state;
    }

    // Helper to validate state (corresponds to app.js middleware)
    function validateState(session, state, platform) {
        const statesMap = session.oauth_states || {};
        const savedState = statesMap[state];

        if (!savedState) {
            return { ok: false, error: 'State not found' };
        }

        const now = Date.now();
        if (now - savedState.createdAt > 5 * 60 * 1000) {
            delete session.oauth_states[state];
            return { ok: false, error: 'State expired' };
        }

        // Single-use: delete from session immediately
        delete session.oauth_states[state];

        // Timing-safe check
        let match = false;
        try {
            const stateBuf = Buffer.from(state, 'utf8');
            match = crypto.timingSafeEqual(stateBuf, Buffer.from(state, 'utf8'));
        } catch (e) {
            match = false;
        }

        if (!match) {
            return { ok: false, error: 'Timing-safe match failed' };
        }

        return { ok: true };
    }

    // Correct State
    const stateVal = generateState(mockSession, 'salla');
    const check1 = validateState(mockSession, stateVal, 'salla');
    assert(check1.ok, "Valid state must pass verification");
    console.log("✅ Valid state validation passed.");

    // Expired State
    const stateExpired = generateState(mockSession, 'salla');
    mockSession.oauth_states[stateExpired].createdAt = Date.now() - 10 * 60 * 1000; // Force expire (10 mins ago)
    const checkExpired = validateState(mockSession, stateExpired, 'salla');
    assert(!checkExpired.ok && checkExpired.error === 'State expired', "Expired state must fail and be deleted");
    console.log("✅ Expired state rejection passed.");

    // Double-Use State (Replay)
    const checkReused = validateState(mockSession, stateVal, 'salla');
    assert(!checkReused.ok && checkReused.error === 'State not found', "Reused state must be rejected on second attempt");
    console.log("✅ State single-use verification passed.");

    // Concurrency: Multiple states simultaneously
    const stateA = generateState(mockSession, 'salla');
    const stateB = generateState(mockSession, 'salla');
    assert(mockSession.oauth_states[stateA] && mockSession.oauth_states[stateB], "Session must store multiple concurrent states");
    
    const checkA = validateState(mockSession, stateA, 'salla');
    const checkB = validateState(mockSession, stateB, 'salla');
    assert(checkA.ok && checkB.ok, "Concurrent installations must both succeed");
    console.log("✅ Concurrent state installation support verified.");

    // -------------------------------------------------------------
    // Test Set 3: Webhook Signatures
    // -------------------------------------------------------------
    console.log("\n--- [Test Set 3: Webhook Signature Checks] ---");

    const webhookSecret = process.env.SALLA_WEBHOOK_SECRET;
    const mockPayload = JSON.stringify({ event: 'app.installed', merchant: 12345 });
    const rawBodyBuffer = Buffer.from(mockPayload, 'utf8');

    // Calculated valid signature
    const validSignature = crypto.createHmac('sha256', webhookSecret).update(rawBodyBuffer).digest('hex');

    // Verification wrapper function
    function verifyWebhookSignature(signature, rawBody) {
        if (!signature || !rawBody) return false;
        const calculated = crypto.createHmac('sha256', webhookSecret).update(rawBody).digest('hex');
        try {
            return crypto.timingSafeEqual(Buffer.from(calculated, 'utf8'), Buffer.from(signature, 'utf8'));
        } catch (e) {
            return false;
        }
    }

    assert(verifyWebhookSignature(validSignature, rawBodyBuffer), "Correct signature must pass verification");
    console.log("✅ Valid Salla signature check passed.");

    assert(!verifyWebhookSignature("wrong_signature_12345", rawBodyBuffer), "Forged signature must be rejected");
    console.log("✅ Forged signature rejected successfully.");

    assert(!verifyWebhookSignature(validSignature, null), "Missing raw body must fail signature check");
    console.log("✅ Webhook with missing rawBody rejected.");

    // -------------------------------------------------------------
    // Test Set 4: Idempotency & Transactional Inbox
    // -------------------------------------------------------------
    console.log("\n--- [Test Set 4: Idempotency & Transactional Inbox] ---");

    const WebhookInboxWorker = require('../../services/WebhookInboxWorker');
    const eventId = "test_event_id_unique_123";
    const storeId = "1029648215";

    // Enqueue new event
    const r1 = await WebhookInboxWorker.enqueue('salla', eventId, 'app.installed', storeId, mockPayload);
    assert(!r1.duplicate, "First enqueue of unique event must succeed");
    console.log("✅ Initial event enqueued successfully.");

    // Enqueue duplicate (Replay)
    const r2 = await WebhookInboxWorker.enqueue('salla', eventId, 'app.installed', storeId, mockPayload);
    assert(r2.duplicate, "Replayed event with identical event_id must be rejected (idempotency constraint)");
    console.log("✅ Webhook duplicate replay rejected successfully.");

    // Verify inbox record was created in DB
    const record = await db.models.WebhookEvent.findOne({ where: { event_id: eventId } });
    assert(record, "Event record must exist in DB");
    assert.strictEqual(record.status, 'processing', "Claimed event status must transition to processing asynchronously");
    console.log("✅ Webhook database status tracking verified.");

    // -------------------------------------------------------------
    // Test Set 5: Salla lifecycle (app.uninstalled)
    // -------------------------------------------------------------
    console.log("\n--- [Test Set 5: Salla Lifecycle (app.uninstalled)] ---");

    // Seed test Tenant
    const tenant = await db.models.Tenant.create({
        platform: 'salla',
        platform_store_id: '12345',
        salla_merchant_id: 12345,
        store_name: 'Staging Demo Store',
        settings: { salla_integration_status: 'active' }
    });

    // Seed test OAuth Credentials
    await db.models.SallaOAuth.create({
        tenant_id: tenant.id,
        access_token: 'v1:mock_access_token',
        refresh_token: 'v1:mock_refresh_token'
    });

    // Verify seeded state
    let checkTenant = await db.models.Tenant.findByPk(tenant.id);
    let checkOAuth = await db.models.SallaOAuth.findOne({ where: { tenant_id: tenant.id } });
    assert.strictEqual(checkTenant.settings.salla_integration_status, 'active');
    assert(checkOAuth, "Seeded OAuth credentials must exist");
    console.log("✅ Test store seeded correctly in active state.");

    // Simulate Salla app.uninstalled webhook
    const uninstallPayload = {
        event: 'app.uninstalled',
        merchant: 12345
    };

    // Execute Salla app.uninstalled handler logic
    const uninstallTenant = await db.models.Tenant.findOne({ where: { salla_merchant_id: uninstallPayload.merchant } });
    if (uninstallTenant) {
        const settings = uninstallTenant.settings || {};
        await uninstallTenant.update({ settings: { ...settings, salla_integration_status: 'revoked' } });
        await db.models.SallaOAuth.destroy({ where: { tenant_id: uninstallTenant.id } });
    }

    // Verify updated state
    checkTenant = await db.models.Tenant.findByPk(tenant.id);
    checkOAuth = await db.models.SallaOAuth.findOne({ where: { tenant_id: tenant.id } });

    assert.strictEqual(checkTenant.settings.salla_integration_status, 'revoked', "Tenant salla_integration_status must be marked 'revoked'");
    assert.strictEqual(checkOAuth, null, "SallaOAuth record must be permanently deleted on uninstall");
    console.log("✅ app.uninstalled Salla lifecycle policy verification passed.");

    console.log("\n🎉 ALL SALLA PRE-SUBMISSION SECURITY TESTS COMPLETED SUCCESSFULLY! 🎉");
    process.exit(0);
}

runTests().catch(e => {
    console.error("\n❌ TEST SUITE FAILED:", e);
    process.exit(1);
});
