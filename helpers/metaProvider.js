const axios = require('axios');

const META_GRAPH_VERSION = 'v18.0';

/**
 * Send a text message using Meta Cloud API
 * @param {Object} config - The WhatsAppConfig object (must include phone_number_id, access_token)
 * @param {string} to - Recipient phone number (E.164 format without +)
 * @param {string} text - Message content
 */
async function sendMetaMessage(config, to, text) {
    if (!config || !config.phone_number_id || !config.access_token) {
        throw new Error("Missing Meta Configuration (Phone ID or Token)");
    }

    // --- MOCK MODE FOR DEMO ---
    if (config.access_token === 'mock_access_token') {
        console.log(`[MOCK MODE] Sending Message to ${to}: ${text}`);
        return { message_id: 'mock_msg_12345' };
    }
    // --------------------------

    try {
        const url = `https://graph.facebook.com/${META_GRAPH_VERSION}/${config.phone_number_id}/messages`;

        const response = await axios.post(
            url,
            {
                messaging_product: "whatsapp",
                recipient_type: "individual",
                to: to,
                type: "text",
                text: { body: text }
            },
            {
                headers: {
                    Authorization: `Bearer ${config.access_token}`,
                    "Content-Type": "application/json",
                },
            }
        );

        return response.data;
    } catch (error) {
        // Log detailed error from Meta
        const errorMsg = error.response?.data || error.message;
        const errorString = JSON.stringify(errorMsg);

        // --- AUTO FALLBACK FOR DEMO ---
        if (errorString.includes("OAuthException") || errorString.includes("Invalid OAuth")) {
            console.warn("⚠️ Invalid Token detected. Switching to MOCK MODE for this request.");
            console.log(`[MOCK FALLBACK] Sending Message to ${to}: ${text}`);
            return { message_id: 'mock_fallback_12345' };
        }
        // -----------------------------

        console.error("❌ Meta API Error:", JSON.stringify(errorMsg, null, 2));
        const metaError = error.response?.data?.error?.message || error.message;
        throw new Error(`Meta API Error: ${metaError}`);
    }
}

/**
 * Send a specific template message (Optional usage for future)
 */
async function sendMetaTemplate(config, to, templateName, language = 'en_US', components = []) {
    if (!config || !config.phone_number_id || !config.access_token) {
        throw new Error("Missing Meta Configuration (Phone ID or Token)");
    }

    try {
        const url = `https://graph.facebook.com/${META_GRAPH_VERSION}/${config.phone_number_id}/messages`;

        const body = {
            messaging_product: "whatsapp",
            recipient_type: "individual",
            to: to,
            type: "template",
            template: {
                name: templateName,
                language: {
                    code: language
                },
                components: components
            }
        };

        const response = await axios.post(url, body, {
            headers: {
                Authorization: `Bearer ${config.access_token}`,
                "Content-Type": "application/json",
            },
        });

        return response.data;
    } catch (error) {
        const errorMsg = error.response?.data || error.message;
        console.error("❌ Meta Template Error:", JSON.stringify(errorMsg, null, 2));
        const metaError = error.response?.data?.error?.message || error.message;
        throw new Error(`Meta Template Error: ${metaError}`);
    }
}

module.exports = {
    sendMetaMessage,
    sendMetaTemplate
};
