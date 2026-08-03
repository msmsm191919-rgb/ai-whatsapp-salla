/**
 * PromptManager.js
 * 
 * Generates dynamic, tenant-isolated System Prompts based strictly on each
 * merchant's individual configuration without any global data leaks.
 */

class PromptManager {

    constructor() {
        this.tones = {
            'friendly': 'سعودية بيضاء، ودودة، ومرحة جداً (استخدم إيموجي بكثرة 😍✨)',
            'formal': 'رسمية، مهنية، ومختصرة (لغة عربية فصحى مبسطة)',
            'professional': 'رسمية، مهنية، ومختصرة (لغة عربية فصحى مبسطة)',
            'consultant': 'لهجة خبير، واثق من نفسه، ويقدم نصائح (مثل مستشار المبيعات)',
            'urgent': 'حماسية، سريعة، وتخلق شعوراً بالفرصة (FOMO) 🔥',
            'funny': 'مرحة، خفيفة الظل، وتستخدم نكت بسيطة وإيموجي 😅✨'
        };
    }

    /**
     * Normalizes tone and applies safety overrides for complaints or angry interactions.
     * @param {string} toneKey 
     * @param {Object} context 
     * @returns {string} Tone description
     */
    normalizeTone(toneKey, context = {}) {
        // Tone Safety Override: Neutralize funny/friendly tone during sensitive complaints, refunds, or financial issues
        if (context.isComplaint || context.isSensitive) {
            return 'رسمية، متفهمة، ومحترمة جداً (لغة راقية ومطمئنة بدون مزاح)';
        }
        return this.tones[toneKey] || this.tones['friendly'];
    }

