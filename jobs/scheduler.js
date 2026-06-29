// jobs/scheduler.js
// مركز جدولة كل السيناريوهات الزمنية (Cron)
const cron = require('node-cron');

const birthday     = require('../services/scenarios/birthday.scenario');
const reactivation = require('../services/scenarios/reactivation.scenario');
const priceDrop    = require('../services/scenarios/priceDrop.scenario');

const createWorker = global.createWorker || function(fn) {
    if (global.SAFE_MODE && global.SAFE_MODE.locked !== true) {
        console.error("❌ FATAL: SAFE_MODE.locked is compromised!");
        process.exit(1);
    }
    const isSafe = global.SAFE_MODE?.enabled || (
        process.env.NODE_ENV === 'staging' &&
        process.env.STAGING_SAFE_MODE === 'true' &&
        process.env.FORCE_SAFE_BYPASS !== 'true'
    );
    if (isSafe) {
        return function NOOP_WORKER() { return null; };
    }
    return fn;
};

let started = false;

function start() {
    if (started) return console.log('[scheduler] already started');
    started = true;

    // 🎂 عيد الميلاد — كل يوم 9:00 صباحاً (Asia/Riyadh)
    cron.schedule('0 9 * * *', createWorker(function birthdayWorker() {
        console.log('⏰ [cron] birthday scenario triggered');
        birthday.run().catch(e => console.error('birthday.run failed:', e));
    }), { timezone: 'Asia/Riyadh' });

    // ⏰ إعادة تفعيل العملاء — كل يوم 11:00 صباحاً
    cron.schedule('0 11 * * *', createWorker(function reactivationWorker() {
        console.log('⏰ [cron] reactivation scenario triggered');
        reactivation.run().catch(e => console.error('reactivation.run failed:', e));
    }), { timezone: 'Asia/Riyadh' });

    // 🏷️ تخفيض السعر — كل يوم 10:00 صباحاً
    cron.schedule('0 10 * * *', createWorker(function priceDropWorker() {
        console.log('⏰ [cron] price_drop scenario triggered');
        priceDrop.run().catch(e => console.error('priceDrop.run failed:', e));
    }), { timezone: 'Asia/Riyadh' });

    console.log('✅ [scheduler] Cron jobs registered (birthday 09:00 | priceDrop 10:00 | reactivation 11:00 — Asia/Riyadh)');
}

/** للتشغيل اليدوي من dashboard/dev */
async function runNow(key) {
    switch (key) {
        case 'birthday':      return birthday.run();
        case 'reactivation':  return reactivation.run();
        case 'price_drop':    return priceDrop.run();
        default: throw new Error(`Unknown scenario: ${key}`);
    }
}

module.exports = { start, runNow };
