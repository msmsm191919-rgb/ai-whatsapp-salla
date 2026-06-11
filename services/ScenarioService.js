const SallaDatabase = require('../database/db_instance');

class ScenarioService {

    constructor() {
        this.db = SallaDatabase.connection;
    }

    /**
     * معالجة السلة المتروكة (Enhanced with AI & Tracking)
     */
    async handleAbandonedCart(webhookData) {
        try {
            console.log('🛒 Processing Abandoned Cart Scenario...');

            const merchantId = webhookData.merchant;
            const db = SallaDatabase.connection;
            if (!db) {
                console.error("❌ Database connection failed in ScenarioService");
                return;
            }

            // 1. Identify Tenant
            const tenant = await db.models.Tenant.findOne({ where: { salla_merchant_id: merchantId } });
            if (!tenant) return console.warn(`⚠️ Tenant not found for merchant ID: ${merchantId}`);

            // 1.5 Check Plan Gate
            const planGate = require('./planGate');
            const access = await planGate.checkTenantAccess(tenant.id, null, 'abandoned_cart');
            if (!access.allowed) {
                console.log(`[planGate] blocked tenant ${tenant.id} reason=${access.reason}`);
                return;
            }

            // 2. Check Settings
            const settings = tenant.settings || {};
            // If settings.abandoned_cart is undefined, default to true for testing, or check strictly
            if (settings.abandoned_cart === false) return console.log(`ℹ️ Auto-Recovery disabled for Tenant ${tenant.id}`);

            // 3. Check Limits First (Before OpenAI API generation to save costs)
            const { checkLimit, incrementUsage } = require('../helpers/limitsEngine');
            const limitCheck = await checkLimit(tenant.id, db.models, 'message', 1);

            if (!limitCheck.allowed) {
                console.warn(`⚠️ Limit Exceeded for Tenant ${tenant.id} (Current: ${limitCheck.current}, Limit: ${limitCheck.limit})`);
                return;
            }

            // 4. Extract Data
            const cartData = webhookData.data;
            const customerData = cartData.customer;
            const cartItems = cartData.items || [];
            const cartTotal = cartData.total?.amount || 0;
            const currency = cartData.currency || 'SAR'; // Default SAR
            const checkoutUrl = cartData.checkout_url || cartData.url;

            console.log(`🔍 Cart Data: Total ${cartTotal} ${currency}, Items: ${cartItems.length}`);

            // 5. Save Customer & Cart (Tracking)
            const [customer] = await db.models.Customer.findOrCreate({
                where: { tenant_id: tenant.id, phone: customerData.mobile },
                defaults: {
                    name: `${customerData.first_name || ''} ${customerData.last_name || ''}`.trim(),
                }
            });

            const [cart] = await db.models.Cart.findOrCreate({
                where: { salla_cart_id: String(cartData.id) },
                defaults: {
                    tenant_id: tenant.id,
                    customer_id: customer.id,
                    items: cartItems,
                    total_amount: cartTotal,
                    currency: currency,
                    checkout_url: checkoutUrl,
                    status: 'abandoned'
                }
            });

            // 6. Generate AI Persuasive Message
            // Extract item names safely
            const itemNames = cartItems.map(i => i.product?.name || i.name || 'منتج');

            const AIService = require('./AIService');
            let aiMessage = await AIService.generateCartRecovery(
                tenant.id,
                customer.first_name || 'عميلنا',
                `${cartTotal} ${currency}`,
                itemNames
            );

            // Append Link
            const messageWithLink = `${aiMessage}\n\n🔗 كمل طلبك من هنا:\n${checkoutUrl}`;

            // 7. Send via WhatsApp (using the Unified Router)
            const sender = require('./whatsappSender');
            const result = await sender.send(customer.phone, messageWithLink, tenant.id);

            if (result.ok) {
                // Perform usage increment and logs ONLY after successful send
                await incrementUsage(tenant.id, db.models);

                // Update Stats
                await cart.update({ status: 'recovered', recovery_attempts: (cart.recovery_attempts || 0) + 1, last_message_at: new Date() });

                await db.models.MessageLog.create({
                    tenant_id: tenant.id,
                    direction: 'out',
                    content: messageWithLink,
                    status: result.simulated ? 'simulated' : 'sent',
                    to_phone: customer.phone,
                    metadata: { type: 'abandoned_cart', cart_id: cart.id, channel: result.channel }
                });
                console.log(`✅ Recovery Message Sent to ${customer.phone} via ${result.channel || 'unknown'}`);
            } else {
                console.warn(`❌ Failed to send Recovery Message: ${result.error || 'unknown error'}`);
            }

        } catch (err) {
            console.error('❌ Error processing abandoned cart:', err);
        }
    }

