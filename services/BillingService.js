const SallaDatabase = require('../database/db_instance');
const TapService = require('./TapService');

class BillingService {

    // Use getter to access connection dynamically to avoid "undefined" at startup
    get db() {
        return SallaDatabase.connection;
    }

    /**
     * حساب تكلفة الباقة بناءً على الفترة
     */
    async calculateTotal(planId, billingPeriod) {
        const Plan = this.db.models.Plan;
        const plan = await Plan.findByPk(planId);
        if (!plan) throw new Error("Plan not found");

        const amount = billingPeriod === 'yearly' ? plan.price_yearly : plan.price_monthly;
        return { amount, currency: 'SAR', plan };
    }

    /**
     * 🚀 إنشاء جلسة دفع Tap — يُنشئ Payment pending + Tap charge ويرجّع URL
     * @param {Object} params
     * @param {number} params.tenantId
     * @param {number} params.planId
     * @param {'monthly'|'yearly'} params.billingPeriod
     * @param {string} params.baseUrl - مثلاً https://app.mobhir.com
     * @returns {Promise<{checkoutUrl, paymentId, chargeId, mock?}>}
     */
    async initiateTapCheckout({ tenantId, planId, billingPeriod = 'monthly', baseUrl }) {
        const { amount, currency, plan } = await this.calculateTotal(planId, billingPeriod);

        const tenant = await this.db.models.Tenant.findByPk(tenantId);
        if (!tenant) throw new Error('Tenant not found');

        // 1. أنشئ Payment record بحالة pending
        const payment = await this.db.models.Payment.create({
            tenant_id: tenantId,
            plan_id: planId,
            amount,
            currency,
            status: 'pending',
            provider: 'tap',
            metadata: { billing_period: billingPeriod, plan_name: plan.name }
        });

        // 2. اتصل بـ Tap لإنشاء charge
        const customer = {
            name: tenant.store_name || 'Merchant',
            email: tenant.contact_email || tenant.email || 'merchant@mobhir.local',
            phone: tenant.contact_phone || tenant.phone || ''
        };

        const charge = await TapService.createCharge({
            amount,
            currency,
            customer,
            description: `اشتراك مبهر AI — باقة ${plan.name} (${billingPeriod === 'yearly' ? 'سنوي' : 'شهري'})`,
            metadata: {
                tenant_id: String(tenantId),
                plan_id: String(planId),
                payment_id: String(payment.id),
                billing_period: billingPeriod
            },
            redirectUrl: `${baseUrl}/billing/return`,
            postUrl: `${baseUrl}/webhook/tap`
        });

        // 3. اربط الـ provider_payment_id بالـ Payment
        payment.provider_payment_id = charge.id;
        await payment.save();

        return {
            checkoutUrl: charge.transaction?.url || charge.url,
            paymentId: payment.id,
            chargeId: charge.id,
            mock: charge.mock === true
        };
    }

    /**
     * معالجة فشل الدفع
     */
    async processPaymentFailure(providerPaymentId, reason = 'Unknown') {
        const payment = await this.db.models.Payment.findOne({
            where: { provider_payment_id: providerPaymentId }
        });
        if (!payment) return { status: 'not_found' };
        if (payment.status === 'paid') return { status: 'already_paid' };

        payment.status = 'failed';
        payment.metadata = { ...(payment.metadata || {}), failure_reason: reason };
        await payment.save();
        return { status: 'failed_recorded', payment_id: payment.id };
    }

    /**
     * معالجة نجاح الدفع (State Machine Transition)
     */
    async processPaymentSuccess(providerPaymentId) {
        const t = await this.db.transaction();

        try {
            // 1. Find Payment
            const payment = await this.db.models.Payment.findOne({
                where: { provider_payment_id: providerPaymentId },
                transaction: t
            });

            if (!payment) throw new Error("Payment not found");
            if (payment.status === 'paid') return { status: 'already_paid' };

            // 2. Update Payment Status
            payment.status = 'paid';
            await payment.save({ transaction: t });

            // 3. Update/Create Subscription
            const billingPeriod = payment.metadata.billing_period || 'monthly';
            const startDate = new Date();
            const endDate = new Date();

            if (billingPeriod === 'yearly') {
                endDate.setFullYear(endDate.getFullYear() + 1);
            } else {
                endDate.setMonth(endDate.getMonth() + 1);
            }

            const [sub, created] = await this.db.models.Subscription.findOrCreate({
                where: { tenant_id: payment.tenant_id },
                defaults: {
                    plan_id: payment.plan_id,
                    status: 'active',
                    is_yearly: billingPeriod === 'yearly',
                    start_date: startDate,
                    end_date: endDate
                },
                transaction: t
            });

            if (!created) {
                // Upgrade/Renew existing subscription
                sub.plan_id = payment.plan_id;
                sub.status = 'active';
                sub.is_yearly = billingPeriod === 'yearly';
                sub.start_date = startDate; // Reset start date on renewal? Or keep original? Usually reset cycle.
                sub.end_date = endDate;
                await sub.save({ transaction: t });
            }

            // 4. Unblock Tenant if needed
            const tenant = await this.db.models.Tenant.findByPk(payment.tenant_id, { transaction: t });
            if (tenant.status !== 'active') {
                tenant.status = 'active';
                await tenant.save({ transaction: t });
            }

            await t.commit();
            return { status: 'success', tenant_id: payment.tenant_id };

        } catch (error) {
            await t.rollback();
            throw error;
        }
    }

