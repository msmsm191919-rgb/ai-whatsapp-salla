const path = require('path');
const dotenv = require('dotenv');
dotenv.config({ path: path.join(__dirname, '../.env.staging') });

const SallaDatabase = require('../database/db_instance');
const ConnectService = require('../services/ConnectService');

async function seedFixtures() {
  console.log('Seeding Realistic Local Preview Fixtures...');
  const db = await SallaDatabase.connect();
  if (!db || !db.models) {
    console.error('Failed to connect to database for seeding');
    process.exit(1);
  }

  const { Tenant, Subscription, Plan, Customer, Campaign, MessageLog, Cart, Payment, WhatsAppConfig } = db.models;

  // 1. Ensure Plans exist
  const basicPlan = await Plan.findOne({ where: { name: 'الأساسية' } });
  const growthPlan = await Plan.findOne({ where: { name: 'النمو' } });

  // 2. Fixture A: Canonical Salla Merchant
  const [sallaTenant, sallaCreated] = await Tenant.findOrCreate({
    where: { salla_merchant_id: 99887766 },
    defaults: {
      salla_merchant_id: 99887766,
      platform_store_id: 'salla_99887766',
      store_name: 'متجر الأناقة السعودية',
      email: 'salla-merchant@mubhir-preview.test',
      phone: '966551122334',
      store_domain: 'elegance-sa.salla.sa',
      is_active: true
    }
  });

  // Ensure Salla Subscription
  await Subscription.findOrCreate({
    where: { tenant_id: sallaTenant.id },
    defaults: {
      tenant_id: sallaTenant.id,
      plan_id: growthPlan ? growthPlan.id : 2,
      status: 'active',
      start_date: new Date(),
      end_date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
    }
  });

  // Salla WhatsApp Config
  await WhatsAppConfig.findOrCreate({
    where: { tenant_id: sallaTenant.id },
    defaults: {
      tenant_id: sallaTenant.id,
      status: 'active',
      phone_number: '966551122334',
      phone_number_id: 'wa_salla_99887766',
      waba_id: 'waba_mock_salla',
      access_token: 'mock_salla_token'
    }
  });

  // Salla Customers
  const sallaCustCount = await Customer.count({ where: { tenant_id: sallaTenant.id } });
  if (sallaCustCount === 0) {
    await Customer.bulkCreate([
      { tenant_id: sallaTenant.id, name: 'سلطان القحطاني', phone: '966501112233', email: 'sultan@example.com', total_orders: 8, total_spent: 2450.00, last_order_at: new Date() },
      { tenant_id: sallaTenant.id, name: 'نورة العتيبي', phone: '966502223344', email: 'noura@example.com', total_orders: 4, total_spent: 1200.50, last_order_at: new Date(Date.now() - 86400000) },
      { tenant_id: sallaTenant.id, name: 'فيصل الشمري', phone: '966503334455', email: 'faisal@example.com', total_orders: 1, total_spent: 350.00, last_order_at: new Date(Date.now() - 172800000) }
    ]);
  }

  // Salla Campaigns
  const sallaCampCount = await Campaign.count({ where: { tenant_id: sallaTenant.id } });
  if (sallaCampCount === 0) {
    await Campaign.bulkCreate([
      { tenant_id: sallaTenant.id, name: 'تخفيضات العيد الكبرى', status: 'completed', target_group: 'العملاء المميزين', stats_total: 250, stats_sent: 250, created_at: new Date(Date.now() - 86400000 * 3) },
      { tenant_id: sallaTenant.id, name: 'عرض نهاية الأسبوع', status: 'completed', target_group: 'الكل', stats_total: 180, stats_sent: 178, created_at: new Date(Date.now() - 86400000) }
    ]);
  }

  // Salla Message Logs
  const sallaLogCount = await MessageLog.count({ where: { tenant_id: sallaTenant.id } });
  if (sallaLogCount === 0) {
    await MessageLog.bulkCreate([
      { tenant_id: sallaTenant.id, to_phone: '966501112233', direction: 'out', content: 'مرحباً سلطان! تم شحن طلبك رقم #1042 بنجاح 🚚', status: 'delivered', created_at: new Date() },
      { tenant_id: sallaTenant.id, to_phone: '966502223344', direction: 'out', content: 'أهلاً نورة، لاحظنا أنك تركت سلة التسوق. كود خصم 10%: ELEGANCE10 🎁', status: 'delivered', created_at: new Date(Date.now() - 3600000) }
    ]);
  }

  // 3. Fixture B: Standalone Merchant
  const [standaloneTenant, standaloneCreated] = await Tenant.findOrCreate({
    where: { email: 'standalone@mubhir-preview.test' },
    defaults: {
      platform_store_id: 'standalone_preview_merchant_01',
      store_name: 'متجر المذاق الرفيع',
      email: 'standalone@mubhir-preview.test',
      phone: '966509988776',
      password_hash: ConnectService.hashPassword('StandaloneReview2026!'),
      store_domain: 'almathaq.com',
      is_active: true
    }
  });

  // Ensure Standalone Subscription
  await Subscription.findOrCreate({
    where: { tenant_id: standaloneTenant.id },
    defaults: {
      tenant_id: standaloneTenant.id,
      plan_id: basicPlan ? basicPlan.id : 1,
      status: 'active',
      start_date: new Date(),
      end_date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
    }
  });

  // Standalone Customers
  const standCustCount = await Customer.count({ where: { tenant_id: standaloneTenant.id } });
  if (standCustCount === 0) {
    await Customer.bulkCreate([
      { tenant_id: standaloneTenant.id, name: 'خالد المطيري', phone: '966509990001', email: 'khaled@example.com', total_orders: 3, total_spent: 890.00, last_order_at: new Date() },
      { tenant_id: standaloneTenant.id, name: 'ريم الدوسري', phone: '966509990002', email: 'reem@example.com', total_orders: 6, total_spent: 1950.00, last_order_at: new Date(Date.now() - 86400000) }
    ]);
  }

  // Standalone Campaigns
  const standCampCount = await Campaign.count({ where: { tenant_id: standaloneTenant.id } });
  if (standCampCount === 0) {
    await Campaign.create({
      tenant_id: standaloneTenant.id,
      name: 'عرض تذوق القهوة المختصة',
      status: 'completed',
      target_group: 'الكل',
      stats_total: 95,
      stats_sent: 95,
      created_at: new Date()
    });
  }

  // Standalone Payments
  const standPayCount = await Payment.count({ where: { tenant_id: standaloneTenant.id } });
  if (standPayCount === 0) {
    await Payment.create({
      tenant_id: standaloneTenant.id,
      plan_id: basicPlan ? basicPlan.id : 1,
      amount: 49.00,
      currency: 'SAR',
      status: 'paid',
      payment_method: 'credit_card',
      created_at: new Date(Date.now() - 86400000 * 5)
    });
  }

  console.log('✅ Fixtures Seeded Successfully:');
  console.log(`- Salla Tenant ID: ${sallaTenant.id} (${sallaTenant.store_name})`);
  console.log(`- Standalone Tenant ID: ${standaloneTenant.id} (${standaloneTenant.store_name})`);
}

seedFixtures().then(() => process.exit(0)).catch(e => { console.error('Seed Error:', e); process.exit(1); });
