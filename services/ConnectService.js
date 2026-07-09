// services/ConnectService.js
// Orchestrator للربط — ينشئ/يحدّث Tenant + Subscription بعد OAuth ناجح من أي منصة

const SallaDatabase = require('../database/db_instance');
const PlatformRegistry = require('./platforms');

class ConnectService {

    get db() { return SallaDatabase.connection; }

    /**
     * بعد ما تنجح عملية OAuth (أي منصة) — نسجّل التاجر في النظام
     * @param {Object} params
     * @param {string} params.platform - 'salla' | 'zid' | 'shopify' | 'standalone'
     * @param {Object} params.tokenData - من adapter.exchangeCodeForToken()
     * @returns {Promise<{tenant, created, platform}>}
     */
    async upsertTenantFromOAuth({ platform, tokenData }) {
        if (platform === 'zid' || platform === 'shopify') {
            throw new Error(`Platform ${platform} is currently disabled. Connection denied.`);
        }
        if (!PlatformRegistry.has(platform)) throw new Error(`Unknown platform: ${platform}`);

        const {
            access_token, refresh_token, expires_in,
            store_id, store_name, store_domain, email, owner_name, contact_phone,
            authorization
        } = tokenData;

        if (!store_id) throw new Error('store_id missing from token data');

        const transaction = await this.db.transaction();
        try {
            // 1. ابحث عن tenant بنفس (platform + platform_store_id)
            let tenant = await this.db.models.Tenant.findOne({
                where: { platform, platform_store_id: String(store_id) },
                transaction,
                lock: transaction.LOCK.UPDATE
            });
            let created = false;

            if (!tenant && platform === 'salla') {
                // ابحث بـ salla_merchant_id للـ legacy
                const numericId = Number(store_id);
                if (!Number.isNaN(numericId)) {
                    tenant = await this.db.models.Tenant.findOne({
                        where: { salla_merchant_id: numericId },
                        transaction,
                        lock: transaction.LOCK.UPDATE
                    });
                }
            }

            let sallaMerchantId = null;
            if (platform === 'salla') {
                sallaMerchantId = Number(store_id);
            } else {
                sallaMerchantId = Math.floor(100000000 + Math.random() * 900000000);
            }

            const cleanEmail = email && email.includes('@') ? email.trim() : null;

            if (!tenant) {
                // أنشئ tenant جديد
                tenant = await this.db.models.Tenant.create({
                    platform,
                    platform_store_id: String(store_id),
                    salla_merchant_id: sallaMerchantId,
                    store_name: store_name || 'متجر جديد',
                    store_domain,
                    email: cleanEmail,
                    contact_email: cleanEmail,
                    contact_phone,
                    status: 'active',
                    settings: {
                        billing_source: 'salla',
                        salla_integration_status: 'active',
                        welcome_email_status: cleanEmail ? 'pending' : 'missing_recipient'
                    }
                }, { transaction });
                created = true;
            } else {
                // حدّث البيانات
                const currentSettings = tenant.settings || {};
                await tenant.update({
                    platform,
                    platform_store_id: String(store_id),
                    store_name: store_name || tenant.store_name,
                    store_domain: store_domain || tenant.store_domain,
                    email: cleanEmail || tenant.email,
                    contact_email: cleanEmail || tenant.contact_email,
                    contact_phone: contact_phone || tenant.contact_phone,
                    status: 'active',
                    settings: {
                        ...currentSettings,
                        billing_source: 'salla',
                        salla_integration_status: 'active',
                        welcome_email_status: cleanEmail 
                            ? (currentSettings.welcome_email_status === 'missing_recipient' ? 'pending' : currentSettings.welcome_email_status)
                            : (currentSettings.welcome_email_status || 'missing_recipient')
                    }
                }, { transaction });
            }

            // 2. احفظ الـ token
            if (access_token && platform !== 'standalone') {
                const tokenExpiresAt = expires_in ? new Date(Date.now() + expires_in * 1000) : null;
                const existing = await this.db.models.SallaOAuth.findOne({ 
                    where: { tenant_id: tenant.id },
                    transaction 
                });
                const payload = {
                    tenant_id: tenant.id,
                    access_token,
                    refresh_token: refresh_token || null,
                    expires_at: tokenExpiresAt,
                    meta: { platform, authorization }
                };
                if (existing) await existing.update(payload, { transaction });
                else await this.db.models.SallaOAuth.create(payload, { transaction });
            }

            // 3. إذا tenant جديد، أنشئ Subscription تجريبي (Basic trial)
            if (created) {
                const basicPlan = await this.db.models.Plan.findOne({ 
                    where: { name: 'الأساسية' },
                    transaction 
                });
                if (basicPlan) {
                    await this.db.models.Subscription.create({
                        tenant_id: tenant.id,
                        plan_id: basicPlan.id,
                        status: 'trial',
                        is_yearly: false,
                        start_date: new Date(),
                        end_date: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) // 7 days trial
                    }, { transaction });
                }
            }

            // 4. توليد One-Time Secure Login Link للتاجر عند أول تثبيت فقط
            let bootstrapToken = null;
            if (created) {
                const crypto = require('crypto');
                bootstrapToken = crypto.randomBytes(32).toString('hex');
                const tokenHash = crypto.createHash('sha256').update(bootstrapToken).digest('hex');
                const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 mins

                await this.db.models.TenantLoginToken.create({
                    tenant_id: tenant.id,
                    token_hash: tokenHash,
                    purpose: 'login',
                    expires_at: expiresAt
                }, { transaction });

                // Queue welcome email in outbox
                await this.db.models.EmailOutbox.create({
                    tenant_id: tenant.id,
                    template: 'salla_welcome',
                    recipient: cleanEmail || 'missing_email',
                    status: cleanEmail ? 'pending' : 'missing_recipient',
                    attempts: 0
                }, { transaction });
            }

            await transaction.commit();

            // 5. إرسال بريد الترحيب بالخلفية خارج الـ Transaction لضمان عدم حدوث Deadlocks
            if (created && cleanEmail && bootstrapToken) {
                const MailService = require('./MailService');
                const appUrl = process.env.APP_URL;
                if (!appUrl) {
                    throw new Error('APP_URL is not configured. Cannot generate login link.');
                }
                const loginUrl = `${appUrl}/login/bootstrap#token=${bootstrapToken}`;

                MailService.sendWelcomeEmail({
                    tenantId: tenant.id,
                    recipient: cleanEmail,
                    storeName: tenant.store_name,
                    ownerName: owner_name,
                    loginUrl: loginUrl
                }).catch(err => {
                    console.error(`❌ [ConnectService] Welcome email delivery thread failed for tenant ${tenant.id}:`, err.message);
                });
            }

            return { tenant, created, platform };
        } catch (err) {
            await transaction.rollback();
            console.error(`❌ [ConnectService] Failed to upsert tenant:`, err.message);
            throw err;
        }
    }

    /**
     * يجلب tenant مع الـ adapter المناسب
     */
    async getTenantWithAdapter(tenantId) {
        const tenant = await this.db.models.Tenant.findByPk(tenantId);
        if (!tenant) return null;
        const adapter = PlatformRegistry.get(tenant.platform || 'salla');
        return { tenant, adapter };
    }
}

module.exports = new ConnectService();
