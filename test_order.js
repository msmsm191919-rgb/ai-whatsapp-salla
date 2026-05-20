const http = require('http');

const orderData = JSON.stringify({
    event: "order.created",
    merchant: "12345",
    data: {
        id: "2024-999",
        customer: {
            first_name: "Ahmed",
            last_name: "Ali",
            mobile: "+966501577963"
        },
        total: {
            amount: 500,
            currency: "SAR"
        }
    }
});

const options = {
    hostname: 'localhost',
    port: 8082,
    path: '/webhook',
    method: 'POST',
    headers: {
        'Content-Type': 'application/json',
        'Content-Length': orderData.length
    }
};

console.log("⏳ Sending FAKE order to test AI Logic...");

const req = http.request(options, (res) => {
    console.log(`✅ Status: ${res.statusCode}`);
    res.setEncoding('utf8');
    res.on('data', (d) => process.stdout.write("📄 Response: " + d + "\n"));
});

req.on('error', (e) => console.error("❌ Error: " + e.message));
req.write(orderData);
req.end();
