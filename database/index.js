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

      // 1. Auto-Create Database if not exists
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
      if (this.connection && this.connection.sync) {
        const env = process.env.NODE_ENV || 'development';
        const allowSync = process.env.ALLOW_SCHEMA_SYNC === 'true';

        let syncSuccess = false;
        if (env === 'production' || env === 'staging') {
          if (allowSync) {
            console.error('❌ FATAL: ALLOW_SCHEMA_SYNC=true is strictly forbidden in production/staging.');
            process.exit(1);
          }
          console.log('📋 Production/Staging: Skipping schema sync. Database must be initialized via migrations.');
          syncSuccess = true;
        } else {
          try {
            if (allowSync) {
              await this.connection.sync({ alter: true });
              console.log("✅ Database Synced Successfully (alter) — Dev/Test mode.");
            } else {
              await this.connection.sync();
              console.log("✅ Database Synced Successfully (safe) — Dev mode.");
            }
            syncSuccess = true;
          } catch (e) {
            console.warn("⚠️ Sync Failed, trying fallback normal sync...", e.message);
            try {
              await this.connection.sync();
              syncSuccess = true;
            } catch (fallbackErr) {
              console.error("❌ Fallback Sync failed:", fallbackErr.message);
            }
          }
        }

        if (syncSuccess) {
          // SEED PLANS (SaaS Requirement - Competitive Update)
          const { PLANS } = require('../services/planGate');
          const plansData = Object.entries(PLANS).map(([name, cfg]) => ({
            name,
            price_monthly: cfg.price_monthly,
            price_yearly: cfg.price_yearly,
            msg_limit_monthly: cfg.limits.messages_monthly,
            trial_days: cfg.trial_days,
            features: {
              ...cfg.features,
              limits: cfg.limits,
              scenarios: cfg.scenarios
            }
          }));

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
                trial_days: plan.trial_days,
                features: plan.features
              });
            }
          }
          console.log("🌱 Plans Seeded: الأساسية, النمو, الشركات");

          // الهجرة (Migration): تحديث المستخدمين المستقلين الحاليين الذين يملكون salla_merchant_id فارغاً
          try {
            const nonSallaTenants = await this.connection.models.Tenant.findAll({
              where: {
                platform: 'standalone',
                salla_merchant_id: null
              }
            });
            for (const t of nonSallaTenants) {
              const randomId = Math.floor(100000000 + Math.random() * 900000000);
              await t.update({ salla_merchant_id: randomId });
              console.log(`🔧 [MIGRATION] Set unique salla_merchant_id=${randomId} for standalone tenant: ${t.store_name}`);
            }
          } catch (migrationErr) {
            console.error("⚠️ Migration Failed:", migrationErr.message);
          }
        }
      }

      return this.connection;
    } catch (err) {
      console.error("❌ Database Connection Failed:");
      console.error(err);
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
        tenant.store_name = merchantData.name;
        tenant.email = merchantData.email;
        await tenant.save();
      }

      return tenant;
    }
  }

  async saveSallaOAuth(tenantId, tokenData) {
    if (this.DATABASE_ORM === "Sequelize") {
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

      const existingSub = await Subscription.findOne({ where: { tenant_id: tenantId } });
      if (existingSub) return existingSub;

      const defaultPlan = await Plan.findOne({ where: { name: 'الأساسية' } });
      if (!defaultPlan) {
        console.error("❌ Default plan 'الأساسية' not found for trial creation.");
        return null;
      }

      const startDate = new Date();
      const trialDays = defaultPlan.trial_days || 7;
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
