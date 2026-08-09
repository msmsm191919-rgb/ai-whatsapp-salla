// services/EmailService.js
// Production Transactional Email Service & Clean Light Branded Design System for Mubhir AI

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

    formatStoreDisplayName(name) {
        if (!name) return 'مبهر';
        return name.trim();
    }

    /**
     * 🎨 Centralized Branded Email Layout Engine — CLEAN LIGHT EMAIL THEME
     * Outer background: #F8FAFC | Card: #FFFFFF | Headings: #0F172A | Body: #334155 | Border: #E2E8F0
     */
    renderMubhirEmailLayout({
        title,
        contentHtml,
        ctaText,
        ctaUrl,
        fallbackText = 'فتح الرابط المباشر',
        secondaryHtml = '',
        promoBlockHtml = '',
        isSecurityAlert = false
    }) {
        const appUrl = process.env.APP_URL || 'https://app.mubhirbot.com';

        // Optional promotional block (light Mubhir teal tint background)
        const renderPromo = (!isSecurityAlert && promoBlockHtml) ? `
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin-top:24px;background-color:#f0fdfa;border:1px solid #ccfbf1;border-radius:12px;padding:16px;">
                <tr>
                    <td dir="rtl" style="font-family:'Cairo',Arial,sans-serif;font-size:13px;line-height:1.6;color:#0f766e;">
                        ${promoBlockHtml}
                    </td>
                </tr>
            </table>
        ` : '';

        // Primary CTA Button (Mubhir Teal Gradient) + Secure Anchor Fallback
        const renderCTA = (ctaText && ctaUrl) ? `
            <table role="presentation" cellspacing="0" cellpadding="0" style="margin:28px 0 16px 0;">
                <tr>
                    <td align="center" style="border-radius:12px;background:linear-gradient(135deg,#0d9488 0%,#14b8a6 100%);">
                        <a href="${ctaUrl}" target="_blank" style="font-family:'Cairo',Arial,sans-serif;font-size:16px;font-weight:bold;color:#ffffff;text-decoration:none;padding:14px 28px;border-radius:12px;display:inline-block;border:1px solid rgba(255,255,255,0.2);line-height:24px;">
                            ${ctaText}
                        </a>
                    </td>
                </tr>
            </table>
            <p dir="rtl" style="font-family:'Cairo',Arial,sans-serif;font-size:12px;color:#64748b;margin-top:12px;">
                إذا لم يعمل الزر أعلاه، اضغط على الرابط البديل التالي:<br>
                <a href="${ctaUrl}" style="color:#0d9488;text-decoration:underline;font-weight:bold;">${fallbackText}</a>
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
            <body style="margin:0;padding:0;background-color:#f8fafc;font-family:'Cairo',Arial,sans-serif;-webkit-font-smoothing:antialiased;">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color:#f8fafc;padding:32px 16px;">
                    <tr>
                        <td align="center">
                            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;background-color:#ffffff;border:1px solid #e2e8f0;border-radius:16px;overflow:hidden;box-shadow:0 4px 12px rgba(15,23,42,0.05);">
                                
                                <!-- OFFICIAL BRAND HEADER -->
                                <tr>
                                    <td style="padding:20px 28px;background-color:#f8fafc;border-bottom:1px solid #e2e8f0;">
                                        <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                                            <tr>
                                                <td dir="rtl" align="right" style="font-family:'Cairo',Arial,sans-serif;">
                                                    <a href="${appUrl}" target="_blank" style="text-decoration:none;">
                                                        <img src="${appUrl}/images/logo.png" alt="مبهر AI" width="130" style="display:inline-block;max-width:140px;height:auto;border:0;outline:none;" />
                                                    </a>
                                                </td>
                                            </tr>
                                        </table>
                                    </td>
                                </tr>

                                <!-- BODY CONTENT -->
                                <tr>
                                    <td dir="rtl" style="padding:28px;font-family:'Cairo',Arial,sans-serif;text-align:right;">
                                        <h1 style="margin:0 0 16px 0;font-size:20px;font-weight:800;color:#0f172a;line-height:1.4;">
                                            ${title}
                                        </h1>
                                        <div style="font-size:14px;line-height:1.7;color:#334155;">
                                            ${contentHtml}
                                        </div>
                                        
                                        ${renderCTA}

                                        ${secondaryHtml ? `<div style="margin-top:20px;font-size:13px;color:#64748b;">${secondaryHtml}</div>` : ''}

                                        ${renderPromo}
                                    </td>
                                </tr>

                                <!-- FOOTER -->
                                <tr>
                                    <td dir="rtl" style="padding:24px 28px;background-color:#f8fafc;border-top:1px solid #e2e8f0;text-align:center;font-family:'Cairo',Arial,sans-serif;">
                                        <p style="margin:0 0 12px 0;font-size:12px;color:#64748b;line-height:1.5;">
                                            مبهر AI — المنصة الذكية لأتمتة التسويق عبر واتساب والمبيعات في المملكة العربية السعودية
                                        </p>
                                        <div style="font-size:12px;color:#64748b;">
                                            <a href="${appUrl}" style="color:#0d9488;text-decoration:none;margin:0 8px;font-weight:bold;">الموقع الرسمي</a> •
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

    // 1. Email Verification (Light Theme, Secure Anchor Fallback — No Promo)
    async sendVerificationEmail({ to, token, ownerName, storeName }) {
        const appUrl = process.env.APP_URL || 'https://app.mubhirbot.com';
        const verifyUrl = `${appUrl}/auth/standalone/verify-email?token=${encodeURIComponent(token)}`;
        const displayStoreName = this.formatStoreDisplayName(storeName);
        const title = `تأكيد بريدك الإلكتروني`;

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
            fallbackText: 'فتح رابط تأكيد البريد',
            secondaryHtml: 'ملاحظة: هذا الرابط صالح لمدة 24 ساعة فقط لضمان أمان حسابك.',
            isSecurityAlert: true
        });

        return this.dispatchEmail({ to, subject: `${title} — ${displayStoreName}`, html, action: 'VERIFICATION' });
    }

    // 2. Password Reset Email (Light Theme, Secure Anchor Fallback — No Promo)
    async sendPasswordResetEmail({ to, token, ownerName }) {
        const appUrl = process.env.APP_URL || 'https://app.mubhirbot.com';
        const resetUrl = `${appUrl}/auth/standalone/reset-password?token=${encodeURIComponent(token)}`;
        const title = `إعادة تعيين كلمة المرور`;

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
            fallbackText: 'فتح رابط إعادة تعيين كلمة المرور',
            secondaryHtml: 'ملاحظة: الرابط صالح لمدة ساعة واحدة فقط لمرة واحدة.',
            isSecurityAlert: true
        });

        return this.dispatchEmail({ to, subject: `${title} — مبهر AI`, html, action: 'PASSWORD_RESET' });
    }

    // 3. Trial Started Email (Light Theme — Promotional Block Allowed)
    async sendTrialStartedEmail({ to, ownerName, storeName, trialDays = 3 }) {
        const appUrl = process.env.APP_URL || 'https://app.mubhirbot.com';
        const displayStoreName = this.formatStoreDisplayName(storeName);
        const title = `بدء التجربة المجانية`;

        const contentHtml = `
            <p>أهلاً بك في مبهر AI! 🎉</p>
            <p>تم تفعيل تجربتك المجانية بنجاح لمدة <strong>${trialDays} أيام</strong> لـ <strong>${displayStoreName}</strong>.</p>
            <p>يمكنك الآن ربط رقم الواتساب وتدريب الرد الآلي الذكي لبدء استقبال المحادثات وزيادة المبيعات.</p>
        `;

        const promoBlockHtml = `
            🚀 <strong>نصيحة لبدء سريع:</strong> قم بتفعيل سيكونس السلات المتروكة فور ربط الواتساب لاستعادة المبيعات المفقودة تلقائياً.
        `;

        const html = this.renderMubhirEmailLayout({
            title,
            contentHtml,
            ctaText: 'الدخول إلى لوحة التحكم',
            ctaUrl: `${appUrl}/dashboard`,
            fallbackText: 'فتح لوحة التحكم',
            promoBlockHtml,
            isSecurityAlert: false
        });

        return this.dispatchEmail({ to, subject: `${title} (${trialDays} أيام) — ${displayStoreName}`, html, action: 'TRIAL_STARTED' });
    }

    // 4. Trial Ending Email (Light Theme, Warning Accent — No Promo)
    async sendTrialEndingEmail({ to, ownerName, storeName, daysLeft = 1 }) {
        const appUrl = process.env.APP_URL || 'https://app.mubhirbot.com';
        const displayStoreName = this.formatStoreDisplayName(storeName);
        const title = `تنبيه: متبقي يوم على انتهاء التجربة`;

        const contentHtml = `
            <p style="color:#d97706;font-weight:bold;">تنبيه انتهاء التجربة المجانية ⏳</p>
            <p>متبقي يوم واحد فقط على انتهاء التجربة المجانية لـ <strong>${displayStoreName}</strong>.</p>
            <p>لتجنب انقطاع الرد الآلي الذكي والحملات، يرجى تأكيد باقة اشتراكك من صفحة الفوترة.</p>
        `;

        const html = this.renderMubhirEmailLayout({
            title,
            contentHtml,
            ctaText: 'إدارة الاشتراك والفوترة',
            ctaUrl: `${appUrl}/billing`,
            fallbackText: 'فتح صفحة الفوترة',
            isSecurityAlert: true
        });

        return this.dispatchEmail({ to, subject: `${title} — ${displayStoreName}`, html, action: 'TRIAL_ENDING' });
    }

    // 5. Trial Expired Email (Light Theme, Red Warning — No Promo)
    async sendTrialExpiredEmail({ to, ownerName, storeName }) {
        const appUrl = process.env.APP_URL || 'https://app.mubhirbot.com';
        const displayStoreName = this.formatStoreDisplayName(storeName);
        const title = `انتهت فترة التجربة المجانية`;

        const contentHtml = `
            <p style="color:#dc2626;font-weight:bold;">انتهت فترة التجربة المجانية 🔔</p>
            <p>انتهت تجاربك المجانية لـ <strong>${displayStoreName}</strong>.</p>
            <p>اشترك الآن في إحدى باقات مبهر لاستعادة خدمات الرد الآلي وإرسال الحملات التسويقية.</p>
        `;

        const html = this.renderMubhirEmailLayout({
            title,
            contentHtml,
            ctaText: 'تفعيل الاشتراك الآن',
            ctaUrl: `${appUrl}/billing`,
            fallbackText: 'فتح صفحة الفوترة',
            isSecurityAlert: true
        });

        return this.dispatchEmail({ to, subject: `${title} — ${displayStoreName}`, html, action: 'TRIAL_EXPIRED' });
    }

    // 6. Payment Success Email (Light Theme, Clean Light Summary Card)
    async sendPaymentSuccessEmail({ to, ownerName, storeName, amount, planName }) {
        const appUrl = process.env.APP_URL || 'https://app.mubhirbot.com';
        const displayStoreName = this.formatStoreDisplayName(storeName);
        const title = `تمت عملية الدفع بنجاح`;
        const todayDate = new Date().toLocaleDateString('ar-SA', { year: 'numeric', month: 'long', day: 'numeric' });

        const contentHtml = `
            <p style="color:#059669;font-weight:bold;">شكراً لك ${ownerName || ''} ✅</p>
            <p>تم تجديد اشتراك <strong>${displayStoreName}</strong> بنجاح في منصة مبهر AI.</p>
            
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:20px 0;background-color:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:16px;">
                <tr>
                    <td dir="rtl" style="font-family:'Cairo',Arial,sans-serif;font-size:13px;color:#334155;line-height:2;">
                        <strong style="color:#0d9488;">📋 ملخص المعاملة:</strong><br>
                        • <strong>الباقة:</strong> ${planName || 'الأساسية'}<br>
                        • <strong>المبلغ المدفوع:</strong> ${amount || '149'} ر.س<br>
                        • <strong>حالة الدفع:</strong> مكتمل ✅<br>
                        • <strong>تاريخ الدفع:</strong> ${todayDate}
                    </td>
                </tr>
            </table>
        `;

        const promoBlockHtml = `
            ✨ <strong>ميزة جديدة:</strong> يمكنك الآن استيراد <strong>قائمة عملائك</strong> وإطلاق حملات تسويقية مستهدفة بنقرة واحدة من <strong>لوحة التحكم</strong>.
        `;

        const html = this.renderMubhirEmailLayout({
            title,
            contentHtml,
            ctaText: 'فتح لوحة التحكم',
            ctaUrl: `${appUrl}/dashboard`,
            fallbackText: 'فتح لوحة التحكم',
            promoBlockHtml,
            isSecurityAlert: false
        });

        return this.dispatchEmail({ to, subject: `${title} — ${displayStoreName}`, html, action: 'PAYMENT_SUCCESS' });
    }

    // 7. Payment Failed Email (Light Theme, Red Alert — No Promo)
    async sendPaymentFailedEmail({ to, ownerName, storeName, planName }) {
        const appUrl = process.env.APP_URL || 'https://app.mubhirbot.com';
        const displayStoreName = this.formatStoreDisplayName(storeName);
        const title = `فشلت عملية الدفع`;

        const contentHtml = `
            <p style="color:#dc2626;font-weight:bold;">تعذر إتمام عملية الدفع ⚠️</p>
            <p>تعذر الخصم التلقائي لاشتراك <strong>${displayStoreName}</strong> في باقة <strong>${planName || 'الأساسية'}</strong>.</p>
            <p>يرجى تحديث وسيلة الدفع المسجلة لتجنب إيقاف الخدمة.</p>
        `;

        const html = this.renderMubhirEmailLayout({
            title,
            contentHtml,
            ctaText: 'تحديث وسيلة الدفع',
            ctaUrl: `${appUrl}/billing`,
            fallbackText: 'فتح صفحة الفوترة',
            isSecurityAlert: true
        });

        return this.dispatchEmail({ to, subject: `${title} — ${displayStoreName}`, html, action: 'PAYMENT_FAILED' });
    }

    // 8. QR Disconnected Email (Light Theme, Critical Amber/Red Alert — No Promo & Grace Period)
    async sendQRDisconnectedEmail({ to, ownerName, storeName, isSustained = false }) {
        if (!isSustained) {
            console.log(`[EmailService IGNORE] Transient QR disconnect for store ${storeName}. Email suppressed.`);
            return { sent: false, suppressed: true, reason: 'transient_disconnect' };
        }

        const appUrl = process.env.APP_URL || 'https://app.mubhirbot.com';
        const displayStoreName = this.formatStoreDisplayName(storeName);
        const title = `انقطع اتصال واتساب`;

        const contentHtml = `
            <p style="color:#dc2626;font-weight:bold;">انقطاع اتصال واتساب ⚠️</p>
            <p>تم إغلاق أو انقطاع جلسة الواتساب الخاصة بـ <strong>${displayStoreName}</strong>.</p>
            <p>يرجى مسح رمز QR الجديد من لوحة التحكم لاستعادة الرد الآلي والحملات.</p>
        `;

        const html = this.renderMubhirEmailLayout({
            title,
            contentHtml,
            ctaText: 'إعادة ربط الواتساب الآن',
            ctaUrl: `${appUrl}/dashboard`,
            fallbackText: 'فتح لوحة التحكم لربط الواتساب',
            isSecurityAlert: true
        });

        return this.dispatchEmail({ to, subject: `${title} — ${displayStoreName}`, html, action: 'QR_DISCONNECTED' });
    }

    // 9. QR Restored Email (Light Theme, Emerald Success — No Promo)
    async sendQRRestoredEmail({ to, ownerName, storeName }) {
        const appUrl = process.env.APP_URL || 'https://app.mubhirbot.com';
        const displayStoreName = this.formatStoreDisplayName(storeName);
        const title = `تم استعادة اتصال الواتساب`;

        const contentHtml = `
            <p style="color:#059669;font-weight:bold;">تم استعادة الاتصال ✅</p>
            <p>تمت إعادة ربط واتساب <strong>${displayStoreName}</strong> بنجاح. البوت الذكي يعمل الآن بكفاءة عالية.</p>
        `;

        const html = this.renderMubhirEmailLayout({
            title,
            contentHtml,
            ctaText: 'فتح لوحة التحكم',
            ctaUrl: `${appUrl}/dashboard`,
            fallbackText: 'فتح لوحة التحكم',
            isSecurityAlert: false
        });

        return this.dispatchEmail({ to, subject: `${title} — ${displayStoreName}`, html, action: 'QR_RESTORED' });
    }
}

module.exports = new SystemEmailService();
