const express = require('express');
const router = express.Router();
const SallaDatabase = require('../database/db_instance');
const waWeb = require('../services/waWeb');

router.get('/', async (req, res) => {
  try {
    const db = SallaDatabase.connection;
    const tenants = await db.models.Tenant.findAll({
      include: [
        'WhatsAppConfig',
        { model: db.models.Subscription, as: 'Subscription', include: [{ model: db.models.Plan, as: 'Plan' }] }
      ]
    });

    const active_tenants_count = tenants.length;
    const disconnected_count = tenants.filter(t => !t.WhatsAppConfig || !t.WhatsAppConfig.access_token).length;

    let mrr = 0;
    tenants.forEach(t => {
      const planPrice = t.Subscription?.Plan?.price_monthly || 79;
      mrr += planPrice;
    });

    const recent_tenants = await db.models.Tenant.findAll({
      limit: 5, order: [['created_at', 'DESC']],
      include: [{ model: db.models.Subscription, as: 'Subscription', include: [{ model: db.models.Plan, as: 'Plan' }] }]
    });

    const recent_logs = await db.models.MessageLog.findAll({
      limit: 5, order: [['created_at', 'DESC']], include: ['Tenant']
    });

    const total_messages_month = await db.models.MessageLog.count({
      where: { direction: 'out' }
    });

    const now_date = new Date().toLocaleDateString('ar-SA', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

    res.render('admin/index.html', {
      page: 'overview', tenants_count: tenants.length,
      active_tenants_count, disconnected_count,
      total_messages_month, ai_usage_count: 0,
      mrr: mrr.toLocaleString(), arr: (mrr * 12).toLocaleString(),
      recent_tenants, recent_logs, now_date
    });
  } catch (e) {
    res.status(500).send(e.message);
  }
});

router.get('/tenants', async (req, res) => {
  try {
    const db = SallaDatabase.connection;
    const tenants = await db.models.Tenant.findAll({
      include: ['WhatsAppConfig', 'Subscription'],
      order: [['createdAt', 'DESC']]
    });
    // 📱 حالة جلسة واتساب QR لكل تاجر
    const waStatus = {};
    tenants.forEach(t => { waStatus[t.id] = waWeb.getState(t.id).status; });
    const waConnected = Object.values(waStatus).filter(s => s === 'ready').length;
    res.render('admin/tenants.html', { page: 'tenants', now_date: new Date().toLocaleDateString('ar-SA'), tenants, waStatus, waConnected });
  } catch (e) {
    res.status(500).send(e.message);
  }
});

router.get('/subscriptions', async (req, res) => {
  try {
    const db = SallaDatabase.connection;
    const subscriptions = await db.models.Subscription.findAll({
      include: ['Tenant', 'Plan'], order: [['created_at', 'DESC']]
    });
    res.render('admin/subscriptions.html', { page: 'subscriptions', subscriptions });
  } catch (e) {
    res.status(500).send('Error: ' + e.message);
  }
});

router.get('/logs', async (req, res) => {
  try {
    const db = SallaDatabase.connection;
    const logs = await db.models.MessageLog.findAll({
      limit: 100, order: [['created_at', 'DESC']], include: ['Tenant']
    });
    res.render('admin/logs.html', { page: 'logs', logs, now_date: new Date().toLocaleDateString('ar-SA') });
  } catch (e) {
    res.status(500).send('Error: ' + e.message);
  }
});

router.get('/plans', async (req, res) => {
  try {
    const db = SallaDatabase.connection;
    const plans = await db.models.Plan.findAll();
    res.render('admin/plans.html', { page: 'plans', plans, now_date: new Date().toLocaleDateString('ar-SA') });
  } catch (e) {
    res.status(500).send('Error: ' + e.message);
  }
});

router.post('/plans/save', async (req, res) => {
  try {
    const db = SallaDatabase.connection;
    const { id, name, price_monthly, price_yearly, msg_limit_monthly } = req.body;
    const features = {
      whatsapp_count: parseInt(req.body.whatsapp_count || 1),
      team_members: parseInt(req.body.feat_team_members || 1),
      campaigns: req.body.feat_campaigns === 'on',
      automation: req.body.feat_automation === 'on',
      ai_enabled: req.body.feat_ai_enabled === 'on',
      ai_model: req.body.feat_ai_model || 'gpt-3.5-turbo',
      ai_training_docs: parseInt(req.body.feat_ai_training_docs || 0),
      remove_branding: req.body.feat_remove_branding === 'on',
      api_access: req.body.feat_api_access === 'on',
      support_level: req.body.feat_support_level || 'email',
      badge: req.body.ui_badge || '',
      color: req.body.ui_color || 'gray',
      is_visible: req.body.is_visible === 'on'
    };

    if (id) {
      await db.models.Plan.update({ name, price_monthly, price_yearly, msg_limit_monthly, features }, { where: { id } });
    } else {
      await db.models.Plan.create({ name, price_monthly, price_yearly, msg_limit_monthly, features });
    }
    res.redirect('/admin/plans?status=saved');
  } catch (e) {
    res.status(500).send('Error saving plan: ' + e.message);
  }
});

router.get('/billing', async (req, res) => {
  try {
    const db = SallaDatabase.connection;
    const transactions = db.models.Payment
      ? await db.models.Payment.findAll({ include: ['Tenant', 'Plan'], order: [['created_at', 'DESC']] })
      : [];
    res.render('admin/billing.html', { page: 'billing', transactions });
  } catch (e) {
    res.status(500).send('Error: ' + e.message);
  }
});

// 📊 تقارير حقيقية مجمّعة من قاعدة البيانات
async function buildReportData() {
  const db = SallaDatabase.connection;
  const { fn, col, literal } = require('sequelize');

  const tenants = await db.models.Tenant.findAll({
    include: [{ model: db.models.Subscription, as: 'Subscription', include: [{ model: db.models.Plan, as: 'Plan' }] }]
  });
  const totalTenants = tenants.length;
  const activeSubs = tenants.filter(t => t.Subscription && t.Subscription.status === 'active').length;
  let mrr = 0;
  const planDist = {};
  tenants.forEach(t => {
    const pname = t.Subscription?.Plan?.name || 'بدون باقة';
    planDist[pname] = (planDist[pname] || 0) + 1;
    if (t.Subscription && (t.Subscription.status === 'active' || t.Subscription.status === 'trial')) {
      mrr += Number(t.Subscription.Plan?.price_monthly || 0);
    }
  });

  const totalOut = await db.models.MessageLog.count({ where: { direction: 'out' } });
  const totalIn = await db.models.MessageLog.count({ where: { direction: 'in' } });

  // أعلى المتاجر نشاطاً (حسب الرسائل الصادرة)
  let topTenants = [];
  try {
    const grouped = await db.models.MessageLog.findAll({
      attributes: ['tenant_id', [fn('COUNT', col('id')), 'cnt']],
      where: { direction: 'out' },
      group: ['tenant_id'], order: [[literal('cnt'), 'DESC']], limit: 8, raw: true
    });
    for (const g of grouped) {
      const t = tenants.find(x => String(x.id) === String(g.tenant_id));
      if (t) topTenants.push({ name: t.store_name, plan: t.Subscription?.Plan?.name || '—', sent: Number(g.cnt) });
    }
  } catch (e) { /* تجاهل */ }

  return { totalTenants, activeSubs, mrr, totalOut, totalIn, planDist, topTenants };
}

router.get('/reports', async (req, res) => {
  try {
    const data = await buildReportData();
    res.render('admin/reports.html', {
      page: 'reports', now_date: new Date().toLocaleDateString('ar-SA'),
      ...data,
      planLabels: JSON.stringify(Object.keys(data.planDist)),
      planValues: JSON.stringify(Object.values(data.planDist))
    });
  } catch (e) {
    res.status(500).send('Error: ' + e.message);
  }
});

// 📥 تصدير التقرير CSV
router.get('/reports/export', async (req, res) => {
  try {
    const d = await buildReportData();
    const esc = (v) => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`;
    let csv = 'مؤشّر,القيمة\n';
    csv += [esc('إجمالي المتاجر'), d.totalTenants].join(',') + '\n';
    csv += [esc('اشتراكات نشطة'), d.activeSubs].join(',') + '\n';
    csv += [esc('الإيراد الشهري المتكرر (MRR)'), d.mrr].join(',') + '\n';
    csv += [esc('رسائل صادرة'), d.totalOut].join(',') + '\n';
    csv += [esc('رسائل واردة'), d.totalIn].join(',') + '\n\n';
    csv += 'توزيع الباقات,العدد\n';
    for (const [k, v] of Object.entries(d.planDist)) csv += [esc(k), v].join(',') + '\n';
    csv += '\nأعلى المتاجر,الباقة,رسائل صادرة\n';
    for (const t of d.topTenants) csv += [esc(t.name), esc(t.plan), t.sent].join(',') + '\n';
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="mobhir_report.csv"');
    res.send('﻿' + csv);
  } catch (e) {
    res.status(500).send('Error: ' + e.message);
  }
});

router.get('/usage', async (req, res) => {
  try {
    res.render('admin/usage.html', { page: 'usage', now_date: new Date().toLocaleDateString('ar-SA') });
  } catch (e) {
    res.status(500).send('Error: ' + e.message);
  }
});

router.get('/settings', async (req, res) => {
  try {
    res.render('admin/settings.html', { page: 'settings', now_date: new Date().toLocaleDateString('ar-SA') });
  } catch (e) {
    res.status(500).send('Error: ' + e.message);
  }
});

router.get('/support', async (req, res) => {
  try {
    res.render('admin/support.html', { page: 'support', now_date: new Date().toLocaleDateString('ar-SA') });
  } catch (e) {
    res.status(500).send('Error: ' + e.message);
  }
});

// 📱 تحكم إداري بجلسة واتساب لتاجر: إعادة تشغيل (إصلاح العالق، يحتفظ بالربط)
router.post('/wa/:id/restart', async (req, res) => {
  try { await waWeb.restart(req.params.id); res.json({ ok: true }); }
  catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// 📱 تحكم إداري: فصل نهائي (يحذف الربط — يحتاج التاجر يمسح QR من جديد)
router.post('/wa/:id/logout', async (req, res) => {
  try { await waWeb.logout(req.params.id); res.json({ ok: true }); }
  catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// 👥 عملاء جميع التجار (لمالك المنصة) — مع أرقامهم
router.get('/customers', async (req, res) => {
  try {
    const db = SallaDatabase.connection;
    const customers = await db.models.Customer.findAll({
      include: ['Tenant'],
      order: [['created_at', 'DESC']],
      limit: 1000
    });
    const total = await db.models.Customer.count();
    const tenantsCount = await db.models.Tenant.count();
    res.render('admin/customers.html', {
      page: 'customers', customers, total, tenantsCount,
      now_date: new Date().toLocaleDateString('ar-SA')
    });
  } catch (e) {
    res.status(500).send('Error: ' + e.message);
  }
});

// 📥 تصدير كل العملاء كملف CSV (يفتح في Excel)
router.get('/customers/export', async (req, res) => {
  try {
    const db = SallaDatabase.connection;
    const customers = await db.models.Customer.findAll({
      include: ['Tenant'], order: [['created_at', 'DESC']]
    });
    const esc = (v) => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`;
    let csv = 'المتجر,اسم العميل,رقم الجوال,البريد,عدد الطلبات,إجمالي الإنفاق,تاريخ الإضافة\n';
    for (const c of customers) {
      const joined = c.created_at ? new Date(c.created_at).toISOString().slice(0, 10) : '';
      csv += [esc(c.Tenant?.store_name), esc(c.name), esc(c.phone), esc(c.email),
        c.total_orders || 0, c.total_spent || 0, esc(joined)].join(',') + '\n';
    }
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="all_customers.csv"');
    res.send('﻿' + csv); // BOM ليعرض Excel العربية صح
  } catch (e) {
    res.status(500).send('Error: ' + e.message);
  }
});

module.exports = router;
