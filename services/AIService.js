const OpenAI = require('openai');
const SallaDatabase = require('../database/db_instance');
const PromptManager = require('./PromptManager');
const crypto = require('crypto');

// OpenAI Instance (Global)
// OpenAI Instance (Lazy Init)
// const apiKey = process.env.OPENAI_API_KEY; // Moved inside

// System Prompt Template
const BASE_SYSTEM_PROMPT = `
أنت مساعد خدمة عملاء ذكي ومحترف لمتجر "{store_name}".
- لهجتك: سعودية بيضاء، ودودة، ومحترمة.
- أسلوبك: مختصر ومفيد. استخدم الإيموجي المناسب 📦✨.
- وظيفتك: الرد على استفسارات العملاء بناءً على المعلومات التالية فقط.
- إذا سألك العميل عن شيء غير موجود في المعلومات، اعتذر بأسلوب لطيف وقل أنك ستحول الطلب للموظف.

[معلومات المتجر]
المتجر: {store_name}
الرابط: {store_domain}
سياسة الاسترجاع: {return_policy}
الشحن: {shipping_policy}
أخرى: {custom_kb}
`;

class AIService {

    async generateReply(tenantId, userMessage, customerName = 'عميلنا', previousMessages = [], aiRequestId = null) {
        const actualRequestId = aiRequestId || crypto.randomUUID();
        try {
            const planGate = require('./planGate');
            const access = await planGate.checkTenantAccess(tenantId);
            if (!access.allowed) {
                console.log(`[planGate] blocked tenant ${tenantId} reason=${access.reason}`);
                throw new Error(`Plan Gate Blocked: ${access.reason}`);
            }

            const db = SallaDatabase.connection;
            if (!db) throw new Error("Database connection not established");

            // 1. Fetch Tenant & Limits
            const tenant = await db.models.Tenant.findByPk(tenantId, {
                include: [
                    {
                        model: db.models.Subscription,
                        include: [db.models.Plan]
                    },
                    {
                        model: db.models.UsageCounter,
                        where: { period_key: new Date().toISOString().slice(0, 7) }, // Current Month
                        required: false
                    }
                ]
            });

            if (!tenant) throw new Error("Tenant not found");

            // 2. Check Usage Limits
            const limitsEngine = require('../helpers/limitsEngine');
            const limitCheck = await limitsEngine.checkLimit(tenantId, db.models, 'ai_reply', 1);
            if (!limitCheck.allowed) {
                console.log(`[limitsEngine] AI reply blocked for tenant ${tenantId}: ${limitCheck.reason}`);
                throw new Error(`AI Limit Reached: ${limitCheck.reason}`);
            }

            const subscription = limitCheck.subscription;
            const planFeatures = subscription?.Plan?.features || {};
            const isAdvancedAI = planFeatures.ai_advanced === true;

            // 3. Prepare System Prompt (Using PromptManager)
            const tenantSettings = tenant.settings || {};
            const kbConfig = tenantSettings.knowledge_base || {};
            const aiConfig = tenantSettings.ai_config || {};
            const isCrawlerEnabled = tenantSettings.enable_storefront_crawler === true;

            // Trigger Storefront Crawler in background (non-blocking) if enabled as an optional source
            if (isCrawlerEnabled) {
                const StorefrontCrawler = require('./StorefrontCrawler');
                StorefrontCrawler.crawlStorefront(tenantId).catch(err => {
                    console.error(`[AIService] Background crawl triggered error:`, err.message);
                });
            }

            const crawledPolicies = isCrawlerEnabled ? (tenantSettings.crawled_policies || {}) : {};

            // Priority logic for shipping policy: Crawled storefront -> AI Config -> KB Config -> Fallback
            let shippingPolicy = crawledPolicies.shipping_policy?.content;
            if (!shippingPolicy || shippingPolicy.trim().length === 0) {
                if (aiConfig.shipping_time && aiConfig.shipping_time.trim().length > 0) {
                    shippingPolicy = aiConfig.shipping_time.trim();
                } else if (kbConfig.shipping_policy && kbConfig.shipping_policy.trim().length > 0) {
                    shippingPolicy = kbConfig.shipping_policy.trim();
                }
            }
            if (shippingPolicy) {
                shippingPolicy = shippingPolicy.slice(0, 800);
            }

            // Priority logic for return policy: Crawled storefront -> AI Config -> KB Config -> Fallback
            let returnPolicy = crawledPolicies.return_policy?.content;
            if (!returnPolicy || returnPolicy.trim().length === 0) {
                if (aiConfig.policy_return && aiConfig.policy_return.trim().length > 0) {
                    returnPolicy = aiConfig.policy_return.trim();
                } else if (kbConfig.return_policy && kbConfig.return_policy.trim().length > 0) {
                    returnPolicy = kbConfig.return_policy.trim();
                }
            }
            if (returnPolicy) {
                returnPolicy = returnPolicy.slice(0, 800);
            }

            // Get store description from Salla store/info API
            const SallaProductKnowledgeService = require('./SallaProductKnowledgeService');
            const sallaStoreDesc = await SallaProductKnowledgeService.getStoreDescription(tenantId);
            let storeDescription = '';
            if (sallaStoreDesc) {
                storeDescription = sallaStoreDesc.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim().slice(0, 2000);
            }
            if (!storeDescription && kbConfig.custom_text) {
                storeDescription = kbConfig.custom_text.slice(0, 2000);
            }

            const storeInfo = {
                name: kbConfig.business_name || tenant.store_name,
                domain: kbConfig.website || kbConfig.official_links || tenant.store_domain,
                description: storeDescription,
                cr_number: kbConfig.cr_number || tenant.cr_number,
                verification_number: kbConfig.verification_number || tenant.verification_number,
                services: kbConfig.services,
                packages: kbConfig.packages,
                prices: kbConfig.prices,
                business_hours: kbConfig.business_hours,
                policies: kbConfig.policies,
                shipping_policy: shippingPolicy,
                return_policy: returnPolicy,
                custom_text: kbConfig.custom_text
            };

            // Fetch matching products context from Salla
            const sallaProducts = await SallaProductKnowledgeService.searchRelevantProducts(tenantId, userMessage);
            if (sallaProducts && sallaProducts.length > 0) {
                storeInfo.salla_products_context = sallaProducts;
            }

            const config = {
                bot_name: aiConfig.bot_name || 'مبهر',
                bot_tone: aiConfig.bot_tone || 'friendly',
                custom_instructions: aiConfig.custom_instructions,
                allow_discount: aiConfig.allow_discount === true,
                discount_code: aiConfig.discount_code || '',
                discount_value: aiConfig.discount_value || 0,
                discount_type: aiConfig.discount_type || 'percentage',
                discount_min_order: aiConfig.discount_min_order || 0,
                discount_scope: aiConfig.discount_scope || 'all_products',
                discount_valid_until: aiConfig.discount_valid_until || null
            };

            // Detect complaint or anger keywords for tone safety override
            const complaintKeywords = ['شكوى', 'غاضب', 'زعلان', 'استرجاع', 'احتيال', 'تاخير', 'تأخير', 'فلوسي', 'سرقة'];
            const isComplaint = complaintKeywords.some(kw => String(userMessage).toLowerCase().includes(kw));

            const systemPrompt = PromptManager.buildSalesAgentPrompt(storeInfo, config, { isComplaint });
            console.log(`[AIService] Injected system prompt length: ${systemPrompt.length} characters.`);

            // 4. Transform Previous Messages to OpenAI Format
            const history = previousMessages.map(msg => ({
                role: msg.fromMe ? 'assistant' : 'user',
                content: msg.body
            }));

            // Add Current User Message
            history.push({ role: 'user', content: userMessage });

            // 5. Call OpenAI
            const apiKey = process.env.OPENAI_API_KEY;
            if (!apiKey) {
                console.warn("⚠️ OpenAI API Key is missing in .env");
                return this.mockResponse(userMessage, tenant.store_name);
            }

            const openai = new OpenAI({ apiKey });

            const completion = await openai.chat.completions.create({
                model: "gpt-4o-mini", // GPT-4o Mini for all plans without exception
                messages: [
                    { role: "system", content: systemPrompt },
                    ...history.slice(-15) // Keep last 15 messages for deep conversational memory
                ],
                max_tokens: 450,
                temperature: 0.5,
            });

            const aiReply = completion.choices[0].message.content;

            // 6. Increment Usage Counter and Record Log (Skipped in Simulator or explicit skip option)
            const isSimulatorMode = options.isSimulator === true || options.skipUsage === true;
            if (!isSimulatorMode) {
                await this.incrementAIUsage(tenantId);
                if (!options.skipAiUsageLog) {
                    await this.recordAiUsage(tenantId, completion, 'bot_reply', actualRequestId);
                }
            } else {
                console.log(`[AIService] Simulation mode active for tenant ${tenantId}: Usage counters & production logs skipped.`);
            }

            return aiReply;

        } catch (error) {
            if (error.message.includes("Plan Gate Blocked") || error.message.includes("AI Limit Reached")) throw error;
            console.error("❌ AI Service Error:", error.message);
            return this.mockResponse(userMessage, "المتجر");
        }
    }

