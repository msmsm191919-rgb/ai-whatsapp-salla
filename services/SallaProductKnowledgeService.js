const SallaDatabase = require('../database/db_instance');
const SallaService = require('./SallaService');
const axios = require('axios');

const STOP_WORDS = new Set([
    'كم', 'بكم', 'سعر', 'الاسعار', 'الأسعار', 'اسعار', 'أسعار', 'سعرها', 'سعره',
    'عندكم', 'عند الجيران', 'توفر', 'متوفر', 'موجود', 'ابحث', 'أبحث', 
    'ابي', 'أبي', 'ابغى', 'أبغى', 'شراء', 'طلب', 'منتج', 'اسم', 'اسمه',
    'رابط', 'موقع', 'متجر', 'الرابط', 'الموقع', 'المتجر', 'توصيل', 'شحن', 
    'شحنة', 'توصيلها', 'استرجاع', 'استبدال', 'الاسترجاع', 'الاستبدال', 
    'سياسة', 'السياسة', 'الضمان', 'ضمان', 'هو', 'هي', 'هم', 'انا', 'أنت', 
    'انت', 'نحن', 'xyz', 'جزيلا', 'جزيلاً', 'شكرا', 'شكراً', 'مشكور', 'تسلم',
    'يسلمو', 'مرحبا', 'هلا', 'اهلاً', 'اهلا'
]);


class SallaProductKnowledgeService {
    
    stripHtml(html) {
        if (!html) return '';
        return html.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
    }

    hasProductIntent(messageText) {
        if (!messageText) return false;
        const lower = messageText.toLowerCase().trim();

        // 1. Direct negative keywords/phrases (service, shipping, returns, support, greetings)
        const negativeKeywords = [
            'مدة الشحن', 'مده الشحن', 'متى يوصل', 'متى التوصيل', 'وقت التوصيل', 'توصيل الشحنة',
            'سياسة الاسترجاع', 'سياسة الاستبدال', 'شروط الاسترجاع', 'شروط الاستبدال',
            'سياسه الاسترجاع', 'سياسه الاستبدال', 'طريقة الاسترجاع',
            'هل يوجد ضمان', 'فيه ضمان', 'وش الضمان', 'ايش الضمان', 'ضمان', 'الضمان',
            'كيف اطلب', 'كيف أطلب', 'طريقة الطلب', 'طريقه الطلب', 'كيفية الطلب',
            'فين موقعكم', 'فين موقع', 'عنوانكم', 'اين موقعكم', 'أين موقعكم', 'موقع المتجر', 'مكانكم',
            'السلام عليكم', 'عليكم السلام', 'مساء الخير', 'صباح الخير', 'شكرا', 'شكراً', 'مشكور',
            'مرحبا', 'مرحباً', 'هلا', 'اهلا', 'اهلاً', 'هلو',
            'موظف', 'بشري', 'مسؤول', 'مسؤل', 'الدعم', 'الفني', 'مشكلة', 'مشكله', 'تواصل', 'كلمني',
            'ما فهمت', 'ما فهمتني', 'يا بوت', 'البوت', 'الروبوت',
            'كيف حالك', 'شلونك', 'شخبارك', 'اخبارك', 'وين طلبي', 'طلبي', 'شحنتي', 'تتبع'
        ];

        if (negativeKeywords.some(keyword => lower.includes(keyword))) {
            return false;
        }

        // 2. Positive intent triggers
        const positiveTriggers = [
            'سعر', 'بكم', 'كم', 'عندكم', 'توفر', 'متوفر', 'موجود', 'ابي', 'أبي', 'ابغى', 'أبغى', 'ابحث', 'أبحث'
        ];

        const hasPositiveTrigger = positiveTriggers.some(trigger => lower.includes(trigger));

        // 3. Extract keyword (cleaned and Al-stripped)
        const keyword = this.extractKeyword(messageText);
        const hasKeyword = keyword && keyword.trim().length > 2;

        // Trigger only if there's a positive trigger AND a keyword
        if (hasPositiveTrigger && hasKeyword) {
            return true;
        }

        return false;
    }

