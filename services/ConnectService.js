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
            authorization // Zid extra
        } = tokenData;

        if (!store_id) throw new Error('store_id missing from token data');

        // 1. ابحث عن tenant بنفس (platform + store_id)
        let tenant = await this.db.models.Tenant.findOne({
            where: { platform, platform_store_id: String(store_id) }
        });
        let created = false;

        if (!tenant) {
            // ابحث بـ salla_merchant_id إذا كان salla (للـ legacy)
            if (platform === 'salla') {
                const numericId = Number(store_id);
                if (!Number.isNaN(numericId)) {
                    tenant = await this.db.models.Tenant.findOne({
                        where: { salla_merchant_id: numericId }
                    });
                }
            }
        }

        if (!tenant) {
            let sallaMerchantId = null;
            if (platform === 'salla') {
                sallaMerchantId = Number(store_id);
            } else {
                // توليد معرف سلة رقمي فريد ومميز للمنصة المستقلة لضمان التوافق التام مع استعلامات الداشبورد
                sallaMerchantId = Math.floor(100000000 + Math.random() * 900000000);
            }

            // أنشئ tenant جديد
            tenant = await this.db.models.Tenant.create({
                platform,
                platform_store_id: String(store_id),
                salla_merchant_id: sallaMerchantId,
                store_name: store_name || 'متجر جديد',
                store_domain,
                email,
                contact_email: email,
                contact_phone,
                status: 'active',
                settings: {}
            });
            created = true;
        } else {
            // حدّث البيانات
            await tenant.update({
                platform,
                platform_store_id: String(store_id),
                store_name: store_name || tenant.store_name,
                store_domain: store_domain || tenant.store_domain,
                email: email || tenant.email,
                contact_email: email || tenant.contact_email,
                contact_phone: contact_phone || tenant.contact_phone,
                status: 'active'
            });
        }

        // 2. احفظ الـ token (SallaOAuth model — نستخدمها بشكل generic للأن)
        if (access_token && platform !== 'standalone') {
            const tokenExpiresAt = expires_in ? new Date(Date.now() + expires_in * 1000) : null;
            const existing = await this.db.models.SallaOAuth.findOne({ where: { tenant_id: tenant.id } });
            const payload = {
                tenant_id: tenant.id,
                access_token,
                refresh_token: refresh_token || null,
                expires_at: tokenExpiresAt,
                meta: { platform, authorization } // نخزن نوع المنصة في meta
            };
            if (existing) await existing.update(payload);
            else await this.db.models.SallaOAuth.create(payload);
        }

        // 3. إذا tenant جديد، أنشئ Subscription تجريبي (Basic trial)
        if (created) {
            const basicPlan = await this.db.models.Plan.findOne({ where: { name: 'الأساسية' } });
            if (basicPlan) {
                await this.db.models.Subscription.create({
                    tenant_id: tenant.id,
                    plan_id: basicPlan.id,
                    status: 'trial',
                    is_yearly: false,
                    start_date: new Date(),
                    end_date: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) // 7 days trial
                });
            }
        }

        return { tenant, created, platform };
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
