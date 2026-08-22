// Salla Embedded App browser-session bootstrap.
//
// Scope: verifying a short-lived Embedded App token from Salla and resolving it
// to an exact, existing Tenant. This is a separate concern from:
//   - app.store.authorize (Easy Mode API authorization / store token storage) — untouched
//   - /oauth/redirect (legacy Custom OAuth guard) — untouched
//
// A raw merchant_id from the query string is never trusted. Only a merchant_id
// returned by Salla's own server-side introspection response is used, and only
// an exact platform+salla_merchant_id Tenant match is accepted — never a
// heuristic (latest/first/updated_at) fallback.

const axios = require('axios');
const crypto = require('crypto');
const { Op } = require('sequelize');

const INTROSPECT_URL = 'https://api.salla.dev/exchange-authority/v1/introspect';
const LAUNCH_TICKET_TTL_MS = 60 * 1000; // single-use, short-lived by design

/**
 * Parses Salla's token expiry field. The contract may return it as an ISO 8601
 * datetime string (e.g. "2026-01-19T12:00:00Z") or, defensively, as a unix
 * seconds integer. Returns null for missing/unparseable values (treated as
 * expired/invalid by the caller).
 */
function parseExpiry(exp) {
  if (exp === undefined || exp === null || exp === '') return null;
  if (typeof exp === 'number' && Number.isFinite(exp)) {
    return new Date(exp * 1000);
  }
  if (typeof exp === 'string') {
    const parsed = new Date(exp);
    if (!isNaN(parsed.getTime())) return parsed;
  }
  return null;
}

/**
 * Verifies a short-lived Salla Embedded App token via server-side introspection.
 * Never logs the token value itself.
 *
 * IMPORTANT: S-Source must be the Salla App ID (shown as "رقم التطبيق" in the
 * Partner Portal, e.g. a short numeric id) — NOT the OAuth Client ID (the UUID
 * used elsewhere for passport-strategy). These are two distinct identifiers in
 * Salla's own portal. SALLA_APP_ID must be set as its own env var.
 *
 * @returns {Promise<{verified: true, merchantId: number} | {verified: false, reason: string}>}
 */
async function verifyEmbeddedToken(token) {
  if (!token || typeof token !== 'string') {
    return { verified: false, reason: 'missing_token' };
  }

  const appId = process.env.SALLA_APP_ID;
  if (!appId) {
    console.error('[SallaEmbeddedAuth] SALLA_APP_ID is not configured');
    return { verified: false, reason: 'server_configuration_error' };
  }

  let response;
  try {
    response = await axios.post(
      INTROSPECT_URL,
      { token },
      {
        headers: {
          'S-Source': appId,
          'Content-Type': 'application/json'
        },
        timeout: 8000
      }
    );
  } catch (e) {
    console.error('[SallaEmbeddedAuth] Introspection request failed:', e.response?.status || e.message);
    return { verified: false, reason: 'introspection_request_failed' };
  }

  const body = response.data || {};
  const payload = body.data || body;
  const success = body.success === true || payload.success === true;
  const merchantId = payload.merchant_id;

  // Contract: data.exp is an ISO 8601 datetime string. Reject if absent or
  // unparseable or already elapsed. A defensive fallback also honors a
  // boolean `expired` flag if the response carries one.
  const expDate = parseExpiry(payload.exp);
  const expValid = expDate !== null && expDate.getTime() > Date.now();
  const explicitlyExpired = payload.expired === true;

  if (!success || !merchantId || explicitlyExpired || !expValid) {
    return { verified: false, reason: 'introspection_rejected' };
  }

  const numericMerchantId = Number(merchantId);
  if (!Number.isFinite(numericMerchantId) || numericMerchantId <= 0) {
    return { verified: false, reason: 'invalid_merchant_id' };
  }

  return { verified: true, merchantId: numericMerchantId };
}

/**
 * Builds the session object for a resolved Salla tenant. tenant_id is always
 * the internal Tenant.id; merchant.id is always the external salla_merchant_id.
 * tenant.id must never be placed into merchant.id.
 */
function buildSallaSession(tenant) {
  return {
    tenant_id: tenant.id,
    platform: 'salla',
    merchant: { id: tenant.salla_merchant_id, name: tenant.store_name }
  };
}

/**
 * Resolves a verified Salla merchant_id to an exact Tenant. Never falls back
 * to platform_store_id, updated_at ordering, or "first/latest" heuristics.
 * @returns {Promise<{status: 'ok', tenant: object} | {status: 'not_linked'} | {status: 'duplicate'}>}
 */
async function resolveTenantForMerchant(db, merchantId) {
  const matches = await db.models.Tenant.findAll({
    where: { platform: 'salla', salla_merchant_id: merchantId }
  });

  if (matches.length === 0) {
    return { status: 'not_linked' };
  }

  if (matches.length > 1) {
    console.error(`[SallaEmbeddedAuth] SECURITY: multiple tenants matched merchant ${merchantId}`);
    return { status: 'duplicate' };
  }

  return { status: 'ok', tenant: matches[0] };
}

/**
 * Creates a single-use, short-lived, tenant-bound launch ticket used to hand
 * off a verified embedded session to the top-level Mubhir origin (the iframe's
 * session cookie is not reliable across that boundary — see cookie analysis).
 * Only the SHA-256 hash of the raw ticket is persisted. Returns the RAW ticket
 * — callers must never log it.
 * @returns {Promise<string>} raw ticket value
 */
async function createLaunchTicket(db, tenant) {
  const rawTicket = crypto.randomBytes(32).toString('hex');
  const ticketHash = crypto.createHash('sha256').update(rawTicket).digest('hex');

  await db.models.SallaLaunchTicket.create({
    ticket_hash: ticketHash,
    tenant_id: tenant.id,
    platform: 'salla',
    expires_at: new Date(Date.now() + LAUNCH_TICKET_TTL_MS)
  });

  return rawTicket;
}

/**
 * Consumes a launch ticket exactly once (atomic UPDATE ... WHERE consumed_at
 * IS NULL guards against replay/race conditions). The tenant returned is
 * always the one bound to the ticket at creation time — a ticket can never be
 * used to select or influence a different tenant_id.
 * @returns {Promise<{valid: true, tenant: object} | {valid: false, reason: string}>}
 */
async function consumeLaunchTicket(db, rawTicket) {
  if (!rawTicket || typeof rawTicket !== 'string') {
    return { valid: false, reason: 'missing_ticket' };
  }

  const ticketHash = crypto.createHash('sha256').update(rawTicket).digest('hex');

  const [affectedCount] = await db.models.SallaLaunchTicket.update(
    { consumed_at: new Date() },
    {
      where: {
        ticket_hash: ticketHash,
        consumed_at: null,
        expires_at: { [Op.gt]: new Date() }
      }
    }
  );

  if (affectedCount !== 1) {
    return { valid: false, reason: 'invalid_expired_or_replayed' };
  }

  const record = await db.models.SallaLaunchTicket.findOne({ where: { ticket_hash: ticketHash } });
  const tenant = record ? await db.models.Tenant.findByPk(record.tenant_id) : null;

  if (!tenant || tenant.platform !== 'salla') {
    return { valid: false, reason: 'tenant_not_found' };
  }

  return { valid: true, tenant };
}

module.exports = {
  verifyEmbeddedToken,
  resolveTenantForMerchant,
  buildSallaSession,
  createLaunchTicket,
  consumeLaunchTicket
};
