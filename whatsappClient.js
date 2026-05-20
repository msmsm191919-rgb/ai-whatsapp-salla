const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode');

let whatsappClient;
let savedQR = '';
let clientStatus = 'disconnected';
let ioInstance; // لتخزين الكائن socket

function initializeWhatsApp(io) {
    ioInstance = io; // حفظ النسخة لاستخدامها لاحقاً
    console.log('🔄 Initializing WhatsApp Client...');

    whatsappClient = new Client({
        authStrategy: new LocalAuth(),
        puppeteer: {
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-accelerated-2d-canvas',
                '--no-first-run',
                '--no-zygote',
                '--disable-gpu'
            ],
            headless: true
        }
    });

    // 1. عند استلام QR Code
    whatsappClient.on('qr', (qr) => {
        console.log('📱 QR RECEIVED. Scan it from Dashboard.');
        // تحويل الكود لصورة Base64 لعرضها في المتصفح
        qrcode.toDataURL(qr, (err, url) => {
            savedQR = url;
            clientStatus = 'qr_ready';
            // إرسال الكود للداشبورد (عبر Socket.io)
            if (io) io.emit('qr_code', url);
        });
    });

    // 2. عند نجاح الاتصال
    whatsappClient.on('ready', () => {
        console.log('✅ WhatsApp Client is Ready!');
        clientStatus = 'ready';
        savedQR = ''; // لا حاجة للكود بعد الآن
        if (io) {
            io.emit('status', 'ready');
            io.emit('log', { time: new Date().toLocaleTimeString('ar-SA'), event: '✅ تم الاتصال بالواتساب', customer: 'النظام', status: 'نجاح' });
        }
    });

    // 3. عند المصادقة
    whatsappClient.on('authenticated', () => {
        console.log('🔑 WhatsApp Authenticated');
        clientStatus = 'authenticated';
        if (io) io.emit('status', 'authenticated');
    });

    // 4. عند فشل الاتصال
    const { generateChatResponse } = require('./aiService');

    // ... (rest of code)

    whatsappClient.on('auth_failure', msg => {
        console.error('❌ AUTHENTICATION FAILURE', msg);
        clientStatus = 'error';
    });

    // 📩 الاستماع للرسائل الواردة (الرد الآلي)
    whatsappClient.on('message', async msg => {
        console.log('📩 New Message received:', msg.body);

        // تجاهل رسائل المجموعات أو الحالة
        if (msg.from.includes('@g.us') || msg.from.includes('status')) return;

        // الحصول على رد من الـ AI
        const reply = await generateChatResponse(msg.body);

        // محاكاة الكتابة (Typing...)
        const chat = await msg.getChat();
        chat.sendStateTyping();

        // تأخير بسيط ليبدو طبيعياً
        setTimeout(async () => {
            await msg.reply(reply); // الرد على الرسالة

            // تسجيل في الداشبورد
            if (ioInstance) {
                ioInstance.emit('log', {
                    time: new Date().toLocaleTimeString('ar-SA'),
                    event: '💬 رد تلقائي على العميل',
                    customer: msg.from.replace('@c.us', ''),
                    status: 'تم الرد'
                });
            }
        }, 1500);
    });

    whatsappClient.initialize();
}

// دالة إرسال الرسائل الحقيقية
async function sendRealWhatsAppMessage(phone, message) {
    if (clientStatus !== 'ready' && clientStatus !== 'authenticated') {
        console.log('⚠️ WhatsApp not ready. Message queued or skipped.');
        return false;
    }

    try {
        // تنظيف الرقم من أي رموز (+ أو مسافات)
        let cleanNumber = phone.replace(/\D/g, '');

        // واتساب يقبل الأرقام بدون أصفار في البداية (مثل 050 -> 96650)
        // إذا كان الرقم يبدأ بـ 05، استبدل الـ 0 بـ 966 (للسعودية) - اختياري
        if (cleanNumber.startsWith('05')) {
            cleanNumber = '966' + cleanNumber.substring(1);
        }

        const chatId = cleanNumber + "@c.us";

        await whatsappClient.sendMessage(chatId, message);
        console.log(`📨 Message sent to ${chatId} `);

        // 📊 تحديث الداشبورد فوراً
        if (ioInstance) {
            ioInstance.emit('new_message_count'); // زيادة العداد
            ioInstance.emit('log', {
                time: new Date().toLocaleTimeString('ar-SA'),
                event: '📤 رسالة طلب جديد',
                customer: phone,
                status: 'تم الإرسال'
            });
        }

        return true;
    } catch (error) {
        console.error('❌ Failed to send message:', error);
        return false;
    }
}

// تصدير
module.exports = {
    initializeWhatsApp,
    sendRealWhatsAppMessage,
    getStatus: () => clientStatus,
    getQR: () => savedQR
};