    /**
     * معالجة تحديث اشتراك التطبيق من ويب هوك سلة
     */
    async handleSallaSubscriptionUpdate(merchantId, sallaPlanId, sallaPlanName, subscriptionId, status, details = {}) {
        const t = await this.db.transaction();
        try {
            // 1. Verify merchantId is present
            if (!merchantId) {
                console.warn(`⚠️ [Salla Subscription] Missing merchantId`);
                await t.rollback();
                return { status: 'merchant_id_missing' };
            }

            // 2. Reject activation if status is not active or paid
            if (status !== 'active' && status !== 'paid') {
                console.warn(`⚠️ [Salla Subscription] Invalid status received: ${status} for merchant: ${merchantId}`);
                await t.rollback();
                return { status: 'invalid_status' };
            }

            // 3. Find Tenant
            const Tenant = this.db.models.Tenant;
            const tenant = await Tenant.findOne({
                where: { salla_merchant_id: merchantId },
                transaction: t
            });
            if (!tenant) {
                console.warn(`⚠️ [Salla Subscription] Tenant not found for merchant ID: ${merchantId}`);
                await t.rollback();
                return { status: 'tenant_not_found' };
            }

            // 4. Map plan using planId first, then planName fallback
            const planGate = require('./planGate');
            let planName = null;

            if (sallaPlanId) {
                planName = planGate.getPlanNameBySallaPlanId(sallaPlanId);
            }

            if (!planName && sallaPlanName) {
                planName = planGate.getPlanNameBySallaPlanName(sallaPlanName);
            }

            if (!planName) {
                console.warn(`⚠️ [Salla Subscription] Plan unrecognized (planId: '${sallaPlanId}', planName: '${sallaPlanName}') for merchant: ${merchantId}`);
                await t.rollback();
                return { status: 'plan_not_mapped' };
            }

            const Plan = this.db.models.Plan;
            const plan = await Plan.findOne({
                where: { name: planName },
                transaction: t
            });
            if (!plan) {
                console.error(`❌ [Salla Subscription] Mapped Plan '${planName}' not found in DB`);
                await t.rollback();
                return { status: 'plan_not_found' };
            }

            // 5. Calculate correct amount based on billing period (monthly vs yearly)
            const billingPeriod = details.billing_period || 'monthly';
            const amount = billingPeriod === 'yearly' ? (plan.price_yearly || 0) : (plan.price_monthly || 0);

            // 6. Record Payment
            const payment = await this.db.models.Payment.create({
                tenant_id: tenant.id,
                plan_id: plan.id,
                amount,
                currency: 'SAR',
                status: 'paid',
                provider: 'salla',
                provider_payment_id: subscriptionId || `sub_${merchantId}_${Date.now()}`,
                metadata: { salla_plan_id: sallaPlanId, event_details: details }
            }, { transaction: t });

            // 4. Update/Create Subscription
            const startDate = details.start_date ? new Date(details.start_date) : new Date();
            const endDate = details.end_date ? new Date(details.end_date) : new Date();
            if (!details.end_date) {
                if (billingPeriod === 'yearly') {
                    endDate.setFullYear(endDate.getFullYear() + 1);
                } else {
                    endDate.setMonth(endDate.getMonth() + 1);
                }
            }

            const [sub, created] = await this.db.models.Subscription.findOrCreate({
                where: { tenant_id: tenant.id },
                defaults: {
                    plan_id: plan.id,
                    status: 'active',
                    is_yearly: billingPeriod === 'yearly',
                    start_date: startDate,
                    end_date: endDate
                },
                transaction: t
            });

            if (!created) {
                sub.plan_id = plan.id;
                sub.status = 'active';
                sub.is_yearly = billingPeriod === 'yearly';
                sub.start_date = startDate;
                sub.end_date = endDate;
                await sub.save({ transaction: t });
            }

            // 5. Unblock Tenant
            if (tenant.status !== 'active') {
                tenant.status = 'active';
                await tenant.save({ transaction: t });
            }

            await t.commit();
            console.log(`✅ [Salla Subscription] Subscription updated successfully for tenant ${tenant.id} to plan ${planName}`);
            return { status: 'success', tenant_id: tenant.id, plan_name: planName };
        } catch (error) {
            await t.rollback();
            console.error('❌ [Salla Subscription] Error handling update:', error);
            throw error;
        }
    }

    /**
     * معالجة انتهاء اشتراك التطبيق من ويب هوك سلة
     */
    async handleSallaSubscriptionExpired(merchantId, subscriptionId) {
        const t = await this.db.transaction();
        try {
            const Tenant = this.db.models.Tenant;
            const tenant = await Tenant.findOne({
                where: { salla_merchant_id: merchantId },
                transaction: t
            });
            if (!tenant) {
                console.warn(`⚠️ [Salla Subscription Expired] Tenant not found for merchant ID: ${merchantId}`);
                await t.rollback();
                return { status: 'tenant_not_found' };
            }

            const Subscription = this.db.models.Subscription;
            const sub = await Subscription.findOne({
                where: { tenant_id: tenant.id },
                transaction: t
            });

            if (sub) {
                sub.status = 'expired';
                await sub.save({ transaction: t });
            }

            await t.commit();
            console.log(`⚠️ [Salla Subscription Expired] Subscription set to expired for tenant ${tenant.id}`);
            return { status: 'success', tenant_id: tenant.id };
        } catch (error) {
            await t.rollback();
            console.error('❌ [Salla Subscription Expired] Error handling expiration:', error);
            throw error;
        }
    }
}

module.exports = new BillingService();
