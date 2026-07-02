const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const dotenv = require('dotenv');

// Load environment config
const envFile = process.env.NODE_ENV === 'staging' ? '.env.staging' : '.env';
const resolvedEnvPath = path.resolve(__dirname, '../../' + envFile);
if (fs.existsSync(resolvedEnvPath)) {
    dotenv.config({ path: resolvedEnvPath, override: true });
}

// Fail closed if TOKENS_ENCRYPTION_KEY is not defined
const encryptionKey = process.env.TOKENS_ENCRYPTION_KEY;
if (!encryptionKey) {
    console.error("❌ Migration Failed: TOKENS_ENCRYPTION_KEY is missing from environment. Fail closed.");
    process.exit(1);
}

let keyBuffer;
if (encryptionKey.length === 64) {
    keyBuffer = Buffer.from(encryptionKey, 'hex');
} else {
    keyBuffer = Buffer.from(encryptionKey, 'base64');
}

if (keyBuffer.length !== 32) {
    console.error("❌ Migration Failed: TOKENS_ENCRYPTION_KEY must be exactly 32 bytes (64 hex characters or 44 base64 characters)!");
    process.exit(1);
}

const lockPath = path.resolve(__dirname, '../../data/migrate-tokens.lock');
if (fs.existsSync(lockPath)) {
    console.warn("⚠️ Migration already ran. Lock file exists at:", lockPath);
    process.exit(0);
}

const SallaDatabase = require('../../database/db_instance');

// Crypto encrypt/decrypt wrappers
function encryptToken(text, tenantId, fieldName) {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', keyBuffer, iv);
    const aad = Buffer.from(`${tenantId}:${fieldName}`, 'utf8');
    cipher.setAAD(aad);
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const tag = cipher.getAuthTag().toString('hex');
    return `v1:${iv.toString('hex')}:${tag}:${encrypted}`;
}

function decryptToken(cipherText, tenantId, fieldName) {
    const parts = cipherText.split(':');
    const [, ivHex, tagHex, encryptedHex] = parts;
    const iv = Buffer.from(ivHex, 'hex');
    const tag = Buffer.from(tagHex, 'hex');
    const decipher = crypto.createDecipheriv('aes-256-gcm', keyBuffer, iv);
    const aad = Buffer.from(`${tenantId}:${fieldName}`, 'utf8');
    decipher.setAAD(aad);
    decipher.setAuthTag(tag);
    let decrypted = decipher.update(encryptedHex, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
}

async function run() {
    console.log("🚀 Starting database token migration...");

    const dialect = process.env.SALLA_DATABASE_DIALECT || 'mysql';
    const sqlitePath = process.env.SALLA_DATABASE_STORAGE || './database/salla_saas_v4.sqlite';
    const resolvedSqlitePath = path.resolve(sqlitePath);
    const backupSqlitePath = resolvedSqlitePath + '.backup';

    // 1. Back up database if using SQLite
    if (dialect === 'sqlite') {
        if (fs.existsSync(resolvedSqlitePath)) {
            console.log(`📦 Creating SQLite database backup: ${backupSqlitePath}`);
            fs.copyFileSync(resolvedSqlitePath, backupSqlitePath);
        }
    }

    await SallaDatabase.connect();
    const db = SallaDatabase.connection;
    const transaction = await db.transaction();

    try {
        const oauthRecords = await db.models.SallaOAuth.findAll({ transaction });
        console.log(`📊 Found ${oauthRecords.length} token records to check.`);

        let migratedCount = 0;

        for (const record of oauthRecords) {
            let recordChanged = false;
            let originalAccess = record.getDataValue('access_token');
            let originalRefresh = record.getDataValue('refresh_token');

            // Encrypt access token if plain
            if (originalAccess && !originalAccess.startsWith('v1:')) {
                const encrypted = encryptToken(originalAccess, record.tenant_id, 'access_token');
                // Verification test
                const verified = decryptToken(encrypted, record.tenant_id, 'access_token');
                if (verified !== originalAccess) {
                    throw new Error(`Encryption verification check failed for access_token on tenant ${record.tenant_id}`);
                }
                record.setDataValue('access_token', encrypted);
                recordChanged = true;
            }

            // Encrypt refresh token if plain
            if (originalRefresh && !originalRefresh.startsWith('v1:')) {
                const encrypted = encryptToken(originalRefresh, record.tenant_id, 'refresh_token');
                const verified = decryptToken(encrypted, record.tenant_id, 'refresh_token');
                if (verified !== originalRefresh) {
                    throw new Error(`Encryption verification check failed for refresh_token on tenant ${record.tenant_id}`);
                }
                record.setDataValue('refresh_token', encrypted);
                recordChanged = true;
            }

            if (recordChanged) {
                await record.save({ transaction });
                migratedCount++;
                console.log(`🔒 Encrypted tokens for Tenant ID: ${record.tenant_id}`);
            }
        }

        await transaction.commit();
        console.log(`✅ Successfully migrated and encrypted ${migratedCount} plaintext token records.`);

        // Create lock file
        const dataDir = path.dirname(lockPath);
        if (!fs.existsSync(dataDir)) {
            fs.mkdirSync(dataDir, { recursive: true });
        }
        fs.writeFileSync(lockPath, JSON.stringify({ migratedAt: new Date(), count: migratedCount }), 'utf8');

        // Cleanup SQLite backup on successful commit
        if (dialect === 'sqlite' && fs.existsSync(backupSqlitePath)) {
            fs.unlinkSync(backupSqlitePath);
        }

        process.exit(0);

    } catch (e) {
        await transaction.rollback();
        console.error("❌ Token migration failed. Rollback triggered. Error:", e.message);

        // Restore backup if SQLite
        if (dialect === 'sqlite' && fs.existsSync(backupSqlitePath)) {
            console.log("🔄 Restoring database from backup...");
            fs.copyFileSync(backupSqlitePath, resolvedSqlitePath);
            fs.unlinkSync(backupSqlitePath);
        }

        process.exit(1);
    }
}

run();
