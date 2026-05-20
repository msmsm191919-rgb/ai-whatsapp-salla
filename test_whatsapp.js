const { Client, LocalAuth } = require('whatsapp-web.js');

console.log("🔄 Starting Direct WhatsApp Test...");

const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
        headless: true
    }
});

client.on('ready', async () => {
    console.log('✅ Client is ready!');

    // رقمك (تم تعديله بناءً على ما زودتني به)
    const number = "966501577963";
    const chatId = number + "@c.us";
    const text = "🔔 تجربة رسالة مباشرة من النظام";

    console.log(`🔍 Checking if ${chatId} is registered...`);

    try {
        const isRegistered = await client.getNumberId(chatId);

        if (!isRegistered) {
            console.error("❌ ERROR: This number is NOT registered on WhatsApp.");
        } else {
            console.log("✅ Number found:", isRegistered._serialized);
            await client.sendMessage(isRegistered._serialized, text);
            console.log("✅ Message Sent Successfully!");
        }

    } catch (err) {
        console.error("❌ Failed to send:", err);
    }

    // الانتظار قليلاً ثم الإغلاق
    setTimeout(() => {
        console.log("👋 Closing...");
        client.destroy();
        process.exit(0);
    }, 3000);
});

client.on('qr', (qr) => {
    console.log('⚠️ QR Code received! This means you are NOT logged in.');
    console.log('Please scan the QR in the Dashboard first.');
    process.exit(1);
});

client.initialize();
