const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// Mock environment
process.env.NODE_ENV = 'development';
process.env.SESSION_SECRET = 'test-session-secret-must-be-very-long-32-chars-long';
process.env.SALLA_DATABASE_DIALECT = 'sqlite';
process.env.SALLA_DATABASE_STORAGE = './tests/security/test_leak_db.sqlite';
process.env.TOKENS_ENCRYPTION_KEY = crypto.randomBytes(32).toString('hex');
process.env.ALLOW_SCHEMA_SYNC = 'true';
process.env.APP_URL = 'https://localhost:8095';

const SallaDatabase = require('../../database/db_instance');

async function runLeakTests() {
    console.log("🧪 Starting Log Leak Security Test Suite...");

    const dbFile = path.resolve('./tests/security/test_leak_db.sqlite');
    if (fs.existsSync(dbFile)) {
        try { fs.unlinkSync(dbFile); } catch(e){}
    }

    await SallaDatabase.connect();
    const db = SallaDatabase.connection;
    await db.drop();
    await db.sync({ force: true });

    // Seed Plans
    await db.models.Plan.create({ id: 1, name: 'الأساسية', price: 49 });

    // Seed Tenant to satisfy Foreign Key constraint
    await db.models.Tenant.create({
        id: 1,
        platform: 'salla',
        platform_store_id: '12345',
        salla_merchant_id: 12345,
        store_name: 'Leak Test Store',
        status: 'active'
    });

    const MailService = require('../../services/MailService');

    // Intercept console.log and console.error
    let loggedData = '';
    const originalLog = console.log;
    const originalError = console.error;
    
    console.log = (...args) => {
        loggedData += args.join(' ') + '\n';
        originalLog.apply(console, args);
    };
    console.error = (...args) => {
        loggedData += args.join(' ') + '\n';
        originalError.apply(console, args);
    };

    // Prepare test inputs with highly recognizable sensitive tokens
    const rawToken = 'SECRET_TOKEN_ABCD1234_DONT_LEAK';
    const rawUrl = 'https://localhost:8095/login/bootstrap#token=SECRET_TOKEN_ABCD1234_DONT_LEAK';
    
    // Clear any potential log file contents
    const logPath = path.join(process.cwd(), 'logs/emails.log');
    const logDir = path.dirname(logPath);
    if (!fs.existsSync(logDir)) {
        fs.mkdirSync(logDir, { recursive: true });
    }
    fs.writeFileSync(logPath, '', 'utf8');

    console.log("1️⃣ Sending welcome email...");
    await MailService.sendWelcomeEmail({
        tenantId: 1,
        recipient: 'test@leak.test',
        storeName: 'Leak Test Store',
        ownerName: 'Leak Owner',
        loginUrl: rawUrl
    });

    // Restore logs
    console.log = originalLog;
    console.error = originalError;

    // Asserts
    console.log("2️⃣ Performing security assertions...");
    
    // 1. Assert console log doesn't contain raw token or magic link URL
    assert(!loggedData.includes(rawToken), "CRITICAL: Raw token leaked in application console logs!");
    assert(!loggedData.includes(rawUrl), "CRITICAL: Raw Magic Login URL leaked in application console logs!");
    console.log("✅ Verified console logs are clean of raw tokens and Magic URLs.");

    // 2. Assert logs/emails.log is completely empty of token/URL
    if (fs.existsSync(logPath)) {
        const logContent = fs.readFileSync(logPath, 'utf8');
        assert(!logContent.includes(rawToken), "CRITICAL: Raw token leaked in logs/emails.log!");
        assert(!logContent.includes(rawUrl), "CRITICAL: Raw Magic Login URL leaked in logs/emails.log!");
        console.log("✅ Verified logs/emails.log contains no raw tokens or Magic URLs.");
    } else {
        console.log("✅ Verified logs/emails.log does not even exist.");
    }

    // Clean up
    await db.close();
    if (fs.existsSync(dbFile)) {
        try { fs.unlinkSync(dbFile); } catch(e){}
    }
    console.log("🎉 ALL LOG LEAK SECURITY TESTS PASSED SUCCESSFULLY!\n");
}

runLeakTests().catch(err => {
    console.error("❌ LOG LEAK TESTS FAILED:", err);
    process.exit(1);
});
