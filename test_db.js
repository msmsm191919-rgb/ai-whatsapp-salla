require("dotenv").config();
const { Sequelize } = require("sequelize");

async function testConnection() {
    console.log("🔍 Testing Database Connection...");

    const dbHost = process.env.DATABASE_SERVER || 'localhost';
    const dbUser = process.env.DATABASE_USERNAME || 'root';
    const dbPass = process.env.DATABASE_PASSWORD || '';
    const dbName = process.env.DATABASE_NAME || 'salla_whatsapp_saas';
    const dbDialect = process.env.SALLA_DATABASE_DIALECT || 'mysql';

    console.log(`config: { host: ${dbHost}, user: ${dbUser}, db: ${dbName}, dialect: ${dbDialect} }`);

    try {
        // 1. Raw MySQL Check
        if (dbDialect === 'mysql') {
            console.log("1️⃣ Testing Raw MySQL2 Connection...");
            const mysql = require('mysql2/promise');
            const connection = await mysql.createConnection({
                host: dbHost,
                user: dbUser,
                password: dbPass
            });
            console.log("   ✅ MySQL2 Connected!");

            await connection.query(`CREATE DATABASE IF NOT EXISTS \`${dbName}\`;`);
            console.log(`   ✅ Database verified/created: ${dbName}`);
            await connection.end();
        }

        // 2. Sequelize Check
        console.log("2️⃣ Testing Sequelize Connection...");
        const sequelize = new Sequelize(dbName, dbUser, dbPass, {
            host: dbHost,
            dialect: dbDialect,
            logging: false
        });

        await sequelize.authenticate();
        console.log('   ✅ Sequelize Authenticated!');

        await sequelize.close();
        console.log("🎉 SUCCESS: Database is reachable.");

    } catch (error) {
        console.error('❌ CONNECTION ERROR:', error);
    }
}

testConnection();
