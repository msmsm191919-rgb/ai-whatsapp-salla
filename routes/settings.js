const express = require('express');
const router = express.Router();
const SallaDatabase = require('../database/db_instance');
const planGate = require('../services/planGate');

// GET: WhatsApp Settings (API — خيار متقدم)
router.get('/whatsapp', planGate.requireFeaturePage('whatsapp_api'), async (req, res) => {
  try {
    const db = SallaDatabase.connection;

    const tenant = await db.models.Tenant.findOne({
      where: { salla_merchant_id: req.user.merchant.id },
      include: [
        { model: db.models.Subscription, include: [db.models.Plan] },
        'WhatsAppConfig'
      ]
    });

    const plan = tenant?.Subscription?.Plan;
    const planFeatures = plan?.features || {};

    const config = tenant?.WhatsAppConfig || {};
    const apiKey = tenant?.settings?.api_key || '';
    const hasApiAccess = planFeatures.api_access === true;

    res.render('settings.html', {
      user: req.user, activePage: 'settings',
      plan_name: plan?.name || 'الأساسية',
      plan_features: planFeatures, has_api_access: hasApiAccess,
      config: {
        phone_number_id: config.phone_number_id || '',
        waba_id: config.waba_id || '',
        access_token: config.access_token || ''
      },
      api_key: apiKey, status: req.query.status || null
    });
  } catch (e) {
    console.error('Settings Route Error:', e);
    res.status(500).send('Error loading settings: ' + e.message);
  }
});

// POST: Save WhatsApp Settings
router.post('/whatsapp', planGate.requireFeature('whatsapp_api'), async (req, res) => {
  try {
    const db = SallaDatabase.connection;

    const tenant = await db.models.Tenant.findOne({
      where: { salla_merchant_id: req.user.merchant.id }
    });
    if (!tenant) return res.status(404).json({ error: 'Tenant not found' });

    const { phone_id, waba_id, token } = req.body;

    const [config, created] = await db.models.WhatsAppConfig.findOrCreate({
      where: { tenant_id: tenant.id },
      defaults: { phone_number_id: phone_id, waba_id, access_token: token, status: 'active' }
    });

    if (!created) {
      await config.update({ phone_number_id: phone_id, waba_id, access_token: token, status: 'active' });
    }

    console.log(`✅ WhatsApp Config Saved for ${tenant.store_name}`);
    res.redirect('/settings/whatsapp?status=saved');
  } catch (e) {
    console.error('WhatsApp Settings Save Error:', e);
    res.status(500).send('Error saving settings: ' + e.message);
  }
});

// POST: Generate API Key
router.post('/generate-api-key', async (req, res) => {
  try {
    const db = SallaDatabase.connection;
    const crypto = require('crypto');

    const tenant = await db.models.Tenant.findOne({
      where: { salla_merchant_id: req.user.merchant.id },
      include: [{ model: db.models.Subscription, include: [db.models.Plan] }]
    });
    if (!tenant) return res.status(404).json({ success: false, error: 'Tenant not found' });

    const planFeatures = tenant?.Subscription?.Plan?.features || {};
    if (!planFeatures.api_access) {
      return res.status(403).json({
        success: false,
        error: 'هذه الميزة متاحة فقط لباقة التاجر وما فوق. يرجى ترقية باقتك.'
      });
    }

    const newKey = 'mbhr_' + crypto.randomBytes(24).toString('hex');
    const currentSettings = tenant.settings || {};
    currentSettings.api_key = newKey;
    tenant.settings = currentSettings;
    tenant.changed('settings', true);
    await tenant.save();

    console.log(`🔑 New API Key generated for ${tenant.store_name}`);
    res.json({ success: true, key: newKey });
  } catch (e) {
    console.error('Generate API Key Error:', e);
    res.status(500).json({ success: false, error: e.message });
  }
});

// GET: AI Settings
router.get('/ai', async (req, res) => {
  try {
    const db = SallaDatabase.connection;
    const tenant = await db.models.Tenant.findOne({
      where: { salla_merchant_id: req.user.merchant.id },
      include: [{ model: db.models.Subscription, include: [db.models.Plan] }]
    });
    const plan = tenant?.Subscription?.Plan;
    const aiConfig = tenant?.settings?.ai_config || {};
    res.render('ai_settings.html', {
      config: aiConfig, user: req.user, activePage: 'ai_settings',
      plan_name: plan?.name || 'الأساسية'
    });
  } catch (e) {
    res.status(500).send(e.message);
  }
});

// POST: Save AI Settings
router.post('/ai', async (req, res) => {
  try {
    const db = SallaDatabase.connection;
    const tenant = await db.models.Tenant.findOne({ where: { salla_merchant_id: req.user.merchant.id } });

    if (tenant) {
      const currentSettings = tenant.settings || {};
      currentSettings.ai_config = {
        bot_name: req.body.bot_name,
        bot_tone: req.body.bot_tone,
        custom_instructions: req.body.custom_instructions,
        policy_return: req.body.policy_return,
        shipping_time: req.body.shipping_time
      };
      tenant.settings = currentSettings;
      tenant.changed('settings', true);
      await tenant.save();
    }
    res.redirect('/settings/ai?status=saved');
  } catch (e) {
    console.error(e);
    res.status(500).send('Error saving AI settings');
  }
});

module.exports = router;
