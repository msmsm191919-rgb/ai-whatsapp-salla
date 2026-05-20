const axios = require('axios');

async function sendTestWebhook() {
    console.log("🚀 Sending Simulated Salla Order Webhook...");

    const payload = {
        "event": "order.created",
        "merchant": "123456789", // Must match the Mock Merchant ID in our DB
        "created_at": new Date().toISOString(),
        "data": {
            "id": "10002000",
            "total": {
                "amount": 250.00,
                "currency": "SAR"
            },
            "status": {
                "name": "under_review"
            },
            "customer": {
                "first_name": "أحمد",
                "last_name": "محمد",
                "mobile": "966500000000",
                "email": "customer@demo.com"
            }
        }
    };

    try {
        const response = await axios.post('http://localhost:8090/webhook', payload, {
            headers: {
                // 'Authorization': 'Bearer ...' // Optional for local test
                'Content-Type': 'application/json'
            }
        });

        console.log("✅ Webhook Sent! Server Response:", response.data);
        console.log("👉 Check the main terminal running 'npm run dev' to see the AI processing logs.");

    } catch (error) {
        console.error("❌ Failed to send webhook:", error.message);
        if (error.code === 'ECONNREFUSED') {
            console.log("⚠️ Make sure the server is running (npm run dev) on port 8090");
        }
    }
}

sendTestWebhook();