    extractKeyword(messageText) {
        if (!messageText) return '';
        const cleanMsg = messageText
            .replace(/[؟!.,،()_#\-*\/\\+]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
        
        const words = cleanMsg.split(' ');
        const filtered = words.map(word => {
            let cleanWord = word.trim();
            if (cleanWord.startsWith('ال') && cleanWord.length > 4) {
                cleanWord = cleanWord.slice(2);
            }
            return cleanWord;
        }).filter(word => {
            return word.length > 2 && !STOP_WORDS.has(word);
        });

        return filtered.join(' ');
    }

    async checkProductsReadPermission(tenantId) {
        try {
            const db = SallaDatabase.connection;
            if (!db) return false;

            const oauth = await db.models.SallaOAuth.findOne({ where: { tenant_id: tenantId } });
            if (!oauth || !oauth.access_token) return false;

            let meta = oauth.meta || {};
            let scope = meta.scope;

            if (!scope) {
                // Fetch scopes from user/info
                try {
                    let accessToken = oauth.access_token;
                    let profile;
                    try {
                        const response = await axios.get('https://accounts.salla.sa/oauth2/user/info', {
                            headers: { 'Authorization': `Bearer ${accessToken}` },
                            timeout: 5000
                        });
                        profile = response.data?.data;
                    } catch (err) {
                        if (err.response && err.response.status === 401) {
                            console.log(`[SallaProductKnowledgeService] Token expired, refreshing for tenant ${tenantId}...`);
                            const newToken = await SallaService.refreshToken(tenantId);
                            if (newToken) {
                                const response = await axios.get('https://accounts.salla.sa/oauth2/user/info', {
                                    headers: { 'Authorization': `Bearer ${newToken}` },
                                    timeout: 5000
                                });
                                profile = response.data?.data;
                            }
                        } else {
                            throw err;
                        }
                    }

                    const userScope = profile?.context?.scope;
                    if (userScope) {
                        scope = userScope;
                        meta.scope = userScope;
                        oauth.meta = meta;
                        oauth.changed('meta', true);
                        await oauth.save();
                    }
                } catch (e) {
                    console.error(`[SallaProductKnowledgeService] Failed to fetch scopes from user/info for tenant ${tenantId}:`, e.message);
                }
            }

            if (!scope) {
                console.log(`[ProductKnowledge] products scope missing for tenant ${tenantId}`);
                return false;
            }

            const scopesList = scope.split(' ');
            const hasScope = scopesList.includes('products.read') || scopesList.includes('products.read_write');
            if (!hasScope) {
                console.log(`[ProductKnowledge] products scope missing for tenant ${tenantId}`);
            }
            return hasScope;
        } catch (e) {
            console.error(`[SallaProductKnowledgeService] checkPermission error:`, e.message);
            return false;
        }
    }

    async searchRelevantProducts(tenantId, userMessage) {
        try {
            // 1. Intent validation to prevent calling Salla API on general messages
            if (!this.hasProductIntent(userMessage)) {
                return [];
            }

            // 2. Check permission first
            const hasPermission = await this.checkProductsReadPermission(tenantId);
            if (!hasPermission) {
                return [];
            }

            // 3. Extract keyword
            const keyword = this.extractKeyword(userMessage);
            if (!keyword) {
                return [];
            }

            console.log(`[SallaProductKnowledgeService] Searching products for tenant ${tenantId} with keyword: "${keyword}"`);

            // 4. Request Salla Products API (format=light, max 5 products)
            const response = await SallaService.request(
                tenantId, 
                'GET', 
                `products?format=light&per_page=5&keyword=${encodeURIComponent(keyword)}`
            );

            const products = response.data?.data || [];
            
            // 5. Format products list
            return products.slice(0, 5).map(p => {
                const priceObj = p.prices?.price || p.price;
                const salePriceObj = p.prices?.sale_price || p.sale_price;
                const originalPrice = priceObj?.amount || priceObj || 0;
                const salePrice = salePriceObj?.amount || salePriceObj || 0;
                const currency = priceObj?.currency || p.currency || 'SAR';

                let priceText = `${originalPrice} ${currency}`;
                if (salePrice && salePrice < originalPrice) {
                    priceText = `${salePrice} ${currency} (خصم من ${originalPrice} ${currency})`;
                }

                let availableText = 'متوفر';
                if (p.is_available === false || p.status === 'out') {
                    availableText = 'غير متوفر';
                }

                const url = p.url || p.urls?.url || p.urls?.customer || '';

                return {
                    name: p.name,
                    price: priceText,
                    available: availableText,
                    url: url,
                    description: this.stripHtml(p.description || p.short_description || '').slice(0, 200)
                };
            });

        } catch (e) {
            console.error(`[ProductKnowledge] Salla API search failed for tenant ${tenantId}:`, e.message);
            return []; // Fail gracefully, don't break AI response
        }
    }
}

module.exports = new SallaProductKnowledgeService();
