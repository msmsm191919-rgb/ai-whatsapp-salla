// Import Deps
require("dotenv").config();
const express = require("express");
const session = require("express-session");
const passport = require("passport");
const consolidate = require("consolidate");
const getUnixTimestamp = require("./helpers/getUnixTimestamp");
const bodyParser = require("body-parser");
const port = process.argv[2] || 8082;

/*
  Create a .env file in the root directory of your project. 
  Add environment-specific variables on new lines in the form of NAME=VALUE. For example:
  SALLA_OAUTH_CLIENT_ID=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
  SALLA_OAUTH_CLIENT_SECRET=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
  ...
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
const SallaDatabase = require("./database/db_instance");
const SallaWebhook = require("@salla.sa/webhooks-actions");

SallaWebhook.setSecret(SALLA_WEBHOOK_SECRET);

// Add Listeners
const { sendMetaMessage } = require('./helpers/metaProvider');

SallaWebhook.on("app.installed", async (eventBody, userArgs) => {
    console.log("🎉 App Installed:", eventBody);
});

SallaWebhook.on("app.store.authorize", async (eventBody, userArgs) => {
    console.log("🔑 App Authorized:", eventBody);
});

// Salla Webhook: Abandoned Cart Logic
SallaWebhook.on("basket.abandoned", async (eventBody, userArgs) => {
    console.log("🛒 Abandoned Cart Event Received:", eventBody);
    try {
        const merchantId = eventBody.merchant; // Salla Merchant ID

        // 1. Find Tenant
        const tenant = await SallaDatabase.getTenantBySallaID(merchantId);
        if (!tenant) return console.warn("Tenant not found for merchant:", merchantId);

        // 2. Check if Scenario Enabled
        const settings = tenant.settings || {};
        if (!settings.scenarios || !settings.scenarios.abandoned_cart) {
            console.log("ℹ️ Abandoned Cart scenario disabled for this tenant.");
            return;
        }

        // 3. Get Config
        const metaConfig = await SallaDatabase.connection.models.WhatsAppConfig.findOne({ where: { tenant_id: tenant.id } });
        if (!metaConfig || !metaConfig.access_token) {
            console.error("❌ No WhatsApp Config found for tenant:", tenant.id);
            return;
        }

        // 4. Extract Customer Phone
        // eventBody.data.customer_mobile usually exists
        const customerPhone = eventBody.data.customer_mobile;
        const customerName = eventBody.data.customer_name || 'عميلنا';
        const checkoutUrl = eventBody.data.checkout_url;

        if (!customerPhone) return;

        // 5. Send Message
        const message = `أهلاً ${customerName}، 👋\nلاحظنا أنك تركت بعض المنتجات في سلتك 🛒.\n\nلا تفوت الفرصة، أكمل طلبك الآن من هنا: ${checkoutUrl}\n\nنحن بخدمتك دائماً! ✨`;

        await sendMetaMessage(metaConfig, customerPhone, message);
        console.log(`✅ Abandoned Cart Message Sent to ${customerPhone}`);

        // Log it
        await SallaDatabase.connection.models.MessageLog.create({
            tenant_id: tenant.id,
            direction: 'out',
            content: message,
            to_phone: customerPhone,
            status: 'sent'
        });

    } catch (error) {
        console.error("❌ Error processing Abandoned Cart:", error.message);
    }
});

SallaWebhook.on("all", (eventBody, userArgs) => {
    // console.log("Event:", eventBody.event); 
});

// we initialize our Salla API
const SallaAPI = new SallaAPIFactory({
    clientID: SALLA_OAUTH_CLIENT_ID,
    clientSecret: SALLA_OAUTH_CLIENT_SECRET,
    callbackURL: SALLA_OAUTH_CLIENT_REDIRECT_URI,
});

// set Listener on auth success
SallaAPI.onAuth(async (accessToken, refreshToken, expires_in, data) => {
    SallaDatabase.connect()
        .then(async (connection) => {
            let user_id = await SallaDatabase.saveUser({
                username: data.name,
                email: data.email,
                email_verified_at: getUnixTimestamp(),
                verified_at: getUnixTimestamp(),
                password: "",
                remember_token: "",
            });
            await SallaDatabase.saveOauth(
                {
                    merchant: data.merchant.id,
                    access_token: accessToken,
                    expires_in: expires_in,
                    refresh_token: refreshToken,
                    user_id
                },
            );
        })
        .catch((err) => {
            console.log("Error connecting to database: ", err);
        });
});

//   Passport session setup.
//   To support persistent login sessions, Passport needs to be able to
//   serialize users into and deserialize users out of the session. Typically,
//   this will be as simple as storing the user ID when serializing, and finding
//   the user by ID when deserializing. However, since this example does not
//   have a database of user records, the complete salla user is serialized
//   and deserialized.

passport.serializeUser(function (user, done) {
    done(null, user);
});

passport.deserializeUser(function (obj, done) {
    done(null, obj);
});

//   Use the Salla Strategy within Passport.
passport.use(SallaAPI.getPassportStrategy());
// save token and user data to your selected database

var app = express();

// configure Express
app.set("views", __dirname + "/views");
app.set("view engine", "html");

// set the session secret
// you can store session data in any database (monogdb - mysql - inmemory - etc) for more (https://www.npmjs.com/package/express-session)
app.use(
    session({ secret: "keyboard cat", resave: true, saveUninitialized: true })
);

// Initialize Passport!  Also use passport.session() middleware, to support
// persistent login sessions (recommended).
app.use(passport.initialize());
app.use(passport.session());

// serve static files from public folder
app.use(express.static(__dirname + "/public"));

// set the render engine to nunjucks

app.engine("html", consolidate.nunjucks);
app.use(bodyParser.urlencoded({ extended: false }));

// parse application/json
app.use(bodyParser.json());

app.use((req, res, next) => SallaAPI.setExpressVerify(req, res, next));

// POST /webhook
app.post("/webhook", function (req, res) {
    SallaWebhook.checkActions(req.body, req.headers.authorization, {
        /* your args to pass to action files or listeners */
    });
});

