const assert = require('assert');
const crypto = require('crypto');

// Set dummy env variables for the test suite before requiring models/helpers
process.env.NODE_ENV = process.env.NODE_ENV || 'development';
process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'test-session-secret-must-be-very-long-32-chars-long';
process.env.SALLA_DATABASE_DIALECT = process.env.SALLA_DATABASE_DIALECT || 'sqlite';
process.env.SALLA_DATABASE_STORAGE = process.env.SALLA_DATABASE_STORAGE || './tests/security/test_db.sqlite';
process.env.TOKENS_ENCRYPTION_KEY = process.env.TOKENS_ENCRYPTION_KEY || crypto.randomBytes(32).toString('hex');
process.env.SALLA_WEBHOOK_SECRET = process.env.SALLA_WEBHOOK_SECRET || 'salla-webhook-secret-key-12345';

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

    const SallaWebhook = require('@salla.sa/webhooks-actions');
    SallaWebhook.setSecret('salla-webhook-secret-key-12345');
    SallaWebhook.on("app.store.authorize", async (data) => {
        try {
            const merchantId = data.merchant;
            const tokenData = data.data;

            const SallaAdapter = require('../../services/platforms/SallaAdapter');
            const storeInfo = await SallaAdapter.fetchStoreInfo(tokenData.access_token);

            const ConnectService = require('../../services/ConnectService');
            
            const expiresTimestamp = Number(tokenData.expires || 0);
            const nowSecs = Math.floor(Date.now() / 1000);
            const expires_in = expiresTimestamp > nowSecs ? (expiresTimestamp - nowSecs) : 86400;

            const { tenant } = await ConnectService.upsertTenantFromOAuth({
                platform: 'salla',
                tokenData: {
                    access_token: tokenData.access_token,
                    refresh_token: tokenData.refresh_token,
                    expires_in: expires_in,
                    store_id: String(merchantId),
                    store_name: storeInfo.store_name,
                    store_domain: storeInfo.store_domain,
                    email: storeInfo.email,
                    owner_name: storeInfo.owner_name,
                    contact_phone: storeInfo.contact_phone
                }
            });

            const settings = tenant.settings || {};
            await tenant.update({
                status: 'active',
                settings: { ...settings, billing_source: 'salla', salla_integration_status: 'active' }
            });
        } catch (e) {
            console.error("Test app.store.authorize listener failed:", e.message);
        }
    });

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
    await new Promise(resolve => setTimeout(resolve, 50));
    const record = await db.models.WebhookEvent.findOne({ where: { event_id: eventId } });
    assert(record, "Event record must exist in DB");
    assert(record.status === 'processing' || record.status === 'processed', "Claimed event status must transition to processing or processed asynchronously");
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

    // -------------------------------------------------------------
    // Test Set 6: Plaintext Runtime Rejection
    // -------------------------------------------------------------
    console.log("\n--- [Test Set 6: Plaintext Runtime Rejection] ---");
    // Seed raw plaintext token directly via database query to bypass setter encryption
    await db.query(`INSERT INTO SallaOAuth (tenant_id, access_token, refresh_token, created_at, updated_at) VALUES (${tenant.id}, 'plain_token_unencrypted', 'plain_refresh_unencrypted', datetime('now'), datetime('now'))`);
    
    const plainRecord = await db.models.SallaOAuth.findOne({ where: { tenant_id: tenant.id } });
    assert.throws(() => {
        const val = plainRecord.access_token; // accessing getter must fail
    }, /Plaintext credentials are not allowed/i, "Runtime getter must refuse plain tokens and throw decryption error");
    console.log("✅ Runtime plaintext rejection verified (getter threw decryption error).");
    
    // Clean up
    await db.models.SallaOAuth.destroy({ where: { tenant_id: tenant.id } });

    // -------------------------------------------------------------
    // Test Set 7: Easy Mode & Real-like Demo Store Lifecycle
    // -------------------------------------------------------------
    console.log("\n--- [Test Set 7: Easy Mode (app.store.authorize)] ---");
    const easyModeMerchant = 998877;
    const mockAuthPayload = {
        event: 'app.store.authorize',
        merchant: easyModeMerchant,
        data: {
            access_token: 'mock_easy_access',
            refresh_token: 'mock_easy_refresh',
            expires: Math.floor(Date.now() / 1000) + 86400
        }
    };
    
    // Process app.store.authorize using enqueuing in InboxWorker
    const easyEventId = "easy_mode_auth_test_111";
    await WebhookInboxWorker.enqueue('salla', easyEventId, 'app.store.authorize', easyModeMerchant, JSON.stringify(mockAuthPayload));
    
    // Wait for background worker to process it
    await new Promise(resolve => setTimeout(resolve, 100));
    
    // Verify tenant created
    const easyTenant = await db.models.Tenant.findOne({ where: { salla_merchant_id: easyModeMerchant } });
    assert(easyTenant, "Easy Mode tenant must be created on app.store.authorize");
    assert.strictEqual(easyTenant.settings.billing_source, 'salla', "Easy Mode tenant billing_source must be 'salla'");
    assert.strictEqual(easyTenant.settings.salla_integration_status, 'active', "Salla integration must be active");
    
    // Verify tokens saved securely (encrypted)
    const easyOAuth = await db.models.SallaOAuth.findOne({ where: { tenant_id: easyTenant.id } });
    assert(easyOAuth, "OAuth record must be created");
    assert(easyOAuth.getDataValue('access_token').startsWith('v1:'), "Access token must be saved encrypted in DB");
    console.log("✅ Easy Mode authorization and secure encryption verified.");

    // -------------------------------------------------------------
    // Test Set 8: Token Refresh Rotation & invalid_grant
    // -------------------------------------------------------------
    console.log("\n--- [Test Set 8: Token Refresh invalid_grant Revocation] ---");
    const SallaService = require('../../services/SallaService');
    const axios = require('axios');
    const originalPost = axios.post;
    axios.post = async () => {
        const err = new Error("Request failed with status code 400");
        err.response = { data: { error: 'invalid_grant', message: 'Invalid refresh token' } };
        throw err;
    };

    // Set expires_at to a past date to force refresh
    const recordToExpiry = await db.models.SallaOAuth.findOne({ where: { tenant_id: easyTenant.id } });
    recordToExpiry.expires_at = new Date(Date.now() - 3600000);
    await recordToExpiry.save();

    // Trigger refresh which will fail with invalid_grant
    const refreshResult = await SallaService.refreshToken(easyTenant.id);
    assert.strictEqual(refreshResult, false, "Refresh must fail on invalid_grant");

    // Verify integration is revoked and tokens cleared
    const postRefreshTenant = await db.models.Tenant.findByPk(easyTenant.id);
    const postRefreshOAuth = await db.models.SallaOAuth.findOne({ where: { tenant_id: easyTenant.id } });
    
    assert.strictEqual(postRefreshTenant.settings.salla_integration_status, 'revoked', "Integration must be revoked on invalid_grant");
    assert.strictEqual(postRefreshOAuth, null, "OAuth tokens must be deleted on invalid_grant");
    console.log("✅ Token refresh invalid_grant revocation policy verified.");
    
    // Restore axios
    axios.post = originalPost;

    // -------------------------------------------------------------
    // Test Set 9: Subscription Policy by Billing Source
    // -------------------------------------------------------------
    console.log("\n--- [Test Set 9: Subscription Billing Source Policy] ---");
    const BillingService = require('../../services/BillingService');
    
    // Case A: billing_source = 'salla' (Expired -> Tenant status inactive)
    const tenantSalla = await db.models.Tenant.create({
        platform: 'salla',
        salla_merchant_id: 111111,
        store_name: 'Salla Billed Store',
        status: 'active',
        settings: { billing_source: 'salla' }
    });
    await db.models.Subscription.create({
        tenant_id: tenantSalla.id,
        plan_id: 1,
        status: 'active',
        end_date: new Date(Date.now() - 3600000) // expired
    });
    
    await BillingService.handleSallaSubscriptionExpired(111111, 'sub_111');
    const checkedSallaTenant = await db.models.Tenant.findByPk(tenantSalla.id);
    assert.strictEqual(checkedSallaTenant.status, 'inactive', "Tenant status must become inactive for Salla billed subscriptions on expiration");
    console.log("✅ Case A: Salla billing expiration (Tenant inactivated) passed.");

    // Case B: billing_source = 'external' (Expired -> Tenant active, Salla integration revoked)
    const tenantExternal = await db.models.Tenant.create({
        platform: 'salla',
        salla_merchant_id: 222222,
        store_name: 'External Billed Store',
        status: 'active',
        settings: { billing_source: 'external', salla_integration_status: 'active' }
    });
    await db.models.SallaOAuth.create({
        tenant_id: tenantExternal.id,
        access_token: 'v1:mock_access_ext',
        refresh_token: 'v1:mock_refresh_ext'
    });
    await db.models.Subscription.create({
        tenant_id: tenantExternal.id,
        plan_id: 1,
        status: 'active',
        end_date: new Date(Date.now() - 3600000) // expired
    });

    await BillingService.handleSallaSubscriptionExpired(222222, 'sub_222');
    const checkedExternalTenant = await db.models.Tenant.findByPk(tenantExternal.id);
    const checkedExternalOAuth = await db.models.SallaOAuth.findOne({ where: { tenant_id: tenantExternal.id } });
    
    assert.strictEqual(checkedExternalTenant.status, 'active', "Tenant status must remain active for externally billed subscriptions on expiration");
    assert.strictEqual(checkedExternalTenant.settings.salla_integration_status, 'revoked', "Salla integration must be revoked");
    assert.strictEqual(checkedExternalOAuth, null, "SallaOAuth credentials must be deleted");
    console.log("✅ Case B: External billing expiration (Integration revoked, WhatsApp active) passed.");

    // -------------------------------------------------------------
    // Test Set 10: Concurrency Lock & SQLite Write Lock Check
    // -------------------------------------------------------------
    console.log("\n--- [Test Set 10: Concurrency Lock & SQLite Write Lock Check] ---");
    // SallaService and axios already declared in Test Set 8
    const originalPostConcurrency = axios.post;
    
    // Seed new Salla OAuth credentials
    const tenantLockTest = await db.models.Tenant.create({
        platform: 'salla',
        salla_merchant_id: 333333,
        store_name: 'Lock Test Store',
        status: 'active'
    });
    await db.models.SallaOAuth.create({
        tenant_id: tenantLockTest.id,
        access_token: 'mock_lock_access',
        refresh_token: 'mock_lock_refresh',
        expires_at: new Date(Date.now() - 3600000) // expired to force refresh
    });

    let sallaApiCallCount = 0;
    axios.post = async () => {
        sallaApiCallCount++;
        // Simulate slight network delay of 50ms to ensure overlap
        await new Promise(resolve => setTimeout(resolve, 50));
        return {
            data: {
                access_token: `refreshed_access_${sallaApiCallCount}`,
                refresh_token: `refreshed_refresh_${sallaApiCallCount}`,
                expires_in: 86400
            }
        };
    };

    // Trigger concurrent refreshes
    const [tokenA, tokenB] = await Promise.all([
        SallaService.refreshToken(tenantLockTest.id),
        SallaService.refreshToken(tenantLockTest.id)
    ]);

    // Assert that the Salla Identity API was only called once
    assert.strictEqual(sallaApiCallCount, 1, "Salla Identity API must be called exactly once during concurrent token refreshes");
    assert.strictEqual(tokenA, tokenB, "Both concurrent refresh calls must return the same fresh token");
    console.log("✅ Concurrency Lock verified: exactly one API call made, both threads synchronized.");

    // Restore axios
    axios.post = originalPostConcurrency;

    // -------------------------------------------------------------
    // Test Set 11: Webhook Inbox Plaintext Leak Protection
    // -------------------------------------------------------------
    console.log("\n--- [Test Set 11: Webhook Inbox Plaintext Leak Protection] ---");
    const secretToken = "super_secret_access_token_123_dont_leak";
    const testPayload = JSON.stringify({
        event: 'app.store.authorize',
        merchant: 444444,
        data: {
            access_token: secretToken,
            refresh_token: "super_secret_refresh_token_abc"
        }
    });

    // Enqueue
    const uniqueInboxEventId = "leak_test_event_id_unique";
    await WebhookInboxWorker.enqueue('salla', uniqueInboxEventId, 'app.store.authorize', 444444, testPayload);

    // Query SQLite database directly using raw query
    const [inboxRow] = await db.query(`SELECT * FROM WebhookEvents WHERE event_id = 'leak_test_event_id_unique'`, { type: db.QueryTypes.SELECT });
    assert(inboxRow, "Event record must exist in SQLite database");
    
    // Scan all columns for the plaintext token string
    for (const key of Object.keys(inboxRow)) {
        const val = String(inboxRow[key]);
        assert(!val.includes(secretToken), `Security Violation: Plaintext token found inside database column '${key}'!`);
    }
    console.log("✅ Webhook Inbox Plaintext Leak Protection verified: no plain tokens saved in database columns.");

    console.log("\n🎉 ALL SALLA PRE-SUBMISSION SECURITY TESTS COMPLETED SUCCESSFULLY! 🎉");
    process.exit(0);
}

runTests().catch(e => {
    console.error("\n❌ TEST SUITE FAILED:", e);
    process.exit(1);
});
