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

/** سجّل النشاط في MessageLog */
async function logScenarioRun(tenantId, scenarioKey, customerId, status = 'sent', meta = {}) {
    const db = SallaDatabase.connection;
    if (!db || !db.models.MessageLog) return;
    try {
        await db.models.MessageLog.create({
            tenant_id: tenantId,
            customer_id: customerId,
            direction: 'outbound',
            channel: 'whatsapp',
            status,
            meta: { scenario: scenarioKey, ...meta }
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
