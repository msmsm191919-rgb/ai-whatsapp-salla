// services/scenarios/_helpers.js
const SallaDatabase = require('../../database/db_instance');
const planGate = require('../planGate');

/**
 * اجلب كل المتاجر اللي:
 *  1. مفعّلين السيناريو (settings[key] === true)
 *  2. باقتهم تسمح بهذا السيناريو
 * @param {string} key  e.g. 'birthday', 'reactivation', 'order_status', 'price_drop'
 */
async function tenantsWithScenarioEnabled(key) {
    const db = SallaDatabase.connection;
    if (!db) return [];
    const tenants = await db.models.Tenant.findAll({ where: { status: 'active' } });
    const enabled = tenants.filter(t => (t.settings || {})[key] === true);
    return planGate.filterTenantsByScenario(enabled, key);
}

async function logScenarioRun(tenantId, scenarioKey, customerId, status = 'sent', meta = {}, content = null, toPhone = null) {
    const db = SallaDatabase.connection;
    if (!db || !db.models.MessageLog) return;
    try {
        const actualPhone = toPhone || meta.phone || (meta.customer ? meta.customer.phone : null);
        const actualContent = content || meta.content || null;

        await db.models.MessageLog.create({
            tenant_id: tenantId,
            direction: 'out',
            status,
            content: actualContent,
            to_phone: actualPhone,
            metadata: {
                type: scenarioKey,
                ...meta
            }
        });
    } catch (e) {
        // MessageLog حقوله ممكن تختلف — نطبع فقط
        console.warn(`[scenario:${scenarioKey}] log skipped:`, e.message);
    }
}

/** سجّل في الكونسول بشكل موحّد */
function log(scenario, msg) {
    console.log(`[scenario:${scenario}] ${msg}`);
}

module.exports = { tenantsWithScenarioEnabled, logScenarioRun, log };
