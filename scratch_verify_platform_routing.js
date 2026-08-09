require('dotenv').config();
const https = require('https');
const http = require('http');
const EmailService = require('./services/EmailService');
const SallaDatabase = require('./helpers/ORMs/Sequelize/index');

(async () => {
    console.log('=== 🚀 PLATFORM ROUTING & SAFETY VERIFICATION TEST ===');

    const appUrl = process.env.APP_URL || 'https://app.mubhirbot.com';

    // 1. Unauthenticated request to /standalone/dashboard
    const resUnauth = await new Promise((resolve) => {
        https.get(`${appUrl}/standalone/dashboard`, (res) => {
            resolve({ status: res.statusCode, location: res.headers.location || 'none' });
        });
    });

    console.log('UNAUTH_STANDALONE_DASHBOARD_STATUS:', resUnauth.status);
    console.log('UNAUTH_STANDALONE_DASHBOARD_REDIRECT:', resUnauth.location);
    console.log('STANDALONE_LOGIN_NEVER_REDIRECTS_TO_SALLA:', !resUnauth.location.includes('oauth/redirect') && !resUnauth.location.includes('salla'));

    // 2. Test EmailService CTA generation for Standalone vs Salla
    const standaloneDashboardUrl = EmailService.getDashboardUrl('standalone');
    const standaloneBillingUrl = EmailService.getBillingUrl('standalone');
    const standaloneWaUrl = EmailService.getWhatsAppWebUrl('standalone');

    const sallaDashboardUrl = EmailService.getDashboardUrl('salla');
    const sallaBillingUrl = EmailService.getBillingUrl('salla');
    const sallaWaUrl = EmailService.getWhatsAppWebUrl('salla');

    console.log('STANDALONE_EMAIL_DASHBOARD_URL:', standaloneDashboardUrl);
    console.log('STANDALONE_EMAIL_BILLING_URL:', standaloneBillingUrl);
    console.log('STANDALONE_EMAIL_WA_URL:', standaloneWaUrl);

    console.log('SALLA_EMAIL_DASHBOARD_URL:', sallaDashboardUrl);
    console.log('SALLA_EMAIL_BILLING_URL:', sallaBillingUrl);
    console.log('SALLA_EMAIL_WA_URL:', sallaWaUrl);

    // 3. Verify Tenant 41 DB Integrity
    const db = SallaDatabase.connection;
    if (db && db.models && db.models.Tenant) {
        const tenant41 = await db.models.Tenant.findByPk(41);
        if (tenant41) {
            console.log('TENANT_41_FOUND: YES');
            console.log('TENANT_41_PLATFORM:', tenant41.platform);
            console.log('TENANT_41_STORE_NAME:', tenant41.store_name);
        } else {
            console.log('TENANT_41_FOUND: NO');
        }
    }

    process.exit(0);
})();
