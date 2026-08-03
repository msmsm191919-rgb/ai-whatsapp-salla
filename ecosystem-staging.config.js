// ecosystem-staging.config.js
// ═══════════════════════════════════════════════════════════════════
// ⚙️ PM2 Staging Application Configuration (Isolated & Secured)
// ═══════════════════════════════════════════════════════════════════

module.exports = {
  apps: [{
    name: 'whatsapp-ai-staging',
    script: './app.js',
    cwd: '/opt/mubhir-staging/app',
    instances: 1,
    exec_mode: 'fork',
    kill_timeout: 15000,          // 15s graceful shutdown buffer for Puppeteer closing
    listen_timeout: 10000,
    autorestart: true,
    restart_delay: 3000,
    max_restarts: 5,
    min_uptime: '30s',
    watch: false,
    merge_logs: true,
    time: true,
    max_memory_restart: '1G',     // 1GB is safe for Puppeteer running multiple test browsers
    error_file: '/opt/mubhir-staging/logs/error.log',
    out_file: '/opt/mubhir-staging/logs/out.log',
    pid_file: '/opt/mubhir-staging/run/app.pid',
    env: {
      NODE_ENV: 'staging',
      HOST: '127.0.0.1',          // Restricts socket listening to localhost for SSH Tunnel access only
      PORT: 8096,
      SALLA_DATABASE_DIALECT: 'sqlite',
      SALLA_DATABASE_STORAGE: '/opt/mubhir-staging/data/database_staging.sqlite',
      WWEBJS_AUTH_PATH: '/opt/mubhir-staging/data/wwebjs_auth',
      STAGING_SAFE_MODE: 'true',
      SESSION_COOKIE_NAME: 'mubhir_staging_sid'
    }
  }]
};
