require('dotenv').config();
// services/platforms/SallaAdapter.js
// Adapter لمنصة سلة — يلفّ Salla OAuth + API

const https = require('https');
const BaseAdapter = require('./BaseAdapter');

class SallaAdapter extends BaseAdapter {
    static get platform() { return 'salla'; }

    static get displayInfo() {
        return {
            name: 'Salla',
            name_ar: 'سلة',
            logo: '/images/platforms/salla.svg',
            color: '#0F2D2A',
            color_accent: '#9bcb3b',
            description: 'منصة المتاجر الإلكترونية الرائدة في السعودية',
            domain: 'salla.sa'
        };
    }

    static get isReady() {
        return !!(process.env.SALLA_OAUTH_CLIENT_ID && process.env.SALLA_OAUTH_CLIENT_SECRET && !process.env.SALLA_OAUTH_CLIENT_ID.startsWith('mock_'));
    }

    static getAuthorizationUrl(state, redirectUri) {
        const clientId = process.env.SALLA_OAUTH_CLIENT_ID || 'mock';
        return `https://accounts.salla.sa/oauth2/auth?response_type=code&client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=offline_access%20products.read%20orders.read%20customers.read&state=${state}`;
    }

    static async exchangeCodeForToken(code, redirectUri) {
        if (!this.isReady) return this._mockToken();

        const body = new URLSearchParams({
            grant_type: 'authorization_code',
            code,
            client_id: process.env.SALLA_OAUTH_CLIENT_ID,
            client_secret: process.env.SALLA_OAUTH_CLIENT_SECRET,
            redirect_uri: redirectUri
        }).toString();

        const tokenResp = await this._httpRequest('POST', 'accounts.salla.sa', '/oauth2/token', body, {
            'Content-Type': 'application/x-www-form-urlencoded'
        });

        // اجلب معلومات المتجر
        const storeInfo = await this.fetchStoreInfo(tokenResp.access_token);

        return {
            access_token: tokenResp.access_token,
            refresh_token: tokenResp.refresh_token,
            expires_in: tokenResp.expires_in,
            ...storeInfo
        };
    }

    static async fetchStoreInfo(accessToken) {
        if (!this.isReady || (accessToken && String(accessToken).startsWith('mock_'))) return this._mockStoreInfo();

        const maxRetries = 2;
        let lastError = null;

        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                const data = await this._httpRequest('GET', 'api.salla.dev', '/admin/v2/store/info', null, {
                    'Authorization': `Bearer ${accessToken}`
                });

                const s = data.data || {};
                return {
                    store_id: String(s.id || s.merchant?.id),
                    store_name: s.name || s.merchant?.name || 'متجر سلة',
                    store_domain: s.domain,
                    email: s.email,
                    owner_name: s.owner_name
                };
            } catch (err) {
                lastError = err;
                console.warn(`⚠️ [SallaAdapter.fetchStoreInfo] Attempt ${attempt}/${maxRetries} failed: ${err.message}`);
                if (attempt < maxRetries) {
                    await new Promise(r => setTimeout(r, attempt * 1000));
                }
            }
        }
        throw new Error(`Salla store info fetch failed after ${maxRetries} attempts: ${lastError?.message}`);
    }

    static _mockToken() {
        const storeId = `salla_mock_${Date.now()}`;
        return {
            access_token: `mock_salla_token_${storeId}`,
            refresh_token: `mock_refresh_${storeId}`,
            expires_in: 86400,
            ...this._mockStoreInfo(storeId)
        };
    }

    static _mockStoreInfo(storeId = `salla_mock_${Date.now()}`) {
        return {
            store_id: '99887766',
            store_name: 'متجر الأناقة السعودية',
            store_domain: 'elegance-sa.salla.sa',
            email: 'salla-merchant@mubhir-preview.test',
            owner_name: 'سلطان القحطاني'
        };
    }

    static _httpRequest(method, host, path, body, headers = {}) {
        return new Promise((resolve, reject) => {
            const opts = { method, hostname: host, path, headers: { 'Accept': 'application/json', ...headers } };
            if (body) opts.headers['Content-Length'] = Buffer.byteLength(body);
            const req = https.request(opts, (res) => {
                let data = '';
                res.on('data', (c) => data += c);
                res.on('end', () => {
                    try {
                        const parsed = JSON.parse(data);
                        if (res.statusCode >= 400) return reject(new Error(`Salla API ${res.statusCode}: ${parsed.message || data}`));
                        resolve(parsed);
                    } catch (e) { reject(new Error(`Salla API invalid response: ${data.slice(0, 200)}`)); }
                });
            });

            req.setTimeout(5000, () => {
                req.destroy(new Error('Salla API request timeout after 5000ms'));
            });

            req.on('error', reject);
            if (body) req.write(body);
            req.end();
        });
    }
}

module.exports = SallaAdapter;
