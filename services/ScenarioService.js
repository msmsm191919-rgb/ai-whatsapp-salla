const SallaDatabase = require('../database/db_instance');
const { sendMetaMessage } = require('../helpers/metaProvider');

class ScenarioService {

    constructor() {
        this.db = SallaDatabase.connection;
    }

    /**
     * معالجة السلة المتروكة
     */
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

            // 2. Check Settings
            const settings = tenant.settings || {};
            // If settings.abandoned_cart is undefined, default to true for testing, or check strictly
            if (settings.abandoned_cart === false) return console.log(`ℹ️ Auto-Recovery disabled for Tenant ${tenant.id}`);

            // 3. Extract Data
            const cartData = webhookData.data;
            const customerData = cartData.customer;
            const cartItems = cartData.items || [];
            const cartTotal = cartData.total?.amount || 0;
            const currency = cartData.currency || 'SAR'; // Default SAR
            const checkoutUrl = cartData.checkout_url || cartData.url;

            console.log(`🔍 Cart Data: Total ${cartTotal} ${currency}, Items: ${cartItems.length}`);

            // 4. Save Customer & Cart (Tracking)
            const [customer] = await db.models.Customer.findOrCreate({
                where: { tenant_id: tenant.id, phone: customerData.mobile },
                defaults: {
                    name: `${customerData.first_name || ''} ${customerData.last_name || ''}`.trim(),
                    // country_code not in model yet
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

            // 5. Generate AI Persuasive Message
            // Extract item names safely
            const itemNames = cartItems.map(i => i.product?.name || i.name || 'منتج');

            // Allow overriding via settings for testing
            const AIService = require('./AIService');
            let aiMessage = await AIService.generateCartRecovery(
                tenant.id,
                customer.first_name || 'عميلنا',
                `${cartTotal} ${currency}`,
                itemNames
            );

            // Append Link
            const messageWithLink = `${aiMessage}\n\n🔗 كمل طلبك من هنا:\n${checkoutUrl}`;

            // 6. Send via WhatsApp
            const metaConfig = await db.models.WhatsAppConfig.findOne({ where: { tenant_id: tenant.id } });

            if (metaConfig && metaConfig.access_token) {
                // Check Limits
                const { checkLimit, incrementUsage } = require('../helpers/limitsEngine');
                const limitCheck = await checkLimit(tenant.id, db.models, 'message', 1);

                if (limitCheck.allowed) {
                    await sendMetaMessage(metaConfig, customer.phone, messageWithLink);
                    await incrementUsage(tenant.id, db.models);

                    // Update Stats
                    await cart.update({ status: 'recovered', recovery_attempts: (cart.recovery_attempts || 0) + 1, last_message_at: new Date() });

                    await db.models.MessageLog.create({
                        tenant_id: tenant.id,
                        direction: 'out',
                        content: messageWithLink,
                        status: 'sent',
                        to_phone: customer.phone,
                        metadata: { type: 'abandoned_cart', cart_id: cart.id }
                    });
                    console.log(`✅ AI Recovery Message Sent to ${customer.phone}`);
                } else {
                    console.warn(`⚠️ Limit Exceeded for Tenant ${tenant.id} (Current: ${limitCheck.current}, Limit: ${limitCheck.limit})`);
                }
            } else {
                console.warn(`⚠️ No WhatsApp Config for Tenant ${tenant.id}`);
            }

        } catch (err) {
            console.error('❌ Error processing abandoned cart:', err);
        }
    }

    /**
     * معالجة طلب التقييم (بعد اكتمال الطلب)
     */
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
            const tenant = await db.models.Tenant.findOne({
                where: { salla_merchant_id: merchantId },
                include: ['WhatsAppConfig']
            });

            if (!tenant) return console.warn(`⚠️ Tenant not found for merchant ID: ${merchantId}`);
            if (!tenant.WhatsAppConfig) return console.warn(`⚠️ No WhatsApp Config for Tenant ${tenant.id}`);

            // 2. Check Settings
            // Default to true for testing if undefined, or check strictly in production
            const settings = tenant.settings || {};
            if (settings.review_request === false) return console.log(`ℹ️ Review Request disabled for Tenant ${tenant.id}`);

            // 3. Extract Data
            const customerData = order.customer;
            const customerName = `${customerData.first_name || ''} ${customerData.last_name || ''}`.trim();
            const customerPhone = customerData.mobile.replace('+', ''); // Normalize phone
            const orderId = order.id;
            const orderTotal = order.total.amount;
            const currency = order.currency;

            // 4. Save Customer (Tracking)
            const [customer] = await db.models.Customer.findOrCreate({
                where: { tenant_id: tenant.id, phone: customerPhone },
                defaults: {
                    name: customerName,
                    email: customerData.email,
                    total_orders: 1, // Will be incremented if exists using separate logic ideally, but fine for now
                    last_order_at: new Date()
                }
            });

            // 5. Generate AI Personalized Message
            const AIService = require('./AIService');
            // We need a review link. Usually it's store_domain which redirects to Salla review or specific product.
            // Salla doesn't give direct review link in webhook, so we point to the store.
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

            // 6. Send via WhatsApp (Check Limits First)
            const { checkLimit, incrementUsage } = require('../helpers/limitsEngine');
            const limitCheck = await checkLimit(tenant.id, db.models, 'message', 1);

            if (limitCheck.allowed) {
                await sendMetaMessage(
                    tenant.WhatsAppConfig,
                    customerPhone,
                    messageBody
                );
                await incrementUsage(tenant.id, db.models);

                // Log
                await db.models.MessageLog.create({
                    tenant_id: tenant.id,
                    direction: 'out',
                    content: messageBody,
                    to_phone: customerPhone,
                    status: 'sent',
                    metadata: { type: 'review_request', order_id: orderId }
                });

                console.log(`✅ Review Request Sent to ${customerPhone}`);
            } else {
                console.warn(`⚠️ Limit Exceeded for Tenant ${tenant.id} (Review Request)`);
            }

        } catch (error) {
            console.error("❌ Failed to send Review Request:", error);
        }
    }
}

module.exports = new ScenarioService();
