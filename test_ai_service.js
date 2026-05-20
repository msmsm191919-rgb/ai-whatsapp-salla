const { generateChatResponse } = require('./aiService');
require('dotenv').config();

async function test() {
    console.log("🧪 Testing AI Service...");

    if (!process.env.OPENAI_API_KEY) {
        console.warn("⚠️ No OPENAI_API_KEY found in environment variables.");
    } else {
        console.log("✅ OPENAI_API_KEY found.");
    }

    const input = "كيف أقدر اتتبع طلبي؟";
    console.log(`🗣️ User Input: "${input}"`);

    const response = await generateChatResponse(input);
    console.log(`🤖 AI Response: "${response}"`);

    if (response.includes("وضع المحاكاة")) {
        console.log("ℹ️ Result: Mock Mode (No API Key or Fallback)");
    } else if (response.includes("خطأ من OpenAI")) {
        console.log("❌ Result: API Error");
    } else {
        console.log("✅ Result: Success (AI Generated)");
    }
}

test();
