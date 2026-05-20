const axios = require('axios');

const BASE_URL = 'http://localhost:8082';

async function runSmokeTest() {
    console.log("🚀 Starting Smoke Test...");

    // 1. Check Server Status
    try {
        await axios.get(BASE_URL);
        console.log("✅ Server is UP (HTTP 200)");
    } catch (e) {
        console.error("❌ Server is Down! Please start it with 'node app1.js'");
        process.exit(1);
    }

    // 2. Simulate Salla Abandoned Cart
    console.log("\n🧪 Testing Salla Webhook (Abandoned Cart)...");
    try {
        await axios.post(`${BASE_URL}/webhook`, {
            event: 'basket.abandoned',
            merchant: '123456789',
            data: {
                customer_mobile: '966500000000',
                customer_name: 'تجربة دخان',
                checkout_url: 'https://salla.sa/test/checkout/123'
            }
        });
        console.log("✅ Salla Webhook Sent (Check server logs for processing)");
    } catch (e) {
        console.error("❌ Salla Webhook Failed:", e.message);
    }

    // 3. Simulate Meta Incoming Message
    console.log("\n🧪 Testing Meta Webhook (Incoming Message)...");
    try {
        await axios.post(`${BASE_URL}/webhook/meta`, {
            object: 'whatsapp_business_account',
            entry: [{
                changes: [{
                    value: {
                        metadata: { phone_number_id: '100100100' },
                        messages: [{
                            from: '966500000000',
                            type: 'text',
                            text: { body: 'مرحبا، هل هذا المنتج متوفر؟' }
                        }]
                    }
                }]
            }]
        });
        console.log("✅ Meta Webhook Sent (Check server logs for AI Reply)");
    } catch (e) {
        console.error("❌ Meta Webhook Failed:", e.message);
    }

    console.log("\n✨ Smoke Test Complete.");
}

runSmokeTest();
