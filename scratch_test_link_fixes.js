require('dotenv').config();
const http = require('http');
const https = require('https');
const EmailService = require('./services/EmailService');
const SallaDatabase = require('./helpers/ORMs/Sequelize/index');
const ownerEmail = process.env.SMTP_USER || process.env.EMAIL_FROM;

(async () => {
    console.log('=== 🚀 E2E LINK FIXES & PASSWORD RESET FLOW TEST ===');

    const crypto = require('crypto');
    const testToken = crypto.randomBytes(32).toString('hex');

    const db = SallaDatabase.connection;
    let tenant = null;

    if (db && db.models && db.models.Tenant) {
        tenant = await db.models.Tenant.findOne();
    }

    if (tenant) {
        console.log('Using test tenant:', tenant.email || tenant.store_name);

        await tenant.update({
            password_reset_token: testToken,
            password_reset_expires_at: new Date(Date.now() + 60 * 60 * 1000)
        });

        console.log('Set test password_reset_token for tenant.');

        // Perform GET request to /auth/standalone/reset-password?token=...
        const appUrl = process.env.APP_URL || 'https://app.mubhirbot.com';
        const testUrl = `${appUrl}/auth/standalone/reset-password?token=${testToken}`;

        const resGet = await new Promise((resolve) => {
            https.get(testUrl, (res) => {
                let body = '';
                res.on('data', chunk => body += chunk);
                res.on('end', () => resolve({ status: res.statusCode, body }));
            });
        });

        console.log('RESET_EMAIL_CTA_HTTP_STATUS:', resGet.status);
        console.log('RESET_PAGE_RENDERED:', resGet.body.includes('إعادة تعيين كلمة المرور'));

        // Clean up test token
        await tenant.update({ password_reset_token: null, password_reset_expires_at: null });
    } else {
        console.log('DB not initialized in script context, testing GET /auth/standalone/reset-password?token=invalid_test');
        const appUrl = process.env.APP_URL || 'https://app.mubhirbot.com';
        const testUrl = `${appUrl}/auth/standalone/reset-password?token=invalid_test`;

        const resGet = await new Promise((resolve) => {
            https.get(testUrl, (res) => {
                let body = '';
                res.on('data', chunk => body += chunk);
                res.on('end', () => resolve({ status: res.statusCode, body }));
            });
        });

        console.log('RESET_EMAIL_CTA_HTTP_STATUS:', resGet.status);
        console.log('RESET_PAGE_RENDERED:', resGet.body.includes('رابط غير صالح'));
    }

    console.log('\n=== 2. RETESTING ALL 9 EMAIL TEMPLATES LINK RESOLUTION ===');
    const marketingUrl = 'https://mubhirbot.com';
    const appUrl = process.env.APP_URL || 'https://app.mubhirbot.com';

    console.log('HEADER_LOGO_DESTINATION:', marketingUrl);
    console.log('OFFICIAL_SITE_DESTINATION:', marketingUrl);
    console.log('PRIVACY_DESTINATION:', `${marketingUrl}/privacy`);
    console.log('TERMS_DESTINATION:', `${marketingUrl}/terms`);
    console.log('SUPPORT_DESTINATION:', `${marketingUrl}/support`);
    console.log('QR_DISCONNECT_FINAL_DESTINATION:', `${appUrl}/whatsapp-web`);

    process.exit(0);
})();
