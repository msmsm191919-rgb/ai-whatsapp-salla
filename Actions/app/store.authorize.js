const SallaDatabase = require('../../database/db_instance');
const SallaAdapter = require('../../services/platforms/SallaAdapter');
const ConnectService = require('../../services/ConnectService');

module.exports = async (eventBody, userArgs) => {
  try {
    const merchantId = eventBody.merchant;
    const tokenData = eventBody.data || eventBody;
    
    console.log(`🔑 [Actions/app.store.authorize] Received for merchant: ${merchantId}`);
    
    if (!merchantId) throw new Error("Missing merchant in authorize payload");
    if (!tokenData || !tokenData.access_token) throw new Error("Missing access_token in authorize payload");

    const expiresNum = Number(tokenData.expires || 0);
    const expiresDate = expiresNum > 0 ? new Date(expiresNum * 1000) : new Date(Date.now() + 86400 * 1000);

    const storeInfo = await SallaAdapter.fetchStoreInfo(tokenData.access_token);

    const { tenant } = await ConnectService.upsertTenantFromOAuth({
      platform: 'salla',
      skipSubscriptionTrial: true,
      tokenData: {
        access_token: tokenData.access_token,
        refresh_token: tokenData.refresh_token,
        expires_at: expiresDate,
        scope: tokenData.scope || null,
        token_type: tokenData.token_type || 'Bearer',
        store_id: String(merchantId),
        store_name: storeInfo.store_name,
        store_domain: storeInfo.store_domain,
        email: storeInfo.email,
        owner_name: storeInfo.owner_name,
        contact_phone: storeInfo.contact_phone
      }
    });

    const settings = tenant.settings || {};
    await tenant.update({
      status: 'active',
      settings: { ...settings, billing_source: 'salla', salla_integration_status: 'active' }
    });

    console.log(`✅ [Actions/app.store.authorize] Tenant ${tenant.id} (${tenant.store_name}) authorized successfully.`);
    return tenant;
  } catch (e) {
    console.error("❌ Error in Actions/app.store.authorize:", e.message);
    throw e;
  }
};
