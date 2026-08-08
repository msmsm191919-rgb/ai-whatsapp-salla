// services/EmailService.js
// Production Transactional Email Service & Abstraction for Mubhir AI

const nodemailer = require('nodemailer');

class EmailProviderInterface {
    async sendVerificationEmail(params) { throw new Error('Unimplemented'); }
    async sendPasswordResetEmail(params) { throw new Error('Unimplemented'); }
    async sendTrialStartedEmail(params) { throw new Error('Unimplemented'); }
    async sendTrialEndingEmail(params) { throw new Error('Unimplemented'); }
    async sendTrialExpiredEmail(params) { throw new Error('Unimplemented'); }
    async sendPaymentSuccessEmail(params) { throw new Error('Unimplemented'); }
    async sendPaymentFailedEmail(params) { throw new Error('Unimplemented'); }
    async sendQRDisconnectedEmail(params) { throw new Error('Unimplemented'); }
    async sendQRRestoredEmail(params) { throw new Error('Unimplemented'); }
    isDeliveryConfigured() { return false; }
}

class SystemEmailService extends EmailProviderInterface {
    constructor() {
        super();
        this.providerName = process.env.EMAIL_PROVIDER || 'SMTP';
        this.smtpHost = process.env.SMTP_HOST || null;
        this.smtpPort = process.env.SMTP_PORT || 587;
        this.smtpUser = process.env.SMTP_USER || null;
        this.smtpPass = process.env.SMTP_PASS || process.env.SMTP_PASSWORD || null;
        this.smtpSecure = process.env.SMTP_SECURE !== undefined ? (process.env.SMTP_SECURE === 'true' || process.env.SMTP_SECURE === '1') : (Number(this.smtpPort) === 465);
        this.fromEmail = process.env.EMAIL_FROM || process.env.SENDER_EMAIL || 'info@mubhirbot.com';
        this.fromName = process.env.EMAIL_FROM_NAME || 'مبهر AI';

        this.rateLimitMap = new Map(); // Simple rate limiting map (action:email -> timestamp)
        this.transporter = null;
        this.initTransporter();
    }

    initTransporter() {
        if (this.smtpHost && this.smtpUser && this.smtpPass) {
            this.transporter = nodemailer.createTransport({
                host: this.smtpHost,
                port: Number(this.smtpPort),
                secure: this.smtpSecure,
                connectionTimeout: 10000,
                socketTimeout: 10000,
                auth: {
                    user: this.smtpUser,
                    pass: this.smtpPass
                }
            });
        }
    }

    isDeliveryConfigured() {
        return !!(this.transporter && this.smtpHost && this.smtpUser && this.smtpPass);
    }

    maskEmail(email) {
        if (!email || !email.includes('@')) return 'user***';
        const [name, domain] = email.split('@');
        return `${name.slice(0, 2)}***@${domain}`;
    }

    canSend(email, action, windowMs = 60000) {
        const key = `${action}:${email}`;
        const lastSent = this.rateLimitMap.get(key);
        const now = Date.now();
        if (lastSent && (now - lastSent < windowMs)) {
            return false;
        }
        this.rateLimitMap.set(key, now);
        return true;
    }

    async dispatchEmail({ to, subject, html, action }) {
        if (!to) return { sent: false, error: 'No recipient provided' };
        if (!this.canSend(to, action)) {
            return { sent: false, error: 'Rate limit exceeded for recipient' };
        }

        const from = `"${this.fromName}" <${this.fromEmail}>`;

        if (!this.isDeliveryConfigured()) {
            console.log(`[EmailService MOCK LOG] Action: ${action} | To: <${this.maskEmail(to)}> | Subject: "${subject}"`);
            return { sent: false, mock: true };
        }

        try {
            const info = await this.transporter.sendMail({
                from,
                to,
                subject,
                html
            });
            console.log(`[EmailService SUCCESS] Sent ${action} to <${this.maskEmail(to)}>, messageId: ${info.messageId}`);
            return { sent: true, messageId: info.messageId };
        } catch (err) {
            console.error(`[EmailService ERROR] Failed sending ${action} to <${this.maskEmail(to)}>:`, err.message);
            return { sent: false, error: err.message };
        }
    }

