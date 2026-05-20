const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.resolve(__dirname, '../database/salla_saas_v4.sqlite');
console.log(`📂 Opening database at: ${dbPath}`);

const db = new sqlite3.Database(dbPath);

db.serialize(() => {
    console.log("🔧 Fixing Database Schema...");

    // 1. Add trial_days to Plans
    db.run("ALTER TABLE Plans ADD COLUMN trial_days INTEGER DEFAULT 0;", (err) => {
        if (err) {
            if (err.message.includes("duplicate column name")) {
                console.log("✅ Column 'trial_days' already exists.");
            } else {
                console.error("❌ Error adding column:", err.message);
            }
        } else {
            console.log("✅ Added column 'trial_days' to Plans table.");
        }
    });
});

db.close((err) => {
    if (err) {
        console.error(err.message);
    }
    console.log('✅ Database connection closed.');
});
