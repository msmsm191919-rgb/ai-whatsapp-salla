const fs = require('fs');
const path = require('path');

/**
 * محاكي خدمة الواتساب
 * يقوم بتسجيل الرسائل في ملف بدلاً من إرسالها فعلياً (لأغراض التطوير)
 */
async function sendWhatsAppMessage(phone, message) {
    const logFile = path.join(__dirname, 'whatsapp_log.txt');
    const timestamp = new Date().toISOString();

    // تنسيق الرسالة
    const logEntry = `
[${timestamp}]
To: ${phone}
Message: "${message}"
--------------------------------------------------
`;

    // حفظ في الملف
    fs.appendFileSync(logFile, logEntry);

    console.log(`\n💬 [WhatsApp Mock] Message sent to ${phone}`);
    console.log(`📝 Content: ${message.substring(0, 50)}...`);
    return true;
}

module.exports = { sendWhatsAppMessage };
