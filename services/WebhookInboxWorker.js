const SallaDatabase = require('../database/db_instance');
const SallaWebhook = require('@salla.sa/webhooks-actions');
const crypto = require('crypto');

class WebhookInboxWorker {
    constructor() {
        this.interval = null;
        this.isProcessing = false;
        this.maxAttempts = 5;
    }

    start() {
        if (this.interval) return;
        
        // Run crash recovery immediately on startup
        this.recoverCrashedEvents().catch(e => {
            console.error('❌ [InboxWorker] Crash recovery failed on boot:', e.message);
        });

        // Run poller every 10 seconds
        this.interval = setInterval(() => {
            this.processPendingEvents().catch(e => {
                console.error('❌ [InboxWorker] Error polling pending events:', e.message);
            });
        }, 10000);

        console.log('🚀 [InboxWorker] Transactional Inbox Poller started.');
    }

    stop() {
        if (this.interval) {
            clearInterval(this.interval);
            this.interval = null;
        }
    }

    // Capture, encrypt, and store the webhook payload immediately
    async enqueue(provider, eventId, eventType, storeId, rawPayload) {
        const db = SallaDatabase.connection;
        if (!db) throw new Error("Database not connected");

        const secret = process.env.TOKENS_ENCRYPTION_KEY;
        if (!secret) {
            console.error("❌ FATAL: TOKENS_ENCRYPTION_KEY missing. Fail closed.");
            throw new Error("Encryption key not configured");
        }

        // Encrypt the payload using AES-256-GCM before saving to DB
        let encryptedPayload = null;
        if (rawPayload) {
            const key = secret.length === 64 ? Buffer.from(secret, 'hex') : Buffer.from(secret, 'base64');
            const iv = crypto.randomBytes(12);
            const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
            
            // Bind encryption to eventId to prevent ciphertext injection
            const aad = Buffer.from(eventId, 'utf8');
            cipher.setAAD(aad);

            let encrypted = cipher.update(rawPayload, 'utf8', 'hex');
            encrypted += cipher.final('hex');
            const tag = cipher.getAuthTag().toString('hex');
            encryptedPayload = `v1:${iv.toString('hex')}:${tag}:${encrypted}`;
        }

        const [eventRecord, created] = await db.models.WebhookEvent.findOrCreate({
            where: { provider, event_id: eventId },
            defaults: {
                event_type: eventType,
                store_id: String(storeId || ''),
                status: 'pending',
                payload: encryptedPayload,
                attempt_count: 0
            }
        });

        if (!created) {
            console.log(`⚠️ [InboxWorker] Duplicate event rejected (eventId: ${eventId})`);
            return { duplicate: true, eventRecord };
        }

        // Trigger immediate processing asynchronously in background
        this.processEventAsync(eventRecord.id).catch(e => {
            console.error(`❌ [InboxWorker] Immediate execution failed for event ${eventRecord.id}:`, e.message);
        });

        return { duplicate: false, eventRecord };
    }

    async processEventAsync(dbRecordId) {
        const db = SallaDatabase.connection;
        if (!db) return;

        let claimedEvent = null;
        const transaction = await db.transaction();

        try {
            // Atomic claim: SELECT ... FOR UPDATE
            const event = await db.models.WebhookEvent.findOne({
                where: { id: dbRecordId, status: 'pending' },
                transaction,
                lock: transaction.LOCK.UPDATE
            });

            if (event) {
                event.status = 'processing';
                event.locked_at = new Date();
                event.attempt_count += 1;
                await event.save({ transaction });
                claimedEvent = event;
            }
            await transaction.commit();
        } catch (e) {
            await transaction.rollback();
            console.error(`❌ [InboxWorker] Failed to claim event ${dbRecordId} atomically:`, e.message);
            return;
        }

        if (claimedEvent) {
            await this.executeEvent(claimedEvent);
        }
    }

