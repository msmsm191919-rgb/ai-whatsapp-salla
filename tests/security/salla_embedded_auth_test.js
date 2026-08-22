// Mock-only test suite for services/SallaEmbeddedAuthService.js
// No real network calls (axios.post is monkey-patched), no WhatsApp, no OpenAI,
// no production database touched — uses a disposable in-memory sqlite DB with
// the real Tenant + SallaLaunchTicket Sequelize models.
//
// Run: node tests/security/salla_embedded_auth_test.js

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { Sequelize, DataTypes } = require('sequelize');

// Fixture values only — not real Mubhir app identifiers.
process.env.SALLA_APP_ID = 'test-fixture-app-id-000000';
process.env.SALLA_OAUTH_CLIENT_ID = 'test-fixture-client-id-uuid'; // must NEVER be used as S-Source
process.env.NODE_ENV = 'test';

const SallaEmbeddedAuthService = require('../../services/SallaEmbeddedAuthService');
const TenantModel = require('../../helpers/ORMs/Sequelize/models/tenant');
const SallaLaunchTicketModel = require('../../helpers/ORMs/Sequelize/models/sallalaunchticket');

const originalPost = axios.post;
function mockIntrospectResponse(fn) { axios.post = fn; }
function restoreAxios() { axios.post = originalPost; }

const isoIn = (seconds) => new Date(Date.now() + seconds * 1000).toISOString();

async function buildTestDb() {
  const sequelize = new Sequelize('sqlite::memory:', { logging: false });
  const Tenant = TenantModel(sequelize, DataTypes);
  const SallaLaunchTicket = SallaLaunchTicketModel(sequelize, DataTypes);
  SallaLaunchTicket.belongsTo(Tenant, { foreignKey: 'tenant_id' });
  await sequelize.sync();
  return { sequelize, models: { Tenant, SallaLaunchTicket } };
}

async function testSSourceUsesAppId() {
  console.log('🧪 S-Source header — must be SALLA_APP_ID, never SALLA_OAUTH_CLIENT_ID');
  let capturedHeaders = null;
  mockIntrospectResponse(async (url, body, opts) => {
    capturedHeaders = opts.headers;
    return { data: { success: true, data: { merchant_id: 111, exp: isoIn(300) } } };
  });
  await SallaEmbeddedAuthService.verifyEmbeddedToken('some-token');
  assert.strictEqual(capturedHeaders['S-Source'], process.env.SALLA_APP_ID);
  console.log('  ✅ INTROSPECT_S_SOURCE_USES_APP_ID=YES');
  assert.notStrictEqual(capturedHeaders['S-Source'], process.env.SALLA_OAUTH_CLIENT_ID);
  console.log('  ✅ INTROSPECT_S_SOURCE_NEVER_USES_CLIENT_ID=YES');
  restoreAxios();
}

async function testVerifyEmbeddedToken() {
  console.log('🧪 verifyEmbeddedToken() — ISO exp contract cases');

  let r = await SallaEmbeddedAuthService.verifyEmbeddedToken(undefined);
  assert.strictEqual(r.verified, false);
  assert.strictEqual(r.reason, 'missing_token');
  console.log('  ✅ missing token → BLOCKED');

  mockIntrospectResponse(async () => ({ data: { success: true, data: { merchant_id: 111, exp: isoIn(300) } } }));
  r = await SallaEmbeddedAuthService.verifyEmbeddedToken('valid-token-store-a');
  assert.strictEqual(r.verified, true);
  assert.strictEqual(r.merchantId, 111);
  console.log('  ✅ ISO_EXP_FUTURE=PASS (Store A, merchantId=111)');

  mockIntrospectResponse(async () => ({ data: { success: true, data: { merchant_id: 222, exp: isoIn(300) } } }));
  r = await SallaEmbeddedAuthService.verifyEmbeddedToken('valid-token-store-b');
  assert.strictEqual(r.verified, true);
  assert.strictEqual(r.merchantId, 222);
  console.log('  ✅ ISO_EXP_FUTURE=PASS (Store B, merchantId=222)');

  mockIntrospectResponse(async () => ({ data: { success: true, data: { merchant_id: 111, exp: isoIn(-300) } } }));
  r = await SallaEmbeddedAuthService.verifyEmbeddedToken('expired-token');
  assert.strictEqual(r.verified, false);
  console.log('  ✅ ISO_EXP_EXPIRED=BLOCKED');

  mockIntrospectResponse(async () => ({ data: { success: true, data: { merchant_id: 111 } } }));
  r = await SallaEmbeddedAuthService.verifyEmbeddedToken('no-exp-token');
  assert.strictEqual(r.verified, false);
  console.log('  ✅ MISSING_EXP=BLOCKED');

  mockIntrospectResponse(async () => ({ data: { success: true, data: { merchant_id: 111, exp: 'not-a-real-date' } } }));
  r = await SallaEmbeddedAuthService.verifyEmbeddedToken('invalid-exp-token');
  assert.strictEqual(r.verified, false);
  console.log('  ✅ INVALID_EXP=BLOCKED');

  mockIntrospectResponse(async () => ({ data: { success: false } }));
  r = await SallaEmbeddedAuthService.verifyEmbeddedToken('fake-token');
  assert.strictEqual(r.verified, false);
  console.log('  ✅ fake token (success:false) → BLOCKED');

  mockIntrospectResponse(async () => { throw new Error('Request failed with status code 401'); });
  r = await SallaEmbeddedAuthService.verifyEmbeddedToken('garbage-token');
  assert.strictEqual(r.verified, false);
  assert.strictEqual(r.reason, 'introspection_request_failed');
  console.log('  ✅ introspection request failure (garbage/fake token) → BLOCKED');

  restoreAxios();
}

