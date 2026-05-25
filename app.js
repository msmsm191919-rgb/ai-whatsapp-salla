// Import Deps
require("dotenv").config();
const express = require("express");
const app = express();
const session = require("express-session");
const passport = require("passport");
const consolidate = require("consolidate");
const nunjucks = require("nunjucks");
const path = require("path");
const getUnixTimestamp = require("./helpers/getUnixTimestamp");
const port = process.argv[2] || 8095;

/*
  Create a .env file in the root directory of your project. 
  Add environment-specific variables on new lines in the form of NAME=VALUE.
*/
const {
  SALLA_OAUTH_CLIENT_ID,
  SALLA_OAUTH_CLIENT_SECRET,
  SALLA_OAUTH_CLIENT_REDIRECT_URI,
  SALLA_WEBHOOK_SECRET,
  SALLA_DATABASE_ORM,
} = process.env;

// Import Salla APIs
const SallaAPIFactory = require("@salla.sa/passport-strategy");
// Database Singleton (Centralized)
const SallaDatabase = require("./database/db_instance");
const SallaWebhook = require("@salla.sa/webhooks-actions");

if (SALLA_WEBHOOK_SECRET) {
  SallaWebhook.setSecret(SALLA_WEBHOOK_SECRET);
}

// Add Listeners
SallaWebhook.on("app.installed", (eventBody, userArgs) => {
  console.log("App Installed Event:", eventBody);
});

SallaWebhook.on("app.store.authorize", (eventBody, userArgs) => {
  console.log("App Store Authorize Event:", eventBody);
});

SallaWebhook.on("all", (eventBody, userArgs) => {
  // Handle all events (Optional logging)
  // console.log("Event Received:", eventBody.event);
});

const { sendMetaMessage, uploadMetaMedia, sendMetaImage, sendMetaTemplate } = require('./helpers/metaProvider');
const { checkLimit, incrementUsage } = require('./helpers/limitsEngine');
const AIService = require('./services/AIService');
const ScenarioService = require('./services/ScenarioService');


// Event Listeners for Scenarios
SallaWebhook.on('basket.abandoned', async (data, next) => {
  try {
    console.log('🛒 Basket Abandoned Event Received');
    const ScenarioService = require('./services/ScenarioService');
    await ScenarioService.handleAbandonedCart(data);
  } catch (e) {
    console.error("Webhook Delegate Error:", e);
  }
});

SallaWebhook.on('order.created', async (data, next) => {
  console.log('📦 New Order Created:', data.data.id);
  // Optional: Send Order Confirmation here
});

SallaWebhook.on('order.shipping.delivered', async (data, next) => {
  try {
    console.log('🚚 Order Delivered Event (Triggering Review Request)');
    const ScenarioService = require('./services/ScenarioService');
    await ScenarioService.handleOrderCompleted(data);
  } catch (e) {
    console.error("Order Delivered Error:", e);
  }
});

SallaWebhook.on('application/store', async (data, next) => {
  console.log('🔔 Salla Store Updated:', data.merchant);
});

// ── سيناريو "تحديث حالة الطلب" ── يستجيب لـ Salla webhook
const orderStatusScenario = require('./services/scenarios/orderStatus.scenario');
SallaWebhook.on('order.status.updated', async (data, next) => {
  try {
    await orderStatusScenario.handle(data);
  } catch (e) {
    console.error('order.status.updated handler error:', e);
  }
});


const SallaAPI = new SallaAPIFactory({
  clientID: SALLA_OAUTH_CLIENT_ID,
  clientSecret: SALLA_OAUTH_CLIENT_SECRET,
  callbackURL: SALLA_OAUTH_CLIENT_REDIRECT_URI,
});

// Listener on auth success
SallaAPI.onAuth(async (accessToken, refreshToken, expires_in, data) => {
  console.log("🔐 Salla Auth Success. Processing Tenant...");

  SallaDatabase.connect()
    .then(async (connection) => {

      // 1. Create or Update Tenant Logic
      const sallaMerchantData = {
        id: data.merchant.id,
        name: data.merchant.name || data.name, // Fallback
        email: data.email,
        domain: data.merchant.domain
      };

      const tenant = await SallaDatabase.createOrUpdateTenant(sallaMerchantData);
      console.log(`✅ Tenant Identified: ${tenant.store_name} (ID: ${tenant.id})`);

      // 2. Save OAuth Token linked to this Tenant
      await SallaDatabase.saveSallaOAuth(tenant.id, {
        access_token: accessToken,
        refresh_token: refreshToken,
        expires_in: expires_in
      });
      console.log("✅ Tokens Saved securely.");

      // 3. Ensure Trial Subscription
      await SallaDatabase.ensureTrialSubscription(tenant.id);

    })
    .catch((err) => {
      console.log("❌ Error connecting to database or saving tenant: ", err);
    });
});

// Passport session setup
passport.serializeUser(function (user, done) {
  done(null, user);
});

passport.deserializeUser(function (obj, done) {
  done(null, obj);
});

passport.use(SallaAPI.getPassportStrategy());



// ---------------------------------------------------------
// ERROR HANDLING (Prevent Server Crash)
// ---------------------------------------------------------
process.on("uncaughtException", (err) => {
  console.error("🔥 Uncaught Exception:", err);
});

process.on("unhandledRejection", (reason, promise) => {
  console.error("🔥 Unhandled Rejection at:", promise, "reason:", reason);
});

// ---------------------------------------------------------
// CONFIG & MIDDLEWARE
// ---------------------------------------------------------
app.set("views", __dirname + "/views");
app.set("view engine", "html");

// Configure Nunjucks with absolute path
const nunjucksEnv = nunjucks.configure(path.join(__dirname, "views"), {
  autoescape: true,
  express: app,
  noCache: true,
  watch: true
});

// Add 'date' and 'formatDate' filter (alias to be safe)
const dateFilter = function (str, format) {
  if (!str) return '';
  try {
    const date = new Date(str);
    if (isNaN(date.getTime())) return str;

    // Simple formatting YYYY-MM-DD HH:mm
    const d = date.getDate().toString().padStart(2, '0');
    const m = (date.getMonth() + 1).toString().padStart(2, '0');
    const y = date.getFullYear();
    const h = date.getHours().toString().padStart(2, '0');
    const min = date.getMinutes().toString().padStart(2, '0');
    return `${y}-${m}-${d} ${h}:${min}`;
  } catch (e) {
    return str;
  }
};

nunjucksEnv.addFilter('date', dateFilter);
nunjucksEnv.addFilter('formatDate', dateFilter);

// Add 'range' global manually to be safe (fixes 500 errors in templates using range loop)
nunjucksEnv.addGlobal('range', function (start, end, step) {
  var range = [];
  var typeofStart = typeof start;
  var typeofEnd = typeof end;

  if (step === 0) {
    throw TypeError("Step cannot be zero.");
  }

  if (typeofStart == "undefined" || typeofEnd == "undefined") {
    throw TypeError("Must pass start and end arguments.");
  } else if (typeofStart != typeofEnd) {
    throw TypeError("Start and end arguments must be of same type.");
  }

  typeof step == "undefined" && (step = 1);

  if (end < start) {
    step = -step;
  }

  if (step > 0) {
    for (var i = start; i < end; i += step) {
      range.push(i);
    }
  } else {
    for (var i = start; i > end; i += step) {
      range.push(i);
    }
  }

  return range;
});

// Static files
app.use(express.static(__dirname + "/public"));

// Body Parsers - MUST be before any verify middleware
app.use(express.json({ limit: '12mb' }));            // 12mb لاستقبال صور الحملات (base64)
app.use(express.urlencoded({ extended: true, limit: '12mb' }));

// DEV ONLY Mock Auth Middleware REMOVED for Production
// app.use((req, res, next) => { ... });

// Routes
const apiRoutes = require('./routes/api');
const dashboardRoutes = require('./routes/dashboard');
const settingsRoutes = require('./routes/settings');
const adminRoutes = require('./routes/admin');

// 🔒 حقن planContext في كل request (لازم يكون قبل الـ routes)
app.use(require('./services/planGate').injectPlanContext());

// 🧪 حقن isDev للقوالب — يخفي أدوات التطوير (Dev Switcher) في الإنتاج
app.use((req, res, next) => {
  res.locals.isDev = process.env.NODE_ENV !== 'production';
  next();
});

// ⛔ حارس endpoints التطوير — يرجّع 404 في الإنتاج (يمنع تزوير الترقية/الدفع)
const devOnly = (req, res, next) => {
  if (process.env.NODE_ENV === 'production') {
    return res.status(404).json({ ok: false, error: 'Not found' });
  }
  next();
};

app.use('/api', apiRoutes);
app.use('/dashboard', dashboardRoutes);
app.use('/settings', settingsRoutes);
app.use('/admin', adminRoutes);

// DEV TOOL: Force Upgrade
app.get('/force-upgrade', devOnly, async (req, res) => {
  const db = SallaDatabase.connection;
  const tenant = await db.models.Tenant.findOne({ where: { salla_merchant_id: req.user.merchant.id } });
  const [sub] = await db.models.Subscription.findOrCreate({ where: { tenant_id: tenant.id }, defaults: { plan_id: 2 } });
  sub.plan_id = 2; // Pro
  sub.status = 'active';
  await sub.save();
  res.send("<h1>✅ Your account has been forcefully upgraded to PRO!</h1><a href='/dashboard'>Go to Dashboard</a>");
});

// DEV: Simulate Abandoned Cart Route
app.get('/simulate/abandoned-cart', devOnly, async (req, res) => {
  const mockPayload = {
    merchant: 123456789, // Our Demo Tenant
    data: {
      url: 'https://salla.sa/checkout/xyz',
      checkout_url: 'https://salla.sa/checkout/xyz',
      customer: {
        first_name: 'تجربة',
        mobile: '+966500000000' // Target phone (System will send to this)
      }
    }
  };

  try {
    await ScenarioService.handleAbandonedCart(mockPayload);
    res.send("<h1>🛒 Auto-Recovery Message Triggered!</h1><p>Check your server console logs to see the message sending status.</p>");
  } catch (e) {
    res.status(500).send(`<h1>Error</h1><pre>${e.message}</pre>`);
  }
});

// ---------------------------------------------------------
// DEBUG ROUTE: CUSTOMERS (Moved to Top)
// ---------------------------------------------------------
// (Legacy /customers route removed - see proper route below)\n
// Session & Passport
app.use(
  session({ secret: process.env.SESSION_SECRET || "keyboard cat", resave: true, saveUninitialized: true })
);
app.use(passport.initialize());
app.use(passport.session());

// (moved injectPlanContext to before routes — see line ~247)

// Webhook Route
app.post("/webhook", (req, res) => {
  // 1. Log Information
  console.log("------------------------------------------");
  console.log("✅ تم استقبال Webhook");
  console.log("Headers:", JSON.stringify(req.headers, null, 2));
  console.log("Body:", JSON.stringify(req.body, null, 2));

  // 2. Respond Immediately to Salla with JSON
  res.status(200).json({ "ok": true });

  // 3. Process Logic Safely in Background
  try {
    const token = req.headers.authorization;
    if (!token && !process.env.SALLA_WEBHOOK_SECRET) {
      console.warn("⚠️ Webhook Warning: No Authorization header found and no SECRET set. Continuing anyway for test.");
    }

    // Pass to Salla logic (it might verify internaly, but we already responded 200)
    SallaWebhook.checkActions(req.body, token, {
      /* userArgs */
    });
  } catch (error) {
    console.error("❌ Exception inside Webhook logic:", error.message);
  }
});

// ---------------------------------------------------------
// META WEBHOOK (Incoming WhatsApp Messages) - Correct Placement
// ---------------------------------------------------------

// 1. Verification Request (From Meta Dashboard)
app.get("/webhook/meta", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode && token) {
    // Verify Token Check
    if (mode === "subscribe" && token === (process.env.META_VERIFY_TOKEN || "salla_saas_verify")) {
      console.log("✅ Meta Webhook Verified!");
      res.status(200).send(challenge);
    } else {
      res.sendStatus(403);
    }
  }
});

