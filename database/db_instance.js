const SallaDatabase = require('./index');
const path = require('path');

// Manually resolving the Sequelize ORM path to be 100% sure
const ormPath = path.join(__dirname, '../helpers/ORMs/Sequelize');
const SequelizeORM = require(ormPath);

// Create the Singleton
const dbInstance = new SallaDatabase(SequelizeORM);

module.exports = dbInstance;
