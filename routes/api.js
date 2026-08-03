const express = require('express');
const router = express.Router();
const SallaDatabase = require('../database/db_instance');

// Helper to get DB models safely
const getModels = () => SallaDatabase.connection.models;

const BillingService = require('../services/BillingService');

// GET /api/billing/simulate-success (DEV ONLY)
// ⛔ Route is ONLY registered in development — returns true 404 in staging/production
// MUST be registered BEFORE the billing auth middleware to avoid 401 interception
if (process.env.NODE_ENV === 'development') {
  router.get('/billing/simulate-success', async (req, res) => {
    try {
      const { ref } = req.query;
      if (!ref) return res.status(400).send("Missing ref");

      const result = await BillingService.processPaymentSuccess(ref);
      res.send(`<h1>Payment Success!</h1><pre>${JSON.stringify(result, null, 2)}</pre><a href="/dashboard">Return to Dashboard</a>`);
    } catch (e) {
      res.status(500).send("Error: " + e.message);
    }
  });
}

// 🔒 حماية مسارات الفواتير البرمجية للعملاء ومنع الدخول العشوائي
// Uses path-specific routes instead of blanket prefix middleware
// to avoid intercepting unregistered routes (e.g., simulate-success in non-dev)
const billingAuth = (req, res, next) => {
    if (req.user && req.user.merchant && req.user.merchant.id) {
        return next();
    }
    return res.status(401).json({ status: 'error', message: 'Authentication required' });
};

// ------------------------------------------------------------------
// 1. BILLING ROUTES (Client)
// ------------------------------------------------------------------

// GET /api/billing/summary
router.get('/billing/summary', billingAuth, async (req, res) => {
    try {
        const { Tenant, Subscription, Plan, UsageCounter } = getModels();
        const tenantId = req.user.merchant.id; // Correct lookup needed based on actual Auth

        // Fetch Subscription with Plan
        // logic here...

        res.json({
            status: 'success',
            data: {
                plan: 'Starter',
                status: 'active',
                next_renewal: '2026-02-01'
            }
        });
    } catch (e) {
        res.status(500).json({ status: 'error', message: e.message });
    }
});

// POST /api/billing/checkout
router.post('/billing/checkout', billingAuth, async (req, res) => {
    try {
        const { plan_id, billing_period } = req.body;

        // Find Tenant ID (Mocked for dev, should be req.user.merchant.id -> Tenant lookup)
        const tenant = await getModels().Tenant.findOne({ where: { salla_merchant_id: req.user.merchant.id } });
        if (!tenant) return res.status(404).json({ error: 'Tenant not found' });

        const result = await BillingService.createCheckout(tenant.id, plan_id, billing_period);
        res.json({ status: 'success', data: result });
    } catch (e) {
        res.status(500).json({ status: 'error', message: e.message });
    }
});

// ------------------------------------------------------------------
// 1.5. CONVERSATION HANDOFF ROUTES (Client)
// ------------------------------------------------------------------

const HandoffService = require('../services/HandoffService');

// GET /api/conversations/paused
router.get('/conversations/paused', async (req, res) => {
    try {
        if (!req.user || !req.user.merchant || !req.user.merchant.id) {
            return res.status(401).json({ status: 'error', message: 'Authentication required' });
        }
        const tenant = await getModels().Tenant.findOne({ where: { salla_merchant_id: req.user.merchant.id } });
        if (!tenant) return res.status(404).json({ error: 'Tenant not found' });

        const pausedChats = await HandoffService.listPausedChats(tenant.id);
        res.json({ status: 'success', data: pausedChats });
    } catch (e) {
        res.status(500).json({ status: 'error', message: e.message });
    }
});

// POST /api/conversations/resume
router.post('/conversations/resume', async (req, res) => {
    try {
        if (!req.user || !req.user.merchant || !req.user.merchant.id) {
            return res.status(401).json({ status: 'error', message: 'Authentication required' });
        }
        const { chatKey } = req.body;
        if (!chatKey) return res.status(400).json({ status: 'error', message: 'Missing chatKey' });

        const tenant = await getModels().Tenant.findOne({ where: { salla_merchant_id: req.user.merchant.id } });
        if (!tenant) return res.status(404).json({ error: 'Tenant not found' });

        const resolved = HandoffService.getChatKey(chatKey);
        const result = await HandoffService.resumeChat(tenant.id, resolved);
        res.json({ status: 'success', resumed: result });
    } catch (e) {
        res.status(500).json({ status: 'error', message: e.message });
    }
});