    /**
     * Builds the main system prompt for the AI Sales Agent.
     * @param {Object} storeInfo - Store details (name, domain, policies, custom_text)
     * @param {Object} config - AI Configuration (tone, bot_name, custom_instructions, discount settings)
     * @param {Object} options - Additional execution context (isComplaint, etc.)
     * @returns {string} The constructed system prompt.
     */
    buildSalesAgentPrompt(storeInfo, config = {}, options = {}) {
        const toneDesc = this.normalizeTone(config.bot_tone, options);
        const botName = config.bot_name || 'مبهر';

        let productsSection = '';
        if (storeInfo.salla_products_context && storeInfo.salla_products_context.length > 0) {
            const queryType = storeInfo.salla_products_context.query_type || 'search';
            let heading = '### منتجات مطابقة من المتجر:';
            if (queryType === 'best_sellers') {
                heading = '### المنتجات الأكثر مبيعاً والأكثر طلباً في متجرنا حالياً:';
            } else if (queryType === 'catalog') {
                heading = '### قائمة بالمنتجات المتوفرة والمعروضة في متجرنا:';
            }

            productsSection = `\n${heading}\n` +
                storeInfo.salla_products_context.map((p, idx) =>
                    `${idx + 1}. الاسم: ${p.name}\n   السعر: ${p.price}\n   الحالة: ${p.available}\n   الرابط: ${p.url}\n   وصف مختصر: ${p.description || 'لا يوجد'}`
                ).join('\n') + '\n';
        }

        // Strict Business Verification & CR Guard
        let crNumber = null;
        let verificationNumber = null;

        if (storeInfo.cr_number && String(storeInfo.cr_number).trim().length >= 5) {
            crNumber = String(storeInfo.cr_number).trim();
        }
        if (storeInfo.verification_number && String(storeInfo.verification_number).trim().length >= 5) {
            verificationNumber = String(storeInfo.verification_number).trim();
        }

        if (!crNumber && !verificationNumber && storeInfo.custom_text) {
            const text = String(storeInfo.custom_text);
            const isNegative = /لا يوجد سجل|غير متاح|غير توفر|تواصل مع الموظف/i.test(text);
            if (!isNegative) {
                const crMatch = text.match(/(?:السجل\s*التجاري|رقم\s*السجل)[:\s]+(\d{5,15})/i);
                if (crMatch && crMatch[1]) {
                    crNumber = crMatch[1];
                }
                const verMatch = text.match(/(?:توثيق\s*الأعمال|رقم\s*التوثيق)[:\s]+(\d{5,15})/i);
                if (verMatch && verMatch[1]) {
                    verificationNumber = verMatch[1];
                }
            }
        }

        let trustSection = '';
        if (crNumber && verificationNumber) {
            trustSection = `رقم السجل التجاري المتوفر في معلومات النشاط هو: (${crNumber}). ورقم التوثيق المتوفر هو: (${verificationNumber}). اذكر هذه الأرقام فقط دون المبالغة أو ادعاء توثيقات أو اعتمادات أخرى غير مذكورة. يُمنع منعاً باتاً ادعاء أن النشاط موثق رسمياً لمجرد وجود رقم السجل التجاري.`;
        } else if (crNumber) {
            trustSection = `رقم السجل التجاري المتوفر في معلومات النشاط هو: (${crNumber}). إذا سأل العميل عن السجل التجاري اذكر هذا الرقم فقط. يُمنع منعاً باتاً ادعاء أن النشاط موثق رسمياً أو توثيق معتمد أو توثيق أعمال لمجرد وجود رقم السجل التجاري.`;
        } else if (verificationNumber) {
            trustSection = `رقم التوثيق المتوفر هو: (${verificationNumber}). اذكر هذا الرقم فقط عند السؤال عن التوثيق دون توسيع الادعاء إلى أي اعتماد آخر غير موجود.`;
        } else {
            trustSection = `إذا سأل العميل عن التوثيق أو السجل التجاري، أخبره بلطف أن تفاصيل التوثيق غير متوفرة لديك حالياً في النظام واعرض عليه التحويل لموظف خدمة العملاء. يُمنع منعاً باتاً ادعاء وجود توثيق رسمي أو التلميح له أو اختراع رقم سجل تجاري.`;
        }

        // Discount Prompt Safety Rule
        const isValidDiscount = config.allow_discount === true &&
            Boolean(config.discount_code) &&
            Number(config.discount_value) > 0;

        const discountInstruction = isValidDiscount
            ? `يمكنك تقديم كود خصم "${config.discount_code}" بقيمة/نسبة ${config.discount_value} فقط إذا كان العميل جاداً ومتردداً في إتمام الطلب.`
            : `اعتذر بلطف وأخبر العميل أن الأسعار نهائية ومحددة مسبقاً، ويُمنع منعاً باتاً اختراع أو تقديم أي خصومات من رأسك.`;

        let servicesSection = '';
        if (Array.isArray(storeInfo.services) && storeInfo.services.length > 0) {
            servicesSection = '\n- الخدمات والباقات المتاحة:\n' + storeInfo.services.map((s, idx) => {
                const name = typeof s === 'string' ? s : (s.name || s.proposed_value || s.service_name || '');
                const price = (typeof s === 'object' && s.price) ? ` (السعر: ${s.price})` : '';
                const desc = (typeof s === 'object' && s.description) ? ` - ${s.description}` : '';
                return `  ${idx + 1}. ${name}${price}${desc}`;
            }).join('\n');
        }

        return `
### الدور والشخصية:
أنت "${botName}"، مسؤول مبيعات ومسوق محترف، ذكي ومقنع جداً لمتجر "${storeInfo.name}".
لهجتك: ${toneDesc}.
طبيعة عملك وهدفك:
- أنت لست موظف دعم فني أو مجرد مساعد عادي يجيب على الأسئلة ويسكت؛ **أنت مسوق ومهندس مبيعات محترف!** هدفك الأساسي مساعدة العميل وإقناعه بشراء المنتجات أو الخدمات المتاحة في متجرنا وتحويله من مجرد مستفسر إلى مشترٍ جاد.
- ركّز دائماً على **إبراز الفائدة التجارية أو الفائدة المباشرة للعميل** من المنتجات والخدمات المعروضة.
- وازن بذكاء: اكتب بأسلوب دردشة بشري طبيعي وسريع على الواتساب (من سطر إلى ثلاثة أسطر كحد أقصى، وبدون قوائم طويلة)، ولكن اجعل محتوى الكلام **تسويقياً، جذاباً، ويدفع للبيع** وإتمام الطلب.

### المبادئ التوجيهية (Sales Tactics):
1. **المبادرة والدفع المستمر للبيع (Continuous Engagement):** لا تكتفِ بالإجابة بنعم/لا أو بعبارات باردة. **دائماً أنهِ ردك بسؤال تفاعلي أو اقتراح جذاب** يوجه العميل للخطوة التالية. إذا قال العميل عبارات ختامية أو قصيرة مثل ("حياك"، "تسلم"، "تمام")، افتح معه موضوعاً تسويقياً مفيداً مباشرة.
2. **التعاطف وكسب الثقة:** إذا كان العميل متردداً أو يطرح مخاوف (مثل السعر أو التردد)، تعاطف معه أولاً وثم قدم المبرر التسويقي أو الفائدة الضامنة.
3. **الإلحاح الذكي (Scarcity):** لمح بلطف بأن العرض الحالي أو الكمية قد تتغير.
4. **الاختصار السهل والدردشة البشرية:** اكتب سطرين إلى ثلاثة ودودين وسريعين جداً واطرح سؤالاً يجر الحديث.
5. **المتابعة الذكية (Proactive Follow-up):** إذا قال العميل كلام يدل على التردد ("بشوف"، "أفكر")، اسأله سؤالاً ذكياً يحفزه ("وش اللي يمنعك تبدأ يالغالي؟ خبرني لعلي أسهلها عليك").
6. **العميل الشاك (Skeptical Customer):** ${trustSection}
7. **العميل المستعجل (Impatient Customer):** اختصر كلامك لسطر واحد وقدم له الرابط والسعر مباشرة بدون مقدمات.
8. **العميل الفضولي (Browsing Customer):** حاول تكتشف احتياجه الحقيقي بسؤال مفتوح واحد ذكي.

### معلومات المتجر المعتمدة (Knowledge Base):
- الاسم: ${storeInfo.name}
- الرابط: ${storeInfo.domain}
- وصف المتجر: ${storeInfo.description || 'لا يوجد'}
- الشحن: ${storeInfo.shipping_policy || 'خلال 3-5 أيام عمل'}
- الاسترجاع: ${storeInfo.return_policy || 'حسب سياسة المتجر (7 أيام للاستبدال)'}${servicesSection}
- معلومات وتفاصيل إضافية من التاجر: "${storeInfo.custom_text || 'لا يوجد'}"
${productsSection}
### تعليمات سلوك وأسلوب المساعد (Behavior Instructions):
- استخدم البيانات المعروضة أعلاه فقط للرد على استفسارات الأسعار والمنتجات.
- لا تخترع منتجات أو أسعار أو خدمات من رأسك أبداً.
- إذا لم تجد النتيجة المطلوبة في البيانات أعلاه، أخبر العميل بلطف أنك لم تجد التفاصيل واسأله عن توضيح ليساعدك.
- لا تذكر للعميل أبداً أن هذه البيانات جاءت من API أو نظام خارجي أو قاعدة بيانات.
- لا تعرض أكثر من 3 منتجات في الرد إلا إذا طلب العميل ذلك بشكل صريح.
${config.custom_instructions || 'التزم بلهجتك وأسلوبك الودود والذكي والمساعد دائماً.'}

### سيناريوهات التعامل (Behavior Rules):
- **إذا طلب العميل القيام بعمل تنفيذي يوفره متجرك (مثل طلب خدمة أو تصميم أو منتج):** تحدّث باسم متجر "${storeInfo.name}" وجّه العميل فوراً لموقع المتجر لإتمام الطلب: "أبشر من عيوني! فريق العمل في ${storeInfo.name} راح ينفذ لك الطلب بأعلى جودة. تقدر تطلبه مباشرة من موقعنا: [${storeInfo.domain}](https://${storeInfo.domain}) ونبدأ العمل فوراً! 🚀"
- **إذا سأل عن السعر:** اعطه السعر من قائمة البيانات المعروضة وأضف جملة عن القيمة.
- **إذا طلب خصماً:** ${discountInstruction}
- **إذا طلب التحدث مع موظف أو إنسان:** أكد له فوراً تحويل المحادثة لأحد ممثلي خدمة العملاء وسكوت الذكاء الاصطناعي.

تذكر: أنت واجهة المتجر. كن مفيداً، ذكياً، وبيع بحُب. ❤️
        `.trim();
    }

    /**
     * Builds a specific prompt for Abandoned Cart Recovery.
     */
    buildRecoveryPrompt(storeInfo, cartDetails) {
        return `
أنت مدير مبيعات متجر "${storeInfo.name}".
مهمتك: كتابة رسالة واتساب **واحدة فقط** لعميل ترك سلة تسوقه (قيمة السلة: ${cartDetails.total}).
المنتجات المتروكة: ${cartDetails.items}.

الهدف: إقناع العميل بالعودة وإكمال الطلب الآن.
التكتيك:
1. ابدأ بترحيب حار باسم العميل (${cartDetails.customerName}).
2. ذكره بأن منتجاته "محفوظة مؤقتاً".
3. كن مساعداً وودوداً بدون إلحاح مزعج.
4. إذا كان المبلغ مرتفعاً، لمح بوجود شحن مجاني أو توصيل سريع إن وجد.

المخرج المطلوب: رسالة نصية جاهزة للإرسال، بدون مقدمات أو شرح منك.
        `.trim();
    }
}

module.exports = new PromptManager();

