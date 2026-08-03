const path = require('path');
const dotenv = require('dotenv');
const fs = require('fs');

const nodeEnv = process.env.NODE_ENV;
if (nodeEnv !== 'staging' || process.env.STAGING_SAFE_MODE !== 'true') {
  console.error("❌ Staging Cleanup error: This script must only run in Staging mode with STAGING_SAFE_MODE=true.");
  process.exit(1);
}

// Load env.staging
const envFile = '.env.staging';
const resolvedEnvPath = path.resolve(__dirname, '../../' + envFile);
if (fs.existsSync(resolvedEnvPath)) {
  dotenv.config({ path: resolvedEnvPath, override: false });
} else {
  console.error(`❌ Staging Cleanup error: Config file ${envFile} is missing!`);
  process.exit(1);
}

// Verify dialect
if (process.env.SALLA_DATABASE_DIALECT !== 'sqlite') {
  console.error("❌ Staging Cleanup error: Database dialect must be sqlite.");
  process.exit(1);
}

// Verify database storage path starts with /opt/mubhir-staging on Linux
const dbStorage = process.env.SALLA_DATABASE_STORAGE || './database/salla_saas_v4.sqlite';
const resolvedStorage = path.resolve(__dirname, '../../', dbStorage);
if (process.platform === 'linux') {
  if (!resolvedStorage.startsWith('/opt/mubhir-staging/')) {
    console.error(`❌ Staging Cleanup error: Database storage path (${resolvedStorage}) must be located under /opt/mubhir-staging/`);
    process.exit(1);
  }
}

// Parse arguments
let reference = 'staging-reliability-test';
const refArgIndex = process.argv.indexOf('--reference');
if (refArgIndex !== -1 && process.argv[refArgIndex + 1]) {
  reference = process.argv[refArgIndex + 1];
}

const dryRun = process.argv.includes('--dry-run');

// Generate numeric merchant ID from reference string (deterministic mapping)
function hashMerchantId(ref) {
  let hash = 0;
  for (let i = 0; i < ref.length; i++) {
    hash = (hash * 31 + ref.charCodeAt(i)) % 100000000;
  }
  return 999000000 + Math.abs(hash);
}

const targetMerchantIds = [
  123456789, // Legacy static merchant ID
  hashMerchantId(reference)
];

// Allowed roots for session directory deletion
const SAFE_ROOTS = ['/opt/mubhir-staging/', '/ai-whatsapp-salla-reliability-staging/'];

function isPathSafe(dirPath) {
  const normalizedPath = path.resolve(dirPath);
  const realParent = fs.existsSync(dirPath) ? fs.realpathSync(dirPath) : normalizedPath;
  const normalized = realParent.replace(/\\/g, '/');
  return SAFE_ROOTS.some(root => normalized.includes(root));
}

const SallaDatabase = require('../../database/db_instance');

async function run() {
  if (dryRun) console.log('🔍 DRY-RUN MODE — no changes will be made.\n');

  await SallaDatabase.connect();
  const db = SallaDatabase.connection;
  const { Tenant, Subscription, WhatsAppConfig, Campaign, Customer, Cart, Payment, UsageCounter, MessageLog, SallaOAuth } = db.models;

  for (const merchantId of targetMerchantIds) {
    const tenant = await Tenant.findOne({ where: { salla_merchant_id: merchantId } });
    if (!tenant) {
      console.log(`Merchant ${merchantId}: no tenant found.`);
      continue;
    }

    const tenantId = tenant.id;
    console.log(`${dryRun ? '[DRY-RUN] ' : ''}Cleaning up legacy tenant: ID=${tenantId}, MerchantID=${merchantId}`);

    // Count associated records
    const subCount = await Subscription.count({ where: { tenant_id: tenantId } });
    const waCount = await WhatsAppConfig.count({ where: { tenant_id: tenantId } });
    const oauthCount = await SallaOAuth.count({ where: { tenant_id: tenantId } });

    console.log(`  - Subscriptions: ${subCount}`);
    console.log(`  - WhatsApp configs: ${waCount}`);
    console.log(`  - OAuth tokens: ${oauthCount}`);

    if (!dryRun) {
      await Subscription.destroy({ where: { tenant_id: tenantId } });
      await WhatsAppConfig.destroy({ where: { tenant_id: tenantId } });
      await SallaOAuth.destroy({ where: { tenant_id: tenantId } });
      if (Campaign) await Campaign.destroy({ where: { tenant_id: tenantId } });
      if (Customer) await Customer.destroy({ where: { tenant_id: tenantId } });
      if (Cart) await Cart.destroy({ where: { tenant_id: tenantId } });
      if (Payment) await Payment.destroy({ where: { tenant_id: tenantId } });
      if (UsageCounter) await UsageCounter.destroy({ where: { tenant_id: tenantId } });
      if (MessageLog) await MessageLog.destroy({ where: { tenant_id: tenantId } });
    }

    // Check session directory
    const sessionDir = path.resolve(__dirname, '../../data/wwebjs_auth', `session-${tenantId}`);
    if (fs.existsSync(sessionDir)) {
      console.log(`  - Session directory exists: ${sessionDir}`);
      if (isPathSafe(sessionDir)) {
        // Validate the session directory name matches the tenant
        const expectedDirName = `session-${tenantId}`;
        const actualDirName = path.basename(sessionDir);
        if (actualDirName !== expectedDirName) {
          console.warn(`  ⚠️ Directory name mismatch: expected ${expectedDirName}, got ${actualDirName}. Skipping.`);
        } else if (dryRun) {
          console.log(`  - [DRY-RUN] Would delete: ${sessionDir}`);
        } else {
          console.log(`  - Deleting session folder: ${sessionDir}`);
          fs.rmSync(sessionDir, { recursive: true, force: true });
        }
      } else {
        console.warn(`  ⚠️ Session directory path ${sessionDir} is not in safe root. Skipping filesystem deletion.`);
      }
    }

    // Delete tenant itself
    if (dryRun) {
      console.log(`  - [DRY-RUN] Would delete tenant: ${tenantId}`);
    } else {
      await tenant.destroy();
      console.log(`  - Deleted tenant: ${tenantId}`);
    }
  }

  console.log(dryRun ? "\n🔍 Dry-run completed. No changes were made." : "\n🧹 Cleanup completed.");
  process.exit(0);
}

run().catch(e => {
  console.error("❌ Cleanup failed:", e);
  process.exit(1);
});
