// services/StorefrontCrawler.js
const axios = require('axios');
const SallaDatabase = require('../database/db_instance');

class StorefrontCrawler {
    
    cleanHtml(html) {
        if (!html) return '';
        // Extract main content or body if possible to exclude headers/footers
        const contentMatch = html.match(/<main[^>]*>([\s\S]*?)<\/main>/i) || 
                             html.match(/<article[^>]*>([\s\S]*?)<\/article>/i) || 
                             html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
        const content = contentMatch ? contentMatch[1] : html;

        let text = content
            .replace(/<script[^>]*>([\s\S]*?)<\/script>/gi, '')
            .replace(/<style[^>]*>([\s\S]*?)<\/style>/gi, '')
            .replace(/<[^>]*>/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
        return text.slice(0, 800); // Limit each policy to 800 characters
    }

    async crawlStorefront(tenantId) {
        try {
            const db = SallaDatabase.connection;
            if (!db) return;

            const tenant = await db.models.Tenant.findByPk(tenantId);
            if (!tenant) return;

            const settings = tenant.settings || {};
            const crawled = settings.crawled_policies || {};
            const lastCrawl = crawled.last_crawl_at;

            // Check if crawled in the last 24 hours
            if (lastCrawl) {
                const hoursPassed = (Date.now() - new Date(lastCrawl).getTime()) / (1000 * 60 * 60);
                if (hoursPassed < 24) {
                    console.log(`[StorefrontCrawler] Skipping crawl for tenant ${tenantId}. Last crawled ${hoursPassed.toFixed(1)} hours ago.`);
                    return;
                }
            }

            let domain = tenant.store_domain || '';
            if (!domain) return;
            if (!domain.startsWith('http')) {
                domain = 'https://' + domain;
            }
            domain = domain.replace(/\/$/, ''); // Normalize trailing slash

            console.log(`[StorefrontCrawler] Starting background crawl for tenant ${tenantId} at: ${domain}`);

            const pagesToCrawl = [
                { key: 'about_us', path: 'من-نحن' },
                { key: 'return_policy', path: 'سياسة-الاستبدال-والاسترجاع' },
                { key: 'shipping_policy', path: 'سياسة-الشحن-والتوصيل' }
            ];

            const updatedPolicies = { ...crawled };
            let hasChanges = false;

            for (const page of pagesToCrawl) {
                const url = `${domain}/${encodeURIComponent(page.path)}`;
                try {
                    console.log(`[StorefrontCrawler] Fetching page: ${url}`);
                    const response = await axios.get(url, {
                        headers: {
                            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
                        },
                        timeout: 5000
                    });

                    if (response.status === 200 && response.data) {
                        const cleanText = this.cleanHtml(response.data);
                        if (cleanText) {
                            updatedPolicies[page.key] = {
                                content: cleanText,
                                crawled_at: new Date().toISOString()
                            };
                            hasChanges = true;
                        }
                    }
                } catch (err) {
                    // Log gracefully and continue - do not block the thread or throw errors
                    console.warn(`[StorefrontCrawler] Crawl failed for page "${page.path}" (Tenant ${tenantId}): ${err.message}`);
                }
            }

            // Always update last crawl timestamp to enforce 24-hour rate limit even if crawls fail
            updatedPolicies.last_crawl_at = new Date().toISOString();
            settings.crawled_policies = updatedPolicies;
            tenant.settings = settings;
            tenant.changed('settings', true);
            await tenant.save();

            console.log(`[StorefrontCrawler] Finished crawl for tenant ${tenantId}.`);

        } catch (e) {
            console.error(`[StorefrontCrawler] Crawl error for tenant ${tenantId}:`, e.message);
        }
    }
}

module.exports = new StorefrontCrawler();