// GET /api/inbox/conversations
router.get('/inbox/conversations', async (req, res) => {
    try {
        if (!req.user || !req.user.merchant || !req.user.merchant.id) {
            return res.status(401).json({ status: 'error', message: 'Authentication required' });
        }
        const db = SallaDatabase.connection;
        const tenant = await getModels().Tenant.findOne({ where: { salla_merchant_id: req.user.merchant.id } });
        if (!tenant) return res.status(404).json({ error: 'Tenant not found' });

        const limit = Math.max(1, Math.min(100, parseInt(req.query.limit, 10) || 20));
        const offset = Math.max(0, parseInt(req.query.offset, 10) || 0);

        const threadsQuery = `
          SELECT m1.*, c.name as customer_name
          FROM MessageLogs m1
          LEFT JOIN customers c ON c.phone = m1.to_phone AND c.tenant_id = m1.tenant_id
          INNER JOIN (
              SELECT to_phone, MAX(created_at) as max_created
              FROM MessageLogs
              WHERE tenant_id = :tenantId
              GROUP BY to_phone
          ) m2 ON m1.to_phone = m2.to_phone AND m1.created_at = m2.max_created
          WHERE m1.tenant_id = :tenantId
          ORDER BY m1.created_at DESC
          LIMIT ${limit} OFFSET ${offset};
        `;
        const threads = await db.query(threadsQuery, {
            replacements: { tenantId: tenant.id },
            type: require('sequelize').QueryTypes.SELECT
        });

        const pausedChats = await HandoffService.listPausedChats(tenant.id);

        const conversations = threads.map(t => {
            const chatKey = HandoffService.getChatKey(t.to_phone);
            const isPaused = !!(pausedChats[chatKey] && pausedChats[chatKey].paused);
            return {
                phone: t.to_phone,
                customer_name: t.customer_name || t.to_phone,
                last_message: t.content,
                last_msg_at: t.created_at,
                direction: t.direction,
                status: t.status,
                is_paused: isPaused
            };
        });

        res.json({ status: 'success', data: conversations });
    } catch (e) {
        res.status(500).json({ status: 'error', message: e.message });
    }
});

// GET /api/inbox/messages/:phone
router.get('/inbox/messages/:phone', async (req, res) => {
    try {
        if (!req.user || !req.user.merchant || !req.user.merchant.id) {
            return res.status(401).json({ status: 'error', message: 'Authentication required' });
        }
        const tenant = await getModels().Tenant.findOne({ where: { salla_merchant_id: req.user.merchant.id } });
        if (!tenant) return res.status(404).json({ error: 'Tenant not found' });

        const phone = req.params.phone;
        const messages = await getModels().MessageLog.findAll({
            where: {
                tenant_id: tenant.id,
                to_phone: phone
            },
            order: [['created_at', 'ASC']],
            limit: 50
        });

        res.json({ status: 'success', data: messages });
    } catch (e) {
        res.status(500).json({ status: 'error', message: e.message });
    }
});

// POST /api/inbox/send
router.post('/inbox/send', async (req, res) => {
    try {
        if (!req.user || !req.user.merchant || !req.user.merchant.id) {
            return res.status(401).json({ status: 'error', message: 'Authentication required' });
        }
        const tenant = await getModels().Tenant.findOne({ where: { salla_merchant_id: req.user.merchant.id } });
        if (!tenant) return res.status(404).json({ error: 'Tenant not found' });

        const { phone, message } = req.body;
        if (!phone || !message) {
            return res.status(400).json({ status: 'error', message: 'Phone and message are required' });
        }

        const whatsappSender = require('../services/whatsappSender');
        const sendResult = await whatsappSender.send(phone, message, tenant.id);

        const status = sendResult.ok ? 'sent' : 'failed';
        const newLog = await getModels().MessageLog.create({
            tenant_id: tenant.id,
            direction: 'out',
            status: status,
            content: message,
            to_phone: phone,
            metadata: { channel: sendResult.channel || 'simulation', error: sendResult.error }
        });

        // Auto Handoff: When staff sends manual message, turn off AI for this customer only.
        const chatKey = HandoffService.getChatKey(phone);
        await HandoffService.pauseChat(tenant.id, chatKey, {
            reason: 'manual_message',
            last_human_message_at: new Date().toISOString()
        });

        res.json({
            status: 'success',
            data: {
                message: newLog,
                sendResult: sendResult
            }
        });
    } catch (e) {
        res.status(500).json({ status: 'error', message: e.message });
    }
});

// POST /api/inbox/toggle-handoff
router.post('/inbox/toggle-handoff', async (req, res) => {
    try {
        if (!req.user || !req.user.merchant || !req.user.merchant.id) {
            return res.status(401).json({ status: 'error', message: 'Authentication required' });
        }
        const tenant = await getModels().Tenant.findOne({ where: { salla_merchant_id: req.user.merchant.id } });
        if (!tenant) return res.status(404).json({ error: 'Tenant not found' });

        const { phone, paused } = req.body;
        if (!phone) {
            return res.status(400).json({ status: 'error', message: 'Phone is required' });
        }

        const chatKey = HandoffService.getChatKey(phone);

        if (paused) {
            await HandoffService.pauseChat(tenant.id, chatKey, {
                reason: 'manual_toggle',
                last_human_message_at: new Date().toISOString()
            });
        } else {
            await HandoffService.resumeChat(tenant.id, chatKey);
        }

        res.json({ status: 'success', data: { is_paused: paused } });
    } catch (e) {
        res.status(500).json({ status: 'error', message: e.message });
    }
});

// ------------------------------------------------------------------
// 2. ADMIN ROUTES
// ------------------------------------------------------------------

// GET /api/admin/tenants
router.get('/admin/tenants', async (req, res) => {
    try {
        const { Tenant } = getModels();
        const tenants = await Tenant.findAll();
        res.json({ status: 'success', data: tenants });
    } catch (e) {
        res.status(500).json({ status: 'error', message: e.message });
    }
});

// POST /api/admin/tenants/:id/status
router.post('/admin/tenants/:id/status', async (req, res) => {
    const { id } = req.params;
    const { status } = req.body; // active, suspended_manual

    // Logic to update status and log Audit
    res.json({ status: 'success', message: `Tenant ${id} updated to ${status}` });
});

module.exports = router;
