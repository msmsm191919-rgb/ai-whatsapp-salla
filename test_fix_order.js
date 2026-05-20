const axios = require('axios');

async function sendTestWebhook() {
    console.log("🚀 Sending Simulated Salla Order Webhook (Port 8095)...");

    const payload = {
        "event": "order.created",
        "merchant": 123456789, // Demo Merchant ID
        "created_at": new Date().toISOString(),
        "data": {
            "id": "998877",
            "total": {
                "amount": 350.00,
                "currency": "SAR"
            },
            "status": {
                "name": "under_review"
            },
            "customer": {
                "first_name": "عبدالله",
                "last_name": "سعد",
                "mobile": "966555555555",
                "email": "cust@demo.com"
            }
        }
    };

    try {
        const response = await axios.post('http://localhost:8095/webhook', payload, {
            headers: { 'Content-Type': 'application/json' }
        });

        console.log("✅ Webhook Sent! Status:", response.status);
        console.log("👉 Check the Server Terminal for:");
        console.log("   1. '🔔 NEW ORDER RECEIVED!'");
        console.log("   2. '🤖 AI is thinking...'");
        console.log("   3. '✅ Message Sent...' (or Mock Mode)");

    } catch (error) {
        console.error("❌ Failed:", error.message);
    }
}

sendTestWebhook();
