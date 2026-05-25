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
 * Upload an image to Meta and get a reusable media_id.
 * @param {Object} config - WhatsAppConfig (phone_number_id, access_token)
 * @param {string} dataUrl - base64 data URL: "data:image/png;base64,...."
 * @returns {Promise<string>} media_id
 */
async function uploadMetaMedia(config, dataUrl) {
    if (!config || !config.phone_number_id || !config.access_token) {
        throw new Error("Missing Meta Configuration (Phone ID or Token)");
    }

    // --- MOCK MODE ---
    if (config.access_token === 'mock_access_token') {
        console.log(`[MOCK MODE] Uploading media (returning mock id)`);
        return 'mock_media_id';
    }

    const match = /^data:(.+);base64,(.+)$/.exec(dataUrl || '');
    if (!match) throw new Error("Invalid image data (expected base64 data URL)");
    const mime = match[1];                          // e.g. image/png
    const buffer = Buffer.from(match[2], 'base64');
    const ext = (mime.split('/')[1] || 'jpg').replace('jpeg', 'jpg');

    const url = `https://graph.facebook.com/${META_GRAPH_VERSION}/${config.phone_number_id}/media`;
    const form = new FormData();
    form.append('messaging_product', 'whatsapp');
    form.append('type', mime);
    form.append('file', new Blob([buffer], { type: mime }), `campaign.${ext}`);

    const res = await fetch(url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${config.access_token}` },
        body: form
    });
    const data = await res.json();
    if (!res.ok || !data.id) {
        throw new Error(`Meta Media Upload failed: ${JSON.stringify(data)}`);
    }
    return data.id;
}

/**
 * Send an image message (by media_id) with optional caption.
 * @param {Object} config - WhatsAppConfig
 * @param {string} to - recipient (E.164 without +)
 * @param {string} mediaId - media_id from uploadMetaMedia
 * @param {string} [caption] - optional text caption
 */
async function sendMetaImage(config, to, mediaId, caption = '') {
    if (!config || !config.phone_number_id || !config.access_token) {
        throw new Error("Missing Meta Configuration (Phone ID or Token)");
    }

    // --- MOCK MODE ---
    if (config.access_token === 'mock_access_token' || mediaId === 'mock_media_id') {
        console.log(`[MOCK MODE] Sending IMAGE to ${to} (caption: ${caption?.slice(0, 30)}...)`);
        return { message_id: 'mock_img_12345' };
    }

    try {
        const url = `https://graph.facebook.com/${META_GRAPH_VERSION}/${config.phone_number_id}/messages`;
        const response = await axios.post(
            url,
            {
                messaging_product: "whatsapp",
                recipient_type: "individual",
                to: to,
                type: "image",
                image: caption ? { id: mediaId, caption } : { id: mediaId }
            },
            { headers: { Authorization: `Bearer ${config.access_token}`, "Content-Type": "application/json" } }
        );
        return response.data;
    } catch (error) {
        const errorMsg = error.response?.data || error.message;
        console.error("❌ Meta Image Error:", JSON.stringify(errorMsg, null, 2));
        const metaError = error.response?.data?.error?.message || error.message;
        throw new Error(`Meta Image Error: ${metaError}`);
    }
}

/**
 * Send a specific template message (Optional usage for future)
 */
async function sendMetaTemplate(config, to, templateName, language = 'en_US', components = []) {
    if (!config || !config.phone_number_id || !config.access_token) {
        throw new Error("Missing Meta Configuration (Phone ID or Token)");
    }

    // --- MOCK MODE FOR DEMO ---
    if (config.access_token === 'mock_access_token') {
        console.log(`[MOCK MODE] Sending TEMPLATE "${templateName}" (${language}) to ${to}`);
        return { message_id: 'mock_tmpl_12345' };
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

/**
 * جلب القوالب المعتمدة (APPROVED) من Meta — للحملات الإعلانية عبر API
 * @returns {Promise<Array<{name,language,status,body}>>}
 */
async function fetchMetaTemplates(config) {
    if (!config || !config.waba_id || !config.access_token) return [];
    // --- MOCK MODE: قوالب تجريبية للعرض ---
    if (config.access_token === 'mock_access_token') {
        return [
            { name: 'special_offer', language: 'ar', status: 'APPROVED', body: 'عرض خاص لك {{1}}! 🎁 خصم حصري باستخدام الكود MOBHIR. لا تفوّت الفرصة!' },
            { name: 'order_update', language: 'ar', status: 'APPROVED', body: 'مرحباً {{1}}، لدينا تحديث بخصوص طلبك. تواصل معنا لمزيد من التفاصيل.' }
        ];
    }
    try {
        const url = `https://graph.facebook.com/${META_GRAPH_VERSION}/${config.waba_id}/message_templates?limit=100&access_token=${config.access_token}`;
        const res = await fetch(url);
        const data = await res.json();
        if (!Array.isArray(data.data)) return [];
        return data.data
            .filter(t => t.status === 'APPROVED')
            .map(t => {
                const body = (t.components || []).find(c => c.type === 'BODY');
                return { name: t.name, language: t.language, status: t.status, body: body?.text || '' };
            });
    } catch (e) {
        console.error('[Meta] fetchTemplates error:', e.message);
        return [];
    }
}

module.exports = {
    sendMetaMessage,
    sendMetaTemplate,
    uploadMetaMedia,
    sendMetaImage,
    fetchMetaTemplates
};
