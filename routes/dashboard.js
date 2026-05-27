const express = require('express');
const router = express.Router();
const SallaDatabase = require('../database/db_instance');
const { Op } = require('sequelize');

router.get('/', async (req, res) => {
  try {
    console.log(`\n=================== [RUNTIME DASHBOARD LOAD DEBUG] ===================`);
    console.log(`- Source Route: /dashboard`);
    console.log(`- Session Tenant (req.user):`, req.user);

    const db = SallaDatabase.connection;
    const merchantId = req.user?.merchant?.id;
    console.log(`- Tenant Resolver - Querying salla_merchant_id: ${merchantId}`);

    const tenant = await db.models.Tenant.findOne({
      where: { salla_merchant_id: merchantId },
      include: [
        { model: db.models.Subscription, include: [db.models.Plan] },
        'WhatsAppConfig'
      ]
    });

    if (!tenant) {
      console.log(`- Tenant Resolver Result: NOT FOUND`);
      console.log(`  (Fallback Reason: Tenant does not exist in DB for salla_merchant_id: ${merchantId})`);
      console.log(`======================================================================\n`);
    } else {
      console.log(`- Tenant Resolver Result: FOUND`);
      console.log(`  - Tenant ID: ${tenant.id}`);
      console.log(`  - Platform: ${tenant.platform}`);
      console.log(`  - Store Name: ${tenant.store_name}`);
      console.log(`  - Salla Merchant ID: ${tenant.salla_merchant_id}`);
      
      const sub = tenant.Subscription;
      if (!sub) {
        console.log(`- Subscription Resolver Result: NOT FOUND`);
        console.log(`  (Fallback Reason: Tenant has no active Subscription associated)`);
      } else {
        console.log(`- Subscription Resolver Result: FOUND`);
        console.log(`  - Subscription ID: ${sub.id}`);
        console.log(`  - Plan Name: ${sub.Plan?.name}`);
        console.log(`  - Subscription Status: ${sub.status}`);
      }
      console.log(`======================================================================\n`);
    }

    const isConnected = !!(tenant?.WhatsAppConfig?.access_token);
    const subscription = tenant?.Subscription;
    const plan = subscription?.Plan;
    const planName = plan?.name || 'الأساسية';
    const planFeatures = plan?.features || {};
    const msgLimit = plan?.msg_limit_monthly || 1000;
    const priceMonthly = plan?.price_monthly || 0;
    const priceYearly = plan?.price_yearly || 0;
    const subStatus = subscription?.status || 'trial';
    const isYearly = subscription?.is_yearly || false;
    const subEndDate = subscription?.end_date;

    const currentPeriod = new Date().toISOString().slice(0, 7);
    const currentUsage = await db.models.UsageCounter.findOne({
      where: { tenant_id: tenant?.id, period_key: currentPeriod }
    });
    const messagesSent = currentUsage?.messages_sent || 0;
    const aiRequests = currentUsage?.ai_requests || 0;
    const usagePercent = msgLimit > 0 ? Math.min(Math.round((messagesSent / msgLimit) * 100), 100) : 0;
    const messagesRemaining = msgLimit > 0 ? Math.max(msgLimit - messagesSent, 0) : '∞';

    const recentLogs = await db.models.MessageLog.findAll({
      where: { tenant_id: tenant?.id },
      order: [['created_at', 'DESC']],
      limit: 5
    });

    // Real chart data from last 7 days
    const chartLabels = [];
    const chartData = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const dayStart = new Date(d); dayStart.setHours(0, 0, 0, 0);
      const dayEnd = new Date(d); dayEnd.setHours(23, 59, 59, 999);
      chartLabels.push(d.toLocaleDateString('ar-SA', { weekday: 'short' }));
      const count = await db.models.MessageLog.count({
        where: { tenant_id: tenant?.id, direction: 'out', created_at: { [Op.between]: [dayStart, dayEnd] } }
      });
      chartData.push(count);
    }

    const lastMonthKey = new Date(new Date().setMonth(new Date().getMonth() - 1)).toISOString().slice(0, 7);
    const lastMonthUsage = await db.models.UsageCounter.findOne({
      where: { tenant_id: tenant?.id, period_key: lastMonthKey }
    });
    const lastAI = lastMonthUsage?.ai_requests || 0;
    let growthPercent = lastAI > 0 ? ((aiRequests - lastAI) / lastAI) * 100 : (aiRequests > 0 ? 100 : 0);

    const campaignsCount = await db.models.Campaign.count({ where: { tenant_id: tenant?.id } });
    const contactsCount = await db.models.Customer.count({ where: { tenant_id: tenant?.id } });
    const renewalDate = subEndDate
      ? new Date(subEndDate).toLocaleDateString('ar-SA', { year: 'numeric', month: 'long', day: 'numeric' })
      : 'غير محدد';

    res.render('dashboard.html', {
      tenant, user: req.user, activePage: 'dashboard', isConnected,
      plan_name: planName, plan_price: isYearly ? priceYearly : priceMonthly,
      plan_billing: isYearly ? 'سنوي' : 'شهري', plan_features: planFeatures,
      sub_status: subStatus, renewal_date: renewalDate,
      trial_days_left: (subStatus === 'trial' && subEndDate)
        ? Math.ceil((new Date(subEndDate) - new Date()) / (1000 * 60 * 60 * 24)) : null,
      messages_sent: messagesSent, msg_limit: msgLimit,
      messages_remaining: messagesRemaining, usage_percent: usagePercent,
      ai_replies: aiRequests, ai_growth: growthPercent.toFixed(1),
      campaigns_count: campaignsCount, contacts_count: contactsCount,
      recentLogs, chartLabels: JSON.stringify(chartLabels), chartData: JSON.stringify(chartData),
    });
  } catch (e) {
    console.error(e);
    res.status(500).send('Dashboard Error: ' + e.message);
  }
});

module.exports = router;
