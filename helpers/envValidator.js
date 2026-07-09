// helpers/envValidator.js
// 🔍 Startup Environment Variables Validator

module.exports = () => {
    const nodeEnv = process.env.NODE_ENV || 'development';
    const isStaging = nodeEnv === 'staging';
    const isProd = nodeEnv === 'production';

    // 1. APP_URL check
    if (isStaging || isProd) {
        if (!process.env.APP_URL) {
            console.error(`❌ FATAL [EnvValidator]: APP_URL is missing or empty in ${nodeEnv} mode!`);
            process.exit(1);
            return;
        }
        if (!process.env.APP_URL.startsWith('https://')) {
            console.error(`❌ FATAL [EnvValidator]: APP_URL must start with 'https://' in staging/production! Current: ${process.env.APP_URL}`);
            process.exit(1);
            return;
        }
    } else if (nodeEnv === 'test') {
        // Fallback for tests
        if (!process.env.APP_URL) {
            process.env.APP_URL = `http://localhost:${process.env.PORT || 3000}`;
        }
    }

    // 2. Sync schema alter lockdown check
    const allowSync = process.env.ALLOW_SCHEMA_SYNC === 'true';
    if ((isStaging || isProd) && allowSync) {
        console.error(`❌ FATAL [EnvValidator]: ALLOW_SCHEMA_SYNC=true is strictly forbidden in staging/production!`);
        process.exit(1);
        return;
    }

    // 3. SMTP parameters check
    if (isStaging || isProd) {
        const requiredSMTP = ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS', 'SMTP_FROM'];
        const missingSMTP = requiredSMTP.filter(key => !process.env[key]);
        if (missingSMTP.length > 0) {
            console.error(`❌ FATAL [EnvValidator]: Missing required SMTP configurations for ${nodeEnv} mode: ${missingSMTP.join(', ')}`);
            process.exit(1);
            return;
        }
    }

    // 4. Critical keys & secrets checks
    if (isStaging || isProd) {
        const criticalKeys = ['TOKENS_ENCRYPTION_KEY', 'SESSION_SECRET', 'SALLA_WEBHOOK_SECRET'];
        const missingKeys = criticalKeys.filter(key => !process.env[key]);
        if (missingKeys.length > 0) {
            console.error(`❌ FATAL [EnvValidator]: Missing critical security keys/secrets for ${nodeEnv} mode: ${missingKeys.join(', ')}`);
            process.exit(1);
            return;
        }

        // Validate encryption key length (must be 64 hex chars = 32 bytes)
        const encKey = process.env.TOKENS_ENCRYPTION_KEY;
        if (encKey && (encKey.length !== 64 || !/^[0-9a-fA-F]+$/.test(encKey))) {
            console.error(`❌ FATAL [EnvValidator]: TOKENS_ENCRYPTION_KEY must be a 64-character hexadecimal string!`);
            process.exit(1);
            return;
        }

        // Validate session secret length (minimum 32 characters)
        const sessionSecret = process.env.SESSION_SECRET;
        if (sessionSecret && sessionSecret.length < 32) {
            console.error(`❌ FATAL [EnvValidator]: SESSION_SECRET must be at least 32 characters long in staging/production!`);
            process.exit(1);
            return;
        }
    }

    console.log(`✅ [EnvValidator] Startup environment variables validated for environment: ${nodeEnv}`);
};