    async generateOrderNotification(tenantId, customerName, orderId, orderTotal, aiRequestId = null) {
        const actualRequestId = aiRequestId || crypto.randomUUID();
        try {
            const planGate = require('./planGate');
            const access = await planGate.checkTenantAccess(tenantId);
            if (!access.allowed) {
                console.log(`[planGate] blocked tenant ${tenantId} reason=${access.reason}`);
                throw new Error(`Plan Gate Blocked: ${access.reason}`);
            }

            const db = SallaDatabase.connection;
            if (!db) return `أهلاً ${customerName}، شكراً لطلبك رقم #${orderId} بقيمة ${orderTotal}. سنسعد بخدمتك!`;

            const tenant = await db.models.Tenant.findByPk(tenantId);
            const storeName = tenant ? tenant.store_name : 'المتجر';

            const systemPrompt = `أنت مساعد ذكي لمتجر "${storeName}". مهمتك صياغة رسالة واتساب قصيرة وودودة جداً للعميل لشكره على طلبه.
            المعلومات:
            العميل: ${customerName}
            رقم الطلب: ${orderId}
            الإجمالي: ${orderTotal}
            
            الشروط:
            - استخدم إيموجي 📦🎉.
            - لا تكن رسمياً جداً.
            - اختصر الرسالة في سطرين أو ثلاثة.`;

            const apiKey = process.env.OPENAI_API_KEY;
            if (!apiKey) return `أهلاً ${customerName}، شكراً لطلبك رقم #${orderId} بقيمة ${orderTotal} من ${storeName}. 🎉`;

            const openai = new OpenAI({ apiKey });
            const completion = await openai.chat.completions.create({
                model: "gpt-4o-mini", // GPT-4o Mini for all notifications
                messages: [{ role: "system", content: systemPrompt }],
                max_tokens: 100,
                temperature: 0.7,
            });

            // Increment AI Usage
            await this.incrementAIUsage(tenantId);
            await this.recordAiUsage(tenantId, completion, 'order_notification', actualRequestId);

            return completion.choices[0].message.content;
        } catch (e) {
            if (e.message.includes("Plan Gate Blocked")) throw e;
            console.error("AI Order Msg Error:", e.message);
            return `أهلاً ${customerName}، تم استلام طلبك #${orderId} بقيمة ${orderTotal}. شكراً لتسوقك معنا! 📦`;
        }
    }

