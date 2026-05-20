const { Sequelize, DataTypes } = require("sequelize");

const Tenant = require("./models/tenant");
const SallaOAuth = require("./models/sallaoauth");
const Plan = require("./models/plan");
const Subscription = require("./models/subscription");
const WhatsAppConfig = require("./models/whatsappconfig");
const MessageLog = require("./models/messagelog");
const UsageCounter = require("./models/usagecounter");
const Campaign = require("./models/campaign");
const Customer = require("./models/customer");
const Cart = require("./models/cart");
const Payment = require("./models/payment");
// const User = require("./models/user"); // Deprecated
// const OauthTokens = require("./models/oauthtokens"); // Deprecated

// We export the sequelize connection instance to be used around our app.
module.exports = {
  connect: async () => {
    // Database Configuration
    let sequelize;
    const dbHost = process.env.DATABASE_SERVER || 'localhost';
    const dbUser = process.env.DATABASE_USERNAME || 'root';
    const dbPass = process.env.DATABASE_PASSWORD || '';
    const dbName = process.env.DATABASE_NAME || 'salla_whatsapp_saas';
    const dbDialect = process.env.SALLA_DATABASE_DIALECT || 'mysql';

    if (dbDialect === 'sqlite') {
      sequelize = new Sequelize({
        dialect: 'sqlite',
        storage: './database/salla_saas_v4.sqlite',
        logging: false,
      });
    } else {
      console.log(`🔌 Connecting to MySQL (${dbName})...`);
      sequelize = new Sequelize(dbName, dbUser, dbPass, {
        host: dbHost,
        dialect: 'mysql',
        logging: false,
      });
    }

    const modelDefiners = [
      Tenant,
      SallaOAuth,
      Plan,
      Subscription,
      WhatsAppConfig,
      MessageLog,
      UsageCounter,
      Campaign,
      Customer,
      Cart,
      Payment,
    ];

    // 1. Init all models
    for (let i = 0; i < modelDefiners.length; i++) {
      // Fix: Call the function if it's a function (factory), otherwise use it
      // The original code passed (sequelize, DataTypes)
      modelDefiners[i] = modelDefiners[i](sequelize, DataTypes);
    }

    // 2. Run associations
    for (let i = 0; i < modelDefiners.length; i++) {
      if (modelDefiners[i].associate) {
        modelDefiners[i].associate(sequelize.models);
      }
    }

    // Await authentication/sync
    try {
      await sequelize.authenticate();
      // Sync is handled in database/index.js wrapper typically, but safe to do here if wrapper expects instance
      // But app.js calls .then() on SallaDatabase.connect() which calls this.Database.connect()
      // So this MUST return a Promise that resolves to the instance
      return sequelize;
    } catch (e) {
      console.error("❌ DB Auth Error:", e.message);
      throw e;
    }
  },
};