    async processPendingEvents() {
        if (this.isProcessing) return;
        this.isProcessing = true;

        const db = SallaDatabase.connection;
        if (!db) {
            this.isProcessing = false;
            return;
        }

        try {
            // Find all pending events that are not locked
            const pendingEvents = await db.models.WebhookEvent.findAll({
                where: { status: ['pending', 'failed'] },
                order: [['received_at', 'ASC']],
                limit: 10
            });

            for (const event of pendingEvents) {
                // If it is failed, apply exponential backoff retry window
                if (event.status === 'failed' && event.processed_at) {
                    const delayMs = Math.pow(2, event.attempt_count) * 5000; // 5s, 10s, 20s, 40s, 80s
                    const retryTime = new Date(event.processed_at.getTime() + delayMs);
                    if (new Date() < retryTime) {
                        continue; // Skip until backoff window expires
                    }
                }

                // Attempt to claim atomically
                let claimedEvent = null;
                const transaction = await db.transaction();
                try {
                    const freshEvent = await db.models.WebhookEvent.findOne({
                        where: { id: event.id, status: ['pending', 'failed'] },
                        transaction,
                        lock: transaction.LOCK.UPDATE
                    });

                    if (freshEvent) {
                        freshEvent.status = 'processing';
                        freshEvent.locked_at = new Date();
                        freshEvent.attempt_count += 1;
                        await freshEvent.save({ transaction });
                        claimedEvent = freshEvent;
                    }
                    await transaction.commit();
                } catch (err) {
                    await transaction.rollback();
                    continue;
                }

                if (claimedEvent) {
                    await this.executeEvent(claimedEvent);
                }
            }
        } catch (err) {
            console.error('❌ [InboxWorker] Error in poller loop:', err.message);
        } finally {
            this.isProcessing = false;
        }
    }

    async executeEvent(event) {
        const db = SallaDatabase.connection;
        if (!db) return;

        try {
            // Decrypt the payload
            const secret = process.env.TOKENS_ENCRYPTION_KEY;
            let rawPayload = null;

            if (event.payload) {
                if (!event.payload.startsWith('v1:')) {
                    throw new Error("Plaintext payloads are not allowed inside Inbox.");
                }
                const parts = event.payload.split(':');
                const [, ivHex, tagHex, encryptedHex] = parts;
                
                const key = secret.length === 64 ? Buffer.from(secret, 'hex') : Buffer.from(secret, 'base64');
                const iv = Buffer.from(ivHex, 'hex');
                const tag = Buffer.from(tagHex, 'hex');
                
                const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
                const aad = Buffer.from(event.event_id, 'utf8');
                decipher.setAAD(aad);
                decipher.setAuthTag(tag);
                
                let decrypted = decipher.update(encryptedHex, 'hex', 'utf8');
                decrypted += decipher.final('utf8');
                rawPayload = decrypted;
            }

            if (!rawPayload) {
                throw new Error("Decrypted payload is empty");
            }

            const parsedPayload = JSON.parse(rawPayload);

            // Execute the SallaWebhook action
            // Bypass side effects on staging if safe mode is active
            if (global.SAFE_MODE?.enabled === true && process.env.ALLOW_INSECURE_STAGING !== 'true') {
                console.log(`🛡️ [SAFE MODE] Blocked Salla webhook side effects for event: ${event.event_type}`);
            } else {
                await new Promise((resolve, reject) => {
                    SallaWebhook.checkActions(parsedPayload, process.env.SALLA_WEBHOOK_SECRET, {});
                    // SallaWebhook actions run asynchronously in background usually, 
                    // but we resolve immediately as checkActions returns.
                    resolve();
                });
            }

            // Mark as processed successfully
            await event.update({
                status: 'processed',
                payload: null, // Clear payload for PII data minimization / retention policy
                processed_at: new Date(),
                last_error: null
            });
            console.log(`✅ [InboxWorker] Processed event ${event.event_type} (${event.event_id})`);

        } catch (e) {
            console.error(`❌ [InboxWorker] Failed to execute event ${event.id}:`, e.message);
            const status = event.attempt_count >= this.maxAttempts ? 'dead_letter' : 'failed';
            
            await event.update({
                status,
                processed_at: new Date(),
                last_error: e.message.slice(0, 1000)
            });
        }
    }

    // Periodic or Startup task to recover events stuck in "processing" state
    async recoverCrashedEvents() {
        const db = SallaDatabase.connection;
        if (!db) return;

        // Reset any event locked for more than 5 minutes back to pending
        const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
        const [affected] = await db.models.WebhookEvent.update(
            { status: 'pending', locked_at: null },
            {
                where: {
                    status: 'processing',
                    locked_at: { [db.Sequelize.Op.lt]: fiveMinutesAgo }
                }
            }
        );

        if (affected > 0) {
            console.log(`✨ [InboxWorker] Recovered ${affected} crashed/stuck webhook events.`);
        }
    }

    // Retention policy: Delete processed webhooks older than 30 days
    async runRetentionCleanup() {
        const db = SallaDatabase.connection;
        if (!db) return;

        const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
        const deleted = await db.models.WebhookEvent.destroy({
            where: {
                status: ['processed', 'dead_letter'],
                processed_at: { [db.Sequelize.Op.lt]: thirtyDaysAgo }
            }
        });

        if (deleted > 0) {
            console.log(`🧹 [Retention] Deleted ${deleted} old processed webhook events.`);
        }
    }
}

module.exports = new WebhookInboxWorker();