    async generateCartRecovery(tenantId, customerName, cartTotal, cartItems = [], aiRequestId = null) {
        const actualRequestId = aiRequestId || crypto.randomUUID();
        try {
            const planGate = require('./planGate');
            const access = await planGate.checkTenantAccess(tenantId);
            if (!access.allowed) {
                console.log(`[planGate] blocked tenant ${tenantId} reason=${access.reason}`);
                throw new Error(`Plan Gate Blocked: ${access.reason}`);
            }

            const db = SallaDatabase.connection;
            // Fallback message if DB or AI fails
            const fallbackMsg = `أهلاً ${customerName} 👋\nسلّتك تنتظرك! 🛒\nقيمة الطلب: ${cartTotal}\nلا تفوتك منتجاتنا المميزة! ✨`;

            if (!db) return fallbackMsg;

            const tenant = await db.models.Tenant.findByPk(tenantId);
            const storeName = tenant ? tenant.store_name : 'المتجر';

            // Construct System Prompt for Persuasion
            const systemPrompt = `أنت خبير مبيعات ذكي لمتجر "${storeName}". 
            مهمتك: كتابة رسالة واتساب قصيرة جداً (أقل من 40 كلمة) لاستعادة عميل ترك سلة تسوق.
            
            البيانات:
            - العميل: ${customerName}
            - قيمة السلة: ${cartTotal}
            - المنتجات (إن وجدت): ${cartItems.join(', ')}

            الإرشادات:
            1. ابدأ بترحيب ودود باسم العميل.
            2. ذكر العميل أن سلة التسوق محفوظة له.
            3. استخدم أسلوب "الخوف من الفوات" (FOMO) بلطف (مثلاً: قبل نفاذ الكمية).
            4. استخدم 2-3 إيموجي مناسبة 🛒✨🏃‍♂️.
            5. لا تضع أي روابط (النظام سيضيف الرابط تلقائياً).
            6. اللهجة: سعودية بيضاء محببة.`;

            const apiKey = process.env.OPENAI_API_KEY;
            if (!apiKey) {
                console.warn("⚠️ OpenAI API Key missing for Cart Recovery");
                return fallbackMsg;
            }

            const openai = new OpenAI({ apiKey });
            const completion = await openai.chat.completions.create({
                model: "gpt-4o-mini", // Use smarter model for persuasion
                messages: [{ role: "system", content: systemPrompt }],
                max_tokens: 150,
                temperature: 0.8, // Slightly creative
            });

            // Increment AI Usage
            await this.incrementAIUsage(tenantId);
            await this.recordAiUsage(tenantId, completion, 'cart_recovery', actualRequestId);

            return completion.choices[0].message.content;

        } catch (e) {
            if (e.message.includes("Plan Gate Blocked")) throw e;
            console.error("AI Cart Recovery Error:", e.message);
            return `أهلاً ${customerName} 👋\nسلّتك الغالية تنتظرك! 🛒\nقيمة الطلب: ${cartTotal}\nكمل طلبك الآن قبل يروح عليك! 🏃‍♂️`;
        }
    }

