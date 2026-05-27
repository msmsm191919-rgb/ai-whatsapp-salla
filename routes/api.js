const express = require('express');
const router = express.Router();
const SallaDatabase = require('../database/db_instance');

// Helper to get DB models safely
const getModels = () => SallaDatabase.connection.models;

// 🔒 حماية مسارات الفواتير البرمجية للعملاء ومنع الدخول العشوائي
router.use('/billing', (req, res, next) => {
    if (req.user && req.user.merchant && req.user.merchant.id) {
        return next();
    }
    return res.status(401).json({ status: 'error', message: 'Authentication required' });
});

// ------------------------------------------------------------------
// 1. BILLING ROUTES (Client)
// ------------------------------------------------------------------

// GET /api/billing/summary
router.get('/billing/summary', async (req, res) => {
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

const BillingService = require('../services/BillingService');

// POST /api/billing/checkout
router.post('/billing/checkout', async (req, res) => {
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

// GET /api/billing/simulate-success (DEV ONLY)
// ⛔ محمي: يمنع تزوير نجاح الدفع في الإنتاج
router.get('/billing/simulate-success', async (req, res) => {
    if (process.env.NODE_ENV === 'production') {
        return res.status(404).send("Not found");
    }
    try {
        const { ref } = req.query;
        if (!ref) return res.status(400).send("Missing ref");

        const result = await BillingService.processPaymentSuccess(ref);
        res.send(`<h1>Payment Success!</h1><pre>${JSON.stringify(result, null, 2)}</pre><a href="/dashboard">Return to Dashboard</a>`);
    } catch (e) {
        res.status(500).send("Error: " + e.message);
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
