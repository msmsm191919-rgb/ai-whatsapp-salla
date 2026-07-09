const { execSync } = require('child_process');
const assert = require('assert');
const path = require('path');
const fs = require('fs');
const { Sequelize } = require('sequelize');

async function runMigrationTests() {
    console.log("🧪 Starting DB Migration Test Suite...");

    const dbPath = path.resolve(__dirname, '../../database/test_migration.sqlite');
    if (fs.existsSync(dbPath)) {
        try { fs.unlinkSync(dbPath); } catch(e){}
    }

    // Set test database env storage
    process.env.SALLA_DATABASE_DIALECT = 'sqlite';
    process.env.SALLA_DATABASE_STORAGE = dbPath;
    process.env.NODE_ENV = 'test';

    console.log("1️⃣ Running migrations up...");
    execSync('npx sequelize-cli db:migrate', {
        env: {
            ...process.env,
            NODE_ENV: 'test',
            SALLA_DATABASE_STORAGE: dbPath
        },
        stdio: 'inherit'
    });
    console.log("✅ Migrations completed successfully.");

    // Connect to check if tables exist
    const SallaDatabase = require('../../database/db_instance');
    // Ensure ALLOW_SCHEMA_SYNC is false
    process.env.ALLOW_SCHEMA_SYNC = 'false'; 
    await SallaDatabase.connect();
    const db = SallaDatabase.connection;

    const models = db.models;
    assert(models.TenantLoginToken, "TenantLoginToken model must exist");
    assert(models.EmailOutbox, "EmailOutbox model must exist");

    // Check tables exist in db
    const [tokensTable] = await db.query("SELECT name FROM sqlite_master WHERE type='table' AND name='TenantLoginTokens'");
    const [outboxTable] = await db.query("SELECT name FROM sqlite_master WHERE type='table' AND name='EmailOutbox'");
    assert.strictEqual(tokensTable.length, 1, "TenantLoginTokens table must exist in DB");
    assert.strictEqual(outboxTable.length, 1, "EmailOutbox table must exist in DB");
    console.log("✅ Verified TenantLoginTokens and EmailOutbox tables exist in DB.");

    await db.close();

    console.log("2️⃣ Testing Migration undo (Rollback twice)...");
    execSync('npx sequelize-cli db:migrate:undo', {
        env: { ...process.env, NODE_ENV: 'test', SALLA_DATABASE_STORAGE: dbPath },
        stdio: 'inherit'
    });
    console.log("✅ Undone last migration (EmailOutbox).");

    execSync('npx sequelize-cli db:migrate:undo', {
        env: { ...process.env, NODE_ENV: 'test', SALLA_DATABASE_STORAGE: dbPath },
        stdio: 'inherit'
    });
    console.log("✅ Undone second to last migration (TenantLoginTokens).");

    // Connect using a raw Sequelize connection to inspect DB without running SallaDatabase wrapper's auto-sync
    const db2 = new Sequelize({
        dialect: 'sqlite',
        storage: dbPath,
        logging: false
    });

    const [tokensTableAfter] = await db2.query("SELECT name FROM sqlite_master WHERE type='table' AND name='TenantLoginTokens'");
    const [outboxTableAfter] = await db2.query("SELECT name FROM sqlite_master WHERE type='table' AND name='EmailOutbox'");
    assert.strictEqual(tokensTableAfter.length, 0, "TenantLoginTokens table must be dropped");
    assert.strictEqual(outboxTableAfter.length, 0, "EmailOutbox table must be dropped");
    console.log("✅ Verified tables were dropped successfully during rollback.");

    await db2.close();

    // Clean up
    if (fs.existsSync(dbPath)) {
        try { fs.unlinkSync(dbPath); } catch(e){}
    }
    console.log("🎉 ALL MIGRATION TESTS PASSED SUCCESSFULLY!\n");
}

runMigrationTests().catch(err => {
    console.error("❌ MIGRATION TESTS FAILED:", err);
    process.exit(1);
});