    async generateReviewRequest(tenantId, customerName, orderId, orderTotal, aiRequestId = null) {
        const actualRequestId = aiRequestId || crypto.randomUUID();
        try {
            const planGate = require('./planGate');
            const access = await planGate.checkTenantAccess(tenantId);
            if (!access.allowed) {
                console.log(`[planGate] blocked tenant ${tenantId} reason=${access.reason}`);
                throw new Error(`Plan Gate Blocked: ${access.reason}`);
            }

            const db = SallaDatabase.connection;
            const fallbackMsg = `شكراً لتسوقك معنا ${customerName} 🌹\nنقدر لك ثقتك فينا، ويهمنا جداً نسمع رأيك في تجربتك!`;

            if (!db) return fallbackMsg;

            const tenant = await db.models.Tenant.findByPk(tenantId);
            const storeName = tenant ? tenant.store_name : 'المتجر';

            const systemPrompt = `أنت مساعد ذكي لمتجر "${storeName}".
            الهدف: كتابة رسالة شكر دافئة وقصيرة للعميل بعد استلام طلبه، ودعوته للتقييم.
            
            العميل: ${customerName}
            رقم الطلب: ${orderId}
            
            الشروط:
            1. ابدأ بالشكر والدعاء بالبركة.
            2. اطلب التقييم بأسلوب لطيف (مثلاً: رأيك يطورنا).
            3. استخدم إيموجي 🌟🙏.
            4. لا تضع روابط (النظام سيضيفها).
            5. اللهجة: سعودية ودودة.`;

            const apiKey = process.env.OPENAI_API_KEY;
            if (!apiKey) return fallbackMsg;

            const openai = new OpenAI({ apiKey });
            const completion = await openai.chat.completions.create({
                model: "gpt-4o-mini",
                messages: [{ role: "system", content: systemPrompt }],
                max_tokens: 100,
                temperature: 0.7,
            });

            // Increment AI Usage
            await this.incrementAIUsage(tenantId);
            await this.recordAiUsage(tenantId, completion, 'review_request', actualRequestId);

            return completion.choices[0].message.content;

        } catch (e) {
            if (e.message.includes("Plan Gate Blocked")) throw e;
            console.error("AI Review Request Error:", e.message);
            return `شكراً لتسوقك معنا ${customerName} 🌹\nنتمتى لك تجربة سعيدة!`;
        }
    }

    /**
     * Increment usage counter safely
     */
    async incrementAIUsage(tenantId) {
        const periodKey = new Date().toISOString().slice(0, 7); // YYYY-MM
        try {
            const db = SallaDatabase.connection;
            if (!db) return;

            const [counter] = await db.models.UsageCounter.findOrCreate({
                where: { tenant_id: tenantId, period_key: periodKey },
                defaults: { ai_requests: 0, messages_sent: 0 }
            });
            await counter.increment('ai_requests');
        } catch (e) {
            console.error("Usage Increment Failed:", e);
        }
    }

    // Fallback Mock Response
    mockResponse(msg, storeName) {
        if (msg.includes('طلب')) return "أهلاً بك في " + storeName + ". يرجى تزويدنا برقم الطلب للمساعدة 📦";
        return "أهلاً بك في " + storeName + "! كيف يمكننا خدمتك اليوم؟ ✨";
    }

