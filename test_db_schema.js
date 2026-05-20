require("dotenv").config();
const SallaDatabase = require("./database/db_instance");

async function testDB() {
    try {
        console.log("Testing DB Connection...");
        const connection = await SallaDatabase.connect();
        if (!connection) {
            console.error("Failed to connect.");
            return;
        }

        console.log("Connection successful.");

        console.log("Checking Plan model...");
        const Plan = connection.models.Plan;

        if (!Plan) {
            console.error("Plan model not found!");
            return;
        }

        console.log("Attempting to find or create a test plan...");
        try {
            const [plan, created] = await Plan.findOrCreate({
                where: { name: 'TestPlan' },
                defaults: {
                    price_monthly: 99.00,
                    price_yearly: 990.00,
                    msg_limit_monthly: 100,
                    features: { test: true },
                    is_active: true
                }
            });
            console.log("Plan processed:", plan.name, "Created:", created);

            // Clean up
            if (created) await plan.destroy();

        } catch (err) {
            console.error("Error during Plan operation:", err);
            if (err.parent) console.error("Parent Error:", err.parent);
            if (err.original) console.error("Original Error:", err.original);
        }

    } catch (e) {
        console.error("General Error:", e);
    }
}

testDB();
