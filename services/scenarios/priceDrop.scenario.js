// services/scenarios/priceDrop.scenario.js
// كل يوم: قارن أسعار المنتجات اللي العملاء مهتمين فيها مع آخر سعر مسجّل
// → لو نزل > 10% نبعث تنبيه
const axios = require('axios');
const { Op } = require('sequelize');
const SallaDatabase = require('../../database/db_instance');
const sender = require('../whatsappSender');
const { tenantsWithScenarioEnabled, logScenarioRun, log } = require('./_helpers');

const DROP_THRESHOLD = 0.10; // 10%
const SALLA_API_BASE = 'https://api.salla.dev/admin/v2';

/**
 * نخزّن تاريخ الأسعار + اهتمامات العملاء داخل Tenant.settings.priceData
 * البنية:
 * {
 *   priceData: {
 *     'product_id_123': {
 *       lastPrice: 450,
 *       recordedAt: '2026-05-18T10:00:00Z',
 *       interested: [customer_id, customer_id, ...]
 *     }
 *   }
 * }
 */
async function run() {
    const db = SallaDatabase.connection;
    if (!db) return log('price_drop', 'DB not ready');

    const tenants = await tenantsWithScenarioEnabled('price_drop');
    log('price_drop', `Running for ${tenants.length} tenants`);

    for (const tenant of tenants) {
        try {
            // Salla OAuth token
            const oauth = await db.models.SallaOAuth.findOne({ where: { tenant_id: tenant.id } });
            if (!oauth || !oauth.access_token) {
                log('price_drop', `No OAuth for ${tenant.store_name}`);
                continue;
            }

            const settings = tenant.settings || {};
            const priceData = settings.priceData || {};

            // اجلب أول 50 منتج فعال من Salla
            let products = [];
            try {
                const { data } = await axios.get(`${SALLA_API_BASE}/products?per_page=50`, {
                    headers: { Authorization: `Bearer ${oauth.access_token}` },
                    timeout: 15000
                });
                products = data?.data || [];
            } catch (e) {
                log('price_drop', `Salla API failed for ${tenant.store_name}: ${e.message}`);
                continue;
            }

            let alerts = 0;
            for (const p of products) {
                const pid = String(p.id);
                const currentPrice = Number(p.price?.amount || p.price || 0);
                if (!currentPrice) continue;

                const prev = priceData[pid];

                // لو في تاريخ سابق وانخفض السعر
                if (prev && prev.lastPrice && currentPrice < prev.lastPrice * (1 - DROP_THRESHOLD)) {
                    const dropPct = Math.round((1 - currentPrice / prev.lastPrice) * 100);
                    const interestedIds = prev.interested || [];

                    if (interestedIds.length > 0) {
                        const interested = await db.models.Customer.findAll({
                            where: { id: { [Op.in]: interestedIds }, tenant_id: tenant.id }
                        });

                        for (const c of interested) {
                            const msg =
                                `🔥 *تخفيض ${dropPct}% على منتج كنت مهتم فيه!*\n\n` +
                                `📦 ${p.name}\n` +
                                `السعر القديم: ~${prev.lastPrice} ر.س~\n` +
                                `السعر الجديد: *${currentPrice} ر.س* 🎉\n\n` +
                                (p.url ? `اطلب الآن: ${p.url}\n\n` : '') +
                                `${tenant.store_name || 'متجرنا'} 🛒`;
                            const result = await sender.send(c.phone, msg, tenant.id);
                            await logScenarioRun(tenant.id, 'price_drop', c.id,
                                result.ok ? 'sent' : 'failed',
                                { product_id: pid, drop_pct: dropPct, simulated: !!result.simulated });
                            alerts++;
                        }
                    }
                }

                // حدّث السعر المخزّن
                priceData[pid] = {
                    lastPrice: currentPrice,
                    recordedAt: new Date().toISOString(),
                    interested: prev?.interested || []
                };
            }

            // احفظ priceData المحدّث
            tenant.settings = { ...settings, priceData };
            tenant.changed('settings', true);
            await tenant.save();

            log('price_drop', `${tenant.store_name}: ${products.length} products checked, ${alerts} alerts sent`);
        } catch (e) {
            console.error(`[scenario:price_drop] ${tenant.store_name}:`, e.message);
        }
    }
}

/**
 * استخدمها من أي مكان لتسجيل اهتمام العميل بمنتج
 * (مثلاً عند ما يسأل العميل عن منتج في الواتساب)
 */
async function trackInterest(tenantId, productId, customerId) {
    const db = SallaDatabase.connection;
    const tenant = await db.models.Tenant.findByPk(tenantId);
    if (!tenant) return;
    const settings = tenant.settings || {};
    const priceData = settings.priceData || {};
    const pid = String(productId);
    priceData[pid] = priceData[pid] || { lastPrice: null, interested: [] };
    if (!priceData[pid].interested.includes(customerId)) {
        priceData[pid].interested.push(customerId);
    }
    tenant.settings = { ...settings, priceData };
    tenant.changed('settings', true);
    await tenant.save();
}

module.exports = { run, trackInterest };
