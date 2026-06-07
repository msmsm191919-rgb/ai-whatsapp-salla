// services/scenarios/reactivation.scenario.js
// كل يوم: ابعث كود خصم لأي عميل خامل > 30 يوم (وما تكرر أكثر من مرة كل 60 يوم)
const { Op } = require('sequelize');
const SallaDatabase = require('../../database/db_instance');
const sender = require('../whatsappSender');
const { tenantsWithScenarioEnabled, logScenarioRun, log } = require('./_helpers');

const INACTIVE_DAYS = 30;
const COOLDOWN_DAYS = 60;
const BATCH_LIMIT = 50;

async function run() {
    const db = SallaDatabase.connection;
    if (!db || !db.models.Customer) return log('reactivation', 'DB not ready');

    const tenants = await tenantsWithScenarioEnabled('reactivation');
    log('reactivation', `Running for ${tenants.length} tenants`);

    for (const tenant of tenants) {
        const inactiveBefore = new Date(Date.now() - INACTIVE_DAYS * 86400000);
        const cooldownBefore = new Date(Date.now() - COOLDOWN_DAYS * 86400000);

        // العملاء النشطين سابقاً (عندهم last_order_at قديم) ولم نرسل لهم منذ فترة
        const candidates = await db.models.Customer.findAll({
            where: {
                tenant_id: tenant.id,
                status: 'active',
                [Op.or]: [
                    { last_order_at: { [Op.lt]: inactiveBefore } },
                    { last_order_at: null, created_at: { [Op.lt]: inactiveBefore } }
                ]
            },
            limit: BATCH_LIMIT
        });

        for (const c of candidates) {
            // فلتر cooldown — نتفقد آخر إعادة تفعيل من JSON meta (نخزنها في الـ Customer.meta لو موجود)
            const meta = c.meta || {};
            if (meta.last_reactivation_sent) {
                const lastSent = new Date(meta.last_reactivation_sent);
                if (lastSent > cooldownBefore) continue;
            }

            const code = `COMEBACK${c.id.toString(36).toUpperCase()}`;
            const msg =
                `💚 اشتقنا لك يا ${c.name}!\n\n` +
                `لاحظنا إنك ما زرتنا من فترة، وحبّينا نرسل لك هدية:\n` +
                `🎁 كود خصم *15%* خاص بك:\n*${code}*\n\n` +
                `صالح لمدة 5 أيام فقط ⏰\n\n` +
                `${tenant.store_name || 'متجرنا'} يفتقدك ❤️`;

            const result = await sender.send(c.phone, msg, tenant.id);

            // حدّث الـ meta (إذا الجدول يدعم meta)
            try {
                await c.update({
                    meta: { ...meta, last_reactivation_sent: new Date().toISOString(), last_reactivation_code: code }
                });
            } catch (_) { /* الـ meta ممكن مش موجود في الـ schema */ }

            await logScenarioRun(tenant.id, 'reactivation', c.id,
                result.ok ? 'sent' : 'failed',
                { code, simulated: !!result.simulated });
        }

        log('reactivation', `${tenant.store_name}: processed ${candidates.length}`);
    }
}

module.exports = { run };