// 2. Incoming Messages
app.post("/webhook/meta", async (req, res) => {
  res.sendStatus(200); // Ack immediately

  const body = req.body;
  if (!body || !body.object) return;

  try {
    if (body.object === "whatsapp_business_account") {
      for (const entry of body.entry) {
        for (const change of entry.changes) {
          const value = change.value;
          const phoneNumberId = value.metadata.phone_number_id;

          if (value.messages && value.messages.length > 0) {
            const msg = value.messages[0];
            const from = msg.from;
            const msgBody = msg.text ? msg.text.body : "";

            console.log(`📩 Meta Msg from ${from}: ${msgBody}`);

            // Find Tenant & Config
            const connection = SallaDatabase.connection;
            if (connection) {
              const config = await connection.models.WhatsAppConfig.findOne({
                where: { phone_number_id: phoneNumberId }
              });
              if (config) {
                // 🚦 LIMIT CHECK — قبل أي إرسال
                const limitCheck = await checkLimit(config.tenant_id, connection.models, 'ai_reply', 1);

                // Log incoming message always (مهم للسجل)
                await connection.models.MessageLog.create({
                  tenant_id: config.tenant_id,
                  direction: 'in',
                  content: msgBody,
                  status: 'received',
                  to_phone: from
                });

                if (!limitCheck.allowed) {
                  console.warn(`⛔ [LIMIT BLOCK] tenant ${config.tenant_id}: ${limitCheck.reason}`);
                  // نسجّل محاولة فاشلة في MessageLog (للتدقيق)
                  await connection.models.MessageLog.create({
                    tenant_id: config.tenant_id,
                    direction: 'out',
                    content: `[LIMIT_BLOCKED] ${limitCheck.reason}`,
                    status: 'blocked',
                    to_phone: from
                  });
                  // ما نرد على العميل — يفضل صمت أو رد ثابت "النظام مشغول"
                  // لو حابب ترد، شيل الـ return ودش رد ثابت
                  return res.status(200).send("LIMIT_REACHED");
                }

                // Fetch Tenant for Custom AI Settings
                const tenant = await connection.models.Tenant.findOne({ where: { id: config.tenant_id } });
                const aiSettings = (tenant && tenant.settings) ? tenant.settings.ai_config : null;

                const aiReply = await AIService.generateReply(config.tenant_id, msgBody);

                await sendMetaMessage(config, from, aiReply);
                await incrementUsage(config.tenant_id, connection.models, 1);
                console.log(`🤖 AI Replied to customer (Real) — usage incremented`);

                await connection.models.MessageLog.create({
                  tenant_id: config.tenant_id,
                  direction: 'out',
                  content: aiReply,
                  status: 'sent',
                  to_phone: from
                });
              }
            }
          }
        }
      }
    }
  } catch (e) {
    console.error("❌ Meta Webhook Error:", e.message);
  }
});

// Health Check
app.get("/health", (req, res) => {
  res.status(200).send("OK");
});

// Middleware: Salla Verify (Skip for webhook to avoid broken pipe issues during testing)
// Middleware: Salla Verify (Real Authentication is handled by Passport)
// Mock user injection removed.

// ---------------------------------------------------------
// OTHER ROUTES
// ---------------------------------------------------------

app.get(["/oauth/redirect", "/login"], passport.authenticate("salla"));

app.get(
  "/oauth/callback",
  passport.authenticate("salla", { failureRedirect: "/login" }),
  function (req, res) {
    res.redirect("/");
  }
);

// ═══════════════════════════════════════════════════════════
// 🌐 MULTI-PLATFORM OAUTH (Salla + Zid + Shopify + Standalone)
// ═══════════════════════════════════════════════════════════
const PlatformRegistry = require('./services/platforms');
const ConnectService = require('./services/ConnectService');

// GET /connect — صفحة اختيار المنصة
app.get('/connect', (req, res) => {
  const platforms = PlatformRegistry.list();
  res.render('connect.html', {
    activePage: 'connect',
    platforms,
    user: req.user || null
  });
});

// GET /connect/:platform — يبدأ OAuth flow للمنصة المختارة
app.get('/connect/:platform', (req, res) => {
  try {
    const { platform } = req.params;
    if (!PlatformRegistry.has(platform)) return res.status(404).send('Unknown platform');

    const adapter = PlatformRegistry.get(platform);

    // Standalone: يفتح صفحة signup مباشرة
    if (platform === 'standalone') {
      return res.render('standalone_signup.html', { activePage: 'connect' });
    }

    const state = require('crypto').randomBytes(16).toString('hex');
    req.session = req.session || {};
    req.session.oauth_state = state;
    req.session.oauth_platform = platform;

    const redirectUri = `${req.protocol}://${req.get('host')}/oauth/${platform}/callback`;
    const shopDomain = req.query.shop || null; // لـ Shopify
    if (platform === 'shopify') req.session.oauth_shop = shopDomain;

    const authUrl = adapter.getAuthorizationUrl(state, redirectUri, shopDomain);

    // إذا في mock mode، نمر مباشرة على الـ callback (نحاكي رجوع المنصة)
    if (!adapter.isReady) {
      return res.redirect(`/oauth/${platform}/callback?code=mock_code&state=${state}${shopDomain ? '&shop=' + shopDomain : ''}`);
    }

    res.redirect(authUrl);
  } catch (e) {
    console.error('[connect] error:', e);
    res.status(500).send('Error: ' + e.message);
  }
});

// GET /oauth/:platform/callback — يستقبل code من المنصة
app.get('/oauth/:platform/callback', async (req, res) => {
  try {
    const { platform } = req.params;
    const { code, state, shop } = req.query;
    if (!PlatformRegistry.has(platform)) return res.status(404).send('Unknown platform');
    if (!code) return res.status(400).send('Missing code');

    // (اختياري) تحقق من الـ state — مهم للأمان لكن نتساهل في mock mode
    // if (req.session?.oauth_state && req.session.oauth_state !== state) return res.status(400).send('Invalid state');

    const adapter = PlatformRegistry.get(platform);
    const redirectUri = `${req.protocol}://${req.get('host')}/oauth/${platform}/callback`;
    const shopDomain = shop || req.session?.oauth_shop || null;

    // 1. استبدل code → access_token + store info
    const tokenData = await adapter.exchangeCodeForToken(code, redirectUri, shopDomain);

    // 2. أنشئ/حدّث Tenant + Subscription trial
    const { tenant, created } = await ConnectService.upsertTenantFromOAuth({ platform, tokenData });

    console.log(`✅ [${platform}] ${created ? 'NEW' : 'EXISTING'} tenant: ${tenant.store_name} (id=${tenant.id})`);

    // 3. اعمل login للجلسة (نضع merchant.id حسب المنصة)
    req.user = {
      merchant: {
        id: tenant.salla_merchant_id || tenant.platform_store_id,
        name: tenant.store_name
      },
      tenant_id: tenant.id,
      platform
    };

    res.redirect(`/dashboard?welcome=${created ? '1' : '0'}&platform=${platform}`);
  } catch (e) {
    console.error('[oauth callback] error:', e);
    res.status(500).send('OAuth error: ' + e.message);
  }
});

