const axios = require('axios');

async function simulateIncomingMessage() {
    console.log("📱 Simulating Incoming WhatsApp Message from Customer...");

    const phoneNumber = "966500000000";
    const userMessage = process.argv[2] || "مرحبا، كيف اقدر اتتبع طلبي؟"; // Default message or from args

    const payload = {
        "object": "whatsapp_business_account",
        "entry": [
            {
                "id": "100020003000",
                "changes": [
                    {
                        "value": {
                            "messaging_product": "whatsapp",
                            "metadata": {
                                "phone_number_id": "123456" // Must match Mock Config in DB
                            },
                            "messages": [
                                {
                                    "from": phoneNumber,
                                    "id": "wamid.HBgL...",
                                    "timestamp": "1700000000",
                                    "text": {
                                        "body": userMessage
                                    },
                                    "type": "text"
                                }
                            ]
                        },
                        "field": "messages"
                    }
                ]
            }
        ]
    };

    try {
        console.log(`💬 Customer says: "${userMessage}"`);
        await axios.post('http://localhost:8095/webhook/meta', payload);
        console.log("✅ Message sent to Webhook! Watch the server logs for AI reply.");

    } catch (error) {
        console.error("❌ Error sending simulation:", error.message);
    }
}

simulateIncomingMessage();
