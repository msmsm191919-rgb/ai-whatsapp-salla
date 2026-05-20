const axios = require('axios');
const SallaDatabase = require('../database/db_instance');

class SallaService {
    constructor() {
        this.tokenUrl = 'https://accounts.salla.sa/oauth2/token';
        this.clientId = process.env.SALLA_OAUTH_CLIENT_ID;
        this.clientSecret = process.env.SALLA_OAUTH_CLIENT_SECRET;
    }

    /*
     * Refresh the access token using the stored refresh token
     */
    async refreshToken(tenantId) {
        // 1. Get Tenant details (Refresh Token)
        const db = SallaDatabase.connection;
        if (!db) return false;

        const tokenRecord = await db.models.SallaOAuth.findOne({ where: { tenant_id: tenantId } });
        if (!tokenRecord || !tokenRecord.refresh_token) {
            console.error(`❌ No refresh token found for tenant ${tenantId}`);
            return false;
        }

        try {
            // 2. Call Salla Identity API
            const response = await axios.post(this.tokenUrl, new URLSearchParams({
                client_id: this.clientId,
                client_secret: this.clientSecret,
                grant_type: 'refresh_token',
                refresh_token: tokenRecord.refresh_token,
            }), {
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded'
                }
            });

            const { access_token, refresh_token, expires_in } = response.data;

            // 3. Update DB
            tokenRecord.access_token = access_token;
            tokenRecord.refresh_token = refresh_token; // Salla rotates refresh tokens too!
            tokenRecord.expires_in = expires_in;

            // Update updated_at automatically by Sequelize
            await tokenRecord.save();

            console.log(`✅ Token refreshed successfully for tenant ${tenantId}`);
            return access_token;

        } catch (error) {
            console.error(`❌ Failed to refresh Salla token for tenant ${tenantId}:`, error.response?.data || error.message);
            return false;
        }
    }

    /*
     * Helper to execute requests to Salla API with auto-refresh
     */
    async request(tenantId, method, endpoint, data = null) {
        const db = SallaDatabase.connection;
        const tokenRecord = await db.models.SallaOAuth.findOne({ where: { tenant_id: tenantId } });

        if (!tokenRecord) throw new Error("No token found for tenant");

        let accessToken = tokenRecord.access_token;

        try {
            return await axios({
                method,
                url: `https://api.salla.dev/admin/v2/${endpoint}`,
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                    'Content-Type': 'application/json'
                },
                data
            });
        } catch (error) {
            // If 401 Unauthorized, try to refresh token
            if (error.response && error.response.status === 401) {
                console.log(`🔄 Token expired for tenant ${tenantId}, refreshing...`);
                accessToken = await this.refreshToken(tenantId);

                if (accessToken) {
                    // Retry the request with new token
                    return await axios({
                        method,
                        url: `https://api.salla.dev/admin/v2/${endpoint}`,
                        headers: {
                            'Authorization': `Bearer ${accessToken}`,
                            'Content-Type': 'application/json'
                        },
                        data
                    });
                }
            }
            // Use fallback or rethrow
            throw error;
        }
    }
}

module.exports = new SallaService();
