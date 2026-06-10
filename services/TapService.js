// services/TapService.js
// خدمة الاتصال مع Tap Payments API
// https://www.tap.company/docs/api/

const https = require('https');

const TAP_API_BASE = 'https://api.tap.company/v2';

class TapService {

    constructor() {
        this.secretKey = process.env.TAP_SECRET_KEY || '';
        this.publicKey = process.env.TAP_PUBLIC_KEY || '';
        this.webhookSecret = process.env.TAP_WEBHOOK_SECRET || '';
        // إذا ما فيه مفتاح، نشتغل في وضع Mock للتطوير (يُعطّل في الإنتاج لأسباب أمنية)
        const isProduction = process.env.NODE_ENV === 'production';
        this.isMockMode = (!this.secretKey || this.secretKey.startsWith('mock')) && !isProduction;
    }

    /**
     * إنشاء Charge على Tap (أو Mock إذا ما فيه مفتاح)
     * @returns {Promise<{id, status, url, mock?}>}
     */
    async createCharge({ amount, currency = 'SAR', customer, description, metadata, redirectUrl, postUrl }) {
        if (this.isMockMode) {
            return this._mockCharge({ amount, currency, customer, description, metadata, redirectUrl });
        }

        const body = JSON.stringify({
            amount: Number(amount),
            currency,
            threeDSecure: true,
            save_card: false,
            description: description || 'اشتراك مبهر AI',
            statement_descriptor: 'Mobhir AI',
            metadata: metadata || {},
            reference: { transaction: `sub_${Date.now()}`, order: `ord_${Date.now()}` },
            receipt: { email: true, sms: false },
            customer: {
                first_name: customer.name || 'Customer',
                email: customer.email || 'no-reply@mobhir.local',
                phone: customer.phone ? { country_code: '966', number: String(customer.phone).replace(/^\+?966/, '') } : undefined
            },
            source: { id: 'src_all' }, // يعرض كل وسائل الدفع (مدى/Apple Pay/Visa/Mastercard)
            redirect: { url: redirectUrl },
            post: { url: postUrl }
        });

        return this._httpRequest('POST', '/charges', body);
    }

    /**
     * جلب تفاصيل Charge من Tap (لتحقق مزدوج بعد الـ webhook)
     */
    async retrieveCharge(chargeId) {
        if (this.isMockMode) return { id: chargeId, status: 'CAPTURED', mock: true };
        return this._httpRequest('GET', `/charges/${chargeId}`);
    }

    /**
     * التحقق من توقيع الـ Webhook (hash اختياري من Tap)
     */
    verifyWebhookSignature(body, signature) {
        const isProduction = process.env.NODE_ENV === 'production';
        if (this.isMockMode && !isProduction) return true;
        if (!this.webhookSecret) {
            console.warn('⚠️ TAP_WEBHOOK_SECRET not set — webhook signature not verified');
            return !isProduction; // ارفض في الإنتاج إذا كان المفتاح مفقوداً حماية للبوابات
        }
        const crypto = require('crypto');
        const computed = crypto.createHmac('sha256', this.webhookSecret).update(body).digest('hex');
        return computed === signature;
    }

    // ─────────────────────────────────────────
    // 🧪 Mock Mode (بدون Tap حقيقي)
    // ─────────────────────────────────────────
    _mockCharge({ amount, currency, customer, description, metadata, redirectUrl }) {
        const chargeId = `chg_mock_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        // الـ URL يرجّع المستخدم مباشرة لـ success page (محاكاة "دفع ناجح")
        const mockUrl = `${redirectUrl}?tap_id=${chargeId}&status=CAPTURED&mock=1`;
        return {
            id: chargeId,
            status: 'INITIATED',
            amount, currency, customer, description, metadata,
            transaction: { url: mockUrl },
            mock: true
        };
    }

    // ─────────────────────────────────────────
    // 🌐 HTTP Helper
    // ─────────────────────────────────────────
    _httpRequest(method, path, body) {
        return new Promise((resolve, reject) => {
            const url = new URL(TAP_API_BASE + path);
            const opts = {
                method,
                hostname: url.hostname,
                path: url.pathname + url.search,
                headers: {
                    'Authorization': `Bearer ${this.secretKey}`,
                    'Content-Type': 'application/json',
                    'Accept': 'application/json'
                }
            };
            if (body) opts.headers['Content-Length'] = Buffer.byteLength(body);

            const req = https.request(opts, (res) => {
                let data = '';
                res.on('data', (c) => data += c);
                res.on('end', () => {
                    try {
                        const parsed = JSON.parse(data);
                        if (res.statusCode >= 400) {
                            return reject(new Error(`Tap API ${res.statusCode}: ${parsed.errors?.[0]?.description || data}`));
                        }
                        resolve(parsed);
                    } catch (e) {
                        reject(new Error(`Tap API invalid response: ${data.slice(0, 200)}`));
                    }
                });
            });
            req.on('error', reject);
            if (body) req.write(body);
            req.end();
        });
    }
}

module.exports = new TapService();