async function testTokenNeverLogged() {
  console.log('🧪 embedded token value must never appear in logs');
  const SECRET_TOKEN_VALUE = 'super-secret-embedded-token-should-never-be-logged';
  const captured = [];
  const o = { warn: console.warn, error: console.error, log: console.log };
  console.warn = (...a) => captured.push(a.join(' '));
  console.error = (...a) => captured.push(a.join(' '));
  console.log = (...a) => captured.push(a.join(' '));

  mockIntrospectResponse(async () => { throw new Error('401 unauthorized'); });
  await SallaEmbeddedAuthService.verifyEmbeddedToken(SECRET_TOKEN_VALUE);
  mockIntrospectResponse(async () => ({ data: { success: false } }));
  await SallaEmbeddedAuthService.verifyEmbeddedToken(SECRET_TOKEN_VALUE);

  console.warn = o.warn; console.error = o.error; console.log = o.log;
  restoreAxios();

  assert.strictEqual(captured.some(l => l.includes(SECRET_TOKEN_VALUE)), false, 'token value must never be logged');
  console.log('  ✅ token value never appears in console output across failure paths');
}

async function testResolveTenantForMerchant(db) {
  console.log('🧪 resolveTenantForMerchant() — exact-match tenant resolution');
  const { Tenant } = db.models;

  const tenantA = await Tenant.create({ platform: 'salla', salla_merchant_id: 111, store_name: 'Store A', password_hash: null });
  const tenantB = await Tenant.create({ platform: 'salla', salla_merchant_id: 222, store_name: 'Store B', password_hash: 'hashed' });

  let res = await SallaEmbeddedAuthService.resolveTenantForMerchant(db, 111);
  assert.strictEqual(res.status, 'ok');
  assert.strictEqual(res.tenant.id, tenantA.id);
  console.log('  ✅ Store A merchant_id → Tenant A');

  res = await SallaEmbeddedAuthService.resolveTenantForMerchant(db, 222);
  assert.strictEqual(res.status, 'ok');
  assert.strictEqual(res.tenant.id, tenantB.id);
  console.log('  ✅ Store B merchant_id → Tenant B');

  res = await SallaEmbeddedAuthService.resolveTenantForMerchant(db, 111);
  assert.notStrictEqual(res.tenant.id, tenantB.id);
  console.log('  ✅ Store A merchant_id → Tenant B BLOCKED (never crosses)');

  res = await SallaEmbeddedAuthService.resolveTenantForMerchant(db, 999999);
  assert.strictEqual(res.status, 'not_linked');
  console.log('  ✅ unknown merchant_id → not_linked (zero tenant, no fallback)');

  await Tenant.create({ platform: 'salla', salla_merchant_id: 111, store_name: 'Duplicate Store A', password_hash: null });
  res = await SallaEmbeddedAuthService.resolveTenantForMerchant(db, 111);
  assert.strictEqual(res.status, 'duplicate');
  assert.strictEqual(res.tenant, undefined);
  console.log('  ✅ duplicate tenant match → BLOCKED');

  const session = SallaEmbeddedAuthService.buildSallaSession(tenantA);
  assert.strictEqual(session.tenant_id, tenantA.id);
  assert.strictEqual(session.merchant.id, tenantA.salla_merchant_id);
  assert.notStrictEqual(session.merchant.id, tenantA.id);
  console.log('  ✅ tenant.id never used as merchant.id');

  return { tenantA, tenantB };
}

