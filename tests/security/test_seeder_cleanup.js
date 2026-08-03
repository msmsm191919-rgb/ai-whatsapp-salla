/**
 * Seeder & Cleanup Script Verification Tests
 * Tests create-test-tenant.js and cleanup-legacy-test-tenant.js
 */
const { execSync, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '../../');
const tempDb = path.join(__dirname, 'temp_seeder_test.sqlite');
const tempEnv = path.join(rootDir, '.env.staging');

let passed = 0, failed = 0;
function assert(label, actual, expected) {
  const ok = Array.isArray(expected) ? expected.includes(actual) : actual === expected;
  const exp = Array.isArray(expected) ? expected.join('|') : expected;
  if (ok) { console.log(`  ✅ ${label}: ${actual}`); passed++; }
  else { console.error(`  ❌ ${label}: ${actual} (Expected: ${exp})`); failed++; }
}

// Setup temp .env.staging pointing to test SQLite
function setupEnv() {
  fs.writeFileSync(tempEnv, [
    'NODE_ENV=staging', 'STAGING_SAFE_MODE=true',
    'SALLA_DATABASE_DIALECT=sqlite',
    `SALLA_DATABASE_STORAGE=${tempDb}`,
    'SESSION_SECRET=mock_sess_long_value_thirty_two_chars_long_without_forbidden_words',
    'SALLA_WEBHOOK_SECRET=mock_webhook_key_no_forbidden',
    'SALLA_OAUTH_CLIENT_ID=mock_id', 'SALLA_OAUTH_CLIENT_SECRET=mock_s',
    'SALLA_OAUTH_CLIENT_REDIRECT_URI=http://127.0.0.1/callback', ''
  ].join('\n'));
}

function cleanup() {
  try { if (fs.existsSync(tempEnv)) fs.unlinkSync(tempEnv); } catch(_){}
  try { if (fs.existsSync(tempDb)) fs.unlinkSync(tempDb); } catch(_){}
}

function runScript(script, args = [], env = {}) {
  const result = spawnSync('node', [script, ...args], {
    cwd: rootDir, timeout: 15000, encoding: 'utf8',
    env: { ...process.env, ...env }
  });
  return { code: result.status, stdout: result.stdout || '', stderr: result.stderr || '' };
}

const seeder = 'scripts/staging/create-test-tenant.js';
const cleaner = 'scripts/staging/cleanup-legacy-test-tenant.js';

console.log('=== SEEDER & CLEANUP VERIFICATION ===\n');

// ── Test 1: Seeder rejects production ──
console.log('─ Test 1: Seeder rejects production ─');
let r = runScript(seeder, [], { NODE_ENV: 'production', STAGING_SAFE_MODE: 'true' });
assert('Production rejection', r.code, 1);
assert('Error message mentions staging', r.stderr.includes('Staging') || r.stdout.includes('Staging'), true);

// ── Test 2: Seeder rejects STAGING_SAFE_MODE !== true ──
console.log('\n─ Test 2: Seeder rejects unsafe mode ─');
r = runScript(seeder, [], { NODE_ENV: 'staging', STAGING_SAFE_MODE: 'false' });
assert('Unsafe mode rejection', r.code, 1);

// ── Test 3: Seeder rejects non-sqlite ──
console.log('\n─ Test 3: Seeder rejects non-sqlite ─');
setupEnv();
// Override dialect in env
r = runScript(seeder, [], { NODE_ENV: 'staging', STAGING_SAFE_MODE: 'true', SALLA_DATABASE_DIALECT: 'mysql' });
assert('Non-sqlite rejection', r.code, 1);

// ── Test 4: First run — created ──
console.log('\n─ Test 4: First run — created ─');
setupEnv();
r = runScript(seeder, ['--reference', 'test-verification'], { NODE_ENV: 'staging', STAGING_SAFE_MODE: 'true' });
assert('First run exit code', r.code, 0);
assert('Output contains created', r.stdout.includes('created'), true);
assert('No mock_token in output', !r.stdout.includes('mock_access_token'), true);

// ── Test 5: Second run — reused (idempotent) ──
console.log('\n─ Test 5: Second run — reused ─');
r = runScript(seeder, ['--reference', 'test-verification'], { NODE_ENV: 'staging', STAGING_SAFE_MODE: 'true' });
assert('Second run exit code', r.code, 0);
assert('Output contains reused', r.stdout.includes('reused'), true);

// ── Test 6: Cleanup dry-run ──
console.log('\n─ Test 6: Cleanup dry-run ─');
r = runScript(cleaner, ['--reference', 'test-verification', '--dry-run'], { NODE_ENV: 'staging', STAGING_SAFE_MODE: 'true' });
assert('Dry-run exit code', r.code, 0);
assert('Output mentions DRY-RUN', r.stdout.includes('DRY-RUN'), true);
// DB file should still exist with data
assert('DB file still exists after dry-run', fs.existsSync(tempDb), true);

// ── Test 7: Cleanup rejects production ──
console.log('\n─ Test 7: Cleanup rejects production ─');
r = runScript(cleaner, [], { NODE_ENV: 'production', STAGING_SAFE_MODE: 'true' });
assert('Production rejection', r.code, 1);

// ── Test 8: Cleanup rejects unsafe mode ──
console.log('\n─ Test 8: Cleanup rejects unsafe mode ─');
r = runScript(cleaner, [], { NODE_ENV: 'staging', STAGING_SAFE_MODE: 'false' });
assert('Unsafe mode rejection', r.code, 1);

// ── Summary ──
cleanup();
console.log(`\n=== SEEDER RESULTS: ${passed} passed, ${failed} failed ===`);
if (failed === 0) { console.log('🎉 ALL SEEDER/CLEANUP TESTS PASSED!'); process.exit(0); }
else { console.error('❌ SOME SEEDER/CLEANUP TESTS FAILED.'); process.exit(1); }
