const nodemailer = require('nodemailer');
const fs = require('fs');
const path = require('path');
const SallaDatabase = require('../database/db_instance');

class MailService {
    constructor() {
        this.transporter = null;
        this.initTransporter();
    }

    initTransporter() {
        const host = process.env.SMTP_HOST;
        const port = process.env.SMTP_PORT || 587;
        const user = process.env.SMTP_USER;
        const pass = process.env.SMTP_PASS;

        if (host && user && pass) {
            this.transporter = nodemailer.createTransport({
                host,
                port: Number(port),
                secure: Number(port) === 465,
                auth: { user, pass }
            });
            console.log(`✉️ [MailService] SMTP Transporter configured for ${host}:${port}`);
        } else {
            console.log(`✉️ [MailService] SMTP credentials missing. Running in fallback mode.`);
        }
    }

    async sendWelcomeEmail({ tenantId, recipient, storeName, ownerName, loginUrl }) {
        const subject = `مرحباً بك في مبهر AI - تم ربط متجرك بنجاح 🚀`;
        const text = `أهلاً ${ownerName || 'عزيزي التاجر'}،\n\n` +
            `تهانينا! تم تثبيت تطبيق مبهر AI وربط متجرك (${storeName}) بنجاح.\n\n` +
            `الخطوة التالية هي الدخول إلى لوحة التحكم الخاصة بك وتفعيل الربط مع واتساب للبدء في الرد على عملائك تلقائياً بالذكاء الاصطناعي.\n\n` +
            `رابط الدخول الآمن للوحة التحكم (صالح لمرة واحدة ولمدة 15 دقيقة):\n` +
            `${loginUrl}\n\n` +
            `إذا واجهت أي مشكلة أو كان لديك استفسار، يسعدنا تواصلك مع فريق الدعم الفني:\n` +
            `- البريد الإلكتروني: mubhirbot@gmail.com\n` +
            `- واتساب: https://wa.me/${process.env.SUPPORT_WHATSAPP_NUMBER || '966501577963'}\n\n` +
            `مرحباً بك مجدداً في مبهر AI!\n`;

        const html = `
            <div dir="rtl" style="font-family: Arial, sans-serif; line-height: 1.6; color: #334155; padding: 20px; max-width: 600px; margin: 0 auto; border: 1px solid #e2e8f0; border-radius: 12px; background-color: #ffffff;">
                <div style="text-align: center; margin-bottom: 24px;">
                    <h2 style="color: #7b2ff7; margin: 0;">مبهر AI ✨</h2>
                    <p style="font-size: 14px; color: #64748b; margin-top: 4px;">مساعدك الذكي لإدارة حملات ورسائل واتساب لمتجرك</p>
                </div>
                <hr style="border: 0; border-top: 1px solid #e2e8f0; margin-bottom: 24px;">
                <p>أهلاً <strong>${ownerName || 'عزيزي التاجر'}</strong>،</p>
                <p>تهانينا! تم تثبيت تطبيق <strong>مبهر AI</strong> وربط متجرك (<strong>${storeName}</strong>) بنجاح.</p>
                <p>الخطوة التالية هي الدخول إلى لوحة التحكم وتفعيل الربط مع واتساب للبدء في أتمتة الردود والذكاء الاصطناعي لعملائك.</p>
                
                <div style="text-align: center; margin: 32px 0;">
                    <a href="${loginUrl}" style="background-color: #7b2ff7; color: #ffffff; text-decoration: none; padding: 12px 28px; font-weight: bold; border-radius: 8px; display: inline-block; box-shadow: 0 4px 6px -1px rgba(123, 47, 247, 0.1);">الدخول إلى لوحة التحكم مباشرة</a>
                    <p style="font-size: 11px; color: #ef4444; margin-top: 8px;">💡 الرابط صالح للاستخدام مرة واحدة فقط وينتهي بعد 15 دقيقة.</p>
                </div>

                <hr style="border: 0; border-top: 1px solid #e2e8f0; margin: 24px 0;">
                <p style="font-size: 13px; color: #64748b; margin-bottom: 4px;">الدعم الفني والمساندة:</p>
                <ul style="font-size: 13px; color: #64748b; padding-right: 20px; margin-top: 0;">
                    <li>البريد الإلكتروني: <a href="mailto:mubhirbot@gmail.com" style="color: #7b2ff7;">mubhirbot@gmail.com</a></li>
                    <li>واتساب: <a href="https://wa.me/${process.env.SUPPORT_WHATSAPP_NUMBER || '966501577963'}" style="color: #7b2ff7;">اضغط هنا للمراسلة</a></li>
                </ul>
                <p style="font-size: 12px; color: #94a3b8; text-align: center; margin-top: 32px;">جميع الحقوق محفوظة © 2026 مبهر AI</p>
            </div>
        `;

        const db = SallaDatabase.connection;
        if (!db) {
            console.error(`❌ [MailService] Database not connected. Cannot save Outbox.`);
            return;
        }

        // 1. Find or create the outbox record (idempotency by tenant_id + template)
        const [outbox, created] = await db.models.EmailOutbox.findOrCreate({
            where: { tenant_id: tenantId, template: 'salla_welcome' },
            defaults: {
                recipient,
                status: 'pending',
                attempts: 0
            }
        });

        if (!created && outbox.status === 'sent') {
            console.log(`⚠️ [MailService] Welcome email already sent for tenant ${tenantId}. Ignoring duplicate.`);
            return;
        }

        // 2. Perform Send
        let success = false;
        let lastError = null;

        if (this.transporter) {
            try {
                await this.transporter.sendMail({
                    from: `"مبهر AI" <${process.env.SMTP_FROM || process.env.SMTP_USER}>`,
                    to: recipient,
                    subject,
                    text,
                    html
                });
                success = true;
            } catch (err) {
                lastError = err.message;
            }
        } else {
            lastError = "SMTP credentials missing";
        }

        // 3. Update Database & Logs
        const isProd = process.env.NODE_ENV === 'production';
        if (success) {
            await outbox.update({
                status: 'sent',
                attempts: outbox.attempts + 1,
                sent_at: new Date()
            });
            console.log(`✉️ [MailService] Welcome email sent successfully to ${recipient}`);
        } else {
            const finalStatus = outbox.attempts >= 3 ? 'failed' : 'pending';
            await outbox.update({
                status: finalStatus,
                attempts: outbox.attempts + 1,
                last_error_redacted: lastError.slice(0, 500)
            });

            console.error(`❌ [MailService] Failed to send email to tenant ${tenantId}: ${lastError}`);

            if (!isProd) {
                // Staging/Dev: Write to emails.log for developer testing
                const logDir = path.join(process.cwd(), 'logs');
                if (!fs.existsSync(logDir)) {
                    fs.mkdirSync(logDir, { recursive: true });
                }
                const logPath = path.join(logDir, 'emails.log');
                const entry = `\n============================================================\n` +
                    `Timestamp: ${new Date().toISOString()}\n` +
                    `Tenant ID: ${tenantId}\n` +
                    `To: ${recipient}\n` +
                    `Subject: ${subject}\n` +
                    `Body:\n${text}` +
                    `============================================================\n`;
                fs.appendFileSync(logPath, entry, 'utf8');
                console.log(`✉️ [MailService] Staging preview written to logs/emails.log`);
            } else {
                console.log(`✉️ [MailService] Production fallback: login token details hidden from application logs.`);
            }
        }
    }
}

module.exports = new MailService();
