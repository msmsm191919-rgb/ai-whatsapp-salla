// Import Deps & Configure Environment Files (Loads single-source env resolution)
const path = require("path");
const dotenv = require("dotenv");
const fs = require("fs");

const nodeEnv = process.env.NODE_ENV || 'development';

const envFileByEnvironment = {
  production: '.env.production',
  staging: '.env.staging',
  development: '.env.development',
  test: '.env.test'
};

const envFile = envFileByEnvironment[nodeEnv] || '.env.development';
const resolvedEnvPath = path.join(__dirname, envFile);

if (fs.existsSync(resolvedEnvPath)) {
  dotenv.config({ path: resolvedEnvPath, override: false });
} else {
  if (nodeEnv === "production" || nodeEnv === "staging") {
    console.error(`❌ FATAL: Environment config file ${envFile} is missing in ${nodeEnv} mode!`);
    process.exit(1);
  }
}

// Fail-Fast: Verify admin credentials are set in production/staging environments
if (nodeEnv === "production" || nodeEnv === "staging") {
  if (!process.env.ADMIN_EMAILS || !process.env.ADMIN_PASSWORD) {
    console.error("❌ FATAL: ADMIN_EMAILS and ADMIN_PASSWORD must be configured in environment variables!");
    process.exit(1);
  }
}

// Initialize Global Runtime Guard
const isStaging = nodeEnv === 'staging';
const isSafeModeFlag = process.env.STAGING_SAFE_MODE === 'true';

global.RUNTIME_GUARD = Object.freeze({
  environment: nodeEnv,
  staging: isStaging,
  safeModeEnabled: isStaging && isSafeModeFlag,
  locked: true
});

// Assert Runtime Guard Helper Function
function assertRuntimeGuard() {
  const guard = global.RUNTIME_GUARD;

  if (!guard || guard.locked !== true) {
    throw new Error('RUNTIME_GUARD_NOT_INITIALIZED');
  }

  if (process.env.NODE_ENV !== guard.environment) {
    throw new Error('ENV_MISMATCH_DETECTED');
  }

  if (guard.staging && guard.safeModeEnabled !== true) {
    throw new Error('STAGING_SAFE_MODE_REQUIRED');
  }
}

// Run Initial Boot Validation
assertRuntimeGuard();

// Initialize Global Safe Mode Immutable Guard (Backward Compatibility Layer)
global.SAFE_MODE = Object.freeze({
  enabled: global.RUNTIME_GUARD.safeModeEnabled,
  locked: true
});

if (global.SAFE_MODE.enabled) {
  console.log("🛡️ [SAFE MODE] Immutable Safe Mode guard activated.");
}

// Initialize Global Deterministic Worker Factory
global.createWorker = function createWorker(workerFn) {
  if (global.SAFE_MODE?.enabled === true) {
    const fnName = workerFn.name || 'anonymous';
    return function NOOP_WORKER() {
      console.log(`🛡️ [SAFE MODE] Deterministic worker execution bypassed: ${fnName}`);
      return null;
    };
  }
  return workerFn;
};

const express = require("express");
const app = express();
app.set('trust proxy', true);

// Runtime validation middleware (Graceful Shutdown instead of process.exit)
app.use((req, res, next) => {
  if (process.env.NODE_ENV !== global.RUNTIME_GUARD.environment) {
    console.error("❌ CRITICAL: NODE_ENV changed at runtime! Triggering central graceful shutdown...");
    gracefulShutdown('ENV_MISMATCH_DETECTED', new Error('NODE_ENV changed from ' + global.RUNTIME_GUARD.environment + ' to ' + process.env.NODE_ENV));
    return res.status(500).send("500 Internal Server Error");
  }
  next();
});
const session = require("express-session");
const passport = require("passport");
const nunjucks = require("nunjucks");
const port = process.argv[2] || process.env.PORT || 8095;
console.log("SERVER PORT:", port);

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
const waWeb = require('./services/waWeb');

if (SALLA_WEBHOOK_SECRET) {
  SallaWebhook.setSecret(SALLA_WEBHOOK_SECRET);
}

// Add Listeners
SallaWebhook.on("app.installed", (eventBody, userArgs) => {
  console.log("App Installed Event:", eventBody);
});

SallaWebhook.on("app.store.authorize", createWorker(async (data, next) => {
  try {
    const merchantId = data.merchant;
    const tokenData = data.data || data; // canonical Salla payload.data object
    
    console.log(`🔑 [Webhook] Easy Mode app.store.authorize received for merchant: ${merchantId}`);
    
    if (!merchantId) {
      throw new Error("Missing merchant in authorize payload");
    }

    if (!tokenData || !tokenData.access_token) {
      throw new Error("Missing access_token in authorize payload");
    }

    // Expiry validation: data.expires is Unix timestamp in seconds
    const expiresNum = Number(tokenData.expires);
    if (!Number.isFinite(expiresNum) || expiresNum <= 0) {
      throw new Error("Malformed expires timestamp in authorize payload");
    }

    const expiresMs = expiresNum * 1000;
    const expiresDate = new Date(expiresMs);
    if (isNaN(expiresDate.getTime())) {
      throw new Error("Invalid expires date in authorize payload");
    }

    // Plausibility check: timestamp must be after 2024-01-01 (1704067200000)
    if (expiresMs < 1704067200000) {
      throw new Error("Implausible expires timestamp in authorize payload");
    }

    const db = SallaDatabase.connection;
    if (!db) return;

    // 1. Fetch store info from Salla API using the new access token
    const SallaAdapter = require('./services/platforms/SallaAdapter');
    const storeInfo = await SallaAdapter.fetchStoreInfo(tokenData.access_token);

    const ConnectService = require('./services/ConnectService');
    
    // 2. Create or update Tenant + SallaOAuth credentials (without starting trial/subscription)
    const { tenant } = await ConnectService.upsertTenantFromOAuth({
      platform: 'salla',
      skipSubscriptionTrial: true,
      tokenData: {
        access_token: tokenData.access_token,
        refresh_token: tokenData.refresh_token,
        expires_at: expiresDate,
        scope: tokenData.scope || null,
        token_type: tokenData.token_type || 'Bearer',
        store_id: String(merchantId),
        store_name: storeInfo.store_name,
        store_domain: storeInfo.store_domain,
        email: storeInfo.email,
        owner_name: storeInfo.owner_name,
        contact_phone: storeInfo.contact_phone
      }
    });

    // Mark billing source as salla and integration status as active
    const settings = tenant.settings || {};
    await tenant.update({
      status: 'active',
      settings: { ...settings, billing_source: 'salla', salla_integration_status: 'active' }
    });

    console.log(`✅ [Webhook] Easy Mode tenant ${tenant.id} (${tenant.store_name}) authorized/updated successfully.`);
  } catch (e) {
    console.error("❌ Error processing app.store.authorize webhook:", e.message);
    throw e; // rethrow so WebhookInboxWorker can mark as failed/retry if transient
  }
}));

SallaWebhook.on("communication.whatsapp.send", createWorker(async (data, next) => {
  try {
    const merchantId = data.merchant;
    const commData = data.data || data;
    console.log(`💬 [Webhook] Salla Communication WhatsApp Send received for merchant: ${merchantId}`);
    
    if (!merchantId) throw new Error("Missing merchant in communication payload");

    const recipient = commData.mobile || commData.recipient || commData.to || commData.notifiable;
    const messageText = commData.message || commData.content || commData.text;
    const eventType = commData.type || commData.event || 'order.status.updated';

    if (!recipient || !messageText) {
      console.warn(`⚠️ [Webhook] Communication payload missing recipient or text. Event type: ${eventType}`);
      return { ok: true, success: false, ignored: true, reason: "missing_recipient_or_content" };
    }

    const db = SallaDatabase.connection;
    if (!db) throw new Error("Database connection unavailable");

    // Resolve tenant strictly by merchantId
    const tenant = await db.models.Tenant.findOne({
      where: { salla_merchant_id: Number(merchantId) }
    });

    if (!tenant) {
      console.error(`❌ Tenant not found for Salla merchant: ${merchantId}`);
      return { ok: false, success: false, error: "tenant_not_found" };
    }

    // Deliver via tenant's connected WhatsApp channel
    const waWebMod = require('./services/waWeb');
    const whatsappSender = require('./services/whatsappSender');

    let sendResult = null;
    if (waWebMod.isReady(tenant.id)) {
      sendResult = await waWebMod.sendMessage(tenant.id, recipient, messageText);
    } else {
      // Fall back to WhatsApp Cloud API if configured for tenant
      sendResult = await whatsappSender.sendMessage(tenant.id, recipient, messageText);
    }

    console.log(`✅ [Webhook] Communication WhatsApp sent for tenant ${tenant.id} (${tenant.store_name}) to ${recipient}`);
    return { ok: true, success: true, status: "sent", message_id: sendResult?.id || null };
  } catch (e) {
    console.error("❌ Error processing communication.whatsapp.send webhook:", e.message);
    throw e;
  }
}));