async function testLaunchTicket(db, tenantA, tenantB) {
  console.log('🧪 launch ticket — single-use, tenant-bound, hashed at rest');

  const rawTicket = await SallaEmbeddedAuthService.createLaunchTicket(db, tenantA);
  assert.strictEqual(typeof rawTicket, 'string');
  assert(rawTicket.length >= 32, 'ticket should be a long random value');

  const stored = await db.models.SallaLaunchTicket.findOne({ where: { tenant_id: tenantA.id } });
  assert(stored, 'ticket row must exist');
  assert.notStrictEqual(stored.ticket_hash, rawTicket, 'raw ticket must never be stored as-is');
  console.log('  ✅ ticket hashed at rest (raw value never persisted)');

  let consume = await SallaEmbeddedAuthService.consumeLaunchTicket(db, rawTicket);
  assert.strictEqual(consume.valid, true);
  assert.strictEqual(consume.tenant.id, tenantA.id);
  console.log('  ✅ first consume PASS → resolves to the exact tenant it was created for (Tenant A)');

  assert.notStrictEqual(consume.tenant.id, tenantB.id, 'ticket must never resolve to a different tenant');
  console.log('  ✅ ticket cannot change tenant (never resolves to Tenant B)');

  consume = await SallaEmbeddedAuthService.consumeLaunchTicket(db, rawTicket);
  assert.strictEqual(consume.valid, false);
  console.log('  ✅ second consume BLOCKED (replay blocked)');

  const shortLivedTicket = await SallaEmbeddedAuthService.createLaunchTicket(db, tenantB);
  const ticketRow = await db.models.SallaLaunchTicket.findOne({ where: { tenant_id: tenantB.id }, order: [['id', 'DESC']] });
  await ticketRow.update({ expires_at: new Date(Date.now() - 1000) }); // force-expire for the test
  consume = await SallaEmbeddedAuthService.consumeLaunchTicket(db, shortLivedTicket);
  assert.strictEqual(consume.valid, false);
  console.log('  ✅ expired ticket BLOCKED');

  consume = await SallaEmbeddedAuthService.consumeLaunchTicket(db, 'not-a-real-ticket');
  assert.strictEqual(consume.valid, false);
  console.log('  ✅ garbage/unknown ticket BLOCKED');

  // Ticket value must never be logged.
  const captured = [];
  const o = { warn: console.warn, error: console.error, log: console.log };
  console.warn = (...a) => captured.push(a.join(' '));
  console.error = (...a) => captured.push(a.join(' '));
  console.log = (...a) => captured.push(a.join(' '));
  const anotherTicket = await SallaEmbeddedAuthService.createLaunchTicket(db, tenantA);
  await SallaEmbeddedAuthService.consumeLaunchTicket(db, anotherTicket);
  await SallaEmbeddedAuthService.consumeLaunchTicket(db, anotherTicket); // replay attempt, triggers no error branch but check anyway
  console.warn = o.warn; console.error = o.error; console.log = o.log;
  assert.strictEqual(captured.some(l => l.includes(anotherTicket)), false, 'ticket value must never be logged');
  console.log('  ✅ ticket value never appears in console output');
}

function getEmbeddedFlowSection() {
  const appJs = fs.readFileSync(path.join(__dirname, '../../app.js'), 'utf8');
  const start = appJs.indexOf("Salla Embedded App — bootstrap / session / launch-consume");
  const end = appJs.indexOf("app.get(\"/login\"", start);
  assert(start !== -1, 'embedded flow section must exist in app.js');
  return appJs.slice(start, end === -1 ? start + 20000 : end);
}

