// services/scenarios/birthday.scenario.js
// كل يوم الساعة 9 صباحاً: ابعث تهنئة + كود خصم 20% للعملاء اللي عيد ميلادهم اليوم
const SallaDatabase = require('../../database/db_instance');
const sender = require('../whatsappSender');
const { tenantsWithScenarioEnabled, logScenarioRun, log } = require('./_helpers');

/**
 * يقرأ تاريخ الميلاد من Customer.meta.birthday (YYYY-MM-DD)
 * لأن الجدول الحالي ما فيه عمود birthday صريح — نستخدم JSON meta
 */
async function run() {
    const db = SallaDatabase.connection;
    if (!db || !db.models.Customer) return log('birthday', 'DB not ready');

    const tenants = await tenantsWithScenarioEnabled('birthday');
    log('birthday', `Running for ${tenants.length} tenants`);

    const today = new Date();
    const mm = String(today.getMonth() + 1).padStart(2, '0');
    const dd = String(today.getDate()).padStart(2, '0');
    const todayMD = `${mm}-${dd}`;

    for (const tenant of tenants) {
        const planGate = require('../planGate');
        const access = await planGate.checkTenantAccess(tenant.id, null, 'birthday');
        if (!access.allowed) {
            console.log(`[planGate] blocked tenant ${tenant.id} reason=${access.reason}`);
            continue;
        }

        const customers = await db.models.Customer.findAll({
            where: { tenant_id: tenant.id, status: 'active' }
        });

        let sent = 0;
        for (const c of customers) {
            const meta = c.meta || {};
            if (!meta.birthday) continue;

            // birthday متوقع يكون YYYY-MM-DD أو MM-DD
            const bday = String(meta.birthday);
            const bMD = bday.length === 10 ? bday.slice(5) : bday;
            if (bMD !== todayMD) continue;

            // ما نكرر في نفس السنة
            const lastBday = meta.last_birthday_sent;
            if (lastBday && lastBday.startsWith(today.getFullYear().toString())) continue;

            const code = `BDAY${c.id.toString(36).toUpperCase()}`;
            const msg =
                `🎂🎉 *كل عام وأنت بخير يا ${c.name}!* 🎉🎂\n\n` +
                `بمناسبة عيد ميلادك، نهديك:\n` +
                `🎁 *خصم 20%* على طلبك القادم\n` +
                `الكود: *${code}*\n\n` +
                `صالح 7 أيام فقط — أحلى هدية ننتظرك فيها 💝\n\n` +
                `${tenant.store_name || 'متجرنا'} 🛍️`;

            const result = await sender.send(c.phone, msg, tenant.id);

            try {
                await c.update({
                    meta: { ...meta, last_birthday_sent: new Date().toISOString().slice(0, 10), last_birthday_code: code }
                });
            } catch (_) { /* ignore */ }

            await logScenarioRun(tenant.id, 'birthday', c.id,
                result.ok ? 'sent' : 'failed',
                { code, simulated: !!result.simulated },
                msg,
                c.phone);
            sent++;
        }

        log('birthday', `${tenant.store_name}: ${sent} birthday wishes sent`);
    }
}

module.exports = { run };
