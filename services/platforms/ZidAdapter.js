// services/platforms/ZidAdapter.js
// Adapter لمنصة زد (Zid.sa)
// docs: https://docs.zid.sa

const https = require('https');
const BaseAdapter = require('./BaseAdapter');

class ZidAdapter extends BaseAdapter {
    static get platform() { return 'zid'; }

    static get displayInfo() {
        return {
            name: 'Zid',
            name_ar: 'زد',
            logo: '/images/platforms/zid.svg',
            color: '#7C3AED',
            color_accent: '#8B5CF6',
            description: 'منصة سعودية متخصصة في التجارة الإلكترونية',
            domain: 'zid.sa'
        };
    }

    static get isReady() {
        return !!(process.env.ZID_CLIENT_ID && process.env.ZID_CLIENT_SECRET);
    }

    static getAuthorizationUrl(state, redirectUri) {
        const clientId = process.env.ZID_CLIENT_ID || 'mock';
        return `https://oauth.zid.sa/oauth/authorize?response_type=code&client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=read_orders+read_products+read_customers&state=${state}`;
    }

    static async exchangeCodeForToken(code, redirectUri) {
        if (!this.isReady) return this._mockToken();

        const body = JSON.stringify({
            grant_type: 'authorization_code',
            code,
            client_id: process.env.ZID_CLIENT_ID,
            client_secret: process.env.ZID_CLIENT_SECRET,
            redirect_uri: redirectUri
        });

        const tokenResp = await this._httpRequest('POST', 'oauth.zid.sa', '/oauth/token', body, {
            'Content-Type': 'application/json'
        });

        const storeInfo = await this.fetchStoreInfo(tokenResp.access_token, tokenResp.authorization);

        return {
            access_token: tokenResp.access_token,
            refresh_token: tokenResp.refresh_token,
            authorization: tokenResp.authorization, // Zid يستخدم X-Manager-Token أيضاً
            expires_in: tokenResp.expires_in,
            ...storeInfo
        };
    }

    static async fetchStoreInfo(accessToken, authorization) {
        if (!this.isReady) return this._mockStoreInfo();

        const data = await this._httpRequest('GET', 'api.zid.sa', '/v1/managers/account/profile', null, {
            'Authorization': `Bearer ${accessToken}`,
            'X-Manager-Token': authorization || accessToken
        });

        const s = data.user || data;
        return {
            store_id: String(s.store?.id || s.id),
            store_name: s.store?.name || s.name || 'متجر زد',
            store_domain: s.store?.subdomain ? `${s.store.subdomain}.zid.store` : undefined,
            email: s.email,
            owner_name: s.name
        };
    }

    static _mockToken() {
        const storeId = `zid_mock_${Date.now()}`;
        return {
            access_token: `mock_zid_token_${storeId}`,
            refresh_token: `mock_refresh_${storeId}`,
            authorization: `mock_authz_${storeId}`,
            expires_in: 86400,
            ...this._mockStoreInfo(storeId)
        };
    }

    static _mockStoreInfo(storeId = `zid_mock_${Date.now()}`) {
        return {
            store_id: storeId,
            store_name: 'متجر زد تجريبي',
            store_domain: `${storeId}.zid.store`,
            email: 'demo@zid-mock.test',
            owner_name: 'تاجر زد'
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
                        if (res.statusCode >= 400) return reject(new Error(`Zid API ${res.statusCode}: ${parsed.message || data}`));
                        resolve(parsed);
                    } catch (e) { reject(new Error(`Zid API invalid response: ${data.slice(0, 200)}`)); }
                });
            });
            req.on('error', reject);
            if (body) req.write(body);
            req.end();
        });
    }
}

module.exports = ZidAdapter;
