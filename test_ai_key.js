require('dotenv').config();
const OpenAI = require('openai');

const apiKey = process.env.OPENAI_API_KEY;
console.log("🔑 API Key Length:", apiKey ? apiKey.length : "Missing");

async function test() {
    try {
        if (!apiKey) throw new Error("No API Key");

        console.log("🔄 Testing OpenAI Connection...");
        const openai = new OpenAI({ apiKey });

        const completion = await openai.chat.completions.create({
            model: "gpt-3.5-turbo",
            messages: [{ role: "user", content: "Say Hello" }],
        });

        console.log("✅ Success:", completion.choices[0].message.content);
    } catch (e) {
        console.error("❌ Connection Failed:", e.message);
        if (e.response) {
            console.error("Data:", e.response.data);
        }
    }
}

test();
