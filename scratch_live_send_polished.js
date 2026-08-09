require('dotenv').config();
const EmailService = require('./services/EmailService');
const ownerEmail = process.env.SMTP_USER || process.env.EMAIL_FROM;

(async () => {
    console.log('=== 🚀 POLISHED DISPATCH TEST TO OWNER INBOX ===');
    console.log('OWNER_EMAIL_MASKED:', EmailService.maskEmail(ownerEmail));
    
    if (!EmailService.isDeliveryConfigured()) {
        console.error('❌ ERROR: SMTP is not configured in .env on VPS!');
        process.exit(1);
    }

    try {
        // 1. Verification Preview (Short H1, Secure Anchor Text Fallback)
        const r1 = await EmailService.sendVerificationEmail({
            to: ownerEmail,
            token: 'live_polished_verification_token_777',
            ownerName: 'المالك المحترم',
            storeName: 'متجر التجربة'
        });
        console.log('VERIFICATION_DISPATCH:', JSON.stringify(r1));

        // 2. Payment Success Preview (Transaction Summary Component)
        const r2 = await EmailService.sendPaymentSuccessEmail({
            to: ownerEmail,
            ownerName: 'المالك المحترم',
            storeName: 'متجر التجربة',
            amount: 149,
            planName: 'النمو'
        });
        console.log('PAYMENT_DISPATCH:', JSON.stringify(r2));

        // 3. QR Disconnected Preview (Short H1 "انقطع اتصال واتساب")
        const r3 = await EmailService.sendQRDisconnectedEmail({
            to: ownerEmail,
            ownerName: 'المالك المحترم',
            storeName: 'متجر التجربة',
            isSustained: true
        });
        console.log('QR_DISPATCH:', JSON.stringify(r3));

    } catch (e) {
        console.error('DISPATCH_ERROR:', e.message);
    }

    process.exit(0);
})();