// --- META WEBHOOKS ---
const ChatService = require('./services/ChatService');
const META_VERIFY_TOKEN = process.env.META_VERIFY_TOKEN || 'salla_app_verify_token';

// 1. Verification Endpoint
app.get("/webhook/meta", (req, res) => {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    if (mode && token) {
        if (mode === 'subscribe' && token === META_VERIFY_TOKEN) {
            console.log('✅ Meta Webhook Verified');
            res.status(200).send(challenge);
        } else {
            console.error('❌ Meta Verification Failed: Token mismatch');
            res.sendStatus(403);
        }
    } else {
        res.sendStatus(400);
    }
});

// 2. Incoming Messages Endpoint
app.post("/webhook/meta", async (req, res) => {
    try {
        const body = req.body;
        // Check if this is an event from a WhatsApp API subscription
        if (body.object) {
            if (
                body.entry &&
                body.entry[0].changes &&
                body.entry[0].changes[0].value.messages &&
                body.entry[0].changes[0].value.messages[0]
            ) {
                const change = body.entry[0].changes[0].value;
                const message = change.messages[0];
                const phone_number_id = change.metadata.phone_number_id;

                if (message.type === 'text') {
                    const from = message.from; // Sender's phone number
                    const msg_body = message.text.body;

                    // Execute Async (Don't hold the webhook)
                    ChatService.handleIncomingMessage({
                        fromPhone: from,
                        messageBody: msg_body,
                        whatsAppId: phone_number_id,
                        isSimulated: false
                    }).catch(err => console.error("Async Chat Error:", err));
                }
            }
            res.sendStatus(200);
        } else {
            res.sendStatus(404);
        }
    } catch (error) {
        console.error("Webhook processing error:", error.message);
        res.sendStatus(200); // Always return 200 to Meta to avoid retries on bad logic
    }
});

// GET /oauth/redirect
//   Use passport.authenticate() as route middleware to authenticate the
//   request. The first step in salla authentication will involve redirecting
//   the user to accounts.salla.sa. After authorization, salla will redirect the user
//   back to this application at /oauth/callback
app.get(["/oauth/redirect", "/login"], passport.authenticate("salla"));

// GET /oauth/callback
//   Use passport.authenticate() as route middleware to authenticate the
//   request. If authentication fails, the user will be redirected back to the
//   login page. Otherwise, the primary route function function will be called,
//   which, in this example, will redirect the user to the home page.
app.get(
    "/oauth/callback",
    passport.authenticate("salla", { failureRedirect: "/login" }),
    function (req, res) {
        res.redirect("/");
    }
);

// GET /
// render the index page

app.get("/", async function (req, res) {
    let userDetails = {
        user: req.user,
        isLogin: req.user
    }
    if (req.user) {

        const userFromDB = await SallaDatabase.retrieveUser({ email: req.user.email }, true);
        const accessToken = userFromDB.oauthId.access_token;

        const userFromAPI = await SallaAPI.getResourceOwner(accessToken);

        // Merge user details with additional information from the API
        userDetails = { ...userDetails, ...userFromAPI };
        // mind you `req.user` content is almost the same as `user`,
        // the main purpose of calling  `await SallaAPI.getResourceOwner(access_token) `
        // is to show how to make calls with the access_toke

    }
    res.render("index.html", userDetails);
});

