require('dotenv').config();

module.exports = {
  development: {
    dialect: 'sqlite',
    storage: process.env.SALLA_DATABASE_STORAGE || './database/salla_saas_v4.sqlite',
    logging: false
  },
  test: {
    dialect: 'sqlite',
    storage: process.env.SALLA_DATABASE_STORAGE || ':memory:',
    logging: false
  },
  staging: {
    username: process.env.DATABASE_USERNAME || 'root',
    password: process.env.DATABASE_PASSWORD || null,
    database: process.env.DATABASE_NAME || 'salla_whatsapp_saas',
    host: process.env.DATABASE_SERVER || '127.0.0.1',
    dialect: process.env.SALLA_DATABASE_DIALECT || 'mysql',
    storage: process.env.SALLA_DATABASE_STORAGE || './database/salla_saas_v4.sqlite',
    logging: false
  },
  production: {
    username: process.env.DATABASE_USERNAME || 'root',
    password: process.env.DATABASE_PASSWORD || null,
    database: process.env.DATABASE_NAME || 'salla_whatsapp_saas',
    host: process.env.DATABASE_SERVER || '127.0.0.1',
    dialect: process.env.SALLA_DATABASE_DIALECT || 'mysql',
    logging: false
  }
};
