// services/EmailService.js
// Production Transactional Email Service & Branded Design System for Mubhir AI

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

        this.rateLimitMap = new Map();
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

    /**
     * 🎨 Centralized Branded Email Layout Engine (Mubhir AI Design System)
     */
    renderMubhirEmailLayout({
        title,
        contentHtml,
        ctaText,
        ctaUrl,
        secondaryHtml = '',
        promoBlockHtml = '',
        isSecurityAlert = false
    }) {
        const appUrl = process.env.APP_URL || 'https://app.mubhirbot.com';
        const logoUrl = `${appUrl}/images/logo.png`;

        // Optional promotional block (suppressed for security & urgent alert emails)
        const renderPromo = (!isSecurityAlert && promoBlockHtml) ? `
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin-top:24px;background:rgba(20,184,166,0.08);border:1px solid rgba(20,184,166,0.2);border-radius:12px;padding:16px;">
                <tr>
                    <td dir="rtl" style="font-family:'Cairo',Arial,sans-serif;font-size:13px;line-height:1.6;color:#cbd5e1;">
                        ${promoBlockHtml}
                    </td>
                </tr>
            </table>
        ` : '';

        // Primary CTA Button + Fallback Text Link Component
        const renderCTA = (ctaText && ctaUrl) ? `
            <table role="presentation" cellspacing="0" cellpadding="0" style="margin:28px 0 16px 0;">
                <tr>
                    <td align="center" style="border-radius:10px;background:linear-gradient(135deg,#0d9488 0%,#14b8a6 100%);">
                        <a href="${ctaUrl}" target="_blank" style="font-family:'Cairo',Arial,sans-serif;font-size:15px;font-weight:bold;color:#ffffff;text-decoration:none;padding:14px 28px;border-radius:10px;display:inline-block;border:1px solid rgba(255,255,255,0.15);">
                            ${ctaText}
                        </a>
                    </td>
                </tr>
            </table>
            <p dir="rtl" style="font-family:'Cairo',Arial,sans-serif;font-size:11px;color:#64748b;margin-top:12px;word-break:break-all;">
                إذا لم يعمل الزر أعلاه، انسخ الرابط التالي والصقه في المتصفح:<br>
                <a href="${ctaUrl}" style="color:#06b6d4;text-decoration:underline;">${ctaUrl}</a>
            </p>
        ` : '';

        return `
            <!DOCTYPE html>
            <html lang="ar" dir="rtl">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>${title}</title>
            </head>
            <body style="margin:0;padding:0;background-color:#0b1329;font-family:'Cairo',Arial,sans-serif;-webkit-font-smoothing:antialiased;">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color:#0b1329;padding:32px 16px;">
                    <tr>
                        <td align="center">
                            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;background-color:#151e32;border:1px solid rgba(255,255,255,0.1);border-radius:16px;overflow:hidden;box-shadow:0 20px 40px rgba(0,0,0,0.4);">
                                
                                <!-- HEADER -->
                                <tr>
                                    <td style="padding:28px 32px 20px 32px;background:linear-gradient(180deg,rgba(13,148,136,0.12) 0%,rgba(21,30,50,0) 100%);border-bottom:1px solid rgba(255,255,255,0.06);">
                                        <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                                            <tr>
                                                <td dir="rtl" align="right" style="font-family:'Cairo',Arial,sans-serif;">
                                                    <div style="display:inline-block;padding:8px 14px;background:linear-gradient(135deg,#0d9488,#14b8a6);border-radius:10px;color:#ffffff;font-weight:900;font-size:16px;letter-spacing:-0.5px;">
                                                        ⚡ مبهر AI
                                                    </div>
                                                </td>
                                            </tr>
                                        </table>
                                    </td>
                                </tr>

                                <!-- BODY CONTENT -->
                                <tr>
                                    <td dir="rtl" style="padding:32px;font-family:'Cairo',Arial,sans-serif;text-align:right;">
                                        <h1 style="margin:0 0 16px 0;font-size:20px;font-weight:800;color:#f8fafc;line-height:1.4;">
                                            ${title}
                                        </h1>
                                        <div style="font-size:14px;line-height:1.7;color:#cbd5e1;">
                                            ${contentHtml}
                                        </div>
                                        
                                        ${renderCTA}

                                        ${secondaryHtml ? `<div style="margin-top:20px;font-size:13px;color:#94a3b8;">${secondaryHtml}</div>` : ''}

                                        ${renderPromo}
                                    </td>
                                </tr>

                                <!-- FOOTER -->
                                <tr>
                                    <td dir="rtl" style="padding:24px 32px;background-color:#0f172a;border-top:1px solid rgba(255,255,255,0.06);text-align:center;font-family:'Cairo',Arial,sans-serif;">
                                        <p style="margin:0 0 12px 0;font-size:12px;color:#64748b;">
                                            مبهر AI — المنصة الذكية لأتمتة تسويق الواتساب والمبيعات في المملكة العربية السعودية
                                        </p>
                                        <div style="font-size:11px;color:#475569;">
                                            <a href="${appUrl}" style="color:#0d9488;text-decoration:none;margin:0 8px;">الموقع الرسمي</a> •
                                            <a href="${appUrl}/privacy" style="color:#0d9488;text-decoration:none;margin:0 8px;">سياسة الخصوصية</a> •
                                            <a href="${appUrl}/terms" style="color:#0d9488;text-decoration:none;margin:0 8px;">الشروط والأحكام</a>
                                        </div>
                                    </td>
                                </tr>

                            </table>
                        </td>
                    </tr>
                </table>
            </body>
            </html>
        `;
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

    formatStoreDisplayName(name) {
        if (!name) return 'مبهر';
        const trimmed = name.trim();
        if (trimmed.startsWith('متجر') || trimmed.toLowerCase().startsWith('store')) {
            return trimmed;
        }
        return `متجر ${trimmed}`;
    }

    // 1. Email Verification (Security Email — No Promo)
    async sendVerificationEmail({ to, token, ownerName, storeName }) {
        const appUrl = process.env.APP_URL || 'https://app.mubhirbot.com';
        const verifyUrl = `${appUrl}/auth/standalone/verify-email?token=${encodeURIComponent(token)}`;
        const displayStoreName = this.formatStoreDisplayName(storeName);
        const title = `تأكيد البريد الإلكتروني — ${displayStoreName}`;

        const contentHtml = `
            <p>مرحباً <strong>${ownerName || 'عزيزنا التاجر'}</strong> 🚀</p>
            <p>شكراً لتسجيلك في مبهر AI لـ <strong>${displayStoreName}</strong>.</p>
            <p>يرجى النقر على الزر أدناه لتأكيد بريدك الإلكتروني وتفعيل حسابك والبدء في استخدام البوت الذكي.</p>
        `;

        const html = this.renderMubhirEmailLayout({
            title,
            contentHtml,
            ctaText: 'تأكيد البريد الإلكتروني',
            ctaUrl: verifyUrl,
            secondaryHtml: 'ملاحظة: هذا الرابط صالح لمدة 24 ساعة فقط لضمان أمان حسابك.',
            isSecurityAlert: true
        });

        return this.dispatchEmail({ to, subject: title, html, action: 'VERIFICATION' });
    }

    // 2. Password Reset Email (Security Email — No Promo)
    async sendPasswordResetEmail({ to, token, ownerName }) {
        const appUrl = process.env.APP_URL || 'https://app.mubhirbot.com';
        const resetUrl = `${appUrl}/auth/standalone/reset-password?token=${encodeURIComponent(token)}`;
        const title = `إعادة تعيين كلمة المرور — مبهر AI`;

        const contentHtml = `
            <p>مرحباً <strong>${ownerName || 'عزيزنا التاجر'}</strong></p>
            <p>تلقينا طلباً لإعادة تعيين كلمة المرور الخاصة بحسابك في مبهر AI.</p>
            <p>انقر على الزر أدناه لإنشاء كلمة مرور جديدة وتأمين حسابك.</p>
        `;

        const html = this.renderMubhirEmailLayout({
            title,
            contentHtml,
            ctaText: 'إعادة تعيين كلمة المرور',
            ctaUrl: resetUrl,
            secondaryHtml: 'ملاحظة: الرابط صالح لمدة ساعة واحدة فقط لمرة واحدة.',
            isSecurityAlert: true
        });

        return this.dispatchEmail({ to, subject: title, html, action: 'PASSWORD_RESET' });
    }

    // 3. Trial Started Email (Welcome — Promotional Block Allowed)
    async sendTrialStartedEmail({ to, ownerName, storeName, trialDays = 3 }) {
        const appUrl = process.env.APP_URL || 'https://app.mubhirbot.com';
        const title = `بدء التجربة المجانية (${trialDays} أيام) — مبهر AI`;

        const contentHtml = `
            <p>أهلاً بك في مبهر AI! 🎉</p>
            <p>تم تفعيل تجربتك المجانية بنجاح لمدة <strong>${trialDays} أيام</strong> لمتجر <strong>${storeName || ''}</strong>.</p>
            <p>يمكنك الآن ربط رقم الواتساب وتدريب الرد الآلي الذكي لبدء استقبال المحادثات وزيادة مبيعات متجرك.</p>
        `;

        const promoBlockHtml = `
            🚀 <strong>نصيحة لبدء سريع:</strong> قم بتفعيل سيكونس السلات المتروكة فور ربط الواتساب لاستعادة المبيعات المفقودة تلقائياً.
        `;

        const html = this.renderMubhirEmailLayout({
            title,
            contentHtml,
            ctaText: 'الدخول إلى لوحة التحكم',
            ctaUrl: `${appUrl}/dashboard`,
            promoBlockHtml,
            isSecurityAlert: false
        });

        return this.dispatchEmail({ to, subject: title, html, action: 'TRIAL_STARTED' });
    }

    // 4. Trial Ending Email (Warning — No Promo)
    async sendTrialEndingEmail({ to, ownerName, storeName, daysLeft = 1 }) {
        const appUrl = process.env.APP_URL || 'https://app.mubhirbot.com';
        const title = `تنبيه: متبقي يوم واحد على انتهاء التجربة المجانية — مبهر AI`;

        const contentHtml = `
            <p>تنبيه انتهاء التجربة المجانية ⏳</p>
            <p>متبقي يوم واحد فقط على انتهاء التجربة المجانية لمتجر <strong>${storeName || ''}</strong>.</p>
            <p>لتجنب انقطاع الرد الآلي الذكي والحملات، يرجى تأكيد باقة اشتراكك من صفحة الفوترة.</p>
        `;

        const html = this.renderMubhirEmailLayout({
            title,
            contentHtml,
            ctaText: 'إدارة الاشتراك والفوترة',
            ctaUrl: `${appUrl}/billing`,
            isSecurityAlert: true
        });

        return this.dispatchEmail({ to, subject: title, html, action: 'TRIAL_ENDING' });
    }

    // 5. Trial Expired Email (Billing Expired — No Promo)
    async sendTrialExpiredEmail({ to, ownerName, storeName }) {
        const appUrl = process.env.APP_URL || 'https://app.mubhirbot.com';
        const title = `انتهت فترة التجربة المجانية — مبهر AI`;

        const contentHtml = `
            <p>انتهت فترة التجربة المجانية 🔔</p>
            <p>انتهت تجاربك المجانية لمتجر <strong>${storeName || ''}</strong>.</p>
            <p>اشترك الآن في إحدى باقات مبهر لاستعادة خدمات الرد الآلي وإرسال الحملات التسويقية.</p>
        `;

        const html = this.renderMubhirEmailLayout({
            title,
            contentHtml,
            ctaText: 'تفعيل الاشتراك الآن',
            ctaUrl: `${appUrl}/billing`,
            isSecurityAlert: true
        });

        return this.dispatchEmail({ to, subject: title, html, action: 'TRIAL_EXPIRED' });
    }

    // 6. Payment Success Email (Payment — Promotional Block Allowed)
    async sendPaymentSuccessEmail({ to, ownerName, storeName, amount, planName }) {
        const appUrl = process.env.APP_URL || 'https://app.mubhirbot.com';
        const title = `تأكيد نجاح عملية الدفع — مبهر AI`;

        const contentHtml = `
            <p>تمت عملية الدفع بنجاح ✅</p>
            <p>شكراً لك! تم تجديد اشتراك متجر <strong>${storeName || ''}</strong> بنجاح في باقة <strong>${planName || 'الأساسية'}</strong>.</p>
            <p>المبلغ المدفوع: <strong>${amount || ''} ر.س</strong>.</p>
        `;

        const promoBlockHtml = `
            ✨ <strong>ميزة جديدة:</strong> يمكنك الآن استيراد قائمة زبائنك وإطلاق حملات تسويقية مستهدفة بنقرة واحدة من الداشبورد.
        `;

        const html = this.renderMubhirEmailLayout({
            title,
            contentHtml,
            ctaText: 'فتح لوحة التحكم',
            ctaUrl: `${appUrl}/dashboard`,
            promoBlockHtml,
            isSecurityAlert: false
        });

        return this.dispatchEmail({ to, subject: title, html, action: 'PAYMENT_SUCCESS' });
    }

    // 7. Payment Failed Email (Security/Billing Alert — No Promo)
    async sendPaymentFailedEmail({ to, ownerName, storeName, planName }) {
        const appUrl = process.env.APP_URL || 'https://app.mubhirbot.com';
        const title = `تنبيه: فشل عملية الدفع — مبهر AI`;

        const contentHtml = `
            <p>تعذر إتمام عملية الدفع ⚠️</p>
            <p>تعذر الخصم التلقائي لاشتراك متجر <strong>${storeName || ''}</strong> في باقة <strong>${planName || ''}</strong>.</p>
            <p>يرجى تحديث وسيلة الدفع المسجلة لتجنب إيقاف الخدمة.</p>
        `;

        const html = this.renderMubhirEmailLayout({
            title,
            contentHtml,
            ctaText: 'تحديث وسيلة الدفع',
            ctaUrl: `${appUrl}/billing`,
            isSecurityAlert: true
        });

        return this.dispatchEmail({ to, subject: title, html, action: 'PAYMENT_FAILED' });
    }

    // 8. QR Disconnected Email (Critical Alert — No Promo & Grace Period)
    async sendQRDisconnectedEmail({ to, ownerName, storeName, isSustained = false }) {
        if (!isSustained) {
            console.log(`[EmailService IGNORE] Transient QR disconnect for store ${storeName}. Email suppressed.`);
            return { sent: false, suppressed: true, reason: 'transient_disconnect' };
        }

        const appUrl = process.env.APP_URL || 'https://app.mubhirbot.com';
        const displayStoreName = this.formatStoreDisplayName(storeName);
        const title = `تنبيه هام: انقطاع اتصال الواتساب — ${displayStoreName}`;

        const contentHtml = `
            <p>انقطاع اتصال واتساب ⚠️</p>
            <p>تم إغلاق أو انقطاع جلسة الواتساب الخاصة بـ <strong>${displayStoreName}</strong>.</p>
            <p>يرجى مسح رمز QR الجديد من لوحة التحكم لاستعادة الرد الآلي والحملات.</p>
        `;

        const html = this.renderMubhirEmailLayout({
            title,
            contentHtml,
            ctaText: 'إعادة ربط الواتساب الآن',
            ctaUrl: `${appUrl}/dashboard`,
            isSecurityAlert: true
        });

        return this.dispatchEmail({ to, subject: title, html, action: 'QR_DISCONNECTED' });
    }

    // 9. QR Restored Email (Success Alert — No Promo)
    async sendQRRestoredEmail({ to, ownerName, storeName }) {
        const appUrl = process.env.APP_URL || 'https://app.mubhirbot.com';
        const title = `تم استعادة اتصال الواتساب بنجاح — متجر ${storeName || ''}`;

        const contentHtml = `
            <p>تم استعادة الاتصال ✅</p>
            <p>تمت إعادة ربط واتساب متجر <strong>${storeName || ''}</strong> بنجاح. البوت الذكي يعمل الآن بكفاءة عالية.</p>
        `;

        const html = this.renderMubhirEmailLayout({
            title,
            contentHtml,
            ctaText: 'فتح لوحة التحكم',
            ctaUrl: `${appUrl}/dashboard`,
            isSecurityAlert: false
        });

        return this.dispatchEmail({ to, subject: title, html, action: 'QR_RESTORED' });
    }
}

module.exports = new SystemEmailService();
