const axios = require('axios');
const SallaDatabase = require('../database/db_instance');

class SallaService {
    constructor() {
        this.tokenUrl = 'https://accounts.salla.sa/oauth2/token';
        this.clientId = process.env.SALLA_OAUTH_CLIENT_ID;
        this.clientSecret = process.env.SALLA_OAUTH_CLIENT_SECRET;
    }

    async refreshToken(tenantId) {
        const db = SallaDatabase.connection;
        if (!db) return false;

        const dialect = db.options.dialect || 'mysql';
        const txOptions = {};
        if (dialect === 'sqlite') {
            txOptions.type = db.Sequelize.Transaction.TYPES.IMMEDIATE;
        }

        const transaction = await db.transaction(txOptions);
        try {
            // 1. Lock SallaOAuth row. SQLite locks database at transaction start; MySQL/Postgres locks row.
            const findOptions = {
                where: { tenant_id: tenantId },
                transaction
            };
            if (dialect !== 'sqlite') {
                findOptions.lock = transaction.LOCK.UPDATE;
            }

            const tokenRecord = await db.models.SallaOAuth.findOne(findOptions);

            if (!tokenRecord || !tokenRecord.refresh_token) {
                console.error(`❌ No refresh token found for tenant ${tenantId}`);
                await transaction.rollback();
                return false;
            }

            // Check if another concurrent thread refreshed it while we were waiting for the lock
            if (tokenRecord.expires_at && tokenRecord.expires_at > new Date(Date.now() + 60000)) {
                console.log(`[refreshToken:${tenantId}] Token already refreshed by another concurrent thread.`);
                const freshToken = tokenRecord.access_token;
                await transaction.rollback();
                return freshToken;
            }

            // 2. Call Salla Identity API
            const response = await axios.post(this.tokenUrl, new URLSearchParams({
                client_id: this.clientId,
                client_secret: this.clientSecret,
                grant_type: 'refresh_token',
                refresh_token: tokenRecord.refresh_token,
            }), {
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded'
                },
                timeout: 10000
            });

            const { access_token, refresh_token, expires_in } = response.data;

            // 3. Update DB in a single transaction
            const tokenExpiresAt = expires_in ? new Date(Date.now() + expires_in * 1000) : null;
            
            tokenRecord.access_token = access_token;
            tokenRecord.refresh_token = refresh_token;
            tokenRecord.expires_at = tokenExpiresAt;

            await tokenRecord.save({ transaction });
            await transaction.commit();

            console.log(`✅ Token refreshed successfully for tenant ${tenantId}`);
            return access_token;

        } catch (error) {
            await transaction.rollback();
            
            // Handle invalid_grant / revoked token
            const errData = error.response?.data || {};
            const isInvalidGrant = errData.error === 'invalid_grant' || String(errData.message || '').includes('grant');
            
            if (isInvalidGrant) {
                console.error(`❌ Salla Token Revoked (invalid_grant) for tenant ${tenantId}. Marking integration as revoked.`);
                try {
                    const tenant = await db.models.Tenant.findByPk(tenantId);
                    if (tenant) {
                        const settings = tenant.settings || {};
                        await tenant.update({ settings: { ...settings, salla_integration_status: 'revoked' } });
                        // Clear the SallaOAuth tokens
                        await db.models.SallaOAuth.destroy({ where: { tenant_id: tenantId } });
                    }
                } catch (dbErr) {
                    console.error("Failed to revoke integration on invalid_grant:", dbErr.message);
                }
            } else {
                console.error(`❌ Failed to refresh Salla token for tenant ${tenantId}:`, errData.message || error.message);
            }
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