// Dedicated Secure Salla App Function Endpoint for WhatsApp Communication
app.post("/api/v1/communication/whatsapp/send", express.json(), async (req, res) => {
  try {
    const rawSignature = req.headers['x-salla-signature'] || req.headers['x-mubhir-signature'];
    const merchantId = req.body.merchant || req.body.merchant_id || req.body.data?.merchant;
    const commData = req.body.data || req.body;

    console.log(`💬 [AppFunction Endpoint] WhatsApp send requested for merchant: ${merchantId}`);

    if (!merchantId) {
      return res.status(400).json({ ok: false, success: false, error: "missing_merchant_identity" });
    }

    const recipient = commData.notifiable || commData.recipient || commData.mobile || commData.to;
    const messageText = commData.content || commData.message || commData.text;
    const eventType = commData.type || commData.event || 'order.status.updated';

    if (!recipient || !messageText) {
      return res.status(400).json({ ok: false, success: false, error: "missing_recipient_or_content" });
    }

    const db = SallaDatabase.connection;
    if (!db) return res.status(503).json({ ok: false, error: "database_unavailable" });

    // Strict Tenant resolution by salla_merchant_id with platform='salla'
    const tenant = await db.models.Tenant.findOne({
      where: { salla_merchant_id: Number(merchantId) }
    });

    if (!tenant) {
      console.error(`❌ AppFunction Endpoint: Tenant not found for merchant ${merchantId}`);
      return res.status(404).json({ ok: false, success: false, error: "tenant_not_found" });
    }

    // Deliver via tenant's connected WhatsApp channel
    const waWebMod = require('./services/waWeb');
    const whatsappSender = require('./services/whatsappSender');

    let sendResult = null;
    let isReady = waWebMod.isReady(tenant.id);

    if (isReady) {
      sendResult = await waWebMod.sendMessage(tenant.id, recipient, messageText);
    } else if (tenant.WhatsAppConfig?.access_token) {
      sendResult = await whatsappSender.sendMessage(tenant.id, recipient, messageText);
    } else {
      console.warn(`⚠️ AppFunction Endpoint: WhatsApp channel not ready for tenant ${tenant.id}`);
      return res.status(422).json({ ok: false, success: false, error: "whatsapp_channel_not_ready" });
    }

    console.log(`✅ AppFunction Endpoint: WhatsApp sent for tenant ${tenant.id} to ${recipient}`);
    return res.json({ ok: true, success: true, status: "sent", message_id: sendResult?.id || "msg_mock_123" });
  } catch (e) {
    console.error("❌ AppFunction Endpoint error:", e.message);
    return res.status(500).json({ ok: false, success: false, error: e.message });
  }
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
SallaWebhook.on('basket.abandoned', createWorker(async (data, next) => {
  try {
    console.log('🛒 Basket Abandoned Event Received');
    const ScenarioService = require('./services/ScenarioService');
    await ScenarioService.handleAbandonedCart(data);
  } catch (e) {
    console.error("Webhook Delegate Error:", e);
  }
}));

SallaWebhook.on('order.created', createWorker(async (data, next) => {
  console.log('📦 New Order Created:', data.data.id);
  // Optional: Send Order Confirmation here
}));

SallaWebhook.on('order.shipping.delivered', createWorker(async (data, next) => {
  try {
    console.log('🚚 Order Delivered Event (Triggering Review Request)');
    const ScenarioService = require('./services/ScenarioService');
    await ScenarioService.handleOrderCompleted(data);
  } catch (e) {
    console.error("Order Delivered Error:", e);
  }
}));

SallaWebhook.on('application/store', createWorker(async (data, next) => {
  console.log('🔔 Salla Store Updated:', data.merchant);
}));

SallaWebhook.on('app.uninstalled', createWorker(async (data, next) => {
  try {
    const merchantId = data.merchant;
    console.log(`🔌 [Webhook] App uninstalled event received for merchant: ${merchantId}`);
    
    const db = SallaDatabase.connection;
    if (!db) return;
    
    const tenant = await db.models.Tenant.findOne({
      where: { salla_merchant_id: merchantId }
    });
    
    if (tenant) {
      console.log(`🔌 [Webhook] Revoking Salla integration for Tenant ${tenant.id} (${tenant.store_name})`);
      
      // Update Salla integration status in settings
      const settings = tenant.settings || {};
      await tenant.update({ settings: { ...settings, salla_integration_status: 'revoked' } });
      
      // Clear Salla OAuth credentials
      await db.models.SallaOAuth.destroy({ where: { tenant_id: tenant.id } });
      
      console.log(`✅ [Webhook] Tenant ${tenant.id} Salla integration revoked. WhatsApp session remains active.`);
    }
  } catch (e) {
    console.error('❌ Error handling app.uninstalled webhook:', e);
  }
}));

// ── سيناريو "تحديث حالة الطلب" ── يستجيب لـ Salla webhook
const orderStatusScenario = require('./services/scenarios/orderStatus.scenario');
SallaWebhook.on('order.status.updated', createWorker(async (data, next) => {
  try {
    await orderStatusScenario.handle(data);
  } catch (e) {
    console.error('order.status.updated handler error:', e);
  }
}));

// ── اشتراكات التطبيق الرسمية من سلة (Salla App Plans Subscriptions) ──
SallaWebhook.on('app.subscription.started', createWorker(async (data, next) => {
  try {
    const merchantId = data.merchant;
    const planId = data.data?.plan?.id;
    const planName = data.data?.plan?.name;
    const subscriptionId = data.data?.id;
    const status = data.data?.status;
    const details = {
      billing_period: data.data?.billing_period || 'monthly',
      start_date: data.data?.start_date,
      end_date: data.data?.end_date,
      promotion: data.data?.promotion
    };

    console.log(`📩 Webhook [app.subscription.started] received — merchant=${merchantId} planId=${planId} planName=${planName}`);
    await BillingService.handleSallaSubscriptionUpdate(merchantId, planId, planName, subscriptionId, status, details);
  } catch (e) {
    console.error('Error in app.subscription.started listener:', e);
  }
}));

SallaWebhook.on('app.subscription.renewed', createWorker(async (data, next) => {
  try {
    const merchantId = data.merchant;
    const planId = data.data?.plan?.id;
    const planName = data.data?.plan?.name;
    const subscriptionId = data.data?.id;
    const status = data.data?.status;
    const details = {
      billing_period: data.data?.billing_period || 'monthly',
      start_date: data.data?.start_date,
      end_date: data.data?.end_date
    };

    console.log(`📩 Webhook [app.subscription.renewed] received — merchant=${merchantId} planId=${planId} planName=${planName}`);
    await BillingService.handleSallaSubscriptionUpdate(merchantId, planId, planName, subscriptionId, status, details);
  } catch (e) {
    console.error('Error in app.subscription.renewed listener:', e);
  }
}));

SallaWebhook.on('app.subscription.expired', createWorker(async (data, next) => {
  try {
    const merchantId = data.merchant;
    const subscriptionId = data.data?.id;

    console.log(`📩 Webhook [app.subscription.expired] received — merchant=${merchantId}`);
    await BillingService.handleSallaSubscriptionExpired(merchantId, subscriptionId);
  } catch (e) {
    console.error('Error in app.subscription.expired listener:', e);
  }
}));


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

// Helper: Derive per-merchant communication authentication secret
function deriveMerchantCommunicationSecret(masterSecret, merchantId) {
  if (!masterSecret || !merchantId) return null;
  const contextString = `salla-communication-v1:${Number(merchantId)}`;
  return crypto.createHmac('sha256', masterSecret)
    .update(contextString)
    .digest('hex');
}

// In-Memory Idempotency Cache for Salla Communication Events (24-Hour TTL)
const communicationIdempotencyCache = new Map();
function getCommunicationIdempotency(key) {
  if (!key) return null;
  const cached = communicationIdempotencyCache.get(key);
  if (!cached) return null;
  if (Date.now() > cached.expiresAt) {
    communicationIdempotencyCache.delete(key);
    return null;
  }
  return cached.response;
}
function setCommunicationIdempotency(key, response, ttlMs = 86400000) {
  if (!key) return;
  communicationIdempotencyCache.set(key, {
    response,
    expiresAt: Date.now() + ttlMs
  });
}

// Salla Communication App Event Endpoint: WhatsApp Send
app.post("/api/v1/communication/whatsapp/send", express.raw({ type: '*/*' }), async (req, res) => {
  try {
    const rawBodyBuffer = req.body;
    const rawBodyString = Buffer.isBuffer(rawBodyBuffer) ? rawBodyBuffer.toString('utf8') : JSON.stringify(req.body);

    let payload = {};
    try {
      payload = JSON.parse(rawBodyString);
    } catch (e) {
      return res.status(400).json({ ok: false, success: false, error: "malformed_json_body" });
    }

    const merchantId = payload.merchant || payload.data?.merchant;
    if (!merchantId) {
      return res.status(400).json({ ok: false, success: false, error: "missing_salla_merchant_id" });
    }

    const masterSecret = process.env.SALLA_WEBHOOK_SECRET;
    if (!masterSecret) {
      console.error("❌ [WhatsApp Endpoint] SALLA_WEBHOOK_SECRET is not configured");
      return res.status(500).json({ ok: false, success: false, error: "server_configuration_error" });
    }

    const expectedMerchantSecret = deriveMerchantCommunicationSecret(masterSecret, merchantId);
    const signatureHeader = req.headers['x-mubhir-signature'] || req.headers['x-salla-signature'];

    if (!signatureHeader || typeof signatureHeader !== 'string') {
      return res.status(401).json({ ok: false, success: false, error: "missing_signature_header" });
    }

    const expectedSignature = crypto.createHmac('sha256', expectedMerchantSecret)
      .update(rawBodyString)
      .digest('hex');

    const sigBuf = Buffer.from(signatureHeader.trim().toLowerCase());
    const expBuf = Buffer.from(expectedSignature.toLowerCase());

    if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
      console.warn(`⚠️ [WhatsApp Endpoint] Signature verification failed for merchant ${merchantId}`);
      return res.status(401).json({ ok: false, success: false, error: "invalid_signature" });
    }

    const eventData = payload.data || {};
    const eventType = eventData.type || payload.event;
    const notifiable = eventData.notifiable;
    const messageContent = eventData.content;

    if (!notifiable || (Array.isArray(notifiable) && notifiable.length === 0)) {
      return res.status(400).json({ ok: false, success: false, error: "missing_recipient_notifiable" });
    }

    const recipient = Array.isArray(notifiable) ? notifiable[0] : String(notifiable);
    if (!recipient || typeof recipient !== 'string') {
      return res.status(400).json({ ok: false, success: false, error: "invalid_recipient_format" });
    }

    const idempotencyKey = req.headers['x-salla-event-id'] || payload.event_id || `${merchantId}_${eventType}_${recipient}_${crypto.createHash('md5').update(messageContent || '').digest('hex')}`;
    const cachedResponse = getCommunicationIdempotency(idempotencyKey);
    if (cachedResponse) {
      console.log(`ℹ️ [WhatsApp Endpoint] Idempotent cache hit for key ${idempotencyKey}`);
      return res.json(cachedResponse);
    }

    const db = SallaDatabase.connection;
    if (!db) return res.status(503).json({ ok: false, error: "database_unavailable" });

    const tenant = await db.models.Tenant.findOne({
      where: { salla_merchant_id: Number(merchantId) }
    });

    if (!tenant) {
      console.error(`❌ [WhatsApp Endpoint] Tenant not found for merchant ${merchantId}`);
      return res.status(404).json({ ok: false, success: false, error: "tenant_not_found" });
    }

    const messageText = String(messageContent || '').trim();
    if (!messageText) {
      return res.status(400).json({ ok: false, success: false, error: "empty_message_content" });
    }

    const isReady = waWebMod.isReady ? waWebMod.isReady(tenant.id) : false;
    let sendResult = null;

    if (isReady) {
      sendResult = await waWebMod.sendMessage(tenant.id, recipient, messageText);
    } else if (tenant.WhatsAppConfig?.access_token) {
      sendResult = await whatsappSender.sendMessage(tenant.id, recipient, messageText);
    } else {
      console.warn(`⚠️ [WhatsApp Endpoint] WhatsApp channel not ready for tenant ${tenant.id}`);
      return res.status(422).json({ ok: false, success: false, error: "whatsapp_channel_not_ready" });
    }

    const responsePayload = { ok: true, success: true, status: "sent", message_id: sendResult?.id || "msg_mock_123" };
    setCommunicationIdempotency(idempotencyKey, responsePayload);

    console.log(`✅ [WhatsApp Endpoint] Sent for tenant ${tenant.id} to ${recipient}`);
    return res.json(responsePayload);
  } catch (e) {
    console.error("❌ WhatsApp Endpoint error:", e.message);
    return res.status(500).json({ ok: false, success: false, error: e.message });
  }
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
app.use(express.json({
  limit: '12mb',
  verify: (req, res, buf) => {
    if (req.originalUrl && req.originalUrl.startsWith('/webhook')) {
      req.rawBody = buf;
    }
  }
}));
app.use(express.urlencoded({ extended: true, limit: '12mb' }));

// Session & Passport configuration (MUST BE BEFORE ANY ROUTER OR ROUTE GUARD)
if (process.env.NODE_ENV === 'staging' || process.env.NODE_ENV === 'production') {
  const secret = process.env.SESSION_SECRET;
  if (!secret) {
    console.error("❌ FATAL: SESSION_SECRET is not defined in environment variables!");
    process.exit(1);
  }
  if (secret.length < 32 || secret === "keyboard cat" || secret.includes("secret") || secret.includes("12345")) {
    console.error("❌ FATAL: SESSION_SECRET is too weak or uses insecure default values (must be at least 32 characters long)!");
    process.exit(1);
  }
}

const sessionCookieName = process.env.SESSION_COOKIE_NAME || "connect.sid";
app.use(
  session({
    name: sessionCookieName,
    secret: process.env.SESSION_SECRET || "keyboard cat",
    resave: true,
    saveUninitialized: true
  })
);
app.use(passport.initialize());
app.use(passport.session());

// DEV ONLY Mock Auth Middleware REMOVED for Production

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

// 📡 حقن قناة واتساب النشطة لكل تاجر — يتحكم في القائمة الجانبية
// 'qr' = ربط QR متصل | 'api' = WhatsApp API مفعّل | 'none' = ما ربط شي بعد
app.use(async (req, res, next) => {
  try {
    const db = SallaDatabase.connection;
    if (!db || !db.models?.Tenant) { res.locals.activeChannel = 'none'; return next(); }

    const tenantId = req.user?.tenant_id || req.session?.tenantId;
    let tenant = null;

    if (tenantId) {
      tenant = await db.models.Tenant.findByPk(tenantId);
    } else if (req.user?.merchant?.id) {
      tenant = await db.models.Tenant.findOne({ where: { salla_merchant_id: req.user.merchant.id } });
    }

    if (!tenant) { res.locals.activeChannel = 'none'; return next(); }
    const waWebMod = require('./services/waWeb');
    if (waWebMod.isReady(tenant.id)) {
      res.locals.activeChannel = 'qr';
    } else {
      const wa = await db.models.WhatsAppConfig.findOne({ where: { tenant_id: tenant.id } });
      const tok = wa && wa.access_token;
      res.locals.activeChannel = (tok && tok !== 'mock_access_token') ? 'api' : 'none';
    }
  } catch (e) { res.locals.activeChannel = 'none'; }
  next();
});

// ⛔ حارس endpoints التطوير — يرجّع 404 في الإنتاج (يمنع تزوير الترقية/الدفع)
const devOnly = (req, res, next) => {
  if (process.env.NODE_ENV !== 'development') {
    return res.status(404).json({ ok: false, error: 'Not found' });
  }
  next();
};

// 🔐 Admin Login Routes — MUST be defined BEFORE ensureAuthenticated/requireAdmin middleware
app.get('/admin/login', (req, res) => {
  // If already has admin session, redirect to admin dashboard
  if (req.session && req.session.isAdmin) {
    return res.redirect('/admin');
  }
  const errorParam = req.query.error;
  const error = errorParam === '1' ? 'بيانات الدخول غير صحيحة' : null;
  res.render('admin/login.html', { error });
});

app.post('/admin/login', (req, res) => {
  const { email, password } = req.body;
  const adminEmails = process.env.ADMIN_EMAILS
    ? process.env.ADMIN_EMAILS.split(',').map(e => e.trim().toLowerCase())
    : [];
  const adminPassword = process.env.ADMIN_PASSWORD;

  if (
    email &&
    password &&
    adminPassword &&
    adminEmails.includes(email.toLowerCase().trim()) &&
    password === adminPassword
  ) {
    // Create admin session
    const userSession = {
      merchant: { id: 'admin', name: 'مدير النظام', email: email.toLowerCase().trim() },
      email: email.toLowerCase().trim(),
      platform: 'admin'
    };
    req.login(userSession, (err) => {
      if (err) {
        console.error('[Admin Login] Session error:', err);
        return res.redirect('/admin/login?error=1');
      }
      req.session.isAdmin = true;
      res.redirect('/admin');
    });
  } else {
    console.warn(`[SECURITY] Failed admin login attempt for email: ${email || 'empty'}`);
    res.redirect('/admin/login?error=1');
  }
});

// 🔒 حماية المسارات الخاصة بالـ SaaS ومنع أي وصول غير مصرح به أو Fallback للمتجر الافتراضي
app.use([
  '/dashboard', '/settings', '/logs', '/api/whatsapp-numbers', 
  '/automation', '/campaigns', '/ai-settings',
  '/scenarios', '/customers', '/billing', '/pricing', '/whatsapp-simulator', '/simulator', '/whatsapp-web', '/api/wa-web/start', '/api/wa-web/status', '/api/wa-web/logout'
], ensureAuthenticated);

// 🔒 منع الحسابات المنتهية من الوصول للمسارات التشغيلية وتحويلهم لصفحة الاشتراك
app.use([
  '/dashboard', '/logs', '/customers', '/scenarios', '/whatsapp-web', '/automation',
  '/api/wa-web', '/api/customers', '/api/scenarios'
], ensureSubscriptionActive);

// 🔒 حماية المسارات الإدارية للمسؤولين فقط
// ملاحظة: app.use في Express يطابق كل المسارات الفرعية تلقائياً (prefix match)
// '/admin' يغطي /admin و/admin/plans و/admin/subscriptions وما تحتها
app.use(['/admin', '/api/admin'], requireAdmin);

app.use('/api', apiRoutes);
app.use('/dashboard', dashboardRoutes);
app.use('/settings', settingsRoutes);
app.use('/admin', adminRoutes);

// Public pages routes (Legal & Support)
app.get('/privacy', (req, res) => {
  res.render('privacy.html', { user: req.user, isLogin: req.user });
});

app.get('/terms', (req, res) => {
  res.render('terms.html', { user: req.user, isLogin: req.user });
});

app.get('/support', (req, res) => {
  res.render('support.html', {
    user: req.user,
    isLogin: req.user,
    support_email: 'support@mubhirbot.com',
    support_whatsapp: process.env.SUPPORT_WHATSAPP_NUMBER || ''
  });
});

// 🎨 Interactive Widget Demo & Preview Page
app.get('/widget-demo', async (req, res) => {
  try {
    const merchantId = req.user?.merchant?.id || (process.env.NODE_ENV === 'development' ? 123456789 : null);
    const db = SallaDatabase.connection;
    let planName = 'الأساسية';
    if (db && db.models?.Tenant) {
      const tenant = await db.models.Tenant.findOne({
        where: { salla_merchant_id: merchantId },
        include: [{ model: db.models.Subscription, include: [db.models.Plan] }]
      });
      planName = tenant?.Subscription?.Plan?.name || 'الأساسية';
    }
    res.render('widget_demo.html', {
      user: req.user || { merchant: { name: 'متجر تجريبي' } },
      plan_name: planName,
      activePage: 'widget_demo'
    });
  } catch (e) {
    res.render('widget_demo.html', {
      user: req.user || { merchant: { name: 'متجر تجريبي' } },
      plan_name: 'الأساسية',
      activePage: 'widget_demo'
    });
  }
});

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
// Session & Passport moved to top above routers

// (moved injectPlanContext to before routes — see line ~247)

// Webhook Route
app.post("/webhook", async (req, res) => {
  try {
    const signature = req.headers['x-salla-signature'];
    if (!signature) {
      console.error("❌ Webhook Reject: Missing x-salla-signature header");
      return res.status(401).json({ ok: false, error: 'Missing x-salla-signature header' });
    }

    if (!req.rawBody) {
      console.error("❌ Webhook Reject: Missing raw body buffer");
      return res.status(400).json({ ok: false, error: 'Missing raw body buffer' });
    }

    if (!SALLA_WEBHOOK_SECRET) {
      console.error("❌ FATAL: SALLA_WEBHOOK_SECRET is not configured!");
      return res.status(500).json({ ok: false, error: 'Webhook secret not configured' });
    }

    // Timing-safe HMAC-SHA256 signature verification
    const crypto = require('crypto');
    const calculated = crypto
      .createHmac('sha256', SALLA_WEBHOOK_SECRET)
      .update(req.rawBody)
      .digest('hex');

    let isValid = false;
    try {
      isValid = crypto.timingSafeEqual(
        Buffer.from(calculated, 'utf8'),
        Buffer.from(signature, 'utf8')
      );
    } catch (e) {
      isValid = false;
    }

    if (!isValid) {
      console.error("❌ Webhook Reject: Signature verification failed");
      return res.status(401).json({ ok: false, error: 'Signature verification failed' });
    }

    // Compute unique event fingerprint from rawBody
    const fingerprint = crypto.createHash('sha256').update(req.rawBody).digest('hex');
    const eventId = req.body.id || fingerprint;
    const eventType = req.body.event;
    const storeId = req.body.merchant;

    // Enqueue event in Transactional Inbox
    const WebhookInboxWorker = require('./services/WebhookInboxWorker');
    const enqueueResult = await WebhookInboxWorker.enqueue('salla', eventId, eventType, storeId, req.rawBody.toString('utf8'));

    if (enqueueResult.duplicate) {
      return res.status(200).json({ ok: true, message: 'Duplicate event ignored' });
    }

    return res.status(200).json({ ok: true });
  } catch (error) {
    console.error("❌ Exception inside Webhook route:", error.message);
    res.status(500).json({ ok: false, error: 'Internal Server Error' });
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

  if (global.SAFE_MODE?.enabled === true && process.env.ALLOW_INSECURE_STAGING !== 'true') {
    console.log('🛡️ [SAFE MODE] Blocked Meta webhook side effects (validation only allowed).');
    return;
  }

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
                const HandoffService = require('./services/HandoffService');
                const chatKey = HandoffService.getChatKey(from);
                const isPaused = await HandoffService.isPaused(config.tenant_id, chatKey);

                if (isPaused) {
                  await connection.models.MessageLog.create({
                    tenant_id: config.tenant_id,
                    direction: 'in',
                    content: msgBody,
                    status: 'received',
                    to_phone: from
                  });
                  console.log(`🔕 [Meta Webhook] Handoff active for ${chatKey}. Message logged, AI skipped.`);
                  if (!res.headersSent) res.sendStatus(200);
                  return;
                }

                if (HandoffService.shouldTriggerHandoff(msgBody)) {
                  // Check Plan Gate first before pausing or sending any handoff notification
                  const planGate = require('./services/planGate');
                  const access = await planGate.checkTenantAccess(config.tenant_id);
                  if (!access.allowed) {
                    await connection.models.MessageLog.create({
                      tenant_id: config.tenant_id,
                      direction: 'in',
                      content: msgBody,
                      status: 'received',
                      to_phone: from
                    });
                    console.log(`🔕 [Meta Webhook] Handoff triggered but Plan Gate blocked. Message logged, no reply.`);
                    if (!res.headersSent) res.sendStatus(200);
                    return;
                  }

                  await HandoffService.pauseChat(config.tenant_id, chatKey, {
                    reason: 'keyword',
                    last_message: msgBody,
                    channel: 'api'
                  });
                  const replyText = "تم تحويل محادثتك للموظف المختص، وسيتم الرد عليك في أقرب وقت ممكن. 🌸";

                  await connection.models.MessageLog.create({
                    tenant_id: config.tenant_id,
                    direction: 'in',
                    content: msgBody,
                    status: 'received',
                    to_phone: from
                  });
                  await connection.models.MessageLog.create({
                    tenant_id: config.tenant_id,
                    direction: 'out',
                    content: replyText,
                    status: 'sent',
                    to_phone: from
                  });

                  await sendMetaMessage(config, from, replyText);
                  console.log(`⏸️ [Meta Webhook] Handoff triggered for ${chatKey}. Reply sent, AI skipped.`);
                  if (!res.headersSent) res.sendStatus(200);
                  return;
                }

                // Check Plan Gate first
                const planGate = require('./services/planGate');
                const access = await planGate.checkTenantAccess(config.tenant_id, 'whatsapp_api');
                if (!access.allowed) {
                  console.log(`[planGate] blocked tenant ${config.tenant_id} reason=${access.reason}`);
                  return res.status(200).send("PLAN_GATE_BLOCKED");
                }

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

// Secure CLI-based login token exchange route (STAGING & DEVELOPMENT ONLY)
app.get("/login/token", async (req, res) => {
  if (process.env.NODE_ENV === 'production') {
    return res.status(404).send("Not Found");
  }
  const token = req.query.token;
  if (!token) return res.status(400).send("Missing token");

  const tokenPath = process.env.NODE_ENV === 'staging'
    ? '/opt/mubhir-staging/data/login_tokens.json'
    : path.resolve(__dirname, 'tests/security/login_tokens.json');

  if (!fs.existsSync(tokenPath)) return res.status(403).send("Invalid or expired token");

  let tokens = [];
  try {
    tokens = JSON.parse(fs.readFileSync(tokenPath, 'utf8'));
  } catch (e) {
    return res.status(500).send("Error reading tokens");
  }

  const tokenRecordIndex = tokens.findIndex(t => t.token === token && t.expiresAt > Date.now());
  if (tokenRecordIndex === -1) {
    return res.status(403).send("Invalid or expired token");
  }

  const tokenRecord = tokens[tokenRecordIndex];

  // Remove token (single-use)
  tokens.splice(tokenRecordIndex, 1);
  try {
    fs.writeFileSync(tokenPath, JSON.stringify(tokens), 'utf8');
  } catch (e) {
    return res.status(500).send("Error updating tokens store");
  }

  const userSession = {
    merchant: {
      id: tokenRecord.merchantId,
      name: tokenRecord.storeName
    },
    tenant_id: tokenRecord.tenantId,
    platform: "salla"
  };

  req.login(userSession, (err) => {
    if (err) return res.status(500).send("Login session error: " + err.message);
    req.session.save((saveErr) => {
      if (saveErr) return res.status(500).send("Session save error: " + saveErr.message);
      res.redirect("/dashboard?welcome=1");
    });
  });
});

// 🔒 Security Hardening: /login/bypass is completely disabled
app.all("/login/bypass", (req, res) => {
  return res.status(403).send("🔒 Access Denied: /login/bypass is permanently disabled.");
});

function validateOAuthState(req, res, next) {
  const { state } = req.query;
  const platform = req.params.platform || 'salla';

  if (!state) {
    console.error("❌ OAuth State Reject: Missing state parameter in callback.");
    return res.status(400).send("Missing state parameter (CSRF Protection)");
  }

  const statesMap = req.session?.oauth_states || {};
  const savedState = statesMap[state];

  if (!savedState) {
    if (platform === 'salla') {
      console.warn("⚠️ [validateOAuthState] State not found in session (direct install from Salla App Store). Proceeding to let Salla passport exchange the code.");
      return next();
    }
    console.error("❌ OAuth State Reject: State not found in session.");
    return res.status(400).send("Invalid or expired state parameter (CSRF Protection)");
  }

  const now = Date.now();
  if (now - savedState.createdAt > 5 * 60 * 1000) {
    delete req.session.oauth_states[state];
    console.error("❌ OAuth State Reject: State has expired.");
    return res.status(400).send("State parameter expired (CSRF Protection)");
  }

  // Single-use claim
  delete req.session.oauth_states[state];

  // Timing-safe check using timingSafeEqual
  const crypto = require('crypto');
  let match = false;
  try {
    const stateBuf = Buffer.from(state, 'utf8');
    match = crypto.timingSafeEqual(stateBuf, Buffer.from(state, 'utf8'));
  } catch (e) {
    match = false;
  }

  if (!match) {
    console.error("❌ OAuth State Reject: Timing-safe match failed.");
    return res.status(400).send("State validation failed");
  }

  next();
}

// ═══════════════════════════════════════════════════════════════════
// 🔒 Feature Flag: Standalone Public Launch Gate (Coming Soon)
// ═══════════════════════════════════════════════════════════════════
const STANDALONE_PUBLIC_ENABLED = process.env.STANDALONE_PUBLIC_ENABLED === 'true'; // Default: false (Coming Soon)

function guardStandalonePublic(req, res, next) {
  if (!STANDALONE_PUBLIC_ENABLED) {
    if (req.method === 'GET') {
      return res.render('auth_standalone.html', {
        user: req.user || null,
        support_whatsapp: process.env.SUPPORT_WHATSAPP_NUMBER || ''
      });
    }
    return res.status(403).json({
      ok: false,
      error: 'التاجر المستقل سيكون متاحاً قريباً'
    });
  }
  next();
}

app.get("/oauth/redirect", passport.authenticate("salla"));
app.get("/login", (req, res) => {
  if (req.isAuthenticated() || (req.user && req.user.merchant && req.user.merchant.id)) {
    return res.redirect('/dashboard');
  }
  if (req.query.platform === 'standalone') {
    return res.redirect('/auth/standalone');
  }
  res.redirect('/auth/salla');
});

app.get(
  "/oauth/callback",
  validateOAuthState,
  passport.authenticate("salla", { failureRedirect: "/login" }),
  function (req, res) {
    res.redirect("/dashboard?welcome=1");
  }
);

// ═══════════════════════════════════════════════════════════
// 🌐 MULTI-PLATFORM OAUTH (Salla + Zid + Shopify + Standalone)
// ═══════════════════════════════════════════════════════════
const PlatformRegistry = require('./services/platforms');
const ConnectService = require('./services/ConnectService');

// GET /auth/salla — صفحة تسجيل ودخول تاجر سلة المخصصة

// ══════════════════════════════════════════════════════════════
// 🎨 AUTH & ONBOARDING UI/UX PREVIEW ROUTES (PREVIEW ONLY)
// ══════════════════════════════════════════════════════════════

// Salla Account Completion Preview
app.get('/auth/salla/complete-account', async (req, res) => {
  const tenant = await getTenantFromReq(req);
  res.render('auth_salla_completion.html', {
    store_name: tenant?.store_name || 'متجر سلة',
    email: tenant?.email || ''
  });
});

app.post('/auth/salla/complete-account', async (req, res) => {
  try {
    const tenant = await getTenantFromReq(req);
    if (!tenant) return res.status(401).json({ ok: false, error: 'يجب تسجيل الدخول أولاً' });
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ ok: false, error: 'البريد الإلكتروني وكلمة المرور مطلوبة' });

    const updates = {
      email: email.trim().toLowerCase(),
      password_hash: ConnectService.hashPassword(password)
    };
    await tenant.update(updates);
    res.json({ ok: true, redirect: '/dashboard' });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.get('/auth/salla/verify-email-preview', (req, res) => {
  res.render('auth_salla_completion.html', { store_name: 'متجر الأناقة — سلة' });
});

// Standalone Email Verification Preview (dev/admin only — NOT used in production customer flow)
app.get('/auth/standalone/verify-email-preview', (req, res) => {
  res.render('auth_verify_email.html', { email: req.query.email || 'you@elegancestore.sa' });
});

// Standalone Email Verification — Real pending page (production customer flow)
app.get('/auth/standalone/verify-email-pending', guardStandalonePublic, (req, res) => {
  const email = req.session?.pendingVerificationEmail || req.query.email || '';
  if (!email) return res.redirect('/auth/standalone');
  res.render('auth_verify_email.html', { email });
});

// POST /auth/standalone/resend-verification — إعادة إرسال رابط التحقق (Backend حقيقي)
app.post('/auth/standalone/resend-verification', guardStandalonePublic, async (req, res) => {
  try {
    const email = req.body.email || req.session?.pendingVerificationEmail;
    const result = await ConnectService.resendVerificationEmail(email);
    res.json(result);
  } catch (e) {
    console.error('[resend-verification error]:', e.message);
    res.json({ ok: true, message: 'إذا كان البريد مسجلاً لدينا، تم إرسال رابط التحقق.' });
  }
});

// Standalone Payment Setup & Trial Activation Preview
app.get('/auth/standalone/payment-setup', (req, res) => {
  res.render('auth_payment_setup.html');
});

app.get('/auth/standalone/trial-activated', (req, res) => {
  res.render('auth_payment_setup.html');
});

// Unified Password Flows Previews
app.get('/auth/forgot-password', (req, res) => {
  res.render('auth_password_flows.html');
});

app.get('/auth/reset-password', (req, res) => {
  res.render('auth_password_flows.html');
});

app.get('/auth/reset-password/success', (req, res) => {
  res.render('auth_password_flows.html');
});

app.get('/auth/reset-password/expired', (req, res) => {
  res.render('auth_password_flows.html');
});

app.get('/auth/salla', (req, res) => {
  if (req.isAuthenticated() || (req.user && req.user.merchant && req.user.merchant.id)) {
    return res.redirect('/dashboard');
  }
  res.render('auth_salla.html', {
    user: req.user || null,
    support_whatsapp: process.env.SUPPORT_WHATSAPP_NUMBER || ''
  });
});

// GET /auth/standalone — صفحة تسجيل ودخول التاجر المستقل المخصصة
app.get('/auth/standalone', (req, res) => {
  if (req.isAuthenticated() || (req.user && req.user.merchant && req.user.merchant.id)) {
    return res.redirect('/dashboard');
  }
  res.render('auth_standalone.html', {
    user: req.user || null,
    support_whatsapp: process.env.SUPPORT_WHATSAPP_NUMBER || ''
  });
});

// GET /connect — توجيه ذكي حسب المنصة أو لقسم اختيار التاجر بالرئيسية
app.get('/connect', (req, res) => {
  if (req.isAuthenticated() || (req.user && req.user.merchant && req.user.merchant.id)) {
    return res.redirect('/dashboard');
  }
  if (req.query.platform === 'standalone') {
    return res.redirect('/auth/standalone');
  }
  if (req.query.platform === 'salla') {
    return res.redirect('/auth/salla');
  }
  res.redirect('/#start');
});

// GET /connect/:platform — يبدأ OAuth flow للمنصة المختارة
app.get('/connect/:platform', (req, res) => {
  try {
    const { platform } = req.params;
    console.log(`[CONNECT DEBUG] Clicked on platform: ${platform} | Session user:`, req.user);
    if (!PlatformRegistry.has(platform)) {
      console.log(`[CONNECT DEBUG] Platform not found: ${platform}`);
      return res.status(404).send('Unknown platform');
    }

    // تعطيل Zid و Shopify مؤقتاً
    if (platform === 'zid' || platform === 'shopify') {
      return res.status(403).send('Zid and Shopify platforms are currently disabled.');
    }

    const adapter = PlatformRegistry.get(platform);

    // Standalone: يفتح صفحة signup مباشرة
    if (platform === 'standalone') {
      return res.render('standalone_signup.html', { activePage: 'connect' });
    }

    const crypto = require('crypto');
    const state = crypto.randomBytes(16).toString('hex');
    req.session = req.session || {};
    req.session.oauth_states = req.session.oauth_states || {};
    req.session.oauth_states[state] = {
      platform,
      createdAt: Date.now()
    };

    // استخدام المتغير السحابي لسلة إن وجد لضمان مطابقة الـ pre-registered redirect urls
    const isLocal = req.get('host').includes('localhost') || req.get('host').includes('127.0.0.1');
    const proto = isLocal ? req.protocol : 'https';
    let redirectUri = `${proto}://${req.get('host')}/oauth/${platform}/callback`;
    if (platform === 'salla' && process.env.SALLA_OAUTH_CLIENT_REDIRECT_URI) {
      redirectUri = process.env.SALLA_OAUTH_CLIENT_REDIRECT_URI;
    }
    const shopDomain = req.query.shop || null; // لـ Shopify
    if (platform === 'shopify') req.session.oauth_shop = shopDomain;

    const authUrl = adapter.getAuthorizationUrl(state, redirectUri, shopDomain);

    // إذا في mock mode، نمر مباشرة على الـ callback (نحاكي رجوع المنصة)
    if (!adapter.isReady) {
      const mockCallback = `/oauth/${platform}/callback`;
      return res.redirect(`${mockCallback}?code=mock_code&state=${state}${shopDomain ? '&shop=' + shopDomain : ''}`);
    }

    res.redirect(authUrl);
  } catch (e) {
    console.error('[connect] error:', e);
    res.status(500).send('Error: ' + e.message);
  }
});

// GET /oauth/:platform/callback — يستقبل code من المنصة
app.get('/oauth/:platform/callback', validateOAuthState, async (req, res) => {
  try {
    const { platform } = req.params;
    const { code, state, shop } = req.query;
    if (!PlatformRegistry.has(platform)) return res.status(404).send('Unknown platform');
    if (platform === 'zid' || platform === 'shopify') {
      return res.status(403).send('Zid and Shopify platforms are currently disabled.');
    }
    if (!code) return res.status(400).send('Missing code');

    // (اختياري) تحقق من الـ state — مهم للأمان لكن نتساهل في mock mode
    // if (req.session?.oauth_state && req.session.oauth_state !== state) return res.status(400).send('Invalid state');

    const adapter = PlatformRegistry.get(platform);
    let redirectUri = `${req.protocol}://${req.get('host')}/oauth/${platform}/callback`;
    if (platform === 'salla' && process.env.SALLA_OAUTH_CLIENT_REDIRECT_URI) {
      redirectUri = process.env.SALLA_OAUTH_CLIENT_REDIRECT_URI;
    }
    const shopDomain = shop || req.session?.oauth_shop || null;

    // 1. استبدل code → access_token + store info
    const tokenData = await adapter.exchangeCodeForToken(code, redirectUri, shopDomain);

    // 2. أنشئ/حدّث Tenant + Subscription trial
    const { tenant, created } = await ConnectService.upsertTenantFromOAuth({ platform, tokenData });

    console.log(`✅ [${platform}] ${created ? 'NEW' : 'EXISTING'} tenant: ${tenant.store_name} (id=${tenant.id})`);

    // 3. اعمل login للجلسة (نضع merchant.id حسب المنصة)
    const userSession = {
      merchant: {
        id: tenant.salla_merchant_id || tenant.platform_store_id,
        name: tenant.store_name
      },
      tenant_id: tenant.id,
      platform
    };

    req.login(userSession, function(err) {
      if (err) {
        console.error('[oauth callback session save error]:', err);
        return res.status(500).send('Login session initialization failed');
      }
      req.session.save(() => {
        res.redirect(`/dashboard?welcome=${created ? '1' : '0'}&platform=${platform}`);
      });
    });
  } catch (e) {
    console.error('[oauth callback] error:', e);
    if (e.message && e.message.includes('disabled')) {
      return res.status(403).send('Zid and Shopify platforms are currently disabled.');
    }
    res.status(500).send('OAuth error: ' + e.message);
  }
});

// POST /connect/standalone — تسجيل مستقل (Thin Controller → ConnectService.registerStandalone)
app.post('/connect/standalone', guardStandalonePublic, async (req, res) => {
  try {
    const { store_name, email, phone, password, owner_name } = req.body;

    // ─── Delegate to single source of truth ───
    const result = await ConnectService.registerStandalone({ store_name, email, phone, password, owner_name });

    if (!result.ok) {
      const status = result.case === 'EXISTING_VERIFIED' ? 409 : 400;
      return res.status(status).json(result);
    }

    // ─── إذا SMTP فشل لا نعرض نجاح وهمي ───
    if (result.verify_email && result.email_sent === false && result.email_error) {
      console.error(`[standalone signup] Email send failed for tenant ${result.tenant_id}: ${result.email_error}`);
      return res.status(500).json({
        ok: false,
        error: 'تم إنشاء الحساب لكن فشل إرسال رابط التحقق. يرجى المحاولة لاحقاً من صفحة إعادة الإرسال.'
      });
    }

    // ─── حفظ البريد في session للاستخدام الآمن ───
    req.session.pendingVerificationEmail = result.email;

    res.json({
      ok: true,
      tenant_id: result.tenant_id,
      created: result.created,
      verify_email: true,
      redirect: '/auth/standalone/verify-email-pending'
    });
  } catch (e) {
    console.error('[standalone signup] error:', e.message);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// POST /auth/salla/login — تسجيل دخول تاجر سلة بالبريد وكلمة المرور
app.post('/auth/salla/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ ok: false, error: 'البريد الإلكتروني وكلمة المرور مطلوبة' });
    }

    const db = SallaDatabase.connection;
    const tenant = await db.models.Tenant.findOne({
      where: { email: email.trim().toLowerCase() }
    });

    if (!tenant || !tenant.password_hash) {
      return res.status(401).json({ ok: false, error: 'بيانات الدخول غير صحيحة' });
    }

    const isValid = ConnectService.verifyPassword(password, tenant.password_hash);
    if (!isValid) {
      return res.status(401).json({ ok: false, error: 'بيانات الدخول غير صحيحة' });
    }

    // 🔒 Platform-Bound Check: Only Salla tenants allowed on Salla auth
    if (tenant.platform !== 'salla') {
      return res.status(403).json({
        ok: false,
        error: 'هذا الحساب مسجل كتاجر مستقل، يرجى تسجيل الدخول من بوابة التجار المستقلين.',
        redirect: '/auth/standalone'
      });
    }

    const userSession = {
      merchant: { id: tenant.salla_merchant_id || tenant.platform_store_id, name: tenant.store_name },
      tenant_id: tenant.id,
      platform: 'salla'
    };

    req.login(userSession, function(err) {
      if (err) return res.status(500).json({ ok: false, error: 'فشل حفظ الجلسة' });
      const redirectTo = req.session?.returnTo || '/dashboard';
      if (req.session?.returnTo) delete req.session.returnTo;
      req.session.save(() => {
        res.json({ ok: true, redirect: redirectTo });
      });
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// POST /auth/salla/forgot-password — طلب استعادة كلمة المرور لتاجر سلة
app.post('/auth/salla/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ ok: false, error: 'البريد الإلكتروني مطلوب' });

    const db = SallaDatabase.connection;
    const tenant = await db.models.Tenant.findOne({
      where: { platform: 'salla', email: email.trim().toLowerCase() }
    });

    if (tenant) {
      const crypto = require('crypto');
      const resetToken = crypto.randomBytes(32).toString('hex');
      const resetExpires = new Date(Date.now() + 60 * 60 * 1000);

      await tenant.update({
        password_reset_token: resetToken,
        password_reset_expires_at: resetExpires
      });

      const EmailService = require('./services/EmailService');
      await EmailService.sendPasswordResetEmail({
        to: tenant.email,
        token: resetToken,
        ownerName: tenant.owner_name || tenant.store_name
      });
    }

    res.json({ ok: true, message: 'إذا كان البريد مسجلاً لدينا، تم إرسال رابط إعادة التعيين.' });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// POST /auth/standalone/login — تسجيل دخول التاجر المستقل بكلمة المرور
app.post('/auth/standalone/login', guardStandalonePublic, async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ ok: false, error: 'البريد الإلكتروني وكلمة المرور مطلوبة' });
    }

    const db = SallaDatabase.connection;
    const tenant = await db.models.Tenant.findOne({
      where: { email: email.trim().toLowerCase() }
    });

    if (!tenant || !tenant.password_hash) {
      return res.status(401).json({ ok: false, error: 'بيانات الدخول غير صحيحة' });
    }

    const isValid = ConnectService.verifyPassword(password, tenant.password_hash);
    if (!isValid) {
      return res.status(401).json({ ok: false, error: 'بيانات الدخول غير صحيحة' });
    }

    // 🔒 Platform-Bound Check: Only Standalone tenants allowed on Standalone auth
    if (tenant.platform !== 'standalone') {
      return res.status(403).json({
        ok: false,
        error: 'هذا الحساب مسجل كتاجر سلة، يرجى تسجيل الدخول من بوابة تجار سلة.',
        redirect: '/auth/salla'
      });
    }

    const userSession = {
      merchant: { id: tenant.platform_store_id || tenant.salla_merchant_id || null, name: tenant.store_name },
      tenant_id: tenant.id,
      platform: 'standalone'
    };

    req.login(userSession, function(err) {
      if (err) return res.status(500).json({ ok: false, error: 'فشل حفظ الجلسة' });
      const redirectTo = req.session?.returnTo || '/standalone/dashboard';
      if (req.session?.returnTo) delete req.session.returnTo;
      req.session.save(() => {
        res.json({ ok: true, redirect: redirectTo });
      });
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// GET /auth/standalone/verify-email — تأكيد رابط البريد الإلكتروني
app.get('/auth/standalone/verify-email', async (req, res) => {
  try {
    const { token } = req.query;
    if (!token) return res.status(400).send('رمز التأكيد غير موجود');

    const db = SallaDatabase.connection;
    const tenant = await db.models.Tenant.findOne({
      where: { email_verification_token: token }
    });

    if (!tenant) return res.status(400).send('رمز التأكيد غير صالحة أو تم استخدامه من قبل');

    if (tenant.email_verification_expires_at && new Date(tenant.email_verification_expires_at) < new Date()) {
      return res.status(400).send('رابط التأكيد منتهي الصلاحية');
    }

    await tenant.update({
      is_email_verified: true,
      email_verified_at: new Date(),
      email_verification_token: null
    });

    res.send('<html><body style="font-family:sans-serif;text-align:center;padding:50px;" dir="rtl"><h2>✅ تم تأكيد البريد الإلكتروني بنجاح!</h2><p><a href="/login">اضغط هنا لتسجيل الدخول</a></p></body></html>');
  } catch (e) {
    res.status(500).send('فشل تأكيد البريد الإلكتروني: ' + e.message);
  }
});

// POST /auth/standalone/forgot-password — طلب إعادة تعيين كلمة المرور
app.post('/auth/standalone/forgot-password', guardStandalonePublic, async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ ok: false, error: 'البريد الإلكتروني مطلوب' });

    const db = SallaDatabase.connection;
    const tenant = await db.models.Tenant.findOne({
      where: { email: email.trim().toLowerCase() }
    });

    if (tenant) {
      const crypto = require('crypto');
      const resetToken = crypto.randomBytes(32).toString('hex');
      const resetExpires = new Date(Date.now() + 60 * 60 * 1000);

      await tenant.update({
        password_reset_token: resetToken,
        password_reset_expires_at: resetExpires
      });

      const EmailService = require('./services/EmailService');
      await EmailService.sendPasswordResetEmail({
        to: tenant.email,
        token: resetToken,
        ownerName: tenant.owner_name || tenant.store_name
      });
    }

    res.json({ ok: true, message: 'إذا كان البريد مسجلاً لدينا، تم إرسال رابط إعادة التعيين.' });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// GET /auth/standalone/reset-password — عرض صفحة إعادة تعيين كلمة المرور
app.get('/auth/standalone/reset-password', async (req, res) => {
  try {
    const { token } = req.query;
    if (!token) return res.status(400).send('<html><body style="font-family:sans-serif;text-align:center;padding:50px;" dir="rtl"><h2>⚠️ رابط غير صالح</h2><p>رمز إعادة تعيين كلمة المرور غير موجود.</p></body></html>');

    const db = SallaDatabase.connection;
    const tenant = await db.models.Tenant.findOne({
      where: { password_reset_token: token }
    });

    if (!tenant) {
      return res.status(400).send('<html><body style="font-family:sans-serif;text-align:center;padding:50px;" dir="rtl"><h2>⚠️ رابط غير صالح</h2><p>رمز إعادة التعيين غير صالح أو تم استخدامه من قبل.</p></body></html>');
    }

    if (tenant.password_reset_expires_at && new Date(tenant.password_reset_expires_at) < new Date()) {
      return res.status(400).send('<html><body style="font-family:sans-serif;text-align:center;padding:50px;" dir="rtl"><h2>⏳ رابط منتهي الصلاحية</h2><p>انتهت صلاحية رابط إعادة تعيين كلمة المرور (صالح لمدة ساعة واحدة فقط).</p></body></html>');
    }

    res.send(`
      <!DOCTYPE html>
      <html lang="ar" dir="rtl">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>إعادة تعيين كلمة المرور — مبهر AI</title>
        <style>
          body { font-family: 'Cairo', Arial, sans-serif; background-color: #f8fafc; margin: 0; padding: 40px 16px; color: #0f172a; }
          .card { max-width: 440px; margin: 0 auto; background: #ffffff; border: 1px solid #e2e8f0; border-radius: 16px; padding: 32px; box-shadow: 0 4px 12px rgba(15,23,42,0.05); }
          .logo { text-align: center; font-size: 24px; font-weight: 900; color: #0f172a; margin-bottom: 24px; }
          .logo span { color: #0d9488; }
          h2 { font-size: 20px; font-weight: 800; margin-bottom: 8px; text-align: center; }
          p { font-size: 14px; color: #64748b; margin-bottom: 24px; text-align: center; }
          .form-group { margin-bottom: 20px; text-align: right; }
          label { display: block; font-size: 13px; font-weight: 700; margin-bottom: 8px; color: #334155; }
          input { width: 100%; padding: 12px 14px; font-size: 14px; border: 1px solid #cbd5e1; border-radius: 10px; box-sizing: border-box; outline: none; }
          input:focus { border-color: #0d9488; }
          button { width: 100%; padding: 14px; font-size: 16px; font-weight: bold; color: #ffffff; background: linear-gradient(135deg,#0d9488,#14b8a6); border: none; border-radius: 12px; cursor: pointer; margin-top: 10px; }
          button:disabled { opacity: 0.6; cursor: not-allowed; }
          .alert { padding: 12px 16px; border-radius: 10px; font-size: 13px; margin-bottom: 16px; display: none; }
          .alert-error { background: #fef2f2; border: 1px solid #fecaca; color: #dc2626; }
          .alert-success { background: #f0fdf4; border: 1px solid #bbf7d0; color: #166534; }
        </style>
      </head>
      <body>
        <div class="card">
          <div class="logo">مبهر <span>AI</span></div>
          <h2>إعادة تعيين كلمة المرور</h2>
          <p>أدخل كلمة المرور الجديدة لحسابك لـ <strong>${tenant.store_name || tenant.owner_name || ''}</strong></p>

          <div id="alertBox" class="alert"></div>

          <form id="resetForm" onsubmit="handleReset(event)">
            <input type="hidden" id="resetToken" value="${token}">
            
            <div class="form-group">
              <label>كلمة المرور الجديدة (8 أحرف على الأقل)</label>
              <input type="password" id="newPassword" required minlength="8" placeholder="••••••••">
            </div>

            <div class="form-group">
              <label>تأكيد كلمة المرور الجديدة</label>
              <input type="password" id="confirmPassword" required minlength="8" placeholder="••••••••">
            </div>

            <button type="submit" id="submitBtn">تحديث كلمة المرور</button>
          </form>
        </div>

        <script>
          async function handleReset(e) {
            e.preventDefault();
            const token = document.getElementById('resetToken').value;
            const newPassword = document.getElementById('newPassword').value;
            const confirmPassword = document.getElementById('confirmPassword').value;
            const alertBox = document.getElementById('alertBox');
            const submitBtn = document.getElementById('submitBtn');

            alertBox.style.display = 'none';

            if (newPassword !== confirmPassword) {
              alertBox.className = 'alert alert-error';
              alertBox.innerText = 'كلمتا المرور غير متطابقتين';
              alertBox.style.display = 'block';
              return;
            }

            submitBtn.disabled = true;
            submitBtn.innerText = 'جاري التحديث...';

            try {
              const res = await fetch('/auth/standalone/reset-password', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ token, new_password: newPassword })
              });

              const data = await res.json();
              if (res.ok && data.ok) {
                alertBox.className = 'alert alert-success';
                alertBox.innerText = '✅ تم تحديث كلمة المرور بنجاح! جاري توجيهك لصفحة الدخول...';
                alertBox.style.display = 'block';
                setTimeout(() => { window.location.href = '/login'; }, 2000);
              } else {
                alertBox.className = 'alert alert-error';
                alertBox.innerText = data.error || 'حدث خطأ أثناء التحديث';
                alertBox.style.display = 'block';
                submitBtn.disabled = false;
                submitBtn.innerText = 'تحديث كلمة المرور';
              }
            } catch (err) {
              alertBox.className = 'alert alert-error';
              alertBox.innerText = 'تعذر الاتصال بالسيرفر';
              alertBox.style.display = 'block';
              submitBtn.disabled = false;
              submitBtn.innerText = 'تحديث كلمة المرور';
            }
          }
        </script>
      </body>
      </html>
    `);
  } catch (e) {
    res.status(500).send('فشل عرض صفحة إعادة التعيين: ' + e.message);
  }
});

// POST /auth/standalone/reset-password — تطبيق كلمة المرور الجديدة
app.post('/auth/standalone/reset-password', guardStandalonePublic, async (req, res) => {
  try {
    const { token, new_password } = req.body;
    if (!token || !new_password || new_password.length < 8) {
      return res.status(400).json({ ok: false, error: 'كلمة المرور يجب أن تكون 8 أحرف على الأقل' });
    }

    const db = SallaDatabase.connection;
    const tenant = await db.models.Tenant.findOne({
      where: { password_reset_token: token }
    });

    if (!tenant) return res.status(400).json({ ok: false, error: 'رمز التعيين غير صالحة' });

    if (tenant.password_reset_expires_at && new Date(tenant.password_reset_expires_at) < new Date()) {
      return res.status(400).json({ ok: false, error: 'رمز التعيين منتهي الصلاحية' });
    }

    await tenant.update({
      password_hash: ConnectService.hashPassword(new_password),
      password_reset_token: null,
      password_reset_expires_at: null
    });

    res.json({ ok: true, message: 'تم تحديث كلمة المرور بنجاح. يمكنك الآن الدخول.' });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.get("/", async function (req, res) {
  const host = (req.headers.host || '').toLowerCase();
  if (host.startsWith('app.')) {
    if (req.user) {
      return res.redirect('/dashboard');
    } else {
      return res.redirect('/admin/login');
    }
  }

  let userDetails = {
    user: req.user,
    isLogin: req.user,
    support_whatsapp: process.env.SUPPORT_WHATSAPP_NUMBER || ''
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
    support_whatsapp: process.env.SUPPORT_WHATSAPP_NUMBER || ''
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

app.get("/orders", ensureAuthenticated, function (req, res) {
  return res.redirect("/automation/orders");
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

app.get("/admin/logout", function (req, res) {
  if (req.session) {
    req.session.destroy(function (err) {
      res.redirect("/admin/login");
    });
  } else {
    res.redirect("/admin/login");
  }
});

function ensureAuthenticated(req, res, next) {
  // Admin routes are handled by requireAdmin
  if (req.originalUrl.startsWith('/admin')) {
    return next();
  }
  console.log(`\n=================== [RUNTIME AUTH DEBUG] ===================`);
  console.log(`- Source Route: ${req.originalUrl}`);
  console.log(`- Session Tenant (req.user):`, req.user);
  if (req.isAuthenticated() || (req.user && (req.user.tenant_id || req.user.merchant?.id))) {
    console.log(`- Access Result: GRANTED`);
    console.log(`============================================================\n`);
    return next();
  }
  console.log(`- Access Result: DENIED`);
  console.log(`- Fallback Reason: No authenticated session found`);
  if (req.originalUrl.startsWith('/api/')) {
    console.log(`- Action: Returning 401 Unauthorized for API route`);
    console.log(`============================================================\n`);
    return res.status(401).json({ ok: false, error: 'Authentication required' });
  }

  // Standalone requests store returnTo and redirect to standalone login page
  if (req.originalUrl.startsWith('/standalone')) {
    req.session = req.session || {};
    req.session.returnTo = req.originalUrl;
    console.log(`- Action: Standalone route detected. Redirecting to /auth/standalone`);
    console.log(`============================================================\n`);
    return res.redirect('/auth/standalone');
  }

  console.log(`- Action: Redirecting to /auth/salla`);
  console.log(`============================================================\n`);
  res.redirect('/auth/salla');
}

async function ensureStandaloneAuthenticated(req, res, next) {
  if (req.originalUrl.startsWith('/admin/login') || req.originalUrl.startsWith('/admin/logout')) {
    return next();
  }

  if (req.isAuthenticated() || (req.user && (req.user.tenant_id || req.user.merchant?.id))) {
    const tenant = await getTenantFromReq(req);
    if (tenant) {
      if (tenant.platform === 'standalone') {
        req.tenant = tenant;
        return next();
      }
      // Salla merchant attempting to access Standalone route
      console.log(`[PlatformGuard] Salla merchant tried accessing Standalone route ${req.originalUrl}. Redirecting to /dashboard.`);
      return res.redirect('/dashboard');
    }
  }

  req.session = req.session || {};
  req.session.returnTo = req.originalUrl;
  return res.redirect('/auth/standalone');
}

// 🌐 STANDALONE NAMESPACE ROUTES
app.get('/standalone/dashboard', ensureStandaloneAuthenticated, async (req, res) => {
  try {
    const tenant = req.tenant;
    const db = SallaDatabase.connection;
    const waWebMod = require('./services/waWeb');
    const isConnected = !!(tenant?.WhatsAppConfig?.access_token) || (tenant ? waWebMod.isReady(tenant.id) : false);
    const subscription = tenant?.Subscription;
    const plan = subscription?.Plan;
    const subStatus = subscription?.status || 'no_subscription';

    const hasAccess = subscription && (subStatus === 'active' || subStatus === 'trial');
    const planName = plan?.name || (subStatus === 'expired' ? 'اشتراك منتهي' : (subStatus === 'no_subscription' ? 'لا يوجد اشتراك' : 'الأساسية'));
    const msgLimit = hasAccess ? (plan?.msg_limit_monthly || 1000) : 0;
    const priceMonthly = plan?.price_monthly || 0;
    const priceYearly = plan?.price_yearly || 0;
    const isYearly = subscription?.is_yearly || false;
    const subEndDate = subscription?.end_date;

    let daysLeft = null;
    if (subEndDate) {
      const diff = new Date(subEndDate) - new Date();
      daysLeft = Math.max(0, Math.ceil(diff / (1000 * 60 * 60 * 24)));
    }

    let messagesSent = 0;
    let aiRequests = 0;
    let growthPercent = 0;

    if (tenant && tenant.id) {
      const currentPeriod = new Date().toISOString().slice(0, 7);
      const currentUsage = await db.models.UsageCounter.findOne({
        where: { tenant_id: tenant.id, period_key: currentPeriod }
      });
      messagesSent = currentUsage?.messages_sent || 0;
      aiRequests = currentUsage?.ai_requests || 0;
    }

    const usagePercent = msgLimit > 0 ? Math.min(Math.round((messagesSent / msgLimit) * 100), 100) : 0;
    const messagesRemaining = msgLimit > 0 ? Math.max(msgLimit - messagesSent, 0) : '∞';
    const storeName = tenant?.store_name || 'متجرك';

    res.render('standalone_dashboard.html', {
      tenant, user: req.user, activePage: 'dashboard', isConnected,
      plan_name: planName, plan_price: isYearly ? priceYearly : priceMonthly,
      sub_status: subStatus, days_left: daysLeft,
      messages_sent: messagesSent, msg_limit: msgLimit,
      messages_remaining: messagesRemaining, usage_percent: usagePercent,
      ai_replies: aiRequests, ai_growth: growthPercent.toFixed(1),
      store_name: storeName
    });
  } catch (e) {
    console.error('Standalone Dashboard Error:', e);
    res.status(500).send('Standalone Dashboard Error: ' + e.message);
  }
});

app.get('/standalone/billing', ensureStandaloneAuthenticated, async (req, res) => {
  const tenant = req.tenant;
  const subscription = tenant?.Subscription;
  const plan = subscription?.Plan;
  res.render('billing.html', {
    tenant,
    user: req.user,
    activePage: 'billing',
    subscription,
    plan,
    store_name: tenant?.store_name || 'متجرك'
  });
});

app.get('/standalone/whatsapp-web', ensureStandaloneAuthenticated, async (req, res) => {
  const tenant = req.tenant;
  const userToRender = {
    ...req.user,
    tenant_id: tenant.id,
    store_name: tenant.store_name,
    merchant: {
      ...(req.user?.merchant || {}),
      name: tenant.store_name
    }
  };
  res.render('whatsapp_web.html', {
    user: userToRender,
    activePage: 'wa_web',
    store_name: tenant.store_name,
    tenant_id: tenant.id
  });
});

async function getTenantFromReq(req) {
  const db = SallaDatabase.connection;
  if (!db || !db.models?.Tenant) return null;

  const tenantId = req.user?.tenant_id || req.session?.tenantId;
  if (tenantId) {
    const tenant = await db.models.Tenant.findByPk(tenantId, {
      include: [{ model: db.models.Subscription, include: [db.models.Plan], required: false }]
    });
    if (tenant) return tenant;
  }

  if (req.user?.merchant?.id) {
    const tenant = await db.models.Tenant.findOne({
      where: { salla_merchant_id: req.user.merchant.id },
      include: [{ model: db.models.Subscription, include: [db.models.Plan], required: false }]
    });
    if (tenant) return tenant;
  }

  return null;
}

async function ensureSubscriptionActive(req, res, next) {
  try {
    const db = SallaDatabase.connection;
    if (!db) return next();

    const tenantId = req.user?.tenant_id || req.session?.tenantId;
    let tenant = null;

    if (tenantId) {
      tenant = await db.models.Tenant.findByPk(tenantId, {
        include: [{ model: db.models.Subscription }]
      });
    } else if (req.user?.merchant?.id) {
      tenant = await db.models.Tenant.findOne({
        where: { salla_merchant_id: req.user.merchant.id },
        include: [{ model: db.models.Subscription }]
      });
    }

    if (!tenant) return next();

    if (!tenant.Subscription) {
      if (req.xhr || req.headers.accept?.includes('json') || req.originalUrl.startsWith('/api')) {
        return res.status(403).json({
          error: 'no_subscription',
          message: 'يرجى الاشتراك في إحدى الباقات لتفعيل حسابك.'
        });
      }
      return res.redirect('/pricing?error=subscription_required');
    }

    let subStatus = tenant.Subscription.status;
    const subEndDate = tenant.Subscription.end_date;

    // Automatically expire if historical end date has passed
    if ((subStatus === 'trial' || subStatus === 'active') && subEndDate && new Date(subEndDate) < new Date()) {
      await tenant.Subscription.update({ status: 'expired' });
      subStatus = 'expired';
    }

    if (subStatus === 'expired') {
      if (req.xhr || req.headers.accept?.includes('json') || req.originalUrl.startsWith('/api')) {
        return res.status(403).json({
          error: 'subscription_expired',
          message: 'انتهت صلاحية اشتراكك. يرجى الترقية أو تجديد الاشتراك للمتابعة.'
        });
      }
      return res.redirect('/pricing?error=subscription_expired');
    }

    next();
  } catch (e) {
    console.error('[ensureSubscriptionActive] error:', e);
    next();
  }
}

function isAdminSession(req) {
    if (!req) return false;
    if (req.session && (req.session.isAdmin || req.session.role === 'admin' || req.session.role === 'super_admin')) {
        return true;
    }
    const role = req.session?.user?.role || req.session?.role || req.user?.role;
    if (role === 'admin' || role === 'super_admin') return true;
    if (req.user && req.user.platform === 'admin') return true;
    return false;
}

async function requireAdmin(req, res, next) {
  // Skip for admin login/logout routes (handled by dedicated handlers above)
  if (req.originalUrl.startsWith('/admin/login') || req.originalUrl.startsWith('/admin/logout')) {
    return next();
  }

  // 1. Unified Admin Session Check (Super Admin / Admin)
  if (isAdminSession(req)) {
    return next();
  }

  // 2. Unauthenticated Check
  if (!req.isAuthenticated() && !(req.user && req.user.merchant && req.user.merchant.id)) {
    if (req.xhr || req.headers.accept?.includes('json') || req.originalUrl.startsWith('/api') || req.method === 'POST') {
      return res.status(401).json({ ok: false, error: 'Unauthorized: Admin privileges required' });
    }
    return res.redirect('/admin/login');
  }

  try {
    const merchantId = req.user?.merchant?.id ? String(req.user.merchant.id) : null;
    const adminEmails = process.env.ADMIN_EMAILS
      ? process.env.ADMIN_EMAILS.split(',').map(e => e.trim().toLowerCase())
      : [];
    const adminMerchantIds = process.env.ADMIN_MERCHANT_IDS
      ? process.env.ADMIN_MERCHANT_IDS.split(',').map(id => id.trim())
      : [];

    // 3. Check Merchant ID against adminMerchantIds
    if (merchantId && adminMerchantIds.includes(merchantId)) {
      return next();
    }

    // 4. Check Email against adminEmails
    let email = (req.user?.merchant?.email || req.user?.email || '').toLowerCase().trim();
    if (!email && merchantId) {
      const db = SallaDatabase.connection;
      if (db && db.models?.Tenant) {
        const tenant = await db.models.Tenant.findOne({
          where: {
            [require('sequelize').Op.or]: [
              { salla_merchant_id: merchantId },
              { platform_store_id: merchantId }
            ]
          }
        });
        if (tenant && tenant.email) {
          email = tenant.email.toLowerCase().trim();
        }
      }
    }

    if (email && adminEmails.includes(email)) {
      return next();
    }

    console.warn(`[SECURITY] Unauthorized admin access attempt: ${req.originalUrl}`);

    if (req.xhr || req.headers.accept?.includes('json') || req.originalUrl.startsWith('/api') || req.method === 'POST') {
      return res.status(403).json({ ok: false, error: 'Access Denied: Admin privileges required' });
    }
    return res.redirect('/dashboard?error=admin_only');
  } catch (err) {
    console.error("Error in requireAdmin middleware:", err);
    return res.status(500).send("Internal Server Error");
  }
}

const http = require('http');
const { Server } = require("socket.io");
const server = http.createServer(app);
const io = new Server(server);

// ---------------------------------------------------------
// CUSTOMERS ROUTE (Active WhatsApp Users) - MOVED TO TOP
// ---------------------------------------------------------
// (Route handler removed to avoid duplication)

// ---------------------------------------------------------
// NEW ADMIN DASHBOARD (Duplicated inline routes removed to use routes/admin.js)
// ---------------------------------------------------------

// Admin Logs (Tenant View)
app.get("/logs", async (req, res) => {
  try {
    const db = SallaDatabase.connection;
    const tenantId = req.user?.tenant_id || req.session?.tenantId;
    let tenant = null;
    if (tenantId) {
      tenant = await db.models.Tenant.findByPk(tenantId, {
        include: [{ model: db.models.Subscription, include: [db.models.Plan] }]
      });
    } else if (req.user?.merchant?.id) {
      tenant = await db.models.Tenant.findOne({
        where: {
          [require('sequelize').Op.or]: [
            { salla_merchant_id: req.user.merchant.id },
            { platform_store_id: req.user.merchant.id }
          ]
        },
        include: [{ model: db.models.Subscription, include: [db.models.Plan] }]
      });
    }

    const plan = tenant?.Subscription?.Plan;

    // Query active threads (last 20 unique conversations)
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
      LIMIT 20;
    `;
    const threads = await db.query(threadsQuery, {
      replacements: { tenantId: tenant?.id || 0 },
      type: require('sequelize').QueryTypes.SELECT
    });

    const HandoffService = require('./services/HandoffService');
    const pausedChats = await HandoffService.listPausedChats(tenant?.id || 0);

    res.render("logs.html", {
      page: 'logs',
      threads: threads,
      user: req.user,
      activePage: 'logs',
      plan_name: plan?.name || 'الأساسية',
      paused_chats: pausedChats
    });
  } catch (e) {
    res.status(500).send("Error loading logs: " + e.message);
  }
});

// 📤 تصدير سجل الرسائل CSV
app.get("/logs/export", async (req, res) => {
  try {
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
app.get("/settings/whatsapp", require('./services/planGate').requireFeaturePage('whatsapp_api'), async (req, res) => {
  try {
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
app.post("/settings/whatsapp", require('./services/planGate').requireFeature('whatsapp_api'), async (req, res) => {
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

    const tenantId = req.user?.tenant_id || req.session?.tenantId;
    let tenant = null;
    if (tenantId) {
      tenant = await db.models.Tenant.findByPk(tenantId, {
        include: [{ model: db.models.Subscription, include: [db.models.Plan] }]
      });
    } else if (req.user?.merchant?.id) {
      tenant = await db.models.Tenant.findOne({
        where: {
          [require('sequelize').Op.or]: [
            { salla_merchant_id: req.user.merchant.id },
            { platform_store_id: req.user.merchant.id }
          ]
        },
        include: [{ model: db.models.Subscription, include: [db.models.Plan] }]
      });
    }

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
app.get("/dev/switch-plan/:plan", devOnly, async (req, res) => {
  if (process.env.NODE_ENV !== 'development') {
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

// POST /billing/checkout — يوجّه التاجر إلى صفحة التطبيق في متجر سلة لاختيار الباقة والترقية
app.post('/billing/checkout', async (req, res) => {
  try {
    if (!req.user) req.user = { merchant: { id: 123456789, name: 'Demo Merchant' } };
    const { plan_name } = req.body; // plan_name still parsed, but we redirect to Salla App Store generally

    const db = SallaDatabase.connection;
    const tenantId = req.user?.tenant_id || req.session?.tenantId;
    let tenant = null;
    if (tenantId) {
      tenant = await db.models.Tenant.findByPk(tenantId, {
        include: [{ model: db.models.Subscription, include: [db.models.Plan] }]
      });
    } else if (req.user?.merchant?.id) {
      tenant = await db.models.Tenant.findOne({
        where: {
          [require('sequelize').Op.or]: [
            { salla_merchant_id: req.user.merchant.id },
            { platform_store_id: req.user.merchant.id }
          ]
        },
        include: [{ model: db.models.Subscription, include: [db.models.Plan] }]
      });
    }
    if (!tenant) return res.status(404).json({ ok: false, error: 'Tenant not found' });

    if (tenant.platform === 'standalone') {
      if (!process.env.TAP_SECRET_KEY) {
        return res.status(400).json({ ok: false, error: 'بوابة الدفع غير مفعّلة حالياً لهذا الحساب. يرجى التواصل مع الدعم الفني.' });
      }
      const plan = await db.models.Plan.findOne({ where: { name: plan_name } });
      if (!plan) return res.status(404).json({ ok: false, error: 'Plan not found' });

      const billingPeriod = req.body.billing_period || 'monthly';
      const baseUrl = `${req.protocol}://${req.get('host')}`;

      // Call initiateTapCheckout
      const checkoutResult = await BillingService.initiateTapCheckout({
        tenantId: tenant.id,
        planId: plan.id,
        billingPeriod,
        baseUrl
      });

      return res.json({ ok: true, checkoutUrl: checkoutResult.checkoutUrl, mock: checkoutResult.mock });
    }

    const checkoutUrl = process.env.SALLA_APP_UPGRADE_URL || 'https://s.salla.sa/apps';

    console.log(`💳 Redirecting tenant ${tenant.id} to Salla App Store to upgrade to ${plan_name || 'selected plan'}`);
    res.json({ ok: true, checkoutUrl });
  } catch (e) {
    console.error('Checkout redirect error:', e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// GET /billing/return — الصفحة اللي يرجع لها العميل بعد الدفع (تتحقق من النتيجة)
app.get('/billing/return', async (req, res) => {
  try {
    if (!req.user) req.user = { merchant: { id: 123456789, name: 'Demo Merchant' } };
    const { tap_id, status, mock } = req.query;
    if (!tap_id) return res.redirect('/billing?status=error&reason=missing_id');

    // تحقق من Tap (أو نقبل mock مباشرة في بيئة التطوير فقط)
    let chargeStatus = status;
    const isProduction = process.env.NODE_ENV === 'production';

    if (isProduction || !mock) {
      const charge = await TapService.retrieveCharge(tap_id);
      if (isProduction && (charge.mock || String(tap_id).startsWith('chg_mock'))) {
        console.warn(`⚠️ [SECURITY] Blocked mock payment attempt in production: ${tap_id}`);
        return res.redirect('/billing?status=error&reason=mock_payment_blocked');
      }
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
    const tenantId = req.user?.tenant_id || req.session?.tenantId;
    let tenant = null;
    if (tenantId) {
      tenant = await db.models.Tenant.findByPk(tenantId, {
        include: [{ model: db.models.Subscription, include: [db.models.Plan] }]
      });
    } else if (req.user?.merchant?.id) {
      tenant = await db.models.Tenant.findOne({
        where: {
          [require('sequelize').Op.or]: [
            { salla_merchant_id: req.user.merchant.id },
            { platform_store_id: req.user.merchant.id }
          ]
        },
        include: [{ model: db.models.Subscription, include: [db.models.Plan] }]
      });
    }

    const payments = (tenant && tenant.id) ? await db.models.Payment.findAll({
      where: { tenant_id: tenant.id },
      include: [db.models.Plan],
      order: [['created_at', 'DESC']],
      limit: 50
    }) : [];

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
// PRICING / BILLING PAGE
// ---------------------------------------------------------
app.get(["/pricing", "/billing"], async (req, res) => {
  try {
    const db = SallaDatabase.connection;
    const tenantId = req.user?.tenant_id || req.session?.tenantId;
    let tenant = null;

    if (tenantId) {
      tenant = await db.models.Tenant.findByPk(tenantId, {
        include: [{ model: db.models.Subscription, include: [db.models.Plan] }]
      });
    } else if (req.user?.merchant?.id) {
      tenant = await db.models.Tenant.findOne({
        where: { salla_merchant_id: req.user.merchant.id },
        include: [{ model: db.models.Subscription, include: [db.models.Plan] }]
      });
    }

    const subscription = tenant?.Subscription;
    const plan = subscription?.Plan;
    const planName = plan?.name || 'الأساسية';
    const msgLimit = plan?.msg_limit_monthly || 1000;
    const subStatus = subscription?.status || null;
    const subEndDate = subscription?.end_date;

    // Usage safely guarded against undefined tenant_id
    let messagesSent = 0;
    if (tenant && tenant.id) {
      const currentPeriod = new Date().toISOString().slice(0, 7);
      const currentUsage = await db.models.UsageCounter.findOne({
        where: { tenant_id: tenant.id, period_key: currentPeriod }
      });
      messagesSent = currentUsage?.messages_sent || 0;
    }

    const userToRender = req.user ? {
      ...req.user,
      tenant_id: tenant?.id,
      store_name: tenant?.store_name || (req.user?.merchant?.name || 'المتجر'),
      merchant: {
        ...(req.user?.merchant || {}),
        name: tenant?.store_name || (req.user?.merchant?.name || 'المتجر')
      }
    } : null;

    res.render("pricing.html", {
      user: userToRender,
      activePage: 'pricing',
      current_plan: planName,
      plan_name: planName,
      sub_status: subStatus,
      msg_limit: msgLimit,
      messages_sent: messagesSent,
      trial_days_left: (subscription?.status === 'trial' && subStatus === 'trial' && subEndDate)
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
// CLIENT DASHBOARD (Duplicated inline route removed to use routes/dashboard.js)
// ---------------------------------------------------------
// Automation: Abandoned Carts
app.get("/automation/carts", require('./services/planGate').requirePage('automation_carts'), async (req, res) => {
  try {
    const db = SallaDatabase.connection;
    const tenant = await getTenantFromReq(req);

    const plan = tenant?.Subscription?.Plan;
    const automationEnabled = true;

    // Fetch Carts safely guarded
    let carts = [];
    if (tenant && tenant.id && db.models.Cart) {
      carts = await db.models.Cart.findAll({
        where: { tenant_id: tenant.id },
        include: ['Customer'],
        order: [['created_at', 'DESC']]
      });
    }

    const totalAbandoned = carts.length;
    const totalRecovered = carts.filter(c => c.status === 'recovered').length;
    const potentialRevenue = carts.reduce((n, { total_amount }) => n + (parseFloat(total_amount) || 0), 0);
    const recoveredRevenue = carts.filter(c => c.status === 'recovered').reduce((n, { total_amount }) => n + (parseFloat(total_amount) || 0), 0);

    const userToRender = req.user ? {
      ...req.user,
      tenant_id: tenant?.id,
      store_name: tenant?.store_name || (req.user?.merchant?.name || 'المتجر'),
      merchant: {
        ...(req.user?.merchant || {}),
        name: tenant?.store_name || (req.user?.merchant?.name || 'المتجر')
      }
    } : null;

    res.render("automation/carts.html", {
      user: userToRender,
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
    const db = SallaDatabase.connection;
    const tenant = await getTenantFromReq(req);

    const plan = tenant?.Subscription?.Plan;
    const automationEnabled = true;

    let orderMessages = [];
    if (tenant && tenant.id && db.models.MessageLog) {
      const messages = await db.models.MessageLog.findAll({
        where: {
          tenant_id: tenant.id,
          direction: 'out'
        },
        order: [['created_at', 'DESC']],
        limit: 50
      });
      orderMessages = messages.filter(m => {
        const content = m.content || "";
        const meta = m.metadata || {};
        return (meta.type === 'review_request') || (content.includes('شكراً لتسوقك')) || (content.includes('تقييم'));
      });
    }

    const userToRender = req.user ? {
      ...req.user,
      tenant_id: tenant?.id,
      store_name: tenant?.store_name || (req.user?.merchant?.name || 'المتجر'),
      merchant: {
        ...(req.user?.merchant || {}),
        name: tenant?.store_name || (req.user?.merchant?.name || 'المتجر')
      }
    } : null;

    res.render("automation/orders.html", {
      user: userToRender,
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
    const db = SallaDatabase.connection;
    const tenant = await getTenantFromReq(req);

    // Plan data
    const subscription = tenant?.Subscription;
    const plan = subscription?.Plan;
    const planName = plan?.name || 'الأساسية';
    const planFeatures = plan?.features || {};
    const msgLimit = plan?.msg_limit_monthly || 1000;
    const campaignsEnabled = planFeatures.campaigns || false;

    // Usage & campaigns data safely guarded
    let messagesSent = 0;
    let campaigns = [];
    let contactsCount = 0;

    if (tenant && tenant.id) {
      const currentPeriod = new Date().toISOString().slice(0, 7);
      const currentUsage = await db.models.UsageCounter.findOne({
        where: { tenant_id: tenant.id, period_key: currentPeriod }
      });
      messagesSent = currentUsage?.messages_sent || 0;

      if (db.models.Campaign) {
        campaigns = await db.models.Campaign.findAll({
          where: { tenant_id: tenant.id },
          order: [['created_at', 'DESC']]
        });
      }

      if (db.models.Customer) {
        contactsCount = await db.models.Customer.count({ where: { tenant_id: tenant.id } });
      }
    }

    const messagesRemaining = msgLimit > 0 ? Math.max(msgLimit - messagesSent, 0) : -1; // -1 = unlimited
    const totalSent = campaigns.reduce((sum, c) => sum + (c.stats_sent || 0), 0);
    const totalCampaigns = campaigns.length;

    const userToRender = req.user ? {
      ...req.user,
      tenant_id: tenant?.id,
      store_name: tenant?.store_name || (req.user?.merchant?.name || 'المتجر'),
      merchant: {
        ...(req.user?.merchant || {}),
        name: tenant?.store_name || (req.user?.merchant?.name || 'المتجر')
      }
    } : null;

    res.render("campaigns.html", {
      user: userToRender,
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
    const db = SallaDatabase.connection;
    const tenant = await getTenantFromReq(req);

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
    // API "متصل" يعني توكن حقيقي (مو mock_access_token)
    const apiReady = !useWaWeb && metaConfig && metaConfig.access_token && metaConfig.access_token !== 'mock_access_token';
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

    const tenantId = req.user?.tenant_id || req.session?.tenantId;
    let tenant = null;
    if (tenantId) {
      tenant = await db.models.Tenant.findByPk(tenantId, {
        include: [{ model: db.models.Subscription, include: [db.models.Plan] }]
      });
    } else if (req.user?.merchant?.id) {
      tenant = await db.models.Tenant.findOne({
        where: {
          [require('sequelize').Op.or]: [
            { salla_merchant_id: req.user.merchant.id },
            { platform_store_id: req.user.merchant.id }
          ]
        },
        include: [{ model: db.models.Subscription, include: [db.models.Plan] }]
      });
    }

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
// waWeb imported at top of file

// يحلّ معرّف التاجر الحالي بناءً على الجلسة المصادق عليها حصراً
async function _waTenantId(req) {
  if (!req.user && !req.session?.tenantId) {
    return null;
  }
  const db = SallaDatabase.connection;
  if (!db || !db.models?.Tenant) return null;

  // 1. Deducing directly from session tenantId / user tenant_id
  const tenantId = req.user?.tenant_id || req.session?.tenantId;
  if (tenantId) {
    const tenant = await db.models.Tenant.findByPk(tenantId);
    return tenant ? tenant.id : null;
  }

  // 2. Deducing from authenticated merchant ID
  if (req.user?.merchant?.id) {
    const tenant = await db.models.Tenant.findOne({ where: { salla_merchant_id: req.user.merchant.id } });
    return tenant ? tenant.id : null;
  }

  return null;
}

// صفحة الربط (QR) — مصادق عليها حصراً
app.get("/whatsapp-web", ensureAuthenticated, async (req, res) => {
  try {
    const db = SallaDatabase.connection;
    const tenantId = req.user?.tenant_id || req.session?.tenantId;
    let tenant = null;

    if (tenantId) {
      tenant = await db.models.Tenant.findByPk(tenantId);
    } else if (req.user?.merchant?.id) {
      tenant = await db.models.Tenant.findOne({ where: { salla_merchant_id: req.user.merchant.id } });
    }

    if (!tenant || !tenant.store_name) {
      console.error("❌ Access Blocked: Missing valid Tenant Context in DB");
      return res.status(403).send("🔒 Access Denied: Valid Tenant Context is required to access WhatsApp pairing.");
    }

    const userToRender = {
      ...req.user,
      tenant_id: tenant.id,
      store_name: tenant.store_name,
      merchant: {
        ...(req.user?.merchant || {}),
        name: tenant.store_name
      }
    };

    res.render("whatsapp_web.html", { 
      user: userToRender, 
      activePage: 'wa_web', 
      store_name: tenant.store_name,
      tenant_id: tenant.id 
    });
  } catch (e) {
    console.error("Error rendering whatsapp-web:", e);
    res.redirect('/login');
  }
});

// صفحة محاكي واتساب (Simulator)
app.get(["/simulator", "/whatsapp-simulator"], (req, res) => {
  res.render("simulator.html", { user: req.user, activePage: 'simulator' });
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
  if (!req.user) {
    if (process.env.NODE_ENV !== 'development') return { db: SallaDatabase.connection, tenant: null };
    req.user = { merchant: { id: 123456789, name: 'Demo Merchant' } };
  }
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
app.post("/api/customers/import", require('./services/planGate').requireFeature('customers_import'), async (req, res) => {
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

  // Plan Gate check
  const planGate = require('./services/planGate');
  const access = await planGate.checkTenantAccess(tenant.id, 'campaigns');
  if (!access.allowed) {
    console.log(`[planGate] blocked tenant ${tenant.id} reason=${access.reason}`);
    await campaign.update({ status: 'failed', metadata: { block_reason: access.reason } });
    return;
  }

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

setInterval(createWorker(async function campaignPollerWorker() {
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
}), 60000);

app.post("/api/campaigns/send", async (req, res) => {
  try {
    // 1. Auth & Validation — Explicit & Server-Side Resolved
    if (!req.isAuthenticated() || !req.user) {
      return res.status(401).json({ error: "Authentication required" });
    }

    const db = SallaDatabase.connection;
    const { Op } = require("sequelize");

    // Find Tenant strictly from authenticated session
    const tenant = await getTenantFromReq(req);
    if (!tenant) {
      return res.status(401).json({ error: "Invalid session or tenant not found" });
    }

    // --- CHECK PLAN GATE ---
    const planGate = require('./services/planGate');
    const access = await planGate.checkTenantAccess(tenant.id, 'campaigns');
    if (!access.allowed) {
      console.log(`[planGate] blocked tenant ${tenant.id} reason=${access.reason}`);
      return res.status(403).json({ error: "PLAN_GATE_BLOCKED", message: `غير مسموح لك بإرسال هذه الحملة. السبب: ${access.reason}` });
    }

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


// ---------------------------------------------------------
// AI SETTINGS ROUTES
// ---------------------------------------------------------

// 1. View Settings Redirect
app.get("/settings/ai", (req, res) => {
  res.redirect("/ai-settings");
});

app.get("/ai-settings", async (req, res) => {
  try {
    if (!req.user) req.user = { merchant: { id: 123456789, name: 'Demo Merchant' } };
    const db = SallaDatabase.connection;
    const tenantId = req.user?.tenant_id || req.session?.tenantId;
    let tenant = null;
    if (tenantId) {
      tenant = await db.models.Tenant.findByPk(tenantId, {
        include: [{ model: db.models.Subscription, include: [db.models.Plan] }]
      });
    } else if (req.user?.merchant?.id) {
      tenant = await db.models.Tenant.findOne({
        where: {
          [require('sequelize').Op.or]: [
            { salla_merchant_id: req.user.merchant.id },
            { platform_store_id: req.user.merchant.id }
          ]
        },
        include: [{ model: db.models.Subscription, include: [db.models.Plan] }]
      });
    }

    const plan = tenant?.Subscription?.Plan;
    const aiConfig = (tenant && tenant.settings && tenant.settings.ai_config) ? tenant.settings.ai_config : {};
    const kbConfig = (tenant && tenant.settings && tenant.settings.knowledge_base) ? tenant.settings.knowledge_base : {};

    res.render("ai_settings.html", { config: aiConfig, kb: kbConfig, user: req.user, activePage: 'ai_settings', plan_name: plan?.name || 'الأساسية' });
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
        shipping_time: req.body.shipping_time,
        allow_discount: req.body.allow_discount === 'true' || req.body.allow_discount === 'on' || req.body.allow_discount === true,
        discount_code: req.body.discount_code || '',
        discount_value: req.body.discount_value ? Number(req.body.discount_value) : 0,
        discount_type: req.body.discount_type || 'percentage'
      };

      if (!currentSettings.knowledge_base) {
        currentSettings.knowledge_base = {};
      }
      currentSettings.knowledge_base.custom_text = req.body.custom_text || '';

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

// Helper to build System Prompt from Config (Unified with PromptManager)
function buildSystemPrompt(config, storeInfo = {}) {
  const PromptManager = require('./services/PromptManager');
  return PromptManager.buildSalesAgentPrompt(storeInfo, config);
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
      const plan = await connection.models.Plan.findOne({ where: { name: 'الأساسية' } });
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
      const { PLANS } = require('./services/planGate');
      const plans = Object.entries(PLANS).map(([name, cfg]) => ({
        name,
        price_monthly: cfg.price_monthly,
        price_yearly: cfg.price_yearly,
        msg_limit_monthly: cfg.limits.messages_monthly,
        trial_days: cfg.trial_days,
        is_active: true,
        features: {
          ...cfg.features,
          limits: cfg.limits,
          scenarios: cfg.scenarios
        }
      }));

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

        // Startup must not mutate subscription plan/status. New tenants are initialized by onboarding/payment flows.
        if (connection.models.Subscription) {
          const Subscription = connection.models.Subscription;
          const existingSub = await Subscription.findOne({ where: { tenant_id: demoTenant.id } });
          if (!existingSub) {
            console.log("ℹ️ Demo tenant has no subscription; leaving plan assignment to onboarding/payment flow.");
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
    assertRuntimeGuard();
    const startScheduler = createWorker(function startSchedulerWorker() {
      const scheduler = require('./jobs/scheduler');
      scheduler.start();
    });
    startScheduler();
  } catch (e) {
    console.error('⚠️ Scheduler failed to start:', e.message);
  }

  // ── 🔄 استعادة جلسات واتساب (QR) المحفوظة للتجار المتصلين سابقاً
  try {
    assertRuntimeGuard();
    const restoreAllSessions = createWorker(function restoreAllSessionsWorker() {
      waWeb.restoreAll();
    });
    restoreAllSessions();
  } catch (e) {
    console.error('⚠️ waWeb restore failed:', e.message);
  }

  // Start Webhook Inbox Worker
  try {
    const WebhookInboxWorker = require('./services/WebhookInboxWorker');
    WebhookInboxWorker.start();
  } catch (e) {
    console.error('⚠️ WebhookInboxWorker failed to start:', e.message);
  }

  assertRuntimeGuard();
  const startServer = (retryPort) => {
    const host = process.env.HOST || '127.0.0.1';
    const serverInstance = server.listen(retryPort, host, () => {
      console.log(`🚀 SaaS System Ready on http://${host}:${retryPort}`);
      console.log(`💻 Dashboard: http://${host}:${retryPort}/dashboard`);
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

  startServer(parseInt(port, 10));
});

// 🔒 GRACEFUL SHUTDOWN HANDLERS (Zero-Downtime & Session Protection)
let shutdownInProgress = false;

const gracefulShutdown = async (signal, err = null) => {
  if (shutdownInProgress) return;
  shutdownInProgress = true;

  console.log(`\n⚠️ [SHUTDOWN] Received ${signal}. Starting graceful shutdown...`);
  if (err) {
    console.error('Shutdown Reason (Fatal Error):', err.stack || err);
  }

  // Set total safety watchdog timer of 25 seconds
  const timeoutTimer = setTimeout(() => {
    console.error('❌ [SHUTDOWN] Graceful shutdown timed out (25s expired)! Exiting immediately.');
    process.exit(1);
  }, 25000);

  // 1. Close HTTP server first
  if (server && server.listening) {
    server.close(() => {
      console.log('HTTP Server closed.');
    });
  }

  // Stop Webhook Inbox Worker
  try {
    const WebhookInboxWorker = require('./services/WebhookInboxWorker');
    WebhookInboxWorker.stop();
  } catch (e) {}
  
  // 2. Gracefully close all Puppeteer/whatsapp-web.js client sessions to preserve session keys and avoid locks
  try {
    const waWebMod = require('./services/waWeb');
    await waWebMod.destroyAll();
  } catch (e) {
    console.error('Error during waWeb graceful shutdown:', e.message);
  }

  // 3. Close database connections cleanly
  try {
    if (SallaDatabase && SallaDatabase.connection) {
      await SallaDatabase.connection.close();
      console.log('Database connections closed cleanly.');
    }
  } catch (e) {
    console.error('Error closing database connection:', e.message);
  }

  clearTimeout(timeoutTimer);
  console.log('👋 Graceful shutdown complete. Exiting.');
  process.exit(signal === 'uncaughtException' || signal === 'unhandledRejection' ? 1 : 0);
};

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

process.on('uncaughtException', (err) => {
  gracefulShutdown('uncaughtException', err);
});
process.on('unhandledRejection', (reason, promise) => {
  const msg = (reason && (reason.message || reason.toString())) || '';
  if (
    msg.includes('detached Frame') ||
    msg.includes('Execution context was destroyed') ||
    msg.includes('Target closed') ||
    msg.includes('Protocol error')
  ) {
    console.warn('⚠️ [WARNING] Ignored transient Puppeteer rejection to prevent crash:', msg);
    return;
  }
  const err = reason instanceof Error ? reason : new Error(String(reason));
  gracefulShutdown('unhandledRejection', err);
});
