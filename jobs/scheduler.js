// jobs/scheduler.js
// مركز جدولة كل السيناريوهات الزمنية (Cron)
const cron = require('node-cron');

const birthday     = require('../services/scenarios/birthday.scenario');
const reactivation = require('../services/scenarios/reactivation.scenario');
const priceDrop    = require('../services/scenarios/priceDrop.scenario');

let started = false;

function start() {
    if (started) return console.log('[scheduler] already started');
    started = true;

    // 🎂 عيد الميلاد — كل يوم 9:00 صباحاً (Asia/Riyadh)
    cron.schedule('0 9 * * *', () => {
        console.log('⏰ [cron] birthday scenario triggered');
        birthday.run().catch(e => console.error('birthday.run failed:', e));
    }, { timezone: 'Asia/Riyadh' });

    // ⏰ إعادة تفعيل العملاء — كل يوم 11:00 صباحاً
    cron.schedule('0 11 * * *', () => {
        console.log('⏰ [cron] reactivation scenario triggered');
        reactivation.run().catch(e => console.error('reactivation.run failed:', e));
    }, { timezone: 'Asia/Riyadh' });

    // 🏷️ تخفيض السعر — كل يوم 10:00 صباحاً
    cron.schedule('0 10 * * *', () => {
        console.log('⏰ [cron] price_drop scenario triggered');
        priceDrop.run().catch(e => console.error('priceDrop.run failed:', e));
    }, { timezone: 'Asia/Riyadh' });

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
