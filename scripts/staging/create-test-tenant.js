const path = require('path');
const dotenv = require('dotenv');
const fs = require('fs');

const nodeEnv = process.env.NODE_ENV;
if (nodeEnv !== 'staging' || process.env.STAGING_SAFE_MODE !== 'true') {
  console.error("❌ Staging CLI Seeder error: This script must only run in Staging mode with STAGING_SAFE_MODE=true.");
  process.exit(1);
}

// Load env.staging
const envFile = '.env.staging';
const resolvedEnvPath = path.resolve(__dirname, '../../' + envFile);
if (fs.existsSync(resolvedEnvPath)) {
  dotenv.config({ path: resolvedEnvPath, override: false });
} else {
  console.error(`❌ Staging CLI Seeder error: Config file ${envFile} is missing!`);
  process.exit(1);
}

// Verify SALLA_DATABASE_DIALECT is sqlite
if (process.env.SALLA_DATABASE_DIALECT !== 'sqlite') {
  console.error("❌ Staging CLI Seeder error: Database dialect must be sqlite.");
  process.exit(1);
}

// Verify database storage path starts with /opt/mubhir-staging on Linux
const dbStorage = process.env.SALLA_DATABASE_STORAGE || './database/salla_saas_v4.sqlite';
const resolvedStorage = path.resolve(__dirname, '../../', dbStorage);
if (process.platform === 'linux') {
  if (!resolvedStorage.startsWith('/opt/mubhir-staging/')) {
    console.error(`❌ Staging CLI Seeder error: Database storage path (${resolvedStorage}) must be located under /opt/mubhir-staging/`);
    process.exit(1);
  }
}

// Parse arguments
let reference = 'staging-reliability-test';
const refArgIndex = process.argv.indexOf('--reference');
if (refArgIndex !== -1 && process.argv[refArgIndex + 1]) {
  reference = process.argv[refArgIndex + 1];
}

// Generate numeric merchant ID from reference string (deterministic mapping to reserved 999xxxxxx range)
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
  const { Tenant, Subscription, Plan, WhatsAppConfig } = db.models;

  // 1. Find or create Tenant
  const [tenant, tenantCreated] = await Tenant.findOrCreate({
    where: { salla_merchant_id: merchantId },
    defaults: {
      platform: 'salla',
      store_name: "STAGING_RELIABILITY_TEST",
      store_domain: "staging-reliability.salla.sa",
      email: "staging-reliability@example.invalid",
      contact_email: "staging-reliability@example.invalid",
      contact_phone: null,
      status: "active",
      settings: {
        reference: reference
      }
    }
  });

  // 2. Fetch default trial plan
  const plan = await Plan.findOne({ where: { name: 'الأساسية' } });
  if (!plan) {
    throw new Error("Default plan 'الأساسية' not found in database.");
  }

  // 3. Ensure trial/active subscription
  const [sub, subCreated] = await Subscription.findOrCreate({
    where: { tenant_id: tenant.id },
    defaults: {
      plan_id: plan.id,
      status: 'active',
      is_yearly: false,
      start_date: new Date(),
      end_date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
    }
  });

  // 4. Ensure WhatsApp Config with mock fields (sensitive fields set to null/mock)
  const [config, configCreated] = await WhatsAppConfig.findOrCreate({
    where: { tenant_id: tenant.id },
    defaults: {
      phone_number_id: null,
      waba_id: null,
      access_token: null,
      verify_token: null,
      phone_number: null,
      label: "Staging Test Number",
      is_primary: false,
      status: "active"
    }
  });

  console.log(`Tenant ID: ${tenant.id}`);
  console.log(`Reference: ${reference} (Salla Merchant ID: ${merchantId})`);
  console.log(`Plan: ${plan.name}`);
  console.log(`Result: ${tenantCreated ? 'created' : 'reused'}`);

  process.exit(0);
}

run().catch(e => {
  console.error("❌ Staging CLI Seeder failed:", e);
  process.exit(1);
});