    // 1. Verification Email
    async sendVerificationEmail({ to, token, ownerName, storeName }) {
        const appUrl = process.env.APP_URL || 'https://app.mubhirbot.com';
        const verifyUrl = `${appUrl}/auth/standalone/verify-email?token=${encodeURIComponent(token)}`;
        const subject = `تأكيد البريد الإلكتروني — متجر ${storeName || 'مبهر'}`;

        const html = `
            <div dir="rtl" style="font-family:sans-serif;padding:24px;background:#0f172a;color:#f8fafc;border-radius:16px;">
                <h2 style="color:#14b8a6;">مرحباً ${ownerName || 'عزيزنا التاجر'} 🚀</h2>
                <p style="color:#cbd5e1;">شكراً لتسجيلك في مبهر AI لمتجر <strong>${storeName || ''}</strong>.</p>
                <p style="color:#cbd5e1;">يرجى النقر على الزر التالي لتأكيد بريدك الإلكتروني وتفعيل حسابك:</p>
                <p style="margin:24px 0;">
                    <a href="${verifyUrl}" style="background:linear-gradient(135deg,#0d9488,#14b8a6);color:#fff;padding:14px 28px;text-decoration:none;border-radius:10px;font-weight:bold;display:inline-block;">تأكيد البريد الإلكتروني</a>
                </p>
                <p style="color:#94a3b8;font-size:12px;">الرابط صالحة لمدة 24 ساعة فقط.</p>
            </div>
        `;
        return this.dispatchEmail({ to, subject, html, action: 'VERIFICATION' });
    }

    // 2. Password Reset Email
    async sendPasswordResetEmail({ to, token, ownerName }) {
        const appUrl = process.env.APP_URL || 'https://app.mubhirbot.com';
        const resetUrl = `${appUrl}/auth/standalone/reset-password?token=${encodeURIComponent(token)}`;
        const subject = `إعادة تعيين كلمة المرور — مبهر AI`;

        const html = `
            <div dir="rtl" style="font-family:sans-serif;padding:24px;background:#0f172a;color:#f8fafc;border-radius:16px;">
                <h2 style="color:#14b8a6;">مرحباً ${ownerName || 'عزيزنا التاجر'}</h2>
                <p style="color:#cbd5e1;">تلقينا طلباً لإعادة تعيين كلمة المرور الخاصة بحسابك في مبهر AI.</p>
                <p style="margin:24px 0;">
                    <a href="${resetUrl}" style="background:linear-gradient(135deg,#0d9488,#14b8a6);color:#fff;padding:14px 28px;text-decoration:none;border-radius:10px;font-weight:bold;display:inline-block;">إعادة تعيين كلمة المرور</a>
                </p>
                <p style="color:#94a3b8;font-size:12px;">الرابط صالح لمدة ساعة واحدة فقط.</p>
            </div>
        `;
        return this.dispatchEmail({ to, subject, html, action: 'PASSWORD_RESET' });
    }

    // 3. Trial Started Email
    async sendTrialStartedEmail({ to, ownerName, storeName, trialDays = 3 }) {
        const subject = `بدء التجربة المجانية (${trialDays} أيام) — مبهر AI`;
        const html = `
            <div dir="rtl" style="font-family:sans-serif;padding:24px;background:#0f172a;color:#f8fafc;border-radius:16px;">
                <h2 style="color:#14b8a6;">أهلاً بك في مبهر AI! 🎉</h2>
                <p style="color:#cbd5e1;">تم تفعيل تجربتك المجانية لمدة <strong>${trialDays} أيام</strong> لمتجر <strong>${storeName || ''}</strong>.</p>
                <p style="color:#cbd5e1;">يمكنك الآن ربط الواتساب وتدريب الرد الآلي الذكي لبدء استقبال المحادثات والمبيعات.</p>
            </div>
        `;
        return this.dispatchEmail({ to, subject, html, action: 'TRIAL_STARTED' });
    }

    // 4. Trial Ending (1 Day Left)
    async sendTrialEndingEmail({ to, ownerName, storeName, daysLeft = 1 }) {
        const subject = `تنبيه: متبقي يوم واحد على انتهاء التجربة المجانية — مبهر AI`;
        const html = `
            <div dir="rtl" style="font-family:sans-serif;padding:24px;background:#0f172a;color:#f8fafc;border-radius:16px;">
                <h2 style="color:#f59e0b;">تنبيه انتهاء التجربة المجانية ⏳</h2>
                <p style="color:#cbd5e1;">متبقي يوم واحد فقط على انتهاء التجربة المجانية لمتجر <strong>${storeName || ''}</strong>.</p>
                <p style="color:#cbd5e1;">لتجنب توقف الرد الآلي الذكي، يرجى تأكيد باقة اشتراكك من صفحة الفوترة.</p>
            </div>
        `;
        return this.dispatchEmail({ to, subject, html, action: 'TRIAL_ENDING' });
    }

