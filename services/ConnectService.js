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

    constructor() {
        this.registrationLocks = new Map();
    }

    // =========================================================================
    // Standalone Registration — Single Source of Truth
    // =========================================================================

    /**
     * تسجيل مستقل آمن — المصدر الوحيد لجميع حالات التسجيل
     * 
     * Case A: Email غير موجود → إنشاء Tenant + hash password + subscription + token + email
     * Case B: Email موجود + غير متحقق + لديه password → لا tenant جديد + token جديد + email
     * Case C: Email موجود + متحقق → رفض مع رسالة دخول
     * Case D: Email موجود + غير متحقق + بلا password → Legacy incomplete — تحديث password + token + email
     *
     * @returns {Promise<{ok, tenant_id, created, case, email_sent, error, verify_email, email}>}
     */
    async registerStandalone({ store_name, email, phone, password, owner_name }) {
        if (!email || !password) {
            return { ok: false, error: 'البريد الإلكتروني وكلمة المرور مطلوبان' };
        }
        if (!store_name) {
            return { ok: false, error: 'اسم المتجر مطلوب' };
        }

        const normalizedEmail = email.trim().toLowerCase();

        // Mutex queue per email to safely handle concurrent requests
        const lockKey = `standalone:${normalizedEmail}`;
        const previousLock = this.registrationLocks.get(lockKey) || Promise.resolve();

        let releaseLock;
        const currentLock = new Promise(resolve => { releaseLock = resolve; });
        this.registrationLocks.set(lockKey, previousLock.then(() => currentLock));

        try {
            await previousLock;
            return await this._executeRegisterStandalone({ store_name, normalizedEmail, phone, password, owner_name });
        } finally {
            releaseLock();
            if (this.registrationLocks.get(lockKey) === currentLock) {
                this.registrationLocks.delete(lockKey);
            }
        }
    }

    async _executeRegisterStandalone({ store_name, normalizedEmail, phone, password, owner_name }) {
        // ─── Lookup by platform=standalone + normalized email ───
        const existingTenant = await this.db.models.Tenant.findOne({
            where: { platform: 'standalone', email: normalizedEmail }
        });

        // ─── Case C: موجود + متحقق ───
        if (existingTenant && existingTenant.is_email_verified) {
            return {
                ok: false,
                case: 'EXISTING_VERIFIED',
                error: 'يوجد حساب بهذا البريد بالفعل، سجل الدخول أو استخدم نسيت كلمة المرور.'
            };
        }

        // ─── Case D: موجود + غير متحقق + بلا password (Legacy) ───
        if (existingTenant && !existingTenant.is_email_verified && !existingTenant.password_hash) {
            const verificationToken = crypto.randomBytes(32).toString('hex');
            const tokenExpiry = new Date(Date.now() + 24 * 60 * 60 * 1000);

            await existingTenant.update({
                password_hash: hashPassword(password),
                store_name: store_name.trim() || existingTenant.store_name,
                owner_name: owner_name || existingTenant.owner_name,
                contact_phone: phone || existingTenant.contact_phone,
                email_verification_token: verificationToken,
                email_verification_expires_at: tokenExpiry
            });

            const emailResult = await EmailService.sendVerificationEmail({
                to: normalizedEmail,
                token: verificationToken,
                ownerName: owner_name || store_name,
                storeName: existingTenant.store_name
            });

            console.log(`[standalone register] Case D (legacy incomplete): tenant_id=${existingTenant.id}, email_sent=${emailResult.sent}`);

            return {
                ok: true,
                tenant_id: existingTenant.id,
                created: false,
                case: 'LEGACY_INCOMPLETE_RECOVERED',
                email_sent: emailResult.sent,
                email_error: emailResult.error || null,
                verify_email: true,
                email: normalizedEmail
            };
        }

        // ─── Case B: موجود + غير متحقق + لديه password ───
        if (existingTenant && !existingTenant.is_email_verified && existingTenant.password_hash) {
            // لا ننشئ tenant جديداً — لا نستبدل password — لا نغير plan — نرسل verification فقط
            const verificationToken = crypto.randomBytes(32).toString('hex');
            const tokenExpiry = new Date(Date.now() + 24 * 60 * 60 * 1000);

            await existingTenant.update({
                email_verification_token: verificationToken,
                email_verification_expires_at: tokenExpiry
            });

            const emailResult = await EmailService.sendVerificationEmail({
                to: normalizedEmail,
                token: verificationToken,
                ownerName: existingTenant.owner_name || existingTenant.store_name,
                storeName: existingTenant.store_name
            });

            console.log(`[standalone register] Case B (existing unverified): tenant_id=${existingTenant.id}, email_sent=${emailResult.sent}`);

            return {
                ok: true,
                tenant_id: existingTenant.id,
                created: false,
                case: 'EXISTING_UNVERIFIED',
                email_sent: emailResult.sent,
                email_error: emailResult.error || null,
                verify_email: true,
                email: normalizedEmail
            };
        }

        // ─── Case A: Email غير موجود — إنشاء حساب جديد ───
        const storeId = `standalone_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
        const sallaMerchantId = Math.floor(100000000 + Math.random() * 900000000);
        const verificationToken = crypto.randomBytes(32).toString('hex');
        const tokenExpiry = new Date(Date.now() + 24 * 60 * 60 * 1000);

        const tenant = await this.db.models.Tenant.create({
            platform: 'standalone',
            platform_store_id: storeId,
            salla_merchant_id: sallaMerchantId,
            store_name: store_name.trim() || 'متجر جديد',
            owner_name: owner_name || store_name.trim(),
            store_domain: null,
            email: normalizedEmail,
            contact_email: normalizedEmail,
            contact_phone: phone || null,
            password_hash: hashPassword(password),
            is_email_verified: false,
            email_verification_token: verificationToken,
            email_verification_expires_at: tokenExpiry,
            status: 'active',
            settings: {}
        });

        // ─── Subscription تجريبي — Basic فقط ───
        const basicPlan = await this.db.models.Plan.findOne({ where: { name: 'الأساسية' } });
        if (basicPlan) {
            await this.db.models.Subscription.create({
                tenant_id: tenant.id,
                plan_id: basicPlan.id,
                status: 'trial',
                is_yearly: false,
                start_date: new Date(),
                end_date: new Date(Date.now() + GLOBAL_TRIAL_DAYS * 24 * 60 * 60 * 1000)
            });
        }

        // ─── Verification Email — مرة واحدة فقط ───
        const emailResult = await EmailService.sendVerificationEmail({
            to: normalizedEmail,
            token: verificationToken,
            ownerName: owner_name || store_name,
            storeName: store_name
        });

        console.log(`[standalone register] Case A (new account): tenant_id=${tenant.id}, email_sent=${emailResult.sent}`);

        return {
            ok: true,
            tenant_id: tenant.id,
            created: true,
            case: 'NEW_ACCOUNT',
            email_sent: emailResult.sent,
            email_error: emailResult.error || null,
            verify_email: true,
            email: normalizedEmail
        };
    }

    // =========================================================================
    // Resend Verification Email
    // =========================================================================

    /**
     * إعادة إرسال رابط التحقق — server-side lookup + rate limit + generic response
     * @returns {Promise<{ok, message, email_sent}>}
     */
    async resendVerificationEmail(email) {
        if (!email) {
            return { ok: false, message: 'البريد الإلكتروني مطلوب' };
        }

        const normalizedEmail = email.trim().toLowerCase();

        // Rate limit check (60 seconds)
        if (!EmailService.canSend(normalizedEmail, 'RESEND_VERIFICATION', 60000)) {
            return { ok: true, message: 'إذا كان البريد مسجلاً لدينا، تم إرسال رابط التحقق.', email_sent: false, rate_limited: true };
        }

        const tenant = await this.db.models.Tenant.findOne({
            where: { platform: 'standalone', email: normalizedEmail, is_email_verified: false }
        });

        if (!tenant) {
            // Generic response — لمنع account enumeration
            return { ok: true, message: 'إذا كان البريد مسجلاً لدينا، تم إرسال رابط التحقق.', email_sent: false };
        }

        // Token جديد — يستبدل أي token سابق
        const verificationToken = crypto.randomBytes(32).toString('hex');
        const tokenExpiry = new Date(Date.now() + 24 * 60 * 60 * 1000);

        await tenant.update({
            email_verification_token: verificationToken,
            email_verification_expires_at: tokenExpiry
        });

        const emailResult = await EmailService.sendVerificationEmail({
            to: normalizedEmail,
            token: verificationToken,
            ownerName: tenant.owner_name || tenant.store_name,
            storeName: tenant.store_name
        });

        console.log(`[resend verification] tenant_id=${tenant.id}, email_sent=${emailResult.sent}`);

        return {
            ok: true,
            message: 'إذا كان البريد مسجلاً لدينا، تم إرسال رابط التحقق.',
            email_sent: emailResult.sent,
            email_error: emailResult.error || null
        };
    }

    // =========================================================================
    // OAuth Upsert (Salla / other platforms) — لم يتغير
    // =========================================================================

    /**
     * بعد ما تنجح عملية OAuth (أي منصة) — نسجّل التاجر في النظام
     * @param {Object} params
     * @param {string} params.platform - 'salla' | 'zid' | 'shopify' | 'standalone'
     * @param {Object} params.tokenData - من adapter.exchangeCodeForToken()
     * @returns {Promise<{tenant, created, platform}>}
     */
    async upsertTenantFromOAuth({ platform, tokenData, skipSubscriptionTrial = false }) {
        if (platform === 'zid' || platform === 'shopify') {
            throw new Error(`Platform ${platform} is currently disabled. Connection denied.`);
        }
        if (!PlatformRegistry.has(platform)) throw new Error(`Unknown platform: ${platform}`);

        const {
            access_token, refresh_token, expires_in, expires_at, scope, token_type,
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
                tenant = await this.db.models.Tenant.findOne({ where: { platform: 'standalone', email: email.trim().toLowerCase() } });
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
            let tokenExpiresAt = null;
            if (expires_at instanceof Date) {
                tokenExpiresAt = expires_at;
            } else if (expires_in) {
                tokenExpiresAt = new Date(Date.now() + Number(expires_in) * 1000);
            }

            const existing = await this.db.models.SallaOAuth.findOne({ where: { tenant_id: tenant.id } });
            const payload = {
                tenant_id: tenant.id,
                access_token,
                refresh_token: refresh_token || null,
                expires_at: tokenExpiresAt,
                meta: { platform, authorization, scope: scope || null, token_type: token_type || null }
            };
            if (existing) await existing.update(payload);
            else await this.db.models.SallaOAuth.create(payload);
        }

        // 3. إذا tenant جديد، أنشئ Subscription تجريبي فقط إذا لم يتم تخطي ذلك صراحة
        if (created && !skipSubscriptionTrial) {
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
