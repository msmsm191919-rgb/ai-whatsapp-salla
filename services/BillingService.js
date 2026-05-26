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
}

module.exports = new BillingService();
