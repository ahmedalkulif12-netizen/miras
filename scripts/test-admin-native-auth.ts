#!/usr/bin/env tsx
/**
 * Native admin API auth: Bearer header, token refresh window, CORS origins, admin claims.
 * Run: npx tsx scripts/test-admin-native-auth.ts
 */
import { assert, assertEqual } from '../e2e/helpers/assert.ts';
import { hasAdminPrivileges } from '../server/lib/adminAcl.ts';
import { isAllowedNativeApiOrigin } from '../server/lib/nativeApiCors.ts';
import { buildBearerAuthorization, shouldRefreshIdToken } from '../src/lib/authHeaders.ts';
import { headersInitToRecord } from '../src/lib/nativeHttp.ts';

function run(): void {
  const token = 'eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.test';
  assertEqual(buildBearerAuthorization(token), `Bearer ${token}`, 'Bearer prefix');
  try {
    buildBearerAuthorization('  ');
    assert(false, 'empty token must throw');
  } catch (error) {
    assertEqual((error as Error).message, 'NOT_AUTHENTICATED', 'empty token is NOT_AUTHENTICATED');
  }

  const headers = headersInitToRecord({
    Authorization: buildBearerAuthorization(token),
    'Content-Type': 'application/json',
  });
  assertEqual(
    headers.Authorization || headers.authorization,
    `Bearer ${token}`,
    'Authorization header is attached'
  );
  assertEqual(
    headers['content-type'] || headers['Content-Type'],
    'application/json',
    'content-type preserved'
  );

  const soon = new Date(Date.now() + 60 * 1000).toISOString();
  const later = new Date(Date.now() + 20 * 60 * 1000).toISOString();
  assert(shouldRefreshIdToken(soon), 'token expiring in 1 minute refreshes');
  assert(!shouldRefreshIdToken(later), 'token with 20 minutes left is reused');
  assert(shouldRefreshIdToken('invalid-date'), 'unparseable expiry refreshes');

  const appUrl = 'https://hamula-cfc6c.web.app';
  assert(isAllowedNativeApiOrigin('capacitor://hamula-cfc6c.web.app', appUrl), 'capacitor hostname');
  assert(isAllowedNativeApiOrigin('capacitor://localhost', appUrl), 'capacitor localhost');
  assert(isAllowedNativeApiOrigin('ionic://localhost', appUrl), 'ionic localhost');
  assert(isAllowedNativeApiOrigin('https://localhost', appUrl), 'https localhost WebView');
  assert(isAllowedNativeApiOrigin('http://127.0.0.1', appUrl), 'http loopback');
  assert(isAllowedNativeApiOrigin('https://hamula-cfc6c.web.app', appUrl), 'Hosting origin');
  assert(isAllowedNativeApiOrigin('null', appUrl), 'opaque null origin');
  assert(!isAllowedNativeApiOrigin('https://evil.example', appUrl), 'random https origin denied');

  assert(hasAdminPrivileges({ admin: true }), 'admin claim');
  assert(hasAdminPrivileges({ superuser: true }), 'superuser claim');
  assert(hasAdminPrivileges({ role: 'admin' }), 'role=admin');
  assert(!hasAdminPrivileges({ role: 'b2c_client' }), 'client role is not admin');

  console.log('admin native auth tests passed');
}

run();
