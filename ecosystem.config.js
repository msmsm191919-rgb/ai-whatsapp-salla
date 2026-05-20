module.exports = {
    apps: [{
        name: "mobher-ai-whatsapp",
        script: "./app.js",
        instances: 1,
        exec_mode: "fork",
        max_restarts: 10,
        min_uptime: "10s",
        time: true,
        watch: false,
        max_memory_restart: '300M',
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