    // 5. Trial Expired Email
    async sendTrialExpiredEmail({ to, ownerName, storeName }) {
        const subject = `انتهت فترة التجربة المجانية — مبهر AI`;
        const html = `
            <div dir="rtl" style="font-family:sans-serif;padding:24px;background:#0f172a;color:#f8fafc;border-radius:16px;">
                <h2 style="color:#ef4444;">انتهت تجاربك المجانية 🔔</h2>
                <p style="color:#cbd5e1;">انتهت فترة التجربة المجانية لمتجر <strong>${storeName || ''}</strong>.</p>
                <p style="color:#cbd5e1;">اشترك الآن لاستعادة خدمات الرد الآلي والحملات الترويجية.</p>
            </div>
        `;
        return this.dispatchEmail({ to, subject, html, action: 'TRIAL_EXPIRED' });
    }

    // 6. Payment Success Email
    async sendPaymentSuccessEmail({ to, ownerName, storeName, amount, planName }) {
        const subject = `تأكيد نجاح عملية الدفع — مبهر AI`;
        const html = `
            <div dir="rtl" style="font-family:sans-serif;padding:24px;background:#0f172a;color:#f8fafc;border-radius:16px;">
                <h2 style="color:#10b981;">تمت عملية الدفع بنجاح ✅</h2>
                <p style="color:#cbd5e1;">شكراً لك! تم تجديد اشتراك متجر <strong>${storeName || ''}</strong> بنجاح في باقة <strong>${planName || 'الأساسية'}</strong>.</p>
                <p style="color:#cbd5e1;">المبلغ المدفوع: <strong>${amount || ''} ر.س</strong>.</p>
            </div>
        `;
        return this.dispatchEmail({ to, subject, html, action: 'PAYMENT_SUCCESS' });
    }

    // 7. Payment Failed Email
    async sendPaymentFailedEmail({ to, ownerName, storeName, planName }) {
        const subject = `تنبيه: فشل عملية الدفع — مبهر AI`;
        const html = `
            <div dir="rtl" style="font-family:sans-serif;padding:24px;background:#0f172a;color:#f8fafc;border-radius:16px;">
                <h2 style="color:#ef4444;">تعذر إتمام عملية الدفع ⚠️</h2>
                <p style="color:#cbd5e1;">تعذر الخصم التلقائي لاشتراك متجر <strong>${storeName || ''}</strong> في باقة <strong>${planName || ''}</strong>.</p>
                <p style="color:#cbd5e1;">يرجى تحديث وسيلة الدفع لتجنب إيقاف الخدمات.</p>
            </div>
        `;
        return this.dispatchEmail({ to, subject, html, action: 'PAYMENT_FAILED' });
    }

    // 8. QR Disconnected Email (With Sustained Check)
    async sendQRDisconnectedEmail({ to, ownerName, storeName, isSustained = false }) {
        if (!isSustained) {
            console.log(`[EmailService IGNORE] Transient QR disconnect for store ${storeName}. Email suppressed.`);
            return { sent: false, suppressed: true, reason: 'transient_disconnect' };
        }

        const subject = `تنبيه هام: انقطاع اتصال الواتساب — متجر ${storeName || ''}`;
        const html = `
            <div dir="rtl" style="font-family:sans-serif;padding:24px;background:#0f172a;color:#f8fafc;border-radius:16px;">
                <h2 style="color:#ef4444;">انقطاع اتصال واتساب ⚠️</h2>
                <p style="color:#cbd5e1;">تم إغلاق أو انقطاع جلسة الواتساب لمتجر <strong>${storeName || ''}</strong>.</p>
                <p style="color:#cbd5e1;">يرجى مسح رمز QR الجديد من لوحة التحكم لاستعادة الرد الآلي والحملات.</p>
            </div>
        `;
        return this.dispatchEmail({ to, subject, html, action: 'QR_DISCONNECTED' });
    }

    // 9. QR Restored Email
    async sendQRRestoredEmail({ to, ownerName, storeName }) {
        const subject = `تم استعادة اتصال الواتساب بنجاح — متجر ${storeName || ''}`;
        const html = `
            <div dir="rtl" style="font-family:sans-serif;padding:24px;background:#0f172a;color:#f8fafc;border-radius:16px;">
                <h2 style="color:#10b981;">تم استعادة الاتصال ✅</h2>
                <p style="color:#cbd5e1;">تمت إعادة ربط واتساب متجر <strong>${storeName || ''}</strong> بنجاح. البوت الذكي جاهز للعمل الان.</p>
            </div>
        `;
        return this.dispatchEmail({ to, subject, html, action: 'QR_RESTORED' });
    }
}

module.exports = new SystemEmailService();
