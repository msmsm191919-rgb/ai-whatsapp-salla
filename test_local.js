const http = require('http');

const data = JSON.stringify({
    test: true,
    event: "manual_test",
    merchant: "123"
});

const options = {
    hostname: 'localhost',
    port: 8082,
    path: '/webhook',
    method: 'POST',
    headers: {
        'Content-Type': 'application/json',
        'Content-Length': data.length,
        // 'Authorization': 'Bearer TEST_TOKEN' // Optional for test
    }
};

console.log("⏳ Sending local webhook test...");

const req = http.request(options, (res) => {
    console.log(`✅ Response Status: ${res.statusCode}`);
    res.setEncoding('utf8');
    res.on('data', (d) => {
        console.log("📄 Response Body:", d);
    });
});

req.on('error', (error) => {
    console.error("❌ Error:", error.message);
});

req.write(data);
req.end();
