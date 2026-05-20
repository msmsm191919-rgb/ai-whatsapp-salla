const { Client, LocalAuth } = require('whatsapp-web.js');

console.log("🔄 Reading Last Chats...");

const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: { args: ['--no-sandbox'], headless: true }
});

client.on('ready', async () => {
    console.log('✅ Connected!');

    // احصل على آخر 5 محادثات
    const chats = await client.getChats();
    console.log(`📂 Found ${chats.length} chats.`);

    if (chats.length > 0) {
        const lastChat = chats[0]; // آخر محادثة نشطة
        console.log(`📩 Sending test to: ${lastChat.name} (${lastChat.id._serialized})`);

        await lastChat.sendMessage("🔔 تجربة بوت سلة: هل وصلتك هذه الرسالة؟");
        console.log("✅ Sent!");
    } else {
        console.log("❌ No chats found!");
    }

    setTimeout(() => { process.exit(0); }, 3000);
});

client.initialize();
