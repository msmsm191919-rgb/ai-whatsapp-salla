// services/platforms/ShopifyAdapter.js
// Adapter لمنصة Shopify
// docs: https://shopify.dev/docs/apps/auth/oauth

const https = require('https');
const BaseAdapter = require('./BaseAdapter');

class ShopifyAdapter extends BaseAdapter {
    static get platform() { return 'shopify'; }

    static get displayInfo() {
        return {
            name: 'Shopify',
            name_ar: 'شوبيفاي',
            logo: '/images/platforms/shopify.svg',
            color: '#96BF48',
            color_accent: '#5E8E3E',
            description: 'المنصة العالمية الأكثر استخداماً للمتاجر',
            domain: 'shopify.com'
        };
    }

    static get isReady() {
        return !!(process.env.SHOPIFY_CLIENT_ID && process.env.SHOPIFY_CLIENT_SECRET);
    }

    /**
     * Shopify يحتاج shop domain — يجب يُمرّر في الـ URL
     */
    static getAuthorizationUrl(state, redirectUri, shopDomain) {
        const clientId = process.env.SHOPIFY_CLIENT_ID || 'mock';
        const shop = shopDomain || 'demo-shop.myshopify.com';
        const scopes = 'read_customers,read_orders,read_products,write_script_tags';
        return `https://${shop}/admin/oauth/authorize?client_id=${clientId}&scope=${scopes}&redirect_uri=${encodeURIComponent(redirectUri)}&state=${state}`;
    }

    static async exchangeCodeForToken(code, redirectUri, shopDomain) {
        if (!this.isReady) return this._mockToken(shopDomain);

        const shop = shopDomain;
        if (!shop) throw new Error('Shopify shop domain required');

        const body = JSON.stringify({
            client_id: process.env.SHOPIFY_CLIENT_ID,
            client_secret: process.env.SHOPIFY_CLIENT_SECRET,
            code
        });

        const tokenResp = await this._httpRequest('POST', shop, '/admin/oauth/access_token', body, {
            'Content-Type': 'application/json'
        });

        const storeInfo = await this.fetchStoreInfo(tokenResp.access_token, shop);

        return {
            access_token: tokenResp.access_token,
            scope: tokenResp.scope,
            ...storeInfo
        };
    }

    static async fetchStoreInfo(accessToken, shopDomain) {
        if (!this.isReady) return this._mockStoreInfo(shopDomain);
        if (!shopDomain) throw new Error('Shopify shop domain required');

        const data = await this._httpRequest('GET', shopDomain, '/admin/api/2024-04/shop.json', null, {
            'X-Shopify-Access-Token': accessToken
        });

        const s = data.shop || {};
        return {
            store_id: String(s.id),
            store_name: s.name,
            store_domain: s.domain || shopDomain,
            email: s.email,
            owner_name: s.shop_owner
        };
    }

    static _mockToken(shopDomain) {
        const storeId = `shopify_mock_${Date.now()}`;
        return {
            access_token: `mock_shopify_token_${storeId}`,
            scope: 'read_customers,read_orders,read_products',
            ...this._mockStoreInfo(shopDomain, storeId)
        };
    }

    static _mockStoreInfo(shopDomain, storeId = `shopify_mock_${Date.now()}`) {
        const domain = shopDomain || `${storeId}.myshopify.com`;
        return {
            store_id: storeId,
            store_name: 'Demo Shopify Store',
            store_domain: domain,
            email: 'demo@shopify-mock.test',
            owner_name: 'Shopify Merchant'
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
                        if (res.statusCode >= 400) return reject(new Error(`Shopify API ${res.statusCode}: ${parsed.errors || data}`));
                        resolve(parsed);
                    } catch (e) { reject(new Error(`Shopify API invalid response: ${data.slice(0, 200)}`)); }
                });
            });
            req.on('error', reject);
            if (body) req.write(body);
            req.end();
        });
    }
}

module.exports = ShopifyAdapter;
