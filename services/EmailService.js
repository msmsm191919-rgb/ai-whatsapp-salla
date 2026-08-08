// services/EmailService.js
// Email Provider Abstraction & Interface for Standalone Verification & Password Resets

const nodemailer = require('nodemailer');

class EmailProviderInterface {
    async sendVerificationEmail({ to, token, ownerName, storeName }) {
        throw new Error('Method sendVerificationEmail must be implemented');
    }

    async sendPasswordResetEmail({ to, token, ownerName }) {
        throw new Error('Method sendPasswordResetEmail must be implemented');
    }

    isDeliveryConfigured() {
        return false;
    }
}

class SystemEmailService extends EmailProviderInterface {
    constructor() {
        super();
        this.smtpHost = process.env.SMTP_HOST || null;
        this.smtpPort = process.env.SMTP_PORT || 587;
        this.smtpUser = process.env.SMTP_USER || null;
        this.smtpPass = process.env.SMTP_PASS || null;
        this.fromEmail = process.env.SENDER_EMAIL || 'info@mubhirbot.com';

        this.transporter = null;
        if (this.smtpHost && this.smtpUser && this.smtpPass) {
            this.transporter = nodemailer.createTransport({
                host: this.smtpHost,
                port: this.smtpPort,
                secure: this.smtpPort == 465,
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

    async sendVerificationEmail({ to, token, ownerName, storeName }) {
        const appUrl = process.env.APP_URL || 'https://app.mubhirbot.com';
        const verifyUrl = `${appUrl}/auth/standalone/verify-email?token=${encodeURIComponent(token)}`;
        const subject = `تأكيد البريد الإلكتروني — متجر ${storeName || 'مبهر'}`;

        if (!this.isDeliveryConfigured()) {
            console.log(`[EmailService MOCK LOG] Verification email to <${to}>: ${verifyUrl}`);
            return { sent: false, mock: true, verifyUrl };
        }

        try {
            await this.transporter.sendMail({
                from: `"مبهر AI" <${this.fromEmail}>`,
                to,
                subject,
                html: `
                    <div dir="rtl" style="font-family:sans-serif;padding:20px;">
                        <h2>مرحباً ${ownerName || 'عزيزنا التاجر'} 🚀</h2>
                        <p>شكراً لتسجيلك في مبهر AI لمتجر <strong>${storeName || ''}</strong>.</p>
                        <p>يرجى النقر على الرابط التالي لتأكيد بريدك الإلكتروني وتفعيل حسابك:</p>
                        <p><a href="${verifyUrl}" style="background:#0d9488;color:#fff;padding:12px 20px;text-decoration:none;border-radius:8px;">تأكيد البريد الإلكتروني</a></p>
                        <p>الرابط صالحة لمدة 24 ساعة فقط.</p>
                    </div>
                `
            });
            return { sent: true, mock: false };
        } catch (err) {
            console.error('[EmailService] Error sending verification email:', err.message);
            return { sent: false, error: err.message, verifyUrl };
        }
    }

    async sendPasswordResetEmail({ to, token, ownerName }) {
        const appUrl = process.env.APP_URL || 'https://app.mubhirbot.com';
        const resetUrl = `${appUrl}/auth/standalone/reset-password?token=${encodeURIComponent(token)}`;
        const subject = `إعادة تعيين كلمة المرور — مبهر AI`;

        if (!this.isDeliveryConfigured()) {
            console.log(`[EmailService MOCK LOG] Password reset email to <${to}>: ${resetUrl}`);
            return { sent: false, mock: true, resetUrl };
        }

        try {
            await this.transporter.sendMail({
                from: `"مبهر AI" <${this.fromEmail}>`,
                to,
                subject,
                html: `
                    <div dir="rtl" style="font-family:sans-serif;padding:20px;">
                        <h2>مرحباً ${ownerName || 'عزيزنا التاجر'}</h2>
                        <p>تلقينا طلباً لإعادة تعيين كلمة المرور الخاصة بحسابك في مبهر AI.</p>
                        <p>انقر على الرابط التالي لإنشاء كلمة مرور جديدة:</p>
                        <p><a href="${resetUrl}" style="background:#0d9488;color:#fff;padding:12px 20px;text-decoration:none;border-radius:8px;">إعادة تعيين كلمة المرور</a></p>
                        <p>الرابط صالح لمدة ساعة واحدة فقط.</p>
                    </div>
                `
            });
            return { sent: true, mock: false };
        } catch (err) {
            console.error('[EmailService] Error sending password reset email:', err.message);
            return { sent: false, error: err.message, resetUrl };
        }
    }
}

module.exports = new SystemEmailService();
