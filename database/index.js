///
const { Sequelize } = require("sequelize");

class SallaDatabase {
  constructor(DATABASE_ORM) {
    if (typeof DATABASE_ORM === 'string') {
      this.Database = require("../helpers/ORMs/" + DATABASE_ORM);
      this.DATABASE_ORM = DATABASE_ORM;
    } else {
      // Assume it's the required module passed directly
      this.Database = DATABASE_ORM;
      this.DATABASE_ORM = 'Sequelize'; // Defaulting for logic checks
    }
  }

  async connect() {
    try {
      const host = (process.env.DATABASE_SERVER === 'localhost') ? '127.0.0.1' : (process.env.DATABASE_SERVER || '127.0.0.1');
      const user = process.env.DATABASE_USERNAME || 'root';
      const password = process.env.DATABASE_PASSWORD || '';
      const database = process.env.DATABASE_NAME || 'salla_whatsapp_saas';

      // 1. Auto-Create Database if not exists (Zero Config)
      // 1. Auto-Create Database (Skipped for SQLite)
      // 1. Auto-Create Database for MySQL
      // 1. Auto-Create Database (Skipped for SQLite)
      // 1. Auto-Create Database for MySQL
      if (process.env.SALLA_DATABASE_DIALECT !== 'sqlite') {
        try {
          console.log(`🔌 Checking MySQL Database (${host})...`);
          const mysql = require('mysql2/promise');
          const connection = await mysql.createConnection({
            host: host,
            user: user,
            password: password
          });
          await connection.query(`CREATE DATABASE IF NOT EXISTS \`${database}\`;`);
          await connection.end();
          console.log(`✅ Database ${database} ensured.`);
        } catch (e) {
          console.warn("⚠️ Could not auto-create DB (User might be restricted or DB exists). Warning: ", e.message);
        }
      }

      // 2. Connect via Sequelize
      this.connection = this.connection || await this.Database.connect();

      // 3. Sync Schema
      // 3. Sync Schema
      if (this.connection && this.connection.sync) {
        // Re-enabling alter to sync new columns (to_phone)
        try {
          // Revert to safer sync (alter) now that we attempted rebuild
          await this.connection.sync({ alter: true });
          console.log("✅ Database Synced Successfully.");

          // SEED PLANS (SaaS Requirement - Competitive Update)
          const plansData = [
            {
              name: 'الأساسية',
              price_monthly: 79.00,
              price_yearly: 759.00,
              msg_limit_monthly: 10000, // Boosted from 1000
              trial_days: 7, // 🎁 تجربة مجانية 7 أيام للعملاء الجدد
              features: {
                whatsapp_count: 1,
                scenarios: 'basic',
                campaigns: false,
                automation: true,
                ai_enabled: true,
                ai_advanced: false
              }
            },
            {
              name: 'النمو', // Internal name, UI shows "التاجر المحترف"
              price_monthly: 149.00,
              price_yearly: 1430.00,
              msg_limit_monthly: -1, // Unlimited
              features: {
                whatsapp_count: 3,
                scenarios: 'advanced',
                campaigns: true,
                automation: true,
                ai_enabled: true,
                ai_advanced: true,
                ai_model: 'gpt-4o',
                api_access: true          // ✅ Pro gets API access
              }
            },
            {
              name: 'الشركات',
              price_monthly: 299.00, // Reduced from 439
              price_yearly: 2850.00,
              msg_limit_monthly: -1,
              features: {
                whatsapp_count: 'multi',
                scenarios: 'advanced',
                campaigns: true,
                automation: true,
                ai_enabled: true,
                ai_custom: true,
                ai_training_docs: -1,
                team_members: 'unlimited',
                support_level: 'dedicated',
                api_access: true,
                remove_branding: true,
                priority_support: true
              }
            }
          ];

          for (const plan of plansData) {
            const [p, created] = await this.connection.models.Plan.findOrCreate({
              where: { name: plan.name },
              defaults: plan
            });

            // Force Update details to match new strategy
            if (!created) {
              await p.update({
                price_monthly: plan.price_monthly,
                price_yearly: plan.price_yearly,
                msg_limit_monthly: plan.msg_limit_monthly,
                features: plan.features
              });
            }
          }
          console.log("🌱 Plans Seeded: الأساسية, النمو, الشركات");
        } catch (e) {
          console.warn("⚠️ Sync Alter Failed (might be locked), trying normal sync...");
          await this.connection.sync();
        }
      }

      return this.connection;
    } catch (err) {
      console.error("❌ Database Connection Failed:");
      console.error(err); // Log full error object
      return null;
    }
  }

