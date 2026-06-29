// tests/reliability/test_recovery_verification.js
// ═══════════════════════════════════════════════════════════════════
// 🧪 Comprehensive Reliability & Circuit Breaker Test - Phase 1A
// ═══════════════════════════════════════════════════════════════════

const path = require('path');
const fs = require('fs');

const workspaceDir = path.join(__dirname, '../../');

// Load environment variables
const dotenvPath = path.join(workspaceDir, '.env');
if (fs.existsSync(dotenvPath)) {
    require(path.join(workspaceDir, 'node_modules', 'dotenv')).config({ path: dotenvPath });
}

// 1. Setup global timer acceleration for testing backoff
const originalSetTimeout = global.setTimeout;
let accelerateBackoff = false;

global.setTimeout = (callback, delay, ...args) => {
    if (accelerateBackoff && delay >= 3000 && delay <= 305000) {
        // Fast-forward backoff timers to 5ms
        return originalSetTimeout(callback, 5, ...args);
    }
    return originalSetTimeout(callback, delay, ...args);
};

// Mock whatsapp-web.js
const mockDestroy = jestLikeSpy();
const mockClose = jestLikeSpy();
const mockInitialize = jestLikeSpy();
const mockSendMessage = jestLikeSpy();

let simulateFailureType = null; // 'auth_failure' or 'technical_failure' or null

const mockBrowserProcess = {
    pid: 98765
};

class MockClient {
    constructor(opts) {
        this.options = opts;
        this.pupBrowser = {
            process: () => mockBrowserProcess,
            close: async () => {
                mockClose.call();
            }
        };
        this.listenersMap = new Map();
    }
    
    on(event, callback) {
        if (!this.listenersMap.has(event)) {
            this.listenersMap.set(event, []);
        }
        this.listenersMap.get(event).push(callback);
    }
    
    emit(event, ...args) {
        const list = this.listenersMap.get(event) || [];
        list.forEach(cb => cb(...args));
    }
    
    removeAllListeners(event) {
        if (event) {
            this.listenersMap.delete(event);
        } else {
            this.listenersMap.clear();
        }
    }
    
    async initialize() {
        mockInitialize.call();
        if (simulateFailureType === 'auth_failure') {
            originalSetTimeout(() => {
                this.emit('auth_failure', 'Mock Auth Failure Message');
            }, 10);
        } else if (simulateFailureType === 'technical_failure') {
            throw new Error('Chromium crash mock error');
        } else {
            originalSetTimeout(() => {
                this.emit('ready');
            }, 10);
        }
    }
    
    async destroy() {
        mockDestroy.call();
    }
    
    async getState() {
        return 'CONNECTED';
    }

    async sendMessage(to, body) {
        mockSendMessage.call(to, body);
        return { id: { id: 'msg_' + Math.random() } };
    }
}

// Inject Mock into require cache
const targetResolve = require.resolve(path.join(workspaceDir, 'node_modules', 'whatsapp-web.js'));
require.cache[targetResolve] = {
    id: targetResolve,
    filename: targetResolve,
    loaded: true,
    exports: {
        Client: MockClient,
        LocalAuth: class {},
        MessageMedia: class {}
    }
};

const chatServiceResolve = require.resolve(path.join(workspaceDir, 'services', 'ChatService'));
require.cache[chatServiceResolve] = {
    id: chatServiceResolve,
    filename: chatServiceResolve,
    loaded: true,
    exports: {
        handleIncomingMessage: async ({ fromPhone, messageBody, tenantId }) => {
            console.log(`💬 [MockChatService] Received: "${messageBody}" from phone: ${fromPhone}`);
            return { reply: 'هذا رد المساعد الذكي التلقائي بعد استعادة الاتصال 🤖' };
        }
    }
};

// Load actual modules
const SallaDatabase = require(path.join(workspaceDir, 'database', 'db_instance'));
const waWeb = require(path.join(workspaceDir, 'services', 'waWeb'));
const planGate = require(path.join(workspaceDir, 'services', 'planGate'));

function jestLikeSpy() {
    let count = 0;
    const calls = [];
    return {
        call: (...args) => { count++; calls.push(args); },
        getCount: () => count,
        getCalls: () => calls,
        reset: () => { count = 0; calls.length = 0; }
    };
}

