const OpenAI = require('openai');
const SallaDatabase = require('../database/db_instance');
const PromptManager = require('./PromptManager');

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

    async generateReply(tenantId, userMessage, customerName = 'عميلنا', previousMessages = []) {
        try {
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
            const subscription = tenant.Subscription;
            const msgLimit = subscription?.Plan?.features?.ai_requests || 0; // Or from monthly limit
            const currentUsage = tenant.UsageCounters && tenant.UsageCounters.length > 0
                ? tenant.UsageCounters[0].ai_requests
                : 0;

            const planFeatures = subscription?.Plan?.features || {};
            const isAdvancedAI = planFeatures.ai_advanced === true;

            // TODO: Strict limit check (if msgLimit > 0 && currentUsage >= msgLimit) throw new Error("Limit Reached");

            // 3. Prepare System Prompt (Using PromptManager)
            const tenantSettings = tenant.settings || {};
            const kbConfig = tenantSettings.knowledge_base || {};
            const aiConfig = tenantSettings.ai_config || {};

            const storeInfo = {
                name: tenant.store_name,
                domain: tenant.store_domain,
                shipping_policy: kbConfig.shipping_policy,
                return_policy: kbConfig.return_policy,
                custom_instructions: kbConfig.custom_text
            };

            const config = {
                bot_name: aiConfig.bot_name || 'مبهر',
                bot_tone: aiConfig.bot_tone || 'friendly',
                custom_instructions: aiConfig.custom_instructions
            };

            const systemPrompt = PromptManager.buildSalesAgentPrompt(storeInfo, config);

            // 4. Transform Previous Messages to OpenAI Format
            const history = previousMessages.map(msg => ({
                role: msg.fromMe ? 'assistant' : 'user', // Adjust based on your message model (fromMe/author)
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
                model: isAdvancedAI ? "gpt-4o" : "gpt-4o-mini", // النمو/الشركات → GPT-4o | الأساسية → GPT-4o Mini
                messages: [
                    { role: "system", content: systemPrompt },
                    ...history.slice(-5) // Keep last 5 turns for context (optimization)
                ],
                max_tokens: 200,
                temperature: 0.7,
            });

            const aiReply = completion.choices[0].message.content;

            // 6. Increment Usage Counter
            await this.incrementAIUsage(tenantId);

            return aiReply;

        } catch (error) {
            console.error("❌ AI Service Error:", error.message);
            return this.mockResponse(userMessage, "المتجر");
        }
    }

    async generateOrderNotification(tenantId, customerName, orderId, orderTotal) {
        try {
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
                model: "gpt-3.5-turbo",
                messages: [{ role: "system", content: systemPrompt }],
                max_tokens: 100,
                temperature: 0.7,
            });

            return completion.choices[0].message.content;
        } catch (e) {
            console.error("AI Order Msg Error:", e.message);
            return `أهلاً ${customerName}، تم استلام طلبك #${orderId} بقيمة ${orderTotal}. شكراً لتسوقك معنا! 📦`;
        }
    }

    async generateCartRecovery(tenantId, customerName, cartTotal, cartItems = []) {
        try {
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

            return completion.choices[0].message.content;

        } catch (e) {
            console.error("AI Cart Recovery Error:", e.message);
            return `أهلاً ${customerName} 👋\nسلّتك الغالية تنتظرك! 🛒\nقيمة الطلب: ${cartTotal}\nكمل طلبك الآن قبل يروح عليك! 🏃‍♂️`;
        }
    }

    async generateReviewRequest(tenantId, customerName, orderId, orderTotal) {
        try {
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

            return completion.choices[0].message.content;

        } catch (e) {
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
}

module.exports = new AIService();