    /**
     * Record detailed AI usage securely in database
     */
    async recordAiUsage(tenantId, completion, featureSource, aiRequestId = null) {
        try {
            const db = SallaDatabase.connection;
            if (!db || !db.models?.AiUsageLog) {
                console.warn("[AIService] Database or AiUsageLog model is not available for recording usage.");
                return;
            }

            if (!completion) return;

            // Generate providerRequestId exactly per specs:
            // openai:<completion.id> if completion.id exists
            // internal:<aiRequestId> if completion.id is missing and aiRequestId is provided
            let providerRequestId;
            if (completion.id) {
                providerRequestId = 'openai:' + completion.id;
            } else if (aiRequestId) {
                providerRequestId = 'internal:' + aiRequestId;
            } else {
                const fallbackId = `fallback_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
                providerRequestId = 'internal:' + fallbackId;
            }

            // Deduplicate Check: check if provider_request_id already exists
            const existing = await db.models.AiUsageLog.findOne({ where: { provider_request_id: providerRequestId } });
            if (existing) {
                console.warn(`[AIService] Duplicate request id ${providerRequestId} detected, skipping save.`);
                return;
            }

            // Extract prompt, completion and total tokens from standard or alternate formats
            const usage = completion.usage || {};
            const promptTokens = usage.prompt_tokens !== undefined ? usage.prompt_tokens : (usage.input_tokens || 0);
            const completionTokens = usage.completion_tokens !== undefined ? usage.completion_tokens : (usage.output_tokens || 0);
            const totalTokens = usage.total_tokens !== undefined ? usage.total_tokens : (promptTokens + completionTokens);

            // Extract cached input tokens from prompt_tokens_details or input_tokens_details or direct properties
            let cachedTokens = 0;
            if (usage.prompt_tokens_details && usage.prompt_tokens_details.cached_tokens !== undefined) {
                cachedTokens = usage.prompt_tokens_details.cached_tokens;
            } else if (usage.input_tokens_details && usage.input_tokens_details.cached_tokens !== undefined) {
                cachedTokens = usage.input_tokens_details.cached_tokens;
            } else if (usage.cached_tokens !== undefined) {
                cachedTokens = usage.cached_tokens;
            }

            const modelUsed = completion.model || 'gpt-4o-mini';

            // Versioned pricing structure as required
            const AI_PRICING = {
                version: "gpt-4o-mini-2026-07",
                models: {
                    "gpt-4o-mini": {
                        input_per_million: 0.15,
                        cached_input_per_million: 0.075,
                        output_per_million: 0.60
                    }
                }
            };

            // Normalize models starting with gpt-4o-mini
            let pricingKey = null;
            if (modelUsed.startsWith("gpt-4o-mini")) {
                pricingKey = "gpt-4o-mini";
            }
            const modelPricing = pricingKey ? AI_PRICING.models[pricingKey] : AI_PRICING.models[modelUsed];
            let estimatedCost = 0.0;
            let pricingStatus = "priced";

            if (!modelPricing) {
                pricingStatus = "unknown_model";
                estimatedCost = 0.0;
                console.warn(`[AIService] Alert: Unknown AI model returned: ${modelUsed}. Cost set to 0, pricing_status marked as unknown_model.`);
            } else {
                const nonCached = Math.max(0, promptTokens - cachedTokens);
                const inputCost = (nonCached / 1000000) * modelPricing.input_per_million;
                const cachedCost = (cachedTokens / 1000000) * modelPricing.cached_input_per_million;
                const outputCost = (completionTokens / 1000000) * modelPricing.output_per_million;
                estimatedCost = inputCost + cachedCost + outputCost;
            }

            await db.models.AiUsageLog.create({
                tenant_id: tenantId,
                provider_request_id: providerRequestId,
                prompt_tokens: promptTokens,
                completion_tokens: completionTokens,
                cached_tokens: cachedTokens,
                total_tokens: totalTokens,
                model: modelUsed,
                estimated_cost: estimatedCost,
                currency: "USD",
                pricing_version: AI_PRICING.version,
                pricing_status: pricingStatus,
                request_status: "success",
                feature_source: featureSource
            });

        } catch (error) {
            // Cleaned error log, avoiding leakage of prompts or customer info
            console.error("❌ Failed to log AI usage:", error.message);
        }
    }
}

module.exports = new AIService();
