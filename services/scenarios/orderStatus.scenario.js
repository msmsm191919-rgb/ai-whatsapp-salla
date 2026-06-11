// services/scenarios/orderStatus.scenario.js
// يُستدعى من Webhook Salla عند تغيير حالة الطلب
const SallaDatabase = require('../../database/db_instance');
const sender = require('../whatsappSender');
const { logScenarioRun, log } = require('./_helpers');
const planGate = require('../planGate');

const STATUS_MESSAGES = {
    'under_review':           '👀 جاري مراجعة طلبك',
    'payment_pending':        '💳 بانتظار إتمام الدفع',
    'in_progress':            '🔧 طلبك قيد التجهيز',
    'shipped':                '🚚 تم شحن طلبك',
    'delivering':             '📦 الطلب في طريقه إليك',
    'delivered':              '✅ تم تسليم طلبك. نتمنى رضاك التام!',
    'completed':              '🎉 اكتمل طلبك بنجاح',
    'cancelled':              '❌ تم إلغاء طلبك',
    'refunded':               '💰 تم استرداد قيمة طلبك',
    'restored':               '🔄 تم استرجاع طلبك',
    'restoring':              '⏳ جاري استرجاع الطلب'
};

/**
 * يستقبل event body من Salla webhook (order.status.updated)
 */
async function handle(eventBody) {
    try {
        const db = SallaDatabase.connection;
        if (!db) return log('order_status', 'DB not ready');

        const merchantId = eventBody.merchant;
        const data = eventBody.data || {};
        const order = data.order || data || {};

        // اعثر على المتجر
        const tenant = await db.models.Tenant.findOne({
            where: { salla_merchant_id: merchantId }
        });
        if (!tenant) return log('order_status', `Tenant not found: ${merchantId}`);

        // تحقق إن السيناريو مفعّل
        const settings = tenant.settings || {};
        if (!settings.order_status) return log('order_status', `Disabled for ${tenant.store_name}`);

        // 🔒 تحقق إن الباقة تدعم السيناريو
        const access = await planGate.checkTenantAccess(tenant.id, null, 'order_status');
        if (!access.allowed) {
            console.log(`[planGate] blocked tenant ${tenant.id} reason=${access.reason}`);
            return log('order_status', `🔒 Plan does not allow order_status for ${tenant.store_name}`);
        }

        // استخرج بيانات العميل والحالة
        const customerName = order?.customer?.first_name || order?.customer?.name || 'عميلنا الكريم';
        const customerPhone = order?.customer?.mobile || order?.customer?.phone;
        const newStatus = (order?.status?.slug || order?.status?.name || '').toLowerCase();
        const orderId = order?.id || order?.reference_id || '—';
        const trackingUrl = order?.shipping?.tracking_link || order?.tracking?.link;

        if (!customerPhone) return log('order_status', `No phone for order ${orderId}`);

        const baseMsg = STATUS_MESSAGES[newStatus] || `📋 تم تحديث حالة طلبك إلى: ${order?.status?.name || newStatus}`;

        let fullMsg = `مرحباً ${customerName} 👋\n\n${baseMsg}\n\nرقم الطلب: #${orderId}`;
        if (trackingUrl) fullMsg += `\n🔗 تتبع الشحنة: ${trackingUrl}`;
        fullMsg += `\n\n${tenant.store_name || 'متجرنا'} 🛒`;

        const result = await sender.send(customerPhone, fullMsg, tenant.id);

        await logScenarioRun(
            tenant.id,
            'order_status',
            null,
            result.ok ? 'sent' : 'failed',
            { order_id: orderId, order_status: newStatus, channel: result.channel || 'qr', simulated: !!result.simulated },
            fullMsg,
            customerPhone
        );

        log('order_status', `${result.ok ? '✅' : '❌'} ${tenant.store_name} → ${customerPhone} (${newStatus})`);
    } catch (e) {
        console.error('[scenario:order_status] error:', e);
    }
}

module.exports = { handle };