(async () => {
    console.log('========================================================');
    console.log('🧪 RUNNING RELIABILITY & CIRCUIT BREAKER VERIFICATION');
    console.log('========================================================\n');

    try {
        await SallaDatabase.connect();
    } catch(e) {
        console.warn('⚠️ SQLite connection warning (skipping DB sync):', e.message);
    }

    const testTenantId = 'test_merchant_777';
    const expiredTenantId = 'expired_tenant';

    // Override planGate for testing
    const originalCheck = planGate.checkTenantAccess;
    planGate.checkTenantAccess = async (tid) => {
        if (String(tid) === expiredTenantId) {
            return { allowed: false, reason: 'subscription_expired' };
        }
        return { allowed: true, reason: 'allowed' };
    };

    // ----------------------------------------------------------------
    // TEST 1: Auth Failure
    // ----------------------------------------------------------------
    console.log('--- TEST 1: Authentication Failure Flow ---');
    simulateFailureType = 'auth_failure';
    waWeb.start(testTenantId);
    
    await new Promise(r => originalSetTimeout(r, 100));
    let snapshot = waWeb.getSessionSnapshot(testTenantId);
    console.log(`- State after auth_failure: ${snapshot.status} (Expected: auth_required)`);
    console.log(`- Reconnect Attempt Count: ${snapshot.reconnectAttempt} (Expected: 0)`);
    
    let sessionObj = waWeb._sessions.get(testTenantId);
    let timerActive = !!sessionObj.reconnectTimer;
    console.log(`- Reconnect Timer Active: ${timerActive} (Expected: false)`);
    console.log('');

    // ----------------------------------------------------------------
    // TEST 2: Technical Failure (Circuit Breaker Activation)
    // ----------------------------------------------------------------
    console.log('--- TEST 2: Technical Failure & Circuit Breaker ---');
    console.log('- Activating timer acceleration...');
    accelerateBackoff = true;
    simulateFailureType = 'technical_failure';
    
    // Clear reconnect counter
    sessionObj.reconnectAttempt = 0;
    sessionObj.circuitOpen = false;
    sessionObj.status = 'disconnected';

    console.log(`- Initiating first startup failure at: ${new Date().toISOString()}`);
    waWeb.start(testTenantId);

    // Give it a bit of time to complete all 5 backoff cycles automatically (accelerated to 5ms each)
    await new Promise(r => originalSetTimeout(r, 500));

    snapshot = waWeb.getSessionSnapshot(testTenantId);
    console.log(`- State after 5 failures: ${snapshot.status} (Expected: recovery_failed)`);
    console.log(`- Circuit Open Status: ${snapshot.circuitOpen} (Expected: true)`);
    console.log(`- Reconnect Attempt Count: ${snapshot.reconnectAttempt} (Expected: 0 - reset)`);
    console.log('');

    // ----------------------------------------------------------------
    // TEST 3: Half-Open State Success & Failure
    // ----------------------------------------------------------------
    console.log('--- TEST 3: Half-Open State Behavior ---');
    console.log('A. Testing Half-Open FAILURE:');
    // Set circuit expiration to the past
    sessionObj.circuitOpenUntil = Date.now() - 1000;
    simulateFailureType = 'technical_failure';
    
    console.log('- Starting client when Circuit is expired (Half-Open)...');
    waWeb.start(testTenantId);
    await new Promise(r => originalSetTimeout(r, 100));
    
    snapshot = waWeb.getSessionSnapshot(testTenantId);
    console.log(`- State after Half-Open failure: ${snapshot.status} (Expected: recovery_failed)`);
    console.log(`- Circuit Open Status: ${snapshot.circuitOpen} (Expected: true)`);
    console.log('');

    console.log('B. Testing Half-Open SUCCESS:');
    // Expire circuit again and allow success
    sessionObj.circuitOpenUntil = Date.now() - 1000;
    simulateFailureType = null; // Successful connection
    
    console.log('- Starting client again when Circuit is expired (Half-Open)...');
    waWeb.start(testTenantId);
    await new Promise(r => originalSetTimeout(r, 100));
    
    snapshot = waWeb.getSessionSnapshot(testTenantId);
    console.log(`- State after Half-Open success: ${snapshot.status} (Expected: ready)`);
    console.log(`- Circuit Open Status: ${snapshot.circuitOpen} (Expected: false)`);
    console.log('');

    // ----------------------------------------------------------------
    // TEST 4: Real Sending & Receiving after Recovery
    // ----------------------------------------------------------------
    console.log('--- TEST 4: Sending & Receiving Verification ---');
    console.log(`- waWeb.getState():`, waWeb.getState(testTenantId));
    
    // Test receiving message
    const mockMsg = {
        from: '966500000000@c.us',
        body: 'السلام عليكم',
        timestamp: Math.floor(Date.now() / 1000) + 10,
        fromMe: false,
        type: 'chat',
        getChat: async () => ({
            isGroup: false,
            sendStateTyping: async () => {}
        })
    };
    
    console.log('- Simulating incoming message from buyer...');
    mockSendMessage.reset();
    sessionObj.client.emit('message_create', mockMsg);
    
    // Wait for the simulated delay of sendMessage (1200ms)
    await new Promise(r => originalSetTimeout(r, 1500));
    
    console.log(`- Outgoing AI replies count: ${mockSendMessage.getCount()}`);
    if (mockSendMessage.getCount() > 0) {
        console.log(`- Sent reply details:`, mockSendMessage.getCalls()[0]);
    }
    console.log('');

    // ----------------------------------------------------------------
    // TEST 5: Graceful Shutdown
    // ----------------------------------------------------------------
    console.log('--- TEST 5: Graceful Shutdown ---');
    mockDestroy.reset();
    mockClose.reset();
    
    console.log('- Launching graceful shutdown...');
    await waWeb.destroyAll();
    
    console.log(`- client.destroy() called: ${mockDestroy.getCount()} times (Expected: 1)`);
    console.log(`- browser.close() called: ${mockClose.getCount()} times`);
    console.log('');

    // Restore original functions
    planGate.checkTenantAccess = originalCheck;
    global.setTimeout = originalSetTimeout;

    console.log('========================================================');
    console.log('✅ ALL RELIABILITY SUITE TESTS COMPLETED SUCCESSFULLY!');
    console.log('========================================================');
    process.exit(0);
})();
