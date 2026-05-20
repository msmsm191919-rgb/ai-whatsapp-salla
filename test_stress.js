const { Client, LocalAuth } = require('whatsapp-web.js');

const targetNumber = "966501577963";
const chatId = targetNumber + "@c.us";

const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: { args: ['--no-sandbox'], headless: true }
});

client.on('ready', async () => {
    console.log('✅ Connected for Stress Test!');

    // 1. رسالة ترحيبية
    console.log("➡️ Sending Message 1...");
    await client.sendMessage(chatId, "👋 هلا! هذه تجربة رقم 1 من سيرفرك الخاص.");

    // انتظار 2 ثانية
    await new Promise(r => setTimeout(r, 2000));

    // 2. رسالة طلب (محاكاة)
    console.log("➡️ Sending Message 2...");
    await client.sendMessage(chatId, "📦 *تحديث طلب:* طلبك #999 تم شحنه! 🚚\nتوقع وصوله غداً.");

    // انتظار 2 ثانية
    await new Promise(r => setTimeout(r, 2000));

    // 3. رسالة طويلة وعروض
    console.log("➡️ Sending Message 3...");
    const longMsg = `🌟 *عرض خاص لك يا غالي!* 🌟
    
شكراً لكونك عميل مميز لدينا.
استخدم كود الخصم: *SPECIAL20*
للحصول على خصم 20% على طلبك القادم.
    
رابط المتجر: https://salla.sa/your-store
    `;
    await client.sendMessage(chatId, longMsg);

    console.log("✅ All messages sent!");
    setTimeout(() => { process.exit(0); }, 3000);
});

client.initialize();
