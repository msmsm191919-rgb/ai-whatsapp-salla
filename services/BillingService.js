const SallaDatabase = require('../database/db_instance');

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
     * إنشاء رابط دفع (محاكاة حالياً)
     */
    /**
     * @deprecated Billing is handled by Salla App Store.
     * This method is no longer needed as we don't process payments directly.
     */
    async createCheckout(tenantId, planId, billingPeriod) {
        // Salla handles billing. We just wait for the webhook.
        console.log("Billing is managed by Salla Store.");
        return null;
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
