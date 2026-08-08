const crypto = require('crypto');
const SallaDatabase = require('../database/db_instance');
const PlatformRegistry = require('./platforms');
const { GLOBAL_TRIAL_DAYS } = require('./planGate');
const EmailService = require('./EmailService');

function hashPassword(password) {
    if (!password) return null;
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = crypto.pbkdf2Sync(password, salt, 10000, 64, 'sha512').toString('hex');
    return `${salt}:${hash}`;
}

function verifyPassword(password, storedHash) {
    if (!password || !storedHash || !storedHash.includes(':')) return false;
    const [salt, originalHash] = storedHash.split(':');
    const hash = crypto.pbkdf2Sync(password, salt, 10000, 64, 'sha512').toString('hex');
    try {
        return crypto.timingSafeEqual(Buffer.from(hash, 'utf8'), Buffer.from(originalHash, 'utf8'));
    } catch (e) {
        return false;
    }
}

class ConnectService {

    get db() { return SallaDatabase.connection; }

    hashPassword(p) { return hashPassword(p); }
    verifyPassword(p, h) { return verifyPassword(p, h); }
    static hashPassword(p) { return hashPassword(p); }
    static verifyPassword(p, h) { return verifyPassword(p, h); }

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
            password, authorization // Zid extra
        } = tokenData;

        if (!store_id) throw new Error('store_id missing from token data');

        // 1. ابحث عن tenant بنفس (platform + store_id)
        let tenant = await this.db.models.Tenant.findOne({
            where: { platform, platform_store_id: String(store_id) }
        });
        let created = false;

        if (!tenant && platform === 'standalone') {
            if (email) {
                tenant = await this.db.models.Tenant.findOne({ where: { email: email.trim().toLowerCase() } });
            }
            if (!tenant && store_name && store_name.trim().includes('محتوى بلس')) {
                tenant = await this.db.models.Tenant.findByPk(41);
            }
        } else if (!tenant && platform === 'salla') {
            const numericId = Number(store_id);
            if (!Number.isNaN(numericId)) {
                tenant = await this.db.models.Tenant.findOne({
                    where: { salla_merchant_id: numericId }
                });
            }
        }

        // إغلاق ثغرة الانتحال: إذا كان الحساب المستقل موجوداً مسبقاً، يلزم التحقق من كلمة المرور
        if (tenant && platform === 'standalone') {
            if (tenant.password_hash) {
                if (!password || !verifyPassword(password, tenant.password_hash)) {
                    throw new Error('بيانات الدخول غير صحيحة. يرجى إدخال كلمة المرور الصحيحة لحسابك.');
                }
            } else if (password) {
                // تعيين كلمة المرور لأول مرة للحسابات المستقلة القديمة
                await tenant.update({ password_hash: hashPassword(password) });
            }
        }

        if (!tenant) {
            let sallaMerchantId = null;
            if (platform === 'salla') {
                sallaMerchantId = Number(store_id);
            } else {
                sallaMerchantId = Math.floor(100000000 + Math.random() * 900000000);
            }

            const verificationToken = crypto.randomBytes(32).toString('hex');
            const tokenExpiry = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 Hours

            tenant = await this.db.models.Tenant.create({
                platform,
                platform_store_id: String(store_id),
                salla_merchant_id: sallaMerchantId,
                store_name: store_name || 'متجر جديد',
                owner_name: owner_name || null,
                store_domain,
                email: email ? email.trim().toLowerCase() : null,
                contact_email: email ? email.trim().toLowerCase() : null,
                contact_phone,
                password_hash: password ? hashPassword(password) : null,
                is_email_verified: false,
                email_verification_token: verificationToken,
                email_verification_expires_at: tokenExpiry,
                status: 'active',
                settings: {}
            });
            created = true;

            if (email) {
                await EmailService.sendVerificationEmail({
                    to: email,
                    token: verificationToken,
                    ownerName: owner_name || store_name,
                    storeName: store_name
                });
            }
        } else {
            await tenant.update({
                platform,
                platform_store_id: String(store_id),
                store_name: store_name || tenant.store_name,
                owner_name: owner_name || tenant.owner_name,
                store_domain: store_domain || tenant.store_domain,
                email: email ? email.trim().toLowerCase() : tenant.email,
                contact_email: email ? email.trim().toLowerCase() : tenant.contact_email,
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
                // Bridge: Standalone uses GLOBAL_TRIAL_DAYS (3 days), Salla respects Salla Portal trial duration (7 days)
                const trialDays = platform === 'standalone' ? GLOBAL_TRIAL_DAYS : 7;
                await this.db.models.Subscription.create({
                    tenant_id: tenant.id,
                    plan_id: basicPlan.id,
                    status: 'trial',
                    is_yearly: false,
                    start_date: new Date(),
                    end_date: new Date(Date.now() + trialDays * 24 * 60 * 60 * 1000)
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
