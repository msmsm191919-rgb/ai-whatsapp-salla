/**
 * Salla App Function Source Code: MubhirWhatsAppSend
 * Action: communication.whatsapp.send
 * Runtime Environment: Salla App Functions (V8 Isolate)
 *
 * Security: Uses per-merchant derived credential (mubhir_communication_secret) stored securely
 * in Store App Settings, and Web Crypto API HMAC-SHA256 signature for server authentication.
 */

export default async function (context: any) {
    try {
        const payload = context.payload || {};
        const settings = context.settings || {};

        const merchantSecret = settings.mubhir_communication_secret;
        if (!merchantSecret || typeof merchantSecret !== 'string') {
            return Resp.error("Mubhir WhatsApp secret key is missing in Salla App Settings", 401);
        }

        const merchantId = payload.merchant || payload.data?.merchant;
        if (!merchantId) {
            return Resp.error("Salla merchant identity is missing in event payload", 400);
        }

        const rawBodyString = JSON.stringify(payload);

        // Web Crypto HMAC-SHA256 Signature Generation
        const encoder = new TextEncoder();
        const keyData = encoder.encode(merchantSecret);
        const bodyData = encoder.encode(rawBodyString);

        const cryptoKey = await crypto.subtle.importKey(
            "raw",
            keyData,
            { name: "HMAC", hash: "SHA-256" },
            false,
            ["sign"]
        );

        const signatureBuffer = await crypto.subtle.sign("HMAC", cryptoKey, bodyData);
        const signatureArray = Array.from(new Uint8Array(signatureBuffer));
        const signatureHex = signatureArray.map(b => b.toString(16).padStart(2, "0")).join("");

        const mubhirEndpoint = "https://mubhirbot.com/api/v1/communication/whatsapp/send";

        const response = await fetch(mubhirEndpoint, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "X-Mubhir-Signature": signatureHex,
                "X-Salla-Event-ID": payload.event_id || `evt_${Date.now()}`
            },
            body: rawBodyString
        });

        const resultText = await response.text();
        let resultJson: any = {};
        try {
            resultJson = JSON.parse(resultText);
        } catch (e) {
            return Resp.error("Invalid JSON response received from Mubhir communication server", 502);
        }

        if (response.status >= 200 && response.status < 300 && resultJson.ok) {
            return Resp.success(resultJson, "WhatsApp message accepted for delivery by Mubhir");
        } else {
            const errorMsg = resultJson.error || resultJson.message || "Failed to deliver WhatsApp message via Mubhir";
            return Resp.error(errorMsg, response.status || 500);
        }
    } catch (err: any) {
        return Resp.error(`MubhirWhatsAppSend execution error: ${err.message || err}`, 500);
    }
}