// POST /connect/standalone — تسجيل مستقل (بدون منصة)
app.post('/connect/standalone', async (req, res) => {
  try {
    const { store_name, email, phone } = req.body;
    if (!store_name || !email) return res.status(400).json({ ok: false, error: 'store_name & email required' });

    const adapter = PlatformRegistry.get('standalone');
    const tokenData = await adapter.exchangeCodeForToken(null, null, { store_name, email, phone });

    const { tenant, created } = await ConnectService.upsertTenantFromOAuth({
      platform: 'standalone',
      tokenData
    });

    req.user = {
      merchant: { id: tenant.platform_store_id, name: tenant.store_name },
      tenant_id: tenant.id,
      platform: 'standalone'
    };

    res.json({ ok: true, tenant_id: tenant.id, created, redirect: '/dashboard?welcome=1&platform=standalone' });
  } catch (e) {
    console.error('[standalone signup] error:', e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.get("/", async function (req, res) {
  let userDetails = {
    user: req.user,
    isLogin: req.user,
  };
  if (req.user) {
    try {
      const sallaId = req.user.merchant.id;
      const tenant = await SallaDatabase.getTenantBySallaID(sallaId);
      if (tenant) {
        userDetails = {
          ...userDetails,

          tenant: tenant.get({ plain: true }),
          settings: tenant.settings,
          plan_name: (tenant.Subscription && tenant.Subscription.Plan) ? tenant.Subscription.Plan.name : 'الأساسية',
          trial_days_left: (tenant.Subscription && tenant.Subscription.status === 'trial' && tenant.Subscription.end_date)
            ? Math.ceil((new Date(tenant.Subscription.end_date) - new Date()) / (1000 * 60 * 60 * 24))
            : null
        };
      }
    } catch (err) {
      console.error("Error retrieving tenant details:", err);
    }
  }
  res.render("index.html", userDetails);
});

app.get("/account", ensureAuthenticated, function (req, res) {
  res.render("account.html", {
    user: req.user,
    isLogin: req.user,
  });
});

app.get("/refreshToken", ensureAuthenticated, function (req, res) {
  SallaAPI.requestNewAccessToken(SallaAPI.getRefreshToken())
    .then((token) => {
      res.render("token.html", {
        token,
        isLogin: req.user,
      });
    })
    .catch((err) => res.send(err));
});

app.get("/orders", ensureAuthenticated, async function (req, res) {
  try {
    res.render("orders.html", {
      orders: await SallaAPI.getAllOrders(),
      isLogin: req.user,
    });
  } catch (err) {
    res.send(err.message);
  }
});

// (Legacy /customers route removed - see proper route below)

app.get("/logout", function (req, res) {
  SallaAPI.logout();
  req.logout(function (err) {
    if (err) {
      return next(err);
    }
    res.redirect("/");
  });
});

function ensureAuthenticated(req, res, next) {
  if (req.isAuthenticated()) {
    return next();
  }
  res.redirect("/login");
}

const http = require('http');
const { Server } = require("socket.io");
const server = http.createServer(app);
const io = new Server(server);

// Legacy WhatsApp Removed

// ---------------------------------------------------------
// CUSTOMERS ROUTE (Active WhatsApp Users) - MOVED TO TOP
// ---------------------------------------------------------
// (Route handler removed to avoid duplication)

// ---------------------------------------------------------
// NEW ADMIN DASHBOARD
// ---------------------------------------------------------
app.get("/admin", async (req, res) => {
  // In production, add strictly ADMIN middleware here
  try {
    const connection = SallaDatabase.connection;
    const tenants = await connection.models.Tenant.findAll({
      include: [
        'WhatsAppConfig',
        { model: connection.models.Subscription, as: 'Subscription', include: [{ model: connection.models.Plan, as: 'Plan' }] }
      ]
    });

    // 1. Calculate Stats
    const active_tenants_count = tenants.length; // Assume all active for demo
    const disconnected_count = tenants.filter(t => !t.WhatsAppConfig || !t.WhatsAppConfig.access_token).length;

    // 2. Calculate MRR (Simulated based on Plan names for now until Subscription table is fully populated)
    let mrr = 0;
    tenants.forEach(t => {
      // Use actual plan price if available, fallback to 79 (الأساسية)
      const planPrice = t.Subscription && t.Subscription.Plan ? t.Subscription.Plan.price_monthly : 79;
      mrr += planPrice;
    });

    // 3. Fetch Recent Activity
    const recent_tenants = await connection.models.Tenant.findAll({
      limit: 5,
      order: [['created_at', 'DESC']],
      include: [
        { model: connection.models.Subscription, as: 'Subscription', include: [{ model: connection.models.Plan, as: 'Plan' }] }
      ]
    });

    const recent_logs = await connection.models.MessageLog.findAll({
      limit: 5,
      order: [['created_at', 'DESC']],
      include: ['Tenant']
    });

    // 4. Format Date
    const now_date = new Date().toLocaleDateString('ar-SA', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

    res.render("admin/index.html", {
      page: 'overview',
      tenants_count: tenants.length,
      active_tenants_count,
      disconnected_count,
      total_messages_month: 1240, // Mock for now
      ai_usage_count: 850, // Mock for now
      mrr: mrr.toLocaleString(),
      arr: (mrr * 12).toLocaleString(),
      recent_tenants,
      recent_logs,
      now_date
    });
  } catch (e) {
    res.status(500).send(e.message);
  }
});

// Admin Tenants List
app.get("/admin/tenants", async (req, res) => {
  try {
    const connection = SallaDatabase.connection;
    const tenants = await connection.models.Tenant.findAll({
      include: ['WhatsAppConfig', 'Subscription'],
      order: [['createdAt', 'DESC']]
    });

    res.render("admin/tenants.html", {
      page: 'tenants',
      now_date: new Date().toLocaleDateString('ar-SA'),
      tenants
    });
  } catch (e) {
    res.status(500).send(e.message);
  }
});

// Admin Subscriptions
app.get("/admin/subscriptions", async (req, res) => {
  try {
    const db = SallaDatabase.connection;
    const subscriptions = await db.models.Subscription.findAll({
      include: ['Tenant', 'Plan'],
      order: [['created_at', 'DESC']]
    });
    res.render("admin/subscriptions.html", { page: 'subscriptions', subscriptions });
  } catch (e) {
    res.status(500).send("Error: " + e.message);
  }
});

// Admin Billing
app.get("/admin/billing", async (req, res) => {
  try {
    const db = SallaDatabase.connection;
    const transactions = (db.models.Payment) ? await db.models.Payment.findAll({
      include: ['Tenant', 'Plan'],
      order: [['created_at', 'DESC']]
    }) : [];
    res.render("admin/billing.html", { page: 'billing', transactions });
  } catch (e) {
    res.status(500).send("Error: " + e.message);
  }
});

// Admin Reports
app.get("/admin/reports", async (req, res) => {
  try {
    const db = SallaDatabase.connection;
    // Mock Data for now, can be real later
    res.render("admin/reports.html", {
      page: 'reports',
      now_date: new Date().toLocaleDateString('ar-SA')
    });
  } catch (e) {
    res.status(500).send("Error: " + e.message);
  }
});

// Admin Usage & Analytics
app.get("/admin/usage", async (req, res) => {
  try {
    const db = SallaDatabase.connection;
    // Mock usage data
    res.render("admin/usage.html", {
      page: 'usage',
      now_date: new Date().toLocaleDateString('ar-SA')
    });
  } catch (e) {
    res.status(500).send("Error: " + e.message);
  }
});

// Admin System Logs
app.get("/admin/logs", async (req, res) => {
  try {
    const db = SallaDatabase.connection;
    // Fetch recent system logs
    const logs = await db.models.MessageLog.findAll({
      limit: 100,
      order: [['created_at', 'DESC']],
      include: ['Tenant']
    });

    res.render("admin/logs.html", {
      page: 'logs',
      logs: logs,
      now_date: new Date().toLocaleDateString('ar-SA')
    });
  } catch (e) {
    res.status(500).send("Error: " + e.message);
  }
});

// Admin Plans Management
app.get("/admin/plans", async (req, res) => {
  try {
    const db = SallaDatabase.connection;
    const plans = await db.models.Plan.findAll();

    res.render("admin/plans.html", {
      page: 'plans',
      plans: plans,
      now_date: new Date().toLocaleDateString('ar-SA')
    });
  } catch (e) {
    res.status(500).send("Error: " + e.message);
  }
});

// Admin Plan Save (Create/Update)
app.post("/admin/plans/save", async (req, res) => {
  try {
    if (!req.user) req.user = { merchant: { id: 123456789, name: 'Demo Merchant' } };

    const db = SallaDatabase.connection;
    const { id, name, price_monthly, price_yearly, msg_limit_monthly } = req.body;

    // Advanced Features Parsed from Form
    const features = {
      // Core Limits
      whatsapp_count: parseInt(req.body.whatsapp_count || 1),
      team_members: parseInt(req.body.feat_team_members || 1),

      // Modules
      campaigns: (req.body.feat_campaigns === 'on'),
      automation: (req.body.feat_automation === 'on'),

      // AI Capabilities
      ai_enabled: (req.body.feat_ai_enabled === 'on'),
      ai_model: req.body.feat_ai_model || 'gpt-3.5-turbo', // gpt-3.5-turbo, gpt-4o
      ai_training_docs: parseInt(req.body.feat_ai_training_docs || 0),

      // Branding & API
      remove_branding: (req.body.feat_remove_branding === 'on'),
      api_access: (req.body.feat_api_access === 'on'),

      // Support
      support_level: req.body.feat_support_level || 'email', // email, priority, dedicated

      // Visuals (Badge, Color)
      badge: req.body.ui_badge || '', // 'popular', 'new', 'best'
      color: req.body.ui_color || 'gray', // 'teal', 'purple', 'blue'

      // Visibility
      is_visible: (req.body.is_visible === 'on')
    };

    if (id) {
      // Update
      await db.models.Plan.update({
        name, price_monthly, price_yearly, msg_limit_monthly, features
      }, { where: { id } });
    } else {
      // Create
      await db.models.Plan.create({
        name, price_monthly, price_yearly, msg_limit_monthly, features
      });
    }

    res.redirect('/admin/plans?status=saved');

  } catch (e) {
    res.status(500).send("Error saving plan: " + e.message);
  }
});


// Admin Global Settings
app.get("/admin/settings", async (req, res) => {
  try {
    res.render("admin/settings.html", {
      page: 'settings',
      now_date: new Date().toLocaleDateString('ar-SA')
    });
  } catch (e) {
    res.status(500).send("Error: " + e.message);
  }
});

// Admin Support Tickets
app.get("/admin/support", async (req, res) => {
  try {
    res.render("admin/support.html", {
      page: 'support',
      now_date: new Date().toLocaleDateString('ar-SA')
    });
  } catch (e) {
    res.status(500).send("Error: " + e.message);
  }
});

// Admin Logs (Tenant View)
app.get("/logs", async (req, res) => {
  try {
    if (!req.user) req.user = { merchant: { id: 123456789, name: 'Demo Merchant' } };

    const db = SallaDatabase.connection;
    const tenant = await db.models.Tenant.findOne({
      where: { salla_merchant_id: req.user.merchant.id },
      include: [{ model: db.models.Subscription, include: [db.models.Plan] }]
    });

    const plan = tenant?.Subscription?.Plan;

    const logs = await db.models.MessageLog.findAll({
      where: { tenant_id: tenant?.id },
      order: [['created_at', 'DESC']],
      limit: 50
    });

    res.render("logs.html", {
      page: 'logs',
      logs: logs,
      user: req.user,
      activePage: 'logs',
      plan_name: plan?.name || 'الأساسية'
    });
  } catch (e) {
    res.status(500).send("Error loading logs: " + e.message);
  }
});

// 📤 تصدير سجل الرسائل CSV
app.get("/logs/export", async (req, res) => {
  try {
    if (!req.user) req.user = { merchant: { id: 123456789, name: 'Demo Merchant' } };
    const db = SallaDatabase.connection;
    const tenant = await db.models.Tenant.findOne({ where: { salla_merchant_id: req.user.merchant.id } });
    if (!tenant) return res.status(404).send('Tenant not found');
    const logs = await db.models.MessageLog.findAll({
      where: { tenant_id: tenant.id }, order: [['created_at', 'DESC']], limit: 5000
    });
    const esc = (v) => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`;
    let csv = 'التاريخ,الاتجاه,الرقم,المحتوى,الحالة\n';
    for (const l of logs) {
      const date = l.created_at ? new Date(l.created_at).toISOString().slice(0, 16).replace('T', ' ') : '';
      const dir = l.direction === 'in' ? 'وارد' : 'صادر';
      csv += [esc(date), esc(dir), esc(l.to_phone), esc(l.content), esc(l.status)].join(',') + '\n';
    }
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="message_logs.csv"');
    res.send('﻿' + csv);
  } catch (e) {
    res.status(500).send('Error: ' + e.message);
  }
});

// ---------------------------------------------------------
// WHATSAPP SETTINGS ROUTES
// ---------------------------------------------------------

// GET: View WhatsApp Settings
app.get("/settings/whatsapp", async (req, res) => {
  try {
    if (!req.user) req.user = { merchant: { id: 123456789, name: 'Demo Merchant' } };
    const db = SallaDatabase.connection;

    const tenant = await db.models.Tenant.findOne({
      where: { salla_merchant_id: req.user.merchant.id },
      include: [
        { model: db.models.Subscription, include: [db.models.Plan] }
      ]
    });

    const plan = tenant?.Subscription?.Plan;
    const planFeatures = plan?.features || {};

    // ✅ كل أرقام الواتساب للتاجر (مع primary أولاً)
    const allNumbers = tenant ? await db.models.WhatsAppConfig.findAll({
      where: { tenant_id: tenant.id },
      order: [['is_primary', 'DESC'], ['id', 'ASC']]
    }) : [];

    const primary = allNumbers.find(n => n.is_primary) || allNumbers[0] || {};
    const extras = allNumbers.filter(n => n.id !== primary.id);

    const apiKey = tenant?.settings?.api_key || '';
    const hasApiAccess = planFeatures.api_access === true;

    res.render("settings.html", {
      user: req.user,
      activePage: 'settings',
      plan_name: plan?.name || 'الأساسية',
      plan_features: planFeatures,
      has_api_access: hasApiAccess,
      config: {
        phone_number_id: primary.phone_number_id || '',
        waba_id: primary.waba_id || '',
        access_token: primary.access_token || '',
        phone_number: primary.phone_number || '',
        label: primary.label || ''
      },
      primary_number: primary.id ? primary : null,
      extra_numbers: extras,
      total_numbers: allNumbers.length,
      api_key: apiKey,
      status: req.query.status || null
    });
  } catch (e) {
    console.error("Settings Route Error:", e);
    res.status(500).send("Error loading settings: " + e.message);
  }
});

// ═══════════════════════════════════════════════════════════
// 📱 MULTI-WHATSAPP NUMBERS API
// ═══════════════════════════════════════════════════════════

// helper: fetch tenant + plan_limits
async function _getTenantWithLimit(req) {
  if (!req.user) req.user = { merchant: { id: 123456789, name: 'Demo Merchant' } };
  const db = SallaDatabase.connection;
  const tenant = await db.models.Tenant.findOne({
    where: { salla_merchant_id: req.user.merchant.id },
    include: [{ model: db.models.Subscription, include: [db.models.Plan] }]
  });
  if (!tenant) throw new Error('Tenant not found');
  const planName = tenant.Subscription?.Plan?.name || 'الأساسية';
  const planGate = require('./services/planGate');
  const limit = planGate.getLimit(planName, 'whatsapp_numbers'); // 1 / 3 / -1
  return { db, tenant, planName, limit };
}

// POST /api/whatsapp-numbers — يضيف رقم جديد
app.post('/api/whatsapp-numbers', async (req, res) => {
  try {
    const { db, tenant, planName, limit } = await _getTenantWithLimit(req);
    const { label, phone_number_id, waba_id, access_token, phone_number } = req.body;

    const existing = await db.models.WhatsAppConfig.count({ where: { tenant_id: tenant.id } });
    if (limit !== -1 && existing >= limit) {
      return res.status(403).json({
        ok: false,
        error: 'plan_limit_reached',
        message: `باقتك "${planName}" تسمح بـ ${limit} رقم فقط. لديك بالفعل ${existing}. رفّع باقتك للمزيد.`
      });
    }

    if (!phone_number_id || !access_token) {
      return res.status(400).json({ ok: false, error: 'phone_number_id & access_token required' });
    }

    const isFirst = existing === 0;
    const config = await db.models.WhatsAppConfig.create({
      tenant_id: tenant.id,
      label: label || `رقم ${existing + 1}`,
      phone_number_id,
      waba_id: waba_id || null,
      access_token,
      phone_number: phone_number || null,
      is_primary: isFirst,  // أول رقم = primary تلقائياً
      status: 'active'
    });

    res.json({ ok: true, number: config });
  } catch (e) {
    console.error('Add WhatsApp number error:', e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// PUT /api/whatsapp-numbers/:id — تعديل
app.put('/api/whatsapp-numbers/:id', async (req, res) => {
  try {
    const { db, tenant } = await _getTenantWithLimit(req);
    const config = await db.models.WhatsAppConfig.findOne({
      where: { id: req.params.id, tenant_id: tenant.id }
    });
    if (!config) return res.status(404).json({ ok: false, error: 'Number not found' });

    const { label, phone_number_id, waba_id, access_token, phone_number, status } = req.body;
    await config.update({
      label: label ?? config.label,
      phone_number_id: phone_number_id ?? config.phone_number_id,
      waba_id: waba_id ?? config.waba_id,
      access_token: access_token ?? config.access_token,
      phone_number: phone_number ?? config.phone_number,
      status: status ?? config.status
    });

    res.json({ ok: true, number: config });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// DELETE /api/whatsapp-numbers/:id
app.delete('/api/whatsapp-numbers/:id', async (req, res) => {
  try {
    const { db, tenant } = await _getTenantWithLimit(req);
    const config = await db.models.WhatsAppConfig.findOne({
      where: { id: req.params.id, tenant_id: tenant.id }
    });
    if (!config) return res.status(404).json({ ok: false, error: 'Not found' });
    if (config.is_primary) {
      const others = await db.models.WhatsAppConfig.count({ where: { tenant_id: tenant.id } });
      if (others > 1) return res.status(400).json({ ok: false, error: 'لا يمكن حذف الرقم الأساسي. اجعل رقماً آخر أساسياً أولاً.' });
    }
    await config.destroy();
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// POST /api/whatsapp-numbers/:id/make-primary
app.post('/api/whatsapp-numbers/:id/make-primary', async (req, res) => {
  try {
    const { db, tenant } = await _getTenantWithLimit(req);
    const config = await db.models.WhatsAppConfig.findOne({
      where: { id: req.params.id, tenant_id: tenant.id }
    });
    if (!config) return res.status(404).json({ ok: false, error: 'Not found' });

    // اضبط كل الباقي = false، ثم هذا = true
    await db.models.WhatsAppConfig.update(
      { is_primary: false },
      { where: { tenant_id: tenant.id } }
    );
    await config.update({ is_primary: true });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// POST: Save WhatsApp Settings
app.post("/settings/whatsapp", async (req, res) => {
  try {
    if (!req.user) req.user = { merchant: { id: 123456789, name: 'Demo Merchant' } };
    const db = SallaDatabase.connection;

    const tenant = await db.models.Tenant.findOne({
      where: { salla_merchant_id: req.user.merchant.id }
    });

    if (!tenant) return res.status(404).json({ error: "Tenant not found" });

    const { phone_id, waba_id, token } = req.body;

    // ✅ Multi-Number support: نحدّث الرقم الأساسي فقط
    let primary = await db.models.WhatsAppConfig.findOne({
      where: { tenant_id: tenant.id, is_primary: true }
    });

    if (primary) {
      await primary.update({ phone_number_id: phone_id, waba_id: waba_id, access_token: token, status: 'active' });
    } else {
      // أول رقم للتاجر = primary تلقائياً
      primary = await db.models.WhatsAppConfig.create({
        tenant_id: tenant.id,
        phone_number_id: phone_id,
        waba_id: waba_id,
        access_token: token,
        is_primary: true,
        label: 'الرقم الأساسي',
        status: 'active'
      });
    }

    console.log(`✅ ${tenant.store_name} updated WhatsApp config`);
    res.redirect('/settings/whatsapp?status=saved');
  } catch (e) {
    console.error("WhatsApp Settings Save Error:", e);
    res.status(500).send("Error saving settings");
  }
});

// POST: Generate API Key
app.post("/settings/generate-api-key", async (req, res) => {
  try {
    if (!req.user) req.user = { merchant: { id: 123456789, name: 'Demo Merchant' } };
    const db = SallaDatabase.connection;
    const crypto = require('crypto');

    const tenant = await db.models.Tenant.findOne({
      where: { salla_merchant_id: req.user.merchant.id },
      include: [{ model: db.models.Subscription, include: [db.models.Plan] }]
    });

    if (!tenant) return res.status(404).json({ success: false, error: "Tenant not found" });

    // ── Plan Enforcement: Only Pro & Enterprise ──
    const planFeatures = tenant?.Subscription?.Plan?.features || {};
    if (!planFeatures.api_access) {
      return res.status(403).json({
        success: false,
        error: "هذه الميزة متاحة فقط لباقة التاجر وما فوق. يرجى ترقية باقتك."
      });
    }
    // ─────────────────────────────────────────────

    const newKey = 'mbhr_' + crypto.randomBytes(24).toString('hex');

    const currentSettings = tenant.settings || {};
    currentSettings.api_key = newKey;
    tenant.settings = currentSettings;
    tenant.changed('settings', true);
    await tenant.save();

    console.log(`🔑 New API Key generated for ${tenant.store_name}`);
    res.json({ success: true, key: newKey });
  } catch (e) {
    console.error("Generate API Key Error:", e);
    res.status(500).json({ success: false, error: e.message });
  }
});

// ---------------------------------------------------------

// ---------------------------------------------------------
// SCENARIOS ROUTES
// ---------------------------------------------------------
app.get("/scenarios", async (req, res) => {
  try {
    if (!req.user) req.user = { merchant: { id: 123456789, name: 'Demo Merchant' } };

    // Use global instance directly
    const db = SallaDatabase.connection;

    if (!db) {
      console.error("DB Connection Missing");
      return res.status(500).send("Database booting...");
    }

    // Get Tenant with Subscription and Plan
    const tenant = await db.models.Tenant.findOne({
      where: { salla_merchant_id: req.user.merchant.id },
      include: [{
        model: db.models.Subscription,
        include: [db.models.Plan]
      }]
    });

    // Default Data if not found (for safety)
    const planName = tenant?.Subscription?.Plan?.name || 'الأساسية';
    const settings = tenant?.settings || { abandoned_cart: false, review_request: false };

    // 🔒 احسب السيناريوهات المتاحة والمقفولة حسب الباقة
    const planGate = require('./services/planGate');
    const planScenarios = planGate.getScenariosForPlan(planName);

    res.render("scenarios.html", {
      settings,
      plan: planName,
      user: req.user,
      activePage: 'scenarios',
      plan_name: planName,
      allowed_scenarios: planScenarios.allowed,
      locked_scenarios: planScenarios.locked
    });

  } catch (e) {
    console.error("Scenario Route Error:", e);
    res.status(500).send("Error loading scenarios: " + e.message);
  }
});

// Save Scenarios API (مع التحقق من الباقة)
app.post("/api/scenarios/save", async (req, res) => {
  try {
    if (!req.user) req.user = { merchant: { id: 123456789, name: 'Demo Merchant' } };
    const db = SallaDatabase.connection;
    const tenant = await db.models.Tenant.findOne({ where: { salla_merchant_id: req.user.merchant.id } });

    if (!tenant) return res.status(404).json({ error: 'Tenant not found' });

    // 🔒 فلتر القيم الواردة — أي سيناريو غير مسموح في الباقة يُتجاهل
    const planGate = require('./services/planGate');
    const plan = await planGate.getTenantPlan(tenant.id);
    const planName = plan?.name || 'الأساسية';
    const allowedScenarios = planGate.PLAN_SCENARIOS[planName] || planGate.PLAN_SCENARIOS['الأساسية'];

    const rejected = [];
    const sanitized = {};
    for (const [key, value] of Object.entries(req.body || {})) {
      if (planGate.ALL_SCENARIOS.includes(key) && !allowedScenarios.includes(key)) {
        rejected.push(key);
      } else {
        sanitized[key] = value;
      }
    }

    const current = tenant.settings || {};
    tenant.settings = { ...current, ...sanitized };
    tenant.changed('settings', true);
    await tenant.save();
    console.log(`✅ ${tenant.store_name} (${planName}) updated:`, sanitized,
                rejected.length ? `🔒 rejected (not in plan): ${rejected.join(',')}` : '');

    res.json({
      status: 'success',
      saved: sanitized,
      rejected,
      plan: planName,
      message: rejected.length ? `بعض السيناريوهات غير متاحة في باقة "${planName}"` : 'تم الحفظ'
    });
  } catch (e) {
    console.error("Save Scenario Error:", e);
    res.status(500).json({ error: e.message });
  }
});

// 🛠️ DEV ONLY — تبديل الباقة الحالية للتطوير
// GET /dev/switch-plan/:plan  → الأساسية | النمو | التاجر المحترف | الشركات
// ⛔ محمي: يعمل فقط في بيئة التطوير. في الإنتاج يرجّع 404.
app.get("/dev/switch-plan/:plan", async (req, res) => {
  if (process.env.NODE_ENV === 'production') {
    return res.status(404).json({ ok: false, error: 'Not found' });
  }
  try {
    if (!req.user) req.user = { merchant: { id: 123456789, name: 'Demo Merchant' } };
    const db = SallaDatabase.connection;
    const planName = decodeURIComponent(req.params.plan);

    const plan = await db.models.Plan.findOne({ where: { name: planName } });
    if (!plan) return res.status(404).json({ ok: false, error: `Plan "${planName}" not found` });

    const tenant = await db.models.Tenant.findOne({ where: { salla_merchant_id: req.user.merchant.id } });
    if (!tenant) return res.status(404).json({ ok: false, error: 'Tenant not found' });

    let sub = await db.models.Subscription.findOne({ where: { tenant_id: tenant.id } });
    if (sub) {
      await sub.update({ plan_id: plan.id, status: 'active', end_date: new Date(Date.now() + 365 * 86400000) });
    } else {
      await db.models.Subscription.create({
        tenant_id: tenant.id, plan_id: plan.id, status: 'active',
        start_date: new Date(), end_date: new Date(Date.now() + 365 * 86400000)
      });
    }
    console.log(`🧪 [DEV] ${tenant.store_name} → ${planName}`);

    // Redirect back to referer (refresh same page) or dashboard
    const back = req.query.redirect || req.get('Referer') || '/dashboard';
    res.redirect(back);
  } catch (e) {
    console.error('Switch plan error:', e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// 🔧 Trigger scenario manually (Dev / Test)
// GET /api/scenarios/trigger/:key  → birthday | reactivation | price_drop
app.get("/api/scenarios/trigger/:key", devOnly, async (req, res) => {
  try {
    const { runNow } = require('./jobs/scheduler');
    const t0 = Date.now();
    await runNow(req.params.key);
    res.json({ ok: true, scenario: req.params.key, duration_ms: Date.now() - t0 });
  } catch (e) {
    console.error('Manual trigger error:', e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ═══════════════════════════════════════════════════════════
// 💳 BILLING / TAP PAYMENT ROUTES
// ═══════════════════════════════════════════════════════════
const BillingService = require('./services/BillingService');
const TapService = require('./services/TapService');

// POST /billing/checkout — يبدأ جلسة دفع Tap
app.post('/billing/checkout', async (req, res) => {
  try {
    if (!req.user) req.user = { merchant: { id: 123456789, name: 'Demo Merchant' } };
    const { plan_name, billing_period } = req.body;
    if (!plan_name) return res.status(400).json({ ok: false, error: 'plan_name required' });

    const db = SallaDatabase.connection;
    const plan = await db.models.Plan.findOne({ where: { name: plan_name } });
    if (!plan) return res.status(404).json({ ok: false, error: 'Plan not found' });

    const tenant = await db.models.Tenant.findOne({ where: { salla_merchant_id: req.user.merchant.id } });
    if (!tenant) return res.status(404).json({ ok: false, error: 'Tenant not found' });

    const baseUrl = `${req.protocol}://${req.get('host')}`;
    const result = await BillingService.initiateTapCheckout({
      tenantId: tenant.id,
      planId: plan.id,
      billingPeriod: (billing_period === 'yearly') ? 'yearly' : 'monthly',
      baseUrl
    });

    console.log(`💳 Checkout initiated — tenant ${tenant.id} → ${plan_name} (${result.mock ? 'MOCK' : 'TAP'})`);
    res.json({ ok: true, ...result });
  } catch (e) {
    console.error('Checkout error:', e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// GET /billing/return — الصفحة اللي يرجع لها العميل بعد الدفع (تتحقق من النتيجة)
app.get('/billing/return', async (req, res) => {
  try {
    if (!req.user) req.user = { merchant: { id: 123456789, name: 'Demo Merchant' } };
    const { tap_id, status, mock } = req.query;
    if (!tap_id) return res.redirect('/billing?status=error&reason=missing_id');

    // تحقق من Tap (أو نقبل mock مباشرة)
    let chargeStatus = status;
    if (!mock) {
      const charge = await TapService.retrieveCharge(tap_id);
      chargeStatus = charge.status;
    }

    if (chargeStatus === 'CAPTURED' || chargeStatus === 'PAID') {
      // فعّل الاشتراك إذا الـ webhook لسه ما وصل
      try {
        await BillingService.processPaymentSuccess(tap_id);
      } catch (e) {
        // ممكن يكون الـ webhook سبقنا — لا بأس
        console.log('processPaymentSuccess note:', e.message);
      }
      return res.redirect('/billing?status=success&id=' + tap_id);
    } else {
      await BillingService.processPaymentFailure(tap_id, `Status: ${chargeStatus}`);
      return res.redirect('/billing?status=failed&reason=' + encodeURIComponent(chargeStatus));
    }
  } catch (e) {
    console.error('Billing return error:', e);
    res.redirect('/billing?status=error&reason=' + encodeURIComponent(e.message));
  }
});

// POST /webhook/tap — يستقبل تأكيد الدفع من Tap (server-to-server)
app.post('/webhook/tap', async (req, res) => {
  try {
    const signature = req.headers['hashstring'] || req.headers['tap-signature'] || '';
    const rawBody = JSON.stringify(req.body);
    if (!TapService.verifyWebhookSignature(rawBody, signature)) {
      console.warn('⚠️ Tap webhook signature invalid');
      return res.status(401).send('Invalid signature');
    }

    const charge = req.body;
    const chargeId = charge.id;
    const status = charge.status;

    console.log(`📩 Tap Webhook — charge=${chargeId} status=${status}`);

    if (status === 'CAPTURED' || status === 'PAID') {
      const r = await BillingService.processPaymentSuccess(chargeId);
      console.log(`✅ Payment processed:`, r);
    } else if (['FAILED', 'DECLINED', 'CANCELLED', 'VOID'].includes(status)) {
      await BillingService.processPaymentFailure(chargeId, status);
    } else {
      console.log(`ℹ️ Tap status ${status} — ignored (will retry on completion)`);
    }

    res.status(200).send('OK');
  } catch (e) {
    console.error('Tap webhook error:', e);
    res.status(500).send('Error');
  }
});

// GET /billing — صفحة الفواتير والاشتراك
app.get('/billing', async (req, res) => {
  try {
    if (!req.user) req.user = { merchant: { id: 123456789, name: 'Demo Merchant' } };
    const db = SallaDatabase.connection;
    const tenant = await db.models.Tenant.findOne({
      where: { salla_merchant_id: req.user.merchant.id },
      include: [{ model: db.models.Subscription, include: [db.models.Plan] }]
    });

    const payments = await db.models.Payment.findAll({
      where: { tenant_id: tenant?.id },
      include: [db.models.Plan],
      order: [['created_at', 'DESC']],
      limit: 50
    });

    const sub = tenant?.Subscription;
    const plan = sub?.Plan;

    res.render('billing.html', {
      user: req.user,
      activePage: 'billing',
      tenant,
      subscription: sub,
      plan,
      plan_name: plan?.name || 'الأساسية',
      payments,
      status_msg: req.query.status,
      status_reason: req.query.reason
    });
  } catch (e) {
    console.error('Billing page error:', e);
    res.status(500).send('Error loading billing: ' + e.message);
  }
});


// ---------------------------------------------------------
// KNOWLEDGE BASE ROUTES
// ---------------------------------------------------------
app.get("/knowledge-base", async (req, res) => {
  try {
    if (!req.user) req.user = { merchant: { id: 123456789, name: 'Demo Merchant' } };

    const db = SallaDatabase.connection;
    if (!db) return res.send("DB Booting...");

    const tenant = await db.models.Tenant.findOne({
      where: { salla_merchant_id: req.user.merchant.id },
      include: [{ model: db.models.Subscription, include: [db.models.Plan] }]
    });

    const plan = tenant?.Subscription?.Plan;
    const settings = tenant?.settings || {};
    const kb = settings.knowledge_base || {};

    res.render("knowledge_base.html", { kb, user: req.user, activePage: 'knowledge_base', plan_name: plan?.name || 'الأساسية' });

  } catch (e) {
    console.error("KB Route Error:", e);
    res.status(500).send("Error loading KB");
  }
});

app.post("/api/knowledge-base/save", async (req, res) => {
  try {
    if (!req.user) req.user = { merchant: { id: 123456789, name: 'Demo Merchant' } };
    const { shipping_policy, return_policy, custom_text } = req.body;

    const db = SallaDatabase.connection;
    const tenant = await db.models.Tenant.findOne({
      where: { salla_merchant_id: req.user.merchant.id }
    });

    if (tenant) {
      const currentSettings = tenant.settings || {};

      // Update KB section
      currentSettings.knowledge_base = {
        shipping_policy,
        return_policy,
        custom_text
      };

      tenant.set('settings', currentSettings);
      tenant.changed('settings', true);
      await tenant.save();

      res.json({ status: 'success' });
    } else {
      res.status(404).json({ error: 'Tenant not found' });
    }
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ---------------------------------------------------------
// PRICING / BILLING PAGE
// ---------------------------------------------------------
app.get(["/pricing", "/billing"], async (req, res) => {
  try {
    if (!req.user) req.user = { merchant: { id: 123456789, name: 'Demo Merchant' } };
    const db = SallaDatabase.connection;

    const tenant = await db.models.Tenant.findOne({
      where: { salla_merchant_id: req.user.merchant.id },
      include: [{ model: db.models.Subscription, include: [db.models.Plan] }]
    });

    const subscription = tenant?.Subscription;
    const plan = subscription?.Plan;
    const planName = plan?.name || 'الأساسية';
    const msgLimit = plan?.msg_limit_monthly || 1000;
    const subStatus = subscription?.status || 'trial';
    const subEndDate = subscription?.end_date;

    // Usage
    const currentPeriod = new Date().toISOString().slice(0, 7);
    const currentUsage = await db.models.UsageCounter.findOne({
      where: { tenant_id: tenant?.id, period_key: currentPeriod }
    });
    const messagesSent = currentUsage?.messages_sent || 0;

    res.render("pricing.html", {
      user: req.user,
      activePage: 'pricing',
      current_plan: planName,
      plan_name: planName,
      sub_status: subStatus,
      msg_limit: msgLimit,
      messages_sent: messagesSent,
      trial_days_left: (subStatus === 'trial' && subEndDate)
        ? Math.ceil((new Date(subEndDate) - new Date()) / (1000 * 60 * 60 * 24))
        : null,
    });
  } catch (e) {
    console.error("Pricing Route Error:", e);
    res.status(500).send("Error loading pricing: " + e.message);
  }
});

// ---------------------------------------------------------
// CLIENT DASHBOARD (Enhanced)
// ---------------------------------------------------------
app.get("/dashboard", async (req, res) => {
  try {
    if (!req.user) req.user = { merchant: { id: 123456789, name: 'Demo Merchant' } };

    const db = SallaDatabase.connection;

    // Get Tenant with Subscription + Plan + WhatsApp Config
    const tenant = await db.models.Tenant.findOne({
      where: { salla_merchant_id: req.user.merchant.id },
      include: [
        {
          model: db.models.Subscription,
          include: [db.models.Plan]  // Eager-load Plan inside Subscription
        },
        'WhatsAppConfig'
      ]
    });

    // Status Logic
    const isConnected = !!(tenant?.WhatsAppConfig?.access_token);

    // --- Plan Data ---
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

    // Get Usage
    const currentPeriod = new Date().toISOString().slice(0, 7);
    const currentUsage = await db.models.UsageCounter.findOne({
      where: {
        tenant_id: tenant?.id,
        period_key: currentPeriod
      }
    });

    const messagesSent = currentUsage?.messages_sent || 0;
    const aiRequests = currentUsage?.ai_requests || 0;

    // Usage Percentage
    const usagePercent = msgLimit > 0 ? Math.min(Math.round((messagesSent / msgLimit) * 100), 100) : 0;
    const messagesRemaining = msgLimit > 0 ? Math.max(msgLimit - messagesSent, 0) : '∞';

    // 1. Fetch Recent Logs (Real Data)
    const recentLogs = await db.models.MessageLog.findAll({
      where: { tenant_id: tenant?.id },
      order: [['created_at', 'DESC']],
      limit: 5
    });

    // 2. Prepare Chart Data (Real data from last 7 days)
    const chartLabels = [];
    const chartData = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const dayStart = new Date(d); dayStart.setHours(0, 0, 0, 0);
      const dayEnd = new Date(d); dayEnd.setHours(23, 59, 59, 999);
      chartLabels.push(d.toLocaleDateString('ar-SA', { weekday: 'short' }));
      const { Op } = require('sequelize');
      const count = await db.models.MessageLog.count({
        where: { tenant_id: tenant?.id, direction: 'out', created_at: { [Op.between]: [dayStart, dayEnd] } }
      });
      chartData.push(count);
    }

    // 3. Calculate Growth
    const lastMonthKey = new Date(new Date().setMonth(new Date().getMonth() - 1)).toISOString().slice(0, 7);
    const lastMonthUsage = await db.models.UsageCounter.findOne({
      where: {
        tenant_id: tenant?.id,
        period_key: lastMonthKey
      }
    });

    const lastAI = lastMonthUsage?.ai_requests || 0;
    let growthPercent = 0;

    if (lastAI > 0) {
      growthPercent = ((aiRequests - lastAI) / lastAI) * 100;
    } else if (aiRequests > 0) {
      growthPercent = 100;
    }

    // Real Data Stats
    const campaignsCount = await db.models.Campaign.count({ where: { tenant_id: tenant?.id } });
    const contactsCount = await db.models.Customer.count({ where: { tenant_id: tenant?.id } });

    // Renewal date calculation
    const renewalDate = subEndDate ? new Date(subEndDate).toLocaleDateString('ar-SA', { year: 'numeric', month: 'long', day: 'numeric' }) : 'غير محدد';

    // Build View Data
    const viewData = {
      tenant: tenant,
      user: req.user,
      activePage: 'dashboard',
      isConnected: isConnected,

      // Plan Info
      plan_name: planName,
      plan_price: isYearly ? priceYearly : priceMonthly,
      plan_billing: isYearly ? 'سنوي' : 'شهري',
      plan_features: planFeatures,
      sub_status: subStatus,
      plan_features: planFeatures,
      sub_status: subStatus,
      renewal_date: renewalDate,
      trial_days_left: (subStatus === 'trial' && subEndDate)
        ? Math.ceil((new Date(subEndDate) - new Date()) / (1000 * 60 * 60 * 24))
        : null,

      // Usage
      messages_sent: messagesSent,
      msg_limit: msgLimit,
      messages_remaining: messagesRemaining,
      usage_percent: usagePercent,
      ai_replies: aiRequests,
      ai_growth: growthPercent.toFixed(1),

      // Counts
      campaigns_count: campaignsCount,
      contacts_count: contactsCount,

      // Chart
      recentLogs: recentLogs,
      chartLabels: JSON.stringify(chartLabels),
      chartData: JSON.stringify(chartData),
    };

    res.render("dashboard.html", viewData);

  } catch (e) {
    console.error(e);
    res.status(500).send("Dashboard Error");
  }
});
// Automation: Abandoned Carts
app.get("/automation/carts", require('./services/planGate').requirePage('automation_carts'), async (req, res) => {
  try {
    if (!req.user) req.user = { merchant: { id: 123456789, name: 'Demo Merchant' } };
    const db = SallaDatabase.connection;

    // 1. Get Tenant
    const tenant = await db.models.Tenant.findOne({
      where: { salla_merchant_id: req.user.merchant.id },
      include: [{ model: db.models.Subscription, include: [db.models.Plan] }]
    });

    // 2. Plan Check
    const plan = tenant?.Subscription?.Plan;
    // For now, assume enabled if plan exists, or check specific feature flag if we had one
    const automationEnabled = true;

    // 3. Fetch Carts
    const carts = (db.models.Cart) ? await db.models.Cart.findAll({
      where: { tenant_id: tenant?.id },
      include: ['Customer'],
      order: [['created_at', 'DESC']]
    }) : [];

    // 4. Calculate Stats
    const totalAbandoned = carts.length;
    const totalRecovered = carts.filter(c => c.status === 'recovered').length;
    const potentialRevenue = carts.reduce((n, { total_amount }) => n + (parseFloat(total_amount) || 0), 0);
    const recoveredRevenue = carts.filter(c => c.status === 'recovered').reduce((n, { total_amount }) => n + (parseFloat(total_amount) || 0), 0);

    res.render("automation/carts.html", {
      user: req.user,
      activePage: 'carts',
      plan_name: plan?.name || 'الأساسية',
      automation_enabled: automationEnabled,
      carts,
      stats: { totalAbandoned, totalRecovered, potentialRevenue, recoveredRevenue }
    });

  } catch (e) {
    console.error(e);
    res.status(500).send("Error loading carts: " + e.message);
  }
});

// Automation: Order Updates & Review Requests
app.get("/automation/orders", require('./services/planGate').requirePage('automation_orders'), async (req, res) => {
  try {
    if (!req.user) req.user = { merchant: { id: 123456789, name: 'Demo Merchant' } };
    const db = SallaDatabase.connection;
    const { Op } = require('sequelize');

    // 1. Get Tenant
    const tenant = await db.models.Tenant.findOne({
      where: { salla_merchant_id: req.user.merchant.id },
      include: [{ model: db.models.Subscription, include: [db.models.Plan] }]
    });

    // 2. Plan Check
    const plan = tenant?.Subscription?.Plan;
    const automationEnabled = true;

    // 3. Fetch Order Messages
    let orderMessages = [];
    if (db.models.MessageLog) {
      const messages = await db.models.MessageLog.findAll({
        where: {
          tenant_id: tenant?.id,
          direction: 'out'
        },
        order: [['created_at', 'DESC']],
        limit: 50
      });
      // Filter for Review Requests or Order Updates
      orderMessages = messages.filter(m => {
        const content = m.content || "";
        const meta = m.metadata || {};
        return (meta.type === 'review_request') || (content.includes('شكراً لتسوقك')) || (content.includes('تقييم'));
      });
    }

    res.render("automation/orders.html", {
      user: req.user,
      activePage: 'orders',
      plan_name: plan?.name || 'الأساسية',
      automation_enabled: automationEnabled,
      order_messages: orderMessages
    });

  } catch (e) {
    console.error(e);
    res.status(500).send("Error loading orders automation: " + e.message);
  }
});

// Campaigns Route
app.get("/campaigns", require('./services/planGate').requirePage('campaigns'), async (req, res) => {
  try {
    if (!req.user) req.user = { merchant: { id: 123456789, name: 'Demo Merchant' } };
    const db = SallaDatabase.connection;

    // Get Tenant with Subscription + Plan
    const tenant = await db.models.Tenant.findOne({
      where: { salla_merchant_id: req.user.merchant.id },
      include: [
        {
          model: db.models.Subscription,
          include: [db.models.Plan]
        }
      ]
    });

    // Plan data
    const subscription = tenant?.Subscription;
    const plan = subscription?.Plan;
    const planName = plan?.name || 'الأساسية';
    const planFeatures = plan?.features || {};
    const msgLimit = plan?.msg_limit_monthly || 1000;
    const campaignsEnabled = planFeatures.campaigns || false;

    // Usage data
    const currentPeriod = new Date().toISOString().slice(0, 7);
    const currentUsage = await db.models.UsageCounter.findOne({
      where: { tenant_id: tenant?.id, period_key: currentPeriod }
    });
    const messagesSent = currentUsage?.messages_sent || 0;
    const messagesRemaining = msgLimit > 0 ? Math.max(msgLimit - messagesSent, 0) : -1; // -1 = unlimited

    // Fetch campaigns
    const campaigns = (db.models.Campaign) ? await db.models.Campaign.findAll({
      where: { tenant_id: tenant?.id },
      order: [['created_at', 'DESC']]
    }) : [];

    // Campaign stats
    const totalSent = campaigns.reduce((sum, c) => sum + (c.stats_sent || 0), 0);
    const totalCampaigns = campaigns.length;
    const contactsCount = await db.models.Customer.count({ where: { tenant_id: tenant?.id } });

    res.render("campaigns.html", {
      user: req.user,
      campaigns,
      activePage: 'campaigns',
      plan_name: planName,
      plan_features: planFeatures,
      campaigns_enabled: campaignsEnabled,
      msg_limit: msgLimit,
      messages_sent: messagesSent,
      messages_remaining: messagesRemaining,
      total_campaign_sent: totalSent,
      total_campaigns: totalCampaigns,
      contacts_count: contactsCount
    });
  } catch (e) {
    console.error(e);
    res.status(500).send("Error loading campaigns: " + e.message);
  }
});

app.get("/campaigns/create", require('./services/planGate').requirePage('campaigns'), async (req, res) => {
  try {
    if (!req.user) req.user = { merchant: { id: 123456789, name: 'Demo Merchant' } };
    const db = SallaDatabase.connection;

    // Check plan permission for campaigns
    const tenant = await db.models.Tenant.findOne({
      where: { salla_merchant_id: req.user.merchant.id },
      include: [{ model: db.models.Subscription, include: [db.models.Plan] }]
    });

    const plan = tenant?.Subscription?.Plan;
    const planFeatures = plan?.features || {};
    const campaignsEnabled = planFeatures.campaigns || false;
    const msgLimit = plan?.msg_limit_monthly || 1000;

    // Usage
    const currentPeriod = new Date().toISOString().slice(0, 7);
    const currentUsage = await db.models.UsageCounter.findOne({
      where: { tenant_id: tenant?.id, period_key: currentPeriod }
    });
    const messagesSent = currentUsage?.messages_sent || 0;
    const messagesRemaining = msgLimit > 0 ? Math.max(msgLimit - messagesSent, 0) : -1;

    // Contacts count
    const contactsCount = await db.models.Customer.count({ where: { tenant_id: tenant?.id } });

    // 📡 تحديد قناة الإرسال: QR (نص حر) أو API (قوالب معتمدة)
    const useWaWeb = tenant ? waWeb.isReady(tenant.id) : false;
    const metaConfig = tenant ? await db.models.WhatsAppConfig.findOne({ where: { tenant_id: tenant.id } }) : null;
    const apiReady = !useWaWeb && metaConfig && metaConfig.access_token; // API فقط (مو QR)
    let channelMode = 'qr';       // الافتراضي: نص حر (QR)
    let templates = [];
    if (apiReady) {
      channelMode = 'api';
      try { templates = await require('./helpers/metaProvider').fetchMetaTemplates(metaConfig); }
      catch (e) { templates = []; }
    }

    res.render("create_campaign.html", {
      user: req.user,
      activePage: 'campaigns',
      plan_name: plan?.name || 'الأساسية',
      campaigns_enabled: campaignsEnabled,
      msg_limit: msgLimit,
      messages_remaining: messagesRemaining,
      contacts_count: contactsCount,
      plan_features: planFeatures,
      channel_mode: channelMode,   // 'qr' | 'api'
      templates: templates
    });
  } catch (e) {
    console.error(e);
    res.status(500).send("Error: " + e.message);
  }
});

// Customers Route
app.get("/customers", async (req, res) => {
  try {
    if (!req.user) req.user = { merchant: { id: 123456789, name: 'Demo Merchant' } };
    const db = SallaDatabase.connection;
    const { Op } = require('sequelize');

    const tenant = await db.models.Tenant.findOne({
      where: { salla_merchant_id: req.user.merchant.id },
      include: [{ model: db.models.Subscription, include: [db.models.Plan] }]
    });

    const plan = tenant?.Subscription?.Plan;

    // Real customer data
    const customers = (db.models.Customer) ? await db.models.Customer.findAll({
      where: { tenant_id: tenant?.id },
      limit: 50,
      order: [['created_at', 'DESC']]
    }) : [];

    // Real stats
    const totalCustomers = await db.models.Customer.count({ where: { tenant_id: tenant?.id } });
    const vipCount = await db.models.Customer.count({
      where: {
        tenant_id: tenant?.id,
        [Op.or]: [{ total_orders: { [Op.gt]: 3 } }, { total_spent: { [Op.gt]: 500 } }]
      }
    });

    // New today
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const newToday = await db.models.Customer.count({
      where: { tenant_id: tenant?.id, created_at: { [Op.gte]: todayStart } }
    });

    res.render("customers.html", {
      user: req.user,
      customers,
      activePage: 'customers',
      plan_name: plan?.name || 'الأساسية',
      total_customers: totalCustomers,
      vip_count: vipCount,
      new_today: newToday
    });
  } catch (e) {
    console.error(e);
    res.status(500).send("Error loading customers: " + e.message);
  }
});

// ═══════════════════════════════════════════════════════════════════
// 📱 ربط واتساب عبر QR (whatsapp-web.js) — للتجربة
// ═══════════════════════════════════════════════════════════════════
const waWeb = require('./services/waWeb');

// يحلّ معرّف التاجر الحالي (للجلسة المنفصلة)
async function _waTenantId(req) {
  if (!req.user) req.user = { merchant: { id: 123456789, name: 'Demo Merchant' } };
  const db = SallaDatabase.connection;
  const tenant = await db.models.Tenant.findOne({ where: { salla_merchant_id: req.user.merchant.id } });
  return tenant ? tenant.id : null;
}

// صفحة الربط (QR)
app.get("/whatsapp-web", (req, res) => {
  if (!req.user) req.user = { merchant: { id: 123456789, name: 'Demo Merchant' } };
  res.render("whatsapp_web.html", { user: req.user, activePage: 'wa_web' });
});

// بدء الجلسة (يقلع المتصفح ويولّد QR) — لجلسة التاجر الحالي
app.post("/api/wa-web/start", async (req, res) => {
  try {
    const tid = await _waTenantId(req);
    if (!tid) return res.status(404).json({ ok: false, error: 'Tenant not found' });
    res.json({ ok: true, ...waWeb.start(tid) });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// حالة جلسة التاجر الحالي + QR (للـ polling)
app.get("/api/wa-web/status", async (req, res) => {
  try {
    const tid = await _waTenantId(req);
    if (!tid) return res.json({ ok: true, status: 'disconnected', qr: '', error: 'Tenant not found' });
    res.json({ ok: true, ...waWeb.getState(tid) });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// تسجيل الخروج لجلسة التاجر الحالي
app.post("/api/wa-web/logout", async (req, res) => {
  try {
    const tid = await _waTenantId(req);
    if (tid) await waWeb.logout(tid);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// 📞 توحيد رقم الجوال السعودي → صيغة E.164 بدون +
function _normalizePhone(p) {
  let s = String(p == null ? '' : p).replace(/[^\d]/g, '');
  if (!s) return '';
  if (s.startsWith('00')) s = s.slice(2);
  if (s.startsWith('0')) s = '966' + s.slice(1);          // 05xxxxxxxx → 9665xxxxxxxx
  else if (s.startsWith('5') && s.length === 9) s = '966' + s; // 5xxxxxxxx → 9665xxxxxxxx
  return s;
}

async function _getCustomerTenant(req) {
  if (!req.user) req.user = { merchant: { id: 123456789, name: 'Demo Merchant' } };
  const db = SallaDatabase.connection;
  const tenant = await db.models.Tenant.findOne({ where: { salla_merchant_id: req.user.merchant.id } });
  return { db, tenant };
}

// ➕ إضافة عميل واحد يدوياً
app.post("/api/customers", async (req, res) => {
  try {
    const { db, tenant } = await _getCustomerTenant(req);
    if (!tenant) return res.status(404).json({ ok: false, error: 'Tenant not found' });
    const name = (req.body.name || '').toString().trim();
    const phone = _normalizePhone(req.body.phone);
    const email = (req.body.email || '').toString().trim() || null;
    if (!name || !phone) return res.status(400).json({ ok: false, error: 'الاسم ورقم الجوال مطلوبان' });

    const [customer, created] = await db.models.Customer.findOrCreate({
      where: { tenant_id: tenant.id, phone },
      defaults: { tenant_id: tenant.id, name, phone, email, status: 'active' }
    });
    if (!created) return res.status(409).json({ ok: false, error: 'هذا الرقم مضاف مسبقاً' });
    res.json({ ok: true, customer });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// 🗑️ حذف عميل (مقصور على عملاء التاجر نفسه)
app.delete("/api/customers/:id", async (req, res) => {
  try {
    const { db, tenant } = await _getCustomerTenant(req);
    if (!tenant) return res.status(404).json({ ok: false, error: 'Tenant not found' });
    const deleted = await db.models.Customer.destroy({
      where: { id: req.params.id, tenant_id: tenant.id }   // 🔒 يمنع حذف عملاء تاجر آخر
    });
    if (!deleted) return res.status(404).json({ ok: false, error: 'العميل غير موجود' });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// 📥 استيراد عملاء دفعة واحدة (من CSV/Excel — تُرسل كمصفوفة JSON من المتصفح)
app.post("/api/customers/import", async (req, res) => {
  try {
    const { db, tenant } = await _getCustomerTenant(req);
    if (!tenant) return res.status(404).json({ ok: false, error: 'Tenant not found' });
    const rows = Array.isArray(req.body.customers) ? req.body.customers : [];
    if (!rows.length) return res.status(400).json({ ok: false, error: 'لا توجد بيانات للاستيراد' });

    let added = 0, skipped = 0, invalid = 0;
    for (const r of rows) {
      const name = (r.name || r['الاسم'] || r['اسم'] || '').toString().trim();
      const phone = _normalizePhone(r.phone || r['الجوال'] || r['رقم'] || r['الهاتف'] || r['رقم الجوال'] || '');
      const email = (r.email || r['البريد'] || '').toString().trim() || null;
      if (!name || !phone) { invalid++; continue; }
      const [, created] = await db.models.Customer.findOrCreate({
        where: { tenant_id: tenant.id, phone },
        defaults: { tenant_id: tenant.id, name, phone, email, status: 'active' }
      });
      created ? added++ : skipped++;
    }
    res.json({ ok: true, added, skipped, invalid, total: rows.length });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// 📤 تصدير عملاء التاجر كـ CSV
app.get("/customers/export", async (req, res) => {
  try {
    const { db, tenant } = await _getCustomerTenant(req);
    if (!tenant) return res.status(404).send('Tenant not found');
    const customers = await db.models.Customer.findAll({
      where: { tenant_id: tenant.id }, order: [['created_at', 'DESC']]
    });
    const esc = (v) => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`;
    let csv = 'الاسم,رقم الجوال,البريد,عدد الطلبات,إجمالي الإنفاق\n';
    for (const c of customers) {
      csv += [esc(c.name), esc(c.phone), esc(c.email), c.total_orders || 0, c.total_spent || 0].join(',') + '\n';
    }
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="my_customers.csv"');
    res.send('﻿' + csv);
  } catch (e) {
    res.status(500).send('Error: ' + e.message);
  }
});

// 🚀 تنفيذ إرسال حملة (يُستخدم للإرسال الفوري والمجدول) — مع تأخير آمن ضد الحظر
async function dispatchCampaign(campaignId, campaignImage = null) {
  const db = SallaDatabase.connection;
  const { Op } = require('sequelize');
  const campaign = await db.models.Campaign.findByPk(campaignId);
  if (!campaign) return;
  const tenant = await db.models.Tenant.findByPk(campaign.tenant_id);
  if (!tenant) return;
  await campaign.update({ status: 'processing' });

  const audience = campaign.target_group;
  const message = campaign.message_body || '';

  // 📋 هل هذه حملة قالب (API)؟
  let tmpl = null;
  try { const p = JSON.parse(message); if (p && p.template) tmpl = p; } catch (e) { /* نص حر */ }

  // جلب الجمهور المستهدف
  let customers = [];
  if (audience === 'vip') {
    customers = await db.models.Customer.findAll({ where: { tenant_id: tenant.id, [Op.or]: [{ total_orders: { [Op.gt]: 3 } }, { total_spent: { [Op.gt]: 500 } }] } });
  } else if (audience === 'abandoned') {
    customers = await db.models.Customer.findAll({ where: { tenant_id: tenant.id }, limit: 5 });
  } else if (audience === 'test') {
    customers = [{ name: 'تاجر (تجربة)', phone: '966500000000', id: 'test' }];
  } else {
    customers = await db.models.Customer.findAll({ where: { tenant_id: tenant.id } });
  }
  await campaign.update({ stats_total: customers.length });

  // تحديد القناة: QR أولاً ثم Meta
  const metaConfig = await db.models.WhatsAppConfig.findOne({ where: { tenant_id: tenant.id } });
  const useWaWeb = waWeb.isReady(tenant.id);
  const canSendApi = (!useWaWeb && metaConfig && metaConfig.access_token);
  let mediaId = null;
  if (canSendApi && campaignImage) {
    try { mediaId = await uploadMetaMedia(metaConfig, campaignImage); } catch (e) { console.error('[Campaign] image upload failed:', e.message); }
  }
  console.log(`[Campaign] Dispatching #${campaign.id} to ${customers.length} (${useWaWeb ? 'QR' : (canSendApi ? 'API' : 'Mock')})`);

  // ─── حماية ذكية من الحظر (تأخير تكيّفي + تبريد دوري) ───
  // التأخير يبدأ معتدلاً ويزيد تدريجياً كل ما أُرسلت رسائل أكثر،
  // مع عشوائية بشرية + تبريد أطول كل دفعة — يقلّل خطر كشف "الإرسال الآلي".
  const BATCH_SIZE = 10, DELAY_ERR = 60000;
  const rand = (min, max) => min + Math.floor(Math.random() * (max - min));
  const nextMsgDelay = (sentSoFar) => {
    const base = 6000 + Math.floor(sentSoFar / 50) * 1000;   // +1 ثانية كل 50 رسالة
    return Math.min(base, 20000) + rand(0, 5000);            // سقف 20 ثانية + عشوائية 0-5 ث
  };
  const batchCooldown = (batchNum) => Math.min(30000 + batchNum * 5000, 90000) + rand(0, 15000); // يزيد كل دفعة حتى 90+ ث

  let sentInBatch = 0, totalSent = 0, totalFailed = 0, batchNum = 0;

  for (const customer of customers) {
    if (!customer.phone) continue;
    try {
      let logContent;
      if (tmpl && canSendApi) {
        // 📋 حملة قالب معتمد عبر API — {{1}} = اسم العميل
        await sendMetaTemplate(metaConfig, customer.phone, tmpl.template, tmpl.lang || 'ar',
          [{ type: 'body', parameters: [{ type: 'text', text: customer.name || 'عميلنا العزيز' }] }]);
        logContent = `[قالب: ${tmpl.template}]`;
      } else {
        const personalMsg = message.replace(/{{name}}/g, customer.name || 'عميلنا العزيز').replace(/{{discount_code}}/g, 'SALE20');
        if (useWaWeb) {
          if (campaignImage) await waWeb.sendImage(tenant.id, customer.phone, campaignImage, personalMsg);
          else await waWeb.sendMessage(tenant.id, customer.phone, personalMsg);
        } else if (canSendApi) {
          if (mediaId) await sendMetaImage(metaConfig, customer.phone, mediaId, personalMsg);
          else await sendMetaMessage(metaConfig, customer.phone, personalMsg);
        }
        logContent = personalMsg;
      }
      await campaign.increment('stats_sent');
      totalSent++; sentInBatch++;
      await db.models.MessageLog.create({ tenant_id: tenant.id, direction: 'out', content: logContent, status: 'sent', to_phone: customer.phone, metadata: { campaign_id: campaign.id } });
      await incrementUsage(tenant.id, db.models, 1);
    } catch (err) {
      console.error(`[Campaign] Failed ${customer.phone}:`, err.message);
      await campaign.increment('stats_failed'); totalFailed++;
      if (err.response && (err.response.status === 429 || err.response.status === 503)) await new Promise(r => setTimeout(r, DELAY_ERR));
    }
    // تبريد دوري كل دفعة، وإلا تأخير تكيّفي متزايد بين الرسائل
    if (sentInBatch >= BATCH_SIZE) {
      batchNum++; sentInBatch = 0;
      const cd = batchCooldown(batchNum);
      console.log(`[Campaign] 📦 دفعة ${batchNum} (${totalSent}/${customers.length}) — تبريد ${Math.round(cd/1000)}ث`);
      await new Promise(r => setTimeout(r, cd));
    } else {
      await new Promise(r => setTimeout(r, nextMsgDelay(totalSent)));
    }
  }
  await campaign.update({ status: 'completed' });
  console.log(`[Campaign] ✅ #${campaign.id} done. Sent: ${totalSent}, Failed: ${totalFailed}`);
}

// ⏰ معالج الحملات المجدولة — يفحص كل دقيقة
setInterval(async () => {
  try {
    const db = SallaDatabase.connection;
    if (!db || !db.models.Campaign) return;
    const { Op } = require('sequelize');
    const due = await db.models.Campaign.findAll({
      where: { status: 'scheduled', scheduled_at: { [Op.lte]: new Date() } }, limit: 5
    });
    for (const c of due) {
      console.log(`[Campaign] ⏰ تشغيل حملة مجدولة #${c.id}`);
      dispatchCampaign(c.id).catch(e => console.error('Scheduled dispatch error:', e.message));
    }
  } catch (e) { /* تجاهل */ }
}, 60000);

app.post("/api/campaigns/send", async (req, res) => {
  try {
    // 1. Auth & Validation
    if (!req.user) req.user = { merchant: { id: 123456789, name: 'Demo Merchant' } };

    const db = SallaDatabase.connection;
    const { Op } = require("sequelize");

    // Find Tenant
    const tenant = await db.models.Tenant.findOne({ where: { salla_merchant_id: req.user.merchant.id } });
    if (!tenant) return res.status(404).json({ error: "Tenant not found" });

    // --- ENFORCE PLAN LIMITS ---
    const { checkLimit } = require('./helpers/limitsEngine');

    // Estimate audience size first to check if they have enough balance
    // This is a pre-check. The actual loop will also be guarded or we can trust this estimation.
    let audienceCount = 0;
    if (req.body.audience === 'all') {
      audienceCount = await db.models.Customer.count({ where: { tenant_id: tenant.id } });
    } else if (req.body.audience === 'vip') {
      audienceCount = await db.models.Customer.count({
        where: {
          tenant_id: tenant.id,
          [Op.or]: [{ total_orders: { [Op.gt]: 3 } }, { total_spent: { [Op.gt]: 500 } }]
        }
      });
    } else {
      audienceCount = 5; // Fallback for small groups
    }

    // Check if they can send THIS MANY messages
    // We pass 'campaign_msg' action and the count
    const limitCheck = await checkLimit(tenant.id, db.models, 'campaign_msg', audienceCount);

    if (!limitCheck.allowed) {
      return res.status(403).json({
        error: "PLAN_LIMIT_EXCEEDED",
        message: `عذراً، لا يمكنك إرسال هذه الحملة. ${limitCheck.reason}`,
        details: limitCheck
      });
    }
    // ---------------------------

    const { name, audience, message } = req.body;
    const campaignImage = req.body.image || null;   // صورة الحملة (base64) — للإرسال الفوري فقط

    // 📋 وضع API: لو اختار التاجر قالباً معتمداً، نخزّنه بدل النص الحر
    const templateName = req.body.template_name || null;
    const templateLang = req.body.template_lang || 'ar';
    const messageBody = templateName
      ? JSON.stringify({ template: templateName, lang: templateLang })
      : message;

    // 📅 الجدولة: لو مُرّر وقت مستقبلي → نحفظ الحملة كمجدولة (يرسلها الـ cron)
    let scheduledAt = null;
    if (req.body.scheduled_at) {
      const d = new Date(req.body.scheduled_at);
      if (!isNaN(d.getTime()) && d.getTime() > Date.now() + 30000) scheduledAt = d;
    }

    // 2. إنشاء سجل الحملة
    const campaign = await db.models.Campaign.create({
      tenant_id: tenant.id,
      name: name || 'بدون اسم',
      target_group: audience,
      message_body: messageBody,
      status: scheduledAt ? 'scheduled' : 'processing',
      scheduled_at: scheduledAt,
      media_url: campaignImage ? 'image_attached' : null,
      stats_total: audienceCount,
      stats_sent: 0
    });

    // 📅 حملة مجدولة — لا نرسل الآن، الـ cron يتكفّل في وقتها
    if (scheduledAt) {
      console.log(`[Campaign] 📅 Scheduled #${campaign.id} for ${scheduledAt.toISOString()}`);
      return res.json({ success: true, scheduled: true, scheduledAt: scheduledAt.toISOString(), campaignId: campaign.id, message: 'تمت جدولة الحملة بنجاح' });
    }

    // 🚀 إرسال فوري (في الخلفية)
    console.log(`[Campaign] Created #${campaign.id} for ${tenant.store_name} — sending now`);
    dispatchCampaign(campaign.id, campaignImage).catch(err => console.error("Background Campaign Error:", err));
    res.json({ success: true, message: "Campaign queued successfully", campaignId: campaign.id });

  } catch (e) {
    console.error("Campaign Error:", e);
    res.status(500).json({ error: e.message });
  }
});

// (Legacy whatsapp-simulator route removed - see proper route below)

// ---------------------------------------------------------
// AI SETTINGS ROUTES
// ---------------------------------------------------------

// 1. View Settings
app.get("/ai-settings", async (req, res) => {
  try {
    if (!req.user) req.user = { merchant: { id: 123456789, name: 'Demo Merchant' } };
    const db = SallaDatabase.connection;
    const tenant = await db.models.Tenant.findOne({
      where: { salla_merchant_id: req.user.merchant.id },
      include: [{ model: db.models.Subscription, include: [db.models.Plan] }]
    });

    const plan = tenant?.Subscription?.Plan;
    const aiConfig = (tenant && tenant.settings && tenant.settings.ai_config) ? tenant.settings.ai_config : {};

    res.render("ai_settings.html", { config: aiConfig, user: req.user, activePage: 'ai_settings', plan_name: plan?.name || 'الأساسية' });
  } catch (e) {
    res.status(500).send(e.message);
  }
});

// 2. Save Settings
app.post("/settings/ai", async (req, res) => {
  try {
    if (!req.user) req.user = { merchant: { id: 123456789, name: 'Demo Merchant' } };

    const connection = SallaDatabase.connection;
    const tenant = await connection.models.Tenant.findOne({ where: { salla_merchant_id: req.user.merchant.id } });

    if (tenant) {
      // Merge new AI config into existing settings
      const currentSettings = tenant.settings || {};
      currentSettings.ai_config = {
        bot_name: req.body.bot_name,
        bot_tone: req.body.bot_tone,
        custom_instructions: req.body.custom_instructions,
        policy_return: req.body.policy_return,
        shipping_time: req.body.shipping_time
      };

      // Update DB (Force update for JSON field)
      tenant.settings = currentSettings;
      tenant.changed('settings', true);
      await tenant.save();
    }

    res.redirect('/ai-settings?status=saved');
  } catch (e) {
    console.error(e);
    res.status(500).send("Error saving settings");
  }
});

// Helper to build System Prompt from Config
function buildSystemPrompt(config) {
  if (!config || !config.custom_instructions) return null; // Use Default if no config

  let toneDesc = "ودودة ومحترمة";
  if (config.bot_tone === 'formal') toneDesc = "رسمية ومهنية جداً";
  if (config.bot_tone === 'funny') toneDesc = "مرحة، خفيفة الظل، وتستخدم نكت بسيطة";

  return `
أنت مساعد ذكي للمتجر.
- اسمك: "${config.bot_name || 'مبهر'}"
- اللهجة/الأسلوب: ${toneDesc}
- سياسة الاسترجاع: ${config.policy_return || 'حسب النظام'}
- مدة التوصيل: ${config.shipping_time || 'غير محدد'}

تعليمات خاصة ومهمة جداً من التاجر:
${config.custom_instructions}

وظيفتك مساعدة العملاء بناءً على هذه المعلومات.
    `.trim();
}


// Socket.io for Simulator
io.on('connection', (socket) => {
  socket.on('simulate_chat_msg', async (msg) => {
    console.log(`📱 Simulator User: ${msg}`);

    // Simulate typing delay
    socket.emit('simulate_typing');

    try {
      // Fetch Tenant Settings for Simulation (Using Demo Tenant ID)
      const connection = SallaDatabase.connection;
      const tenant = await connection.models.Tenant.findOne({ where: { salla_merchant_id: 123456789 } });
      const aiConfig = (tenant && tenant.settings) ? tenant.settings.ai_config : null;
      const customPrompt = buildSystemPrompt(aiConfig);

      // Use the SAME Logic used for Real WhatsApp (Logs + AI)
      const ChatService = require('./services/ChatService');

      // Use ChatService to handle message
      const response = await ChatService.handleIncomingMessage({
        fromPhone: '966500000000',
        messageBody: msg,
        tenantId: tenant.id,
        isSimulated: true
      });

      const reply = response.reply || "لا يوجد رد (Check Logs)";

      socket.emit('simulate_chat_reply', reply);
      console.log(`🤖 AI Reply to Simulator: ${reply}`);

      // Also Log to Dashboard if open
      io.emit('log', {
        time: new Date().toLocaleTimeString('ar-SA'),
        event: '💬 محادثة (محاكاة)',
        customer: 'مستخدم تجريبي',
        status: 'تم الرد'
      });

    } catch (e) {
      console.error(e);
      socket.emit('simulate_chat_reply', "عذراً، حدث خطأ في النظام.");
    }
  });
});

// ---------------------------------------------------------
// TEST MESSAGE ROUTE
// ---------------------------------------------------------
app.post("/test/send-message", async (req, res) => {
  try {
    console.log("📨 Test Message Request Received...");

    // Mock User if needed
    if (!req.user) {
      req.user = { merchant: { id: 123456789 } };
    }

    const sallaId = req.user.merchant.id;
    const tenant = await SallaDatabase.getTenantBySallaID(sallaId);
    if (!tenant) return res.status(404).send("Tenant not found.");

    const connection = SallaDatabase.connection;

    // --- AUTO-FIX: Ensure Subscription Exists for Test ---
    const activeSub = await connection.models.Subscription.findOne({ where: { tenant_id: tenant.id, status: 'active' } });
    if (!activeSub) {
      console.log("🌱 Creating Trial Subscription for Test User...");
      const plan = await connection.models.Plan.findOne({ where: { name: 'Basic' } });
      if (plan) {
        await connection.models.Subscription.create({
          tenant_id: tenant.id,
          plan_id: plan.id,
          status: 'active',
          start_date: new Date(),
          end_date: new Date(new Date().setFullYear(new Date().getFullYear() + 1)), // 1 Year Trial
          usage_counter: 0
        });
      }
    }
    // -----------------------------------------------------

    const { test_phone } = req.body;


    // 1. Check Limits
    const limitCheck = await checkLimit(tenant.id, connection.models);
    if (!limitCheck.allowed) {
      return res.status(403).send(`<h1>Limit Reached</h1><p>${limitCheck.reason}</p>`);
    }

    // 2. Get Config
    const metaConfig = await connection.models.WhatsAppConfig.findOne({ where: { tenant_id: tenant.id } });
    if (!metaConfig || !metaConfig.access_token) {
      return res.status(400).send("<h1>Configuration Missing</h1><p>Please save Meta API settings first.</p>");
    }

    // 3. Send Message
    const message = "🔮 مرحباً! هذا اختبار اتصال ناجح من نظام مبهر AI.";
    await sendMetaMessage(metaConfig, test_phone, message);

    // 4. Increment Usage
    await incrementUsage(limitCheck.subscription, connection.models);

    // 5. Log
    await connection.models.MessageLog.create({
      tenant_id: tenant.id, direction: 'out', content: message, status: 'sent', to_phone: test_phone
    });

    res.redirect('/dashboard?status=sent');

  } catch (e) {
    console.error("Test Send Error:", e);
    res.status(500).send(`<pre>${e.message}\n${e.stack}</pre>`);
  }
});

// ---------------------------------------------------------
// NEW ROUTES FOR SIDEBAR NAVIGATION
// ---------------------------------------------------------

// ---------------------------------------------------------




// ---------------------------------------------------------
// SETTINGS ROUTES
// ---------------------------------------------------------
app.get("/settings", async (req, res) => {
  try {
    if (!req.user) req.user = { merchant: { id: 123456789, name: 'Demo Merchant' } };

    const db = SallaDatabase.connection;
    if (!db) return res.send("DB Booting...");

    // Find tenant with plan
    const tenant = await db.models.Tenant.findOne({
      where: { salla_merchant_id: req.user.merchant.id },
      include: [
        'WhatsAppConfig',
        { model: db.models.Subscription, include: [db.models.Plan] }
      ]
    });

    const plan = tenant?.Subscription?.Plan;
    const config = tenant?.WhatsAppConfig || {};

    res.render("settings.html", { config, user: req.user, activePage: 'settings', plan_name: plan?.name || 'الأساسية' });

  } catch (e) {
    console.error("Settings Route Error:", e);
    res.status(500).send("Error loading settings");
  }
});

app.post("/api/settings/save", async (req, res) => {
  try {
    if (!req.user) req.user = { merchant: { id: 123456789, name: 'Demo Merchant' } };
    const { phone_number_id, waba_id, access_token } = req.body;

    const db = SallaDatabase.connection;
    const tenant = await db.models.Tenant.findOne({
      where: { salla_merchant_id: req.user.merchant.id }
    });

    if (!tenant) return res.status(404).json({ error: 'Tenant not found' });

    // Update or Create Config
    let [config, created] = await db.models.WhatsAppConfig.findOrCreate({
      where: { tenant_id: tenant.id },
      defaults: { phone_number_id, waba_id, access_token, status: 'active' }
    });

    if (!created) {
      config.phone_number_id = phone_number_id;
      config.waba_id = waba_id;
      config.access_token = access_token;
      config.status = 'active'; // Assume active if updated
      await config.save();
    }

    res.json({ status: 'success' });

  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// ---------------------------------------------------------
// WHATSAPP SIMULATOR (Official)
// ---------------------------------------------------------
app.get("/whatsapp-simulator", (req, res) => {
  res.render("simulator.html", { user: req.user });
});

// ═══════════════════════════════════════════════════════════════════
// 🎭 تجربة عامة للزوّار (Demo) — ردود ذكية مكتوبة مسبقاً (بدون OpenAI)
// عام، بدون مصادقة، وصفر تكلفة — لتحفيز الزائر على الاشتراك
// ═══════════════════════════════════════════════════════════════════
const DemoBot = require('./services/DemoBot');
app.post("/api/demo/chat", (req, res) => {
  try {
    const { message } = req.body || {};
    const result = DemoBot.reply(message);
    res.json({ ok: true, ...result });
  } catch (e) {
    res.json({ ok: true, reply: 'أهلاً فيك! 😊 كيف أقدر أخدمك؟', tag: 'error' });
  }
});

// Simulator API to send message and get AI reply
app.post("/api/simulator/send", async (req, res) => {
  try {
    const { message, phone } = req.body;

    // Mock Tenant Identification (Demo Merchant)
    // In prod, you'd use req.user or a selected tenant from admin panel
    const SallaDatabase = require('./database/db_instance');
    const db = SallaDatabase.connection;

    const tenant = await db.models.Tenant.findOne({ where: { salla_merchant_id: 123456789 } });

    if (!tenant) return res.status(404).json({ error: "Demo Tenant Not Found. Please restart server to seed it." });

    const ChatService = require('./services/ChatService');

    const response = await ChatService.handleIncomingMessage({
      fromPhone: phone || '966500000000',
      messageBody: message,
      tenantId: tenant.id,
      isSimulated: true
    });

    res.json(response);

  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// Start Server
SallaDatabase.connect().then(async (connection) => {
  if (!connection) {
    console.error("⚠️ Database check failed. Starting server in LIMITED MODE (No DB).");
  }

  // Auto-Seed Plans if empty
  try {
    if (connection && connection.models) {
      const Plan = connection.models.Plan;
      console.log("🌱 Seeding Plans...");
      const plans = [
        {
          name: 'الأساسية',
          price_monthly: 79,
          price_yearly: 759,
          msg_limit_monthly: 10000,
          trial_days: 7,
          ai_model_config: { model: 'gpt-4o-mini' },
          is_active: true,
          features: {
            whatsapp_count: 1,
            campaigns: true,              // ✅ رسائل جماعية مجانية عبر QR
            whatsapp_qr: true,
            whatsapp_api: false,
            automation: true,
            ai_enabled: true,
            ai_model: 'GPT-4o Mini',
            ai_training_docs: 3,
            team_members: 1,
            support_level: 'priority',
            api_access: false,
            remove_branding: false,
            scenarios: 'basic'
          }
        },
        {
          name: 'النمو',
          price_monthly: 149,
          price_yearly: 1430,
          msg_limit_monthly: 35000,
          ai_model_config: { model: 'gpt-4o' },
          is_active: true,
          features: {
            whatsapp_count: 3,
            campaigns: true,
            automation: true,
            ai_enabled: true,
            ai_model: 'GPT-4o',
            ai_training_docs: 10,
            team_members: 5,
            support_level: 'priority',
            api_access: true,
            remove_branding: false,
            scenarios: 'advanced',
            messages_overage_price: 0.02,
            messages_hard_limit: 50000,
            fair_use: true
          }
        },
        {
          name: 'الشركات',
          price_monthly: 299,
          price_yearly: 2850,
          msg_limit_monthly: 100000,
          ai_model_config: { model: 'gpt-4o' },
          is_active: true,
          features: {
            whatsapp_count: 'unlimited',
            campaigns: true,
            automation: true,
            ai_enabled: true,
            ai_model: 'GPT-4o (Custom)',
            ai_training_docs: -1,
            team_members: 'unlimited',
            support_level: 'dedicated',
            api_access: true,
            remove_branding: true,
            scenarios: 'advanced',
            ai_custom: true,
            priority_support: true,
            messages_overage_price: 0.015,
            messages_hard_limit: 150000,
            fair_use: true
          }
        }
      ];

      for (const p of plans) {
        const [existingPlan, created] = await Plan.findOrCreate({
          where: { name: p.name },
          defaults: p
        });
        // Update features if plan already exists but features are missing/outdated
        if (!created && (!existingPlan.features || !existingPlan.features.ai_model)) {
          await existingPlan.update({ features: p.features, price_yearly: p.price_yearly });
        }
      }

      // Auto-Seed Demo Tenant & Config for Simulation
      const Tenant = connection.models.Tenant;
      const WhatsAppConfig = connection.models.WhatsAppConfig;

      // Check if Tenant exists
      let demoTenant = await Tenant.findOne({ where: { salla_merchant_id: 123456789 } });

      if (!demoTenant) {
        console.log("🌱 Seeding Demo Tenant...");
        demoTenant = await Tenant.create({
          salla_merchant_id: 123456789,
          store_name: "متجر الفخامة التجريبي",
          store_email: "demo@salla.sa",
          store_domain: "demo.salla.sa"
        }).catch(err => console.log("⚠️ Seed Tenant Exists/Error:", err.message));
      }

      if (demoTenant) {
        // Seed WhatsApp Config
        const demoConfig = await WhatsAppConfig.findOne({ where: { tenant_id: demoTenant.id } });
        if (!demoConfig) {
          console.log("🌱 Seeding Demo WhatsApp Config...");
          await WhatsAppConfig.create({
            tenant_id: demoTenant.id,
            phone_number_id: "123456", // Matches simulate_incoming_msg.js
            access_token: "mock_token",
            waba_id: "mock_waba",
            status: "active"
          }).catch(err => console.log("⚠️ Seed Config Exists/Error:", err.message));
        }

        // Seed or Fix Subscription (Link Tenant to النمو Plan)
        if (connection.models.Subscription) {
          const Subscription = connection.models.Subscription;
          const existingSub = await Subscription.findOne({ where: { tenant_id: demoTenant.id } });
          const growthPlan = await Plan.findOne({ where: { name: 'النمو' } });

          if (!existingSub && growthPlan) {
            console.log("🌱 Seeding Demo Subscription...");
            await Subscription.create({
              tenant_id: demoTenant.id,
              plan_id: growthPlan.id,
              status: 'active',
              is_yearly: false,
              start_date: new Date(),
              end_date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
            }).catch(err => console.log("⚠️ Seed Subscription Error:", err.message));
          } else if (existingSub && growthPlan) {
            // Fix: If linked to old plan (Simulation Pro, Starter, Pro, etc.), switch to النمو
            const currentPlan = await Plan.findByPk(existingSub.plan_id);
            if (currentPlan && !['الأساسية', 'النمو', 'الشركات'].includes(currentPlan.name)) {
              console.log(`🔄 Fixing subscription from "${currentPlan.name}" to "النمو"...`);
              await existingSub.update({ plan_id: growthPlan.id });
            }
          }
        }

        // Seed Customers (New)
        if (connection.models.Customer) {
          const Customer = connection.models.Customer;
          const countCust = await Customer.count({ where: { tenant_id: demoTenant.id } });
          if (countCust === 0) {
            console.log("🌱 Seeding Demo Customers...");
            await Customer.bulkCreate([
              { tenant_id: demoTenant.id, name: 'محمد الأحمد', phone: '966550000001', total_orders: 5, total_spent: 1500, last_order_at: new Date() },
              { tenant_id: demoTenant.id, name: 'سارة خالد', phone: '966550000002', total_orders: 1, total_spent: 250, last_order_at: new Date(Date.now() - 86400000) },
              { tenant_id: demoTenant.id, name: 'عبدالله فهد', phone: '966550000003', total_orders: 0, total_spent: 0, status: 'inactive' }
            ]);
          }
        }

        // Seed Campaigns (New)
        if (connection.models.Campaign) {
          const Campaign = connection.models.Campaign;
          const countCamp = await Campaign.count({ where: { tenant_id: demoTenant.id } });
          if (countCamp === 0) {
            console.log("🌱 Seeding Demo Campaigns...");
            await Campaign.create({
              tenant_id: demoTenant.id, name: 'عرض يوم التأسيس', status: 'completed', target_group: 'الكل', stats_total: 150, stats_sent: 150, created_at: new Date()
            });
            await Campaign.create({
              tenant_id: demoTenant.id, name: 'سلات متروكة', status: 'processing', target_group: 'Abandoned Cart', stats_total: 50, stats_sent: 12, created_at: new Date()
            });
          }
        }
      }

    }
  } catch (e) { console.log("Seed Info:", e.message); }

  // ── شغّل المُجدوِل (Cron) لسيناريوهات: birthday | reactivation | price_drop
  try {
    const scheduler = require('./jobs/scheduler');
    scheduler.start();
  } catch (e) {
    console.error('⚠️ Scheduler failed to start:', e.message);
  }

  // ── 🔄 استعادة جلسات واتساب (QR) المحفوظة للتجار المتصلين سابقاً
  try {
    waWeb.restoreAll();
  } catch (e) {
    console.error('⚠️ waWeb restore failed:', e.message);
  }

  const startServer = (retryPort) => {
    const serverInstance = server.listen(retryPort, () => {
      console.log(`🚀 SaaS System Ready on http://localhost:${retryPort}`);
      console.log(`💻 Dashboard: http://localhost:${retryPort}/dashboard`);
      console.log(`💬 Simulator: http://localhost:${retryPort}/whatsapp-simulator`);
    });

    serverInstance.on('error', (e) => {
      if (e.code === 'EADDRINUSE') {
        console.log(`⚠️ Port ${retryPort} in use, trying ${retryPort + 1}...`);
        startServer(retryPort + 1);
      } else {
        console.error(e);
      }
    });
  };

  startServer(port);
});