function testRawMerchantIdQueryIgnored() {
  console.log('🧪 static check — embedded flow must never trust a raw merchant_id from the client');
  const section = getEmbeddedFlowSection();
  assert(
    !/req\.query\.merchant_id|req\.query\[['"]merchant_id['"]\]|req\.body\.merchant_id/.test(section),
    'embedded flow routes must not read merchant_id directly from the client'
  );
  console.log('  ✅ raw merchant_id from client is never read/trusted in the embedded flow');
}

function testTenantIdNeverAcceptedFromClient() {
  console.log('🧪 static check — /api/salla/launch/consume must never accept tenant_id authority from the client');
  const section = getEmbeddedFlowSection();
  const consumeStart = section.indexOf("app.post('/api/salla/launch/consume'");
  assert(consumeStart !== -1, 'launch/consume route must exist');
  const consumeSection = section.slice(consumeStart);
  assert(
    !/req\.body\.tenant_id|req\.query\.tenant_id/.test(consumeSection),
    'launch/consume must resolve tenant_id only from the server-verified ticket, never from the client'
  );
  console.log('  ✅ tenant_id is only ever taken from the server-side ticket record, never from the client');
}

function testNoPlaceholdersOrManualNavigationRemain() {
  console.log('🧪 static check — no leftover placeholders and no manual iframe-breakout navigation');
  const section = getEmbeddedFlowSection();

  assert(!/REPLACE_WITH_/.test(section), 'no REPLACE_WITH_ placeholder tokens may remain');
  console.log('  ✅ PLACEHOLDERS_REMAINING=none');

  assert(!/window\.top\.location/.test(section), 'manual window.top.location navigation must not be used');
  console.log('  ✅ MANUAL_TOP_LOCATION_PRESENT=NO');

  assert(!/window\.parent\.location/.test(section), 'manual window.parent.location navigation must not be used');
  console.log('  ✅ MANUAL_PARENT_LOCATION_PRESENT=NO');

  assert(/embedded\.page\.redirect\(/.test(section), 'the official embedded.page.redirect() call must be present');
  console.log('  ✅ official embedded.page.redirect() is the only navigation mechanism used');
}

function testFragmentHandoffNotQuery() {
  console.log('🧪 static check — launch ticket travels via URL fragment, never the query string');
  const section = getEmbeddedFlowSection();

  assert(/\/salla\/launch#ticket=/.test(section), 'the launch URL must use a # fragment for the ticket');
  console.log('  ✅ TICKET_IN_FRAGMENT=YES');

  assert(!/\/salla\/launch\?ticket=/.test(section), 'the launch URL must NOT put the ticket in the query string');
  console.log('  ✅ TICKET_IN_QUERY=NO');

  const launchRouteStart = section.indexOf("app.get('/salla/launch'");
  const launchRouteSection = section.slice(launchRouteStart, section.indexOf("app.post('/api/salla/launch/consume'"));
  assert(!/req\.query\.ticket/.test(launchRouteSection), 'GET /salla/launch must never read a ticket from req.query (the fragment never reaches the server)');
  console.log('  ✅ server-side GET /salla/launch never reads a ticket from the query string');
}

function testFrameAncestorsNarrow() {
  console.log('🧪 static check — CSP frame-ancestors is narrowed to s.salla.sa only, no wildcard');
  const section = getEmbeddedFlowSection();
  const match = section.match(/setHeader\(\s*['"]Content-Security-Policy['"]\s*,\s*["']([^"']*)["']/);
  assert(match, 'setHeader(Content-Security-Policy, ...) call must exist on the embedded route');
  const directive = match[1];
  assert(directive.includes('frame-ancestors'), 'the header value must be a frame-ancestors directive');
  assert(directive.includes('https://s.salla.sa'), 'frame-ancestors must include https://s.salla.sa');
  assert(!directive.includes('*.salla.sa'), 'frame-ancestors must not include a *.salla.sa wildcard');
  assert(!directive.includes('*'), 'frame-ancestors must not use a bare * wildcard');
  console.log('  ✅ FRAME_ANCESTORS=https://s.salla.sa, WILDCARD_SALLA_FRAME_ANCESTOR_PRESENT=NO');
}

async function testConcurrentDoubleConsume(db, tenantA) {
  console.log('🧪 concurrent double-consume — atomic single-use under real concurrency');
  const rawTicket = await SallaEmbeddedAuthService.createLaunchTicket(db, tenantA);

  const results = await Promise.all([
    SallaEmbeddedAuthService.consumeLaunchTicket(db, rawTicket),
    SallaEmbeddedAuthService.consumeLaunchTicket(db, rawTicket),
    SallaEmbeddedAuthService.consumeLaunchTicket(db, rawTicket),
    SallaEmbeddedAuthService.consumeLaunchTicket(db, rawTicket),
    SallaEmbeddedAuthService.consumeLaunchTicket(db, rawTicket)
  ]);

  const successCount = results.filter(r => r.valid === true).length;
  assert.strictEqual(successCount, 1, `exactly one concurrent consume must succeed, got ${successCount}`);
  console.log('  ✅ 5 concurrent consume attempts on the same ticket → exactly 1 PASS, 4 BLOCKED');
}

(async () => {
  let db;
  try {
    await testSSourceUsesAppId();
    await testVerifyEmbeddedToken();
    await testTokenNeverLogged();

    db = await buildTestDb();
    const { tenantA, tenantB } = await testResolveTenantForMerchant(db);
    await testLaunchTicket(db, tenantA, tenantB);
    await testConcurrentDoubleConsume(db, tenantA);

    testRawMerchantIdQueryIgnored();
    testTenantIdNeverAcceptedFromClient();
    testNoPlaceholdersOrManualNavigationRemain();
    testFragmentHandoffNotQuery();
    testFrameAncestorsNarrow();

    console.log('\n✅ ALL SALLA EMBEDDED AUTH TESTS PASSED');
    if (db) await db.sequelize.close();
    process.exit(0);
  } catch (e) {
    restoreAxios();
    if (db) await db.sequelize.close();
    console.error('\n❌ TEST FAILED:', e.message);
    process.exit(1);
  }
})();
