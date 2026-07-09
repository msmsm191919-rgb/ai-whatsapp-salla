const express = require('express');
const router = express.Router();
const SallaDatabase = require('../database/db_instance');
const waWeb = require('../services/waWeb');

// CSV Sanitization Helper to prevent CSV Formula Injection (OWASP)
const sanitizeCsv = (v) => {
  const str = String(v == null ? '' : v);
  if (str.startsWith('=') || str.startsWith('+') || str.startsWith('-') || str.startsWith('@')) {
    return `'${str}`;
  }
  return str;
};
const esc = (v) => `"${sanitizeCsv(v).replace(/"/g, '""')}"`;

router.get('/', async (req, res) => {
  try {
    const db = SallaDatabase.connection;
    const tenants = await db.models.Tenant.findAll({
      include: [
        'WhatsAppConfig',
        { model: db.models.Subscription, as: 'Subscription', include: [{ model: db.models.Plan, as: 'Plan' }] }
      ]
    });

    const active_tenants = tenants.filter(t => 
      t.status === 'active' && 
      t.Subscription && 
      (t.Subscription.status === 'active' || t.Subscription.status === 'trial') && 
      (!t.Subscription.end_date || new Date(t.Subscription.end_date) > new Date())
    );
    const active_tenants_count = active_tenants.length;
    const disconnected_count = tenants.filter(t => !t.WhatsAppConfig || !t.WhatsAppConfig.access_token).length;

    // Trial and Expired counts independently
    const trial_subs_count = tenants.filter(t => t.Subscription && t.Subscription.status === 'trial' && (!t.Subscription.end_date || new Date(t.Subscription.end_date) > new Date())).length;
    const expired_subs_count = tenants.filter(t => t.Subscription && (t.Subscription.status === 'expired' || (t.Subscription.end_date && new Date(t.Subscription.end_date) < new Date()))).length;

    let mrr = 0;
    tenants.forEach(t => {
      if (t.status === 'active' && t.Subscription && t.Subscription.status === 'active' && (!t.Subscription.end_date || new Date(t.Subscription.end_date) > new Date())) {
        const isYearly = (t.Subscription.is_yearly === true || t.Subscription.is_yearly === 1 || t.Subscription.is_yearly === '1');
        const plan = t.Subscription.Plan;
        if (plan) {
          mrr += isYearly ? Number(plan.price_yearly || 0) / 12 : Number(plan.price_monthly || 0);
        }
      }
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

    // Dynamic AI Requests count for the current month
    const period = new Date().toISOString().slice(0, 7);
    const ai_usage_count = await db.models.UsageCounter.sum('ai_requests', { where: { period_key: period } }) || 0;

    // Today new signups count
    const todayStart = new Date();
    todayStart.setHours(0,0,0,0);
    const todayNewCount = tenants.filter(t => t.createdAt && new Date(t.createdAt) >= todayStart).length;

    // Real Growth line chart data (past 7 days outgoing logs grouped by day in JS)
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const logs = await db.models.MessageLog.findAll({
      where: {
        direction: 'out',
        created_at: { [require('sequelize').Op.gte]: sevenDaysAgo }
      },
      raw: true
    });
    const dailyCounts = {};
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const dateStr = d.toLocaleDateString('ar-SA', { month: 'numeric', day: 'numeric' });
      dailyCounts[dateStr] = 0;
    }
    logs.forEach(l => {
      const dateVal = l.created_at || l.createdAt;
      if (dateVal) {
        const d = new Date(dateVal);
        const dateStr = d.toLocaleDateString('ar-SA', { month: 'numeric', day: 'numeric' });
        if (dailyCounts[dateStr] !== undefined) {
          dailyCounts[dateStr]++;
        }
      }
    });

    const now_date = new Date().toLocaleDateString('ar-SA', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

    const rData = await buildReportData();
    const planLabels = JSON.stringify(Object.keys(rData.planDist));
    const planValues = JSON.stringify(Object.values(rData.planDist));

    res.render('admin/index.html', {
      page: 'overview', tenants_count: tenants.length,
      active_tenants_count, disconnected_count,
      trial_subs_count, expired_subs_count,
      total_messages_month, ai_usage_count, todayNewCount,
      mrr: mrr.toLocaleString(), arr: (mrr * 12).toLocaleString(),
      recent_tenants, recent_logs, now_date,
      chartLabels: JSON.stringify(Object.keys(dailyCounts)),
      chartValues: JSON.stringify(Object.values(dailyCounts)),
      planDist: rData.planDist,
      planLabels,
      planValues
    });
  } catch (e) {
    res.status(500).send(e.message);
  }
});

router.get('/tenants', async (req, res) => {
  try {
    const db = SallaDatabase.connection;
    const tenants = await db.models.Tenant.findAll({
      include: ['WhatsAppConfig', { model: db.models.Subscription, as: 'Subscription', include: [{ model: db.models.Plan, as: 'Plan' }] }],
      order: [['createdAt', 'DESC']]
    });

    const period = new Date().toISOString().slice(0, 7);
    const counters = await db.models.UsageCounter.findAll({ where: { period_key: period } });

    // AI Users count: active merchants with plan features including AI (checking both ai_advanced and ai_enabled)
    const aiUsersCount = tenants.filter(t => {
      if (t.status !== 'active') return false;
      const sub = t.Subscription;
      if (!sub || (sub.status !== 'active' && sub.status !== 'trial')) return false;
      if (sub.end_date && new Date(sub.end_date) < new Date()) return false;
      const plan = sub.Plan;
      if (!plan) return false;
      const feats = typeof plan.features === 'string' ? JSON.parse(plan.features) : plan.features;
      return feats && (feats.ai_advanced === true || feats.ai_enabled === true);
    }).length;

    const activeCount = tenants.filter(t => 
      t.status === 'active' && 
      t.Subscription && 
      (t.Subscription.status === 'active' || t.Subscription.status === 'trial') && 
      (!t.Subscription.end_date || new Date(t.Subscription.end_date) > new Date())
    ).length;
    const activePct = tenants.length > 0 ? Math.round((activeCount / tenants.length) * 100) : 0;

    const formattedTenants = tenants.map(t => {
      const tJson = t.toJSON();
      const c = counters.find(x => String(x.tenant_id) === String(t.id));
      const sent = c ? c.messages_sent : 0;
      const limit = t.Subscription?.Plan?.msg_limit_monthly || 0;
      const isUnlimited = (limit === -1 || limit === 0);
      tJson.msg_sent = sent;
      tJson.msg_limit = limit;
      tJson.msg_pct = isUnlimited ? 0 : Math.max(0, Math.min(100, Math.round((sent / limit) * 100)));
      tJson.is_unlimited = isUnlimited;

      // Determine overall_status priority: suspended -> expired -> trial -> inactive -> active
      let overall = 'inactive';
      const sub = t.Subscription;
      if (t.status === 'suspended_manual' || t.status === 'blocked_payment' || t.status === 'blocked_over_limit') {
        overall = 'suspended';
      } else if (!sub) {
        overall = 'inactive';
      } else if (sub.status === 'expired' || (sub.end_date && new Date(sub.end_date) < new Date())) {
        overall = 'expired';
      } else if (sub.status === 'trial') {
        overall = 'trial';
      } else if (t.status === 'active' && sub.status === 'active') {
        overall = 'active';
      }
      tJson.overall_status = overall;
      return tJson;
    });

    const waStatus = {};
    tenants.forEach(t => { waStatus[t.id] = waWeb.getState(t.id).status; });
    const waConnected = Object.values(waStatus).filter(s => s === 'ready').length;

    res.render('admin/tenants.html', { 
      page: 'tenants', now_date: new Date().toLocaleDateString('ar-SA'), 
      tenants: formattedTenants, waStatus, waConnected, aiUsersCount, activePct 
    });
  } catch (e) {
    res.status(500).send(e.message);
  }
});

router.get('/tenants/export', async (req, res) => {
  try {
    const db = SallaDatabase.connection;
    const tenants = await db.models.Tenant.findAll({
      include: ['Subscription']
    });
    let csv = 'اسم المتجر,Merchant ID,النطاق,البريد الإلكتروني,الحالة,تاريخ الانضمام\n';
    for (const t of tenants) {
      const joined = t.createdAt ? new Date(t.createdAt).toISOString().slice(0, 10) : '';
      csv += [
        esc(t.store_name),
        esc(t.salla_merchant_id),
        esc(t.store_domain),
        esc(t.email),
        esc(t.status),
        esc(joined)
      ].join(',') + '\n';
    }
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="all_tenants.csv"');
    res.send('\uFEFF' + csv);
  } catch (e) {
    res.status(500).send('Error: ' + e.message);
  }
});

router.get('/subscriptions', async (req, res) => {
  try {
    const db = SallaDatabase.connection;
    const subscriptions = await db.models.Subscription.findAll({
      include: ['Tenant', 'Plan'], order: [['created_at', 'DESC']]
    });

    const formattedSubs = subscriptions.map(sub => {
      const sJson = sub.toJSON();
      if (sub.end_date) {
        const diffTime = new Date(sub.end_date) - new Date();
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        sJson.days_left = diffDays > 0 ? diffDays : 0;
        sJson.end_date = new Date(sub.end_date).toLocaleDateString('ar-SA');
      } else {
        sJson.days_left = 9999;
        sJson.end_date = '—';
      }
      sJson.start_date = sub.start_date ? new Date(sub.start_date).toLocaleDateString('ar-SA') : '—';
      return sJson;
    });

    res.render('admin/subscriptions.html', { page: 'subscriptions', subscriptions: formattedSubs });
  } catch (e) {
    res.status(500).send('Error: ' + e.message);
  }
});

router.post('/subscriptions/:id/renew', async (req, res) => {
  try {
    const db = SallaDatabase.connection;
    const sub = await db.models.Subscription.findByPk(req.params.id);
    if (!sub) return res.status(404).json({ ok: false, error: 'الاشتراك غير موجود' });
    const base = (sub.end_date && new Date(sub.end_date) > new Date()) ? new Date(sub.end_date) : new Date();
    base.setDate(base.getDate() + 30);
    await sub.update({ end_date: base, status: 'active' });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
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

router.get('/logs/:id', async (req, res) => {
  try {
    const db = SallaDatabase.connection;
    const log = await db.models.MessageLog.findByPk(req.params.id);
    if (!log) return res.status(404).json({ error: 'Log not found' });

    // Allowlist only to prevent secrets inside metadata from leaking
    const safeLog = {
      id: log.id,
      tenant_id: log.tenant_id,
      direction: log.direction,
      content: log.content,
      status: log.status,
      createdAt: log.createdAt || log.created_at
    };
    res.json(safeLog);
  } catch (e) {
    res.status(500).json({ error: 'Internal server error' });
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
      campaigns: req.body.feat_campaigns === 'on',
      automation: req.body.feat_automation === 'on',
      ai_enabled: req.body.feat_ai_enabled === 'on',
      ai_model: req.body.feat_ai_model || 'gpt-4o-mini',
      api_access: req.body.feat_api_access === 'on',
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

    const formattedTxns = transactions.map(t => {
      const tJson = t.toJSON();
      const dateVal = t.createdAt || t.created_at;
      tJson.date = dateVal ? new Date(dateVal).toLocaleDateString('ar-SA') : '—';
      return tJson;
    });

    const period = new Date().toISOString().slice(0, 7);
    let totalRevenue = 0, monthOps = 0;
    const failedCount = transactions.filter(t => t.status === 'failed').length;

    for (const t of transactions) {
      const ok = (t.status === 'completed' || t.status === 'success' || t.status === 'paid');
      if (ok) totalRevenue += Number(t.amount || 0);
      const dateVal = t.createdAt || t.created_at;
      const d = dateVal ? new Date(dateVal).toISOString().slice(0, 7) : '';
      if (ok && d === period) monthOps++;
    }

    res.render('admin/billing.html', { 
      page: 'billing', transactions: formattedTxns, totalRevenue, monthOps, 
      txCount: transactions.length, failedCount 
    });
  } catch (e) {
    res.status(500).send('Error: ' + e.message);
  }
});

async function buildReportData() {
  const db = SallaDatabase.connection;
  const { fn, col, literal } = require('sequelize');

  const tenants = await db.models.Tenant.findAll({
    include: [{ model: db.models.Subscription, as: 'Subscription', include: [{ model: db.models.Plan, as: 'Plan' }] }]
  });
  const totalTenants = tenants.length;
  const activeSubs = tenants.filter(t => 
    t.status === 'active' && 
    t.Subscription && 
    (t.Subscription.status === 'active' || t.Subscription.status === 'trial') && 
    (!t.Subscription.end_date || new Date(t.Subscription.end_date) > new Date())
  ).length;

  let mrr = 0;
  const planDist = {};
  tenants.forEach(t => {
    const pname = t.Subscription?.Plan?.name || 'بدون باقة';
    planDist[pname] = (planDist[pname] || 0) + 1;
    if (t.status === 'active' && t.Subscription && t.Subscription.status === 'active' && (!t.Subscription.end_date || new Date(t.Subscription.end_date) > new Date())) {
      const isYearly = (t.Subscription.is_yearly === true || t.Subscription.is_yearly === 1 || t.Subscription.is_yearly === '1');
      const plan = t.Subscription.Plan;
      if (plan) {
        mrr += isYearly ? Number(plan.price_yearly || 0) / 12 : Number(plan.price_monthly || 0);
      }
    }
  });

  const totalOut = await db.models.MessageLog.count({ where: { direction: 'out' } });
  const totalIn = await db.models.MessageLog.count({ where: { direction: 'in' } });

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
  } catch (e) { /* ignore */ }

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

router.get('/reports/export', async (req, res) => {
  try {
    const d = await buildReportData();
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
    res.send('\uFEFF' + csv);
  } catch (e) {
    res.status(500).send('Error: ' + e.message);
  }
});

router.get('/usage', async (req, res) => {
  try {
    const db = SallaDatabase.connection;
    const period = new Date().toISOString().slice(0, 7); // YYYY-MM
    const counters = await db.models.UsageCounter.findAll({ where: { period_key: period } });
    const tenants = await db.models.Tenant.findAll({
      include: [{ model: db.models.Subscription, as: 'Subscription', include: [{ model: db.models.Plan, as: 'Plan' }] }]
    });

    let totalMsgs = 0, totalAI = 0, overCount = 0;
    const rows = [];
    for (const t of tenants) {
      const c = counters.find(x => String(x.tenant_id) === String(t.id));
      const sent = c ? c.messages_sent : 0;
      const ai = c ? c.ai_requests : 0;
      totalMsgs += sent; totalAI += ai;
      const limit = t.Subscription?.Plan?.msg_limit_monthly || 0;
      const isUnlimited = (limit === -1 || limit === 0);
      const over = !isUnlimited && sent > limit;
      if (over) overCount++;
      const pct = isUnlimited ? 0 : Math.max(0, Math.min(100, Math.round((sent / limit) * 100)));
      rows.push({ name: t.store_name, plan: t.Subscription?.Plan?.name || '—', sent, ai, limit, over, pct, is_unlimited: isUnlimited });
    }
    rows.sort((a, b) => b.sent - a.sent);

    // AI Token detailed statistics from AiUsageLog
    const aiLogs = db.models.AiUsageLog ? await db.models.AiUsageLog.findAll({
      include: ['Tenant']
    }) : [];

    const aiStatsGroups = {};
    aiLogs.forEach(log => {
      const dateObj = new Date(log.createdAt || log.created_at || Date.now());
      const monthKey = dateObj.toISOString().slice(0, 7); // YYYY-MM
      const key = `${log.tenant_id}_${log.model}_${monthKey}_${log.feature_source}`;

      if (!aiStatsGroups[key]) {
        aiStatsGroups[key] = {
          tenant_id: log.tenant_id,
          store_name: log.Tenant?.store_name || '—',
          model: log.model,
          month: monthKey,
          feature_source: log.feature_source,
          requests_count: 0,
          prompt_tokens: 0,
          cached_tokens: 0,
          completion_tokens: 0,
          total_tokens: 0,
          estimated_cost: 0.0,
          pricing_status: log.pricing_status
        };
      }

      const g = aiStatsGroups[key];
      g.requests_count++;
      g.prompt_tokens += (log.prompt_tokens || 0);
      g.cached_tokens += (log.cached_tokens || 0);
      g.completion_tokens += (log.completion_tokens || 0);
      g.total_tokens += (log.total_tokens || 0);
      g.estimated_cost += Number(log.estimated_cost || 0.0);
    });

    const aiStatsRows = Object.values(aiStatsGroups).map(row => {
      const t = tenants.find(x => x.id === row.tenant_id);
      let limit = 0;
      try {
        const plan = t?.Subscription?.Plan;
        if (plan) {
          const feats = typeof plan.features === 'string' ? JSON.parse(plan.features) : plan.features;
          limit = feats?.limits?.ai_replies_monthly !== undefined ? feats.limits.ai_replies_monthly : (feats?.ai_replies_monthly || 0);
        }
      } catch (e) {}

      const isUnlimited = (limit === -1);
      const remaining = isUnlimited ? -1 : Math.max(0, limit - row.requests_count);
      const pct = isUnlimited ? 0 : Math.max(0, Math.min(100, Math.round((row.requests_count / limit) * 100)));

      return {
        ...row,
        limit,
        remaining,
        pct,
        is_unlimited: isUnlimited,
        estimated_cost_formatted: row.estimated_cost.toFixed(4)
      };
    });

    res.render('admin/usage.html', { 
      page: 'usage', now_date: new Date().toLocaleDateString('ar-SA'), 
      totalMsgs, totalAI, overCount, rows, aiStatsRows 
    });
  } catch (e) {
    res.status(500).send('Error: ' + e.message);
  }
});

const _settingsPath = require('path').join(process.cwd(), 'database', 'platform_settings.json');
function _loadSettings() {
  try { 
    const raw = require('fs').readFileSync(_settingsPath, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed.support_whatsapp) parsed.support_whatsapp = '';
    return parsed;
  }
  catch (e) { 
    return { 
      system_name: 'مبهر AI', 
      support_email: 'support@mobhir.ai', 
      support_whatsapp: '', 
      maintenance: false, 
      footer: 'جميع الحقوق محفوظة © 2026 مبهر AI' 
    }; 
  }
}

router.get('/settings', async (req, res) => {
  try {
    res.render('admin/settings.html', { page: 'settings', now_date: new Date().toLocaleDateString('ar-SA'), settings: _loadSettings() });
  } catch (e) {
    res.status(500).send('Error: ' + e.message);
  }
});

router.post('/settings/save', async (req, res) => {
  try {
    const s = {
      system_name: (req.body.system_name || '').toString().trim() || 'مبهر AI',
      support_email: (req.body.support_email || '').toString().trim() || 'mubhirbot@gmail.com',
      support_whatsapp: (req.body.support_whatsapp || '').toString().trim(),
      maintenance: req.body.maintenance === true || req.body.maintenance === 'true',
      footer: (req.body.footer || '').toString()
    };
    require('fs').writeFileSync(_settingsPath, JSON.stringify(s, null, 2), 'utf8');
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

router.get('/support', async (req, res) => {
  try {
    res.render('admin/support.html', { 
      page: 'support', 
      now_date: new Date().toLocaleDateString('ar-SA'), 
      settings: _loadSettings() 
    });
  } catch (e) {
    res.status(500).send('Error: ' + e.message);
  }
});

router.post('/wa/:id/restart', async (req, res) => {
  try { await waWeb.restart(req.params.id); res.json({ ok: true }); }
  catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

router.post('/wa/:id/logout', async (req, res) => {
  try { await waWeb.logout(req.params.id); res.json({ ok: true }); }
  catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

router.get('/customers', async (req, res) => {
  try {
    const db = SallaDatabase.connection;
    const tenantFilter = req.query.tenant ? parseInt(req.query.tenant, 10) : null;
    const where = tenantFilter ? { tenant_id: tenantFilter } : {};

    const customers = await db.models.Customer.findAll({
      where, include: ['Tenant'],
      order: [['created_at', 'DESC']], limit: 1000
    });
    const total = await db.models.Customer.count({ where });
    const allTenants = await db.models.Tenant.findAll({ attributes: ['id', 'store_name'], order: [['store_name', 'ASC']] });
    const selectedTenant = tenantFilter ? allTenants.find(t => t.id === tenantFilter) : null;

    res.render('admin/customers.html', {
      page: 'customers', customers, total,
      tenantsCount: allTenants.length, allTenants,
      tenantFilter, selectedTenant,
      now_date: new Date().toLocaleDateString('ar-SA')
    });
  } catch (e) {
    res.status(500).send('Error: ' + e.message);
  }
});

router.get('/customers/export', async (req, res) => {
  try {
    const db = SallaDatabase.connection;
    const tenantFilter = req.query.tenant ? parseInt(req.query.tenant, 10) : null;
    const where = tenantFilter ? { tenant_id: tenantFilter } : {};
    const customers = await db.models.Customer.findAll({
      where, include: ['Tenant'], order: [['created_at', 'DESC']]
    });
    let csv = 'المتجر,اسم العميل,رقم الجوال,البريد,عدد الطلبات,إجمالي الإنفاق,تاريخ الإضافة\n';
    for (const c of customers) {
      const joined = c.created_at ? new Date(c.created_at).toISOString().slice(0, 10) : '';
      csv += [esc(c.Tenant?.store_name), esc(c.name), esc(c.phone), esc(c.email),
        c.total_orders || 0, c.total_spent || 0, esc(joined)].join(',') + '\n';
    }
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="all_customers.csv"');
    res.send('\uFEFF' + csv);
  } catch (e) {
    res.status(500).send('Error: ' + e.message);
  }
});

module.exports = router;