  // ---------------------------------------------------------------- //
  //  SaaS Methods: Tenant & OAuth Management
  // ---------------------------------------------------------------- //

  async getTenantBySallaID(sallaMerchantId) {
    if (this.DATABASE_ORM === "Sequelize") {
      return await this.connection.models.Tenant.findOne({
        where: { salla_merchant_id: sallaMerchantId },
        include: [
          'SallaOAuth',
          {
            model: this.connection.models.Subscription,
            as: 'Subscription',
            include: ['Plan']
          }
        ]
      });
    }
    return null;
  }

  async createOrUpdateTenant(merchantData) {
    // merchantData comes from Salla User user info
    // Expected: { id (salla_id), name, email, domain, ... }

    if (this.DATABASE_ORM === "Sequelize") {
      const [tenant, created] = await this.connection.models.Tenant.findOrCreate({
        where: { salla_merchant_id: merchantData.id },
        defaults: {
          store_name: merchantData.name,
          store_domain: merchantData.domain || '',
          email: merchantData.email,
          settings: {}
        }
      });

      if (!created) {
        // Update info if changed
        tenant.store_name = merchantData.name;
        tenant.email = merchantData.email;
        await tenant.save();
      }

      return tenant;
    }
  }

  async saveSallaOAuth(tenantId, tokenData) {
    if (this.DATABASE_ORM === "Sequelize") {
      // Check if token exists for this tenant
      const existingToken = await this.connection.models.SallaOAuth.findOne({
        where: { tenant_id: tenantId }
      });

      if (existingToken) {
        return await existingToken.update({
          access_token: tokenData.access_token,
          refresh_token: tokenData.refresh_token,
          expires_in: tokenData.expires_in
        });
      } else {
        return await this.connection.models.SallaOAuth.create({
          tenant_id: tenantId,
          access_token: tokenData.access_token,
          refresh_token: tokenData.refresh_token,
          expires_in: tokenData.expires_in
        });
      }
    }
  }

  async ensureTrialSubscription(tenantId) {
    if (this.DATABASE_ORM === "Sequelize") {
      const { Subscription, Plan } = this.connection.models;

      // 1. Check if subscription exists
      const existingSub = await Subscription.findOne({ where: { tenant_id: tenantId } });
      if (existingSub) return existingSub;

      // 2. Get Default Plan (Assuming 'الأساسية' is the trial plan)
      const defaultPlan = await Plan.findOne({ where: { name: 'الأساسية' } });
      if (!defaultPlan) {
        console.error("❌ Default plan 'الأساسية' not found for trial creation.");
        return null;
      }

      // 3. Create Trial Subscription
      const startDate = new Date();
      const trialDays = defaultPlan.trial_days || 7; // Fallback
      const endDate = new Date();
      endDate.setDate(startDate.getDate() + trialDays);

      console.log(`🎁 Creating Free Trial (${trialDays} days) for Tenant ${tenantId}...`);

      return await Subscription.create({
        tenant_id: tenantId,
        plan_id: defaultPlan.id,
        status: 'trial',
        start_date: startDate,
        end_date: endDate
      });
    }
  }
}

module.exports = SallaDatabase;