// GET /account
// get account information and ensure user is authenticated

app.get("/account", ensureAuthenticated, function (req, res) {
    res.render("account.html", {
        user: req.user,
        isLogin: req.user,
    });
});

// GET /refreshToken
// get new access token

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

// GET /orders
// get all orders from user store

app.get("/orders", ensureAuthenticated, async function (req, res) {
    res.render("orders.html", {
        orders: await SallaAPI.getAllOrders(),
        isLogin: req.user,
    });
});

// GET /customers
// get all customers from user store

app.get("/customers", ensureAuthenticated, async function (req, res) {
    res.render("customers.html", {
        customers: await SallaAPI.getAllCustomers(),
        isLogin: req.user,
    });
});

// GET /simulator (For testing)
app.get("/simulator", ensureAuthenticated, async function (req, res) {
    res.render("simulator.html", {
        isLogin: req.user,
        settings: {}, // Pass placeholder settings
        config: {}    // Pass placeholder config
    });
});

// --- API ROUTES FOR FRONTEND ---

// POST /api/settings/save
app.post("/api/settings/save", ensureAuthenticated, async (req, res) => {
    try {
        const { phone_number_id, waba_id, access_token } = req.body;
        const tenant = await SallaDatabase.getTenantBySallaID(req.user.merchant.id);

        if (!tenant) return res.status(404).json({ error: "Tenant not found" });

        // Upsert WhatsApp Config
        const [config, created] = await SallaDatabase.connection.models.WhatsAppConfig.findOrCreate({
            where: { tenant_id: tenant.id },
            defaults: { phone_number_id, waba_id, access_token }
        });

        if (!created) {
            config.phone_number_id = phone_number_id;
            config.waba_id = waba_id;
            config.access_token = access_token;
            await config.save();
        }

        res.json({ status: "success" });
    } catch (e) {
        console.error("Settings Save Error:", e);
        res.status(500).json({ error: e.message });
    }
});

// POST /api/knowledge-base/save
app.post("/api/knowledge-base/save", ensureAuthenticated, async (req, res) => {
    try {
        const { shipping_policy, return_policy, custom_text } = req.body;
        const tenant = await SallaDatabase.getTenantBySallaID(req.user.merchant.id);

        if (!tenant) return res.status(404).json({ error: "Tenant not found" });

        // Update Tenant Settings JSON
        let currentSettings = tenant.settings || {};
        currentSettings.knowledge_base = {
            shipping_policy,
            return_policy,
            custom_text
        };

        tenant.settings = currentSettings;
        tenant.changed('settings', true); // Force update for JSON/Text columns sometimes
        await tenant.save();

        res.json({ status: "success" });
    } catch (e) {
        console.error("KB Save Error:", e);
        res.status(500).json({ error: e.message });
    }
});

// POST /api/scenarios/save
app.post("/api/scenarios/save", ensureAuthenticated, async (req, res) => {
    try {
        const { abandoned_cart, review_request } = req.body;
        const tenant = await SallaDatabase.getTenantBySallaID(req.user.merchant.id);

        if (!tenant) return res.status(404).json({ error: "Tenant not found" });

        let currentSettings = tenant.settings || {};
        currentSettings.scenarios = {
            abandoned_cart: Boolean(abandoned_cart),
            review_request: Boolean(review_request)
        };

        tenant.settings = currentSettings;
        tenant.changed('settings', true);
        await tenant.save();

        res.json({ status: "success" });
    } catch (e) {
        console.error("Scenario Save Error:", e);
        res.status(500).json({ error: e.message });
    }
});

// GET /logout
//   logout from passport
app.get("/logout", function (req, res) {
    SallaAPI.logout();
    req.logout(function (err) {
        if (err) { return next(err); }
        res.redirect("/");
    });
});

app.listen(port, () => {
    console.log(`🚀 Server is running on http://localhost:${port}`);
});


// Simple route middleware to ensure user is authenticated.
//   Use this route middleware on any resource that needs to be protected.  If
//   the request is authenticated (typically via a persistent login session),
//   the request will proceed. Otherwise, the user will be redirected to the
//   login page.
function ensureAuthenticated(req, res, next) {
    if (req.isAuthenticated()) {
        return next();
    }
    res.redirect("/login");
}
