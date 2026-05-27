module.exports = {
    apps: [{
        name: "whatsapp-ai",
        script: "./app.js",
        instances: 1,
        exec_mode: "fork",
        max_restarts: 10,
        min_uptime: "15s",
        kill_timeout: 5000,           // 5 seconds graceful closing period for Puppeteer sessions
        max_memory_restart: "400M",    // Production safety threshold for Puppeteer memory leaks
        time: true,
        watch: false,
        env: {
            NODE_ENV: "production",
            PORT: 3000,
        },
        env_development: {
            NODE_ENV: "development",
            PORT: 8095,
        }
    }]
};
