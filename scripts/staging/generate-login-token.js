const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

const nodeEnv = process.env.NODE_ENV;
if (nodeEnv !== 'staging' && nodeEnv !== 'development') {
  console.error("❌ Staging CLI Token Generator: This script must run in Staging or Development mode.");
  process.exit(1);
}

// Load env config
const envFile = nodeEnv === 'staging' ? '.env.staging' : '.env';
const resolvedEnvPath = path.resolve(__dirname, '../../' + envFile);
if (fs.existsSync(resolvedEnvPath)) {
  dotenv.config({ path: resolvedEnvPath, override: false });
}

// Parse args
let reference = 'staging-reliability-test';
const refArgIndex = process.argv.indexOf('--reference');
if (refArgIndex !== -1 && process.argv[refArgIndex + 1]) {
  reference = process.argv[refArgIndex + 1];
}

// Deterministic Salla Merchant ID from reference
function hashMerchantId(ref) {
  let hash = 0;
  for (let i = 0; i < ref.length; i++) {
    hash = (hash * 31 + ref.charCodeAt(i)) % 100000000;
  }
  return 999000000 + Math.abs(hash);
}

const merchantId = hashMerchantId(reference);

const SallaDatabase = require('../../database/db_instance');

async function run() {
  await SallaDatabase.connect();
  const db = SallaDatabase.connection;
  const tenant = await db.models.Tenant.findOne({ where: { salla_merchant_id: merchantId } });
  if (!tenant) {
    console.error(`❌ Tenant with reference '${reference}' (Merchant ID: ${merchantId}) not found. Please seed it first.`);
    process.exit(1);
  }

  // Generate secure token
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = Date.now() + 5 * 60 * 1000; // 5 minutes expiration

  const tokenPath = nodeEnv === 'staging'
    ? '/opt/mubhir-staging/data/login_tokens.json'
    : path.resolve(__dirname, '../../tests/security/login_tokens.json');

  // Load existing tokens
  let tokens = [];
  if (fs.existsSync(tokenPath)) {
    try {
      tokens = JSON.parse(fs.readFileSync(tokenPath, 'utf8'));
    } catch (e) {
      tokens = [];
    }
  }

  // Clean up expired tokens
  tokens = tokens.filter(t => t.expiresAt > Date.now());

  // Add new token
  tokens.push({
    token,
    tenantId: tenant.id,
    merchantId: tenant.salla_merchant_id,
    storeName: tenant.store_name,
    expiresAt
  });

  // Write back
  fs.writeFileSync(tokenPath, JSON.stringify(tokens), 'utf8');
  if (nodeEnv === 'staging') {
    fs.chmodSync(tokenPath, 0600);
    // ensure mubhir-staging owner
    try {
      const { execSync } = require('child_process');
      execSync(`chown mubhir-staging:mubhir-staging ${tokenPath}`);
    } catch (_) {}
  }

  const port = process.env.PORT || 8096;
  console.log(`\n🔑 Secure Login Token Generated for Tenant: ${tenant.store_name} (ID: ${tenant.id})`);
  console.log(`🔗 Login URL: http://127.0.0.1:${port}/login/token?token=${token}`);
  console.log(`⏱️ This token is valid for 5 minutes and single-use.\n`);

  await db.close();
}

run().catch(e => {
  console.error("❌ Token generation error:", e);
  process.exit(1);
});