    /**
     * معالجة طلب التقييم (بعد اكتمال الطلب)
     */
    async handleOrderCompleted(webhookData) {
        try {
            console.log(`⭐ Processing Order Completed Scenario...`);
            const merchantId = webhookData.merchant;
            const order = webhookData.data;

            // 1. Identify Tenant
            const db = SallaDatabase.connection;
            if (!db) {
                console.error("❌ Database connection failed in ScenarioService");
                return;
            }

            const tenant = await db.models.Tenant.findOne({
                where: { salla_merchant_id: merchantId }
            });

            if (!tenant) return console.warn(`⚠️ Tenant not found for merchant ID: ${merchantId}`);

            // 1.5 Check Plan Gate
            const planGate = require('./planGate');
            const access = await planGate.checkTenantAccess(tenant.id, null, 'review_request');
            if (!access.allowed) {
                console.log(`[planGate] blocked tenant ${tenant.id} reason=${access.reason}`);
                return;
            }

            // 2. Check Settings
            const settings = tenant.settings || {};
            if (settings.review_request === false) return console.log(`ℹ️ Review Request disabled for Tenant ${tenant.id}`);

            // 3. Check Limits First (Before AI Message Generation to save costs)
            const { checkLimit, incrementUsage } = require('../helpers/limitsEngine');
            const limitCheck = await checkLimit(tenant.id, db.models, 'message', 1);

            if (!limitCheck.allowed) {
                console.warn(`⚠️ Limit Exceeded for Tenant ${tenant.id} (Review Request)`);
                return;
            }

            // 4. Extract Data
            const customerData = order.customer;
            const customerName = `${customerData.first_name || ''} ${customerData.last_name || ''}`.trim();
            const customerPhone = customerData.mobile.replace('+', ''); // Normalize phone
            const orderId = order.id;
            const orderTotal = order.total.amount;
            const currency = order.currency;

            // 5. Save Customer (Tracking)
            const [customer] = await db.models.Customer.findOrCreate({
                where: { tenant_id: tenant.id, phone: customerPhone },
                defaults: {
                    name: customerName,
                    email: customerData.email,
                    total_orders: 1,
                    last_order_at: new Date()
                }
            });

            // 6. Generate AI Personalized Message
            const AIService = require('./AIService');
            const reviewLink = `https://${tenant.store_domain || 'salla.sa'}`;

            let messageBody = await AIService.generateReviewRequest(
                tenant.id,
                customerName,
                orderId,
                `${orderTotal} ${currency}`
            );

            // Append Link
            messageBody += `\n\n⭐ قيمنا هنا: ${reviewLink}`;

            console.log("📝 Generated Message:", messageBody);

            // 7. Send via WhatsApp (using the Unified Router)
            const sender = require('./whatsappSender');
            const result = await sender.send(customerPhone, messageBody, tenant.id);

            if (result.ok) {
                await incrementUsage(tenant.id, db.models);

                // Log
                await db.models.MessageLog.create({
                    tenant_id: tenant.id,
                    direction: 'out',
                    content: messageBody,
                    to_phone: customerPhone,
                    status: result.simulated ? 'simulated' : 'sent',
                    metadata: { type: 'review_request', order_id: orderId, channel: result.channel }
                });

                console.log(`✅ Review Request Sent to ${customerPhone} via ${result.channel || 'unknown'}`);
            } else {
                console.warn(`❌ Failed to send Review Request: ${result.error || 'unknown error'}`);
            }

        } catch (error) {
            console.error("❌ Failed to send Review Request:", error);
        }
    }
}

module.exports = new ScenarioService();
